// MARINE (sunken era only): corals, sea fans, sponges, anemones, urchins, sea grass, kelp forests, algae
// columns, schools of silver fish, reef fish, a manta ray and a sea turtle.
//  * reads engine.slots.coral / engine.slots.kelp pushed by the architecture modules ({pos, normal?, size, tag})
//  * scatters its own growth on the REAL top surfaces of the built world (GPU top-down surface map, see
//    src/marine/scatter.js) with hero density around the sunken shot cameras (6-9), sparse elsewhere
//  * fauna paths are anchored to the sunken shot frames (they follow the director's camera solves) and are
//    analytic functions of the engine time (engine.onUpdate → deterministic)
// Golden era: returns immediately.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { SHOTS } from '../world/shots.js';
import { isSunken } from '../world/era.js';
import { RNG } from '../core/rng.js';
import { ReefLibrary } from '../marine/library.js';
import { surfaceMap, groundY, makeDensity, reefCluster, grassPatch, kelpAt, placeOne, noise01, edgeAt, faceGrowth } from '../marine/scatter.js';
import { buildSchools, buildSwimmer } from '../marine/fauna.js';
import { MARINE_U, FISH_GLINT, CORAL_GLOW } from '../marine/materials.js';
import { makeKeepFilter } from '../marine/keep.js';

const V = THREE.Vector3;
const UP = new V(0, 1, 0);

// ------------------------------------------------------------------ helpers
/** camera frame from a shot ({pos,target,fov}); at(x,y,d): world point at NDC (x,y) and view depth d */
function frameOf(shot, aspect = 1672 / 941) {
  const pos = new V(...shot.pos), target = new V(...shot.target);
  const fwd = new V().subVectors(target, pos).normalize();
  const right = new V().crossVectors(fwd, UP).normalize();
  const up = new V().crossVectors(right, fwd).normalize();
  const tv = Math.tan(((shot.fov ?? 40) * Math.PI) / 360), th = tv * aspect;
  const at = (x, y, d) => pos.clone().addScaledVector(fwd, d).addScaledVector(right, x * th * d).addScaledVector(up, y * tv * d);
  return { pos, fwd, right, up, at, th, tv };
}
const shotById = (id) => SHOTS.find((s) => s.id === id);
const arr = (v) => (v.isVector3 ? [v.x, v.y, v.z] : v);
const toV = (p) => (Array.isArray(p) ? new V(p[0], p[1], p[2]) : p?.isVector3 ? p.clone() : new V(p.x, p.y, p.z));

/** a closed loop through p0 with tangent dir (horizontal circle of radius R, gentle vertical wave) */
function loopThrough(p0, dir, R, { n = 10, dy = 2, side = 1, minY = -1e9, maxY = 1e9 } = {}) {
  const h = new V(dir.x, 0, dir.z).normalize();
  const nn = new V(-h.z, 0, h.x).multiplyScalar(side);
  const c = p0.clone().addScaledVector(nn, R);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2;
    const p = c.clone().addScaledVector(nn, -R * Math.cos(th)).addScaledVector(h, R * Math.sin(th));
    p.y = THREE.MathUtils.clamp(p0.y + Math.sin(th) * dy + dir.y * R * Math.sin(th) * 0.5, minY, maxY);
    pts.push([p.x, p.y, p.z]);
  }
  return pts;
}

// ------------------------------------------------------------------ hero zones (surface maps)
const ZONES = [
  { id: 'temple', cx: 0, cz: 60, size: 330, cell: 0.25 },   // shots 6 + 9: plateau, chariot, stair, ledges
  { id: 'canal', cx: 0, cz: 730, size: 240, cell: 0.25 },   // shot 7: canal floor, gate bridge, wreck
  { id: 'head', cx: 140, cz: 375, size: 190, cell: 0.25 },  // shot 8: fallen head on land ring 1
];
const CITY = { id: 'city', cx: 0, cz: 100, size: 2100, cell: 2.5 };

function sunkenCams() {
  const out = [];
  for (const s of SHOTS) if (s.era === 'sunken') out.push(s);
  return out;
}

