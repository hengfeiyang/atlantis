// Olive branches with individually modelled leaves (Olea europaea):
//  - lanceolate leaves 5-9 cm x 1-1.5 cm, acute tip, short petiole, revolute margins, slight curl,
//    dark grey-green glossy upper side, silvery lower side (material handles the two sides)
//  - opposite / decussate leaf pairs every 1.6-3 cm, twisted toward the light
//  - hierarchy limb → branch → branchlet → drooping leafy sprays ("weeping" ends like the refs)
// Geometry goes into two GeoBuilders (wood + leaves) so many branches merge into 2 draw calls.
import * as THREE from 'three';
import { tube, perp, rot } from './util.js';

const V = THREE.Vector3;
const UP = new V(0, 1, 0), DOWN = new V(0, -1, 0);

/**
 * One olive leaf as a folded, curled strip (rows x 3 vertices).
 * base: petiole point; dir: unit along the blade; nrm: unit upper-surface normal (⊥ dir)
 */
export function oliveLeaf(B, base, dir, nrm, len, wid, o = {}) {
  const rows = o.rows ?? 6;
  const side = new V().crossVectors(dir, nrm).normalize();
  const curl = o.curl ?? 0.12;      // bend of the blade toward -normal (droop), fraction of length
  const fold = o.fold ?? -0.18;     // margins relative to midrib, fraction of half-width (neg = revolute)
  const twist = o.twist ?? 0;       // twist of the blade along its length (rad at the tip)
  const sickle = o.sickle ?? 0;     // sideways (in-plane) bend, fraction of length at the tip
  const pet = len * 0.06;           // petiole
  const startI = B.n;
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    // width profile: narrow base, widest ~45%, long acute tip
    const w = wid * 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.75) * (t < 0.02 ? 0.3 : 1);
    const along = pet + t * (len - pet);
    const bend = curl * len * t * t;
    const tw = twist * t;
    const sd = tw ? rot(side, dir, tw) : side, nn = tw ? rot(nrm, dir, tw) : nrm;
    const sk = sickle * len * t * t;
    const cx = base.x + dir.x * along - nn.x * bend + side.x * sk;
    const cy = base.y + dir.y * along - nn.y * bend + side.y * sk;
    const cz = base.z + dir.z * along - nn.z * bend + side.z * sk;
    const fz = fold * w;
    B.v(cx - sd.x * w + nn.x * fz, cy - sd.y * w + nn.y * fz, cz - sd.z * w + nn.z * fz, 0, t);
    B.v(cx, cy, cz, 0.5, t);
    B.v(cx + sd.x * w + nn.x * fz, cy + sd.y * w + nn.y * fz, cz + sd.z * w + nn.z * fz, 1, t);
  }
  // winding so that the front face normal = +nrm
  for (let r = 0; r < rows - 1; r++) {
    const a = startI + r * 3;
    // quads (a, a+1, a+4, a+3) and (a+1, a+2, a+5, a+4)
    B.tri(a, a + 1, a + 4); B.tri(a, a + 4, a + 3);
    B.tri(a + 1, a + 2, a + 5); B.tri(a + 1, a + 5, a + 4);
  }
}

/** ambient occlusion from local leaf density: leaves buried in the canopy see less sky */
function canopyAO(B, recs, R) {
  const n = recs.length / 5;
  if (!n || !B.setAO) return;
  const cell = R, grid = new Map();
  const key = (x, y, z) => (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663) ^ (Math.floor(z / cell) * 83492791);
  for (let i = 0; i < n; i++) {
    const k = key(recs[i * 5 + 2], recs[i * 5 + 3], recs[i * 5 + 4]);
    let b = grid.get(k); if (!b) grid.set(k, (b = [])); b.push(i);
  }
  const R2 = R * R;
  for (let i = 0; i < n; i++) {
    const x = recs[i * 5 + 2], y = recs[i * 5 + 3], z = recs[i * 5 + 4];
    let cnt = 0, above = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const b = grid.get(key(x + dx * cell, y + dy * cell, z + dz * cell));
      if (!b) continue;
      for (const j of b) {
        const ex = recs[j * 5 + 2] - x, ey = recs[j * 5 + 3] - y, ez = recs[j * 5 + 4] - z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < R2) { cnt++; if (ey > 0.03) above++; }
      }
    }
    const ao = Math.min(1, Math.max(0.28, 1.2 - cnt / 55 - above / 40));
    B.setAO(recs[i * 5], recs[i * 5 + 1], ao);
  }
}

