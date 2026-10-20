// node tools/bake.mjs terrain
//   → generated/terrain-far-<ver>.bin                (eroded far-field height grid)
//   → generated/terrain-mesh-<quality>-<hash>.bin    (meshed terrain chunks for preview + high)
// The mesh hash covers every input (terrain sources, layout entries, shots, quality), so a stale bake is
// simply not found and the runtime meshes in workers instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { loadOrBuild } from '../core/cache.js';
import { generateFarGrid } from '../terrain/farfield.js';
import { farToGeometry, farFromGeometry, FAR_NAME } from '../terrain/far.js';
import { setFarGrid } from '../world/heightfield.js';
import { planChunks } from '../terrain/lod.js';
import { SHOTS } from '../world/shots.js';
import { meshInputsHash, meshBakeName, groupResults, packGroups } from '../terrain/meshpack.js';
import { packedToGeometry, PLAN_OPTS } from '../terrain/meshgeo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function bake() {
  // ---- far grid (reuse an existing bake of the current version)
  const farFile = path.join(ROOT, 'generated', FAR_NAME + '.bin');
  let far;
  if (fs.existsSync(farFile)) {
    const { deserializeGeometry } = await import('../core/cache.js');
    const buf = fs.readFileSync(farFile);
    far = farFromGeometry(deserializeGeometry(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
    console.log(`[bake] reusing ${FAR_NAME}`);
  } else {
    const geo = await loadOrBuild(FAR_NAME, () => farToGeometry(generateFarGrid({ cell: 16, log: console.log })));
    far = farFromGeometry(geo);
  }
  setFarGrid(far);
  // ---- terrain meshes per quality
  const readText = async (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const nW = Math.max(1, Math.min(14, os.cpus().length - 1));
  const workers = Array.from({ length: nW }, () => new Worker(new URL('../terrain/nodeworker.mjs', import.meta.url), { workerData: { far } }));
  for (const qname of ['preview', 'high']) {
    const planOpts = PLAN_OPTS(qname);
    const hash = await meshInputsHash(readText, qname, planOpts);
    const name = meshBakeName(qname, hash);
    const t0 = Date.now();
    const leaves = planChunks(SHOTS, planOpts);
    const results = new Array(leaves.length);
    let next = 0, done = 0;
    await new Promise((resolve, reject) => {
      const order = leaves.map((l, i) => i).sort((a, b) => leaves[a].cell - leaves[b].cell);
      const feed = (w) => {
        if (next >= order.length) return;
        const i = order[next++];
        const l = leaves[i];
        w.once('message', (m) => {
          if (m.error) { reject(new Error(m.error)); return; }
          results[i] = m.r; done++;
          if (done % 50 === 0) console.log(`[bake] ${qname}: ${done}/${leaves.length} chunks`);
          if (done === leaves.length) resolve(); else feed(w);
        });
        w.postMessage({ id: i, job: { x0: l.x0, z0: l.z0, n: l.n, cell: l.cell, ext: 1 } });
      };
      workers.forEach(feed);
    });
    const packed = packGroups(groupResults(leaves, results));
    await loadOrBuild(name, () => packedToGeometry(packed));
    console.log(`[bake] ${name}: ${leaves.length} chunks, ${(packed.index.length / 3e6).toFixed(2)} M tris in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    // remove stale bakes of this quality
    for (const f of fs.readdirSync(path.join(ROOT, 'generated'))) {
      if (f.startsWith(`terrain-mesh-${qname}-`) && f !== name + '.bin') fs.rmSync(path.join(ROOT, 'generated', f));
    }
  }
  for (const w of workers) await w.terminate();
}
