import { HttpError } from '../http.js';
import { parseObj, ObjParseError } from '../../../shared/obj-parser.js';
import { parseGltf } from '../../../shared/gltf-parser.js';
import { serializeMesh, validateMesh, SceneFormatError } from '../../../shared/scene-format.js';
import { writeProjectFile } from './scenes.js';

/**
 * Importers keyed by source format. Each takes the decoded upload and
 * returns { meshes: [...] } in Vox mesh layout. Only these formats can be
 * imported; nothing else in the upload is interpreted.
 */
export const IMPORTERS = {
  obj: {
    encoding: 'utf8',
    convert: (buffer, baseName) => parseObj(buffer.toString('utf8'), baseName),
  },
  gltf: {
    encoding: 'utf8',
    convert: (buffer, baseName) => parseGltf(new Uint8Array(buffer), baseName),
  },
  glb: {
    encoding: 'base64',
    convert: (buffer, baseName) => parseGltf(new Uint8Array(buffer), baseName),
  },
};

const SAFE_NAME = /[^A-Za-z0-9 _.-]/g;

/** Reduce an uploaded file name to a safe base name without extension. */
export function safeBaseName(name) {
  if (typeof name !== 'string') throw new HttpError(400, 'name is required');
  const last = name.split(/[\\/]/).pop();
  const base = last.replace(/\.[^.]*$/, '').replace(SAFE_NAME, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 64);
  if (!base) throw new HttpError(400, 'name is not usable as a file name');
  return base;
}

function decodeUpload(body, importer) {
  if (typeof body.data !== 'string') throw new HttpError(400, 'data must be a string');
  if (body.encoding === 'base64') return Buffer.from(body.data, 'base64');
  if (importer.encoding !== 'utf8') throw new HttpError(400, 'This format must be uploaded as base64');
  return Buffer.from(body.data, 'utf8');
}

/**
 * Convert an uploaded asset into .voxmesh files under Assets/Models.
 * The heavy parsing runs here, on the user's machine, instead of in the
 * browser tab.
 */
export async function importAsset(root, body) {
  const format = String(body.format || '').toLowerCase();
  const importer = IMPORTERS[format];
  if (!importer) throw new HttpError(400, `Unsupported format "${format}"`);
  const base = safeBaseName(body.name);
  const buffer = decodeUpload(body, importer);

  let result;
  try {
    result = importer.convert(buffer, base);
  } catch (err) {
    if (err instanceof ObjParseError || err instanceof SceneFormatError || err?.name === 'GltfParseError') {
      throw new HttpError(422, `Could not import ${format.toUpperCase()}: ${err.message}`);
    }
    throw err;
  }

  const single = result.meshes.length === 1;
  const written = [];
  for (let i = 0; i < result.meshes.length; i++) {
    const mesh = validateMesh(result.meshes[i]);
    const meshName = safeBaseName(`${mesh.name || base}_${i}.x`);
    const rel = single ? `Assets/Models/${base}.voxmesh` : `Assets/Models/${base}/${meshName}.voxmesh`;
    const savedPath = await writeProjectFile(root, rel, serializeMesh(mesh));
    written.push({ path: savedPath, mesh, ...(result.meshes[i].extra || {}) });
  }
  return { ok: true, name: base, format, meshes: written, nodes: result.nodes || null };
}

/** POST /api/assets/import */
export function registerAssets(router, config) {
  router.post('/api/assets/import', async ({ json }) => importAsset(config.project, await json()));
}
