// Camera-local frames for the shot-specific foreground sets. A set is authored in "camera ground"
// coordinates: u = metres to the right of the camera (horizontal), v = metres forward (horizontal),
// y = absolute world height. The sets read SHOTS at build time, so they follow camera tweaks.
//
//   const F = shotFrame(2);
//   F.toWorld(u, y, v) → [x, y, z];   F.toLocal([x,y,z]) → [u, y, v]
//   F.atPixel(px, py, depth) → THREE.Vector3 (reference pixel 1672x941, camera-space depth)
//   F.local(px, py, depth) → [u, y, v]
//   F.group() → THREE.Group placed so that its local (x = u, y, z = -v) maps to the world
//   F.facing(degLeft) → compass heading (deg) facing back toward the camera, turned `degLeft` to image-left
import * as THREE from 'three';
import { SHOTS } from '../world/shots.js';

export const REF_W = 1672, REF_H = 941;

export function shotFrame(idOrShot) {
  const s = typeof idOrShot === 'object' ? idOrShot : SHOTS.find((q) => q.id === idOrShot);
  if (!s) return null;
  const cam = new THREE.PerspectiveCamera(s.fov, REF_W / REF_H, s.near ?? 0.3, 1e5);
  cam.position.set(...s.pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(new THREE.Vector3(...s.target));
  if (s.roll) cam.rotateZ((s.roll * Math.PI) / 180);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const camFwd = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).negate();
  const fwd = new THREE.Vector3(camFwd.x, 0, camFwd.z).normalize();
  const heading = Math.atan2(fwd.x, -fwd.z); // rad, 0 = north (-Z), +pi/2 = east (+X)
  const right = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
  const C = cam.position.clone();
  const toWorld = (u, y, v) => [C.x + right.x * u + fwd.x * v, y, C.z + right.z * u + fwd.z * v];
  const toLocal = (p) => {
    const x = p.isVector3 ? p.x : p[0], y = p.isVector3 ? p.y : p[1], z = p.isVector3 ? p.z : p[2];
    const dx = x - C.x, dz = z - C.z;
    return [dx * right.x + dz * right.z, y, dx * fwd.x + dz * fwd.z];
  };
  const atPixel = (px, py, depth) => {
    const d = new THREE.Vector3((px / REF_W) * 2 - 1, 1 - (py / REF_H) * 2, 0.5).unproject(cam).sub(C).normalize();
    return C.clone().addScaledVector(d, depth / d.dot(camFwd));
  };
  const atPixelPlane = (px, py, y) => {
    const d = new THREE.Vector3((px / REF_W) * 2 - 1, 1 - (py / REF_H) * 2, 0.5).unproject(cam).sub(C).normalize();
    return C.clone().addScaledVector(d, (y - C.y) / d.y);
  };
  const toPixel = (p) => {
    const v = new THREE.Vector3(...(p.isVector3 ? p.toArray() : p));
    const depth = -v.clone().applyMatrix4(cam.matrixWorldInverse).z;
    v.project(cam);
    return [(v.x * 0.5 + 0.5) * REF_W, (0.5 - v.y * 0.5) * REF_H, depth];
  };
  const headingDeg = (heading * 180) / Math.PI;
  return {
    shot: s, cam, C, heading, headingDeg, fwd, right, toWorld, toLocal, atPixel, toPixel,
    local: (px, py, depth) => toLocal(atPixel(px, py, depth)),
    /** [u, y, v] where the pixel ray meets the horizontal plane y */
    localOnPlane: (px, py, y) => toLocal(atPixelPlane(px, py, y)),
    atPixelPlane,
    /** group whose local frame is (x = u, y = world y, z = -v) */
    group(name) {
      const g = new THREE.Group();
      g.name = name || `set-shot${s.id}`;
      g.position.set(C.x, 0, C.z);
      g.rotation.y = -heading;
      g.updateMatrixWorld(true);
      return g;
    },
    /** compass heading (deg) that faces the camera, plus `left` degrees toward image-left */
    facing(left = 0) { return (((headingDeg + 180 + left) % 360) + 360) % 360; },
    /** compass heading of local +Z (toward the camera) */
    get backDeg() { return (((headingDeg + 180) % 360) + 360) % 360; },
  };
}
