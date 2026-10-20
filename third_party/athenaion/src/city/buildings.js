// House archetypes: turn a lot into a composition of volumes (+ porticoes, garden walls, steps),
// adapting to the terrain under it. Every house differs: size, storeys, roof type/orientation/pitch,
// plaster colour, window style, weathering seed.
import { heightAt } from '../world/heightfield.js';
import { Frame } from './geobuilder.js';
import { volume, portico, gardenWall, steps, stoneBox, balcony, awning, bayLayout, woodBox, sideStair, lotGround, chimney, roof, pilasters, belvedere, finial, figure, acroterion } from './house.js';
import { WIN, GROUND, FLAG } from '../materials/plaster.js';

let groundFn = heightAt;
const fr = (x) => x - Math.floor(x);
/** feature counters (logged by the city module) */
export const STATS = { belvedere: 0, pilasters: 0, balcony: 0, backBalcony: 0, roofStatues: 0, chimney: 0, colonnade: 0, pedimental: 0, villa: 0, court: 0, tower: 0, blockLots: 0 };
/** deterministic rejection sampling of a [0,1) seed satisfying ok(s) (falls back to the last try) */
function pickSeed(rng, ok, tries = 400) {
  let s = rng.random();
  for (let i = 0; i < tries && !ok(s); i++) s = rng.random();
  return s;
}
function groundStats(F, cx, cz, hw, hd) {
  let mn = Infinity, mx = -Infinity, front = 0, back = 0;
  const pts = [[-hw, hd], [0, hd], [hw, hd], [-hw, 0], [0, 0], [hw, 0], [-hw, -hd], [0, -hd], [hw, -hd]];
  for (let i = 0; i < pts.length; i++) {
    const [x, , z] = F.p(cx + pts[i][0], 0, cz + pts[i][1]);
    const h = groundFn(x, z);
    mn = Math.min(mn, h); mx = Math.max(mx, h);
    if (i < 3) front += h / 3; if (i >= 6) back += h / 3;
  }
  return { mn, mx, front, back };
}

function pickWin(rng, kind) {
  if (kind === 'villa') return rng.pick([WIN.FRAMED, WIN.ARCH_FRAMED, WIN.TALL, WIN.FRAMED, WIN.ARCH, WIN.PAIRED]);
  if (kind === 'tower') return rng.pick([WIN.SMALL, WIN.ARCH, WIN.RECT]);
  return rng.pick([WIN.RECT, WIN.RECT, WIN.SHUTTER, WIN.SHUTTER, WIN.SMALL, WIN.ARCH, WIN.FRAMED]);
}
function pickRoof(rng, w, d, kind) {
  const r = rng.random();
  if (kind === 'tower') return r < 0.55 ? 'pyramid' : r < 0.8 ? 'flat' : 'hip';
  if (kind === 'villa') return r < 0.7 ? 'hip' : r < 0.9 ? 'gable' : 'flat';
  if (r < 0.55) return 'hip';
  if (r < 0.9) return rng.chance(0.75) ? 'gable' : (w >= d ? 'gableZ' : 'gableX');
  if (r < 0.95) return 'flat';
  return 'hip';
}

/**
 * Build one house on a lot. ctx: { B (builders for its chunk), district: {centre, harbour, edge}, occ, fp }
 * returns list of footprint rects [{x,z,hw,hd,rot}] actually built.
 */
