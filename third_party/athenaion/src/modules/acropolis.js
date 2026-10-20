// ACROPOLIS dressing: retaining walls (plateau rim + terraces), the grand staircase, plazas with
// mosaics, shrines/temples on the terraces, lamp posts, planters, quay — all procedural.
// Everything is derived from the real terrain (heightAt + contour analysis) so it sits on the ground.
//
// Publishes:
//   engine.slots.{statue, brazier, banner, ivy, urn, planter, lamp}  (see src/acropolis/* for sizes)
//   engine.registry.acropolis = { stair: plan, levels, wallRuns }
//   engine.registry.cypressRows = [{ points: [[x,z],...], spacing }]
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { analyseSite, contours } from '../acropolis/site.js';
import { ChunkedBuilders } from '../acropolis/geo.js';
import { loadAcroMaterials } from '../acropolis/materials.js';
import { Zones, planWallLine, buildWallPlan, chainCrossing } from '../acropolis/walls.js';
import { Balustrades } from '../acropolis/balustrade.js';
import { STATS as MSTATS, blockColor, STONE_COL } from '../acropolis/masonry.js';
import { buildBastion, buildForecourt, rosetteMeshes, addRosette } from '../acropolis/plaza.js';
import { buildTerraceBuildings, buildPropylon, cypressRows, buildPrecinctBuildings } from '../acropolis/buildings.js';
import { pavedWay, exedra, fountain, fountainWaterMaterial } from '../acropolis/props.js';
import { lampPost, garland } from '../acropolis/ornament.js';
import { frameFacing, chamferBox, frameXZ } from '../acropolis/geo.js';
import { scanLedges, planStair, buildStair, stairSurface } from '../acropolis/stair.js';
import { buildPodium, pavePrecinct, dressPrecinct, podiumPlan } from '../acropolis/podium.js';
import { planArcade, buildArcade } from '../acropolis/arcade.js';
import { dressSheerFaces } from '../acropolis/cliffdress.js';
import { buildColossusBastion } from '../acropolis/bastion.js';
import { buildEastGarden } from '../acropolis/garden.js';
import { islandBridge } from '../acropolis/bridge.js';
import { weedTufts } from '../acropolis/weeds.js';
import { buildTerraceHouses, voidMaterial } from '../acropolis/houses.js';
import { Simplex } from '../core/noise.js';

const NZ = new Simplex(4711);
const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const nearFall = (x, z, r) => L.WATERFALLS.some((w) => Math.hypot(w.from[0] - x, w.from[2] - z) < w.width * 0.5 + r);
/** run a build phase; a failure is logged and the rest of the acropolis still builds */
function safe(label, fn, fallback = null) {
  try { return fn(); } catch (e) { console.warn(`[acropolis] ${label} failed:`, e && (e.stack || e.message || e)); return fallback; }
}
async function safeA(label, fn, fallback = null) {
  try { return await fn(); } catch (e) { console.warn(`[acropolis] ${label} failed:`, e && (e.stack || e.message || e)); return fallback; }
}

