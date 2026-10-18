import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ExportManager } from '../src/core/ExportManager.js';
import { createDemo } from '../src/core/demo.js';
import { assetBounds } from '../src/core/utils.js';
import { MaterialEditor } from '../src/tools/MaterialEditor.js';
import { HistoryManager } from '../src/core/HistoryManager.js';
import { DeformationTool } from '../src/tools/DeformationTool.js';
import { AssetManager } from '../src/core/AssetManager.js';
import { EraseTool } from '../src/tools/EraseTool.js';

// The real Three exporter only needs this browser API for untextured Node tests.
globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.({target:this});}).catch(error=>this.onerror?.(error));}
  readAsDataURL(blob){blob.arrayBuffer().then(result=>{this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onloadend?.({target:this});}).catch(error=>this.onerror?.(error));}
};
const close=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-4,`${v} != ${b[i]}`));

test('edited sample GLB round-trip preserves names, hierarchy, real scale, materials and deformed vertices',async()=>{
  const scene=new THREE.Scene(),rig=new THREE.Group(),demo=createDemo(),root=demo.scene;scene.add(rig);rig.add(root);rig.scale.setScalar(.04);rig.position.set(2,3,4);
  const hull=root.getObjectByName('Hull'),history=new HistoryManager(),materials=new MaterialEditor(history),shape=new DeformationTool(history,scene);
  materials.set(hull,0,'color','#38b29e');materials.set(hull,0,'roughness',.23);materials.end();hull.position.x=.5;
  root.updateWorldMatrix(true,true);shape.axis='Z';shape.applyBend(hull,.4,.04);
  const before=assetBounds(root).getSize(new THREE.Vector3()).toArray(),vertex=hull.geometry.attributes.position.array.slice();
  const exporter=new ExportManager({root,animations:[],filename:'sample.glb'}),data=await exporter.binary();
  assert.equal(new DataView(data).getUint32(0,true),0x46546c67);assert.ok(data.byteLength>10000);
  const loaded=await new GLTFLoader().parseAsync(data,''),roundRoot=loaded.scene.children[0],roundHull=roundRoot.getObjectByName('Hull');
  assert.equal(roundRoot.userData.name,root.name);assert.equal(roundRoot.getObjectByName('EngineHousingLeft').parent.name,'EngineLeft');
  close(assetBounds(roundRoot).getSize(new THREE.Vector3()).toArray(),before);close(roundHull.geometry.attributes.position.array,vertex);
  assert.equal(roundHull.material.color.getHexString(),'38b29e');assert.ok(Math.abs(roundHull.material.roughness-.23)<1e-6);assert.ok(Math.abs(roundHull.position.x-.5)<1e-6);
});
test('hidden and isolated components survive export; editor-only viewing rig is absent',async()=>{
  const rig=new THREE.Group();rig.name='DO NOT EXPORT';const root=new THREE.Group();root.name='Asset';rig.add(root);
  const a=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()),b=a.clone();a.name='HiddenPart';b.name='IsolatedAway';a.userData.glblenderHidden=true;a.visible=false;b.userData.glblenderHidden=false;b.visible=false;root.add(a,b);
  const data=await new ExportManager({root,animations:[]}).binary(),gltf=await new GLTFLoader().parseAsync(data,'');
  assert.ok(gltf.scene.getObjectByName('HiddenPart'));assert.ok(gltf.scene.getObjectByName('IsolatedAway'));assert.equal(gltf.scene.getObjectByName('HiddenPart').userData.glblenderHidden,true);assert.equal(gltf.scene.getObjectByName('DO NOT EXPORT'),undefined);
});
test('export keeps a skeletal hierarchy and animation tracks',async()=>{
  const root=new THREE.Group();root.name='RigAsset';const geometry=new THREE.BoxGeometry(1,2,1),count=geometry.attributes.position.count;
  const indices=new Uint16Array(count*4),weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshStandardMaterial());mesh.name='Character';const bone=new THREE.Bone();bone.name='RootBone';mesh.add(bone);mesh.bind(new THREE.Skeleton([bone]));root.add(mesh);
  const clip=new THREE.AnimationClip('Motion',1,[new THREE.VectorKeyframeTrack('RootBone.position',[0,1],[0,0,0,0,1,0])]);
  const data=await new ExportManager({root,animations:[clip]}).binary(),loaded=await new GLTFLoader().parseAsync(data,'');
  assert.equal(loaded.animations.length,1);assert.equal(loaded.animations[0].name,'Motion');assert.equal(loaded.scene.getObjectByName('Character').isSkinnedMesh,true);assert.ok(loaded.scene.getObjectByName('RootBone'));
});

