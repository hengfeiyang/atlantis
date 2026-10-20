// Shot 8 (sunken HERO, ref 8): the giant fallen bronze head of Poseidon with its spiked gold crown,
// the broken gold trident, toppled red-white banded columns with gold capitals and navy-gold meander
// collars, a broken trident mosaic, broken slabs and rubble, half buried in drifted sand.
// Composed in a frame anchored at L.FALLEN_HEAD and oriented by the shot-8 camera direction; the
// design camera (frame.cam) is the recommended shot-8 camera (see suggestedShot8()).
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { loadOrBuild } from '../core/cache.js';
import { makeFrame, shotForward } from './frame.js';
import { buildHeadGeometry, buildCrownGeometry, HEAD_SCALE } from './poseidonHead.js';
import { buildTridentGeometry } from './trident.js';
import { buildStone } from './ruinkit.js';
import { buildColumn, hashSpec } from './columns.js';
import { mosaicMaterial, brokenDiscGeometry } from './mosaic.js';
import { headBronzeMaterial, setGoldMaterial, setTridentGoldMaterial, setSandMaterial, rubbleMaterial, bandedColumnMaterial } from './materials.js';
import { RNG } from '../core/rng.js';
import { Simplex } from '../core/noise.js';

export const HEAD_GEN = 'h2';
// head pose fitted to ref-8 landmarks (src/sets/dev/fit.mjs) in the design camera (fwd = -Z):
// Euler YXZ + reference pixel / camera depth of the head origin
export const HEAD_POSE = { euler: [0.0274, 0.2651, 7.2087], px: [581.8, 405], depth: 12.07, localUp: [0.799, 0.601, -0.027] };
const FRAME = { px: [640, 600], depth: 11.5, eye: 1.8, pitch: 1 };

/** geometry jobs (shared with the bake: src/bake/sets.js) */
export function headJobs() {
  return [
    { id: 'head', name: (q) => `sets-head-${HEAD_GEN}-q${q >= 1 ? 1 : 0}`, build: (q) => buildHeadGeometry({ cell: q >= 1 ? 0.025 : 0.045, up: HEAD_POSE.localUp }) },
    { id: 'crown', name: (q) => `sets-crown-${HEAD_GEN}-q${q >= 1 ? 1 : 0}`, build: (q) => buildCrownGeometry({ cell: q >= 1 ? 0.019 : 0.034, up: HEAD_POSE.localUp }) },
    { id: 'trident', name: (q) => `sets-trident-t1-q${q >= 1 ? 1 : 0}`, build: (q) => buildTridentGeometry({ cell: q >= 1 ? 0.022 : 0.04, shaft: 7.5 }) },
  ];
}
async function job(id, q) { const j = headJobs().find((k) => k.id === id); return loadOrBuild(j.name(q), () => j.build(q)); }

/** the set frame for the current layout / shot-8 direction */
export function frame8(o = {}) {
  const P = o.anchor || L.FALLEN_HEAD.pos;
  const groundY = o.groundY ?? P[1];
  return makeFrame({ anchor: [P[0], groundY, P[2]], px: FRAME.px, depth: FRAME.depth, fwd: o.fwd || shotForward(8), eye: FRAME.eye, groundY, pitch: FRAME.pitch });
}
/** recommended shot-8 camera (pos, target, fov) for the director */
export function suggestedShot8() { const F = frame8(); return F.shot(); }

function headMatrix(F) {
  const a = Math.atan2(-F.fwd.x, -F.fwd.z);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...HEAD_POSE.euler, 'YXZ')));
  const t = F.at(HEAD_POSE.px[0], HEAD_POSE.px[1], HEAD_POSE.depth);
  return new THREE.Matrix4().compose(t, q, new THREE.Vector3(1, 1, 1)); // geometry is already in metres
}

/**
 * @param {object} engine
 * @param {object} o { frame, ground(x,z), sunken, q }
 * @returns {{ group: THREE.Group, stats }}
 */
