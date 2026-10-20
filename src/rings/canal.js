// Sea-canal works: the covered tunnel through land ring 1 (ref 4), the embanked canal through land ring 2
// (quays, water stairs, spouts, balustraded promenade, stoas — ref 2), the two moles with rip-rap and the
// lighthouses at the sea mouth (ref 1).
import * as THREE from 'three';
import { Frame, chamferBox, box, sweep, lathe, FACES, AUX_ASHLAR, AUX_PAVING, mul3, frameXZ, GeoBuilder } from './geo.js';
import { polarXZ } from './plan.js';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { ruined, ruinRand } from '../world/era.js';
import { noiseA } from '../core/noise.js';

const D2R = Math.PI / 180;
const tone = (rng, k = 0.05) => { const v = 1 - k + 2 * k * rng.random(); return [v, v, v * (0.985 + 0.03 * rng.random())]; };
const P_CORNICE = [[0, 0], [0.08, 0.04], [0.08, 0.26], [0.22, 0.4], [0.3, 0.52], [0.36, 0.56], [0.36, 0.75]];

// ------------------------------------------------------------------ tunnel through land ring 1
/** elliptical opening top (y) at world offset x from the tunnel axis, or -Infinity outside */
function openTop(T, x) { const ax = Math.abs(x); if (ax >= T.rx) return -Infinity; return T.spring + T.ry * Math.sqrt(1 - (ax / T.rx) ** 2); }

/** portal face bay (replaces a revetment bay of an l1 edge near bearing 180) */
export function portalBay(ctx, e, b0, b1, F, len) {
  const { S, rng } = ctx;
  const T = ctx.tun;
  const mid = F.p(len / 2, 0, 0);
  const W = S.get('white', mid[0], mid[2]);
  const yB = e.floor - 1.5, yTop = e.landY - 0.75;
  // columns with world x; split at the jambs
  const xs = (s) => F.p(s, 0, 0)[0];
  const cuts = [0, len];
  for (const xj of [-T.rx, T.rx]) {
    const x0 = xs(0), x1 = xs(len);
    if ((x0 - xj) * (x1 - xj) < 0) cuts.push(((xj - x0) / (x1 - x0)) * len);
  }
  cuts.sort((a, b) => a - b);
  const cols = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const n = Math.max(1, Math.ceil((cuts[i + 1] - cuts[i]) / 0.6));
    for (let k = 0; k < n; k++) cols.push([cuts[i] + ((cuts[i + 1] - cuts[i]) * k) / n, cuts[i] + ((cuts[i + 1] - cuts[i]) * (k + 1)) / n]);
  }
  W.aux = [0, 0, 0.2, AUX_ASHLAR(0.72)];
  for (const [sa, sb] of cols) {
    const ya = Math.max(yB, openTop(T, xs(sa))), yb = Math.max(yB, openTop(T, xs(sb)));
    const xm = xs((sa + sb) / 2);
    if (Math.abs(xm) < T.rx && Math.min(ya, yb) >= yTop - 0.01) continue;
    W.quadToward(F.p(sa, Math.min(ya, yTop), 0), F.p(sb, Math.min(yb, yTop), 0), F.p(sb, yTop, 0), F.p(sa, yTop, 0), tone(rng, 0.03), F.az);
  }
  W.aux = [0, 0.2, 0, 0];
  sweep(W, F, 0, len, P_CORNICE.map(([d, y]) => [d, y + yTop]), tone(rng, 0.03), false);
  const P = S.get('paving', mid[0], mid[2]);
  P.aux = [0, 0, 0, AUX_PAVING(1.3)];
  P.quadToward(F.p(0, e.landY + 0.01, 0.36), F.p(len, e.landY + 0.01, 0.36), F.p(len, e.landY + 0.01, -1.0), F.p(0, e.landY + 0.01, -1.0), [0.9, 0.88, 0.85], [0, 1, 0]);
  P.aux = [0, 0, 0, 0];
}

