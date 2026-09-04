import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HistoryManager } from '../src/core/HistoryManager.js';
import { SelectionManager } from '../src/core/SelectionManager.js';
import { Events } from '../src/core/events.js';
import { canDetachSelected, detachSelected } from '../src/xr/VRQuickActions.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);

test('detaching a loose grouped part preserves its world pose and is undoable',()=>{
  const scene=new THREE.Scene(),root=new THREE.Group(),group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry());
  root.position.set(.4,.2,-.1);group.position.set(1,2,3);group.rotation.y=.35;mesh.position.set(.25,.5,-.4);scene.add(root);root.add(group);group.add(mesh);scene.updateMatrixWorld(true);
  const asset=new Events();asset.root=root;asset.originalTransforms=new WeakMap();const history=new HistoryManager(),selection=new SelectionManager(asset,scene,history),editor={asset,history,selection};selection.select(mesh);
  const before=mesh.getWorldPosition(new THREE.Vector3());assert.equal(canDetachSelected(editor),true);assert.equal(detachSelected(editor),true);scene.updateMatrixWorld(true);
  assert.equal(mesh.parent,root);const after=mesh.getWorldPosition(new THREE.Vector3());near(after.x,before.x);near(after.y,before.y);near(after.z,before.z);assert.equal(history.undoStack.length,1);
  history.undo();scene.updateMatrixWorld(true);assert.equal(mesh.parent,group);const restored=mesh.getWorldPosition(new THREE.Vector3());near(restored.x,before.x);near(restored.y,before.y);near(restored.z,before.z);
});

test('top-level and rigged parts are not offered for detach',()=>{
  const scene=new THREE.Scene(),root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry()),group=new THREE.Group(),bone=new THREE.Bone();scene.add(root);root.add(mesh,group);group.add(bone);
  const asset=new Events();asset.root=root;asset.originalTransforms=new WeakMap();const history=new HistoryManager(),selection=new SelectionManager(asset,scene,history),editor={asset,history,selection};
  selection.select(mesh);assert.equal(canDetachSelected(editor),false);selection.select(bone);assert.equal(canDetachSelected(editor),false);
});