// Shot 8 (ref 8) reef dressing: hand-placed coral / sponge / anemone / sea-grass slots read off the
// reference (pixel + species + size), dropped onto whatever surface the set has under that pixel (the
// head, the crown, the columns, the drifted sand). Pushed as engine.slots.coral entries with a `species`
// field (src/modules/marine.js places them as is, bypassing its keep-clear filter: tag 'dress8:*').
import * as THREE from 'three';

const lin = (r, g, b) => [r, g, b].map((v) => Math.pow(v / 255, 2.2));
const RED = lin(196, 52, 44), RED2 = lin(170, 40, 52), ORANGE = lin(214, 104, 44), RUST = lin(150, 70, 40), PURPLE = lin(122, 70, 150),
  LILAC = lin(160, 120, 190), CREAM = lin(220, 205, 170), BROWN = lin(120, 84, 52), OLIVE = lin(112, 112, 60), PINK = lin(200, 110, 130), GREY = lin(150, 140, 125);

// [px, py, species, scale, rgb, opts]  — ref-8 pixels (1672 × 941); opts.up: lean toward world-up (0..1), opts.lift: m
export const DRESS8 = [
  // left of the head: a big red gorgonian bush + fan (ref 8 px 50-240, 400-530)
  [150, 492, 'fan', 1.15, RED, { up: 0.9, yaw: 0.35 }],
  [95, 505, 'bush', 2.4, RED2, {}],
  [205, 505, 'softtree', 1.6, RED, {}],
  [250, 500, 'finger', 1.2, RUST, {}],
  // red coral crowning the head between the crown spikes (px 470-560, 100-180)
  [505, 165, 'bush', 2.0, RED, { up: 0.8 }],
  [560, 175, 'softtree', 1.2, RED2, { up: 0.8 }],
  // orange staghorn on the hair left of the crown (px 190-280, 230-300)
  [235, 290, 'staghorn', 1.4, ORANGE, { up: 0.7 }],
  [290, 330, 'finger', 0.9, ORANGE, {}],
  // anemone / pale sea star on the hair (px 320, 455)
  [320, 455, 'anemone', 2.6, CREAM, {}],
  // purple soft coral below the cheek (px 400-460, 490-540)
  [425, 535, 'softtree', 1.25, PURPLE, { up: 0.9 }],
  [470, 560, 'lump', 1.0, LILAC, {}],
  // front-left: purple fan and orange tube sponges (px 0-80, 590-680; 170-280, 630-700)
  [35, 640, 'fan', 0.55, PURPLE, { up: 0.95 }],
  [60, 690, 'bush', 1.0, LILAC, {}],
  [225, 690, 'tube', 1.35, ORANGE, {}],
  [265, 700, 'tube', 0.9, RUST, {}],
  [320, 700, 'lump', 1.3, GREY, {}],
  // in front of the beard / around the head base
  [600, 640, 'urchin', 2.2, PURPLE, {}],
  [680, 650, 'bush', 1.3, RED, {}],
  [760, 660, 'grass', 1.4, null, {}],
  [905, 640, 'anemone', 1.6, PINK, {}],
  // the trident's surroundings: small brown corals and urchins (px 1060-1600, 620-700)
  [1085, 662, 'finger', 0.8, BROWN, {}],
  [1150, 690, 'urchin', 1.6, PURPLE, {}],
  [1470, 700, 'bush', 1.0, BROWN, {}],
  [1520, 690, 'staghorn', 0.7, RUST, {}],
  [1600, 665, 'finger', 0.8, BROWN, {}],
  [1320, 640, 'anemone', 1.4, CREAM, {}],
  // the lying column on the right: coral on its top
  [1330, 470, 'bush', 1.2, RUST, {}],
  [1560, 560, 'finger', 0.9, ORANGE, {}],
  // bottom right: red coral + tall sea grass at the frame edge (px 1300-1672, 700-941)
  [1390, 905, 'bush', 1.15, RED, {}],
  [1440, 880, 'grass', 1.6, null, {}],
  [1585, 760, 'grass', 2.6, null, {}],
  [1625, 820, 'grass', 2.9, null, {}],
  [1650, 720, 'grass', 2.4, null, {}],
  [1540, 860, 'grass', 2.2, null, {}],
  // bottom left: encrusted rock (brain coral + lumps)
  [70, 880, 'brain', 0.75, GREY, {}],
  [180, 905, 'lump', 1.4, GREY, {}],
  [20, 800, 'lump', 1.6, PINK, {}],
  // sparse urchins / grass on the sand in the middle distance
  [870, 560, 'urchin', 1.8, PURPLE, {}],
  [1000, 600, 'grass', 1.2, null, {}],
  [1210, 600, 'lump', 1.0, PINK, {}],
  [800, 760, 'grass', 1.0, null, {}],
];

