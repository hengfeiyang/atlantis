// Hero foreground dressing that frames the reference shots: olive branches entering from the frame
// corners, foreground rocks with lichen + grass, ivy sprays. Every placement is expressed in the
// SHOT CAMERA's screen space (NDC x/y + view depth) and converted to world space at build time,
// so it follows later camera tweaks in src/world/shots.js.
import * as THREE from 'three';
import { SHOTS } from '../world/shots.js';
import { shotFrame } from './util.js';

const V = THREE.Vector3;

// NDC: x -1 (left) .. 1 (right), y -1 (bottom) .. 1 (top); d = metres along the view axis.
// olive: limb from `from` (usually just off-frame) toward `to`; spray density / leaf scale per spec.
export const HERO_SPECS = [
  // region = [x0, y0, x1, y1] NDC box the foliage must stay in (leaves outside it by > ~0.06 are culled);
  // top = rock-top screen height vs NDC x. Regions measured on the references (frame fractions in comments).
  // ---- ref 1: olive foliage top-right corner (fx 0.88-1, fy 0-0.3); boulders bottom-right; small bush bottom-right corner
  // (final cut) the three shot-1 olive branches (h1a, h1c, h1b) were removed at the user's request
  { shot: 1, kind: 'rocks', at: [0.72, -0.45], d: 12, spread: [7, 2, 5], count: 8, size: [2.0, 4.0], seed: 'r1', top: [[0.38, -0.75], [1.0, 0.02]] },
  // ---- ref 2: sunlit spray in the top-left corner (fx 0-0.14, fy 0-0.3); foliage along the top-right (fx 0.74-1, fy 0-0.22)
  { shot: 2, kind: 'olive', from: [-1.3, 1.15, 5.0], to: [-0.82, 0.72, 4.8], radius: 0.06, seed: 'h2b', density: 1.3, droop: 1.5, region: [-1.05, 0.38, -0.7, 1.05] },
  { shot: 2, kind: 'olive', from: [-1.25, 0.8, 5.2], to: [-0.9, 0.42, 5.0], radius: 0.035, droop: 1.5, seed: 'h2c', density: 1.0, level: 1, region: [-1.05, 0.38, -0.72, 1.05] },
  { shot: 2, kind: 'olive', from: [1.3, 1.15, 4.6], to: [0.42, 0.98, 4.2], radius: 0.06, seed: 'h2d', density: 1.5, droop: 1.6, region: [0.48, 0.55, 1.05, 1.05] },
  // ---- ref 3: branch in the top-left corner only (fx 0.10-0.38, fy 0-0.28), sun through the leaves; rock ledge at the bottom
  { shot: 3, kind: 'olive', from: [-1.05, 1.18, 3.4], to: [-0.3, 0.97, 3.5], radius: 0.06, seed: 'h3a', density: 1.3, droop: 1.6, region: [-0.82, 0.44, -0.24, 1.05] },
  { shot: 3, kind: 'olive', from: [-0.62, 1.2, 3.0], to: [-0.5, 0.85, 3.1], radius: 0.035, seed: 'h3b', density: 1.15, level: 1, droop: 1.6, region: [-0.78, 0.46, -0.26, 1.05] },
  { shot: 3, kind: 'olive', from: [-1.15, 0.5, 3.4], to: [-0.85, 0.25, 3.3], radius: 0.025, seed: 'h3c', density: 0.9, level: 2, region: [-0.82, 0.0, -0.6, 0.4] },
  // (r5) ref 3's foreground is ruin blocks: cut limestone, crisp chipped edges (not wavy natural rock)
  { shot: 3, kind: 'rocks', at: [-0.62, -0.85], d: 6.0, spread: [7, 1.2, 4], count: 11, size: [0.8, 1.9], seed: 'r3', shape: 'block', dressed: true, rough: 1.3, cracks: 1.3, top: [[-1.0, -0.5], [-0.15, -0.8]] },
  // ---- ref 6: sprays hanging into the top-left (fx 0-0.25, fy 0-0.2) and the top-right corner (fx 0.92-1, fy 0-0.3)
  { shot: 6, kind: 'olive', from: [-1.25, 1.2, 2.4], to: [-0.6, 1.06, 2.3], radius: 0.045, seed: 'h6a', density: 1.7, level: 1, droop: 1.4, region: [-1.05, 0.6, -0.5, 1.05] },
  { shot: 6, kind: 'olive', from: [1.25, 1.2, 2.4], to: [0.95, 0.8, 2.3], radius: 0.04, seed: 'h6b', density: 1.5, level: 1, droop: 1.3, region: [0.84, 0.4, 1.05, 1.05] },
  // ---- ref 7: olive canopy in the top-left corner (fx 0-0.22, fy 0-0.15), mossy wet rocks bottom-left
  { shot: 7, kind: 'olive', from: [-1.25, 1.2, 8.0], to: [-0.55, 1.02, 7.5], radius: 0.1, seed: 'h7a', density: 1.6, leafScale: 1.5, droop: 1.0, region: [-1.05, 0.62, -0.52, 1.05] },
  { shot: 7, kind: 'olive', from: [-1.15, 0.2, 6.8], to: [-0.98, 1.25, 6.6], radius: 0.17, seed: 'h7c', density: 1.3, leafScale: 1.5, droop: 1.0, region: [-1.05, 0.3, -0.78, 1.05] },
  { shot: 7, kind: 'olive', from: [-1.2, 0.85, 7.0], to: [-0.95, 0.75, 6.8], radius: 0.05, seed: 'h7b', density: 0.9, level: 1, region: [-1.05, 0.4, -0.84, 1.05] },
  { shot: 7, kind: 'rocks', at: [-0.55, -0.75], d: 7, spread: [10, 1.5, 6], count: 16, size: [0.9, 2.4], seed: 'r7', wet: true, top: [[-1.0, -0.42], [-0.05, -0.75]] },
  // ---- ref 8: out-of-focus olive twig at the top (fx 0.68-0.85, fy 0-0.12)
  { shot: 8, kind: 'olive', from: [0.75, 1.25, 3.0], to: [0.55, 0.9, 2.8], radius: 0.02, leafScale: 1.0, seed: 'h8a', density: 1.0, level: 2, region: [0.36, 0.74, 0.72, 1.05] },
  // ---- ref 9: sprays dangling at the left edge (fx 0-0.12, fy 0-0.35)
  { shot: 9, kind: 'olive', from: [-1.15, 1.2, 2.6], to: [-0.86, 0.8, 2.5], radius: 0.03, seed: 'h9a', density: 1.0, level: 2, region: [-1.05, 0.3, -0.76, 1.05] },
];

