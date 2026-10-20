// Set frames: the hero foregrounds are composed in a local frame anchored to a layout constant (the
// fallen head, the garden terrace, the stair top) and oriented by the shot camera's horizontal
// direction. A "design camera" in that frame reproduces the reference framing; pieces are placed by
// reference pixel + depth (adapted from athenaion/src/ruins/camspace.js). The design camera is also
// what we recommend for the shot (see SUGGESTED in fallenhead.js) — if the director moves the shot
// camera, the set keeps its anchor and orientation.
import * as THREE from 'three';
import { SHOTS } from '../world/shots.js';

export const REF_W = 1672, REF_H = 941;

/** horizontal unit forward of a shot camera */
export function shotForward(id) {
  const s = SHOTS.find((q) => q.id === id);
  const f = new THREE.Vector3(s.target[0] - s.pos[0], 0, s.target[2] - s.pos[2]).normalize();
  return f;
}

/**
 * @param {object} o
 * @param {number[]} o.anchor  world point [x,y,z] that appears at pixel o.px at camera depth o.depth
 * @param {number[]} o.px      reference pixel of the anchor
 * @param {number} o.depth     camera-space depth of the anchor (m)
 * @param {THREE.Vector3} o.fwd horizontal forward
 * @param {number} o.eye       camera height above o.groundY
 * @param {number} o.groundY
 * @param {number} [o.pitch]   degrees (+ up)
 * @param {number} [o.fov]     vertical fov (deg)
 */
export function makeFrame(o) {
  if (o.camGround) { // camera stands at this ground point: anchor = a point straight ahead on the view axis
    const f = o.fwd.clone().setY(0).normalize();
    const g = new THREE.Vector3(...o.camGround);
    const pitch = ((o.pitch ?? 0) * Math.PI) / 180;
    const a = g.clone().addScaledVector(f, 10); a.y = g.y + o.eye + 10 * Math.tan(pitch);
    return makeFrame({ ...o, camGround: null, anchor: a.toArray(), px: [REF_W / 2, REF_H / 2], depth: 10, groundY: g.y });
  }
  const fwd = o.fwd.clone().setY(0).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const fov = o.fov ?? 44, pitch = ((o.pitch ?? 0) * Math.PI) / 180;
  const cam = new THREE.PerspectiveCamera(fov, REF_W / REF_H, 0.05, 20000);
  // solve the camera position: start at the anchor's horizontal position, then back off
  const look = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
  const place = (pos) => { cam.position.copy(pos); cam.up.set(0, 1, 0); cam.lookAt(pos.clone().add(look)); cam.updateMatrixWorld(true); cam.updateProjectionMatrix(); };
  const A = new THREE.Vector3(...o.anchor);
  let pos = new THREE.Vector3(A.x, o.groundY + o.eye, A.z).addScaledVector(fwd, -o.depth);
  for (let it = 0; it < 6; it++) {
    place(pos);
    const target = rayAt(cam, o.px[0], o.px[1], o.depth);
    const err = A.clone().sub(target); err.y = 0; // keep the eye height
    pos.add(err);
  }
  place(pos);
  const F = {
    cam, fwd, right, up, pos: cam.position.clone(),
    /** world point at camera depth `depth` through reference pixel (px, py) */
    at: (px, py, depth) => rayAt(cam, px, py, depth),
    /** world point where the pixel ray meets the horizontal plane y */
    atPlane: (px, py, y) => { const d = pixelDir(cam, px, py); const t = (y - cam.position.y) / d.y; return cam.position.clone().addScaledVector(d, t); },
    /** project world point → [px, py, depth] */
    toPixel: (p) => { const v = p.clone(); const depth = -v.clone().applyMatrix4(cam.matrixWorldInverse).z; v.project(cam); return [(v.x * 0.5 + 0.5) * REF_W, (0.5 - v.y * 0.5) * REF_H, depth]; },
    /** camera-space vector (x right, y up, z toward the camera) → world */
    camVec: (x, y, z) => {
      const r = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), u = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1), b = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2);
      return new THREE.Vector3().addScaledVector(r, x).addScaledVector(u, y).addScaledVector(b, z);
    },
    /** frame-local (x right, y up, z = forward distance) → world, relative to the camera ground point */
    local: (x, y, z) => new THREE.Vector3(cam.position.x, o.groundY, cam.position.z).addScaledVector(right, x).addScaledVector(fwd, z).add(new THREE.Vector3(0, y, 0)),
    /** a shot-like camera object for engine.applyShot / tests */
    shot: (extra = {}) => ({ pos: cam.position.toArray(), target: cam.position.clone().addScaledVector(look, 20).toArray(), fov, ...extra }),
  };
  return F;
}

