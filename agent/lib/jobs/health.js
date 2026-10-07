import path from 'node:path';
import { VERSION } from '../version.js';
import { projectId } from './projects.js';

/** GET /api/health: lets the studio confirm pairing and show status. */
export function registerHealth(router, config) {
  router.get('/api/health', () => ({
    ok: true,
    agent: 'Vox Agent',
    version: VERSION,
    project: path.basename(config.project),
    projectId: projectId(config.project),
    persistentToken: config.persistentToken,
  }));
}

/** GET /api/events: server-sent events for file changes and job progress. */
export function registerEvents(router, config) {
  router.get('/api/events', ({ req, res }) => config.events.attach(req, res));
}
