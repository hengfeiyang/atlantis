// ATLANTIS city monuments: gold-domed tholoi, domed halls / baths, banded towers with gold cupolas,
// gymnasia (palaestra courts). All emitted into the chunk builders (B.stone / B.plaster / B.roof / B.gold)
// in a local Frame whose +Z is the front. Each takes the sunken-era ruin mode into account
// (house.js getRuin()): domes survive or have caved in, drums and towers are broken.
import { Frame } from './geobuilder.js';
import { stoneBox, column, wall, quadFacing, roof, volume, figure, finial, getRuin, hpos, rubbleStone, setRuin } from './house.js';
import { ring, stoa, compassOf } from './landmarks.js';
import { WIN, GROUND, FLAG } from './mats/plaster.js';

const MARBLE = 7, DRESSED = 3, PAVING = 1, POLY = 2, RED = 10, BANDED = 13, BLACK = 14, LAWN = 12, TRACK = 11;

/** run fn with the ruin mode disabled (pieces that survived intact: domes, lanterns) */
function intact(fn) { const R = getRuin(); if (!R) return fn(); const b = R.bypass; R.bypass = true; try { return fn(); } finally { R.bypass = b; } }

// ------------------------------------------------------------------ gold dome (smooth normals)
/**
 * Hemispherical-ish dome into builder G (no custom attrs). Base centre C (world), radius R, height
 * ratio k (dome height = R*k), with ribs (slightly raised meridians) every `ribs` segments.
 */
export function goldDome(G, C, R, k = 0.9, seg = 32, rings = 10, ribs = 8, cut = 1.0) {
  if (!G) return C[1];
  const base = G.vcount;
  const rows = [];
  for (let j = 0; j <= rings; j++) {
    const t = (j / rings) * (Math.PI / 2) * cut;
    const row = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rib = ribs > 0 && i % Math.round(seg / ribs) === 0 ? 1.012 : 1.0;
      const rr = R * Math.cos(t) * rib;
      const p = [C[0] + Math.cos(a) * rr, C[1] + R * k * Math.sin(t), C[2] + Math.sin(a) * rr];
      // ellipsoid normal
      let n = [Math.cos(t) * Math.cos(a) / R, Math.sin(t) / (R * k), Math.cos(t) * Math.sin(a) / R];
      const l = Math.hypot(...n); n = n.map((v) => v / l);
      row.push(G.vert(p, n));
    }
    rows.push(row);
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = rows[j][i], b = rows[j][i + 1], c = rows[j + 1][i + 1], d = rows[j + 1][i];
    G.tri(a, c, b); G.tri(a, d, c);
  }
  void base;
  return C[1] + R * k * Math.sin((Math.PI / 2) * cut);
}

/** small open lantern (ring of columns + mini dome + finial) on top of a dome */
function lantern(B, F, y, r, seed) {
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    column(B, F, Math.cos(a) * r, Math.sin(a) * r, r * 0.12, r * 0.1, y, y + r * 1.6, 6, seed, MARBLE);
  }
  ring(B, F, r * 1.2, y + r * 1.6, y + r * 1.85, 12, seed, MARBLE);
  const top = goldDome(B.gold, F.p(0, y + r * 1.85, 0), r * 1.15, 0.9, 12, 4, 0);
  finial(B, [F.x, top - 0.05, F.z], Math.max(0.2, r * 0.3), seed);
  return top + r * 1.0;
}

