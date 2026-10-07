// Project file access. With a paired agent, files live in the project folder
// on disk. Without one, a small project is kept in browser storage so the
// editor still works (scenes and small models only).

import { serializeScene, parseScene, serializeMesh, parseMeshFile, normalizeScene } from '../../shared/scene-format.js';
import { parseObj } from '../../shared/obj-parser.js';
import { parseGltf } from '../../shared/gltf-parser.js';
import { load, save } from './core/storage.js';

const enc = encodeURIComponent;

/** Base64 for large byte arrays without blowing the call stack. */
export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export class AgentProject {
  constructor(agent) {
    this.agent = agent;
    this.kind = 'agent';
  }

  get label() {
    return this.agent.info?.project || 'Project';
  }

  list(dir) {
    return this.agent.get(`/api/files?dir=${enc(dir)}`);
  }

  /** True when a file exists, checked through a folder listing (no 404s). */
  async exists(path) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    try {
      const { entries } = await this.list(dir);
      return entries.some((e) => e.path === path);
    } catch {
      return false;
    }
  }

  tree() {
    return this.agent.get('/api/tree');
  }

  async readScene(path) {
    const res = await this.agent.get(`/api/scene?path=${enc(path)}`);
    return res.scene;
  }

  writeScene(path, scene) {
    return this.agent.post('/api/scene', { path, scene });
  }

  async readMesh(path) {
    return (await this.agent.get(`/api/mesh?path=${enc(path)}`)).mesh;
  }

  importAsset(name, format, data, encoding = 'utf8') {
    return this.agent.post('/api/assets/import', { name, format, data, encoding });
  }

  /**
   * Import raw file bytes as a background job. Files above 3 MB go up in
   * chunks first, so there is no request size limit in practice.
   */
  async importBytes(name, format, bytes, task) {
    let body;
    if (bytes.byteLength > 3 * 1024 * 1024) {
      const uploadId = await this.agent.upload(bytes, (p) => task?.update(p * 0.4, 'Uploading'));
      body = { name, format, uploadId };
    } else {
      body = { name, format, data: bytesToBase64(bytes), encoding: 'base64' };
    }
    const base = body.uploadId ? 0.4 : 0;
    const job = this.agent.runJob('/api/assets/import', body, (j) => task?.update(base + j.progress * (1 - base), j.message || 'Converting'));
    if (task) task.onCancel = job.cancel;
    return job.promise;
  }

  mkdir(path) {
    return this.agent.post('/api/folder', { path });
  }

  remove(path) {
    return this.agent.post('/api/delete', { path });
  }

  rename(from, to) {
    return this.agent.post('/api/rename', { from, to });
  }
}

const LOCAL_KEY = 'project';
const DEFAULT_FOLDERS = ['Assets', 'Assets/Scenes', 'Assets/Models', 'Builds'];

