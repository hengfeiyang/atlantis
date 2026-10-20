// CITY module (ATLANTIS): houses, streets, colonnaded avenues, landmarks (gold-domed tholoi, temples,
// domed halls / baths, palaces, gymnasia, banded towers with gold cupolas) on land rings 1 and 2 and the
// outer city on the northern plain, plus the racecourse on land ring 2 (layout RACECOURSE, ref 1 right).
// Sunken era: the same plan, ruined (src/city/house.js ruin mode): roofless shells with broken walls,
// fallen upper storeys, rubble, broken / toppled columns, collapsed domes; streets under sand; coral
// slots pushed on wall tops, rubble, floors and drums.
// Registers footprints (tag 'city', 'street', 'racecourse', 'city-landmark'), engine.registry.city
// { gardens, houses, streets, landmarks, racecourse } and slots (palm, tree, banner, urn, coral).
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { isSunken } from '../world/era.js';
import { RNG } from '../core/rng.js';
import { GeoBuilder, Frame } from '../city/geobuilder.js';
import { stoneBox, column, setRuin, quadFacing, triFacing } from '../city/house.js';
import { buildHouse, STYLE, STATS as HOUSE_STATS } from '../city/buildings.js';
import { temple, palace, ring } from '../city/landmarks.js';
import { tholos, goldTower, domedHall, gymnasium, arcade, goldDome } from '../city/monuments.js';
import { hippodrome } from '../city/hippodrome.js';
import { CityPlan, districts, FORUM } from '../city/ringplan.js';
import { SHOTS } from '../world/shots.js';
import { plasterMaterial, PLASTER_ATTRS } from '../city/mats/plaster.js';
import { terracottaMaterial, ROOF_ATTRS } from '../city/mats/terracotta.js';
import { cityStoneMaterial, cityGoldMaterial, STONE_ATTRS } from '../city/mats/citystone.js';
import { cityWoodMaterial, WOOD_ATTRS } from '../city/mats/wood.js';

const D2R = Math.PI / 180;
const PAVING = 1, STREET = 6, MARBLE = 7, BLACK_STONE = 14;

class ChunkSet {
  constructor(size) { this.size = size; this.m = new Map(); }
  get(x, z) {
    const s = Math.hypot(x, z) > 880 ? this.size * 2 : this.size;
    const k = s + ':' + Math.floor(x / s) + ',' + Math.floor(z / s);
    let c = this.m.get(k);
    if (!c) {
      c = { plaster: new GeoBuilder(PLASTER_ATTRS), roof: new GeoBuilder(ROOF_ATTRS), stone: new GeoBuilder(STONE_ATTRS), street: new GeoBuilder(STONE_ATTRS), wood: new GeoBuilder(WOOD_ATTRS), gold: new GeoBuilder({}) };
      this.m.set(k, c);
    }
    return c;
  }
  meshes(mats) {
    const out = []; let tris = 0;
    for (const [k, c] of this.m) for (const name of Object.keys(mats)) {
      const b = c[name];
      if (!b || b.empty) continue;
      tris += b.triangles;
      const mesh = new THREE.Mesh(b.toGeometry(), mats[name]);
      mesh.name = `city-${name}-${k}`;
      if (name === 'street') { mesh.castShadow = false; mesh.userData.castShadow = false; }
      out.push(mesh);
    }
    return { meshes: out, tris };
  }
}

async function sharedGold() {
  try {
    const r = await fetch(new URL('../materials/READY', import.meta.url));
    if (!r.ok) return null;
    const m = await import('../materials/metal.js');
    const g = m.goldMaterial ? m.goldMaterial() : null;
    if (g && !g.userData.sunken) g.userData.sunken = 'gold';
    return g;
  } catch (e) { return null; }
}