// ------------------------------------------------------------------ tholos (round peripteral temple, gold dome)
/** o = { floorY, groundY, r (cella radius), seed, cols, colH, statues } — returns { top, hw } */
export function tholos(B, F, o) {
  const { floorY, seed } = o;
  const groundY = o.groundY ?? floorY - 1;
  const R = o.r ?? 6, colH = o.colH ?? R * 1.15;
  const Rc = R + Math.max(1.6, R * 0.32);         // colonnade radius
  const nC = o.cols ?? Math.max(10, Math.round((Rc * 2 * Math.PI) / 2.6));
  const ru = getRuin();
  const domeSurvives = ru ? hpos(F.x, 3, F.z, 40) < 0.5 : true;
  // crepidoma (3 round steps)
  for (let i = 0; i < 3; i++) ring(B, F, Rc + 1.6 - i * 0.5, i === 0 ? groundY - 1.5 : floorY - (3 - i) * 0.3, floorY - (2 - i) * 0.3, 32, seed, i === 2 ? PAVING : MARBLE);
  // columns
  const cr = colH / 12;
  const placeCols = () => {
    for (let i = 0; i < nC; i++) {
      const a = (i / nC) * Math.PI * 2;
      const x = Math.cos(a) * Rc, z = Math.sin(a) * Rc;
      column(B, F, x, z, cr, cr * 0.85, floorY, floorY + colH - 0.35, 12, seed, MARBLE);
      stoneBox(B, F, x, z, cr * 1.25, cr * 1.25, floorY + colH - 0.35, floorY + colH, MARBLE, seed, 63);
    }
  };
  if (domeSurvives) intact(placeCols); else placeCols();
  const yE = floorY + colH;
  // cella drum (marble, with dark doorway via the plaster shader: arcade ground floor)
  const H = colH + 0.6;
  const seg = 24;
  const drum = () => {
    const sty = [seed, H, WIN.ARCH_FRAMED + 8 * GROUND.BLANK, FLAG.BANDS];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const ax = Math.cos(a0) * R, az = -Math.sin(a0) * R, bx = Math.cos(a1) * R, bz = -Math.sin(a1) * R;
      const L = Math.hypot(bx - ax, bz - az);
      wall(B, F, ax, az, bx, bz, floorY, floorY + H + (o.drumH ?? R * 0.5), floorY, H, sty, i * L, L * seg);
    }
  };
  if (!domeSurvives) { drum(); for (let i = 0; i < 6; i++) rubbleStone(B, F.p((hpos(F.x, i, F.z, 41) - 0.5) * R, floorY + 0.3, (hpos(F.x, i, F.z, 42) - 0.5) * R), 0.8, seed); return { top: floorY + H, hw: Rc + 1.6 }; }
  return intact(() => {
    drum();
    // entablature ring over the colonnade, then the drum rises above it
    ring(B, F, Rc + 0.45, yE, yE + colH * 0.16, 32, seed, MARBLE);
    ring(B, F, Rc + 0.75, yE + colH * 0.16, yE + colH * 0.22, 32, seed, DRESSED);
    const yD = floorY + H + (o.drumH ?? R * 0.5);
    ring(B, F, R + 0.4, yD, yD + 0.45, 28, seed, MARBLE);
    const top = goldDome(B.gold, F.p(0, yD + 0.4, 0), R + 0.15, o.domeK ?? 0.95, 32, 10, 12);
    const yl = lantern(B, F, top - 0.15, Math.max(0.8, R * 0.18), seed);
    // statues around the roof edge (gold figures on the entablature, refs 1/4)
    if (o.statues !== false) for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const d = F.d(Math.cos(a), 0, Math.sin(a));
      figure(B, F.p(Math.cos(a) * (Rc + 0.2), yE + colH * 0.22, Math.sin(a) * (Rc + 0.2)), colH * 0.28, Math.atan2(d[0], d[2]), seed + i * 0.07, { gold: i % 2 === 0 });
    }
    return { top: yl, hw: Rc + 1.6 };
  });
}

