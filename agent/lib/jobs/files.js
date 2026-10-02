import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../http.js';
import { resolveReal, toProjectPath } from '../paths.js';

const MAX_ENTRIES = 5000;
const MAX_TREE_DEPTH = 12;

function isHidden(name) {
  return name.startsWith('.');
}

/** List one folder of the project (non-recursive). */
export async function listFolder(root, relDir) {
  const dir = await resolveReal(root, relDir);
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') throw new HttpError(404, 'Folder not found');
    if (err.code === 'ENOTDIR') throw new HttpError(400, 'Not a folder');
    throw err;
  }
  const entries = [];
  for (const d of dirents) {
    if (isHidden(d.name) || d.isSymbolicLink()) continue;
    if (!d.isDirectory() && !d.isFile()) continue;
    if (entries.length >= MAX_ENTRIES) break;
    const abs = path.join(dir, d.name);
    const stat = await fs.stat(abs);
    entries.push({
      name: d.name,
      path: toProjectPath(await fs.realpath(root), abs),
      kind: d.isDirectory() ? 'folder' : 'file',
      ext: d.isDirectory() ? '' : path.extname(d.name).toLowerCase(),
      size: d.isDirectory() ? 0 : stat.size,
      modified: stat.mtimeMs,
    });
  }
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
  return { path: toProjectPath(await fs.realpath(root), dir), entries };
}

/** Folder tree of the whole project, for the Project panel's left pane. */
export async function folderTree(root) {
  const realRoot = await fs.realpath(root);
  let count = 0;
  async function walk(abs, depth) {
    const node = { name: path.basename(abs), path: toProjectPath(realRoot, abs), children: [] };
    if (depth >= MAX_TREE_DEPTH) return node;
    const dirents = await fs.readdir(abs, { withFileTypes: true });
    for (const d of dirents) {
      if (!d.isDirectory() || isHidden(d.name) || d.isSymbolicLink()) continue;
      if (++count > MAX_ENTRIES) break;
      node.children.push(await walk(path.join(abs, d.name), depth + 1));
    }
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    return node;
  }
  const tree = await walk(realRoot, 0);
  tree.name = path.basename(realRoot);
  return tree;
}

/** GET /api/files?dir=..., GET /api/tree */
export function registerFiles(router, config) {
  router.get('/api/files', ({ query }) => listFolder(config.project, query.get('dir') || ''));
  router.get('/api/tree', () => folderTree(config.project));
}
