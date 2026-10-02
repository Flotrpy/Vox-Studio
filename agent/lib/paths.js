import path from 'node:path';
import fs from 'node:fs/promises';
import { HttpError } from './http.js';

const MAX_PATH_LENGTH = 512;
// Characters that are invalid or dangerous in file names on at least one OS.
const FORBIDDEN_CHARS = /[\u0000-\u001f<>:"|?*]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Validate a project-relative path coming from a request and turn it into
 * an absolute path inside `root`. Throws HttpError(400) for anything that
 * looks like an attempt to leave the project folder.
 *
 * Accepted: "Assets/Scenes/Main.voxscene", "Assets", "" (the root itself).
 * Rejected: absolute paths, drive letters, UNC paths, ".." segments,
 * backslashes, control characters and reserved device names.
 */
export function resolveInside(root, relPath) {
  if (relPath === undefined || relPath === null) relPath = '';
  if (typeof relPath !== 'string') throw new HttpError(400, 'Path must be a string');
  if (relPath.length > MAX_PATH_LENGTH) throw new HttpError(400, 'Path is too long');
  if (relPath.includes('\\')) throw new HttpError(400, 'Use forward slashes in paths');
  if (relPath.startsWith('/') || /^[a-zA-Z]:/.test(relPath)) {
    throw new HttpError(400, 'Absolute paths are not allowed');
  }

  const segments = relPath.split('/').filter((s) => s.length > 0 && s !== '.');
  for (const segment of segments) {
    if (segment === '..') throw new HttpError(400, 'Parent directory segments are not allowed');
    if (FORBIDDEN_CHARS.test(segment)) throw new HttpError(400, 'Path contains invalid characters');
    if (WINDOWS_RESERVED.test(segment)) throw new HttpError(400, 'Path uses a reserved name');
    if (segment.endsWith(' ') || segment.endsWith('.')) {
      throw new HttpError(400, 'Path segments may not end with a space or dot');
    }
  }

  const absRoot = path.resolve(root);
  const target = path.resolve(absRoot, ...segments);
  if (!isWithin(absRoot, target)) throw new HttpError(400, 'Path escapes the project folder');
  return target;
}

/** True when `target` equals `root` or lies below it. */
export function isWithin(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Convert an absolute path inside root back to a forward-slash relative path. */
export function toProjectPath(root, absPath) {
  return path.relative(path.resolve(root), absPath).split(path.sep).join('/');
}
