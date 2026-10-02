import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsWorld, boxBox, sphereBox, sphereSphere } from '../../studio/js/play/physics.js';

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
