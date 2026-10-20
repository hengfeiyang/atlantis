// Ring-city plan: street network, blocks, lots and landmark sites on the two land rings and the outer
// city (layout.js). Polar grid: ring streets (circumferential avenues / lanes) × radial streets; main
// radials continue the bridges (RING_BRIDGES). Everything that belongs to other modules is kept free:
// ring-edge setbacks (walls, towers, quays, ship-sheds), bridgeheads / gate towers, the sea canal + gate
// bridge, the garden terrace (shot 5 set), the fallen-head plaza (shot 8 set), the racecourse, and every
// foreign footprint registered before the city builds (engine.footprints).
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { RectIndex } from './rectindex.js';

const D2R = Math.PI / 180;
export const wrap = (b) => ((b % 360) + 360) % 360;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const MY_TAGS = new Set(['city', 'street', 'city-garden', 'city-plaza', 'city-tree', 'racecourse', 'city-landmark']);

/** district definitions (radii in metres; bands between ring streets carry two rows of lots) */
export function districts() {
  const l1 = L.ringById('l1'), l2 = L.ringById('l2');
  const w1b = L.RING_BRIDGES.find((b) => b.ring === 'w1').bearings, w2b = L.RING_BRIDGES.find((b) => b.ring === 'w2').bearings, w3b = L.RING_BRIDGES.find((b) => b.ring === 'w3').bearings;
  return [
    { id: 'l1', r0: l1.r0 + 15, r1: l1.r1 - 15, streets: [{ r: (l1.r0 + l1.r1) / 2, hw: 7, avenue: true }], spacing: 46,
      main: [...new Set([...w1b, ...w2b])].filter((b) => b !== 180), style: { flat: 0.72, storeys: [2, 3], big: 1.12, classical: 1.9, kiosk: 0.12 }, lot: { w: [10, 18], d: [14, 21] }, keep: 1.0 },
    { id: 'l2', r0: l2.r0 + 15, r1: l2.r1 - 15, streets: [{ r: 634, hw: 3.2 }, { r: 690, hw: 7, avenue: true }, { r: 748, hw: 3.2 }], spacing: 44,
      main: [...new Set([...w2b, ...w3b])], style: { flat: 0.72, storeys: [2, 3], big: 1.0, classical: 1.3, kiosk: 0.08 }, lot: { w: [9, 17], d: [13, 21] }, keep: 1.0 },
    { id: 'outer', r0: L.OUTER_CITY.r0 + 16, r1: L.OUTER_CITY.r1 - 20, every: 66, spacing: 56, main: [...w3b, 30, 330, 60, 300, 90, 270],
      sector: [L.SEA_SECTOR[1] + 9, L.SEA_SECTOR[0] + 360 - 9], style: { flat: 0.55, storeys: [1, 2], big: 0.95, classical: 0.7, kiosk: 0.03 }, lot: { w: [10, 20], d: [13, 22] }, keep: 0.85 },
  ];
}

/** the layout-derived no-build zones (conservative, independent of what the other modules registered) */
export function layoutReserved() {
  const circles = [], rects = [];
  // bridgeheads: gate towers + approach plazas at both ends of every ring bridge
  const ringEdges = { w1: [L.CITADEL.radius, L.ringById('l1').r0], w2: [L.ringById('l1').r1, L.ringById('l2').r0], w3: [L.ringById('l2').r1, L.OUTER_CITY.r0] };
  for (const rb of L.RING_BRIDGES) for (const b of rb.bearings) {
    const [ri, ro] = ringEdges[rb.ring];
    for (const [r, s] of [[ri, -1], [ro, 1]]) {
      if (r <= L.CITADEL.radius) continue;
      const [x, z] = L.polar(r + s * 10, b);
      circles.push({ x, z, r: 21, tag: 'bridgehead' });
    }
  }
  // garden terrace (shot 5 set, ref 5) and the fallen-head plaza (shot 8 set, ref 8)
  { const G = L.GARDEN_TERRACE; const [x, z] = L.polar(G.r + 14, G.bearing); circles.push({ x, z, r: 42, tag: 'garden-terrace' }); }
  { const H = L.FALLEN_HEAD, T = L.FALLEN_TRIDENT; circles.push({ x: FORUM.x, z: FORUM.z, r: FORUM.r + 4, tag: 'fallen-head' }); }
  // sea canal (open cut through l2, tunnel through l1) + great gate bridge towers
  const K = L.SEA_CANAL;
  rects.push({ x0: K.x - K.width / 2 - 14, x1: K.x + K.width / 2 + 14, z0: K.z0 - 20, z1: K.z1 + 60, tag: 'canal' });
  const GB = L.GATE_BRIDGE;
  rects.push({ x0: -GB.towers.offset - 24, x1: GB.towers.offset + 24, z0: GB.z - 34, z1: GB.z + 34, tag: 'gate-bridge' });
  // moles / lighthouses roots
  for (const M of L.MOLES) rects.push({ x0: M.from[0] - 22, x1: M.from[0] + 22, z0: M.from[1] - 30, z1: M.from[1] + 10, tag: 'mole' });
  return { circles, rects };
}

