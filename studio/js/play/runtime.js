// Play mode runtime shared by the editor and exported builds: builds physics
// bodies from Rigidbody/Collider components, runs Script components and
// writes simulated transforms back into the scene entities.

import * as THREE from 'three';
import { PhysicsWorld } from 'vox/play/physics.js';
import { compileScript, scriptLocation, Mathf } from 'vox/play/scripting.js';

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();

function component(entity, type) {
  return entity.components.find((c) => c.type === type && c.enabled !== false) || null;
}

function round(v) {
  return Math.round(v * 1e5) / 1e5 + 0;
}

/**
 * options:
 *   source   { entities: Map, roots, settings }  (editor SceneModel or player scene)
 *   builder  SceneBuilder showing `source`
 *   input    Input instance
 *   log      (type, message, detail) => void
 *   notify   (entity, path) => void   called after the runtime changes an entity
 *   onError  (error) => void          optional, for Error Pause
 */
export class PlayRuntime {
  constructor({ source, builder, input, log, notify, onError }) {
    this.source = source;
    this.builder = builder;
    this.input = input;
    this.log = log;
    this.notify = notify;
    this.onError = onError || (() => {});
    this.time = 0;
    this.deltaTime = 0;
    this.frameCount = 0;
    this.apis = new Map();
    this.bodies = new Map();
    this.scripts = [];
    this.compiled = new Map();
    this.running = false;
  }

  activeInHierarchy(entity) {
    let e = entity;
    while (e) {
      if (!e.active) return false;
      e = e.parent === null ? null : this.source.entities.get(e.parent);
    }
    return true;
  }

  // Lifecycle -------------------------------------------------------------------

  start() {
    this.running = true;
    this.world = new PhysicsWorld({ gravity: this.source.settings.gravity });
    this.builder.scene.updateMatrixWorld(true);
    for (const entity of this.source.entities.values()) {
      if (!this.activeInHierarchy(entity)) continue;
      this.createBody(entity);
    }
    for (const entity of this.source.entities.values()) {
      if (!this.activeInHierarchy(entity)) continue;
      entity.components.forEach((c) => {
        if (c.type === 'Script' && c.enabled !== false) this.createScript(entity, c);
      });
    }
    for (const s of this.scripts) this.call(s, 'start');
  }

  stop() {
    this.running = false;
    this.scripts = [];
    this.bodies.clear();
  }

  update(dt) {
    if (!this.running) return;
    this.deltaTime = dt;
    this.time += dt;
    this.frameCount++;
    this.builder.scene.updateMatrixWorld(true);
    for (const s of this.scripts) this.call(s, 'update', dt);
    this.builder.scene.updateMatrixWorld(true);
    this.syncBodiesFromScene();
    const events = this.world.step(dt);
    this.writeBack();
    this.dispatch(events);
    this.input.endFrame();
  }

  // Physics -----------------------------------------------------------------------

