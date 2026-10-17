import * as THREE from 'three';

// Erasing triangles without changing a geometry's size or order: an erased triangle becomes degenerate (all three corners the same
// vertex), so the GPU skips it and any BVH over the mesh stays valid. `original` is the untouched index and `erased` flags the
// triangles that are currently hidden, which is all undo, redo and Restore need.

const _v = new THREE.Vector3(), _c = new THREE.Vector3();

// A uniform grid over triangle centroids in mesh-local space, so one brush dab only looks at the triangles near it.
export function buildGrid(position, original) {
  const triangles = original.length / 3, centroids = new Float32Array(triangles * 3), box = new THREE.Box3();
  for (let t = 0; t < triangles; t++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { const i = original[t * 3 + k]; x += position.getX(i); y += position.getY(i); z += position.getZ(i); }
    centroids[t * 3] = x / 3; centroids[t * 3 + 1] = y / 3; centroids[t * 3 + 2] = z / 3;
    box.expandByPoint(_v.set(centroids[t * 3], centroids[t * 3 + 1], centroids[t * 3 + 2]));
  }
  const size = box.getSize(new THREE.Vector3()), cell = Math.max(size.x, size.y, size.z, 1e-6) / Math.min(48, Math.max(4, Math.cbrt(triangles / 8)));
  const cells = new Map(), key = (i, j, k) => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < triangles; t++) {
    const c = [0, 1, 2].map(a => Math.floor(centroids[t * 3 + a] / cell));
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], c[a]); hi[a] = Math.max(hi[a], c[a]); }
    const id = key(c[0], c[1], c[2]), list = cells.get(id); if (list) list.push(t); else cells.set(id, [t]);
  }
  return { cell, cells, centroids, key, triangles, lo, hi };
}

// Triangle ids whose local centroid might be within `radius` of `centre`.
export function nearby(grid, centre, radius) {
  const { cell, cells, key } = grid, out = [];
  // clamped to the cells that hold triangles, so a huge brush cannot loop over empty space
  const lo = [centre.x - radius, centre.y - radius, centre.z - radius].map((v, a) => Math.max(Math.floor(v / cell), grid.lo[a])), hi = [centre.x + radius, centre.y + radius, centre.z + radius].map((v, a) => Math.min(Math.floor(v / cell), grid.hi[a]));
  for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) { const list = cells.get(key(i, j, k)); if (list) for (const t of list) out.push(t); }
  return out;
}

export function setTriangle(index, original, t, erased) {
  const a = original[t * 3];
  index.array[t * 3] = a; index.array[t * 3 + 1] = erased ? a : original[t * 3 + 1]; index.array[t * 3 + 2] = erased ? a : original[t * 3 + 2];
}

// One brush dab, tested in the asset's own (root) space so that the same stroke list gives the same result in the build script.
// `toRoot` maps mesh-local to root space; `centre` is in root space; `scale` is how much longer a mesh-local unit is in root space.
export function dab({ grid, index, original, erased, toRoot, centre, radius, scale, restore }) {
  const inverse = new THREE.Matrix4().copy(toRoot).invert(), local = _c.copy(centre).applyMatrix4(inverse).clone();
  const changed = [], r2 = radius * radius;
  for (const t of nearby(grid, local, radius / Math.max(scale, 1e-9) * 1.05)) {
    if (restore ? !erased[t] : erased[t]) continue;
    _v.set(grid.centroids[t * 3], grid.centroids[t * 3 + 1], grid.centroids[t * 3 + 2]).applyMatrix4(toRoot);
    if (_v.distanceToSquared(centre) > r2) continue;
    erased[t] = restore ? 0 : 1; setTriangle(index, original, t, !restore); changed.push(t);
  }
  return changed;
}

export function setErased(index, original, erased, ids, value) {
  for (const t of ids) { erased[t] = value ? 1 : 0; setTriangle(index, original, t, value); }
}
