// Open arcade under the grand stair where it rides over the lagoon (shot 7 / ref 7: an arcaded
// bridge with a waterfall pouring out of every arch, the temple above).
//
// Transverse piers with cutwaters carry barrel vaults (axis east-west) under the flights; both faces
// are ashlar spandrel walls with voussoir arch rings, keystones, imposts and pilasters, clipped to the
// stair line. A stone spout trough under every keystone feeds a fall: the spill points are published
// in engine.registry.aqueductSpills (the waterfalls module renders them).
import { chamferBox, frameXZ, Frame, FACES } from './geo.js';
import { wallRun, moulding, PROFILES, blockColor, STONE_COL, buttress, planArch } from './masonry.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** stair deck height (nosing line) at z from the plan */
export function deckAt(plan, z) {
  for (const s of plan.segs) {
    if (z >= s.z0 - 1e-6 && z <= s.z1 + 1e-6) return s.kind === 'flight' ? s.y0 - ((z - s.z0) / (s.z1 - s.z0)) * (s.y0 - s.y1) : s.y0;
  }
  return null;
}

/**
 * Plan the arcade between zA (end of the solid substructure / bastion) and the point where the deck
 * gets too low for an arch. Returns null when there is no room.
 */
export function planArcade(plan, opts = {}) {
  const segs = plan.segs;
  // start after the last bastion landing that still stands on the spur, end before the quay
  const quay = segs.find((s) => s.kind === 'quay');
  const startSeg = opts.zStart ?? 63.0;
  const zA = startSeg;
  const zLimit = quay ? quay.z0 : plan.zEnd;
  const pier = opts.pier ?? 1.8, pitch = opts.pitch ?? 5.7, minDeck = opts.minDeck ?? 6.4;
  const piers = [zA + pier / 2];
  for (;;) {
    const zn = piers[piers.length - 1] + pitch;
    if (zn + pier / 2 > zLimit - 0.5) break;
    const d = deckAt(plan, zn - pier / 2);
    if (d === null || d < minDeck) break;
    piers.push(zn);
  }
  if (piers.length < 2) return null;
  const bays = [];
  for (let k = 0; k < piers.length - 1; k++) {
    const z0 = piers[k] + pier / 2, z1 = piers[k + 1] - pier / 2;
    let dmin = Infinity; for (let z = z0; z <= z1 + 1e-6; z += 0.25) dmin = Math.min(dmin, deckAt(plan, z));
    const span = z1 - z0, r = span / 2;
    const crown = dmin - 1.35;
    bays.push({ z0, z1, zc: (z0 + z1) / 2, span, r, crown, ys: crown - r, dmin });
  }
  // the half-width of the faces: widest flight in the range + cheek thickness
  let hw = 0;
  for (const s of segs) if (s.z1 > zA && s.z0 < piers[piers.length - 1]) hw = Math.max(hw, s.w / 2);
  return { zA, zB: piers[piers.length - 1] + pier / 2, piers, pier, bays, hw, W2: hw + 1.4 };
}

/** open voussoir ring on face frame F (s along the face, d outward, y absolute) */
function archRing(S, F, sc, ys, r, ring, rng, inDepth = 0.8) {
  const B = S.get('ashlar', F.o[0] + F.ax[0] * sc, F.o[2] + F.ax[2] * sc);
  const n = Math.max(9, Math.round((Math.PI * (r + ring / 2)) / 0.5)) | 1;
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI - (Math.PI * i) / n, a1 = Math.PI - (Math.PI * (i + 1)) / n;
    const key = i === (n - 1) / 2;
    const R1 = r + ring * (key ? 1.28 : 1) + (i % 2 ? 0.0 : 0.06), dF = key ? 0.16 : 0.07;
    const c = blockColor(rng, STONE_COL);
    const P = (a, rr, d) => F.p(sc + Math.cos(a) * rr, ys + Math.sin(a) * rr, d);
    const ctr = F.p(sc + Math.cos((a0 + a1) / 2) * (r + R1) / 2, ys + Math.sin((a0 + a1) / 2) * (r + R1) / 2, -0.5);
    const g = 0.012, b0 = a0 - g, b1 = a1 + g;
    B.aux = [0.05, 0.75, 0.25, 0];
    B.quadOut(P(b0, r, dF), P(b1, r, dF), P(b1, R1, dF), P(b0, R1, dF), c, ctr);
    B.quadOut(P(b0, R1, dF), P(b1, R1, dF), P(b1, R1, -0.25), P(b0, R1, -0.25), darker(c, 0.9), ctr);
    B.quadOut(P(b0, r, -inDepth), P(b1, r, -inDepth), P(b1, r, dF), P(b0, r, dF), darker(c, 0.8), F.p(sc, ys, dF));
    B.quadOut(P(b0, r, dF), P(b0, R1, dF), P(b0, R1, -0.25), P(b0, r, -0.25), darker(c, 0.8), ctr);
    B.quadOut(P(b1, R1, dF), P(b1, r, dF), P(b1, r, -0.25), P(b1, R1, -0.25), darker(c, 0.8), ctr);
  }
  B.aux = [0.1, 0.5, 0, 0];
  for (const sx of [-1, 1]) {
    const a = sx < 0 ? sc - r - ring * 1.15 : sc + r - 0.12, b = sx < 0 ? sc - r + 0.12 : sc + r + ring * 1.15;
    chamferBox(B, F, a, b, ys - 0.28, ys, -0.5, 0.15, 0.03, blockColor(rng, STONE_COL), 63 - 32);
  }
  B.aux = [0, 0, 0, 0];
}

