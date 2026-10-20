// Statues: the colossal chariot group of Poseidon with six winged horses rearing from sculpted waves (ref 3),
// Nereids riding dolphins in the fountain basins (L.NEREIDS slots), the colossus of Poseidon with his trident on
// its pedestal (L.COLOSSUS, refs 1, 5) and small gilt statues (kings, nymphs, priestesses) on the statue slots.
// Sunken era (ref 6): verdigris bronze, one horse broken off and lying on the paving, a damaged wing, toppled
// small statues, coral slots on the sculpture; the colossus is gone (its head is the sets module's fallen head).
// OWNER: statues agent. Heavy meshes are SDF sculpts baked by `node tools/bake.mjs statues` (src/sculpt/library.js).
//
// registry.statues = { chariot: { origin, rotY, horses:[{pos, head}], poseidon:{pos, trident} }, nereids: [{ pos, mouth,
//                      facing }], colossus: { pos, height, tridentTop } | null, tris }
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { isSunken, ruined, ruinRand } from '../world/era.js';
import { statueGeometry } from '../sculpt/library.js';
import { chariotLayout } from '../sculpt/chariot.js';
import { poseidonSpec } from '../sculpt/poseidon.js';
import { makeNereid, NEREID_VARIANTS } from '../sculpt/nereid.js';
import { HORSE_POSES, makeHorse } from '../sculpt/horse.js';
import { STATUE_KINDS } from '../sculpt/statuary.js';
import { SHOTS } from '../world/shots.js';
import { statueMetal } from '../sculpt/statueMetal.js';

const Y = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ materials
/** gilt bronze (golden) / old bronze for the verdigris overlay (sunken); baked AO / cavity / gilt mask in the vertex colours */
function statueMat(engine, kind = 'body') {
  if (engine.params?.get?.('statmat') === 'plain') {
    const m = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.3 });
    m.userData.sunken = 'metal';
    return m;
  }
  const sunken = isSunken(engine);
  if (kind === 'gold') return statueMetal({ sunken, roughness: sunken ? 0.5 : 0.24, base: sunken ? [0.42, 0.27, 0.12] : [0.9, 0.62, 0.22] });
  return statueMetal({ sunken });
}

const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

function mesh(geo, mat, { pos = [0, 0, 0], rotY = 0, s = 1, mirror = false, quat = null, name } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  if (quat) m.quaternion.copy(quat); else m.rotation.y = rotY;
  m.scale.set(mirror ? -s : s, s, s);
  if (name) m.name = name;
  return m;
}

// ------------------------------------------------------------------ coral slots (sunken)
/** sample up-facing vertices of a placed mesh as coral anchors */
function coralFrom(engine, meshObj, count, size, tag, label) {
  meshObj.updateWorldMatrix(true, false);
  const g = meshObj.geometry, P = g.attributes.position.array, N = g.attributes.normal.array;
  const nv = P.length / 3;
  const rng = engine.rng('statue-coral:' + label);
  const M = meshObj.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(M);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  let got = 0;
  for (let tries = 0; tries < count * 40 && got < count; tries++) {
    const i = Math.floor(rng.random() * nv);
    n.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).applyMatrix3(nm).normalize();
    if (n.y < 0.55) continue;
    v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(M);
    engine.slots.coral.push({ pos: v.toArray(), normal: n.toArray(), size: size * (0.6 + 0.8 * rng.random()), tag });
    got++;
  }
}

