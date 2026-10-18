import * as THREE from 'three';

// The editor keeps reversible erase flags. This packs only the exported copy.
function remapAttribute(attribute, vertices) {
  const data = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
  const stride = attribute.isInterleavedBufferAttribute ? data.stride : attribute.itemSize;
  const offset = attribute.isInterleavedBufferAttribute ? attribute.offset : 0;
  const values = new data.array.constructor(vertices.length * attribute.itemSize);
  for (let i = 0; i < vertices.length; i++) {
    const source = vertices[i] * stride + offset;
    for (let k = 0; k < attribute.itemSize; k++) values[i * attribute.itemSize + k] = data.array[source + k];
  }
  const result = new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized);
  result.name = attribute.name;
  result.gpuType = attribute.gpuType;
  return result;
}

export function compactErasedGeometry(geometry, erased) {
  const index = geometry.index, positions = geometry.getAttribute('position');
  if (!index || !positions || !erased?.some(Boolean)) return geometry.clone();
  if (erased.length !== index.count / 3) throw new Error('Erase state does not match mesh triangles.');

  const remap = new Int32Array(positions.count).fill(-1), vertices = [], indices = [], groups = [];
  const ranges = geometry.groups.length ? geometry.groups : [{ start: 0, count: index.count, materialIndex: 0 }];
  const drawStart = geometry.drawRange.start, drawEnd = drawStart + geometry.drawRange.count;
  for (const range of ranges) {
    const start = indices.length;
    const from = Math.max(range.start, drawStart), to = Math.min(range.start + range.count, drawEnd, index.count);
    for (let i = from; i + 2 < to; i += 3) {
      if (erased[i / 3]) continue;
      for (let corner = 0; corner < 3; corner++) {
        const old = index.getX(i + corner);
        if (remap[old] === -1) { remap[old] = vertices.length; vertices.push(old); }
        indices.push(remap[old]);
      }
    }
    if (geometry.groups.length && indices.length > start) groups.push({ start, count: indices.length - start, materialIndex: range.materialIndex });
  }

  const packed = new THREE.BufferGeometry();
  packed.name = geometry.name;
  packed.userData = { ...geometry.userData };
  for (const [name, attribute] of Object.entries(geometry.attributes)) packed.setAttribute(name, remapAttribute(attribute, vertices));
  for (const [name, attributes] of Object.entries(geometry.morphAttributes)) packed.morphAttributes[name] = attributes.map(attribute => remapAttribute(attribute, vertices));
  packed.morphTargetsRelative = geometry.morphTargetsRelative;
  packed.setIndex(indices);
  for (const group of groups) packed.addGroup(group.start, group.count, group.materialIndex);
  return packed;
}
