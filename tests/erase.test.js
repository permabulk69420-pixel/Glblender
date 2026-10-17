import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HistoryManager } from '../src/core/HistoryManager.js';
import { EraseTool } from '../src/tools/EraseTool.js';
import { buildGrid, dab, setErased } from '../src/tools/eraseMath.js';

const visible = geo => { let n = 0; const i = geo.index.array; for (let t = 0; t < i.length; t += 3) if (i[t] !== i[t + 1] || i[t + 1] !== i[t + 2]) n++; return n; };
const rig = () => {
  const root = new THREE.Group(), geo = new THREE.PlaneGeometry(10, 10, 20, 20).rotateX(-Math.PI / 2), mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  root.add(mesh); root.scale.setScalar(2); root.position.set(5, 0, 0); root.updateMatrixWorld(true);
  const listeners = [], asset = { root, meshes: [mesh], on: (n, f) => listeners.push(f) };
  const shape = { kind: 'erase', radius: 1, hover() {}, brush: { visible: true } }, history = new HistoryManager();
  return { root, geo, mesh, asset, shape, history, tool: new EraseTool(history, asset, shape) };
};

test('a dab hides only triangles inside the brush and restore brings them back', () => {
  const { geo, mesh, tool } = rig(), total = visible(geo), length = geo.index.count;
  const s = tool.state(mesh); s.grid = buildGrid(geo.attributes.position, s.original);
  const ids = dab({ grid: s.grid, index: geo.index, original: s.original, erased: s.erased, toRoot: new THREE.Matrix4(), centre: new THREE.Vector3(0, 0, 0), radius: 1.5, scale: 1, restore: false });
  assert.ok(ids.length > 0 && ids.length < total);
  assert.equal(visible(geo), total - ids.length); assert.equal(geo.index.count, length);
  assert.equal(dab({ grid: s.grid, index: geo.index, original: s.original, erased: s.erased, toRoot: new THREE.Matrix4(), centre: new THREE.Vector3(0, 0, 0), radius: 1.5, scale: 1, restore: false }).length, 0);
  const back = dab({ grid: s.grid, index: geo.index, original: s.original, erased: s.erased, toRoot: new THREE.Matrix4(), centre: new THREE.Vector3(0, 0, 0), radius: 5, scale: 1, restore: true });
  assert.equal(back.length, ids.length); assert.equal(visible(geo), total); assert.deepEqual([...geo.index.array], [...s.original]);
});

test('a stroke is one undo, logs its dabs in asset space and survives redo', () => {
  const { geo, tool, history } = rig(), total = visible(geo);
  tool.shape.radius = 1; assert.ok(tool.begin(new THREE.Vector3(5, 0, 0), 1));
  tool.update(new THREE.Vector3(7, 0, 0)); tool.end();
  const after = visible(geo); assert.ok(after < total); assert.equal(history.undoStack.length, 1);
  assert.equal(tool.count, 2);
  const [x, , , r, flag] = tool.ops[0]; assert.ok(Math.abs(x) < 1e-6); assert.ok(Math.abs(r - 0.5) < 1e-6); assert.equal(flag, 0);
  history.undo(); assert.equal(visible(geo), total); assert.equal(tool.count, 0);
  history.redo(); assert.equal(visible(geo), after); assert.equal(tool.count, 2);
});

test('restore brush undoes an earlier erase and a cancelled stroke leaves no trace', () => {
  const { geo, tool, history } = rig(), total = visible(geo);
  tool.begin(new THREE.Vector3(5, 0, 0), 1); tool.end(); const erased = visible(geo);
  tool.shape.kind = 'restore'; tool.begin(new THREE.Vector3(5, 0, 0), 1); tool.end();
  assert.equal(visible(geo), total); assert.equal(tool.ops.at(-1)[4], 1);
  tool.shape.kind = 'erase'; tool.begin(new THREE.Vector3(8, 0, 0), 1); tool.end(true);
  assert.equal(visible(geo), total); assert.equal(history.undoStack.length, 2);
  history.undo(); assert.equal(visible(geo), erased);
});

test('non-indexed geometry gets an index and setErased is reversible', () => {
  const root = new THREE.Group(), geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), mesh = new THREE.Mesh(geo);
  root.add(mesh); const asset = { root, meshes: [mesh], on() {} }, tool = new EraseTool(new HistoryManager(), asset, { kind: 'erase', radius: 1, hover() {}, brush: {} });
  const s = tool.state(mesh); assert.equal(geo.index.count, geo.attributes.position.count);
  setErased(geo.index, s.original, s.erased, [0, 1], true); assert.equal(visible(geo), 10);
  setErased(geo.index, s.original, s.erased, [0, 1], false); assert.equal(visible(geo), 12);
});
