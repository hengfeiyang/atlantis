// Vegetation module (golden era only): date palms (hero), Italian cypress, umbrella pines, olives,
// holm-oak / broadleaf, garden shrubs and hedges — on the citadel ledges and slopes, the gardens and
// quays of the land rings, the outer city, the islets and the plain.
// adapted from athenaion/src/modules/vegetation.js (instanced LOD system, cypress / tree generators, atlases)
//   build(engine): scatter (terrain-, footprint- and zone-aware) + per-camera LOD / culling
//   test(engine):  isolated scene near the origin (palm close-ups, mid / far LOD bands, other species)
// Sunken era: nothing alive survives under the sea — build() returns immediately.
import * as THREE from 'three';
import { VegSystem } from '../vegetation/instances.js';
import { buildLibrary } from '../vegetation/library.js';
import { WIND } from '../vegetation/foliage.js';
import { RNG } from '../core/rng.js';
import { ATMO } from '../core/atmosphere.js';
import { isSunken } from '../world/era.js';

function hookSystem(engine, sys) {
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
  if (isSunken(engine)) { console.log('[vegetation] sunken era: no vegetation'); return; }
  const t0 = performance.now();
  const sys = new VegSystem(engine);
  const lib = buildLibrary(sys, engine);
  const { scatterWorld } = await import('../vegetation/scatter.js');
  const st = scatterWorld(engine, sys, lib);
  sys.finalize();
  hookSystem(engine, sys);
  // r4: hanging ivy curtains on slots.ivy (ship-shed rock crests, buildings)
  try {
    const { buildIvy } = await import('../vegetation/ivy.js');
    const iv = buildIvy(engine);
    if (iv.mesh) { engine.add(iv.mesh, { castShadow: true, receiveShadow: true }); st.ivy = iv.curtains; console.log(`[vegetation] ivy: ${iv.curtains} curtains, ${iv.tris} tris`); }
  } catch (e) { console.error('[vegetation] ivy failed', e.stack || e); }
  console.log(`[vegetation] built ${sys.stats.instances} instances (${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(', ')}) in ${Math.round(performance.now() - t0)} ms`);
}

export async function test(engine) {
  const sys = new VegSystem(engine);
  const lib = buildLibrary(sys, engine);
  const rng = new RNG('veg-test');
  const P = engine.params;
  const place = (v, x, z, s, yaw = rng.random() * 6.28, y = 0) => sys.add(v, x, y, z, yaw, s, { tint: [rng.range(0.94, 1.06), rng.range(0.95, 1.05), rng.range(0.92, 1.02)], width: rng.range(0.95, 1.05) });
  const palms = lib.palm;
  // --- view 0/1/5: a palm grove (every variant), close
  const grove = [[-6, -12], [5, -16], [-1, -26], [13, -30], [-15, -30], [22, -18], [-26, -46], [8, -48], [30, -50], [-40, -64], [18, -70], [-8, -80]];
  grove.forEach(([x, z], i) => place(palms[i % palms.length], x, z, 1.0));
  // --- view 2: a quay-side row of palms + cypress, mid distance (LOD1/LOD2)
  for (let i = 0; i < 24; i++) place(i % 3 === 2 ? lib.cypress[i % lib.cypress.length] : palms[i % palms.length], -150 + i * 13, -260 + (i % 2) * 6, rng.range(0.9, 1.1));
  // --- view 3: far band (impostors), 400-1600 m
  for (let i = 0; i < 1600; i++) {
    const x = rng.range(-700, 700), z = rng.range(-1700, -420);
    const r = rng.random();
    const set = r < 0.45 ? palms : r < 0.75 ? lib.cypress : r < 0.85 ? lib.pine : lib.olive;
    place(set[Math.floor(rng.random() * set.length)], x, z, rng.range(0.85, 1.15));
  }
  // --- view 4: other species line-up
  lib.cypress.forEach((v, i) => place(v, 300 + i * 9 - 30, -40, 1.0));
  lib.olive.forEach((v, i) => place(v, 300 + i * 10 - 20, -20, 1.0));
  lib.pine.forEach((v, i) => place(v, 300 + i * 16 - 24, -64, 1.0));
  lib.broad.forEach((v, i) => place(v, 300 + i * 12 - 24, -86, 1.0));
  for (let i = 0; i < 16; i++) place(lib.shrub[i % lib.shrub.length], 300 + rng.range(-30, 30), rng.range(-8, -14), rng.range(0.7, 1.3));
  sys.finalize();
  hookSystem(engine, sys);
  if (P.get('atlas')) {
    const { palmAtlas } = await import('../vegetation/palmAtlas.js');
    const m = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ map: palmAtlas(), alphaTest: 0.02, side: THREE.DoubleSide }));
    m.position.set(0, 12, -1000); m.userData.noPatch = true; m.material.userData.noPatch = true;
    engine.scene.add(m);
    const im = sys.variants.find((v) => v.kind === 'palm').materials.bb.map;
    const m2 = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), new THREE.MeshBasicMaterial({ map: im, alphaTest: 0.02, side: THREE.DoubleSide }));
    m2.position.set(0, 12, -1001); m2.userData.noPatch = true; m2.material.userData.noPatch = true;
    if (P.get('atlas') === '2') engine.scene.add(m2), engine.scene.remove(m);
  }
  const sun = { azimuth: Number(P.get('sunAz') || 292), elevation: Number(P.get('sunEl') || 12) };
  const views = [
    { pos: [2, 1.7, 6], target: [0, 7, -20], fov: 50 },          // 0 grove, eye level
    { pos: [-4.5, 9.5, -10.5], target: [-6, 12.5, -12], fov: 60 }, // 1 inside a crown (ref 5 framing fronds)
    { pos: [0, 4, -170], target: [0, 8, -260], fov: 44 },        // 2 mid row
    { pos: [0, 80, 0], target: [0, 0, -1000], fov: 42 },         // 3 far band
    { pos: [300, 3, 10], target: [300, 6, -50], fov: 55 },       // 4 other species
    { pos: [10, 14, 4], target: [-2, 8, -24], fov: 45 },         // 5 grove from above-ish, sun side
    { pos: [0, 12, -980], target: [0, 12, -1000], fov: 55 },     // 6 atlas debug (atlas=1|2)
  ];
  return { views: views.map((v) => ({ ...v, sun })) };
}
