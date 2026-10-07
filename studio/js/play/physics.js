// Simple rigid body physics for Play mode and exported builds: gravity,
// drag, axis-aligned boxes and spheres, static triangle meshes, bounciness
// and friction, plus trigger overlaps. Bodies do not rotate. Self-contained (no imports) so it
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

// Triangle meshes ------------------------------------------------------------------
//
// A mesh body holds world-space triangles (9 numbers each) and a bounding
// volume hierarchy over them, so a box or sphere only tests the few
// triangles near it. Mesh bodies never move under simulation; meshes do not
// collide with each other.

const LEAF_SIZE = 4;
const FACE_BIAS = 1e-3;

/** Bounding volume hierarchy over `triangles` (Float64Array, 9 per triangle). */
export function buildBVH(triangles) {
  const count = triangles.length / 9;
  const order = new Uint32Array(count);
  const centroids = new Float64Array(count * 3);
  for (let t = 0; t < count; t++) {
    order[t] = t;
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k;
      centroids[t * 3 + k] = (triangles[o] + triangles[o + 3] + triangles[o + 6]) / 3;
    }
  }
  const nodes = [];
  const build = (start, end) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const cmin = [Infinity, Infinity, Infinity];
    const cmax = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = order[i];
      for (let v = 0; v < 3; v++) {
        for (let k = 0; k < 3; k++) {
          const x = triangles[t * 9 + v * 3 + k];
          if (x < min[k]) min[k] = x;
          if (x > max[k]) max[k] = x;
        }
      }
      for (let k = 0; k < 3; k++) {
        const c = centroids[t * 3 + k];
        if (c < cmin[k]) cmin[k] = c;
        if (c > cmax[k]) cmax[k] = c;
      }
    }
    const node = { min, max, start, end, left: null, right: null };
    nodes.push(node);
    if (end - start <= LEAF_SIZE) return node;
    let axis = 0;
    for (let k = 1; k < 3; k++) if (cmax[k] - cmin[k] > cmax[axis] - cmin[axis]) axis = k;
    if (cmax[axis] - cmin[axis] < 1e-12) return node;
    // Median split along the widest centroid axis.
    const sorted = Array.from(order.subarray(start, end)).sort((x, y) => centroids[x * 3 + axis] - centroids[y * 3 + axis]);
    order.set(sorted, start);
    const mid = (start + end) >> 1;
    node.left = build(start, mid);
    node.right = build(mid, end);
    return node;
  };
  const root = count ? build(0, count) : null;
  return { root, order, nodeCount: nodes.length };
}

/** Indices of triangles whose node bounds overlap the box [min, max]. */
export function queryBVH(bvh, min, max, out = []) {
  const stack = bvh.root ? [bvh.root] : [];
  while (stack.length) {
    const node = stack.pop();
    if (
      node.min[0] > max[0] || node.max[0] < min[0] ||
      node.min[1] > max[1] || node.max[1] < min[1] ||
      node.min[2] > max[2] || node.max[2] < min[2]
    ) continue;
    if (node.left) {
      stack.push(node.left, node.right);
    } else {
      for (let i = node.start; i < node.end; i++) out.push(bvh.order[i]);
    }
  }
  return out;
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function triangle(triangles, t) {
  const o = t * 9;
  return [
    [triangles[o], triangles[o + 1], triangles[o + 2]],
    [triangles[o + 3], triangles[o + 4], triangles[o + 5]],
    [triangles[o + 6], triangles[o + 7], triangles[o + 8]],
  ];
}

/** Closest point to p on triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
export function closestPointOnTriangle(p, a, b, c) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a.slice();
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b.slice();
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c.slice();
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [0, 1, 2].map((k) => a[k] + ab[k] * v + ac[k] * w);
}

/** Sphere a vs triangle. Normal points from the sphere to the triangle. */
export function sphereTriangle(a, tri) {
  const [p0, p1, p2] = tri;
  const closest = closestPointOnTriangle(a.position, p0, p1, p2);
  const d = sub(closest, a.position);
  const dist = Math.hypot(d[0], d[1], d[2]);
  const depth = a.radius - dist;
  if (depth <= 0) return null;
  if (dist > 1e-9) return { normal: d.map((v) => v / dist), depth };
  // Center exactly on the surface: push out along the face normal.
  const n = cross(sub(p1, p0), sub(p2, p0));
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-12) return null;
  return { normal: n.map((v) => -v / len), depth };
}

