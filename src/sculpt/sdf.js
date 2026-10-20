// Small, fast SDF toolkit for sculpting statues on the CPU (works in node and the browser).
// All functions take plain numbers. Rotations are 3x3 row-major arrays [m00,m01,m02, m10,...].
import { sd, op } from './mesher.js';
export { sd, op };

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const smax = (a, b, k) => { if (k <= 0) return Math.max(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
export const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); };
export const hash2 = (a, b) => hash1(a * 57.13 + b * 113.7);

// ------------------------------------------------------------------ rotations
export function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
export function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
export function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
export function mmul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
export function mT(a) { return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]; }
/** rotation from Euler (yaw about Y, pitch about X, roll about Z), applied R = Ry * Rx * Rz */
export function euler(yaw = 0, pitch = 0, roll = 0) { return mmul(rotY(yaw), mmul(rotX(pitch), rotZ(roll))); }
export function mv(m, x, y, z) { return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z]; }
/** frame whose local +Y points along `dir` and local +Z is as close as possible to `fwd` (returns local→world matrix) */
export function frameY(dir, fwd = [0, 0, 1]) {
  const y = norm(dir);
  let z = sub(fwd, scale(y, dot(fwd, y)));
  if (len(z) < 1e-4) z = sub([1, 0, 0], scale(y, y[0]));
  z = norm(z);
  const x = cross(y, z);
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

// ------------------------------------------------------------------ vec helpers
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ------------------------------------------------------------------ primitives (extra)
/** 2D ellipse distance approximation (good near the boundary) */
export function ellipse2(x, z, rx, rz) {
  const k0 = Math.hypot(x / rx, z / rz), k1 = Math.hypot(x / (rx * rx), z / (rz * rz));
  return k1 === 0 ? -Math.min(rx, rz) : (k0 * (k0 - 1)) / k1;
}
/** ellipsoid in a rotated frame: m = world→local rotation (row-major), c = centre */
export function ellipsoidR(x, y, z, c, m, rx, ry, rz) {
  const dx = x - c[0], dy = y - c[1], dz = z - c[2];
  return sd.ellipsoid(m[0] * dx + m[1] * dy + m[2] * dz, m[3] * dx + m[4] * dy + m[5] * dz, m[6] * dx + m[7] * dy + m[8] * dz, rx, ry, rz);
}
/** segment param + distance squared helper */
export function segT(x, y, z, a, b) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  return clamp(((x - a[0]) * bax + (y - a[1]) * bay + (z - a[2]) * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
}
export function capsule(x, y, z, a, b, r) { return sd.capsule(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], r); }
export function cone(x, y, z, a, b, ra, rb) { return sd.roundCone(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], ra, rb); }
/** quadratic bezier tube with radius varying ra→rb (approximate distance, sampled) */
export function tube(x, y, z, pts, ra, rb, k = 0) {
  let d = Infinity;
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const di = sd.roundCone(x, y, z, pts[i][0], pts[i][1], pts[i][2], pts[i + 1][0], pts[i + 1][1], pts[i + 1][2], lerp(ra, rb, t0), lerp(ra, rb, t1));
    d = k > 0 ? smin(d, di, k) : Math.min(d, di);
  }
  return d;
}
/** sample a quadratic/cubic bezier into a polyline */
export function bezier(p0, p1, p2, p3, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    if (p3) out.push([0, 1, 2].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]));
    else out.push([0, 1, 2].map((k) => u * u * p0[k] + 2 * u * t * p1[k] + t * t * p2[k]));
  }
  return out;
}

// ------------------------------------------------------------------ bounded union of parts
/**
 * A Group evaluates a smooth union of parts with bounding-sphere culling.
 * part = { f(x,y,z) → d, c:[x,y,z], r: bound radius, k: blend radius, sub?: true (smooth subtraction) }
 */
export class Group {
  constructor(parts = [], k = 0) { this.parts = []; this.k = k; for (const p of parts) this.add(p); this._bound(); }
  add(p) { this.parts.push(p); this._bound(); return this; }
  _bound() {
    if (!this.parts.length) { this.c = [0, 0, 0]; this.r = 0; return; }
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of this.parts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p.c[i] - p.r); mx[i] = Math.max(mx[i], p.c[i] + p.r); }
    this.c = mix3(mn, mx, 0.5);
    this.r = len(sub(mx, mn)) * 0.5;
  }
  eval(x, y, z) {
    let d = 1e9;
    const parts = this.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const k = p.k ?? this.k;
      const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2];
      const dd = dx * dx + dy * dy + dz * dz;
      if (p.sub) {
        const t = p.r + k;
        if (dd > t * t) continue; // outside the carve region: no influence
        d = smax(d, -p.f(x, y, z), k);
        continue;
      }
      const t = d + k + p.r;
      if (dd > t * t) continue;
      d = smin(d, p.f(x, y, z), k);
    }
    return d;
  }
  /** distance to the group's bounding sphere (cheap lower bound) */
  bound(x, y, z) { return Math.hypot(x - this.c[0], y - this.c[1], z - this.c[2]) - this.r; }
}

/** bounding sphere of a segment list */
export function boundPts(pts, pad) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
  return { c: mix3(mn, mx, 0.5), r: len(sub(mx, mn)) * 0.5 + pad };
}

// ------------------------------------------------------------------ cheap 3D value noise (deterministic)
function h3(i, j, k) {
  let n = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  n = Math.imul(n ^ (n >>> 13), 0x5bd1e995); n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
export function vnoise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a = lerp(h3(i, j, k), h3(i + 1, j, k), ux), b = lerp(h3(i, j + 1, k), h3(i + 1, j + 1, k), ux);
  const c = lerp(h3(i, j, k + 1), h3(i + 1, j, k + 1), ux), d = lerp(h3(i, j + 1, k + 1), h3(i + 1, j + 1, k + 1), ux);
  return lerp(lerp(a, b, uy), lerp(c, d, uy), uz) * 2 - 1;
}
export function fbm3(x, y, z, oct = 3) {
  let s = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise3(x, y, z); n += a; x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; z = z * 2.03 + 9.2; a *= 0.5; }
  return s / n;
}
/** smooth 1D noise (for fold sway) */
export function vnoise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash1(i + seed * 101.3), hash1(i + 1 + seed * 101.3), u) * 2 - 1;
}
