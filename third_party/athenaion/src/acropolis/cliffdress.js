// Cliff dressing for the sheer faces of the south side (refs 3, 7, 9): small shrines (aediculae with a
// statue), corbelled balconies with balustrades, and masonry caps (short retaining walls with a coping)
// stacked on the narrow ledges of the sheer bay under colossus A.
import { heightAt } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { chamferBox, frameFacing, frameXZ } from './geo.js';
import { wallRun, moulding, PROFILES, blockColor, STONE_COL } from './masonry.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
/** within r of a fall's path (lip → 12 m downstream along its direction, plus half its width)? (r4: was 30 m, which emptied the sheer bay) */
const nearFall = (x, z, r) => L.WATERFALLS.some((w) => {
  const a = (w.dir * Math.PI) / 180, dx = Math.sin(a), dz = -Math.cos(a);
  const t = Math.max(-2, Math.min(12, (x - w.from[0]) * dx + (z - w.from[2]) * dz));
  return Math.hypot(x - w.from[0] - dx * t, z - w.from[2] - dz * t) < w.width * 0.5 + r;
});

/**
 * Narrow ledges at x along the south face: walk z southward and report every flat step
 * (≥ 1.6 m deep) followed by a drop of ≥ 5 m. → [{ x, zBack, zEdge, y, drop }]
 */
export function ledgesAt(x, z0 = -12, z1 = 60) {
  const out = [];
  let cur = null;
  for (let z = z0; z <= z1; z += 0.5) {
    const h = heightAt(x, z), hn = heightAt(x, z + 0.5);
    if (Math.abs(hn - h) < 0.35 && h > 3) {
      if (!cur || Math.abs(h - cur.y) > 0.8) cur = { x, zBack: z, zEdge: z, y: h };
      else cur.zEdge = z;
    } else if (cur) {
      const drop = cur.y - heightAt(x, cur.zEdge + 4);
      if (cur.zEdge - cur.zBack >= 1.5 && drop > 5) out.push({ ...cur, drop });
      cur = null;
    }
  }
  return out;
}

