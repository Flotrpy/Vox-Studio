// Vox scene format (.voxscene) and mesh format (.voxmesh).
//
// This module is shared by the Vox Agent (Node) and Vox Studio (browser) and
// must stay dependency-free: no imports, no DOM, no Node APIs.

export const SCENE_FORMAT = 'voxscene';
export const SCENE_VERSION = 1;
export const MESH_FORMAT = 'voxmesh';
export const MESH_VERSION = 1;
export const SCENE_EXTENSION = '.voxscene';
export const MESH_EXTENSION = '.voxmesh';

export const LIMITS = Object.freeze({
  entities: 20000,
  components: 32,
  name: 128,
  tag: 64,
  scriptCode: 200000,
  meshNumbers: 6000000,
  assets: 1000,
});

export const PRIMITIVES = Object.freeze(['Cube', 'Sphere', 'Plane', 'Cylinder']);
export const TAGS = Object.freeze(['Untagged', 'Player', 'MainCamera', 'EditorOnly', 'Respawn', 'Finish', 'GameController']);
export const LAYERS = Object.freeze(['Default', 'TransparentFX', 'Ignore Raycast', 'Water', 'UI']);

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export class SceneFormatError extends Error {
  constructor(message, path) {
    super(path ? `${path}: ${message}` : message);
    this.path = path;
  }
}

/**
 * Component schemas. Each field has a type, default and limits; the
 * inspector renders fields from the same table, so a field added here
 * shows up in the editor automatically.
 */
export const COMPONENT_SCHEMAS = Object.freeze({
  MeshFilter: {
    category: 'Mesh',
    unique: true,
    fields: {
      mesh: { type: 'mesh', label: 'Mesh', default: 'Cube' },
    },
  },
  MeshRenderer: {
    category: 'Mesh',
    unique: true,
    fields: {
      color: { type: 'color', label: 'Color', default: '#C8C8C8' },
      metalness: { type: 'number', label: 'Metallic', min: 0, max: 1, default: 0, slider: true },
      roughness: { type: 'number', label: 'Smoothness', min: 0, max: 1, default: 0.5, slider: true, invert: true },
      castShadows: { type: 'bool', label: 'Cast Shadows', default: true },
      receiveShadows: { type: 'bool', label: 'Receive Shadows', default: true },
    },
  },
  Light: {
    category: 'Rendering',
    unique: true,
    fields: {
      lightType: { type: 'enum', label: 'Type', values: ['Directional', 'Point', 'Spot'], default: 'Directional' },
      color: { type: 'color', label: 'Color', default: '#FFF4D6' },
      intensity: { type: 'number', label: 'Intensity', min: 0, max: 100, default: 1 },
      range: { type: 'number', label: 'Range', min: 0, max: 10000, default: 10 },
      spotAngle: { type: 'number', label: 'Spot Angle', min: 1, max: 179, default: 30 },
      castShadows: { type: 'bool', label: 'Cast Shadows', default: true },
    },
  },
  Camera: {
    category: 'Rendering',
    unique: true,
    fields: {
      clearColor: { type: 'color', label: 'Background', default: '#30394A' },
      orthographic: { type: 'bool', label: 'Orthographic', default: false },
      fov: { type: 'number', label: 'Field of View', min: 1, max: 179, default: 60 },
      size: { type: 'number', label: 'Size', min: 0.01, max: 10000, default: 5 },
      near: { type: 'number', label: 'Clipping Near', min: 0.001, max: 10000, default: 0.3 },
      far: { type: 'number', label: 'Clipping Far', min: 0.01, max: 100000, default: 1000 },
    },
  },
  Rigidbody: {
    category: 'Physics',
    unique: true,
    fields: {
      mass: { type: 'number', label: 'Mass', min: 0.0001, max: 1e7, default: 1 },
      drag: { type: 'number', label: 'Drag', min: 0, max: 1000, default: 0 },
      useGravity: { type: 'bool', label: 'Use Gravity', default: true },
      isKinematic: { type: 'bool', label: 'Is Kinematic', default: false },
      bounciness: { type: 'number', label: 'Bounciness', min: 0, max: 1, default: 0.1, slider: true },
      friction: { type: 'number', label: 'Friction', min: 0, max: 1, default: 0.4, slider: true },
    },
  },
  BoxCollider: {
    category: 'Physics',
    unique: false,
    fields: {
      isTrigger: { type: 'bool', label: 'Is Trigger', default: false },
      center: { type: 'vec3', label: 'Center', default: [0, 0, 0] },
      size: { type: 'vec3', label: 'Size', default: [1, 1, 1], min: 0 },
    },
  },
  SphereCollider: {
    category: 'Physics',
    unique: false,
    fields: {
      isTrigger: { type: 'bool', label: 'Is Trigger', default: false },
      center: { type: 'vec3', label: 'Center', default: [0, 0, 0] },
      radius: { type: 'number', label: 'Radius', min: 0, max: 1e6, default: 0.5 },
    },
  },
  MeshCollider: {
    category: 'Physics',
    unique: false,
    fields: {
      isTrigger: { type: 'bool', label: 'Is Trigger', default: false },
    },
  },
  Script: {
    category: 'Scripts',
    unique: false,
    fields: {
      name: { type: 'string', label: 'Script', default: 'NewBehaviour', max: 64 },
      code: { type: 'code', label: 'Source', default: '', max: LIMITS.scriptCode },
    },
  },
});

