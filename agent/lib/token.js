import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/** Header the studio uses to send the pairing token. */
export const TOKEN_HEADER = 'x-vox-token';

/** Create a fresh pairing token (32 random bytes, base64url). */
export function createToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Compare a presented token with the expected one in constant time.
 * Both values are hashed first so differing lengths do not leak timing.
 */
export function tokenMatches(expected, presented) {
  if (typeof expected !== 'string' || typeof presented !== 'string') return false;
  if (presented.length === 0 || presented.length > 256) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(presented).digest();
  return timingSafeEqual(a, b);
}
