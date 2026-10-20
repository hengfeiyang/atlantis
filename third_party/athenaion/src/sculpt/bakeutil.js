// Helpers to turn sculpt SDFs into baked, attribute-rich geometry.
//   color attribute (Uint8 normalized): r = ambient occlusion (1 = open), g = cavity/grime (1 = deep crevice),
//                                       b = gilding mask (1 = gold leaf, ~0.6 = darker bronze)
import * as THREE from 'three';
import { meshSDF } from './mesher.js';

/** mesh an SDF inside a box with a target cell size; projection keeps details crisp */
export function meshRegion(sdf, bounds, cell, opts = {}) {
  const pad = cell * 2;
  const min = bounds.min.map((v) => v - pad), max = bounds.max.map((v) => v + pad);
  return meshSDF(sdf, { min, max, cell, smooth: opts.smooth ?? 1, smoothFactor: opts.smoothFactor ?? 0.45, project: opts.project ?? 1, bandScale: opts.bandScale ?? 1.6 });
}

/**
 * Bake AO / cavity / gold into a Uint8 'color' attribute.
 * aoDist: max occlusion probe distance (SDF units); sdf: the FULL scene sdf (incl. separately meshed parts)
 */
export function bakeAttributes(geo, sdf, goldFn, { aoDist = 0.12, cavDist = 0.012, extraOcc = null } = {}) {
  const P = geo.attributes.position.array, N = geo.attributes.normal.array;
  const n = P.length / 3;
  const col = new Uint8Array(n * 3);
  const steps = [0.06, 0.15, 0.3, 0.55, 1.0];
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    // normal-direction occlusion
    let occ = 0, wsum = 0;
    for (let s = 0; s < steps.length; s++) {
      const h = steps[s] * aoDist;
      const d = sdf(x + nx * h, y + ny * h, z + nz * h);
      const w = 1 / (1 + s * 0.6);
      occ += w * Math.max(0, Math.min(1, (h - d) / h));
      wsum += w;
    }
    occ /= wsum;
    // a couple of tilted probes (catch occlusion from neighbouring folds / the ground)
    let side = 0;
    const t1 = Math.abs(ny) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ax = ny * t1[2] - nz * t1[1], ay = nz * t1[0] - nx * t1[2], az = nx * t1[1] - ny * t1[0];
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
    const dirs = [[ax, ay, az], [-ax, -ay, -az], [bx, by, bz], [-bx, -by, -bz]];
    for (const [dx, dy, dz] of dirs) {
      const h = aoDist * 0.45;
      const vx = nx * 0.7 + dx * 0.7, vy = ny * 0.7 + dy * 0.7, vz = nz * 0.7 + dz * 0.7;
      const d = sdf(x + vx * h, y + vy * h, z + vz * h);
      side += Math.max(0, Math.min(1, (h * 0.75 - d) / (h * 0.75)));
    }
    side /= 4;
    // ground contact (y≈0 plane is not in the SDF)
    let ground = 0;
    if (extraOcc) ground = extraOcc(x, y, z, nx, ny, nz);
    let ao = 1 - Math.min(1, occ * 1.25 + side * 0.45 + ground);
    ao = Math.max(0.05, ao);
    // cavity: how much the surface is "inside" at a small offset
    const dc = sdf(x + nx * cavDist, y + ny * cavDist, z + nz * cavDist);
    const cav = Math.max(0, Math.min(1, 1 - dc / cavDist));
    const g = goldFn ? goldFn(x, y, z) : 0;
    col[i * 3] = Math.round(ao * 255);
    col[i * 3 + 1] = Math.round(cav * 255);
    col[i * 3 + 2] = Math.round(Math.max(0, Math.min(1, g)) * 255);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  return geo;
}

/** merge indexed geometries that share the same attribute set (position, normal, color[, uv]) */
export function mergeGeos(list) {
  const geos = list.filter(Boolean);
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const names = Object.keys(geos[0].attributes).filter((k) => geos.every((g) => g.attributes[k]));
  const out = new THREE.BufferGeometry();
  for (const k of names) {
    const a0 = geos[0].attributes[k];
    const C = a0.array.constructor;
    const arr = new C(nv * a0.itemSize);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let o = 0, base = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    if (g.index) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[o++] = ia[i] + base; }
    else for (let i = 0; i < n; i++) idx[o++] = i + base;
    base += n;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

/** add a constant color attribute (ao=1, cavity=0, gold=g) to a plain three geometry, converting to indexed */
export function withColor(geo, ao = 1, cav = 0, gold = 0) {
  let g = geo.index ? geo : geo;
  const n = g.attributes.position.count;
  const col = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = ao * 255; col[i * 3 + 1] = cav * 255; col[i * 3 + 2] = gold * 255; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.index) {
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return g;
}

/** uniformly scale + translate a geometry in place */
export function scaleGeo(geo, s, off = [0, 0, 0]) {
  const p = geo.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) { p[i] = p[i] * s + off[0]; p[i + 1] = p[i + 1] * s + off[1]; p[i + 2] = p[i + 2] * s + off[2]; }
  geo.attributes.position.needsUpdate = true;
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

export function triCount(geo) { return (geo.index ? geo.index.count : geo.attributes.position.count) / 3; }
