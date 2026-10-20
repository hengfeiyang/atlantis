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
import { SK } from '../core/sunken.js';

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
      else if (lib.place(s.species, p, n, s.scale ?? 1, s.yaw ?? rng.range(0, 6.28), s.rgb ?? null, s.variant ?? null, rng, s.lo ?? false)) stats.dressed = (stats.dressed || 0) + 1;
      continue;
    }
    let n = s.normal ? toV(s.normal).normalize() : UP.clone();
    if (!Number.isFinite(n.x) || n.lengthSq() < 0.5) n = UP.clone();
    // r5: arch-a's gate-tower ledges (tags tower-cornice / tower-plinth): always crusted, fuller clumps even at the
    //     shot-7 range (≈ 120 m: ref 7's towers carry dark coral / weed clumps along every cornice and plinth)
    const tower = s.tag === 'tower-cornice' || s.tag === 'tower-plinth';
    const w = tower ? Math.max(dens(p.x, p.y, p.z), 0.3) : dens(p.x, p.y, p.z);
    lib.w = w;
    const size = THREE.MathUtils.clamp((s.size ?? 1) * (tower ? 1.3 : 1), 0.2, 4);
    if (w < 0.03 && rng.random() > 0.06) continue;
    if (w < 0.15 && rng.random() > 0.3) continue;
    const map = maps.find((m) => m && m.sample(p.x, p.z));
    const mode = n.y > 0.7 ? 'stone' : 'wall';
    const lod = tower ? Math.max(0.6, w > 0.4 ? 1 : 0.35) : w > 0.4 ? 1 : w > 0.15 ? 0.35 : 0;
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

// ------------------------------------------------------------------ sand drift mask (r3 look-sunken)
/**
 * core/sunken.js lays a sand-dust overlay on every up face; on the plateau (shots 6, 9) it covered the paving
 * uniformly. From the top-down surface map: texels LOWER than something within ≈ 2 m (wall feet, steps, basin and
 * pedestal sides, between rubble) collect sand, open paving stays swept → R8 mask in SK.tSkDrift (0.5 m cells).
 */
function bakeDriftMask(map) {
  const cell = 0.5, n = Math.round(map.size / cell), x0 = map.cx - map.size / 2, z0 = map.cz - map.size / 2;
  const Y = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const s = map.sample(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell);
    Y[j * n + i] = s ? s.y : -1e4;
  }
  const r = 4, A = new Float32Array(n * n), B = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {           // separable max (2 m window)
    let m = -1e4; for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) m = Math.max(m, Y[j * n + k]);
    A[j * n + i] = m;
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let m = -1e4; for (let k = Math.max(0, j - r); k <= Math.min(n - 1, j + r); k++) m = Math.max(m, A[k * n + i]);
    B[j * n + i] = m;
  }
  const D = new Uint8Array(n * n);
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {   // 3x3 blur of the cavity depth → 0..1
    let acc = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const k = (j + dj) * n + i + di;
      const d = Y[k] < -1e3 ? 0 : B[k] - Y[k];
      acc += THREE.MathUtils.smoothstep(d, 0.12, 0.9) * (1 - THREE.MathUtils.smoothstep(d, 7, 14));
    }
    D[j * n + i] = Math.round((acc / 9) * 255);
  }
  const tex = new THREE.DataTexture(D, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  SK.tSkDrift.value = tex;
  SK.uSkDrift.value.set(x0, z0, 1 / map.size, 1);
}

// ------------------------------------------------------------------ shot 6 foreground dressing (r3 look-sunken)
const linC = (r, g, b) => [r, g, b].map((v) => Math.pow(v / 255, 2.2));
const D6_PAL = [linC(232, 104, 36), linC(222, 70, 40), linC(240, 150, 44), linC(150, 70, 170), linC(196, 52, 70), linC(244, 196, 70), linC(214, 90, 140)];
const D6_SPECIES = { bush: 0.22, softtree: 0.18, finger: 0.14, whorl: 0.12, staghorn: 0.08, tube: 0.1, fan: 0.06, anemone: 0.05, brain: 0.05 };
/**
 * ref 6: the balustrades, pedestals, basin rims and blocks of the stair-top foreground are smothered in vivid orange /
 * red / purple coral. Camera rays through a pixel grid of the lower frame are marched against the temple-zone surface
 * map; RAISED flat surfaces (not the sand / mosaic plaza) 3-64 m from the lens get dense curated growth (tag 'dress6').
 */
