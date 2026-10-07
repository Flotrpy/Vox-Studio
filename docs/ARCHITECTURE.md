# Vox Studio Architecture

Vox Studio has two halves that talk over HTTP on the loopback interface:

```
 Browser tab (studio/)                         Terminal (agent/)
 +------------------------------+   fetch    +---------------------------+
 | Editor UI, viewports,        | ---------> | Vox Agent (Node.js)       |
 | play mode, scripting         | X-Vox-Token| - request gate            |
 |                              | <--------- | - whitelisted jobs        |
 +------------------------------+    JSON    | - project folder on disk  |
              ^                               +---------------------------+
              |  shared/ (format + parsers, used by both sides)
```

The browser does all interactive work (editing, rendering, play mode). The
agent does the work that needs the file system or that is heavy enough to
freeze a tab: reading and writing project files, converting models,
benchmarks and producing builds. The editor also runs without the agent,
keeping a small project in browser storage.

## Repository layout

```
agent/
  agent.js              CLI entry, banner, shutdown
  lib/config.js         argument parsing and limits
  lib/server.js         HTTP server and the request gate
  lib/security.js       Host / Origin / token checks
  lib/paths.js          project path guard (traversal, symlinks)
  lib/http.js           errors, JSON responses, size-capped body reader
  lib/headers.js        security headers, hash-based CSP
  lib/static.js         read-only static file server
  lib/router.js         exact-match router
  lib/api.js            the complete list of jobs
  lib/jobs/*.js         health, system, files, scenes, assets, benchmark,
                        manage (folder/rename/delete), export
  templates/play.html   standalone build template
shared/
  scene-format.js       .voxscene / .voxmesh schema, validation, serialization
  obj-parser.js         OBJ to mesh data
  gltf-parser.js        glTF / GLB to mesh data and node tree
studio/
  index.html            shell and import map (three, vox/*)
  css/                  theme variables, base, layout, controls, dock, panels
  vendor/three/         three.js r160 (pinned, MIT)
  js/core/              editor model: scene, selection, history, commands, log
  js/ui/                DOM helpers, icons, menus, tooltips, fields, dock
  js/viewport/          scene builder, camera, grid, gizmo, outline, helpers
  js/panels/            scene, game, hierarchy, inspector, project, console, agent
  js/play/              physics, scripting, runtime, standalone player
  js/main.js            wires everything and runs the render loop
test/                   node:test suites (agent, shared, studio, play)
```

## Editor data flow

The editor follows a model / view split:

1. **SceneModel** (`studio/js/core/scene-model.js`) holds entities as plain
   objects in the same shape as the `.voxscene` format, plus child lists.
   Every mutation goes through `insertSubtree`, `remove`, `move`,
   `setField` or `setSettings`, which emit `structure`, `change`,
   `settings` or `load` events.
2. **Commands** (`core/commands.js`) wrap mutations as undoable objects;
   **History** (`core/history.js`) stores them and merges rapid edits of the
   same field. Drags (gizmo, field scrubbing) change the model live and
   record one command when the drag ends.
3. **Views** subscribe to model events: the SceneBuilder keeps a three.js
   scene in sync (`viewport/scene-sync.js`), the Hierarchy re-renders its
   tree, the Inspector refreshes field values or rebuilds when components
   change.

Panels never talk to each other directly; they go through the `Editor`
context (`core/editor.js`), which also carries the selection, the console
log, the current tool and the project storage backend.

### Rendering

One `SceneBuilder` owns the three.js scene. The Scene and Game views each
have their own `WebGLRenderer` and render the same scene: the Scene view
with the editor camera plus grid, outline, helper icons and gizmo (separate
overlay scenes), the Game view through the main Camera entity. The loop in
`main.js` only renders a view when something changed, or every frame in
Play mode.

### Dock layout

The layout is a tree of `split` nodes (`row` / `col` with relative sizes)
and `tabs` nodes (panel ids and the active index), handled by pure functions
in `ui/dock-layout.js` and rendered by `ui/dock.js`. Panel elements are
created once and moved between tab groups, so WebGL canvases and scroll
positions survive layout changes. The tree is saved to `vox:layout`.

### Inspector from schemas

`shared/scene-format.js` defines every component's fields (type, default,
range, label). The agent uses the table to validate scenes and the
Inspector uses it to build editors, so adding a field in one place updates
validation, serialization and UI together.

## Play mode

`play-mode.js` snapshots the scene (`toData()`), disables undo recording,
and starts a `PlayRuntime` (`play/runtime.js`) on the live model:

- Rigidbody and collider components become bodies in `PhysicsWorld`
  (`play/physics.js`): gravity, drag, axis-aligned boxes and spheres,
  bounciness, friction, triggers, enter events. Bodies do not rotate.
  Mesh Colliders become static `mesh` bodies holding world-space triangles
  and a BVH over them, so a box or sphere only tests nearby triangles
  (closest point for spheres, separating axes for boxes). The runtime
  rebuilds the triangles when a kinematic mesh moves.
- Script components are compiled with `compileScript` (`play/scripting.js`)
  into per-instance `start`, `update(dt)`, `onCollisionEnter` and
  `onTriggerEnter` hooks with an API (`transform`, `rigidbody`, `Input`,
  `Time`, `Debug`, `Scene`, `Mathf`). A script that throws is stopped and
  the error goes to the Console; with Error Pause on, play pauses.
- Stop restores the snapshot, the selection and the dirty flag, so changes
  made while playing are discarded.

## Builds

`POST /api/export` validates the scene and writes `Builds/<Name>/play.html`.
The page contains an import map whose entries are `data:` URLs holding
three.js and the player modules (`scene-builder`, `physics`, `scripting`,
`runtime`, `player`), and the scene as JSON in a
`<script type="application/json">` element with markup characters escaped.
Because the player modules import each other by bare `vox/...` specifiers,
the same files run in the editor (mapped to `./js/` by the studio's import
map) and in builds (mapped to data URLs), with no bundler.

Build And Run asks the agent for a single-use ticket and opens
`/play/<ticket>`, which serves the build once with a CSP that blocks all
network access.

## Agent request gate

Every request passes, in order: URL length cap, Host allowlist, Origin and
`Sec-Fetch-Site` checks. `/api/*` additionally needs the pairing token and
an explicitly registered route; bodies are size capped and parsed as JSON
only. File paths are resolved by `paths.js`, which keeps every access inside
the project folder. See [SECURITY.md](../SECURITY.md) for the threat model.

## Tests

`npm test` runs `node --test` over `test/`:

- `test/agent/` token, path guard, HTTP security gate, limits, jobs, export
- `test/shared/` scene format round-trips and validation, OBJ and glTF parsers
- `test/studio/` scene model, undo/redo, dock layout
- `test/play/` physics and scripting