/** the round forum around the fallen-head site (ref 8): open plaza (sets agent) ringed by a colonnade */
export const FORUM = (() => { const H = L.FALLEN_HEAD, T = L.FALLEN_TRIDENT; return { x: (H.pos[0] + T.pos[0]) / 2 + 2, z: (H.pos[2] + T.pos[2]) / 2 - 2, r: 34, plaza: 29 }; })();

/** outer city: dense along water ring 3, thinning out into villas and farms on the plain (ref 1) */
function outerKeep(d, x, z) {
  const n = 0.5 + 0.5 * Math.sin(x * 0.0071 + 1.3) * Math.sin(z * 0.0063 - 0.4);   // clustered suburbs
  if (d < 110) return 0.92;
  if (d < 330) return 0.92 - 0.65 * ((d - 110) / 220) + 0.25 * (n - 0.5);
  return Math.max(0.02, 0.24 - 0.22 * Math.min(1, (d - 330) / 400) + 0.25 * (n - 0.6));
}

export class CityPlan {
  constructor(engine, rng) {
    this.engine = engine; this.rng = rng;
    this.res = layoutReserved();
    this.occ = new RectIndex(32);
    this.streets = [];      // { kind: 'arc'|'radial', r?, b0?, b1?, b?, r0?, r1?, hw, avenue, district }
    this.blocks = [];
    this.lots = [];
    this.sites = [];        // landmark sites { kind, x, z, rot, w, d, district, block }
    this.gardens = [];
    this.extraReserve = [];  // {x, z, hw, hd, rot}
  }
  /** layout zones + foreign footprints */
  reservedAt(x, z, r = 0) {
    for (const c of this.res.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return c.tag;
    for (const q of this.res.rects) if (x > q.x0 - r && x < q.x1 + r && z > q.z0 - r && z < q.z1 + r) return q.tag;
    const fp = this.engine.footprints;
    if (fp) { const hits = fp.query(x, z, r); for (const it of hits) if (!MY_TAGS.has(it.tag)) return it.tag || 'foreign'; }
    return null;
  }
  inDistrict(D, x, z, margin = 0) {
    const r = Math.hypot(x, z);
    if (r < D.r0 + margin || r > D.r1 - margin) return false;
    if (D.sector) {
      const b = L.bearingOf(x, z); let bb = b < D.sector[0] - 1e-6 ? b + 360 : b;
      if (bb < D.sector[0] || bb > D.sector[1]) return false;
      if (heightAt(x, z) < 1.5) return false;
    }
    return true;
  }
  /** can an oriented rect be built here? (district, reserved zones, foreign footprints, other lots) */
  rectFree(D, x, z, hw, hd, rot, { margin = 0, occ = true } = {}) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = [[0, 0], [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, hd], [0, -hd], [hw, 0], [-hw, 0]];
    for (const [lx, lz] of pts) {
      const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
      if (!this.inDistrict(D, px, pz, margin - 1.5)) return false;
      if (this.reservedAt(px, pz, 1.0)) return false;
    }
    if (this.reservedAt(x, z, Math.min(hw, hd))) return false;
    if (occ && this.occ.overlaps(x, z, hw, hd, rot)) return false;
    return true;
  }

  run() {
    for (const D of districts()) this.planDistrict(D);
    return this;
  }

