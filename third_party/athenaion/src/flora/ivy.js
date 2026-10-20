// Ivy (Hedera helix): hanging curtains over wall tops / balustrades, climbing mats on walls and
// columns. Vines are thin tubes; leaves are cupped alpha-tested cards from the canvas atlas
// (textures.js) placed exactly by their petiole attach point, facing outward toward the light.
import * as THREE from 'three';
import { tube, perp } from './util.js';
import { IVY_INFO, ivyCell } from './textures.js';

const V = THREE.Vector3;
const UP = new V(0, 1, 0);

/** pick an atlas variant: mostly mature dark leaves, some old bronzed, young yellow-green near tips */
function pickVariant(rng, youth) {
  if (rng.chance(0.03 + 0.3 * youth * youth)) return 13 + rng.int(0, 2);
  if (rng.chance(0.14)) return 11 + rng.int(0, 1);
  return rng.int(0, 10);
}

/**
 * one leaf card (3x3 grid, cupped + drooping tip)
 * @param B GeoBuilder (leaf builder), at = petiole end, tip = unit direction of the blade, nrm = face normal
 */
export function ivyLeaf(B, rng, at, tip, nrm, len, variant) {
  const info = IVY_INFO[variant] || { attach: [0.5, 0.12], tip: [0.5, 0.97] };
  const [u0, v0, u1, v1] = ivyCell(variant);
  const span = Math.max(0.3, info.tip[1] - info.attach[1]);
  const s = len / span;
  const side = new V().crossVectors(tip, nrm).normalize();
  const cup = s * rng.range(0.04, 0.10), droop = s * rng.range(0.0, 0.12);
  const base = B.n;
  for (let j = 0; j < 3; j++) {
    const v = j / 2;
    for (let i = 0; i < 3; i++) {
      const u = i / 2;
      const du = (u - info.attach[0]) * s, dv = (v - info.attach[1]) * s;
      const off = cup * (1 - (2 * u - 1) ** 2) * 0.8 - droop * v * v;
      B.v(at.x + side.x * du + tip.x * dv + nrm.x * off,
        at.y + side.y * du + tip.y * dv + nrm.y * off,
        at.z + side.z * du + tip.z * dv + nrm.z * off,
        u0 + (u1 - u0) * u, v0 + (v1 - v0) * v);
    }
  }
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const a = base + j * 3 + i;
    // front face = +nrm  (side = tip x nrm → u axis, tip → v axis; CCW seen from +nrm)
    B.tri(a, a + 1, a + 3); B.tri(a + 1, a + 4, a + 3);
  }
}

function leafColor(rng, sun = 1) {
  const v = rng.range(0.78, 1.22) * sun;
  const y = rng.chance(0.12) ? rng.range(1.05, 1.25) : 1;
  return [v * y, v * (0.97 + 0.06 * rng.random()), v * rng.range(0.85, 1.05)];
}

/**
 * Hanging curtain of ivy over an edge.
 * @param {object} o
 *   leaves, vines: GeoBuilders; rng
 *   top: Vector3 point on the top edge (outer face line); along: unit along the edge; out: unit outward (horizontal)
 *   width (m), drop (max hang, m), density (vines per m multiplier), leafScale, ground: fn(x,z)->y (optional)
 *   topDepth: how far the mat spreads back over the top surface (m)
 */
