// Roman arcade generator: multi-tier aqueducts (open specus channel on top) and monumental road
// bridges (paved deck, balustrade, pedestals, gate tower). Built in the structure's local frame
// (x along A→B, y = world height, z across) and adapted to the real terrain: piers reach the ground
// with stepped foundations, bays below grade become blind arches, river piers get cutwaters.
import * as THREE from 'three';
import { Builder, T, arcPoints } from './geom.js';
import { RNG } from '../core/rng.js';

const PI = Math.PI;

/** Full parametric description of one structure from a layout entry. */
export function makeSpec(e, detail = 1) {
  const kind = e.kind || (e.tiers > 1 ? 'aqueduct' : 'bridge');
  const bridge = kind === 'bridge';
  const A = e.a, B = e.b;
  const dx = B[0] - A[0], dz = B[1] - A[1], len = Math.hypot(dx, dz);
  const axis = [dx / len, dz / len];
  const span = e.archSpan;
  const nT = Math.max(1, e.tiers | 0);
  const topH = bridge ? 1.95 : 3.6;                  // deck structure above the top arcade
  const pier1 = bridge ? Math.max(3.6, span * 0.3) : Math.max(3.2, span * 0.31);
  const bay = span + pier1;
  const d1 = bridge ? (e.width || 12) - 0.8 : Math.min(7.6, 4.6 + span * 0.19);
  const tiers = [];
  let top = e.deck - topH;
  // build top-down: the top tier of a 3-tier aqueduct is a small Pont-du-Gard style arcade
  for (let k = nT - 1; k >= 0; k--) {
    const small = nT >= 3 && k === nT - 1;
    const subdiv = small ? 3 : 1;
    const pierW = small ? Math.max(1.1, (bay / 3) * 0.24) : pier1 - k * 0.7;
    const sp = bay / subdiv - pierW;
    const r = sp / 2;
    const rd = small ? 0.5 : 0.25 + sp * 0.068;
    const bandH = bridge ? 0 : (small ? 0.6 : 0.85);
    const spandMin = bridge ? 0.7 : 0.45;
    const h = small ? Math.max(6.5, sp * 1.35 + 2.0) : span * 1.85;
    const depth = d1 - k * 1.25;
    const spring = top - bandH - spandMin - rd - r;
    tiers.unshift({ k, top, spring, span: sp, r, rd, pierW, depth, subdiv, bandH, small });
    top -= h;
  }
  tiers.forEach((t, i) => { t.k = i; t.bottom = i === 0 ? -Infinity : tiers[i - 1].top; });
  const tTop = tiers[tiers.length - 1];
  const W = bridge ? (e.width || 12) : Math.max(4.2, tTop.depth - 0.7);
  return {
    id: e.id, kind, bridge, A, B, len, axis, deck: e.deck, bay, span, tiers, topH, W, end: e.end || null,
    chW: bridge ? 0 : Math.max(1.8, W - 2.2),          // channel width
    copH: 0.34,
    detail,
  };
}

/**
 * Build one structure. env: { ground(x,z), waterSDF(x,z), waterY, quality }
 * Returns builders + instance lists + spills/slots in WORLD coordinates.
 */
