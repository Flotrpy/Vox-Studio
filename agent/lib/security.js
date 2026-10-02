import { HttpError } from './http.js';
import { TOKEN_HEADER, tokenMatches } from './token.js';

/** The only interface the agent ever binds to. */
export const BIND_ADDRESS = '127.0.0.1';

/** Host header values accepted for a given port (DNS rebinding defense). */
export function allowedHosts(port) {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

/** Origins allowed to call the API: the studio served by this agent. */
export function allowedOrigins(port) {
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

/**
 * Reject requests whose Host header is not the loopback address we serve.
 * A DNS-rebinding page would send its own host name here.
 */
export function checkHost(req, port) {
  const host = (req.headers.host || '').toLowerCase();
  if (!allowedHosts(port).has(host)) {
    throw new HttpError(403, 'Host not allowed');
  }
}

/**
 * Reject cross-origin browser requests. Browsers always send Origin on
 * cross-origin fetches and on same-origin POSTs; a request with no Origin
 * comes from a same-origin GET or a non-browser client, which still needs
 * the token to reach the API.
 */
export function checkOrigin(req, port) {
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedOrigins(port).has(origin.toLowerCase())) {
    throw new HttpError(403, 'Origin not allowed');
  }
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    throw new HttpError(403, 'Cross-site request rejected');
  }
}

/** Require the pairing token on API requests. */
export function checkToken(req, expected) {
  const presented = req.headers[TOKEN_HEADER];
  if (typeof presented !== 'string' || !tokenMatches(expected, presented)) {
    throw new HttpError(401, 'Missing or invalid pairing token');
  }
}
