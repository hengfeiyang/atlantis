// CPU terrain detail shared by the mesher (main thread or workers, no three.js import):
//   rockDisp(x,y,z)  3D displacement of steep rock faces (metres, + = outward): vertical karst
//                    columns separated by deep joints, strata beds that step in/out (ledges and small
//                    overhangs), blocky masses and roughness. Also leaves the crevice depth in CAV.
//   protectFlat(x,z) true where flat ground must stay exactly at heightAt() (plateau, terrace ledges,
//                    ruins floor, island top, crag top, city) — no rock debris there.
//   outcrop(x,z)     gentle-slope limestone outcrops (vertical bumps), 0 where protected.
import { Simplex } from '../core/noise.js';
import * as L from '../world/layout.js';
import { sdPolygon } from '../world/heightfield.js';

const nA = new Simplex(31337), nB = new Simplex(4711), nC = new Simplex(8128), nD = new Simplex(1999);

export const DISP_MAX = 6.0; // bound of |rockDisp| (m)

function hash3(x, y, z, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// cellular noise (F1, F2 squared distances → sqrt) written to module scalars to avoid allocation
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

// fracture cells: nearest / second-nearest feature + the nearest cell's centre and id
let FX = 0, FY = 0, FZ = 0, FI = 0, FG1 = 0, FG2 = 0;
function fracture(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d1 = 9, d2 = 9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const px = cx + 0.15 + 0.7 * hash3(cx, cy, cz, 11), py = cy + 0.15 + 0.7 * hash3(cx, cy, cz, 23), pz = cz + 0.15 + 0.7 * hash3(cx, cy, cz, 37);
    const dx = px - x, dy = py - y, dz = pz - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < d1) { d2 = d1; d1 = d; FX = px; FY = py; FZ = pz; FI = hash3(cx, cy, cz, 51); }
    else if (d < d2) d2 = d;
  }
  FG1 = Math.sqrt(d1); FG2 = Math.sqrt(d2);
}

// 2D cellular (plan view) for blocks within a bed: F1/F2 distances + nearest cell id and feature point
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

/**
 * Rock face displacement (m). Bounded by ±DISP_MAX. `amp` scales it (terraces use less).
 * Bedded, jointed limestone (refs 3, 7, 9): warped strata beds 2.6–4.8 m thick, each split into rounded
 * blocks by vertical joints that are offset from bed to bed (stacked-block look), beds and blocks with
 * their own protrusion (ledges, small overhangs under protruding beds), karst columns separated by deep
 * vertical fissures that open and close along the height, big buttress / recess masses.
 */
/** blend toward the 2× coarser rock (0 around the acropolis / ruins / lagoon, 1 on the far crags and canyon
 *  walls that are only seen from 400–700 m and meshed with 2 m cells). Continuous in space, so every LOD
 *  meshes the same surface (fine and coarse rock are cross-faded, never coordinate-warped). */
export function rockBlend(x, z) {
  const d = Math.hypot(x - 10, z - 40);
  if (d < 270) return 0;
  if (d > 430) return 1;
  const u = (d - 270) / 160;
  return u * u * (3 - 2 * u);
}
/** largest rock displacement (m) inside the box [x0,x1]×[z0,z1] */
export function dispMaxIn(x0, z0, x1, z1) {
  // the blend is radial and monotonic, so its maximum over the box is at a corner
  let m = 0;
  for (let j = 0; j <= 1; j++) for (let i = 0; i <= 1; i++) m = Math.max(m, rockBlend(i ? x1 : x0, j ? z1 : z0));
  return DISP_MAX * (1 + m * (S2A - 1));
}

