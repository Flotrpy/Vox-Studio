# Vox Studio

Vox Studio is a browser-based 3D game editor. **Vox Agent** is its small
local helper: a Node.js process you start from a terminal that serves the
editor and does the heavy work (file access, asset conversion, builds) on
your own machine, so the browser tab does not run into its limits.

> Vox Studio is inspired by popular game editors. Not affiliated with or
> endorsed by Unity Technologies. Unity is a trademark of Unity Technologies.

## Requirements

- Node.js 20 or newer. The agent has no npm dependencies.

## Running the agent

```
node agent/agent.js
```

The console prints something like:

```
Vox Agent v0.1.0

  Studio URL   http://127.0.0.1:8787/#token=Qv8l0iEgw-XKRIvkQzEns8gJGIEO_NukxZ1Mbzn8U_c
  Pairing      Qv8l0iEgw-XKRIvkQzEns8gJGIEO_NukxZ1Mbzn8U_c
  Project      C:\Users\you\VoxProject
```

Open the Studio URL. The token in the URL pairs the editor with this agent
run; it changes every time the agent starts.

Options (`node agent/agent.js --help`):

| Option            | Default        | Meaning                                    |
| ----------------- | -------------- | ------------------------------------------ |
| `--port <n>`      | `8787`         | Port on 127.0.0.1                          |
| `--project <dir>` | `./VoxProject` | Project folder (created if missing)        |
| `--max-body <mb>` | `16`           | Largest accepted request body              |
| `--quiet`         | off            | Do not log requests                        |

## Project folder

```
VoxProject/
  Assets/
    Scenes/        .voxscene files
    Models/        .voxmesh files produced by asset import
  Builds/          standalone exports
  .vox/
    ProjectSettings.json
```

## Tests

```
npm test
```

Runs the agent security tests (token, Origin, Host, path traversal, size
limits) and the scene format tests with Node's built-in test runner.

## Security

See [SECURITY.md](SECURITY.md) for the agent's threat model.

## License

MIT, see [LICENSE](LICENSE).
