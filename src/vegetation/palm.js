// Date palm (Phoenix dactylifera) generator — the hero tree of the golden era (refs 2, 3, 5).
//
//   buildPalm(seed, style) → { H, R, lods: [{bark, blob, card, tris}, ...×3], skel }
//     LOD0 hero : knobbly trunk (leaf-base lattice displaced in geometry + shader), cut frond stubs,
//                 every frond as petiole + rachis tubes and 2×~55 individual folded leaflets
//                 (tapered 3-triangle strips mapped onto the straightened-leaflet atlas cell), date clusters
//     LOD1 mid  : trunk (10 sides), each frond as a V of two curved alpha-tested half-frond strips + petiole
//     LOD2 far  : trunk (6 sides), 2 flat strips per frond on ~80% of the fronds
//     (LOD3 = camera-facing impostor painted from `skel`, see palmAtlas.impostorAtlas / library.js)
//   Geometry at nominal size (metres, base at the origin, +Y up); instances scale it.
//
// Attribute contract as src/vegetation/util.js (aFol = ao, tip, rnd, sway; aAux = bark coords in metres).
import { GeoBuilder, v3, rotAxis, clamp, lerp, smoothstep, addBlob } from './util.js';
import { PALM, LEAFY0, leafletProfile } from './palmAtlas.js';
import { Simplex } from '../core/noise.js';
import { RNG, hashString } from '../core/rng.js';

export const PALM_STYLES = ['tall', 'medium', 'young', 'leaning', 'garden', 'tall', 'medium', 'young', 'leaning', 'tall', 'garden', 'medium'];

const D2R = Math.PI / 180;
const UP = [0, 1, 0];

function params(rng, style) {
  const P = {
    style,
    trunkH: rng.range(9, 13.5), r0: rng.range(0.27, 0.33), nFr: rng.int(44, 54), frL: rng.range(4.7, 5.6),
    lean: rng.range(0.01, 0.06), bow: 0, elevTop: 76, elevBot: -36, droop: [0.35, 1.35], dry: rng.int(2, 5),
    dates: rng.chance(0.6) ? rng.int(2, 4) : 0, vAng: rng.range(20, 30), lmax: rng.range(0.17, 0.2),
  };
  if (style === 'medium') Object.assign(P, { trunkH: rng.range(5, 8), nFr: rng.int(42, 50), frL: rng.range(4.3, 5.1), dry: rng.int(1, 3) });
  // r3: young palms read like agaves (stiff upright rosette on the ground) → a short but visible trunk, fewer, longer,
  //     arching fronds (open fountain crown)
  if (style === 'young') Object.assign(P, { trunkH: rng.range(2.6, 4.0), r0: rng.range(0.33, 0.4), nFr: rng.int(28, 34), frL: rng.range(3.8, 4.6), elevTop: 66, elevBot: -24, droop: [0.5, 1.4], dry: rng.int(0, 2), dates: 0, lean: rng.range(0.01, 0.05) });
  if (style === 'leaning') Object.assign(P, { trunkH: rng.range(7.5, 12), lean: rng.range(0.16, 0.3), bow: rng.range(0.5, 0.8), nFr: rng.int(40, 48), dry: rng.int(2, 6) });
  if (style === 'garden') Object.assign(P, { trunkH: rng.range(3.5, 6.5), nFr: rng.int(46, 54), frL: rng.range(4.2, 4.9), dry: 0, lean: rng.range(0, 0.025), droop: [0.35, 1.2], elevBot: -26 });
  return P;
}

// ---------------------------------------------------------------- leaf-base lattice (also in palm trunk GLSL)
const AROUND = 11, CELL_H = 0.13;
const fract = (x) => x - Math.floor(x);
/** shingle height 0..1 at bark coords (au: around, in lattice cells; al: along, metres) */
export function bootH(au, al) {
  const a = au + al / CELL_H, c = -au + al / CELL_H;
  const fa = fract(a), fc = fract(c);
  const v = (fa + fc) * 0.5;
  return Math.pow(v, 1.3) * (1 - smoothstep(0.8, 1.0, v)) * (1 - Math.pow(Math.abs(fa - fc), 2));
}

