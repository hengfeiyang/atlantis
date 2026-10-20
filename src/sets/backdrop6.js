// r6 (sunken): shot 6 (ref 6) far city — the reference's left half shows the city beyond the plateau in blue: banded towers
// crowned by gilded tholoi, a domed rotunda on a high podium and a two-tier arcade (aqueduct / bridge) at ≈ 150-230 m.
// Our plateau rim hides the citadel ledges from the stair-head eye, so these stand on the ledges and rise above the
// rim line. Laid out in REFERENCE PIXELS of the shot-6 camera (sets/frame.js frameFromShot): [px, top row, depth].
// Pieces whose footprint would sit on something built (citadel palaces, ramparts, towers, bridges) are pushed back
// (same screen column) until free. Silhouette detail only (the medium turns them into blue shapes); no shadows, no AO.
// Also reads from the shot-9 split-level camera as standing towers at the left (ref 9: towers at the left).
import * as THREE from 'three';
import { Building } from '../arch/build.js';
import { box, ellipsoid, cylinder } from '../arch/geom.js';
import { tholos } from '../arch/tholos.js';
import { RNG } from '../core/rng.js';
import { frameFromShot } from './frame.js';
import { towerInto } from './precinct.js';

const PI = Math.PI;
// r7: darker blue-grey marble — at 200-300 m the lit white marble matched the water's in-scatter and the city vanished;
//     ref 6 reads it as deeper-blue silhouettes against the bright water (the gilded crowns stay bright)
const FAR_TINT = 0x828c98;
const FAR_CLEAR = '0.35';

/**
 * @param {object} engine
 * @param {function} G sunken ground height (x, z)
 * @param {number} q detail
 * @returns {THREE.Group}
 */
