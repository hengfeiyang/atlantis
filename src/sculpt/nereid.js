// Nereids riding dolphins (fountain groups around Poseidon's chariot, ref 3 / ref 6).
// Nominal figure units (2.0 m standing figure, ground y = 0, the rider faces +Z, sits side-saddle on a
// dolphin that dives toward -X with its tail curling up behind her toward +X).
//   makeDolphin(o) → { sdf, bounds, mouth, back(x) }     makeNereid(variant) → { fig, dolphin, sdf, gold, regions, mouth }
import { sd, clamp, lerp, sstep, smin, smax, add, sub, scale, norm, len, mix3, cone, ellipsoidR, mT, vnoise3, hash1, bezier, cross, dot, Group, mv } from './sdf.js';
import { makeFigure } from './figure.js';

// ------------------------------------------------------------------ dolphin
/** o: { P: [beak, c1, c2, tailBase] cubic bezier spine, lat: [0,0,1] lateral axis, size } */
export function makeDolphin(o = {}) {
  const P = o.P || [[-1.05, 0.08, 0.08], [-0.62, 0.32, 0.02], [0.32, 0.62, -0.06], [0.88, 1.08, -0.12]];
  const N = 40;
  const sp = bezier(P[0], P[1], P[2], P[3], N);
  const lat0 = norm(o.lat || [0, 0, 1]);
  const fr = sp.map((p, i) => {
    const tg = norm(sub(sp[Math.min(N, i + 1)], sp[Math.max(0, i - 1)]));
    let lat = norm(sub(lat0, scale(tg, dot(lat0, tg))));
    const up = norm(cross(lat, tg)); // dorsal (for a spine running toward -X with lat +Z: up = +Y)
    return { p, tg, lat, up: dot(up, [0, 1, 0]) < 0 ? scale(up, -1) : up, t: i / N };
  });
  // radius profile (height half-axis) along the body; width is 0.88 of it
  const rad = (t) => {
    if (t < 0.045) return lerp(0.05, 0.08, t / 0.045);               // beak (rostrum) — r2: short, stout (sculpted dolphin, ref 3)
    if (t < 0.15) return lerp(0.08, 0.2, sstep(0.04, 0.11, t));      // melon / forehead
    if (t < 0.4) return lerp(0.19, 0.25, sstep(0.15, 0.36, t));
    if (t < 0.72) return lerp(0.25, 0.14, sstep(0.4, 0.72, t));
    return lerp(0.14, 0.07, sstep(0.72, 1.0, t));                     // tail stock (peduncle)
  };
  const g = new Group([], 0.06);
  for (let i = 0; i <= N; i += 2) {
    const f = fr[i], r = rad(f.t);
    const melon = f.t > 0.07 && f.t < 0.22 ? 0.05 * Math.sin(Math.PI * (f.t - 0.07) / 0.15) : 0;
    const c = add(f.p, scale(f.up, melon * 0.6 - (f.t > 0.25 && f.t < 0.6 ? 0.015 : 0)));
    const M = [f.lat[0], f.up[0], f.tg[0], f.lat[1], f.up[1], f.tg[1], f.lat[2], f.up[2], f.tg[2]];
    const ra = Math.max(0.1, Math.min(0.2, r * 0.9));
    g.add({ f: (x, y, z) => ellipsoidR(x, y, z, c, mT(M), r * 0.86, r + melon, ra), c, r: Math.max(r + melon, ra), k: 0.1 });
  }
  const at = (t) => { const i = Math.round(t * N); return fr[Math.max(0, Math.min(N, i))]; };
  // dorsal fin (swept back), pectoral fins, tail flukes
  const fins = [];
  {
    const f = at(0.6), r = rad(0.6);
    const b0 = add(f.p, scale(f.up, r * 0.8)), b1 = add(b0, scale(f.tg, 0.2));
    const b1b = add(b0, scale(f.tg, 0.3));
    const tip = add(add(b0, scale(f.up, 0.3)), scale(f.tg, 0.34));
    fins.push(finPart(b0, b1b, tip, f.lat, 0.035));
  }
  for (const s of [-1, 1]) {
    const f = at(0.27), r = rad(0.27);
    const b0 = add(add(f.p, scale(f.lat, s * r * 0.75)), scale(f.up, -r * 0.55));
    const b1 = add(b0, scale(f.tg, 0.1));
    const b1b = add(b0, scale(f.tg, 0.16));
    const tip = add(add(add(b0, scale(f.lat, s * 0.26)), scale(f.up, -0.16)), scale(f.tg, 0.3));
    fins.push(finPart(b0, b1b, tip, norm(cross(sub(tip, b0), f.tg)), 0.03));
  }
  {
    const f = at(1.0);
    for (const s of [-1, 1]) {
      const b0 = add(f.p, scale(f.tg, -0.08)), b1 = add(b0, scale(f.tg, 0.16));
      const tip = add(add(b0, scale(f.lat, s * 0.5)), scale(f.tg, 0.32));
      fins.push(finPart(b0, b1, tip, f.up, 0.035, true));
    }
  }
  const eyeL = (s) => { const f = at(0.15); return add(add(f.p, scale(f.lat, s * rad(0.15) * 0.82)), scale(f.up, -0.01)); };
  const eyes = [eyeL(-1), eyeL(1)];
  const fB = at(0.0), fM = at(0.09);
  const sdf = (x, y, z) => {
    let d = g.eval(x, y, z);
    if (d > 0.5) return d;
    for (const F of fins) d = smin(d, F(x, y, z), 0.05);
    // mouth line: a shallow groove along the side of the beak, curving up toward the eye (the dolphin 'smile')
    {
      const q = sub([x, y, z], fM.p);
      const al = dot(q, fM.tg), up = dot(q, fM.up);
      if (al > -0.16 && al < 0.1) d = smax(d, -(Math.hypot(up + 0.012 - 0.06 * sstep(0.0, 0.1, al), 0) - 0.008), 0.006);
    }
    for (const e of eyes) { const de = Math.hypot(x - e[0], y - e[1], z - e[2]); if (de < 0.06) d = smin(d, de - 0.022, 0.012); }
    return d;
  };
  const mouth = add(fB.p, scale(fB.tg, -0.02));
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const f of fr) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], f.p[i]); mx[i] = Math.max(mx[i], f.p[i]); }
  const bounds = { min: mn.map((v) => v - 0.42), max: mx.map((v) => v + 0.42) };
  /** dorsal surface height above (x) — where the rider sits */
  const back = (x) => { let best = fr[0]; for (const f of fr) if (Math.abs(f.p[0] - x) < Math.abs(best.p[0] - x)) best = f; return add(best.p, scale(best.up, rad(best.t))); };
  return { sdf, bounds, mouth, back, frames: fr };
}

