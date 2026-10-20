// Every heavy SDF geometry of the ruins, by bake name. Shared by the runtime module
// (loadOrBuild) and the bake script (src/bake/head.js) so names always match.
// Names start with "head-" (generated/head-*.bin belongs to this module).
import { buildHeadGeometry } from '../sculpt/head.js';
import { buildStone } from './stones.js';
import { buildDrum, buildBase, buildPilaster } from './columns.js';
import { HEAD_STONES, HEAD_PIECES, PIER8 } from './headset.js';
import { PORTICO_STONES, PORTICO_PIECES } from './portico.js';
import { T3_STONES, T3_PIECES } from './terrace3.js';

export const HEAD_VERSION = 'v12';
const GEN = 'g6'; // bump when the stone/column generators change

const cellFor = (depth, k = 0.0055, lo = 0.013, hi = 0.05) => Math.min(hi, Math.max(lo, depth * k));

export function ruinsJobs() {
  const jobs = [];
  jobs.push({ name: `head-${HEAD_VERSION}`, build: (q) => buildHeadGeometry({ cell: q >= 1 ? 0.0085 : 0.014 }) });
  for (const s of [...HEAD_STONES, ...PORTICO_STONES, ...T3_STONES]) {
    const spec = { kind: s.kind || 'block', dims: s.dims, seed: s.id, chips: s.chips, broken: s.broken, split: s.split, erosion: s.erosion, round: s.round };
    jobs.push({ name: `head-stone-${s.id}-${GEN}${hashSpec(spec)}`, id: s.id, build: (q) => buildStone({ ...spec, cell: Math.min(cellFor(s.depth), Math.min(...s.dims) / 9) * (q >= 1 ? 1 : 1.6) }) });
  }
  PIER8.blocks.forEach((dims, i) => {
    const spec = { kind: 'block', dims, seed: 'pier8-' + i, chips: 7, broken: 0, round: 0.03 };
    jobs.push({ name: `head-stone-pier8-${i}-${GEN}${hashSpec(spec)}`, id: 'pier8-' + i, build: (q) => buildStone({ ...spec, cell: q >= 1 ? 0.045 : 0.07 }) });
  });
  for (const p of [...HEAD_PIECES, ...PORTICO_PIECES, ...T3_PIECES]) {
    const spec = p.spec;
    const fn = p.type === 'base' ? buildBase : p.type === 'pilaster' ? buildPilaster : buildDrum;
    jobs.push({ name: `head-${p.type}-${p.id}-${GEN}${hashSpec(spec)}`, id: p.id, build: (q) => fn({ ...spec, cell: (spec.cell || 0.025) * (q >= 1 ? 1 : 1.5) }) });
  }
  return jobs;
}

function hashSpec(o) {
  const s = JSON.stringify(o);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
