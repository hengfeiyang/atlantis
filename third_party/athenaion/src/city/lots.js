// Lots along the contour streets + an oriented-rectangle occupancy index (own buildings, landmarks).
import { Polyline } from './plan.js';
import { Simplex } from '../core/noise.js';
const QN = new Simplex(5150);

export class RectIndex {
  constructor(cell = 32) { this.cell = cell; this.m = new Map(); this.items = []; }
  _cells(r, fn) {
    const c = this.cell, br = r.br;
    for (let ix = Math.floor((r.x - br) / c); ix <= Math.floor((r.x + br) / c); ix++)
      for (let iz = Math.floor((r.z - br) / c); iz <= Math.floor((r.z + br) / c); iz++) fn(ix * 73856 + iz * 19349);
  }
  add(x, z, hw, hd, rot, tag = '') {
    const r = { x, z, hw, hd, rot, c: Math.cos(rot), s: Math.sin(rot), br: Math.hypot(hw, hd), tag };
    this._cells(r, (k) => { let b = this.m.get(k); if (!b) this.m.set(k, (b = [])); b.push(r); });
    this.items.push(r);
    return r;
  }
  /** SAT overlap test of an oriented rect against the index */
  overlaps(x, z, hw, hd, rot, ignoreTag = null) {
    const q = { x, z, hw, hd, rot, c: Math.cos(rot), s: Math.sin(rot), br: Math.hypot(hw, hd) };
    let hit = false;
    const seen = new Set();
    this._cells(q, (k) => {
      if (hit) return;
      const b = this.m.get(k); if (!b) return;
      for (const r of b) {
        if (seen.has(r)) continue; seen.add(r);
        if (ignoreTag && r.tag === ignoreTag) continue;
        if (Math.hypot(r.x - q.x, r.z - q.z) > r.br + q.br) continue;
        if (obbOverlap(q, r)) { hit = true; return; }
      }
    });
    return hit;
  }
}

function axes(r) {
  // local x axis in world (cos, -sin) and local z axis (sin, cos)  (THREE rotation.y convention)
  return [[r.c, -r.s], [r.s, r.c]];
}
function obbOverlap(a, b) {
  const A = axes(a), B = axes(b);
  const d = [b.x - a.x, b.z - a.z];
  for (const ax of [...A, ...B]) {
    const pa = a.hw * Math.abs(A[0][0] * ax[0] + A[0][1] * ax[1]) + a.hd * Math.abs(A[1][0] * ax[0] + A[1][1] * ax[1]);
    const pb = b.hw * Math.abs(B[0][0] * ax[0] + B[0][1] * ax[1]) + b.hd * Math.abs(B[1][0] * ax[0] + B[1][1] * ax[1]);
    if (Math.abs(d[0] * ax[0] + d[1] * ax[1]) > pa + pb) return false;
  }
  return true;
}

/**
 * Lots along every contour street, both sides. Returns [{x,z,rot,w,d,street:{x,z}, side}]
 * rot: THREE rotation.y such that the lot's local +Z (front) faces the street.
 */
