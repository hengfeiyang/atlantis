// Far-field height grid (the alpine range): lowland + mountains.
//  1. coarse tectonic-uplift / fluvial-erosion equilibrium (stream power, Braun & Willett implicit
//     scheme) driven by the massif envelope → real dendritic valley networks, main divides, spurs;
//  2. per-massif relief rescale to the composition envelope (heightfield.js PEAKS ← layout.MOUNTAINS);
//  3. bicubic upsample + glacial shaping (cirque bowls / U-valley floors below the crests);
//  4. slope-steered gully filter (couloirs and rock ribs that branch downhill, after Fewes / Johansen),
//     jagged crest teeth, faint strata steps;
//  5. fine erosion (incision, altitude-dependent talus, droplets) and crest sharpening;
//  6. water / near field / domain border kept as designed.
// Baked by `node tools/bake.mjs terrain` → generated/terrain-far-<ver>.bin; built at low resolution
// at runtime if the bake is missing. No three.js import (node + browser).
import { farLand, mountainEnvelope, waterSDF, farWeight, heroAt, HERO } from '../world/heightfield.js';
import { streamPower, thermal, droplets } from './erosion.js';
import { mulberry32 } from '../core/rng.js';
import { ACROPOLIS } from '../world/layout.js';
import { Simplex } from '../core/noise.js';

export const FAR_VERSION = 'v11'; // r3: multi-summit hero massif + front peak + N pyramid (ref 2)
/** grid domain (metres) */
export const FAR_DOMAIN = { x0: -24576, z0: -23552, x1: 20480, z1: 10240 };
/** bake parameters (see generateFarGrid) */
export const FAR_DEFAULTS = {
  cell: 16, coarse: 64, U0: 100, K: 0.2, spIters: 50, ctalus: 4, cthIters: 1, fill: 0.35,
  cRidge: 0.3, cRidgeLen: 800, cEnforce: 12, cTalus2: 1.1,
  rDetail: 0.07, rdLen: 1800, gAmp: 32, gLen: 420, gSteer: 1.2, teeth: 120, teethLen: 200, ice: 0.6,
  fineIters: 3, fineK: 0.0006, ftalusHi: 0.35, drops: 0.25, dCap: 1, dEro: 0.05, terr: 0.5, sharpen: 0.35,
  // hero massif: calmer sub-massif noise (clean faces + arêtes), fuller firn fields, less fine ridged detail
  heroCalm: 0.75, heroCalmT: 0.7, heroTeethLen: 1.0, heroGully: 0, heroIce: 1.2, heroDetail: 0.7, heroSharpen2: 0.15,
};

const AC = ACROPOLIS.center;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function boxBlur(src, nx, nz, r, passes = 3) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < nz; j++) {
      let acc = 0; const row = j * nx;
      for (let i = -r; i <= r; i++) acc += a[row + Math.min(nx - 1, Math.max(0, i))];
      for (let i = 0; i < nx; i++) {
        b[row + i] = acc / (2 * r + 1);
        acc += a[row + Math.min(nx - 1, i + r + 1)] - a[row + Math.max(0, i - r)];
      }
    }
    for (let i = 0; i < nx; i++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += b[Math.min(nz - 1, Math.max(0, j)) * nx + i];
      for (let j = 0; j < nz; j++) {
        a[j * nx + i] = acc / (2 * r + 1);
        acc += b[Math.min(nz - 1, j + r + 1) * nx + i] - b[Math.max(0, j - r) * nx + i];
      }
    }
  }
  return a;
}

function cubic(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}
function sampleCubic(g, nx, nz, fx, fz) {
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const row = (jj) => {
    const J = Math.min(nz - 1, Math.max(0, jj)) * nx;
    const v = (ii) => g[J + Math.min(nx - 1, Math.max(0, ii))];
    return cubic(v(i - 1), v(i), v(i + 1), v(i + 2), tx);
  };
  return cubic(row(j - 1), row(j), row(j + 1), row(j + 2), tz);
}

