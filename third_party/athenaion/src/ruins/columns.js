// Column pieces for the ruins as SDFs: fluted / plain drums with entasis, worn arrises, chips and
// broken ends; Attic bases (plinth + torus + scotia + torus) with an optional carved rosette on the
// underside (the fallen base in ref 9). All in local space: column axis = +y, centred at origin.
import { Simplex } from '../core/noise.js';
import { RNG, hashString } from '../core/rng.js';
import { cyl, box, torus, sph, smin, smax, max, min, abs, sqrt, clamp, sstep, meshWithCavity } from './sdf.js';

const TAU = Math.PI * 2;

/** flute groove depth profile at angle a (n flutes separated by flat fillets) */
function fluteAt(a, n, fillet) {
  let f = (a / TAU) * n; f -= Math.floor(f);
  const u = (f - 0.5) / (0.5 - fillet);
  return abs(u) >= 1 ? 0 : sqrt(1 - u * u);
}

/**
 * @param {object} s
 * @param {number} s.r       radius at the bottom (m)
 * @param {number} s.h       height (m)
 * @param {number} [s.taper] radius reduction at the top (fraction)
 * @param {number} [s.flutes] number of flutes (0 = plain)
 * @param {number} [s.fluteDepth]
 * @param {number} [s.breakTop] amplitude of a rough fracture at the top (0 = clean joint)
 * @param {number} [s.breakBottom]
 * @param {number} [s.chips]
 * @param {number} [s.erosion]
 * @param {number} [s.cracks] number of vertical cracks
 * @param {string} s.seed
 */
export function drumSDF(s) {
  const rng = new RNG('drum:' + s.seed);
  const N = new Simplex(hashString('drumN:' + s.seed)), N2 = new Simplex(hashString('drumM:' + s.seed));
  const R = s.r, H = s.h, hh = H / 2;
  const taper = s.taper ?? 0.02;
  const nF = s.flutes ?? 0, fd = s.fluteDepth ?? R * 0.085, fillet = s.fillet ?? 0.1;
  const ero = s.erosion ?? 0.006;
  const bt = s.breakTop ?? 0, bb = s.breakBottom ?? 0;
  const chips = [];
  for (let i = 0; i < (s.chips ?? 5); i++) {
    const a = rng.range(0, TAU), top = rng.chance(0.5) ? 1 : -1;
    const rr = rng.range(0.06, 0.2) * R + 0.03;
    const yy = top * hh * rng.range(0.6, 1.0);
    chips.push([Math.cos(a) * R * 1.02, yy, Math.sin(a) * R * 1.02, rr]);
  }
  const cracks = [];
  for (let i = 0; i < (s.cracks ?? 1); i++) cracks.push({ a: rng.range(0, TAU), w: rng.range(0.004, 0.009), y0: rng.range(-hh, hh * 0.3), len: rng.range(0.3, 1.0) * H });
  const tiltT = [rng.range(-0.25, 0.25), rng.range(-0.25, 0.25)], tiltB = [rng.range(-0.12, 0.12), rng.range(-0.12, 0.12)];
  return (x, y, z) => {
    const rad = sqrt(x * x + z * z);
    const a = Math.atan2(z, x);
    const t = clamp((y + hh) / H, 0, 1);
    let rs = R * (1 - taper * t);
    if (nF) rs -= fd * fluteAt(a + 0.004 * N2.noise3(x * 5, y * 5, z * 5), nF, fillet);
    let d = rad - rs;
    // ends
    let top = y - hh, bot = -hh - y;
    if (bt) top = y - (hh + x * tiltT[0] + z * tiltT[1]) + bt * (0.6 * N.fbm3(x * 2.2, z * 2.2, 1.3, 3) + 0.25 * N2.noise3(x * 9, y * 9, z * 9));
    if (bb) bot = -(y - (-hh + x * tiltB[0] + z * tiltB[1])) + bb * (0.6 * N.fbm3(x * 2.2, z * 2.2, 7.1, 3) + 0.25 * N2.noise3(x * 9, y * 9, z * 9));
    d = max(d, top, bot);
    // worn arris at clean joints
    if (!bt) d = smax(d, top, 0.03);
    if (!bb) d = smax(d, bot, 0.03);
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i];
      const dx = x - c[0], dy = y - c[1], dz = z - c[2];
      if (dx * dx + dy * dy + dz * dz > (c[3] * 1.6) ** 2) continue;
      d = max(d, -(sqrt(dx * dx + dy * dy + dz * dz) - c[3] * (1 + 0.3 * N2.noise3(x * 11, y * 11, z * 11))));
    }
    for (let i = 0; i < cracks.length; i++) {
      const k = cracks[i];
      if (y < k.y0 || y > k.y0 + k.len) continue;
      let da = a - k.a - 0.08 * N.noise3(y * 1.5, k.a, 3.3); da -= Math.round(da / TAU) * TAU;
      const fade = sstep(k.y0, k.y0 + 0.15, y) * sstep(k.y0 + k.len, k.y0 + k.len - 0.3, y);
      d = max(d, -(abs(da * rad) - k.w * fade) - (1 - fade) * 0.05);
    }
    d += ero * (N.noise3(x * 6, y * 6, z * 6) * 0.6 + N2.noise3(x * 19, y * 19, z * 19) * 0.4);
    return d;
  };
}

