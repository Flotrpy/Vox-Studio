# Vox Studio Security

This document describes the threat model of **Vox Agent**, the local helper
that serves Vox Studio and runs work on your machine, and the defenses it
uses. Please report vulnerabilities privately through the repository's
security advisory page rather than in public issues.

## What the agent is

`node agent/agent.js` starts an HTTP server on `127.0.0.1:8787`. It serves
the Vox Studio web editor and a small JSON API. The API runs a fixed list of
jobs on behalf of the editor:

| Endpoint                   | Job                                                   |
| -------------------------- | ----------------------------------------------------- |
| `GET  /api/health`         | Version and project name (pairing check)              |
| `GET  /api/system`         | RAM / CPU information                                 |
| `GET  /api/files?dir=`     | List one folder of the project                        |
| `GET  /api/tree`           | Folder tree of the project                            |
| `GET  /api/scene?path=`    | Read a `.voxscene` file                               |
| `POST /api/scene`          | Validate and write a `.voxscene` file                 |
| `GET  /api/mesh?path=`     | Read a `.voxmesh` file                                |
| `POST /api/assets/import`  | Convert an uploaded model into `.voxmesh` files       |
| `POST /api/benchmark`      | Run a fixed CPU or memory benchmark                   |
| `POST /api/folder`         | Create a folder under `Assets/` or `Builds/`          |
| `POST /api/rename`         | Rename an asset under `Assets/` or `Builds/`          |
| `POST /api/delete`         | Delete an asset file or an empty folder               |
| `POST /api/export`         | Write a standalone build to `Builds/<Name>/play.html` |
| `POST /api/build/ticket`   | Issue a one-time link to open a build                 |
| `GET  /play/<ticket>`      | Serve that build once (the ticket is the credential)  |

There is **no** endpoint that runs shell commands, spawns processes, loads
plugins or evaluates code sent by a client. New capabilities are added as new,
explicitly registered jobs with their own input validation.

## Assets we protect

- Files on your computer outside the project folder.
- Files inside the project folder against unintended modification.
- Your machine's CPU and memory against runaway work.

## Threats and defenses

### 1. A malicious website talks to the agent

Any page you open in your browser can try to send requests to
`http://127.0.0.1:8787`.

- **Pairing token.** A 256-bit random token is generated each time the agent
  starts and printed in the console. The studio receives it through the URL
  fragment (`#token=...`), which browsers never send to servers or put in the
  Referer header. The studio stores it in `sessionStorage` and removes it from
  the address bar. Every `/api/` request must carry it in the `X-Vox-Token`
  header. Tokens are compared in constant time.
- **No CORS.** The agent never sends `Access-Control-Allow-*` headers, so a
  cross-origin page cannot read responses, and the custom token header forces
  a preflight that the agent does not approve.
- **Origin check.** Requests whose `Origin` is not `http://127.0.0.1:<port>`
  or `http://localhost:<port>` are rejected with 403, as are requests whose
  `Sec-Fetch-Site` reports a cross-site context.
- **JSON only.** Write endpoints require `Content-Type: application/json`,
  which an HTML form cannot send.

### 2. DNS rebinding

An attacker's domain can be re-pointed to `127.0.0.1` so that the browser
treats the agent as same-origin with the attacker's page. The agent rejects
any request whose `Host` header is not `127.0.0.1:<port>` or
`localhost:<port>`, so rebinding hosts get 403 before any routing happens.
The token check applies as well.

### 3. Other machines on the network

The server binds to `127.0.0.1` only. It is not reachable from other
computers, and there is no option to bind elsewhere.

### 4. Path traversal and escaping the project folder

Every file path in a request is treated as relative to the project folder and
checked by `agent/lib/paths.js`:

- absolute paths, drive letters, UNC paths and backslashes are rejected;
- `..` segments are rejected outright (not normalized away);
- control characters, characters invalid on Windows, reserved device names
  (`CON`, `NUL`, ...) and trailing dots or spaces are rejected;
- the resolved path must lie inside the project root, and after resolving
  symlinks (`realpath`) it must still lie inside the real project root. For
  paths that do not exist yet, the nearest existing ancestor is checked.

Listings skip symlinks and hidden entries. Writes are limited by extension
(`.voxscene` for scenes, `.voxmesh` for converted assets), rename/delete are
limited to asset files under `Assets/` and `Builds/`, and `.vox/` settings
cannot be changed through the API. The static file server uses the same
guard and only serves known file types from the `studio/` and `shared/`
folders.

### 5. Malicious request content

- Bodies are capped (16 MB by default, `--max-body`), checked against
  `Content-Length` up front and counted while streaming. URLs over 4 KB and
  slow or oversized headers are refused.
- JSON is parsed with `JSON.parse` only; prototype keys (`__proto__`,
  `constructor`, `prototype`) are dropped. Request data is never passed to
  `eval`, `Function`, `vm`, `child_process` or dynamic `import`.
- Scenes are validated against a strict schema (`shared/scene-format.js`):
  unknown component types are rejected, unknown fields are dropped, numbers
  must be finite and in range, ids must match a safe pattern, parent links
  must exist and must not form cycles, and sizes are bounded.
- Imported models (OBJ, glTF, GLB) are parsed by small dedicated parsers
  with vertex, index and buffer bounds checks. glTF files may only carry
  embedded `data:` buffers; external URIs are refused, so an import can
  never make the agent read another file or fetch from the network. Uploaded
  file names are reduced to safe base names.
- Benchmarks run a fixed workload in a worker thread with a time cap, a
  memory cap and one-at-a-time concurrency.

### 6. Builds

- The export job only writes `Builds/<Name>/play.html`; the folder name is
  reduced to letters, digits, spaces, `_` and `-`.
- The scene is validated before it is embedded and is placed in a
  `<script type="application/json">` element with `<`, `>`, `&`, U+2028 and
  U+2029 escaped, so names or script text cannot break out of it. The title
  is HTML-escaped.
- Builds carry a Content-Security-Policy that allows only their own inline
  and `data:` scripts and blocks every network request (`connect-src
  'none'`, no remote scripts, images or frames).
- Build And Run cannot carry the token in a URL, so the agent issues a
  random 192-bit ticket that is valid for 60 seconds and for one request,
  and only for an existing `Builds/<name>/play.html`.

### 7. Information leaks

The token is never written to request logs. Error responses carry short,
fixed messages without stack traces or absolute paths. Responses include
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, and API responses are `Cache-Control:
no-store`. Studio pages get a Content-Security-Policy that only allows
scripts from the agent itself plus the hashed inline import map.

## Accepted risks

- **Anyone who can read your console can use the agent** while it runs.
  Treat the pairing token like a password and stop the agent (Ctrl+C) when
  you are done.
- **Local malware** running as your user can already read your files; the
  agent does not try to defend against it.
- **Scripts in your own scenes** run in the browser during Play mode, the
  same as code in any game you write. They run in the page, not in the agent,
  and the CSP keeps them from loading code from other origins. Do not open
  scenes from people you do not trust.

## Testing

`npm test` runs the security test suite in `test/agent/`, covering missing
and wrong tokens, foreign and cross-site origins, rebinding Host headers,
traversal attempts on every file endpoint, symlink escapes, oversized and
chunked bodies, non-JSON bodies, unknown endpoints, script-tag injection in
exported builds and single-use play tickets.
