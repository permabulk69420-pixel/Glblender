import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HistoryManager } from '../src/core/HistoryManager.js';
import { MaterialEditor } from '../src/tools/MaterialEditor.js';
import { DeformationTool } from '../src/tools/DeformationTool.js';
import { smoothFalloff, bendPoint } from '../src/tools/deformationMath.js';
import { twoHandMatrix } from '../src/xr/manipulation.js';
import { assetBounds, transformState, applyTransform } from '../src/core/utils.js';
import { SelectionManager } from '../src/core/SelectionManager.js';
import { Events } from '../src/core/events.js';

const near=(a,b,epsilon=1e-5)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
const nearVector=(a,b,epsilon)=>a.toArray().forEach((v,i)=>near(v,b.getComponent(i),epsilon));

test('history stores one meaningful transform and branches correctly after undo',()=>{
  const h=new HistoryManager(),n=new THREE.Object3D(),a=transformState(n);n.position.x=2;const b=transformState(n);h.transform(n,a,b);
  assert.equal(h.undoStack.length,1);h.undo();near(n.position.x,0);h.redo();near(n.position.x,2);
  h.undo();n.position.y=3;h.transform(n,a,transformState(n));assert.equal(h.canRedo,false);h.undo();near(n.position.y,0);
});
test('history bounds retained operation memory',()=>{
  const h=new HistoryManager({maxBytes:1024});for(let i=0;i<10;i++)h.commit({label:'edit',bytes:512,undo(){},redo(){}});
  assert.equal(h.undoStack.length,2);assert.equal(h.bytes,1024);
});
test('a shared material and other slots remain unchanged; continuous edit is one undo',()=>{
  const material=new THREE.MeshStandardMaterial({color:'#ff0000',metalness:.4}),other=new THREE.MeshStandardMaterial({color:'#ffffff'});
  const a=new THREE.Mesh(new THREE.BoxGeometry(),[material,other]),b=new THREE.Mesh(a.geometry,material),h=new HistoryManager(),editor=new MaterialEditor(h);
  editor.set(a,0,'color','#00ff00');editor.set(a,0,'roughness',.13);editor.end();
  assert.equal(b.material,material);assert.equal(b.material.color.getHexString(),'ff0000');assert.equal(a.material[1],other);assert.equal(a.material[0].color.getHexString(),'00ff00');assert.equal(h.undoStack.length,1);
  h.undo();assert.equal(a.material[0],material);h.redo();near(a.material[0].roughness,.13);
});
test('soft falloff is smooth, monotonic and bounded at centre and edge',()=>{
  near(smoothFalloff(0,2),1);near(smoothFalloff(2,2),0);near(smoothFalloff(3,2),0);
  assert.ok(smoothFalloff(.5,2)>smoothFalloff(1,2));near(smoothFalloff(1,2),.5);
});
test('world-space soft pull is accurate under tabletop and non-uniform component scales',()=>{
  const scene=new THREE.Scene(),rig=new THREE.Group();scene.add(rig);rig.scale.setScalar(.2);
  const geo=new THREE.BoxGeometry(1,1,1,8,8,8),mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial());mesh.scale.set(1,2,.5);mesh.rotation.y=.3;rig.add(mesh);scene.updateMatrixWorld(true);
  const h=new HistoryManager(),tool=new DeformationTool(h,scene);tool.radius=2;
  const local=new THREE.Vector3().fromBufferAttribute(geo.attributes.position,0),point=mesh.localToWorld(local.clone()),beforeWorld=point.clone();
  assert.ok(tool.begin(mesh,point,point,.2));const handle=point.clone().add(new THREE.Vector3(.06,.03,-.02));tool.update(handle,100);tool.end();
  const afterWorld=mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,0));nearVector(afterWorld,beforeWorld.clone().add(new THREE.Vector3(.06,.03,-.02)));
  assert.notEqual(mesh.geometry,geo);assert.equal(h.undoStack.length,1);h.undo();nearVector(mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,0)),beforeWorld);h.redo();nearVector(mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,0)),afterWorld);
});
test('deforming a duplicate geometry cannot damage its sibling, and cancel restores the stroke',()=>{
  const scene=new THREE.Scene(),geometry=new THREE.SphereGeometry(1,16,12),a=new THREE.Mesh(geometry),b=new THREE.Mesh(geometry);scene.add(a,b);b.position.x=3;scene.updateMatrixWorld(true);
  const h=new HistoryManager(),tool=new DeformationTool(h,scene),saved=new Float32Array(geometry.attributes.position.array),point=new THREE.Vector3(0,1,0);tool.radius=2;
  tool.begin(a,point,point);tool.update(point.clone().add(new THREE.Vector3(0,1,0)),100);tool.end(true);
  assert.deepEqual(b.geometry.attributes.position.array,saved);assert.deepEqual(a.geometry.attributes.position.array,saved);assert.equal(h.canUndo,false);
});
test('shape editing preserves UVs, index topology and a distant region outside the brush',()=>{
  const scene=new THREE.Scene(),m=new THREE.Mesh(new THREE.PlaneGeometry(4,4,16,16)),h=new HistoryManager(),t=new DeformationTool(h,scene);scene.add(m);scene.updateMatrixWorld(true);t.radius=.5;
  const uv=m.geometry.attributes.uv.array.slice(),index=m.geometry.index.array.slice(),far=new THREE.Vector3().fromBufferAttribute(m.geometry.attributes.position,0);
  t.begin(m,new THREE.Vector3(),new THREE.Vector3());t.update(new THREE.Vector3(0,0,.3),100);t.end();
  assert.deepEqual(m.geometry.attributes.uv.array,uv);assert.deepEqual(m.geometry.index.array,index);nearVector(new THREE.Vector3().fromBufferAttribute(m.geometry.attributes.position,0),far);
});
test('bend is identity at zero and keeps the minimum end of the neutral axis anchored',()=>{
  const out=new Float64Array(3);bendPoint(1,2,3,1,0,0,5,0,out);assert.deepEqual([...out],[1,2,3]);
  bendPoint(0,0,0,1,Math.PI/2,0,2,0,out);nearVector(new THREE.Vector3(...out),new THREE.Vector3());
  bendPoint(0,2,0,1,Math.PI/2,0,2,0,out);near(out[1],4/Math.PI);near(out[2],-4/Math.PI);
});
test('bend operation has finite normals and is exactly undoable',()=>{
  const scene=new THREE.Scene(),m=new THREE.Mesh(new THREE.BoxGeometry(.2,3,.2,2,30,2)),h=new HistoryManager(),t=new DeformationTool(h,scene);scene.add(m);scene.updateMatrixWorld(true);
  const original=m.geometry.attributes.position.array.slice();t.axis='Y';t.applyBend(m,Math.PI/2);assert.ok(m.geometry.attributes.position.array.some((v,i)=>Math.abs(v-original[i])>.01));assert.ok(m.geometry.attributes.normal.array.every(Number.isFinite));h.undo();assert.deepEqual(m.geometry.attributes.position.array,original);h.redo();assert.ok(m.geometry.attributes.position.array.every(Number.isFinite));
});
test('two-hand transformation scales and rotates about the hand midpoint',()=>{
  const world=new THREE.Matrix4().makeTranslation(0,0,1),mid=new THREE.Vector3(),vector=new THREE.Vector3(2,0,0);
  const {matrix,ratio}=twoHandMatrix(world,mid,vector,new THREE.Vector3(0,-2,0),new THREE.Vector3(0,2,0));near(ratio,2);
  const point=new THREE.Vector3().applyMatrix4(matrix);nearVector(point,new THREE.Vector3(0,0,2));
  const transformed=new THREE.Vector3(1,0,0).applyMatrix4(matrix);nearVector(transformed,new THREE.Vector3(0,2,2));
});
test('tabletop rig does not enter asset bounds or change source transforms',()=>{
  const world=new THREE.Scene(),presentation=new THREE.Group(),root=new THREE.Group(),m=new THREE.Mesh(new THREE.BoxGeometry(8,2,4));world.add(presentation);presentation.add(root);root.add(m);root.position.y=4;
  presentation.position.set(20,30,40);presentation.scale.setScalar(.02);const before=transformState(root),bounds=assetBounds(root);nearVector(bounds.getSize(new THREE.Vector3()),new THREE.Vector3(8,2,4));assert.deepEqual(transformState(root),before);
});
test('selection isolation does not overwrite visibility state, and deletion is reversible',()=>{
  const scene=new THREE.Scene(),root=new THREE.Group(),a=new THREE.Mesh(new THREE.BoxGeometry()),b=new THREE.Mesh(new THREE.BoxGeometry());root.add(a,b);scene.add(root);
  const asset=new Events();asset.root=root;asset.originalTransforms=new WeakMap();const history=new HistoryManager(),s=new SelectionManager(asset,scene,history);s.select(a);s.isolate();assert.equal(b.visible,false);assert.equal(b.userData.glblenderHidden,undefined);s.isolate();assert.equal(b.visible,true);
  s.hide();assert.equal(a.visible,false);history.undo();assert.equal(a.visible,true);s.remove();assert.equal(root.children.includes(a),false);history.undo();assert.equal(root.children[0],a);
});