export function buildStructure(S, env) {
  const rng = new RNG('aqueduct-' + S.id);
  const B = new Builder();
  const out = {
    stone: B, finials: [], balusters: [], water: [], spills: [], slots: { ivy: [], banner: [], statue: [], brazier: [], urn: [] },
    piers: [], wet: [], extent: [0, 0], footprints: [],
  };
  const [ux, uz] = S.axis;
  const southSide = ux >= 0 ? 1 : -1;          // local z sign of the south face
  const toW = (x, z) => [S.A[0] + ux * x - uz * z, S.A[1] + uz * x + ux * z];
  const gAt = (x, z) => { const [wx, wz] = toW(x, z); return env.ground(wx, wz); };
  const wAt = (x, z) => { const [wx, wz] = toW(x, z); return env.waterSDF(wx, wz); };
  const compassOf = (lx, lz) => { // local horizontal direction → compass degrees
    const wx = ux * lx - uz * lz, wz = uz * lx + ux * lz;
    return ((Math.atan2(wx, -wz) * 180) / PI + 360) % 360;
  };
  const W3 = (x, y, z) => { const [wx, wz] = toW(x, z); return [wx, y, wz]; };
  out.toWorld = W3; out.compassOf = compassOf;

  const deck = S.deck, waterY = env.waterY ?? 0;
  const t1 = S.tiers[0], tTop = S.tiers[S.tiers.length - 1];

  // ---------------------------------------------------------------- extent along the axis
  let s0 = null, s1 = null;
  for (let s = 0; s <= S.len; s += 2) {
    const g = Math.min(gAt(s, 0), gAt(s, -S.W / 2), gAt(s, S.W / 2));
    if (g < deck - 1.2) { if (s0 === null) s0 = s; s1 = s; }
  }
  if (s0 === null) return out;
  const nb = Math.ceil((s1 - s0) / S.bay) + 2;
  const xStart = (s0 + s1) / 2 - (nb * S.bay) / 2;
  const px = []; for (let i = 0; i <= nb; i++) px.push(xStart + i * S.bay);
  const xA = px[0], xB = px[nb];
  out.extent = [xA, xB];

  // ground statistics
  const pierGround = (x, hw, hd) => {
    let mn = Infinity, mx = -Infinity;
    for (const [ox, oz] of [[0, 0], [-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, -hd], [0, hd], [-hw, 0], [hw, 0]]) {
      const g = gAt(x + ox, oz); mn = Math.min(mn, g); mx = Math.max(mx, g);
    }
    return [mn, mx];
  };
  const bayGround = (x0, x1, hd) => {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i <= 6; i++) {
      const x = x0 + ((x1 - x0) * i) / 6;
      for (const oz of [-hd, 0, hd]) { const g = gAt(x, oz); mn = Math.min(mn, g); mx = Math.max(mx, g); }
    }
    return [mn, mx];
  };

  const st = (type, seed, wear, ground) => [type, seed, wear, ground];
  const vl = 0.95 / Math.sqrt(Math.max(0.35, S.detail));         // voussoir length along the ring
  const chamf = S.detail >= 0.75 ? 1 : 0.8;

  // ---------------------------------------------------------------- piers per tier
  for (const t of S.tiers) {
    const sub = t.subdiv, sb = S.bay / sub;
    const hd = t.depth / 2, hw = t.pierW / 2;
    for (let i = 0; i <= nb * sub; i++) {
      const x = xStart + i * sb;
      const [gMin, gMax] = pierGround(x, hw + 0.6, hd + 0.6);
      if (t.spring < gMin - 0.4) continue;                       // fully buried
      const found = 2.2 + (gMax - gMin) * 0.35;
      const reachesGround = t.bottom < gMin + 0.5;
      const yBot = Math.max(t.bottom, gMin - found);
      const seed = rng.random();
      const wear = 0.25 + 0.5 * rng.random();
      const isMain = i % sub === 0;
      const pType = t.k === 0 && !S.bridge ? T.RUSTIC : T.ASHLAR;
      // tall lower-tier piers are battered in steps (Segovia-like): every band down they widen a little
      const battered = t.k === 0 && !t.small && !S.bridge;
      const bandStep = 13, sx = 0.32, sz = 0.2;
      const bands = [];
      if (t.k === 0 && !t.small) {
        const base = Math.max(yBot, gMax + 4);
        for (let yb = t.spring - bandStep; yb > base + 3; yb -= bandStep) bands.push(yb);
      }
      let segTop = t.spring;
      for (let k = 0; k <= bands.length; k++) {
        const segBot = k < bands.length ? bands[k] - 0.42 : yBot;
        const ex = battered ? k * sx : 0, ez = battered ? k * sz : 0;
        B.box(x - hw - ex, segBot, -hd - ez, x + hw + ex, segTop, hd + ez, st(pType, seed, wear, gMin), 0.06 * chamf);
        if (k < bands.length) {
          // band (drip course) at the step: sized to the wider segment below
          const bx = battered ? (k + 1) * sx : 0, bz = battered ? (k + 1) * sz : 0;
          B.box(x - hw - bx - 0.14, bands[k] - 0.42, -hd - bz - 0.14, x + hw + bx + 0.14, bands[k], hd + bz + 0.14, st(T.MOULD, rng.random(), 0.5, gMin), 0.04 * chamf);
        }
        segTop = segBot;
      }
      const hwB = hw + (battered ? bands.length * sx : 0), hdB = hd + (battered ? bands.length * sz : 0);
      if (t.k === 0 && isMain) out.piers.push({ x, z: 0, world: W3(x, gMin, 0), ground: gMin, groundMax: gMax, top: deck });

      if (reachesGround) {
        // stepped foundation footing (deeper and wider on slopes)
        const slope = gMax - gMin;
        const fo = 0.55 + Math.min(0.8, slope * 0.08);
        const fTop = gMax + 0.35 + rng.range(0, 0.35);
        B.box(x - hwB - fo, gMin - found, -hdB - fo, x + hwB + fo, fTop, hdB + fo, st(T.FOUND, rng.random(), 0.8, gMin), 0.12 * chamf);
        if (slope > 1.8) {
          const f2 = fo + 0.6;
          B.box(x - hwB - f2, gMin - found, -hdB - f2, x + hwB + f2, gMin + slope * 0.45, hdB + f2, st(T.FOUND, rng.random(), 0.9, gMin), 0.15 * chamf);
        }
        // cutwaters for piers standing in the river
        if (gMin < waterY - 0.3 && wAt(x, 0) < 6) buildCutwaters(B, x, hwB, hdB, gMin - found, waterY, rng, st, S, t.spring, southSide);
        // ivy anchors on tall piers
        if (t.spring - gMax > 8 && rng.chance(0.4)) {
          const s = rng.sign();
          out.slots.ivy.push({ pos: W3(x + rng.range(-hw, hw) * 0.5, t.spring, s * (hd + 0.2)), facing: compassOf(0, s), size: Math.min(15, (t.spring - gMax) * rng.range(0.25, 0.6)), width: rng.range(1.2, t.pierW + 0.4), tag: 'aqueduct-pier' });
        }
      }
      // impost moulding at the springing
      const ip = t.small ? 0.1 : 0.2;
      B.box(x - hw - ip * 0.5, t.spring - 0.62, -hd - ip * 0.5, x + hw + ip * 0.5, t.spring - 0.4, hd + ip * 0.5, st(T.MOULD, seed, wear, gMin), 0.03);
      B.box(x - hw - ip, t.spring - 0.4, -hd - ip, x + hw + ip, t.spring, hd + ip, st(T.MOULD, seed, wear, gMin), 0.05 * chamf);
      // bridge piers: pilaster buttresses rising from the cutwaters to the cornice
      const major = isMajor(S, i);
      if (S.bridge && isMain && t.k === 0) {
        const bw = t.pierW * (major ? 0.5 : 0.36), bp = major ? 1.25 : 0.7;
        const yb0 = Math.max(gMin < waterY ? waterY + Math.max(5, (t.spring - waterY) * 0.5) + t.pierW * 0.5 : gMax + 0.5, yBot);
        for (const s of [-1, 1]) {
          B.box(x - bw, yb0, s > 0 ? hd - 0.1 : -hd - bp, x + bw, deck - 1.2, s > 0 ? hd + bp : -hd + 0.1, st(T.ASHLAR, rng.random(), wear, gMin), 0.05 * chamf);
          // little niche-cap on the buttress just under the cornice
          B.box(x - bw - 0.12, deck - 1.75, s > 0 ? hd + bp - 0.05 : -hd - bp - 0.12, x + bw + 0.12, deck - 1.45, s > 0 ? hd + bp + 0.12 : -hd - bp + 0.05, st(T.MOULD, rng.random(), wear, gMin), 0.03);
          // major piers carry a projecting refuge block that breaks through the cornice
          if (major) B.box(x - bw - 0.05, deck - 1.45, s > 0 ? hd - 0.1 : -hd - bp - 0.05, x + bw + 0.05, deck + 0.2, s > 0 ? hd + bp + 0.05 : -hd + 0.1, st(T.ASHLAR, rng.random(), wear, gMin), 0.04);
        }
      }
      // aqueducts: major lower-tier piers get projecting pilasters (breaks the repetition, vertical shadow lines)
      if (!S.bridge && !battered && major && t.k === 0 && !t.small && t.spring - gMax > 10) {
        const bw = t.pierW * 0.3, bp = 0.55;
        for (const s of [-1, 1]) {
          const z0 = s > 0 ? hd - 0.05 : -hd - bp, z1 = s > 0 ? hd + bp : -hd + 0.05;
          B.box(x - bw, Math.max(yBot, gMin - 1), z0, x + bw, t.spring - 1.4, z1, st(T.RUSTIC, rng.random(), wear, gMin), 0.05 * chamf);
          B.box(x - bw - 0.15, t.spring - 1.4, s > 0 ? hd - 0.05 : -hd - bp - 0.15, x + bw + 0.15, t.spring - 0.62, s > 0 ? hd + bp + 0.15 : -hd + 0.05, st(T.MOULD, rng.random(), wear, gMin), 0.04);
        }
      }
    }
  }

  // ---------------------------------------------------------------- arches, spandrels, bands per tier
  for (const t of S.tiers) {
    const sub = t.subdiv, sb = S.bay / sub;
    const hd = t.depth / 2, hw = t.pierW / 2;
    const R = t.r + t.rd;
    const yTopWall = t.top - t.bandH;
    for (let i = 0; i < nb * sub; i++) {
      const x0 = xStart + i * sb, x1 = x0 + sb, cx = (x0 + x1) / 2;
      const [gb, gbMax] = bayGround(x0 + hw, x1 - hw, hd);
      if (t.top < gb - 0.6) continue;                          // buried
      const seed = rng.random(), wear = 0.2 + 0.6 * rng.random();
      // spandrel faces with the semicircular hole for the arch ring
      const segs = Math.max(10, Math.round(14 * Math.sqrt(R / 4) * Math.max(0.6, S.detail)));
      const arc = arcPoints(cx, t.spring, R, segs, PI, 0);
      const contour = [[x0, t.spring], ...arc, [x1, t.spring], [x1, yTopWall], [x0, yTopWall]];
      // dedupe near-identical points (arc ends touching the pier centre lines)
      const C2 = contour.filter((p, k) => k === 0 || Math.hypot(p[0] - contour[k - 1][0], p[1] - contour[k - 1][1]) > 1e-3);
      for (const s of [-1, 1]) B.planeXY(C2, [], s * hd, s, st(T.ASHLAR, seed, wear, gb));
      // voussoir ring
      let N = Math.max(5, Math.round((PI * (t.r + t.rd / 2)) / (t.small ? vl * 0.7 : vl)));
      if (N % 2 === 0) N++;
      const pv = t.small ? 0.03 : 0.06;
      B.darkEdges = true;
      for (let k = 0; k < N; k++) {
        const a0 = PI - (k * PI) / N, a1 = PI - ((k + 1) * PI) / N;
        const key = k === (N - 1) / 2;
        const r1 = t.r + t.rd + (key ? (t.small ? 0.12 : 0.32) : 0);
        const p = pv + (key ? 0.1 : 0);
        B.voussoir(cx, t.spring, a0, a1, t.r, r1, -hd - p, hd + p, st(T.VOUSS, rng.random(), wear, gb), (t.small ? 0.025 : 0.045) * chamf);
      }
      B.darkEdges = false;
      // bridges get a projecting archivolt (hood moulding) over the ring
      if (S.bridge) {
        const n2 = 16;
        for (let k = 0; k < n2; k++) {
          const a0 = PI - (k * PI) / n2, a1 = PI - ((k + 1) * PI) / n2;
          for (const s of [-1, 1]) {
            B.voussoir(cx, t.spring, a0, a1, R + 0.02, R + 0.3, s > 0 ? hd : -hd - 0.16, s > 0 ? hd + 0.16 : -hd, st(T.MOULD, seed, wear, gb), 0);
          }
        }
      }
      // blind (filled) arch where the ground is too high for an opening
      if (gb > t.spring - 1.5 && gb < t.spring + t.r && !t.small) {
        const fz = hd - 0.42;
        const yF = Math.min(gb - 2, t.spring - 0.3);
        const fill = [[x0 + hw, yF], [x1 - hw, yF], [x1 - hw, t.spring], ...arcPoints(cx, t.spring, t.r, 12, 0, PI).slice(1, -1), [x0 + hw, t.spring]];
        for (const s of [-1, 1]) B.planeXY(fill, [], s * fz, s, st(T.ASHLAR, rng.random(), 0.7, gb));
      }
      // ivy anchors at the spandrels (hanging down into the arch)
      if (rng.chance(t.small ? 0.1 : 0.3) && gb < t.spring) {
        const s = rng.sign();
        out.slots.ivy.push({ pos: W3(cx + rng.range(-t.r, t.r) * 0.9, t.top, s * (hd + (t.bandH > 0 ? 0.34 : 0.05))), facing: compassOf(0, s), size: rng.range(2.5, Math.max(3, t.r + t.rd + 1)), width: rng.range(1.8, 4.5), tag: 'aqueduct-spandrel' });
      }
    }
    // continuous string course / band at the tier top (aqueducts)
    if (t.bandH > 0) {
      const pj = t.small ? 0.22 : 0.34;
      B.extrudeX(bandProfile(hd, pj, t.top - t.bandH, t.bandH), xA, xB, st(T.MOULD, rng.random(), 0.45, -1e3));
    }
  }

  // ---------------------------------------------------------------- end abutments (solid walls into the banks)
  for (const [xe, dir] of [[xA, -1], [xB, 1]]) {
    if (dir > 0 && S.end === 'castellum') continue;
    const hdA = t1.depth / 2 + 0.3;
    let gm = Infinity;
    for (let k = 0; k <= 4; k++) for (const oz of [-hdA, 0, hdA]) gm = Math.min(gm, gAt(xe + dir * (k - 1) * 1.5, oz));
    if (gm > deck) continue;
    const xa0 = dir < 0 ? xe - 4 : xe - 0.6, xa1 = dir < 0 ? xe + 0.6 : xe + 4;
    const topA = S.bridge ? deck - 0.3 : tTop.top;
    B.box(xa0, gm - 3, -hdA, xa1, topA, hdA, st(T.FOUND, rng.random(), 0.8, gm), 0.1);
  }

  // ---------------------------------------------------------------- deck structure
  // which local side (+z / -z) faces south, toward the lagoon and most cameras
  const south = ux >= 0 ? 1 : -1, north = -south;
  out.south = south;
  if (S.bridge) buildBridgeDeck(S, B, out, { xA, xB, px, nb, rng, st, gAt, W3, compassOf, waterY, wAt, pierGround, south, north });
  else buildAqueductTop(S, B, out, { xA, xB, px, nb, rng, st, gAt, W3, compassOf, waterY, wAt, bayGround, south, north });

  // ledges for the drip-streak shader (top-most first)
  const ledges = [deck - (S.bridge ? 1.25 : S.copH)];
  for (let k = S.tiers.length - 1; k >= 0; k--) ledges.push(S.tiers[k].top - S.tiers[k].bandH);
  out.ledges = ledges.slice(0, 4);
  out.footprints.push({ a: toW(xA, 0), b: toW(xB, 0), halfWidth: t1.depth / 2 + 1.5 });
  return out;
}

