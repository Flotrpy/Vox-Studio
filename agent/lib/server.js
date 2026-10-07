import http from 'node:http';
import path from 'node:path';
import { REPO_ROOT } from './version.js';
import { HttpError, sendError, sendJson, readJson } from './http.js';
import { BASE_HEADERS, staticHeaders } from './headers.js';
import { BIND_ADDRESS, checkHost, checkOrigin, checkToken } from './security.js';
import { createStaticHandler } from './static.js';
import { createApi } from './api.js';
import { redeemTicket } from './jobs/export.js';
import { EventHub, STREAMING } from './events.js';
import { watchProject } from './watcher.js';
import fs from 'node:fs/promises';

const MAX_URL_LENGTH = 4096;

/**
 * Build the agent HTTP server. Nothing is listening until `listen()`.
 *
 * Every request passes the same gate: URL length, Host header, Origin
 * header. API requests additionally need the pairing token and are routed
 * only to explicitly registered jobs.
 */
export function createAgentServer(options) {
  const config = {
    port: options.port,
    project: path.resolve(options.project),
    token: options.token,
    persistentToken: !!options.persistentToken,
    maxBody: options.maxBody,
    maxUpload: options.maxUpload || 512 * 1024 * 1024,
    projectsRoot: path.resolve(options.projectsRoot || path.dirname(path.resolve(options.project))),
    configDir: options.configDir || null,
    studioDir: options.studioDir || path.join(REPO_ROOT, 'studio'),
    sharedDir: options.sharedDir || path.join(REPO_ROOT, 'shared'),
    log: options.log || (() => {}),
  };

  config.events = new EventHub();
  let watcher = null;
  /** (Re)start watching the current project folder. */
  config.watch = () => {
    watcher?.close();
    watcher = watchProject(config.project, (paths) => config.events.broadcast('files', { paths }));
  };
  if (options.watch !== false) config.watch();

  const router = createApi(config);
  const serveStatic = createStaticHandler(
    { '/': config.studioDir, '/shared/': config.sharedDir },
    staticHeaders,
  );

  async function handle(req, res) {
    for (const [name, value] of Object.entries(BASE_HEADERS)) res.setHeader(name, value);

    if ((req.url || '').length > MAX_URL_LENGTH) throw new HttpError(414, 'URL too long');
    checkHost(req, config.port);
    checkOrigin(req, config.port);

    const url = new URL(req.url, `http://127.0.0.1:${config.port}`);
    if (url.pathname.startsWith('/api/')) {
      checkToken(req, config.token);
      const handler = router.match(req.method, url.pathname);
      const ctx = {
        req,
        res,
        query: url.searchParams,
        config,
        json: () => readJson(req, config.maxBody),
      };
      const result = await handler(ctx);
      if (result === STREAMING) return;
      if (!res.writableEnded) sendJson(res, 200, result ?? { ok: true });
      return;
    }
    const ticket = /^\/play\/([A-Za-z0-9_-]{32})$/.exec(url.pathname);
    if (ticket) {
      await servePlay(res, ticket[1]);
      return;
    }
    await serveStatic(req, res, url.pathname);
  }

  /** Serve a build opened with a one-time ticket from /api/build/ticket. */
  async function servePlay(res, ticket) {
    const file = redeemTicket(ticket);
    if (!file) throw new HttpError(404, 'This play link has expired. Use Build And Run again.');
    const html = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': html.length,
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(html);
  }

  const server = http.createServer((req, res) => {
    const started = Date.now();
    res.on('finish', () => {
      config.log({
        method: req.method,
        // Only the path is logged; query strings may carry file names but
        // the token travels in a header and is never written out.
        path: (req.url || '').split('?')[0],
        status: res.statusCode,
        ms: Date.now() - started,
      });
    });
    handle(req, res).catch((err) => {
      if (!(err instanceof HttpError)) console.error(err);
      sendError(res, err);
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 60_000;
  server.maxHeadersCount = 64;

  return {
    server,
    config,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, BIND_ADDRESS, () => {
          server.off('error', reject);
          config.port = server.address().port;
          resolve(config.port);
        });
      });
    },
    close() {
      watcher?.close();
      config.events.close();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
