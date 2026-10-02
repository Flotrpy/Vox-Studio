import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScript, Input, Mathf, ScriptError } from '../../studio/js/play/scripting.js';

function api(extra = {}) {
  return { gameObject: { name: 'Obj' }, transform: {}, rigidbody: null, Time: {}, Input: {}, Debug: {}, Scene: {}, Mathf, ...extra };
}

test('compiled scripts expose only the defined hooks', () => {
  const factory = compileScript('function start() { return 1; }\nfunction update(dt) { return dt * 2; }');
  const hooks = factory(api());
  assert.equal(hooks.start(), 1);
  assert.equal(hooks.update(0.5), 1);
  assert.equal(hooks.onCollisionEnter, null);
  assert.equal(hooks.onTriggerEnter, null);
});

test('each instance keeps its own variables', () => {
  const factory = compileScript('let count = 0;\nfunction update() { count++; return count; }');
  const a = factory(api());
  const b = factory(api());
  a.update();
  a.update();
  assert.equal(a.update(), 3);
  assert.equal(b.update(), 1);
});

test('scripts see the injected API names', () => {
  const logged = [];
  const factory = compileScript('function start() { Debug.log(gameObject.name, Mathf.clamp(5, 0, 1)); }');
  factory(api({ Debug: { log: (...a) => logged.push(a) } })).start();
  assert.deepEqual(logged, [['Obj', 1]]);
});

test('syntax errors become ScriptError', () => {
  assert.throws(() => compileScript('function update( {', 'Broken'), (err) => err instanceof ScriptError && err.scriptName === 'Broken');
});

test('scripts run in strict mode', () => {
  const factory = compileScript('function start() { undeclared = 5; }');
  assert.throws(() => factory(api()).start(), ReferenceError);
});

test('Input tracks keys, edges and axes', () => {
  const input = new Input();
  const listeners = {};
  const target = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  input.attach(target);
  const api = input.api();
  listeners.keydown({ key: 'd', preventDefault() {} });
  assert.equal(api.getKey('D'), true);
  assert.equal(api.getKeyDown('d'), true);
  assert.equal(api.getAxis('Horizontal'), 1);
  input.endFrame();
  assert.equal(api.getKeyDown('d'), false);
  listeners.keydown({ key: ' ', preventDefault() {} });
  assert.equal(api.getKey('space'), true);
  listeners.keyup({ key: 'd' });
  assert.equal(api.getKeyUp('d'), true);
  assert.equal(api.getAxis('Horizontal'), 0);
  assert.equal(api.getAxis('Nope'), 0);
});
