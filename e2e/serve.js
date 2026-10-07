// Starts a Vox Agent for browser tests: fixed port, known token and a fresh
// project folder in the OS temp directory.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentServer } from '../agent/lib/server.js';
import { ensureProject } from '../agent/lib/project.js';

export const E2E_PORT = Number(process.env.VOX_E2E_PORT || 8797);
export { E2E_TOKEN } from './token.js';
import { E2E_TOKEN } from './token.js';

// Projects created by tests land next to this one, inside the temp root.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-e2e-'));
const project = path.join(root, 'Project');
await ensureProject(project);
const agent = createAgentServer({ port: E2E_PORT, project, projectsRoot: root, token: E2E_TOKEN, maxBody: 16 * 1024 * 1024 });
await agent.listen();
process.stdout.write(`Vox e2e agent on ${E2E_PORT}, project ${project}\n`);

const stop = async () => {
  await agent.close();
  await fs.rm(root, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
