// Ring plan (pure, deterministic, importable by any module at any time — no engine needed):
// wall edges, stretches between gaps, towers, gates, ship-shed bays, quays, tunnel, canal, moles.
// OWNER: rings agent. `ringPlan()` is memoised; build() publishes it as engine.registry.rings.
//
// Conventions: compass bearing b (deg, 0 = north = -Z, 90 = east = +X). polar(r, b) = [sin b·r, -cos b·r].
// Every edge has `side` = +1 when the water lies at larger radius (outer edge of a land mass), -1 when it
// lies at smaller radius. `faceR` = radius of the masonry face at the water line (revetment), `wallR` =
// radius of the curtain-wall face (set back from faceR toward the land), `landY` = ground height at the
// top of the face, `wallTop` = parapet top.
import * as L from '../world/layout.js';

export const TOWER_HALF = 5.6;     // half width of a wall tower (square plan)
export const TOWER_PROJ = 3.2;     // projection of a tower in front of the curtain face
export const GATE_HALF = 5.5;      // half width of a ring-bridge gate gap (the curtain ends inside the bridge's 12 m gate tower)
export const STAIR_GATE_HALF = 19; // citadel quay at 180: the grand stair (34 m) lands between two of our towers
export const SHED = { pitch: 15, clear: 10.5, depth: 14, back: 22, crown: { l1: 9.6, l2: 8.2 } };
export const BAY = 7.5;            // nominal curtain bay length (pilaster spacing)

const D2R = Math.PI / 180;
export const polarXZ = (r, b) => [Math.sin(b * D2R) * r, -Math.cos(b * D2R) * r];
export const wrap360 = (b) => ((b % 360) + 360) % 360;
/** shortest signed difference b - a in degrees */
export const dBear = (a, b) => ((b - a + 540) % 360) - 180;

// Land-ring faces: the masonry revetment stands PUSH m in front of the analytic face foot so the terrain's
// rock relief (±3 m, src/terrain/field.js) stays hidden behind it; the curtain stands just behind the
// revetment face and a paved apron closes the gap back to the flat rim (r ± 3.5).
export const PUSH = 3.35;
function edgeDefs() {
  const [w1, l1, w2, l2] = L.RINGS;
  const C = L.CITADEL;
  const land = (id, g, side, r, floor, water) => {
    const faceR = r + side * PUSH;
    return { id, ring: g.id, r, side, faceR, landY: g.top, wallR: faceR - side * 0.85, rimR: r - side * 3.5, wallH: g.wall.height, cladding: g.wall.cladding, floor, water, curtain: true };
  };
  return [
    { id: 'citadel', ring: 'citadel', r: C.radius, side: +1, faceR: C.radius + 0.35, landY: C.quayY, wallR: C.wall.r, rimR: C.wall.r, wallH: C.wall.height, cladding: C.wall.cladding, floor: w1.floor, water: 'w1', curtain: true },
    land('l1-in', l1, -1, l1.r0, w1.floor, 'w1'),
    land('l1-out', l1, +1, l1.r1, w2.floor, 'w2'),
    land('l2-in', l2, -1, l2.r0, w2.floor, 'w2'),
    land('l2-out', l2, +1, l2.r1, -14, 'w3'),
    // the outer-city shore of water ring 3 (north only): a quay revetment with a balustrade, no curtain
    { id: 'outer', ring: 'outer', r: L.OUTER_CITY.r0, side: -1, faceR: L.OUTER_CITY.r0 - 0.35, landY: L.OUTER_CITY.y, wallR: L.OUTER_CITY.r0 + 0.4, rimR: L.OUTER_CITY.r0 + 3.5, wallH: 0, cladding: null, floor: -10, water: 'w3', curtain: false },
  ];
}

/**
 * bridge gates affecting an edge. The ring bridges (bridges agent, src/bridges/plan.js) put a gate tower
 * (12 m wide) on the land at each end: the curtain simply ends inside it (gap ±GATE_HALF, no towers of
 * ours). Special cases: the grand stair lands on the citadel quay at 180 (wide gap framed by our towers);
 * the high canal-mouth arch (w1-180) abuts land ring 1 above the tunnel portal: no gap, a tower of ours at 180.
 */
