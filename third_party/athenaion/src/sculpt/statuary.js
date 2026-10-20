// Generic draped statues (life-size+, on pedestals) and pediment figures, built from makeFigure().
// All in nominal figure units (2.0 m tall, sole y=0, facing +Z). Each type is a pose + garment + props.
import * as THREE from 'three';
import { makeFigure } from './figure.js';
import { helmet } from './athena.js';
import { meshRegion, bakeAttributes, mergeGeos, triCount } from './bakeutil.js';
import { spearGeometry } from './props.js';
import { sd, add, sub, scale, norm, mv, mT, cross, len, smin, smax, clamp, sstep, vnoise3, hash1, cone, mix3, frameY } from './sdf.js';

// ------------------------------------------------------------------ hand-held props (SDF, figure space)
const gripOf = (J, side) => {
  const M = side === 'R' ? J.handR : J.handL, w = side === 'R' ? J.aR.wr : J.aL.wr;
  return { M, w, p: add(w, add(mv(M, 0, 0.078, 0), mv(M, 0, 0, -0.034))) };
};
const propScroll = (side) => (J) => {
  const g = gripOf(J, side);
  const ax = norm(mv(g.M, 1, 0, 0));
  const a = add(g.p, scale(ax, -0.11)), b = add(g.p, scale(ax, 0.11));
  return [{ sdf: (x, y, z) => { const d = sd.capsule(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], 0.03); return d - 0.002 * Math.sin(Math.atan2(y - g.p[1], x - g.p[0]) * 9); } }];
};
const propPhiale = (side) => (J) => {
  // shallow offering bowl resting on the palm
  const M = side === 'R' ? J.handR : J.handL, w = side === 'R' ? J.aR.wr : J.aL.wr;
  const c = add(w, add(mv(M, 0, 0.07, 0), mv(M, 0, 0, -0.045)));
  const n = norm(mv(M, 0, 0, -1)); // palm normal
  return [{
    sdf: (x, y, z) => {
      const px = x - c[0], py = y - c[1], pz = z - c[2];
      const h = px * n[0] + py * n[1] + pz * n[2];
      const r = Math.hypot(px - n[0] * h, py - n[1] * h, pz - n[2] * h);
      const outer = Math.hypot(r, h + 0.1) - 0.13;
      return Math.max(Math.max(outer, -(outer + 0.008)), -h - 0.0) ;
    },
    gold: (x, y, z) => (Math.hypot(x - c[0], y - c[1], z - c[2]) < 0.14 ? 0.8 : 0),
  }];
};
const propWreath = (side) => (J) => {
  const g = gripOf(J, side);
  const n = norm(mv(g.M, 0, 0, 1));
  const c = add(g.p, add(scale(n, 0.0), mv(g.M, 0, 0.1, 0)));
  const up = norm(mv(g.M, 0, 1, 0));
  return [{
    sdf: (x, y, z) => {
      const px = x - c[0], py = y - c[1], pz = z - c[2];
      const h = px * n[0] + py * n[1] + pz * n[2];
      const qx = px - n[0] * h, qy = py - n[1] * h, qz = pz - n[2] * h;
      const r = Math.hypot(qx, qy, qz);
      const a = Math.atan2(qx * up[0] + qy * up[1] + qz * up[2], r);
      return Math.hypot(r - 0.09, h) - 0.016 - 0.007 * Math.abs(Math.sin(a * 14));
    },
    gold: (x, y, z) => (Math.hypot(x - c[0], y - c[1], z - c[2]) < 0.13 ? 1 : 0),
  }];
};
const propTorch = (side) => (J) => {
  const g = gripOf(J, side);
  const a = add(g.p, [0, -0.25, 0]), b = add(g.p, [0, 0.2, 0.0]);
  return [{
    sdf: (x, y, z) => {
      let d = sd.roundCone(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], 0.018, 0.03);
      d = smin(d, sd.ellipsoid(x - b[0], y - b[1] - 0.06, z - b[2], 0.05, 0.08, 0.05) + 0.003 * Math.sin(y * 120), 0.02);
      return d;
    },
  }];
};
const propSeat = (h = 0.5) => () => [{ sdf: (x, y, z) => sd.roundBox(x, y - h * 0.5, z + 0.02, 0.24, h * 0.5, 0.22, 0.02) }];
/** crossed straps over the chest (peplos korai, ref 6) */
const propStraps = () => (J) => {
  const { C, neckBase } = J;
  const gc = [C[0], C[1] + 0.06, C[2]];
  return [{
    sdf: (x, y, z, dt) => {
      if (y < C[1] - 0.2 || y > neckBase[1] + 0.03 || z < C[2] - 0.02) return 1e9;
      let d = 1e9;
      for (const s of [-1, 1]) {
        const dist = Math.abs((x - gc[0]) * 0.72 + (y - gc[1]) * 0.69 * s);
        d = Math.min(d, smax(dist - 0.014, dt - 0.026, 0.008));
      }
      return d;
    },
    blend: 0.004,
  }];
};

