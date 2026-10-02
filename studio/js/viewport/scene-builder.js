// Builds and updates a three.js scene from Vox scene entities. Used by the
// editor viewports and by the exported standalone player, so it must only
// import 'three'.

import * as THREE from 'three';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
/** Euler order for entity rotations (yaw, then pitch, then roll). */
export const EULER_ORDER = 'YXZ';

const primitiveCache = new Map();

/** Shared geometry for a built-in primitive mesh. */
export function primitiveGeometry(name) {
  if (primitiveCache.has(name)) return primitiveCache.get(name);
  let geometry = null;
  switch (name) {
    case 'Cube':
      geometry = new THREE.BoxGeometry(1, 1, 1);
      break;
    case 'Sphere':
      geometry = new THREE.SphereGeometry(0.5, 32, 16);
      break;
    case 'Plane':
      geometry = new THREE.PlaneGeometry(10, 10, 1, 1);
      geometry.rotateX(-Math.PI / 2);
      break;
    case 'Cylinder':
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 2, 32, 1);
      break;
    default:
      return null;
  }
  geometry.userData.shared = true;
  primitiveCache.set(name, geometry);
  return geometry;
}

/** BufferGeometry from Vox mesh data. */
export function geometryFromMesh(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  if (mesh.uvs?.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mesh.uvs, 2));
  if (mesh.indices?.length) {
    const max = mesh.positions.length / 3;
    geometry.setIndex(max > 65535 ? new THREE.Uint32BufferAttribute(mesh.indices, 1) : new THREE.Uint16BufferAttribute(mesh.indices, 1));
  }
  if (mesh.normals?.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
  else geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.shared = true;
  return geometry;
}

/** Apply an entity transform to an Object3D. */
export function applyTransform(object, transform) {
  const [px, py, pz] = transform.position;
  const [rx, ry, rz] = transform.rotation;
  const [sx, sy, sz] = transform.scale;
  object.position.set(px, py, pz);
  object.rotation.set(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD, EULER_ORDER);
  // Zero scale makes matrices singular; keep a tiny value instead.
  const safe = (v) => (Math.abs(v) < 1e-6 ? 1e-6 : v);
  object.scale.set(safe(sx), safe(sy), safe(sz));
}

/** Read an Object3D's local pose back into entity transform arrays. */
export function readTransform(object) {
  const e = new THREE.Euler().setFromQuaternion(object.quaternion, EULER_ORDER);
  const round = (v) => Number(v.toFixed(5)) + 0;
  return {
    position: object.position.toArray().map(round),
    rotation: [e.x, e.y, e.z].map((r) => round(r * RAD2DEG)),
    scale: object.scale.toArray().map(round),
  };
}

function component(entity, type) {
  return entity.components.find((c) => c.type === type) || null;
}

function disposePart(object) {
  object.traverse((child) => {
    if (child.geometry && !child.geometry.userData.shared) child.geometry.dispose();
    if (child.material) {
      for (const m of Array.isArray(child.material) ? child.material : [child.material]) m.dispose();
    }
    if (child.shadow?.map) child.shadow.map.dispose();
  });
}

/**
 * Keeps a THREE.Scene in sync with Vox entities. `source` is any object with
 * { entities: Map, roots: [], settings, assets } (the editor SceneModel or
 * the player's runtime scene).
 */
export class SceneBuilder {
  constructor({ shadows = true } = {}) {
    this.shadows = shadows;
    this.scene = new THREE.Scene();
    this.ambient = new THREE.AmbientLight(0xffffff, 1);
    this.ambient.name = '__ambient';
    this.scene.add(this.ambient);
    this.nodes = new Map();
    this.assetGeometry = new Map();
    this.source = null;
    this.version = 0;
  }

  build(source) {
    this.clear();
    this.source = source;
    this.applySettings();
    const visit = (ids) => {
      for (const id of ids) {
        const e = source.entities.get(id);
        if (!e) continue;
        this.addEntity(e);
        visit(e.children);
      }
    };
    visit(source.roots);
    this.version++;
  }

