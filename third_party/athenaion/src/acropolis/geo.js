// Geometry toolkit for the acropolis dressing: a compact indexed triangle builder (flat normals,
// int8 normals, uint8 vertex colours + aux), chamfered blocks in arbitrary frames, profile sweeps,
// lathes. Everything is merged per material into chunked meshes (frustum culling).
// Memory: ~23 B/vertex + 4 B/index ≈ 60 B per triangle (vs ~156 B for float non-indexed).
import * as THREE from 'three';

class Grow {
  constructor(T = Float32Array, n = 1 << 14) { this.T = T; this.a = new T(n); this.n = 0; }
  ensure(k) { if (this.n + k > this.a.length) { let L = this.a.length * 2; while (L < this.n + k) L *= 2; const b = new this.T(L); b.set(this.a); this.a = b; } }
  get array() { return this.a.subarray(0, this.n); }
}
const q8 = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** linear colour helper: [r,g,b] in linear space */
export function lin(hex, mul = 1) {
  const c = new THREE.Color(hex);
  return [c.r * mul, c.g * mul, c.b * mul];
}

export class GeoBuilder {
  constructor() {
    this.P = new Grow(Float32Array); this.N = new Grow(Int8Array); this.C = new Grow(Uint8Array); this.A = new Grow(Uint8Array);
    this.I = new Grow(Uint32Array);
    this.count = 0; this.tris = 0;
    // aux (vec4) per vertex for the marble materials: x cavity, y edge wear, z streak source, w flags
    this.aux = [0, 0, 0, 0];
    this.auxCh = [0.45, 0.55, 0, 0]; // chamfer / joint faces
  }
  get empty() { return this.I.n === 0; }
  _v(p, nx, ny, nz, k) {
    const P = this.P, N = this.N, C = this.C, A = this.A, a = this.aux;
    P.ensure(3); N.ensure(3); C.ensure(3); A.ensure(4);
    P.a[P.n++] = p[0]; P.a[P.n++] = p[1]; P.a[P.n++] = p[2];
    N.a[N.n++] = q8(nx); N.a[N.n++] = q8(ny); N.a[N.n++] = q8(nz);
    C.a[C.n++] = u8(k[0]); C.a[C.n++] = u8(k[1]); C.a[C.n++] = u8(k[2]);
    A.a[A.n++] = u8(a[0]); A.a[A.n++] = u8(a[1]); A.a[A.n++] = u8(a[2]); A.a[A.n++] = u8(a[3] || 0);
    return this.count++;
  }
  _i3(a, b, c) { const I = this.I; I.ensure(3); I.a[I.n++] = a; I.a[I.n++] = b; I.a[I.n++] = c; this.tris++; }

