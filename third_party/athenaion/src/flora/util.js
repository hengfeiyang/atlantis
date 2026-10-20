// Shared geometry helpers for the flora library (olive branches, ivy, grass, flowers, rocks).
// Everything is built into plain growable typed buffers and turned into a BufferGeometry at the end,
// so hundreds of thousands of leaves can be generated quickly without per-object overhead.
import * as THREE from 'three';

const V = THREE.Vector3;

/** Growable buffer of vertex attributes + triangle indices. */
export class GeoBuilder {
  /** @param {{color?:boolean, sway?:boolean, extra?:Object<string,number>}} o */
  constructor({ color = true, sway = true, extra = {} } = {}) {
    this.cap = 4096;
    this.n = 0;
    this.pos = new Float32Array(this.cap * 3);
    this.uv = new Float32Array(this.cap * 2);
    this.col = color ? new Float32Array(this.cap * 3) : null;
    this.ao = color ? new Float32Array(this.cap).fill(1) : null; // per-vertex ambient occlusion (colour alpha byte)
    this.sw = sway ? new Float32Array(this.cap) : null;
    this.extra = {};
    for (const [k, size] of Object.entries(extra)) this.extra[k] = { size, arr: new Float32Array(this.cap * size) };
    this.idx = [];
    this.icap = 8192; this.ni = 0; this.ind = new Uint32Array(this.icap);
    // "current" per-vertex values (set before calling v())
    this.c = [1, 1, 1];
    this.a = 1;
    this.s = 0;
    this.e = {};
  }
  _grow() {
    const nc = this.cap * 2;
    const g = (a, k) => { const b = new Float32Array(nc * k); b.set(a); return b; };
    this.pos = g(this.pos, 3); this.uv = g(this.uv, 2);
    if (this.col) { this.col = g(this.col, 3); const a = new Float32Array(nc).fill(1); a.set(this.ao); this.ao = a; }
    if (this.sw) this.sw = g(this.sw, 1);
    for (const x of Object.values(this.extra)) x.arr = g(x.arr, x.size);
    this.cap = nc;
  }
  /** add vertex; returns its index */
  v(x, y, z, u = 0, w = 0) {
    if (this.n >= this.cap) this._grow();
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = w;
    if (this.col) { this.col[i * 3] = this.c[0]; this.col[i * 3 + 1] = this.c[1]; this.col[i * 3 + 2] = this.c[2]; this.ao[i] = this.a; }
    if (this.sw) this.sw[i] = this.s;
    for (const [k, x] of Object.entries(this.extra)) {
      const val = this.e[k];
      if (x.size === 1) x.arr[i] = val ?? 0;
      else for (let j = 0; j < x.size; j++) x.arr[i * x.size + j] = val ? val[j] : 0;
    }
    return i;
  }
  vv(p, u = 0, w = 0) { return this.v(p.x, p.y, p.z, u, w); }
  tri(a, b, c) {
    if (this.ni + 3 > this.icap) { const nb = new Uint32Array(this.icap * 2); nb.set(this.ind); this.ind = nb; this.icap *= 2; }
    this.ind[this.ni++] = a; this.ind[this.ni++] = b; this.ind[this.ni++] = c;
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  get triCount() { return this.ni / 3; }
  /** set the AO (colour alpha) of vertices [from, to) */
  setAO(from, to, a) { if (this.ao) for (let i = from; i < to; i++) this.ao[i] = a; }

  /**
   * Build the BufferGeometry (smooth normals over shared vertices). Compact GPU layout (~25 B/vertex):
   * normal int8x4, uv uint16x2, colour uint8x4 storing colour/2 (shaders multiply by FLORA_COLOR_SCALE = 2),
   * aSway uint8 storing sway/0.1 m (shaders multiply by 0.1).
   */
  toGeometry({ normals = true } = {}) {
    const g = new THREE.BufferGeometry();
    const n = this.n;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    const ind = this.ind.slice(0, this.ni);
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? ind : new Uint16Array(ind), 1));
    if (normals) {
      g.computeVertexNormals();
      const nf = g.attributes.normal.array, nb = new Int8Array(n * 4);
      for (let i = 0; i < n; i++) { nb[i * 4] = Math.round(nf[i * 3] * 127); nb[i * 4 + 1] = Math.round(nf[i * 3 + 1] * 127); nb[i * 4 + 2] = Math.round(nf[i * 3 + 2] * 127); }
      g.setAttribute('normal', new THREE.BufferAttribute(nb, 4, true));
    }
    const uv = new Uint16Array(n * 2);
    for (let i = 0; i < n * 2; i++) uv[i] = Math.round(Math.min(1, Math.max(0, this.uv[i])) * 65535);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2, true));
    if (this.col) {
      const c = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) c[i * 4 + k] = Math.round(Math.min(1, Math.max(0, this.col[i * 3 + k] * 0.5)) * 255); c[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, this.ao[i])) * 255); }
      g.setAttribute('color', new THREE.BufferAttribute(c, 4, true));
      g.userData.colorItem4 = true;
    }
    if (this.sw) {
      const w = new Uint8Array(n);
      for (let i = 0; i < n; i++) w[i] = Math.round(Math.min(1, Math.max(0, this.sw[i] * 10)) * 255);
      g.setAttribute('aSway', new THREE.BufferAttribute(w, 1, true));
    }
    for (const [k, x] of Object.entries(this.extra)) g.setAttribute(k, new THREE.BufferAttribute(x.arr.slice(0, n * x.size), x.size));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Parallel-transport frames along a polyline of THREE.Vector3. Returns [{t, n, b}] */
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
      // rotate previous normal by the rotation taking prevT to t
      const axis = new V().crossVectors(prevT, t);
      const s = axis.length();
      if (s > 1e-6) {
        axis.divideScalar(s);
        const ang = Math.acos(THREE.MathUtils.clamp(prevT.dot(t), -1, 1));
        n = n.clone().applyAxisAngle(axis, ang);
      } else n = n.clone();
    }
    const bn = new V().crossVectors(t, n).normalize();
    out.push({ t, n: n.clone(), b: bn });
    prevT = t;
  }
  return out;
}