/** archivolt, interior vault, lamps and roof of the canal tunnel */
export function buildTunnel(ctx) {
  const { S, rng, plan } = ctx;
  const T = ctx.tun;
  const eIn = plan.edges.find((e) => e.id === 'l1-in'), eOut = plan.edges.find((e) => e.id === 'l1-out');
  const zN = Math.sqrt(eIn.faceR ** 2 - 0), zS = eOut.faceR;
  const yT = eIn.landY;
  // archivolts on both portals (straight frames at x = 0)
  for (const [z, dir] of [[zN, -1], [zS, 1]]) {
    const F = frameXZ(0, 0, z, dir > 0 ? -1 : 1, 0, 0, dir);  // +d toward the water
    const Wt = S.get('white', 0, z), G = S.get('gilt', 0, z);
    const n = 23, ring = 1.0;
    Wt.aux = [0, 0.4, 0, 0];
    for (let i = 0; i < n; i++) {
      const t0 = Math.PI - (Math.PI * i) / n, t1 = Math.PI - (Math.PI * (i + 1)) / n;
      const key = i === (n - 1) / 2;
      const B = key ? G : Wt;
      const g = 0.01;
      const P = (t, k, d) => F.p(Math.cos(t) * (T.rx + k), T.spring + Math.sin(t) * (T.ry + k), d);
      const kk = ring * (key ? 1.35 : 1), dF = key ? 0.5 : 0.32;
      const c = key ? [1, 1, 1] : [0.92 + 0.06 * rng.random(), 0.9, 0.87];
      const ctr = F.p(Math.cos((t0 + t1) / 2) * (T.rx + 0.5), T.spring + Math.sin((t0 + t1) / 2) * (T.ry + 0.5), -0.5);
      B.quadOut(P(t0 - g, 0, dF), P(t1 + g, 0, dF), P(t1 + g, kk, dF), P(t0 - g, kk, dF), c, ctr);
      B.quadOut(P(t0 - g, kk, dF), P(t1 + g, kk, dF), P(t1 + g, kk, -1.4), P(t0 - g, kk, -1.4), c, ctr);
      B.quadOut(P(t0 - g, 0, -1.4), P(t1 + g, 0, -1.4), P(t1 + g, 0, dF), P(t0 - g, 0, dF), [0.75, 0.73, 0.7], F.p(0, T.spring, 0));
      B.quadOut(P(t0 - g, 0, dF), P(t0 - g, kk, dF), P(t0 - g, kk, -1.4), P(t0 - g, 0, -1.4), c, ctr);
      B.quadOut(P(t1 + g, kk, dF), P(t1 + g, 0, dF), P(t1 + g, 0, -1.4), P(t1 + g, kk, -1.4), c, ctr);
    }
    // jambs
    for (const sx of [-1, 1]) {
      let y = -1.0, k = 0;
      while (y < T.spring - 0.02) {
        const hh = Math.min(T.spring - y, k % 2 ? 0.6 : 0.9);
        const w = k % 2 ? 1.25 : 0.85;
        chamferBox(Wt, F, sx < 0 ? -T.rx - w : T.rx, sx < 0 ? -T.rx : T.rx + w, y, y + hh, -1.4, 0.32, 0.04, [0.93, 0.91, 0.88]);
        y += hh; k++;
      }
      chamferBox(G, F, sx < 0 ? -T.rx - 1.5 : T.rx - 0.1, sx < 0 ? -T.rx + 0.1 : T.rx + 1.5, T.spring - 0.3, T.spring, -1.4, 0.45, 0.03, [1, 1, 1]);
    }
    // gilt trident relief panel over the keystone + banner slots on the portal piers
    if (!ctx.sunken) for (const sx of [-1, 1]) ctx.slots.banner.push({ pos: F.p(sx * (T.rx + 4.5), yT - 1.4, 0.45), facing: dir > 0 ? 180 : 0, size: [2.4, 7.5], tag: 'rings-tunnel' });
  }
  // interior: walls + elliptical vault + water-stained base, lamps
  const I = S.get('interior', 0, (zN + zS) / 2);
  const nz = 28, na = 14;
  const lampsZ = []; for (let z = zN + 6; z < zS - 4; z += 14) lampsZ.push(z);
  const glow = (x, y, z) => { let g = 0; for (const lz of lampsZ) for (const sx of [-1, 1]) { const d2 = (x - sx * (T.rx - 0.5)) ** 2 + (y - (T.spring + 1.2)) ** 2 + (z - lz) ** 2; g += 2.4 / (1 + d2 * 0.25); } return g; };
  for (let k = 0; k < nz; k++) {
    const z0 = zN - 1.4 + ((zS - zN + 2.8) * k) / nz, z1 = zN - 1.4 + ((zS - zN + 2.8) * (k + 1)) / nz, zm = (z0 + z1) / 2;
    for (const sx of [-1, 1]) {
      for (const [ya, yb] of [[-11, 0], [0, T.spring]]) {
        I.aux = [ya < 0 ? 0.5 : 0, 0, glow(sx * T.rx, (ya + yb) / 2, zm), 0];
        I.quadToward([sx * T.rx, ya, z0], [sx * T.rx, ya, z1], [sx * T.rx, yb, z1], [sx * T.rx, yb, z0], [1, 1, 1], [-sx, 0, 0]);
      }
    }
    for (let i = 0; i < na; i++) {
      const t0 = (Math.PI * i) / na, t1 = (Math.PI * (i + 1)) / na, tm = (t0 + t1) / 2;
      const P = (t, z) => [Math.cos(t) * T.rx, T.spring + Math.sin(t) * T.ry, z];
      I.aux = [0, 0, glow(Math.cos(tm) * T.rx, T.spring + Math.sin(tm) * T.ry, zm), 0];
      I.quadToward(P(t0, z0), P(t1, z0), P(t1, z1), P(t0, z1), [1, 1, 1], [-Math.cos(tm) * T.ry, -Math.sin(tm) * T.rx, 0]);
    }
  }
  // towpath ledges along both walls
  const Lm = S.get('lime', 0, (zN + zS) / 2);
  for (const sx of [-1, 1]) chamferBox(Lm, frameXZ(sx * (T.rx - 1.1), 0, zN, 0, 1, -sx, 0), 0, zS - zN, -0.6, 1.1, -1.1, 0.0, 0.03, [0.6, 0.58, 0.54]);
  if (!ctx.sunken) {
    const Lp = S.get('lamp', 0, (zN + zS) / 2);
    for (const lz of lampsZ) for (const sx of [-1, 1]) box(Lp, frameXZ(sx * (T.rx - 0.45), 0, lz, 0, 1, -sx, 0), -0.15, 0.15, T.spring + 1.0, T.spring + 1.4, -0.15, 0.15, [1, 1, 1]);
  }
  // roof plaza over the cut (between the two face arcs), paved
  const Pv = S.get('paving', 0, (zN + zS) / 2);
  Pv.aux = [0, 0, 0, AUX_PAVING(1.6)];
  const hw = T.halfWidth + 1.0, nx = 10, nzR = 14;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nzR; k++) {
    const x0 = -hw + (2 * hw * i) / nx, x1 = -hw + (2 * hw * (i + 1)) / nx;
    const zA = (x) => Math.sqrt(eIn.faceR ** 2 - x * x) + 0.3, zB = (x) => Math.sqrt(eOut.faceR ** 2 - x * x) - 0.3;
    const za0 = zA(x0) + ((zB(x0) - zA(x0)) * k) / nzR, za1 = zA(x0) + ((zB(x0) - zA(x0)) * (k + 1)) / nzR;
    const zb0 = zA(x1) + ((zB(x1) - zA(x1)) * k) / nzR, zb1 = zA(x1) + ((zB(x1) - zA(x1)) * (k + 1)) / nzR;
    Pv.quadToward([x0, yT + 0.02, za0], [x1, yT + 0.02, zb0], [x1, yT + 0.02, zb1], [x0, yT + 0.02, za1], [0.95, 0.93, 0.9], [0, 1, 0]);
  }
  Pv.aux = [0, 0, 0, 0];
  ctx.engine.footprints.addRect(0, (zN + zS) / 2, 13, (zS - zN) / 2, 0, 'rings-tunnel-road');
  return { zN, zS };
}