// ------------------------------------------------------------------ banded tower with a gold cupola
/** o = { floorY, groundY, hw, h, seed, slots } — square tower banded red/white (ref 2 gate towers) */
export function goldTower(B, F, o) {
  const ru0 = getRuin();
  // sunken era: about 45 % of the towers still stand with their cupola (refs 8, 9: towers in the haze)
  const standing = ru0 && hpos(F.x, 7, F.z, 48) < 0.45;
  if (standing) ru0.bypass = true;
  try { return goldTowerInner(B, F, o, standing ? null : ru0, ru0); } finally { if (standing) ru0.bypass = false; }
}
function goldTowerInner(B, F, o, ru, ruAny) {
  const { floorY, seed } = o;
  const groundY = o.groundY ?? floorY - 1;
  const hw = o.hw ?? 3.5, H = o.h ?? 26;
  const keep = ru ? 0.25 + 0.6 * hpos(F.x, 1, F.z, 43) : 1;
  const yTopBody = floorY + H * keep;
  // base (black stone plinth) + banded shaft + cornices
  stoneBox(B, F, 0, 0, hw + 0.5, hw + 0.5, groundY - 1.5, floorY + 1.2, BLACK, seed, 31);
  const banded = hpos(F.x, 2, F.z, 44) < 0.6;
  const sty = [seed, 4.2, WIN.ARCH_FRAMED, FLAG.QUOINS | FLAG.BANDS];
  if (banded) stoneBox(B, F, 0, 0, hw, hw, floorY + 1.2, yTopBody, BANDED, seed, 15);
  else {
    const v = { cx: 0, cz: 0, hw, hd: hw, floorY: floorY + 1.2, h: H * keep - 1.2, stH: 4.2, groundY: floorY, seed, roof: 'flat', parapet: 0.0, pitch: 20, over: 0.3, style: WIN.ARCH_FRAMED, flags: { front: sty[3], back: sty[3], left: sty[3], right: sty[3] }, cornice: true, ruinKeep: 1 };
    volume(B, F, { ...v, roof: 'flat', cornice: !ru });
  }
  if (ru) {
    for (let i = 0; i < 5; i++) rubbleStone(B, F.p((hpos(F.x, i, F.z, 45) - 0.5) * hw * 5, groundY + 0.3, (hpos(F.x, i, F.z, 46) - 0.5) * hw * 5), 0.9, seed);
    ru.coral && ru.coral.push({ pos: F.p(0, yTopBody + 0.1, 0), normal: [0, 1, 0], size: hw * 0.8, tag: 'city-tower' });
    return { top: yTopBody };
  }
  // gilded bands / cornice + balcony slab
  stoneBox(B, F, 0, 0, hw + 0.35, hw + 0.35, yTopBody, yTopBody + 0.7, MARBLE, seed, 63);
  if (ruAny && ruAny.coral) ruAny.coral.push({ pos: F.p(0, yTopBody + 0.75, hw * 0.6), normal: [0, 1, 0], size: 1.2, tag: 'city-tower' });
  if (o.slots && !ruAny) for (const sz of [1, -1]) o.slots.banner.push({ pos: F.p(0, yTopBody - 1.0, sz * (hw + 0.06)), facing: compassOf(F.rot + (sz < 0 ? Math.PI : 0)), size: [Math.min(2.2, hw * 0.6), Math.min(7, H * 0.3)], tag: 'wall city-tower' });
  // open tholos lantern with columns + gold dome
  const lr = hw * 0.78, lh = hw * 1.25;
  const y0 = yTopBody + 0.7;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    column(B, F, Math.cos(a) * lr, Math.sin(a) * lr, 0.24, 0.2, y0, y0 + lh, 8, seed, MARBLE);
  }
  // inner core (dark) to stop the lantern reading as see-through glass from afar
  stoneBox(B, F, 0, 0, lr * 0.55, lr * 0.55, y0, y0 + lh, DRESSED, seed, 15);
  ring(B, F, lr + 0.45, y0 + lh, y0 + lh + 0.55, 16, seed, MARBLE);
  const top = goldDome(B.gold, F.p(0, y0 + lh + 0.5, 0), lr + 0.2, 1.0, 20, 7, 8);
  finial(B, [F.x, top - 0.05, F.z], 0.45, seed);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) finial(B, F.p(sx * (hw + 0.2), yTopBody + 0.7, sz * (hw + 0.2)), 0.22, seed);
  return { top: top + 1.6 };
}

