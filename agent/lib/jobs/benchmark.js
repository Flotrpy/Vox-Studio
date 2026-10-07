import { Worker } from 'node:worker_threads';
import { HttpError } from '../http.js';
import { JobCancelled } from '../job-manager.js';
import { maybeAsync } from './jobs.js';

export const BENCHMARK_KINDS = ['cpu', 'memory'];
const MIN_MS = 100;
const MAX_MS = 5000;

let running = false;

/** Run one of the fixed benchmark workloads in a worker thread. */
export function runBenchmark(kind, durationMs = 1000, { progress = () => {}, signal } = {}) {
  if (!BENCHMARK_KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${BENCHMARK_KINDS.join(', ')}`);
  const duration = Math.min(MAX_MS, Math.max(MIN_MS, Math.round(Number(durationMs) || 1000)));
  if (running) throw new HttpError(409, 'A benchmark is already running');
  running = true;
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./bench-worker.js', import.meta.url), {
      workerData: { kind, durationMs: duration },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const timer = setTimeout(() => worker.terminate(), duration + 10_000);
    const started = Date.now();
    const ticker = setInterval(() => progress(Math.min(0.99, (Date.now() - started) / duration), 'Running'), 100);
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(ticker);
      signal?.removeEventListener('abort', onAbort);
      running = false;
      fn(value);
    };
    const onAbort = () => {
      finish(reject, new JobCancelled());
      worker.terminate();
    };
    signal?.addEventListener('abort', onAbort);
    worker.once('message', (result) => finish(resolve, result));
    worker.once('error', (err) => finish(reject, err));
    worker.once('exit', () => finish(reject, new HttpError(500, 'Benchmark worker stopped unexpectedly')));
  });
}

/** POST /api/benchmark { kind, durationMs } */
export function registerBenchmark(router, config) {
  router.post('/api/benchmark', async ({ json }) => {
    const body = await json();
    if (!BENCHMARK_KINDS.includes(body.kind)) throw new HttpError(400, `kind must be one of ${BENCHMARK_KINDS.join(', ')}`);
    return maybeAsync(config, body, 'benchmark', `${body.kind === 'cpu' ? 'CPU' : 'Memory'} benchmark`, (ctx) =>
      runBenchmark(body.kind, body.durationMs, ctx),
    );
  });
}
