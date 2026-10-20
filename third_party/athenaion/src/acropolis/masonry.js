// Ashlar masonry: retaining walls built from individual chamfered blocks laid in courses, with
// batter, rusticated base courses, string courses, buttresses, cornice, coping and parapets.
// Walls follow terrace edges extracted from the real terrain and step down onto the ground.
import { heightAt } from '../world/heightfield.js';
import { chamferBox, sweepStraight, frameXZ, Frame, FACES, lin } from './geo.js';

// Vertex colours are MULTIPLIERS around 1.0 (the stone albedo comes from the material), so the
// shared marble material and the local fallbacks both work.
const STONE = [1, 1, 1];
export const STONE_COL = STONE;

/** per-block colour variation */
export function blockColor(rng, base = STONE, opts = {}) {
  const r = rng.random();
  // (r5) stronger block-to-block contrast so the coursing reads from afar (refs 1, 3, 9: every block
  // of the podium / terrace walls has its own tone, some grey, some honey, a few black-crusted)
  let k = 0.84 + 0.18 * rng.random();
  let c = [base[0] * k, base[1] * k, base[2] * k];
  if (r < 0.12) c = [c[0] * 0.80, c[1] * 0.80, c[2] * 0.83];            // weathered grey block
  else if (r < 0.20) c = [c[0] * 1.03, c[1] * 0.93, c[2] * 0.78];       // ochre / honey stained
  else if (r < 0.24) c = [c[0] * 1.06, c[1] * 1.05, c[2] * 1.03];       // newer, brighter repair
  else if (r < 0.31) c = [c[0] * 0.92, c[1] * 0.88, c[2] * 0.82];       // warm grime
  else if (r < 0.345) c = [c[0] * 0.64, c[1] * 0.64, c[2] * 0.63];     // black crust (sheltered block)
  if (opts.damp) { const d = opts.damp; c = [c[0] * (1 - 0.35 * d), c[1] * (1 - 0.30 * d), c[2] * (1 - 0.38 * d)]; }
  return c;
}
const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/**
 * Build one straight run of ashlar wall.
 *   F: frame at the run start ON the face line (ax along the wall, az outward), y measured absolute (F.o[1] = 0)
 *   len: run length; yBot: foundation bottom (absolute); yTop: top of masonry (absolute)
 *   opts: { rng, courses: 'iso'|'pseudo'|'random', batter, rustic, chamfer, depth, skip(s)→bool, groundAt(s)→y }
 */
