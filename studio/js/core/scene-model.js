// In-memory scene graph edited by Vox Studio. Entities are plain objects in
// the same shape as the .voxscene format plus a `children` id list, so the
// model serializes without translation and works in Node tests.

import { Emitter } from './events.js';
import {
  createSceneData,
  createTransform,
  normalizeScene,
  SCENE_FORMAT,
  SCENE_VERSION,
} from '../../../shared/scene-format.js';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Random entity id (12 base-36 characters). */
export function newId() {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 36];
  return out;
}

function cloneData(value) {
  return structuredClone(value);
}

/**
 * Events:
 *  - 'load'       whole scene replaced
 *  - 'structure'  { kind: 'add'|'remove'|'move', ids }
 *  - 'change'     { id, path } field change on one entity
 *  - 'settings'   scene settings changed
 *  - 'assets'     asset table changed
 *  - 'dirty'      dirty flag toggled
 */
export class SceneModel extends Emitter {
  constructor(data) {
    super();
    this.load(data || createSceneData('Main'));
  }

  load(data, { path = null } = {}) {
    const scene = normalizeScene(data);
    this.name = scene.name;
    this.settings = scene.settings;
    this.assets = scene.assets;
    this.path = path;
    this.entities = new Map();
    this.roots = [];
    for (const e of scene.entities) this.entities.set(e.id, { ...e, children: [] });
    for (const e of scene.entities) {
      if (e.parent === null) this.roots.push(e.id);
      else this.entities.get(e.parent).children.push(e.id);
    }
    this.dirty = false;
    this.emit('load', this);
    this.emit('dirty', false);
  }

  /** Serializable scene document (entities depth-first, parents first). */
  toData() {
    const entities = [];
    this.walk((e) => {
      const { children, ...rest } = e;
      entities.push(cloneData(rest));
    });
    return {
      format: SCENE_FORMAT,
      version: SCENE_VERSION,
      name: this.name,
      settings: cloneData(this.settings),
      entities,
      assets: this.assets,
    };
  }

  markDirty() {
    if (!this.dirty) {
      this.dirty = true;
      this.emit('dirty', true);
    }
  }

  markClean() {
    if (this.dirty) {
      this.dirty = false;
      this.emit('dirty', false);
    }
  }

  get(id) {
    return this.entities.get(id) || null;
  }

  has(id) {
    return this.entities.has(id);
  }

  childrenOf(parentId) {
    return parentId === null ? this.roots : this.entities.get(parentId)?.children || [];
  }

  indexOf(id) {
    const e = this.get(id);
    return e ? this.childrenOf(e.parent).indexOf(id) : -1;
  }

  /** Depth-first walk from the roots (or from one entity). */
  walk(fn, startIds = this.roots, depth = 0) {
    for (const id of startIds) {
      const e = this.entities.get(id);
      if (!e) continue;
      if (fn(e, depth) === false) continue;
      this.walk(fn, e.children, depth + 1);
    }
  }

  /** The entity and all its descendants, depth-first. */
  subtree(id) {
    const out = [];
    this.walk((e) => {
      out.push(e);
    }, [id]);
    return out;
  }

  isAncestor(ancestorId, id) {
    let cursor = this.get(id)?.parent ?? null;
    while (cursor !== null) {
      if (cursor === ancestorId) return true;
      cursor = this.get(cursor)?.parent ?? null;
    }
    return false;
  }

  /** True if the entity and every ancestor is active. */
  isActiveInHierarchy(id) {
    let e = this.get(id);
    while (e) {
      if (!e.active) return false;
      e = e.parent === null ? null : this.get(e.parent);
    }
    return true;
  }

  findByName(name) {
    for (const e of this.entities.values()) if (e.name === name) return e;
    return null;
  }

  /** "Cube", "Cube (1)", "Cube (2)"... unique among siblings. */
  uniqueName(base, parentId = null) {
    const names = new Set(this.childrenOf(parentId).map((id) => this.get(id).name));
    if (!names.has(base)) return base;
    const stem = base.replace(/ \(\d+\)$/, '');
    for (let i = 1; ; i++) {
      const candidate = `${stem} (${i})`;
      if (!names.has(candidate)) return candidate;
    }
  }

