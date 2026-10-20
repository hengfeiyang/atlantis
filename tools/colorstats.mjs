// Objective colour comparison between a reference and a render.
//   node tools/colorstats.mjs <shotId>            (refs/refN.png vs out/shotN.png)
//   node tools/colorstats.mjs <a.png> <b.png>
// Prints per-region (4x3 grid) mean sRGB, luminance and saturation for both, plus global
// luminance percentiles — use it to match exposure, contrast and palette, not just eyeball it.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let [a, b] = process.argv.slice(2);
if (a && !b) { b = path.join(ROOT, 'out', `shot${a}.png`); a = path.join(ROOT, 'refs', `ref${a}.png`); }

function load(p) { return PNG.sync.read(fs.readFileSync(p)); }
function stats(img, gx = 4, gy = 3) {
  const cells = [];
  const lum = [];
  for (let cy = 0; cy < gy; cy++) for (let cx = 0; cx < gx; cx++) {
    let r = 0, g = 0, bl = 0, s = 0, n = 0;
    const x0 = Math.floor(cx * img.width / gx), x1 = Math.floor((cx + 1) * img.width / gx);
    const y0 = Math.floor(cy * img.height / gy), y1 = Math.floor((cy + 1) * img.height / gy);
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const i = (y * img.width + x) * 4;
      const R = img.data[i], G = img.data[i + 1], Bv = img.data[i + 2];
      r += R; g += G; bl += Bv; n++;
      const mx = Math.max(R, G, Bv), mn = Math.min(R, G, Bv);
      s += mx ? (mx - mn) / mx : 0;
    }
    cells.push({ r: r / n, g: g / n, b: bl / n, s: s / n });
  }
  for (let i = 0; i < img.data.length; i += 4 * 7) lum.push(0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]);
  lum.sort((x, y) => x - y);
  const pct = (p) => lum[Math.floor(p * (lum.length - 1))];
  return { cells, p: { p02: pct(0.02), p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), p98: pct(0.98) } };
}
const A = stats(load(a)), B = stats(load(b));
const f = (c) => `${c.r.toFixed(0).padStart(3)},${c.g.toFixed(0).padStart(3)},${c.b.toFixed(0).padStart(3)} s${(c.s * 100).toFixed(0).padStart(2)}`;
console.log(`REF  = ${path.basename(a)}\nTEST = ${path.basename(b)}\nregion grid 4x3 (row-major, top-left first): ref | test | delta`);
let dl = 0, ds = 0;
for (let i = 0; i < A.cells.length; i++) {
  const r = A.cells[i], t = B.cells[i];
  const lr = 0.2126 * r.r + 0.7152 * r.g + 0.0722 * r.b, lt = 0.2126 * t.r + 0.7152 * t.g + 0.0722 * t.b;
  dl += Math.abs(lr - lt); ds += Math.abs(r.s - t.s);
  console.log(`[${Math.floor(i / 4)},${i % 4}]  ${f(r)} | ${f(t)} | dL ${(lt - lr).toFixed(0).padStart(4)}  dSat ${((t.s - r.s) * 100).toFixed(0).padStart(3)}  dRGB ${(t.r - r.r).toFixed(0)},${(t.g - r.g).toFixed(0)},${(t.b - r.b).toFixed(0)}`);
}
console.log('luminance percentiles  p02  p10  p50  p90  p98');
console.log('  ref                ', Object.values(A.p).map((v) => v.toFixed(0).padStart(4)).join(' '));
console.log('  test               ', Object.values(B.p).map((v) => v.toFixed(0).padStart(4)).join(' '));
console.log(`mean |dL| ${(dl / A.cells.length).toFixed(1)}   mean |dSat| ${(ds / A.cells.length * 100).toFixed(1)}%`);
