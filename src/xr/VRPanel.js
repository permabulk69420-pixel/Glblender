import * as THREE from 'three';
import { displayName, materialsOf, transformState, isEditableMesh } from '../core/utils.js';

const WIDTH=768,HEIGHT=1060,ACCENT='#b5e890',MUTED='#91a1ae';
const PALETTE=['#d4d9d2','#91a6b4','#303d48','#d4913f','#d7705d','#63a5d4','#89b5a0','#a298cc'];
export function hsvHex(h,s,v) {
  const f=n=>{const k=(n+h*6)%6;return Math.round((v-v*s*Math.max(0,Math.min(k,4-k,1)))*255).toString(16).padStart(2,'0');};return '#'+f(5)+f(3)+f(1);
}
function toHSV(hex) {const n=parseInt(hex.replace('#',''),16),r=(n>>16&255)/255,g=(n>>8&255)/255,b=(n&255)/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=d===0?0:max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4;return{h:h/6,s:max===0?0:d/max,v:max};}

export class VRPanel {
  constructor(editor) {
    this.e=editor;this.canvas=document.createElement('canvas');this.canvas.width=WIDTH;this.canvas.height=HEIGHT;this.ctx=this.canvas.getContext('2d');
    this.texture=new THREE.CanvasTexture(this.canvas);this.texture.colorSpace=THREE.SRGBColorSpace;this.texture.minFilter=THREE.LinearFilter;this.texture.generateMipmaps=false;
    this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(.52,.52*HEIGHT/WIDTH),new THREE.MeshBasicMaterial({map:this.texture,transparent:false,side:THREE.DoubleSide,depthTest:false,toneMapped:false}));
    this.mesh.renderOrder=100;this.mesh.position.set(-.72,1.36,-.8);this.mesh.rotation.y=.5;this.mesh.visible=false;editor.workshop.scene.add(this.mesh);
    this.tab='edit';this.page=0;this.dirty=true;this.regions=[];this.hover=null;this.drag=null;this.colorTarget='color';this.hue=0;this.savedColours=[];this.lastDraw=0;this.notice='';this.noticeUntil=0;
    this.animSerial=-1;this.animRoot=null;this.animMixer=null;this.animAction=null;this.animClip=null;this.animIndex=0;this.animPlaying=false;this.animLoop=true;this.animSpeed=1;this.animLastTime=0;this.animUiTime=0;
    editor.asset.on('beforechange',()=>this.resetAnimation());
    editor.asset.on('loaded',()=>{this.animSerial=-1;this.animIndex=0;this.syncAnimationAsset();this.invalidate();});
    editor.workshop.renderer.xr.addEventListener('sessionend',()=>this.stopAnimation());
  }
  invalidate() {this.dirty=true;}
  message(text) {this.notice=text;this.noticeUntil=performance.now()+4500;this.invalidate();}
  text(value,x,y,size=22,color='#dbe5eb',weight='400') {const c=this.ctx;c.font=`${weight} ${size}px system-ui, sans-serif`;c.fillStyle=color;c.fillText(value,x,y);}
  truncate(value,max=35) {return value.length>max?value.slice(0,max-1)+'…':value;}
  rect(x,y,w,h,color,r=9) {const c=this.ctx;c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();}
  button(id,label,x,y,w,h,callback,{active=false,disabled=false,primary=false}={}) {
    this.rect(x,y,w,h,disabled?'#1c252e':primary?ACCENT:active?'#3f5638':this.hover===id?'#3b4a56':'#28343f',8);
    const c=this.ctx;c.save();c.globalAlpha=disabled?.35:1;c.textAlign='center';this.text(label,x+w/2,y+h/2+8,22,primary?'#1f321a':active?ACCENT:'#d6e1e9','500');c.restore();
    this.regions.push({id,x,y,w,h,disabled,down:callback});
  }
  row(buttons,y,{height=52,gap=10}={}) {const w=(WIDTH-64-gap*(buttons.length-1))/buttons.length;buttons.forEach((b,i)=>this.button(b.id,b.label,32+i*(w+gap),y,w,height,b.fn,b));}
  slider(id,label,value,min,max,y,onChange,{material=false,log=false,disabled=false}={}) {
    const x=36,w=WIDTH-72,c=this.ctx,t=log?Math.log(value/min)/Math.log(max/min):(value-min)/(max-min);
    this.text(label,x,y,21,MUTED);c.textAlign='right';this.text(value.toFixed(2),WIDTH-36,y,21,'#d8e5ce');c.textAlign='left';
    this.rect(x,y+22,w,8,'#394651',4);this.rect(x,y+22,Math.max(4,w*THREE.MathUtils.clamp(t,0,1)),8,disabled?'#48584a':ACCENT,4);
    c.beginPath();c.arc(x+w*THREE.MathUtils.clamp(t,0,1),y+26,9,0,Math.PI*2);c.fillStyle=ACCENT;c.fill();
    const set=(px)=>{const fraction=THREE.MathUtils.clamp((px-x)/w,0,1);onChange(log?min*Math.pow(max/min,fraction):min+fraction*(max-min));};
    this.regions.push({id,x,y:y+8,w,h:38,disabled,down:(px)=>set(px),move:px=>set(px),up:()=>{if(material)this.e.materials.end();this.e.ui.renderInspector();}});
  }
  resetAnimation() {
    if(this.animMixer){this.animMixer.stopAllAction();if(this.animRoot)this.animMixer.uncacheRoot(this.animRoot);}
    this.animRoot=null;this.animMixer=null;this.animAction=null;this.animClip=null;this.animPlaying=false;this.animLastTime=0;
  }
  syncAnimationAsset() {
    const e=this.e,serial=e.asset.serial,root=e.asset.root,clips=e.asset.animations||[];
    if(this.animSerial===serial&&this.animRoot===root)return;
    this.resetAnimation();this.animSerial=serial;this.animRoot=root;this.animIndex=Math.min(this.animIndex,Math.max(0,clips.length-1));
    if(root&&clips.length){
      this.animMixer=new THREE.AnimationMixer(root);this.animMixer.timeScale=this.animSpeed;
      this.animMixer.addEventListener('finished',()=>{this.animPlaying=false;if(this.animAction)this.animAction.paused=true;this.invalidate();});
    }
  }
  configureAnimationAction() {
    if(!this.animAction)return;
    this.animAction.setLoop(this.animLoop?THREE.LoopRepeat:THREE.LoopOnce,this.animLoop?Infinity:1);this.animAction.clampWhenFinished=!this.animLoop;
  }
  selectAnimation(index=this.animIndex,play=true) {
    this.syncAnimationAsset();const clips=this.e.asset.animations||[];if(!clips.length||!this.animMixer)return;
    if(this.animAction)this.animAction.stop();
    this.animIndex=(index%clips.length+clips.length)%clips.length;this.animClip=clips[this.animIndex];this.animAction=this.animMixer.clipAction(this.animClip);this.configureAnimationAction();
    this.animAction.reset().play();this.animAction.paused=!play;this.animPlaying=play;this.animLastTime=performance.now();this.animMixer.update(0);this.invalidate();
  }
  toggleAnimation() {
    this.syncAnimationAsset();if(!(this.e.asset.animations||[]).length)return;
    if(!this.animAction){this.selectAnimation(this.animIndex,true);return;}
    this.animPlaying=!this.animPlaying;this.animAction.paused=!this.animPlaying;this.animLastTime=performance.now();this.invalidate();
  }
  restartAnimation() {
    this.syncAnimationAsset();if(!(this.e.asset.animations||[]).length)return;
    if(!this.animAction){this.selectAnimation(this.animIndex,true);return;}
    this.configureAnimationAction();this.animAction.reset().play();this.animAction.paused=false;this.animPlaying=true;this.animLastTime=performance.now();this.animMixer.update(0);this.invalidate();
  }
  stopAnimation() {
    if(this.animMixer)this.animMixer.stopAllAction();this.animAction=null;this.animClip=null;this.animPlaying=false;this.animLastTime=0;this.invalidate();
  }
  toggleAnimationLoop() {this.animLoop=!this.animLoop;this.configureAnimationAction();this.invalidate();}
  setAnimationSpeed(value) {this.animSpeed=THREE.MathUtils.clamp(value,.1,2);if(this.animMixer)this.animMixer.timeScale=this.animSpeed;this.invalidate();}
  seekAnimation(value) {
    this.syncAnimationAsset();const clips=this.e.asset.animations||[];if(!clips.length||!this.animMixer)return;
    if(!this.animAction)this.selectAnimation(this.animIndex,false);
    const duration=Math.max(this.animClip?.duration||0,.0001);this.animAction.time=THREE.MathUtils.clamp(value,0,duration);this.animAction.paused=true;this.animPlaying=false;this.animMixer.update(0);this.invalidate();
  }
  update(time) {
    this.syncAnimationAsset();
    if(!this.animLastTime)this.animLastTime=time;
    const dt=Math.min(Math.max((time-this.animLastTime)/1000,0),.1);this.animLastTime=time;
    if(this.animMixer&&this.animPlaying)this.animMixer.update(dt);
    if(this.animPlaying&&this.tab==='animation'&&time-this.animUiTime>120){this.dirty=true;this.animUiTime=time;}
    if(this.notice&&time>this.noticeUntil){this.notice='';this.dirty=true;}if(this.dirty&&time-this.lastDraw>40){this.draw();this.lastDraw=time;this.dirty=false;}
  }
  draw() {
    const e=this.e,n=e.selection.selected,locked=e.selection.isLocked(),c=this.ctx;this.regions=[];
    c.fillStyle='#18222b';c.fillRect(0,0,WIDTH,HEIGHT);this.rect(0,0,WIDTH,5,ACCENT,0);
    this.text('Glblender',32,51,30,'#e4efe0','600');this.text(e.mode==='shape'?'SHAPE MODE':'OBJECT MODE',495,49,18,ACCENT,'500');
    this.text(this.truncate(e.asset.filename||'Workshop',49),32,88,18,MUTED);
    const tabs=['edit','material','shape','parts','animation'];
    this.row(tabs.map(t=>({id:'tab-'+t,label:t==='animation'?'Anim':t[0].toUpperCase()+t.slice(1),active:this.tab===t,fn:()=>{if(t!=='animation'&&this.tab==='animation')this.stopAnimation();this.tab=t;if(t==='shape')e.setMode('shape');if(t==='edit')e.setMode('object');this.invalidate();}})),112,{height:48,gap:7});
    const heading=this.tab==='animation'?`${e.asset.animations.length} animation clip${e.asset.animations.length===1?'':'s'}`:n?this.truncate(displayName(n),37):'Point at a component to select it';
    this.text(heading,32,202,23,this.tab==='animation'||n?'#e1e9ed':MUTED,'500');
    if(this.tab==='edit')this.drawEdit(n,locked);
    if(this.tab==='material')this.drawMaterial(n,locked);
    if(this.tab==='shape')this.drawShape(n,locked);
    if(this.tab==='parts')this.drawParts();
    if(this.tab==='animation')this.drawAnimation();
    c.strokeStyle='#35434f';c.beginPath();c.moveTo(32,824);c.lineTo(WIDTH-32,824);c.stroke();
    this.row([{id:'undo',label:'A  Undo',disabled:!e.history.canUndo,fn:()=>e.action('undo')},{id:'redo',label:'B  Redo',disabled:!e.history.canRedo,fn:()=>e.action('redo')}],842);
    this.row([{id:'import',label:'Import model',fn:()=>e.action('import')},{id:'export',label:e.busy?'Preparing…':'Export GLB',primary:true,disabled:e.busy,fn:()=>e.action('export')}],907);
    if(this.notice){this.text(this.truncate(this.notice,57),32,991,19,ACCENT);}else{this.text('Trigger: select / shape    Grip: grab    Both grips: scale',32,991,18,MUTED);}
    this.text('X: Object / Shape    Y: menu    Left stick: move',32,1028,18,'#758d9b');
    this.texture.needsUpdate=true;
  }
  drawEdit(n,locked) {
    const e=this.e;
    this.row([{id:'whole',label:'Select whole asset',active:n===e.asset.root,fn:()=>{e.selection.select(e.asset.root);this.invalidate();}},{id:'deselect',label:'Deselect',fn:()=>e.selection.select(null)}],228);
    this.text('Grip to move and rotate. Add your other grip to scale.',32,322,21,MUTED);
    this.text('Local movement constraint',32,368,20,MUTED);
    this.row(['FREE','X','Y','Z'].map(axis=>({id:'axis-'+axis,label:axis==='FREE'?'Free':axis,active:e.constraint===axis,fn:()=>{e.constraint=axis;e.transform.setConstraint(axis);e.ui.renderToolbar();this.invalidate();}})),387);
    this.row([{id:'hide',label:n?.userData.glblenderHidden?'Show':'Hide',disabled:!n||locked,fn:()=>e.action('hide')},{id:'isolate',label:e.selection.isolated?'Unisolate':'Isolate',disabled:!n,fn:()=>e.action('isolate')},{id:'lock',label:n?.userData.glblenderLocked?'Unlock':'Lock',disabled:!n,fn:()=>e.action('lock')}],458);
    this.row([{id:'smaller',label:'Part −10%',disabled:!n||locked,fn:()=>this.scaleSelected(.9)},{id:'larger',label:'Part +10%',disabled:!n||locked,fn:()=>this.scaleSelected(1.1)},{id:'reset',label:'Reset part',disabled:!n||locked,fn:()=>e.action('reset-transform')}],522);
    this.text('Viewing scale — original asset size is preserved',32,620,20,MUTED);
    this.row([{id:'tabletop',label:'Tabletop',active:e.workshop.viewMode==='tabletop',fn:()=>e.action('tabletop')},{id:'actual',label:'Actual 1:1',active:e.workshop.viewMode==='actual',fn:()=>e.action('actual')},{id:'recenter',label:'Recenter',fn:()=>e.xr.recenter()}],642);
    this.row([{id:'viewdown',label:'View −',fn:()=>this.scaleView(.8)},{id:'viewup',label:'View +',fn:()=>this.scaleView(1.25)},{id:'showall',label:'Show all',fn:()=>e.action('show-all')}],707);
    this.text(`${(e.workshop.viewScale*100).toFixed(1)}% viewing scale · ${locked?'selected part locked':'free grip rotation'}`,32,797,19,'#82998c');
  }
  drawMaterial(n,locked) {
    const e=this.e,mats=materialsOf(n),m=mats[e.ui.materialIndex];if(!m){this.text('Select a mesh to edit its material.',32,265,23,MUTED);return;}
    const target=this.colorTarget,color='#'+(m[target]?.getHexString()||'000000'),hsv=toHSV(color);if(!this.drag?.id.startsWith('color'))this.hue=hsv.h;
    this.row([{id:'base',label:'Base colour',active:target==='color',fn:()=>{this.colorTarget='color';this.invalidate();}},{id:'glow',label:'Emissive colour',active:target==='emissive',fn:()=>{this.colorTarget='emissive';this.invalidate();}}],224,{height:42});
    const c=this.ctx,x=36,y=287,w=WIDTH-72,h=133;
    c.fillStyle=`hsl(${this.hue*360},100%,50%)`;c.fillRect(x,y,w,h);let g=c.createLinearGradient(x,0,x+w,0);g.addColorStop(0,'#fff');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(x,y,w,h);g=c.createLinearGradient(0,y,0,y+h);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'#000');c.fillStyle=g;c.fillRect(x,y,w,h);
    c.strokeStyle='#fff';c.lineWidth=3;c.beginPath();c.arc(x+hsv.s*w,y+(1-hsv.v)*h,7,0,Math.PI*2);c.stroke();
    const sv=(px,py)=>e.setMaterial(target,hsvHex(this.hue,THREE.MathUtils.clamp((px-x)/w,0,1),1-THREE.MathUtils.clamp((py-y)/h,0,1)),false);
    this.regions.push({id:'color-sv',x,y,w,h,disabled:locked,down:sv,move:sv,up:()=>e.materials.end()});
    g=c.createLinearGradient(x,0,x+w,0);for(let i=0;i<=6;i++)g.addColorStop(i/6,`hsl(${i*60},100%,50%)`);c.fillStyle=g;c.fillRect(x,436,w,27);
    const hue=px=>{this.hue=THREE.MathUtils.clamp((px-x)/w,0,1);e.setMaterial(target,hsvHex(this.hue,Math.max(hsv.s,.4),Math.max(hsv.v,.5)),false);};
    this.regions.push({id:'color-hue',x,y:429,w,h:41,disabled:locked,down:hue,move:hue,up:()=>e.materials.end()});
    const palette=[...this.savedColours,...PALETTE.filter(value=>!this.savedColours.includes(value))].slice(0,8);
    palette.forEach((value,i)=>{const sx=36+i*87;this.rect(sx,484,69,37,value,5);this.regions.push({id:'swatch-'+i,x:sx,y:484,w:69,h:37,disabled:locked,down:()=>e.setMaterial(target,value,true)});});
    this.button('save-colour','Save current colour',32,528,222,31,()=>{const value='#'+(materialsOf(e.selection.selected)[e.ui.materialIndex]?.[target]?.getHexString()||'000000');this.savedColours=[value,...this.savedColours.filter(c=>c!==value)].slice(0,8);this.message(`${value.toUpperCase()} saved to palette`);},{disabled:locked});
    this.text(this.savedColours.length?'Saved colours appear first in the palette':'Save a colour, then reuse it on another part',273,551,17,MUTED);
    this.slider('metal','Metallic',m.metalness??0,0,1,582,v=>e.setMaterial('metalness',v),{material:true,disabled:locked});
    this.slider('rough','Roughness',m.roughness??1,0,1,652,v=>e.setMaterial('roughness',v),{material:true,disabled:locked});
    this.slider('third',target==='emissive'?'Emission strength':'Opacity',target==='emissive'?(m.emissiveIntensity??1):(m.opacity??1),0,target==='emissive'?5:1,722,v=>e.setMaterial(target==='emissive'?'emissiveIntensity':'opacity',v),{material:true,disabled:locked});
    this.button('slot',`Material ${e.ui.materialIndex+1}/${mats.length}: ${this.truncate(m.name||'Surface',26)}`,32,775,WIDTH-64,34,()=>{e.materials.end();e.ui.materialIndex=(e.ui.materialIndex+1)%mats.length;this.invalidate();});
  }
  drawShape(n,locked) {
    const e=this.e,s=e.shape,disabled=!isEditableMesh(n)||locked;
    this.row(['pull','stretch','squash'].map(kind=>({id:kind,label:kind[0].toUpperCase()+kind.slice(1),active:s.kind===kind,fn:()=>{s.kind=kind;this.invalidate();e.ui.renderInspector();}})),229);
    this.row(['flatten','bend'].map(kind=>({id:kind,label:kind[0].toUpperCase()+kind.slice(1),active:s.kind===kind,fn:()=>{s.kind=kind;this.invalidate();e.ui.renderInspector();}})),293);
    this.slider('radius','Brush radius · asset metres',s.radius,.01,10,386,v=>{s.radius=v;this.invalidate();},{log:true});
    this.slider('strength','Strength',s.strength,.05,2,473,v=>{s.strength=v;this.invalidate();});
    this.text('Stretch / bend axis',32,561,21,MUTED);
    this.row(['X','Y','Z'].map(axis=>({id:'shape-'+axis,label:axis,active:s.axis===axis,fn:()=>{s.axis=axis;this.invalidate();e.ui.renderInspector();}})),580);
    if(s.kind==='bend')this.row([{id:'bendleft',label:'Bend −15°',disabled,fn:()=>s.applyBend(n,-Math.PI/12,e.workshop.viewScale)},{id:'bendright',label:'Bend +15°',disabled,fn:()=>s.applyBend(n,Math.PI/12,e.workshop.viewScale)}],659);
    else this.row([{id:'soft',label:'Broad falloff',active:s.falloff===.5,fn:()=>{s.falloff=.5;this.invalidate();}},{id:'medium',label:'Smooth',active:s.falloff===1,fn:()=>{s.falloff=1;this.invalidate();}},{id:'tight',label:'Tight',active:s.falloff===2,fn:()=>{s.falloff=2;this.invalidate();}}],659);
    this.text(disabled?'Select an unlocked static mesh to start.':'Hold trigger on the surface, then move your hand.',32,758,20,disabled?'#d6b18a':MUTED);
    this.text('Right stick up/down: brush radius. Grip: reposition.',32,794,19,'#82998c');
  }
  drawParts() {
    const e=this.e,list=e.asset.nodes.filter(n=>n.isMesh||n.children.length),perPage=8,total=Math.max(1,Math.ceil(list.length/perPage));this.page=Math.min(this.page,total-1);
    for(let i=0;i<perPage;i++){const n=list[this.page*perPage+i];if(!n)break;this.button('part-'+n.uuid,(n.userData.glblenderHidden?'○ ':'')+this.truncate(displayName(n),40),32,227+i*60,WIDTH-64,49,()=>{e.selection.select(n);e.ui.renderTree();},{active:e.selection.selected===n});}
    this.row([{id:'prev',label:'Previous',disabled:this.page===0,fn:()=>{this.page--;this.invalidate();}},{id:'wholeparts',label:'Whole asset',fn:()=>e.selection.select(e.asset.root)},{id:'next',label:'Next',disabled:this.page>=total-1,fn:()=>{this.page++;this.invalidate();}}],726);
    this.text(`Page ${this.page+1} / ${total} · ${e.asset.meshes.length} meshes`,32,807,19,MUTED);
  }
  drawAnimation() {
    this.syncAnimationAsset();const clips=this.e.asset.animations||[];
    if(!clips.length){
      this.text('No animation clips in this GLB.',32,270,25,'#dbe5eb','500');
      this.text('If a model contains glTF animations, they will appear here',32,318,20,MUTED);
      this.text('automatically and can be previewed without changing the file.',32,350,20,MUTED);return;
    }
    this.animIndex=Math.min(this.animIndex,clips.length-1);const clip=clips[this.animIndex],action=this.animAction&&this.animClip===clip?this.animAction:null;
    const playing=!!action&&this.animPlaying&&!action.paused,current=action?.time||0,duration=Math.max(clip.duration||0,.0001);
    this.text(this.truncate(clip.name||`Animation ${this.animIndex+1}`,48),32,268,28,'#e4efe0','600');
    this.text(`Clip ${this.animIndex+1} / ${clips.length}  ·  ${duration.toFixed(2)} s`,32,304,19,MUTED);
    this.row([{id:'anim-prev',label:'Previous',disabled:clips.length<2,fn:()=>this.selectAnimation(this.animIndex-1,true)},{id:'anim-play',label:playing?'Pause':'Play',fn:()=>this.toggleAnimation()},{id:'anim-next',label:'Next',disabled:clips.length<2,fn:()=>this.selectAnimation(this.animIndex+1,true)}],336);
    this.row([{id:'anim-restart',label:'Restart',fn:()=>this.restartAnimation()},{id:'anim-stop',label:'Stop',disabled:!action,fn:()=>this.stopAnimation()},{id:'anim-loop',label:this.animLoop?'Loop: On':'Loop: Off',active:this.animLoop,fn:()=>this.toggleAnimationLoop()}],408);
    this.slider('anim-speed','Playback speed',this.animSpeed,.1,2,505,v=>this.setAnimationSpeed(v));
    this.slider('anim-time','Scrub',THREE.MathUtils.clamp(current,0,duration),0,duration,585,v=>this.seekAnimation(v));
    this.text(playing?'Playing preview':'Paused / ready',32,674,21,playing?ACCENT:MUTED,'500');
    this.text('Playback is preview-only. Leaving this tab restores the edit pose.',32,716,19,MUTED);
    this.text('Animations remain embedded when you export the GLB.',32,748,19,'#82998c');
  }
  scaleSelected(factor) {const e=this.e,n=e.selection.selected;if(!n||e.selection.isLocked())return;const before=transformState(n);n.scale.multiplyScalar(factor);n.updateMatrix();e.history.transform(n,before,transformState(n),'Scale component');}
  scaleView(factor) {const w=this.e.workshop;w.viewScale=THREE.MathUtils.clamp(w.viewScale*factor,.0001,1000);w.viewRig.scale.setScalar(w.viewScale);w.viewMode='custom';this.e.ui.updateView();this.invalidate();}
  hit(raycaster) {if(!this.mesh.visible)return null;return raycaster.intersectObject(this.mesh,false)[0]||null;}
  coords(hit) {return{x:hit.uv.x*WIDTH,y:(1-hit.uv.y)*HEIGHT};}
  region(hit) {if(!hit)return null;const{x,y}=this.coords(hit);return this.regions.find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h);}
  hoverAt(hit) {const id=this.region(hit)?.id||null;if(id!==this.hover){this.hover=id;this.invalidate();}}
  down(owner,hit) {if(this.drag)return false;const r=this.region(hit);if(!r||r.disabled)return false;const{x,y}=this.coords(hit);if(r.move){this.drag={...r,owner};this.e.interacting=true;}r.down?.(x,y);this.invalidate();return true;}
  move(owner,hit) {if(!hit||this.drag?.owner!==owner)return;const{x,y}=this.coords(hit);this.drag.move?.(x,y);}
  up(owner) {if(this.drag?.owner!==owner)return;const drag=this.drag;this.drag=null;this.e.interacting=false;drag.up?.();this.invalidate();}
}
