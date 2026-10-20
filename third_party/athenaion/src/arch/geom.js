// Geometry core for the architecture kit.
// MeshBuilder accumulates indexed triangles with position / normal / aux (vec4) attributes:
//   aux.x = cavity (grime, AO)   aux.y = edge wear   aux.z = streak source   aux.w = flags
// All primitives write in the builder's current transform (push/pop/translate/rotate/scale),
// so generators can be written in local coordinates.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3();

class Grow {
  constructor(n = 4096, T = Float32Array) { this.T = T; this.a = new T(n); this.n = 0; }
  ensure(k) { if (this.n + k > this.a.length) { let L = this.a.length * 2; while (L < this.n + k) L *= 2; const b = new this.T(L); b.set(this.a); this.a = b; } }
  get array() { return this.a.subarray(0, this.n); }
}

export class MeshBuilder {
  constructor() {
    this.P = new Grow(); this.N = new Grow(); this.A = new Grow(); this.I = new Grow(4096, Uint32Array);
    this.count = 0;
    this.m = new THREE.Matrix4();
    this.nm = new THREE.Matrix3();
    this.stack = [];
    this.auxDefault = [0, 0, 0, 0];
    this.identity = true;
    this.flip = false;
  }
  get triangles() { return this.I.n / 3; }
  get empty() { return this.I.n === 0; }
  // ---------------------------------------------------------------- transform stack
  push() { this.stack.push([this.m.clone(), this.auxDefault.slice()]); return this; }
  pop() { const [m, a] = this.stack.pop(); this.m.copy(m); this.auxDefault = a; this._upd(); return this; }
  _upd() { this.nm.getNormalMatrix(this.m); this.identity = false; this.flip = this.m.determinant() < 0; }
  apply(mat4) { this.m.multiply(mat4); this._upd(); return this; }
  translate(x, y, z) { this.m.multiply(new THREE.Matrix4().makeTranslation(x, y, z)); this._upd(); return this; }
  rotateY(a) { this.m.multiply(new THREE.Matrix4().makeRotationY(a)); this._upd(); return this; }
  rotateX(a) { this.m.multiply(new THREE.Matrix4().makeRotationX(a)); this._upd(); return this; }
  rotateZ(a) { this.m.multiply(new THREE.Matrix4().makeRotationZ(a)); this._upd(); return this; }
  scale(x, y = x, z = x) { this.m.multiply(new THREE.Matrix4().makeScale(x, y, z)); this._upd(); return this; }
  setAux(a) { this.auxDefault = a.slice(); return this; }
  // ---------------------------------------------------------------- raw
  /** add vertex (local coords, transformed by the current matrix); aux optional [4] */
  v(x, y, z, nx, ny, nz, aux) {
    _v.set(x, y, z).applyMatrix4(this.m);
    _n.set(nx, ny, nz).applyMatrix3(this.nm).normalize();
    const P = this.P, N = this.N, A = this.A;
    P.ensure(3); N.ensure(3); A.ensure(4);
    P.a[P.n++] = _v.x; P.a[P.n++] = _v.y; P.a[P.n++] = _v.z;
    N.a[N.n++] = _n.x; N.a[N.n++] = _n.y; N.a[N.n++] = _n.z;
    const a = aux || this.auxDefault;
    A.a[A.n++] = a[0]; A.a[A.n++] = a[1]; A.a[A.n++] = a[2]; A.a[A.n++] = a[3] ?? 0;
    return this.count++;
  }
  t(a, b, c) { const I = this.I; I.ensure(3); if (this.flip) { I.a[I.n++] = a; I.a[I.n++] = c; I.a[I.n++] = b; } else { I.a[I.n++] = a; I.a[I.n++] = b; I.a[I.n++] = c; } }
  q(a, b, c, d) { this.t(a, b, c); this.t(a, c, d); }
  /** flat quad from 4 points (CCW seen from the front) */
  quadP(p0, p1, p2, p3, aux) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const wx = p3[0] - p0[0], wy = p3[1] - p0[1], wz = p3[2] - p0[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const a = this.v(...p0, nx, ny, nz, aux), b = this.v(...p1, nx, ny, nz, aux), c = this.v(...p2, nx, ny, nz, aux), d = this.v(...p3, nx, ny, nz, aux);
    this.q(a, b, c, d);
  }
  triP(p0, p1, p2, aux) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const wx = p2[0] - p0[0], wy = p2[1] - p0[1], wz = p2[2] - p0[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.t(this.v(...p0, nx, ny, nz, aux), this.v(...p1, nx, ny, nz, aux), this.v(...p2, nx, ny, nz, aux));
  }
  /** append another builder / BufferGeometry, transformed by the current matrix (× optional extra matrix) */
  merge(src, extra = null, auxOverride = null) {
    let pos, nrm, aux, idx;
    if (src instanceof MeshBuilder) { pos = src.P.array; nrm = src.N.array; aux = src.A.array; idx = src.I.array; }
    else {
      pos = src.attributes.position.array; nrm = src.attributes.normal?.array; aux = src.attributes.aux?.array;
      idx = src.index ? src.index.array : null;
    }
    const m = extra ? this.m.clone().multiply(extra) : this.m;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const base = this.count, nv = pos.length / 3;
    const P = this.P, N = this.N, A = this.A;
    P.ensure(nv * 3); N.ensure(nv * 3); A.ensure(nv * 4);
    const e = m.elements, ne = nm.elements;
    for (let i = 0; i < nv; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      P.a[P.n++] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P.a[P.n++] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P.a[P.n++] = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (nrm) {
        const a = nrm[i * 3], b = nrm[i * 3 + 1], c = nrm[i * 3 + 2];
        let nx = ne[0] * a + ne[3] * b + ne[6] * c, ny = ne[1] * a + ne[4] * b + ne[7] * c, nz = ne[2] * a + ne[5] * b + ne[8] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        N.a[N.n++] = nx / l; N.a[N.n++] = ny / l; N.a[N.n++] = nz / l;
      } else { N.a[N.n++] = 0; N.a[N.n++] = 1; N.a[N.n++] = 0; }
      if (auxOverride) { A.a[A.n++] = auxOverride[0]; A.a[A.n++] = auxOverride[1]; A.a[A.n++] = auxOverride[2]; A.a[A.n++] = auxOverride[3] ?? 0; }
      else if (aux) { A.a[A.n++] = aux[i * 4]; A.a[A.n++] = aux[i * 4 + 1]; A.a[A.n++] = aux[i * 4 + 2]; A.a[A.n++] = aux[i * 4 + 3]; }
      else { const d = this.auxDefault; A.a[A.n++] = d[0]; A.a[A.n++] = d[1]; A.a[A.n++] = d[2]; A.a[A.n++] = d[3]; }
    }
    // mirrored transforms flip winding
    const flip = m.determinant() < 0;
    const I = this.I;
    if (idx) {
      I.ensure(idx.length);
      for (let i = 0; i < idx.length; i += 3) {
        if (flip) { I.a[I.n++] = idx[i] + base; I.a[I.n++] = idx[i + 2] + base; I.a[I.n++] = idx[i + 1] + base; }
        else { I.a[I.n++] = idx[i] + base; I.a[I.n++] = idx[i + 1] + base; I.a[I.n++] = idx[i + 2] + base; }
      }
    } else {
      I.ensure(nv);
      for (let i = 0; i < nv; i += 3) {
        if (flip) { I.a[I.n++] = base + i; I.a[I.n++] = base + i + 2; I.a[I.n++] = base + i + 1; }
        else { I.a[I.n++] = base + i; I.a[I.n++] = base + i + 1; I.a[I.n++] = base + i + 2; }
      }
    }
    this.count += nv;
    return this;
  }
  /** BufferGeometry with position, normal, aux, index */
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.array.slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.array.slice(), 3));
    g.setAttribute('aux', new THREE.BufferAttribute(this.A.array.slice(), 4));
    const idx = this.I.array;
    g.setIndex(new THREE.BufferAttribute(this.count < 65535 ? new Uint16Array(idx) : idx.slice(), 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

// ======================================================================== primitives
/**
 * Chamfered box. min/max in local coords. bevel = chamfer size (m). aux = base aux;
 * chamfer faces get aux.y (edge) = 1. faces: optional {top,bottom,px,nx,pz,nz:false} to skip faces.
 */
export function box(mb, min, max, bevel = 0, aux = null, faces = null) {
  const a = aux || mb.auxDefault;
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const b = Math.min(bevel, (x1 - x0) * 0.45, (y1 - y0) * 0.45, (z1 - z0) * 0.45);
  const F = faces || {};
  if (b <= 1e-5) {
    if (F.px !== false) mb.quadP([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], a);
    if (F.nx !== false) mb.quadP([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], a);
    if (F.top !== false) mb.quadP([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], a);
    if (F.bottom !== false) mb.quadP([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], a);
    if (F.pz !== false) mb.quadP([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], a);
    if (F.nz !== false) mb.quadP([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], a);
    return;
  }
  const e = [a[0], Math.max(a[1], 1), a[2], a[3] ?? 0];
  const X0 = x0 + b, X1 = x1 - b, Y0 = y0 + b, Y1 = y1 - b, Z0 = z0 + b, Z1 = z1 - b;
  // main faces (inset)
  if (F.px !== false) mb.quadP([x1, Y0, Z1], [x1, Y0, Z0], [x1, Y1, Z0], [x1, Y1, Z1], a);
  if (F.nx !== false) mb.quadP([x0, Y0, Z0], [x0, Y0, Z1], [x0, Y1, Z1], [x0, Y1, Z0], a);
  if (F.top !== false) mb.quadP([X0, y1, Z1], [X1, y1, Z1], [X1, y1, Z0], [X0, y1, Z0], a);
  if (F.bottom !== false) mb.quadP([X0, y0, Z0], [X1, y0, Z0], [X1, y0, Z1], [X0, y0, Z1], a);
  if (F.pz !== false) mb.quadP([X0, Y0, z1], [X1, Y0, z1], [X1, Y1, z1], [X0, Y1, z1], a);
  if (F.nz !== false) mb.quadP([X1, Y0, z0], [X0, Y0, z0], [X0, Y1, z0], [X1, Y1, z0], a);
  // 12 edge chamfers
  // edges parallel to X
  mb.quadP([X0, y1, Z1], [X0, Y1, z1], [X1, Y1, z1], [X1, y1, Z1], e); // top-front
  mb.quadP([X1, y1, Z0], [X1, Y1, z0], [X0, Y1, z0], [X0, y1, Z0], e); // top-back
  mb.quadP([X1, y0, Z1], [X1, Y0, z1], [X0, Y0, z1], [X0, y0, Z1], e); // bottom-front
  mb.quadP([X0, y0, Z0], [X0, Y0, z0], [X1, Y0, z0], [X1, y0, Z0], e); // bottom-back
  // edges parallel to Z
  mb.quadP([x1, Y1, Z1], [x1, Y1, Z0], [X1, y1, Z0], [X1, y1, Z1], e); // top-right
  mb.quadP([X0, y1, Z1], [X0, y1, Z0], [x0, Y1, Z0], [x0, Y1, Z1], e); // top-left
  mb.quadP([X1, y0, Z1], [X1, y0, Z0], [x1, Y0, Z0], [x1, Y0, Z1], e); // bottom-right
  mb.quadP([x0, Y0, Z1], [x0, Y0, Z0], [X0, y0, Z0], [X0, y0, Z1], e); // bottom-left
  // edges parallel to Y
  mb.quadP([X1, Y0, z1], [x1, Y0, Z1], [x1, Y1, Z1], [X1, Y1, z1], e); // front-right
  mb.quadP([x0, Y0, Z1], [X0, Y0, z1], [X0, Y1, z1], [x0, Y1, Z1], e); // front-left
  mb.quadP([x1, Y0, Z0], [X1, Y0, z0], [X1, Y1, z0], [x1, Y1, Z0], e); // back-right
  mb.quadP([X0, Y0, z0], [x0, Y0, Z0], [x0, Y1, Z0], [X0, Y1, z0], e); // back-left
  // 8 corner triangles (oriented outward)
  for (const sx of [0, 1]) for (const sy of [0, 1]) for (const sz of [0, 1]) {
    const cx = sx ? X1 : X0, cy = sy ? Y1 : Y0, cz = sz ? Z1 : Z0;
    const ox = sx ? x1 : x0, oy = sy ? y1 : y0, oz = sz ? z1 : z0;
    triOut(mb, [ox, cy, cz], [cx, oy, cz], [cx, cy, oz], [sx ? 1 : -1, sy ? 1 : -1, sz ? 1 : -1], e);
  }
}

/** triangle whose normal is flipped to agree with `dir` */
export function triOut(mb, p0, p1, p2, dir, aux) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const wx = p2[0] - p0[0], wy = p2[1] - p0[1], wz = p2[2] - p0[2];
  const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
  if (nx * dir[0] + ny * dir[1] + nz * dir[2] >= 0) mb.triP(p0, p1, p2, aux); else mb.triP(p0, p2, p1, aux);
}

/** quad whose normal is flipped to agree with `dir` (local coords) */
export function quadOut(mb, p0, p1, p2, p3, dir, aux) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const wx = p3[0] - p0[0], wy = p3[1] - p0[1], wz = p3[2] - p0[2];
  const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
  if (nx * dir[0] + ny * dir[1] + nz * dir[2] >= 0) mb.quadP(p0, p1, p2, p3, aux); else mb.quadP(p3, p2, p1, p0, aux);
}