  clear() {
    for (const node of this.nodes.values()) {
      for (const part of Object.values(node.parts)) if (part) disposePart(part);
      node.group.removeFromParent();
    }
    this.nodes.clear();
    for (const g of this.assetGeometry.values()) g.dispose();
    this.assetGeometry.clear();
  }

  applySettings() {
    const s = this.source.settings;
    this.scene.background = new THREE.Color(s.background);
    this.ambient.color.set(s.ambientColor);
    this.ambient.intensity = s.ambientIntensity;
    this.version++;
  }

  object(id) {
    return this.nodes.get(id)?.group || null;
  }

  parentObject(entity) {
    if (entity.parent === null) return this.scene;
    return this.nodes.get(entity.parent)?.group || this.scene;
  }

  addEntity(entity) {
    const group = new THREE.Group();
    group.name = entity.name;
    group.userData.entityId = entity.id;
    const node = { group, parts: { mesh: null, light: null, camera: null } };
    this.nodes.set(entity.id, node);
    this.parentObject(entity).add(group);
    this.updateEntity(entity);
    return group;
  }

  removeEntity(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    const childIds = [];
    node.group.traverse((child) => {
      const childId = child.userData.entityId;
      if (childId && childId !== id && this.nodes.get(childId)?.group === child) childIds.push(childId);
    });
    for (const childId of childIds) this.removeEntity(childId);
    for (const part of Object.values(node.parts)) if (part) disposePart(part);
    node.group.removeFromParent();
    this.nodes.delete(id);
    this.version++;
  }

  reparent(entity) {
    const node = this.nodes.get(entity.id);
    if (!node) return;
    this.parentObject(entity).add(node.group);
    this.version++;
  }

  updateTransform(entity) {
    const node = this.nodes.get(entity.id);
    if (!node) return;
    applyTransform(node.group, entity.transform);
    this.version++;
  }

  /** Re-apply everything about one entity (transform, active, components). */
  updateEntity(entity) {
    const node = this.nodes.get(entity.id);
    if (!node) return;
    node.group.name = entity.name;
    node.group.visible = entity.active;
    applyTransform(node.group, entity.transform);
    this.updateMesh(entity, node);
    this.updateLight(entity, node);
    this.updateCamera(entity, node);
    this.version++;
  }

  geometryFor(meshName) {
    if (!meshName) return null;
    if (meshName.startsWith('asset:')) {
      const assetId = meshName.slice(6);
      if (this.assetGeometry.has(assetId)) return this.assetGeometry.get(assetId);
      const asset = this.source?.assets?.[assetId];
      if (!asset) return null;
      const geometry = geometryFromMesh(asset);
      this.assetGeometry.set(assetId, geometry);
      return geometry;
    }
    return primitiveGeometry(meshName);
  }

  updateMesh(entity, node) {
    const filter = component(entity, 'MeshFilter');
    const renderer = component(entity, 'MeshRenderer');
    const geometry = filter && filter.enabled !== false ? this.geometryFor(filter.mesh) : null;
    if (!geometry || !renderer) {
      if (node.parts.mesh) {
        disposePart(node.parts.mesh);
        node.parts.mesh.removeFromParent();
        node.parts.mesh = null;
      }
      return;
    }
    let mesh = node.parts.mesh;
    if (!mesh) {
      mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
      mesh.userData.entityId = entity.id;
      mesh.userData.pickable = true;
      node.group.add(mesh);
      node.parts.mesh = mesh;
    }
    mesh.geometry = geometry;
    const m = mesh.material;
    m.color.set(renderer.color);
    m.metalness = renderer.metalness;
    m.roughness = renderer.roughness;
    m.side = filter.mesh === 'Plane' ? THREE.DoubleSide : THREE.FrontSide;
    mesh.visible = renderer.enabled !== false;
    mesh.castShadow = this.shadows && renderer.castShadows;
    mesh.receiveShadow = this.shadows && renderer.receiveShadows;
  }

