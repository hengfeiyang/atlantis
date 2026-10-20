// (r5) Terrace houses: dozens of small, varied buildings packed on the ledges of the south face and on
// the plateau rim (refs 3, 9, 4, 1 read as a dense town of marble houses, loggias, towers and shrines
// from afar, with dark windows, doors and colonnades everywhere). Each house is a masonry body of 1-4
// storeys in its own frame (facing downhill): ashlar courses, corner pilasters, plinth, string courses,
// cornice; dark framed windows and doors (square or arched, some with balconies / hoods); a terracotta
// hip, pyramid or gable roof (city roof emitter + shared terracotta material) or a flat roof with a
// balustrade, statues and urns; some get a ground-floor loggia (columns before a dark recess).
// Sites come from the real terrain: flat ledge ground backed by higher rock, clear of the terrace
// walls, stair, plazas, falls and the other buildings (engine.footprints).
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { Frame, frameFacing, chamferBox, FACES, headingOf, ChunkedBuilders } from './geo.js';
import { wallRun, moulding, PROFILES, blockColor, STONE_COL, buttress } from './masonry.js';
import { pedestal } from './ornament.js';
import { proceduralMaterial, cached } from '../core/materials.js';

/** near-black interior seen through openings (windows, doors, loggias): albedo ≈ 0.03 so a sunlit
 *  opening still reads dark like a real unlit room; aerial perspective still applies (lit material) */
export function voidMaterial() {
  return cached('acro:void', () => proceduralMaterial({
    name: 'acro-void',
    params: { color: new THREE.Color(0.034, 0.031, 0.028), roughness: 1.0, metalness: 0 },
    color: `diffuseColor.rgb *= 0.75 + 0.5 * cgVnoise3(cgP * 1.7);`,
  }));
}

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mulc = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const DEG = Math.PI / 180;

/** distance from (x,z) to a waterfall's fall line minus its half width */
function fallClearance(x, z) {
  let best = Infinity;
  for (const w of L.WATERFALLS) {
    const a = (w.dir * Math.PI) / 180, dx = Math.sin(a), dz = -Math.cos(a);
    const ax = w.from[0] - dx * 2, az = w.from[2] - dz * 2, bx = w.from[0] + dx * 30, bz = w.from[2] + dz * 30;
    const ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t) - w.width * 0.5);
  }
  return best;
}

/** downhill direction over radius e (smoothed by 2 radii) */
function downhill(x, z) {
  let gx = 0, gz = 0;
  for (const e of [5, 10]) {
    gx += heightAt(x + e, z) - heightAt(x - e, z);
    gz += heightAt(x, z + e) - heightAt(x, z - e);
  }
  const l = Math.hypot(gx, gz);
  return l < 0.4 ? null : [-gx / l, -gz / l];
}

/** tapered polygonal column with base + capital (marble) */
function column(S, F, s, d, y0, y1, r, col) {
  const B = S.get('marble', F.p(s, 0, d)[0], F.p(s, 0, d)[2]);
  const C = F.at(s, 0, d);
  chamferBox(B, C, -r * 1.35, r * 1.35, y0, y0 + 0.22, -r * 1.35, r * 1.35, 0.03, col, 63 - 8);
  const n = 10, ya = y0 + 0.22, yb = y1 - 0.3;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a, yy, rr) => C.p(Math.cos(a) * rr, yy, Math.sin(a) * rr);
    const sh = 0.9 + 0.1 * Math.cos((a0 + a1) / 2 - 0.8); // baked light-side variation (flutes read)
    B.quadOut(p(a0, ya, r), p(a1, ya, r), p(a1, yb, r * 0.86), p(a0, yb, r * 0.86), darker(col, sh), C.p(0, (ya + yb) / 2, 0));
  }
  chamferBox(B, C, -r * 1.05, r * 1.05, yb, yb + 0.12, -r * 1.05, r * 1.05, 0.04, col, 63 - 8);
  chamferBox(B, C, -r * 1.4, r * 1.4, yb + 0.12, y1, -r * 1.4, r * 1.4, 0.03, col, 63 - 8);
}

