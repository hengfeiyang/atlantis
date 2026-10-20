// Render the 1-minute showcase video (src/video/sequence.js) frame by frame, then encode.
//
//   node tools/render-video.mjs --w 1920 --h 1080 --spp 12 --quality high          full render (resumable)
//   node tools/render-video.mjs --w 640 --h 360 --spp 2 --out out/video_preview     fast motion preview
//   node tools/render-video.mjs --segments 3,4 ...                                  only some segments
//   node tools/render-video.mjs --encode-only [--music path.mp3]                    re-encode existing frames
//
// Frames: <out>/seg<NN>/f<NNNN>.png (existing frames are skipped → safe to stop and resume).
// Encode: each segment → lossless-ish intermediate, cross-dissolves (xfade) between segments, fade in/out,
// optional music (faded in/out, trimmed to picture), H.264 High, yuv420p, BT.709 tags.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
const REST_MS = Number(args.rest ?? 1500);
const FRAME_TIMEOUT_MS = Number(args['frame-timeout'] ?? 240) * 1000;
const FRAME_FAILS = new Map();   // "seg:frame" → number of GPU hangs/crashes while rendering it
// --prefail "7:83,7:84" marks frames (1-based segment) that already hung once in an earlier run
for (const s of String(args.prefail || '').split(',').filter(Boolean)) { const [sg, fr] = s.split(':').map(Number); FRAME_FAILS.set(`${sg - 1}:${fr}`, 1); }
let CURRENT_FRAME = null;
const OUT = path.resolve(ROOT, args.out || 'out/video');
fs.mkdirSync(OUT, { recursive: true });
const { FPS, XFADE, SEQUENCE } = await import(pathToFileURL(path.join(ROOT, 'src/video/sequence.js')).href);
const segFilter = args.segments ? String(args.segments).split(',').map(Number) : null; // 1-based

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const segDir = (i) => path.join(OUT, `seg${String(i + 1).padStart(2, '0')}`);
const framePath = (i, f) => path.join(segDir(i), `f${String(f).padStart(4, '0')}.png`);

