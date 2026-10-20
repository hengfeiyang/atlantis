// SDF → triangle mesh (naive surface nets) with block-sparse narrow-band sampling, so detailed
// sculptures (statues, the giant head, rocks) can be modelled as signed distance functions.
//
//   import { meshSDF } from '../sculpt/mesher.js';
//   const geo = meshSDF((x, y, z) => Math.hypot(x, y, z) - 1, {
//     min: [-1.2, -1.2, -1.2], max: [1.2, 1.2, 1.2], cell: 0.02,   // cell = voxel size in SDF units
//     smooth: 1,                                                 // laplacian smoothing passes (0-3)
//   });
//
// The SDF must be (approximately) a true distance (Lipschitz ≤ ~1.5) for the narrow band to work;
// use bandScale > 1 if your field is "stretched" (e.g. after heavy displacement).
// Returns an indexed THREE.BufferGeometry with position + normal (normals from the SDF gradient).
import * as THREE from 'three';

export function meshSDF(sdf, opts = {}) {
  const min = opts.min || [-1, -1, -1], max = opts.max || [1, 1, 1];
  const h = opts.cell || 0.02;
  const B = 8; // block size (cells)
  const bandScale = opts.bandScale || 1.25;
  const nx = Math.ceil((max[0] - min[0]) / h), ny = Math.ceil((max[1] - min[1]) / h), nz = Math.ceil((max[2] - min[2]) / h);
  const bx = Math.ceil(nx / B), by = Math.ceil(ny / B), bz = Math.ceil(nz / B);
  const blocks = new Map(); // block index → Float32Array((B+1)^3) of samples
  const S = B + 1;
  const bdiag = Math.sqrt(3) * B * h;
  const bidx = (i, j, k) => (i * by + j) * bz + k;

  // 1) coarse classification: evaluate SDF at block centres
  for (let i = 0; i < bx; i++) for (let j = 0; j < by; j++) for (let k = 0; k < bz; k++) {
    const cx = min[0] + (i + 0.5) * B * h, cy = min[1] + (j + 0.5) * B * h, cz = min[2] + (k + 0.5) * B * h;
    const d = sdf(cx, cy, cz);
    if (Math.abs(d) > bdiag * 0.5 * bandScale + h) continue;
    // 2) fine samples inside the near-surface block
    const arr = new Float32Array(S * S * S);
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) for (let c = 0; c < S; c++) {
      arr[(a * S + b) * S + c] = sdf(min[0] + (i * B + a) * h, min[1] + (j * B + b) * h, min[2] + (k * B + c) * h);
    }
    blocks.set(bidx(i, j, k), arr);
  }

  // global sample accessor (only valid inside stored blocks)
  const cand = (g, n) => { const i = Math.min(n - 1, Math.floor(g / B)); return g % B === 0 && i > 0 ? [i, i - 1] : [i]; };
  const sample = (gi, gj, gk) => {
    if (gi < 0 || gj < 0 || gk < 0) return null;
    for (const i of cand(gi, bx)) for (const j of cand(gj, by)) for (const k of cand(gk, bz)) {
      const blk = blocks.get(bidx(i, j, k));
      if (blk) return blk[((gi - i * B) * S + (gj - j * B)) * S + (gk - k * B)];
    }
    return null;
  };

  // 3) surface nets: one vertex per cell with a sign change
  const vmap = new Map();
  const verts = [];
  const cellKey = (i, j, k) => (i * (ny + 1) + j) * (nz + 1) + k;
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const vals = new Float32Array(8);
  for (const [key, blk] of blocks) {
    const bk = key % bz, bj = Math.floor(key / bz) % by, bi = Math.floor(key / (bz * by));
    for (let a = 0; a < B; a++) for (let b = 0; b < B; b++) for (let c = 0; c < B; c++) {
      let mask = 0;
      for (let q = 0; q < 8; q++) {
        const v = blk[((a + corners[q][0]) * S + (b + corners[q][1])) * S + (c + corners[q][2])];
        vals[q] = v; if (v < 0) mask |= 1 << q;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [e0, e1] of edges) {
        const v0 = vals[e0], v1 = vals[e1];
        if ((v0 < 0) === (v1 < 0)) continue;
        const t = v0 / (v0 - v1);
        sx += corners[e0][0] + (corners[e1][0] - corners[e0][0]) * t;
        sy += corners[e0][1] + (corners[e1][1] - corners[e0][1]) * t;
        sz += corners[e0][2] + (corners[e1][2] - corners[e0][2]) * t;
        n++;
      }
      const gi = bi * B + a, gj = bj * B + b, gk = bk * B + c;
      vmap.set(cellKey(gi, gj, gk), verts.length / 3);
      verts.push(min[0] + (gi + sx / n) * h, min[1] + (gj + sy / n) * h, min[2] + (gk + sz / n) * h);
    }
  }

  // 4) faces: for each grid edge with a sign change, connect the 4 surrounding cells
  const index = [];
  const quad = (c0, c1, c2, c3, flip) => {
    const a = vmap.get(c0), b = vmap.get(c1), c = vmap.get(c2), d = vmap.get(c3);
    if (a === undefined || b === undefined || c === undefined || d === undefined) return;
    if (flip) index.push(a, c, b, b, c, d); else index.push(a, b, c, b, d, c);
  };
  for (const [key] of vmap) {
    const k = key % (nz + 1), j = Math.floor(key / (nz + 1)) % (ny + 1), i = Math.floor(key / ((nz + 1) * (ny + 1)));
    // for cell (i,j,k) check the 3 grid edges ending at its max corner; each edge is shared by 4 cells
    const vx = sample(i + 1, j + 1, k + 1);
    if (vx === null) continue;
    const ax = sample(i, j + 1, k + 1), ay = sample(i + 1, j, k + 1), az = sample(i + 1, j + 1, k);
    if (ax !== null && (vx < 0) !== (ax < 0)) // edge along x between (i,j+1,k+1) and (i+1,j+1,k+1): cells around share j,k
      quad(cellKey(i, j, k), cellKey(i, j + 1, k), cellKey(i, j, k + 1), cellKey(i, j + 1, k + 1), vx < 0);
    if (ay !== null && (vx < 0) !== (ay < 0))
      quad(cellKey(i, j, k), cellKey(i, j, k + 1), cellKey(i + 1, j, k), cellKey(i + 1, j, k + 1), vx < 0);
    if (az !== null && (vx < 0) !== (az < 0))
      quad(cellKey(i, j, k), cellKey(i + 1, j, k), cellKey(i, j + 1, k), cellKey(i + 1, j + 1, k), vx < 0);
  }

  let positions = new Float32Array(verts);
  // 5) optional laplacian smoothing (keeps the surface on the band, removes stair-stepping)
  const passes = opts.smooth ?? 1;
  if (passes > 0) positions = smoothPositions(positions, index, passes, opts.smoothFactor ?? 0.5);

  // 5b) optional Newton projection back onto the zero set (undoes smoothing shrinkage, keeps folds crisp)
  const proj = opts.project ?? 0;
  if (proj > 0) {
    const ep = h * 0.5;
    for (let it = 0; it < proj; it++) {
      for (let v = 0; v < positions.length; v += 3) {
        const x = positions[v], y = positions[v + 1], z = positions[v + 2];
        const d = sdf(x, y, z);
        const gx = sdf(x + ep, y, z) - sdf(x - ep, y, z);
        const gy = sdf(x, y + ep, z) - sdf(x, y - ep, z);
        const gz = sdf(x, y, z + ep) - sdf(x, y, z - ep);
        const g2 = (gx * gx + gy * gy + gz * gz) / (4 * ep * ep);
        if (g2 < 1e-8) continue;
        let k = d / g2 / (2 * ep);
        // never move more than half a cell per step (protects thin features)
        const step = Math.abs(k) * Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (step > h * 0.5) k *= (h * 0.5) / step;
        positions[v] = x - gx * k; positions[v + 1] = y - gy * k; positions[v + 2] = z - gz * k;
      }
    }
  }

  // 6) normals from the SDF gradient (crisper than face normals)
  const normals = new Float32Array(positions.length);
  const e = h * 0.5;
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v], y = positions[v + 1], z = positions[v + 2];
    let gx = sdf(x + e, y, z) - sdf(x - e, y, z);
    let gy = sdf(x, y + e, z) - sdf(x, y - e, z);
    let gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    normals[v] = gx / l; normals[v + 1] = gy / l; normals[v + 2] = gz / l;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function smoothPositions(pos, index, passes, f) {
  const n = pos.length / 3;
  const nbr = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    nbr[a].add(b); nbr[a].add(c); nbr[b].add(a); nbr[b].add(c); nbr[c].add(a); nbr[c].add(b);
  }
  let cur = pos;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(cur.length);
    for (let v = 0; v < n; v++) {
      let sx = 0, sy = 0, sz = 0, k = 0;
      for (const w of nbr[v]) { sx += cur[w * 3]; sy += cur[w * 3 + 1]; sz += cur[w * 3 + 2]; k++; }
      if (!k) { next[v * 3] = cur[v * 3]; next[v * 3 + 1] = cur[v * 3 + 1]; next[v * 3 + 2] = cur[v * 3 + 2]; continue; }
      next[v * 3] = cur[v * 3] + (sx / k - cur[v * 3]) * f;
      next[v * 3 + 1] = cur[v * 3 + 1] + (sy / k - cur[v * 3 + 1]) * f;
      next[v * 3 + 2] = cur[v * 3 + 2] + (sz / k - cur[v * 3 + 2]) * f;
    }
    cur = next;
  }
  return cur;
}

