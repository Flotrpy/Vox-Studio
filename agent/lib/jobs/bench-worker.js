// Fixed benchmark workloads, run off the agent's main thread. The worker
// only accepts a workload name and a duration; it never runs request code.
import { parentPort, workerData } from 'node:worker_threads';

function cpuWorkload(durationMs) {
  const a = new Float64Array(16).map((_, i) => (i % 5) + 1);
  const b = new Float64Array(16).map((_, i) => (i % 3) + 0.5);
  const out = new Float64Array(16);
  let iterations = 0;
  const end = performance.now() + durationMs;
  while (performance.now() < end) {
    for (let n = 0; n < 1000; n++) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          let s = 0;
          for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
          out[r * 4 + c] = Math.sqrt(s);
        }
      }
      a[n & 15] = out[(n + 1) & 15];
    }
    iterations += 1000;
  }
  return { iterations, opsPerSecond: Math.round(iterations / (durationMs / 1000)), unit: 'mat4 mul/s' };
}

function memoryWorkload(durationMs) {
  const length = 4 * 1024 * 1024; // 32 MB of float64
  const buffer = new Float64Array(length);
  let bytes = 0;
  let checksum = 0;
  const end = performance.now() + durationMs;
  while (performance.now() < end) {
    for (let i = 0; i < length; i++) buffer[i] = i * 0.5;
    for (let i = 0; i < length; i++) checksum += buffer[i];
    bytes += length * 8 * 2;
  }
  const mbPerSecond = Math.round(bytes / 1024 / 1024 / (durationMs / 1000));
  return { bytes, mbPerSecond, unit: 'MB/s', checksum: checksum > 0 };
}

const { kind, durationMs } = workerData;
const started = performance.now();
const result = kind === 'memory' ? memoryWorkload(durationMs) : cpuWorkload(durationMs);
parentPort.postMessage({ kind, ...result, elapsedMs: Math.round(performance.now() - started) });