function dressShot6(engine, maps, rng) {
  const s6 = shotById(6);
  const zone = maps.find((m) => m.z.id === 'temple')?.map;
  if (!s6 || !zone) return 0;
  const F = frameOf(s6);
  const dq = Math.max(0.5, Math.min(1.2, engine.quality.density ?? 1));
  const sx = Math.round(26 / dq), sy = Math.round(22 / dq);
  let n = 0;
  const why = { miss: 0, steep: 0, sand: 0, rough: 0, patch: 0 };
  const pickSp = () => { let r = rng.random(), acc = 0; for (const k in D6_SPECIES) { acc += D6_SPECIES[k]; if (r <= acc) return k; } return 'bush'; };
  for (let py = 455; py < 941; py += sy) for (let px = 6; px < 1672; px += sx) {
    const jx = px + rng.range(-0.4, 0.4) * sx, jy = py + rng.range(-0.4, 0.4) * sy;
    const d = F.at((2 * jx) / 1672 - 1, 1 - (2 * jy) / 941, 1).sub(F.pos).normalize();
    let hit = null;
    for (let t = 1; t < 64; t += Math.min(0.12, 0.04 + t * 0.003)) {
      const x = F.pos.x + d.x * t, y = F.pos.y + d.y * t, z = F.pos.z + d.z * t;
      const q = zone.sample(x, z);
      if (q && y <= q.y) { hit = { x, y: q.y, z, t, ny: q.ny, ry: y }; break; }
    }
    if (!hit) { why.miss++; continue; }
    const gy = groundY(engine, hit.x, hit.z);
    if (hit.ny < 0.75 || hit.y - hit.ry > 0.5) {
      // r4: vertical faces of the foreground (stair-top piers, balustrades, basin sides; ref 6: smothered) — growth on the face
      if (hit.t < 30 && hit.ry > gy + 0.3 && rng.random() < 0.55) {
        const sp = ['finger', 'tube', 'anemone', 'fan', 'bush', 'lump', 'softtree'][Math.floor(rng.random() * 7)];
        const nx = -d.x, nz = -d.z, nl = Math.hypot(nx, nz) || 1;
        const k = THREE.MathUtils.clamp(hit.t / 14, 0.45, 1.2) * rng.range(0.6, 1.1) * (sp === 'fan' ? 0.6 : 1);
        engine.slots.coral.push({ pos: [hit.x, hit.ry, hit.z], normal: [nx / nl, 0.45, nz / nl], species: sp, scale: k, rgb: D6_PAL[Math.floor(rng.random() * D6_PAL.length)], tag: 'dress6:' + sp });
        n++; why.face = (why.face || 0) + 1;
      } else why.steep++;
      continue;
    }
    if (hit.y < gy + 0.35) {                           // the plaza sand / mosaic stays mostly clear: sparse grass + small heads (ref 6)
      if (hit.t < 45 && rng.random() < 0.22 && Math.hypot(hit.x - L.FORECOURT.rose.center[0], hit.z - L.FORECOURT.rose.center[1]) > L.FORECOURT.rose.radius + 1) {
        const sp = rng.random() < 0.55 ? 'grass' : ['bush', 'finger', 'brain', 'lump', 'anemone'][Math.floor(rng.random() * 5)];
        engine.slots.coral.push({ pos: [hit.x, hit.y - 0.02, hit.z], normal: [0, 1, 0], species: sp, scale: sp === 'grass' ? 1.3 : THREE.MathUtils.clamp(hit.t / 18, 0.4, 1.1), rgb: sp === 'grass' ? null : D6_PAL[Math.floor(rng.random() * D6_PAL.length)], tag: 'dress6:' + sp, lo: hit.t > 25 ? 'mid' : false });
        n++;
      } else why.sand++;
      continue;
    }
    if (zone.rough(hit.x, hit.z, 0.3) > 0.9) { why.rough++; continue; }              // flat-ish tops only (no statue heads / arms); r4: 0.26 → (0.3 m, 0.9): the r4 stair-top cornices
    const patch = noise01(hit.x, hit.z, 0.55, 11) * 0.7 + noise01(hit.x, hit.z, 1.7, 12) * 0.3;
    if (hit.t > 6 && (patch < 0.3 || rng.random() > 0.45 + patch)) { why.patch++; continue; }   // r4: the nearest tops (stair-top blocks at 1-6 m) always grow
    const sp = pickSp();
    if (hit.t > 30 && rng.random() > 30 / hit.t) { why.patch++; continue; }  // far rows: fewer, bigger heads
    const k = THREE.MathUtils.clamp(hit.t / 13, 0.5, 1.6) * rng.range(0.7, 1.25) * (sp === 'fan' ? 0.6 : 1);
    const rgb = D6_PAL[Math.floor(rng.random() * D6_PAL.length)];
    engine.slots.coral.push({ pos: [hit.x, hit.y - 0.02, hit.z], normal: [rng.range(-0.15, 0.15), 1, rng.range(-0.15, 0.15)], species: sp, scale: k, rgb, size: k, tag: 'dress6:' + sp });
    n++;
  }
  console.log('[marine] dress6 ' + n + ' ' + JSON.stringify(why));
  return n;
}

