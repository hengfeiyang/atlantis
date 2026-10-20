// (r4) Arched footbridge from the stair-foot quay to the tholos island (ref 4: the island is tied to the
// stair plaza by a small arched bridge; the layout ISLAND entry has always promised it). Masonry body with
// open semicircular arches over the lagoon (vault soffits, voussoir rings), flights of steps at both ends,
// balustrades on the level deck, gold-topped lamp posts at the ends. Only shot 4 (and the edge of 2)
// sees it; it stays out of shots 1, 3, 7, 8, 9.
import { heightAt } from '../world/heightfield.js';
import { chamferBox, frameXZ, frameFacing } from './geo.js';
import { wallRun, planArch, blockColor, STONE_COL, moulding, PROFILES } from './masonry.js';
import { lampPost } from './ornament.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/**
 * A: [x, y, z] start on the quay (y = quay level); C: [x, z] island centre; reach: island radius at which
 * the bridge lands. Returns { len, arches } or null.
 */
export function islandBridge(ctx, rng, A, C, opts = {}) {
  const { S } = ctx;
  const W = opts.width ?? 4.4, deckY = opts.deckY ?? 5.6, rise = 0.2, tread = 0.38;
  let ux = C[0] - A[0], uz = C[1] - A[2];
  const Ltot = Math.hypot(ux, uz); ux /= Ltot; uz /= Ltot;
  const nx = -uz, nz = ux; // left normal (ax = u, az = n is right-handed)
  // landing point on the island: first t where the rock reaches deck - 1.2
  let tEnd = null;
  for (let t = 4; t < Ltot - 4; t += 0.25) if (heightAt(A[0] + ux * t, A[2] + uz * t) > deckY - 1.2) { tEnd = t; break; }
  if (tEnd === null) return null;
  const yIsl = Math.max(deckY, heightAt(A[0] + ux * (tEnd + 3), A[2] + uz * (tEnd + 3)) + 0.05);
  const nUp = Math.ceil((deckY - A[1]) / rise), tUp = nUp * tread;          // flight up from the quay
  const nDn = Math.max(0, Math.round((yIsl - deckY) / rise)), tIs = nDn * tread; // flight up onto the island
  const L = tEnd + tIs + 0.6;
  const surf = (t) => (t < tUp ? A[1] + Math.ceil(Math.max(0, t) / tread) * rise : t < tEnd ? deckY : Math.min(yIsl, deckY + Math.ceil((t - tEnd) / tread) * rise));
  const P = (t, y, d) => [A[0] + ux * t + nx * d, y, A[2] + uz * t + nz * d];
  const XZ = (t, y, d) => { const p = P(t, y, d); return [p[0], p[2]]; };
  const Fc = frameXZ(A[0], 0, A[2], ux, uz, nx, nz);
  // ---- arches over the open water between the flights
  const a0 = tUp + 0.8, a1 = tEnd - 0.8;
  const nA = Math.max(1, Math.round((a1 - a0) / 6.4));
  const span = (a1 - a0) / nA, pier = 1.3, r = (span - pier) / 2;
  const crown = deckY - 0.85, ys = crown - r;
  const arches = [];
  if (r > 1.2 && ys > -0.4) for (let k = 0; k < nA; k++) arches.push({ tc: a0 + span * (k + 0.5), r, ys });
  // ---- side walls (spandrels + parapets over the flights), arch openings cut through
  for (const side of [1, -1]) {
    const d = side * W / 2;
    // frame on this face, right-handed with outward = side * n
    const o = P(side > 0 ? 0 : L, 0, d);
    const F = side > 0 ? frameXZ(o[0], 0, o[2], ux, uz, nx, nz) : frameXZ(o[0], 0, o[2], -ux, -uz, -nx, -nz);
    const tOf = (s) => (side > 0 ? s : L - s);
    const sOf = (t) => (side > 0 ? t : L - t);
    const groundAt = (s) => { const p = P(tOf(s), 0, d * 1.15); return Math.max(-3, heightAt(p[0], p[2])); };
    const flat = (t) => t >= tUp && t <= tEnd;
    const topAt = (s) => { const t = tOf(s); return flat(t) ? deckY - 0.3 : surf(t) + 0.95; };
    const plans = arches.map((a) => planArch(sOf(a.tc), -1.2, 2 * a.r, a.ys + a.r + 1.2, 0.5));
    wallRun(S, 'ashlar', F, L, -3.2, Math.max(deckY - 0.3, yIsl + 0.95), {
      rng, courses: 'pseudo', batter: 0, rustic: true, rusticH: 2.2, groundAt, topAt, lite: true, damp: 0.9,
      cuts: plans.length ? (c0, c1) => plans.map((A2) => A2.cut(c0, c1)).filter(Boolean) : null,
    });
    // string course + balustrade on the level deck
    const sA = sOf(side > 0 ? tUp : tEnd), sB = sOf(side > 0 ? tEnd : tUp);
    moulding(S, 'ashlar', F, Math.min(sA, sB), Math.max(sA, sB), deckY - 0.3, PROFILES.coping(1.0), blockColor(rng, STONE_COL), 0);
    ctx.balus.addRun(S, 'marble', F.at(0, 0, -0.25), Math.min(sA, sB) + 0.2, Math.max(sA, sB) - 0.2, deckY, { postEvery: 2.6 });
    // voussoir rings on this face
    for (const a of arches) {
      const B = S.get('ashlar', ...XZ(a.tc, 0, d));
      const nV = 11;
      for (let i = 0; i < nV; i++) {
        const q0 = Math.PI * (i / nV) + 0.01, q1 = Math.PI * ((i + 1) / nV) - 0.01;
        const key = i === (nV - 1) / 2;
        const R1 = a.r + (key ? 0.62 : 0.5);
        const Q = (q, rr, dd) => P(a.tc + Math.cos(q) * rr, a.ys + Math.sin(q) * rr, d + side * dd);
        const c = blockColor(rng, STONE_COL);
        B.aux = [0.05, 0.6, 0.2, 0];
        B.quadOut(Q(q0, a.r, 0.07), Q(q1, a.r, 0.07), Q(q1, R1, 0.07), Q(q0, R1, 0.07), c, Q((q0 + q1) / 2, a.r, -2));
        B.quadOut(Q(q0, R1, 0.07), Q(q1, R1, 0.07), Q(q1, R1, -0.1), Q(q0, R1, -0.1), darker(c, 0.9), Q((q0 + q1) / 2, a.r, -2));
        B.aux = [0, 0, 0, 0];
      }
    }
  }
  // ---- vault soffits + jambs (open through the bridge)
  for (const a of arches) {
    const B = S.get('ashlar', ...XZ(a.tc, 0, 0));
    B.aux = [0.6, 0, 0.3, 0];
    const nV = 14, c = darker(blockColor(rng, STONE_COL), 0.8);
    for (let i = 0; i < nV; i++) {
      const q0 = Math.PI * (i / nV), q1 = Math.PI * ((i + 1) / nV);
      const Q = (q, dd) => P(a.tc + Math.cos(q) * a.r, a.ys + Math.sin(q) * a.r, dd);
      B.quadOut(Q(q0, -W / 2), Q(q1, -W / 2), Q(q1, W / 2), Q(q0, W / 2), c, P(a.tc, a.ys - 3, 0));
    }
    for (const sx of [-1, 1]) {
      const t = a.tc + sx * a.r;
      B.quadOut(P(t, -2, -W / 2), P(t, a.ys, -W / 2), P(t, a.ys, W / 2), P(t, -2, W / 2), c, P(t + sx * 3, 0, 0));
    }
    B.aux = [0, 0, 0, 0];
  }
  // ---- deck: steps + level paving
  const Bt = S.get('tread', ...XZ(L / 2, 0, 0));
  for (let i = 0; i < nUp; i++) {
    const t0 = i * tread - 0.02, t1 = (i + 1) * tread, yT = A[1] + (i + 1) * rise;
    const c = blockColor(rng, STONE_COL);
    Bt.aux = [0.2, 0.7, 0, 0];
    chamferBox(Bt, Fc, t0, t1 + 0.02, yT - rise - 0.25, yT, -W / 2 + 0.02, W / 2 - 0.02, 0.025, c, 63 - 8, darker(c, 0.85));
  }
  for (let i = 0; i < nDn; i++) {
    const t0 = tEnd + i * tread - 0.02, t1 = tEnd + (i + 1) * tread, yT = deckY + (i + 1) * rise;
    const c = blockColor(rng, STONE_COL);
    chamferBox(Bt, Fc, t0, t1 + 0.02, yT - rise - 0.25, yT, -W / 2 + 0.02, W / 2 - 0.02, 0.025, c, 63 - 8, darker(c, 0.85));
  }
  Bt.aux = [0, 0, 0, 0];
  const Bp = S.get('paving', ...XZ((tUp + tEnd) / 2, 0, 0));
  Bp.quadOut(P(tUp, deckY, -W / 2 + 0.02), P(tEnd, deckY, -W / 2 + 0.02), P(tEnd, deckY, W / 2 - 0.02), P(tUp, deckY, W / 2 - 0.02), [1, 1, 1], P((tUp + tEnd) / 2, deckY - 3, 0));
  // ---- lamp posts at the ends of the level deck
  for (const t of [tUp + 0.5, tEnd - 0.5]) for (const sx of [-1, 1]) {
    const p = P(t, deckY, sx * (W / 2 - 0.5));
    const flame = lampPost(S, frameFacing(p[0], 0, p[2], 0), deckY, rng, 3.2);
    ctx.slots.lamp.push({ pos: flame, facing: 0, size: 0.32, tag: 'acro-bridge' });
  }
  for (let t = 0; t <= L; t += 3) ctx.footprints.addCircle(...XZ(t, 0, 0), W / 2 + 0.6, 'acro-bridge');
  return { len: L, arches: arches.length, deckY, tEnd };
}
