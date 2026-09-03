import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VRInteractionManager } from '../src/xr/VRInteractionManager.js';
import { HistoryManager } from '../src/core/HistoryManager.js';
import { SelectionManager } from '../src/core/SelectionManager.js';
import { MaterialEditor } from '../src/tools/MaterialEditor.js';
import { Events } from '../src/core/events.js';
import { transformState } from '../src/core/utils.js';

// Synthetic poses exercise the production XR event handlers. This verifies
// controller mathematics and history, not headset rendering or ergonomics.
const context=new Proxy({createLinearGradient:()=>({addColorStop(){}})}, {get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const same=(a,b)=>{for(const key of ['position','quaternion','scale'])a[key].forEach((v,i)=>near(v,b[key][i]));};

function setup() {
  const scene=new THREE.Scene(),rig=new THREE.Group(),presentation=new THREE.Group(),root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());scene.add(rig,presentation);presentation.scale.setScalar(.3);presentation.position.set(0,.8,-1.2);presentation.add(root);root.add(mesh);mesh.name='Part';mesh.position.set(.4,.8,-.5);
  const controllers=[new THREE.Group(),new THREE.Group()],grips=[new THREE.Group(),new THREE.Group()],camera=new THREE.PerspectiveCamera();rig.add(camera);
  const xr=new THREE.EventDispatcher();xr.getController=i=>controllers[i];xr.getControllerGrip=i=>grips[i];xr.getCamera=()=>camera;
  const asset=new Events();Object.assign(asset,{root,meshes:[mesh],nodes:[mesh],filename:'test.glb',originalTransforms:new WeakMap()});
  const history=new HistoryManager(),selection=new SelectionManager(asset,scene,history),materials=new MaterialEditor(history);
  const e={asset,history,selection,materials,mode:'object',constraint:'FREE',snap:false,busy:false,interacting:false,shape:{active:null,radius:.5,strength:1,falloff:1,kind:'pull',axis:'Y'},workshop:{scene,cameraRig:rig,renderer:{xr},viewScale:.3,viewMode:'tabletop'},ui:{materialIndex:0,renderInspector(){},renderTree(){},renderToolbar(){}},transform:{setConstraint(){}},setMode(mode){this.mode=mode;},setMaterial(key,v,commit){materials.set(selection.selected,0,key,v);if(commit)materials.end();},action(action){if(this.interacting)return;if(action==='undo')history.undo();if(action==='redo')history.redo();}};
  const manager=new VRInteractionManager(e);e.xr=manager;
  selection.select(mesh);grips[0].position.set(-.25,1,0);grips[1].position.set(.25,1,0);scene.updateMatrixWorld(true);
  return{e,manager,mesh,grips,scene,history};
}

test('one-hand Quest grip preserves offset and creates exactly one undo on release',()=>{
  const {manager,mesh,grips,scene,history}=setup(),before=transformState(mesh),world=mesh.getWorldPosition(new THREE.Vector3());
  manager.squeeze(manager.hands[0]);grips[0].position.x+=.18;scene.updateMatrixWorld(true);manager.updateGrab();const moved=mesh.getWorldPosition(new THREE.Vector3());near(moved.x,world.x+.18);near(moved.y,world.y);
  assert.equal(history.canUndo,false);manager.release(manager.hands[0]);assert.equal(history.undoStack.length,1);history.undo();same(transformState(mesh),before);
});
test('adding and releasing the second controller does not jump; the full grab remains one edit',()=>{
  const {manager,mesh,grips,scene,history}=setup(),original=transformState(mesh);
  manager.squeeze(manager.hands[0]);grips[0].position.y+=.1;scene.updateMatrixWorld(true);manager.updateGrab();const single=transformState(mesh);
  manager.squeeze(manager.hands[1]);manager.updateGrab();same(transformState(mesh),single);
  grips[0].position.x-=.15;grips[1].position.x+=.15;scene.updateMatrixWorld(true);manager.updateGrab();assert.ok(mesh.scale.x>1.4);const both=transformState(mesh);
  manager.release(manager.hands[0]);manager.updateGrab();same(transformState(mesh),both);
  grips[1].position.y+=.1;scene.updateMatrixWorld(true);manager.updateGrab();manager.release(manager.hands[1]);assert.equal(history.undoStack.length,1);history.undo();same(transformState(mesh),original);
});
test('locked components cannot be grabbed and axis constraints project movement predictably',()=>{
  const {e,manager,mesh,grips,scene}=setup();mesh.userData.glblenderLocked=true;manager.squeeze(manager.hands[0]);assert.equal(manager.grab,null);
  mesh.userData.glblenderLocked=false;e.constraint='X';const before=mesh.position.clone();manager.squeeze(manager.hands[0]);grips[0].position.add(new THREE.Vector3(.15,.3,0));scene.updateMatrixWorld(true);manager.updateGrab();near(mesh.position.x,before.x+.5);near(mesh.position.y,before.y);manager.release(manager.hands[0]);
});
test('Quest A and B are edge-triggered undo and redo controls',()=>{
  const {e,manager,mesh,history}=setup(),before=transformState(mesh);mesh.position.x+=1;history.transform(mesh,before,transformState(mesh));
  const hand=manager.hands[1],buttons=Array.from({length:6},()=>({pressed:false}));hand.source={handedness:'right',gamepad:{buttons,axes:[0,0,0,0]}};
  buttons[4].pressed=true;manager.buttons(hand,1000,.016);near(mesh.position.x,before.position[0]);manager.buttons(hand,1016,.016);assert.equal(history.redoStack.length,1);
  buttons[4].pressed=false;buttons[5].pressed=true;manager.buttons(hand,1032,.016);near(mesh.position.x,before.position[0]+1);
});
test('VR material slider uses one undo step and blocks conflicting grabs',()=>{
  const {e,manager,mesh,history}=setup();manager.panel.tab='material';manager.panel.draw();const panel=manager.panel,region=panel.regions.find(r=>r.id==='rough');
  const hit=x=>({uv:new THREE.Vector2(x/768,1-(region.y+region.h/2)/1060)});
  panel.down(0,hit(region.x+region.w*.2));assert.equal(e.interacting,true);manager.squeeze(manager.hands[1]);assert.equal(manager.grab,null);
  panel.move(0,hit(region.x+region.w*.35));panel.up(0);near(mesh.material.roughness,.35);assert.equal(history.undoStack.length,1);assert.equal(e.interacting,false);history.undo();near(mesh.material.roughness,1);
});
