// Sunken-era trireme wreck (ref 7): keel and broken frames (ribs) standing out of the sand, planking left
// only on the bow (with the painted eye still readable) and on the lowest strakes, the gilt rail stanchions
// like a broken fence, the ram and stem post, and loose debris. Local trireme frame (see trireme.js).
import * as THREE from 'three';
import { GeoBuilder, SHIP_ATTRS, bezier } from './geo.js';
import { K } from './mats.js';
import { TRI, triBeam, triGunwale, triKeel, triWidthAt } from './trireme.js';
import { RNG } from '../core/rng.js';

const PI = Math.PI;
const zOf = (t) => TRI.z0 + (TRI.z1 - TRI.z0) * t;
const tOf = (z) => (z - TRI.z0) / (TRI.z1 - TRI.z0);
const W = (u, v, seed, kind, y = 0, side = 0) => ({ aW: [u, v, seed, kind], aX: [y, side, 0, 0] });

/**
 * o = { seed, bowKeep (0..1: how much of the forward hull keeps its planking), splay (sides falling outward),
 *       detail, scale }
 * returns { wood: GeoBuilder, coral: [{pos (local), normal, size}] }
 */
export function buildWreck(o = {}) {
  const seed = o.seed ?? 0.71, rng = new RNG('wreck:' + seed), det = o.detail ?? 1;
  const b = new GeoBuilder(SHIP_ATTRS);
  const coral = [];
  const splay = o.splay ?? 0.22, bowKeep = o.bowKeep ?? 0.3;
  const P = (t, phi) => {
    const w = triBeam(t), g = triGunwale(t), k = triKeel(t);
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const x = -w * cp * (0.95 + 0.09 * Math.sqrt(Math.max(0, sp)));
    const y = g - (g - k) * Math.pow(Math.abs(sp), 0.72);
    // sides sag outward (frames broken at the turn of the bilge)
    const fall = splay * Math.pow(1 - Math.abs(sp), 1.5) * (1 - smooth(0.7, 0.95, t));
    return [x * (1 + fall * 0.8), y - fall * Math.abs(x) * 0.6, zOf(t)];
  };
  // ---- keel + keelson
  const keel = []; for (let i = 0; i <= 30; i++) { const t = 0.03 + (i / 30) * 0.95; keel.push([0, triKeel(t) - 0.05, zOf(t)]); }
  b.tube(keel, [0.2, 0.28], 6, (s) => ({ aW: [s, 0, seed, K.TIMBER], aX: [-1, 0, 0, 0] }), { caps: true });
  const ks = keel.map((p) => [p[0], p[1] + 0.45, p[2]]).slice(3, -4);
  b.tube(ks, [0.16, 0.14], 5, (s) => ({ aW: [s, 1, seed, K.TIMBER], aX: [-0.5, 0, 0, 0] }));
  // ---- frames (ribs), broken at random heights; intact toward the bow
  const tBow = 1 - bowKeep;
  for (let z = TRI.z0 + 2.2; z < TRI.z1 - 1.2; z += 0.95) {
    const t = tOf(z);
    for (const side of [-1, 1]) {
      let keep;
      if (t > tBow) keep = 1;
      else if (t < 0.22) keep = rng.chance(0.35) ? 0 : rng.range(0.1, 0.5);
      else keep = rng.chance(0.1) ? rng.range(0.05, 0.2) : rng.range(0.6, 1.0);
      if (keep <= 0.02) continue;
      const pts = [];
      const phiEnd = PI / 2 * (1 - keep);
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const phi = PI / 2 - (PI / 2 - phiEnd) * (i / n);
        const p = P(t, side > 0 ? PI - phi : phi);
        // inset from the planking
        p[0] -= Math.sign(p[0] || side) * 0.08; p[1] += 0.06;
        pts.push(p);
      }
      // a slight random lean of the broken top
      const top = pts[pts.length - 1];
      top[2] += rng.range(-0.25, 0.25) * (1 - keep);
      b.tube(pts, (tt) => [0.09 * (1 - 0.25 * tt), 0.12 * (1 - 0.3 * tt)], 4, (s) => ({ aW: [s * 2, z, seed, K.TIMBER], aX: [top[1] * 0.5, side, 0, 0] }), { caps: true });
      if (keep > 0.6 && rng.chance(0.3)) coral.push({ pos: top, normal: [side * 0.4, 0.9, 0], size: 0.3 + 0.3 * rng.random() });
    }
  }
  // ---- planking: full on the bow, lowest strakes elsewhere, jagged edge
  const NT = Math.round(30 + 40 * det), M = 14;
  for (const side of [-1, 1]) {
    const cut = [];
    for (let i = 0; i <= NT; i++) {
      const t = 0.05 + (i / NT) * 0.945;
      let jMax; // planks kept from the keel up to phi index jMax (M = gunwale)
      if (t > tBow + 0.04) jMax = t > 0.9 ? M : M - (rng.chance(0.35) ? rng.int(1, 3) : 0);
      else if (t > tBow - 0.06) jMax = Math.round(M * (0.45 + rng.range(0, 0.5)));
      else if (t > 0.25) jMax = Math.round(M * rng.range(0.15, 0.45));
      else jMax = Math.round(M * rng.range(0.0, 0.25));
      cut.push(jMax);
    }
    for (let i = 0; i < NT; i++) {
      const t0 = 0.05 + (i / NT) * 0.945, t1 = 0.05 + ((i + 1) / NT) * 0.945;
      const jm = Math.min(cut[i], cut[i + 1] + (rng.chance(0.5) ? 1 : 0));
      for (let j = 0; j < jm; j++) {
        // j = 0 at the keel → M at the gunwale
        const ph0 = PI / 2 * (1 - j / M), ph1 = PI / 2 * (1 - (j + 1) / M);
        const f = (t, ph) => P(t, side > 0 ? PI - ph : ph);
        const a = f(t0, ph0), bb = f(t1, ph0), c = f(t1, ph1), d = f(t0, ph1);
        // missing planks: random holes in the kept area (not on the eye panel)
        if (t0 < 0.86 && j > 2 && rng.chance(0.13)) continue;
        const at = (p) => W(p[2], triGunwale(tOf(p[2])) - p[1], seed, K.HULL, p[1], side);
        if (side > 0) b.quad(a, bb, c, d, null, { aW: [a, bb, c, d].map((p) => at(p).aW), aX: [a, bb, c, d].map((p) => at(p).aX) });
        else b.quad(a, d, c, bb, null, { aW: [a, d, c, bb].map((p) => at(p).aW), aX: [a, d, c, bb].map((p) => at(p).aX) });
      }
    }
  }
  // ---- gunwale / rail stanchions on the bow half (the broken "fence" of ref 7)
  for (const side of [-1, 1]) {
    for (let z = TRI.outZ0 + 3; z < TRI.z1 - 1.5; z += 1.22) {
      const t = tOf(z);
      if (t < tBow - 0.25 && rng.chance(0.6)) continue;
      const g = P(t, side > 0 ? PI : 0);
      const h = t > tBow ? rng.range(0.7, 1.2) : rng.range(0.25, 1.1);
      const lean = rng.range(-0.15, 0.15);
      b.beam([g[0], g[1] - 0.2, z], [g[0] + side * 0.12, g[1] + h, z + lean], 0.13, 0.13, (p) => W(p[2], p[1], seed, rng.chance(0.4) ? K.GOLD : K.TIMBER, p[1], side));
    }
    // a run of gunwale rail on the bow
    const pts = []; for (let t = tBow - 0.05; t < 0.985; t += 0.02) pts.push(P(t, side > 0 ? PI : 0).map((v, k) => (k === 1 ? v + 0.05 : v)));
    if (pts.length > 2) b.tube(pts, 0.08, 5, (s) => ({ aW: [s, 0, seed, K.GOLD], aX: [2, side, 0, 0] }));
  }
  // ---- deck beams across the bow
  for (let z = TRI.z1 - 8 * bowKeep * 2.5; z < TRI.z1 - 1.5; z += 1.9) {
    const t = tOf(z); const g = triGunwale(t) - 0.5, w = triWidthAt(t, g);
    if (t < tBow) continue;
    b.beam([-w, g, z], [w, g, z], 0.16, 0.2, (p) => W(p[0], p[1], seed, K.TIMBER, p[1]));
  }
  // ---- ram (bronze) and the stem post, the volute broken off
  {
    const zr = TRI.z1;
    b.tube([[0, 0.12, zr - 1.4], [0, 0.1, zr + 0.6], [0, 0.08, zr + 1.9], [0, 0.07, zr + 2.5]], (t) => [0.42 * (1 - 0.72 * t), 0.36 * (1 - 0.6 * t)], 8, (s, a) => ({ aW: [s, a, seed, K.BRONZE], aX: [0.1, 0, 0, 0] }), { caps: true });
    for (const yy of [-0.12, 0.1, 0.32]) b.beam([0, yy + 0.05, zr + 1.1], [0, yy + 0.03, zr + 2.75], 0.62 - Math.abs(yy - 0.1) * 0.6, 0.07, (p) => W(p[2], p[1], seed, K.BRONZE, p[1]));
    const gT = triGunwale(0.999);
    const pts = [[0, 0.2, zr + 0.05], [0, gT * 0.6, zr + 0.15], ...bezier([[0, gT + 0.4, zr + 0.3], [0, gT + 2.2, zr + 0.7], [0, gT + 4.0, zr + 0.62]], 7)];
    b.tube(pts, (t) => [0.12 * (1 - 0.3 * t), 0.22 * (1 - 0.3 * t)], 6, (s) => ({ aW: [s, 0, seed, K.TIMBER], aX: [3, 0, 0, 0] }), { caps: true });
    b.tube([[0, -0.6, zr - 0.05], [0, triGunwale(0.998) * 0.5, zr + 0.02], [0, triGunwale(0.998) + 0.05, zr - 0.02]], [0.13, 0.13], 6, (s) => ({ aW: [zr, s, seed, K.NAVY], aX: [s, 0, 0, 0] }));
    coral.push({ pos: [0, gT + 4.0, zr + 0.62], normal: [0, 1, 0], size: 0.5 });
    // cat-heads
    const ze = 16.3, te = tOf(ze), ge = triGunwale(te) - 0.35, we = triWidthAt(te, ge);
    b.beam([-(we + 0.45), ge, ze], [we + 0.45, ge, ze], 0.28, 0.28, (p) => W(p[0], p[1], seed, K.TIMBER, p[1]), [0, 0, 1]);
  }
  // ---- stern post stump
  b.tube([[0, triKeel(0.03), TRI.z0 + 1.0], [0, 1.4, TRI.z0 - 0.2], [0, 2.4, TRI.z0 - 0.5]], [0.16, 0.22], 6, (s) => ({ aW: [s, 0, seed, K.TIMBER], aX: [1, 0, 0, 0] }), { caps: true });
  // ---- debris: loose planks, oar shafts, the fallen mast lying across the hull
  const nDeb = Math.round(10 + 16 * det);
  for (let i = 0; i < nDeb; i++) {
    const z = rng.range(TRI.z0 - 3, TRI.z1 - 4), x = rng.sign() * rng.range(1.5, 6.5), a = rng.range(-PI, PI);
    const Lp = rng.range(1.5, 4.5), y = -0.75 + rng.range(0, 0.25);
    const dx = Math.cos(a) * Lp / 2, dz = Math.sin(a) * Lp / 2;
    if (rng.chance(0.3)) b.tube([[x - dx, y, z - dz], [x + dx, y + rng.range(-0.1, 0.25), z + dz]], 0.05, 4, (s) => ({ aW: [s, 0, seed, K.OAR], aX: [y, 0, 0, 0] }));
    else b.beam([x - dx, y, z - dz], [x + dx, y + rng.range(-0.1, 0.3), z + dz], rng.range(0.18, 0.3), 0.06, (p) => W(p[0] + p[2], p[1], seed, K.TIMBER, p[1]));
  }
  b.tube([[-6.5, -0.55, -3.5], [-1, 0.6, -1.0], [3.5, 1.3, 1.6], [7.5, 0.0, 4.1]], 0.17, 7, (s) => ({ aW: [s * 3, 0, seed, K.SPAR], aX: [0.4, 0, 0, 0] }), { caps: true });
  for (let i = 0; i < 7; i++) coral.push({ pos: [0, triKeel(0.5) + 0.6, rng.range(-14, 10)], normal: [0, 1, 0], size: 0.4 + 0.4 * rng.random() });
  return { wood: b, coral };
}