// ------------------------------------------------------------------ streets
function streetArc(chunks, plan, s, sunken, skip) {
  if (sunken) return 0;
  const step = 4;
  const len = (s.b1 - s.b0) * D2R * s.r;
  const n = Math.max(2, Math.ceil(len / step));
  let quads = 0;
  for (let i = 0; i < n; i++) {
    const ba = s.b0 + ((s.b1 - s.b0) * i) / n, bb = s.b0 + ((s.b1 - s.b0) * (i + 1)) / n;
    const [cx, cz] = L.polar(s.r, (ba + bb) / 2);
    if (skip(cx, cz)) continue;
    const P = (r, b) => { const [x, z] = L.polar(r, b); return [x, heightAt(x, z) + 0.1, z]; };
    const kind = s.district === 'outer' ? STREET : PAVING;
    const sa = ba * D2R * s.r, sb = bb * D2R * s.r;
    const B = chunks.get(cx, cz).street;
    quadFacing(B, P(s.r - s.hw, ba), P(s.r - s.hw, bb), P(s.r + s.hw, bb), P(s.r + s.hw, ba), [0, 1, 0],
      { aSt: [[sa, -s.hw, 0.3, kind], [sb, -s.hw, 0.3, kind], [sb, s.hw, 0.3, kind], [sa, s.hw, 0.3, kind]] });
    quads++;
  }
  return quads;
}
function streetRadial(chunks, s, sunken, skip) {
  if (sunken) return 0;
  const step = 4;
  const n = Math.max(1, Math.ceil((s.r1 - s.r0) / step));
  const hwDeg = (r) => (s.hw / r) / D2R;
  let quads = 0;
  for (let i = 0; i < n; i++) {
    const ra = s.r0 + ((s.r1 - s.r0) * i) / n, rb = s.r0 + ((s.r1 - s.r0) * (i + 1)) / n;
    const [cx, cz] = L.polar((ra + rb) / 2, s.b);
    if (skip(cx, cz)) continue;
    const P = (r, b) => { const [x, z] = L.polar(r, b); return [x, heightAt(x, z) + 0.11, z]; };
    const kind = s.district === 'outer' ? STREET : PAVING;
    const B = chunks.get(cx, cz).street;
    quadFacing(B, P(ra, s.b - hwDeg(ra)), P(rb, s.b - hwDeg(rb)), P(rb, s.b + hwDeg(rb)), P(ra, s.b + hwDeg(ra)), [0, 1, 0],
      { aSt: [[-s.hw, ra, 0.6, kind], [-s.hw, rb, 0.6, kind], [s.hw, rb, 0.6, kind], [s.hw, ra, 0.6, kind]] });
    quads++;
  }
  return quads;
}

/** colonnaded porticoes along an avenue (both sides), flat roofs back to the house fronts */
function avenueColonnade(chunks, plan, s, engine, rng, sunken) {
  if (s.district === 'outer') return 0;
  const D = districts().find((d) => d.id === s.district);
  const radials = plan.streets.filter((q) => q.kind === 'radial' && q.district === s.district && q.r0 < s.r && q.r1 > s.r - 1);
  let n = 0;
  const colH = 5.2, bay = 3.8;
  for (const side of [-1, 1]) {
    const rc = s.r + side * (s.hw - 2.4), rf = s.r + side * s.hw;
    const steps = Math.floor(((s.b1 - s.b0) * D2R * rc) / bay);
    for (let i = 0; i < steps; i++) {
      const b = s.b0 + ((i + 0.5) * bay) / rc / D2R;
      const [x, z] = L.polar(rc, b);
      // gaps at street crossings, in front of landmarks and wherever something else stands
      if (radials.some((q) => Math.abs(((b - q.b + 540) % 360) - 180) * D2R * rc < q.hw + 2.5)) continue;
      if (plan.reservedAt(x, z, 1.5)) continue;
      if (plan.sites.some((st) => st.kind !== 'tower' && Math.hypot(st.x - x, st.z - z) < Math.max(st.w, st.d) * 0.62)) continue;
      const g = heightAt(x, z);
      const F = new Frame(x, 0, z, Math.PI / 2 - b * D2R);   // local +Z along the tangent
      const B = chunks.get(x, z);
      const seed = 0.41 + 0.1 * ((i * 7) % 5) / 5;
      stoneBox(B, F, 0, 0, 0.42, 0.42, g - 0.3, g + 0.35, MARBLE, seed, 31);
      column(B, F, 0, 0, 0.3, 0.26, g + 0.35, g + colH - 0.55, 10, seed, MARBLE);
      column(B, F, 0, 0, 0.26, 0.38, g + colH - 0.55, g + colH - 0.3, 10, seed, MARBLE);
      stoneBox(B, F, 0, 0, 0.42, 0.42, g + colH - 0.3, g + colH, MARBLE, seed, 63);
      // architrave + roof slab spanning back to the facade line
      const [mx, mz] = L.polar((rc + rf) / 2 + side * 0.15, b);
      const Fr = new Frame(mx, 0, mz, -b * D2R);
      stoneBox(B, Fr, 0, 0, bay / 2 + 0.02, Math.abs(rf - rc) / 2 + 0.55, g + colH, g + colH + 0.75, MARBLE, seed, 63);
      n++;
      if (!sunken && i % 5 === 2 && side === 1) engine.slots.banner.push({ pos: [x, g + colH - 0.05, z], facing: L.bearingOf(-x, -z), size: [0.9, 2.6], tag: 'columns city-avenue' });
    }
  }
  // palms / cypress on the median of the avenue (golden)
  if (!sunken) {
    const steps = Math.floor(((s.b1 - s.b0) * D2R * s.r) / 15);
    for (let i = 0; i < steps; i++) {
      const b = s.b0 + ((i + 0.5) * 15) / s.r / D2R;
      const [x, z] = L.polar(s.r, b);
      if (radials.some((q) => Math.abs(((b - q.b + 540) % 360) - 180) * D2R * s.r < q.hw + 4)) continue;
      if (plan.reservedAt(x, z, 2)) continue;
      engine.slots.palm.push({ pos: [x, heightAt(x, z) + 0.1, z], facing: rng.range(0, 360), size: rng.range(8.5, 12), tag: 'city-avenue' });
    }
  }
  void D;
  return n;
}

