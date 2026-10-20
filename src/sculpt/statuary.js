// Small gilt statues for the statue slots (stair pedestals, bridge decks, pinnacles): the ten kings of
// Atlantis, warrior kings, nymphs and priestesses. Nominal figure units (2.0 m figure, sole y = 0, facing +Z).
// adapted from athenaion/src/sculpt/statuary.js (types / props), re-cast for Poseidon's city.
import { makeFigure } from './figure.js';
import { meshRegion, bakeAttributes, mergeGeos, triCount } from './bakeutil.js';
import { sd, add, sub, scale, norm, mv, smin, smax, sstep, vnoise3 } from './sdf.js';
import { crownExtra, beardExtra } from './poseidon.js';

const gripOf = (J, side) => {
  const M = side === 'R' ? J.handR : J.handL, w = side === 'R' ? J.aR.wr : J.aL.wr;
  return { M, w, p: add(w, add(mv(M, 0, 0.078, 0), mv(M, 0, 0, -0.034))) };
};
/** vertical staff / spear / sceptre through the fist */
const propStaff = (side, top = 2.2, knob = 'sceptre') => (J) => {
  const g = gripOf(J, side);
  const a = [g.p[0], 0.0, g.p[2]], b = [g.p[0], top, g.p[2]];
  return [{
    sdf: (x, y, z) => {
      let d = sd.capsule(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], 0.016);
      if (knob === 'sceptre') d = smin(d, sd.ellipsoid(x - b[0], y - b[1] - 0.02, z - b[2], 0.045, 0.06, 0.045), 0.02);
      else d = Math.min(d, smax(sd.ellipsoid(x - b[0], y - b[1] - 0.09, z - b[2], 0.03, 0.12, 0.012), -(y - b[1] + 0.01), 0.005));
      return d;
    },
    gold: (x, y, z) => (Math.hypot(x - b[0], z - b[2]) < 0.06 ? 1 : 0),
  }];
};
const propShell = (side) => (J) => {
  // scallop shell held up on the palm
  const M = side === 'R' ? J.handR : J.handL, w = side === 'R' ? J.aR.wr : J.aL.wr;
  const c = add(w, add(mv(M, 0, 0.075, 0), mv(M, 0, 0, -0.05)));
  const n = norm(mv(M, 0, 0, -1));
  return [{
    sdf: (x, y, z) => {
      const p = [x - c[0], y - c[1], z - c[2]];
      const h = p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
      const r = Math.hypot(p[0] - n[0] * h, p[1] - n[1] * h, p[2] - n[2] * h);
      const ang = Math.atan2(p[1] - n[1] * h, p[0] - n[0] * h);
      const outer = Math.hypot(r, h + 0.08) - 0.11 - 0.006 * Math.abs(Math.sin(ang * 7));
      return Math.max(Math.max(outer, -(outer + 0.012)), -h);
    },
    gold: () => 1,
  }];
};
const propTorch = (side) => (J) => {
  const g = gripOf(J, side);
  const a = add(g.p, [0, -0.25, 0]), b = add(g.p, [0, 0.2, 0.0]);
  return [{ sdf: (x, y, z) => smin(sd.roundCone(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], 0.018, 0.03), sd.ellipsoid(x - b[0], y - b[1] - 0.07, z - b[2], 0.05, 0.09, 0.05) + 0.004 * Math.sin(y * 120), 0.02) }];
};

