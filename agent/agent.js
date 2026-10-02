#!/usr/bin/env node
import { parseArgs, ConfigError, HELP_TEXT } from './lib/config.js';
import { PRODUCT, VERSION } from './lib/version.js';
import { createToken } from './lib/token.js';
import { ensureProject } from './lib/project.js';
import { createAgentServer } from './lib/server.js';

function printBanner(port, token, project) {
  const url = `http://127.0.0.1:${port}/#token=${token}`;
  const lines = [
    '',
    `${PRODUCT} v${VERSION}`,
    '',
    `  Studio URL   ${url}`,
    `  Pairing      ${token}`,
    `  Project      ${project}`,
    '',
    '  Open the Studio URL in your browser. The pairing token is new every',
    '  time the agent starts; anyone with it can use the agent, so do not share it.',
    '  Press Ctrl+C to stop.',
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function requestLogger(quiet) {
  if (quiet) return () => {};
  return ({ method, path, status, ms }) => {
    const time = new Date().toTimeString().slice(0, 8);
    process.stdout.write(`[${time}] ${status} ${method} ${path} ${ms}ms\n`);
  };
}

async function main() {
  let config;
  try {
    config = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n\n${HELP_TEXT}`);
      process.exit(2);
    }
    throw err;
  }
  if (config.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  if (config.version) {
    process.stdout.write(`${PRODUCT} v${VERSION}\n`);
    return;
  }

  await ensureProject(config.project);
  const token = createToken();
  const agent = createAgentServer({
    port: config.port,
    project: config.project,
    token,
    maxBody: config.maxBody,
    log: requestLogger(config.quiet),
  });

  try {
    await agent.listen();
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`Port ${config.port} is already in use. Try --port <n>.\n`);
      process.exit(1);
    }
    throw err;
  }
  printBanner(agent.config.port, token, config.project);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    process.stdout.write('\nStopping Vox Agent...\n');
    await agent.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
