// Poseidon as an SDF figure (built on makeFigure): heroic nude torso with a himation wrapped round the hips,
// full curly beard, long wavy locks, a spiked (radiate) crown, and the trident.
// Nominal figure units (2.0 m figure, sole y = 0, facing +Z, right side = -X); scale at placement.
//   poseidonSpec('chariot' | 'colossus') → { fig, trident: { base, top, r, grip }, variant }
//   tridentSdf(L, r) → SDF of a trident standing on its butt at the origin, shaft along +Y, length L
import { sd, clamp, lerp, sstep, smin, smax, add, sub, scale, norm, len, mix3, mv, cone, vnoise3, hash1, fbm3 } from './sdf.js';
import { makeFigure } from './figure.js';

// ------------------------------------------------------------------ head extras (HEAD UNITS: chin y -0.5, crown +0.5)
/** full curly beard with moustache and corkscrew locks */
export function beardExtra(o = {}) {
  const seed = o.seed ?? 5, L = o.length ?? 1;
  const sdf = (x, y, z) => {
    if (y > 0.05 || z < -0.3 || y < -0.62 - 0.55 * L) return 1;
    const ax = Math.abs(x);
    // mass: from the cheeks along the jaw to a rounded, slightly forked point below the chin
    let d = cone(ax, y, z, [0.22, -0.1, 0.0], [0.11, -0.5, 0.27], 0.085, 0.14);
    d = smin(d, sd.ellipsoid(x, y + 0.55 + 0.25 * L, z - 0.24, 0.2, 0.22 + 0.2 * L, 0.15), 0.12);
    d = smin(d, sd.ellipsoid(ax - 0.06, y + 0.72 + 0.4 * L, z - 0.2, 0.09, 0.14, 0.09), 0.08); // forked tips
    // moustache: sweeping from under the nose down past the mouth corners
    d = smin(d, cone(ax, y, z, [0.02, -0.235, 0.43], [0.14, -0.36, 0.36], 0.032, 0.045), 0.03);
    // keep the lower lip and mouth free
    d = smax(d, -sd.ellipsoid(x, y + 0.31, z - 0.43, 0.055, 0.03, 0.06), 0.02);
    // corkscrew locks: vertical waves + spiral curls
    const ang = Math.atan2(x, z - 0.05);
    const wav = Math.sin(ang * 13 + Math.sin(y * 14 + seed) * 1.2);
    const curl = Math.sin(y * 36 + ang * 3 + seed) * 0.5 + 0.5;
    d -= 0.022 * Math.abs(wav) * (0.6 + 0.4 * curl) * sstep(-0.18, -0.35, y);
    d -= 0.008 * vnoise3(x * 30 + seed, y * 30, z * 30);
    return d * 0.75;
  };
  return { sdf, blend: 0.03 };
}

/** long wavy locks falling from behind the ears to the nape and shoulders */
export function hairBackExtra(o = {}) {
  const seed = o.seed ?? 3;
  const sdf = (x, y, z) => {
    if (z > 0.2 || y > 0.55 || y < -1.15) return 1;
    let d = sd.ellipsoid(x, y + 0.18, z + 0.12, 0.42, 0.72, 0.4);
    d = smax(d, -sd.ellipsoid(x, y + 0.18, z + 0.06, 0.33, 0.62, 0.3), 0.04); // hollow: it is a mass of hair around the neck
    d = smax(d, z - 0.02 - 0.15 * sstep(0.1, -0.5, y), 0.06);   // only behind the ears
    d = smax(d, -0.98 - y, 0.08);
    d = Math.min(d, sd.ellipsoid(x, y - 0.1, z + 0.13, 0.385, 0.43, 0.42)); // fill the skull side
    const ang = Math.atan2(x, -z);
    d -= 0.03 * Math.abs(Math.sin(ang * 9 + y * 6 + seed)) + 0.01 * vnoise3(x * 20, y * 20 + seed, z * 20);
    return d * 0.75;
  };
  return { sdf, blend: 0.04 };
}