/**
 * Build the arcade. ctx: acropolis context; A: planArcade result; X: stair axis.
 * Returns { spills, tris } (spills are also pushed into engine.registry.aqueductSpills).
 */
export function buildArcade(ctx, plan, A, X, rng) {
  const { S } = ctx;
  const W2 = A.W2, len = A.zB - A.zA;
  const yWet = -1.6;
  const spills = [];
  const topAt = (s) => deckAt(plan, A.zA + s) + 0.12;
  let yMax = -Infinity; for (let s = 0; s <= len; s += 0.5) yMax = Math.max(yMax, topAt(s));
  // ---- the two faces
  for (const side of [-1, 1]) {
    const F = side > 0 ? frameXZ(X + W2, 0, A.zA, 0, 1, 1, 0) : frameXZ(X - W2, 0, A.zA, 0, 1, -1, 0);
    const arches = A.bays.map((b) => planArch(b.zc - A.zA, yWet - 0.4, b.span, b.crown - (yWet - 0.4), 0.62));
    wallRun(S, 'ashlar', F, len, yWet - 0.5, yMax, {
      rng, courses: 'pseudo', batter: 0, rustic: true, rusticH: 2.6, groundAt: () => yWet, topAt, lite: true, damp: 1.0,
      cuts: (c0, c1) => arches.map((a) => a.cut(c0, c1)).filter(Boolean), drips: true,
      dripsAt: A.bays.map((b) => b.zc - A.zA),
    });
    for (const b of A.bays) {
      archRing(S, F, b.zc - A.zA, b.ys, b.r, 0.62, rng, 0.6);
      // spout trough under the keystone that feeds the fall
      const Bt = S.get('ashlar', F.p(b.zc - A.zA, 0, 0)[0], b.zc);
      const tw = b.span * 0.36, yT = b.crown - 0.95;
      const c = blockColor(rng, STONE_COL);
      Bt.aux = [0.3, 0.5, 0.6, 0];
      chamferBox(Bt, F, b.zc - A.zA - tw, b.zc - A.zA + tw, yT, yT + 0.32, -1.2, 0.85, 0.04, c);
      chamferBox(Bt, F, b.zc - A.zA - tw - 0.08, b.zc - A.zA + tw + 0.08, yT + 0.32, yT + 0.46, -1.2, 0.95, 0.03, darker(c, 1.02));
      Bt.aux = [0, 0, 0, 0];
      const sp = F.p(b.zc - A.zA, yT + 0.5, 1.05);
      spills.push({ pos: sp, dir: side > 0 ? 90 : 270, width: b.span * 0.62, flow: 0.72, id: `stair-arcade-${side > 0 ? 'e' : 'w'}${spills.length}`, kind: 'arcade', structure: 'grand-stair' });
    }
    // pilasters over the piers + cutwaters at the waterline
    for (let k = 0; k < A.piers.length; k++) {
      const zp = A.piers[k], s = zp - A.zA;
      const end = k === 0 || k === A.piers.length - 1;
      const yTopP = topAt(Math.max(0, Math.min(len, s + A.pier / 2))) - 0.75;
      if (!end) buttress(S, 'ashlar', F, s, 1.25, 0.32, 2.6, yTopP, rng, { setoffs: 0 });
      cutwater(S, F, s, A.pier + 0.25, end ? 1.0 : 1.7, yWet - 0.4, end ? 1.6 : 2.6, rng);
    }
    // string course at the deck edge is supplied by the stair parapet coping; add one at the imposts' mean height
    const yS = A.bays.reduce((a, b) => a + b.ys, 0) / A.bays.length;
    void yS;
  }
  // ---- pier side faces (seen through the arches) and barrel vaults
  for (let k = 0; k < A.piers.length; k++) {
    const zp = A.piers[k];
    for (const dz of [-1, 1]) {
      const bay = A.bays[dz > 0 ? k : k - 1];
      if (!bay) continue;
      const zf = zp + dz * A.pier / 2;
      const F = frameXZ(X - W2, 0, zf, 1, 0, 0, dz);
      wallRun(S, 'ashlar', F, 2 * W2, yWet - 0.5, bay.ys - 0.28, { rng, courses: 'pseudo', batter: 0, groundAt: () => yWet, lite: true, damp: 1.0, drips: false });
    }
  }
  for (const b of A.bays) {
    const Bv = S.get('ashlar', X, b.zc);
    const n = Math.max(10, Math.round((Math.PI * b.r) / 0.45));
    for (let i = 0; i < n; i++) {
      const a0 = (Math.PI * i) / n, a1 = (Math.PI * (i + 1)) / n;
      const rv = b.r + 0.03;
      const P = (a, x) => [x, b.ys + Math.sin(a) * rv, b.zc + Math.cos(a) * rv];
      const am = (a0 + a1) / 2;
      // voussoir courses of the vault: blocks staggered along x
      let x = X - W2 + 0.05 - (i % 2) * 0.7;
      while (x < X + W2 - 0.05) {
        const x0 = Math.max(X - W2 + 0.05, x), x1 = Math.min(X + W2 - 0.05, x + 1.5 + rng.random() * 1.2);
        const c = darker(blockColor(rng, STONE_COL), 0.86);
        Bv.aux = [0.45, 0.2, 0.1, 0];
        Bv.quadOut(P(a0 + 0.006, x0 + 0.01), P(a1 - 0.006, x0 + 0.01), P(a1 - 0.006, x1 - 0.01), P(a0 + 0.006, x1 - 0.01), c, [(x0 + x1) / 2, b.ys + Math.sin(am) * (rv + 1), b.zc + Math.cos(am) * (rv + 1)]);
        x = x1;
      }
    }
    // dark joint plane just behind the vault blocks
    const Bd = S.get('ashlar', X, b.zc + 0.1);
    Bd.aux = [1, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const a0 = (Math.PI * i) / n, a1 = (Math.PI * (i + 1)) / n, am = (a0 + a1) / 2, rr = b.r + 0.09;
      const P = (a, x) => [x, b.ys + Math.sin(a) * rr, b.zc + Math.cos(a) * rr];
      Bd.quadOut(P(a0, X - W2), P(a1, X - W2), P(a1, X + W2), P(a0, X + W2), [0.5, 0.48, 0.45], [X, b.ys + Math.sin(am) * (rr + 1), b.zc + Math.cos(am) * (rr + 1)]);
    }
    Bd.aux = [0, 0, 0, 0];
  }
  return { spills };
}