// ------------------------------------------------------------------ reef scatter (shared by build & test)
/** true when (x,y,z) would block the near view of a sunken shot camera (keep kelp / columns out of it) */
function inViewCone(x, y, z, frames) {
  for (const F of frames) {
    const dx = x - F.pos.x, dy = y - F.pos.y, dz = z - F.pos.z;
    const d = dx * F.fwd.x + dy * F.fwd.y + dz * F.fwd.z;
    if (d < 0.5 || d > 40) continue;
    const sx = (dx * F.right.x + dz * F.right.z) / (d * F.th);
    if (Math.abs(sx) < (d < 12 ? 0.75 : 0.5)) return true;
  }
  return false;
}

/** geometry tier by distance to the nearest sunken lens: hero < 18 m, 'mid' (≈ half detail) < 45 m, lo beyond */
const lodOf = (d) => (d > 45 ? true : d > 18 ? 'mid' : false);

function scatterHero(engine, lib, map, zone, dens, rng, stats, opts = {}) {
  const frames = opts.frames || [];
  const q = engine.quality;
  const dq = q.density ?? 1;
  const sp = (opts.spacing ?? 1.25) / Math.sqrt(Math.max(0.3, dq));
  const half = zone.size / 2;
  const surf = L.SUNKEN.surface;
  const kelpZone = opts.kelp || null;
  for (let gz = -half; gz < half; gz += sp) {
    for (let gx = -half; gx < half; gx += sp) {
      const x = zone.cx + gx + rng.range(-0.45, 0.45) * sp, z = zone.cz + gz + rng.range(-0.45, 0.45) * sp;
      const s = map.sample(x, z);
      if (!s || s.y > surf - 1.0) continue;
      const w = dens(x, s.y, z);
      if (w < 0.02) continue;
      lib.w = w;
      const g = opts.ground ? opts.ground(x, z) : groundY(engine, x, z);
      const onSand = s.y <= g + 0.25;
      const r0 = rng.random();
      if (s.ny < 0.72) continue;
      const lod = w > 0.45 ? 1 : 0.4, lo = lodOf(dens.dist(x, s.y, z)), grow = 1 + THREE.MathUtils.clamp((0.6 - w) * 1.6, 0, 0.9);
      if (onSand) {
        // sea grass meadows in patches; sparse coral heads, urchins
        const patch = noise01(x, z, 0.09, 1) * 0.7 + noise01(x, z, 0.35, 2) * 0.3;
        if (patch > 0.56 && r0 < 0.5 * w * w) { grassPatch(lib, rng, new V(x, s.y, z), 1.2, map, Math.round(rng.range(3, 9) * lod), lo); stats.grass++; continue; }
        if (r0 < 0.045 * w) { reefCluster(lib, rng, new V(x, s.y, z), UP, rng.range(0.4, 1.0), 'sand', map, lod, lo, grow); stats.clusters++; continue; }
      } else {
        const e = edgeAt(map, x, z, s.y);
        if (e) {
          if (r0 < 0.95 * w * Math.min(1, e.drop / 0.7)) { faceGrowth(lib, rng, x, z, s.y, e, w, lo, grow); stats.faces++; }
          continue;
        }
        if (map.rough(x, z, 0.35) > 0.5) { if (r0 < 0.3 * w) { placeOne(lib, rng, rng.random() < 0.5 ? 'lump' : 'bush', new V(x, s.y, z), UP, rng.range(0.4, 0.9) * grow, lo); stats.clusters++; } continue; }
        const pat = noise01(x, z, 0.21, 3);
        const raised = s.y > g + 0.8 ? 2.4 : 0.7;
        if (r0 < (0.25 + 0.5 * pat) * w * raised) { reefCluster(lib, rng, new V(x, s.y, z), UP, rng.range(0.35, 0.9), 'stone', map, lod, lo, grow); stats.clusters++; continue; }
        if (r0 < (0.2 + 0.4 * pat) * w * w && rng.random() < 0.4) { grassPatch(lib, rng, new V(x, s.y, z), 0.5, map, 2, lo); stats.grass++; }
      }
    }
  }
  // kelp / algae columns
  if (kelpZone) {
    const ks = 3.2 / Math.sqrt(Math.max(0.3, dq));
    for (let gz = -half; gz < half; gz += ks) for (let gx = -half; gx < half; gx += ks) {
      const x = zone.cx + gx + rng.range(-0.5, 0.5) * ks, z = zone.cz + gz + rng.range(-0.5, 0.5) * ks;
      if (!kelpZone(x, z)) continue;
      const s = map.sample(x, z);
      if (!s || s.ny < 0.8) continue;
      const g = opts.ground ? opts.ground(x, z) : groundY(engine, x, z);
      if (s.y > g + 0.4) continue; // kelp roots on the sand / rock floor only
      if (inViewCone(x, s.y, z, frames)) continue;
      lib.w = dens(x, s.y, z);
      const forest = noise01(x, z, 0.035, 5) * 0.75 + noise01(x, z, 0.12, 6) * 0.25;
      if (forest < 0.5 || rng.random() > (forest - 0.5) * 3.2) continue;
      if (kelpAt(lib, rng, x, s.y, z, { lo: dens.dist(x, s.y, z) > 30 })) stats.kelp++;
    }
  }
  if (opts.columns) {
    const cs = 4.5 / Math.sqrt(Math.max(0.3, dq));
    for (let gz = -half; gz < half; gz += cs) for (let gx = -half; gx < half; gx += cs) {
      const x = zone.cx + gx + rng.range(-0.5, 0.5) * cs, z = zone.cz + gz + rng.range(-0.5, 0.5) * cs;
      const s = map.sample(x, z);
      if (!s || s.ny < 0.85 || !opts.columns(x, s.y, z)) continue;
      if (map.rough(x, z, 1.0) > 0.4) continue;
      if (inViewCone(x, s.y, z, frames)) continue;
      lib.w = dens(x, s.y, z);
      const cl = noise01(x, z, 0.05, 7);
      if (cl < 0.55 || rng.random() > (cl - 0.55) * 3) continue;
      lib.place('column', new V(x, s.y - 0.1, z), UP, rng.range(0.75, 1.3), rng.range(0, 6.28), null, null, rng, dens.dist(x, s.y, z) > 30);
      stats.columns++;
    }
  }
}

