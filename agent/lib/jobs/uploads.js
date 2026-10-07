import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { HttpError, readBody } from '../http.js';
import { uploadsDir } from '../project.js';

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

  async dir(project) {
    try {
      return await uploadsDir(project);
    } catch {
      throw new HttpError(403, 'The project .vox folder must be a plain folder');
    }
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
    // Everything about this upload belongs to the project open right now,
    // even if another tab switches while the file is being created.
    const project = this.config.project;
    await this.cleanup();
    const size = Number(body?.size);
    if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'size must be a positive integer');
    if (size > this.config.maxUpload) throw new HttpError(413, `Upload exceeds ${this.config.maxUpload} bytes`);
    // The limit is per project, so uploads left in another one never block this one.
    const inProject = [...this.uploads.values()].filter((u) => u.project === project).length;
    if (inProject >= 8) throw new HttpError(429, 'Too many uploads in progress');
    const id = randomBytes(18).toString('base64url');
    const dir = await this.dir(project);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${id}.part`);
    await fs.writeFile(file, Buffer.alloc(0), { flag: 'wx' });
    this.uploads.set(id, { id, file, project, size, received: 0, complete: false, expires: Date.now() + EXPIRE_MS });
    if (this.config.project !== project) {
      this.uploads.delete(id);
      await fs.rm(file, { force: true });
      throw new HttpError(409, 'The agent switched to another project', { code: 'project-changed' });
    }
    return { uploadId: id, chunkSize: 4 * 1024 * 1024 };
  }

  get(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new HttpError(400, 'Invalid upload id');
    const u = this.uploads.get(id);
    if (!u) throw new HttpError(404, 'Unknown or expired upload');
    // An upload belongs to the project it started in; after a switch it can
    // no longer be continued or imported into the new one.
    if (u.project !== this.config.project) {
      throw new HttpError(409, 'The agent switched to another project', { code: 'project-changed' });
    }
    return u;
  }

  async chunk(req, query) {
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/octet-stream') throw new HttpError(415, 'Content-Type must be application/octet-stream');
    const u = this.get(query.get('id'));
    if (u.complete) throw new HttpError(409, 'Upload already finished');
    const offset = Number(query.get('offset'));
    if (offset !== u.received) throw new HttpError(409, `Expected offset ${u.received}`);
    // One chunk at a time: a retried request must not append twice.
    if (u.busy) throw new HttpError(409, 'A chunk for this upload is still being written');
    u.busy = true;
    try {
      const data = await readBody(req, Math.min(CHUNK_MAX, u.size - u.received));
      if (data.length === 0) throw new HttpError(400, 'Empty chunk');
      // The project may have switched while the body was arriving.
      this.get(u.id);
      await fs.appendFile(u.file, data);
      u.received += data.length;
      // Cancelled while this chunk was being written: drop what it recreated.
      if (!this.uploads.has(u.id)) await fs.rm(u.file, { force: true });
    } finally {
      u.busy = false;
    }
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
    const id = body?.id;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new HttpError(400, 'Invalid upload id');
    const u = this.uploads.get(id);
    if (!u) throw new HttpError(404, 'Unknown or expired upload');
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
