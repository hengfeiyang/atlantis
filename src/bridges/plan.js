// Bridge plan: pure function of the layout (no three.js) so other modules (rings walls, city lots, ships)
// can import it at any time to leave gaps / route around the bridges. OWNER: bridges agent.
//
//   import { bridgePlan, GATE } from '../bridges/plan.js';
//   bridgePlan() → [{ id, ring, bearing, deck, rotY, x0, x1, halfWidth, towers:[{x0, x1, halfW, top}], arches:[{x0,x1,crown}],
//                     special }]      x = radius along the bearing (local frame: x = r, z = across, +z = clockwise side)
//   GATE: the great gate bridge over the canal (world coords; axis = world x at z = GATE.z)
import * as L from '../world/layout.js';

const G = L.GATE_BRIDGE;
// the great gate bridge (ref 2): main arch over the canal, gate towers flanking it on the canal banks,
// arcaded side viaducts over the quays and monumental stairs down to land ring 2.
export const GATE = {
  z: G.z, deck: G.deck,
  span: G.arch.span, rise: G.arch.rise, spring: 3.0,
  halfDepth: 11,                                    // spandrel faces at z = G.z ± 11
  tower: { w: 21, d: 24, inner: G.arch.span / 2, top: 50.0, height: G.towers.height },   // tower x ∈ ±[28, 49]; r2: body top 45 → 50, tips ≈ 74 (< sunken surface 78)
  sideBays: 3, sideSpan: 12, sideSpring: 18, viaductEnd: 104, abutment: 6, stairEnd: 156, stairHalfW: 9,
  // NOTE: layout GATE_BRIDGE.towers.offset (52) ≈ the OUTER edge of the towers here (centre 39): the ref 2
  // proportions put each tower directly over the arch springing (tower width ≈ 0.43 span).
};
GATE.tower.x0 = GATE.tower.inner; GATE.tower.x1 = GATE.tower.inner + GATE.tower.w;
GATE.footprint = { cx: 0, cz: G.z, hw: GATE.stairEnd, hd: 13 };

const innerTop = (g) => (g.id === 'w1' ? L.CITADEL.quayY : L.RINGS[L.RINGS.indexOf(g) - 1].top);
const outerTop = (g) => { const n = L.RINGS[L.RINGS.indexOf(g) + 1]; return n ? n.top : L.OUTER_CITY.y; };

// rings agent (src/rings/plan.js): revetment faces stand PUSH m in front of the analytic ring edge, curtain
// walls rise wall.height above the land; our towers sit in the curtain gaps, their fronts flush with the faces.
const PUSH = 3.35;
const wallTopOf = (id) => {
  if (id === 'citadel') return L.CITADEL.quayY + L.CITADEL.wall.height;
  const g = L.ringById(id);
  return g && g.wall ? g.top + g.wall.height : (g ? g.top : L.OUTER_CITY.y);
};
const landInside = (g) => (g.id === 'w1' ? 'citadel' : L.RINGS[L.RINGS.indexOf(g) - 1].id);
const landOutside = (g) => { const n = L.RINGS[L.RINGS.indexOf(g) + 1]; return n ? n.id : 'outer'; };

export function bridgePlan() {
  const out = [];
  for (const rb of L.RING_BRIDGES) {
    const g = L.ringById(rb.ring);
    for (const b of rb.bearings) {
      const special = rb.ring === 'w1' && b === 180 ? 'canalMouth' : null;
      const wIn = wallTopOf(landInside(g)), wOut = landOutside(g) === 'outer' ? L.OUTER_CITY.y : wallTopOf(landOutside(g));
      // the high arch meets the wall-walk of land ring 1 (curtain top) above the tunnel portal
      const deck = special ? wOut : Math.max(innerTop(g), outerTop(g)) + 1.5;
      const td = 11, tw = 12, hw = 5.2;
      const towers = [];
      let x0, x1;
      const fIn = g.r0 + (g.id === 'w1' ? 0.35 : PUSH) + 0.5, fOut = g.r1 - (landOutside(g) === 'outer' ? 0.35 : PUSH) - 0.5;
      if (special) {
        // tower standing in w1 just off the citadel quay (the grand stair lands behind it); the outer end
        // abuts the curtain of land ring 1 above the canal-tunnel portal
        towers.push({ x0: g.r0 + 2, x1: g.r0 + 2 + 12, halfW: 7, top: deck + 13.5 });
        x0 = towers[0].x1; x1 = fOut - 4.5;
      } else {
        // r2: gate towers clearly taller than the curtain they interrupt (l1 wall top 28, wall towers 37)
        towers.push({ x0: fIn - td, x1: fIn, halfW: tw / 2, top: Math.max(deck + 14, wIn + 11.5) });
        towers.push({ x0: fOut, x1: fOut + td, halfW: tw / 2, top: Math.max(deck + 14, wOut + 11.5) });
        x0 = fIn; x1 = fOut;
      }
      out.push({ id: `${rb.ring}-${b}`, ring: rb.ring, bearing: b, deck, rotY: Math.PI / 2 - (b * Math.PI) / 180, x0, x1, halfWidth: hw, towers, special,
        innerTop: innerTop(g), outerTop: outerTop(g), r0: g.r0, r1: g.r1, wallTopIn: wIn, wallTopOut: wOut });
    }
  }
  return out;
}
