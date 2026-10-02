// Help menu dialogs: About Vox Studio and Keyboard Shortcuts.

import { h } from './ui/dom.js';
import { openDialog } from './ui/dialog.js';
import { VERSION, PRODUCT } from './version.js';

export const DISCLAIMER =
  'Vox Studio is inspired by popular game editors. Not affiliated with or endorsed by Unity Technologies. Unity is a trademark of Unity Technologies.';

export function showAbout(agent) {
  const agentLine = agent?.connected
    ? `Vox Agent ${agent.info?.version || ''} connected (project: ${agent.info?.project || ''})`
    : 'Vox Agent not connected';
  openDialog({
    title: `About ${PRODUCT}`,
    width: 460,
    body: h(
      'div.about',
      h('img.about-logo', { src: 'img/logo.svg', alt: 'Vox Studio', width: 198, height: 30 }),
      h('p.about-version', `Version ${VERSION}`),
      h('p', 'A browser-based 3D game editor with a local helper agent.'),
      h('p.about-agent', agentLine),
      h('p', 'Released under the MIT License. Includes three.js r160 (MIT). See THIRD_PARTY_NOTICES.md.'),
      h('p.about-disclaimer', DISCLAIMER),
    ),
  });
}

export const SHORTCUTS = [
  ['Q / W / E / R / T / Y', 'Hand, Move, Rotate, Scale, Rect, Transform tool'],
  ['Z', 'Toggle Pivot / Center'],
  ['X', 'Toggle Global / Local'],
  ['F', 'Frame selected'],
  ['Delete', 'Delete selected'],
  ['Ctrl+D', 'Duplicate'],
  ['Ctrl+C / Ctrl+V', 'Copy / Paste objects'],
  ['F2', 'Rename'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
  ['Ctrl+S', 'Save scene'],
  ['Ctrl+Shift+S', 'Save scene as'],
  ['Ctrl+N', 'New scene'],
  ['Ctrl+Shift+N', 'Create empty object'],
  ['Ctrl+A', 'Select all'],
  ['Ctrl+P', 'Play'],
  ['Ctrl+Shift+P', 'Pause'],
  ['Ctrl+Alt+P', 'Step'],
  ['Shift+Space', 'Maximize panel under the mouse'],
  ['Right drag + W A S D Q E', 'Fly through the scene (Shift = faster)'],
  ['Alt + left drag', 'Orbit'],
  ['Middle drag', 'Pan'],
  ['Alt + right drag / wheel', 'Zoom'],
  ['Ctrl while dragging a handle', 'Snap (0.25 m, 15 degrees, 0.1 scale)'],
];

export function showShortcuts() {
  openDialog({
    title: 'Keyboard Shortcuts',
    width: 520,
    body: h(
      'table.shortcuts',
      h('tbody', SHORTCUTS.map(([keys, what]) => h('tr', h('td.keys', keys), h('td', what)))),
    ),
  });
}

export const SCRIPTING_REFERENCE = [
  ['start()', 'Runs once when Play starts.'],
  ['update(dt)', 'Runs every frame; dt is the frame time in seconds.'],
  ['onCollisionEnter(other)', 'A collider started touching this object.'],
  ['onTriggerEnter(other)', 'This object entered a trigger, or something entered this trigger.'],
  ['gameObject', 'name, tag, active, getComponent(type), destroy()'],
  ['transform', 'position / rotation / scale (.x .y .z, set(x, y, z)), translate(x, y, z), rotate(x, y, z), forward, worldPosition'],
  ['rigidbody', 'velocity [x, y, z], addForce(x, y, z, "force" | "impulse"), mass; null without a Rigidbody'],
  ['Input', 'getKey("w"), getKeyDown("space"), getKeyUp(k), getAxis("Horizontal" | "Vertical"), getMouseButton(0), mousePosition'],
  ['Time', 'time, deltaTime, frameCount'],
  ['Debug', 'log(...), warn(...), error(...) write to the Console'],
  ['Scene', 'find(name), findWithTag(tag)'],
  ['Mathf', 'clamp, clamp01, lerp, moveTowards, deg2Rad, rad2Deg'],
];

export function showScriptingReference() {
  const example = `const speed = 4;

function update(dt) {
  transform.translate(Input.getAxis("Horizontal") * speed * dt, 0, -Input.getAxis("Vertical") * speed * dt);
  if (Input.getKeyDown("space") && rigidbody) rigidbody.addForce(0, 5, 0, "impulse");
}`;
  openDialog({
    title: 'Scripting Reference',
    width: 600,
    body: h(
      'div',
      h('p', 'Script components run JavaScript in Play mode and in exported builds. Define any of these functions:'),
      h('table.shortcuts', h('tbody', SCRIPTING_REFERENCE.map(([name, what]) => h('tr', h('td.keys', name), h('td', what))))),
      h('p', 'Example: move with WASD or the arrow keys, jump with Space.'),
      h('pre.mono.command', example),
    ),
  });
}
