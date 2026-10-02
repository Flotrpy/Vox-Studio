import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http.js';
import { resolveInside } from './paths.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/**
 * Serve read-only files from fixed folders. `mounts` maps a URL prefix
 * ("/", "/shared/") to a directory. Only known file types are served and
 * the path guard keeps every lookup inside its mount.
 */
export function createStaticHandler(mounts, extraHeaders = () => ({})) {
  const ordered = Object.entries(mounts).sort((a, b) => b[0].length - a[0].length);

  return async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, 'Method not allowed');
    }
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, 'Malformed URL');
    }
    const mount = ordered.find(([prefix]) => decoded.startsWith(prefix));
    if (!mount) throw new HttpError(404, 'Not found');
    const [prefix, dir] = mount;

    let rel = decoded.slice(prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';

    const file = resolveInside(dir, rel);
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type) throw new HttpError(404, 'Not found');

    let data;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw new HttpError(404, 'Not found');
      data = await fs.readFile(file);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(404, 'Not found');
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      ...extraHeaders(file, data),
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  };
}
