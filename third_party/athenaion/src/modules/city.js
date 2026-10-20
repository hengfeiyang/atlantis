// CITY module: the town on the west hills (layout.CITY) and its harbour (layout.HARBOUR).
//   - contour-following street network (streamlines of the terrain orientation field)
//   - ~1–3k houses of plaster with terracotta roofs, all different, merged per chunk
//   - landmarks (agora + stoa, small temples, domed building, towers), city walls with towers
//   - harbour: quays, moles, lighthouse, ship sheds, ships; plus the moored boat at the tholos island
// Registers building footprints (engine.footprints, tag 'city') and garden areas
// (engine.registry.city.gardens) so the vegetation can fill gardens between the houses.
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { GeoBuilder, Frame } from '../city/geobuilder.js';
import { lotGround, gardenWall, quadFacing, stoneBox } from '../city/house.js';
import { plasterMaterial, PLASTER_ATTRS } from '../materials/plaster.js';
import { terracottaMaterial, ROOF_ATTRS } from '../materials/terracotta.js';
import { cityStoneMaterial, cityGoldMaterial, STONE_ATTRS } from '../city/stone.js';
import { CityPlan, Polyline } from '../city/plan.js';
import { RectIndex, makeLots, fillLots } from '../city/lots.js';
import { buildHouse, STATS as HOUSE_STATS } from '../city/buildings.js';
import { placeLandmarks } from '../city/landmarks.js';
import { buildWalls } from '../city/walls.js';
import { RNG } from '../core/rng.js';
import { buildHarbour } from '../city/harbour.js';
import { placeFleet, tholosBoat, placePortFleet, portMovers } from '../city/fleet.js';
import { portShore, bankTerraces } from '../city/port.js';
import { shipWoodMaterial, sailMaterial, WOOD_ATTRS, SAIL_ATTRS } from '../city/shipmats.js';

const CHUNK = 160;

class ChunkSet {
  constructor() { this.m = new Map(); }
  get(x, z) {
    const k = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
    let c = this.m.get(k);
    if (!c) {
      c = {
        plaster: new GeoBuilder(PLASTER_ATTRS), roof: new GeoBuilder(ROOF_ATTRS),
        stone: new GeoBuilder(STONE_ATTRS), street: new GeoBuilder(STONE_ATTRS),
        wood: new GeoBuilder(WOOD_ATTRS), sail: new GeoBuilder(SAIL_ATTRS),
        gold: new GeoBuilder({}),
      };
      this.m.set(k, c);
    }
    return c;
  }
  meshes() {
    const mats = { plaster: plasterMaterial(), roof: terracottaMaterial(), stone: cityStoneMaterial(), street: cityStoneMaterial({ offset: true }), wood: shipWoodMaterial(), sail: sailMaterial(), gold: cityGoldMaterial() };
    const out = [];
    let tris = 0;
    for (const [k, c] of this.m) {
      for (const name of Object.keys(mats)) {
        const b = c[name];
        if (b.empty) continue;
        tris += b.triangles;
        const mesh = new THREE.Mesh(b.toGeometry(), mats[name]);
        mesh.name = `city-${name}-${k}`;
        if (name === 'street') { mesh.castShadow = false; mesh.userData.castShadow = false; mesh.receiveShadow = true; }
        out.push(mesh);
      }
    }
    return { meshes: out, tris };
  }
}

/** resample a polyline to ~step metre segments */
function coarse(pts, step) {
  const out = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc >= step || i === pts.length - 1) { out.push(pts[i]); acc = 0; } }
  return out;
}

