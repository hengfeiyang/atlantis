// Render the 1-minute showcase video (src/video/sequence.js) frame by frame, then encode.
//
//   node tools/render-video.mjs --w 1920 --h 1080 --spp 12 --quality high          full render (resumable)
//   node tools/render-video.mjs --w 640 --h 360 --spp 2 --out out/video_preview     fast motion preview
//   node tools/render-video.mjs --segments 3,4 ...                                  only some segments
//   node tools/render-video.mjs --encode-only [--music path.mp3]                    re-encode existing frames
//
// r6 (director) options — see docs/RENDER.md for the final 4K plan:
//   --spp-seg "1:16,6:12"   per-segment spp override (1-based segment index in SEQUENCE; others use --spp)
//   --frames 0-29           only these frame indices in every selected segment (timing tests)
//   --no-encode             render only (several processes can share one --out: e.g. golden + sunken in parallel)
//   --music <path>          REQUIRED to exist when given (fails loudly); --music-start <s> picks the excerpt
//   --credit "line 1|line 2" end card over black after the picture (only text the film may carry: music attribution)
//   --name file.mp4         output file name inside --out
// Frames are written atomically (tmp + rename); on resume every existing frame is checked for a complete PNG
// (IEND trailer) and re-rendered if truncated. Text cards are rendered by headless Chrome (no ffmpeg drawtext needed).
//
// Frames: <out>/seg<NN>/f<NNNN>.png (existing frames are skipped → safe to stop and resume).
// Encode: each segment → lossless-ish intermediate, cross-dissolves (xfade) between segments, fade in/out,
// optional music (faded in/out, trimmed to picture), H.264 High, yuv420p, BT.709 tags.
import puppeteer from 'puppeteer-core';
import { CHROME, ANGLE, killTree } from './platform.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i]; if (!k.startsWith('--')) continue;
  const n = process.argv[i + 1]; if (n === undefined || n.startsWith('--')) args[k.slice(2)] = true; else { args[k.slice(2)] = n; i++; }
}
const W = Number(args.w || 1920), H = Number(args.h || 1080), SPP = Number(args.spp || 12);
const QUALITY = args.quality || 'high';
const REST_MS = Number(args.rest ?? 0); // athenaion rested 1.5 s per frame for its integrated GPU; not needed on the M3 Ultra
const FRAME_TIMEOUT_MS = Number(args['frame-timeout'] ?? 240) * 1000;
const FRAME_FAILS = new Map();   // "seg:frame" → number of GPU hangs/crashes while rendering it
// --prefail "7:83,7:84" marks frames (1-based segment) that already hung once in an earlier run
for (const s of String(args.prefail || '').split(',').filter(Boolean)) { const [sg, fr] = s.split(':').map(Number); FRAME_FAILS.set(`${sg - 1}:${fr}`, 1); }
let CURRENT_FRAME = null;
const OUT = path.resolve(ROOT, args.out || 'out/video');
fs.mkdirSync(OUT, { recursive: true });
const { FPS, XFADE, SEQUENCE } = await import(pathToFileURL(path.join(ROOT, 'src/video/sequence.js')).href);
const { SHOTS } = await import(pathToFileURL(path.join(ROOT, 'src/world/shots.js')).href);
// the world is built for ONE era per page load: segments are rendered era by era
const eraOfSeg = (i) => SHOTS.find((x) => String(x.id) === String(SEQUENCE[i].shot))?.era || 'golden';
const ERAS = [...new Set(SEQUENCE.map((_, i) => eraOfSeg(i)))];
const segFilter = args.segments ? String(args.segments).split(',').map(Number) : null; // 1-based
// r6: per-segment spp ("1:16,6:12", 1-based) and a frame window for timing tests ("0-29")
const SPP_SEG = new Map(String(args['spp-seg'] || '').split(',').filter(Boolean).map((t) => t.split(':').map(Number)).map(([sg, n]) => [sg - 1, n]));
const sppOf = (i) => SPP_SEG.get(i) || SPP;
const FRANGE = args.frames ? String(args.frames).split('-').map(Number) : null;
const inRange = (f) => !FRANGE || (f >= FRANGE[0] && f <= (FRANGE[1] ?? FRANGE[0]));
{ // disk: PNG frames ≈ 2.5 bytes/px; warn early instead of failing hours in
  const need = SEQUENCE.reduce((a, g) => a + Math.round(g.dur * FPS), 0) * W * H * 2.5 / 1e9;
  try { const st = fs.statfsSync(ROOT); const free = st.bavail * st.bsize / 1e9;
    if (!args['encode-only'] && free < need * 1.2 && !args['prune-frames']) console.log(`[video] WARNING: ${free.toFixed(0)} GB free, frames need ≈ ${need.toFixed(0)} GB — use --prune-frames`); } catch {}
}
if (args.music && args.music !== true && !fs.existsSync(args.music)) { console.error(`[video] music file not found: ${args.music}`); process.exit(2); }


