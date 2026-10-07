// Scene and asset file commands: New, Open, Save, Save As, download/upload
// .voxscene files, asset import and instantiating mesh assets.

import { h } from './ui/dom.js';
import { openDialog, confirmDialog } from './ui/dialog.js';
import { textField } from './ui/fields.js';
import { load, save } from './core/storage.js';
import { newId } from './core/scene-model.js';
import { meshAssetObject } from './core/primitives.js';
import { newSceneData } from './core/editor.js';
import { parseScene, serializeScene, SCENE_EXTENSION, createComponent, createTransform } from '../../shared/scene-format.js';

const AUTOSAVE_KEY = 'autosave';
const LAST_SCENE_KEY = 'lastScene';
export const DEFAULT_SCENE_PATH = 'Assets/Scenes/Main.voxscene';

/** Ask for a name with a small dialog. Resolves null when cancelled. */
export function promptName(title, label, initial) {
  return new Promise((resolve) => {
    let value = initial;
    const field = textField({ label, get: () => value, onCommit: (v) => { value = v; } });
    let answered = false;
    const submit = () => {
      value = field.input.value;
      answered = true;
      resolve(value.trim() || null);
    };
    const { close } = openDialog({
      title,
      body: h('div', field.el),
      width: 360,
      buttons: [
        { label: 'Cancel', action: () => { answered = true; resolve(null); } },
        { label: 'Save', primary: true, action: submit },
      ],
      onClose: () => {
        if (!answered) resolve(null);
      },
    });
    field.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
        close();
      }
    });
    setTimeout(() => {
      field.input.focus();
      field.input.select();
    }, 0);
  });
}

function sanitizeName(name) {
  return name.replace(/\.voxscene$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 64);
}

function readFileAs(file, mode) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    if (mode === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple });
    input.addEventListener('change', () => resolve([...input.files]));
    input.click();
  });
}

export class SceneFiles {
  constructor(editor) {
    this.editor = editor;
    this.autosaveTimer = 0;
    editor.scene.on('dirty', (dirty) => {
      if (dirty) this.scheduleAutosave();
    });
    editor.scene.on('change', () => this.scheduleAutosave());
    editor.scene.on('structure', () => this.scheduleAutosave());
  }

  get scene() {
    return this.editor.scene;
  }