export function buildDrum(s) {
  const f = drumSDF(s);
  const m = 0.08 + (s.breakTop || 0) + (s.breakBottom || 0);
  return meshWithCavity(f, { min: [-s.r - 0.08, -s.h / 2 - m, -s.r - 0.08], max: [s.r + 0.08, s.h / 2 + m, s.r + 0.08], cell: s.cell || 0.025, smooth: 1, bandScale: 1.6, aoSteps: [0.02, 0.05, 0.1, 0.2] });
}

/**
 * Attic column base: square plinth, lower torus, scotia, upper torus, fillet + start of the shaft.
 * Local axis +y; origin at the bottom of the plinth. `rosette`: carve a rosette into the plinth
 * underside (the end face seen when the base lies on its side, ref 9).
 */
export function baseSDF(s) {
  const R = s.r; // shaft radius
  const rng = new RNG('base:' + s.seed);
  const N = new Simplex(hashString('baseN:' + s.seed)), N2 = new Simplex(hashString('baseM:' + s.seed));
  const plH = R * 0.36, plW = R * 1.42;           // plinth half width
  const t1R = R * 1.32, t1r = R * 0.17, t1y = plH + t1r * 0.95;
  const scY0 = t1y + t1r * 0.7, scY1 = scY0 + R * 0.24;
  const t2R = R * 1.16, t2r = R * 0.13, t2y = scY1 + t2r * 0.75;
  const shaftY0 = t2y + t2r * 0.8, shaftH = s.shaft ?? R * 0.5;
  const hTot = shaftY0 + shaftH;
  const ero = s.erosion ?? 0.006;
  const chips = [];
  for (let i = 0; i < (s.chips ?? 6); i++) {
    const a = rng.range(0, TAU), yy = rng.range(0, hTot);
    const rr = rng.range(0.05, 0.14) * R * 2;
    chips.push([Math.cos(a) * plW * 1.05, yy, Math.sin(a) * plW * 1.05, rr]);
  }
  const ros = s.rosette;
  return {
    height: hTot,
    f: (x, y, z) => {
      const rad = sqrt(x * x + z * z);
      let d = box(x, y - plH / 2, z, plW, plH / 2, plW) - 0.01;
      if (s.roundPlinth) d = max(cyl(x, y - plH / 2, z, plW, plH / 2), d - 0.0);
      d = min(d, torus(x, y - t1y, z, t1R, t1r));
      // scotia: concave hollow between the tori
      const scR = R * 1.12 - R * 0.11 * Math.sin(Math.PI * clamp((y - scY0) / (scY1 - scY0), 0, 1));
      d = min(d, max(rad - scR, abs(y - (scY0 + scY1) / 2) - (scY1 - scY0) / 2));
      d = min(d, torus(x, y - t2y, z, t2R, t2r));
      // shaft stub with apophyge
      const ap = R + R * 0.08 * Math.exp(-(y - shaftY0) / (R * 0.08));
      d = min(d, max(rad - ap, shaftY0 - 0.01 - y, y - hTot));
      if (s.breakTop) d = max(d, y - hTot + s.breakTop * (1 + N.fbm3(x * 2, z * 2, 3.3, 3)));
      if (ros) { // carved rosette into the plinth underside (y ≈ 0): rings + petals + centre boss
        if (y < 0.12 && rad < plW * 1.02) {
          const a = Math.atan2(z, x);
          const rn = rad / (plW * 0.95);
          let carve = 0;
          // outer rings
          carve = max(carve, 1 - sstep(0.0, 0.02, abs(rn - 0.93) - 0.012));
          carve = max(carve, 1 - sstep(0.0, 0.02, abs(rn - 0.84) - 0.008));
          // petals (two layers)
          const p1 = Math.cos(a * 8) * 0.5 + 0.5, p2 = Math.cos(a * 8 + Math.PI / 8 * 2) * 0.5 + 0.5;
          const petalOuter = 0.62 + 0.14 * p1;
          const inPet = rn < petalOuter && rn > 0.18 ? 1 : 0;
          const vein = inPet * (1 - sstep(0.0, 0.18, p1)) * 0.8;
          const petalEdge = inPet * (1 - sstep(0.0, 0.035, abs(rn - petalOuter)));
          carve = max(carve, petalEdge, vein * sstep(0.3, 0.5, rn));
          const inner = (rn < 0.38 + 0.08 * p2 && rn > 0.2) ? (1 - sstep(0.0, 0.03, abs(rn - (0.38 + 0.08 * p2)))) : 0;
          carve = max(carve, inner);
          // centre boss ring
          carve = max(carve, 1 - sstep(0.0, 0.02, abs(rn - 0.16) - 0.01));
          // background between rosette and ring slightly recessed
          const field = (rn > 0.7 + 0.14 * p1 && rn < 0.82) ? 0.6 : 0;
          carve = max(carve, field);
          d = max(d, 0.03 * carve * ros - y);
        }
      }
      for (let i = 0; i < chips.length; i++) {
        const c = chips[i];
        const dx = x - c[0], dy = y - c[1], dz = z - c[2];
        if (dx * dx + dy * dy + dz * dz > (c[3] * 1.6) ** 2) continue;
        d = max(d, -(sqrt(dx * dx + dy * dy + dz * dz) - c[3] * (1 + 0.3 * N2.noise3(x * 11, y * 11, z * 11))));
      }
      d += ero * (N.noise3(x * 6, y * 6, z * 6) * 0.6 + N2.noise3(x * 19, y * 19, z * 19) * 0.4);
      return d;
    },
  };
}

