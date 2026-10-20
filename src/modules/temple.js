// Temple of Poseidon + the citadel: forecourt with the compass-rose mosaic, chariot pedestal, Nereid and spring
// basins, colossus pedestal, the grand stair down the south face, stoas / tholoi on the plateau, palaces on
// the ledges. Both eras (sunken: ruined, coral slots). OWNER: temple agent.
//
// registry.temple = { stylobateY, ridgeY, yTop, pediments[], chariot:{top,w,d}, colossus:{top,w}, fountains[], nereidBasins[],
//                     stair:{steps:[[z,y]], x0, x1}, plaza:{y, radius}, palaces[] }
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { isSunken, ruined, ruinRand } from '../world/era.js';
import { Building } from '../arch/build.js';
import { MeshBuilder, box, lathe, hash3, lerp } from '../arch/geom.js';
import { columnGeometry, columnInfo } from '../arch/orders.js';
import { balustradeGeometry, pedestal, stoa } from '../arch/elements.js';
import { tholos } from '../arch/tholos.js';
import { brokenColumnGeometry, drumGeometry, roughBlockGeometry } from '../arch/ruins.js';
import { poseidonTemple } from '../arch/poseidon.js';
import { palace, basin, trident, silhouette, pinnacle, simpleColumnGeometry, rampart, pavilion } from '../arch/atlantis.js';
import * as S from '../materials/stone.js';
import * as MT from '../materials/metal.js';