/** box by centre + size */
export function boxC(mb, cx, cy, cz, sx, sy, sz, bevel = 0, aux = null, faces = null) {
  box(mb, [cx - sx / 2, cy - sy / 2, cz - sz / 2], [cx + sx / 2, cy + sy / 2, cz + sz / 2], bevel, aux, faces);
}

/**
 * Lathe around +Y. profile: array of [r, y, cav?, edge?, sharp?] from bottom to top.
 * A point with sharp=true splits smoothing (crisp edge). segs = radial segments.
 * opts: { a0, a1 (angle range), capTop, capBottom, aux (default aux), streak }
 */
export function lathe(mb, profile, segs, opts = {}) {
  const a0 = opts.a0 ?? 0, a1 = opts.a1 ?? Math.PI * 2;
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const strk = opts.streak ?? 0;
  // split into smooth runs
  const runs = []; let cur = [profile[0]];
  for (let i = 1; i < profile.length; i++) {
    cur.push(profile[i]);
    if (profile[i][4] && i < profile.length - 1) { runs.push(cur); cur = [profile[i]]; }
  }
  runs.push(cur);
  const cs = [], sn = [];
  for (let s = 0; s <= segs; s++) { const a = a0 + (a1 - a0) * (s / segs); cs.push(Math.cos(a)); sn.push(Math.sin(a)); }
  for (const run of runs) {
    const n = run.length;
    // 2D normals per point (outward = +r)
    const nr = [], ny = [];
    for (let i = 0; i < n; i++) {
      const p = run[Math.max(0, i - 1)], q = run[Math.min(n - 1, i + 1)];
      let dr = q[0] - p[0], dy = q[1] - p[1];
      const l = Math.hypot(dr, dy) || 1; dr /= l; dy /= l;
      nr.push(dy); ny.push(-dr);
    }
    const base = mb.count;
    for (let i = 0; i < n; i++) {
      const [r, y, cav = 0, edge = 0] = run[i];
      const aux = [cav, edge, strk, opts.masonry ?? 0]; // opts.masonry: aux.w (ashlar 3.x / drums 1.x)
      for (let s = 0; s <= segs; s++) {
        // angle measured from +Z toward +X (x = sin, z = cos)
        mb.v(r * sn[s], y, r * cs[s], nr[i] * sn[s], ny[i], nr[i] * cs[s], aux);
      }
    }
    const W = segs + 1;
    for (let i = 0; i < n - 1; i++) for (let s = 0; s < segs; s++) {
      const a = base + i * W + s, b = a + 1, c = a + W + 1, d = a + W;
      // orientation: profile goes up, angle increases from +Z toward +X → outward normal needs (a, d, c, b)
      if (Math.abs(run[i][0]) < 1e-7 && Math.abs(run[i + 1][0]) < 1e-7) continue;
      mb.q(a, b, c, d);
    }
  }
  if (opts.capTop) disk(mb, profile[profile.length - 1][0], profile[profile.length - 1][1], segs, true, opts.aux);
  if (opts.capBottom) disk(mb, profile[0][0], profile[0][1], segs, false, opts.aux);
  void full;
}