export function wallRun(S, mat, F, len, yBot, yTop, opts) {
  const { rng } = opts;
  const batter = opts.batter ?? 0.025;
  const ch = opts.chamfer ?? 0.05;
  const depth = opts.depth ?? 0.6;
  const base = opts.color || STONE;
  const ground = opts.groundAt || ((s) => -1e9);
  const skip = opts.skip || (() => false);
  // course heights
  const courses = [];
  let y = yBot;
  const style = opts.courses || 'pseudo';
  let alt = 0;
  while (y < yTop - 0.05) {
    let h;
    const lowK = y < yBot + 3 ? 1.25 : 1.0;
    if (style === 'iso') h = (opts.courseH || 0.62) * lowK;
    else if (style === 'pseudo') { h = (alt++ % 2 ? 0.42 : 0.78) * lowK; }
    else h = (0.5 + 0.38 * rng.random()) * lowK;
    if (y + h > yTop - 0.25) h = yTop - y; // last course fills to the top
    courses.push([y, y + h]);
    y += h;
  }
  // large vertical drip stains (rain wash from the cornice), visible from afar
  const drips = [];
  if (opts.drips !== false) {
    const nD = Math.floor(len / 4.5);
    for (let i = 0; i < nD; i++) if (rng.random() < 0.65) drips.push({ s: rng.range(0, len), w: rng.range(0.5, 2.6), k: rng.range(0.5, 0.82), reach: rng.range(0.3, 1.0) });
    // strong stains under drain spouts
    for (const sd of opts.dripsAt || []) drips.push({ s: sd, w: rng.range(0.7, 1.3), k: rng.range(0.5, 0.65), reach: rng.range(0.55, 1.0) });
  }
  const dripAt = (s0, y) => {
    let k = 1;
    const H = Math.max(1, yTop - yBot);
    for (const d of drips) {
      const dx = Math.abs(s0 - d.s) / d.w;
      if (dx > 1) continue;
      const fromTop = (yTop - y) / H;
      const fade = Math.max(0, 1 - fromTop / d.reach);
      k = Math.min(k, 1 - (1 - d.k) * (1 - dx * dx) * fade);
    }
    return k;
  };
  let prevJoints = [];
  const sampleStep = 2.0;
  const gcache = [];
  for (let s = 0; s <= len + sampleStep; s += sampleStep) gcache.push(ground(Math.min(s, len)));
  const gAt = (s) => { const f = Math.max(0, Math.min(gcache.length - 1.001, s / sampleStep)); const i = Math.floor(f); return gcache[i] * (1 - (f - i)) + gcache[i + 1] * (f - i); };
  for (let ci = 0; ci < courses.length; ci++) {
    const [y0, y1] = courses[ci];
    const h = y1 - y0;
    const setback = (y0 - yBot) * batter;
    const rustic = opts.rustic && y0 < yBot + (opts.rusticH ?? 4);
    const joints = [];
    const cuts = opts.cuts ? opts.cuts(y0, y1) : null;
    const emitted = [];
    let s = -rng.random() * 0.9;
    while (s < len) {
      let L = h * (1.6 + 1.6 * rng.random());
      if (opts.blockLen) L = opts.blockLen * (0.75 + 0.5 * rng.random());
      // avoid aligning with the joint below
      for (const pj of prevJoints) if (Math.abs(s + L - pj) < 0.22) L += 0.35;
      const sa0 = Math.max(0, s), sb0 = Math.min(len, s + L);
      s += L;
      joints.push(s);
      for (const [sa, sb] of subtractIntervals(sa0, sb0, cuts)) {
      if (sb - sa < 0.15) continue;
      const sm = (sa + sb) / 2;
      const g = Math.min(gAt(sa), gAt(sb), gAt(sm));
      if (y1 < g - 0.25) continue;            // buried
      if (skip(sm, y0, y1)) continue;
      let clip = null;
      if (opts.topAt) {
        const ta = opts.topAt(sa), tb = opts.topAt(sb);
        if (y0 >= Math.max(ta, tb) - 0.04) continue;
        if (y1 > Math.min(ta, tb)) clip = [ta, tb];
      }
      const damp = Math.max(0, 1 - (y0 - Math.max(g, yBot)) / 2.2) * (opts.damp ?? 0.6);
      let col = blockColor(rng, base, { damp });
      if (drips.length) { const dk = dripAt((sa + sb) / 2, (y0 + y1) / 2); if (dk < 1) col = [col[0] * dk, col[1] * dk * 0.99, col[2] * dk * 0.97]; }
      const prot = rustic ? 0.05 + 0.05 * rng.random() : 0.012 * rng.random() + (rng.random() < 0.05 ? 0.03 : 0);
      const cc = rustic ? ch * 2.5 : ch * (0.7 + 0.8 * rng.random());
      const d1 = -setback + prot, d0 = -setback - depth;
      // occasional slightly rotated / settled block
      const B = S.get(mat, F.o[0] + F.ax[0] * sm, F.o[2] + F.ax[2] * sm);
      // streak source under the cornice / string course, cavity at the wet foot
      const strk = Math.max(0, 1 - (yTop - y1) / 3.5) * 0.8;
      B.aux = [damp * 0.35, rustic ? 0.7 : 0.25, strk, 0];
      if (clip) { clippedBlock(B, F, sa, sb, y0, y1, d0, d1, clip[0], clip[1], col); B.aux = [0, 0, 0, 0]; continue; }
      STATS.blocks++;
      if (opts.lite) { liteBlock(B, F, sa, sb, y0, y1, d1, cc, col, darker(col, 0.8)); B.aux = [0, 0, 0, 0]; emitted.push([sa, sb]); continue; }
      chamferBox(B, F, sa, sb, y0, y1, d0, d1, cc, col, FACES.pz | FACES.py | FACES.ny | FACES.px | FACES.nx, darker(col, 0.9));
      B.aux = [0, 0, 0, 0];
      }
    }
    prevJoints = joints;
    // dark mortar strip behind this course (shows through the chamfered joints), with holes for openings
    if (opts.lite) {
      const Bm = S.get(mat, F.o[0] + F.ax[0] * len / 2, F.o[2] + F.ax[2] * len / 2);
      Bm.aux = [1, 0, 0, 0];
      const dk = [0.30, 0.285, 0.26]; // (r5) darker joints: the coursing reads at 200 m / 4K
      const dd = -0.075 - setback;
      // merge the ranges of the blocks laid in this course
      emitted.sort((p, q) => p[0] - q[0]);
      const merged = [];
      for (const [a, b] of emitted) { const m = merged[merged.length - 1]; if (m && a <= m[1] + 0.02) m[1] = Math.max(m[1], b); else merged.push([a, b]); }
      for (const [a, b] of merged) {
        if (b - a < 0.05) continue;
        Bm.quadOut(F.p(a, y0, dd), F.p(b, y0, dd), F.p(b, y1, dd), F.p(a, y1, dd), dk, F.p((a + b) / 2, (y0 + y1) / 2, -2));
      }
      Bm.aux = [0, 0, 0, 0];
    }
  }
  return courses;
}