  // Autosave keeps unsaved work across reloads, in browser storage.
  scheduleAutosave() {
    if (this.editor.isPlaying) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      try {
        save(AUTOSAVE_KEY, { path: this.scene.path, dirty: this.scene.dirty, data: this.scene.toData() });
      } catch {
        // Too large for browser storage; the agent copy on disk is the backup.
      }
    }, 800);
  }

  restoreAutosave() {
    const saved = load(AUTOSAVE_KEY, null);
    if (!saved?.data) return false;
    try {
      this.editor.loadScene(parseScene(JSON.stringify(saved.data)), saved.path);
      if (saved.dirty) this.scene.markDirty();
      return true;
    } catch {
      return false;
    }
  }

  async confirmDiscard() {
    if (!this.scene.dirty) return true;
    return confirmDialog('Unsaved Changes', `The scene "${this.scene.name}" has unsaved changes. Discard them?`, 'Discard');
  }

  async newScene() {
    if (this.editor.isPlaying || !(await this.confirmDiscard())) return;
    this.editor.loadScene(newSceneData('Untitled'));
    this.editor.log.info('New scene created');
  }

  async openScene(path) {
    if (this.editor.isPlaying) return;
    if (!(await this.confirmDiscard())) return;
    try {
      const data = await this.editor.project.readScene(path);
      this.editor.loadScene(data, path);
      save(LAST_SCENE_KEY, path);
      this.editor.log.info(`Opened ${path}`);
    } catch (err) {
      this.editor.log.error(`Could not open ${path}`, err.message);
    }
  }

  /** Open the last scene, or the project's main scene, at startup. */
  async openStartScene() {
    const candidates = [load(LAST_SCENE_KEY, null), DEFAULT_SCENE_PATH].filter(Boolean);
    for (const path of candidates) {
      if (!(await this.editor.project.exists(path))) continue;
      try {
        const data = await this.editor.project.readScene(path);
        this.editor.loadScene(data, path);
        this.editor.log.info(`Opened ${path}`);
        return true;
      } catch {
        // Try the next candidate.
      }
    }
    this.scene.path = DEFAULT_SCENE_PATH;
    this.scene.name = 'Main';
    this.editor.emit('scene-loaded', { path: DEFAULT_SCENE_PATH });
    return false;
  }

  async save() {
    if (this.editor.isPlaying) {
      this.editor.log.warn('Exit Play mode before saving the scene');
      return false;
    }
    if (!this.scene.path) return this.saveAs();
    return this.writeTo(this.scene.path);
  }

  async saveAs() {
    if (this.editor.isPlaying) return false;
    const name = await promptName('Save Scene As', 'Scene name', this.scene.name === 'Untitled' ? 'NewScene' : this.scene.name);
    if (!name) return false;
    const clean = sanitizeName(name);
    if (!clean) return false;
    const dir = this.scene.path ? this.scene.path.slice(0, this.scene.path.lastIndexOf('/')) : 'Assets/Scenes';
    this.scene.name = clean;
    return this.writeTo(`${dir}/${clean}${SCENE_EXTENSION}`);
  }

  async writeTo(path) {
    try {
      const res = await this.editor.project.writeScene(path, this.scene.toData());
      this.scene.path = res.path || path;
      this.scene.markClean();
      save(LAST_SCENE_KEY, this.scene.path);
      this.scheduleAutosave();
      const where = this.editor.project.kind === 'agent' ? '' : ' (browser storage)';
      this.editor.log.info(`Saved ${this.scene.path}${where}`);
      this.editor.emit('project-refresh');
      this.editor.emit('scene-loaded', { path: this.scene.path });
      return true;
    } catch (err) {
      this.editor.log.error(`Could not save ${path}`, err.message);
      return false;
    }
  }

  /** Create an empty scene file in the Project panel. */
  async createSceneAsset(dir) {
    const name = await promptName('Create Scene', 'Scene name', 'NewScene');
    if (!name) return;
    const clean = sanitizeName(name);
    const data = newSceneData(clean);
    try {
      await this.editor.project.writeScene(`${dir}/${clean}${SCENE_EXTENSION}`, data);
      this.editor.emit('project-refresh');
    } catch (err) {
      this.editor.log.error('Could not create scene', err.message);
    }
  }

  /** Download the scene as a .voxscene file (works without the agent). */
  download() {
    const text = serializeScene(this.scene.toData());
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: `${sanitizeName(this.scene.name) || 'Scene'}${SCENE_EXTENSION}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async upload() {
    if (this.editor.isPlaying || !(await this.confirmDiscard())) return;
    const [file] = await pickFiles('.voxscene,application/json');
    if (!file) return;
    try {
      const data = parseScene(await readFileAs(file, 'text'));
      this.editor.loadScene(data, null);
      this.editor.log.info(`Loaded ${file.name}`);
    } catch (err) {
      this.editor.log.error(`Could not load ${file.name}`, err.message);
    }
  }

  // Assets -------------------------------------------------------------------------

  async importDialog() {
    const files = await pickFiles('.obj,.gltf,.glb', true);
    await this.importFiles(files);
  }

  async importFiles(files) {
    for (const file of files) {
      const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
      if (!['obj', 'gltf', 'glb'].includes(ext)) {
        this.editor.log.warn(`${file.name}: unsupported file type (use .obj, .gltf or .glb)`);
        continue;
      }
      try {
        this.editor.log.info(`Importing ${file.name}...`);
        let result;
        if (ext === 'glb') {
          const dataUrl = await readFileAs(file, 'dataurl');
          result = await this.editor.project.importAsset(file.name, ext, dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
        } else {
          result = await this.editor.project.importAsset(file.name, ext, await readFileAs(file, 'text'));
        }
        this.addImported(result);
      } catch (err) {
        this.editor.log.error(`Import failed: ${file.name}`, err.message);
      }
    }
    this.editor.emit('project-refresh');
  }

  /** Entity records for a glTF node tree (root first, depth-first). */
  recordsFromNodes(node, assetIds, colors, parent = null, out = []) {
    const record = {
      id: newId(),
      name: String(node.name || 'Node').slice(0, 128),
      parent,
      active: true,
      static: false,
      tag: 'Untagged',
      layer: 'Default',
      transform: node.transform ? structuredClone(node.transform) : createTransform(),
      components: [],
    };
    if (node.mesh !== null && node.mesh !== undefined) {
      record.components.push(
        createComponent('MeshFilter', { mesh: `asset:${assetIds[node.mesh]}` }),
        createComponent('MeshRenderer', colors[node.mesh] ? { color: colors[node.mesh] } : {}),
      );
    }
    out.push(record);
    for (const child of node.children || []) this.recordsFromNodes(child, assetIds, colors, record.id, out);
    return out;
  }

  /** Put imported meshes into the scene under one parent object. */
  addImported(result) {
    const meshes = result.meshes || [];
    if (result.nodes) {
      const assetIds = meshes.map((item) => this.registerMesh(item.path, item.mesh));
      const colors = meshes.map((item) => item.color || null);
      const records = this.recordsFromNodes(result.nodes, assetIds, colors);
      records[0].name = this.scene.uniqueName(result.name, null);
      this.editor.createFromRecords([records], null, undefined, `Import ${result.name}`);
      this.editor.log.info(`Imported ${result.name} (${meshes.length} mesh${meshes.length === 1 ? '' : 'es'}, ${records.length} objects)`);
      this.editor.frameSelected();
      return;
    }
    const records = [];
    let root = null;
    if (meshes.length > 1) {
      root = { ...meshAssetObject(result.name, 'x'), components: [] };
      root.name = this.scene.uniqueName(result.name, null);
      records.push(root);
    }
    for (const item of meshes) {
      const assetId = this.registerMesh(item.path, item.mesh);
      const record = meshAssetObject(item.mesh.name || result.name, assetId);
      record.parent = root ? root.id : null;
      if (!root) record.name = this.scene.uniqueName(record.name, null);
      records.push(record);
    }
    if (!records.length) return;
    this.editor.createFromRecords([records], null, undefined, `Import ${result.name}`);
    this.editor.log.info(`Imported ${result.name} (${meshes.length} mesh${meshes.length === 1 ? '' : 'es'})`);
    this.editor.frameSelected();
  }

  /** Add mesh data to the scene's asset table, reusing an existing copy. */
  registerMesh(sourcePath, mesh) {
    for (const [id, asset] of Object.entries(this.scene.assets)) {
      if (sourcePath && asset.source === sourcePath) return id;
    }
    const id = newId();
    this.scene.addAsset(id, { ...mesh, source: sourcePath });
    return id;
  }

  /** Instantiate a mesh asset from the Project panel. */
  async instantiate({ asset, position, parent = null, index }) {
    if (asset.kind !== 'mesh') return;
    try {
      const mesh = await this.editor.project.readMesh(asset.path);
      const assetId = this.registerMesh(asset.path, mesh);
      const record = meshAssetObject(asset.name || mesh.name, assetId);
      record.name = this.scene.uniqueName(record.name, parent);
      record.parent = parent;
      if (position) record.transform.position = position;
      this.editor.createFromRecords([[record]], parent, index, `Add ${record.name}`);
    } catch (err) {
      this.editor.log.error(`Could not add ${asset.path}`, err.message);
    }
  }
}
