// SHIPS: triremes and boats (golden), wrecks (sunken). OWNER: ships agent.
//   golden: hero trireme in the canal (shot 2, L.SHIPS.hero), fleets at sea (ref 1), in the canal (ref 2) and
//           the water rings (ref 5), triremes in the ship-sheds (ref 4: slots = rings plan sheds), small boats
//           along the quays; wakes → registry.water.addWake (fallback: own foam decals).
//   sunken: the trireme wreck under the gate bridge (L.WRECKS, ref 7) + wreck pieces in the rings / sheds;
//           pushes coral / kelp slots.
// registry.ships = { hero: {pos, heading, group}, ships: [{type, variant, pos, heading, scale, moving}], wrecks: [...],
//                    shipAt(x, z, r) → bool (something floating there), stats }
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { isSunken } from '../world/era.js';
import { SHOTS } from '../world/shots.js';
import { SEQUENCE, cameraAt } from '../video/sequence.js';
import { Fleet, Wakes, V, buildHero, shipMatrix, fwdOf, waterClear } from '../ships/fleet.js';
import { buildWreck, buildWreckPiece } from '../ships/wreck.js';
import { shipWoodMaterial, wreckWoodMaterial, sailMaterial } from '../ships/mats.js';

const D2R = Math.PI / 180;
const HERO_LEN = 0.84;
const HERO_SPEED = 2.5;      // r5: m/s the hero advances during its shot-2 segment (ref 2: rowing toward the camera)
const HERO_WAKE = 4.2;       // r5: wake / bow-wave strength (water: Kelvin V + bow spray scale with it; was 3.2)
// r6 (ref 1): the sea fleet is fewer, bigger ships (the painter draws them ≈ 2x the lighthouse-relative size) with plain
// cream / trident sails, and short broken wakes: addWake gets `trail` (m, e-fold length of the white trail astern) and
// `broken` (0..1 patchiness) — agreed with water (unset = the water module's own formula: hero, canal, rings)
const SEA_SCALE = 1.45;
const SEA_TRAIL = 1.3;       // × hull length
const SEA_BROKEN = 0.75;

// ------------------------------------------------------------------ r5 motion schedule
// Sailing ships advance along their heading during the golden video segments (src/video/sequence.js) and sit at their
// placed (= still) position exactly when the camera passes the reference framing (e = 0) of the segment's shot, so
// stills and the video's reference frame agree. Outside every golden segment window they rest at the placed position.
const easeInv = (ease, q) => {
  const f = { linear: (u) => u, inout: (u) => u * u * (3 - 2 * u), out: (u) => 1 - (1 - u) * (1 - u) }[ease] || ((u) => u);
  let a = 0, b = 1; for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (f(m) < q) a = m; else b = m; } return (a + b) / 2;
};
function goldenWindows() {
  const out = [];
  for (const g of SEQUENCE) {
    const shot = SHOTS.find((s) => s.id === g.shot);
    if (!shot || shot.era !== 'golden') continue;
    const [e0, e1] = g.range || [-0.5, 0.5];
    const u0 = Math.min(1, Math.max(0, easeInv(g.ease, -e0 / (e1 - e0 || 1))));
    out.push({ shot, seg: g, t0: g.time - 0.5, t1: g.time + g.dur + 0.5, tm: g.time + u0 * g.dur });
  }
  return out;
}
const WINDOWS = goldenWindows();
/** displacement (m along the heading) of a ship sailing at `speed` at engine time t */
export function sailDisp(t, speed) {
  for (const w of WINDOWS) if (t >= w.t0 && t <= w.t1) return speed * (t - w.tm);
  return 0;
}
const MAX_DISP_T = Math.max(1, ...WINDOWS.map((w) => Math.max(w.tm - w.t0, w.t1 - w.tm)));
// camera samples: every golden still + 25 samples along each golden segment path, with the time offset from the
// segment's reference instant (a sailing ship is tested where it IS at that instant: a space-time clearance)
const CAM_SAMPLES = [
  ...SHOTS.filter((s) => s.era === 'golden').map((s) => ({ dt: 0, p: s.pos, id: s.id })),
  ...WINDOWS.flatMap((w) => Array.from({ length: 25 }, (_, k) => {
    const u = k / 24;
    return { dt: w.seg.time + u * w.seg.dur - w.tm, p: cameraAt(w.shot, w.seg, u).pos, id: w.shot.id };
  })),
];
/** r6: is (x, y, z) inside the frame of still `id` (margin m: fraction of the half-width outside the edges) within maxD m? */
function inShotView(id, x, y, z, maxD, m = 0.15) {
  const s = SHOTS.find((q) => q.id === id); if (!s) return false;
  const f = [s.target[0] - s.pos[0], s.target[1] - s.pos[1], s.target[2] - s.pos[2]], fl = Math.hypot(...f); f[0] /= fl; f[1] /= fl; f[2] /= fl;
  const r = [-f[2], 0, f[0]], rl = Math.hypot(r[0], r[2]); r[0] /= rl; r[2] /= rl;
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const d = [x - s.pos[0], y - s.pos[1], z - s.pos[2]], dz = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  if (dz <= 0 || dz > maxD) return false;
  const t = Math.tan(s.fov * D2R / 2), nx = (d[0] * r[0] + d[2] * r[2]) / (dz * t * (1672 / 941)), ny = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / (dz * t);
  return Math.abs(nx) < 1 + m && Math.abs(ny) < 1 + m;
}
let SAND = null, STONE = null;
try { STONE = await import('../materials/stone.js'); } catch { /* shared stone not available */ }
try { SAND = (await import('../terrain/sand.js')).sunkenGround; } catch { /* terrain sand not available */ }

