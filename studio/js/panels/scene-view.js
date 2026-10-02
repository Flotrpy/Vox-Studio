// Scene view: editor camera, grid, selection, transform gizmo, rect tool,
// orientation gizmo and the scene view toolbar.

import * as THREE from 'three';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/menu.js';
import { tooltip } from '../ui/tooltip.js';
import { EditorCamera } from '../viewport/camera-controls.js';
import { Grid } from '../viewport/grid.js';
import { TransformGizmo } from '../viewport/gizmo.js';
import { SelectionOutline } from '../viewport/outline.js';
import { OrientationGizmo } from '../viewport/orientation.js';
import { EditorHelpers } from '../viewport/helpers.js';
import { RectTool } from '../viewport/rect-tool.js';
import { readTransform, EULER_ORDER, RAD2DEG } from '../viewport/scene-builder.js';
import { setTransformsCommand } from '../core/commands.js';
import { load, save } from '../core/storage.js';

const SHADING = { shaded: 'Shaded', wireframe: 'Wireframe', 'shaded-wireframe': 'Shaded Wireframe' };

function round5(v) {
  return Number(v.toFixed(5)) + 0;
}

/** Local transform arrays for an object given a desired world pose. */
function localFromWorld(object, worldPos, worldQuat, scale) {
  const parent = object.parent;
  parent.updateWorldMatrix(true, false);
  const parentInv = parent.matrixWorld.clone().invert();
  const pos = worldPos.clone().applyMatrix4(parentInv);
  const parentQuat = new THREE.Quaternion();
  parent.matrixWorld.decompose(new THREE.Vector3(), parentQuat, new THREE.Vector3());
  const q = parentQuat.invert().multiply(worldQuat);
  const e = new THREE.Euler().setFromQuaternion(q, EULER_ORDER);
  return {
    position: pos.toArray().map(round5),
    rotation: [e.x, e.y, e.z].map((r) => round5(r * RAD2DEG)),
    scale: scale.map(round5),
  };
}

export class SceneView {
  constructor(editor, builder) {
    this.editor = editor;
    this.builder = builder;
    this.id = 'scene';
    this.title = 'Scene';
    this.icon = 'scene';
    this.needsRender = true;
    this.visible = false;
    this.prefs = load('sceneview', { shading: 'shaded', lighting: true, grid: true, icons: true, outline: true, fov: 60 });

    this.canvas = h('canvas.viewport-canvas', { tabindex: '0', 'aria-label': 'Scene view' });
    this.viewport = h('div.viewport', this.canvas);
    this.toolbar = this.buildToolbar();
    this.element = h('div.panel.scene-view', { dataset: { panel: 'scene' } }, this.toolbar, this.viewport);

    this.renderer = null;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } catch (err) {
      this.viewport.append(h('div.viewport-message', 'WebGL is not available in this browser.'));
      editor.log.error('Scene view could not create a WebGL context', String(err));
    }

    this.controls = new EditorCamera(this.canvas, { onChange: () => this.invalidate() });
    this.controls.perspective.fov = this.prefs.fov;
    this.grid = new Grid();
    this.gridScene = new THREE.Scene();
    this.gridScene.add(this.grid.mesh);
    this.gizmo = new TransformGizmo();
    this.outline = new SelectionOutline();
    this.helpers = new EditorHelpers(builder);
    this.headlight = new THREE.DirectionalLight(0xffffff, 2.4);
    this.headAmbient = new THREE.AmbientLight(0xffffff, 0.9);
    this.wireMaterial = new THREE.MeshBasicMaterial({ color: 0xa8a8a8, wireframe: true });
    this.wireOverlay = new THREE.MeshBasicMaterial({ color: 0x101010, wireframe: true, transparent: true, opacity: 0.35 });

    this.orientation = new OrientationGizmo({
      onAxis: (axis) => this.controls.lookAlong(axis),
      onToggleProjection: () => this.controls.setOrtho(!this.controls.ortho),
    });
    this.viewport.append(this.orientation.el);