/** a small wrecked boat / scattered hull section (cheap) for the rings */
export function buildWreckPiece(o = {}) {
  const seed = o.seed ?? 0.3, rng = new RNG('wpiece:' + seed);
  const b = new GeoBuilder(SHIP_ATTRS);
  const L = rng.range(8, 16), n = Math.round(L / 0.9);
  // keel + a row of ribs, both sides, short; some strakes
  b.tube([[0, 0, -L / 2], [0, 0.05, 0], [0, 0.3, L / 2]], [0.16, 0.22], 5, (s) => ({ aW: [s, 0, seed, K.TIMBER], aX: [-1, 0, 0, 0] }), { caps: true });
  for (let i = 1; i < n; i++) {
    const z = -L / 2 + (i * L) / n;
    const w = 1.9 * Math.pow(Math.sin(PI * (i / n)), 0.5);
    for (const side of [-1, 1]) {
      if (rng.chance(0.25)) continue;
      const h = rng.range(0.4, 2.0);
      const pts = []; for (let k = 0; k <= 5; k++) { const a = (k / 5) * h / 2.0; pts.push([side * w * Math.sin(a * PI / 2) * 1.1, a * 2.0 * 0.9, z]); }
      b.tube(pts, [0.08, 0.1], 4, (s) => ({ aW: [s, z, seed, K.TIMBER], aX: [0, side, 0, 0] }), { caps: true });
    }
  }
  for (let k = 0; k < 4; k++) {
    const side = rng.sign(), y = 0.15 + k * 0.22, x = side * (0.5 + k * 0.35);
    const z0 = rng.range(-L / 2, -L / 4), z1 = rng.range(L / 6, L / 2.2);
    b.beam([x, y, z0], [x, y, z1], 0.06, 0.2, (p) => W(p[2], p[1], seed, K.TIMBER, p[1]), [side, 0, 0]);
  }
  return { wood: b, L };
}

function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