async function shedSlots(engine) {
  const reg = engine.registry.rings;
  if (reg?.sheds?.length) return reg.sheds;
  try { const { ringPlan } = await import('../rings/plan.js'); return ringPlan().sheds || []; } catch { /* rings plan not available */ }
  // own fallback from the layout: 15 m pitch along the shed faces, opening toward the water
  const out = [];
  for (const s of L.SHIP_SHEDS) {
    const g = L.ringById(s.ring), inner = s.face === 'inner', R = inner ? g.r0 - 0.35 : g.r1 + 0.35, side = inner ? -1 : 1;
    const pd = 15 / R / D2R;
    for (let b = s.bearings[0] + pd / 2; b < s.bearings[1]; b += pd) {
      const [x, z] = L.polar(R + side * 14, b);
      out.push({ pos: [x, 0, z], bearing: b, facing: (b + (side > 0 ? 0 : 180)) % 360, width: 10.5, depth: 14, ring: s.ring });
    }
  }
  return out;
}
async function quayPlan() { try { const { ringPlan } = await import('../rings/plan.js'); const p = ringPlan(); return { quays: p.quays || [], edges: p.edges || [], canal: p.canal }; } catch { return null; } }

/** sunken-era ground (sand if the terrain module publishes it) */
function groundAt(engine, x, z) {
  const t = engine.registry.terrain;
  const f = t?.sunkenGround || t?.groundAt || SAND;
  if (f) { const v = f(x, z); if (Number.isFinite(v)) return v; }
  const h = heightAt(x, z), zone = L.zoneAt(x, z);
  if ((zone === 'w1' || zone === 'w2' || zone === 'w3' || (Math.abs(x) < L.SEA_CANAL.width / 2 && z > 300 && z < 1060)) && h < L.SUNKEN.sandLevelRings) return L.SUNKEN.sandLevelRings + (h - L.SUNKEN.sandLevelRings) * 0.15;
  return h;
}

export async function build(engine) {
  const t0 = performance.now();
  const reg = engine.registry.ships = { ships: [], wrecks: [], stats: {} };
  if (isSunken(engine)) { buildSunken(engine, reg); }
  else await buildGolden(engine, reg);
  reg.stats.ms = Math.round(performance.now() - t0);
  console.log(`[ships] built in ${reg.stats.ms} ms (${engine.era}): ${JSON.stringify(reg.stats)}`);
}

