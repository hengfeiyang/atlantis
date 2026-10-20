// Parametric draped classical figure as an SDF (CPU). Units: metres for a NOMINAL 2.0 m figure
// (sole y=0, crown y≈2.0, facing +Z, the figure's RIGHT side is -X). Scale at placement time.
//
//   const fig = makeFigure(spec);   fig.sdf(x,y,z), fig.headSdf (fine region), fig.bodySdf,
//   fig.gold(x,y,z) → 0..1 gilded mask, fig.bounds, fig.headBounds, fig.joints
//
// spec: {
//   sex:'f'|'m', seed, garment:'peplos'|'chiton'|'himation'|'chlamys'|'nude',
//   weight:'R'|'L' (supporting leg), hip:{roll, yaw, shift:[x,z]}, chest:{roll,yaw,pitch},
//   head:{yaw,pitch,roll}, hair:'wavy'|'curly'|'none',
//   armR/armL:{ wrist:[x,y,z], pole:[x,y,z], fingers:[x,y,z], dorsal:[x,y,z], curl:[a,b,c], spread },
//   freeAnkle:[x,y,z], weightAnkle:[x,y,z], kneel, seat, ...
//   extras: [{ sdf, gold? }] additional SDF parts in figure space (helmet, shield arm, props)
// }
import {
  sd, clamp, lerp, sstep, smin, smax, Group, ellipsoidR, capsule, cone, mmul, mT, mv, rotX, rotY, rotZ, euler,
  frameY, add, sub, scale, dot, cross, len, norm, mix3, hash1, vnoise3, fbm3, ellipse2,
} from './sdf.js';
import { classicalHead } from './face.js';

const TAU = Math.PI * 2;
export const HEAD_H = 0.255; // head height (chin→crown) of the 2.0 m figure

// ------------------------------------------------------------------ helpers
const ell = (c, rx, ry, rz, k, m = null) => ({
  f: m ? (x, y, z) => ellipsoidR(x, y, z, c, m, rx, ry, rz) : (x, y, z) => sd.ellipsoid(x - c[0], y - c[1], z - c[2], rx, ry, rz),
  c, r: Math.max(rx, ry, rz), k,
});
const cap = (a, b, ra, rb, k) => ({ f: (x, y, z) => cone(x, y, z, a, b, ra, rb), c: mix3(a, b, 0.5), r: len(sub(b, a)) * 0.5 + Math.max(ra, rb), k });

/** two-bone IK: root a, target c, lengths l1, l2, pole direction → middle joint (target is clamped to reach) */
export function ik2(a, c, l1, l2, pole) {
  const d = sub(c, a);
  let L = len(d);
  const dir = norm(d);
  L = Math.min(L, (l1 + l2) * 0.999);
  L = Math.max(L, Math.abs(l1 - l2) + 1e-3);
  const cosA = (l1 * l1 + L * L - l2 * l2) / (2 * l1 * L);
  const h = l1 * Math.sqrt(Math.max(0, 1 - cosA * cosA));
  let p = sub(pole, scale(dir, dot(pole, dir)));
  p = norm(p);
  const b = add(add(a, scale(dir, l1 * cosA)), scale(p, h));
  const cc = add(a, scale(dir, L));
  return { mid: b, end: cc };
}

/** local→world rotation from fingers (Y) and dorsal (Z) directions */
function handFrame(fingers, dorsal) {
  const Y = norm(fingers);
  let Z = sub(dorsal, scale(Y, dot(dorsal, Y)));
  Z = norm(Z);
  const X = cross(Y, Z);
  return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]]; // columns X,Y,Z
}

/** hand SDF in hand-local space (origin at wrist, +Y fingers, +Z back of hand), thumbSide ±1 along X */
function makeHand(o, thumbSide, fem) {
  const s = (fem ? 0.93 : 1.0) * (o.handScale || 1);
  const curl = o.curl || [0.25, 0.3, 0.2];
  const spread = o.spread ?? 0.06;
  const segs = []; // capsule chains
  const fingerX = [-0.031, -0.0105, 0.0105, 0.03].map((v) => v * thumbSide * -1); // index finger nearest the thumb
  const lens = [[0.046, 0.029, 0.022], [0.05, 0.032, 0.024], [0.047, 0.03, 0.022], [0.037, 0.023, 0.019]];
  const rads = [0.0098, 0.0102, 0.0096, 0.0085];
  for (let f = 0; f < 4; f++) {
    // finger order: index (near thumb) … little
    const fx = fingerX[f] * s;
    let p = [fx, (0.093 - f * 0.0 - (f === 3 ? 0.008 : 0) - (f === 0 ? 0.003 : 0)) * s, 0.0];
    const splay = (f - 1.5) * spread * -thumbSide * -1;
    let ang = 0; // curl angle accumulated (about local X, toward palm = -Z)
    const cf = (o.curlEach && o.curlEach[f]) || curl;
    const chain = [p];
    for (let j = 0; j < 3; j++) {
      ang += cf[j];
      const L = lens[f][j] * s;
      const dir = [Math.sin(splay) * Math.cos(ang), Math.cos(splay) * Math.cos(ang), -Math.sin(ang)];
      p = add(p, scale(dir, L));
      chain.push(p);
    }
    segs.push({ pts: chain, r: rads[f] * s });
  }
  // thumb: from the base of the palm, toward the index finger, curling across the palm
  const tc = o.thumbCurl ?? 0.5;
  const tdir0 = norm([thumbSide * 0.55, 0.75, -0.35 - tc * 0.3]);
  const t0 = [thumbSide * 0.026 * s, 0.022 * s, -0.008];
  const t1 = add(t0, scale(tdir0, 0.042 * s));
  const tdir1 = norm([thumbSide * (0.3 - tc * 0.5), 0.8, -0.3 - tc * 0.6]);
  const t2 = add(t1, scale(tdir1, 0.033 * s));
  const tdir2 = norm([thumbSide * (0.1 - tc * 0.6), 0.7, -0.2 - tc * 0.7]);
  const t3 = add(t2, scale(tdir2, 0.027 * s));
  segs.push({ pts: [t0, t1, t2, t3], r: 0.0115 * s, thumb: true });
  return (x, y, z) => {
    // palm: rounded box, slightly cupped
    let d = sd.roundBox(x, y - 0.052 * s, z, 0.04 * s, 0.05 * s, 0.0135 * s, 0.012 * s);
    // thenar pad
    d = smin(d, sd.ellipsoid(x - thumbSide * 0.022 * s, y - 0.035 * s, z + 0.006, 0.024 * s, 0.035 * s, 0.016 * s), 0.01);
    for (const sg of segs) {
      const P = sg.pts;
      for (let i = 0; i < P.length - 1; i++) {
        const ra = sg.r * (1 - i * 0.09), rb = sg.r * (1 - (i + 1) * 0.09);
        d = smin(d, cone(x, y, z, P[i], P[i + 1], ra, rb), i === 0 ? 0.012 : 0.004);
      }
    }
    return d;
  };
}

