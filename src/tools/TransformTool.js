import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { transformState } from '../core/utils.js';

export class TransformTool {
  constructor(editor) {
    this.editor=editor;this.controls=new TransformControls(editor.workshop.camera,editor.workshop.renderer.domElement);this.controls.setSize(.75);this.controls.setSpace('local');
    editor.workshop.scene.add(this.controls.getHelper());
    this.controls.addEventListener('dragging-changed',event=>{editor.workshop.controls.enabled=!event.value;editor.interacting=event.value;});
    this.controls.addEventListener('mouseDown',()=>{const n=editor.selection.selected;if(n)this.before=transformState(n);});
    this.controls.addEventListener('objectChange',()=>{editor.selection.update();editor.ui?.updateTransformValues();});
    this.controls.addEventListener('mouseUp',()=>{const n=editor.selection.selected;if(n&&this.before)editor.history.transform(n,this.before,transformState(n));this.before=null;});
  }
  attach() {
    const e=this.editor,n=e.selection.selected;
    if(n&&e.mode==='object'&&!e.selection.isLocked(n)&&e.selection.isVisible(n)&&!e.workshop.renderer.xr.isPresenting)this.controls.attach(n);else this.controls.detach();
  }
  setMode(mode) {this.controls.setMode(mode);}
  setConstraint(axis) {this.controls.showX=axis==='FREE'||axis==='X';this.controls.showY=axis==='FREE'||axis==='Y';this.controls.showZ=axis==='FREE'||axis==='Z';}
  setSnap(enabled) {this.controls.setTranslationSnap(enabled?.1:null);this.controls.setRotationSnap(enabled?Math.PI/12:null);this.controls.setScaleSnap(enabled?.1:null);}
}
