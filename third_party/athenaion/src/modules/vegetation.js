// Vegetation module: cypress (signature), olive, holm-oak/broadleaf, umbrella pine, maquis shrubs.
// All geometry and textures are generated here (src/vegetation/*, src/materials/foliage.js).
//   build(engine): scatter thousands of trees over the world (terrain-aware, footprint-aware),
//                  LOD + per-instance culling against the current camera.
//   test(engine):  isolated scene near the origin with close / mid / far views.
import * as THREE from 'three';
import { VegSystem } from '../vegetation/instances.js';
import { buildLibrary } from '../vegetation/library.js';
import { WIND } from '../materials/foliage.js';
import { RNG } from '../core/rng.js';
import { ATMO } from '../core/atmosphere.js';

function hookSystem(engine, sys) {
  // debug switches (development only): ?vegNoAtmo=1 disables aerial perspective, ?vegLod=n forces a LOD
  if (engine.params.get('vegNoAtmo')) ATMO.uAtmoEnabled.value = 0;
  if (engine.params.get('vegLod')) sys.forceLod = Number(engine.params.get('vegLod'));
  engine.add(sys.group);
  engine.onShot(() => {
    sys.resetHistory();
    const s = sys.update(engine.camera);
    console.log(`[vegetation] shot LOD: drawn ${s.drawn}/${s.instances} instances, ~${(s.tris / 1e6).toFixed(2)} M tris (LOD scale ${s.lodScale}), ${s.updateMs} ms`);
  });
  engine.onUpdate((t) => { WIND.uWindTime.value = t; sys.maybeUpdate(engine.camera); });
  engine.registry.vegetation = sys;
}

export async function build(engine) {
  const t0 = performance.now();
  const sys = new VegSystem(engine);
  const lib = buildLibrary(sys, engine);
  const { scatterWorld } = await import('../vegetation/scatter.js');
  const st = scatterWorld(engine, sys, lib);
  sys.finalize();
  hookSystem(engine, sys);
  console.log(`[vegetation] built ${sys.stats.instances} instances (${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(', ')}) in ${Math.round(performance.now() - t0)} ms`);
}

export async function test(engine) {
  const sys = new VegSystem(engine);
  const lib = buildLibrary(sys, engine);
  const rng = new RNG('veg-test');
  const P = engine.params;
  // --- view 0/1: cypress group + row of every variant
  const cyp = lib.cypress;
  const place = (v, x, z, s, yaw = rng.random() * 6.28) => sys.add(v, x, 0, z, yaw, s, { tint: [rng.range(0.9, 1.08), rng.range(0.92, 1.05), rng.range(0.88, 1.0)], width: rng.range(0.9, 1.1) });
  const close = [[-7, -9, 1.0], [5, -16, 1.15], [-2, -30, 1.05], [12, -34, 1.2], [-16, -26, 0.95], [21, -18, 0.8], [-24, -48, 1.2], [7, -58, 1.3], [30, -55, 1.0], [-38, -70, 1.1]];
  close.forEach(([x, z, s], i) => place(cyp[i % cyp.length], x, z, s));
  for (let i = 0; i < cyp.length; i++) place(cyp[i], -52 + i * 15, -130, 1.0, 0.3 * i);
  // --- view 2: olives
  for (let i = 0; i < lib.olive.length; i++) place(lib.olive[i], 200 + (i - 2) * 9, -8 - (i % 2) * 7, 1.0);
  // --- view 3: broadleaf, pines, shrubs
  for (let i = 0; i < lib.broad.length; i++) place(lib.broad[i], 400 + (i - 2) * 12, -30 - (i % 2) * 10, 1.0);
  for (let i = 0; i < lib.pine.length; i++) place(lib.pine[i], 400 + (i - 1.5) * 16, -62 - (i % 2) * 8, 1.0);
  for (let i = 0; i < 18; i++) place(lib.shrub[i % lib.shrub.length], 400 + rng.range(-25, 25), rng.range(-10, -24), rng.range(0.6, 1.3));
  // --- view 4: a distant mixed forest (LOD bands)
  for (let i = 0; i < 2500; i++) {
    const x = rng.range(-500, 500), z = rng.range(-1800, -300);
    const r = rng.random();
    const set = r < 0.35 ? lib.cypress : r < 0.55 ? lib.olive : r < 0.8 ? lib.broad : r < 0.88 ? lib.pine : lib.shrub;
    place(set[Math.floor(rng.random() * set.length)], x, z, rng.range(0.8, 1.2));
  }
  sys.finalize();
  hookSystem(engine, sys);
  if (P.get('atlas')) {
    // debug: show the atlases as unlit planes (view 6)
    const { cypressAtlas, leafAtlas } = await import('../vegetation/atlas.js');
    const mk = (tex, x) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ map: tex, transparent: false, alphaTest: 0.02, side: THREE.DoubleSide }));
      m.position.set(x, 12, -1000); m.userData.noPatch = true; m.material.userData.noPatch = true; m.material.fog = false;
      engine.scene.add(m);
    };
    mk(cypressAtlas(), -10.5); mk(leafAtlas(), 10.5);
  }
  const sun = P.get('sunEl') ? { azimuth: Number(P.get('sunAz') || 235), elevation: Number(P.get('sunEl')) } : undefined;
  const views = [
    { pos: [0, 1.7, 14], target: [0, 10, -12], fov: 55 },
    { pos: [0, 5, -40], target: [0, 9, -130], fov: 50 },
    { pos: [200, 1.8, 12], target: [200, 3.2, -6], fov: 50 },
    { pos: [400, 3, 22], target: [400, 6, -40], fov: 52 },
    { pos: [0, 60, 0], target: [0, 0, -900], fov: 44 },
    { pos: [2, 2, -110], target: [-3, 9, -130], fov: 55 },
    { pos: [0, 12, -976], target: [0, 12, -1000], fov: 50 },
    { pos: [396, 3.5, 2], target: [400, 6, -32], fov: 50 },
    { pos: [200, 1.7, 4], target: [200, 3.5, -10], fov: 55 },
  ];
  return { views: views.map((v) => (sun ? { ...v, sun } : v)) };
}