  /** triangle with flat normal; col = [r,g,b] (or 3 colours: [c0,c1,c2]) */
  tri(a, b, c, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const multi = Array.isArray(col[0]);
    const i0 = this._v(a, nx, ny, nz, multi ? col[0] : col);
    const i1 = this._v(b, nx, ny, nz, multi ? col[1] : col);
    const i2 = this._v(c, nx, ny, nz, multi ? col[2] : col);
    this._i3(i0, i1, i2);
  }
  /** convex quad a,b,c,d (counter-clockwise seen from the front): 4 shared vertices, flat normal */
  quad(a, b, c, d, col) {
    // average normal of both halves (robust for slightly non-planar quads)
    const n1x = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const n1y = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const n1z = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const n2x = (c[1] - a[1]) * (d[2] - a[2]) - (c[2] - a[2]) * (d[1] - a[1]);
    const n2y = (c[2] - a[2]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[2] - a[2]);
    const n2z = (c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]);
    let nx = n1x + n2x, ny = n1y + n2y, nz = n1z + n2z;
    const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return; nx /= l; ny /= l; nz /= l;
    const multi = Array.isArray(col[0]);
    const i0 = this._v(a, nx, ny, nz, multi ? col[0] : col);
    const i1 = this._v(b, nx, ny, nz, multi ? col[1] : col);
    const i2 = this._v(c, nx, ny, nz, multi ? col[2] : col);
    const i3 = this._v(d, nx, ny, nz, multi ? col[3] : col);
    this._i3(i0, i1, i2); this._i3(i0, i2, i3);
  }
  /** polygon (fan) — must be convex */
  poly(pts, col) { for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0], pts[i], pts[i + 1], col); }
  /** quad oriented to face away from `center` */
  quadOut(a, b, c, d, col, center) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0] + d[0]) / 4 - center[0], my = (a[1] + b[1] + c[1] + d[1]) / 4 - center[1], mz = (a[2] + b[2] + c[2] + d[2]) / 4 - center[2];
    if (nx * mx + ny * my + nz * mz >= 0) this.quad(a, b, c, d, col); else this.quad(d, c, b, a, col);
  }
  /** polygon oriented toward direction `dir` */
  polyToward(pts, col, dir) {
    const a = pts[0], b = pts[1], c = pts[2];
    const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] < 0) pts = pts.slice().reverse();
    this.poly(pts, col);
  }

  /** append a THREE.BufferGeometry transformed by a Matrix4, tinted with col (multiplies any colour attr) */
  addGeometry(geo, m, col = [1, 1, 1], smooth = true) {
    const P = geo.attributes.position, Nn = geo.attributes.normal, Cc = geo.attributes.color;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const base = this.count;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m);
      if (Nn && smooth) n.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize(); else n.set(0, 1, 0);
      const k = Cc ? [Cc.getX(i) * col[0], Cc.getY(i) * col[1], Cc.getZ(i) * col[2]] : col;
      this._v([v.x, v.y, v.z], n.x, n.y, n.z, k);
    }
    if (geo.index) { const ix = geo.index.array; for (let i = 0; i < ix.length; i += 3) this._i3(base + ix[i], base + ix[i + 1], base + ix[i + 2]); }
    else for (let i = 0; i < P.count; i += 3) this._i3(base + i, base + i + 1, base + i + 2);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.array.slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.array.slice(), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.array.slice(), 3, true));
    g.setAttribute('aux', new THREE.BufferAttribute(this.A.array.slice(), 4, true));
    const idx = this.I.array;
    g.setIndex(new THREE.BufferAttribute(this.count < 65536 ? new Uint16Array(idx) : idx.slice(), 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  /**
   * Mesh with int16-quantised positions (uniform scale about the chunk centre, ~2 mm precision for
   * 60 m chunks); the mesh transform restores world coordinates (world-space shading is unaffected).
   */
  toMesh(material) {
    const P = this.P.array;
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) { const v = P[i + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
    const ctr = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 || 1;
    if (ext > 200) { const m = new THREE.Mesh(this.toGeometry(), material); return m; } // too large to quantise well
    const q = new Int16Array(P.length);
    for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) q[i + c] = Math.round(((P[i + c] - ctr[c]) / ext) * 32767);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(q, 3, true));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.array.slice(), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.array.slice(), 3, true));
    g.setAttribute('aux', new THREE.BufferAttribute(this.A.array.slice(), 4, true));
    const idx = this.I.array;
    g.setIndex(new THREE.BufferAttribute(this.count < 65536 ? new Uint16Array(idx) : idx.slice(), 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.position.set(ctr[0], ctr[1], ctr[2]);
    m.scale.setScalar(ext);
    m.updateMatrix(); m.updateMatrixWorld(true);
    return m;
  }
}

/**
 * Builders keyed by material name AND spatial chunk, so huge structures are frustum-culled.
 *   const S = new ChunkedBuilders(64); S.get('ashlar', x, z).quad(...)
 */
