// Node-only debugging helper: top-down hillshade map of the heightfield → PNG.
//   node src/terrain/viz.mjs <x0> <z0> <x1> <z1> <px> <out.png> [far]
import fs from 'node:fs';
import { PNG } from 'pngjs';
import * as HF from '../world/heightfield.js';

const [x0, z0, x1, z1, px, out, mode] = process.argv.slice(2);
const X0 = +x0, Z0 = +z0, X1 = +x1, Z1 = +z1, W = +px;
const H = Math.round(W * (Z1 - Z0) / (X1 - X0));
const t0 = performance.now();
const hs = new Float32Array(W * H);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = X0 + (i + 0.5) / W * (X1 - X0), z = Z0 + (j + 0.5) / H * (Z1 - Z0);
  hs[j * W + i] = mode === 'far' ? HF.farHeightBase(x, z) : HF.heightAt(x, z);
}
const ms = performance.now() - t0;
const cell = (X1 - X0) / W;
const png = new PNG({ width: W, height: H });
const sun = [-0.6, 0.55, -0.58]; const sl = Math.hypot(...sun);
let mn = Infinity, mx = -Infinity;
for (const v of hs) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const h = hs[j * W + i];
  const hx = hs[j * W + Math.min(W - 1, i + 1)] - hs[j * W + Math.max(0, i - 1)];
  const hz = hs[Math.min(H - 1, j + 1) * W + i] - hs[Math.max(0, j - 1) * W + i];
  const nx = -hx, ny = 4 * cell, nz = -hz, nl = Math.hypot(nx, ny, nz);
  const lam = Math.max(0.15, (nx * sun[0] + ny * sun[1] + nz * sun[2]) / nl / sl);
  let c;
  if (h < 0) c = [30, 80 + Math.max(-60, h * 3), 110];
  else {
    const t = Math.min(1, h / 3000);
    const base = h > 1700 ? [235, 238, 245] : h > 600 ? [120, 115, 105] : h > 150 ? [95, 110, 70] : [150, 140, 100];
    c = base.map((v) => v * (0.85 + 0.15 * t));
  }
  const o = (j * W + i) * 4;
  png.data[o] = Math.min(255, c[0] * lam); png.data[o + 1] = Math.min(255, c[1] * lam); png.data[o + 2] = Math.min(255, c[2] * lam); png.data[o + 3] = 255;
}
fs.writeFileSync(out, PNG.sync.write(png));
console.log(`wrote ${out} ${W}x${H}, ${(ms / (W * H) * 1000).toFixed(2)} us/sample, h ${mn.toFixed(0)}..${mx.toFixed(0)}`);
