// Terrain height function h(x, z) composed from the master plan (layout.js).
// Pure + deterministic: placement code everywhere calls heightAt() to sit things on the ground.
// OWNER: director (near-field shapes: acropolis, ruins promontory, lagoon, hill temple crag) — the
// mountain functions (mountainEnvelope, mountainsAnalytic, far grid, farLand, farHeightAnalytic) belong
// to the mountains agent. The terrain module meshes this function and adds 3D rock detail on steep
// faces (strata, joints, overhangs) on top of it — flat ground (plateau, terrace ledges, shores,
// plazas) matches heightAt() exactly.
//
// Anchors other modules rely on (all read from layout.js): acropolis plateau y = ACROPOLIS.top (66)
// inside ACROPOLIS.outline, terrace ledges at y ≈ 51 / 37 / 24 / 12 on the south face (sector
// ACROPOLIS.terraceSector), the grand-stair spur along x = GRAND_STAIR.x, water below y = 0,
// RUINS_TERRACE top (52) inside RUINS_TERRACE.outline, HILL_TEMPLE top (112), ISLAND top (8).
//
// Far field: the mountains are generated analytically here; the terrain module bakes an eroded version
// of the far field (generated/terrain-far-*.bin) and registers it with setFarGrid(), after which
// heightAt() returns the eroded heights there (the near field is never affected).
import { noiseA, noiseB, noiseC, Simplex, smoothstep, clamp, lerp, smin, smax } from '../core/noise.js';
import * as L from './layout.js';

// ------------------------------------------------------------ 2D distance helpers
export function sdPolygon(px, pz, poly) {
  let d = Infinity, s = 1;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i++) {
    const ax = poly[i][0], az = poly[i][1], bx = poly[j][0], bz = poly[j][1];
    const ex = bx - ax, ez = bz - az, wx = px - ax, wz = pz - az;
    const t = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1);
    const dx = wx - ex * t, dz = wz - ez * t;
    const dd = dx * dx + dz * dz;
    if (dd < d) d = dd;
    const c1 = pz >= az, c2 = pz < bz, c3 = ex * wz > ez * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

/** distance to a polyline; returns { d, t } where t∈[0,1] is the arc-length parameter */
export function distPolyline(px, pz, pts) {
  let best = Infinity, bestT = 0, total = 0;
  const lens = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lens.push(l); total += l;
  }
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const ex = bx - ax, ez = bz - az;
    const t = clamp(((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez), 0, 1);
    const dx = px - ax - ex * t, dz = pz - az - ez * t;
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; bestT = (acc + t * lens[i]) / total; }
    acc += lens[i];
  }
  return { d: Math.sqrt(best), t: bestT };
}

export function sdEllipse(px, pz, cx, cz, rx, rz) {
  const qx = (px - cx) / rx, qz = (pz - cz) / rz;
  return (Math.hypot(qx, qz) - 1) * Math.min(rx, rz);
}

// fast polyline (precomputed segments, no allocation). Writes the arc parameter to _polyT.
let _polyT = 0;
function prepLine(pts) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], ex = pts[i + 1][0] - ax, ez = pts[i + 1][1] - az;
    const len = Math.hypot(ex, ez);
    segs.push({ ax, az, ex, ez, inv: 1 / (ex * ex + ez * ez), len, acc: total });
    total += len;
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return { segs, total, minX, maxX, minZ, maxZ };
}
function polyDist(px, pz, P) {
  let best = Infinity, bt = 0;
  const S = P.segs;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    let t = ((px - s.ax) * s.ex + (pz - s.az) * s.ez) * s.inv;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - s.ax - s.ex * t, dz = pz - s.az - s.ez * t;
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; bt = s.acc + t * s.len; }
  }
  _polyT = bt / P.total;
  return Math.sqrt(best);
}
/** lower bound of the distance from (x,z) to a polyline's bounding box */
function boxDist(px, pz, P) {
  const dx = Math.max(P.minX - px, 0, px - P.maxX), dz = Math.max(P.minZ - pz, 0, pz - P.maxZ);
  return Math.hypot(dx, dz);
}

function sampleArray(arr, t) {
  const f = t * (arr.length - 1), i = Math.min(arr.length - 2, Math.floor(f));
  return lerp(arr[i], arr[i + 1], f - i);
}

const RIV = prepLine(L.RIVER.points);
const LB = L.LAGOON.basin || [-100, 72, 92, 84]; // western basin ellipse [cx, cz, rx, rz]
const CHN = prepLine(L.CHANNEL.points);
const noiseD = new Simplex(9001), noiseE = new Simplex(5150), noiseF = new Simplex(2718);

// ------------------------------------------------------------ water
/** signed distance to all water (river + lagoon + channel + sea); negative = in water */
export function waterSDF(x, z) {
  let d = 1e9;
  // river
  if (boxDist(x, z, RIV) < 400) {
    const dr = polyDist(x, z, RIV);
    d = dr - sampleArray(L.RIVER.width, _polyT) * 0.5 + 2.5 * noiseA.noise2(x / 40, z / 40);
  }
  // lagoon gorge along the south face (ellipse with a ragged shore) + the western basin at the river
  // mouth (island tholos) which drains south-west into the channel
  const La = L.LAGOON;
  let de = sdEllipse(x, z, La.center[0], La.center[1], La.radii[0], La.radii[1]);
  de = smin(de, sdEllipse(x, z, LB[0], LB[1], LB[2], LB[3]), 30);
  if (de < d + 30) d = Math.min(d, de + 9 * noiseA.fbm2(x / 90, z / 90, 3) + 2.5 * noiseB.noise2(x / 22, z / 22));
  // channel to the sea (widening)
  if (boxDist(x, z, CHN) < 400) {
    const dc = polyDist(x, z, CHN);
    d = Math.min(d, dc - L.CHANNEL.width * 0.5 * (1 + _polyT * 1.5) + 4 * noiseB.noise2(x / 60, z / 60));
  }
  // open sea to the south (noisy coastline)
  const S = L.SEA;
  const ds = S.southZ - z;
  if (ds < d + 140) d = Math.min(d, ds + 120 * noiseB.fbm2(x / 700, 0.7, 3) + 18 * noiseC.noise2(x / 120, z / 120));
  // harbour bay to the south-west
  const db = sdEllipse(x, z, S.bay.center[0], S.bay.center[1], S.bay.radii[0], S.bay.radii[1]);
  if (db < d + 70) d = Math.min(d, db + 60 * noiseC.fbm2(x / 300, z / 300, 3));
  return d;
}

// ------------------------------------------------------------ land components
function baseLand(x, z) {
  // rolling coastal land, rising toward the north (mountain foothills) and west (city hills)
  const north = smoothstep(400, -2600, z);
  const rise = north * 190 + smoothstep(-300, -1600, x) * 70 + smoothstep(300, 1600, x) * smoothstep(600, -800, z) * 60;
  const n1 = noiseA.fbm2(x / 520, z / 520, 4);
  const n2 = noiseB.fbm2(x / 110, z / 110, 3);
  return 16 + rise + (16 + 50 * north) * n1 + 5 * n2;
}

