import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPairingToken } from '../../agent/lib/pairing.js';
import { userConfigDir } from '../../agent/lib/user-config.js';
import { parseArgs } from '../../agent/lib/config.js';

async function tmpDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-pair-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'cfg');
}

test('the pairing token is reused between runs', async (t) => {
  const dir = await tmpDir(t);
  const first = await loadPairingToken(dir);
  const second = await loadPairingToken(dir);
  assert.equal(first.token, second.token);
  assert.equal(second.rotated, false);
  if (process.platform !== 'win32') {
    const mode = (await fs.stat(path.join(dir, 'pairing.json'))).mode & 0o777;
    assert.equal(mode, 0o600);
  }
});

test('--new-token rotates and --no-persist never writes', async (t) => {
  const dir = await tmpDir(t);
  const first = await loadPairingToken(dir);
  const rotated = await loadPairingToken(dir, { rotate: true });
  assert.notEqual(first.token, rotated.token);
  assert.equal((await loadPairingToken(dir)).token, rotated.token);
  const other = await tmpDir(t);
  const temp = await loadPairingToken(other, { persist: false });
  assert.equal(temp.persistent, false);
  await assert.rejects(fs.stat(path.join(other, 'pairing.json')));
});

test('a corrupt pairing file is replaced', async (t) => {
  const dir = await tmpDir(t);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'pairing.json'), '{"token":"short"}');
  const { token, rotated } = await loadPairingToken(dir);
  assert.equal(rotated, true);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
});

test('config folder and new CLI options', () => {
  assert.equal(userConfigDir({ VOX_AGENT_HOME: '/x/y' }, 'linux'), path.resolve('/x/y'));
  assert.equal(userConfigDir({ XDG_CONFIG_HOME: '/cfg' }, 'linux'), path.join('/cfg', 'vox-agent'));
  const c = parseArgs(['--project', '/p/game', '--new-token', '--max-upload', '64']);
  assert.equal(c.newToken, true);
  assert.equal(c.persistToken, true);
  assert.equal(parseArgs(['--no-persist']).persistToken, false);
  // --no-persist would leave the stored token valid for the next run.
  assert.throws(() => parseArgs(['--new-token', '--no-persist']), /cannot be combined/);
  assert.equal(c.maxUpload, 64 * 1024 * 1024);
  assert.equal(c.projectsRoot, path.resolve('/p'));
});
