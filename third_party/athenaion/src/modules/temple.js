// Temples module: the main Athenaion (octastyle Doric peripteral, Parthenon proportions, gilded
// details), the hill temple on the north-west crag, the island tholos ensemble in the lagoon
// (tholos + stair to the water + pier + balustrade) and secondary temples / stoa / pavilion on the
// acropolis terraces and hilltops.  Publishes engine.registry.temple (pediments, metopes, …),
// engine.slots (banner, statue, brazier, urn) and footprints.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import * as A from '../arch/index.js';
import { hash01 } from '../core/rng.js';

const PI = Math.PI;

/** terrain statistics over a rotated rectangle (hw × hd) */
function siteStats(x, z, hw, hd, rotY = 0) {
  const hs = [];
  const c = Math.cos(rotY), s = Math.sin(rotY);
  for (let i = -1; i <= 1.0001; i += 0.125) for (let j = -1; j <= 1.0001; j += 0.125) {
    const lx = i * hw, lz = j * hd;
    hs.push(heightAt(x + lx * c + lz * s, z - lx * s + lz * c));
  }
  hs.sort((a, b) => a - b);
  const q = (p) => hs[Math.floor(p * (hs.length - 1))];
  return { min: q(0), p10: q(0.1), p50: q(0.5), p90: q(0.9), max: q(1) };
}

function addFootprint(engine, x, z, hw, hd, rotY, tag) {
  engine.footprints?.addRect?.(x, z, hw, hd, rotY, tag);
}

/** register a finalised building in the world */
function place(engine, B, pos, rotY, o = {}) {
  const g = B.finalize({ position: pos, rotY, aoCell: o.aoCell, aoRays: o.aoRays });
  engine.add(g);
  B.publishSlots(engine);
  const fp = B.info.footprint;
  if (fp) {
    if (fp.r) engine.footprints?.addCircle?.(pos[0], pos[2], fp.r, o.tag || B.name);
    else addFootprint(engine, pos[0], pos[2], fp.hw, fp.hd, rotY, o.tag || B.name);
  }
  return g;
}

/** quality-dependent AO settings */
function aoQ(engine, big = false, far = false) {
  const q = engine.quality?.name || 'preview';
  if (far) return { aoCell: 1.1, aoRays: 18 };   // (r5) buildings seen from ≥ 500 m: coarse AO is enough (build time)
  if (q === 'preview') return { aoCell: big ? 1.0 : 0.8, aoRays: 24 };
  return { aoCell: big ? 0.75 : 0.6, aoRays: 36 };
}

// ============================================================================ main Athenaion
export function buildAthenaion(engine, pos, rotY, o = {}) {
  const det = o.detail ?? engine.quality?.detail ?? 1;
  const T = L.TEMPLE;
  const B = A.peripteralTemple({
    name: 'athenaion', order: 'doric', front: T.columns[0], side: T.columns[1], W: T.stylobate[1], L: T.stylobate[0],
    colH: T.columnHeight, steps: 3, stepH: 0.5, tread: 0.7, pitch: 15, plaques: true, gild: 1,
    acroteria: 'nike', corners: 'griffin', apexGroup: true, stairs: { width: 9 }, detail: Math.max(0.55, det), seed: 11,
    foundation: o.foundation ?? 4, acroScale: 1.15,
    darkCella: true,  // cella walls in deep shade behind the peristyle (ref 5)
    interiorDark: 0.5, // (r5) darker skins behind the peristyle: the flank colonnade reads from afar (refs 1, 3, 4)
    pedRecess: 0.3,   // pediment floor ≈ 1.2 m deep: sculpture in two depth layers (statues agent, ref 5)
    overrides: { weather: 1.0, lichen: 1.1, streaks: 1.2, heavy: 1.3, ochre: 1.0 },  // ref 5: grey-black speckle + ochre stains on the fluting
  });
  const g = place(engine, B, pos, rotY, { ...aoQ(engine, true), tag: 'temple' });
  return { B, g };
}