// ------------------------------------------------------------------ landmarks
function buildSite(B, site, rng, engine, sunken) {
  const F = new Frame(site.x, 0, site.z, site.rot);
  const g = heightAt(site.x, site.z);
  const seed = rng.random();
  const slots = sunken ? { ...engine.slots, banner: [], brazier: [], tree: [], urn: [] } : engine.slots;
  if (site.kind !== 'tower') stoneBox(B, F, 0, 0, site.w / 2, site.d / 2, g - 0.4, g + 0.16, PAVING, seed, 16 | 15);
  switch (site.kind) {
    case 'tholos': return tholos(B, F, { floorY: g + 1.0, groundY: g, r: rng.range(5.2, 7.6), seed });
    case 'temple': return temple(B, F, { floorY: g + 1.3, groundY: g, cols: rng.chance(0.6) ? 6 : 4, colH: rng.range(7, 9), peripteral: rng.chance(0.6), back: true, seed, slots });
    case 'hall': return domedHall(B, F, { w: Math.min(site.w - 4, 36), d: site.d - 10, floorY: g + 0.8, groundY: g, seed, slots }, rng);
    case 'palace': return palace(B, F, { floorY: g + 0.6, groundY: g, seed, w: Math.min(site.w - 2, 42), d: Math.min(site.d - 2, 30), slots, flat: rng.chance(0.7), tower: (TF, o) => goldTower(B, TF, { ...o, slots }) }, rng);
    case 'gym': return gymnasium(B, F, { w: Math.min(site.w, 62), d: Math.min(site.d, 44), floorY: g + 0.5, groundY: g, seed, slots });
    case 'arcade': return arcade(B, F, { len: site.w - 2, floorY: g + 0.4, groundY: g, seed, tiers: rng.chance(0.6) ? 2 : 1, bay: rng.range(5.5, 7) });
    case 'tower': return goldTower(B, F, { floorY: g + 0.2, groundY: g, hw: rng.range(3.2, 4.4), h: rng.range(20, 32), seed, slots });
  }
  return null;
}

// ------------------------------------------------------------------ sunken coral slots (r2 arch-b)
/**
 * Fewer, larger coral slots (marine places ~9k of ~29k): merge the city's slots per 9 m cell into one bigger
 * anchor (the largest, grown), then add vertical-face anchors low on the ruined house walls (outward normals).
 */
