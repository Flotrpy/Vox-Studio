import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HttpError } from '../http.js';
import { ensureProject, SETTINGS_FILE } from '../project.js';
import { readUserJson, writeUserJson } from '../user-config.js';

const RECENT_FILE = 'recent-projects.json';
const MAX_RECENT = 20;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

/** Opaque id for a project path; the studio never sends paths. */
export function projectId(absPath) {
  return createHash('sha256').update(path.resolve(absPath)).digest('hex').slice(0, 16);
}

async function isProject(dir) {
  try {
    await fs.access(path.join(dir, ...SETTINGS_FILE.split('/')));
    return true;
  } catch {
    return false;
  }
}

async function describe(dir, current) {
  let modified = 0;
  try {
    modified = (await fs.stat(dir)).mtimeMs;
  } catch {
    // Listed but unreadable; keep it with no date.
  }
  return { id: projectId(dir), name: path.basename(dir), path: dir, current: path.resolve(dir) === path.resolve(current), modified };
}

/**
 * Projects the studio may switch to: folders under the projects root that
 * contain .vox/ProjectSettings.json, plus projects opened before (recent
 * list kept by the agent in the user config folder). The studio picks one
 * by id; it cannot point the agent at an arbitrary path.
 */
export async function listProjects(config) {
  const dirs = new Set([path.resolve(config.project)]);
  try {
    for (const d of await fs.readdir(config.projectsRoot, { withFileTypes: true })) {
      if (d.isDirectory() && !d.name.startsWith('.')) {
        const full = path.join(config.projectsRoot, d.name);
        if (await isProject(full)) dirs.add(path.resolve(full));
      }
    }
  } catch {
    // Root missing: only recent projects are offered.
  }
  if (config.configDir) {
    const recent = await readUserJson(config.configDir, RECENT_FILE, { projects: [] });
    for (const p of Array.isArray(recent.projects) ? recent.projects : []) {
      if (typeof p === 'string' && path.isAbsolute(p) && (await isProject(p))) dirs.add(path.resolve(p));
    }
  }
  const projects = await Promise.all([...dirs].map((d) => describe(d, config.project)));
  projects.sort((a, b) => Number(b.current) - Number(a.current) || b.modified - a.modified);
  return { root: config.projectsRoot, current: projectId(config.project), projects };
}

export async function rememberProject(config, dir) {
  if (!config.configDir) return;
  const recent = await readUserJson(config.configDir, RECENT_FILE, { projects: [] });
  const list = [path.resolve(dir), ...(recent.projects || []).filter((p) => p !== path.resolve(dir))].slice(0, MAX_RECENT);
  await writeUserJson(config.configDir, RECENT_FILE, { projects: list });
}

async function switchTo(config, dir) {
  await ensureProject(dir);
  config.project = path.resolve(dir);
  config.watch?.();
  await rememberProject(config, dir);
  const info = { id: projectId(dir), name: path.basename(dir) };
  config.events?.broadcast('project', info);
  return { ok: true, ...info };
}

export async function openProject(config, id) {
  if (typeof id !== 'string') throw new HttpError(400, 'id is required');
  const { projects } = await listProjects(config);
  const match = projects.find((p) => p.id === id);
  if (!match) throw new HttpError(404, 'Unknown project');
  return switchTo(config, match.path);
}

export async function createProject(config, name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name.trim())) {
    throw new HttpError(400, 'Project names use letters, digits, spaces, "_" and "-" (up to 64)');
  }
  const dir = path.join(config.projectsRoot, name.trim());
  try {
    await fs.access(dir);
    throw new HttpError(409, 'A folder with that name already exists');
  } catch (err) {
    if (err instanceof HttpError) throw err;
  }
  await fs.mkdir(config.projectsRoot, { recursive: true });
  return switchTo(config, dir);
}

/** GET /api/projects, POST /api/projects/open { id }, POST /api/projects/create { name } */
export function registerProjects(router, config) {
  router.get('/api/projects', () => listProjects(config));
  router.post('/api/projects/open', async ({ json }) => openProject(config, (await json()).id));
  router.post('/api/projects/create', async ({ json }) => createProject(config, (await json()).name));
}