export function makeLots(plan, occ, engine, rng, opts) {
  const lots = [];
  const { roadHalf = 2.6, keep = 1.0 } = opts;
  const Bhash = plan.B.hash;
  const fp = engine.footprints;
  const Ahash = plan.A.hash;
  // depth available behind a street point: half-way to the next street (or lane) on that side
  const blockDepth = (li, x, z, nx, nz) => {
    for (let r = 6; r <= 60; r += 2) {
      const px = x + nx * r, pz = z + nz * r;
      if (!plan.inMask(px, pz)) return r - 1;
      const o = Ahash.nearest(px, pz, r + 2, li, -1, Infinity);
      if (o < r) return (r + o) / 2 - 1.2;
    }
    return 60;
  };
  // r5: consecutive row lots are grouped into "blocks" sharing one design (palazzo-length facades,
  // ref 1); own random stream so the lot layout itself is unchanged
  const brng = opts.blockRng;
  let block = null, blockLeft = 0;
  for (const [li, pts] of plan.A.lines.entries()) {
    const pl = new Polyline(pts);
    for (const side of [1, -1]) {
      let s = rng.range(0, 6);
      let run = 0, runD = 0, runSet = 0;
      blockLeft = 0;
      const maxD = 31 / 2 - roadHalf - 0.6;
      while (s < pl.length - 4) {
        if (run <= 0) {
          const P0 = pl.at(Math.min(s + 6, pl.length));
          const pr = opts.rowProb ? opts.rowProb(P0.x, P0.z) : 0.4;
          if (rng.chance(pr)) { run = rng.int(3, 10); runD = rng.range(10.5, 15); runSet = roadHalf + rng.range(0.05, 0.5); }
          else run = 0;
        }
        const inRow = run > 0;
        let w = inRow ? rng.range(5.5, 11.5) : rng.range(7.5, 14.5);
        if (!inRow && rng.chance(0.14)) w = rng.range(15, 22); // wide lots → villas / courtyard houses
        if (inRow && rng.chance(0.08)) w = rng.range(12, 17);
        const sc = s + w / 2;
        if (sc > pl.length - 3) break;
        const P = pl.at(sc);
        const nx = -P.tz, nz = P.tx; // left normal
        const avail = blockDepth(li, P.x, P.z, nx * side, nz * side) - (inRow ? runSet : roadHalf + 0.8);
        let d = inRow ? Math.max(runD, Math.min(avail, 26)) : Math.min(Math.max(avail, 9), 26) * rng.range(0.92, 1.0);
        if (avail < 7) d = Math.max(6.5, avail);
        void maxD;
        const setback = inRow ? runSet : roadHalf + rng.range(0.2, 1.4);
        const cx = P.x + nx * side * (setback + d / 2), cz = P.z + nz * side * (setback + d / 2);
        const fx = -nx * side, fz = -nz * side;
        const rot = Math.atan2(fx, fz);
        const qn = QN.fbm2(cx / 230, cz / 230, 3);
        let ok = true;
        const kept = rng.chance(inRow ? 0.97 : keep * (qn < -0.32 ? 0.25 : 1));
        // stay clear of the downhill lanes
        if (ok && Bhash.nearest(cx, cz, w) < w / 2 + 2.2) ok = false;
        if (ok) {
          const c = Math.cos(rot), sn = Math.sin(rot);
          for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]]) {
            const x = cx + lx * c + lz * sn, z = cz - lx * sn + lz * c;
            if (!plan.inMask(x, z)) { ok = false; break; }
          }
        }
        const shrink = inRow ? 0.6 : 0.15;
        if (ok && occ.overlaps(cx, cz, w / 2 - shrink, d / 2 - shrink, rot)) ok = false;
        if (ok) {
          // other modules' footprints (temples, aqueduct piers…): probe a few circles
          const c = Math.cos(rot), sn = Math.sin(rot);
          const rr = Math.min(w, d) * 0.3;
          for (const [lx, lz] of [[0, 0], [-w * 0.3, -d * 0.3], [w * 0.3, -d * 0.3], [w * 0.3, d * 0.3], [-w * 0.3, d * 0.3]]) {
            const x = cx + lx * c + lz * sn, z = cz - lx * sn + lz * c;
            if (!fp.isFree(x, z, rr)) { ok = false; break; }
          }
        }
        if (ok && !kept) {
          // an orchard / kitchen garden instead of a house
          occ.add(cx, cz, w / 2, d / 2, rot, 'garden');
          if (opts.gardens) opts.gardens.push({ x: cx, z: cz, hw: w / 2 - 0.8, hd: d / 2 - 0.8, rot, kind: 'orchard' });
          if (opts.orchards) opts.orchards.push({ x: cx, z: cz, w, d, rot, seed: rng.random() });
          ok = false;
        }
        if (ok) {
          occ.add(cx, cz, w / 2, d / 2, rot, 'lot');
          const lot = { x: cx, z: cz, rot, w, d, street: [P.x, P.z], side, seed: rng.random(), row: inRow };
          if (inRow && brng) {
            if (blockLeft <= 0 || !block) { block = { seed: brng.random(), uniform: brng.chance(0.5) }; blockLeft = brng.int(2, 4); }
            lot.block = block; blockLeft--;
          }
          lots.push(lot);
        } else blockLeft = 0;
        if (inRow) { run--; if (!ok) run = 0; s += w + 0.02; }
        else { blockLeft = 0; s += w + (rng.chance(0.25) ? rng.range(0.8, 4) : rng.range(0.05, 0.4)); }
      }
    }
  }
  return lots;
}

