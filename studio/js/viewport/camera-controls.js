// Scene view navigation:
//   Alt + left drag      orbit around the pivot
//   middle drag          pan (also left drag with the Hand tool)
//   right drag           look around; hold W A S D Q E to fly (Shift = faster)
//   Alt + right drag     zoom
//   wheel                zoom toward the pivot
//   F / double-click     frame selection (driven by the scene view)

import * as THREE from 'three';

const MIN_DISTANCE = 0.05;
const MAX_DISTANCE = 20000;

export class EditorCamera {
  constructor(element, { onChange } = {}) {
    this.element = element;
    this.onChange = onChange || (() => {});
    this.perspective = new THREE.PerspectiveCamera(60, 1, 0.03, 5000);
    this.orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    this.ortho = false;
    this.is2D = false;
    this.pivot = new THREE.Vector3(0, 0, 0);
    this.distance = 14;
    this.yaw = Math.PI * 0.25;
    this.pitch = -0.42;
    this.aspect = 1;
    this.handTool = false;
    this.mode = null;
    this.keys = new Set();
    this.flySpeed = 4;
    this.flyHeld = 0;
    this.anim = null;
    this.update();
    this._bind();
  }

  get camera() {
    return this.ortho ? this.orthographic : this.perspective;
  }

  get flying() {
    return this.mode === 'look';
  }