// ------------------------------------------------------------------ domed hall (baths, assembly halls)
/** o = { w, d, floorY, groundY, seed, slots } — plaster/marble hall with a big gold dome and corner cupolas */
export function domedHall(B, F, o, rng) {
  const { floorY, seed } = o;
  const groundY = o.groundY ?? floorY - 1;
  const W = o.w ?? 34, D = o.d ?? 30;
  const ru = getRuin();
  const stH = 4.6, st = 2, h = st * stH + 0.6;
  const fl = FLAG.BANDS | FLAG.QUOINS;
  const common = { floorY, h, stH, groundY, seed, roof: 'flat', parapet: 0.9, pitch: 17, over: 0.4, cornice: true, plinthH: 0.8, podiumKind: 3 };
  volume(B, F, { ...common, cx: 0, cz: 0, hw: W / 2, hd: D / 2, style: WIN.ARCH_FRAMED + 8 * GROUND.ARCADE, flags: { front: fl | FLAG.DOOR, back: fl, left: fl, right: fl } });
  // front portico
  const n = 6, pw = Math.min(W * 0.32, 9), pd = 4.5;
  for (let i = 0; i < n; i++) {
    const x = -pw + (2 * pw * i) / (n - 1);
    column(B, F, x, D / 2 + pd, 0.55, 0.47, floorY + 0.8, floorY + h - 1.2, 12, seed, MARBLE);
  }
  stoneBox(B, F, 0, D / 2 + pd / 2, pw + 1.2, pd / 2 + 0.5, groundY - 1, floorY + 0.8, MARBLE, seed, 31);
  stoneBox(B, F, 0, D / 2 + pd / 2, pw + 1.0, pd / 2 + 0.6, floorY + h - 1.2, floorY + h, MARBLE, seed, 63);
  const yP = roof(B, F, { cx: 0, cz: D / 2 + pd / 2, hw: pw + 1.0, hd: pd / 2 + 0.6, yT: floorY + h, type: 'gableZ', pitch: 16, over: 0.25, floorY, h, sty: [seed, stH, 0, FLAG.BLANK] }, (seed * 1.7) % 1);
  if (!ru) figure(B, F.p(0, yP - 0.1, D / 2 + pd + 0.6), 2.2, F.rot, seed, { gold: true });
  if (ru) { const R = ru; if (hpos(F.x, 5, F.z, 47) > 0.45) return { top: floorY + h }; R.bypass = true; }
  // drum + big gold dome
  const Rd = Math.min(W, D) * 0.3;
  const yR = floorY + h + 0.05;
  const seg = 28;
  const sty = [seed, 3.2, WIN.ARCH + 8 * GROUND.PLAIN, FLAG.BANDS];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const ax = Math.cos(a0) * Rd, az = -Math.sin(a0) * Rd, bx = Math.cos(a1) * Rd, bz = -Math.sin(a1) * Rd;
    const L = Math.hypot(bx - ax, bz - az);
    wall(B, F, ax, az, bx, bz, yR, yR + 4.4, yR, 4.4, sty, i * L, L * seg);
  }
  ring(B, F, Rd + 0.35, yR + 4.4, yR + 4.8, 28, seed, MARBLE);
  const top = goldDome(B.gold, F.p(0, yR + 4.75, 0), Rd + 0.1, 1.0, 36, 10, 12);
  const yl = lantern(B, F, top - 0.1, Math.max(0.9, Rd * 0.15), seed);
  // four corner cupolas
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const cx = sx * (W / 2 - 3.2), cz = sz * (D / 2 - 3.2);
    ring(B, new Frame(...F.p(cx, 0, cz), F.rot), 2.4, yR, yR + 1.6, 16, seed, MARBLE);
    const t2 = goldDome(B.gold, F.p(cx, yR + 1.55, cz), 2.3, 0.9, 16, 6, 0);
    finial(B, [F.p(cx, 0, cz)[0], t2 - 0.05, F.p(cx, 0, cz)[2]], 0.25, seed);
  }
  if (ru) ru.bypass = false;
  if (o.slots) for (const x of [-W / 3, W / 3]) o.slots.banner.push({ pos: F.p(x, floorY + h - 1.0, D / 2 + 0.08), facing: compassOf(F.rot), size: [1.6, 5.0], tag: 'wall city-hall' });
  void rng;
  return { top: yl };
}

