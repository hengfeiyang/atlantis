// Terrain worker: meshes chunks off the main thread (no three.js here).
import { meshChunk } from './voxel.js';
import { setFarGrid } from '../world/heightfield.js';

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'far') { setFarGrid(m.grid); self.postMessage({ type: 'far-ok' }); return; }
  try {
    const r = meshChunk(m.job);
    self.postMessage({ id: m.id, r }, [r.position.buffer, r.normal.buffer, r.ter.buffer, r.index.buffer]);
  } catch (err) {
    self.postMessage({ id: m.id, error: String((err && err.stack) || err) });
  }
};
