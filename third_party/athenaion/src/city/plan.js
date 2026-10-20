// Town plan on the west hills: terrain sampling, a smooth orientation field (contour-following on
// slopes, a regular grid on flat ground), evenly-spaced streamline streets (Jobard–Lefer) in two
// families — contour streets and downhill stair lanes — and lots along the contour streets.
import { heightAt, sdPolygon, waterSDF } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { Simplex } from '../core/noise.js';
import { PORT_POLY, portSDF, quayDist } from './port.js';

const N1 = new Simplex(9127);

export class Grid {
  constructor(x0, z0, res, nx, nz) { this.x0 = x0; this.z0 = z0; this.res = res; this.nx = nx; this.nz = nz; this.a = new Float32Array(nx * nz); }
  i(ix, iz) { return iz * this.nx + ix; }
  get(ix, iz) { ix = Math.max(0, Math.min(this.nx - 1, ix)); iz = Math.max(0, Math.min(this.nz - 1, iz)); return this.a[iz * this.nx + ix]; }
  sample(x, z) {
    const fx = (x - this.x0) / this.res, fz = (z - this.z0) / this.res;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const a = this.get(ix, iz), b = this.get(ix + 1, iz), c = this.get(ix, iz + 1), d = this.get(ix + 1, iz + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  clone() { const g = new Grid(this.x0, this.z0, this.res, this.nx, this.nz); g.a.set(this.a); return g; }
  blur(r) {
    // separable box blur, 2 passes ≈ gaussian
    const { nx, nz } = this; let src = this.a, tmp = new Float32Array(nx * nz);
    for (let pass = 0; pass < 2; pass++) {
      for (let z = 0; z < nz; z++) {
        let acc = 0; const row = z * nx;
        for (let x = -r; x <= r; x++) acc += src[row + Math.max(0, Math.min(nx - 1, x))];
        for (let x = 0; x < nx; x++) {
          tmp[row + x] = acc / (2 * r + 1);
          acc += src[row + Math.min(nx - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
        }
      }
      const out = new Float32Array(nx * nz);
      for (let x = 0; x < nx; x++) {
        let acc = 0;
        for (let z = -r; z <= r; z++) acc += tmp[Math.max(0, Math.min(nz - 1, z)) * nx + x];
        for (let z = 0; z < nz; z++) {
          out[z * nx + x] = acc / (2 * r + 1);
          acc += tmp[Math.min(nz - 1, z + r + 1) * nx + x] - tmp[Math.max(0, z - r) * nx + x];
        }
      }
      src = out;
    }
    this.a = src;
    return this;
  }
}

class PointHash {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  key(x, z) { return Math.floor(x / this.cell) * 92821 + Math.floor(z / this.cell); }
  add(x, z, line, idx) { const k = this.key(x, z); let b = this.m.get(k); if (!b) this.m.set(k, (b = [])); b.push([x, z, line, idx]); }
  /** min distance to points (optionally ignoring line `ign` within `ignIdxRange` of idx) */
  nearest(x, z, r, ign = -1, idx = -1, ignRange = 0) {
    const c = this.cell, cx = Math.floor(x / c), cz = Math.floor(z / c), n = Math.ceil(r / c);
    let best = Infinity;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const b = this.m.get((cx + i) * 92821 + (cz + j)); if (!b) continue;
      for (const p of b) {
        if (p[2] === ign && Math.abs(p[3] - idx) < ignRange) continue;
        const d = Math.hypot(p[0] - x, p[1] - z);
        if (d < best) best = d;
      }
    }
    return best;
  }
}

export class CityPlan {
  constructor(engine, rng) {
    this.engine = engine;
    this.rng = rng;
    this.res = 4;
    const xs = [...L.CITY.outline, ...PORT_POLY].map((p) => p[0]), zs = [...L.CITY.outline, ...PORT_POLY].map((p) => p[1]);
    this.x0 = Math.min(...xs) - 40; this.z0 = Math.min(...zs) - 40;
    this.x1 = Math.max(...xs) + 40; this.z1 = Math.max(...zs) + 40;
    this.nx = Math.ceil((this.x1 - this.x0) / this.res) + 1;
    this.nz = Math.ceil((this.z1 - this.z0) / this.res) + 1;
  }

  // ---------------------------------------------------------------- terrain + mask
  sample() {
    const { nx, nz, res, x0, z0 } = this;
    this.H = new Grid(x0, z0, res, nx, nz);
    this.M = new Grid(x0, z0, res, nx, nz); // 1 = buildable
    // water SDF on a coarser grid (only used for district weights)
    const wr = 12, wnx = Math.ceil((this.x1 - x0) / wr) + 1, wnz = Math.ceil((this.z1 - z0) / wr) + 1;
    this.W = new Grid(x0, z0, wr, wnx, wnz);
    for (let iz = 0; iz < wnz; iz++) for (let ix = 0; ix < wnx; ix++) this.W.a[iz * wnx + ix] = waterSDF(x0 + ix * wr, z0 + iz * wr);
    this.E = new Grid(x0, z0, res, nx, nz); // signed distance inside the city outline (negative inside)
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * res, z = z0 + iz * res, i = iz * nx + ix;
      const h = heightAt(x, z);
      this.H.a[i] = h;
      // town outline (noisy edge) united with the lagoon port district (src/city/port.js)
      const e = Math.min(sdPolygon(x, z, L.CITY.outline) + 22 * N1.fbm2(x / 160, z / 160, 3), portSDF(x, z));
      this.E.a[i] = e;
    }
    this.Hs = this.H.clone().blur(5);
    // slope from the lightly smoothed field
    const Hm = this.H.clone().blur(1);
    this.S = new Grid(x0, z0, res, nx, nz);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const gx = (Hm.get(ix + 1, iz) - Hm.get(ix - 1, iz)) / (2 * res);
      const gz = (Hm.get(ix, iz + 1) - Hm.get(ix, iz - 1)) / (2 * res);
      const sl = Math.hypot(gx, gz);
      this.S.a[iz * nx + ix] = sl;
      const i = iz * nx + ix;
      this.M.a[i] = (this.E.a[i] < -6 && this.H.a[i] > 2.2 && sl < 0.62 && quayDist(x0 + ix * res, z0 + iz * res) > 13) ? 1 : 0;
    }
    // orientation tensor (contour direction) blurred, with a bias toward a global grid on flat land
    this.Ta = new Grid(x0, z0, res, nx, nz); this.Tb = new Grid(x0, z0, res, nx, nz);
    const th0 = -0.26; // preferred grid angle (rad) for flat areas
    const w0 = 0.0035;
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const gx = (this.Hs.get(ix + 1, iz) - this.Hs.get(ix - 1, iz)) / (2 * res);
      const gz = (this.Hs.get(ix, iz + 1) - this.Hs.get(ix, iz - 1)) / (2 * res);
      const i = iz * nx + ix;
      this.Ta.a[i] = gx * gx - gz * gz + w0 * Math.cos(2 * th0);
      this.Tb.a[i] = 2 * gx * gz + w0 * Math.sin(2 * th0);
    }
    this.Ta.blur(9); this.Tb.blur(9);
  }
  inMask(x, z, margin = 0) {
    if (x < this.x0 || z < this.z0 || x > this.x1 || z > this.z1) return false;
    if (margin === 0) return this.M.sample(x, z) > 0.5;
    return this.M.sample(x, z) > 0.5 && this.E.sample(x, z) < -6 - margin;
  }
  /** unit gradient (uphill) direction of the smoothed orientation field */
  gradDir(x, z) {
    const a = this.Ta.sample(x, z), b = this.Tb.sample(x, z);
    const ang = 0.5 * Math.atan2(b, a);
    return [Math.cos(ang), Math.sin(ang)];
  }
  dir(x, z, family) {
    const g = this.gradDir(x, z);
    return family === 0 ? [-g[1], g[0]] : g;
  }