function consumeSlots(engine, lib, rng, dens, maps, stats) {
  for (const s of engine.slots.coral || []) {
    const p = toV(s.pos);
    lib.tag = s.tag || '';
    if (s.species) { // curated dressing slot: {pos, normal, species, scale, yaw?, rgb?, variant?, lean?}
      let n = s.normal ? toV(s.normal).normalize() : UP.clone();
      if (s.lean !== undefined) n.lerp(UP, 1 - s.lean).normalize();
      lib.w = 1;
      if (s.species === 'kelp') { if (kelpAt(lib, rng, p.x, p.y, p.z, { maxH: s.height ?? null })) stats.kelpSlots++; }
      else if (lib.place(s.species, p, n, s.scale ?? 1, s.yaw ?? rng.range(0, 6.28), s.rgb ?? null, s.variant ?? null, rng, false)) stats.dressed = (stats.dressed || 0) + 1;
      continue;
    }
    let n = s.normal ? toV(s.normal).normalize() : UP.clone();
    if (!Number.isFinite(n.x) || n.lengthSq() < 0.5) n = UP.clone();
    const w = dens(p.x, p.y, p.z);
    lib.w = w;
    const size = THREE.MathUtils.clamp(s.size ?? 1, 0.2, 4);
    if (w < 0.03 && rng.random() > 0.06) continue;
    if (w < 0.15 && rng.random() > 0.3) continue;
    const map = maps.find((m) => m && m.sample(p.x, p.z));
    const mode = n.y > 0.7 ? 'stone' : 'wall';
    const lod = w > 0.4 ? 1 : w > 0.15 ? 0.35 : 0;
    const dc = dens.dist(p.x, p.y, p.z);
    const lo = lodOf(dc), grow = 1 + THREE.MathUtils.clamp((0.6 - w) * 1.6, 0, 0.9);
    // hero structures at mid range (ref 6: the chariot group, fountains and podium smothered in coral): fuller patches
    const boost = w > 0.5 && dc > 18 && dc < 110 ? 1.6 : 1;
    const k = Math.max(1, Math.round(size / 1.2 * lod * boost));
    for (let i = 0; i < k; i++) {
      const off = i === 0 ? new V() : new V(rng.range(-1, 1), 0, rng.range(-1, 1)).multiplyScalar(size * 0.6 * Math.sqrt(boost));
      if (Math.abs(n.y) < 0.7) off.projectOnPlane(n);
      reefCluster(lib, rng, p.clone().add(off), n, Math.min(1.2 * boost, size * 0.6 * boost), mode, mode === 'stone' ? map : null, lod, lo, grow);
    }
    stats.slots++;
  }
  lib.tag = '';
  for (const s of engine.slots.kelp || []) {
    const p = toV(s.pos);
    lib.w = dens(p.x, p.y, p.z);
    if (kelpAt(lib, rng, p.x, p.y, p.z, { maxH: s.height ? s.height + 6 : null, lo: dens.dist(p.x, p.y, p.z) > 30 })) stats.kelpSlots++;
  }
}

