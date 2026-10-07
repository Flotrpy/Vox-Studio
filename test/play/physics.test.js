import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsWorld, boxBox, sphereBox, sphereSphere, buildBVH, queryBVH } from '../../studio/js/play/physics.js';

test('a falling box comes to rest on a static floor', () => {
  const world = new PhysicsWorld();
  world.add({ id: 'floor', shape: 'box', position: [0, -0.5, 0], halfExtents: [5, 0.5, 5] });
  const box = world.add({ id: 'box', shape: 'box', position: [0, 3, 0], halfExtents: [0.5, 0.5, 0.5], dynamic: true });
  for (let i = 0; i < 240; i++) world.step(1 / 60);
  assert.ok(Math.abs(box.position[1] - 0.5) < 0.02, `rests at ${box.position[1]}`);
  assert.ok(Math.abs(box.velocity[1]) < 0.05);
});

test('gravity can be disabled per body', () => {
  const world = new PhysicsWorld();
  const b = world.add({ id: 'b', shape: 'sphere', position: [0, 1, 0], radius: 0.5, dynamic: true, useGravity: false });
  world.step(1);
  assert.deepEqual(b.position, [0, 1, 0]);
});

test('bouncy spheres bounce', () => {
  const world = new PhysicsWorld();
  world.add({ id: 'floor', shape: 'box', position: [0, -0.5, 0], halfExtents: [5, 0.5, 5] });
  const ball = world.add({ id: 'ball', shape: 'sphere', position: [0, 2, 0], radius: 0.5, dynamic: true, bounciness: 0.9 });
  let maxUp = 0;
  for (let i = 0; i < 120; i++) {
    world.step(1 / 60);
    maxUp = Math.max(maxUp, ball.velocity[1]);
  }
  assert.ok(maxUp > 2, `bounced with ${maxUp}`);
});

test('collision and trigger enter events fire once', () => {
  const world = new PhysicsWorld();
  world.add({ id: 'floor', shape: 'box', position: [0, -0.5, 0], halfExtents: [5, 0.5, 5] });
  world.add({ id: 'zone', shape: 'box', position: [0, 1, 0], halfExtents: [1, 0.2, 1], isTrigger: true });
  world.add({ id: 'box', shape: 'box', position: [0, 2, 0], halfExtents: [0.5, 0.5, 0.5], dynamic: true });
  const events = [];
  for (let i = 0; i < 120; i++) events.push(...world.step(1 / 60));
  assert.equal(events.filter((e) => e.type === 'collision').length, 1);
  assert.equal(events.filter((e) => e.type === 'trigger').length, 1);
});

test('narrow phase helpers report penetration normals', () => {
  const a = { position: [0, 0, 0], halfExtents: [1, 1, 1] };
  const b = { position: [1.5, 0, 0], halfExtents: [1, 1, 1] };
  assert.deepEqual(boxBox(a, b), { normal: [1, 0, 0], depth: 0.5 });
  assert.equal(boxBox(a, { position: [3, 0, 0], halfExtents: [1, 1, 1] }), null);
  const s = sphereSphere({ position: [0, 0, 0], radius: 1 }, { position: [0, 1.5, 0], radius: 1 });
  assert.deepEqual(s.normal, [0, 1, 0]);
  const sb = sphereBox({ position: [0, 1.4, 0], radius: 0.5 }, { position: [0, 0, 0], halfExtents: [1, 1, 1] });
  assert.ok(Math.abs(sb.depth - 0.1) < 1e-9);
  assert.deepEqual(sb.normal, [0, -1, 0]);
});

// Two triangles making a 10x10 floor at y = 0, like the Plane primitive.
function floorTriangles(y = 0, s = 5) {
  return [-s, y, s, s, y, s, s, y, -s, -s, y, s, s, y, -s, -s, y, -s];
}

test('the BVH returns only triangles near the query box', () => {
  const tris = [];
  for (let i = 0; i < 100; i++) tris.push(i, 0, 0, i + 1, 0, 0, i, 0, 1);
  const bvh = buildBVH(Float64Array.from(tris));
  const hits = queryBVH(bvh, [10.2, -1, 0], [10.4, 1, 1]).sort((a, b) => a - b);
  assert.ok(hits.includes(10));
  assert.ok(hits.length <= 8, `visited ${hits.length} triangles`);
  assert.deepEqual(queryBVH(bvh, [500, 0, 0], [501, 1, 1]), []);
});

