// Terrain shapes owned by the terrain module (pure, deterministic, no three.js — node + browser + workers):
//   far field: mountain massif envelope (north wall), analytic mountains, coastal plain + foothills,
//   sea bed, islands and rocky islets; near field detail: the stepped rocky citadel hillside.
// heightfield.js (director) calls these from its far-field functions (mountainsAnalytic, farLand, seaBed,
// islandAt) and from citadelDetail().
import { Simplex, smoothstep, clamp, lerp } from '../core/noise.js';
import { mulberry32 } from '../core/rng.js';
import * as L from '../world/layout.js';

const nA = new Simplex(9101), nB = new Simplex(9102), nC = new Simplex(9103), nD = new Simplex(9104), nE = new Simplex(9105);

// ------------------------------------------------------------------ mountain massifs (north wall)
// Composition (ref 1): a continuous jagged wall across the whole northern horizon; the tallest peaks
// slightly right of centre 9-12 km away, the right (north-east) massifs closer (5.5-8 km) and big on screen,
// the left (north-west, toward the sun) lower and hazier; a taller back row 13-16 km.
function buildPeaks() {
  const M = L.MOUNTAINS, rnd = mulberry32(20261020);
  const P = [];
  const half = M.arc * 0.5;
  const lo = M.bearing - half, hi = M.bearing + half;   // absolute compass bearings (may be < 0 = west of north)
  // b: absolute bearing (deg, -180..180 around north)
  // (r1 composition pass: ×1.22 farther, ×0.82 lower than the first layout — ref 1 shows the wall only a few
  //  degrees above the horizon)
  const add = (b, dist0, h0, r) => {
    const dist = dist0 * 1.22, h = h0 * 0.82;
    const a = (b * Math.PI) / 180;
    const x = Math.sin(a) * dist, z = -Math.cos(a) * dist;
    const ul = Math.hypot(x, z);
    P.push({ x, z, h, r, ux: x / ul, uz: z / ul });
  };
  // front row: the right (north-east) massifs closer and bigger on screen, the left lower
  for (let b = lo + 4; b <= hi - 2; b += 6 + 5 * rnd()) {
    const right = smoothstep(8, 40, b), left = smoothstep(4, -16, b);
    const dist = lerp(10200, 7600, right) + 1400 * left + 1200 * (rnd() - 0.5);
    const h = (1300 + 650 * rnd()) * (1 + 0.12 * right - 0.3 * left);
    add(b, dist, h, 1500 + 900 * rnd());
  }
  // back row (taller)
  for (let b = lo + 8; b <= hi - 4; b += 8 + 6 * rnd()) {
    add(b, 13200 + 2200 * rnd(), 1900 + 600 * rnd() - 400 * smoothstep(0, -16, b), 2200 + 1200 * rnd());
  }
  // hero peaks (ref 1: the pyramid right of centre, the big rocky massif at the right edge)
  add(9, 11200, 2350, 2300);
  add(24, 9600, 2100, 2000);
  add(38, 7600, 1700, 1700);
  add(-6, 12000, 1950, 2100);
  // foothills: low spurs in front of the wall (3.5-5.5 km)
  for (let b = lo + 2; b <= hi; b += 6 + 6 * rnd()) {
    add(b, 4600 + 1500 * rnd() - 400 * smoothstep(15, 50, b), 220 + 380 * rnd() + 220 * smoothstep(10, 45, b), 700 + 600 * rnd());
  }
  return P;
}
export const PEAKS = buildPeaks();
export const MT_MIN_DIST = 2900;

/** smooth massif envelope (m): where and how high the mountains are (no ridges / valleys yet) */
export function mountainEnvelope(x, z) {
  const r = Math.hypot(x, z);
  if (r < MT_MIN_DIST) return 0;
  const wx = x + 900 * nB.fbm2(x / 6500, z / 6500, 3);
  const wz = z + 900 * nC.fbm2(x / 6500 + 3.1, z / 6500, 3);
  let e4 = 0;
  for (let i = 0; i < PEAKS.length; i++) {
    const P = PEAKS[i];
    const dx = wx - P.x, dz = wz - P.z;
    const R = P.r * 1.5;
    if (dx * dx + dz * dz >= R * R * 1.8) continue;
    // radial / tangential frame: long along the range, steeper toward the city
    const dr = dx * P.ux + dz * P.uz, dt = -dx * P.uz + dz * P.ux;
    const qr = dr / (R * (dr < 0 ? 0.75 : 1.05)), qt = dt / (R * 1.35);
    const d2 = qr * qr + qt * qt;
    if (d2 >= 1) continue;
    const c = P.h * Math.pow(1 - d2, 1.7) * (1 + 0.15 * Math.sqrt(d2) * (1 - d2));
    const c2 = c * c; e4 += c2 * c2;
  }
  // continuous base belt along the range
  const M = L.MOUNTAINS;
  const rel = ((L.bearingOf(x, z) - M.bearing + 540) % 360) - 180;
  const half = M.arc * 0.5;
  const azMask = smoothstep(-half - 15, -half + 12, rel) * smoothstep(half + 15, half - 12, rel);
  const band = 950 * azMask * Math.exp(-Math.pow((r - 13200) / 3800, 2)) * (0.7 + 0.6 * nA.fbm2(x / 3000, z / 3000, 2));
  const b2 = band * band; e4 += b2 * b2;
  return Math.pow(e4, 0.25) * smoothstep(MT_MIN_DIST, MT_MIN_DIST + 1500, r);
}

