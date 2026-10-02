import os from 'node:os';

/** Snapshot of this machine's memory and CPU, for the studio's Agent panel. */
export function systemInfo() {
  const cpus = os.cpus();
  const mem = process.memoryUsage();
  return {
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    node: process.versions.node,
    uptimeSeconds: Math.round(os.uptime()),
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      agentRss: mem.rss,
      agentHeapUsed: mem.heapUsed,
    },
    cpu: {
      model: cpus[0]?.model?.trim() || 'Unknown',
      cores: cpus.length,
      speedMHz: cpus[0]?.speed || 0,
      loadAverage: os.loadavg(),
    },
  };
}

/** GET /api/system */
export function registerSystem(router) {
  router.get('/api/system', () => systemInfo());
}
