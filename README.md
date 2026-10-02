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

## The editor

The layout follows the arrangement most game editor users already know:

- **Menu bar**: File, Edit, Assets, GameObject, Component, Window, Help.
- **Toolbar**: Hand, Move, Rotate, Scale, Rect and Transform tools with
  Pivot/Center and Global/Local toggles; Play, Pause, Step; agent status and
  the layout selector.
- **Hierarchy** (left): scene tree with search, create menu, foldouts,
  indent guides, drag to reparent (world position is kept), F2 to rename.
- **Scene / Game** (center): editor camera, grid, click and marquee
  selection, light blue selection outline, transform gizmo, orientation
  gizmo (click an axis to view along it), shading modes, 2D mode, lighting
  and gizmo toggles. The Game tab renders through the main camera with an
  aspect ratio dropdown and a stats overlay.
- **Inspector** (right): active checkbox, name, Static, Tag, Layer, component
  foldouts with enable checkboxes and overflow menus, Vector3 fields with
  drag-to-scrub X/Y/Z labels, color fields, Add Component.
- **Project / Console** (bottom): folder tree, breadcrumb, asset grid with
  zoom slider (far left switches to a list), search; console with Clear,
  Collapse, Clear on Play, Error Pause and per-type filters with counts.

Panels dock: drag a tab onto another tab strip, onto the edge of a panel or
onto the edge of the window. Drag splitters to resize. Close tabs from the
tab's context menu and reopen them from the Window menu. The layout is saved
in browser storage (`vox:layout`) and restored on the next visit.

Without a paired agent the editor still runs: scenes are kept in browser
storage and can be downloaded or loaded as `.voxscene` files from the File
menu.

### Scene navigation

| Input                          | Action                              |
| ------------------------------ | ----------------------------------- |
| Right drag + W A S D Q E       | Fly (Shift = faster, wheel = speed) |
| Alt + left drag                | Orbit                               |
| Middle drag (or Hand tool)     | Pan                                 |
| Wheel, Alt + right drag        | Zoom                                |
| F, or double-click             | Frame selection                     |
| Ctrl while dragging a handle   | Snap                                |

### Shortcuts

Q W E R T Y tools, Z pivot/center, X global/local, F frame, Delete, Ctrl+D
duplicate, Ctrl+C/Ctrl+V, F2 rename, Ctrl+Z / Ctrl+Y undo/redo, Ctrl+S save,
Ctrl+Shift+S save as, Ctrl+N new scene, Ctrl+P play. Help > Keyboard
Shortcuts lists them all.

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
limits), scene format and serialization tests, scene model and undo/redo
tests and dock layout tests with Node's built-in test runner.

## Security

See [SECURITY.md](SECURITY.md) for the agent's threat model.

## License

MIT, see [LICENSE](LICENSE). Third-party components are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