/** world points + normals (every k-th vertex) of every non-instanced mesh in the group */
function cloud(group, maxPts = 1.6e6) {
  group.updateMatrixWorld(true);
  const meshes = [];
  let total = 0;
  group.traverse((m) => { if (m.isMesh && !m.isInstancedMesh && m.geometry?.attributes?.position) { meshes.push(m); total += m.geometry.attributes.position.count; } });
  const k = Math.max(1, Math.ceil(total / maxPts));
  const P = [], N = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal;
    nm.getNormalMatrix(m.matrixWorld);
    let used = null;
    if (m.geometry.index) { used = new Uint8Array(pos.count); const I = m.geometry.index.array; for (let j = 0; j < I.length; j++) used[I[j]] = 1; }
    for (let i = 0; i < pos.count; i += k) {
      if (used && !used[i]) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      P.push(v.x, v.y, v.z);
      if (nor) { n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N.push(n.x, n.y, n.z); } else N.push(0, 1, 0);
    }
  }
  return { P: new Float32Array(P), N: new Float32Array(N) };
}

/** first surface point along the camera ray through ref pixel (px, py) */
function hitAt(F, C, px, py) {
  const o = F.pos, d = F.at(px, py, 10).sub(o).normalize();
  const P = C.P;
  let best = -1, bt = 1e9;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i] - o.x, y = P[i + 1] - o.y, z = P[i + 2] - o.z;
    const t = x * d.x + y * d.y + z * d.z;
    if (t < 0.5 || t > bt) continue;
    const tol = Math.max(0.05, t * 0.0045);
    const q = x * x + y * y + z * z - t * t;
    if (q < tol * tol) { bt = t; best = i; }
  }
  if (best < 0) return null;
  return { p: new THREE.Vector3(P[best], P[best + 1], P[best + 2]), n: new THREE.Vector3(C.N[best], C.N[best + 1], C.N[best + 2]), t: bt };
}

/**
 * @param {object} engine
 * @param {object} F frame8 (design camera)
 * @param {THREE.Group} group the built set (head, crown, columns, sand…)
 * @returns {number} slots pushed
 */
export function dressShot8(engine, F, group) {
  const C = cloud(group);
  let n = 0;
  for (const [px, py, species, scale, rgb, o] of DRESS8) {
    const h = hitAt(F, C, px, py);
    if (!h) continue;
    const nrm = h.n.clone();
    if (nrm.y < 0) nrm.y = Math.abs(nrm.y) * 0.3;
    nrm.normalize().lerp(new THREE.Vector3(0, 1, 0), o.up ?? (nrm.y < 0.5 ? 0.5 : 0.3)).normalize();
    const pos = h.p.clone().addScaledVector(nrm, o.lift ?? -0.02);
    engine.slots.coral.push({ pos: pos.toArray(), normal: nrm.toArray(), species, scale, rgb, yaw: o.yaw, size: scale, tag: 'dress8:' + species });
    n++;
  }
  return n;
}
