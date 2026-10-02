// Simple rigid body physics for Play mode and exported builds: gravity,
// drag, axis-aligned boxes and spheres, bounciness and friction, plus
// trigger overlaps. Bodies do not rotate. Self-contained (no imports) so it
// runs in Node tests and in the standalone player.

const MAX_STEP = 1 / 120;
const SLOP = 0.001;

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Box vs box (axis aligned). Normal points from a to b. */
export function boxBox(a, b) {
  const d = sub(b.position, a.position);
  let best = null;
  for (let i = 0; i < 3; i++) {
    const overlap = a.halfExtents[i] + b.halfExtents[i] - Math.abs(d[i]);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      const normal = [0, 0, 0];
      normal[i] = d[i] < 0 ? -1 : 1;
      best = { normal, depth: overlap };
    }
  }
  return best;
}

export function sphereSphere(a, b) {
  const d = sub(b.position, a.position);
  const dist = Math.hypot(d[0], d[1], d[2]);
  const depth = a.radius + b.radius - dist;
  if (depth <= 0) return null;
  const normal = dist > 1e-9 ? d.map((v) => v / dist) : [0, 1, 0];
  return { normal, depth };
}

/** Sphere a vs box b. Normal points from a to b. */
export function sphereBox(a, b) {
  const closest = [0, 1, 2].map((i) =>
    Math.max(b.position[i] - b.halfExtents[i], Math.min(a.position[i], b.position[i] + b.halfExtents[i])),
  );
  const d = sub(closest, a.position);
  const dist = Math.hypot(d[0], d[1], d[2]);
  if (dist > 1e-9) {
    const depth = a.radius - dist;
    if (depth <= 0) return null;
    return { normal: d.map((v) => v / dist), depth };
  }
  // Sphere center inside the box: push out along the shallowest axis.
  let best = null;
  for (let i = 0; i < 3; i++) {
    const rel = a.position[i] - b.position[i];
    const depth = b.halfExtents[i] - Math.abs(rel) + a.radius;
    if (!best || depth < best.depth) {
      const normal = [0, 0, 0];
      normal[i] = rel < 0 ? 1 : -1;
      best = { normal, depth };
    }
  }
  return best;
}

export function collide(a, b) {
  if (a.shape === 'box' && b.shape === 'box') return boxBox(a, b);
  if (a.shape === 'sphere' && b.shape === 'sphere') return sphereSphere(a, b);
  if (a.shape === 'sphere') return sphereBox(a, b);
  const hit = sphereBox(b, a);
  return hit && { normal: hit.normal.map((v) => -v), depth: hit.depth };
}

/**
 * Body: {
 *   id, shape: 'box'|'sphere', position: [x,y,z] (collider center, world),
 *   halfExtents: [x,y,z] | radius, velocity: [x,y,z], mass, dynamic,
 *   useGravity, drag, bounciness, friction, isTrigger, hasCollider
 * }
 */
export class PhysicsWorld {
  constructor({ gravity = [0, -9.81, 0] } = {}) {
    this.gravity = gravity.slice();
    this.bodies = [];
    this.contacts = new Set();
    this.events = [];
  }

  add(body) {
    const b = {
      velocity: [0, 0, 0],
      mass: 1,
      dynamic: false,
      useGravity: true,
      drag: 0,
      bounciness: 0,
      friction: 0.4,
      isTrigger: false,
      hasCollider: true,
      ...body,
    };
    b.position = b.position.slice();
    b.velocity = b.velocity.slice();
    b.invMass = b.dynamic && b.mass > 0 ? 1 / b.mass : 0;
    this.bodies.push(b);
    return b;
  }

  remove(id) {
    this.bodies = this.bodies.filter((b) => b.id !== id);
  }

  get(id) {
    return this.bodies.find((b) => b.id === id) || null;
  }

  /** Advance the simulation. Returns events: [{ type, a, b }]. */
  step(dt) {
    this.events = [];
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
    const h = dt / steps;
    const touching = new Set();
    for (let s = 0; s < steps; s++) {
      this.integrate(h);
      this.solve(touching);
    }
    // Enter events fire once per new contact pair.
    for (const key of touching) {
      if (!this.contacts.has(key)) {
        const [a, b, kind] = key.split('|');
        this.events.push({ type: kind === 't' ? 'trigger' : 'collision', a, b });
      }
    }
    this.contacts = touching;
    return this.events;
  }

  integrate(h) {
    for (const b of this.bodies) {
      if (!b.dynamic) continue;
      if (b.useGravity) for (let i = 0; i < 3; i++) b.velocity[i] += this.gravity[i] * h;
      if (b.drag > 0) {
        const k = 1 / (1 + b.drag * h);
        for (let i = 0; i < 3; i++) b.velocity[i] *= k;
      }
      for (let i = 0; i < 3; i++) b.position[i] += b.velocity[i] * h;
    }
  }

  solve(touching) {
    const list = this.bodies.filter((b) => b.hasCollider);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!a.dynamic && !b.dynamic && !a.isTrigger && !b.isTrigger) continue;
        const hit = collide(a, b);
        if (!hit) continue;
        const trigger = a.isTrigger || b.isTrigger;
        touching.add(`${a.id}|${b.id}|${trigger ? 't' : 'c'}`);
        if (trigger) continue;
        this.resolve(a, b, hit);
      }
    }
  }

  resolve(a, b, { normal, depth }) {
    const totalInv = a.invMass + b.invMass;
    if (totalInv === 0) return;
    // Positional correction.
    const correction = Math.max(0, depth - SLOP) / totalInv;
    for (let k = 0; k < 3; k++) {
      a.position[k] -= normal[k] * correction * a.invMass;
      b.position[k] += normal[k] * correction * b.invMass;
    }
    // Velocity response along the normal.
    const rel = sub(b.velocity, a.velocity);
    const vn = dot(rel, normal);
    if (vn >= 0) return;
    const restitution = Math.max(a.bounciness, b.bounciness);
    const bounce = Math.abs(vn) < 0.5 ? 0 : restitution;
    const jn = (-(1 + bounce) * vn) / totalInv;
    for (let k = 0; k < 3; k++) {
      a.velocity[k] -= normal[k] * jn * a.invMass;
      b.velocity[k] += normal[k] * jn * b.invMass;
    }
    // Coulomb friction on the tangential velocity.
    const rel2 = sub(b.velocity, a.velocity);
    const vn2 = dot(rel2, normal);
    const tangent = rel2.map((v, k) => v - normal[k] * vn2);
    const tLen = Math.hypot(tangent[0], tangent[1], tangent[2]);
    if (tLen < 1e-9) return;
    const t = tangent.map((v) => v / tLen);
    const mu = (a.friction + b.friction) / 2;
    const jt = Math.min(tLen / totalInv, mu * jn);
    for (let k = 0; k < 3; k++) {
      a.velocity[k] += t[k] * jt * a.invMass;
      b.velocity[k] -= t[k] * jt * b.invMass;
    }
  }
}
