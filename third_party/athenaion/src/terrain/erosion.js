// Grid erosion (no three.js; runs in node for the bake and in the browser as a fallback).
//  - streamPower(): implicit fluvial incision (Braun & Willett 2013) on a priority-flood drainage tree:
//    carves dendritic valley networks and leaves sharp ridges/arêtes between them.
//  - thermal(): talus relaxation (scree slopes at the angle of repose, softens noise spikes).
//  - droplets(): particle hydraulic erosion for gullies / couloirs and sediment fans.
// Heights in metres, cell size in metres.

class MinHeap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    let i = this.n++; const k = this.k, v = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0];
    const n = --this.n; const lk = k[n], lv = v[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1; if (c >= n) break;
      if (c + 1 < n && k[c + 1] < k[c]) c++;
      if (k[c] >= lk) break;
      k[i] = k[c]; v[i] = v[c]; i = c;
    }
    k[i] = lk; v[i] = lv;
    return top;
  }
}

const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DZ8 = [0, 0, 1, -1, 1, -1, 1, -1];
const DL8 = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/**
 * Drainage tree by priority flood from the outlets (grid border + cells below `baseLevel` + mask==0).
 * Returns { rcv, order } where order lists cells receivers-first.
 */
export function drainage(h, nx, nz, baseLevel = 0, active = null) {
  const N = nx * nz;
  const rcv = new Int32Array(N).fill(-1);
  const order = new Int32Array(N);
  const done = new Uint8Array(N);
  const heap = new MinHeap(N);
  const hf = new Float64Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
    if (edge || h[c] < baseLevel || (active && !active[c])) { hf[c] = h[c]; done[c] = 1; heap.push(h[c], c); }
  }
  let no = 0;
  const eps = 1e-3;
  while (heap.n) {
    const c = heap.pop();
    order[no++] = c;
    const ci = c % nx, cj = (c - ci) / nx;
    for (let q = 0; q < 8; q++) {
      const i = ci + DX8[q], j = cj + DZ8[q];
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const n = j * nx + i;
      if (done[n]) continue;
      done[n] = 1;
      hf[n] = Math.max(h[n], hf[c] + eps * DL8[q]);
      rcv[n] = c;
      heap.push(hf[n], n);
    }
  }
  return { rcv, order, hf };
}

/** improve receivers: steepest descent toward any neighbour that comes earlier in the order */
function steepestReceivers(h, nx, nz, rcv, order) {
  const N = nx * nz, rank = new Int32Array(N);
  for (let k = 0; k < N; k++) rank[order[k]] = k;
  for (let c = 0; c < N; c++) {
    if (rcv[c] < 0) continue;
    const ci = c % nx, cj = (c - ci) / nx;
    let best = rcv[c], bs = -Infinity;
    for (let q = 0; q < 8; q++) {
      const i = ci + DX8[q], j = cj + DZ8[q];
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const n = j * nx + i;
      if (rank[n] >= rank[c]) continue;
      const s = (h[c] - h[n]) / DL8[q];
      if (s > bs) { bs = s; best = n; }
    }
    rcv[c] = best;
  }
}

/**
 * Stream-power incision: dh/dt = U - K A^m S. Implicit (n = 1), `iters` steps.
 * K may be a number or a Float32Array (erodibility map); U likewise (uplift, m per step).
 */
export function streamPower(h, nx, nz, cell, o = {}) {
  const N = nx * nz;
  const iters = o.iters ?? 10, m = o.m ?? 0.5, dt = o.dt ?? 1;
  const K = o.K ?? 2e-4, U = o.U ?? 0, Ac = o.Acrit ?? 0;
  const area = new Float64Array(N);
  for (let it = 0; it < iters; it++) {
    const { rcv, order } = drainage(h, nx, nz, o.baseLevel ?? 0, o.active);
    steepestReceivers(h, nx, nz, rcv, order);
    // drainage area (donors first = reverse order)
    area.fill(cell * cell);
    for (let k = N - 1; k >= 0; k--) { const c = order[k], r = rcv[c]; if (r >= 0) area[r] += area[c]; }
    // implicit update, receivers first
    for (let k = 0; k < N; k++) {
      const c = order[k], r = rcv[c];
      if (r < 0) continue;
      const ci = c % nx, ri = r % nx;
      const dist = (ci !== ri && Math.abs(c - r) !== nx) ? cell * Math.SQRT2 : cell;
      const kk = typeof K === 'number' ? K : K[c];
      const uu = typeof U === 'number' ? U : U[c];
      let f = kk * dt * Math.pow(area[c], m) / dist;
      if (Ac > 0 && area[c] < Ac) { const q = area[c] / Ac; f *= q * q * q; } // hillslope: below the channel-head threshold
      const hn = (h[c] + uu * dt + f * h[r]) / (1 + f);
      h[c] = hn;
    }
    if (o.onIter) o.onIter(it, area, rcv);
  }
  return h;
}