function gatesFor(e) {
  const out = [];
  for (const rb of L.RING_BRIDGES) {
    const w = L.ringById(rb.ring);
    const touches = (e.side === +1 && Math.abs(w.r0 - e.r) < 1) || (e.side === -1 && Math.abs(w.r1 - e.r) < 1);
    if (!touches) continue;
    for (const b of rb.bearings) {
      if (rb.ring === 'w1' && b === 180) {
        if (e.id === 'citadel') out.push({ bearing: b, kind: 'stair', water: rb.ring, half: STAIR_GATE_HALF, flank: true });
        else out.push({ bearing: b, kind: 'abut', water: rb.ring, half: 0, tower: false });
        continue;
      }
      out.push({ bearing: b, kind: 'bridge', water: rb.ring, half: GATE_HALF, flank: false });
    }
  }
  return out;
}

/** blocked bearing intervals [b0, b1] (deg, may wrap) for an edge, with what blocks them */
function blocksFor(e) {
  const blocks = [];
  const R = e.wallR;
  const halfDeg = (m) => (m / R) / D2R;
  for (const g of gatesFor(e)) {
    if (!(g.half > 0)) continue;
    const h = halfDeg(g.half + (g.flank ? 2 * TOWER_HALF : 0));   // flanking towers stand inside the block ends
    blocks.push({ b0: g.bearing - h, b1: g.bearing + h, kind: 'gate', gate: g, flank: g.flank });
  }
  // sea canal through land ring 2 (open cut |x| < width/2 + edge) and the outer shore at 180
  if (e.ring === 'l2' || e.id === 'outer') {
    const hw = L.SEA_CANAL.width / 2 + 3.5;
    const h = Math.asin(Math.min(1, (hw + 0.5) / e.faceR)) / D2R;
    blocks.push({ b0: 180 - h, b1: 180 + h, kind: 'canal', flank: true });
  }
  if (e.id === 'outer') blocks.push({ b0: L.SEA_SECTOR[0] - 16, b1: L.SEA_SECTOR[1] + 16, kind: 'sea', flank: false });
  return blocks;
}

/** split [0,360) minus blocks into free stretches [{b0, b1, flankA, flankB}] (b1 > b0, may exceed 360) */
function stretches(blocks) {
  const iv = blocks.map((b) => ({ a: wrap360(b.b0), b: wrap360(b.b0) + (b.b1 - b.b0), flank: !!b.flank })).sort((p, q) => p.a - q.a);
  const merged = [];
  for (const it of iv) {
    const m = merged[merged.length - 1];
    if (m && it.a <= m.b) { if (it.b >= m.b) { m.b = it.b; m.flankEnd = it.flank; } }
    else merged.push({ a: it.a, b: it.b, flankStart: it.flank, flankEnd: it.flank });
  }
  if (!merged.length) return [{ b0: 0, b1: 360, closed: true }];
  const out = [];
  for (let i = 0; i < merged.length; i++) {
    const nx = i + 1 < merged.length ? merged[i + 1] : merged[0];
    const a = merged[i].b, b = i + 1 < merged.length ? nx.a : nx.a + 360;
    if (b - a > 0.05) out.push({ b0: a, b1: b, flankA: merged[i].flankEnd, flankB: nx.flankStart });
  }
  return out;
}

function shedRangesFor(e) {
  const out = [];
  for (const s of L.SHIP_SHEDS) {
    if (s.ring !== e.ring) continue;
    if ((s.face === 'inner') !== (e.side === -1)) continue;
    out.push({ b0: s.bearings[0], b1: s.bearings[1] });
  }
  return out;
}

