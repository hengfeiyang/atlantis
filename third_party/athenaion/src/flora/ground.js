// Ground cover: Mediterranean wild grass tufts (green + sun-dried straw, seed heads), yellow
// wildflowers (Helichrysum / ragwort-like clusters), lavender / wild sage spikes, rosemary shrubs and
// moss cushions. Each species has several geometry variants (individual blades / petals / needles,
// real-world sizes) that are instanced by the scatter code in flora.js.
import * as THREE from 'three';
import { GeoBuilder, tube } from './util.js';
import { oliveLeaf } from './olive.js';

const V = THREE.Vector3;

/** single curved, tapered blade (strip) */
function blade(B, rng, base, dirXZ, h, w, lean, o = {}) {
  const segs = o.segs ?? 5;
  const curl = o.curl ?? rng.range(0.2, 0.9); // how much the blade arches over
  const twist = rng.range(-0.8, 0.8);
  const side0 = new V(-dirXZ.z, 0, dirXZ.x);
  const startI = B.n;
  let p = base.clone();
  let ang = lean; // from vertical
  const dl = h / segs;
  const c0 = o.c0, c1 = o.c1;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const ww = w * (1 - Math.pow(t, 1.4)) * (i === segs ? 0 : 1) + (i === segs ? 0 : 0.0004);
    const tw = twist * t;
    const side = side0.clone().applyAxisAngle(new V(0, 1, 0), tw * 0.3);
    B.c = [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    B.s = t * t * h * 0.08;
    B.a = 0.4 + 0.6 * Math.min(1, t * 1.6);
    B.v(p.x - side.x * ww, p.y, p.z - side.z * ww, 0, t);
    B.v(p.x + side.x * ww, p.y, p.z + side.z * ww, 1, t);
    // advance: bend further from vertical along the blade
    ang += curl * dl / h * 1.6;
    p = p.clone().add(new V(dirXZ.x * Math.sin(ang) * dl, Math.cos(ang) * dl, dirXZ.z * Math.sin(ang) * dl));
  }
  for (let i = 0; i < segs; i++) {
    const a = startI + i * 2;
    B.tri(a, a + 1, a + 3); B.tri(a, a + 3, a + 2);
  }
  return p;
}

const lin = (r, g, b) => [Math.pow(r / 255, 2.2), Math.pow(g / 255, 2.2), Math.pow(b / 255, 2.2)];

/**
 * Grass tuft variant. Colours are ABSOLUTE linear albedo baked in vertex colours
 * (material top/under = white).
 * dry: 0..1 share of straw-coloured blades.
 */