// ------------------------------------------------------------------ shot 9 plateau reef (r4 sunken)
const D9_PAL = [linC(186, 70, 160), linC(150, 60, 170), linC(220, 90, 120), linC(232, 120, 60), linC(120, 170, 120), linC(214, 170, 70), linC(96, 140, 170), linC(200, 80, 80)];
const D9_SPECIES = { bush: 0.25, brain: 0.08, whorl: 0.13, softtree: 0.2, finger: 0.12, staghorn: 0.08, lump: 0.04, fan: 0.06, whip: 0.04 };
/**
 * ref 9: the plateau around the temple is a reef — coral mounds, sponges, sea-grass meadows and fans on every free
 * patch, big purple / pink heads in the near corners. Rays of a pixel grid of the shot-9 frame (below the waterline) are
 * marched against the temple-zone surface map; hits on OPEN paving (plateau level) 20-230 m away seed noise-clustered
 * reef mounds (3-9 heads, scaled with distance), hits on raised flat tops (arcade, podia, rubble) get single heads.
 */
function dressShot9(engine, maps, rng) {
  const s9 = shotById(9);
  const zone = maps.find((m) => m.z.id === 'temple')?.map;
  if (!s9 || !zone) return 0;
  const F = frameOf(s9);
  const Y0 = L.CITADEL.summit, surf = L.SUNKEN.surface;
  const dq = Math.max(0.5, Math.min(1.2, engine.quality.density ?? 1));
  const sx = Math.round(30 / dq), sy = Math.round(22 / dq);
  let n = 0;
  const pick = () => { let r = rng.random(), acc = 0; for (const k in D9_SPECIES) { acc += D9_SPECIES[k]; if (r <= acc) return k; } return 'bush'; };
  const put = (sp, x, y, z, k, t) => {
    const rgb = sp === 'grass' || sp === 'column' ? null : D9_PAL[Math.floor(rng.random() * D9_PAL.length)];
    engine.slots.coral.push({ pos: [x, y - 0.03, z], normal: sp === 'column' ? [0, 1, 0] : [rng.range(-0.12, 0.12), 1, rng.range(-0.12, 0.12)], species: sp, scale: k * (sp === 'fan' ? 0.7 : 1), rgb, tag: 'dress9:' + sp, lo: t > 60 ? true : t > 25 ? 'mid' : false });
    n++;
  };
  for (let py = 360; py < 941; py += sy) for (let px = 4; px < 1672; px += sx) {
    const jx = px + rng.range(-0.45, 0.45) * sx, jy = py + rng.range(-0.45, 0.45) * sy;
    const d = F.at((2 * jx) / 1672 - 1, 1 - (2 * jy) / 941, 1).sub(F.pos).normalize();
    let hit = null;
    for (let t = 10; t < 240; t += 0.08 + t * 0.004) {
      const x = F.pos.x + d.x * t, y = F.pos.y + d.y * t, z = F.pos.z + d.z * t;
      if (y > surf) continue;
      const q = zone.sample(x, z);
      if (q && y <= q.y) { hit = { x, y: q.y, z, t, ny: q.ny }; break; }
    }
    if (!hit || hit.ny < 0.8) continue;
    const open = Math.abs(hit.y - Y0) < 0.6;
    const patch = noise01(hit.x, hit.z, 0.07, 21) * 0.65 + noise01(hit.x, hit.z, 0.23, 22) * 0.35;
    const kd = THREE.MathUtils.clamp(hit.t / 28, 0.8, 3.2);
    if (open) {
      if (zone.rough(hit.x, hit.z, 1.5) > 0.4) continue;           // keep off steps / basin rims (they get their own growth)
      if (Math.abs(hit.x) < 24 && hit.z > 38) continue;             // the forecourt axis (chariot, rose, Nereid basins) stays readable
      const corner = (jx < 330 || jx > 1340) && jy > 700;           // ref 9: big reef heads in the near corners
      if (!corner && (patch < 0.42 || rng.random() > (patch - 0.34) * 2.4)) {
        if (patch > 0.3 && rng.random() < 0.45) { for (let g = 0; g < 3; g++) put('grass', hit.x + rng.range(-1, 1) * kd, hit.y, hit.z + rng.range(-1, 1) * kd, kd * 1.7, hit.t); }
        continue;
      }
      if (hit.t > 55 && rng.random() < 0.06 / dq) { put('column', hit.x, hit.y, hit.z, rng.range(0.7, 1.15), hit.t); continue; } // dark algae columns (ref 9 "cypresses")
      const k = corner ? rng.int(8, 14) : rng.int(5, 11), R = (corner ? 1.4 : 1.0) * kd;
      for (let i = 0; i < k; i++) {
        const a = rng.range(0, 6.28), rr = Math.sqrt(rng.random()) * R;
        const x = hit.x + Math.cos(a) * rr, z = hit.z + Math.sin(a) * rr;
        const q = zone.sample(x, z);
        if (!q || Math.abs(q.y - Y0) > 0.6) continue;
        const sp = i === 0 && rng.random() < 0.3 ? 'brain' : pick();
        put(sp, x, q.y, z, Math.min(sp === 'brain' ? 1.8 : 9, kd * rng.range(0.6, 1.25) * (corner ? 1.5 : 1)), hit.t);
      }
      if (rng.random() < 0.5) put('grass', hit.x + rng.range(-R, R), hit.y, hit.z + rng.range(-R, R), kd * 1.8, hit.t);
    } else if (hit.y > Y0 + 0.8 && hit.y < surf - 1.5 && zone.rough(hit.x, hit.z, 0.15) < 0.6 && rng.random() < 0.5 + patch * 0.4) {
      put(pick(), hit.x, hit.y, hit.z, kd * rng.range(0.5, 0.9), hit.t);
    }
  }
  console.log('[marine] dress9 ' + n);
  return n;
}

