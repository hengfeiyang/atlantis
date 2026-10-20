// Module "bridges": the great gate bridge over the sea canal (refs 2, 7 — hero) and the ring bridges with
// their gate towers (refs 1, 4, 5), both eras. OWNER: bridges agent.
//
// Publishes: engine.slots.{banner, statue, brazier} (golden; statues/braziers also sunken), slots.coral / kelp
// (sunken), footprints ('bridge-*'), engine.registry.bridges = { gate: {...plan, towers}, ring: [{id, towers}],
// plan: bridgePlan() }. The plan is a pure function (src/bridges/plan.js) other modules can import directly.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { isSunken } from '../world/era.js';
import { whiteStone, redStone, bandedStone, blackStone, limestone } from '../materials/stone.js';
import { goldMaterial, giltMaterial } from '../materials/metal.js';
import { Kit, finalizeKit } from '../bridges/kit.js';
import { bridgePlan, GATE } from '../bridges/plan.js';
import { buildGateBridge } from '../bridges/gate.js';
import { buildRingBridge } from '../bridges/ring.js';

let MATS = null;
export function bridgeMaterials() {
  if (MATS) return MATS;
  MATS = {
    white: whiteStone({ weather: 0.22, lichen: 0.03, veins: 0.55, seed: 3 }),
    red: redStone({ weather: 0.2, seed: 5 }),
    banded: bandedStone({ band: 1.25, redFrac: 0.5, bandOffset: 0.35, weather: 0.2, seed: 7 }),
    black: blackStone({ weather: 0.3, seed: 2 }),
    lime: limestone({ weather: 0.35, paving: 1.2, seed: 9 }),
    gold: goldMaterial({ roughness: 0.36 }),
    gilt: giltMaterial({}),
    relief: giltMaterial({ roughness: 0.48, wear: 0.3 }),
    dark: whiteStone({ weather: 0.5, dark: 0.78, seed: 4 }),
  };
  return MATS;
}

function publish(engine, kits) {
  for (const kit of kits) {
    for (const c of kit.coral) engine.slots.coral.push(c);
    for (const k of kit.kelp) engine.slots.kelp.push(k);
    for (const f of kit.footprints) engine.footprints.addRect(f.cx, f.cz, f.hw, f.hd, f.rotY || 0, f.tag || 'bridge');
  }
}

export async function build(engine) {
  const t0 = performance.now();
  const sunken = isSunken(engine);
  const mats = bridgeMaterials();
  const group = new THREE.Group();
  group.name = 'bridges';
  const q = engine.quality;
  const kitG = new Kit(engine, { detail: Math.max(0.75, q.detail), sunken, label: 'gate' });
  const gate = buildGateBridge(kitG);
  let tris = finalizeKit(kitG, mats, group, 'gate-bridge');
  const kitR = new Kit(engine, { detail: Math.max(0.4, q.detail * 0.7), sunken, label: 'ring' });
  const plan = bridgePlan();
  const ring = plan.map((P) => buildRingBridge(kitR, P));
  tris += finalizeKit(kitR, mats, group, 'ring-bridges');
  engine.add(group);
  publish(engine, [kitG, kitR]);
  engine.registry.bridges = { gate: { ...GATE, towers: gate.towers }, ring, plan };
  const ms = Math.round(performance.now() - t0);
  console.log(`[bridges] ${sunken ? 'sunken' : 'golden'}: gate + ${plan.length} ring bridges, ${(tris / 1e6).toFixed(2)} M tris, ${group.children.length} meshes, gate tower tips ${gate.towers.map((t) => t.tip.toFixed(1)).join('/')} m, coral ${kitG.coral.length + kitR.coral.length}, kelp ${kitG.kelp.length + kitR.kelp.length}, ${ms} ms`);
  engine.stats.bridges = { tris, ms };
}

// ------------------------------------------------------------------------------------------------ test
// Isolated scene: the bridges + a terrain proxy from heightAt() + a flat water plane (golden).
//   views 0-2: gate bridge (ref 2 framing, tower close-up, ref 7 from the canal floor), 3: ring bridge w2-120,
//   4: ring bridge w1-90 from w1, 5: canal-mouth high arch (w1-180), 6: aerial over the south rings
export async function test(engine) {
  const { heightAt } = await import('../world/heightfield.js');
  const { proceduralMaterial } = await import('../core/materials.js');
  const tg = engine.scene.getObjectByName('testGround');
  if (tg) tg.visible = false;
  const sunken = engine.params.get('era') === 'sunken';
  if (sunken) engine.era = 'sunken';
  // terrain proxy around the bridges
  const mk = (cx, cz, sx, sz, step) => {
    const nx = Math.round(sx / step), nz = Math.round(sz / step);
    const g = new THREE.PlaneGeometry(sx, sz, nx, nz).rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) + cx, z = p.getZ(i) + cz; p.setXYZ(i, x, heightAt(x, z), z); }
    g.computeVertexNormals();
    return g;
  };
  const terrMat = proceduralMaterial({
    name: 'bridgeTestTerrain', params: { color: 0xffffff, roughness: 0.9 },
    color: `float n = cgVfbm2(cgP.xz * 0.05, 4); vec3 rock = vec3(0.42, 0.38, 0.32) * (0.8 + 0.4 * n);
            vec3 grass = vec3(0.12, 0.16, 0.06) * (0.8 + 0.4 * n); vec3 sand = vec3(0.62, 0.58, 0.48);
            float up = smoothstep(0.75, 0.95, cgN.y);
            diffuseColor.rgb = cgP.y < 0.5 ? sand * (0.8 + 0.3 * n) : mix(rock, cgP.y > 4.0 ? vec3(0.55, 0.5, 0.42) : grass, up);`,
  });
  terrMat.userData.sunken = 'stone';
  for (const [cx, cz, sx, sz, st] of [[0, 700, 420, 360, 2], [0, 0, 2000, 2000, 4]]) {
    const m = new THREE.Mesh(mk(cx, cz, sx, sz, st), terrMat);
    if (cz === 0) m.position.y = -0.15;
    engine.add(m);
  }
  if (!sunken) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0c4a52, roughness: 0.06, metalness: 0.0 }));
    water.position.y = 0.0;
    water.userData.receiveShadow = false;
    engine.add(water, { castShadow: false, receiveShadow: true });
  }
  await build(engine);
  const view = (pos, target, fov, sun) => ({ pos, target, fov, near: 0.3, far: 30000, sun: sun || { azimuth: 292, elevation: 9 } });
  const [bx, bz] = L.polar(500, 120), [cx1, cz1] = L.polar(265, 90);
  return {
    views: [
      view([-6, 3.2, 845], [0, 30, 690], 44),
      view([18, 32, 735], [40, 46, 690], 42),
      view([-10, -6, 790], [0, 26, 680], 50, { azimuth: 210, elevation: 58 }),
      view(L.polar(470, 140).flatMap((v, i) => (i === 0 ? [v, 3] : [v])), [bx, 10, bz], 44),
      view([L.polar(265, 128)[0], 3, L.polar(265, 128)[1]], [cx1, 12, cz1], 44),
      view([75, 4, 258], [0, 14, 266], 46),
      view([0, 260, 1150], [0, 0, 300], 40),
    ],
  };
}