/** street surface strips along a polyline, draped on the terrain */
let nWallSeg = 0, ivySlots = null;
function streetStrip(chunks, plan, pts, halfW, seed, stairs = false, blocked = () => false, walls = true) {
  const pl = new Polyline(pts);
  const step = 4;
  const n = Math.max(2, Math.ceil(pl.length / step));
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * pl.length;
    const P = pl.at(s);
    const nx = -P.tz, nz = P.tx;
    const lx = P.x + nx * halfW, lz = P.z + nz * halfW, rx = P.x - nx * halfW, rz = P.z - nz * halfW;
    const inside = plan.inMask(P.x, P.z) && !blocked(P.x, P.z);
    const hc = heightAt(P.x, P.z);
    const hl = Math.max(heightAt(lx, lz), hc - 0.6) + 0.12, hr = Math.max(heightAt(rx, rz), hc - 0.6) + 0.12;
    // terrain just outside each edge (retaining walls where the street is carried above the slope)
    const gl = heightAt(P.x + nx * (halfW + 1.2), P.z + nz * (halfW + 1.2)), gr = heightAt(P.x - nx * (halfW + 1.2), P.z - nz * (halfW + 1.2));
    const cur = { l: [lx, hl, lz], r: [rx, hr, rz], s, inside, gl, gr, n: [nx, nz] };
    if (prev && prev.inside && cur.inside) {
      const C = chunks.get(P.x, P.z);
      const B = C.street;
      const st = (u, v) => [u, v, seed, 6];
      B.quad(prev.l, cur.l, cur.r, prev.r, null, { aSt: [st(prev.s, halfW), st(cur.s, halfW), st(cur.s, -halfW), st(prev.s, -halfW)] });
      void stairs;
      if (walls) for (const side of [1, -1]) {
        const a = side > 0 ? prev.l : prev.r, b = side > 0 ? cur.l : cur.r;
        const ga = side > 0 ? prev.gl : prev.gr, gb = side > 0 ? cur.gl : cur.gr;
        const da = a[1] - ga, db = b[1] - gb;
        if (Math.min(da, db) < 1.1 || blocked(a[0], a[2]) || blocked(b[0], b[2])) continue;
        // outward normal of this edge, wall face from the coping down below the terrain
        const on = [side * (prev.n[0] + cur.n[0]) / 2, 0, side * (prev.n[1] + cur.n[1]) / 2];
        const S = C.stone;
        const k = seed > 0.5 ? 2 : 0;   // polygonal masonry under the lanes, ashlar under the streets
        const sq = (u, v) => [u, v, seed * 7.1, k];
        const yA = a[1] + 0.45, yB = b[1] + 0.45;
        const a0 = [a[0], ga - 0.6, a[2]], b0 = [b[0], gb - 0.6, b[2]], a1 = [a[0], yA, a[2]], b1 = [b[0], yB, b[2]];
        const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
        quadFacing(S, a0, b0, b1, a1, on, { aSt: [sq(prev.s, a0[1]), sq(prev.s + L, b0[1]), sq(prev.s + L, yB), sq(prev.s, yA)] });
        // coping on the low parapet
        const ia = [a[0] - on[0] * 0.35, yA, a[2] - on[2] * 0.35], ib = [b[0] - on[0] * 0.35, yB, b[2] - on[2] * 0.35];
        quadFacing(S, a1, b1, ib, ia, [0, 1, 0], { aSt: [sq(prev.s, 0), sq(prev.s + L, 0), sq(prev.s + L, 0.35), sq(prev.s, 0.35)].map((q) => [q[0], q[1], q[2], 3]) });
        const ia0 = [ia[0], a[1] - 0.05, ia[2]], ib0 = [ib[0], b[1] - 0.05, ib[2]];
        quadFacing(S, ia0, ib0, ib, ia, [-on[0], 0, -on[2]], { aSt: [sq(prev.s, 0), sq(prev.s + L, 0), sq(prev.s + L, 0.5), sq(prev.s, 0.5)] });
        nWallSeg++;
        if (ivySlots && ((seed * 977 + prev.s * 0.37) % 1) < 0.35) ivySlots.push({ pos: [(a[0] + b[0]) / 2, (yA + yB) / 2 - 0.1, (a[2] + b[2]) / 2], facing: ((Math.atan2(on[0], -on[2]) * 180) / Math.PI + 360) % 360, size: Math.min(Math.min(da, db) + 0.3, 4.5), width: 1.5 + ((prev.s * 0.61) % 1) * 2, tag: 'city-street-wall' });
      }
    }
    prev = cur;
  }
}