export function grassTuft(rng, { blades = 24, height = 0.35, radius = 0.06, dry = 0.4, seedHeads = 0.3, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const segs = detail >= 0.9 ? 5 : detail >= 0.45 ? 4 : detail >= 0.25 ? 3 : 2;
  const greenBase = lin(44, 56, 28), greenTip = lin(104, 120, 62);
  const dryBase = lin(94, 88, 60), dryTip = lin(188, 172, 124);
  for (let i = 0; i < blades; i++) {
    const a = rng.range(0, Math.PI * 2), r = radius * Math.sqrt(rng.random());
    const base = new V(Math.cos(a) * r, 0, Math.sin(a) * r);
    const out = new V(Math.cos(a + rng.range(-0.6, 0.6)), 0, Math.sin(a + rng.range(-0.6, 0.6))).normalize();
    const isDry = rng.chance(dry);
    const k = rng.range(0.8, 1.2);
    const c0 = (isDry ? dryBase : greenBase).map((x) => x * k * 0.7), c1 = (isDry ? dryTip : greenTip).map((x) => x * k);
    const h = height * rng.range(0.45, 1.1);
    const tip = blade(B, rng, base, out, h, rng.range(0.0035, 0.0065), rng.range(0.08, 0.45) + (r / radius) * 0.45, { segs, c0, c1, curl: rng.range(0.5, 1.6) });
    // seed head (oat / brome-like): a thin stalk with a few spikelets
    if (rng.chance(seedHeads / 10)) {
      const st = height * rng.range(1.0, 1.5);
      const sp = [base.clone(), base.clone().add(new V(out.x * st * 0.1, st * 0.55, out.z * st * 0.1)), base.clone().add(new V(out.x * st * 0.3, st, out.z * st * 0.3))];
      B.c = dryTip.map((x) => x * 0.9); B.s = 0.02;
      tube(B, sp, (t) => 0.0012 * (1 - 0.5 * t), 3, {});
      for (let s = 0; s < 6; s++) {
        const t = 0.65 + s * 0.06;
        const p = sp[1].clone().lerp(sp[2], (t - 0.5) * 2);
        const d = new V(out.x + rng.range(-0.6, 0.6), -0.6 - rng.random(), out.z + rng.range(-0.6, 0.6)).normalize();
        B.c = lin(200, 180, 120).map((x) => x * rng.range(0.8, 1.05));
        oliveLeaf(B, p, d, new V(0, 1, 0).addScaledVector(d, -d.y).normalize(), 0.018, 0.005, { rows: 3, curl: 0.1, fold: 0 });
      }
    }
  }
  return B.toGeometry();
}

/** yellow-flowering mound (Helichrysum / St John's wort / broom-like): a leafy dome of radiating stems
 *  with clusters of small yellow flowers on top */
export function yellowFlowers(rng, { stems = 12, height = 0.38, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const stemCol = lin(64, 84, 34);
  const leafA = lin(66, 90, 42), leafB = lin(100, 118, 62);
  const nLeaf = detail >= 0.9 ? 12 : 8;
  for (let i = 0; i < stems; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0, 0.06);
    const base = new V(Math.cos(a) * r, 0, Math.sin(a) * r);
    const h = height * rng.range(0.55, 1.1);
    const lean = rng.range(0.25, 0.85);
    const dir = new V(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
    const top = base.clone().addScaledVector(dir, h).add(new V(0, -h * lean * 0.15, 0));
    const mid = base.clone().lerp(top, 0.5).add(new V(0, h * 0.12, 0));
    B.c = stemCol; B.s = 0.0;
    tube(B, [base, mid, top], (t) => 0.0028 * (1 - 0.6 * t), 3, { sway: (t) => t * 0.012 });
    // leaves along the stem (small, elliptic, bright green)
    for (let l = 0; l < nLeaf; l++) {
      const t = rng.range(0.15, 0.95);
      const p = t < 0.5 ? base.clone().lerp(mid, t * 2) : mid.clone().lerp(top, (t - 0.5) * 2);
      const d = new V(rng.range(-1, 1), rng.range(0.1, 0.8), rng.range(-1, 1)).add(dir).normalize();
      const n = new V(0, 1, 0).addScaledVector(d, -d.y).normalize();
      B.c = (rng.chance(0.5) ? leafA : leafB).map((x) => x * rng.range(0.85, 1.15)); B.s = t * 0.012;
      oliveLeaf(B, p, d, n.lengthSq() > 0.01 ? n : new V(1, 0, 0), rng.range(0.022, 0.04), rng.range(0.008, 0.012), { rows: 3, curl: 0.15, fold: -0.1 });
    }
    // flower cluster (corymb) at the tip, sometimes a second one lower down
    for (let c = 0; c < (rng.chance(0.4) ? 2 : 1); c++) {
      const cp = c === 0 ? top : mid.clone().lerp(top, 0.6);
      const nh = rng.int(5, 12);
      for (let k = 0; k < nh; k++) {
        const hp = cp.clone().add(new V(rng.range(-0.035, 0.035), rng.range(-0.01, 0.025), rng.range(-0.035, 0.035)));
        flowerHead(B, rng, hp, new V(rng.range(-0.5, 0.5), 1, rng.range(-0.5, 0.5)).normalize(), rng.range(0.008, 0.014), {
          petal: lin(228, 200, 84).map((x) => x * rng.range(0.85, 1.1)), center: lin(176, 142, 56), petals: rng.int(5, 7), detail,
        });
      }
    }
  }
  return B.toGeometry();
}

/** flat star-shaped flower head facing n */
export function flowerHead(B, rng, p, n, r, { petal, center, petals = 6 }) {
  const t1 = Math.abs(n.y) < 0.9 ? new V(0, 1, 0) : new V(1, 0, 0);
  const u = new V().crossVectors(n, t1).normalize(), w = new V().crossVectors(n, u);
  const c = B.n;
  B.c = center; B.s = 0.014;
  B.v(p.x + n.x * r * 0.25, p.y + n.y * r * 0.25, p.z + n.z * r * 0.25, 0.5, 0.0);
  const N = petals * 2;
  const rot0 = rng.range(0, 6.28);
  for (let i = 0; i < N; i++) {
    const a = rot0 + (i / N) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const drop = i % 2 === 0 ? -0.15 * r : 0;
    B.c = i % 2 === 0 ? petal : petal.map((x, j) => x * 0.8 + center[j] * 0.2);
    B.v(p.x + (u.x * Math.cos(a) + w.x * Math.sin(a)) * rr + n.x * drop, p.y + (u.y * Math.cos(a) + w.y * Math.sin(a)) * rr + n.y * drop,
      p.z + (u.z * Math.cos(a) + w.z * Math.sin(a)) * rr + n.z * drop, 0.5, 0.6);
  }
  for (let i = 0; i < N; i++) B.tri(c, c + 1 + i, c + 1 + ((i + 1) % N));
}

/** lavender / wild sage: grey-green leaf base, thin stems with purple flower spikes */
export function lavender(rng, { stems = 26, height = 0.5, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const leafCol = lin(96, 112, 82), stemCol = lin(92, 104, 70);
  // basal leaves
  for (let i = 0; i < 24; i++) {
    const a = rng.range(0, 6.28);
    const d = new V(Math.cos(a) * rng.range(0.3, 0.9), rng.range(0.4, 1), Math.sin(a) * rng.range(0.3, 0.9)).normalize();
    const p = new V(Math.cos(a) * rng.range(0, 0.08), rng.range(0, 0.1), Math.sin(a) * rng.range(0, 0.08));
    const n = new V(0, 1, 0).addScaledVector(d, -d.y).normalize();
    B.c = leafCol.map((x) => x * rng.range(0.8, 1.15)); B.s = 0.002;
    oliveLeaf(B, p, d, n.lengthSq() > 0.01 ? n : new V(1, 0, 0), rng.range(0.03, 0.05), 0.004, { rows: 3, curl: 0.15 });
  }
  const purple = lin(122, 92, 176), purpleDark = lin(78, 50, 120);
  for (let i = 0; i < stems; i++) {
    const a = rng.range(0, 6.28), lean = rng.range(0.05, 0.4);
    const base = new V(Math.cos(a) * rng.range(0, 0.06), 0.03, Math.sin(a) * rng.range(0, 0.06));
    const d = new V(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
    const h = height * rng.range(0.7, 1.1);
    const top = base.clone().addScaledVector(d, h);
    const mid = base.clone().addScaledVector(d, h * 0.5).add(new V(Math.cos(a) * 0.02, 0, Math.sin(a) * 0.02));
    B.c = stemCol; B.s = 0;
    tube(B, [base, mid, top], 0.0015, 3, { sway: (t) => t * 0.015 });
    // spike: a bumpy tapered spindle of florets (purple, darker at the base of each whorl)
    const spikeL = rng.range(0.045, 0.085);
    const rings = detail >= 0.9 ? 7 : 5, rad = 5;
    const i0 = B.n;
    const base2 = top.clone().addScaledVector(d, -spikeL);
    const sideA = new V(1, 0, 0).addScaledVector(d, -d.x).normalize(), sideB = new V().crossVectors(d, sideA);
    for (let k = 0; k <= rings; k++) {
      const t = k / rings;
      const c = base2.clone().addScaledVector(d, spikeL * t);
      const rr = 0.0075 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) * (k % 2 ? 0.8 : 1.05);
      B.c = (k % 2 ? purpleDark : purple).map((x) => x * rng.range(0.85, 1.15)); B.s = 0.016;
      for (let j = 0; j < rad; j++) {
        const a = (j / rad) * Math.PI * 2 + k * 0.6;
        B.v(c.x + (sideA.x * Math.cos(a) + sideB.x * Math.sin(a)) * rr, c.y + (sideA.y * Math.cos(a) + sideB.y * Math.sin(a)) * rr, c.z + (sideA.z * Math.cos(a) + sideB.z * Math.sin(a)) * rr, j / rad, t);
      }
    }
    for (let k = 0; k < rings; k++) for (let j = 0; j < rad; j++) {
      const a0 = i0 + k * rad + j, a1 = i0 + k * rad + ((j + 1) % rad);
      B.tri(a0, a1, a1 + rad); B.tri(a0, a1 + rad, a0 + rad);
    }
    // stoechas-like bracts on some spikes
    if (rng.chance(0.35)) {
      for (const sg of [-1, 1]) {
        const dd = d.clone().add(new V(sg * 0.5, 0.3, rng.range(-0.3, 0.3))).normalize();
        B.c = lin(160, 120, 210); B.s = 0.018;
        oliveLeaf(B, top, dd, new V(0, 0, 1).addScaledVector(dd, -dd.z).normalize(), 0.018, 0.008, { rows: 3, curl: 0 });
      }
    }
  }
  return B.toGeometry();
}

/** rosemary shrub: upright woody stems densely covered in needle leaves, pale blue flowers */
export function rosemary(rng, { stems = 18, height = 0.7, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const wood = lin(80, 70, 52);
  const needleTop = lin(40, 64, 34), needleUnder = lin(96, 116, 88);
  const nNeedle = Math.round(75 * (0.6 + 0.4 * detail));
  for (let i = 0; i < stems; i++) {
    const a = rng.range(0, 6.28), lean = rng.range(0.1, 0.6);
    const base = new V(Math.cos(a) * rng.range(0, 0.12), 0, Math.sin(a) * rng.range(0, 0.12));
    const d = new V(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
    const h = height * rng.range(0.55, 1.1);
    const pts = [base];
    for (let k = 1; k <= 4; k++) pts.push(base.clone().addScaledVector(d, (h * k) / 4).add(new V(rng.range(-0.02, 0.02), 0, rng.range(-0.02, 0.02))));
    B.c = wood; B.s = 0;
    tube(B, pts, (t) => 0.004 * (1 - 0.7 * t), 3, { sway: (t) => t * 0.01 });
    for (let k = 0; k < nNeedle; k++) {
      const t = Math.pow(rng.random(), 0.6) * 0.65 + 0.35;
      const f = t * 4, si = Math.min(3, Math.floor(f));
      const p = pts[si].clone().lerp(pts[si + 1], f - si);
      const az = rng.range(0, 6.28);
      const nd = d.clone().multiplyScalar(0.55).add(new V(Math.cos(az), 0, Math.sin(az))).normalize();
      const n = new V(0, 1, 0).addScaledVector(nd, -nd.y);
      B.c = (rng.chance(0.25) ? needleUnder : needleTop).map((x) => x * rng.range(0.8, 1.2)); B.s = t * 0.012;
      oliveLeaf(B, p, nd, n.lengthSq() > 1e-3 ? n.normalize() : new V(1, 0, 0), rng.range(0.02, 0.032), 0.0032, { rows: 3, curl: 0.25, fold: -0.4 });
    }
    // a few pale blue flowers near the tips
    for (let k = 0; k < 3; k++) {
      if (!rng.chance(0.5)) continue;
      const p = pts[3].clone().lerp(pts[4], rng.random()).add(new V(rng.range(-0.01, 0.01), 0, rng.range(-0.01, 0.01)));
      flowerHead(B, rng, p, new V(rng.range(-1, 1), 0.5, rng.range(-1, 1)).normalize(), 0.005, { petal: lin(170, 180, 230), center: lin(120, 120, 190), petals: 4 });
    }
  }
  return B.toGeometry();
}

/** moss / low cushion plant: lumpy squashed blob with a fuzzy surface (shader) */
export function mossCushion(rng, { r = 0.15, h = 0.05 } = {}) {
  const B = new GeoBuilder();
  const n = Math.round(260 * (r / 0.15) ** 1.5);
  const dark = lin(34, 48, 14), light = lin(96, 110, 34);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), rr = r * Math.sqrt(rng.random());
    const dome = 1 - (rr / r) ** 2;
    const base = new V(Math.cos(a) * rr, h * 0.6 * dome, Math.sin(a) * rr);
    const out = new V(Math.cos(a), 0, Math.sin(a));
    const k = rng.range(0.75, 1.25);
    blade(B, rng, base, out, h * rng.range(0.5, 1.0) * (0.4 + 0.6 * dome), rng.range(0.003, 0.006), rng.range(0.1, 0.9) * (rr / r) + 0.1,
      { segs: 2, c0: dark.map((x) => x * k * 0.7), c1: light.map((x) => x * k), curl: rng.range(0.2, 0.8) });
  }
  return B.toGeometry();
}

/**
 * Mediterranean evergreen shrub (lentisk / myrtle / phillyrea / cistus): a lumpy mound of a few leafy
 * blobs on short woody stems. Leaves sit mostly near the blob surfaces (dense mass, darker inside).
 * o: { r (m radius), h (m height), leaves, leafLen (m), grey 0..1 (sage/cistus tint), detail }
 */
export function shrub(rng, { r = 0.5, h = 0.6, leaves = 900, leafLen = 0.05, grey = 0, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const nb = rng.int(3, 6);
  const blobs = [];
  for (let i = 0; i < nb; i++) {
    const a = rng.range(0, 6.28), d = rng.range(0, 0.5) * r;
    const br = r * rng.range(0.45, 0.72);
    blobs.push({ c: new V(Math.cos(a) * d, h * rng.range(0.38, 0.62), Math.sin(a) * d), r: br, ry: Math.min(h * 0.5, br * rng.range(0.7, 1.0)) });
  }
  // woody stems from the root crown to each blob
  B.c = lin(70, 60, 46); B.s = 0;
  for (const b of blobs) {
    const mid = b.c.clone().multiplyScalar(0.45).add(new V(rng.range(-0.05, 0.05) * r, 0, rng.range(-0.05, 0.05) * r));
    tube(B, [new V(rng.range(-0.05, 0.05) * r, 0, rng.range(-0.05, 0.05) * r), mid, b.c], (t) => r * 0.03 * (1 - 0.7 * t) + 0.003, 3, { sway: (t) => t * 0.004 });
  }
  const dark = mixl(lin(34, 46, 26), lin(70, 78, 62), grey), light = mixl(lin(72, 90, 46), lin(128, 134, 110), grey);
  const rows = detail >= 0.9 ? 4 : 3; // (3 = diamond: the minimum non-degenerate oliveLeaf)
  for (let i = 0; i < leaves; i++) {
    const b = blobs[rng.int(0, nb - 1)];
    const u = new V(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
    if (u.lengthSq() < 1e-3) u.set(0, 1, 0);
    u.normalize();
    if (u.y < -0.2) u.y *= 0.35;
    u.normalize();
    const depth = Math.pow(rng.random(), 0.3); // mostly near the surface
    const p = b.c.clone().add(new V(u.x * b.r * depth, u.y * b.ry * depth, u.z * b.r * depth));
    if (p.y < 0.015) p.y = 0.015 + rng.range(0, 0.04);
    const t = new V(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).addScaledVector(u, 0.6).normalize();
    const ld = t.addScaledVector(u, -t.dot(u) * 0.6).normalize();
    const n = u.clone().addScaledVector(new V(0, 1, 0), 0.5).add(new V(rng.range(-0.4, 0.4), rng.range(-0.2, 0.2), rng.range(-0.4, 0.4)));
    n.addScaledVector(ld, -n.dot(ld));
    if (n.lengthSq() < 1e-4) continue;
    n.normalize();
    const sun = 0.5 + 0.5 * (u.y * 0.6 + 0.4);
    const k = rng.range(0.8, 1.2);
    B.c = mixl(dark, light, Math.min(1, depth * sun * rng.range(0.5, 1.1))).map((x) => x * k);
    B.a = 0.3 + 0.7 * depth * (0.55 + 0.45 * (u.y * 0.5 + 0.5));
    B.s = 0.004 + 0.01 * depth * (p.y / h);
    const L = leafLen * rng.range(0.7, 1.2);
    oliveLeaf(B, p, ld, n, L, L * rng.range(0.32, 0.48), { rows, curl: rng.range(0.05, 0.2), fold: rng.range(-0.25, 0), twist: rng.range(-0.4, 0.4) });
  }
  return B.toGeometry();
}
const mixl = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
