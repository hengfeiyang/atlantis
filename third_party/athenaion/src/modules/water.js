// WATER: lagoon, river, channel and sea surfaces at sea level (y = 0).
//
//   build(engine): captures the meshed terrain height (GPU, top-down) → depth / shore data,
//   traces every layout waterfall against the real cliffs (impacts + footprints for other
//   modules), builds the river flow field, the FFT ripple tile, the planar reflection and the
//   two-pass water surface. Publishes engine.registry.water for the waterfalls module (and others):
//     registry.water = { level, maps:{near,far}, ground:{H,N}, falls:[traced], addImpact(im),
//                        depthAt(x,z), surface, uniforms }
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { captureHeightMap } from '../water/heightmap.js';
import { OceanTile } from '../water/ocean.js';
import { PlanarReflection } from '../water/reflection.js';
import { buildFlowMap } from '../water/flow.js';
import { createWaterSurface } from '../water/surface.js';
import { makeGround, traceFall, fallCorridor } from '../water/trace.js';

export const NEAR_BOUNDS = [-1300, -1000, 500, 1000];
export const FAR_BOUNDS = [-6000, -6000, 6000, 6000];
export const FLOW_BOUNDS = [-620, -520, 300, 760];

export function captureMaps(engine) {
  const q = engine.quality;
  const near = captureHeightMap(engine, { bounds: NEAR_BOUNDS, res: q.detail >= 1 ? 2048 : 1536 });
  const far = captureHeightMap(engine, { bounds: FAR_BOUNDS, res: 1024 });
  return { near, far };
}

export async function build(engine) {
  const t0 = performance.now();
  const q = engine.quality;
  const level = L.SEA_LEVEL ?? 0;

  // ---- terrain capture
  const maps = captureMaps(engine);
  const ground = makeGround([maps.near, maps.far]);
  const depthAt = (x, z) => level - ground.H(x, z);
  const t1 = performance.now();

  // ---- trace the layout waterfalls now (impacts feed the flow field + water foam;
  //      corridors are registered as footprints before architecture/vegetation are placed)
  const falls = [];
  for (const spec of L.WATERFALLS) {
    try {
      const f = traceFall(ground, spec, engine.rng('fall:' + spec.id), { level });
      falls.push(f);
      const corr = fallCorridor(f);
      engine.footprints.addPath(corr, f.width * 0.5 + 1.0, 'waterfall');
    } catch (e) { console.warn('[water] trace failed for', spec.id, e.message); }
  }
  const impacts = falls.filter((f) => f.impact).map((f) => f.impact);
  // run-outs that stop on the shore (sink/pool on a beach or ledge just above the water): the sheet
  // still spills into the water there — add a gentler impact at the nearest water within 25 m
  for (const f of falls) {
    if (f.impact) continue;
    const e = f.ends[Math.floor(f.ends.length / 2)];
    if (!e || e.y > level + 4) continue;
    let best = null;
    for (let a = 0; a < 16 && !best; a++) for (let r = 2; r <= 25; r += 3) {
      const ang = (a / 16) * Math.PI * 2, x = e.x + Math.cos(ang) * r, z = e.z + Math.sin(ang) * r;
      if (depthAt(x, z) > 0.3 && (!best || r < best.r)) { best = { x, z, r }; break; }
    }
    if (!best) continue;
    const dx = best.x - e.x, dz = best.z - e.z, dl = Math.hypot(dx, dz) || 1;
    const im = { x: best.x, z: best.z, speed: e.speed, radius: f.width * 0.6 + 3, strength: f.flow * 0.55, dir: [dx / dl, dz / dl], frac: 0.5, soft: true };
    f.shoreImpact = im; impacts.push(im);
  }
  const t2 = performance.now();

  // ---- flow field, ripple tile, reflection
  const flow = buildFlowMap({ bounds: FLOW_BOUNDS, res: q.detail >= 1 ? 420 : 300, depthAt, impacts });
  const ocean = new OceanTile({ n: 256, size: 24, wind: 4.2, windDir: 0.9, seed: 11 });
  const reflection = new PlanarReflection(engine, { level, scale: q.name === 'preview' ? 0.5 : 0.75 });

  const water = createWaterSurface(engine, { maps, flow, ocean, reflection, level });
  for (const im of impacts) water.addImpact(im);
  engine.add(water.group, { castShadow: false, receiveShadow: true });

  engine.onUpdate((t) => {
    ocean.update(t);
    water.uniforms.uTime.value = t;
  });
  // look-dev: a shot object may carry { waterDebug: n, waterTune: { uniform: value | [x,y,z,w] } }
  // (tools/snap.mjs --set '{"waterTune":{"uChop":1.5}}'); values persist until overridden.
  const debug0 = water.uniforms.uDebug.value;
  engine.onShot((shot) => {
    const U = water.uniforms;
    U.uDebug.value = shot.waterDebug ?? debug0;
    for (const [k, v] of Object.entries(shot.waterTune || {})) {
      if (!U[k]) continue;
      if (Array.isArray(v) && U[k].value?.fromArray) U[k].value.fromArray(v); else U[k].value = v;
    }
    // look-dev: { lookHide: ['waterfalls', ...] } hides top-level scene objects by name for this shot
    for (const o of engine.scene.children) {
      if (o.userData.__lookHidden !== undefined) { o.visible = o.userData.__lookHidden; delete o.userData.__lookHidden; }
      if (shot.lookHide?.includes(o.name)) { o.userData.__lookHidden = o.visible; o.visible = false; }
    }
    const sky = engine.registry.skyEnvScale;
    if (sky) U.uEnvBoost.value = 1 / sky;
  });

  // late re-build of the flow field (waterfalls module: aqueduct spill impacts, boulders in the rapids)
  // + an optional fine detail map around one area (e.g. the river at the shot-7 camera)
  const flowRes = q.detail >= 1 ? 420 : 300;
  function updateFlow({ impacts: imps = impacts, obstacles = [], detail = null, reach = null } = {}) {
    const t = performance.now();
    const f2 = buildFlowMap({ bounds: FLOW_BOUNDS, res: flowRes, depthAt, impacts: imps, obstacles, reach });
    const U = water.uniforms;
    U.tFlow.value = f2.tex; U.uFlowB.value.set(...f2.bounds);
    if (detail) {
      const fd = buildFlowMap({ bounds: detail.bounds, res: detail.res ?? 280, depthAt: detail.depthAt || depthAt, impacts: imps, obstacles, reach });
      U.tFlow2.value = fd.tex; U.uFlow2B.value.set(...fd.bounds);
    }
    return Math.round(performance.now() - t);
  }

  engine.registry.water = {
    level, maps, ground, falls, depthAt, updateFlow,
    addImpact: water.addImpact, setImpacts: water.setImpacts, setRocks: water.setRocks,
    surface: water.surface, uniforms: water.uniforms, reflection, ocean,
    heightTexture: maps.near.tex, heightBounds: maps.near.bounds,
  };

  if (engine.params?.get?.('waterLog')) for (const f of falls) console.log('[water] fall ' + f.id + ' lip ' + [f.lip.x, f.lip.y, f.lip.z].map((v) => v.toFixed(0)) + (f.impact ? ' impact ' + [f.impact.x, f.impact.z, f.impact.radius, f.impact.strength].map((v) => v.toFixed(1)) : ' ends ' + f.ends.map((e) => e.type).join('/')));
  const ms = Math.round(performance.now() - t0);
  console.log(`[water] built in ${ms} ms (capture ${Math.round(t1 - t0)} ms: ${maps.near.meshes} meshes, near ${maps.near.W}x${maps.near.H}` +
    `${maps.near.analyticFill ? ', analytic fill ' + maps.near.analyticFill : ''}; traces ${Math.round(t2 - t1)} ms; flow ${flow.ms} ms; ` +
    `${falls.length} falls, ${impacts.length} impacts)`);
}