/** evaluate a Group only when its bounding sphere is closer than lim (else return the bound) */
export function evalB(g, x, y, z, lim) { const b = g.bound(x, y, z); return b > lim ? b : g.eval(x, y, z); }

// ------------------------------------------------------------------ fold field
/** per (n, seed) fold layout: irregular widths, amplitudes, skew, forking */
const foldCache = new Map();
function foldCells(n, seed) {
  const key = n + '|' + seed;
  let F = foldCache.get(key);
  if (F) return F;
  const w = [], a = [], sk = [], split = [];
  let tot = 0;
  for (let i = 0; i < n; i++) {
    const r = hash1(i * 3.7 + seed * 11.1);
    const wi = 0.5 + 1.15 * r * r + 0.3 * hash1(i * 9.1 + seed * 0.37);
    w.push(wi); tot += wi;
  }
  const avg = tot / n;
  for (let i = 0; i < n; i++) {
    a.push((0.3 + 0.7 * hash1(i * 5.3 + seed * 2.1)) * (0.65 + 0.35 * Math.min(1.6, w[i] / avg)));
    sk.push((hash1(i * 1.3 + seed) - 0.5) * 0.6);
    split.push(hash1(i * 5.1 + seed * 2.9));
  }
  const b = [0];
  for (let i = 0; i < n; i++) b.push(b[i] + (w[i] / tot) * TAU);
  F = { n, b, a, sk, split, wr: w.map((x) => x / avg) };
  foldCache.set(key, F);
  return F;
}
/** irregular "tube" folds around an axis: returns displacement 0..1 (ridge = 1, crevice = 0) */
export function foldTubes(theta, y, n, seed, sway = 1) {
  const F = foldCells(n, seed);
  const tw = theta + sway * (0.1 * Math.sin(2 * theta + y * 1.9 + seed) + 0.065 * Math.sin(3 * theta - y * 2.6 + seed * 1.7)
    + 0.04 * Math.sin(5 * theta + y * 3.7 + seed * 2.3) + 0.025 * Math.sin(7 * theta - y * 4.3 + seed * 0.7));
  const t = (((tw + Math.PI) % TAU) + TAU) % TAU;
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (F.b[m] <= t) lo = m; else hi = m; }
  const u = ((t - F.b[lo]) / (F.b[lo + 1] - F.b[lo])) * 2 - 1;
  const sk = F.sk[lo];
  const uu = u - sk * (1 - u * u);
  let v = Math.pow(Math.max(0, 1 - uu * uu), 0.7);
  // wide folds fork into two tubes lower down (a groove opens along the centre)
  const sp = F.split[lo];
  if (sp > 0.5 && F.wr[lo] > 0.9) {
    const ys = 0.25 + 0.7 * sp;
    v *= 1 - 0.6 * sstep(ys, ys - 0.3, y) * Math.exp(-uu * uu * 16);
  }
  return F.a[lo] * v;
}

