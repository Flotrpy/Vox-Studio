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