export const COMPONENT_TYPES = Object.freeze(Object.keys(COMPONENT_SCHEMAS));

function clone(value) {
  return Array.isArray(value) ? value.slice() : value;
}

/** Create a component of `type` with defaults, applying `overrides`. */
export function createComponent(type, overrides = {}) {
  const schema = COMPONENT_SCHEMAS[type];
  if (!schema) throw new SceneFormatError(`Unknown component type "${type}"`);
  const component = { type, enabled: true };
  for (const [key, field] of Object.entries(schema.fields)) {
    component[key] = clone(key in overrides ? overrides[key] : field.default);
  }
  if ('enabled' in overrides) component.enabled = !!overrides.enabled;
  return component;
}

/** Default transform: origin, no rotation, unit scale. */
export function createTransform() {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

export function defaultSettings() {
  return {
    background: '#30394A',
    ambientColor: '#6A6F7A',
    ambientIntensity: 1,
    gravity: [0, -9.81, 0],
  };
}

/** A new, empty scene document. */
export function createSceneData(name = 'Untitled') {
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    name,
    settings: defaultSettings(),
    entities: [],
    assets: {},
  };
}

// ---------------------------------------------------------------------------
// Validation helpers. Each returns a cleaned value or throws SceneFormatError.

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function num(v, path, min = -1e9, max = 1e9) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SceneFormatError('expected a finite number', path);
  if (v < min || v > max) throw new SceneFormatError(`must be between ${min} and ${max}`, path);
  return v;
}

function vec3(v, path, min, max) {
  if (!Array.isArray(v) || v.length !== 3) throw new SceneFormatError('expected [x, y, z]', path);
  return v.map((n, i) => num(n, `${path}[${i}]`, min, max));
}

function str(v, path, max) {
  if (typeof v !== 'string') throw new SceneFormatError('expected a string', path);
  if (v.length > max) throw new SceneFormatError(`longer than ${max} characters`, path);
  return v;
}

function bool(v, path) {
  if (typeof v !== 'boolean') throw new SceneFormatError('expected true or false', path);
  return v;
}

function color(v, path) {
  if (typeof v !== 'string' || !COLOR_PATTERN.test(v)) throw new SceneFormatError('expected a color like #RRGGBB', path);
  return v.toUpperCase();
}

function id(v, path) {
  if (typeof v !== 'string' || !ID_PATTERN.test(v)) throw new SceneFormatError('invalid id', path);
  return v;
}

function field(def, value, path, assets) {
  switch (def.type) {
    case 'number':
      return num(value, path, def.min, def.max);
    case 'bool':
      return bool(value, path);
    case 'color':
      return color(value, path);
    case 'vec3':
      return vec3(value, path, def.min, def.max);
    case 'string':
    case 'code':
      return str(value, path, def.max);
    case 'enum':
      if (!def.values.includes(value)) throw new SceneFormatError(`expected one of ${def.values.join(', ')}`, path);
      return value;
    case 'mesh':
      if (PRIMITIVES.includes(value)) return value;
      if (typeof value === 'string' && value.startsWith('asset:') && assets && value.slice(6) in assets) return value;
      if (value === '') return value;
      throw new SceneFormatError('unknown mesh', path);
    default:
      throw new SceneFormatError(`unsupported field type ${def.type}`, path);
  }
}

function validateComponent(raw, path, assets) {
  if (!isObject(raw)) throw new SceneFormatError('expected an object', path);
  const schema = COMPONENT_SCHEMAS[raw.type];
  if (!schema) throw new SceneFormatError(`unknown component type "${raw.type}"`, path);
  const out = { type: raw.type, enabled: raw.enabled === undefined ? true : bool(raw.enabled, `${path}.enabled`) };
  for (const [key, def] of Object.entries(schema.fields)) {
    out[key] = key in raw ? field(def, raw[key], `${path}.${key}`, assets) : clone(def.default);
  }
  return out;
}

