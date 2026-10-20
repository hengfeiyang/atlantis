// Shot-specific hero foregrounds (OWNER: sets agent):
//   shot 8 (sunken HERO): the giant fallen bronze head of Poseidon, broken gold trident, toppled banded
//                          columns, broken trident mosaic, rubble, sand drifts  — src/sets/fallenhead.js
//   shot 5 (golden):      the garden terrace on land ring 2 (banded colonnade, balustrade, checker paving,
//                          brazier / lotus-pot slots)                                — src/sets/terrace.js
//   shots 3 / 6:          the top of the citadel stair (balustrade ends, pedestals, brazier / planter slots)
//                                                                                    — src/sets/stairtop.js
// Sets are anchored to layout constants and oriented by their shot camera's heading (src/sets/frame.js).
// registry.sets = { suggestedShot8, mosaic8, tridentHead, terrace, stairTop }
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { isSunken } from '../world/era.js';
import { LOOKS } from '../world/looks.js';
import { buildFallenHeadSet, frame8, suggestedShot8 } from '../sets/fallenhead.js';

async function sunkenGroundFn() {
  try { const m = await import('../terrain/sand.js'); if (m.sunkenGround) return m.sunkenGround; } catch { /* terrain not present */ }
  return heightAt;
}
function tris(obj) {
  let t = 0;
  obj.traverse((m) => { if (m.isMesh && m.geometry) { const g = m.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1); } });
  return t;
}

export async function build(engine) {
  const q = engine.quality.detail;
  const sunken = isSunken(engine);
  engine.registry.sets = { ...(engine.registry.sets || {}), suggestedShot8: suggestedShot8() };
  const t0 = performance.now();
  if (sunken) {
    const G = await sunkenGroundFn();
    const P = L.FALLEN_HEAD.pos;
    const F = frame8({ groundY: G(P[0], P[2]) });
    const { group, coral } = await buildFallenHeadSet(engine, { frame: F, ground: G, q, sunken });
    engine.add(group);
    engine.footprints?.addCircle?.(P[0], P[2], 18, 'sets:fallenHead');
    console.log(`[sets] fallen head set: ${Math.round(performance.now() - t0)} ms, ${(tris(group) / 1e6).toFixed(2)} M tris, ${coral} coral slots`);
    const tb = performance.now();
    try {
      const { buildBackdrop8 } = await import('../sets/backdrop8.js');
      const bg = buildBackdrop8(engine, F, G, q);
      engine.add(bg);
      console.log(`[sets] shot-8 backdrop (arcade + towers): ${Math.round(performance.now() - tb)} ms, ${(tris(bg) / 1e6).toFixed(2)} M tris`);
    } catch (e) { console.error('[sets] backdrop8 failed', e.stack || e); }
    // r6 (sunken): shot-6 far city (towers + gilded tholoi, rotunda, two-tier arcade beyond the plateau) — sets/backdrop6.js
    const t6 = performance.now();
    try {
      const { buildBackdrop6 } = await import('../sets/backdrop6.js');
      const { group: bg6, towers } = buildBackdrop6(engine, G, q);
      engine.add(bg6);
      console.log(`[sets] shot-6 far city: ${Math.round(performance.now() - t6)} ms, ${(tris(bg6) / 1e6).toFixed(2)} M tris, ${towers} towers`);
    } catch (e) { console.error('[sets] backdrop6 failed', e.stack || e); }
    // r4 (sunken): ruined precinct on the plateau rim (shots 6, 9) — src/sets/precinct.js
    const tp = performance.now();
    try {
      const [{ buildPrecinct }, { surfaceMap }] = await Promise.all([import('../sets/precinct.js'), import('../marine/scatter.js')]);
      const map = surfaceMap(engine, { cx: 0, cz: 0, size: 240, res: 480 });
      const { group: pg, stats } = buildPrecinct(engine, { q, map });
      engine.add(pg);
      console.log(`[sets] precinct (shots 6/9): ${Math.round(performance.now() - tp)} ms, ${(tris(pg) / 1e6).toFixed(2)} M tris ${JSON.stringify(stats)}`);
    } catch (e) { console.error('[sets] precinct failed', e.stack || e); }
  }
  const t1 = performance.now();
  try {
    const { buildTerrace } = await import('../sets/terrace.js');
    const g = await buildTerrace(engine, { q, sunken });
    if (g) { engine.add(g); console.log(`[sets] garden terrace: ${Math.round(performance.now() - t1)} ms, ${(tris(g) / 1e6).toFixed(2)} M tris`); }
  } catch (e) { if (!String(e).includes('Failed to fetch')) console.error('[sets] terrace failed', e.stack || e); }
  const t2 = performance.now();
  try {
    const { buildStairTop } = await import('../sets/stairtop.js');
    const g = await buildStairTop(engine, { q, sunken });
    if (g) { engine.add(g); console.log(`[sets] stair top: ${Math.round(performance.now() - t2)} ms, ${(tris(g) / 1e6).toFixed(2)} M tris`); }
  } catch (e) { if (!String(e).includes('Failed to fetch')) console.error('[sets] stair top failed', e.stack || e); }
}

/**
 * ?test=sets&view=N[&params set=head|terrace|stair]
 *   head (default): the shot-8 set at the origin (flat ground y = 0), views: 0 design camera, 1 face close-up,
 *                   2 wide, 3 from the side
 */
export async function test(engine) {
  const which = engine.params.get('set') || 'head';
  const q = engine.quality.detail;
  const sunken = isSunken(engine);
  if (which === 'head') {
    // same depth as in the world (land ring 1 top), on a local sand plane
    const Y = L.FALLEN_HEAD.pos[1];
    const F = frame8({ anchor: [0, Y, 0], groundY: Y });
    const { group } = await buildFallenHeadSet(engine, { frame: F, ground: () => Y, q, sunken: true });
    engine.add(group);
    const { setSandMaterial } = await import('../sets/materials.js');
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), setSandMaterial());
    plane.position.y = Y - 0.02; engine.add(plane);
    const look = LOOKS[8] || {};
    const base = { ...look, ...F.shot() };
    const P = new THREE.Vector3(...F.shot().pos), T = new THREE.Vector3(0, Y + 2.5, 0);
    return {
      views: [
        base,
        { ...look, pos: P.clone().lerp(T, 0.45).toArray(), target: [T.x, T.y + 0.5, T.z], fov: 40 },
        { ...look, pos: P.clone().sub(T).multiplyScalar(2.2).add(T).setY(Y + 4).toArray(), target: T.toArray(), fov: 44 },
        { ...look, pos: T.clone().add(F.right.clone().multiplyScalar(12)).add(new THREE.Vector3(0, 3, 0)).toArray(), target: T.toArray(), fov: 50 },
      ],
    };
  }
  if (which === 'terrace') {
    const { buildTerrace, terraceTest } = await import('../sets/terrace.js');
    return terraceTest(engine, { q, sunken });
  }
  if (which === 'stair') {
    const { stairTest } = await import('../sets/stairtop.js');
    return stairTest(engine, { q, sunken });
  }
  return { views: [] };
}
