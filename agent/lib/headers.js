import { createHash } from 'node:crypto';

/** Headers added to every response from the agent. */
export const BASE_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

/** SHA-256 CSP source expressions for every inline <script> in an HTML page. */
export function inlineScriptHashes(html) {
  const hashes = [];
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const digest = createHash('sha256').update(match[1], 'utf8').digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

/**
 * Content-Security-Policy for studio pages. Inline scripts are allowed
 * only by hash (the import map). 'unsafe-eval' is needed because play
 * mode compiles the user's own Script components in the browser; the
 * agent itself never evaluates anything.
 */
export function studioCsp(html) {
  const scripts = ["'self'", "'unsafe-eval'", ...inlineScriptHashes(html)].join(' ');
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Extra headers for a static file, adding a CSP to HTML documents. */
export function staticHeaders(file, data) {
  if (!file.endsWith('.html')) return {};
  return { 'Content-Security-Policy': studioCsp(data.toString('utf8')) };
}