/** flat fin: a triangle (b0, b1, tip) with rounded thickness th, curved; n = fin normal */
function finPart(b0, b1, tip, n, th, fluke = false) {
  const nn = norm(n);
  return (x, y, z) => {
    const p = [x, y, z];
    // distance to the triangle in its plane (approx): signed distance to 3 edges of the 2D triangle
    const h = dot(sub(p, b0), nn);
    const q = sub(p, scale(nn, h));
    const e = (a, b, c) => { // signed distance of q to edge a→b (positive outside, c is inside)
      const ab = sub(b, a), ac = sub(c, a), aq = sub(q, a);
      const nrm = norm(sub(ac, scale(ab, dot(ac, ab) / dot(ab, ab))));
      return -dot(aq, nrm);
    };
    const tip2 = fluke ? add(tip, scale(sub(b0, tip), 0.0)) : tip;
    let d2 = Math.max(e(b0, b1, tip2), e(b1, tip2, b0), e(tip2, b0, b1));
    // tips are rounded, the trailing edge of a fluke is notched
    const thk = th * (0.4 + 0.6 * clamp(1 - len(sub(q, b0)) / Math.max(1e-3, len(sub(tip, b0))), 0, 1));
    const dz = Math.abs(h) - thk;
    return Math.min(Math.max(d2 - 0.012, dz), 0) + Math.hypot(Math.max(d2 - 0.012, 0), Math.max(dz, 0));
  };
}

