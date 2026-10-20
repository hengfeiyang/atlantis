// Small geometry / math helpers shared by the vegetation generators.
// Every generated geometry carries the same attribute layout so any mesh can use either the
// foliage or the bark material (and the shared custom depth material for alpha-tested shadows):
//   position (vec3), normal (vec3), uv (vec2: atlas coords), aFol (vec4), aAux (vec2)
//   aFol.x  = ambient occlusion / interior darkness (0 deep inside .. 1 outer surface)
//   aFol.y  = "tip" factor (young sunlit growth at the outside of clumps, 0..1)
//   aFol.z  = per-clump random (colour variation)
//   aFol.w  = wind sway weight (0 at the root .. 1 at the top / branch tips)
//   aAux    = bark coordinates in metres (x around the branch, y along) for bark shading
import * as THREE from 'three';

export class GeoBuilder {
  constructor() {
    this.p = []; this.n = []; this.uv = []; this.f = []; this.a = []; this.idx = [];
    this.count = 0;
    this.groups = [];
    this._groupStart = 0;
  }
  v(px, py, pz, nx, ny, nz, u, vv, f0, f1, f2, f3, a0 = 0, a1 = 0) {
    this.p.push(px, py, pz); this.n.push(nx, ny, nz); this.uv.push(u, vv);
    this.f.push(f0, f1, f2, f3); this.a.push(a0, a1);
    return this.count++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  /** close the current material group (call between bark and foliage parts) */
  group(materialIndex) {
    const start = this._groupStart, count = this.idx.length - start;
    if (count > 0) this.groups.push({ start, count, materialIndex });
    this._groupStart = this.idx.length;
  }
  get triangles() { return this.idx.length / 3; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aFol', new THREE.Float32BufferAttribute(this.f, 4));
    g.setAttribute('aAux', new THREE.Float32BufferAttribute(this.a, 2));
    const I = this.count > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new I(this.idx), 1));
    for (const gr of this.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------- tiny vec3 helpers (arrays)
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  mad: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

/** any unit vector perpendicular to n */
export function perp(n) {
  const a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return v3.norm(v3.cross(n, a));
}

/** rotate vector v around unit axis k by angle a (Rodrigues) */
export function rotAxis(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = v3.dot(k, v) * (1 - c);
  const cr = v3.cross(k, v);
  return [v[0] * c + cr[0] * s + k[0] * d, v[1] * c + cr[1] * s + k[1] * d, v[2] * c + cr[2] * s + k[2] * d];
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** atlas cell → uv rect [u0, v0, u1, v1] (v0 = top of the cell in canvas space) */
export function cellRect(cell, grid = 4, inset = 0.0) {
  const cx = cell % grid, cy = Math.floor(cell / grid), s = 1 / grid;
  return [cx * s + inset * s, cy * s + inset * s, (cx + 1) * s - inset * s, (cy + 1) * s - inset * s];
}

/**
 * Lumpy closed blob (deformed UV sphere) — a foliage clump.
 * c centre, axes: ax (main/up axis, unit), b1, b2 (unit, orthogonal), radii [ra, r1, r2]
 * opts: lon, lat, rect (atlas uv rect for the dense foliage patch), fol(fn(vertexInfo) → [f0..f3]),
 *       normalFn(p, nLocal) → n, pointy (0..1 tapers the top to a flame tip), lump (noise amount), noise
 */
export function addBlob(gb, c, ax, b1, b2, ra, r1, r2, opts) {
  const lon = opts.lon || 6, lat = opts.lat || 5;
  const rect = opts.rect, pointy = opts.pointy || 0, lump = opts.lump || 0, nz = opts.noise;
  const seed = opts.seed || 0;
  const rows = [];
  for (let j = 0; j <= lat; j++) {
    const phi = (j / lat) * Math.PI; // 0 bottom .. PI top
    const row = [];
    if (j === 0 || j === lat) {
      const s = j === 0 ? -1 : 1;
      const rr = j === lat ? ra * (1 + pointy * 0.35) : ra;
      const p = v3.mad(c, ax, s * rr);
      const nl = v3.mul(ax, s);
      row.push(emit(p, nl, 0.5, j / lat, phi, 0));
      rows.push(row); continue;
    }
    const sphi = Math.sin(phi), cphi = -Math.cos(phi);
    // teardrop: the upper half narrows faster
    const up = phi / Math.PI;
    const taper = up > 0.5 ? Math.pow(sphi, 1 + pointy * 1.2) / Math.max(sphi, 1e-3) : 1;
    for (let i = 0; i < lon; i++) {
      const lam = (i / lon) * Math.PI * 2 + (j % 2) * (Math.PI / lon) * 0.5;
      const cl = Math.cos(lam), sl = Math.sin(lam);
      let k = 1;
      if (lump && nz) k += lump * (0.6 * nz.noise3(c[0] * 0.7 + cl * 1.3 + seed, c[1] * 0.7 + cphi * 1.3, c[2] * 0.7 + sl * 1.3) + 0.4 * nz.noise3(c[0] + cl * 3.1 + seed, c[1] + cphi * 3.1, c[2] + sl * 3.1));
      const rx = r1 * sphi * taper * k, ry = r2 * sphi * taper * k;
      const p = [
        c[0] + ax[0] * cphi * ra + b1[0] * cl * rx + b2[0] * sl * ry,
        c[1] + ax[1] * cphi * ra + b1[1] * cl * rx + b2[1] * sl * ry,
        c[2] + ax[2] * cphi * ra + b1[2] * cl * rx + b2[2] * sl * ry,
      ];
      // ellipsoid gradient normal
      const g = v3.norm([
        ax[0] * cphi / ra + b1[0] * cl * sphi / r1 + b2[0] * sl * sphi / r2,
        ax[1] * cphi / ra + b1[1] * cl * sphi / r1 + b2[1] * sl * sphi / r2,
        ax[2] * cphi / ra + b1[2] * cl * sphi / r1 + b2[2] * sl * sphi / r2,
      ]);
      row.push(emit(p, g, i / lon, j / lat, phi, lam));
    }
    rows.push(row);
  }
  function emit(p, nl, u, v, phi, lam) {
    const n = opts.normalFn ? opts.normalFn(p, nl) : nl;
    const f = opts.fol ? opts.fol(p, nl, phi / Math.PI) : [1, 0, 0, 0];
    const uu = rect ? lerp(rect[0], rect[2], 0.5 + 0.45 * Math.cos(lam) * Math.sin(phi)) : u;
    const vv = rect ? lerp(rect[1], rect[3], 0.5 - 0.45 * Math.cos(phi)) : v;
    return gb.v(p[0], p[1], p[2], n[0], n[1], n[2], uu, vv, f[0], f[1], f[2], f[3]);
  }
  // stitch
  for (let i = 0; i < lon; i++) gb.tri(rows[0][0], rows[1][(i + 1) % lon], rows[1][i]);
  for (let j = 1; j < lat - 1; j++) {
    for (let i = 0; i < lon; i++) {
      const a = rows[j][i], b = rows[j][(i + 1) % lon], c2 = rows[j + 1][(i + 1) % lon], d = rows[j + 1][i];
      gb.tri(a, b, c2); gb.tri(a, c2, d);
    }
  }
  const top = rows[lat][0];
  for (let i = 0; i < lon; i++) gb.tri(rows[lat - 1][i], rows[lat - 1][(i + 1) % lon], top);
}

/**
 * Alpha-tested card (quad, optionally bent into 2 segments) centred at base point `o`,
 * growing along `up` with width along `side`. Normals come from normalFn(p) (bent normals).
 */
export function addCard(gb, o, up, side, w, h, rect, normalFn, folFn, bend = 0, flip = false) {
  // 2 rows x 2 cols => 3 rows of verts when bent
  const rows = bend ? 3 : 2;
  const nrm = v3.norm(v3.cross(side, up));
  const ids = [];
  for (let j = 0; j < rows; j++) {
    const t = j / (rows - 1);
    // bend the upper part along the normal (cards curl outward)
    const bo = bend * t * t * h;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -0.5 : 0.5;
      const p = [
        o[0] + up[0] * h * t + side[0] * w * s + nrm[0] * bo,
        o[1] + up[1] * h * t + side[1] * w * s + nrm[1] * bo,
        o[2] + up[2] * h * t + side[2] * w * s + nrm[2] * bo,
      ];
      const n = normalFn(p, nrm);
      const f = folFn(p, t);
      const u = flip ? (i === 0 ? rect[2] : rect[0]) : (i === 0 ? rect[0] : rect[2]);
      const v = lerp(rect[3], rect[1], t); // base of the sprite is the bottom of the cell
      ids.push(gb.v(p[0], p[1], p[2], n[0], n[1], n[2], u, v, f[0], f[1], f[2], f[3]));
    }
  }
  for (let j = 0; j < rows - 1; j++) gb.quad(ids[j * 2], ids[j * 2 + 1], ids[j * 2 + 3], ids[j * 2 + 2]);
}

/**
 * Tube along a polyline with per-point radius. pts: [[x,y,z]...], rad: [r...].
 * opts: radial segments, rect (uv), fol(t) → [f0..f3], noise (Simplex) + gnarl amount for
 * fluted/twisted bark, cap (close the end), barkOffset (metres along, for continuous bark coords)
 */
export function addTube(gb, pts, rad, opts = {}) {
  const segs = opts.radial || 6, n = pts.length;
  if (n < 2) return;
  const rect = opts.rect || [0, 0, 1, 1];
  const gn = opts.gnarl || 0, nz = opts.noise, seed = opts.seed || 0, twist = opts.twist || 0;
  // parallel-transport frames
  let T = v3.norm(v3.sub(pts[1], pts[0]));
  let N = perp(T);
  let along = opts.barkOffset || 0;
  const ringIds = [];
  for (let k = 0; k < n; k++) {
    if (k > 0) {
      const Tn = v3.norm(v3.sub(pts[Math.min(n - 1, k + 1)], pts[k - 1]));
      // rotate N to stay perpendicular
      const ax = v3.cross(T, Tn), sa = v3.len(ax);
      if (sa > 1e-6) N = rotAxis(N, v3.mul(ax, 1 / sa), Math.asin(Math.min(1, sa)));
      T = Tn;
      along += v3.len(v3.sub(pts[k], pts[k - 1]));
    }
    N = v3.norm(v3.sub(N, v3.mul(T, v3.dot(N, T))));
    const B = v3.cross(T, N);
    const r = rad[k];
    const t = k / (n - 1);
    const f = opts.fol ? opts.fol(t, pts[k]) : [0.7, 0, 0, t];
    const ring = [];
    const circ = 2 * Math.PI * r;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      let rr = r;
      if (gn && nz) {
        // twisted flutes (fibres spiralling up the trunk) + knobbly bulges
        const tw = a + along * twist;
        rr *= 1 + gn * (0.12 * Math.sin(tw * 3 + seed) + 0.55 * nz.noise3(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4, along * 0.7) + 0.25 * nz.noise3(Math.cos(a) * 3.1, Math.sin(a) * 3.1 + seed, along * 2.2));
      }
      const ca = Math.cos(a), sa2 = Math.sin(a);
      const dir = [N[0] * ca + B[0] * sa2, N[1] * ca + B[1] * sa2, N[2] * ca + B[2] * sa2];
      const p = v3.mad(pts[k], dir, rr);
      const u = lerp(rect[0], rect[2], i / segs);
      const v = lerp(rect[3], rect[1], t);
      ring.push(gb.v(p[0], p[1], p[2], dir[0], dir[1], dir[2], u, v, f[0], f[1], f[2], f[3], (i / segs) * circ, along));
    }
    ringIds.push(ring);
  }
  for (let k = 0; k < n - 1; k++) {
    for (let i = 0; i < segs; i++) {
      gb.quad(ringIds[k][i], ringIds[k][i + 1], ringIds[k + 1][i + 1], ringIds[k + 1][i]);
    }
  }
  if (opts.cap) {
    const c = pts[n - 1], f = opts.fol ? opts.fol(1, c) : [0.7, 0, 0, 1];
    const ci = gb.v(c[0], c[1], c[2], T[0], T[1], T[2], rect[0], rect[1], f[0], f[1], f[2], f[3], 0, along);
    for (let i = 0; i < segs; i++) gb.tri(ringIds[n - 1][i], ringIds[n - 1][i + 1], ci);
  }
  return along;
}

/** far-LOD impostor quad: position (±R, 0..H, 0) (the shader turns it toward the camera), aAux = (±1, 0..1) */
export function billboardQuad(H, R, rect) {
  const gb = new GeoBuilder();
  const ids = [];
  for (const [sx, sy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
    ids.push(gb.v(sx * R, sy * H, 0, 0, 0, 1, sx < 0 ? rect[0] : rect[2], sy ? rect[1] : rect[3], 0.6, 0, 0.5, 0, sx, sy));
  }
  gb.quad(ids[0], ids[1], ids[2], ids[3]);
  return gb.build();
}
