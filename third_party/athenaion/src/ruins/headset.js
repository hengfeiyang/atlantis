// The fallen-head set (shot 8 / ref 8): rubble blocks around the head, a soil & rubble mound that
// carries them, the inscribed column "ΠΑΝΤΑ ΡΕΙ" and a ruined pier behind it, a low wall stub.
import * as THREE from 'three';
import { atPixel, camHeading, shotCam } from './camspace.js';
import { heightAt } from '../world/heightfield.js';

// pixel = where the stone's centre appears in ref 8, depth = camera-space depth (m)
// dims = full size (m), yaw = degrees relative to the camera heading, tilt = [about x, about z] deg
export const HEAD_STONES = [
  { id: 'h1', px: [712, 786], depth: 3.4, dims: [0.66, 0.38, 0.5], yaw: -28, tilt: [-8, 16], chips: 8 },
  { id: 'h2', px: [716, 892], depth: 2.75, dims: [0.7, 0.34, 0.52], yaw: 16, tilt: [7, -9], chips: 7, broken: -1 },
  { id: 'h3', px: [1112, 922], depth: 2.65, dims: [0.86, 0.42, 0.6], yaw: 12, tilt: [6, -6], chips: 12, broken: 1, erosion: 0.022, split: 0.6 },
  { id: 'h4', px: [1545, 712], depth: 4.3, dims: [0.98, 0.62, 0.72], yaw: -14, tilt: [7, 4], chips: 8, split: 1 },
  { id: 'h5', px: [1530, 895], depth: 2.45, dims: [0.74, 0.42, 0.56], yaw: 26, tilt: [-6, 9], chips: 12, erosion: 0.022, broken: -1 },
  { id: 'h6', px: [338, 892], depth: 3.9, dims: [0.92, 0.24, 0.52], yaw: 8, tilt: [2, -3], chips: 6, broken: 1 },
  { id: 'h7', px: [70, 668], depth: 13.0, dims: [2.6, 1.25, 0.85], yaw: 75, tilt: [0, 0], chips: 9, broken: -1, ground: true },
  { id: 'h8', px: [905, 930], depth: 2.0, dims: [0.4, 0.26, 0.34], yaw: -40, tilt: [10, 14], chips: 10, erosion: 0.016 },
  { id: 'h9', px: [430, 770], depth: 6.5, dims: [0.9, 0.45, 0.6], yaw: 50, tilt: [0, 6], chips: 6, ground: true },
  { id: 'h10', px: [1300, 935], depth: 2.2, dims: [0.5, 0.3, 0.42], yaw: -18, tilt: [8, -12], chips: 11, erosion: 0.018 },
  // rubble on the promontory top between the head and the rim (left half of the frame)
  { id: 'h11', px: [560, 862], depth: 4.3, dims: [0.56, 0.3, 0.44], yaw: 34, tilt: [6, 10], chips: 7, ground: true },
  { id: 'h12', px: [870, 800], depth: 5.0, dims: [0.5, 0.28, 0.4], yaw: -22, tilt: [-4, 8], chips: 6, ground: true },
  { id: 'h13', px: [190, 805], depth: 6.2, dims: [0.72, 0.36, 0.5], yaw: 12, tilt: [3, -5], chips: 7, ground: true, broken: 1 },
  { id: 'h14', px: [440, 930], depth: 2.9, dims: [0.42, 0.22, 0.34], yaw: 60, tilt: [12, -8], chips: 6, ground: true },
];

const deg = Math.PI / 180;

/** world transform for a set item placed from a shot pixel */
export function placeItem(shot, it) {
  const c = atPixel(shot, it.px[0], it.px[1], it.depth);
  if (it.ground) c.y = heightAt(c.x, c.z) + it.dims[1] * 0.5 - 0.22;
  const head = camHeading(shot);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((it.tilt?.[0] || 0) * deg, Math.PI - (head + (it.yaw || 0)) * deg, (it.tilt?.[1] || 0) * deg, 'YXZ'));
  const s = it.scale || 1;
  return new THREE.Matrix4().compose(c, q, new THREE.Vector3(s, s, s));
}

