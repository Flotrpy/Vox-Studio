import { createToken } from './token.js';
import { readUserJson, writeUserJson } from './user-config.js';

const FILE = 'pairing.json';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Pairing token for this run. By default the token is kept in the user's
 * config folder (file mode 0600) so a browser that paired once can come back
 * to http://127.0.0.1:<port>/ after the agent restarts. `rotate` issues a
 * new one; `persist: false` keeps the 1.0 behavior (new token every run).
 */
export async function loadPairingToken(dir, { persist = true, rotate = false } = {}) {
  if (!persist) return { token: createToken(), persistent: false, rotated: true };
  const stored = await readUserJson(dir, FILE, {});
  if (!rotate && typeof stored.token === 'string' && TOKEN_PATTERN.test(stored.token)) {
    return { token: stored.token, persistent: true, rotated: false };
  }
  const token = createToken();
  await writeUserJson(dir, FILE, { token, created: new Date().toISOString() });
  return { token, persistent: true, rotated: true };
}
