// Bake every heavy ruins geometry (fallen head, rubble stones, column drums & bases):
//   node tools/bake.mjs head            (all)
//   RUINS_ONLY=stone node tools/bake.mjs head   (only jobs whose name contains "stone")
// Writes generated/head-*.bin (names come from src/ruins/jobs.js, so they match the runtime).
import fs from 'node:fs';
import { loadOrBuild } from '../core/cache.js';
import { ruinsJobs } from '../ruins/jobs.js';

export async function bake() {
  const only = (typeof process !== 'undefined' && process.env.RUINS_ONLY) || '';
  const force = (typeof process !== 'undefined' && process.env.RUINS_FORCE) || '';
  const out = {};
  for (const j of ruinsJobs()) {
    if (only && !j.name.includes(only)) continue;
    if (!force && fs.existsSync(new URL(`../../generated/${j.name}.bin`, import.meta.url))) { console.log(`[bake] ${j.name}: up to date`); continue; }
    const t0 = Date.now();
    const g = await loadOrBuild(j.name, () => j.build(1));
    out[j.name] = g;
    console.log(`[bake] built ${j.name} in ${((Date.now() - t0) / 1000).toFixed(1)} s (${(g.index.count / 3 / 1000).toFixed(0)} k tris)`);
  }
  // remove stale head-*.bin files that no job produces any more (only when baking everything)
  if (!only) {
    const names = new Set(ruinsJobs().map((j) => j.name + '.bin'));
    const dir = new URL('../../generated/', import.meta.url);
    for (const f of fs.readdirSync(dir)) if (f.startsWith('head-') && !names.has(f)) { fs.unlinkSync(new URL(f, dir)); console.log('[bake] removed stale', f); }
  }
  return out;
}
