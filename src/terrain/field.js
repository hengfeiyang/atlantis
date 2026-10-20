// adapted from athenaion/src/terrain/field.js
// CPU terrain detail shared by the mesher (main thread, workers, node bake; no three.js import):
//   rockDisp(x,y,z)  3D displacement of steep rock faces (m, + = outward): karst columns separated by deep
//                    joints, strata beds that step in/out (ledges, small overhangs), blocky masses, roughness.
//                    Leaves the crevice depth in CAV.
//   protectFlat(x,z) true where flat ground must stay exactly at heightAt() (plateau, ledges, quay band, land
//                    ring tops, outer city) — no rock debris / bulges there.
//   outcrop(x,z)     rock outcrops on the wild slopes (citadel benches, islets), 0 where protected.
//   faceAmp(x,z)     rock displacement amplitude (0 on built quay walls: citadel shore, canal sides).
//   waterSDF(x,z)    approx. signed horizontal distance to golden-era water (m, < 0 in water).
//   groundAt(x,z,era) the height the mesher meshes (golden: heightAt, sunken: + sand fill).
import { Simplex } from '../core/noise.js';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { sunkenGround } from './sand.js';
import { onCitadelSlope } from './shape.js';

const nA = new Simplex(31337), nB = new Simplex(4711), nC = new Simplex(8128), nD = new Simplex(1999);

export const DISP_MAX = 6.0; // bound of |rockDisp| (m)
const EDGE = 3.5;            // heightfield.js ring-edge width

export function groundAt(x, z, era) { return era === 'sunken' ? sunkenGround(x, z) : heightAt(x, z); }

function hash3(x, y, z, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// cellular noise (F1, F2 → sqrt) written to module scalars to avoid allocation
let F1 = 0, F2 = 0, CID = 0;
function cellular(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d1 = 9, d2 = 9, id = 0;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const px = cx + hash3(cx, cy, cz, 11) - x, py = cy + hash3(cx, cy, cz, 23) - y, pz = cz + hash3(cx, cy, cz, 37) - z;
    const d = px * px + py * py + pz * pz;
    if (d < d1) { d2 = d1; d1 = d; id = hash3(cx, cy, cz, 51); } else if (d < d2) d2 = d;
  }
  F1 = Math.sqrt(d1); F2 = Math.sqrt(d2); CID = id;
}

/** crevice depth (0..1) of the last rockDisp() evaluation */
export let CAV = 0;

// 2D cellular (plan view) for blocks within a bed
let B1 = 0, B2 = 0, BID = 0, BFX = 0, BFZ = 0;
function cell2(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z);
  let d1 = 9, d2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cz = zi + j;
    const px = cx + 0.1 + 0.8 * hash3(cx, seed, cz, 11), pz = cz + 0.1 + 0.8 * hash3(cx, seed, cz, 37);
    const dx = px - x, dz = pz - z, d = dx * dx + dz * dz;
    if (d < d1) { d2 = d1; d1 = d; BID = hash3(cx, seed, cz, 51); BFX = px; BFZ = pz; } else if (d < d2) d2 = d;
  }
  B1 = Math.sqrt(d1); B2 = Math.sqrt(d2);
}

/** blend toward the 2× coarser rock: 0 in the city (rings, citadel), 1 on the far islands / headlands */
export function rockBlend(x, z) {
  const d = Math.hypot(x, z);
  if (d < 1250) return 0;
  if (d > 1700) return 1;
  const u = (d - 1250) / 450;
  return u * u * (3 - 2 * u);
}
const S2A = 1.35; // displacement gain of the coarse (2×) rock
/** largest rock displacement (m) inside the box [x0,x1]×[z0,z1] */
export function dispMaxIn(x0, z0, x1, z1) {
  // the blend is radial: its maximum over the box is at the farthest point from the origin
  const fx = Math.max(Math.abs(x0), Math.abs(x1)), fz = Math.max(Math.abs(z0), Math.abs(z1));
  return DISP_MAX * (1 + rockBlend(fx, fz) * (S2A - 1));
}

