import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Per-user config folder for the agent (never inside a project). */
export function userConfigDir(env = process.env, platform = process.platform) {
  if (env.VOX_AGENT_HOME) return path.resolve(env.VOX_AGENT_HOME);
  if (platform === 'win32' && env.APPDATA) return path.join(env.APPDATA, 'vox-agent');
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'vox-agent');
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'vox-agent');
}

/** Read a JSON file from the config folder, or `fallback` if missing/corrupt. */
export async function readUserJson(dir, name, fallback) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
    return data && typeof data === 'object' ? data : fallback;
  } catch {
    return fallback;
  }
}

/** Write a JSON file readable only by the current user. */
export async function writeUserJson(dir, name, value) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600).catch(() => {});
}
