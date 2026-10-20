// Placement filter for the reef: keeps the hero reads of the sunken shots clear and scales growth down near
// the lenses (the city is scaled up for camera reading, but a 2 m coral 3 m from the lens reads as a toy).
//  * world keep-clear circles (registry.sets.keepClear8: the fallen head's face, the mosaic, the trident head;
//    registry.marine.keepClear: [{x, z, r, y0?, y1?}] from anyone)
//  * screen-space keep-out rectangles per sunken shot (reference pixels, 1672 × 941): tall growth (kelp, algae
//    columns) and big corals are not allowed to cover the hero subject in front of it (depth < maxDepth)
//  * near-lens scale: instances within ≈ 14 m of a sunken camera shrink toward real reef sizes
import * as THREE from 'three';
import { SHOTS } from '../world/shots.js';

const V = THREE.Vector3;
const W = 1672, H = 941;

// rough height (m, at instance scale 1) of each species' geometry
const HEIGHT = { brain: 0.4, table: 0.45, whorl: 0.45, finger: 0.4, staghorn: 0.55, bush: 0.35, softtree: 0.6, whip: 0.85, tube: 0.5, barrel: 0.9, lump: 0.15, anemone: 0.22, urchin: 0.25, fan: 1.0, grass: 0.4, column: 7 };
const KELP_H = [62, 52, 44, 36, 28, 20];
const SMALL = new Set(['urchin', 'anemone', 'lump', 'grass', 'tube', 'finger']);

/**
 * keep-out rectangles per shot: rect [x0,y0,x1,y1] in reference pixels, maxDepth (m, camera depth), mode:
 *   'tall'  → reject kelp / algae columns whose projected stalk crosses the rect
 *   'big'   → reject everything except small species (urchins, anemones, lumps, grass…) with a small
 *             projected size; tall growth rejected too
 *   'all'   → reject everything but grass
 */
export const SCREEN_KEEP = {
  6: [
    { rect: [260, 0, 1420, 941], maxDepth: 110, mode: 'tall' },     // temple + chariot group framed by open water
    { rect: [520, 560, 1180, 941], maxDepth: 30, mode: 'big' },     // the compass-rose plaza in the lower centre
  ],
  7: [
    { rect: [380, 0, 1300, 941], maxDepth: 90, mode: 'tall' },      // kelp frames the arch at the sides (ref 7)
    { rect: [620, 330, 1080, 860], maxDepth: 60, mode: 'big' },     // the view through the arch
  ],
  8: [
    { rect: [360, 170, 980, 640], maxDepth: 24, mode: 'big' },      // the face of Poseidon
    { rect: [960, 520, 1640, 820], maxDepth: 17, mode: 'big' },     // the gold trident
    { rect: [120, 690, 1300, 941], maxDepth: 11, mode: 'big' },     // the mosaic medallion + slabs
    { rect: [700, 120, 1400, 560], maxDepth: 80, mode: 'tall' },    // the background arcade / towers / manta
  ],
  9: [
    { rect: [380, 330, 1300, 941], maxDepth: 140, mode: 'tall' },   // the temple under the split line
  ],
};

function camOf(s) {
  const c = new THREE.PerspectiveCamera(s.fov ?? 45, W / H, 0.05, 5000);
  c.position.set(...s.pos); c.up.set(0, 1, 0); c.lookAt(new V(...s.target));
  c.updateMatrixWorld(true); c.updateProjectionMatrix();
  return c;
}

/**
 * @param {object} engine
 * @returns {function(species, pos:V, axis:V, scale:number, variant:number, tag?:string): number} scale factor (0 = reject)
 */