export class ChunkedBuilders {
  constructor(cell = 64) { this.cell = cell; this.map = new Map(); }
  get(mat, x = 0, z = 0) {
    const k = `${mat}|${Math.floor(x / this.cell)}|${Math.floor(z / this.cell)}`;
    let b = this.map.get(k);
    if (!b) { b = new GeoBuilder(); b.mat = mat; b.part = 0; this.map.set(k, b); }
    else if (b.count > 60000) {
      // keep each mesh under 65k vertices (16-bit indices); the full builder is retired under a new key
      this.map.set(k + '#' + b.part, b);
      const nb = new GeoBuilder(); nb.mat = mat; nb.part = b.part + 1; nb.aux = b.aux; this.map.set(k, nb); b = nb;
    }
    return b;
  }
  /** → array of meshes; mats = { name: material } */
  meshes(mats, opts = {}) {
    const out = [];
    let tris = 0;
    for (const [k, b] of this.map) {
      if (b.empty) continue;
      const m = mats[b.mat]; if (!m) { console.warn('[acropolis] no material', b.mat); continue; }
      const mesh = b.toMesh(m);
      mesh.name = 'acro:' + k;
      if (opts.noShadowMats && opts.noShadowMats.includes(b.mat)) { mesh.castShadow = false; mesh.userData.castShadow = false; }
      tris += b.tris;
      out.push(mesh);
    }
    this.tris = tris;
    return out;
  }
}

// ------------------------------------------------------------------ frames
/**
 * A local frame: origin o, axes ax (along), ay (up), az (outward). Points in local (s, y, d).
 * Use frameFromDir(x, z, dirX, dirZ) for walls: ax = horizontal wall direction, az = outward normal (right-hand: az = ax × up … we choose outward explicitly).
 */
export class Frame {
  constructor(o, ax, ay, az) { this.o = o; this.ax = ax; this.ay = ay; this.az = az; }
  p(s, y, d) {
    const o = this.o, a = this.ax, b = this.ay, c = this.az;
    return [o[0] + a[0] * s + b[0] * y + c[0] * d, o[1] + a[1] * s + b[1] * y + c[1] * d, o[2] + a[2] * s + b[2] * y + c[2] * d];
  }
  /** rotate the frame about its own up axis (radians) */
  yawed(a) {
    const c = Math.cos(a), s = Math.sin(a);
    const ax = [this.ax[0] * c + this.az[0] * s, this.ax[1] * c + this.az[1] * s, this.ax[2] * c + this.az[2] * s];
    const az = [this.az[0] * c - this.ax[0] * s, this.az[1] * c - this.ax[1] * s, this.az[2] * c - this.ax[2] * s];
    return new Frame(this.o, ax, this.ay, az);
  }
  /** small tilt: rotate ay toward ax by a (roll) and toward az by b (pitch) */
  tilted(a, b) {
    const ay = norm3([this.ay[0] + this.ax[0] * a + this.az[0] * b, this.ay[1] + this.ax[1] * a + this.az[1] * b, this.ay[2] + this.ax[2] * a + this.az[2] * b]);
    const ax = norm3(sub3(this.ax, mul3(ay, dot3(this.ax, ay))));
    const az = cross3(ax, ay);
    // keep handedness of the original
    const sgn = dot3(az, this.az) < 0 ? -1 : 1;
    return new Frame(this.o, ax, ay, mul3(az, sgn));
  }
  at(s, y, d) { return new Frame(this.p(s, y, d), this.ax, this.ay, this.az); }
}
export function frameXZ(x, y, z, dirX, dirZ, outX, outZ) {
  const l = Math.hypot(dirX, dirZ) || 1, lo = Math.hypot(outX, outZ) || 1;
  return new Frame([x, y, z], [dirX / l, 0, dirZ / l], [0, 1, 0], [outX / lo, 0, outZ / lo]);
}
/**
 * frame whose +d axis faces compass heading `deg` (0 = north = -Z). Same handedness as wall frames
 * (cross(ax, ay) = az): for a viewer standing in front of the face, +s runs to the viewer's right.
 */
