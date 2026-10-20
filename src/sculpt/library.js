// Statue geometry library for ATLANTIS: every heavy SDF sculpt is a named job, meshed + baked through
// loadOrBuild() (node tools/bake.mjs statues → generated/stat-*.bin). In the browser an unbaked job is built
// at reduced detail so a missing bake never stalls the world build for long.
//
// Baked attribute layout (bakeutil.bakeAttributes): color (Uint8 n) r = AO, g = cavity, b = metal mask
// (0.85 gilt body, 1 polished harness / crown). Units are each sculpt's own (see the job notes).
import { loadOrBuild } from '../core/cache.js';
import { meshRegion, bakeAttributes, mergeGeos, triCount } from './bakeutil.js';
import { makeHorse, HORSE_POSES } from './horse.js';
import { poseidonSpec, tridentSdf } from './poseidon.js';
import { makeNereid, NEREID_VARIANTS } from './nereid.js';
import { chariotLayout, carSdf, carGold, wheelSdf, waveBaseSdf } from './chariot.js';
import { STATUE_KINDS, buildSmallStatue } from './statuary.js';
import { decimate, sdfNormals } from './decimate.js';

export const STAT_VERSION = 2; // r2 (arch-b): QEM-decimated bakes, swept-back wing twins, Nereid drapery, lower waves

/** decimation targets (triangles) per job family — tuned for the shot distances (≥ 25 m for the group) */
const BUDGET = { horse: 115000, poseidon: 150000, colossus: 90000, nereid: 80000, car: 70000, wheel: 26000, waves: 150000, trident: 24000 };
/** QEM-decimate an SDF mesh, re-derive SDF normals and bake AO / cavity / gilt (runtime builds stay coarse) */
function reduce(g, target, sdf, cell, goldFn, bakeOpts) {
  if (isNode && g.index.count / 3 > target * 1.1) {
    const t0 = Date.now(), n0 = triCount(g);
    g = decimate(g, target);
    sdfNormals(g, sdf, cell * 0.5);
    log(`  decimated ${n0} → ${triCount(g)} tris in ${Date.now() - t0} ms`);
  }
  return bakeAttributes(g, sdf, goldFn, bakeOpts);
}
const isNode = typeof window === 'undefined';
const log = (...a) => { if (typeof console !== 'undefined') console.log('[statues]', ...a); };

/** fallback detail for runtime (unbaked) builds: coarse but quick */
export const RUNTIME_DETAIL = 0.3;

function horseJob(key, spec) {
  return {
    name: `stat-horse-${key}-v${STAT_VERSION}`,
    build: (detail = 1) => {
      const t0 = Date.now();
      const H = makeHorse(spec);
      const cell = 0.0115 / Math.sqrt(detail);
      let g = meshRegion(H.sdf, H.bounds, cell, { smooth: 1, bandScale: 1.7 });
      g = reduce(g, BUDGET.horse, H.sdf, cell, H.gold, { aoDist: 0.3, cavDist: 0.025, extraOcc: (x, y) => Math.max(0, 0.4 * (1 - y / 0.3)) });
      log(`horse ${key}: ${triCount(g)} tris in ${Date.now() - t0} ms`);
      return g;
    },
  };
}

function poseidonJobs(variant, res) {
  const out = [];
  out.push({
    name: `stat-poseidon-${variant}-v${STAT_VERSION}`,
    build: (detail = 1) => {
      const t0 = Date.now();
      const P = poseidonSpec(variant);
      const fig = P.fig;
      const f = 1 / Math.sqrt(detail);
      const T = P.trident, tri = tridentSdf(T.L, T.r);
      const full = (x, y, z) => Math.min(fig.sdf(x, y, z), tri(x - T.base[0], y - T.base[1], z - T.base[2]));
      const body = meshRegion(fig.bodySdf, fig.bounds, res.body * f, { smooth: 1 });
      const head = meshRegion(fig.headSdf, fig.headBounds, res.head * f, { smooth: 1 });
      bakeAttributes(body, full, fig.gold, { aoDist: 0.09, cavDist: 0.01 });
      bakeAttributes(head, full, fig.gold, { aoDist: 0.06, cavDist: 0.006 });
      const hands = fig.hands.map((H) => { const hg = meshRegion(H.sdf, H.bounds, res.head * 1.15 * f, { smooth: 1 }); bakeAttributes(hg, full, fig.gold, { aoDist: 0.05, cavDist: 0.006 }); return hg; });
      let g = mergeGeos([body, head, ...hands]);
      if (isNode) { g = decimate(g, variant === 'colossus' ? BUDGET.colossus : BUDGET.poseidon); sdfNormals(g, full, res.head * f * 0.5); bakeAttributes(g, full, fig.gold, { aoDist: 0.08, cavDist: 0.008 }); }
      log(`poseidon ${variant}: ${triCount(g)} tris in ${Date.now() - t0} ms`);
      return g;
    },
  });
  out.push({
    name: `stat-trident-${variant}-v${STAT_VERSION}`,
    build: (detail = 1) => {
      const P = poseidonSpec(variant);
      const T = P.trident, tri = tridentSdf(T.L, T.r);
      const cell = res.head * 1.1 / Math.sqrt(detail);
      const g = meshRegion(tri, { min: [-0.2, 0, -0.05], max: [0.2, T.L + 0.02, 0.05] }, cell, { smooth: 1 });
      return reduce(g, BUDGET.trident * (variant === 'colossus' ? 0.7 : 1), tri, cell, () => 1, { aoDist: 0.04, cavDist: 0.005 });
    },
  });
  return out;
}

