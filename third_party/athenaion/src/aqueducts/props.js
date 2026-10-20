// Small repeated props for the aqueducts & bridges (instanced): balusters and gilded finials.
import * as THREE from 'three';

function lathe(profile, segs) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
  const g = new THREE.LatheGeometry(pts, segs);
  g.computeVertexNormals();
  return g;
}

/** vase baluster, 0.74 m tall, origin at the base centre */
export function balusterGeometry(detail = 1) {
  const p = [
    [0.0, 0.0], [0.105, 0.0], [0.105, 0.06], [0.075, 0.09], [0.112, 0.2], [0.115, 0.29],
    [0.08, 0.41], [0.05, 0.53], [0.075, 0.61], [0.06, 0.66], [0.105, 0.685], [0.105, 0.74], [0.0, 0.74],
  ];
  return lathe(p, detail >= 0.75 ? 8 : 6);
}

/** gilded pine-cone finial on a small round base, 1 m tall, origin at the base */
export function finialGeometry(detail = 1) {
  const p = [
    [0.0, 0.0], [0.3, 0.0], [0.3, 0.07], [0.26, 0.1], [0.2, 0.13], [0.17, 0.18], [0.2, 0.22], [0.2, 0.25],
    [0.12, 0.29], [0.1, 0.34], [0.15, 0.38], [0.22, 0.45], [0.255, 0.53], [0.255, 0.6], [0.23, 0.68],
    [0.18, 0.77], [0.12, 0.85], [0.06, 0.92], [0.025, 0.97], [0.0, 1.0],
  ];
  const g = lathe(p, detail >= 0.75 ? 14 : 9);
  // pine-cone scales: bumpy displacement on the bulb
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y > 0.38 && y < 0.95) {
      const a = Math.atan2(z, x);
      const bump = 1 + 0.06 * Math.max(0, Math.sin(a * 7 + y * 40) * Math.sin(y * 38));
      pos.setX(i, x * bump); pos.setZ(i, z * bump);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** InstancedMesh from {pos:[x,y,z], scale, rot} items (positions in the parent's local frame) */
export function instanced(geo, mat, items, { yScale = 1 } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3(), Pv = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  items.forEach((it, i) => {
    Q.setFromAxisAngle(up, it.rot || 0);
    const s = it.scale ?? 1;
    Sv.set(s, s * yScale, s);
    Pv.set(it.pos[0], it.pos[1], it.pos[2]);
    M.compose(Pv, Q, Sv);
    m.setMatrixAt(i, M);
  });
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}