export function disk(mb, r, y, segs, up = true, aux = null) {
  const c = mb.v(0, y, 0, 0, up ? 1 : -1, 0, aux);
  const base = mb.count;
  for (let s = 0; s <= segs; s++) { const a = (s / segs) * Math.PI * 2; mb.v(r * Math.sin(a), y, r * Math.cos(a), 0, up ? 1 : -1, 0, aux); }
  for (let s = 0; s < segs; s++) { if (up) mb.t(c, base + s, base + s + 1); else mb.t(c, base + s + 1, base + s); }
}

/**
 * Parametric surface. f(u, v, out[3]) writes the point for u,v ∈ [0,1]. Normals by central
 * differences (one-sided at borders → crisp seams between separate patches).
 * opts: { flip, aux: (u,v)=>[4] or [4], us: [..] custom u samples, vs: [..] custom v samples, closedU }
 */
export function surface(mb, f, nu, nv, opts = {}) {
  const us = opts.us || Array.from({ length: nu + 1 }, (_, i) => i / nu);
  const vs = opts.vs || Array.from({ length: nv + 1 }, (_, i) => i / nv);
  const NU = us.length, NV = vs.length;
  const p = [0, 0, 0], pu0 = [0, 0, 0], pu1 = [0, 0, 0], pv0 = [0, 0, 0], pv1 = [0, 0, 0];
  const eps = 1e-4;
  const base = mb.count;
  const auxF = typeof opts.aux === 'function' ? opts.aux : null;
  const auxC = auxF ? null : (opts.aux || mb.auxDefault);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const u = us[i], v = vs[j];
    f(u, v, p);
    const ua = opts.closedU ? u - eps : Math.max(0, u - eps), ub = opts.closedU ? u + eps : Math.min(1, u + eps);
    const va = Math.max(0, v - eps), vb = Math.min(1, v + eps);
    f(ua, v, pu0); f(ub, v, pu1); f(u, va, pv0); f(u, vb, pv1);
    const tx = pu1[0] - pu0[0], ty = pu1[1] - pu0[1], tz = pu1[2] - pu0[2];
    const bx = pv1[0] - pv0[0], by = pv1[1] - pv0[1], bz = pv1[2] - pv0[2];
    let nx = ty * bz - tz * by, ny = tz * bx - tx * bz, nz = tx * by - ty * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (opts.flip) { nx = -nx; ny = -ny; nz = -nz; }
    mb.v(p[0], p[1], p[2], nx, ny, nz, auxF ? auxF(u, v) : auxC);
  }
  for (let j = 0; j < NV - 1; j++) for (let i = 0; i < NU - 1; i++) {
    const a = base + j * NU + i, b = a + 1, c = a + NU + 1, d = a + NU;
    if (opts.flip) mb.q(a, d, c, b); else mb.q(a, b, c, d);
  }
}

