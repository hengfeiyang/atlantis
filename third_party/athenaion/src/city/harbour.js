// Harbour of the town in the north-east corner of the bay (layout.SEA.bay / layout.HARBOUR):
// stone quays following the coastline, two moles with a lighthouse, ship sheds (neosoikoi) with
// slipways, arcaded warehouses built against the cliff, bollards. Returns mooring spots for ships.
import { heightAt } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { Frame } from './geobuilder.js';
import { stoneBox, column, quadFacing, roof, volume, woodBox } from './house.js';
import { amphora } from './ships.js';
import { ring } from './landmarks.js';
import { chaikin, Polyline } from './plan.js';
import { WIN, GROUND, FLAG } from '../materials/plaster.js';

const QUAY = 5, PAVING = 1, DRESSED = 3, POLY = 2, BOULDER = 4, MARBLE = 7, ASHLAR = 0;
const QY = 1.7; // quay top height

/** coastline points from rays cast from the bay centre, compass angles a0..a1 */
export function traceCoast(a0, a1, step = 2) {
  const C = L.SEA.bay.center;
  const pts = [];
  for (let a = a0; a <= a1; a += step) {
    const r = (a * Math.PI) / 180, dx = Math.sin(r), dz = -Math.cos(r);
    for (let d = 0; d < 1100; d += 8) {
      if (heightAt(C[0] + dx * d, C[1] + dz * d) > 0.4) {
        // refine backwards to ~0.5 m
        let lo = Math.max(0, d - 8), hi = d;
        for (let k = 0; k < 5; k++) { const m = (lo + hi) / 2; if (heightAt(C[0] + dx * m, C[1] + dz * m) > 0.4) hi = m; else lo = m; }
        pts.push([C[0] + dx * hi, C[1] + dz * hi]);
        break;
      }
    }
  }
  return pts;
}

/** offset a polyline sideways; side: +1 = left normal */
function offsetLine(pts, dist, side = 1) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.push([pts[i][0] - tz * dist * side, pts[i][1] + tx * dist * side]);
  }
  return out;
}

/** vertical wall strip along a polyline (outside = right-hand side when walking the line) */
function wallStrip(B, pts, y0, y1, kind, seed, builder = 'stone') {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.01) continue;
    const y0a = typeof y0 === 'function' ? y0(a) : y0, y0b = typeof y0 === 'function' ? y0(b) : y0;
    const y1a = typeof y1 === 'function' ? y1(a) : y1, y1b = typeof y1 === 'function' ? y1(b) : y1;
    const st = (u, v) => [u, v, seed, kind];
    B[builder].quad([a[0], y0a, a[1]], [b[0], y0b, b[1]], [b[0], y1b, b[1]], [a[0], y1a, a[1]], null,
      { aSt: [st(s, y0a), st(s + len, y0b), st(s + len, y1b), st(s, y1a)] });
    s += len;
  }
}
/** horizontal ribbon between two polylines (same length), facing up */
function ribbon(B, A, Bp, y, kind, seed) {
  let s = 0;
  for (let i = 0; i < A.length - 1; i++) {
    const len = Math.hypot(A[i + 1][0] - A[i][0], A[i + 1][1] - A[i][1]);
    const st = (u, v) => [u, v, seed, kind];
    const yA = typeof y === 'function' ? y(i) : y, yB = typeof y === 'function' ? y(i + 1) : y;
    quadFacing(B.stone, [A[i][0], yA, A[i][1]], [A[i + 1][0], yB, A[i + 1][1]], [Bp[i + 1][0], yB, Bp[i + 1][1]], [Bp[i][0], yA, Bp[i][1]], [0, 1, 0],
      { aSt: [st(s, 0), st(s + len, 0), st(s + len, 8), st(s, 8)] });
    s += len;
  }
}

function resample(pts, step) {
  const pl = new Polyline(pts);
  const n = Math.max(2, Math.ceil(pl.length / step));
  const out = [];
  for (let i = 0; i <= n; i++) { const p = pl.at((i / n) * pl.length); out.push([p.x, p.z]); }
  return out;
}

