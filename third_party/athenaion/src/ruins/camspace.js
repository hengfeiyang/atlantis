// Camera-relative placement helpers. The ruins sets are composed for the cameras of shots 3, 8, 9
// (src/world/shots.js), so hero pieces are positioned by "pixel + distance" in a given shot. If the
// shot cameras move, the sets follow them.
import * as THREE from 'three';
import { SHOTS } from '../world/shots.js';

export const REF_W = 1672, REF_H = 941;

const cams = new Map();
export function shotCam(id) {
  if (cams.has(id)) return cams.get(id);
  const s = SHOTS.find((q) => q.id === id);
  const c = new THREE.PerspectiveCamera(s.fov, REF_W / REF_H, s.near ?? 0.5, 60000);
  c.position.set(...s.pos);
  c.up.set(0, 1, 0);
  c.lookAt(new THREE.Vector3(...s.target));
  if (s.roll) c.rotateZ((s.roll * Math.PI) / 180);
  c.updateMatrixWorld(true); c.updateProjectionMatrix();
  const right = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 1);
  const back = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 2);
  const info = { cam: c, pos: c.position.clone(), right, up, back, fwd: back.clone().negate(), shot: s };
  cams.set(id, info);
  return info;
}

/** unit ray direction through reference pixel (px, py) of shot id */
export function pixelRay(id, px, py) {
  const { cam } = shotCam(id);
  const v = new THREE.Vector3((px / REF_W) * 2 - 1, 1 - (py / REF_H) * 2, 0.5).unproject(cam);
  return v.sub(cam.position).normalize();
}
/** world point at (camera-space depth, i.e. along the view axis) `depth` through pixel (px, py) */
export function atPixel(id, px, py, depth) {
  const c = shotCam(id);
  const d = pixelRay(id, px, py);
  const t = depth / d.dot(c.fwd);
  return c.pos.clone().addScaledVector(d, t);
}
/** world point where the pixel ray hits the horizontal plane y */
export function atPixelPlane(id, px, py, y) {
  const c = shotCam(id);
  const d = pixelRay(id, px, py);
  const t = (y - c.pos.y) / d.y;
  return c.pos.clone().addScaledVector(d, t);
}
/** project a world point into reference pixels of shot id → [x, y, depth] */
export function toPixel(id, p) {
  const { cam } = shotCam(id);
  const v = new THREE.Vector3(...(p.isVector3 ? p.toArray() : p));
  const depth = -v.clone().applyMatrix4(cam.matrixWorldInverse).z;
  v.project(cam);
  return [(v.x * 0.5 + 0.5) * REF_W, (0.5 - v.y * 0.5) * REF_H, depth];
}
/** camera-space vector (x right, y up, z toward the camera) → world vector */
export function camVec(id, x, y, z) {
  const c = shotCam(id);
  return new THREE.Vector3().addScaledVector(c.right, x).addScaledVector(c.up, y).addScaledVector(c.back, z);
}
/** compass heading of the horizontal camera forward (deg, 0 = north/-Z, 90 = east/+X) */
export function camHeading(id) {
  const f = shotCam(id).fwd;
  return ((Math.atan2(f.x, -f.z) * 180) / Math.PI + 360) % 360;
}