// ------------------------------------------------------------------ isolated test
export const TEST_VIEWS = [
  // 0: lagoon close, like ref 2
  { pos: [-130, 3.2, 420], target: [-60, 55, 150], fov: 48, sun: { azimuth: 238, elevation: 21 } },
  // 1: river level, like ref 7
  { pos: [-260, 3, 230], target: [-120, 60, 0], fov: 52, sun: { azimuth: 238, elevation: 21 } },
  // 2: tall waterfall close-up (west face of the acropolis)
  { pos: [-215, 22, -40], target: [-125, 55, -66], fov: 50, sun: { azimuth: 238, elevation: 21 } },
  // 3: aerial over the canyon, like ref 4
  { pos: [-200, 260, -250], target: [-100, 0, 150], fov: 50, sun: { azimuth: 238, elevation: 21 } },
  // 4: low over the lagoon toward the south terraces
  { pos: [-60, 6, 330], target: [0, 30, 150], fov: 50, sun: { azimuth: 238, elevation: 21 } },
];

export async function buildTestTerrain(engine) {
  for (const o of engine.scene.children) if (o.name === 'testGround') o.visible = false;
  try {
    const terrain = await import('./terrain.js');
    await terrain.build(engine);
  } catch (e) {
    console.warn('[water test] terrain module failed, using a simple heightAt mesh:', e.message);
    const { heightAt } = await import('../world/heightfield.js');
    const geo = new THREE.PlaneGeometry(1800, 2000, 450, 500).rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) - 400, z = p.getZ(i); p.setXYZ(i, x, heightAt(x, z), z); }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9a927f, roughness: 0.95 }));
    m.name = 'terrain';
    engine.add(m);
  }
}

export async function test(engine) {
  await buildTestTerrain(engine);
  await build(engine);
  try { const wf = await import('./waterfalls.js'); await wf.build(engine); } catch (e) { console.warn('[water test] waterfalls:', e.message); }
  return { views: TEST_VIEWS };
}
