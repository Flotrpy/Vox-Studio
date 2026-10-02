import fs from 'node:fs/promises';
import { HttpError } from '../http.js';
import { resolveReal, toProjectPath } from '../paths.js';

/** Top-level folders the studio may reorganize. Settings in .vox are off limits. */
const MANAGED_ROOTS = ['Assets', 'Builds'];
/** File types the studio may delete or rename. */
const MANAGED_EXTENSIONS = ['.voxscene', '.voxmesh', '.obj', '.gltf', '.glb', '.html'];

function checkManaged(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) throw new HttpError(400, 'path is required');
  const top = relPath.split('/')[0];
  if (!MANAGED_ROOTS.includes(top) || relPath === top || relPath === `${top}/`) {
    throw new HttpError(403, `Only items inside ${MANAGED_ROOTS.join(' or ')} can be changed`);
  }
}

function hasManagedExtension(relPath) {
  const lower = relPath.toLowerCase();
  return MANAGED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function statOrNull(abs) {
  try {
    return await fs.lstat(abs);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function createFolder(root, relPath) {
  checkManaged(relPath);
  const abs = await resolveReal(root, relPath);
  if (await statOrNull(abs)) throw new HttpError(409, 'An item with that name already exists');
  await fs.mkdir(abs, { recursive: true });
  return { ok: true, path: toProjectPath(await fs.realpath(root), abs) };
}

/** Delete a managed file, or a folder only when it is empty. */
export async function deleteItem(root, relPath) {
  checkManaged(relPath);
  const abs = await resolveReal(root, relPath);
  const stat = await statOrNull(abs);
  if (!stat) throw new HttpError(404, 'Item not found');
  if (stat.isDirectory()) {
    const children = await fs.readdir(abs);
    if (children.length > 0) throw new HttpError(409, 'Folder is not empty');
    await fs.rmdir(abs);
  } else if (stat.isFile() && hasManagedExtension(relPath)) {
    await fs.unlink(abs);
  } else {
    throw new HttpError(403, 'This file type cannot be deleted from the studio');
  }
  return { ok: true };
}

/** Rename or move an item within the managed folders without overwriting. */
export async function renameItem(root, from, to) {
  checkManaged(from);
  checkManaged(to);
  const src = await resolveReal(root, from);
  const dst = await resolveReal(root, to);
  const stat = await statOrNull(src);
  if (!stat) throw new HttpError(404, 'Item not found');
  if (stat.isFile() && (!hasManagedExtension(from) || !hasManagedExtension(to))) {
    throw new HttpError(403, 'This file type cannot be renamed from the studio');
  }
  if (!stat.isFile() && !stat.isDirectory()) throw new HttpError(403, 'Unsupported item');
  if (await statOrNull(dst)) throw new HttpError(409, 'An item with that name already exists');
  await fs.rename(src, dst);
  return { ok: true, path: toProjectPath(await fs.realpath(root), dst) };
}

/** POST /api/folder, /api/delete, /api/rename */
export function registerManage(router, config) {
  router.post('/api/folder', async ({ json }) => createFolder(config.project, (await json()).path));
  router.post('/api/delete', async ({ json }) => deleteItem(config.project, (await json()).path));
  router.post('/api/rename', async ({ json }) => {
    const body = await json();
    return renameItem(config.project, body.from, body.to);
  });
}
