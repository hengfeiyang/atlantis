// Geometry accumulator for ships: indexed vertices with custom attributes, flat quads, smooth grids and
// smooth tubes (spars, posts, oars, ropes). adapted from athenaion/src/city/geobuilder.js + ships.js helpers.
// Ship attributes (see mats.js): aW = (u, v, seed, kind), aX = (local y / extra, side, -, -).
import * as THREE from 'three';

class Grow {
  constructor(n = 4096, T = Float32Array) { this.T = T; this.a = new T(n); this.n = 0; }
  ensure(k) {
    if (this.n + k <= this.a.length) return;
    let m = this.a.length * 2; while (m < this.n + k) m *= 2;
    const b = new this.T(m); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
}

export const SHIP_ATTRS = { aW: 4, aX: 4 };
export const SAIL_ATTRS = { aSail: 4, aSailSize: 2 };

export class GeoBuilder {
  constructor(attrs = SHIP_ATTRS) {
    this.defs = attrs;
    this.pos = new Grow(); this.nrm = new Grow();
    this.at = {}; for (const k in attrs) this.at[k] = new Grow();
    this.idx = new Grow(8192, Uint32Array);
    this.vc = 0;
    this.cur = {}; for (const k in attrs) this.cur[k] = new Array(attrs[k]).fill(0);
  }
  get triangles() { return this.idx.n / 3; }
  get empty() { return this.idx.n === 0; }
  set(name, v) { this.cur[name] = v; return this; }
  vert(p, n, av) {
    this.pos.ensure(3); this.nrm.ensure(3);
    const P = this.pos.a, N = this.nrm.a;
    P[this.pos.n++] = p[0]; P[this.pos.n++] = p[1]; P[this.pos.n++] = p[2];
    N[this.nrm.n++] = n[0]; N[this.nrm.n++] = n[1]; N[this.nrm.n++] = n[2];
    for (const k in this.defs) {
      const v = (av && av[k]) || this.cur[k], g = this.at[k], s = this.defs[k];
      g.ensure(s); for (let i = 0; i < s; i++) g.a[g.n++] = v[i] ?? 0;
    }
    return this.vc++;
  }
  tri(a, b, c) { this.idx.ensure(3); const I = this.idx.a; I[this.idx.n++] = a; I[this.idx.n++] = b; I[this.idx.n++] = c; }
  /** flat quad p0..p3 (CCW seen from the front); per = { attr: [v0..v3] } */
  quad(p0, p1, p2, p3, n, per) {
    if (!n) n = faceNormal(p0, p1, p2);
    const i0 = this.vert(p0, n, per && pick(per, 0)), i1 = this.vert(p1, n, per && pick(per, 1));
    const i2 = this.vert(p2, n, per && pick(per, 2)), i3 = this.vert(p3, n, per && pick(per, 3));
    this.tri(i0, i1, i2); this.tri(i0, i2, i3);
  }
  /**
   * Smooth grid of shared vertices: P[i][j] positions (i rows along, j across), attr(i, j) → {aW, aX}.
   * Normals from the grid topology (cross of the i / j tangents); `flip` reverses the winding.
   */
  grid(P, attr, flip = false) {
    const ni = P.length, nj = P[0].length, base = this.vc;
    for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
      const a = P[Math.max(0, i - 1)][j], b = P[Math.min(ni - 1, i + 1)][j];
      const c = P[i][Math.max(0, j - 1)], d = P[i][Math.min(nj - 1, j + 1)];
      const ti = sub(b, a), tj = sub(d, c);
      let n = cross(ti, tj); if (flip) n = [-n[0], -n[1], -n[2]];
      this.vert(P[i][j], norm(n), attr ? attr(i, j) : null);
    }
    for (let i = 0; i < ni - 1; i++) for (let j = 0; j < nj - 1; j++) {
      const a = base + i * nj + j, b = base + (i + 1) * nj + j, c = b + 1, d = a + 1;
      if (flip) { this.tri(a, c, b); this.tri(a, d, c); } else { this.tri(a, b, c); this.tri(a, c, d); }
    }
  }
  /**
   * Smooth tube along a polyline. r: number | (t) → radius | (t) → [rx, ry] (elliptic, rx across the
   * side vector). attr(t, k) → {aW, aX}. caps: close the ends with flat fans.
   */
  tube(pts, r, sides, attr, { caps = false, up = null } = {}) {
    const n = pts.length; if (n < 2) return;
    // cumulative length
    const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
    const total = cum[n - 1] || 1;
    // parallel-transport frames
    const T = pts.map((p, i) => norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
    let ref = up || (Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    let S = norm(cross(T[0], ref)), U = cross(S, T[0]);
    const frames = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) { S = norm(cross(T[i], U)); U = cross(S, T[i]); }
      frames.push([S, U]);
    }
    const base = this.vc;
    for (let i = 0; i < n; i++) {
      const t = cum[i] / total, [S2, U2] = frames[i];
      let rr = typeof r === 'function' ? r(t, i) : r; if (!Array.isArray(rr)) rr = [rr, rr];
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const o = [S2[0] * ca * rr[0] + U2[0] * sa * rr[1], S2[1] * ca * rr[0] + U2[1] * sa * rr[1], S2[2] * ca * rr[0] + U2[2] * sa * rr[1]];
        const nn = norm([S2[0] * ca * rr[1] + U2[0] * sa * rr[0], S2[1] * ca * rr[1] + U2[1] * sa * rr[0], S2[2] * ca * rr[1] + U2[2] * sa * rr[0]]);
        this.vert([pts[i][0] + o[0], pts[i][1] + o[1], pts[i][2] + o[2]], nn, attr ? attr(cum[i], k / sides) : null);
      }
    }
    const ring = sides + 1;
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) {
      const a = base + i * ring + k, b = a + ring, c = b + 1, d = a + 1;
      this.tri(a, b, c); this.tri(a, c, d);
    }
    if (caps) for (const [i, s] of [[0, -1], [n - 1, 1]]) {
      const tn = s > 0 ? T[i] : T[i].map((v) => -v);
      const c0 = this.vert(pts[i], tn, attr ? attr(cum[i], 0) : null);
      const first = this.vc;
      for (let k = 0; k <= sides; k++) {
        const p = [this.pos.a[(base + i * ring + k) * 3], this.pos.a[(base + i * ring + k) * 3 + 1], this.pos.a[(base + i * ring + k) * 3 + 2]];
        this.vert(p, tn, attr ? attr(cum[i], k / sides) : null);
      }
      for (let k = 0; k < sides; k++) { if (s > 0) this.tri(c0, first + k + 1, first + k); else this.tri(c0, first + k, first + k + 1); }
    }
  }
  /** oriented box: centre c, axes ex, ey, ez (half extents baked into the vectors) */
  obox(c, ex, ey, ez, attr) {
    const P = (sx, sy, sz) => [c[0] + ex[0] * sx + ey[0] * sy + ez[0] * sz, c[1] + ex[1] * sx + ey[1] * sy + ez[1] * sz, c[2] + ex[2] * sx + ey[2] * sy + ez[2] * sz];
    const F = [
      [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)],
      [P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), P(-1, -1, -1)],
      [P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)],
      [P(-1, -1, 1), P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1)],
      [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
      [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)],
    ];
    const cen = c;
    for (const q of F) {
      let n = faceNormal(q[0], q[1], q[2]);
      const m = [(q[0][0] + q[2][0]) / 2 - cen[0], (q[0][1] + q[2][1]) / 2 - cen[1], (q[0][2] + q[2][2]) / 2 - cen[2]];
      if (dot(n, m) < 0) { q.reverse(); n = n.map((v) => -v); }
      const per = attr ? { aW: q.map((p) => attr(p).aW), aX: q.map((p) => attr(p).aX || [0, 0, 0, 0]) } : null;
      this.quad(q[0], q[1], q[2], q[3], n, per);
    }
  }
  /** box between two points with a square-ish section (w across, h up) */
  beam(p, q, w, h, attr, upHint = [0, 1, 0]) {
    const d = sub(q, p), L = len(d) || 1, t = d.map((v) => v / L);
    let s = cross(t, upHint); if (len(s) < 1e-4) s = cross(t, [1, 0, 0]); s = norm(s);
    const u = cross(s, t);
    const c = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    this.obox(c, s.map((v) => v * w / 2), u.map((v) => v * h / 2), t.map((v) => v * L / 2), attr);
  }
  /** append a geometry transformed by m; attrs taken from the geometry or constAttrs */
  addGeometry(geo, m, constAttrs) {
    const p = geo.attributes.position, nn = geo.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const base = this.vc;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      if (nn) w.fromBufferAttribute(nn, i).applyMatrix3(nm).normalize(); else w.set(0, 1, 0);
      const av = {};
      for (const k in this.defs) {
        if (constAttrs && constAttrs[k]) av[k] = typeof constAttrs[k] === 'function' ? constAttrs[k](i, v, w) : constAttrs[k];
        else if (geo.attributes[k]) { const A = geo.attributes[k]; av[k] = Array.from({ length: this.defs[k] }, (_, j) => A.array[i * A.itemSize + j]); }
      }
      this.vert([v.x, v.y, v.z], [w.x, w.y, w.z], av);
    }
    if (geo.index) { const ix = geo.index.array; for (let i = 0; i < ix.length; i += 3) this.tri(base + ix[i], base + ix[i + 1], base + ix[i + 2]); }
    else for (let i = 0; i < p.count; i += 3) this.tri(base + i, base + i + 1, base + i + 2);
  }
  /** merge another builder (same attrs), transformed by matrix m (THREE.Matrix4) */
  merge(b, m) { if (!b.empty) this.addGeometry(b.toGeometry(), m || new THREE.Matrix4()); }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.a.slice(0, this.pos.n), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.a.slice(0, this.nrm.n), 3));
    for (const k in this.defs) g.setAttribute(k, new THREE.BufferAttribute(this.at[k].a.slice(0, this.at[k].n), this.defs[k]));
    const ix = this.idx.a.slice(0, this.idx.n);
    g.setIndex(new THREE.BufferAttribute(this.vc < 65535 ? new Uint16Array(ix) : ix, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

function pick(per, i) { const o = {}; for (const k in per) o[k] = per[k][i]; return o; }
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export function faceNormal(a, b, c) { return norm(cross(sub(b, a), sub(c, a))); }
/** quadratic / cubic Bezier sampling */
export function bezier(P, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let pts = P.map((p) => p.slice());
    while (pts.length > 1) { const q = []; for (let k = 0; k < pts.length - 1; k++) q.push(lerp3(pts[k], pts[k + 1], t)); pts = q; }
    out.push(pts[0]);
  }
  return out;
}