  createBody(entity) {
    const box = component(entity, 'BoxCollider');
    const sphere = component(entity, 'SphereCollider');
    const meshCollider = box || sphere ? null : component(entity, 'MeshCollider');
    const rb = component(entity, 'Rigidbody');
    if (!box && !sphere && !meshCollider && !rb) return;
    const object = this.builder.object(entity.id);
    if (!object) return;
    const dynamic = !!rb && !rb.isKinematic;
    const collider = box || sphere || meshCollider;
    const center = new THREE.Vector3(...(box || sphere ? collider.center : [0, 0, 0]));
    object.matrixWorld.decompose(tmpV, tmpQ, tmpS);
    const scale = [Math.abs(tmpS.x), Math.abs(tmpS.y), Math.abs(tmpS.z)];
    let shape = sphere && !box ? 'sphere' : 'box';
    let halfExtents = box ? box.size.map((s, i) => (s * scale[i]) / 2) : [0.5, 0.5, 0.5];
    let triangles = null;
    let hasCollider = !!collider;
    if (meshCollider) {
      triangles = this.meshTriangles(entity, object);
      if (!triangles) {
        this.log('warning', `${entity.name}: Mesh Collider has no mesh`, 'Add a Mesh Filter with a mesh, or use a Box or Sphere Collider.');
        hasCollider = false;
      } else if (dynamic) {
        // Moving triangle meshes are not simulated; use the mesh bounds instead.
        this.log('warning', `${entity.name}: Mesh Collider on a moving Rigidbody collides as a box`, 'Mesh Colliders are exact only on static or kinematic objects.');
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < triangles.length; i++) {
          const k = i % 3;
          min[k] = Math.min(min[k], triangles[i]);
          max[k] = Math.max(max[k], triangles[i]);
        }
        halfExtents = [0, 1, 2].map((k) => (max[k] - min[k]) / 2);
        object.worldToLocal(center.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2));
        triangles = null;
      } else {
        shape = 'mesh';
      }
    }
    const position = object.localToWorld(center.clone()).toArray();
    const body = this.world.add({
      id: entity.id,
      shape,
      position,
      halfExtents,
      radius: sphere ? sphere.radius * Math.max(...scale) : 0.5,
      triangles: triangles || undefined,
      hasCollider,
      isTrigger: !!collider?.isTrigger,
      dynamic,
      mass: rb?.mass ?? 1,
      useGravity: rb?.useGravity ?? false,
      drag: rb?.drag ?? 0,
      bounciness: rb?.bounciness ?? 0,
      friction: rb?.friction ?? 0.4,
    });
    this.bodies.set(entity.id, {
      body,
      center,
      entity,
      written: entity.transform.position.slice(),
      matrix: shape === 'mesh' ? object.matrixWorld.clone() : null,
    });
  }

  /** World-space triangles (9 numbers each) of an entity's Mesh Filter mesh, or null. */
  meshTriangles(entity, object) {
    const filter = component(entity, 'MeshFilter');
    const geometry = filter ? this.builder.geometryFor(filter.mesh) : null;
    const positions = geometry?.getAttribute('position');
    if (!positions) return null;
    const index = geometry.getIndex();
    const total = index ? index.count : positions.count;
    const count = total - (total % 3);
    if (count < 3) return null;
    const out = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
      tmpV.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(object.matrixWorld);
      out[i * 3] = tmpV.x;
      out[i * 3 + 1] = tmpV.y;
      out[i * 3 + 2] = tmpV.z;
    }
    return out;
  }

  /** Static/kinematic bodies follow their transforms; moved dynamic bodies teleport. */
  syncBodiesFromScene() {
    for (const info of this.bodies.values()) {
      const { body, entity, center, written } = info;
      const object = this.builder.object(entity.id);
      if (!object) continue;
      const moved = entity.transform.position.some((v, i) => Math.abs(v - written[i]) > 1e-6);
      if (!body.dynamic || moved) {
        body.position = object.localToWorld(center.clone()).toArray();
        info.written = entity.transform.position.slice();
      }
      // Moved, rotated or rescaled mesh colliders get fresh triangles.
      if (info.matrix && !info.matrix.equals(object.matrixWorld)) {
        info.matrix.copy(object.matrixWorld);
        const triangles = this.meshTriangles(entity, object);
        if (triangles) this.world.setTriangles(body, triangles);
      }
      if (!this.activeInHierarchy(entity)) body.hasCollider = false;
    }
  }

  writeBack() {
    for (const info of this.bodies.values()) {
      const { body, entity, center } = info;
      if (!body.dynamic) continue;
      const object = this.builder.object(entity.id);
      if (!object) continue;
      // World position of the object origin = body center - rotated/scaled center offset.
      const origin = object.getWorldPosition(new THREE.Vector3());
      const offset = object.localToWorld(center.clone()).sub(origin);
      const world = new THREE.Vector3(...body.position).sub(offset);
      const local = object.parent.worldToLocal(world);
      entity.transform.position = [round(local.x), round(local.y), round(local.z)];
      info.written = entity.transform.position.slice();
      this.notify(entity, ['transform']);
    }
  }

  dispatch(events) {
    for (const ev of events) {
      const a = this.source.entities.get(ev.a);
      const b = this.source.entities.get(ev.b);
      if (!a || !b) continue;
      const hook = ev.type === 'trigger' ? 'onTriggerEnter' : 'onCollisionEnter';
      for (const s of this.scripts) {
        if (s.entity === a) this.call(s, hook, this.gameObjectApi(b));
        else if (s.entity === b) this.call(s, hook, this.gameObjectApi(a));
      }
    }
  }

  // Scripts -------------------------------------------------------------------------

  createScript(entity, comp) {
    const name = comp.name || 'Script';
    try {
      let factory = this.compiled.get(comp.code);
      if (!factory) {
        factory = compileScript(comp.code, name);
        this.compiled.set(comp.code, factory);
      }
      const api = this.scriptApi(entity, name);
      const hooks = factory(api);
      this.scripts.push({ entity, name, hooks, api, faulted: false });
    } catch (err) {
      this.reportError(entity, name, err, 'compile');
    }
  }

  call(script, hook, ...args) {
    const fn = script.hooks[hook];
    if (!fn || script.faulted || !this.activeInHierarchy(script.entity)) return;
    try {
      fn.apply(script.api.gameObject, args);
    } catch (err) {
      script.faulted = true;
      this.reportError(script.entity, script.name, err, hook);
    }
  }

  reportError(entity, name, err, phase) {
    const where = scriptLocation(err);
    const message = `${name}: ${err?.message || err}`;
    const detail = [`${entity.name} > ${name}.${phase}`, where && `at ${where}`, 'The script was stopped after this error.'].filter(Boolean).join('\n');
    this.log('error', message, detail);
    this.onError(err);
  }

  scriptApi(entity, scriptName) {
    const runtime = this;
    const logger = (type) => (...args) =>
      runtime.log(type, args.map((a) => (typeof a === 'string' ? a : safeString(a))).join(' '), `${entity.name} > ${scriptName}`);
    return {
      gameObject: this.gameObjectApi(entity),
      transform: this.gameObjectApi(entity).transform,
      rigidbody: this.gameObjectApi(entity).rigidbody,
      Time: Object.freeze({
        get time() { return runtime.time; },
        get deltaTime() { return runtime.deltaTime; },
        get frameCount() { return runtime.frameCount; },
      }),
      Input: this.input.api(),
      Debug: Object.freeze({ log: logger('info'), warn: logger('warning'), error: logger('error') }),
      Scene: Object.freeze({
        find: (name) => {
          for (const e of runtime.source.entities.values()) if (e.name === name) return runtime.gameObjectApi(e);
          return null;
        },
        findWithTag: (tag) => {
          for (const e of runtime.source.entities.values()) if (e.tag === tag) return runtime.gameObjectApi(e);
          return null;
        },
      }),
      Mathf,
    };
  }

  /** Script-facing wrapper of an entity, cached per entity. */
  gameObjectApi(entity) {
    if (this.apis.has(entity.id)) return this.apis.get(entity.id);
    const runtime = this;
    const touch = (path) => runtime.notify(entity, path);
    const vector = (key) => {
      const v = {
        get x() { return entity.transform[key][0]; },
        set x(n) { entity.transform[key][0] = Number(n) || 0; touch(['transform']); },
        get y() { return entity.transform[key][1]; },
        set y(n) { entity.transform[key][1] = Number(n) || 0; touch(['transform']); },
        get z() { return entity.transform[key][2]; },
        set z(n) { entity.transform[key][2] = Number(n) || 0; touch(['transform']); },
        set(x, y, z) {
          entity.transform[key] = [Number(x) || 0, Number(y) || 0, Number(z) || 0];
          touch(['transform']);
        },
        toArray: () => entity.transform[key].slice(),
        toString: () => `(${entity.transform[key].join(', ')})`,
      };
      return Object.freeze(v);
    };
    const transform = Object.freeze({
      position: vector('position'),
      rotation: vector('rotation'),
      scale: vector('scale'),
      translate(x = 0, y = 0, z = 0) {
        const p = entity.transform.position;
        entity.transform.position = [p[0] + x, p[1] + y, p[2] + z];
        touch(['transform']);
      },
      rotate(x = 0, y = 0, z = 0) {
        const r = entity.transform.rotation;
        entity.transform.rotation = [(r[0] + x) % 360, (r[1] + y) % 360, (r[2] + z) % 360];
        touch(['transform']);
      },
      /** World-space forward direction (-Z of the object). */
      get forward() {
        const object = runtime.builder.object(entity.id);
        if (!object) return [0, 0, -1];
        object.updateWorldMatrix(true, false);
        return new THREE.Vector3(0, 0, -1).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion())).toArray();
      },
      get worldPosition() {
        const object = runtime.builder.object(entity.id);
        if (!object) return entity.transform.position.slice();
        object.updateWorldMatrix(true, false);
        return object.getWorldPosition(new THREE.Vector3()).toArray();
      },
    });
    const rigidbody = component(entity, 'Rigidbody')
      ? Object.freeze({
          get velocity() {
            const b = runtime.bodies.get(entity.id)?.body;
            return b ? b.velocity.slice() : [0, 0, 0];
          },
          set velocity(v) {
            const b = runtime.bodies.get(entity.id)?.body;
            if (b && Array.isArray(v)) b.velocity = [0, 1, 2].map((i) => Number(v[i]) || 0);
          },
          addForce(x = 0, y = 0, z = 0, mode = 'force') {
            const b = runtime.bodies.get(entity.id)?.body;
            if (!b || !b.dynamic) return;
            const k = (mode === 'impulse' ? 1 : runtime.deltaTime || 1 / 60) * b.invMass;
            b.velocity[0] += x * k;
            b.velocity[1] += y * k;
            b.velocity[2] += z * k;
          },
          get mass() {
            return runtime.bodies.get(entity.id)?.body.mass ?? 0;
          },
        })
      : null;
    const api = Object.freeze({
      get id() { return entity.id; },
      get name() { return entity.name; },
      set name(v) { entity.name = String(v).slice(0, 128); touch(['name']); },
      get tag() { return entity.tag; },
      get active() { return entity.active; },
      set active(v) { entity.active = !!v; touch(['active']); },
      transform,
      rigidbody,
      /** Live view of a component's fields; assigning a field updates the scene. */
      getComponent(type) {
        const index = entity.components.findIndex((c) => c.type === type);
        if (index < 0) return null;
        return new Proxy(entity.components[index], {
          set(target, key, value) {
            if (key === 'type' || !(key in target)) return false;
            target[key] = value;
            touch(['components', index, key]);
            return true;
          },
        });
      },
      destroy() {
        entity.active = false;
        runtime.bodies.get(entity.id) && (runtime.bodies.get(entity.id).body.hasCollider = false);
        touch(['active']);
      },
      toString: () => entity.name,
    });
    this.apis.set(entity.id, api);
    return api;
  }
}

function safeString(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