// ------------------------------------------------------------------ the figure
export function makeFigure(spec = {}) {
  const fem = (spec.sex || 'f') === 'f';
  const seed = spec.seed ?? 1;
  const sx = (fem ? 1 : 1.1) * (spec.strong ? 1.06 : 1); // shoulder width factor
  const hipW = fem ? 1 : 0.88;
  const garment = spec.garment || (fem ? 'peplos' : 'himation');
  const kneel = spec.kneel || 0; // 0 standing … 1 kneeling (pelvis lowered)

  // ---------- skeleton
  const hip = spec.hip || {};
  const hipRoll = hip.roll ?? (spec.weight === 'L' ? -0.05 : 0.05);
  const hipYaw = hip.yaw ?? 0;
  const pelvisY = (hip.y ?? 1.02) - kneel * 0.45;
  const P = [hip.shift?.[0] ?? (spec.weight === 'L' ? 0.025 : -0.025), pelvisY, hip.shift?.[1] ?? 0];
  const Rp = mmul(rotY(hipYaw), mmul(rotX(hip.pitch ?? 0), rotZ(hipRoll)));
  const ch = spec.chest || {};
  const Rc = mmul(rotY(hipYaw + (ch.yaw ?? 0)), mmul(rotX(ch.pitch ?? 0), rotZ(ch.roll ?? -hipRoll * 0.8)));
  const C = add(P, mv(Rp, 0, 0.41, -0.005));
  const pP = (x, y, z) => add(P, mv(Rp, x, y, z));
  const pC = (x, y, z) => add(C, mv(Rc, x, y, z));

  const neckBase = pC(0, 0.205, -0.03);
  const hd = spec.head || {};
  const Rh = mmul(Rc, euler(hd.yaw ?? 0, hd.pitch ?? 0, hd.roll ?? 0));
  const hsc = spec.headScale || 1;
  const HS = HEAD_H * hsc; // head units → metres
  const headC = add(neckBase, add(mv(Rc, 0, 0.165 * hsc, 0.025 * hsc), mv(Rh, 0, 0, 0))); // skull centre
  const RhT = mT(Rh);

  const shR = pC(-0.178 * sx, 0.195, -0.012), shL = pC(0.178 * sx, 0.195, -0.012);
  const hipR = pP(-0.088 * hipW, -0.035, 0.0), hipL = pP(0.088 * hipW, -0.035, 0.0);
  const UA = 0.34, FA = 0.28, TH = 0.475, SH = 0.455;
  const strong = spec.strong ? 1.08 : 1; // thicker, more muscular arms (colossi)

  const armJ = (sh, a, side) => {
    const wristT = a.wrist || [side * 0.25, 0.98, 0.04];
    const pole = a.pole || [side * 0.3, -0.2, -1];
    const { mid, end } = ik2(sh, wristT, UA, FA, pole);
    return { sh, el: mid, wr: end };
  };
  const aR = armJ(shR, spec.armR || {}, -1), aL = armJ(shL, spec.armL || {}, 1);

  const weightIsR = spec.weight !== 'L';
  const legJ = (hp, ankleT, side, free) => {
    const pole = [side * 0.12, 0.0, 1];
    const { mid, end } = ik2(hp, ankleT, TH, SH, pole);
    return { hp, kn: mid, an: end, free };
  };
  const wAnk = spec.weightAnkle || [(weightIsR ? -1 : 1) * 0.1, 0.045, -0.01];
  const fAnk = spec.freeAnkle || [(weightIsR ? 1 : -1) * 0.14, 0.11, -0.1];
  const lR = legJ(hipR, weightIsR ? wAnk : fAnk, -1, !weightIsR);
  const lL = legJ(hipL, weightIsR ? fAnk : wAnk, 1, weightIsR);

  // ---------- trunk (torso + pelvis) group
  const trunk = new Group([], 0.07);
  trunk.add(ell(pP(0, 0.0, -0.01), (0.172 + (spec.hipWide ?? 0)) * hipW, 0.13, 0.118, 0.08, mT(Rp)));            // pelvis / hips
  for (const s of [-1, 1]) trunk.add(ell(pP(0.072 * s * hipW, -0.045, -0.055), 0.092 * hipW, 0.1, 0.085, 0.06)); // glutes
  trunk.add(ell(pP(0, 0.15, 0.022), 0.13 * (fem ? 1 : 1.05), 0.14, 0.098, 0.08));        // belly
  trunk.add(ell(pC(0, -0.13, -0.008), 0.122 * sx, 0.1, 0.088, 0.09));                  // waist
  trunk.add(ell(pC(0, 0.0, -0.012), 0.148 * sx, 0.168, 0.108, 0.07, mT(Rc)));          // ribcage
  // (r6) shoulder girdle as two tilted halves: the shoulders slope down from the neck (no flat shelf)
  for (const s of [-1, 1]) trunk.add(ell(pC(0.085 * s * sx, 0.128, -0.018), 0.112 * sx, 0.07, 0.09, 0.07, mT(mmul(Rc, rotZ(-0.26 * s)))));
  for (const s of [-1, 1]) {
    trunk.add(cap(pC(0.03 * s, 0.17, 0.045), pC(0.16 * s * sx, 0.192, 0.0), 0.022, 0.03, 0.04)); // clavicle
    trunk.add(cap(pC(0.06 * s, 0.215, -0.045), add(neckBase, [0.0, 0.05, 0.0]), 0.05, 0.045, 0.06)); // trapezius
    if (fem) trunk.add(ell(pC(0.079 * s, 0.0, 0.089), 0.07, 0.066, 0.06, 0.036, mT(mmul(Rc, rotY(0.25 * s)))));   // breast
    else trunk.add(ell(pC(0.072 * s, 0.06, 0.07), 0.085, 0.062, 0.042, 0.05, mT(Rc)));                             // pectoral
  }
  if (!fem) {
    trunk.add(ell(pC(0, -0.16, 0.068), 0.085, 0.13, 0.04, 0.06)); // rectus abdominis
    for (const s of [-1, 1]) trunk.add(ell(pP(0.11 * s, 0.1, 0.03), 0.05, 0.08, 0.06, 0.06)); // obliques
  }
  // neck stub inside the head region (the head mesh supplies the visible neck)
  const neckStub = cap(neckBase, add(neckBase, mv(Rh, 0, 0.07, 0.01)), 0.044, 0.04, 0.05);

  // ---------- arms
  const handR = makeHand(spec.armR || {}, -1, fem);
  const handL = makeHand(spec.armL || {}, 1, fem);
  const sepHands = !!spec.handRegion;
  const longSkirt = ['peplos', 'chiton', 'himation'].includes(garment) && (spec.drape?.skirtBottom ?? 0) < 0.1;
  const armGroup = (a, side, handFn, ao) => {
    const g = new Group([], 0.035);
    const fwdA = norm(sub(a.wr, a.el));
    const k = strong;
    const rW = (fem ? 0.0245 : 0.027) * k;
    const rU = (fem ? 0.053 : 0.059) * k, rE = (fem ? 0.04 : 0.045) * k;
    const upDir = norm(sub(a.el, a.sh));
    const dk = k * (fem && !spec.strong ? 0.86 : 1);
    g.add(ell(add(a.sh, [side * 0.024 * dk, -0.04, 0.004]), 0.068 * dk, 0.085 * dk, 0.07 * dk, 0.05, mT(frameY(add(upDir, [0, -1.5, 0])))));  // deltoid
    g.add(cap(a.sh, a.el, rU, rE, 0.04));                                                                  // upper arm
    // biceps (front) and triceps (back) bellies
    const fr = frameY(upDir, [0, 0, 1]);
    g.add(ell(add(mix3(a.sh, a.el, 0.55), mv(fr, 0, 0, 0.012 * k)), 0.044 * k, 0.1, 0.045 * k, 0.035, mT(fr)));
    g.add(ell(add(mix3(a.sh, a.el, 0.42), mv(fr, 0, 0, -0.016 * k)), 0.042 * k, 0.1, 0.04 * k, 0.035, mT(fr)));
    const fingers = ao.fingers || fwdA;
    const dorsal = ao.dorsal || [side * 1, 0, 0];
    const M = handFrame(fingers, dorsal);
    const MT = mT(M);
    const w = a.wr;
    const handPart = { f: (x, y, z) => { const l = mv(MT, x - w[0], y - w[1], z - w[2]); return handFn(l[0], l[1], l[2]); }, c: add(w, mv(M, 0, 0.09, 0)), r: 0.13, k: 0.02 };
    if (!sepHands) {
      g.add(cap(a.el, a.wr, rE * 0.95, rW, 0.03));                                                          // forearm
      g.add(ell(mix3(a.el, a.wr, 0.27), (fem ? 0.041 : 0.047) * k, 0.09, (fem ? 0.036 : 0.041) * k, 0.03, mT(frameY(fwdA)))); // forearm belly
      g.add(ell(sub(a.el, scale(fwdA, 0.01)), 0.028 * k, 0.03, 0.028 * k, 0.025));                         // elbow
      g.add(handPart);
      return { g, M, wr: w };
    }
    // separate fine hand mesh: the body forearm stops just short of the wrist (inside a snake bracelet),
    // the hand region carries a slightly thinner wrist stub → no coplanar overlap, the bracelet hides the seam
    const s1 = sub(w, scale(fwdA, 0.03));
    const LA = len(sub(a.wr, a.el));
    const rAt = (t) => lerp(rE * 0.95, rW, t);
    const r1 = rAt(1 - 0.03 / LA) + 0.001;
    g.add(cap(a.el, s1, rE * 0.95, r1, 0.03));
    g.add(ell(mix3(a.el, a.wr, 0.27), (fem ? 0.041 : 0.047) * k, 0.09, (fem ? 0.036 : 0.041) * k, 0.03, mT(frameY(fwdA))));
    g.add(ell(sub(a.el, scale(fwdA, 0.01)), 0.028 * k, 0.03, 0.028 * k, 0.025));
    const bc = add(s1, scale(fwdA, 0.006)), bR = r1 + 0.004;
    const bracelet = (x, y, z) => {
      const qx = x - bc[0], qy = y - bc[1], qz = z - bc[2];
      const h = qx * fwdA[0] + qy * fwdA[1] + qz * fwdA[2];
      const rr = Math.hypot(qx - fwdA[0] * h, qy - fwdA[1] * h, qz - fwdA[2] * h);
      // two coils of a snake
      return Math.min(Math.hypot(rr - bR, h - 0.0055) - 0.0058, Math.hypot(rr - bR, h + 0.0055) - 0.0058);
    };
    const hg = new Group([], 0.02);
    hg.add(handPart);
    const s0 = sub(w, scale(fwdA, 0.045));
    hg.add(cap(s0, w, rAt(1 - 0.045 / LA) - 0.0015, rW - 0.001, 0.02));
    const hb = { c: add(w, mv(M, 0, 0.08, 0)), r: 0.17 };
    return { g, M, wr: w, hg, bracelet, bc, hb };
  };
  const armRg = armGroup(aR, -1, handR, spec.armR || {});
  const armLg = armGroup(aL, 1, handL, spec.armL || {});

  // ---------- legs
  const legGroup = (l, side) => {
    const g = new Group([], 0.05);
    g.add(cap(l.hp, l.kn, fem ? 0.098 : 0.09, 0.056, 0.06));
    g.add(ell(mix3(l.hp, l.kn, 0.4), 0.075, 0.17, 0.08, 0.06, mT(frameY(sub(l.kn, l.hp)))));
    g.add(cap(l.kn, l.an, 0.052, 0.03, 0.04));
    g.add(ell(add(mix3(l.kn, l.an, 0.3), [0, 0, -0.025]), 0.045, 0.1, 0.045, 0.04, mT(frameY(sub(l.an, l.kn)))));
    // foot (sandal) — points forward (+Z) and slightly outward
    const out = side * 0.18 + (l.free ? side * 0.12 : 0);
    const fdir = [Math.sin(out), 0, Math.cos(out)];
    const heel = [l.an[0] - fdir[0] * 0.035, Math.max(0.035, l.an[1] - 0.05), l.an[2] - fdir[2] * 0.035];
    const toeY = 0.022;
    const ball = [l.an[0] + fdir[0] * 0.15, toeY + 0.004, l.an[2] + fdir[2] * 0.15];
    g.add(cap(heel, ball, 0.036, 0.03, 0.03));
    g.add(cap(l.an, mix3(heel, ball, 0.55), 0.034, 0.03, 0.03));
    for (let t = 0; t < 5; t++) { // toes
      const lat = (t - 1.6) * 0.017 * -side;
      const tl = 0.045 - Math.abs(t - 0.6) * 0.006;
      const base = [ball[0] + fdir[2] * lat, toeY, ball[2] - fdir[0] * lat];
      g.add(cap(base, add(base, scale(fdir, tl)), 0.011 - t * 0.0008, 0.0085 - t * 0.0006, 0.008));
    }
    // sandal sole
    const sc = mix3(heel, ball, 0.5);
    const yaw = Math.atan2(fdir[0], fdir[2]);
    const Ry = mT(rotY(yaw));
    g.add({ f: (x, y, z) => { const l2 = mv(Ry, x - sc[0], y - 0.008, z - sc[2]); return sd.roundBox(l2[0], l2[1], l2[2] - 0.035, 0.05, 0.008, 0.15, 0.006); }, c: [sc[0], 0.01, sc[2]], r: 0.2, k: 0.004 });
    return { g, fdir, heel, ball };
  };
  const legR = legGroup(lR, -1), legL = legGroup(lL, 1);
  const freeLeg = weightIsR ? lL : lR;
  const freeLegG = weightIsR ? legL : legR;

  // ---------- head (fine region)
  const head = classicalHead({ sex: spec.sex || 'f', hair: spec.hair, seed, beard: spec.beard, helmeted: spec.helmeted });
  const headLocal = (x, y, z) => { const dx = x - headC[0], dy = y - headC[1], dz = z - headC[2]; return mv(RhT, dx, dy, dz); };
  const headExtras = spec.headExtras || []; // functions in head units (helmet…)
  const hR = 0.3 * (spec.headScale || 1) + (spec.headBoundsUp || 0) + (spec.headBoundsExtra || 0);
  const nA = add(neckBase, [0, -0.06, 0.01]), nB = add(neckBase, mv(Rh, 0, 0.1, 0.015));
  const headSdf = (x, y, z) => {
    const cut = (neckBase[1] - 0.07) - y;
    const dn = cone(x, y, z, nA, nB, 0.054, 0.05);
    const rr = Math.hypot(x - headC[0], y - headC[1], z - headC[2]);
    if (rr > hR + 0.05) return Math.max(Math.min(dn, rr - hR), cut);
    const l = headLocal(x, y, z);
    const hx = l[0] / HS, hy = l[1] / HS, hz = l[2] / HS;
    let d = head.sdf(hx, hy, hz);
    for (const e of headExtras) d = Math.min(d, e.sdf(hx, hy, hz));
    d *= HS;
    // neck continues down to the collar (hidden below inside the body)
    d = smin(d, dn, 0.03);
    // cut the region: below the collar the body takes over
    d = Math.max(d, cut);
    return d;
  };
  const headGold = (x, y, z) => {
    if (!headExtras.length) return 0;
    const l = headLocal(x, y, z);
    let g = 0;
    for (const e of headExtras) if (e.gold) g = Math.max(g, e.gold(l[0] / HS, l[1] / HS, l[2] / HS));
    return g;
  };

  // long locks of hair falling on the shoulders/back (female)
  const locks = [];
  if (fem && spec.hair !== 'none' && spec.locks !== false) {
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const start = add(headC, mv(Rh, (0.2 + i * 0.03) * s * HS, -0.22 * HS, (-0.18 - i * 0.08) * HS));
      const end = add(s < 0 ? shR : shL, [-s * (0.07 + i * 0.025), -0.01 - i * 0.035, 0.0 - i * 0.05]);
      const mid = mix3(start, end, 0.5);
      locks.push({ a: start, b: mid, c: end, r: 0.022 - i * 0.002, ph: hash1(seed * 13 + i * 3 + s) * 6 });
    }
  }
  let lockC = [0, 0, 0], lockR = 0;
  if (locks.length) {
    const all = locks.flatMap((L) => [L.a, L.c]);
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const p of all) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
    lockC = mix3(mn, mx, 0.5); lockR = len(sub(mx, mn)) * 0.5 + 0.05;
  }
  const lockSdf = (x, y, z) => {
    const bd = Math.hypot(x - lockC[0], y - lockC[1], z - lockC[2]) - lockR;
    if (bd > 0.02) return bd;
    let d = 1e9;
    for (const L of locks) {
      const t = clamp((y - L.a[1]) / (L.c[1] - L.a[1]), 0, 1);
      const p = mix3(L.a, L.c, t);
      const wob = 0.007 * Math.sin(t * 11 + L.ph);
      const dd = Math.hypot(x - p[0] - wob, z - p[2] - wob * 0.5) - L.r * (1 - 0.35 * t) - 0.002 * Math.sin(Math.atan2(z - p[2], x - p[0]) * 3 + t * 30 + L.ph);
      d = Math.min(d, Math.max(dd, Math.max(L.c[1] - y - 0.01, y - L.a[1] - 0.02)));
    }
    return d * 0.8;
  };

  // ---------- garments
  const G = makeGarment(garment, { fem, seed, P, C, Rp, Rc, trunk, freeLeg, freeLegG, legR, legL, lR, lL, shR, shL, neckBase, spec, kneel, aR, aL });

  // ---------- extras in figure space
  const extras = typeof spec.extras === 'function' ? spec.extras({ P, C, Rp, Rc, Rh, headC, neckBase, shR, shL, aR, aL, lR, lL, handR: armRg.M, handL: armLg.M, trunk, beltY: G.beltY }) : (spec.extras || []);

  // ---------- assemble
  const bodySkin = (x, y, z) => {
    let d = trunk.eval(x, y, z);
    d = smin(d, neckStub.f(x, y, z), 0.04);
    return d;
  };
  const bodySdf = (x, y, z) => {
    const dt = trunk.eval(x, y, z);
    let d = smin(dt, neckStub.f(x, y, z), 0.04);
    // arms (shoulder blends into the torso)
    const da = Math.min(evalB(armRg.g, x, y, z, d + 0.04), evalB(armLg.g, x, y, z, d + 0.04));
    d = smin(d, da, 0.035);
    if (sepHands) d = Math.min(d, armRg.bracelet(x, y, z), armLg.bracelet(x, y, z));
    // legs (mostly hidden by drapery)
    let dl = Math.min(evalB(legR.g, x, y, z, d + 0.06), evalB(legL.g, x, y, z, d + 0.06));
    // under a long skirt the legs stay well inside the cloth (only the feet show)
    if (longSkirt) dl += 0.025 * sstep(0.1, 0.2, y);
    d = smin(d, dl, 0.05);
    // garments
    const dg = G.sdf(x, y, z, dt);
    d = Math.min(d, dg);
    if (locks.length) d = smin(d, lockSdf(x, y, z), 0.01);
    for (const e of extras) d = e.blend ? smin(d, e.sdf(x, y, z, dt), e.blend) : Math.min(d, e.sdf(x, y, z, dt));
    return d;
  };
  const handSdf = (H) => (x, y, z) => {
    const b = Math.hypot(x - H.hb.c[0], y - H.hb.c[1], z - H.hb.c[2]) - H.hb.r;
    if (b > 0.03) return b;
    return H.hg.eval(x, y, z);
  };
  const handSdfR = sepHands ? handSdf(armRg) : null, handSdfL = sepHands ? handSdf(armLg) : null;
  const sdf = sepHands
    ? (x, y, z) => Math.min(bodySdf(x, y, z), headSdf(x, y, z), handSdfR(x, y, z), handSdfL(x, y, z))
    : (x, y, z) => Math.min(bodySdf(x, y, z), headSdf(x, y, z));
  const gold = (x, y, z) => {
    let g = headGold(x, y, z);
    if (sepHands && spec.braceletGold !== 0) for (const H of [armRg, armLg]) { const db = H.bracelet(x, y, z); if (db < 0.006) g = Math.max(g, (1 - Math.max(0, db) / 0.006) * (spec.braceletGold ?? 1)); }
    if (G.gold) g = Math.max(g, G.gold(x, y, z));
    for (const e of extras) if (e.gold) g = Math.max(g, e.gold(x, y, z));
    return g;
  };

  // bounds
  const pts = [aR.wr, aL.wr, aR.el, aL.el, lR.an, lL.an, headC, [0, 0, 0]];
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
  mn = [mn[0] - 0.36, -0.02, mn[2] - 0.36]; mx = [mx[0] + 0.36, mx[1] + 0.25, mx[2] + 0.36];
  if (spec.extraBounds) for (const b of spec.extraBounds) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], b[0][i]); mx[i] = Math.max(mx[i], b[1][i]); }
  const hb = 0.26 * hsc;
  const headBounds = { min: [headC[0] - hb, neckBase[1] - 0.09, headC[2] - hb], max: [headC[0] + hb, headC[1] + hb + (spec.headBoundsUp || 0), headC[2] + hb] };
  if (spec.headBoundsExtra) for (let i = 0; i < 3; i++) { headBounds.min[i] -= spec.headBoundsExtra; headBounds.max[i] += spec.headBoundsExtra; }

  return {
    sdf, bodySdf, headSdf, bodySkin, gold,
    bounds: { min: mn, max: mx }, headBounds,
    joints: { P, C, headC, neckBase, Rh, Rc, shR, shL, aR, aL, lR, lL, handR: armRg.M, handL: armLg.M },
    hands: sepHands ? [
      { sdf: handSdfR, bounds: { min: armRg.hb.c.map((v) => v - armRg.hb.r), max: armRg.hb.c.map((v) => v + armRg.hb.r) } },
      { sdf: handSdfL, bounds: { min: armLg.hb.c.map((v) => v - armLg.hb.r), max: armLg.hb.c.map((v) => v + armLg.hb.r) } },
    ] : [],
    HS,
  };
}