/**
 * Sweep a 2D moulding profile along a polyline in the XZ plane (closed or open), with mitred joints.
 * profile: [[out, up, cav?, edge?, sharp?], ...] — out = distance outward (left normal of the path
 * direction when `outside` = 'left'), up = y offset. path: [[x,z], ...]. y0 = base height.
 * opts: { closed, outward: +1 (normal = right of travel dir) or -1, caps (open paths) , streak }
 */
export function sweep(mb, profile, path, y0 = 0, opts = {}) {
  const closed = !!opts.closed;
  const sgn = opts.outward ?? 1;
  const strk = opts.streak ?? 0;
  const np = path.length;
  // per path vertex: position, miter normal (scaled)
  const mit = [];
  for (let i = 0; i < np; i++) {
    const prev = closed ? path[(i - 1 + np) % np] : path[Math.max(0, i - 1)];
    const next = closed ? path[(i + 1) % np] : path[Math.min(np - 1, i + 1)];
    const cur = path[i];
    const d1 = i === 0 && !closed ? [next[0] - cur[0], next[1] - cur[1]] : [cur[0] - prev[0], cur[1] - prev[1]];
    const d2 = i === np - 1 && !closed ? [cur[0] - prev[0], cur[1] - prev[1]] : [next[0] - cur[0], next[1] - cur[1]];
    const l1 = Math.hypot(...d1) || 1, l2 = Math.hypot(...d2) || 1;
    // right normals (x, z) → (dz, -dx)
    const n1 = [d1[1] / l1 * sgn, -d1[0] / l1 * sgn], n2 = [d2[1] / l2 * sgn, -d2[0] / l2 * sgn];
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const cosh = mx * n1[0] + mz * n1[1];
    const k = 1 / Math.max(0.2, cosh);
    mit.push({ x: cur[0], z: cur[1], mx: mx * k, mz: mz * k, n1, n2 });
  }
  // split profile into smooth runs
  const runs = []; let cur = [profile[0]];
  for (let i = 1; i < profile.length; i++) {
    cur.push(profile[i]);
    if (profile[i][4] && i < profile.length - 1) { runs.push(cur); cur = [profile[i]]; }
  }
  runs.push(cur);
  const segCount = closed ? np : np - 1;
  for (let s = 0; s < segCount; s++) {
    const A = mit[s], B = mit[(s + 1) % np];
    // segment normal (outward)
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1;
    const onx = dz / L * sgn, onz = -dx / L * sgn;
    for (const run of runs) {
      const n = run.length;
      const base = mb.count;
      for (let i = 0; i < n; i++) {
        const p = run[Math.max(0, i - 1)], q = run[Math.min(n - 1, i + 1)];
        let dOut = q[0] - p[0], dUp = q[1] - p[1];
        const l = Math.hypot(dOut, dUp) || 1; dOut /= l; dUp /= l;
        // 2D normal in (out, up): (dUp, -dOut)
        const nOut = dUp, nUp = -dOut;
        const [o, u, cav = 0, edge = 0] = run[i];
        const aux = [cav, edge, strk, 0];
        mb.v(A.x + A.mx * o, y0 + u, A.z + A.mz * o, onx * nOut, nUp, onz * nOut, aux);
        mb.v(B.x + B.mx * o, y0 + u, B.z + B.mz * o, onx * nOut, nUp, onz * nOut, aux);
      }
      for (let i = 0; i < n - 1; i++) {
        const a = base + i * 2, b = a + 1, c = a + 3, d = a + 2;
        // travel A→B, profile upward; outward right → winding
        if (sgn > 0) mb.q(a, d, c, b); else mb.q(a, b, c, d);
      }
    }
  }
  if (!closed && opts.caps !== false) {
    // flat end caps (fan from profile polygon, assumes the profile is a simple polygon with the base line closing it)
    for (const end of [0, np - 1]) {
      const M = mit[end];
      const dir = end === 0 ? -1 : 1;
      const pts = profile.map(([o, u]) => [M.x + M.mx * o, y0 + u, M.z + M.mz * o]);
      // add inner closing points at out = min
      const tdx = (end === 0 ? path[1][0] - path[0][0] : path[np - 1][0] - path[np - 2][0]);
      const tdz = (end === 0 ? path[1][1] - path[0][1] : path[np - 1][1] - path[np - 2][1]);
      const tl = Math.hypot(tdx, tdz) || 1;
      const nx = tdx / tl * dir, nz = tdz / tl * dir;
      const base = mb.count;
      for (const p of pts) mb.v(p[0], p[1], p[2], nx, 0, nz, [0.2, 0.5, 0, 0]);
      const tris = THREE.ShapeUtils.triangulateShape(profile.map(([o, u]) => new THREE.Vector2(o, u)), []);
      const want = (dir > 0) === (sgn > 0) ? 1 : -1;
      for (const [a, b, c] of tris) {
        const pa = profile[a], pb = profile[b], pc = profile[c];
        const cr = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
        if (cr * want >= 0) mb.t(base + a, base + b, base + c); else mb.t(base + a, base + c, base + b);
      }
    }
  }
}