/** a "major" pier every few bays (bigger buttress / pedestal / pilaster) */
function isMajor(S, i) { return S.bridge ? i % 3 === 1 : i % 4 === 2; }

/** moulded band profile in (z, y): symmetric about z=0, half depth hd, projection pj */
function bandProfile(hd, pj, y0, h) {
  const right = [
    [hd - 0.02, y0], [hd + pj * 0.25, y0], [hd + pj * 0.25, y0 + h * 0.14],
    [hd + pj * 0.45, y0 + h * 0.24], [hd + pj * 0.7, y0 + h * 0.4], [hd + pj, y0 + h * 0.55],
    [hd + pj, y0 + h * 0.86], [hd + pj * 0.88, y0 + h * 0.93], [hd + pj * 0.55, y0 + h],
  ];
  const left = right.map(([z, y]) => [-z, y]).reverse();
  return [...right, ...left];
}

function buildCutwaters(B, x, hw, hd, yBot, waterY, rng, st, S, spring, southSide) {
  const yc = S.bridge ? waterY + Math.max(5, (spring - waterY) * 0.5) : waterY + rng.range(5.5, 7.5);
  for (const s of [-1, 1]) {
    const S3 = st(T.RUSTIC, rng.random(), 0.9, yBot + 2);
    const capS = st(T.MOULD, rng.random(), 0.8, yBot + 2);
    const zf = s * hd;
    if (s === southSide) {
      // downstream: semicircular cutwater with a half-cone cap and a drip course
      const n = 10, r = hw * 0.98;
      const ring = (y, rr) => { const pts = []; for (let k = 0; k <= n; k++) { const a = Math.PI * (k / n); pts.push([x - Math.cos(a) * rr, y, zf + s * Math.sin(a) * rr]); } return pts; };
      const lo = ring(yBot, r), hi = ring(yc, r);
      for (let k = 0; k < n; k++) {
        const mx = (lo[k][0] + lo[k + 1][0]) / 2 - x, mz = (lo[k][2] + lo[k + 1][2]) / 2 - zf;
        B.quad(lo[k], lo[k + 1], hi[k + 1], hi[k], S3, [mx, 0, mz]);
      }
      const drip = ring(yc, r + 0.14), dripTop = ring(yc + 0.3, r + 0.14);
      for (let k = 0; k < n; k++) {
        const mx = (drip[k][0] + drip[k + 1][0]) / 2 - x, mz = (drip[k][2] + drip[k + 1][2]) / 2 - zf;
        B.quad(drip[k], drip[k + 1], dripTop[k + 1], dripTop[k], capS, [mx, 0, mz]);
        B.tri(drip[k], drip[k + 1], [x, yc, zf], capS, [0, -1, 0]);
      }
      const apex = [x, yc + 0.3 + r * 0.95, zf];
      for (let k = 0; k < n; k++) {
        const mx = (dripTop[k][0] + dripTop[k + 1][0]) / 2 - x, mz = (dripTop[k][2] + dripTop[k + 1][2]) / 2 - zf;
        B.tri(dripTop[k], dripTop[k + 1], apex, capS, [mx, 0.8, mz]);
      }
    } else {
      // upstream: pointed (triangular) cutwater, stepped half-pyramid cap
      const ext = hw * 1.4;
      const p1 = [x - hw, zf], p2 = [x + hw, zf], p3 = [x, zf + s * ext];
      B.quad([p1[0], yBot, p1[1]], [p3[0], yBot, p3[1]], [p3[0], yc, p3[1]], [p1[0], yc, p1[1]], S3, [-1, 0, s * 1.4]);
      B.quad([p3[0], yBot, p3[1]], [p2[0], yBot, p2[1]], [p2[0], yc, p2[1]], [p3[0], yc, p3[1]], S3, [1, 0, s * 1.4]);
      // drip course following the point
      const o = 0.14, yd = yc + 0.3;
      const q1 = [x - hw - o, zf], q2 = [x + hw + o, zf], q3 = [x, zf + s * (ext + o * 1.6)];
      B.quad([q1[0], yc, q1[1]], [q3[0], yc, q3[1]], [q3[0], yd, q3[1]], [q1[0], yd, q1[1]], capS, [-1, 0, s * 1.4]);
      B.quad([q3[0], yc, q3[1]], [q2[0], yc, q2[1]], [q2[0], yd, q2[1]], [q3[0], yd, q3[1]], capS, [1, 0, s * 1.4]);
      B.tri([q1[0], yc, q1[1]], [q3[0], yc, q3[1]], [q2[0], yc, q2[1]], capS, [0, -1, 0]);
      const apex = [x, yd + hw * 0.9, zf];
      B.tri([q1[0], yd, q1[1]], [q3[0], yd, q3[1]], apex, capS, [-0.6, 0.8, s * 0.6]);
      B.tri([q3[0], yd, q3[1]], [q2[0], yd, q2[1]], apex, capS, [0.6, 0.8, s * 0.6]);
    }
  }
}