export async function buildFallenHeadSet(engine, o) {
  const F = o.frame, G = o.ground, q = o.q, sunken = o.sunken !== false;
  const gy = (x, z) => G(x, z);
  const group = new THREE.Group(); group.name = 'sets:fallenHead';
  const occ = [];         // burial occupants: { pts: Float32Array world xyz, level, slope }
  const coral = [];
  const rng = new RNG('set8');

  // ---------------------------------------------------------------- head + crown
  const M = headMatrix(F);
  const hg = await job('head', q), cg = await job('crown', q);
  const head = new THREE.Mesh(hg, headBronzeMaterial(true)); head.name = 'setPoseidonHead';
  const crown = new THREE.Mesh(cg, setGoldMaterial(true)); crown.name = 'setPoseidonCrown';
  for (const m of [head, crown]) { m.matrixAutoUpdate = false; m.matrix.copy(M); group.add(m); }
  occ.push({ pts: worldPts(hg, M, 3), level: 0.95, bury: 0.6, slope: 0.32, pad: 0.1 });
  harvestCoral(hg, M, coral, rng, 9, 'head', { flags: [1, 2], maxH: 3.2, g0: gy(F.pos.x, F.pos.z) });
  harvestCoral(cg, M, coral, rng, 3, 'crown');

  // ---------------------------------------------------------------- trident (lying flat, prongs toward the camera-right)
  {
    const g0 = gy(F.pos.x, F.pos.z);
    const C = F.atPlane(1114, 600, g0 + 0.45);
    const T = F.atPlane(1515, 712, g0 + 0.35);
    const ax = T.clone().sub(C).setY(0).normalize();
    const tg = await job('trident', q);
    const m = new THREE.Mesh(tg, setTridentGoldMaterial()); m.name = 'setTrident';
    // local: y = prongs (ax), z = up (prong plane horizontal), tilted a little so a side prong rests on the sand
    const yv = ax.clone(), zv = new THREE.Vector3(0, 1, 0).applyAxisAngle(ax, 0.12), xv = new THREE.Vector3().crossVectors(yv, zv).normalize();
    zv.crossVectors(xv, yv).normalize();
    const mat = new THREE.Matrix4().makeBasis(xv, yv, zv);
    // collar centre sits at local y = -1.05; place it at C
    const origin = C.clone().addScaledVector(yv, 1.05);
    origin.y = gy(origin.x, origin.z) + 0.42;
    mat.setPosition(origin);
    m.matrixAutoUpdate = false; m.matrix.copy(mat);
    group.add(m);
    occ.push({ pts: worldPts(tg, mat, 2), level: 0.3, bury: 0.1, slope: 0.5, pad: 0.05 });
    harvestCoral(tg, mat, coral, rng, 2, 'trident');
    engine.registry.sets = { ...(engine.registry.sets || {}), tridentHead: origin.toArray(), tridentAxis: ax.toArray() };
  }

  // ---------------------------------------------------------------- columns
  const colAt = (px, py, depth) => { const p = F.at(px, py, depth); return p; };
  const cols = [];
  const lying = (c, dirCam, len, r, seed, extra = {}) => {
    const d = F.camVec(...dirCam).setY(0).normalize();
    const base = c.clone().addScaledVector(d, -len / 2); base.y = gy(base.x, base.z) + r - (extra.sink ?? 0.18);
    const top = c.clone().addScaledVector(d, len / 2); top.y = gy(top.x, top.z) + r - (extra.sink ?? 0.18);
    const axis = top.clone().sub(base); const L0 = axis.length(); axis.normalize();
    return { base, axis, r, seed, len: L0, ...extra };
  };
  // C1: front-left, lying across the frame (both ends with meander collars)
  {
    const c = colAt(150, 610, 8.6);
    cols.push(lying(c, [-0.92, 0, 0.38], 6.4, 0.62, 's8c1', { pieces: [{ h: 6.4, breakBottom: 0.1, chips: 7 }], meanders: [0.35, 5.75] }));
  }
  // C2: left, standing, gold capital (top out of frame)
  {
    const p = colAt(70, 520, 16); const base = new THREE.Vector3(p.x, gy(p.x, p.z) - 0.4, p.z);
    cols.push({ base, axis: new THREE.Vector3(0.03, 1, 0.01).normalize(), r: 0.8, seed: 's8c2', pieces: [{ h: 4.2 }, { h: 4.0 }, { h: 3.6 }], capital: true, meanders: [0.6] });
  }
  // C3: far right edge, standing
  {
    const p = colAt(1650, 520, 12); const base = new THREE.Vector3(p.x, gy(p.x, p.z) - 0.4, p.z);
    cols.push({ base, axis: new THREE.Vector3(-0.02, 1, 0).normalize(), r: 0.72, seed: 's8c3', pieces: [{ h: 3.8 }, { h: 3.6 }, { h: 3.4 }], capital: true, meanders: [0.5] });
  }
  // C4: right, leaning toppled column with its capital up-left
  {
    const A = colAt(1720, 600, 9.5), B = colAt(1470, 345, 12.5);
    A.y = gy(A.x, A.z) + 0.25;
    const axis = B.clone().sub(A); const len = axis.length(); axis.normalize();
    cols.push({ base: A, axis, r: 0.62, seed: 's8c4', pieces: [{ h: len * 0.55, breakBottom: 0.15 }, { h: len * 0.45 - 0.05, gap: 0.04 }], capital: true, meanders: [len - 0.45] });
  }
  // C5: mid-right, lying on the sand (receding), gold-blue collar at its near end
  {
    const c = colAt(1380, 495, 19);
    cols.push(lying(c, [0.85, 0, -0.52], 5.6, 0.68, 's8c5', { pieces: [{ h: 2.6, breakBottom: 0.12 }, { h: 2.9, gap: 0.12, roll: 0.4 }], meanders: [0.4] }));
  }
  // C6/C7: background standing broken columns
  {
    const p = colAt(1210, 520, 24); const base = new THREE.Vector3(p.x, gy(p.x, p.z) - 0.3, p.z);
    cols.push({ base, axis: new THREE.Vector3(0, 1, 0), r: 0.7, seed: 's8c6', pieces: [{ h: 3.5 }, { h: 3.2 }], capital: true });
    const p2 = colAt(1050, 520, 31); const base2 = new THREE.Vector3(p2.x, gy(p2.x, p2.z) - 0.3, p2.z);
    cols.push({ base: base2, axis: new THREE.Vector3(0.02, 1, 0).normalize(), r: 0.7, seed: 's8c7', pieces: [{ h: 3.4 }, { h: 3.0, breakTop: 0.3 }] });
    const p3 = colAt(880, 520, 35); const base3 = new THREE.Vector3(p3.x, gy(p3.x, p3.z) - 0.3, p3.z);
    cols.push({ base: base3, axis: new THREE.Vector3(0, 1, 0), r: 0.7, seed: 's8c8', pieces: [{ h: 3.6 }, { h: 3.4 }, { h: 1.6, breakTop: 0.25 }] });
  }
  for (const c of cols) {
    const res = await buildColumn(c, q, true);
    for (const m of res.meshes) group.add(m);
    const lie = Math.abs(c.axis.y) < 0.6;
    if (lie) occ.push({ seg: [c.base, res.top], r: c.r, level: 0.32, slope: 0.6, pad: 0.15 });
    else occ.push({ seg: [c.base, c.base.clone().addScaledVector(c.axis, 0.2)], r: c.r, level: 0.6, slope: 0.6, pad: 0.3 });
    // coral on the upper side of lying shafts / capitals
    for (let k = 0; k < 3; k++) {
      const t = rng.next();
      const p = c.base.clone().addScaledVector(c.axis, t * res.len);
      const n = lie ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(rng.next() - 0.5, 0.2, rng.next() - 0.5).normalize();
      p.addScaledVector(n, c.r);
      if (k < 2) coral.push({ pos: p.toArray(), normal: n.toArray(), size: 0.2 + 0.3 * rng.next(), tag: 'set8:column' });
    }
  }

  // ---------------------------------------------------------------- mosaic (broken medallion on the floor in front)
  const mosR = 5.2;
  {
    const c = F.atPlane(430, 860, gy(F.pos.x, F.pos.z));
    const { geometry } = brokenDiscGeometry(mosR, { seed: 'set8mos', step: q >= 1 ? 0.06 : 0.1, missing: 0.14, bite: [3.6, -3.4], biteR: 1.6 });
    const m = new THREE.Mesh(geometry, mosaicMaterial(true)); m.name = 'setMosaic';
    // rotate so the trident glyph stands upright for the camera
    const yaw = Math.atan2(F.fwd.x, F.fwd.z);
    m.position.set(c.x, gy(c.x, c.z) + 0.16, c.z);
    m.rotation.y = yaw + Math.PI;
    group.add(m);
    engine.registry.sets = { ...(engine.registry.sets || {}), mosaic8: { center: [c.x, c.z], radius: mosR } };
    o.mosaic = { x: c.x, z: c.z, r: mosR, y: m.position.y };
  }

  // ---------------------------------------------------------------- broken slabs + rubble
  const stoneMat = rubbleMaterial(true);
  const STONES = [
    { px: [820, 790], dims: [1.5, 0.22, 0.9], yaw: 18, tilt: [4, -6], onMosaic: true },
    { px: [1005, 840], dims: [1.0, 0.2, 0.7], yaw: -12, tilt: [-5, 4], onMosaic: true },
    { px: [575, 690], dims: [0.7, 0.32, 0.5], yaw: 40, tilt: [8, 10] },
    { px: [690, 712], dims: [0.45, 0.25, 0.4], yaw: -20, tilt: [5, -12] },
    { px: [1270, 760], dims: [0.6, 0.3, 0.45], yaw: 25, tilt: [6, 6] },
    { px: [880, 650], dims: [0.5, 0.28, 0.4], yaw: 60, tilt: [0, 8] },
    { px: [140, 880], dims: [0.6, 0.3, 0.45], yaw: 12, tilt: [3, 5] },
    { px: [1180, 690], dims: [0.4, 0.22, 0.32], yaw: 70, tilt: [10, 0] },
    { px: [360, 720], dims: [0.55, 0.3, 0.42], yaw: -50, tilt: [4, 9] },
    { px: [1580, 700], dims: [0.6, 0.3, 0.5], yaw: 15, tilt: [-6, 7] },
    { px: [760, 920], dims: [0.35, 0.2, 0.3], yaw: 33, tilt: [12, -9] },
  ];
  for (let i = 0; i < STONES.length; i++) {
    const s = STONES[i];
    const spec = { kind: 'block', dims: s.dims, seed: 's8st' + i, chips: 8, broken: i % 3 === 0 ? 1 : 0, split: i === 1 ? 0.6 : 0 };
    const cell = Math.min(0.03, Math.min(...s.dims) / 8) * (q >= 1 ? 1 : 1.6);
    const g = await loadOrBuild(`sets-stone-${hashSpec({ ...spec, cell })}`, () => buildStone({ ...spec, cell }));
    const g0 = gy(F.pos.x, F.pos.z);
    const p = F.atPlane(s.px[0], s.px[1], g0 + s.dims[1] * 0.4);
    p.y = (s.onMosaic ? o.mosaic.y + s.dims[1] * 0.5 - 0.02 : gy(p.x, p.z) + s.dims[1] * 0.35);
    const mesh = new THREE.Mesh(g, stoneMat); mesh.name = 'setRubble';
    mesh.position.copy(p);
    mesh.rotation.set(s.tilt[0] * Math.PI / 180, Math.atan2(F.fwd.x, F.fwd.z) + s.yaw * Math.PI / 180, s.tilt[1] * Math.PI / 180, 'YXZ');
    group.add(mesh);
    if (!s.onMosaic) occ.push({ pts: new Float32Array([p.x, p.y - s.dims[1] * 0.5, p.z]), level: 0.12, slope: 0.6, pad: Math.max(s.dims[0], s.dims[2]) * 0.45 });
  }

  // ---------------------------------------------------------------- sand drifts burying everything
  const sand = buildSandDrift(F, gy, occ, o.mosaic, q);
  group.add(sand);

  for (const c of coral) engine.slots.coral.push(c);
  // hand-placed reef dressing read off ref 8 (marine places it as is)
  if (sunken && engine.slots?.coral) {
    try { const { dressShot8 } = await import('./dress8.js'); o.dressed = dressShot8(engine, F, group); } catch (e) { console.warn('[sets] dress8 failed', e); }
  }
  // keep-clear zones for marine scatter (the face, the mosaic and the trident head must stay readable)
  const hc = new THREE.Vector3(0, -0.15, 0.45).multiplyScalar(HEAD_SCALE).applyMatrix4(M);
  engine.registry.sets = { ...(engine.registry.sets || {}), keepClear8: [{ x: hc.x, z: hc.z, r: 3.2 }, { x: o.mosaic.x, z: o.mosaic.z, r: o.mosaic.r * 0.9 }, { x: engine.registry.sets?.tridentHead?.[0] ?? hc.x, z: engine.registry.sets?.tridentHead?.[2] ?? hc.z, r: 2.5 }] };
  return { group, coral: coral.length };
}