/**
 * Tapered tube along a polyline (branches, vines, stems).
 * @param {GeoBuilder} B
 * @param {THREE.Vector3[]} pts
 * @param {number[]|function} radius  per-point radius or fn(t)
 * @param {number} radial  radial segments
 * @param {object} o  {sway:fn(t)->float, vScale: uv v per metre, cap: bool, rough: fn(i,j)->radius mult}
 */
export function tube(B, pts, radius, radial = 6, o = {}) {
  const F = frames(pts);
  const N = pts.length;
  let len = 0;
  const base = B.n;
  for (let i = 0; i < N; i++) {
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    const t = i / (N - 1);
    const r = typeof radius === 'function' ? radius(t, i) : typeof radius === 'number' ? radius : radius[i];
    if (o.sway) B.s = o.sway(t);
    const { n, b } = F[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rr = r * (o.rough ? o.rough(i, j % radial) : 1);
      B.v(pts[i].x + (n.x * ca + b.x * sa) * rr, pts[i].y + (n.y * ca + b.y * sa) * rr, pts[i].z + (n.z * ca + b.z * sa) * rr,
        j / radial, len * (o.vScale ?? 1));
    }
  }
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j, b = a + radial + 1;
      B.tri(a, a + 1, b); B.tri(a + 1, b + 1, b);
    }
  }
  if (o.cap) {
    // pointed end cap
    const last = pts[N - 1], tdir = F[N - 1].t;
    const r = typeof radius === 'function' ? radius(1, N - 1) : typeof radius === 'number' ? radius : radius[N - 1];
    const tip = B.v(last.x + tdir.x * r * 1.5, last.y + tdir.y * r * 1.5, last.z + tdir.z * r * 1.5, 0.5, len * (o.vScale ?? 1));
    const ring = base + (N - 1) * (radial + 1);
    for (let j = 0; j < radial; j++) B.tri(ring + j, ring + j + 1, tip);
  }
  return len;
}

/** Camera frame from a shot ({pos,target,fov}) at a given aspect. */
export function shotFrame(shot, aspect = 1672 / 941) {
  const pos = new V(...shot.pos), target = new V(...shot.target);
  const fwd = new V().subVectors(target, pos).normalize();
  const right = new V().crossVectors(fwd, new V(0, 1, 0)).normalize();
  const up = new V().crossVectors(right, fwd).normalize();
  const tanV = Math.tan(((shot.fov ?? 40) * Math.PI) / 360), tanH = tanV * aspect;
  /** world point at screen NDC (x,y in [-1,1]) and view depth d (metres along fwd) */
  const at = (x, y, d) => pos.clone().addScaledVector(fwd, d).addScaledVector(right, x * tanH * d).addScaledVector(up, y * tanV * d);
  /** world-space direction from screen-plane components (dx right, dy up, dz forward) */
  const dir = (dx, dy, dz) => new V().addScaledVector(right, dx).addScaledVector(up, dy).addScaledVector(fwd, dz).normalize();
  /** project a world point → {x, y (NDC), d (depth)} */
  const project = (p) => {
    const r = new V().subVectors(p, pos);
    const d = r.dot(fwd);
    return { x: r.dot(right) / (d * tanH), y: r.dot(up) / (d * tanV), d };
  };
  return { pos, target, fwd, right, up, tanV, tanH, at, dir, project };
}

/** rotate vector v around axis by angle (returns new vector) */
export function rot(v, axis, ang) { return v.clone().applyAxisAngle(axis, ang); }

/** any unit vector perpendicular to v */
export function perp(v) {
  const r = Math.abs(v.y) < 0.95 ? new V(0, 1, 0) : new V(1, 0, 0);
  return new V().crossVectors(v, r).normalize();
}

/** sRGB hex → linear [r,g,b] */
export function lin(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }
export function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export function mulc(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
