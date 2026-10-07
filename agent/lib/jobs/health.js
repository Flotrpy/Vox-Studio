import path from 'node:path';
import { VERSION } from '../version.js';

/** GET /api/health: lets the studio confirm pairing and show status. */
export function registerHealth(router, config) {
  router.get('/api/health', () => ({
    ok: true,
    agent: 'Vox Agent',
    version: VERSION,
    project: path.basename(config.project),
    persistentToken: config.persistentToken,
  }));
}
