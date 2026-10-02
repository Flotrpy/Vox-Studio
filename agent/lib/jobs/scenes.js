import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { HttpError } from '../http.js';
import { resolveReal, toProjectPath } from '../paths.js';
import {
  SCENE_EXTENSION,
  MESH_EXTENSION,
  SceneFormatError,
  parseScene,
  parseMeshFile,
  serializeScene,
} from '../../../shared/scene-format.js';

/** Largest scene file the agent will read back (bytes). */
const MAX_READ = 64 * 1024 * 1024;

function requireExtension(relPath, ext) {
  if (typeof relPath !== 'string' || !relPath.toLowerCase().endsWith(ext)) {
    throw new HttpError(400, `Path must end with ${ext}`);
  }
}

/**
 * Write a file inside the project atomically: the data goes to a temporary
 * sibling first and is renamed over the target, so a crash never leaves a
 * half-written scene behind.
 */
export async function writeProjectFile(root, relPath, data) {
  const target = await resolveReal(root, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Re-check after mkdir in case a folder was swapped for a link meanwhile.
  await resolveReal(root, relPath);
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(tmp, data, { flag: 'wx' });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return toProjectPath(await fs.realpath(root), target);
}

/** Read a project file as UTF-8 text with a size cap. */
export async function readProjectText(root, relPath) {
  const file = await resolveReal(root, relPath);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch (err) {
    if (err.code === 'ENOENT') throw new HttpError(404, 'File not found');
    throw err;
  }
  if (!stat.isFile()) throw new HttpError(400, 'Not a file');
  if (stat.size > MAX_READ) throw new HttpError(413, 'File is too large');
  return fs.readFile(file, 'utf8');
}

function asFormatError(err) {
  if (err instanceof SceneFormatError) return new HttpError(422, `Invalid scene: ${err.message}`);
  return err;
}

/** GET /api/scene?path=, POST /api/scene, GET /api/mesh?path= */
export function registerScenes(router, config) {
  router.get('/api/scene', async ({ query }) => {
    const rel = query.get('path');
    requireExtension(rel, SCENE_EXTENSION);
    const text = await readProjectText(config.project, rel);
    try {
      return { path: rel, scene: parseScene(text) };
    } catch (err) {
      throw asFormatError(err);
    }
  });

  router.post('/api/scene', async ({ json }) => {
    const body = await json();
    requireExtension(body.path, SCENE_EXTENSION);
    let text;
    try {
      text = serializeScene(body.scene);
    } catch (err) {
      throw asFormatError(err);
    }
    const saved = await writeProjectFile(config.project, body.path, text);
    return { ok: true, path: saved, bytes: Buffer.byteLength(text) };
  });

  router.get('/api/mesh', async ({ query }) => {
    const rel = query.get('path');
    requireExtension(rel, MESH_EXTENSION);
    const text = await readProjectText(config.project, rel);
    try {
      return { path: rel, mesh: parseMeshFile(text) };
    } catch (err) {
      throw asFormatError(err);
    }
  });
}