export async function build(engine, opts = {}) {
  const t0 = performance.now();
  const q = engine.quality;
  const rng = new RNG('city-v1');
  nWallSeg = 0; ivySlots = engine.slots?.ivy || null;
  const plan = new CityPlan(engine, rng);
  plan.run();
  const t1 = performance.now();
  const T = {}; let tp = t1; const lap = (k) => { const n = performance.now(); T[k] = Math.round(n - tp); tp = n; };

  const occ = new RectIndex(32);
  const chunks = new ChunkSet();
  const gardens = [];
  const reg = (engine.registry.city = { gardens, houses: [], streets: [] });

  // district fields: centre (near the centroid), harbour (near water), edge (near the outline)
  const C = plan.centroid;
  const district = (x, z) => ({
    centre: Math.max(0, 1 - Math.hypot(x - C[0], z - C[1]) / 320),
    harbour: Math.max(0, 1 - plan.W.sample(x, z) / 140),
    edge: Math.max(0, 1 + plan.E.sample(x, z) / 70),
  });

  // ---- lagoon port quay + warehouses first (registered footprints keep the street lots clear of them)
  let port = null;
  try { port = buildHarbour((x, z) => chunks.get(x, z), engine, rng.fork('port'), { coast: portShore(), quayOut: 7, moles: false, sheds: false, whIn: 12.5, whAny: true }); }
  catch (e) { console.error('[city] port failed', e.stack || e); }
  lap('port');

  // ---- landmarks first (lots avoid them)
  const landmarks = placeLandmarks(plan, occ, (x, z) => chunks.get(x, z), engine, rng.fork('landmarks'));
  reg.landmarks = landmarks;
  lap('landmarks');

  // ---- city walls (gates where the downhill lanes leave the town)
  const crossings = [];
  for (const line of plan.B.lines) for (let i = 1; i < line.length; i++) {
    const ea = plan.E.sample(line[i - 1][0], line[i - 1][1]) + 9, eb = plan.E.sample(line[i][0], line[i][1]) + 9;
    if (ea * eb < 0) crossings.push(line[i]);
  }
  let walls = { towers: [], gates: [], length: 0 };
  try { walls = buildWalls(plan, occ, (x, z) => chunks.get(x, z), engine, rng.fork('walls'), crossings); } catch (e) { console.error('[city] walls failed', e.stack || e); }
  reg.walls = walls;
  lap('walls');

  // ---- lots + houses
  const keep = 0.74 + 0.1 * Math.min(1, q.density); // ~16-26% of the lots stay orchards / kitchen gardens (ref 1: trees everywhere between the houses)
  const rowProb = (x, z) => { const d = district(x, z); return Math.min(0.92, 0.3 + 0.55 * d.centre + 0.45 * d.harbour - 0.35 * d.edge); };
  const orchards = [];
  const lots = makeLots(plan, occ, engine, rng.fork('lots'), { keep, rowProb, gardens, orchards, blockRng: new RNG('city-blocks-r5') });
  const nFront = lots.length;
  lots.push(...fillLots(plan, occ, engine, rng.fork('fill'), { gardens, orchards, orchard: 0.3 }));
  // orchards / kitchen gardens: yard ground + low dry-stone walls
  for (const o of orchards) {
    const B = chunks.get(o.x, o.z);
    const F = new Frame(o.x, 0, o.z, o.rot);
    lotGround(B, F, 0, 0, o.w / 2, o.d / 2, heightAt, o.seed);
    if (o.seed < 0.6) {
      const g = (lx, lz) => { const [wx, , wz] = F.p(lx, 0, lz); return heightAt(wx, wz); };
      const hw = o.w / 2 - 0.2, hd = o.d / 2 - 0.2;
      gardenWall(B, F, hw, -hd, -hw, -hd, g(hw, -hd), g(-hw, -hd), 1.1, o.seed, false);
      gardenWall(B, F, -hw, -hd, -hw, hd, g(-hw, -hd), g(-hw, hd), 1.1, o.seed, false);
      gardenWall(B, F, hw, hd, hw, -hd, g(hw, hd), g(hw, -hd), 1.1, o.seed, false);
    }
  }
  let nHouses = 0;
  const ctx = { district, gardens, occ, ground: (x, z) => plan.H.sample(x, z), slots: engine.slots };
  for (const lot of lots) {
    ctx.B = chunks.get(lot.x, lot.z);
    // uniform blocks: every lot of the block draws the same design decisions (one long palazzo front)
    const hr = new RNG(Math.floor((lot.block?.uniform ? lot.block.seed : lot.seed) * 4294967296));
    const vols = buildHouse(ctx, lot, hr);
    for (const v of vols) {
      engine.footprints.addRect(v.x, v.z, v.hw + 0.3, v.hd + 0.3, v.rot, 'city');
      v.lot = lot; reg.houses.push(v);
    }
    nHouses++;
  }

  // ---- terraced channel bank south of the port: retaining walls, terraces, row houses on them
  let nBank = 0, strips = [], nTerraceTrees = 0;
  try {
    const parts = ['bank', 'rim', 'hillN', 'hillS'].map((w) => bankTerraces((x, z) => chunks.get(x, z), engine, rng.fork(w), w));
    const bl = parts.flat();
    strips = parts.flatMap((p) => p.strips || []);
    const g0 = ctx.ground;
    for (const lot of bl) {
      if (occ.overlaps(lot.x, lot.z, lot.w / 2 - 0.3, lot.d / 2 - 0.3, lot.rot)) continue;
      occ.add(lot.x, lot.z, lot.w / 2, lot.d / 2, lot.rot, 'lot');
      ctx.B = chunks.get(lot.x, lot.z);
      ctx.ground = () => lot.floor;
      const vols = buildHouse(ctx, lot, new RNG(Math.floor(lot.seed * 4294967296)));
      for (const v of vols) { engine.footprints.addRect(v.x, v.z, v.hw + 0.3, v.hd + 0.3, v.rot, 'city'); v.lot = lot; reg.houses.push(v); }
      nBank++;
    }
    ctx.ground = g0;
    // planted terraces: trees on the free stretches of every terrace (stepped green terraces, ref 1);
    // the vegetation module grows engine.slots.tree at the given (raised) height
    const tr = rng.fork('terraceTrees');
    const trees = (engine.slots.tree ||= []);
    for (const s of strips) {
      for (let i = 0; i < s.front.length - 1; i++) {
        if (!tr.chance(0.85)) continue;
        const f = s.front[i], b = s.back[i], t = tr.range(0.12, 0.45);
        const x = f[0] + (b[0] - f[0]) * t, z = f[1] + (b[1] - f[1]) * t;
        if (!engine.footprints.isFree(x, z, 1.1)) continue;
        const r = tr.random();
        const kind = r < 0.45 ? 'cypress' : r < 0.68 ? 'olive' : r < 0.9 ? 'broad' : 'shrub';
        trees.push({ pos: [x, s.top, z], tag: kind, size: kind === 'cypress' ? tr.range(8, 13) : kind === 'olive' ? tr.range(4, 6.5) : kind === 'broad' ? tr.range(5, 8) : tr.range(1.3, 2.2), source: 'city-terrace' });
        engine.footprints.addCircle(x, z, 1.0, 'city-tree');
        nTerraceTrees++;
      }
    }
  } catch (e) { console.error('[city] bank terraces failed', e.stack || e); }
  nHouses += nBank;
  lap('houses');
  // ---- streets (surfaces + footprints)
  const blocked = (x, z) => landmarks.some((l) => { const dx = x - l.x, dz = z - l.z, c = Math.cos(l.rot), s = Math.sin(l.rot); return Math.abs(dx * c - dz * s) < l.hw + 1 && Math.abs(dx * s + dz * c) < l.hd + 1; });
  for (const line of plan.A.lines) {
    streetStrip(chunks, plan, line, 2.4, 0.3, false, blocked);
    engine.footprints.addPath(coarse(line, 7), 2.6, 'street');
    reg.streets.push({ pts: line, halfWidth: 2.4, kind: 'street' });
  }
  let nSteps = 0;
  for (const line of plan.B.lines) {
    streetStrip(chunks, plan, line, 1.6, 0.7, true, blocked);
    // stepped lanes (cordonata): stone step nosings across the steep downhill lanes → rows of small
    // light/shadow lines on the hillside (refs 1/4)
    const pl = new Polyline(line);
    for (let s = 2; s < pl.length - 2; s += 2.2) {
      const P = pl.at(s);
      if (!plan.inMask(P.x, P.z) || blocked(P.x, P.z)) continue;
      const ha = heightAt(P.x - P.tx * 1.1, P.z - P.tz * 1.1), hb = heightAt(P.x + P.tx * 1.1, P.z + P.tz * 1.1);
      if (Math.abs(hb - ha) / 2.2 < 0.09) continue;
      const hc = heightAt(P.x, P.z);
      const F = new Frame(P.x, 0, P.z, Math.atan2(P.tx, P.tz));
      stoneBox(chunks.get(P.x, P.z), F, 0, 0, 1.55, 0.17, hc - 0.25, hc + 0.32, 3, 0.7, 31);
      nSteps++;
    }
    engine.footprints.addPath(coarse(line, 7), 1.8, 'street');
    reg.streets.push({ pts: line, halfWidth: 1.6, kind: 'lane' });
  }

  // ---- pocket gardens: the free scraps of buildable ground between lots, streets and landmarks get a
  // tree each (ref 1: dark cypress / broadleaf crowns everywhere between the houses)
  {
    const pr = rng.fork('pockets');
    const sh = plan.A.hash, lh = plan.B.hash;
    let nP = 0;
    for (let z = plan.z0 + 6; z < plan.z1 - 6; z += 5.5) for (let x = plan.x0 + 6; x < plan.x1 - 6; x += 5.5) {
      const px = x + pr.range(-1.6, 1.6), pz = z + pr.range(-1.6, 1.6);
      if (!plan.inMask(px, pz) || !pr.chance(0.85)) continue;
      if (sh.nearest(px, pz, 5) < 4.2 || lh.nearest(px, pz, 4) < 3.2) continue;
      const r = pr.range(1.8, 2.8);
      if (occ.overlaps(px, pz, r, r, 0) || !engine.footprints.isFree(px, pz, r)) continue;
      occ.add(px, pz, r, r, 0, 'garden');
      gardens.push({ x: px, z: pz, hw: r - 0.4, hd: r - 0.4, rot: 0, kind: 'pocket' });
      nP++;
    }
    reg.pocketGardens = nP;
  }
  lap('streets');
  // ---- cypress rows for the vegetation module: temple precincts, agora edges, a few outer streets
  try {
    const rows = (engine.registry.cypressRows ||= []);
    const rr = rng.fork('rows');
    for (const l of landmarks) {
      if (!['temple', 'agora', 'palace', 'rotunda'].includes(l.kind)) continue;
      const c0 = Math.cos(l.rot), s0 = Math.sin(l.rot);
      const P = (lx, lz) => [l.x + lx * c0 + lz * s0, l.z - lx * s0 + lz * c0];
      const ox = l.hw + 3.5, oz = l.hd + 3.5;
      for (const sx of [-1, 1]) rows.push({ points: [P(sx * ox, -oz), P(sx * ox, oz)], spacing: rr.range(5.5, 7.5), height: rr.range(13, 18), source: 'city' });
      if (l.kind !== 'agora') rows.push({ points: [P(-ox, -oz), P(ox, -oz)], spacing: rr.range(6, 8), height: rr.range(12, 16), source: 'city' });
    }
    let nStreet = 0;
    for (const line of plan.A.lines) {
      const m = line[(line.length / 2) | 0];
      const d = district(m[0], m[1]);
      if (d.edge < 0.3 || !rr.chance(0.35) || nStreet > 8) continue;
      const side = rr.sign();
      const pts = coarse(line, 10).map((p, i, a) => { const q = a[Math.min(a.length - 1, i + 1)], o = a[Math.max(0, i - 1)]; let tx = q[0] - o[0], tz = q[1] - o[1]; const tl = Math.hypot(tx, tz) || 1; return [p[0] - (tz / tl) * 3.4 * side, p[1] + (tx / tl) * 3.4 * side]; });
      rows.push({ points: pts, spacing: rr.range(7, 10), height: rr.range(12, 17), source: 'city' });
      nStreet++;
    }
  } catch (e) { console.error('[city] cypress rows failed', e); }
  // ---- harbour, ships, tholos boat
  let harbour = null, nShips = 0;
  try {
    harbour = buildHarbour((x, z) => chunks.get(x, z), engine, rng.fork('harbour'));
    nShips = placeFleet((x, z) => chunks.get(x, z), harbour, engine, rng.fork('fleet'), q.density);
    reg.harbour = { lighthouse: harbour.lighthouse, basinCenter: harbour.basinCenter };
  } catch (e) { console.error('[city] harbour failed', e.stack || e); }
  let nPort = 0;
  let movers = [];
  try { if (port) { const pf = placePortFleet((x, z) => chunks.get(x, z), port, engine, rng.fork('portFleet'), q.density); nPort = pf.n; movers = pf.movers; nShips += nPort; reg.port = { quay: port.quay?.outer, moorings: port.moorings?.length ?? 0, ships: nPort, underWay: movers.map((m) => [+m.x.toFixed(1), +m.z.toFixed(1)]) }; } }
  catch (e) { console.error('[city] port fleet failed', e.stack || e); }
  try { reg.tholosBoat = tholosBoat((x, z) => chunks.get(x, z), engine, rng.fork('tholos')); } catch (e) { console.error('[city] tholos boat failed', e.stack || e); }

  lap('harbour');
  const { meshes, tris } = chunks.meshes();
  lap('meshes');
  const group = new THREE.Group(); group.name = 'city';
  for (const m of meshes) group.add(m);
  if (harbour?.lighthouse?.fire) group.add(lighthouseFire(engine, harbour.lighthouse.fire));
  if (movers.length) { try { group.add(portMovers(engine, movers, { wood: shipWoodMaterial(), sail: sailMaterial() })); } catch (e) { console.error('[city] port movers failed', e.stack || e); } }
  engine.add(group);
  const ms = Math.round(performance.now() - t0);
  console.log(`[city] plan ${Math.round(t1 - t0)} ms, ${plan.A.lines.length} streets, ${plan.B.lines.length} lanes, ${lots.length} lots (${nFront} street + ${lots.length - nFront} fill), ${orchards.length} orchards, ${nHouses} houses (${nBank} on the bank terraces), ${gardens.length} gardens (${reg.pocketGardens ?? 0} pockets), walls ${Math.round(walls.length)} m / ${walls.towers.length} towers / ${walls.gates.length} gates, ${landmarks.length} landmarks (${landmarks.map((l) => l.kind).join(',')}), ${nShips} ships (${nPort} in the lagoon port), ${nWallSeg} retaining-wall segments, ${strips.length} terrace strips / ${nTerraceTrees} terrace trees,${meshes.length} meshes, ${(tris / 1e6).toFixed(2)} M tris, ${ms} ms ${JSON.stringify(T)}`);
  console.log('[city] features ' + JSON.stringify({ ...HOUSE_STATS, laneSteps: nSteps }));
  if (engine.params?.get?.('cityDebug')) {
    const pick = (x, z) => { let b = null, bd = Infinity; for (const h of reg.houses) { const d = Math.hypot(h.x - x, h.z - z); if (d < bd) { bd = d; b = h; } } return b; };
    for (const [x, z] of [[-760, -170], [-620, -300], [-1000, 0], [-900, -350], [-560, -480]]) { const h = pick(x, z); if (h) console.log('[city:debug] house ' + JSON.stringify({ x: +h.x.toFixed(1), z: +h.z.toFixed(1), rot: +h.rot.toFixed(3), floorY: +h.floorY.toFixed(1), h: +h.h.toFixed(1), street: h.lot?.street?.map((v) => +v.toFixed(1)) })); }
    for (const l of landmarks) console.log('[city:debug] landmark ' + JSON.stringify({ kind: l.kind, x: +l.x.toFixed(1), z: +l.z.toFixed(1), rot: +l.rot.toFixed(3), floorY: +(l.floorY ?? 0).toFixed(1) }));
  }
  return { plan, lots };
}