// opts (r4, hero palms framing a shot): { leafW: leaflet width ×, leafN: leaflets per frond × } — ref 5's overhead
// fronds are dense, broad-leafleted fans; the generic 2×56 thin leaflets read sparse and dark at 2-6 m
export function buildPalm(seed, style = 'tall', opts = {}) {
  const rng = new RNG(`palm:${style}:${seed}`);
  const nz = new Simplex(hashString(`palmN:${seed}`));
  const P = params(rng, style);
  P.leafW = opts.leafW ?? 1; P.leafN = opts.leafN ?? 1;
  const Ht = P.trunkH;

  // ---------------------------------------------------------------- trunk centreline
  const leanA = rng.random() * Math.PI * 2, ld = [Math.cos(leanA), 0, Math.sin(leanA)];
  const wobA = rng.random() * 10;
  const trunkAt = (t) => {
    const y = -0.5 + (Ht + 0.5) * t;
    // leaning palms: strongest lean at the base, the trunk bows back up toward the light ("banana")
    const off = P.lean * Ht * (P.bow ? (t - P.bow * 0.5 * t * t) / (1 - P.bow * 0.5) : t);
    const w = 0.06 * Ht * 0.1 * (nz.noise2(t * 2.3, wobA) );
    return [ld[0] * off + w, y, ld[2] * off + 0.06 * Ht * 0.1 * nz.noise2(wobA, t * 2.3)];
  };
  const radAt = (t) => {
    const y = -0.5 + (Ht + 0.5) * t;
    const flare = 1 + 0.55 * Math.exp(-Math.max(0, y) / 0.35);
    const taper = 1 - 0.12 * t;
    const head = 1 + 0.32 * smoothstep(Ht - 1.4, Ht - 0.2, y);    // swollen crown of fresh leaf bases
    return P.r0 * flare * taper * head;
  };
  const top = trunkAt(1);
  const topDir = v3.norm(v3.sub(trunkAt(1), trunkAt(0.94)));
  const Cc = v3.add(top, [0, 0.35, 0]);       // crown centre (bent normals, AO)
  const rTop = radAt(1);

  // ---------------------------------------------------------------- fronds
  const fronds = [];
  const N = P.nFr;
  for (let i = 0; i < N + P.dry; i++) {
    const dry = i >= N;
    const a = dry ? 1 : i / (N - 1);                                // 0 youngest (top) .. 1 oldest (bottom)
    let elev = dry ? rng.range(-80, -62) : lerp(P.elevTop, P.elevBot, Math.pow(a, 0.85)) + rng.range(-7, 7);
    const az = i * 137.508 * D2R + rng.range(-0.15, 0.15);
    const L = P.frL * (dry ? rng.range(0.85, 1.0) : (0.62 + 0.38 * smoothstep(0, 0.25, a)) * rng.range(0.9, 1.1));
    const droop = dry ? rng.range(0.05, 0.2) : lerp(P.droop[0], P.droop[1], a) * rng.range(0.8, 1.2) * (L / 4.3);
    const hd = [Math.cos(az), 0, Math.sin(az)];
    const drop = dry ? rng.range(0.7, 1.3) : 0.9 * Math.pow(a, 1.2);   // older fronds attach lower on the crown
    const B = v3.add(v3.mad(top, topDir, -drop), v3.mul(hd, rTop * 0.75));
    fronds.push({ i, a, dry, elev: elev * D2R, az, L, droop, hd, B, roll: rng.range(-0.25, 0.25), rnd: rng.random(), strip: dry ? 3 : rng.int(0, 2), side2: rng.int(0, 2), spear: !dry && i < 2 });
  }
  // rachis sample: position + frame at s ∈ [0,1]
  const frame = (f, s) => {
    // integrate the arching direction (closed form is messy; 24 steps is plenty)
    const steps = 24; let p = f.B.slice();
    let d = null;
    for (let k = 0; k < steps; k++) {
      const ss = ((k + 0.5) / steps) * s;
      const el = Math.max(-1.45, f.elev - f.droop * Math.pow(ss, 1.4) * (f.elev > 0 ? 1 : 0.8));
      d = [f.hd[0] * Math.cos(el), Math.sin(el), f.hd[2] * Math.cos(el)];
      p = v3.mad(p, d, (f.L * s) / steps);
    }
    const el = Math.max(-1.45, f.elev - f.droop * Math.pow(s, 1.4) * (f.elev > 0 ? 1 : 0.8));
    const T = v3.norm([f.hd[0] * Math.cos(el), Math.sin(el), f.hd[2] * Math.cos(el)]);
    let Sd = v3.cross(T, UP);
    Sd = v3.len(Sd) < 1e-3 ? [-f.hd[2], 0, f.hd[0]] : v3.norm(Sd);
    let U = v3.norm(v3.cross(Sd, T));
    Sd = v3.norm(v3.add(v3.mul(Sd, Math.cos(f.roll)), v3.mul(U, Math.sin(f.roll))));
    U = v3.norm(v3.cross(Sd, T));
    return { p, T, S: Sd, U };
  };

  let R = 0, H = Ht + 0.5;
  for (const f of fronds) for (let k = 0; k <= 8; k++) { const fr = frame(f, k / 8); R = Math.max(R, Math.hypot(fr.p[0], fr.p[2]) + f.L * P.lmax * 0.5); H = Math.max(H, fr.p[1] + 0.3); }
  const crownR = Math.max(2, R - Math.hypot(top[0], top[2]));

  // shading helpers
  const bent = (p) => v3.norm(v3.add(v3.sub(p, Cc), [0, crownR * 0.25, 0]));
  const aoAt = (p, f) => {
    const d = v3.len(v3.sub(p, Cc)) / crownR;
    const below = smoothstep(0.5, -1.2, (p[1] - Cc[1]) / crownR);
    return clamp((0.28 + 0.72 * smoothstep(0.05, 0.95, d)) * (1 - 0.3 * f.a) * (1 - 0.3 * below), 0.12, 1);
  };
  const tipAt = (f, u) => clamp((1 - f.a) * 0.7 + u * 0.35 - (f.dry ? 1 : 0), 0, 1);
  const swayAt = (f, s) => clamp(s * f.L / 4.5, 0, 1);
  /** mix of the face normal (oriented toward U) and the crown's bent normal */
  const shadeN = (nf, U, p, kFace = 0.6) => {
    if (v3.dot(nf, U) < 0) nf = v3.mul(nf, -1);
    return v3.norm(v3.add(v3.mul(nf, kFace), v3.mul(bent(p), 1 - kFace + 0.15)));
  };

  // ---------------------------------------------------------------- emitters
  function emitTrunk(gb, radial, ringStep, disp) {
    const rings = Math.max(4, Math.round((Ht + 0.5) / ringStep));
    const ids = [];
    let along = 0, prev = null;
    for (let k = 0; k <= rings; k++) {
      const t = k / rings, c = trunkAt(t), r = radAt(t);
      if (prev) along += v3.len(v3.sub(c, prev));
      prev = c;
      const Tn = v3.norm(v3.sub(trunkAt(Math.min(1, t + 0.01)), trunkAt(Math.max(0, t - 0.01))));
      let Nn = v3.norm(v3.cross(Tn, [0, 0, 1])); const Bn = v3.cross(Tn, Nn);
      const yy = c[1];
      const boots = smoothstep(0.6, 2.5, yy) * (0.75 + 0.25 * smoothstep(Ht - 2, Ht - 0.5, yy));
      const fresh = smoothstep(Ht - 1.8, Ht - 0.4, yy);
      const row = [];
      for (let i = 0; i <= radial; i++) {
        const th = (i / radial) * Math.PI * 2;
        const au = (i / radial) * AROUND;
        const dir = v3.add(v3.mul(Nn, Math.cos(th)), v3.mul(Bn, Math.sin(th)));
        const h = disp ? bootH(au, along) : 0.5;
        const rr = r * (1 + (disp ? (0.16 * h - 0.06) * boots + 0.02 * nz.noise3(dir[0] * 2, yy * 0.8, dir[2] * 2) : 0));
        const p = v3.mad(c, dir, rr);
        const ao = clamp(1 - 0.45 * smoothstep(Ht - 1.2, Ht + 0.2, yy), 0.4, 1);
        row.push(gb.v(p[0], p[1], p[2], dir[0], dir[1], dir[2], 0, 0, ao, fresh, 0.5, clamp(yy / Ht, 0, 1) * 0.25, au, along));
      }
      ids.push(row);
    }
    for (let k = 0; k < rings; k++) for (let i = 0; i < radial; i++) gb.quad(ids[k][i], ids[k][i + 1], ids[k + 1][i + 1], ids[k + 1][i]);
    // close the top (hidden by the crown, but keeps the silhouette solid from above)
    const c = gb.v(top[0], top[1] + 0.1, top[2], 0, 1, 0, 0, 0, 0.4, 1, 0.5, 0.25, 0, along);
    for (let i = 0; i < radial; i++) gb.tri(ids[rings][i], ids[rings][i + 1], c);
  }
  /** generic tube (petioles, rachis, stalks, stubs) with uv in an atlas rect */
  function tube(gb, pts, rad, radial, rect, folFn, flat = 1) {
    const n = pts.length; const ids = [];
    for (let k = 0; k < n; k++) {
      const T = v3.norm(v3.sub(pts[Math.min(n - 1, k + 1)], pts[Math.max(0, k - 1)]));
      let Nn = v3.cross(T, UP); Nn = v3.len(Nn) < 1e-3 ? [1, 0, 0] : v3.norm(Nn);
      const Bn = v3.cross(Nn, T);
      const t = k / (n - 1), row = [];
      for (let i = 0; i <= radial; i++) {
        const th = (i / radial) * Math.PI * 2;
        const dir = v3.add(v3.mul(Nn, Math.cos(th)), v3.mul(Bn, Math.sin(th) * flat));
        const p = v3.mad(pts[k], dir, rad[k]);
        const f = folFn(t, pts[k]);
        const nn = v3.norm(dir);
        row.push(gb.v(p[0], p[1], p[2], nn[0], nn[1], nn[2], lerp(rect[0], rect[2], i / radial), lerp(rect[3], rect[1], t), f[0], f[1], f[2], f[3], 0, t));
      }
      ids.push(row);
    }
    for (let k = 0; k < n - 1; k++) for (let i = 0; i < radial; i++) gb.quad(ids[k][i], ids[k][i + 1], ids[k + 1][i + 1], ids[k + 1][i]);
  }
  function emitPetiole(gb, f, stations, radial, sEnd) {
    const pts = [], rad = [];
    for (let k = 0; k <= stations; k++) {
      const s = (k / stations) * sEnd; pts.push(frame(f, s).p);
      rad.push(lerp(0.075, 0.022, Math.pow(s / Math.max(sEnd, 1e-3), 0.6) * (sEnd / Math.max(LEAFY0, sEnd))) * (f.L / 4.3) * (s < 0.03 ? 1.4 : 1));
    }
    tube(gb, pts, rad, radial, PALM.petiole, (t, p) => [aoAt(p, f) * 0.9, 0, f.rnd, swayAt(f, t * sEnd)], 0.6);
  }
  function emitRachis(gb, f, stations, radial) {
    const pts = [], rad = [];
    for (let k = 0; k <= stations; k++) { const s = lerp(LEAFY0, 1, k / stations); pts.push(frame(f, s).p); rad.push(lerp(0.024, 0.005, k / stations) * (f.L / 4.3)); }
    tube(gb, pts, rad, radial, PALM.petiole, (t, p) => [aoAt(p, f), 0.1, f.rnd, swayAt(f, lerp(LEAFY0, 1, t))]);
  }
  function emitLeaflets(gb, f, nPer) {
    const Lmax = P.lmax * f.L * (f.spear ? 0.5 : 1);
    const rect = f.dry ? PALM.leaflet[2] : PALM.leaflet[f.side2 & 1];
    const lr = new RNG(`leaflets:${seed}:${f.i}`);
    for (const sg of [-1, 1]) {
      for (let j = 0; j < nPer; j++) {
        const u = (j + 0.25 + 0.5 * lr.random() + (sg > 0 ? 0.5 : 0)) / nPer;
        const s = LEAFY0 + (1 - LEAFY0) * Math.min(0.995, u);
        const fr = frame(f, s);
        const l = Lmax * leafletProfile(u) * lr.range(0.85, 1.12);
        const alpha = (30 + 16 * (1 - u) + lr.range(-6, 6)) * D2R;
        const plane = j % 3 === 0 ? 30 : j % 3 === 1 ? -6 : 12;
        const beta = (f.spear ? 65 : f.dry ? -50 : P.vAng + plane + lr.range(-8, 8)) * D2R;
        const side = v3.mul(fr.S, sg);
        const dir = v3.norm(v3.add(v3.mul(fr.T, Math.cos(alpha)), v3.mul(v3.add(v3.mul(side, Math.cos(beta)), v3.mul(fr.U, Math.sin(beta))), Math.sin(alpha))));
        const w = 0.042 * P.leafW * (f.L / 4.3) * (1 - 0.35 * u) * lr.range(0.85, 1.15);
        let wd = v3.cross(dir, fr.U); wd = v3.len(wd) < 1e-4 ? fr.S : v3.norm(wd);
        const sag = (f.dry ? 0.05 : 0.16 + 0.08 * u) * l;
        const b = v3.mad(fr.p, fr.U, 0.006);
        const at = (q) => v3.add(v3.mad(b, dir, l * q), [0, -sag * q * q, 0]);
        const m = at(0.42), tp = at(1);
        // fold: a slight V across the leaflet (mid edge raised along U)
        const fold = v3.mul(fr.U, w * 0.18);
        const p0 = v3.mad(b, wd, -w * 0.28), p1 = v3.mad(b, wd, w * 0.28);
        const p2 = v3.add(v3.mad(m, wd, -w * 0.5), fold), p3 = v3.add(v3.mad(m, wd, w * 0.5), fold);
        const nf = v3.norm(v3.cross(wd, dir));
        const nA = shadeN(v3.norm(v3.mad(nf, wd, -0.45)), fr.U, m), nB = shadeN(v3.norm(v3.mad(nf, wd, 0.45)), fr.U, m), nT = shadeN(nf, fr.U, tp);
        const ao = aoAt(m, f), tip = tipAt(f, u), sw0 = swayAt(f, s);
        const vb = rect[3], vm = lerp(rect[3], rect[1], 0.42), vt = rect[1];
        const i0 = gb.v(...p0, ...nA, rect[0], vb, ao * 0.8, tip * 0.6, f.rnd, sw0);
        const i1 = gb.v(...p1, ...nB, rect[2], vb, ao * 0.8, tip * 0.6, f.rnd, sw0);
        const i2 = gb.v(...p2, ...nA, rect[0], vm, ao, tip, f.rnd, sw0 + 0.05);
        const i3 = gb.v(...p3, ...nB, rect[2], vm, ao, tip, f.rnd, sw0 + 0.05);
        const i4 = gb.v(...tp, ...nT, (rect[0] + rect[2]) / 2, vt, Math.min(1, ao * 1.1), Math.min(1, tip + 0.2), f.rnd, sw0 + 0.12);
        gb.tri(i0, i1, i3); gb.tri(i0, i3, i2); gb.tri(i2, i3, i4);
      }
    }
  }
  /** V of two curved half-frond strips (LOD1: 3 verts across, LOD2: 2) */
  function emitFrondCards(gb, f, stations, across, wk = 1) {
    const Lmax = P.lmax * f.L * (f.spear ? 0.55 : 1);
    const W = Lmax * 0.92 * wk;
    for (const sg of [-1, 1]) {
      const rect = PALM.strip[f.dry ? 3 : sg < 0 ? f.strip : (f.strip + 1 + f.side2) % 3];
      const ids = [];
      const beta = (f.spear ? 62 : f.dry ? -55 : P.vAng + 6) * D2R;
      for (let k = 0; k <= stations; k++) {
        const s = lerp(LEAFY0 * 0.85, 1, k / stations);
        const fr = frame(f, s);
        const side = v3.mul(fr.S, sg);
        const out = v3.norm(v3.add(v3.mul(side, Math.cos(beta)), v3.mul(fr.U, Math.sin(beta))));
        // the strip's outer edge leans forward a little (leaflets point toward the tip) and sags
        const row = [];
        for (let j = 0; j < across; j++) {
          const q = j / (across - 1);
          const p = v3.add(v3.mad(v3.mad(fr.p, out, W * q), fr.T, W * 0.12 * q), [0, -W * (f.dry ? 0.05 : 0.22) * q * q, 0]);
          const nf = v3.norm(v3.cross(fr.T, out));
          const n = shadeN(nf, fr.U, p, 0.5);
          const u = (s - LEAFY0) / (1 - LEAFY0);
          row.push(gb.v(p[0], p[1], p[2], n[0], n[1], n[2], lerp(rect[0], rect[2], s), lerp(rect[3], rect[1], q), aoAt(p, f) * (0.9 + 0.1 * q), tipAt(f, clamp(u, 0, 1)) * (0.6 + 0.4 * q), f.rnd, swayAt(f, s)));
        }
        ids.push(row);
      }
      for (let k = 0; k < stations; k++) for (let j = 0; j < across - 1; j++) gb.quad(ids[k][j], ids[k + 1][j], ids[k + 1][j + 1], ids[k][j + 1]);
    }
  }
  function emitStubs(gb, n) {
    const r2 = new RNG(`stubs:${seed}`);
    for (let i = 0; i < n; i++) {
      const az = i * 2.4 + r2.random() * 0.5, y = Ht - 1.6 - r2.random() * 1.6;
      const t = (y + 0.5) / (Ht + 0.5);
      const c = trunkAt(t), r = radAt(t);
      const hd = [Math.cos(az), 0, Math.sin(az)];
      const d = v3.norm([hd[0], 0.9, hd[2]]);
      const b = v3.mad(c, hd, r * 0.85);
      const L = r2.range(0.18, 0.32);
      tube(gb, [b, v3.mad(b, d, L * 0.6), v3.mad(b, d, L)], [0.07, 0.055, 0.03], 5, PALM.fibre, () => [0.6, 0.6, r2.random(), 0.2], 0.55);
    }
  }
  function emitDates(blob, card, nClusters, lon) {
    const r2 = new RNG(`dates:${seed}`);
    for (let i = 0; i < nClusters; i++) {
      const az = r2.random() * Math.PI * 2, hd = [Math.cos(az), 0, Math.sin(az)];
      const b = v3.add(v3.mad(top, topDir, -0.5), v3.mul(hd, rTop * 0.9));
      const tip = v3.add(b, [hd[0] * 0.6, -0.3, hd[2] * 0.6]);
      tube(card, [b, v3.add(b, [hd[0] * 0.45, 0.05, hd[2] * 0.45]), tip], [0.03, 0.025, 0.02], 4, PALM.petiole, () => [0.5, 0.2, 0.3, 0.3]);
      // a bunch of 5-8 hanging strands of fruit
      const ns = r2.int(5, 8);
      for (let k = 0; k < ns; k++) {
        const a2 = r2.random() * Math.PI * 2, o = [Math.cos(a2) * 0.09, -r2.random() * 0.12, Math.sin(a2) * 0.09];
        const c = v3.add(v3.add(tip, o), [0, -0.2, 0]);
        const ax = v3.norm([o[0] * 2, 1, o[2] * 2]), b1 = v3.norm(v3.cross(ax, [0, 0, 1])), b2 = v3.cross(ax, b1);
        addBlob(blob, c, ax, b1, b2, 0.2, 0.075, 0.07, {
          lon: lon, lat: 3, rect: PALM.dates, lump: 0.5, noise: nz, seed: i * 3.1 + k,
          normalFn: (p, nl) => nl, fol: (p, nl, ph) => [0.45 + 0.5 * ph, 0.0, 0.5, 0.3],
        });
      }
    }
  }

  const lods = [];
  const fin = (bark, blob, card) => ({ bark: bark.count ? bark.build() : null, blob: blob.count ? blob.build() : null, card: card.count ? card.build() : null, tris: bark.triangles + blob.triangles + card.triangles });
  // LOD0
  {
    const bark = new GeoBuilder(), blob = new GeoBuilder(), card = new GeoBuilder();
    emitTrunk(bark, 18, 0.07, true);
    emitStubs(bark, Math.round(Ht > 3 ? 14 : 4));
    for (const f of fronds) {
      emitPetiole(card, f, 5, 5, LEAFY0 + 0.02);
      emitRachis(card, f, 10, 3);
      emitLeaflets(card, f, Math.round((f.dry ? 34 : 56) * P.leafN));
    }
    if (P.dates) emitDates(blob, card, P.dates, 7);
    lods.push(fin(bark, blob, card));
  }
  // LOD1
  {
    const bark = new GeoBuilder(), blob = new GeoBuilder(), card = new GeoBuilder();
    emitTrunk(bark, 10, 0.35, true);
    for (const f of fronds) { emitPetiole(card, f, 2, 3, LEAFY0); emitFrondCards(card, f, 8, 3); }
    if (P.dates) emitDates(blob, card, P.dates, 5);
    lods.push(fin(bark, blob, card));
  }
  // LOD2
  {
    const bark = new GeoBuilder(), blob = new GeoBuilder(), card = new GeoBuilder();
    emitTrunk(bark, 6, Math.max(1.2, Ht / 5), false);
    const r2 = new RNG(`lod2:${seed}`);
    for (const f of fronds) { if (f.dry && r2.chance(0.6)) continue; if (!f.dry && f.i > 3 && r2.chance(0.15)) continue; emitFrondCards(card, f, 4, 2, 1.12); }
    lods.push(fin(bark, blob, card));
  }

  // skeleton for the impostor painter (side view)
  const skel = {
    trunk: [], trunkR: [],
    fronds: fronds.map((f) => {
      const pts = [], reach = [];
      for (let k = 0; k <= 8; k++) { const s = lerp(LEAFY0 * 0.8, 1, k / 8); pts.push(frame(f, s).p); reach.push(P.lmax * f.L * 0.7 * leafletProfile(clamp((s - LEAFY0) / (1 - LEAFY0), 0, 1))); }
      return { pts, reach, dry: f.dry };
    }),
  };
  for (let k = 0; k <= 10; k++) { const t = k / 10; skel.trunk.push(trunkAt(t)); skel.trunkR.push(radAt(t)); }
  return { H, R, Ht, style, lods, skel, crownR, top };
}
