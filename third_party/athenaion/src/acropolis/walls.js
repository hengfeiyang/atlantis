// Retaining walls along the plateau rim and the terrace edges, derived from the terrain contours.
import { heightAt } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { simplify, frameXZ, chamferBox, headingOf, lin, Frame, FACES } from './geo.js';
import { slopedBox } from './balustrade.js';
import { heightAt as _h } from '../world/heightfield.js';
import { pedestal, lampPost, planter } from './ornament.js';
import { opening } from './houses.js';
import { wallRun, moulding, buttress, PROFILES, planRuns, blockColor, STONE_COL, planArch, buildArch, subtractIntervals } from './masonry.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** zones where walls must not be built (stair corridor, waterfall lips, gates) */
export class Zones {
  constructor() { this.z = []; }
  rect(cx, cz, hw, hd, rot = 0, tag = '') { this.z.push({ t: 'r', cx, cz, hw, hd, c: Math.cos(rot), s: Math.sin(rot), tag }); }
  circle(x, z, r, tag = '') { this.z.push({ t: 'c', x, z, r, tag }); }
  hit(x, z, pad = 0, onlyTag = null) {
    for (const q of this.z) {
      if (onlyTag && q.tag !== onlyTag) continue;
      if (q.t === 'c') { if (Math.hypot(x - q.x, z - q.z) < q.r + pad) return q; }
      else {
        const dx = x - q.cx, dz = z - q.cz;
        const lx = dx * q.c - dz * q.s, lz = dx * q.s + dz * q.c;
        if (Math.abs(lx) < q.hw + pad && Math.abs(lz) < q.hd + pad) return q;
      }
    }
    return null;
  }
}

function lineIntersect(p, u, q, v) {
  // p + t u = q + s v
  const den = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(den) < 0.08) return null;
  const t = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den;
  return [p[0] + u[0] * t, p[1] + u[1] * t];
}

/**
 * Build a wall chain along a contour.
 * spec: { line, topLevel, lowLevel, kind:'rim'|'terrace'|'quay', ledgeCheck: level for ledge test, bounds(x,z)→bool,
 *         maxH, balustrade:boolean|fn(n), rng }
 */
export function planWallLine(ctx, spec) {
  const { grid } = ctx;
  const rng = spec.rng;
  const line = simplify(spec.line, spec.tol ?? 2.0);
  const segs = planRuns(line, { lowLevel: spec.lowLevel, topLevel: spec.topLevel, grid, maxOff: spec.maxOff ?? 10 });
  // validity
  for (const sg of segs) {
    if (sg.faceOff === null && spec.partialFallback) {
      // no full drop within reach (a long slope / intermediate ledge): cap the edge with a partial wall
      const off = sg.offFor(spec.topLevel - spec.partialFallback);
      if (off !== null) { sg.faceOff = sg.fullOff = off; sg.partialOnly = spec.partialFallback; }
    }
    sg.ok = sg.faceOff !== null && sg.faceOff < (spec.maxOff ?? 10) - 0.5 && sg.len > 0.5;
    const mx = (sg.a[0] + sg.b[0]) / 2, mz = (sg.a[1] + sg.b[1]) / 2;
    if (spec.bounds && !spec.bounds(mx, mz, sg)) sg.ok = false;
    if (sg.ok && spec.ledgeAbove !== undefined) {
      // is there a ledge behind this edge (i.e. not a sheer cliff)? march inward until ground rises above the ledge
      let w = 0;
      for (let o = 1; o < 40; o += 1) { if (grid.sample(mx - sg.n[0] * o, mz - sg.n[1] * o) > spec.ledgeAbove) break; w = o; }
      sg.ledgeW = w;
      if (w < (spec.minLedge ?? 9)) sg.ok = false;
    }
  }
  // chains of consecutive valid segments
  const closed = Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]) < 0.01;
  const chains = [];
  let cur = [];
  for (const sg of segs) { if (sg.ok) cur.push(sg); else if (cur.length) { chains.push(cur); cur = []; } }
  if (cur.length) {
    if (closed && chains.length && segs[0].ok) chains[0] = cur.concat(chains[0]);
    else chains.push(cur);
  }
  const allClosed = closed && segs.every((s) => s.ok);
  return {
    spec,
    chains: chains.map((ch) => {
      let top = -Infinity;
      for (const sg of ch) top = Math.max(top, sg.top);
      top = Math.min(top, spec.topLevel + 1.6) + 0.2;
      if (spec.fixedTop !== undefined) top = spec.fixedTop;
      return { ch, loop: allClosed && chains.length === 1, top };
    }),
  };
}

/** build a planned wall line; returns built length (m) */
export function buildWallPlan(ctx, plan) {
  let total = 0;
  for (const c of plan.chains) total += buildChain(ctx, plan.spec, c.ch, c.loop, c.top);
  return total;
}

