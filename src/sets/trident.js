// The broken golden trident of the fallen colossus (ref 8): three barbed prongs on a curved crossbar,
// an ornate collar (rings, bead mouldings, a scrolled boss), a thick shaft snapped off.
// SDF in metres, local frame: prongs point +y, prong plane = x/y, shaft toward -y, origin at the
// crossbar centre. buildTridentGeometry() meshes it (+ cavity / aux attributes).
import { Simplex } from '../core/noise.js';
import { sdPoly, ARROW } from './poseidonHead.js';
import { smin, smax, max, min, abs, sqrt, clamp, sstep, torus, meshWithCavity } from './sdfkit.js';

const NA = new Simplex(4121), NB = new Simplex(977);

function tcap(x, y, z, a, b, ra, rb) {
  const pax = x - a[0], pay = y - a[1], paz = z - a[2], bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = (paz - baz * h) * 1.25; // flattened (diamond-ish) section
  return { d: sqrt(dx * dx + dy * dy + dz * dz) / 1.12 - (ra + (rb - ra) * h), h };
}
function bez(p0, p1, p2, p3, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([0, 1, 2].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]));
  }
  return out;
}
function polyTube(x, y, z, pts, r0, r1) {
  let best = 1e9;
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const q = tcap(x, y, z, pts[i], pts[i + 1], r0 + (r1 - r0) * (i / n), r0 + (r1 - r0) * ((i + 1) / n));
    if (q.d < best) best = q.d;
  }
  return best;
}

/**
 * @param {object} o
 * @param {number} [o.prong]  centre prong length (m)
 * @param {number} [o.width]  half distance between the side prongs (m)
 * @param {number} [o.shaft]  remaining shaft length below the collar (m)
 * @param {number} [o.r]      shaft radius (m)
 */
export function tridentSDF(o = {}) {
  const P = o.prong ?? 3.9, W = o.width ?? 1.3, SH = o.shaft ?? 8, R = o.r ?? 0.27;
  const tipS = 6.2; // arrowhead scale (ARROW units → m)
  // side prongs: from the crossbar ends, bowing outward, then parallel to the centre prong
  const side = (s) => bez([s * 0.35, -0.25, 0], [s * (W + 0.25), -0.05, 0], [s * (W + 0.05), P * 0.45, 0], [s * W * 0.92, P * 0.82, 0], 10);
  const SP = [side(1), side(-1)];
  const bar = bez([-W - 0.05, 0.25, 0], [-W * 0.6, -0.55, 0], [W * 0.6, -0.55, 0], [W + 0.05, 0.25, 0], 12);
  const tips = [
    { at: [0, P, 0], dir: [0, 1, 0] },
    { at: [W * 0.92, P * 0.82, 0], dir: [-0.04, 1, 0] },
    { at: [-W * 0.92, P * 0.82, 0], dir: [0.04, 1, 0] },
  ];
  const yC0 = -0.55, yC1 = -1.55; // collar
  return (x, y, z) => {
    let d = 1e9;
    // centre prong (square-ish tapering bar)
    d = min(d, tcap(x, y, z, [0, -0.5, 0], [0, P - 0.15, 0], R * 0.95, R * 0.6).d);
    // side prongs + crossbar
    if (abs(x) > 0.15 || y < 0.5) {
      d = min(d, polyTube(x, y, z, SP[x > 0 ? 0 : 1], R * 0.85, R * 0.55));
      d = smin(d, polyTube(x, y, z, bar, R * 0.8, R * 0.8), 0.12);
    }
    // arrowhead tips with barbs (blade in the prong plane, ridged)
    for (const T of tips) {
      const qx = x - T.at[0], qy = y - T.at[1], qz = z - T.at[2];
      if (qx * qx + qy * qy + qz * qz > 1.0) continue;
      const u = qx * T.dir[1] - qy * T.dir[0], v = qx * T.dir[0] + qy * T.dir[1];
      const d2 = sdPoly(u / tipS, v / tipS, ARROW) * tipS;
      const blade = max(d2, abs(qz) - (0.025 + 0.11 * clamp(-d2 / 0.12, 0, 1)));
      d = smin(d, blade, 0.03);
    }
    // collar: bead mouldings, a bulb with scrolls, rings
    if (y < 0.2 && y > yC1 - 0.5 && abs(x) < 0.9) {
      const rr = sqrt(x * x + z * z);
      let c = max(rr - R * 1.75, abs(y - (yC0 + yC1) / 2) - (yC0 - yC1) / 2);
      c = min(c, torus(x, y - yC0, z, R * 1.6, R * 0.32));
      c = min(c, torus(x, y - (yC0 - 0.28), z, R * 1.9, R * 0.3));
      c = min(c, torus(x, y - yC1, z, R * 1.7, R * 0.28));
      c = min(c, torus(x, y - (yC1 - 0.3), z, R * 1.35, R * 0.22));
      // bead row
      const a = Math.atan2(z, x), bead = Math.abs(Math.sin(a * 11));
      c = min(c, torus(x, y - (yC0 - 0.55), z, R * 1.95, R * (0.16 + 0.12 * bead)));
      // scrolled boss on the front / back faces
      for (const s of [1, -1]) {
        const bz = z - s * R * 1.7, by = y - (yC0 - 0.62);
        const ring = abs(sqrt(x * x + by * by) - R * 0.9) - R * 0.16;
        c = min(c, max(ring, abs(bz) - R * 0.25));
      }
      d = smin(d, c, 0.04);
    }
    // shaft, snapped off with a jagged fracture
    {
      const rr = sqrt(x * x + z * z);
      let s = max(rr - R * (1 + 0.03 * Math.sin(y * 3)), y - yC1 + 0.1);
      const brk = -(y - (yC1 - SH)) + 0.25 * NA.fbm3(x * 3, z * 3, 1.7, 3) + 0.12 * (x / R);
      s = max(s, brk);
      // spiral fluting
      s += 0.012 * Math.sin(Math.atan2(z, x) * 8 + y * 1.4);
      d = min(d, s);
    }
    // casting / wear
    d += 0.004 * NB.noise3(x * 6, y * 6, z * 6) + 0.0015 * NA.noise3(x * 25, y * 25, z * 25);
    return d;
  };
}

export function buildTridentGeometry(o = {}) {
  const f = tridentSDF(o);
  const P = o.prong ?? 3.9, W = o.width ?? 1.3, SH = o.shaft ?? 8;
  const t0 = Date.now();
  const geo = meshWithCavity(f, { min: [-W - 0.8, -1.55 - SH - 0.6, -0.8], max: [W + 0.8, P + 0.6, 0.8], cell: o.cell || 0.025, smooth: 1, bandScale: 1.8, aoSteps: [0.02, 0.05, 0.1, 0.2] });
  geo.userData.buildMs = Date.now() - t0;
  return geo;
}
