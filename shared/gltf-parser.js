// Minimal glTF 2.0 reader (.gltf with embedded buffers, and .glb) that
// extracts triangle meshes, base colors and the node hierarchy as Vox mesh
// data. Shared by the agent and the studio; dependency-free.
//
// Not supported (reported as errors or ignored): external .bin/.png files,
// sparse accessors, Draco/meshopt compression, textures, skins, animation.

export class GltfParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GltfParseError';
  }
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPES = {
  5120: [Int8Array, 1],
  5121: [Uint8Array, 1],
  5122: [Int16Array, 2],
  5123: [Uint16Array, 2],
  5125: [Uint32Array, 4],
  5126: [Float32Array, 4],
};
const MAX_VERTICES = 2_000_000;

function decodeBase64(text) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeUtf8(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

/** Split a .glb container into its JSON and binary chunks. */
export function readGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new GltfParseError('Not a GLB file');
  if (view.getUint32(4, true) !== 2) throw new GltfParseError('Only glTF 2.0 is supported');
  const length = Math.min(view.getUint32(8, true), bytes.byteLength);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= length) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + chunkLength > length) throw new GltfParseError('GLB chunk exceeds file size');
    const chunk = bytes.subarray(start, start + chunkLength);
    if (chunkType === CHUNK_JSON) json = JSON.parse(decodeUtf8(chunk));
    else if (chunkType === CHUNK_BIN && !bin) bin = chunk;
    offset = start + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  if (!json) throw new GltfParseError('GLB has no JSON chunk');
  return { json, bin };
}

function loadBuffers(json, bin) {
  return (json.buffers || []).map((buffer, i) => {
    if (buffer.uri === undefined) {
      if (i === 0 && bin) return bin;
      throw new GltfParseError(`Buffer ${i} has no data`);
    }
    const match = /^data:[^;,]*;base64,(.*)$/s.exec(buffer.uri);
    if (!match) throw new GltfParseError('External buffer files are not supported; export as .glb or embedded .gltf');
    return decodeBase64(match[1]);
  });
}

function readAccessor(json, buffers, index) {
  const accessor = json.accessors?.[index];
  if (!accessor) throw new GltfParseError(`Missing accessor ${index}`);
  if (accessor.sparse) throw new GltfParseError('Sparse accessors are not supported');
  const [Type, size] = TYPES[accessor.componentType] || [];
  const components = COMPONENTS[accessor.type];
  if (!Type || !components) throw new GltfParseError('Unsupported accessor type');
  const count = accessor.count;
  if (!Number.isInteger(count) || count < 0 || count > MAX_VERTICES * 3) throw new GltfParseError('Accessor count out of range');
  const out = new Array(count * components);
  if (accessor.bufferView === undefined) return out.fill(0);
  const bufferView = json.bufferViews?.[accessor.bufferView];
  const buffer = buffers[bufferView?.buffer];
  if (!bufferView || !buffer) throw new GltfParseError('Missing buffer view');
  const base = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = bufferView.byteStride || size * components;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const end = base + stride * (count - 1) + size * components;
  if (count > 0 && end > buffer.byteLength) throw new GltfParseError('Accessor reads past the end of its buffer');
  const get = {
    5120: (o) => view.getInt8(o),
    5121: (o) => view.getUint8(o),
    5122: (o) => view.getInt16(o, true),
    5123: (o) => view.getUint16(o, true),
    5125: (o) => view.getUint32(o, true),
    5126: (o) => view.getFloat32(o, true),
  }[accessor.componentType];
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < components; c++) out[i * components + c] = get(base + i * stride + c * size);
  }
  return out;
}