// ============================================================================ island tholos ensemble
function islandEnsemble(engine, center, rot, det) {
  const [cx, cy, cz] = center;
  const B = A.tholos({ name: 'island-tholos', radius: 8.2, columns: 14, colH: 8.2, D: 0.94, hF: 1.3, steps: 6, stepH: 0.27, tread: 0.42, detail: Math.max(0.45, det * 0.8), seed: 21, gild: 1, foundation: 4 });
  const crep = 6 * 0.27;
  const groundY = cy;
  const top = groundY + crep + 0.05;
  place(engine, B, [cx, top, cz], rot, { ...aoQ(engine), tag: 'tholos' });
  // ---- terrace ring (paved platform) + balustrade + stair to the water + pier (own building)
  const E = new A.Building('island-terrace', { detail: det, seed: 23, variant: 'weathered' });
  const mb = E.marble;
  const rT = 8.2 + 6 * 0.42 + 2.4; // terrace radius
  const yT = groundY + 0.05;       // terrace level (local y = 0 at yT)
  // paved disc (slightly above the rock) with a rim course
  // ashlar retaining wall (battered plinth, coursed drum, moulded cornice) standing on the rock (ref 2)
  // (gap where the stair to the water leaves the terrace, heading 195°)
  const gapA = L.headingToRotY(195), gapW = 0.27;
  const wallArc = { a0: gapA + gapW, a1: gapA + 2 * PI - gapW };
  // (r5) stepped base (ref 2): three receding ashlar tiers with moulded ledges instead of one tall drum
  A.lathe(mb, [[rT + 3.2, -9.5, 0.3, 0, true], [rT + 3.0, -5.6, 0.2, 0.2, true], [rT + 3.15, -5.45, 0.2, 0.6, true], [rT + 3.15, -5.2, 0.1, 0.7, true], [rT + 1.75, -5.2, 0.3, 0.3, true]], 72, { masonry: 3.058, streak: 0.8, ...wallArc });
  A.lathe(mb, [[rT + 1.75, -5.2, 0.3, 0, true], [rT + 1.6, -2.9, 0.2, 0.2, true], [rT + 1.75, -2.75, 0.2, 0.6, true], [rT + 1.75, -2.5, 0.1, 0.7, true], [rT + 0.32, -2.5, 0.3, 0.3, true]], 72, { masonry: 3.058, streak: 0.8, ...wallArc });
  A.lathe(mb, [[rT + 0.32, -2.5, 0.3, 0, true], [rT + 0.3, -0.42, 0.15, 0.1, true]], 72, { masonry: 3.058, streak: 0.8, ...wallArc });
  A.lathe(mb, [[rT + 0.3, -0.42, 0.4, 0, true], [rT + 0.42, -0.3, 0.1, 0.4, true], [rT + 0.48, -0.06, 0.05, 0.8, true], [rT + 0.48, 0.0, 0.05, 0.8, true], [rT - 0.05, 0.12, 0.05, 0.6, true]], 72, { streak: 0.4, ...wallArc });
  A.lathe(mb, [[rT - 0.05, 0.12, 0.05, 0.6, true], [0.5, 0.12, 0, 0]], 72, {});
  A.surface(mb, (u, v, out) => { const a = u * 2 * PI, r = v * (rT - 0.05); out[0] = Math.sin(a) * r; out[1] = 0.121; out[2] = Math.cos(a) * r; }, 48, 3, { closedU: true, flip: true, aux: [0.05, 0, 0, 5.16] });
  E.occFn([-rT - 3.3, -9.5, -rT - 3.3], [rT + 3.3, 0.12, rT + 3.3], (x, y, z) => Math.hypot(x, z) < (y < -5.2 ? rT + 3.1 : y < -2.5 ? rT + 1.7 : rT + 0.3));
  // stair to the water, heading 195° (toward the camera of shot 2)
  const stairHeading = 195, stairRot = L.headingToRotY(stairHeading);
  const sw = 5.2, rh = 0.3, tr = 0.42;
  const nSteps = Math.max(4, Math.round((yT - 0.55) / rh));
  mb.push(); mb.rotateY(stairRot);
  for (let i = 0; i < nSteps; i++) {
    const y1 = -i * rh - rh * 0.0, z0 = rT - 0.3 + i * tr;
    const segs = 2;
    for (let k = 0; k < segs; k++) {
      const x0 = -sw / 2 + (sw / segs) * k, x1 = x0 + sw / segs;
      A.box(mb, [x0 + 0.004, -yT - 1.8, z0], [x1 - 0.004, y1 + 0.12 - rh * 0, z0 + tr + 0.02], 0.03, [0.05, 1, 0.1, 0]);
    }
  }
  const zEnd = rT - 0.3 + nSteps * tr;
  // landing at the bottom
  A.box(mb, [-sw / 2 - 1.2, -yT - 2.0, zEnd], [sw / 2 + 1.2, -yT + 0.65, zEnd + 3.2], 0.04, [0.15, 0.9, 0.3, 3.05]);
  // cheek walls (stepped blocks)
  for (const s of [-1, 1]) {
    for (let i = 0; i < nSteps; i += 2) {
      const z0 = rT - 0.4 + i * tr, y1 = -i * rh + 0.95;
      A.box(mb, [s * (sw / 2) - (s < 0 ? 0.55 : 0), -yT - 1.8, z0], [s * (sw / 2) + (s > 0 ? 0.55 : 0), y1, z0 + 2 * tr + 0.01], 0.04, [0.1, 0.9, 0.4, 3.05]);
    }
  }
  E.occBox([-sw / 2 - 0.6, -yT - 2, rT - 0.4], [sw / 2 + 0.6, 0.9, zEnd + 3.2]);
  mb.pop();
  // brazier + urn slots at the stair top, statue slot on the landing
  const sp = (x, y, z, rotA) => { const c = Math.cos(rotA), s = Math.sin(rotA); return [x * c + z * s, y, -x * s + z * c]; };
  for (const s of [-1, 1]) {
    E.info.braziers.push({ pos: sp(s * (sw / 2 + 0.3), 0.95, rT - 0.1, stairRot), dir: sp(0, 0, 1, stairRot), size: 1.0, tag: 'island-stair', needsStand: true });
    E.info.urns.push({ pos: sp(s * (sw / 2 + 0.3), -nSteps * rh + 0.95, zEnd - 0.4, stairRot), dir: sp(0, 0, 1, stairRot), size: 0.8, tag: 'island-stair' });
  }
  // balustrade ring around the terrace (gap for the stair)
  const nSeg = 18;
  const stairA = ((180 - stairHeading) * PI) / 180 + PI; // local angle of the stair axis (rotY of +Z)
  for (let i = 0; i < nSeg; i++) {
    const a0 = (i / nSeg) * 2 * PI, a1 = ((i + 1) / nSeg) * 2 * PI;
    const am = (a0 + a1) / 2;
    // skip segments over the stair opening
    const d = Math.atan2(Math.sin(am - stairRot), Math.cos(am - stairRot));
    if (Math.abs(d) < 0.32) continue;
    // (r5) opening where the acropolis footbridge lands (acropolis r4: from (15.8, 2, 97.7) toward the centre)
    const bridgeRot = L.headingToRotY((Math.atan2(15.8 - cx, -(97.7 - cz)) * 180) / PI);
    if (Math.abs(Math.atan2(Math.sin(am - bridgeRot), Math.cos(am - bridgeRot))) < 0.2) continue;
    const r = rT - 0.25;
    const p0 = [Math.sin(a0) * r, Math.cos(a0) * r], p1 = [Math.sin(a1) * r, Math.cos(a1) * r];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const ang = Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]);
    mb.push(); mb.translate(p0[0], 0.12, p0[1]); mb.rotateY(ang);
    A.balustrade(mb, { length: len, height: 1.0, spacing: 0.3, postEvery: len, detail: det });
    mb.pop();
    if (i % 3 === 0) E.info.urns.push({ pos: [p0[0], 1.2, p0[1]], dir: [Math.sin(a0), 0, Math.cos(a0)], size: 0.6, tag: 'island-balustrade' });
  }
  void stairA;
  // pier: leaves the stair landing toward the south-west (45° to the left of the stair axis)
  const pl = 16, pw = 3.6, py = -yT + 0.75;
  const pierLocalRot = -PI / 4;                  // in the stair frame
  const px0 = -sw / 2 - 1.2, pz0 = zEnd + 1.6;  // landing edge (stair frame)
  mb.push(); mb.rotateY(stairRot); mb.translate(px0 + 0.8, 0, pz0); mb.rotateY(pierLocalRot);
  // deck slabs (individual blocks), core and pier piles
  for (let i = 0; i < Math.round(pl / 2.0); i++) {
    const z0 = i * 2.0;
    A.box(mb, [-pw / 2, py - 0.45, z0 + 0.01], [pw / 2, py + (hash01(i) - 0.5) * 0.02, z0 + 1.99], 0.04, [0.1, 0.9, 0.2, 0]);
  }
  A.box(mb, [-pw / 2 + 0.35, py - 3.8, 0], [pw / 2 - 0.35, py - 0.45, pl], 0.05, [0.3, 0.3, 0.6, 3.05]);
  for (let i = 0; i <= 4; i++) A.box(mb, [-pw / 2 - 0.15, py - 3.8, i * (pl / 4) - 0.55 + (i === 0 ? 0.55 : 0) - (i === 4 ? 0.55 : 0)], [pw / 2 + 0.15, py - 0.45, i * (pl / 4) + 0.55 + (i === 0 ? 0.55 : 0) - (i === 4 ? 0.55 : 0)], 0.05, [0.3, 0.4, 0.6, 3.05]);
  // bollards
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { mb.push(); mb.translate(s * (pw / 2 - 0.35), py, 2 + i * 4); A.lathe(mb, [[0.18, 0, 0.2, 0], [0.16, 0.45, 0, 0.3], [0.2, 0.5, 0, 0.5], [0.0001, 0.56, 0, 0]], 12, {}); mb.pop(); }
  mb.pop();
  const pierA = stairRot + pierLocalRot;
  const toW = (x, z) => { const c1 = Math.cos(stairRot), s1 = Math.sin(stairRot); const X = px0 + 0.8 + x * Math.cos(pierLocalRot) + z * Math.sin(pierLocalRot), Z = pz0 - x * Math.sin(pierLocalRot) + z * Math.cos(pierLocalRot); return [X * c1 + Z * s1, py, -X * s1 + Z * c1]; };
  E.info.anchors.pier = { start: toW(0, 0), end: toW(0, pl), heading: (195 + 45) % 360, width: pw, deck: py, rotY: pierA };
  const g = E.finalize({ position: [cx, yT, cz], rotY: 0, ...aoQ(engine) });
  engine.add(g);
  E.publishSlots(engine);
  // craggy boulders around the terrace wall and down to the water line: breaks the smooth island
  // silhouette into rocks (ref 2: rocky island under an ashlar terrace). Skips the stair and the pier.
  {
    const R = new A.Building('island-rocks', { detail: det, seed: 27, variant: 'ruined', tint: 0xcfc6b6 });
    const rng = (k) => hash01(2700 + k * 7);
    const skip = [L.headingToRotY(195), L.headingToRotY(240)];
    let n = 0;
    for (let k = 0; k < 44; k++) {
      const a = (k / 44) * 2 * PI + (rng(k) - 0.5) * 0.12;
      if (skip.some((s) => Math.abs(Math.atan2(Math.sin(a - s), Math.cos(a - s))) < 0.3)) continue;
      const rr = rT + 0.8 + rng(k + 50) * 5.5;
      const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
      const gy = heightAt(cx + x, cz + z);
      if (gy < -1.5 || gy > yT - 1.6) continue; // only on the flanks below the terrace (never above the balustrade)
      const sz = 1.4 + 2.6 * rng(k + 100) * (1 - 0.35 * (rr - rT) / 6.3);
      const top = Math.min(gy + sz * 0.5, yT - 0.9);
      R.marble.push(); R.marble.translate(x, top - sz * 0.85 - yT, z); R.marble.rotateY(rng(k + 150) * 6.28); R.marble.rotateZ((rng(k + 200) - 0.5) * 0.5);
      A.roughBlock(R.marble, { size: [sz * (1.1 + 0.6 * rng(k + 9)), sz * (0.75 + 0.5 * rng(k + 11)), sz], seed: 2700 + k, chip: 0.6, detail: 0.6 });
      R.marble.pop(); n++;
    }
    if (n) engine.add(R.finalize({ position: [cx, yT, cz], rotY: 0, ao: false }));
  }
  // statue slot for the tholos interior is published by the tholos building; pier for boats:
  const pier = E.info.anchors.pier;
  const W = (p) => [p[0] + cx, p[1] + yT, p[2] + cz];
  return { tholos: B, terrace: E, pier: { start: W(pier.start), end: W(pier.end), heading: pier.heading, width: pw, deckY: pier.deck + yT } };
}

