// Bake the heavy set geometry (node): node tools/bake.mjs sets
// Runs the shot-8 set builder headless at both quality levels; every loadOrBuild() geometry (head,
// crown, trident, column drums, stones) lands in generated/*.bin with the same names the runtime uses.
import { buildFallenHeadSet, frame8 } from '../sets/fallenhead.js';
import * as L from '../world/layout.js';

export async function bake() {
  let G;
  try { G = (await import('../terrain/sand.js')).sunkenGround; } catch { G = (await import('../world/heightfield.js')).heightAt; }
  const P = L.FALLEN_HEAD.pos;
  for (const q of [1, 0.5]) {
    const engine = { registry: {}, slots: { coral: [] }, quality: { detail: q } };
    await buildFallenHeadSet(engine, { frame: frame8({ groundY: G(P[0], P[2]) }), ground: G, q, sunken: true });
  }
  return {};
}
