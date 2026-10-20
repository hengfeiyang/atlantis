// Node-only CPU raymarch preview of a height grid from a shot camera (fast mountain iteration).
//   import { previewGrid } from './preview.mjs'; previewGrid(grid, shot, 'out.png', { w: 836 })
//   grid = { x0, z0, cell, nx, nz, data: Float32Array }  (heights outside the grid use `outside(x,z)`)
import fs from 'node:fs';
import { PNG } from 'pngjs';

export function previewGrid(grid, shot, out, o = {}) {
  const W = o.w || 836, H = Math.round(W * 941 / 1672);
  const { x0, z0, cell, nx, nz, data } = grid;
  const hAt = (x, z) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return o.outside ? o.outside(x, z) : -50;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * nx + i;
    return (data[k] * (1 - tx) + data[k + 1] * tx) * (1 - tz) + (data[k + nx] * (1 - tx) + data[k + nx + 1] * tx) * tz;
  };
  const p = shot.pos, t = shot.target;
  let f = [t[0] - p[0], t[1] - p[1], t[2] - p[2]]; const fl = Math.hypot(...f); f = f.map((v) => v / fl);
  let r = [-f[2], 0, f[0]]; const rl = Math.hypot(...r); r = r.map((v) => v / rl);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const tanV = Math.tan((shot.fov * Math.PI) / 360), tanH = tanV * W / H;
  const sunAz = ((shot.sun?.azimuth ?? 238) * Math.PI) / 180, sunEl = ((shot.sun?.elevation ?? 21) * Math.PI) / 180;
  const sun = [Math.cos(sunEl) * Math.sin(sunAz), Math.sin(sunEl), -Math.cos(sunEl) * Math.cos(sunAz)];
  const png = new PNG({ width: W, height: H });
  const snowLine = o.snowLine ?? 1650;
  const minT = o.minT ?? 600;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const sx = ((px + 0.5) / W * 2 - 1) * tanH, sy = (1 - (py + 0.5) / H * 2) * tanV;
    let d = [f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy];
    const dl = Math.hypot(...d); d = d.map((v) => v / dl);
    let tt = minT, hit = -1, prev = tt;
    while (tt < 40000) {
      const x = p[0] + d[0] * tt, y = p[1] + d[1] * tt, z = p[2] + d[2] * tt;
      if (y < hAt(x, z)) { hit = tt; break; }
      if (y > 4200 && d[1] > 0) break;
      prev = tt; tt += Math.max(4, tt * 0.0025);
    }
    let col;
    if (hit < 0) {
      const sky = Math.max(0, d[1]);
      col = [0.45 + 0.2 * (1 - sky), 0.6 + 0.15 * (1 - sky), 0.85];
    } else {
      // refine
      let a = prev, b = hit;
      for (let k = 0; k < 10; k++) { const m = (a + b) / 2; const y = p[1] + d[1] * m; if (y < hAt(p[0] + d[0] * m, p[2] + d[2] * m)) b = m; else a = m; }
      const x = p[0] + d[0] * b, z = p[2] + d[2] * b, y = hAt(x, z);
      const e = cell;
      const nxv = -(hAt(x + e, z) - hAt(x - e, z)), nzv = -(hAt(x, z + e) - hAt(x, z - e)), nyv = 2 * e;
      const nl = Math.hypot(nxv, nyv, nzv); const N = [nxv / nl, nyv / nl, nzv / nl];
      let lam = Math.max(0, N[0] * sun[0] + N[1] * sun[1] + N[2] * sun[2]);
      // shadow march toward the sun
      if (lam > 0) {
        let st = 20;
        for (let k = 0; k < 40; k++) {
          const qx = x + sun[0] * st, qy = y + sun[1] * st + 2, qz = z + sun[2] * st;
          if (qy < hAt(qx, qz)) { lam = 0; break; }
          st *= 1.18; if (qy > 3500) break;
        }
      }
      const slope = 1 - N[1];
      const snow = Math.min(1, Math.max(0, (y + 350 * N[1] - snowLine) / 300)) * Math.min(1, Math.max(0, (0.32 - slope) / 0.12));
      const forest = y < 1400 && slope < 0.45 ? 1 : 0;
      let alb = forest ? [0.04, 0.06, 0.03] : [0.32, 0.31, 0.30];
      alb = alb.map((v, i) => v + ([0.85, 0.87, 0.9][i] - v) * snow);
      const amb = [0.25, 0.32, 0.45].map((v) => v * (0.5 + 0.5 * N[1]));
      col = alb.map((a, i) => a * (lam * [1.9, 1.7, 1.45][i] + amb[i] * 1.2));
      // haze
      const tr = Math.exp(-b * 0.00009);
      col = col.map((v, i) => v * tr + [0.55, 0.65, 0.8][i] * (1 - tr));
    }
    const o2 = (py * W + px) * 4;
    for (let i = 0; i < 3; i++) png.data[o2 + i] = Math.min(255, Math.round(255 * Math.pow(Math.min(1, col[i] / (1 + col[i] * 0.3)), 1 / 2.2)));
    png.data[o2 + 3] = 255;
  }
  fs.writeFileSync(out, PNG.sync.write(png));
}
