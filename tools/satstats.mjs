// Global colourfulness comparison: mean saturation (HSV), mean chroma (Lab-ish), colourfulness (Hasler-Süsstrunk)
//   node tools/satstats.mjs refs/ref3.png out/final/shot3.png
import fs from 'node:fs';
import { PNG } from 'pngjs';
function stats(p) {
  const img = PNG.sync.read(fs.readFileSync(p)); const d = img.data;
  let s = 0, n = 0, rgs = 0, ybs = 0, rg2 = 0, yb2 = 0, warm = 0;
  for (let i = 0; i < d.length; i += 4 * 5) {
    const r = d[i], g = d[i + 1], b = d[i + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    s += mx ? (mx - mn) / mx : 0; const rg = r - g, yb = 0.5 * (r + g) - b; rgs += rg; ybs += yb; rg2 += rg * rg; yb2 += yb * yb; n++;
  }
  const mrg = rgs / n, myb = ybs / n, srg = Math.sqrt(rg2 / n - mrg * mrg), syb = Math.sqrt(yb2 / n - myb * myb);
  const colourfulness = Math.sqrt(srg * srg + syb * syb) + 0.3 * Math.sqrt(mrg * mrg + myb * myb);
  return { sat: (s / n * 100).toFixed(1), colourfulness: colourfulness.toFixed(1), warmth_yb: myb.toFixed(1), rg: mrg.toFixed(1) };
}
const [a, b] = process.argv.slice(2);
console.log('ref ', JSON.stringify(stats(a)));
console.log('test', JSON.stringify(stats(b)));