// ------------------------------------------------------------------ the chariot group
// r3 (director): the six horses read ≈ 0.7× (ref 3: they rear in front of the lower colonnade, Poseidon towers over them);
// scaled about their hip-ground origin (hind hooves stay in the waves), drawn a little closer together
const HORSE_K = 0.7, HORSE_SPREAD = 0.84;
async function buildChariot(engine, reg, stats) {
  const sunken = isSunken(engine);
  const C = L.CHARIOT;
  const tp = engine.registry.temple?.chariot;
  const top = tp?.top ?? C.pos[1] + C.pedestal;
  const LAY = chariotLayout();
  const grp = new THREE.Group();
  grp.name = 'chariot-group';
  grp.position.set(C.pos[0], top, C.pos[2]);
  grp.rotation.y = L.headingToRotY(C.heading);
  grp.scale.setScalar(LAY.groupScale ?? 1);
  const body = statueMat(engine, 'body'), gold = statueMat(engine, 'gold');
  const parts = [];
  const add = (m) => { grp.add(m); parts.push(m); stats.tris += tris(m.geometry); return m; };

  const waves = add(mesh(await statueGeometry('stat-waves'), body, { name: 'chariot-waves' }));
  const car = add(mesh(await statueGeometry('stat-car'), body, { name: 'chariot-car' }));
  const wheelG = await statueGeometry('stat-wheel');
  for (const W of LAY.wheels) add(mesh(wheelG, body, { pos: W.c, mirror: W.c[0] > 0, name: 'chariot-wheel' }));
  const horseInfo = [];
  for (const h of LAY.horses) {
    if (sunken && h.i === 4) continue; // broken off: lies on the paving (below)
    const key = sunken && h.i === 1 ? 'C-dmg' : h.variant;
    const g = await statueGeometry('stat-horse-' + key);
    const m = add(mesh(g, body, { pos: [h.x * HORSE_SPREAD, h.y, h.z], rotY: h.yaw, s: h.scale * HORSE_K, mirror: h.mirror, name: 'chariot-horse-' + h.i }));
    horseInfo.push(m);
  }
  const PS = LAY.poseidon;
  const pg = await statueGeometry('stat-poseidon-chariot');
  const pose = add(mesh(pg, body, { pos: PS.pos, s: PS.scale, name: 'chariot-poseidon' }));
  const T = poseidonSpec('chariot').trident;
  const tg = await statueGeometry('stat-trident-chariot');
  add(mesh(tg, gold, { pos: [PS.pos[0] + T.base[0] * PS.scale, PS.pos[1] + T.base[1] * PS.scale, PS.pos[2] + T.base[2] * PS.scale], s: PS.scale, name: 'chariot-trident' }));
  engine.add(grp);
  grp.updateMatrixWorld(true);

  // sunken: the broken horse lies on its side on the paving in front of the pedestal (ref 6)
  if (sunken) {
    const g = await statueGeometry('stat-horse-A-broken');
    const s = LAY.horses[4].scale * HORSE_K * (LAY.groupScale ?? 1);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, -Math.PI / 2 + 0.35, Math.PI / 2 - 0.15, 'YXZ'));
    const ground = L.CITADEL.summit + 0.15;
    // rest the lowest point on the paving (sunk a little into the sand)
    const P = g.attributes.position.array, M = new THREE.Matrix4().compose(new THREE.Vector3(), q, new THREE.Vector3(s, s, s));
    const e = M.elements;
    let minY = Infinity;
    for (let i = 0; i < P.length; i += 3) minY = Math.min(minY, e[1] * P[i] + e[5] * P[i + 1] + e[9] * P[i + 2]);
    const tpd = (tp?.d ?? 18) / 2;
    const m = mesh(g, body, { pos: [C.pos[0] + 6.5, ground - minY - 0.35, C.pos[2] + tpd + 7.5], quat: q, s, name: 'fallen-horse' });
    engine.add(m);
    stats.tris += tris(m.geometry);
    coralFrom(engine, m, 10, 0.9, 'fallen-horse', 'fh');
    for (const [i, hm] of horseInfo.entries()) coralFrom(engine, hm, 5, 0.8, 'chariot-horse', 'h' + i);
    coralFrom(engine, waves, 46, 1.1, 'chariot-waves', 'w');
    coralFrom(engine, car, 8, 0.8, 'chariot-car', 'c');
    coralFrom(engine, pose, 5, 0.6, 'chariot-poseidon', 'p');
  }
  reg.chariot = {
    origin: grp.position.toArray(), rotY: grp.rotation.y, top,
    horses: horseInfo.map((m) => m.getWorldPosition(new THREE.Vector3()).toArray()),
    poseidon: { pos: pose.getWorldPosition(new THREE.Vector3()).toArray(), height: 2 * PS.scale * (LAY.groupScale ?? 1) },
  };
  return grp;
}

