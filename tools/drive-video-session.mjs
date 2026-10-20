// Render missing video frames through an already-running (warm) tools/session.mjs instance.
//   node tools/drive-video-session.mjs --port 9620 --out out/video4k --segments 7,8 --spp 4 [--rest 300]
// Frames land in <out>/segNN/fNNNN.png exactly like tools/render-video.mjs (so its --encode-only works after).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i]; if (!k.startsWith('--')) continue;
  const n = process.argv[i + 1]; if (n === undefined || n.startsWith('--')) args[k.slice(2)] = true; else { args[k.slice(2)] = n; i++; }
}
const PORT = Number(args.port || 9620), SPP = Number(args.spp || 4), REST = Number(args.rest ?? 300);
const OUT = path.resolve(ROOT, args.out || 'out/video4k');
const { FPS, SEQUENCE } = await import(pathToFileURL(path.join(ROOT, 'src/video/sequence.js')).href);
const segs = String(args.segments || '').split(',').filter(Boolean).map(Number); // 1-based
const framePath = (i, f) => path.join(OUT, `seg${String(i + 1).padStart(2, '0')}`, `f${String(f).padStart(4, '0')}.png`);

async function evalPage(expr) {
  // the session may still be building the world: retry the connection for up to 30 min
  let r;
  for (let k = 0; ; k++) {
    try { r = await fetch(`http://127.0.0.1:${PORT}/eval`, { method: 'POST', body: JSON.stringify({ expr }) }); break; }
    catch (e) { if (k > 900) throw e; await new Promise((res) => setTimeout(res, 2000)); }
  }
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'eval failed');
  return j.value;
}

const jobs = [];
SEQUENCE.forEach((s, i) => { if (segs.length && !segs.includes(i + 1)) return; const n = Math.round(s.dur * FPS); for (let f = 0; f < n; f++) if (!fs.existsSync(framePath(i, f))) jobs.push([i, f]); });
console.log(`[drive] ${jobs.length} frames to render via session :${PORT}`);
const t0 = Date.now(); let n = 0;
const fails = new Map();
for (const [i, f] of jobs) {
  fs.mkdirSync(path.dirname(framePath(i, f)), { recursive: true });
  let url = null;
  for (;;) {
    try {
      url = await evalPage(`__renderVideoFrame(${i}, ${f}, ${SPP})`);
      if (typeof url !== 'string' || !url.startsWith('data:image/png')) throw new Error(`bad frame ${i}:${f}`);
      break;
    } catch (e) {
      const k = `${i}:${f}`; fails.set(k, (fails.get(k) || 0) + 1);
      console.log(`[drive] seg${i + 1} f${f} failed (${e.message}) — reloading the session world`);
      if (fails.get(k) >= 2 && f > 0 && fs.existsSync(framePath(i, f - 1))) { url = null; break; }
      const r = await fetch(`http://127.0.0.1:${PORT}/reload`, { method: 'POST' });
      if (!r.ok) throw new Error('session reload failed');
    }
  }
  if (url) fs.writeFileSync(framePath(i, f), Buffer.from(url.split(',')[1], 'base64'));
  else { fs.copyFileSync(framePath(i, f - 1), framePath(i, f)); console.log(`[drive] seg${i + 1} f${f}: held previous frame`); }
  n++;
  if (REST) await new Promise((r) => setTimeout(r, REST));
  if (n % 10 === 0 || n === jobs.length) {
    const per = (Date.now() - t0) / n / 1000;
    console.log(`[drive] ${n}/${jobs.length} frames  ${per.toFixed(1)} s/frame  ETA ${((jobs.length - n) * per / 3600).toFixed(2)} h  (seg ${i + 1} f${f})`);
  }
}
console.log('[drive] DONE');
