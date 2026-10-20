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
import { SEQUENCE, cameraAt } from '../video/sequence.js';
import { surfaceMap } from './surface.js';

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
  let rLast = {};
  const stage = (n) => {
    const t = performance.now(), c = tot();
    const dr = Object.entries(rej).map(([k, v]) => [k, v - (rLast[k] || 0)]).filter(([, v]) => v > 0).map(([k, v]) => `${k}${v}`).join(' ');
    TS[sLast] = `${Math.round(t - tLast)}ms/${c - nLast}` + (dr ? ` [${dr}]` : '');
    rLast = { ...rej }; nLast = c; tLast = t; sLast = n;
  };

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
  // (r5) ... and the whole video-segment camera path of the low golden shots (src/video/sequence.js): no plant within
  // a few metres of the lens anywhere along the move (the still-camera cone above only covers u = 0.5)
  const pathPts = [];
  for (const s of SHOTS.filter((q) => q.era === 'golden' && q.pos[1] < 80)) {
    const seg = SEQUENCE.find((g) => String(g.shot) === String(s.id));
    if (seg) for (let i = 0; i <= 32; i++) pathPts.push(cameraAt(s, seg, i / 32).pos);
  }
  const HK = { palm: 12, cypress: 17, olive: 5, broad: 8, pine: 13, shrub: 1.6, thicket: 3 };
  const nearPath = (kind, x, y, z, s) => {
    const rr = OCC[kind] * s * 0.8 + 2.5, top = y + HK[kind] * s;
    for (const p of pathPts) {
      const dx = x - p[0], dz = z - p[2];
      if (Math.abs(dx) > rr + 1 || Math.abs(dz) > rr + 1) continue;
      const dy = Math.max(y - p[1], 0, p[1] - top);
      if (dx * dx + dy * dy + dz * dz < rr * rr) return true;
    }
    return false;
  };
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
  const T1 = L.CITADEL.terraces[0];
  const heightCap = (kind, x, z) => {
    const r = Math.hypot(x, z);
    if (r < T1.r0 - 2 || r > T1.r1 + 2) return 0;
    const b = L.bearingOf(x, z);
    if (b < 150 || b > 230) return 0;
    return kind === 'cypress' ? 8 : kind === 'palm' || kind === 'pine' ? 10 : 0;
  };
  const place = (kind, x, z, o = {}) => {
    const rng = o.rng;
    let s = o.s ?? rng.range(...SCALE[kind]);
    let y = o.y;
    if (!o.hero && !o.slot && protectedAt(x, z)) { rej.cam = (rej.cam || 0) + 1; return false; }
    if (y === undefined) {
      y = heightAt(x, z);
      if (y < (o.minH ?? 1.0)) { rej.low++; return false; }
      if ((o.maxSlope ?? 0.35) < 1 && slopeAt(x, z, 1.2) > (o.maxSlope ?? 0.35)) { rej.slope++; return false; }
      if (edgeDist(x, z) < (o.edge ?? 5)) { rej.edge++; return false; }
    }
    if (!o.hero && pathPts.length && nearPath(kind, x, y, z, s)) { rej.path = (rej.path || 0) + 1; return false; }
    const rOcc = OCC[kind] * s * (o.occK ?? 1);
    if (!occ.free(x, z, rOcc)) { rej.occ++; return false; }
    if (!o.noFp && fp && !fp.isFree(x, z, FPR[kind] * Math.max(0.7, s) * (o.fpK ?? 1), o.fpIgnore || null)) { rej.fp++; return false; }
    const v = o.variant || pickVar(kind, rng, o.style);
    // height caps (citadel request r3): south face of ledge 1 (bearings 150-230) — cypress ≤ 8 m, palms / pines ≤ 10 m,
    // so they do not hide the red rampart tiers in shots 1 / 3 / 5
    const cap = heightCap(kind, x, z);
    if (cap && v.H * s > cap) s = cap / v.H;
    const tint = o.tint ? o.tint : kind === 'palm' ? [rng.range(0.92, 1.08), rng.range(0.95, 1.06), rng.range(0.88, 1.02)] : [rng.range(0.9, 1.08), rng.range(0.92, 1.05), rng.range(0.88, 1.0)];
    sys.add(v, x, y, z, o.yaw ?? rng.random() * Math.PI * 2, s, { tint, width: rng.range(0.92, 1.08) * (o.width || 1), up: o.up });
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
      const v = lib.palmHero || PSTYLE.garden[0] || lib.palm[0];
      // r3: closer + lower + fuller so the fronds hang into the top-right corner (ref 5: x > 1150, y < 260)
      const x = px + rt[0] * 4.7 + f[0] * 4.3, z = pz + rt[1] * 4.7 + f[1] * 4.3;
      // r4: lit golden-green like ref 5 (was dark against the sky): per-instance tint
      place('palm', x, z, { rng, variant: v, s: 1.3, y: py + 4.6 - v.Ht * 1.3, yaw: 2.6, noFp: true, occK: 0.3, hero: true, tint: [1.55, 1.5, 1.05] });
    }
    // shot 3 (ref 3): palms flanking the plaza between the fountains and the stair balustrades
    // (r3: the stair-top palms / cypress of ref 3 now come from the sets module's slots.palm ('date set3', 'cypress set3'))
    if (!(engine.slots?.palm || []).some((sl) => /set3/.test(String(sl.tag || ''))))
      for (const sx of [-1, 1]) for (const [x, z] of [[46, 92], [56, 70], [40, 104]]) place('palm', sx * x, z, { rng, style: ['tall', 'medium'], edge: 0, maxSlope: 0.6, fpK: 0.6, hero: true });
  }

  // ------------------------------------------------------------ 2. slots / rows from other modules
  stage('slots');
  {
    const rng = new RNG('veg-slots');
    for (const sl of engine.slots?.palm || []) {
      const tag = String(sl.tag || '');
      // r3: sets tag their slots 'cypress set3', 'date set5', 'date hero set5' (kind + style words)
      if (/cypress/.test(tag)) {
        place('cypress', sl.pos[0], sl.pos[2], { rng, s: sl.size ? clamp(sl.size / 17, 0.35, 1.2) : 0.7, y: sl.pos[1], noFp: true, occK: 0.4, hero: true });
        continue;
      }
      const style = PSTYLE[tag] ? tag : /date/.test(tag) ? ((sl.size || 10) > 11.5 ? 'tall' : 'medium') : sl.pos[1] > 20 ? 'garden' : PALMY;
      const variant = pickVar('palm', rng, style);
      // size = overall height (m) for the sets' 'date' slots; older slots: size / 9 (≈ the r1 convention)
      const s = sl.size ? clamp(/date/.test(tag) ? sl.size / variant.H : sl.size / 9, 0.5, 1.6) : rng.range(0.9, 1.1);
      place('palm', sl.pos[0], sl.pos[2], { rng, s, y: sl.pos[1], noFp: true, occK: /hero/.test(tag) ? 0.2 : 0.4, hero: true, variant });
    }
    for (const sl of engine.slots?.tree || []) {
      const kind = lib[sl.tag] ? sl.tag : 'shrub';
      // (r5) size = the overall height asked for: scale the PICKED variant to it (the young / pencil cypress variants are
      // 11-26 m at scale 1, so a 20 m mole-row slot came out 13 m and vanished behind the shot-4 curtain)
      const variant = pickVar(kind, rng, kind === 'palm' ? PALMY : null);
      // shed-mole cypress row (rings-mole, 18-25 m): from the shot-4 eye (2.5 m, 32 m away) the 26 m curtain + pylons hide
      // everything below ≈ 33 m → ×1.35 (≤ 32 m tall): the spires rise well above the curtain like the ref-4 skyline
      const size = sl.size && kind === 'cypress' && sl.source === 'rings-mole' ? Math.min(32, sl.size * 1.35) : sl.size;
      const s = size ? clamp(size / variant.H, 0.3, 2.0) : rng.range(...SCALE[kind]);
      // slots are placed deliberately by the architecture (e.g. the mole-top cypress row above the shot-4 curtain): the
      // still-camera foreground cone does not apply (the 3D camera-path clearance still does)
      place(kind, sl.pos[0], sl.pos[2], { rng, s, y: sl.pos[1], noFp: true, occK: 0.5, variant, slot: true });
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
        // r4: more shade-tree canopy (broadleaf / umbrella pine / olive) in the courts: from the shot-1 aerial (1-1.5 km)
        // palms read as dark specks between the houses, the ref-1 rings read as lit green masses overtopping the roofs
        const kind = orchard ? (grove ? 'palm' : 'olive') : choose({ palm: 1.7, cypress: 1.8, olive: 1.4, broad: 2.6, pine: 0.9, shrub: 1.6 }, rng);
        const big = kind === 'broad' || kind === 'olive' || kind === 'pine' ? 1.3 : kind === 'cypress' ? 1.2 : 1;
        place(kind, x, z, { rng, s: rng.range(...SCALE[kind]) * big, style: grove ? ['medium', 'tall'] : PALMY, edge: 3, occK: 0.7 });
      }
    }
  }

  // ------------------------------------------------------------ 3. citadel
  stage('citadel');
  {
    const rng = new RNG('veg-citadel');
    const C = L.CITADEL, [t1, t2] = C.terraces;
    // r3: real meshed ground (3D rock displacement on the 48-50° slopes) + what the architecture modules built
    // (palaces, ramparts, stairs, basins: often without footprints), from two top-down float renders
    const troot = engine.registry?.terrain?.root;
    const RES = q.detail >= 1 ? 1800 : 1300, SZ = 2 * (C.radius + 4);
    const gm = troot && !P?.get?.('vegNoMap') ? surfaceMap(engine, { cx: 0, cz: 0, size: SZ, res: RES, top: 200, bottom: -15, only: troot }) : null;
    const tm = gm ? surfaceMap(engine, { cx: 0, cz: 0, size: SZ, res: RES, top: 200, bottom: -15 }) : null;
    /** ground site for a plant of trunk radius rad: { y, grad } or null (built over / no ground / too steep) */
    const site = (x, z, rad, maxGrad) => {
      if (!tm) {
        const y = heightAt(x, z), g = Math.tan(Math.acos(clamp(1 - slopeAt(x, z, 1.2), 0.05, 1)));
        return g > maxGrad ? null : { y, grad: g };
      }
      const g0 = gm.y(x, z);
      if (Number.isNaN(g0)) return null;
      const [glo, ghi] = gm.range(x, z, rad), [, thi] = tm.range(x, z, rad);
      if (thi - Math.max(ghi, g0) > 0.4) { rej.built = (rej.built || 0) + 1; return null; }   // something built stands here
      const grad = (ghi - glo) / (2 * rad);
      if (grad > maxGrad) { rej.slope++; return null; }
      return { y: g0, grad };
    };
    // r4: maquis / thickets also root in the steep 60-80° rock (ref 1 / 4: green clinging to the cliffs between the tiers)
    const SPEC = { palm: [0.5, 0.8], cypress: [0.5, 1.3], olive: [0.7, 1.8], broad: [0.7, 3.4], pine: [0.8, 1.1], shrub: [0.45, 6.5], thicket: [0.7, 5.5] };   // [trunk probe radius, max gradient]
    const plant = (kind, x, z, o = {}) => {
      const [pr, mg] = SPEC[kind];
      const st0 = site(x, z, pr * (o.sc ?? 1), o.maxGrad ?? mg);
      if (!st0) return false;
      const s = o.s ?? rng.range(...SCALE[kind]) * (o.k ?? 1);
      // on slopes the downhill side of the base would float: sink the plant into the rock a little
      const H = { palm: 12, cypress: 17, olive: 5, broad: 8, pine: 13, shrub: 1.6, thicket: 3 }[kind] * s;
      const sink = Math.min(0.4 * H, 1.6, st0.grad * pr * s * 0.6) + (kind === 'shrub' || kind === 'thicket' ? 0.12 : 0.05);
      // cliff plants (crevices of the steep rock): lean out of the face, toward the light / away from the hill
      let up;
      if (st0.grad > 1.1 && kind !== 'cypress' && kind !== 'palm') {
        const r = Math.hypot(x, z) || 1, k = Math.min(0.55, (st0.grad - 1.1) * 0.3) * rng.range(0.6, 1.2);
        up = [(x / r) * k, 1, (z / r) * k];
      }
      // (r5) maquis on the steep faces: wide, low cushions draped over the rock (from the shot-1 aerial the narrow
      // bushes left the cliff bands under the ledges bare grey; ref 1 reads green there)
      let width;
      if ((kind === 'shrub' || kind === 'thicket') && st0.grad > 0.8) width = (1.3 + Math.min(0.55, (st0.grad - 0.8) * 0.45)) * rng.range(0.85, 1.15);
      return place(kind, x, z, { rng, s, y: st0.y - sink, up, width, style: o.style || PALMY, occK: (o.occK ?? 1) * (width ? Math.sqrt(width) : 1), fpK: o.fpK ?? 1, noFp: o.noFp, variant: o.variant, fpIgnore: o.fpIgnore || FP_IGNORE });
    };
    const mixPick = (mix) => choose(mix, rng);
    // planting reservations of the citadel module (its own garden slots are placed above): fill between them
    const FP_IGNORE = ['citadel-ledge-garden'];
    const FP_IGNORE_FALL = [...FP_IGNORE, 'waterfall'], FP_IGNORE_SLOPE = [...FP_IGNORE_FALL, 'rampart'];
    // (r5) the rampart footprint is the wall + 1.6 m each side: test the wall ring itself (registry.temple.ramparts) so the
    // maquis reaches down to the rampart's inner face (the rock band above the tier-2 rampart read bare from the air)
    const RAMP = (engine.registry?.temple?.ramparts || []).map((R) => [R.rIn - 0.4, R.r + 0.6]);
    const nearFall = (x, z) => {
      if (RAMP.length) { const r = Math.hypot(x, z); for (const [a, b] of RAMP) if (r > a && r < b) return true; }
      else if (fp && fp.query(x, z, 0.8).some((it) => it.tag === 'rampart')) return true;
      for (const it of fp ? fp.query(x, z, 0.5, null) : []) {
        if (it.tag !== 'waterfall' || it.type !== 'r') continue;
        const dx = x - it.x, dz = z - it.z;
        const lx = dx * it.cos - dz * it.sin, lz = dx * it.sin + dz * it.cos;
        if (Math.abs(lx) < it.hw - 1.2 && Math.abs(lz) < it.hd) return true;
      }
      return false;
    };
    // no tall trees on the near (south) plateau rim: from the water-level cameras (shots 4 / 5) they hide the temple
    const southRim = (b) => b > 112 && b < 245;
    const stairSector = (b, r) => Math.abs(r * Math.sin((b - 180) * D2R)) < L.CITADEL_STAIR.width / 2 + 5 && b > 90 && b < 270;

    // (a) plateau interior: garden groves (clusters), not a lattice — the precinct paving stays open (ref 3)
    for (let gx = -C.plateau; gx < C.plateau; gx += 24) for (let gz = -C.plateau; gz < C.plateau; gz += 24) {
      const cx = gx + rng.range(2, 22), cz = gz + rng.range(2, 22);
      const rc = Math.hypot(cx, cz);
      if (rc > 92 || !rng.chance(0.75 * Math.sqrt(D))) continue;
      const n = rng.int(4, 8);
      for (let i = 0; i < n; i++) {
        const a = rng.random() * 6.283, d = Math.sqrt(rng.random()) * 9;
        const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        plant(mixPick({ palm: 2.6, cypress: 2.4, shrub: 3, olive: 0.8, broad: 0.6 }), x, z, { maxGrad: 0.15 });
      }
    }
    // (b) plateau rim belt (r 92-108.5): cypress groups + palms around the temple hill (ref 1 / 3 / 4); shrubs / small
    //     olives only on the south rim seen by shots 4 / 5
    for (let r = 93.5; r < 108.5; r += 3.6) {
      const step = 3.6 / r / D2R;
      for (let b = rng.random() * step; b < 360; b += step * rng.range(0.85, 1.2)) {
        const [x, z] = L.polar(r + rng.range(-1.2, 1.2), b);
        const m = noiseA.noise2(b * 0.06, r * 0.05 + 3.1);
        if (m < -0.35 || !rng.chance(0.7 * D)) continue;
        if (southRim(b)) { plant(rng.chance(0.25) ? 'olive' : 'shrub', x, z, { k: 0.8, maxGrad: 0.2 }); continue; }
        plant(mixPick(m > 0.2 ? { cypress: 4, palm: 1.5, shrub: 2 } : { palm: 3, cypress: 2, broad: 1, shrub: 2.5 }), x, z, { maxGrad: 0.2 });
      }
    }
    // (b2) ref 3: palm + cypress groves behind the spring fountains and beside the temple front (the plaza flanks)
    for (const [k, x, z, sc] of [
      ['palm', -44, 40, 1.05], ['palm', -53, 57, 0.95], ['cypress', -40, 49, 0.75], ['cypress', -47, 30, 0.85], ['cypress', -57, 44, 0.7],
      ['palm', -61, 30, 1.1], ['cypress', -52, 20, 0.8], ['shrub', -42, 56, 1.2], ['shrub', -49, 45, 1.3], ['shrub', -38, 38, 1.0],
      ['palm', 37, 25, 1.0], ['cypress', 35, 10, 0.8], ['palm', 44, 10, 1.1], ['cypress', 43, 30, 0.7], ['shrub', 38, 18, 1.2], ['shrub', 40, 33, 1.1],
    ]) plant(k, x + rng.range(-1, 1), z + rng.range(-1, 1), { s: sc * rng.range(0.92, 1.08), style: ['tall', 'medium'], maxGrad: 0.2, occK: 0.5 });
    // (c) ledges: a cypress row along the outer edge (ref 4: dark spires lining every tier) + lush garden fill
    //     (rounded broadleaf crowns, palms, cypress, shrubs: ref 5's hanging gardens)
    for (const T of [t1, t2]) {
      const rRow = T.r1 - 2.6;
      const step = 7.5 / rRow / D2R;
      for (let b = rng.random() * step; b < 360; b += step * rng.range(0.85, 1.15)) {
        if (noiseC.noise2(b * 0.09, T.y) < -0.3 || stairSector(b, rRow)) continue;
        const [x, z] = L.polar(rRow + rng.range(-0.6, 0.6), b);
        plant('cypress', x, z, { k: 1.1, occK: 0.55, maxGrad: 0.5 });
      }
      for (let r = T.r0 + 2.5; r < T.r1 - 4; r += 3.0) {
        const step = 3.0 / r / D2R;
        for (let b = rng.random() * step; b < 360; b += step * rng.range(0.85, 1.2)) {
          const [x, z] = L.polar(r + rng.range(-1.5, 1.5), b);
          const m = noiseB.fbm2(x * 0.03, z * 0.03, 3);
          if (m < -0.55 || !rng.chance(0.95 * Math.sqrt(D) * smoothstep(-0.55, -0.05, m))) continue;
          if (nearFall(x, z)) continue;
          plant(mixPick({ broad: 4.2, palm: 2.0, cypress: 0.9, olive: 1.5, shrub: 3.5, thicket: 0.8 }), x, z, { maxGrad: 0.35, fpIgnore: FP_IGNORE_FALL });
        }
      }
    }
    // (d) rock slopes (r 160-178 and 198-214, 48-50°): maquis masses, rounded trees and cypress in soil pockets — the
    //     ref-4 / ref-5 hill reads green with rock between, not bare rock
    stage('cit-slopes');
    for (const [ra, rb] of [[t1.r1 - 1, t2.r0 + 0.5], [t2.r1 - 1, 214]]) {
      // r4: denser (ref 1 / 4: the hill reads green with rock showing between, not rock with a few bushes)
      for (let r = ra; r < rb; r += 1.45) {
        const step = 1.8 / r / D2R;
        for (let b = rng.random() * step; b < 360; b += step * rng.range(0.8, 1.25)) {
          const [x, z] = L.polar(r + rng.range(-1.0, 1.0), b);
          const m = noiseB.fbm2(x * 0.025 + 11, z * 0.025, 3) + 0.25 * noiseC.noise2(x * 0.11, z * 0.11);
          if (m < -0.85 || !rng.chance(0.97 * Math.sqrt(D) * smoothstep(-0.85, -0.3, m))) continue;   // r5: greener (was -0.7 / -0.1)
          let k = mixPick({ shrub: 2.2, thicket: 4.2, broad: 3.6, cypress: 1.2, olive: 0.8, palm: 0.4, pine: 0.4 });
          // the strip just inside a rampart (the old footprint margin): low maquis only, nothing that rises over the wall
          if (k !== 'shrub' && k !== 'thicket' && RAMP.some(([a]) => { const rr = Math.hypot(x, z); return rr > a - 3.2 && rr <= a; })) k = 'thicket';
          // (r5) green right up to the cascades (refs 1 / 4 / 5): the waterfall corridors (water half-width + 1.5 m) are
          // tested 1.2 m narrower here, so the crowns reach the spray instead of leaving a bare rock band beside each fall
          if (nearFall(x, z)) { rej.fall = (rej.fall || 0) + 1; continue; }
          plant(k, x, z, { style: ['leaning', 'medium'], occK: 0.6, noFp: false, fpIgnore: FP_IGNORE_SLOPE, k: k === 'shrub' ? 1.45 : k === 'thicket' ? 1.3 : 1 });
        }
      }
    }
    stage('cit-quay');
    // (e) the shore quay band: a palm promenade
    for (let r = 216.5; r < 221; r += 4) {
      const step = 13 / r / D2R;
      for (let b = rng.random() * step; b < 360; b += step * rng.range(0.85, 1.15)) {
        const [x, z] = L.polar(r + rng.range(-1, 1), b);
        plant('palm', x, z, { style: ['tall', 'medium'], maxGrad: 0.15 });
      }
    }
    console.log(`[vegetation] citadel maps ${gm ? `${RES}² (${(SZ / RES).toFixed(2)} m)` : 'n/a (heightAt)'}`);
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
      // r3: denser (ref 1: the land rings read green between the buildings from the air) — every free corner
      const sp = g.id === 'l1' ? 4.6 : 5.4;
      for (let r = g.r0 + 12; r < g.r1 - 12; r += sp) {
        const step = sp / r / D2R;
        for (let b = rng.random() * step; b < 360; b += step) {
          const [x, z] = L.polar(r + rng.range(-2.2, 2.2), b + rng.range(-0.35, 0.35) * step);
          const mask = noiseA.fbm2(x * 0.012 + 7, z * 0.012, 3);
          if (mask < -0.6 || !rng.chance((g.id === 'l1' ? 1.0 : 0.85) * Math.sqrt(D) * smoothstep(-0.6, 0.1, mask))) continue;
          const k = choose({ palm: 2.2, cypress: 2.4, olive: 1.6, broad: 3.4, shrub: 1.2, pine: 0.9 }, rng);
          // larger crowns: at 1-1.4 km (shot 1) the ring gardens must read as green masses, not dots (r4: cypress overtop roofs)
          place(k, x, z, { rng, s: rng.range(...SCALE[k]) * (k === 'broad' || k === 'olive' || k === 'pine' ? 1.35 : k === 'cypress' ? 1.25 : 1), style: PALMY, edge: 7, fpK: 0.7 });
        }
      }
    }
  }

  // ------------------------------------------------------------ 5. canal banks, moles
  stage('canal');
  {
    const rng = new RNG('veg-canal');
    const K = L.SEA_CANAL;
    for (const sx of [-1, 1]) for (const off of [8, 14, 21, 28]) {
      for (let z = 445; z < K.z1 + 10; z += off === 8 ? 11 : 9) {
        const x = K.x + sx * (K.width / 2 + off + rng.range(-1, 1));
        // r4: the quay buildings fill the first 15 m: tall date palms behind them crown above the roofline (ref 2)
        if (off > 14) { place('palm', x, z + rng.range(-2, 2), { rng, style: ['tall'], s: rng.range(1.1, 1.35), edge: 5, occK: 0.8, minH: 2 }); continue; }
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