function thinCoral(engine, from, reg, rng, ground) {
  const all = engine.slots.coral;
  const mine = all.splice(from);
  const cell = 9, cells = new Map();
  for (const c of mine) {
    const k = Math.floor(c.pos[0] / cell) + ',' + Math.floor(c.pos[2] / cell) + ',' + (c.normal[1] > 0.5 ? 'u' : 's');
    const e = cells.get(k);
    if (!e) cells.set(k, { c, n: 1 }); else { e.n++; if (c.size > e.c.size) e.c = c; }
  }
  let up = 0;
  for (const { c, n } of cells.values()) {
    all.push({ ...c, size: Math.min(3.2, c.size * (1.15 + 0.12 * Math.min(4, n - 1))) });
    up++;
  }
  // vertical faces: one or two anchors on the outer walls of every ~third house, 0.4-1.6 m above the sand
  let side = 0;
  for (const h of reg.houses) {
    if (rng.random() > 0.34) continue;
    const nA = rng.random() < 0.3 ? 2 : 1;
    for (let k = 0; k < nA; k++) {
      const f = Math.floor(rng.random() * 4), u = rng.range(-0.8, 0.8);
      const c = Math.cos(h.rot), sn = Math.sin(h.rot);
      // local (lx, lz) → world, Frame convention: x' = x*cos + z*sin, z' = -x*sin + z*cos
      const [lx, lz, nx, nz] = f === 0 ? [u * h.hw, h.hd + 0.05, 0, 1] : f === 1 ? [u * h.hw, -h.hd - 0.05, 0, -1] : f === 2 ? [h.hw + 0.05, u * h.hd, 1, 0] : [-h.hw - 0.05, u * h.hd, -1, 0];
      const x = h.x + lx * c + lz * sn, z = h.z - lx * sn + lz * c;
      const wnx = nx * c + nz * sn, wnz = -nx * sn + nz * c;
      all.push({ pos: [x, Math.max(h.floorY, ground(x, z)) + rng.range(0.4, 1.6), z], normal: [wnx, 0, wnz], size: rng.range(0.8, 1.6), tag: 'city-wall-face' });
      side++;
    }
  }
  return { before: mine.length, up, side };
}

