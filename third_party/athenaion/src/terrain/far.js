// Far-field grid loading (baked or built at runtime) + registration with heightfield.js.
import * as THREE from 'three';
import { loadOrBuild } from '../core/cache.js';
import { generateFarGrid, FAR_VERSION, boxBlur } from './farfield.js';
import { setFarGrid } from '../world/heightfield.js';

export const FAR_NAME = 'terrain-far-' + FAR_VERSION;

export function farToGeometry(g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  geo.setAttribute('h', new THREE.BufferAttribute(g.data, 1));
  geo.setAttribute('spec', new THREE.BufferAttribute(new Float32Array([g.x0, g.z0, g.cell, g.nx, g.nz]), 1));
  return geo;
}
export function farFromGeometry(geo) {
  const s = geo.attributes.spec.array;
  return { x0: s[0], z0: s[1], cell: s[2], nx: Math.round(s[3]), nz: Math.round(s[4]), data: geo.attributes.h.array };
}

/** loads the eroded far grid (or builds a coarse one), registers it for heightAt() and returns it */
export async function loadFarGrid() {
  const t0 = performance.now();
  // ?far=<name> loads generated/<name>.bin instead (mountain lab variants)
  let name = FAR_NAME;
  try {
    const p = globalThis.sessionStorage?.getItem('far') || new URLSearchParams(globalThis.location?.search || '').get('far');
    if (p && /^[\w-]+$/.test(p)) name = p;
  } catch { /* node */ }
  const geo = await loadOrBuild(name, () => farToGeometry(generateFarGrid({ cell: 48, coarse: 96, spIters: 40, drops: 0, fineIters: 1, log: (m) => console.log(m) })));
  const g = farFromGeometry(geo);
  setFarGrid(g);
  console.log(`[terrain] far grid ${g.nx}x${g.nz} @ ${g.cell} m ready in ${Math.round(performance.now() - t0)} ms`);
  return g;
}

// float → half (fast, no allocation per value)
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function toHalf(v) {
  _f[0] = v;
  const x = _u[0];
  const s = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  const m = x & 0x7fffff;
  if (e <= 0) return s;
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | (m >>> 13);
}

/**
 * GPU texture of the far grid: RGBA16F = (normal.x, normal.z, height/8, curvature) with linear filtering.
 * curvature = Laplacian (m) / cell, >0 concave (gullies, couloirs), <0 convex (ribs, crests): mostly measured
 * at the ~100 m scale (blurred field) so snow fields and rock ribs follow the real structure.
 */
export function farTexture(g) {
  const { nx, nz, cell, data } = g;
  const arr = new Uint16Array(nx * nz * 4);
  const hb = boxBlur(data, nx, nz, 3, 2);
  const B = (i, j) => hb[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    const l = data[j * nx + Math.max(0, i - 1)], r = data[j * nx + Math.min(nx - 1, i + 1)];
    const d = data[Math.max(0, j - 1) * nx + i], u = data[Math.min(nz - 1, j + 1) * nx + i];
    const gx = (r - l) / (2 * cell), gz = (u - d) / (2 * cell);
    const il = 1 / Math.sqrt(1 + gx * gx + gz * gz);
    const lapF = (l + r + d + u - 4 * data[c]) / cell;
    const lapB = (B(i - 3, j) + B(i + 3, j) + B(i, j - 3) + B(i, j + 3) - 4 * hb[c]) / cell;
    const lap = 0.35 * lapF + 0.65 * lapB;
    const o = c * 4;
    arr[o] = toHalf(-gx * il); arr[o + 1] = toHalf(-gz * il); arr[o + 2] = toHalf(data[c] / 8); arr[o + 3] = toHalf(lap);
  }
  const tex = new THREE.DataTexture(arr, nx, nz, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
