import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HistoryManager } from '../src/core/HistoryManager.js';
import { SelectionManager } from '../src/core/SelectionManager.js';
import { Events } from '../src/core/events.js';
import { canDetachSelected, detachSelected, separateLooseParts } from '../src/xr/VRQuickActions.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);

function editorFor(root,scene) {
  const asset=new Events();asset.root=root;asset.originalTransforms=new WeakMap();asset.refresh=()=>{};
  const history=new HistoryManager(),selection=new SelectionManager(asset,scene,history);
  return {asset,history,selection,xr:{lastSelectionHit:null}};
}

test('detaching a loose grouped part preserves its world pose and is undoable',()=>{
  const scene=new THREE.Scene(),root=new THREE.Group(),group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry());
  root.position.set(.4,.2,-.1);group.position.set(1,2,3);group.rotation.y=.35;mesh.position.set(.25,.5,-.4);scene.add(root);root.add(group);group.add(mesh);scene.updateMatrixWorld(true);
  const editor=editorFor(root,scene);editor.selection.select(mesh);
  const before=mesh.getWorldPosition(new THREE.Vector3());assert.equal(canDetachSelected(editor),true);assert.equal(detachSelected(editor),1);scene.updateMatrixWorld(true);
  assert.equal(mesh.parent,root);const after=mesh.getWorldPosition(new THREE.Vector3());near(after.x,before.x);near(after.y,before.y);near(after.z,before.z);assert.equal(editor.history.undoStack.length,1);
  editor.history.undo();scene.updateMatrixWorld(true);assert.equal(mesh.parent,group);const restored=mesh.getWorldPosition(new THREE.Vector3());near(restored.x,before.x);near(restored.y,before.y);near(restored.z,before.z);
});

test('detach separates disconnected islands inside one mesh into independently selectable meshes',()=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([
    0,0,0, 1,0,0, 0,1,0,
    3,0,0, 4,0,0, 3,1,0,
    6,0,0, 7,0,0, 6,1,0
  ],3));
  geometry.computeVertexNormals();
  const scene=new THREE.Scene(),root=new THREE.Group(),mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());mesh.name='Three loose bits';root.add(mesh);scene.add(root);
  const editor=editorFor(root,scene);editor.selection.select(mesh);editor.xr.lastSelectionHit={node:mesh,faceIndex:1};
  const count=separateLooseParts(editor,mesh,1);assert.equal(count,3);
  const container=root.children[0];assert.equal(container.isGroup,true);assert.equal(container.children.length,3);assert.ok(container.children.every(n=>n.isMesh));
  assert.equal(editor.selection.selected,container.children[1]);
  editor.history.undo();assert.equal(root.children[0],mesh);assert.equal(editor.selection.selected,mesh);
  editor.history.redo();assert.equal(root.children[0].children.length,3);assert.equal(editor.selection.selected,root.children[0].children[1]);
});

test('connected top-level mesh reports no separation while rigged parts remain blocked',()=>{
  const scene=new THREE.Scene(),root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry()),group=new THREE.Group(),bone=new THREE.Bone();scene.add(root);root.add(mesh,group);group.add(bone);
  const editor=editorFor(root,scene);
  editor.selection.select(mesh);assert.equal(canDetachSelected(editor),true);assert.equal(detachSelected(editor),false);
  editor.selection.select(bone);assert.equal(canDetachSelected(editor),false);
});