export function buildHouse(ctx, lot, rng) {
  groundFn = ctx.ground || heightAt;
  const B = ctx.B;
  const F = new Frame(lot.x, 0, lot.z, lot.rot);
  const seedBase = lot.seed;
  // plaster colour choice: the facade shader picks its palette entry from fract(seed * 7.13)
  // (materials/plaster.js cityPlaster). Ref 1 reads mostly lime-white / pale grey with a minority of
  // cream, ochre and pink houses, so bias the entry here (the palette itself stays untouched).
  // r5: rejection-sample the seed so that palette entry, brightness (fract(s*31.7)) and age
  // (fract(s*5.71)) all land where the reference town sits: crisp lime-white / cream walls with a
  // minority of warm ochre, yellow and pink ones, mostly clean (a few old weathered houses).
  // The facade shader also derives the window size (hw: fract(s*4.9), height: fract(s*7.7)) and the
  // bay width (fract(s*3.77)) from this seed: prefer big windows in narrow bays so every facade
  // carries a dense grid of dark openings that still reads at 1 km (ref 1 palazzi).
  const colourSeed = pickSeed(rng, (s) => {
    const k = fr(s * 7.13), j = fr(s * 31.7), age = fr(s * 5.71);
    if (fr(s * 4.9) < 0.45 || fr(s * 7.7) < 0.4 || fr(s * 3.77) > 0.45) return false;
    if (j < 0.42 || (age > 0.62 && rng.random() < 0.7)) return false;
    if (k >= 0.79 && k < 0.87) return rng.random() < 0.15;        // grey-beige: rare (reads dull)
    if (k < 0.18) return true;                                    // lime white
    if (k < 0.40) return rng.random() < 0.75;                     // cream
    if (k < 0.54) return rng.random() < 0.75;                     // ochre (ref 1: warm ochre palazzi)
    if (k < 0.65) return rng.random() < 0.5;                      // peach
    if (k < 0.79) return rng.random() < 0.35;                     // sand
    if (k < 0.95) return rng.random() < 0.85;                     // soft yellow
    return rng.random() < 0.7;                                    // terracotta pink
  });
  // roofs: fresh orange-red terracotta (ref 1: bright salmon/orange roofs), few dark aged ones
  const roofSeedBase = pickSeed(rng, (s) => {
    const k = fr(s * 5.31), j = fr(s * 17.3), age = fr(s * 3.97);
    if (j < 0.25 || age > 0.85) return false;
    if (k < 0.26) return true;                                    // red terracotta
    if (k >= 0.64 && k < 0.78) return rng.random() < 0.8;         // orange, newer
    if (k < 0.48) return rng.random() < 0.65;                     // deep red-brown
    if (k < 0.64) return rng.random() < 0.35;                     // brown
    if (k < 0.90) return rng.random() < 0.3;                      // weathered grey-brown
    return rng.random() < 0.08;                                   // dark aged
  });
  const dist = ctx.district(lot.x, lot.z);
  if (lot.block?.uniform) STATS.blockLots++;
  const out = [];
  const W = lot.w, D = lot.d;
  let minBack = Infinity; ctx._yard = false;

  // archetype choice
  let kind = 'house';
  const r = rng.random();
  if (W >= 15 && D >= 11 && r < 0.5) kind = rng.chance(0.55) ? 'villa' : 'court';
  else if (W < 8.5 && rng.chance(0.1 + 0.15 * dist.centre)) kind = 'tower';
  else if (r < 0.13 + 0.25 * dist.edge) kind = 'cottage';
  else if (r < 0.3) kind = 'L';
  else if (dist.centre > 0.5 && r < 0.45) kind = 'villa';
  // classical temple-front town house (pedimented portico on the street gable), ref 1 neoclassical blocks
  if ((kind === 'house' || kind === 'L') && W >= 9 && D >= 10 && rng.chance(0.16 + 0.2 * dist.centre + 0.15 * dist.harbour)) kind = 'pedimental';
  // r5: colonnaded town house (ground-floor portico with a balustraded terrace on top; ref 1)
  else if (kind === 'house' && W >= 9 && D >= 10.5 && rng.chance(0.14 + 0.12 * dist.centre + 0.1 * dist.harbour)) kind = 'colonnade';

  const baseStoreys = dist.harbour > 0.5 || dist.centre > 0.6 ? rng.int(2, rng.chance(0.3) ? 4 : 3) : dist.edge > 0.5 ? rng.int(1, 2) : rng.int(1, 3);
  const stH = rng.range(3.0, 3.55);
  const pitch = rng.range(15, 23); // r5: low Mediterranean pitch, the facades (window grids) dominate as in ref 1
  const over = rng.range(0.3, 0.6);
  const age = rng.random();
  const doShutters = rng.chance(0.5);
  // slope: when the ground falls away behind the house its back is the valley (view) side → open it up
  const gAll0 = groundStats(F, 0, 0, W / 2, D / 2);
  const viewBack = gAll0.front - gAll0.back > 1.2;
  const fancy = kind === 'villa' || kind === 'pedimental' || kind === 'court' || kind === 'colonnade';
  if (kind in STATS) STATS[kind]++;
  if (lot.block?.uniform) STATS.blockLots++;

  const mkVol = (cx, cz, hw, hd, storeys, opts = {}) => {
    const g = groundStats(F, cx, cz, hw, hd);
    let floorY = Math.max(g.front + 0.15, g.mn + 0.25);
    if (opts.floorY !== undefined) floorY = opts.floorY;
    const winT = opts.winT ?? pickWin(rng, kind);
    const grT = opts.grT ?? GROUND.PLAIN;
    let flagsBase = 0;
    if (rng.chance(fancy ? 0.6 : 0.25)) flagsBase |= FLAG.QUOINS;
    if (storeys >= 2 && rng.chance(fancy ? 0.75 : 0.4)) flagsBase |= FLAG.BANDS;
    if (doShutters) flagsBase |= FLAG.SHUTTERS;
    if (rng.chance(fancy ? 0.3 : 0.1)) flagsBase |= FLAG.STONEBASE;
    if (rng.chance(fancy ? 0.2 : 0.08)) flagsBase |= FLAG.FRIEZE;
    const loggia = storeys >= 2 && rng.chance(fancy ? 0.5 : lot.row ? 0.16 : 0.2) ? FLAG.LOGGIA : 0;
    // valley-side loggias: galleries on the downhill face (ref 1: open arcades toward the harbour)
    const backLoggia = storeys >= 2 && viewBack && rng.chance(fancy ? 0.6 : 0.35) ? FLAG.LOGGIA : 0;
    const sideBlank = Math.min(opts.party ?? 0.15, 0.9);
    const flags = {
      front: flagsBase | loggia | (opts.noDoor ? 0 : FLAG.DOOR),
      back: flagsBase | backLoggia | (!viewBack && rng.chance(0.1) ? FLAG.BLANK : 0),
      left: flagsBase | (rng.chance(sideBlank) ? FLAG.BLANK : 0),
      right: flagsBase | (rng.chance(sideBlank) ? FLAG.BLANK : 0),
    };
    const h = storeys * stH + rng.range(0.25, 0.6);
    const v = {
      cx, cz, hw, hd, floorY, h, stH, groundY: g.mn, seed: (seedBase + (opts.k || 0) * 0.137) % 1,
      roofSeed: (roofSeedBase + (opts.k || 0) * 0.0011) % 1,
      roof: opts.roof ?? pickRoof(rng, hw, hd, kind), pitch: opts.pitch ?? pitch, over: opts.over ?? over,
      style: winT + 8 * grT, flags, cornice: opts.cornice ?? rng.chance(fancy ? 0.85 : storeys >= 2 ? 0.5 : 0.25),
      parapet: rng.range(0.7, 1.1), noFront: false, podiumKind: g.mx - g.mn > 2.5 ? 2 : 0,
    };
    // keep the same plaster colour for all volumes of one house (seed), but vary slightly by k
    v.seed = (colourSeed + (opts.k || 0) * 0.0007) % 1;
    void age;
    let top = volume(B, F, v);
    const roofTop = top;
    const yWall = floorY + v.h;
    // pilasters between the bays of grand facades (front, and the valley side)
    if ((fancy || (lot.row && dist.centre > 0.4 && rng.chance(0.3))) && storeys >= 2 && !(flags.front & FLAG.BLANK)) {
      const { nb } = bayLayout(v.seed, 2 * hw);
      if (nb >= 2 && nb <= 7) {
        pilasters(B, F, cx, cz + hd, hw, floorY + 0.35, yWall - (v.cornice ? 0.34 : 0.05), nb, v.seed); STATS.pilasters++;
        if (viewBack && !(flags.back & FLAG.BLANK)) { const Fb = new Frame(...F.p(0, 0, 0), F.rot + Math.PI); pilasters(B, Fb, -cx, -(cz - hd), hw, floorY + 0.35, yWall - (v.cornice ? 0.34 : 0.05), nb, v.seed); }
      }
    }
    // belvedere / roof loggia rising through a pitched roof (skyline variety)
    if (v.roof !== 'flat' && !opts.k && storeys >= 2 && hw > 2.6 && hd > 2.6 && rng.chance(fancy ? 0.3 : dist.centre > 0.4 ? 0.14 : 0.08)) {
      const bw = Math.min(hw * 0.45, rng.range(1.5, 2.1)), bd = Math.min(hd * 0.45, rng.range(1.5, 2.1));
      const along = hw >= hd;
      const off = rng.range(-0.25, 0.25) * (along ? hw - bw : hd - bd);
      const bx = cx + (along ? off : 0), bz = cz + (along ? 0 : off);
      const t2 = belvedere(B, F, bx, bz, bw, bd, yWall - 0.1, top + 0.15, rng.range(2.5, 3.1), v.seed, (v.roofSeed + 0.0123) % 1, [v.seed, v.stH, v.style, 0], rng.chance(0.65) ? 'pyramid' : 'hip');
      if (fancy && rng.chance(0.5)) finial(B, F.p(bx, t2 - 0.05, bz), 0.16, v.seed);
      top = Math.max(top, t2); STATS.belvedere++;
    }
    // chimney rising through a pitched roof
    const nCh = v.roof !== 'flat' && hw > 2 && hd > 2 ? (rng.chance(0.55) ? 1 : 0) + (hw * hd > 30 && rng.chance(0.35) ? 1 : 0) : 0;
    for (let c = 0; c < nCh; c++) {
      const chx = cx + rng.range(-hw * 0.6, hw * 0.6), chz = cz + rng.range(-hd * 0.5, hd * 0.5);
      STATS.chimney++; chimney(B, F, chx, chz, floorY + v.h - 0.2, Math.max(roofTop, floorY + v.h) + rng.range(0.5, 1.1), [v.seed, v.stH, v.style, 0], v.seed + c * 0.1);
    }
    // flat roofs: a roof room (stair head) or a timber pergola
    if (v.roof === 'flat' && !opts.noRoofExtra) {
      const yR = floorY + v.h + 0.05;
      const r = rng.random();
      if (r < 0.55 && hw > 2.6 && hd > 2.6) {
        const rw = Math.min(hw - 0.4, rng.range(1.3, 2.0)), rd = Math.min(hd - 0.4, rng.range(1.3, 2.0));
        const sx = rng.sign(), sz = rng.sign();
        volume(B, F, { cx: cx + sx * (hw - rw - 0.3), cz: cz + sz * (hd - rd - 0.3), hw: rw, hd: rd, floorY: yR, h: 2.5, stH: 2.6, groundY: yR, seed: v.seed, roof: rng.chance(0.6) ? 'shed' : 'hip', pitch: 18, over: 0.25, style: WIN.SMALL, flags: { front: FLAG.DOOR, back: FLAG.BLANK, left: FLAG.BLANK, right: FLAG.BLANK }, cornice: false, plinthH: 0.05 });
      } else if (r < 0.85 && hw > 2.2 && hd > 2.2) {
        const pw = Math.min(hw - 0.5, rng.range(1.8, 3.2)), pd = Math.min(hd - 0.5, rng.range(1.5, 2.6));
        const px = cx + rng.range(-hw + pw + 0.4, hw - pw - 0.4), pz = cz + rng.range(-hd + pd + 0.4, hd - pd - 0.4);
        for (const [ax, az] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) woodBox(B, F, px + ax * pw, pz + az * pd, 0.07, 0.07, yR, yR + 2.3, 3, v.seed);
        for (const az of [-1, 1]) woodBox(B, F, px, pz + az * pd, pw + 0.2, 0.06, yR + 2.3, yR + 2.45, 3, v.seed);
        const nb = Math.max(3, Math.round(pw / 0.45));
        for (let k = 0; k <= nb; k++) woodBox(B, F, px - pw + (k * 2 * pw) / nb, pz, 0.04, pd + 0.25, yR + 2.45, yR + 2.55, 3, v.seed);
      }
    }
    // external staircase up a free side wall to the first floor (island vernacular)
    if (!lot.row && storeys >= 2 && !opts.k && rng.chance(0.12)) {
      const sx = rng.sign();
      const freeSide = sx < 0 ? !(flags.left & FLAG.BLANK) || true : true;
      const roomSide = sx < 0 ? (cx - hw) - (-W / 2) : (W / 2) - (cx + hw);
      if (freeSide && roomSide > 1.5 && hd > 3) sideStair(B, F, cx + sx * hw, sx, cz + hd - 0.3, cz + hd - 0.3 - Math.min(2 * hd - 1.5, stH * 1.6), floorY, floorY + stH, v.seed);
    }
    // an urn / planter by some front doors (filled by the banners module)
    if (ctx.slots && !(flags.front & FLAG.BLANK) && rng.chance(0.025)) {
      const [ux, , uz] = F.p(cx + rng.range(-hw * 0.6, hw * 0.6), 0, cz + hd + 0.7);
      ctx.slots.urn.push({ pos: [ux, floorY, uz], size: rng.range(0.6, 0.9), tag: rng.chance(0.5) ? 'marble city' : 'city' });
    }
    // balconies on upper floors, awnings over shop fronts
    const frontOpen = !(flags.front & FLAG.BLANK);
    const addBalcony = (Fx, x0, zf) => {
      const { nb, bay } = bayLayout(v.seed, 2 * hw);
      const si = rng.int(1, storeys - 1);
      if (rng.chance(0.3) && nb >= 2) balcony(B, Fx, x0, zf, floorY + stH * si, 2 * hw - 0.6, v.seed);
      else { const bi = rng.int(0, nb - 1); balcony(B, Fx, x0 - hw + (bi + 0.5) * bay, zf, floorY + stH * si, Math.min(bay * 0.92, rng.range(1.6, 3.0)), v.seed); }
    };
    if (frontOpen && storeys >= 2 && rng.chance(opts.balcony ?? 0.3)) { addBalcony(F, cx, cz + hd); STATS.balcony++; }
    // valley side: balconies / terraces on the downhill face
    if (viewBack && !(flags.back & FLAG.BLANK) && !(flags.back & FLAG.LOGGIA) && storeys >= 2 && rng.chance(opts.balcony ?? 0.4)) {
      addBalcony(new Frame(...F.p(0, 0, 0), F.rot + Math.PI), -cx, hd - cz); STATS.backBalcony++;
    }
    // statues on the parapet corners of flat-roofed grand houses
    if (v.roof === 'flat' && (fancy || rng.chance(0.2))) {
      const yP = floorY + v.h + (v.parapet ?? 0.9) + 0.08;
      for (const [sx, sz] of [[-1, 1], [1, 1]]) figure(B, F.p(cx + sx * (hw - 0.25), yP, cz + sz * (hd - 0.25)), rng.range(1.3, 1.7), F.rot, v.seed + sx * 0.1, { plinth: 0.35 });
      STATS.roofStatues++;
    }
    // roof gardens: potted olives / shrubs on flat roof terraces (green on the roofs, ref 1), urns on
    // the parapet (bronze + flowers via the banners module)
    if (v.roof === 'flat' && !opts.noRoofExtra && hw > 2.4 && hd > 2.4 && rng.chance(0.6)) {
      const yR = floorY + v.h + 0.06;
      const trees = (ctx.slots.tree ||= []);
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const [tx, , tz] = F.p(cx + rng.range(-hw + 1.0, hw - 1.0), 0, cz + rng.range(-hd + 1.0, hd - 1.0));
        const olive = rng.chance(0.45);
        trees.push({ pos: [tx, yR, tz], tag: olive ? 'olive' : 'shrub', size: olive ? rng.range(2.6, 3.8) : rng.range(1.0, 1.7), source: 'city-roof' });
      }
      if (rng.chance(0.5)) ctx.slots.urn.push({ pos: F.p(cx + (hw - 0.4) * rng.sign(), floorY + v.h + (v.parapet ?? 0.9) + 0.08, cz + hd - 0.12), size: 0.7, tag: rng.chance(0.5) ? 'marble city' : 'city' });
      STATS.roofGardens = (STATS.roofGardens || 0) + 1;
    }
    if (frontOpen && grT === GROUND.SHOP && rng.chance(0.65)) {
      const { nb, bay } = bayLayout(v.seed, 2 * hw);
      const kindA = rng.chance(0.6) ? 1 : rng.chance(0.5) ? 0 : 3;
      for (let bi = 0; bi < nb; bi++) if (rng.chance(0.6)) awning(B, F, cx - hw + (bi + 0.5) * bay, cz + hd, floorY + 2.75, Math.min(bay * 0.86, 2.9), rng.range(1.2, 1.8), (v.seed + bi * 0.1) % 1, kindA);
    }
    minBack = Math.min(minBack, cz - hd);
    const [wx, , wz] = F.p(cx, 0, cz);
    out.push({ x: wx, z: wz, hw, hd, rot: lot.rot, top, floorY, h });
    return { v, g, floorY, top };
  };

  const fw = W / 2 - rng.range(0.1, 0.6);
  const groundAll = groundStats(F, 0, 0, W / 2, D / 2);
  const slopeDrop = groundAll.back - groundAll.front; // >0: ground rises behind the house

  if (lot.row) {
    // terraced row house: full lot width, facade on the common building line, party walls
    const storeys = Math.max(2, Math.min(rng.chance(0.25) ? 4 : 3, baseStoreys + (rng.chance(0.35) ? 1 : 0) + (dist.centre > 0.5 && rng.chance(0.3) ? 1 : 0)));
    const hd = Math.min(D / 2 - 0.1, rng.range(4.5, 7.2));
    const hw = W / 2 - 0.02;
    const cz = D / 2 - hd;
    const rr = rng.random();
    const roofT = lot.block?.uniform ? (rr < 0.72 ? 'gableX' : rr < 0.86 ? 'flat' : 'hip') : rr < 0.5 ? 'hip' : rr < 0.84 ? 'gableX' : rr < 0.92 ? 'flat' : 'gableZ';
    const commerce = Math.max(dist.harbour, dist.centre);
    const grT = rng.chance(0.35 * commerce) ? GROUND.SHOP : rng.chance(0.15 + 0.25 * commerce) ? GROUND.ARCADE : GROUND.PLAIN;
    if (slopeDrop > 2.8 && hd > 4.5) {
      const hd1 = hd * rng.range(0.5, 0.62), hd2 = hd - hd1;
      mkVol(0, cz + hd - hd1, hw, hd1, storeys, { roof: roofT === 'flat' ? 'flat' : 'gableX', party: 0.85, grT });
      mkVol(0, cz - hd + hd2, hw, hd2, Math.max(1, storeys - (rng.chance(0.5) ? 1 : 0)), { k: 1, noDoor: true, roof: rng.chance(0.6) ? 'gableX' : 'hip', party: 0.9 });
    } else {
      // (per-lot pitch jitter: neighbouring roofs of a uniform block must not be coplanar → no z-fighting)
      const res = mkVol(0, cz, hw, hd, storeys, { roof: roofT, party: 0.85, grT, pitch: rng.range(16, 22) + (lot.seed - 0.5) * 1.2 });
      const backSpace = D / 2 + (cz - hd);
      if (backSpace > 3.2 && rng.chance(0.35)) {
        const wd = Math.min(backSpace / 2 - 0.3, rng.range(1.8, 3.5));
        const ww = Math.min(hw, rng.range(2.5, hw));
        const sx = rng.range(-hw + ww, hw - ww);
        mkVol(sx, cz - hd - wd + 0.03, ww, wd, Math.max(1, storeys - rng.int(1, 2)), { k: 2, noDoor: true, roof: rng.chance(0.5) ? 'shed' : 'hip', party: 0.5 });
      } else if (backSpace > 3.2 && rng.chance(0.5)) yard(ctx, B, F, W, D, cz - hd, seedBase, rng);
      const [sxw, , szw] = F.p(0, 0, D / 2 + 1.0);
      const gs = groundFn(sxw, szw);
      if (res.floorY - gs > 0.45 && res.floorY - gs < 2.6) steps(B, F, rng.range(-hw * 0.5, hw * 0.5), D / 2 + 0.08, 0.75, res.floorY + 0.3, gs, seedBase);
    }
  } else if (kind === 'cottage') {
    const hd = Math.min(D / 2, rng.range(3.2, 5));
    const hw = Math.min(fw, rng.range(3.5, 5.5));
    const cz = D / 2 - hd - rng.range(0, 1.5);
    mkVol(rng.range(-fw + hw, fw - hw), cz, hw, hd, 1, { roof: rng.chance(0.6) ? 'hip' : 'gable' });
    if (rng.chance(0.5)) {
      const ah = rng.range(1.8, 2.6);
      mkVol(0, cz - hd - ah + 0.05, Math.min(hw * 0.8, 3.5), ah, 1, { roof: 'shed', k: 1, noDoor: true });
    }
    if (rng.chance(0.55)) yard(ctx, B, F, W, D, cz - hd, seedBase, rng);
  } else if (kind === 'tower') {
    const hw = Math.min(fw, rng.range(2.8, 3.8)), hd = Math.min(D / 2 - 0.5, rng.range(3, 4.2));
    const cz = D / 2 - hd - rng.range(0, 1);
    mkVol(0, cz, hw, hd, rng.int(3, 4), { roof: rng.chance(0.6) ? 'pyramid' : 'flat', pitch: rng.range(22, 30) });
    if (rng.chance(0.6)) mkVol(0, cz - hd - 2.6, Math.min(fw, hw + 1), 2.5, 1, { roof: 'shed', k: 1, noDoor: true });
  } else if (kind === 'villa' || kind === 'court') {
    if (kind === 'villa') {
      const hd = Math.min(D / 2 - 0.3, rng.range(5, 7.5));
      const hw = Math.min(fw, rng.range(6, 9));
      const cz = D / 2 - hd - rng.range(0.5, 2.5);
      const st = Math.max(2, baseStoreys + (rng.chance(0.4) ? 1 : 0));
      const res = mkVol(0, cz, hw, hd, Math.min(3, st), { roof: rng.chance(0.75) ? 'hip' : 'flat', pitch: rng.range(15, 20), party: 0.05, grT: rng.chance(0.3) ? GROUND.ARCADE : GROUND.PLAIN });
      if (rng.chance(0.6)) {
        // columned portico on the front
        const n = Math.max(4, Math.round((2 * hw * 0.8) / 2.4) + 1);
        portico(B, F, { cx: 0, cz: cz + hd, hw: hw * 0.8, depth: rng.range(2.2, 3.0), floorY: res.floorY, h: stH + 0.3, seed: seedBase, n: Math.min(8, n), roof: rng.chance(0.5) ? 'flat' : 'shed' });
      } else if (rng.chance(0.4)) {
        // side wing
        const sx = rng.sign();
        const ww = Math.min(4, fw - hw);
        if (ww > 2) mkVol(sx * (hw + ww), cz - rng.range(0, 2), ww, hd * 0.8, Math.max(1, st - 1), { k: 2, noDoor: true, roof: 'hip' });
      }
      if (rng.chance(0.7)) yard(ctx, B, F, W, D, cz - hd, seedBase, rng);
    } else {
      // U-shaped courtyard house: front wing + two side wings, garden wall behind
      const fd = rng.range(3.0, 4.2);
      const sw = rng.range(2.6, 3.6);
      const czf = D / 2 - fd - 0.3;
      const st = Math.max(1, Math.min(2, baseStoreys));
      mkVol(0, czf, fw, fd, st, { roof: rng.chance(0.7) ? 'hip' : 'gable', party: 0.1 });
      const sd = (D - 2 * fd) / 2 - 0.5;
      if (sd > 2.5) {
        const r2 = rng.chance(0.6) ? 'gableZ' : 'shed';
        mkVol(-fw + sw, czf - fd - sd + 0.02, sw, sd, Math.max(1, st - (rng.chance(0.5) ? 1 : 0)), { k: 1, noDoor: true, roof: r2 === 'shed' ? 'hip' : r2 });
        mkVol(fw - sw, czf - fd - sd + 0.02, sw, sd, Math.max(1, st - (rng.chance(0.5) ? 1 : 0)), { k: 2, noDoor: true, roof: rng.chance(0.5) ? 'gableZ' : 'hip' });
        // back wall closing the court
        const gb = groundStats(F, 0, -D / 2 + 0.6, fw, 0.3);
        gardenWall(B, F, fw, -D / 2 + 0.6, -fw, -D / 2 + 0.6, gb.mn, gb.mn, rng.range(2.2, 3.0), seedBase, true);
        // the court itself: a garden (fountain court with trees, seen from the aerial shot 4)
        const chw = fw - 2 * sw - 0.6, z0c = -D / 2 + 1.0, z1c = czf - fd - 0.5;
        if (chw > 1.5 && z1c - z0c > 3) {
          const [gx, , gz] = F.p(0, 0, (z0c + z1c) / 2);
          ctx.gardens.push({ x: gx, z: gz, hw: chw, hd: (z1c - z0c) / 2, rot: F.rot, kind: 'court' });
          ctx._yard = true;
        }
      }
    }
  } else if (kind === 'pedimental') {
    const pd = rng.range(2.2, 3.0);
    const hd = Math.min(D / 2 - 0.3 - pd / 2, rng.range(4.2, 6.5));
    const hw = Math.min(fw, rng.range(4.0, 5.8));
    const cz = D / 2 - hd - pd - 0.2;
    const st = Math.max(2, Math.min(3, baseStoreys));
    const res = mkVol(0, cz, hw, hd, st, { roof: 'gableZ', pitch: rng.range(15, 19), party: 0.1, cornice: true, winT: rng.pick([WIN.ARCH_FRAMED, WIN.TALL, WIN.FRAMED]) });
    const phw = hw * rng.range(0.78, 0.92), n = phw > 4.2 ? 6 : 4;
    const ph = Math.min(res.v.h - 0.5, st * stH * rng.range(0.5, 0.62));
    portico(B, F, { cx: 0, cz: cz + hd, hw: phw, depth: pd, floorY: res.floorY, h: ph, seed: seedBase, n, roof: 'flat', r: rng.range(0.2, 0.26) });
    // pediment (low gable) over the portico entablature, tiles + plaster tympanum
    const yTp = res.floorY + ph + 0.4;
    const yApex = roof(B, F, { cx: 0, cz: cz + hd + pd / 2 + 0.2, hw: phw + 0.3, hd: pd / 2 + 0.25, yT: yTp, type: 'gableZ', pitch: 16, over: 0.22, floorY: res.floorY, h: ph + 0.4, sty: [seedBase, stH, WIN.ARCH, FLAG.BLANK] }, roofSeedBase);
    // acroteria: gilded palmette on the apex, statues on the two corners (refs 1, 4)
    const zFr = cz + hd + pd + 0.55, yEave = yTp - 0.22 * Math.tan(16 * Math.PI / 180) + 0.12;
    acroterion(B, F.p(0, yApex - 0.05, zFr), rng.range(0.8, 1.1), F.rot, seedBase, rng.chance(0.7));
    for (const sx of [-1, 1]) {
      if (rng.chance(0.75)) figure(B, F.p(sx * (phw + 0.25), yEave, zFr - 0.25), rng.range(1.3, 1.6), F.rot, seedBase + sx * 0.07, { plinth: 0.25 });
      else acroterion(B, F.p(sx * (phw + 0.25), yEave, zFr - 0.2), 0.7, F.rot, seedBase, false);
    }
    if (rng.chance(0.5)) yard(ctx, B, F, W, D, cz - hd, seedBase, rng);
  } else if (kind === 'colonnade') {
    const pd = rng.range(2.2, 2.8);
    const hd = Math.min(D / 2 - 0.3 - pd / 2, rng.range(4.2, 6.5));
    const hw = Math.min(fw, rng.range(4.5, 7.2));
    const cz = D / 2 - hd - pd - 0.2;
    const st = Math.max(2, Math.min(3, baseStoreys + (rng.chance(0.5) ? 1 : 0)));
    const res = mkVol(0, cz, hw, hd, st, { roof: rng.chance(0.6) ? 'hip' : 'gableX', cornice: true, party: 0.1, pitch: rng.range(15, 19) });
    const n = Math.min(8, Math.max(4, Math.round((2 * hw - 0.6) / 2.4) + 1));
    const ph = stH - 0.05;
    portico(B, F, { cx: 0, cz: cz + hd, hw: hw - 0.3, depth: pd, floorY: res.floorY, h: ph, seed: seedBase, n, roof: 'flat', r: rng.range(0.19, 0.24) });
    // balustrade on the portico terrace: posts + rail, statues / urns on the corner posts
    const yTop = res.floorY + ph - 0.2 + 0.6, zr = cz + hd + pd - 0.05;
    const nP = Math.max(3, Math.round((2 * hw) / 1.4));
    for (let i = 0; i <= nP; i++) stoneBox(B, F, -hw + (i * 2 * hw) / nP, zr, 0.11, 0.11, yTop, yTop + 0.85, 3, seedBase, 15);
    stoneBox(B, F, 0, zr, hw + 0.08, 0.13, yTop + 0.85, yTop + 0.97, 3, seedBase, 63);
    // potted shrubs / lemon trees on the portico terrace
    for (let k = 0; k < 2; k++) {
      const [tx, , tz] = F.p(rng.range(-hw + 1, hw - 1), 0, cz + hd + pd * 0.45);
      (ctx.slots.tree ||= []).push({ pos: [tx, yTop, tz], tag: rng.chance(0.4) ? 'olive' : 'shrub', size: rng.range(1.2, 2.6), source: 'city-terrace' });
    }
    for (const sx of [-1, 1]) {
      const sb = (seedBase * 13.1 + sx) % 1;
      if (sb < 0.45) figure(B, F.p(sx * hw, yTop + 0.97, zr), rng.range(1.3, 1.6), F.rot, seedBase + sx * 0.1, {});
      else if (sb < 0.6) acroterion(B, F.p(sx * hw, yTop + 0.97, zr), 0.7, F.rot, seedBase, true);
    }
    if (rng.chance(0.5)) yard(ctx, B, F, W, D, cz - hd, seedBase, rng);
  } else if (kind === 'L') {
    const hd = Math.min(D / 2 - 0.3, rng.range(3.5, 5));
    const hw = Math.min(fw, rng.range(4.5, 7));
    const cz = D / 2 - hd - rng.range(0, 1.2);
    const st = baseStoreys;
    const res = mkVol(0, cz, hw, hd, st, {});
    const sx = rng.sign();
    const ww = rng.range(2.4, Math.min(3.6, hw * 0.6));
    const wd = Math.min((D / 2 + cz - hd) / 2, rng.range(2.5, 4.5));
    if (wd > 1.8) {
      const wz = cz - hd - wd + 0.05;
      const g = groundStats(F, sx * (hw - ww), wz, ww, wd);
      const floorY = Math.abs(g.front - res.floorY) < 1.2 ? res.floorY : undefined;
      mkVol(sx * (hw - ww), wz, ww, wd, Math.max(1, st - (rng.chance(0.6) ? 1 : 0)), { k: 1, noDoor: true, roof: rng.chance(0.5) ? 'gableZ' : 'hip', floorY });
    }
    if (rng.chance(0.5)) yard(ctx, B, F, W, D, cz - hd, seedBase, rng);
  } else {
    // ordinary house; on slopes rising behind it, step the house up the hill in two volumes
    const hd = Math.min(D / 2 - 0.2, rng.range(4.5, 7.5));
    const hw = Math.min(fw, rng.range(4.5, 7.5));
    const cz = D / 2 - hd - rng.range(0, 1.5);
    const cx = rng.range(-fw + hw, fw - hw);
    if (slopeDrop > 2.6 && hd > 4) {
      const hd1 = hd * rng.range(0.45, 0.6), hd2 = hd - hd1;
      const st = baseStoreys;
      mkVol(cx, cz + hd - hd1, hw, hd1, st, { roof: rng.chance(0.5) ? 'hip' : 'gableX' });
      mkVol(cx + rng.range(-0.8, 0.8), cz - hd + hd2, hw * rng.range(0.85, 1), hd2, Math.max(1, st - (rng.chance(0.4) ? 1 : 0)) , { k: 1, noDoor: true, roof: rng.chance(0.6) ? 'hip' : 'gableX' });
    } else {
      const res = mkVol(cx, cz, hw, hd, baseStoreys, { grT: baseStoreys >= 2 && rng.chance(0.1 + 0.15 * dist.centre + 0.15 * dist.harbour) ? GROUND.ARCADE : GROUND.PLAIN });
      if (rng.chance(0.3)) {
        // small annex at the side or back
        const sx = rng.sign();
        const aw = rng.range(1.6, 2.6);
        if (Math.abs(cx + sx * (hw + aw)) + aw < W / 2) mkVol(cx + sx * (hw + aw - 0.02), cz - rng.range(0, hd * 0.5), aw, hd * rng.range(0.5, 0.8), 1, { k: 3, noDoor: true, roof: 'hip', pitch: 18 });
      }
      // steps up to the door when the floor sits above the street
      const [sxw, , szw] = F.p(cx, 0, D / 2 + 1.0);
      const gs = groundFn(sxw, szw);
      if (res.floorY - gs > 0.45 && res.floorY - gs < 3.0 && cz + hd + 1.4 < D / 2 + 2.4) steps(B, F, cx + rng.range(-hw * 0.4, hw * 0.4), cz + hd + 0.08, 0.8, res.floorY + 0.3, gs, seedBase);
      if (rng.chance(0.4)) yard(ctx, B, F, W, D, cz - hd, seedBase, rng);
    }
  }
  // yard ground (packed earth / dry grass / flag stones) over the whole lot
  lotGround(B, F, 0, 0, W / 2, D / 2, heightAt, seedBase);
  // deep lots: a rear building (back house, workshop, stable) beyond the garden
  let gardenBack = -D / 2;
  if (!ctx._yard && isFinite(minBack) && minBack + D / 2 > 9 && rng.chance(0.5)) {
    const hd2 = rng.range(2.4, 3.8), hw2 = Math.min(W / 2 - 0.3, rng.range(3, 6));
    const cz2 = -D / 2 + hd2 + rng.range(0.2, 1.5), cx2 = rng.range(-W / 2 + hw2 + 0.2, W / 2 - hw2 - 0.2);
    if (cz2 + hd2 < minBack - 3) {
      const midBack = minBack;
      mkVol(cx2, cz2, hw2, hd2, rng.chance(0.35) ? 2 : 1, { k: 4, roof: rng.chance(0.4) ? 'shed' : rng.chance(0.5) ? 'hip' : 'gable', party: 0.6, balcony: 0 });
      minBack = midBack; gardenBack = cz2 + hd2 + 0.3;
    }
  }
  // the unbuilt back of the lot becomes a garden for the vegetation module
  if (!ctx._yard && isFinite(minBack) && minBack - gardenBack > 2.6) {
    const [gx, , gz] = F.p(0, 0, (minBack + gardenBack) / 2);
    ctx.gardens.push({ x: gx, z: gz, hw: W / 2 - 0.6, hd: (minBack - gardenBack) / 2 - 0.5, rot: F.rot, kind: 'yard' });
  }
  return out;
}