/** rectangle path (closed, CCW seen from above → outward = right side when sgn=1) centred at 0 */
export function rectPath(w, d, cx = 0, cz = 0) {
  const hw = w / 2, hd = d / 2;
  // travel order so that "right" normal points outward: go clockwise seen from +Y
  return [[cx - hw, cz - hd], [cx + hw, cz - hd], [cx + hw, cz + hd], [cx - hw, cz + hd]];
}

/** extrude a 2D outline (array of [x,y], CCW) along +Z by depth, front face at z = depth. */
export function extrudeOutline(mb, outline, depth, opts = {}) {
  const tris = THREE.ShapeUtils.triangulateShape(outline.map(([x, y]) => new THREE.Vector2(x, y)), []);
  const auxF = opts.aux || mb.auxDefault, auxS = opts.auxSide || [0.3, 0.6, 0, 0];
  // front
  let base = mb.count;
  const ok = tris.map(([a, b, c]) => {
    const A = outline[a], B = outline[b], C = outline[c];
    return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) >= 0;
  });
  for (const [x, y] of outline) mb.v(x, y, depth, 0, 0, 1, auxF);
  tris.forEach(([a, b, c], k) => { if (ok[k]) mb.t(base + a, base + b, base + c); else mb.t(base + a, base + c, base + b); });
  if (opts.back !== false) {
    base = mb.count;
    for (const [x, y] of outline) mb.v(x, y, 0, 0, 0, -1, auxF);
    tris.forEach(([a, b, c], k) => { if (ok[k]) mb.t(base + a, base + c, base + b); else mb.t(base + a, base + b, base + c); });
  }
  // sides
  const n = outline.length;
  const ccw = THREE.ShapeUtils.isClockWise(outline.map(([x, y]) => new THREE.Vector2(x, y))) ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i], [x1, y1] = outline[(i + 1) % n];
    const p0 = [x0, y0, 0], p1 = [x1, y1, 0], p2 = [x1, y1, depth], p3 = [x0, y0, depth];
    if (ccw > 0) mb.quadP(p0, p1, p2, p3, auxS); else mb.quadP(p1, p0, p3, p2, auxS);
  }
}