// ------------------------------------------------------------------ statue types (pedestal statues)
export const STATUE_TYPES = [
  {
    id: 'athenaMini', sex: 'f', garment: 'peplos', weight: 'R', seed: 101, res: 1.2,
    hip: { roll: 0.05 }, head: { yaw: -0.25, pitch: 0.08 }, hair: 'wavy', helmet: { crest: 0.9, giltCrest: 0.0 },
    armR: { wrist: [-0.38, 1.47, 0.08], pole: [-0.5, -1, -0.45], fingers: [0.1, 0.05, 1], dorsal: [-1, 0, 0.1], curl: [1.25, 1.35, 0.9], thumbCurl: 0.9, spread: 0 },
    armL: { wrist: [0.27, 0.96, 0.06], pole: [0.5, 0, -1], fingers: [0.15, -1, 0.1], dorsal: [1, 0, 0], curl: [0.3, 0.35, 0.25] },
    spear: 'R', drape: { mantle: true },
  },
  {
    id: 'koreStraps', sex: 'f', garment: 'peplos', weight: 'L', seed: 107, res: 1.1,
    hip: { roll: -0.05 }, head: { yaw: 0.15, pitch: 0.12 }, hair: 'wavy',
    armR: { wrist: [-0.25, 0.97, 0.08], pole: [-0.5, 0, -1], fingers: [0.0, -1, 0.15], dorsal: [-1, 0, 0], curl: [0.9, 1.0, 0.7], thumbCurl: 0.6 },
    armL: { wrist: [0.02, 1.33, 0.2], pole: [1, -0.5, -0.2], fingers: [-1, 0.25, 0.2], dorsal: [0, 0, 1], curl: [1.1, 1.2, 0.8], thumbCurl: 0.8 },
    extras: [propStraps(), propScroll('L')], drape: { mantle: true, hemY: 0.98, folds: 22, foldAmp: 0.03, zigzag: true },
  },
  {
    id: 'koreOffering', sex: 'f', garment: 'peplos', weight: 'L', seed: 102,
    hip: { roll: -0.045 }, head: { yaw: 0.1, pitch: 0.18 }, hair: 'wavy',
    armR: { wrist: [-0.12, 1.12, 0.3], pole: [-0.6, -0.5, -0.4], fingers: [0.05, 0.05, 1], dorsal: [0, -1, 0], curl: [0.2, 0.2, 0.15] },
    armL: { wrist: [0.25, 0.93, 0.05], pole: [0.5, 0, -1], fingers: [0.1, -1, 0.2], dorsal: [1, 0, 0], curl: [0.9, 1.0, 0.7] },
    extras: [propPhiale('R')], drape: { mantle: false, hemY: 0.95 },
  },
  {
    id: 'femaleRaised', sex: 'f', garment: 'chiton', weight: 'R', seed: 103,
    hip: { roll: 0.06 }, head: { yaw: -0.15, pitch: -0.12 }, hair: 'wavy',
    armR: { wrist: [-0.27, 2.02, 0.16], pole: [-1, -0.3, -0.2], fingers: [0, 1, 0.3], dorsal: [0, 0, -1], curl: [0.15, 0.15, 0.1], spread: 0.1 },
    armL: { wrist: [0.23, 1.02, 0.12], pole: [0.5, 0, -1], fingers: [0, -1, 0.5], dorsal: [1, 0, 0], curl: [0.8, 0.9, 0.6] },
    extras: [propWreath('R')], drape: { himation: true, himTop: 1.2, himSlope: 0.8, himBottom: 0.4, folds: 32, belt: false },
  },
  {
    id: 'oratorScroll', sex: 'm', garment: 'himation', weight: 'R', seed: 104,
    hip: { roll: 0.05 }, head: { yaw: 0.2, pitch: 0.05 }, hair: 'curly', beard: true,
    armR: { wrist: [-0.02, 1.38, 0.17], pole: [-1, -0.5, 0], fingers: [1, 0.2, 0.2], dorsal: [0, 0, 1], curl: [0.6, 0.7, 0.5] },
    armL: { wrist: [0.27, 0.98, 0.1], pole: [0.5, 0, -1], fingers: [0.1, -0.2, 1], dorsal: [1, 0, 0], curl: [1.2, 1.3, 0.9], thumbCurl: 0.8 },
    extras: [propScroll('L')], drape: { himTop: 1.32, himSlope: 0.5, himBottom: 0.3, fallBottom: 0.4 },
  },
  {
    id: 'warrior', sex: 'm', garment: 'chiton', weight: 'L', seed: 105,
    hip: { roll: -0.06 }, head: { yaw: 0.3, pitch: 0.1 }, hair: 'curly', helmet: { crest: 1.0, giltCrest: 0.0 },
    armR: { wrist: [-0.27, 0.98, 0.05], pole: [-0.5, 0, -1], fingers: [-0.1, -1, 0.1], dorsal: [-1, 0, 0], curl: [0.6, 0.7, 0.5] },
    armL: { wrist: [0.38, 1.45, 0.1], pole: [0.5, -1, -0.45], fingers: [-0.1, 0.05, 1], dorsal: [1, 0, 0.1], curl: [1.25, 1.35, 0.9], thumbCurl: 0.9, spread: 0 },
    spear: 'L', drape: { skirtBottom: 0.56, hemY: 1.08, belt: true, mantle: false, folds: 24, foldAmp: 0.014 },
  },
  {
    id: 'priestess', sex: 'f', garment: 'chiton', weight: 'L', seed: 106, res: 1.15,
    hip: { roll: -0.04 }, head: { yaw: 0.05, pitch: 0.22 }, hair: 'wavy',
    armR: { wrist: [-0.03, 1.4, 0.15], pole: [-1, -0.6, 0], fingers: [1, 0.3, 0.1], dorsal: [0, 0, 1], curl: [0.2, 0.25, 0.2] },
    armL: { wrist: [0.25, 0.97, 0.06], pole: [0.5, 0, -1], fingers: [0.1, -1, 0.2], dorsal: [1, 0, 0], curl: [1.1, 1.2, 0.8] },
    extras: [propTorch('L')], drape: { himation: true, himTop: 1.28, himSlope: 0.6, himBottom: 0.55, folds: 30, mantle: true },
  },
];

