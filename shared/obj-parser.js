// Wavefront OBJ parser producing Vox mesh data. Shared by the agent (which
// runs it on large files so the browser does not have to) and the studio
// (fallback when no agent is connected). Dependency-free.

export class ObjParseError extends Error {}

const MAX_VERTICES = 2_000_000;

/**
 * Parse OBJ text. Each `o`/`g` block becomes its own mesh; faces with more
 * than three corners are triangulated as fans. Missing normals are
 * computed (smooth, area weighted).
 *
 * Returns { meshes: [{ name, positions, normals, uvs, indices }] }.
 */
export function parseObj(text, fallbackName = 'Mesh') {
  if (typeof text !== 'string') throw new ObjParseError('OBJ input must be text');

  const v = [];
  const vt = [];
  const vn = [];
  const meshes = [];
  let current = null;

  function startMesh(name) {
    current = {
      name: name || fallbackName,
      positions: [],
      normals: [],
      uvs: [],
      indices: [],
      lookup: new Map(),
      hasNormals: true,
      hasUvs: true,
    };
    meshes.push(current);
  }

  function resolveIndex(raw, length, line) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n === 0) throw new ObjParseError(`Bad index on line ${line}`);
    const idx = n < 0 ? length + n : n - 1;
    if (idx < 0 || idx >= length) throw new ObjParseError(`Index out of range on line ${line}`);
    return idx;
  }

  function vertex(corner, line) {
    let index = current.lookup.get(corner);
    if (index !== undefined) return index;
    const [pi, ti, ni] = corner.split('/');
    const p = resolveIndex(pi, v.length / 3, line);
    index = current.positions.length / 3;
    if (index >= MAX_VERTICES) throw new ObjParseError('Mesh has too many vertices');
    current.positions.push(v[p * 3], v[p * 3 + 1], v[p * 3 + 2]);
    if (ti) {
      const t = resolveIndex(ti, vt.length / 2, line);
      current.uvs.push(vt[t * 2], vt[t * 2 + 1]);
    } else {
      current.hasUvs = false;
      current.uvs.push(0, 0);
    }
    if (ni) {
      const nn = resolveIndex(ni, vn.length / 3, line);
      current.normals.push(vn[nn * 3], vn[nn * 3 + 1], vn[nn * 3 + 2]);
    } else {
      current.hasNormals = false;
      current.normals.push(0, 0, 0);
    }
    current.lookup.set(corner, index);
    return index;
  }

  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash);
    line = line.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const key = parts[0];
    const lineNo = li + 1;

    if (key === 'v') {
      const x = Number(parts[1]), y = Number(parts[2]), z = Number(parts[3]);
      if (![x, y, z].every(Number.isFinite)) throw new ObjParseError(`Bad vertex on line ${lineNo}`);
      v.push(x, y, z);
    } else if (key === 'vt') {
      const s = Number(parts[1]), t = Number(parts[2] ?? 0);
      if (![s, t].every(Number.isFinite)) throw new ObjParseError(`Bad texture coordinate on line ${lineNo}`);
      vt.push(s, t);
    } else if (key === 'vn') {
      const x = Number(parts[1]), y = Number(parts[2]), z = Number(parts[3]);
      if (![x, y, z].every(Number.isFinite)) throw new ObjParseError(`Bad normal on line ${lineNo}`);
      vn.push(x, y, z);
    } else if (key === 'o' || key === 'g') {
      const name = parts.slice(1).join(' ');
      // Reuse an empty mesh instead of leaving it behind.
      if (current && current.indices.length === 0) current.name = name || current.name;
      else startMesh(name);
    } else if (key === 'f') {
      if (parts.length < 4) throw new ObjParseError(`Face with fewer than 3 corners on line ${lineNo}`);
      if (!current) startMesh(fallbackName);
      const corners = parts.slice(1).map((c) => vertex(c, lineNo));
      for (let i = 1; i < corners.length - 1; i++) {
        current.indices.push(corners[0], corners[i], corners[i + 1]);
      }
    }
    // Other statements (mtllib, usemtl, s, l, p) are ignored.
  }

  const result = meshes
    .filter((m) => m.indices.length > 0)
    .map((m) => {
      if (!m.hasNormals) computeNormals(m.positions, m.indices, m.normals);
      return {
        name: m.name,
        positions: m.positions,
        normals: m.normals,
        uvs: m.hasUvs ? m.uvs : [],
        indices: m.indices,
      };
    });
  if (result.length === 0) throw new ObjParseError('OBJ file contains no faces');
  return { meshes: result };
}

/** Area-weighted smooth normals, written into `out`. */
export function computeNormals(positions, indices, out) {
  out.fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const k of [a, b, c]) {
      out[k] += nx;
      out[k + 1] += ny;
      out[k + 2] += nz;
    }
  }
  for (let i = 0; i < out.length; i += 3) {
    const len = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= len;
    out[i + 1] /= len;
    out[i + 2] /= len;
  }
  return out;
}

/** Axis-aligned bounds of a positions array: { min: [x,y,z], max: [x,y,z] }. */
export function meshBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = positions[i + k];
      if (value < min[k]) min[k] = value;
      if (value > max[k]) max[k] = value;
    }
  }
  return { min, max };
}