function colRaw(x, z, out, o) {
  // karst columns (2D cells in plan, warped): 8–19 m wide, separated by fissures 1–2.4 m wide
  const wx = x + 5.0 * nC.noise2(x / 41, z / 41), wz = z + 5.0 * nC.noise2(x / 41 + 9.1, z / 41);
  const ps = 8 + 11 * (0.5 + 0.5 * nD.noise2(x / 150 + 4.2, z / 150));
  cellular(wx / ps, 0.37, wz / ps);
  const fd = (F2 - F1) * ps * 0.5;                                  // ≈ metres to the fissure
  const fw = 0.5 + 0.7 * (0.5 + 0.5 * nB.noise2(x / 33, z / 33));   // fissure half-width (m)
  const s = Math.min(1, fd / fw);
  out[o + 0] = s * (2 - s);                                             // rounded column shoulders, 0 in the fissure
  out[o + 1] = 0.35 + 0.9 * CID;                                        // column protrusion factor
  const sv = 0.5 + 0.5 * nD.noise2(x / 90 + 4.2, z / 90);
  out[o + 2] = 2.8 + 3.4 * sv;                                          // block width (m)
  out[o + 3] = 0.8 * nB.noise2(x / 41, z / 41) + 0.25 * nA.noise2(x / 9, z / 9); // bed phase
  out[o + 4] = 2.6 + 2.2 * (0.5 + 0.5 * nC.noise2(x / 70 - 2.2, z / 70 + 5.5)); // bed thickness (m)
  out[o + 5] = nA.noise2(x / 17 + 3.3, z / 17);                         // warp terms (column-constant)
  out[o + 6] = nD.noise2(x / 27 + 1.1, z / 27 - 4.4);
  out[o + 7] = 0.5 + 0.5 * nB.noise2(x / 120 - 7.7, z / 120 + 1.9);   // blockiness (0 = massive, 1 = blocky)
}
function dispRaw(col, off, x, y, z) {
  const colP = col[off], colA = col[off + 1], sx = col[off + 2], bt = col[off + 4], blk = col[off + 7];
  const wn = nC.noise3(x / 19, y / 23, z / 19);
  // ---- karst columns: fissures open and close along the height, so columns merge into masses
  const fm = nA.noise3(x / 30 + 7.7, y / 24, z / 30);
  const fiss = fm < -0.3 ? 0 : fm > 0.3 ? 1 : (fm + 0.3) / 0.6;
  const pil = 1 - fiss * (1 - colP);
  const dCol = 3.0 * (pil * colA - 0.62);
  // ---- strata beds (warped), each split into blocks by offset vertical joints
  const by = (y + 1.7 * wn + 0.9 * col[off + 6]) / bt + col[off + 3];
  const bi = Math.floor(by), bf = by - bi;
  const jLo = hash3(bi, 9, 1, 5) < 0.72, jHi = hash3(bi + 1, 9, 1, 5) < 0.72; // some bedding planes are fused
  const qx = x + 1.6 * wn, qz = z - 1.4 * wn + 1.1 * col[off + 5];
  cell2(qx / sx + bi * 0.37, qz / sx - bi * 0.61, bi & 1023);
  const hd = (B2 - B1) * 0.5 * sx;                                  // metres to the vertical joint
  // joint shoulders (normalised): sharp top edges of the beds (lit ledges), rounded undercut bottoms
  const rh = 0.35 + 0.4 * (0.5 + 0.5 * wn);
  const jn = Math.min(hd / rh, jHi ? (1 - bf) * bt / 0.3 : 9, jLo ? bf * bt / 0.85 : 9);
  const s0 = Math.min(1, jn), sh = s0 * (2 - s0);
  const ih = Math.floor(BID * 1e6);
  // per-block protrusion + a tilted planar face (angular, not blobby)
  const tx = hash3(ih, 1, 2, 61) - 0.5, tz = hash3(ih, 5, 6, 71) - 0.5, ty = hash3(ih, 3, 4, 67) - 0.5;
  const facet = (BID - 0.5) * 1.5 * blk + 0.6 * (tx * (qx / sx - BFX) + tz * (qz / sx - BFZ)) * sx + 0.25 * ty * (bf - 0.5) * bt;
  const bedP = (hash3(bi, 7, 3, 99) - 0.5) * 2.2;                   // whole beds step in / out (ledges, overhangs)
  const under = bf < 0.16 ? 1 - bf / 0.16 : 0;                      // undercut at the base of each bed
  const dBlk = sh * (facet + bedP + 0.5) - (0.35 + 0.55 * blk) * (1 - sh) - 0.45 * under * under;
  // ---- big masses (buttresses / recesses) and fine roughness
  // (vertically elongated: buttresses and recesses rather than round bulges)
  const mass = 1.1 * nA.noise3(x / 30, y / 75, z / 30) + 0.35 * nD.noise3(x / 13, y / 30, z / 13);
  const rough = 0.07 * Math.sin(x * 2.3 + y * 1.7) * Math.sin(z * 2.1 - y * 1.3);
  let d = dCol + dBlk + mass + rough;
  CAV = Math.min(1, Math.max(0, (1 - pil) * 1.1 + (1 - sh) * (0.45 + 0.35 * blk) + under * 0.35 - 0.05));
  return d;
}