const PI = Math.PI;
const SUMMIT = L.CITADEL.summit;

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
  const rose = { center: [0, 94], radius: 8.8 };
  const pav = S.mosaicFloor({ center: rose.center, radius: rose.radius, rotation: 0, cell: 1.8, pattern: 4, tessera: 0.075, weather: sunken ? 0.6 : 0.12, polish: sunken ? 0.1 : 0.75, rough: sunken ? 0.7 : 0.32 });
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
  // ---- chariot pedestal (black stone, gilt relief, steps) — statues module puts the group on top
  const C = L.CHARIOT;
  const cw = 30, cd = 18, ch = C.pedestal;
  const bz = B.get('dome');
  mb.push(); mk.push(); mg.push(); gr.push(); bz.push();
  for (const m of [mb, mk, mg, gr, bz]) m.translate(C.pos[0], C.pos[1], C.pos[2]);
  // steps around (white)
  for (let k = 0; k < 3; k++) box(mb, [-cw / 2 - 2.4 + k * 0.7, 0, -cd / 2 - 2.4 + k * 0.7], [cw / 2 + 2.4 - k * 0.7, 0.3 * (k + 1), cd / 2 + 2.4 - k * 0.7], 0.02, [0.05, 1, 0.1, 5.12]);
  const yb = 0.9;
  box(mk, [-cw / 2 - 0.4, yb, -cd / 2 - 0.4], [cw / 2 + 0.4, yb + 0.6, cd / 2 + 0.4], 0.03, [0.1, 0.8, 0.2, 0]);
  box(mk, [-cw / 2, yb + 0.6, -cd / 2], [cw / 2, ch - 0.9, cd / 2], 0.02, [0.1, 0.2, 0.3, 0]);
  box(mk, [-cw / 2 - 0.45, ch - 0.9, -cd / 2 - 0.45], [cw / 2 + 0.45, ch, cd / 2 + 0.45], 0.03, [0.05, 0.8, 0.5, 0]);
  box(mg, [-cw / 2 - 0.47, ch - 0.75, -cd / 2 - 0.47], [cw / 2 + 0.47, ch - 0.6, cd / 2 + 0.47], 0, [0.1, 0.4, 0, 0]);
  box(mg, [-cw / 2 - 0.42, yb + 0.45, -cd / 2 - 0.42], [cw / 2 + 0.42, yb + 0.55, cd / 2 + 0.42], 0, [0.1, 0.4, 0, 0]);
  // pilasters with gold capitals + relief panels on all four faces
  const panel = (len, axis, sgn) => {
    const n = Math.max(1, Math.round(len / 7.5));
    for (let i = 0; i <= n; i++) {
      const s = -len / 2 + (len * i) / n;
      const p0 = axis === 'z' ? [s - 0.45, sgn * (cd / 2) - (sgn > 0 ? 0 : 0.35)] : [sgn * (cw / 2) - (sgn > 0 ? 0 : 0.35), s - 0.45];
      const p1 = axis === 'z' ? [s + 0.45, sgn * (cd / 2) + (sgn > 0 ? 0.35 : 0)] : [sgn * (cw / 2) + (sgn > 0 ? 0.35 : 0), s + 0.45];
      box(mk, [p0[0], yb + 0.6, p0[1]], [p1[0], ch - 0.9, p1[1]], 0.02, [0.05, 0.8, 0.3, 0]);
      box(mg, [p0[0] - 0.05, ch - 1.3, p0[1] - 0.05], [p1[0] + 0.05, ch - 0.9, p1[1] + 0.05], 0.01, [0.1, 0.6, 0, 0]);
      if (i < n) {
        const sm = s + len / n / 2, pw = len / n - 1.8, ph = ch - yb - 2.4;
        const PM = new THREE.Matrix4();
        if (axis === 'z') { PM.makeTranslation(sm, yb + 1.1, sgn * cd / 2); if (sgn < 0) PM.multiply(new THREE.Matrix4().makeRotationY(PI)); }
        else { PM.makeTranslation(sgn * cw / 2, yb + 1.1, sm); PM.multiply(new THREE.Matrix4().makeRotationY(sgn * PI / 2)); }
        for (const m of [gr, bz, mg]) { m.push(); m.apply(PM); }
        // gilt frame, dark bronze field, gold figures (ref 3 pedestal panels)
        const fw = 0.22;
        box(gr, [-pw / 2, 0, 0], [pw / 2, fw, 0.12], 0.02, [0.2, 0.7, 0, 0]);
        box(gr, [-pw / 2, ph - fw, 0], [pw / 2, ph, 0.12], 0.02, [0.2, 0.7, 0, 0]);
        box(gr, [-pw / 2, fw, 0], [-pw / 2 + fw, ph - fw, 0.12], 0.02, [0.2, 0.7, 0, 0]);
        box(gr, [pw / 2 - fw, fw, 0], [pw / 2, ph - fw, 0.12], 0.02, [0.2, 0.7, 0, 0]);
        box(bz, [-pw / 2 + fw, fw, 0], [pw / 2 - fw, ph - fw, 0.03], 0, [0.5, 0, 0, 0]);
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
  B.occBox([C.pos[0] - cw / 2 - 2.4, C.pos[1], C.pos[2] - cd / 2 - 2.4], [C.pos[0] + cw / 2 + 2.4, C.pos[1] + ch, C.pos[2] + cd / 2 + 2.4]);
  reg.chariot = { pos: C.pos, top: C.pos[1] + ch, w: cw, d: cd };
  engine.footprints.addRect(C.pos[0], C.pos[2], cw / 2 + 3, cd / 2 + 3, 0, 'chariot');
  if (sunken) for (let i = 0; i < 18; i++) coral.push({ pos: [C.pos[0] + (hash3(i, 1, 1) - 0.5) * cw, C.pos[1] + ch, C.pos[2] + (hash3(i, 2, 2) - 0.5) * cd], normal: [0, 1, 0], size: 1.2, tag: 'chariot-pedestal' });
  // braziers at the pedestal corners
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) engine.slots.brazier.push({ pos: [C.pos[0] + sx * (cw / 2 + 1.6), C.pos[1] + 0.9, C.pos[2] + sz * (cd / 2 + 1.6)], facing: 180, size: 1.0, tag: 'chariot' });
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
function buildStair(engine, ctx) {
  const sunken = isSunken(engine);
  const St = L.CITADEL_STAIR;
  const hw = St.width / 2;
  const z0 = St.from[2], z1 = St.to[2];
  // upper terrain envelope across the stair width (monotone non-increasing toward the sea)
  const dz = 0.25, nz = Math.ceil((z1 - z0) / dz);
  const env = new Float32Array(nz + 1);
  for (let i = 0; i <= nz; i++) { const z = z0 + i * dz; let m = -1e9; for (let x = -hw - 1; x <= hw + 1; x += 1.5) m = Math.max(m, heightAt(x, z)); env[i] = m; }
  for (let i = nz - 1; i >= 0; i--) env[i] = Math.max(env[i], env[i + 1]);
  const envAt = (z) => env[Math.max(0, Math.min(nz, Math.round((z - z0) / dz)))];
  // steps: riser 0.24, tread ≥ 0.48; a step drops when the envelope allows it
  const riser = 0.24, minTread = 0.5;
  const steps = [];
  let y = St.from[1], z = z0;
  steps.push([z, y]);
  while (z < z1 - 0.01 && y > St.to[1] + 0.05) {
    let zn = z + minTread;
    while (zn < z1 && envAt(zn) + 0.06 > y - riser) zn += dz;
    // never more than ~2.6 m flat treads on the flights: insert a landing marker but keep stepping
    const yn = Math.max(St.to[1], y - riser);
    if (zn >= z1) zn = z1;
    steps.push([zn, yn]);
    z = zn; y = yn;
  }
  const B = new Building('citadelStair', { detail: 1, seed: 41, variant: sunken ? 'ruined' : 'weathered', weather: sunken ? 0.85 : 0.25 });
  const mb = B.marble, mg = B.gold, mk = B.get('black');
  const coral = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const [za, ya] = steps[i], [zb] = steps[i + 1];
    const bottom = Math.min(ya - 1.2, heightAt(0, (za + zb) / 2) - 1.0);
    const segs = Math.round(St.width / 2.4);
    for (let k = 0; k < segs; k++) {
      const x0 = -hw + (St.width / segs) * k, x1 = x0 + St.width / segs;
      const sag = sunken ? (ruinRand('stair:' + i + ':' + k) - 0.5) * 0.08 - (ruined('stair:c:' + i + ':' + k, 0.05) ? 0.12 : 0) : (hash3(i, k, 3) - 0.5) * 0.008;
      box(mb, [x0 + 0.004, bottom, za - 0.03], [x1 - 0.004, ya + sag, zb + 0.02], 0.025, [0.05, 1, 0.05, zb - za > 1.2 ? 5.12 : 0]);
    }
    if (sunken && i % 3 === 0) coral.push({ pos: [lerp(-hw, hw, ruinRand('stairc' + i)), ya, (za + zb) / 2], normal: [0, 1, 0], size: 0.7, tag: 'stair' });
  }
  // cheek walls + parapets (stepped coping) + pedestals every ~10 m
  const ped = [];
  for (const s of [-1, 1]) {
    const xc = s * (hw + 0.9);
    let lastPed = -1e9;
    for (let i = 0; i < steps.length - 1; i++) {
      const [za, ya] = steps[i], [zb] = steps[i + 1];
      const gb = Math.min(heightAt(xc, za), heightAt(xc, zb), heightAt(xc + s * 1.5, (za + zb) / 2)) - 1.5;
      box(mb, [xc - 0.9, gb, za - 0.02], [xc + 0.9, ya + 1.0, zb + 0.02], 0.02, [0.05, 0.6, 0.4, 3.05]);
      box(mb, [xc - 1.0, ya + 1.0, za - 0.03], [xc + 1.0, ya + 1.18, zb + 0.03], 0.02, [0.05, 0.9, 0.3, 0]);
      if (za - lastPed > 10.5 || i === 0) {
        lastPed = za;
        const yp = ya + 1.18;
        mb.push(); mb.translate(xc, yp, za + 0.4); pedestal(mb, { w: 1.6, d: 1.6, h: 1.5, wreath: false, panel: true, detail: 0.5 }); mb.pop();
        box(mg, [xc - 0.95, yp + 1.28, za + 0.4 - 0.95], [xc + 0.95, yp + 1.34, za + 0.4 + 0.95], 0, [0.1, 0.5, 0, 0]);
        ped.push([xc, yp + 1.5, za + 0.4]);
      }
    }
  }
  // slots on the pedestals: alternate urns (bougainvillea), braziers, statues
  ped.forEach((p, i) => {
    const k = i % 3;
    const slot = { pos: p, facing: p[0] < 0 ? 90 : 270, size: k === 2 ? 2.4 : 1.0, tag: 'stair-pedestal' };
    if (k === 0) engine.slots.urn.push(slot); else if (k === 1) engine.slots.brazier.push(slot); else engine.slots.statue.push(slot);
    engine.slots.flowers.push({ pos: [p[0], p[1] - 1.5, p[2] + 2], facing: slot.facing, size: 2.2, tag: 'stair-bougainvillea' });
    if (sunken) coral.push({ pos: p, normal: [0, 1, 0], size: 0.8, tag: 'stair-pedestal' });
  });
  const g = B.finalize({ ao: false });
  engine.add(g);
  addCoral(engine, coral);
  engine.footprints.addPath([[0, z0], [0, z1]], hw + 2.5, 'citadel-stair');
  const reg = engine.registry.temple ||= {};
  reg.stair = { steps, x0: -hw, x1: hw, pedestals: ped };
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
    if (!sunken && o.portico) for (const s of [-1, 1]) {
      const [bx, bz] = L.polar(r + o.d / 2 + 0.3, b + s * (o.w * 0.32 / r) * 180 / PI);
      engine.slots.banner.push({ pos: [bx, y + o.podium + o.h - 0.6, bz], facing: b, width: 1.6, height: 5, size: 5, tag: 'palace-facade' });
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
  fillLedge((t1.r0 + t1.r1) / 2 + 1.5, t1.y, Math.min(13, t1.r1 - t1.r0 - 7), 14, 30, (r, b, y, w, d, i) => {
    if (i % 4 === 2 && w < 24) return pav(r, b, y, w, i);
    place(r, b, y, { w, d, h: 9 + 4 * hash3(i, 2, 2), wall: hash3(i, 3, 3) < 0.5 ? 'red' : 'banded', portico: true, colGeo: colA, colKey: 'palColsA', porticoDepth: 4.2, podium: 1.2,
      dome: w > 16 && hash3(i, 4, 4) < 0.7 ? Math.min(w * 0.2, 4.2 + 2 * hash3(i, 5, 5)) : 0, storey2: hash3(i, 6, 6) < 0.4, seed: i + 3, colSpacing: 3.0 });
  });
  fillLedge((t2.r0 + t2.r1) / 2 + 1, t2.y, Math.min(10, t2.r1 - t2.r0 - 5), 10, 20, (r, b, y, w, d, i) => {
    if (i % 3 === 1) return pav(r, b, y, Math.min(w, 13), i);
    place(r, b, y, { w, d, h: 6 + 2.5 * hash3(i, 7, 2), wall: hash3(i, 7, 3) < 0.6 ? 'red' : 'marble', portico: hash3(i, 7, 4) < 0.7, colGeo: colB, colKey: 'palColsB', porticoDepth: 3.2, podium: 0.9,
      dome: w > 14 && hash3(i, 7, 5) < 0.35 ? 3.2 : 0, seed: 100 + i, colSpacing: 2.6 });
  });
  // red ramparts at the inner edge of each ledge (the red wall bands in tiers, refs 4, 5) with white towers
  const stairGap = (b, r) => Math.abs(b - 180) < ((L.CITADEL_STAIR.width / 2 + 4) / r) * (180 / PI);
  const towersOut = [];
  for (const [rr, y0, h, tEv] of [[t1.r0 + 1.4, t1.y, 11, 34], [t2.r0 + 1.2, t2.y, 8.5, 30]]) {
    rampart(B, { r: rr, y0, h, t: 2.4, seed: rr, ruin: sunken, towerEvery: tEv, towerH: h + 8,
      gapAt: (b) => stairGap(b, rr) || cascadeAt(ctx, rr, b, 2.5),
      onTower: (p, a) => { towersOut.push(p); if (!sunken) engine.slots.banner.push({ pos: [p[0] + Math.sin(a) * 2.2, y0 + h + 6, p[2] - Math.cos(a) * 2.2], facing: (a * 180) / PI, width: 1.4, height: 4.5, size: 4.5, tag: 'citadel-tower' }); } });
    if (sunken) for (let k = 0; k < 24; k++) { const a = (k / 24) * PI * 2; coral.push({ pos: [Math.sin(a) * rr, y0 + h * 0.6, -Math.cos(a) * rr], normal: [0, 1, 0], size: 1.2, tag: 'rampart' }); }
  }
  const g = B.finalize({ ao: false });
  engine.add(g);
  addCoral(engine, coral);
  (engine.registry.temple ||= {}).palaces = list;
  engine.registry.temple.ramparts = [{ r: t1.r0 + 1.4, y0: t1.y, h: 11, t: 2.4 }, { r: t2.r0 + 1.2, y0: t2.y, h: 8.5, t: 2.4 }];
  engine.registry.temple.towers = towersOut;
  ctx.tris += B.triangles;
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
    if (Math.abs(x) < 30 / 2 + 4 && Math.abs(z - C.pos[2]) < 18 / 2 + 4) continue;
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
  const parts = (engine.params.get('templeParts') || 'temple,forecourt,colossus,stair,plateau,palaces').split(',');
  const time = {};
  const run = (name, fn) => { if (!parts.includes(name)) return; const t = performance.now(); const tr0 = ctx.tris; try { fn(engine, ctx); time[name + 'Tris'] = +((ctx.tris - tr0) / 1e6).toFixed(2); } catch (e) { console.error('[temple] ' + name + ' failed', e.stack || e); } time[name] = Math.round(performance.now() - t); };
  run('temple', buildTemple);
  run('forecourt', buildForecourt);
  run('colossus', buildColossusPedestal);
  run('stair', buildStair);
  run('plateau', buildPlateauBuildings);
  run('palaces', buildPalaces);
  console.log(`[temple] built in ${Math.round(performance.now() - t0)} ms, ${(ctx.tris / 1e6).toFixed(2)} M tris`, JSON.stringify(time));
}

// ------------------------------------------------------------------------------------------- test
export async function test(engine) {
  const view = Number(engine.params.get('view') || 0);
  if (view === 0) {
    const mats = [S.whiteStone(), S.redStone(), S.blackStone(), S.limestone(), S.bandedStone({ band: 0.8 }), S.whiteStone({ courses: 0.6 }),
      MT.orichalcumMaterial({ panels: { w: 1.2, h: 0.9, rivets: true } }), MT.goldMaterial(), MT.giltMaterial(), MT.bronzeMaterial(), MT.tinMaterial({ panels: { w: 1.0, h: 0.8 } }), MT.silverMaterial({ panels: { w: 1.4, h: 1.0, rivets: true } })];
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
  const prof = [[0.01, SUMMIT], [L.CITADEL.plateau, SUMMIT], [150, 32], [172, 32], [192, 18], [208, 18], [214, 3], [230, 3], [231, 0]];
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