let ANALYTIC_MTN = true;
/** bake helper: switch the analytic mountains off (the eroded relief replaces them) */
export function setAnalyticMountains(on) { ANALYTIC_MTN = on; }

/** analytic mountain relief above the plain (fallback until the eroded far grid is loaded) */
export function mountainsAnalyticShape(x, z) {
  if (!ANALYTIC_MTN) return 0;
  const E = mountainEnvelope(x, z);
  if (E < 1) return 0;
  const wx = x + 600 * nD.fbm2(x / 4000, z / 4000, 2), wz = z + 600 * nE.fbm2(x / 4000, z / 4000, 2);
  const R1 = nC.ridged2(wx / 2600, wz / 2600, 5, 2.05, 0.5);
  return Math.max(0, E * (0.42 + 0.62 * R1) + 60 * nB.fbm2(x / 700, z / 700, 3) - 30);
}

// ------------------------------------------------------------------ coastal plain (beyond the outer city)
// a river out of the mountains, meandering across the plain to the west sea, widening into a lagoon at its
// mouth (ref 1: water glinting in the plain behind the city)
export const RIVER = [[4200, -6400], [3300, -4700], [2200, -3600], [900, -3150], [-500, -2900], [-1600, -2650], [-2500, -2150], [-3300, -1500]];
const RV = (() => {
  const seg = [];
  let acc = 0;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    seg.push({ ax, az, dx: bx - ax, dz: bz - az, l, t0: acc }); acc += l;
  }
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of RIVER) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return { seg, len: acc, box: [x0 - 600, z0 - 600, x1 + 600, z1 + 600] };
})();
/** {d: distance to the river centre line (m, meanders included), t: 0 source … 1 mouth} */
let RIV_T = 0;
export function riverDist(x, z) {
  const B = RV.box;
  if (x < B[0] || x > B[2] || z < B[1] || z > B[3]) return 1e9;
  // meanders: warp the query point
  const wx = x + 140 * nC.noise2(x / 900, z / 900) + 45 * nD.noise2(x / 260, z / 260);
  const wz = z + 140 * nC.noise2(x / 900 + 5.3, z / 900) + 45 * nD.noise2(x / 260 + 2.1, z / 260);
  let best = 1e9, bt = 0;
  for (const S of RV.seg) {
    const u = Math.max(0, Math.min(1, ((wx - S.ax) * S.dx + (wz - S.az) * S.dz) / (S.l * S.l)));
    const ex = wx - (S.ax + S.dx * u), ez = wz - (S.az + S.dz * u);
    const d = ex * ex + ez * ez;
    if (d < best) { best = d; bt = (S.t0 + u * S.l) / RV.len; }
  }
  RIV_T = bt;
  return Math.sqrt(best);
}

/** plain height without the mountains: gentle rise to the foothills, broad swells, the river valley */
export function plainShape(x, z, r) {
  const O = L.OUTER_CITY;
  const rise = 26 * smoothstep(O.r0, 5200, r);
  const swell = nA.fbm2(x * 0.0011, z * 0.0011, 4) * 9 * smoothstep(1300, 3200, r);
  const gentle = nB.noise2(x * 0.004, z * 0.004) * 1.6 * smoothstep(1100, 2000, r);
  let h = O.y + rise + swell + gentle;
  if (r > 2200) {
    const d = riverDist(x, z);
    if (d < 900) {
      const t = RIV_T;
      const w = 28 + 40 * t + 120 * smoothstep(0.86, 1.0, t);       // half width (lagoon at the mouth)
      const bed = -2.5 - 2.5 * t;
      const valley = smoothstep(w + 700, w + 60, d);                  // broad valley floor sloping to the river
      h = lerp(h, Math.min(h, 2.5 + 5 * t * 0 + (h - 2.5) * 0.35), valley * 0.8);
      h = lerp(h, bed, smoothstep(w + 14, w - 6, d));
    }
  }
  return h;
}