/** aedicula shrine facing `facing`: podium, two columns, entablature, pediment; statue slot inside */
export function shrine(ctx, x, z, y, facing, rng, s = 1) {
  const { S } = ctx;
  const F = frameFacing(x, 0, z, facing);
  const B = S.get('marble', x, z);
  const c = blockColor(rng, STONE_COL), dk = darker(c, 0.85);
  const W = 3.0 * s, D = 2.0 * s, P = 0.9 * s, colH = 2.9 * s;
  // podium with a moulded cap
  chamferBox(B, F, -W / 2, W / 2, y - 1.2, y + P, -D / 2, D / 2, 0.04, c, 63 - 8, dk);
  chamferBox(B, F, -W / 2 - 0.08, W / 2 + 0.08, y + P, y + P + 0.14, -D / 2 - 0.08, D / 2 + 0.08, 0.03, c);
  const y0 = y + P + 0.14;
  // back wall + side antae
  chamferBox(B, F, -W / 2 + 0.1, W / 2 - 0.1, y0, y0 + colH, -D / 2 + 0.05, -D / 2 + 0.35, 0.02, darker(c, 0.92));
  for (const sx of [-1, 1]) chamferBox(B, F, sx * (W / 2 - 0.1) - 0.18, sx * (W / 2 - 0.1) + 0.18, y0, y0 + colH, -D / 2 + 0.05, D / 2 - 0.25, 0.02, c);
  // two columns (octagonal shafts, simple capitals)
  for (const sx of [-0.55, 0.55]) {
    const cx = sx * W * 0.5, cz = D / 2 - 0.35, r = 0.17 * s;
    chamferBox(B, F, cx - 0.26 * s, cx + 0.26 * s, y0, y0 + 0.16, cz - 0.26 * s, cz + 0.26 * s, 0.03, c);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (a, yy, rr) => F.p(cx + Math.cos(a) * rr, yy, cz + Math.sin(a) * rr);
      B.quadOut(p(a0, y0 + 0.16, r * 1.08), p(a1, y0 + 0.16, r * 1.08), p(a1, y0 + colH - 0.22, r * 0.92), p(a0, y0 + colH - 0.22, r * 0.92), c, F.p(cx, y0 + colH / 2, cz));
    }
    chamferBox(B, F, cx - 0.27 * s, cx + 0.27 * s, y0 + colH - 0.22, y0 + colH, cz - 0.27 * s, cz + 0.27 * s, 0.04, c);
  }
  // entablature + pediment (triangular prism)
  const yE = y0 + colH;
  chamferBox(B, F, -W / 2 - 0.1, W / 2 + 0.1, yE, yE + 0.45 * s, -D / 2, D / 2 + 0.1, 0.03, c, 63, dk);
  const yP = yE + 0.45 * s, hP = 0.75 * s;
  const L0 = F.p(-W / 2 - 0.15, yP, D / 2 + 0.15), R0 = F.p(W / 2 + 0.15, yP, D / 2 + 0.15), T0 = F.p(0, yP + hP, D / 2 + 0.15);
  const L1 = F.p(-W / 2 - 0.15, yP, -D / 2), R1 = F.p(W / 2 + 0.15, yP, -D / 2), T1 = F.p(0, yP + hP, -D / 2);
  const ctr = F.p(0, yP + hP * 0.3, 0);
  B.quadOut(L0, R0, T0, T0, c, ctr); B.quadOut(L1, R1, T1, T1, c, ctr);
  B.quadOut(L0, T0, T1, L1, darker(c, 0.95), ctr); B.quadOut(T0, R0, R1, T1, darker(c, 0.95), ctr);
  const G = S.get('gold', x, z);
  chamferBox(G, F, -0.12, 0.12, yP + hP, yP + hP + 0.35 * s, D / 2 - 0.05, D / 2 + 0.15, 0.02, [1, 1, 1]);
  ctx.slots.statue.push({ pos: F.p(0, y0, -0.1), facing, size: 1.9 * s, tag: 'acro-shrine' });
  ctx.footprints.addRect(x, z, W / 2 + 0.3, D / 2 + 0.3, 0, 'acro-wall');
}

/** corbelled balcony (facing south) projecting `proj` m over the ledge edge, balustrade on three sides */
export function balcony(ctx, x, zEdge, y, w, proj, rng) {
  const { S } = ctx;
  const F = frameXZ(x - w / 2, 0, zEdge, 1, 0, 0, 1); // s along +x (0..w), d outward (south)
  const B = S.get('ashlar', x, zEdge);
  const c = blockColor(rng, STONE_COL), dk = darker(c, 0.82);
  chamferBox(B, F, 0, w, y - 0.42, y, -1.2, proj, 0.04, c, 63, dk);
  const nC = Math.max(2, Math.round(w / 1.6));
  for (let i = 0; i < nC; i++) {
    const sc = 0.4 + ((w - 0.8) * i) / (nC - 1);
    for (let k = 0; k < 3; k++) chamferBox(B, F, sc - 0.22, sc + 0.22, y - 0.42 - 0.38 * (k + 1), y - 0.42 - 0.38 * k, -1.0, proj * (0.85 - 0.27 * k), 0.03, darker(c, 0.95 - 0.04 * k), 63 - 8);
  }
  const Bp = S.get('paving', x, zEdge);
  Bp.quadOut(F.p(0, y + 0.005, -1.2), F.p(w, y + 0.005, -1.2), F.p(w, y + 0.005, proj), F.p(0, y + 0.005, proj), [1, 1, 1], F.p(w / 2, y - 3, 0));
  ctx.balus.addRun(S, 'marble', F.at(0, 0, proj - 0.25), 0.25, w - 0.25, y, { postEvery: 2.4 });
  for (const sx of [-1, 1]) {
    const xs = sx < 0 ? x - w / 2 + 0.25 : x + w / 2 - 0.25;
    const Fs = frameXZ(xs, 0, zEdge - 0.6, 0, 1, sx, 0);
    ctx.balus.addRun(S, 'marble', Fs, 0, proj - 0.5 + 0.6, y, { postEvery: 2.0 });
  }
  if (rng.random() < 0.6) ctx.slots.urn.push({ pos: F.p(0.6, y, proj - 0.7), facing: 180, size: 0.8, tag: 'acro-balcony' });
  if (rng.random() < 0.5) ctx.slots.brazier.push({ pos: F.p(w - 0.6, y, proj - 0.7), facing: 180, size: 0.7, tag: 'acro-balcony-tripod' });
  ctx.slots.ivy.push({ pos: F.p(rng.range(0, w), y - 0.3, proj + 0.05), facing: 180, size: rng.range(2, 5), width: rng.range(1, 2.4), tag: 'acro-balcony' });
  ctx.footprints.addRect(x, zEdge + proj / 2 - 0.6, w / 2, proj / 2 + 0.6, 0, 'acro-wall');
}