function validateTransform(raw, path) {
  if (raw === undefined) return createTransform();
  if (!isObject(raw)) throw new SceneFormatError('expected an object', path);
  return {
    position: raw.position === undefined ? [0, 0, 0] : vec3(raw.position, `${path}.position`),
    rotation: raw.rotation === undefined ? [0, 0, 0] : vec3(raw.rotation, `${path}.rotation`),
    scale: raw.scale === undefined ? [1, 1, 1] : vec3(raw.scale, `${path}.scale`),
  };
}

function numberArray(v, path, budget, integer = false) {
  if (!Array.isArray(v)) throw new SceneFormatError('expected an array of numbers', path);
  budget.used += v.length;
  if (budget.used > LIMITS.meshNumbers) throw new SceneFormatError('mesh data is too large', path);
  for (let i = 0; i < v.length; i++) {
    const n = v[i];
    if (typeof n !== 'number' || !Number.isFinite(n) || (integer && (!Number.isInteger(n) || n < 0))) {
      throw new SceneFormatError('invalid number', `${path}[${i}]`);
    }
  }
  return v;
}

/** Validate mesh data (shared by embedded scene assets and .voxmesh files). */
export function validateMesh(raw, path = 'mesh', budget = { used: 0 }) {
  if (!isObject(raw)) throw new SceneFormatError('expected an object', path);
  const positions = numberArray(raw.positions, `${path}.positions`, budget);
  if (positions.length % 3 !== 0 || positions.length === 0) {
    throw new SceneFormatError('positions length must be a positive multiple of 3', `${path}.positions`);
  }
  const vertexCount = positions.length / 3;
  const normals = raw.normals === undefined ? [] : numberArray(raw.normals, `${path}.normals`, budget);
  if (normals.length !== 0 && normals.length !== positions.length) {
    throw new SceneFormatError('normals must match positions', `${path}.normals`);
  }
  const uvs = raw.uvs === undefined ? [] : numberArray(raw.uvs, `${path}.uvs`, budget);
  if (uvs.length !== 0 && uvs.length !== vertexCount * 2) {
    throw new SceneFormatError('uvs must have two values per vertex', `${path}.uvs`);
  }
  const indices = raw.indices === undefined ? [] : numberArray(raw.indices, `${path}.indices`, budget, true);
  if (indices.length % 3 !== 0) throw new SceneFormatError('indices length must be a multiple of 3', `${path}.indices`);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= vertexCount) throw new SceneFormatError('index out of range', `${path}.indices[${i}]`);
  }
  return {
    type: 'mesh',
    name: raw.name === undefined ? 'Mesh' : str(raw.name, `${path}.name`, LIMITS.name),
    ...(raw.source === undefined ? {} : { source: str(raw.source, `${path}.source`, 512) }),
    positions,
    normals,
    uvs,
    indices,
  };
}

function validateSettings(raw) {
  const base = defaultSettings();
  if (raw === undefined) return base;
  if (!isObject(raw)) throw new SceneFormatError('expected an object', 'settings');
  return {
    background: raw.background === undefined ? base.background : color(raw.background, 'settings.background'),
    ambientColor: raw.ambientColor === undefined ? base.ambientColor : color(raw.ambientColor, 'settings.ambientColor'),
    ambientIntensity:
      raw.ambientIntensity === undefined ? base.ambientIntensity : num(raw.ambientIntensity, 'settings.ambientIntensity', 0, 100),
    gravity: raw.gravity === undefined ? base.gravity : vec3(raw.gravity, 'settings.gravity', -1000, 1000),
  };
}

/**
 * Validate a parsed scene document and return a normalized copy containing
 * only known fields. Throws SceneFormatError describing the first problem.
 */
