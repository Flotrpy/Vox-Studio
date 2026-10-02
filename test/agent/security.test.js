import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAgent } from '../helpers/agent-harness.js';

test('API rejects requests without a token', async (t) => {
  const { request } = await startAgent(t);
  const res = await request('GET', '/api/health', { token: null });
  assert.equal(res.status, 401);
  assert.equal(res.json.error.status, 401);
});

test('API rejects a wrong token', async (t) => {
  const { request } = await startAgent(t);
  assert.equal((await request('GET', '/api/health', { token: 'wrong' })).status, 401);
  assert.equal((await request('GET', '/api/system', { token: 'wrong' })).status, 401);
});

test('API accepts the pairing token', async (t) => {
  const { request } = await startAgent(t);
  const res = await request('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.agent, 'Vox Agent');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('foreign Origin is rejected even with a valid token', async (t) => {
  const { request } = await startAgent(t);
  const res = await request('GET', '/api/health', { headers: { origin: 'http://evil.example' } });
  assert.equal(res.status, 403);
  const post = await request('POST', '/api/benchmark', {
    headers: { origin: 'null' },
    body: { kind: 'cpu', durationMs: 100 },
  });
  assert.equal(post.status, 403);
});

test('same-origin Origin values are accepted', async (t) => {
  const { request, port } = await startAgent(t);
  for (const origin of [`http://127.0.0.1:${port}`, `http://localhost:${port}`]) {
    const res = await request('GET', '/api/health', { headers: { origin } });
    assert.equal(res.status, 200, origin);
  }
});

test('Origin on another port is rejected', async (t) => {
  const { request, port } = await startAgent(t);
  const res = await request('GET', '/api/health', { headers: { origin: `http://127.0.0.1:${port + 1}` } });
  assert.equal(res.status, 403);
});

test('cross-site fetch metadata is rejected', async (t) => {
  const { request } = await startAgent(t);
  const res = await request('GET', '/api/health', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(res.status, 403);
});

test('unexpected Host header is rejected (DNS rebinding)', async (t) => {
  const { request } = await startAgent(t);
  assert.equal((await request('GET', '/api/health', { host: 'evil.example:8787' })).status, 403);
  assert.equal((await request('GET', '/', { host: 'attacker.test' })).status, 403);
});

test('static studio files are served with a CSP and no token', async (t) => {
  const { request } = await startAgent(t);
  const res = await request('GET', '/', { token: null });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-security-policy'], /script-src 'self' 'unsafe-eval' 'sha256-/);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('static server does not leave its folder', async (t) => {
  const { request } = await startAgent(t);
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/shared/../../etc/passwd']) {
    const res = await request('GET', p, { token: null });
    assert.ok([400, 404].includes(res.status), `${p} -> ${res.status}`);
  }
});

test('unknown endpoints and methods are refused', async (t) => {
  const { request } = await startAgent(t);
  assert.equal((await request('GET', '/api/run')).status, 404);
  assert.equal((await request('POST', '/api/exec', { body: { cmd: 'ls' } })).status, 404);
  assert.equal((await request('DELETE', '/api/health')).status, 405);
});

test('file API rejects path traversal', async (t) => {
  const { request } = await startAgent(t);
  const list = await request('GET', '/api/files?dir=' + encodeURIComponent('../'));
  assert.equal(list.status, 400);
  const read = await request('GET', '/api/scene?path=' + encodeURIComponent('../../outside.voxscene'));
  assert.equal(read.status, 400);
  const write = await request('POST', '/api/scene', {
    body: { path: '../escape.voxscene', scene: { format: 'voxscene', version: 1, entities: [] } },
  });
  assert.equal(write.status, 400);
  const abs = await request('GET', '/api/files?dir=' + encodeURIComponent('/etc'));
  assert.equal(abs.status, 400);
});
