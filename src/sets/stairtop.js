// Shots 3 / 6 (ref 3 bottom): the head of the citadel stair. The temple module builds the stair, its
// parapets and the plateau rim balustrade; this set closes the gap between them with two hero corner
// piers (carved relief panels, gilt medallions, cornice) carrying braziers, short balustrade returns,
// gilt planters with bougainvillea, and palm / cypress slots on the plaza sides.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { cached } from '../core/materials.js';
import { whiteStone } from '../materials/stone.js';
import { giltMaterial, goldMaterial } from '../materials/metal.js';
import { balustradeGeometry, pedestalGeometry } from '../arch/elements.js';
import { MeshBuilder, box, lathe } from '../arch/geom.js';

const mats = (sunken) => cached('sets:stairMats:' + sunken, () => ({
  marble: whiteStone({ polish: sunken ? 0.05 : 0.45, rough: sunken ? 0.75 : 0.45, weather: sunken ? 0.85 : 0.18, veins: 0.9, seed: 3.3 }),
  gilt: giltMaterial(sunken ? { wear: 0.8 } : {}),
  gold: goldMaterial(sunken ? { wear: 0.6 } : {}),
}));

/** hero corner pier: plinth, die with a sunk relief panel (gilt rosette + border), cornice; local y up, front +z */
function pierGeometry(w, h) {
  const mb = new MeshBuilder();
  box(mb, [-w / 2 - 0.12, 0, -w / 2 - 0.12], [w / 2 + 0.12, 0.3, w / 2 + 0.12], 0.02, [0.2, 0.7, 0.2, 0]);
  box(mb, [-w / 2 - 0.06, 0.3, -w / 2 - 0.06], [w / 2 + 0.06, 0.42, w / 2 + 0.06], 0.03, [0.1, 0.8, 0.2, 0]);
  box(mb, [-w / 2, 0.42, -w / 2], [w / 2, h - 0.36, w / 2], 0.015, [0.05, 0.3, 0.5, 0]);
  // raised panel frames on the four faces
  for (let k = 0; k < 4; k++) {
    mb.push(); mb.rotateY((k * Math.PI) / 2);
    const fw = w * 0.36, y0 = 0.62, y1 = h - 0.58;
    box(mb, [-fw - 0.06, y0 - 0.06, w / 2 - 0.01], [fw + 0.06, y0, w / 2 + 0.04], 0.01, [0.3, 0.8, 0.2, 0]);
    box(mb, [-fw - 0.06, y1, w / 2 - 0.01], [fw + 0.06, y1 + 0.06, w / 2 + 0.04], 0.01, [0.3, 0.8, 0.2, 0]);
    box(mb, [-fw - 0.06, y0, w / 2 - 0.01], [-fw, y1, w / 2 + 0.04], 0.01, [0.3, 0.8, 0.2, 0]);
    box(mb, [fw, y0, w / 2 - 0.01], [fw + 0.06, y1, w / 2 + 0.04], 0.01, [0.3, 0.8, 0.2, 0]);
    mb.pop();
  }
  box(mb, [-w / 2 - 0.1, h - 0.36, -w / 2 - 0.1], [w / 2 + 0.1, h - 0.22, w / 2 + 0.1], 0.02, [0.1, 0.8, 0.3, 0]);
  box(mb, [-w / 2 - 0.18, h - 0.22, -w / 2 - 0.18], [w / 2 + 0.18, h, w / 2 + 0.18], 0.025, [0.05, 0.9, 0.4, 0]);
  return mb.geometry();
}
function reliefGeometry(w, h) {
  // gilt rosette + leafy scroll relief inside the panel, facing +z
  const mb = new MeshBuilder();
  const cy = h * 0.5;
  mb.push(); mb.translate(0, cy, w / 2 + 0.005); mb.rotateX(Math.PI / 2);
  lathe(mb, [[0.0001, 0.05], [0.08, 0.05], [0.1, 0.03], [0.24, 0.025], [0.27, 0.04], [0.31, 0.035], [0.33, 0.0]], 28, {});
  mb.pop();
  for (let k = 0; k < 10; k++) { mb.push(); mb.translate(0, cy, w / 2 + 0.005); mb.rotateZ((k * Math.PI) / 5); box(mb, [-0.022, 0.1, 0], [0.022, 0.25, 0.04], 0.008); mb.pop(); }
  // scroll tendrils above and below
  for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
    const a = (k / 4) * Math.PI;
    mb.push(); mb.translate(Math.cos(a) * w * 0.22, cy + s * (0.5 + 0.12 * Math.sin(a)), w / 2 + 0.005); box(mb, [-0.06, -0.025, 0], [0.06, 0.025, 0.03], 0.008); mb.pop();
  }
  return mb.geometry();
}

