import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the repository root (the folder holding package.json). */
export const REPO_ROOT = path.resolve(here, '..', '..');

const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

export const VERSION = pkg.version;
export const PRODUCT = 'Vox Agent';