const S2A = 1.35; // displacement gain of the coarse (2×) rock (features twice as large, relief 1.35× deeper)
// r5: the island rock (ref 2) is a 10 m outcrop of rounded 2–4 m limestone blocks: the cliff-scale rock (8–19 m
// columns, 3–5 m beds, ±6 m) turned it into a few smooth slabs. Inside the island zone the rock is evaluated
// 1.8× smaller (features and relief; meshed at 0.5 m, lod.js). The zone ends in deep lagoon water (≈ −10 m),
// where the switch is unseen.
const IS_C = L.ISLAND.center, IS_R2 = (L.ISLAND.radius + 45) ** 2, IS_S = 0.55;
function islandScale(x, z) { const dx = x - IS_C[0], dz = z - IS_C[1]; return dx * dx + dz * dz < IS_R2 ? IS_S : 1; }
/** per-column part of rockDisp (depends on x,z only): call once per column, pass to rockDispC.
 *  out = [blend t, 8 values of the fine rock, 8 values of the 2× coarse rock] */
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

/** rock displacement (m, + = outward) from a precomputed column (see rockColumn); leaves the crevice depth in CAV */
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

/** Rock face displacement (m) at a point (convenience: column + sample). */
export function rockDisp(x, y, z, amp = 1) {
  return rockDispC(rockColumn(x, z, _col), 0, x, y, z, amp);
}

// ------------------------------------------------------------ protected flat zones
const A = L.ACROPOLIS;
const city = L.CITY.outline;
/** true where flat ground must keep heightAt() exactly (buildings / paving / camera platforms) */
export function protectFlat(x, z) {
  // acropolis plateau + south terraces
  if (x > -200 && x < 260 && z > -240 && z < 260) {
    const d = sdPolygon(x, z, A.outline);
    if (d < 4) return true;
    if (z > -10 && d < 150 && x > -170 && x < 220) return true; // terraced south face (ledges)
  }
  // ruins terrace floor
  const R = L.RUINS_TERRACE;
  if (Math.hypot(x - R.center[0], z - R.center[1]) < R.radius + 4) return true;
  // island top
  const I = L.ISLAND;
  if (Math.hypot(x - I.center[0], z - I.center[1]) < I.radius - 1) return true; // (the rocky flanks are free)
  // hill temple summit platform + the old west crag top + hilltop temples
  const C = L.HILL_TEMPLE;
  if (Math.hypot(x - C.center[0], z - C.center[1]) < 54) return true;
  if (Math.hypot(x + 650, z + 700) < 80) return true;
  if (Math.hypot(x + 760, z + 1060) < 28 || Math.hypot(x + 855, z + 450) < 24) return true;
  // city
  if (x < -360 && x > -1400 && z > -600 && z < 600 && sdPolygon(x, z, city) < 10) return true;
  return false;
}

/** limestone outcrops on gentle wild slopes: vertical relief (m) to add, 0..~2.4 */
export function outcrop(x, z) {
  const n = nD.fbm2(x / 38, z / 38, 3) + 0.35 * nC.noise2(x / 11, z / 11);
  if (n < 0.28) return 0;
  const k = Math.min(1, (n - 0.28) / 0.25);
  cellular(x / 4.5, 0.37, z / 4.5);
  const blk = Math.sqrt(Math.min(1, (F2 - F1) / 0.35));
  return k * k * (1.6 + 0.8 * CID) * (0.55 + 0.45 * blk);
}