// ------------------------------------------------------------------ pediment poses (kneeling, seated, reclining, striding)
const propRoundShield = (side, r = 0.2) => (J) => {
  const w = side === 'L' ? J.aL.wr : J.aR.wr, el = side === 'L' ? J.aL.el : J.aR.el;
  const fa = norm(sub(w, el));
  const out = side === 'L' ? [1, 0, 0.35] : [-1, 0, 0.35];
  let n = norm(add(out, scale(fa, -0.2)));
  const c = add(add(mix3(el, w, 0.55), scale(n, 0.05)), [0, 0, 0.05]);
  return [{
    sdf: (x, y, z) => {
      const px = x - c[0], py = y - c[1], pz = z - c[2];
      const h = px * n[0] + py * n[1] + pz * n[2];
      const rr = Math.hypot(px - n[0] * h, py - n[1] * h, pz - n[2] * h);
      const dome = 0.03 * (1 - Math.min(1, (rr / r) ** 2));
      const dd = Math.hypot(Math.max(rr - r, 0), Math.max(Math.abs(h - dome * 0.5) - 0.012 - dome * 0.5, 0)) + Math.min(Math.max(rr - r, Math.abs(h - dome * 0.5) - 0.012 - dome * 0.5), 0);
      return Math.min(dd, Math.hypot(rr - r * 0.96, h - 0.012) - 0.012);
    },
  }];
};
const propStaff = (side, len = 1.6) => (J) => {
  const g = gripOf(J, side);
  const ax = norm(mv(g.M, 1, 0, 0));
  const a = add(g.p, scale(ax, -len * 0.55)), b = add(g.p, scale(ax, len * 0.45));
  return [{ sdf: (x, y, z) => sd.capsule(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], 0.016) }];
};

