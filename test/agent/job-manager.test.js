import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAgent } from '../helpers/agent-harness.js';

async function waitForJob(request, id, states = ['done', 'failed', 'cancelled']) {
  for (let i = 0; i < 100; i++) {
    const res = await request('GET', `/api/job?id=${id}`);
    if (states.includes(res.json.state)) return res.json;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('job did not finish');
}

test('imports can run as background jobs with progress', async (t) => {
  const { request } = await startAgent(t);
  const obj = ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3'].join('\n');
  const start = await request('POST', '/api/assets/import', { body: { name: 'tri.obj', format: 'obj', data: obj, async: true } });
  assert.equal(start.status, 200);
  assert.match(start.json.jobId, /^[A-Za-z0-9_-]{12}$/);
  const job = await waitForJob(request, start.json.jobId);
  assert.equal(job.state, 'done');
  assert.equal(job.progress, 1);
  assert.equal(job.result.meshes[0].path, 'Assets/Models/tri.voxmesh');
  const list = await request('GET', '/api/jobs');
  assert.ok(list.json.jobs.some((j) => j.id === start.json.jobId));
});

test('a running benchmark can be cancelled', async (t) => {
  const { request } = await startAgent(t);
  const start = await request('POST', '/api/benchmark', { body: { kind: 'cpu', durationMs: 4000, async: true } });
  await new Promise((r) => setTimeout(r, 300));
  const running = await request('GET', `/api/job?id=${start.json.jobId}`);
  assert.equal(running.json.state, 'running');
  assert.ok(running.json.progress > 0);
  const cancel = await request('POST', '/api/jobs/cancel', { body: { id: start.json.jobId } });
  assert.equal(cancel.json.state, 'cancelled');
  // The benchmark slot is free again right away.
  const again = await request('POST', '/api/benchmark', { body: { kind: 'cpu', durationMs: 100 } });
  assert.equal(again.status, 200);
});

test('failed jobs report the error and unknown jobs are 404', async (t) => {
  const { request } = await startAgent(t);
  const start = await request('POST', '/api/assets/import', { body: { name: 'bad.obj', format: 'obj', data: 'f 1 2 3', async: true } });
  const job = await waitForJob(request, start.json.jobId);
  assert.equal(job.state, 'failed');
  assert.equal(job.error.status, 422);
  assert.equal((await request('GET', '/api/job?id=nope')).status, 404);
  assert.equal((await request('POST', '/api/jobs/cancel', { body: { id: 'nope' } })).status, 404);
});

test('builds run as jobs too', async (t) => {
  const { request } = await startAgent(t);
  const start = await request('POST', '/api/export', { body: { scene: { format: 'voxscene', version: 1, name: 'J', entities: [] }, async: true } });
  const job = await waitForJob(request, start.json.jobId);
  assert.equal(job.state, 'done', JSON.stringify(job.error));
  assert.equal(job.result.path, 'Builds/J/play.html');
});