export async function build(engine) {
  const t0 = performance.now();
  const q = engine.quality;
  const M = await loadAcroMaterials();
  M.void = voidMaterial(); // (r5) unlit-looking interiors of windows / doors / loggias
  const site = analyseSite();
  const GS = L.GRAND_STAIR;
  const ctx = {
    S: new ChunkedBuilders(48), engine, slots: engine.slots, footprints: engine.footprints,
    zones: new Zones(), rng: engine.rng('acropolis'), grid: site.grid, wallRuns: [],
  };
  ctx.balus = new Balustrades(engine, engine.rng('acro-balusters'));
  ctx.balus.material = M.marble;
  const lv = site.levels;

  // ---------------------------------------------------------------- waterfall lips: leave the rock bare
  for (const w of L.WATERFALLS) {
    if (Math.hypot(w.from[0] - L.ACROPOLIS.center[0], w.from[2] - L.ACROPOLIS.center[1]) > 320) continue;
    ctx.zones.circle(w.from[0], w.from[2], w.width * 0.5 + 4.5, 'waterfall');
  }

  // ---------------------------------------------------------------- plan walls
  const southish = (h) => h > 95 && h < 300; // faces seen from the shots get balustrades
  const plans = [];
  const rimLine = site.rim.length ? site.rim.reduce((a, b) => (b.length > a.length ? b : a), site.rim[0]) : null;
  const rimPlan = rimLine && safe('rim plan', () => planWallLine(ctx, {
    kind: 'rim', line: rimLine, topLevel: lv[0], lowLevel: lv[0] - 25, maxH: 30, rng: engine.rng('acro-rim'),
    balustrade: southish, banners: 0.55, ivy: 0.7, courses: 'pseudo', maxOff: 10, arches: true, archSkip: 0.35, niches: true,
    parapetStatues: (p) => Math.abs(p[0] - GS.x) < 90 && p[2] > -40, // (director) south rim now at z≈-10
    towers: (h, p) => h > 150 && h < 320 && Math.abs(p[0] - GS.x) > 40, towerEvery: 58,
    maxHFor: (h, m) => (h > 330 || h < 80 ? 14 : h < 120 ? 20 : m),
    // the great wall under the temple faces south; elsewhere masonry caps the natural cliff
    heightFor: (x, z, h) => {
      if (nearFall(x, z, 12)) return 6;
      if (h > 110 && h < 250 && x > -75 && x < 135 && z > -45) return Infinity; // (director) south rim at z≈-10
      const n = NZ.noise2(x / 70, z / 70);
      if (h >= 250 && h < 320) return 16 + 6 * n;
      return 10 + 4 * n;
    },
  }));
  if (rimPlan) plans.push(rimPlan);
  for (const e of site.edges) {
    const k = e.k;
    for (const line of e.top) {
      const p = safe('terrace plan', () => planWallLine(ctx, {
        kind: 'terrace', line, topLevel: lv[k], lowLevel: lv[k + 1], ledgeAbove: lv[k] + 3, minLedge: 9, maxH: 26, partialFallback: 8,
        rng: engine.rng('acro-terr-' + k), balustrade: true, banners: k === 1 ? 0.35 : 0.2, ivy: 0.9, arches: true, niches: true,
        parapetStatues: (p) => Math.abs(p[0] - GS.x) < 75,
        courses: k === 2 ? 'random' : 'pseudo', maxOff: 11,
        heightFor: (x, z) => {
          if (Math.abs(x - GS.x) < 30) return Infinity;
          if (nearFall(x, z, 10)) return 2.4;
          const n = NZ.noise2(x / 48 + k * 3.7, z / 48 - k * 1.3);
          if (n > 0.18) return Infinity;
          if (n > -0.28) return 5 + 7 * (n + 0.28) / 0.46;
          return 2.4;
        },
        bounds: (x, z) => x > (k === 3 ? -95 : -150) && x < 200 && z > -20 && z < 240,
      }));
      if (p) plans.push(p);
    }
  }

  // ---------------------------------------------------------------- lagoon quay at the foot of the massif
  const QUAY_TOP = 2.4;
  for (const line of contours(site.grid, QUAY_TOP - 0.2)) {
    if (line.length < 12) continue;
    const qp = safe('quay plan', () => planWallLine(ctx, {
      kind: 'quay', line, topLevel: QUAY_TOP, lowLevel: -2.8, fixedTop: QUAY_TOP, maxH: 9, maxOff: 9, tol: 1.5,
      rng: engine.rng('acro-quay'), parapet: false, bollards: 8.5, waterStairs: 42, waterLevel: 0, ivy: 0.2, courses: 'iso',
      // (director) lagoon gorge along the south face; (r4) not around the tholos island: the temple module's
      // island ensemble (terrace, rocks, stair, pier) is the ref-2 subject and the quay ring hid it
      bounds: (x, z) => x > -105 && x < 150 && z > 30 && z < 200 && Math.hypot(x - L.ISLAND.center[0], z - L.ISLAND.center[1]) > L.ISLAND.radius + 12,
    }));
    if (qp) plans.push(qp);
  }

  // ---------------------------------------------------------------- grand stair levels from the walls
  const levels = [];
  let rimX = rimPlan ? chainCrossing(rimPlan, GS.x) : null;
  if (rimX && Math.abs(rimX.zEdge - GS.zTop) > 25) rimX = null; // (director) only the south rim crossing near the stair top counts
  levels.push({ y: rimX ? rimX.top : lv[0] + 0.3, zEdge: rimX ? rimX.zEdge + 0.5 : GS.zTop });
  const ledges = scanLedges(GS.x, GS.zTop - 15, GS.zBottom + 10);
  for (let k = 1; k < lv.length; k++) {
    let found = null;
    for (const p of plans) {
      if (p === rimPlan || Math.abs(p.spec.topLevel - lv[k]) > 0.1) continue;
      const c = chainCrossing(p, GS.x);
      if (c && (!found || c.z > found.z)) found = c;
    }
    if (found) { levels.push({ y: found.top, zEdge: found.zEdge }); continue; }
    const led = ledges.find((l) => Math.abs(l.y - lv[k]) < 4);
    if (led) levels.push({ y: led.yEnd + 0.3, zEdge: led.z1 });
  }
  // lower natural ledges (below the last terrace wall) become extra landings
  const lastY = levels[levels.length - 1].y;
  for (const led of ledges) if (led.yEnd < lastY - 5 && led.yEnd > (GS.yBottom ?? 2) + 4) levels.push({ y: led.yEnd + 0.3, zEdge: led.z1 });
  levels.push({ y: GS.yBottom ?? 2, zEdge: GS.zBottom });
  const plan = planStair(levels);
  // landings at terrace-wall levels become projecting bastion plazas (ref 4)
  const bastions = [];
  for (const sg of plan.segs) {
    if (sg.kind !== 'landing' || sg.top || sg.mid) continue;
    let cross = null;
    for (const p of plans) {
      if (p === rimPlan) continue;
      const c = chainCrossing(p, GS.x);
      if (c && Math.abs(c.top - sg.y0) < 0.05) cross = c;
    }
    if (!cross) continue;
    const halfW = 24;
    sg.bastion = true;
    bastions.push({ sg, zBack: cross.z, halfW });
    ctx.zones.rect(GS.x, (cross.z - 4 + sg.z1 + 3) / 2, halfW + 0.6, (sg.z1 + 3 - (cross.z - 4)) / 2, 0, 'bastion');
  }
  // (r2) forecourt paving level: just above the highest plateau rock in the precinct
  let pMax = -Infinity;
  for (let x = -26; x <= 80; x += 2) for (let z = -112; z <= -10; z += 2) { if (x > -2 && x < 42 && z < -22) continue; const h = heightAt(x, z); if (h > lv[0] - 1.2 && h > pMax) pMax = h; }
  const yCourt = Math.max(levels[0].y, pMax + 0.04);
  ctx.forecourtPaved = true;
  // (r2) open arcade where the stair rides over the lagoon (shot 7)
  const zArc = bastions.reduce((m, b) => (heightAt(GS.x, b.sg.z1 + 3) < 1 ? Math.max(m, b.sg.z1 + 2.5) : m), 0) || 60;
  const arcade = safe('arcade plan', () => planArcade(plan, { zStart: zArc, pier: 1.5, pitch: 6.0, minDeck: 5.5 }));
  if (arcade) ctx.arcadeZ = [arcade.zA, arcade.zB];
  const tStair = performance.now();
  safe('grand stair', () => buildStair(ctx, plan));
  if (arcade) safe('arcade', () => {
    const r = buildArcade(ctx, plan, arcade, GS.x, engine.rng('acro-arcade'));
    engine.registry.aqueductSpills = (engine.registry.aqueductSpills || []).concat(r.spills);
    console.log(`[acropolis] arcade z ${arcade.zA.toFixed(1)}..${arcade.zB.toFixed(1)}: ${arcade.bays.length} bays (crowns ${arcade.bays.map((b) => b.crown.toFixed(1)).join('/')}), ${r.spills.length} spills`);
  });
  console.log(`[acropolis] stair: ${plan.segs.filter((s) => s.kind === 'flight').map((s) => `${s.y0.toFixed(1)}→${s.y1.toFixed(1)} z${s.z0.toFixed(0)}-${s.z1.toFixed(0)}`).join(', ')} (${Math.round(performance.now() - tStair)} ms)`);

  // (r4) arched footbridge from the stair-foot quay to the tholos island (ref 4)
  const quay = plan.segs.find((sg) => sg.kind === 'quay');
  if (quay) safe('island bridge', () => {
    const r = islandBridge(ctx, engine.rng('acro-bridge'), [GS.x - quay.w / 2 + 0.4, quay.y0, (quay.z0 + quay.z1) / 2], L.ISLAND.center, { width: 4.4, deckY: 5.4 });
    console.log('[acropolis] island bridge ' + (r ? `${r.len.toFixed(1)} m, ${r.arches} arches, deck ${r.deckY}` : 'skipped (no landing on the island)'));
  });
  // ---------------------------------------------------------------- build walls
  const tW = performance.now();
  let wallLen = 0;
  for (const p of plans) wallLen += safe('wall ' + p.spec.kind, () => buildWallPlan(ctx, p), 0);
  console.log(`[acropolis] walls ${Math.round(wallLen)} m in ${Math.round(performance.now() - tW)} ms ${JSON.stringify(MSTATS)}, towers ${ctx.nTowers || 0}, wall stairs ${ctx.nWallStairs || 0} ${JSON.stringify(ctx.wsDbg || {})}`);

  // ---------------------------------------------------------------- plazas: bastions + forecourt
  const rngP = engine.rng('acro-plaza');
  bastions.forEach((b, i) => safe('bastion', () => buildBastion(ctx, b.sg, GS.x, b.zBack, rngP, { halfW: b.halfW, style: i, corridor: plan })));
  if (ctx.spills && ctx.spills.length) { engine.registry.aqueductSpills = (engine.registry.aqueductSpills || []).concat(ctx.spills); console.log(`[acropolis] bastion spill arches: ${ctx.spills.length}`); }
  const topLand = plan.segs.find((s) => s.top);
  // (r2) temple podium + paved precinct (replaces the old forecourt patch)
  const tP = performance.now();
  const podium = safe('podium', () => buildPodium(ctx, engine, yCourt, engine.rng('acro-podium')));
  if (podium) safe('precinct', () => {
    const holes = [{ x0: podium.x0 - 0.3, x1: podium.x1 + 0.3, z0: podium.zN - 0.3, z1: podium.zS + 0.05 }, { x0: podium.cheekX0, x1: podium.cheekX1, z0: podium.zS - 0.1, z1: podium.stairFootZ - 0.05 }];
    const pv = pavePrecinct(ctx, { x0: -26, x1: 80, z0: -114, z1: -9 }, yCourt, holes, engine.rng('acro-pave'), { cell: 1.5, minH: yCourt - 1.0, footprintTag: 'acro-plaza' });
    const d = dressPrecinct(ctx, podium, yCourt, pv, engine.rng('acro-precinct'));
    console.log(`[acropolis] podium x ${podium.x0.toFixed(1)}..${podium.x1.toFixed(1)} z ${podium.zN.toFixed(1)}..${podium.zS.toFixed(1)} top ${podium.top.toFixed(2)}, ${podium.nBanners} banners, ${podium.nNiches} niches; precinct y ${yCourt.toFixed(2)}: ${Math.round(pv.area)} m² (${pv.quads} quads, ${pv.kerbs} kerbs), ${JSON.stringify(d)} (${Math.round(performance.now() - tP)} ms)`);
  });


  // (r5) precinct buildings flanking the temple: west stoa, east ionic temple (refs 3, 9, 8)
  const precB = (await safeA('precinct buildings', () => buildPrecinctBuildings(ctx, engine, yCourt))) || [];
  if (precB.length) console.log(`[acropolis] precinct buildings ${JSON.stringify(precB)}`);
  // (r5) circular compass mosaics on the open precinct (ref 4), where nothing stands
  let nMos = 0;
  for (const [mx, mz, mr] of [[64, -24, 4.6], [-14, -18, 3.6], [62, -100, 4.2]]) {
    if (!engine.footprints.isFree(mx, mz, mr + 0.5, ['acro-plaza']) || heightAt(mx, mz) > yCourt + 0.1 || heightAt(mx, mz) < yCourt - 1.5) continue;
    addRosette(ctx, mx, yCourt + 0.012, mz, mr, 2 + nMos);
    engine.footprints.addCircle(mx, mz, mr * 0.6, 'acro-mosaic');
    nMos++;
  }
  if (nMos) console.log(`[acropolis] precinct mosaics ${nMos}`);
  // (r6) ref 6: a fall pours off the temple terrace left of the stair, behind the upper piers. A stone
  // outlet channel at the forecourt edge west of the top landing feeds a spill (waterfalls module) that
  // drops onto the y≈42 ledge and runs on to its edge; seen between the cypresses in shot 6 (also 3, 4, 9)
  safe('forecourt outlet fall', () => {
    const ox = 10.4, rngQ0 = engine.rng('acro-outlet');
    let zE = null;
    for (let z = -16; z < -4; z += 0.25) if (heightAt(ox, z) < yCourt - 1.6) { zE = z - 0.6; break; }
    if (zE === null || !engine.footprints.isFree(ox, zE + 1.5, 1.2, ['acro-plaza'])) return;
    const F = frameFacing(ox, 0, zE, 180); // d → south (+z), s → west
    const Bt = ctx.S.get('ashlar', ox, zE);
    const yT = yCourt, hwC = 2.3;
    const cA = blockColor(rngQ0, STONE_COL), cB = darker(blockColor(rngQ0, STONE_COL), 0.85);
    chamferBox(Bt, F, -hwC - 0.45, hwC + 0.45, yT - 1.6, yT - 0.25, -3.2, 1.25, 0.06, cB);           // channel bed + corbel
    for (const sx of [-1, 1]) chamferBox(Bt, F, sx < 0 ? -hwC - 0.45 : hwC, sx < 0 ? -hwC : hwC + 0.45, yT - 0.25, yT + 0.55, -3.2, 1.35, 0.05, cA); // side walls
    for (let k = 0; k < 4; k++) chamferBox(Bt, F, -hwC - 0.3 + k * 0.02, hwC + 0.3 - k * 0.02, yT - 1.6 - (k + 1) * 0.28, yT - 1.6 - k * 0.28, -0.4 - k * 0.15, 1.1 - k * 0.32, 0.04, darker(cB, 0.95)); // stepped corbel under the lip
    engine.footprints.addRect(ox, zE - 1, hwC + 0.5, 2.4, 0, 'acro-outlet');
    // keep trees off the fall's path down to the y≈42 ledge and across it (it hid behind a pine and a cypress in shot 6)
    engine.footprints.addRect(ox - 0.3, zE + 9.5, 3.4, 9.0, 0, 'acro-outlet-fall'); // (not 'waterfall': vegetation ignores that tag)
    (engine.registry.aqueductSpills ||= []).push({ pos: [ox, yT - 0.2, zE + 1.3], dir: 182, width: hwC * 1.7, flow: 0.9, id: 'acro-forecourt-outlet', kind: 'outlet', structure: 'forecourt' });
    console.log(`[acropolis] forecourt outlet fall at (${ox}, ${(yT - 0.2).toFixed(1)}, ${(zE + 1.3).toFixed(1)})`);
  });

  // ---------------------------------------------------------------- buildings (architecture kit)
  const tB = performance.now();
  const wallLevels = [levels[0].y, ...lv.slice(1, 4).map((l) => {
    const c = plan.segs.find((s) => s.bastion && Math.abs(s.y0 - l) < 2.5);
    return c ? c.y0 : l - 0.6;
  })];
  engine.registry.cypressRows = engine.registry.cypressRows || [];
  // (r2) cypress rows flanking the grand stair on the ground beside the cheek walls (refs 3, 6, 9)
  for (const side of [-1, 1]) {
    let cur = [];
    const flush = () => { if (cur.length >= 2) engine.registry.cypressRows.push({ points: cur, spacing: 5.2, tag: 'acro-stair-flank' }); cur = []; };
    for (let z = -4; z < (arcade ? arcade.zA - 3 : 56); z += 5.2) {
      const sg = plan.segs.find((s) => z >= s.z0 && z <= s.z1);
      if (!sg || sg.bastion) { flush(); continue; }
      const x = GS.x + side * (sg.w / 2 + 1.4 + 2.6);
      const g = heightAt(x, z), ys = stairSurface(plan, z);
      if (g < 2.5 || ys - g > 12 || ys - g < -1.5 || ctx.zones.hit(x, z, 1.5, 'bastion') || nearFall(x, z, 5)) { flush(); continue; }
      cur.push([x, z]);
    }
    flush();
  }
  // (r2) tower bastions for colossi flagged `bastion` in layout COLOSSI (opt-in; see src/acropolis/bastion.js)
  const colossusBases = {};
  if (L.COLOSSI.some((c) => c.bastion)) { ctx.M = M; ctx.stoneLib = await safeA('stone family', () => import('../materials/stone.js')); }
  for (const c of L.COLOSSI) if (c.bastion) safe('colossus bastion ' + c.id, () => { const r = buildColossusBastion(ctx, c, engine.rng('acro-cbast-' + c.id)); colossusBases[c.id] = r.top; if (r.group) { engine.add(r.group, { castShadow: false, receiveShadow: true }); const g = r.group; (engine.registry.shot4Only ||= []).push(g); engine.onShot((s) => { g.visible = s.id === undefined || String(s.id) === '4'; }); } console.log(`[acropolis] colossus ${c.id} bastion: top ${r.top.toFixed(1)}, ${r.height.toFixed(1)} m tall, ${r.rocks} crag rocks`); });
  const built = (await safeA('terrace buildings', () => buildTerraceBuildings(ctx, wallLevels, engine))) || [];
  // (r4) east garden terraces on the wide first ledge right of the stair (refs 6, 1, 3, 4)
  const tG = performance.now();
  const garden = safe('east garden', () => buildEastGarden(ctx, engine, engine.rng('acro-garden'), { bastions, waterMat: fountainWaterMaterial() }));
  if (garden) {
    if (garden.spills.length) engine.registry.aqueductSpills = (engine.registry.aqueductSpills || []).concat(garden.spills);
    const { spills, ...gi } = garden;
    console.log(`[acropolis] east garden ${JSON.stringify(gi)}, ${spills.length} spout spills (${Math.round(performance.now() - tG)} ms)`);
  }
  // (r2) shrines, balconies and masonry caps on the sheer bay under colossus A (shots 3, 7, 9)
  const sb = L.ACROPOLIS.sheerBay || [42, 80];
  safe('sheer faces', () => { const r = dressSheerFaces(ctx, sb[0] + 2, sb[1] - 2, engine.rng('acro-cliff'), { shrines: 4, balconies: 5, caps: 8 }); console.log('[acropolis] sheer bay dressing ' + JSON.stringify(r)); });
  const propZ = topLand ? topLand.z0 - 22 : 20;
  const prop = topLand && engine.footprints.isFree(GS.x, propZ, 9) ? await safeA('propylon', () => buildPropylon(ctx, GS.x, propZ, topLand.y0, engine)) : null;
  // (r5) terrace houses: a dense town of small houses, loggias, towers and shrines on the ledges (refs 3, 9, 4, 1)
  const tH = performance.now();
  const houses = await safeA('terrace houses', () => buildTerraceHouses(ctx, engine, engine.rng('acro-houses'), { n: q.detail >= 1 ? 46 : 32 }));
  if (houses) {
    if (houses.roofs) engine.add(houses.roofs);
    const byType = {}; for (const h of houses.placed) byType[h.type + '/' + h.roof] = (byType[h.type + '/' + h.roof] || 0) + 1;
    console.log(`[acropolis] terrace houses: ${houses.count} ${JSON.stringify(byType)} (${Math.round(performance.now() - tH)} ms)`);
  }

  // ---------------------------------------------------------------- meshes (after the terrace buildings: their platforms + balustrades go into ctx.S)
  const group = new THREE.Group(); group.name = 'acropolis';
  const meshes = ctx.S.meshes(M);
  for (const m of meshes) group.add(m);
  const bal = ctx.balus.build();
  if (bal) group.add(bal);
  for (const m of rosetteMeshes(ctx)) group.add(m);
  const weeds = safe('weeds', () => weedTufts(ctx.crackSpots, engine.rng('acro-weeds')));
  if (weeds) group.add(weeds);
  engine.add(group);

  // ---------------------------------------------------------------- plateau: processional way, exedrae, fountains
  const rngQ = engine.rng('acro-props');
  const S2 = new ChunkedBuilders(48);
  const ctx2 = { ...ctx, S: S2 };
  const templeSouth = L.TEMPLE_FRONT ? L.TEMPLE_FRONT.z : L.TEMPLE.center[2] + L.TEMPLE.stylobate[1] / 2; // (director) temple front faces south
  const wayN = templeSouth + 9, wayS = propZ - (prop ? prop.hd : 8) - 0.5;
  if (wayS - wayN > 10) safe('processional way', () => {
    pavedWay(ctx2, GS.x, wayN, wayS, 5.5, rngQ);
    for (let z = wayN + 6; z < wayS - 4; z += 11) {
      for (const sx of [-1, 1]) {
        const flame = lampPost(S2, frameFacing(GS.x + sx * 6.6, 0, z, 0), heightAt(GS.x + sx * 6.6, z) + 0.05, rngQ, 3.5);
        engine.slots.lamp.push({ pos: flame, facing: 0, size: 0.35, tag: 'acro-way' });
      }
    }
    const zm = (wayN + wayS) / 2;
    for (const sx of [-1, 1]) {
      const ex = GS.x + sx * 17;
      if (engine.footprints.isFree(ex, zm, 7)) exedra(ctx2, ex, zm, sx < 0 ? 90 : 270, 5.5, rngQ);
    }
    engine.registry.cypressRows.push({ points: [[GS.x - 9, wayN + 2], [GS.x - 9, wayS - 2]], spacing: 7, tag: 'acro-way' });
    engine.registry.cypressRows.push({ points: [[GS.x + 9, wayN + 2], [GS.x + 9, wayS - 2]], spacing: 7, tag: 'acro-way' });
  });
  const wm = fountainWaterMaterial();
  for (const sx of [-1, 1]) {
    const fx = GS.x + sx * 27, fz = topLand ? topLand.z0 - 6 : 30;
    if (engine.footprints.isFree(fx, fz, 5)) safe('fountain', () => fountain(ctx2, fx, fz, 3.4, rngQ, wm));
  }
  const g2 = new THREE.Group(); g2.name = 'acropolis-props';
  for (const m of S2.meshes(M)) g2.add(m);
  for (const m of ctx2.extra || []) g2.add(m);
  engine.add(g2);
  const bTris = built.reduce((a, b) => a + b.tris, 0) + (prop ? prop.tris : 0);
  console.log(`[acropolis] buildings ${built.map((b) => b.name + '(' + b.ms + 'ms)').join(', ')} in ${Math.round(performance.now() - tB)} ms, ${(bTris / 1e6).toFixed(2)} M tris`);

  engine.registry.acropolis = { stair: plan, levels, wallRuns: ctx.wallRuns, bastions, buildings: built, precinctBuildings: precB, houses: houses ? houses.placed : [], podium, arcade, colossusBases, crackSpots: ctx.crackSpots || [], surface: (z) => stairSurface(plan, z) };
  // suggested camera for the grand-staircase shot (ref 6): front edge of a terrace landing, looking up
  // the flights with their half-landings, pedestals and the propylon on the plateau
  {
    const ls = plan.segs.filter((sg) => sg.kind === 'landing' && sg.bastion);
    const Lb = ls[1] || ls[0];
    const fl = Lb && plan.segs.find((sg) => sg.kind === 'flight' && Math.abs(sg.z1 - Lb.z0) < 0.05);
    if (fl) {
      const z = Lb.z1 - 1.0, y = Lb.y0 + 1.75;
      engine.registry.acropolis.shot6 = { pos: [GS.x - 2.8, +y.toFixed(2), +z.toFixed(1)], target: [GS.x + 2.5, +(y + 11).toFixed(2), +(z - 45).toFixed(1)], fov: 58, sun: { azimuth: 285, elevation: 30 } };
    }
  }
  // (r6) colossus A (shots 5, 1; ref 5): dress the statues module's pedestal once it exists (first applyShot):
  // a balustrade with corner piers on the bastion ledge around the die, laurel festoons under the die cornice
  let doneA = false;
  engine.onShot(() => {
    if (doneA) return;
    doneA = true;
    for (const cid of ['A', 'B', 'C']) safe('colossus ' + cid + ' dressing', () => {
      let g = null;
      engine.scene.traverse((o) => { if (!g && o.name === 'colossus-' + cid && o.userData.pedestal) g = o; });
      const P = g && g.userData.pedestal;
      if (!P || !(P.w > 2) || !(P.dieTop - P.dieBottom > 1.5)) return;
      const yaw = g.rotation.y + (P.yaw || 0), c = Math.cos(yaw), s = Math.sin(yaw);
      const gx = g.position.x, gy = g.position.y, gz = g.position.z;
      const W = (lx, lz) => [gx + lx * c + lz * s, gz - lx * s + lz * c];
      const S3 = new ChunkedBuilders(48), rngA = engine.rng('acro-colossus' + cid);
      const bal = new Balustrades(engine, engine.rng('acro-colossus' + cid + '-bal')); bal.material = M.marble;
      // faces: [start local (x,z), along local dir, outward local dir, length]
      const hw = P.w / 2, hd = P.d / 2;
      const faces = [[[-1, 1], [1, 0], [0, 1], P.w], [[1, 1], [0, -1], [1, 0], P.d], [[1, -1], [-1, 0], [0, -1], P.w], [[-1, -1], [0, 1], [-1, 0], P.d]];
      const dieMid = (P.dieBottom + P.dieTop) / 2, Rm = Math.min(P.dieTop - P.dieBottom, Math.min(P.w, P.d)) * 0.36;
      for (const [st, al, ou, len] of faces) {
        const wa = (lx, lz) => { const p = W(lx, lz); return p; };
        const dirW = [al[0] * c + al[1] * s, -al[0] * s + al[1] * c], outW = [ou[0] * c + ou[1] * s, -ou[0] * s + ou[1] * c];
        // die face frame
        const o0 = wa(st[0] * hw, st[1] * hd);
        const Fd = frameXZ(o0[0], 0, o0[1], dirW[0], dirW[1], outW[0], outW[1]);
        const cG = blockColor(rngA, STONE_COL);
        const Bg = S3.get('marble', o0[0], o0[1]);
        for (const [a, b] of [[0.45, len / 2 - Rm - 0.25], [len / 2 + Rm + 0.25, len - 0.45]]) {
          if (b - a < 1.0) continue;
          const nG = Math.max(1, Math.round((b - a) / 2.4)), gw = (b - a) / nG;
          for (let k = 0; k < nG; k++) garland(Bg, Fd.at(0, 0, 0.01), a + k * gw + 0.1, a + (k + 1) * gw - 0.1, gy + P.dieTop - 0.32, Math.min(0.55, gw * 0.22), 0.17, rngA, cG);
        }
        // balustrade on the ledge between the die base and the bastion face
        if (!P.bastionTop) continue;
        const lo = (P.bastionOut || 1.2) - 0.42;
        const Fb = Fd.at(0, 0, lo);
        const yB = gy + P.bastionTop + 0.02;
        bal.addRun(S3, 'marble', Fb, 1.0 - lo, len + lo - 1.0, yB, {});
        // corner piers with a cap
        const Bp = S3.get('marble', Fb.o[0], Fb.o[2]);
        const cP = blockColor(rngA, STONE_COL);
        chamferBox(Bp, Fb, -lo - 0.35, -lo + 0.35, yB, yB + 1.25, -0.35, 0.35, 0.03, cP);
        chamferBox(Bp, Fb, -lo - 0.43, -lo + 0.43, yB + 1.25, yB + 1.42, -0.43, 0.43, 0.04, darker(cP, 0.95));
      }
      const grp = new THREE.Group(); grp.name = 'acropolis-colossus' + cid + '-dress';
      for (const m of S3.meshes(M)) grp.add(m);
      const bm = bal.build(); if (bm) grp.add(bm);
      engine.add(grp);
      engine.ensurePatched?.();
      console.log(`[acropolis] colossus ${cid} pedestal dressed (${P.w.toFixed(1)}×${P.d.toFixed(1)} m, ledge ${(P.bastionOut || 0).toFixed(2)} m)`);
    });
  });
  if (!engine.params?.get?.('acroNoRows')) for (const r of cypressRows(wallLevels, engine, GS.x)) engine.registry.cypressRows.push(r);
  // rows flanking the forecourt on the plateau
  if (podium) for (const x of [podium.x0 - 3.2, podium.x1 + 3.2]) engine.registry.cypressRows.push({ points: [[x, podium.zS + 1.5], [x, podium.zS + 9]], spacing: 5.5, tag: 'acro-forecourt' });
  const tris = ctx.S.tris + (bal ? bal.count * bal.geometry.attributes.position.count / 3 : 0);
  console.log(`[acropolis] built in ${Math.round(performance.now() - t0)} ms — ${meshes.length} meshes, ${(tris / 1e6).toFixed(2)} M tris, balusters ${bal ? bal.count : 0}, slots: statue ${engine.slots.statue.length}, brazier ${engine.slots.brazier.length}, banner ${engine.slots.banner.length}, ivy ${engine.slots.ivy.length}, lamp ${engine.slots.lamp.length}`);
}

