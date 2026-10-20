// Ring-edge rock faces (where the land rings meet the water rings) — the description the rings module
// builds its quay walls / wall cladding / ship-sheds on. Pure (no three.js).
//
// Every face is a near-vertical band of the analytic heightAt() (EDGE = 3.5 m wide) that the terrain
// mesher turns into jointed limestone: karst columns, strata beds, ledges, small overhangs. The rock
// deviates from the analytic face by about ±(rockOut × amp) m horizontally (amp: field.js faceAmp — 1 on
// the open ring faces, 0.6 in the ship-shed sectors, 0 on the built quay walls: citadel shore, canal sides).
// The rim (land-ring top) is exact: flat ground starts at rRim.
//
//   { id: 'l1:inner', ring: 'l1', side: 'inner'|'outer', top, bottom, rWater, rRim, rFoot, rockOut, kind }
//     top    : land-ring top height (m)            bottom : water-ring bed (golden) below the face
//     rRim   : radius where the flat top begins     rFoot  : radius of the face foot on the bed
//     rWater : radius of the face at golden sea level (y = 0)
//     kind   : 'rock' (open rock face) | 'quay' (the rings module builds a wall; no rock relief)
//   faceRadius(face, y) → radius of the analytic face at height y
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';

const EDGE = 3.5;
const sst = (t) => t * t * (3 - 2 * t);
function inv(y, y0, y1) { // inverse of y0 + (y1-y0)·smoothstep(t) → t
  const v = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (sst(m) < v) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

function build() {
  const out = [];
  const R = L.RINGS;
  for (let i = 0; i < R.length; i++) {
    const g = R[i];
    if (g.kind !== 'land') continue;
    const prev = R[i - 1], next = R[i + 1];
    // inner face: from the previous water ring's bed up to the top, over r0 .. r0 + EDGE
    out.push({
      id: `${g.id}:inner`, ring: g.id, side: 'inner', top: g.top, bottom: prev.floor, kind: 'rock', rockOut: 3,
      rFoot: g.r0, rRim: g.r0 + EDGE, rWater: g.r0 + EDGE * inv(0, prev.floor, g.top),
    });
    const fl = next ? next.floor : -12;
    out.push({
      id: `${g.id}:outer`, ring: g.id, side: 'outer', top: g.top, bottom: fl, kind: 'rock', rockOut: 3,
      rFoot: g.r1, rRim: g.r1 - EDGE, rWater: g.r1 - EDGE * inv(0, fl, g.top),
      note: g.id === 'l2' ? 'in the open-sea sector the face drops to the sea bed' : undefined,
    });
  }
  // citadel shore: a sheer step at r = CITADEL.radius from the quay band (quayY) to the w1 bed — a quay wall
  const C = L.CITADEL, w1 = R[0];
  out.push({ id: 'citadel:shore', ring: 'citadel', side: 'outer', top: C.quayY, bottom: w1.floor, kind: 'quay', rockOut: 0, rFoot: C.radius, rRim: C.radius, rWater: C.radius });
  // outer city shore (w3 → plain), north half
  const O = L.OUTER_CITY, w3 = R.find((r) => r.id === 'w3');
  out.push({ id: 'outer:inner', ring: 'outer', side: 'inner', top: O.y, bottom: w3.floor, kind: 'quay', rockOut: 0.6, rFoot: O.r0 - 4, rRim: O.r0 + EDGE, rWater: O.r0 + EDGE * (inv(0, w3.floor, O.y) - 0.5) });
  return out;
}
export const RING_FACES = build();

/** radius of the analytic face at height y (between bottom and top) */
export function faceRadius(face, y) {
  if (face.kind === 'quay' && face.rFoot === face.rRim) return face.rRim;
  const t = inv(y, face.bottom, face.top);
  return face.side === 'inner' ? face.rFoot + (face.rRim - face.rFoot) * t : face.rFoot - (face.rFoot - face.rRim) * t;
}

/** the canal cut sides (|x| = width/2 .. +3.5): built quays (rings module), no rock relief */
export const CANAL_FACES = { x: L.SEA_CANAL.x, halfWidth: L.SEA_CANAL.width / 2, edge: EDGE, z0: L.SEA_CANAL.z0, bottom: L.SEA_CANAL.floor, kind: 'quay' };

/** quick self-check helper: analytic height on a face at bearing b */
export function faceProbe(face, b, y) {
  const r = faceRadius(face, y), a = (b * Math.PI) / 180;
  return heightAt(Math.sin(a) * r, -Math.cos(a) * r);
}
