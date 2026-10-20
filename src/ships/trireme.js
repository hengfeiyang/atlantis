// Procedural ships. Local frame: +z = bow, x = beam, y up, waterline at y = 0. Base trireme length 37 m
// (the painted-zone constants in mats.js assume this frame; scale per instance with the matrix).
//   buildTrireme(o) → { wood, sail, oars, dims }   (GeoBuilders; oars = pivots for animation / baking)
//   buildBoat(o)    → small boats and round merchant ships
// adapted from athenaion/src/city/ships.js (hull lofting, spars, sails, crew), heavily extended.
import * as THREE from 'three';
import { GeoBuilder, SHIP_ATTRS, SAIL_ATTRS, bezier, lerp3, sub, norm, cross, len } from './geo.js';
import { K } from './mats.js';
import { RNG } from '../core/rng.js';

const PI = Math.PI;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ trireme hull definition
export const TRI = { z0: -18, z1: 18, mastZ: 1.0, outZ0: -12.6, outZ1: 12.4, outW: 0.55, outH: 0.58 };
const zOf = (t) => TRI.z0 + (TRI.z1 - TRI.z0) * t;
const tOf = (z) => (z - TRI.z0) / (TRI.z1 - TRI.z0);
export function triBeam(t) {
  const s = Math.sin(PI * clamp(t, 0.001, 0.999));
  return 0.1 + 2.2 * (t > 0.5 ? Math.pow(s, 0.78) : Math.pow(s, 0.42));
}
export function triGunwale(t) {
  const e = 2 * t - 1;
  return 2.95 + (e > 0 ? 1.05 * Math.pow(e, 2.4) : 2.0 * Math.pow(-e, 2.2));
}
export function triKeel(t) {
  const s = Math.sin(PI * clamp(t, 0.015, 0.985));
  return -1.02 * Math.pow(s, 0.32) + (t < 0.16 ? 0.7 * Math.pow(1 - t / 0.16, 2) : 0);
}
const SEC_P = 0.72;
/** section point: phi 0 (port gunwale) … π/2 (keel) … π (starboard gunwale) */
function secPt(t, phi, w, g, k) {
  const sp = Math.sin(phi);
  return [-w * Math.cos(phi) * (0.95 + 0.09 * Math.pow(sp, 0.5)), g - (g - k) * Math.pow(sp, SEC_P), zOf(t)];
}
/** hull half-width at height y in section t */
export function triWidthAt(t, y) {
  const w = triBeam(t), g = triGunwale(t), k = triKeel(t);
  const f = clamp((g - y) / (g - k), 0, 1);
  const phi = Math.asin(Math.pow(f, 1 / SEC_P));
  return w * Math.cos(phi) * (0.95 + 0.09 * Math.pow(Math.sin(phi), 0.5));
}

const W = (u, v, seed, kind, y = 0, side = 0) => ({ aW: [u, v, seed, kind], aX: [y, side, 0, 0] });
const kindAttr = (seed, kind, yBase = 1) => (s, a) => ({ aW: [s, a, seed, kind], aX: [yBase, 0, 0, 0] });

// ------------------------------------------------------------------ helpers
/** lathed human figure (seated or standing), cloth below the neck, skin (or bronze helmet) above */
const PERSON = [[0, 0.16, 0.13], [0.25, 0.15, 0.115], [0.5, 0.125, 0.09], [0.68, 0.14, 0.09], [0.78, 0.17, 0.095], [0.8, 0.06, 0.06], [0.84, 0.06, 0.065], [0.86, 0.085, 0.095], [0.96, 0.08, 0.085], [1.0, 0.03, 0.03]];
function person(b, px, py, pz, h, yaw, seed, helmet = false, n = 8) {
  const f = h / 1.7, c = Math.cos(yaw), s = Math.sin(yaw);
  const R = PERSON.map(([fy, rx, rz]) => Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * PI * 2, x = Math.cos(a) * rx * 1.7 * f, z = Math.sin(a) * rz * 1.7 * f;
    return [px + x * c + z * s, py + fy * h, pz - x * s + z * c];
  }));
  b.grid(R, (k) => W(px + pz, py + PERSON[k][0] * h, seed, k < 5 ? K.CLOTH : helmet && k >= 6 ? K.BRONZE : K.SKIN, 2), true);
  for (const sx of [-1, 1]) {
    const P = (x, y, z) => [px + x * c + z * s, py + y, pz - x * s + z * c];
    b.tube([P(sx * 0.27 * f, 0.76 * h, 0), P(sx * 0.31 * f, 0.6 * h, 0.08 * f), P(sx * 0.22 * f, 0.5 * h, 0.3 * f)], 0.055 * f, 4, kindAttr(seed, K.CLOTH, 2));
  }
}

