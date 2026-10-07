// Model converters by source format: (bytes, baseName, progress) => result.
import { parseObj } from '../../../shared/obj-parser.js';
import { parseGltf } from '../../../shared/gltf-parser.js';

const utf8 = new TextDecoder('utf-8');

export const CONVERTERS = {
  obj: (bytes, base, progress) => parseObj(utf8.decode(bytes), base, progress),
  gltf: (bytes, base, progress) => parseGltf(bytes, base, progress),
  glb: (bytes, base, progress) => parseGltf(bytes, base, progress),
};

/** Error names that mean "the file is broken" (422) rather than a bug. */
export const PARSE_ERRORS = new Set(['ObjParseError', 'GltfParseError', 'SceneFormatError']);