function hillsWest(x, z) {
  // the city hills: a broad ridge west of the canyon sloping south-west to the harbour
  const ridgeD = Math.abs(x + 760 + 120 * noiseA.fbm2(z / 900, 0.3, 2));
  const k = smoothstep(700, 0, ridgeD) * smoothstep(780, -200, z);
  const west = smoothstep(-60, -420, x);
  return (20 + smoothstep(300, -900, z) * 60) * west + k * smoothstep(100, -250, x) * (95 + 40 * noiseB.fbm2(x / 400, z / 400, 3));
}
/** 0 = river bed depth, 1 = open-sea depth */
function seaFloorMix(x, z) {
  return Math.max(smoothstep(L.SEA.southZ - 420, L.SEA.southZ - 120, z), smoothstep(-640, -900, x) * smoothstep(-300, 100, z));
}

// ------------------------------------------------------------ mountains (analytic far field)
// Massif placement controls the composition seen from the shot cameras (round-1 layout: the cameras
// stand south / south-east of the temple and look W … NNE). [azimuth (compass deg, from the acropolis),
// distance (m), height (m), radius (m)]:
//   W  (az 262-296): the tallest wall behind the city — right half of ref 1 (summit ≈ 17° up from shot 1)
//   NW (az 300-340): main range behind the temple in refs 3, 8, 9 (≈ 11-13° up from the ruins terrace)
//   N / NNE (az 340-60): behind the stair / hill temple in refs 2, 5, 6, 7, tapering to the east
//   SW (az 215-250): the range descends toward the sea (left of ref 1)
//   front ranges: forested foothills 5-7 km out (layered ridges); back ranges 16-19 km (hazy)
// The whole range follows layout.MOUNTAINS: distances × (nearDist / 2600), heights × (peak / 2900),
// optional azimuth offset MOUNTAINS.azOffset (deg) — the far bake follows automatically.
const AC = L.ACROPOLIS.center;
const MT = L.MOUNTAINS || {};
const MT_DS = (MT.nearDist ?? 2600) / 2600, MT_HS = (MT.peak ?? 2900) / 2900, MT_AZ = MT.azOffset ?? 0;
/** centre azimuth of the range (compass deg) */
export const MT_CENTER = 315 + MT_AZ;
// massifs are elongated along the range (tangentially) with broad bell profiles — summits, arêtes and
// valleys come from the erosion bake (src/terrain/farfield.js)
// r2: the backdrop of shots 3/5/6/8/9 (az 300-345) is the HERO massif (below) standing alone: the main
// range behind it is pushed back/lowered so the hero's pyramid dominates, the front ranges there are low
// forested ridges (they used to hide the lower 2/3 of the faces). The W wing descends to the sea (ref 1:
// 287° ≈ 11°, 275° ≈ 8°, 266° ≈ 5.5°, 245° ≈ sea horizon as seen from shot 1).
// r3: skyline fitted to the frozen cameras (median of refs 1/2/3/5/8/9; refs 6/7 want 25-33° and cannot be
// met without cropping 3/8/9): W shoulder lowered at 297-303° (refs 3/8/9) but kept at 285-293° (ref 1).
export const PEAKS = [
  // main range
  [222, 13500, 300, 2600], [236, 13500, 450, 2600], [249, 13500, 650, 2600], [261, 13500, 950, 2600],
  [273, 13500, 1650, 2700], [285, 14000, 2150, 2200], [293, 14000, 2300, 1800], [301, 14500, 1650, 2800], [322, 16500, 3000, 3200],
  [343, 12500, 2650, 2600], [358, 12500, 2450, 2800], [11, 11500, 2600, 2600], [26, 12300, 2500, 2700],
  [42, 13300, 2250, 2900], [58, 14300, 1900, 3000], [74, 15500, 1500, 3200],
  // front ranges (forested foothills)
  [272, 6200, 700, 1900], [299, 6500, 520, 1900], [349, 6600, 800, 2000],
  [13, 6600, 1300, 2100], [38, 7400, 1150, 2100],
  // back ranges
  [266, 19000, 1500, 3600], [281, 19000, 2300, 3800], [300, 19500, 2200, 4000], [336, 19500, 2900, 3800], [5, 17500, 2800, 3800], [40, 18500, 2500, 3800],
].map(([az, dist, h, r], i) => {
  const a = ((az + MT_AZ) * Math.PI) / 180;
  return { x: AC[0] + Math.sin(a) * dist * MT_DS, z: AC[1] - Math.cos(a) * dist * MT_DS, h: h * MT_HS, r: r * MT_DS, ux: Math.sin(a), uz: -Math.cos(a), phase: i * 1.7, k: 3 + (i % 2) };
});
const MT_MIN_DIST = 2400 * MT_DS; // no mountain influence closer than this to the acropolis

// hero massif (layout MOUNTAINS.hero): a dominant pyramid with arêtes radiating from the summit, plus
// optional sub-summits (hero.subs, same fields) joined to it by high crests — summit cones plus ridge
// prisms whose crests fall from each summit to the spur ends (sharp crests, ~35° flanks). The erosion
// bake carves the valleys / couloirs between the spurs.
function heroSummit(h) {
  const a = ((h.az + MT_AZ) * Math.PI) / 180;
  const spurs = (h.spurs || []).map(([b, len, end, wk, top, shape]) => {
    const r = ((b + MT_AZ) * Math.PI) / 180;
    return { dx: Math.sin(r), dz: -Math.cos(r), L: len * MT_DS, e: end, wk: wk ?? 1, top: top ?? 0.9, convex: shape === 1 };
  });
  const reach = Math.max(h.cone, ...spurs.map((s) => s.L * 1.2 + 3500)) * MT_DS;
  return { x: AC[0] + Math.sin(a) * h.dist * MT_DS, z: AC[1] - Math.cos(a) * h.dist * MT_DS, H: h.peak * MT_HS, Rc: h.cone * MT_DS, pw: h.pow ?? 1.35, fl: h.flank ?? 1.3, spurs, reach };
}
export const HERO = (() => {
  const h = MT.hero; if (!h) return null;
  const main = heroSummit(h);
  return { ...main, summits: [main, ...(h.subs || []).map(heroSummit)] };
})();
function summitEnvelope(Hr, x, z) {
  const dx = x - Hr.x, dz = z - Hr.z, d = Math.hypot(dx, dz);
  if (d > Hr.reach) return 0;
  let e = 0;
  const q = d / Hr.Rc;
  if (q < 1) e = Hr.H * Math.pow(1 - q, Hr.pw);
  for (let i = 0; i < Hr.spurs.length; i++) {
    const S = Hr.spurs[i];
    const s = dx * S.dx + dz * S.dz;
    if (s < -400) continue;
    const u = Math.max(0, s) / S.L;
    if (u > 1.2) continue;
    const n = Math.abs(-dx * S.dz + dz * S.dx);
    // crest: summit → spur end, slightly convex shoulders, rounded off past the end
    const um = Math.min(1, u), fall = S.convex ? um * um * (3 - 2 * um) : 1 - Math.pow(1 - um, 1.15);
    const crest = Hr.H * (S.e + (S.top - S.e) * (1 - fall)) * (u > 1 ? smoothstep(1.2, 1, u) : 1) * (s < 0 ? smoothstep(-400, 0, s) : 1);
    const w = (crest / 0.55) * S.wk;
    if (n >= w) continue;
    const v = crest * Math.pow(1 - n / w, Hr.fl);
    if (v > e) e = v;
  }
  return e;
}
/** hero massif envelope (m), 0 outside */
export function heroEnvelope(x, z) {
  const Hr = HERO; if (!Hr) return 0;
  let e = 0;
  for (let k = 0; k < Hr.summits.length; k++) { const v = summitEnvelope(Hr.summits[k], x, z); if (v > e) e = v; }
  return e;
}

