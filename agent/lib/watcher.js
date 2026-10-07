import fs from 'node:fs';
import path from 'node:path';

const DEBOUNCE_MS = 150;

function ignored(rel) {
  if (!rel) return true;
  const parts = rel.split('/');
  // Hidden folders (.vox) and our own atomic-write temp files.
  return parts.some((p) => p.startsWith('.')) || rel.endsWith('.tmp');
}

/**
 * Watch the project folder and report changed project paths in batches.
 * Uses recursive fs.watch (Node 20+ on Linux, macOS and Windows).
 */
export function watchProject(root, onChange) {
  let pending = new Set();
  let timer = null;
  let watcher;
  try {
    watcher = fs.watch(root, { recursive: true }, (_event, file) => {
      if (!file) return;
      const rel = file.toString().split(path.sep).join('/');
      if (ignored(rel)) return;
      pending.add(rel);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const paths = [...pending].sort();
        pending = new Set();
        onChange(paths);
      }, DEBOUNCE_MS);
    });
  } catch {
    return { close() {}, active: false };
  }
  watcher.on('error', () => {});
  return {
    active: true,
    close() {
      clearTimeout(timer);
      watcher.close();
    },
  };
}