// ------------------------------------------------------------------ golden
async function buildGolden(engine, reg) {
  const rng = engine.rng('ships');
  const dens = engine.quality.density;
  const fleet = new Fleet(engine), wakes = new Wakes(engine);
  const placed = [];
  // r3 (director): nothing moored / sailing within 25 m of a golden camera (shot 4 sits 14 m off the l1 shed face)
  // r5: ALL golden cameras (r4 excluded shot 2 → a scatter trireme sat in front of the shot-2 lens at high density) and
  //     the whole segment path of each shot; a sailing ship is tested where it is at each instant of the segment.
  //     Height counts only beyond the rig (|eye − 6| > 8 m): the shot-1 aerial never clears the sea below it.
  const camClear = (x, z, r, hd = 0, sp = 0) => {
    const [fx, fz] = fwdOf(hd);
    return CAM_SAMPLES.every(({ dt, p }) => Math.hypot(p[0] - (x + fx * sp * dt), p[2] - (z + fz * sp * dt), Math.max(0, Math.abs(p[1] - 6) - 8)) > 25 + r);
  };
  const clear = (x, z, r, hd = 0, sp = 0) => placed.every((p) => Math.hypot(p[0] - x, p[1] - z) > p[2] + r) && camClear(x, z, r * 0.5, hd, sp);
  // a sailing ship must stay in open water over its whole run (± the longest half-window of travel)
  const runClear = (x, z, hd, sp, Lh, hw, depth) => {
    if (!sp) return true;
    const [fx, fz] = fwdOf(hd), D = sp * MAX_DISP_T;
    return waterClear(x + fx * D, z + fz * D, hd, Lh, hw, depth) && waterClear(x - fx * D, z - fz * D, hd, Lh, hw, depth);
  };
  let nMoving = 0;
  const put = (variant, x, z, heading, o = {}) => {
    const s = o.scale ?? 1;
    const m = shipMatrix(x, o.y ?? 0, z, heading, o.heel ?? 0, o.pitch ?? 0, s);
    placed.push([x, z, (o.r ?? 18) * s]);
    reg.ships.push({ variant, pos: [x, o.y ?? 0, z], heading, scale: s, moving: !!o.speed, speed: o.speed || 0 });
    const [fx, fz] = fwdOf(heading);
    if (o.speed) {
      const bowOff = (o.bow ?? 20.5) * s, bx = x + fx * bowOff, bz = z + fz * bowOff;
      const w = { pos: [bx, bz], heading, length: (o.len ?? 38) * s, beam: (o.beam ?? 5.4) * s, speed: o.speed, oars: !!o.oars, prio: o.prio || 1, id: 'ship' + reg.ships.length };
      if (o.sea) { w.trail = SEA_TRAIL * w.length; w.broken = SEA_BROKEN; }
      wakes.add(w);
      // r5: sails along its heading during the video segments; the wake (water API handle) follows the bow
      if (o.hold) fleet.add(variant, V[variant], m);
      else { fleet.addMoving(variant, V[variant], m, [fx, fz], o.speed, (d) => w.handle?.update({ pos: [bx + fx * d, bz + fz * d] })); nMoving++; }
    } else fleet.add(variant, V[variant], m);
  };

  // ---- hero (shot 2)
  // r3: the hero hull a little shorter (ref 2 shows a compact trireme: the bow was cut by the shot-2 frame edge)
  // r5: the hero advances along the canal (toward the camera) during its segment: HERO_SPEED m/s, at L.SHIPS.hero when
  //     the shot-2 camera passes the reference framing; its wake follows the bow (water API handle).
  const [hfx, hfz] = fwdOf(L.SHIPS.hero.heading), heroBow = 20.5 * HERO_LEN;
  const heroWake = { pos: [L.SHIPS.hero.pos[0] + hfx * heroBow, L.SHIPS.hero.pos[2] + hfz * heroBow], heading: L.SHIPS.hero.heading, length: 38 * HERO_LEN, beam: 5.6, speed: HERO_WAKE, oars: true, prio: 100, id: 'hero' };
  let heroD = 0;
  const H = {
    ...L.SHIPS.hero, lengthScale: HERO_LEN,
    dispAt: (t) => sailDisp(t, HERO_SPEED),
    onMove: (d) => { if (d === heroD) return; heroD = d; heroWake.handle?.update({ pos: [heroWake.pos[0] + hfx * d, heroWake.pos[1] + hfz * d] }); },
  };
  const hero = buildHero(engine, H);
  engine.add(hero.group);
  placed.push([H.pos[0], H.pos[2], 22]);
  // registry.ships.hero: pos / heading at the reference instant; offsetAt(t) → [dx, dz] world offset at engine time t
  // (water: move the bow spray with it), bowAt(t) → [x, z] of the stem at t
  reg.hero = {
    pos: H.pos, heading: H.heading, group: hero.group, speed: HERO_SPEED, wakeSpeed: HERO_WAKE, fwd: [hfx, hfz],
    offsetAt: (t) => { const d = sailDisp(t, HERO_SPEED); return [hfx * d, hfz * d]; },
    bowAt: (t) => { const d = sailDisp(t, HERO_SPEED); return [heroWake.pos[0] + hfx * d, heroWake.pos[1] + hfz * d]; },
  };
  reg.sailDisp = sailDisp;
  wakes.add(heroWake);

  // ---- canal (ref 2 background: ships beyond the gate bridge; ref 1: ships between the moles)
  // r6 (ref 2: a busy canal seen through the gate-bridge arch): the ship between the hero and the bridge (16, 760) hid
  //     the right bridge pier + its gold relief → gone; instead 4 more under sail beyond the bridge (z 430-655, |x| ≤ 24:
  //     inside the arch view from the shot-2 camera), mixed headings (sterns / bows), sizes 45-80 px
  const canalShips = [
    ['sailRow', 15, 640, 182, 2.5], ['sailOnly', -15, 590, 4, 2.0], ['sailRowB', 10, 520, 178, 2.6], ['row', -18, 470, 0, 2.2],
    ['sailOnly', 23, 560, 184, 2.0], ['boatSail', -24, 655, 178, 1.4], ['sailRow', 4, 430, 181, 2.4],
    ['merchant', -22, 535, 2, 1.8],
  ];
  for (const [v, x, z, h, sp] of canalShips) {
    const m = v.startsWith('merchant'), bt = v.startsWith('boat'), Lr = m ? 20 : bt ? 9 : 38, hw = m ? 3.5 : bt ? 1.5 : 5.5;
    if (clear(x, z, m ? 10 : bt ? 6 : 16, h, sp) && waterClear(x, z, h, Lr, hw, -2) && runClear(x, z, h, sp, Lr, hw, -2)) put(v, x, z, h, { speed: sp, oars: !m && !bt && v !== 'sailOnly', heel: v.startsWith('sail') ? 0.02 : m || bt ? 0.04 : 0, prio: 3, r: m ? 10 : bt ? 5 : 18, bow: m ? 10.2 : bt ? 4.2 : 20.5, len: Lr === 38 ? 38 : m ? 19 : 8, beam: m ? 5.6 : bt ? 2.2 : 5.4 });
    else console.warn(`[ships] canal ship ${v} at ${x},${z} rejected`);
  }

  // ---- sea fleet (ref 1): a few fixed ones around the canal mouth (in every framing of shot 1), then a scatter
  // r6: ref-1 sizes (SEA_SCALE) and cream sails; boats a little bigger too (they read as specks); the two canal-mouth
  //     ships (r5: canal list, furled 'row' at 18, 975) are sea ships now
  for (const [v, x, z, h, sp] of [['seaA', 4, 985, 2, 3.2], ['seaB', -6, 1075, 178, 2.8], ['seaB', -140, 955, 24, 3.0], ['seaOnly', 215, 935, 338, 2.6], ['seaB', -120, 870, 168, 3.4], ['merchant', 300, 965, 195, 2.0], ['boatSail', 120, 900, 330, 1.4]]) {
    const m = v.startsWith('merchant'), b = v.startsWith('boat'), sc = m ? 1.3 : b ? 1.2 : SEA_SCALE;
    const Lr = (m ? 20 : b ? 9 : 42) * sc, hw = (b ? 2 : 6) * sc;
    if (clear(x, z, 20 * sc, h, sp) && waterClear(x, z, h, Lr, hw, -3) && runClear(x, z, h, sp, Lr, hw, -3)) put(v, x, z, h, { speed: sp, oars: !m && !b && v !== 'seaOnly', heel: 0.03, r: m ? 10 : b ? 5 : 18, bow: m ? 10.2 : b ? 4.2 : 20.5, len: m ? 19 : b ? 8 : 38, beam: m ? 5.6 : b ? 2.2 : 5.4, prio: 2, scale: sc, sea: true });
  }
  const nSea = Math.round(12 + 6 * dens);
  const mouth = [0, 1060];
  for (let i = 0, n = 0; i < 400 && n < nSea; i++) {
    // r4 (director): the r4 shot-1 camera sees the sea between the l2 wall (z ≈ 800) and z ≈ 1000 (|x| < 340) — the fleet goes there
    const near = n < nSea * 0.85;
    const x = near ? rng.range(-360, 360) : rng.range(-950, 950), z = near ? 835 + rng.random() * 175 : rng.range(1050, 1500);
    if (Math.hypot(x, z - 1060) < 90) continue;
    const toMouth = (Math.atan2(mouth[0] - x, -(mouth[1] - z)) / D2R + 360) % 360;
    // r6 (ref 1): nearly every ship sails toward / away from the camera (sails broad to the lens, V wakes), few crossing
    const hq = rng.random();
    const hd = (hq < 0.5 ? toMouth + rng.range(-25, 25) : hq < 0.88 ? rng.range(150, 210) : (rng.chance(0.5) ? 0 : 180) + rng.range(-60, 60) + 360) % 360;
    const r = rng.random();
    const type = r < 0.72 ? 'tri' : r < 0.88 ? 'merchant' : 'boat';
    const sc = type === 'tri' ? SEA_SCALE * rng.range(0.92, 1.06) : type === 'merchant' ? 1.3 : 1.2;
    const hw = (type === 'tri' ? 8 : 4) * sc;
    // r5: tested at the type's top speed along its heading (space-time camera clearance + open water over the run)
    const spMax = type === 'tri' ? 4.5 : type === 'merchant' ? 2.8 : 2.0, Lr = (type === 'tri' ? 42 : 20) * sc;
    if (!clear(x, z, (type === 'tri' ? 42 : 28) * sc, hd, spMax) || !waterClear(x, z, hd, Lr, hw, -4) || !runClear(x, z, hd, spMax, Lr, hw, -4)) continue;
    if (L.MOLES.some((mo) => Math.hypot(x - mo.lighthouse[0], z - mo.lighthouse[1]) < 45 + 10 * sc)) continue;
    if (type === 'tri') {
      const v = rng.pick(['seaA', 'seaB', 'seaA', 'seaOnly', 'seaB']);
      put(v, x, z, hd, { speed: rng.range(2.5, 4.5), oars: v !== 'seaOnly', heel: rng.range(0.02, 0.05), scale: sc, sea: true });
    } else if (type === 'merchant') {
      put('merchant', x, z, hd, { speed: rng.range(1.5, 2.8), heel: rng.range(0.03, 0.06), r: 10, bow: 10.2, len: 19, beam: 5.6, scale: sc, sea: true });
    } else {
      put(rng.chance(0.5) ? 'boatSail' : 'boatSailB', x, z, hd, { speed: rng.range(1.0, 2.0), heel: rng.range(0.03, 0.07), r: 5, bow: 4.2, len: 8, beam: 2.2, scale: sc, sea: true });
    }
    n++;
  }

  // ---- shot 5 (ref 5): two triremes under sail in water ring 1 below the garden terrace — placed in the shot camera
  {
    const s5 = SHOTS.find((s) => s.id === 5);
    if (s5) {
      const f = [s5.target[0] - s5.pos[0], s5.target[2] - s5.pos[2]], fl = Math.hypot(f[0], f[1]); f[0] /= fl; f[1] /= fl;
      const camH = (Math.atan2(f[0], -f[1]) / D2R + 360) % 360;
      // r6: both sail AWAY to the left (ref 5: wakes trail to the right, sterns toward the camera-right), tangential to
      //     the ring, yards braced so the sails face the camera; the second one (r5: rejected, its heading cut the
      //     citadel quay) now sits at the ref's px ≈ 645, 520 (ref 690, 545), the first at ≈ 920, 590 (ref 925, 645)
      for (const [dist, ang, rel, v, sc] of [[92, 6, 312, 'braced5a', 0.85], [128, -13, 300, 'braced5b', 0.8]]) {
        const a = (camH + ang) * D2R, x = s5.pos[0] + Math.sin(a) * dist, z = s5.pos[2] - Math.cos(a) * dist;
        const hd = (camH + rel) % 360;
        if (!(L.zoneAt(x, z) === 'w1' && waterClear(x, z, hd, 38, 6, -2))) { console.warn(`[ships] shot-5 trireme at ${x.toFixed(0)},${z.toFixed(0)} rejected (not in open w1 water)`); continue; }
        // r5: they sail through the shot-5 segment unless the straight run would leave open water (then: under way, held)
        const run = runClear(x, z, hd, 2.6, 38, 6, -2);
        if (!run) console.warn(`[ships] shot-5 trireme at ${x.toFixed(0)},${z.toFixed(0)} held (run leaves open water)`);
        put(v, x, z, hd, { speed: 2.6, oars: true, heel: 0.025, prio: 6, scale: sc, hold: !run });
      }
    }
  }

  // ---- water rings (ref 5 shows two triremes under sail in ring 2 below the garden terrace)
  const ringSets = [
    { ring: 'w1', n: Math.round(3 + 2 * dens), forced: [] },
    { ring: 'w2', n: Math.round(6 + 4 * dens), forced: [[148, 492, 1], [133, 518, -1]] },
    { ring: 'w3', n: Math.round(4 + 2 * dens), forced: [] },
  ];
  const bridgeBear = (ring) => (L.RING_BRIDGES.find((b) => b.ring === ring)?.bearings || []);
  for (const rs of ringSets) {
    const g = L.ringById(rs.ring), rc = (g.r0 + g.r1) / 2, half = (g.r1 - g.r0) / 2;
    const tries = rs.forced.map(([b, r, dir]) => ({ b, r, dir, forced: true }));
    for (let i = 0; i < 120; i++) tries.push({ b: rng.range(0, 360), r: rc + rng.range(-0.45, 0.45) * half, dir: rng.sign() });
    let n = 0;
    for (const tr of tries) {
      if (n >= rs.n + rs.forced.length) break;
      if (rs.ring === 'w3' && L.inSeaSector(tr.b)) continue;
      const bb = bridgeBear(rs.ring);
      if (bb.some((b) => Math.abs(((tr.b - b + 540) % 360) - 180) * D2R * tr.r < 45)) continue;
      if (rs.ring === 'w1' && Math.abs(((tr.b - 180 + 540) % 360) - 180) * D2R * tr.r < 50) continue;
      const [x, z] = L.polar(tr.r, tr.b);
      // r6: ref 5 shows exactly two triremes in w1 (placed above): no random ring ship in / at the edge of the shot-5 frame
      if (!tr.forced && rs.ring === 'w1' && (inShotView(5, x, 4, z, 220, 0.35) || inShotView(5, x, 12, z, 220, 0.35))) continue;
      const hd = (tr.b + 90 * tr.dir + 360) % 360;   // tangential
      if (!clear(x, z, 30, hd, 3) || !waterClear(x, z, hd, 40, 7, -2.5) || !runClear(x, z, hd, 3, 40, 7, -2.5)) continue;
      const moored = !tr.forced && rng.chance(0.25);
      if (moored) put('moored', x, z, hd, {});
      else {
        const v = tr.forced ? 'sailRow' : rng.pick(['sailRow', 'sailOnly', 'row', 'sailRowB', 'boatSail']);
        const boat = v.startsWith('boat');
        put(rs.ring === 'w3' && !tr.forced ? 'far' : v, x, z, hd, { speed: boat ? 1.5 : rng.range(1.8, 3), oars: v !== 'sailOnly' && !boat, heel: v.startsWith('sail') ? 0.02 : 0, r: boat ? 5 : 18, bow: boat ? 4.2 : 20.5, len: boat ? 8 : 38, beam: boat ? 2.2 : 5.4, prio: tr.forced ? 4 : 1 });
      }
      n++;
    }
  }

  // ---- ship-sheds (ref 4): bow out through the arch, eye at the opening, sail hanging loose
  const sheds = await shedSlots(engine);
  let nShed = 0;
  for (const s of sheds) {
    // r3: per-shed deterministic fill (independent of the other placements' rng use); every shed near shot 4 is filled
    const h = Math.abs(Math.sin(s.pos[0] * 12.9898 + s.pos[2] * 78.233) * 43758.5453) % 1;
    const s4 = SHOTS.find((q) => q.id === 4)?.pos;
    if (!(h < 0.88 || (s4 && Math.hypot(s.pos[0] - s4[0], s.pos[2] - s4[2]) < 140))) continue;
    const hd = s.facing, [fx, fz] = fwdOf(hd), sc = 0.9;
    const off = 0.4 - 15.0 * sc;    // ship origin behind the opening: the eye at the arch front, stem + ram outside
    const x = s.pos[0] + fx * off, z = s.pos[2] + fz * off;
    // keep the lens clear (shot 4 sits 14 m off the shed face): only the bow tip is tested, at 14 m — ref 4 shows the
    // sheds filled right up to the frame edge, so the 25 m ring-ship clearance does not apply inside the sheds
    const bx = x + fx * 20.5 * sc, bz = z + fz * 20.5 * sc;
    // r5: still cameras keep the r3 14 m bow-tip clearance; along the segment paths only intersection matters (8 m)
    const stillOK = SHOTS.every((q) => q.era !== 'golden' || Math.hypot(q.pos[0] - bx, q.pos[2] - bz, Math.max(0, Math.abs(q.pos[1] - 6) - 8)) > 14);
    const pathOK = CAM_SAMPLES.every(({ p }) => Math.hypot(p[0] - bx, p[2] - bz, Math.max(0, Math.abs(p[1] - 6) - 8)) > 8);
    if (!stillOK || !pathOK) continue;
    const m = shipMatrix(x, 0.0, z, hd, 0, 0, sc);
    fleet.add('shed', V.shed, m);
    reg.ships.push({ variant: 'shed', pos: [x, 0, z], heading: hd, scale: sc, shed: s.index ?? nShed });
    nShed++;
  }

  // ---- small boats moored along the quays (rings plan) and the canal
  const qp = await quayPlan();
  let nBoats = 0;
  const boatVar = () => rng.pick(['boat', 'boat', 'boatOpen', 'boatSail']);
  if (qp) {
    for (const q of qp.quays) {
      const e = qp.edges.find((ed) => ed.id === q.edge); if (!e) continue;
      const R = e.faceR + e.side * ((q.width || 4.5) + 1.8);
      const step = 13 / R / D2R;
      for (let b = q.b0 + step / 2; b < q.b1; b += step) {
        if (!(rng.random() < 0.42 * (0.6 + 0.4 * dens))) continue;
        const [x, z] = L.polar(R, b);
        const hd = (b + 90 * rng.sign() + 360) % 360 + rng.range(-4, 4);
        if (!clear(x, z, 5) || !waterClear(x, z, hd, 9, 1.5, -1.2)) continue;
        put(boatVar(), x, z, hd, { r: 5 }); nBoats++;
      }
    }
    if (qp.canal) {
      const c = qp.canal, xq = c.faceX - (c.quayW || 5.5) - 1.6;
      for (const sd of [-1, 1]) for (let z = c.z0 + 8; z < c.z1 - 4; z += 12) {
        if (Math.abs(z - L.GATE_BRIDGE.z) < 40) continue;
        if (!(rng.random() < 0.4 * (0.6 + 0.4 * dens))) continue;
        const x = sd * xq, hd = rng.chance(0.5) ? 0 : 180;
        if (!clear(x, z, 5) || !waterClear(x, z, hd, 9, 1.5, -1.2)) continue;
        put(boatVar(), x, z, hd + rng.range(-3, 3), { r: 5 }); nBoats++;
      }
    }
  }
  // along the moles (outer faces), a few boats at anchor
  for (const mo of L.MOLES) for (let z = mo.from[1] + 20; z < mo.to[1] - 15; z += 16) {
    if (!(rng.random() < 0.35)) continue;
    const x = mo.from[0] + mo.side * 15.5;
    if (!clear(x, z, 5) || !waterClear(x, z, 0, 9, 1.5, -1.5)) continue;
    put(boatVar(), x, z, rng.chance(0.5) ? 0 : 180, { r: 5 }); nBoats++;
  }

  engine.add(fleet.finalize());
  const camPos = SHOTS.filter((s) => s.era === 'golden').map((s) => s.pos);
  const wk = wakes.commit(camPos);
  fleet.update(engine.time, sailDisp);
  engine.onUpdate((t) => fleet.update(t, sailDisp));
  reg.shipAt = (x, z, r = 0) => !clear(x, z, r);
  reg.stats = { hero: Math.round(hero.tris), fleetShips: fleet.count, moving: nMoving, sheds: nShed, boats: nBoats, variants: fleet.variants.size, fleetTris: Math.round(fleet.tris), wakes: wk };
}