/** hero envelope in the (lightly) warped frame used by mountainEnvelope; wx/wz: optional precomputed warp */
export function heroAt(x, z, wx, wz) {
  if (!HERO) return 0;
  if (wx === undefined) { wx = x + 900 * noiseB.fbm2(x / 6500, z / 6500, 3); wz = z + 900 * noiseC.fbm2(x / 6500 + 3.1, z / 6500, 3); }
  return heroEnvelope(x + 0.35 * (wx - x), z + 0.35 * (wz - z));
}

/** smooth massif envelope (m): where and how high the mountains are (no ridges/valleys yet) */
export function mountainEnvelope(x, z) {
  const rx = x - AC[0], rz = z - AC[1];
  const r = Math.hypot(rx, rz);
  if (r < MT_MIN_DIST) return 0;
  const wx = x + 900 * noiseB.fbm2(x / 6500, z / 6500, 3);
  const wz = z + 900 * noiseC.fbm2(x / 6500 + 3.1, z / 6500, 3);
  let e4 = 0;
  for (let i = 0; i < PEAKS.length; i++) {
    const P = PEAKS[i];
    const dx = wx - P.x, dz = wz - P.z;
    const R = P.r * 1.5;
    if (dx * dx + dz * dz >= R * R * 1.8) continue;
    // radial (away from the acropolis) / tangential frame: long along the range, steeper toward the viewers
    const dr = dx * P.ux + dz * P.uz, dt = -dx * P.uz + dz * P.ux;
    const qr = dr / (R * (dr < 0 ? 0.8 : 1.05)), qt = dt / (R * 1.3);
    const d2 = qr * qr + qt * qt;
    if (d2 >= 1) continue;
    const c = P.h * Math.pow(1 - d2, 1.7) * (1 + 0.15 * Math.sqrt(d2) * (1 - d2));
    const c2 = c * c; e4 += c2 * c2;
  }
  // hero massif (lightly warped so the spurs bend a little)
  if (HERO) { const hv = heroAt(x, z, wx, wz); const h2 = hv * hv; e4 += h2 * h2; }
  // continuous base belt along the range
  const rel = ((Math.atan2(rx, -rz) * 180 / Math.PI - MT_CENTER) % 360 + 540) % 360 - 180;
  const azMask = smoothstep(-110, -85, rel) * smoothstep(125, 95, rel);
  const band = 1150 * MT_HS * azMask * Math.exp(-Math.pow((r - 10500 * MT_DS) / (3800 * MT_DS), 2)) * (0.7 + 0.6 * noiseA.fbm2(x / 3000, z / 3000, 2));
  const b2 = band * band; e4 += b2 * b2;
  return Math.pow(e4, 0.25) * smoothstep(MT_MIN_DIST, MT_MIN_DIST + 1800 * MT_DS, r);
}

/** analytic mountain height (fallback before the eroded far field is loaded); -1e9 where none */
export function mountainsAnalytic(x, z) {
  const E = mountainEnvelope(x, z);
  if (E < 1) return -1e9;
  const wx = x + 600 * noiseE.fbm2(x / 4000, z / 4000, 2), wz = z + 600 * noiseF.fbm2(x / 4000, z / 4000, 2);
  const R1 = noiseC.ridged2(wx / 2600, wz / 2600, 5, 2.05, 0.5);
  return E * (0.42 + 0.62 * R1) + 60 * noiseB.fbm2(x / 700, z / 700, 3);
}

// ------------------------------------------------------------ far grid (baked eroded far field)
let FAR = null; // { x0, z0, cell, nx, nz, data: Float32Array }
/** register the eroded far-field height grid (from the terrain module). */
export function setFarGrid(g) { FAR = g; }
export function getFarGrid() { return FAR; }
/** blend weight (0 near field … 1 far field) — the near field is always analytic */
export function farWeight(x, z) {
  const qx = Math.abs(x + 400) - 1450, qz = Math.abs(z + 150) - 1400;
  const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  return smoothstep(250, 900, d);
}
function farSample(x, z) {
  const g = FAR;
  const fx = (x - g.x0) / g.cell, fz = (z - g.z0) / g.cell;
  if (fx < 0 || fz < 0 || fx >= g.nx - 1 || fz >= g.nz - 1) return null;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const o = j * g.nx + i, D = g.data;
  return (D[o] * (1 - tx) + D[o + 1] * tx) * (1 - tz) + (D[o + g.nx] * (1 - tx) + D[o + g.nx + 1] * tx) * tz;
}

// ------------------------------------------------------------ rock formations
/** height profile of the terraced south face, as a function of distance outside the rim.
 *  Ledge widths vary along the face (wk: per-ledge width multipliers), cliffs between are near-sheer. */
function terraceProfile(d, top, wk) {
  let h = top, pos = 0;
  const T = L.ACROPOLIS.terraces;
  for (let k = 0; k < T.length; k++) {
    const t = T[k];
    if (d < pos + t.run) {
      const s = smoothstep(pos, pos + t.run, d);
      return h - t.drop * Math.pow(s, 0.8);
    }
    pos += t.run; h -= t.drop;
    const lw = t.ledge * wk[k];
    if (d < pos + lw) return h - 0.04 * (d - pos); // ledge, slight outward slope
    pos += lw;
  }
  // last drop into the lagoon: a sheer rock foot, then the lagoon floor
  if (d < pos + 4) return h - (h + 1.5) * Math.pow(smoothstep(pos, pos + 4, d), 0.9);
  return -1.5 - (d - pos - 4) * 0.45;
}

/**
 * (terrain-near) Stepped limestone cliff: from the rim (d = 0, yTop) outward, near-vertical bands
 * (band heights bh0 … bh0+bhR m, wall run wallK·height) separated by narrow benches (bench widths
 * benchK × 0.8–4 m, slightly outward-sloping with a small lip) down to yBot. Band heights and bench
 * widths vary smoothly along the face, so ledges rise and fall like real bedding benches — vegetation
 * finds footholds every 8–15 m of height (vegetation/scatter.js reads heightAt()).
 * Returns the height, or NaN past the cliff foot (then BC_END = horizontal end, BC_Y = foot height).
 */
