import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tabs,
  split,
  normalizeLayout,
  removePanel,
  dockBeside,
  panelsIn,
  findGroup,
} from '../../studio/js/ui/dock-layout.js';

const known = new Set(['hierarchy', 'scene', 'game', 'inspector', 'project', 'console']);

function defaultTree() {
  return split('row', [
    split('col', [
      split('row', [tabs(['hierarchy']), tabs(['scene', 'game'])], [0.25, 0.75]),
      tabs(['project', 'console']),
    ], [0.65, 0.35]),
    tabs(['inspector']),
  ], [0.78, 0.22]);
}

test('normalize drops unknown and duplicate panels', () => {
  const tree = split('row', [tabs(['scene', 'bogus', 'scene']), tabs(['game'])]);
  const clean = normalizeLayout(tree, known);
  assert.deepEqual(panelsIn(clean), ['scene', 'game']);
});

test('normalize collapses single-child splits and merges same direction', () => {
  const tree = split('row', [split('row', [tabs(['a']), tabs(['b'])], [0.5, 0.5]), split('col', [tabs(['c'])])], [0.5, 0.5]);
  const clean = normalizeLayout(tree, new Set(['a', 'b', 'c']));
  assert.equal(clean.type, 'split');
  assert.equal(clean.children.length, 3);
  assert.deepEqual(clean.sizes.map((s) => Math.round(s * 100)), [25, 25, 50]);
});

test('removing the last tab removes its group', () => {
  let tree = normalizeLayout(defaultTree(), known);
  tree = removePanel(tree, 'inspector', known);
  assert.equal(panelsIn(tree).includes('inspector'), false);
  assert.equal(tree.dir, 'col');
});

test('dockBeside splits a group and keeps every panel once', () => {
  let tree = normalizeLayout(defaultTree(), known);
  tree = removePanel(tree, 'console', known);
  const { group } = findGroup(tree, 'scene');
  tree = normalizeLayout(dockBeside(tree, group, 'console', 'right'), known);
  assert.deepEqual(panelsIn(tree).sort(), [...known].sort());
  const parent = findGroup(tree, 'console').parent;
  assert.equal(parent.dir, 'row');
});

test('garbage input yields null instead of throwing', () => {
  assert.equal(normalizeLayout(null, known), null);
  assert.equal(normalizeLayout({ type: 'split', children: 'x' }, known), null);
  assert.equal(normalizeLayout(tabs([]), known), null);
});
