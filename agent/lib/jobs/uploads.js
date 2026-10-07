import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { HttpError, readBody } from '../http.js';

/** Largest single chunk (the client sends 4 MB chunks). */
export const CHUNK_MAX = 8 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const EXPIRE_MS = 60 * 60 * 1000;

/**
 * Chunked uploads for files larger than the JSON body cap. Data goes to
 * <project>/.vox/uploads/<random id>.part; the client never chooses a file
 * name or location. An upload is read once (by an import) and then deleted.
 */
export class UploadStore {
  constructor(config) {
    this.config = config;
    this.uploads = new Map();
  }

  dir() {
    return path.join(this.config.project, '.vox', 'uploads');
  }

  async cleanup() {
    const now = Date.now();
    for (const [id, u] of this.uploads) {
      if (u.expires < now) {
        this.uploads.delete(id);
        await fs.rm(u.file, { force: true });
      }
    }
  }

  async start(body) {
    await this.cleanup();
    const size = Number(body?.size);
    if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'size must be a positive integer');
    if (size > this.config.maxUpload) throw new HttpError(413, `Upload exceeds ${this.config.maxUpload} bytes`);
    if (this.uploads.size >= 8) throw new HttpError(429, 'Too many uploads in progress');
    const id = randomBytes(18).toString('base64url');
    await fs.mkdir(this.dir(), { recursive: true });
    const file = path.join(this.dir(), `${id}.part`);
    await fs.writeFile(file, Buffer.alloc(0), { flag: 'wx' });
    this.uploads.set(id, { id, file, size, received: 0, complete: false, expires: Date.now() + EXPIRE_MS });
    return { uploadId: id, chunkSize: 4 * 1024 * 1024 };
  }

  get(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new HttpError(400, 'Invalid upload id');
    const u = this.uploads.get(id);
    if (!u) throw new HttpError(404, 'Unknown or expired upload');
    return u;
  }

  async chunk(req, query) {
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/octet-stream') throw new HttpError(415, 'Content-Type must be application/octet-stream');
    const u = this.get(query.get('id'));
    if (u.complete) throw new HttpError(409, 'Upload already finished');
    const offset = Number(query.get('offset'));
    if (offset !== u.received) throw new HttpError(409, `Expected offset ${u.received}`);
    const data = await readBody(req, Math.min(CHUNK_MAX, u.size - u.received));
    if (data.length === 0) throw new HttpError(400, 'Empty chunk');
    await fs.appendFile(u.file, data);
    u.received += data.length;
    u.expires = Date.now() + EXPIRE_MS;
    return { received: u.received, size: u.size };
  }

  finish(body) {
    const u = this.get(body?.id);
    if (u.received !== u.size) throw new HttpError(409, `Upload incomplete (${u.received} of ${u.size} bytes)`);
    u.complete = true;
    return { ok: true, uploadId: u.id, size: u.size };
  }

  /** Read a finished upload once and delete it. */
  async take(id) {
    const u = this.get(id);
    if (!u.complete) throw new HttpError(409, 'Upload not finished');
    this.uploads.delete(id);
    try {
      return await fs.readFile(u.file);
    } finally {
      await fs.rm(u.file, { force: true });
    }
  }

  async cancel(body) {
    const u = this.get(body?.id);
    this.uploads.delete(u.id);
    await fs.rm(u.file, { force: true });
    return { ok: true };
  }
}

/** POST /api/uploads/start, /api/uploads/chunk?id=&offset=, /api/uploads/finish, /api/uploads/cancel */
export function registerUploads(router, config) {
  const store = new UploadStore(config);
  config.readUpload = (id) => store.take(id);
  router.post('/api/uploads/start', async ({ json }) => store.start(await json()));
  router.post('/api/uploads/chunk', ({ req, query }) => store.chunk(req, query));
  router.post('/api/uploads/finish', async ({ json }) => store.finish(await json()));
  router.post('/api/uploads/cancel', async ({ json }) => store.cancel(await json()));
}