// ------------------------------------------------------------------ sunken
function buildSunken(engine, reg) {
  const rng = engine.rng('ships-sunken');
  const b = new THREE.Group(); b.name = 'ships-wrecks';
  const mat = wreckWoodMaterial();
  const coral = engine.slots.coral, kelp = engine.slots.kelp;
  let tris = 0;
  const addWreck = (geoB, x, z, heading, roll, pitch, sink, coralLocal, scale = 1) => {
    const y = groundAt(engine, x, z) + sink;
    const m = shipMatrix(x, y, z, heading, roll, pitch, scale);
    const mesh = new THREE.Mesh(geoB.toGeometry(), mat);
    mesh.applyMatrix4(m);
    mesh.name = 'ships-wreck'; mesh.castShadow = true; mesh.receiveShadow = true;
    b.add(mesh);
    tris += mesh.geometry.index.count / 3;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m), n = new THREE.Vector3();
    for (const c of coralLocal || []) {
      v.set(...c.pos).applyMatrix4(m); n.set(...c.normal).applyMatrix3(nm).normalize();
      coral.push({ pos: [v.x, v.y, v.z], normal: [n.x, n.y, n.z], size: c.size, tag: 'wreck' });
    }
    reg.wrecks.push({ pos: [x, y, z], heading, scale });
    return m;
  };
  // hero wreck (ref 7): bow raised, listing, half buried in the canal sand under the gate bridge
  L.WRECKS.forEach((W0, i) => {
    const o = i === 0 && L.SHIPS?.wreck ? L.SHIPS.wreck : null;
    const W = { pos: o ? [o.pos[0], W0.pos[1], o.pos[1]] : W0.pos, heading: o?.heading ?? W0.heading, length: W0.length };
    const s = W.length / 37;
    const r = buildWreck({ seed: 0.71, bowKeep: 0.32, splay: 0.25, detail: 1 });
    const m = addWreck(r.wood, W.pos[0], W.pos[2], W.heading, o?.roll ?? 0.2, o?.pitch ?? 0.09, o?.lift ?? -0.6, r.coral, s);
    // rubble mound (fallen blocks and column drums) carrying the raised bow
    b.add(rubbleMound(engine, m, rng, coral));
    for (let k = 0; k < 6; k++) { const a = rng.range(0, Math.PI * 2), d = rng.range(10, 22); const kx = W.pos[0] + Math.cos(a) * d, kz = W.pos[2] + Math.sin(a) * d; kelp.push({ pos: [kx, groundAt(engine, kx, kz), kz], facing: 0, size: 1, tag: 'wreck' }); }
  });
  // more wreck pieces around the rings and the canal
  const spots = [];
  for (const [ring, n] of [['w1', 2], ['w2', 3], ['w3', 2]]) {
    const g = L.ringById(ring), rc = (g.r0 + g.r1) / 2;
    for (let i = 0, k = 0; i < 60 && k < n; i++) {
      const bb = rng.range(0, 360); if (ring === 'w3' && L.inSeaSector(bb)) continue;
      const [x, z] = L.polar(rc + rng.range(-0.3, 0.3) * (g.r1 - g.r0), bb);
      if (heightAt(x, z) > -4) continue;
      spots.push([x, z, rng.range(0, 360), rng.chance(0.35)]); k++;
    }
  }
  spots.push([20, 600, 15, false], [-22, 930, 170, true]);
  for (const [x, z, hd, full] of spots) {
    if (full) { const r = buildWreck({ seed: rng.random(), bowKeep: rng.range(0.1, 0.25), splay: rng.range(0.25, 0.5), detail: 0.5 }); addWreck(r.wood, x, z, hd, rng.range(-0.4, 0.4), rng.range(-0.05, 0.08), -0.9, r.coral, rng.range(0.8, 1)); }
    else { const r = buildWreckPiece({ seed: rng.random() }); addWreck(r.wood, x, z, hd, rng.range(-0.3, 0.3), 0, -0.35, [{ pos: [0, 0.6, 0], normal: [0, 1, 0], size: 0.5 }]); }
  }
  engine.add(b);
  reg.stats = { wrecks: reg.wrecks.length, tris: Math.round(tris) };
}