export async function buildStairTop(engine, o = {}) {
  const sunken = !!o.sunken;
  const M = mats(sunken);
  const St = L.CITADEL_STAIR, top = St.from, hw = St.width / 2;
  const y0 = top[1];
  const group = new THREE.Group(); group.name = 'sets:stairTop';
  const W = 2.1, H = 1.9;
  const pierG = pierGeometry(W, H), relG = reliefGeometry(W, H);
  const coral = [];
  for (const s of [-1, 1]) {
    const x = s * (hw + 2.6), z = top[2] - 1.0;
    const p = new THREE.Mesh(pierG, M.marble); p.name = 'setStairPier';
    p.position.set(x, y0, z); p.rotation.y = s > 0 ? 0.0 : 0.0;
    if (sunken) { p.rotation.z = s * 0.025; p.rotation.x = 0.015; }
    group.add(p);
    for (let k = 0; k < 4; k++) { const r = new THREE.Mesh(relG, M.gilt); r.position.copy(p.position); r.rotation.y = (k * Math.PI) / 2; group.add(r); }
    const pTop = [x, y0 + H, z];
    engine.slots.brazier.push({ pos: pTop, facing: 180, size: 1.3, tag: sunken ? 'set3 ruin' : 'set3' });
    // short balustrade return from the pier outward to the plateau rim balustrade
    const bal = new THREE.Mesh(balustradeGeometry({ length: 3.2, height: 1.05, depth: 0.36, spacing: 0.28, postEvery: 3.2, detail: 0.6, endPosts: false }), M.marble);
    bal.position.set(x + s * (W / 2 + 0.05), y0 + 0.02, z - 0.3); bal.rotation.y = s > 0 ? 0.12 : Math.PI - 0.12;
    if (o.returns) group.add(bal); // off by default: the temple's rim balustrade starts right there
    // gilt planters with bougainvillea on the plaza side of the piers
    if (!sunken) {
      engine.slots.urn.push({ pos: [x - s * 0.2, y0, z - 2.6], size: 1.1, tag: 'gold bougainvillea set3' });
      engine.slots.flowers.push({ pos: [x + s * 1.6, y0, z - 1.8], size: [1.0, 1.2], tag: 'bush set3' });
      engine.slots.flowers.push({ pos: [x, y0 + H - 0.1, z + W / 2 + 0.1], facing: 180, size: [1.8, 1.3], tag: 'bougainvillea edge set3' });
    } else {
      coral.push({ pos: [x, y0 + H, z], normal: [0, 1, 0], size: 0.9, tag: 'set3:pier' });
      coral.push({ pos: [x + s * 0.6, y0 + 0.4, z + W / 2 + 0.2], normal: [0, 0, 1], size: 0.5, tag: 'set3:pier' });
    }
  }
  // palms and cypress on the plaza sides (ref 3: palms beyond the fountains, cypress along the rim)
  if (!sunken) {
    for (const s of [-1, 1]) {
      engine.slots.palm.push({ pos: [s * 41, y0, 95], facing: s > 0 ? 250 : 110, size: 11, tag: 'date set3' });
      engine.slots.palm.push({ pos: [s * 47, y0, 76], facing: s > 0 ? 260 : 100, size: 12.5, tag: 'date set3' });
      engine.slots.palm.push({ pos: [s * 31, y0, 103], facing: 180, size: 10, tag: 'cypress set3' });
      engine.slots.palm.push({ pos: [s * 35, y0, 100.5], facing: 180, size: 12, tag: 'cypress set3' });
    }
  }
  for (const c of coral) engine.slots.coral.push(c);
  engine.registry.sets = { ...(engine.registry.sets || {}), stairTop: { piers: [[-(hw + 2.6), y0, top[2] - 1], [hw + 2.6, y0, top[2] - 1]], height: H } };
  return group;
}

export async function stairTest(engine, o) {
  const g = await buildStairTop(engine, o);
  const St = L.CITADEL_STAIR;
  g.position.y = -St.from[1];
  engine.add(g);
  return { views: [{ pos: [8, 2.5, St.from[2] + 9], target: [-St.width / 2 - 2.6, 1.2, St.from[2] - 1], fov: 45 }] };
}