// ---------------------------------------------------------------- aqueduct top: attic + specus channel
function buildAqueductTop(S, B, out, c) {
  const { xA, xB, rng, st, W3, compassOf, bayGround } = c;
  const deck = S.deck, tTop = S.tiers[S.tiers.length - 1], t1 = S.tiers[0];
  const hW = S.W / 2, hC = S.chW / 2;
  const chFloor = deck - 1.75;
  const yBase = tTop.top;
  const wallTop = deck - S.copH;
  const g = -1e3;
  // solid attic body under the channel
  B.box(xA, yBase - 0.05, -hW, xB, chFloor, hW, st(T.ASHLAR, rng.random(), 0.4, g), 0, 63 & ~(1 << 2));
  // channel lining floor
  B.box(xA, chFloor, -hC, xB, chFloor + 0.05, hC, st(T.LINING, 0.5, 0.5, g), 0, 1 << 3);

  // choose spout bays (water pours out on the upstream side through/over the arches) and one breach gap
  const nb = c.nb, bay = S.bay;
  const deepBays = [];
  for (let i = 1; i < nb - 1; i++) {
    const x0 = xA + i * bay, x1 = x0 + bay;
    const [gb] = bayGround(x0, x1, t1.depth / 2);
    deepBays.push({ i, x: (x0 + x1) / 2, g: gb, open: deck - gb });
  }
  deepBays.sort((a, b) => b.open - a.open);
  const spoutBays = [];
  const nSpouts = S.tiers.length >= 3 ? 2 : 3;
  for (const b of deepBays) {
    if (spoutBays.length >= nSpouts) break;
    if (b.open < 20) continue;
    if (spoutBays.some((o) => Math.abs(o.i - b.i) < 2)) continue;
    spoutBays.push(b);
  }
  // breach: a broken stretch of the channel wall over a bay that is open but not the deepest
  const breach = deepBays.find((b) => b.open > 18 && !spoutBays.some((o) => Math.abs(o.i - b.i) < 2)) || null;
  const breachSide = c.south;
  const gaps = [];
  if (breach) { const bw = rng.range(3.4, 4.6); gaps.push({ x0: breach.x - bw / 2, x1: breach.x + bw / 2, side: breachSide, kind: 'breach' }); }
  // spillways: wide openings in the channel wall with a projecting lip; mostly on the far (north) side so the
  // falls are seen through the arches from the southern viewpoints
  const zFace = t1.depth / 2;
  const spillways = spoutBays.map((b, k) => {
    const side = k === 1 ? c.south : c.north;
    const w = Math.min(S.bay - 4, rng.range(6.0, 9.0));
    const x = b.x + rng.range(-1.5, 1.5);
    const gp = { x0: x - w / 2, x1: x + w / 2, side, kind: 'spill', bay: b };
    gaps.push(gp);
    return gp;
  });

  // side walls of the channel (split around gaps), lining on their inner faces, coping on top
  for (const s of [-1, 1]) {
    const cuts = gaps.filter((gp) => gp.side === s).sort((a, b) => a.x0 - b.x0);
    let x = xA;
    const segs = [];
    for (const gp of cuts) { segs.push([x, gp.x0]); x = gp.x1; }
    segs.push([x, xB]);
    for (const [a, b] of segs) {
      if (b - a < 0.05) continue;
      const z0 = s > 0 ? hC : -hW, z1 = s > 0 ? hW : -hC;
      B.box(a, chFloor, z0, b, wallTop, z1, st(T.ASHLAR, rng.random(), 0.45, g), 0, 63 & ~(1 << 2));
      B.box(a, chFloor + 0.05, s > 0 ? hC - 0.04 : -hC, b, wallTop - 0.25, s > 0 ? hC : -hC + 0.04, st(T.LINING, 0.4, 0.5, g), 0, s > 0 ? 1 << 4 : 1 << 5);
      // coping stones: chamfered blocks with joints every ~1.4 m (slightly irregular)
      let xx = a;
      B.darkEdges = true;
      while (xx < b - 0.05) {
        const l = Math.min(b - xx, rng.range(1.1, 1.8));
        const zi = s > 0 ? hC - 0.06 : -hW - 0.12, zo = s > 0 ? hW + 0.12 : -hC + 0.06;
        B.box(xx + 0.015, wallTop, zi, xx + l - 0.015, deck + rng.range(-0.03, 0.03), zo, st(T.MOULD, rng.random(), 0.5, g), 0.045 * (S.detail >= 0.75 ? 1 : 0.8));
        xx += l;
      }
      B.darkEdges = false;
    }
    for (const gp of cuts) {
      if (gp.kind === 'breach') {
        // tumbled coping stones on the channel lip and ragged wall stubs
        for (let k = 0; k < 5; k++) {
          const bx = rng.range(gp.x0 - 0.2, gp.x1 + 0.2), by = chFloor + rng.range(0.0, 0.5);
          const zc = s * rng.range(hC, hW + 0.3);
          B.box(bx - 0.35, by, zc - 0.3, bx + 0.35, by + rng.range(0.25, 0.6), zc + 0.3, st(T.MOULD, rng.random(), 0.9, g), 0.06);
        }
        for (const ex of [gp.x0, gp.x1]) {
          for (let k = 0; k < 4; k++) {
            const y0 = chFloor + k * 0.4, dxs = (ex === gp.x0 ? 1 : -1) * rng.range(0.1, 0.65);
            B.box(Math.min(ex, ex + dxs), y0, s > 0 ? hC : -hW, Math.max(ex, ex + dxs), y0 + 0.38, s > 0 ? hW : -hC, st(T.ASHLAR, rng.random(), 0.8, g), 0.04);
          }
        }
        // a broken, sagging lip of displaced blocks throws the water clear of the string courses below
        for (let k = 0; k < 4; k++) {
          const bx0 = gp.x0 + ((gp.x1 - gp.x0) * k) / 4, bx1 = bx0 + (gp.x1 - gp.x0) / 4 - 0.06;
          const reach = zFace + rng.range(0.9, 1.5), sag = rng.range(0, 0.35);
          const za = s * (hW - 0.3), zb = s * reach;
          B.box(bx0, chFloor - 0.55 - sag, Math.min(za, zb), bx1, chFloor - 0.05 - sag, Math.max(za, zb), st(T.MOULD, rng.random(), 0.95, g), 0.07);
        }
        for (let k = 0; k < 2; k++) {
          const cxk = gp.x0 + 0.6 + (gp.x1 - gp.x0 - 1.2) * k;
          const za = s * (hW - 0.2), zb = s * (zFace + 0.8);
          B.box(cxk - 0.3, chFloor - 1.4, Math.min(za, zb), cxk + 0.3, chFloor - 0.55, Math.max(za, zb), st(T.MOULD, rng.random(), 0.9, g), 0.04);
        }
        // broken edge of the attic below the breach: a few missing / displaced facing blocks
        for (let k = 0; k < 3; k++) {
          const bx = rng.range(gp.x0, gp.x1), by = chFloor - rng.range(0.4, 1.6);
          B.box(bx - 0.5, by - 0.35, s > 0 ? hW - 0.25 : -hW - 0.05, bx + 0.5, by + 0.35, s > 0 ? hW + 0.05 : -hW + 0.25, st(T.LINING, 0.15, 0.95, g), 0, s > 0 ? 1 << 5 : 1 << 4);
        }
      } else {
        // spillway: projecting lip slab on stepped corbels, guide cheeks, weir crest
        const zIn = s * hC, zOut = s * (zFace + 1.45);
        const z0 = Math.min(zIn, zOut), z1 = Math.max(zIn, zOut);
        const sS = st(T.MOULD, rng.random(), 0.75, -1e3);
        B.darkEdges = true;
        B.box(gp.x0 - 0.35, chFloor - 0.5, z0, gp.x1 + 0.35, chFloor + 0.06, z1, sS, 0.05);
        for (const ex of [gp.x0 - 0.35, gp.x1]) B.box(ex, chFloor + 0.06, z0, ex + 0.35, chFloor + 0.75, z1, sS, 0.04);
        const nc = Math.max(2, Math.round((gp.x1 - gp.x0) / 2.2));
        for (let k = 0; k <= nc; k++) {
          const cxk = gp.x0 + ((gp.x1 - gp.x0) * k) / nc;
          for (let j = 0; j < 3; j++) {
            const reach = (zFace + 1.2) * (1 - j * 0.28);
            const za = s * (hW - 0.2), zb = s * reach;
            B.box(cxk - 0.32, chFloor - 0.5 - 0.42 * (j + 1), Math.min(za, zb), cxk + 0.32, chFloor - 0.5 - 0.42 * j, Math.max(za, zb), sS, 0.03);
          }
        }
        B.darkEdges = false;
      }
    }
  }

  // small pedestals with gilded finials on the coping above every other pier
  for (let i = 1; i < nb; i += 2) {
    const x = xA + i * bay;
    for (const s of [-1, 1]) {
      if (gaps.some((gp) => gp.side === s && x > gp.x0 - 1 && x < gp.x1 + 1)) continue;
      const zc = s * (hC + (hW - hC) / 2 + 0.06);
      B.box(x - 0.42, deck, zc - 0.42, x + 0.42, deck + 0.75, zc + 0.42, st(T.MOULD, rng.random(), 0.5, g), 0.04);
      B.box(x - 0.5, deck + 0.75, zc - 0.5, x + 0.5, deck + 0.9, zc + 0.5, st(T.MOULD, rng.random(), 0.5, g), 0.03);
      out.finials.push({ pos: [x, deck + 0.9, zc], scale: rng.range(0.85, 1.05), rot: rng.range(0, 6.28) });
    }
  }

  // spills
  for (const gp of spillways) {
    const s = gp.side, x = (gp.x0 + gp.x1) / 2;
    const pos = W3(x, chFloor + 0.12, s * (zFace + 1.5));
    out.spills.push({ id: S.id + '-spill-' + out.spills.length, pos, dir: compassOf(0, s), width: gp.x1 - gp.x0 - 0.5, flow: rng.range(0.75, 1.0), kind: 'spillway', drop: chFloor - gp.bay.g, structure: S.id });
    out.wet.push([x, chFloor - 0.5, s, (gp.x1 - gp.x0) * 0.62]);
  }
  if (breach) {
    const gp = gaps.find((q) => q.kind === 'breach');
    const s = gp.side, x = (gp.x0 + gp.x1) / 2;
    const pos = W3(x, chFloor + 0.1, s * (zFace + 1.3));
    out.spills.push({ id: S.id + '-breach', pos, dir: compassOf(0, s), width: gp.x1 - gp.x0 - 0.5, flow: 0.85, kind: 'breach', drop: chFloor - breach.g, structure: S.id });
    out.wet.push([x, chFloor, s, (gp.x1 - gp.x0) * 0.7]);
  }

  // flowing water in the channel (stops at the breach downstream? keep continuous — the breach only spills part)
  out.water.push({ x0: xA, x1: xB, y: chFloor + 0.85, hw: hC - 0.05 });

  // terminal castellum (water tower) at the B end with an outlet spilling the whole channel
  if (S.end === 'castellum') buildCastellum(S, B, out, c, { chFloor, hW, hC });

  // ivy anchors on the channel parapet
  for (let i = 1; i < nb; i++) {
    if (!rng.chance(0.3)) continue;
    const s = rng.sign();
    out.slots.ivy.push({ pos: W3(xA + i * bay + rng.range(-4, 4), deck, s * (hW + 0.12)), facing: compassOf(0, s), size: rng.range(2.5, 11), width: rng.range(1.8, 5), tag: 'aqueduct-top' });
  }
}

