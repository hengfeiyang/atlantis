// Sunken-era sand (pure, deterministic, no three.js). Shared API for every module:
//   import { sandAt, sunkenGround } from '../terrain/sand.js';
//   sandAt(x, z)       → height of the extra sand layer surface (m), or -Infinity where there is none
//                        (the water rings and the canal are partly filled; elsewhere the sand is a thin
//                        skin drawn by the terrain shader).
//   sunkenGround(x, z) → max(heightAt, sandAt): the actual ground surface of the sunken terrain mesh — use it
//                        to bury things (wrecks, fallen drums, rubble) or to stand them on the sand.
// The golden era has no sand layer (use heightAt).
import { Simplex, smoothstep } from '../core/noise.js';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';

const nA = new Simplex(5501), nB = new Simplex(5502), nC = new Simplex(5503);
const WATER_RINGS = L.RINGS.filter((g) => g.kind === 'water');
const K = L.SEA_CANAL;
/** sand level in the canal (lower than the rings: shot 7 stands on the canal floor, the wreck is half buried) */
export const CANAL_SAND = -8.4;

/** dunes: long, low swells (elongated along `ang`), m */
function dunes(x, z, ang, amp) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const u = x * ca + z * sa, v = -x * sa + z * ca;
  return amp * (0.65 * nA.noise2(u / 70, v / 22) + 0.35 * nB.noise2(u / 23, v / 9));
}

function ringFill(x, z, r) {
  let s = -Infinity;
  for (const g of WATER_RINGS) {
    if (r < g.r0 - 2 || r > g.r1 + 2) continue;
    if (g.id === 'w3' && L.inSeaSector(L.bearingOf(x, z))) continue;
    const dFace = Math.min(r - g.r0, g.r1 - r);
    const ang = Math.atan2(z, x) + Math.PI / 2;              // dunes run along the ring
    const drift = 3.0 * Math.exp(-Math.max(0, dFace) / 9) * (0.7 + 0.3 * nC.noise2(x / 18, z / 18));
    const lvl = L.SUNKEN.sandLevelRings + dunes(x, z, ang, 0.8) + drift - 0.6 * Math.sin(Math.PI * Math.min(1, Math.max(0, (r - g.r0) / (g.r1 - g.r0))));
    s = Math.max(s, lvl);
  }
  return s;
}

export function sandAt(x, z) {
  const r = Math.hypot(x, z);
  let s = ringFill(x, z, r);
  // the canal: tunnel through land ring 1 (z 300..440), open cut through land ring 2 and out between the moles
  const ax = Math.abs(x - K.x), hw = K.width / 2;
  if (z > K.z0 - 30 && z < K.z1 + 80 && ax < hw + 4) {
    const wall = Math.max(0, hw - ax);                      // distance to the canal side
    const drift = 2.4 * Math.exp(-wall / 6) * (0.75 + 0.25 * nC.noise2(x / 14, z / 14));
    const tunnel = smoothstep(K.z0 - 25, K.z0 + 10, z) * smoothstep(440 + 25, 440 - 10, z);
    const cut = smoothstep(540, 610, z);
    const lvl = (tunnel > 0 ? -6.5 : CANAL_SAND) + drift + dunes(x, z, Math.PI / 2, 0.45) + 0.6 * smoothstep(K.z1 - 150, K.z1 + 60, z);
    const w = Math.max(tunnel, cut) * smoothstep(hw + 4, hw - 2, ax);
    s = s === -Infinity ? (w > 0 ? lvl : s) : s + (lvl - s) * w;
  }
  return s;
}

/** ground surface of the sunken era: the golden terrain with the sand fill on top */
export function sunkenGround(x, z) {
  const h = heightAt(x, z), s = sandAt(x, z);
  return s > h ? s : h;
}