let PLAN = null;
/** the full ring plan (memoised) */
export function ringPlan() {
  if (PLAN) return PLAN;
  const edges = edgeDefs();
  const towers = [], gates = [], sheds = [], quays = [], shedFillers = [];
  for (const e of edges) {
    e.wallTop = e.landY + e.wallH;
    // garden bastion on top of the wall (ref 5 viewpoint, sets agent builds the deck on it): solid block, no curtain
    e.bastions = [];
    const GT = L.GARDEN_TERRACE;
    if (GT && GT.ring === e.ring && GT.r - GT.size[1] / 2 < e.wallR + 1 && GT.r + GT.size[1] / 2 > e.wallR - 1 && e.curtain) {
      const h = (GT.size[0] / 2 / e.wallR) / D2R;
      e.bastions.push({ b0: GT.bearing - h, b1: GT.bearing + h, bearing: GT.bearing, deck: GT.deck ?? e.wallTop, r0: GT.r - GT.size[1] / 2, r1: GT.r + GT.size[1] / 2 });
    }
    e.blocks = blocksFor(e);
    e.stretches = stretches(e.blocks);
    for (const g of gatesFor(e)) {
      const [x, z] = polarXZ(e.wallR, g.bearing);
      gates.push({ edge: e.id, ring: e.ring, water: g.water, kind: g.kind, bearing: g.bearing, pos: [x, e.landY, z], faceR: e.faceR, wallR: e.wallR, side: e.side, landY: e.landY, wallTop: e.wallTop, halfWidth: g.half, facing: wrap360(g.bearing + (e.side > 0 ? 0 : 180)) });
    }
    // towers: ~72 m apart along each stretch; at stretch ends only where the gap is ours (stair, canal);
    // forced towers where a bridge abuts the wall (canal-mouth arch)
    if (e.curtain) {
      const forced = gatesFor(e).filter((g) => g.tower).map((g) => g.bearing);
      for (const st of e.stretches) {
        const endInset = (TOWER_HALF + 0.2) / e.wallR / D2R;
        const free = 26 / e.wallR / D2R;                    // first tower this far from an un-flanked end
        const a = st.closed ? st.b0 : st.b0 + (st.flankA ? endInset : free), b = st.closed ? st.b1 : st.b1 - (st.flankB ? endInset : free);
        if (b <= a) continue;
        const len = (b - a) * D2R * e.wallR;
        const n = Math.max(st.closed ? 3 : 1, Math.round(len / 72));
        const list = [];
        for (let k = 0; k <= n; k++) { if (st.closed && k === n) break; list.push({ b: a + (k * (b - a)) / n, end: !st.closed && ((k === 0 && st.flankA) || (k === n && st.flankB)) }); }
        // forced towers replace the nearest regular one
        for (const fb of forced) {
          if (!inRange(fb, { b0: st.b0, b1: st.b1 })) continue;
          let bi = 0, bd = 1e9;
          list.forEach((t, i) => { const d = Math.abs(dBear(t.b, fb)); if (d < bd) { bd = d; bi = i; } });
          list[bi] = { b: fb, end: true, gate: true };
        }
        for (const t of list) {
          const [x, z] = polarXZ(e.wallR, t.b);
          if (e.ring === 'l1' && z > 0 && Math.abs(x) < L.SEA_CANAL.width / 2 + 3.5 + TOWER_HALF + 4) continue; // tunnel portals below
          if (e.bastions.some((bs) => Math.abs(dBear(bs.bearing, t.b)) * D2R * e.wallR < (bs.b1 - bs.b0) / 2 * D2R * e.wallR + TOWER_HALF + 3)) continue; // garden bastion
          towers.push({ edge: e.id, ring: e.ring, bearing: wrap360(t.b), pos: [x, e.landY, z], base: e.landY, top: e.wallTop + 9, facing: wrap360(t.b + (e.side > 0 ? 0 : 180)), end: !!t.end, cladding: e.cladding });
        }
      }
    }
    // ship-shed bays (rock-cut arcades at water level), in groups of 7 separated by solid rock piers
    e.shedCover = [];
    for (const rg of shedRangesFor(e)) {
      const pitchDeg = SHED.pitch / e.faceR / D2R;
      const clearDeg = 30 / e.faceR / D2R;   // bridge abutments + gate towers
      const bad = gatesFor(e).map((g) => g.bearing);
      let b = rg.b0 + pitchDeg / 2, k = 0, group = 0, inGroup = 0, runStart = null, last = null;
      const groupLen = 7;
      const close = () => { if (runStart !== null) e.shedCover.push([runStart, last + pitchDeg / 2]); runStart = null; };
      while (b < rg.b1 - pitchDeg / 2) {
        if (bad.some((g) => Math.abs(dBear(g, b)) < clearDeg)) { close(); b += pitchDeg; inGroup = 0; group++; continue; }
        if (inGroup === groupLen) {
          // solid pier between two groups
          shedFillers.push({ edge: e.id, bearing: b - pitchDeg / 2 + pitchDeg * 0.3, halfDeg: pitchDeg * 0.3 });
          b += pitchDeg * 0.6; inGroup = 0; group++; continue;
        }
        const [x, z] = polarXZ(e.faceR, b);
        const out = e.side;   // +1: opening faces outward
        const front = e.faceR + out * SHED.depth;
        const [fx, fz] = polarXZ(front, b);
        sheds.push({ edge: e.id, ring: e.ring, index: k, group, bearing: b, faceR: e.faceR, frontR: front, halfDeg: pitchDeg / 2,
          pos: [fx, 0, fz], back: [x, 0, z], facing: wrap360(b + (out > 0 ? 0 : 180)),
          width: SHED.clear, crown: SHED.crown[e.ring], depth: SHED.depth, length: SHED.depth + SHED.back, slot: 'trireme', landY: e.landY });
        if (runStart === null) runStart = b - pitchDeg / 2;
        last = b;
        b += pitchDeg; k++; inGroup++;
      }
      close();
    }
    e.shedRanges = shedRangesFor(e);
  }
  // quays: low walks at y ≈ 1.3 in front of the revetment on both sides of every gate and in the canal
  for (const g of gates) {
    const e = edges.find((q) => q.id === g.edge);
    const span = 70 / e.faceR / D2R;
    for (const sgn of [-1, 1]) {
      if (!(g.halfWidth > 0)) continue;
      const b0 = g.bearing + sgn * ((g.halfWidth + 8) / e.faceR / D2R), b1 = b0 + sgn * span;
      if (e.shedRanges.some((r) => inRange(b0, r) || inRange(b1, r))) continue;
      quays.push({ edge: e.id, b0: Math.min(b0, b1), b1: Math.max(b0, b1), y: 1.3, width: 4.5 });
    }
  }
  const K = L.SEA_CANAL, hw = K.width / 2;
  const canal = {
    x: K.x, halfWidth: hw, faceX: hw - 0.3, quayY: 1.4, quayW: 5.0,
    z0: L.RINGS[3].r0, z1: L.RINGS[3].r1, landY: L.RINGS[3].top,
  };
  const T = L.CANAL_TUNNEL;
  const tunnel = { z0: T.z0, z1: T.z1, clear: T.clear, springY: 3.2, crownY: 3.2 + T.clear / 2, landY: L.RINGS[1].top, halfWidth: hw + 3.5 };
  const moles = L.MOLES.map((m) => ({ ...m, halfWidth: 9, topY: 3.2, light: { pos: [m.lighthouse[0], 3.2, m.lighthouse[1]], height: 46 } }));
  PLAN = { edges, bastions: edges.flatMap((e) => e.bastions.map((b) => ({ ...b, edge: e.id }))), towers, gates, sheds, shedFillers, quays, canal, tunnel, moles, constants: { TOWER_HALF, TOWER_PROJ, GATE_HALF, SHED, BAY } };
  return PLAN;
}
export function inRange(b, r) { const d = wrap360(b - r.b0); return d <= wrap360(r.b1 - r.b0); }
/** edge by id */
export const edgeById = (id) => ringPlan().edges.find((e) => e.id === id);
/** is bearing b of edge e covered by ship-shed bays (± margin metres)? */
export function inShedRange(e, b, margin = 0) {
  const m = margin / e.faceR / D2R;
  return (e.shedCover || []).some(([b0, b1]) => inRange(b, { b0: b0 - m, b1: b1 + m }));
}
/** is the whole bearing interval [b0, b1] covered by ship-shed bays? */
export function shedCovers(e, b0, b1) {
  return (e.shedCover || []).some(([c0, c1]) => inRange(b0, { b0: c0, b1: c1 }) && inRange(b1, { b0: c0, b1: c1 }) && wrap360(b1 - c0) >= wrap360(b0 - c0));
}