/**
 * ref 7: kelp columns frame the gate-bridge arch at the left / right frame edges (near) and behind the towers;
 * curated slots (tag 'dress7') at NDC positions of the shot-7 camera, dropped to the canal floor (never onto
 * the wreck / quay: the surface map must be at ground level there).
 */
function framingKelp(engine, maps) {
  const s7 = shotById(7);
  const zone = maps.find((m) => m.z.id === 'canal')?.map;
  if (!s7 || !zone) return;
  const F = frameOf(s7);
  const spots = [[-0.97, 9], [-0.9, 15], [-1.02, 22], [-0.8, 34], [0.96, 8], [0.9, 13], [1.0, 20], [0.82, 31]];
  let n = 0;
  for (const [x, d] of spots) {
    for (let k = 0; k < 6; k++) {
      const p = F.at(x * (1 + k * 0.04), -0.55, d);
      const s = zone.sample(p.x, p.z);
      if (!s) break;
      const g = groundY(engine, p.x, p.z);
      if (s.y > g + 0.6 || s.ny < 0.8) continue; // something built here (wreck, quay): try further out
      engine.slots.coral.push({ pos: [p.x, s.y, p.z], species: 'kelp', tag: 'dress7:kelp' });
      n++;
      break;
    }
  }
  return n;
}

// ------------------------------------------------------------------ fauna (anchored to the shot frames)
function faunaDefs(engine, groundFn) {
  const defs = [], swimmers = [];
  const dq = Math.max(0.35, engine.quality.density ?? 1);
  const N = (n) => Math.round(n * dq);
  const s6 = shotById(6), s7 = shotById(7), s8 = shotById(8), s9 = shotById(9);
  const P = (v) => [v.x, v.y, v.z];
  if (s6) {
    const F = frameOf(s6);
    // ribbon of silver fish streaming across the upper left (ref 6)
    defs.push({ id: 's6-stream', type: 'stream', count: N(3600), size: 0.38, width: 7, thick: 2.2, speed: 2.2, pulses: 4,
      path: [F.at(-1.5, 0.30, 46), F.at(-0.8, 0.38, 40), F.at(-0.2, 0.44, 46), F.at(0.35, 0.52, 62), F.at(0.6, 0.7, 90), F.at(-0.3, 0.85, 110), F.at(-1.6, 0.6, 85)].map(P) });
    defs.push({ id: 's6-far', type: 'stream', count: N(900), size: 0.3, width: 5, thick: 2, speed: 1.8, pulses: 3, lo: true,
      path: [F.at(0.75, 0.55, 70), F.at(1.3, 0.45, 80), F.at(1.4, 0.75, 110), F.at(0.8, 0.8, 100)].map(P) });
  }
  if (s7) {
    const F = frameOf(s7);
    // the great swirl around the arch (ref 7): a broad ribbon sweeping down past the wreck and up the right tower
    defs.push({ id: 's7-swirl', type: 'stream', count: N(11000), size: 0.4, width: 10, thick: 4.5, speed: 2.4, pulses: 3,
      path: [F.at(-0.78, 0.5, 42), F.at(-0.45, 0.12, 32), F.at(-0.22, -0.25, 26), F.at(0.12, -0.32, 30), F.at(0.42, -0.05, 40), F.at(0.5, 0.35, 52), F.at(0.18, 0.62, 64), F.at(-0.35, 0.72, 58)].map(P) });
    defs.push({ id: 's7-mill', type: 'mill', count: N(3000), size: 0.36, center: P(F.at(0.68, 0.18, 48)), r0: 2.5, r1: 7.5, height: 14, speed: 2.0, dir: 1, tilt: 0.25, squash: 0.8 });
    defs.push({ id: 's7-far', type: 'stream', count: N(1500), size: 0.3, width: 10, thick: 6, speed: 1.6, lo: true,
      path: [F.at(-0.2, 0.15, 85), F.at(0.25, 0.1, 95), F.at(0.35, 0.45, 110), F.at(-0.15, 0.5, 100)].map(P) });
    const tp = F.at(0.24, 0.47, 15);
    swimmers.push({ kind: 'turtle', scale: 1.25, speed: 0.55, flapHz: 0.32, path: loopThrough(tp, F.right.clone().multiplyScalar(0.75).addScaledVector(F.fwd, -0.6).add(new V(0, 0.3, 0)), 11, { dy: 1.5, side: -1 }) });
  }
  if (s8) {
    const F = frameOf(s8);
    // loose group of big silver jacks on the right (ref 8)
    defs.push({ id: 's8-jacks', type: 'mill', count: N(180), size: 0.55, center: P(F.at(0.72, 0.22, 26)), r0: 2, r1: 6, height: 6, speed: 1.3, dir: -1, beat: 0.6 });
    defs.push({ id: 's8-far', type: 'stream', count: N(900), size: 0.3, width: 6, thick: 3, speed: 1.8, lo: true,
      path: [F.at(-0.3, 0.3, 60), F.at(0.3, 0.25, 70), F.at(0.5, 0.45, 85), F.at(-0.2, 0.5, 80)].map(P) });
    const mp = F.at(-0.12, 0.62, 30);
    const gy = groundFn(mp.x, mp.z);
    swimmers.push({ kind: 'manta', scale: 1.05, speed: 1.1, flapHz: 0.16, path: loopThrough(mp, F.right.clone().negate().add(F.fwd.clone().multiplyScalar(0.15)), 26, { dy: 3, side: 1, minY: gy + 6, maxY: L.SUNKEN.surface - 4 }) });
  }
  if (s9) {
    const F = frameOf(s9);
    defs.push({ id: 's9-mill', type: 'mill', count: N(700), size: 0.3, center: P(F.at(-0.62, -0.05, 42)), r0: 3, r1: 8, height: 7, speed: 1.8, dir: 1, tilt: 0.1 });
  }
  for (const d of defs) d.maxY = L.SUNKEN.surface - 3;
  return { defs, swimmers };
}

