import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import * as WebGLTextureUtils from 'three/addons/utils/WebGLTextureUtils.js';
import { PropertyBinding } from 'three';
import { downloadBlob } from './utils.js';

export class ExportManager {
  constructor(asset) {this.asset=asset;}
  async binary({includeHidden=true}={}) {
    if(!this.asset.root)throw new Error('Import a model first.');
    // Export only the asset, never the workshop or the tabletop-scale rig.
    // A snapshot also prevents autosave racing against the next editing gesture.
    const source=this.asset.root,root=clone(source),from=[],to=[],uuidMap=new Map(),geometries=new Set();
    source.traverse(n=>from.push(n));root.traverse(n=>to.push(n));
    to.forEach((n,i)=>{
      uuidMap.set(from[i].uuid,n.uuid);n.visible=!n.userData.glblenderHidden;
      // GLTFLoader sanitizes names for animation bindings. Restore the source
      // names in exported nodes and target animation tracks by cloned UUID.
      n.name=n.userData.glblenderSourceName??n.userData.name??n.name;
      if(n.isLight&&n.userData.glblenderLightIntensity!==undefined)n.intensity=n.userData.glblenderLightIntensity;
      if(n.geometry){n.geometry=n.geometry.clone();geometries.add(n.geometry);}
      // GLB visibility is editor metadata; isolated parts must not disappear.
      if(n.material)n.material=Array.isArray(n.material)?n.material.map(m=>m.clone()):n.material.clone();
    });
    const animations=this.asset.animations.map(clip=>{
      const c=clip.clone();c.tracks=c.tracks.filter(track=>{
        const parsed=PropertyBinding.parseTrackName(track.name),node=PropertyBinding.findNode(source,parsed.nodeName);
        if(!node)return false;
        const next=uuidMap.get(node.uuid);
        if(next&&parsed.nodeName&&track.name.startsWith(parsed.nodeName+'.'))track.name=next+track.name.slice(parsed.nodeName.length);
        return true;
      });return c;
    }).filter(c=>c.tracks.length);
    const exporter=new GLTFExporter().setTextureUtils(WebGLTextureUtils);
    try{return await exporter.parseAsync(root,{binary:true,onlyVisible:!includeHidden,animations,trs:true});}
    finally{for(const g of geometries)g.dispose();root.traverse(n=>{for(const m of Array.isArray(n.material)?n.material:n.material?[n.material]:[])m.dispose();});}
  }
  async download(options={}) {
    const data=await this.binary(options),name=this.asset.filename.replace(/\.(glb|gltf)$/i,'').replace(/-edited$/i,'')||'asset';
    downloadBlob(new Blob([data],{type:'model/gltf-binary'}),`${name}-edited.glb`);return data.byteLength;
  }
}
