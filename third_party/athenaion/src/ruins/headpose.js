// Pose of the giant fallen head in shot 8 (node-safe: used by the ruins module and by the CPU sculpt
// preview src/ruins/headpreview.mjs).
// orientation given in shot-8 camera space: face direction and crown direction
// least-squares fit to 8 ref-8 landmarks (eye, brow, nose tip, ala, mouth corner, chin, menton, ear):
// rms 12.5 px with a broadened, shallower head (aniso x 1.15, z 0.85 — the reference's colossal head is
// very wide from the nose to the ear); an isotropic fit leaves 18.5 px, the round-2 pose 34 px
import * as THREE from 'three';
import { camVec, atPixel } from './camspace.js';
import { HEAD_SCALE } from '../sculpt/head.js';

export const HEAD_POSE = {
  face: [-0.8182, 0.4619, 0.3423],   // camera space: x right, y up, z toward the camera
  crown: [0.2813, 0.8409, -0.4623],
  anchorLocal: [0.132, 0, 0.4], // the visible (left) eye, head units
  anchorPixel: [1181.6, 404.4], anchorDepth: 4.42,
  chinLocal: [0.0, -0.5, 0.38],
  k: 0.977, aniso: [1.15, 1, 0.85],
};

export function headMatrix(pose = HEAD_POSE) {
  const F = camVec(8, ...pose.face).normalize();
  const U = camVec(8, ...pose.crown);
  U.addScaledVector(F, -U.dot(F)).normalize();
  const X = new THREE.Vector3().crossVectors(U, F).normalize();
  return new THREE.Matrix4().makeBasis(X, U, F);
}

/** full placement matrix: bake metres (HEAD_SCALE) → world */
export function headWorldMatrix(pose = HEAD_POSE) {
  const S0 = HEAD_SCALE, K = pose.k || 1, AN = pose.aniso || [1, 1, 1];
  const rot = headMatrix(pose);
  const aL = new THREE.Vector3(...pose.anchorLocal).multiplyScalar(S0 * K).multiply(new THREE.Vector3(...AN)).applyMatrix4(rot);
  const pos = atPixel(8, ...pose.anchorPixel, pose.anchorDepth).sub(aL);
  return { matrix: rot.clone().scale(new THREE.Vector3(K * AN[0], K * AN[1], K * AN[2])).setPosition(pos), pos };
}
