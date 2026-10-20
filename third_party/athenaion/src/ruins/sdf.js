// Small SDF toolkit for the ruins (allocation-free scalar functions) + meshing wrapper that adds a
// baked cavity/AO attribute (`cav`) and recentres/positions the mesh.
import * as THREE from 'three';
import { meshSDF } from '../sculpt/mesher.js';

export const sqrt = Math.sqrt, abs = Math.abs, min = Math.min, max = Math.max;
export function smin(a, b, k) { const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; }
export function smax(a, b, k) { const h = max(k - abs(a - b), 0) / k; return max(a, b) + h * h * k * 0.25; }
export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
export function box(x, y, z, bx, by, bz) {
  const qx = abs(x) - bx, qy = abs(y) - by, qz = abs(z) - bz;
  const ox = max(qx, 0), oy = max(qy, 0), oz = max(qz, 0);
  return sqrt(ox * ox + oy * oy + oz * oz) + min(max(qx, qy, qz), 0);
}
export function rbox(x, y, z, bx, by, bz, r) { return box(x, y, z, bx - r, by - r, bz - r) - r; }
export function cyl(x, y, z, r, h) { // vertical (y) cylinder, half height h
  const dx = sqrt(x * x + z * z) - r, dy = abs(y) - h;
  return min(max(dx, dy), 0) + sqrt(max(dx, 0) ** 2 + max(dy, 0) ** 2);
}
export function sph(x, y, z, r) { return sqrt(x * x + y * y + z * z) - r; }
export function ell(x, y, z, rx, ry, rz) {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const k0 = sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / rx, by = ay / ry, bz = az / rz;
  const k1 = sqrt(bx * bx + by * by + bz * bz);
  return k1 < 1e-9 ? -min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
export function torus(x, y, z, R, r) { const q = sqrt(x * x + z * z) - R; return sqrt(q * q + y * y) - r; }

/**
 * Mesh an SDF and attach a `cav` (0 crevice … 1 open) attribute.
 * @param {(x,y,z)=>number} f
 * @param {object} o { min, max, cell, smooth, bandScale, aoSteps }
 */
export function meshWithCavity(f, o) {
  const geo = meshSDF(f, { min: o.min, max: o.max, cell: o.cell, smooth: o.smooth ?? 1, bandScale: o.bandScale ?? 1.5 });
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
  const n = pos.length / 3;
  const cav = new Uint8Array(n);
  const aux = new Float32Array(n * 4); // ARCH convention: x cavity (1 = deep), y edge wear, z streak source, w flags
  const steps = o.aoSteps || [0.03, 0.08, 0.16, 0.3];
  const de = o.edgeDelta ?? 0.025;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
    let occ = 0, w = 1;
    for (const s of steps) {
      const dd = f(x + nx * s, y + ny * s, z + nz * s);
      occ += w * max(0, s - dd) / s;
      w *= 0.6;
    }
    const c = clamp(1 - occ * 0.55, 0, 1);
    cav[i] = Math.round(c * 255);
    // convexity → edge wear: inside a convex edge the SDF rises toward the surface faster than -δ
    const din = f(x - nx * de, y - ny * de, z - nz * de);
    const edge = clamp(((din + de) / de) * 2.2, 0, 1);
    aux[i * 4] = 1 - c; aux[i * 4 + 1] = edge; aux[i * 4 + 2] = clamp(0.25 + 0.6 * edge * (ny > -0.2 ? 1 : 0), 0, 1); aux[i * 4 + 3] = 0;
  }
  geo.setAttribute('cav', new THREE.BufferAttribute(cav, 1, true));
  geo.setAttribute('aux', new THREE.BufferAttribute(aux, 4));
  return geo;
}

/** merge geometries that share the same attribute set (position, normal, cav[, index]) */
export function mergeGeos(geos) {
  const list = geos.filter(Boolean);
  if (!list.length) return null;
  const names = Object.keys(list[0].attributes);
  let vcount = 0, icount = 0;
  for (const g of list) { vcount += g.attributes.position.count; icount += g.index ? g.index.count : g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  for (const nm of names) {
    const a0 = list[0].attributes[nm];
    const C = a0.array.constructor;
    const arr = new C(vcount * a0.itemSize);
    let o = 0;
    for (const g of list) { const a = g.attributes[nm]; arr.set(a.array, o); o += a.array.length; }
    out.setAttribute(nm, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  const idx = vcount > 65535 ? new Uint32Array(icount) : new Uint16Array(icount);
  let io = 0, vo = 0;
  for (const g of list) {
    if (g.index) { const s = g.index.array; for (let i = 0; i < s.length; i++) idx[io++] = s[i] + vo; }
    else { for (let i = 0; i < g.attributes.position.count; i++) idx[io++] = i + vo; }
    vo += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

/** apply a Matrix4 to position/normal of a geometry in place (keeps other attributes) */
export function transformGeo(geo, m) {
  geo.applyMatrix4(m);
  return geo;
}