const segDir = (i) => path.join(OUT, `seg${String(i + 1).padStart(2, '0')}`);
const framePath = (i, f) => path.join(segDir(i), `f${String(f).padStart(4, '0')}.png`);
// a frame counts as done only if it is a complete PNG (ends with the IEND chunk): a process killed mid-write
// never leaves a frame that the resume would skip
const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
function frameOk(i, f) {
  const p = framePath(i, f);
  let fd;
  try {
    fd = fs.openSync(p, 'r'); const st = fs.fstatSync(fd); if (st.size < 64) return false;
    const b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, st.size - 8); return b.equals(IEND);
  } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
const segFrames = (i) => Math.round(SEQUENCE[i].dur * FPS);
const allFrames = (i) => { for (let f = 0; f < segFrames(i); f++) if (!fs.existsSync(framePath(i, f))) return false; return true; };
// r6: per-segment intermediates are encoded IN THE BACKGROUND as soon as a segment's frames are complete (while the
// GPU renders the next one). A marker <out>/partNN.done.json records the frames/size/spp it was made from; with
// --prune-frames the PNGs are deleted after a verified part (4K PNGs ≈ 20 MB each = 38 GB for the film).
const partPath = (i) => path.join(OUT, `part${String(i + 1).padStart(2, '0')}.mp4`);
const markerPath = (i) => path.join(OUT, `part${String(i + 1).padStart(2, '0')}.done.json`);
const partDone = (i) => {
  try { const m = JSON.parse(fs.readFileSync(markerPath(i), 'utf8')); return m.frames === segFrames(i) && m.w === W && m.h === H && fs.existsSync(partPath(i)) && fs.statSync(partPath(i)).size === m.bytes; } catch { return false; }
};
const segComplete = (i) => partDone(i) || allFrames(i);
const PRUNE = !!args['prune-frames'];
const partJobs = new Map();
function encodePart(i) {
  if (partJobs.has(i)) return partJobs.get(i);
  const job = (async () => {
    if (partDone(i)) {
      // marker says done: the part is valid unless frames were re-rendered after it
      let newest = 0; for (let f = 0; f < segFrames(i); f++) { try { newest = Math.max(newest, fs.statSync(framePath(i, f)).mtimeMs); } catch {} }
      if (newest < fs.statSync(partPath(i)).mtimeMs) { if (PRUNE) pruneFrames(i); return; }
    }
    if (!allFrames(i)) return;
    const tmp = partPath(i).replace(/\.mp4$/, '.tmp.mp4');
    const t0 = Date.now();
    await new Promise((res, rej) => {
      // niced: the background encode must not steal CPU from the page (JS + PNG encoding of the next frames)
      const p = spawn('nice', ['-n', '10', 'ffmpeg', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(segDir(i), 'f%04d.png'), '-vf', `scale=${W}:${H}:flags=lanczos`,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '10', '-pix_fmt', 'yuv444p', tmp], { stdio: ['ignore', 'inherit', 'inherit'] });
      p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg part ${i + 1} exit ${c}`))));
    });
    const n = Number(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', tmp]).toString().trim());
    if (n !== segFrames(i)) throw new Error(`part ${i + 1}: ${n} frames, expected ${segFrames(i)}`);
    fs.renameSync(tmp, partPath(i));
    fs.writeFileSync(markerPath(i), JSON.stringify({ frames: n, w: W, h: H, spp: sppOf(i), quality: QUALITY, bytes: fs.statSync(partPath(i)).size, time: new Date().toISOString() }));
    console.log(`[video] part ${i + 1} encoded (${n} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    if (PRUNE) pruneFrames(i);
  })().catch((e) => { console.log(`[video] ERROR ${e.message}`); throw e; }).finally(() => partJobs.delete(i)); // memoise in-flight jobs only
  partJobs.set(i, job);
  return job;
}
function pruneFrames(i) {
  let k = 0; for (let f = 0; f < segFrames(i); f++) { try { fs.rmSync(framePath(i, f)); k++; } catch {} }
  if (k) console.log(`[video] seg${i + 1}: pruned ${k} frames (part verified)`);
}

// ------------------------------------------------------------------ GPU lock (same scheme as render.mjs)
const LOCKDIR = path.join(ROOT, 'out');
const SLOTS = Number(process.env.GPU_SLOTS || 6);
let lockPath = null;
async function acquire() {
  for (;;) {
    for (let s = 0; s < SLOTS; s++) {
      const p = path.join(LOCKDIR, '.gpu.lock.' + s);
      try { const fd = fs.openSync(p, 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now(), args: 'render-video' })); fs.closeSync(fd); lockPath = p; return; }
      catch (e) { if (e.code !== 'EEXIST') throw e; try { const info = JSON.parse(fs.readFileSync(p, 'utf8')); process.kill(info.pid, 0); } catch { try { fs.rmSync(p, { force: true }); } catch {} } }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
const release = () => { try { if (lockPath) { const i = JSON.parse(fs.readFileSync(lockPath, 'utf8')); if (i.pid === process.pid) fs.rmSync(lockPath, { force: true }); } } catch {} };
process.on('exit', release);
process.on('SIGINT', () => { release(); process.exit(130); });

async function renderFrames() {
  const server = await startServer(0);
  await acquire();
  let browser = null;
  const killBrowser = async () => {
    if (!browser) return;
    const pid = browser.process()?.pid;
    await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    // kill the whole Chrome process tree (GPU process included) so no GPU memory stays allocated
    if (pid) { killTree(pid); }
    browser = null;
  };
  process.on('exit', () => { const pid = browser?.process()?.pid; if (pid) { killTree(pid); } });
  for (let attempt = 1; ; attempt++) {
    try {
      let left = 0;
      for (const era of ERAS) {
        left += await renderAttempt(server, (b) => { browser = b; }, era);
        await killBrowser();
      }
      if (left === 0) break;
    } catch (e) {
      if (CURRENT_FRAME) FRAME_FAILS.set(CURRENT_FRAME, (FRAME_FAILS.get(CURRENT_FRAME) || 0) + 1);
      CURRENT_FRAME = null;
      console.log(`[video] attempt ${attempt} failed: ${e.message} — restarting the browser in 20 s`);
      await killBrowser();
      if (attempt >= 40) throw e;
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
  await server.close();
  release();
  if (!FRANGE) for (let i = 0; i < SEQUENCE.length; i++) if (!segFilter || segFilter.includes(i + 1)) encodePart(i).catch(() => {});
  await Promise.all([...partJobs.values()]);
}

async function renderAttempt(server, setBrowser, era) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 24 * 3600 * 1000,
    args: ['--use-angle=' + (ANGLE), '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--js-flags=--max-old-space-size=16384', '--no-sandbox'],
    defaultViewport: { width: 1280, height: 720 },
  });
  setBrowser(browser);
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('Failed to load resource')) console.log('[page:error]', t); });
  page.on('pageerror', (e) => console.log('[page:error]', e.message));
  const segsOfEra = SEQUENCE.map((_, i) => i).filter((i) => eraOfSeg(i) === era && (!segFilter || segFilter.includes(i + 1)));
  const segsTodo = segsOfEra.filter((i) => !partDone(i));
  for (const i of segsOfEra) if (!FRANGE) encodePart(i).catch(() => {}); // already-complete segments: encode in the background
  const pending = segsTodo.some((i) => { for (let f = 0; f < segFrames(i); f++) if (inRange(f) && !frameOk(i, f)) return true; return false; });
  if (!pending) return 0;
  const qs = new URLSearchParams({ quality: QUALITY, w: String(W), h: String(H), mode: 'still', era, shot: String(SEQUENCE[segsOfEra[0]].shot) });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${server.port}/index.html?${qs}`, { waitUntil: 'load', timeout: 3600 * 1000 });
  await page.waitForFunction('window.__READY === true || !!window.__RENDER_ERROR', { timeout: 3600 * 1000, polling: 500 });
  const err = await page.evaluate(() => window.__RENDER_ERROR || null);
  if (err) throw new Error(err);
  const info = await page.evaluate(() => window.__videoInfo());
  console.log(`[video] ${era} world ready in ${((Date.now() - t0) / 1000).toFixed(0)} s — ${segsOfEra.length}/${info.segments.length} segments, ${W}x${H}, ${SPP} spp${SPP_SEG.size ? ' (overrides ' + [...SPP_SEG].map(([k, v]) => `${k + 1}:${v}`).join(',') + ')' : ''}, quality ${QUALITY}`);
  const jobs = [];
  info.segments.forEach((s, i) => { if (!segsTodo.includes(i)) return; for (let f = 0; f < s.frames; f++) if (inRange(f)) jobs.push([i, f]); });
  const todo = jobs.filter(([i, f]) => !frameOk(i, f));
  console.log(`[video] ${jobs.length} frames, ${jobs.length - todo.length} already done, ${todo.length} to render`);
  let n = 0; const tStart = Date.now();
  for (const [i, f] of todo) {
    fs.mkdirSync(segDir(i), { recursive: true });
    const key = `${i}:${f}`;
    const fails = FRAME_FAILS.get(key) || 0;
    if (fails >= 2) {
      // this frame hung the GPU twice: hold the previous frame (1/30 s) instead of losing the deadline
      const src = f > 0 ? framePath(i, f - 1) : framePath(i, f + 1);
      if (fs.existsSync(src)) { fs.copyFileSync(src, framePath(i, f)); console.log(`[video] seg${i + 1} f${f}: held neighbour frame after 2 GPU hangs`); n++; continue; }
    }
    // disk guard (the volume is shared with other projects): below --min-free GB (default 4) wait instead of failing
    if (n % 10 === 0) {
      const minFree = Number(args['min-free'] ?? 4);
      for (let w = 0; ; w++) {
        let free = Infinity; try { const st = fs.statfsSync(OUT); free = st.bavail * st.bsize / 1e9; } catch {}
        if (free >= minFree) break;
        if (w % 5 === 0) console.log(`[video] WARNING: only ${free.toFixed(1)} GB free (< ${minFree}) — paused, free some disk space`);
        await new Promise((r) => setTimeout(r, 60000));
      }
    }
    CURRENT_FRAME = key;
    // watchdog: a hung GPU (no driver watchdog in this browser config) would stall forever → restart instead
    let timer;
    const url = await Promise.race([
      // 2nd try of a frame that hung: shift the animation clock slightly (hangs so far were time-specific)
      page.evaluate(async (i, f, spp, ts) => await window.__renderVideoFrame(i, f, spp, ts), i, f, sppOf(i), fails ? 0.37 : 0),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`frame seg${i + 1} f${f} timed out`)), FRAME_TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer));
    CURRENT_FRAME = null;
    const tmp = framePath(i, f) + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(url.split(',')[1], 'base64'));
    fs.renameSync(tmp, framePath(i, f)); // atomic: a frame file is either absent or complete
    if (f === segFrames(i) - 1 && !FRANGE) encodePart(i).catch(() => {}); // segment done → its part encodes while the GPU moves on
    n++;
    // GPU care: short idle after every frame (thermals on the integrated GPU, keeps the desktop responsive)
    if (REST_MS > 0) await new Promise((r) => setTimeout(r, REST_MS));
    if (n % 10 === 0 || n === todo.length) {
      const per = (Date.now() - tStart) / n / 1000;
      const eta = (todo.length - n) * per;
      console.log(`[video] ${n}/${todo.length} frames  ${per.toFixed(1)} s/frame  ETA ${(eta / 3600).toFixed(2)} h  (seg ${i + 1} f${f})`);
    }
  }
  return 0;
}

// r6: text cards (title / end credit) rendered as PNGs by headless Chrome — this ffmpeg build has no drawtext.
// lines: [{ text, size (fraction of H), color, spacing (letter-spacing em) }]
async function renderCard(file, lines) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'], defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
  try {
    const page = await browser.newPage();
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const html = `<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Didot,'Bodoni 72','Palatino',serif;">` +
      lines.map((l) => `<div style="color:${l.color};font-size:${Math.round(H * l.size)}px;letter-spacing:${l.spacing || 0}em;line-height:1.5;text-align:center;">${esc(l.text)}</div>`).join('') + '</body></html>';
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
  } finally { const pid = browser.process()?.pid; await browser.close().catch(() => {}); if (pid) killTree(pid); }
}

