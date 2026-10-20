// Geometry toolkit for the ring walls (adapted from athenaion/src/acropolis/geo.js): compact indexed
// triangle builder (flat normals, int8 normals, uint8 vertex colours, FLOAT aux so the shared stone
// material's masonry flags work: aux.w = 3 + course/10 → ashlar, 5 + slab/10 → paving), chamfered
// blocks in arbitrary frames, profile sweeps, lathes, chunked per-material merging (frustum culling).
import * as THREE from 'three';

class Grow {
  constructor(T = Float32Array, n = 1 << 14) { this.T = T; this.a = new T(n); this.n = 0; }
  ensure(k) { if (this.n + k > this.a.length) { let L = this.a.length * 2; while (L < this.n + k) L *= 2; const b = new this.T(L); b.set(this.a); this.a = b; } }
  get array() { return this.a.subarray(0, this.n); }
}
const q8 = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

export const AUX_ASHLAR = (course) => 3 + course / 10;   // shared stone.js masonry flags
export const AUX_PAVING = (slab) => 5 + slab / 10;
export const AUX_DRUMS = 1.0;

export class GeoBuilder {
  constructor() {
    this.P = new Grow(Float32Array); this.N = new Grow(Int8Array); this.C = new Grow(Uint8Array); this.A = new Grow(Float32Array);
    this.I = new Grow(Uint32Array);
    this.count = 0; this.tris = 0;
    this.aux = [0, 0, 0, 0];          // x cavity, y edge wear, z streak, w masonry flag
    this.auxCh = [0.35, 0.6, 0, 0];   // chamfer faces
  }
  get empty() { return this.I.n === 0; }
  _v(p, nx, ny, nz, k) {
    const P = this.P, N = this.N, C = this.C, A = this.A, a = this.aux;
    P.ensure(3); N.ensure(3); C.ensure(3); A.ensure(4);
    P.a[P.n++] = p[0]; P.a[P.n++] = p[1]; P.a[P.n++] = p[2];
    N.a[N.n++] = q8(nx); N.a[N.n++] = q8(ny); N.a[N.n++] = q8(nz);
    C.a[C.n++] = u8(k[0]); C.a[C.n++] = u8(k[1]); C.a[C.n++] = u8(k[2]);
    A.a[A.n++] = a[0]; A.a[A.n++] = a[1]; A.a[A.n++] = a[2]; A.a[A.n++] = a[3] || 0;
    return this.count++;
  }
  _i3(a, b, c) { const I = this.I; I.ensure(3); I.a[I.n++] = a; I.a[I.n++] = b; I.a[I.n++] = c; this.tris++; }
  tri(a, b, c, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return; nx /= l; ny /= l; nz /= l;
    const i0 = this._v(a, nx, ny, nz, col), i1 = this._v(b, nx, ny, nz, col), i2 = this._v(c, nx, ny, nz, col);
    this._i3(i0, i1, i2);
  }
  quad(a, b, c, d, col) {
    const n1x = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const n1y = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const n1z = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const n2x = (c[1] - a[1]) * (d[2] - a[2]) - (c[2] - a[2]) * (d[1] - a[1]);
    const n2y = (c[2] - a[2]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[2] - a[2]);
    const n2z = (c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]);
    let nx = n1x + n2x, ny = n1y + n2y, nz = n1z + n2z;
    const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return; nx /= l; ny /= l; nz /= l;
    const i0 = this._v(a, nx, ny, nz, col), i1 = this._v(b, nx, ny, nz, col), i2 = this._v(c, nx, ny, nz, col), i3 = this._v(d, nx, ny, nz, col);
    this._i3(i0, i1, i2); this._i3(i0, i2, i3);
  }
  /** quad with explicit per-vertex normals + optional per-vertex aux (smooth-shaded rock); wound to face `dir` */
  quadSmooth(P4, N4, col, A4, dir) {
    const [a, b, , d] = P4;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const order = nx * dir[0] + ny * dir[1] + nz * dir[2] >= 0 ? [0, 1, 2, 3] : [3, 2, 1, 0];
    const save = this.aux, idx = [];
    for (const i of order) { if (A4) this.aux = A4[i]; const n = N4[i]; idx.push(this._v(P4[i], n[0], n[1], n[2], col)); }
    this.aux = save;
    this._i3(idx[0], idx[1], idx[2]); this._i3(idx[0], idx[2], idx[3]);
  }
  poly(pts, col) { for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0], pts[i], pts[i + 1], col); }
  /** quad oriented to face away from `center` */
  quadOut(a, b, c, d, col, center) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0] + d[0]) / 4 - center[0], my = (a[1] + b[1] + c[1] + d[1]) / 4 - center[1], mz = (a[2] + b[2] + c[2] + d[2]) / 4 - center[2];
    if (nx * mx + ny * my + nz * mz >= 0) this.quad(a, b, c, d, col); else this.quad(d, c, b, a, col);
  }
  /** quad oriented toward world direction dir */
  quadToward(a, b, c, d, col, dir) {
    const n = cross3(sub3(b, a), sub3(d, a));
    if (dot3(n, dir) >= 0) this.quad(a, b, c, d, col); else this.quad(d, c, b, a, col);
  }
  polyToward(pts, col, dir) {
    const n = cross3(sub3(pts[1], pts[0]), sub3(pts[2], pts[0]));
    if (dot3(n, dir) < 0) pts = pts.slice().reverse();
    this.poly(pts, col);
  }
  /** append a BufferGeometry transformed by a Matrix4 (smooth normals), tinted by col */
  addGeometry(geo, m, col = [1, 1, 1]) {
    const P = geo.attributes.position, Nn = geo.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const base = this.count;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m);
      if (Nn) n.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize(); else n.set(0, 1, 0);
      this._v([v.x, v.y, v.z], n.x, n.y, n.z, col);
    }
    const flip = m.determinant() < 0; // mirrored frame: keep the winding outward
    const t = (a, b, c) => (flip ? this._i3(a, c, b) : this._i3(a, b, c));
    if (geo.index) { const ix = geo.index.array; for (let i = 0; i < ix.length; i += 3) t(base + ix[i], base + ix[i + 1], base + ix[i + 2]); }
    else for (let i = 0; i < P.count; i += 3) t(base + i, base + i + 1, base + i + 2);
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.array.slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.array.slice(), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.array.slice(), 3, true));
    g.setAttribute('aux', new THREE.BufferAttribute(this.A.array.slice(), 4));
    const idx = this.I.array;
    g.setIndex(new THREE.BufferAttribute(this.count < 65536 ? new Uint16Array(idx) : idx.slice(), 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

/** builders keyed by material name AND spatial chunk */
export class ChunkedBuilders {
  constructor(cell = 96) { this.cell = cell; this.map = new Map(); this.tris = 0; }
  get(mat, x = 0, z = 0) {
    const k = `${mat}|${Math.floor(x / this.cell)}|${Math.floor(z / this.cell)}`;
    let b = this.map.get(k);
    if (!b) { b = new GeoBuilder(); b.mat = mat; b.part = 0; this.map.set(k, b); }
    else if (b.count > 60000) {
      this.map.set(k + '#' + b.part, b);
      const nb = new GeoBuilder(); nb.mat = mat; nb.part = b.part + 1; nb.aux = b.aux; this.map.set(k, nb); b = nb;
    }
    return b;
  }
  meshes(mats, prefix = 'rings') {
    const out = [];
    let tris = 0;
    for (const [k, b] of this.map) {
      if (b.empty) continue;
      const m = mats[b.mat]; if (!m) { console.warn('[rings] no material', b.mat); continue; }
      const mesh = new THREE.Mesh(b.toGeometry(), m);
      mesh.name = prefix + ':' + k;
      tris += b.tris;
      out.push(mesh);
    }
    this.tris = tris;
    return out;
  }
}

// ------------------------------------------------------------------ frames
/** local frame: origin o, axes ax (along), ay (up), az (outward). Points in local (s, y, d). */
export class Frame {
  constructor(o, ax, ay, az) { this.o = o; this.ax = ax; this.ay = ay; this.az = az; }
  p(s, y, d) {
    const o = this.o, a = this.ax, b = this.ay, c = this.az;
    return [o[0] + a[0] * s + b[0] * y + c[0] * d, o[1] + a[1] * s + b[1] * y + c[1] * d, o[2] + a[2] * s + b[2] * y + c[2] * d];
  }
  dir(s, y, d) { const a = this.ax, b = this.ay, c = this.az; return [a[0] * s + b[0] * y + c[0] * d, a[1] * s + b[1] * y + c[1] * d, a[2] * s + b[2] * y + c[2] * d]; }
  at(s, y, d) { return new Frame(this.p(s, y, d), this.ax, this.ay, this.az); }
  /** rotate about the up axis by a radians */
  yawed(a) {
    const c = Math.cos(a), s = Math.sin(a);
    const ax = [this.ax[0] * c + this.az[0] * s, this.ax[1] * c + this.az[1] * s, this.ax[2] * c + this.az[2] * s];
    const az = [this.az[0] * c - this.ax[0] * s, this.az[1] * c - this.ax[1] * s, this.az[2] * c - this.ax[2] * s];
    return new Frame(this.o, ax, this.ay, az);
  }
  /** lean: tilt up axis toward ax by a and toward az by b (radians, small) */
  tilted(a, b) {
    const ay = norm3([this.ay[0] + this.ax[0] * a + this.az[0] * b, this.ay[1] + this.ax[1] * a + this.az[1] * b, this.ay[2] + this.ax[2] * a + this.az[2] * b]);
    const ax = norm3(sub3(this.ax, mul3(ay, dot3(this.ax, ay))));
    const az = cross3(ax, ay);
    const sgn = dot3(az, this.az) < 0 ? -1 : 1;
    return new Frame(this.o, ax, ay, mul3(az, sgn));
  }
  /** THREE.Matrix4 mapping local (x=s, y, z=d) to world */
  matrix() {
    const m = new THREE.Matrix4();
    m.set(this.ax[0], this.ay[0], this.az[0], this.o[0], this.ax[1], this.ay[1], this.az[1], this.o[1], this.ax[2], this.ay[2], this.az[2], this.o[2], 0, 0, 0, 1);
    return m;
  }
}
export function frameXZ(x, y, z, dirX, dirZ, outX, outZ) {
  const l = Math.hypot(dirX, dirZ) || 1, lo = Math.hypot(outX, outZ) || 1;
  return new Frame([x, y, z], [dirX / l, 0, dirZ / l], [0, 1, 0], [outX / lo, 0, outZ / lo]);
}
/** frame whose +d axis faces compass heading deg; +s to the viewer's right when facing the front */
export function frameFacing(x, y, z, deg) {
  const a = (deg * Math.PI) / 180;
  const fx = Math.sin(a), fz = -Math.cos(a);
  return new Frame([x, y, z], [fz, 0, -fx], [0, 1, 0], [fx, 0, fz]);
}
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ------------------------------------------------------------------ chamfered boxes
export const FACES = { px: 1, nx: 2, py: 4, ny: 8, pz: 16, nz: 32 };
export const ALL_FACES = 63;
/**
 * Chamfered box in frame F over local s∈[x0,x1], y∈[y0,y1], d∈[z0,z1]; chamfer c; mask = emitted faces.
 */
export function chamferBox(B, F, x0, x1, y0, y1, z0, z1, c, col, mask = ALL_FACES, chamferCol = null) {
  c = Math.max(0, Math.min(c, (x1 - x0) * 0.45, (y1 - y0) * 0.45, (z1 - z0) * 0.45));
  const X = [x0, x1], Y = [y0, y1], Z = [z0, z1];
  const ins = (i, lo, hi) => (i ? hi - c : lo + c);
  const cc = chamferCol || col;
  const V = (i, j, k, f) => F.p(f === 0 ? X[i] : ins(i, x0, x1), f === 1 ? Y[j] : ins(j, y0, y1), f === 2 ? Z[k] : ins(k, z0, z1));
  const center = F.p((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const emit = (pts, colr) => {
    const n = cross3(sub3(pts[1], pts[0]), sub3(pts[2], pts[0]));
    let mx = 0, my = 0, mz = 0; for (const p of pts) { mx += p[0]; my += p[1]; mz += p[2]; }
    const k = pts.length;
    if (dot3(n, [mx / k - center[0], my / k - center[1], mz / k - center[2]]) < 0) pts.reverse();
    if (k === 3) B.tri(pts[0], pts[1], pts[2], colr); else B.quad(pts[0], pts[1], pts[2], pts[3], colr);
  };
  const has = (axis, side) => mask & [[2, 1], [8, 4], [32, 16]][axis][side];
  for (let side = 0; side < 2; side++) {
    if (has(0, side)) emit([V(side, 0, 0, 0), V(side, 1, 0, 0), V(side, 1, 1, 0), V(side, 0, 1, 0)], col);
    if (has(1, side)) emit([V(0, side, 0, 1), V(1, side, 0, 1), V(1, side, 1, 1), V(0, side, 1, 1)], col);
    if (has(2, side)) emit([V(0, 0, side, 2), V(1, 0, side, 2), V(1, 1, side, 2), V(0, 1, side, 2)], col);
  }
  if (c <= 1e-4) return;
  const auxSave = B.aux;
  B.aux = [Math.max(auxSave[0], B.auxCh[0]), Math.max(auxSave[1], B.auxCh[1]), auxSave[2], auxSave[3]];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    if (has(0, i) || has(1, j)) emit([V(i, j, 0, 0), V(i, j, 1, 0), V(i, j, 1, 1), V(i, j, 0, 1)], cc);
    if (has(0, i) || has(2, j)) emit([V(i, 0, j, 0), V(i, 1, j, 0), V(i, 1, j, 2), V(i, 0, j, 2)], cc);
    if (has(1, i) || has(2, j)) emit([V(0, i, j, 1), V(1, i, j, 1), V(1, i, j, 2), V(0, i, j, 2)], cc);
  }
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    if (has(0, i) || has(1, j) || has(2, k)) emit([V(i, j, k, 0), V(i, j, k, 1), V(i, j, k, 2)], cc);
  }
  B.aux = auxSave;
}
export function box(B, F, x0, x1, y0, y1, z0, z1, col, mask = ALL_FACES) { chamferBox(B, F, x0, x1, y0, y1, z0, z1, 0, col, mask); }

/**
 * Sweep a 2D profile [[d, y], ...] (bottom → top) along s0..s1 of frame F (mouldings, cornices).
 */
export function sweep(B, F, s0, s1, profile, col, caps = true) {
  for (let i = 0; i < profile.length - 1; i++) {
    const [d0, y0] = profile[i], [d1, y1] = profile[i + 1];
    const a = F.p(s0, y0, d0), b2 = F.p(s1, y0, d0), c = F.p(s1, y1, d1), d = F.p(s0, y1, d1);
    const want = F.dir(0, -(d1 - d0), y1 - y0);
    B.quadToward(a, b2, c, d, col, want);
  }
  if (caps) {
    const dBack = Math.min(...profile.map((p) => p[0]));
    for (const [s, sign] of [[s0, -1], [s1, 1]]) {
      for (let i = 0; i < profile.length - 1; i++) {
        const [d0, y0] = profile[i], [d1, y1] = profile[i + 1];
        if (Math.max(d0, d1) - dBack < 1e-3) continue;
        B.quadToward(F.p(s, y0, dBack), F.p(s, y0, d0), F.p(s, y1, d1), F.p(s, y1, dBack), col, mul3(F.ax, sign));
      }
    }
  }
}

/** lathe geometry from a profile [[r, y], ...] — smooth normals */
export function latheGeo(profile, segs = 12) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), segs);
  g.computeVertexNormals();
  return g;
}
/** append a lathe (local frame F, centred at (s, y, d)) */
export function lathe(B, F, s, y, d, profile, segs, col, scale = 1) {
  const g = latheGeo(profile.map(([r, yy]) => [r * scale, yy * scale]), segs);
  const m = F.at(s, y, d).matrix();
  B.addGeometry(g, m, col);
  g.dispose();
}