/** small reef-fish groups milling around a few hero coral heads */
function reefFishDefs(engine, lib, dens, rng) {
  const defs = [];
  const picks = [];
  for (const [sp, P] of lib.pools) {
    if (!['brain', 'whorl', 'softtree', 'table', 'barrel'].includes(sp)) continue;
    for (const it of P.items) { const e = it[0].elements; const w = dens(e[12], e[13], e[14]); if (w > 0.7) picks.push([e[12], e[13], e[14]]); }
  }
  const n = Math.min(Math.round(26 * (engine.quality.density ?? 1)), picks.length);
  for (let i = 0; i < n; i++) {
    const c = picks[Math.floor(rng.random() * picks.length)];
    defs.push({ id: 'reef' + i, type: 'mill', kind: 'reef', pattern: Math.floor(rng.random() * 6), count: rng.int(5, 18), size: rng.range(0.1, 0.2), center: [c[0], c[1] + rng.range(0.4, 1.0), c[2]], r0: 0.4, r1: rng.range(1.0, 2.2), height: 0.8, speed: rng.range(0.3, 0.6), dir: rng.sign(), beat: 1.5 });
  }
  return defs;
}

function startAnimation(engine, school, swim) {
  const update = (t) => {
    MARINE_U.uMarineTime.value = t;
    school.update(t);
    for (const s of swim) s.update(t);
  };
  update(engine.time || 0);
  engine.onUpdate((t) => update(t));
}

function addFauna(engine, root, defs, swimmers) {
  const school = buildSchools(engine, defs, root);
  const swim = swimmers.map((d) => buildSwimmer(engine, d.kind, d));
  for (const s of swim) {
    s.mesh.castShadow = d_cast(s); s.mesh.userData.castShadow = s.mesh.castShadow; s.mesh.userData.receiveShadow = true;
    root.add(s.mesh);
  }
  startAnimation(engine, school, swim);
  return { school, swim };
}
const d_cast = (s) => s.mesh.name.includes('manta') || s.mesh.name.includes('turtle');

