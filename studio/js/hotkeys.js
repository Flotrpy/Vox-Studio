// Global keyboard shortcuts. Plain-letter shortcuts are ignored while the
// user is typing in a field; Ctrl shortcuts for saving and play mode work
// everywhere.

import { isTyping } from './ui/dom.js';
import { isMenuOpen } from './ui/menu.js';
import { isDialogOpen } from './ui/dialog.js';

/** Normalize an event into a string like "Ctrl+Shift+S". */
export function comboOf(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (e.code === 'Space') key = 'Space';
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  parts.push(key);
  return parts.join('+');
}

/** Shortcuts that still fire while typing in a text field. */
const WORKS_WHILE_TYPING = new Set(['Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+P', 'Ctrl+Shift+P', 'Ctrl+Alt+P']);

export class Hotkeys {
  constructor() {
    this.bindings = new Map();
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  bind(combos, action) {
    for (const combo of [].concat(combos)) this.bindings.set(combo, action);
  }

  onKey(e) {
    if (e.defaultPrevented || isMenuOpen() || isDialogOpen() || e.repeat && !/^(Delete)$/.test(e.key)) return;
    const combo = comboOf(e);
    const action = this.bindings.get(combo);
    if (!action) return;
    if (isTyping(e.target) && !WORKS_WHILE_TYPING.has(combo)) return;
    if (action(e) === false) return;
    e.preventDefault();
    e.stopPropagation();
  }
}
