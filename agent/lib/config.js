import path from 'node:path';
import { PRODUCT, VERSION } from './version.js';

export const DEFAULT_PORT = 8787;
export const DEFAULT_PROJECT = 'VoxProject';

/** Upper bound for any request body the agent will read (bytes). */
export const DEFAULT_MAX_BODY = 16 * 1024 * 1024;

export const HELP_TEXT = `${PRODUCT} v${VERSION}
Local helper for Vox Studio. Serves the editor and runs whitelisted jobs
(system info, project files, scene files, asset import, benchmark, export)
on this machine.

Usage:
  node agent/agent.js [options]

Options:
  --port <n>         Port to listen on (default ${DEFAULT_PORT}). Always bound to 127.0.0.1.
  --project <dir>    Project folder. All file access is confined to it
                     (default ./${DEFAULT_PROJECT}, created if missing).
  --max-body <mb>    Largest accepted request body in MB (default ${DEFAULT_MAX_BODY / 1024 / 1024}).
  --quiet            Do not log requests.
  -v, --version      Print the version and exit.
  -h, --help         Print this help and exit.
`;

export class ConfigError extends Error {}

/**
 * Parse command line arguments into an agent config object.
 * Unknown flags are rejected so typos do not silently change behavior.
 */
export function parseArgs(argv, cwd = process.cwd()) {
  const config = {
    port: DEFAULT_PORT,
    project: path.resolve(cwd, DEFAULT_PROJECT),
    maxBody: DEFAULT_MAX_BODY,
    quiet: false,
    help: false,
    version: false,
  };

  const takeValue = (i, flag) => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new ConfigError(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--port': {
        const port = Number(takeValue(i, arg));
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new ConfigError('--port must be an integer between 1 and 65535');
        }
        config.port = port;
        i++;
        break;
      }
      case '--project':
        config.project = path.resolve(cwd, takeValue(i, arg));
        i++;
        break;
      case '--max-body': {
        const mb = Number(takeValue(i, arg));
        if (!Number.isFinite(mb) || mb <= 0 || mb > 256) {
          throw new ConfigError('--max-body must be between 0 and 256 (MB)');
        }
        config.maxBody = Math.floor(mb * 1024 * 1024);
        i++;
        break;
      }
      case '--quiet':
        config.quiet = true;
        break;
      case '-v':
      case '--version':
        config.version = true;
        break;
      case '-h':
      case '--help':
        config.help = true;
        break;
      default:
        throw new ConfigError(`Unknown option: ${arg}`);
    }
  }
  return config;
}
