// Rough ruin stones: weathered ashlar blocks with chipped corners & edges, broken ends, and
// irregular limestone rocks. Each stone is a unique SDF (seeded) meshed with surface nets.
import { Simplex } from '../core/noise.js';
import { RNG, hashString } from '../core/rng.js';
import { rbox, ell, sph, smin, smax, max, min, abs, sqrt, meshWithCavity } from './sdf.js';

/**
 * @param {object} s
 * @param {'block'|'rock'} [s.kind]
 * @param {number[]} s.dims  full size [w, h, d] metres
 * @param {string} s.seed
 * @param {number} [s.chips]   number of corner/edge breaks
 * @param {number} [s.erosion] displacement amplitude (m)
 * @param {number} [s.round]   edge rounding radius (m)
 * @param {number} [s.broken]  -1 / +1 : the -x / +x end is a rough fracture surface (0 = none)
 * @param {number} [s.split]   amount of a deep weathering crack (0..1)
 */
export function stoneSDF(s) {
  const [w, h, d] = s.dims;
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const rng = new RNG('stone:' + s.seed);
  const N = new Simplex(hashString('stoneN:' + s.seed));
  const N2 = new Simplex(hashString('stoneM:' + s.seed));
  const size = min(w, h, d);
  const ero = s.erosion ?? 0.008 + 0.012 * size;
  const round = s.round ?? 0.008 + 0.013 * size;
  const kind = s.kind || 'block';
  // corner / edge breaks: planes cutting off corners, conchoidal scoops along edges
  const cuts = [], scoops = [];
  const nChips = Math.round((s.chips ?? 6) * 2.0);
  for (let i = 0; i < nChips; i++) {
    const sx = rng.sign(), sy = rng.sign(), sz = rng.sign();
    if (rng.chance(0.8)) {
      let nx = sx * rng.range(0.3, 1), ny = sy * rng.range(0.3, 1), nz = sz * rng.range(0.3, 1);
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const reach = nx * sx * hx + ny * sy * hy + nz * sz * hz; // support of the box along n
      const depth = rng.range(0.05, 0.26) * size + 0.015;
      cuts.push([nx, ny, nz, reach - depth]);
    } else {
      // scoop centred just outside an edge
      const axis = rng.int(0, 2);
      const c = [sx * hx, sy * hy, sz * hz];
      c[axis] = rng.range(-1, 1) * [hx, hy, hz][axis] * 0.8;
      const r = rng.range(0.08, 0.2) * size + 0.02;
      scoops.push([c[0], c[1], c[2], r]);
    }
  }
  const broken = s.broken || 0;
  const split = s.split || 0;
  const splitN = [rng.range(-0.3, 0.3), 1, rng.range(-0.4, 0.4)];
  const splitX = rng.range(-0.25, 0.25) * w;
  const lumpy = kind === 'rock' ? 1 : 0.22;
  // surface fissures: wandering weathering cracks a few cm deep (ref 9 / ref 8 blocks)
  const fiss = [];
  const nF = s.fissures ?? (kind === 'rock' ? 2 : 2 + rng.int(0, 1));
  for (let i = 0; i < nF; i++) {
    const a = rng.range(0, Math.PI), b = rng.range(-0.5, 0.5);
    fiss.push({ n: [Math.cos(a), b, Math.sin(a)], o: [rng.range(-0.3, 0.3) * w, rng.range(-0.3, 0.3) * h, rng.range(-0.3, 0.3) * d], w: rng.range(0.009, 0.016), D: rng.range(0.04, 0.09) * Math.min(1, size * 2), ph: rng.range(0, 50) });
  }
  return (x, y, z) => {
    let dd;
    if (kind === 'rock') {
      dd = smin(ell(x, y, z, hx, hy, hz), rbox(x, y, z, hx * 0.92, hy * 0.85, hz * 0.92, round * 2), size * 0.3);
    } else {
      dd = rbox(x, y, z, hx, hy, hz, round);
    }
    for (let i = 0; i < cuts.length; i++) {
      const c = cuts[i];
      dd = max(dd, x * c[0] + y * c[1] + z * c[2] - c[3] + 0.016 * N2.noise3(x * 6, y * 6, z * 6) + 0.006 * N.noise3(x * 19, y * 19, z * 19));
    }
    for (let i = 0; i < scoops.length; i++) {
      const c = scoops[i];
      const dx = x - c[0], dy = y - c[1], dz = z - c[2];
      if (dx * dx + dy * dy + dz * dz > (c[3] * 1.6) ** 2) continue;
      dd = max(dd, -(sqrt(dx * dx + dy * dy + dz * dz) - c[3] * (1 + 0.25 * N2.noise3(x * 12, y * 12, z * 12))));
    }
    if (broken) { // rough fracture replacing one end
      const fx = broken * x - (hx - 0.06 * w);
      dd = max(dd, fx + 0.05 * size * N.fbm3(x * 3 / size, y * 3 / size, z * 3 / size, 3) + 0.02 * N2.noise3(x * 14, y * 14, z * 14));
    }
    if (split) { // deep weathering crack through the block
      const pl = (x - splitX) * 1 + y * splitN[0] * 0.3 + z * splitN[2] * 0.2 + 0.04 * N.noise3(x * 4, y * 4, z * 4);
      dd = max(dd, -(abs(pl) - 0.012 * split * (0.6 + 0.4 * N2.noise3(x * 6, y * 6, z * 6))));
    }
    for (let i = 0; i < fiss.length; i++) {
      const F = fiss[i];
      const pl = (x - F.o[0]) * F.n[0] + (y - F.o[1]) * F.n[1] + (z - F.o[2]) * F.n[2] + 0.035 * N.noise3(x * 5 + F.ph, y * 5, z * 5) + 0.01 * N2.noise3(x * 17, y * 17 + F.ph, z * 17);
      const ww = F.w * (N2.noise3(x * 2.2 + F.ph, y * 2.2, z * 2.2) * 1.6 + 0.3);
      if (ww <= 0 || dd < -F.D - 0.02) continue;
      dd = max(dd, -max(abs(pl) - ww, -dd - F.D * (0.5 + 0.5 * N.noise3(x * 3, y * 3 + F.ph, z * 3))));
    }
    // erosion: soft lumps + sugary roughness
    dd += ero * (lumpy * N.fbm3(x * 1.6 / size, y * 1.6 / size, z * 1.6 / size, 2) + 0.35 * N2.noise3(x * 5, y * 5, z * 5) + 0.12 * N.noise3(x * 17, y * 17, z * 17));
    return dd;
  };
}

/** mesh a stone spec; returns geometry centred at the stone's origin (metres) */
export function buildStone(s) {
  const f = stoneSDF(s);
  const [w, h, d] = s.dims;
  const m = 0.12 + 0.05 * max(w, h, d);
  const cell = s.cell || 0.03;
  return meshWithCavity(f, {
    min: [-w / 2 - m, -h / 2 - m, -d / 2 - m], max: [w / 2 + m, h / 2 + m, d / 2 + m], cell,
    smooth: 1, bandScale: 1.6, aoSteps: [0.03, 0.08, 0.16, 0.3].map((v) => v * Math.min(1, 0.4 + min(w, h, d))),
  });
}