/** gold radiate crown: a band around the head carrying tapering spikes */
export function crownExtra(o = {}) {
  const n = o.spikes ?? 9, H = o.spikeLen ?? 0.34;
  const cy = 0.3, cz = -0.07, rx = 0.375, rz = 0.455, tilt = 0.12;
  const spikes = [];
  for (let i = 0; i < n; i++) {
    const a = lerp(-2.25, 2.25, i / (n - 1)); // over the front 260 deg
    const bx = Math.sin(a) * rx, bz = cz + Math.cos(a) * rz, by = cy - tilt * Math.cos(a) + 0.04;
    const out = norm([Math.sin(a) * 0.55, 1, Math.cos(a) * 0.55]);
    const h = H * (1 - 0.25 * Math.abs(a) / 2.25);
    spikes.push({ b: [bx, by, bz], t: add([bx, by, bz], scale(out, h)) });
  }
  const sdf = (x, y, z) => {
    const r2 = x * x + (y - 0.45) ** 2 + (z + 0.07) ** 2;
    if (r2 > 0.75) return Math.sqrt(r2) - 0.75;
    // band: elliptic ring, tilted (lower at the front)
    const yy = y - (cy - tilt * ((z - cz) / rz));
    const e = Math.hypot(x / rx, (z - cz) / rz);
    const dr = (e - 1) * Math.min(rx, rz);
    let d = Math.hypot(Math.max(Math.abs(dr) - 0.018, 0), Math.max(Math.abs(yy) - 0.045, 0)) + Math.min(Math.max(Math.abs(dr) - 0.018, Math.abs(yy) - 0.045), 0);
    d = Math.max(d, -(dr + 0.06)); // no inner shell
    for (const S of spikes) d = Math.min(d, cone(x, y, z, S.b, S.t, 0.045, 0.006));
    return d;
  };
  return { sdf, gold: (x, y, z) => (sdf(x, y, z) < 0.03 ? 1 : 0) };
}

// ------------------------------------------------------------------ trident
/** trident on its butt at the origin, shaft along +Y. Units: same as L (nominal figure units). */
export function tridentSdf(L = 2.6, r = 0.018) {
  const hb = L - 0.5;          // base of the head (collar)
  const pw = 0.13;             // half-spread of the outer prongs
  const prongs = [
    [[0, hb + 0.04, 0], [0, hb + 0.18, 0], [0, L, 0]],
    [[0, hb + 0.04, 0], [pw * 1.25, hb + 0.08, 0], [pw, L - 0.07, 0]],
    [[0, hb + 0.04, 0], [-pw * 1.25, hb + 0.08, 0], [-pw, L - 0.07, 0]],
  ];
  const segs = [];
  for (const [a, b, c] of prongs) {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8, u = 1 - t; pts.push([0, 1, 2].map((k) => u * u * a[k] + 2 * u * t * b[k] + t * t * c[k])); }
    segs.push(pts);
  }
  return (x, y, z) => {
    if (y < hb - 0.25) return Math.min(Math.hypot(x, z) - r * (1 + 0.15 * sstep(0.2, 0.0, y)), y < -0.01 ? -y : 1e9) ;
    // shaft with ornamental rings below the collar
    let d = sd.capsule(x, y, z, 0, 0, 0, 0, hb, 0, r);
    for (const ry of [hb - 0.2, hb - 0.12, hb - 0.05]) d = smin(d, sd.torus(x, y - ry, z, r * 1.25, r * 0.55), 0.004);
    d = smin(d, sd.ellipsoid(x, y - hb, z, 0.05, 0.045, 0.04), 0.01);                    // collar knop
    for (let s = 0; s < 3; s++) {
      const P = segs[s];
      for (let i = 0; i < P.length - 1; i++) {
        const t = i / (P.length - 1);
        d = smin(d, cone(x, y, z, P[i], P[i + 1], lerp(0.016, 0.011, t), lerp(0.016, 0.011, t + 1 / 8)), 0.006);
      }
      // barbed, leaf-shaped point
      const tip = P[P.length - 1], b0 = P[P.length - 3];
      const ax = norm(sub(tip, b0));
      const q = sub([x, y, z], tip);
      const h = clamp(-(q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2]), 0, 0.12);
      const rr = Math.hypot(q[0] + ax[0] * h, q[1] + ax[1] * h, q[2] + ax[2] * h);
      const w = 0.035 * Math.sin(Math.PI * Math.min(1, h / 0.12)) + 0.004;
      const flat = Math.abs(q[2]) - 0.009;
      d = Math.min(d, Math.max(rr - w, flat, -(q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2]) - 0.125, q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2] - 0.004));
      // barbs at the base of the point, curving back
      for (const sg of [-1, 1]) {
        const bb = add(tip, add(scale(ax, -0.11), [sg * 0.03 * Math.abs(ax[1]), 0, 0]));
        const be = add(bb, [sg * 0.03, -0.05, 0]);
        d = Math.min(d, Math.max(sd.capsule(x, y, z, bb[0], bb[1], bb[2], be[0], be[1], be[2], 0.008), Math.abs(z) - 0.008));
      }
    }
    return d;
  };
}