function colRaw(x, z, out, o) {
  // karst columns (2D cells in plan, warped): 8–19 m wide, separated by fissures 1–2.4 m wide
  const wx = x + 5.0 * nC.noise2(x / 41, z / 41), wz = z + 5.0 * nC.noise2(x / 41 + 9.1, z / 41);
  const ps = 8 + 11 * (0.5 + 0.5 * nD.noise2(x / 150 + 4.2, z / 150));
  cellular(wx / ps, 0.37, wz / ps);
  const fd = (F2 - F1) * ps * 0.5;
  const fw = 0.5 + 0.7 * (0.5 + 0.5 * nB.noise2(x / 33, z / 33));
  const s = Math.min(1, fd / fw);
  out[o + 0] = s * (2 - s);
  out[o + 1] = 0.35 + 0.9 * CID;
  const sv = 0.5 + 0.5 * nD.noise2(x / 90 + 4.2, z / 90);
  out[o + 2] = 2.8 + 3.4 * sv;                                          // block width (m)
  out[o + 3] = 0.8 * nB.noise2(x / 41, z / 41) + 0.25 * nA.noise2(x / 9, z / 9); // bed phase
  out[o + 4] = 2.2 + 2.0 * (0.5 + 0.5 * nC.noise2(x / 70 - 2.2, z / 70 + 5.5)); // bed thickness (m)
  out[o + 5] = nA.noise2(x / 17 + 3.3, z / 17);
  out[o + 6] = nD.noise2(x / 27 + 1.1, z / 27 - 4.4);
  out[o + 7] = 0.5 + 0.5 * nB.noise2(x / 120 - 7.7, z / 120 + 1.9);   // blockiness
}
function dispRaw(col, off, x, y, z) {
  const colP = col[off], colA = col[off + 1], sx = col[off + 2], bt = col[off + 4], blk = col[off + 7];
  const wn = nC.noise3(x / 19, y / 23, z / 19);
  const fm = nA.noise3(x / 30 + 7.7, y / 24, z / 30);
  const fiss = fm < -0.3 ? 0 : fm > 0.3 ? 1 : (fm + 0.3) / 0.6;
  const pil = 1 - fiss * (1 - colP);
  const dCol = 1.7 * (pil * colA - 0.62);
  const by = (y + 1.7 * wn + 0.9 * col[off + 6]) / bt + col[off + 3];
  const bi = Math.floor(by), bf = by - bi;
  const jLo = hash3(bi, 9, 1, 5) < 0.72, jHi = hash3(bi + 1, 9, 1, 5) < 0.72;
  const qx = x + 1.6 * wn, qz = z - 1.4 * wn + 1.1 * col[off + 5];
  cell2(qx / sx + bi * 0.37, qz / sx - bi * 0.61, bi & 1023);
  const hd = (B2 - B1) * 0.5 * sx;
  const rh = 0.35 + 0.4 * (0.5 + 0.5 * wn);
  const jn = Math.min(hd / rh, jHi ? (1 - bf) * bt / 0.3 : 9, jLo ? bf * bt / 0.85 : 9);
  const s0 = Math.min(1, jn), sh = s0 * (2 - s0);
  const ih = Math.floor(BID * 1e6);
  const tx = hash3(ih, 1, 2, 61) - 0.5, tz = hash3(ih, 5, 6, 71) - 0.5, ty = hash3(ih, 3, 4, 67) - 0.5;
  const facet = (BID - 0.5) * 1.5 * blk + 0.6 * (tx * (qx / sx - BFX) + tz * (qz / sx - BFZ)) * sx + 0.25 * ty * (bf - 0.5) * bt;
  const bedP = (hash3(bi, 7, 3, 99) - 0.5) * 2.2;
  const under = bf < 0.16 ? 1 - bf / 0.16 : 0;
  const dBlk = sh * (facet + bedP + 0.5) - (0.35 + 0.55 * blk) * (1 - sh) - 0.45 * under * under;
  // big rounded masses / buttresses and recesses (ref 4: the ring faces bulge out in lumpy crags)
  const mass = 1.9 * nA.noise3(x / 24, y / 30, z / 24) + 0.6 * nD.noise3(x / 10, y / 14, z / 10);
  const rough = 0.07 * Math.sin(x * 2.3 + y * 1.7) * Math.sin(z * 2.1 - y * 1.3);
  // rounded crag lumps (3-6 m) with dark crevices between them (ref 4 ring faces, ref 1 islet boulders)
  cellular(x / 5.2 + 0.31 * wn, y / 4.2, z / 5.2 - 0.27 * wn);
  const gap = F2 - F1;
  const lump = 2.1 * (0.58 - F1) * (0.7 + 0.6 * CID) - 0.9 * (1 - Math.min(1, gap / 0.22));
  const d = dCol + 0.75 * dBlk + mass + lump + rough;
  CAV = Math.min(1, Math.max(0, (1 - pil) * 0.8 + (1 - sh) * (0.35 + 0.3 * blk) + under * 0.3 + 0.35 * (1 - Math.min(1, gap / 0.18)) - 0.1));
  return d;
}