  updateLight(entity, node) {
    const data = component(entity, 'Light');
    const existing = node.parts.light;
    if (!data) {
      if (existing) {
        disposePart(existing);
        existing.removeFromParent();
        node.parts.light = null;
      }
      return;
    }
    const kind = { Directional: THREE.DirectionalLight, Point: THREE.PointLight, Spot: THREE.SpotLight }[data.lightType];
    let light = existing;
    if (!light || !(light instanceof kind)) {
      if (existing) {
        disposePart(existing);
        existing.removeFromParent();
      }
      light = new kind();
      light.userData.entityId = entity.id;
      if (light.target) {
        light.target.position.set(0, 0, -1);
        light.add(light.target);
      }
      node.group.add(light);
      node.parts.light = light;
    }
    light.color.set(data.color);
    light.visible = data.enabled !== false;
    if (data.lightType === 'Directional') {
      light.intensity = data.intensity * 1.6;
      light.shadow.camera.left = -20;
      light.shadow.camera.right = 20;
      light.shadow.camera.top = 20;
      light.shadow.camera.bottom = -20;
      light.shadow.camera.far = 200;
      light.shadow.bias = -0.0005;
    } else {
      // Physically based falloff; scale so intensity 1 lights its range.
      light.distance = data.range;
      light.decay = 2;
      light.intensity = data.intensity * Math.max(1, data.range * data.range * 0.6);
      if (data.lightType === 'Spot') {
        light.angle = (data.spotAngle * DEG2RAD) / 2;
        light.penumbra = 0.2;
      }
    }
    light.castShadow = this.shadows && data.castShadows;
    light.shadow.mapSize.set(1024, 1024);
  }

  updateCamera(entity, node) {
    const data = component(entity, 'Camera');
    const existing = node.parts.camera;
    if (!data) {
      if (existing) {
        existing.removeFromParent();
        node.parts.camera = null;
      }
      return;
    }
    const wantOrtho = data.orthographic;
    let camera = existing;
    if (!camera || camera.isOrthographicCamera !== wantOrtho) {
      existing?.removeFromParent();
      camera = wantOrtho ? new THREE.OrthographicCamera(-1, 1, 1, -1) : new THREE.PerspectiveCamera();
      camera.userData.entityId = entity.id;
      node.group.add(camera);
      node.parts.camera = camera;
    }
    camera.userData.settings = data;
    camera.near = data.near;
    camera.far = Math.max(data.far, data.near + 0.01);
    if (wantOrtho) camera.userData.size = data.size;
    else camera.fov = data.fov;
    camera.updateProjectionMatrix();
  }

  /**
   * The camera the game renders through: the first active, enabled Camera,
   * preferring one tagged MainCamera.
   */
  mainCamera() {
    let fallback = null;
    for (const [id, node] of this.nodes) {
      const cam = node.parts.camera;
      if (!cam || cam.userData.settings?.enabled === false) continue;
      let visible = true;
      node.group.traverseAncestors((a) => {
        if (a.visible === false) visible = false;
      });
      if (!visible || !node.group.visible) continue;
      const entity = this.source.entities.get(id);
      if (entity?.tag === 'MainCamera') return { entity, camera: cam };
      if (!fallback) fallback = { entity, camera: cam };
    }
    return fallback;
  }

  /** Configure a camera's projection for a viewport aspect ratio. */
  static fitCamera(camera, aspect) {
    if (camera.isOrthographicCamera) {
      const size = camera.userData.size || 5;
      camera.left = -size * aspect;
      camera.right = size * aspect;
      camera.top = size;
      camera.bottom = -size;
    } else {
      camera.aspect = aspect;
    }
    camera.updateProjectionMatrix();
  }

  /** Meshes that can be clicked in the viewport. */
  pickables() {
    const out = [];
    for (const node of this.nodes.values()) if (node.parts.mesh?.visible) out.push(node.parts.mesh);
    return out;
  }
}
