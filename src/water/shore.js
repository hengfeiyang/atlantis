// Distance-to-land field from a captured height map (water module).
// Two-pass chamfer distance transform (3-4 weights ≈ euclidean within ~8%) on the land mask
// h > level, stored in metres (clamped) as a mipmapped half-float texture. The water shader uses it
// for foam lines along quays, moles and islets (surf bands at sea), wet-edge darkening and calm-water
// sheltering next to walls.
import * as THREE from 'three';

/**
 * @param map captureHeightMap() result {data, W, H, bounds}
 * @param {number} level water level
 * @param {number} maxDist clamp (m)
 */
export function buildShoreField(map, level = 0, maxDist = 80) {
  const t0 = performance.now();
  const { data, W, H, bounds } = map;
  const [x0, z0, x1, z1] = bounds;
  const dx = (x1 - x0) / W, dz = (z1 - z0) / H, cell = 0.5 * (dx + dz);
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = data[i] > level + 0.05 ? 0 : INF;
  const a = cell, b = cell * Math.SQRT2;
  // forward pass
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    let v = d[k];
    if (v === 0) continue;
    if (i > 0) v = Math.min(v, d[k - 1] + a);
    if (j > 0) {
      v = Math.min(v, d[k - W] + a);
      if (i > 0) v = Math.min(v, d[k - W - 1] + b);
      if (i < W - 1) v = Math.min(v, d[k - W + 1] + b);
    }
    d[k] = v;
  }
  // backward pass
  for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
    const k = j * W + i;
    let v = d[k];
    if (v === 0) continue;
    if (i < W - 1) v = Math.min(v, d[k + 1] + a);
    if (j < H - 1) {
      v = Math.min(v, d[k + W] + a);
      if (i < W - 1) v = Math.min(v, d[k + W + 1] + b);
      if (i > 0) v = Math.min(v, d[k + W - 1] + b);
    }
    d[k] = v;
  }
  for (let i = 0; i < W * H; i++) d[i] = Math.min(maxDist, d[i]);
  // texture with a CPU mip chain (box filter)
  const toHalf = THREE.DataUtils.toHalfFloat;
  const mips = [];
  let cw = W, ch = H, cur = d;
  for (;;) {
    const h16 = new Uint16Array(cw * ch);
    for (let i = 0; i < cw * ch; i++) h16[i] = toHalf(cur[i]);
    mips.push({ data: h16, width: cw, height: ch });
    if (cw === 1 && ch === 1) break;
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1), nd = new Float32Array(nw * nh);
    for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
      const i0 = Math.min(cw - 1, i * 2), i1 = Math.min(cw - 1, i * 2 + 1), j0 = Math.min(ch - 1, j * 2), j1 = Math.min(ch - 1, j * 2 + 1);
      nd[j * nw + i] = 0.25 * (cur[j0 * cw + i0] + cur[j0 * cw + i1] + cur[j1 * cw + i0] + cur[j1 * cw + i1]);
    }
    cw = nw; ch = nh; cur = nd;
  }
  const tex = new THREE.DataTexture(mips[0].data, W, H, THREE.RedFormat, THREE.HalfFloatType);
  tex.mipmaps = mips;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  function sample(x, z) {
    const fx = (x - x0) / dx - 0.5, fz = (z - z0) / dz - 0.5;
    if (fx < 0 || fz < 0 || fx > W - 1 || fz > H - 1) return maxDist;
    return d[Math.round(fz) * W + Math.round(fx)];
  }
  return { tex, bounds, W, H, data: d, sample, maxDist, ms: Math.round(performance.now() - t0) };
}