let BC_END = 0, BC_Y = 0;
function benchedCliff(d, yTop, yBot, x, z, seed, wallK = 0.11, benchK = 1, bh0 = 8, bhR = 6, sc = 1) {
  let y = yTop, pos = 0;
  for (let k = 0; k < 12; k++) {
    const left = y - yBot;
    if (left <= 0.01) break;
    const nk = 0.5 + 0.5 * noiseE.noise2(x / (55 * sc) + k * 3.7 + seed, z / (55 * sc) - k * 1.3);
    let dh = bh0 + bhR * nk;
    if (left < dh * 1.45) dh = left;
    const run = wallK * dh + 0.5;
    if (d < pos + run) return y - dh * Math.pow(smoothstep(pos, pos + run, d), 0.85);
    pos += run; y -= dh;
    if (y <= yBot + 0.01) break;
    const wb = benchK * (0.8 + 3.2 * Math.pow(0.5 + 0.5 * noiseF.noise2(x / (38 * sc) - k * 2.9, z / (38 * sc) + seed + k), 1.5));
    if (d < pos + wb) { const u = (d - pos) / wb; return y + 0.35 * Math.sin(Math.PI * u) - 0.5 * u; }
    pos += wb; y -= 0.5;
  }
  BC_END = pos; BC_Y = y;
  return NaN;
}

/** sheer cliff profile (non-terraced sides): rounded rim, stepped cliff bands with benches, talus */
function sheerProfile(d, top, x, z) {
  const nb = noiseD.fbm2(x / 90, z / 90, 2);
  const talusTop = 3 + 6 * (0.5 + 0.5 * nb);
  const h = benchedCliff(d, top, talusTop, x, z, 0.0);
  if (h === h) return h;
  return BC_Y - (d - BC_END) * 0.8; // talus at ~38°
}

/** plan-view buttresses and gullies on sheer faces (m added to the outline distance, 0 at the rim) */
function cliffRibs(x, z, d) {
  if (d <= 0.3) return 0;
  const k = smoothstep(0.3, 6, d);
  const n1 = noiseC.noise2(x / 27 + 5.3, z / 27 - 1.1);
  const g = 1 - Math.abs(noiseD.noise2(x / 19 + 3.1, z / 19 + 7.7));
  return k * (2.6 * n1 + 4.5 * g * g * g * g - 1.2);
}

/** grand stair spur: the stair profile (mirrors acropolis/stair.js planStair: landings at every
 *  terrace level, flights of riser/tread split by half-landings, a quay at the bottom) */
export const STAIR_PROFILE = (() => {
  const GS = L.GRAND_STAIR, A = L.ACROPOLIS;
  const riser = GS.riser ?? 0.19, tread = GS.tread ?? 0.27, land = GS.landing ?? 7, mid = GS.midLanding ?? 2.8;
  const lv = [A.top]; let hh = A.top; for (const t of A.terraces) { hh -= t.drop; lv.push(hh); }
  lv.push(GS.yBottom ?? 2);
  const pts = [[GS.zTop - 30, A.top], [GS.zTop, A.top]];
  let z = GS.zTop, y = A.top;
  for (let k = 1; k < lv.length; k++) {
    const yN = lv[k];
    const parts = Math.max(1, Math.ceil((y - yN) / (GS.flightRise ?? 8.5)));
    for (let p = 0; p < parts; p++) {
      const yB = y - ((y - yN) * (p + 1)) / parts;
      const n = Math.max(1, Math.round(((y - yN) / parts) / riser));
      z += n * tread; pts.push([z, yB]);
      if (p < parts - 1) { z += mid; pts.push([z, yB]); }
    }
    y = yN;
    z += k === lv.length - 1 ? 9 : land; pts.push([z, y]);
  }
  return pts;
})();
function stairLine(z) {
  const P = STAIR_PROFILE;
  if (z <= P[0][0]) return P[0][1];
  for (let i = 0; i < P.length - 1; i++) if (z <= P[i + 1][0]) return lerp(P[i][1], P[i + 1][1], (z - P[i][0]) / (P[i + 1][0] - P[i][0]));
  return P[P.length - 1][1];
}
const STAIR_END = STAIR_PROFILE[STAIR_PROFILE.length - 1][0];
const SPUR_END = L.GRAND_STAIR.spurEnd ?? 52; // z where the stair leaves the rock and becomes a viaduct
function stairSpur(x, z) {
  const GS = L.GRAND_STAIR;
  const ax = Math.abs(x - GS.x);
  if (ax > 40 || z < GS.zTop - 5 || z > SPUR_END + 20) return -1e9;
  // spur crest 1.2 m under the stair line inside the terraced face; beyond the face foot the stair
  // rides its own arcaded substructure over the lagoon (refs 2, 4, 7), so the spur dives into the water
  // (kept a few metres under the stair: the acropolis module plans its own flights from the wall levels,
  //  its cheek walls / arcades fill down to this ground)
  const yc = Math.min(stairLine(Math.min(z, STAIR_END)) - 1.2, GS.yTop - (z - GS.zTop) * 0.6 - 4) - Math.max(0, z - SPUR_END) * 2.5;
  const halfW = 12 + 2 * noiseC.noise2(z / 30, 4.2);
  const fl = Math.max(0, ax - halfW);
  return yc - fl * 5.0 - 0.1 * fl * fl;
}

function acropolis(x, z) {
  const A = L.ACROPOLIS;
  // cheap reject: outside the outline bbox + apron
  if (x < -260 || x > 330 || z < -350 || z > 260) return -1e9;
  const edgeNoise = 4.5 * noiseB.fbm2(x / 45, z / 45, 3) + 1.8 * noiseC.fbm2(x / 14, z / 14, 2);
  const d = sdPolygon(x, z, A.outline) + edgeNoise;
  if (d > 170) return -1e9;
  if (d <= 0) {
    // plateau: almost flat (buildings need it), gentle crown, slight rounding at the rim
    return A.top + 0.5 * noiseA.fbm2(x / 70, z / 70, 3) + Math.min(-d, 60) * 0.005 - 0.6 * smoothstep(-2.5, 0, d);
  }
  // which way does this edge face? the south sector gets terraces, elsewhere sheer cliffs
  const cx = A.center[0], cz = A.center[1];
  const brg = ((Math.atan2(x - cx, -(z - cz)) * 180) / Math.PI + 360) % 360;
  const [s0, s1] = A.terraceSector || [120, 240];
  const terr = smoothstep(s0 - 10, s0 + 10, brg) * smoothstep(s1 + 10, s1 - 10, brg);
  let h = terr < 1 ? sheerProfile(d + (1 - terr) * cliffRibs(x, z, d), A.top, x, z) : 0;
  if (terr > 0) {
    // per-ledge width multipliers vary along the face (wide bays for buildings, sheer stretches)
    const wk = [0, 1, 2, 3].map((k) => clamp(0.95 + 0.8 * noiseF.noise2(x / 75 + k * 3.1, z / 75 - k * 1.7), 0.25, 1.75));
    // building sites need deep ledges (acropolis/buildings.js)
    for (const S of A.sites || []) {
      const a = 1 - smoothstep(S.w / 2, S.w / 2 + 10, Math.abs(x - S.x));
      if (a > 0) wk[S.k] = Math.max(wk[S.k], lerp(wk[S.k], S.depth / A.terraces[S.k].ledge, a));
    }
    // sheer bay under the temple front: deep podium ledge, then a near-vertical cliff into the lagoon
    if (A.sheerBay) {
      const [b0, b1, dep, f] = A.sheerBay;
      const bay = smoothstep(b0 - 8, b0 + 4, x) * smoothstep(b1 + 8, b1 - 4, x);
      if (bay > 0) {
        wk[0] = lerp(wk[0], dep / A.terraces[0].ledge, bay);
        for (let k = 1; k < wk.length; k++) wk[k] = lerp(wk[k], f, bay);
      }
    }
    const tp = terraceProfile(d, A.top, wk);
    h = terr >= 1 ? tp : lerp(h, tp, terr);
  }
  // the grand stair rides a spur that runs down the face to the lagoon quay
  const sp = stairSpur(x, z);
  if (sp > h) h = sp;
  return h;
}

