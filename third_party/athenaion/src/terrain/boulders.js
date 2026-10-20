// Boulders and rock masses: instanced procedural limestone rocks (createRock) scattered where real
// rock debris collects — talus aprons below cliffs, river beds and banks in the gorge, lagoon shores,
// rocky slopes. Density/LOD follow the shot cameras; footprints are registered so later modules
// (vegetation, flora) avoid them.
import * as THREE from 'three';
import { heightAt, waterSDF, RAPIDS_REACH } from '../world/heightfield.js';
import { protectFlat } from './field.js';
import { createRock, rockMaterial } from '../materials/stone.js';
import { SHOTS } from '../world/shots.js';
import { hash01 } from '../core/rng.js';
import * as L from '../world/layout.js';

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** distance from the closest shot camera that can roughly see p (horizontal) */
function camDist(x, y, z) {
  let best = Infinity;
  for (const s of SHOTS) {
    const dx = x - s.pos[0], dy = y - s.pos[1], dz = z - s.pos[2];
    const fx = s.target[0] - s.pos[0], fy = s.target[1] - s.pos[1], fz = s.target[2] - s.pos[2];
    const d = Math.hypot(dx, dy, dz);
    const cos = (dx * fx + dy * fy + dz * fz) / (d * Math.hypot(fx, fy, fz) + 1e-6);
    if (cos < 0.45 && d > 30) continue; // behind / far outside this camera's view
    if (d < best) best = d;
  }
  return best;
}

/** skip places other modules build on (stairs, aqueduct piers, waterfall plunge zones) */
function reserved(x, z) {
  const S = L.GRAND_STAIR;
  if (Math.abs(x - S.x) < S.width && z > S.zTop - 5 && z < S.zBottom + 10) return true;
  for (const a of L.AQUEDUCTS) {
    const ex = a.b[0] - a.a[0], ez = a.b[1] - a.a[1], l2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((x - a.a[0]) * ex + (z - a.a[1]) * ez) / l2));
    if (Math.hypot(x - a.a[0] - ex * t, z - a.a[1] - ez * t) < 12) return true;
  }
  return false;
}