/** tapered cylinder/cone (open-ended unless caps). Local base at y0. */
export function cylinder(mb, r0, r1, y0, y1, segs, opts = {}) {
  lathe(mb, [[r0, y0, opts.cav ?? 0, 0], [r1, y1, opts.cav ?? 0, 0]], segs, { capTop: opts.capTop, capBottom: opts.capBottom, aux: opts.aux, streak: opts.streak });
}

/** UV-sphere-ish ellipsoid */
export function ellipsoid(mb, rx, ry, rz, nu = 10, nv = 7, aux = null) {
  surface(mb, (u, v, o) => {
    const th = u * Math.PI * 2, ph = v * Math.PI;
    o[0] = rx * Math.sin(ph) * Math.sin(th); o[1] = -ry * Math.cos(ph); o[2] = rz * Math.sin(ph) * Math.cos(th);
  }, nu, nv, { aux, closedU: true });
}

/** tube along a 3D curve c(t) with radius r(t). */
export function tube(mb, curve, radius, nT, nR, opts = {}) {
  const pt = [0, 0, 0];
  const pts = [], tans = [];
  for (let i = 0; i <= nT; i++) { curve(i / nT, pt); pts.push([...pt]); }
  for (let i = 0; i <= nT; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(nT, i + 1)];
    const t = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    tans.push(t);
  }
  // parallel transport frames
  const up0 = Math.abs(tans[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  let nrm = new THREE.Vector3().crossVectors(tans[0], up0).normalize();
  const frames = [];
  for (let i = 0; i <= nT; i++) {
    if (i > 0) {
      const ax = new THREE.Vector3().crossVectors(tans[i - 1], tans[i]);
      const s = ax.length();
      if (s > 1e-6) { ax.normalize(); nrm.applyAxisAngle(ax, Math.asin(Math.min(1, s))); }
    }
    const bin = new THREE.Vector3().crossVectors(tans[i], nrm).normalize();
    frames.push([nrm.clone(), bin]);
  }
  const base = mb.count;
  const auxF = typeof opts.aux === 'function' ? opts.aux : null;
  for (let i = 0; i <= nT; i++) {
    const r = typeof radius === 'function' ? radius(i / nT) : radius;
    const [N, B] = frames[i];
    for (let j = 0; j <= nR; j++) {
      const a = (j / nR) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const nx = N.x * c + B.x * s, ny = N.y * c + B.y * s, nz = N.z * c + B.z * s;
      mb.v(pts[i][0] + nx * r, pts[i][1] + ny * r, pts[i][2] + nz * r, nx, ny, nz, auxF ? auxF(i / nT, j / nR) : (opts.aux || mb.auxDefault));
    }
  }
  const W = nR + 1;
  for (let i = 0; i < nT; i++) for (let j = 0; j < nR; j++) {
    const a = base + i * W + j, b = a + 1, c = a + W + 1, d = a + W;
    mb.q(a, b, c, d);
  }
}

// ======================================================================== utilities
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** deterministic hash noise for geometry (no Math.random) */
export function hash3(x, y, z) {
  let h = Math.imul((x * 73856093) ^ (y * 19349663) ^ (z * 83492791), 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}
/** cheap smooth 3D value noise for geometry displacement */
export function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const h = (a, b, c) => hash3(xi + a, yi + b, zi + c);
  const x00 = lerp(h(0, 0, 0), h(1, 0, 0), u), x10 = lerp(h(0, 1, 0), h(1, 1, 0), u);
  const x01 = lerp(h(0, 0, 1), h(1, 0, 1), u), x11 = lerp(h(0, 1, 1), h(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
export function fbm3(x, y, z, oct = 3) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise3(x, y, z); n += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; }
  return s / n;
}
