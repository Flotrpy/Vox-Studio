// Project panel: folder tree on the left; breadcrumb, asset grid or list
// and a zoom slider on the right; search, create menu and context menus.

import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { contextMenu, openMenu } from '../ui/menu.js';
import { tooltip } from '../ui/tooltip.js';
import { confirmDialog } from '../ui/dialog.js';
import { load, save } from '../core/storage.js';

const ASSET_MIME = 'application/x-vox-asset';
const EXT_ICON = {
  '.voxscene': 'scene',
  '.voxmesh': 'mesh',
  '.obj': 'gameobject',
  '.gltf': 'gameobject',
  '.glb': 'gameobject',
  '.html': 'build',
};

function iconFor(entry) {
  if (entry.kind === 'folder') return 'folder';
  return EXT_ICON[entry.ext] || 'file';
}

function displayName(entry) {
  return entry.kind === 'folder' ? entry.name : entry.name.replace(/\.(voxscene|voxmesh)$/i, '');
}

export class ProjectPanel {
  constructor(editor) {
    this.editor = editor;
    this.id = 'project';
    this.title = 'Project';
    this.icon = 'folder';
    this.prefs = load('project', { zoom: 0.35, dir: 'Assets', treeWidth: 170 });
    this.dir = this.prefs.dir;
    this.expanded = new Set(['', 'Assets']);
    this.selected = null;
    this.entries = [];
    this.query = '';
    this.favorite = null;
    this.treeData = null;

    const createBtn = h('button.tb-btn.dropdown', { type: 'button' }, icon('plus'));
    tooltip(createBtn, 'Create');
    createBtn.addEventListener('click', () => openMenu(this.createItems(), { anchor: createBtn, minWidth: 160 }));

    this.search = h('input.input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search project', spellcheck: false });
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.favorite = null;
      this.loadEntries();
    });
    this.search.addEventListener('keydown', (e) => e.stopPropagation());

    this.storeLabel = h('span.project-store');

    this.tree = h('div.project-tree', { role: 'tree', tabindex: '0', 'aria-label': 'Project folders' });
    this.tree.style.width = `${this.prefs.treeWidth}px`;
    const treeSplitter = h('div.project-splitter');
    this.bindTreeSplitter(treeSplitter);

    this.breadcrumb = h('div.breadcrumb');
    this.content = h('div.asset-area', { tabindex: '0', role: 'listbox', 'aria-label': 'Assets' });
    this.footerPath = h('span.footer-path');
    this.zoom = h('input.zoom-slider', { type: 'range', min: '0', max: '1', step: '0.01', 'aria-label': 'Icon size' });
    this.zoom.value = String(this.prefs.zoom);
    tooltip(this.zoom, 'Icon size (left end shows a list)');
    this.zoom.addEventListener('input', () => {
      this.prefs.zoom = Number(this.zoom.value);
      save('project', this.prefs);
      this.renderEntries();
    });

    this.element = h(
      'div.panel.project',
      { dataset: { panel: 'project' } },
      h('div.panel-toolbar', createBtn, this.storeLabel, h('div.spacer'), h('div.search.project-search', icon('search'), this.search)),
      h(
        'div.project-body',
        this.tree,
        treeSplitter,
        h('div.project-main', this.breadcrumb, this.content, h('div.project-footer', this.footerPath, h('div.spacer'), this.zoom)),
      ),
    );

    this.content.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.asset')) return;
      this.select(null);
      contextMenu(e, this.backgroundItems());
    });
    this.content.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.asset')) this.select(null);
    });
    this.content.addEventListener('keydown', (e) => this.onKey(e));

    editor.on('project-changed', () => this.refresh());
    editor.on('project-refresh', () => this.refresh());
  }

  get store() {
    return this.editor.project;
  }

  bindTreeSplitter(splitter) {
    splitter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = this.tree.getBoundingClientRect().width;
      const move = (ev) => {
        const w = Math.max(90, Math.min(400, startW + ev.clientX - startX));
        this.tree.style.width = `${w}px`;
        this.prefs.treeWidth = w;
      };
      const up = () => {
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', up);
        save('project', this.prefs);
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up);
    });
  }

  async refresh() {
    if (!this.store) return;
    this.storeLabel.textContent = this.store.kind === 'agent' ? '' : 'Browser storage';
    tooltip(this.storeLabel, 'No agent connected: assets are kept in this browser');
    try {
      this.treeData = await this.store.tree();
    } catch (err) {
      this.editor.log.error('Could not read the project folder', err.message);
      this.treeData = { name: 'Project', path: '', children: [] };
    }
    this.renderTree();
    await this.loadEntries();
  }

  // Folder tree ---------------------------------------------------------------

  renderTree() {
    clear(this.tree);
    const favorites = [
      { label: 'All Scenes', ext: '.voxscene' },
      { label: 'All Models', ext: '.voxmesh' },
    ];
    this.tree.append(h('div.tree-row.section-row', h('span.foldout', icon('arrow-down')), icon('star', 'row-icon'), h('span.name', 'Favorites')));
    for (const fav of favorites) {
      const row = h('div.tree-row', { class: this.favorite === fav.ext ? 'selected' : undefined }, h('span.foldout'), icon('search', 'row-icon'), h('span.name', fav.label));
      row.style.paddingLeft = '14px';
      row.addEventListener('click', () => {
        this.favorite = fav.ext;
        this.query = '';
        this.search.value = '';
        this.renderTree();
        this.loadEntries();
      });
      this.tree.append(row);
    }
    const visit = (node, depth) => {
      const hasChildren = node.children.length > 0;
      const open = this.expanded.has(node.path);
      const selected = !this.favorite && !this.query && node.path === this.dir;
      const row = h(
        'div.tree-row',
        { role: 'treeitem', class: selected ? 'selected' : undefined, 'aria-expanded': hasChildren ? String(open) : undefined, dataset: { path: node.path } },
        h('span.foldout', hasChildren ? icon(open ? 'arrow-down' : 'arrow-right') : null),
        icon(open && hasChildren ? 'folder-open' : 'folder', 'row-icon folder-icon'),
        h('span.name', node.name),
      );
      row.style.paddingLeft = `${depth * 14}px`;
      row.querySelector('.foldout').addEventListener('click', (e) => {
        e.stopPropagation();
        if (open) this.expanded.delete(node.path);
        else this.expanded.add(node.path);
        this.renderTree();
      });
      row.addEventListener('click', () => this.openFolder(node.path));
      row.addEventListener('contextmenu', (e) => {
        this.openFolder(node.path);
        contextMenu(e, this.backgroundItems());
      });
      this.bindFolderDrop(row, node.path);
      this.tree.append(row);
      if (open) for (const child of node.children) visit(child, depth + 1);
    };
    if (this.treeData) for (const child of this.treeData.children) visit(child, 0);
  }

  openFolder(path) {
    this.dir = path;
    this.favorite = null;
    this.query = '';
    this.search.value = '';
    this.prefs.dir = path;
    save('project', this.prefs);
    let p = path;
    while (p) {
      this.expanded.add(p);
      p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    }
    this.selected = null;
    this.renderTree();
    this.loadEntries();
  }

  // Entries ---------------------------------------------------------------------

  async allEntries() {
    const out = [];
    const walk = async (node) => {
      const { entries } = await this.store.list(node.path);
      out.push(...entries.filter((e) => e.kind === 'file'));
      for (const child of node.children) await walk(child);
    };
    if (this.treeData) for (const child of this.treeData.children) await walk(child);
    return out;
  }

  async loadEntries() {
    if (!this.store) return;
    try {
      if (this.favorite) {
        this.entries = (await this.allEntries()).filter((e) => e.ext === this.favorite);
      } else if (this.query) {
        this.entries = (await this.allEntries()).filter((e) => e.name.toLowerCase().includes(this.query));
      } else {
        this.entries = (await this.store.list(this.dir)).entries;
      }
    } catch (err) {
      this.entries = [];
      if (this.dir !== 'Assets') {
        this.openFolder('Assets');
        return;
      }
      this.editor.log.error('Could not list project folder', err.message);
    }
    this.renderBreadcrumb();
    this.renderEntries();
  }

  renderBreadcrumb() {
    clear(this.breadcrumb);
    if (this.favorite || this.query) {
      this.breadcrumb.append(h('span.crumb.current', this.query ? `Search: ${this.query}` : this.favorite === '.voxscene' ? 'All Scenes' : 'All Models'));
      return;
    }
    const parts = this.dir.split('/').filter(Boolean);
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/');
      const crumb = h('button.crumb', { type: 'button', class: i === parts.length - 1 ? 'current' : undefined }, part);
      crumb.addEventListener('click', () => this.openFolder(path));
      this.bindFolderDrop(crumb, path);
      if (i > 0) this.breadcrumb.append(h('span.crumb-sep', icon('arrow-right')));
      this.breadcrumb.append(crumb);
    });
  }

  renderEntries() {
    clear(this.content);
    const zoom = this.prefs.zoom;
    const listMode = zoom < 0.05;
    this.content.classList.toggle('list-mode', listMode);
    const size = Math.round(40 + zoom * 56);
    this.content.style.setProperty('--tile', `${size}px`);
    if (!this.entries.length) {
      this.content.append(h('div.empty-note', this.query || this.favorite ? 'No matching assets.' : 'This folder is empty.'));
    }
    for (const entry of this.entries) {
      const el = h(
        'div.asset',
        {
          role: 'option',
          tabindex: '-1',
          'aria-selected': String(entry.path === this.selected),
          class: entry.path === this.selected ? 'selected' : undefined,
          draggable: entry.ext === '.voxmesh' ? 'true' : undefined,
          dataset: { path: entry.path },
        },
        h('span.asset-icon', icon(iconFor(entry))),
        h('span.asset-name', displayName(entry)),
      );
      tooltip(el, entry.path);
      el.addEventListener('pointerdown', () => this.select(entry.path));
      el.addEventListener('dblclick', () => this.open(entry));
      el.addEventListener('contextmenu', (e) => {
        this.select(entry.path);
        contextMenu(e, this.entryItems(entry));
      });
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData(ASSET_MIME, JSON.stringify({ path: entry.path, kind: 'mesh', name: displayName(entry) }));
        e.dataTransfer.setData('text/plain', entry.path);
      });
      if (entry.kind === 'folder') this.bindFolderDrop(el, entry.path);
      this.content.append(el);
    }
    this.footerPath.textContent = this.selected || '';
  }

  select(path) {
    this.selected = path;
    for (const el of this.content.querySelectorAll('.asset')) {
      const on = el.dataset.path === path;
      el.classList.toggle('selected', on);
      el.setAttribute('aria-selected', String(on));
    }
    this.footerPath.textContent = path || '';
    this.content.focus({ preventScroll: true });
  }

  bindFolderDrop(el, folderPath) {
    // Accept files dropped from the operating system for import.
    el.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        el.classList.add('drop-into');
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-into'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('drop-into');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      this.editor.emit('import-files', [...e.dataTransfer.files]);
    });
  }

  async open(entry) {
    if (entry.kind === 'folder') this.openFolder(entry.path);
    else if (entry.ext === '.voxscene') this.editor.emit('command', { name: 'open-scene', path: entry.path });
    else if (entry.ext === '.voxmesh') this.editor.emit('drop-asset', { asset: { path: entry.path, kind: 'mesh', name: displayName(entry) } });
  }

  // Menus and actions --------------------------------------------------------------

  createItems() {
    return [
      { label: 'Folder', action: () => this.createFolder() },
      { separator: true },
      { label: 'Scene', action: () => this.editor.emit('command', { name: 'new-scene-asset', dir: this.currentDir() }) },
    ];
  }

  currentDir() {
    return this.favorite || this.query ? 'Assets' : this.dir || 'Assets';
  }

  backgroundItems() {
    return [
      { label: 'Create', submenu: this.createItems() },
      { separator: true },
      { label: 'Import New Asset...', action: () => this.editor.emit('command', 'import') },
      { label: 'Refresh', shortcut: 'Ctrl+R', action: () => this.refresh() },
    ];
  }

  entryItems(entry) {
    const managed = entry.path.startsWith('Assets/') || entry.path.startsWith('Builds/');
    return [
      { label: 'Open', action: () => this.open(entry) },
      { separator: true },
      { label: 'Create', submenu: this.createItems() },
      { label: 'Rename', shortcut: 'F2', disabled: !managed, action: () => this.beginRename(entry) },
      { label: 'Delete', shortcut: 'Del', disabled: !managed, action: () => this.deleteEntry(entry) },
      { separator: true },
      { label: 'Copy Path', action: () => navigator.clipboard?.writeText(entry.path).catch(() => {}) },
      { label: 'Import New Asset...', action: () => this.editor.emit('command', 'import') },
      { label: 'Refresh', action: () => this.refresh() },
    ];
  }

  async createFolder() {
    const base = this.currentDir();
    let name = 'New Folder';
    const names = new Set(this.entries.map((e) => e.name));
    for (let i = 1; names.has(name); i++) name = `New Folder ${i}`;
    try {
      await this.store.mkdir(`${base}/${name}`);
      await this.refresh();
      const entry = this.entries.find((e) => e.name === name);
      if (entry) this.beginRename(entry);
    } catch (err) {
      this.editor.log.error('Could not create folder', err.message);
    }
  }

  beginRename(entry) {
    const el = this.content.querySelector(`.asset[data-path="${CSS.escape(entry.path)}"]`);
    if (!el) return;
    const label = el.querySelector('.asset-name');
    const ext = entry.kind === 'folder' ? '' : entry.ext;
    const input = h('input.input.rename', { type: 'text', spellcheck: false, maxLength: 64 });
    input.value = displayName(entry);
    label.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const name = input.value.trim().replace(/[\\/:*?"<>|]/g, '_');
      if (commit && name && name !== displayName(entry)) {
        const parent = entry.path.slice(0, entry.path.lastIndexOf('/'));
        try {
          await this.store.rename(entry.path, `${parent}/${name}${ext}`);
          this.selected = `${parent}/${name}${ext}`;
        } catch (err) {
          this.editor.log.error('Could not rename', err.message);
        }
      }
      await this.refresh();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  async deleteEntry(entry) {
    const ok = await confirmDialog('Delete Selected Asset', `Delete ${entry.path}? This cannot be undone.`, 'Delete');
    if (!ok) return;
    try {
      await this.store.remove(entry.path);
      this.selected = null;
      this.editor.log.info(`Deleted ${entry.path}`);
    } catch (err) {
      this.editor.log.error('Could not delete', err.message);
    }
    await this.refresh();
  }

  onKey(e) {
    const entry = this.entries.find((x) => x.path === this.selected);
    const index = this.entries.indexOf(entry);
    if (e.key === 'F2' && entry) this.beginRename(entry);
    else if (e.key === 'Delete' && entry) this.deleteEntry(entry);
    else if (e.key === 'Enter' && entry) this.open(entry);
    else if (e.key === 'Backspace' && this.dir.includes('/')) this.openFolder(this.dir.slice(0, this.dir.lastIndexOf('/')));
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') this.select(this.entries[Math.min(this.entries.length - 1, index + 1)]?.path ?? null);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') this.select(this.entries[Math.max(0, index - 1)]?.path ?? null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
