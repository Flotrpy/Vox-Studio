import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startAgent } from '../helpers/agent-harness.js';
import { ensureProject } from '../../agent/lib/project.js';

test('projects under the root are listed and can be opened by id', async (t) => {
  const { request, project } = await startAgent(t);
  const root = path.dirname(project);
  await ensureProject(path.join(root, 'Second'));
  await fs.mkdir(path.join(root, 'NotAProject'));
  const list = await request('GET', '/api/projects');
  assert.equal(list.status, 200);
  const names = list.json.projects.map((p) => p.name).sort();
  assert.deepEqual(names, ['Second', 'project']);
  const second = list.json.projects.find((p) => p.name === 'Second');
  const open = await request('POST', '/api/projects/open', { body: { id: second.id } });
  assert.equal(open.status, 200);
  assert.equal((await request('GET', '/api/health')).json.project, 'Second');
  // File jobs now work inside the new project only.
  const files = await request('GET', '/api/files?dir=');
  assert.deepEqual(files.json.entries.map((e) => e.name), ['Assets', 'Builds']);
});

test('the studio cannot open arbitrary paths', async (t) => {
  const { request } = await startAgent(t);
  assert.equal((await request('POST', '/api/projects/open', { body: { id: '/etc' } })).status, 404);
  assert.equal((await request('POST', '/api/projects/open', { body: { path: '/etc' } })).status, 400);
});

test('new projects are created inside the projects root', async (t) => {
  const { request, project } = await startAgent(t);
  const created = await request('POST', '/api/projects/create', { body: { name: 'My Game' } });
  assert.equal(created.status, 200, created.text);
  await fs.access(path.join(path.dirname(project), 'My Game', '.vox', 'ProjectSettings.json'));
  for (const bad of ['../escape', '/abs', '', 'a/b', '.hidden', 'x'.repeat(80)]) {
    assert.equal((await request('POST', '/api/projects/create', { body: { name: bad } })).status, 400, bad);
  }
  assert.equal((await request('POST', '/api/projects/create', { body: { name: 'My Game' } })).status, 409);
});

test('a tab still on the old project cannot touch files after a switch', async (t) => {
  const { request, project } = await startAgent(t);
  await ensureProject(path.join(path.dirname(project), 'Second'));
  const before = (await request('GET', '/api/health')).json.projectId;
  const headers = { 'x-vox-project': before };
  assert.equal((await request('GET', '/api/files?dir=', { headers })).status, 200);

  const second = (await request('GET', '/api/projects')).json.projects.find((p) => p.name === 'Second');
  assert.equal((await request('POST', '/api/projects/open', { body: { id: second.id }, headers })).status, 200);

  const scene = { path: 'Assets/Scenes/Main.voxscene', scene: { name: 'Stale', entities: [] } };
  const save = await request('POST', '/api/scene', { body: scene, headers });
  assert.equal(save.status, 409);
  assert.equal(save.json.error.details.code, 'project-changed');
  assert.equal((await request('GET', '/api/files?dir=', { headers })).status, 409);
  // Health and project routes still answer, so the tab can catch up.
  const health = await request('GET', '/api/health', { headers });
  assert.equal(health.json.projectId, second.id);
  assert.equal((await request('GET', '/api/projects', { headers })).status, 200);
  assert.equal((await request('GET', '/api/files?dir=', { headers: { 'x-vox-project': second.id } })).status, 200);
});