export function normalizeScene(raw) {
  if (!isObject(raw)) throw new SceneFormatError('scene must be a JSON object');
  if (raw.format !== SCENE_FORMAT) throw new SceneFormatError(`format must be "${SCENE_FORMAT}"`, 'format');
  if (raw.version !== SCENE_VERSION) throw new SceneFormatError(`unsupported version ${raw.version}`, 'version');

  const assets = {};
  if (raw.assets !== undefined) {
    if (!isObject(raw.assets)) throw new SceneFormatError('expected an object', 'assets');
    const keys = Object.keys(raw.assets);
    if (keys.length > LIMITS.assets) throw new SceneFormatError('too many assets', 'assets');
    const budget = { used: 0 };
    for (const key of keys) {
      id(key, `assets.${key}`);
      assets[key] = validateMesh(raw.assets[key], `assets.${key}`, budget);
    }
  }

  if (!Array.isArray(raw.entities)) throw new SceneFormatError('expected an array', 'entities');
  if (raw.entities.length > LIMITS.entities) throw new SceneFormatError('too many entities', 'entities');

  const seen = new Set();
  const entities = raw.entities.map((e, i) => {
    const path = `entities[${i}]`;
    if (!isObject(e)) throw new SceneFormatError('expected an object', path);
    const entityId = id(e.id, `${path}.id`);
    if (seen.has(entityId)) throw new SceneFormatError(`duplicate id "${entityId}"`, `${path}.id`);
    seen.add(entityId);
    if (e.components !== undefined && !Array.isArray(e.components)) {
      throw new SceneFormatError('expected an array', `${path}.components`);
    }
    const components = (e.components || []).map((c, j) => validateComponent(c, `${path}.components[${j}]`, assets));
    if (components.length > LIMITS.components) throw new SceneFormatError('too many components', `${path}.components`);
    for (const type of new Set(components.map((c) => c.type))) {
      if (COMPONENT_SCHEMAS[type].unique && components.filter((c) => c.type === type).length > 1) {
        throw new SceneFormatError(`only one ${type} allowed`, `${path}.components`);
      }
    }
    return {
      id: entityId,
      name: e.name === undefined ? 'GameObject' : str(e.name, `${path}.name`, LIMITS.name),
      parent: e.parent === undefined || e.parent === null ? null : id(e.parent, `${path}.parent`),
      active: e.active === undefined ? true : bool(e.active, `${path}.active`),
      static: e.static === undefined ? false : bool(e.static, `${path}.static`),
      tag: e.tag === undefined ? 'Untagged' : str(e.tag, `${path}.tag`, LIMITS.tag),
      layer: e.layer === undefined ? 'Default' : str(e.layer, `${path}.layer`, LIMITS.tag),
      transform: validateTransform(e.transform, `${path}.transform`),
      components,
    };
  });

  // Parents must exist and the hierarchy must not contain cycles.
  const byId = new Map(entities.map((e) => [e.id, e]));
  entities.forEach((e, i) => {
    if (e.parent !== null && !byId.has(e.parent)) {
      throw new SceneFormatError(`parent "${e.parent}" does not exist`, `entities[${i}].parent`);
    }
    let cursor = e.parent;
    let steps = 0;
    while (cursor !== null) {
      if (cursor === e.id || ++steps > entities.length) {
        throw new SceneFormatError('hierarchy contains a cycle', `entities[${i}].parent`);
      }
      cursor = byId.get(cursor).parent;
    }
  });

  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    name: raw.name === undefined ? 'Untitled' : str(raw.name, 'name', LIMITS.name),
    settings: validateSettings(raw.settings),
    entities,
    assets,
  };
}

/** Validate without throwing: { ok: true, scene } or { ok: false, error }. */
export function validateScene(raw) {
  try {
    return { ok: true, scene: normalizeScene(raw) };
  } catch (err) {
    if (err instanceof SceneFormatError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Parse .voxscene text into a normalized scene document. */
export function parseScene(text) {
  if (typeof text !== 'string') throw new SceneFormatError('scene text must be a string');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SceneFormatError('scene file is not valid JSON');
  }
  return normalizeScene(raw);
}

/**
 * Serialize a scene document. Entities are pretty-printed so scene files
 * diff well in version control; bulky mesh data is written compactly.
 */
export function serializeScene(scene) {
  const normalized = normalizeScene(scene);
  const { assets, ...rest } = normalized;
  const marker = '"__VOX_ASSETS__"';
  const head = JSON.stringify({ ...rest, assets: '__VOX_ASSETS__' }, null, 2).replace(
    /\[\s*(-?[\d.eE+-]+(?:,\s*-?[\d.eE+-]+)*)\s*\]/g,
    (_, inner) => `[${inner.split(/,\s*/).join(', ')}]`,
  );
  const assetText = Object.keys(assets).length === 0
    ? '{}'
    : '{\n' + Object.entries(assets).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n  }';
  return head.replace(marker, assetText) + '\n';
}

/** Parse a .voxmesh file. */
export function parseMeshFile(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SceneFormatError('mesh file is not valid JSON');
  }
  if (!isObject(raw) || raw.format !== MESH_FORMAT) throw new SceneFormatError(`format must be "${MESH_FORMAT}"`);
  if (raw.version !== MESH_VERSION) throw new SceneFormatError(`unsupported version ${raw.version}`);
  return validateMesh(raw);
}

/** Serialize mesh data as a .voxmesh file. */
export function serializeMesh(mesh) {
  const m = validateMesh(mesh);
  return JSON.stringify({ format: MESH_FORMAT, version: MESH_VERSION, ...m }) + '\n';
}
