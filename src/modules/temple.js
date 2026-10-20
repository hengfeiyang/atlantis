// Temple of Poseidon + the citadel: forecourt with the compass-rose mosaic, chariot pedestal, Nereid and spring
// basins, colossus pedestal, the grand stair down the south face, stoas / tholoi on the plateau, palaces on
// the ledges. Both eras (sunken: ruined, coral slots). OWNER: temple agent.
//
// registry.temple = { stylobateY, ridgeY, yTop, pediments[], chariot:{top,w,d}, colossus:{top,w}, fountains[], nereidBasins[],
//                     stair:{steps:[[z,y]], x0, x1, pedestals, landings, flights}, plaza:{y, radius}, palaces[],
//                     ramparts:[{r (outer face), rIn, y0, h, t, top}], towers:[[x, topY, z]] }
//                     outlets:[{bearing, width, sill, top, r}] (r4: arched cascade outlets in the tier-1 face, from water spec.outlet)
//                     stairChannel (r5: = stairChannelPlan(), the central water channel down the grand stair; water traces it)
// r3 (citadel): great orichalcum ramparts (rampartPlan(): tier 1 = plateau retaining wall y 42 → 62.35, tier 2 above ledge 2
// y 22 → 34 with a garden terrace), grand stair = 6 landings + flights (grandStairPlan()), planted cheek beds + two planted
// dividers (slots.tree / slots.palm with y), low palaces / pavilions on the south face (bearings 110-250), ledge-1 south garden.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { isSunken, ruined, ruinRand } from '../world/era.js';
import { Building } from '../arch/build.js';
import { MeshBuilder, box, lathe, hash3, lerp, quadOut, extrudeOutline } from '../arch/geom.js';
import { columnGeometry, columnInfo } from '../arch/orders.js';
import { balustradeGeometry, balusterTemplate, pedestal, stoa } from '../arch/elements.js';
import { tholos } from '../arch/tholos.js';
import { brokenColumnGeometry, drumGeometry, roughBlockGeometry } from '../arch/ruins.js';
import { poseidonTemple } from '../arch/poseidon.js';
import { palace, basin, trident, silhouette, pinnacle, simpleColumnGeometry, rampart, pavilion, greatRampart } from '../arch/atlantis.js';
import * as S from '../materials/stone.js';
import * as MT from '../materials/metal.js';
import { setTone } from '../materials/tone.js';

const PI = Math.PI;
const SUMMIT = L.CITADEL.summit;
/** chariot pedestal (r2 arch-b): footprint w × d and top height above the plaza (L.CHARIOT gives the position) */
export const PED = { w: 24, d: 15, h: 5.4 };

function addCoral(engine, list) { for (const c of list) engine.slots.coral.push(c); }

/** world-space coral list from a finalized Building's local info.coral */
function coralWorld(B) {
  const M = B.group.matrixWorld;
  return (B.info.coral || []).map((c) => ({ ...c, pos: new THREE.Vector3(...c.pos).applyMatrix4(M).toArray() }));
}

// ------------------------------------------------------------------------------------------- temple
function buildTemple(engine, ctx) {
  const T = L.TEMPLE;
  const sunken = isSunken(engine) || !!engine.params.get('forceRuin');
  const B = poseidonTemple({ W: T.width, L: T.length, podium: T.podium, sunken, detail: engine.quality.detail >= 1 ? 1 : 0.75, seed: 11 });
  const pos = [T.center[0], T.center[1] + T.podium, T.center[2]];
  const g = B.finalize({ position: pos, rotY: L.headingToRotY(T.heading), aoCell: 1.0, aoRays: engine.quality.detail >= 1 ? 32 : 20, aoDist: 18 });
  engine.add(g);
  B.publishSlots(engine);
  addCoral(engine, coralWorld(B));
  const A = B.info.anchors;
  const reg = engine.registry.temple ||= {};
  Object.assign(reg, {
    center: T.center, stylobateY: pos[1], podiumY: T.center[1], yTop: pos[1] + A.yTop, ridgeY: pos[1] + A.yRidge, eavesY: pos[1] + A.yEaves,
    colH: A.colH, D: A.D, columns: A.columns.map(([x, z]) => [x + pos[0], z + pos[2]]), pediments: B.world.pediments, frontZ: pos[2] + T.length / 2,
    building: B.name, triangles: B.triangles,
  });
  engine.footprints.addRect(T.center[0], T.center[2], T.width / 2 + 2, T.length / 2 + 3, 0, 'temple');
  ctx.tris += B.triangles;
  return B;
}