// ------------------------------------------------------------------ SDF primitives & operators
// (all take/return plain numbers; compose with closures)
export const sd = {
  sphere: (x, y, z, r) => Math.hypot(x, y, z) - r,
  box: (x, y, z, bx, by, bz) => {
    const qx = Math.abs(x) - bx, qy = Math.abs(y) - by, qz = Math.abs(z) - bz;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
  },
  roundBox: (x, y, z, bx, by, bz, r) => sd.box(x, y, z, bx - r, by - r, bz - r) - r,
  /** capsule between a and b with radius r */
  capsule: (x, y, z, ax, ay, az, bx, by, bz, r) => {
    const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
    const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
  },
  /** tapered capsule (round cone) between a (radius ra) and b (radius rb) */
  roundCone: (x, y, z, ax, ay, az, bx, by, bz, ra, rb) => {
    const bax = bx - ax, bay = by - ay, baz = bz - az;
    const l2 = bax * bax + bay * bay + baz * baz, rr = ra - rb, a2 = l2 - rr * rr, il2 = 1 / l2;
    const pax = x - ax, pay = y - ay, paz = z - az;
    const yv = pax * bax + pay * bay + paz * baz, zv = yv - l2;
    const cx = pax * l2 - bax * yv, cy = pay * l2 - bay * yv, cz = paz * l2 - baz * yv;
    const x2 = cx * cx + cy * cy + cz * cz, y2 = yv * yv * l2, z2 = zv * zv * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
    if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
    return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - ra;
  },
  ellipsoid: (x, y, z, rx, ry, rz) => {
    const k0 = Math.hypot(x / rx, y / ry, z / rz), k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
    return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  },
  cylinder: (x, y, z, r, h) => { // vertical, centred at origin, half-height h
    const dx = Math.hypot(x, z) - r, dy = Math.abs(y) - h;
    return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  },
  torus: (x, y, z, R, r) => Math.hypot(Math.hypot(x, z) - R, y) - r,
};
export const op = {
  smin: (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; },
  smax: (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; },
  /** smooth subtraction: carve b out of a */
  ssub: (a, b, k) => op.smax(a, -b, k),
};