export function shotById(id) { return SHOTS.find((s) => String(s.id) === String(id)); }

/** keep-probability for foliage at world point p (soft NDC region) and a hard off-frame cull */
export function regionFns(spec, F) {
  const r = spec.region || [-1.05, -1.05, 1.05, 1.05];
  const near = (shotById(spec.shot).near ?? 0.5) + 0.08;
  const keep = (p) => {
    const q = F.project(p);
    if (q.d < near) return 0;
    const dx = Math.max(r[0] - q.x, 0, q.x - r[2]), dy = Math.max(r[1] - q.y, 0, q.y - r[3]);
    const dd = Math.hypot(dx, dy);
    return Math.exp(-(dd * dd) / (0.1 * 0.1));
  };
  const M = spec.margin ?? 0.06;
  const cull = (p) => {
    const q = F.project(p);
    if (q.d < near || Math.abs(q.x) > 1.12 || Math.abs(q.y) > 1.15) return true;
    // hard framing: no leaves outside the reference region (+ a small soft margin)
    return q.x < r[0] - M || q.x > r[2] + M || q.y < r[1] - M || q.y > r[3] + M;
  };
  // branch truncation: only the region borders that lie INSIDE the frame count (off-frame excursions are invisible)
  const trunc = (p) => {
    const q = F.project(p);
    if (q.d < near) return true;
    return (r[0] > -1 && q.x < r[0] - M) || (r[2] < 1 && q.x > r[2] + M) || (r[1] > -1 && q.y < r[1] - M) || (r[3] < 1 && q.y > r[3] + M);
  };
  return { keep, cull, trunc };
}

/** frame-driven rock top height (world y) for a rock at world position pos */
export function rockTopFn(spec, F) {
  if (!spec.top) return null;
  const T = spec.top;
  return (pos, rng) => {
    const q = F.project(pos);
    const k = Math.min(1, Math.max(0, (q.x - T[0][0]) / (T[1][0] - T[0][0])));
    const y = T[0][1] + (T[1][1] - T[0][1]) * k + rng.range(-0.08, 0.06);
    return F.at(q.x, y, q.d).y;
  };
}

/** world-space start/direction/length for an olive spec */
export function oliveFromSpec(spec) {
  const shot = shotById(spec.shot);
  if (!shot) return null;
  const F = shotFrame(shot);
  const a = F.at(spec.from[0], spec.from[1], spec.from[2]);
  const b = F.at(spec.to[0], spec.to[1], spec.to[2]);
  const len = a.distanceTo(b) * (spec.lenK ?? 1.15);
  return { F, start: a, dir: new V().subVectors(b, a).normalize(), length: len };
}

/**
 * Visibility manager: hero dressing belongs to one shot; in OTHER stills it is hidden only when it
 * would sit right in front of that camera (close + inside the frustum). Video cameras keep everything.
 */
export function installHeroVisibility(engine, groups) {
  const frustum = new THREE.Frustum(), m = new THREE.Matrix4(), sphere = new THREE.Sphere();
  engine.onShot((shot) => {
    const cam = engine.camera;
    cam.updateMatrixWorld(true);
    m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m);
    for (const g of groups) {
      if (String(g.userData.heroShot) === String(shot.id)) { g.visible = true; continue; }
      if (g.userData.strict) { g.visible = false; continue; }
      if (!g.userData.sphere) {
        const box = new THREE.Box3().setFromObject(g);
        g.userData.sphere = box.getBoundingSphere(new THREE.Sphere());
      }
      sphere.copy(g.userData.sphere);
      const dist = sphere.center.distanceTo(cam.position) - sphere.radius;
      g.visible = !(dist < (g.userData.hideWithin ?? 35) && frustum.intersectsSphere(sphere));
    }
  });
}