/**
 * Back-fill: houses (and orchards) in the buildable pockets the street-front lots did not reach
 * (between diverging streets). Each is oriented along the contour field, facing downhill.
 */
export function fillLots(plan, occ, engine, rng, opts) {
  const lots = [];
  const fp = engine.footprints;
  const streetHash = plan.A.hash, laneHash = plan.B.hash;
  const step = 7;
  for (let z = plan.z0 + 10; z < plan.z1 - 10; z += step) for (let x = plan.x0 + 10; x < plan.x1 - 10; x += step) {
    const px = x + rng.range(-2.5, 2.5), pz = z + rng.range(-2.5, 2.5);
    if (!plan.inMask(px, pz)) continue;
    if (streetHash.nearest(px, pz, 6) < 5.5 || laneHash.nearest(px, pz, 5) < 4) continue;
    const w = rng.range(7, 13), d = rng.range(7, 11);
    // orientation: front faces downhill (gradient of the smoothed height)
    const gx = plan.Hs.sample(px + 3, pz) - plan.Hs.sample(px - 3, pz), gz = plan.Hs.sample(px, pz + 3) - plan.Hs.sample(px, pz - 3);
    let rot;
    if (Math.hypot(gx, gz) < 0.05) { const g = plan.gradDir(px, pz); rot = Math.atan2(g[0], g[1]); }
    else rot = Math.atan2(-gx, -gz);
    rot += rng.range(-0.08, 0.08);
    if (occ.overlaps(px, pz, w / 2 + 0.6, d / 2 + 0.6, rot)) continue;
    const c = Math.cos(rot), sn = Math.sin(rot);
    let ok = true;
    for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
      const qx = px + lx * c + lz * sn, qz = pz - lx * sn + lz * c;
      if (!plan.inMask(qx, qz) || streetHash.nearest(qx, qz, 3) < 2.7 || laneHash.nearest(qx, qz, 3) < 1.9) { ok = false; break; }
    }
    if (!ok) continue;
    for (const [lx, lz] of [[0, 0], [-w * 0.3, -d * 0.3], [w * 0.3, d * 0.3]]) {
      const qx = px + lx * c + lz * sn, qz = pz - lx * sn + lz * c;
      if (!fp.isFree(qx, qz, Math.min(w, d) * 0.3)) { ok = false; break; }
    }
    if (!ok) continue;
    if (rng.chance(opts.orchard ?? 0.3)) {
      occ.add(px, pz, w / 2, d / 2, rot, 'garden');
      if (opts.gardens) opts.gardens.push({ x: px, z: pz, hw: w / 2 - 0.6, hd: d / 2 - 0.6, rot, kind: 'orchard' });
      if (opts.orchards) opts.orchards.push({ x: px, z: pz, w, d, rot, seed: rng.random() });
      continue;
    }
    occ.add(px, pz, w / 2, d / 2, rot, 'lot');
    lots.push({ x: px, z: pz, rot, w, d, street: null, side: 0, seed: rng.random(), fill: true });
  }
  return lots;
}
