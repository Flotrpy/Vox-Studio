// Inspector panel: object header (active, name, static, tag, layer),
// collapsible component editors generated from the shared component
// schemas, per-component overflow menus and the Add Component popup.

import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/menu.js';
import { tooltip } from '../ui/tooltip.js';
import {
  checkbox,
  numberField,
  vector3Field,
  boolField,
  colorField,
  enumField,
  textField,
  sliderField,
  codeField,
  dropdownButton,
  fieldRow,
} from '../ui/fields.js';
import { COMPONENT_SCHEMAS, PRIMITIVES, TAGS, LAYERS, createComponent, createTransform } from '../../../shared/scene-format.js';
import { setFieldCommand, setSettingCommand } from '../core/commands.js';
import { load, save } from '../core/storage.js';

export const SCRIPT_TEMPLATE = `// Called once when Play starts.
function start() {
}

// Called every frame. dt is the frame time in seconds.
function update(dt) {
}
`;

const COMPONENT_ICONS = {
  Transform: 'transform-comp',
  MeshFilter: 'mesh',
  MeshRenderer: 'material',
  Light: 'light',
  Camera: 'camera',
  Rigidbody: 'rigidbody',
  BoxCollider: 'collider',
  SphereCollider: 'collider',
  MeshCollider: 'collider',
  Script: 'script',
};

const DISPLAY_NAMES = {
  MeshFilter: 'Mesh Filter',
  MeshRenderer: 'Mesh Renderer',
  BoxCollider: 'Box Collider',
  SphereCollider: 'Sphere Collider',
  MeshCollider: 'Mesh Collider',
};

/** Fields shown only in some configurations. */
const VISIBLE_WHEN = {
  Light: {
    range: (c) => c.lightType !== 'Directional',
    spotAngle: (c) => c.lightType === 'Spot',
  },
  Camera: {
    fov: (c) => !c.orthographic,
    size: (c) => c.orthographic,
  },
};

/** Field changes that alter which other fields are visible. */
const STRUCTURAL_FIELDS = new Set(['lightType', 'orthographic', 'enabled']);

export function componentDisplayName(type) {
  return DISPLAY_NAMES[type] || type;
}

export class InspectorPanel {
  constructor(editor) {
    this.editor = editor;
    this.id = 'inspector';
    this.title = 'Inspector';
    this.icon = 'info';
    this.folds = load('inspector:folds', {});
    this.fields = [];
    this.inspected = null;
    this.content = h('div.inspector-content');
    this.element = h('div.panel.inspector', { dataset: { panel: 'inspector' } }, h('div.inspector-scroll', this.content));
    this.componentClipboard = null;
    this.bind();
    this.rebuild();
  }

  bind() {
    const { editor } = this;
    editor.selection.on('change', () => this.rebuild());
    editor.scene.on('load', () => this.rebuild());
    editor.scene.on('structure', () => this.rebuild());
    editor.scene.on('settings', () => {
      if (!this.inspected) this.refresh();
    });
    editor.scene.on('change', ({ id, path }) => {
      if (id !== this.inspected) return;
      if (path[0] === 'components' && (path.length < 3 || STRUCTURAL_FIELDS.has(path[2]))) this.rebuild();
      else this.scheduleRefresh();
    });
  }