/** pointed cutwater at a pier end on face frame F: centred at s, width w, projection p, y0..y1, pyramidal cap */
function cutwater(S, F, s, w, p, y0, y1, rng) {
  const B = S.get('ashlar', F.o[0] + F.ax[0] * s, F.o[2] + F.ax[2] * s);
  const ctr = F.p(s, (y0 + y1) / 2, -0.5);
  let y = y0, ci = 0;
  while (y < y1 - 0.02) {
    const h = Math.min(y1 - y, ci++ % 2 ? 0.45 : 0.7);
    const wet = Math.max(0, 1 - (y - y0) / 2.4);
    const c = darker(blockColor(rng, STONE_COL), 1 - 0.38 * wet);
    const L = F.p(s - w / 2, y, 0), R = F.p(s + w / 2, y, 0), N = F.p(s, y, p);
    const L1 = F.p(s - w / 2, y + h, 0), R1 = F.p(s + w / 2, y + h, 0), N1 = F.p(s, y + h, p);
    B.aux = [0.25 * wet, 0.5, 0, 0];
    B.quadOut(L, N, N1, L1, c, ctr);
    B.quadOut(N, R, R1, N1, darker(c, 0.95), ctr);
    y += h;
  }
  // cap: low pyramid back to the face
  const c = blockColor(rng, STONE_COL);
  const L = F.p(s - w / 2 - 0.08, y1, 0), R = F.p(s + w / 2 + 0.08, y1, 0), N = F.p(s, y1, p + 0.1), T = F.p(s, y1 + 0.9, 0.05);
  B.aux = [0, 0.6, 0, 0];
  B.quadOut(L, N, T, T, c, ctr); B.quadOut(N, R, T, T, darker(c, 0.95), ctr);
  B.aux = [0, 0, 0, 0];
}