// ============================================================================ build
export async function build(engine) {
  const t0 = performance.now();
  const det = engine.quality?.detail ?? 1;
  const reg = { pediments: [], metopes: [], buildings: [] };
  const record = (name, B, extra = {}) => {
    if (!B.world) return;
    reg.pediments.push(...B.world.pediments);
    reg.metopes.push(...B.world.metopes);
    reg.buildings.push({ name, position: B.group.position.toArray(), rotY: B.group.rotation.y, triangles: B.triangles, anchors: B.info.anchors, ...extra });
  };
  const log = [];
  const timed = (name, fn) => { const t = performance.now(); try { const r = fn(); log.push(`${name} ${Math.round(performance.now() - t)}ms`); return r; } catch (e) { console.error(`[temple] ${name} failed:`, e.stack || e); return null; } };

  // ---- main Athenaion
  timed('athenaion', () => {
    const T = L.TEMPLE;
    const rotY = L.headingToRotY(270) + (T.rotY || 0); // front faces west
    const st = siteStats(T.center[0], T.center[2], T.stylobate[1] / 2 + 2, T.stylobate[0] / 2 + 2, rotY);
    const base = Math.max(T.center[1], st.p90);
    const crep = 1.5;
    const { B } = buildAthenaion(engine, [T.center[0], base + crep, T.center[2]], rotY, { foundation: Math.max(4, base - st.min + 2.5) });
    record('athenaion', B, { stylobateY: base + crep });
    reg.main = { position: [T.center[0], base + crep, T.center[2]], rotY, stylobateTop: base + crep, ...B.info.anchors, banners: B.world.banners };
  });

  // ---- hill temple on the mount north of the acropolis (front toward the south-west viewpoints)
  timed('hill', () => {
    const H = L.HILL_TEMPLE;
    // (director) front toward the viewpoints (layout HILL_TEMPLE.facing), set back from the waterfall notch
    const hf = H.facing ?? 195, ha = (hf * PI) / 180;
    const cx = H.center[0] - Math.sin(ha) * 8, cz = H.center[1] + Math.cos(ha) * 8;
    const rotY = L.headingToRotY(hf);
    const st = siteStats(cx, cz, 11, 22, rotY);
    const B = A.peripteralTemple({ name: 'hill-temple', order: 'doric', front: 6, side: 13, W: 19, L: 42, colH: 8.6, steps: 3, stepH: 0.42, tread: 0.6, pitch: 15, plaques: false, gild: 0.6, acroteria: 'palmette', corners: 'palmette', detail: Math.min(0.4, det * 0.4), columnDetail: 0.6, seed: 31, foundation: Math.max(4, st.p90 - st.min + 3), porch: 4, banners: false, darkCella: true, interiorDark: 0.6, arcade: { faces: ['front', 'left', 'right'], bottom: st.min - 0.8 - (st.p90 + 3 * 0.42) } });
    place(engine, B, [cx, st.p90 + 3 * 0.42, cz], rotY, { ...aoQ(engine, false, true), tag: 'hill-temple' });
    record('hill-temple', B);
  });

  // ---- island tholos
  timed('island', () => {
    const I = L.ISLAND;
    const st = siteStats(I.center[0], I.center[1], 8, 8);
    const ens = islandEnsemble(engine, [I.center[0], st.p90, I.center[1]], 0, det);
    record('island-tholos', ens.tholos);
    reg.island = { center: [I.center[0], st.p90, I.center[1]], pier: ens.pier, tholosTop: ens.tholos.info.anchors.yTop };
  });

  // ---- gate towers flanking the foot of the grand stair (refs 2, 7: square towers with braziers on top)
  timed('stair-gate', () => {
    const G = L.GRAND_STAIR;
    const yQ = G.yBottom ?? 2, zQ = (G.zBottom ?? 104) - 7.5;     // on the stair-foot quay (acropolis: quay z ≈ 93-102, y 2)
    const off = (G.width ?? 16) / 2 + 3.6;
    reg.stairGate = [];
    for (const s of [-1, 1]) {
      const B = A.gateTower({ name: `stair-gate-${s < 0 ? 'w' : 'e'}`, w: 5.8, d: 5.8, h: 10.5, foundation: 4.5, archW: 2.6, gild: 0.6, detail: Math.min(0.75, det), seed: 61 + s });
      const pos = [G.x + s * off, yQ, zQ];
      // footprints are not registered: the towers stand on the acropolis quay, which must still be built
      engine.add(B.finalize({ position: pos, rotY: L.headingToRotY(180), ...aoQ(engine) }));
      B.publishSlots(engine);
      record(B.name, B);
      reg.stairGate.push({ name: B.name, position: pos, top: yQ + B.info.anchors.yTerrace });
    }
  });

  // ---- small amphiprostyle temple on a masonry quay at the water's edge in front of the stair arcade (ref 7)
  timed('water-temple', () => {
    const at = [54, 82], heading = 168, rotY = L.headingToRotY(heading);
    const yQ = 2.2; // quay top above the lagoon
    const B = A.prostyleTemple({ name: 'water-temple', order: 'ionic', porch: 4, colH: 5.6, amphi: true, pitch: 15, gild: 0.7, frieze: 'plaques', steps: 3, stepH: 0.3, tread: 0.4, detail: Math.min(0.7, det), columnDetail: 0.7, seed: 71, acroteria: 'palmette', corners: 'palmette', foundation: yQ + 2.5, banners: true });
    // quay podium (ashlar) with a water stair on the front
    const a = B.info.anchors, fp = B.info.footprint;
    const qw = fp.hw + 0.9, qd = fp.hd + 0.9, mb = B.marble;
    const crep = a.crepH ?? 0.9;
    A.box(mb, [-qw, -crep - yQ - 2.5, -qd], [qw, -crep - 0.25, qd], 0.04, [0.1, 0.3, 0.8, 3.055]);
    A.box(mb, [-qw - 0.15, -crep - 0.25, -qd - 0.15], [qw + 0.15, -crep, qd + 0.15], 0.03, [0.1, 0.8, 0.3, 0]);
    const nS = Math.round((yQ - 0.3) / 0.28);
    for (let i = 0; i < nS; i++) A.box(mb, [-2.2, -crep - yQ - 2.5, qd + i * 0.4], [2.2, -crep - 0.28 * (i + 1), qd + (i + 1) * 0.4], 0.02, [0.05, 1, 0.1, 0]);
    B.occBox([-qw, -crep - yQ - 2.5, -qd], [qw, -crep, qd]);
    place(engine, B, [at[0], yQ + crep, at[1]], rotY, { ...aoQ(engine), tag: 'water-temple' });
    // wet, mossy boulders heaped against the quay foot (ref 7: the temple stands on rocks at the water line)
    const R = new A.Building('water-temple-rocks', { detail: det, seed: 73, variant: 'mossy', tint: 0xa79f92 });
    const rng = (k) => hash01(7100 + k * 13);
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * 2 * PI + rng(k) * 0.3;
      const ex = Math.sin(ang), ez = Math.cos(ang);
      const kk = Math.min(qw / Math.max(1e-3, Math.abs(ex)), qd / Math.max(1e-3, Math.abs(ez)));
      const bx = ex * (kk + 0.3), bz = ez * (kk + 0.3);
      if (bz > qd - 0.5 && Math.abs(bx) < 3.0) continue; // keep the water stair free
      const sz = 1.3 + 1.7 * rng(k + 60);
      R.marble.push(); R.marble.translate(bx, -0.9 - 0.4 * rng(k + 7), bz); R.marble.rotateY(rng(k + 90) * 6.28);
      A.roughBlock(R.marble, { size: [sz * 1.5, sz * (0.7 + 0.5 * rng(k + 3)), sz], seed: 700 + k, chip: 0.6, detail: 0.6 });
      R.marble.pop();
    }
    engine.add(R.finalize({ position: [at[0], 0, at[1]], rotY, ao: false }));
    record('water-temple', B);
    reg.waterTemple = { position: [at[0], yQ + crep, at[1]], heading };
  });

  // ---- secondary buildings (terraces + hilltops)
  const secondary = [
    // temple above the waterfall on the old crag (north-west), facing south-east
    { name: 'crag-temple', at: [-662, -748], heading: 165, make: (d) => A.peripteralTemple({ name: 'crag-temple', order: 'doric', front: 6, side: 11, W: 16, L: 30, colH: 7.4, steps: 3, stepH: 0.4, tread: 0.5, pitch: 15, plaques: false, gild: 0.5, detail: Math.min(0.4, d * 0.4), columnDetail: 0.55, seed: 41, acroteria: 'palmette', corners: 'palmette', porch: 2, banners: false, darkCella: true, interiorDark: 0.6, foundation: 5 }), hw: 9, hd: 16 },
    // hilltop temples (north-west)
    { name: 'hilltop-north', at: [-760, -1060], heading: 165, make: (d) => A.peripteralTemple({ name: 'hilltop-north', order: 'doric', front: 6, side: 11, W: 15.2, L: 28.5, colH: 7.0, steps: 3, stepH: 0.4, tread: 0.5, pitch: 15, plaques: false, gild: 0.4, detail: Math.min(0.35, d * 0.35), columnDetail: 0.5, seed: 47, acroteria: 'palmette', corners: 'palmette', porch: 2, banners: false, darkCella: true, interiorDark: 0.6, foundation: 5 }), hw: 8.5, hd: 15 },
    // hill-temple mount (top y≈118, flat ≈ 70 × 80 m): a small Ionic temple and a monopteros beside the big
    // temple so the hilltop reads as a sanctuary cluster (refs 1, 3, 9)
    { name: 'hill-ionic', at: [L.HILL_TEMPLE.center[0] - 28, L.HILL_TEMPLE.center[1] + 22], heading: 150, make: (d) => A.prostyleTemple({ name: 'hill-ionic', order: 'ionic', porch: 4, colH: 6.0, amphi: true, pitch: 15, gild: 0.5, frieze: 'plaques', steps: 3, detail: Math.min(0.35, d * 0.35), columnDetail: 0.5, seed: 51, acroteria: 'palmette', corners: 'palmette', foundation: 5, interiorDark: 0.6 }), hw: 6, hd: 10 },
    { name: 'hill-tholos', at: [L.HILL_TEMPLE.center[0] - 37, L.HILL_TEMPLE.center[1] + 3], heading: 130, r: 7, make: (d) => A.tholos({ name: 'hill-tholos', radius: 5.2, columns: 10, colH: 6.2, steps: 3, stepH: 0.3, tread: 0.4, detail: Math.min(0.35, d * 0.35), columnDetail: 0.5, seed: 53, gild: 1, foundation: 4 }) },
    { name: 'hilltop-city', at: [-585, 140], heading: 80, /* (director) moved for shot 1 */ make: (d) => A.peripteralTemple({ name: 'hilltop-city', order: 'ionic', front: 6, side: 11, W: 10, L: 18.5, colH: 6.4, steps: 3, stepH: 0.36, tread: 0.45, pitch: 15, plaques: false, gild: 0.4, frieze: 'plaques', detail: Math.min(0.35, d * 0.35), columnDetail: 0.5, seed: 49, acroteria: 'palmette', corners: 'palmette', porch: 2, banners: false, darkCella: true, interiorDark: 0.6, foundation: 5 }), hw: 6, hd: 11 },
    // (r5) hill sanctuary terraces: buildings on arcaded podiums stepping down the camera-facing flanks of the
    // temple mount (refs 9, 3, 1: the hill is crowded with colonnades, temples and arched terrace walls).
    // Sites were searched on the heightfield (podium = uphill edge level, drop ≤ 12 m, clear of the
    // hill-big waterfall line from (-389,-257) at heading 128).
    { name: 'hill-stoa', at: [-449, -229], heading: 170, podium: true, crep: 0.68, hw: 16, hd: 6, make: (d, x) => A.stoa({ name: 'hill-stoa', length: 30, depth: 10, colH: 6.2, inner: 'ionic', gild: 0.4, detail: Math.min(0.4, d * 0.4), seed: 81, banners: false, interiorDark: 0.62, ...x }) },
    { name: 'hill-shrine-w', at: [-474, -229], heading: 160, podium: true, hw: 6, hd: 10, make: (d, x) => A.prostyleTemple({ name: 'hill-shrine-w', order: 'ionic', porch: 6, W: 10.5, L: 17, colH: 6.4, amphi: true, pitch: 15, gild: 0.5, frieze: 'rosettes', steps: 3, detail: Math.min(0.35, d * 0.35), columnDetail: 0.5, seed: 83, acroteria: 'palmette', corners: 'palmette', flankStatues: false, interiorDark: 0.62, ...x }) },
    { name: 'hill-temple-s', at: [-419, -214], heading: 150, podium: true, hw: 6, hd: 10, make: (d, x) => A.peripteralTemple({ name: 'hill-temple-s', order: 'doric', front: 4, side: 7, W: 9.4, L: 17, colH: 6.4, steps: 3, stepH: 0.36, tread: 0.45, pitch: 15, plaques: false, gild: 0.5, acroteria: 'palmette', corners: 'palmette', detail: Math.min(0.35, d * 0.35), columnDetail: 0.5, seed: 85, banners: false, darkCella: true, interiorDark: 0.62, ...x }) },
    { name: 'hill-temple-sw', at: [-469, -194], heading: 120, podium: true, hw: 6, hd: 10, make: (d, x) => A.prostyleTemple({ name: 'hill-temple-sw', order: 'ionic', porch: 6, W: 10.5, L: 17, colH: 6.6, amphi: true, pitch: 15, gild: 0.5, frieze: 'plaques', steps: 3, detail: Math.min(0.35, d * 0.35), columnDetail: 0.5, seed: 87, acroteria: 'palmette', corners: 'palmette', flankStatues: false, interiorDark: 0.62, ...x }) },
    { name: 'hill-temple-e', at: [-349, -254], heading: 120, podium: true, hw: 6, hd: 10, make: (d, x) => A.peripteralTemple({ name: 'hill-temple-e', order: 'doric', front: 4, side: 7, W: 9.4, L: 17, colH: 6.4, steps: 3, stepH: 0.36, tread: 0.45, pitch: 15, plaques: false, gild: 0.5, acroteria: 'palmette', corners: 'palmette', detail: Math.min(0.35, d * 0.35), columnDetail: 0.5, seed: 89, banners: false, darkCella: true, interiorDark: 0.62, ...x }) },
    { name: 'hill-rim-e', at: [-384, -294], heading: 100, podium: true, hw: 6, hd: 10, make: (d, x) => A.prostyleTemple({ name: 'hill-rim-e', order: 'ionic', porch: 6, W: 10.5, L: 17, colH: 6.2, amphi: true, pitch: 15, gild: 0.5, frieze: 'rosettes', steps: 3, detail: Math.min(0.35, d * 0.35), columnDetail: 0.5, seed: 91, acroteria: 'palmette', corners: 'palmette', flankStatues: false, interiorDark: 0.62, ...x }) },
  ];
  reg.secondary = [];
  for (const S of secondary) {
    timed(S.name, () => {
      const rotY = L.headingToRotY(S.heading);
      const st = S.r ? siteStats(S.at[0], S.at[1], S.r, S.r) : siteStats(S.at[0], S.at[1], S.hw, S.hd, rotY);
      if (st.max - st.min > (S.podium ? 18 : 9)) { console.warn(`[temple] ${S.name}: site too uneven (${(st.max - st.min).toFixed(1)} m), skipped`); return; }
      if (engine.footprints && !engine.footprints.isFree(S.at[0], S.at[1], S.r ? S.r * 0.5 : Math.min(S.hw, S.hd) * 0.5)) { console.warn(`[temple] ${S.name}: footprint occupied, skipped`); return; }
      // podium sites: stylobate at the uphill edge, arcaded terrace walls down to the lowest ground
      let base = st.p90, extra = {};
      if (S.podium) {
        base = st.max;
        extra = { foundation: base - st.min + 2.5, arcade: { bottom: st.min - 0.8 - (base + (S.crep ?? 1.08)), faces: S.faces } };
      }
      const B = S.make(det, extra);
      const crep = B.info.anchors.crepH ?? S.crep ?? (B.info.anchors.steps ? B.info.anchors.steps * B.info.anchors.stepH : 1);
      place(engine, B, [S.at[0], base + crep, S.at[1]], rotY, { ...aoQ(engine, false, true), tag: S.name });
      record(S.name, B);
      reg.secondary.push({ name: S.name, position: [S.at[0], base + crep, S.at[1]], heading: S.heading });
    });
  }

  // ---- (r5) summit terrace wall of the temple mount: an arcaded ashlar substructure ringing the plateau rim on
  // the camera-facing side, with buttress piers at every bend (refs 9, 3: the summit reads as a built terrace)
  timed('hill-peribolos', () => {
    const H = L.HILL_TEMPLE, top = H.top, [hx, hz] = H.center;
    const E = new A.Building('hill-peribolos', { detail: Math.min(0.5, det * 0.5), seed: 95, interiorDark: 0.6 });
    const mb = E.marble;
    const dirOf = (hdg) => { const a = (hdg * PI) / 180; return [Math.sin(a), -Math.cos(a)]; };
    const edge = (hdg) => { const [dx, dz] = dirOf(hdg); for (let r = 6; r < 75; r += 0.75) if (heightAt(hx + dx * r, hz + dz * r) < top - 1.2) return r; return null; };
    const notch = H.notch ?? 128, step = 8;
    const pts = [];
    for (let h = 36; h <= 252; h += step) { const r = edge(h); const [dx, dz] = dirOf(h); pts.push(r ? { h, r, x: dx * (r - 1.0), z: dz * (r - 1.0) } : null); }
    let n = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      if (!p0 || !p1 || Math.abs(p0.r - p1.r) > 9) continue;
      const hm = (p0.h + p1.h) / 2;
      if (Math.abs(hm - notch) < 24 && Math.max(p0.r, p1.r) > 30) continue;  // keep the waterfall lip free (the inner notch basin gets a wall)
      const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
      if (engine.footprints && !engine.footprints.isFree(hx + mx, hz + mz, 3.5)) continue;
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) + 0.4;
      // outward normal (away from the centre)
      let nx = -(p1.z - p0.z), nz = p1.x - p0.x; const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      const g = Math.min(heightAt(hx + p0.x + nx * 4, hz + p0.z + nz * 4), heightAt(hx + p1.x + nx * 4, hz + p1.z + nz * 4), heightAt(hx + mx + nx * 4, hz + mz + nz * 4));
      const bottom = Math.max(top - 26, g - 1.5), y1 = top + 0.15;
      const th = Math.atan2(nx, nz);
      E.marble.push(); E.mb.interior.push();
      for (const m of [E.marble, E.mb.interior]) { m.translate(mx, 0, mz); m.rotateY(th); }
      if (y1 - bottom > 5.5) {
        const ya = Math.max(bottom, y1 - 8.5);   // arcade storey on top, battered plain substructure below
        A.box(mb, [-len / 2, ya, -3.6], [len / 2, y1, -2.15], 0, [0.3, 0, 0.2, 3.062]);   // core behind the arcade
        A.arcadeFacade(E, { x0: -len / 2, x1: len / 2, y0: ya, y1, z: 0, depth: 2.2, bay: len, open: 0.56, detail: 0.5 });
        if (ya > bottom + 0.3) {
          A.box(mb, [-len / 2, bottom, -3.6], [len / 2, ya, 0.35], 0.03, [0.1, 0.2, 0.8, 3.062]);
          A.box(mb, [-len / 2 - 0.05, ya - 0.35, 0.2], [len / 2 + 0.05, ya, 0.5], 0.02, [0.1, 0.7, 0.5, 0]);  // string course
        }
      } else A.box(mb, [-len / 2, bottom, -1.6], [len / 2, y1, 0], 0.03, [0.1, 0.2, 0.7, 3.062]);
      // parapet with coping
      A.box(mb, [-len / 2, y1, -0.75], [len / 2, y1 + 0.95, -0.05], 0.02, [0.1, 0.3, 0.5, 3.048]);
      A.box(mb, [-len / 2 - 0.05, y1 + 0.95, -0.85], [len / 2 + 0.05, y1 + 1.15, 0.05], 0.02, [0.05, 0.8, 0.4, 0]);
      E.marble.pop(); E.mb.interior.pop();
      // buttress pier at the segment start (vertical rhythm, hides the bend)
      E.marble.push(); E.marble.translate(p0.x, 0, p0.z); E.marble.rotateY(th);
      A.box(mb, [-0.9, bottom, -1.8], [0.9, y1 + 1.6, 0.45], 0.03, [0.1, 0.4, 0.6, 3.062]);
      A.box(mb, [-1.05, y1 + 1.6, -1.95], [1.05, y1 + 1.85, 0.6], 0.02, [0.05, 0.8, 0.4, 0]);
      E.marble.pop();
      if (n % 3 === 1) E.info.statues.push({ pos: [p0.x, y1 + 1.85, p0.z], dir: [nx, 0, nz], size: 2.3, tag: 'hill-peribolos' });
      engine.footprints?.addRect?.(hx + mx, hz + mz, len / 2, 2.5, L.headingToRotY((Math.atan2(nx, -nz) * 180) / PI), 'hill-peribolos');
      n++;
    }
    if (n) { engine.add(E.finalize({ position: [hx, 0, hz], rotY: 0, ao: false })); E.publishSlots(engine); record('hill-peribolos', E); }
  });

  engine.registry.temple = reg;
  let tris = 0; for (const b of reg.buildings) tris += b.triangles || 0;
  console.log(`[temple] built ${reg.buildings.length} buildings, ${(tris / 1e6).toFixed(2)}M tris, ${reg.pediments.length} pediments, ${reg.metopes.length} metopes in ${Math.round(performance.now() - t0)} ms (${log.join(', ')})`);
}