/** the old crag (west of the gorge): cliff for the 'hill-big' waterfall and the hill aqueduct */
export const WEST_CRAG = { center: [-650, -700], top: 210 };
function crag(x, z) {
  const C = WEST_CRAG;
  const ox = x - C.center[0], oz = z - C.center[1];
  if (Math.abs(ox) > 420 || Math.abs(oz) > 420) return -1e9;
  const ang = Math.atan2(oz, ox);
  const rr = Math.hypot(ox, oz);
  const d = rr - 85 + 20 * noiseA.fbm2(x / 70, z / 70, 3) + 7 * Math.cos(5 * ang + 1.3);
  if (d > 380) return -1e9;
  let h;
  if (d <= 0) h = C.top + 1.2 * noiseB.fbm2(x / 40, z / 40, 2) - smoothstep(-6, 0, d) * 1.5;
  else {
    // (terrain-near) stepped rocky flanks (a broad crag, not a tower): cliff bands of 10–22 m with
    // vegetated benches, sheerer toward the gorge (east), buttress ribs, then a rocky apron
    const n = noiseD.fbm2(x / 70, z / 70, 2);
    const east = smoothstep(-0.2, 0.7, Math.cos(ang) + 0.3 * n);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const gul = 1 - Math.abs(noiseD.noise2(ca * 3.1 + 2.3, sa * 3.1 - 1.9));
    const dd = d + smoothstep(0.5, 8, d) * (8 * gul * gul * gul * gul - 2.5);
    const foot = C.top - 120 - 20 * n;
    const hc = benchedCliff(dd, C.top, foot, x, z, 3.3, lerp(0.7, 0.2, east), lerp(4.5, 1.5, east), 10, 12, 1.4);
    h = hc === hc ? hc : BC_Y - (dd - BC_END) * 0.75;
  }
  // notch for the big waterfall: a channel cut through the rim toward the lip
  const W = L.WATERFALLS.find((w) => w.id === 'hill-2');
  if (W) {
    const a = (W.dir * Math.PI) / 180, fx = Math.sin(a), fz = -Math.cos(a);
    const px = x - W.from[0], pz = z - W.from[2];
    const along = px * fx + pz * fz, across = Math.abs(-px * fz + pz * fx);
    const halfW = W.width * 0.5 + 3;
    if (along > -70 && along < 4 && across < halfW + 10) {
      const k = (1 - smoothstep(halfW - 2, halfW + 8, across)) * smoothstep(-70, -40, along);
      const floor = W.from[1] - 1.2 + Math.max(0, -along - 40) * 0.12;
      if (h > floor) h = lerp(h, floor, k);
    }
  }
  return h;
}

/**
 * Temple mount (HILL_TEMPLE): a limestone crag west-north-west of the acropolis with a temple on its
 * summit, sheer faces (and a waterfall notch) toward the south-east viewpoints, scrubby slopes behind.
 */
function templeMount(x, z) {
  const C = L.HILL_TEMPLE;
  const ox = x - C.center[0], oz = z - C.center[1];
  if (Math.abs(ox) > 520 || Math.abs(oz) > 520) return -1e9;
  const ang = Math.atan2(oz, ox);
  const r = Math.hypot(ox, oz) * (1 + 0.08 * Math.cos(4 * ang + 0.7) + 0.06 * Math.cos(3 * ang + 1.1) + 0.04 * Math.cos(7 * ang + 2.1)) + 12 * noiseA.fbm2(x / 70, z / 70, 3) + 3 * noiseB.noise2(x / 17, z / 17);
  if (r > 470) return -1e9;
  const top = C.top;
  const nb = noiseC.noise2(x / 23, z / 23);
  // sheer faces toward the viewers (notch direction), steep rounded rock elsewhere
  const na = ((C.notch ?? 135) * Math.PI) / 180, nfx = Math.sin(na), nfz = -Math.cos(na);
  const faceDir = (ox * nfx + oz * nfz) / (Math.hypot(ox, oz) + 1e-6);
  const sheer = smoothstep(0.72, 0.95, faceDir + 0.12 * noiseD.noise2(Math.cos(ang) * 1.3, Math.sin(ang) * 1.3 + 1.7)); // (terrain-near) waterfall face ±40°
  const sr = 40;                                   // summit platform radius
  let h;
  if (r < sr) h = top + 0.6 * noiseB.fbm2(x / 30, z / 30, 2);
  else {
    // (terrain-near) a broad limestone crag, not a cone (refs 1, 3, 9): buttress spurs and gullies running
    // down the flanks (radial ribs in plan); toward the viewers a sheer 50–60 m cliff band (the waterfall
    // face) with narrow benches, elsewhere stepped rocky slopes (≈ 55° walls of 6–12 m with sloping
    // vegetated benches); below the foot concave rocky slopes with outcrop ribs into the lowland.
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const gul = 1 - Math.abs(noiseD.noise2(ca * 3.4 + r / 90 + 1.3, sa * 3.4 - r / 120 - 0.7));
    const spur = noiseE.noise2(ca * 2.1 + 4.4, sa * 2.1 - 2.2);
    const ribs = smoothstep(sr + 0.5, sr + 8, r) * (9 * gul * gul * gul * gul + 7 * spur - 3) * lerp(1, 0.5, sheer);
    const rc = r - sr + ribs;
    const foot = lerp(50, 60, sheer) + 7 * nb + 4 * spur;
    const hc = benchedCliff(rc, top, foot, x, z, 7.7, lerp(0.75, 0.12, sheer), lerp(3.2, 0.9, sheer), lerp(6, 16, sheer), lerp(6, 10, sheer), 1.3);
    if (hc === hc) h = hc;
    else {
      const u = rc - BC_END;
      const t = Math.min(1, u / 380);
      const ribs2 = 9 * Math.abs(noiseD.noise2(ca * 3.2 + r / 140, sa * 3.2 - r / 200)) * (1 - t) * smoothstep(0, 25, u);
      const steps = 5 * Math.sin(r / 19 + 2.0 * noiseE.noise2(x / 120, z / 120)) * (1 - t) * smoothstep(5, 40, u);
      h = BC_Y - (BC_Y - 22) * (1 - Math.exp(-u / 55)) - 18 * t * t + ribs2 + steps + 14 * t * (1 - t) * noiseE.fbm2(x / 160, z / 160, 3);
    }
  }
  // waterfall notch on the face toward the viewers
  const along = ox * nfx + oz * nfz, across = Math.abs(-ox * nfz + oz * nfx);
  if (along > 10 && along < 90 && across < 16) {
    const floor = top - 5 - Math.max(0, along - 38) * 0.5;
    const k = 1 - smoothstep(7, 16, across);
    if (h > floor) h = lerp(h, floor, k * smoothstep(10, 22, along));
  }
  return h;
}