/** [a,b] minus sorted/unsorted cut intervals → list of free intervals */
export function subtractIntervals(a, b, cuts) {
  if (!cuts || !cuts.length) return [[a, b]];
  let out = [[a, b]];
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [p, q] of out) {
      if (c1 <= p || c0 >= q) { next.push([p, q]); continue; }
      if (c0 > p) next.push([p, c0]);
      if (c1 < q) next.push([c1, q]);
    }
    out = next;
  }
  return out;
}

/** wall block seen only from the front: face + 4 chamfers (10 tris) */
export function liteBlock(B, F, sa, sb, y0, y1, d1, c, col, cc) {
  c = Math.min(c, (sb - sa) * 0.3, (y1 - y0) * 0.3);
  const d0 = d1 - c;
  const P = (s, y, d) => F.p(s, y, d);
  const C = P((sa + sb) / 2, (y0 + y1) / 2, d1 - 1);
  B.quadOut(P(sa + c, y0 + c, d1), P(sb - c, y0 + c, d1), P(sb - c, y1 - c, d1), P(sa + c, y1 - c, d1), col, C);
  const aux = B.aux;
  B.aux = [Math.max(aux[0], B.auxCh[0]), Math.max(aux[1], B.auxCh[1]), aux[2], aux[3]];
  B.quadOut(P(sa + c, y1 - c, d1), P(sb - c, y1 - c, d1), P(sb - c, y1, d0), P(sa + c, y1, d0), cc, C);
  B.quadOut(P(sa + c, y0 + c, d1), P(sa + c, y0, d0), P(sb - c, y0, d0), P(sb - c, y0 + c, d1), cc, C);
  B.quadOut(P(sb - c, y0 + c, d1), P(sb, y0 + c, d0), P(sb, y1 - c, d0), P(sb - c, y1 - c, d1), cc, C);
  B.quadOut(P(sa + c, y0 + c, d1), P(sa + c, y1 - c, d1), P(sa, y1 - c, d0), P(sa, y0 + c, d0), cc, C);
  const tri = (a, b, d) => { B.quadOut(a, b, d, d, cc, C); };
  void tri;
  // (corner facets omitted: the tiny gaps show the dark mortar plane, reading as joint corners)
  B.aux = aux;
}