  // ---------------------------------------------------------------- streamline streets
  trace(sx, sz, family, hash, dtest, lineId, step = 3) {
    const half = (sign) => {
      const pts = [];
      let x = sx, z = sz;
      let pd = this.dir(x, z, family); pd = [pd[0] * sign, pd[1] * sign];
      for (let k = 0; k < 700; k++) {
        let d1 = this.dir(x, z, family); if (d1[0] * pd[0] + d1[1] * pd[1] < 0) d1 = [-d1[0], -d1[1]];
        const mx = x + d1[0] * step * 0.5, mz = z + d1[1] * step * 0.5;
        let d2 = this.dir(mx, mz, family); if (d2[0] * pd[0] + d2[1] * pd[1] < 0) d2 = [-d2[0], -d2[1]];
        const nx = x + d2[0] * step, nz = z + d2[1] * step;
        if (!this.inMask(nx, nz)) break;
        if (hash.nearest(nx, nz, dtest) < dtest) break;
        // self-approach (loops)
        let selfHit = false;
        for (let j = 0; j < pts.length - 12; j += 2) if (Math.hypot(pts[j][0] - nx, pts[j][1] - nz) < dtest) { selfHit = true; break; }
        if (selfHit) break;
        pts.push([nx, nz]); pd = d2; x = nx; z = nz;
      }
      return pts;
    };
    const fwd = half(1), back = half(-1);
    const line = [...back.reverse(), [sx, sz], ...fwd];
    void lineId;
    return line;
  }