/** billowed square sail below a yard: width Wd, height H, top at yTop, at z0, belly toward +z */
function sail(sb, Wd, H, yTop, z0, belly, kind, seed, { nx = 12, ny = 9, folds = 0, yaw = 0, pivot = 0, footCurve = 0.35, ripple = 0.05 } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = [];
  for (let j = 0; j <= ny; j++) {
    const row = [];
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / ny, e = 2 * u - 1;
      const x = -Wd / 2 + u * Wd;
      let y = yTop - v * H * (1 - footCurve * 0.12 * (1 - e * e) * v);
      if (folds) y -= folds * 1.6 * Math.pow(v, 3) * (1 - e * e);
      const fold = folds ? folds * (0.35 + 0.65 * v) * Math.sin(u * PI * 2 * 4.5 + seed * 7.0) : 0;
      // brails (9 vertical lines) pull the cloth into shallow vertical channels
      const rip = ripple * (0.5 - 0.5 * Math.cos(u * PI * 2 * 9)) * (0.25 + 0.75 * v) * (1 - Math.abs(e) * 0.5);
      const bz = fold + rip + belly * (1 - Math.pow(Math.abs(e), 2.2)) * (0.3 + 0.7 * Math.sin(PI * Math.min(1, v * 0.95 + 0.05)));
      // r6: braced yards rotate about the mast (pivot = mast z), like the yard / rigging (yp)
      const zr = z0 + bz - pivot;
      row.push([x * c + zr * s, y, pivot - x * s + zr * c]);
    }
    P.push(row);
  }
  sb.grid(P, (j, i) => ({ aSail: [(i / nx) * Wd, (j / ny) * H, seed, kind], aSailSize: [Wd, H] }), true);
}

/** canonical oar: pivot at the origin, along +x, unit outboard length (scaled by the matrix) */
export function oarGeometry(sides = 5) {
  const b = new GeoBuilder(SHIP_ATTRS);
  b.tube([[-0.3, 0, 0], [0.1, 0, 0], [0.8, 0, 0]], (t) => 0.028 - 0.008 * t, sides, (s) => ({ aW: [s * 4, 0, 0.3, K.OAR], aX: [1, 0, 0, 0] }), { caps: true });
  // loom grip
  b.tube([[-0.32, 0, 0], [-0.22, 0, 0]], 0.034, sides, () => ({ aW: [0, 0, 0.3, K.ROPE], aX: [1, 0, 0, 0] }));
  // blade: wide in y, thin in z, tapering into the shaft
  const bl = (x, hw) => [[x, -hw, -0.012], [x, hw, -0.012], [x, hw, 0.012], [x, -hw, 0.012]];
  const sec = [bl(0.74, 0.03), bl(0.8, 0.075), bl(0.94, 0.09), bl(1.0, 0.07)];
  for (let i = 0; i < sec.length - 1; i++) for (let k = 0; k < 4; k++) {
    const a = sec[i][k], bb = sec[i][(k + 1) % 4], c = sec[i + 1][(k + 1) % 4], d = sec[i + 1][k];
    b.quad(a, bb, c, d, null, { aW: [[a[0] * 4, a[1], 0.3, K.BLADE], [bb[0] * 4, bb[1], 0.3, K.BLADE], [c[0] * 4, c[1], 0.3, K.BLADE], [d[0] * 4, d[1], 0.3, K.BLADE]], aX: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] });
  }
  return b.toGeometry();
}
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
/**
 * oar pose: stroke phase ph (rad; sin(ph) > 0 = blade in the water, sweeping from bow to stern).
 * state: 'row' | 'rest' (level, blades at the surface) | 'down' (resting in the water, ref 4) | 'raised'
 */
export function oarMatrix(o, ph, state = 'row', out = new THREE.Matrix4()) {
  const [px, py, pz] = o.pivot, side = o.side;
  let alpha, tipY;
  if (state === 'row') { alpha = 0.4 * Math.cos(ph); tipY = -0.25 + 0.95 * Math.max(0, -Math.sin(ph)); }
  else if (state === 'rest') { alpha = -0.05; tipY = py - 0.6; }
  else if (state === 'down') { alpha = -0.42; tipY = -0.35; }
  else if (state === 'shed') { alpha = 0.62 + 0.05 * Math.sin(pz * 3.1); tipY = -0.5; }
  else { alpha = -0.15; tipY = py + o.len * 0.9; }
  const dy = py - tipY, L = o.len;
  const hr = Math.sqrt(Math.max(0.05, L * L - dy * dy));
  _x.set(side * hr * Math.cos(alpha), -dy, hr * Math.sin(alpha)).normalize();
  _z.copy(_x).cross(_y.set(0, 1, 0)).normalize(); // fore-aft-ish (blade face normal); right-handed basis
  _y.copy(_z).cross(_x).normalize();
  _x.multiplyScalar(L);
  out.makeBasis(_x, _y, _z);
  out.setPosition(px, py, pz);
  return out;
}

// ------------------------------------------------------------------ the trireme
/**
 * o = { seed, detail (0..1), sailState: 'set'|'loose'|'furled'|'none', sailKind, oarState: 'row'|'rest'|'down'|'raised'|'none',
 *       phase, crew (bool), bakeOars (bool: bake into wood; else returned for instancing), belly }
 */