// ------------------------------------------------------------------ the riders
const NV = {
  // right arm raised holding up a shell, left hand on the dolphin (ref 3 left basin)
  a: { seed: 301, head: { yaw: -0.35, pitch: -0.12 }, chest: { yaw: -0.15, roll: 0.06 },
    armR: { wrist: [-0.36, 1.68, 0.18], pole: [-1, -0.2, -0.3], fingers: [0.1, 1, 0.2], dorsal: [-0.3, 0, -1], curl: [0.35, 0.4, 0.3], spread: 0.08 },
    armL: { wrist: [0.32, 0.72, 0.06], pole: [0.6, 0.2, -1], fingers: [0.3, -1, 0.2], dorsal: [1, 0, 0], curl: [0.25, 0.3, 0.2] },
    dP: [[-1.05, 0.08, 0.1], [-0.62, 0.3, 0.02], [0.34, 0.6, -0.06], [0.86, 1.1, -0.14]] },
  // both arms out, turning, as if steering (ref 3 left basin, second figure)
  b: { seed: 311, head: { yaw: 0.3, pitch: -0.05 }, chest: { yaw: 0.2, roll: -0.05 },
    armR: { wrist: [-0.52, 1.25, 0.22], pole: [-1, -0.4, -0.2], fingers: [-0.6, 0.4, 0.5], dorsal: [0, 1, -0.2], curl: [0.4, 0.5, 0.3], spread: 0.06 },
    armL: { wrist: [0.5, 1.42, 0.12], pole: [1, -0.4, -0.3], fingers: [0.6, 0.6, 0.3], dorsal: [0, 0.3, -1], curl: [0.35, 0.4, 0.3], spread: 0.08 },
    dP: [[-1.1, 0.1, 0.12], [-0.7, 0.38, 0.0], [0.3, 0.52, -0.04], [0.92, 0.98, -0.2]] },
  // left arm raised high with a garland, right hand on the hip (ref 3 right basin)
  c: { seed: 321, head: { yaw: 0.25, pitch: -0.15 }, chest: { yaw: 0.1, roll: -0.07 },
    armL: { wrist: [0.3, 1.82, 0.12], pole: [1, -0.1, -0.3], fingers: [0.1, 1, 0.1], dorsal: [0.2, 0, -1], curl: [0.9, 1.0, 0.7], thumbCurl: 0.7 },
    armR: { wrist: [-0.24, 0.92, 0.12], pole: [-0.7, 0, -1], fingers: [0.3, -0.8, 0.3], dorsal: [-1, 0, 0], curl: [0.6, 0.7, 0.5] },
    dP: [[-1.0, 0.06, 0.05], [-0.6, 0.34, 0.06], [0.36, 0.64, -0.08], [0.8, 1.16, -0.1]] },
  // leaning back, right arm stretched forward-up (ref 3 right basin, front figure)
  d: { seed: 331, head: { yaw: -0.1, pitch: -0.25 }, chest: { yaw: -0.25, pitch: -0.12, roll: 0.05 },
    armR: { wrist: [-0.3, 1.52, 0.5], pole: [-1, -0.5, 0], fingers: [0.0, 0.6, 1], dorsal: [-0.2, 1, -0.4], curl: [0.3, 0.35, 0.25], spread: 0.1 },
    armL: { wrist: [0.38, 0.78, -0.06], pole: [0.7, 0.3, -1], fingers: [0.2, -1, -0.1], dorsal: [1, 0, 0], curl: [0.2, 0.3, 0.2] },
    dP: [[-1.08, 0.08, 0.14], [-0.64, 0.26, 0.04], [0.34, 0.66, -0.1], [0.84, 1.12, -0.06]] },
};
export const NEREID_VARIANTS = Object.keys(NV);

