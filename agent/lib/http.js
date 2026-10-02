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

/**
 * Read a request body, refusing anything above `limit` bytes. The declared
 * Content-Length is checked up front; the actual byte count is enforced
 * while streaming so a lying client cannot exceed the cap.
 */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, `Request body exceeds ${limit} bytes`));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        reject(new HttpError(413, `Request body exceeds ${limit} bytes`));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

/**
 * Parse a JSON request body. Only JSON.parse is used (request data is
 * never evaluated) and prototype-polluting keys are dropped.
 */
export async function readJson(req, limit) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const buffer = await readBody(req, limit);
  if (buffer.length === 0) throw new HttpError(400, 'Request body is empty');
  try {
    return JSON.parse(buffer.toString('utf8'), (key, value) =>
      key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value,
    );
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}
