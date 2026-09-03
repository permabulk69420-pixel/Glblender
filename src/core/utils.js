import * as THREE from 'three';

export const clamp = THREE.MathUtils.clamp;
export const materialsOf = node => Array.isArray(node?.material) ? node.material : node?.material ? [node.material] : [];
export const displayName = node => node?.userData?.glblenderSceneRoot && node.name==='AuxScene' ? 'Asset scene' : node?.userData?.glblenderSourceName || node?.userData?.name || node?.name || (node?.isMesh ? 'Unnamed mesh' : 'Group');
export const formatCount = n => n >= 1000000 ? `${(n / 1000000).toFixed(1)}m` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
export const escapeHTML = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const isEditableMesh = node => !!node?.isMesh && !node.isSkinnedMesh && !node.isInstancedMesh && !Object.keys(node.geometry.morphAttributes || {}).length;

// Bounds in asset coordinates, with the presentation rig explicitly removed.
// Viewing an asset at tabletop scale must never change its exported dimensions.
export function assetBounds(root) {
  root.updateWorldMatrix(true, true);
  const inverse = root.parent ? root.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
  const box = new THREE.Box3();
  const matrix = new THREE.Matrix4();
  const part = new THREE.Box3();
  root.traverse(node => {
    if (!node.isMesh || !node.geometry?.attributes.position) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    matrix.multiplyMatrices(inverse, node.matrixWorld);
    part.copy(node.geometry.boundingBox).applyMatrix4(matrix);
    box.union(part);
  });
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  return box;
}

export function transformState(node) {
  return { position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray() };
}
export function applyTransform(node, state) {
  node.position.fromArray(state.position);
  node.quaternion.fromArray(state.quaternion);
  node.scale.fromArray(state.scale);
  node.updateMatrix();
  node.updateWorldMatrix(false, true);
}
export const sameTransform = (a, b) => ['position', 'quaternion', 'scale'].every(k => a[k].every((v, i) => Math.abs(v - b[k][i]) < 1e-7));

export function disposeTree(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root?.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of materialsOf(node)) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  for (const t of textures) { t.dispose(); t.source?.data?.close?.(); }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
