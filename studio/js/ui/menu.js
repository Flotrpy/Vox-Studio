// Drop-down, context and menu-bar menus with keyboard navigation.
//
// Item shape: { label, shortcut, action, checked, disabled, submenu, separator, header }
// `submenu` may be an array or a function returning one.

import { h } from './dom.js';
import { icon } from './icons.js';

const SUBMENU_DELAY_MS = 160;
const stack = [];
let onAllClosed = null;

function resolveItems(items) {
  return (typeof items === 'function' ? items() : items).filter(Boolean);
}

function position(el, x, y, { anchor, submenuOf } = {}) {
  el.style.left = '0px';
  el.style.top = '0px';
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = x;
  let top = y;
  if (left + rect.width > vw - 2) {
    left = submenuOf ? submenuOf.left - rect.width + 2 : vw - rect.width - 2;
  }
  if (top + rect.height > vh - 2) {
    top = anchor ? anchor.top - rect.height : vh - rect.height - 2;
  }
  el.style.left = `${Math.max(2, left)}px`;
  el.style.top = `${Math.max(2, top)}px`;
}

class Menu {
  constructor(items, options) {
    this.items = resolveItems(items);
    this.options = options;
    this.activeIndex = -1;
    this.child = null;
    this.hoverTimer = 0;
    this.rows = [];
    this.el = h('div.menu', { role: 'menu', tabindex: '-1' });
    if (options.minWidth) this.el.style.minWidth = `${options.minWidth}px`;
    this.render();
  }

  render() {
    this.items.forEach((item, index) => {
      if (item.separator) {
        this.el.append(h('div.menu-separator', { role: 'separator' }));
        this.rows.push(null);
        return;
      }
      if (item.header) {
        this.el.append(h('div.menu-header', item.header));
        this.rows.push(null);
        return;
      }
      const hasSub = !!item.submenu;
      const row = h(
        'div.menu-item',
        {
          role: item.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
          'aria-checked': item.checked === undefined ? undefined : String(!!item.checked),
          'aria-disabled': item.disabled ? 'true' : undefined,
          'aria-haspopup': hasSub ? 'menu' : undefined,
          class: item.disabled ? 'disabled' : undefined,
        },
        h('span.check-mark', item.checked ? icon('check') : null),
        h('span.label', item.label),
        h('span.shortcut', item.shortcut || ''),
        h('span.submenu-arrow', hasSub ? icon('arrow-right') : null),
      );
      row.addEventListener('pointerenter', () => this.setActive(index, true));
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activate(index);
      });
      this.el.append(row);
      this.rows.push(row);
    });
  }

  setActive(index, fromPointer = false) {
    if (this.activeIndex === index) return;
    this.rows[this.activeIndex]?.classList.remove('active');
    this.activeIndex = index;
    const row = this.rows[index];
    row?.classList.add('active');
    row?.scrollIntoView({ block: 'nearest' });
    clearTimeout(this.hoverTimer);
    const item = this.items[index];
    if (this.child && this.child.parentIndex !== index) closeFrom(stack.indexOf(this) + 1);
    if (item?.submenu && !item.disabled && fromPointer) {
      this.hoverTimer = setTimeout(() => this.openSubmenu(index), SUBMENU_DELAY_MS);
    }
  }

  openSubmenu(index, focusFirst = false) {
    const item = this.items[index];
    if (!item?.submenu || item.disabled) return;
    if (this.child?.parentIndex === index) return;
    closeFrom(stack.indexOf(this) + 1);
    const rect = this.rows[index].getBoundingClientRect();
    const sub = new Menu(item.submenu, { minWidth: 160 });
    sub.parentIndex = index;
    sub.parent = this;
    this.child = sub;
    document.body.append(sub.el);
    position(sub.el, rect.right - 2, rect.top - 4, { submenuOf: rect });
    stack.push(sub);
    if (focusFirst) sub.moveActive(1);
  }

  activate(index) {
    const item = this.items[index];
    if (!item || item.disabled) return;
    if (item.submenu) {
      this.openSubmenu(index, true);
      return;
    }
    closeAllMenus();
    item.action?.();
  }

  moveActive(delta) {
    const n = this.rows.length;
    if (!n) return;
    let i = this.activeIndex;
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n;
      if (this.rows[i]) {
        this.setActive(i);
        return;
      }
    }
  }
}

function closeFrom(index) {
  while (stack.length > index) {
    const menu = stack.pop();
    clearTimeout(menu.hoverTimer);
    menu.el.remove();
    if (menu.parent) menu.parent.child = null;
    menu.options.onClose?.();
  }
}