/** short capping wall along a ledge edge (masonry cap), facing south */
export function capWall(ctx, x, zEdge, y, len, rng) {
  const F = frameXZ(x - len / 2, 0, zEdge + 0.3, 1, 0, 0, 1);
  const groundAt = (s) => { const p = F.p(s, 0, 0.6); return heightAt(p[0], p[2]); };
  let gmin = Infinity; for (let s = 0; s <= len; s += 1) gmin = Math.min(gmin, groundAt(s));
  const yBot = Math.max(gmin - 0.8, y - 9);
  wallRun(ctx.S, 'ashlar', F, len, yBot, y - 0.35, { rng, courses: 'random', batter: 0.02, groundAt, lite: true, damp: 0.6 });
  moulding(ctx.S, 'ashlar', F, 0, len, y - 0.35, PROFILES.coping(1.2), blockColor(rng, STONE_COL), 0);
}

/**
 * Dress the sheer bay (and other narrow ledges) between x0 and x1: shrines, balconies, caps.
 */
export function dressSheerFaces(ctx, x0, x1, rng, opts = {}) {
  const spots = [];
  for (let x = x0; x <= x1; x += 2.5) for (const l of ledgesAt(x)) spots.push(l);
  const used = [];
  const free = (x, z, r, fallR = 5.5) => !used.some((u) => Math.hypot(u[0] - x, u[1] - z) < r + u[2]) && !nearFall(x, z, fallR) && ctx.footprints.isFree(x, z, r * 0.6, ['acro-wall', 'waterfall']);
  let nS = 0, nB = 0, nC = 0;
  // the deepest few become shrines, edges with a big drop get balconies, the rest masonry caps
  spots.sort((a, b) => (b.zEdge - b.zBack) - (a.zEdge - a.zBack));
  for (const sp of spots) {
    const depth = sp.zEdge - sp.zBack;
    if (sp.y < 6 || sp.y > (opts.maxY ?? 50)) continue;
    const zc = (sp.zBack + sp.zEdge) / 2;
    if (depth >= 2.6 && nS < (opts.shrines ?? 5) && free(sp.x, zc, 3.2)) {
      shrine(ctx, sp.x, zc - 0.2, sp.y + 0.02, 180 + rng.range(-8, 8), rng, depth > 3.4 ? 1.1 : 0.9);
      used.push([sp.x, zc, 3.2]); nS++;
      continue;
    }
    if (sp.drop > 8 && nB < (opts.balconies ?? 6) && free(sp.x, sp.zEdge, 3.0)) {
      balcony(ctx, sp.x, sp.zEdge, sp.y + 0.05, rng.range(3.2, 4.6), rng.range(1.4, 2.2), rng);
      used.push([sp.x, sp.zEdge, 3.0]); nB++;
      continue;
    }
    if (nC < (opts.caps ?? 10) && free(sp.x, sp.zEdge, 3.5, 3.5)) {
      capWall(ctx, sp.x, sp.zEdge, sp.y + 0.6, rng.range(5, 8), rng);
      used.push([sp.x, sp.zEdge, 3.5]); nC++;
    }
  }
  return { spots: spots.length, shrines: nS, balconies: nB, caps: nC };
}