/** moulded profiles (d outward from face, y up) relative to a reference */
export const PROFILES = {
  // cornice: fascia, ovolo-ish quarter round, corona, cyma — total height ~0.9
  cornice: (k = 1) => [[0, 0], [0.06, 0], [0.06, 0.18], [0.12, 0.24], [0.2, 0.34], [0.26, 0.4], [0.32, 0.42], [0.32, 0.6], [0.38, 0.62], [0.45, 0.72], [0.5, 0.82], [0.5, 0.9], [0, 0.9]].map(([d, y]) => [d * k, y * k]),
  string: (k = 1) => [[0, 0], [0.1, 0.04], [0.16, 0.1], [0.16, 0.22], [0.1, 0.26], [0, 0.3]].map(([d, y]) => [d * k, y * k]),
  plinth: (k = 1) => [[0, 0], [0.32, 0], [0.32, 0.38], [0.22, 0.42], [0.18, 0.5], [0.08, 0.56], [0, 0.6]].map(([d, y]) => [d * k, y * k]),
  coping: (k = 1) => [[0, 0], [0.12, 0.0], [0.14, 0.03], [0.14, 0.24], [0.1, 0.28], [0, 0.3]].map(([d, y]) => [d * k, y * k]),
};

/** sweep a profile along a run: F at run start on the face line; profile y offsets added to y0 */
export function moulding(S, mat, F, s0, s1, y0, profile, col, dOff = 0) {
  const prof = profile.map(([d, y]) => [d + dOff, y + y0]);
  const mid = (s0 + s1) / 2;
  const B = S.get(mat, F.o[0] + F.ax[0] * mid, F.o[2] + F.ax[2] * mid);
  // add a back point so caps close
  sweepStraight(B, F, s0, s1, [[dOff - 0.6, prof[0][1]], ...prof, [dOff - 0.6, prof[prof.length - 1][1]]], col, true,
    (i, p) => { const dy = p[i + 1][1] - p[i][1], dd = p[i + 1][0] - p[i][0]; return dd < -0.01 && dy < 0.02 ? darker(col, 0.8) : dd > 0.02 && dy < 0.05 ? darker(col, 0.88) : col; });
}

/**
 * Buttress / pier: a projecting block-built mass centred at s on frame F, width w, projection p,
 * from yBot to yTop, with set-offs (steps back) and a capping block.
 */
export const STATS = { blocks: 0, buttressBlocks: 0, buttresses: 0 };
export function buttress(S, mat, F, s, w, p, yBot, yTop, rng, opts = {}) {
  STATS.buttresses++;
  const ground = opts.groundAt || (() => -1e9);
  const g = ground(s);
  const base = opts.color || STONE;
  const steps = opts.setoffs ?? 2;
  const H = yTop - yBot;
  let y = yBot;
  let ci = 0;
  while (y < yTop - 0.05) {
    const frac = (y - yBot) / H;
    const level = Math.min(steps, Math.floor(frac * (steps + 1)));
    const proj = p * (1 - level / (steps + 1.5)) + (opts.batterBack ?? 0) * 0;
    const h = Math.min(yTop - y, (ci % 2 ? 0.48 : 0.72) * (y < yBot + 3 ? 1.2 : 1));
    if (y + h > g - 0.2) {
      // quoin blocks: alternate long/short on the side faces
      const col = blockColor(rng, base, { damp: Math.max(0, 1 - (y - Math.max(g, yBot)) / 2) * 0.5 });
      const sx = w / 2 - (level * 0.08);
      const B = S.get(mat, F.o[0] + F.ax[0] * s, F.o[2] + F.ax[2] * s);
      const split = ci % 2 ? 0.45 : 0.55;
      const cut = s - sx + 2 * sx * split;
      B.aux = [0, 0.5, 0, 0];
      STATS.buttressBlocks += 2;
      chamferBox(B, F, s - sx, cut, y, y + h, -0.3, proj, 0.04, col, FRONT3, darker(col, 0.85), FACES.nz);
      chamferBox(B, F, cut, s + sx, y, y + h, -0.3, proj, 0.04, blockColor(rng, base), FRONT3, darker(col, 0.85), FACES.nz);
      B.aux = [0, 0, 0, 0];
    }
    y += h; ci++;
  }
  // weathered sloping cap
  const B = S.get(mat, F.o[0] + F.ax[0] * s, F.o[2] + F.ax[2] * s);
  const projTop = p * (1 - steps / (steps + 1.5));
  const col = blockColor(rng, base);
  chamferBox(B, F, s - w / 2 - 0.08, s + w / 2 + 0.08, yTop, yTop + 0.25, -0.3, projTop + 0.1, 0.05, col);
}
const ALL5 = FACES.pz | FACES.py | FACES.ny | FACES.px | FACES.nx;
const FRONT3 = FACES.pz | FACES.px | FACES.nx;

