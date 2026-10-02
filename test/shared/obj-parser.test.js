import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseObj, ObjParseError, meshBounds } from '../../shared/obj-parser.js';

const QUAD = `
# a unit quad
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 1
f 1/1/1 2/2/1 3/3/1 4/4/1
`;

test('quads are triangulated and vertices shared', () => {
  const { meshes } = parseObj(QUAD, 'Quad');
  assert.equal(meshes.length, 1);
  const m = meshes[0];
  assert.equal(m.name, 'Quad');
  assert.deepEqual(m.indices, [0, 1, 2, 0, 2, 3]);
  assert.equal(m.positions.length, 12);
  assert.equal(m.uvs.length, 8);
  assert.deepEqual(m.normals.slice(0, 3), [0, 0, 1]);
});

test('negative indices and missing normals are handled', () => {
  const { meshes } = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n');
  const m = meshes[0];
  assert.deepEqual(m.indices, [0, 1, 2]);
  assert.deepEqual(m.normals.slice(0, 3).map((n) => Math.round(n)), [0, 0, 1]);
  assert.deepEqual(m.uvs, []);
});

test('o statements split meshes', () => {
  const text = 'v 0 0 0\nv 1 0 0\nv 0 1 0\no A\nf 1 2 3\no B\nf 3 2 1\n';
  const { meshes } = parseObj(text);
  assert.deepEqual(meshes.map((m) => m.name), ['A', 'B']);
});

test('broken files raise ObjParseError', () => {
  assert.throws(() => parseObj('v 0 0 0\nf 1 2 9\n'), ObjParseError);
  assert.throws(() => parseObj('v a b c\n'), ObjParseError);
  assert.throws(() => parseObj('v 0 0 0\n'), /no faces/);
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nf 1 2\n'), /fewer than 3/);
});

test('meshBounds finds min and max', () => {
  assert.deepEqual(meshBounds([0, 0, 0, 1, -2, 3]), { min: [0, -2, 0], max: [1, 0, 3] });
});