/** far coast: weight of the WEST SEA (0 land … 1 sea). Ref 1: the sea wraps around the left (west) of the city
 *  out to the horizon under the low sun, with islands; the coast trends north-west, headlands of the
 *  mountain wall dip into it. The outer city (r < 1950) always stays land. */
export function westSea(x, z, r) {
  if (r < 1900) return 0;
  const b = L.bearingOf(x, z) + 7 * nC.fbm2(x / 2500, z / 2500, 3);
  if (b < 200 || b > 360) return 0;
  // (director: mountains only at bearings ≈ 344–80; the WNW–W horizon is open sea for the setting sun)
  const rc = 2150 + 500 * smoothstep(305, 338, b) + 30000 * smoothstep(338, 352, b) + 380 * nA.fbm2(x / 1400, z / 1400, 3) + 120 * nB.noise2(x / 300, z / 300);
  const ang = smoothstep(205, 232, b);
  return ang * smoothstep(rc - 80, rc + 180, r) * smoothstep(1900, 2050, r);
}
/** land beyond the outer city: plain + foothills + mountains, sinking into the west sea */
export function farLandShape(x, z, r) {
  const land = plainShape(x, z, r) + mountainsAnalyticShape(x, z);
  const w = westSea(x, z, r);
  if (w <= 0) return land;
  const sea = Math.max(seaBedShape(x, z, r) + 30 * smoothstep(2600, 1950, r), islandShape(x, z));
  return lerp(land, sea, w);
}

// ------------------------------------------------------------------ sea bed
/** open-sea bed (south): a sandy shelf deepening away from the city, with banks and rock ridges */
export function seaBedShape(x, z, r) {
  const d = Math.max(0, r - 820);
  let h = -12 - 46 * smoothstep(0, 2600, d) - 32 * smoothstep(2000, 7000, d);
  h += nA.fbm2(x * 0.002, z * 0.002, 4) * 6 + nB.noise2(x * 0.011, z * 0.011) * 1.2;
  return h;
}

// ------------------------------------------------------------------ islands and islets
// granite-like boulder field (ref 1 islets): max of rounded domes in jittered cells → piled tors with steep
// sides and crevices between them. Returns 0..~1.
function hash2(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function boulders(x, z, size, seed) {
  const fx = x / size, fz = z / size, ix = Math.floor(fx), iz = Math.floor(fz);
  let m = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cz = iz + j;
    const px = cx + 0.2 + 0.6 * hash2(cx, cz, seed), pz = cz + 0.2 + 0.6 * hash2(cx, cz, seed + 7);
    const rad = 0.55 + 0.4 * hash2(cx, cz, seed + 13), hh = 0.45 + 0.55 * hash2(cx, cz, seed + 19);
    const dx = (fx - px) / rad, dz = (fz - pz) / (rad * (0.8 + 0.4 * hash2(cx, cz, seed + 23)));
    const q = 1 - dx * dx - dz * dz;
    if (q > 0) m = Math.max(m, hh * Math.pow(q, 0.35));
  }
  return m;
}
function islandProfile(x, z, I, small) {
  const dx = x - I.center[0], dz = z - I.center[1];
  const d = Math.hypot(dx, dz);
  if (d > I.r * 2.2 + 60) return -Infinity;
  const ang = Math.atan2(dz, dx);
  // ragged plan outline: lobes + coves
  const lobe = 0.22 * nB.noise2(Math.cos(ang) * 1.3 + I.center[0] * 0.01, Math.sin(ang) * 1.3) + 0.12 * nC.noise2(x / (I.r * 0.35), z / (I.r * 0.35));
  const R = I.r * (1 + lobe);
  const s = d / R;
  if (!small) {
    if (s < 1) {
      const u = 1 - s;
      const crag = 0.55 + 0.45 * nC.ridged2(x / (I.r * 0.45), z / (I.r * 0.45), 3) + 0.25 * nD.noise2(x / (I.r * 0.2), z / (I.r * 0.2));
      const body = I.top * Math.pow(smoothstep(0, 0.85, u), 0.75) * crag;
      const shore = -2.5 + (2.5 + I.top * 0.22) * Math.sqrt(Math.min(1, u / 0.05));
      return Math.max(shore, body);
    }
    return -2.5 - (s - 1) * R * 0.55;
  }
  // islets: piled rounded boulders (12-20 m tors) on a low rock platform, with loose boulders in the surf
  const env = I.top * smoothstep(-0.05, 0.75, 1 - s);
  const b1 = boulders(x + I.center[0] * 0.37, z, 13 + I.r * 0.05, 101);
  const b2 = boulders(x, z - I.center[1] * 0.41, 7.5, 211);
  const bb = Math.max(b1, 0.6 * b2);
  const under = -2.5 - Math.max(0, s - 1) * R * 0.75;
  let h = s < 1.02 ? Math.max(under, env * (0.35 + 0.85 * bb) - 1.0) : under;
  // loose boulders in the surf around the shore
  if (s > 0.85 && s < 1.45) {
    const k = smoothstep(1.45, 1.05, s);
    h = Math.max(h, -2.2 + (I.top * 0.3 + 3) * k * Math.max(0, b2 - 0.25) * 1.6);
  }
  return h;
}
/** highest island / islet surface at (x,z), -Infinity away from all */
export function islandShape(x, z) {
  let h = -Infinity;
  for (const I of L.ISLANDS) h = Math.max(h, islandProfile(x, z, I, false));
  for (const I of L.ISLANDS_FAR || []) h = Math.max(h, islandProfile(x, z, I, false));
  for (const I of L.ISLETS || []) h = Math.max(h, islandProfile(x, z, I, true));
  return h;
}

