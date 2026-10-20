// Module "sets": shot-specific foreground sets composed against the shot cameras (src/world/shots.js is
// read at build time, so the sets follow camera tweaks). Each set builds its own stone geometry and
// pushes slots for the consumers that run after it: statues (engine.slots.statue), banners / braziers /
// urns / planters (banners module) and ivy (flora).
//
//   shot 2 (ref 2): right-hand terrace at the lagoon — parapet, steps, balustrade + brazier pier,
//                   terrace wall with a bronze urn of purple flowers, Athena on a moulded pedestal,
//                   tall pier + architrave with the owl banner, ivy curtains, boulders at the water.
import * as THREE from 'three';
import { shotFrame } from '../sets/frame.js';
import { buildShot2 } from '../sets/shot2.js';

const SETS = [
  { id: 2, build: buildShot2 },
];

function pushSlots(engine, slots) {
  for (const [k, list] of Object.entries(slots || {})) {
    if (!engine.slots[k]) engine.slots[k] = [];
    for (const s of list) engine.slots[k].push({ source: 'sets', ...s });
  }
}

export async function build(engine) {
  const t0 = performance.now();
  const detail = engine.quality?.detail ?? 1;
  const report = [];
  for (const def of SETS) {
    const t1 = performance.now();
    try {
      const F = shotFrame(def.id);
      if (!F) continue;
      const r = def.build(engine, F, { detail: Math.min(1, detail) });
      engine.add(r.group, { castShadow: true, receiveShadow: true });
      pushSlots(engine, r.slots);
      const fp = r.footprint;
      if (fp && engine.footprints) engine.footprints.addRect(fp.cx, fp.cz, fp.hw, fp.hd, fp.rotY, `set-shot${def.id}`);
      (engine.registry.sets ||= {})[def.id] = r.anchors || {};
      report.push(`shot${def.id} ${Math.round(performance.now() - t1)} ms ${(r.tris / 1000).toFixed(0)}k tris, slots ${Object.entries(r.slots).map(([k, v]) => `${k}:${v.length}`).join(' ')}`);
    } catch (e) {
      console.error(`[sets] shot ${def.id} failed:`, e.stack || e);
    }
  }
  console.log(`[sets] built in ${Math.round(performance.now() - t0)} ms — ${report.join('; ')}`);
}

// ------------------------------------------------------------------------------------------ test
// The shot-2 set rebuilt around a synthetic camera at the origin (same pitch / fov as shot 2), with its
// props built directly (no statues module: a stand-in figure marks the statue slot).
export async function test(engine) {
  const { SHOTS } = await import('../world/shots.js');
  const { BannerSet } = await import('../props/banner.js');
  const { FireSystem } = await import('../props/fire.js');
  const { BrazierSet } = await import('../props/brazier.js');
  const { UrnSet } = await import('../props/urn.js');
  const { bannerFromSlot } = await import('./banners.js');
  const s2 = SHOTS.find((s) => s.id === 2);
  const d = s2.target.map((v, i) => v - s2.pos[i]);
  const fake = { ...s2, pos: [0, 7, 0], target: [d[0], 7 + d[1], d[2]] };
  const F = shotFrame(fake);
  const r = buildShot2(engine, F, { detail: 1 });
  engine.add(r.group, { castShadow: true, receiveShadow: true });
  // water stand-in
  const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0d3a40, roughness: 0.08, metalness: 0.0 }));
  water.position.y = 0.0; engine.add(water, { receiveShadow: true });
  const fire = new FireSystem(engine);
  const banners = new BannerSet(engine), braz = new BrazierSet(engine, fire), urns = new UrnSet(engine);
  for (const s of r.slots.banner) banners.add(bannerFromSlot(s));
  for (const s of r.slots.brazier) braz.add({ pos: s.pos, diameter: s.size, stand: 'foot', facing: s.facing });
  for (const s of r.slots.urn) urns.add({ pos: s.pos, height: Math.min(1.05, Math.max(0.5, s.size * 0.72)), kind: 'urn', facing: s.facing });
  for (const s of r.slots.planter) urns.add({ pos: s.pos, kind: 'planter', length: s.size[0], depth: s.size[1], facing: s.facing });
  banners.build(); braz.build(); urns.build(); fire.build();
  // statue stand-in
  for (const s of r.slots.statue) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, s.size, 12), new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.7 }));
    m.position.set(s.pos[0], s.pos[1] + s.size / 2, s.pos[2]);
    engine.add(m, { castShadow: true });
  }
  const a = r.anchors;
  const mid = F.toWorld(a.uS, a.YT + 1.5, a.vS);
  return {
    views: [
      { pos: fake.pos, target: fake.target, fov: fake.fov },
      { pos: F.toWorld(a.uS - 4, a.YT + 2.2, a.vS - 9), target: mid, fov: 45 },
      { pos: F.toWorld(a.uS + 9, a.YT + 6, a.vS - 14), target: F.toWorld(a.uS - 2, a.YT, a.vS - 4), fov: 50 },
    ],
  };
}