  planDistrict(D) {
    const rng = this.rng.fork('district:' + D.id);
    // ring streets
    let ringsR = D.streets;
    if (D.every) {
      ringsR = [];
      let k = 0;
      for (let r = D.r0 + D.every; r < D.r1 - 30; r += D.every * (0.9 + 0.2 * rng.random()), k++) ringsR.push({ r, hw: k % 4 === 1 ? 6 : 3, avenue: k % 4 === 1 });
    }
    // bands between the ring streets
    const edges = [D.r0, ...ringsR.flatMap((s) => [s.r - s.hw, s.r + s.hw]), D.r1];
    const bands = [];
    for (let i = 0; i < edges.length; i += 2) bands.push({ r0: edges[i], r1: edges[i + 1], inner: i === 0 ? null : ringsR[i / 2 - 1], outer: i / 2 < ringsR.length ? ringsR[i / 2] : null });
    const sec = D.sector || [0, 360];
    for (const s of ringsR) if (D.id !== 'outer' || s.r < D.r0 + 330) this.streets.push({ kind: 'arc', r: s.r, b0: sec[0], b1: sec[1], hw: s.hw, avenue: !!s.avenue, district: D.id });
    // radials (per band, so the outer city keeps a sane block size), main radials snapped to the bridges
    let shared = null;
    for (const band of bands) {
      // land rings: one radial set for the whole ring (streets run through); outer city: per band
      const rm = D.id === 'outer' ? (band.r0 + band.r1) / 2 : (D.r0 + D.r1) / 2;
      const span = sec[1] - sec[0];
      const n = Math.max(4, Math.round((span * D2R * rm) / D.spacing));
      const step = span / n;
      const rads = [];
      for (let i = 0; i <= n; i++) rads.push({ b: sec[0] + i * step, main: false });
      if (span >= 360) rads.pop();
      for (const mb of D.main) {
        let best = null, bd = 1e9;
        for (const r of rads) { const d = angDiff(r.b, mb); if (d < bd) { bd = d; best = r; } }
        if (best && bd < step * 0.7) { best.b = mb < sec[0] ? mb + 360 : mb; best.main = true; }
      }
      rads.sort((a, b) => a.b - b.b);
      if (D.id !== 'outer') { if (!shared) shared = rads; band.rads = shared.map((r) => ({ ...r })); } else band.rads = rads;
      const rads2 = band.rads;
      // blocks
      const cnt = span >= 360 ? rads2.length : rads2.length - 1;
      for (let i = 0; i < cnt; i++) {
        const a = rads2[i], b = rads2[(i + 1) % rads2.length];
        const bA = a.b, bB = b.b + (b.b <= a.b ? 360 : 0);
        this.blocks.push({ D, band, a, b, bA, bB, id: this.blocks.length, merged: false });
      }
    }
    const myBlocks = this.blocks.filter((k) => k.D === D);
    // landmarks: pick blocks (some pinned by the shot compositions), then lots in the rest
    this.pickLandmarks(D, myBlocks, rng.fork('landmarks'));
    for (const k of myBlocks) if (!k.site) this.blockLots(D, k, rng.fork('block' + k.id));
    // radial street segments (skip where blocks are merged into one landmark)
    for (const band of bands) for (const r of band.rads) {
      if (r.suppressed) continue;
      if (D.id === 'outer' && !r.main && band.r0 > D.r0 + 330) continue;
      this.streets.push({ kind: 'radial', b: r.b, r0: band.r0, r1: band.r1, hw: r.main ? 6 : D.id === 'outer' ? 3 : 2.6, avenue: r.main, district: D.id });
    }
  }

  /** radial street half width (deg) at radius r */
  radHalfDeg(rad, r, D) { const hw = rad.main ? 6 : D.id === 'outer' ? 3 : 2.6; return (hw / r) / D2R; }