/** fallen blocks / drums under the wreck's raised bow (local ship frame z 6..19), stone material, coral slots on top */
function rubbleMound(engine, m, rng, coral) {
  const geo = [];
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  const blocks = [];
  for (let i = 0; i < 14; i++) {
    const z = rng.range(6, 18.5), x = rng.range(-1.8, 1.8);
    v.set(x, -0.3, z).applyMatrix4(m);
    const g0 = groundAt(engine, v.x, v.z);
    const drum = rng.chance(0.25);
    const s = drum ? rng.range(0.5, 0.75) : rng.range(0.45, 0.9);
    // fallen ashlar blocks (some broken: chamfered) and column drums
    const bg = drum ? new THREE.CylinderGeometry(s, s, rng.range(1.0, 1.6), 16) : new THREE.BoxGeometry(s * rng.range(1.6, 2.4), s * rng.range(0.8, 1.1), s * rng.range(1.0, 1.4));
    if (!drum) { const p = bg.attributes.position; for (let k = 0; k < p.count; k++) { const cx = p.getX(k), cy = p.getY(k), cz = p.getZ(k); const chip = 0.12 * s * Math.sin(cx * 5.1 + i * 1.7) * Math.cos(cz * 4.3 - i); p.setXYZ(k, cx + chip, cy + chip * 0.6, cz - chip); } bg.computeVertexNormals(); }
    // stack up to the keel line of the bow
    const keelY = new THREE.Vector3(x * 0.2, -0.6, z).applyMatrix4(m).y;
    const top = Math.max(g0 + s * 0.6, Math.min(keelY - 0.2, g0 + 3.2));
    const y = top - (drum ? s : s * 0.8);
    e.set(drum ? rng.range(1.2, 1.9) : rng.range(0, 3), rng.range(0, 6.3), drum ? rng.range(-0.3, 0.3) : rng.range(0, 3)); q.setFromEuler(e);
    bg.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(v.x, y, v.z), q, sc.set(1, 1, 1)));
    (drum ? geo : blocks).push(bg);
    if (rng.chance(0.6)) coral.push({ pos: [v.x, top, v.z], normal: [0, 1, 0], size: s * 0.8, tag: 'wreck-rubble' });
  }
  const g = new THREE.Group(); g.name = 'ships-wreck-rubble';
  const mats = STONE ? [STONE.limestone({ weather: 0.9, seed: 7 }), STONE.whiteStone({ weather: 0.9, seed: 3 })] : [new THREE.MeshStandardMaterial({ color: 0x8a8274, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: 0x9a7a6a, roughness: 0.9 })];
  for (const mm of mats) mm.userData.sunken ||= 'stone';
  for (const [list, mat] of [[blocks, mats[0]], [geo, mats[1]]]) {
    if (!list.length) continue;
    const merged = mergeGeos(list);
    const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
  }
  return g;
}
function mergeGeos(list) {
  let n = 0, ni = 0; for (const g of list) { const gg = g.index ? g : g; n += gg.attributes.position.count; ni += gg.index ? gg.index.count : gg.attributes.position.count; }
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), idx = new Uint32Array(ni);
  let o = 0, oi = 0;
  for (const g of list) {
    const p = g.attributes.position, nn = g.attributes.normal, c = p.count;
    pos.set(p.array.subarray(0, c * 3), o * 3); nrm.set(nn.array.subarray(0, c * 3), o * 3);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[oi++] = g.index.array[i] + o; } else for (let i = 0; i < c; i++) idx[oi++] = o + i;
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ------------------------------------------------------------------ test scene
export async function test(engine) {
  const sunken = isSunken(engine);
  const wm = shipWoodMaterial(), sm = sailMaterial();
  if (!sunken) {
    const H = { pos: [0, 0, 0], heading: 185, heel: 0.015 };
    const hero = buildHero(engine, H);
    engine.add(hero.group);
    // variant lineup
    const keys = ['sailRow', 'sailOnly', 'row', 'moored', 'shed', 'far', 'merchant', 'boatSail', 'boat'];
    keys.forEach((k, i) => {
      const r = V[k]();
      for (const [B, M] of [[r.wood, wm], [r.sail, sm]]) {
        if (!B || B.empty) continue;
        const mesh = new THREE.Mesh(B.toGeometry(), M);
        mesh.applyMatrix4(shipMatrix(-60 - i * 18, 0, -80, 90));
        engine.add(mesh);
      }
    });
  }
  const r = buildWreck({ seed: 0.71, bowKeep: 0.32, splay: 0.25 });
  const mesh = new THREE.Mesh(r.wood.toGeometry(), sunken ? wreckWoodMaterial() : wreckWoodMaterial());
  mesh.applyMatrix4(shipMatrix(80, 0.5, 0, 204, -0.15, 0.14));
  engine.add(mesh);
  return {
    views: [
      { pos: [8, 2.6, 43], target: [8.26, 4.31, 33], fov: 44, sun: { azimuth: 292, elevation: 12 } }, // 0: ref 2 framing (shot 2 relative, pitched like the ref)
      { pos: [-24, 5, 14], target: [0, 3, 6], fov: 40, sun: { azimuth: 250, elevation: 25 } },        // 1: broadside close
      { pos: [-14, 3.2, 26], target: [-1, 1.8, 15], fov: 30, sun: { azimuth: 250, elevation: 25 } },  // 2: bow + eye close
      { pos: [-140, 40, 20], target: [-130, 3, -80], fov: 50, sun: { azimuth: 250, elevation: 30 } }, // 3: variant lineup
      { pos: [81, 2.4, 31], target: [82, 5.3, 20], fov: 50, sun: { azimuth: 210, elevation: 58 } },  // 4: wreck (shot 7 relative)
      { pos: [60, 6, 20], target: [80, 1.5, 0], fov: 50, sun: { azimuth: 210, elevation: 50 } },    // 5: wreck overview
    ],
  };
}
