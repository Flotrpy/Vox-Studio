// Dock manager: renders the layout tree, lets the user drag tabs between
// groups or to group edges, resize with splitters, and close/reopen panels.

import { Emitter } from '../core/events.js';
import { h, clear, dragTracker } from './dom.js';
import { icon } from './icons.js';
import { openMenu, contextMenu } from './menu.js';
import { tooltip } from './tooltip.js';
import {
  addTab,
  dockBeside,
  findGroup,
  groupsIn,
  normalizeLayout,
  panelsIn,
  removePanel,
  serializeLayout,
  tabs,
} from './dock-layout.js';

const MIN_PANE_PX = 90;
const EDGE_FRACTION = 0.28;
const ROOT_EDGE_PX = 18;

/**
 * panels: Map<id, { id, title, icon, element, onShow?, onHide?, toolbarMenu? }>
 * Events: 'change' (layout changed), 'focus' (panel id)
 */
export class DockManager extends Emitter {
  constructor(root, panels, { neighbors = {}, fallbackSide = {} } = {}) {
    super();
    this.rootEl = root;
    this.panels = panels;
    this.known = new Set(panels.keys());
    this.neighbors = neighbors;
    this.fallbackSide = fallbackSide;
    this.layout = null;
    this.maximized = null;
    this.visible = new Set();
    this.groupEls = new Map();
    this.focusedPanel = null;
    this._installFocusTracking();
  }

  setLayout(tree) {
    this.layout = normalizeLayout(serializeLayout(tree), this.known);
    this.maximized = null;
    this.render();
    this.emit('change', this.toJSON());
  }

  toJSON() {
    return this.layout ? serializeLayout(this.layout) : null;
  }

  isOpen(id) {
    return panelsIn(this.layout).includes(id);
  }

  isVisible(id) {
    return this.visible.has(id);
  }

  /** Show a panel: activate its tab, or re-add it if it was closed. */
  openPanel(id) {
    if (!this.known.has(id)) return;
    if (!this.isOpen(id)) {
      const neighbor = (this.neighbors[id] || []).find((n) => this.isOpen(n));
      if (neighbor) {
        addTab(findGroup(this.layout, neighbor).group, id);
      } else if (!this.layout) {
        this.layout = tabs([id]);
      } else {
        const side = this.fallbackSide[id] || 'right';
        this.layout = dockBeside(this.layout, this.layout, id, side, 0.22);
      }
      this.layout = normalizeLayout(this.layout, this.known);
    } else {
      const { group } = findGroup(this.layout, id);
      group.active = group.panels.indexOf(id);
    }
    this.render();
    this.emit('change', this.toJSON());
  }

  closePanel(id) {
    if (!this.isOpen(id)) return;
    this.layout = removePanel(this.layout, id, this.known);
    if (this.maximized && !this.isOpen(this.maximized.panels?.[0])) this.maximized = null;
    this.render();
    this.emit('change', this.toJSON());
  }

  togglePanel(id) {
    if (this.isOpen(id)) this.closePanel(id);
    else this.openPanel(id);
  }

  toggleMaximize(group) {
    this.maximized = this.maximized === group ? null : group;
    this.render();
  }

  // Rendering ---------------------------------------------------------------

  render() {
    const before = new Set(this.visible);
    this.visible.clear();
    this.groupEls.clear();
    // Detach panel elements first so re-rendering never destroys them.
    for (const p of this.panels.values()) p.element.remove();
    clear(this.rootEl);
    const node = this.maximized && groupsIn(this.layout).includes(this.maximized) ? this.maximized : this.layout;
    if (!node) {
      this.rootEl.append(h('div.dock-empty', 'All panels are closed. Reopen them from the Window menu.'));
    } else {
      const el = this.renderNode(node);
      el.style.flex = '1 1 0';
      this.rootEl.append(el);
    }
    for (const id of before) if (!this.visible.has(id)) this.panels.get(id)?.onHide?.();
    for (const id of this.visible) if (!before.has(id)) this.panels.get(id)?.onShow?.();
  }

