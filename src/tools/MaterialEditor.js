import * as THREE from 'three';
import { materialsOf } from '../core/utils.js';

export class MaterialEditor {
  constructor(history) { this.history=history;this.active=null; }
  begin(node,index=0) {
    if(this.active?.node===node&&this.active.index===index)return;
    this.end();if(!node?.isMesh)return;
    const before=node.material, list=materialsOf(node).slice();if(!list[index])return;
    // Copy on edit. Linked materials in an imported asset never recolour siblings.
    list[index]=list[index].clone();node.material=Array.isArray(before)?list:list[0];
    this.active={node,index,before,material:list[index],changed:false};
  }
  set(node,index,key,value) {
    this.begin(node,index);const a=this.active;if(!a)return;
    let m=a.material;
    if((key==='metalness'||key==='roughness')&&!(key in m)) {
      const replacement=new THREE.MeshStandardMaterial({name:m.name,color:m.color||'#ffffff',map:m.map,side:m.side,transparent:m.transparent,opacity:m.opacity});
      if(Array.isArray(node.material))node.material[index]=replacement;else node.material=replacement;
      a.material=m=replacement;
    }
    if(key==='color'||key==='emissive') { if(!m[key])m[key]=new THREE.Color();m[key].set(value); }
    else if(key==='doubleSided')m.side=value?THREE.DoubleSide:THREE.FrontSide;
    else if(key==='opacity') {m.opacity=value;m.transparent=value<1;m.depthWrite=value>=1;}
    else m[key]=value;
    m.needsUpdate=true;a.changed=true;
  }
  end() {
    const a=this.active;if(!a)return;this.active=null;
    if(!a.changed){a.node.material=a.before;return;}
    const after=a.node.material;
    this.history.commit({label:`Edit ${a.node.name||'component'} material`,bytes:2048,undo:()=>{a.node.material=a.before;},redo:()=>{a.node.material=after;}});
  }
}
