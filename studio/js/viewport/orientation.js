// Orientation gizmo in the scene view's top-right corner. Click an axis
// cone to view along it; click the center square to switch between
// perspective and isometric (orthographic) projection.

import * as THREE from 'three';
import { h } from '../ui/dom.js';
import { tooltip } from '../ui/tooltip.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SIZE = 74;
const C = SIZE / 2;
const R = 27;
const AXES = [
  { key: '+x', dir: new THREE.Vector3(1, 0, 0), color: '#DB2C21', label: 'x' },
  { key: '+y', dir: new THREE.Vector3(0, 1, 0), color: '#7EBE2B', label: 'y' },
  { key: '+z', dir: new THREE.Vector3(0, 0, 1), color: '#3D7BE0', label: 'z' },
  { key: '-x', dir: new THREE.Vector3(-1, 0, 0), color: '#9A9A9A' },
  { key: '-y', dir: new THREE.Vector3(0, -1, 0), color: '#9A9A9A' },
  { key: '-z', dir: new THREE.Vector3(0, 0, -1), color: '#9A9A9A' },
];
const VIEW_NAMES = { '+x': 'Right', '-x': 'Left', '+y': 'Top', '-y': 'Bottom', '+z': 'Front', '-z': 'Back' };

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export class OrientationGizmo {
  constructor({ onAxis, onToggleProjection }) {
    this.svg = svg('svg', { width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'orientation-svg' });
    this.label = h('button.orientation-label', { type: 'button' }, 'Persp');
    tooltip(this.label, 'Toggle perspective / isometric');
    this.label.addEventListener('click', onToggleProjection);
    this.el = h('div.orientation', this.svg, this.label);
    this.parts = AXES.map((axis) => {
      const g = svg('g', { class: 'orientation-axis', 'data-axis': axis.key });
      const cone = svg('polygon', { fill: axis.color });
      g.append(cone);
      let text = null;
      if (axis.label) {
        text = svg('text', { class: 'orientation-text', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        text.textContent = axis.label;
        g.append(text);
      }
      const title = svg('title');
      title.textContent = `View from ${VIEW_NAMES[axis.key]}`;
      g.append(title);
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        onAxis(axis.key);
      });
      return { axis, g, cone, text };
    });
    this.center = svg('rect', { width: 11, height: 11, x: C - 5.5, y: C - 5.5, class: 'orientation-center' });
    const centerTitle = svg('title');
    centerTitle.textContent = 'Toggle perspective / isometric';
    this.center.append(centerTitle);
    this.center.addEventListener('click', (e) => {
      e.stopPropagation();
      onToggleProjection();
    });
    for (const p of this.parts) this.svg.append(p.g);
    this.svg.append(this.center);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  update(cameraQuaternion, ortho, is2D) {
    const inv = cameraQuaternion.clone().invert();
    const projected = this.parts.map((p) => ({ p, v: p.axis.dir.clone().applyQuaternion(inv) }));
    projected.sort((a, b) => a.v.z - b.v.z);
    let aligned = null;
    for (const { p, v } of projected) {
      const tipX = C + v.x * R;
      const tipY = C - v.y * R;
      const baseX = C + v.x * R * 0.38;
      const baseY = C - v.y * R * 0.38;
      // Cone width shrinks as the axis turns toward or away from the viewer.
      const len = Math.hypot(v.x, v.y);
      const nx = len > 1e-3 ? -v.y / len : 1;
      const ny = len > 1e-3 ? -v.x / len : 0;
      const w = 6;
      p.cone.setAttribute(
        'points',
        len < 0.05
          ? `${C - 6},${C - 6} ${C + 6},${C - 6} ${C + 6},${C + 6} ${C - 6},${C + 6}`
          : `${tipX},${tipY} ${baseX + nx * w},${baseY + ny * w} ${baseX - nx * w},${baseY - ny * w}`,
      );
      p.g.style.display = len < 0.05 && v.z < 0 ? 'none' : '';
      if (p.text) {
        p.text.setAttribute('x', C + v.x * (R + 7));
        p.text.setAttribute('y', C - v.y * (R + 7));
        p.text.style.display = len < 0.3 ? 'none' : '';
      }
      if (v.z > 0.999) aligned = p.axis.key;
    }
    this.svg.append(this.center);
    const name = aligned ? VIEW_NAMES[aligned] : ortho ? 'Iso' : 'Persp';
    this.label.textContent = is2D ? '2D' : name;
    this.label.classList.toggle('ortho', ortho);
  }
}
