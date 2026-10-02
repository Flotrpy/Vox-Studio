import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveInside, resolveReal, isWithin } from '../../agent/lib/paths.js';
import { HttpError } from '../../agent/lib/http.js';

const root = path.resolve('/projects/demo');

function rejects(rel, status = 400) {
  assert.throws(() => resolveInside(root, rel), (err) => err instanceof HttpError && err.status === status, rel);
}

test('resolveInside accepts normal project paths', () => {
  assert.equal(resolveInside(root, 'Assets/Scenes/Main.voxscene'), path.join(root, 'Assets', 'Scenes', 'Main.voxscene'));
  assert.equal(resolveInside(root, ''), root);
  assert.equal(resolveInside(root, './Assets/./Models'), path.join(root, 'Assets', 'Models'));
});

test('resolveInside blocks parent directory traversal', () => {
  rejects('../secret.txt');
  rejects('Assets/../../etc/passwd');
  rejects('Assets/..');
  rejects('..');
});

test('resolveInside blocks absolute, drive and UNC style paths', () => {
  rejects('/etc/passwd');
  rejects('C:/Windows/system.ini');
  rejects('c:secret');
  rejects('\\\\server\\share');
  rejects('Assets\\..\\..\\secret');
});

test('resolveInside blocks control characters and reserved names', () => {
  rejects('Assets/a\u0000b');
  rejects('Assets/what?.txt');
  rejects('Assets/CON');
  rejects('Assets/nul.txt');
  rejects('Assets/trailing.');
  rejects('x'.repeat(600));
  rejects(42);
});

test('isWithin handles prefix look-alikes', () => {
  assert.equal(isWithin('/a/project', '/a/project/x'), true);
  assert.equal(isWithin('/a/project', '/a/project'), true);
  assert.equal(isWithin('/a/project', '/a/project-evil/x'), false);
  assert.equal(isWithin('/a/project', '/a'), false);
});

test('resolveReal rejects symlinks pointing outside the project', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-paths-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const project = path.join(tmp, 'project');
  const outside = path.join(tmp, 'outside');
  await fs.mkdir(path.join(project, 'Assets'), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
  try {
    await fs.symlink(outside, path.join(project, 'Assets', 'link'), 'junction');
  } catch {
    t.skip('symlinks not permitted on this system');
    return;
  }
  await assert.rejects(resolveReal(project, 'Assets/link/secret.txt'), (err) => err.status === 403);
  await assert.rejects(resolveReal(project, 'Assets/link/new-file.voxscene'), (err) => err.status === 403);
  const ok = await resolveReal(project, 'Assets/new/Main.voxscene');
  assert.ok(ok.endsWith(path.join('Assets', 'new', 'Main.voxscene')));
});