// ------------------------------------------------------------------ canal embankments through land ring 2
export function buildCanal(ctx) {
  const { S, rng, plan, engine } = ctx;
  const K = plan.canal;
  const eIn = plan.edges.find((e) => e.id === 'l2-in'), eOut = plan.edges.find((e) => e.id === 'l2-out');
  const yT = K.landY, floor = L.SEA_CANAL.floor;
  const faceX = 34.7, quayW = 5.0, quayY = 1.4;
  const zA = Math.sqrt(eIn.faceR ** 2 - 39.5 ** 2) - 0.5, zB = Math.sqrt(eOut.faceR ** 2 - 39.5 ** 2) + 0.5;
  const spouts = [];
  let nStoa = 0;
  for (const sx of [-1, 1]) {
    // frame: origin at (sx*faceX, 0, zA), ax along +z, az toward the canal centre (-sx)
    const F = new Frame([sx * faceX, 0, zA], [0, 0, 1], [0, 1, 0], [-sx, 0, 0]);
    const len = zB - zA;
    const nb = Math.round(len / 7.5), bl = len / nb;
    for (let k = 0; k < nb; k++) {
      const s0 = k * bl, s1 = s0 + bl, sm = (s0 + s1) / 2;
      const p = F.p(sm, 0, 0);
      const lod = ctx.lodAt(p[0], p[2]);
      const W = S.get('white', p[0], p[2]);
      // underwater + quay front
      const Lm = S.get('lime', p[0], p[2]);
      Lm.aux = [0.2, 0, 0, AUX_ASHLAR(1.0)];
      Lm.quadToward(F.p(s0, floor - 1.5, quayW), F.p(s1, floor - 1.5, quayW), F.p(s1, quayY - 0.35, quayW), F.p(s0, quayY - 0.35, quayW), [0.55, 0.56, 0.5], F.az);
      Lm.aux = [0, 0.3, 0, 0];
      chamferBox(Lm, F, s0, s1, quayY - 0.35, quayY + 0.08, quayW - 0.5, quayW + 0.06, lod <= 1 ? 0.04 : 0, tone(rng, 0.05), FACES.pz | FACES.py);
      const Pv = S.get('paving', p[0], p[2]);
      Pv.aux = [0, 0, 0, AUX_PAVING(1.1)];
      Pv.quadToward(F.p(s0, quayY, 0), F.p(s1, quayY, 0), F.p(s1, quayY, quayW - 0.5), F.p(s0, quayY, quayW - 0.5), tone(rng, 0.03), [0, 1, 0]);
      Pv.aux = [0, 0, 0, 0];
      // embankment face from the quay up to the land top
      W.aux = [0, 0, 0.25, AUX_ASHLAR(0.72)];
      W.quadToward(F.p(s0, quayY - 0.1, 0), F.p(s1, quayY - 0.1, 0), F.p(s1, yT - 0.75, 0), F.p(s0, yT - 0.75, 0), tone(rng, 0.03), F.az);
      const R = S.get('red', p[0], p[2]);
      R.aux = [0, 0.2, 0, AUX_ASHLAR(0.72)];
      box(R, F, s0, s1, quayY + 1.6, quayY + 2.3, -0.2, 0.03, tone(rng, 0.05), FACES.pz | FACES.py | FACES.ny);
      box(R, F, s0, s1, yT - 2.2, yT - 1.5, -0.2, 0.03, tone(rng, 0.05), FACES.pz | FACES.py | FACES.ny);
      W.aux = [0, 0.3, 0, AUX_ASHLAR(0.72)];
      chamferBox(W, F, s0 - 0.6, s0 + 0.6, quayY, yT - 0.75, -0.2, 0.25, lod <= 1 ? 0.04 : 0, tone(rng, 0.04), FACES.pz | FACES.px | FACES.nx);
      W.aux = [0, 0.2, 0, 0];
      sweep(W, F, s0, s1, P_CORNICE.map(([d, y]) => [d, y + yT - 0.75]), tone(rng, 0.03), k === 0 || k === nb - 1);
      // promenade paving at the top + balustrade at the edge
      Pv.aux = [0, 0, 0, AUX_PAVING(1.3)];
      Pv.quadToward(F.p(s0, yT + 0.01, 0.36), F.p(s1, yT + 0.01, 0.36), F.p(s1, yT + 0.01, -5.5), F.p(s0, yT + 0.01, -5.5), [0.95, 0.93, 0.9], [0, 1, 0]);
      Pv.aux = [0, 0, 0, 0];
      W.aux = [0, 0.3, 0, 0];
      chamferBox(W, F, s0 - 0.32, s0 + 0.32, yT, yT + 1.25, -0.3, 0.3, 0.03, tone(rng, 0.04));
      box(W, F, s0, s1, yT + 0.98, yT + 1.15, -0.26, 0.26, tone(rng, 0.03), FACES.pz | FACES.py | FACES.nz | FACES.ny);
      box(W, F, s0, s1, yT, yT + 0.16, -0.24, 0.24, tone(rng, 0.03), FACES.pz | FACES.py | FACES.nz);
      if (lod <= 1) {
        const nB = Math.floor(bl / 0.42);
        for (let i = 1; i < nB; i++) lathe(W, F, s0 + i * (bl / nB), yT + 0.16, 0, [[0.0, 0], [0.11, 0], [0.12, 0.08], [0.08, 0.18], [0.12, 0.42], [0.06, 0.66], [0.09, 0.82], [0.0, 0.82]], 6, [0.95, 0.94, 0.92]);
      } else W.quadToward(F.p(s0, yT + 0.16, 0.05), F.p(s1, yT + 0.16, 0.05), F.p(s1, yT + 0.98, 0.05), F.p(s0, yT + 0.98, 0.05), [0.8, 0.79, 0.76], F.az);
      W.aux = [0, 0, 0, 0];
      // brazier pedestals on every 4th pier, banners on the others
      if (!ctx.sunken) {
        if (k % 4 === 0) ctx.slots.brazier.push({ pos: F.p(s0, yT + 1.25, 0), facing: sx < 0 ? 90 : 270, size: 0.9, tag: 'rings-canal' });
        else if (k % 4 === 2) ctx.slots.banner.push({ pos: F.p(sm, yT - 1.0, 0.3), facing: sx < 0 ? 90 : 270, size: [1.8, 5.2], tag: 'rings-canal' });
      } else if (k % 2 === 0) {
        ctx.slots.coral.push({ pos: F.p(sm, yT + 0.1, -1), normal: [0, 1, 0], size: 1.4, tag: 'rings-canal-top' });
        ctx.slots.kelp.push({ pos: F.p(sm, -4, quayW + 3 + 6 * rng.random()), size: 16 + 14 * rng.random(), tag: 'rings-canal' });
      }
      // lion-head spouts with falls into the canal (ref 2)
      if (k % 5 === 3) {
        const Gd = S.get('gold', p[0], p[2]);
        const sp = F.p(sm, quayY + 4.2, 0.3);
        chamferBox(Gd, F, sm - 0.45, sm + 0.45, quayY + 3.9, quayY + 4.8, 0, 0.55, 0.08, [1, 1, 1]);
        spouts.push({ pos: [sp[0] + F.az[0] * 0.4, sp[1], sp[2]], dir: sx < 0 ? 90 : 270, width: 0.7, flow: 0.6, kind: 'spout', id: `rings-canal-${sx}-${k}` });
      }
      // water stairs from the quay
      if (k % 6 === 1 && lod <= 1) {
        for (let i = 0; i < 5; i++) {
          const yy = quayY - (i + 1) * ((quayY + 0.8) / 5);
          chamferBox(Lm, F, sm - 1.4, sm + 1.4, yy - 0.3, yy + 0.02, quayW + 0.06 + i * 0.32, quayW + 0.06 + (i + 1) * 0.32, 0.02, tone(rng, 0.05), FACES.py | FACES.pz | FACES.px | FACES.nx);
        }
      }
      // embankment end faces (meet the ring revetments at the canal corners)
      if (k === 0 || k === nb - 1) {
        const s = k === 0 ? s0 : s1, dir = k === 0 ? [0, 0, -1] : [0, 0, 1];
        W.aux = [0, 0, 0, AUX_ASHLAR(0.72)];
        W.quadToward(F.p(s, floor - 1.5, quayW), F.p(s, floor - 1.5, -5.5), F.p(s, yT, -5.5), F.p(s, yT, quayW), [0.9, 0.88, 0.85], dir);
        W.aux = [0, 0, 0, 0];
      }
      if (lod <= 1 && k % 2 === 0) {
        const Bk = S.get('black', p[0], p[2]);
        lathe(Bk, F, sm, quayY, quayW - 1.0, [[0.0, 0], [0.26, 0], [0.26, 0.1], [0.2, 0.16], [0.18, 0.55], [0.27, 0.64], [0.25, 0.72], [0.0, 0.75]], 8, [0.9, 0.9, 0.9]);
      }
      Lm.aux = [0, 0, 0, 0];
    }
    // stoas along the promenade (skip around the gate bridge towers)
    const gz = L.GATE_BRIDGE.z;
    for (const [z0, z1] of [[zA + 16, gz - 26], [gz + 26, zB - 16]]) {
      if (z1 - z0 < 20) continue;
      stoa(ctx, sx, faceX + 6.0, z0, z1, yT);
      nStoa++;
    }
    engine.footprints.addRect(sx * (faceX + 7), (zA + zB) / 2, 7.5, (zB - zA) / 2, 0, 'rings-canal');
  }
  return { spouts, nStoa, zA, zB };
}