/**
 * applied opening on the face plane of F (face at d = 0): dark panel + stone frame. kind: 'win' | 'arch' | 'door'
 * The dark panel sits a few cm proud of the masonry; the frame projects ~9 cm: from 30 m on it reads as a
 * deep opening (dark, framed, with a lit sill and a shadowing lintel).
 */
export function opening(S, F, sc, y0, w, h, kind, rng, o = {}) {
  const p0 = F.p(sc, 0, 0);
  const D = S.get('void', p0[0], p0[2]);
  const B = S.get('marble', p0[0], p0[2]);
  const col = o.col || blockColor(rng, STONE_COL);
  const dz = 0.03, fw = Math.min(0.2, w * 0.14), fd = 0.1;
  const C = F.p(sc, y0 + h / 2, -1);
  if (kind === 'arch') {
    const r = w / 2, ys = y0 + h - r;
    D.quadOut(F.p(sc - r, y0, dz), F.p(sc + r, y0, dz), F.p(sc + r, ys, dz), F.p(sc - r, ys, dz), [1, 1, 1], C);
    const m = 8;
    for (let i = 0; i < m; i++) {
      const a0 = (Math.PI * i) / m, a1 = (Math.PI * (i + 1)) / m;
      D.tri(F.p(sc, ys, dz), F.p(sc + Math.cos(a0) * r, ys + Math.sin(a0) * r, dz), F.p(sc + Math.cos(a1) * r, ys + Math.sin(a1) * r, dz), [1, 1, 1]);
      // archivolt band (voussoir ring, keystone)
      const R0 = r, R1 = r + fw * (i === (m >> 1) || i === (m >> 1) - 1 ? 1.5 : 1.0);
      const P = (a, rr, d) => F.p(sc + Math.cos(a) * rr, ys + Math.sin(a) * rr, d);
      B.quadOut(P(a0, R0, fd), P(a1, R0, fd), P(a1, R1, fd), P(a0, R1, fd), col, C);
      B.quadOut(P(a0, R1, fd), P(a1, R1, fd), P(a1, R1, 0), P(a0, R1, 0), darker(col, 0.85), C);
      const am = (a0 + a1) / 2;
      B.quadOut(P(a0, R0, 0), P(a1, R0, 0), P(a1, R0, fd), P(a0, R0, fd), darker(col, 0.7), P(am, R0 * 3, fd / 2)); // soffit faces the arch centre
    }
    for (const sx of [-1, 1]) chamferBox(B, F, sc + sx * r - (sx < 0 ? fw : 0), sc + sx * r + (sx > 0 ? fw : 0), y0, ys, -0.05, fd, 0.015, col, 63 - 32);
  } else {
    D.quadOut(F.p(sc - w / 2, y0, dz), F.p(sc + w / 2, y0, dz), F.p(sc + w / 2, y0 + h, dz), F.p(sc - w / 2, y0 + h, dz), [1, 1, 1], C);
    for (const sx of [-1, 1]) chamferBox(B, F, sc + sx * w / 2 - (sx < 0 ? fw : 0), sc + sx * w / 2 + (sx > 0 ? fw : 0), y0, y0 + h, -0.05, fd, 0.015, col, 63 - 32);
    // lintel (hood with a small cornice on doors and on some windows)
    chamferBox(B, F, sc - w / 2 - fw, sc + w / 2 + fw, y0 + h, y0 + h + fw * 1.1, -0.05, fd, 0.015, col, 63 - 32);
    if (kind === 'door' || o.hood) chamferBox(B, F, sc - w / 2 - fw * 1.6, sc + w / 2 + fw * 1.6, y0 + h + fw * 1.1, y0 + h + fw * 1.1 + 0.1, -0.05, fd + 0.12, 0.02, darker(col, 1.02), 63 - 32);
  }
  // sill
  if (kind !== 'door') chamferBox(B, F, sc - w / 2 - fw * 1.3, sc + w / 2 + fw * 1.3, y0 - 0.12, y0, -0.05, fd + 0.1, 0.015, col, 63 - 32);
  else chamferBox(B, F, sc - w / 2 - fw, sc + w / 2 + fw, y0 - 0.05, y0 + 0.02, -0.05, 0.35, 0.015, col, 63 - 32);
}