function buildCastellum(S, B, out, c, { chFloor, hW }) {
  const { xB, rng, st, gAt, W3, compassOf } = c;
  const deck = S.deck;
  const size = Math.max(9, S.W + 5.5), hs = size / 2;
  const x0 = xB - 1.5, x1 = x0 + size;
  let gMin = Infinity, gMax = -Infinity;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
    const gg = gAt(x0 - 2 + ((size + 4) * i) / 4, -hs - 2 + ((size + 4) * j) / 4); gMin = Math.min(gMin, gg); gMax = Math.max(gMax, gg);
  }
  const top = deck + 2.8;
  const g = gMin;
  const H = top - gMax;
  // battered (tapered) base: 35 % of the height, rough foundation below it
  const yb = gMax + Math.max(4, H * 0.35);
  B.box(x0 - 2.2, gMin - 4, -hs - 2.2, x1 + 2.2, gMax + 0.6, hs + 2.2, st(T.FOUND, rng.random(), 0.9, g), 0.15);
  B.batter(x0 - 1.6, gMax + 0.6, -hs - 1.6, x1 + 1.6, yb, hs + 1.6, 1.55, st(T.RUSTIC, rng.random(), 0.8, g), 0.06);
  B.box(x0 - 0.25, yb - 0.1, -hs - 0.25, x1 + 0.25, yb + 0.45, hs + 0.25, st(T.MOULD, rng.random(), 0.6, g), 0.04);
  // shaft with corner pilasters
  B.box(x0, yb + 0.45, -hs, x1, top - 1.1, hs, st(T.ASHLAR, rng.random(), 0.55, g), 0.06);
  for (const px of [x0 - 0.18, x1 - 1.2]) for (const pz of [-hs - 0.18, hs - 1.2]) {
    B.box(px, yb + 0.45, pz, px + 1.38, top - 1.6, pz + 1.38, st(T.ASHLAR, rng.random(), 0.55, g), 0.05);
    B.box(px - 0.12, top - 1.6, pz - 0.12, px + 1.5, top - 1.1, pz + 1.5, st(T.MOULD, rng.random(), 0.5, g), 0.04);
  }
  for (let y = top - 10; y > yb + 5; y -= 10) B.box(x0 - 0.12, y - 0.4, -hs - 0.12, x1 + 0.12, y, hs + 0.12, st(T.MOULD, rng.random(), 0.5, g), 0.04);
  // cornice + attic with corner acroteria pedestals
  B.extrudeX(bandProfile(hs, 0.5, top - 1.1, 1.1), x0 - 0.5, x1 + 0.5, st(T.MOULD, rng.random(), 0.5, g));
  B.box(x0 - 0.5, top - 1.1, -hs - 0.5, x0, top, hs + 0.5, st(T.MOULD, rng.random(), 0.5, g), 0.04);
  B.box(x1, top - 1.1, -hs - 0.5, x1 + 0.5, top, hs + 0.5, st(T.MOULD, rng.random(), 0.5, g), 0.04);
  B.box(x0 + 0.3, top, -hs + 0.3, x1 - 0.3, top + 1.3, hs - 0.3, st(T.ASHLAR, rng.random(), 0.5, g), 0.05);
  B.box(x0 + 0.15, top + 1.3, -hs + 0.15, x1 - 0.15, top + 1.55, hs - 0.15, st(T.MOULD, rng.random(), 0.5, g), 0.03);
  for (const px of [x0 + 0.9, x1 - 0.9]) for (const pz of [-hs + 0.9, hs - 0.9]) out.finials.push({ pos: [px, top + 1.55, pz], scale: 1.25, rot: rng.range(0, 6.28) });
  // outlet: arched mouth on the far face (+x) with a voussoir ring, keystone and a projecting lip
  const ow = 3.0, rr = ow / 2, oy = chFloor - 0.5, spring = oy + 1.4;
  B.darkEdges = true;
  const N = 9;
  for (let k = 0; k < N; k++) {
    const a0 = Math.PI - (k * Math.PI) / N, a1 = Math.PI - ((k + 1) * Math.PI) / N;
    const key = k === (N - 1) / 2;
    B.voussoirYZ(0, spring, a0, a1, rr, rr + 0.6 + (key ? 0.25 : 0), x1 - 0.6, x1 + 0.12 + (key ? 0.1 : 0), st(T.VOUSS, rng.random(), 0.7, g), 0.04);
  }
  for (const zz of [-rr - 0.6, rr]) B.box(x1 - 0.6, oy, zz, x1 + 0.1, spring, zz + 0.6, st(T.MOULD, rng.random(), 0.7, g), 0.04);   // jambs
  B.box(x1 - 0.2, oy - 0.45, -rr - 0.7, x1 + 1.3, oy, rr + 0.7, st(T.MOULD, rng.random(), 0.8, g), 0.05);                     // lip
  B.darkEdges = false;
  B.box(x1 - 0.9, oy, -rr, x1 - 0.55, spring + rr * 0.95, rr, st(T.LINING, 0.08, 0.95, g), 0, 1 << 1);                       // dark throat
  out.spills.push({ id: S.id + '-end', pos: W3(x1 + 1.35, oy + 0.15, 0), dir: compassOf(1, 0), width: ow - 0.2, flow: 1.0, kind: 'end', drop: oy - gMin, structure: S.id });
  out.wet.push([x1, oy, 0, 0]);
  out.slots.banner.push({ pos: W3((x0 + x1) / 2, top - 1.7, c.south * (hs + 0.08)), facing: compassOf(0, c.south), size: [2.8, 8], tag: 'wall', src: 'aqueduct-castellum' });
  out.slots.ivy.push({ pos: W3(x0 + 1.5, top - 1.1, c.south * (hs + 0.5)), facing: compassOf(0, c.south), size: rng.range(6, 14), width: 3, tag: 'aqueduct-castellum' });
  out.castellum = { x0, x1, top };
}

