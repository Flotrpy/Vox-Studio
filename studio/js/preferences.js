// Edit > Preferences: editor theme (Dark, Light or follow the system) and
// interface options, stored under "vox:prefs".

import { h } from './ui/dom.js';
import { openDialog } from './ui/dialog.js';
import { enumField } from './ui/fields.js';
import { load, save } from './core/storage.js';

const DEFAULTS = { theme: 'Dark' };
let prefs = { ...DEFAULTS, ...load('prefs', {}) };
const media = window.matchMedia?.('(prefers-color-scheme: light)');

export function getPrefs() {
  return prefs;
}

/** Resolve "System" and set data-theme on the document element. */
export function applyTheme() {
  const theme = prefs.theme === 'System' ? (media?.matches ? 'Light' : 'Dark') : prefs.theme;
  document.documentElement.dataset.theme = theme.toLowerCase();
  window.dispatchEvent(new CustomEvent('vox-theme', { detail: theme }));
}

media?.addEventListener?.('change', () => {
  if (prefs.theme === 'System') applyTheme();
});

export function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  save('prefs', prefs);
  applyTheme();
}

export function showPreferences() {
  const theme = enumField({
    label: 'Editor Theme',
    values: ['Dark', 'Light', 'System'],
    get: () => prefs.theme,
    onCommit: (v) => {
      setPref('theme', v);
      theme.refresh();
    },
  });
  openDialog({
    title: 'Preferences',
    width: 420,
    body: h('div.preferences', h('div.build-section-title', 'General'), theme.el),
  });
}
