import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentServer } from '../../agent/lib/server.js';
import { ensureProject } from '../../agent/lib/project.js';

export const TEST_TOKEN = 'test-token-0123456789abcdefghijklmnopqrstuv';

/**
 * Start an agent on a random port with a throwaway project and studio
 * folder. Returns helpers for raw requests with full header control.
 */
export async function startAgent(t, options = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-agent-'));
  const project = path.join(tmp, 'project');
  const studioDir = path.join(tmp, 'studio');
  await fs.mkdir(studioDir);
  await fs.writeFile(
    path.join(studioDir, 'index.html'),
    '<!doctype html><title>Vox Studio</title><script type="importmap">{"imports":{}}</script>',
  );
  await ensureProject(project);

  const agent = createAgentServer({
    port: 0,
    project,
    token: TEST_TOKEN,
    maxBody: options.maxBody ?? 1024 * 1024,
    studioDir,
  });
  const port = await agent.listen();
  t.after(async () => {
    await agent.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  function request(method, urlPath, { headers = {}, body, token = TEST_TOKEN, host } = {}) {
    return new Promise((resolve, reject) => {
      const finalHeaders = { host: host ?? `127.0.0.1:${port}`, ...headers };
      if (token) finalHeaders['x-vox-token'] = token;
      let payload;
      if (body !== undefined) {
        payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
        if (!('content-type' in finalHeaders)) finalHeaders['content-type'] = 'application/json';
      }
      const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: finalHeaders }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // Not JSON (static file).
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  return { port, project, studioDir, request };
}
