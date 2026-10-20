// Terrain height function h(x, z) composed from the master plan (layout.js).
// Pure + deterministic: placement code everywhere calls heightAt() to sit things on the ground.
// OWNER: director (near field: citadel hill, rings, canal, coast). The far field (plain, foothills,
// mountains, islands, sea bed) belongs to the terrain agent, who may replace mountainsAnalytic() /
// farHeight() and register an eroded bake with setFarGrid() — the near field must stay exact.
//
// Anchors other modules rely on: plateau y = CITADEL.summit inside r < CITADEL.plateau, citadel ledges
// (CITADEL.terraces), quay band y = CITADEL.quayY at r 214..230, land ring tops (RINGS[].top), water ring
// beds (RINGS[].floor), the sea canal bed along x = 0. Ring edges are near-vertical (quay walls and rock
// faces are added by the rings / terrain modules ON these edges).
// The heights are the same in both eras (the sunken era adds sand on top in the terrain module).
import { noiseA, noiseB, noiseC, smoothstep, clamp, lerp } from '../core/noise.js';
import * as L from './layout.js';
// far-field shapes + citadel hillside detail: terrain agent (src/terrain/shape.js)
import { citadelSlopeDetail, seaBedShape, islandShape, mountainsAnalyticShape, farLandShape } from '../terrain/shape.js';

const EDGE = 3.5; // m: width of the steep drop at ring edges

// ------------------------------------------------------------ citadel hill profile (radial)
function citadelProfile(r) {
  const C = L.CITADEL, [t1, t2] = C.terraces;
  if (r < C.plateau) return C.summit;
  if (r < t1.r0) return lerp(C.summit, t1.y, smoothstep(C.plateau, t1.r0, r));
  if (r < t1.r1) return t1.y;
  if (r < t2.r0) return lerp(t1.y, t2.y, smoothstep(t1.r1, t2.r0, r));
  if (r < t2.r1) return t2.y;
  if (r < 214) return lerp(t2.y, C.quayY, smoothstep(t2.r1, 214, r));
  return C.quayY;
}

// rock / hillside roughness on the slopes only (flat ledges stay exact): stepped rock risers + soil
// benches (terrain agent, src/terrain/shape.js)
function citadelDetail(x, z, r) {
  return citadelSlopeDetail(x, z, r, citadelProfile(r));
}

// ------------------------------------------------------------ sea / far field (terrain agent)
function seaMask(b) {
  const [a0, a1] = L.SEA_SECTOR, w = 14;
  return smoothstep(a0 - w, a0 + w, b) * (1 - smoothstep(a1 - w, a1 + w, b));
}
function seaBed(x, z, r) { return seaBedShape(x, z, r); }
function islandAt(x, z) { return islandShape(x, z); }
let FAR = null; // optional eroded far grid {sample(x,z) → height|null}
export function setFarGrid(g) { FAR = g; }
export function getFarGrid() { return FAR; }

/** mountain wall to the north: analytic relief (the terrain module registers the eroded bake via setFarGrid) */
export function mountainsAnalytic(x, z) { return mountainsAnalyticShape(x, z); }
/** plain + foothills + mountains beyond the outer city (land part) */
export function farLand(x, z, r) { return farLandShape(x, z, r); }

// ------------------------------------------------------------ near field (rings)
function ringsHeight(x, z, r, b) {
  const C = L.CITADEL;
  if (r < C.radius) return citadelProfile(r) + citadelDetail(x, z, r);
  const sea = seaMask(b);
  // walk outward through the ring list
  let prevTop = C.quayY;
  for (let i = 0; i < L.RINGS.length; i++) {
    const g = L.RINGS[i];
    if (r >= g.r1) { prevTop = g.kind === 'land' ? g.top : prevTop; continue; }
    if (g.kind === 'water') {
      const next = L.RINGS[i + 1];
      const nextTop = next ? next.top : (g.id === 'w3' ? L.OUTER_CITY.y : 0);
      const inner = lerp(prevTop, g.floor, smoothstep(g.r0, g.r0 + EDGE, r));
      const outer = lerp(g.floor, nextTop, smoothstep(g.r1 - EDGE, g.r1, r));
      const bowl = g.floor - 2.0 * Math.sin(Math.PI * clamp((r - g.r0) / (g.r1 - g.r0), 0, 1));
      let h = Math.min(inner, outer, Math.max(bowl, g.floor - 2));
      if (g.id === 'w3') h = lerp(h, seaBed(x, z, r), sea);
      return h;
    }
    // land ring: flat top, steep faces at both edges
    const prevFloor = L.RINGS[i - 1].floor, next = L.RINGS[i + 1];
    const t = g.top + noiseA.noise2(x * 0.05, z * 0.05) * 0.08;
    const inner = lerp(prevFloor, t, smoothstep(g.r0, g.r0 + EDGE, r));
    const outerFloor = next ? next.floor : -12;
    let outer = lerp(t, outerFloor, smoothstep(g.r1 - EDGE, g.r1, r));
    if (g.id === 'l2') outer = lerp(outer, Math.min(outer, lerp(t, seaBed(x, z, r), smoothstep(g.r1 - EDGE, g.r1, r))), sea);
    return Math.min(inner, outer);
  }
  // beyond the last ring: outer city / plain (north) or sea (south)
  const land = farLand(x, z, r);
  const shore = lerp(-10, land, smoothstep(L.OUTER_CITY.r0 - 4, L.OUTER_CITY.r0 + EDGE, r));
  return lerp(shore, Math.max(seaBed(x, z, r), islandAt(x, z)), sea);
}