export function closeAllMenus() {
  const had = stack.length > 0;
  closeFrom(0);
  if (had && onAllClosed) {
    const fn = onAllClosed;
    onAllClosed = null;
    fn();
  }
}

export function isMenuOpen() {
  return stack.length > 0;
}

/**
 * Open a menu at a point or below an anchor element. Returns the menu.
 * Options: { anchor: Element, x, y, minWidth, onClose, keyboard }
 */
export function openMenu(items, options = {}) {
  closeAllMenus();
  const menu = new Menu(items, options);
  document.body.append(menu.el);
  let x = options.x ?? 0;
  let y = options.y ?? 0;
  let anchorRect = null;
  if (options.anchor) {
    anchorRect = options.anchor.getBoundingClientRect();
    x = anchorRect.left;
    y = anchorRect.bottom;
    if (!options.minWidth) menu.el.style.minWidth = `${Math.max(120, anchorRect.width)}px`;
  }
  position(menu.el, x, y, { anchor: anchorRect });
  stack.push(menu);
  if (options.keyboard) menu.moveActive(1);
  if (options.onAllClosed) onAllClosed = options.onAllClosed;
  return menu;
}

/** Open a context menu at the mouse position. */
export function contextMenu(event, items) {
  event.preventDefault();
  event.stopPropagation();
  return openMenu(items, { x: event.clientX, y: event.clientY });
}

// Global listeners: outside clicks and keyboard navigation.
window.addEventListener(
  'pointerdown',
  (e) => {
    if (!stack.length) return;
    if (stack.some((m) => m.el.contains(e.target))) return;
    if (e.target.closest?.('.menubar-item') && stack.length) return;
    closeAllMenus();
  },
  true,
);

window.addEventListener('blur', () => closeAllMenus());
window.addEventListener('resize', () => closeAllMenus());

window.addEventListener(
  'keydown',
  (e) => {
    if (!stack.length) return;
    const top = stack[stack.length - 1];
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case 'ArrowDown':
        top.moveActive(1);
        return handled();
      case 'ArrowUp':
        top.moveActive(-1);
        return handled();
      case 'ArrowRight':
        if (top.items[top.activeIndex]?.submenu) top.openSubmenu(top.activeIndex, true);
        else menuBarHook?.(1);
        return handled();
      case 'ArrowLeft':
        if (stack.length > 1) closeFrom(stack.length - 1);
        else menuBarHook?.(-1);
        return handled();
      case 'Enter':
      case ' ':
        if (top.activeIndex >= 0) top.activate(top.activeIndex);
        return handled();
      case 'Escape':
        if (stack.length > 1) closeFrom(stack.length - 1);
        else closeAllMenus();
        return handled();
      case 'Tab':
        closeAllMenus();
        return handled();
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          // Type-ahead: jump to the next item starting with the letter.
          const letter = e.key.toLowerCase();
          const n = top.items.length;
          for (let step = 1; step <= n; step++) {
            const i = (top.activeIndex + step) % n;
            if (top.rows[i] && top.items[i].label?.toLowerCase().startsWith(letter)) {
              top.setActive(i);
              break;
            }
          }
          return handled();
        }
    }
  },
  true,
);

let menuBarHook = null;

/**
 * The application menu bar. `menus` is [{ label, items }] where items is an
 * array or a function (evaluated each time the menu opens, so labels like
 * "Undo Move" stay current).
 */
export class MenuBar {
  constructor(el, menus) {
    this.el = el;
    this.menus = menus;
    this.openIndex = -1;
    this.buttons = menus.map((menu, index) => {
      const btn = h('button.menubar-item', { type: 'button', 'aria-haspopup': 'menu' }, menu.label);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.openIndex === index) closeAllMenus();
        else this.open(index);
      });
      btn.addEventListener('pointerenter', () => {
        if (this.openIndex >= 0 && this.openIndex !== index) this.open(index);
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          this.open(index, true);
        }
      });
      return btn;
    });
    el.append(...this.buttons);
  }

  open(index, keyboard = false) {
    const menu = this.menus[index];
    closeAllMenus();
    this.buttons.forEach((b, i) => b.classList.toggle('open', i === index));
    this.openIndex = index;
    openMenu(menu.items, {
      anchor: this.buttons[index],
      minWidth: 200,
      keyboard,
      onAllClosed: () => {
        this.buttons.forEach((b) => b.classList.remove('open'));
        this.openIndex = -1;
        menuBarHook = null;
      },
    });
    menuBarHook = (delta) => {
      const n = this.menus.length;
      this.open((this.openIndex + delta + n) % n, true);
    };
  }
}