// ------------------------------------------------------------ gully filter
// Sum of gabor-like stripes from jittered cell points, oriented so the stripes run DOWNHILL
// (phase varies across the slope). Returns value in [-1,1] and its gradient (per unit of p).
const TAU = Math.PI * 2;
function hash2(i, j, seed) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  const a = (h >>> 0) / 4294967296;
  h = Math.imul(h ^ 0x9e3779b9, 1597334677); h ^= h >>> 15;
  return [a, (h >>> 0) / 4294967296];
}
const _G = { v: 0, gx: 0, gz: 0 };
function gullyOctave(px, pz, dx, dz, seed) {
  // (dx,dz): unit vector ACROSS the slope (perpendicular to the gradient)
  const ix = Math.floor(px), iz = Math.floor(pz), fx = px - ix, fz = pz - iz;
  let v = 0, gx = 0, gz = 0, wt = 0;
  for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) {
    const h = hash2(ix + i, iz + j, seed);
    const ppx = fx - i - (h[0] - 0.5) * 0.9, ppz = fz - j - (h[1] - 0.5) * 0.9;
    const w = Math.exp(-(ppx * ppx + ppz * ppz) * 2.0);
    const ph = (ppx * dx + ppz * dz) * TAU;
    const s = Math.sin(ph) * w * TAU;
    v += Math.cos(ph) * w; gx -= s * dx; gz -= s * dz; wt += w;
  }
  _G.v = v / wt; _G.gx = gx / wt; _G.gz = gz / wt;
  return _G;
}

/**
 * @param {object} o { cell=16, coarse=48, erode=true, domain, log, spIters, stage }
 * @returns {{x0,z0,cell,nx,nz,data:Float32Array}}
 */