  scheduleRefresh() {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    // Coalesce bursts of changes (gizmo drags, play mode) into one refresh.
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      this.refresh();
    });
  }

  refresh() {
    for (const f of this.fields) f.refresh();
  }

  rebuild() {
    const { editor } = this;
    const scroll = this.content.parentElement?.scrollTop || 0;
    clear(this.content);
    this.fields = [];
    const id = editor.selection.active;
    const entity = id ? editor.scene.get(id) : null;
    this.inspected = entity ? entity.id : null;
    if (!entity) {
      this.renderSceneSettings();
      return;
    }
    if (editor.selection.ids.length > 1) {
      this.content.append(h('div.inspector-note', `${editor.selection.ids.length} objects selected. Showing ${entity.name}.`));
    }
    this.content.append(this.renderHeader(entity));
    this.content.append(this.renderTransform(entity));
    entity.components.forEach((component, index) => this.content.append(this.renderComponent(entity, component, index)));
    this.content.append(this.renderAddComponent(entity));
    if (this.content.parentElement) this.content.parentElement.scrollTop = scroll;
  }

  // Helpers ---------------------------------------------------------------------

  /** Bind a field path: live preview without history, commit as one undo step. */
  binding(id, path, label) {
    const { editor } = this;
    return {
      get: () => editor.scene.getField(id, path),
      onPreview: (v) => editor.scene.setField(id, path, v),
      onCommit: (v, before) => {
        editor.execute(setFieldCommand(editor.scene, id, path, before ?? editor.scene.getField(id, path), v, label));
        editor.history.seal();
      },
    };
  }

  setComponents(entity, components, label) {
    const before = structuredClone(entity.components);
    this.editor.execute(setFieldCommand(this.editor.scene, entity.id, ['components'], before, components, label));
    this.editor.history.seal();
  }

  foldout(key, header, body) {
    const open = this.folds[key] !== false;
    const arrow = h('span.foldout', icon(open ? 'arrow-down' : 'arrow-right'));
    const el = h('section.component', { class: open ? 'open' : 'closed' }, header, body);
    body.hidden = !open;
    const toggle = () => {
      const now = body.hidden;
      body.hidden = !now;
      el.classList.toggle('open', now);
      el.classList.toggle('closed', !now);
      arrow.replaceChildren(icon(now ? 'arrow-down' : 'arrow-right'));
      header.setAttribute('aria-expanded', String(now));
      this.folds[key] = now;
      save('inspector:folds', this.folds);
    };
    header.prepend(arrow);
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', String(open));
    header.addEventListener('click', (e) => {
      if (e.target.closest('.check, .component-menu')) return;
      toggle();
    });
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
    return el;
  }

  componentHeader(title, iconName, { enabled, onToggle, menu }) {
    const header = h('div.component-header', icon(iconName, 'component-icon'));
    if (onToggle) {
      const box = checkbox({ checked: enabled, label: `Enable ${title}`, onChange: onToggle });
      header.append(box.el);
    }
    header.append(h('span.component-title', title), h('span.spacer'));
    const kebab = h('button.component-menu', { type: 'button' }, icon('kebab'));
    tooltip(kebab, 'Component options');
    kebab.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu(menu(), { anchor: kebab, minWidth: 190 });
    });
    header.append(kebab);
    return header;
  }

  // Header ------------------------------------------------------------------------

  renderHeader(entity) {
    const { editor } = this;
    const id = entity.id;
    const active = checkbox({
      checked: entity.active,
      label: 'Active',
      tip: 'Active: inactive objects and their children are hidden and do not run',
      onChange: (v) => editor.setField(id, ['active'], v, v ? 'Activate' : 'Deactivate'),
    });
    const name = textField({ label: null, get: () => editor.scene.get(id)?.name ?? '', onCommit: (v) => editor.rename(id, v) });
    name.input.classList.add('object-name');
    name.input.setAttribute('aria-label', 'Object name');
    const isStatic = checkbox({
      checked: entity.static,
      label: 'Static',
      onChange: (v) => editor.setField(id, ['static'], v, 'Change Static'),
    });
    const tag = dropdownButton({
      label: 'Tag',
      get: () => editor.scene.get(id)?.tag,
      items: TAGS,
      onSelect: (v) => editor.setField(id, ['tag'], v, 'Change Tag'),
    });
    const layer = dropdownButton({
      label: 'Layer',
      get: () => editor.scene.get(id)?.layer,
      items: LAYERS,
      onSelect: (v) => editor.setField(id, ['layer'], v, 'Change Layer'),
    });
    this.fields.push(
      { refresh: () => active.set(editor.scene.get(id)?.active) },
      name,
      { refresh: () => isStatic.set(editor.scene.get(id)?.static) },
      tag,
      layer,
    );
    const staticLabel = h('label.check-label.static-toggle', isStatic.el, h('span', 'Static'));
    staticLabel.addEventListener('click', (e) => {
      if (e.target !== isStatic.el && !isStatic.el.contains(e.target)) isStatic.el.click();
    });
    return h(
      'div.object-header',
      h('div.object-row', icon('gameobject-solid', 'object-icon'), active.el, name.input, staticLabel),
      h('div.object-row.tag-row', h('span.mini-label', 'Tag'), tag.el, h('span.mini-label', 'Layer'), layer.el),
    );
  }

  // Transform ------------------------------------------------------------------------

  renderTransform(entity) {
    const id = entity.id;
    const { editor } = this;
    const body = h('div.component-body');
    const rows = [
      ['Position', 'position', 0.05],
      ['Rotation', 'rotation', 0.5],
      ['Scale', 'scale', 0.01],
    ];
    for (const [label, key, step] of rows) {
      const b = this.binding(id, ['transform', key], `Change ${label}`);
      const field = vector3Field({ label, step, ...b });
      this.fields.push(field);
      body.append(field.el);
    }
    const resetPart = (key, value, label) => () => editor.setField(id, ['transform', key], value, label);
    const header = this.componentHeader('Transform', COMPONENT_ICONS.Transform, {
      menu: () => [
        { label: 'Reset', action: () => editor.setField(id, ['transform'], createTransform(), 'Reset Transform') },
        { separator: true },
        { label: 'Reset Position', action: resetPart('position', [0, 0, 0], 'Reset Position') },
        { label: 'Reset Rotation', action: resetPart('rotation', [0, 0, 0], 'Reset Rotation') },
        { label: 'Reset Scale', action: resetPart('scale', [1, 1, 1], 'Reset Scale') },
        { separator: true },
        { label: 'Copy Transform', action: () => { this.componentClipboard = { type: 'Transform', data: structuredClone(editor.scene.get(id).transform) }; } },
        {
          label: 'Paste Transform Values',
          disabled: this.componentClipboard?.type !== 'Transform',
          action: () => editor.setField(id, ['transform'], this.componentClipboard.data, 'Paste Transform'),
        },
      ],
    });
    return this.foldout('Transform', header, body);
  }

  // Components --------------------------------------------------------------------------

  renderComponent(entity, component, index) {
    const id = entity.id;
    const { editor } = this;
    const schema = COMPONENT_SCHEMAS[component.type];
    const body = h('div.component-body');
    const visible = VISIBLE_WHEN[component.type] || {};

    for (const [key, def] of Object.entries(schema.fields)) {
      if (visible[key] && !visible[key](component)) continue;
      const path = ['components', index, key];
      const b = this.binding(id, path, `Change ${def.label}`);
      let field;
      switch (def.type) {
        case 'number':
          field = def.slider
            ? sliderField({ label: def.label, min: def.min, max: def.max, invert: def.invert, ...b })
            : numberField({ label: def.label, min: def.min, max: def.max, step: def.max <= 10 ? 0.01 : 0.1, ...b });
          break;
        case 'bool':
          field = boolField({ label: def.label, get: b.get, onCommit: b.onCommit });
          break;
        case 'color':
          field = colorField({ label: def.label, ...b });
          break;
        case 'vec3':
          field = vector3Field({ label: def.label, min: def.min, step: 0.01, ...b });
          break;
        case 'enum':
          field = enumField({ label: def.label, values: def.values, get: b.get, onCommit: b.onCommit });
          break;
        case 'string':
          field = textField({ label: def.label, get: b.get, onCommit: b.onCommit, maxLength: def.max });
          break;
        case 'mesh':
          field = this.meshField(def.label, b);
          break;
        case 'code':
          field = codeField({ get: b.get, onCommit: b.onCommit, label: `${component.name || 'Script'} source` });
          body.append(h('div.code-hint', 'start() runs once, update(dt) every frame. See Help > Scripting Reference.'));
          break;
        default:
          continue;
      }
      this.fields.push(field);
      body.append(field.el);
    }

    const title = component.type === 'Script' ? `${component.name} (Script)` : componentDisplayName(component.type);
    const header = this.componentHeader(title, COMPONENT_ICONS[component.type] || 'gear', {
      enabled: component.enabled,
      onToggle: (v) => editor.setField(id, ['components', index, 'enabled'], v, v ? 'Enable Component' : 'Disable Component'),
      menu: () => this.componentMenu(entity, index),
    });
    const el = this.foldout(component.type, header, body);
    if (!component.enabled) el.classList.add('disabled');
    return el;
  }

  meshField(label, b) {
    const { editor } = this;
    const assetLabel = (v) => {
      if (!v) return 'None';
      if (v.startsWith('asset:')) return editor.scene.assets[v.slice(6)]?.name || 'Missing';
      return v;
    };
    const items = () => [
      ...PRIMITIVES.map((p) => ({ value: p, label: p })),
      ...(Object.keys(editor.scene.assets).length ? [{ separator: true }] : []),
      ...Object.entries(editor.scene.assets).map(([key, asset]) => ({ value: `asset:${key}`, label: asset.name })),
    ];
    const dd = dropdownButton({ label, get: b.get, items, display: assetLabel, onSelect: (v, before) => v !== before && b.onCommit(v, before) });
    return { el: fieldRow(label, dd.el), refresh: dd.refresh };
  }

  componentMenu(entity, index) {
    const components = entity.components;
    const component = components[index];
    const move = (delta) => {
      const next = structuredClone(components);
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      this.setComponents(entity, next, delta < 0 ? 'Move Component Up' : 'Move Component Down');
    };
    return [
      {
        label: 'Reset',
        action: () => {
          const next = structuredClone(components);
          next[index] = component.type === 'Script'
            ? createComponent('Script', { name: component.name, code: SCRIPT_TEMPLATE })
            : createComponent(component.type);
          this.setComponents(entity, next, 'Reset Component');
        },
      },
      { separator: true },
      {
        label: 'Remove Component',
        action: () => {
          const next = structuredClone(components);
          next.splice(index, 1);
          this.setComponents(entity, next, `Remove ${componentDisplayName(component.type)}`);
        },
      },
      { label: 'Move Up', disabled: index === 0, action: () => move(-1) },
      { label: 'Move Down', disabled: index === components.length - 1, action: () => move(1) },
      { separator: true },
      { label: 'Copy Component', action: () => { this.componentClipboard = { type: component.type, data: structuredClone(component) }; } },
      {
        label: 'Paste Component Values',
        disabled: this.componentClipboard?.type !== component.type,
        action: () => {
          const next = structuredClone(components);
          next[index] = structuredClone(this.componentClipboard.data);
          this.setComponents(entity, next, 'Paste Component Values');
        },
      },
      {
        label: 'Paste Component As New',
        disabled: !this.componentClipboard || this.componentClipboard.type === 'Transform' || !this.canAdd(entity, this.componentClipboard.type),
        action: () => this.setComponents(entity, [...structuredClone(components), structuredClone(this.componentClipboard.data)], 'Paste Component'),
      },
    ];
  }

  canAdd(entity, type) {
    return !(COMPONENT_SCHEMAS[type]?.unique && entity.components.some((c) => c.type === type));
  }

  addComponent(entity, type) {
    if (!this.canAdd(entity, type)) {
      this.editor.log.warn(`${entity.name} already has a ${componentDisplayName(type)}`);
      return;
    }
    const component = type === 'Script' ? createComponent('Script', { code: SCRIPT_TEMPLATE }) : createComponent(type);
    this.folds[type] = true;
    this.setComponents(entity, [...structuredClone(entity.components), component], `Add ${componentDisplayName(type)}`);
  }

  // Add Component popup --------------------------------------------------------------

  renderAddComponent(entity) {
    const button = h('button.btn.add-component', { type: 'button' }, 'Add Component');
    button.addEventListener('click', () => this.openAddComponent(entity, button));
    return h('div.add-component-row', button);
  }

  openAddComponent(entity, anchor) {
    document.querySelector('.add-component-popup')?.remove();
    const search = h('input.input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search components', spellcheck: false });
    const list = h('div.popup-list', { role: 'listbox' });
    const title = h('div.popup-title');
    const popup = h('div.menu.add-component-popup', h('div.popup-search', h('div.search', icon('search'), search)), title, list);
    let category = null;
    let activeIndex = 0;
    let options = [];

    const categories = [...new Set(Object.values(COMPONENT_SCHEMAS).map((s) => s.category))];
    const close = () => {
      popup.remove();
      window.removeEventListener('pointerdown', outside, true);
    };
    const outside = (e) => {
      if (!popup.contains(e.target)) close();
    };
    const choose = (opt) => {
      if (!opt) return;
      if (opt.category) {
        category = opt.category;
        draw();
        return;
      }
      if (opt.back) {
        category = null;
        draw();
        return;
      }
      if (opt.disabled) return;
      close();
      this.addComponent(entity, opt.type);
    };
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      clear(list);
      if (q) {
        title.textContent = 'Search';
        options = Object.keys(COMPONENT_SCHEMAS)
          .filter((t) => componentDisplayName(t).toLowerCase().includes(q) || t.toLowerCase().includes(q) || (t === 'Script' && 'new script'.includes(q)))
          .map((t) => ({ type: t, label: t === 'Script' ? 'New Script' : componentDisplayName(t), disabled: !this.canAdd(entity, t) }));
      } else if (category) {
        title.textContent = category;
        options = [
          { back: true, label: category },
          ...Object.entries(COMPONENT_SCHEMAS)
            .filter(([, s]) => s.category === category)
            .map(([t]) => ({ type: t, label: t === 'Script' ? 'New Script' : componentDisplayName(t), disabled: !this.canAdd(entity, t) })),
        ];
      } else {
        title.textContent = 'Component';
        options = categories.map((c) => ({ category: c, label: c }));
      }
      activeIndex = options[0]?.back ? 1 : 0;
      options.forEach((opt, i) => {
        const row = h(
          'div.menu-item.popup-item',
          { role: 'option', class: [opt.disabled ? 'disabled' : '', opt.back ? 'back' : ''].join(' ').trim() || undefined },
          h('span', opt.back ? icon('arrow-right', 'flip') : opt.type ? icon(COMPONENT_ICONS[opt.type] || 'gear') : null),
          h('span.label', opt.label),
          h('span'),
          h('span.submenu-arrow', opt.category ? icon('arrow-right') : null),
        );
        row.addEventListener('pointerenter', () => setActive(i));
        row.addEventListener('click', () => choose(opt));
        list.append(row);
      });
      setActive(activeIndex);
    };
    const setActive = (i) => {
      activeIndex = Math.max(0, Math.min(options.length - 1, i));
      [...list.children].forEach((r, j) => r.classList.toggle('active', j === activeIndex));
      list.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
    };
    search.addEventListener('input', draw);
    search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown') setActive(activeIndex + 1);
      else if (e.key === 'ArrowUp') setActive(activeIndex - 1);
      else if (e.key === 'Enter' || (e.key === 'ArrowRight' && options[activeIndex]?.category)) choose(options[activeIndex]);
      else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && category && !search.value) {
        category = null;
        draw();
      } else if (e.key === 'Escape') close();
      else return;
      e.preventDefault();
    });

    document.body.append(popup);
    const r = anchor.getBoundingClientRect();
    const width = 230;
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.max(4, Math.min(window.innerWidth - width - 4, r.left + r.width / 2 - width / 2))}px`;
    const top = r.bottom + 2;
    popup.style.top = `${Math.min(top, window.innerHeight - 300)}px`;
    draw();
    search.focus();
    window.addEventListener('pointerdown', outside, true);
  }

  // Scene settings (nothing selected) --------------------------------------------------

  renderSceneSettings() {
    const { editor } = this;
    const scene = editor.scene;
    const bind = (key, label) => ({
      get: () => scene.settings[key],
      onPreview: (v) => scene.setSettings(key, v),
      onCommit: (v, before) => editor.execute(setSettingCommand(scene, key, before ?? scene.settings[key], v, label)),
    });
    const body = h('div.component-body');
    const fields = [
      colorField({ label: 'Background', ...bind('background', 'Change Background') }),
      colorField({ label: 'Ambient Color', ...bind('ambientColor', 'Change Ambient Color') }),
      numberField({ label: 'Ambient Intensity', min: 0, max: 100, step: 0.01, ...bind('ambientIntensity', 'Change Ambient Intensity') }),
      vector3Field({ label: 'Gravity', step: 0.05, ...bind('gravity', 'Change Gravity') }),
    ];
    for (const f of fields) {
      this.fields.push(f);
      body.append(f.el);
    }
    const header = this.componentHeader('Scene Settings', 'scene', {
      menu: () => [{ label: 'Nothing selected; editing scene settings', disabled: true }],
    });
    this.content.append(h('div.inspector-note', 'No object selected.'), this.foldout('SceneSettings', header, body));
  }
}