// ------------------------------------------------------------------ citadel hillside (near field)
// The slopes between the citadel ledges (plateau 45 → ledge 32 → ledge 18 → quay 3) become stepped rocky
// ground: 3-4.5 m rock risers (the mesher turns them into jointed limestone faces) with soil / garden
// benches between them (ref 4, 6). The ledges, the plateau, the quay band and the grand-stair corridor stay
// exact. Returns the height to ADD to the smooth radial profile.
const STAIR_HALF = (L.CITADEL_STAIR?.width ?? 34) / 2 + 6;
export function citadelSlopeDetail(x, z, r, base) {
  const C = L.CITADEL, [t1, t2] = C.terraces;
  let r0, r1, y0, y1;
  if (r > C.plateau && r < t1.r0) { r0 = C.plateau; r1 = t1.r0; y0 = C.summit; y1 = t1.y; }
  else if (r > t1.r1 && r < t2.r0) { r0 = t1.r1; r1 = t2.r0; y0 = t1.y; y1 = t2.y; }
  else if (r > t2.r1 && r < 214) { r0 = t2.r1; r1 = 214; y0 = t2.y; y1 = C.quayY; }
  else return 0;
  // fade near the ends of each slope so the ledges stay exact
  const end = smoothstep(r0, r0 + 1.5, r) * smoothstep(r1, r1 - 1.5, r);
  // stair corridor (the grand stair is a built structure): smooth ground
  const stair = z > 0 ? smoothstep(STAIR_HALF, STAIR_HALF + 10, Math.abs(x - (L.CITADEL_STAIR?.x ?? 0))) : 1;
  const w = end * stair;
  if (w <= 0) return 0;
  const span = y0 - y1;
  const nSteps = Math.max(1, Math.round(span / (r1 - r0 < 10 ? 5.5 : 3.8)));
  // phase warp (varies the bench positions around the hill), zero at both ends
  const tt = (base - y1) / span;
  const warp = 0.38 * nA.noise2(x / 34, z / 34) + 0.18 * nB.noise2(x / 13, z / 13);
  let q = tt * nSteps + warp * Math.sin(Math.PI * clamp(tt, 0, 1));
  q = clamp(q, 0, nSteps);
  const k = Math.floor(q), f = q - k;
  const sharp = 4 + 2.5 * (0.5 + 0.5 * nC.noise2(x / 21, z / 21));
  const hs = y1 + (span / nSteps) * (k + Math.pow(f, sharp));
  // soil pockets / lumps on the benches
  const lump = (0.35 * nD.fbm2(x / 7, z / 7, 3) + 0.25 * Math.max(0, nE.noise2(x / 4.5, z / 4.5))) * smoothstep(0.0, 0.25, 1 - f);
  return (hs - base + lump) * w;
}

/** (exported for the mesher / shader) is (x,z) on a citadel slope (not a ledge, plateau or quay)? */
export function onCitadelSlope(r) {
  const C = L.CITADEL, [t1, t2] = C.terraces;
  return (r > C.plateau && r < t1.r0) || (r > t1.r1 && r < t2.r0) || (r > t2.r1 && r < 214);
}