// islets (ref 1): piled rounded granite-like blocks — the rock is evaluated 1.8× smaller there
const ISL = (L.ISLETS || []).map((I) => ({ x: I.center[0], z: I.center[1], r2: (I.r + 40) ** 2 }));
const IS_S = 1.25;
function islandScale(x, z) {
  if (Math.abs(z) < 700) return 1;
  for (const I of ISL) { const dx = x - I.x, dz = z - I.z; if (dx * dx + dz * dz < I.r2) return IS_S; }
  return 1;
}
/** per-column part of rockDisp (x,z only): out = [blend t, 8 fine-rock values, 8 coarse-rock values] */
export const COL_STRIDE = 17;
export function rockColumn(x, z, out = new Float32Array(COL_STRIDE)) {
  const t = rockBlend(x, z);
  out[0] = t;
  const s = islandScale(x, z);
  if (t < 1) colRaw(x / s, z / s, out, 1);
  if (t > 0) colRaw(x * 0.5, z * 0.5, out, 9);
  return out;
}
const _col = new Float32Array(COL_STRIDE);

/** rock displacement (m, + = outward) from a precomputed column; leaves the crevice depth in CAV */
export function rockDispC(col, off, x, y, z, amp = 1) {
  const t = col[off];
  let d = 0, cav = 0;
  if (t < 1) { const s = islandScale(x, z); d += (1 - t) * s * dispRaw(col, off + 1, x / s, y / s, z / s); cav += (1 - t) * CAV; }
  if (t > 0) { d += t * S2A * dispRaw(col, off + 9, x * 0.5, y * 0.5, z * 0.5); cav += t * CAV; }
  CAV = cav;
  d *= amp;
  const dm = DISP_MAX * (1 + t * (S2A - 1));
  return d > dm ? dm : d < -dm ? -dm : d;
}
export function rockDisp(x, y, z, amp = 1) { return rockDispC(rockColumn(x, z, _col), 0, x, y, z, amp); }

// ------------------------------------------------------------ zones
const C = L.CITADEL, T1 = C.terraces[0], T2 = C.terraces[1];
const LAND = L.RINGS.filter((g) => g.kind === 'land');
const K = L.SEA_CANAL, KHW = K.width / 2;
const SHEDS = L.SHIP_SHEDS || [];

const ST = L.CITADEL_STAIR;
function inStair(x, z, hw) { return !!ST && z > ST.from[2] - 6 && z < ST.to[2] + 4 && Math.abs(x - ST.x) < hw; }
function inCanal(x, z, pad) { return z > K.z0 - pad && z < 830 + pad && Math.abs(x - K.x) < KHW + EDGE + pad; }

/** true where flat ground must keep heightAt() exactly (buildings / paving / quays / camera platforms) */
export function protectFlat(x, z) {
  const r = Math.hypot(x, z);
  if (r < C.plateau + 0.5) return true;
  if (r > T1.r0 + 0.6 && r < T1.r1 - 0.6) return true;
  if (r > T2.r0 + 0.6 && r < T2.r1 - 0.6) return true;
  if (r > 214.6 && r < C.radius - 0.3) return true;                  // shore quay band
  for (const g of LAND) {
    if (r > g.r0 + EDGE + 0.6 && r < g.r1 - EDGE - 0.6 && !inCanal(x, z, 1)) return true;
  }
  const O = L.OUTER_CITY;
  if (r > O.r0 + EDGE + 0.6 && r < O.r1 && !L.inSeaSector(L.bearingOf(x, z))) return true;
  return false;
}