export function scatterBoulders(engine, { region = [-900, -1100, 500, 800] } = {}) {
  const t0 = performance.now();
  const q = engine.quality;
  const rng = engine.rng('terrain-boulders');
  const dens = q.density ?? 1;
  // ---- height grid of the region (one heightAt per 4 m), candidates read it bilinearly
  const [x0, z0, x1, z1] = region;
  const gs = 4, gnx = Math.ceil((x1 - x0) / gs) + 1, gnz = Math.ceil((z1 - z0) / gs) + 1;
  const HG = new Float32Array(gnx * gnz);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) HG[j * gnx + i] = heightAt(x0 + i * gs, z0 + j * gs);
  const hg = (x, z) => {
    const fx = Math.min(gnx - 1.001, Math.max(0, (x - x0) / gs)), fz = Math.min(gnz - 1.001, Math.max(0, (z - z0) / gs));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * gnx + i;
    return (HG[k] * (1 - tx) + HG[k + 1] * tx) * (1 - tz) + (HG[k + gnx] * (1 - tx) + HG[k + gnx + 1] * tx) * tz;
  };
  // ---- candidate sampling on a jittered grid
  const step = 3.2 / Math.sqrt(dens);
  const items = [];
  const nI = Math.ceil((x1 - x0) / step), nJ = Math.ceil((z1 - z0) / step);
  for (let j = 0; j < nJ; j++) for (let i = 0; i < nI; i++) {
    const r1 = hash01(i, j, 11), r2 = hash01(i, j, 12), r3 = hash01(i, j, 13);
    const x = x0 + (i + r1) * step, z = z0 + (j + r2) * step;
    const h = hg(x, z);
    if (r3 > 0.6) continue; // cheap pre-thinning before the camera test
    const cd = camDist(x, h, z);
    if (cd > 700) continue;
    const keepFar = sstep(700, 150, cd);
    if (r3 > (0.15 + 0.85 * keepFar) * 0.6) continue;
    const e = 2;
    const g = Math.hypot(hg(x + e, z) - hg(x - e, z), hg(x, z + e) - hg(x, z - e)) / (2 * e);
    // wide neighbourhood: is there a cliff uphill within ~15 m?
    let cliffUp = 0;
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3, hh = hg(x + Math.cos(a) * 14, z + Math.sin(a) * 14);
      if (hh - h > 14) cliffUp = Math.max(cliffUp, Math.min(1, (hh - h - 14) / 20));
    }
    const nearWater = h < 4;
    const w = nearWater ? waterSDF(x, z) : 99;
    let p = 0, size = 1, kind = 'boulder';
    // fallen-block aprons under the cliffs (also at the waterline under the sheer faces)
    if (cliffUp > 0 && g < 1.3 && h > -3.2) { p = 0.42 * cliffUp * sstep(1.3, 0.25, g); size = 1.1 + 4.2 * Math.pow(hash01(i, j, 14), 2.0); }
    // shot-7 rapids reach: wet boulders through the shallow bed and along the sill
    const RR = RAPIDS_REACH, rx = x - RR.cam[0], rz = z - RR.cam[1];
    const ral = rx * RR.fwd[0] + rz * RR.fwd[1], rac = rx * -RR.fwd[1] + rz * RR.fwd[0];
    const inReach = ral > 6 && ral < RR.length - 10 && Math.abs(rac) < ral * 0.85 + 20 && h > -1.6 && h < 1.2;
    if (inReach) {
      const nearSill = Math.exp(-((ral - RR.sill) ** 2) / 60);
      p = Math.max(p, 0.17 + 0.35 * nearSill);
      size = Math.max(size, 0.8 + 2.6 * Math.pow(hash01(i, j, 15), 1.5) * (1 + 0.4 * nearSill));
    }
    if (w > -7 && w < 7 && h > -3.5 && h < 3) {
      const gorge = z > -1300 && z < 260 ? 1 : 0.45;
      p = Math.max(p, 0.22 * gorge * sstep(-7, -1, w) * sstep(7, 1, w));
      size = Math.max(size, 0.8 + 2.6 * Math.pow(hash01(i, j, 15), 1.8));
    }
    if (g > 0.35 && g < 1.4 && h > 4) p = Math.max(p, 0.02 + 0.03 * sstep(0.35, 1.0, g));
    if (p <= 0 || hash01(i, j, 16) > p / 0.6) continue;
    // (the terraced south face's protected zone reaches over the lagoon: the rapids reach is open water)
    if ((!inReach && protectFlat(x, z)) || reserved(x, z)) continue;
    if (g < 0.5 && hash01(i, j, 17) < 0.3) kind = 'slab';
    else if (size > 2.6 && hash01(i, j, 18) < 0.5) kind = 'block';
    if (cliffUp > 0.3 && size > 2.2) kind = hash01(i, j, 21) < 0.6 ? 'block' : 'boulder'; // angular fallen blocks
    items.push({ x, z, h: heightAt(x, z), size: size * (0.85 + 0.3 * hash01(i, j, 19)), kind, cd, g, w, seed: hash01(i, j, 20) });
  }
  // ---- geometry variants (two LODs per kind)
  const kinds = { boulder: 'boulder', block: 'block', slab: 'slab' };
  const variants = {};
  for (const k of Object.keys(kinds)) {
    variants[k] = [];
    for (let v = 0; v < 3; v++) {
      const sz = k === 'slab' ? [1, 0.45, 1.1] : k === 'block' ? [1, 0.85, 1.05] : [1, 0.72, 1];
      variants[k].push({
        hi: createRock(engine.rng(`rock-${k}-${v}`), { shape: k, size: sz, detail: 4, flatBottom: 0.2 }),
        lo: createRock(engine.rng(`rock-${k}-${v}`), { shape: k, size: sz, detail: 2, flatBottom: 0.2 }),
      });
    }
  }
  // ---- instancing
  const buckets = new Map();
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), e3 = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  for (const it of items) {
    const v = Math.floor(it.seed * 3) % 3;
    const lod = it.cd < 140 ? 'hi' : 'lo';
    const key = `${it.kind}:${v}:${lod}`;
    if (!buckets.has(key)) buckets.set(key, { geo: variants[it.kind][v][lod], list: [] });
    buckets.get(key).list.push(it);
  }
  const mat = rockMaterial({ moss: 0.55, lichen: 0.8, streaks: 0.2, strata: 0.3, wetBelow: 0.35, variation: 0.25 });
  const group = new THREE.Group();
  group.name = 'terrain-boulders';
  let tris = 0, count = 0;
  for (const [key, b] of buckets) {
    const mesh = new THREE.InstancedMesh(b.geo, mat, b.list.length);
    mesh.name = 'boulders:' + key;
    b.list.forEach((it, n) => {
      const s = it.size;
      const r = hash01(Math.floor(it.x * 10), Math.floor(it.z * 10), 3);
      e3.set((r - 0.5) * 0.35, r * Math.PI * 2, (hash01(Math.floor(it.x * 7), 1, 2) - 0.5) * 0.35);
      qt.setFromEuler(e3);
      sc.set(s * (0.85 + 0.3 * r), s * (0.75 + 0.4 * hash01(n, 5, 6)), s * (0.85 + 0.3 * hash01(n, 7, 8)));
      // sink a quarter of the height into the ground (more on slopes)
      ps.set(it.x, it.h + s * (0.12 - 0.25 * Math.min(1, it.g)), it.z);
      m4.compose(ps, qt, sc);
      mesh.setMatrixAt(n, m4);
      if (s > 1.4) engine.footprints?.addCircle?.(it.x, it.z, s * 0.55, 'rock');
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    tris += (b.geo.index.count / 3) * b.list.length; count += b.list.length;
  }
  engine.add(group, { castShadow: true, receiveShadow: true });
  console.log(`[terrain] boulders: ${count} instances, ${buckets.size} meshes, ${(tris / 1e6).toFixed(2)} M tris in ${Math.round(performance.now() - t0)} ms`);
  return group;
}