export function makeKeepFilter(engine) {
  const shots = SHOTS.filter((s) => s.era === 'sunken').map((s) => ({ id: s.id, cam: camOf(s), pos: new V(...s.pos), rules: SCREEN_KEEP[s.id] || [] }));
  const circles = [];
  const add = (list) => { for (const c of list || []) if (c && Number.isFinite(c.x) && Number.isFinite(c.z) && c.r > 0) circles.push(c); };
  const sets = engine.registry?.sets || {};
  add(sets.keepClear8);
  add(engine.registry?.marine?.keepClear);
  // the whole trident (shaft + prongs), not only its head
  if (sets.tridentHead && sets.tridentAxis) {
    const h = sets.tridentHead, a = sets.tridentAxis;
    for (let t = -7; t <= 3; t += 1.25) circles.push({ x: h[0] + a[0] * t, z: h[2] + a[2] * t, r: 1.3 });
  }
  const tmp = new V(), cs = new V();
  const proj = (p, cam) => {
    tmp.copy(p).applyMatrix4(cam.matrixWorldInverse);
    const depth = -tmp.z;
    tmp.copy(p).project(cam);
    return [(tmp.x * 0.5 + 0.5) * W, (0.5 - tmp.y * 0.5) * H, depth];
  };
  const stats = { rejected: 0, shrunk: 0, circles: 0 };
  const f = (species, pos, axis, scale, variant, tag = '') => {
    if (tag.startsWith('dress')) return 1;   // curated set dressing (src/sets/*): placed by hand
    const s = typeof scale === 'number' ? scale : Math.max(scale.x ?? 1, scale.y ?? 1);
    const tall = species === 'kelp' || species === 'column';
    const h = species === 'kelp' ? KELP_H[variant ?? 0] * s : (HEIGHT[species] ?? 0.5) * s;
    // world circles
    if (species !== 'grass' || s > 1.6) {
      for (const c of circles) {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const rr = c.r + Math.min(1.2, h * 0.35);
        if (dx * dx + dz * dz < rr * rr && (c.y0 === undefined || pos.y > c.y0) && (c.y1 === undefined || pos.y < c.y1)) { stats.circles++; return 0; }
      }
    }
    let k = 1;
    for (const S of shots) {
      const d = S.pos.distanceTo(pos);
      // near-lens: shrink toward real reef sizes (≈ 0.45 at the lens, 1 beyond 14 m)
      if (!tall && d < 14) k = Math.min(k, 0.42 + 0.58 * THREE.MathUtils.smoothstep(d, 2, 14));
      if (!S.rules.length || d > 160) continue;
      const [x0, y0, z0] = proj(pos, S.cam);
      if (z0 < 0.3) continue;
      // top of the instance (along its axis)
      cs.copy(axis || new V(0, 1, 0)).multiplyScalar(h).add(pos);
      const [x1, y1, z1] = proj(cs, S.cam);
      const halfW = (h * 0.45) / Math.max(0.3, z0) * (H / 2) / Math.tan(((S.cam.fov * Math.PI) / 180) / 2);
      const bx0 = Math.min(x0, x1) - halfW, bx1 = Math.max(x0, x1) + halfW, by0 = Math.min(y0, y1), by1 = Math.max(y0, y1);
      const sizePx = Math.max(by1 - by0, bx1 - bx0);
      for (const R of S.rules) {
        if (Math.min(z0, z1 > 0 ? z1 : z0) > R.maxDepth) continue;
        const [rx0, ry0, rx1, ry1] = R.rect;
        if (bx1 < rx0 || bx0 > rx1 || by1 < ry0 || by0 > ry1) continue;
        if (R.mode === 'tall') { if (tall) { stats.rejected++; return 0; } continue; }
        if (R.mode === 'all' && species !== 'grass') { stats.rejected++; return 0; }
        if (tall) { stats.rejected++; return 0; }
        if (!SMALL.has(species) || sizePx > 70) {
          // shrink small enough to read as texture, else reject
          if (SMALL.has(species) && sizePx < 160) { k = Math.min(k, 70 / sizePx); continue; }
          stats.rejected++; return 0;
        }
      }
    }
    if (k < 1) stats.shrunk++;
    return k;
  };
  f.stats = stats;
  return f;
}
