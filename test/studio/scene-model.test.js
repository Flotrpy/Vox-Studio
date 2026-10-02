import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneModel } from '../../studio/js/core/scene-model.js';
import { History } from '../../studio/js/core/history.js';
import { Selection } from '../../studio/js/core/selection.js';
import {
  setFieldCommand,
  createEntitiesCommand,
  deleteEntitiesCommand,
  moveEntitiesCommand,
  setTransformsCommand,
} from '../../studio/js/core/commands.js';
import { serializeScene, parseScene, createComponent } from '../../shared/scene-format.js';

function setup() {
  const model = new SceneModel();
  const history = new History();
  const selection = new Selection();
  return { model, history, selection };
}

function record(id, name, parent = null) {
  return { id, name, parent, active: true, static: false, tag: 'Untagged', layer: 'Default',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [] };
}

test('entities nest and serialize parents before children', () => {
  const { model } = setup();
  const a = model.createEntity({ name: 'A' });
  const b = model.createEntity({ name: 'B' }, a);
  model.createEntity({ name: 'C' }, b);
  model.createEntity({ name: 'D' });
  const data = model.toData();
  assert.deepEqual(data.entities.map((e) => e.name), ['A', 'B', 'C', 'D']);
  const again = new SceneModel(parseScene(serializeScene(data)));
  assert.deepEqual(again.toData().entities, data.entities);
  assert.equal(again.get(b).children.length, 1);
});

test('uniqueName numbers duplicates among siblings', () => {
  const { model } = setup();
  model.createEntity({ name: 'Cube' });
  assert.equal(model.uniqueName('Cube'), 'Cube (1)');
  model.createEntity({ name: 'Cube (1)' });
  assert.equal(model.uniqueName('Cube'), 'Cube (2)');
  assert.equal(model.uniqueName('Sphere'), 'Sphere');
});

test('move refuses cycles', () => {
  const { model } = setup();
  const a = model.createEntity({ name: 'A' });
  const b = model.createEntity({ name: 'B' }, a);
  assert.equal(model.move(a, b), false);
  assert.equal(model.move(a, a), false);
  assert.equal(model.get(a).parent, null);
});

test('field edits undo, redo and merge', () => {
  const { model, history } = setup();
  const id = model.createEntity({ name: 'Cube' });
  history.execute(setFieldCommand(model, id, ['transform', 'position'], [0, 0, 0], [1, 0, 0]));
  history.execute(setFieldCommand(model, id, ['transform', 'position'], [1, 0, 0], [2, 0, 0]));
  assert.equal(history.undoStack.length, 1, 'merged');
  history.undo();
  assert.deepEqual(model.get(id).transform.position, [0, 0, 0]);
  history.redo();
  assert.deepEqual(model.get(id).transform.position, [2, 0, 0]);
});

test('create and delete restore hierarchy and order on undo', () => {
  const { model, history, selection } = setup();
  const subtree = [record('p1', 'Parent'), record('c1', 'Child', 'p1')];
  history.execute(createEntitiesCommand(model, selection, [subtree]));
  model.createEntity({ id: 'z1', name: 'Last' });
  assert.deepEqual(selection.ids, ['p1']);

  history.execute(deleteEntitiesCommand(model, selection, ['c1', 'p1']));
  assert.equal(model.has('p1'), false);
  assert.equal(model.has('c1'), false);
  assert.deepEqual(selection.ids, []);

  history.undo();
  assert.deepEqual(model.roots, ['p1', 'z1']);
  assert.deepEqual(model.get('p1').children, ['c1']);
  assert.deepEqual(selection.ids, ['p1']);

  history.undo();
  assert.deepEqual(model.roots, ['z1']);
});

test('reparent undo restores parent, index and transform', () => {
  const { model, history } = setup();
  model.createEntity({ id: 'a', name: 'A' });
  model.createEntity({ id: 'b', name: 'B' });
  model.createEntity({ id: 'c', name: 'C' });
  const moved = { position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  history.execute(moveEntitiesCommand(model, [{ id: 'a', parent: 'c', index: 0, transform: moved }]));
  assert.deepEqual(model.roots, ['b', 'c']);
  assert.deepEqual(model.get('a').transform.position, [5, 0, 0]);
  history.undo();
  assert.deepEqual(model.roots, ['a', 'b', 'c']);
  assert.deepEqual(model.get('a').transform.position, [0, 0, 0]);
});

test('transform command and component edits round-trip', () => {
  const { model, history } = setup();
  const id = model.createEntity({ name: 'Box', components: [createComponent('MeshRenderer')] });
  const before = structuredClone(model.get(id).transform);
  const after = { position: [1, 2, 3], rotation: [0, 90, 0], scale: [2, 2, 2] };
  history.execute(setTransformsCommand(model, [{ id, before, after }]));
  history.execute(setFieldCommand(model, id, ['components', 0, 'color'], '#C8C8C8', '#FF0000'));
  assert.equal(model.get(id).components[0].color, '#FF0000');
  history.undo();
  history.undo();
  assert.deepEqual(model.get(id).transform, before);
  assert.equal(model.get(id).components[0].color, '#C8C8C8');
});

test('new commands clear the redo stack', () => {
  const { model, history } = setup();
  const id = model.createEntity({ name: 'X' });
  history.execute(setFieldCommand(model, id, ['name'], 'X', 'Y'));
  history.undo();
  assert.equal(history.canRedo, true);
  history.seal();
  history.execute(setFieldCommand(model, id, ['active'], true, false));
  assert.equal(history.canRedo, false);
});

test('dirty flag tracks edits', () => {
  const { model } = setup();
  assert.equal(model.dirty, false);
  model.createEntity({ name: 'X' });
  assert.equal(model.dirty, true);
  model.markClean();
  assert.equal(model.dirty, false);
});

test('studio version matches package.json', async () => {
  const { VERSION } = await import('../../studio/js/version.js');
  const { readFile } = await import('node:fs/promises');
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});