// ------------------------------------------------------------------ GPU lock (same scheme as render.mjs)
const LOCKDIR = path.join(ROOT, 'out');
const SLOTS = Number(process.env.GPU_SLOTS || 4);
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
    if (pid) { try { execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' }); } catch {} }
    browser = null;
  };
  process.on('exit', () => { const pid = browser?.process()?.pid; if (pid) { try { execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' }); } catch {} } });
  for (let attempt = 1; ; attempt++) {
    try {
      const left = await renderAttempt(server, (b) => { browser = b; });
      await killBrowser();
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
}

async function renderAttempt(server, setBrowser) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 24 * 3600 * 1000,
    args: ['--use-angle=' + (process.env.ANGLE || 'd3d11'), '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--js-flags=--max-old-space-size=16384', '--no-sandbox'],
    defaultViewport: { width: 1280, height: 720 },
  });
  setBrowser(browser);
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('Failed to load resource')) console.log('[page:error]', t); });
  page.on('pageerror', (e) => console.log('[page:error]', e.message));
  const qs = new URLSearchParams({ quality: QUALITY, w: String(W), h: String(H), mode: 'still', shot: '1' });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${server.port}/index.html?${qs}`, { waitUntil: 'load', timeout: 3600 * 1000 });
  await page.waitForFunction('window.__READY === true || !!window.__RENDER_ERROR', { timeout: 3600 * 1000, polling: 500 });
  const err = await page.evaluate(() => window.__RENDER_ERROR || null);
  if (err) throw new Error(err);
  const info = await page.evaluate(() => window.__videoInfo());
  console.log(`[video] world ready in ${((Date.now() - t0) / 1000).toFixed(0)} s — ${info.segments.length} segments, ${W}x${H}, ${SPP} spp`);
  const jobs = [];
  info.segments.forEach((s, i) => { if (segFilter && !segFilter.includes(i + 1)) return; for (let f = 0; f < s.frames; f++) jobs.push([i, f]); });
  const todo = jobs.filter(([i, f]) => !fs.existsSync(framePath(i, f)));
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
    CURRENT_FRAME = key;
    // watchdog: a hung GPU (no driver watchdog in this browser config) would stall forever → restart instead
    let timer;
    const url = await Promise.race([
      // 2nd try of a frame that hung: shift the animation clock slightly (hangs so far were time-specific)
      page.evaluate(async (i, f, spp, ts) => await window.__renderVideoFrame(i, f, spp, ts), i, f, SPP, fails ? 0.37 : 0),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`frame seg${i + 1} f${f} timed out`)), FRAME_TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer));
    CURRENT_FRAME = null;
    fs.writeFileSync(framePath(i, f), Buffer.from(url.split(',')[1], 'base64'));
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

function encode() {
  const ff = (a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });
  const segs = SEQUENCE.map((s, i) => ({ ...s, i, frames: Math.round(s.dur * FPS) })).filter((s) => fs.existsSync(framePath(s.i, s.frames - 1)));
  if (!segs.length) { console.log('[video] no complete segments to encode'); return; }
  // 1) each segment → high-quality intermediate
  const parts = segs.map((s) => {
    const p = path.join(OUT, `part${String(s.i + 1).padStart(2, '0')}.mp4`);
    // reuse an intermediate that is newer than its last frame (fast re-encodes, e.g. adding music later)
    const fresh = fs.existsSync(p) && fs.statSync(p).mtimeMs > fs.statSync(framePath(s.i, s.frames - 1)).mtimeMs;
    // every part is scaled to the output size (segments rendered at a lower resolution are upscaled, Lanczos)
    if (!fresh) ff(['-framerate', String(FPS), '-i', path.join(segDir(s.i), 'f%04d.png'), '-vf', `scale=${W}:${H}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '10', '-pix_fmt', 'yuv444p', p]);
    return { p, dur: s.frames / FPS };
  });
  // 2) cross-dissolves
  const inputs = parts.flatMap((p) => ['-i', p.p]);
  let filter = '', last = '[0:v]', acc = parts[0].dur;
  for (let k = 1; k < parts.length; k++) {
    const off = (acc - XFADE).toFixed(3);
    filter += `${last}[${k}:v]xfade=transition=fade:duration=${XFADE}:offset=${off}[v${k}];`;
    last = `[v${k}]`; acc = acc + parts[k].dur - XFADE;
  }
  const pictureDur = acc;
  const music = args.music && fs.existsSync(args.music) ? args.music : null;
  // optional title card over black before the picture (--title "ATHENAION" [--subtitle "..."]) and an end
  // card over black after it (--endtitle "...", plus --credit "..." for the music attribution)
  const FONT = "'C\\:/Windows/Fonts/pala.ttf'";
  const fadeA = (t0, t1, f) => `'if(lt(t,${t0.toFixed(3)}),0,if(lt(t,${(t0 + f).toFixed(3)}),(t-${t0.toFixed(3)})/${f},if(lt(t,${(t1 - f).toFixed(3)}),1,if(lt(t,${t1.toFixed(3)}),(${t1.toFixed(3)}-t)/${f},0))))'`;
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, '’').replace(/:/g, '\\:');
  const spaced = (s) => String(s).split('').join(' ');
  const PRE = args.title ? 3.6 : 0;
  const POST = args.endtitle || (music && args.credit) ? 4.0 : 0;
  const total = PRE + pictureDur + POST;
  const big = Math.round(H * 0.058), small = Math.round(H * 0.021), tiny = Math.round(H * 0.016);
  let text = '';
  if (args.title) {
    text += `,drawtext=fontfile=${FONT}:text='${esc(spaced(args.title))}':fontcolor=0xEDE3CF:fontsize=${big}:x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(H * 0.02)}:alpha=${fadeA(0.5, PRE - 0.25, 0.9)}`;
    if (args.subtitle) text += `,drawtext=fontfile=${FONT}:text='${esc(args.subtitle)}':fontcolor=0xC9B48A:fontsize=${small}:x=(w-text_w)/2:y=(h/2)+${Math.round(H * 0.045)}:alpha=${fadeA(1.0, PRE - 0.25, 0.9)}`;
  }
  if (POST) {
    const t0 = PRE + pictureDur + 0.3, t1 = total - 0.2;
    if (args.endtitle) text += `,drawtext=fontfile=${FONT}:text='${esc(spaced(args.endtitle))}':fontcolor=0xEDE3CF:fontsize=${Math.round(big * 0.75)}:x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(H * 0.03)}:alpha=${fadeA(t0, t1, 0.8)}`;
    if (music && args.credit) text += `,drawtext=fontfile=${FONT}:text='${esc(args.credit)}':fontcolor=0xB9AD98:fontsize=${tiny}:x=(w-text_w)/2:y=(h/2)+${Math.round(H * 0.05)}:alpha=${fadeA(t0 + 0.4, t1, 0.8)}`;
  }
  // one tpad for both ends (two chained tpads drop the stop padding after xfade)
  const pad = PRE || POST ? `tpad=start_duration=${PRE}:stop_duration=${POST}:start_mode=add:stop_mode=add:color=black,` : '';
  // without a title card the picture opens almost immediately (the first frames are the hook)
  filter += `${last}${pad}fade=t=in:st=${PRE.toFixed(3)}:d=${PRE ? 1.2 : 0.35},fade=t=out:st=${(PRE + pictureDur - 1.6).toFixed(3)}:d=1.6${text},format=yuv420p[vout]`;
  const outFile = path.join(OUT, args.name || `athenaion_${W}x${H}.mp4`);
  const a = [...inputs];
  if (music) a.push('-i', music);
  // music: --music-start <s> picks the excerpt (0 = the track's own intro, which needs only a tiny fade-in);
  // loudness-normalised to -14 LUFS (streaming level), true peak -1.5 dB, faded out with the picture
  const mStart = Number(args['music-start'] || 0);
  const fadeIn = mStart > 0 ? 1.5 : 0.2;
  const audio = music ? `;[${parts.length}:a]atrim=${mStart}:${(mStart + total).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${(total - 3.5).toFixed(3)}:d=3.5,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]` : '';
  a.push('-filter_complex', filter + audio);
  a.push('-map', '[vout]');
  if (music) a.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '256k');
  a.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-profile:v', 'high', '-r', String(FPS),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', outFile);
  ff(a);
  if (H > 1080) {
    // shareable 1080p version next to the high-res master
    const hd = outFile.replace(/\.mp4$/, '_1080p.mp4');
    ff(['-i', outFile, '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high',
      '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'copy', '-movflags', '+faststart', hd]);
    console.log(`[video] wrote ${path.relative(ROOT, hd)}`);
  }
  console.log(`[video] wrote ${path.relative(ROOT, outFile)} (${total.toFixed(1)} s${music ? ', with music' : ''})`);
}

if (!args['encode-only']) await renderFrames();
encode();
