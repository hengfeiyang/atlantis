// Bake every heavy statue mesh: node tools/bake.mjs statues
//   STATUES_ONLY=horse,poseidon   only jobs whose name contains one of these
//   STATUES_FORCE=1               rebuild even if generated/<name>.bin exists
//   STATUES_DETAIL=0.5            quicker, coarser dev bake
import fs from 'node:fs';
import { loadOrBuild } from '../core/cache.js';
import { statueJobs } from '../sculpt/library.js';

export async function bake() {
  const env = process.env;
  const only = env.STATUES_ONLY ? env.STATUES_ONLY.split(',') : null;
  const force = !!env.STATUES_FORCE;
  const detail = Number(env.STATUES_DETAIL || 1);
  const out = {};
  for (const j of statueJobs()) {
    if (only && !only.some((o) => j.name.includes(o))) continue;
    if (!force && fs.existsSync(new URL(`../../generated/${j.name}.bin`, import.meta.url))) { console.log(`[bake] ${j.name}: up to date`); continue; }
    const t0 = Date.now();
    const g = await loadOrBuild(j.name, () => j.build(detail));
    out[j.name] = g;
    console.log(`[bake] built ${j.name} in ${((Date.now() - t0) / 1000).toFixed(1)} s (${(g.index.count / 3 / 1000).toFixed(0)} k tris)`);
  }
  return out;
}