// the sea canal along x = 0 (open cut through land ring 2, tunnel cut through land ring 1, moles)
function canalCut(x, z, h) {
  const K = L.SEA_CANAL, hw = K.width / 2;
  if (z < K.z0 - 10 || z > K.z1 + 400) return h;
  const ax = Math.abs(x - K.x);
  if (ax > hw + EDGE) return h;
  const across = smoothstep(hw + EDGE, hw, ax);
  const along = smoothstep(K.z0 - 2, K.z0 + 2, z);
  return Math.min(h, lerp(h, K.floor, across * along));
}

// the citadel stair corridor: ground kept just below the stair line so the hillside never pokes through the steps
function stairCut(x, z, h) {
  const S = L.CITADEL_STAIR, hw = S.width / 2 + 3;
  const z0 = S.from[2], z1 = S.to[2];
  if (z < z0 - 4 || z > z1 + 2) return h;
  const ax = Math.abs(x - S.x);
  if (ax > hw + 6) return h;
  // r2: the stair's top tread is the raised landing (STAIR_HEAD.landing): the line stays at from.y over it
  const zl = L.STAIR_HEAD ? Math.max(z0, L.STAIR_HEAD.landing[1]) : z0;
  const t = clamp((z - zl) / (z1 - zl), 0, 1);
  const line = lerp(S.from[1], S.to[1], t) - 0.4;
  const w = smoothstep(hw + 6, hw, ax) * smoothstep(z0 - 4, z0 + 2, z);
  return Math.min(h, lerp(h, line, w));
}

// r2 (director): raised stair head — ground under the landing (y 50, 5 m above the forecourt) and under the broad
// north flight that descends from it into the court (refs 3 / 6: camera on the landing looking down the steps).
// The ground sits 0.1 m under the tread line so the temple's stair builder keeps the landing tread flat.
function stairHead(x, z, h) {
  const S = L.STAIR_HEAD; if (!S) return h;
  const hw = S.width / 2 + 2.0;
  const zf = S.flight.to[2], zl0 = S.landing[0], zl1 = S.landing[1];
  if (z < zf - 1 || z > zl1 + 1 || Math.abs(x - S.x) > hw + 2) return h;
  const yl = S.y - 0.1;
  const y = z >= zl0 ? yl : lerp(S.flight.to[1], yl, clamp((z - zf) / (zl0 - zf), 0, 1));
  const w = smoothstep(hw + 2, hw, Math.abs(x - S.x)) * smoothstep(zf - 1, zf, z) * (1 - smoothstep(zl1, zl1 + 1, z));
  return Math.max(h, lerp(h, y, w));
}

export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  if (FAR && r > 2200) { const v = FAR.sample(x, z); if (v !== null) return v; }
  const b = L.bearingOf(x, z);
  return canalCut(x, z, stairHead(x, z, stairCut(x, z, ringsHeight(x, z, r, b))));
}
export function normalAt(x, z, e = 1) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz, l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}
export function slopeAt(x, z, e = 1) { return 1 - normalAt(x, z, e)[1]; }
/** golden-era open water (rings, canal, sea) */
export function isWater(x, z) { return heightAt(x, z) < L.SEA_LEVEL - 0.2; }
/** water depth below the golden sea level (0 on land) */
export function waterDepth(x, z) { return Math.max(0, L.SEA_LEVEL - heightAt(x, z)); }
