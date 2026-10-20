// Low-level mesh builder for the aqueducts & bridges.
// Everything is built in a LOCAL frame: x = along the span (from end A toward B), y = world height,
// z = across the span. Every piece carries (type, seed, wear, ground) which drives the procedural stone
// shader (see stone.js); on the GPU it is packed into a vec2 `aStone` = (type*100 + wear*99 + seed*0.98, ground)
// and the geometry is indexed with Int16 normals to keep memory low on the integrated GPU:
//   type 0 coursed ashlar · 1 dressed moulding · 2 voussoir · 3 paving · 4 channel lining (plaster)
//        5 rough foundation · 6 rusticated pier block
//   seed  per-piece random [0,1)       wear  weathering amount [0,1]      ground  terrain height below
import * as THREE from 'three';

export const T = { ASHLAR: 0, MOULD: 1, VOUSS: 2, PAVE: 3, LINING: 4, FOUND: 5, RUSTIC: 6 };

// box corner ordering: bit0 = +x, bit1 = +y, bit2 = +z
const HEX_FACES = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();

/** pack (type, seed, wear) into one float: type*100 + round(wear*99) + seed*0.98 */
export function packStone(st) {
  const w = Math.round(Math.min(1, Math.max(0, st[2])) * 99);
  return st[0] * 100 + w + Math.min(0.98, Math.max(0, st[1]) * 0.98);
}

export class Builder {
  constructor() {
    this.p = []; this.n = []; this.s = []; this.i = [];
    this.darkEdges = false;
    this.tris = 0;
  }

  _v(pt, nx, ny, nz, ps, g) {
    const k = this.p.length / 3;
    this.p.push(pt[0], pt[1], pt[2]); this.n.push(nx, ny, nz); this.s.push(ps, g);
    return k;
  }