/**
 * r3: a frame built from the shot camera itself (exact pos / target / fov), so set pieces can be placed by
 * reference pixel against the camera the director actually renders. local(x, y, z): x right, z forward
 * (horizontal), y absolute world height. hit(px, py, surfaceY(x, z)) marches the pixel ray to a height surface.
 */
export function frameFromShot(id) {
  const s = SHOTS.find((q) => q.id === id);
  const cam = new THREE.PerspectiveCamera(s.fov, REF_W / REF_H, 0.05, 20000);
  cam.position.set(...s.pos); cam.up.set(0, 1, 0); cam.lookAt(new THREE.Vector3(...s.target));
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const fwd = shotForward(id), up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const P = cam.position.clone();
  const F = {
    cam, fwd, right, up, pos: P.clone(), shotDef: s,
    at: (px, py, depth) => rayAt(cam, px, py, depth),
    dir: (px, py) => pixelDir(cam, px, py),
    atPlane: (px, py, y) => { const d = pixelDir(cam, px, py); const t = (y - P.y) / d.y; return P.clone().addScaledVector(d, t); },
    hit: (px, py, surf, maxT = 400) => {
      const d = pixelDir(cam, px, py);
      let tPrev = 0, prev = P.y - surf(P.x, P.z);
      for (let t = 0.05; t < maxT; t += 0.05) {
        const q = P.clone().addScaledVector(d, t), g = q.y - surf(q.x, q.z);
        if (g <= 0) { const u = prev / (prev - g); return P.clone().addScaledVector(d, tPrev + (t - tPrev) * u); }
        tPrev = t; prev = g;
      }
      return null;
    },
    toPixel: (p) => { const v = p.clone(); const depth = -v.clone().applyMatrix4(cam.matrixWorldInverse).z; v.project(cam); return [(v.x * 0.5 + 0.5) * REF_W, (0.5 - v.y * 0.5) * REF_H, depth]; },
    local: (x, y, z) => new THREE.Vector3(P.x, y, P.z).addScaledVector(right, x).addScaledVector(fwd, z),
    /** world → frame-local [right, forward] */
    toLocal: (p) => { const dx = p.x - P.x, dz = p.z - P.z; return [dx * right.x + dz * right.z, dx * fwd.x + dz * fwd.z]; },
    shot: (extra = {}) => ({ pos: s.pos.slice(), target: s.target.slice(), fov: s.fov, ...extra }),
  };
  return F;
}

function pixelDir(cam, px, py) {
  const v = new THREE.Vector3((px / REF_W) * 2 - 1, 1 - (py / REF_H) * 2, 0.5).unproject(cam);
  return v.sub(cam.position).normalize();
}
function rayAt(cam, px, py, depth) {
  const d = pixelDir(cam, px, py);
  const f = new THREE.Vector3(); cam.getWorldDirection(f);
  return cam.position.clone().addScaledVector(d, depth / d.dot(f));
}

/** yaw (rad) for an object whose local +Z should point along world direction v (horizontal) */
export function yawOf(v) { return Math.atan2(v.x, v.z); }
