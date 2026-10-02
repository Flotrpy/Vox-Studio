import { HttpError } from './http.js';

/**
 * A tiny exact-match router. Every API route is registered explicitly;
 * there is no wildcard dispatch and no way to reach an unregistered job.
 */
export class Router {
  constructor() {
    this.routes = new Map();
  }

  add(method, pathname, handler) {
    const key = `${method} ${pathname}`;
    if (this.routes.has(key)) throw new Error(`Route registered twice: ${key}`);
    this.routes.set(key, handler);
    return this;
  }

  get(pathname, handler) {
    return this.add('GET', pathname, handler);
  }

  post(pathname, handler) {
    return this.add('POST', pathname, handler);
  }

  /** Find the handler for a request or throw 404/405. */
  match(method, pathname) {
    const handler = this.routes.get(`${method} ${pathname}`);
    if (handler) return handler;
    for (const key of this.routes.keys()) {
      if (key.endsWith(` ${pathname}`)) throw new HttpError(405, 'Method not allowed');
    }
    throw new HttpError(404, 'Unknown API endpoint');
  }
}
