import { HttpError } from '../http.js';
import { Worker } from 'node:worker_threads';
import { serializeMesh, validateMesh } from '../../../shared/scene-format.js';
import { PARSE_ERRORS } from './converters.js';
import { JobCancelled, checkCancelled } from '../job-manager.js';
import { maybeAsync } from './jobs.js';
import { writeProjectFile } from './scenes.js';

/**
 * Accepted source formats and how their bytes arrive in a JSON upload.
 * Conversion itself runs in a worker thread (import-worker.js); only these
 * formats can be imported and nothing else in an upload is interpreted.
 */
export const IMPORTERS = {
  obj: { encoding: 'utf8' },
  gltf: { encoding: 'utf8' },
  glb: { encoding: 'base64' },
};

const SAFE_NAME = /[^A-Za-z0-9 _.-]/g;

/** Reduce an uploaded file name to a safe base name without extension. */
export function safeBaseName(name) {
  if (typeof name !== 'string') throw new HttpError(400, 'name is required');
  const last = name.split(/[\\/]/).pop();
  const base = last.replace(/\.[^.]*$/, '').replace(SAFE_NAME, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 64);
  if (!base) throw new HttpError(400, 'name is not usable as a file name');
  return base;
}

function decodeUpload(body, importer) {
  if (typeof body.data !== 'string') throw new HttpError(400, 'data must be a string');
  if (body.encoding === 'base64') return Buffer.from(body.data, 'base64');
  if (importer.encoding !== 'utf8') throw new HttpError(400, 'This format must be uploaded as base64');
  return Buffer.from(body.data, 'utf8');
}

/**
 * Convert an uploaded asset into .voxmesh files under Assets/Models.
 * The heavy parsing runs here, on the user's machine, instead of in the
 * browser tab.
 */
/** Convert bytes in a worker thread, reporting progress; aborts on cancel. */
export function convertInWorker(format, buffer, baseName, { progress = () => {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = new Uint8Array(buffer).slice();
    const worker = new Worker(new URL('./import-worker.js', import.meta.url), {
      workerData: { format, bytes, baseName },
      transferList: [bytes.buffer],
    });
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      fn(value);
    };
    const onAbort = () => done(reject, new JobCancelled());
    signal?.addEventListener('abort', onAbort);
    worker.on('message', (msg) => {
      if (msg.type === 'progress') progress(msg.fraction);
      else if (msg.type === 'result') done(resolve, msg.result);
      else if (msg.type === 'error') {
        done(reject, PARSE_ERRORS.has(msg.name)
          ? new HttpError(422, `Could not import ${format.toUpperCase()}: ${msg.message}`)
          : new HttpError(500, 'Import failed'));
      }
    });
    worker.on('error', () => done(reject, new HttpError(500, 'Import failed')));
    worker.on('exit', () => done(reject, new HttpError(500, 'Import worker stopped unexpectedly')));
  });
}

/**
 * Convert an uploaded asset into .voxmesh files under Assets/Models.
 * The heavy parsing runs here, on the user's machine, instead of in the
 * browser tab.
 */
export async function importAsset(root, body, { progress = () => {}, signal, readUpload } = {}) {
  const format = String(body.format || '').toLowerCase();
  const importer = IMPORTERS[format];
  if (!importer) throw new HttpError(400, `Unsupported format "${format}"`);
  const base = safeBaseName(body.name);
  const buffer = body.uploadId !== undefined && readUpload ? await readUpload(body.uploadId) : decodeUpload(body, importer);
  progress(0.02, 'Parsing');
  const result = await convertInWorker(format, buffer, base, { progress: (f) => progress(0.05 + f * 0.75, 'Parsing'), signal });
  checkCancelled(signal);

  const single = result.meshes.length === 1;
  const written = [];
  for (let i = 0; i < result.meshes.length; i++) {
    checkCancelled(signal);
    progress(0.8 + (0.2 * i) / result.meshes.length, 'Writing meshes');
    const mesh = validateMesh(result.meshes[i]);
    const meshName = safeBaseName(`${mesh.name || base}_${i}.x`);
    const rel = single ? `Assets/Models/${base}.voxmesh` : `Assets/Models/${base}/${meshName}.voxmesh`;
    const savedPath = await writeProjectFile(root, rel, serializeMesh(mesh));
    written.push({ path: savedPath, mesh, ...(result.meshes[i].extra || {}) });
  }
  return { ok: true, name: base, format, meshes: written, nodes: result.nodes || null };
}

/** POST /api/assets/import ({ async: true } runs it as a background job) */
export function registerAssets(router, config) {
  router.post('/api/assets/import', async ({ json }) => {
    const body = await json();
    return maybeAsync(config, body, 'import', `Import ${String(body.name || '').slice(0, 64)}`, (ctx) =>
      importAsset(config.project, body, { ...ctx, readUpload: config.readUpload }),
    );
  });
}
