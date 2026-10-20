// Shed mole (r3, ref 4 / shot 4): a rock-cut harbour mole in water ring 1 running north from land ring 1 along the
// right of the shot-4 frame. West face: ship-sheds (rock-cut arcades, triremes) under a tin curtain with pylons;
// its head carries the water tunnel + the arched bridge to the citadel quay (built by the bridges module,
// src/bridges/mole.js). Pure plan (no three.js) so the bridges / ships modules can import it.
//
// Straight faces reuse the ring builders (sheds.js / wall.js / towers.js) through "line edges": an edge whose
// circle is huge (R = 6000 m) with its centre far on the land side, so arcs are straight to < 0.3 m; such an edge
// carries `polar(r, b)` (virtual centre) and `su(x, z)` (metres along the face, for the crag noise).
// OWNER: rings / bridges agent (arch-a).
import * as L from '../world/layout.js';

const D2R = Math.PI / 180;
const RV = 6000;
const wrap = (b) => ((b % 360) + 360) % 360;

/** mole frame: s = metres along the heading (north +), lat = metres east of the shed-front line; origin = M.head */
export function moleFrame(M = L.SHED_MOLE) {
  const h = M.heading * D2R;
  const d = [Math.sin(h), -Math.cos(h)], n = [Math.cos(h), Math.sin(h)];
  const P = (s, lat) => [M.head[0] + d[0] * s + n[0] * lat, M.head[1] + d[1] * s + n[1] * lat];
  return { d, n, P };
}

/**
 * straight edge A → B (world xz) with the water on the side of unit normal w. Returns a rings edge (side +1).
 * o: { id, landY, wallH, cladding, curtain, floor }
 */
export function lineEdge(A, B, w, o) {
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
  const off = Math.sqrt(RV * RV - (len / 2) ** 2);
  const C = [mx - w[0] * off, mz - w[1] * off];
  const brg = (p) => wrap(Math.atan2(p[0] - C[0], -(p[1] - C[1])) / D2R);
  let b0 = brg(A), b1 = brg(B);
  let flip = false;
  if (wrap(b1 - b0) > 180) { [b0, b1] = [b1, b0]; flip = true; }
  b1 = b0 + wrap(b1 - b0);
  const polar = (r, b) => { const a = b * D2R; return [C[0] + Math.sin(a) * r, C[1] - Math.cos(a) * r]; };
  const su = (x, z) => Math.atan2(x - C[0], -(z - C[1])) * RV;
  const faceR = RV, wallR = RV - 0.85, T = 3.2;
  const e = {
    id: o.id, ring: 'mole', r: RV, side: 1, faceR, wallR, rimR: wallR - T, landY: o.landY, wallH: o.wallH || 0,
    wallTop: o.landY + (o.wallH || 0), cladding: o.cladding || null, floor: o.floor, water: 'w1', curtain: !!o.curtain,
    polar, su, center: C, b0, b1, flip, len, blocks: [], bastions: [], shedCover: [], shedRanges: [], line: { A, B, w },
  };
  e.stretches = [{ b0, b1, flankA: false, flankB: false }];
  /** virtual bearing of the point at distance t (m) from A along A → B */
  e.bAt = (t) => (flip ? b1 - (t / RV) / D2R : b0 + (t / RV) / D2R);
  e.facingAt = () => wrap(Math.atan2(w[0], -w[1]) / D2R);
  return e;
}