test('a falling box comes to rest on a mesh floor', () => {
  const world = new PhysicsWorld();
  world.add({ id: 'floor', shape: 'mesh', position: [0, 0, 0], triangles: floorTriangles() });
  const box = world.add({ id: 'box', shape: 'box', position: [0.3, 3, -0.2], halfExtents: [0.5, 0.5, 0.5], dynamic: true });
  const events = [];
  for (let i = 0; i < 240; i++) events.push(...world.step(1 / 60));
  assert.ok(Math.abs(box.position[1] - 0.5) < 0.02, `rests at ${box.position[1]}`);
  assert.ok(Math.abs(box.velocity[1]) < 0.05);
  assert.deepEqual(events, [{ type: 'collision', a: 'box', b: 'floor' }]);
});

test('a box slides across the shared edge of a triangulated floor', () => {
  const world = new PhysicsWorld();
  world.add({ id: 'floor', shape: 'mesh', position: [0, 0, 0], triangles: floorTriangles(), friction: 0 });
  const box = world.add({ id: 'box', shape: 'box', position: [-3, 0.5, -3], halfExtents: [0.5, 0.5, 0.5], dynamic: true, friction: 0, velocity: [3, 0, 3] });
  for (let i = 0; i < 90; i++) world.step(1 / 60);
  assert.ok(box.position[0] > 1 && box.position[2] > 1, `stopped at ${box.position}`);
  assert.ok(Math.abs(box.position[1] - 0.5) < 0.02, `height ${box.position[1]}`);
});

test('a sphere slides down a mesh ramp', () => {
  const world = new PhysicsWorld();
  // Ramp falling toward +x: y = -0.5 x.
  world.add({ id: 'ramp', shape: 'mesh', position: [0, 0, 0], friction: 0, triangles: [-5, 2.5, 5, 5, -2.5, 5, 5, -2.5, -5, -5, 2.5, 5, 5, -2.5, -5, -5, 2.5, -5] });
  const ball = world.add({ id: 'ball', shape: 'sphere', position: [-3, 2.5, 0], radius: 0.5, dynamic: true, friction: 0 });
  for (let i = 0; i < 60; i++) world.step(1 / 60);
  assert.ok(ball.position[0] > -1.5, `slid to x=${ball.position[0]}`);
  const surface = -0.5 * ball.position[0];
  // Center sits about radius above the slope (measured along the normal).
  const gap = (ball.position[1] - surface) * Math.cos(Math.atan(0.5));
  assert.ok(Math.abs(gap - 0.5) < 0.05, `gap ${gap}`);
});

test('a sphere falls into a mesh bowl and stays inside', () => {
  // Square pit: floor at y = 0 and four walls, all as triangles.
  const quad = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
  const tris = [
    ...quad([-2, 0, -2], [2, 0, -2], [2, 0, 2], [-2, 0, 2]),
    ...quad([-2, 0, -2], [-2, 3, -2], [-2, 3, 2], [-2, 0, 2]),
    ...quad([2, 0, -2], [2, 3, -2], [2, 3, 2], [2, 0, 2]),
    ...quad([-2, 0, -2], [2, 0, -2], [2, 3, -2], [-2, 3, -2]),
    ...quad([-2, 0, 2], [2, 0, 2], [2, 3, 2], [-2, 3, 2]),
  ];
  const world = new PhysicsWorld();
  world.add({ id: 'pit', shape: 'mesh', position: [0, 0, 0], triangles: tris });
  const ball = world.add({ id: 'ball', shape: 'sphere', position: [0, 2, 0], radius: 0.4, dynamic: true, velocity: [6, 0, 4], bounciness: 0.5 });
  for (let i = 0; i < 300; i++) world.step(1 / 60);
  for (const k of [0, 2]) assert.ok(Math.abs(ball.position[k]) <= 1.61, `escaped: ${ball.position}`);
  assert.ok(Math.abs(ball.position[1] - 0.4) < 0.05, `height ${ball.position[1]}`);
});

test('mesh triggers report overlaps without pushing', () => {
  const world = new PhysicsWorld();
  world.add({ id: 'zone', shape: 'mesh', position: [0, 0, 0], triangles: floorTriangles(1), isTrigger: true });
  const box = world.add({ id: 'box', shape: 'box', position: [0, 2, 0], halfExtents: [0.5, 0.5, 0.5], dynamic: true });
  const events = [];
  for (let i = 0; i < 60; i++) events.push(...world.step(1 / 60));
  assert.ok(box.position[1] < 0.5);
  assert.deepEqual(events, [{ type: 'trigger', a: 'box', b: 'zone' }]);
});

test('mesh bodies never become dynamic', () => {
  const world = new PhysicsWorld();
  const m = world.add({ id: 'm', shape: 'mesh', position: [0, 0, 0], triangles: floorTriangles(), dynamic: true });
  world.step(1);
  assert.equal(m.dynamic, false);
  assert.equal(m.invMass, 0);
});
