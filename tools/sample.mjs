// Sample average sRGB colour of 11x11 patches: node tools/sample.mjs <img.png> x,y x,y ...
import fs from 'node:fs';
import { PNG } from 'pngjs';
const [file, ...pts] = process.argv.slice(2);
const img = PNG.sync.read(fs.readFileSync(file));
for (const p of pts) {
  const [x, y, label = ''] = p.split(',');
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
    const xx = Math.min(img.width - 1, Math.max(0, +x + dx)), yy = Math.min(img.height - 1, Math.max(0, +y + dy));
    const i = (yy * img.width + xx) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
  }
  const hex = '#' + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
  console.log(`${label.padEnd(18)} (${x},${y})  ${hex}  rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`);
}