export function buildTrireme(o = {}) {
  const det = o.detail ?? 1, seed = o.seed ?? 0.37, rng = new RNG('tri:' + seed);
  const wood = new GeoBuilder(SHIP_ATTRS), sailB = new GeoBuilder(SAIL_ATTRS);
  const NT = Math.round(28 + 48 * det), M = Math.round(10 + 18 * det), SID = det > 0.6 ? 8 : 5;
  // ---- hull shell (one smooth grid across both sides)
  const rows = [];
  for (let i = 0; i <= NT; i++) {
    const t = Math.pow(i / NT, 1.0) * 0.996 + 0.002;
    const w = triBeam(t), g = triGunwale(t), k = triKeel(t);
    const row = [];
    for (let j = 0; j <= 2 * M; j++) row.push(secPt(t, (PI * j) / (2 * M), w, g, k));
    rows.push(row);
  }
  wood.grid(rows, (i, j) => {
    const p = rows[i][j], t = tOf(p[2]);
    return W(p[2], triGunwale(t) - p[1], seed, K.HULL, p[1], Math.sign(p[0]));
  }, true);
  // bow cutwater (fills the narrow stem from keel to gunwale) and the transom at the stern
  const tb = 0.998, gb = triGunwale(tb), kb = triKeel(tb);
  wood.tube([[0, kb - 0.1, TRI.z1 - 0.05], [0, gb * 0.5, TRI.z1 + 0.02], [0, gb + 0.05, TRI.z1 - 0.02]], [0.13, 0.13], 6, (s) => ({ aW: [TRI.z1, s, seed, K.NAVY], aX: [s, 0, 0, 0] }));
  // ---- wale strakes (thick rubbing bands) along the hull
  for (const yW of [0.5, 2.45]) {
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const t = 0.06 + (i / 40) * 0.9, z = zOf(t);
        if (yW > 1.5 && z > TRI.outZ0 - 0.6) continue;
        pts.push([side * (triWidthAt(t, yW) + 0.03), yW, z]);
      }
      if (pts.length > 2) splitRuns(pts, 2.0).forEach((run) => run.length > 1 && wood.tube(run, [0.05, 0.07], 4, (s) => ({ aW: [s, 0, seed, yW < 1 ? K.NAVY : K.GOLD], aX: [yW, side, 0, 0] })));
    }
  }
  // ---- deck
  {
    const P = [];
    for (let i = 0; i <= 24; i++) {
      const t = 0.07 + (i / 24) * 0.86, g = triGunwale(t) - 0.42, w = triWidthAt(t, g) - 0.02;
      P.push([[-w, g, zOf(t)], [0, g + 0.04, zOf(t)], [w, g, zOf(t)]]);
    }
    wood.grid(P, (i, j) => { const p = P[i][j]; return W(p[0] + 20, p[2], seed, K.DECK, p[1]); }, true);
    // raised central gangway (katastroma)
    for (let i = 0; i < 1; i++) wood.beam([0, triGunwale(0.5) - 0.2, zOf(0.12)], [0, triGunwale(0.5) - 0.2, zOf(0.86)], 1.6, 0.12, (p) => W(p[0] + 30, p[2], seed, K.DECK, p[1]));
  }
  // ---- outrigger (parexeiresia) with the navy screens + gilt rail
  const rail = { [-1]: [], [1]: [] };
  for (const side of [-1, 1]) {
    const Po = [], Pb = [], Pt = [];
    const n = Math.round(18 + 22 * det);
    for (let i = 0; i <= n; i++) {
      const z = TRI.outZ0 + ((TRI.outZ1 - TRI.outZ0) * i) / n, t = tOf(z), g = triGunwale(t);
      const end = Math.min(smooth(TRI.outZ0, TRI.outZ0 + 2.2, z), 1 - smooth(TRI.outZ1 - 2.2, TRI.outZ1, z));
      const wo = triWidthAt(t, g - 0.05) + TRI.outW * (0.15 + 0.85 * end);
      const yb = g - TRI.outH * (0.35 + 0.65 * end);
      Po.push([[side * wo, yb, z], [side * wo, g + 0.04, z]]);
      Pb.push([[side * (triWidthAt(t, yb) - 0.02), yb, z], [side * wo, yb, z]]);
      Pt.push([[side * (triWidthAt(t, g) - 0.05), g + 0.04, z], [side * wo, g + 0.04, z]]);
      rail[side].push([side * (wo + 0.02), g + 0.06, z]);
    }
    wood.grid(Po, (i, j) => { const p = Po[i][j]; return W(p[2], triGunwale(tOf(p[2])) + 0.04 - p[1], seed, K.SCREEN, p[1], side); }, side > 0);
    wood.grid(Pb, (i, j) => { const p = Pb[i][j]; return W(p[2], p[0], seed, K.TIMBER, p[1], side); }, side < 0);
    wood.grid(Pt, (i, j) => { const p = Pt[i][j]; return W(p[2], p[0], seed, K.DECK, p[1], side); }, side > 0);
    // gilt rail cap + stanchions + top rail
    wood.tube(rail[side], 0.05, SID > 5 ? 6 : 4, (s) => ({ aW: [s, 0, seed, K.GOLD], aX: [2.5, side, 0, 0] }));
    const top = rail[side].map((p) => [p[0] - side * 0.04, p[1] + 0.52, p[2]]);
    wood.tube(top, 0.035, 4, (s) => ({ aW: [s, 0, seed, K.GOLD], aX: [3, side, 0, 0] }));
    if (det > 0.3) for (let z = TRI.outZ0 + 0.61; z < TRI.outZ1 - 0.3; z += 1.22) {
      const t = tOf(z), g = triGunwale(t), wo = triWidthAt(t, g - 0.05) + TRI.outW * Math.min(smooth(TRI.outZ0, TRI.outZ0 + 2.2, z), 1 - smooth(TRI.outZ1 - 2.2, TRI.outZ1, z)) * 0.85 + TRI.outW * 0.15;
      wood.tube([[side * (wo + 0.01), g + 0.04, z], [side * (wo - 0.03), g + 0.6, z]], 0.03, 4, (s) => ({ aW: [s, 0, seed, K.GOLD], aX: [3, side, 0, 0] }));
    }
  }
  // gunwale cap forward / aft of the outrigger (gilt)
  for (const side of [-1, 1]) {
    for (const [a, b] of [[0.03, tOf(TRI.outZ0) + 0.01], [tOf(TRI.outZ1) - 0.01, 0.995]]) {
      const pts = []; for (let i = 0; i <= 14; i++) { const t = a + ((b - a) * i) / 14; pts.push([side * (triWidthAt(t, triGunwale(t)) + 0.02), triGunwale(t) + 0.03, zOf(t)]); }
      wood.tube(pts, 0.06, 5, (s) => ({ aW: [s, 0, seed, K.GOLD], aX: [3, side, 0, 0] }));
    }
  }
  // ---- bronze ram (embolon) with three horizontal blades, and the proembolion above
  {
    const zr = TRI.z1;
    const ry = -0.22;   // the ram rides at the waterline, mostly awash
    wood.tube([[0, ry + 0.12, zr - 1.4], [0, ry + 0.1, zr + 0.6], [0, ry + 0.08, zr + 1.9], [0, ry + 0.07, zr + 2.5]], (t) => [0.42 * (1 - 0.72 * t), 0.36 * (1 - 0.6 * t)], SID, (s, a) => ({ aW: [s, a, seed, K.BRONZE], aX: [ry, 0, 0, 0] }), { caps: true });
    for (const yy of [-0.12, 0.1, 0.32]) wood.beam([0, ry + yy + 0.05, zr + 1.1], [0, ry + yy + 0.03, zr + 2.75], 0.62 - Math.abs(yy - 0.1) * 0.6, 0.07, (p) => W(p[2], p[1], seed, K.BRONZE, p[1]));
    wood.beam([0, ry + 0.1, zr + 2.0], [0, ry + 0.1, zr + 2.8], 0.08, 0.62, (p) => W(p[2], p[1], seed, K.BRONZE, p[1]));
    wood.tube([[0, 1.75, zr - 0.4], [0, 1.7, zr + 0.55], [0, 1.65, zr + 0.85]], (t) => 0.16 * (1 - 0.6 * t), 6, (s) => ({ aW: [s, 0, seed, K.GOLD], aX: [1.5, 0, 0, 0] }), { caps: true });
  }
  // ---- stem post: rises from the cutwater above the bow and curls back in a big volute (refs 2, 4)
  {
    const gT = triGunwale(0.999), Z = TRI.z1;
    // r3: swan neck (ref 4 sheds / ref 2): the post sweeps FORWARD out of the cutwater, then curls up and back
    const neck = bezier([[0, -0.2, Z + 0.02], [0, gT * 0.75, Z + 0.45], [0, gT + 1.3, Z + 1.55], [0, gT + 2.7, Z + 1.75]], 14);
    const R0 = 0.9, vc = [0, gT + 2.7, Z + 1.75 - R0], spiral = [];
    for (let i = 1; i <= 26; i++) { const a = (i / 26) * PI * 1.9, r = R0 * (1 - 0.6 * (i / 26)); spiral.push([0, vc[1] + Math.sin(a) * r * 0.98, vc[2] + Math.cos(a) * r]); }
    const pts = [...neck, ...spiral];
    const nP = pts.length;
    wood.tube(pts, (t, i) => { const k = i / (nP - 1); return [0.2 * (1 - 0.35 * k), 0.5 * (1 - 0.62 * k)]; }, SID, (s) => ({ aW: [s, 0, seed, K.GOLD], aX: [3, 0, 0, 0] }), { caps: true });
    // dark wood core showing between gilt edges (a second, slightly wider but thinner plank)
    wood.tube(neck, [0.24, 0.3], SID, (s) => ({ aW: [s, 0, seed, K.NAVY], aX: [3, 0, 0, 0] }));
    // carved rosette at the volute eye + bosses
    wood.tube([[-0.25, vc[1], vc[2]], [0.25, vc[1], vc[2]]], 0.24, SID + 2, (s) => ({ aW: [s, 0, seed, K.GOLD], aX: [3, 0, 0, 0] }), { caps: true });
    for (const [yy, zz] of [[gT - 0.1, Z + 0.86], [gT + 0.9, Z + 1.2]]) { wood.tube([[-0.28, yy, zz], [0.28, yy, zz]], 0.12, 8, (s) => ({ aW: [s, 0, seed, K.GOLD], aX: [3, 0, 0, 0] }), { caps: true }); }
    // epotides (cat-heads) with gilt discs either side of the bow, above the eye
    const ze = 16.1, te = tOf(ze), ge = triGunwale(te) - 0.3, we = triWidthAt(te, ge);
    wood.beam([-(we + 0.3), ge, ze], [we + 0.3, ge, ze], 0.26, 0.26, (p) => W(p[0], p[1], seed, K.TIMBER, p[1]), [0, 0, 1]);
    for (const sd of [-1, 1]) wood.tube([[sd * (we + 0.28), ge, ze], [sd * (we + 0.36), ge, ze]], 0.24, 12, (s) => ({ aW: [s, 0, seed, K.GOLD], aX: [ge, sd, 0, 0] }), { caps: true });
  }
  // ---- stern: aphlaston fan curving up and forward (gilt ribs), helmsman's bench, steering oars
  {
    const gS = triGunwale(0.003);
    const fan = 5;
    for (let f = 0; f < fan; f++) {
      const e = f / (fan - 1) - 0.5;
      const pts = bezier([[0, gS - 0.5, TRI.z0 + 0.3], [e * 0.2, gS + 1.2, TRI.z0 - 0.9], [e * 0.9, gS + 2.9, TRI.z0 - 0.4], [e * 1.4, gS + 3.4, TRI.z0 + 1.1 + Math.abs(e) * 0.5]], 14);
      wood.tube(pts, (t) => 0.13 * (1 - 0.6 * t) * (f === 2 ? 1.2 : 0.8), 5, (s) => ({ aW: [s, 0, seed, K.GOLD], aX: [3, 0, 0, 0] }), { caps: true });
    }
    wood.tube([[0, gS - 0.6, TRI.z0 + 0.4], [0, gS + 0.6, TRI.z0 - 0.6], [0, gS + 1.6, TRI.z0 - 0.7]], [0.16, 0.24], 6, (s) => ({ aW: [TRI.z0, s, seed, K.NAVY], aX: [gS, 0, 0, 0] }));
    for (const side of [-1, 1]) {
      const z = -14.6, t = tOf(z), g = triGunwale(t), w = triWidthAt(t, g);
      wood.tube([[side * (w + 0.1), g + 0.9, z + 0.4], [side * (w + 0.55), -0.9, z - 2.4]], (tt) => 0.07 + 0.02 * tt, 6, (s) => ({ aW: [s, 0, seed, K.SPAR], aX: [1, side, 0, 0] }), { caps: true });
      wood.beam([side * (w + 0.5), -0.6, z - 2.2], [side * (w + 0.62), -1.3, z - 2.6], 0.05, 0.42, (p) => W(p[2], p[1], seed, K.BLADE, p[1]), [0, 0, 1]);
      wood.beam([side * (w - 0.3), g + 0.85, z + 0.4], [side * (w + 0.15), g + 0.9, z + 0.4], 0.12, 0.12, (p) => W(p[0], p[1], seed, K.SPAR, p[1]));
    }
  }
  // ---- crew: seated thranites along both rails, deck crew, helmsman, archers forward
  if (o.crew !== false && det > 0.25) {
    const every = det > 0.7 ? 1 : 2;
    let k = 0;
    for (const side of [-1, 1]) for (let z = TRI.outZ0 + 1.0; z < TRI.outZ1 - 0.8; z += 0.98 * every) {
      if (rng.chance(0.22)) continue;
      const t = tOf(z), g = triGunwale(t);
      person(wood, side * (triWidthAt(t, g) - 0.3), g - 0.42 + 0.02, z + rng.range(-0.08, 0.08), rng.range(0.92, 1.0), side > 0 ? -PI / 2 + 0.3 : PI / 2 - 0.3, (k++ * 0.137 + seed) % 1, false, det > 0.7 ? 8 : 6);
    }
    const deckY = (z) => triGunwale(tOf(z)) - 0.3;
    const stand = [[0, -15.4, 0], [0.4, -13.2, 0], [-0.4, 12.6, 1], [0.35, 13.8, 1], [0.0, -4.5, 0]];
    for (const [x, z, helm] of stand) person(wood, x, deckY(z), z, rng.range(1.65, 1.8), rng.range(-PI, PI), (k++ * 0.137 + seed) % 1, !!helm, det > 0.7 ? 8 : 6);
  }
  // ---- mast, yard, sail, rigging
  const mastZ = o.mastZ ?? TRI.mastZ, deck = triGunwale(tOf(mastZ)) - 0.42;
  const mastTop = deck + (o.mastH ?? 12.0), yardY = mastTop - 0.7, yardW = o.yardW ?? 13.8, sailH = o.sailH ?? 8.0;
  if (o.sailState !== 'none') {
    wood.tube([[0, deck - 0.2, mastZ], [0, mastTop, mastZ]], (t) => 0.2 - 0.07 * t, SID, (s, a) => ({ aW: [s * 3, a, seed, K.SPAR], aX: [5, 0, 0, 0] }), { caps: true });
    wood.tube([[0, mastTop - 0.2, mastZ], [0, mastTop + 0.45, mastZ]], 0.12, SID, () => ({ aW: [0, 0, seed, K.GOLD], aX: [5, 0, 0, 0] }), { caps: true });
    const yaw = o.yardYaw ?? 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const yp = (x, y, dz = 0) => [x * cy + dz * sy, y, mastZ - x * sy + dz * cy];
    const yardPts = []; for (let i = 0; i <= 8; i++) { const e = i / 8 * 2 - 1; yardPts.push(yp(e * yardW / 2, yardY + 0.25 * e * e, 0.18)); }
    wood.tube(yardPts, (t) => 0.13 * (1 - 0.55 * Math.abs(2 * t - 1)), 6, (s) => ({ aW: [s * 3, 0, seed, K.SPAR], aX: [5, 0, 0, 0] }));
    const ss = o.sailState || 'set', sk = o.sailKind ?? 0;
    const belly = o.belly ?? 0.11;
    // r6: mid-detail sails (18+ columns = 2 per brail channel) keep shallow brail channels too (they shade the cloth: the
    //     flat sails read as boards from shot 1)
    const snx = det > 0.7 ? 72 : Math.round(10 + 14 * det);
    if (ss === 'set') sail(sailB, yardW * 0.95, sailH, yardY - 0.12, mastZ + 0.3, sailH * belly, sk, seed, { nx: snx, ny: Math.round(8 + 10 * det), yaw, pivot: mastZ, ripple: det > 0.7 ? 0.14 : snx >= 18 ? 0.08 : 0 });
    else if (ss === 'loose') sail(sailB, yardW * 0.88, sailH * 0.62, yardY - 0.12, mastZ + 0.3, 0.3, sk === 0 ? 4 : sk, seed, { nx: Math.round(14 + 14 * det), ny: Math.round(8 + 8 * det), folds: 0.16, yaw, pivot: mastZ });
    else {
      const fp = yardPts.slice(1, -1).map((p) => [p[0], p[1] - 0.32, p[2] + 0.05]);
      wood.tube(fp, (t) => 0.28 * (1 - 0.5 * Math.pow(Math.abs(2 * t - 1), 2)), 7, (s, a) => ({ aW: [s * 2, a * 3, seed, K.CANVAS], aX: [5, 0, 0, 0] }));
    }
    // rigging
    const R = 0.022, rope = (pts) => wood.tube(pts, R, 3, (s) => ({ aW: [s, 0, seed, K.ROPE], aX: [5, 0, 0, 0] }));
    const sag = (p, q, d = 0.15, n = 6) => { const r = []; for (let i = 0; i <= n; i++) { const t = i / n, a = lerp3(p, q, t); a[1] -= d * 4 * t * (1 - t); r.push(a); } return r; };
    const top = [0, mastTop, mastZ];
    rope(sag(top, [0, triGunwale(0.97) + 0.3, 16.6], 0.1));
    rope(sag(top, [0, triGunwale(0.05) + 0.4, -16.0], 0.1));
    for (const side of [-1, 1]) {
      rope(sag([0, mastTop - 0.3, mastZ], [side * 2.4, triGunwale(tOf(mastZ - 1.8)) + 0.1, mastZ - 1.8], 0.05, 3));
      rope(sag([0, mastTop - 0.3, mastZ], [side * 2.4, triGunwale(tOf(mastZ + 1.6)) + 0.1, mastZ + 1.6], 0.05, 3));
      rope(sag(top, yp(side * yardW * 0.47, yardY + 0.2, 0.18), 0.05, 3));                  // lifts
      rope(sag(yp(side * yardW * 0.48, yardY + 0.2, 0.18), [side * 2.2, triGunwale(0.18) + 0.2, -11.5], 0.25, 6)); // braces
      if (ss === 'set') rope(sag(yp(side * yardW * 0.46, yardY - sailH * 0.97, 0.3 + sailH * belly * 0.3), [side * 2.2, triGunwale(0.3) + 0.1, -6.5], 0.2, 5)); // sheets
    }
    // pennant streaming from the masthead
    if (o.pennant !== false) {
      const P = [];
      const n = 12, Lp = 4.2;
      for (let i = 0; i <= n; i++) {
        const t = i / n, z = mastZ - t * Lp, y = mastTop + 0.3 - t * 0.6 + 0.12 * Math.sin(t * 9 + seed * 5), x = 0.25 * Math.sin(t * 6 + seed * 3) * t;
        const hw = 0.28 * (1 - 0.85 * t);
        P.push([[x, y - hw, z], [x, y + hw, z]]);
      }
      wood.grid(P, (i, j) => W(i * 0.3, j, seed, K.NAVY, 8), false);
    }
  }
  // ---- oars
  const oars = [];
  if (o.oarState !== 'none') {
    const banks = [
      { n: Math.round(31 * (det > 0.4 ? 1 : 0.6)), y: null, len: 5.2, z0: TRI.outZ0 + 0.9, z1: TRI.outZ1 - 0.7 },
      { n: Math.round(27 * (det > 0.4 ? 1 : 0.6)), y: 1.75, len: 4.3, z0: -11.6 + 0.49, z1: 11.2 - 0.49 },
      { n: Math.round(27 * (det > 0.4 ? 1 : 0.6)), y: 1.05, len: 3.7, z0: -11.6 + 0.49, z1: 11.2 - 0.49 },
    ];
    banks.forEach((b, bi) => {
      for (const side of [-1, 1]) for (let k = 0; k < b.n; k++) {
        const z = b.z0 + ((b.z1 - b.z0) * k) / (b.n - 1), t = tOf(z);
        const y = b.y ?? triGunwale(t) - 0.12;
        const x = b.y ? triWidthAt(t, y) + 0.02 : triWidthAt(t, y) + TRI.outW;
        oars.push({ pivot: [side * x, y, z], side, bank: bi, len: b.len * (0.98 + 0.04 * rng.random()), jit: rng.range(-0.05, 0.05) });
      }
    });
    if (o.bakeOars !== false) {
      const og = oarGeometry(det > 0.6 ? 5 : 4), m = new THREE.Matrix4();
      for (const oa of oars) wood.addGeometry(og, oarMatrix(oa, (o.phase ?? 2.2) + oa.jit, o.oarState || 'row', m));
    }
  }
  return { wood, sail: sailB, oars, dims: { L: 40, B: 5.6, mastTop, yardY } };
}

