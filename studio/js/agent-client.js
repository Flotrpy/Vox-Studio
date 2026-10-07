// Talks to the Vox Agent. The pairing token arrives in the URL fragment
// (#token=...), is kept in sessionStorage under "vox:token" and removed from
// the address bar, then sent as X-Vox-Token on every API request.

import { Emitter } from './core/events.js';
import { load, save, remove } from './core/storage.js';

export class AgentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const POLL_MS = 5000;
const TIMEOUT_MS = 30000;

export class AgentClient extends Emitter {
  constructor() {
    super();
    this.token = this.readToken();
    this.status = this.token ? 'connecting' : 'unpaired';
    this.info = null;
    // Id of the project this tab has loaded. It changes only when the tab
    // switches or follows a switch (bindProject), never from a health poll,
    // so requests from a tab that missed a switch keep the old id.
    this.projectId = null;
    this.timer = 0;
  }

  readToken() {
    const match = /(?:^#|&)token=([A-Za-z0-9_-]{16,256})/.exec(window.location.hash);
    if (match) {
      save('token', match[1], 'session');
      const url = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', url);
      return match[1];
    }
    // A remembered token (agent runs with a persistent token) lets the
    // studio reconnect without the URL fragment after the agent restarts.
    return load('token', null, 'session') || load('token', null, 'local');
  }

  /** Keep the token across browser restarts only if the agent persists it. */
  rememberToken(persistent) {
    if (persistent) save('token', this.token, 'local');
    else remove('token', 'local');
  }

  projectHeader() {
    return this.projectId ? { 'X-Vox-Project': this.projectId } : {};
  }

  /** Mark the agent's current project as the one this tab has loaded. */
  bindProject(id) {
    this.projectId = id || null;
  }

  get connected() {
    return this.status === 'connected';
  }

  setStatus(status, info = this.info) {
    const changed = status !== this.status;
    this.status = status;
    this.info = info;
    if (changed) this.emit('status', status);
  }

  async request(method, path, body) {
    if (!this.token) throw new AgentError(401, 'Not paired with a Vox Agent');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: {
          'X-Vox-Token': this.token,
          // Lets the agent refuse file requests meant for a project another
          // tab has since switched away from.
          ...this.projectHeader(),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
    } catch (err) {
      this.setStatus('offline');
      throw new AgentError(0, err.name === 'AbortError' ? 'The agent did not answer in time' : 'Vox Agent is not reachable');
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON body (e.g. a static server without the agent).
    }
    if (res.status === 401) {
      this.setStatus('unpaired');
      remove('token', 'session');
      remove('token', 'local');
    }
    if (res.status === 409 && data?.error?.details?.code === 'project-changed') this.emit('project-mismatch');
    if (!res.ok) throw new AgentError(res.status, data?.error?.message || `Request failed (${res.status})`);
    return data;
  }

  get(path) {
    return this.request('GET', path);
  }

  post(path, body) {
    return this.request('POST', path, body);
  }

  async ping() {
    if (!this.token) {
      this.setStatus('unpaired');
      return false;
    }
    try {
      const info = await this.get('/api/health');
      if (this.info?.persistentToken !== info.persistentToken) this.rememberToken(!!info.persistentToken);
      if (!this.projectId) this.bindProject(info.projectId);
      this.setStatus('connected', info);
      this.openEvents();
      // The agent moved to another project without this tab following
      // (a missed event, or an agent restarted on another folder).
      if (info.projectId && info.projectId !== this.projectId) this.emit('project-mismatch');
      return true;
    } catch (err) {
      if (err.status !== 401) this.setStatus('offline');
      return false;
    }
  }

  /**
   * Keep an authenticated event stream open and emit 'event' for each
   * server-sent event ({ type, data }). Reconnects after drops.
   */
  async openEvents() {
    if (this.streaming || !this.token) return;
    this.streaming = true;
    try {
      const res = await fetch('/api/events', { headers: { 'X-Vox-Token': this.token }, cache: 'no-store', credentials: 'omit' });
      if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let i;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const type = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (!type || data === undefined) continue;
          try {
            this.emit('event', { type, data: JSON.parse(data) });
          } catch {
            // Ignore malformed events.
          }
        }
      }
    } catch {
      // Agent stopped or stream refused; the health poll reports status.
    } finally {
      this.streaming = false;
      if (this.connected) setTimeout(() => this.openEvents(), 2000);
    }
  }

  /**
   * Start a background job ({ async: true }) and resolve with its result.
   * Progress comes from 'job' events (or polling if the stream is down).
   * Returns { promise, cancel }.
   */
  runJob(path, body, onProgress = () => {}) {
    let jobId = null;
    let cancelled = false;
    const promise = (async () => {
      const { jobId: id } = await this.post(path, { ...body, async: true });
      jobId = id;
      if (cancelled) await this.post('/api/jobs/cancel', { id });
      return new Promise((resolve, reject) => {
        let timer = 0;
        const finish = (job) => {
          off();
          clearInterval(timer);
          if (job.state === 'done') resolve(job.result);
          else if (job.state === 'cancelled') reject(new AgentError(499, 'Cancelled'));
          else reject(new AgentError(job.error?.status || 500, job.error?.message || 'Job failed'));
        };
        const handle = (job) => {
          if (job.id !== id) return;
          onProgress(job);
          if (job.state !== 'running') finish(job);
        };
        const off = this.on('event', ({ type, data }) => type === 'job' && handle(data));
        // Polling backs up the event stream (and catches missed events).
        timer = setInterval(async () => {
          try {
            handle(await this.get(`/api/job?id=${encodeURIComponent(id)}`));
          } catch (err) {
            off();
            clearInterval(timer);
            reject(err);
          }
        }, 1000);
      });
    })();
    return {
      promise,
      cancel: () => {
        cancelled = true;
        if (jobId) this.post('/api/jobs/cancel', { id: jobId }).catch(() => {});
      },
    };
  }

  /** Upload bytes in chunks; resolves with the upload id. */
  async upload(bytes, onProgress = () => {}) {
    const { uploadId, chunkSize } = await this.post('/api/uploads/start', { size: bytes.byteLength });
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize));
      const res = await fetch(`/api/uploads/chunk?id=${uploadId}&offset=${offset}`, {
        method: 'POST',
        headers: { 'X-Vox-Token': this.token, ...this.projectHeader(), 'Content-Type': 'application/octet-stream' },
        body: chunk,
        credentials: 'omit',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new AgentError(res.status, data?.error?.message || 'Upload failed');
      }
      onProgress((offset + chunk.byteLength) / bytes.byteLength);
    }
    await this.post('/api/uploads/finish', { id: uploadId });
    return uploadId;
  }

  startPolling() {
    clearInterval(this.timer);
    this.ping();
    this.timer = setInterval(() => this.ping(), POLL_MS);
  }
}