/** a rough boulder (distorted octahedron-ish) into the stone builder */
function boulder(B, x, y, z, r, rng, seed) {
  const k = 0.55;
  const v = [];
  const n = 8;
  // top ring, bottom ring, apexes
  for (let j = 0; j < 2; j++) for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + j * 0.4 + rng.range(-0.2, 0.2);
    const rr = r * rng.range(0.75, 1.15) * (j ? 0.8 : 1.0);
    v.push([x + Math.cos(a) * rr, y + (j ? r * k : -r * 0.2) * rng.range(0.8, 1.2), z + Math.sin(a) * rr]);
  }
  const top = [x + rng.range(-0.2, 0.2) * r, y + r * rng.range(0.85, 1.1), z + rng.range(-0.2, 0.2) * r];
  const st = (p) => [p[0] + p[2] * 0.3, p[1], seed, BOULDER];
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    const a = v[i], b = v[i1], c = v[n + i1], d = v[n + i];
    const mx = (a[0] + b[0]) / 2 - x, mz = (a[2] + b[2]) / 2 - z;
    quadFacing(B.stone, a, b, c, d, [mx, 0.2, mz], { aSt: [st(a), st(b), st(c), st(d)] });
    const want = [0, 1, 0];
    const p0 = d, p1 = c;
    const tri = [p0, p1, top];
    // top cap
    const nrm = [(p0[0] + p1[0]) / 2 - x, r, (p0[2] + p1[2]) / 2 - z];
    quadFacing(B.stone, p0, p1, top, top, nrm, { aSt: [st(p0), st(p1), st(top), st(top)] });
    void want; void tri;
  }
}