// ------------------------------------------------------------------ the figure
export function poseidonSpec(variant = 'chariot') {
  const V = {
    // standing in the chariot, trident raised high in the right hand, reins in the left (ref 3)
    chariot: {
      seed: 41, weight: 'R', hip: { roll: 0.07, yaw: 0.05 }, chest: { yaw: -0.12, pitch: 0.04 }, head: { yaw: 0.22, pitch: 0.12, roll: -0.04 },
      armR: { wrist: [-0.4, 1.92, 0.12], pole: [-1, -0.25, -0.3], fingers: [0.12, 0.05, 1], dorsal: [-1, 0, 0.1], curl: [1.25, 1.35, 0.9], thumbCurl: 0.9, spread: 0, handScale: 1.08 },
      armL: { wrist: [0.52, 1.26, 0.32], pole: [0.8, -0.5, -0.4], fingers: [0.45, -0.25, 0.8], dorsal: [0.15, 1, 0], curl: [1.0, 1.1, 0.8], thumbCurl: 0.7, spread: 0.02, handScale: 1.08 },
      freeAnkle: [0.16, 0.08, 0.16], tridentHand: 'R', tridentDrop: 1.15,
      drape: { bareChest: true, himTop: 1.08, himSlope: 0.32, himBottom: 0.42, fallBottom: 0.62, mantle: false, belt: false, folds: 24 },
    },
    // colossus on its pedestal: trident upright in the left hand, right arm stretched out over the city (refs 1, 5)
    colossus: {
      seed: 47, weight: 'L', hip: { roll: -0.07 }, chest: { yaw: 0.08 }, head: { yaw: -0.12, pitch: 0.14 },
      armL: { wrist: [0.4, 1.58, 0.12], pole: [0.3, -1, -0.35], fingers: [-0.1, 0.05, 1], dorsal: [1, 0, 0.1], curl: [1.25, 1.35, 0.9], thumbCurl: 0.9, spread: 0, handScale: 1.08 },
      armR: { wrist: [-0.36, 1.2, 0.48], pole: [-1, -0.6, -0.2], fingers: [-0.1, -0.15, 1], dorsal: [0, 1, 0.1], curl: [0.25, 0.3, 0.2], thumbCurl: 0.2, spread: 0.08, handScale: 1.08 },
      freeAnkle: [-0.15, 0.1, 0.14], tridentHand: 'L', tridentDrop: 'ground',
      drape: { bareChest: true, himTop: 1.1, himSlope: -0.35, himBottom: 0.32, fallBottom: 0.5, mantle: false, belt: false, folds: 26 },
    },
  }[variant];
  const spec = {
    sex: 'm', seed: V.seed, garment: 'himation', weight: V.weight, strong: true, handRegion: true,
    hip: V.hip, chest: V.chest, head: V.head, hair: 'curly', beard: false, locks: true, headScale: 1.08,
    armR: V.armR, armL: V.armL, freeAnkle: V.freeAnkle, drape: V.drape,
    headExtras: [beardExtra({ seed: V.seed }), hairBackExtra({ seed: V.seed + 1 }), crownExtra({})],
    headBoundsUp: 0.12, headBoundsExtra: 0.07,
  };
  const fig = makeFigure(spec);
  // trident through the fist
  const J = fig.joints;
  const M = V.tridentHand === 'R' ? J.handR : J.handL, w = V.tridentHand === 'R' ? J.aR.wr : J.aL.wr;
  const grip = add(w, add(mv(M, 0, 0.058, 0), mv(M, 0, 0, -0.036)));
  const L = 2.75;
  const baseY = V.tridentDrop === 'ground' ? 0 : grip[1] - V.tridentDrop;
  const trident = { base: [grip[0], baseY, grip[2]], top: [grip[0], baseY + L, grip[2]], L, r: 0.019, grip };
  return { fig, trident, variant, spec };
}