test('original names with spaces survive repeated import/export without breaking animation',async()=>{
  const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());root.name='Test';mesh.name='Main_Hull';mesh.userData.name='Main Hull';root.add(mesh);
  const clip=new THREE.AnimationClip('Flight',1,[new THREE.VectorKeyframeTrack('Main_Hull.position',[0,1],[0,0,0,1,0,0])]);
  const one=await new ExportManager({root,animations:[clip]}).binary(),parsed=await new GLTFLoader().parseAsync(one,'');
  const two=await new ExportManager({root:parsed.scene,animations:parsed.animations}).binary(),result=await new GLTFLoader().parseAsync(two,'');
  assert.equal(result.scene.getObjectByName('Main_Hull').userData.name,'Main Hull');assert.equal(result.animations[0].tracks.length,1);
});

test('repeated editor save/load keeps the scene hierarchy and shared material count stable',async()=>{
  const sample=createDemo(),history=new HistoryManager(),materials=new MaterialEditor(history);materials.set(sample.scene.getObjectByName('Hull'),0,'color','#41bca5');materials.end();
  let asset={root:sample.scene,animations:[]},nodeCount=null;
  for(let i=0;i<4;i++){
    const data=await new ExportManager(asset).binary(),parsed=await new GLTFLoader().parseAsync(data,'');
    asset=new AssetManager(new THREE.Group(),null);asset.setAsset(parsed,'sample.glb');
    let count=0;asset.root.traverse(()=>count++);nodeCount??=count;assert.equal(count,nodeCount);assert.equal(asset.info.materials,6);
  }
  asset.root.position.x=2;
  const transformed=await new GLTFLoader().parseAsync(await new ExportManager(asset).binary(),'');
  assert.ok(Math.abs(assetBounds(transformed.scene).min.x-assetBounds(asset.root).min.x)<1e-5,'A transformed scene container must retain its whole-asset transform');
});


test('GLB export permanently compacts erased triangles and unused vertices; Undo remains reversible', async () => {
  const root = new THREE.Group(), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    10, 0, 0, 11, 0, 0, 10, 1, 0,
    99, 99, 99 // Unused vertex should not appear in the compacted export.
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1,
    .2, .3, .8, .3, .2, .9,
    0, 0
  ], 2));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  const materials = [new THREE.MeshStandardMaterial({color: '#ff0000'}), new THREE.MeshStandardMaterial({color: '#00ff00'})];
  const mesh = new THREE.Mesh(geometry, materials); root.add(mesh); root.updateMatrixWorld(true);
  const asset = { root, meshes: [mesh], animations: [], on() {} }, history = new HistoryManager();
  const shape = { kind: 'erase', radius: .75, hover() {}, brush: { visible: false } };
  const eraser = new EraseTool(history, asset, shape);
  const original = Array.from(geometry.index.array);
  assert.ok(eraser.begin(new THREE.Vector3(.3, .3, 0), 1)); eraser.end();
  assert.equal(geometry.index.count, 6, 'Editable source retains original topology for undo');
  const exported = await new ExportManager(asset, eraser).binary();
  const imported = await new GLTFLoader().parseAsync(exported, '');
  const loaded = []; imported.scene.traverse(n => { if (n.isMesh) loaded.push(n); });
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].geometry.index.count, 3, 'Only one surviving triangle in exported GLB');
  assert.equal(loaded[0].geometry.attributes.position.count, 3, 'Unreferenced vertices are removed');
  assert.deepEqual(Array.from(loaded[0].geometry.attributes.uv.array), [.2, .3, .8, .3, .2, .9].map(Math.fround));
  assert.ok(Math.abs(loaded[0].material.color.g - 1) < .0001, 'Second material group survives');
  history.undo(); assert.deepEqual(Array.from(geometry.index.array), original);
  history.redo(); assert.equal(geometry.index.array[1], geometry.index.array[0]);
});