/** lighthouse beacon: bronze bowl + flickering emissive flame tongues */
function lighthouseFire(engine, [x, y, z]) {
  const g = new THREE.Group(); g.name = 'city-lighthouse-fire';
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.7, 0.8, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a5a2b, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide }));
  bowl.position.set(x, y, z);
  g.add(bowl);
  const flameMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.45, 0.12), emissiveIntensity: 9, roughness: 1 });
  const tongues = [];
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.55 - i * 0.06, 2.2 - i * 0.2, 7, 1), flameMat);
    const a = i * 1.3;
    f.position.set(x + Math.cos(a) * 0.35 * (i > 0), y + 1.2, z + Math.sin(a) * 0.35 * (i > 0));
    f.castShadow = false; f.userData.castShadow = false;
    g.add(f); tongues.push(f);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.65, 0.3), emissiveIntensity: 14 }));
  core.position.set(x, y + 0.45, z); core.castShadow = false; core.userData.castShadow = false; g.add(core);
  engine.onUpdate((t) => { tongues.forEach((f, i) => { const k = 0.85 + 0.25 * Math.sin(t * (7 + i * 1.7) + i * 2.1) * Math.sin(t * (3.1 + i) + i); f.scale.set(1, k, 1); f.position.y = y + 0.4 + 1.1 * k; }); });
  return g;
}