// ------------------------------------------------------------------ Nereids on dolphins
async function buildNereids(engine, reg, stats) {
  const sunken = isSunken(engine);
  let slots = engine.slots.statue.filter((s) => s.tag === 'nereid');
  const basins = engine.registry.temple?.nereidBasins || [];
  if (!slots.length) {
    const N = L.NEREIDS;
    for (let i = 0; i < N.count; i++) {
      const a = (i / N.count) * Math.PI * 2;
      const x = N.center[0] + Math.sin(a) * N.radius, z = N.center[2] - Math.cos(a) * N.radius;
      if (z < 40) continue;
      slots.push({ pos: [x, L.CITADEL.summit + 1.55, z], facing: L.bearingOf(x - N.center[0], z - N.center[2]), tag: 'nereid' });
    }
  }
  const body = statueMat(engine, 'body');
  const S = 2.6;
  const out = [];
  for (const [i, s] of slots.entries()) {
    const v = NEREID_VARIANTS[i % NEREID_VARIANTS.length];
    const mirror = Math.floor(i / NEREID_VARIANTS.length) % 2 === 1;
    const g = await statueGeometry('stat-nereid-' + v);
    const B = basins.find((b) => Math.hypot(b.pos[0] - s.pos[0], b.pos[2] - s.pos[2]) < 1);
    const waterY = B ? B.waterY : s.pos[1] - 0.75;
    const rotY = L.headingToRotY(s.facing ?? 180) + (mirror ? 0.25 : -0.25);
    // the rider sits over the pedestal; the dolphin dives into the basin water beside it
    const m = mesh(g, body, { pos: [s.pos[0], waterY - 0.12, s.pos[2]], rotY, s: S, mirror, name: 'nereid-' + i });
    engine.add(m);
    stats.tris += tris(m.geometry);
    m.updateWorldMatrix(true, false);
    const mouth = new THREE.Vector3(...makeNereid(v).mouth).applyMatrix4(m.matrixWorld).toArray();
    out.push({ pos: m.position.toArray(), mouth, facing: s.facing, variant: v });
    if (sunken) coralFrom(engine, m, 4, 0.5, 'nereid', 'n' + i);
  }
  reg.nereids = out;
}