async function encode() {
  const ff = (a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });
  const segs = SEQUENCE.map((s, i) => ({ ...s, i, frames: segFrames(i) })).filter((s) => segComplete(s.i));
  if (!segs.length) { console.log('[video] no complete segments to encode'); return; }
  if (segs.length < SEQUENCE.length) console.log(`[video] WARNING: only ${segs.length}/${SEQUENCE.length} segments complete — encoding those`);
  // 1) each segment → high-quality intermediate (encoded already during the render, or now)
  for (const s of segs) await encodePart(s.i);
  const parts = segs.map((s) => ({ p: partPath(s.i), dur: s.frames / FPS }));
  // 2) cross-dissolves
  const inputs = parts.flatMap((p) => ['-i', p.p]);
  let filter = '', last = '[0:v]', acc = parts[0].dur;
  for (let k = 1; k < parts.length; k++) {
    const xf = segs[k - 1].xfade ?? XFADE;   // r4: per-transition dissolve (sequence.js `xfade`)
    const off = (acc - xf).toFixed(3);
    filter += `${last}[${k}:v]xfade=transition=fade:duration=${xf}:offset=${off}[v${k}];`;
    last = `[v${k}]`; acc = acc + parts[k].dur - xf;
  }
  const pictureDur = acc;
  const music = args.music && args.music !== true ? args.music : null;
  // optional title card before the picture (--title [--subtitle]) and an end card after it (--endtitle and/or
  // --credit "line|line"). The ATLANTIS film carries NO text except the music credit when the licence requires it.
  const PRE = args.title ? 3.6 : 0;
  // --credit-file <txt>: the credit lines from a file (blank lines and "Source:" lines skipped), e.g. audio/CREDITS.txt
  if (args['credit-file']) args.credit = fs.readFileSync(args['credit-file'], 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^source:/i.test(l)).join('|');
  const POST = args.endtitle || args.credit ? Number(args['card-dur'] || 4.0) : 0;
  const total = PRE + pictureDur + POST;
  const norm = `format=yuv444p,setsar=1,fps=${FPS},settb=1/${FPS}`;
  let nIn = parts.length;
  const cardIn = [];
  let pre = '', post = '';
  if (PRE) {
    const f = path.join(OUT, 'card_title.png');
    await renderCard(f, [{ text: args.title, size: 0.058, color: '#EDE3CF', spacing: 0.35 }, ...(args.subtitle ? [{ text: args.subtitle, size: 0.021, color: '#C9B48A' }] : [])]);
    cardIn.push('-loop', '1', '-framerate', String(FPS), '-t', PRE.toFixed(3), '-i', f);
    filter += `[${nIn}:v]${norm},fade=t=in:st=0.5:d=0.9,fade=t=out:st=${(PRE - 1.15).toFixed(3)}:d=0.9[vpre];`; pre = '[vpre]'; nIn++;
  }
  if (POST) {
    const f = path.join(OUT, 'card_end.png');
    const lines = [];
    if (args.endtitle) lines.push({ text: args.endtitle, size: 0.044, color: '#EDE3CF', spacing: 0.35 });
    if (args.credit) for (const t of String(args.credit).split('|')) lines.push({ text: t.trim(), size: 0.021, color: '#B9AD98', spacing: 0.04 });
    await renderCard(f, lines);
    cardIn.push('-loop', '1', '-framerate', String(FPS), '-t', POST.toFixed(3), '-i', f);
    filter += `[${nIn}:v]${norm},fade=t=in:st=0.3:d=0.8,fade=t=out:st=${(POST - 1.0).toFixed(3)}:d=0.8[vpost];`; post = '[vpost]'; nIn++;
  }
  // the picture opens almost immediately (the first frames are the hook) and fades to black at the end
  filter += `${last}${norm},fade=t=in:st=0:d=${PRE ? 1.2 : 0.35},fade=t=out:st=${(pictureDur - 1.6).toFixed(3)}:d=1.6[vpic];`;
  const chain = [pre, '[vpic]', post].filter(Boolean);
  filter += chain.length > 1 ? `${chain.join('')}concat=n=${chain.length}:v=1:a=0,format=yuv420p[vout]` : `[vpic]format=yuv420p[vout]`;
  const outFile = path.join(OUT, args.name || `atlantis_${W}x${H}.mp4`);
  const a = [...inputs, ...cardIn];
  if (music) a.push('-i', music);
  // music: --music-start <s> picks the excerpt (0 = the track's own intro, which needs only a tiny fade-in);
  // --music-fade-in / --music-fade <s> (fade-out at the very end, across the end card); padded with silence if
  // shorter than the film. Loudness: TWO-PASS LINEAR gain (measured integrated loudness of the faded excerpt →
  // --lufs target, default -16) + a peak limiter at -2.5 dBFS (true peak ≈ -1.5 dBTP): the track's own dynamics (quiet folk → triumphant
  // final section) are kept; single-pass loudnorm squashed LRA 15 → 5 LU.
  const mStart = Number(args['music-start'] || 0);
  const fadeIn = Number(args['music-fade-in'] ?? (mStart > 0 ? 1.5 : 0.2));
  const mFade = Number(args['music-fade'] || 3.5);
  const mPre = `atrim=${mStart}:${(mStart + total).toFixed(3)},asetpts=PTS-STARTPTS,apad=whole_dur=${total.toFixed(3)},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${(total - mFade).toFixed(3)}:d=${mFade}`;
  let audio = '';
  if (music) {
    let inI = -16;
    try {
      const r = spawnSync('ffmpeg', ['-hide_banner', '-i', music, '-af', `${mPre},loudnorm=print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
      inI = Number(JSON.parse(r.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]).input_i);
    } catch (e) { console.log('[video] WARNING: loudness measurement failed, using 0 dB gain', e.message); }
    const target = Number(args.lufs ?? -16);
    const gain = Math.max(-20, Math.min(12, target - inI));
    console.log(`[video] music ${path.basename(music)} from ${mStart} s: ${inI.toFixed(1)} LUFS → gain ${gain.toFixed(1)} dB (target ${target}), limiter -2.5 dBFS`);
    audio = `;[${nIn}:a]${mPre},volume=${gain.toFixed(2)}dB,alimiter=limit=0.75:level=disabled:latency=1,aresample=48000,atrim=0:${total.toFixed(3)}[aout]`;
  }
  a.push('-filter_complex', filter + audio);
  a.push('-map', '[vout]');
  if (music) a.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '256k');
  a.push('-c:v', 'libx264', '-preset', 'slow', '-crf', String(args.crf || 14), '-profile:v', 'high', '-r', String(FPS),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', outFile);
  ff(a);
  if (H > 1080) {
    // shareable 1080p version next to the high-res master
    const hd = outFile.replace(/\.mp4$/, '_1080p.mp4');
    ff(['-i', outFile, '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high',
      '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'copy', '-movflags', '+faststart', hd]);
    console.log(`[video] wrote ${path.relative(ROOT, hd)}`);
  }
  console.log(`[video] wrote ${path.relative(ROOT, outFile)} (${total.toFixed(1)} s${music ? ', with music' : ''}${POST ? ', end card' : ''})`);
}

if (!args['encode-only']) await renderFrames();
if (!args['no-encode']) await encode();
