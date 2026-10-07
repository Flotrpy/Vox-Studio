import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startAgent } from '../helpers/agent-harness.js';

test('large files upload in chunks and import without hitting the body cap', async (t) => {
  // 1 KB body cap: the OBJ below is far larger than one JSON request.
  const { request, project } = await startAgent(t, { maxBody: 1024 });
  const lines = [];
  for (let i = 0; i < 300; i++) lines.push(`v ${i} 0 0`, `v ${i} 1 0`, `v ${i} 0 1`);
  for (let i = 0; i < 300; i++) lines.push(`f ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}`);
  const data = Buffer.from(lines.join('\n'));
  assert.ok(data.length > 4096);

  const start = await request('POST', '/api/uploads/start', { body: { size: data.length } });
  assert.equal(start.status, 200);
  const id = start.json.uploadId;
  let offset = 0;
  while (offset < data.length) {
    const chunk = data.subarray(offset, offset + 1000);
    const res = await request('POST', `/api/uploads/chunk?id=${id}&offset=${offset}`, {
      headers: { 'content-type': 'application/octet-stream' },
      body: chunk,
    });
    assert.equal(res.status, 200, res.text);
    offset += chunk.length;
  }
  assert.equal((await request('POST', '/api/uploads/finish', { body: { id } })).status, 200);
  const imported = await request('POST', '/api/assets/import', { body: { name: 'big.obj', format: 'obj', uploadId: id } });
  assert.equal(imported.status, 200, imported.text);
  assert.equal(imported.json.meshes[0].mesh.indices.length, 900);
  // Uploads are consumed once and their temp file is gone.
  assert.deepEqual(await fs.readdir(path.join(project, '.vox', 'uploads')), []);
  assert.equal((await request('POST', '/api/assets/import', { body: { name: 'big.obj', format: 'obj', uploadId: id } })).status, 404);
});

test('uploads enforce size, order and id rules', async (t) => {
  const { request } = await startAgent(t);
  assert.equal((await request('POST', '/api/uploads/start', { body: { size: 10 * 1024 ** 3 } })).status, 413);
  assert.equal((await request('POST', '/api/uploads/start', { body: { size: -1 } })).status, 400);
  const { json } = await request('POST', '/api/uploads/start', { body: { size: 10 } });
  const octet = { 'content-type': 'application/octet-stream' };
  assert.equal((await request('POST', `/api/uploads/chunk?id=${json.uploadId}&offset=5`, { headers: octet, body: 'abcde' })).status, 409);
  assert.equal((await request('POST', `/api/uploads/chunk?id=${json.uploadId}&offset=0`, { body: { x: 1 } })).status, 415);
  assert.equal((await request('POST', `/api/uploads/chunk?id=../../etc&offset=0`, { headers: octet, body: 'abc' })).status, 400);
  // More bytes than declared are refused.
  assert.equal((await request('POST', `/api/uploads/chunk?id=${json.uploadId}&offset=0`, { headers: octet, body: 'x'.repeat(20) })).status, 413);
  assert.equal((await request('POST', '/api/uploads/finish', { body: { id: json.uploadId } })).status, 409);
  assert.equal((await request('POST', '/api/uploads/cancel', { body: { id: json.uploadId } })).status, 200);
});
