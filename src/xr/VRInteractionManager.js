import * as THREE from 'three';
import { VRPanel } from './VRPanel.js';
import { twoHandMatrix } from './manipulation.js';
import { transformState, applyTransform } from '../core/utils.js';

export class VRInteractionManager {
  constructor(editor) {
    this.e=editor;this.panel=new VRPanel(editor);this.hands=[];this.grab=null;this.supported=false;this.lastTurn=0;this.pendingPanel=0;
    this.matrix=new THREE.Matrix4();this.parentInverse=new THREE.Matrix4();this.desired=new THREE.Matrix4();this.a=new THREE.Vector3();this.b=new THREE.Vector3();this.mid=new THREE.Vector3();this.forward=new THREE.Vector3();this.right=new THREE.Vector3();this.head=new THREE.Vector3();this.axisVector=new THREE.Vector3();this.delta=new THREE.Vector3();this.q=new THREE.Quaternion();this.up=new THREE.Vector3(0,1,0);
    for(let i=0;i<2;i++)this.createHand(i);
    editor.workshop.renderer.xr.addEventListener('sessionstart',()=>{editor.workshop.enterXR();editor.transform.attach();document.body.classList.add('xr-active');this.panel.mesh.visible=true;this.pendingPanel=3;this.panel.invalidate();});
    editor.workshop.renderer.xr.addEventListener('sessionend',()=>{this.finishAll();this.panel.mesh.visible=false;editor.shape.hover(null);editor.workshop.exitXR();editor.transform.attach();document.body.classList.remove('xr-active');editor.ui.render();});
  }
  async setup() {
    try{this.supported=!!navigator.xr&&await navigator.xr.isSessionSupported('immersive-vr');}catch{this.supported=false;}
    const button=this.e.ui.root.querySelector('[data-action="vr"]');button.disabled=!this.supported;button.title=this.supported?'Enter the VR workshop':'Open this page in the Meta Quest browser to enter VR';
  }
  async enter() {
    if(!this.supported){this.e.ui.toast('Open this page in the Quest browser to enter VR.');return;}
    const session=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor','bounded-floor']});await this.e.workshop.renderer.xr.setSession(session);
  }
  createHand(index) {
    const e=this.e,xr=e.workshop.renderer.xr,controller=xr.getController(index),grip=xr.getControllerGrip(index);e.workshop.cameraRig.add(controller,grip);
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:'#b5e890',transparent:true,opacity:.65}));line.scale.z=2;controller.add(line);
    const dot=new THREE.Mesh(new THREE.SphereGeometry(.0045,8,6),new THREE.MeshBasicMaterial({color:'#c4f0a2',depthTest:false}));dot.visible=false;dot.renderOrder=200;e.workshop.scene.add(dot);
    const body=new THREE.Mesh(new THREE.CapsuleGeometry(.022,.062,4,8),new THREE.MeshStandardMaterial({color:'#4f5e67',roughness:.5,metalness:.4}));body.rotation.x=-.3;grip.add(body);
    const cap=new THREE.Mesh(new THREE.SphereGeometry(.026,12,8),new THREE.MeshStandardMaterial({color:'#b5e890',roughness:.6}));cap.scale.set(1,.25,1);cap.position.y=.054;grip.add(cap);
    const state={index,controller,grip,line,dot,ray:new THREE.Raycaster(),source:null,previous:[],position:new THREE.Vector3(),ui:false,sculpt:false,grabbing:false,lastRay:0,hit:null,menuHit:null};this.hands.push(state);
    controller.addEventListener('connected',event=>{state.source=event.data;state.previous=[];});
    controller.addEventListener('disconnected',()=>{this.release(state);if(state.sculpt)this.endSculpt(state);this.panel.up(index);state.source=null;state.dot.visible=false;});
    controller.addEventListener('selectstart',()=>this.selectStart(state));
    controller.addEventListener('selectend',()=>{this.panel.up(index);state.ui=false;if(state.sculpt)this.endSculpt(state);});
    controller.addEventListener('squeezestart',()=>this.squeeze(state));
    controller.addEventListener('squeezeend',()=>this.release(state));
  }
  raycast(hand) {
    hand.controller.updateWorldMatrix(true,false);hand.grip.updateWorldMatrix(true,false);
    hand.ray.ray.origin.setFromMatrixPosition(hand.controller.matrixWorld);hand.ray.ray.direction.set(0,0,-1).transformDirection(hand.controller.matrixWorld);
    hand.menuHit=this.panel.hit(hand.ray);
    hand.hit=hand.menuHit?null:hand.ray.intersectObjects(this.e.asset.meshes,false).find(h=>this.e.selection.isVisible(h.object))||null;
    return hand.menuHit||hand.hit;
  }
  haptic(hand) {hand.source?.gamepad?.hapticActuators?.[0]?.pulse(.25,30)?.catch?.(()=>{});}
  selectStart(hand) {
    const e=this.e;if(e.busy||this.grab||e.shape.active||this.panel.drag)return;this.raycast(hand);
    if(hand.menuHit){hand.ui=true;this.panel.down(hand.index,hand.menuHit);this.haptic(hand);return;}
    if(!hand.hit){e.selection.select(null);return;}
    e.selection.select(hand.hit.object);this.haptic(hand);
    if(e.mode==='shape'&&!e.selection.isLocked()) {
      try{hand.grip.getWorldPosition(hand.position);if(e.shape.begin(hand.hit.object,hand.hit.point,hand.position,e.workshop.viewScale,hand.hit.face?.normal)){hand.sculpt=true;e.interacting=true;}}
      catch(error){e.ui.toast(error.message,true);}
    }
  }
  endSculpt(hand) {this.e.shape.end();hand.sculpt=false;this.e.interacting=false;}
  squeeze(hand) {
    const e=this.e;if(e.busy||e.shape.active||hand.ui||this.panel.drag)return;
    if(this.grab){if(!this.grab.hands.includes(hand)&&this.grab.hands.length===1){this.grab.hands[0].grip.getWorldPosition(this.a);hand.grip.getWorldPosition(this.b);if(this.a.distanceTo(this.b)<.04)return;this.updateGrab();this.grab.hands.push(hand);hand.grabbing=true;this.rebaseGrab();this.haptic(hand);}return;}
    this.raycast(hand);if(hand.menuHit)return;
    const selected=e.selection.selected,node=selected===e.asset.root?selected:hand.hit?.object||selected;
    if(!node||e.selection.isLocked(node)||!e.selection.isVisible(node))return;
    e.selection.select(node);hand.grabbing=true;e.interacting=true;
    this.grab={node,hands:[hand],before:transformState(node)};this.rebaseGrab();this.haptic(hand);
  }
  rebaseGrab() {
    const g=this.grab;if(!g)return;g.node.updateWorldMatrix(true,false);g.startWorld=g.node.matrixWorld.clone();g.localStart=transformState(g.node);g.localScale=g.node.scale.clone();
    for(const h of g.hands)h.grip.updateWorldMatrix(true,false);
    if(g.hands.length===1){g.inverseGrip=g.hands[0].grip.matrixWorld.clone().invert();}
    else{g.hands[0].grip.getWorldPosition(this.a);g.hands[1].grip.getWorldPosition(this.b);g.mid=this.a.clone().add(this.b).multiplyScalar(.5);g.vector=this.b.clone().sub(this.a);}
  }
  updateGrab() {
    const g=this.grab;if(!g)return;let ratio=1;
    if(g.hands.length===1){g.hands[0].grip.updateWorldMatrix(true,false);this.desired.copy(g.hands[0].grip.matrixWorld).multiply(g.inverseGrip).multiply(g.startWorld);}
    else{g.hands[0].grip.getWorldPosition(this.a);g.hands[1].grip.getWorldPosition(this.b);ratio=twoHandMatrix(g.startWorld,g.mid,g.vector,this.a,this.b,this.desired).ratio;}
    g.node.parent.updateWorldMatrix(true,false);this.parentInverse.copy(g.node.parent.matrixWorld).invert();this.matrix.multiplyMatrices(this.parentInverse,this.desired);this.matrix.decompose(g.node.position,g.node.quaternion,g.node.scale);
    // A rotated non-uniform parent can introduce shear. Keep intended local
    // scale explicit instead of accumulating decomposed scale drift each frame.
    g.node.scale.copy(g.localScale).multiplyScalar(ratio);
    if(this.e.constraint!=='FREE'&&g.hands.length===1) {
      this.a.fromArray(g.localStart.position);this.axisVector.set(0,0,0).setComponent('XYZ'.indexOf(this.e.constraint),1).applyQuaternion(this.q.fromArray(g.localStart.quaternion));
      this.delta.subVectors(g.node.position,this.a);g.node.position.copy(this.a).addScaledVector(this.axisVector,this.delta.dot(this.axisVector));g.node.quaternion.fromArray(g.localStart.quaternion);
    }
    if(this.e.snap){for(const axis of ['x','y','z'])g.node.position[axis]=Math.round(g.node.position[axis]/.1)*.1;}
    g.node.updateMatrix();g.node.updateWorldMatrix(false,true);
  }
  release(hand) {
    const g=this.grab;if(!g||!g.hands.includes(hand))return;this.updateGrab();hand.grabbing=false;g.hands=g.hands.filter(h=>h!==hand);
    if(g.hands.length)this.rebaseGrab();else{this.grab=null;this.e.interacting=false;this.e.history.transform(g.node,g.before,transformState(g.node),'Grab component');}
  }
  finishAll() {for(const hand of this.hands){this.release(hand);if(hand.sculpt)this.endSculpt(hand);this.panel.up(hand.index);hand.ui=false;hand.dot.visible=false;hand.previous=[];}this.e.interacting=false;}
  placePanel() {
    const camera=this.e.workshop.renderer.xr.getCamera();camera.getWorldPosition(this.head);camera.getWorldDirection(this.forward);this.forward.y=0;this.forward.normalize();this.q.setFromAxisAngle(this.up,Math.atan2(-this.forward.x,-this.forward.z));
    this.panel.mesh.position.set(-.64,-.17,-.85).applyQuaternion(this.q).add(this.head);this.panel.mesh.lookAt(this.head);this.panel.mesh.updateWorldMatrix(true,false);
  }
  recenter() {this.e.workshop.recenter();this.pendingPanel=2;}
  toggleMenu() {this.panel.mesh.visible=!this.panel.mesh.visible;if(this.panel.mesh.visible)this.placePanel();this.panel.invalidate();}
  buttons(hand,time,dt) {
    const gamepad=hand.source?.gamepad;if(!gamepad)return;const side=hand.source.handedness;
    for(let i=4;i<=5;i++){const pressed=gamepad.buttons[i]?.pressed||false;if(pressed&&!hand.previous[i]){if(side==='right')this.e.action(i===4?'undo':'redo');else if(i===4)this.e.setMode(this.e.mode==='object'?'shape':'object');else this.toggleMenu();}hand.previous[i]=pressed;}
    if(this.e.interacting||this.panel.drag||this.e.busy)return;
    const offset=gamepad.axes.length>=4?2:0,x=gamepad.axes[offset]||0,y=gamepad.axes[offset+1]||0;
    if(side==='left'&&(Math.abs(x)>.15||Math.abs(y)>.15)) {
      const camera=this.e.workshop.renderer.xr.getCamera();camera.getWorldDirection(this.forward);this.forward.y=0;this.forward.normalize();this.right.crossVectors(this.forward,this.up);
      const rig=this.e.workshop.cameraRig;rig.position.addScaledVector(this.forward,-y*dt*1.1).addScaledVector(this.right,x*dt*1.1);
    }
    if(side==='right') {
      if(this.e.mode==='shape'&&Math.abs(y)>.2){this.e.shape.radius=THREE.MathUtils.clamp(this.e.shape.radius*Math.exp(-y*dt*1.4),.01,100);this.panel.invalidate();}
      if(this.e.mode==='object'&&Math.abs(x)>.65&&time-this.lastTurn>350){
        const rig=this.e.workshop.cameraRig,camera=this.e.workshop.renderer.xr.getCamera();camera.getWorldPosition(this.head);const angle=-Math.sign(x)*Math.PI/6;
        rig.position.sub(this.head).applyAxisAngle(this.up,angle).add(this.head);rig.rotation.y+=angle;this.lastTurn=time;
      }
    }
  }
  update(time,dt) {
    if(this.pendingPanel>0){this.pendingPanel--;if(!this.pendingPanel)this.placePanel();}
    if(this.grab)this.updateGrab();
    let hover=null;
    for(const hand of this.hands) {
      if(!hand.source)continue;
      this.buttons(hand,time,dt);
      if(hand.sculpt){hand.grip.getWorldPosition(hand.position);this.e.shape.update(hand.position,time);}
      if(time-hand.lastRay>33||hand.ui){this.raycast(hand);hand.lastRay=time;}
      const hit=hand.menuHit||hand.hit;hand.line.scale.z=hit?.distance||2.4;hand.dot.visible=!!hit&&!hand.grabbing;
      if(hit)hand.dot.position.copy(hit.point);if(hand.menuHit)hover=hand.menuHit;
      if(hand.ui)this.panel.move(hand.index,hand.menuHit);
      if(this.e.mode==='shape'&&!this.e.shape.active&&!this.grab&&hand.hit)this.e.shape.hover(hand.hit.point,this.e.workshop.viewScale);
    }
    this.panel.hoverAt(hover);this.panel.update(time);
  }
}
