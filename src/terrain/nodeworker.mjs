// adapted from athenaion/src/terrain/nodeworker.mjs
// node worker_threads entry for baking terrain chunks (see src/bake/terrain.js)
import { parentPort, workerData } from 'node:worker_threads';
import { meshChunk } from './voxel.js';
import { registerFarGrid } from './farsample.js';

if (workerData && workerData.far) registerFarGrid(workerData.far);
parentPort.on('message', (m) => {
  try {
    const r = meshChunk(m.job);
    parentPort.postMessage({ id: m.id, r }, [r.position.buffer, r.normal.buffer, r.ter.buffer, r.index.buffer]);
  } catch (e) {
    parentPort.postMessage({ id: m.id, error: String((e && e.stack) || e) });
  }
});
