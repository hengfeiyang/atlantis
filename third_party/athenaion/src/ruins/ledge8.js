// Shot-8 foreground ledge (ref 8 bottom left): the promontory top continues left of the fallen head
// at about the head's level, so the frame's bottom-left shows a green ledge with rubble, shrubs, grass,
// lavender and yellow flowers in front of the distant city (not the city stairs straight below).
// Supports for the soil mound, a few extra rubble blocks (re-using the baked head-set stones) and an
// instanced plant dressing made with flora's ground-cover generators (src/flora/ground.js).
import * as THREE from 'three';
import { atPixelPlane, atPixel, pixelRay, shotCam, toPixel } from './camspace.js';
import { RNG } from '../core/rng.js';
import { grassTuft, lavender, yellowFlowers, shrub } from '../flora/ground.js';

const LEDGE_Y = -1.65; // ledge top relative to camera 8 height

// [pixel x, pixel y (just under the wanted silhouette), radius m]
const SUPPORTS = [[30, 800, 2.6], [190, 770, 2.4], [360, 820, 2.4], [560, 840, 2.4], [760, 850, 2.2], [120, 900, 2.0], [420, 920, 2.0]];

/** extra mound supports (world) for the ledge */
export function ledgeSupports() {
  const cam = shotCam(8).pos, y = cam.y + LEDGE_Y;
  return SUPPORTS.map(([px, py, r], i) => {
    const p = atPixelPlane(8, px, py, y);
    return { x: p.x, z: p.z, top: y - 0.05 * (i % 3), r };
  });
}

// rubble on the ledge: re-uses head-set stone geometry ids, placed by pixel + depth, sitting on the mound
export const LEDGE_STONES = [
  { geo: 'h9', px: [470, 860], depth: 6.2, yaw: 20, tilt: [2, -4], scale: 1.1 },
  { geo: 'h13', px: [40, 760], depth: 8.5, yaw: -30, tilt: [0, 3], scale: 1.2 },
  { geo: 'h11', px: [250, 905], depth: 4.6, yaw: 60, tilt: [4, 6], scale: 1.0 },
];

/** march the pixel ray of shot 8 onto a height function → world point or null */
export function hitGround(px, py, height, maxD = 30) {
  const cam = shotCam(8).pos, d = pixelRay(8, px, py);
  let t = 0.5, prev = null;
  for (let i = 0; i < 400 && t < maxD; i++) {
    const p = cam.clone().addScaledVector(d, t);
    const h = p.y - height(p.x, p.z);
    if (h < 0) {
      if (!prev) return p;
      // refine between prev and p
      let a = t - 0.06, b = t;
      for (let k = 0; k < 6; k++) { const m = (a + b) / 2, q = cam.clone().addScaledVector(d, m); if (q.y - height(q.x, q.z) < 0) b = m; else a = m; }
      return cam.clone().addScaledVector(d, b);
    }
    prev = p; t += 0.06;
  }
  return null;
}

/**
 * Plant dressing over the ledge, instanced per variant with flora's herb material.
 * @returns {THREE.InstancedMesh[]}
 */
export function dressLedge({ height, material, density = 1, detail = 1 }) {
  const R = (s) => new RNG('ledge8-' + s);
  const lib = {
    grass: [0, 1, 2, 3].map((i) => grassTuft(R('g' + i), { blades: 40 + i * 10, height: 0.22 + i * 0.07, radius: 0.05 + i * 0.015, dry: [0.15, 0.35, 0.55, 0.25][i], seedHeads: [0.2, 0.5, 0.6, 0.1][i], detail })),
    lavender: [0, 1].map((i) => lavender(R('l' + i), { stems: 18 + i * 10, height: 0.34 + i * 0.1, detail })),
    yellow: [0, 1].map((i) => yellowFlowers(R('y' + i), { stems: 10 + i * 6, height: 0.3 + i * 0.1, detail })),
    shrub: [[0.45, 0.55], [0.6, 0.75], [0.35, 0.42]].map(([r, h], i) => shrub(R('s' + i), { r, h, grey: 0.1 * i, leaves: Math.round((500 + 250 * i) * (0.6 + 0.4 * detail)), leafLen: 0.06 + 0.008 * i, detail: Math.min(detail, 0.7) })),
  };
  const items = new Map();
  const add = (kind, v, m) => { const k = kind + ':' + v; if (!items.has(k)) items.set(k, []); items.get(k).push(m); };
  const rng = new RNG('ledge8-place');
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const n = Math.round(420 * density);
  for (let i = 0; i < n; i++) {
    // denser toward the frame's left edge (ref 8: shrubs + lavender at x < 330, grass to x ≈ 650)
    const px = Math.pow(rng.random(), 1.35) * 760, py = 700 + rng.random() * 245;
    const p = hitGround(px, py, height, 22);
    if (!p) continue;
    const [, , dd] = toPixel(8, p);
    if (dd < 2.2) continue;
    const r = rng.random();
    let kind, v, s;
    if (px < 340 && r < 0.2) { kind = 'shrub'; v = rng.int(0, 2); s = rng.range(0.8, 1.3); }
    else if (px < 380 && r < 0.36) { kind = 'lavender'; v = rng.int(0, 1); s = rng.range(0.8, 1.25); }
    else if (r < 0.5) { kind = 'yellow'; v = rng.int(0, 1); s = rng.range(0.8, 1.2); }
    else { kind = 'grass'; v = rng.int(0, 3); s = rng.range(0.8, 1.5); }
    q.setFromAxisAngle(up, rng.random() * Math.PI * 2);
    m4.compose(p.clone().setY(p.y - 0.03), q, new THREE.Vector3(s, s, s));
    add(kind, v, m4.clone());
  }
  const out = [];
  for (const [key, list] of items) {
    const [kind, v] = key.split(':');
    const im = new THREE.InstancedMesh(lib[kind][+v], material, list.length);
    im.name = 'ledge8-' + kind;
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    im.castShadow = true; im.receiveShadow = true;
    out.push(im);
  }
  return out;
}

export { atPixel };