  get forward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion());
  }

  quaternion() {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  setAspect(aspect) {
    this.aspect = aspect;
    this.update();
  }

  update() {
    const q = this.quaternion();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const position = this.pivot.clone().addScaledVector(forward, -this.distance);
    for (const cam of [this.perspective, this.orthographic]) {
      cam.position.copy(position);
      cam.quaternion.copy(q);
    }
    this.perspective.aspect = this.aspect;
    this.perspective.near = Math.max(0.01, this.distance * 0.002);
    this.perspective.far = Math.max(2000, this.distance * 100);
    this.perspective.updateProjectionMatrix();
    const half = this.distance * Math.tan((this.perspective.fov * Math.PI) / 360);
    this.orthographic.left = -half * this.aspect;
    this.orthographic.right = half * this.aspect;
    this.orthographic.top = half;
    this.orthographic.bottom = -half;
    this.orthographic.near = -Math.max(5000, this.distance * 50);
    this.orthographic.far = Math.max(5000, this.distance * 50);
    this.orthographic.updateProjectionMatrix();
    for (const cam of [this.perspective, this.orthographic]) cam.updateMatrixWorld(true);
    this.onChange();
  }

  setOrtho(ortho) {
    this.ortho = ortho;
    this.update();
  }

  set2D(on) {
    this.is2D = on;
    if (on) {
      this.saved3D = { yaw: this.yaw, pitch: this.pitch, ortho: this.ortho };
      this.yaw = 0;
      this.pitch = 0;
      this.ortho = true;
    } else if (this.saved3D) {
      Object.assign(this, this.saved3D);
    }
    this.update();
  }

  /** Look along a world axis (from the orientation gizmo). */
  lookAlong(axis) {
    // Camera sits on the named side of the pivot, looking back at it.
    const views = {
      '+x': [Math.PI / 2, 0],
      '-x': [-Math.PI / 2, 0],
      '+y': [0, -Math.PI / 2 + 1e-4],
      '-y': [0, Math.PI / 2 - 1e-4],
      '+z': [0, 0],
      '-z': [Math.PI, 0],
    };
    const [yaw, pitch] = views[axis];
    this.animateTo({ yaw, pitch });
  }

  /** Frame a bounding sphere. */
  frame(center, radius) {
    const r = Math.max(radius, 0.25);
    const fov = (this.perspective.fov * Math.PI) / 180;
    const distance = Math.min(MAX_DISTANCE, (r / Math.sin(fov / 2)) * 1.1);
    this.animateTo({ pivot: center.clone(), distance });
  }

  animateTo(target, duration = 160) {
    const from = { pivot: this.pivot.clone(), distance: this.distance, yaw: this.yaw, pitch: this.pitch };
    let dyaw = (target.yaw ?? from.yaw) - from.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const k = 1 - (1 - t) * (1 - t);
      if (target.pivot) this.pivot.lerpVectors(from.pivot, target.pivot, k);
      if (target.distance) this.distance = from.distance + (target.distance - from.distance) * k;
      if (target.yaw !== undefined) this.yaw = from.yaw + dyaw * k;
      if (target.pitch !== undefined) this.pitch = from.pitch + (target.pitch - from.pitch) * k;
      this.update();
      if (t < 1) this.anim = requestAnimationFrame(step);
      else this.anim = null;
    };
    cancelAnimationFrame(this.anim);
    this.anim = requestAnimationFrame(step);
  }

  pan(dx, dy) {
    const height = this.element.clientHeight || 1;
    const worldPerPixel = (2 * this.distance * Math.tan((this.perspective.fov * Math.PI) / 360)) / height;
    const q = this.quaternion();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    this.pivot.addScaledVector(right, -dx * worldPerPixel).addScaledVector(up, dy * worldPerPixel);
    this.update();
  }

  orbit(dx, dy) {
    if (this.is2D) return;
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch - dy * 0.006));
    this.update();
  }

  /** Rotate the view around the camera position (right-drag look). */
  look(dx, dy) {
    if (this.is2D) {
      this.pan(dx, dy);
      return;
    }
    const position = this.camera.position.clone();
    this.yaw -= dx * 0.004;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch - dy * 0.004));
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion());
    this.pivot.copy(position).addScaledVector(forward, this.distance);
    this.update();
  }

  zoom(factor) {
    this.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, this.distance * factor));
    this.update();
  }

  /** Called every frame; moves the camera while flying with WASD. */
  tick(dt) {
    if (this.mode !== 'look' || this.keys.size === 0) {
      this.flyHeld = 0;
      return false;
    }
    this.flyHeld += dt;
    const q = this.quaternion();
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.z -= 1;
    if (this.keys.has('KeyS')) move.z += 1;
    if (this.keys.has('KeyA')) move.x -= 1;
    if (this.keys.has('KeyD')) move.x += 1;
    if (this.keys.has('KeyE')) move.y += 1;
    if (this.keys.has('KeyQ')) move.y -= 1;
    if (move.lengthSq() === 0) return false;
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
    const accel = Math.min(4, 1 + this.flyHeld * 0.8);
    const speed = this.flySpeed * boost * accel * Math.max(0.5, this.distance * 0.15);
    move.normalize().applyQuaternion(q).multiplyScalar(speed * dt);
    this.pivot.add(move);
    this.update();
    return true;
  }

  /**
   * Touch: two fingers pan (move together) and zoom (pinch). One-finger
   * orbit is handled by the scene view so taps can still select.
   */
  _bindTouch() {
    const el = this.element;
    this.touches = new Map();
    let last = null;
    const centroid = () => {
      const pts = [...this.touches.values()];
      const x = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const y = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
      return { x, y, d };
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        // A second finger turns any one-finger gesture into pan/zoom.
        e.stopImmediatePropagation();
        el.setPointerCapture(e.pointerId);
        this.mode = 'touch';
        last = centroid();
      }
    }, true);
    el.addEventListener('pointermove', (e) => {
      if (!this.touches.has(e.pointerId)) return;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size < 2 || !last) return;
      const now = centroid();
      this.pan(now.x - last.x, now.y - last.y);
      if (last.d > 0 && now.d > 0) this.zoom(last.d / now.d);
      last = now;
    }, true);
    const end = (e) => {
      if (!this.touches.delete(e.pointerId)) return;
      if (this.touches.size < 2) last = null;
      if (this.touches.size === 0 && this.mode === 'touch') this.mode = null;
    };
    el.addEventListener('pointerup', end, true);
    el.addEventListener('pointercancel', end, true);
  }

  get touchCount() {
    return this.touches?.size || 0;
  }

  _bind() {
    const el = this.element;
    this._bindTouch();
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      let mode = null;
      if (e.button === 1) mode = 'pan';
      else if (e.button === 2) mode = e.altKey ? 'zoom' : 'look';
      else if (e.button === 0 && e.altKey) mode = this.is2D ? 'pan' : 'orbit';
      else if (e.button === 0 && this.handTool) mode = 'pan';
      if (!mode) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      el.setPointerCapture(e.pointerId);
      el.focus({ preventScroll: true });
      this.mode = mode;
      el.dataset.nav = mode;
      let lastX = e.clientX;
      let lastY = e.clientY;
      const move = (ev) => {
        const dx = ev.clientX - lastX;
        const dy = ev.clientY - lastY;
        lastX = ev.clientX;
        lastY = ev.clientY;
        if (this.mode === 'pan') this.pan(dx, dy);
        else if (this.mode === 'orbit') this.orbit(dx, dy);
        else if (this.mode === 'look') this.look(dx, dy);
        else if (this.mode === 'zoom') this.zoom(Math.pow(1.01, dx - dy));
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        this.mode = null;
        this.keys.clear();
        delete el.dataset.nav;
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }, true);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.mode === 'look') {
        // While flying, the wheel changes fly speed.
        this.flySpeed = Math.min(50, Math.max(0.1, this.flySpeed * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
        return;
      }
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.zoom(Math.pow(1.0015, delta));
    }, { passive: false });
    el.addEventListener('keydown', (e) => {
      if (this.mode === 'look' && /^(Key[WASDQE]|Shift(Left|Right))$/.test(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
        e.stopPropagation();
      }
    });
    el.addEventListener('keyup', (e) => this.keys.delete(e.code));
    el.addEventListener('blur', () => this.keys.clear());
  }
}
