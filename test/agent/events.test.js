import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startAgent, TEST_TOKEN } from '../helpers/agent-harness.js';

/** Open the event stream and collect events until `until` returns true. */
function openStream(port, { token = TEST_TOKEN } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}` };
    if (token) headers['x-vox-token'] = token;
    const req = http.request({ host: '127.0.0.1', port, path: '/api/events', headers }, (res) => {
      const events = [];
      let buffer = '';
      const waiters = [];
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const type = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (type) events.push({ type, data: JSON.parse(data) });
          for (const w of [...waiters]) if (w.test(events)) {
            waiters.splice(waiters.indexOf(w), 1);
            w.resolve(events);
          }
        }
      });
      resolve({
        status: res.statusCode,
        headers: res.headers,
        close: () => req.destroy(),
        waitFor: (test, ms = 3000) =>
          new Promise((res2, rej2) => {
            if (test(events)) return res2(events);
            const w = { test, resolve: res2 };
            waiters.push(w);
            setTimeout(() => rej2(new Error('timed out waiting for event')), ms);
          }),
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('the event stream needs the token', async (t) => {
  const { port } = await startAgent(t);
  const stream = await openStream(port, { token: null });
  assert.equal(stream.status, 401);
  stream.close();
});

test('file changes in the project are pushed to paired tabs', async (t) => {
  const { port, project } = await startAgent(t);
  const stream = await openStream(port);
  t.after(() => stream.close());
  assert.equal(stream.status, 200);
  assert.match(stream.headers['content-type'], /text\/event-stream/);
  await new Promise((r) => setTimeout(r, 100));
  await fs.writeFile(path.join(project, 'Assets', 'notes.txt'), 'hello');
  const events = await stream.waitFor((ev) => ev.some((e) => e.type === 'files' && e.data.paths.includes('Assets/notes.txt')));
  assert.ok(events.length >= 1);
});

test('changes inside .vox are not reported', async (t) => {
  const { port, project } = await startAgent(t);
  const stream = await openStream(port);
  t.after(() => stream.close());
  await new Promise((r) => setTimeout(r, 100));
  await fs.writeFile(path.join(project, '.vox', 'private.json'), '{}');
  await fs.writeFile(path.join(project, 'Assets', 'visible.txt'), 'x');
  const events = await stream.waitFor((ev) => ev.some((e) => e.type === 'files'));
  const paths = events.flatMap((e) => e.data.paths || []);
  assert.ok(!paths.some((p) => p.startsWith('.vox')));
});