// ------------------------------------------------------------------ build
export async function build(engine) {
  if (!isSunken(engine)) return;
  const t0 = performance.now();
  const root = new THREE.Group(); root.name = 'marine';
  root.userData.marineSkip = true;
  const lib = new ReefLibrary(engine);
  lib.filter = makeKeepFilter(engine);
  const rng = new RNG('marine:scatter');
  const cams = sunkenCams();
  const dens = makeDensity(cams);
  const stats = { clusters: 0, faces: 0, grass: 0, kelp: 0, columns: 0, slots: 0, kelpSlots: 0 };

  // surface maps of the built world (before adding anything of ours)
  const tm = performance.now();
  const maps = ZONES.map((z) => ({ z, map: surfaceMap(engine, { cx: z.cx, cz: z.cz, size: z.size, res: z.size / z.cell }) }));
  const city = surfaceMap(engine, { cx: CITY.cx, cz: CITY.cz, size: CITY.size, res: CITY.size / CITY.cell });
  const mapMs = Math.round(performance.now() - tm);

  // hero zones
  const canalKelp = (x, z) => (Math.abs(x) > 9 && Math.abs(x) < 46 && z > 560 && z < 900) || (Math.abs(x) >= 46 && z > 600 && z < 860 && Math.abs(x) < 120 && L.zoneAt(x, z) !== 'l2');
  for (const { z, map } of maps) {
    if (!map) { console.warn('[marine] no surface map for zone', z.id); continue; }
    scatterHero(engine, lib, map, z, dens, rng, stats, {
      frames: cams.map((c) => frameOf(c)),
      kelp: z.id === 'canal' ? canalKelp : z.id === 'head' ? (x, zz) => L.zoneAt(x, zz) === 'w2' : null,
      columns: z.id === 'temple' ? (x, y, zz) => y > 12 && y < 36 && Math.hypot(x, zz) > 140 : z.id === 'head' ? (x, y) => y > 12 : null,
    });
  }
  // sparse growth over the rest of the city (video fly-throughs, shot 9 distance): kelp forests in the outer
  // rings, coral heads on the land rings
  if (city) {
    const inHero = (x, z) => ZONES.some((Z) => Math.abs(x - Z.cx) < Z.size / 2 && Math.abs(z - Z.cz) < Z.size / 2);
    const sp = 11 / Math.sqrt(Math.max(0.3, engine.quality.density ?? 1));
    const half = CITY.size / 2;
    for (let gz = -half; gz < half; gz += sp) for (let gx = -half; gx < half; gx += sp) {
      const x = CITY.cx + gx + rng.range(-0.5, 0.5) * sp, z = CITY.cz + gz + rng.range(-0.5, 0.5) * sp;
      if (inHero(x, z)) continue;
      const s = city.sample(x, z);
      if (!s || s.ny < 0.8 || s.y > L.SUNKEN.surface - 2) continue;
      const zone = L.zoneAt(x, z);
      lib.w = dens(x, s.y, z) * 0.5;
      const g = groundY(engine, x, z);
      const onFloor = s.y <= g + 0.4;
      const forest = noise01(x, z, 0.02, 8);
      if (onFloor && (zone === 'w2' || zone === 'w3' || zone === 'sea' || (zone === 'l2' && Math.abs(x) < 45)) && forest > 0.6) {
        const k = Math.min(2, Math.round((forest - 0.5) * 5));
        for (let i = 0; i < k; i++) { const ox = rng.range(-sp, sp) * 0.5, oz = rng.range(-sp, sp) * 0.5; const ss = city.sample(x + ox, z + oz); if (ss) if (kelpAt(lib, rng, x + ox, ss.y, z + oz, { lo: true })) stats.kelp++; }
      } else if (rng.random() < 0.12) {
        reefCluster(lib, rng, new V(x, s.y, z), UP, rng.range(0.6, 1.4), onFloor ? 'sand' : 'stone', null, 0, true, 1.8);
        stats.clusters++;
      }
    }
  }
  framingKelp(engine, maps);
  consumeSlots(engine, lib, rng, dens, maps.map((m) => m.map).concat([city]), stats);

  // fauna first (its triangles count against the module budget)
  const fd = faunaDefs(engine, (x, z) => groundY(engine, x, z));
  for (const d of fd.defs) if (d.kind !== 'reef' && d.center && dens.dist(...d.center) > 25) d.lo = true;
  const reefDefs = reefFishDefs(engine, lib, dens, new RNG('marine:reef'));
  const fauna = addFauna(engine, root, fd.defs.concat(reefDefs), fd.swimmers);
  const budget = 15e6 * Math.max(0.45, engine.quality.density ?? 1) - fauna.school.tris - 20000;
  const res = lib.finalize(root, budget);

  engine.add(root);
  const ms = Math.round(performance.now() - t0);
  const mt = ((res.tris + fauna.school.tris) / 1e6).toFixed(2);
  engine.registry.marine = { root, U: { MARINE_U, FISH_GLINT, CORAL_GLOW }, stats, instances: res.instances, mtris: +mt, bySpecies: res.bySpecies, fish: fauna.school.count };
  console.log(`[marine] built in ${ms} ms (surface maps ${mapMs} ms): ${res.instances} growth instances, ${fauna.school.count} fish, ${mt} M tris; ` +
    `thinned lo ${res.thinned} hi ${res.thinnedHi}; clusters ${stats.clusters}, faces ${stats.faces}, grass ${stats.grass}, kelp ${stats.kelp}, columns ${stats.columns}, coral slots ${stats.slots}/${(engine.slots.coral || []).length} (dressed ${stats.dressed || 0}), kelp slots ${stats.kelpSlots}/${(engine.slots.kelp || []).length}`);
  console.log('[marine] species ' + JSON.stringify(res.bySpecies) + ' keep ' + JSON.stringify(lib.filter.stats));
}