/** where does a planned chain's face cross the line x = X (south-most crossing)? → {z, top} | null */
export function chainCrossing(plan, X) {
  let best = null;
  for (const c of plan.chains) for (const sg of c.ch) {
    const ax = sg.a[0] + sg.n[0] * sg.faceOff, az = sg.a[1] + sg.n[1] * sg.faceOff;
    const bx = sg.b[0] + sg.n[0] * sg.faceOff, bz = sg.b[1] + sg.n[1] * sg.faceOff;
    if ((ax - X) * (bx - X) > 0 || ax === bx) continue;
    const t = (X - ax) / (bx - ax);
    const z = az + (bz - az) * t;
    const ze = sg.a[1] + (sg.b[1] - sg.a[1]) * t;
    if (!best || z > best.z) best = { z, zEdge: ze, top: c.top };
  }
  return best;
}

function buildChain(ctx, spec, ch, loop, top) {
  const { S, zones, engine, balus, slots } = ctx;
  const rng = spec.rng;
  // masonry height per segment: full retaining wall, partial wall capping the cliff, or kerb only
  for (const sg of ch) {
    const mx = (sg.a[0] + sg.b[0]) / 2, mz = (sg.a[1] + sg.b[1]) / 2;
    let mH = spec.heightFor ? spec.heightFor(mx, mz, headingOf(sg.n[0], sg.n[1]), sg) : Infinity;
    if (sg.partialOnly) mH = Math.min(mH, sg.partialOnly + 1);
    sg.mH = mH;
    if (mH < 60) {
      const off = sg.offFor(top - mH + 1.0);
      sg.faceOff = off === null ? sg.fullOff : Math.min(off, sg.fullOff);
    } else sg.faceOff = sg.fullOff;
  }
  // face corner points
  const offs = ch.map((sg) => [[sg.a[0] + sg.n[0] * sg.faceOff, sg.a[1] + sg.n[1] * sg.faceOff], [sg.b[0] + sg.n[0] * sg.faceOff, sg.b[1] + sg.n[1] * sg.faceOff]]);
  const corners = [];
  const n = ch.length;
  for (let i = 0; i <= n; i++) {
    if (i === 0 && !loop) { corners.push(offs[0][0]); continue; }
    if (i === n && !loop) { corners.push(offs[n - 1][1]); continue; }
    const A = ch[(i - 1 + n) % n], B = ch[i % n];
    const pA = offs[(i - 1 + n) % n][1], pB = offs[i % n][0];
    const X = lineIntersect(pA, A.u, pB, B.u);
    corners.push(X && Math.hypot(X[0] - pA[0], X[1] - pA[1]) < 6 ? X : [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2]);
  }
  const maxHBase = spec.maxH ?? 30;
  let built = 0;
  const corniceH = spec.kind === 'quay' ? 0.45 : 0.9;
  const copeH = 0.32;
  const yMasonTop = top - copeH - corniceH * 0.98;
  for (let i = 0; i < n; i++) {
    const sg = ch[i];
    const a = corners[i], b = corners[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.6) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const F = frameXZ(a[0], 0, a[1], ux, uz, -uz, ux);
    const heading = headingOf(-uz, ux);
    // faces nobody looks at in the shots (north / east) get a lower masonry cap on the cliff
    const maxH = typeof spec.maxHFor === 'function' ? spec.maxHFor(heading, maxHBase) : maxHBase;
    // free intervals (outside zones)
    const ivs = [];
    let st = null;
    for (let s = 0; s <= len + 1e-6; s += 0.4) {
      const p = F.p(Math.min(s, len), 0, 0.5);
      const blocked = zones.hit(p[0], p[2], 0.2);
      if (!blocked && st === null) st = s;
      if (blocked && st !== null) { ivs.push([st, s - 0.4]); st = null; }
    }
    if (st !== null) ivs.push([st, len]);
    const groundAt = (s) => heightAt(a[0] + ux * s + (-uz) * 0.4, a[1] + uz * s + ux * 0.4);
    for (const [s0, s1] of ivs) {
      if (s1 - s0 < 0.8) continue;
      // foundation level: lowest ground along the face, clamped
      let gmin = Infinity, gmax = -Infinity;
      for (let s = s0; s <= s1; s += 1.5) { const g = groundAt(s); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
      gmin = Math.min(gmin, groundAt(s1)); gmax = Math.max(gmax, groundAt(s1));
      const yBot = Math.max(gmin - 0.8, top - maxH, sg.mH < 60 ? top - sg.mH - 7 : -1e9);
      const H = yMasonTop - yBot;
      if (H < 0.8) continue;
      const subGround = (s) => groundAt(s0 + s);
      const Fs = F.at(s0, 0, 0);
      const runLen = s1 - s0;
      // buttress positions, then blind arches / niches in the bays between them (ref 4, 7)
      const bPos = [];
      const every = (spec.buttressEvery ?? 19) * (sg.mH < 60 ? 1.4 : 1);
      const nb = H > 7 && runLen > 9 ? Math.floor((runLen - 4) / every) : -1;
      const off = nb >= 0 ? (runLen - nb * every) / 2 : 0;
      for (let k = 0; k <= nb; k++) { const sb = off + k * every; if (sb >= 2 && sb <= runLen - 2) bPos.push(sb); }
      // (r5) flights of steps climbing along some terrace walls from the ledge below (refs 3, 4, 9)
      let stairSpan = null;
      if (spec.kind === 'terrace' && H > 3.5 && H < 15 && heading > 100 && heading < 290 && rng.random() < 0.75) {
        const rise = top - (gmin + 0.05);
        const Ls = Math.round(rise / 0.32) * 0.3, ws = 2.1;
        const D = (ctx.wsDbg ||= { fp: 0, slope: 0, arch: 0, len: 0 });
        if (runLen < Ls + 2.2) D.len++;
        // anywhere along the run (the buttresses it would cover are dropped below)
        for (let tr = 0; tr < 5 && !stairSpan && runLen >= Ls + 2.2; tr++) {
          const lo = 0.9 + rng.random() * (runLen - Ls - 1.8), hi = lo + Ls;
          const dir = rng.random() < 0.5 ? 1 : -1, s0 = dir > 0 ? lo : hi;
          let free = true, gLo = Infinity, gHi = -Infinity;
          for (let s = lo; s <= hi + 0.01 && free; s += 1.5) {
            const p = Fs.p(s, 0, ws * 0.6), q = Fs.p(s, 0, ws + 1.5), g = subGround(s);
            gLo = Math.min(gLo, g); gHi = Math.max(gHi, g);
            if (!ctx.footprints.isFree(p[0], p[2], ws * 0.5, ['acro-wall']) || heightAt(q[0], q[2]) < g - 3) free = false;
          }
          if (!free) { D.fp++; continue; }
          if (gHi - gLo > 1.6 || top - gLo < 3) { D.slope++; continue; }
          const r = wallStair(ctx, Fs, s0, dir, gLo + 0.05, top, ws, rng);
          stairSpan = [lo, hi];
          for (let i = bPos.length - 1; i >= 0; i--) if (bPos[i] > lo - 1.8 && bPos[i] < hi + 1.8) bPos.splice(i, 1);
          const pm = Fs.p((lo + hi) / 2, 0, ws / 2);
          ctx.footprints.addRect(pm[0], pm[2], (hi - lo) / 2 + 0.5, ws / 2 + 0.4, Math.atan2(ux, uz) + Math.PI / 2, 'acro-wall-stair');
          if (rng.random() < 0.6) slots.urn.push({ pos: r.newel, facing: heading, size: 0.7, tag: 'acro-wall-stair' });
          ctx.nWallStairs = (ctx.nWallStairs || 0) + 1;
        }
      }
      const arches = [];
      if (spec.arches && H > 9 && runLen > 8 && gmax - gmin < 2.2 && sg.mH >= 60) {
        const bays = [0, ...bPos, runLen];
        for (let k = 0; k < bays.length - 1; k++) {
          const a0 = bays[k] + (k > 0 ? 1.8 : 0.8), a1 = bays[k + 1] - (k < bays.length - 2 ? 1.8 : 0.8);
          const bw = a1 - a0;
          if (bw < 5.5) continue;
          const nA = bw > 15 ? 2 : 1;
          for (let j = 0; j < nA; j++) {
            if (rng.random() < (spec.archSkip ?? 0.15)) continue;
            const sc = a0 + (bw * (j + 0.5)) / nA;
            if (stairSpan && sc + 3 > stairSpan[0] && sc - 3 < stairSpan[1]) continue;
            const w = Math.min(bw / nA - 2.0, 3.4 + rng.random() * 1.0);
            if (w < 2.4) continue;
            let gA = -Infinity; for (let t = -w / 2; t <= w / 2; t += 0.5) gA = Math.max(gA, subGround(sc + t));
            const h = Math.min(7.5, H * 0.38, w * 1.9);
            arches.push(planArch(sc, gA + 0.08, w, h));
          }
        }
      }
      // statue niches at mid-height in tall walls (bays without a ground arch), ref 3
      if (spec.niches && H > 17 && runLen > 7 && sg.mH >= 60) {
        const bays = [0, ...bPos, runLen];
        for (let k = 0; k < bays.length - 1; k++) {
          const sc = (bays[k] + bays[k + 1]) / 2;
          if (bays[k + 1] - bays[k] < 6 || arches.some((A) => Math.abs(A.sc - sc) < 4) || (stairSpan && sc + 2 > stairSpan[0] && sc - 2 < stairSpan[1])) continue;
          if (rng.random() < 0.35) continue;
          const yN = yBot + H * 0.34;
          const A = planArch(sc, yN, 2.1, 3.5, 0.42);
          A.niche = true;
          arches.push(A);
        }
      }
      // each run gets its own tint (different building phases / quarries), visible from afar
      const tk = 0.93 + 0.12 * rng.random(), warm = rng.range(-0.04, 0.05);
      const runTint = [tk * (1 + warm), tk, tk * (1 - warm * 1.6)];
      // drain spouts under the cornice (between buttresses / arches)
      const spouts = [];
      if (H > 5 && spec.kind !== 'quay') {
        for (let sp = 3 + rng.random() * 4; sp < runLen - 2; sp += 9 + rng.random() * 5) {
          if (bPos.some((b) => Math.abs(b - sp) < 2.2) || arches.some((A) => Math.abs(A.sc - sp) < A.r + 1) || (stairSpan && sp > stairSpan[0] - 1 && sp < stairSpan[1] + 1)) continue;
          spouts.push(sp);
        }
      }
      wallRun(S, 'ashlar', Fs, runLen, yBot, yMasonTop, {
        color: runTint, dripsAt: spouts,
        rng, courses: spec.courses || 'pseudo', batter: spec.batter ?? 0.02, rustic: spec.kind !== 'quay', rusticH: 3.5,
        groundAt: subGround, damp: spec.kind === 'quay' ? 1.0 : 0.6, lite: !spec.full,
        cuts: arches.length ? (c0, c1) => arches.map((A) => A.cut(c0, c1)).filter(Boolean) : null,
      });
      for (const A of arches) {
        // the batter sets the face back with height: build the arch on the face at its springing height
        const setA = (A.ys - yBot) * (spec.batter ?? 0.02);
        const r = buildArch(S, 'ashlar', Fs.at(0, 0, -setA * 0.5), A, rng, { depth: A.niche ? 0.9 : 1.5, voidBack: !A.niche });
        if (A.niche) {
          // projecting sill under the niche, statue inside
          const Bn = S.get('ashlar', Fs.o[0] + ux * A.sc, Fs.o[2] + uz * A.sc);
          chamferBox(Bn, Fs, A.sc - A.r - 0.35, A.sc + A.r + 0.35, A.y0 - 0.28, A.y0, -0.4, 0.22 - setA * 0.5, 0.03, blockColor(rng, STONE_COL), 63 - 32);
          slots.statue.push({ pos: Fs.p(A.sc, A.y0, -0.45 - setA * 0.5), facing: heading, size: 2.7, tag: 'acro-niche' });
        } else if (rng.random() < (spec.nicheStatues ?? 0.32) && A.h > 4.2) slots.statue.push({ pos: r.statuePos, facing: heading, size: Math.min(A.h * 0.62, 3.2), tag: 'acro-niche' });
        else if (rng.random() < 0.4) slots.brazier.push({ pos: Fs.p(A.sc, A.y0, -0.6), facing: heading, size: 0.8, tag: 'acro-niche' });
      }
      // (r5) a row of small dark windows high in the tall walls (refs 3, 9: rooms inside the substructures,
      // a rhythm of dark openings that reads from afar)
      if (spec.kind !== 'quay' && H > 7.5 && runLen > 6 && heading > 95 && heading < 300 && rng.random() < 0.7) {
        const arched = rng.random() < 0.6;
        const yW = yBot + Math.max(H * 0.62, H - 4.4);
        const ww = arched ? 0.9 : 0.8, wh = arched ? 1.7 : 1.15;
        if (yW + wh < yMasonTop - 0.7) {
          const Fw = Fs.at(0, 0, -(yW - yBot) * (spec.batter ?? 0.02));
          const step = 3.4 + rng.random() * 1.8;
          for (let sw = 1.8 + rng.random() * 2; sw < runLen - 1.5; sw += step) {
            if (bPos.some((b) => Math.abs(b - sw) < 2.2) || spouts.some((p) => Math.abs(p - sw) < 1.0)) continue;
            if (arches.some((A) => Math.abs(A.sc - sw) < A.r + A.ring + 1.0 && yW < A.ys + A.r + A.ring + 0.6)) continue;
            if (subGround(sw) > yW - 0.6 || (stairSpan && sw > stairSpan[0] - 1 && sw < stairSpan[1] + 1)) continue;
            opening(S, Fw, sw, yW, ww, wh, arched ? 'arch' : 'win', rng);
          }
        }
      }
      // cornice + coping/walk
      const setTop = (yMasonTop - yBot) * (spec.batter ?? 0.02);
      for (const sp of spouts) {
        const Bs = S.get('ashlar', Fs.o[0] + ux * sp, Fs.o[2] + uz * sp);
        const c = blockColor(rng, STONE_COL);
        Bs.aux = [0.4, 0.5, 0.9, 0];
        chamferBox(Bs, Fs, sp - 0.17, sp + 0.17, yMasonTop - 0.42, yMasonTop - 0.12, -setTop - 0.2, -setTop + 0.75, 0.04, darker(c, 0.85), 63 - 32 - 8, null, 32);
        Bs.aux = [0, 0, 0, 0];
      }
      const ccol = blockColor(rng, STONE_COL);
      moulding(S, 'ashlar', Fs, 0, runLen, yMasonTop, PROFILES.cornice(corniceH / 0.9), ccol, -setTop);
      const capBack = -(sg.faceOff + 2.8);
      const Bc = S.get('ashlar', Fs.o[0] + ux * runLen / 2, Fs.o[2] + uz * runLen / 2);
      chamferBox(Bc, Fs, 0, runLen, top - copeH, top, capBack, -setTop + corniceH * 0.5 + 0.06, 0.03, darker(ccol, 0.97), 63 - 4);
      const Bp = S.get('paving', Fs.o[0] + ux * runLen / 2, Fs.o[2] + uz * runLen / 2);
      Bp.quadOut(Fs.p(0, top, capBack), Fs.p(runLen, top, capBack), Fs.p(runLen, top, -setTop + corniceH * 0.5 + 0.06), Fs.p(0, top, -setTop + corniceH * 0.5 + 0.06), lin(0xd6cbb6), Fs.p(runLen / 2, top - 1, capBack / 2));
      // string course & plinth on tall walls (the plinth stops at the arches)
      if (H > 9) moulding(S, 'ashlar', Fs, 0, runLen, yBot + H * 0.58, PROFILES.string(1.2), blockColor(rng, STONE_COL), -(H * 0.58) * (spec.batter ?? 0.02));
      if (spec.kind !== 'rim' && gmax - gmin < 1.2 && H > 4) {
        for (const [p0, p1] of subtractIntervals(0, runLen, arches.map((A) => [A.sc - A.r - A.ring * 1.3, A.sc + A.r + A.ring * 1.3]))) {
          if (p1 - p0 > 0.5) moulding(S, 'ashlar', Fs, p0, p1, gmin - 0.25, PROFILES.plinth(1.1), blockColor(rng, STONE_COL), 0);
        }
      }
      // buttresses
      if (nb >= 0) {
        for (const sb of bPos) buttress(S, 'ashlar', Fs, sb, 2.6 + rng.range(-0.2, 0.3), 1.15, yBot, yMasonTop - 1.3, rng, { groundAt: subGround, setoffs: H > 16 ? 3 : 2 });
        // banners & ivy between buttresses
        if (spec.banners && heading > 100 && heading < 300) {
          for (let k = 0; k < nb; k++) {
            if (rng.random() > spec.banners) continue;
            const s = off + (k + 0.5) * every;
            const p = Fs.p(s, yMasonTop - 0.25, 0.25);
            const big = spec.kind === 'rim';
            const blen = Math.min(big ? 15 : 11, H * (big ? 0.55 : 0.45)) * (0.88 + 0.18 * rng.random());
            slots.banner.push({ pos: p, facing: heading, size: [big ? 4.2 : 3.2, blen], tag: `acro-${spec.kind}` });
          }
        }
      } else if (H > 3 && spec.banners && heading > 100 && heading < 300 && runLen > 7 && rng.random() < spec.banners * 0.5) {
        const s = runLen / 2;
        slots.banner.push({ pos: Fs.p(s, yMasonTop - 0.2, 0.25), facing: heading, size: [2.2, Math.min(7, H * 0.6)], tag: `acro-${spec.kind}` });
      }
      // ivy anchors
      const nIvy = Math.floor(runLen / 6 * (spec.ivy ?? 0.6));
      for (let k = 0; k < nIvy; k++) {
        const s = rng.range(0.5, runLen - 0.5);
        slots.ivy.push({ pos: Fs.p(s, top - 0.2, 0.3), facing: heading, size: Math.min(H, rng.range(2, 9)), width: rng.range(1.2, 4.5), tag: `acro-${spec.kind}` });
      }
      // parapet: balustrade or solid
      const useBal = spec.balustrade === true || (typeof spec.balustrade === 'function' && spec.balustrade(heading));
      const Fp = Fs.at(0, 0, -0.35 - setTop);
      if (spec.parapet === false) { /* open quay edge */ }
      else if (useBal) balus.addRun(S, 'marble', Fp, 0.25, runLen - 0.25, top, { broken: spec.kind === 'quay' ? 0 : 0.012 });
      else solidParapet(S, Fp, 0, runLen, top, rng); // (r5) was chained to the statue test: balustraded runs also got a solid wall, quays a parapet
      // statues, braziers and urns on pedestals along the parapet line (r5: every camera-facing run, refs 1/3/9:
      // a statue on every pier of every terrace edge), denser near the stair
      const nearStair = spec.parapetStatues && spec.parapetStatues(Fs.p(runLen / 2, 0, 0));
      if (spec.parapet !== false && spec.kind !== 'quay' && runLen > 6 && (nearStair || (heading > 95 && heading < 300))) {
        let kq = rng.random() * 3 | 0;
        for (let sp = 3 + rng.random() * 5; sp < runLen - 2.5; sp += (nearStair ? 10 : 13) + rng.random() * 6) {
          const Fq = Fs.at(sp, 0, -0.35 - setTop);
          const kind = kq++ % 3; // 0/2 statue (2: sometimes an urn), 1 brazier
          const yT = pedestal(S, 'marble', Fq, top, 1.05, (kind === 1 ? 1.2 : 1.55) + rng.random() * 0.3, rng, { faces: ['front'] });
          const pos = Fq.o.map((v, i) => (i === 1 ? yT : v));
          if (kind === 1) slots.brazier.push({ pos, facing: heading, size: 0.85 + rng.random() * 0.2, tag: 'acro-parapet' });
          else if (kind === 2 && rng.random() < 0.35) slots.urn.push({ pos, facing: heading, size: 1.0, tag: 'acro-parapet' });
          else slots.statue.push({ pos, facing: heading + rng.range(-15, 15), size: 2.3 + rng.random() * 0.5, tag: 'acro-parapet' });
          // (r5) gilded lamp posts on the walk between the pedestals (ref 4: gold-topped lamps along every terrace)
          const sl = sp + 6 + rng.random();
          if (spec.kind === 'terrace' && sl < runLen - 2 && rng.random() < 0.6) {
            const flame = lampPost(S, Fs.at(sl, 0, -1.3 - setTop), top, rng, 3.0 + rng.random() * 0.5);
            slots.lamp.push({ pos: flame, facing: heading, size: 0.3, tag: 'acro-terrace' });
          }
          // (r5) flower / shrub planters on the walk behind the balustrade (green + purple strips along every terrace, refs 3, 4)
          const pl0 = sp + 1.3, pl1 = Math.min(runLen - 1.0, sp + (nearStair ? 8.6 : 11.5));
          if (pl1 - pl0 > 2.2 && rng.random() < 0.6 && -2.6 - setTop > capBack + 0.4) {
            const wl = Math.min(4.5, pl1 - pl0 - 0.4), sc = (pl0 + pl1) / 2 + rng.range(-0.5, 0.5);
            const Fpl = Fs.at(sc, 0, -2.15 - setTop);
            const soil = planter(S, Fpl, top, wl, 0.85, 0.5, rng);
            slots.planter.push({ pos: soil, facing: (Math.atan2(-uz, ux) * 180) / Math.PI, size: [wl - 0.25, 0.6], tag: 'acro-platform-tier' }); // bed facing = rotation of its long axis
          }
        }
      }
      // quay furniture: bollards along the edge, water stairs descending along the face
      if (spec.bollards) {
        const Bb = S.get('marble', Fs.o[0] + ux * runLen / 2, Fs.o[2] + uz * runLen / 2);
        for (let sb = 2 + rng.random() * 3; sb < runLen - 1.5; sb += spec.bollards * (0.8 + 0.4 * rng.random())) {
          const c = blockColor(rng, STONE_COL);
          const Fb = Fs.at(sb, 0, -0.55);
          chamferBox(Bb, Fb, -0.2, 0.2, top, top + 0.5, -0.2, 0.2, 0.07, c, 63 - 8);
          chamferBox(Bb, Fb, -0.26, 0.26, top + 0.5, top + 0.62, -0.26, 0.26, 0.05, darker(c, 0.95), 63 - 8);
        }
      }
      if (spec.waterStairs && runLen > 14) {
        for (let sw = 6 + rng.random() * 6; sw < runLen - 8; sw += spec.waterStairs * (0.8 + 0.4 * rng.random())) {
          waterStair(S, Fs, sw, top, spec.waterLevel ?? 0, rng);
          sw += 6;
        }
      }
      // end piers where a wall stops at a gap
      for (const [s, isEnd] of [[0, s0 > 0.01], [runLen, s1 < len - 0.01]]) {
        if (!isEnd) continue;
        buttress(S, 'ashlar', Fs, s + (s === 0 ? 1.2 : -1.2), 2.4, 0.6, yBot, yMasonTop - 0.2, rng, { groundAt: subGround, setoffs: 1 });
      }
      // towers punctuate long visible walls (ref 7)
      if (spec.towers && spec.towers(heading, Fs.p(runLen / 2, 0, 0)) && runLen > 11) {
        ctx._towerAcc = (ctx._towerAcc || 0) + runLen;
        if (ctx._towerAcc > (spec.towerEvery ?? 70)) {
          if (buildTower(ctx, Fs, runLen / 2, 8 + rng.random() * 2, 4.5 + rng.random() * 1.5, top, 5 + rng.random() * 3, rng, heading)) { ctx._towerAcc = 0; ctx.nTowers = (ctx.nTowers || 0) + 1; }
        }
      }
      built += runLen;
      ctx.footprints.addRect(Fs.o[0] + ux * runLen / 2 + (-uz) * (capBack / 2), Fs.o[2] + uz * runLen / 2 + ux * (capBack / 2), runLen / 2, Math.abs(capBack) / 2 + 1.5, Math.atan2(ux, uz) + Math.PI / 2, 'acro-wall');
      ctx.wallRuns.push({ kind: spec.kind, F: Fs, len: runLen, top, yBot, heading, faceOff: sg.faceOff });
    }
    // convex corner piers / piers where the masonry height changes
    if (i < n - 1 || loop) {
      const nb = ch[(i + 1) % n];
      const dH = Math.abs(Math.min(sg.mH, 40) - Math.min(nb.mH, 40));
      if (dH > 3 && !zones.hit(b[0], b[1], 2)) {
        const hiOff = Math.max(sg.faceOff, nb.faceOff);
        const g = heightAt(b[0] + (-uz) * 0.5, b[1] + ux * 0.5);
        const Fj = frameXZ(b[0], 0, b[1], ux, uz, -uz, ux);
        buttress(S, 'ashlar', Fj, 0, 2.2, 0.45 + Math.abs(sg.faceOff - nb.faceOff), Math.max(g - 1.5, top - maxH), yMasonTop - 0.3, rng, { groundAt: (s2) => heightAt(b[0] + ux * s2 + (-uz) * 1.2, b[1] + uz * s2 + ux * 1.2), setoffs: 1 });
        void hiOff;
      }
      const turn = ux * nb.u[1] - uz * nb.u[0]; // >0 = left turn (convex, plateau on the left)
      const ang = Math.asin(Math.max(-1, Math.min(1, turn)));
      if (ang > 0.4 && !zones.hit(b[0], b[1], 2)) {
        const bx = -uz + -nb.u[1], bz = ux + nb.u[0];
        const bl = Math.hypot(bx, bz) || 1;
        const Fc = frameXZ(b[0], 0, b[1], bz / bl, -bx / bl, bx / bl, bz / bl);
        const g = heightAt(b[0], b[1]);
        buttress(S, 'ashlar', Fc, 0, 2.6, 0.5, Math.max(g - 1, top - maxH), yMasonTop - 0.4, rng, { groundAt: () => heightAt(b[0] + bx / bl, b[1] + bz / bl), setoffs: 1 });
      }
    }
  }
  return built;
}

/**
 * (r5) flight of steps built against a terrace wall face, climbing along the face from the ledge below
 * (ground yG at s0) to the wall top at s0 + dir·L (refs 3, 4, 9: little stairs between the levels).
 * Solid stepped mass of ashlar blocks, sloped outer parapet with coping, a newel at the foot.
 */
export function wallStair(ctx, F, s0, dir, yG, top, w, rng) {
  const { S } = ctx;
  const rise = top - yG, n = Math.max(4, Math.round(rise / 0.32)), rr = rise / n, t = 0.3;
  const L = n * t;
  const sAt = (k) => s0 + dir * k * t;
  const mid = F.p(s0 + dir * L / 2, 0, w / 2);
  const B = S.get('ashlar', mid[0], mid[2]);
  const Bt = S.get('tread', mid[0], mid[2]);
  for (let k = 0; k < n; k++) {
    const a = sAt(k), b = sAt(k + 1), lo = Math.min(a, b), hi = Math.max(a, b);
    const yk = yG + (k + 1) * rr;
    const c = blockColor(rng, STONE_COL);
    // solid body under the tread (front face + riser), tread slab on top
    chamferBox(B, F, lo, hi, yG - 0.6, yk - 0.12, 0.02, w, 0.0, darker(c, 0.92), FACES.pz | (dir > 0 ? FACES.nx : FACES.px));
    chamferBox(Bt, F, lo - (dir > 0 ? 0.03 : 0), hi + (dir > 0 ? 0 : 0.03), yk - 0.12, yk, 0.02, w + 0.03, 0.02, c, FACES.py | FACES.pz | (dir > 0 ? FACES.nx : FACES.px));
  }
  // sloped outer parapet + coping (ya at the foot, yb at the top), newel at the foot
  const sa = Math.min(s0, s0 + dir * L), sb = Math.max(s0, s0 + dir * L);
  const ya = dir > 0 ? yG : top, yb = dir > 0 ? top : yG;
  const c = blockColor(rng, STONE_COL);
  slopedBox(B, F, sa, sb, ya, yb, 0.05, 0.95, w - 0.32, w, c);
  slopedBox(B, F, sa - 0.05, sb + 0.05, ya, yb, 1.0, 0.14, w - 0.4, w + 0.06, darker(c, 1.02));
  const nx = s0 - dir * 0.2;
  chamferBox(B, F, nx - 0.35, nx + 0.35, yG - 0.4, yG + 1.35, w - 0.7, w + 0.05, 0.04, c, 63 - 8);
  chamferBox(B, F, nx - 0.42, nx + 0.42, yG + 1.35, yG + 1.5, w - 0.77, w + 0.12, 0.03, darker(c, 1.03), 63 - 8);
  return { L, newel: F.p(nx, yG + 1.5, w - 0.33) };
}

/** solid parapet wall with coping */
export function solidParapet(S, F, s0, s1, y, rng) {
  const B = S.get('ashlar', F.o[0] + F.ax[0] * (s0 + s1) / 2, F.o[2] + F.ax[2] * (s0 + s1) / 2);
  let s = s0;
  while (s < s1 - 0.1) {
    const L = Math.min(s1 - s, 1.2 + rng.random() * 1.0);
    const c = blockColor(rng, STONE_COL);
    chamferBox(B, F, s, s + L, y, y + 0.85, -0.25, 0.25, 0.03, c, 63 - 8, darker(c, 0.8));
    s += L;
  }
  s = s0;
  while (s < s1 - 0.1) {
    const L = Math.min(s1 - s, 1.6 + rng.random() * 0.8);
    const c = blockColor(rng, STONE_COL);
    chamferBox(B, F, s, s + L, y + 0.85, y + 1.05, -0.31, 0.31, 0.04, c, 63 - 8, darker(c, 0.8));
    s += L;
  }
}

/** steps descending along a quay face (parallel to the wall) into the water */
export function waterStair(S, F, s0, top, water, rng) {
  const B = S.get('tread', F.o[0] + F.ax[0] * s0, F.o[2] + F.ax[2] * s0);
  const rise = 0.21, run = 0.34, width = 2.1;
  const n = Math.ceil((top - (water - 1.2)) / rise);
  for (let i = 0; i < n; i++) {
    const yt = top - (i + 1) * rise;
    const a = s0 + i * run, b = a + run + 0.2;
    const c = blockColor(rng, STONE_COL);
    const wet = yt < water + 0.4 ? 0.62 : 1;
    B.aux = [yt < water + 0.4 ? 0.5 : 0.05, 0.6, 0, 0];
    chamferBox(B, F, a, b, Math.min(yt - 0.35, water - 1.5), yt, 0.0, width, 0.025, [c[0] * wet, c[1] * wet, c[2] * wet], 63 - 8 - 32);
  }
  B.aux = [0, 0, 0, 0];
  // low side wall on the open side of the stair
  const Bw = S.get('ashlar', F.o[0] + F.ax[0] * s0, F.o[2] + F.ax[2] * s0);
  const len = n * run;
  for (let i = 0; i < n; i += 3) {
    const yb = top - (i + 3) * rise - 0.4, yt = top - i * rise + 0.45;
    chamferBox(Bw, F, s0 + i * run, Math.min(s0 + len + 0.2, s0 + (i + 3) * run), Math.max(water - 2, yb), yt, width, width + 0.45, 0.03, blockColor(rng, STONE_COL), 63 - 8 - 32);
  }
}

/**
 * Square tower projecting from a wall run: three ashlar faces down to the ground, string course,
 * cornice + parapet rising `extra` m above the wall walk, small arched windows near the top.
 * Fs: run frame (face at d = 0, az outward); s: centre along the run.
 */
export function buildTower(ctx, Fs, s, w, proj, top, extra, rng, heading, maxDrop = 34) {
  const { S, slots } = ctx;
  const yTop = top + extra;
  const corniceH = 0.8;
  const yMason = yTop - corniceH - 0.3;
  // faces: front (outward), left side (facing -ax), right side (facing +ax)
  const front = Fs.at(s - w / 2, 0, proj);
  const left = new Frame(Fs.p(s - w / 2, 0, 0), Fs.az, [0, 1, 0], [-Fs.ax[0], -Fs.ax[1], -Fs.ax[2]]);
  const right = new Frame(Fs.p(s + w / 2, 0, proj), [-Fs.az[0], -Fs.az[1], -Fs.az[2]], [0, 1, 0], Fs.ax);
  const faces = [[front, w, heading], [left, proj, (heading + 270) % 360], [right, proj, (heading + 90) % 360]];
  let built = false;
  for (const [F, len, hd] of faces) {
    const g = (t) => { const p = F.p(t, 0, 0.4); return heightAt(p[0], p[2]); };
    let gmin = Infinity; for (let t = 0; t <= len; t += 1) gmin = Math.min(gmin, g(t));
    if (top - gmin > maxDrop) return false;
    const yBot = gmin - 1;
    const wins = [];
    for (let k = 0; k < (len > 6 ? 2 : 1); k++) {
      const sc = len > 6 ? len * (k === 0 ? 0.3 : 0.7) : len / 2;
      wins.push(planArch(sc, yMason - 3.4, 1.0, 2.3, 0.32));
    }
    wallRun(S, 'ashlar', F, len, yBot, yMason, {
      rng, courses: 'pseudo', batter: 0, rustic: true, rusticH: 3.5, groundAt: g, lite: true, damp: 0.6,
      color: [0.97, 0.95, 0.92], cuts: (c0, c1) => wins.map((A) => A.cut(c0, c1)).filter(Boolean),
    });
    for (const A of wins) buildArch(S, 'ashlar', F, A, rng, { depth: 0.8 });
    if (yMason - yBot > 10) moulding(S, 'ashlar', F, 0, len, yBot + (yMason - yBot) * 0.62, PROFILES.string(1.1), blockColor(rng, STONE_COL), 0);
    moulding(S, 'ashlar', F, -0.3, len + 0.3, yMason, PROFILES.cornice(corniceH / 0.9), blockColor(rng, STONE_COL), 0);
    solidParapet(S, F.at(0, 0, -0.3), 0, len, yTop, rng);
    if (hd > 100 && hd < 300 && len > 6 && rng.random() < 0.7) slots.banner.push({ pos: F.p(len / 2, yMason - 0.3, 0.25), facing: hd, size: [3.0, Math.min(10, (yMason - yBot) * 0.45)], tag: 'acro-tower' });
    built = true;
  }
  // flat roof slab (paving) at the parapet base
  const Bp = S.get('paving', Fs.o[0] + Fs.ax[0] * s, Fs.o[2] + Fs.ax[2] * s);
  Bp.quadOut(Fs.p(s - w / 2, yTop, -0.5), Fs.p(s + w / 2, yTop, -0.5), Fs.p(s + w / 2, yTop, proj), Fs.p(s - w / 2, yTop, proj), [1, 1, 1], Fs.p(s, yTop - 3, proj / 2));
  ctx.footprints.addRect(...[Fs.p(s, 0, proj / 2)].map((p) => [p[0], p[2]])[0], w / 2 + 0.5, proj / 2 + 0.5, Math.atan2(Fs.ax[0], Fs.ax[2]) + Math.PI / 2, 'acro-wall');
  return built;
}
