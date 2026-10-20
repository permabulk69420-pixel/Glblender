import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Events } from '../src/core/events.js';
import { HistoryManager } from '../src/core/HistoryManager.js';
import { SelectionManager } from '../src/core/SelectionManager.js';
import { ExportManager } from '../src/core/ExportManager.js';
import { transformState } from '../src/core/utils.js';

globalThis.FileReader=class{
  readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.({target:this});});}
};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const sameMatrix=(a,b)=>a.elements.forEach((v,i)=>near(v,b.elements[i]));
const mesh=name=>{const n=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());n.name=name;return n;};
function setup() {
  const scene=new THREE.Scene(),view=new THREE.Group(),root=new THREE.Group();scene.add(view);view.add(root);
  const asset=new Events();Object.assign(asset,{root,animations:[],originalTransforms:new WeakMap()});
  const history=new HistoryManager(),selection=new SelectionManager(asset,scene,history);
  return {scene,view,root,asset,history,selection};
}

test('group selection toggles parts and cancel changes no transforms or history',()=>{
  const {scene,root,selection:s,history}=setup(),a=mesh('A'),b=mesh('B');root.add(a,b);b.position.x=2;
  s.select(a);const before=transformState(a);s.beginGroup();
  assert.equal(s.selected,null);assert.deepEqual([...s.groupParts],[a]);assert.equal(s.groupBoxes.size,1);
  s.choose(b);assert.equal(s.groupParts.size,2);s.choose(null);assert.equal(s.groupParts.size,2);
  s.choose(a);assert.deepEqual([...s.groupParts],[b]);s.choose(a);assert.equal(s.groupBoxes.size,2);
  const helpers=[...s.groupBoxes.values()];s.cancelGroup();
  assert.equal(s.selected,a);assert.equal(s.grouping,false);assert.equal(s.groupBoxes.size,0);
  assert.ok(helpers.every(box=>!scene.children.includes(box)));assert.deepEqual(transformState(a),before);
  assert.deepEqual(root.children,[a,b]);assert.equal(history.canUndo,false);
});

test('grouping across nested parents preserves poses, materials and order through undo/redo',()=>{
  const {scene,view,root,selection:s,history}=setup(),left=new THREE.Group(),right=new THREE.Group();
  const a=mesh('A'),b=mesh('B'),c=mesh('Untouched'),d=mesh('Also untouched');
  view.position.set(4,2,-3);view.scale.setScalar(.035);view.rotation.y=.4;
  root.position.set(.3,.8,-.2);left.position.set(2,1,-1);left.rotation.z=.3;right.rotation.y=-.7;
  a.position.set(1,.3,-.8);a.scale.set(2,.5,1);b.position.set(-2,1,.4);b.rotation.x=.8;
  root.add(left,c,right,d);left.add(a);right.add(b);scene.updateMatrixWorld(true);
  const aw=a.matrixWorld.clone(),bw=b.matrixWorld.clone(),cw=c.matrixWorld.clone();
  const originalA=transformState(a),originalB=transformState(b),geometry=a.geometry,material=a.material;
  s.select(a);s.beginGroup();s.choose(b);const group=s.finishGroup();scene.updateMatrixWorld(true);
  assert.equal(group.parent,root);assert.equal(s.selected,group);assert.equal(s.grouping,false);
  assert.equal(a.parent,group);assert.equal(b.parent,group);sameMatrix(a.matrixWorld,aw);sameMatrix(b.matrixWorld,bw);sameMatrix(c.matrixWorld,cw);
  assert.equal(a.geometry,geometry);assert.equal(a.material,material);assert.equal(history.undoStack.length,1);
  s.choose(a);assert.equal(s.selected,group);s.choose(a,true);assert.equal(s.selected,a);
  history.undo();scene.updateMatrixWorld(true);
  assert.deepEqual(root.children,[left,c,right,d]);assert.deepEqual(left.children,[a]);assert.deepEqual(right.children,[b]);
  assert.deepEqual(transformState(a),originalA);assert.deepEqual(transformState(b),originalB);
  sameMatrix(a.matrixWorld,aw);sameMatrix(b.matrixWorld,bw);assert.equal(s.selected,a);
  history.redo();scene.updateMatrixWorld(true);sameMatrix(a.matrixWorld,aw);sameMatrix(b.matrixWorld,bw);assert.equal(s.selected,group);
});

