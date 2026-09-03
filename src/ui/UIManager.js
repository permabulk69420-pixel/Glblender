import * as THREE from 'three';
import { icon } from './icons.js';
import { escapeHTML as esc, displayName, materialsOf, formatCount, transformState, isEditableMesh } from '../core/utils.js';

const swatches=['#d4d9d2','#91a6b4','#303d48','#d4913f','#d7705d','#63a5d4','#89b5a0','#a298cc'];
const btn=(action,label,symbol,cls='')=>`<button class="${cls}" data-action="${action}" title="${esc(label)}">${symbol?icon(symbol):''}<span>${label}</span></button>`;

export class UIManager {
  constructor(editor,root) {
    this.e=editor;this.root=root;this.materialIndex=0;this.inspectorTab='transform';this.expanded=new Set();this.filter='';this.transformBefore=null;
    root.innerHTML=`
      <header class="app-header">
        <a class="brand" href="./" aria-label="Glblender workshop">${icon('cube')}<span>Glblender<small>VR WORKSHOP</small></span></a>
        <div class="mode-switch" aria-label="Editing mode">${btn('object','Object','cube','active')}${btn('shape','Shape','shape')}</div>
        <div class="history-actions">${btn('undo','Undo','undo','icon-only')}${btn('redo','Redo','redo','icon-only')}</div>
        <div class="header-spacer"></div>
        ${btn('import','Import model','import','subtle')}${btn('export','Export GLB','export','primary')}${btn('vr','Enter VR','vr','vr-button')}
        ${btn('help','Controls & help','help','icon-only help-button')}
      </header>
      <div class="mobile-bar">${btn('scene-panel','Components','layers')}${btn('inspector-panel','Inspector','cube')}</div>
      <main class="workspace">
        <aside class="panel scene-panel" aria-label="Component browser">
          <div class="panel-heading"><h2>Components</h2><span id="mesh-count" class="badge">0</span>${btn('show-all','Show all','eye','icon-only')}</div>
          <label class="search-box">${icon('search')}<input id="component-search" placeholder="Find a component…" aria-label="Find a component"/></label>
          <div class="asset-row"><span class="file-icon">${icon('cube')}</span><div><strong id="asset-name">Loading workshop</strong><small id="asset-kind">LOCAL ASSET</small></div>${btn('sample','Open sample','rotate','icon-only')}</div>
          <div id="tree" class="component-tree" role="tree" aria-label="Scene hierarchy"></div>
          <section class="asset-inspection"><div class="section-label">ASSET INSPECTION</div><div id="stats" class="stats"></div><div id="dimensions" class="dimensions"></div><div id="asset-warnings"></div></section>
          <div class="local-note">${icon('lock')}<span>Your files stay on this device.</span></div>
        </aside>
        <section class="viewport-shell" aria-label="Workshop">
          <div id="viewport"></div>
          <div class="viewport-title"><span class="eyebrow">STUDIO 01</span><span id="view-description">Perspective · tabletop</span></div>
          <div class="viewport-tools" aria-label="Transform tools">
            ${btn('translate','Move · W','move','icon-only active')}${btn('rotate','Rotate · E','rotate','icon-only')}${btn('scale','Scale · R','scale','icon-only')}
            <span class="tool-divider"></span><div id="constraint-buttons"><button data-constraint="FREE" class="active">Free</button><button data-constraint="X">X</button><button data-constraint="Y">Y</button><button data-constraint="Z">Z</button></div>
            ${btn('snap','Snap: 0.1 m / 15°','grid','icon-only')}
          </div>
          <div class="axis-widget" aria-hidden="true"><i class="axis-y">Y</i><i class="axis-z">Z</i><i class="axis-x">X</i></div>
          <div id="recovery-banner" class="recovery-banner" hidden></div>
          <div id="busy-overlay" class="busy-overlay" hidden><span class="spinner"></span><span id="busy-text">Loading asset…</span></div>
          <div class="viewport-bottom"><div id="interaction-hint">Click a part to select · drag to orbit · scroll to zoom</div>
            <div class="view-controls">${btn('tabletop','Tabletop',null,'active')}${btn('actual','1:1',null)}<span class="tool-divider"></span><label title="Viewing scale only — export keeps the original size"><span>View</span><input id="view-scale" type="number" value="100" min="0.01" max="10000" step="1" aria-label="Viewing scale percent"/><span>%</span></label>${btn('frame','Frame asset · F','target','icon-only')}</div>
          </div>
          <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
        </section>
        <aside class="panel inspector-panel" aria-label="Inspector"><div class="panel-heading"><h2>Inspector</h2><span class="badge">LOCAL</span></div><div id="inspector"></div></aside>
      </main>
      <footer class="statusbar"><div><span class="status-mark"></span><span id="save-status">Sample asset · ready to edit</span></div><a id="download-ready" hidden>Download GLB again</a><span id="render-stats">WebGL · ready</span><span class="version">Glblender 0.1</span></footer>
      <input id="file-input" type="file" multiple accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2" hidden/>
      <dialog id="help-dialog"><div class="dialog-head"><div><span class="eyebrow">WORKSHOP GUIDE</span><h2>Make it yours.</h2></div>${btn('close-help','Close','close','icon-only')}</div>
        <p>Import a GLB, select a component, and shape or finish it. Everything happens locally in your browser.</p>
        <div class="help-columns"><section><h3>Quest controllers</h3><dl><dt>Trigger</dt><dd>Point to select. In Shape mode, hold and pull.</dd><dt>Grip</dt><dd>Grab the pointed or selected component.</dd><dt>Both grips</dt><dd>Scale and rotate the grabbed component.</dd><dt>Left stick</dt><dd>Move through the workshop.</dd><dt>Right stick</dt><dd>Adjust brush radius in Shape; turn in Object.</dd><dt>A / B</dt><dd>Undo / redo.</dd><dt>X / Y</dt><dd>Switch Object/Shape / show the menu.</dd></dl></section>
        <section><h3>Desktop</h3><dl><dt>Click</dt><dd>Select a part. Drag a gizmo to transform.</dd><dt>W / E / R</dt><dd>Move / rotate / scale.</dd><dt>Right drag</dt><dd>Orbit (also in Shape mode).</dd><dt>Shift + drag</dt><dd>Pan. Scroll to zoom.</dd><dt>Ctrl Z / Shift Z</dt><dd>Undo / redo. Ctrl Y also redoes.</dd><dt>F / Esc</dt><dd>Frame asset / deselect or cancel stroke.</dd><dt>Shape mode</dt><dd>Drag the surface to pull, stretch, squash or flatten.</dd></dl></section></div>
        <p><strong>Quest file access:</strong> use Import model in the browser before entering VR. The in-VR Import action returns you here to choose a file. Export returns to the browser for the download.</p>
        <p><strong>GLTF folders:</strong> select the .gltf, .bin and its images together. Self-contained GLBs are easiest. Units are metres; viewing scale does not change the exported asset.</p>
        <p><strong>Shape editing:</strong> works on static meshes and existing vertices. Very sparse topology cannot make smooth curves. Rigged, instanced and morph-target meshes keep their data but cannot be sculpted.</p>
      </dialog>`;
    this.bind();
  }
  bind() {
    this.root.addEventListener('click',event=>{
      const b=event.target.closest('button');if(!b)return;
      if(b.dataset.action){this.e.action(b.dataset.action);return;}
      if(b.dataset.select){this.e.selection.select(this.e.asset.getNode(b.dataset.select));return;}
      if(b.dataset.expand){this.expanded.has(b.dataset.expand)?this.expanded.delete(b.dataset.expand):this.expanded.add(b.dataset.expand);this.renderTree();return;}
      if(b.dataset.visibility){this.e.selection.hide(this.e.asset.getNode(b.dataset.visibility));return;}
      if(b.dataset.constraint){this.e.constraint=b.dataset.constraint;this.e.transform.setConstraint(this.e.constraint);this.renderToolbar();return;}
      if(b.dataset.tab){this.e.materials.end();this.inspectorTab=b.dataset.tab;this.renderInspector();return;}
      if(b.dataset.swatch){this.e.setMaterial('color',b.dataset.swatch,true);return;}
      if(b.dataset.shapeTool){this.e.shape.kind=b.dataset.shapeTool;this.renderInspector();this.e.xr?.panel.invalidate();return;}
      if(b.dataset.shapeAxis){this.e.shape.axis=b.dataset.shapeAxis;this.renderInspector();this.e.xr?.panel.invalidate();}
    });
    this.root.querySelector('#component-search').addEventListener('input',e=>{this.filter=e.target.value.toLowerCase();this.renderTree();});
    this.root.querySelector('#file-input').addEventListener('change',async event=>{if(event.target.files.length)await this.e.importFiles(event.target.files);event.target.value='';});
    this.root.addEventListener('focusin',event=>{if(event.target.dataset.transform&&this.e.selection.selected)this.transformBefore={node:this.e.selection.selected,state:transformState(this.e.selection.selected)};});
    this.root.addEventListener('input',event=>this.input(event,false));
    this.root.addEventListener('change',event=>this.input(event,true));
    this.root.addEventListener('focusout',event=>{if(event.target.dataset.transform)this.commitTransform();if(event.target.dataset.material)this.e.materials.end();});
    this.root.querySelector('#view-scale').addEventListener('change',event=>{const scale=Number(event.target.value)/100;if(scale>0&&Number.isFinite(scale)){this.e.workshop.viewScale=scale;this.e.workshop.viewRig.scale.setScalar(scale);this.e.workshop.viewMode='custom';this.updateView();}});
  }
  input(event,commit) {
    const input=event.target,e=this.e,n=e.selection.selected;
    if(e.busy)return;
    if(input.dataset.transform&&n&&!e.selection.isLocked()) {
      const value=Number(input.value);if(!Number.isFinite(value)||input.value==='')return;
      this.transformBefore??={node:n,state:transformState(n)};
      const key=input.dataset.transform,axis=input.dataset.axis;
      if(key==='scale'&&Math.abs(value)<.00001)return;
      n[key][axis]=key==='rotation'?THREE.MathUtils.degToRad(value):value;n.updateMatrix();n.updateWorldMatrix(false,true);e.selection.update();
      if(commit)this.commitTransform();
    }
    if(input.dataset.material&&n&&!e.selection.isLocked()) {
      const key=input.dataset.material;let value=input.type==='checkbox'?input.checked:input.type==='number'||input.type==='range'?Number(input.value):input.value;
      if(key==='color'&&!/^#[0-9a-f]{6}$/i.test(value))return;
      e.setMaterial(key,value,commit);const out=input.closest('.property-field')?.querySelector('output');if(out)out.textContent=typeof value==='number'?value.toFixed(2):value;
    }
    if(input.id==='material-slot'&&commit){e.materials.end();this.materialIndex=Number(input.value);this.renderInspector();}
    if(input.dataset.shape){const key=input.dataset.shape,value=Number(input.value);if(Number.isFinite(value)){e.shape[key]=value;const out=input.closest('.property-field')?.querySelector('output');if(out)out.textContent=key==='radius'?`${value.toFixed(2)} m`:value.toFixed(2);e.xr?.panel.invalidate();}}
    if(input.id==='environment-brightness')e.workshop.setBrightness(Number(input.value));
  }
  commitTransform() {const b=this.transformBefore;if(!b)return;this.transformBefore=null;this.e.history.transform(b.node,b.state,transformState(b.node));}
  render() {this.renderTree();this.renderInspector();this.renderToolbar();this.renderStats();this.updateView();}
  renderTree() {
    const e=this.e,asset=e.asset;if(!asset.root)return;
    const draw=(n,depth=0)=>{
      const match=!this.filter||displayName(n).toLowerCase().includes(this.filter)||n.children.some(c=>displayName(c).toLowerCase().includes(this.filter));
      const expandable=n.children.length>0,open=this.expanded.has(n.uuid)||n===asset.root||!!this.filter;
      const row=match?`<div class="tree-row ${e.selection.selected===n?'selected':''} ${!e.selection.isVisible(n)?'muted':''}" role="treeitem" aria-selected="${e.selection.selected===n}" style="--depth:${Math.min(depth,5)}">
        <button class="disclosure ${open?'open':''}" ${expandable?`data-expand="${n.uuid}"`:'disabled'} aria-label="${open?'Collapse':'Expand'} ${esc(displayName(n))}">${expandable?icon('chevron'):''}</button>
        <button class="node-select" data-select="${n.uuid}" title="${esc(displayName(n))}">${icon(n.isMesh?'cube':'layers')}<span>${esc(displayName(n))}</span>${e.selection.isLocked(n)?'<span class="locked-mark">'+icon('lock')+'</span>':''}</button>
        <button class="visibility-button ${n.userData.glblenderHidden?'hidden-state':''}" data-visibility="${n.uuid}" aria-label="${n.userData.glblenderHidden?'Show':'Hide'} ${esc(displayName(n))}" title="${n.userData.glblenderHidden?'Show':'Hide'}">${icon('eye')}</button></div>`:'';
      return row+(open?n.children.map(c=>draw(c,depth+1)).join(''):'');
    };
    this.root.querySelector('#tree').innerHTML=draw(asset.root);
    this.root.querySelector('#asset-name').textContent=asset.filename;
    this.root.querySelector('#asset-kind').textContent=asset.root.userData.sample?'EDITABLE SAMPLE':'LOCAL ASSET';
    this.root.querySelector('#mesh-count').textContent=asset.meshes.length;
  }
  renderStats() {
    const i=this.e.asset.info;if(!i)return;
    this.root.querySelector('#stats').innerHTML=`<div><strong>${formatCount(i.triangles)}</strong><span>triangles</span></div><div><strong>${formatCount(i.vertices)}</strong><span>vertices</span></div><div><strong>${i.materials}</strong><span>materials</span></div>`;
    this.root.querySelector('#dimensions').innerHTML=`<span>${i.size.toArray().map(v=>v.toFixed(2)).join(' × ')} m</span><small>Metres assumed · ${i.animations} animation${i.animations===1?'':'s'}</small>`;
    this.root.querySelector('#asset-warnings').innerHTML=i.warnings.length?`<details><summary>${i.warnings.length} asset note${i.warnings.length>1?'s':''}</summary>${i.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</details>`:'';
  }
  renderToolbar() {
    const e=this.e;
    for(const action of ['object','shape'])this.root.querySelector(`[data-action="${action}"]`).classList.toggle('active',e.mode===action);
    for(const action of ['translate','rotate','scale'])this.root.querySelector(`[data-action="${action}"]`).classList.toggle('active',e.transformMode===action);
    for(const b of this.root.querySelectorAll('[data-constraint]'))b.classList.toggle('active',b.dataset.constraint===e.constraint);
    this.root.querySelector('[data-action="snap"]').classList.toggle('active',e.snap);
    this.root.querySelector('[data-action="undo"]').disabled=!e.history.canUndo||e.busy;
    this.root.querySelector('[data-action="redo"]').disabled=!e.history.canRedo||e.busy;
    this.root.querySelector('.viewport-tools').classList.toggle('shape-tools-muted',e.mode==='shape');
    this.root.querySelector('#interaction-hint').textContent=e.mode==='shape'?'Hold and drag the surface to shape · right-drag to orbit':'Click a part to select · drag to orbit · scroll to zoom';
  }
  renderInspector() {
    const e=this.e,n=e.selection.selected,el=this.root.querySelector('#inspector');
    if(!n){el.innerHTML=`<div class="empty-inspector">${icon('cube')}<h3>Select a component</h3><p>Point at any part of the model, or choose it from the component browser.</p></div><section class="inspector-section"><h3>Workshop</h3><label class="property-field"><span>Environment brightness</span><input id="environment-brightness" type="range" min=".3" max="1.8" step=".05" value="${e.workshop?.renderer.toneMappingExposure||1.1}"/></label><p class="helper-text">Start with the Kestrel sample, or import your own model.</p></section>`;return;}
    const locked=e.selection.isLocked(),mats=materialsOf(n);this.materialIndex=Math.min(this.materialIndex,Math.max(mats.length-1,0));
    el.innerHTML=`<div class="selected-heading"><div class="selected-icon">${icon('cube')}</div><div><h3>${esc(displayName(n))}</h3><span>${n.isMesh?'Mesh component':'Scene group'}${locked?' · locked':''}</span></div></div>
      <div class="selection-actions">${btn('hide',n.userData.glblenderHidden?'Show':'Hide','eye')}${btn('isolate',e.selection.isolated===n?'Unisolate':'Isolate','target')}${btn('lock',n.userData.glblenderLocked?'Unlock':'Lock',n.userData.glblenderLocked?'unlock':'lock')}</div>
      <div class="inspector-tabs"><button data-tab="transform" class="${this.inspectorTab==='transform'?'active':''}">Transform</button><button data-tab="material" class="${this.inspectorTab==='material'?'active':''}" ${!mats.length?'disabled':''}>Material</button><button data-tab="shape" class="${this.inspectorTab==='shape'?'active':''}">Shape</button></div>
      <fieldset class="inspector-fields" ${locked?'disabled':''}>
      ${this.inspectorTab==='transform'?this.transformHTML(n):this.inspectorTab==='material'?this.materialHTML(mats):this.shapeHTML(n)}
      </fieldset>
      ${locked?'<p class="locked-notice">This component is locked. Unlock it to edit.</p>':''}
      <div class="inspector-footer">${btn('duplicate','Duplicate','duplicate')}${btn('delete','Delete','trash','danger-text')}</div>`;
  }
  transformHTML(n) {
    return `<section class="inspector-section"><div class="section-line"><h3>Transform</h3><span class="subtle-label">LOCAL</span></div>${['position','rotation','scale'].map(key=>`<div class="vector-field"><div class="vector-label">${key==='position'?'Position':key==='rotation'?'Rotation':'Scale'}<span>${key==='position'?'m':key==='rotation'?'°':''}</span></div><div class="vector-inputs">${['x','y','z'].map(axis=>`<label class="${axis}"><span>${axis.toUpperCase()}</span><input type="number" step="${key==='rotation'?1:.01}" data-transform="${key}" data-axis="${axis}" aria-label="${key} ${axis.toUpperCase()}" value="${(key==='rotation'?THREE.MathUtils.radToDeg(n[key][axis]):n[key][axis]).toFixed(key==='rotation'?1:3)}"/></label>`).join('')}</div></div>`).join('')}
      ${btn('reset-transform','Reset transform','rotate','wide subtle')}<p class="helper-text">Grab a gizmo to edit. In VR, grip a part and move naturally. A second grip adds scale and rotation.</p></section>
      <section class="inspector-section"><h3>Quick finish</h3><div class="swatches">${swatches.map(c=>`<button data-swatch="${c}" style="--swatch:${c}" aria-label="Colour ${c}" ${!n.isMesh?'disabled':''}></button>`).join('')}</div><button class="text-link" data-tab="material" ${!n.isMesh?'disabled':''}>Open material editor ${icon('chevron')}</button></section>
      <section class="inspector-section shape-intro"><div>${icon('shape')}<h3>Give it a new shape</h3></div><p class="helper-text">Pull a region, reshape a panel or bend a frame.</p>${btn('shape','Open shape tools',null,'wide')}</section>`;
  }
  materialHTML(mats) {
    const m=mats[this.materialIndex];if(!m)return '<p class="helper-text">Select a mesh to edit its material.</p>';
    const color=m.color?'#'+m.color.getHexString():'#ffffff',emissive=m.emissive?'#'+m.emissive.getHexString():'#000000';
    return `<section class="inspector-section"><div class="section-line"><h3>Surface</h3><span class="material-dot" style="background:${color}"></span></div>
      <label class="property-field"><span>Material slot</span><select id="material-slot" aria-label="Material slot">${mats.map((x,i)=>`<option value="${i}" ${i===this.materialIndex?'selected':''}>${esc(x.name||'Material '+(i+1))}</option>`).join('')}</select></label>
      <label class="property-field"><span>Base colour</span><div class="color-field"><input aria-label="Base colour picker" type="color" data-material="color" value="${color}"/><input aria-label="Base colour hex" type="text" data-material="color" value="${color}" maxlength="7" spellcheck="false"/></div></label>
      <div class="swatches">${swatches.map(c=>`<button data-swatch="${c}" style="--swatch:${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
      ${this.range('Metallic','metalness',m.metalness??0,0,1)}${this.range('Roughness','roughness',m.roughness??1,0,1)}${this.range('Opacity','opacity',m.opacity??1,0,1)}
      <label class="property-field"><span>Emissive colour</span><div class="color-field"><input type="color" aria-label="Emissive colour" data-material="emissive" value="${emissive}"/><span class="hex-label">${emissive.toUpperCase()}</span></div></label>
      ${this.range('Emission strength','emissiveIntensity',m.emissiveIntensity??1,0,5)}
      <label class="checkbox-field"><input type="checkbox" data-material="doubleSided" ${m.side===THREE.DoubleSide?'checked':''}/><span>Double-sided surface</span></label>
      <p class="helper-text">Changes affect this component only. Textures and UVs are preserved; base colour tints existing textures.</p></section>`;
  }
  range(label,key,value,min,max) {return `<label class="property-field"><span>${label}<output>${Number(value).toFixed(2)}</output></span><input aria-label="${label}" data-material="${key}" type="range" min="${min}" max="${max}" step=".01" value="${value}"/></label>`;}
  shapeHTML(n) {
    const s=this.e.shape;
    if(!isEditableMesh(n))return '<section class="inspector-section"><h3>Choose a static mesh</h3><p class="helper-text">Select an individual mesh to use shape tools. Rigged meshes, instances and morph targets are preserved but cannot be deformed.</p></section>';
    return `<section class="inspector-section"><div class="section-line"><h3>Shape tools</h3><span class="subtle-label">SOFT SELECTION</span></div>
      ${this.e.mode!=='shape'?btn('shape','Enable Shape mode','shape','wide primary'):''}
      <div class="shape-tool-grid">${[['pull','Pull'],['stretch','Stretch'],['squash','Squash'],['flatten','Flatten'],['bend','Bend']].map(([k,l])=>`<button data-shape-tool="${k}" class="${s.kind===k?'active':''}">${l}</button>`).join('')}</div>
      <label class="property-field"><span>Brush radius<output>${s.radius.toFixed(2)} m</output></span><input type="range" aria-label="Brush radius" data-shape="radius" min=".01" max="5" step=".01" value="${s.radius}"/></label>
      <label class="property-field"><span>Strength<output>${s.strength.toFixed(2)}</output></span><input type="range" aria-label="Shape strength" data-shape="strength" min=".05" max="2" step=".05" value="${s.strength}"/></label>
      <label class="property-field"><span>Falloff<output>${s.falloff.toFixed(2)}</output></span><input type="range" aria-label="Falloff" data-shape="falloff" min=".3" max="3" step=".1" value="${s.falloff}"/></label>
      <div class="property-field"><span>Stretch / bend axis</span><div class="axis-buttons">${['X','Y','Z'].map(a=>`<button data-shape-axis="${a}" class="${s.axis===a?'active':''}">${a}</button>`).join('')}</div></div>
      ${s.kind==='bend'?`<label class="property-field"><span>Bend angle (degrees)</span><input type="number" id="bend-angle" aria-label="Bend angle" value="30" min="-180" max="180" step="5"/></label>${btn('apply-bend','Apply bend',null,'wide primary')}<p class="helper-text">Bends the whole component along the chosen local axis, anchored at its minimum end. You can also hold trigger and move sideways in VR.</p>`:`<p class="helper-text">${s.kind==='pull'?'Grab a surface point and pull. Nearby vertices follow with smooth falloff.':s.kind==='flatten'?'Drag to flatten the region onto the plane of the selected face.':`Drag along the chosen local axis to ${s.kind} the selected region.`}</p>`}
      <p class="helper-text">Radius is in asset metres. Shape tools move existing vertices; they do not add topology.</p></section>`;
  }
  updateTransformValues() {const n=this.e.selection.selected;if(!n)return;for(const input of this.root.querySelectorAll('[data-transform]')){if(document.activeElement===input)continue;const key=input.dataset.transform;input.value=(key==='rotation'?THREE.MathUtils.radToDeg(n.rotation[input.dataset.axis]):n[key][input.dataset.axis]).toFixed(key==='rotation'?1:3);}}
  updateView() {const w=this.e.workshop;if(!w)return;this.root.querySelector('#view-description').textContent=`Perspective · ${w.viewMode==='actual'?'actual scale':w.viewMode==='tabletop'?'tabletop':'custom scale'}`;this.root.querySelector('#view-scale').value=(w.viewScale*100).toFixed(1);for(const k of ['tabletop','actual'])this.root.querySelector(`[data-action="${k}"]`).classList.toggle('active',w.viewMode===k);}
  toast(message,error=false) {const el=this.root.querySelector('#toast');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>el.hidden=true,error?7000:3600);this.e.xr?.panel.message(message);}
  setSaveStatus(text) {this.root.querySelector('#save-status').textContent=text;}
  setBusy(value,text='Working…') {this.root.querySelector('#busy-overlay').hidden=!value;this.root.querySelector('#busy-text').textContent=text;this.renderToolbar();}
  showRecovery(record) {const el=this.root.querySelector('#recovery-banner');el.hidden=false;el.innerHTML=`<div><strong>Pick up where you left off</strong><span>${esc(record.filename)}</span></div>${btn('recover','Recover',null,'primary')}${btn('dismiss-recovery','Dismiss','close','icon-only')}`;this.recovery=record;}
}
