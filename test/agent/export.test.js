import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startAgent } from '../helpers/agent-harness.js';
import { createSceneData, createComponent } from '../../shared/scene-format.js';
import { scriptSafeJson } from '../../agent/lib/jobs/export.js';

function scene(name = 'Level 1') {
  const s = createSceneData(name);
  s.entities.push({
    id: 'cam',
    name: 'Main Camera',
    tag: 'MainCamera',
    components: [createComponent('Camera')],
  }, {
    id: 'evil',
    name: '</script><script>alert(1)</script>',
    components: [createComponent('Script', { name: 'S', code: 'function update(){ Debug.log("</script>"); }' })],
  });
  return s;
}

test('export writes a self-contained play.html', async (t) => {
  const { request, project } = await startAgent(t);
  const res = await request('POST', '/api/export', { body: { scene: scene(), title: 'My <Game>' } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.path, 'Builds/Level 1/play.html');
  const html = await fs.readFile(path.join(project, 'Builds', 'Level 1', 'play.html'), 'utf8');
  assert.match(html, /<title>My &lt;Game&gt;<\/title>/);
  assert.match(html, /"three":"data:text\/javascript;base64,/);
  assert.match(html, /"vox\/play\/player.js":"data:text\/javascript;base64,/);
  // Scene text cannot close the surrounding <script> element.
  const sceneBlock = html.slice(html.indexOf('id="vox-scene">'), html.indexOf('</script>', html.indexOf('id="vox-scene">')));
  assert.ok(!sceneBlock.includes('<'), 'no raw < inside the scene JSON');
  assert.equal((html.match(/<\/script>/g) || []).length, 3);
  assert.ok(!/https?:\/\//.test(html.replace(/http-equiv/g, '')), 'no network URLs');
});

test('export can read a saved scene by path and validates input', async (t) => {
  const { request } = await startAgent(t);
  await request('POST', '/api/scene', { body: { path: 'Assets/Scenes/A.voxscene', scene: scene('A') } });
  const ok = await request('POST', '/api/export', { body: { scenePath: 'Assets/Scenes/A.voxscene', folder: '../../etc' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.path, 'Builds/______etc/play.html');
  assert.equal((await request('POST', '/api/export', { body: { scenePath: '../x.voxscene' } })).status, 400);
  assert.equal((await request('POST', '/api/export', { body: { scene: { format: 'nope' } } })).status, 422);
});

test('build tickets are single use and limited to Builds/*/play.html', async (t) => {
  const { request } = await startAgent(t);
  await request('POST', '/api/export', { body: { scene: scene('G') } });
  assert.equal((await request('POST', '/api/build/ticket', { body: { path: 'Assets/Scenes/x.voxscene' } })).status, 400);
  assert.equal((await request('POST', '/api/build/ticket', { body: { path: 'Builds/../play.html' } })).status, 400);
  assert.equal((await request('POST', '/api/build/ticket', { body: { path: 'Builds/Missing/play.html' } })).status, 404);
  const ticket = await request('POST', '/api/build/ticket', { body: { path: 'Builds/G/play.html' } });
  assert.equal(ticket.status, 200);
  const first = await request('GET', ticket.json.url, { token: null });
  assert.equal(first.status, 200);
  assert.match(first.headers['content-security-policy'], /connect-src 'none'/);
  assert.equal((await request('GET', ticket.json.url, { token: null })).status, 404, 'second use fails');
  assert.equal((await request('GET', '/play/' + 'a'.repeat(32), { token: null })).status, 404);
});

test('scriptSafeJson escapes markup characters', () => {
  assert.equal(scriptSafeJson({ a: '</script>&\u2028' }), '{"a":"\\u003c/script\\u003e\\u0026\\u2028"}');
});
