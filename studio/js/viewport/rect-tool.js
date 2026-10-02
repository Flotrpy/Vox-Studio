// Rect tool: a screen-space rectangle around the selection. Drag inside to
// move in the view plane; drag a corner or edge to resize along the object
// axes that best match the screen's horizontal and vertical directions.

import * as THREE from 'three';
import { h } from '../ui/dom.js';
import { setTransformsCommand } from '../core/commands.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function round5(v) {
  return Number(v.toFixed(5)) + 0;
}

export class RectTool {
  constructor(view) {
    this.view = view;
    this.el = h('div.rect-tool', { hidden: true });
    this.handles = HANDLES.map((name) => {
      const handle = h(`div.rect-handle.${name}`, { dataset: { handle: name } });
      this.el.append(handle);
      return handle;
    });
    this.rect = null;
    this.targets = null;
    this.el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  /** Recompute the rectangle; `targets` is null to hide the tool. */
  update(targets) {
    this.targets = targets;
    if (!targets) {
      this.el.hidden = true;
      return;
    }
    const box = this.view.boundsOf(targets);
    const camera = this.view.controls.camera;
    const canvas = this.view.canvas;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      if (p.z > 1) continue;
      const sx = ((p.x + 1) / 2) * w;
      const sy = ((1 - p.y) / 2) * hgt;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    if (!Number.isFinite(minX)) {
      this.el.hidden = true;
      return;
    }
    this.rect = { x: minX, y: minY, w: Math.max(4, maxX - minX), h: Math.max(4, maxY - minY) };
    this.el.hidden = false;
    Object.assign(this.el.style, { left: `${minX}px`, top: `${minY}px`, width: `${this.rect.w}px`, height: `${this.rect.h}px` });
  }

  onPointerDown(e) {
    if (e.button !== 0 || !this.targets) return;
    e.preventDefault();
    e.stopPropagation();
    const kind = e.target.dataset.handle || 'move';
    const view = this.view;
    const camera = view.controls.camera;
    const scene = view.editor.scene;
    const starts = this.targets.map((id) => ({ id, before: structuredClone(scene.get(id).transform), object: view.builder.object(id) }));
    const start = { ...this.rect };
    const box = view.boundsOf(this.targets);
    const center = box.getCenter(new THREE.Vector3());
    // World units per screen pixel at the selection's depth.
    let perPixel;
    if (camera.isOrthographicCamera) perPixel = (camera.top - camera.bottom) / view.canvas.clientHeight;
    else perPixel = (2 * camera.position.distanceTo(center) * Math.tan((camera.fov * Math.PI) / 360)) / view.canvas.clientHeight;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    this.el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;

    // Which local axis of each object best matches screen right / up.
    const axisFor = (object, dir) => {
      const q = object.getWorldQuaternion(new THREE.Quaternion());
      let best = 0;
      let bestDot = -1;
      for (let i = 0; i < 3; i++) {
        const a = new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(q);
        const d = Math.abs(a.dot(dir));
        if (d > bestDot) {
          bestDot = d;
          best = i;
        }
      }
      return best;
    };

    const move = (ev) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      let fx = 1;
      let fy = 1;
      let shift = new THREE.Vector3();
      if (kind === 'move') {
        shift = right.clone().multiplyScalar(dx * perPixel).addScaledVector(up, -dy * perPixel);
      } else {
        const left = kind.includes('w');
        const top = kind.includes('n');
        const horizontal = kind.includes('e') || left;
        const vertical = kind.includes('s') || top;
        const nw = horizontal ? Math.max(2, start.w + (left ? -dx : dx)) : start.w;
        const nh = vertical ? Math.max(2, start.h + (top ? -dy : dy)) : start.h;
        fx = nw / start.w;
        fy = nh / start.h;
        // Keep the opposite edge in place: the center moves half the change.
        const cx = horizontal ? ((left ? -1 : 1) * (nw - start.w)) / 2 : 0;
        const cy = vertical ? ((top ? -1 : 1) * (nh - start.h)) / 2 : 0;
        shift = right.clone().multiplyScalar(cx * perPixel).addScaledVector(up, -cy * perPixel);
      }
      for (const s of starts) {
        const t = structuredClone(s.before);
        if (kind !== 'move') {
          t.scale[axisFor(s.object, right)] = round5(t.scale[axisFor(s.object, right)] * fx);
          const ay = axisFor(s.object, up);
          if (ay !== axisFor(s.object, right)) t.scale[ay] = round5(t.scale[ay] * fy);
        }
        // Convert the world shift into the parent's space.
        const parent = s.object.parent;
        const inv = parent.matrixWorld.clone().invert();
        const origin = new THREE.Vector3().applyMatrix4(inv);
        const local = shift.clone().applyMatrix4(inv).sub(origin);
        t.position = t.position.map((v, i) => round5(v + local.getComponent(i)));
        scene.setField(s.id, ['transform'], t);
      }
    };
    const end = () => {
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', end);
      const entries = starts.map((s) => ({ id: s.id, before: s.before, after: structuredClone(scene.get(s.id).transform) }));
      view.editor.record(setTransformsCommand(scene, entries, kind === 'move' ? 'Move' : 'Resize'));
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', end);
  }
}