function closeTo(sw, d) {
  const p = new V(...sw.path[0]), q = new V(...sw.path[1]);
  const side = new V().subVectors(q, p).normalize().cross(UP).normalize();
  return { pos: [p.x + side.x * d, p.y - d * 0.25, p.z + side.z * d], target: [p.x, p.y, p.z] };
}

// ------------------------------------------------------------------ test scene: a reef patch on ruins at temple depth
export async function test(engine) {
  const Y = L.SUNKEN.surface - 19; // plateau-like depth: 19 m below the sunken surface
  const stone = new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.85 });
  stone.userData.sunken = 'stone';
  const sand = new THREE.MeshStandardMaterial({ color: 0xd8d0bc, roughness: 0.95 });
  sand.userData.sunken = 'none';
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(400, 1, 400), sand); floor.position.set(0, Y - 0.5, 0); g.add(floor);
  // ruins: steps, a paved platform, toppled column drums, standing column stumps, a wall
  for (let i = 0; i < 4; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(14, 0.35, 14 - i * 1.6), stone); st.position.set(-2, Y + 0.175 + i * 0.35, -4 - i * 0.8); g.add(st); }
  for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 24), stone); c.rotation.z = Math.PI / 2; c.rotation.y = i * 0.5; c.position.set(7 + i * 1.7, Y + 0.75, 3 - i * 0.9); g.add(c); }
  for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 2 + i * 1.5, 24), stone); c.position.set(-9 + i * 3.5, Y + 1.4 + 1.4 * 0 + i * 0.75, -12); g.add(c); }
  const wall = new THREE.Mesh(new THREE.BoxGeometry(18, 4, 1.2), stone); wall.position.set(3, Y + 2, -16); g.add(wall);
  engine.add(g);

  const lib = new ReefLibrary(engine);
  const rng = new RNG('marine:test');
  const cams = [{ pos: [4, Y + 2.2, 14], target: [0, Y + 1.2, -4] }];
  const dens = makeDensity(cams);
  const zone = { cx: 0, cz: -5, size: 80 };
  const map = surfaceMap(engine, { cx: zone.cx, cz: zone.cz, size: zone.size, res: 320 });
  const stats = { clusters: 0, faces: 0, grass: 0, kelp: 0, columns: 0, slots: 0, kelpSlots: 0 };
  if (map) scatterHero(engine, lib, map, zone, dens, rng, stats, {
    ground: () => Y, spacing: 1.1,
    kelp: (x, z) => z < -20 || Math.abs(x) > 22,
    columns: (x, y, z) => z < -18 && Math.abs(x) < 20,
  });
  // wall slots (as an architecture module would push them)
  for (let i = 0; i < 6; i++) engine.slots.coral.push({ pos: [-5 + i * 3, Y + 1 + (i % 3), -15.35], normal: [0, 0, 1], size: 1.0, tag: 'test-wall' });
  consumeSlots(engine, lib, rng, dens, [map], stats);
  // species lineup (two rows) for look-dev
  const rows = [['brain', 'table', 'whorl', 'finger'], ['staghorn', 'bush', 'softtree', 'whip'], ['lump', 'tube', 'barrel', 'anemone'], ['urchin', 'fan', 'grass', 'column']];
  rows.forEach((row, ri) => row.forEach((sp, i) => { for (let v = 0; v < 2; v++) lib.place(sp, new V(-4.5 + i * 3 + v * 1.3, Y, 60 + ri * 12 + v * 0.6), UP, sp === 'column' ? 0.4 : 1.4, 0.6, null, v, rng); }));
  const root = new THREE.Group(); root.name = 'marine';
  const res = lib.finalize(root);
  const F = frameOf({ pos: cams[0].pos, target: cams[0].target, fov: 50 });
  const defs = [
    { id: 't-stream', type: 'stream', count: 1800, size: 0.3, width: 5, thick: 2, speed: 2.2, pulses: 3, path: [F.at(-1.4, 0.3, 26), F.at(-0.4, 0.45, 24), F.at(0.5, 0.55, 30), F.at(1.4, 0.5, 40), F.at(0.6, 0.9, 60), F.at(-1.2, 0.7, 50)].map((v) => [v.x, v.y, v.z]) },
    { id: 't-mill', type: 'mill', count: 900, size: 0.28, center: [14, Y + 6, -20], r0: 2, r1: 6, height: 6, speed: 2, dir: 1, tilt: 0.2 },
  ].concat(reefFishDefs(engine, lib, dens, new RNG('marine:reef')));
  const swimmers = [
    { kind: 'manta', scale: 1, speed: 1.1, flapHz: 0.16, path: loopThrough(F.at(-0.15, 0.6, 18), F.right.clone().negate(), 14, { dy: 2, side: 1 }) },
    { kind: 'turtle', scale: 1.1, speed: 0.5, flapHz: 0.32, path: loopThrough(F.at(0.4, 0.25, 7), F.right.clone(), 6, { dy: 0.5, side: -1 }) },
  ];
  const fauna = addFauna(engine, root, defs, swimmers);
  engine.add(root);
  console.log(`[marine:test] ${res.instances} instances, ${fauna.school.count} fish, ${((res.tris + fauna.school.tris) / 1e6).toFixed(2)} M tris`, JSON.stringify(stats), JSON.stringify(res.bySpecies));
  const sun = { azimuth: L.SUN_SUNKEN.azimuth, elevation: L.SUN_SUNKEN.elevation };
  return {
    views: [
      { pos: cams[0].pos, target: cams[0].target, fov: 50, sun },                         // 0 hero reef
      { pos: [2.5, Y + 0.9, 3.5], target: [-1, Y + 0.5, -2], fov: 45, sun },              // 1 macro close-up
      { pos: [30, Y + 10, 30], target: [0, Y + 2, -8], fov: 50, sun },                    // 2 wide: kelp + columns
      { pos: [4, Y + 1.2, 12], target: [-2, Y + 9, -6], fov: 55, sun },                   // 3 looking up: fish, manta
      { pos: [0, Y + 1.5, 6], target: [0, Y + 2, -15], fov: 45, sun },                    // 4 wall slots
      { pos: [0, Y + 1.6, 66], target: [0, Y + 0.5, 60.3], fov: 55, sun },                  // 5 lineup rows 0..3
      { pos: [0, Y + 1.6, 78], target: [0, Y + 0.5, 72.3], fov: 55, sun },
      { pos: [0, Y + 1.6, 90], target: [0, Y + 0.5, 84.3], fov: 55, sun },
      { pos: [0, Y + 1.6, 102], target: [0, Y + 0.7, 96.3], fov: 55, sun },
      { ...closeTo(swimmers[1], 2.6), fov: 40, sun },                                      // 9 turtle
      { ...closeTo(swimmers[0], 7), fov: 40, sun },                                        // 10 manta
    ],
  };
}