test('moving the group moves every member once, leaving other parts still, and is undoable',()=>{
  const {root,selection:s,history}=setup(),a=mesh('A'),b=mesh('B'),c=mesh('C');root.add(a,c,b);b.position.x=4;
  s.beginGroup();s.choose(a);s.choose(b);const group=s.finishGroup();
  const before=transformState(group),aBefore=a.getWorldPosition(new THREE.Vector3()),bBefore=b.getWorldPosition(new THREE.Vector3());
  group.position.add(new THREE.Vector3(3,2,-1));group.updateMatrix();history.transform(group,before,transformState(group));
  for(const [part,p] of [[a,aBefore],[b,bBefore]]){const moved=part.getWorldPosition(new THREE.Vector3()).sub(p);near(moved.x,3);near(moved.y,2);near(moved.z,-1);}
  near(c.getWorldPosition(new THREE.Vector3()).length(),0);history.undo();near(a.getWorldPosition(new THREE.Vector3()).distanceTo(aBefore),0);
  history.undo();assert.deepEqual(root.children,[a,c,b]);history.redo();history.redo();near(b.getWorldPosition(new THREE.Vector3()).x,bBefore.x+3);
});

test('parent and child selections never apply grouping twice; root, locked and rigged nodes are blocked',()=>{
  const {root,selection:s}=setup(),parent=new THREE.Group(),a=mesh('A'),b=mesh('B');root.add(parent,b);parent.add(a);
  s.beginGroup();s.choose(a,true);s.choose(parent,true);assert.deepEqual([...s.groupParts],[parent]);s.choose(a,true);assert.deepEqual([...s.groupParts],[parent]);
  assert.throws(()=>s.choose(root,true),/unlocked/);a.userData.glblenderLocked=true;assert.equal(s.canGroupPart(parent),false);
  assert.throws(()=>s.finishGroup(),/at least two/);a.userData.glblenderLocked=false;
  const rig=new THREE.Group();rig.add(new THREE.Bone());root.add(rig);assert.equal(s.canGroupPart(rig),false);
  assert.equal(s.canGroupPart(new THREE.Group()),false);s.cancelGroup();
});

test('incompatible nested scales cannot distort parts; same-parent nonuniform scales work',()=>{
  const {root,selection:s,history}=setup(),parent=new THREE.Group(),a=mesh('A'),b=mesh('B'),c=mesh('C');
  root.add(parent,b);parent.add(a,c);parent.scale.set(2,1,.5);a.rotation.z=.8;
  s.beginGroup();s.choose(a);s.choose(b);const before=transformState(a);
  assert.throws(()=>s.finishGroup(),/without distorting/);assert.equal(a.parent,parent);assert.equal(b.parent,root);assert.deepEqual(transformState(a),before);assert.equal(history.canUndo,false);
  s.cancelGroup();s.beginGroup();s.choose(a);s.choose(c);const group=s.finishGroup();assert.equal(group.parent,parent);assert.equal(a.parent,group);
});

test('GLB roundtrip retains the group, member transforms and group selection metadata',async()=>{
  const {root,asset,selection:s}=setup(),a=mesh('A'),b=mesh('B');root.add(a,b);b.position.set(4,1,-2);
  s.beginGroup();s.choose(a);s.choose(b);const group=s.finishGroup();group.position.x+=2;
  root.updateMatrixWorld(true);const aw=a.matrixWorld.clone(),bw=b.matrixWorld.clone();
  const binary=await new ExportManager(asset).binary(),loaded=await new GLTFLoader().parseAsync(binary,'');loaded.scene.updateMatrixWorld(true);
  let exported;loaded.scene.traverse(n=>{if(n.userData.glblenderSourceName===group.name)exported=n;});assert.ok(exported?.userData.glblenderGroup);assert.equal(exported.children.length,2);
  sameMatrix(loaded.scene.getObjectByName('A').matrixWorld,aw);sameMatrix(loaded.scene.getObjectByName('B').matrixWorld,bw);
  const next=new Events();next.root=loaded.scene;const selection=new SelectionManager(next,new THREE.Scene(),new HistoryManager());selection.choose(exported.children[0]);assert.equal(selection.selected,exported);
});