const BOX_AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * Axis-aligned box a vs triangle (separating axis test over the box faces,
 * the triangle face and the nine edge crosses). Normal points from the box
 * to the triangle. The face normal wins near-ties so boxes slide over the
 * shared edges of flat, triangulated floors without catching.
 */
export function boxTriangle(a, tri) {
  const c = a.position;
  const h = a.halfExtents;
  const v = tri.map((p) => sub(p, c));
  const edges = [sub(v[1], v[0]), sub(v[2], v[1]), sub(v[0], v[2])];
  const face = cross(edges[0], edges[1]);
  const axes = [face, ...BOX_AXES];
  for (const e of edges) for (const b of BOX_AXES) axes.push(cross(b, e));
  let best = null;
  for (let i = 0; i < axes.length; i++) {
    const axis = axes[i];
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    if (len < 1e-9) continue;
    const n = axis.map((x) => x / len);
    const r = h[0] * Math.abs(n[0]) + h[1] * Math.abs(n[1]) + h[2] * Math.abs(n[2]);
    const p = v.map((q) => dot(q, n));
    const tMin = Math.min(p[0], p[1], p[2]);
    const tMax = Math.max(p[0], p[1], p[2]);
    if (tMin > r || tMax < -r) return null;
    // Push the box out on whichever side needs less travel: back along -n
    // (the triangle is ahead, along +n) or forward along +n.
    const back = r - tMin;
    const forward = tMax + r;
    const depth = Math.min(back, forward);
    const score = i === 0 ? depth - FACE_BIAS : depth;
    if (!best || score < best.score) best = { normal: back <= forward ? n : n.map((x) => -x), depth, score };
  }
  return best && { normal: best.normal, depth: best.depth };
}

/** Contacts between a box or sphere `a` and mesh body `m`, one per touching triangle. */
export function meshContacts(a, m) {
  const reach = a.shape === 'sphere' ? [a.radius, a.radius, a.radius] : a.halfExtents;
  const min = [0, 1, 2].map((k) => a.position[k] - reach[k]);
  const max = [0, 1, 2].map((k) => a.position[k] + reach[k]);
  const contacts = [];
  for (const t of queryBVH(m.bvh, min, max)) {
    const tri = triangle(m.triangles, t);
    const hit = a.shape === 'sphere' ? sphereTriangle(a, tri) : boxTriangle(a, tri);
    if (hit) contacts.push({ ...hit, triangle: t });
  }
  return contacts;
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
 *   id, shape: 'box'|'sphere'|'mesh', position: [x,y,z] (collider center, world),
 *   halfExtents: [x,y,z] | radius | triangles (world, 9 per triangle; mesh
 *   bodies are never dynamic), velocity: [x,y,z], mass, dynamic,
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
    if (b.shape === 'mesh') {
      b.dynamic = false;
      this.setTriangles(b, b.triangles || []);
    }
    b.invMass = b.dynamic && b.mass > 0 ? 1 / b.mass : 0;
    this.bodies.push(b);
    return b;
  }

  /** Replace a mesh body's world-space triangles and rebuild its BVH. */
  setTriangles(body, triangles) {
    body.triangles = Float64Array.from(triangles);
    body.bvh = buildBVH(body.triangles);
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
        if (a.shape === 'mesh' || b.shape === 'mesh') {
          this.solveMesh(a.shape === 'mesh' ? b : a, a.shape === 'mesh' ? a : b, touching);
          continue;
        }
        const hit = collide(a, b);
        if (!hit) continue;
        const trigger = a.isTrigger || b.isTrigger;
        touching.add(`${a.id}|${b.id}|${trigger ? 't' : 'c'}`);
        if (trigger) continue;
        this.resolve(a, b, hit);
      }
    }
  }

  /** Body `a` (box or sphere) against mesh body `m`, one triangle at a time. */
  solveMesh(a, m, touching) {
    if (a.shape === 'mesh') return;
    const contacts = meshContacts(a, m);
    if (!contacts.length) return;
    const trigger = a.isTrigger || m.isTrigger;
    touching.add(`${a.id}|${m.id}|${trigger ? 't' : 'c'}`);
    if (trigger) return;
    // Deepest first; re-test each triangle after earlier pushes moved the body.
    contacts.sort((x, y) => y.depth - x.depth);
    for (const { triangle: t } of contacts) {
      const tri = triangle(m.triangles, t);
      const hit = a.shape === 'sphere' ? sphereTriangle(a, tri) : boxTriangle(a, tri);
      if (hit) this.resolve(a, m, hit);
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
