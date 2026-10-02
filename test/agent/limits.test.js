import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAgent } from '../helpers/agent-harness.js';

test('declared bodies above the cap get 413', async (t) => {
  const { request } = await startAgent(t, { maxBody: 1024 });
  const res = await request('POST', '/api/scene', { body: 'x'.repeat(4096) });
  assert.equal(res.status, 413);
});

test('chunked bodies above the cap get 413', async (t) => {
  const { request } = await startAgent(t, { maxBody: 1024 });
  const res = await request('POST', '/api/scene', {
    headers: { 'transfer-encoding': 'chunked' },
    body: JSON.stringify({ path: 'Assets/a.voxscene', pad: 'y'.repeat(5000) }),
  });
  assert.equal(res.status, 413);
});

test('non-JSON content types are rejected', async (t) => {
  const { request } = await startAgent(t);
  const res = await request('POST', '/api/benchmark', {
    headers: { 'content-type': 'text/plain' },
    body: '{"kind":"cpu"}',
  });
  assert.equal(res.status, 415);
});

test('malformed JSON is rejected without being evaluated', async (t) => {
  const { request } = await startAgent(t);
  const res = await request('POST', '/api/benchmark', { body: "{kind: 'cpu', run: process.exit(1)}" });
  assert.equal(res.status, 400);
  // The server is still alive.
  assert.equal((await request('GET', '/api/health')).status, 200);
});

test('very long URLs are refused', async (t) => {
  const { request } = await startAgent(t);
  const res = await request('GET', '/api/files?dir=' + 'a'.repeat(5000));
  assert.equal(res.status, 414);
});

test('benchmark validates its workload name', async (t) => {
  const { request } = await startAgent(t);
  assert.equal((await request('POST', '/api/benchmark', { body: { kind: 'shell' } })).status, 400);
  const ok = await request('POST', '/api/benchmark', { body: { kind: 'cpu', durationMs: 100 } });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.opsPerSecond > 0);
});