  renderNode(node) {
    if (node.type === 'tabs') return this.renderGroup(node);
    const el = h(`div.dock-split.${node.dir}`);
    node.children.forEach((child, i) => {
      if (i > 0) el.append(this.renderSplitter(node, i - 1, el));
      const childEl = this.renderNode(child);
      childEl.style.flex = `${node.sizes[i]} 1 0px`;
      el.append(childEl);
    });
    return el;
  }

  renderGroup(group) {
    const tabbar = h('div.dock-tabbar', { role: 'tablist' });
    const body = h('div.dock-body');
    group.panels.forEach((id, index) => {
      const panel = this.panels.get(id);
      const active = index === group.active;
      const tab = h(
        'div.dock-tab',
        {
          role: 'tab',
          tabindex: active ? '0' : '-1',
          'aria-selected': String(active),
          class: active ? 'active' : undefined,
          dataset: { panel: id },
        },
        icon(panel.icon),
        h('span.title', panel.title),
      );
      tab.addEventListener('pointerdown', (e) => this.onTabPointerDown(e, group, id));
      tab.addEventListener('auxclick', (e) => {
        if (e.button === 1) this.closePanel(id);
      });
      tab.addEventListener('dblclick', () => this.toggleMaximize(group));
      tab.addEventListener('keydown', (e) => this.onTabKey(e, group, index));
      tab.addEventListener('contextmenu', (e) => contextMenu(e, this.tabMenuItems(group, id)));
      tabbar.append(tab);
      if (active) {
        body.append(panel.element);
        this.visible.add(id);
      }
    });
    const menuBtn = h('button.dock-menu-btn', { type: 'button' }, icon('kebab'));
    tooltip(menuBtn, 'Panel options');
    menuBtn.addEventListener('click', () => {
      const id = group.panels[group.active];
      openMenu(this.tabMenuItems(group, id), { anchor: menuBtn, minWidth: 180 });
    });
    tabbar.append(h('div.spacer'), menuBtn);
    const el = h('div.dock-group', tabbar, body);
    this.groupEls.set(el, group);
    return el;
  }

  tabMenuItems(group, id) {
    const panel = this.panels.get(id);
    const closed = [...this.panels.values()].filter((p) => !this.isOpen(p.id));
    return [
      ...(panel.toolbarMenu ? [...panel.toolbarMenu(), { separator: true }] : []),
      { label: this.maximized === group ? 'Restore' : 'Maximize', shortcut: 'Shift+Space', action: () => this.toggleMaximize(group) },
      { label: 'Close Tab', action: () => this.closePanel(id) },
      {
        label: 'Add Tab',
        disabled: closed.length === 0,
        submenu: closed.map((p) => ({
          label: p.title,
          action: () => {
            this.layout = normalizeLayout(this.layout, this.known);
            addTab(group, p.id);
            this.render();
            this.emit('change', this.toJSON());
          },
        })),
      },
    ];
  }

