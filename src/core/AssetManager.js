import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Events } from './events.js';
import { assetBounds, materialsOf, transformState, disposeTree } from './utils.js';

export class AssetManager extends Events {
  constructor(presentation, renderer) {
    super(); this.presentation = presentation; this.renderer = renderer; this.root = null; this.animations = []; this.filename = ''; this.nodes = []; this.meshes = []; this.originalTransforms = new WeakMap(); this.serial = 0;
  }
  async loadFiles(files) {
    const list = Array.from(files), primary = list.find(f => /\.(glb|gltf)$/i.test(f.name));
    if (!primary) throw new Error('Choose a .glb, or a .gltf together with its .bin and texture files.');
    const urls = new Map(), basename = new Map();
    const createdURLs=[];
    const normalize = s => decodeURIComponent(s).replace(/\\/g,'/').replace(/^\.\//,'');
    for (const f of list) {
      const url = URL.createObjectURL(f), path = normalize(f.webkitRelativePath || f.name);
      createdURLs.push(url);
      if (urls.has(path)) urls.set(path, null); else urls.set(path, url);
      if (basename.has(f.name)) basename.set(f.name, null); else basename.set(f.name, url);
    }
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => {
      if (/^(blob:|data:)/i.test(url)) return url;
      const path = normalize(url), match = urls.get(path) || basename.get(path.split('/').pop());
      if (match) return match;
      throw new Error(`Missing local resource: ${path}. Import the .gltf, .bin and textures together, or use a self-contained GLB.`);
    });
    try { return await this.parse(await primary.arrayBuffer(), primary.name, manager); }
    finally { for (const url of createdURLs) URL.revokeObjectURL(url); }
  }
  async parse(buffer, filename = 'asset.glb', manager = new THREE.LoadingManager()) {
    const loader = new GLTFLoader(manager);
    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}decoders/draco/`);
    const ktx = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}decoders/basis/`).detectSupport(this.renderer);
    loader.setDRACOLoader(draco).setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
    // Plain .gltf text and GLB are both accepted by parseAsync(ArrayBuffer).
    try { const gltf = await loader.parseAsync(buffer, ''); this.setAsset(gltf, filename); return gltf; }
    finally { draco.dispose(); ktx.dispose(); }
  }
  setAsset(gltf, filename) {
    let hasMesh=false;gltf.scene?.traverse(n=>{if(n.isMesh&&n.geometry?.attributes.position)hasMesh=true;});
    if(!hasMesh)throw new Error('This asset contains no editable mesh geometry.');
    this.emit('beforechange');
    const old = this.root;
    if (old) { this.presentation.remove(old); disposeTree(old); }
    this.root = gltf.scene; this.animations = gltf.animations || []; this.filename = filename; this.serial++;
    if(gltf.parser)this.root.userData.glblenderSceneRoot=true;
    // Embedded cameras and lights are preserved, but cannot replace workshop lighting.
    this.root.traverse(node => {
      node.userData.glblenderSourceName ??= node.userData.name ?? node.name;
      if (node.isLight) { node.userData.glblenderLightIntensity ??= node.intensity; node.intensity = 0; }
      node.userData.glblenderHidden ??= !node.visible;
      node.userData.glblenderLocked ??= false;
      node.visible = !node.userData.glblenderHidden;
      this.originalTransforms.set(node, transformState(node));
      if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; node.frustumCulled = true; }
    });
    this.presentation.add(this.root); this.refresh(); this.emit('loaded', this.info);
  }
  refresh() {
    this.nodes = []; this.meshes = [];
    this.root?.traverse(node => { if (node === this.root) return; this.nodes.push(node); if (node.isMesh) this.meshes.push(node); });
    if (this.root?.isMesh) this.meshes.unshift(this.root);
    this.inspect();
  }
  inspect() {
    if (!this.root) return;
    const mats = new Set(); let triangles = 0, vertices = 0, unnamed = 0, dense = 0, nonUniform = 0, skinned = 0;
    for (const m of this.meshes) {
      const p = m.geometry.attributes.position;
      vertices += p?.count || 0; triangles += (m.geometry.index?.count || p?.count || 0) / 3;
      for (const mat of materialsOf(m)) mats.add(mat);
      if (!m.name) unnamed++; if (p?.count > 100000) dense++; if (m.isSkinnedMesh || m.isInstancedMesh || Object.keys(m.geometry.morphAttributes || {}).length) skinned++;
      if (Math.abs(m.scale.x-m.scale.y) > .001 || Math.abs(m.scale.y-m.scale.z) > .001) nonUniform++;
    }
    const bounds = assetBounds(this.root), size = bounds.getSize(new THREE.Vector3());
    const warnings = [];
    if (dense) warnings.push(`${dense} dense mesh${dense>1?'es':''}: soft edits may be slower. Isolate a component first.`);
    if (triangles > 500000) warnings.push('High triangle count for standalone VR. Consider simplifying this asset.');
    if (this.meshes.length === 1) warnings.push('One merged mesh. Shape tools work, but parts cannot be selected separately.');
    if (unnamed) warnings.push(`${unnamed} unnamed meshes. Rename components for easier selection.`);
    if (mats.size > 64) warnings.push('Many materials can increase draw calls in VR.');
    if (skinned) warnings.push('Rigged, instanced and morph-target meshes support viewing/material edits; shape tools require a static mesh.');
    if (size.length() > 1000 || size.length() < .01) warnings.push('Unusual scale. glTF assumes metres; check the dimensions before exporting.');
    this.info = { triangles: Math.round(triangles), vertices, meshes: this.meshes.length, materials: mats.size, animations: this.animations.length, bounds, size, nonUniform, warnings };
    return this.info;
  }
  getNode(uuid) { return this.root?.uuid === uuid ? this.root : this.nodes.find(n => n.uuid === uuid); }
}