export const PED_TYPES = [
  {
    id: 'pedKneel', sex: 'm', garment: 'chiton', weight: 'R', seed: 201, kneel: 0.75, hair: 'curly', helmet: { crest: 0.8, giltCrest: 0 },
    hip: { roll: 0.02 }, chest: { yaw: 0.25, pitch: 0.08 }, head: { yaw: -0.35, pitch: -0.12 },
    weightAnkle: [-0.1, 0.06, -0.44], freeAnkle: [0.12, 0.08, 0.32],
    armR: { wrist: [-0.18, 1.12, 0.42], pole: [-1, -0.6, -0.2], fingers: [0, 0.2, 1], dorsal: [-1, 0, 0], curl: [1.2, 1.3, 0.9], thumbCurl: 0.9, spread: 0 },
    armL: { wrist: [0.32, 1.12, 0.18], pole: [1, -0.6, -0.5], fingers: [0, 1, 0.2], dorsal: [1, 0, 0], curl: [1.1, 1.2, 0.8] },
    extras: [propRoundShield('L', 0.21)], drape: { skirtBottom: 0.3, hemY: 0.82, belt: true, mantle: false, folds: 22, foldAmp: 0.012, legPush: -0.01 },
    height: 1.35, width: 0.7,
  },
  {
    id: 'pedSeated', sex: 'f', garment: 'lap', weight: 'R', seed: 202, hair: 'wavy',
    hip: { y: 0.6, roll: 0.0 }, chest: { yaw: -0.15 }, head: { yaw: 0.3, pitch: 0.1 },
    weightAnkle: [-0.11, 0.08, 0.4], freeAnkle: [0.13, 0.08, 0.33],
    armR: { wrist: [-0.14, 0.72, 0.36], pole: [-1, 0, -0.2], fingers: [0.1, -0.3, 1], dorsal: [0, 1, 0], curl: [0.3, 0.3, 0.2] },
    armL: { wrist: [0.26, 1.28, 0.12], pole: [1, -0.8, -0.3], fingers: [-0.1, 0.05, 1], dorsal: [1, 0, 0.1], curl: [1.25, 1.35, 0.9], thumbCurl: 0.9, spread: 0 },
    extras: [propSeat(0.47), propStaff('L', 1.5)], drape: { curtain: true, bodice: true, lapTop: 0.2 },
    height: 1.5, width: 0.64,
  },
  {
    id: 'pedRecline', sex: 'm', garment: 'lap', weight: 'R', seed: 203, hair: 'curly', beard: true,
    hip: { y: 0.22, pitch: -0.42, roll: 0.12 }, chest: { yaw: -0.75, roll: 0.05, pitch: 0.1 }, head: { yaw: -0.2, pitch: 0.35 },
    weightAnkle: [-0.06, 0.07, 0.92], freeAnkle: [0.15, 0.08, 0.66],
    armL: { wrist: [0.32, 0.08, -0.22], pole: [1, 0.3, -0.5], fingers: [0.2, -0.2, -1], dorsal: [0, 1, 0], curl: [0.2, 0.2, 0.1] },
    armR: { wrist: [-0.1, 0.62, 0.42], pole: [-1, -0.3, 0], fingers: [0, -0.5, 1], dorsal: [0, 1, 0], curl: [0.5, 0.5, 0.3] },
    drape: { curtain: false, lapTop: 0.08 },
    height: 0.95, width: 1.25, recline: true,
  },
  {
    id: 'pedStride', sex: 'm', garment: 'chiton', weight: 'L', seed: 204, hair: 'curly', helmet: { crest: 1.0, giltCrest: 0 },
    hip: { y: 0.94, roll: -0.04 }, chest: { yaw: 0.35, pitch: 0.12 }, head: { yaw: -0.3, pitch: 0.05 },
    weightAnkle: [0.13, 0.1, -0.38], freeAnkle: [-0.14, 0.08, 0.36],
    armR: { wrist: [-0.26, 1.7, 0.2], pole: [-1, -0.3, -0.4], fingers: [0, 0.3, 1], dorsal: [-1, 0, 0], curl: [1.2, 1.3, 0.9], thumbCurl: 0.9, spread: 0 },
    armL: { wrist: [0.34, 1.2, 0.2], pole: [1, -0.6, -0.5], fingers: [0, 1, 0.2], dorsal: [1, 0, 0], curl: [1.1, 1.2, 0.8] },
    extras: [propRoundShield('L', 0.22)], drape: { skirtBottom: 0.58, hemY: 1.05, belt: true, mantle: false, folds: 22, foldAmp: 0.012, legPush: -0.01 },
    height: 1.9, width: 0.78,
  },
];