// ------------------------------------------------------------------ shot 7 foreground reef (r4 sunken)
const D7_PAL = [linC(214, 112, 52), linC(176, 84, 60), linC(150, 80, 150), linC(120, 70, 120), linC(206, 120, 150), linC(226, 160, 70), linC(110, 120, 90), linC(190, 70, 70)];
const D7_SPECIES = { bush: 0.18, finger: 0.12, brain: 0.1, whorl: 0.1, staghorn: 0.1, lump: 0.1, softtree: 0.1, fan: 0.06, tube: 0.06, anemone: 0.05, urchin: 0.03 };
/**
 * ref 7: the canal floor in the near corners is a rubble reef (orange / mauve / purple heads, sponges, fans), the wreck
 * hull is crusted with growth; the central sand lane toward the arch stays open. Pixel-grid rays of the shot-7 frame
 * (lower 40 %) marched against the canal-zone surface map.
 */
function dressShot7(engine, maps, rng) {
  const s7 = shotById(7);
  const zone = maps.find((m) => m.z.id === 'canal')?.map;
  if (!s7 || !zone) return 0;
  const F = frameOf(s7);
  const dq = Math.max(0.5, Math.min(1.2, engine.quality.density ?? 1));
  const sx = Math.round(16 / dq), sy = Math.round(13 / dq);
  let n = 0;
  const pick = () => { let r = rng.random(), acc = 0; for (const k in D7_SPECIES) { acc += D7_SPECIES[k]; if (r <= acc) return k; } return 'bush'; };
  const put = (sp, x, y, z, k, t, nrm) => {
    engine.slots.coral.push({ pos: [x, y - 0.03, z], normal: nrm || [rng.range(-0.2, 0.2), 1, rng.range(-0.2, 0.2)], species: sp, scale: k * (sp === 'fan' ? 0.7 : 1), rgb: D7_PAL[Math.floor(rng.random() * D7_PAL.length)], tag: 'dress7:' + sp, lo: t > 30 ? 'mid' : false });
    n++;
  };
  for (let py = 520; py < 941; py += sy) for (let px = 4; px < 1672; px += sx) {
    const jx = px + rng.range(-0.45, 0.45) * sx, jy = py + rng.range(-0.45, 0.45) * sy;
    const u = jx / 1672;
    const d = F.at(2 * u - 1, 1 - (2 * jy) / 941, 1).sub(F.pos).normalize();
    let hit = null;
    for (let t = 1.5; t < 48; t += 0.05 + t * 0.003) {
      const x = F.pos.x + d.x * t, y = F.pos.y + d.y * t, z = F.pos.z + d.z * t;
      const q = zone.sample(x, z);
      if (q && y <= q.y) { hit = { x, y: q.y, z, t, ny: q.ny }; break; }
    }
    if (!hit || hit.ny < 0.55) continue;
    const g = groundY(engine, hit.x, hit.z);
    const raised = hit.y > g + 0.4;
    const patch = noise01(hit.x, hit.z, 0.35, 31) * 0.6 + noise01(hit.x, hit.z, 1.1, 32) * 0.4;
    const kd = THREE.MathUtils.clamp(hit.t / 11, 0.45, 1.5);
    if (raised) {                                             // wreck hull / ribs / rubble tops
      if (rng.random() < 0.35 + 0.4 * patch) put(pick(), hit.x, hit.y, hit.z, kd * rng.range(0.4, 0.8), hit.t);
      continue;
    }
    // edge weight: dense at the left / right of the frame and the very bottom, open lane in the middle
    const side = u < 0.36 ? (0.36 - u) / 0.36 : u > 0.7 ? (u - 0.7) / 0.3 : 0;
    const w = Math.min(1, side * 1.6 + Math.max(0, (jy - 850) / 90) * 0.35) * (0.5 + patch);
    if (rng.random() > w) { if (patch > 0.55 && rng.random() < 0.3) put('grass', hit.x, hit.y, hit.z, 1.2, hit.t); continue; }
    const k = rng.int(1, 3);
    for (let i = 0; i < k; i++) {
      const x = hit.x + rng.range(-0.6, 0.6) * kd, z = hit.z + rng.range(-0.6, 0.6) * kd;
      const q = zone.sample(x, z); if (!q) continue;
      put(i === 0 && rng.random() < 0.25 ? 'lump' : pick(), x, q.y, z, kd * rng.range(0.55, 1.2), hit.t);
    }
  }
  console.log('[marine] dress7 ' + n);
  return n;
}

