import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { Events } from './events.js';
import { applyTransform, displayName, transformState } from './utils.js';

export class SelectionManager extends Events {
  constructor(asset, scene, history) {
    super(); this.asset=asset; this.scene=scene; this.history=history; this.selected=null; this.isolated=null;
    this.grouping=false;this.groupParts=new Set();this.groupBoxes=new Map();this.groupSelectionBefore=null;
    this.box=new THREE.BoxHelper(new THREE.Object3D(), '#b2e58d'); this.box.material.depthTest=false; this.box.material.transparent=true;this.box.material.opacity=.7;this.box.renderOrder=9;this.box.visible=false;scene.add(this.box);
    this.highlight=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:'#b2e58d',wireframe:true,transparent:true,opacity:.075,depthWrite:false})); this.highlight.matrixAutoUpdate=false;this.highlight.visible=false;scene.add(this.highlight);
    asset.on('beforechange',()=>{this.cancelGroup(false);this.select(null);this.isolated=null;});
  }
  select(node) { this.selected=node; this.update(); this.emit('change',node); }
  groupTarget(node) {
    let target=node;
    for(let p=node;p&&p!==this.asset.root;p=p.parent)if(p.userData.glblenderGroup)target=p;
    return target;
  }
  choose(node,direct=false) {
    const target=direct?node:this.groupTarget(node);
    if(this.grouping)return target?this.toggleGroupPart(target):false;
    this.select(target);return true;
  }
  canGroupPart(node) {
    if(!node||node===this.asset.root||!this.ancestor(node,this.asset.root)||this.isLocked(node)||!this.isVisible(node))return false;
    let blocked=false;
    node.traverse(n=>{if(n.isBone||n.isSkinnedMesh||n.userData.glblenderLocked)blocked=true;});
    for(let p=node.parent;p&&p!==this.asset.root;p=p.parent)if(p.isBone)blocked=true;
    return !blocked;
  }
  beginGroup() {
    if(this.grouping)return;
    this.groupSelectionBefore=this.selected;this.grouping=true;
    if(this.canGroupPart(this.selected))this.groupParts.add(this.selected);
    this.select(null);
  }
  isGroupPart(node) {return [...this.groupParts].some(part=>this.ancestor(node,part));}
  toggleGroupPart(node) {
    if(this.groupParts.has(node))this.groupParts.delete(node);
    else {
      if(!this.canGroupPart(node))throw new Error('Choose an unlocked part or group without rigged or locked children.');
      if(this.isGroupPart(node))return false;
      for(const part of this.groupParts)if(this.ancestor(part,node))this.groupParts.delete(part);
      this.groupParts.add(node);
    }
    this.update();this.emit('change',null);return true;
  }
  clearGroup() {
    this.grouping=false;this.groupParts.clear();this.groupSelectionBefore=null;
    for(const box of this.groupBoxes.values()){this.scene.remove(box);box.geometry.dispose();box.material.dispose();}
    this.groupBoxes.clear();
  }
  cancelGroup(restore=true) {
    if(!this.grouping)return;
    const previous=this.groupSelectionBefore;this.clearGroup();
    this.select(restore&&previous&&this.ancestor(previous,this.asset.root)?previous:null);
  }
  finishGroup() {
    const parts=[...this.groupParts];
    if(!this.grouping||parts.length<2)throw new Error('Select at least two parts, then choose Create group.');
    if(parts.some(node=>!this.canGroupPart(node)))throw new Error('A selected part is no longer available or is locked.');
    let parent=parts[0].parent;
    while(!parts.every(node=>this.ancestor(node,parent)))parent=parent.parent;
    parent.updateWorldMatrix(true,true);
    const bounds=new THREE.Box3();for(const node of parts)bounds.union(new THREE.Box3().setFromObject(node));
    const pivot=bounds.isEmpty()?new THREE.Vector3():parent.worldToLocal(bounds.getCenter(new THREE.Vector3()));
    const group=new THREE.Group(),names=new Set();this.asset.root.traverse(n=>names.add(displayName(n)));
    let number=1;while(names.has(`Group ${number}`))number++;
    group.name=`Group ${number}`;group.userData={glblenderGroup:true,glblenderSourceName:group.name};group.position.copy(pivot);group.updateMatrix();
    // Work in the common parent's coordinates so the viewing rig never enters
    // the model. Refuse a reparent that cannot preserve the existing GLTF TRS.
    const states=parts.map(node=>{
      const matrix=node.matrix.clone();
      for(let p=node.parent;p!==parent;p=p.parent)matrix.premultiply(p.matrix);
      matrix.elements[12]-=pivot.x;matrix.elements[13]-=pivot.y;matrix.elements[14]-=pivot.z;
      const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(position,quaternion,scale);
      const rebuilt=new THREE.Matrix4().compose(position,quaternion,scale),tolerance=1e-7*Math.max(1,...matrix.elements.slice(0,12).map(Math.abs));
      if(matrix.elements.some((v,i)=>!Number.isFinite(rebuilt.elements[i])||Math.abs(v-rebuilt.elements[i])>tolerance))throw new Error('These parent scales prevent grouping without distorting the parts. Choose parts from the same parent.');
      return {node,parent:node.parent,index:node.parent.children.indexOf(node),before:transformState(node),after:{position:position.toArray(),quaternion:quaternion.toArray(),scale:scale.toArray()}};
    });
    const index=Math.min(parent.children.length,...states.filter(s=>s.parent===parent).map(s=>s.index));
    const insert=(container,node,at)=>{container.add(node);container.children.splice(container.children.indexOf(node),1);container.children.splice(Math.min(at,container.children.length),0,node);};
    const beforeSelection=this.groupSelectionBefore,initial=transformState(group);this.asset.originalTransforms.set(group,initial);this.clearGroup();
    this.history.execute({
      label:`Group ${parts.length} parts`,
      bytes:256+states.length*512,
      undo:()=>{
        parent.remove(group);
        for(const state of [...states].sort((a,b)=>a.index-b.index)){insert(state.parent,state.node,state.index);applyTransform(state.node,state.before);}
        this.asset.refresh?.();this.select(beforeSelection&&this.ancestor(beforeSelection,this.asset.root)?beforeSelection:parts[0]);
      },
      redo:()=>{
        insert(parent,group,index);applyTransform(group,initial);
        for(const state of states){group.add(state.node);applyTransform(state.node,state.after);}
        this.asset.refresh?.();this.select(group);
      }
    });
    return group;
  }
  isLocked(node=this.selected) { for(let p=node;p&&p!==this.asset.root?.parent;p=p.parent)if(p.userData.glblenderLocked)return true; return false; }
  isVisible(node) { for(let p=node;p;p=p.parent)if(!p.visible)return false;return true; }
  update() {
    const node=this.selected;
    this.box.visible=!!node&&this.isVisible(node);this.highlight.visible=this.box.visible&&!!node?.isMesh&&!node.isSkinnedMesh&&!node.isInstancedMesh&&(node.geometry.index?.count??node.geometry.attributes.position.count)/3<=60000;   // a wireframe of a dense scan chunk doubles its cost every frame
    if(this.box.visible)this.box.setFromObject(node);
    if(this.highlight.visible){this.highlight.geometry=node.geometry;this.highlight.matrix.copy(node.matrixWorld);}
    for(const [part,box] of this.groupBoxes)if(!this.groupParts.has(part)){this.scene.remove(box);box.geometry.dispose();box.material.dispose();this.groupBoxes.delete(part);}
    for(const part of this.groupParts){
      let box=this.groupBoxes.get(part);
      if(!box){box=new THREE.BoxHelper(part,'#b2e58d');box.material.depthTest=false;box.renderOrder=9;this.scene.add(box);this.groupBoxes.set(part,box);}
      box.visible=this.isVisible(part);if(box.visible)box.setFromObject(part);
    }
  }
  ancestor(node,parent) { for(let p=node;p;p=p.parent)if(p===parent)return true;return false; }
  applyVisibility() {
    this.asset.root?.traverse(n=>{n.visible=!n.userData.glblenderHidden&&(!this.isolated||this.ancestor(n,this.isolated)||this.ancestor(this.isolated,n));}); this.update();
  }
  hide(node=this.selected) {
    if(!node||this.isLocked(node))return;
    const before=!!node.userData.glblenderHidden, after=!before;
    const set=v=>{node.userData.glblenderHidden=v;this.applyVisibility();};
    this.history.execute({label:`${after?'Hide':'Show'} ${displayName(node)}`,undo:()=>set(before),redo:()=>set(after)});
  }
  showAll() {
    const nodes=[]; this.asset.root?.traverse(n=>{if(n.userData.glblenderHidden)nodes.push(n);});
    this.isolated=null;
    if(nodes.length)this.history.execute({label:'Show all components',undo:()=>{for(const n of nodes)n.userData.glblenderHidden=true;this.applyVisibility();},redo:()=>{for(const n of nodes)n.userData.glblenderHidden=false;this.applyVisibility();}});
    else {this.applyVisibility();this.emit('change',this.selected);}
  }
  isolate() { if(!this.selected)return;this.isolated=this.isolated===this.selected?null:this.selected;this.applyVisibility();this.emit('change',this.selected); }
  lock(node=this.selected) { if(!node)return;const old=!!node.userData.glblenderLocked;const set=v=>{node.userData.glblenderLocked=v;};this.history.execute({label:`${old?'Unlock':'Lock'} ${displayName(node)}`,undo:()=>set(old),redo:()=>set(!old)}); }
  remove() {
    const node=this.selected;if(!node||node===this.asset.root||this.isLocked(node))return;
    const parent=node.parent,index=parent.children.indexOf(node);this.select(null);
    this.history.execute({label:`Delete ${displayName(node)}`,undo:()=>{parent.add(node);parent.children.splice(parent.children.indexOf(node),1);parent.children.splice(index,0,node);},redo:()=>{parent.remove(node);if(this.selected===node)this.select(null);}});
  }
  duplicate() {
    const node=this.selected;if(!node||node===this.asset.root||this.isLocked(node))return;
    let unsupported=false;node.traverse(n=>{if(n.isSkinnedMesh)unsupported=true;});if(unsupported)return false;
    const copy=clone(node);copy.name=`${displayName(node)} copy`;copy.userData.glblenderSourceName=copy.name;copy.position.x+=.12;copy.traverse(n=>{this.asset.originalTransforms.set(n,transformState(n));});const parent=node.parent;
    this.history.execute({label:`Duplicate ${displayName(node)}`,undo:()=>{parent.remove(copy);if(this.selected===copy)this.select(node);},redo:()=>parent.add(copy)});this.select(copy);return true;
  }
}