// ------------------------------------------------------------------------------------------- forecourt
function buildForecourt(engine, ctx) {
  const sunken = isSunken(engine);
  const reg = engine.registry.temple ||= {};
  const R = L.CITADEL.plateau - 1.2;
  // ---- paving: one disc with the compass rose (ref 3, 6) + checker beyond
  const rose = L.FORECOURT?.rose ? { center: L.FORECOURT.rose.center, radius: L.FORECOURT.rose.radius } : { center: [0, 94], radius: 8.8 };   // r2: director's FORECOURT.rose
  const pav = S.mosaicFloor({ center: rose.center, radius: rose.radius, rotation: 0, cell: 1.8, pattern: 5, tessera: 0.075, weather: sunken ? 0.6 : 0.12, polish: sunken ? 0.1 : 0.75, rough: sunken ? 0.7 : 0.32 });
  const disc = new THREE.CircleGeometry(R, 180).rotateX(-PI / 2);
  disc.translate(0, SUMMIT + 0.04, 0);
  const mesh = new THREE.Mesh(disc, pav);
  mesh.name = 'temple:plaza';
  mesh.castShadow = false;
  engine.add(mesh);
  reg.plaza = { y: SUMMIT + 0.04, radius: R, rose };
  // keep the processional axis and the mosaic free of trees / props (ref 3)
  engine.footprints.addCircle(rose.center[0], rose.center[1], rose.radius * 1.3, 'plaza-rose');
  engine.footprints.addRect(0, 72, 34, 40, 0, 'plaza-axis');
  // ---- forecourt Building: rim wall + balustrade, chariot pedestal, basins, fountains
  const B = new Building('citadelForecourt', { detail: 1, seed: 21, variant: sunken ? 'ruined' : 'polished', weather: sunken ? 0.8 : 0.2, overrides: sunken ? {} : { weather: 0.15, polish: 0.5 } });
  const mb = B.marble, mk = B.get('black'), mg = B.gold, gr = B.get('giltRelief');
  const coral = [];
  // rim: low marble kerb + coping all around the plateau (the stair cuts through the south)
  const stairHalf = L.CITADEL_STAIR.width / 2 + 2.6;
  const nRim = 160;
  for (let i = 0; i < nRim; i++) {
    const a0 = (i / nRim) * PI * 2, a1 = ((i + 1) / nRim) * PI * 2;
    const xm = Math.sin((a0 + a1) / 2) * R, zm = Math.cos((a0 + a1) / 2) * R;
    if (zm > 0 && Math.abs(xm) < stairHalf) continue;
    if (cascadeAt(ctx, R, L.bearingOf(xm, zm), 1.0)) continue;
    const chord = 2 * R * Math.sin((a1 - a0) / 2);
    mb.push(); mb.translate(xm, SUMMIT, zm); mb.rotateY((a0 + a1) / 2);
    box(mb, [-chord / 2 - 0.01, -1.5, -0.2], [chord / 2 + 0.01, 0.35, 0.9], 0.02, [0.05, 0.8, 0.2, 0]);
    mb.pop();
  }
  // balustrade (instanced 6 m segments) on the rim
  const segL = 5.6;
  const balGeo = balustradeGeometry({ length: segL, height: 1.05, spacing: 0.3, postEvery: 2.8, depth: 0.36, detail: 0.2 });
  const nB = Math.floor((2 * PI * (R + 0.35)) / (segL + 0.02));
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < nB; i++) {
    const a = (i / nB) * PI * 2;
    const x0 = Math.sin(a) * (R + 0.35), z0 = Math.cos(a) * (R + 0.35);
    const xm = Math.sin(a + segL / 2 / R) * R, zm = Math.cos(a + segL / 2 / R) * R;
    if (zm > 0 && Math.abs(xm) < stairHalf + 2) continue;
    if (cascadeAt(ctx, R, L.bearingOf(xm, zm), 2.5) || cascadeAt(ctx, R, L.bearingOf(x0, z0), 2.5)) continue;
    if (sunken && ruined('temple:bal:' + i, 0.35)) continue;
    // segment runs along local +X: orient tangentially
    m4.makeRotationY(a + PI / 2 + segL / 2 / R).setPosition(x0, SUMMIT + 0.35, z0);
    m4.multiply(new THREE.Matrix4().makeRotationY(PI));
    B.addInstance('rimBalustrade', balGeo, m4);
    if (i % 6 === 0) {
      engine.slots.urn.push({ pos: [x0, SUMMIT + 1.55, z0], facing: L.bearingOf(x0, z0), size: 0.9, tag: 'plaza-rim' });
      engine.slots.flowers.push({ pos: [x0, SUMMIT + 0.4, z0], facing: L.bearingOf(x0, z0), size: 2.5, tag: 'plaza-rim-bougainvillea' });
    }
    if (sunken && i % 4 === 0) coral.push({ pos: [x0, SUMMIT + 1.4, z0], normal: [0, 1, 0], size: 0.7, tag: 'plaza-rim' });
  }
  // ---- chariot pedestal (black stone, gilt relief friezes, steps) — statues module puts the group on top.
  // r2 (arch-b): lower and more compact (ref 3: a low black plinth on dark steps, the group rises above it and
  // the temple columns stay visible behind): 24 × 15 m, top 5.4 m above the plaza (was 30 × 18 × 7).
  const C = L.CHARIOT;
  const cw = PED.w, cd = PED.d, ch = PED.h;
  const bz = B.get('dome');
  mb.push(); mk.push(); mg.push(); gr.push(); bz.push();
  for (const m of [mb, mk, mg, gr, bz]) m.translate(C.pos[0], C.pos[1], C.pos[2]);
  // steps around: white marble lowest tread, then two dark ones (ref 3 dark steps under the plinth)
  for (let k = 0; k < 3; k++) box(k === 0 ? mb : mk, [-cw / 2 - 2.1 + k * 0.7, 0, -cd / 2 - 2.1 + k * 0.7], [cw / 2 + 2.1 - k * 0.7, 0.3 * (k + 1), cd / 2 + 2.1 - k * 0.7], 0.02, [0.05, 1, 0.1, k === 0 ? 5.12 : 0]);
  for (let k = 0; k < 3; k++) box(mg, [-cw / 2 - 2.1 + k * 0.7 - 0.01, 0.3 * (k + 1) - 0.06, -cd / 2 - 2.1 + k * 0.7 - 0.01], [cw / 2 + 2.1 - k * 0.7 + 0.01, 0.3 * (k + 1) - 0.03, cd / 2 + 2.1 - k * 0.7 + 0.01], 0, [0.1, 0.4, 0, 0]);
  const yb = 0.9;
  box(mk, [-cw / 2 - 0.4, yb, -cd / 2 - 0.4], [cw / 2 + 0.4, yb + 0.5, cd / 2 + 0.4], 0.03, [0.1, 0.8, 0.2, 0]);
  box(mk, [-cw / 2, yb + 0.5, -cd / 2], [cw / 2, ch - 0.8, cd / 2], 0.02, [0.1, 0.2, 0.3, 0]);
  box(mk, [-cw / 2 - 0.45, ch - 0.8, -cd / 2 - 0.45], [cw / 2 + 0.45, ch, cd / 2 + 0.45], 0.03, [0.05, 0.8, 0.5, 0]);
  box(mg, [-cw / 2 - 0.47, ch - 0.62, -cd / 2 - 0.47], [cw / 2 + 0.47, ch - 0.5, cd / 2 + 0.47], 0, [0.1, 0.4, 0, 0]);
  box(mg, [-cw / 2 - 0.42, yb + 0.38, -cd / 2 - 0.42], [cw / 2 + 0.42, yb + 0.46, cd / 2 + 0.42], 0, [0.1, 0.4, 0, 0]);
  // gold relief frieze under the cornice: a running band of leaping dolphins on all four faces
  {
    const fy = ch - 1.32, fh = 0.46;
    for (const [len, axis, sgn] of [[cw, 'z', 1], [cw, 'z', -1], [cd, 'x', 1], [cd, 'x', -1]]) {
      const n = Math.floor(len / 1.25);
      const FM = new THREE.Matrix4();
      if (axis === 'z') { FM.makeTranslation(0, fy, sgn * cd / 2); if (sgn < 0) FM.multiply(new THREE.Matrix4().makeRotationY(PI)); }
      else { FM.makeTranslation(sgn * cw / 2, fy, 0); FM.multiply(new THREE.Matrix4().makeRotationY(sgn * PI / 2)); }
      mg.push(); mg.apply(FM); gr.push(); gr.apply(FM);
      box(gr, [-len / 2, -0.06, 0], [len / 2, 0.0, 0.06], 0, [0.2, 0.6, 0, 0]);
      box(gr, [-len / 2, fh, 0], [len / 2, fh + 0.06, 0.06], 0, [0.2, 0.6, 0, 0]);
      for (let i = 0; i < n; i++) { const fl = i % 2 === 1; mg.push(); mg.translate(-len / 2 + (i + 0.5) * (len / n) + (fl ? 0.45 : -0.45), -0.15, 0.0); silhouette(mg, 'dolphin', 0.9, 0.07, fl); mg.pop(); }
      mg.pop(); gr.pop();
    }
  }
  // pilasters with gold capitals + relief panels on all four faces
  const panel = (len, axis, sgn) => {
    const n = Math.max(1, Math.round(len / 7.5));
    for (let i = 0; i <= n; i++) {
      const s = -len / 2 + (len * i) / n;
      const p0 = axis === 'z' ? [s - 0.45, sgn * (cd / 2) - (sgn > 0 ? 0 : 0.35)] : [sgn * (cw / 2) - (sgn > 0 ? 0 : 0.35), s - 0.45];
      const p1 = axis === 'z' ? [s + 0.45, sgn * (cd / 2) + (sgn > 0 ? 0.35 : 0)] : [sgn * (cw / 2) + (sgn > 0 ? 0.35 : 0), s + 0.45];
      box(mk, [p0[0], yb + 0.5, p0[1]], [p1[0], ch - 1.4, p1[1]], 0.02, [0.05, 0.8, 0.3, 0]);
      box(mg, [p0[0] - 0.05, ch - 1.75, p0[1] - 0.05], [p1[0] + 0.05, ch - 1.4, p1[1] + 0.05], 0.01, [0.1, 0.6, 0, 0]);
      box(mg, [p0[0] - 0.05, yb + 0.5, p0[1] - 0.05], [p1[0] + 0.05, yb + 0.68, p1[1] + 0.05], 0.01, [0.1, 0.6, 0, 0]);
      if (i < n) {
        const sm = s + len / n / 2, pw = len / n - 1.6, ph = ch - yb - 2.55;
        const PM = new THREE.Matrix4();
        if (axis === 'z') { PM.makeTranslation(sm, yb + 0.95, sgn * cd / 2); if (sgn < 0) PM.multiply(new THREE.Matrix4().makeRotationY(PI)); }
        else { PM.makeTranslation(sgn * cw / 2, yb + 0.95, sm); PM.multiply(new THREE.Matrix4().makeRotationY(sgn * PI / 2)); }
        for (const m of [gr, bz, mg]) { m.push(); m.apply(PM); }
        // gilt frame, dark bronze field, gold figures (ref 3 pedestal panels)
        const fw = 0.22;
        box(gr, [-pw / 2, 0, 0], [pw / 2, fw, 0.12], 0.02, [0.2, 0.7, 0, 0]);
        box(gr, [-pw / 2, ph - fw, 0], [pw / 2, ph, 0.12], 0.02, [0.2, 0.7, 0, 0]);
        box(gr, [-pw / 2, fw, 0], [-pw / 2 + fw, ph - fw, 0.12], 0.02, [0.2, 0.7, 0, 0]);
        box(gr, [pw / 2 - fw, fw, 0], [pw / 2, ph - fw, 0.12], 0.02, [0.2, 0.7, 0, 0]);
        box(mk, [-pw / 2 + fw, fw, -0.02], [pw / 2 - fw, ph - fw, 0.02], 0, [0.5, 0, 0, 0]);   // r2: dark field, gold figures read (ref 3)
        const fh = ph - 2 * fw - 0.2;
        // relief: two hippocamps rearing toward a central trident, dolphins below
        mg.push(); mg.translate(-0.25 - fh * 1.0, fw + 0.1, 0.03); silhouette(mg, 'hippocamp', fh, 0.16, false); mg.pop();
        mg.push(); mg.translate(0.25 + fh * 1.0, fw + 0.1, 0.03); silhouette(mg, 'hippocamp', fh, 0.16, true); mg.pop();
        mg.push(); mg.translate(0, fw + 0.05, 0.08); trident(mg, fh * 1.02, { detail: 0.5 }); mg.pop();
        for (const m of [gr, bz, mg]) m.pop();
      }
    }
  };
  panel(cw, 'z', 1); panel(cw, 'z', -1); panel(cd, 'x', 1); panel(cd, 'x', -1);
  for (const m of [mb, mk, mg, gr, bz]) m.pop();
  B.occBox([C.pos[0] - cw / 2 - 2.1, C.pos[1], C.pos[2] - cd / 2 - 2.1], [C.pos[0] + cw / 2 + 2.1, C.pos[1] + ch, C.pos[2] + cd / 2 + 2.1]);
  reg.chariot = { pos: C.pos, top: C.pos[1] + ch, w: cw, d: cd };
  engine.footprints.addRect(C.pos[0], C.pos[2], cw / 2 + 3, cd / 2 + 3, 0, 'chariot');
  if (sunken) for (let i = 0; i < 18; i++) coral.push({ pos: [C.pos[0] + (hash3(i, 1, 1) - 0.5) * cw, C.pos[1] + ch, C.pos[2] + (hash3(i, 2, 2) - 0.5) * cd], normal: [0, 1, 0], size: 1.2, tag: 'chariot-pedestal' });
  // braziers at the pedestal corners
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) engine.slots.brazier.push({ pos: [C.pos[0] + sx * (cw / 2 + 1.5), C.pos[1] + 0.9, C.pos[2] + sz * (cd / 2 + 1.5)], facing: 180, size: 1.0, tag: 'chariot' });
  // ---- Nereid basins (ring around the chariot; skip those under the temple stair)
  const N = L.NEREIDS;
  const nb = [];
  for (let i = 0; i < N.count; i++) {
    const a = (i / N.count) * PI * 2;
    const x = N.center[0] + Math.sin(a) * N.radius, z = N.center[2] - Math.cos(a) * N.radius;
    if (z < (reg.frontZ ?? 34) + 5) continue;
    if (Math.abs(x) < cw / 2 + 4 && Math.abs(z - C.pos[2]) < cd / 2 + 4) continue;
    const Rb = 3.6, hb = 0.95;
    mb.push(); gr.push(); mb.translate(x, SUMMIT, z); gr.translate(x, SUMMIT, z);
    basin(mb, gr, Rb, hb, { segs: 48, panelW: 2.2 });
    // central rock / pedestal for the Nereid on her dolphin
    lathe(mb, [[1.3, 0, 0.3, 0, true], [1.3, 0.3, 0, 0.5, true], [1.0, 0.45, 0.2, 0], [0.9, 1.2, 0, 0], [1.15, 1.35, 0, 0.6, true], [1.15, 1.55, 0, 0.6, true], [0.001, 1.55, 0, 0]], 24, {});
    mb.pop(); gr.pop();
    nb.push({ pos: [x, SUMMIT, z], radius: Rb, rimY: SUMMIT + hb, waterY: SUMMIT + hb - 0.15, top: SUMMIT + 1.55 });
    engine.footprints.addCircle(x, z, Rb + 0.8, 'nereid-basin');
    engine.slots.statue.push({ pos: [x, SUMMIT + 1.55, z], facing: L.bearingOf(x - C.pos[0], z - C.pos[2]), size: 3.2, tag: 'nereid' });
    if (sunken) coral.push({ pos: [x + Rb, SUMMIT + hb, z], normal: [0, 1, 0], size: 0.8, tag: 'basin' });
  }
  reg.nereidBasins = nb;
  // ---- spring fountains (hot + cold): big basins with a central pedestal and bowl (ref 3)
  // r6 (ref 3): palms + cypress behind the fountains at the temple's front corners (golden; the sunken era has none)
  if (!sunken) {
    const P = (engine.slots.palm ||= []), Fl = engine.slots.flowers;
    for (const sx of [-1, 1]) {
      const list = sx < 0 ? [[37, 45, 'date', 13.5], [42.5, 39, 'cypress', 15], [33.5, 31, 'date', 11.5], [44, 51, 'cypress', 13]]
        : [[25, 46, 'date', 13], [31, 37, 'cypress', 13.5], [33.5, 30, 'date', 11.5], [40, 42, 'cypress', 15]];   // right: in frame beside the temple corner
      for (const [x, z, tag, size] of list) {
        P.push({ pos: [sx * x, heightAt(sx * x, z), z], size, tag: tag + ' forecourt' });
        if (tag === 'date' && Fl) Fl.push({ pos: [sx * x, SUMMIT + 0.4, z + 1.6], facing: 180, size: 2.2, tag: 'forecourt-palm-bougainvillea' });
      }
    }
  }
  const fr = [];
  for (const F of L.FOUNTAINS) {
    const [x, , z] = F.pos, Rb = F.radius, hb = 1.15;
    mb.push(); gr.push(); mg.push(); mb.translate(x, SUMMIT, z); gr.translate(x, SUMMIT, z); mg.translate(x, SUMMIT, z);
    basin(mb, gr, Rb, hb, { segs: 96, panelW: 2.6 });
    // inner ring step + central pedestal with a gilt bowl
    lathe(mb, [[2.6, 0, 0.3, 0, true], [2.6, 0.5, 0, 0.6, true], [2.0, 0.6, 0.2, 0], [1.4, 1.1, 0, 0], [1.2, 2.2, 0, 0], [1.6, 2.4, 0, 0.6, true], [1.6, 2.65, 0, 0.6, true], [0.001, 2.65, 0, 0]], 32, {});
    lathe(mg, [[0.5, 2.65, 0, 0], [0.4, 3.0, 0, 0], [1.8, 3.4, 0.1, 0], [2.4, 3.75, 0, 0.6, true], [2.3, 3.8, 0, 0.6, true], [1.4, 3.55, 0.3, 0], [0.001, 3.5, 0.4, 0]], 36, {});
    mb.pop(); gr.pop(); mg.pop();
    fr.push({ id: F.id, pos: F.pos, radius: Rb, rimY: SUMMIT + hb, waterY: SUMMIT + hb - 0.2, bowlY: SUMMIT + 3.75, bowlR: 2.3, jetY: SUMMIT + 3.8 });
    engine.footprints.addCircle(x, z, Rb + 1, 'fountain');
    engine.slots.statue.push({ pos: [x, SUMMIT + 3.8, z], facing: 180, size: 2.6, tag: 'fountain-top' });
    if (sunken) for (let i = 0; i < 6; i++) { const a = i * 1.05; coral.push({ pos: [x + Math.sin(a) * Rb, SUMMIT + hb, z + Math.cos(a) * Rb], normal: [0, 1, 0], size: 1.0, tag: 'fountain' }); }
  }
  reg.fountains = fr;
  // shared list for the water module: every basin with its real water surface height
  engine.registry.fountains = [
    ...fr.map((f) => ({ id: f.id, kind: f.id, pos: [f.pos[0], f.waterY, f.pos[2]], radius: f.radius - Math.max(0.35, f.radius * 0.07) - 0.02, rimY: f.rimY, bowl: { y: f.bowlY, r: f.bowlR }, jets: springJets(f.pos[0], f.pos[2]) })),
    ...nb.map((b, i) => ({ id: 'nereid' + i, kind: 'nereid', pos: [b.pos[0], b.waterY, b.pos[2]], radius: b.radius - Math.max(0.35, b.radius * 0.07) - 0.02, rimY: b.rimY, jets: nereidJets(b.pos[0], b.pos[2], b.top) })),
  ];
  const g = B.finalize({ ao: false });
  engine.add(g);
  addCoral(engine, coral);
  ctx.tris += B.triangles;
}