  onTabKey(e, group, index) {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % group.panels.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + group.panels.length) % group.panels.length;
    else return;
    e.preventDefault();
    group.active = next;
    this.render();
    this.emit('change', this.toJSON());
    this.rootEl.querySelector(`.dock-tab[data-panel="${group.panels[next]}"]`)?.focus();
  }

  // Splitters ---------------------------------------------------------------

  renderSplitter(node, index, splitEl) {
    const splitter = h('div.dock-splitter', { role: 'separator', 'aria-orientation': node.dir === 'row' ? 'vertical' : 'horizontal' });
    splitter.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const horizontal = node.dir === 'row';
      const children = [...splitEl.children].filter((c) => !c.classList.contains('dock-splitter'));
      const a = children[index];
      const b = children[index + 1];
      const sizeA = horizontal ? a.getBoundingClientRect().width : a.getBoundingClientRect().height;
      const sizeB = horizontal ? b.getBoundingClientRect().width : b.getBoundingClientRect().height;
      const share = node.sizes[index] + node.sizes[index + 1];
      document.body.classList.add(`splitter-dragging-${node.dir}`);
      dragTracker(e, {
        threshold: 0,
        onMove: (ev, dx, dy) => {
          const delta = horizontal ? dx : dy;
          const pxA = Math.max(MIN_PANE_PX, Math.min(sizeA + sizeB - MIN_PANE_PX, sizeA + delta));
          const pxB = sizeA + sizeB - pxA;
          node.sizes[index] = (share * pxA) / (pxA + pxB);
          node.sizes[index + 1] = (share * pxB) / (pxA + pxB);
          a.style.flex = `${node.sizes[index]} 1 0px`;
          b.style.flex = `${node.sizes[index + 1]} 1 0px`;
        },
        onEnd: () => {
          document.body.classList.remove(`splitter-dragging-${node.dir}`);
          this.emit('change', this.toJSON());
        },
      });
    });
    return splitter;
  }

  // Tab dragging ------------------------------------------------------------

  onTabPointerDown(e, group, id) {
    if (e.button !== 0) return;
    const index = group.panels.indexOf(id);
    if (group.active !== index) {
      group.active = index;
      this.render();
      this.emit('change', this.toJSON());
    }
    let ghost = null;
    let overlay = null;
    let target = null;
    dragTracker(e, {
      threshold: 6,
      onStart: () => {
        document.body.classList.add('dock-dragging');
        ghost = h('div.dock-ghost', this.panels.get(id).title);
        overlay = h('div.dock-overlay');
        overlay.hidden = true;
        document.body.append(ghost, overlay);
      },
      onMove: (ev) => {
        ghost.style.left = `${ev.clientX + 8}px`;
        ghost.style.top = `${ev.clientY + 8}px`;
        target = this.dropTarget(ev.clientX, ev.clientY, group, id);
        if (target) {
          const r = target.rect;
          Object.assign(overlay.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
          overlay.hidden = false;
        } else {
          overlay.hidden = true;
        }
      },
      onEnd: (ev, started) => {
        if (!started) return;
        document.body.classList.remove('dock-dragging');
        ghost?.remove();
        overlay?.remove();
        if (target) this.applyDrop(id, group, target);
      },
    });
  }

  /** Work out where a dragged tab would land under the pointer. */
  dropTarget(x, y, sourceGroup, id) {
    const rootRect = this.rootEl.getBoundingClientRect();
    if (this.maximized) return null;
    // Docking against the outer edges of the whole window.
    const edges = [
      ['left', x - rootRect.left],
      ['right', rootRect.right - x],
      ['top', y - rootRect.top],
      ['bottom', rootRect.bottom - y],
    ];
    const inside = x >= rootRect.left && x <= rootRect.right && y >= rootRect.top && y <= rootRect.bottom;
    if (!inside) return null;
    const nearEdge = edges.filter(([, d]) => d < ROOT_EDGE_PX).sort((a, b) => a[1] - b[1])[0];
    if (nearEdge && panelsIn(this.layout).length > 1) {
      const side = nearEdge[0];
      const w = rootRect.width * 0.25;
      const hgt = rootRect.height * 0.3;
      const rect =
        side === 'left' ? { left: rootRect.left, top: rootRect.top, width: w, height: rootRect.height }
        : side === 'right' ? { left: rootRect.right - w, top: rootRect.top, width: w, height: rootRect.height }
        : side === 'top' ? { left: rootRect.left, top: rootRect.top, width: rootRect.width, height: hgt }
        : { left: rootRect.left, top: rootRect.bottom - hgt, width: rootRect.width, height: hgt };
      return { kind: 'root', side, rect };
    }

    const el = document.elementFromPoint(x, y);
    const groupEl = el?.closest('.dock-group');
    if (!groupEl || !this.groupEls.has(groupEl)) return null;
    const group = this.groupEls.get(groupEl);
    const tabbar = groupEl.querySelector('.dock-tabbar');
    const barRect = tabbar.getBoundingClientRect();
    const groupRect = groupEl.getBoundingClientRect();

    if (y <= barRect.bottom) {
      const tabsEls = [...tabbar.querySelectorAll('.dock-tab')];
      let index = tabsEls.length;
      for (let i = 0; i < tabsEls.length; i++) {
        const r = tabsEls[i].getBoundingClientRect();
        if (x < r.left + r.width / 2) {
          index = i;
          break;
        }
      }
      const ref = tabsEls[index]?.getBoundingClientRect();
      const left = ref ? ref.left : tabsEls.length ? tabsEls[tabsEls.length - 1].getBoundingClientRect().right : barRect.left;
      return { kind: 'tab', group, index, rect: { left: left - 1, top: barRect.top, width: 3, height: barRect.height } };
    }

    const bodyTop = barRect.bottom;
    const bodyHeight = groupRect.bottom - bodyTop;
    const rx = (x - groupRect.left) / groupRect.width;
    const ry = (y - bodyTop) / bodyHeight;
    const alone = group === sourceGroup && group.panels.length === 1;
    let side = 'center';
    const distances = [
      ['left', rx],
      ['right', 1 - rx],
      ['top', ry],
      ['bottom', 1 - ry],
    ].sort((a, b) => a[1] - b[1]);
    if (distances[0][1] < EDGE_FRACTION) side = distances[0][0];
    if (alone) return null;
    if (side === 'center') {
      if (group === sourceGroup) return null;
      return { kind: 'tab', group, index: group.panels.length, rect: { left: groupRect.left, top: bodyTop, width: groupRect.width, height: bodyHeight } };
    }
    const half = {
      left: { left: groupRect.left, top: bodyTop, width: groupRect.width / 2, height: bodyHeight },
      right: { left: groupRect.left + groupRect.width / 2, top: bodyTop, width: groupRect.width / 2, height: bodyHeight },
      top: { left: groupRect.left, top: bodyTop, width: groupRect.width, height: bodyHeight / 2 },
      bottom: { left: groupRect.left, top: bodyTop + bodyHeight / 2, width: groupRect.width, height: bodyHeight / 2 },
    }[side];
    return { kind: 'edge', group, side, rect: half };
  }

  applyDrop(id, sourceGroup, target) {
    if (target.kind === 'tab' && target.group === sourceGroup) {
      // Reorder inside the same tab strip.
      const from = sourceGroup.panels.indexOf(id);
      let to = target.index;
      if (to > from) to -= 1;
      sourceGroup.panels.splice(from, 1);
      addTab(sourceGroup, id, to);
    } else {
      // Detach first, keeping the target node object alive in the tree.
      const from = sourceGroup.panels.indexOf(id);
      sourceGroup.panels.splice(from, 1);
      sourceGroup.active = Math.min(sourceGroup.active, Math.max(0, sourceGroup.panels.length - 1));
      if (target.kind === 'tab') addTab(target.group, id, target.index);
      else if (target.kind === 'edge') this.layout = dockBeside(this.layout, target.group, id, target.side);
      else this.layout = dockBeside(this.layout, this.layout, id, target.side, 0.25);
    }
    this.layout = normalizeLayout(this.layout, this.known);
    this.render();
    this.emit('change', this.toJSON());
  }

  // Focus tracking (selected rows dim when their panel loses focus) ---------

  _installFocusTracking() {
    this.rootEl.addEventListener('focusin', (e) => {
      const panelEl = e.target.closest('.panel');
      const id = panelEl?.dataset.panel || null;
      if (id === this.focusedPanel) return;
      this.rootEl.querySelectorAll('.panel.focused').forEach((p) => p.classList.remove('focused'));
      panelEl?.classList.add('focused');
      this.focusedPanel = id;
      this.emit('focus', id);
    });
    this.rootEl.addEventListener('focusout', (e) => {
      if (e.relatedTarget && this.rootEl.contains(e.relatedTarget)) return;
      this.rootEl.querySelectorAll('.panel.focused').forEach((p) => p.classList.remove('focused'));
      this.focusedPanel = null;
    });
  }
}