// ------------------------------------------------------------------ gymnasium / palaestra
/** square colonnaded court with a lawn and a running track (o = { w, d, floorY, groundY, seed, slots }) */
export function gymnasium(B, F, o) {
  const { w, d, floorY, seed } = o;
  const groundY = o.groundY ?? floorY - 1;
  stoneBox(B, F, 0, 0, w / 2, d / 2, groundY - 1.5, floorY - 0.1, POLY, seed, 15 | 16);
  // court: lawn with a sand running track around it
  stoneBox(B, F, 0, 0, w / 2 - 9, d / 2 - 9, floorY - 0.1, floorY - 0.02, TRACK, seed, 16);
  stoneBox(B, F, 0, 0, w / 2 - 15, d / 2 - 15, floorY - 0.02, floorY + 0.02, getRuin() ? TRACK : LAWN, seed, 16);
  // stoas on the four sides (colonnades facing the court)
  const dep = 9;
  stoa(B, new Frame(...F.p(0, 0, -d / 2 + dep / 2), F.rot), { len: w - 2, dep, floorY, seed: (seed * 1.7) % 1, groundY: floorY - 0.4, slots: o.slots, colH: 5.6 });
  stoa(B, new Frame(...F.p(0, 0, d / 2 - dep / 2), F.rot + Math.PI), { len: w - 2, dep, floorY, seed: (seed * 2.1) % 1, groundY: floorY - 0.4, colH: 5.6 });
  stoa(B, new Frame(...F.p(-w / 2 + dep / 2, 0, 0), F.rot + Math.PI / 2), { len: d - 2 * dep - 1, dep, floorY, seed: (seed * 2.3) % 1, groundY: floorY - 0.4, roofType: 'hip', colH: 5.6 });
  stoa(B, new Frame(...F.p(w / 2 - dep / 2, 0, 0), F.rot - Math.PI / 2), { len: d - 2 * dep - 1, dep, floorY, seed: (seed * 2.9) % 1, groundY: floorY - 0.4, roofType: 'hip', colH: 5.6 });
  // a gilded statue on a column in the court
  stoneBox(B, F, 0, 0, 1.2, 1.2, floorY, floorY + 1.5, MARBLE, seed, 31);
  column(B, F, 0, 0, 0.6, 0.52, floorY + 1.5, floorY + 10, 12, seed, MARBLE);
  stoneBox(B, F, 0, 0, 0.8, 0.8, floorY + 10, floorY + 10.5, MARBLE, seed, 63);
  figure(B, F.p(0, floorY + 10.5, 0), 2.8, F.rot, seed, { gold: true, spear: true });
}

export { setRuin };

// ------------------------------------------------------------------ arcade (two-tier open arcaded portico / aqueduct-like screen)
/**
 * Emits one arcaded screen along local x (centred), thickness `th` along z: piers, round arches, spandrels,
 * arch soffits, an entablature band and a second tier. o = { len, floorY, groundY, seed, tiers, bay, th }.
 * Ruin mode: bays survive at random (whole bays), upper tier mostly gone.
 */
