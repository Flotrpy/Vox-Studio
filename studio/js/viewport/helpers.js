// Editor-only scene helpers: billboard icons for lights and cameras and a
// wire frustum for cameras. They live in their own scene so the game view
// never draws them.

import * as THREE from 'three';
import { iconDataUrl } from '../ui/icons.js';

const textureCache = new Map();

function iconTexture(name, color) {
  const key = `${name}:${color}`;
  if (textureCache.has(key)) return textureCache.get(key);
  const image = new Image();
  const texture = new THREE.Texture(image);
  image.onload = () => {
    texture.needsUpdate = true;
  };
  image.src = iconDataUrl(name, color, 64);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, texture);
  return texture;
}

const ICON_PIXELS = 30;

export class EditorHelpers {
  constructor(builder) {
    this.builder = builder;
    this.scene = new THREE.Scene();
    this.items = new Map();
    this.showIcons = true;
    this.lineMaterial = new THREE.LineBasicMaterial({ color: 0xbfbfbf, transparent: true, opacity: 0.7 });
  }

  /** Rebuild helper objects for entities with Light or Camera components. */
  sync(model) {
    const seen = new Set();
    for (const e of model.entities.values()) {
      const light = e.components.find((c) => c.type === 'Light');
      const cam = e.components.find((c) => c.type === 'Camera');
      if (!light && !cam) continue;
      seen.add(e.id);
      const kind = cam ? 'camera' : light.lightType === 'Directional' ? 'sun' : 'light';
      let item = this.items.get(e.id);
      if (!item || item.kind !== kind) {
        if (item) this.removeItem(e.id);
        item = this.createItem(e.id, kind, light);
        this.items.set(e.id, item);
      }
      item.frustum.visible = !!cam;
      if (cam) item.cameraSettings = cam;
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.removeItem(id);
  }

  createItem(id, kind, light) {
    const color = kind === 'camera' ? '#D8D8D8' : light?.color || '#FFE9A8';
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(kind, color), depthTest: false, transparent: true, sizeAttenuation: false }));
    sprite.userData.entityId = id;
    sprite.userData.pickable = true;
    sprite.renderOrder = 10;
    const frustum = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMaterial);
    frustum.userData.entityId = id;
    this.scene.add(sprite, frustum);
    return { kind, sprite, frustum, cameraSettings: null };
  }

  removeItem(id) {
    const item = this.items.get(id);
    if (!item) return;
    item.sprite.removeFromParent();
    item.sprite.material.dispose();
    item.frustum.removeFromParent();
    item.frustum.geometry.dispose();
    this.items.delete(id);
  }

  /** Follow entity world transforms and keep icons a fixed pixel size. */
  update(viewportHeight, gameAspect = 16 / 9) {
    const scale = ICON_PIXELS / Math.max(1, viewportHeight);
    for (const [id, item] of this.items) {
      const obj = this.builder.object(id);
      if (!obj) continue;
      let visible = true;
      obj.traverseAncestors((a) => {
        if (a.visible === false) visible = false;
      });
      visible = visible && obj.visible;
      obj.getWorldPosition(item.sprite.position);
      item.sprite.scale.set(scale, scale, 1);
      item.sprite.visible = visible && this.showIcons;
      if (item.cameraSettings) {
        item.frustum.visible = visible;
        this.updateFrustum(item, obj, gameAspect);
      }
    }
  }

  updateFrustum(item, obj, aspect) {
    const c = item.cameraSettings;
    const near = Math.max(0.01, c.near);
    const far = Math.min(c.far, 12);
    const corners = (d) => {
      const hh = c.orthographic ? c.size : Math.tan((c.fov * Math.PI) / 360) * d;
      const hw = hh * aspect;
      return [[-hw, -hh, -d], [hw, -hh, -d], [hw, hh, -d], [-hw, hh, -d]];
    };
    const n = corners(near);
    const f = corners(far);
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      pts.push(...n[i], ...n[j], ...f[i], ...f[j], ...n[i], ...f[i]);
    }
    item.frustum.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    obj.updateWorldMatrix(true, false);
    item.frustum.matrixAutoUpdate = false;
    // Ignore scale so the frustum shows the true camera shape.
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    obj.matrixWorld.decompose(pos, quat, new THREE.Vector3());
    item.frustum.matrix.compose(pos, quat, new THREE.Vector3(1, 1, 1));
    item.frustum.matrixWorld.copy(item.frustum.matrix);
  }

  pickables() {
    return [...this.items.values()].filter((i) => i.sprite.visible).map((i) => i.sprite);
  }
}