// opts (all optional): coast (polyline walked with the water on the right-hand side; default: the
// bay coast), quayOut (m the quay edge stands out from the coastline), moles / sheds / warehouses (false = skip),
// whIn (m from the quay edge to the warehouse centres), whAny (build warehouses on low ground too)
export function buildHarbour(getB, engine, rng, opts = {}) {
  const out = { moorings: [], anchorages: [], sheds: [], lighthouse: null, quay: [] };
  // ---------------------------------------------------------------- coastline + quay
  let coast = opts.coast ? opts.coast.slice() : traceCoast(-2, 86, 2);
  if (coast.length < 6) return out;
  if (!opts.coast) coast = chaikin(chaikin(coast));
  coast = resample(coast, 4);
  // walking the coast from west to east, the sea is on the right-hand side
  const qOut = opts.quayOut ?? 13;
  const outer = offsetLine(coast, qOut, 1);
  const inner = offsetLine(coast, 5, -1);
  const outer2 = offsetLine(coast, qOut - 0.6, 1);
  const seed = rng.random();
  const Bq = getB(coast[(coast.length / 2) | 0][0], coast[(coast.length / 2) | 0][1]);
  // quay wall (sea face) and top paving
  wallStrip(Bq, outer, -5, QY, QUAY, seed);
  ribbon(Bq, inner, outer, QY, PAVING, seed);
  // coping stones along the edge
  wallStrip(Bq, outer2, QY, QY + 0.25, DRESSED, seed);
  ribbon(Bq, outer2, outer, QY + 0.25, DRESSED, seed);
  // retaining wall at the foot of the cliff (polygonal masonry), only where the ground is high
  const foot = offsetLine(coast, 3.5, -1);
  const footH = (p) => Math.max(QY + 1.5, Math.min(heightAt(p[0], p[1]) + 1, QY + 14));
  wallStrip(Bq, foot, QY - 0.2, (p) => footH(p), POLY, seed * 1.3 % 1);
  out.quay = { coast, outer };

  // bollards + moorings along the quay
  const pl = new Polyline(outer);
  for (let s = 8; s < pl.length - 8; s += rng.range(9, 14)) {
    const P = pl.at(s);
    const nx = -P.tz, nz = P.tx; // right normal (toward the sea)
    const bx = P.x - nx * 0.9, bz = P.z - nz * 0.9;
    const F = new Frame(bx, 0, bz, 0);
    column(getB(bx, bz), F, 0, 0, 0.22, 0.2, QY, QY + 0.65, 8, seed, DRESSED);
    out.moorings.push({ x: P.x + nx * 1.0, z: P.z + nz * 1.0, heading: Math.atan2(nx, nz), s, bollard: [bx, QY + 0.6, bz] });
  }

  // cargo on the quay: amphora stacks, crates, bales, nets
  for (let s = 12; s < pl.length - 12; s += rng.range(5, 16)) {
    if (rng.chance(0.35)) continue;
    const P = pl.at(s);
    const nx = -P.tz, nz = P.tx;
    const d = rng.range(3.0, 7.5);
    const cx = P.x - nx * d, cz = P.z - nz * d;
    const F = new Frame(cx, 0, cz, Math.atan2(P.tx, P.tz) + rng.range(-0.3, 0.3));
    const Bc = getB(cx, cz);
    const r = rng.random();
    if (r < 0.45) {
      // amphorae standing in rows / leaning in a heap
      const n = rng.int(4, 14);
      for (let k = 0; k < n; k++) {
        const ax = (k % 4) * 0.42 - 0.6 + rng.range(-0.05, 0.05), az = Math.floor(k / 4) * 0.42 + rng.range(-0.05, 0.05);
        const [wx, , wz] = F.p(ax, 0, az);
        amphora(Bc, wx, QY, wz, rng.range(0.9, 1.1), rng.random());
      }
    } else if (r < 0.8) {
      const n = rng.int(2, 6);
      for (let k = 0; k < n; k++) {
        const sx = rng.range(0.35, 0.6), sy = rng.range(0.35, 0.6), sz = rng.range(0.35, 0.7);
        const lx = rng.range(-1.2, 1.2), lz = rng.range(-0.8, 0.8);
        woodBox(Bc, F, lx, lz, sx, sz, QY, QY + sy * 2, rng.chance(0.5) ? 9 : 10, rng.random());
        if (rng.chance(0.3)) woodBox(Bc, F, lx + rng.range(-0.1, 0.1), lz, sx * 0.9, sz * 0.9, QY + sy * 2, QY + sy * 2 + sy * 1.6, 10, rng.random());
      }
    } else {
      // fishing nets heaped (canvas-coloured mounds) and a rope coil
      woodBox(Bc, F, 0, 0, rng.range(0.7, 1.3), rng.range(0.5, 0.9), QY, QY + rng.range(0.25, 0.45), 6, rng.random());
      woodBox(Bc, F, 1.4, 0.3, 0.3, 0.3, QY, QY + 0.18, 10, rng.random());
    }
  }

  // ---------------------------------------------------------------- moles
  const C = L.SEA.bay.center;
  const at = (a, d) => { const r = (a * Math.PI) / 180; return [C[0] + Math.sin(r) * d, C[1] - Math.cos(r) * d]; };
  // west mole: from the north shore, south-east then east; east mole: from the east shore westward
  const westRoot = coast[Math.min(coast.length - 1, Math.round(coast.length * 0.12))];
  const eastRoot = coast[Math.round(coast.length * 0.93)];
  const west = [[westRoot[0], westRoot[1] - 3], [westRoot[0] + 30, westRoot[1] + 120], [westRoot[0] + 70, westRoot[1] + 230], [westRoot[0] + 150, westRoot[1] + 285]];
  const east = [[eastRoot[0] + 3, eastRoot[1]], [eastRoot[0] - 90, eastRoot[1] + 20], [eastRoot[0] - 190, eastRoot[1] + 15]];
  void at;
  const moles = [west, east];
  out.moleLines = [];
  out.basinCenter = [(westRoot[0] + west[3][0] + east[2][0] + eastRoot[0]) / 4, (westRoot[1] + west[3][1] + east[2][1] + eastRoot[1]) / 4];
  for (const [mi, raw] of (opts.moles === false ? [] : moles).entries()) {
    const line = resample(chaikin(chaikin(raw)), 4);
    out.moleLines.push(line);
    const B = getB(line[(line.length / 2) | 0][0], line[(line.length / 2) | 0][1]);
    const hw = 5;
    const left = offsetLine(line, hw, 1), right = offsetLine(line, hw, -1);
    const my = QY + 0.5;
    wallStrip(B, left, -5, my, QUAY, seed + mi);
    wallStrip(B, right.slice().reverse(), -5, my, QUAY, seed + mi);
    ribbon(B, left, right, my, PAVING, seed + mi);
    // seaward parapet (on the left side for the west mole = outside, right side for the east mole)
    const sea = mi === 0 ? 1 : -1;
    const pA = offsetLine(line, hw - 0.1, sea), pB = offsetLine(line, hw - 0.9, sea);
    wallStrip(B, sea > 0 ? pA : pA.slice().reverse(), my, my + 1.3, ASHLAR, seed + mi);
    wallStrip(B, sea > 0 ? pB.slice().reverse() : pB, my, my + 1.3, ASHLAR, seed + mi);
    ribbon(B, pA, pB, my + 1.3, DRESSED, seed + mi);
    // rubble breakwater boulders on the seaward side
    const bl = offsetLine(line, hw + 2.2, sea);
    for (let i = 0; i < bl.length; i++) {
      for (let k = 0; k < 2; k++) {
        const j = rng.range(-1.6, 1.6);
        const p = bl[i];
        boulder(B, p[0] + rng.range(-1.2, 1.2) + (k ? j : 0), rng.range(-1.2, 0.3) - k * 0.6, p[1] + rng.range(-1.2, 1.2), rng.range(1.2, 2.2), rng, seed);
      }
    }
    // end: round bastion
    const end = line[line.length - 1];
    const Fe = new Frame(end[0], 0, end[1], 0);
    ring(B, Fe, 8.5, -5, my, 20, seed, QUAY);
    if (mi === 0) out.lighthouse = { x: end[0], z: end[1], y: my };
    else {
      // small shrine / statue base at the east mole head
      stoneBox(B, Fe, 0, 0, 1.2, 1.2, my, my + 2.4, MARBLE, seed, 31);
    }
    // moorings along the inner side
    const inn = offsetLine(line, hw + 0.8, -sea);
    for (let i = 6; i < inn.length - 6; i += 3) {
      const a = inn[i - 1], b = inn[i + 1];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const nx = -tz * -sea, nz = tx * -sea;
      out.moorings.push({ x: inn[i][0], z: inn[i][1], heading: Math.atan2(nx, nz), mole: mi, bollard: [inn[i][0] - nx * 1.2, my + 0.1, inn[i][1] - nz * 1.2] });
    }
  }

  // ---------------------------------------------------------------- lighthouse (3 tiers + fire)
  if (out.lighthouse) {
    const { x, z, y } = out.lighthouse;
    const F = new Frame(x, 0, z, 0.3);
    const B = getB(x, z);
    // Pharos-like: square base with a battered plinth, octagonal shaft, round lantern with columns
    stoneBox(B, F, 0, 0, 7.4, 7.4, y - 1, y + 2.2, ASHLAR, seed, 31);
    stoneBox(B, F, 0, 0, 6.2, 6.2, y + 2.2, y + 19, ASHLAR, seed, 31);
    stoneBox(B, F, 0, 0, 6.7, 6.7, y + 19, y + 19.8, DRESSED, seed, 63);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) stoneBox(B, F, sx * 5.8, sz * 5.8, 0.5, 0.5, y + 19.8, y + 21.0, MARBLE, seed, 31);
    ring(B, F, 4.4, y + 19.8, y + 33, 8, seed, ASHLAR);
    ring(B, F, 4.9, y + 33, y + 33.7, 8, seed, DRESSED);
    ring(B, F, 3.0, y + 33.7, y + 36.5, 16, seed, ASHLAR);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      column(B, F, Math.cos(a) * 2.55, Math.sin(a) * 2.55, 0.2, 0.17, y + 36.5, y + 40.5, 6, seed, MARBLE);
    }
    ring(B, F, 3.1, y + 40.5, y + 41.2, 16, seed, DRESSED);
    roof(B, F, { cx: 0, cz: 0, hw: 2.8, hd: 2.8, yT: y + 41.2, type: 'pyramid', pitch: 35, over: 0.2, floorY: y, h: 41, sty: [seed, 4, 0, FLAG.BLANK] }, seed);
    out.lighthouse.fire = [x, y + 37.6, z];
  }

  // ---------------------------------------------------------------- ship sheds on the north quay
  if (opts.sheds !== false) {
    const startS = pl.length * 0.2, n = 7, w = 7.2, len = 34;
    const P0 = pl.at(startS), P1 = pl.at(startS + n * w);
    const tx = P1.x - P0.x, tz = P1.z - P0.z; const tl = Math.hypot(tx, tz) || 1;
    // rotation so the shed's local +z points out to sea (right normal of the coast direction)
    const sx = -tz / tl, sz = tx / tl;
    const rot = Math.atan2(sx, sz);
    const B = getB(P0.x, P0.z);
    for (let i = 0; i < n; i++) {
      const c = startS + (i + 0.5) * w;
      const P = pl.at(c);
      const F = new Frame(P.x + sx * (len / 2 - 6), 0, P.z + sz * (len / 2 - 6), rot);
      // slipway ramp (paved, sloping into the water)
      quadFacing(B.stone, F.p(-w / 2 + 0.5, QY - 0.1, -len / 2), F.p(w / 2 - 0.5, QY - 0.1, -len / 2), F.p(w / 2 - 0.5, -1.5, len / 2), F.p(-w / 2 + 0.5, -1.5, len / 2), [0, 1, 0],
        { aSt: [[0, 0, seed, PAVING], [w, 0, seed, PAVING], [w, len, seed, PAVING], [0, len, seed, PAVING]] });
      // column rows on both sides (shared between neighbours)
      for (const side of [-1, 1]) {
        if (side === 1 && i < n - 1) continue;
        const xx = side * w / 2;
        for (let k = 0; k <= 6; k++) {
          const zz = -len / 2 + (k * len) / 6;
          const [px, , pz] = F.p(xx, 0, zz);
          const gy = Math.min(QY, heightAt(px, pz));
          stoneBox(B, F, xx, zz, 0.45, 0.45, gy - 4, QY + 0.2, ASHLAR, seed, 15);
          column(B, F, xx, zz, 0.3, 0.27, QY + 0.2, QY + 5.6, 8, seed, DRESSED);
        }
        stoneBox(B, F, xx, 0, 0.4, len / 2 + 0.3, QY + 5.6, QY + 6.3, DRESSED, seed, 63);
      }
      // the leftmost row
      if (i === 0) {
        const xx = -w / 2;
        for (let k = 0; k <= 6; k++) {
          const zz = -len / 2 + (k * len) / 6;
          stoneBox(B, F, xx, zz, 0.45, 0.45, -4, QY + 0.2, ASHLAR, seed, 15);
          column(B, F, xx, zz, 0.3, 0.27, QY + 0.2, QY + 5.6, 8, seed, DRESSED);
        }
        stoneBox(B, F, xx, 0, 0.4, len / 2 + 0.3, QY + 5.6, QY + 6.3, DRESSED, seed, 63);
      }
      // gable roof with the ridge running out to sea
      roof(B, new Frame(...F.p(0, 0, 0), rot + Math.PI / 2), { cx: 0, cz: 0, hw: len / 2 + 0.3, hd: w / 2 + 0.1, yT: QY + 6.3, type: 'gableX', pitch: 20, over: 0.4, floorY: QY, h: 6, sty: [seed, 4, 0, FLAG.BLANK], noGableWall: true }, (seed + i * 0.13) % 1);
      out.sheds.push({ x: F.x, z: F.z, rot, len, w, slope: Math.atan2(QY + 1.5, len) });
    }
    out.shedRange = [startS - 4, startS + n * w + 4];
  }

  // ---------------------------------------------------------------- warehouses against the cliff
  if (opts.warehouses !== false) {
    const P = pl;
    let s = 20;
    while (s < P.length - 30) {
      const w = rng.range(10, 24);
      const inShed = out.shedRange && s + w > out.shedRange[0] && s < out.shedRange[1];
      const p0 = P.at(s), p1 = P.at(s + w);
      const tx = p1.x - p0.x, tz = p1.z - p0.z; const tl = Math.hypot(tx, tz);
      const nx = -tz / tl, nz = tx / tl; // toward the sea
      const wIn = opts.whIn ?? qOut + 0.5;
      const cx = (p0.x + p1.x) / 2 - nx * wIn, cz = (p0.z + p1.z) / 2 - nz * wIn; // centre 8 m inland of the outer quay
      const gB = heightAt(cx - nx * 4, cz - nz * 4);
      if (!inShed && rng.chance(0.95) && (opts.whAny || gB > QY + 1.2) && tl > w * 0.8) {
        const rot = Math.atan2(nx, nz);
        const F = new Frame(cx, 0, cz, rot);
        const storeys = rng.int(1, 3);
        const seedH = rng.random();
        // r5: windows on every side (the panorama sees the backs and ends), loggias / bands on some
        // (own hash stream so the warehouse layout itself is unchanged)
        const hq = (k) => { const v = Math.sin(seedH * 9301.7 + k * 49.3) * 43758.5453; return v - Math.floor(v); };
        const fb = (hq(1) < 0.5 ? FLAG.BANDS : 0) | (hq(2) < 0.4 ? FLAG.SHUTTERS : 0) | (hq(3) < 0.3 ? FLAG.QUOINS : 0);
        const lg = storeys >= 2 && hq(4) < 0.35 ? FLAG.LOGGIA : 0;
        const flags = { front: FLAG.DOOR | fb | lg, back: fb | (hq(5) < 0.25 ? FLAG.BLANK : lg), left: fb | (hq(6) < 0.3 ? FLAG.BLANK : 0), right: fb | (hq(7) < 0.3 ? FLAG.BLANK : 0) };
        volume(getB(cx, cz), F, { cx: 0, cz: 0, hw: w / 2 - 0.3, hd: 4.5, floorY: QY, h: storeys * 4.2 + 0.4, stH: 4.2, groundY: QY - 1, seed: seedH,
          roof: rng.chance(0.6) ? 'gableX' : 'shed', pitch: 18, over: 0.4, style: WIN.ARCH + 8 * (rng.chance(0.6) ? GROUND.ARCADE : GROUND.SHOP), flags, cornice: rng.chance(0.3) });
        engine.footprints.addRect(cx, cz, w / 2, 4.6, rot, 'city');
      }
      s += w + (rng.chance(0.7) ? 0.05 : rng.range(2, 8));
    }
  }
  return out;
}
