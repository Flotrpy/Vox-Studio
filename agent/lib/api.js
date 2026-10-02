import { Router } from './router.js';
import { registerHealth } from './jobs/health.js';
import { registerSystem } from './jobs/system.js';

/**
 * Build the API router. This list is the complete set of jobs the agent
 * can run; there is deliberately no generic command or eval endpoint.
 */
export function createApi(config) {
  const router = new Router();
  registerHealth(router, config);
  registerSystem(router, config);
  return router;
}