/** rock displacement amplitude by location: 0 on built quay walls, gentler where architecture abuts */
export function faceAmp(x, z) {
  // r3: grand stair + cheek beds (|x| ≲ 23): no rock bulges, fading back in beyond the corridor
  if (inStair(x, z, 38)) { const t = Math.min(1, Math.max(0, (Math.abs(x - ST.x) - 31) / 7)); return t * t * (3 - 2 * t) * faceAmp0(x, z); }
  return faceAmp0(x, z);
}
function faceAmp0(x, z) {
  const r = Math.hypot(x, z);
  if (r > C.radius - 6 && r < C.radius + 6) return 0;                   // citadel shore quay wall
  if (r > C.plateau - 2 && r < T1.r0 + 1.5) return 0;                   // r3: plateau retaining wall (masonry)
  if (inCanal(x, z, 6)) return 0;                                       // canal quays / tunnel / gate bridge
  if (r > 214 - 2 && r < C.radius) return 0.4;
  if (r < C.radius) return 0.8;                                          // r3: citadel hillside crags a bit calmer
  const O = L.OUTER_CITY;
  if (r > O.r0 - 6 && r < O.r0 + 8) return 0.25;                        // outer-city quays
  // ship-shed sectors (rings agent cuts arched openings into these faces): calmer rock
  for (const S of SHEDS) {
    const g = L.ringById(S.ring);
    if (!g) continue;
    const rf = S.face === 'inner' ? g.r0 : g.r1;
    if (Math.abs(r - rf) > 10) continue;
    const b = L.bearingOf(x, z);
    if (b >= S.bearings[0] - 2 && b <= S.bearings[1] + 2) return 0.75;
  }
  return 1;
}

/** rock outcrops (vertical relief, m, 0..~2.4) on the wild slopes: citadel benches and islets only */
export function outcrop(x, z) {
  const r = Math.hypot(x, z);
  let k0 = 0;
  if (onCitadelSlope(r) && r > T1.r0 && !inStair(x, z, 31)) k0 = 0.8;   // r3: none on the plateau retaining wall
  else if (r > 900 && islandScale(x, z) < 1) k0 = 1;
  if (k0 <= 0) return 0;
  const n = nD.fbm2(x / 38, z / 38, 3) + 0.35 * nC.noise2(x / 11, z / 11);
  if (n < 0.22) return 0;
  const k = Math.min(1, (n - 0.22) / 0.25);
  cellular(x / 4.5, 0.37, z / 4.5);
  const blk = Math.sqrt(Math.min(1, (F2 - F1) / 0.35));
  return k0 * k * k * (1.4 + 0.8 * CID) * (0.55 + 0.45 * blk);
}

// ------------------------------------------------------------ golden-era water distance
const WR = L.RINGS.filter((g) => g.kind === 'water');
/** approx. signed horizontal distance to golden-era water (m, negative in the water) */
export function waterSDF(x, z) {
  const r = Math.hypot(x, z);
  let d = 1e9;
  const sea = r > 700 && L.inSeaSector(L.bearingOf(x, z));
  if (sea) d = 820 - r;   // land ring 2 ends in the open sea
  for (const g of WR) {
    if (g.id === 'w3' && sea) continue;
    const dr = Math.max(g.r0 - r, r - g.r1);
    if (dr < d) d = dr;
  }
  if (z > K.z0 - 2) { const dc = Math.max(Math.abs(x - K.x) - KHW, K.z0 - z); if (dc < d) d = dc; }
  if (r > 780) {
    // sea, west sea, islands: from the height and its gradient
    const h = heightAt(x, z);
    if (h < 0) d = Math.min(d, h * 2.5);
    else {
      const e = 6, gx = heightAt(x + e, z) - heightAt(x - e, z), gz = heightAt(x, z + e) - heightAt(x, z - e);
      const g = Math.hypot(gx, gz) / (2 * e);
      d = Math.min(d, h / Math.max(0.03, g));
    }
  }
  return d;
}
