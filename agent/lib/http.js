/** Error carrying an HTTP status code. Messages are safe to show to clients. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const NO_STORE = 'no-store';

/** Send a JSON body. API responses are never cached. */
export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': NO_STORE,
  });
  res.end(payload);
}

/** Send an error as JSON: { error: { status, message } }. */
export function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof HttpError ? err.message : 'Internal error';
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = { error: { status, message } };
  if (err instanceof HttpError && err.details) body.error.details = err.details;
  sendJson(res, status, body);
}
