import * as THREE from 'three';
import { buildGrid, dab, setErased } from './eraseMath.js';

// The Erase and Restore brush. It hides triangles (see eraseMath.js) and keeps an ordered list of every dab, in the asset's own
// coordinates, which is what "Export erase list" saves: the build script replays it on the original model.
export class EraseTool {
  constructor(history, asset, shape) {
    this.history = history; this.asset = asset; this.shape = shape; this.ops = []; this.active = null; this.states = new WeakMap();
    this.rootInverse = new THREE.Matrix4(); this.toRoot = new THREE.Matrix4();
    asset.on('beforechange', () => { this.active = null; this.ops = []; });
  }
  state(mesh) {
    const g = mesh.geometry;
    let s = this.states.get(g);
    if (s) return s;
    if (!g.index) { const n = g.attributes.position.count, a = n > 65535 ? new Uint32Array(n) : new Uint16Array(n); for (let i = 0; i < n; i++) a[i] = i; g.setIndex(new THREE.BufferAttribute(a, 1)); }
    const original = Uint32Array.from(g.index.array);
    s = { original, erased: new Uint8Array(original.length / 3), grid: null }; this.states.set(g, s); return s;
  }
  get restore() { return this.shape.kind === 'restore'; }
  begin(point, viewScale) {
    if (this.active || !this.asset.root) return false;
    this.active = { changes: new Map(), ops: [], last: null, restore: this.restore, viewScale };
    this.update(point); this.shape.hover(point, viewScale);
    return true;
  }
  // One dab at a world-space point, once the brush has moved far enough since the last one.
  update(point) {
    const a = this.active; if (!a || !point) return;
    const radius = this.shape.radius * a.viewScale;
    if (a.last && a.last.distanceTo(point) < radius * .3) return;
    a.last = point.clone(); this.shape.hover(point, a.viewScale);
    const root = this.asset.root; root.updateWorldMatrix(true, true);
    this.rootInverse.copy(root.matrixWorld).invert();
    const centre = point.clone().applyMatrix4(this.rootInverse), rootScale = root.matrixWorld.getMaxScaleOnAxis(), rootRadius = radius / rootScale;
    let touched = false;
    for (const mesh of this.asset.meshes) {
      if (!mesh.visible || !mesh.geometry?.attributes.position || mesh.isSkinnedMesh || mesh.isInstancedMesh) continue;
      const g = mesh.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      this.toRoot.multiplyMatrices(this.rootInverse, mesh.matrixWorld);
      const sphere = g.boundingSphere.clone().applyMatrix4(this.toRoot);
      if (sphere.distanceToPoint(centre) > rootRadius) continue;
      const s = this.state(mesh); s.grid ??= buildGrid(g.attributes.position, s.original);
      const scale = this.toRoot.getMaxScaleOnAxis();
      const ids = dab({ grid: s.grid, index: g.index, original: s.original, erased: s.erased, toRoot: this.toRoot, centre, radius: rootRadius, scale, restore: a.restore });
      if (!ids.length) continue;
      g.index.needsUpdate = true; touched = true;
      const list = a.changes.get(mesh) ?? []; list.push(...ids); a.changes.set(mesh, list);
    }
    a.ops.push([centre.x, centre.y, centre.z, rootRadius, a.restore ? 1 : 0]);
    return touched;
  }
  end(cancel = false) {
    const a = this.active; if (!a) return; this.active = null; this.shape.brush.visible = false;
    const apply = value => { for (const [mesh, ids] of a.changes) { const s = this.states.get(mesh.geometry); setErased(mesh.geometry.index, s.original, s.erased, ids, value); mesh.geometry.index.needsUpdate = true; } };
    if (cancel) { apply(a.restore); return; }
    if (![...a.changes.values()].some(ids => ids.length)) return;
    const count = a.ops.length, ops = a.ops, value = !a.restore;
    this.ops.push(...ops);
    this.history.commit({
      label: a.restore ? 'Restore surface' : 'Erase surface', bytes: [...a.changes.values()].reduce((n, ids) => n + ids.length * 4, 0) + count * 40,
      undo: () => { apply(!value); this.ops.splice(this.ops.length - count, count); },
      redo: () => { apply(value); this.ops.push(...ops); }
    });
  }
  // The saved file: every dab in order, in the asset's own space (see ExportManager.eraseList).
  get count() { return this.ops.length; }
}
