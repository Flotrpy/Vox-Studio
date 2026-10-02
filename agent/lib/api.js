import { Router } from './router.js';
import { registerHealth } from './jobs/health.js';
import { registerSystem } from './jobs/system.js';
import { registerFiles } from './jobs/files.js';
import { registerScenes } from './jobs/scenes.js';
import { registerAssets } from './jobs/assets.js';

/**
 * Build the API router. This list is the complete set of jobs the agent
 * can run; there is deliberately no generic command or eval endpoint.
 */
export function createApi(config) {
  const router = new Router();
  registerHealth(router, config);
  registerSystem(router, config);
  registerFiles(router, config);
  registerScenes(router, config);
  registerAssets(router, config);
  return router;
}
