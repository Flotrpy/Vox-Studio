import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { HttpError } from '../http.js';
import { REPO_ROOT, VERSION } from '../version.js';
import { resolveReal } from '../paths.js';
import { writeProjectFile, readProjectText } from './scenes.js';
import { normalizeScene, parseScene, SceneFormatError, SCENE_EXTENSION } from '../../../shared/scene-format.js';
import { checkCancelled } from '../job-manager.js';
import { maybeAsync } from './jobs.js';

/**
 * Modules embedded into every build. Each becomes a data: URL in the
 * page's import map, so play.html runs from disk with no server.
 */
export const PLAYER_MODULES = {
  three: 'studio/vendor/three/three.module.min.js',
  'vox/viewport/scene-builder.js': 'studio/js/viewport/scene-builder.js',
  'vox/play/physics.js': 'studio/js/play/physics.js',
  'vox/play/scripting.js': 'studio/js/play/scripting.js',
  'vox/play/runtime.js': 'studio/js/play/runtime.js',
  'vox/play/player.js': 'studio/js/play/player.js',
};

const TICKET_TTL_MS = 60_000;
const tickets = new Map();

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** JSON that is safe inside a <script> element. */
export function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function safeFolderName(name) {
  const clean = String(name || '').replace(/[^A-Za-z0-9 _-]/g, '_').trim().slice(0, 64);
  return clean || 'Game';
}

/** Produce the standalone play.html text for a validated scene. */
export async function buildPlayerHtml(scene, title, { progress = () => {}, signal } = {}) {
  const imports = {};
  const modules = Object.entries(PLAYER_MODULES);
  for (const [i, [specifier, file]] of modules.entries()) {
    checkCancelled(signal);
    progress(0.1 + (0.7 * i) / modules.length, 'Embedding engine');
    const source = await fs.readFile(path.join(REPO_ROOT, file));
    imports[specifier] = `data:text/javascript;base64,${source.toString('base64')}`;
  }
  const template = await fs.readFile(path.join(REPO_ROOT, 'agent', 'templates', 'play.html'), 'utf8');
  const values = {
    TITLE: escapeHtml(title),
    GENERATOR: `Vox Studio ${VERSION}`,
    IMPORTMAP: scriptSafeJson({ imports }),
    SCENE_JSON: scriptSafeJson(scene),
  };
  // A replacer function keeps "$" sequences in the data literal.
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => (key in values ? values[key] : match));
}

/**
 * Export a scene (given inline, or by project path) to
 * Builds/<Name>/play.html inside the project.
 */
export async function exportBuild(root, body, ctx = {}) {
  let scene;
  try {
    if (body.scenePath !== undefined) {
      if (typeof body.scenePath !== 'string' || !body.scenePath.endsWith(SCENE_EXTENSION)) {
        throw new HttpError(400, `scenePath must end with ${SCENE_EXTENSION}`);
      }
      scene = parseScene(await readProjectText(root, body.scenePath));
    } else {
      scene = normalizeScene(body.scene);
    }
  } catch (err) {
    if (err instanceof SceneFormatError) throw new HttpError(422, `Invalid scene: ${err.message}`);
    throw err;
  }
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 128) : scene.name;
  const folder = safeFolderName(body.folder || scene.name);
  const html = await buildPlayerHtml(scene, title, ctx);
  checkCancelled(ctx.signal);
  ctx.progress?.(0.9, 'Writing play.html');
  const saved = await writeProjectFile(root, `Builds/${folder}/play.html`, html);
  return { ok: true, path: saved, bytes: Buffer.byteLength(html), entities: scene.entities.length };
}

/** Issue a short-lived, single-use ticket to open a build in the browser. */
export async function createTicket(root, relPath) {
  if (typeof relPath !== 'string' || !/^Builds\/[^/]+\/play\.html$/.test(relPath)) {
    throw new HttpError(400, 'path must be Builds/<name>/play.html');
  }
  const file = await resolveReal(root, relPath);
  try {
    await fs.access(file);
  } catch {
    throw new HttpError(404, 'Build not found');
  }
  const now = Date.now();
  for (const [key, t] of tickets) if (t.expires < now) tickets.delete(key);
  const ticket = randomBytes(24).toString('base64url');
  tickets.set(ticket, { file, expires: now + TICKET_TTL_MS });
  return { ok: true, url: `/play/${ticket}` };
}

/** Consume a ticket. Returns the build file path or null. */
export function redeemTicket(ticket) {
  const entry = tickets.get(ticket);
  if (!entry) return null;
  tickets.delete(ticket);
  return entry.expires >= Date.now() ? entry.file : null;
}

/** POST /api/export, POST /api/build/ticket */
export function registerExport(router, config) {
  router.post('/api/export', async ({ json }) => {
    const body = await json();
    return maybeAsync(config, body, 'export', 'Build', (ctx) => exportBuild(config.project, body, ctx));
  });
  router.post('/api/build/ticket', async ({ json }) => createTicket(config.project, (await json()).path));
}