export async function test(engine) {
  // build the real terrain + acropolis so the views are representative
  try { const t = await import('./terrain.js'); await t.build(engine); } catch (e) { console.warn('[acropolis test] terrain failed', e); }
  try { const w = await import('./water.js'); await w.build(engine); } catch (e) { console.warn('[acropolis test] water failed', e); }
  await build(engine);
  const R = engine.registry.acropolis;
  const GS = L.GRAND_STAIR;
  // view 0: standing on a landing, looking up the next flight (ref 6 framing)
  const segs = R.stair.segs;
  const land = segs.filter((s) => s.kind === 'landing' && !s.top)[2] || segs[1];
  const zc = land.z1 - 1.2, yc = land.y0 + 1.65;
  return {
    views: [
      R.shot6 || { pos: [GS.x - 3.5, yc, zc], target: [GS.x + 3, yc + 13, zc - 45], fov: 58, sun: { azimuth: 285, elevation: 30 } },
      { pos: [-330, 40, 430], target: [10, 70, 40], fov: 24 },
      { pos: [-170, 190, 330], target: [20, 55, 70], fov: 45 },
      { pos: [70, 56, 100], target: [4, 62, 95], fov: 60 },
      { pos: [-120, 118, 40], target: [91, 68, -413], fov: 46, sun: { azimuth: 300, elevation: 9 } },
      { pos: [-75, 58, 235], target: [10, 58, 105], fov: 42 },
      { pos: [40, 75, 175], target: [0, 70, 90], fov: 50 },
      { pos: [70, 7, 300], target: [0, 12, 215], fov: 48 },
    ],
  };
}
