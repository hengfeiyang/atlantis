// overlay a labelled pixel grid on a ref crop (for landmark reading)
import fs from 'node:fs'; import { PNG } from 'pngjs';
const [inp, x0, y0, w, h, out, step = 50] = process.argv.slice(2);
const img = PNG.sync.read(fs.readFileSync(inp));
const W = +w, H = +h, o = new PNG({ width: W, height: H });
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const sx = +x0 + x, sy = +y0 + y; const si = (sy * img.width + sx) * 4, di = (y * W + x) * 4;
  let r = img.data[si], g = img.data[si + 1], b = img.data[si + 2];
  if ((sx % step === 0) || (sy % step === 0)) { r = 255; g = 255; b = 0; }
  if ((sx % (step * 2) === 0) && (sy % (step * 2) === 0)) { r = 255; g = 0; b = 0; }
  o.data[di] = r; o.data[di + 1] = g; o.data[di + 2] = b; o.data[di + 3] = 255;
}
fs.writeFileSync(out, PNG.sync.write(o));