function splitRuns(pts, maxGap) {
  const runs = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][2] - pts[i - 1][2]) > maxGap) runs.push([]);
    runs[runs.length - 1].push(pts[i]);
  }
  return runs;
}

// ------------------------------------------------------------------ small boats and merchantmen
/** o = { type: 'boat'|'merchant', seed, detail, sailState: 'set'|'furled'|'none', sailKind } */
export function buildBoat(o = {}) {
  const det = o.detail ?? 0.6, seed = o.seed ?? 0.5, rng = new RNG('boat:' + seed);
  const wood = new GeoBuilder(SHIP_ATTRS), sailB = new GeoBuilder(SAIL_ATTRS);
  const merchant = o.type === 'merchant';
  const L = merchant ? 19 : rng.range(6.5, 8.5), B = merchant ? 5.6 : rng.range(2.0, 2.4), D = merchant ? 2.6 : 1.1, T = merchant ? 1.3 : 0.4;
  const sheerB = merchant ? 0.9 : 0.45, sheerS = merchant ? 1.4 : 0.35;
  const NT = Math.round(14 + 14 * det), M = Math.round(6 + 6 * det);
  const painted = rng.chance(0.5);
  const g = (t) => D - T + (t > 0.5 ? sheerB : sheerS) * Math.pow(Math.abs(2 * t - 1), 2.2);
  const w = (t) => (B / 2) * Math.pow(Math.sin(PI * clamp(t, 0.01, 0.99)), merchant ? 0.55 : 0.6);
  const k = (t) => -T * Math.pow(Math.sin(PI * clamp(t, 0.02, 0.98)), 0.25);
  const zz = (t) => -L / 2 + t * L;
  const rows = [];
  for (let i = 0; i <= NT; i++) {
    const t = 0.004 + (i / NT) * 0.992, row = [];
    for (let j = 0; j <= 2 * M; j++) { const phi = (PI * j) / (2 * M); row.push([-w(t) * Math.cos(phi), g(t) - (g(t) - k(t)) * Math.pow(Math.sin(phi), 0.75), zz(t)]); }
    rows.push(row);
  }
  wood.grid(rows, (i, j) => { const p = rows[i][j]; const t = i / NT; const d = g(t) - p[1]; return W(p[2], d, seed, painted && d < 0.32 ? K.NAVY : K.PLAIN, p[1], Math.sign(p[0])); }, true);
  // deck / thwarts
  const P = [];
  for (let i = 0; i <= 10; i++) { const t = 0.08 + i * 0.084, y = g(t) - 0.3, ww = w(t) * 0.92; P.push([[-ww, y, zz(t)], [ww, y, zz(t)]]); }
  wood.grid(P, (i, j) => { const p = P[i][j]; return W(p[0] + 20, p[2], seed, K.DECK, p[1]); }, true);
  // stem and swan-neck stern
  const tb = g(1), ts = g(0);
  wood.tube([[0, -T * 0.8, L / 2 - 0.2], [0, tb * 0.5, L / 2 + 0.25], [0, tb + 0.3, L / 2 + 0.35], [0, tb + (merchant ? 0.8 : 0.5), L / 2 + 0.15]], 0.12, 5, (s) => ({ aW: [s, 0, seed, K.SPAR], aX: [2, 0, 0, 0] }), { caps: true });
  const neck = merchant ? 1.9 : 0.8;
  wood.tube(bezier([[0, ts - 0.3, -L / 2 + 0.3], [0, ts + neck * 0.6, -L / 2 - 0.5], [0, ts + neck * 1.2, -L / 2 + 0.1], [0, ts + neck * 0.95, -L / 2 + 0.75]], 8), (t) => 0.15 * (1 - 0.5 * t), 5, (s) => ({ aW: [s, 0, seed, merchant ? K.GOLD : K.SPAR], aX: [2, 0, 0, 0] }), { caps: true });
  // gunwale rails
  for (const side of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 12; i++) { const t = 0.04 + i * 0.077; pts.push([side * w(t), g(t) + 0.02, zz(t)]); }
    wood.tube(pts, 0.05, 4, (s) => ({ aW: [s, 0, seed, K.SPAR], aX: [2, side, 0, 0] }));
  }
  if (merchant) {
    // deckhouse aft + cargo
    wood.obox([0, g(0.3) + 0.2, -L * 0.28], [B * 0.22, 0, 0], [0, 0.55, 0], [0, 0, 1.3], (p) => W(p[0] + p[2], p[1], seed, K.DECK, p[1]));
    for (let c = 0; c < 8; c++) wood.obox([rng.range(-1.2, 1.2), g(0.5) - 0.1, rng.range(-2, 4.5)], [0.35, 0, 0], [0, 0.3, 0], [0, 0, 0.35], (p) => W(p[0] + p[2], p[1], seed, rng.chance(0.5) ? K.CLAY : K.CANVAS, p[1]));
  } else if (o.oars !== false) {
    for (const side of [-1, 1]) for (const z of [-0.6, 1.0]) {
      const p = [side * w(0.5), g(0.5) + 0.05, z];
      wood.tube([p, [side * (w(0.5) + 2.6), -0.1, z - 0.5]], 0.03, 4, (s) => ({ aW: [s, 0, seed, K.OAR], aX: [1, side, 0, 0] }));
    }
  }
  // crew
  const nCrew = merchant ? rng.int(2, 4) : rng.int(0, 2);
  for (let c = 0; c < nCrew; c++) { const t = rng.range(0.25, 0.75); person(wood, rng.range(-0.4, 0.4) * w(t), g(t) - 0.3, zz(t), merchant ? 1.7 : rng.range(1.0, 1.7), rng.range(-PI, PI), rng.random(), false, 6); }
  if (o.sailState && o.sailState !== 'none') {
    const mastH = merchant ? 12 : 5.2, yardW = merchant ? 12 : 4.4, sH = merchant ? 7.5 : 3.4, mz = merchant ? 0.8 : 0.6;
    const y0 = g(0.5) - 0.4;
    wood.tube([[0, y0, mz], [0, y0 + mastH, mz]], (t) => (merchant ? 0.2 : 0.08) * (1 - 0.4 * t), 5, (s) => ({ aW: [s * 3, 0, seed, K.SPAR], aX: [4, 0, 0, 0] }), { caps: true });
    const yy = y0 + mastH - 0.4;
    wood.tube([[-yardW / 2, yy, mz + 0.12], [yardW / 2, yy, mz + 0.12]], merchant ? 0.11 : 0.05, 5, (s) => ({ aW: [s * 3, 0, seed, K.SPAR], aX: [4, 0, 0, 0] }));
    if (o.sailState === 'set') sail(sailB, yardW * 0.95, sH, yy - 0.08, mz + 0.18, sH * 0.12, o.sailKind ?? 1, seed, { nx: 10, ny: 8 });
    else wood.tube([[-yardW * 0.45, yy - 0.2, mz + 0.15], [yardW * 0.45, yy - 0.2, mz + 0.15]], merchant ? 0.25 : 0.12, 6, (s) => ({ aW: [s, 0, seed, K.CANVAS], aX: [4, 0, 0, 0] }));
    const rope = (p, q) => wood.tube([p, q], 0.02, 3, (s) => ({ aW: [s, 0, seed, K.ROPE], aX: [4, 0, 0, 0] }));
    rope([0, y0 + mastH, mz], [0, g(1) + 0.2, L / 2 - 0.3]);
    rope([0, y0 + mastH, mz], [0, g(0) + 0.2, -L / 2 + 0.6]);
  }
  return { wood, sail: sailB, dims: { L, B } };
}
