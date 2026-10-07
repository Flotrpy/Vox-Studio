import { HttpError } from './http.js';

/** Returned by a route handler that keeps the response open itself. */
export const STREAMING = Symbol('streaming');

const MAX_CLIENTS = 16;
const HEARTBEAT_MS = 20_000;

/**
 * Server-sent events to paired studio tabs (file changes, job progress).
 * The stream is a normal token-checked API request; the studio reads it with
 * fetch() because EventSource cannot send the token header.
 */
export class EventHub {
  constructor() {
    this.clients = new Set();
    this.timer = setInterval(() => this.write(': keep-alive\n\n'), HEARTBEAT_MS);
    this.timer.unref?.();
  }

  attach(req, res) {
    if (this.clients.size >= MAX_CLIENTS) throw new HttpError(429, 'Too many open event streams');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.clients.add(res);
    const drop = () => this.clients.delete(res);
    req.on('close', drop);
    res.on('error', drop);
    return STREAMING;
  }

  write(text) {
    for (const res of this.clients) res.write(text);
  }

  /** Send one event: `type` and a JSON payload. */
  broadcast(type, data) {
    this.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  close() {
    clearInterval(this.timer);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