export function buildBackdrop6(engine, G, q) {
  const group = new THREE.Group(); group.name = 'sets:backdrop6';
  const F = frameFromShot(6);
  const det = q >= 1 ? 0.5 : 0.35;
  const rng = new RNG('set6:farcity');
  const fp = engine.footprints;
  const busy = (x, z, r) => !!fp?.query && fp.query(x, z, r).length > 0;
  const yaw = Math.atan2(F.fwd.x, F.fwd.z) + PI; // local +Z faces the camera
  /** first free spot along the pixel ray at depth d0, d0 + 12, … */
  const spot = (px, d0, r) => {
    for (let k = 0; k < 6; k++) { const d = d0 + k * 12, p = F.at(px, 470, d); if (!busy(p.x, p.z, r)) return { p, d }; }
    return null;
  };
  const top = (px, row, d) => F.at(px, row, d).y;
  const meshes = [];
  // ---- banded towers with a gilded tholos crown: [px, top row, depth, width]
  const TW = [[70, 255, 175, 7], [215, 285, 205, 6], [395, 235, 190, 7.5], [560, 300, 215, 6]];
  let nT = 0;
  for (const [px, row, d0, w] of TW) {
    const s = spot(px, d0, w * 0.8);
    if (!s) continue;
    const gy = G(s.p.x, s.p.z), yT = top(px, row, s.d);
    const colH = w * 0.5, hT = yT - gy - colH - 3.5;     // shaft height so the dome top lands on the row
    if (hT < 10) continue;
    const B = new Building('set6-tower', { detail: det, seed: 61 + nT, variant: 'ruined', weather: 0.8, tint: FAR_TINT });
    towerInto(B, { w, h: hT, broken: false });
    meshes.push(B.finalize({ position: [s.p.x, gy, s.p.z], rotY: yaw + rng.range(-0.3, 0.3), ao: false }));
    const T = tholos({ radius: w * 0.42, columns: 8, colH, order: 'corinthian', gild: 1, detail: det, seed: 61 + nT, name: 'set6-towerTholos', steps: 2, stepH: 0.28, tread: 0.3, foundation: 1.0 });
    meshes.push(T.finalize({ position: [s.p.x, gy + hT + 0.7 + 2 * 0.28, s.p.z], rotY: yaw, ao: false }));
    fp?.addCircle?.(s.p.x, s.p.z, w * 0.75, 'sets:farcity6');
    nT++;
  }
  // ---- domed rotunda on a high podium (ref 6 px ≈ 240-320, row ≈ 340-380)
  {
    const px = 300, s = spot(px, 165, 12);
    if (s) {
      const gy = G(s.p.x, s.p.z), yT = top(px, 330, s.d), R = 8;
      const B = new Building('set6-rotunda', { detail: det, seed: 69, variant: 'ruined', weather: 0.8, tint: FAR_TINT });
      const mw = B.marble, mi = B.mb.interior, mg = B.gold, mr = B.get('red');
      const aux = [0.1, 0.3, 0.6, 3.05];
      const yD = yT - gy - R * 0.85 - 7;                   // podium top (local)
      if (yD > 4) {
        box(mw, [-R - 2, -1.5, -R - 2], [R + 2, yD, R + 2], 0.05, aux);
        for (let y = 3; y < yD - 1; y += 4.2) box(mr, [-R - 2.06, y, -R - 2.06], [R + 2.06, y + 0.6, R + 2.06], 0, [0.1, 0.4, 0.4, 0]);
        for (const x of [-R * 0.55, 0, R * 0.55]) box(mi, [x - 0.8, yD - 6, R + 2], [x + 0.8, yD - 2.5, R + 2.05], 0, [0.9, 0, 0, 0]);
        mw.push(); mw.translate(0, yD, 0); cylinder(mw, R, R, 0, 7, 28, { capTop: true }); mw.pop();
        for (let k = 0; k < 16; k++) { const a = (k / 16) * PI * 2; box(mi, [Math.cos(a) * R - 0.45, yD + 1.2, Math.sin(a) * R - 0.45], [Math.cos(a) * R + 0.45, yD + 5.6, Math.sin(a) * R + 0.45], 0, [0.9, 0, 0, 0]); }
        mw.push(); mw.translate(0, yD + 7, 0); cylinder(mw, R + 0.5, R + 0.5, 0, 0.8, 28, { capTop: true }); mw.pop();
        mg.push(); mg.translate(0, yD + 7.8, 0); ellipsoid(mg, R * 0.95, R * 0.85, R * 0.95, 24, 12); mg.pop();
        mg.push(); mg.translate(0, yD + 7.8 + R * 0.8, 0); cylinder(mg, 0.25, 0.1, 0, 3, 6, { capTop: true }); mg.pop();
        meshes.push(B.finalize({ position: [s.p.x, gy, s.p.z], rotY: yaw, ao: false }));
        fp?.addCircle?.(s.p.x, s.p.z, R + 3, 'sets:farcity6');
      }
    }
  }
  // ---- two-tier arcade (aqueduct) across the left (ref 6 px ≈ 0-560, top row ≈ 360), partly ruined
  {
    const d = 230, pa = F.at(-40, 470, d), pb = F.at(560, 470, d);
    const B = new Building('set6-aqueduct', { detail: det, seed: 68, variant: 'ruined', weather: 0.9, tint: FAR_TINT });
    const mw = B.marble, mr = B.get('red');
    const aux = [0.1, 0.3, 0.6, 3.05];
    const n = 11;
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = pa.clone().lerp(pb, t);
      if (busy(p.x, p.z, 2.5)) continue;
      const gy = G(p.x, p.z), yT = top(-40 + t * 600, 360 + rng.range(-6, 6), d), h = yT - gy;
      if (h < 8) continue;
      const gone = rng.random() < 0.18, hh = gone ? h * rng.range(0.35, 0.7) : h;
      const loc = (y) => [p.x, gy + y, p.z];
      // pier (local frame per pier: built in world coords through push/translate)
      mw.push(); mw.translate(...loc(0)); mw.rotateY(yaw);
      box(mw, [-1.3, -1.5, -1.3], [1.3, hh, 1.3], 0.04, aux);
      if (!gone) {
        for (const yy of [h * 0.5, h - 2.4]) box(mr, [-1.36, yy, -1.36], [1.36, yy + 0.55, 1.36], 0, [0.1, 0.4, 0.4, 0]);
        // lintels toward the next pier (the arches read as openings at this range)
        if (i < n) {
          const q = pa.clone().lerp(pb, (i + 1) / n), len = Math.hypot(q.x - p.x, q.z - p.z);
          for (const [y0, y1] of [[h * 0.5 - 1.2, h * 0.5 + 0.6], [h - 2.6, h]]) box(mw, [1.3, y0, -1.2], [len - 1.3, y1, 1.2], 0.04, aux);
        }
      }
      mw.pop();
    }
    const g = B.finalize({ position: [0, 0, 0], rotY: 0, ao: false });
    meshes.push(g);
  }
  for (const m of meshes) {
    group.add(m);
    // r7: far term of the water medium × CG_UW_CLEAR on these materials only (core/underwater.js uwTau): at 230-300 m the
    //     city dissolved into the in-scatter; ref 6 reads it as deeper-blue silhouettes (own materials, not shared)
    m.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.material.defines = { ...(o.material.defines || {}), CG_UW_CLEAR: FAR_CLEAR }; } });
  }
  return { group, towers: nT };
}