/** single-storey Doric-ish stoa: back wall, column row facing the canal, entablature, flat roof */
function stoa(ctx, sx, xFront, z0, z1, y0) {
  const { S, rng } = ctx;
  const depth = 7.5, hC = 6.2, pitch = 3.6;
  const F = new Frame([sx * xFront, y0, z0], [0, 0, 1], [0, 1, 0], [-sx, 0, 0]); // +d toward the canal, origin at the column line
  const len = z1 - z0;
  const mid = F.p(len / 2, 0, 0);
  const W = S.get('white', mid[0], mid[2]);
  const label = `rings:stoa:${sx}:${Math.round(z0)}`;
  // stylobate (3 steps)
  W.aux = [0, 0.3, 0, 0];
  for (let i = 0; i < 3; i++) chamferBox(W, F, -0.9 + i * 0.35, len + 0.9 - i * 0.35, i * 0.22, (i + 1) * 0.22, -depth - 0.4, 1.0 - i * 0.35, 0.02, tone(rng, 0.03));
  const yS = 0.66;
  // back wall (red with white base), interior dark
  const R = S.get('red', mid[0], mid[2]);
  R.aux = [0, 0, 0, AUX_ASHLAR(0.6)];
  box(R, F, 0, len, yS, yS + hC + 1.4, -depth, -depth + 0.7, [1, 1, 1], FACES.pz | FACES.nz | FACES.px | FACES.nx);
  R.aux = [0, 0, 0, 0];
  const n = Math.max(2, Math.round(len / pitch));
  const step = len / n;
  for (let i = 0; i <= n; i++) {
    const s = i * step;
    if (ctx.sunken && ruined(`${label}:c${i}`, 0.4)) {
      // toppled drums on the promenade
      for (let k = 0; k < 3; k++) {
        const Fr = F.at(s + (ruinRand(`${label}:c${i}`, k) - 0.5) * 3, -yS + 0.4, 1.5 + k * 1.3).yawed(ruinRand(`${label}:c${i}`, k + 3) * 3);
        lathe(W, new Frame(Fr.o, Fr.ax, Fr.az, mul3(Fr.ay, -1)), 0, 0, 0, [[0, -0.6], [0.42, -0.6], [0.42, 0.6], [0, 0.6]], 12, [0.85, 0.83, 0.8]);
      }
      continue;
    }
    lathe(W, F, s, yS, 0, [[0, 0], [0.55, 0], [0.55, 0.18], [0.46, 0.3], [0.42, hC - 0.6], [0.0, hC - 0.6]], 14, tone(rng, 0.03));
    lathe(S.get('gilt', mid[0], mid[2]), F, s, yS + hC - 0.6, 0, [[0, 0], [0.43, 0], [0.56, 0.3], [0.62, 0.45], [0.62, 0.6], [0, 0.6]], 14, [1, 1, 1]);
  }
  const ruinRoof = ctx.sunken && ruined(label + ':roof', 0.6);
  if (ruinRoof) return;
  // entablature + roof
  W.aux = [0, 0.2, 0, 0];
  box(W, F, -0.5, len + 0.5, yS + hC, yS + hC + 1.0, -depth, 0.65, tone(rng, 0.03), FACES.pz | FACES.py | FACES.px | FACES.nx | FACES.ny);
  box(S.get('gilt', mid[0], mid[2]), F, -0.5, len + 0.5, yS + hC + 0.35, yS + hC + 0.55, 0.62, 0.7, [1, 1, 1], FACES.pz | FACES.py | FACES.ny);
  sweep(W, F, -0.6, len + 0.6, [[0.65, yS + hC + 1.0], [0.85, yS + hC + 1.15], [0.95, yS + hC + 1.4], [0.95, yS + hC + 1.55]], tone(rng, 0.03), true);
  const Pv = S.get('paving', mid[0], mid[2]);
  Pv.quadToward(F.p(-0.6, yS + hC + 1.55, 0.95), F.p(len + 0.6, yS + hC + 1.55, 0.95), F.p(len + 0.6, yS + hC + 1.55, -depth), F.p(-0.6, yS + hC + 1.55, -depth), [0.9, 0.88, 0.85], [0, 1, 0]);
  // ceiling (dark-ish, under the roof)
  const I = S.get('interior', mid[0], mid[2]);
  I.aux = [0.3, 0, 0.15, 0];
  I.quadToward(F.p(0, yS + hC, 0.6), F.p(len, yS + hC, 0.6), F.p(len, yS + hC, -depth + 0.7), F.p(0, yS + hC, -depth + 0.7), [1, 1, 1], [0, -1, 0]);
  if (!ctx.sunken) for (let i = 1; i < n; i += 2) ctx.slots.banner.push({ pos: F.p(i * step + step / 2, yS + hC - 0.1, 0), facing: sx < 0 ? 90 : 270, size: [1.5, 4.0], tag: 'rings-stoa columns' });
}

