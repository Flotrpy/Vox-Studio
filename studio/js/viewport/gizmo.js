// Transform gizmo: move arrows and plane handles, rotation rings, scale
// handles. It only reports drag deltas; the scene view applies them to the
// selected entities so every change goes through the scene model.

import * as THREE from 'three';

const COLORS = { X: 0xdb2c21, Y: 0x7ebe2b, Z: 0x3d7be0, view: 0xcccccc, center: 0xd0d0d0 };
const HOVER = 0xf6d33c;
const AXES = {
  X: new THREE.Vector3(1, 0, 0),
  Y: new THREE.Vector3(0, 1, 0),
  Z: new THREE.Vector3(0, 0, 1),
};
const PLANE_NORMAL_AXIS = { XY: 'Z', YZ: 'X', XZ: 'Y' };
const GIZMO_PIXELS = 100;

export const SNAP = { move: 0.25, rotate: 15, scale: 0.1 };

function basicMaterial(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

const PICKER_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

/** Rotate a Y-aligned geometry so it points along `axis`. */
function alignToAxis(geometry, axis) {
  if (axis === 'X') geometry.rotateZ(-Math.PI / 2);
  else if (axis === 'Z') geometry.rotateX(Math.PI / 2);
  return geometry;
}

export class TransformGizmo {
  constructor() {
    this.scene = new THREE.Scene();
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.groups = { move: new THREE.Group(), rotate: new THREE.Group(), scale: new THREE.Group() };
    for (const g of Object.values(this.groups)) this.root.add(g);
    this.handles = [];
    this.mode = 'move';
    this.space = 'global';
    this.hovered = null;
    this.active = null;
    this.root.visible = false;
    this.worldSize = 1;
    this.raycaster = new THREE.Raycaster();
    this.buildMove();
    this.buildRotate();
    this.buildScale();
    this.setMode('move');
  }

  addHandle(group, type, axis, visuals, picker, color, opacity = 1) {
    const handle = { type, axis, visuals, picker, color, opacity, group };
    for (const v of visuals) {
      v.userData.handle = handle;
      group.add(v);
    }
    picker.userData.handle = handle;
    group.add(picker);
    this.handles.push(handle);
    return handle;
  }

  buildMove() {
    const g = this.groups.move;
    for (const axis of ['X', 'Y', 'Z']) {
      const dir = AXES[axis];
      const shaft = new THREE.Mesh(alignToAxis(new THREE.CylinderGeometry(0.012, 0.012, 0.82, 6), axis), basicMaterial(COLORS[axis]));
      shaft.position.copy(dir).multiplyScalar(0.41);
      const head = new THREE.Mesh(alignToAxis(new THREE.ConeGeometry(0.055, 0.2, 16), axis), basicMaterial(COLORS[axis]));
      head.position.copy(dir).multiplyScalar(0.9);
      const picker = new THREE.Mesh(alignToAxis(new THREE.CylinderGeometry(0.08, 0.08, 1.05, 6), axis), PICKER_MATERIAL);
      picker.position.copy(dir).multiplyScalar(0.55);
      this.addHandle(g, 'move', axis, [shaft, head], picker, COLORS[axis]);
    }
    for (const plane of ['XY', 'YZ', 'XZ']) {
      const geo = new THREE.PlaneGeometry(0.2, 0.2);
      if (plane === 'YZ') geo.rotateY(Math.PI / 2);
      if (plane === 'XZ') geo.rotateX(-Math.PI / 2);
      const color = COLORS[PLANE_NORMAL_AXIS[plane]];
      const quad = new THREE.Mesh(geo, basicMaterial(color, 0.45));
      const offset = new THREE.Vector3(plane.includes('X') ? 0.2 : 0, plane.includes('Y') ? 0.2 : 0, plane.includes('Z') ? 0.2 : 0);
      quad.position.copy(offset);
      const picker = new THREE.Mesh(geo, PICKER_MATERIAL);
      picker.position.copy(offset);
      this.addHandle(g, 'move', plane, [quad], picker, color, 0.45);
    }
    const center = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), basicMaterial(COLORS.center, 0.9));
    const centerPicker = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), PICKER_MATERIAL);
    this.moveCenter = this.addHandle(g, 'move', 'view', [center], centerPicker, COLORS.center, 0.9);
  }

  buildRotate() {
    const g = this.groups.rotate;
    for (const axis of ['X', 'Y', 'Z']) {
      const ring = new THREE.TorusGeometry(1, 0.011, 6, 96);
      const pick = new THREE.TorusGeometry(1, 0.07, 6, 48);
      for (const geo of [ring, pick]) {
        if (axis === 'X') geo.rotateY(Math.PI / 2);
        if (axis === 'Y') geo.rotateX(Math.PI / 2);
      }
      this.addHandle(g, 'rotate', axis, [new THREE.Mesh(ring, basicMaterial(COLORS[axis]))], new THREE.Mesh(pick, PICKER_MATERIAL), COLORS[axis]);
    }
    this.viewRing = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.009, 6, 96), basicMaterial(COLORS.view, 0.8));
    const pick = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.06, 6, 48), PICKER_MATERIAL);
    g.add(this.viewRing);
    this.addHandle(this.viewRing, 'rotate', 'view', [ring], pick, COLORS.view, 0.8);
  }

  buildScale() {
    const g = this.groups.scale;
    this.scaleAxes = [];
    for (const axis of ['X', 'Y', 'Z']) {
      const dir = AXES[axis];
      const shaft = new THREE.Mesh(alignToAxis(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6), axis), basicMaterial(COLORS[axis]));
      shaft.position.copy(dir).multiplyScalar(0.4);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), basicMaterial(COLORS[axis]));
      head.position.copy(dir).multiplyScalar(0.85);
      const picker = new THREE.Mesh(alignToAxis(new THREE.CylinderGeometry(0.08, 0.08, 1, 6), axis), PICKER_MATERIAL);
      picker.position.copy(dir).multiplyScalar(0.5);
      this.scaleAxes.push(this.addHandle(g, 'scale', axis, [shaft, head], picker, COLORS[axis]));
    }
    const center = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), basicMaterial(COLORS.center, 0.9));
    const picker = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), PICKER_MATERIAL);
    this.scaleCenter = this.addHandle(g, 'scale', 'uniform', [center], picker, COLORS.center, 0.9);
  }

  setMode(mode) {
    this.mode = mode;
    const { move, rotate, scale } = this.groups;
    move.visible = mode === 'move' || mode === 'transform';
    rotate.visible = mode === 'rotate' || mode === 'transform';
    scale.visible = mode === 'scale' || mode === 'transform';
    // The combined tool keeps arrows and rings, plus a uniform scale cube.
    for (const h of this.scaleAxes) h.picker.visible = h.visuals[0].visible = h.visuals[1].visible = mode === 'scale';
    this.moveCenter.visuals[0].visible = this.moveCenter.picker.visible = mode === 'move';
  }

  /** Place the gizmo at the pivot and keep it a constant size on screen. */
  update(camera, viewportHeight, pivot, quaternion) {
    this.root.position.copy(pivot);
    this.root.quaternion.copy(this.space === 'local' || this.mode === 'scale' ? quaternion : new THREE.Quaternion());
    let worldPerPixel;
    if (camera.isOrthographicCamera) {
      worldPerPixel = (camera.top - camera.bottom) / camera.zoom / viewportHeight;
    } else {
      const dist = camera.position.distanceTo(pivot);
      worldPerPixel = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / viewportHeight;
    }
    this.worldSize = worldPerPixel * GIZMO_PIXELS;
    this.root.scale.setScalar(this.worldSize);
    // The outer rotation ring always faces the camera.
    const inv = this.root.quaternion.clone().invert();
    this.viewRing.quaternion.copy(inv.multiply(camera.quaternion));
    this.root.updateMatrixWorld(true);
  }

  pickers() {
    const out = [];
    for (const h of this.handles) {
      let visible = h.picker.visible;
      h.picker.traverseAncestors((a) => {
        if (!a.visible) visible = false;
      });
      if (visible) out.push(h.picker);
    }
    return out;
  }

  /** Handle under the pointer (ndc coordinates), or null. */
  hit(ndc, camera) {
    if (!this.root.visible) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObjects(this.pickers(), false);
    if (!hits.length) return null;
    // Prefer small handles (centers, planes) over long axes when overlapping.
    const priority = (h) => (h.axis === 'view' || h.axis === 'uniform' ? 0 : h.axis.length === 2 ? 1 : 2);
    hits.sort((a, b) => priority(a.object.userData.handle) - priority(b.object.userData.handle) || a.distance - b.distance);
    return hits[0].object.userData.handle;
  }

  setHover(handle) {
    if (this.hovered === handle) return false;
    this.hovered = handle;
    this.paint();
    return true;
  }

  paint() {
    for (const h of this.handles) {
      const hot = h === this.hovered || h === this.active?.handle;
      for (const v of h.visuals) {
        v.material.color.setHex(hot ? HOVER : h.color);
        v.material.opacity = hot ? 1 : h.opacity;
      }
    }
  }

  // Dragging ---------------------------------------------------------------

  axisWorld(name) {
    const q = this.root.quaternion;
    return AXES[name].clone().applyQuaternion(q).normalize();
  }

  eyeDirection(camera, point) {
    if (camera.isOrthographicCamera) return new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    return point.clone().sub(camera.position).normalize();
  }

  intersect(ray, plane) {
    const out = new THREE.Vector3();
    return ray.intersectPlane(plane, out) ? out : null;
  }

  /** Start dragging `handle`. Returns false if the drag cannot start. */
  begin(handle, ndc, pixel, camera) {
    const pivot = this.root.position.clone();
    const eye = this.eyeDirection(camera, pivot);
    let plane;
    let axis = null;
    if (handle.type === 'move' && handle.axis.length === 1) {
      axis = this.axisWorld(handle.axis);
      const normal = axis.clone().cross(eye.clone().cross(axis));
      if (normal.lengthSq() < 1e-8) normal.copy(eye);
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), pivot);
    } else if (handle.type === 'move' && handle.axis.length === 2) {
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.axisWorld(PLANE_NORMAL_AXIS[handle.axis]), pivot);
    } else if (handle.type === 'move') {
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(eye.clone().negate(), pivot);
    } else if (handle.type === 'rotate') {
      axis = handle.axis === 'view' ? eye.clone().negate() : this.axisWorld(handle.axis);
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, pivot);
    } else if (handle.type === 'scale' && handle.axis !== 'uniform') {
      axis = this.axisWorld(handle.axis);
      const normal = axis.clone().cross(eye.clone().cross(axis));
      if (normal.lengthSq() < 1e-8) normal.copy(eye);
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), pivot);
    } else {
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(eye.clone().negate(), pivot);
    }
    this.raycaster.setFromCamera(ndc, camera);
    const start = this.intersect(this.raycaster.ray, plane);
    if (!start && handle.type !== 'rotate') return false;
    const edgeOn = handle.type === 'rotate' && Math.abs(axis.dot(eye)) < 0.12;
    this.active = { handle, plane, axis, pivot, start, startPixel: { ...pixel }, edgeOn, lastAngle: 0, total: 0 };
    this.paint();
    return true;
  }

  /**
   * Continue the drag. Returns a delta relative to the drag start:
   *   { type: 'move', delta: Vector3 }
   *   { type: 'rotate', axis: Vector3, angle: radians }
   *   { type: 'scale', axisIndex: 0|1|2|-1, factor: number }
   */
  drag(ndc, pixel, camera, snap = false) {
    const a = this.active;
    if (!a) return null;
    const { handle } = a;
    this.raycaster.setFromCamera(ndc, camera);
    const point = this.intersect(this.raycaster.ray, a.plane);

    if (handle.type === 'move') {
      if (!point) return null;
      let delta = point.clone().sub(a.start);
      if (a.axis) delta = a.axis.clone().multiplyScalar(delta.dot(a.axis));
      if (snap) {
        // Snap along gizmo axes.
        const local = delta.clone().applyQuaternion(this.root.quaternion.clone().invert());
        local.set(...local.toArray().map((v) => Math.round(v / SNAP.move) * SNAP.move));
        delta = local.applyQuaternion(this.root.quaternion);
      }
      return { type: 'move', delta };
    }

    if (handle.type === 'rotate') {
      let angle;
      if (a.edgeOn || !point || !a.start) {
        angle = (pixel.x - a.startPixel.x - (pixel.y - a.startPixel.y)) * 0.01;
      } else {
        const v0 = a.start.clone().sub(a.pivot);
        const v1 = point.clone().sub(a.pivot);
        const raw = Math.atan2(a.axis.dot(v0.clone().cross(v1)), v0.dot(v1));
        // Accumulate so full turns keep counting.
        let step = raw - a.lastAngle;
        step = Math.atan2(Math.sin(step), Math.cos(step));
        a.total += step;
        a.lastAngle = raw;
        angle = a.total;
      }
      if (snap) {
        const s = (SNAP.rotate * Math.PI) / 180;
        angle = Math.round(angle / s) * s;
      }
      return { type: 'rotate', axis: a.axis.clone(), angle };
    }

    // Scale
    let factor;
    let axisIndex = -1;
    if (handle.axis === 'uniform') {
      factor = 1 + (pixel.x - a.startPixel.x - (pixel.y - a.startPixel.y)) * 0.008;
    } else {
      if (!point) return null;
      axisIndex = { X: 0, Y: 1, Z: 2 }[handle.axis];
      const d0 = a.start.clone().sub(a.pivot).dot(a.axis);
      const d1 = point.clone().sub(a.pivot).dot(a.axis);
      factor = Math.abs(d0) > this.worldSize * 0.05 ? d1 / d0 : 1 + (d1 - d0) / this.worldSize;
    }
    if (snap) factor = Math.round(factor / SNAP.scale) * SNAP.scale;
    return { type: 'scale', axisIndex, factor };
  }

  end() {
    this.active = null;
    this.paint();
  }
}