/** garden wall around the back yard of a lot (from the house's back line to the lot's back edge) */
function yard(ctx, B, F, W, D, houseBack, seed, rng) {
  const zb = -D / 2 + 0.3;
  if (houseBack - zb < 2.5) return;
  const hw = W / 2 - 0.2;
  const hgt = rng.range(1.7, 2.4);
  const plaster = rng.chance(0.55);
  const g = (x, z) => { const [wx, , wz] = F.p(x, 0, z); return groundFn(wx, wz); };
  gardenWall(B, F, hw, zb, -hw, zb, g(hw, zb), g(-hw, zb), hgt, seed, plaster);
  if (rng.chance(0.7)) gardenWall(B, F, -hw, zb, -hw, houseBack, g(-hw, zb), g(-hw, houseBack), hgt, seed, plaster);
  if (rng.chance(0.7)) gardenWall(B, F, hw, houseBack, hw, zb, g(hw, houseBack), g(hw, zb), hgt, seed, plaster);
  // register the yard as a garden for the vegetation
  const [cx, , cz] = F.p(0, 0, (houseBack + zb) / 2);
  ctx.gardens.push({ x: cx, z: cz, hw: hw - 0.6, hd: (houseBack - zb) / 2 - 0.6, rot: F.rot, kind: 'walled' });
  ctx._yard = true;
}

export { stoneBox };