  pickLandmarks(D, blocks, rng) {
    const want = D.id === 'l1'
      ? { tholos: 9, temple: 4, hall: 3, palace: 3, gym: 1, tower: 8, arcade: 3 }
      : D.id === 'l2' ? { tholos: 12, temple: 6, hall: 4, palace: 3, gym: 2, tower: 14, arcade: 5 }
      : { tholos: 6, temple: 6, hall: 2, palace: 2, gym: 1, tower: 8, arcade: 1 };
    // pinned bearings: what the shot compositions want to see (ref 5 / ref 4 / ref 1)
    const pins = D.id === 'l1' ? [['tholos', 128, 'outer'], ['hall', 150, 'outer'], ['tholos', 165, 'inner'], ['palace', 110, 'inner'], ['tholos', 40, 'outer'], ['hall', 20, 'outer'], ['tholos', 300, 'inner'], ['temple', 212, 'outer'], ['tower', 154, 'inner', 355], ['arcade', 170, 'inner'], ['tower', 146, 'outer'], ['tower', 55, 'outer'], ['tower', 8, 'outer'], ['tholos', 70, 'outer']]
      : D.id === 'l2' ? [['tholos', 100, 'inner'], ['hall', 160, 'inner'], ['tholos', 205, 'inner'], ['temple', 330, 'inner'], ['tholos', 20, 'inner'], ['palace', 260, 'inner'], ['tholos', 188, 'outer'], ['tholos', 172, 'outer'], ['tower', 184, 'outer'], ['tower', 176, 'outer'], ['tower', 60, 'inner'], ['tower', 30, 'inner']] : [];
    const used = [];
    const farEnough = (x, z, d) => used.every((u) => Math.hypot(u[0] - x, u[1] - z) > d);
    const tryBlock = (kind, k, pin = null, pinR = null) => {
      if (k.site) return false;
      const rIn = k.band.r0, rOut = k.band.r1, depth = rOut - rIn;
      const ga = this.radHalfDeg(k.a, (rIn + rOut) / 2, D), gb = this.radHalfDeg(k.b, (rIn + rOut) / 2, D);
      const bm = (k.bA + ga + k.bB - gb) / 2;
      const rm = (rIn + rOut) / 2;
      const arc = ((k.bB - gb) - (k.bA + ga)) * D2R * rIn;
      let w, d, need2 = false;
      if (kind === 'tholos') { w = d = Math.min(depth - 4, 26); }
      else if (kind === 'temple') { w = 22; d = Math.min(depth - 4, 40); }
      else if (kind === 'hall') { w = Math.min(arc - 4, 40); d = Math.min(depth - 4, 40); if (w < 30) return false; }
      else if (kind === 'palace') { w = 44; d = Math.min(depth - 4, 34); need2 = arc < 48; }
      else if (kind === 'gym') { w = 64; d = Math.min(depth - 4, 46); need2 = true; }
      else if (kind === 'tower') { w = d = 9; }
      else if (kind === 'arcade') { w = Math.min(Math.max(arc - 4, 30), 58); d = 12; need2 = arc < 34; }
      let next = null;
      if (need2) {
        next = this.blocks.find((q) => q.band === k.band && q.a === k.b);
        if (!next || next.site || k.b.main) return false;
      }
      const bmid = need2 ? (k.bA + ga + next.bB - this.radHalfDeg(next.b, rm, D)) / 2 : bm;
      // towers stand at the block corner on the main radial; others centred, facing the busier street
      let rr = rm, bb = bmid;
      if (kind === 'tholos' || kind === 'temple') {
        const towardInner = pin ? pin === 'inner' : k.band.inner && (!k.band.outer || k.band.inner.avenue);
        rr = towardInner ? rIn + d / 2 + 1.5 : rOut - d / 2 - 1.5;
      }
      if (kind === 'tower' && pin) { rr = pinR ?? (pin === 'inner' ? rIn + 8 : rOut - 8); }
      else if (kind === 'tower') { if (!k.a.main && !k.b.main) return false; bb = k.a.main ? k.bA + ga + (8 / rm) / D2R : k.bB - gb - (8 / rm) / D2R; rr = k.band.outer ? rOut - 7 : rIn + 7; }
      if (kind === 'arcade') { const ti = pin ? pin === 'inner' : !!k.band.inner; rr = ti ? rIn + d / 2 + 2 : rOut - d / 2 - 2; }
      const [x, z] = L.polar(rr, bb);
      const towardIn = kind === 'arcade' ? (pin ? pin === 'inner' : !!k.band.inner) : (kind === 'tholos' || kind === 'temple') ? (pin ? pin === 'inner' : k.band.inner && (!k.band.outer || k.band.inner.avenue)) : (!k.band.outer || (k.band.inner && k.band.inner.avenue && !k.band.outer.avenue));
      const rot = towardIn ? -bb * D2R : Math.PI - bb * D2R;
      if (!farEnough(x, z, kind === 'tower' || kind === 'arcade' || pin ? 40 : 70)) return false;
      if (!this.rectFree(D, x, z, w / 2 + 1, d / 2 + 1, rot)) return false;
      const site = { kind, x, z, rot, w, d, district: D.id, block: k.id, bearing: wrap(bb) };
      this.sites.push(site);
      this.occ.add(x, z, w / 2 + 1, d / 2 + 1, rot, 'landmark');
      used.push([x, z]);
      if (kind === 'hall' || kind === 'palace' || kind === 'gym' || (kind === 'arcade' && next)) { k.site = site; if (next) { next.site = site; k.b.suppressedIn = k.band; k.b.suppressed = true; } }
      else k.partial = true;
      return true;
    };
    for (const [kind, b, side, pr] of pins) {
      const cands = blocks.filter((k) => !k.site && (side === 'inner' ? !k.band.inner : !k.band.outer) && angDiff((k.bA + k.bB) / 2, b) < 12)
        .sort((p, q) => angDiff((p.bA + p.bB) / 2, b) - angDiff((q.bA + q.bB) / 2, b));
      for (const k of cands) if (tryBlock(kind, k, side, pr ?? null)) { want[kind] = Math.max(0, (want[kind] || 0) - 1); break; }
    }
    const order = ['gym', 'palace', 'hall', 'arcade', 'temple', 'tholos', 'tower'];
    for (const kind of order) {
      let n = want[kind] || 0, tries = 0;
      while (n > 0 && tries++ < 400) {
        const k = blocks[Math.floor(rng.random() * blocks.length)];
        if (kind === 'tower') { if (tryBlock(kind, k)) n--; continue; }
        // prefer blocks on the avenue
        const onAve = (k.band.inner && k.band.inner.avenue) || (k.band.outer && k.band.outer.avenue);
        if (!onAve && rng.chance(0.6)) continue;
        if (tryBlock(kind, k)) n--;
      }
    }
  }

