// Indexed geometry accumulator with custom per-vertex attributes.
// Used by the city generators to merge thousands of houses into a few large meshes.
//
//   const b = new GeoBuilder({ aFac: 4, aSty: 4 });
//   b.quad([p0,p1,p2,p3], n, { aFac: [[...],[...],[...],[...]], aSty: [s,s,s,s] or constant });
//   const geo = b.toGeometry();
import * as THREE from 'three';

class Grow {
  constructor(n = 4096) { this.a = new Float32Array(n); this.n = 0; }
  ensure(k) {
    if (this.n + k <= this.a.length) return;
    let m = this.a.length * 2; while (m < this.n + k) m *= 2;
    const b = new Float32Array(m); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  push3(x, y, z) { this.ensure(3); const a = this.a; a[this.n++] = x; a[this.n++] = y; a[this.n++] = z; }
  pushArr(v, k) { this.ensure(k); for (let i = 0; i < k; i++) this.a[this.n++] = v[i] ?? 0; }
}
class GrowU32 {
  constructor(n = 8192) { this.a = new Uint32Array(n); this.n = 0; }
  ensure(k) {
    if (this.n + k <= this.a.length) return;
    let m = this.a.length * 2; while (m < this.n + k) m *= 2;
    const b = new Uint32Array(m); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  push(...v) { this.ensure(v.length); for (const x of v) this.a[this.n++] = x; }
}

export class GeoBuilder {
  /** @param {Object<string, number>} attrs custom attribute name → item size */
  constructor(attrs = {}) {
    this.attrDefs = attrs;
    this.pos = new Grow(); this.nrm = new Grow();
    this.attrs = {}; for (const k in attrs) this.attrs[k] = new Grow();
    this.idx = new GrowU32();
    this.vcount = 0;
    // "current" constant attribute values (used when a call does not pass per-vertex values)
    this.cur = {}; for (const k in attrs) this.cur[k] = new Array(attrs[k]).fill(0);
  }
  get triangles() { return this.idx.n / 3; }
  set(name, v) { this.cur[name] = v; return this; }

  /** push one vertex; attr values from `av` (name → array) or the current constants */
  vert(p, n, av) {
    this.pos.push3(p[0], p[1], p[2]);
    this.nrm.push3(n[0], n[1], n[2]);
    for (const k in this.attrDefs) {
      const v = (av && av[k]) || this.cur[k];
      this.attrs[k].pushArr(v, this.attrDefs[k]);
    }
    return this.vcount++;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }

  /**
   * Planar quad p0..p3 counter-clockwise seen from the front. n = face normal (computed if omitted).
   * per = optional { attrName: [v0, v1, v2, v3] } per-vertex values.
   */
  quad(p0, p1, p2, p3, n, per) {
    if (!n) n = faceNormal(p0, p1, p2);
    const i0 = this.vert(p0, n, per && pick(per, 0));
    const i1 = this.vert(p1, n, per && pick(per, 1));
    const i2 = this.vert(p2, n, per && pick(per, 2));
    const i3 = this.vert(p3, n, per && pick(per, 3));
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }
  triangle(p0, p1, p2, n, per) {
    if (!n) n = faceNormal(p0, p1, p2);
    const i0 = this.vert(p0, n, per && pick(per, 0));
    const i1 = this.vert(p1, n, per && pick(per, 1));
    const i2 = this.vert(p2, n, per && pick(per, 2));
    this.idx.push(i0, i1, i2);
  }

  /** append raw (non-indexed or indexed) geometry transformed by matrix m (THREE.Matrix4) */
  addGeometry(geo, m, constAttrs) {
    const p = geo.attributes.position, nn = geo.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const base = this.vcount;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      if (nn) w.fromBufferAttribute(nn, i).applyMatrix3(nm).normalize(); else w.set(0, 1, 0);
      const av = {};
      for (const k in this.attrDefs) {
        if (constAttrs && constAttrs[k]) av[k] = typeof constAttrs[k] === 'function' ? constAttrs[k](i, v, w) : constAttrs[k];
        else if (geo.attributes[k]) av[k] = Array.from({ length: this.attrDefs[k] }, (_, j) => geo.attributes[k].array[i * geo.attributes[k].itemSize + j]);
      }
      this.vert([v.x, v.y, v.z], [w.x, w.y, w.z], av);
    }
    if (geo.index) { const ix = geo.index.array; for (let i = 0; i < ix.length; i++) this.idx.push(base + ix[i]); }
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.a.slice(0, this.pos.n), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.a.slice(0, this.nrm.n), 3));
    for (const k in this.attrDefs) g.setAttribute(k, new THREE.BufferAttribute(this.attrs[k].a.slice(0, this.attrs[k].n), this.attrDefs[k]));
    const ix = this.idx.a.slice(0, this.idx.n);
    g.setIndex(new THREE.BufferAttribute(this.vcount < 65535 ? new Uint16Array(ix) : ix, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  get empty() { return this.idx.n === 0; }
}

function pick(per, i) { const o = {}; for (const k in per) o[k] = per[k][i]; return o; }

export function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// ---------------------------------------------------------------- small vector helpers
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  mad: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

/**
 * Local frame helper for oriented buildings: origin (x,z), rotation angle `rot` (THREE rotation.y
 * convention: local +X → world (cos, 0, -sin), local +Z → world (sin, 0, cos)).
 */
export class Frame {
  constructor(x, y, z, rot) { this.x = x; this.y = y; this.z = z; this.rot = rot; this.c = Math.cos(rot); this.s = Math.sin(rot); }
  /** local (lx, ly, lz) → world [x,y,z] */
  p(lx, ly, lz) { return [this.x + lx * this.c + lz * this.s, this.y + ly, this.z - lx * this.s + lz * this.c]; }
  /** local direction → world */
  d(lx, ly, lz) { return [lx * this.c + lz * this.s, ly, -lx * this.s + lz * this.c]; }
  /** world xz → local [lx, lz] */
  toLocal(x, z) { const dx = x - this.x, dz = z - this.z; return [dx * this.c - dz * this.s, dx * this.s + dz * this.c]; }
}