export function frameFacing(x, y, z, deg) {
  const a = (deg * Math.PI) / 180;
  const fx = Math.sin(a), fz = -Math.cos(a);
  return new Frame([x, y, z], [fz, 0, -fx], [0, 1, 0], [fx, 0, fz]);
}
/** compass heading (deg) of an outward XZ direction */
export function headingOf(nx, nz) { return ((Math.atan2(nx, -nz) * 180) / Math.PI + 360) % 360; }
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ------------------------------------------------------------------ chamfered boxes
const FACE_BITS = { px: 1, nx: 2, py: 4, ny: 8, pz: 16, nz: 32 };
export const FACES = FACE_BITS;
export const ALL_FACES = 63;
/**
 * Chamfered box in frame F over local ranges s∈[x0,x1], y∈[y0,y1], d∈[z0,z1]; chamfer c.
 * mask: which main faces to emit (bits px nx py ny pz nz); edges/corners adjacent to an emitted face are emitted.
 * col: colour, or function(faceName) → colour for per-face shading (e.g. darker chamfers).
 */
export function chamferBox(B, F, x0, x1, y0, y1, z0, z1, c, col, mask = ALL_FACES, chamferCol = null, buried = 0) {
  c = Math.max(0, Math.min(c, (x1 - x0) * 0.45, (y1 - y0) * 0.45, (z1 - z0) * 0.45));
  const X = [x0, x1], Y = [y0, y1], Z = [z0, z1];
  const ins = (v, i, lo, hi) => (i ? hi - c : lo + c);
  const colF = typeof col === 'function' ? col : null;
  if (colF) col = colF(-1, -1);
  const cc = chamferCol || col;
  const fc = (axis, side) => (colF ? colF(axis, side) : col);
  // vertex for corner (i,j,k) on face axis f (0=x,1=y,2=z)
  const V = (i, j, k, f) => {
    const x = f === 0 ? X[i] : ins(0, i, x0, x1);
    const y = f === 1 ? Y[j] : ins(0, j, y0, y1);
    const z = f === 2 ? Z[k] : ins(0, k, z0, z1);
    return F.p(x, y, z);
  };
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const center = F.p(cx, cy, cz);
  const emit = (pts, colr) => {
    // orient outward
    const a = pts[0], b = pts[1], d = pts[2];
    const n = cross3(sub3(b, a), sub3(d, a));
    let mx = 0, my = 0, mz = 0; for (const p of pts) { mx += p[0]; my += p[1]; mz += p[2]; }
    const k = pts.length; const out = [mx / k - center[0], my / k - center[1], mz / k - center[2]];
    if (dot3(n, out) < 0) pts.reverse();
    if (pts.length === 3) B.tri(pts[0], pts[1], pts[2], colr); else B.quad(pts[0], pts[1], pts[2], pts[3], colr);
  };
  const has = (axis, side) => mask & [[2, 1], [8, 4], [32, 16]][axis][side];
  const bur = (axis, side) => buried & [[2, 1], [8, 4], [32, 16]][axis][side];
  // main faces
  for (let side = 0; side < 2; side++) {
    if (has(0, side)) emit([V(side, 0, 0, 0), V(side, 1, 0, 0), V(side, 1, 1, 0), V(side, 0, 1, 0)], fc(0, side));
    if (has(1, side)) emit([V(0, side, 0, 1), V(1, side, 0, 1), V(1, side, 1, 1), V(0, side, 1, 1)], fc(1, side));
    if (has(2, side)) emit([V(0, 0, side, 2), V(1, 0, side, 2), V(1, 1, side, 2), V(0, 1, side, 2)], fc(2, side));
  }
  if (c <= 1e-4) return;
  const auxSave = B.aux;
  B.aux = [Math.max(auxSave[0], B.auxCh[0]), Math.max(auxSave[1], B.auxCh[1]), auxSave[2], auxSave[3]];
  // edges: along z (between x and y faces), along y (x,z), along x (y,z)
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    if ((has(0, i) || has(1, j)) && !bur(0, i) && !bur(1, j)) emit([V(i, j, 0, 0), V(i, j, 1, 0), V(i, j, 1, 1), V(i, j, 0, 1)], cc);
    if ((has(0, i) || has(2, j)) && !bur(0, i) && !bur(2, j)) emit([V(i, 0, j, 0), V(i, 1, j, 0), V(i, 1, j, 2), V(i, 0, j, 2)], cc);
    if ((has(1, i) || has(2, j)) && !bur(1, i) && !bur(2, j)) emit([V(0, i, j, 1), V(1, i, j, 1), V(1, i, j, 2), V(0, i, j, 2)], cc);
  }
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    if ((has(0, i) || has(1, j) || has(2, k)) && !bur(0, i) && !bur(1, j) && !bur(2, k)) emit([V(i, j, k, 0), V(i, j, k, 1), V(i, j, k, 2)], cc);
  }
  B.aux = auxSave;
}

