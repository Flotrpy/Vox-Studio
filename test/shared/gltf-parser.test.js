import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGltf, quaternionToEulerYXZ, GltfParseError } from '../../shared/gltf-parser.js';

/** Build a one-triangle glTF; returns { json, bin }. */
function triangle() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2, 0]); // padded to 4-byte multiple
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const s = Math.SQRT1_2;
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Root', translation: [1, 2, 3], rotation: [0, s, 0, s], children: [1] },
      { name: 'Tri', mesh: 0, scale: [2, 2, 2] },
    ],
    meshes: [{ name: 'TriMesh', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
  return { json, bin };
}

function glb({ json, bin }) {
  const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const ch = (len, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return new Uint8Array(Buffer.concat([header, ch(jsonChunk.length, 0x4e4f534a), jsonChunk, ch(binChunk.length, 0x004e4942), binChunk]));
}

test('GLB triangles, colors and node transforms are read', () => {
  const result = parseGltf(glb(triangle()), 'Tri');
  assert.equal(result.meshes.length, 1);
  const mesh = result.meshes[0];
  assert.deepEqual(mesh.positions, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(mesh.indices, [0, 1, 2]);
  assert.equal(mesh.extra.color, '#FF0000');
  const root = result.nodes.children[0];
  assert.equal(root.name, 'Root');
  assert.deepEqual(root.transform.position, [1, 2, 3]);
  assert.deepEqual(root.transform.rotation, [0, 90, 0]);
  assert.equal(root.children[0].mesh, 0);
  assert.deepEqual(root.children[0].transform.scale, [2, 2, 2]);
});

test('embedded .gltf with a data URI buffer is read', () => {
  const { json, bin } = triangle();
  json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  const result = parseGltf(JSON.stringify(json));
  assert.equal(result.meshes[0].positions.length, 9);
});

test('external buffers and bad files are rejected', () => {
  const { json } = triangle();
  json.buffers[0].uri = 'model.bin';
  assert.throws(() => parseGltf(JSON.stringify(json)), /External buffer/);
  assert.throws(() => parseGltf('not json'), GltfParseError);
  assert.throws(() => parseGltf(JSON.stringify({ asset: { version: '1.0' } })), /2.0/);
  const tri = triangle();
  tri.json.accessors[0].count = 1000;
  assert.throws(() => parseGltf(glb(tri)), /past the end/);
});

test('quaternion to Euler conversion', () => {
  assert.deepEqual(quaternionToEulerYXZ([0, 0, 0, 1]), [0, 0, 0]);
  const s = Math.SQRT1_2;
  assert.deepEqual(quaternionToEulerYXZ([s, 0, 0, s]), [90, 0, 0]);
  assert.deepEqual(quaternionToEulerYXZ([0, 0, s, s]), [0, 0, 90]);
});