/** smooth random wandering direction helper */
function jitterDir(rng, d, amt) {
  return d.clone().add(new V(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).multiplyScalar(amt)).normalize();
}

const LEVELS = [
  // limb
  { segs: 16, kids: [7, 10], t0: 0.2, ang: [0.45, 0.9], lenK: [0.3, 0.5], radK: 0.45, wander: 0.08, droop: 0.03, rise: 0.0, radial: 8 },
  // branch
  { segs: 10, kids: [7, 10], t0: 0.15, ang: [0.5, 1.0], lenK: [0.3, 0.55], radK: 0.5, wander: 0.12, droop: 0.06, rise: 0.0, radial: 6 },
  // branchlet: many short leafy shoots
  { segs: 8, kids: [8, 12], t0: 0.08, ang: [0.6, 1.15], lenK: [0.28, 0.5], radK: 0.55, wander: 0.15, droop: 0.12, rise: 0.0, radial: 4 },
  // leafy shoot (terminal twig): splays outward, droops at the tip
  { segs: 6, kids: [0, 0], t0: 0, ang: [0, 0], lenK: [0, 0], radK: 0, wander: 0.15, droop: 0.14, rise: 0.0, radial: 3 },
];

/**
 * Grow an olive branch hierarchy.
 * @param {object} p
 *   wood, leaves: GeoBuilders; rng
 *   start, dir (THREE.Vector3), length (m), radius (m), level (start level 0..3)
 *   viewDir: camera forward (leaves face the camera a bit; branches spread across the image plane)
 *   planar: 0..1 how strongly growth is flattened into the image plane
 *   density: leaf density multiplier; leafScale; droop multiplier; detail (0.5..1)
 *   colors: { leaf: fn(rng)->[r,g,b], wood:[r,g,b] }
 */