// ------------------------------------------------------------------ shot 8 reef litter (r4 sunken)
/**
 * ref 8: beyond the curated dress8 heads the floor around the head is littered with small corals, sponges, urchins and
 * rubble, the background arcade / columns crusted. Pixel-grid rays of the shot-8 frame against the head-zone surface map;
 * the mosaic / head face / trident head (registry.sets.keepClear8) stay clear.
 */
function dressShot8(engine, maps, rng) {
  const s8 = shotById(8);
  const zone = maps.find((m) => m.z.id === 'head')?.map;
  if (!s8 || !zone) return 0;
  const F = frameOf(s8);
  const keep = engine.registry.sets?.keepClear8 || [];
  const mos = engine.registry.sets?.mosaic8;
  const dq = Math.max(0.5, Math.min(1.2, engine.quality.density ?? 1));
  const sx = Math.round(20 / dq), sy = Math.round(16 / dq);
  let n = 0;
  const pick = () => { let r = rng.random(), acc = 0; for (const k in D7_SPECIES) { acc += D7_SPECIES[k]; if (r <= acc) return k; } return 'bush'; };
  for (let py = 380; py < 941; py += sy) for (let px = 4; px < 1672; px += sx) {
    const jx = px + rng.range(-0.45, 0.45) * sx, jy = py + rng.range(-0.45, 0.45) * sy;
    const d = F.at((2 * jx) / 1672 - 1, 1 - (2 * jy) / 941, 1).sub(F.pos).normalize();
    let hit = null;
    for (let t = 2; t < 80; t += 0.05 + t * 0.004) {
      const x = F.pos.x + d.x * t, y = F.pos.y + d.y * t, z = F.pos.z + d.z * t;
      const q = zone.sample(x, z);
      if (q && y <= q.y) { hit = { x, y: q.y, z, t, ny: q.ny }; break; }
    }
    if (!hit || hit.ny < 0.7) continue;
    if (keep.some((k) => Math.hypot(hit.x - k.x, hit.z - k.z) < k.r + 0.6)) continue;
    if (mos && Math.hypot(hit.x - mos.center[0], hit.z - mos.center[1]) < mos.radius + 0.5) continue;
    const g = groundY(engine, hit.x, hit.z);
    const raised = hit.y > g + 0.5;
    const patch = noise01(hit.x, hit.z, 0.3, 41) * 0.6 + noise01(hit.x, hit.z, 1.3, 42) * 0.4;
    const kd = THREE.MathUtils.clamp(hit.t / 13, 0.4, 2.0);
    const p = raised ? 0.3 + 0.3 * patch : (patch - 0.35) * 0.9;
    if (rng.random() > p) continue;
    const sp = raised ? pick() : (rng.random() < 0.3 ? 'grass' : pick());
    engine.slots.coral.push({ pos: [hit.x, hit.y - 0.03, hit.z], normal: [rng.range(-0.2, 0.2), 1, rng.range(-0.2, 0.2)], species: sp, scale: kd * rng.range(0.45, 0.9) * (sp === 'fan' ? 0.7 : 1),
      rgb: sp === 'grass' ? null : D7_PAL[Math.floor(rng.random() * D7_PAL.length)], tag: 'dress8r:' + sp, lo: hit.t > 35 ? true : hit.t > 18 ? 'mid' : false });
    n++;
  }
  console.log('[marine] dress8 litter ' + n);
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
    // r3 (look-sunken): thinner and routed AROUND the arch (ref 7: the bridge reads through a loose swirl; the dense
    // band sweeps the left side, the floor in front of the wreck and the right tower, over the deck high up)
    defs.push({ id: 's7-swirl', type: 'stream', count: N(6000), size: 0.4, width: 8, thick: 3.0, speed: 2.4, pulses: 3,
      path: [F.at(-0.82, 0.45, 40), F.at(-0.62, 0.02, 32), F.at(-0.3, -0.42, 26), F.at(0.12, -0.5, 30), F.at(0.5, -0.22, 40), F.at(0.66, 0.3, 50), F.at(0.42, 0.82, 60), F.at(-0.4, 0.86, 56)].map(P) });
    defs.push({ id: 's7-mill', type: 'mill', count: N(2200), size: 0.36, center: P(F.at(0.74, 0.12, 46)), r0: 2.5, r1: 7.0, height: 14, speed: 2.0, dir: 1, tilt: 0.25, squash: 0.8 });
    defs.push({ id: 's7-far', type: 'stream', count: N(900), size: 0.3, width: 8, thick: 5, speed: 1.6, lo: true,
      path: [F.at(0.55, -0.1, 80), F.at(0.85, 0.05, 90), F.at(0.9, 0.5, 100), F.at(0.6, 0.6, 92)].map(P) });
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
  { const tz = maps.find((m) => m.z.id === 'temple')?.map; if (tz) { try { bakeDriftMask(tz); } catch (e) { console.warn('[marine] drift mask failed', e); } } }

  // hero zones
  const canalKelp = (x, z) => (Math.abs(x) > 9 && Math.abs(x) < 46 && z > 560 && z < 900) || (Math.abs(x) >= 46 && z > 600 && z < 860 && Math.abs(x) < 120 && L.zoneAt(x, z) !== 'l2')
  // r3 (look-sunken): the shot-7 view corridor between the lens and the gate bridge stays open (ref 7: the bridge reads)
  // r4: and the canal behind the bridge seen through the arch (the thin far kelp read as rain over the arch view, ref 7: clear)
  const canalKelp7 = (x, z) => canalKelp(x, z) && !(z > 696 && z < 822 && Math.abs(x + 10.7) < 19) && !(z > 520 && z <= 700 && Math.abs(x) < 44) && !(z > 600 && z < 822 && x > -30 && x < 27);
  for (const { z, map } of maps) {
    if (!map) { console.warn('[marine] no surface map for zone', z.id); continue; }
    scatterHero(engine, lib, map, z, dens, rng, stats, {
      frames: cams.map((c) => frameOf(c)),
      kelp: z.id === 'canal' ? canalKelp7 : z.id === 'head' ? (x, zz) => L.zoneAt(x, zz) === 'w2' : null,
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
      const archView7 = z > 380 && z < 700 && Math.abs(x) < 46;   // r4: the canal seen through the shot-7 arch stays clear
      if (onFloor && !archView7 && (zone === 'w2' || zone === 'w3' || zone === 'sea' || (zone === 'l2' && Math.abs(x) < 45)) && forest > 0.6) {
        const k = Math.min(2, Math.round((forest - 0.5) * 5));
        for (let i = 0; i < k; i++) { const ox = rng.range(-sp, sp) * 0.5, oz = rng.range(-sp, sp) * 0.5; const ss = city.sample(x + ox, z + oz); if (ss) if (kelpAt(lib, rng, x + ox, ss.y, z + oz, { lo: true })) stats.kelp++; }
      } else if (rng.random() < 0.12) {
        reefCluster(lib, rng, new V(x, s.y, z), UP, rng.range(0.6, 1.4), onFloor ? 'sand' : 'stone', null, 0, true, 1.8);
        stats.clusters++;
      }
    }
  }
  framingKelp(engine, maps);
  stats.dress6 = dressShot6(engine, maps, new RNG('marine:dress6'));
  stats.dress9 = dressShot9(engine, maps, new RNG('marine:dress9'));
  stats.dress7 = dressShot7(engine, maps, new RNG('marine:dress7'));
  stats.dress8 = dressShot8(engine, maps, new RNG('marine:dress8'));
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
    `thinned lo ${res.thinned} hi ${res.thinnedHi}; clusters ${stats.clusters}, faces ${stats.faces}, grass ${stats.grass}, kelp ${stats.kelp}, columns ${stats.columns}, coral slots ${stats.slots}/${(engine.slots.coral || []).length} (dressed ${stats.dressed || 0}), kelp slots ${stats.kelpSlots}/${(engine.slots.kelp || []).length}, dress6 ${stats.dress6}`);
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
