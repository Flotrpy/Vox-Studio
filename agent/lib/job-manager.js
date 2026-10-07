import { randomBytes } from 'node:crypto';
import { HttpError } from './http.js';

const KEEP_FINISHED = 50;
const PROGRESS_INTERVAL_MS = 100;
/** How long a finished job keeps its result (an import's can be large). */
export const RESULT_TTL_MS = 60_000;

export class JobCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'JobCancelled';
  }
}

/**
 * Background jobs with progress and cancellation. A job function receives
 * { progress(fraction, message), signal } and returns a result. Updates go
 * to studio tabs as 'job' events.
 */
export class JobManager {
  constructor(events) {
    this.events = events;
    this.jobs = new Map();
  }

  publicView(job) {
    const { controller, lastSent, ...rest } = job;
    return rest;
  }

  send(job, force = false) {
    const now = Date.now();
    if (!force && now - job.lastSent < PROGRESS_INTERVAL_MS) return;
    job.lastSent = now;
    this.events?.broadcast('job', this.publicView(job));
  }

  start(kind, label, run) {
    const id = randomBytes(9).toString('base64url');
    const controller = new AbortController();
    const job = { id, kind, label, state: 'running', progress: 0, message: '', result: null, error: null, started: Date.now(), finished: null, controller, lastSent: 0 };
    this.jobs.set(id, job);
    this.send(job, true);
    const progress = (fraction, message) => {
      if (job.state !== 'running') return;
      job.progress = Math.max(0, Math.min(1, Number(fraction) || 0));
      if (message !== undefined) job.message = String(message).slice(0, 200);
      this.send(job);
    };
    Promise.resolve()
      .then(() => run({ progress, signal: controller.signal }))
      .then(
        (result) => {
          if (job.state !== 'running') return;
          Object.assign(job, { state: 'done', progress: 1, result });
        },
        (err) => {
          if (job.state !== 'running') return;
          if (err instanceof JobCancelled || controller.signal.aborted) job.state = 'cancelled';
          else {
            job.state = 'failed';
            job.error = { status: err instanceof HttpError ? err.status : 500, message: err instanceof HttpError ? err.message : 'Internal error' };
            if (!(err instanceof HttpError)) console.error(err);
          }
        },
      )
      .finally(() => {
        job.finished = Date.now();
        this.send(job, true);
        // The studio picks the result up from this event or one poll; do not
        // keep model data alive for every finished job.
        if (job.result !== null) {
          setTimeout(() => {
            job.result = null;
            job.resultExpired = true;
          }, RESULT_TTL_MS).unref?.();
        }
        this.prune();
      });
    return { jobId: id };
  }

  prune() {
    const finished = [...this.jobs.values()].filter((j) => j.state !== 'running');
    for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) this.jobs.delete(j.id);
  }

  get(id) {
    const job = typeof id === 'string' ? this.jobs.get(id) : null;
    if (!job) throw new HttpError(404, 'Unknown job');
    return this.publicView(job);
  }

  /** Job metadata only; fetch one job for its result. */
  list() {
    return [...this.jobs.values()].map((j) => {
      const { result, ...rest } = this.publicView(j);
      return rest;
    });
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, 'Unknown job');
    if (job.state === 'running') {
      job.controller.abort();
      job.state = 'cancelled';
      job.finished = Date.now();
      this.send(job, true);
    }
    return this.publicView(job);
  }
}

/** Throw if the job was cancelled; call between steps of long jobs. */
export function checkCancelled(signal) {
  if (signal?.aborted) throw new JobCancelled();
}