/**
 * Soil mound carrying the rubble. supports: [{x, z, top, r}] → heightfield bump above the terrain.
 * Returns { mesh, heightAt(x,z) } (terrain + mound).
 */
export function buildMound(supports, { center, size = 16, step = 0.18, material }) {
  const n = Math.round(size / step);
  const geo = new THREE.PlaneGeometry(size, size, n, n).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  // mound above the LOCAL terrain: top = lerp(terrain, support top, k) (using the terrain under the
  // support centre made mounds on sloping ground rise far above the intended top)
  const H = (x, z) => {
    let m = 0;
    const g = heightAt(x, z);
    for (const s of supports) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d >= s.r) continue;
      const k = 1 - smooth(s.r * 0.35, s.r, d);
      m = Math.max(m, (s.top - g) * k);
    }
    return m;
  };
  const noiseH = (x, z) => 0.05 * Math.sin(x * 3.1 + z * 1.3) * Math.sin(z * 2.7 - x * 0.7) + 0.03 * Math.sin(x * 9.3 - z * 7.1);
  const keep = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + center[0], z = pos.getZ(i) + center[1];
    const m = H(x, z);
    const g = heightAt(x, z);
    keep[i] = m > 0.02 ? 1 : 0;
    pos.setXYZ(i, x, g + (m > 0.02 ? m + noiseH(x, z) * Math.min(1, m * 3) : -0.15), z);
  }
  // drop triangles that are entirely below the terrain
  const idx = geo.index.array, out = [];
  for (let t = 0; t < idx.length; t += 3) if (keep[idx[t]] || keep[idx[t + 1]] || keep[idx[t + 2]]) out.push(idx[t], idx[t + 1], idx[t + 2]);
  geo.setIndex(out);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'ruinsMound';
  return { mesh, height: (x, z) => heightAt(x, z) + H(x, z) };
}
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/** where the ΠΑΝΤΑ ΡΕΙ column stands (ground point) and its facing toward camera 8 */
export function pantaColumnPlacement() {
  const p = atPixel(8, 1555, 140, 6.8);
  const g = heightAt(p.x, p.z);
  const cam = shotCam(8).pos;
  const front = new THREE.Vector3(cam.x - p.x, 0, cam.z - p.z).normalize();
  return { base: new THREE.Vector3(p.x, g, p.z), front };
}

// column drums of the ΠΑΝΤΑ ΡΕΙ column (plain shaft, r = 0.68) + blocks of the pier behind it
export const PANTA = { r: 0.68, drums: [2.3, 2.2, 2.6], inscriptionY: 3.64, letterH: 0.15 }; // line-1 baseline 3.39 m above the base (ref 8 y ≈ 105 px)
export const HEAD_PIECES = [
  { id: 'pa1', type: 'drum', spec: { r: 0.68, h: 2.3, taper: 0.01, flutes: 0, chips: 4, cracks: 1, seed: 'pa1', cell: 0.03 } },
  { id: 'pa2', type: 'drum', spec: { r: 0.675, h: 2.2, taper: 0.01, flutes: 0, chips: 5, cracks: 2, seed: 'pa2', cell: 0.028 } },
  { id: 'pa3', type: 'drum', spec: { r: 0.67, h: 2.6, taper: 0.01, flutes: 0, chips: 6, cracks: 1, breakTop: 0.22, seed: 'pa3', cell: 0.026 } },
];
// ruined pier behind-left of the column (ref 8 top right)
export const PIER8 = { px: [1335, 110], depth: 9.5, blocks: [[1.35, 1.05, 1.25], [1.3, 0.95, 1.2], [1.32, 1.0, 1.25], [1.28, 0.9, 1.2], [1.3, 1.0, 1.22], [1.26, 0.95, 1.2], [1.3, 1.02, 1.24], [1.25, 0.8, 1.18]] };