// ------------------------------------------------------------------ pediment sculpture (r6, ref 3)
// Two sculpted rearing winged horses in high relief either side of the tympanum's centre trident (the arch kit's
// pedimentRelief leaves |x| < horseGap free). Each horse is turned side-on to face the centre, flattened along the
// pediment normal (relief depth) and scaled to the largest size that stays under the raking cornice.
async function buildPedimentHorses(engine, reg, stats) {
  const sunken = isSunken(engine);
  const peds = (engine.registry.temple?.pediments || []).filter((P) => P.horseGap && P.normal[2] > 0.5);
  if (!peds.length) return;
  const body = statueMat(engine, 'body');
  const out = [];
  for (const P of peds) {
    const hb = P.baseWidth / 2 * 0.96, hp = P.height * 0.92;
    const avail = (x) => hp * (1 - Math.abs(x) / hb);
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...P.right), new THREE.Vector3(...P.up), new THREE.Vector3(...P.normal));
    for (const side of [-1, 1]) {
      if (sunken && side > 0 && ruined('pediment-horse', 0.5)) continue;   // one of them has fallen out of the broken pediment
      const key = side < 0 ? 'P' : 'Q';   // folded-wing profile poses (horse.js r6)
      const g = await statueGeometry('stat-horse-' + key);
      const Pa = g.attributes.position.array;
      // horse frame: +Z forward, +X its left side; turned so forward points to the centre (x → 0)
      const rot = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      let zMin = Infinity, zMax = -Infinity, xMax = 0;
      for (let i = 0; i < Pa.length; i += 3) { zMin = Math.min(zMin, Pa[i + 2]); zMax = Math.max(zMax, Pa[i + 2]); xMax = Math.max(xMax, Math.abs(Pa[i])); }
      const fits = (sc) => {
        const front = 1.5;                                   // forward-most point at |x| = front (beside the trident)
        for (let i = 0; i < Pa.length; i += 9) {
          const ax = front + (zMax - Pa[i + 2]) * sc;        // distance from the centre along the pediment
          const y = 0.25 + Pa[i + 1] * sc;
          if (y > avail(ax) + 0.4 || ax > P.horseGap + 0.8) return false;   // wing tips may tuck into the raking geison (it covers the full relief depth)
        }
        return true;
      };
      let lo = 0.6, hi = 3.0;
      for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      const sc = lo;
      const depthK = Math.min(0.5, Math.max(0.2, (P.depth - 0.25) / Math.max(0.3, xMax * sc)));
      const relief = new THREE.Group();
      relief.matrixAutoUpdate = false;
      relief.matrix.copy(basis).setPosition(...P.origin);
      const flat = new THREE.Group();
      flat.position.set(side * (1.5 + zMax * sc), 0.25, 0.3);
      flat.scale.set(1, 1, depthK);
      const m = mesh(g, body, { rotY: rot, s: sc, name: 'pediment-horse-' + key });
      flat.add(m); relief.add(flat);
      engine.add(relief);
      relief.updateMatrixWorld(true);
      stats.tris += tris(g);
      if (sunken) coralFrom(engine, m, 4, 0.5, 'pediment-horse', 'ph' + side);
      let yMx = 0; for (let i = 1; i < Pa.length; i += 3) yMx = Math.max(yMx, Pa[i]);
      out.push({ side, scale: +sc.toFixed(3), depthK: +depthK.toFixed(2), hb: +hb.toFixed(2), hp: +hp.toFixed(2), gap: +P.horseGap.toFixed(2), z: [+zMin.toFixed(2), +zMax.toFixed(2)], yMx: +yMx.toFixed(2), xMax: +xMax.toFixed(2) });
    }
  }
  reg.pedimentHorses = out;
  console.log('[statues] pediment horses', JSON.stringify(out));
}

// ------------------------------------------------------------------ the colossus
async function buildColossus(engine, reg, stats) {
  if (isSunken(engine)) return buildSunkenTrident(engine, reg, stats); // the figure is gone (its head lies on the sand: sets module, ref 8)
  const Cl = L.COLOSSUS;
  const slot = engine.slots.statue.find((s) => s.tag === 'colossus');
  const top = slot ? slot.pos[1] : (engine.registry.temple?.colossus?.top ?? Cl.pos[1] + Cl.pedestal);
  const H = slot?.size ?? Cl.height;
  const s = H / 2.0;
  const grp = new THREE.Group();
  grp.name = 'colossus';
  grp.position.set(Cl.pos[0], top, Cl.pos[2]);
  grp.rotation.y = L.headingToRotY(Cl.heading);
  const g = await statueGeometry('stat-poseidon-colossus');
  grp.add(mesh(g, statueMat(engine, 'body'), { s, name: 'colossus-figure' }));
  const T = poseidonSpec('colossus').trident;
  const tg = await statueGeometry('stat-trident-colossus');
  grp.add(mesh(tg, statueMat(engine, 'gold'), { pos: [T.base[0] * s, T.base[1] * s, T.base[2] * s], s, name: 'colossus-trident' }));
  engine.add(grp);
  stats.tris += tris(g) + tris(tg);
  grp.updateMatrixWorld(true);
  reg.colossus = { pos: grp.position.toArray(), height: H, tridentTop: new THREE.Vector3(T.base[0] * s, T.top[1] * s, T.base[2] * s).applyMatrix4(grp.matrixWorld).toArray() };
}