// ------------------------------------------------------------------ helpers
/** world positions (every k-th vertex) of a geometry under matrix M */
function worldPts(geo, M, k = 1) {
  const p = geo.attributes.position.array, n = Math.floor(p.length / 3 / k);
  const out = new Float32Array(n * 3);
  const e = M.elements;
  for (let i = 0; i < n; i++) {
    const x = p[i * k * 3], y = p[i * k * 3 + 1], z = p[i * k * 3 + 2];
    out[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}
/** coral anchor slots on up-facing, open surfaces of a mesh */
function harvestCoral(geo, M, out, rng, count, tag, o = {}) {
  const p = geo.attributes.position.array, nr = geo.attributes.normal.array, n = p.length / 3;
  const nm = new THREE.Matrix3().getNormalMatrix(M);
  let tries = 0, got = 0;
  while (got < count && tries < count * 200) {
    tries++;
    const i = Math.floor(rng.next() * n);
    const N = new THREE.Vector3(nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2]).applyMatrix3(nm).normalize();
    if (N.y < 0.45) continue;
    if (o.flags && geo.attributes.aux && !o.flags.includes(Math.round(geo.attributes.aux.array[i * 4 + 3]))) continue;
    const P = new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(M);
    if (o.maxH !== undefined && P.y - o.g0 > o.maxH) continue;
    out.push({ pos: P.toArray(), normal: N.toArray(), size: 0.18 + 0.3 * rng.next(), tag: 'set8:' + tag });
    got++;
  }
}

/**
 * Sand surface over the set: terrain ground raised into drifts around the buried objects (level above
 * the local ground inside each object's footprint, falling off with a sand slope), kept clear of the
 * mosaic's interior, with a drift ring around it.
 */
function buildSandDrift(F, gy, occ, mos, q) {
  const N = new Simplex(4401);
  const step = q >= 1 ? 0.12 : 0.22;
  const x0 = -16, x1 = 16, z0 = 1.5, z1 = 34; // frame-local extent (right, forward)
  const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
  const W = nx + 1, H = nz + 1;
  const wx = new Float32Array(W * H), wz = new Float32Array(W * H), base = new Float32Array(W * H), lvl = new Float32Array(W * H).fill(-1e9);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = F.local(x0 + i * step, 0, z0 + j * step);
    const k = j * W + i; wx[k] = p.x; wz[k] = p.z; base[k] = gy(p.x, p.z);
  }
  // footprint stamps: for each occupant, rasterise its points into a coarse mask, then spread with a slope
  const toIJ = (x, z) => {
    const dx = x - F.pos.x, dz = z - F.pos.z;
    const lx = dx * F.right.x + dz * F.right.z, lz = dx * F.fwd.x + dz * F.fwd.z;
    return [(lx - x0) / step, (lz - z0) / step];
  };
  for (const O of occ) {
    const pts = [];
    if (O.pts) for (let i = 0; i < O.pts.length; i += 3) pts.push([O.pts[i], O.pts[i + 2], O.pts[i + 1]]);
    if (O.seg) { const [a, b] = O.seg; const L0 = a.distanceTo(b); const n = Math.max(2, Math.ceil(L0 / 0.2)); for (let s = 0; s <= n; s++) { const p = a.clone().lerp(b, s / n); pts.push([p.x, p.z, p.y - (O.r || 0)]); } }
    const pad = (O.pad || 0) + (O.r || 0) * 0.8;
    const reach = pad + O.level / O.slope + 0.5;
    const R = Math.ceil(reach / step);
    const mask = new Uint8Array(W * H), minY = new Float32Array(W * H).fill(1e9);
    for (const [x, z, y] of pts) {
      const [fi, fj] = toIJ(x, z); const ci = Math.round(fi), cj = Math.round(fj);
      if (ci >= 0 && cj >= 0 && ci < W && cj < H) { const k = cj * W + ci; mask[k] = 1; if (y < minY[k]) minY[k] = y; }
    }
    // distance-limited max-filter: level - slope * max(0, d - pad)
    const marked = []; for (let k = 0; k < mask.length; k++) if (mask[k]) marked.push(k);
    for (const k of marked) {
      const ci = k % W, cj = (k / W) | 0;
      const top = O.bury !== undefined ? Math.min(O.level, minY[k] - base[k] + O.bury) : O.level;
      for (let dj = -R; dj <= R; dj++) { const j = cj + dj; if (j < 0 || j >= H) continue;
        for (let di = -R; di <= R; di++) { const i = ci + di; if (i < 0 || i >= W) continue;
          const d = Math.hypot(di, dj) * step;
          const v = top - O.slope * Math.max(0, d - pad);
          const kk = j * W + i;
          if (v > lvl[kk]) lvl[kk] = v;
        } }
    }
  }
  const pos = new Float32Array(W * H * 3);
  const keep = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const x = wx[k], z = wz[k];
    let h = lvl[k] > -1e8 ? lvl[k] : -0.3;
    h += 0.12 * N.noise2(x * 0.35, z * 0.35) * Math.max(0, Math.min(1, h * 2));
    // general low dunes across the set + ripples
    h = Math.max(h, 0.16 + 0.08 * N.noise2(x * 0.12 + 3, z * 0.12) + 0.03 * N.noise2(x * 0.9, z * 0.9));
    if (mos) { // keep the medallion clear, drift sand against its rim
      const r = Math.hypot(x - mos.x, z - mos.z) / mos.r, a = Math.atan2(z - mos.z, x - mos.x);
      const rim = 0.9 + 0.12 * N.noise2(Math.cos(a) * 2, Math.sin(a) * 2);
      const t = Math.min(1, Math.max(0, (r - rim + 0.06) / 0.3));          // 0 inside … 1 just past the rim
      const clear = 0.06 + 0.22 * t * t * (0.6 + 0.4 * N.noise2(a * 3, 1));
      const k2 = Math.min(1, Math.max(0, (r - rim) / 0.25 + 0.5));
      h = Math.min(h, clear + 4.0 * Math.max(0, r - rim - 0.15) * mos.r * 0.2);  // gentle slope up from the floor
      if (r > rim) h = Math.max(h, 0.1 + 0.1 * Math.exp(-(r - rim) * 3) * (0.6 + 0.4 * N.noise2(a * 4, 2)) * k2);
    }
    // fade the drift into the terrain at the edges of the grid
    const i = k % W, j = (k / W) | 0;
    const edge = Math.min(i, W - 1 - i, j, H - 1 - j) * step;
    const fade = Math.min(1, edge / 3);
    h = h * fade - 0.25 * (1 - fade);
    keep[k] = h > 0.0 ? 1 : 0;
    pos[k * 3] = x; pos[k * 3 + 1] = base[k] + h; pos[k * 3 + 2] = z;
  }
  const idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * W + i, b = a + 1, c = a + W + 1, d = a + W;
    if (!(keep[a] || keep[b] || keep[c] || keep[d])) continue;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure the winding faces up
  const m = new THREE.Mesh(g, setSandMaterial()); m.name = 'setSand';
  return m;
}