/**
 * Convert a contour (high ground on the left) into wall runs.
 *   line: simplified polyline; lowLevel: height the wall descends to; needs per-segment face offsets.
 * Returns runs: [{ a:[x,z], b:[x,z], u:[ux,uz], n:[nx,nz] (outward), len, faceOff, top, gMin }]
 */
export function planRuns(line, { lowLevel, topLevel, maxOff = 12, minLen = 3, grid }) {
  const hs = (x, z) => (grid ? grid.sample(x, z) : heightAt(x, z));
  const segs = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.5) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const nx = -uz, nz = ux; // right of travel = outward (high ground is on the left)
    // outward height profiles at samples along the segment
    const prof = [];
    let topMax = -Infinity;
    const n = Math.max(2, Math.ceil(len / 1.5));
    for (let k = 0; k <= n; k++) {
      const t = k / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const hsArr = [];
      for (let o = -4; o <= maxOff; o += 0.5) hsArr.push(hs(px + nx * o, pz + nz * o));
      prof.push(hsArr);
      topMax = Math.max(topMax, hs(px - nx * 3, pz - nz * 3));
    }
    /** face offset so the wall face clears the terrain wherever it is above T */
    const offFor = (T) => {
      let need = -Infinity;
      for (const arr of prof) {
        let found = null;
        for (let j = 0; j < arr.length; j++) if (arr[j] < T) { found = -4 + j * 0.5; break; }
        if (found === null) return null;
        need = Math.max(need, found);
      }
      return need + 0.35;
    };
    const full = offFor(lowLevel + 1.0);
    segs.push({ a: [ax, az], b: [bx, bz], u: [ux, uz], n: [nx, nz], len, offFor, faceOff: full, fullOff: full, top: Math.min(topMax, topLevel + 1.5) });
  }
  return segs;
}

/** block [sa,sb]×[y0,y1] whose top is clipped by the line top(s) (ta at sa → tb at sb); no chamfer */
export function clippedBlock(B, F, sa, sb, y0, y1, d0, d1, ta, tb, col) {
  const topAt = (s) => ta + (tb - ta) * ((s - sa) / (sb - sa));
  let s0 = sa, s1 = sb;
  if (ta < y0) s0 = sa + ((y0 - ta) / (tb - ta)) * (sb - sa);
  if (tb < y0) s1 = sa + ((y0 - ta) / (tb - ta)) * (sb - sa);
  if (s1 - s0 < 0.03) return;
  const cuts = [s0, s1];
  if ((ta - y1) * (tb - y1) < 0) { const sc = sa + ((y1 - ta) / (tb - ta)) * (sb - sa); if (sc > s0 && sc < s1) cuts.splice(1, 0, sc); }
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    const ya = Math.min(y1, topAt(a)), yb = Math.min(y1, topAt(b));
    const C = F.p((a + b) / 2, (y0 + Math.min(ya, yb)) / 2, (d0 + d1) / 2);
    const P = (s, y, d) => F.p(s, y, d);
    const dk = [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85];
    B.quadOut(P(a, y0, d1), P(b, y0, d1), P(b, yb, d1), P(a, ya, d1), col, C);
    B.quadOut(P(a, ya, d0), P(b, yb, d0), P(b, yb, d1), P(a, ya, d1), col, C);
    B.quadOut(P(a, y0, d0), P(a, y0, d1), P(a, ya, d1), P(a, ya, d0), dk, C);
    B.quadOut(P(b, y0, d1), P(b, y0, d0), P(b, yb, d0), P(b, yb, d1), dk, C);
  }
}


