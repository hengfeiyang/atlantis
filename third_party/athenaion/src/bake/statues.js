// Bake every heavy statue mesh: node tools/bake.mjs statues
// (set STATUES_ONLY=athB,shieldB,pedKneel,... to bake a subset while iterating,
//  STATUES_DETAIL=0.5 for a quicker, coarser dev bake)
import { colossusGeometries, SHIELD_STYLE } from '../sculpt/library.js';
import { statueLibrary } from '../sculpt/statuary-lib.js';
import { emblemTextureCached } from '../sculpt/props.js';

export async function bake() {
  const env = typeof process !== 'undefined' ? process.env : {};
  const only = env.STATUES_ONLY ? env.STATUES_ONLY.split(',') : null;
  const detail = Number(env.STATUES_DETAIL || 1);
  const want = (k) => !only || only.some((o) => k.includes(o));
  for (const v of ['A', 'B', 'C']) {
    if (!only || only.includes('ath' + v) || only.includes('shield' + v)) await colossusGeometries(v, detail, (k) => !only || only.includes(k));
  }
  if (!only || only.includes('emblem')) for (const st of new Set(Object.values(SHIELD_STYLE))) await emblemTextureCached(st, 1024);
  if (!only || only.some((o) => !/^(ath|shield)[ABC]$/.test(o) && o !== 'emblem')) await statueLibrary(detail, want);
}
