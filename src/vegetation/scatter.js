// World placement of every palm / tree / shrub (golden era). Deterministic, terrain-aware (heightAt / slope),
// footprint-aware (engine.footprints from terrain → sets) and zone-aware (layout.js rings, canal, islets).
// Placement passes (each candidate also checks a local occupancy grid so crowns do not interpenetrate):
//   1. hero palms framing the golden shots (anchored to layout constants, not pixels)
//   2. slots / rows published by other modules (slots.palm, slots.tree, registry.cypressRows, city gardens)
//   3. citadel: plateau rim cypress + palms, ledge gardens (32 m, 18 m), rocky slopes (maquis, cypress, pines)
//   4. land rings: palm / cypress promenades in the wall setbacks along both edges, garden fill
//   5. sea-canal banks and moles, quays
//   6. outer city gardens, the plain (orchards, woods, cypress), islets and islands
import * as L from '../world/layout.js';
import { heightAt, slopeAt } from '../world/heightfield.js';
import { noiseA, noiseB, noiseC, smoothstep, clamp } from '../core/noise.js';
import { RNG } from '../core/rng.js';
import { SHOTS } from '../world/shots.js';

class Occ {
  constructor(cell = 8) { this.c = cell; this.m = new Map(); }
  _k(i, j) { return i * 100003 + j; }
  add(x, z, r) {
    const k = this._k(Math.floor(x / this.c), Math.floor(z / this.c));
    let b = this.m.get(k); if (!b) this.m.set(k, (b = []));
    b.push(x, z, r);
  }
  free(x, z, r) {
    const c = this.c, i0 = Math.floor((x - r - 6) / c), i1 = Math.floor((x + r + 6) / c);
    const j0 = Math.floor((z - r - 6) / c), j1 = Math.floor((z + r + 6) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const b = this.m.get(this._k(i, j)); if (!b) continue;
      for (let q = 0; q < b.length; q += 3) { const dx = b[q] - x, dz = b[q + 1] - z, rr = b[q + 2] + r; if (dx * dx + dz * dz < rr * rr) return false; }
    }
    return true;
  }
}

const D2R = Math.PI / 180;
// crown clearance (occupancy) and trunk clearance (footprints) radii per kind at scale 1
const OCC = { palm: 2.4, cypress: 1.3, olive: 2.6, broad: 3.2, pine: 4.2, shrub: 0.9, thicket: 2.6 };
const FPR = { palm: 0.9, cypress: 0.9, olive: 1.4, broad: 1.8, pine: 1.5, shrub: 0.5, thicket: 1.5 };
const SCALE = { palm: [0.85, 1.15], cypress: [0.55, 0.85], olive: [0.85, 1.15], broad: [0.65, 0.95], pine: [0.75, 1.05], shrub: [0.6, 1.35], thicket: [0.6, 1.0] };
// radial boundaries between land and water (walls, quays and rock faces stand on them)
const EDGES = [L.CITADEL.radius, ...L.RINGS.flatMap((g) => [g.r0, g.r1])].filter((v, i, a) => a.indexOf(v) === i);