export function ivyCurtain(o) {
  const { rng, leaves: LB, vines: VB } = o;
  const along = o.along.clone().normalize(), out = o.out.clone().normalize();
  const W = o.width, drop = o.drop;
  const dens = o.density ?? 1;
  const nv = Math.max(2, Math.round(W * 6.5 * Math.sqrt(dens)));
  const ls = o.leafScale ?? 1;
  const stats = { leaves: 0 };
  // curtain envelope: longest in the middle, ragged
  const env = (u) => Math.pow(Math.max(0, 1 - Math.abs(u) ** 2.2), 0.6);
  const ph1 = rng.range(0, 6.28), ph2 = rng.range(0, 6.28);
  for (let k = 0; k < nv; k++) {
    const u = ((k + rng.range(0.1, 0.9)) / nv) * 2 - 1;
    // clumps and gaps along the edge (the wall shows through between masses)
    const clump = 0.5 + 0.5 * Math.sin(u * W * 1.9 + ph1) * Math.sin(u * W * 0.7 + ph2);
    if (rng.random() > 0.3 + 0.7 * clump) continue;
    // ragged hem: a few long streamers, many medium and short strands
    const len = drop * env(u) * (rng.chance(0.18) ? rng.range(0.85, 1.05) : 0.2 + 0.65 * Math.pow(rng.random(), 0.8)) + 0.15;
    const p0 = o.top.clone().addScaledVector(along, u * W * 0.5);
    const pts = [];
    // over the top: start behind the edge on the top surface
    const back = rng.range(0.15, o.topDepth ?? 0.5);
    pts.push(p0.clone().addScaledVector(out, -back).addScaledVector(UP, 0.015));
    pts.push(p0.clone().addScaledVector(out, -back * 0.4).addScaledVector(UP, 0.03));
    pts.push(p0.clone().addScaledVector(out, 0.03).addScaledVector(UP, 0.02));
    // hang down, clinging close to the face with a gentle outward belly and sideways drift
    let lat = 0, offs = rng.range(0.03, 0.08);
    const step = 0.09;
    const n = Math.max(2, Math.round(len / step));
    for (let i = 1; i <= n; i++) {
      lat += rng.range(-0.04, 0.04);
      offs = Math.max(0.02, Math.min(0.18, offs + rng.range(-0.015, 0.02)));
      const q = p0.clone().addScaledVector(out, offs + 0.02).addScaledVector(along, lat).addScaledVector(UP, -i * step);
      if (o.ground && q.y < o.ground(q.x, q.z) + 0.05) break;
      pts.push(q);
    }
    if (pts.length < 3) continue;
    // vine
    VB.c = [1, 1, 1]; VB.s = 0;
    tube(VB, pts, (t) => 0.006 * (1 - 0.6 * t) + 0.002, 3, { sway: (t) => 0.004 + t * 0.03, vScale: 1 });
    // leaves along the vine
    let acc = 0;
    let sideSign = 1;
    for (let i = 1; i < pts.length; i++) {
      const seg = pts[i].distanceTo(pts[i - 1]);
      acc += seg;
      const t = i / (pts.length - 1);
      let tries = seg / (0.03 / Math.sqrt(dens));
      while (tries > 0) {
        if (rng.random() > tries) break;
        tries -= 1;
        sideSign = -sideSign;
        const p = pts[i - 1].clone().lerp(pts[i], rng.random());
        const onTop = i <= 2;
        const pet = rng.range(0.04, 0.09) * ls;
        let at, tip, nrm;
        if (onTop) {
          at = p.clone().addScaledVector(along, sideSign * pet * 0.6).addScaledVector(UP, pet * 0.4);
          tip = along.clone().multiplyScalar(sideSign * 0.6).addScaledVector(out, rng.range(-0.6, 0.8)).normalize();
          nrm = UP.clone().addScaledVector(out, rng.range(0, 0.4)).add(new V(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)));
        } else {
          at = p.clone().addScaledVector(along, sideSign * pet * rng.range(0.5, 0.95)).addScaledVector(out, pet * rng.range(0.2, 0.7)).addScaledVector(UP, -pet * rng.range(0, 0.3));
          const ang = sideSign * rng.range(0.35, 1.35);
          tip = new V(0, -1, 0).multiplyScalar(Math.cos(ang)).addScaledVector(along, Math.sin(ang)).addScaledVector(out, rng.range(0.1, 0.5)).normalize();
          nrm = out.clone().addScaledVector(UP, rng.range(0.1, 0.6)).add(new V(rng.range(-0.35, 0.35), rng.range(-0.2, 0.2), rng.range(-0.35, 0.35)));
        }
        nrm.addScaledVector(tip, -nrm.dot(tip)).normalize();
        const youth = Math.max(0, t - 0.6) / 0.4;
        const L = ls * rng.range(0.055, 0.095) * (1.1 - 0.4 * youth);
        LB.c = leafColor(rng); LB.a = rng.range(0.55, 0.92);
        LB.s = 0.006 + t * 0.03;
        ivyLeaf(LB, rng, at, tip, nrm, L, pickVariant(rng, youth));
        stats.leaves++;
      }
    }
    // (r5) leafy mass: extra leaves standing off the face around the upper part of each strand, so a
    // curtain reads as a bulging, layered mass with self-shadowed depth (refs 2, 6, 9), not as strings
    const massN = Math.round((pts.length - 3) * 1.1 * Math.min(1.6, dens) * (o.mass ?? 1));
    for (let m = 0; m < massN; m++) {
      const i = 3 + Math.floor(Math.pow(rng.random(), 1.5) * (pts.length - 3));
      const p = pts[Math.min(pts.length - 1, i)];
      const tt = i / (pts.length - 1);
      const bul = rng.range(0.03, 0.2) * (1 - tt * 0.6);
      const at = p.clone().addScaledVector(along, rng.range(-0.12, 0.12)).addScaledVector(out, bul).addScaledVector(UP, rng.range(-0.05, 0.05));
      const ang = rng.range(-1.3, 1.3);
      const tip = new V(0, -1, 0).multiplyScalar(Math.cos(ang)).addScaledVector(along, Math.sin(ang)).addScaledVector(out, rng.range(0.1, 0.6)).normalize();
      const nrm = out.clone().addScaledVector(UP, rng.range(0.2, 0.8)).add(new V(rng.range(-0.4, 0.4), rng.range(-0.2, 0.2), rng.range(-0.4, 0.4)));
      nrm.addScaledVector(tip, -nrm.dot(tip)).normalize();
      LB.c = leafColor(rng, 0.92 + bul * 0.6); LB.a = Math.min(1, rng.range(0.5, 0.85) + bul); LB.s = 0.01 + 0.03 * tt;
      ivyLeaf(LB, rng, at, tip, nrm, ls * rng.range(0.06, 0.1), pickVariant(rng, Math.max(0, tt - 0.5)));
      stats.leaves++;
    }
    // bushy mat over the top edge: extra leaves
    for (let j = 0; j < 4 * dens; j++) {
      const p = p0.clone().addScaledVector(out, -rng.range(0, back)).addScaledVector(along, rng.range(-0.1, 0.1)).addScaledVector(UP, rng.range(0.02, 0.07));
      const tip = new V(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize();
      const nrm = UP.clone().add(new V(rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4))).addScaledVector(tip, 0).normalize();
      nrm.addScaledVector(tip, -nrm.dot(tip)).normalize();
      LB.c = leafColor(rng, 1.05); LB.a = rng.range(0.7, 1); LB.s = 0.004;
      ivyLeaf(LB, rng, p, tip, nrm, ls * rng.range(0.05, 0.08), pickVariant(rng, 0.2));
      stats.leaves++;
    }
  }
  return stats;
}

