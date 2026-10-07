import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { startAgent, TEST_TOKEN } from '../helpers/agent-harness.js';
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

test('a switch while a request body is still arriving is caught', async (t) => {
  const { request, project, port } = await startAgent(t);
  await ensureProject(path.join(path.dirname(project), 'Second'));
  const before = (await request('GET', '/api/health')).json.projectId;
  const second = (await request('GET', '/api/projects')).json.projects.find((p) => p.name === 'Second');

  const body = JSON.stringify({ path: 'Assets/Scenes/Late.voxscene', scene: { name: 'Late', entities: [] } });
  const pending = new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: '/api/scene',
      headers: { 'x-vox-token': TEST_TOKEN, 'x-vox-project': before, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.write(body.slice(0, 10));
    // Finish the body only after another tab has switched projects.
    request('POST', '/api/projects/open', { body: { id: second.id } }).then(() => req.end(body.slice(10)), reject);
  });
  const res = await pending;
  assert.equal(res.status, 409);
  assert.equal(res.json.error.details.code, 'project-changed');
  for (const dir of [project, path.join(path.dirname(project), 'Second')]) {
    await assert.rejects(fs.access(path.join(dir, 'Assets', 'Scenes', 'Late.voxscene')));
  }
});

test('an upload started in one project cannot be imported into another', async (t) => {
  const { request, project } = await startAgent(t);
  await ensureProject(path.join(path.dirname(project), 'Second'));
  const data = Buffer.from('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  const id = (await request('POST', '/api/uploads/start', { body: { size: data.length } })).json.uploadId;
  const chunk = await request('POST', `/api/uploads/chunk?id=${id}&offset=0`, {
    headers: { 'content-type': 'application/octet-stream' },
    body: data,
  });
  assert.equal(chunk.status, 200);
  assert.equal((await request('POST', '/api/uploads/finish', { body: { id } })).status, 200);

  const second = (await request('GET', '/api/projects')).json.projects.find((p) => p.name === 'Second');
  assert.equal((await request('POST', '/api/projects/open', { body: { id: second.id } })).status, 200);
  const imported = await request('POST', '/api/assets/import', { body: { name: 'tri.obj', format: 'obj', uploadId: id } });
  assert.equal(imported.status, 409);
  assert.equal((await request('POST', '/api/uploads/cancel', { body: { id } })).status, 200);
});

test('creating the same project twice at once yields one 409', async (t) => {
  const { request } = await startAgent(t);
  const results = await Promise.all([1, 2].map(() => request('POST', '/api/projects/create', { body: { name: 'Twin' } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});
