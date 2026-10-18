import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// A ray against every triangle of a scanned model is far too slow to run every frame, per controller. Dense plain meshes get a BVH
// the first time a ray comes near them (indirect, so the triangle order, and with it erasing, is untouched), and a ray only visits
// meshes whose bounds it crosses. Small meshes keep the plain test.
const DENSE = 2500, sphere = new THREE.Sphere();

export function ensureBounds(mesh) {
  const g = mesh.geometry;
  if (g.boundsTree || mesh.isSkinnedMesh || mesh.isInstancedMesh || Object.keys(g.morphAttributes || {}).length) return;
  if ((g.index?.count ?? g.attributes.position.count) / 3 < DENSE) return;
  g.computeBoundsTree({ indirect: true });
}

export function pick(raycaster, meshes, visible = () => true) {
  const hits = [], previous = raycaster.firstHitOnly; raycaster.firstHitOnly = true;
  for (const mesh of meshes) {
    if (!visible(mesh)) continue;
    const g = mesh.geometry; if (!g?.attributes.position) continue;
    if (!g.boundingSphere) g.computeBoundingSphere();
    sphere.copy(g.boundingSphere).applyMatrix4(mesh.matrixWorld);
    if (!raycaster.ray.intersectsSphere(sphere)) continue;
    ensureBounds(mesh);
    for (const hit of raycaster.intersectObject(mesh, false)) hits.push(hit);
  }
  raycaster.firstHitOnly = previous;
  return hits.sort((a, b) => a.distance - b.distance);
}

// After a shape stroke moves vertices the tree keeps its triangles, so it only needs its boxes refitted.
export function refit(mesh) { mesh.geometry.boundsTree?.refit?.(); }