// ---------------------------------------------------------------- bridge deck: road, cornice, balustrade
function buildBridgeDeck(S, B, out, c) {
  const { xA, xB, px, nb, rng, st, gAt, W3, compassOf, waterY, wAt, pierGround } = c;
  const deck = S.deck, t1 = S.tiers[0];
  const hd = t1.depth / 2, hW = S.W / 2;
  const g = -1e3;
  // find the landing points: first/last pier where the deck meets the ground
  let iA = 0, iB = nb;
  for (let i = 0; i <= nb; i++) { const [gm] = pierGround(px[i], 2, hd); if (gm < deck - 1) { iA = Math.max(0, i - 1); break; } }
  for (let i = nb; i >= 0; i--) { const [gm] = pierGround(px[i], 2, hd); if (gm < deck - 1) { iB = Math.min(nb, i + 1); break; } }
  const xa = px[iA], xb = px[iB];
  // gate tower stands where the east bank comes up close to the deck
  let towerX0 = xb - 1.2;
  for (let x = px[Math.max(iA, iB - 1)]; x < xB; x += 1) {
    if (Math.min(gAt(x, -hd), gAt(x, 0), gAt(x, hd)) >= deck - 4.5) { towerX0 = x - 2.5; break; }
  }
  c.towerX0 = towerX0;
  const xE = Math.min(xB, towerX0 + 10.0);          // the deck stops inside the gate tower

  // deck body
  B.box(xA, t1.top - 0.02, -hd, xE, deck - 1.25, hd, st(T.ASHLAR, rng.random(), 0.45, g), 0, 63 & ~(1 << 2));
  // cornice with a dentil course
  B.extrudeX(corniceProfile(hd, 0.55, deck - 1.25, 1.0), xA, xE, st(T.MOULD, rng.random(), 0.45, g));
  const dStep = S.detail >= 0.75 ? 0.42 : 0.6;
  for (const s of [-1, 1]) {
    for (let x = xA + 0.2; x < Math.min(xE, towerX0) - 0.2; x += dStep) {
      B.box(x, deck - 1.42, s > 0 ? hd - 0.05 : -hd - 0.2, x + dStep * 0.5, deck - 1.25, s > 0 ? hd + 0.2 : -hd + 0.05, st(T.MOULD, rng.random(), 0.5, g), 0, 63 & ~(1 << 3));
    }
  }
  // road paving and raised side walks
  const rw = hW - 1.65;
  B.box(xA, deck - 0.3, -rw, xE, deck, rw, st(T.PAVE, rng.random(), 0.6, g), 0, 1 << 3);
  for (const s of [-1, 1]) {
    B.box(xA, deck - 0.3, s > 0 ? rw : -hW, xE, deck + 0.2, s > 0 ? hW : -rw, st(T.PAVE, rng.random(), 0.5, g), 0.03, 63 & ~(1 << 2));
    // kerb stones
    B.box(xA, deck - 0.05, s > 0 ? rw - 0.02 : -rw - 0.32, xE, deck + 0.24, s > 0 ? rw + 0.32 : -rw + 0.02, st(T.MOULD, rng.random(), 0.6, g), 0.04);
  }

  // balustrade between pedestals
  const balZ = hW - 0.32;
  const pedSize = 1.5;
  const pedX = [];
  for (let i = iA; i <= iB; i++) pedX.push(px[i]);
  // extra pedestal midway over each arch for rhythm
  const mids = [];
  for (let i = iA; i < iB; i++) mids.push((px[i] + px[i + 1]) / 2);
  const xTower = towerX0;
  const allPed = [...pedX.map((x, k) => ({ x, main: true, major: isMajor(S, iA + k) })), ...mids.map((x) => ({ x, main: false }))]
    .filter((p) => p.x < xTower - 1.2).sort((a, b) => a.x - b.x);
  allPed.push({ x: xTower + 0.4, main: false, ghost: true });
  for (const s of [-1, 1]) {
    for (let k = 0; k < allPed.length - 1; k++) {
      const half = (p) => (p.major ? 1.05 : p.main ? pedSize / 2 : 0.4);
      const a = allPed[k].x + half(allPed[k]), b = allPed[k + 1].x - half(allPed[k + 1]);
      if (b - a < 0.4) continue;
      const zc = s * balZ;
      B.box(a, deck + 0.2, zc - 0.27, b, deck + 0.42, zc + 0.27, st(T.MOULD, rng.random(), 0.55, g), 0.03);              // plinth
      B.extrudeX(railProfile(zc, deck + 1.16), a, b, st(T.MOULD, rng.random(), 0.55, g));                              // hand rail
      const n = Math.max(1, Math.floor((b - a) / 0.42));
      for (let j = 0; j < n; j++) out.balusters.push({ pos: [a + ((j + 0.5) * (b - a)) / n, deck + 0.42, zc], scale: 1 });
    }
    // pedestals
    for (const p of allPed) {
      if (p.ghost) continue;
      const zc = s * (hW - (p.major ? 0.1 : 0.38));
      const h = p.major ? 2.35 : p.main ? 1.75 : 1.35, w = p.major ? 1.05 : p.main ? pedSize / 2 : 0.4;
      const S1 = st(T.MOULD, rng.random(), 0.6, g);
      B.box(p.x - w - 0.08, deck + 0.2, zc - w - 0.08, p.x + w + 0.08, deck + 0.42, zc + w + 0.08, S1, 0.03);
      B.box(p.x - w, deck + 0.42, zc - w, p.x + w, deck + h - 0.2, zc + w, st(T.ASHLAR, rng.random(), 0.6, g), 0.04);
      B.box(p.x - w - 0.1, deck + h - 0.2, zc - w - 0.1, p.x + w + 0.1, deck + h, zc + w + 0.1, S1, 0.04);
      const top = [p.x, deck + h, zc];
      if (!p.main) { out.finials.push({ pos: top, scale: 0.7, rot: rng.range(0, 6.28) }); continue; }
      const idx = Math.round((p.x - xA) / S.bay);
      const wtop = W3(...top);
      const facing = compassOf(0, s);
      if (p.x === xa || p.x === xb) out.slots.brazier.push({ pos: wtop, facing, size: 1.0, tag: 'pedestal', src: 'bridge-end' });
      else if (p.major) out.slots.statue.push({ pos: wtop, facing, size: rng.range(3.0, 3.4), tag: 'pedestal', src: 'bridge-major' });
      else if ((idx + (s > 0 ? 0 : 1)) % 2 === 0) out.slots.statue.push({ pos: wtop, facing, size: rng.range(2.3, 2.7), tag: 'pedestal', src: 'bridge' });
      else if (rng.chance(0.5)) out.slots.brazier.push({ pos: wtop, facing, size: 0.9, tag: 'pedestal', src: 'bridge' });
      else out.finials.push({ pos: top, scale: 1.0, rot: rng.range(0, 6.28) });
    }
  }

  // banners on the pier buttresses (camera side), and drain spouts on the far side
  for (let i = iA + 1; i < iB; i++) {
    const x = px[i];
    if (rng.chance(0.55)) {
      const s = c.south; // camera / lagoon side
      out.slots.banner.push({ pos: W3(x, deck - 1.85, s * (hd + 0.72)), facing: compassOf(0, s), size: [2.2, rng.range(6.5, 8.0)], tag: 'wall', src: 'bridge-pier' });
    }
  }
  // ivy curtains hanging from the cornice over spandrels and down the piers
  for (let i = iA; i <= iB; i++) {
    for (const s of [-1, 1]) {
      if (!rng.chance(0.3)) continue;
      const onPier = rng.chance(0.4);
      const x = onPier ? px[i] : px[i] + S.bay / 2 + rng.range(-4, 4);
      if (x > towerX0 - 2 || x < xa) continue;
      out.slots.ivy.push({ pos: W3(x, deck - 0.25, s * (hd + 0.56)), facing: compassOf(0, s), size: onPier ? rng.range(6, 16) : rng.range(2.5, 8), width: rng.range(1.6, 4.5), tag: 'bridge' });
    }
  }
  // lion-head drain spouts at the arch crowns: water from the deck channel pours through the arches
  const crowns = [];
  for (let i = iA; i < iB; i++) {
    const cx = (px[i] + px[i + 1]) / 2;
    const gg = gAt(cx, hd);
    if (gg < waterY + 1 && wAt(cx, 0) < 0) crowns.push({ cx, g: gg });
  }
  const pick = crowns.length <= 2 ? crowns : crowns.filter((_, k) => k % 2 === (crowns.length % 2 ? 0 : 1)).slice(0, 3);
  for (const cr of pick) {
    const s = c.north; // far side: the falls are seen through the arches
    const w = rng.range(4.0, 5.5), yl = deck - 2.75;
    const xo = cr.cx + rng.sign() * (w / 2 + rng.range(1.3, 1.8));   // over the haunch, clear of the keystone
    const zf = s * hd;
    B.darkEdges = true;
    // dark culvert mouth flush with the spandrel, framed by a projecting lip on corbels
    B.box(xo - w / 2, yl + 0.3, s > 0 ? hd - 0.3 : -hd - 0.02, xo + w / 2, yl + 1.0, s > 0 ? hd + 0.02 : -hd + 0.3, st(T.LINING, 0.1, 0.95, -1e3), 0, s > 0 ? 1 << 5 : 1 << 4);
    B.box(xo - w / 2 - 0.25, yl + 1.0, s > 0 ? hd - 0.05 : -hd - 0.3, xo + w / 2 + 0.25, yl + 1.25, s > 0 ? hd + 0.3 : -hd + 0.05, st(T.MOULD, rng.random(), 0.7, -1e3), 0.03);
    B.box(xo - w / 2 - 0.25, yl, s > 0 ? hd - 0.05 : -hd - 1.2, xo + w / 2 + 0.25, yl + 0.3, s > 0 ? hd + 1.2 : -hd + 0.05, st(T.MOULD, rng.random(), 0.8, -1e3), 0.04);
    for (const cx of [xo - w / 2, xo + w / 2]) B.box(cx - 0.25, yl - 0.6, s > 0 ? hd - 0.05 : -hd - 0.8, cx + 0.25, yl, s > 0 ? hd + 0.8 : -hd + 0.05, st(T.MOULD, rng.random(), 0.8, -1e3), 0.03);
    B.darkEdges = false;
    out.spills.push({ id: S.id + '-outlet-' + out.spills.length, pos: W3(xo, yl + 0.35, zf + s * 1.25), dir: compassOf(0, s), width: w - 0.3, flow: rng.range(0.7, 0.95), kind: 'outlet', drop: yl - cr.g, structure: S.id });
    out.wet.push([xo, yl, s, w * 0.7]);
  }

  // gate tower at the acropolis end (B) and a pair of pylons at the A end
  buildGateTower(S, B, out, c, xb, iB);
  out.deckEnds = [xa, xb];
}

