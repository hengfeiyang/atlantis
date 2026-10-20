// Cached geometry for the generic statues and the pediment / metope poses.
import * as THREE from 'three';
import { loadOrBuild } from '../core/cache.js';
import { STATUE_TYPES, PED_TYPES, buildStatueGeometry } from './statuary.js';

export const STATUARY_VERSION = 9; // r6: finer faces + separate LOD0 hands, slimmer mantles

/**
 * returns { types: [{ id, lod:[high, low] }], byId: Map(id → entry), mirrored(id, lod) }
 * want(name) filters what gets built (bake subsets)
 */
export async function statueLibrary(detail = 1, want = () => true) {
  const types = [];
  const byId = new Map();
  for (const T of STATUE_TYPES.concat(PED_TYPES)) {
    const names = [0, 1, 2].map((l) => `statue-type-${T.id}-l${l}-v${STATUARY_VERSION}`);
    if (!names.some(want) && !want('type')) continue;
    const lod = [];
    for (let l = 0; l < 3; l++) lod.push(await loadOrBuild(names[l], () => buildStatueGeometry(T.id, l, detail)));
    const e = { id: T.id, lod, ped: PED_TYPES.includes(T) };
    if (!e.ped) types.push(e);
    byId.set(T.id, e);
  }
  const mirrorCache = new Map();
  const mirrored = (id, l) => {
    const key = id + '|' + l;
    if (!mirrorCache.has(key)) mirrorCache.set(key, mirrorGeometry(byId.get(id).lod[l]));
    return mirrorCache.get(key);
  };
  return { types, byId, mirrored };
}

/** mirror a geometry across x (keeps faces outward) */
export function mirrorGeometry(g) {
  const m = g.clone();
  const p = m.attributes.position.array, n = m.attributes.normal.array;
  for (let i = 0; i < p.length; i += 3) { p[i] = -p[i]; n[i] = -n[i]; }
  const ix = m.index.array;
  for (let t = 0; t < ix.length; t += 3) { const b = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = b; }
  m.computeBoundingBox(); m.computeBoundingSphere();
  return m;
}
