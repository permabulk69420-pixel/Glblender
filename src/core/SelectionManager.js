import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { Events } from './events.js';
import { displayName, transformState } from './utils.js';

export class SelectionManager extends Events {
  constructor(asset, scene, history) {
    super(); this.asset=asset; this.scene=scene; this.history=history; this.selected=null; this.isolated=null;
    this.box=new THREE.BoxHelper(new THREE.Object3D(), '#b2e58d'); this.box.material.depthTest=false; this.box.material.transparent=true;this.box.material.opacity=.7;this.box.renderOrder=9;this.box.visible=false;scene.add(this.box);
    this.highlight=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:'#b2e58d',wireframe:true,transparent:true,opacity:.075,depthWrite:false})); this.highlight.matrixAutoUpdate=false;this.highlight.visible=false;scene.add(this.highlight);
    asset.on('beforechange',()=>{this.select(null);this.isolated=null;});
  }
  select(node) { this.selected=node; this.update(); this.emit('change',node); }
  isLocked(node=this.selected) { for(let p=node;p&&p!==this.asset.root?.parent;p=p.parent)if(p.userData.glblenderLocked)return true; return false; }
  isVisible(node) { for(let p=node;p;p=p.parent)if(!p.visible)return false;return true; }
  update() {
    const node=this.selected;
    this.box.visible=!!node&&this.isVisible(node);this.highlight.visible=this.box.visible&&!!node?.isMesh&&!node.isSkinnedMesh&&!node.isInstancedMesh;
    if(this.box.visible)this.box.setFromObject(node);
    if(this.highlight.visible){this.highlight.geometry=node.geometry;this.highlight.matrix.copy(node.matrixWorld);}
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
