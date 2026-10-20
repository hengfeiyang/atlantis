// Top-down map of heightAt() (+ optional camera frusta from shots.js) → out/map.png
//   node tools/map.mjs [--size 2400] [--px 1024] [--cx 0 --cz 0] [--shots 1,2,3] [--out out/map.png]
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { heightAt } from '../src/world/heightfield.js';
import { SHOTS } from '../src/world/shots.js';
const a = {}; for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].slice(2)] = process.argv[i + 1];
const S = Number(a.size || 2400), N = Number(a.px || 1024), cx = Number(a.cx || 0), cz = Number(a.cz || 0);
const png = new PNG({ width: N, height: N });
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = cx + (i / N - 0.5) * S, z = cz + (j / N - 0.5) * S, h = heightAt(x, z);
  let c;
  if (h < 0) { const t = Math.min(1, -h / 60); c = [20 + 40 * (1 - t), 90 + 90 * (1 - t), 140 + 80 * (1 - t)]; }
  else { const t = Math.min(1, h / 60); c = [120 + 120 * t, 130 + 100 * t, 90 + 120 * t]; if (Math.abs((h % 5)) < 0.35) c = c.map((v) => v * 0.8); }
  const k = (j * N + i) * 4; png.data[k] = c[0]; png.data[k + 1] = c[1]; png.data[k + 2] = c[2]; png.data[k + 3] = 255;
}
const put = (x, z, col) => { const i = Math.round(((x - cx) / S + 0.5) * N), j = Math.round(((z - cz) / S + 0.5) * N); if (i < 0 || j < 0 || i >= N || j >= N) return; const k = (j * N + i) * 4; png.data[k] = col[0]; png.data[k + 1] = col[1]; png.data[k + 2] = col[2]; };
const ids = (a.shots || SHOTS.map((s) => s.id).join(',')).split(',');
for (const s of SHOTS.filter((s) => ids.includes(String(s.id)))) {
  const col = s.era === 'sunken' ? [255, 60, 200] : [255, 40, 40];
  const dx = s.target[0] - s.pos[0], dz = s.target[2] - s.pos[2], d = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
  const hf = Math.atan(Math.tan((s.fov * Math.PI) / 360) * 1672 / 941);
  for (const e of [-hf, hf]) for (let t = 0; t < S * 0.6; t += S / N / 2) put(s.pos[0] + Math.sin(yaw + e) * t, s.pos[2] + Math.cos(yaw + e) * t, col);
  for (let t = 0; t < 8; t++) for (let u = -t; u <= t; u++) put(s.pos[0] + u * S / N, s.pos[2] + (t - 4) * S / N, [255, 255, 0]);
}
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync(a.out || 'out/map.png', PNG.sync.write(png));
console.log('wrote', a.out || 'out/map.png');
