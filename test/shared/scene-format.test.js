import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSceneData,
  createComponent,
  serializeScene,
  parseScene,
  normalizeScene,
  validateScene,
  serializeMesh,
  parseMeshFile,
  SceneFormatError,
  COMPONENT_TYPES,
} from '../../shared/scene-format.js';

function entity(id, extra = {}) {
  return { id, name: id, parent: null, components: [], ...extra };
}

test('a full scene survives serialize -> parse unchanged', () => {
  const scene = createSceneData('Level 1');
  scene.entities.push(
    entity('root', { transform: { position: [1, 2, 3], rotation: [10, 20, 30], scale: [2, 2, 2] } }),
    entity('child', { parent: 'root', active: false, static: true, tag: 'Player', layer: 'Water' }),
  );
  for (const type of COMPONENT_TYPES) scene.entities[0].components.push(createComponent(type));
  scene.entities[1].components.push(createComponent('Script', { name: 'Spin', code: 'function update(dt) {}' }));
  scene.assets.m1 = { type: 'mesh', name: 'Tri', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [], uvs: [], indices: [0, 1, 2] };
  scene.entities[1].components.push(createComponent('MeshFilter', { mesh: 'asset:m1' }));

  const text = serializeScene(scene);
  const parsed = parseScene(text);
  assert.deepEqual(parsed, normalizeScene(scene));
  assert.equal(serializeScene(parsed), text, 'serialization is stable');
});

test('missing optional fields get defaults', () => {
  const parsed = normalizeScene({
    format: 'voxscene',
    version: 1,
    entities: [{ id: 'a', components: [{ type: 'Rigidbody', mass: 3 }] }],
  });
  const e = parsed.entities[0];
  assert.equal(e.name, 'GameObject');
  assert.deepEqual(e.transform.scale, [1, 1, 1]);
  assert.equal(e.components[0].mass, 3);
  assert.equal(e.components[0].useGravity, true);
  assert.equal(parsed.settings.gravity[1], -9.81);
});

test('unknown fields are dropped', () => {
  const parsed = normalizeScene({
    format: 'voxscene',
    version: 1,
    extra: 'x',
    entities: [{ id: 'a', onLoad: 'alert(1)', components: [{ type: 'Light', exec: 'x' }] }],
  });
  assert.equal('extra' in parsed, false);
  assert.equal('onLoad' in parsed.entities[0], false);
  assert.equal('exec' in parsed.entities[0].components[0], false);
});

test('invalid documents are rejected with a path', () => {
  const cases = [
    [{ format: 'other', version: 1, entities: [] }, /format/],
    [{ format: 'voxscene', version: 99, entities: [] }, /version/],
    [{ format: 'voxscene', version: 1, entities: [entity('a'), entity('a')] }, /duplicate id/],
    [{ format: 'voxscene', version: 1, entities: [entity('a', { parent: 'zzz' })] }, /does not exist/],
    [{ format: 'voxscene', version: 1, entities: [entity('a', { parent: 'b' }), entity('b', { parent: 'a' })] }, /cycle/],
    [{ format: 'voxscene', version: 1, entities: [entity('bad id!')] }, /invalid id/],
    [{ format: 'voxscene', version: 1, entities: [entity('a', { transform: { position: [0, NaN, 0] } })] }, /finite/],
    [{ format: 'voxscene', version: 1, entities: [entity('a', { components: [{ type: 'Nope' }] })] }, /unknown component/],
    [{ format: 'voxscene', version: 1, entities: [entity('a', { components: [{ type: 'Light' }, { type: 'Light' }] })] }, /only one Light/],
    [{ format: 'voxscene', version: 1, entities: [entity('a', { components: [{ type: 'MeshRenderer', color: 'red' }] })] }, /color/],
    [{ format: 'voxscene', version: 1, entities: [entity('a', { components: [{ type: 'MeshFilter', mesh: 'asset:missing' }] })] }, /unknown mesh/],
  ];
  for (const [doc, pattern] of cases) {
    assert.throws(() => normalizeScene(doc), (err) => err instanceof SceneFormatError && pattern.test(err.message), pattern.toString());
  }
});

test('validateScene reports errors without throwing', () => {
  assert.equal(validateScene({}).ok, false);
  assert.equal(validateScene(createSceneData()).ok, true);
});

test('parseScene rejects non-JSON text', () => {
  assert.throws(() => parseScene('not json'), SceneFormatError);
});

test('mesh files round-trip and indices are bounds-checked', () => {
  const mesh = { name: 'Tri', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
  assert.deepEqual(parseMeshFile(serializeMesh(mesh)).indices, [0, 1, 2]);
  assert.throws(() => serializeMesh({ ...mesh, indices: [0, 1, 3] }), /out of range/);
  assert.throws(() => serializeMesh({ ...mesh, normals: [0, 1] }), /normals/);
});
