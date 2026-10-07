/** GET /api/jobs, GET /api/job?id=, POST /api/jobs/cancel { id } */
export function registerJobs(router, config) {
  router.get('/api/jobs', () => ({ jobs: config.jobs.list() }));
  router.get('/api/job', ({ query }) => config.jobs.get(query.get('id')));
  router.post('/api/jobs/cancel', async ({ json }) => config.jobs.cancel((await json()).id));
}

/**
 * Run `fn` as a background job when the request asks for `async: true`,
 * otherwise inline. Returns what the route should respond with.
 */
export function maybeAsync(config, body, kind, label, fn) {
  if (body && body.async === true) return config.jobs.start(kind, label, fn);
  return fn({ progress: () => {}, signal: undefined });
}
