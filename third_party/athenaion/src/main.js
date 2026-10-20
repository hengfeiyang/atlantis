// Entry point.
//   Interactive:  http://localhost:8080/?shot=3&quality=preview      (orbit with mouse; keys 1-9 jump to shots; P prints camera)
//   Offline:      driven by tools/render.mjs (mode=still) which calls window.__renderShot(id)
//   Module test:  ?test=temple&view=0   renders src/modules/temple.js test() in a neutral scene
import * as THREE from 'three';
import { createEngine } from './core/engine.js';
import { getQuality } from './core/quality.js';
import { SHOTS } from './world/shots.js';

const P = new URLSearchParams(location.search);

async function boot() {
  const mode = P.get('mode') || 'interactive';
  const quality = getQuality(P.get('quality') || 'preview');
  if (P.get('spp')) quality.spp = Number(P.get('spp'));
  const W = Number(P.get('w')) || (mode === 'interactive' ? Math.round(innerWidth * Math.min(devicePixelRatio, 1)) : 1672);
  const H = Number(P.get('h')) || (mode === 'interactive' ? Math.round(innerHeight * Math.min(devicePixelRatio, 1)) : 941);
  if (mode === 'interactive') document.body.classList.add('interactive');

  const engine = await createEngine({ width: W, height: H, quality, params: P });
  window.engine = engine;
  const t0 = performance.now();

  let testInfo = null;
  if (P.get('test')) {
    const { buildTestScene } = await import('./test/testScene.js');
    testInfo = await buildTestScene(engine, P.get('test'), Number(P.get('view') || 0));
  } else {
    const { buildWorld } = await import('./world/index.js');
    await buildWorld(engine);
  }
  engine.prepareScene();
  const buildMs = Math.round(performance.now() - t0);
  window.__STATS = { buildMs };
  console.log(`[main] world built in ${buildMs} ms`);
  document.getElementById('loading')?.remove();

  const shotById = (id) => SHOTS.find((s) => String(s.id) === String(id));

  window.__renderShot = async (id) => {
    const s = shotById(id);
    if (!s) throw new Error('unknown shot ' + id);
    engine.applyShot(s);
    return await engine.renderStill(quality.spp);
  };
  // used by tools/session.mjs (persistent render session for camera direction / look-dev)
  window.__SHOTS = SHOTS;
  window.__renderShotObj = async (s, spp) => {
    engine.applyShot(s);
    return await engine.renderStill(spp ?? quality.spp);
  };
  // GPU profiler: time per sample with each module hidden in turn (tools/session.mjs + snap --eval)
  window.__profile = async (shotId, spp = 2) => {
    engine.applyShot(shotById(shotId));
    const time = async () => { await engine.renderStill(spp); return engine.stats.renderMs / spp; };
    await time(); // warm-up (lazy shader compiles)
    const base = await time();
    const rows = [];
    const tris = (objs) => { let t = 0; for (const o of objs) o.traverse((m) => { if (!m.isMesh || !m.geometry) return; const g = m.geometry; const n = (g.index ? g.index.count : g.attributes.position?.count || 0) / 3; t += n * (m.isInstancedMesh ? m.count : 1); }); return t; };
    for (const [name, roots] of Object.entries(engine.moduleRoots || {})) {
      const vis = roots.map((r) => r.visible);
      roots.forEach((r) => (r.visible = false));
      const ms = await time();
      roots.forEach((r, i) => (r.visible = vis[i]));
      rows.push({ module: name, msSaved: Math.round(base - ms), mTris: +(tris(roots) / 1e6).toFixed(2), objects: roots.length });
    }
    rows.sort((a, b) => b.msSaved - a.msSaved);
    return { shot: shotId, msPerSample: Math.round(base), calls: engine.stats.calls, mTrisDrawn: +((engine.stats.triangles || 0) / 1e6).toFixed(1), rows };
  };
  // video frame renderer (tools/render-video.mjs)
  if (!P.get('test')) { const { setupVideo } = await import('./video/player.js'); setupVideo(engine, SHOTS); }
  window.__renderTest = async () => {
    engine.applyShot(testInfo.shot);
    return await engine.renderStill(quality.spp);
  };
  // compile everything up front so the first sample isn't a hitch
  if (!P.get('test')) engine.applyShot(shotById(P.get('shot') || 1) || SHOTS[0]);
  else engine.applyShot(testInfo.shot);
  const tc = performance.now();
  await engine.renderer.compileAsync(engine.scene, engine.camera);
  console.log(`[main] shaders compiled in ${Math.round(performance.now() - tc)} ms`);
  window.__READY = true;

  if (mode === 'interactive') startInteractive(engine, shotById);
}

async function startInteractive(engine, shotById) {
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const cam = engine.camera;
  const controls = new OrbitControls(cam, engine.canvas);
  const syncTarget = () => {
    const s = engine.shot;
    if (s) controls.target.set(...s.target);
    controls.update();
  };
  syncTarget();
  let moving = true;
  controls.addEventListener('change', () => { moving = true; });
  const hud = document.createElement('div'); hud.id = 'hud'; document.body.appendChild(hud);
  addEventListener('keydown', (e) => {
    if (e.key >= '1' && e.key <= '9') { const s = shotById(e.key); if (s) { engine.applyShot(s); syncTarget(); moving = true; } }
    if (e.key === 'p' || e.key === 'P') {
      const p = cam.position, t = controls.target;
      const txt = JSON.stringify({ pos: [p.x, p.y, p.z].map((v) => +v.toFixed(1)), target: [t.x, t.y, t.z].map((v) => +v.toFixed(1)), fov: cam.fov });
      console.log(txt); navigator.clipboard?.writeText(txt).catch(() => {});
    }
  });
  const clock = new THREE.Clock();
  let animate = P.get('animate') === '1';
  const loop = () => {
    requestAnimationFrame(loop);
    if (animate) { engine.setTime(engine.time + clock.getDelta()); moving = true; }
    if (moving) engine.lighting.refreshCSM();
    engine.renderInteractive(moving);
    moving = false;
    const p = cam.position;
    hud.textContent = `shot ${engine.shot?.id ?? '-'}  quality ${engine.quality.name}  samples ${engine._accFrames}\n` +
      `cam ${p.x.toFixed(0)} ${p.y.toFixed(0)} ${p.z.toFixed(0)}  fov ${cam.fov}\n` +
      `calls ${engine.renderer.info.render.calls}  tris ${(engine.renderer.info.render.triangles / 1e6).toFixed(2)}M\n` +
      `keys: 1-9 shots · P copy camera · ?animate=1 for motion`;
  };
  loop();
}

boot().catch((e) => {
  console.error(e);
  window.__RENDER_ERROR = (e && (e.stack || e.message)) || String(e);
});