  /**
   * Insert entity records (one root followed by its descendants, as
   * returned by snapshotSubtree) under `parentId` at `index`.
   */
  insertSubtree(records, parentId = null, index = undefined) {
    if (records.length === 0) return null;
    const rootId = records[0].id;
    for (const r of records) {
      if (this.entities.has(r.id)) throw new Error(`Entity ${r.id} already exists`);
    }
    records.forEach((r, i) => {
      const parent = i === 0 ? parentId : r.parent;
      this.entities.set(r.id, { ...cloneData(r), parent, children: [] });
    });
    for (const r of records.slice(1)) this.entities.get(r.parent).children.push(r.id);
    const siblings = this.childrenOf(parentId);
    const at = index === undefined || index < 0 || index > siblings.length ? siblings.length : index;
    siblings.splice(at, 0, rootId);
    this.markDirty();
    this.emit('structure', { kind: 'add', ids: records.map((r) => r.id) });
    return rootId;
  }

  /** Create a single entity with defaults. Returns its id. */
  createEntity({ id = newId(), name = 'GameObject', components = [], transform, ...rest } = {}, parentId = null, index) {
    const record = {
      id,
      name,
      parent: parentId,
      active: true,
      static: false,
      tag: 'Untagged',
      layer: 'Default',
      transform: transform ? cloneData(transform) : createTransform(),
      components: cloneData(components),
      ...rest,
    };
    return this.insertSubtree([record], parentId, index);
  }

  /** Detached copy of an entity and its descendants (without children lists). */
  snapshotSubtree(id) {
    return this.subtree(id).map(({ children, ...rest }) => cloneData(rest));
  }

  /** Remove an entity and its descendants. Returns what is needed to undo. */
  remove(id) {
    const e = this.get(id);
    if (!e) return null;
    const records = this.snapshotSubtree(id);
    const siblings = this.childrenOf(e.parent);
    const index = siblings.indexOf(id);
    siblings.splice(index, 1);
    for (const r of records) this.entities.delete(r.id);
    this.markDirty();
    this.emit('structure', { kind: 'remove', ids: records.map((r) => r.id) });
    return { records, parent: e.parent, index };
  }

  /** Reparent and/or reorder. Refuses to move an entity under itself. */
  move(id, newParentId, index) {
    const e = this.get(id);
    if (!e) return false;
    if (newParentId === id || (newParentId !== null && this.isAncestor(id, newParentId))) return false;
    if (newParentId !== null && !this.has(newParentId)) return false;
    const from = this.childrenOf(e.parent);
    const fromIndex = from.indexOf(id);
    from.splice(fromIndex, 1);
    const to = this.childrenOf(newParentId);
    let at = index === undefined || index < 0 || index > to.length ? to.length : index;
    e.parent = newParentId;
    to.splice(at, 0, id);
    this.markDirty();
    this.emit('structure', { kind: 'move', ids: [id] });
    return true;
  }

  /** Read a nested field: path like ['transform', 'position'] or ['components', 1, 'color']. */
  getField(id, path) {
    let cursor = this.get(id);
    for (const key of path) {
      if (cursor === undefined || cursor === null) return undefined;
      cursor = cursor[key];
    }
    return cursor;
  }

  /** Write a nested field and notify listeners. Values are copied. */
  setField(id, path, value) {
    const e = this.get(id);
    if (!e || path.length === 0) return;
    let cursor = e;
    for (let i = 0; i < path.length - 1; i++) {
      cursor = cursor[path[i]];
      if (cursor === undefined || cursor === null) return;
    }
    cursor[path[path.length - 1]] = cloneData(value);
    this.markDirty();
    this.emit('change', { id, path });
  }

  setSettings(key, value) {
    this.settings[key] = cloneData(value);
    this.markDirty();
    this.emit('settings', { key });
  }

  addAsset(assetId, mesh) {
    this.assets[assetId] = mesh;
    this.markDirty();
    this.emit('assets', { id: assetId });
  }
}