export function generateFarGrid(opts = {}) {
  const o = { ...FAR_DEFAULTS, ...opts };
  const log = o.log || (() => {});
  const D = o.domain || FAR_DOMAIN;
  const t0 = Date.now();
  // ------------------------------------------------ 1. coarse uplift/erosion equilibrium
  const cc = o.coarse ?? 48;
  const cnx = Math.floor((D.x1 - D.x0) / cc) + 1, cnz = Math.floor((D.z1 - D.z0) / cc) + 1, CN = cnx * cnz;
  const E = new Float32Array(CN), Lc = new Float32Array(CN), hc = new Float32Array(CN);
  let emax = 1;
  for (let j = 0; j < cnz; j++) for (let i = 0; i < cnx; i++) {
    const x = D.x0 + i * cc, z = D.z0 + j * cc, c = j * cnx + i;
    E[c] = mountainEnvelope(x, z); Lc[c] = farLand(x, z);
    if (E[c] > emax) emax = E[c];
  }
  const nA = new Simplex(77), nB = new Simplex(78), nC = new Simplex(79), nD = new Simplex(80);
  const U = new Float32Array(CN), Kmap = new Float32Array(CN), active = new Uint8Array(CN);
  // ridged multifractal (domain-warped): arêtes / horns pattern inside the massifs
  const RG = new Float32Array(CN);
  let rmin = 1e9, rmax = -1e9;
  for (let c = 0; c < CN; c++) {
    if (E[c] <= 20) continue;
    const i = c % cnx, j = (c - i) / cnx, x = D.x0 + i * cc, z = D.z0 + j * cc;
    const wl = o.rLen ?? 3200;
    const wx = x + 0.25 * wl * nC.fbm2(x / (wl * 1.6), z / (wl * 1.6), 3), wz = z + 0.25 * wl * nD.fbm2(x / (wl * 1.6) + 5.2, z / (wl * 1.6), 3);
    RG[c] = nA.ridged2(wx / wl, wz / wl, o.rOct ?? 6, 2.0, o.rGain ?? 0.5, 1.0);
    rmin = Math.min(rmin, RG[c]); rmax = Math.max(rmax, RG[c]);
  }
  for (let c = 0; c < CN; c++) RG[c] = E[c] > 20 ? (RG[c] - rmin) / (rmax - rmin) : 0;
  for (let c = 0; c < CN; c++) {
    const i = c % cnx, j = (c - i) / cnx, x = D.x0 + i * cc, z = D.z0 + j * cc;
    active[c] = E[c] > 20 ? 1 : 0;
    const rgf = (o.rBase ?? 0.3) + (1 - (o.rBase ?? 0.3)) * Math.pow(RG[c], o.rPow ?? 1.0);
    hc[c] = Lc[c] + (active[c] ? 30 * nA.fbm2(x / 900, z / 900, 4) + E[c] * (o.init === 'ridged' ? rgf : 0.05) : 0);
    // uplift follows the envelope; rock strength (erodibility) varies in broad patches
    U[c] = (o.U0 ?? 100) * Math.pow(E[c] / emax, o.upow ?? 1.5) * (o.init === 'ridged' ? rgf : 1);
    Kmap[c] = (o.K ?? 0.2) * (1 + 0.45 * nB.fbm2(x / 2600, z / 2600, 3));
  }
  const iters = o.spIters ?? 60;
  for (let it = 0; it < iters; it++) {
    streamPower(hc, cnx, cnz, cc, { iters: 1, K: Kmap, U, m: o.m ?? 0.5, baseLevel: -1e9, active, Acrit: o.Acrit ?? 0 });
    thermal(hc, cnx, cnz, cc, { iters: o.cthIters ?? 3, talus: o.ctalus ?? 0.8, rate: 0.5 });
  }
  log(`[far] coarse equilibrium ${cnx}x${cnz} (${iters} it) in ${Date.now() - t0} ms`);
  // per-massif rescale of the relief to the composition envelope
  const rel = new Float32Array(CN);
  for (let c = 0; c < CN; c++) rel[c] = Math.max(0, hc[c] - Lc[c]);
  const rb = Math.max(2, Math.round(1400 / cc));
  // local maximum relief (dilate) vs the envelope: summits reach the envelope height
  const mx = new Float32Array(CN), tmp = new Float32Array(CN);
  for (let j = 0; j < cnz; j++) for (let i = 0; i < cnx; i++) { let m = 0; for (let q = Math.max(0, i - rb); q <= Math.min(cnx - 1, i + rb); q++) m = Math.max(m, rel[j * cnx + q]); tmp[j * cnx + i] = m; }
  for (let j = 0; j < cnz; j++) for (let i = 0; i < cnx; i++) { let m = 0; for (let q = Math.max(0, j - rb); q <= Math.min(cnz - 1, j + rb); q++) m = Math.max(m, tmp[q * cnx + i]); mx[j * cnx + i] = m; }
  const mxs = boxBlur(mx, cnx, cnz, rb, 2), eS = boxBlur(E, cnx, cnz, Math.round(rb / 2), 2);
  const pw = o.relPow ?? 1.15;
  { let sS = 0, sN = 0; for (let c = 0; c < CN; c++) if (active[c] && eS[c] > 1500) { sS += eS[c] * 1.04 / Math.max(mxs[c], 30); sN++; } log(`[far] relief rescale mean x${(sS / Math.max(1, sN)).toFixed(2)}`); }
  for (let c = 0; c < CN; c++) {
    if (!active[c]) continue;
    const A = Math.max(mxs[c], 30);
    const t = Math.min(1.25, rel[c] / A);
    rel[c] = eS[c] * 1.04 * Math.pow(t, pw);
    // raise the valley floors inside the massifs (hanging valleys, cirques): ridges unchanged
    const fl = o.fill ?? 0.3, tt = Math.min(1, t);
    rel[c] += fl * eS[c] * (1 - tt) * (1 - tt) * sstep(1100, 2600, eS[c]);
  }
  // hero massif (layout MOUNTAINS.hero): its designed pyramid + arêtes is not grown by uplift but
  // incised: a short stream-power run without uplift (channel-head threshold, so the hillslopes and crests
  // keep their designed heights) cuts dendritic valleys and couloirs between the spurs
  const heroM = new Float32Array(CN); // 0..1 hero massif mask (less sub-massif noise / teeth: clean faces and arêtes)
  if (HERO && (o.heroIters ?? 30) > 0) {
    const t7 = Date.now();
    const hh = new Float32Array(CN), act = new Uint8Array(CN), EH = new Float32Array(CN);
    for (let c = 0; c < CN; c++) {
      const i = c % cnx, j = (c - i) / cnx, x = D.x0 + i * cc, z = D.z0 + j * cc;
      const e = heroAt(x, z); EH[c] = e; heroM[c] = sstep(150, 900, e);
      if (e < 15) { hh[c] = Lc[c]; continue; }
      act[c] = 1;
      // seed relief: ridged noise ∝ height (irregular drainage, sub-summits along the crests)
      const rg = nB.ridged2(x / 1700 + 0.4 * nC.noise2(x / 3000, z / 3000), z / 1700, 4, 2.0, 0.5, 1.0);
      hh[c] = Lc[c] + e * (1 + (o.heroRough ?? 0.08) * (rg - 0.35) * Math.min(1, e / 600)) + 25 * nA.fbm2(x / 500, z / 500, 3);
    }
    for (let it = 0; it < (o.heroIters ?? 30); it++) {
      streamPower(hh, cnx, cnz, cc, { iters: 1, K: o.heroK ?? 0.008, U: 0, m: 0.5, baseLevel: -1e9, active: act, Acrit: o.heroAcrit ?? 2e5 });
      thermal(hh, cnx, cnz, cc, { iters: 1, talus: 1.05, rate: 0.5 });
    }
    let hmax = 0;
    for (let c = 0; c < CN; c++) {
      if (!act[c]) continue;
      const r = Math.max(0, hh[c] - Lc[c]);
      // soft max with the range relief (the hero rises out of it)
      const a = rel[c], k = 120, d = r - a, hk = Math.min(1, Math.max(0, 0.5 + 0.5 * d / k));
      rel[c] = a + d * hk + k * hk * (1 - hk) * 0.5;
      if (hh[c] > hmax) hmax = hh[c];
    }
    log(`[far] hero carved in ${Date.now() - t7} ms (summit ${Math.round(hmax)} m)`);
  }
  // sub-massif ruggedness: ridged multifractal (arêtes, horns, sub-summits, spurs) ∝ relief; the
  // talus enforcement below turns its crests into sharp-edged pyramidal facets
  if ((o.cRidge ?? 0) > 0) {
    const wl = o.cRidgeLen ?? 1000;
    for (let c = 0; c < CN; c++) {
      if (!active[c] || rel[c] < 50) continue;
      const i = c % cnx, j = (c - i) / cnx, x = D.x0 + i * cc, z = D.z0 + j * cc;
      const wx = x + 0.35 * wl * nC.fbm2(x / (wl * 2.5), z / (wl * 2.5), 2), wz = z + 0.35 * wl * nD.fbm2(x / (wl * 2.5) + 7.7, z / (wl * 2.5), 2);
      const rg = nB.ridged2(wx / wl, wz / wl, 4, 2.1, 0.55, 1.0);
      rel[c] += (rg - (o.cRidgeMid ?? 0.345)) * o.cRidge * (1 - (o.heroCalm ?? 0.45) * heroM[c]) * rel[c] * sstep(50, 900, rel[c]);
    }
  }
  // enforce the angle of repose on the rescaled relief (no 60°+ walls at the 100 m scale)
  if ((o.cEnforce ?? 30) > 0) {
    const hh = new Float32Array(CN); for (let c = 0; c < CN; c++) hh[c] = Lc[c] + rel[c];
    thermal(hh, cnx, cnz, cc, { iters: o.cEnforce ?? 30, talus: o.cTalus2 ?? 0.78, rate: 0.5 });
    for (let c = 0; c < CN; c++) rel[c] = Math.max(0, hh[c] - Lc[c]);
  }
  if (o.stage === 'coarse') return { x0: D.x0, z0: D.z0, cell: cc, nx: cnx, nz: cnz, data: Float32Array.from(rel, (r, c) => Lc[c] + r) };
  // ------------------------------------------------ 2. upsample to the fine grid
  const cell = o.cell ?? 16;
  const nx = Math.floor((D.x1 - D.x0) / cell) + 1, nz = Math.floor((D.z1 - D.z0) / cell) + 1, N = nx * nz;
  const h = new Float32Array(N), base = new Float32Array(N), R = new Float32Array(N), mtn = new Float32Array(N), hm = new Float32Array(N);
  for (let j = 0; j < nz; j++) {
    const z = D.z0 + j * cell, fz = (z - D.z0) / cc;
    for (let i = 0; i < nx; i++) {
      const x = D.x0 + i * cell, fx = (x - D.x0) / cc, c = j * nx + i;
      const L = farLand(x, z);
      base[c] = L;
      const r = Math.max(0, sampleCubic(rel, cnx, cnz, fx, fz));
      R[c] = r;
      mtn[c] = sstep(30, 350, sampleCubic(E, cnx, cnz, fx, fz));
      hm[c] = Math.min(1, Math.max(0, sampleCubic(heroM, cnx, cnz, fx, fz)));
      // ridged multifractal detail ∝ relief: sharp branching crests, spurs and buttresses
      let dr = 0;
      if (r > 20 && (o.rDetail ?? 0.3) > 0) {
        const wl = o.rdLen ?? 1500;
        const wx = x + 0.3 * wl * nC.fbm2(x / (wl * 2), z / (wl * 2), 2), wz = z + 0.3 * wl * nD.fbm2(x / (wl * 2) + 3.7, z / (wl * 2), 2);
        dr = (nB.ridged2(wx / wl, wz / wl, o.rdOct ?? 5, 2.0, o.rdGain ?? 0.5, 1.0) - (o.rdMid ?? 0.33)) * (o.rDetail ?? 0.3) * r * sstep(20, 400, r) * (1 - (o.heroDetail ?? 0) * hm[c]);
      }
      h[c] = L + r + dr;
    }
  }
  log(`[far] upsampled ${nx}x${nz} in ${Date.now() - t0} ms`);
  if (o.stage === 'up') return { x0: D.x0, z0: D.z0, cell, nx, nz, data: h };
  // ------------------------------------------------ 3. gully filter steered by the smoothed slope
  const t1 = Date.now();
  const sm = boxBlur(h, nx, nz, Math.max(1, Math.round(48 / cell)), 2);
  const oct = o.gOct ?? 4, L0 = o.gLen ?? 640, A0 = o.gAmp ?? 95, gain = o.gGain ?? 0.48, steer = o.gSteer ?? 0.9;
  for (let j = 1; j < nz - 1; j++) {
    const z = D.z0 + j * cell;
    for (let i = 1; i < nx - 1; i++) {
      const c = j * nx + i;
      if (R[c] < 40) continue;
      const x = D.x0 + i * cell;
      const sx = (sm[c + 1] - sm[c - 1]) / (2 * cell), sz = (sm[c + nx] - sm[c - nx]) / (2 * cell);
      const S = Math.hypot(sx, sz);
      // strongest on steep upper faces, faint on gentle ground and in the lowland
      const amp = sstep(0.12, 0.55, S) * sstep(60, 700, R[c]);
      if (amp <= 0) continue;
      let gx = sx, gz = sz, val = 0, A = A0, Lk = L0;
      // domain warp so stripe cells don't align
      const wx = x + 120 * nC.noise2(x / 700, z / 700), wz = z + 120 * nD.noise2(x / 700, z / 700);
      for (let k = 0; k < oct; k++) {
        const gl = Math.hypot(gx, gz) + 1e-6;
        const G = gullyOctave(wx / Lk, wz / Lk, -gz / gl, gx / gl, 11 + k);
        val += A * G.v;
        gx = sx + steer * (gx - sx) + A * G.gx / Lk; gz = sz + steer * (gz - sz) + A * G.gz / Lk;
        A *= gain; Lk *= 0.5;
      }
      h[c] += val * amp * (1 + (o.heroGully ?? 0) * hm[c]);
    }
  }
  log(`[far] gullies in ${Date.now() - t1} ms`);
  if (o.stage === 'gully' || o.erode === false) return { x0: D.x0, z0: D.z0, cell, nx, nz, data: h };
  // ------------------------------------------------ 4. fine erosion
  const fa = new Uint8Array(N);
  for (let c = 0; c < N; c++) fa[c] = mtn[c] > 0.02 ? 1 : 0;
  const t2 = Date.now();
  streamPower(h, nx, nz, cell, { iters: o.fineIters ?? 2, K: o.fineK ?? 2.0e-4, m: 0.5, baseLevel: -1e9, active: fa });
  log(`[far] fine incision in ${Date.now() - t2} ms`);
  const tal = new Float32Array(N);
  for (let c = 0; c < N; c++) tal[c] = (o.ftalus ?? 0.8) + (o.ftalusHi ?? 0.45) * sstep(800, 2000, h[c]);
  thermal(h, nx, nz, cell, { iters: 5, talus: tal, rate: 0.25 });
  if ((o.drops ?? 0.2) > 0) {
    const t3 = Date.now();
    droplets(h, nx, nz, cell, mulberry32(4242), { count: Math.round(N * (o.drops ?? 0.2)), mask: mtn, radius: o.dRad ?? 3, maxSteps: 80, capacity: o.dCap ?? 1.5, erode: o.dEro ?? 0.1, deposit: 0.2 });
    log(`[far] droplets in ${Date.now() - t3} ms`);
  }
  // crest teeth (after the talus relaxation so they stay sharp): jagged sub-summits, gendarmes and
  // towers along the convex ridges
  if ((o.teeth ?? 0) > 0) {
    const t6 = Date.now();
    const bt = boxBlur(h, nx, nz, Math.max(2, Math.round(120 / cell)), 2);
    for (let j = 0; j < nz; j++) {
      const z = D.z0 + j * cell;
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (R[c] < 300) continue;
        const x = D.x0 + i * cell;
        const ridge = sstep(0, o.teethCv ?? 45, h[c] - bt[c]);
        if (ridge <= 0) continue;
        const wl = (o.teethLen ?? 260) * (1 + (o.heroTeethLen ?? 0) * hm[c]);
        const tt = nC.ridged2(x / wl + 0.31 * nD.noise2(x / 900, z / 900), z / wl, 3, 2.1, 0.5, 1.0);
        h[c] += o.teeth * ridge * (tt - 0.34) * sstep(300, 1100, R[c]) * (1 - (o.heroCalmT ?? o.heroCalm ?? 0.45) * hm[c]);
      }
    }
    log(`[far] teeth in ${Date.now() - t6} ms`);
  }
  // strata: dipping bedding planes turn steep faces into ledges (snow bands) and risers (dark rock)
  if ((o.terr ?? 0.6) > 0) {
    const t4 = Date.now();
    const sm2 = boxBlur(h, nx, nz, 1, 1);
    for (let j = 1; j < nz - 1; j++) {
      const z = D.z0 + j * cell;
      for (let i = 1; i < nx - 1; i++) {
        const c = j * nx + i;
        if (R[c] < 300) continue;
        const sx = (sm2[c + 1] - sm2[c - 1]) / (2 * cell), sz = (sm2[c + nx] - sm2[c - nx]) / (2 * cell);
        const S = Math.hypot(sx, sz);
        const tw = (o.terr ?? 0.6) * sstep(0.45, 1.0, S) * sstep(300, 1100, R[c]) * (0.55 + 0.45 * sstep(-0.3, 0.4, nB.noise2((D.x0 + i * cell) / 2500, z / 2500)));
        if (tw <= 0) continue;
        const x = D.x0 + i * cell;
        const th = 6.2831 * nA.noise2(x / 9000, z / 9000), dip = 0.08 + 0.10 * (0.5 + 0.5 * nC.noise2(x / 7000 + 3, z / 7000));
        const st = (o.tStep ?? 46) * (0.8 + 0.4 * (0.5 + 0.5 * nD.noise2(x / 3000, z / 3000)));
        const u = (h[c] + (x * Math.cos(th) + z * Math.sin(th)) * dip + 0.3 * st * nC.fbm2(x / 600, z / 600, 2)) / st;
        const fr = u - Math.floor(u);
        const drop = (Math.pow(fr, o.tPow ?? 2.6) - fr) * st; // ledge (flat) for most of the step, riser near its top
        h[c] += drop * tw;
      }
    }
    log(`[far] strata in ${Date.now() - t4} ms`);
  }
  // glaciers / firn: above the equilibrium line, hollows (cirques, high valleys, ledges) fill up to a
  // smooth ice surface, leaving the ridges, buttresses and arêtes as steep rock poking out of snowfields
  if ((o.ice ?? 1) > 0) {
    const t5 = Date.now();
    const G = boxBlur(h, nx, nz, Math.max(2, Math.round((o.iceR ?? 340) / cell / 1.7)), 3);
    const ela = o.ela ?? 1650;
    for (let j = 0; j < nz; j++) {
      const z = D.z0 + j * cell;
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (R[c] < 400) continue;
        const x = D.x0 + i * cell;
        const n1 = nA.fbm2(x / 1800, z / 1800, 3), n2 = nB.noise2(x / 450, z / 450);
        const surf = G[c] - (o.iceDepth ?? 38) * (1 + 0.6 * n1) + 12 * n2;
        // hero massif: fuller glaciers / firn fields (refs: continuous snowfields between the arêtes)
        const gw = Math.min(1, (o.ice ?? 1) * (1 + (o.heroIce ?? 0.6) * hm[c])) * sstep(ela - 350 + 250 * n1 - 200 * hm[c], ela + 150 + 250 * n1 - 200 * hm[c], surf);
        const d = surf - h[c];
        if (d > 0 && gw > 0) h[c] += (d * d / (d + 12)) * gw;
      }
    }
    log(`[far] ice in ${Date.now() - t5} ms`);
  }
  // crest sharpening (unsharp mask on the relief)
  const bl = boxBlur(h, nx, nz, 2, 2);
  for (let c = 0; c < N; c++) h[c] += (h[c] - bl[c]) * (o.sharpen ?? 0.35) * (1 + (o.heroSharpen ?? 0.6) * hm[c]) * mtn[c];
  // hero: second, wider unsharp pass (~150 m) → knife-edge arêtes and planar faces instead of rounded crests
  if ((o.heroSharpen2 ?? 0) > 0) {
    const bl2 = boxBlur(h, nx, nz, 4, 2);
    for (let c = 0; c < N; c++) if (hm[c] > 0) h[c] += (h[c] - bl2[c]) * o.heroSharpen2 * hm[c];
  }
  // ------------------------------------------------ 5. keep water and the near field as designed, fade at the border
  for (let j = 0; j < nz; j++) {
    const z = D.z0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = D.x0 + i * cell, c = j * nx + i;
      const border = Math.min(i, j, nx - 1 - i, nz - 1 - j) * cell;
      let k = sstep(0, 1500, border) * farWeight(x, z);
      let r = (h[c] - base[c]) * k;
      // water stays water; relief next to water is capped at a ~43° coastal slope (no walls)
      if (r > 0) {
        // (beyond ~5-8 km the cap fades out: distant headlands may rise straight from the open sea)
        const kk = 1 - sstep(5000, 8000, Math.hypot(x - AC[0], z - AC[1]));
        const w = kk > 0 ? waterSDF(x, z) : 1e9;
        if (w < 3500) { if (kk > 0) { const cap = Math.max(0, w - 40) * 0.95; const hh = Math.min(1, Math.max(0, 0.5 + 0.5 * (cap - r) / 60)); const rc = Math.max(0, cap + (r - cap) * hh - 60 * hh * (1 - hh)); r = r + (rc - r) * kk; } }
      }
      h[c] = base[c] + r;
    }
  }
  log(`[far] total ${Date.now() - t0} ms`);
  return { x0: D.x0, z0: D.z0, cell, nx, nz, data: h };
}
