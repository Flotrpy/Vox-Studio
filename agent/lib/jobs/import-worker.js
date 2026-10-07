// Runs one model conversion off the agent's main thread so large files do
// not stall other requests and the job can be cancelled by terminating it.
import { parentPort, workerData } from 'node:worker_threads';
import { CONVERTERS } from './converters.js';

const { format, bytes, baseName } = workerData;
const progress = (fraction) => parentPort.postMessage({ type: 'progress', fraction });
try {
  const convert = CONVERTERS[format];
  if (!convert) throw new Error(`No converter for ${format}`);
  const result = await convert(new Uint8Array(bytes), baseName, progress);
  parentPort.postMessage({ type: 'result', result });
} catch (err) {
  parentPort.postMessage({ type: 'error', name: err?.name || 'Error', message: err?.message || String(err) });
}