export const SMALL_TYPES = {
  king: {
    sex: 'm', garment: 'himation', weight: 'R', seed: 501, hair: 'curly', headScale: 1.04,
    hip: { roll: 0.05 }, head: { yaw: 0.2, pitch: 0.06 },
    armR: { wrist: [-0.1, 1.24, 0.42], pole: [-1, -0.6, -0.2], fingers: [0, -0.2, 1], dorsal: [0, 1, 0], curl: [0.3, 0.35, 0.25], spread: 0.06 },
    armL: { wrist: [0.27, 1.12, 0.1], pole: [0.5, 0, -1], fingers: [-0.1, 0.05, 1], dorsal: [1, 0, 0.1], curl: [1.25, 1.35, 0.9], thumbCurl: 0.9, spread: 0 },
    extras: [propStaff('L', 2.15, 'sceptre')], drape: { himTop: 1.32, himSlope: 0.5, himBottom: 0.3, fallBottom: 0.4 },
    crown: true, beard: true,
  },
  kingSpear: {
    sex: 'm', garment: 'chiton', weight: 'L', seed: 507, hair: 'curly', headScale: 1.04, strong: true,
    hip: { roll: -0.06 }, head: { yaw: -0.25, pitch: 0.08 },
    armR: { wrist: [-0.38, 1.45, 0.1], pole: [-0.5, -1, -0.45], fingers: [0.1, 0.05, 1], dorsal: [-1, 0, 0.1], curl: [1.25, 1.35, 0.9], thumbCurl: 0.9, spread: 0 },
    armL: { wrist: [0.25, 0.98, 0.08], pole: [0.5, 0, -1], fingers: [0.1, -1, 0.2], dorsal: [1, 0, 0], curl: [0.8, 0.9, 0.6] },
    extras: [propStaff('R', 2.45, 'spear')], drape: { skirtBottom: 0.56, hemY: 1.08, belt: true, mantle: false, folds: 24, foldAmp: 0.014 },
    crown: true, beard: true,
  },
  nymph: {
    sex: 'f', garment: 'peplos', weight: 'L', seed: 512, hair: 'wavy', headScale: 1.07,
    hip: { roll: -0.045 }, head: { yaw: 0.1, pitch: 0.18 },
    armR: { wrist: [-0.12, 1.12, 0.3], pole: [-0.6, -0.5, -0.4], fingers: [0.05, 0.05, 1], dorsal: [0, -1, 0], curl: [0.2, 0.2, 0.15] },
    armL: { wrist: [0.25, 0.93, 0.05], pole: [0.5, 0, -1], fingers: [0.1, -1, 0.2], dorsal: [1, 0, 0], curl: [0.9, 1.0, 0.7] },
    extras: [propShell('R')], drape: { mantle: false, hemY: 0.95, mantleScale: 0.6, hemScallop: 1.7 },
  },
  priestess: {
    sex: 'f', garment: 'chiton', weight: 'L', seed: 518, hair: 'wavy', headScale: 1.07,
    hip: { roll: -0.04 }, head: { yaw: 0.05, pitch: 0.22 },
    armR: { wrist: [-0.03, 1.4, 0.15], pole: [-1, -0.6, 0], fingers: [1, 0.3, 0.1], dorsal: [0, 0, 1], curl: [0.2, 0.25, 0.2] },
    armL: { wrist: [0.25, 0.97, 0.06], pole: [0.5, 0, -1], fingers: [0.1, -1, 0.2], dorsal: [1, 0, 0], curl: [1.1, 1.2, 0.8] },
    extras: [propTorch('L')], drape: { himation: true, himTop: 1.28, himSlope: 0.6, himBottom: 0.55, folds: 30, mantle: true, mantleScale: 0.6 },
  },
};
export const STATUE_KINDS = Object.keys(SMALL_TYPES);

export function buildSmallStatue(kind, lod = 0, detail = 1) {
  const T = SMALL_TYPES[kind];
  const t0 = Date.now();
  const spec = { ...T };
  const hx = [];
  if (T.beard) hx.push(beardExtra({ seed: T.seed, length: 0.5 }));
  if (T.crown) hx.push(crownExtra({ spikes: 7, spikeLen: 0.16 }));
  if (hx.length) { spec.headExtras = hx; spec.headBoundsUp = 0.06; spec.headBoundsExtra = 0.04; }
  spec.beard = false;
  if (lod === 0) spec.handRegion = true;
  const ex = T.extras || [];
  spec.extras = (J) => ex.flatMap((f) => f(J));
  const fig = makeFigure(spec);
  const f = 1 / Math.sqrt(Math.max(0.05, detail));
  const cb = [0.015, 0.032][lod] * f, ch = [0.0065, 0.016][lod] * f;
  const body = meshRegion(fig.bodySdf, fig.bounds, cb, { smooth: lod === 0 ? 1 : 2 });
  const head = meshRegion(fig.headSdf, fig.headBounds, ch, { smooth: 1 });
  bakeAttributes(body, fig.sdf, fig.gold, { aoDist: 0.09, cavDist: 0.012 });
  bakeAttributes(head, fig.sdf, fig.gold, { aoDist: 0.06, cavDist: 0.008 });
  const parts = [body, head];
  for (const H of fig.hands || []) { const hg = meshRegion(H.sdf, H.bounds, ch * 1.1, { smooth: 1 }); bakeAttributes(hg, fig.sdf, fig.gold, { aoDist: 0.05, cavDist: 0.006 }); parts.push(hg); }
  const g = mergeGeos(parts);
  if (typeof console !== 'undefined') console.log(`[statues] small ${kind} lod${lod}: ${triCount(g)} tris in ${Date.now() - t0} ms`);
  return g;
}