export function makeNereid(v = 'a') {
  const V = NV[v];
  const dol = makeDolphin({ P: V.dP });
  const seat = dol.back(0.02);
  const hipY = seat[1] + 0.07;
  const spec = {
    sex: 'f', seed: V.seed, garment: 'lap', weight: 'R', hair: 'wavy', handRegion: true, headScale: 1.07,
    hip: { y: hipY, roll: 0.02, shift: [0, seat[2] - 0.02] }, chest: V.chest, head: V.head,
    weightAnkle: [-0.08, Math.max(0.12, hipY - 0.82), 0.4], freeAnkle: [0.12, Math.max(0.14, hipY - 0.76), 0.34],
    armR: V.armR, armL: V.armL,
    drape: { curtain: false, bodice: false, lapTop: 0.06, lapCut: hipY - 0.3, lapNoise: 0.35 }, breast: { s: 0.82, k: 0.06 },
    extraBounds: [[dol.bounds.min, dol.bounds.max]],
  };
  spec.drape.lapCut = undefined;   // r2: the cloth reaches the ankles (no bare-shin "shorts")
  const fig = makeFigure(spec);
  const drape = nereidDrape(fig, dol, V, spec);
  // a small wave knob under the dolphin's beak (support) with a curl
  const base = (x, y, z) => {
    const b = dol.mouth;
    let d = sd.ellipsoid(x - b[0] - 0.05, y - 0.02, z - b[2], 0.42, 0.16, 0.38);
    d = smin(d, sd.ellipsoid(x - b[0] + 0.15, y - 0.12, z - b[2] + 0.1, 0.18, 0.2, 0.16), 0.1);
    return Math.max(d - 0.02 * vnoise3(x * 12, y * 12, z * 12), -y);
  };
  const dolSdf = (x, y, z) => Math.min(dol.sdf(x, y, z), base(x, y, z));
  const bodySdf = (x, y, z) => Math.min(fig.bodySdf(x, y, z), dolSdf(x, y, z), drape.sdf(x, y, z));
  const sdf = (x, y, z) => Math.min(fig.sdf(x, y, z), dolSdf(x, y, z), drape.sdf(x, y, z));
  const b0 = fig.bounds;
  const bounds = { min: b0.min.map((v, i) => Math.min(v, dol.bounds.min[i], drape.bounds.min[i])), max: b0.max.map((v, i) => Math.max(v, dol.bounds.max[i], drape.bounds.max[i])) };
  bounds.min[1] = -0.02;
  return { fig, dolphin: dol, sdf, bodySdf, gold: () => 0.85, bounds, mouth: dol.mouth };
}

// ------------------------------------------------------------------ drapery (r2 arch-b)
/**
 * Richer Nereid drapery (ref 3 / classical Nereid statues): a skirt panel falling between the shins to the
 * ankles, a cloth train laid over the dolphin's back and spilling down its flank, and a mantle falling
 * down the back from the shoulders, flaring at the seat. Returns { sdf, bounds } in figure units.
 */
