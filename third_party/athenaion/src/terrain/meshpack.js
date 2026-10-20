// Terrain mesh packing (no three.js): quantised, grouped chunk meshes for the bake and the runtime.
//   position Float32×3, normal Int8×3 (normalised), ter Uint8×4 (cav, rock, (waterDist+30)/90, outcrop)
//   index Uint32 (group-local), table Int32 per group: [vStart, vCount, iStart, iCount, cell·1024, gx, gz, G]
//   (r5: the table was Float32 — at high quality the index total (≈ 46 M) passed 2^24, so the iStart of later
//    groups was rounded and their triangles were built from misaligned index triplets: the "broken
//    triangle shards" on the shot-2 island. Int32 is exact.)
import * as L from '../world/layout.js';
import { SHOTS } from '../world/shots.js';
import { hashString } from '../core/rng.js';

export const MESH_VERSION = 'm4';
/** source files whose content determines the meshed terrain */
export const MESH_SOURCES = ['src/world/heightfield.js', 'src/terrain/field.js', 'src/terrain/voxel.js', 'src/terrain/lod.js', 'src/terrain/farfield.js', 'src/terrain/meshpack.js'];

/** hash of everything the terrain mesh depends on; readText(path) → Promise<string> */
export async function meshInputsHash(readText, qname, planOpts) {
  let s = MESH_VERSION + '|' + qname + '|' + JSON.stringify(planOpts);
  for (const f of MESH_SOURCES) s += '|' + (await readText(f)).replace(/\r\n/g, '\n');
  s += JSON.stringify({
    A: L.ACROPOLIS, LG: L.LAGOON, I: L.ISLAND, R: L.RIVER, C: L.CHANNEL, S: L.SEA, RT: L.RUINS_TERRACE, H: L.HILL_TEMPLE,
    CI: L.CITY, M: L.MOUNTAINS, W: L.WATERFALLS, shots: SHOTS.map((q) => [q.pos, q.target, q.fov, q.near]),
  });
  return hashString(s).toString(36);
}
export function meshBakeName(qname, hash) { return `terrain-mesh-${qname}-${hash}`; }

/** group chunk results (from meshChunk) by draw batch */
export function groupResults(leaves, results) {
  const groups = new Map();
  leaves.forEach((l, i) => {
    const r = results[i];
    if (!r || !r.index.length) return;
    const G = l.cell <= 2 ? 256 : l.cell <= 8 ? 1024 : l.cell <= 32 ? 4096 : 16384;
    const gx = Math.floor(l.x0 / G), gz = Math.floor(l.z0 / G);
    const key = `${G}:${gx}:${gz}`;
    if (!groups.has(key)) groups.set(key, { G, gx, gz, cell: l.cell, list: [] });
    const g = groups.get(key); g.list.push(r); g.cell = Math.min(g.cell, l.cell);
  });
  return [...groups.values()];
}

/** pack grouped results into one quantised blob */
export function packGroups(groups) {
  let nv = 0, ni = 0;
  for (const g of groups) for (const r of g.list) { nv += r.position.length / 3; ni += r.index.length; }
  const position = new Float32Array(nv * 3), normal = new Int8Array(nv * 3), ter = new Uint8Array(nv * 4), index = new Uint32Array(ni);
  const table = new Int32Array(groups.length * 8);
  let ov = 0, oi = 0;
  groups.forEach((g, gi) => {
    const v0 = ov, i0 = oi;
    for (const r of g.list) {
      const n = r.position.length / 3;
      position.set(r.position, ov * 3);
      for (let k = 0; k < n * 3; k++) normal[ov * 3 + k] = Math.max(-127, Math.min(127, Math.round(r.normal[k] * 127)));
      for (let k = 0; k < n; k++) {
        const t = r.ter;
        ter[(ov + k) * 4] = Math.round(Math.min(1, Math.max(0, t[k * 4])) * 255);
        ter[(ov + k) * 4 + 1] = Math.round(Math.min(1, Math.max(0, t[k * 4 + 1])) * 255);
        ter[(ov + k) * 4 + 2] = Math.round(Math.min(1, Math.max(0, (t[k * 4 + 2] + 30) / 90)) * 255);
        ter[(ov + k) * 4 + 3] = Math.round(Math.min(1, Math.max(0, t[k * 4 + 3])) * 255);
      }
      for (let k = 0; k < r.index.length; k++) index[oi + k] = r.index[k] + (ov - v0);
      ov += n; oi += r.index.length;
    }
    table.set([v0, ov - v0, i0, oi - i0, Math.round(g.cell * 1024), g.gx, g.gz, g.G], gi * 8);
  });
  return { position, normal, ter, index, table };
}

/** split a packed blob back into per-group views (no copies) */
export function unpackGroups(p) {
  const out = [];
  for (let gi = 0; gi < p.table.length / 8; gi++) {
    const [v0, vn, i0, in_, cellQ, gx, gz, G] = p.table.subarray(gi * 8, gi * 8 + 8);
    // (Int32 table: cell stored ×1024; an old Float32 table stored the cell itself)
    const cell = p.table instanceof Int32Array ? cellQ / 1024 : cellQ;
    out.push({
      cell, key: `${G}:${gx}:${gz}`,
      position: p.position.subarray(v0 * 3, (v0 + vn) * 3),
      normal: p.normal.subarray(v0 * 3, (v0 + vn) * 3),
      ter: p.ter.subarray(v0 * 4, (v0 + vn) * 4),
      index: p.index.subarray(i0, i0 + in_),
    });
  }
  return out;
}