function corniceProfile(hd, pj, y0, h) {
  const right = [
    [hd - 0.02, y0], [hd + pj * 0.2, y0], [hd + pj * 0.2, y0 + h * 0.12], [hd + pj * 0.42, y0 + h * 0.2],
    [hd + pj * 0.42, y0 + h * 0.32], [hd + pj * 0.75, y0 + h * 0.45], [hd + pj, y0 + h * 0.58], [hd + pj, y0 + h * 0.86],
    [hd + pj * 0.9, y0 + h * 0.92], [hd + pj * 0.6, y0 + h],
  ];
  return [...right, ...right.map(([z, y]) => [-z, y]).reverse()];
}

function railProfile(zc, y0) {
  // hand rail: rounded top, small fillet below
  const pts = [[-0.25, 0], [0.25, 0], [0.25, 0.06], [0.2, 0.08], [0.2, 0.16], [0.17, 0.2], [0.1, 0.23], [-0.1, 0.23], [-0.17, 0.2], [-0.2, 0.16], [-0.2, 0.08], [-0.25, 0.06]];
  return pts.map(([z, y]) => [zc + z, y0 + y]);
}

function buildGateTower(S, B, out, c, xb, iB) {
  const { rng, st, gAt, W3, compassOf, px } = c;
  const deck = S.deck, t1 = S.tiers[0];
  const hW = S.W / 2;
  const L = 10.5, hs = hW + 1.4;
  const x0 = c.towerX0 ?? xb - 1.2, x1 = x0 + L;
  let gMin = Infinity, gMax = -Infinity;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const gg = gAt(x0 - 0.7 + (L + 1.4) * i / 4, -hs - 0.7 + (2 * hs + 1.4) * j / 4); gMin = Math.min(gMin, gg); gMax = Math.max(gMax, gg); }
  const top = deck + 9.5;
  const g = gMin;
  const pw = hW - 1.65 + 0.2;             // half width of the passage
  const ar = pw, spring = deck + 3.4;     // passage arch
  // foundation + side blocks
  // battered plinth: wide stepped footing down to the lowest ground under the tower
  B.box(x0 - 1.4, gMin - 4, -hs - 1.4, x1 + 1.4, Math.min(gMin + 3, deck - 7), hs + 1.4, st(T.FOUND, rng.random(), 0.9, g), 0.15);
  B.box(x0 - 0.7, gMin - 4, -hs - 0.7, x1 + 0.7, Math.max(gMin + 4, deck - 6), hs + 0.7, st(T.FOUND, rng.random(), 0.8, g), 0.12);
  for (const s of [-1, 1]) {
    const za = s > 0 ? pw : -hs, zb = s > 0 ? hs : -pw;
    B.box(x0, Math.max(gMin + 4, deck - 6) - 0.5, za, x1, top - 1.3, zb, st(T.RUSTIC, rng.random(), 0.6, g), 0.06);
  }
  // block above the passage
  B.box(x0, spring + ar + 0.9, -pw, x1, top - 1.3, pw, st(T.ASHLAR, rng.random(), 0.5, g), 0.05);
  // passage arch faces (in the y-z plane at x0 and x1): build as a separate builder in x-y then rotate
  const tb = new Builder();
  // voussoir ring (rotated): passage arch ring at both faces
  let N = 13;
  for (let k = 0; k < N; k++) {
    const a0 = PI - (k * PI) / N, a1 = PI - ((k + 1) * PI) / N;
    const key = k === (N - 1) / 2;
    tb.voussoir(0, spring, a0, a1, ar, ar + 0.85 + (key ? 0.3 : 0), -0.08 - (key ? 0.08 : 0), L + 0.08 + (key ? 0.08 : 0), st(T.VOUSS, rng.random(), 0.6, g), 0.04);
  }
  // tympanum-free spandrels at both faces: fill corners between ring and the block above
  for (const fz of [-0.02, L + 0.02]) {
    const R = ar + 0.85, a0 = Math.acos(pw / R);
    const contour = [...arcPoints(0, spring, R, 16, PI - a0, a0), [pw, spring + R + 0.1], [-pw, spring + R + 0.1]];
    tb.planeXY(contour, [], fz, fz > 1 ? 1 : -1, st(T.ASHLAR, rng.random(), 0.5, g));
  }
  // map tb (x = across road, z = along road) into the tower frame: x_t = x0 + z, z_t = x (a mirror → flip winding)
  B.appendMapped(tb, (p) => [x0 + p[2], p[1], p[0]], (n) => [n[2], n[1], n[0]], true);

  // cornice + parapet with corner pedestals
  B.extrudeX(corniceProfile(hs, 0.5, top - 1.3, 1.05), x0 - 0.5, x1 + 0.5, st(T.MOULD, rng.random(), 0.5, g));
  B.box(x0 - 0.5, top - 1.3, -hs - 0.5, x0, top - 0.25, hs + 0.5, st(T.MOULD, rng.random(), 0.5, g), 0.04);
  B.box(x1, top - 1.3, -hs - 0.5, x1 + 0.5, top - 0.25, hs + 0.5, st(T.MOULD, rng.random(), 0.5, g), 0.04);
  B.box(x0 + 0.1, top - 0.25, -hs + 0.1, x1 - 0.1, top + 0.9, hs - 0.1, st(T.ASHLAR, rng.random(), 0.5, g), 0.05);
  // string course at deck level around the tower
  B.box(x0 - 0.18, deck - 1.0, -hs - 0.18, x1 + 0.18, deck - 0.6, hs + 0.18, st(T.MOULD, rng.random(), 0.5, g), 0.04);
  // blind arches on the outer faces of the tower (ref 7 look)
  for (const s of [-1, 1]) {
    const R = 2.6, cxx = (x0 + x1) / 2, sp = deck + 0.5;
    let N2 = 11;
    for (let k = 0; k < N2; k++) {
      const a0 = PI - (k * PI) / N2, a1 = PI - ((k + 1) * PI) / N2;
      B.voussoir(cxx, sp, a0, a1, R, R + 0.55, s > 0 ? hs - 0.05 : -hs - 0.12, s > 0 ? hs + 0.12 : -hs + 0.05, st(T.VOUSS, rng.random(), 0.6, g), 0.035);
    }
    const fill = [[cxx - R, deck - 6], [cxx + R, deck - 6], [cxx + R, sp], ...arcPoints(cxx, sp, R, 12, 0, PI).slice(1, -1), [cxx - R, sp]];
    B.planeXY(fill, [], s * (hs - 0.35), s, st(T.ASHLAR, rng.random(), 0.7, g));
    // jambs of the blind arch
    for (const jx of [cxx - R - 0.4, cxx + R]) B.box(jx, deck - 6, s > 0 ? hs - 0.36 : -hs, jx + 0.4, sp, s > 0 ? hs : -hs + 0.36, st(T.ASHLAR, rng.random(), 0.6, g), 0.03);
    out.slots.banner.push({ pos: W3(cxx, top - 1.5, s * (hs + 0.55)), facing: compassOf(0, s), size: [2.6, 8.5], tag: 'wall', src: 'bridge-tower' });
    for (const cx of [x0 + 0.6, x1 - 0.6]) out.slots.brazier.push({ pos: W3(cx, top + 0.9, s * (hs - 0.6)), facing: compassOf(0, s), size: 1.0, tag: 'pedestal', src: 'bridge-tower' });
  }
  out.tower = { x0, x1, top };
}