function parentOf(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function nameOf(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Browser-only project kept in localStorage under "vox:project". */
export class LocalProject {
  constructor() {
    this.kind = 'local';
    const stored = load(LOCAL_KEY, null);
    this.data = stored && stored.files && stored.folders ? stored : { folders: [...DEFAULT_FOLDERS], files: {} };
    for (const f of DEFAULT_FOLDERS) if (!this.data.folders.includes(f)) this.data.folders.push(f);
  }

  get label() {
    return 'Browser Project';
  }

  persist() {
    if (!save(LOCAL_KEY, this.data)) {
      throw new Error('Browser storage is full. Start the Vox Agent to keep larger projects on disk.');
    }
  }

  async list(dir) {
    const entries = [];
    for (const folder of this.data.folders) {
      if (parentOf(folder) === dir) entries.push({ name: nameOf(folder), path: folder, kind: 'folder', ext: '', size: 0, modified: 0 });
    }
    for (const [path, file] of Object.entries(this.data.files)) {
      if (parentOf(path) === dir) {
        const name = nameOf(path);
        entries.push({ name, path, kind: 'file', ext: name.slice(name.lastIndexOf('.')).toLowerCase(), size: file.content.length, modified: file.modified });
      }
    }
    entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
    return { path: dir, entries };
  }

  async tree() {
    const build = (path) => ({
      name: path ? nameOf(path) : 'Project',
      path,
      children: this.data.folders.filter((f) => parentOf(f) === path).sort().map(build),
    });
    return build('');
  }

  async exists(path) {
    return !!this.data.files[path];
  }

  async readScene(path) {
    const file = this.data.files[path];
    if (!file) throw new Error(`Scene not found: ${path}`);
    return parseScene(file.content);
  }

  async writeScene(path, scene) {
    const text = serializeScene(scene);
    this.ensureFolder(parentOf(path));
    this.data.files[path] = { content: text, modified: Date.now() };
    this.persist();
    return { ok: true, path, bytes: text.length };
  }

  async readMesh(path) {
    const file = this.data.files[path];
    if (!file) throw new Error(`Mesh not found: ${path}`);
    return parseMeshFile(file.content);
  }

  async importBytes(name, format, bytes) {
    if (format === 'obj') return this.importAsset(name, format, new TextDecoder().decode(bytes));
    return this.importAsset(name, format, bytes, 'bytes');
  }

  async importAsset(name, format, data, encoding = 'utf8') {
    const base = name.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9 _.-]/g, '_').slice(0, 64) || 'Model';
    let result;
    if (format === 'obj') result = parseObj(data, base);
    else if (format === 'gltf' || format === 'glb') {
      const input = encoding === 'base64' ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : data;
      // encoding 'bytes': data is already a Uint8Array.
      result = parseGltf(input, base);
    } else throw new Error(`Unsupported format "${format}"`);
    const { meshes } = result;
    const written = meshes.map((mesh, i) => {
      const safe = String(mesh.name || base).replace(/[^A-Za-z0-9 _.-]/g, '_').slice(0, 64);
      const path = meshes.length === 1 ? `Assets/Models/${base}.voxmesh` : `Assets/Models/${base}/${safe}_${i}.voxmesh`;
      const { extra, ...plain } = mesh;
      this.ensureFolder(parentOf(path));
      this.data.files[path] = { content: serializeMesh(plain), modified: Date.now() };
      return { path, mesh: plain, ...(extra || {}) };
    });
    this.persist();
    return { ok: true, name: base, format, meshes: written, nodes: result.nodes || null };
  }

  ensureFolder(path) {
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      if (!this.data.folders.includes(p)) this.data.folders.push(p);
    }
  }

  async mkdir(path) {
    if (this.data.folders.includes(path)) throw new Error('A folder with that name already exists');
    this.ensureFolder(path);
    this.persist();
    return { ok: true, path };
  }

  async remove(path) {
    if (this.data.files[path]) delete this.data.files[path];
    else if (this.data.folders.includes(path)) {
      const busy = this.data.folders.some((f) => parentOf(f) === path) || Object.keys(this.data.files).some((f) => parentOf(f) === path);
      if (busy) throw new Error('Folder is not empty');
      this.data.folders = this.data.folders.filter((f) => f !== path);
    }
    this.persist();
    return { ok: true };
  }

  async rename(from, to) {
    if (this.data.files[to] || this.data.folders.includes(to)) throw new Error('An item with that name already exists');
    if (this.data.files[from]) {
      this.data.files[to] = this.data.files[from];
      delete this.data.files[from];
    } else if (this.data.folders.includes(from)) {
      this.data.folders = this.data.folders.map((f) => (f === from || f.startsWith(`${from}/`) ? to + f.slice(from.length) : f));
      for (const key of Object.keys(this.data.files)) {
        if (key.startsWith(`${from}/`)) {
          this.data.files[to + key.slice(from.length)] = this.data.files[key];
          delete this.data.files[key];
        }
      }
    }
    this.persist();
    return { ok: true, path: to };
  }
}

export { normalizeScene };
