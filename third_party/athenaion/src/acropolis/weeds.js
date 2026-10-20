// (r4) Small weed / grass / moss tufts growing in the joints and cracks of the grand stair treads (ref 6:
// green tufts in the corners where a tread meets the riser above, along cracks and broken nosings).
// One InstancedMesh of a crossed-blade tuft (≈ 14 blades), vertex-coloured dark olive → straw.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';

function tuftGeometry(rng) {
  const pos = [], col = [];
  const nB = 26;
  for (let i = 0; i < nB; i++) {
    const a = rng.range(0, Math.PI * 2), r0 = rng.range(0, 0.35);
    const lean = rng.range(0.5, 1.2), h = rng.range(0.22, 0.6), w = rng.range(0.06, 0.12);
    const bx = Math.cos(a) * r0, bz = Math.sin(a) * r0;
    const tx = bx + Math.cos(a) * lean * h, tz = bz + Math.sin(a) * lean * h;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const dry = rng.random() < 0.25;
    const cb = dry ? [0.16, 0.13, 0.06] : [0.08, 0.1, 0.03], ct = dry ? [0.42, 0.36, 0.17] : [0.3, 0.34, 0.1];
    // one blade = 2 triangles tapering to the tip (double sided material)
    const mid = [(bx + tx) / 2, h * 0.55, (bz + tz) / 2];
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, mid[0] + px * 0.6, mid[1], mid[2] + pz * 0.6);
    pos.push(bx - px, 0, bz - pz, mid[0] + px * 0.6, mid[1], mid[2] + pz * 0.6, mid[0] - px * 0.6, mid[1], mid[2] - pz * 0.6);
    pos.push(mid[0] - px * 0.6, mid[1], mid[2] - pz * 0.6, mid[0] + px * 0.6, mid[1], mid[2] + pz * 0.6, tx, h, tz);
    const cm = [(cb[0] + ct[0]) / 2, (cb[1] + ct[1]) / 2, (cb[2] + ct[2]) / 2];
    col.push(...cb, ...cb, ...cm, ...cb, ...cm, ...cm, ...cm, ...cm, ...ct);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // blades read best with up-facing normals (soft, grass-like shading)
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) { n.setXYZ(i, n.getX(i) * 0.35, 0.94, n.getZ(i) * 0.35); }
  return g;
}

/** spots: [[x, y, z, scale?], ...] → InstancedMesh (or null) */
export function weedTufts(spots, rng) {
  if (!spots || !spots.length) return null;
  const geo = tuftGeometry(rng);
  const mat = proceduralMaterial({
    name: 'acro-weeds',
    params: { color: 0xffffff, roughness: 0.85, metalness: 0, vertexColors: true, side: THREE.DoubleSide },
    color: `diffuseColor.rgb *= 0.8 + 0.4 * cgVnoise3(cgP * 3.0);`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  spots.forEach((s, i) => {
    const k = (s[3] ?? 1) * rng.range(0.1, 0.2);
    Q.setFromAxisAngle(Y, rng.range(0, Math.PI * 2));
    S.set(k * rng.range(0.8, 1.4), k * rng.range(0.7, 1.3), k * rng.range(0.8, 1.4));
    P.set(s[0], s[1] - 0.005, s[2]);
    M.compose(P, Q, S);
    mesh.setMatrixAt(i, M);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false; mesh.userData.castShadow = false;
  mesh.name = 'acro:weeds';
  return mesh;
}