// r3 (director, ref 9): in the sunken era the colossus has fallen but its gold trident still stands upright in its socket
// on the pedestal top (same place as the golden figure's trident: L.COLOSSUS + poseidonSpec('colossus').trident), its tines
// breaking the surface (tip ≈ 29 m above L.SUNKEN.surface); a heap of broken marble (the statue's feet) around the butt.
async function buildSunkenTrident(engine, reg, stats) {
  const Cl = L.COLOSSUS;
  if (L.SUNKEN_TRIDENT && L.SUNKEN_TRIDENT.standing === false) { reg.colossus = null; return; }
  const top = engine.registry.temple?.colossus?.top ?? Cl.pos[1] + Cl.pedestal;
  const s = Cl.height / 2.0;
  const grp = new THREE.Group();
  grp.name = 'colossus-trident-sunken';
  grp.position.set(Cl.pos[0], top, Cl.pos[2]);
  grp.rotation.y = L.headingToRotY(Cl.heading);
  const T = poseidonSpec('colossus').trident;
  const tg = await statueGeometry('stat-trident-colossus');
  // a slight lean (it stood alone for millennia), pivoting on the butt
  const lean = new THREE.Group();
  lean.position.set(T.base[0] * s, 0, T.base[2] * s);
  lean.rotation.set(0.035, 0, -0.05);
  // r3 (citadel): encrusted gold (coral / verdigris patches, the gold glinting through; ref 9 / ref 8 trident)
  let tmat = statueMat(engine, 'gold');
  try { const MT = await import('../materials/metal.js'); tmat = MT.goldMaterial({ crust: 0.42, crustScale: 0.45 }); } catch (e) { console.warn('[statues] crusted gold skipped', e.message); }
  lean.add(mesh(tg, tmat, { pos: [0, T.base[1] * s - 0.6, 0], s, name: 'colossus-trident' }));
  grp.add(lean);
  // r3 (citadel, ref 9): the broken stump of the colossus — feet, shins and a shattered knee block, encrusted bronze —
  // rises from the pedestal toward the surface; its top fragment just breaks the water beside the trident
  try {
    const { roughBlockGeometry } = await import('../arch/ruins.js');
    const MT = await import('../materials/metal.js');
    const bm = MT.bronzeMaterial({ crust: 0.62, crustScale: 0.6 });
    const rise = L.SUNKEN.surface - top;   // ≈ 12 m of water over the pedestal
    const parts = [
      { size: [7.2, 2.4, 8.4], pos: [0, -0.3, 0.4], rot: [0, 0.1, 0] },                                   // the feet / plinth of the figure
      { size: [2.7, rise * 0.42, 3.0], pos: [-1.7, 2.0, 0.6], rot: [0.04, 0.2, 0.06] },                   // left shin
      { size: [2.5, rise * 0.36, 2.8], pos: [1.6, 2.0, -0.2], rot: [-0.05, -0.3, -0.08] },               // right shin (shorter)
      { size: [4.6, rise * 0.22, 3.6], pos: [-0.9, 2.0 + rise * 0.42 - 0.3, 0.4], rot: [0.08, 0.5, 0.12] },  // shattered knee block
      { size: [4.2, rise * 0.82, 3.8], pos: [T.base[0] * s * 0.7, 0.4, T.base[2] * s * 0.7 + 0.3], rot: [0.06, 0.7, -0.05] },   // fallen thigh block heaped against the shaft
      { size: [2.6, rise - (2.0 + rise * 0.64) + 2.4, 2.3], pos: [T.base[0] * s * 0.62 - 1.2, 2.0 + rise * 0.64 - 0.6, T.base[2] * s * 0.62 + 0.9], rot: [0.15, 1.1, -0.1] },  // top shard, breaks the surface (≈ 1.5 m)
      { size: [2.0, rise - (2.0 + rise * 0.6) + 1.2, 1.7], pos: [T.base[0] * s * 0.8 + 1.6, 2.0 + rise * 0.6 - 0.4, T.base[2] * s * 0.8 - 0.8], rot: [-0.2, 0.4, 0.18] },   // second shard, awash
    ];
    parts.forEach((P, i) => {
      const g = roughBlockGeometry({ size: P.size, seed: 70 + i, chip: 0.18, broken: { py: 0.6, nz: 0.4, px: 0.3 }, detail: 0.7 });
      const m = new THREE.Mesh(g, bm);
      m.position.set(...P.pos); m.rotation.set(...P.rot);
      m.name = 'colossus-stump-' + i;
      grp.add(m);
      stats.tris += tris(g);
    });
    for (let i = 0; i < 6; i++) engine.slots.coral.push({ pos: [Cl.pos[0] + (ruinRand('stumpc' + i) - 0.5) * 6, top + 2.2 + i * 0.6, Cl.pos[2] + (ruinRand('stumpc' + i, 1) - 0.5) * 6], normal: [0, 1, 0], size: 0.9, tag: 'colossus-stump' });
  } catch (e) { console.warn('[statues] colossus stump skipped', e.message); }
  // rubble of the feet around the butt
  try {
    const { roughBlockGeometry } = await import('../arch/ruins.js');
    const { whiteStone } = await import('../materials/stone.js');
    const mat = whiteStone({ weather: 0.85, seed: 6.1 });
    mat.userData.sunken = 'stone';
    const n = Math.max(3, Math.round((L.SUNKEN_TRIDENT?.rubble ?? 2.5) * 2.4));
    for (let i = 0; i < n; i++) {
      const a = ruinRand('colossus-rubble:' + i) * Math.PI * 2, d = 1.2 + 3.2 * ruinRand('colossus-rubble:' + i, 1);
      const sz = [1.6 + 2.2 * ruinRand('colossus-rubble:' + i, 2), 0.9 + 1.4 * ruinRand('colossus-rubble:' + i, 3), 1.4 + 1.8 * ruinRand('colossus-rubble:' + i, 4)];
      const g = roughBlockGeometry({ size: sz, seed: 40 + i, chip: 0.12, broken: { py: 0.35, nz: 0.3 }, detail: 0.6 });
      const m = new THREE.Mesh(g, mat);
      m.position.set(T.base[0] * s + Math.sin(a) * d, -0.2 + (i % 3 === 2 ? 0.8 : 0), T.base[2] * s + Math.cos(a) * d);
      m.rotation.set((ruinRand('colossus-rubble:' + i, 5) - 0.5) * 0.5, a, (ruinRand('colossus-rubble:' + i, 6) - 0.5) * 0.5);
      grp.add(m);
      stats.tris += tris(g);
    }
  } catch (e) { console.warn('[statues] colossus rubble skipped', e.message); }
  engine.add(grp);
  stats.tris += tris(tg);
  grp.updateMatrixWorld(true);
  const tip = new THREE.Vector3(0, T.L * s - 0.6, 0).applyMatrix4(lean.matrixWorld);
  reg.colossus = { pos: grp.position.toArray(), height: 0, sunkenTrident: true, tridentTop: tip.toArray() };
  console.log(`[statues] sunken colossus trident: tip y ${tip.y.toFixed(1)} (surface ${L.SUNKEN.surface})`);
}

