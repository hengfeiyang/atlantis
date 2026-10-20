// Bow wave + oar churn as standing white water (golden era, ref 2 hero trireme). OWNER: water.
// The surface shader draws the wake foam as a pattern ON the water; seen from a low camera a few tens of metres
// away that pattern is edge-on and reads as a flat grey stripe. Real bow waves are volumetric: a breaking crest
// rolling off the stem and white water heaving along the hull, spray at the oar blades. Built from the mist
// kinds of MistSystem (4: boil quads standing on the water, 2: spray) along the wake's hull outline.
import { MistSystem } from './mist.js';

/**
 * @param wakes  registry.water.wakes records ({ x, z (bow), heading, length, beam, speed, oars, foam })
 * @returns MistSystem with a built mesh, or null
 */
export function buildBowSpray(engine, maps, wakes, level = 0) {
  const list = wakes.filter((w) => (w.foam || 0) > 0 && w.speed > 0.5);
  if (!list.length) return null;
  const mist = new MistSystem(engine, maps);
  const rng = engine.rng('bow-spray');
  for (const w of list) {
    const a = (w.heading * Math.PI) / 180, fx = Math.sin(a), fz = -Math.cos(a);   // forward
    const sx = -fz, sz = fx;                                                     // starboard
    const Lh = w.length, bm = w.beam, spk = Math.min(1.6, w.speed / 5) * (1 + 0.25 * Math.round(w.foam * 4));
    const hwAt = (along) => { const u = Math.min(1, Math.max(0, along / Lh)); return bm * 0.5 * Math.sqrt(Math.min(1, u / 0.28)) * (1 - 0.35 * Math.max(0, (u - 0.7) / 0.3)); };
    const at = (along, across, y = level) => [w.x - fx * along + sx * across, y, w.z - fz * along + sz * across];
    for (const side of [-1, 1]) {
      // the breaking crest along the forward hull (dense at the stem, thinning aft)
      for (let along = -0.6; along < Lh * 0.6; along += 0.22) {
        const u = Math.max(0, along) / Lh;
        const k = Math.exp(-u * 3.2);
        if (rng.random() > 0.25 + 0.75 * k) continue;
        const hw = hwAt(along);
        const out = hw + rng.range(0.05, 0.35) + (0.4 + 1.4 * k) * Math.pow(rng.random(), 1.5);
        const sz0 = (0.8 + 1.3 * k) * rng.range(0.7, 1.3) * Math.min(1.4, spk);
        mist.add({
          pos: at(along, side * out), size: sz0, life: rng.range(1.2, 2.4),
          vel: [sx * side * 0.5 + fx * 0.4, rng.range(0.2, 0.6), sz * side * 0.5 + fz * 0.4], growth: 0.35,
          density: rng.range(0.5, 0.85), kind: 4, stretch: rng.range(0.28, 0.42) * (0.75 + 0.5 * k),
        });
        if (k > 0.55 && rng.random() < 0.25) {
          mist.add({
            pos: at(along, side * (out + 0.3), level + rng.range(0.2, 0.8)), size: rng.range(0.4, 0.9) * (0.6 + k),
            life: rng.range(0.9, 1.7), vel: [sx * side * rng.range(0.8, 2.0), rng.range(1.0, 2.4) * k, sz * side * rng.range(0.8, 2.0)],
            gravity: 3.0, growth: 1.2, density: rng.range(0.02, 0.04), kind: 2, stretch: 0.9,
          });
        }
      }
      // oar churn: a puff of white water where each blade bites (rows ~1.15 m apart, ~3.2 m outboard)
      if (w.oars) {
        for (let along = Lh * 0.18; along < Lh * 0.8; along += 1.15) {
          if (rng.random() < 0.3) continue;
          const out = hwAt(along) + 3.2 + rng.range(-0.4, 0.4);
          mist.add({
            pos: at(along, side * out), size: rng.range(0.35, 0.7) * Math.min(1.3, spk), life: 2.2, phase: rng.range(0, 0.15),
            vel: [0, rng.range(0.1, 0.4), 0], growth: 0.5, density: rng.range(0.45, 0.8), kind: 4, stretch: rng.range(0.35, 0.55),
          });
        }
      }
    }
  }
  const mesh = mist.build(engine.rng('bow-spray-mesh'));
  if (!mesh) return null;
  mesh.name = 'bowSpray';
  mesh.userData.isWater = true;
  mist.uniforms.uLevel.value = level;
  return mist;
}