// ------------------------------------------------------------------ isolated test scene
function testTerrain(engine) {
  // local terrain patch over the town (independent of the terrain module's state)
  const x0 = -1460, x1 = 60, z0 = -680, z1 = 720, res = engine.quality.detail >= 1 ? 3 : 4;
  const nx = Math.round((x1 - x0) / res), nz = Math.round((z1 - z0) / res);
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz).rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + (x0 + x1) / 2, z = p.getZ(i) + (z0 + z1) / 2;
    p.setXYZ(i, x, heightAt(x, z), z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nfloat th(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}\nfloat vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(th(i),th(i+vec2(1,0)),f.x),mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x),f.y);}')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 nn = normalize(cross(dFdx(vWP), dFdy(vWP)));
        float sl = 1.0 - abs(nn.y);
        float n = vn(vWP.xz*0.08)*0.6+vn(vWP.xz*0.5)*0.4;
        vec3 grass = mix(vec3(0.10,0.12,0.05), vec3(0.22,0.20,0.11), n);
        vec3 dirt = vec3(0.30,0.25,0.18)*(0.8+0.3*n);
        vec3 rock = vec3(0.50,0.47,0.41)*(0.8+0.3*vn(vWP.xz*0.3+vWP.y*0.2));
        vec3 c = mix(grass, dirt, smoothstep(0.45,0.75,n));
        c = mix(c, rock, smoothstep(0.35,0.6,sl));
        c = mix(vec3(0.55,0.5,0.4), c, smoothstep(0.5,2.5,vWP.y));
        diffuseColor.rgb = c;`);
  };
  const m = new THREE.Mesh(geo, mat); m.name = 'cityTestTerrain';
  engine.add(m);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0x0d3f4a, roughness: 0.08, metalness: 0.0 }));
  water.name = 'cityTestWater';
  engine.add(water, { castShadow: false, receiveShadow: true });
}

export async function test(engine) {
  for (const c of engine.scene.children) if (c.name === 'testGround') c.visible = false;
  testTerrain(engine);
  const p = engine.params;
  const res = await build(engine);
  if (p.get('cityTrees') !== '0') await addTestTrees(engine);
  const sunA = { azimuth: 238, elevation: 21 };
  // views relative to generated content: pick the house nearest to a probe point
  const houses = engine.registry.city.houses;
  const near = (x, z) => { let b = houses[0], bd = Infinity; for (const h of houses) { const d = Math.hypot(h.x - x, h.z - z); if (d < bd) { bd = d; b = h; } } return b; };
  const look = (h, dist, up, side = 0, fov = 50) => {
    const fx = Math.sin(h.rot), fz = Math.cos(h.rot);       // house front direction
    const sx = Math.cos(h.rot), sz = -Math.sin(h.rot);
    const px = h.x + fx * dist + sx * side, pz = h.z + fz * dist + sz * side;
    const gy = Math.max(heightAt(px, pz), 0, h.floorY + h.h) + up;
    return { pos: [px, gy, pz], target: [h.x, h.floorY + h.h * 0.45, h.z], fov, sun: sunA };
  };
  const hA = near(-760, -170), hB = near(-620, -300), hC = near(-1000, 0);
  void res;
  const views = [
      // 0: ref-1 like composition (harbour lower-left, town behind, backlit low sun from the left)
      { pos: [-430, 112, 480], target: [-640, 48, 120], fov: 46, sun: { azimuth: 300, elevation: 9 } },
      // 1: same direction, default sun
      { pos: [-430, 175, 330], target: [-860, 70, -120], fov: 46, sun: sunA },
      // 2: mid-distance over a quarter
      look(hB, 150, 70, 30, 45),
      // 3: close-up of a house (materials)
      look(hA, 26, 4, 6, 50),
      // 4: plan view (street network check)
      { pos: [-860, 1500, -40], target: [-860, 0, -41], fov: 50, sun: { azimuth: 200, elevation: 60 } },
      // 5: another close-up, different quarter
      look(hC, 40, 12, -10, 50),
      // 6: harbour basin from above the east shore
      harbourView(engine, sunA),
      // 7: tholos boat (shot 2 camera, narrower)
      boatView(engine, sunA),
      // 8: lighthouse + mole close
      lighthouseView(engine, sunA),
      // 9..: landmarks
      ...lmViews(engine.registry.city.landmarks, sunA),
  ];
  const r1 = (v) => JSON.stringify({ pos: v.pos.map((x) => +x.toFixed(1)), target: v.target.map((x) => +x.toFixed(1)), fov: v.fov, sun: v.sun });
  views.forEach((v, i) => console.log('[city:test] view ' + i + ' ' + r1(v)));
  return { views };
}

function harbourView(engine, sun) {
  const h = engine.registry.city.harbour;
  const C = h?.basinCenter || [-800, 250];
  return { pos: [C[0] + 230, 75, C[1] + 170], target: [C[0] - 120, 12, C[1] - 120], fov: 50, sun };
}
function boatView(engine, sun) {
  const b = engine.registry.city.tholosBoat || { x: -147, z: 305 };
  return { pos: [-130, 3.2, 420], target: [b.x, 4.5, b.z], fov: 26, sun };
}
function lighthouseView(engine, sun) {
  const l = engine.registry.city.harbour?.lighthouse || { x: -900, z: 400, y: 2 };
  return { pos: [l.x + 70, 18, l.z + 55], target: [l.x - 10, l.y + 12, l.z - 20], fov: 50, sun };
}
function lmViews(lms, sun) {
  const v = [];
  for (const kind of ['agora', 'temple', 'rotunda', 'tower']) {
    const l = lms.find((m) => m.kind === kind); if (!l) continue;
    const d = kind === 'agora' ? 95 : kind === 'tower' ? 55 : 48;
    const a = l.rot + 0.5;
    const px = l.x + Math.sin(a) * d, pz = l.z + Math.cos(a) * d;
    v.push({ pos: [px, Math.max(heightAt(px, pz), l.floorY) + (kind === 'agora' ? 40 : 14), pz], target: [l.x, l.floorY + 5, l.z], fov: 50, sun });
  }
  return v;
}

// TEST ONLY: borrow the vegetation library (if present) to put trees in the gardens and along the
// streets, so the test views can be judged against ref 1. The real world uses the vegetation module.
async function addTestTrees(engine) {
  try {
    const { VegSystem } = await import('../vegetation/instances.js');
    const { buildLibrary } = await import('../vegetation/library.js');
    const sys = new VegSystem(engine);
    const lib = buildLibrary(sys, engine);
    const rng = new RNG('city-test-trees');
    const fp = engine.footprints;
    const reg = engine.registry.city;
    let n = 0;
    const place = (set, x, z, s) => {
      if (!set || !set.length) return;
      const y = heightAt(x, z);
      if (y < 0.5) return;
      sys.add(set[Math.floor(rng.random() * set.length)], x, y, z, rng.random() * 6.28, s, { tint: [rng.range(0.9, 1.08), rng.range(0.92, 1.05), rng.range(0.88, 1.0)], width: rng.range(0.85, 1.1) });
      n++;
    };
    for (const g of reg.gardens) {
      const k = 1 + Math.floor(rng.random() * 3);
      for (let i = 0; i < k; i++) {
        const lx = rng.range(-g.hw, g.hw), lz = rng.range(-g.hd, g.hd);
        const x = g.x + lx * Math.cos(g.rot) + lz * Math.sin(g.rot), z = g.z - lx * Math.sin(g.rot) + lz * Math.cos(g.rot);
        const r = rng.random();
        place(r < 0.45 ? lib.cypress : r < 0.75 ? lib.broad : lib.olive, x, z, rng.range(0.7, 1.1));
      }
    }
    // free ground between houses
    for (let i = 0; i < 9000; i++) {
      const x = rng.range(-1380, -400), z = rng.range(-560, 300);
      if (heightAt(x, z) < 2) continue;
      if (!fp.isFree(x, z, 2.5)) continue;
      const r = rng.random();
      place(r < 0.4 ? lib.cypress : r < 0.7 ? lib.broad : r < 0.85 ? lib.olive : r < 0.92 ? lib.pine : lib.shrub, x, z, rng.range(0.7, 1.15));
    }
    sys.finalize();
    engine.add(sys.group);
    engine.onShot(() => sys.update(engine.camera));
    console.log(`[city:test] ${n} borrowed trees`);
  } catch (e) {
    console.log('[city:test] no vegetation library available:', e.message);
  }
}
