// Vox Studio icon set: original 16x16 monochrome drawings. Shapes use
// currentColor so icons follow the surrounding text color.

const S = 'fill="none" stroke="currentColor" stroke-width="1.2"';

const ICONS = {
  hand: `<path d="M4.5 9V5.2a.8.8 0 0 1 1.6 0V8h.4V3.2a.8.8 0 0 1 1.6 0V8h.4V3.7a.8.8 0 0 1 1.6 0V8h.4V5.2a.8.8 0 0 1 1.6 0v5.3c0 2.2-1.6 3.8-3.8 3.8H8c-1.4 0-2.4-.6-3.1-1.8L3 9.4a.8.8 0 0 1 1.3-.9z"/>`,
  move: `<path d="M8 1l2.6 2.8H8.7v3.5h3.5V5.4L15 8l-2.8 2.6V8.7H8.7v3.5h1.9L8 15l-2.6-2.8h1.9V8.7H3.8v1.9L1 8l2.8-2.6v1.9h3.5V3.8H5.4z"/>`,
  rotate: `<path ${S} stroke-width="1.6" d="M12.6 5.2A5.3 5.3 0 1 0 13.3 9"/><path d="M14.4 2.4v4.8H9.6z"/>`,
  scale: `<rect x="1.5" y="9" width="5.5" height="5.5"/><path ${S} d="M5.6 2.1h8.3v8.3"/><path d="M14.5 1.5v5.2l-1.8-1.8-3.6 3.6-1.4-1.4 3.6-3.6-1.8-1.8z"/>`,
  rect: `<path ${S} d="M3 3h10v10H3z"/><rect x="1" y="1" width="4" height="4"/><rect x="11" y="1" width="4" height="4"/><rect x="1" y="11" width="4" height="4"/><rect x="11" y="11" width="4" height="4"/>`,
  transform: `<circle ${S} cx="8" cy="8" r="6.2"/><path d="M8 3.2l2 2.2H8.7v1.9h1.9V6l2.2 2-2.2 2V8.7H8.7v1.9H10l-2 2.2-2-2.2h1.3V8.7H5.4V10L3.2 8l2.2-2v1.3h1.9V5.4H6z"/>`,
  play: `<path d="M4 2.5v11L13 8z"/>`,
  pause: `<rect x="3.5" y="3" width="3" height="10"/><rect x="9.5" y="3" width="3" height="10"/>`,
  step: `<path d="M2.5 3v10l7-5z"/><rect x="11" y="3" width="2.5" height="10"/>`,
  plus: `<path d="M7.2 3h1.6v4.2H13v1.6H8.8V13H7.2V8.8H3V7.2h4.2z"/>`,
  'plus-menu': `<path d="M5.2 2h1.6v4.2H11v1.6H6.8V12H5.2V7.8H1V6.2h4.2z"/><path d="M10.5 11h5l-2.5 3z"/>`,
  search: `<circle ${S} stroke-width="1.5" cx="6.5" cy="6.5" r="4"/><path d="M9.4 10.5l1.1-1.1 4 4-1.1 1.1z"/>`,
  folder: `<path d="M1 3h5l1.5 1.5H15V13H1z"/>`,
  'folder-open': `<path d="M1 3h5l1.5 1.5H13V7H4L1.6 13H1z"/><path d="M4.6 8H15.5L13 13H2.2z"/>`,
  scene: `<path ${S} d="M1.6 2.6h12.8v10.8H1.6z"/><path d="M2.5 12.5l3.8-5 2.7 3.2 1.8-2 2.7 3.8z"/><circle cx="11" cy="5.5" r="1.3"/>`,
  gameobject: `<path ${S} stroke-linejoin="round" d="M8 1.8l5.6 3v6.4L8 14.2l-5.6-3V4.8zM2.4 4.8L8 7.8l5.6-3M8 7.8v6.4"/>`,
  'gameobject-solid': `<path d="M8 1.5l6 3.2L8 7.9 2 4.7z" opacity=".9"/><path d="M1.6 5.5L7.4 8.6v6.2L1.6 11.6z" opacity=".7"/><path d="M14.4 5.5L8.6 8.6v6.2l5.8-3.2z" opacity=".5"/>`,
  mesh: `<path ${S} stroke-linejoin="round" d="M2 13.5L8 2.5l6 11zM5 8h6M8 2.5v11M5 8l3 5.5L11 8"/>`,
  material: `<circle ${S} cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 1 0 12z"/>`,
  light: `<path d="M8 1.5a4.5 4.5 0 0 1 2.6 8.2V11H5.4V9.7A4.5 4.5 0 0 1 8 1.5z"/><rect x="5.4" y="12" width="5.2" height="1.2"/><rect x="6.2" y="13.8" width="3.6" height="1.2"/>`,
  sun: `<circle cx="8" cy="8" r="3"/><path d="M7.3 0.5h1.4v2.4H7.3zM7.3 13.1h1.4v2.4H7.3zM0.5 7.3h2.4v1.4H0.5zM13.1 7.3h2.4v1.4h-2.4zM2.4 3.4l1-1 1.7 1.7-1 1zM10.9 11.9l1-1 1.7 1.7-1 1zM2.4 12.6l1.7-1.7 1 1-1.7 1.7zM10.9 4.1l1.7-1.7 1 1-1.7 1.7z"/>`,
  camera: `<rect x="1" y="4.5" width="9.5" height="7.5"/><path d="M11.2 7.6L15 5v6.5l-3.8-2.6z"/>`,
  script: `<path ${S} d="M3 1.6h7l3 3v9.8H3z"/><path d="M6.6 6.8L4.8 9l1.8 2.2-.8.7L3.4 9l2.4-2.9zM9.4 6.8l1.8 2.2-1.8 2.2.8.7L12.6 9l-2.4-2.9z"/>`,
  rigidbody: `<path ${S} stroke-width="1.5" d="M5.6 6.2V5a2.4 2.4 0 0 1 4.8 0v1.2"/><path d="M3.6 6.4h8.8l1.9 8.1H1.7z"/>`,
  collider: `<path fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.4" d="M2 2h12v12H2z"/><rect x="5.5" y="5.5" width="5" height="5"/>`,
  'transform-comp': `<path d="M7.3 1.5h1.4v6.2l5.4 3.1-.7 1.2L8 8.9l-5.4 3.1-.7-1.2 5.4-3.1z"/>`,
  info: `<circle ${S} stroke-width="1.4" cx="8" cy="8" r="6.3"/><rect x="7.2" y="7" width="1.6" height="5"/><rect x="7.2" y="4" width="1.6" height="1.7"/>`,
  warning: `<path d="M8 1.5l7 12.5H1zM7.2 6v4.2h1.6V6zm0 5.2v1.6h1.6v-1.6z" fill-rule="evenodd"/>`,
  error: `<path d="M5.2 1.5h5.6l3.7 3.7v5.6l-3.7 3.7H5.2l-3.7-3.7V5.2zm.4 3L4.5 5.6 6.9 8l-2.4 2.4 1.1 1.1L8 9.1l2.4 2.4 1.1-1.1L9.1 8l2.4-2.4-1.1-1.1L8 6.9z" fill-rule="evenodd"/>`,
  kebab: `<rect x="7" y="2.5" width="2" height="2"/><rect x="7" y="7" width="2" height="2"/><rect x="7" y="11.5" width="2" height="2"/>`,
  'arrow-right': `<path d="M6 4l4.5 4L6 12z"/>`,
  'arrow-down': `<path d="M4 6h8l-4 4.5z"/>`,
  'caret-down': `<path d="M4.5 6.5h7L8 10.5z"/>`,
  close: `<path d="M4.2 3.1L8 6.9l3.8-3.8 1.1 1.1L9.1 8l3.8 3.8-1.1 1.1L8 9.1l-3.8 3.8-1.1-1.1L6.9 8 3.1 4.2z"/>`,
  check: `<path d="M3 8.2l1.2-1.2 2.6 2.6L11.8 4.6 13 5.8l-6.2 6.2z"/>`,
  gear: `<path d="M7 1h2l.4 1.9 1.3.6 1.7-1 1.4 1.4-1 1.7.6 1.3L15 7v2l-1.9.4-.6 1.3 1 1.7-1.4 1.4-1.7-1-1.3.6L9 15H7l-.4-1.9-1.3-.6-1.7 1-1.4-1.4 1-1.7-.6-1.3L1 9V7l1.9-.4.6-1.3-1-1.7 1.4-1.4 1.7 1 1.3-.6zm1 4.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z" fill-rule="evenodd"/>`,
  grid: `<path d="M1 4.6h14v1.2H1zM1 10.2h14v1.2H1zM4.6 1h1.2v14H4.6zM10.2 1h1.2v14h-1.2z"/>`,
  bulb: `<path d="M8 1.5a4.5 4.5 0 0 0-2.6 8.2V11h5.2V9.7A4.5 4.5 0 0 0 8 1.5zM6.6 9.2V9.9h2.8V9.2a3.2 3.2 0 1 0-2.8 0z" fill-rule="evenodd"/><rect x="5.4" y="12" width="5.2" height="1.2"/><rect x="6.2" y="13.8" width="3.6" height="1.2"/>`,
  eye: `<path d="M8 3.5c3 0 5.5 2 7 4.5-1.5 2.5-4 4.5-7 4.5S2.5 10.5 1 8c1.5-2.5 4-4.5 7-4.5zm0 1.8a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z" fill-rule="evenodd"/>`,
  plug: `<rect x="5" y="1" width="1.4" height="4"/><rect x="9.6" y="1" width="1.4" height="4"/><path d="M3.5 5h9v3a4.5 4.5 0 0 1-3.8 4.4V15H7.3v-2.6A4.5 4.5 0 0 1 3.5 8z"/>`,
  layout: `<path d="M1.5 2h13v12h-13zM2.8 3.3v9.4h3.6V3.3zm4.9 0v4h5.5v-4zm0 5.3v4.1h5.5V8.6z" fill-rule="evenodd"/>`,
  star: `<path d="M8 1.2l2 4.4 4.8.5-3.6 3.2 1 4.7L8 11.6 3.8 14l1-4.7L1.2 6.1 6 5.6z"/>`,
  lock: `<path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2h1v7.5h-9V7zm1.5 0h4V5a2 2 0 0 0-4 0z" fill-rule="evenodd"/>`,
  maximize: `<path d="M2 2h12v12H2zm1.3 2.6v8.1h9.4V4.6z" fill-rule="evenodd"/>`,
  file: `<path d="M3 1.5h6.5L13 5v9.5H3z"/>`,
  stats: `<rect x="2" y="9" width="2.5" height="5"/><rect x="6.75" y="5" width="2.5" height="9"/><rect x="11.5" y="2" width="2.5" height="12"/>`,
  build: `<path d="M2 9h12v5H2zM5.5 2h5v4.5h2.2L8 10.5 3.3 6.5h2.2z"/>`,
  refresh: `<path ${S} stroke-width="1.5" d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M14 1.5V6H9.5z"/>`,
  favicon: `<rect x="1" y="3" width="3" height="3"/><rect x="12" y="3" width="3" height="3"/><rect x="4" y="6" width="3" height="3"/><rect x="9" y="6" width="3" height="3"/><rect x="6.5" y="9" width="3" height="3"/>`,
};

/** Names of every icon, useful for tests and the About dialog. */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/** Create an <svg> element for an icon. Unknown names render empty. */
export function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon icon-${name} ${className}`.trim());
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

/** Icon markup as a data URL, for canvas sprites. */
export function iconDataUrl(name, color = '#C4C4C4', size = 64) {
  const body = (ICONS[name] || '').replaceAll('currentColor', color);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}" fill="${color}">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