/** spur ridge from the temple mount north to the mountain front (the mount reads as part of the range) */
const SPUR = [[60, -1150], [140, -1650], [260, -2150], [420, -2700]];
const SPUR_P = prepLine(SPUR);
function spurRidge(x, z) {
  if (boxDist(x, z, SPUR_P) > 420) return -1e9;
  const d = polyDist(x, z, SPUR_P), t = _polyT;
  const hc = lerp(300, 345, t) + 40 * noiseC.fbm2(x / 300, z / 300, 3);
  const wdt = lerp(260, 380, t) * (1 + 0.22 * noiseA.noise2(x / 350, z / 350));
  const k = Math.max(0, 1 - d / wdt);
  if (k <= 0) return -1e9;
  const prof = k * k * (3 - 2 * k);
  return hc * Math.pow(prof, 0.85) + 14 * noiseD.fbm2(x / 90, z / 90, 3) * prof;
}

/** notch on the temple mount's face (for a waterfall): lip position and flow direction */
export const MOUNT_NOTCH = (() => {
  const C = L.HILL_TEMPLE, dir = C.notch ?? 135, a = (dir * Math.PI) / 180;
  const x = C.center[0] + Math.sin(a) * 44, z = C.center[1] - Math.cos(a) * 44;
  return { from: [x, C.top - 6, z], dir, width: 12 };
})();

/** small hilltop platforms for the secondary temples (temple module: hilltop-north, hilltop-city) */
export const HILLTOPS = [
  // face: compass azimuth of the sheer (waterfall) face toward the viewpoints; foot: height where the
  // stepped crag meets its scrubby lower slopes (terrain-near: rocky crags, not cones — refs 1, 9)
  { c: [-760, -1060], top: 205, rf: 26, R: 380, face: 140, foot: 125 },
  { c: [-585, 140], top: 145, rf: 22, R: 300, face: 80, foot: 90 }, // (director) city hill temple above the harbour, left of the temple in shot 1
];
function hilltops(x, z) {
  let best = -1e9;
  for (let i = 0; i < HILLTOPS.length; i++) {
    const T = HILLTOPS[i];
    const ox = x - T.c[0], oz = z - T.c[1];
    if (Math.abs(ox) > T.R || Math.abs(oz) > T.R) continue;
    const r = Math.hypot(ox, oz) + 6 * noiseA.fbm2(x / 60, z / 60, 2);
    if (r >= T.R) continue;
    let h;
    if (r < T.rf) h = T.top + 0.4 * noiseB.noise2(x / 15, z / 15);
    else {
      // buttress spurs / gullies, a sheer face toward the viewers (waterfall), stepped rocky flanks with
      // vegetated benches, then concave slopes (houses, gardens) down to the surrounding land
      const az = Math.atan2(ox, -oz), fa = ((T.face ?? 90) * Math.PI) / 180;
      const ca = Math.cos(az), sa = Math.sin(az);
      const sheer = smoothstep(0.5, 0.9, Math.cos(az - fa) + 0.15 * noiseD.noise2(ca * 1.4 + i * 3.1, sa * 1.4 + 2.2));
      const gul = 1 - Math.abs(noiseD.noise2(ca * 3.0 + 1.9 + i * 5.3, sa * 3.0 - 0.4 + r / 110));
      const spur = noiseE.noise2(ca * 2.0 + 0.7 + i * 2.7, sa * 2.0 + 3.3);
      const ribs = smoothstep(T.rf + 0.5, T.rf + 7, r) * (7 * gul * gul * gul * gul + 6 * spur - 2.6) * lerp(1, 0.45, sheer);
      const rc = r - T.rf + ribs;
      const foot = T.foot + 6 * spur;
      const hc = benchedCliff(rc, T.top, foot, x, z, 11.1 + i * 4.4, lerp(0.75, 0.12, sheer), lerp(3.0, 0.8, sheer), lerp(6, 14, sheer), lerp(6, 10, sheer), 1.2);
      if (hc === hc) h = hc;
      else {
        const u = rc - BC_END, span = Math.max(40, T.R - T.rf - BC_END);
        const t = Math.min(1, u / span);
        const ribs2 = 7 * Math.abs(noiseD.noise2(ca * 3.1 + r / 130 + i, sa * 3.1 - r / 190)) * (1 - t) * smoothstep(0, 20, u);
        h = BC_Y * Math.pow(1 - t, 1.25) + ribs2 * (1 - t);
      }
    }
    if (h > best) best = h;
  }
  return best;
}

function ruinsTerrace(x, z) {
  const R = L.RUINS_TERRACE;
  const ox = x - R.center[0], oz = z - R.center[1];
  if (Math.abs(ox) > 280 || Math.abs(oz) > 280) return -1e9;
  const poly = R.outline;
  const d = (poly ? sdPolygon(x, z, poly) : Math.hypot(ox, oz) - R.radius) + 2.5 * noiseB.fbm2(x / 40, z / 40, 3) + 1.2 * noiseC.noise2(x / 11, z / 11);
  if (d > 170) return -1e9;
  // raised upper terraces (camera platforms of shots 3 and 9) with a short retaining step down to the
  // lower terrace of the fallen head (shot 8)
  let up = 0;
  for (const U of R.upper || []) up = Math.max(up, U.h * (1 - smoothstep(U.r - 1.6, U.r, Math.hypot(x - U.c[0], z - U.c[1]) + 1.2 * noiseC.noise2(x / 7, z / 7))));
  if (d <= 0) return R.top + up + 0.5 * noiseA.fbm2(x / 30, z / 30, 2) + 0.15 * noiseC.noise2(x / 6, z / 6) - 0.4 * smoothstep(-3, 0, d) + Math.min(-d, 40) * 0.015;
  // gorge side (facing the acropolis): sheer two-step cliff into the water; land side: rocky slope
  const T = L.TEMPLE.center;
  const tx = T[0] - R.center[0], tz = T[2] - R.center[1], tl = Math.hypot(tx, tz);
  const ol = Math.hypot(ox, oz) + 1e-6;
  const g = smoothstep(-0.1, 0.45, (ox * tx + oz * tz) / (ol * tl));
  const nb = noiseD.fbm2(x / 40, z / 40, 2);
  const top = R.top + up;
  let cliff;
  const benchY = top * 0.5 + 5 * nb;
  if (d < 2) cliff = top - 1.2 * smoothstep(0, 2, d);
  else {
    // (terrain-near) stepped gorge cliff: bands of 7–12 m with narrow benches down to the water
    const hc = benchedCliff(d - 2, top - 1.2, -2.5, x, z, 23.9, 0.13, 0.9, 7, 5);
    cliff = hc === hc ? hc : BC_Y - 1.5 - (d - 2 - BC_END) * 0.5;
  }
  const slope = top - 1.5 - d * 0.55 - 6 * smoothstep(0, 30, d) * (0.5 + 0.5 * nb);
  return lerp(slope, cliff, g);
}

