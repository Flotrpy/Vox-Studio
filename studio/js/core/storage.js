// Browser storage wrapper. Every key is prefixed with "vox:" so Vox Studio
// never collides with other data on the same origin.

const PREFIX = 'vox:';

function area(kind) {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function storageKey(key) {
  return PREFIX + key;
}

export function load(key, fallback = null, kind = 'local') {
  try {
    const raw = area(kind)?.getItem(PREFIX + key);
    return raw === null || raw === undefined ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value, kind = 'local') {
  try {
    area(kind)?.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key, kind = 'local') {
  try {
    area(kind)?.removeItem(PREFIX + key);
  } catch {
    // Storage unavailable; nothing to remove.
  }
}
