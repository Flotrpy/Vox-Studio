// Hierarchy panel: scene tree with search, create menu, foldouts, indent
// guides, multi-selection, inline rename, drag-to-reparent and context
// menus.

import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { contextMenu, openMenu } from '../ui/menu.js';
import { tooltip } from '../ui/tooltip.js';
import { createMenuItems } from './create-menu.js';

const INDENT = 14;
const ENTITY_MIME = 'application/x-vox-entities';
const ASSET_MIME = 'application/x-vox-asset';

function entityIcon(entity) {
  const types = entity.components.map((c) => c.type);
  if (types.includes('Camera')) return 'camera';
  if (types.includes('Light')) return 'light';
  return 'gameobject-solid';
}

export class HierarchyPanel {
  constructor(editor) {
    this.editor = editor;
    this.id = 'hierarchy';
    this.title = 'Hierarchy';
    this.icon = 'layout';
    this.expanded = new Set();
    this.sceneExpanded = true;
    this.filter = '';
    this.anchor = null;
    this.rows = [];
    this.renaming = null;

    const addBtn = h('button.tb-btn.dropdown', { type: 'button' }, icon('plus'));
    tooltip(addBtn, 'Create a GameObject');
    addBtn.addEventListener('click', () => openMenu(createMenuItems(editor), { anchor: addBtn, minWidth: 180 }));

    this.search = h('input.input', { type: 'search', placeholder: 'All', 'aria-label': 'Search hierarchy', spellcheck: false });
    this.search.addEventListener('input', () => {
      this.filter = this.search.value.trim().toLowerCase();
      this.render();
    });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.search.value = '';
        this.filter = '';
        this.render();
      }
      e.stopPropagation();
    });

    this.list = h('div.tree', { role: 'tree', tabindex: '0', 'aria-label': 'Scene hierarchy', 'aria-multiselectable': 'true' });
    this.dropLine = h('div.drop-line');
    this.dropLine.hidden = true;
    this.scroller = h('div.tree-scroll', this.list, this.dropLine);

    this.element = h(
      'div.panel.hierarchy',
      { dataset: { panel: 'hierarchy' } },
      h('div.panel-toolbar', addBtn, h('div.search.grow', icon('search'), this.search)),
      this.scroller,
    );

    this.bind();
    this.render();
  }

  bind() {
    const { editor } = this;
    const rerender = () => this.render();
    editor.scene.on('load', () => {
      this.expanded.clear();
      this.render();
    });
    editor.scene.on('structure', rerender);
    editor.scene.on('dirty', rerender);
    editor.scene.on('change', ({ path }) => {
      if (path[0] === 'name' || path[0] === 'active' || path[0] === 'components') this.render();
    });
    editor.selection.on('change', () => {
      this.revealSelection();
      this.render();
      this.scrollToActive();
    });

    this.list.addEventListener('keydown', (e) => this.onKey(e));
    this.scroller.addEventListener('pointerdown', (e) => {
      if (e.target === this.scroller || e.target === this.list) {
        if (!e.ctrlKey && !e.shiftKey) editor.selection.clear();
        this.list.focus();
      }
    });
    this.scroller.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tree-row')) return;
      contextMenu(e, [
        { label: 'Paste', shortcut: 'Ctrl+V', disabled: !editor.clipboard, action: () => editor.paste() },
        { separator: true },
        ...createMenuItems(editor),
      ]);
    });

    // Dropping on empty space moves to the end of the root list.
    this.scroller.addEventListener('dragover', (e) => {
      if (e.target.closest('.tree-row')) return;
      if (!this.acceptsDrag(e)) return;
      e.preventDefault();
      this.showDrop(null, 'root');
    });
    this.scroller.addEventListener('dragleave', (e) => {
      if (!this.scroller.contains(e.relatedTarget)) this.clearDrop();
    });
    this.scroller.addEventListener('drop', (e) => {
      if (e.target.closest('.tree-row')) return;
      e.preventDefault();
      this.handleDrop(e, null, 'root');
    });
  }

  // Tree model ----------------------------------------------------------------

  revealSelection() {
    const { scene, selection } = this.editor;
    for (const id of selection.ids) {
      let p = scene.get(id)?.parent ?? null;
      while (p !== null) {
        this.expanded.add(p);
        p = scene.get(p)?.parent ?? null;
      }
    }
    if (selection.ids.length) this.sceneExpanded = true;
  }

  visibleRows() {
    const { scene } = this.editor;
    const rows = [];
    if (this.filter) {
      scene.walk((e) => {
        if (e.name.toLowerCase().includes(this.filter)) rows.push({ entity: e, depth: 1, guides: [] });
      });
      return rows;
    }
    if (!this.sceneExpanded) return rows;
    const visit = (ids, depth, guides) => {
      ids.forEach((id, i) => {
        const e = scene.get(id);
        const last = i === ids.length - 1;
        rows.push({ entity: e, depth, guides });
        if (e.children.length && this.expanded.has(id)) visit(e.children, depth + 1, [...guides, !last]);
      });
    };
    visit(scene.roots, 1, []);
    return rows;
  }

  // Rendering -----------------------------------------------------------------

  render() {
    const { scene, selection } = this.editor;
    const scroll = this.scroller.scrollTop;
    clear(this.list);

    const sceneRow = h(
      'div.tree-row.scene-row',
      { role: 'treeitem', 'aria-level': '1', 'aria-expanded': String(this.sceneExpanded) },
      h('span.foldout', { class: 'open-' + this.sceneExpanded }, icon(this.sceneExpanded ? 'arrow-down' : 'arrow-right')),
      icon('scene', 'row-icon'),
      h('span.name', scene.name + (scene.dirty ? '*' : '')),
      h('span.spacer'),
    );
    const kebab = h('button.row-menu', { type: 'button' }, icon('kebab'));
    tooltip(kebab, 'Scene options');
    kebab.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu(this.sceneMenuItems(), { anchor: kebab, minWidth: 180 });
    });
    sceneRow.append(kebab);
    sceneRow.querySelector('.foldout').addEventListener('click', (e) => {
      e.stopPropagation();
      this.sceneExpanded = !this.sceneExpanded;
      this.render();
    });
    sceneRow.addEventListener('contextmenu', (e) => contextMenu(e, this.sceneMenuItems()));
    sceneRow.addEventListener('dragover', (e) => {
      if (!this.acceptsDrag(e)) return;
      e.preventDefault();
      this.showDrop(sceneRow, 'root');
    });
    sceneRow.addEventListener('drop', (e) => {
      e.preventDefault();
      this.handleDrop(e, null, 'root');
    });
    this.list.append(sceneRow);

    this.rows = this.visibleRows();
    const activeId = selection.active;
    for (const row of this.rows) this.list.append(this.renderRow(row, selection, activeId));
    this.scroller.scrollTop = scroll;
  }

  renderRow({ entity, depth, guides }, selection, activeId) {
    const { scene } = this.editor;
    const selected = selection.has(entity.id);
    const hasChildren = entity.children.length > 0 && !this.filter;
    const open = this.expanded.has(entity.id);
    const activeInHierarchy = scene.isActiveInHierarchy(entity.id);
    const el = h('div.tree-row', {
      role: 'treeitem',
      'aria-level': String(depth + 1),
      'aria-selected': String(selected),
      'aria-expanded': hasChildren ? String(open) : undefined,
      class: [selected ? 'selected' : '', activeInHierarchy ? '' : 'inactive', entity.id === activeId ? 'active-row' : ''].join(' ').trim() || undefined,
      draggable: 'true',
      dataset: { id: entity.id },
    });
    el.style.paddingLeft = `${depth * INDENT}px`;
    // Indent guides: one vertical line for every ancestor level with siblings below.
    guides.forEach((show, level) => {
      if (show) el.append(h('span.guide', { style: { left: `${(level + 1) * INDENT + 6}px` } }));
    });
    if (depth > 1 && !this.filter) el.append(h('span.guide.elbow', { style: { left: `${depth * INDENT - 8}px` } }));
    const fold = h('span.foldout', hasChildren ? icon(open ? 'arrow-down' : 'arrow-right') : null);
    fold.addEventListener('pointerdown', (e) => {
      if (!hasChildren) return;
      e.stopPropagation();
      this.toggleExpand(entity.id, e.altKey);
    });
    el.append(fold, icon(entityIcon(entity), 'row-icon'), h('span.name', entity.name));

    el.addEventListener('pointerdown', (e) => this.onRowPointerDown(e, entity.id));
    el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.foldout')) return;
      this.editor.frameSelected();
    });
    el.addEventListener('contextmenu', (e) => {
      if (!selection.has(entity.id)) selection.select(entity.id);
      contextMenu(e, this.rowMenuItems(entity.id));
    });
    el.addEventListener('dragstart', (e) => this.onDragStart(e, entity.id));
    el.addEventListener('dragover', (e) => this.onDragOver(e, el, entity));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleDrop(e, entity, this.dropZone(e, el, entity));
    });
    el.addEventListener('dragend', () => this.clearDrop());
    return el;
  }

  toggleExpand(id, recursive = false) {
    const open = !this.expanded.has(id);
    const ids = recursive ? this.editor.scene.subtree(id).map((e) => e.id) : [id];
    for (const x of ids) {
      if (open) this.expanded.add(x);
      else this.expanded.delete(x);
    }
    this.render();
  }

  scrollToActive() {
    const id = this.editor.selection.active;
    if (!id) return;
    this.list.querySelector(`.tree-row[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  // Selection -------------------------------------------------------------------

  onRowPointerDown(e, id) {
    if (e.button !== 0) return;
    if (this.renaming) return;
    const { selection } = this.editor;
    this.list.focus({ preventScroll: true });
    if (e.shiftKey && this.anchor) {
      const ids = this.rows.map((r) => r.entity.id);
      const a = ids.indexOf(this.anchor);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
        selection.set(e.ctrlKey ? [...selection.ids, ...range] : range);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      selection.toggle(id);
      this.anchor = id;
      return;
    }
    // Keep a multi-selection when starting a drag from one of its rows.
    if (selection.has(id) && selection.ids.length > 1) {
      const up = () => {
        window.removeEventListener('pointerup', up);
        if (!this.dragging) selection.select(id);
      };
      window.addEventListener('pointerup', up);
    } else if (selection.has(id) && selection.ids.length === 1 && !this.renaming) {
      // Slow second click on an already selected row starts rename.
      clearTimeout(this.renameTimer);
      this.renameTimer = setTimeout(() => {
        if (selection.active === id && !this.dragging) this.beginRename(id);
      }, 650);
      const cancel = () => clearTimeout(this.renameTimer);
      this.list.addEventListener('dblclick', cancel, { once: true });
    } else {
      selection.select(id);
    }
    this.anchor = id;
  }

  onKey(e) {
    if (this.renaming) return;
    const { selection, scene } = this.editor;
    const ids = this.rows.map((r) => r.entity.id);
    const current = selection.active;
    const index = ids.indexOf(current);
    const go = (i) => {
      const id = ids[Math.max(0, Math.min(ids.length - 1, i))];
      if (id) {
        selection.select(id);
        this.anchor = id;
      }
    };
    switch (e.key) {
      case 'ArrowDown':
        go(index < 0 ? 0 : index + 1);
        break;
      case 'ArrowUp':
        go(index < 0 ? ids.length - 1 : index - 1);
        break;
      case 'ArrowRight':
        if (current && scene.get(current).children.length) {
          if (!this.expanded.has(current)) this.toggleExpand(current, e.altKey);
          else go(index + 1);
        }
        break;
      case 'ArrowLeft':
        if (current && this.expanded.has(current)) this.toggleExpand(current, e.altKey);
        else if (current && scene.get(current).parent) selection.select(scene.get(current).parent);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(ids.length - 1);
        break;
      case 'F2':
        if (current) this.beginRename(current);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  // Rename ----------------------------------------------------------------------

  beginRename(id) {
    const row = this.list.querySelector(`.tree-row[data-id="${id}"]`);
    if (!row) return;
    const nameEl = row.querySelector('.name');
    const input = h('input.input.rename', { type: 'text', value: this.editor.scene.get(id).name, spellcheck: false, maxLength: 128 });
    input.value = this.editor.scene.get(id).name;
    this.renaming = id;
    row.draggable = false;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      this.renaming = null;
      if (commit) this.editor.rename(id, input.value);
      this.render();
      this.list.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  // Menus -------------------------------------------------------------------------

  rowMenuItems(id) {
    const { editor } = this;
    return [
      { label: 'Copy', shortcut: 'Ctrl+C', action: () => editor.copySelection() },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !editor.clipboard, action: () => editor.paste() },
      { separator: true },
      { label: 'Rename', shortcut: 'F2', action: () => this.beginRename(id) },
      { label: 'Duplicate', shortcut: 'Ctrl+D', action: () => editor.duplicateSelection() },
      { label: 'Delete', shortcut: 'Del', action: () => editor.deleteSelection() },
      { separator: true },
      { label: 'Frame Selected', shortcut: 'F', action: () => editor.frameSelected() },
      { label: 'Clear Parent', disabled: editor.scene.get(id)?.parent === null, action: () => editor.reparent(editor.selection.ids, null) },
      { separator: true },
      { label: 'Create Child', submenu: createMenuItems(editor, { asChild: true }) },
      ...createMenuItems(editor),
    ];
  }

  sceneMenuItems() {
    const { editor } = this;
    return [
      { label: 'Save Scene', shortcut: 'Ctrl+S', action: () => editor.emit('command', 'save') },
      { label: 'Save Scene As...', action: () => editor.emit('command', 'save-as') },
      { separator: true },
      { label: 'Expand All', action: () => { editor.scene.walk((e) => { this.expanded.add(e.id); }); this.render(); } },
      { label: 'Collapse All', action: () => { this.expanded.clear(); this.render(); } },
      { separator: true },
      ...createMenuItems(editor),
    ];
  }

  // Drag and drop ---------------------------------------------------------------------

  acceptsDrag(e) {
    const types = e.dataTransfer?.types || [];
    return types.includes(ENTITY_MIME) || types.includes(ASSET_MIME);
  }

  onDragStart(e, id) {
    const { selection } = this.editor;
    if (!selection.has(id)) selection.select(id);
    this.dragging = selection.ids.slice();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(ENTITY_MIME, JSON.stringify(this.dragging));
    e.dataTransfer.setData('text/plain', this.dragging.map((x) => this.editor.scene.get(x).name).join(', '));
    const end = () => {
      this.dragging = null;
      window.removeEventListener('dragend', end, true);
    };
    window.addEventListener('dragend', end, true);
  }

  dropZone(e, el, entity) {
    const r = el.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (y < 0.25) return 'before';
    if (y > 0.75 && !(entity.children.length && this.expanded.has(entity.id))) return 'after';
    return 'into';
  }

  onDragOver(e, el, entity) {
    if (!this.acceptsDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const zone = this.dropZone(e, el, entity);
    // Refuse dropping an entity into itself or a descendant.
    if (this.dragging) {
      const { scene } = this.editor;
      const target = zone === 'into' ? entity.id : entity.parent;
      if (this.dragging.some((id) => id === target || (target !== null && scene.isAncestor(id, target)) || id === entity.id && zone === 'into')) {
        e.dataTransfer.dropEffect = 'none';
        this.clearDrop();
        return;
      }
    }
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(ASSET_MIME) ? 'copy' : 'move';
    this.showDrop(el, zone);
  }

  showDrop(el, zone) {
    this.list.querySelectorAll('.drop-into').forEach((r) => r.classList.remove('drop-into'));
    if (zone === 'into' && el) {
      el.classList.add('drop-into');
      this.dropLine.hidden = true;
      return;
    }
    if (zone === 'root' || !el) {
      this.dropLine.hidden = true;
      if (el) el.classList.add('drop-into');
      return;
    }
    const top = el.offsetTop + (zone === 'after' ? el.offsetHeight : 0) - 1;
    this.dropLine.style.top = `${top}px`;
    this.dropLine.style.left = el.style.paddingLeft;
    this.dropLine.hidden = false;
  }

  clearDrop() {
    this.dropLine.hidden = true;
    this.list.querySelectorAll('.drop-into').forEach((r) => r.classList.remove('drop-into'));
  }

  handleDrop(e, entity, zone) {
    this.clearDrop();
    const { scene } = this.editor;
    let parent = null;
    let index;
    if (entity && zone === 'into') {
      parent = entity.id;
      this.expanded.add(entity.id);
    } else if (entity) {
      parent = entity.parent;
      index = scene.indexOf(entity.id) + (zone === 'after' ? 1 : 0);
    }

    const assetRaw = e.dataTransfer.getData(ASSET_MIME);
    if (assetRaw) {
      this.editor.emit('drop-asset', { asset: JSON.parse(assetRaw), parent, index });
      return;
    }
    const raw = e.dataTransfer.getData(ENTITY_MIME);
    if (!raw) return;
    const ids = JSON.parse(raw).filter((id) => scene.has(id));
    if (index !== undefined) {
      // Indices refer to the list after the moved items are taken out.
      const siblings = scene.childrenOf(parent);
      const before = ids.filter((id) => siblings.indexOf(id) >= 0 && siblings.indexOf(id) < index).length;
      index -= before;
    }
    this.editor.reparent(ids, parent, index);
  }
}