function island(x, z) {
  const I = L.ISLAND;
  const ox = x - I.center[0], oz = z - I.center[1];
  if (Math.abs(ox) > 75 || Math.abs(oz) > 75) return -1e9;
  const di = Math.hypot(ox, oz) - I.radius + 4 * noiseA.fbm2(x / 15, z / 15, 2) + 1.2 * noiseB.noise2(x / 5, z / 5);
  if (di >= 34) return -1e9;
  if (di < 0) return I.top + 0.25 * noiseB.noise2(x / 8, z / 8) - 0.3 * smoothstep(-2, 0, di);
  // (terrain-near) a rock island (ref 2): stepped limestone tiers of 2–4 m with small ledges down to the
  // waterline, then the rock foot dives into the lagoon
  const hc = benchedCliff(di, I.top, -0.6, x, z, 19.7, 0.32, 0.7, 2.0, 2.2, 0.35);
  if (hc === hc) return hc;
  return BC_Y - (BC_Y + 9) * Math.pow(smoothstep(0, 8, di - BC_END), 0.8) - (di - BC_END) * 0.05;
}

// ------------------------------------------------------------ canyon walls
/** 0..1: how "canyon-like" (sheer rock walls) the river banks are here */
function canyonFactor(x, z) {
  return smoothstep(-1250, -950, z) * smoothstep(240, 120, z);
}

// ------------------------------------------------------------ waterfall notches
const NOTCH_FALLS = L.WATERFALLS.filter((w) => w.id !== 'hill-big' && sdPolygon(w.from[0], w.from[2], L.ACROPOLIS.outline) > 40);
function waterfallNotches(x, z, h) {
  for (const W of NOTCH_FALLS) {
    const px = x - W.from[0], pz = z - W.from[2];
    if (px * px + pz * pz > 90 * 90) continue;
    const a = (W.dir * Math.PI) / 180, fx = Math.sin(a), fz = -Math.cos(a);
    const along = px * fx + pz * fz, across = Math.abs(-px * fz + pz * fx);
    const halfW = W.width * 0.5 + 2.5;
    if (along > 3 || along < -75 || across > halfW + 14) continue;
    const floor = W.from[1] - 0.8 + Math.max(0, -along - 8) * 0.035;
    if (h <= floor) continue;
    // channel with sloping rocky sides, fading out upstream where the ground meets the stream
    const side = floor + Math.max(0, across - halfW) * 1.6;
    const k = (1 - smoothstep(-6, 3, along)) * 0 + smoothstep(-75, -55, along) * (along < 0 ? 1 : 1 - along / 3);
    h = lerp(h, Math.min(h, side), Math.max(0, Math.min(1, k)));
  }
  return h;
}

// ------------------------------------------------------------ shot-7 rapids reach
/**
 * (terrain-near) Shallow rocky reach in front of the river-level camera of shot 7 (ref 7): the lagoon
 * floor rises to a cobble/boulder bed 0.4–1.3 m deep, crossed ~45–60 m ahead by a broken rock sill that
 * breaks the surface (chutes between the rocks), with emergent boulders scattered through the reach.
 * The water module can foam where this bed is shallow (RAPIDS_REACH describes it).
 */
export const RAPIDS_REACH = { cam: [70, 125], fwd: [-0.4386, -0.8988], sill: 52, length: 95 };
let RB_F1 = 0, RB_F2 = 0, RB_ID = 0;
function rbCell(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  let d1 = 9, d2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cz = zi + j;
    let hh = Math.imul(cx, 374761393) + Math.imul(cz, 668265263) | 0; hh = Math.imul(hh ^ (hh >>> 13), 1274126177); hh ^= hh >>> 16;
    const r1 = ((hh >>> 0) & 1023) / 1023, r2 = ((hh >>> 10) & 1023) / 1023, r3 = ((hh >>> 20) & 1023) / 1023;
    const dx = cx + 0.15 + 0.7 * r1 - x, dz = cz + 0.15 + 0.7 * r2 - z, d = dx * dx + dz * dz;
    if (d < d1) { d2 = d1; d1 = d; RB_ID = r3; } else if (d < d2) d2 = d;
  }
  RB_F1 = Math.sqrt(d1); RB_F2 = Math.sqrt(d2);
}
function rapidsBed(x, z, h) {
  const R = RAPIDS_REACH;
  const dx = x - R.cam[0], dz = z - R.cam[1];
  const along = dx * R.fwd[0] + dz * R.fwd[1], across = dx * -R.fwd[1] + dz * R.fwd[0];
  if (along < -25 || along > R.length + 5 || across < -70 || across > 85) return h;
  const wedge = 1 - smoothstep(0.8, 1.05, Math.abs(across) / (along * 0.72 + 20));
  const k = wedge * smoothstep(R.length + 5, R.length - 25, along) * smoothstep(-25, -8, along);
  if (k <= 0) return h;
  const nb = noiseB.fbm2(x / 23, z / 23, 3);
  // cobble bed with scattered boulders (cells 3–6 m; a third of them stand proud)
  let bed = -1.05 + 0.35 * nb + 0.12 * noiseC.noise2(x / 4, z / 4);
  rbCell(x / 5.5 + 0.6 * noiseC.noise2(x / 9, z / 9), z / 5.5 + 0.6 * noiseC.noise2(x / 9 + 5, z / 9));
  const bo = Math.max(0, 1 - RB_F1 / (0.42 + 0.25 * RB_ID));
  if (RB_ID > 0.78) bed = Math.max(bed, -1.0 + (0.35 + 1.5 * (RB_ID - 0.78) / 0.22) * Math.pow(bo, 0.6));
  // the sill: a broken rock ledge across the reach, slightly bowed, with chutes
  const sa = along - (R.sill + 7 * noiseD.noise2(across / 37, 3.3) + 0.0009 * across * across);
  const sill = Math.exp(-(sa * sa) / (2 * 3.2 * 3.2));
  const gaps = smoothstep(-0.35, 0.15, noiseE.noise2(across / 9 + 1.7, 7.1));
  rbCell(x / 2.6 + 11.3, z / 2.6 - 4.1);
  const blk = Math.sqrt(Math.max(0, 1 - RB_F1 / 0.7));
  bed = Math.max(bed, -1.3 + sill * (1.0 + 0.45 * gaps + 0.8 * blk * gaps) - 0.3 * (1 - gaps) * sill);
  // just below the sill the bed drops into a scour pool before rising again
  bed -= 0.6 * Math.exp(-((sa - 7) * (sa - 7)) / 18);
  const hb = lerp(h, bed, k);
  return hb > h ? hb : h;
}

