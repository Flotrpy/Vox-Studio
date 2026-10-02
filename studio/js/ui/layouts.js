// Built-in window layouts offered by the toolbar Layout dropdown and the
// Window > Layouts menu.

import { split, tabs } from './dock-layout.js';

export const LAYOUT_PRESETS = {
  Default: () =>
    split('row', [
      split('col', [
        split('row', [tabs(['hierarchy']), tabs(['scene', 'game'])], [0.22, 0.78]),
        tabs(['project', 'console']),
      ], [0.66, 0.34]),
      tabs(['inspector']),
    ], [0.78, 0.22]),

  '2 by 3': () =>
    split('row', [
      split('col', [tabs(['scene']), tabs(['game'])], [0.5, 0.5]),
      tabs(['hierarchy']),
      tabs(['project', 'console']),
      tabs(['inspector']),
    ], [0.46, 0.16, 0.16, 0.22]),

  Tall: () =>
    split('row', [
      tabs(['scene', 'game']),
      split('col', [tabs(['hierarchy']), tabs(['project', 'console'])], [0.5, 0.5]),
      tabs(['inspector']),
    ], [0.56, 0.22, 0.22]),

  Wide: () =>
    split('col', [
      split('row', [tabs(['scene', 'game']), tabs(['hierarchy']), tabs(['inspector'])], [0.58, 0.18, 0.24]),
      tabs(['project', 'console']),
    ], [0.68, 0.32]),
};

export const DEFAULT_LAYOUT = 'Default';

/** Where a closed panel goes when it is reopened from the Window menu. */
export const PANEL_NEIGHBORS = {
  scene: ['game'],
  game: ['scene'],
  project: ['console'],
  console: ['project'],
  hierarchy: [],
  inspector: [],
  agent: ['inspector', 'console'],
};

export const PANEL_FALLBACK_SIDE = {
  hierarchy: 'left',
  inspector: 'right',
  project: 'bottom',
  console: 'bottom',
  scene: 'left',
  game: 'left',
};
