import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startAgent } from '../helpers/agent-harness.js';
import { createSceneData, createComponent } from '../../shared/scene-format.js';

function sampleScene() {
  const scene = createSceneData('Main');
  scene.entities.push({
    id: 'cube1',
    name: 'Cube',
    parent: null,
    transform: { position: [1, 2, 3], rotation: [0, 45, 0], scale: [1, 1, 1] },
    components: [createComponent('MeshFilter'), createComponent('MeshRenderer', { color: '#FF0000' })],
  });
  return scene;
}

test('project folder is created with the standard layout', async (t) => {
  const { project } = await startAgent(t);
  for (const dir of ['Assets/Scenes', 'Assets/Models', 'Builds', '.vox']) {
    const stat = await fs.stat(path.join(project, dir));
    assert.ok(stat.isDirectory(), dir);
  }
  const settings = JSON.parse(await fs.readFile(path.join(project, '.vox', 'ProjectSettings.json'), 'utf8'));
  assert.equal(settings.startScene, 'Assets/Scenes/Main.voxscene');
});

test('system info reports memory and CPU', async (t) => {
  const { request } = await startAgent(t);
  const res = await request('GET', '/api/system');
  assert.equal(res.status, 200);
  assert.ok(res.json.memory.total > 0);
  assert.ok(res.json.cpu.cores > 0);
});

test('scenes round-trip through write and read', async (t) => {
  const { request, project } = await startAgent(t);
  const write = await request('POST', '/api/scene', { body: { path: 'Assets/Scenes/Main.voxscene', scene: sampleScene() } });
  assert.equal(write.status, 200, write.text);
  assert.equal(write.json.path, 'Assets/Scenes/Main.voxscene');
  const leftovers = (await fs.readdir(path.join(project, 'Assets', 'Scenes'))).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);

  const read = await request('GET', '/api/scene?path=Assets/Scenes/Main.voxscene');
  assert.equal(read.status, 200);
  assert.equal(read.json.scene.entities[0].name, 'Cube');
  assert.deepEqual(read.json.scene.entities[0].transform.position, [1, 2, 3]);
  assert.equal(read.json.scene.entities[0].components[1].color, '#FF0000');
});

test('scene writes require the .voxscene extension and a valid scene', async (t) => {
  const { request } = await startAgent(t);
  const wrongExt = await request('POST', '/api/scene', { body: { path: 'Assets/evil.js', scene: sampleScene() } });
  assert.equal(wrongExt.status, 400);
  const bad = sampleScene();
  bad.entities[0].components.push({ type: 'ShellCommand', cmd: 'rm -rf /' });
  const invalid = await request('POST', '/api/scene', { body: { path: 'Assets/Scenes/Bad.voxscene', scene: bad } });
  assert.equal(invalid.status, 422);
});

test('listing shows project files and hides dot folders', async (t) => {
  const { request } = await startAgent(t);
  await request('POST', '/api/scene', { body: { path: 'Assets/Scenes/Main.voxscene', scene: sampleScene() } });
  const root = await request('GET', '/api/files?dir=');
  assert.deepEqual(root.json.entries.map((e) => e.name), ['Assets', 'Builds']);
  const scenes = await request('GET', '/api/files?dir=Assets/Scenes');
  assert.equal(scenes.json.entries[0].path, 'Assets/Scenes/Main.voxscene');
  assert.equal(scenes.json.entries[0].ext, '.voxscene');
  const tree = await request('GET', '/api/tree');
  assert.equal(tree.json.children[0].name, 'Assets');
});

test('OBJ import writes a voxmesh into Assets/Models', async (t) => {
  const { request, project } = await startAgent(t);
  const obj = ['o Tri', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3'].join('\n');
  const res = await request('POST', '/api/assets/import', { body: { name: '../../Tri angle.obj', format: 'obj', data: obj } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.meshes[0].path, 'Assets/Models/Tri angle.voxmesh');
  const text = await fs.readFile(path.join(project, 'Assets', 'Models', 'Tri angle.voxmesh'), 'utf8');
  assert.equal(JSON.parse(text).format, 'voxmesh');
  const mesh = await request('GET', '/api/mesh?path=' + encodeURIComponent('Assets/Models/Tri angle.voxmesh'));
  assert.equal(mesh.json.mesh.positions.length, 9);
});

test('import rejects unknown formats and broken files', async (t) => {
  const { request } = await startAgent(t);
  assert.equal((await request('POST', '/api/assets/import', { body: { name: 'x.exe', format: 'exe', data: 'MZ' } })).status, 400);
  assert.equal((await request('POST', '/api/assets/import', { body: { name: 'x.obj', format: 'obj', data: 'f 1 2 3' } })).status, 422);
});

test('folder, rename and delete stay inside managed folders', async (t) => {
  const { request } = await startAgent(t);
  assert.equal((await request('POST', '/api/folder', { body: { path: 'Assets/Prefabs' } })).status, 200);
  assert.equal((await request('POST', '/api/folder', { body: { path: '.vox/x' } })).status, 403);
  assert.equal((await request('POST', '/api/delete', { body: { path: 'Assets' } })).status, 403);
  assert.equal((await request('POST', '/api/delete', { body: { path: '.vox/ProjectSettings.json' } })).status, 403);

  await request('POST', '/api/scene', { body: { path: 'Assets/Scenes/A.voxscene', scene: sampleScene() } });
  const rename = await request('POST', '/api/rename', { body: { from: 'Assets/Scenes/A.voxscene', to: 'Assets/Scenes/B.voxscene' } });
  assert.equal(rename.status, 200);
  const toJs = await request('POST', '/api/rename', { body: { from: 'Assets/Scenes/B.voxscene', to: 'Assets/Scenes/B.js' } });
  assert.equal(toJs.status, 403);
  assert.equal((await request('POST', '/api/delete', { body: { path: 'Assets/Scenes/B.voxscene' } })).status, 200);
  assert.equal((await request('POST', '/api/delete', { body: { path: 'Assets/Prefabs' } })).status, 200);
});
