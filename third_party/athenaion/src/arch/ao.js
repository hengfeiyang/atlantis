// AO volume: a coarse voxel grid of *directional sky visibility* around a building, computed on
// the CPU from simple occluder primitives (boxes, cylinders, prisms) by ray marching.
// Stored as two RGBA8 3D textures holding visibility toward ±X ±Y (A) and ±Z (B) in the
// building's local frame. Marble / metal shaders sample it at P + N·cell and weight the six
// lobes by the surface normal → peristyles, ceilings, cella interiors and mutule recesses get
// believable ambient occlusion with no screen-space pass.
import * as THREE from 'three';

function fibSphere(n) {
  const out = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = g * i;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
}

export class AOVolume {
  /**
   * @param {object} o { min:[x,y,z], max:[x,y,z] local bounds, cell (m) }
   * The local frame is the building frame; call setPlacement(position, rotY) before compute().
   */
  constructor(o) {
    this.cell = o.cell ?? 0.6;
    this.min = o.min.slice();
    const c = this.cell;
    this.nx = Math.max(2, Math.ceil((o.max[0] - o.min[0]) / c));
    this.ny = Math.max(2, Math.ceil((o.max[1] - o.min[1]) / c));
    this.nz = Math.max(2, Math.ceil((o.max[2] - o.min[2]) / c));
    this.occ = new Uint8Array(this.nx * this.ny * this.nz);
    this.position = new THREE.Vector3();
    this.rotY = 0;
  }
  idx(i, j, k) { return i + this.nx * (j + this.ny * k); }
  _range(a, b, axis) {
    const m = this.min[axis], c = this.cell, n = [this.nx, this.ny, this.nz][axis];
    // voxels whose centre lies inside [a,b] (plus thin objects: at least the nearest voxel)
    let i0 = Math.ceil((a - m) / c - 0.5), i1 = Math.floor((b - m) / c - 0.5);
    if (i1 < i0) { const mid = Math.round(((a + b) / 2 - m) / c - 0.5); i0 = i1 = mid; }
    return [Math.max(0, i0), Math.min(n - 1, i1)];
  }
  addBox(min, max) {
    const [i0, i1] = this._range(min[0], max[0], 0), [j0, j1] = this._range(min[1], max[1], 1), [k0, k1] = this._range(min[2], max[2], 2);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.occ[this.idx(i, j, k)] = 1;
  }
  /** vertical cylinder */
  addCylinder(cx, cz, r, y0, y1) {
    const [j0, j1] = this._range(y0, y1, 1);
    const [i0, i1] = this._range(cx - r, cx + r, 0), [k0, k1] = this._range(cz - r, cz + r, 2);
    const c = this.cell, m = this.min;
    const rr = Math.max(r, c * 0.55);
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const x = m[0] + (i + 0.5) * c, z = m[2] + (k + 0.5) * c;
      if ((x - cx) ** 2 + (z - cz) ** 2 > rr * rr) continue;
      for (let j = j0; j <= j1; j++) this.occ[this.idx(i, j, k)] = 1;
    }
  }
  /** generic: fill voxels where fn(x,y,z) is true inside the given local bounds */
  addFn(min, max, fn) {
    const [i0, i1] = this._range(min[0], max[0], 0), [j0, j1] = this._range(min[1], max[1], 1), [k0, k1] = this._range(min[2], max[2], 2);
    const c = this.cell, m = this.min;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (fn(m[0] + (i + 0.5) * c, m[1] + (j + 0.5) * c, m[2] + (k + 0.5) * c)) this.occ[this.idx(i, j, k)] = 1;
    }
  }
  setPlacement(position, rotY) { this.position.copy(position); this.rotY = rotY; }

  compute(o = {}) {
    const t0 = performance.now();
    const rays = fibSphere(o.rays ?? 40);
    const maxDist = o.maxDist ?? 12;
    const bounce = o.bounce ?? 0.07;
    const { nx, ny, nz, occ, cell } = this;
    const N = nx * ny * nz;
    const vis = new Float32Array(N * 6);
    // near-surface mask (empty voxels within 2 cells of something solid)
    const near = new Uint8Array(N);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!occ[this.idx(i, j, k)]) continue;
      const NR = o.nearCells ?? 3;
      for (let dk = -NR; dk <= NR; dk++) for (let dj = -NR; dj <= NR; dj++) for (let di = -NR; di <= NR; di++) {
        const a = i + di, b = j + dj, c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
        near[this.idx(a, b, c)] = 1;
      }
    }
    const lobes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const W = rays.map((d) => lobes.map((l) => Math.max(0, d[0] * l[0] + d[1] * l[1] + d[2] * l[2])));
    const Wsum = lobes.map((_, li) => W.reduce((s, w) => s + w[li], 0));
    const step = cell * 0.75, nSteps = Math.ceil(maxDist / step);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const id = this.idx(i, j, k);
      if (occ[id]) continue;
      const out = id * 6;
      if (!near[id] && !o.full) { for (let l = 0; l < 6; l++) vis[out + l] = 1; continue; }
      const acc = [0, 0, 0, 0, 0, 0];
      for (let r = 0; r < rays.length; r++) {
        const d = rays[r];
        let x = i + 0.5, y = j + 0.5, z = k + 0.5;
        const sx = (d[0] * step) / cell, sy = (d[1] * step) / cell, sz = (d[2] * step) / cell;
        let v = 1;
        for (let s = 0; s < nSteps; s++) {
          x += sx; y += sy; z += sz;
          if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) break;
          if (occ[(x | 0) + nx * ((y | 0) + ny * (z | 0))]) { v = bounce + (1 - bounce) * Math.pow(Math.min(1, (s * step) / maxDist), 1.5) * 0.4; break; }
        }
        const w = W[r];
        for (let l = 0; l < 6; l++) acc[l] += w[l] * v;
      }
      for (let l = 0; l < 6; l++) vis[out + l] = acc[l] / Wsum[l];
    }
    // extrapolate into solid voxels (so trilinear filtering near surfaces stays clean)
    for (let pass = 0; pass < 3; pass++) {
      const filled = new Uint8Array(N);
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const id = this.idx(i, j, k);
        if (!occ[id]) continue;
        const sum = [0, 0, 0, 0, 0, 0]; let cnt = 0;
        for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const a = i + di, b = j + dj, c = k + dk;
          if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
          const nid = this.idx(a, b, c);
          if (occ[nid] && !(occ[nid] === 2)) continue;
          for (let l = 0; l < 6; l++) sum[l] += vis[nid * 6 + l];
          cnt++;
        }
        if (cnt) { for (let l = 0; l < 6; l++) vis[id * 6 + l] = sum[l] / cnt; filled[id] = 1; }
      }
      for (let n = 0; n < N; n++) if (filled[n]) occ[n] = 2;
    }
    for (let n = 0; n < N; n++) if (occ[n] === 1) for (let l = 0; l < 6; l++) vis[n * 6 + l] = 0.25;
    // pack
    const A = new Uint8Array(N * 4), B = new Uint8Array(N * 4);
    for (let n = 0; n < N; n++) {
      for (let l = 0; l < 4; l++) A[n * 4 + l] = Math.round(Math.min(1, vis[n * 6 + l]) * 255);
      B[n * 4] = Math.round(Math.min(1, vis[n * 6 + 4]) * 255);
      B[n * 4 + 1] = Math.round(Math.min(1, vis[n * 6 + 5]) * 255);
      B[n * 4 + 3] = 255;
    }
    const mk = (data) => {
      const t = new THREE.Data3DTexture(data, nx, ny, nz);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
      t.unpackAlignment = 1; t.needsUpdate = true;
      return t;
    };
    this.texA = mk(A); this.texB = mk(B);
    // world → uvw
    const inv = new THREE.Matrix4().makeRotationY(-this.rotY).multiply(new THREE.Matrix4().makeTranslation(-this.position.x, -this.position.y, -this.position.z));
    const toUvw = new THREE.Matrix4().makeScale(1 / (nx * cell), 1 / (ny * cell), 1 / (nz * cell))
      .multiply(new THREE.Matrix4().makeTranslation(-this.min[0], -this.min[1], -this.min[2]))
      .multiply(inv);
    this.worldToUvw = toUvw;
    this.worldToLocalRot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationY(-this.rotY));
    this.ms = Math.round(performance.now() - t0);
    occ.fill(0); // free-ish
    return this;
  }
}