export function buildBase(s) {
  const b = baseSDF(s);
  const W = s.r * 1.6;
  return meshWithCavity(b.f, { min: [-W, -0.06, -W], max: [W, b.height + 0.1 + (s.breakTop || 0), W], cell: s.cell || 0.02, smooth: 1, bandScale: 1.6, aoSteps: [0.02, 0.05, 0.1, 0.2] });
}

/**
 * Fragment of a fluted pilaster / anta: a block whose front (+z) face carries vertical flutes and
 * whose top carries a carved band of egg-and-dart. Origin at the bottom centre.
 * s: { w, h, d, flutes, seed, chips, cell }
 */
export function pilasterSDF(s) {
  const rng = new RNG('pil:' + s.seed);
  const N = new Simplex(hashString('pilN:' + s.seed)), N2 = new Simplex(hashString('pilM:' + s.seed));
  const hw = s.w / 2, hd = s.d / 2, H = s.h;
  const band = s.band ?? 0.24;
  const nF = s.flutes ?? 6;
  const chips = [];
  for (let i = 0; i < (s.chips ?? 8); i++) {
    const sx = rng.sign(), sz = rng.chance(0.7) ? 1 : -1;
    chips.push([sx * hw * rng.range(0.5, 1.05), rng.range(0.05, 1) * H, sz * hd * 1.02, rng.range(0.06, 0.16)]);
  }
  return (x, y, z) => {
    let d = box(x, y - H / 2, z, hw, H / 2, hd) - 0.006;
    // flutes on the front and side faces below the band
    if (y < H - band - 0.04 && y > 0.12) {
      const fl = (u, half) => { // groove depth across a face of half width `half`
        const t = (u + half * 0.86) / (half * 1.72) * nF;
        if (t < 0 || t > nF) return 0;
        const f = t - Math.floor(t), k = (f - 0.5) / 0.38;
        return Math.abs(k) >= 1 ? 0 : Math.sqrt(1 - k * k);
      };
      const endFade = sstep(0.12, 0.3, y) * sstep(H - band - 0.04, H - band - 0.22, y);
      d = max(d, -(z - hd + 0.045 * fl(x, hw) * endFade));
      d = max(d, -(abs(x) - hw + 0.045 * fl(z, hd) * endFade * 0.7));
    }
    // carved band: an overhanging moulding with egg-and-dart
    if (y > H - band - 0.06) {
      const yb = y - (H - band);
      let m = box(x, y - (H - band / 2), z, hw + 0.05, band / 2, hd + 0.05) - 0.01;
      // egg-and-dart along the front: ovals separated by darts
      const pitch = 0.16;
      const ex = x / pitch - Math.floor(x / pitch) - 0.5;
      const egg = Math.sqrt((ex / 0.36) ** 2 + ((yb - band * 0.55) / (band * 0.32)) ** 2) - 1;
      const groove = abs(egg) < 0.25 ? 0.02 * (1 - abs(egg) / 0.25) : 0;
      const dart = abs(ex) > 0.45 && abs(yb - band * 0.5) < band * 0.3 ? 0.018 : 0;
      if (z > 0) m = max(m, -(z - hd - 0.05 + groove + dart));
      // bead row under the band
      const bx = x / 0.05 - Math.floor(x / 0.05) - 0.5;
      if (yb < 0.03 && yb > -0.04) m = min(m, sqrt((bx * 0.05) ** 2 + (yb + 0.005) ** 2 + 0) - 0.022 + max(0, abs(z) - hd - 0.02) * 0 + (z < hd - 0.05 ? 1 : 0) * max(0, abs(x) - hw - 0.02));
      d = min(d, m);
    }
    for (const c of chips) {
      const dx = x - c[0], dy = y - c[1], dz = z - c[2];
      if (dx * dx + dy * dy + dz * dz > (c[3] * 1.6) ** 2) continue;
      d = max(d, -(sqrt(dx * dx + dy * dy + dz * dz) - c[3] * (1 + 0.3 * N2.noise3(x * 11, y * 11, z * 11))));
    }
    // broken top edge
    d = max(d, y - H + 0.02 + 0.05 * Math.max(0, N.fbm3(x * 2.5, z * 2.5, 1.7, 3)));
    d += 0.006 * N.noise3(x * 7, y * 7, z * 7) + 0.003 * N2.noise3(x * 21, y * 21, z * 21);
    return d;
  };
}
export function buildPilaster(s) {
  const f = pilasterSDF(s);
  return meshWithCavity(f, { min: [-s.w / 2 - 0.12, -0.05, -s.d / 2 - 0.12], max: [s.w / 2 + 0.12, s.h + 0.1, s.d / 2 + 0.12], cell: s.cell || 0.02, smooth: 1, bandScale: 1.6, aoSteps: [0.02, 0.05, 0.1, 0.2] });
}