export function scatterWorld(engine, sys, lib) {
  const t0 = performance.now();
  const q = engine.quality, P = engine.params;
  const D = clamp(Number(P?.get?.('vegDensity')) || Math.max(0.6, q.density ?? 1), 0.1, 2);
  const fp = engine.footprints;
  const occ = new Occ(8);
  const st = { palm: 0, cypress: 0, olive: 0, broad: 0, pine: 0, shrub: 0, thicket: 0 };
  const rej = { low: 0, slope: 0, occ: 0, fp: 0, edge: 0 };
  const TS = {}; let tLast = performance.now(), sLast = 'setup';
  let nLast = 0; const tot = () => Object.values(st).reduce((a, b) => a + b, 0);
  const stage = (n) => { const t = performance.now(), c = tot(); TS[sLast] = `${Math.round(t - tLast)}ms/${c - nLast}`; nLast = c; tLast = t; sLast = n; };

  const byStyle = (style) => lib.palm.filter((v) => v.style === style);
  const PSTYLE = { tall: byStyle('tall'), medium: byStyle('medium'), young: byStyle('young'), leaning: byStyle('leaning'), garden: byStyle('garden') };
  const pickVar = (kind, rng, style) => {
    let set = kind === 'palm' && style ? (Array.isArray(style) ? style.flatMap((s) => PSTYLE[s] || []) : PSTYLE[style]) : lib[kind];
    if (!set || !set.length) set = lib[kind];
    return set[Math.floor(rng.random() * set.length)];
  };
  /** distance (m) to the nearest land/water edge (ring faces, canal sides) */
  const edgeDist = (x, z) => {
    const r = Math.hypot(x, z);
    let d = 1e9;
    for (const e of EDGES) d = Math.min(d, Math.abs(r - e));
    const K = L.SEA_CANAL;
    if (z > K.z0 - 10 && z < K.z1 + 10) d = Math.min(d, Math.abs(Math.abs(x - K.x) - K.width / 2));
    return d;
  };

  // keep the immediate foreground of every golden shot clear (only the hero placements may frame it)
  const cams = SHOTS.filter((s) => s.era === 'golden').map((s) => {
    const f = [s.target[0] - s.pos[0], s.target[2] - s.pos[2]], l = Math.hypot(f[0], f[1]) || 1;
    return { x: s.pos[0], z: s.pos[2], fx: f[0] / l, fz: f[1] / l, half: Math.atan(Math.tan((s.fov * D2R) / 2) * 1672 / 941) + 0.25 };
  });
  const G5 = L.polar(L.GARDEN_TERRACE.r + 14, L.GARDEN_TERRACE.bearing);
  const protectedAt = (x, z) => {
    for (const c of cams) {
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
      if (d < 4) return true;
      if (d < 45 && Math.acos(clamp((dx * c.fx + dz * c.fz) / d, -1, 1)) < c.half) return true;
    }
    return Math.hypot(x - G5[0], z - G5[1]) < 40;
  };
  /**
   * try to place one plant. o: { rng, style (palm), s (scale), y (fixed height: slot), noFp, minH, maxSlope,
   *   edge (min distance to ring edges), occK (occupancy multiplier), fpK }
   */
  const place = (kind, x, z, o = {}) => {
    const rng = o.rng;
    const s = o.s ?? rng.range(...SCALE[kind]);
    let y = o.y;
    if (!o.hero && protectedAt(x, z)) { rej.cam = (rej.cam || 0) + 1; return false; }
    if (y === undefined) {
      y = heightAt(x, z);
      if (y < (o.minH ?? 1.0)) { rej.low++; return false; }
      if ((o.maxSlope ?? 0.35) < 1 && slopeAt(x, z, 1.2) > (o.maxSlope ?? 0.35)) { rej.slope++; return false; }
      if (edgeDist(x, z) < (o.edge ?? 5)) { rej.edge++; return false; }
    }
    const rOcc = OCC[kind] * s * (o.occK ?? 1);
    if (!occ.free(x, z, rOcc)) { rej.occ++; return false; }
    if (!o.noFp && fp && !fp.isFree(x, z, FPR[kind] * Math.max(0.7, s) * (o.fpK ?? 1))) { rej.fp++; return false; }
    const v = o.variant || pickVar(kind, rng, o.style);
    const tint = kind === 'palm' ? [rng.range(0.92, 1.08), rng.range(0.95, 1.06), rng.range(0.88, 1.02)] : [rng.range(0.9, 1.08), rng.range(0.92, 1.05), rng.range(0.88, 1.0)];
    sys.add(v, x, y, z, rng.random() * Math.PI * 2, s, { tint, width: rng.range(0.92, 1.08) });
    occ.add(x, z, rOcc);
    st[kind]++;
    return true;
  };
  /** weighted pick: mix = { palm: 3, cypress: 2, ... } */
  const choose = (mix, rng) => {
    let t = 0; for (const k in mix) t += mix[k];
    let u = rng.random() * t;
    for (const k in mix) { u -= mix[k]; if (u <= 0) return k; }
    return Object.keys(mix)[0];
  };
  const PALMY = ['tall', 'medium', 'garden'];

  // ------------------------------------------------------------ 1. hero palms around the golden shots
  stage('heroes');
  {
    const rng = new RNG('veg-hero');
    // shot 5 (ref 5): a palm right behind the garden-terrace viewpoint, fronds hanging into the top-right
    const s5 = SHOTS.find((s) => s.id === 5);
    if (s5) {
      const [px, py, pz] = s5.pos, [tx, , tz] = s5.target;
      const f = [tx - px, tz - pz], fl = Math.hypot(...f); f[0] /= fl; f[1] /= fl;
      const rt = [-f[1], f[0]];
      // crown ≈ 3.5 m above the lens, trunk just outside the right edge of the frame
      const v = PSTYLE.garden[0] || lib.palm[0];
      const x = px + rt[0] * 5.4 + f[0] * 5.2, z = pz + rt[1] * 5.4 + f[1] * 5.2;
      place('palm', x, z, { rng, variant: v, s: 1.0, y: py + 5.0 - v.Ht, noFp: true, occK: 0.3, hero: true });
    }
    // shot 3 (ref 3): palms flanking the plaza between the fountains and the stair balustrades
    for (const sx of [-1, 1]) for (const [x, z] of [[46, 92], [56, 70], [40, 104]]) place('palm', sx * x, z, { rng, style: ['tall', 'medium'], edge: 0, maxSlope: 0.6, fpK: 0.6, hero: true });
  }

  // ------------------------------------------------------------ 2. slots / rows from other modules
  stage('slots');
  {
    const rng = new RNG('veg-slots');
    for (const sl of engine.slots?.palm || []) {
      const s = sl.size ? clamp(sl.size / 9, 0.5, 1.6) : rng.range(0.9, 1.1);
      place('palm', sl.pos[0], sl.pos[2], { rng, s, y: sl.pos[1], noFp: true, occK: 0.4, hero: true, style: sl.tag && PSTYLE[sl.tag] ? sl.tag : sl.pos[1] > 20 ? 'garden' : PALMY });
    }
    for (const sl of engine.slots?.tree || []) {
      const kind = lib[sl.tag] ? sl.tag : 'shrub';
      const H0 = { palm: 12, cypress: 17, olive: 5, broad: 8, pine: 13, shrub: 1.6, thicket: 3 }[kind];
      const s = sl.size ? clamp(sl.size / H0, 0.3, 1.6) : rng.range(...SCALE[kind]);
      place(kind, sl.pos[0], sl.pos[2], { rng, s, y: sl.pos[1], noFp: true, occK: 0.5 });
    }
    for (const row of engine.registry?.cypressRows || []) {
      const pts = row.points, sp = row.spacing || 7;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ax = a[0], az = a.length === 3 ? a[2] : a[1], bx = b[0], bz = b.length === 3 ? b[2] : b[1];
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / sp));
        for (let k = 0; k <= n; k++) {
          const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          const s = (row.height ? row.height / 17 : 0.8) * rng.range(0.85, 1.1);
          place('cypress', x, z, { rng, s, edge: 3, occK: 0.6, maxSlope: 0.6 });
        }
      }
    }
    const gardens = engine.registry?.city?.gardens || [];
    for (const g of gardens) {
      const c = Math.cos(g.rot || 0), sn = Math.sin(g.rot || 0);
      const area = 4 * g.hw * g.hd;
      const orchard = g.kind === 'orchard';
      const n = Math.round(area / (orchard ? 55 : 32) * D);
      const grove = orchard && rng.chance(0.45);   // date-palm grove or olive orchard
      for (let i = 0; i < n; i++) {
        let lx, lz;
        if (orchard) { const cols = Math.max(1, Math.round(Math.sqrt(n * g.hw / g.hd))); lx = -g.hw + (2 * g.hw) * ((i % cols) + 0.5) / cols; lz = -g.hd + (2 * g.hd) * (Math.floor(i / cols) + 0.5) / Math.ceil(n / cols); }
        else { lx = rng.range(-g.hw, g.hw) * 0.9; lz = rng.range(-g.hd, g.hd) * 0.9; }
        const x = g.x + lx * c + lz * sn, z = g.z - lx * sn + lz * c;
        const kind = orchard ? (grove ? 'palm' : 'olive') : choose({ palm: 3, cypress: 2.2, olive: 1.2, broad: 0.8, shrub: 3 }, rng);
        place(kind, x, z, { rng, style: grove ? ['medium', 'tall'] : PALMY, edge: 3, occK: 0.7 });
      }
    }
  }

  // ------------------------------------------------------------ 3. citadel
  stage('citadel');
  {
    const rng = new RNG('veg-citadel');
    const C = L.CITADEL, [t1, t2] = C.terraces;
    // plateau rim: cypress groups and palms (ref 3 / ref 1: dark spires around the temple hill)
    for (let b = 0; b < 360; b += 3.1) {
      const r = C.plateau - rng.range(3, 8);
      const [x, z] = L.polar(r, b + rng.range(-1, 1));
      const k = noiseA.noise2(b * 0.05, 3.1) > 0.1 ? 'palm' : 'cypress';
      place(k, x, z, { rng, style: PALMY, edge: 0, maxSlope: 0.5 });
    }
    // plateau interior (temple footprints keep the precinct clear)
    for (let x = -C.plateau; x < C.plateau; x += 9) for (let z = -C.plateau; z < C.plateau; z += 9) {
      const xx = x + rng.range(-3.5, 3.5), zz = z + rng.range(-3.5, 3.5);
      if (Math.hypot(xx, zz) > C.plateau - 6 || !rng.chance(0.55 * D)) continue;
      place(choose({ palm: 3, cypress: 2, shrub: 2.5, olive: 0.6 }, rng), xx, zz, { rng, style: PALMY, edge: 0, maxSlope: 0.4 });
    }
    // ledges and slopes
    for (let r = C.plateau + 1; r < 221; r += 3.8) {
      const onLedge = (r > t1.r0 + 1.5 && r < t1.r1 - 1.5) || (r > t2.r0 + 1.5 && r < t2.r1 - 1.5);
      const quay = r > 213;
      const step = (onLedge ? 4.6 : quay ? 13 : 4.4) / r / D2R;
      for (let b = rng.random() * step; b < 360; b += step * rng.range(0.8, 1.25)) {
        const rr = r + rng.range(-2, 2);
        const [x, z] = L.polar(rr, b);
        const mask = noiseB.fbm2(x * 0.02, z * 0.02, 3);
        if (onLedge) {
          if (mask < -0.3 || !rng.chance(0.95 * Math.sqrt(D))) continue;
          place(choose({ palm: 3.5, cypress: 2.5, olive: 1, broad: 1, shrub: 3 }, rng), x, z, { rng, style: PALMY, edge: 0, maxSlope: 0.4 });
        } else if (quay) {
          if (rr > 220) continue;
          place('palm', x, z, { rng, style: ['tall', 'medium'], edge: 0, maxSlope: 0.3, minH: 1.5 });
        } else {
          // rocky hillside: maquis masses, cypress clumps, a few pines and palms in soil pockets
          if (mask < -0.25 || !rng.chance(0.9 * Math.sqrt(D))) continue;
          const k = choose({ shrub: 4, thicket: 1.5, cypress: 2, pine: 0.7, palm: 0.9, broad: 0.6 }, rng);
          place(k, x, z, { rng, style: ['leaning', 'medium', 'young'], edge: 0, maxSlope: k === 'shrub' || k === 'thicket' ? 0.8 : 0.6, minH: 2 });
        }
      }
    }
  }

  // ------------------------------------------------------------ 4. land rings: promenades + fill
  stage('rings');
  {
    const rng = new RNG('veg-rings');
    for (const g of L.RINGS.filter((g) => g.kind === 'land')) {
      // promenades in the wall setbacks (the city keeps ~15 m free behind the walls)
      for (const [r, pat] of [[g.r0 + 8.5, 0], [g.r0 + 12.5, 1], [g.r1 - 8.5, 2], [g.r1 - 12.5, 3]]) {
        const sp = pat % 2 ? 7 : 10.5;
        const step = sp / r / D2R;
        for (let b = rng.random() * step, i = 0; b < 360; b += step, i++) {
          const [x, z] = L.polar(r + rng.range(-0.8, 0.8), b);
          const sector = noiseC.noise2(b * 0.04, r * 0.01 + pat);
          let k;
          if (pat % 2 === 0) k = sector > 0.25 ? (i % 3 === 2 ? 'cypress' : 'palm') : sector > -0.35 ? 'palm' : i % 2 ? 'cypress' : 'palm';
          else if (sector < -0.2) {
            // clipped hedge segment: tight row of wide, low shrubs along the promenade
            for (let h = 0; h < 4; h++) {
              const [hx, hz] = L.polar(r, b + (h - 1.5) * (1.7 / r / D2R));
              const hv = lib.shrub[Math.floor(rng.random() * lib.shrub.length)];
              const hy = heightAt(hx, hz);
              if (hy < 1 || protectedAt(hx, hz) || (fp && !fp.isFree(hx, hz, 0.6)) || !occ.free(hx, hz, 0.4)) continue;
              sys.add(hv, hx, hy, hz, rng.random() * 6.28, rng.range(0.75, 0.9), { width: 1.5, tint: [0.92, 1.0, 0.9] });
              occ.add(hx, hz, 0.8); st.shrub++;
            }
            continue;
          } else { if (!rng.chance(0.55 * D)) continue; k = choose({ shrub: 4, olive: 1, broad: 0.6, cypress: 0.8 }, rng); }
          place(k, x, z, { rng, style: ['tall', 'medium', 'tall', 'garden'], edge: 5.5, occK: k === 'palm' ? 0.8 : 1 });
        }
      }
      // fill: everything the city / architecture left free (gardens, squares, leftover corners)
      const sp = 7.5;
      for (let r = g.r0 + 14; r < g.r1 - 14; r += sp) {
        const step = sp / r / D2R;
        for (let b = rng.random() * step; b < 360; b += step) {
          const [x, z] = L.polar(r + rng.range(-3, 3), b + rng.range(-0.3, 0.3) * step);
          const mask = noiseA.fbm2(x * 0.012 + 7, z * 0.012, 3);
          if (mask < -0.15 || !rng.chance(0.5 * D * smoothstep(-0.15, 0.4, mask))) continue;
          place(choose({ palm: 3, cypress: 2.5, olive: 1.2, broad: 1, shrub: 2.5, pine: 0.3 }, rng), x, z, { rng, style: PALMY, edge: 8, fpK: 1.3 });
        }
      }
    }
  }

  // ------------------------------------------------------------ 5. canal banks, moles
  stage('canal');
  {
    const rng = new RNG('veg-canal');
    const K = L.SEA_CANAL;
    for (const sx of [-1, 1]) for (const off of [8, 14]) {
      for (let z = 445; z < K.z1 + 10; z += off === 8 ? 11 : 9) {
        const x = K.x + sx * (K.width / 2 + off + rng.range(-1, 1));
        place(off === 8 ? 'palm' : rng.chance(0.5) ? 'cypress' : 'palm', x, z + rng.range(-1.5, 1.5), { rng, style: ['tall', 'medium'], edge: 5, occK: 0.8, minH: 2 });
      }
    }
    for (const M of L.MOLES) for (let z = M.from[1] + 20; z < M.to[1] - 30; z += 12) place('palm', M.from[0] + rng.range(-3, 3), z, { rng, style: ['tall', 'leaning'], edge: 0, minH: 1.5, maxSlope: 0.5 });
  }

  // ------------------------------------------------------------ 6. outer city, plain, islets, islands
  stage('outer');
  {
    const rng = new RNG('veg-outer');
    const O = L.OUTER_CITY;
    const inSea = (x, z) => L.inSeaSector(L.bearingOf(x, z));
    for (let r = O.r0 + 8; r < O.r1; r += 9) {
      const step = 9 / r / D2R;
      for (let b = rng.random() * step; b < 360; b += step) {
        const [x, z] = L.polar(r + rng.range(-3.5, 3.5), b);
        if (inSea(x, z)) continue;
        const mask = noiseB.fbm2(x * 0.008, z * 0.008, 3);
        if (!rng.chance(0.42 * D * smoothstep(-0.3, 0.3, mask))) continue;
        place(choose({ palm: 2.5, cypress: 2.5, olive: 2, broad: 1.2, shrub: 1.5, pine: 0.5 }, rng), x, z, { rng, style: PALMY, edge: r < O.r0 + 20 ? 6 : 2, maxSlope: 0.4 });
      }
    }
    stage('plain');
    // the plain: orchards (olive / date-palm rows), woods, cypress windbreaks; thinning with distance
    const far = q.detail >= 1 ? 5200 : 4200;
    for (let r = O.r1; r < far; r += 22) {
      const step = 22 / r / D2R;
      const thin = 1 - smoothstep(2600, far, r) * 0.65;
      for (let b = rng.random() * step; b < 360; b += step) {
        const [x0, z0] = L.polar(r, b);
        if (inSea(x0, z0)) continue;
        const wood = noiseA.fbm2(x0 * 0.0016, z0 * 0.0016, 4), orch = noiseC.fbm2(x0 * 0.0022 + 3, z0 * 0.0022, 3);
        if (wood > 0.12) {
          // woodland clump: 2-5 trees
          if (!rng.chance(0.8 * thin * D)) continue;
          const n = rng.int(2, 5);
          for (let k = 0; k < n; k++) place(choose({ broad: 3, pine: 2, cypress: 1.5, olive: 0.7, thicket: 1 }, rng), x0 + rng.range(-10, 10), z0 + rng.range(-10, 10), { rng, edge: 2, maxSlope: 0.5, minH: 2 });
        } else if (orch > 0.18) {
          if (!rng.chance(0.7 * thin * D)) continue;
          const palmGrove = orch > 0.38;
          // rows aligned to the radial grid
          for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) {
            const [dx, dz] = L.polar(r + k * 7, b + (j * 7) / r / D2R);
            place(palmGrove ? 'palm' : 'olive', dx, dz, { rng, style: ['medium', 'tall'], edge: 2, maxSlope: 0.4, occK: 0.6, minH: 2 });
          }
        } else if (rng.chance(0.18 * thin * D)) {
          place(choose({ cypress: 3, palm: 1.5, olive: 1, broad: 1 }, rng), x0 + rng.range(-8, 8), z0 + rng.range(-8, 8), { rng, style: PALMY, edge: 2, maxSlope: 0.5, minH: 2 });
        }
      }
    }
    stage('islets');
    // islets and islands: palms (leaning over the water), pines, maquis
    const isl = [...(L.ISLETS || []).map((I) => ({ ...I, sp: 6 })), ...L.ISLANDS.map((I) => ({ ...I, sp: 14 }))];
    for (const I of isl) {
      const [cx, cz] = I.center;
      for (let x = cx - I.r * 1.3; x < cx + I.r * 1.3; x += I.sp) for (let z = cz - I.r * 1.3; z < cz + I.r * 1.3; z += I.sp) {
        const xx = x + rng.range(-I.sp, I.sp) * 0.45, zz = z + rng.range(-I.sp, I.sp) * 0.45;
        if (!rng.chance(0.6 * D)) continue;
        const h = heightAt(xx, zz);
        if (h < 1.6) continue;
        const k = h < 5 ? choose({ palm: 4, shrub: 2 }, rng) : choose({ palm: 2, pine: 2, shrub: 3, thicket: 1, cypress: 0.6 }, rng);
        place(k, xx, zz, { rng, style: ['leaning', 'tall', 'young'], edge: 0, maxSlope: k === 'shrub' ? 0.75 : 0.55, minH: 1.6 });
      }
    }
  }
  stage('end');
  const ms = Math.round(performance.now() - t0);
  console.log(`[vegetation] scatter ${ms} ms (${Object.entries(TS).map(([k, v]) => `${k} ${v}`).join(', ')}); rejected ${Object.entries(rej).map(([k, v]) => `${k} ${v}`).join(' ')}`);
  return st;
}
