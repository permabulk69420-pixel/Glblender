import * as THREE from 'three';
import { applyTransform, displayName, transformState } from '../core/utils.js';

function subtreeIsRigged(node) {
  let rigged=false;
  node?.traverse(n=>{if(n.isSkinnedMesh||n.isBone)rigged=true;});
  for(let p=node?.parent;p;p=p.parent)if(p.isBone)rigged=true;
  return rigged;
}

function canSeparateLooseMesh(editor,node) {
  return !!node?.isMesh&&node!==editor.asset.root&&!editor.selection.isLocked(node)&&!subtreeIsRigged(node)&&!node.isInstancedMesh&&!node.children.length&&!!node.geometry?.attributes?.position&&!Object.keys(node.geometry.morphAttributes||{}).length;
}

function hierarchyDetachable(editor,node) {
  return !!node&&node!==editor.asset.root&&!!node.parent&&node.parent!==editor.asset.root&&!editor.selection.isLocked(node)&&!subtreeIsRigged(node);
}

function attrValue(attribute,index,component) {
  if(attribute.isInterleavedBufferAttribute)return attribute.data.array[index*attribute.data.stride+attribute.offset+component];
  return attribute.array[index*attribute.itemSize+component];
}

function findLooseComponents(geometry) {
  const source=geometry.index?geometry.toNonIndexed():geometry;
  const position=source.getAttribute('position'),triangleCount=Math.floor((position?.count||0)/3);
  if(triangleCount<2)return {source,components:triangleCount?[ [0] ]:[]};
  const parent=Array.from({length:triangleCount},(_,i)=>i),rank=new Uint8Array(triangleCount),owners=new Map();
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const union=(a,b)=>{a=find(a);b=find(b);if(a===b)return;if(rank[a]<rank[b])[a,b]=[b,a];parent[b]=a;if(rank[a]===rank[b])rank[a]++;};
  const key=i=>`${Math.round(attrValue(position,i,0)*1e6)},${Math.round(attrValue(position,i,1)*1e6)},${Math.round(attrValue(position,i,2)*1e6)}`;
  for(let triangle=0;triangle<triangleCount;triangle++)for(let corner=0;corner<3;corner++){
    const vertex=triangle*3+corner,k=key(vertex),owner=owners.get(k);if(owner===undefined)owners.set(k,triangle);else union(triangle,owner);
  }
  const map=new Map();
  for(let triangle=0;triangle<triangleCount;triangle++){const root=find(triangle);if(!map.has(root))map.set(root,[]);map.get(root).push(triangle);}
  return {source,components:[...map.values()]};
}

function materialForTriangle(geometry,triangle) {
  const offset=triangle*3;
  for(const group of geometry.groups||[])if(offset>=group.start&&offset<group.start+group.count)return group.materialIndex??0;
  return 0;
}

function geometryForComponent(source,triangles) {
  const geometry=new THREE.BufferGeometry();
  for(const [name,attribute] of Object.entries(source.attributes)) {
    const values=[];
    for(const triangle of triangles)for(let corner=0;corner<3;corner++){
      const vertex=triangle*3+corner;
      for(let component=0;component<attribute.itemSize;component++)values.push(attrValue(attribute,vertex,component));
    }
    const ArrayType=attribute.isInterleavedBufferAttribute?attribute.data.array.constructor:attribute.array.constructor;
    geometry.setAttribute(name,new THREE.BufferAttribute(new ArrayType(values),attribute.itemSize,attribute.normalized));
  }
  let start=0,lastMaterial=null,groupStart=0;
  for(const triangle of triangles) {
    const material=materialForTriangle(source,triangle);
    if(lastMaterial===null){lastMaterial=material;groupStart=start;}
    else if(material!==lastMaterial){geometry.addGroup(groupStart,start-groupStart,lastMaterial);groupStart=start;lastMaterial=material;}
    start+=3;
  }
  if(lastMaterial!==null)geometry.addGroup(groupStart,start-groupStart,lastMaterial);
  geometry.userData={...source.userData};geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}

export function separateLooseParts(editor,node=editor.selection.selected,faceIndex=null) {
  if(!canSeparateLooseMesh(editor,node))return 0;
  const {source,components}=findLooseComponents(node.geometry);
  if(components.length<2)return 0;
  const parent=node.parent,index=parent.children.indexOf(node),selectedIndex=Math.max(0,components.findIndex(component=>component.includes(faceIndex)));
  const container=new THREE.Group();
  container.name=node.name;container.userData={...node.userData};container.position.copy(node.position);container.quaternion.copy(node.quaternion);container.scale.copy(node.scale);container.updateMatrix();
  const parts=components.map((triangles,i)=>{
    const part=new THREE.Mesh(geometryForComponent(source,triangles),node.material);
    part.name=`${displayName(node)} part ${i+1}`;part.userData={...node.userData,glblenderSourceName:part.name};part.castShadow=node.castShadow;part.receiveShadow=node.receiveShadow;part.frustumCulled=node.frustumCulled;part.renderOrder=node.renderOrder;part.visible=node.visible;
    editor.asset.originalTransforms.set(part,transformState(part));container.add(part);return part;
  });
  editor.asset.originalTransforms.set(container,transformState(container));
  const insert=(child,at)=>{parent.add(child);const current=parent.children.indexOf(child);parent.children.splice(current,1);parent.children.splice(Math.min(at,parent.children.length),0,child);};
  const refresh=()=>editor.asset.refresh?.();
  editor.history.execute({
    label:`Separate ${components.length} loose parts from ${displayName(node)}`,
    undo:()=>{parent.remove(container);insert(node,index);refresh();editor.selection.select(node);},
    redo:()=>{parent.remove(node);insert(container,index);refresh();editor.selection.select(parts[selectedIndex]||parts[0]);}
  });
  return components.length;
}