/** plain box (no chamfer) — cheaper */
export function box(B, F, x0, x1, y0, y1, z0, z1, col, mask = ALL_FACES) { chamferBox(B, F, x0, x1, y0, y1, z0, z1, 0, col, mask); }

// ------------------------------------------------------------------ sweeps
/**
 * Sweep a 2D profile [[d, y], ...] (d outward, y up, listed bottom → top) along a straight run of frame F
 * from s0 to s1. Caps optional. Produces faceted mouldings (cornices, plinths, string courses).
 */
export function sweepStraight(B, F, s0, s1, profile, col, caps = true, shade = null) {
  for (let i = 0; i < profile.length - 1; i++) {
    const [d0, y0] = profile[i], [d1, y1] = profile[i + 1];
    const k = shade ? shade(i, profile) : col;
    // quad facing outward (normal roughly +d / +y)
    const a = F.p(s0, y0, d0), b2 = F.p(s1, y0, d0), c = F.p(s1, y1, d1), d = F.p(s0, y1, d1);
    // orientation: outward = +d side or up
    const n = cross3(sub3(b2, a), sub3(d, a));
    const want = [F.az[0] * (y1 - y0) - F.ay[0] * (d1 - d0), F.az[1] * (y1 - y0) - F.ay[1] * (d1 - d0), F.az[2] * (y1 - y0) - F.ay[2] * (d1 - d0)];
    if (dot3(n, want) >= 0) B.quad(a, b2, c, d, k); else B.quad(a, d, c, b2, k);
  }
  if (caps) {
    // end caps: polygon between profile and the back plane (d = min d)
    const dBack = Math.min(...profile.map((p) => p[0]));
    for (const [s, sign] of [[s0, -1], [s1, 1]]) {
      for (let i = 0; i < profile.length - 1; i++) {
        const [d0, y0] = profile[i], [d1, y1] = profile[i + 1];
        const pts = [F.p(s, y0, dBack), F.p(s, y0, d0), F.p(s, y1, d1), F.p(s, y1, dBack)];
        const n = cross3(sub3(pts[1], pts[0]), sub3(pts[3], pts[0]));
        const want = mul3(F.ax, sign);
        if (dot3(n, want) < 0) pts.reverse();
        B.quad(pts[0], pts[1], pts[2], pts[3], col);
      }
    }
  }
}

/** lathe geometry from a profile [[r, y], ...] — smooth normals */
export function latheGeo(profile, segs = 12) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  const g = new THREE.LatheGeometry(pts, segs);
  g.computeVertexNormals();
  return g;
}

/** polyline helpers (2D, [x,z]) */
export function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
export function resample(pts, step) {
  const out = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i]; const l = Math.hypot(bx - ax, bz - az);
    let t = step - acc;
    while (t <= l) { out.push([ax + (bx - ax) * (t / l), az + (bz - az) * (t / l)]); t += step; }
    acc = l - (t - step);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > step * 0.3) out.push(last);
  return out;
}
/** Douglas–Peucker simplification */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const f = pts[0], l = pts[pts.length - 1];
  if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) {
    // closed loop: split at the farthest point so DP has a proper baseline
    let bi = 1, bd = -1;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - f[0], pts[i][1] - f[1]); if (d > bd) { bd = d; bi = i; } }
    const a = simplify(pts.slice(0, bi + 1), tol), b = simplify(pts.slice(bi), tol);
    return a.concat(b.slice(1));
  }
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * ez - (pts[i][1] - az) * ex) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