/**
 * Ivy climbing a column / round pier (vines spiralling up, leaves pressed to the surface).
 * o: { leaves, vines, rng, base: Vector3 (column axis at ground), radius, height, coverage 0..1,
 *      side: optional preferred compass vector (where the ivy is densest), density, leafScale }
 */
export function ivyColumn(o) {
  const { rng, leaves: LB, vines: VB } = o;
  const R = o.radius, H = o.height, dens = o.density ?? 1, ls = o.leafScale ?? 1;
  const cov = o.coverage ?? 0.6;
  const pref = o.side ? o.side.clone().setY(0).normalize() : null;
  const nv = Math.max(4, Math.round(R * 2 * Math.PI * 9 * Math.sqrt(dens) * cov));
  const stats = { leaves: 0 };
  for (let k = 0; k < nv; k++) {
    let a = rng.range(0, Math.PI * 2);
    if (pref && rng.chance(0.7)) a = Math.atan2(pref.z, pref.x) + rng.gauss(0, 0.9);
    const top = H * Math.min(1, rng.range(0.35, 1.1) * (0.5 + cov));
    const twist = rng.range(-0.5, 0.5);
    const pts = [];
    const n = Math.max(3, Math.round(top / 0.1));
    let rr = R + rng.range(0.01, 0.03);
    for (let i = 0; i <= n; i++) {
      const y = (i / n) * top;
      a += twist * 0.1 + rng.range(-0.04, 0.04);
      rr = Math.max(R + 0.008, rr + rng.range(-0.006, 0.006));
      pts.push(new V(o.base.x + Math.cos(a) * rr, o.base.y + y, o.base.z + Math.sin(a) * rr));
    }
    VB.c = [1, 1, 1]; VB.s = 0;
    tube(VB, pts, (t) => 0.008 * (1 - 0.6 * t) + 0.002, 3, { vScale: 1 });
    // leaves
    for (let i = 1; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      const cnt = rng.range(2.2, 3.8) * Math.sqrt(dens);
      for (let c = 0; c < cnt; c++) {
        const p = pts[i - 1].clone().lerp(pts[i], rng.random());
        const radial = new V(p.x - o.base.x, 0, p.z - o.base.z).normalize();
        const tang = new V(-radial.z, 0, radial.x);
        const sg = rng.sign();
        const at = p.clone().addScaledVector(radial, rng.range(0.02, 0.07)).addScaledVector(tang, sg * rng.range(0.02, 0.09)).addScaledVector(UP, rng.range(-0.04, 0.04));
        const tip = UP.clone().multiplyScalar(rng.range(-0.3, 1)).addScaledVector(tang, sg * rng.range(0.3, 1)).addScaledVector(radial, rng.range(0, 0.4)).normalize();
        const nrm = radial.clone().add(new V(rng.range(-0.3, 0.3), rng.range(-0.1, 0.4), rng.range(-0.3, 0.3)));
        nrm.addScaledVector(tip, -nrm.dot(tip)).normalize();
        const youth = Math.max(0, t - 0.7) / 0.3;
        LB.c = leafColor(rng); LB.a = rng.range(0.55, 0.92); LB.s = 0.002 + 0.006 * t;
        ivyLeaf(LB, rng, at, tip, nrm, ls * rng.range(0.06, 0.1) * (1.1 - 0.35 * youth), pickVariant(rng, youth));
        stats.leaves++;
      }
    }
    // a few loose shoots reaching out at the top
    if (rng.chance(0.4)) {
      const p = pts[pts.length - 1];
      const radial = new V(p.x - o.base.x, 0, p.z - o.base.z).normalize();
      const sp = [p.clone()];
      let d = radial.clone().addScaledVector(UP, 0.5).normalize();
      for (let i = 0; i < 5; i++) { d.y -= 0.18; d.normalize(); sp.push(sp[i].clone().addScaledVector(d, 0.08)); }
      tube(VB, sp, (t) => 0.004 * (1 - t) + 0.0015, 3, { vScale: 1 });
      for (let i = 1; i < sp.length; i++) {
        const tip = d.clone().add(new V(rng.range(-0.5, 0.5), rng.range(-0.5, 0.2), rng.range(-0.5, 0.5))).normalize();
        const nrm = perp(tip); if (nrm.y < 0) nrm.negate();
        LB.c = leafColor(rng); LB.a = rng.range(0.55, 0.92); LB.s = 0.02;
        ivyLeaf(LB, rng, sp[i], tip, nrm, ls * rng.range(0.04, 0.07), pickVariant(rng, 0.8));
        stats.leaves++;
      }
    }
  }
  return stats;
}