function figureSpec(T, lod = 1) {
  const spec = { ...T };
  // (r6) slimmer mantle pulled behind the back (no side planks), scalloped overfold hems
  spec.drape = { mantleScale: 0.6, mantleBack: 0.05, mantleSideL: true, hemScallop: 1.7, fine: 0.28, ...(T.drape || {}) };
  // (r6) LOD0: hands meshed separately at the head resolution (fingers read at 20-40 m), marble bracelets
  if (lod === 0) { spec.handRegion = true; spec.braceletGold = 0; }
  spec.headScale = T.headScale ?? (T.sex === 'f' ? 1.07 : 1.04);
  if (T.helmet) { spec.headExtras = [helmet({ gilt: 0, giltCrest: 0, holes: false, band: true, ...T.helmet })]; spec.headBoundsUp = 0.1; spec.helmeted = true; }
  const ex = T.extras || [];
  if (ex.length) spec.extras = (J) => ex.flatMap((f) => f(J));
  return spec;
}

/** build a statue type as merged geometry (figure + optional spear). lod: 0 high (~20k tris), 1 low */
export function buildStatueGeometry(type, lod = 0, detail = 1) {
  const all = STATUE_TYPES.concat(PED_TYPES);
  const T = typeof type === 'number' ? STATUE_TYPES[type] : all.find((t) => t.id === type);
  const t0 = Date.now();
  const fig = makeFigure(figureSpec(T, lod));
  const f = 1 / Math.sqrt(Math.max(0.05, detail));
  const rf = T.res || 1;
  const cb = [0.015, 0.036, 0.08][lod] * f * rf, ch = [0.0056, 0.016, 0.05][lod] * f * rf; // (r6) finer faces
  const body = meshRegion(fig.bodySdf, fig.bounds, cb, { smooth: lod === 0 ? 1 : 2 });
  const head = meshRegion(fig.headSdf, fig.headBounds, ch, { smooth: 1 });
  let spearInfo = null;
  if (T.spear) {
    const g = gripOf(fig.joints, T.spear);
    spearInfo = { base: [g.p[0], 0, g.p[2]], top: [g.p[0], 2.35, g.p[2]], r: 0.015 };
  }
  const full = spearInfo
    ? (x, y, z) => Math.min(fig.sdf(x, y, z), sd.capsule(x, y, z, spearInfo.base[0], 0, spearInfo.base[2], spearInfo.top[0], spearInfo.top[1], spearInfo.top[2], spearInfo.r))
    : fig.sdf;
  bakeAttributes(body, full, fig.gold, { aoDist: 0.09, cavDist: 0.012 });
  bakeAttributes(head, full, fig.gold, { aoDist: 0.06, cavDist: 0.008 });
  const parts = [body, head];
  for (const H of fig.hands || []) {
    const hg = meshRegion(H.sdf, H.bounds, ch * 1.1, { smooth: 1 });
    bakeAttributes(hg, full, fig.gold, { aoDist: 0.05, cavDist: 0.006 });
    parts.push(hg);
  }
  if (spearInfo) {
    const sp = spearGeometry({ length: 2.35, r: spearInfo.r, seg: [10, 6, 4][lod] });
    sp.translate(spearInfo.base[0], 0, spearInfo.base[2]);
    parts.push(sp);
  }
  const g = mergeGeos(parts);
  console.log(`[statues] statue ${T.id} lod${lod}: ${triCount(g)} tris in ${Date.now() - t0} ms`);
  return g;
}