// ============================================================================ test scene
export async function test(engine) {
  const det = engine.quality?.detail ?? 1;
  const view = Number(engine.params?.get?.('view') || 0);
  if (engine.params?.get?.('aodebug')) A.MARBLE_DEBUG.value = Number(engine.params.get('aodebug'));
  if (engine.params?.get?.('bounce')) A.BOUNCE.value.multiplyScalar(Number(engine.params.get('bounce')));
  const reg = { pediments: [], metopes: [] };
  // everything sits on a plateau at y = 96 like the real acropolis (atmosphere / mist match the world)
  const Y0 = 96;
  const plateau = new THREE.Mesh(new THREE.BoxGeometry(900, Y0, 900).translate(0, Y0 / 2 - 0.02, 0),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0.40, 0.37, 0.31), roughness: 0.95 }));
  plateau.name = 'test-plateau';
  engine.add(plateau, { castShadow: false, receiveShadow: true });
  // main temple at the origin, front facing −X (like the world), stylobate 1.5 m above the plateau
  const PH = 9; // podium (terrace wall) height under the main temple, as on the acropolis (ref 5)
  if (view <= 2 || view === 7) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(84, PH, 46).translate(0, Y0 + PH / 2, 0), A.marbleMaterial({ variant: 'weathered', overrides: { lichen: 1, streaks: 1 } }));
    engine.add(pod);
    const { B } = buildAthenaion(engine, [0, Y0 + PH + 1.5, 0], -PI / 2, { detail: det, foundation: 2 });
    reg.pediments.push(...B.world.pediments); reg.metopes.push(...B.world.metopes);
  }
  if (view === 3 || view === 4 || view === 5 || view === 8) {
    // orders line-up + ruins + small buildings
    const mat = A.marbleMaterial({ variant: 'weathered' });
    const ruin = A.marbleMaterial({ variant: 'ruined' });
    const orders = ['doric', 'ionic', 'corinthian'];
    orders.forEach((order, i) => {
      const { geometry } = A.columnGeometry({ order, height: 7, detail: det, decorated: true });
      const m = new THREE.Mesh(geometry, mat); m.position.set(i * 4 - 4, Y0, 0); engine.add(m);
    });
    const bc = new THREE.Mesh(A.brokenColumnGeometry({ order: 'corinthian', height: 8, breakAt: 0.55, seed: 3 }), ruin); bc.position.set(8, Y0, 0); engine.add(bc);
    const cap = new THREE.Mesh(A.capitalGeometry({ order: 'corinthian', diameter: 0.8, detail: det }), ruin); cap.rotation.set(0.25, 0.4, 1.35); cap.position.set(8, Y0 + 0.55, 3); engine.add(cap);
    const drum = new THREE.Mesh(A.drumGeometry({ order: 'corinthian', diameter: 0.8, height: 0.7, rosette: true, seed: 5 }), ruin); drum.rotation.set(0, 0.3, PI / 2); drum.position.set(5, Y0 + 0.4, 3.5); engine.add(drum);
    const blk = new THREE.Mesh(A.roughBlockGeometry({ size: [1.6, 0.7, 0.9], broken: { px: 0.3 }, seed: 9 }), ruin); blk.position.set(2, Y0, 4); blk.rotation.y = 0.4; engine.add(blk);
    const frag = new THREE.Mesh(A.entablatureFragmentGeometry({ D: 0.9, length: 2.8, seed: 3 }), ruin); frag.position.set(-1, Y0, 5); frag.rotation.y = -0.2; engine.add(frag);
    const ped = new THREE.Mesh(A.pedestalGeometry({ w: 1.4, h: 1.8, wreath: true }), mat); ped.position.set(-8, Y0, 2); engine.add(ped);
    const bal = new THREE.Mesh(A.balustradeGeometry({ length: 6 }), mat); bal.position.set(-14, Y0, 4); engine.add(bal);
    const th = A.tholos({ name: 'tholos-test', detail: det * 0.8 });
    engine.add(th.finalize({ position: [-30, Y0 + 1.5, -25], rotY: 0.3 }));
    const pr = A.prostyleTemple({ name: 'prostyle-test', order: 'ionic', porch: 4, amphi: true, gild: 0.7, frieze: 'plaques', detail: det, roofTint: 0xb98a6c });
    engine.add(pr.finalize({ position: [25, Y0 + 1.08, -30], rotY: -0.5 }));
  }
  if (view === 9) {
    // ref 2 framing: island tholos on a 9 m rock, camera near the water
    const rock = new THREE.Mesh(new THREE.CylinderGeometry(13, 16, 9, 40).translate(0, Y0 + 4.5, 0), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.36, 0.33, 0.28), roughness: 0.95 }));
    engine.add(rock);
    const th = A.tholos({ name: 'island-tholos-test', radius: 8.2, columns: 14, colH: 8.2, steps: 6, stepH: 0.27, tread: 0.42, detail: Math.max(0.45, det * 0.8), seed: 21, gild: 1, foundation: 2 });
    engine.add(th.finalize({ position: [0, Y0 + 9 + 1.62, 0], rotY: 0 }));
  }
  if (view === 6) {
    const st = A.stoa({ length: 30, depth: 9, detail: det, gild: 0.4, plaques: true, roofTint: 0xc0906e });
    engine.add(st.finalize({ position: [0, Y0 + 0.68, 0], rotY: 0 }));
  }
  engine.registry.temple = reg;
  const V = (pos, target, fov, sun) => ({ pos: [pos[0], pos[1] + Y0, pos[2]], target: [target[0], target[1] + Y0, target[2]], fov, sun });
  const S5 = { azimuth: 292, elevation: 24 };
  const views = [
    V([-69.4, 3, 24], [-32, 19.5, 6], 50, S5),           // 0: like ref 5 — looking up at the west facade from below the podium
    V([-46, PH + 4, 22], [-20, PH + 12.5, 6], 38, S5),   // 1: closer: columns, plaques, mutules, acroteria
    V([-95, PH + 42, 75], [0, PH + 8, 0], 38, S5),       // 2: elevated 3/4 view (roof, pediment, flank)
    V([0, 4.5, 14], [0, 4.2, 0], 50, { azimuth: 220, elevation: 28 }),   // 3: orders line-up
    V([2.5, 6.8, 4.2], [1.0, 6.6, 0], 45, { azimuth: 220, elevation: 28 }), // 4: capitals close-up
    V([-8, 10, 30], [-10, 5, -25], 55, { azimuth: 220, elevation: 24 }),  // 5: tholos + prostyle temple
    V([-22, 6, 30], [0, 4, 0], 50, { azimuth: 220, elevation: 24 }),      // 6: stoa
    V([-30, PH + 2.6, 14], [-18, PH + 8.5, 2], 60, S5),  // 7: under the peristyle / pronaos (banner zone)
    V([5.2, 6.0, 2.3], [4.0, 6.55, 0], 50, { azimuth: 75, elevation: 32 }), // 8: Corinthian capital close-up (ref 9)
    V([-12, 3.2, 62], [0, 16, 0], 30, { azimuth: 238, elevation: 21 }), // 9: island tholos like ref 2
  ];
  return { views };
}
