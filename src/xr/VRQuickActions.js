import * as THREE from 'three';
import { applyTransform, displayName, materialsOf, transformState } from '../core/utils.js';

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

export function canTextureSelected(editor,node=editor.selection.selected) {
  return !!node?.isMesh&&!editor.selection.isLocked(node)&&!!node.geometry?.attributes?.uv;
}

export function setBaseTexture(editor,node,index,texture) {
  if(!canTextureSelected(editor,node))return false;
  if(!editor.materials.setTexture(node,index,'map',texture))return false;
  editor.materials.end();editor.ui?.renderInspector?.();editor.xr?.panel?.invalidate?.();return true;
}

async function textureFromFile(file) {
  let image;
  if(typeof createImageBitmap==='function')image=await createImageBitmap(file);
  else {
    const url=URL.createObjectURL(file);
    try{image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Could not decode that image'));img.src=url;});}
    finally{URL.revokeObjectURL(url);}
  }
  const texture=new THREE.Texture(image);texture.name=file.name;texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.RepeatWrapping;texture.needsUpdate=true;return texture;
}

export function installVRQuickActions(editor) {
  const xr=editor.xr,panel=xr.panel;

  // Make the panel physically easier to read and hit in Quest without changing
  // its canvas layout or the amount of information on screen.
  const oldPanelGeometry=panel.mesh.geometry;
  panel.mesh.geometry=new THREE.PlaneGeometry(.62,.62*panel.canvas.height/panel.canvas.width);
  oldPanelGeometry.dispose();

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

  // Texture editing is a lightweight sub-view of Material rather than another
  // top-level tab. Imported images become the selected material's base map.
  let textureTarget=null;
  panel.textureMode=false;
  const textureInput=document.createElement('input');textureInput.type='file';textureInput.accept='image/png,image/jpeg,image/webp';textureInput.hidden=true;document.body.append(textureInput);
  const chooseTexture=document.createElement('button');chooseTexture.type='button';chooseTexture.textContent='Choose texture image';chooseTexture.hidden=true;chooseTexture.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10000;padding:18px 24px;font:600 18px system-ui;border-radius:12px;border:1px solid #91a1ae;background:#1f2a34;color:#e4efe0';document.body.append(chooseTexture);
  chooseTexture.addEventListener('click',()=>textureInput.click());

  const openTexturePicker=async(node,index)=>{
    if(!node?.geometry?.attributes?.uv){panel.message('This part has no UV0 mapping · regenerate it with UVs first');return;}
    textureTarget={node,index};textureInput.value='';chooseTexture.hidden=false;panel.message('Choose a PNG, JPG or WebP texture');
    const session=editor.workshop.renderer.xr.getSession?.();
    if(session){
      await session.end();
      setTimeout(()=>{try{textureInput.click();}catch{}},80);
    }else textureInput.click();
  };

  textureInput.addEventListener('change',async()=>{
    const file=textureInput.files?.[0],target=textureTarget;chooseTexture.hidden=true;if(!file||!target)return;
    try{
      if(!target.node?.isMesh||!target.node.geometry?.attributes?.uv)throw new Error('The target part no longer has usable UV mapping');
      const texture=await textureFromFile(file);
      if(!setBaseTexture(editor,target.node,target.index,texture))throw new Error('Could not apply the texture to that material');
      panel.textureMode=true;panel.message(`${file.name} applied as base texture`);
    }catch(error){panel.message(error.message||'Texture import failed');console.error('Texture import:',error);}
    finally{textureTarget=null;panel.invalidate();}
  });

  const originalDrawMaterial=panel.drawMaterial.bind(panel);
  panel.drawMaterial=(node,locked)=>{
    const mats=materialsOf(node),index=Math.max(0,Math.min(editor.ui.materialIndex,mats.length-1)),m=mats[index];
    if(panel.textureMode){
      const hasUV=!!node?.geometry?.attributes?.uv,hasMap=!!m?.map;
      panel.text('Base texture',32,260,28,'#e4efe0','600');
      panel.text(hasUV?'UV0 detected · texture mapping is ready':'No UV0 mapping on this part',32,304,20,hasUV?'#91a1ae':'#d6b18a','500');
      if(hasMap){
        panel.text(panel.truncate(m.map.name||'Embedded / unnamed texture',47),32,355,21,'#dbe5eb','500');
        const image=m.map.image||m.map.source?.data;
        if(image&&typeof panel.ctx.drawImage==='function'){
          try{panel.ctx.save();panel.ctx.fillStyle='#111820';panel.ctx.fillRect(32,382,240,180);panel.ctx.drawImage(image,32,382,240,180);panel.ctx.restore();}catch{}
        }
      }else panel.text('No base texture applied',32,355,21,'#91a1ae');
      panel.button('texture-import',hasMap?'Replace texture':'Import texture',304,382,432,58,()=>openTexturePicker(node,index),{primary:true,disabled:locked||!hasUV});
      panel.button('texture-remove','Remove texture',304,458,432,52,()=>{
        if(setBaseTexture(editor,node,index,null))panel.message('Base texture removed');
      },{disabled:locked||!hasMap});
      panel.text(hasUV?'PNG, JPG and WebP are embedded into the exported GLB.':'Ask the GLB generator for clean TEXCOORD_0 / UV0 mapping.',32,610,19,hasUV?'#82998c':'#d6b18a');
      panel.button('texture-slot',`Material ${index+1}/${Math.max(1,mats.length)}: ${panel.truncate(m?.name||'Surface',25)}`,32,680,704,46,()=>{editor.materials.end();editor.ui.materialIndex=(editor.ui.materialIndex+1)%Math.max(1,mats.length);panel.invalidate();});
      panel.button('texture-back','Back to colour & material',32,748,704,46,()=>{panel.textureMode=false;panel.invalidate();});
      return;
    }
    originalDrawMaterial(node,locked);
    // Replace the old full-width material-slot control with slot + texture.
    panel.regions=panel.regions.filter(region=>region.id!=='slot');
    panel.rect(32,788,704,34,'#18222b',0);
    panel.button('slot',`Material ${index+1}/${Math.max(1,mats.length)}: ${panel.truncate(m?.name||'Surface',18)}`,32,788,464,34,()=>{editor.materials.end();editor.ui.materialIndex=(editor.ui.materialIndex+1)%Math.max(1,mats.length);panel.invalidate();});
    panel.button('texture-view',m?.map?'Texture ✓':'Texture…',508,788,228,34,()=>{panel.textureMode=true;panel.invalidate();},{disabled:!node?.isMesh});
  };

  editor.asset.on('beforechange',()=>{panel.textureMode=false;textureTarget=null;chooseTexture.hidden=true;});

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