/** small balcony on brackets with a solid balustrade */
function balconyOn(S, F, sc, y, w, rng, ctx) {
  const p0 = F.p(sc, 0, 0);
  const B = S.get('marble', p0[0], p0[2]);
  const col = blockColor(rng, STONE_COL);
  chamferBox(B, F, sc - w / 2, sc + w / 2, y - 0.18, y, -0.1, 0.85, 0.03, col, 63 - 32);
  for (const sx of [-0.4, 0, 0.4]) chamferBox(B, F, sc + sx * w - 0.08, sc + sx * w + 0.08, y - 0.55, y - 0.18, -0.05, 0.6, 0.02, darker(col, 0.9), 63 - 32);
  ctx.balus.addRun(S, 'marble', F.at(0, 0, 0.75), sc - w / 2 + 0.1, sc + w / 2 - 0.1, y, { broken: 0 });
}

/** one house in frame F (origin = footprint centre at y 0, +d = front); returns roof top y */
function buildHouse(ctx, R, F, h, rng) {
  const { S, slots } = ctx;
  const { hw, hd, floorY, storeys, stH, type, roofType, tint } = h;
  const yTop = floorY + storeys * stH;
  // faces (front, right, left; back only above the rock): frames at the run start ON the face line
  const faces = [
    { id: 'front', Fr: new Frame(F.p(-hw, 0, hd), F.ax, F.ay, F.az), len: 2 * hw },
    { id: 'right', Fr: new Frame(F.p(hw, 0, hd), mulc(F.az, [-1, -1, -1]), F.ay, F.ax), len: 2 * hd },
    { id: 'left', Fr: new Frame(F.p(-hw, 0, -hd), F.az, F.ay, mulc(F.ax, [-1, -1, -1])), len: 2 * hd },
    { id: 'back', Fr: new Frame(F.p(hw, 0, -hd), mulc(F.ax, [-1, -1, -1]), F.ay, mulc(F.az, [-1, -1, -1])), len: 2 * hw },
  ];
  const loggia = type === 'loggia';
  const LD = 2.3; // loggia depth
  const courses = rng.random() < 0.5 ? 'pseudo' : 'iso';
  for (const fc of faces) {
    const { Fr, len } = fc;
    const gAt = (s) => heightAt(...[Fr.p(Math.max(0, Math.min(len, s)), 0, 0.6)].map((p) => [p[0], p[2]])[0]);
    let gmin = Infinity, gmax = -Infinity;
    for (let s = 0; s <= len; s += 1) { const g = gAt(s); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
    if (fc.id === 'back' && gmax > yTop - 0.5) continue; // fully embedded in the cliff
    const yBot = Math.min(gmin, floorY) - 1.0;
    // ground storey of a loggia front is set back: the front wall above sits on the colonnade beam
    const foundation = gmin < floorY - 0.3;
    if (foundation) {
      // foundation / platform (rustic, battered) up to the floor
      wallRun(S, 'ashlar', Fr, len, yBot, floorY, { rng, courses: 'random', batter: 0.02, rustic: true, rusticH: 99, groundAt: gAt, lite: true, damp: 0.6, color: tint });
      moulding(S, 'ashlar', Fr, -0.05, len + 0.05, floorY - 0.32, PROFILES.plinth(0.75), mulc(blockColor(rng, STONE_COL), tint), 0);
    }
    const ys = loggia && fc.id === 'front' ? floorY + stH : foundation ? floorY : yBot;
    if (fc.id !== 'back' || gmax < yTop - 1) {
      wallRun(S, 'ashlar', Fr, len, ys, yTop - 0.55, { rng, courses, batter: 0, groundAt: gAt, lite: true, damp: 0.25, color: tint, drips: true });
    }
    // corner pilasters
    for (const s of [0.45, len - 0.45]) buttress(S, 'ashlar', Fr, s, 0.9, 0.16, Math.max(ys, gmin - 0.3), yTop - 0.6, rng, { setoffs: 0, color: tint });
    // string courses between storeys, cornice at the top
    for (let k = 1; k < storeys; k++) moulding(S, 'ashlar', Fr, -0.1, len + 0.1, floorY + k * stH - 0.12, PROFILES.string(0.6), mulc(blockColor(rng, STONE_COL), tint), 0);
    moulding(S, 'ashlar', Fr, -0.25, len + 0.25, yTop - 0.55, PROFILES.cornice(0.62), mulc(blockColor(rng, STONE_COL), tint), 0);
    if (fc.id === 'back') continue;
    // openings: bays across the face, per storey
    const nb = Math.max(1, Math.round((len - 1.4) / (type === 'tower' ? 2.2 : 2.7)));
    const bw = (len - 1.4) / nb;
    const arched = rng.random() < (type === 'tower' ? 0.7 : 0.45);
    const shutterless = rng.random() < 0.5;
    for (let k = 0; k < storeys; k++) {
      if (loggia && fc.id === 'front' && k === 0) continue;
      const yF = floorY + k * stH;
      for (let b = 0; b < nb; b++) {
        const sc = 0.7 + (b + 0.5) * bw;
        if (fc.id !== 'front' && rng.random() < 0.35) continue;
        const isDoor = k === 0 && fc.id === 'front' && b === (nb >> 1) && type !== 'tower';
        if (isDoor) {
          const dw = Math.min(1.6, bw * 0.6), dh = Math.min(stH - 0.9, 2.9);
          opening(S, Fr, sc, yF + 0.02, dw, dh, rng.random() < 0.5 ? 'arch' : 'door', rng);
          if (rng.random() < 0.5) slots.brazier.push({ pos: Fr.p(sc + dw * 0.5 + 0.9, yF + 0.02, 0.8), facing: headingOf(Fr.az[0], Fr.az[2]), size: 0.7, tag: 'acro-house-door' });
          continue;
        }
        const ww = Math.min(1.15, bw * 0.42) * (k === 0 ? 0.9 : 1), wh = Math.min(stH * 0.5, ww * (arched ? 2.1 : 1.65));
        const yW = yF + Math.max(0.9, (stH - wh) * 0.5);
        if (gAt(sc) > yW - 0.3 || gAt(sc - ww) > yW - 0.3 || gAt(sc + ww) > yW - 0.3) continue; // buried in the slope
        opening(S, Fr, sc, yW, ww, wh, arched ? 'arch' : 'win', rng, { hood: !arched && !shutterless && k > 0 });
        if (k > 0 && fc.id === 'front' && !arched && rng.random() < 0.12) balconyOn(S, Fr, sc, yW - 0.12, ww + 1.0, rng, ctx);
      }
    }
    // ivy on the side walls, banners on some fronts
    if (fc.id !== 'front' && rng.random() < 0.6) slots.ivy.push({ pos: Fr.p(rng.range(0.6, len - 0.6), yTop - 0.6, 0.3), facing: headingOf(Fr.az[0], Fr.az[2]), size: rng.range(2, Math.min(7, yTop - gmin)), width: rng.range(1.0, 2.6), tag: 'acro-house' });
    if (fc.id === 'front' && storeys >= 2 && type !== 'loggia' && rng.random() < 0.3) slots.banner.push({ pos: Fr.p(len * (rng.random() < 0.5 ? 0.18 : 0.82), yTop - 0.75, 0.2), facing: headingOf(Fr.az[0], Fr.az[2]), size: [1.2, Math.min(4.2, stH * 1.2)], tag: 'acro-house' });
  }
  // loggia: dark recess, ceiling, columns + beam along the front
  if (loggia) {
    const yF = floorY, yB = floorY + stH;
    const p0 = F.p(0, 0, hd);
    const D = S.get('void', p0[0], p0[2]);
    const back = hd - LD;
    D.quadOut(F.p(-hw + 0.4, yF, back), F.p(hw - 0.4, yF, back), F.p(hw - 0.4, yB, back), F.p(-hw + 0.4, yB, back), [1, 1, 1], F.p(0, yF + 1, back - 1));
    const B = S.get('ashlar', p0[0], p0[2]);
    const c = mulc(blockColor(rng, STONE_COL), tint);
    for (const sx of [-1, 1]) B.quadOut(F.p(sx * (hw - 0.4), yF, back), F.p(sx * (hw - 0.4), yF, hd), F.p(sx * (hw - 0.4), yB, hd), F.p(sx * (hw - 0.4), yB, back), darker(c, 0.7), F.p(0, yF + 1, (back + hd) / 2));
    B.quadOut(F.p(-hw, yB - 0.02, back), F.p(hw, yB - 0.02, back), F.p(hw, yB - 0.02, hd), F.p(-hw, yB - 0.02, hd), darker(c, 0.6), F.p(0, yB - 2, (back + hd) / 2));
    // floor of the loggia
    const Pv = S.get('paving', p0[0], p0[2]);
    Pv.quadOut(F.p(-hw, yF + 0.01, back), F.p(hw, yF + 0.01, back), F.p(hw, yF + 0.01, hd + 0.3), F.p(-hw, yF + 0.01, hd + 0.3), [1, 1, 1], F.p(0, yF - 2, hd));
    // beam (architrave) carrying the upper front wall
    chamferBox(B, F, -hw - 0.1, hw + 0.1, yB - 0.55, yB, hd - 0.5, hd + 0.08, 0.03, c, 63 - 32 - 8);
    const nC = Math.max(3, Math.round((2 * hw - 1.2) / 2.3) + 1);
    const colC = blockColor(rng, STONE_COL);
    for (let i = 0; i < nC; i++) column(S, F, -hw + 0.6 + ((2 * hw - 1.2) * i) / (nC - 1), hd - 0.3, yF, yB - 0.55, 0.24, colC);
    // doors in the back wall (lit only by bounce: dark frames)
    opening(S, F.at(0, 0, back + 0.02), 0, yF, 1.4, 2.6, 'arch', rng, { col: darker(c, 0.75) });
  }
  // ---- roof
  const p0 = F.p(0, 0, 0);
  if (roofType === 'flat') {
    const Pv = S.get('paving', p0[0], p0[2]);
    Pv.quadOut(F.p(-hw, yTop - 0.02, -hd), F.p(hw, yTop - 0.02, -hd), F.p(hw, yTop - 0.02, hd), F.p(-hw, yTop - 0.02, hd), [1, 1, 1], F.p(0, yTop - 3, 0));
    const Bf = new Frame(F.p(-hw, 0, hd - 0.25), F.ax, F.ay, F.az);
    ctx.balus.addRun(S, 'marble', Bf, 0.9, 2 * hw - 0.9, yTop - 0.02, { broken: 0.01 });
    for (const sx of [-1, 1]) {
      const Fc = frameFacing(...F.p(sx * (hw - 0.45), 0, hd - 0.45).map((v, i) => (i === 1 ? 0 : v)), headingOf(F.az[0], F.az[2]));
      const yT = pedestal(S, 'marble', Fc, yTop - 0.02, 0.7, 1.0, rng, { faces: ['front'], wreath: false });
      if (rng.random() < 0.55) slots.statue.push({ pos: [Fc.o[0], yT, Fc.o[2]], facing: headingOf(F.az[0], F.az[2]) + rng.range(-20, 20), size: 1.7 + rng.random() * 0.4, tag: 'acro-house-roof' });
      else slots.urn.push({ pos: [Fc.o[0], yT, Fc.o[2]], facing: 180, size: 0.8, tag: 'acro-house-roof' });
    }
    // pergola with vines over the back half of some roof terraces (refs 3, 4)
    if (rng.random() < 0.45 && hw > 3) {
      const Bm = S.get('marble', p0[0], p0[2]);
      const Bd = S.get('dark', p0[0], p0[2]);
      const c = blockColor(rng, STONE_COL), yP = yTop + 2.5;
      const xs = [-hw + 0.6, hw - 0.6], zs = [-hd + 0.5, -hd * 0.1];
      for (const px of xs) for (const pz of zs) chamferBox(Bm, F, px - 0.14, px + 0.14, yTop, yP, pz - 0.14, pz + 0.14, 0.03, c, 63 - 8);
      for (const pz of zs) chamferBox(Bd, F, -hw + 0.4, hw - 0.4, yP, yP + 0.18, pz - 0.09, pz + 0.09, 0.02, [1.4, 1.1, 0.8], 63);
      for (let px = -hw + 0.6; px <= hw - 0.55; px += 0.55) chamferBox(Bd, F, px - 0.05, px + 0.05, yP + 0.18, yP + 0.3, zs[0] - 0.3, zs[1] + 0.3, 0.01, [1.4, 1.1, 0.8], 63 - 8);
      for (let k = 0; k < 3; k++) slots.ivy.push({ pos: F.p(rng.range(-hw + 0.8, hw - 0.8), yP + 0.3, zs[1] + 0.25), facing: headingOf(F.az[0], F.az[2]), size: rng.range(0.8, 2.2), width: rng.range(1.2, 2.5), tag: 'acro-pergola' });
    }
    // pergola / planters on some roof terraces
    if (rng.random() < 0.5) slots.planter.push({ pos: F.p(0, yTop - 0.02, -hd + 0.9), facing: (Math.atan2(-F.ax[2], F.ax[0]) * 180) / Math.PI, size: [Math.min(4, 2 * hw - 2), 0.8], tag: 'acro-house-roof' });
    return yTop + 1.2;
  }
  const cityF = R.frame(F);
  const v = { cx: 0, cz: 0, hw: hw + 0.05, hd: hd + 0.05, yT: yTop - 0.02, type: roofType, pitch: roofType === 'pyramid' ? 30 : 21 + rng.random() * 5, over: 0.45, floorY, h: yTop - floorY, sty: [0, 0, 0, 0], noGableWall: true };
  const top = R.roof(R.B, cityF, v, rng.random());
  if (roofType === 'pyramid') {
    // gilded finial on the tower roofs (gold glints from afar, ref 4)
    const G = S.get('gold', p0[0], p0[2]);
    chamferBox(G, F, -0.2, 0.2, top - 0.1, top + 0.35, -0.2, 0.2, 0.06, [1, 1, 1]);
    chamferBox(G, F, -0.07, 0.07, top + 0.35, top + 1.1, -0.07, 0.07, 0.02, [1, 1, 1]);
  }
  if (roofType === 'gableZ') {
    // pediments (masonry triangles + raking cornice) at the front and back gable ends
    const t = Math.tan(v.pitch * DEG), rise = hw * t;
    for (const sd of [1, -1]) {
      const B = S.get('ashlar', p0[0], p0[2]);
      const c = mulc(blockColor(rng, STONE_COL), tint);
      const dd = sd * (hd + 0.02);
      B.polyToward([F.p(-hw, yTop - 0.02, dd), F.p(hw, yTop - 0.02, dd), F.p(0, yTop - 0.02 + rise, dd)], c, mulc(F.az, [sd, sd, sd]));
      // tympanum shadow line + gold acroterion at the apex
      const G = S.get('gold', p0[0], p0[2]);
      if (sd > 0) chamferBox(G, F, -0.18, 0.18, yTop + rise, yTop + rise + 0.55, hd - 0.1, hd + 0.2, 0.04, [1, 1, 1]);
    }
  }
  return top;
}

/**
 * Place and build the houses. opts: { n, avoid(x,z,r) → bool, levels }
 * Returns { count, roofs: THREE.Mesh | null, tris }
 */
export async function buildTerraceHouses(ctx, engine, rng, opts = {}) {
  let city = null, terra = null;
  try {
    const hm = await import('../city/house.js');
    const geo = await import('../city/geobuilder.js');
    terra = await import('../materials/terracotta.js');
    city = { roof: hm.roof, GeoB: geo.GeoBuilder, Frame: geo.Frame };
  } catch (e) { console.warn('[acropolis] houses: city roof kit unavailable, flat roofs only', e.message); }
  const GS = L.GRAND_STAIR;
  const nMax = opts.n ?? 40;
  // candidate sites on a grid over the south face
  const cands = [];
  for (let x = -150; x <= 200; x += 3) {
    for (let z = -50; z <= 150; z += 3) {
      const g = heightAt(x, z);
      if (g < 3.5 || g > 56) continue;
      if (Math.abs(x - GS.x) < 17) continue;
      if (Math.hypot(x - L.ISLAND.center[0], z - L.ISLAND.center[1]) < L.ISLAND.radius + 15) continue;
      if (Math.hypot(x - L.ACROPOLIS.center[0], z - L.ACROPOLIS.center[1]) > 205) continue;
      // keep the ruins promontory (camera platforms of shots 3, 8, 9) and its rim free
      if (Math.hypot(x - L.RUINS_TERRACE.center[0], z - L.RUINS_TERRACE.center[1]) < L.RUINS_TERRACE.radius + 12) continue;
      if (!engine.footprints.isFree(x, z, 2.5)) continue;
      const dir = downhill(x, z);
      if (!dir) continue;
      const hdg = headingOf(dir[0], dir[1]);
      if (hdg < 85 || hdg > 285) continue; // fronts toward the cameras (E … S … W)
      cands.push({ x, z, g, hdg, key: rng.random() });
    }
  }
  // (r5) a few houses on the open east precinct behind colossus A (shots 3, 4, 8, 9), facing west onto the
  // plaza; x > 66 / z < -40 keeps them out of the shot-5 telephoto frame
  for (let x = 68; x <= 84; x += 4) for (let z = -110; z <= -42; z += 4) {
    const g = heightAt(x, z);
    if (g > 53.3 && g < 55.2) cands.push({ x, z, g, hdg: 270 + rng.range(-6, 6), key: -rng.random(), ign: ['acro-plaza'], prec: true });
  }
  cands.sort((a, b) => a.key - b.key);
  const types = ['house', 'house', 'loggia', 'tower', 'shrine', 'house', 'loggia'];
  const placed = [];
  const R = city && terra ? {
    B: { roof: new city.GeoB(terra.ROOF_ATTRS), plaster: new city.GeoB({ aFac: 4, aSty: 4 }), stone: new city.GeoB({ aSt: 4 }), wood: new city.GeoB({ aW: 4 }) },
    roof: city.roof,
    // my frame (ax, az) → city Frame(x, y, z, rot): local +Z = front, local +X = ax
    frame: (F) => new city.Frame(F.o[0], 0, F.o[2], Math.atan2(F.az[0], F.az[2])),
  } : null;
  let tries = 0;
  for (const c of cands) {
    if (placed.length >= nMax) break;
    if (++tries > 5000) break;
    if (!engine.footprints.isFree(c.x, c.z, 3, c.ign)) continue;
    if (c.prec && placed.filter((p) => p.prec).length >= 5) continue;
    let type = types[(rng.random() * types.length) | 0];
    // small towers fit almost anywhere: cap them so the mix stays houses / loggias / shrines
    if (type === 'tower' && placed.filter((p) => p.type === 'tower').length >= Math.ceil(nMax * 0.2)) type = rng.random() < 0.5 ? 'house' : 'shrine';
    if (c.prec) type = rng.random() < 0.55 ? 'shrine' : 'loggia'; // temple fronts / colonnades on the precinct (ref 3: a temple right of the colossus)
    let hw, hd, storeys, stH;
    if (type === 'tower') { hw = hd = 2.6 + rng.random() * 1.0; storeys = 3 + (rng.random() < 0.4 ? 1 : 0); stH = 3.3; }
    else if (type === 'shrine') { hw = 3.2 + rng.random() * 1.6; hd = 3.6 + rng.random() * 1.5; storeys = 1; stH = 5.4 + rng.random(); }
    else if (type === 'loggia') { hw = 4.5 + rng.random() * 3.5; hd = 3.8 + rng.random() * 1.4; storeys = c.prec ? 2 : 2 + (rng.random() < 0.3 ? 1 : 0); stH = 3.7; }
    else { hw = 3.4 + rng.random() * 3.6; hd = 3.0 + rng.random() * 1.8; storeys = 1 + ((rng.random() * 2.6) | 0); stH = 3.4 + rng.random() * 0.4; }
    // frame: front faces downhill; shift back so the rear sits against the rock
    const fx = Math.sin(c.hdg * DEG), fz = -Math.cos(c.hdg * DEG);
    let ok = false, floorY = 0, cx = c.x, cz = c.z;
    for (const back of [0, 1.5, 3, 4.5]) {
      cx = c.x - fx * back; cz = c.z - fz * back;
      const F = frameFacing(cx, 0, cz, c.hdg);
      // footprint samples: rows from back (-hd) to front (+hd)
      const rows = [];
      let water = false;
      for (let j = 0; j <= 4; j++) {
        const row = [];
        for (let i = 0; i <= 5; i++) {
          const p = F.p(-hw + (2 * hw * i) / 5, 0, -hd + (2 * hd * j) / 4);
          const hgt = heightAt(p[0], p[2]);
          if (hgt < 1.0) water = true;
          row.push(hgt);
        }
        rows.push(row);
      }
      if (water) break;
      // floor: the highest ground of the front 3 rows (no part of the floor buried except the back)
      floorY = Math.max(...rows[2], ...rows[3], ...rows[4]) + 0.25;
      const front = Math.min(...rows[4]);
      const backMax = Math.max(...rows[0]);
      const midMin = Math.min(...rows[1], ...rows[2]);
      if (floorY - front > 5.5) continue;        // platform too tall at the front
      if (floorY - midMin > 4.5) continue;
      if (Math.max(...rows[1]) > floorY + 1.5) continue; // buried too deep
      if (backMax > floorY + storeys * stH + 2) continue; // swallowed by the cliff
      ok = true;
      break;
    }
    if (!ok) continue;
    const F = frameFacing(cx, 0, cz, c.hdg);
    const rad = Math.max(hw, hd);
    if (fallClearance(cx, cz) < rad + 2.5) continue;
    if (ctx.zones.hit(cx, cz, rad * 0.8)) continue;
    // footprint free (centre + corners), and not too close to another house
    if (!engine.footprints.isFree(cx, cz, Math.min(hw, hd) * 0.9, c.ign)) continue;
    let cornersFree = true;
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const p = F.p(i * (hw + 0.6), 0, j * (hd + 0.6));
      if (!engine.footprints.isFree(p[0], p[2], 0.4, c.ign)) { cornersFree = false; break; }
    }
    if (!cornersFree) continue;
    if (L.COLOSSI.some((k) => Math.hypot(cx - k.pos[0], cz - k.pos[2]) < k.height * 0.4 + rad)) continue;
    if (opts.avoid && opts.avoid(cx, cz, rad)) continue;
    const tk = 0.9 + 0.12 * rng.random(), warm = rng.range(-0.02, 0.06);
    const roofType = type === 'tower' ? (rng.random() < 0.7 ? 'pyramid' : 'flat') : type === 'shrine' ? 'gableZ' : type === 'loggia' ? (rng.random() < 0.6 ? 'flat' : 'hip') : (rng.random() < 0.65 ? 'hip' : rng.random() < 0.5 ? 'gableZ' : 'flat');
    const h = { hw, hd, floorY, storeys, stH, type, roofType: R ? roofType : 'flat', tint: [tk * (1 + warm), tk, tk * (1 - warm * 1.5)] };
    try {
      buildHouse(ctx, R, F, h, rng);
    } catch (e) { console.warn('[acropolis] house failed', e.stack || e); continue; }
    const rot = Math.atan2(F.ax[0], F.ax[2]) + Math.PI / 2;
    engine.footprints.addRect(cx, cz, hw + 0.8, hd + 0.8, rot, 'acro-house');
    placed.push({ x: +cx.toFixed(1), z: +cz.toFixed(1), y: +floorY.toFixed(1), hdg: Math.round(c.hdg), type, roof: h.roofType, st: storeys, prec: !!c.prec });
  }
  let roofs = null;
  if (R && !R.B.roof.empty) {
    const geo = R.B.roof.toGeometry();
    roofs = new THREE.Mesh(geo, terra.terracottaMaterial());
    roofs.name = 'acro:house-roofs';
  }
  return { count: placed.length, placed, roofs };
}