function nereidJob(v) {
  return {
    name: `stat-nereid-${v}-v${STAT_VERSION}`,
    build: (detail = 1) => {
      const t0 = Date.now();
      const N = makeNereid(v);
      const f = 1 / Math.sqrt(detail);
      const body = meshRegion(N.bodySdf, N.bounds, 0.011 * f, { smooth: 1 });
      const head = meshRegion(N.fig.headSdf, N.fig.headBounds, 0.0055 * f, { smooth: 1 });
      bakeAttributes(body, N.sdf, N.gold, { aoDist: 0.1, cavDist: 0.012, extraOcc: (x, y) => Math.max(0, 0.35 * (1 - y / 0.1)) });
      bakeAttributes(head, N.sdf, N.gold, { aoDist: 0.06, cavDist: 0.006 });
      const hands = N.fig.hands.map((H) => { const hg = meshRegion(H.sdf, H.bounds, 0.0065 * f, { smooth: 1 }); bakeAttributes(hg, N.sdf, N.gold, { aoDist: 0.05, cavDist: 0.006 }); return hg; });
      let g = mergeGeos([body, head, ...hands]);
      if (isNode) { g = decimate(g, BUDGET.nereid); sdfNormals(g, N.sdf, 0.003 * f); bakeAttributes(g, N.sdf, N.gold, { aoDist: 0.09, cavDist: 0.009, extraOcc: (x, y) => Math.max(0, 0.35 * (1 - y / 0.1)) }); }
      log(`nereid ${v}: ${triCount(g)} tris in ${Date.now() - t0} ms`);
      return g;
    },
  };
}

function chariotJobs() {
  const LAY = chariotLayout();
  const car = carSdf(LAY.car), wheel = wheelSdf({ c: [0, 0, 0], R: LAY.wheels[0].R }), wave = waveBaseSdf(LAY);
  return [
    {
      name: `stat-car-v${STAT_VERSION}`,
      build: (detail = 1) => {
        const c = LAY.car.c;
        const cell = 0.045 / Math.sqrt(detail);
        const g = meshRegion(car, { min: [c[0] - 4.8, LAY.car.floor - 1.3, c[2] - 3.2], max: [c[0] + 4.8, LAY.car.floor + 5.2, c[2] + 3.9] }, cell, { smooth: 1, bandScale: 2 });
        return reduce(g, BUDGET.car, car, cell, carGold(LAY.car), { aoDist: 0.6, cavDist: 0.06 });
      },
    },
    {
      name: `stat-wheel-v${STAT_VERSION}`,
      build: (detail = 1) => {
        const R = LAY.wheels[0].R;
        const cell = 0.035 / Math.sqrt(detail);
        const g = meshRegion(wheel, { min: [-0.9, -R - 0.3, -R - 0.3], max: [0.9, R + 0.3, R + 0.3] }, cell, { smooth: 1 });
        return reduce(g, BUDGET.wheel, wheel, cell, () => 0.9, { aoDist: 0.4, cavDist: 0.04 });
      },
    },
    {
      name: `stat-waves-v${STAT_VERSION}`,
      build: (detail = 1) => {
        const W = LAY.footprint.w / 2, D = LAY.footprint.d / 2;
        const cell = 0.085 / Math.sqrt(detail);
        const g = meshRegion(wave, { min: [-W, -0.05, -D], max: [W, 11.5, D] }, cell, { smooth: 1, bandScale: 2.2 });
        return reduce(g, BUDGET.waves, wave, cell, () => 0.85, { aoDist: 0.9, cavDist: 0.08 });
      },
    },
  ];
}

/** every job (name → build) — the bake and the runtime share these names */
export function statueJobs() {
  const jobs = [];
  for (const k of Object.keys(HORSE_POSES)) jobs.push(horseJob(k, HORSE_POSES[k]));
  // sunken-era damage: a horse broken off at the hind legs with a snapped wing (lies on the paving, ref 6),
  // and a variant with a broken wing tip for the group
  jobs.push(horseJob('A-broken', { ...HORSE_POSES.A, broken: { hindL: 0.35, hindR: 0.55, wingR: 0.55 } }));
  jobs.push(horseJob('C-dmg', { ...HORSE_POSES.C, broken: { wingL: 0.95 } }));
  jobs.push(...poseidonJobs('chariot', { body: 0.0085, head: 0.0034 }));
  jobs.push(...poseidonJobs('colossus', { body: 0.012, head: 0.005 }));
  for (const v of NEREID_VARIANTS) jobs.push(nereidJob(v));
  jobs.push(...chariotJobs());
  for (const k of STATUE_KINDS) for (const lod of [0, 1]) jobs.push({ name: `stat-small-${k}-l${lod}-v${STAT_VERSION}`, build: (detail = 1) => buildSmallStatue(k, lod, detail) });
  return jobs;
}

const JOBS = new Map();
export function job(name) {
  if (!JOBS.size) for (const j of statueJobs()) JOBS.set(j.name.replace(/-v\d+$/, ''), j);
  return JOBS.get(name);
}
/** load (baked) or build one sculpt by its short name, e.g. 'stat-horse-A' */
export async function statueGeometry(short, detail = 1) {
  const j = job(short);
  if (!j) throw new Error('unknown statue job ' + short);
  return loadOrBuild(j.name, () => j.build(isNode ? detail : Math.min(detail, RUNTIME_DETAIL)));
}