// ------------------------------------------------------------------------------------------- colossus pedestal
function buildColossusPedestal(engine, ctx) {
  const sunken = isSunken(engine);
  const Cl = L.COLOSSUS;
  const B = new Building('colossusPedestal', { detail: 1, seed: 31, variant: sunken ? 'ruined' : 'polished', weather: sunken ? 0.8 : 0.2 });
  const mb = B.marble, mk = B.get('black'), mg = B.gold, gr = B.get('giltRelief'), mr = B.get('red');
  const H = Cl.pedestal;
  // stepped black base
  for (let k = 0; k < 4; k++) { const s = 9.5 - k * 0.8; box(mk, [-s, k * 0.6 - 1.5, -s], [s, (k + 1) * 0.6, s], 0.03, [0.1, 0.9, 0.2, 0]); }
  const y0 = 2.4;
  // die: white marble with red pilasters, gilt relief panels on each face
  box(mb, [-6, y0, -6], [6, H - 3.6, 6], 0.03, [0.05, 0.3, 0.5, 3.06]);
  box(mb, [-6.6, y0, -6.6], [6.6, y0 + 1.0, 6.6], 0.03, [0.1, 0.8, 0.3, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(mr, [sx * 6 - 0.9, y0 + 1.0, sz * 6 - 0.9], [sx * 6 + 0.9, H - 3.6, sz * 6 + 0.9], 0.03, [0.05, 0.8, 0.3, 0]);
  for (let f = 0; f < 4; f++) {
    gr.push(); gr.rotateY((f * PI) / 2); gr.translate(0, y0 + 2.2, 6.0);
    box(gr, [-3.8, 0, 0], [3.8, H - y0 - 7.6, 0.06], 0.01, [0.2, 0.6, 0, 0]);
    gr.push(); gr.translate(0, 0.6, 0.06); silhouette(gr, 'god', H - y0 - 9, 0.2); gr.pop();
    gr.push(); gr.translate(1.7, 1.2, 0.12); trident(gr, (H - y0 - 9) * 0.95, { detail: 0.5 }); gr.pop();
    gr.push(); gr.translate(-3.6, 0.4, 0.06); silhouette(gr, 'dolphin', 2.4, 0.15); gr.pop();
    gr.pop();
  }
  // cornice, gold band, attic
  box(mb, [-7.0, H - 3.6, -7.0], [7.0, H - 2.6, 7.0], 0.04, [0.05, 0.9, 0.6, 0]);
  box(mg, [-7.03, H - 3.3, -7.03], [7.03, H - 3.05, 7.03], 0, [0.1, 0.5, 0, 0]);
  box(mk, [-5.6, H - 2.6, -5.6], [5.6, H - 0.4, 5.6], 0.03, [0.05, 0.6, 0.4, 0]);
  box(mb, [-6.0, H - 0.4, -6.0], [6.0, H, 6.0], 0.03, [0.05, 0.9, 0.4, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { mg.push(); mg.translate(sx * 6.5, H - 2.6, sz * 6.5); pinnacle(mg, 3.2, { detail: 0.6 }); mg.pop(); }
  B.occBox([-9.5, -1.5, -9.5], [9.5, H, 9.5]);
  const g = B.finalize({ position: Cl.pos, aoCell: 0.8, aoRays: 16 });
  engine.add(g);
  const reg = engine.registry.temple ||= {};
  reg.colossus = { pos: Cl.pos, top: Cl.pos[1] + H, w: 12 };
  engine.slots.statue.push({ pos: [Cl.pos[0], Cl.pos[1] + H, Cl.pos[2]], facing: Cl.heading, size: Cl.height, tag: 'colossus' });
  engine.footprints.addRect(Cl.pos[0], Cl.pos[2], 10, 10, 0, 'colossus');
  if (sunken) addCoral(engine, [0, 1, 2, 3].map((i) => ({ pos: [Cl.pos[0] + (i % 2 ? 4 : -4), Cl.pos[1] + H, Cl.pos[2] + (i < 2 ? 4 : -4)], normal: [0, 1, 0], size: 1.5, tag: 'colossus-top' })));
  ctx.tris += B.triangles;
}

// ------------------------------------------------------------------------------------------- grand stair
/**
 * r3: pure plan of the grand stair (refs 1 / 4 / 5 read it as stepped marble, not a slab): `segments` of a landing followed by
 * a flight, every ≈ 12 m of drop. The landing comes first in each segment so the stair profile never dips under the
 * straight stair line the heightfield cuts the hill to (heightfield.js stairCut).
 * → { flights: [{ za, zb, ya, yb, n, riser, tread, k }], landings: [{ za, zb, y, k }], hw (walking half-width), corridor (layout
 *     half-width: hw + the wider planted cheek beds), zl, z1, profile(z) }
 */
// r5: the stair proper is at most 25 m wide inside the 34 m layout corridor (CITADEL_STAIR.width): the rest becomes deeper planted cheek
// beds (the 34 m marble face read as one tall tan column under the temple in shot 1); the stair head (STAIR_HEAD) keeps its width
export const STAIR_WALK_HALF = 12.5;
export function grandStairPlan() {
  const St = L.CITADEL_STAIR;
  const zl = L.STAIR_HEAD ? Math.max(St.from[2], L.STAIR_HEAD.landing[1]) : St.from[2];
  const z1 = St.to[2], y0 = St.from[1], y1 = St.to[1];
  const drop = y0 - y1, len = z1 - zl;
  const nF = Math.max(2, Math.round(drop / 12));
  const seg = len / nF, Ld = Math.min(5, seg * 0.22), Lf = seg - Ld, D = drop / nF;
  const nR = Math.max(4, Math.round(D / 0.3)), riser = D / nR, tread = Lf / nR;
  const flights = [], landings = [];
  for (let k = 0; k < nF; k++) {
    const zs = zl + k * seg, ys = y0 - k * D;
    landings.push({ za: zs, zb: zs + Ld, y: ys, k });
    flights.push({ za: zs + Ld, zb: zs + seg, ya: ys, yb: ys - D, n: nR, riser, tread, k });
  }
  const profile = (z) => {
    if (z <= zl) return y0;
    const k = Math.min(nF - 1, Math.floor((z - zl) / seg)), F = flights[k];
    if (z < F.za) return F.ya;
    const j = Math.min(F.n - 1, Math.floor((z - F.za) / F.tread));
    return F.ya - (j + 1) * F.riser;
  };
  return { flights, landings, hw: Math.min(St.width / 2, STAIR_WALK_HALF), corridor: St.width / 2, zl, z1, seg, profile };
}

/**
 * r5: the central WATER CHANNEL down the grand stair (ref 1: a white cascade on the citadel axis under the temple). Pure,
 * layout-derived (the water module builds BEFORE the temple: import this from src/modules/temple.js). A raised marble trough on
 * the stair centre line (never cut into the hill: the heightfield stair line stays under it):
 *   - a POOL on every landing: floor = landing y, a lip (weir) across its downstream end, rims `rim` above the floor;
 *   - a stepped CHUTE on every flight: the floor = the stair treads (one 0.3 m weir per riser), walls raked `rim` above;
 *   - SOURCE: a gilt shell fountain on the top landing (z ≈ zl) pours into pool 0;
 *   - SPOUT: the trough crosses the quay (y quayY) to the shore edge and pours ≈ 3 m into water ring 1 (y 0).
 * → { x, half (inner half-width of the water), width (= 2 half), flow, points (= path), wall (wall thickness), rim, pools:[{k, za, zb, floorY, crestY, rimY}],
 *     chutes:[{k, za, zb, ya, yb, n, riser, tread}], floor(z) → floor y, surface(z) → water surface y (pool: crest + 0.08,
 *     chute: floor + 0.1), source:{pos, dir}, spout:{pos, dir, dropTo}, path:[[x, y, z]] floor polyline (each step corner) }
 */
export function stairChannelPlan() {
  const SP = grandStairPlan();
  const half = Math.max(2.4, Math.round(SP.hw * 0.24 * 10) / 10), wall = 0.55, rim = 0.5, lip = 0.22;
  const pools = SP.landings.map((Ld) => ({ k: Ld.k, za: Ld.za, zb: Ld.zb, floorY: Ld.y, crestY: Ld.y + lip, rimY: Ld.y + rim }));
  const chutes = SP.flights.map((F) => ({ k: F.k, za: F.za, zb: F.zb, ya: F.ya, yb: F.yb, n: F.n, riser: F.riser, tread: F.tread }));
  const qz = L.CITADEL.radius + 0.4, qy = L.CITADEL.quayY + 0.2;   // the quay trough floor sits 0.2 above the quay paving (no z-fight)
  const floor = (z) => (z >= SP.z1 ? qy : SP.profile(z));
  const surface = (z) => {
    if (z >= SP.z1) return qy + lip * 0.6 + 0.08;
    for (const P of pools) if (z >= P.za && z <= P.zb) return P.crestY + 0.08;
    return floor(z) + 0.1;
  };
  const path = [];
  for (const P of pools) {
    path.push([0, P.floorY, P.za], [0, P.floorY, P.zb]);
    const F = chutes[P.k];
    for (let j = 0; j < F.n; j++) { const y = F.ya - (j + 1) * F.riser, za = F.za + j * F.tread; path.push([0, y, za], [0, y, za + F.tread]); }
  }
  path.push([0, qy, SP.z1], [0, qy, qz]);
  return {
    x: 0, half, width: 2 * half, wall, rim, lip, flow: 0.85, pools, chutes, floor, surface, path, points: path,
    source: { pos: [0, SP.landings[0].y + 0.33, SP.zl + 0.45], dir: [0, -0.3, 1] },   // the gilt spout under the shell (stele top ≤ 1.32 above the landing)
    quay: { za: SP.z1, zb: qz, floorY: qy, crestY: qy + lip * 0.6 },
    spout: { pos: [0, qy + lip * 0.6 + 0.08, qz + 0.45], dir: [0, 0, 1], dropTo: 0 },
  };
}

/** prism over x ∈ [x0, x1] between the cross-sections z0 (y from b0 to t0) and z1 (b1 to t1): raked walls, copings, rails */
function rake(mb, x0, x1, z0, b0, t0, z1, b1, t1, aux) {
  const P = (x, y, z) => [x, y, z];
  const A = P(x0, b0, z0), Bq = P(x1, b0, z0), C = P(x1, t0, z0), D = P(x0, t0, z0);
  const E = P(x0, b1, z1), F = P(x1, b1, z1), G = P(x1, t1, z1), H = P(x0, t1, z1);
  quadOut(mb, D, C, G, H, [0, 1, 0], aux);   // top
  quadOut(mb, A, Bq, F, E, [0, -1, 0], aux);                                                                // bottom
  quadOut(mb, Bq, C, G, F, [1, 0, 0], aux);
  quadOut(mb, A, D, H, E, [-1, 0, 0], aux);
  quadOut(mb, A, Bq, C, D, [0, 0, -1], aux);
  quadOut(mb, E, F, G, H, [0, 0, 1], aux);
}

/** dark round-headed blind arch facing local +Z at the current transform (x ∈ [-w/2, w/2], y ∈ [0, h]) */
function blindArch(mI, mM, w, h) {
  const r = w / 2, out = [[-r, 0], [r, 0], [r, h - r]];
  for (let k = 1; k < 10; k++) { const a = (k / 10) * PI; out.push([Math.cos(a) * r, h - r + Math.sin(a) * r]); }
  out.push([-r, h - r]);
  extrudeOutline(mI, out, 0.04, { aux: [0.7, 0, 0, 0], auxSide: [0.6, 0.2, 0, 0] });
  box(mM, [-r - 0.45, h - r - 0.35, -0.02], [-r, h - r, 0.22], 0.02, [0.1, 0.7, 0.3, 0]);   // imposts
  box(mM, [r, h - r - 0.35, -0.02], [r + 0.45, h - r, 0.22], 0.02, [0.1, 0.7, 0.3, 0]);
  box(mM, [-0.3, h - 0.1, -0.02], [0.3, h + 0.5, 0.25], 0.02, [0.1, 0.7, 0.3, 0]);           // keystone
}

/** r5: the stone of the central water channel (stairChannelPlan): pool basins + lips on the landings, raked chute walls on the
 *  flights (the chute floor steps are built with the treads), the shell source on the top landing, the trough across the quay
 *  and its spout lip. Publishes registry.temple.stairChannel (= the plan, for the water module / props). */
function buildStairChannel(engine, B, CH, SP, groundMin, coral) {
  const sunken = isSunken(engine);
  const mb = B.marble, mg = B.gold, mP = B.get('pool'), mk = B.get('black');
  const xi = CH.half, xo = CH.half + CH.wall, rim = CH.rim;
  const wallPair = (za, zb, ya, yb, gl) => {
    for (const s of [-1, 1]) {
      const a = s * xi, b = s * xo, x0 = Math.min(a, b), x1 = Math.max(a, b);
      rake(mb, x0, x1, za - 0.01, gl, ya + rim, zb + 0.01, gl, yb + rim, [0.05, 0.6, 0.4, 3.06]);
      rake(mb, x0 - 0.07, x1 + 0.07, za - 0.01, ya + rim - 0.02, ya + rim + 0.14, zb + 0.01, yb + rim - 0.02, yb + rim + 0.14, [0.05, 0.9, 0.3, 0]);   // coping
      if (!sunken) {
        const xf = s * (xi - 0.01);   // gold fillet along the inner top edge (a glint line down the stair from the air)
        rake(mg, Math.min(xf, xf - s * 0.05), Math.max(xf, xf - s * 0.05), za, ya + rim - 0.16, ya + rim - 0.06, zb, yb + rim - 0.16, yb + rim - 0.06, [0.1, 0.4, 0, 0]);
      }
    }
  };
  for (const P of CH.pools) {
    const g = groundMin(-xo, xo, P.za, P.zb) - 1.0;
    box(mP, [-xi, g, P.za - 0.01], [xi, P.floorY, P.zb + 0.01], 0, [0.05, 0.4, 0.1, 0]);
    if (!sunken) for (const z of [P.za + 0.25, P.zb - 0.6]) box(mk, [-xi, P.floorY, z], [xi, P.floorY + 0.01, z + 0.12], 0, [0.05, 0, 0, 0]);   // dark tile bands
    // weir lip across the downstream end (white, gold fillet on its face)
    box(mb, [-xi, P.floorY, P.zb - 0.4], [xi, P.crestY, P.zb + 0.01], 0.02, [0.05, 0.9, 0.3, 0]);
    if (!sunken) box(mg, [-xi, P.crestY - 0.09, P.zb + 0.01], [xi, P.crestY - 0.04, P.zb + 0.03], 0, [0.1, 0.4, 0, 0]);
    wallPair(P.za, P.zb, P.floorY, P.floorY, g);
    if (sunken) coral.push({ pos: [lerp(-xi, xi, ruinRand('chp' + P.k)), P.floorY + 0.05, (P.za + P.zb) / 2], normal: [0, 1, 0], size: 0.9, tag: 'stair-channel' });
  }
  for (const F of CH.chutes) {
    const g = Math.min(F.yb - 1.2, groundMin(-xo, xo, F.za, F.zb) - 1.5);
    wallPair(F.za, F.zb, F.ya, F.yb, g);
  }
  // source on the top landing: a marble stele with a gilt shell over a spout, a gilt triton on top (the channel's head)
  {
    // r5 (director B1b): everything on the stair head's south edge stays ≤ 1.5 m above the landing (shot-1 sightline to the colonnade)
    const P0 = CH.pools[0], z0 = P0.za, y0 = P0.floorY, w = xi + 0.25;
    box(mb, [-w, y0 - 0.5, z0 - 0.7], [w, y0 + 1.12, z0 + 0.25], 0.03, [0.05, 0.6, 0.4, 3.06]);
    box(mb, [-w - 0.12, y0 + 1.12, z0 - 0.8], [w + 0.12, y0 + 1.32, z0 + 0.37], 0.02, [0.05, 0.9, 0.3, 0]);
    if (!sunken) {
      box(mg, [-w - 0.13, y0 + 1.0, z0 + 0.25], [w + 0.13, y0 + 1.08, z0 + 0.39], 0, [0.1, 0.4, 0, 0]);
      // shell: a fan of gilt ribs over the spout
      for (let i = 0; i < 9; i++) {
        const a = PI * (0.1 + 0.8 * (i / 8));
        mg.push(); mg.translate(0, y0 + 0.36, z0 + 0.27); mg.rotateZ(a - PI / 2);
        box(mg, [-0.06, 0, 0], [0.06, 0.55, 0.07], 0.01, [0.1, 0.5, 0, 0]);
        mg.pop();
      }
      box(mg, [-0.35, y0 + 0.26, z0 + 0.25], [0.35, y0 + 0.4, z0 + 0.42], 0.02, [0.1, 0.5, 0, 0]);   // spout lip
    }
  }
  // the trough across the quay to the shore edge + the spout lip over water ring 1
  {
    const Q = CH.quay, za = Q.za, zb = Q.zb, qy = Q.floorY;
    const g = qy - 2.2;
    box(mP, [-xi, g, za - 0.01], [xi, qy, zb], 0, [0.05, 0.4, 0.1, 0]);
    wallPair(za, zb, qy, qy, g);
    box(mb, [-xi - 0.2, qy - 1.6, zb - 0.1], [xi + 0.2, Q.crestY, zb + 0.45], 0.02, [0.05, 0.9, 0.3, 0]);   // spout lip
    if (!sunken) box(mg, [-xi - 0.2, Q.crestY - 0.2, zb + 0.45], [xi + 0.2, Q.crestY - 0.12, zb + 0.48], 0, [0.1, 0.4, 0, 0]);
    // corbels under the lip
    for (const s of [-1, 1]) box(mb, [s * xo - 0.35, qy - 2.6, zb - 0.1], [s * xo + 0.35, qy - 0.2, zb + 0.4], 0.03, [0.05, 0.7, 0.3, 0]);
  }
  const plan = { ...CH };
  (engine.registry.temple ||= {}).stairChannel = plan;
  engine.footprints.addPath([[0, SP.zl], [0, CH.spout.pos[2]]], xo + 0.3, 'stair-channel');
}

function buildStair(engine, ctx) {
  const sunken = isSunken(engine);
  const St = L.CITADEL_STAIR;
  const SP = grandStairPlan();
  const hw = SP.hw, z0 = St.from[2], z1 = St.to[2];
  const B = new Building('citadelStair', { detail: 1, seed: 41, variant: sunken ? 'ruined' : 'polished', weather: sunken ? 0.85 : 0.2,
    materials: { soil: (ao) => S.stoneMaterial({ kind: 'limestone', ao, colors: { c0: '#33361f', c1: '#252816', c2: '#45432a' }, veins: 0, weather: 0.6, rough: 0.95, polish: 0 }),
      // r4: treads + landings in warm honey travertine (the 34 m stair read as one bright white column in the shot-1 aerial)
      tread: (ao) => S.marbleMaterial({ variant: sunken ? 'ruined' : 'weathered', tint: 0xdcc6a4, ao, seed: 41, overrides: { weather: sunken ? 0.85 : 0.35, streaks: 0.3 } }),
      // r5: glazed turquoise tiles lining the channel pools (the water reads turquoise even where it is thin, ref 1)
      pool: (ao) => S.stoneMaterial({ kind: 'white', ao, colors: { c0: '#5fb3b0', c1: '#3f8f95', c2: '#7cc4bd', c3: '#2f7a82' }, veins: 0.05, weather: sunken ? 0.8 : 0.15, rough: 0.3, polish: 0.5, seed: 43 }) } });
  const mb = B.marble, mg = B.gold, mk = B.get('black'), mr = B.get('red'), mI = B.mb.interior, mS = B.get('soil'), mT = B.get('tread');
  const coral = [];
  const groundMin = (x0, x1, za, zb) => { let m = 1e9; for (let x = x0; x <= x1 + 1e-6; x += Math.max(0.5, (x1 - x0) / 6)) for (const z of [za, (za + zb) / 2, zb]) m = Math.min(m, heightAt(x, z)); return m; };
  const steps = [[SP.zl, St.from[1]]];
  const balH = 0.95, balSp = 0.34;
  const bal = balusterTemplate(balH - 0.3, engine.quality.detail >= 1 ? 0.6 : 0.3);
  const m4 = new THREE.Matrix4();
  const ped = [];
  // r5: the central water channel (stairChannelPlan) — the treads / landings stop at its walls (xo = outer half-width)
  const CH = stairChannelPlan(), cxi = CH.half, cxo = CH.half + CH.wall;
  const sides = [[-hw, -cxo], [cxo, hw]];
  // ---- landings: paving with a black border and red panels in the lanes; flat cheek walls with balustrades
  for (const Ld of SP.landings) {
    const g = groundMin(-hw, hw, Ld.za, Ld.zb) - 1.0;
    for (const [x0, x1] of sides) box(mT, [x0, g, Ld.za - 0.02], [x1, Ld.y, Ld.zb + 0.02], 0.02, [0.05, 1, 0.05, 5.15]);
    if (!sunken) {
      for (const [x0, x1] of [[-hw + 0.6, -cxo - 0.3], [cxo + 0.3, hw - 0.6]]) {
        box(mk, [x0, Ld.y, Ld.za + 0.35], [x1, Ld.y + 0.012, Ld.za + 0.8], 0, [0.05, 0, 0, 0]);
        box(mk, [x0, Ld.y, Ld.zb - 0.8], [x1, Ld.y + 0.012, Ld.zb - 0.35], 0, [0.05, 0, 0, 0]);
      }
      for (const [xs, hx] of [[-hw * 0.48, hw * 0.1], [hw * 0.48, hw * 0.1]]) box(mr, [xs - hx, Ld.y, Ld.za + 1.1], [xs + hx, Ld.y + 0.012, Ld.zb - 1.1], 0, [0.05, 0, 0, 5.1]);   // r4: panels in the lanes
    }
    if (sunken) coral.push({ pos: [lerp(-hw, hw, ruinRand('stl' + Ld.k)), Ld.y, (Ld.za + Ld.zb) / 2], normal: [0, 1, 0], size: 0.9, tag: 'stair' });
  }
  // ---- flights: one deep block per step (marble, slab joints) with a projecting nosing → the risers read as shadow lines
  for (const F of SP.flights) {
    for (let j = 0; j < F.n; j++) {
      const za = F.za + j * F.tread, zb = za + F.tread, y = F.ya - (j + 1) * F.riser;
      const g = Math.min(y - 1.2, groundMin(-hw, hw, za, zb) - 1.0);
      const parts = sunken ? 2 : 1;
      for (const [sx0, sx1] of sides) for (let p = 0; p < parts; p++) {
        const x0 = sx0 + ((sx1 - sx0) / parts) * p, x1 = x0 + (sx1 - sx0) / parts, pk = (sx0 < 0 ? 0 : 2) + p;
        const sag = sunken ? (ruinRand('stair:' + F.k + ':' + j + ':' + pk) - 0.5) * 0.1 - (ruined('stair:c:' + F.k + ':' + j + ':' + pk, 0.06) ? 0.14 : 0) : 0;
        // r6 (shot 1: the stair read as one pale tower): the last six steps of every flight are red stone with a gilt
        // nosing on the foot step → six red-gold bands cross the stair column (Atlantis banding, refs 1 / 5)
        const band = j >= F.n - 6;
        box(band ? mr : mT, [x0 + (sunken ? 0.01 : 0), g, za - 0.02], [x1 - (sunken ? 0.01 : 0), y + sag, zb + 0.01], 0.02, [0.05, 1, 0.05, band ? 5.1 : 5.12]);
        if (!sunken) box(j === F.n - 1 ? mg : mb, [x0, y - 0.09, zb - 0.02], [x1, y, zb + 0.05], 0.015, [0.05, 0.9, 0.05, 0]);
      }
      // channel floor step (white marble under the water: one weir per riser)
      box(mb, [-cxi - 0.02, g, za - 0.02], [cxi + 0.02, y, zb + 0.01], 0.01, [0.05, 0.9, 0.1, 0]);
      steps.push([zb, y]);
      if (sunken && j % 6 === 3) coral.push({ pos: [lerp(-hw, hw, ruinRand('stairc' + F.k + j)), y, (za + zb) / 2], normal: [0, 1, 0], size: 0.7, tag: 'stair' });
    }
  }
  buildStairChannel(engine, B, CH, SP, groundMin, coral);
  // ---- cheek walls (raked over the flights, level on the landings) with balustrades, pedestals on the landings,
  //      and stepped planted terraces outside them (cheek gardens, refs 4 / 5 greenery spilling down the hill)
  const cw = 1.6, bedW = 3.8 + Math.max(0, SP.corridor - hw);   // r5: beds widen by what the narrower stair gives back
  for (const s of [-1, 1]) {
    const xi = s * hw, xo = s * (hw + cw), xa = Math.min(xi, xo), xb = Math.max(xi, xo), xc = s * (hw + cw / 2);
    const segs = [];
    for (const Ld of SP.landings) segs.push({ za: Ld.za, zb: Ld.zb, ya: Ld.y, yb: Ld.y, land: true, k: Ld.k });
    for (const F of SP.flights) segs.push({ za: F.za, zb: F.zb, ya: F.ya, yb: F.yb, land: false, k: F.k });
    segs.sort((a, b) => a.za - b.za);
    for (const sg of segs) {
      const g = groundMin(xa, xb, sg.za, sg.zb) - 1.5;
      const ta = sg.ya + 0.3, tb = sg.yb + 0.3;
      rake(mb, xa, xb, sg.za - 0.01, g, ta, sg.zb + 0.01, g, tb, [0.05, 0.4, 0.4, 3.06]);
      // coping + red frieze on the outer face
      rake(mb, xa - 0.08, xb + 0.08, sg.za - 0.01, ta - 0.02, ta + 0.22, sg.zb + 0.01, tb - 0.02, tb + 0.22, [0.05, 0.9, 0.3, 0]);
      const xf0 = s > 0 ? xb - 0.02 : xa - 0.12, xf1 = s > 0 ? xb + 0.12 : xa + 0.02;
      if (!sunken) rake(mr, xf0, xf1, sg.za, ta - 1.5, ta - 0.4, sg.zb, tb - 1.5, tb - 0.4, [0.05, 0.4, 0.3, 0]);
      if (!sunken) rake(mg, xf0 - 0.01 * s, xf1 + 0.01 * s, sg.za, ta - 0.4, ta - 0.32, sg.zb, tb - 0.4, tb - 0.32, [0.1, 0.4, 0, 0]);
      // balustrade: raked base + rail, vase balusters, posts
      if (!(sunken && ruined('stairbal:' + s + ':' + sg.k + (sg.land ? 'L' : 'F'), 0.5))) {
        const yb0 = ta + 0.22, yb1 = tb + 0.22;
        rake(mb, xc - 0.22, xc + 0.22, sg.za, yb0, yb0 + 0.16, sg.zb, yb1, yb1 + 0.16, [0.1, 0.7, 0.2, 0]);
        rake(mb, xc - 0.27, xc + 0.27, sg.za, yb0 + balH - 0.13, yb0 + balH, sg.zb, yb1 + balH - 0.13, yb1 + balH, [0.05, 0.8, 0.4, 0]);
        const n = Math.max(1, Math.floor((sg.zb - sg.za - 0.6) / balSp));
        for (let i = 0; i <= n; i++) {
          const z = lerp(sg.za + 0.3, sg.zb - 0.3, i / n), y = lerp(yb0, yb1, (z - sg.za) / (sg.zb - sg.za)) + 0.16;
          m4.makeTranslation(xc, y, z); mb.merge(bal, m4);
        }
        const np = Math.max(1, Math.round((sg.zb - sg.za) / 4));
        for (let i = 0; i <= np; i++) {
          const z = lerp(sg.za, sg.zb, i / np), y = lerp(yb0, yb1, i / np);
          box(mb, [xc - 0.3, y, z - 0.3], [xc + 0.3, y + balH + 0.08, z + 0.3], 0.02, [0.1, 0.7, 0.4, 0]);
          box(mb, [xc - 0.34, y + balH + 0.08, z - 0.34], [xc + 0.34, y + balH + 0.15, z + 0.34], 0.015, [0.05, 0.8, 0.3, 0]);
        }
      }
      // landing: a moulded pedestal mid-landing on the cheek (statue), braziers at the head of each flight
      if (sg.land && sg.k > 0) {   // r5 (director B1b): no statue / brazier on the top landing (it continues the stair head's south edge)
        const p = [xc, sg.ya + 0.52, (sg.za + sg.zb) / 2];
        mb.push(); mb.translate(p[0], p[1], p[2]); pedestal(mb, { w: 1.7, d: 1.7, h: 1.6, wreath: !sunken, panel: true, detail: 0.5 }); mb.pop();
        box(mg, [p[0] - 1.0, p[1] + 1.36, p[2] - 1.0], [p[0] + 1.0, p[1] + 1.42, p[2] + 1.0], 0, [0.1, 0.5, 0, 0]);
        ped.push({ pos: [p[0], p[1] + 1.6, p[2]], kind: 'statue' });
        ped.push({ pos: [xc, sg.ya + 1.5, sg.zb - 0.35], kind: 'brazier' });
      }
      if (sunken && sg.land) coral.push({ pos: [xc, sg.ya + 1.6, (sg.za + sg.zb) / 2], normal: [0, 1, 0], size: 0.8, tag: 'stair-pedestal' });
    }
    // planted terraces: three stepped beds per segment, each a little under the stair beside it
    const bx0 = s > 0 ? xb : xb - cw - bedW, bx1 = s > 0 ? xa + cw + bedW : xa;
    const X0 = Math.min(bx0, bx1), X1 = Math.max(bx0, bx1), xm = (X0 + X1) / 2, xOut = s > 0 ? X1 : X0;
    let bi = 0;
    for (let k = 0; k < SP.flights.length; k++) {
      const zs = SP.landings[k].za, ze = SP.flights[k].zb;
      for (let m = 0; m < 3; m++, bi++) {
        const za = zs + ((ze - zs) * m) / 3, zb = zs + ((ze - zs) * (m + 1)) / 3;
        const top = SP.profile(zb - 0.01) - 0.9;
        const g = groundMin(X0, X1, za, zb) - 1.5;
        if (top - g < 1.2) continue;
        const ruinTop = sunken ? top - 1.5 * ruinRand('bed' + s + bi) : top;
        box(B.get('limestone'), [X0, g, za], [X1, ruinTop, zb], 0.03, [0.05, 0.5, 0.5, 3.06]);   // r5: warm coursed limestone (the white bed faces drew the stair's edges as a white column in shot 1)
        if (!sunken) {
          box(mS, [X0 + 0.35, ruinTop, za + 0.3], [X1 - 0.35, ruinTop + 0.25, zb - 0.3], 0, [0.4, 0, 0, 0]);
          // coping (r5: a rim frame round the soil — the r3 full slab covered the bed: white bed tops from the air), red frieze,
          // gold fillet on the outer face + the downhill (+z) face
          const cA = [0.05, 0.9, 0.3, 0], yc0 = ruinTop - 0.05, yc1 = ruinTop + 0.32;
          box(mb, [X0 - 0.12, yc0, za - 0.05], [X0 + 0.35, yc1, zb + 0.12], 0.02, cA, { bottom: false });
          box(mb, [X1 - 0.35, yc0, za - 0.05], [X1 + 0.12, yc1, zb + 0.12], 0.02, cA, { bottom: false });
          box(mb, [X0 + 0.35, yc0, za - 0.05], [X1 - 0.35, yc1, za + 0.3], 0.02, cA, { bottom: false });
          box(mb, [X0 + 0.35, yc0, zb - 0.3], [X1 - 0.35, yc1, zb + 0.12], 0.02, cA, { bottom: false });
          const fx0 = s > 0 ? X1 : X0 - 0.1, fx1 = s > 0 ? X1 + 0.1 : X0;
          box(mr, [fx0, ruinTop - 1.4, za], [fx1, ruinTop - 0.3, zb], 0, [0.05, 0.4, 0.3, 0]);
          box(mg, [fx0 - 0.005 * s, ruinTop - 0.42, za], [fx1 + 0.005 * s, ruinTop - 0.34, zb], 0, [0.1, 0.4, 0, 0]);
          box(mr, [X0, ruinTop - 1.4, zb], [X1, ruinTop - 0.3, zb + 0.1], 0, [0.05, 0.4, 0.3, 0]);
          // blind arch on tall outer faces (the stair's substructure reads as an arcade from the ledges)
          const fh = ruinTop - 1.6 - Math.max(g + 1.5, heightAt(xOut + s * 0.5, (za + zb) / 2) + 0.3);
          if (fh > 5) {
            const y0 = ruinTop - 1.6 - Math.min(fh, 11);
            for (const mm of [mI, mb]) { mm.push(); mm.translate(xOut + s * 0.01, y0, (za + zb) / 2); mm.rotateY(s * PI / 2); }
            blindArch(mI, mb, Math.min(3.4, zb - za - 1.4), Math.min(fh, 11) - 0.8);
            for (const mm of [mI, mb]) mm.pop();
          }
          // planting: cypress / garden palm on the bed axis, shrubs, bougainvillea spilling over the outer edge
          const zc = (za + zb) / 2;
          const wide = X1 - X0 > 6.5, xr = wide ? xm - s * (X1 - X0) * 0.2 : xm;   // r5: wide beds get a second (outer) row
          if (bi % 2 === 0) (engine.slots.tree ||= []).push({ pos: [xr + s * 0.4, ruinTop + 0.2, zc], tag: 'cypress', size: 8 + 3 * hash3(bi, s, 2) });
          else (engine.slots.palm ||= []).push({ pos: [xr, ruinTop + 0.2, zc], size: 6 + 2 * hash3(bi, s, 3), tag: 'garden' });
          if (wide) (engine.slots.tree ||= []).push({ pos: [xm + s * (X1 - X0) * 0.22, ruinTop + 0.2, zc + (hash3(bi, s, 6) - 0.5) * 2], tag: ['olive', 'broad', 'shrub'][bi % 3], size: [4.2, 5, 2.2][bi % 3] });
          (engine.slots.tree ||= []).push({ pos: [xm - s * 0.6, ruinTop + 0.2, za + 1.2], tag: 'shrub', size: 1.6 });
          (engine.slots.tree ||= []).push({ pos: [xm + s * 0.6, ruinTop + 0.2, zb - 1.2], tag: 'shrub', size: 1.4 });
          engine.slots.flowers.push({ pos: [xOut, ruinTop + 0.25, zc], facing: s > 0 ? 90 : 270, size: 3.0, tag: 'stair-bougainvillea' });
        } else coral.push({ pos: [xm, ruinTop, (za + zb) / 2], normal: [0, 1, 0], size: 1.0, tag: 'stair-bed' });
      }
    }
  }
  // ---- two planted dividers split the 34 m stair into three lanes (raked marble planters with cypress / shrubs along the
  //      flights; the long white slab of shots 1 / 4 / 5 becomes lanes, landings and green lines)
  {
    const dw = 1.3, segs = [];
    for (const Ld of SP.landings) segs.push({ za: Ld.za, zb: Ld.zb, ya: Ld.y, yb: Ld.y, land: true, k: Ld.k });
    for (const F of SP.flights) segs.push({ za: F.za, zb: F.zb, ya: F.ya, yb: F.yb, land: false, k: F.k, r: F.riser });
    let pi = 0;
    // r4: four dividers (five lanes) and a cypress every second planter: green lines break the stair up from the air (shot 1)
    // r5: the inner pair gave way to the central water channel (stairChannelPlan): two planted dividers + the channel
    for (const xd of hw > 14 ? [-hw * 0.66, hw * 0.66] : []) for (const sg of segs) {   // r5: no dividers on the 25 m stair (two 9 m lanes beside the channel)
      const lo = (sg.r ?? 0.3) + 0.7;
      if (sunken && ruined('stairdiv:' + xd + ':' + sg.k + sg.land, 0.4)) continue;
      rake(mb, xd - dw, xd + dw, sg.za, sg.ya - lo, sg.ya + 0.45, sg.zb, sg.yb - lo, sg.yb + 0.45, [0.05, 0.5, 0.3, 3.06]);
      for (const e of [-1, 1]) rake(mb, xd + e * dw - 0.18, xd + e * dw + 0.18, sg.za, sg.ya + 0.4, sg.ya + 0.68, sg.zb, sg.yb + 0.4, sg.yb + 0.68, [0.05, 0.9, 0.3, 0]);
      if (sunken) continue;
      rake(mS, xd - dw + 0.2, xd + dw - 0.2, sg.za, sg.ya + 0.4, sg.ya + 0.58, sg.zb, sg.yb + 0.4, sg.yb + 0.58, [0.4, 0, 0, 0]);
      for (const e of [-1, 1]) rake(mg, xd + e * (dw + 0.18) - 0.012, xd + e * (dw + 0.18) + 0.012, sg.za, sg.ya + 0.5, sg.ya + 0.56, sg.zb, sg.yb + 0.5, sg.yb + 0.56, [0.1, 0.4, 0, 0]);
      const n = Math.max(1, Math.round((sg.zb - sg.za) / 3.4));
      for (let i = 0; i < n; i++, pi++) {
        const z = lerp(sg.za, sg.zb, (i + 0.5) / n), y = lerp(sg.ya, sg.yb, (i + 0.5) / n) + 0.55;
        const kind = sg.land ? 'shrub' : pi % 2 === 0 ? 'cypress' : 'shrub';
        (engine.slots.tree ||= []).push({ pos: [xd, y, z], tag: kind, size: kind === 'cypress' ? 8 + 2.5 * hash3(pi, 3, 9) : 1.5 + 0.4 * hash3(pi, 4, 9) });
        if (pi % 4 === 1) engine.slots.flowers.push({ pos: [xd, y, z], facing: 180, size: 2.0, tag: 'stair-divider-flowers' });
      }
    }
  }
  // slots on the landing pedestals: statues mid-landing, braziers at the flight heads
  ped.forEach((p, i) => {
    const facing = p.pos[0] < 0 ? 90 : 270;
    if (p.kind === 'statue') engine.slots.statue.push({ pos: p.pos, facing: 180, size: 2.6, tag: 'stair-pedestal' });
    else engine.slots.brazier.push({ pos: p.pos, facing, size: 1.0, tag: 'stair-landing' });
    if (sunken) coral.push({ pos: p.pos, normal: [0, 1, 0], size: 0.8, tag: 'stair-pedestal' });
    void i;
  });
  const pedOut = ped.map((p) => p.pos);
  // ---- r2 (director L.STAIR_HEAD): the north flight from the raised landing down into the court (refs 3 / 6:
  // the camera stands on the landing and looks down a short, broad flight into the forecourt)
  const SH = L.STAIR_HEAD;
  if (SH) {
    const fz0 = SH.flight.from[2], fz1 = SH.flight.to[2], fy0 = SH.flight.from[1], fy1 = SH.flight.to[1];
    const fhw = SH.width / 2;
    const N = Math.max(4, Math.round((fy0 - fy1) / 0.17) - 1);
    const r = (fy0 - fy1) / (N + 1), t = (fz0 - fz1) / N;
    const segs = Math.round(SH.width / 2.4);
    for (let i = 0; i < N; i++) {
      const y = fy0 - (i + 1) * r, za = fz0 - (i + 1) * t, zb = fz0 - i * t;
      for (let k = 0; k < segs; k++) {
        const x0 = -fhw + (SH.width / segs) * k, x1 = x0 + SH.width / segs;
        const sag = sunken ? (ruinRand('nflight:' + i + ':' + k) - 0.5) * 0.06 - (ruined('nflight:c:' + i + ':' + k, 0.05) ? 0.1 : 0) : (hash3(i, k, 5) - 0.5) * 0.006;
        box(mb, [x0 + 0.004, fy1 - 0.3, za - 0.02], [x1 - 0.004, y + sag, zb + 0.03], 0.02, [0.05, 1, 0.05, 0]);
      }
      if (sunken && i % 4 === 1) coral.push({ pos: [lerp(-fhw, fhw, ruinRand('nfc' + i)), y, (za + zb) / 2], normal: [0, 1, 0], size: 0.7, tag: 'stair' });
    }
    // cheek walls with a stepped coping; pedestals at the top (braziers) and bottom (urns / statues) corners
    for (const sgn of [-1, 1]) {
      const xc = sgn * (fhw + 0.9);
      for (let i = 0; i <= N; i++) {
        const y = i === 0 ? fy0 : fy0 - i * r, za = i === 0 ? fz0 - 0.02 : fz0 - (i + 1) * t, zb = i === 0 ? fz0 + 0.6 : fz0 - i * t;
        if (i === N) continue;
        box(mb, [xc - 0.9, fy1 - 0.3, za - 0.02], [xc + 0.9, y + 1.0, zb + 0.02], 0.02, [0.05, 0.6, 0.4, 3.05]);
        box(mb, [xc - 1.0, y + 1.0, za - 0.03], [xc + 1.0, y + 1.18, zb + 0.03], 0.02, [0.05, 0.9, 0.3, 0]);
      }
      // r5 (director B1b): no brazier pedestals on the stair head (they stood 2.7 m above it in the shot-1 sightline to the colonnade;
      // out of the shot-3 frame anyway) — only the foot pedestals with urns
      const bot = [xc, fy1 + r + 1.18, fz1 + 0.8];
      for (const [p, kind] of [[bot, 'urn']]) {
        mb.push(); mb.translate(p[0], p[1], p[2]); pedestal(mb, { w: 1.6, d: 1.6, h: 1.5, wreath: false, panel: true, detail: 0.5 }); mb.pop();
        box(mg, [p[0] - 0.95, p[1] + 1.28, p[2] - 0.95], [p[0] + 0.95, p[1] + 1.34, p[2] + 0.95], 0, [0.1, 0.5, 0, 0]);
        const slot = { pos: [p[0], p[1] + 1.5, p[2]], facing: 0, size: kind === 'brazier' ? 1.1 : 1.0, tag: 'stair-head' };
        if (kind === 'brazier') engine.slots.brazier.push(slot); else engine.slots.urn.push(slot);
        engine.slots.flowers.push({ pos: [p[0] + sgn * 1.6, fy1 + 0.1, p[2]], facing: sgn > 0 ? 90 : 270, size: 2.2, tag: 'stair-bougainvillea' });
        if (sunken) coral.push({ pos: [p[0], p[1] + 1.5, p[2]], normal: [0, 1, 0], size: 0.8, tag: 'stair-pedestal' });
      }
    }
    engine.footprints.addPath([[0, fz1], [0, fz0]], fhw + 2.5, 'citadel-stair');
    (engine.registry.temple ||= {}).flight = { from: SH.flight.from, to: SH.flight.to, riser: r, tread: t, n: N, x0: -fhw, x1: fhw };
  }
  const g = B.finalize({ ao: false });
  engine.add(g);
  addCoral(engine, coral);
  engine.footprints.addPath([[0, z0], [0, z1]], hw + cw + bedW + 1, 'citadel-stair');
  const reg = engine.registry.temple ||= {};
  reg.stair = { steps, x0: -hw, x1: hw, pedestals: pedOut, landings: SP.landings, flights: SP.flights };
  ctx.tris += B.triangles;
}

// ------------------------------------------------------------------------------------------- plateau stoas + tholoi
function buildPlateauBuildings(engine, ctx) {
  const sunken = isSunken(engine);
  const det = engine.quality.detail >= 1 ? 0.8 : 0.6;
  if (!sunken && engine.params.get('stoas')) {
    for (const s of [-1, 1]) {
      const B = stoa({ length: 76, depth: 11, colH: 7.4, order: 'ionic', steps: 3, gild: 1, detail: det, seed: 50 + s, name: 'plateauStoa' + s, foundation: 1.5 });
      const x = s * 74, z = -8;
      const g = B.finalize({ position: [x, SUMMIT, z], rotY: L.headingToRotY(s < 0 ? 90 : 270), aoCell: 0.9, aoRays: 16 });
      engine.add(g); B.publishSlots(engine);
      engine.footprints.addRect(x, z, 7, 40, 0, 'stoa');
      ctx.tris += B.triangles;
    }
  } else if (sunken && engine.params.get('stoas')) {
    // sunken: the stoas are rows of broken columns with fallen drums
    const mbR = new MeshBuilder();
    const B = new Building('plateauStoaRuins', { detail: 1, seed: 52, variant: 'ruined', weather: 0.9 });
    const m4 = new THREE.Matrix4();
    const coral = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 20; i++) {
        const z = -8 - 36 + (72 * i) / 19, x = s * (74 - 4.6);
        const k = 'stoa:' + s + ':' + i;
        if (ruined(k + ':gone', 0.25)) continue;
        const g = brokenColumnGeometry({ order: 'ionic', height: 7.4, breakAt: 0.25 + 0.7 * ruinRand(k), seed: i * 3 + (s > 0 ? 1 : 0), detail: 0.5 });
        m4.makeTranslation(x, SUMMIT, z); B.addInstance('stoaCol' + s + i, g, m4);
        coral.push({ pos: [x, SUMMIT + 7.4 * (0.25 + 0.7 * ruinRand(k)), z], normal: [0, 1, 0], size: 0.6, tag: 'stoa' });
      }
      box(B.get('limestone'), [s * 74 - 6, SUMMIT - 1, -46], [s * 74 + 6, SUMMIT + 0.8, 30], 0.03, [0.1, 0.6, 0.2, 0]);
      box(B.marble, [s * (74 + 5.2) - 0.35, SUMMIT + 0.8, -44], [s * (74 + 5.2) + 0.35, SUMMIT + 3.2 + 2 * hash3(s, 1, 1), 28], 0.03, [0.1, 0.5, 0.3, 3.05]);
    }
    const drum = drumGeometry({ order: 'ionic', diameter: 0.9, height: 1.1, chips: 0.6, seed: 7, detail: 0.5 });
    for (let i = 0; i < 40; i++) {
      const s = i % 2 ? 1 : -1;
      const x = s * (66 - 8 * ruinRand('sd' + i)), z = -44 + 74 * ruinRand('sdz' + i);
      m4.compose(new THREE.Vector3(x, SUMMIT + 1.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(PI / 2, ruinRand('sdr' + i) * PI, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
      B.addInstance('stoaDrums', drum, m4);
    }
    void mbR;
    const g = B.finalize({ ao: false }); engine.add(g); addCoral(engine, coral); ctx.tris += B.triangles;
  }
  // four tholoi with gold domes on the plateau corners (ref 1, 3, 6 background)
  const tpos = [[-60, 72], [60, 72], [-62, -64], [62, -64]];
  tpos.forEach(([x, z], i) => {
    if (sunken && i === 3) return;   // one collapsed
    const B = tholos({ radius: 6.2, columns: 12, colH: 6.4, order: 'corinthian', gild: 1, detail: det, seed: 60 + i, name: 'plateauTholos' + i, steps: 4 });
    const g = B.finalize({ position: [x, SUMMIT, z], rotY: L.headingToRotY(L.bearingOf(x, z)), aoCell: 0.7, aoRays: 16 });
    engine.add(g); B.publishSlots(engine);
    engine.footprints.addCircle(x, z, 9.5, 'tholos');
    ctx.tris += B.triangles;
    if (sunken) engine.slots.coral.push({ pos: [x, SUMMIT + 9, z], normal: [0, 1, 0], size: 1.5, tag: 'tholos' });
  });
}

// ------------------------------------------------------------------------------------------- honorific columns
/**
 * r2 (arch-b): four tall honorific columns around the temple's rear corners, each crowned by a gold statue
 * ('pinnacle' slots, refs 1 and 5: white pillars with gold figures rising beside the temple). Sunken: one has
 * snapped at mid-shaft (its drums lie on the paving), the statues module topples / removes some figures.
 */
export const HONOR_COLUMNS = [[-40, -46], [40, -46], [-39, 6], [39, 6]];   // clear of the r2 54 m temple (x ±29 incl. steps)
function buildHonorColumns(engine, ctx) {
  const sunken = isSunken(engine);
  const B = new Building('honorColumns', { detail: 1, seed: 91, variant: sunken ? 'ruined' : 'polished', weather: sunken ? 0.85 : 0.18 });
  const mb = B.marble, mk = B.get('black'), mg = B.gold, gr = B.get('giltRelief');
  const coral = [];
  const shaftH = 16.5, Dm = 1.75;
  HONOR_COLUMNS.forEach(([x, z], i) => {
    const broken = sunken && i === 1;
    for (const m of [mb, mk, mg, gr]) { m.push(); m.translate(x, SUMMIT, z); }
    // stepped black base, marble die with a gilt trident panel on each face, cornice
    for (let k = 0; k < 3; k++) { const h = 2.9 - k * 0.45; box(mk, [-h, k * 0.35 - 0.6, -h], [h, (k + 1) * 0.35, h], 0.03, [0.1, 0.9, 0.2, 0]); }
    const y0 = 1.05, yd = y0 + 3.2;
    box(mb, [-1.8, y0, -1.8], [1.8, y0 + 0.4, 1.8], 0.03, [0.1, 0.8, 0.3, 0]);
    box(mb, [-1.55, y0 + 0.4, -1.55], [1.55, yd, 1.55], 0.02, [0.05, 0.3, 0.5, 0]);
    box(mb, [-1.85, yd, -1.85], [1.85, yd + 0.45, 1.85], 0.03, [0.05, 0.9, 0.5, 0]);
    box(mg, [-1.87, yd + 0.12, -1.87], [1.87, yd + 0.2, 1.87], 0, [0.1, 0.4, 0, 0]);
    for (let f = 0; f < 4; f++) {
      gr.push(); gr.rotateY((f * PI) / 2); gr.translate(0, y0 + 0.75, 1.55);
      box(gr, [-1.05, 0, 0], [1.05, 2.1, 0.05], 0.01, [0.2, 0.6, 0, 0]);
      gr.translate(0, 0.12, 0.05); trident(gr, 1.85, { detail: 0.4 });
      gr.pop();
    }
    // shaft with entasis (white marble), gold astragal + bell capital, abacus
    const ys = yd + 0.45, top = broken ? ys + shaftH * 0.42 : ys + shaftH;
    const R = Dm / 2;
    const prof = [[R * 1.18, ys, 0, 0.5, true], [R * 1.18, ys + 0.3, 0, 0.6, true], [R * 1.05, ys + 0.45, 0.2, 0]];
    for (let k = 1; k <= 8; k++) { const t = k / 8; prof.push([R * (1 - 0.13 * t + 0.04 * Math.sin(PI * t)), ys + 0.45 + (top - ys - 0.45) * t, 0.6, 0]); }
    lathe(mb, prof, 24, { capTop: broken });
    if (!broken) {
      lathe(mg, [[R * 0.9, top, 0, 0], [R * 0.98, top + 0.12, 0, 0.6, true], [R * 0.96, top + 0.2, 0, 0], [R * 1.25, top + 1.3, 0.2, 0], [R * 1.45, top + 1.45, 0, 0.6, true]], 24, { capTop: true });
      box(mb, [-R * 1.7, top + 1.45, -R * 1.7], [R * 1.7, top + 1.95, R * 1.7], 0.03, [0.05, 0.9, 0.4, 0]);
      box(mg, [-R * 1.72, top + 1.55, -R * 1.72], [R * 1.72, top + 1.62, R * 1.72], 0, [0.1, 0.4, 0, 0]);
      const fac = L.bearingOf(x, z + 30);
      engine.slots.statue.push({ pos: [x, SUMMIT + top + 1.95, z], facing: fac, size: 4.6, tag: 'pinnacle', type: i % 2 ? 'nymph' : 'kingSpear' });
      if (sunken) coral.push({ pos: [x, SUMMIT + top + 1.95, z], normal: [0, 1, 0], size: 0.9, tag: 'honor-column' });
    }
    for (const m of [mb, mk, mg, gr]) m.pop();
    if (broken) {
      // fallen drums toward the south-east
      const drum = drumGeometry({ order: 'ionic', diameter: Dm * 0.95, height: 2.2, chips: 0.7, seed: 17, detail: 0.5 });
      const m4 = new THREE.Matrix4();
      for (let k = 0; k < 4; k++) {
        const d = 4 + k * 2.4, a = 0.7 + 0.15 * ruinRand('hc' + k);
        m4.compose(new THREE.Vector3(x + Math.sin(a) * d, SUMMIT + Dm * 0.47, z + Math.cos(a) * d), new THREE.Quaternion().setFromEuler(new THREE.Euler(PI / 2, a + 0.3 * ruinRand('hcr' + k), 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
        B.addInstance('honorDrums', drum, m4);
        coral.push({ pos: [x + Math.sin(a) * d, SUMMIT + Dm, z + Math.cos(a) * d], normal: [0, 1, 0], size: 0.8, tag: 'honor-drum' });
      }
    }
    engine.footprints.addRect(x, z, 3.2, 3.2, 0, 'honor-column');
    // r4: urns stand on the plaza paving just off the lowest step corner (were 0.35 m in the air over the second step)
    if (!sunken) for (const [dx, dz] of [[-3.55, 3.55], [3.55, 3.55]]) engine.slots.urn.push({ pos: [x + dx, SUMMIT + 0.04, z + dz], facing: 180, size: 0.9, tag: 'honor-column' });
  });
  for (const [x, z] of HONOR_COLUMNS) B.occBox([x - 1.55, SUMMIT + 1.4, z - 1.55], [x + 1.55, SUMMIT + 4.2, z + 1.55]);
  const g = B.finalize({ aoCell: 0.8, aoRays: 12 });
  engine.add(g);
  addCoral(engine, coral);
  ctx.tris += B.triangles;
}

// ------------------------------------------------------------------------------------------- cascade corridors
/** true if a cascade (water module plan) crosses radius r near compass bearing b (deg) — keep it open */
function cascadeAt(ctx, r, b, margin = 4) {
  for (const c of ctx.casc || []) {
    if (c.kind !== 'hill') continue;
    const r0 = Math.hypot(c.from[0], c.from[2]);
    if (r < r0 - 3) continue;
    const half = ((c.width / 2 + margin + (r - r0) * 0.06) / r) * (180 / PI);
    const d = Math.abs(((b - c.bearing + 540) % 360) - 180);
    if (d < half) return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------- ledge palaces
function buildPalaces(engine, ctx) {
  const sunken = isSunken(engine);
  const [t1, t2] = L.CITADEL.terraces;
  const B = new Building('citadelPalaces', { detail: 0.7, seed: 71, variant: sunken ? 'ruined' : 'weathered', weather: sunken ? 0.85 : 0.3 });
  const colA = simpleColumnGeometry({ height: 6.0, diameter: 0.68, segs: 12 });
  const colB = simpleColumnGeometry({ height: 4.6, diameter: 0.52, segs: 10 });
  const list = [];
  const coral = [];
  const place = (r, b, y, o) => {
    const [x, z] = L.polar(r, b);
    const M = new THREE.Matrix4().makeRotationY(L.headingToRotY(b)).setPosition(x, y, z);
    const res = palace(B, { ...o, at: M, ruin: sunken });
    list.push({ pos: [x, y, z], bearing: b, w: o.w, d: o.d, top: y + res.domeTop });
    engine.footprints.addRect(x, z, o.w / 2 + 1, o.d / 2 + 1, L.headingToRotY(b), 'palace');
    if (sunken) coral.push({ pos: [x, y + res.top * 0.9, z], normal: [0, 1, 0], size: 1.4, tag: 'palace' });
    // banner slots on the facade (golden)
    // r4: the banners hang between the portico columns (free mount: 'columns' tag), under the architrave, never below the floor
    if (!sunken && o.portico) for (const s of [-1, 1]) {
      // centre of the intercolumniation nearest ±0.32 w (palace(): n columns over span w - 1.2 at local z = d/2 - 0.8)
      const nC = Math.max(2, Math.round(o.w / (o.colSpacing ?? 3.4)) + 1), span = o.w - 1.2, st = span / (nC - 1);
      const gi = Math.max(0, Math.min(nC - 2, Math.round((s * 0.32 * o.w + span / 2) / st - 0.5)));
      const lx = -span / 2 + (gi + 0.5) * st;
      const [bx, bz] = L.polar(r + o.d / 2 - 0.8, b + (lx / r) * 180 / PI);
      const top = y + o.podium + o.colGeo.info.height - 0.15, len = Math.min(5, o.colGeo.info.height - 1.2);
      engine.slots.banner.push({ pos: [bx, top, bz], facing: b, width: Math.min(1.6, len * 0.36, st - o.colGeo.info.D - 0.3), height: len, size: len, tag: 'palace-facade columns' });
    }
  };
  // fill the free arcs of each ledge (not the stair, not the cascade corridors) with palaces
  const fillLedge = (r, y, depth, wMin, wMax, mk) => {
    const step = 0.25, free = [];
    for (let b = 0; b < 360; b += step) {
      const blocked = Math.abs(b - 180) < ((L.CITADEL_STAIR.width / 2 + 6) / r) * (180 / PI) || cascadeAt(ctx, r, b, 4) || cascadeAt(ctx, r + depth / 2, b, 4) || cascadeAt(ctx, r - depth / 2, b, 4);
      free.push(!blocked);
    }
    // rotate so that we start inside a blocked run (the stair)
    const N = free.length, start = Math.round(180 / step);
    let k = 0, idx = 0;
    while (k < N) {
      while (k < N && !free[(start + k) % N]) k++;
      const k0 = k;
      while (k < N && free[(start + k) % N]) k++;
      const arcDeg = (k - k0) * step, arcM = (arcDeg * PI / 180) * r;
      if (arcM < wMin + 2) continue;
      const n = Math.max(1, Math.round(arcM / ((wMin + wMax) / 2 + 3)));
      const each = arcM / n;
      for (let j = 0; j < n; j++) {
        const bc = ((start + k0) * step + ((j + 0.5) * each) / r * (180 / PI)) % 360;
        const w = Math.min(wMax, each - 3);
        if (w < wMin * 0.8) continue;
        mk(r, bc, y, w, depth, idx++);
      }
    }
  };
  const colP = simpleColumnGeometry({ height: 5.2, diameter: 0.55, segs: 10 });
  const pav = (r, b, y, w, i) => {
    const [x, z] = L.polar(r, b);
    const M = new THREE.Matrix4().makeRotationY(L.headingToRotY(b)).setPosition(x, y, z);
    const R = Math.min(w / 2 - 1.8, 5.5);
    pavilion(B, { R, n: R > 4.5 ? 12 : 10, colGeo: colP, colKey: 'pavCols', at: M, ruin: sunken });
    engine.footprints.addCircle(x, z, R + 2, 'pavilion');
    list.push({ pos: [x, y, z], bearing: b, w: 2 * R, d: 2 * R, top: y + 12, kind: 'pavilion' });
    engine.slots.statue.push({ pos: [x, y + 0.9, z], facing: b, size: 2.6, tag: 'pavilion' });
  };
  // r3: the south face (bearings 110-250, seen by shots 1, 4, 5) keeps the great red rampart readable: low palaces and open
  // domed pavilions pushed to the outer edge of each ledge (refs 4 / 5: the red tiers rise behind low colonnades and domes)
  const south = (b) => b > 110 && b < 250;
  fillLedge((t1.r0 + t1.r1) / 2 + 1.5, t1.y, Math.min(13, t1.r1 - t1.r0 - 7), 14, 30, (r, b, y, w, d, i) => {
    if (south(b)) {
      // only small domed pavilions at the outer lip of the ledge: the great red rampart stays whole behind (ref 5)
      if (Math.abs(b - 180) < 75 && i % 2 === 1) return;
      return pav(t1.r1 - 6, b, y, Math.min(w, 10.5), i);
    }
    if (i % 4 === 2 && w < 24) return pav(r, b, y, w, i);
    place(r, b, y, { w, d, h: 9 + 4 * hash3(i, 2, 2), wall: hash3(i, 3, 3) < 0.5 ? 'red' : 'banded', portico: true, colGeo: colA, colKey: 'palColsA', porticoDepth: 4.2, podium: 1.2,
      dome: w > 14 && hash3(i, 4, 4) < 0.88 ? Math.min(w * 0.22, 4.4 + 2 * hash3(i, 5, 5)) : 0, storey2: hash3(i, 6, 6) < 0.4, seed: i + 3, colSpacing: 3.0 });
  });
  fillLedge((t2.r0 + t2.r1) / 2 + 1, t2.y, Math.min(10, t2.r1 - t2.r0 - 5), 10, 20, (r, b, y, w, d, i) => {
    if (south(b)) {
      // r3 (director): the lowest palaces facing w1 stay ≤ 8 m above their ledge (shot 4 sees the hill over them)
      if (i % 2 === 1) return pav(r + 1.5, b, y, Math.min(w, 11), i);
      return place(r + 1.5, b, y, { w: Math.min(w, 16), d: d - 1, h: 4.6, wall: hash3(i, 7, 3) < 0.6 ? 'red' : 'marble', portico: true, colGeo: colB, colKey: 'palColsB', porticoDepth: 3.0, podium: 0.8, dome: 0, seed: 100 + i, colSpacing: 2.6 });
    }
    if (i % 3 === 1) return pav(r, b, y, Math.min(w, 13), i);
    place(r, b, y, { w, d, h: 6 + 2.5 * hash3(i, 7, 2), wall: hash3(i, 7, 3) < 0.6 ? 'red' : 'marble', portico: hash3(i, 7, 4) < 0.7, colGeo: colB, colKey: 'palColsB', porticoDepth: 3.2, podium: 0.9,
      dome: w > 12 && hash3(i, 7, 5) < 0.6 ? 3.4 : 0, seed: 100 + i, colSpacing: 2.6 });
  });
  // red ramparts at the inner edge of each ledge (the red wall bands in tiers, refs 4, 5) with white towers
  const stairGap = (b, r) => Math.abs(b - 180) < ((L.CITADEL_STAIR.width / 2 + 4) / r) * (180 / PI);
  // r3: ledge-1 south garden (bearings 125-235): low planting only (olives, shrubs, garden palms, few small cypress) so the
  // red rampart reads full height from shots 1 / 4 / 5; the scatterer is kept off by a footprint band
  if (!sunken) {
    const rg = engine.rng('citadel-ledge1-garden');
    for (let b = 125; b <= 235; b += 1.6) {
      if (Math.abs(b - 180) < ((L.CITADEL_STAIR.width / 2 + 10) / t1.r0) * (180 / PI)) continue;
      for (const rr of [121, 129, 137, 146]) {
        if (cascadeAt(ctx, rr, b, 3)) continue;
        if (rg.random() < 0.35) continue;
        const [x, z] = L.polar(rr + (rg.random() - 0.5) * 5, b + (rg.random() - 0.5) * 1.2);
        if (!engine.footprints.isFree(x, z, 2.2)) continue;
        const u = rg.random();
        if (u < 0.12) (engine.slots.palm ||= []).push({ pos: [x, t1.y, z], size: 6 + 1.5 * rg.random(), tag: 'garden' });
        else (engine.slots.tree ||= []).push({ pos: [x, t1.y, z], tag: u < 0.45 ? 'olive' : u < 0.62 ? 'broad' : u < 0.7 ? 'cypress' : 'shrub', size: u < 0.45 ? 4.5 : u < 0.62 ? 5.5 : u < 0.7 ? 8 : 1.8 + rg.random() });
      }
    }
    for (let b = 125; b <= 235; b += 2) { const [x, z] = L.polar((t1.r0 + t1.r1) / 2 + 1, b); engine.footprints.addCircle(x, z, 26, 'citadel-ledge-garden'); }
  }
  // r3: the great orichalcum ramparts (refs 1, 4, 5). Tier 1 IS the plateau retaining wall (y 42 → 62.35, the walkway flush
  // with the plateau balustrade), tier 2 retains the slope above ledge 2 (y 22 → 34, a 13 m garden terrace on top).
  const towersOut = [];
  // r5: tier-1 parapet lowered to a curb where the shot-5 eye looks over the plateau rim at the temple (sightlines cross r 115.6 at
  // bearings 185-205; the stair gap covers < 190) and its mirror (shot 1 symmetry)
  const lowPar = (b) => { const d = Math.abs((((b % 360) + 360) % 360) - 180); return d > 8.5 && d < 29; };
  const RP = rampartPlan();
  const RB = new Building('citadelRamparts', { detail: 0.8, seed: 72, variant: sunken ? 'ruined' : 'weathered', weather: sunken ? 0.85 : 0.22 });
  RP.forEach((R, k) => {
    const rr = R.rOut;
    const res = greatRampart(RB, { ...R, seed: 300 + k, ruin: sunken, detail: engine.quality.detail >= 1 ? 0.8 : 0.6,
      gapAt: (b) => stairGap(b, rr) || cascadeAt(ctx, rr, b, k === 0 ? 7.5 : 2.0) || cascadeAt(ctx, R.rIn, b, k === 0 ? 7.5 : 2.0),   // r4: tier-1 gap wide enough to hold the whole outlet (refilled)
      // r4 (water spec.outlet): the plateau falls pour from arched outlets in the tier-1 face — the gap is walled up again around them
      outletAt: k === 0 ? (b) => {
        let best = null, bd = 1e9;
        for (const c of ctx.casc || []) {
          if (c.kind !== 'hill' || !c.outlet) continue;
          const d = Math.abs(((b - c.bearing + 540) % 360) - 180);
          if (d < ((c.outlet.width / 2 + 9) / rr) * (180 / PI) && d < bd) { bd = d; best = { ...c.outlet, bearing: c.bearing }; }
        }
        return best;
      } : null,
      onOutlet: (q) => { (engine.registry.temple ||= {}).outlets ||= []; engine.registry.temple.outlets.push({ bearing: (q.a * 180) / PI, width: q.width, sill: q.sill, top: q.top, r: rr }); },
      // regular towers away from the south face (refs 4 / 5: the south face is one long panelled red wall), towers framing
      // the stair (both tiers) and the cascades pouring through the plateau wall (tier 1)
      towerAt: (b, since) => !south(b) && since > R.towerEvery,
      // r5: no towers flanking the stair on either tier (with the stair they read as one tall column in shot 1; the tier-1 west one
      // stood in front of the temple in shot 5, the tier-2 east one in front of the hill in shot 4)
      flankAt: (b) => k === 0 && (!south(b) || Math.abs(b - 180) > 30),
      lowParapetAt: k === 0 ? lowPar : null,
      onTower: (p, a, top) => {
        towersOut.push([p[0], top, p[2]]);
        if (!sunken) engine.slots.banner.push({ pos: p, facing: (a * 180) / PI, width: 1.8, height: 6, size: 6, tag: 'citadel-tower' });
      },
      onBay: (bay) => {
        const fac = (bay.a * 180) / PI;
        if (sunken) { if (bay.i % 3 === 0) coral.push({ pos: [Math.sin(bay.a) * (rr - 1.5), bay.top, -Math.cos(bay.a) * (rr - 1.5)], normal: [0, 1, 0], size: 1.3, tag: 'rampart' }); return; }
        // urns on the parapet merlons, bougainvillea spilling over the parapet, garden planting on the tier-2 terrace
        const lowHere = k === 0 && lowPar(fac);
        if (bay.i % 2 === 0 && !lowHere) engine.slots.urn.push({ pos: [Math.sin(bay.a) * (rr + 0.05), R.yTop + 1.7, -Math.cos(bay.a) * (rr + 0.05)], facing: fac, size: 0.9, tag: 'rampart' });
        if (bay.i % 3 === 1 && !lowHere) engine.slots.flowers.push({ pos: [Math.sin(bay.a) * (rr - 0.6), R.yTop, -Math.cos(bay.a) * (rr - 0.6)], facing: fac, size: 3.2, tag: 'rampart-bougainvillea' });
        if (k === 1) {
          const mid = (R.rIn + rr) / 2 - 1;
          // r5: low planting only where shot 4 looks over the tier-2 terrace at the red tier 1 (water-level eye at bearing 163)
          const lowPlant = fac > 118 && fac < 178;
          const kind = lowPlant ? ['shrub', 'olive', 'shrub', 'shrub', 'olive', 'shrub'][bay.i % 6] : ['cypress', 'shrub', 'olive', 'shrub', 'cypress', 'broad'][bay.i % 6];
          const p = L.polar(mid + (hash3(bay.i, 4, 1) - 0.5) * 5, fac + (hash3(bay.i, 5, 1) - 0.5) * 2);
          if (kind === 'cypress' && bay.i % 4 === 0) (engine.slots.palm ||= []).push({ pos: [p[0], R.yTop, p[1]], size: 8 + 3 * hash3(bay.i, 6, 1), tag: 'garden' });
          else (engine.slots.tree ||= []).push({ pos: [p[0], R.yTop, p[1]], tag: kind, size: kind === 'cypress' ? 11 : kind === 'shrub' ? 1.8 : 5 });
        }
      } });
    void res;
    // keep the scatterers off the wall body / terrace (they would sit on the buried terrain under it)
    const ring = []; for (let s = 0; s <= 96; s++) ring.push(L.polar((R.rIn + rr) / 2 + 0.6, (s / 96) * 360));
    engine.footprints.addPath(ring, (rr - R.rIn) / 2 + 1.6, 'rampart');
  });
  const rg = RB.finalize({ ao: false });
  engine.add(rg);
  ctx.tris += RB.triangles;
  const g = B.finalize({ ao: false });
  engine.add(g);
  addCoral(engine, coral);
  (engine.registry.temple ||= {}).palaces = list;
  engine.registry.temple.ramparts = RP.map((R) => ({ r: R.rOut, rIn: R.rIn, y0: R.yFoot, h: R.yTop - R.yFoot, t: R.rOut - R.rIn, top: R.yTop }));
  engine.registry.temple.towers = towersOut;
  ctx.tris += B.triangles;
}

/** r3: the two great ramparts (pure, layout-derived): tier 1 = plateau retaining wall, tier 2 above ledge 2 */
export function rampartPlan() {
  const [t1, t2] = L.CITADEL.terraces;
  return [
    { rIn: L.CITADEL.plateau - 0.5, rOut: t1.r0 + 1.6, yFoot: t1.y, yTop: SUMMIT + 0.35, bay: 10.5, towerEvery: 44, towerH: 6 },
    { rIn: t1.r1 + 7.5, rOut: t2.r0 + 2.5, yFoot: t2.y, yTop: t2.y + 12, bay: 9, towerEvery: 40, towerH: 7 },
  ];
}

// ------------------------------------------------------------------------------------------- basin plan (pure)
/** jets of a spring fountain: tall column from the gilt bowl + a crown of arcs falling from the bowl rim into the basin */
function springJets(x, z) {
  const y = SUMMIT + 3.8, out = [{ pos: [x, y, z], dir: [0, 1, 0], speed: 8.5, width: 0.22, kind: 'column' }];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2 + 0.3; const c = Math.cos(a), s = Math.sin(a); out.push({ pos: [x + c * 2.2, y - 0.05, z + s * 2.2], dir: [c * 0.75, 0.66, s * 0.75], speed: 3.6, width: 0.09, kind: 'arc' }); }
  return out;
}
/** Nereid basin: one jet from the dolphin's mouth level arcing outward (statue faces away from the chariot) */
function nereidJets(x, z, top) {
  const dx = x - L.CHARIOT.pos[0], dz = z - L.CHARIOT.pos[2], l = Math.hypot(dx, dz) || 1;
  return [{ pos: [x + (dx / l) * 0.9, top + 1.1, z + (dz / l) * 0.9], dir: [(dx / l) * 0.7, 0.71, (dz / l) * 0.7], speed: 4.2, width: 0.08, kind: 'arc' }];
}
/**
 * Pure, layout-derived list of the fountain basins the temple module builds (same as registry.fountains, available
 * BEFORE temple.build runs — the water module builds first): [{ id, kind:'hot'|'cold'|'nereid', pos:[x, waterY, z], radius (inner), rimY, jets }]
 */
export function fountainPlan() {
  const out = [];
  for (const F of L.FOUNTAINS) {
    const R = F.radius, hb = 1.15;
    out.push({ id: F.id, kind: F.id, pos: [F.pos[0], SUMMIT + hb - 0.2, F.pos[2]], radius: R - Math.max(0.35, R * 0.07) - 0.02, rimY: SUMMIT + hb, bowl: { y: SUMMIT + 3.75, r: 2.3 }, jets: springJets(F.pos[0], F.pos[2]) });
  }
  const N = L.NEREIDS, C = L.CHARIOT, frontZ = L.TEMPLE.center[2] + L.TEMPLE.length / 2;
  let k = 0;
  for (let i = 0; i < N.count; i++) {
    const a = (i / N.count) * PI * 2;
    const x = N.center[0] + Math.sin(a) * N.radius, z = N.center[2] - Math.cos(a) * N.radius;
    if (z < frontZ + 5) continue;
    if (Math.abs(x) < PED.w / 2 + 4 && Math.abs(z - C.pos[2]) < PED.d / 2 + 4) continue;
    const Rb = 3.6, hb = 0.95;
    out.push({ id: 'nereid' + k++, kind: 'nereid', pos: [x, SUMMIT + hb - 0.15, z], radius: Rb - 0.35 - 0.02, rimY: SUMMIT + hb, jets: nereidJets(x, z, SUMMIT + 1.55) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- build
export async function build(engine) {
  const t0 = performance.now();
  const ctx = { tris: 0 };
  try { const C = await import('../water/cascades.js'); ctx.casc = C.planCascades(); } catch (e) { ctx.casc = []; console.warn('[temple] no cascade plan', e.message); }
  const parts = (engine.params.get('templeParts') || 'temple,forecourt,colossus,stair,plateau,palaces,honor').split(',');
  const time = {};
  const run = (name, fn) => { if (!parts.includes(name)) return; const t = performance.now(); const tr0 = ctx.tris; try { fn(engine, ctx); time[name + 'Tris'] = +((ctx.tris - tr0) / 1e6).toFixed(2); } catch (e) { console.error('[temple] ' + name + ' failed', e.stack || e); } time[name] = Math.round(performance.now() - t); };
  run('temple', buildTemple);
  run('forecourt', buildForecourt);
  run('colossus', buildColossusPedestal);
  run('stair', buildStair);
  run('plateau', buildPlateauBuildings);
  run('palaces', buildPalaces);
  run('honor', buildHonorColumns);
  // r7: per-shot material tone (src/materials/tone.js), golden era only; a shot / --set may carry `tone: {...}` for look-dev
  if (!isSunken(engine)) engine.onShot((shot) => setTone({ ...(SHOT_TONE[shot.id] || {}), ...(shot.tone || {}) }));
  console.log(`[temple] built in ${Math.round(performance.now() - t0)} ms, ${(ctx.tris / 1e6).toFixed(2)} M tris`, JSON.stringify(time));
}

// r7 (citadel): shot 3 colourfulness (ref 3: sun-warmed marble, red-gold glints) without touching the grade
// (high 8 spp, same build: colourfulness 57.4 → 59.9, rg 25.0 → 29.4 (ref 29.0), yb 38.6 → 38.8, percentiles unchanged)
const SHOT_TONE = {
  3: { uStoneWarm: [1.12, 0.965, 0.99], uStoneShade: [0.97, 0.975, 1.05], uStoneSat: 1.35,
    uGoldTint: [1.06, 0.87, 1.02], uGoldSat: 1.05, uGoldRough: 0.64, uGoldFill: 0.68 },
};

// ------------------------------------------------------------------------------------------- test
export async function test(engine) {
  const view = Number(engine.params.get('view') || 0);
  if (view === 0) {
    const mats = [S.whiteStone(), S.redStone(), S.blackStone(), S.limestone(), S.bandedStone({ band: 0.8 }), S.whiteStone({ courses: 0.6 }),
      MT.orichalcumMaterial({ panels: { w: 1.2, h: 0.9, rivets: true } }), MT.goldMaterial(), MT.giltMaterial(), MT.bronzeMaterial(), MT.tinMaterial({ panels: { w: 1.0, h: 0.8 } }), MT.silverMaterial({ panels: { w: 1.4, h: 1.0, rivets: true } }), MT.goldMaterial({ crust: 0.35 }), MT.goldMaterial({ crust: 0.65 }), MT.bronzeMaterial({ crust: 0.5 })];
    mats.forEach((m, i) => {
      const x = (i % 6) * 3.2 - 8, z = Math.floor(i / 6) * 4 - 2;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4, 48), m); c.position.set(x, 2, z); engine.add(c);
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), m); b.position.set(x, 0.8, z + 1.8); b.rotation.y = 0.5; engine.add(b);
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14).rotateX(-PI / 2), S.mosaicFloor({ center: [0, 10], radius: 4.5, cell: 1.0 }));
    floor.position.set(0, 0.02, 10); engine.add(floor);
    const fl2 = new THREE.Mesh(new THREE.PlaneGeometry(10, 14).rotateX(-PI / 2), S.checkerFloor({ cell: 0.8, pattern: 1 }));
    fl2.position.set(12, 0.02, 10); engine.add(fl2);
    return { views: [{ pos: [4, 9, 26], target: [1, 1, 4], fov: 45 }] };
  }
  // views ≥ 1: the citadel top on a stand-in hill (plateau disc + ledges) in either era
  const hill = new THREE.Group();
  const hm = S.limestone({ weather: 0.4 });
  const [T1, T2] = L.CITADEL.terraces, Qy = L.CITADEL.quayY;   // r3 (director): stand-in hill follows the layout (was hard-coded 32 / 18)
  const prof = [[0.01, SUMMIT], [L.CITADEL.plateau, SUMMIT], [T1.r0, T1.y], [T1.r1, T1.y], [T2.r0, T2.y], [T2.r1, T2.y], [214, Qy], [230, Qy], [231, 0]];
  hill.add(new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 128), hm));
  engine.add(hill);
  await build(engine);
  if (engine.params.get('dbgFar')) {
    const bb = new THREE.Box3(), c = new THREE.Vector3();
    engine.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isInstancedMesh) { for (let i = 0; i < o.count; i++) { const m = new THREE.Matrix4(); o.getMatrixAt(i, m); c.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld); if (Math.hypot(c.x, c.z) > 235) console.log('far inst', o.name, i, c.toArray().map(Math.round)); } return; }
      o.geometry.computeBoundingBox(); bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); bb.getCenter(c);
      if (Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z)) > 240) console.log('far mesh', o.name, bb.min.toArray().map(Math.round), bb.max.toArray().map(Math.round));
    });
  }
  const views = [
    null,
    { pos: [34, 49, 150], target: [0, 60, 10], fov: 46 },                // shot 3 / 6 camera (round-0)
    { pos: [16, 54, 92], target: [0, 61, -8], fov: 42 },                  // closer: temple facade (ref 3 framing without the chariot)
    { pos: [-260, 220, 420], target: [0, 30, 0], fov: 38 },               // aerial citadel
    { pos: [70, 60, 20], target: [0, 60, -10], fov: 50 },                 // side detail
    { pos: [10, 47, 108], target: [0, 46, 80], fov: 55 },                 // forecourt / rose
    { pos: [90, 110, 60], target: [0, 50, -12], fov: 45 },                // high oblique (ruin check)
  ];
  return { views: views.map((v) => v || views[1]) };
}