// ------------------------------------------------------------------ arched openings / niches
/**
 * Plan an arched recess on a wall run: returns { sc, y0, r, ys, ring, cut(y0, y1) → [a,b]|null }.
 * sc: centre along the run, y0: sill, w: clear width, h: clear height (to the crown).
 */
export function planArch(sc, y0, w, h, ring = 0.6) {
  const r = w / 2, ys = y0 + h - r;
  const R = r + ring;
  return {
    sc, y0, w, h, r, ys, ring,
    cut(c0, c1) {
      if (c1 <= y0 - 0.02 || c0 >= ys + R) return null;
      // narrowest half-extent of the outer contour inside the course
      const yy = Math.max(c0, Math.min(c1, ys + R));
      const top = Math.max(c1, ys);
      let e;
      if (c1 <= ys) e = R;
      else { const dy = Math.min(R, Math.max(0, top - ys)); e = Math.sqrt(Math.max(0, R * R - dy * dy)); }
      void yy;
      return e > 0.05 ? [sc - e, sc + e] : null;
    },
  };
}

/** emit the geometry of a planned arch on frame F (face at d = 0): jambs, voussoirs, keystone, recess */
export function buildArch(S, mat, F, A, rng, opts = {}) {
  const depth = opts.depth ?? 1.4;
  const { sc, y0, r, ys, ring } = A;
  const B = S.get(mat, F.o[0] + F.ax[0] * sc, F.o[2] + F.ax[2] * sc);
  const col = blockColor(rng, STONE_COL);
  // jambs: alternating quoin blocks
  let y = y0 - 0.3, k = 0;
  while (y < ys - 0.02) {
    const hh = Math.min(ys - y, k % 2 ? 0.5 : 0.75);
    for (const sx of [-1, 1]) {
      const wide = (k + (sx > 0 ? 1 : 0)) % 2 ? ring * 1.25 : ring * 0.85;
      const a = sx < 0 ? sc - r - wide : sc + r, b = sx < 0 ? sc - r : sc + r + wide;
      B.aux = [0.1, 0.6, 0.1, 0];
      chamferBox(B, F, a, b, y, y + hh, -depth * 0.35, 0.07, 0.035, blockColor(rng, STONE_COL), FACES.pz | FACES.px | FACES.nx | FACES.py | FACES.ny, darker(col, 0.85), FACES.nz);
    }
    y += hh; k++;
  }
  // impost blocks at the springing
  for (const sx of [-1, 1]) {
    const a = sx < 0 ? sc - r - ring * 1.1 : sc + r - 0.1, b = sx < 0 ? sc - r + 0.1 : sc + r + ring * 1.1;
    chamferBox(B, F, a, b, ys - 0.22, ys, -depth * 0.35, 0.13, 0.03, darker(col, 1.03), 63 - 32);
  }
  // voussoirs (wedges) around the semicircle, keystone projecting
  const n = Math.max(7, Math.round((Math.PI * (r + ring / 2)) / 0.55)) | 1;
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI - (Math.PI * i) / n, a1 = Math.PI - (Math.PI * (i + 1)) / n;
    const key = i === (n - 1) / 2;
    const R1 = r + ring * (key ? 1.25 : 1), dF = key ? 0.16 : 0.08;
    const c = blockColor(rng, STONE_COL);
    const P = (a, rr, d) => F.p(sc + Math.cos(a) * rr, ys + Math.sin(a) * rr, d);
    const ctr = F.p(sc + Math.cos((a0 + a1) / 2) * (r + R1) / 2, ys + Math.sin((a0 + a1) / 2) * (r + R1) / 2, -0.5);
    const gap = 0.012;
    const b0 = a0 - gap, b1 = a1 + gap;
    B.aux = [0.05, 0.7, 0.2, 0];
    B.quadOut(P(b0, r, dF), P(b1, r, dF), P(b1, R1, dF), P(b0, R1, dF), c, ctr);                 // face
    B.quadOut(P(b0, R1, dF), P(b1, R1, dF), P(b1, R1, -0.2), P(b0, R1, -0.2), darker(c, 0.9), ctr); // extrados
    B.quadOut(P(b0, r, -depth * 0.35), P(b1, r, -depth * 0.35), P(b1, r, dF), P(b0, r, dF), darker(c, 0.82), F.p(sc, ys, dF)); // intrados (soffit)
    B.quadOut(P(b0, r, dF), P(b0, R1, dF), P(b0, R1, -0.2), P(b0, r, -0.2), darker(c, 0.8), ctr);
    B.quadOut(P(b1, R1, dF), P(b1, r, dF), P(b1, r, -0.2), P(b1, R1, -0.2), darker(c, 0.8), ctr);
  }
  B.aux = [0, 0, 0, 0];
  // recess: reveals, vault soffit, back wall and sill (grimy, shaded)
  const D = S.get(mat, F.o[0] + F.ax[0] * sc, F.o[2] + F.ax[2] * sc);
  D.aux = [0.75, 0, 0.3, 0];
  const dk = darker(col, 0.78);
  const inside = F.p(sc, (y0 + ys) / 2, -depth * 0.5);
  for (const sx of [-1, 1]) {
    const s = sc + sx * r;
    D.quadOut(F.p(s, y0 - 0.3, -depth * 0.35), F.p(s, ys, -depth * 0.35), F.p(s, ys, -depth), F.p(s, y0 - 0.3, -depth), dk, F.p(sc + sx * (r + 1), (y0 + ys) / 2, -depth / 2));
  }
  const m = 10;
  // (r5) passages / open arches: the back is a dark void (an unlit room or tunnel), niches keep a stone back
  const V = opts.voidBack ? S.get('void', F.o[0] + F.ax[0] * sc, F.o[2] + F.ax[2] * sc) : D;
  const backCol = opts.voidBack ? [1, 1, 1] : darker(col, 0.7);
  for (let i = 0; i < m; i++) {
    const a0 = (Math.PI * i) / m, a1 = (Math.PI * (i + 1)) / m;
    const P = (a, d) => F.p(sc + Math.cos(a) * r, ys + Math.sin(a) * r, d);
    D.quadOut(P(a0, -depth * 0.35), P(a1, -depth * 0.35), P(a1, -depth), P(a0, -depth), dk, F.p(sc + Math.cos((a0 + a1) / 2) * (r + 1), ys + Math.sin((a0 + a1) / 2) * (r + 1), -depth / 2));
    // back wall: fan of the semicircle
    V.tri(F.p(sc, ys, -depth), F.p(sc + Math.cos(a0) * r, ys + Math.sin(a0) * r, -depth), F.p(sc + Math.cos(a1) * r, ys + Math.sin(a1) * r, -depth), backCol);
  }
  V.quadOut(F.p(sc - r, y0 - 0.3, -depth), F.p(sc + r, y0 - 0.3, -depth), F.p(sc + r, ys, -depth), F.p(sc - r, ys, -depth), backCol, inside);
  D.quadOut(F.p(sc - r, y0, 0.05), F.p(sc + r, y0, 0.05), F.p(sc + r, y0, -depth), F.p(sc - r, y0, -depth), darker(col, 0.85), F.p(sc, y0 - 1, -depth / 2));
  D.aux = [0, 0, 0, 0];
  // fix: back fan winding (face outward = +d)
  return { statuePos: F.p(sc, y0, -depth * 0.55) };
}