export function arcade(B, F, o) {
  const { floorY, seed } = o;
  const groundY = o.groundY ?? floorY - 1;
  const len = o.len ?? 60, th = o.th ?? 2.2, tiers = o.tiers ?? 2;
  const ru = getRuin();
  const nB = Math.max(2, Math.round(len / (o.bay ?? 6.2)));
  const bay = len / nB;
  const pier = bay * 0.26;
  const kind = o.kind ?? MARBLE;
  stoneBox(B, F, 0, 0, len / 2 + 0.6, th / 2 + 0.6, groundY - 1.2, floorY, PAVING, seed, 31);
  let y = floorY;
  const kept = new Array(nB).fill(true);
  for (let t = 0; t < tiers; t++) {
    const hS = (t === 0 ? 1.0 : 0.82) * bay * 1.05;   // springing height
    const r = (bay - pier) / 2;
    const yTop = y + hS + r + 0.9;
    for (let i = 0; i < nB; i++) {
      const xc = -len / 2 + (i + 0.5) * bay;
      if (ru) { const h = hpos(F.x + xc * 0.37, t, F.z + xc * 0.21, 50 + t); if (!kept[i] || h < (t === 0 ? 0.3 : 0.6)) { kept[i] = false; if (t === 0) for (let k = 0; k < 3; k++) rubbleStone(B, F.p(xc + (k - 1) * 1.4, groundY + 0.4, (hpos(xc, k, t, 51) - 0.5) * 6), 0.9, seed); continue; } }
      const x0 = xc - bay / 2, x1 = xc + bay / 2;
      for (const sz of [1, -1]) {
        const z = (sz * th) / 2;
        const want = F.d(0, 0, sz);
        const q = (a, b, c, d, uvs) => quadFacing(B.stone, F.p(a[0], a[1], z), F.p(b[0], b[1], z), F.p(c[0], c[1], z), F.p(d[0], d[1], z), want, { aSt: uvs.map(([u, v]) => [u, v, seed, kind]) });
        // piers (half piers on each side of the bay) up to the springing
        q([x0, y], [x0 + pier / 2, y], [x0 + pier / 2, y + hS], [x0, y + hS], [[x0, y], [x0 + pier / 2, y], [x0 + pier / 2, y + hS], [x0, y + hS]]);
        q([x1 - pier / 2, y], [x1, y], [x1, y + hS], [x1 - pier / 2, y + hS], [[x1 - pier / 2, y], [x1, y], [x1, y + hS], [x1 - pier / 2, y + hS]]);
        // spandrels: vertical strips from the arch curve to the top of the tier
        const N = 10;
        for (let k = 0; k < N; k++) {
          const a0 = Math.PI - (k / N) * Math.PI, a1 = Math.PI - ((k + 1) / N) * Math.PI;
          const xa = xc + Math.cos(a0) * r, xb = xc + Math.cos(a1) * r;
          const ya = y + hS + Math.sin(a0) * r, yb = y + hS + Math.sin(a1) * r;
          q([xa, ya], [xb, yb], [xb, yTop], [xa, yTop], [[xa, ya], [xb, yb], [xb, yTop], [xa, yTop]]);
        }
        q([x0, y + hS], [x0 + pier / 2, y + hS], [x0 + pier / 2, yTop], [x0, yTop], [[x0, y + hS], [x0 + pier / 2, y + hS], [x0 + pier / 2, yTop], [x0, yTop]]);
        q([x1 - pier / 2, y + hS], [x1, y + hS], [x1, yTop], [x1 - pier / 2, yTop], [[x1 - pier / 2, y + hS], [x1, y + hS], [x1, yTop], [x1 - pier / 2, yTop]]);
      }
      // soffit of the arch + inner faces of the piers
      const N = 10;
      for (let k = 0; k < N; k++) {
        const a0 = Math.PI - (k / N) * Math.PI, a1 = Math.PI - ((k + 1) / N) * Math.PI;
        const pa = [xc + Math.cos(a0) * r, y + hS + Math.sin(a0) * r], pb = [xc + Math.cos(a1) * r, y + hS + Math.sin(a1) * r];
        const am = (a0 + a1) / 2;
        quadFacing(B.stone, F.p(pa[0], pa[1], th / 2), F.p(pb[0], pb[1], th / 2), F.p(pb[0], pb[1], -th / 2), F.p(pa[0], pa[1], -th / 2), F.d(-Math.cos(am), -Math.sin(am), 0),
          { aSt: [[k * 0.4, 0, seed, DRESSED], [(k + 1) * 0.4, 0, seed, DRESSED], [(k + 1) * 0.4, th, seed, DRESSED], [k * 0.4, th, seed, DRESSED]] });
      }
      for (const [xp, sx] of [[x0 + pier / 2, 1], [x1 - pier / 2, -1]]) quadFacing(B.stone, F.p(xp, y, th / 2), F.p(xp, y, -th / 2), F.p(xp, y + hS, -th / 2), F.p(xp, y + hS, th / 2), F.d(sx, 0, 0), { aSt: [[0, y, seed, kind], [th, y, seed, kind], [th, y + hS, seed, kind], [0, y + hS, seed, kind]] });
      // top of the bay (walk) — rough in ruins
      quadFacing(B.stone, F.p(x0, yTop, th / 2), F.p(x1, yTop, th / 2), F.p(x1, yTop, -th / 2), F.p(x0, yTop, -th / 2), [0, 1, 0], { aSt: [[x0, 0, seed, ru ? 4 : PAVING], [x1, 0, seed, ru ? 4 : PAVING], [x1, th, seed, ru ? 4 : PAVING], [x0, th, seed, ru ? 4 : PAVING]] });
      if (ru && ru.coral && hpos(xc, t, 3, 52) < 0.5) ru.coral.push({ pos: F.p(xc, yTop + 0.05, 0), normal: [0, 1, 0], size: 1.2, tag: 'city-arcade' });
    }
    // end faces
    for (const sx of [-1, 1]) quadFacing(B.stone, F.p(sx * len / 2, y, th / 2), F.p(sx * len / 2, y, -th / 2), F.p(sx * len / 2, yTop, -th / 2), F.p(sx * len / 2, yTop, th / 2), F.d(sx, 0, 0), { aSt: [[0, y, seed, kind], [th, y, seed, kind], [th, yTop, seed, kind], [0, yTop, seed, kind]] });
    // cornice band between the tiers (golden only; fallen in ruins)
    if (!ru) stoneBox(B, F, 0, 0, len / 2 + 0.25, th / 2 + 0.25, yTop, yTop + 0.45, DRESSED, seed, 63);
    y = yTop + (ru ? 0 : 0.45);
  }
  if (!ru) {
    // statues along the top
    for (let i = 0; i <= nB; i += 2) figure(B, F.p(-len / 2 + i * bay, y, 0), 2.3, F.rot, seed + i * 0.05, { gold: i % 4 === 0 });
  }
  return { top: y };
}