// ------------------------------------------------------------------ moles + lighthouses
/** rip-rap boulder geometry variants (displaced icosahedra) */
function boulderGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.28 * noiseA.noise3(v.x * 1.3 + seed * 7, v.y * 1.3, v.z * 1.3) + 0.12 * noiseA.noise3(v.x * 3 + seed, v.y * 3, v.z * 3);
    v.multiplyScalar(n);
    v.y *= 0.7;
    // flatten facets a little (quarried blocks)
    v.x = Math.sign(v.x) * Math.pow(Math.abs(v.x), 0.85); v.z = Math.sign(v.z) * Math.pow(Math.abs(v.z), 0.85);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildMoles(ctx, M) {
  const { S, rng, plan, engine } = ctx;
  const out = { lighthouses: [], boulders: 0 };
  const rocks = [];   // [x, y, z, scale, rotY, variant]
  const eOut = plan.edges.find((e) => e.id === 'l2-out');
  for (const m of plan.moles) {
    const x = m.from[0], hw = m.halfWidth, yT = m.topY;
    const z0 = Math.sqrt(eOut.faceR ** 2 - (Math.abs(x) + hw) ** 2) - 1.0, z1 = m.to[1];
    const len = z1 - z0;
    for (const side of [-1, 1]) {
      // revetment faces of the mole (both sides)
      const F = new Frame([x + side * hw, 0, z0], [0, 0, 1], [0, 1, 0], [side, 0, 0]);
      const nb = Math.round(len / 8), bl = len / nb;
      for (let k = 0; k < nb; k++) {
        const s0 = k * bl, s1 = s0 + bl;
        const p = F.p((s0 + s1) / 2, 0, 0);
        const lod = ctx.lodAt(p[0], p[2]);
        const W = S.get('white', p[0], p[2]);
        W.aux = [0.2, 0, 0, AUX_ASHLAR(1.0)];
        W.quadToward(F.p(s0, -16, 0), F.p(s1, -16, 0), F.p(s1, 0.6, 0), F.p(s0, 0.6, 0), [0.5, 0.52, 0.46], F.az);
        W.aux = [0, 0, 0.2, AUX_ASHLAR(0.8)];
        W.quadToward(F.p(s0, 0.6, 0), F.p(s1, 0.6, 0), F.p(s1, yT - 0.5, 0), F.p(s0, yT - 0.5, 0), tone(rng, 0.03), F.az);
        W.aux = [0, 0.2, 0, 0];
        sweep(W, F, s0, s1, [[0, yT - 0.5], [0.12, yT - 0.4], [0.2, yT - 0.2], [0.2, yT]], tone(rng, 0.03), false);
        // sea side: parapet with merlons; canal side: bollards
        const sea = Math.sign(x) === side;
        if (sea) {
          W.aux = [0, 0.3, 0, AUX_ASHLAR(0.5)];
          box(W, F, s0, s1, yT, yT + 1.1, -0.7, 0.0, tone(rng, 0.03), FACES.pz | FACES.py | FACES.nz);
          const nM = Math.floor(bl / 1.8);
          for (let i = 0; i < nM; i++) {
            if (ctx.sunken && ruined(`rings:mole:${x}:${k}:${i}`, 0.5)) continue;
            const sc = s0 + (i + 0.5) * (bl / nM);
            chamferBox(W, F, sc - 0.5, sc + 0.5, yT + 1.1, yT + 2.1, -0.7, 0, 0.04, tone(rng, 0.05));
          }
          W.aux = [0, 0, 0, 0];
        } else if (lod <= 1 && k % 1 === 0) {
          lathe(S.get('black', p[0], p[2]), F, (s0 + s1) / 2, yT, -0.8, [[0.0, 0], [0.26, 0], [0.26, 0.1], [0.2, 0.16], [0.18, 0.55], [0.27, 0.64], [0.25, 0.72], [0.0, 0.75]], 8, [0.9, 0.9, 0.9]);
        }
        if (sea) {
          // rip-rap at the foot of the sea face
          for (let i = 0; i < 3; i++) {
            const s = s0 + rng.random() * bl, d = 1.5 + rng.random() * 6;
            const q = F.p(s, 0, d);
            const sc = 1.4 + rng.random() * 2.4;
            rocks.push([q[0], -1.5 + rng.random() * 1.8 - d * 0.25, q[2], sc, rng.random() * 6.28, i % 3]);
          }
        }
      }
    }
    // deck
    const Pv = S.get('paving', x, (z0 + z1) / 2);
    Pv.aux = [0, 0, 0, AUX_PAVING(1.4)];
    const nd = Math.ceil(len / 20);
    for (let k = 0; k < nd; k++) Pv.quadToward([x - hw, yT, z0 + (len * k) / nd], [x + hw, yT, z0 + (len * k) / nd], [x + hw, yT, z0 + (len * (k + 1)) / nd], [x - hw, yT, z0 + (len * (k + 1)) / nd], [0.95, 0.93, 0.9], [0, 1, 0]);
    Pv.aux = [0, 0, 0, 0];
    engine.footprints.addRect(x, (z0 + z1) / 2, hw, len / 2, 0, 'rings-mole');
    if (!ctx.sunken) for (let z = z0 + 30; z < z1 - 20; z += 40) ctx.slots.brazier.push({ pos: [x - Math.sign(x) * 0.0, yT, z], facing: 180, size: 1.0, tag: 'rings-mole ground' });
    out.lighthouses.push(lighthouse(ctx, m, rocks));
  }
  // instanced rip-rap
  if (rocks.length) {
    const geos = [0, 1, 2].map((i) => boulderGeo(i + 1));
    const dummy = new THREE.Object3D();
    const group = new THREE.Group(); group.name = 'rings-riprap';
    for (let v = 0; v < 3; v++) {
      const list = rocks.filter((r) => r[5] === v);
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geos[v], M.rockBare, list.length);
      list.forEach((r, i) => { dummy.position.set(r[0], r[1], r[2]); dummy.rotation.set(0.3 * Math.sin(r[4] * 3), r[4], 0.3 * Math.cos(r[4] * 2)); dummy.scale.set(r[3], r[3] * 0.8, r[3] * 1.1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      group.add(im);
    }
    out.riprap = group;
    out.boulders = rocks.length;
  }
  return out;
}

/** lighthouse at the end of a mole (ref 1): rock base, rusticated podium, banded square tier, octagonal tier, gold lantern */
function lighthouse(ctx, m, rocks) {
  const { S, rng, engine } = ctx;
  const [x, , z] = m.light.pos;
  const label = `rings:lighthouse:${x}`;
  const broken = ctx.sunken;               // sunken: lantern + upper tier gone
  const Fc = new Frame([x, 0, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  // rock base (boulders around)
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2 + rng.random() * 0.1, rr = 16.5 + rng.random() * 9;
    rocks.push([x + Math.cos(a) * rr, -2.0 + rng.random() * 3.5 - (rr - 16.5) * 0.3, z + Math.sin(a) * rr, 2.6 + rng.random() * 3.2, rng.random() * 6.28, i % 3]);
  }
  const faces = [];
  for (let i = 0; i < 4; i++) faces.push(Fc.yawed((i * Math.PI) / 2));
  const W = S.get('white', x, z), Bd = S.get('banded', x, z), Lm = S.get('lime', x, z), G = S.get('gold', x, z), Gt = S.get('gilt', x, z);
  // podium 18 x 18 (to y = 7)
  const hp = 11.5, yP = 8;
  for (const F0 of faces) {
    const F = F0.at(0, 0, hp);
    Lm.aux = [0.2, 0, 0, AUX_ASHLAR(1.0)];
    Lm.quadToward(F.p(-hp, -16, 0), F.p(hp, -16, 0), F.p(hp, 0.8, 0), F.p(-hp, 0.8, 0), [0.5, 0.52, 0.46], F.az);
    Lm.aux = [0, 0.3, 0, 0];
    for (let k = 0; k < 6; k++) {
      const a = -hp + (2 * hp * k) / 6, b = -hp + (2 * hp * (k + 1)) / 6;
      for (let j = 0; j < 4; j++) chamferBox(Lm, F, a + 0.02, b - 0.02, 0.8 + j * 1.4 + 0.02, 0.8 + (j + 1) * 1.4 - 0.02, -0.4, 0.15 + 0.05 * ((k + j) % 2), 0.12, tone(rng, 0.06), FACES.pz | FACES.py | FACES.px | FACES.nx);
    }
    W.aux = [0, 0.2, 0, 0];
    sweep(W, F, -hp - 0.4, hp + 0.4, P_CORNICE.map(([d, y]) => [d, y + yP - 0.75]), [0.95, 0.94, 0.92], true);
  }
  Lm.aux = [0, 0, 0, 0];
  const Pv = S.get('paving', x, z);
  Pv.quadToward(Fc.p(-hp - 0.4, yP, -hp - 0.4), Fc.p(hp + 0.4, yP, -hp - 0.4), Fc.p(hp + 0.4, yP, hp + 0.4), Fc.p(-hp - 0.4, yP, hp + 0.4), [0.95, 0.93, 0.9], [0, 1, 0]);
  // tier 1: square banded shaft 12 x 12 to y = 27
  const h1 = 7.5, y1 = 34;
  const yTop1 = broken ? 18 + 5 * ruinRand(label, 0) : y1;
  for (const F0 of faces) {
    const F = F0.at(0, 0, h1);
    W.aux = [0, 0, 0.2, AUX_ASHLAR(0.7)];
    W.quadToward(F.p(-h1, yP, 0), F.p(h1, yP, 0), F.p(h1, yTop1, 0), F.p(-h1, yTop1, 0), [1, 1, 1], F.az);
    W.aux = [0, 0, 0, 0];
    const Rr = S.get('red', x, z);
    Rr.aux = [0, 0.2, 0, AUX_ASHLAR(0.6)];
    for (const yb of [yP + 2.2, y1 - 3.2]) if (yb + 0.7 < yTop1) box(Rr, F, -h1 + 1.0, h1 - 1.0, yb, yb + 0.7, -0.1, 0.03, [1, 1, 1], FACES.pz | FACES.py | FACES.ny);
    Rr.aux = [0, 0, 0, 0];
    W.aux = [0, 0.5, 0, AUX_ASHLAR(0.7)];
    chamferBox(W, F, h1 - 1.0, h1 + 0.001, yP, yTop1, -0.02, 0.18, 0.05, [0.97, 0.96, 0.94], FACES.pz | FACES.px | FACES.nx);
    W.aux = [0, 0, 0, 0];
    if (broken) continue;
    for (const yy of [13, 19.5, 26]) {
      const V = S.get('void', x, z);
      V.quadToward(F.p(-0.6, yy, 0.03), F.p(0.6, yy, 0.03), F.p(0.6, yy + 2.0, 0.03), F.p(-0.6, yy + 2.0, 0.03), [1, 1, 1], F.az);
      box(Gt, F, -0.8, 0.8, yy - 0.18, yy, 0, 0.12, [1, 1, 1], FACES.pz | FACES.py);
    }
    W.aux = [0, 0.25, 0, 0];
    sweep(W, F, -h1 - 0.6, h1 + 0.6, [[0, y1], [0.1, y1], [0.25, y1 + 0.2], [0.45, y1 + 0.45], [0.6, y1 + 0.55], [0.6, y1 + 0.85]], [0.95, 0.94, 0.92], true);
    box(Gt, F, -h1 - 0.6, h1 + 0.6, y1 - 0.5, y1 - 0.25, 0, 0.1, [1, 1, 1], FACES.pz | FACES.py | FACES.ny);
  }
  if (!broken) {
    Pv.quadToward(Fc.p(-h1 - 0.6, y1 + 0.85, -h1 - 0.6), Fc.p(h1 + 0.6, y1 + 0.85, -h1 - 0.6), Fc.p(h1 + 0.6, y1 + 0.85, h1 + 0.6), Fc.p(-h1 - 0.6, y1 + 0.85, h1 + 0.6), [0.95, 0.93, 0.9], [0, 1, 0]);
    // gilt acroteria at the tier-1 corners
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) lathe(Gt, Fc, sx * (h1 + 0.1), y1 + 0.85, sz * (h1 + 0.1), [[0, 0], [0.45, 0], [0.48, 0.18], [0.28, 0.35], [0.36, 0.8], [0.14, 1.3], [0.04, 1.9], [0, 2.0]], 8, [1, 1, 1]);
    // tier 2: octagonal shaft to y = 38
    const r2 = 5.4, y2 = 48;
    lathe(W, Fc, 0, 0, 0, [[0, y1 + 0.85], [r2 + 0.3, y1 + 0.85], [r2 + 0.3, y1 + 1.4], [r2, y1 + 1.6], [r2, y2], [r2 + 0.5, y2 + 0.3], [r2 + 0.6, y2 + 0.7], [0, y2 + 0.7]], 8, [0.96, 0.95, 0.93]);
    lathe(S.get('red', x, z), Fc, 0, 0, 0, [[r2 + 0.02, y1 + 4.0], [r2 + 0.02, y1 + 4.7]], 8, [1, 1, 1]);
    lathe(S.get('red', x, z), Fc, 0, 0, 0, [[r2 + 0.02, y2 - 2.0], [r2 + 0.02, y2 - 1.3]], 8, [1, 1, 1]);
    // lantern: 8 gold columns around a glowing core, gold dome, finial
    const yL = y2 + 0.7, hL = 5.2, rL = 3.9;
    lathe(S.get('lamp', x, z), Fc, 0, 0, 0, [[0, yL], [1.5, yL], [1.7, yL + 1.2], [1.2, yL + 2.6], [0, yL + 3.1]], 12, [1, 1, 1]);
    for (let c = 0; c < 8; c++) {
      const a = (c / 8) * Math.PI * 2 + Math.PI / 8;
      lathe(G, Fc, Math.cos(a) * rL, yL, Math.sin(a) * rL, [[0, 0], [0.32, 0], [0.32, 0.2], [0.24, 0.35], [0.22, hL - 0.4], [0.34, hL - 0.15], [0.36, hL], [0, hL]], 10, [1, 1, 1]);
    }
    const yD = yL + hL;
    lathe(G, Fc, 0, 0, 0, [[0, yD], [rL + 0.6, yD], [rL + 0.6, yD + 0.6], [rL + 0.3, yD + 0.75], ...Array.from({ length: 11 }, (_, i) => { const a = ((i + 1) / 11) * (Math.PI / 2); return [(rL + 0.3) * Math.cos(a), yD + 0.75 + (rL + 0.3) * 1.1 * Math.sin(a)]; })], 24, [1, 1, 1]);
    const yF = yD + 0.75 + (rL + 0.3) * 1.1;
    lathe(G, Fc, 0, 0, 0, [[0, yF - 0.05], [0.5, yF], [0.55, yF + 0.4], [0.2, yF + 0.8], [0.6, yF + 1.3], [0.5, yF + 1.8], [0.12, yF + 2.1], [0.04, yF + 3.6], [0, yF + 3.7]], 10, [1, 1, 1]);
    engine.slots.brazier.push({ pos: [x, yL + 0.1, z], facing: 0, size: 2.2, tag: 'rings-lighthouse' });
    engine.slots.statue.push({ pos: [x, yF + 1.8, z], facing: 180, size: 4.5, tag: 'rings-lighthouse-top' });
    for (const F0 of faces) { const F = F0.at(0, 0, h1); engine.slots.banner.push({ pos: F.p(0, y1 - 1.0, 0.15), facing: 0, size: [2.6, 8], tag: 'rings-lighthouse' }); }
    // fix banner facings (per face)
    const bl = engine.slots.banner.slice(-4); bl.forEach((s, i) => { s.facing = [180, 270, 0, 90][i]; });
    return { pos: [x, 0, z], top: yF + 3.7, lantern: [x, yL + 1.5, z] };
  }
  ctx.slots.coral.push({ pos: [x, yTop1 + 0.2, z], normal: [0, 1, 0], size: 4, tag: 'rings-lighthouse' });
  return { pos: [x, 0, z], top: yTop1 };
}