  /** triangle with a flat normal; if `out` (a direction) is given, winding is fixed so the normal faces it */
  tri(a, b, c, st, out = null) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_a, _b);
    const len = _n.length();
    if (len < 1e-10) return;
    _n.multiplyScalar(1 / len);
    if (out && _n.x * out[0] + _n.y * out[1] + _n.z * out[2] < 0) { const t = b; b = c; c = t; _n.negate(); }
    const ps = packStone(st);
    const i0 = this._v(a, _n.x, _n.y, _n.z, ps, st[3]), i1 = this._v(b, _n.x, _n.y, _n.z, ps, st[3]), i2 = this._v(c, _n.x, _n.y, _n.z, ps, st[3]);
    this.i.push(i0, i1, i2);
    this.tris++;
  }

  /** convex polygon (fan) with flat normal oriented toward `out` */
  poly(pts, st, out = null) {
    for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0], pts[i], pts[i + 1], st, out);
  }

  /** quad with one flat normal (from the diagonals), shared vertices */
  quad(a, b, c, d, st, out = null) {
    _a.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _b.set(d[0] - b[0], d[1] - b[1], d[2] - b[2]);
    _n.crossVectors(_a, _b);
    const len = _n.length();
    if (len < 1e-10) { this.tri(a, b, c, st, out); this.tri(a, c, d, st, out); return; }
    _n.multiplyScalar(1 / len);
    if (out && _n.x * out[0] + _n.y * out[1] + _n.z * out[2] < 0) { const t = b; b = d; d = t; _n.negate(); }
    const ps = packStone(st), g = st[3];
    const i0 = this._v(a, _n.x, _n.y, _n.z, ps, g), i1 = this._v(b, _n.x, _n.y, _n.z, ps, g);
    const i2 = this._v(c, _n.x, _n.y, _n.z, ps, g), i3 = this._v(d, _n.x, _n.y, _n.z, ps, g);
    this.i.push(i0, i1, i2, i0, i2, i3);
    this.tris += 2;
  }

  /**
   * Hexahedron from 8 corners (bit0 = u, bit1 = v, bit2 = w), optional chamfer on all edges.
   * Works for any convex hexahedron (boxes, voussoir wedges, tapered blocks).
   * faceMask: bit per face (-u,+u,-v,+v,-w,+w) to skip hidden faces (only when chamfer = 0).
   */
  hexa(C, st, chamfer = 0, faceMask = 63) {
    const cx = (C[0][0] + C[7][0] + C[1][0] + C[6][0]) / 4;
    const cy = (C[0][1] + C[7][1] + C[1][1] + C[6][1]) / 4;
    const cz = (C[0][2] + C[7][2] + C[1][2] + C[6][2]) / 4;
    const outOf = (p) => [p[0] - cx, p[1] - cy, p[2] - cz];
    if (chamfer <= 0) {
      for (let f = 0; f < 6; f++) {
        if (!(faceMask & (1 << f))) continue;
        const F = HEX_FACES[f].map((i) => C[i]);
        const fc = [(F[0][0] + F[2][0]) / 2, (F[0][1] + F[2][1]) / 2, (F[0][2] + F[2][2]) / 2];
        this.quad(F[0], F[1], F[2], F[3], st, outOf(fc));
      }
      return;
    }
    // inset vertex per (face, corner)
    const ins = HEX_FACES.map((face) => face.map((vi, k) => {
      const V = C[vi], P = C[face[(k + 3) % 4]], N = C[face[(k + 1) % 4]];
      const e1 = norm3([P[0] - V[0], P[1] - V[1], P[2] - V[2]]), e2 = norm3([N[0] - V[0], N[1] - V[1], N[2] - V[2]]);
      return [V[0] + chamfer * (e1[0] + e2[0]), V[1] + chamfer * (e1[1] + e2[1]), V[2] + chamfer * (e1[2] + e2[2])];
    }));
    const insOf = (f, vi) => ins[f][HEX_FACES[f].indexOf(vi)];
    // chamfer faces can be tagged (type + 10) so the shader darkens them like dirty mortar joints
    const est = this.darkEdges ? [st[0] + 10, st[1], st[2], st[3]] : st;
    for (let f = 0; f < 6; f++) {
      const F = ins[f];
      const fc = [(F[0][0] + F[2][0]) / 2, (F[0][1] + F[2][1]) / 2, (F[0][2] + F[2][2]) / 2];
      this.quad(F[0], F[1], F[2], F[3], st, outOf(fc));
    }
    // edges: every pair of faces sharing two corners
    for (let f = 0; f < 6; f++) for (let g = f + 1; g < 6; g++) {
      const sh = HEX_FACES[f].filter((v) => HEX_FACES[g].includes(v));
      if (sh.length !== 2) continue;
      const [va, vb] = sh;
      const m = [(C[va][0] + C[vb][0]) / 2, (C[va][1] + C[vb][1]) / 2, (C[va][2] + C[vb][2]) / 2];
      this.quad(insOf(f, va), insOf(f, vb), insOf(g, vb), insOf(g, va), est, outOf(m));
    }
    // corners
    for (let v = 0; v < 8; v++) {
      const fs = [];
      for (let f = 0; f < 6; f++) if (HEX_FACES[f].includes(v)) fs.push(insOf(f, v));
      this.tri(fs[0], fs[1], fs[2], est, outOf(C[v]));
    }
  }

  /** axis-aligned box in local coords */
  box(x0, y0, z0, x1, y1, z1, st, chamfer = 0, faceMask = 63) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const c = Math.min(chamfer, (x1 - x0) * 0.3, (y1 - y0) * 0.3, (z1 - z0) * 0.3);
    this.hexa(boxCorners(x0, y0, z0, x1, y1, z1), st, c, faceMask);
  }

  /** voussoir wedge around arch centre (cx, cy) in the x-y plane between angles a0..a1, radii r0..r1, depth z0..z1 */
  voussoir(cx, cy, a0, a1, r0, r1, z0, z1, st, chamfer = 0) {
    const C = [];
    for (let i = 0; i < 8; i++) {
      const a = i & 1 ? a1 : a0, r = i & 2 ? r1 : r0, z = i & 4 ? z1 : z0;
      C.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
    }
    this.hexa(C, st, chamfer);
  }

  /** voussoir whose ring lies in the y-z plane (arch opening facing ±x), depth along x from x0 to x1 */
  voussoirYZ(cz, cy, a0, a1, r0, r1, x0, x1, st, chamfer = 0) {
    const C = [];
    for (let i = 0; i < 8; i++) {
      const a = i & 1 ? a1 : a0, r = i & 2 ? r1 : r0, x = i & 4 ? x1 : x0;
      C.push([x, cy + Math.sin(a) * r, cz + Math.cos(a) * r]);
    }
    this.hexa(C, st, chamfer);
  }

  /** tapered (battered) block: bottom rectangle x0..x1/z0..z1 at y0, top inset by `inset` at y1 */
  batter(x0, y0, z0, x1, y1, z1, inset, st, chamfer = 0) {
    const C = [];
    for (let i = 0; i < 8; i++) {
      const top = i & 2, k = top ? inset : 0;
      C.push([i & 1 ? x1 - k : x0 + k, top ? y1 : y0, i & 4 ? z1 - k : z0 + k]);
    }
    this.hexa(C, st, chamfer);
  }

  /**
   * Extrude a closed profile polygon given in the (z, y) plane along x from x0 to x1.
   * profile: [[z, y], ...] counter-clockwise or clockwise, any; caps triangulated with earcut.
   */
  extrudeX(profile, x0, x1, st, caps = true) {
    const n = profile.length;
    let cz = 0, cy = 0;
    for (const [z, y] of profile) { cz += z; cy += y; }
    cz /= n; cy /= n;
    for (let i = 0; i < n; i++) {
      const [za, ya] = profile[i], [zb, yb] = profile[(i + 1) % n];
      // outward normal of the segment in the z-y plane: perpendicular, pointing away from the centroid side
      let nz = yb - ya, ny = -(zb - za);
      const mz = (za + zb) / 2 - cz, my = (ya + yb) / 2 - cy;
      if (nz * mz + ny * my < 0) { nz = -nz; ny = -ny; }
      this.quad([x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb], st, [0, ny, nz]);
    }
    if (caps) {
      const contour = profile.map(([z, y]) => new THREE.Vector2(z, y));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const [i, j, k] of tris) {
        const A = profile[i], B = profile[j], Cc = profile[k];
        this.tri([x0, A[1], A[0]], [x0, B[1], B[0]], [x0, Cc[1], Cc[0]], st, [-1, 0, 0]);
        this.tri([x1, A[1], A[0]], [x1, B[1], B[0]], [x1, Cc[1], Cc[0]], st, [1, 0, 0]);
      }
    }
  }

  /** flat polygon (possibly concave, with holes) in the x-y plane at depth z, facing +z or -z */
  planeXY(contour, holes, z, facing, st) {
    const c2 = contour.map(([x, y]) => new THREE.Vector2(x, y));
    const h2 = (holes || []).map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
    const all = contour.concat(...(holes || []));
    const tris = THREE.ShapeUtils.triangulateShape(c2, h2);
    for (const [i, j, k] of tris) {
      const A = all[i], B = all[j], Cc = all[k];
      this.tri([A[0], A[1], z], [B[0], B[1], z], [Cc[0], Cc[1], z], st, [0, 0, facing]);
    }
  }

  /** append another builder, mapping positions/normals; flip = mirror transform (reverse winding) */
  appendMapped(other, mapP, mapN, flip = false) {
    const base = this.p.length / 3;
    for (let k = 0; k < other.p.length; k += 3) {
      const P = mapP([other.p[k], other.p[k + 1], other.p[k + 2]]);
      const N = mapN([other.n[k], other.n[k + 1], other.n[k + 2]]);
      this.p.push(P[0], P[1], P[2]); this.n.push(N[0], N[1], N[2]);
    }
    for (let k = 0; k < other.s.length; k++) this.s.push(other.s[k]);
    for (let k = 0; k < other.i.length; k += 3) {
      if (flip) this.i.push(base + other.i[k], base + other.i[k + 2], base + other.i[k + 1]);
      else this.i.push(base + other.i[k], base + other.i[k + 1], base + other.i[k + 2]);
    }
    this.tris += other.tris;
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    const nv = this.p.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    const n16 = new Int16Array(this.n.length);
    for (let k = 0; k < this.n.length; k++) n16[k] = Math.round(Math.max(-1, Math.min(1, this.n[k])) * 32767);
    g.setAttribute('normal', new THREE.BufferAttribute(n16, 3, true));
    g.setAttribute('aStone', new THREE.Float32BufferAttribute(this.s, 2));
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export function boxCorners(x0, y0, z0, x1, y1, z1) {
  const C = [];
  for (let i = 0; i < 8; i++) C.push([i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0]);
  return C;
}

export function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** semicircle arc points from angle 0 (right) to PI (left) — used for spandrel holes */
export function arcPoints(cx, cy, r, segs, a0 = 0, a1 = Math.PI) {
  const out = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (a1 - a0) * (i / segs);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}