// ------------------------------------------------------------ near field (analytic)
/** lowland around the hill-temple crag (west of the canyon): the crag must tower over rolling
 *  ground and its waterfall needs a valley to fall into (refs 1, 2, 3, 9). Near field only. */
function hillLowland(x, z, h) {
  const C = L.HILL_TEMPLE;
  const r = Math.hypot(x - C.center[0], z - C.center[1]);
  if (r > 700) return h;
  const cap = 34 + Math.max(0, r - 80) * 0.11 + 10 * noiseE.fbm2(x / 160, z / 160, 3);
  const k = 1 - smoothstep(420, 700, r);
  return h > cap ? lerp(h, cap, k) : h;
}

function nearHeight(x, z) {
  let h = baseLand(x, z);
  if (x < 100) h = smax(h, hillsWest(x, z), 30);
  h = hillLowland(x, z, h);

  // carve water: sheer canyon walls along the gorge, gentle banks elsewhere
  const w = waterSDF(x, z);
  if (w < 110) {
    const sm = seaFloorMix(x, z);
    const deep = lerp(L.RIVER.floor, L.SEA.floor, sm) - Math.max(0, -w) * lerp(0.04, 0.05, sm);
    const cf = canyonFactor(x, z);
    let bank;
    if (cf > 0) {
      // rocky shelf at the waterline, then a sheer wall up to the land
      const shelf = 3 + 3 * (0.5 + 0.5 * noiseE.noise2(x / 50, z / 50));
      // stepped gorge wall: lower cliff, a vegetated bench, upper cliff
      const bn = noiseF.noise2(x / 70, z / 70);
      const benchAt = 0.40 + 0.14 * bn, b0 = shelf + 16 + 8 * bn, b1 = b0 + 14 + 10 * (0.5 + 0.5 * bn);
      let wall = benchAt * Math.pow(smoothstep(shelf, b0, w), 0.8) + 0.06 * smoothstep(b0, b1, w) + (0.94 - benchAt) * Math.pow(smoothstep(b1, b1 + 22 + 8 * bn, w), 0.8);
      // (terrain-near) narrow ledges on the gorge walls: sine terracing of the wall fraction (≈ 5 benches)
      const kb = 5 + 1.5 * bn, ph = 0.3 * noiseE.noise2(x / 120, z / 120);
      wall = clamp(wall - 0.8 * Math.sin(6.2832 * (kb * wall + ph)) / (6.2832 * kb), 0, 1);
      const gentle = smoothstep(0, 45, w);
      bank = lerp(gentle, Math.max(wall, 0.06 * smoothstep(0, shelf, w)), cf);
      if (w > 0 && w < shelf) {
        const shelfH = lerp(-0.2, 1.4, w / shelf);
        h = Math.max(lerp(deep, h, bank), lerp(lerp(deep, h, gentle), shelfH, cf));
      } else h = lerp(Math.min(h, deep), h, bank);
    } else if (w < 70) {
      bank = smoothstep(0, 45, w);
      h = lerp(Math.min(h, deep), h, bank);
    }
  }

  // side-stream notches feeding the gorge waterfalls (lip below the rim)
  h = waterfallNotches(x, z, h);
  // shallow rocky reach with a rapids sill in front of the river-level camera (shot 7)
  if (w < 0) h = rapidsBed(x, z, h);

  // rock formations rise out of everything else
  const a = acropolis(x, z); if (a > h) h = a;
  const c = crag(x, z); if (c > h) h = c;
  // big hills never fill the gorge or the lagoon
  const wk = smoothstep(25, 160, w);
  // the hill-temple crag may stand right on the canyon rim (its cliff + waterfall drop toward the river)
  const wkT = smoothstep(10, 50, w);
  if (wkT > 0) { const tm = templeMount(x, z); if (tm > -1e8) h = smax(h, lerp(-50, tm, wkT), 12); }
  if (wkT > 0) { const ht = hilltops(x, z); if (ht > -1e8) h = smax(h, lerp(-50, ht, wkT), 10); }
  if (wk > 0) {
    const sr = spurRidge(x, z); if (sr > -1e8) h = smax(h, lerp(-50, sr, wk), 40);
  }
  const r = ruinsTerrace(x, z); if (r > h) h = r;
  const i = island(x, z); if (i > h) h = i;
  return h;
}

/** far field: land + mountains with the water carved (no near-field rock formations) */
function farHeightAnalytic(x, z) {
  let h = baseLand(x, z);
  if (x < 100) h = smax(h, hillsWest(x, z), 30);
  const sr = spurRidge(x, z); if (sr > -1e8) h = smax(h, sr, 40);
  const m = mountainsAnalytic(x, z);
  if (m > -1e8) h = smax(h, m, 160);
  const w = waterSDF(x, z);
  if (w < 60) {
    const floorH = lerp(L.RIVER.floor, L.SEA.floor, seaFloorMix(x, z));
    const bank = smoothstep(0, 45, w);
    h = lerp(Math.min(h, floorH - Math.max(0, -w) * 0.05), h, bank);
  }
  return h;
}
/** exported for the far-field baker (analytic, no erosion) */
export const farHeightBase = farHeightAnalytic;
/** far-field land without mountains (the base the eroded mountains are added to) */
export function farLand(x, z) {
  let h = baseLand(x, z);
  if (x < 100) h = smax(h, hillsWest(x, z), 30);
  const sr = spurRidge(x, z); if (sr > -1e8) h = smax(h, sr, 40);
  const w = waterSDF(x, z);
  if (w < 60) {
    const floorH = lerp(L.RIVER.floor, L.SEA.floor, seaFloorMix(x, z));
    h = lerp(Math.min(h, floorH - Math.max(0, -w) * 0.05), h, smoothstep(0, 45, w));
  }
  return h;
}

// ------------------------------------------------------------ public API
export function heightAt(x, z) {
  const fw = farWeight(x, z);
  if (fw <= 0) return nearHeight(x, z);
  let far = FAR ? farSample(x, z) : null;
  if (far === null) far = farHeightAnalytic(x, z);
  if (fw >= 1) return far;
  return lerp(nearHeight(x, z), far, fw);
}

/** finite-difference normal [nx, ny, nz] */
export function normalAt(x, z, e = 1) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}

/** slope in [0,1] (0 = flat, 1 = vertical) */
export function slopeAt(x, z, e = 1) { return 1 - normalAt(x, z, e)[1]; }

/** true where the ground is under water */
export function isWater(x, z) { return heightAt(x, z) < L.SEA_LEVEL - 0.2; }