/**
 * Ivy carpet on an arbitrary (roughly convex) surface: given sample points with normals
 * (e.g. on a fallen statue head), scatter clinging leaves + a few vines.
 * o: { leaves, vines, rng, points: [{p:Vector3, n:Vector3}], leafScale, density }
 */
export function ivyPatch(o) {
  const { rng, leaves: LB } = o;
  const ls = o.leafScale ?? 1;
  let count = 0;
  for (const { p, n } of o.points) {
    const k = Math.round(rng.range(1, 3) * (o.density ?? 1));
    for (let i = 0; i < k; i++) {
      const tip = perp(n).applyAxisAngle(n, rng.range(0, Math.PI * 2));
      tip.addScaledVector(UP, -0.4).addScaledVector(n, 0.25).normalize();
      const nrm = n.clone().add(new V(rng.range(-0.35, 0.35), rng.range(-0.1, 0.35), rng.range(-0.35, 0.35)));
      nrm.addScaledVector(tip, -nrm.dot(tip)).normalize();
      const at = p.clone().addScaledVector(n, rng.range(0.01, 0.05)).add(new V(rng.range(-0.05, 0.05), rng.range(-0.05, 0.05), rng.range(-0.05, 0.05)));
      LB.c = leafColor(rng); LB.a = rng.range(0.55, 0.92); LB.s = 0.004;
      ivyLeaf(LB, rng, at, tip, nrm, ls * rng.range(0.05, 0.09), pickVariant(rng, rng.random() * 0.6));
      count++;
    }
  }
  return { leaves: count };
}
