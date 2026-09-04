import * as THREE from 'three';
import { applyTransform, displayName, transformState } from '../core/utils.js';

function subtreeIsRigged(node) {
  let rigged=false;
  node?.traverse(n=>{if(n.isSkinnedMesh||n.isBone)rigged=true;});
  for(let p=node?.parent;p;p=p.parent)if(p.isBone)rigged=true;
  return rigged;
}

export function canDetachSelected(editor,node=editor.selection.selected) {
  return !!node&&node!==editor.asset.root&&!!node.parent&&node.parent!==editor.asset.root&&!editor.selection.isLocked(node)&&!subtreeIsRigged(node);
}

export function detachSelected(editor,node=editor.selection.selected) {
  if(!canDetachSelected(editor,node))return false;
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
  editor.selection.select(node);return true;
}

export function installVRQuickActions(editor) {
  const xr=editor.xr,panel=xr.panel;

  // Add destructive / hierarchy actions directly to the existing Edit panel.
  const originalDrawEdit=panel.drawEdit.bind(panel);
  panel.drawEdit=(node,locked)=>{
    originalDrawEdit(node,locked);
    const deletable=!!node&&node!==editor.asset.root&&!editor.selection.isLocked(node);
    panel.button('detach-part','Detach from group',32,579,340,35,()=>{
      if(detachSelected(editor,node))panel.message(`${displayName(node)} detached from group`);
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
  xr.selectStart=hand=>{if(xr.panelGrab)return;return originalSelectStart(hand);};
  xr.update=(time,dt)=>{if(xr.panelGrab)updatePanelGrab();return originalUpdate(time,dt);};
}