  streets(family, dsep, minLen, seedPt) {
    const hash = new PointHash(dsep);
    const lines = [];
    const queue = [seedPt];
    const dtest = dsep * 0.55;
    const tryLine = (p) => {
      if (!this.inMask(p[0], p[1])) return;
      if (hash.nearest(p[0], p[1], dsep) < dsep * 0.92) return;
      const line = this.trace(p[0], p[1], family, hash, dtest, lines.length);
      let len = 0; for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      if (len < minLen) return;
      const sm = chaikin(chaikin(line));
      const id = lines.length;
      lines.push(sm);
      for (let i = 0; i < sm.length; i++) hash.add(sm[i][0], sm[i][1], id, i);
      // new seeds on both sides
      for (let i = 0; i < sm.length; i += 3) {
        const a = sm[Math.max(0, i - 1)], b = sm[Math.min(sm.length - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        queue.push([sm[i][0] - tz * dsep, sm[i][1] + tx * dsep]);
        queue.push([sm[i][0] + tz * dsep, sm[i][1] - tx * dsep]);
      }
    };
    let guard = 0;
    while (queue.length && guard++ < 20000) tryLine(queue.shift());
    // fill holes: coarse scan
    for (let z = this.z0; z < this.z1; z += dsep * 0.7) for (let x = this.x0; x < this.x1; x += dsep * 0.7) {
      queue.push([x, z]);
      while (queue.length && guard++ < 40000) tryLine(queue.shift());
    }
    return { lines, hash };
  }

  run() {
    this.sample();
    // seed near the centre of the buildable area
    let sx = 0, sz = 0, n = 0;
    for (let iz = 0; iz < this.nz; iz += 4) for (let ix = 0; ix < this.nx; ix += 4) {
      if (this.M.get(ix, iz) > 0.5) { sx += this.x0 + ix * this.res; sz += this.z0 + iz * this.res; n++; }
    }
    this.centroid = n ? [sx / n, sz / n] : [-800, -200];
    let seed = this.centroid;
    if (!this.inMask(seed[0], seed[1])) {
      // nearest masked cell
      let best = Infinity;
      for (let iz = 0; iz < this.nz; iz += 2) for (let ix = 0; ix < this.nx; ix += 2) if (this.M.get(ix, iz) > 0.5) {
        const x = this.x0 + ix * this.res, z = this.z0 + iz * this.res, d = Math.hypot(x - seed[0], z - seed[1]);
        if (d < best) { best = d; seed = [x, z]; }
      }
    }
    this.A = this.streets(0, 31, 36, seed);      // contour streets
    this.B = this.streets(1, 88, 30, seed);      // downhill lanes / stairs
  }
}

export function chaikin(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** arc-length parametrised polyline helper */
export class Polyline {
  constructor(pts) {
    this.pts = pts; this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.length = this.cum[this.cum.length - 1];
  }
  at(s) {
    s = Math.max(0, Math.min(this.length, s));
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const a = this.pts[lo], b = this.pts[hi], seg = this.cum[hi] - this.cum[lo] || 1, t = (s - this.cum[lo]) / seg;
    let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1;
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx: tx / tl, tz: tz / tl };
  }
}