// ------------------------------------------------------------------ build
export async function build(engine) {
  const t0 = performance.now();
  const sunken = isSunken(engine);
  const q = engine.quality;
  const rng = new RNG('atl-city-v1');
  engine.slots.tree ||= [];
  engine.slots.coral ||= [];
  let ground = heightAt;
  if (sunken) { try { const m = await import('../terrain/sand.js'); if (m.sunkenGround) ground = m.sunkenGround; } catch (e) { /* terrain not present */ } }
  setRuin(sunken ? { ground, coral: engine.slots.coral, rubble: 1, colStand: 0.42 } : null);
  const T = {}; let tp = t0; const lap = (k) => { const n = performance.now(); T[k] = Math.round(n - tp); tp = n; };
  try {
    const coral0 = engine.slots.coral.length;
    const plan = new CityPlan(engine, rng.fork('plan'));
    // racecourse first (the plan keeps clear of it)
    const R = L.RACECOURSE, rRing = L.ringById(R.ring);
    const rc = (rRing.r0 + rRing.r1) / 2;
    const [hx, hz] = L.polar(rc, R.bearing);
    const hRot = -R.bearing * D2R;
    const hHW = (R.length - R.width) / 2 + R.width / 2 + 22 * 0.85 + 1.5, hHD = R.width / 2 + 22 * 0.85 + 7;
    plan.occ.add(hx, hz, hHW + 2, hHD + 2, hRot, 'racecourse');
    engine.footprints.addRect(hx, hz, hHW + 2, hHD + 2, hRot, 'racecourse');
    plan.run();
    lap('plan');

    const chunks = new ChunkSet(220);
    const reg = (engine.registry.city = { gardens: plan.gardens, houses: [], streets: [], landmarks: [], racecourse: null });
    // racecourse
    {
      const F = new Frame(hx, 0, hz, hRot);
      const g = heightAt(hx, hz);
      const ext = hippodrome(chunks.get(hx, hz), F, { length: R.length, width: R.width, floorY: g + 0.1, seed: 0.37, slots: sunken ? null : engine.slots });
      reg.racecourse = { x: hx, z: hz, rot: hRot, hw: ext.hw, hd: ext.hd, floorY: g + 0.1, length: R.length, width: R.width };
    }
    lap('racecourse');
    // landmarks
    const lr = rng.fork('sites');
    for (const site of plan.sites) {
      const res = buildSite(chunks.get(site.x, site.z), site, lr.fork(site.kind + site.x.toFixed(0)), engine, sunken);
      engine.footprints.addRect(site.x, site.z, site.w / 2, site.d / 2, site.rot, 'city-landmark');
      reg.landmarks.push({ kind: site.kind, x: site.x, z: site.z, rot: site.rot, hw: site.w / 2, hd: site.d / 2, top: res?.top ?? null, district: site.district });
      // cypress pairs flanking temples / tholoi (golden)
      if (!sunken && (site.kind === 'temple' || site.kind === 'tholos') && lr.chance(0.7)) {
        const F = new Frame(site.x, 0, site.z, site.rot);
        for (const sx of [-1, 1]) for (const fz of [0.2, -0.25]) {
          const [x, , z] = F.p(sx * (site.w / 2 - 1.2), 0, fz * site.d);
          engine.slots.tree.push({ pos: [x, heightAt(x, z), z], tag: 'cypress', size: lr.range(10, 15), source: 'city-landmark' });
        }
      }
    }
    // round forum around the fallen-head site (ref 8 background: banded columns in rows)
    {
      const B = chunks.get(FORUM.x, FORUM.z);
      const g = heightAt(FORUM.x, FORUM.z);
      const cam = SHOTS.find((s) => s.id === 8);
      const vd = [cam.target[0] - cam.pos[0], cam.target[2] - cam.pos[2]], vl = Math.hypot(...vd);
      const n = Math.round((2 * Math.PI * FORUM.r) / 4.6);
      let nF = 0;
      const okCol = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = FORUM.x + Math.cos(a) * FORUM.r, z = FORUM.z + Math.sin(a) * FORUM.r;
        const dx = x - cam.pos[0], dz = z - cam.pos[2], dd = Math.hypot(dx, dz);
        const cosA = (dx * vd[0] + dz * vd[1]) / (dd * vl);
        const hits = engine.footprints.query(x, z, 1.2).filter((it) => !['city', 'street', 'city-landmark', 'racecourse', 'city-garden'].includes(it.tag));
        okCol.push(!(dd < 13 || (dd < 30 && cosA > 0.93)) && !hits.length);
      }
      for (let i = 0; i < n; i++) {
        if (!okCol[i]) continue;
        const a = (i / n) * Math.PI * 2;
        const x = FORUM.x + Math.cos(a) * FORUM.r, z = FORUM.z + Math.sin(a) * FORUM.r;
        const F = new Frame(x, 0, z, -a);
        const gy = heightAt(x, z);
        stoneBox(B, F, 0, 0, 0.95, 0.95, gy - 0.6, gy + 0.9, 14, 0.52, 31);
        column(B, F, 0, 0, 0.68, 0.6, gy + 0.9, gy + 8.7, 14, 0.52, 13);
        column(B, F, 0, 0, 0.6, 0.86, gy + 8.7, gy + 9.4, 14, 0.52, MARBLE);     // echinus / capital bell
        stoneBox(B, F, 0, 0, 0.95, 0.95, gy + 9.4, gy + 10.0, MARBLE, 0.52, 63);
        // architrave toward the next column
        const a2 = ((i + 0.5) / n) * Math.PI * 2;
        const Fm = new Frame(FORUM.x + Math.cos(a2) * FORUM.r, 0, FORUM.z + Math.sin(a2) * FORUM.r, -a2);
        if (okCol[(i + 1) % n]) stoneBox(B, Fm, 0, 0, 0.8, (Math.PI * FORUM.r) / n + 0.45, gy + 10.0, gy + 11.1, MARBLE, 0.52, 63);
        nF++;
      }
      if (!sunken) {
        // paved plaza (radial slabs)
        const P = (r, t) => [FORUM.x + Math.cos(t) * r, g + 0.13, FORUM.z + Math.sin(t) * r];
        const rings = [0, 8, 16, 24, FORUM.r + 2];
        for (let k = 0; k < rings.length - 1; k++) {
          const m = Math.max(8, Math.round((2 * Math.PI * rings[k + 1]) / 5));
          for (let i = 0; i < m; i++) {
            const t0 = (i / m) * Math.PI * 2, t1 = ((i + 1) / m) * Math.PI * 2;
            const kind = k === 0 ? MARBLE : k === 1 ? 14 : k === 2 ? 10 : PAVING;
            const q4 = [P(rings[k], t0), P(rings[k], t1), P(rings[k + 1], t1), P(rings[k + 1], t0)];
            if (k === 0) triFacing(B.street, q4[0], q4[2], q4[3], [0, 1, 0], { aSt: [q4[0], q4[2], q4[3]].map((p) => [p[0], p[2], 0.71, kind]) });
            else quadFacing(B.street, q4[0], q4[1], q4[2], q4[3], [0, 1, 0], { aSt: q4.map((p) => [p[0], p[2], 0.71, kind]) });
          }
        }
      }
      reg.forum = { x: FORUM.x, z: FORUM.z, r: FORUM.r, plaza: FORUM.plaza, columns: nF };
      engine.footprints.addCircle(FORUM.x, FORUM.z, FORUM.r + 1.5, 'city-plaza');
    }
    lap('landmarks');
    // houses
    const slotsH = sunken ? { ...engine.slots, tree: [], banner: [], palm: [], urn: [] } : engine.slots;
    const ctxBase = { gardens: plan.gardens, occ: plan.occ, ground: heightAt, slots: slotsH };
    const D = Object.fromEntries(districts().map((d) => [d.id, d]));
    const ave = { l1: 370, l2: 690 };
    let nHouses = 0;
    for (const lot of plan.lots) {
      const d = D[lot.district];
      Object.assign(STYLE, d.style);
      const r = lot.r;
      const district = (x, z) => ({
        centre: lot.district === 'outer' ? Math.max(0, 0.5 - (r - d.r0) / 600) : Math.max(0, 1 - Math.abs(r - ave[lot.district]) / 45),
        harbour: Math.max(0, 1 - Math.min(r - d.r0, d.r1 - r) / 30),
        edge: lot.district === 'outer' ? Math.min(1, (r - d.r0) / 600) : 0,
      });
      const ctx = { ...ctxBase, district, B: chunks.get(lot.x, lot.z) };
      const hr = new RNG(Math.floor(lot.seed * 4294967296));
      const vols = buildHouse(ctx, lot, hr);
      for (const v of vols) { engine.footprints.addRect(v.x, v.z, v.hw + 0.3, v.hd + 0.3, v.rot, 'city'); reg.houses.push({ x: v.x, z: v.z, hw: v.hw, hd: v.hd, rot: v.rot, top: v.top, floorY: v.floorY, h: v.h, district: lot.district }); }
      nHouses++;
    }
    lap('houses');
    // r4: furniture of the land-ring parks (unbuilt lots, ring plan 'park'): kerbed beds, a few gold-domed garden kiosks
    // and round basins — gold glints among the green from the air (ref 1), real objects for the shot-5 foreground
    {
      const pr = rng.fork('parks');
      let nK = 0, nB = 0;
      for (const gd of plan.gardens) {
        if (gd.kind !== 'park' || gd.hw < 3 || gd.hd < 3) continue;
        const F = new Frame(gd.x, 0, gd.z, gd.rot), B = chunks.get(gd.x, gd.z);
        const g = heightAt(gd.x, gd.z);
        const seed = pr.random();
        const u = pr.random();
        const R = Math.min(gd.hw, gd.hd);
        if (u < 0.26 && R > 4.2 && !sunken) {
          // garden kiosk: 8 slender columns, entablature ring, ribbed gold dome + finial
          const kr = Math.min(R - 1.4, pr.range(2.6, 3.6)), kh = pr.range(3.4, 4.2), y0 = g + 0.45;
          ring(B, F, kr + 0.7, g - 0.3, y0, 16, seed, MARBLE);
          for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; column(B, F, Math.cos(a) * kr, Math.sin(a) * kr, 0.17, 0.14, y0, y0 + kh, 8, seed, MARBLE); }
          ring(B, F, kr + 0.3, y0 + kh, y0 + kh + 0.45, 16, seed, MARBLE);
          const top = goldDome(B.gold, F.p(0, y0 + kh + 0.42, 0), kr + 0.2, 0.95, 18, 6, 8);
          goldDome(B.gold, [gd.x, top - 0.05, gd.z], 0.28, 1.6, 8, 3, 0);
          engine.footprints.addCircle(gd.x, gd.z, kr + 1.2, 'city');
          nK++;
        } else if (u < 0.5 && R > 3.4) {
          // round basin with a gilt bowl on a stem (no water: the reflections of the bowl read as a fountain from afar)
          const br = Math.min(R - 1.2, pr.range(1.8, 2.8));
          ring(B, F, br, g - 0.2, g + 0.55, 20, seed, MARBLE);
          ring(B, F, br - 0.3, g - 0.2, g + 0.32, 20, seed, BLACK_STONE);
          if (!sunken) { column(B, F, 0, 0, 0.2, 0.16, g + 0.32, g + 1.5, 8, seed, MARBLE); goldDome(B.gold, F.p(0, g + 1.5, 0), 0.65, 0.45, 12, 3, 0); }
          engine.footprints.addCircle(gd.x, gd.z, br + 0.8, 'city');
          nB++;
        }
        // kerbed border (low marble kerb) along the street side
        stoneBox(B, F, 0, gd.hd + 0.35, gd.hw + 0.4, 0.18, g - 0.2, g + 0.32, MARBLE, seed, 1 | 16);
      }
      T.parks = { kiosks: nK, basins: nB };
    }
    // streets + colonnades
    const hc = Math.cos(hRot), hs = Math.sin(hRot);
    const inRace = (x, z) => { const dx = x - hx, dz = z - hz; return Math.abs(dx * hc - dz * hs) < hHW && Math.abs(dx * hs + dz * hc) < hHD; };
    const skip = (x, z) => inRace(x, z) || !!plan.reservedAt(x, z, 0) || plan.sites.some((st) => st.kind !== 'tower' && Math.abs((x - st.x) * Math.cos(st.rot) - (z - st.z) * Math.sin(st.rot)) < st.w / 2 && Math.abs((x - st.x) * Math.sin(st.rot) + (z - st.z) * Math.cos(st.rot)) < st.d / 2);
    let nSq = 0, nCols = 0;
    const cr = rng.fork('colonnades');
    for (const s of plan.streets) {
      if (s.kind === 'arc') { nSq += streetArc(chunks, plan, s, sunken, skip); if (s.avenue) nCols += avenueColonnade(chunks, plan, s, engine, cr, sunken); }
      else nSq += streetRadial(chunks, s, sunken, skip);
      reg.streets.push(s);
    }
    // street footprints (coarse) so vegetation keeps off the carriageways
    for (const s of plan.streets) {
      if (s.kind === 'radial') { const a = L.polar(s.r0, s.b), b = L.polar(s.r1, s.b); engine.footprints.addPath([a, b], s.hw, 'street'); }
      else {
        const n = Math.ceil(((s.b1 - s.b0) * D2R * s.r) / 24); const pts = [];
        for (let i = 0; i <= n; i++) pts.push(L.polar(s.r, s.b0 + ((s.b1 - s.b0) * i) / n));
        engine.footprints.addPath(pts, s.hw, 'street');
      }
    }
    lap('streets');
    // (garden courts / yards / orchards are published in registry.city.gardens: the vegetation module fills them)
    // meshes
    const gold = (await sharedGold()) || cityGoldMaterial();
    const mats = { plaster: plasterMaterial(), roof: terracottaMaterial(), stone: cityStoneMaterial(), street: cityStoneMaterial({ offset: true }), wood: cityWoodMaterial(), gold };
    const { meshes, tris } = chunks.meshes(mats);
    const group = new THREE.Group(); group.name = 'city';
    for (const m of meshes) group.add(m);
    engine.add(group);
    for (const m of meshes) if (m.name.startsWith('city-street')) { m.castShadow = false; }
    lap('meshes');
    if (sunken) { const r = thinCoral(engine, coral0, reg, rng.fork('coral'), ground); T.coral = r; }
    const ms = Math.round(performance.now() - t0);
    const kinds = {}; for (const s of plan.sites) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
    console.log(`[city] ${engine.era}: ${plan.lots.length} lots → ${nHouses} houses (${reg.houses.length} volumes), ${plan.sites.length} landmarks ${JSON.stringify(kinds)}, ${plan.streets.length} streets (${nSq} paving quads, ${nCols} avenue columns), ${plan.gardens.length} gardens, ${engine.slots.tree.length} tree slots, coral ${engine.slots.coral.length}, ${meshes.length} meshes, ${(tris / 1e6).toFixed(2)} M tris, gold=${gold.name === 'cityGold' ? 'local' : 'shared'}, ${ms} ms ${JSON.stringify(T)}`);
    console.log('[city] features ' + JSON.stringify(HOUSE_STATS));
  } finally {
    setRuin(null);
  }
}