// ------------------------------------------------------------------ garments
function makeGarment(type, ctx) {
  const { fem, seed, P, C, trunk, freeLeg, freeLegG, shR, shL, neckBase, spec, kneel } = ctx;
  if (type === 'nude') return { sdf: () => 1e9 };
  const S = spec.drape || {};
  const hemY = S.hemY ?? (type === 'peplos' ? 1.0 : 1.12);
  const beltY = S.beltY ?? C[1] - 0.13;
  const skirtN = S.folds ?? (type === 'chiton' ? 34 : 26);
  const skirtA = S.foldAmp ?? (type === 'chiton' ? 0.017 : 0.024);
  const kneeK = freeLeg.kn;
  const ground = kneel ? 0.0 : 0.0;

  // ---- lower skirt (from the hips to the ground)
  const skirtTop = type === 'chlamys' ? C[1] - 0.25 : P[1] + 0.12;
  const skirtBottom = S.skirtBottom ?? (type === 'chlamys' ? 0.9 : 0.0);
  const skirt = (x, y, z, dTrunk) => {
    if (y > skirtTop + 0.1 || y < skirtBottom - 0.05) return 1e9;
    const span = Math.max(0.2, P[1] - 0.0);
    const t = clamp((y - 0.0) / span, 0, 1.2);
    const flare = 0.016 * sstep(0.13, 0.0, y);
    const wx = S.hipWide ?? 0;
    // (r6) S.slim narrows the skirt toward the hem (no cone silhouette)
    const sl = (S.slim ?? 0) * (1 - Math.min(1, t));
    const rx = lerp(0.235, 0.182 + wx, t) + flare + (S.wide || 0) - sl, rz = lerp(0.185, 0.138 + wx * 0.3, t) + flare + (S.wide || 0) * 0.7 - sl * 0.6;
    const cx = P[0] * (1 - t) * 0.4, cz = lerp(-0.012, P[2], t);
    const d0 = ellipse2(x - cx, z - cz, rx, rz);
    let d = d0;
    const lb = freeLegG.g.bound(x, y, z);
    if (d > 0.14 && lb > 0.14 && (y < P[1] - 0.25 || dTrunk > 0.14)) return Math.min(d, lb) - 0.07;
    // the free leg pushes the cloth: knee, shin
    const dl = evalB(freeLegG.g, x, y, z, d + 0.2) + (S.legPush ?? 0.006);
    d = smin(d, dl, 0.08);
    // where the leg pushes the cloth out it is stretched taut: shallow folds
    const legDom = sstep(-0.01, 0.035, d0 - dl);
    // hips at the top
    // (r6) above the hips the skirt hugs the body (no barrel-like shelf where the skirt top is cut off)
    if (y > P[1] - 0.3) d = lerp(smin(d, dTrunk - 0.022, 0.09), dTrunk - 0.022, sstep(P[1] - 0.3, P[1] + 0.06, y));
    // folds: deep tubular folds hanging from the belt, gathered at the top, broad at the hem
    const th = Math.atan2(x - cx, z - cz);
    let amp = skirtA * (0.3 + 0.7 * sstep(P[1] + 0.05, P[1] - 0.45, y));
    amp *= 1 - 0.72 * legDom;
    // back folds softer
    amp *= z - cz < 0 ? 0.8 : 1;
    const f = foldTubes(th, y, skirtN, seed, 1.0);
    d -= amp * f;
    // secondary finer folds between the big ones + a few catenary sags across the free shin
    d -= amp * (S.fine ?? 0.2) * foldTubes(th + 0.11, y * 1.3, Math.round(skirtN * 2.3), seed + 3, 1.4);
    if (legDom > 0.01) {
      // soft diagonal undulations across the taut cloth over the shin (smooth, no creases)
      const v = (y - (x - kneeK[0]) * 0.55 * Math.sign(kneeK[0] || 1)) / 0.09;
      d -= 0.004 * (0.5 + 0.5 * Math.sin(v * TAU)) * legDom * sstep(kneeK[1] + 0.05, kneeK[1] - 0.15, y);
    }
    // fine wrinkles
    d -= 0.0018 * vnoise3(x * 45 + seed, y * 9, z * 45);
    d /= 1.7;
    // hem: lies on the ground, slightly irregular
    // the hem lifts a little over the front of the feet (toes peek out)
    const hem = skirtBottom + 0.004 + 0.008 * f + (skirtBottom < 0.05 ? 0.035 * sstep(0.12, 0.2, z - cz) * (1 - legDom * 0.3) : 0);
    d = Math.max(d, hem - y);
    d = Math.max(d, y - skirtTop);
    return d;
  };

  // ---- upper garment over the torso (peplos overfold / chiton bodice)
  const yh = (th) => hemY + (S.hemCurve ?? 0.04) * Math.cos(2 * th) + 0.015 * Math.cos(3 * th + seed) - (S.hemSide ?? 0.02) * Math.abs(Math.sin(th));
  const overN = S.overFolds ?? 18;
  const over = (x, y, z, dTrunk) => {
    if (y < hemY - 0.12) return 1e9;
    const th = Math.atan2(x - P[0], z - P[2]);
    const below = sstep(beltY + 0.02, beltY - 0.25, y); // 0 at the belt, 1 at the hem
    const above = sstep(beltY, beltY + 0.05, y) * sstep(beltY + 0.16, beltY + 0.06, y); // blousing just above the belt
    const oa = S.overAmp ?? 1;
    const fr = 0.55 + 0.45 * Math.abs(Math.cos(th)); // flares at the front/back, hugs the hips at the sides
    let off = 0.011 + 0.022 * below * oa * fr + 0.012 * above;
    off -= 0.006 * Math.exp(-(((y - beltY) / 0.03) ** 2));
    let d = dTrunk - off;
    // folds radiate down from the belt; shallow over the breasts
    const amp = (0.004 + 0.016 * below * oa + 0.006 * above);
    const f = foldTubes(th, y * 0.8, overN, seed + 7, 0.6);
    d -= amp * f;
    // thin cloth clinging over the chest: fine vertical crinkles
    const chest = sstep(beltY + 0.08, beltY + 0.16, y);
    if (chest > 0) d -= (S.chestFolds ?? 0.0035) * chest * foldTubes(th * 1.0, y * 2.0, S.chestFolds ? 30 : 44, seed + 13, 0.8); // (r6) S.chestFolds: deeper crinkles (colossi)
    d -= 0.0015 * vnoise3(x * 50, y * 50 + seed, z * 50);
    d /= 1.5;
    // hem of the overfold (open at the bottom → visible lip with a shadow underneath)
    let hy = yh(th) - (0.016 + 0.02 * Math.abs(Math.sin(th))) * f * below * (S.hemScallop ?? 1);
    if (S.zigzag) {
      // open side of the peplos (left, +X): the overfold edge falls lower in a zigzag cascade
      const side = Math.exp(-(((th - 1.45) / 0.42) ** 2));
      const zz = Math.abs(((th * 9 + seed) % 2 + 2) % 2 - 1);
      hy -= side * (0.13 + 0.05 * zz);
    }
    d = smax(d, hy - y, 0.012);
    // neckline (V at the front)
    // (r6) the cloth runs over the shoulders (pinned there): the neckline only opens around the neck
    const nl = neckBase[1] - 0.04 - 0.07 * sstep(0.0, 0.08, z - C[2]) * (1 - sstep(0.02, 0.14, Math.abs(x - C[0]))) + 0.9 * Math.max(0, Math.abs(x - C[0]) - 0.075);
    d = smax(d, y - nl, 0.01);
    return d;
  };

  // ---- belt
  const belt = (x, y, z, dTrunk) => {
    if (Math.abs(y - beltY) > 0.08) return 1e9;
    let d = dTrunk - 0.024;
    d = smax(d, Math.abs(y - beltY) - 0.017, 0.01);
    // knot at the front
    const kf = [C[0], beltY, 0];
    return d;
  };

  // ---- back mantle (himation hanging from the shoulders behind)
  const mant = S.mantle ?? (type === 'peplos');
  const mantleN = 11;
  const mantle = (x, y, z, dTrunk) => {
    if (!mant) return 1e9;
    if (y > neckBase[1] + 0.03 || z > C[2] + 0.12) return 1e9;
    const t = clamp(y / 1.62, 0, 1);
    // (r6) S.mantleScale < 1: a slimmer mantle (hugs the back instead of a wide bell behind the figure)
    const ms = S.mantleScale ?? 1;
    const rx = lerp(lerp(0.215, 0.31, ms), 0.215, Math.pow(t, 1.5)), rz = lerp(lerp(0.135, 0.26, ms), 0.135, Math.pow(t, 1.2));
    const cz = C[2] - 0.035;
    const lx = x - C[0] * t, lz = z - cz;
    let d = ellipse2(lx, lz, rx, rz);
    if (d > 0.12 && dTrunk > 0.12) return Math.min(d, dTrunk) - 0.06;
    // hangs from the shoulders: blend into the trunk at the top
    const top = sstep(1.2, 1.5, y);
    if (top > 0) d = smin(d, dTrunk - 0.028, 0.06 + 0.06 * top);
    const th = Math.atan2(lx, lz);
    const f = foldTubes(th, y * 0.55, 13, seed + 21, 0.9);
    d -= (0.02 + 0.05 * (1 - t)) * f;
    d -= 0.006 * foldTubes(th + 0.2, y * 0.8, 29, seed + 22, 1.2);
    d -= 0.0015 * vnoise3(x * 50, y * 12 + seed, z * 50);
    d /= 1.6;
    // shell (hollow cloth)
    const shell = Math.abs(d + 0.019) - 0.019;
    // only the back half; the hanging side edge waves (rolled, rounded)
    // cascading edge: overlapping folded layers (triangle wave) instead of a straight cut
    // hanging edge: broad soft undulation (folded-back layers), no sharp zigzag
    const zEdge = -0.012 + 0.03 * Math.sin(y * 4.2 + seed) * (0.5 + 0.5 * (1 - t)) + 0.01 * Math.sin(y * 11 + seed * 2) - 0.08 * sstep(0.0, -0.14, x - C[0]) + (S.mantleFront ?? 0.03) * sstep(0.05, 0.22, x - C[0])
      - (S.mantleBack ?? 0) * (1 - (S.mantleSideL ? sstep(0.06, 0.2, x - C[0]) : 0)); // (r6) pulled behind the back (the side planks no longer read from the front); mantleSideL keeps the fall on the left side
    let dd = smax(shell, lz - zEdge, 0.02);
    dd = smax(dd, -(dTrunk + 0.06), 0.01); // never deep inside the body
    // U-shaped top edge: hangs from the shoulders, dips at the centre of the back
    const mdx = x - C[0];
    dd = smax(dd, y - (neckBase[1] + 0.005 - 0.13 * Math.max(0, 1 - (mdx / 0.17) ** 2) - 0.03 * Math.abs(mdx)), 0.015);
    dd = Math.max(dd, 0.02 - y);
    return dd;
  };

  // ---- chiton / himation diagonal mantle wrapped round the hips (generic statues)
  const himation = (x, y, z, dTrunk) => {
    if (type !== 'himation' && type !== 'chiton') return 1e9;
    // a thick wrap from the left shoulder diagonally across the body to the knees
    const top = (S.himTop ?? 1.15) + (x - P[0]) * (S.himSlope ?? 0.9);
    const bot = S.himBottom ?? 0.48;
    if (y > top + 0.05 || y < bot - 0.1) return 1e9;
    const t = clamp(y / 1.4, 0, 1);
    const rx = lerp(0.225, 0.2, t), rz = lerp(0.175, 0.145, t);
    let d = ellipse2(x - P[0] * 0.5, z - P[2], rx, rz);
    if (y > P[1] - 0.3) d = smin(d, dTrunk - 0.035, 0.08);
    d = smin(d, freeLegG.g.eval(x, y, z) - 0.045, 0.1);
    // diagonal folds (catenary swags)
    const th = Math.atan2(x - P[0], z - P[2]);
    // swags curve around the body (catenaries hanging from the left shoulder toward the right hip)
    // (smooth catenary swags: they sag at the front, spacing well above the mesh resolution)
    // a few irregular catenary swags (thin crisp ridges on a smooth wrap; they fade toward the back)
    const sag = 0.07 * Math.cos(th);
    // (r6) stacked tubular swags with deep crevices (was thin ridges on a smooth slab), a rolled top edge
    const v = (y - (x - P[0]) * (S.himSlope ?? 0.9) * 0.7 + sag) / 0.12 + 0.5 * Math.sin(th * 2 + seed) + 0.35 * Math.sin(y * 7 + seed) + 0.6 * vnoise3(x * 5 + seed, y * 4, z * 5);
    const ci = Math.floor(v), uu = (v - ci) * 2 - 1;
    const hv = hash1(ci * 7.3 + seed);
    const lowF = sstep(bot + 0.05, bot + 0.3, y); // the swags fade into vertical folds toward the hanging hem
    const f = (hv < 0.3 ? 0.2 : 0.35 + 0.65 * hv) * Math.pow(Math.max(0, 1 - uu * uu), 0.85) * (0.4 + 0.6 * Math.max(0, Math.cos(th))) * lowF;
    d -= 0.018 * f;
    d -= (0.005 + 0.007 * (1 - lowF)) * foldTubes(th, y, 23, seed + 31, 0.6); // vertical creases, stronger near the hem
    d -= 0.02 * Math.exp(-(((y - top + 0.035) / 0.028) ** 2)); // the rolled upper edge
    d /= 1.6;
    d = smax(d, y - top, 0.012);
    const hb = bot + 0.06 * Math.sin((x - P[0]) * 12 + seed) + 0.04 * (x - P[0]);
    d = smax(d, hb - y, 0.012);
    return d;
  };
  // left-shoulder fall of the himation (over the shoulder and down the back/arm side)
  const shoulderFall = (x, y, z) => {
    if (type !== 'himation') return 1e9;
    const a = add(shL, [0.0, 0.05, -0.03]), b = [shL[0] + 0.03, S.fallBottom ?? 0.55, shL[2] - 0.07];
    let d = cone(x, y, z, a, b, 0.07, 0.11);
    const th = Math.atan2(x - b[0], z - b[2]);
    d -= 0.015 * foldTubes(th, y, 9, seed + 5, 0.5);
    d /= 1.4;
    return d;
  };

  // ---- chlamys: short cloak pinned at the right shoulder (male warriors)
  const chlamys = (x, y, z, dTrunk) => {
    if (type !== 'chlamys') return 1e9;
    if (y < C[1] - 0.75 || y > neckBase[1] + 0.05) return 1e9;
    let d = dTrunk - 0.03;
    const th = Math.atan2(x - C[0], z - C[2]);
    d -= 0.015 * foldTubes(th, y, 14, seed + 9, 0.5) * sstep(C[1], C[1] - 0.4, y);
    d /= 1.4;
    // covers the back and the left side, open at the front-right
    const open = (x - C[0]) * 0.8 - (z - C[2]) * 1.2 + 0.05;
    d = smax(d, -open, 0.012);
    const hem = C[1] - 0.62 + 0.15 * sstep(-0.2, 0.2, x - C[0]);
    d = smax(d, hem - y, 0.012);
    return d;
  };

  const gsdf = (x, y, z, dTrunk) => {
    let d = 1e9;
    if (type === 'peplos' || type === 'chiton' || type === 'himation') {
      d = skirt(x, y, z, dTrunk);
      if (type !== 'himation' || S.overfold) d = Math.min(d, over(x, y, z, dTrunk));
      else d = Math.min(d, overSimple(x, y, z, dTrunk));
      if (S.belt !== false && type !== 'himation') d = smin(d, belt(x, y, z, dTrunk), 0.006);
      d = Math.min(d, mantle(x, y, z, dTrunk));
      if (type === 'himation' || S.himation) {
        d = Math.min(d, himation(x, y, z, dTrunk));
        d = smin(d, shoulderFall(x, y, z), 0.04);
      }
    } else if (type === 'chlamys') {
      d = Math.min(d, chlamys(x, y, z, dTrunk));
    } else if (type === 'lap') {
      d = lap(x, y, z, dTrunk);
    }
    return d;
  };
  // ---- lap drape (seated / reclining / kneeling figures): cloth over the legs and hips + a curtain to the ground
  const lap = (x, y, z, dTrunk) => {
    const dl = Math.min(evalB(ctx.legR.g, x, y, z, 0.25), evalB(ctx.legL.g, x, y, z, 0.25));
    if (dl > 0.2 && dTrunk > 0.2) return Math.min(dl, dTrunk) - 0.08;
    let d = dl - 0.034;
    if (y < P[1] + (S.lapTop ?? 0.14)) d = smin(d, dTrunk - 0.028, 0.08);
    if (S.curtain) {
      const kR = ctx.lR.kn, kL = ctx.lL.kn;
      const x0 = Math.min(kR[0], kL[0]) - 0.07, x1 = Math.max(kR[0], kL[0]) + 0.07;
      const zk = (kR[2] + kL[2]) * 0.5 + 0.02, yk = Math.min(kR[1], kL[1]);
      const xc = (x0 + x1) / 2, hw = (x1 - x0) / 2 + 0.06 * (1 - y / Math.max(0.2, yk));
      const fz = 0.022 * Math.abs(Math.sin(x * 38 + seed)) + 0.01 * Math.sin(x * 15 + seed);
      const dc = Math.max(Math.max(Math.abs(x - xc) - hw, Math.abs(z - zk + 0.03 - fz) - 0.035), y - yk);
      d = smin(d, Math.max(dc, -y), 0.05);
    }
    // folds running along / around the legs
    const n = vnoise3(x * 22 + seed, y * 9, z * 9);
    d -= 0.008 * Math.abs(n) + 0.002 * vnoise3(x * 60, y * 60, z * 60);
    d -= 0.012 * foldTubes(Math.atan2(x - P[0], y - 0.3), z * 2, 15, seed + 17, 0.8);
    d /= 1.3;
    d = Math.max(d, -y);
    if (S.bodice) {
      // chiton bodice over the torso
      let b = dTrunk - 0.012;
      const th = Math.atan2(x - P[0], z - P[2]);
      b -= 0.007 * foldTubes(th, y, 22, seed + 4, 0.5);
      b /= 1.3;
      b = smax(b, P[1] - 0.1 - y, 0.01);
      b = smax(b, y - (neckBase[1] - 0.035) - 0.9 * Math.max(0, Math.abs(x - C[0]) - 0.075), 0.01);
      d = smin(d, b, 0.02);
    }
    return d;
  };
  // simple tunic over the torso for male himation statues (bare chest optional)
  const overSimple = (x, y, z, dTrunk) => {
    if (S.bareChest) {
      return 1e9;
    }
    let d = dTrunk - 0.012;
    const th = Math.atan2(x - P[0], z - P[2]);
    d -= 0.008 * foldTubes(th, y, 20, seed + 4, 0.5);
    d /= 1.3;
    d = smax(d, P[1] - 0.25 - y, 0.012);
    const nl = neckBase[1] - 0.04 + 0.9 * Math.max(0, Math.abs(x - C[0]) - 0.075); // (r6) over the shoulders
    return smax(d, y - nl, 0.01);
  };
  return {
    sdf: gsdf,
    gold: null,
    beltY,
  };
}