function nereidDrape(fig, dol, V, spec) {
  const J = fig.joints, seed = V.seed;
  const kR = J.lR.kn, kL = J.lL.kn, aR = J.lR.an, aL = J.lL.an;
  // ---- skirt panel: a sheet hanging from the knees to just above the ankles, vertical tube folds
  const x0 = Math.min(kR[0], kL[0], aR[0], aL[0]) - 0.05, x1 = Math.max(kR[0], kL[0], aR[0], aL[0]) + 0.05;
  const yTop = Math.max(kR[1], kL[1]) + 0.04, yBot = Math.min(aR[1], aL[1]) + 0.07;
  const zK = (kR[2] + kL[2]) / 2, zA = (aR[2] + aL[2]) / 2;
  const skirt = (x, y, z) => {
    if (y > yTop + 0.1 || y < yBot - 0.1 || x < x0 - 0.15 || x > x1 + 0.15) return 0.12;
    const t = clamp((yTop - y) / Math.max(0.05, yTop - yBot), 0, 1);
    const zc = lerp(zK, zA, t) + 0.035;
    const flare = 0.03 + 0.07 * t;
    const fold = 0.026 * Math.sin((x - x0) * 34 + seed + 2.5 * Math.sin(y * 6)) * (0.35 + 0.65 * t);
    const dz = Math.abs(z - zc - fold) - 0.022;
    const dx = Math.max(x0 - flare - x, x - x1 - flare);
    const hem = yBot + 0.03 * Math.sin(x * 23 + seed) - y;
    let d = Math.max(dz, dx, hem, y - yTop);
    return d * 0.8;
  };
  // ---- cloth train over the dolphin's back, from the seat toward the tail and down both flanks
  const F = dol.frames;
  const seatX = dol.back(0.02)[0];
  let iSeat = 0;
  for (let i = 0; i < F.length; i++) if (Math.abs(F[i].p[0] - seatX) < Math.abs(F[iSeat].p[0] - seatX)) iSeat = i;
  const tS = F[iSeat].t, t0 = tS - 0.07, t1 = tS + 0.17;
  const near = (x, y, z) => {
    let best = F[0], bd = 1e9;
    for (let i = 0; i < F.length; i += 2) { const f = F[i]; const d = (x - f.p[0]) ** 2 + (y - f.p[1]) ** 2 + (z - f.p[2]) ** 2; if (d < bd) { bd = d; best = f; } }
    return best;
  };
  const train = (x, y, z) => {
    const dd = dol.sdf(x, y, z);
    if (dd > 0.1) return dd - 0.04;
    const f = near(x, y, z);
    if (f.t < t0 - 0.02 || f.t > t1 + 0.04) return dd;
    const q = [x - f.p[0], y - f.p[1], z - f.p[2]];
    const up = q[0] * f.up[0] + q[1] * f.up[1] + q[2] * f.up[2];
    const lat = q[0] * f.lat[0] + q[1] * f.lat[1] + q[2] * f.lat[2];
    // cloth = a layer laid on the dolphin's skin: thicker where it hangs (folds stand off), a crisp hem ledge,
    // tapering into the skin toward both ends along the spine (no cut slabs)
    const hang = sstep(0.05, -0.2, up);
    const fold = (0.006 + 0.018 * hang) * (0.5 + 0.5 * Math.sin(f.t * 52 + seed + 4 * Math.sin(lat * 7 + up * 5)));
    const hemUp = 0.02 - 0.22 * sstep(-0.1, 0.15, lat) + 0.04 * Math.sin(f.t * 41 + seed) + 0.025 * Math.sin(lat * 17 + up * 9);
    const taper = sstep(t0 - 0.02, t0 + 0.05, f.t) * sstep(t1 + 0.04, t1 - 0.06, f.t);
    const Lc = (0.016 + 0.014 * hang + fold) * taper * sstep(hemUp - 0.008, hemUp + 0.008, up);
    return dd - Lc;
  };
  // ---- mantle down the back: cloth hanging from the shoulders to the seat, flaring out at the sides (chest frame)
  const Rc = J.Rc, C = J.C, sk = fig.bodySkin;
  const yS = Math.max(J.shR[1], J.shL[1]), yH = J.P[1] - 0.12;
  const mantle = (x, y, z) => {
    if (y > yS + 0.08 || y < yH - 0.1) return 0.1;
    const wx = x - C[0], wy = y - C[1], wz = z - C[2];
    const lx = Rc[0] * wx + Rc[3] * wy + Rc[6] * wz, lz = Rc[2] * wx + Rc[5] * wy + Rc[8] * wz;
    if (lz > 0.12) return 0.1;
    const t = clamp((yS - y) / (yS - yH), 0, 1);                 // 0 shoulders → 1 seat
    const off = 0.02 + 0.07 * t * t;                              // flares out toward the seat
    const fold = (0.008 + 0.03 * t) * Math.sin(Math.atan2(lx, -lz) * 9 + seed + 3 * t);
    const ds = sk(x, y, z);
    if (ds > 0.3) return ds - 0.2;
    let d = Math.abs(ds - off - fold) - 0.013;
    d = smax(d, lz + 0.02 - 0.06 * t + 0.03 * Math.sin(y * 19 + seed), 0.015); // back half (wraps a little forward low down)
    d = smax(d, y - yS - 0.02 + 0.08 * Math.abs(lx), 0.015);    // over the shoulder line
    d = smax(d, yH + 0.03 * Math.sin(lx * 21 + seed) - y, 0.01); // uneven lower hem
    return d * 0.85;
  };
  const sdf = (x, y, z) => Math.min(skirt(x, y, z), train(x, y, z), mantle(x, y, z));
  const bounds = { min: [x0 - 0.5, -0.02, Math.min(zK, C[2]) - 0.5], max: [x1 + 0.5, yS + 0.2, Math.max(zA, zK) + 0.3] };
  void spec;
  return { sdf, bounds };
}
