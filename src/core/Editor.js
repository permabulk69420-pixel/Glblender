import * as THREE from 'three';
import { Workshop } from './Workshop.js';
import { AssetManager } from './AssetManager.js';
import { SelectionManager } from './SelectionManager.js';
import { HistoryManager } from './HistoryManager.js';
import { ExportManager } from './ExportManager.js';
import { SessionManager } from './SessionManager.js';
import { TransformTool } from '../tools/TransformTool.js';
import { MaterialEditor } from '../tools/MaterialEditor.js';
import { DeformationTool } from '../tools/DeformationTool.js';
import { UIManager } from '../ui/UIManager.js';
import { VRInteractionManager } from '../xr/VRInteractionManager.js';
import { createDemo } from './demo.js';
import { transformState, applyTransform, downloadBlob, isEditableMesh } from './utils.js';

export class Editor {
  constructor(root) {
    this.mode='object';this.transformMode='translate';this.constraint='FREE';this.snap=false;this.busy=false;this.interacting=false;this.history=new HistoryManager();
    this.ui=new UIManager(this,root);this.workshop=new Workshop(root.querySelector('#viewport'));
    this.asset=new AssetManager(this.workshop.offset,this.workshop.renderer);this.selection=new SelectionManager(this.asset,this.workshop.scene,this.history);
    this.materials=new MaterialEditor(this.history);this.shape=new DeformationTool(this.history,this.workshop.scene);this.transform=new TransformTool(this);
    this.exporter=new ExportManager(this.asset);this.sessions=new SessionManager(this);this.xr=new VRInteractionManager(this);
    this.ray=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.dragPlane=new THREE.Plane();this.dragPoint=new THREE.Vector3();this.cameraDirection=new THREE.Vector3();
    this.asset.on('beforechange',()=>{this.materials.end();this.shape.end(true);clearTimeout(this.sessions.timer);this.history.clear();this.transform.controls.detach();});
    this.asset.on('loaded',()=>{this.workshop.setAssetBounds(this.asset.info.bounds);this.ui.materialIndex=0;this.ui.expanded.clear();this.selection.select(this.asset.meshes[0]||this.asset.root);this.ui.render();this.xr.panel.invalidate();});
    this.selection.on('change',()=>{this.materials.end();for(let p=this.selection.selected?.parent;p;p=p.parent){this.ui.expanded.add(p.uuid);if(p===this.asset.root)break;}this.transform.attach();this.ui.renderTree();this.ui.renderInspector();this.xr.panel.invalidate();});
    this.history.on('change',label=>{
      if(!this.asset.root)return;this.asset.refresh();
      if(this.selection.selected&&!this.selection.ancestor(this.selection.selected,this.asset.root))this.selection.select(null);
      if(this.selection.isolated&&!this.selection.ancestor(this.selection.isolated,this.asset.root))this.selection.isolated=null;
      this.selection.applyVisibility();this.transform.attach();this.ui.render();this.xr.panel.invalidate();if(label)this.sessions.schedule();
    });
    this.bindPointer();this.bindKeyboard();
    this.asset.setAsset(createDemo(),'kestrel-shuttle.glb');this.ui.render();
    this.xr.setup();this.sessions.previous().then(record=>{if(record)this.ui.showRecovery(record);});
    this.lastFrame=0;this.fpsStart=0;this.frameCount=0;this.workshop.renderer.setAnimationLoop(time=>this.frame(time));
  }
  pick(clientX,clientY) {
    const rect=this.workshop.renderer.domElement.getBoundingClientRect();this.pointer.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
    this.ray.setFromCamera(this.pointer,this.workshop.camera);
    return this.ray.intersectObjects(this.asset.meshes,false).find(h=>this.selection.isVisible(h.object));
  }
  bindPointer() {
    const canvas=this.workshop.renderer.domElement,controls=this.workshop.controls;controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;
    canvas.addEventListener('pointerdown',event=>{
      if(this.busy||this.workshop.renderer.xr.isPresenting)return;
      this.pointerStart={x:event.clientX,y:event.clientY,gizmo:!!this.transform.controls.axis,button:event.button};
      if(this.mode!=='shape'||event.button!==0||event.shiftKey||event.altKey)return;
      const hit=this.pick(event.clientX,event.clientY);if(!hit)return;
      event.preventDefault();event.stopImmediatePropagation();this.selection.select(hit.object);
      if(this.selection.isLocked()){this.ui.toast('Unlock this component before editing.');return;}
      try {
        if(this.shape.begin(hit.object,hit.point,hit.point,this.workshop.viewScale,hit.face?.normal)) {
          this.dragPlane.setFromNormalAndCoplanarPoint(this.workshop.camera.getWorldDirection(this.cameraDirection),hit.point);this.interacting=true;controls.enabled=false;canvas.setPointerCapture(event.pointerId);
        }
      }catch(error){this.ui.toast(error.message,true);}
    },true);
    canvas.addEventListener('pointermove',event=>{
      if(this.busy||this.workshop.renderer.xr.isPresenting)return;
      if(this.shape.active){event.stopImmediatePropagation();this.pick(event.clientX,event.clientY);if(this.ray.ray.intersectPlane(this.dragPlane,this.dragPoint)){this.shape.update(this.dragPoint);this.selection.update();}return;}
      if(this.mode==='shape'){const hit=this.pick(event.clientX,event.clientY);this.shape.hover(hit?.point,this.workshop.viewScale);canvas.style.cursor=hit?'crosshair':'grab';}
    },true);
    canvas.addEventListener('pointerup',event=>{
      if(this.shape.active){event.stopImmediatePropagation();this.shape.end();this.interacting=false;controls.enabled=true;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);this.pointerStart=null;return;}
      const down=this.pointerStart;this.pointerStart=null;
      if(this.busy||!down||down.gizmo||down.button!==0||Math.hypot(event.clientX-down.x,event.clientY-down.y)>5||this.transform.controls.dragging)return;
      this.selection.select(this.pick(event.clientX,event.clientY)?.object||null);
    },true);
    canvas.addEventListener('pointercancel',()=>this.cancelStroke());
    canvas.addEventListener('pointerleave',()=>{if(!this.shape.active)this.shape.hover(null);});
    window.addEventListener('blur',()=>this.cancelStroke());
    const root=this.ui.root;
    root.addEventListener('dragover',event=>{event.preventDefault();});
    root.addEventListener('drop',event=>{event.preventDefault();if(event.dataTransfer.files.length)this.importFiles(event.dataTransfer.files);});
  }
  bindKeyboard() {
    document.addEventListener('keydown',event=>{
      if(/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||this.busy)return;
      const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;
      if(mod&&(key==='z'||key==='y')){event.preventDefault();if(this.interacting)return;this.action(key==='y'||event.shiftKey?'redo':'undo');return;}
      if(key==='escape'){this.cancelStroke();this.selection.select(null);return;}
      if(this.interacting)return;
      const map={w:'translate',e:'rotate',r:'scale',f:'frame',delete:'delete',h:'hide',i:'isolate'};if(map[key]){event.preventDefault();this.action(map[key]);}
    });
  }
  cancelStroke() {if(this.shape.active)this.shape.end(true);this.interacting=false;if(!this.workshop.renderer.xr.isPresenting)this.workshop.controls.enabled=true;}
  setMode(mode) {if(this.interacting)return;this.mode=mode;if(mode==='shape')this.ui.inspectorTab='shape';else if(this.ui.inspectorTab==='shape')this.ui.inspectorTab='transform';this.shape.hover(null);this.transform.attach();this.ui.renderToolbar();this.ui.renderInspector();this.xr.panel.invalidate();}
  setMaterial(key,value,commit=false) {const n=this.selection.selected;if(!n?.isMesh||this.selection.isLocked())return;this.materials.set(n,this.ui.materialIndex,key,value);if(commit)this.materials.end();this.xr.panel.invalidate();}
  async importFiles(files) {if(this.busy||this.interacting)return;this.setBusy(true,'Opening your model…');try{await this.asset.loadFiles(files);this.ui.root.querySelector('#recovery-banner').hidden=true;this.ui.toast(`Loaded ${this.asset.meshes.length} components`);this.sessions.schedule();}catch(error){this.ui.toast(error.message,true);console.error('Import:',error);}finally{this.setBusy(false);}}
  async importBuffer(data,name) {this.setBusy(true,'Recovering your model…');try{await this.asset.parse(data,name);this.ui.root.querySelector('#recovery-banner').hidden=true;}finally{this.setBusy(false);}}
  setBusy(value,label) {this.busy=value;this.ui.setBusy(value,label);this.xr.panel.invalidate();}
  async exportGLB() {
    this.xr?.panel?.stopAnimation?.();this.materials.end();this.setBusy(true,'Preparing your GLB…');
    try {
      const data=await this.exporter.binary(),name=this.asset.filename.replace(/\.(glb|gltf)$/i,'').replace(/-edited$/i,'')+'-edited.glb',blob=new Blob([data],{type:'model/gltf-binary'});
      if(this.workshop.renderer.xr.isPresenting)await this.workshop.renderer.xr.getSession().end();
      downloadBlob(blob,name);
      if(this.downloadURL)URL.revokeObjectURL(this.downloadURL);this.downloadURL=URL.createObjectURL(blob);
      const link=this.ui.root.querySelector('#download-ready');link.href=this.downloadURL;link.download=name;link.hidden=false;
      this.ui.toast(`Export ready · ${name} · ${(data.byteLength/1024/1024).toFixed(2)} MB`);
    } catch(error){this.ui.toast(`Export failed: ${error.message}`,true);console.error('Export:',error);}
    finally {this.setBusy(false);}
  }
  async action(action) {
    if(this.busy&&!['help','close-help'].includes(action))return;
    if(this.interacting&&!['menu','help','close-help'].includes(action)){this.ui.toast('Release your current grab first.');return;}
    try {
      switch(action) {
        case 'import':if(this.workshop.renderer.xr.isPresenting){await this.workshop.renderer.xr.getSession().end();this.ui.toast('Choose Import model to open your Quest files.');}else this.ui.root.querySelector('#file-input').click();break;
        case 'export':await this.exportGLB();break;
        case 'vr':await this.xr.enter();break;
        case 'object':case 'shape':this.setMode(action);break;
        case 'translate':case 'rotate':case 'scale':this.setMode('object');this.transformMode=action;this.transform.setMode(action);this.ui.renderToolbar();break;
        case 'undo':this.materials.end();this.history.undo();break;
        case 'redo':this.materials.end();this.history.redo();break;
        case 'hide':this.selection.hide();break;
        case 'show-all':this.selection.showAll();break;
        case 'isolate':this.selection.isolate();break;
        case 'lock':this.selection.lock();break;
        case 'delete':this.selection.remove();break;
        case 'duplicate':if(this.selection.duplicate()===false)this.ui.toast('Duplicating rigged assemblies is not supported yet.');break;
        case 'reset-transform':{const n=this.selection.selected;if(n&&!this.selection.isLocked()){const before=transformState(n),after=this.asset.originalTransforms.get(n);if(after){applyTransform(n,after);this.history.transform(n,before,after,'Reset transform');}}break;}
        case 'snap':this.snap=!this.snap;this.transform.setSnap(this.snap);this.ui.renderToolbar();break;
        case 'tabletop':case 'actual':this.workshop.setViewMode(action);this.ui.updateView();this.xr.panel.invalidate();break;
        case 'frame':if(this.workshop.renderer.xr.isPresenting)this.workshop.recenter();else this.workshop.frame();break;
        case 'sample':this.asset.setAsset(createDemo(),'kestrel-shuttle.glb');this.ui.setSaveStatus('Sample asset · ready to edit');break;
        case 'apply-bend':{const n=this.selection.selected;if(n&&!this.selection.isLocked()&&isEditableMesh(n)){const degrees=Number(this.ui.root.querySelector('#bend-angle')?.value||30);this.shape.applyBend(n,THREE.MathUtils.degToRad(Math.max(-180,Math.min(180,degrees))),this.workshop.viewScale);}break;}
        case 'help':this.ui.root.querySelector('#help-dialog').showModal();break;
        case 'close-help':this.ui.root.querySelector('#help-dialog').close();break;
        case 'scene-panel':this.ui.root.querySelector('.scene-panel').classList.toggle('open');this.ui.root.querySelector('.inspector-panel').classList.remove('open');break;
        case 'inspector-panel':this.ui.root.querySelector('.inspector-panel').classList.toggle('open');this.ui.root.querySelector('.scene-panel').classList.remove('open');break;
        case 'recover':await this.sessions.restore(this.ui.recovery);break;
        case 'dismiss-recovery':this.ui.root.querySelector('#recovery-banner').hidden=true;break;
        case 'menu':this.xr.panel.mesh.visible=!this.xr.panel.mesh.visible;break;
      }
    }catch(error){this.ui.toast(error.message,true);console.error(action,error);}
  }
  frame(time) {
    const dt=Math.min((time-this.lastFrame)/1000,.05);this.lastFrame=time;
    if(this.workshop.renderer.xr.isPresenting)this.xr.update(time,dt);else this.workshop.controls.update();
    this.selection.update();this.workshop.renderer.render(this.workshop.scene,this.workshop.camera);
    this.frameCount++;if(time-this.fpsStart>1000){const fps=Math.round(this.frameCount*1000/(time-this.fpsStart));this.ui.root.querySelector('#render-stats').textContent=`${fps} fps · ${this.workshop.renderer.info.render.calls} draws`;this.frameCount=0;this.fpsStart=time;}
  }
}