    this.rectTool = new RectTool(this);
    this.viewport.append(this.rectTool.el);
    this.marquee = h('div.marquee');
    this.marquee.hidden = true;
    this.viewport.append(this.marquee);

    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.drag = null;

    this.bindEditor();
    this.bindPointer();
    this.bindDrop();
    new ResizeObserver(() => this.invalidate()).observe(this.viewport);
    this.applyPrefs();
  }

  invalidate() {
    this.needsRender = true;
  }

  onShow() {
    this.visible = true;
    this.invalidate();
  }

  onHide() {
    this.visible = false;
  }

  // Toolbar -----------------------------------------------------------------

  buildToolbar() {
    const shading = h('button.tb-btn.dropdown', { type: 'button' }, h('span.shading-label', SHADING[this.prefs.shading]));
    tooltip(shading, 'Draw mode');
    shading.addEventListener('click', () =>
      openMenu(
        Object.entries(SHADING).map(([key, label]) => ({
          label,
          checked: this.prefs.shading === key,
          action: () => this.setPref('shading', key),
        })),
        { anchor: shading },
      ),
    );
    this.shadingButton = shading;

    this.btn2D = h('button.tb-btn.text-btn', { type: 'button', 'aria-pressed': 'false' }, '2D');
    tooltip(this.btn2D, '2D view: orthographic, looking down -Z');
    this.btn2D.addEventListener('click', () => this.toggle2D());

    this.btnLighting = h('button.tb-btn', { type: 'button' }, icon('bulb'));
    tooltip(this.btnLighting, 'Scene lighting\nOff uses a light attached to the camera');
    this.btnLighting.addEventListener('click', () => this.setPref('lighting', !this.prefs.lighting));

    this.btnGrid = h('button.tb-btn', { type: 'button' }, icon('grid'));
    tooltip(this.btnGrid, 'Toggle grid');
    this.btnGrid.addEventListener('click', () => this.setPref('grid', !this.prefs.grid));

    const cameraBtn = h('button.tb-btn.dropdown', { type: 'button' }, icon('camera'));
    tooltip(cameraBtn, 'Scene camera settings');
    cameraBtn.addEventListener('click', () =>
      openMenu(
        [
          { header: 'Field of View' },
          ...[40, 60, 75, 90].map((fov) => ({ label: `${fov}°`, checked: this.prefs.fov === fov, action: () => this.setPref('fov', fov) })),
          { separator: true },
          { label: 'Perspective', checked: !this.controls.ortho, action: () => this.controls.setOrtho(false) },
          { label: 'Isometric', checked: this.controls.ortho, action: () => this.controls.setOrtho(true) },
          { separator: true },
          { label: 'Reset View', action: () => this.resetView() },
        ],
        { anchor: cameraBtn },
      ),
    );

    const gizmos = h('button.tb-btn.dropdown', { type: 'button' }, 'Gizmos');
    tooltip(gizmos, 'Gizmo visibility');
    gizmos.addEventListener('click', () =>
      openMenu(
        [
          { label: 'Grid', checked: this.prefs.grid, action: () => this.setPref('grid', !this.prefs.grid) },
          { label: 'Light and Camera Icons', checked: this.prefs.icons, action: () => this.setPref('icons', !this.prefs.icons) },
          { label: 'Selection Outline', checked: this.prefs.outline, action: () => this.setPref('outline', !this.prefs.outline) },
        ],
        { anchor: gizmos, minWidth: 200 },
      ),
    );

    return h(
      'div.panel-toolbar.scene-toolbar',
      shading,
      h('span.tb-sep'),
      this.btn2D,
      this.btnLighting,
      this.btnGrid,
      h('div.spacer'),
      cameraBtn,
      gizmos,
    );
  }

  setPref(key, value) {
    this.prefs[key] = value;
    save('sceneview', this.prefs);
    this.applyPrefs();
  }

  applyPrefs() {
    this.shadingButton.querySelector('.shading-label').textContent = SHADING[this.prefs.shading];
    this.btnLighting.setAttribute('aria-pressed', String(this.prefs.lighting));
    this.btnGrid.setAttribute('aria-pressed', String(this.prefs.grid));
    this.helpers.showIcons = this.prefs.icons;
    this.controls.perspective.fov = this.prefs.fov;
    this.controls.update();
    this.invalidate();
  }

  toggle2D() {
    const on = !this.controls.is2D;
    this.controls.set2D(on);
    this.grid.setPlane(on ? 'xy' : 'xz');
    this.btn2D.setAttribute('aria-pressed', String(on));
    this.invalidate();
  }

  resetView() {
    this.controls.pivot.set(0, 0, 0);
    this.controls.distance = 14;
    this.controls.yaw = Math.PI * 0.25;
    this.controls.pitch = -0.42;
    this.controls.update();
  }

  // Editor wiring -------------------------------------------------------------

  bindEditor() {
    const { editor } = this;
    const refresh = () => {
      this.helpers.sync(editor.scene);
      this.invalidate();
    };
    editor.scene.on('load', refresh);
    editor.scene.on('structure', refresh);
    editor.scene.on('change', ({ path }) => {
      if (path[0] === 'components') this.helpers.sync(editor.scene);
      this.invalidate();
    });
    editor.scene.on('settings', () => this.invalidate());
    editor.selection.on('change', () => this.invalidate());
    editor.on('tool', () => {
      this.controls.handTool = editor.tool === 'hand';
      this.invalidate();
    });
    editor.on('frame', (ids) => this.frame(ids));
    editor.reparentTransform = (id, parentId) => this.reparentTransform(id, parentId);
    editor.viewInfo = () => ({ position: this.controls.camera.position.clone(), quaternion: this.controls.camera.quaternion.clone(), pivot: this.controls.pivot.clone() });
    this.helpers.sync(editor.scene);
  }

  reparentTransform(id, parentId) {
    const object = this.builder.object(id);
    if (!object) return null;
    object.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    object.matrixWorld.decompose(pos, quat, scl);
    const parent = parentId === null ? null : this.builder.object(parentId);
    const parentMatrix = parent ? (parent.updateWorldMatrix(true, false), parent.matrixWorld.clone()) : new THREE.Matrix4();
    const local = parentMatrix.clone().invert().multiply(object.matrixWorld);
    const lp = new THREE.Vector3();
    const lq = new THREE.Quaternion();
    const ls = new THREE.Vector3();
    local.decompose(lp, lq, ls);
    const e = new THREE.Euler().setFromQuaternion(lq, EULER_ORDER);
    return {
      position: lp.toArray().map(round5),
      rotation: [e.x, e.y, e.z].map((r) => round5(r * RAD2DEG)),
      scale: ls.toArray().map(round5),
    };
  }

  /** Place selected objects at the view pivot (GameObject > Move To View). */
  moveToView() {
    const entries = this.gizmoTargets().map((id) => {
      const object = this.builder.object(id);
      const before = structuredClone(this.editor.scene.get(id).transform);
      const quat = object.getWorldQuaternion(new THREE.Quaternion());
      return { id, before, after: localFromWorld(object, this.controls.pivot.clone(), quat, before.scale) };
    });
    if (entries.length) this.editor.execute(setTransformsCommand(this.editor.scene, entries, 'Move To View'));
  }

  /** Match selected objects to the scene camera (GameObject > Align With View). */
  alignWithView() {
    const camera = this.controls.camera;
    const entries = this.gizmoTargets().map((id) => {
      const object = this.builder.object(id);
      const before = structuredClone(this.editor.scene.get(id).transform);
      return { id, before, after: localFromWorld(object, camera.position.clone(), camera.quaternion.clone(), before.scale) };
    });
    if (entries.length) this.editor.execute(setTransformsCommand(this.editor.scene, entries, 'Align With View'));
  }

  /** World bounds of entities (meshes, or a small box at their position). */
  boundsOf(ids) {
    const box = new THREE.Box3();
    for (const id of ids) {
      const object = this.builder.object(id);
      if (!object) continue;
      object.updateWorldMatrix(true, true);
      const objBox = new THREE.Box3().setFromObject(object, true);
      if (objBox.isEmpty()) {
        const p = object.getWorldPosition(new THREE.Vector3());
        objBox.setFromCenterAndSize(p, new THREE.Vector3(1, 1, 1));
      }
      box.union(objBox);
    }
    return box;
  }

  frame(ids) {
    const targets = ids.length ? ids : [...this.editor.scene.entities.keys()];
    const box = this.boundsOf(targets);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.controls.frame(sphere.center, sphere.radius);
  }

  /** Top-level selected entities that exist in the viewport. */
  gizmoTargets() {
    const { scene, selection } = this.editor;
    const set = new Set(selection.ids);
    return selection.ids.filter((id) => {
      if (!this.builder.object(id)) return false;
      let p = scene.get(id)?.parent ?? null;
      while (p !== null) {
        if (set.has(p)) return false;
        p = scene.get(p)?.parent ?? null;
      }
      return true;
    });
  }

  pivotAndRotation(targets) {
    const active = this.builder.object(this.editor.selection.active) || this.builder.object(targets[targets.length - 1]);
    active.updateWorldMatrix(true, false);
    const quat = active.getWorldQuaternion(new THREE.Quaternion());
    let pivot;
    if (this.editor.pivotMode === 'center') {
      const box = this.boundsOf(targets);
      pivot = box.getCenter(new THREE.Vector3());
    } else {
      pivot = active.getWorldPosition(new THREE.Vector3());
    }
    return { pivot, quat };
  }

  // Pointer handling ------------------------------------------------------------

  toNdc(e) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  pick(ndc) {
    const camera = this.controls.camera;
    this.raycaster.setFromCamera(ndc, camera);
    const icons = this.raycaster.intersectObjects(this.helpers.pickables(), false);
    if (icons.length) return icons[0].object.userData.entityId;
    const hits = this.raycaster.intersectObjects(this.builder.pickables(), false);
    for (const hit of hits) {
      let visible = true;
      hit.object.traverseAncestors((a) => {
        if (!a.visible) visible = false;
      });
      if (visible) return hit.object.userData.entityId;
    }
    return null;
  }

  bindPointer() {
    const canvas = this.canvas;
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag || this.controls.mode) return;
      if (!this.gizmo.root.visible) return;
      if (this.gizmo.setHover(this.gizmo.hit(this.toNdc(e), this.controls.camera))) this.invalidate();
    });
    canvas.addEventListener('pointerleave', () => {
      if (!this.drag && this.gizmo.setHover(null)) this.invalidate();
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.altKey || this.controls.handTool) return;
      canvas.focus({ preventScroll: true });
      const ndc = this.toNdc(e);
      const handle = this.gizmo.root.visible ? this.gizmo.hit(ndc, this.controls.camera) : null;
      if (handle) this.beginGizmoDrag(e, handle, ndc);
      else this.beginSelect(e, ndc);
    });
    canvas.addEventListener('dblclick', (e) => {
      const id = this.pick(this.toNdc(e));
      if (id) this.frame([id]);
    });
  }

  beginGizmoDrag(e, handle, ndc) {
    const targets = this.gizmoTargets();
    if (!targets.length) return;
    const pixel = { x: e.clientX, y: e.clientY };
    if (!this.gizmo.begin(handle, ndc, pixel, this.controls.camera)) return;
    this.canvas.setPointerCapture(e.pointerId);
    const { pivot } = this.pivotAndRotation(targets);
    const starts = targets.map((id) => {
      const object = this.builder.object(id);
      object.updateWorldMatrix(true, false);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      object.matrixWorld.decompose(pos, quat, new THREE.Vector3());
      return { id, object, before: structuredClone(this.editor.scene.get(id).transform), pos, quat };
    });
    this.drag = { kind: 'gizmo', starts, pivot };
    const move = (ev) => {
      const delta = this.gizmo.drag(this.toNdc(ev), { x: ev.clientX, y: ev.clientY }, this.controls.camera, ev.ctrlKey || ev.metaKey);
      if (delta) this.applyDelta(delta);
    };
    const up = () => {
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      this.canvas.removeEventListener('pointercancel', up);
      this.gizmo.end();
      const entries = this.drag.starts.map((s) => ({ id: s.id, before: s.before, after: structuredClone(this.editor.scene.get(s.id)?.transform || s.before) }));
      const label = { move: 'Move', rotate: 'Rotate', scale: 'Scale' }[handle.type];
      this.editor.record(setTransformsCommand(this.editor.scene, entries, label));
      this.drag = null;
      this.invalidate();
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  applyDelta(delta) {
    const { starts, pivot } = this.drag;
    for (const s of starts) {
      const entity = this.editor.scene.get(s.id);
      if (!entity) continue;
      let next;
      if (delta.type === 'move') {
        next = localFromWorld(s.object, s.pos.clone().add(delta.delta), s.quat, s.before.scale);
      } else if (delta.type === 'rotate') {
        const q = new THREE.Quaternion().setFromAxisAngle(delta.axis, delta.angle);
        const pos = s.pos.clone().sub(pivot).applyQuaternion(q).add(pivot);
        next = localFromWorld(s.object, pos, q.clone().multiply(s.quat), s.before.scale);
      } else {
        const scale = s.before.scale.slice();
        const f = Math.max(-1e4, Math.min(1e4, delta.factor));
        if (delta.axisIndex < 0) for (let i = 0; i < 3; i++) scale[i] *= f;
        else scale[delta.axisIndex] *= f;
        let pos = s.pos;
        if (starts.length > 1 && delta.axisIndex < 0) pos = s.pos.clone().sub(pivot).multiplyScalar(f).add(pivot);
        next = localFromWorld(s.object, pos, s.quat, scale);
      }
      this.editor.scene.setField(s.id, ['transform'], next);
    }
  }

  beginSelect(e, ndc) {
    const startX = e.clientX;
    const startY = e.clientY;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const rect = this.viewport.getBoundingClientRect();
    let marquee = false;
    this.canvas.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!marquee && Math.hypot(dx, dy) > 4) marquee = true;
      if (!marquee) return;
      this.marquee.hidden = false;
      Object.assign(this.marquee.style, {
        left: `${Math.min(startX, ev.clientX) - rect.left}px`,
        top: `${Math.min(startY, ev.clientY) - rect.top}px`,
        width: `${Math.abs(dx)}px`,
        height: `${Math.abs(dy)}px`,
      });
    };
    const up = (ev) => {
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      this.marquee.hidden = true;
      const { selection } = this.editor;
      if (marquee) {
        const ids = this.entitiesInRect(startX, startY, ev.clientX, ev.clientY);
        selection.set(additive ? [...selection.ids, ...ids] : ids);
        return;
      }
      const id = this.pick(ndc);
      if (id === null) {
        if (!additive) selection.clear();
      } else if (additive) {
        selection.toggle(id);
      } else {
        selection.select(id);
      }
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
  }

  entitiesInRect(x0, y0, x1, y1) {
    const r = this.canvas.getBoundingClientRect();
    const minX = Math.min(x0, x1) - r.left;
    const maxX = Math.max(x0, x1) - r.left;
    const minY = Math.min(y0, y1) - r.top;
    const maxY = Math.max(y0, y1) - r.top;
    const out = [];
    const camera = this.controls.camera;
    for (const [id, node] of this.builder.nodes) {
      if (!node.parts.mesh && !node.parts.light && !node.parts.camera) continue;
      const p = node.group.getWorldPosition(new THREE.Vector3()).project(camera);
      if (p.z > 1) continue;
      const sx = ((p.x + 1) / 2) * r.width;
      const sy = ((1 - p.y) / 2) * r.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) out.push(id);
    }
    return out;
  }

  bindDrop() {
    this.viewport.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-vox-asset')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    this.viewport.addEventListener('drop', (e) => {
      const raw = e.dataTransfer.getData('application/x-vox-asset');
      if (!raw) return;
      e.preventDefault();
      const ndc = this.toNdc(e);
      this.raycaster.setFromCamera(ndc, this.controls.camera);
      const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const point = this.raycaster.ray.intersectPlane(ground, new THREE.Vector3()) || this.controls.pivot.clone();
      this.editor.emit('drop-asset', { asset: JSON.parse(raw), position: point.toArray().map(round5) });
    });
  }

  // Rendering -----------------------------------------------------------------

  resize() {
    const w = Math.max(1, this.viewport.clientWidth);
    const hgt = Math.max(1, this.viewport.clientHeight);
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== hgt) {
      this.renderer.setSize(w, hgt, false);
      this.controls.setAspect(w / hgt);
    }
    return { w, h: hgt };
  }

  tick(dt) {
    if (this.controls.tick(dt)) this.invalidate();
  }

  selectedMeshes() {
    const meshes = [];
    for (const id of this.editor.selection.ids) {
      this.builder.object(id)?.traverse((child) => {
        if (child.isMesh && child.userData.pickable && child.visible) meshes.push(child);
      });
    }
    return meshes;
  }

  render() {
    if (!this.renderer || !this.visible) return;
    this.needsRender = false;
    const { h: height } = this.resize();
    const renderer = this.renderer;
    const camera = this.controls.camera;
    const scene = this.builder.scene;

    // Lighting toggle: swap scene lights for a camera headlight.
    const toggled = [];
    if (!this.prefs.lighting) {
      for (const node of this.builder.nodes.values()) {
        if (node.parts.light?.visible) {
          node.parts.light.visible = false;
          toggled.push(node.parts.light);
        }
      }
      this.headlight.position.copy(camera.position);
      this.headlight.target.position.copy(this.controls.pivot);
      scene.add(this.headlight, this.headlight.target, this.headAmbient);
    }

    renderer.autoClear = true;
    if (this.prefs.shading === 'wireframe') {
      scene.overrideMaterial = this.wireMaterial;
      renderer.render(scene, camera);
      scene.overrideMaterial = null;
    } else {
      renderer.render(scene, camera);
      if (this.prefs.shading === 'shaded-wireframe') {
        renderer.autoClear = false;
        const bg = scene.background;
        scene.background = null;
        scene.overrideMaterial = this.wireOverlay;
        renderer.render(scene, camera);
        scene.overrideMaterial = null;
        scene.background = bg;
      }
    }

    for (const light of toggled) light.visible = true;
    if (!this.prefs.lighting) scene.remove(this.headlight, this.headlight.target, this.headAmbient);

    renderer.autoClear = false;
    if (this.prefs.grid) {
      this.grid.update(camera, this.controls.distance);
      renderer.render(this.gridScene, camera);
    }
    if (this.prefs.outline) this.outline.render(renderer, camera, this.selectedMeshes());
    this.helpers.update(height, this.gameAspect || 16 / 9);
    renderer.render(this.helpers.scene, camera);

    // Gizmo or rect tool on top.
    const targets = this.gizmoTargets();
    const tool = this.editor.tool;
    const showGizmo = targets.length > 0 && ['move', 'rotate', 'scale', 'transform'].includes(tool);
    this.gizmo.root.visible = showGizmo;
    if (showGizmo) {
      this.gizmo.space = this.editor.space;
      if (this.gizmo.mode !== tool) this.gizmo.setMode(tool);
      const { pivot, quat } = this.drag?.kind === 'gizmo' ? { pivot: this.drag.pivot, quat: this.gizmo.root.quaternion } : this.pivotAndRotation(targets);
      this.gizmo.update(camera, height, pivot, quat);
      renderer.clearDepth();
      renderer.render(this.gizmo.scene, camera);
    }
    this.rectTool.update(tool === 'rect' && targets.length > 0 ? targets : null);
    renderer.autoClear = true;
    this.orientation.update(camera.quaternion, this.controls.ortho, this.controls.is2D);
  }
}