let PLAN = null;
/** the mole plan (memoised): { spec, frame, edges, sheds, towers, poly, l1Cut(b), gate, bridge, tunnel, top } */
export function molePlan() {
  if (PLAN !== null) return PLAN;
  const M = L.SHED_MOLE;
  if (!M) { PLAN = undefined; return PLAN; }
  const F = moleFrame(M);
  const { d, n, P } = F;
  const w1 = L.ringById('w1');
  const sBack = -M.back, sEnd = M.front, latF = M.depth, latE = M.depth + M.width;
  const common = { landY: M.landY, floor: w1.floor };
  const west = lineEdge(P(sBack, latF), P(sEnd, latF), [-n[0], -n[1]], { ...common, id: 'mole-w', wallH: M.wallH, cladding: 'tin', curtain: true });
  west.shedDepth = M.depth; west.rockAmp = 0.55;
  west.shedLamps = [M.depth - 2.5, M.depth - 9, M.depth - 16, M.depth - 24]; west.lampGain = 1.5;   // r3: golden vault glow (ref 4) west.shedBack = M.shedBack || 32;
  const north = lineEdge(P(sEnd, latF), P(sEnd, latE), d, { ...common, id: 'mole-n', curtain: false });
  const east = lineEdge(P(sEnd, latE), P(sBack, latE), n, { ...common, id: 'mole-e', curtain: false });
  // the west face is only dressed where no shed block / tunnel block stands in front of it
  const tAlongW = (s) => s - sBack;   // A of the west edge is at sBack
  // ---- ship-sheds along the west face
  const [s0, s1] = M.sheds;
  const nSh = Math.max(1, Math.round((s1 - s0) / (M.pitch || 13.8)));
  const pitch = (s1 - s0) / nSh, halfDeg = (pitch / 2 / RV) / D2R;
  const sheds = [];
  const cam4 = (L.SHED_MOLE.shipClear && L.SHED_MOLE.shipClear.from) || null;
  for (let k = 0; k < nSh; k++) {
    const sc = s0 + pitch * (k + 0.5);
    const b = west.bAt(tAlongW(sc));
    const [fx, fz] = P(sc, 0), [bx, bz] = P(sc, latF);
    const sh = { edge: 'mole-w', ring: 'mole', index: k, group: 0, bearing: b, faceR: west.faceR, frontR: west.faceR + M.depth, halfDeg,
      pos: [fx, 0, fz], back: [bx, 0, bz], facing: west.facingAt(), width: 10.5, crown: 9.6, depth: M.depth, length: M.depth + (M.shedBack || 32), slot: 'trireme', landY: M.landY, mole: true };
    sh.ship = !cam4 || Math.hypot(fx - cam4[0], fz - cam4[1]) > (L.SHED_MOLE.shipClear.r || 28);
    sheds.push(sh);
  }
  const bS0 = west.bAt(tAlongW(s0)), bS1 = west.bAt(tAlongW(s1));
  west.shedCover = [[Math.min(bS0, bS1), Math.max(bS0, bS1)]];
  west.shedRanges = [{ b0: west.shedCover[0][0], b1: west.shedCover[0][1] }];
  // tunnel block in front of the head (bridges module): the west face behind it needs no revetment
  const Tn = M.tunnel;
  const bT0 = west.bAt(tAlongW(Tn.s[0] - 2)), bT1 = west.bAt(tAlongW(sEnd));
  west.hidden = [[Math.min(bT0, bT1), Math.max(bT0, bT1)]];
  // ---- curtain pylons: every second shed pier + one over the tunnel head
  const towers = [];
  const towerS = [];
  for (let k = 2; k <= nSh; k += 2) towerS.push(s0 + pitch * k);
  if (towerS[towerS.length - 1] < s1 - 1) towerS.push(s1);
  towerS.unshift(sBack + 7);   // at the land-ring junction (shot 1 / ring continuity)
  for (const s of towerS) {
    const b = west.bAt(tAlongW(s));
    const [x, z] = west.polar(west.wallR, b);
    towers.push({ edge: 'mole-w', ring: 'mole', bearing: b, pos: [x, M.landY, z], base: M.landY, top: west.wallTop + 9, facing: west.facingAt(), end: false, cladding: 'tin', designWant: 'pylon', s });
  }
  // ---- outline (world xz, CCW not guaranteed) incl. the shed blocks + tunnel block, for footprints / ships
  const poly = [P(sBack, 0), P(sEnd, 0), P(sEnd, latE), P(sBack, latE)].map(([x, z]) => [x, z]);
  const tunnelPoly = [P(Tn.s[0], -Tn.width), P(Tn.s[1], -Tn.width), P(Tn.s[1], 0), P(Tn.s[0], 0)];
  const inside = (x, z, m = 0) => {
    const dx = x - M.head[0], dz = z - M.head[1];
    const s = dx * d[0] + dz * d[1], lat = dx * n[0] + dz * n[1];
    if (s > sBack - m && s < sEnd + m && lat > -m && lat < latE + m) return true;
    return s > Tn.s[0] - m && s < Tn.s[1] + m && lat > -Tn.width - m && lat < 0;
  };
  // ---- bridge from the tunnel block's west face to the citadel quay (bridges module)
  const B = M.bridge;
  const hb = B.heading * D2R, bd = [Math.sin(hb), -Math.cos(hb)];
  const [ox, oz] = P(B.s || 0, -Tn.width);
  // end tower centre where the bridge axis crosses r = citadel shore - 1.5 (straddling the citadel curtain)
  let tEnd = 0;
  for (let t = 0; t < 120; t += 0.25) { if (Math.hypot(ox + bd[0] * t, oz + bd[1] * t) < L.CITADEL.radius - 1.5) { tEnd = t; break; } }
  const land = [ox + bd[0] * tEnd, oz + bd[1] * tEnd];
  const gate = { bearing: L.bearingOf(land[0], land[1]), half: B.gateHalf || 9, pos: land };
  const bridge = { origin: [ox, oz], heading: B.heading, rotY: Math.PI / 2 - hb, deck: B.deck, halfWidth: B.halfWidth || 5.2, tEnd, land };
  const tunnel = { s: Tn.s, width: Tn.width, clear: Tn.clear, origin: M.head, rotY: Math.PI / 2 - (M.heading + 90) * D2R };
  PLAN = { spec: M, frame: F, edges: [west, north, east], west, north, east, sheds, towers, poly, tunnelPoly, inside, gate, bridge, tunnel, latE, sBack, sEnd };
  return PLAN;
}