export function growOlive(p) {
  const stats = { leaves: 0 };
  const view = p.viewDir ? p.viewDir.clone().normalize() : null;
  const planar = p.planar ?? 0;
  const droopK = p.droop ?? 1;
  const detail = p.detail ?? 1;
  const maxLevel = 3;
  const recs = []; // per leaf: vertex range + centre (for canopy occlusion)

  const grow = (level, start, dir, len, rad, swayBase, root = false) => {
    const L = LEVELS[level];
    const rng = p.rng;
    let segs = Math.max(3, Math.round(L.segs * (0.6 + 0.4 * detail)));
    const pts = [start.clone()];
    let d = dir.clone();
    const curveAxis = perp(d);
    const bendBias = rng.range(-0.06, 0.06);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      d = jitterDir(rng, d, L.wander);
      d.applyAxisAngle(curveAxis, bendBias);
      d.addScaledVector(DOWN, L.droop * droopK * (0.3 + t) / segs * 3);
      if (L.rise) d.addScaledVector(UP, L.rise / segs);
      if (view && planar > 0) d.addScaledVector(view, -d.dot(view) * planar * 0.5);
      d.normalize();
      pts.push(pts[i - 1].clone().addScaledVector(d, len / segs));
    }
    // framing: a side branch that leaves the wanted frame region is cut there (no bare sticks outside)
    const T = p.trunc || p.cull;
    if (T) {
      // (a branch may start off-frame and grow in: cut at the first point outside AFTER being inside)
      let inside = false, k = -1;
      for (let i = 0; i < pts.length; i++) { const c = T(pts[i]); if (!c) inside = true; else if (inside) { k = i; break; } }
      if (!inside) return;
      if (k > 0) { if (k < 3) return; pts.length = k; segs = k - 1; }
    }
    // gnarled radius: taper + bumps
    const radFn = (t) => rad * (1 - 0.75 * t) * (1 + 0.12 * Math.sin(t * 17 + rad * 300));
    const swayFn = (t) => swayBase + (level + t) * (level >= 2 ? 0.006 : 0.002) * (len > 0.5 ? 1.5 : 1);
    if (rad > 0.0012) {
      p.wood.c = p.colors?.wood || [1, 1, 1];
      if (level >= 2) p.wood.c = [0.95, 1.0, 0.85];
      tube(p.wood, pts, radFn, Math.max(3, Math.round(L.radial * (0.5 + 0.5 * detail))), { sway: swayFn, vScale: 1, cap: level >= 2 });
    }
    // polyline sampling helper
    const at = (t) => {
      const f = t * segs, i = Math.min(segs - 1, Math.floor(f)), k = f - i;
      return { p: pts[i].clone().lerp(pts[i + 1], k), d: new V().subVectors(pts[i + 1], pts[i]).normalize() };
    };
    if (level < maxLevel) {
      const nk = Math.round(rng.range(L.kids[0], L.kids[1] + 0.999) * (p.density ?? 1) ** 0.5);
      let az = rng.range(0, Math.PI * 2);
      for (let k = 0; k < nk; k++) {
        const t = L.t0 + (1 - L.t0) * ((k + rng.range(0.1, 0.9)) / nk);
        const { p: cp, d: cd } = at(Math.min(0.98, t));
        az += Math.PI * rng.range(0.55, 1.1); // spiral phyllotaxis-ish
        let side = perp(cd).applyAxisAngle(cd, az);
        // prefer sides lying in the image plane, and avoid growing straight up
        if (view && planar > 0) { side.addScaledVector(view, -side.dot(view) * planar); side.normalize(); }
        if (side.y > 0.4) side.y *= 0.4;
        const ang = rng.range(L.ang[0], L.ang[1]);
        const nd = cd.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang)).normalize();
        const clen = len * rng.range(L.lenK[0], L.lenK[1]) * (1 - 0.35 * t);
        const crad = radFn(t) * L.radK * rng.range(0.8, 1.1);
        const nextLevel = clen < 0.22 && level >= 1 ? maxLevel : level + 1;
        // composition control: drop sub-branches whose foliage would fall outside the wanted region
        if (p.keep && nextLevel >= 2) {
          const probe = cp.clone().addScaledVector(nd, clen * 0.6).addScaledVector(DOWN, clen * 0.25);
          if (rng.random() > p.keep(probe, nextLevel)) continue;
          // and twigs that would end outside the frame region (they would show as bare sticks)
        }
        // twigs / branches that would end outside the frame region show as bare sticks: drop them
        if (p.cull && nextLevel >= 1 && p.cull(cp.clone().addScaledVector(nd, clen * 0.85))) continue;
        grow(nextLevel, cp, nd, clen, nextLevel === maxLevel ? Math.max(0.0018, crad * 0.6) : crad, swayFn(t));
      }
      // leaves also sprout directly from branchlets
      if (level >= 1) leavesAlong(pts, segs, level === 1 ? 0.55 : 0.3, 0.97, swayFn, 0.95);
    } else {
      leavesAlong(pts, segs, 0.08, 1.0, swayFn, 1);
    }
  };

  const leavesAlong = (pts, segs, t0, t1, swayFn, kScale) => {
    const rng = p.rng, B = p.leaves;
    let total = 0;
    const lens = [];
    for (let i = 0; i < segs; i++) { const l = pts[i].distanceTo(pts[i + 1]); lens.push(l); total += l; }
    const inter = rng.range(0.013, 0.02) / Math.sqrt(p.density ?? 1);
    let s = t0 * total;
    let node = 0;
    const leafScale = (p.leafScale ?? 1) * kScale;
    const rows = detail >= 0.9 ? 5 : 4;
    while (s < t1 * total) {
      // locate
      let acc = 0, i = 0;
      while (i < segs - 1 && acc + lens[i] < s) { acc += lens[i]; i++; }
      const k = (s - acc) / lens[i];
      const pos = pts[i].clone().lerp(pts[i + 1], k);
      const td = new V().subVectors(pts[i + 1], pts[i]).normalize();
      const tt = s / total;
      // decussate pairs, twisted toward a flat spray
      let side = perp(td).applyAxisAngle(td, node * Math.PI * 0.5 + rng.range(-0.3, 0.3));
      if (view) { side.addScaledVector(view, -side.dot(view) * 0.55); side.normalize(); }
      const young = tt > 0.86;
      if (p.cull && p.cull(pos)) { node++; s += inter; continue; }
      for (const sg of [-1, 1]) {
        if (rng.chance(0.06)) continue; // a missing leaf now and then
        const sd = side.clone().multiplyScalar(sg);
        const ang = young ? rng.range(0.2, 0.45) : rng.range(0.6, 1.1);
        const ld = td.clone().multiplyScalar(Math.cos(ang)).addScaledVector(sd, Math.sin(ang));
        ld.add(new V(rng.range(-0.15, 0.15), rng.range(-0.15, 0.1), rng.range(-0.15, 0.15))).normalize();
        // leaf upper surface: toward sky + toward the camera, orthogonal to the blade
        let n = UP.clone().multiplyScalar(0.45);
        if (view) n.addScaledVector(view, -1.1);
        n.add(new V(rng.range(-0.5, 0.5), rng.range(-0.3, 0.3), rng.range(-0.5, 0.5)));
        n.addScaledVector(ld, -n.dot(ld));
        if (n.lengthSq() < 1e-4) n = perp(ld);
        n.normalize();
        const size = (young ? rng.range(0.35, 0.7) : rng.range(0.8, 1.15)) * (1 - 0.25 * tt);
        const len = 0.082 * size * leafScale, wid = len * rng.range(0.13, 0.18);
        // per-leaf colour variation: mostly grey-green, a few yellowed / darker
        const r = rng.random();
        let c;
        if (p.colors?.leaf) c = p.colors.leaf(rng, tt);
        else {
          const v = rng.range(0.8, 1.2);
          c = r < 0.04 ? [1.2 * v, 1.12 * v, 0.75 * v] : r < 0.2 ? [0.8 * v, 0.85 * v, 0.8 * v] : [v, v * rng.range(0.95, 1.05), v * rng.range(0.85, 1.05)];
          if (young) c = [c[0] * 1.15, c[1] * 1.2, c[2] * 0.85];
        }
        B.c = c;
        B.s = swayFn(tt) + 0.004;
        const v0 = B.n;
        oliveLeaf(B, pos, ld, n, len, wid, { rows, curl: rng.range(0.04, 0.22), fold: rng.range(-0.3, -0.05), twist: rng.range(-0.5, 0.5), sickle: rng.range(-0.12, 0.12) });
        recs.push(v0, B.n, pos.x + ld.x * len * 0.5, pos.y + ld.y * len * 0.5, pos.z + ld.z * len * 0.5);
        stats.leaves++;
      }
      node++;
      s += inter * rng.range(0.75, 1.3);
    }
    // terminal bud leaves
    const tip = pts[segs], td = new V().subVectors(pts[segs], pts[segs - 1]).normalize();
    if (t1 >= 1) {
      for (let j = 0; j < 2; j++) {
        const ld = jitterDir(rng, td, 0.25);
        const n = perp(ld);
        B.c = [1.1, 1.15, 0.85]; B.s = swayFn(1) + 0.005;
        oliveLeaf(B, tip, ld, n.y < 0 ? n.negate() : n, 0.03 * leafScale * rng.range(0.7, 1.2), 0.006 * leafScale, { rows: 4, curl: 0.05 });
        stats.leaves++;
      }
    }
  };

  grow(p.level ?? 0, p.start, p.dir.clone().normalize(), p.length, p.radius, 0, true);
  canopyAO(p.leaves, recs, p.aoRadius ?? 0.2);
  return stats;
}
