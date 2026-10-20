// Geometry helpers for the marine library (corals, kelp, sea grass, fauna).
// adapted from athenaion/src/flora/util.js (GeoBuilder, parallel-transport frames, tubes) — simplified layout:
//   position f32x3, normal f32x3 (computed), uv f32x2, color f32x3 (LINEAR albedo, multiplied by instanceColor),
//   aM f32x4: x = ambient occlusion, y = sway weight (m of displacement at full current), z = "tip" factor
//   (0 base .. 1 growing tip, used for colour / glow), w = free (kind specific: height along a kelp stipe, ...)
import * as THREE from 'three';

const V = THREE.Vector3;

export class GeoBuilder {
  constructor() {
    this.cap = 4096; this.n = 0;
    this.pos = new Float32Array(this.cap * 3);
    this.uv = new Float32Array(this.cap * 2);
    this.col = new Float32Array(this.cap * 3);
    this.m = new Float32Array(this.cap * 4);
    this.icap = 8192; this.ni = 0; this.ind = new Uint32Array(this.icap);
    this.c = [1, 1, 1];   // current colour
    this.a = 1;           // current AO
    this.s = 0;           // current sway weight
    this.t = 0;           // current tip factor
    this.w = 0;           // current free channel
  }
  _grow() {
    const nc = this.cap * 2;
    const g = (a, k) => { const b = new Float32Array(nc * k); b.set(a); return b; };
    this.pos = g(this.pos, 3); this.uv = g(this.uv, 2); this.col = g(this.col, 3); this.m = g(this.m, 4);
    this.cap = nc;
  }
  v(x, y, z, u = 0, w = 0) {
    if (this.n >= this.cap) this._grow();
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = w;
    this.col[i * 3] = this.c[0]; this.col[i * 3 + 1] = this.c[1]; this.col[i * 3 + 2] = this.c[2];
    this.m[i * 4] = this.a; this.m[i * 4 + 1] = this.s; this.m[i * 4 + 2] = this.t; this.m[i * 4 + 3] = this.w;
    return i;
  }
  vv(p, u = 0, w = 0) { return this.v(p.x, p.y, p.z, u, w); }
  tri(a, b, c) {
    if (this.ni + 3 > this.icap) { const nb = new Uint32Array(this.icap * 2); nb.set(this.ind); this.ind = nb; this.icap *= 2; }
    this.ind[this.ni++] = a; this.ind[this.ni++] = b; this.ind[this.ni++] = c;
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  get triCount() { return this.ni / 3; }
  /** append a THREE.BufferGeometry (non-indexed or indexed) transformed by matrix m4 with the current attrs */
  addGeometry(geo, m4, colFn = null) {
    const p = geo.attributes.position, uv = geo.attributes.uv;
    const base = this.n, v = new V();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m4);
      if (colFn) colFn(this, i, v);
      this.v(v.x, v.y, v.z, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i += 3) this.tri(base + geo.index.getX(i), base + geo.index.getX(i + 1), base + geo.index.getX(i + 2));
    else for (let i = 0; i < p.count; i += 3) this.tri(base + i, base + i + 1, base + i + 2);
  }
  toGeometry({ normals = true } = {}) {
    const g = new THREE.BufferGeometry(), n = this.n;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 3), 3));
    g.setAttribute('aM', new THREE.BufferAttribute(this.m.slice(0, n * 4), 4));
    const ind = this.ind.slice(0, this.ni);
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? ind : new Uint16Array(ind), 1));
    if (normals) g.computeVertexNormals();
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** parallel-transport frames along a polyline */
export function frames(pts) {
  const out = [];
  let prevT = null, n = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const t = new V().subVectors(b, a).normalize();
    if (!n) {
      const ref = Math.abs(t.y) < 0.9 ? new V(0, 1, 0) : new V(1, 0, 0);
      n = new V().crossVectors(t, ref).normalize();
    } else {
      const axis = new V().crossVectors(prevT, t);
      const s = axis.length();
      if (s > 1e-6) { axis.divideScalar(s); n = n.clone().applyAxisAngle(axis, Math.acos(THREE.MathUtils.clamp(prevT.dot(t), -1, 1))); }
      else n = n.clone();
    }
    out.push({ t, n: n.clone(), b: new V().crossVectors(t, n).normalize() });
    prevT = t;
  }
  return out;
}

/**
 * Tapered tube along a polyline.
 * o: {radial, cap:'none'|'point'|'round'|'open', attr: fn(t, i) called before each ring (set B.c/B.a/B.s/B.t), rough: fn(i,j)->mult, vScale}
 */
export function tube(B, pts, radius, o = {}) {
  const radial = o.radial ?? 6;
  const F = frames(pts), N = pts.length;
  let len = 0;
  const base = B.n;
  for (let i = 0; i < N; i++) {
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    const t = i / (N - 1);
    const r = typeof radius === 'function' ? radius(t, i) : typeof radius === 'number' ? radius : radius[i];
    if (o.attr) o.attr(t, i);
    const { n, b } = F[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const rr = r * (o.rough ? o.rough(i, j % radial) : 1);
      B.v(pts[i].x + (n.x * ca + b.x * sa) * rr, pts[i].y + (n.y * ca + b.y * sa) * rr, pts[i].z + (n.z * ca + b.z * sa) * rr, j / radial, len * (o.vScale ?? 1));
    }
  }
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < radial; j++) {
    const a = base + i * (radial + 1) + j, b = a + radial + 1;
    B.tri(a, a + 1, b); B.tri(a + 1, b + 1, b);
  }
  const cap = o.cap ?? 'point';
  if (cap === 'point' || cap === 'round') {
    const last = pts[N - 1], td = F[N - 1].t;
    const r = typeof radius === 'function' ? radius(1, N - 1) : typeof radius === 'number' ? radius : radius[N - 1];
    if (o.attr) o.attr(1, N);
    const k = cap === 'round' ? 0.9 : 1.6;
    const tip = B.v(last.x + td.x * r * k, last.y + td.y * r * k, last.z + td.z * r * k, 0.5, len * (o.vScale ?? 1));
    const ring = base + (N - 1) * (radial + 1);
    for (let j = 0; j < radial; j++) B.tri(ring + j, ring + j + 1, tip);
  }
  return len;
}

export function perp(v) {
  const r = Math.abs(v.y) < 0.95 ? new V(0, 1, 0) : new V(1, 0, 0);
  return new V().crossVectors(v, r).normalize();
}

/** sRGB 0-255 → linear */
export const lin = (r, g, b) => [Math.pow(r / 255, 2.2), Math.pow(g / 255, 2.2), Math.pow(b / 255, 2.2)];
export const scaleC = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** curved polyline from a start, initial direction, with gravitropism / random walk */
export function growPath(rng, start, dir, len, segs, { up = 0.0, wander = 0.15, gravity = 0 } = {}) {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const dl = len / segs;
  let p = start.clone();
  for (let i = 0; i < segs; i++) {
    d.x += rng.range(-wander, wander); d.y += rng.range(-wander, wander) * 0.6 + up - gravity; d.z += rng.range(-wander, wander);
    d.normalize();
    p = p.clone().addScaledVector(d, dl);
    pts.push(p);
  }
  return pts;
}