// ------------------------------------------------------------------ small statues on slots
const POOLS = [
  [/stair|plaza|forecourt|temple/, ['king', 'nymph', 'king', 'priestess', 'kingSpear']],
  [/bridge|gate|pedestal|deck|pier/, ['kingSpear', 'king', 'kingSpear', 'nymph']],
  [/garden|terrace|niche|palace/, ['nymph', 'priestess', 'king']],
];
const CAMS = SHOTS.map((S) => {
  const P = new THREE.Vector3(...S.pos), F = new THREE.Vector3(...S.target).sub(P).normalize();
  return { P, F, tv: Math.tan(((S.fov / 2) * Math.PI) / 180) };
});
/** largest on-screen height (px at 941 rows) over the shot cameras of an object of height h at p */
function screenPx(p, h) {
  let best = 0;
  const d = new THREE.Vector3();
  for (const c of CAMS) {
    d.copy(p).sub(c.P);
    const z = d.dot(c.F);
    if (z < 1) continue;
    best = Math.max(best, (h / (c.tv * z)) * 470);
  }
  return best;
}

async function buildSmall(engine, reg, stats) {
  const sunken = isSunken(engine);
  const skip = new Set(['nereid', 'colossus', 'fountain-top']);
  const slots = engine.slots.statue.filter((s) => !skip.has(s.tag));
  if (!slots.length) return;
  const rng = engine.rng('statues-small');
  const buckets = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  let last = '';
  for (const [i, s] of slots.entries()) {
    const tag = String(s.tag || '') + ' ' + String(s.source || '');
    const pool = POOLS.find(([re]) => re.test(tag))?.[1] || STATUE_KINDS;
    let kind = s.type && STATUE_KINDS.includes(s.type) ? s.type : pool[Math.floor(rng.random() * pool.length)];
    if (kind === last) kind = pool[(pool.indexOf(kind) + 1) % pool.length];
    last = kind;
    const H = Math.max(1.2, s.size ?? 2.6);
    const sc = H / 2.0;
    const mirror = rng.random() < 0.5;
    let rotY = L.headingToRotY(s.facing ?? 180) + rng.range(-0.15, 0.15);
    pv.set(...s.pos);
    let quat = q.setFromAxisAngle(Y, rotY);
    const gilt = s.tag === 'pinnacle' || s.tag === 'stair-channel';   // r2: gold figures on pinnacles / roof corners; r5: + the gilt triton over the stair-channel source
    if (sunken) {
      if (ruined('statue:' + i, 0.3)) continue;                    // gone (buried / broken up)
      if (!gilt && ruined('statue-top:' + i, 0.35)) {                        // toppled off its pedestal, lying beside it
        const a = ruinRand('statue-top:' + i, 1) * Math.PI * 2;
        pv.set(s.pos[0] + Math.sin(a) * H * 0.6, s.pos[1] - 1.4, s.pos[2] + Math.cos(a) * H * 0.6);
        quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.1, a, 0, 'YXZ'));
      }
    }
    const lod = screenPx(pv, H) > 140 ? 0 : 1;
    const key = `${kind}|${lod}|${mirror ? 1 : 0}|${gilt ? 'g' : 'b'}`;
    if (!buckets.has(key)) buckets.set(key, []);
    m4.compose(pv, quat, sv.set(mirror ? -sc : sc, sc, sc));
    buckets.get(key).push(m4.clone());
    if (sunken && i % 2 === 0) engine.slots.coral.push({ pos: [pv.x, pv.y + H * 0.5, pv.z], normal: [0, 1, 0], size: 0.4, tag: 'small-statue' });
  }
  const mat = statueMat(engine, 'body'), goldMat = statueMat(engine, 'gold');
  let count = 0;
  for (const [key, list] of buckets) {
    const [kind, lod, mir, mk] = key.split('|');
    const g = await statueGeometry(`stat-small-${kind}-l${lod}`);
    // mirrored instances: negative-determinant instance matrices need flipped winding → separate geometry
    let geo = g;
    if (mir === '1') {
      geo = g.clone();
      const src = g.index.array, ix = new (src.constructor)(src.length);
      for (let t = 0; t < src.length; t += 3) { ix[t] = src[t]; ix[t + 1] = src[t + 2]; ix[t + 2] = src[t + 1]; }
      geo.setIndex(new THREE.BufferAttribute(ix, 1));
    }
    const im = new THREE.InstancedMesh(geo, mk === 'g' ? goldMat : mat, list.length);
    list.forEach((m, k) => im.setMatrixAt(k, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = 'small-statues-' + key;
    engine.add(im);
    stats.tris += tris(geo) * list.length;
    count += list.length;
  }
  reg.small = count;
}

// ------------------------------------------------------------------ module API
export async function build(engine) {
  const t0 = performance.now();
  const reg = (engine.registry.statues ||= {});
  const stats = { tris: 0 };
  await buildChariot(engine, reg, stats);
  await buildNereids(engine, reg, stats);
  await buildColossus(engine, reg, stats);
  try { await buildPedimentHorses(engine, reg, stats); } catch (e) { console.warn('[statues] pediment horses skipped', e.message); }
  await buildSmall(engine, reg, stats);
  reg.tris = stats.tris;
  console.log(`[statues] ${engine.era}: ${(stats.tris / 1e6).toFixed(2)} M tris, ${reg.nereids?.length ?? 0} nereids, ${reg.small ?? 0} small statues in ${Math.round(performance.now() - t0)} ms`);
}

/** isolated test: the chariot group on a stand-in pedestal at the origin, Nereids, the colossus, small statues */
export async function test(engine) {
  const C = L.CHARIOT;
  // stand-in pedestal so the group sits at its real height above the "plaza" (y = 0 here)
  const PD = { w: 24, d: 15, h: 5.4 };   // = temple.js PED
  const ped = new THREE.Mesh(new THREE.BoxGeometry(PD.w, PD.h, PD.d), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5 }));
  ped.position.set(0, PD.h / 2, 0);
  engine.add(ped);
  const off = new THREE.Vector3(-C.pos[0], -L.CITADEL.summit, -C.pos[2]);
  // fake temple registry + slots relative to the origin
  engine.registry.temple = { chariot: { pos: C.pos, top: L.CITADEL.summit + PD.h, w: PD.w, d: PD.d } };
  const before = new Set(engine.scene.children);
  const reg = (engine.registry.statues ||= {});
  const stats = { tris: 0 };
  const part = engine.params?.get?.('part');   // r2: 'nereid' → only the Nereids (quick look-dev)
  if (part !== 'nereid') await buildChariot(engine, reg, stats);
  for (const [i, x] of [-26, -18, 18, 26].entries()) engine.slots.statue.push({ pos: [C.pos[0] + x, L.CITADEL.summit + 1.55, C.pos[2] + 22], facing: 180 + (x < 0 ? -30 : 30), tag: 'nereid' });
  await buildNereids(engine, reg, stats);
  if (part === 'nereid') { for (const o of engine.scene.children) if (!before.has(o)) o.position.add(off); return { views: [{ pos: [-14, 5, 40], target: [-22, 5, 22], fov: 40, sun: { azimuth: 292, elevation: 14 } }, { pos: [-22, 4.5, 31], target: [-22, 4.2, 22], fov: 40, sun: { azimuth: 250, elevation: 25 } }] }; }
  engine.slots.statue.push({ pos: [C.pos[0] + 60, L.CITADEL.summit, C.pos[2] - 10], facing: 180, size: 30, tag: 'colossus' });
  for (let i = 0; i < 5; i++) engine.slots.statue.push({ pos: [C.pos[0] - 40 + i * 4, L.CITADEL.summit, C.pos[2] + 20], facing: 180, size: 3, tag: 'stair-pedestal' });
  await buildSmall(engine, reg, stats);
  // colossus at its own slot position (buildColossus uses L.COLOSSUS.pos; place a second copy next to the group)
  if (!isSunken(engine)) {
    const g = await statueGeometry('stat-poseidon-colossus');
    const m = mesh(g, statueMat(engine, 'body'), { pos: [C.pos[0] + 60, L.CITADEL.summit, C.pos[2] - 10], s: 15, name: 'colossus-test' });
    engine.add(m);
    const T = poseidonSpec('colossus').trident;
    engine.add(mesh(await statueGeometry('stat-trident-colossus'), statueMat(engine, 'gold'), { pos: [C.pos[0] + 60 + T.base[0] * 15, L.CITADEL.summit + T.base[1] * 15, C.pos[2] - 10 + T.base[2] * 15], s: 15 }));
  }
  for (const o of engine.scene.children) if (!before.has(o)) o.position.add(off);
  console.log(`[statues] test: ${(stats.tris / 1e6).toFixed(2)} M tris`);
  const v = (pos, target, fov = 40) => ({ pos, target, fov, sun: { azimuth: 292, elevation: 14 } });
  return {
    views: [
      v([10, 6, 75], [0, 15, 0], 34),            // 0 hero front (ref 3 framing)
      v([38, 14, 48], [0, 14, 0], 38),            // 1 three-quarter
      v([8, 14, 26], [-4, 15, 0], 42),            // 2 close: horse heads + wings
      v([6, 22, 16], [0, 22, -6], 40),            // 3 close: Poseidon
      v([-14, 5, 40], [-22, 5, 22], 40),          // 4 nereid
      v([80, 14, 60], [60, 22, -10], 40),         // 5 colossus
      v([-32, 3, 34], [-32, 2, 20], 40),          // 6 small statues
      v([-30, 12, 40], [0, 12, 0], 40),           // 7 left three-quarter
    ],
  };
}
// keep imports referenced (pose presets are used by the bake / tests)
void HORSE_POSES; void makeHorse;