/** talus relaxation: material slides where the slope exceeds tan(angle) (angle may vary per cell) */
export function thermal(h, nx, nz, cell, o = {}) {
  const iters = o.iters ?? 20, k = o.rate ?? 0.25;
  const talus = o.talus ?? 0.75; // tan(angle)
  const N = nx * nz, d = new Float32Array(N);
  for (let it = 0; it < iters; it++) {
    d.fill(0);
    for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const c = j * nx + i, hc = h[c];
      const tal = (typeof talus === 'number' ? talus : talus[c]) * cell;
      let tot = 0, mx = 0;
      for (let q = 0; q < 8; q++) {
        const n = c + DX8[q] + DZ8[q] * nx;
        const dd = hc - h[n] - tal * DL8[q];
        if (dd > 0) { tot += dd; if (dd > mx) mx = dd; }
      }
      if (tot <= 0) continue;
      const move = k * mx;
      d[c] -= move;
      for (let q = 0; q < 8; q++) {
        const n = c + DX8[q] + DZ8[q] * nx;
        const dd = hc - h[n] - tal * DL8[q];
        if (dd > 0) d[n] += move * dd / tot;
      }
    }
    for (let c = 0; c < N; c++) h[c] += d[c];
  }
  return h;
}

/** particle hydraulic erosion (after S. Lague), rng: () => [0,1) */
export function droplets(h, nx, nz, cell, rng, o = {}) {
  const count = o.count ?? nx * nz * 0.3;
  const inertia = o.inertia ?? 0.06, capF = o.capacity ?? 6, minCap = o.minCapacity ?? 0.01;
  const erodeS = o.erode ?? 0.35, depS = o.deposit ?? 0.25, evap = o.evaporate ?? 0.02, grav = o.gravity ?? 9;
  const maxSteps = o.maxSteps ?? 64, rad = o.radius ?? 2;
  const scale = 1 / cell; // work in cell units (slopes ≈ tan)
  const mask = o.mask || null;
  // brush weights
  const bOff = [], bW = [];
  let wsum = 0;
  for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
    const dd = Math.hypot(i, j); if (dd > rad) continue;
    bOff.push([i, j]); const w = Math.max(0, rad - dd); bW.push(w); wsum += w;
  }
  for (let b = 0; b < bW.length; b++) bW[b] /= wsum;
  const H = (x, z) => {
    const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, c = j * nx + i;
    return { h: (h[c] * (1 - u) + h[c + 1] * u) * (1 - v) + (h[c + nx] * (1 - u) + h[c + nx + 1] * u) * v,
      gx: ((h[c + 1] - h[c]) * (1 - v) + (h[c + nx + 1] - h[c + nx]) * v),
      gz: ((h[c + nx] - h[c]) * (1 - u) + (h[c + nx + 1] - h[c + 1]) * u) };
  };
  for (let d = 0; d < count; d++) {
    let x = 1 + rng() * (nx - 3), z = 1 + rng() * (nz - 3);
    if (mask && mask[Math.floor(z) * nx + Math.floor(x)] < rng()) continue;
    let dx = 0, dz = 0, speed = 1, water = 1, sed = 0;
    for (let s = 0; s < maxSteps; s++) {
      const i = Math.floor(x), j = Math.floor(z);
      const u = x - i, v = z - j;
      const P = H(x, z);
      dx = dx * inertia - P.gx * scale * (1 - inertia);
      dz = dz * inertia - P.gz * scale * (1 - inertia);
      const l = Math.hypot(dx, dz);
      if (l < 1e-9) break;
      dx /= l; dz /= l;
      const nxp = x + dx, nzp = z + dz;
      if (nxp < 1 || nzp < 1 || nxp >= nx - 2 || nzp >= nz - 2) break;
      const dh = (H(nxp, nzp).h - P.h) * scale; // in cell units
      const cap = Math.max(-dh * speed * water * capF, minCap);
      const c = j * nx + i;
      if (sed > cap || dh > 0) {
        const dep = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depS;
        sed -= dep;
        const dm = dep * cell;
        h[c] += dm * (1 - u) * (1 - v); h[c + 1] += dm * u * (1 - v); h[c + nx] += dm * (1 - u) * v; h[c + nx + 1] += dm * u * v;
      } else {
        const er = Math.min((cap - sed) * erodeS, -dh);
        for (let b = 0; b < bOff.length; b++) {
          const ii = i + bOff[b][0], jj = j + bOff[b][1];
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          const cc = jj * nx + ii;
          h[cc] -= er * bW[b] * cell;
        }
        sed += er;
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * grav));
      water *= 1 - evap;
      x = nxp; z = nzp;
    }
  }
  return h;
}
