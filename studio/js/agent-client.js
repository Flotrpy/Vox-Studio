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
    return load('token', null, 'session');
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
    }
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
      this.setStatus('connected', info);
      return true;
    } catch (err) {
      if (err.status !== 401) this.setStatus('offline');
      return false;
    }
  }

  startPolling() {
    clearInterval(this.timer);
    this.ping();
    this.timer = setInterval(() => this.ping(), POLL_MS);
  }
}