// ------------------------------------------------------------------ isolated test scene
function testTerrain(engine) {
  // near-field patch of the real height function (rings, citadel, outer city edge) at 4 m
  const R = 2000, res = engine.quality.detail >= 1 ? 4 : 5;
  const n = Math.round((2 * R) / res);
  const geo = new THREE.PlaneGeometry(2 * R, 2 * R, n, n).rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, heightAt(x, z)); }
  geo.computeVertexNormals();
  const sunken = isSunken(engine);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  mat.userData.sunken = 'stone';
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nfloat th(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}\nfloat vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(th(i),th(i+vec2(1,0)),f.x),mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x),f.y);}')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 nn = normalize(cross(dFdx(vWP), dFdy(vWP)));
        float sl = 1.0 - abs(nn.y);
        float n = vn(vWP.xz*0.08)*0.6+vn(vWP.xz*0.5)*0.4;
        vec3 grass = mix(vec3(0.07,0.10,0.035), vec3(0.16,0.16,0.07), n);
        vec3 rock = vec3(0.45,0.42,0.37)*(0.8+0.3*vn(vWP.xz*0.3+vWP.y*0.2));
        vec3 c = mix(grass, rock, smoothstep(0.3,0.55,sl));
        c = mix(vec3(0.50,0.46,0.38), c, smoothstep(-0.5,1.5,vWP.y));
        ${sunken ? 'c = vec3(0.62,0.60,0.52) * (0.85 + 0.2 * n);' : ''}
        diffuseColor.rgb = c;`);
  };
  const m = new THREE.Mesh(geo, mat); m.name = 'cityTestTerrain';
  engine.add(m, { castShadow: false, receiveShadow: true });
  if (!sunken) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x0b4652, roughness: 0.06, metalness: 0.0 }));
    water.name = 'cityTestWater';
    engine.add(water, { castShadow: false, receiveShadow: true });
  }
}

export async function test(engine) {
  for (const c of engine.scene.children) if (c.name === 'testGround') c.visible = false;
  testTerrain(engine);
  await build(engine);
  const sun = isSunken(engine) ? { azimuth: 210, elevation: 58 } : { azimuth: 292, elevation: 14 };
  const reg = engine.registry.city;
  const views = [
    // 0: shot-1-like overview of the rings from the south
    { pos: [0, 520, 1450], target: [0, 0, 120], fov: 42, sun },
    // 1: shot-5-like: from the garden terrace (l2, bearing 135) across w2 to l1 and the citadel
    { pos: [404, 34, 408], target: [60, 20, 60], fov: 44, sun },
    // 2: l1 from above (south-east quarter), mid distance
    { pos: [420, 140, 330], target: [260, 14, 160], fov: 45, sun },
    // 3: racecourse
    { pos: [reg.racecourse.x + 260, 120, reg.racecourse.z + 180], target: [reg.racecourse.x, 10, reg.racecourse.z], fov: 45, sun },
    // 4: street level on the l2 avenue
    { pos: [L.polar(690, 300)[0], 11.7, L.polar(690, 300)[1]], target: [L.polar(690, 306)[0], 14, L.polar(690, 306)[1]], fov: 55, sun },
    // 5: outer city from the north-west, high
    { pos: [-1300, 420, -1700], target: [-300, 0, -900], fov: 45, sun },
    // 6: shot-8-like (sunken: ruins behind the fallen head)
    { pos: [160, 16.5, 400], target: [134, 15, 360], fov: 44, sun },
    // 7: shot-4-like (inner of w2 looking NNW)
    { pos: [505, 1.8, 140], target: [455, 16, -160], fov: 42, sun },
    // 9 (pushed below): shot-2-like canal view
    // 8: close-up of houses on l2
    { pos: [L.polar(600, 230)[0], 30, L.polar(600, 230)[1]], target: [L.polar(660, 240)[0], 10, L.polar(660, 240)[1]], fov: 50, sun },
  ];
  views.push({ pos: [-8, 2.6, 905], target: [0, 24, 600], fov: 44, sun });
  // 10: the round forum (fallen-head site) from above
  views.push({ pos: [reg.forum.x + 60, 45, reg.forum.z + 70], target: [reg.forum.x, 12, reg.forum.z], fov: 50, sun });
  return { views };
}