function linearToSrgb(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

function baseColor(json, materialIndex) {
  const factor = json.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorFactor;
  if (!Array.isArray(factor)) return null;
  return '#' + factor.slice(0, 3).map((c) => linearToSrgb(Number(c) || 0).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Euler angles (degrees, Y-X-Z order) from a quaternion [x, y, z, w]. */
export function quaternionToEulerYXZ([x, y, z, w]) {
  const m11 = 1 - 2 * (y * y + z * z);
  const m13 = 2 * (x * z + y * w);
  const m21 = 2 * (x * y + z * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m31 = 2 * (x * z - y * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const deg = 180 / Math.PI;
  const ex = Math.asin(-Math.min(1, Math.max(-1, m23)));
  let ey;
  let ez;
  if (Math.abs(m23) < 0.9999999) {
    ey = Math.atan2(m13, m33);
    ez = Math.atan2(m21, m22);
  } else {
    ey = Math.atan2(-m31, m11);
    ez = 0;
  }
  const r = (v) => Math.round(v * deg * 1e4) / 1e4 + 0;
  return [r(ex), r(ey), r(ez)];
}

/** Translation, rotation (quaternion) and scale from a column-major 4x4 matrix. */
function decompose(m) {
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  const r = [m[0] / sx, m[1] / sx, m[2] / sx, m[4] / sy, m[5] / sy, m[6] / sy, m[8] / sz, m[9] / sz, m[10] / sz];
  // Rotation matrix (column-major) to quaternion.
  const [m11, m21, m31, m12, m22, m32, m13, m23, m33] = r;
  const trace = m11 + m22 + m33;
  let q;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    q = [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    q = [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    q = [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
  }
  return { translation: [m[12], m[13], m[14]], rotation: q, scale: [sx, sy, sz] };
}

function nodeTransform(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    const d = decompose(node.matrix.map(Number));
    return { position: d.translation, rotation: quaternionToEulerYXZ(d.rotation), scale: d.scale };
  }
  return {
    position: Array.isArray(node.translation) ? node.translation.map(Number) : [0, 0, 0],
    rotation: Array.isArray(node.rotation) ? quaternionToEulerYXZ(node.rotation.map(Number)) : [0, 0, 0],
    scale: Array.isArray(node.scale) ? node.scale.map(Number) : [1, 1, 1],
  };
}

/** Merge a glTF mesh's triangle primitives into one Vox mesh. */
function convertMesh(json, buffers, mesh, index) {
  const out = { name: mesh.name || `Mesh${index}`, positions: [], normals: [], uvs: [], indices: [], extra: {} };
  let hasNormals = true;
  let hasUvs = true;
  for (const prim of mesh.primitives || []) {
    if ((prim.mode ?? 4) !== 4) continue;
    const attrs = prim.attributes || {};
    if (attrs.POSITION === undefined) continue;
    const base = out.positions.length / 3;
    const positions = readAccessor(json, buffers, attrs.POSITION);
    const count = positions.length / 3;
    if (base + count > MAX_VERTICES) throw new GltfParseError('Model has too many vertices');
    out.positions.push(...positions);
    if (attrs.NORMAL !== undefined) out.normals.push(...readAccessor(json, buffers, attrs.NORMAL));
    else {
      hasNormals = false;
      out.normals.push(...new Array(count * 3).fill(0));
    }
    if (attrs.TEXCOORD_0 !== undefined) out.uvs.push(...readAccessor(json, buffers, attrs.TEXCOORD_0));
    else {
      hasUvs = false;
      out.uvs.push(...new Array(count * 2).fill(0));
    }
    const idx = prim.indices !== undefined ? readAccessor(json, buffers, prim.indices) : [...Array(count).keys()];
    for (const i of idx) {
      if (i >= count) throw new GltfParseError('Index out of range');
      out.indices.push(i + base);
    }
    if (!out.extra.color) {
      const color = baseColor(json, prim.material);
      if (color) out.extra.color = color;
    }
  }
  if (!out.positions.length) return null;
  if (!hasNormals) out.normals = [];
  if (!hasUvs) out.uvs = [];
  return out;
}

/**
 * Parse glTF. `input` is a Uint8Array (.glb or .gltf bytes) or a string
 * (.gltf JSON). Returns { meshes, nodes } where nodes is a tree:
 * { name, mesh (index into meshes or null), transform, children }.
 */
export function parseGltf(input, fallbackName = 'Model', onProgress = null) {
  let json;
  let bin = null;
  try {
    if (typeof input === 'string') json = JSON.parse(input);
    else if (input instanceof Uint8Array) {
      if (input.byteLength >= 4 && new DataView(input.buffer, input.byteOffset).getUint32(0, true) === GLB_MAGIC) ({ json, bin } = readGlb(input));
      else json = JSON.parse(decodeUtf8(input));
    } else throw new GltfParseError('Unsupported input');
  } catch (err) {
    if (err instanceof GltfParseError) throw err;
    throw new GltfParseError('File is not valid glTF JSON');
  }
  if (!json || typeof json !== 'object') throw new GltfParseError('File is not glTF');
  if (!String(json.asset?.version || '').startsWith('2')) throw new GltfParseError('Only glTF 2.0 is supported');
  const required = json.extensionsRequired || [];
  if (required.length) throw new GltfParseError(`Required extensions are not supported: ${required.join(', ')}`);

  const buffers = loadBuffers(json, bin);
  const meshes = [];
  const meshMap = new Map();
  (json.meshes || []).forEach((mesh, i) => {
    onProgress?.(i / Math.max(1, json.meshes.length));
    const converted = convertMesh(json, buffers, mesh, i);
    if (converted) {
      meshMap.set(i, meshes.length);
      meshes.push(converted);
    }
  });
  if (!meshes.length) throw new GltfParseError('No triangle meshes found');

  const nodes = json.nodes || [];
  const visited = new Set();
  const buildNode = (index, depth) => {
    if (visited.has(index) || depth > 64 || !nodes[index]) return null;
    visited.add(index);
    const node = nodes[index];
    return {
      name: node.name || (node.mesh !== undefined ? meshes[meshMap.get(node.mesh)]?.name : null) || `Node${index}`,
      mesh: node.mesh !== undefined && meshMap.has(node.mesh) ? meshMap.get(node.mesh) : null,
      transform: nodeTransform(node),
      children: (node.children || []).map((c) => buildNode(c, depth + 1)).filter(Boolean),
    };
  };
  const sceneIndex = json.scene ?? 0;
  const roots = json.scenes?.[sceneIndex]?.nodes ?? nodes.map((_, i) => i).filter((i) => !nodes.some((n) => n.children?.includes(i)));
  let tree = roots.map((i) => buildNode(i, 0)).filter(Boolean);
  if (!tree.length) tree = meshes.map((m, i) => ({ name: m.name, mesh: i, transform: null, children: [] }));
  return { meshes, nodes: { name: fallbackName, mesh: null, transform: null, children: tree } };
}