export function canDetachSelected(editor,node=editor.selection.selected) {
  return canSeparateLooseMesh(editor,node)||hierarchyDetachable(editor,node);
}

export function detachSelected(editor,node=editor.selection.selected) {
  const hit=editor.xr?.lastSelectionHit,faceIndex=hit?.node===node?hit.faceIndex:null;
  const separated=separateLooseParts(editor,node,faceIndex);
  if(separated)return separated;
  if(!hierarchyDetachable(editor,node))return false;
  const root=editor.asset.root,parent=node.parent,index=parent.children.indexOf(node),before=transformState(node);
  root.updateWorldMatrix(true,false);node.updateWorldMatrix(true,false);
  const local=new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(node.matrixWorld);
  const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();local.decompose(position,quaternion,scale);
  const detached={position:position.toArray(),quaternion:quaternion.toArray(),scale:scale.toArray()};
  const restoreOrder=()=>{const current=parent.children.indexOf(node);if(current>=0){parent.children.splice(current,1);parent.children.splice(Math.min(index,parent.children.length),0,node);}};
  editor.history.execute({
    label:`Detach ${displayName(node)} from group`,
    undo:()=>{parent.add(node);restoreOrder();applyTransform(node,before);},
    redo:()=>{root.add(node);applyTransform(node,detached);}
  });
  editor.selection.select(node);return 1;
}

export function installVRQuickActions(editor) {
  const xr=editor.xr,panel=xr.panel;

  // Add destructive / hierarchy actions directly to the existing Edit panel.
  const originalDrawEdit=panel.drawEdit.bind(panel);
  panel.drawEdit=(node,locked)=>{
    originalDrawEdit(node,locked);
    const deletable=!!node&&node!==editor.asset.root&&!editor.selection.isLocked(node);
    panel.button('detach-part','Detach / separate',32,579,340,35,()=>{
      const result=detachSelected(editor,node);
      if(result>1)panel.message(`Separated ${result} loose parts · each can now be selected`);
      else if(result===1)panel.message(`${displayName(node)} detached from group`);
      else panel.message('No detachable group or disconnected loose parts found');
    },{disabled:!canDetachSelected(editor,node)});
    panel.button('delete-part','Delete part',396,579,340,35,()=>editor.action('delete'),{disabled:!deletable});
  };

  // Grip the floating panel itself to reposition and reorient it in VR.
  const originalSqueeze=xr.squeeze.bind(xr),originalRelease=xr.release.bind(xr),originalSelectStart=xr.selectStart.bind(xr),originalUpdate=xr.update.bind(xr);
  const desired=new THREE.Matrix4(),parentInverse=new THREE.Matrix4(),local=new THREE.Matrix4();

  const updatePanelGrab=()=>{
    const grab=xr.panelGrab;if(!grab)return;
    grab.hand.grip.updateWorldMatrix(true,false);panel.mesh.parent.updateWorldMatrix(true,false);
    desired.copy(grab.hand.grip.matrixWorld).multiply(grab.inverseGrip).multiply(grab.startWorld);
    parentInverse.copy(panel.mesh.parent.matrixWorld).invert();local.multiplyMatrices(parentInverse,desired);
    local.decompose(panel.mesh.position,panel.mesh.quaternion,panel.mesh.scale);panel.mesh.scale.copy(grab.scale);
    panel.mesh.updateMatrix();panel.mesh.updateWorldMatrix(false,true);
  };
  const startPanelGrab=hand=>{
    hand.grip.updateWorldMatrix(true,false);panel.mesh.updateWorldMatrix(true,false);
    xr.panelGrab={hand,inverseGrip:hand.grip.matrixWorld.clone().invert(),startWorld:panel.mesh.matrixWorld.clone(),scale:panel.mesh.scale.clone()};
    hand.grabbing=true;editor.interacting=true;xr.haptic(hand);panel.message('Menu grabbed · release grip to place it');
  };

  xr.squeeze=hand=>{
    if(xr.panelGrab)return;
    if(!xr.grab&&!editor.busy&&!editor.shape.active&&!hand.ui&&!panel.drag){
      xr.raycast(hand);if(hand.menuHit){startPanelGrab(hand);return;}
    }
    return originalSqueeze(hand);
  };
  xr.release=hand=>{
    if(xr.panelGrab?.hand===hand){updatePanelGrab();xr.panelGrab=null;hand.grabbing=false;editor.interacting=false;panel.invalidate();return;}
    return originalRelease(hand);
  };
  xr.selectStart=hand=>{
    if(xr.panelGrab)return;
    const result=originalSelectStart(hand);
    if(!hand.menuHit&&hand.hit?.object&&editor.selection.selected===hand.hit.object)xr.lastSelectionHit={node:hand.hit.object,faceIndex:hand.hit.faceIndex};
    return result;
  };
  xr.update=(time,dt)=>{if(xr.panelGrab)updatePanelGrab();return originalUpdate(time,dt);};
}
