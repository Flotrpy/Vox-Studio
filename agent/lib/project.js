import fs from 'node:fs/promises';
import path from 'node:path';
import { VERSION } from './version.js';

/** Folders every Vox project has. */
export const PROJECT_FOLDERS = ['Assets', 'Assets/Scenes', 'Assets/Models', 'Builds', '.vox'];

export const SETTINGS_FILE = '.vox/ProjectSettings.json';

/**
 * Create the project folder layout if it does not exist yet and return the
 * project settings. Existing files are never overwritten.
 */
export async function ensureProject(root) {
  await fs.mkdir(root, { recursive: true });
  for (const folder of PROJECT_FOLDERS) {
    await fs.mkdir(path.join(root, ...folder.split('/')), { recursive: true });
  }

  const settingsPath = path.join(root, ...SETTINGS_FILE.split('/'));
  let settings;
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
    settings = null;
  }
  if (!settings || typeof settings !== 'object') {
    settings = {
      name: path.basename(root),
      createdWith: `Vox Agent ${VERSION}`,
      startScene: 'Assets/Scenes/Main.voxscene',
    };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx' }).catch((err) => {
      if (err.code !== 'EEXIST') throw err;
    });
  }
  return settings;
}

/**
 * Folder for partial uploads, <project>/.vox/uploads. Throws if .vox or
 * uploads is a link or otherwise resolves outside the project, so neither
 * writes nor cleanup can reach files elsewhere.
 */
export async function uploadsDir(root) {
  const realRoot = await fs.realpath(root);
  const dir = path.join(realRoot, '.vox', 'uploads');
  for (const p of [path.join(realRoot, '.vox'), dir]) {
    let stat;
    try {
      stat = await fs.lstat(p);
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    if (!stat.isDirectory()) throw new Error(`${p} is not a plain folder`);
  }
  return dir;
}

/**
 * Remove partial uploads left by an earlier run (they are never resumed).
 * Called once at startup; skipped when the folder is a link.
 */
export async function clearStaleUploads(root) {
  let dir;
  try {
    dir = await uploadsDir(root);
  } catch {
    return;
  }
  await fs.rm(dir, { recursive: true, force: true });
}