  /** two rows of lots per block (facing the two bounding ring streets), garden court in between */
  blockLots(D, k, rng) {
    const { band } = k;
    const depth = band.r1 - band.r0;
    const rowsSides = [['in', band.r0], ['out', band.r1]];
    let maxIn = 0, maxOut = 0;
    const row = rng.chance(D.id === 'l2' ? 0.45 : D.id === 'l1' ? 0.3 : 0.2);
    for (const [side, rs] of rowsSides) {
      const ga = this.radHalfDeg(k.a, rs, D) + (1.2 / rs) / D2R, gb = this.radHalfDeg(k.b, rs, D) + (1.2 / rs) / D2R;
      let b = k.bA + ga;
      const bEnd = k.bB - gb;
      const dmax = Math.min(D.lot.d[1], depth / 2 - (depth > 40 ? 3 : 0.5));
      if (dmax < 8) continue;
      const dLot = row ? rng.range(Math.min(dmax, D.lot.d[0]), dmax) : 0;
      while (b < bEnd - 0.01) {
        let w = rng.range(D.lot.w[0], D.lot.w[1]);
        const d = row ? dLot : rng.range(Math.min(dmax, D.lot.d[0]), dmax);
        // use the frontage radius of the deeper (narrower) edge for the inner row
        const rDeep = side === 'in' ? rs + d : rs - d;
        const rNar = Math.min(rs, rDeep);
        let db = (w / rNar) / D2R;
        if (b + db > bEnd) { const rem = (bEnd - b) * D2R * rNar; if (rem < D.lot.w[0] * 0.7) break; w = rem; db = bEnd - b; }
        const bc = b + db / 2;
        const rc = side === 'in' ? rs + d / 2 : rs - d / 2;
        const [x, z] = L.polar(rc, bc);
        const rot = side === 'in' ? -bc * D2R : Math.PI - bc * D2R;   // front faces the street at rs
        const keep = D.keep * (D.id === 'outer' ? outerKeep(Math.hypot(x, z) - D.r0, x, z) : 1);
        if (rng.random() < keep && this.rectFree(D, x, z, w / 2 - 0.1, d / 2 - 0.1, rot)) {
          const lot = { x, z, w: w - 0.3, d, rot, seed: rng.random(), row, district: D.id, side, bearing: wrap(bc), r: rc, block: { seed: rng.random(), uniform: false } };
          this.occ.add(x, z, w / 2 - 0.1, d / 2 - 0.1, rot, 'lot');
          this.lots.push(lot);
          if (side === 'in') maxIn = Math.max(maxIn, d); else maxOut = Math.max(maxOut, d);
        } else if (D.id === 'outer' && Math.hypot(x, z) < 1500 && rng.chance(0.35) && this.inDistrict(D, x, z) && !this.reservedAt(x, z, 4)) {
          // unbuilt outer-city lots: orchards / fields (vegetation)
          this.gardens.push({ x, z, hw: w / 2 - 1, hd: d / 2 - 1, rot, kind: 'orchard' });
        }
        b += db;
      }
    }
    // inner court garden of the block
    const g0 = band.r0 + maxIn + 1, g1 = band.r1 - maxOut - 1;
    if (g1 - g0 > 4) {
      const rm = (g0 + g1) / 2, bm = (k.bA + k.bB) / 2;
      const arc = (k.bB - k.bA) * D2R * rm - 8;
      if (arc > 6) {
        const [x, z] = L.polar(rm, bm);
        if (!this.reservedAt(x, z, 2)) this.gardens.push({ x, z, hw: arc / 2 - 1, hd: (g1 - g0) / 2 - 0.5, rot: -bm * D2R, kind: 'court' });
      }
    }
  }
}
