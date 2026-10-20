// Town landmarks: agora terrace with stoas, small prostyle temples on the high points, a tall
// belfry-like tower, a domed rotunda. Sites are chosen on the plan grids (flatness, prominence).
import { heightAt } from '../world/heightfield.js';
import { Frame } from './geobuilder.js';
import { stoneBox, column, wall, quadFacing, triFacing, roof, volume, awning, woodBox, figure, acroterion, finial } from './house.js';
import { ROOF_KIND } from '../materials/terracotta.js';
import { WIN, GROUND, FLAG } from '../materials/plaster.js';

const MARBLE = 7, DRESSED = 3, PAVING = 1, POLY = 2;
/** compass heading (deg) of a frame's local +z */
export const compassOf = (rot) => ((Math.atan2(Math.sin(rot), -Math.cos(rot)) * 180) / Math.PI + 360) % 360;

// ------------------------------------------------------------------ site search
export function findSite(plan, occ, { w, d, maxRange = 6, score, avoid = [], minSep = 0, step = 12, margin = 4, rotFixed = null }) {
  let best = null;
  for (let z = plan.z0 + 20; z < plan.z1 - 20; z += step) for (let x = plan.x0 + 20; x < plan.x1 - 20; x += step) {
    if (!plan.inMask(x, z, Math.max(w, d) / 2 + margin)) continue;
    if (avoid.some((a) => Math.hypot(a[0] - x, a[1] - z) < minSep)) continue;
    let rot;
    if (rotFixed !== null) rot = rotFixed;
    else { const g = plan.gradDir(x, z); rot = Math.atan2(-g[0], -g[1]); } // front faces downhill
    if (occ.overlaps(x, z, w / 2 + 2, d / 2 + 2, rot)) continue;
    const F = new Frame(x, 0, z, rot);
    let mn = Infinity, mx = -Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const [px, , pz] = F.p(a * w / 2, 0, b * d / 2);
      if (!plan.inMask(px, pz)) { mn = -Infinity; break; }
      const h = plan.H.sample(px, pz); mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    if (!isFinite(mn)) continue;
    const range = mx - mn;
    if (range > maxRange) continue;
    const s = score(x, z, range);
    if (!best || s > best.s) best = { s, x, z, rot, mn, mx };
  }
  return best;
}

// ------------------------------------------------------------------ temple
/** prostyle / amphiprostyle / peripteral small temple. front = local +z */
export function temple(B, F, o) {
  const { floorY, seed } = o;
  const nCol = o.cols ?? 4;
  const colH = o.colH ?? 6.2;
  const r = colH / 13;              // lower column radius (Ionic-ish slender proportions)
  const wid = o.wid ?? (nCol - 1) * (r * 2 * 3.0) + 2 * r * 2.2;
  const len = o.len ?? wid * 1.8;
  const hw = wid / 2, hl = len / 2;
  const peri = !!o.peripteral;
  const steps = 3, sh = 0.32, st = 0.45;
  const groundY = o.groundY ?? floorY - 1;
  // crepidoma
  for (let i = 0; i < steps; i++) {
    const e = (steps - i) * st;
    stoneBox(B, F, 0, 0, hw + e + 0.6, hl + e + 0.6, i === 0 ? groundY - 2.5 : floorY - (steps - i) * sh, floorY - (steps - i - 1) * sh, MARBLE, seed, i === 0 ? 31 : 31);
  }
  const y0 = floorY;
  // cella (walls in dressed stone), set back from the front porch
  const porch = (wid / (nCol - 1)) * 1.25;
  const cw = hw - (peri ? (wid / (nCol - 1)) * 0.9 : 0.15);
  const czf = hl - porch, czb = peri ? -hl + porch * 0.8 : -hl + 0.15;
  stoneBox(B, F, 0, (czf + czb) / 2, cw, (czf - czb) / 2, y0, y0 + colH + 0.2, DRESSED, seed, 15);
  // door (dark recess faked with a dark stone slab inset)
  // columns
  const colAt = (x, z) => {
    stoneBox(B, F, x, z, r * 1.25, r * 1.25, y0, y0 + 0.22, MARBLE, seed, 31);
    column(B, F, x, z, r, r * 0.84, y0 + 0.22, y0 + colH - 0.5, 12, seed, MARBLE);
    column(B, F, x, z, r * 0.84, r * 1.12, y0 + colH - 0.5, y0 + colH - 0.25, 12, seed, MARBLE);
    stoneBox(B, F, x, z, r * 1.25, r * 1.25, y0 + colH - 0.25, y0 + colH, MARBLE, seed, 63);
  };
  const sp = wid / (nCol - 1) - 0.0001;
  const xs = []; for (let i = 0; i < nCol; i++) xs.push(-hw + r * 1.3 + (i * (wid - 2.6 * r)) / (nCol - 1));
  for (const x of xs) colAt(x, hl - r * 1.3);
  if (o.back || peri) for (const x of xs) colAt(x, -hl + r * 1.3);
  if (peri) {
    const nSide = Math.max(3, Math.round(len / sp));
    for (let i = 1; i < nSide; i++) {
      const z = hl - r * 1.3 - (i * (len - 2.6 * r)) / nSide;
      colAt(-hw + r * 1.3, z); colAt(hw - r * 1.3, z);
    }
  }
  // entablature: architrave, frieze, cornice
  const ye = y0 + colH;
  stoneBox(B, F, 0, 0, hw + 0.05, hl + 0.05, ye, ye + colH * 0.11, MARBLE, seed, 63);
  stoneBox(B, F, 0, 0, hw + 0.02, hl + 0.02, ye + colH * 0.11, ye + colH * 0.21, DRESSED, seed, 15);
  stoneBox(B, F, 0, 0, hw + 0.28, hl + 0.28, ye + colH * 0.21, ye + colH * 0.26, MARBLE, seed, 63);
  const yr = ye + colH * 0.26;
  // pediments (stone triangles) + tile roof
  const pitch = 14;
  const t = Math.tan((pitch * Math.PI) / 180);
  const rise = (hw + 0.28) * t;
  for (const sz of [1, -1]) {
    const z = sz * (hl + 0.05);
    const a = F.p(-hw, yr, z), b = F.p(hw, yr, z), c = F.p(0, yr + rise - 0.05, z);
    triFacing(B.stone, a, b, c, F.d(0, 0, sz), { aSt: [[0, yr, seed, DRESSED], [2 * hw, yr, seed, DRESSED], [hw, yr + rise, seed, DRESSED]] });
    // raking cornice
    stoneBox(B, F, 0, z + sz * 0.15, 0.25, 0.25, yr + rise - 0.1, yr + rise + 0.25, MARBLE, seed, 63); // acroterion base
    stoneBox(B, F, hw + 0.1, z + sz * 0.15, 0.22, 0.22, yr, yr + 0.45, MARBLE, seed, 63);
    stoneBox(B, F, -hw - 0.1, z + sz * 0.15, 0.22, 0.22, yr, yr + 0.45, MARBLE, seed, 63);
    // r5 acroteria: gilded palmette on the apex, statues (or marble palmettes) on the corners
    acroterion(B, F.p(0, yr + rise + 0.2, z + sz * 0.15), colH * 0.2, F.rot + (sz < 0 ? Math.PI : 0), seed, true);
    for (const sx of [-1, 1]) {
      if (sz > 0 || o.back) figure(B, F.p(sx * (hw + 0.1), yr + 0.45, z + sz * 0.15), colH * 0.27, F.rot + (sz < 0 ? Math.PI : 0), seed + sx * 0.05, {});
      else acroterion(B, F.p(sx * (hw + 0.1), yr + 0.45, z + sz * 0.15), colH * 0.14, F.rot, seed, false);
    }
    // pediment sculpture: a row of small figures in the tympanum (white silhouettes against its shadow)
    const nf = nCol >= 6 ? 5 : 3;
    for (let i = 0; i < nf; i++) {
      const fx = (i - (nf - 1) / 2) * ((hw * 1.5) / nf);
      const hgt = (rise - 0.35) * (1 - Math.abs(fx) / (hw + 0.28)) * 0.82;
      if (hgt > 0.4) figure(B, F.p(fx, yr + 0.05, z - sz * 0.12), hgt, F.rot + (sz < 0 ? Math.PI : 0), seed + i * 0.11, {});
    }
  }
  // dark doorway in the cella front (reads as a black slot between the columns)
  {
    const dw = Math.min(cw * 0.32, 1.6), dh = Math.min(colH * 0.62, 5.2);
    const zd = czf + 0.02;
    quadFacing(B.stone, F.p(-dw, y0 + 0.05, zd), F.p(dw, y0 + 0.05, zd), F.p(dw, y0 + dh, zd), F.p(-dw, y0 + dh, zd), F.d(0, 0, 1),
      { aSt: [[0, 0, seed, 9], [1, 0, seed, 9], [1, 1, seed, 9], [0, 1, seed, 9]] });
    stoneBox(B, F, 0, zd + 0.06, dw + 0.25, 0.06, y0 + dh, y0 + dh + 0.35, MARBLE, seed, 1 | 2 | 8 | 16);
  }
  // statues on pedestals flanking the front steps
  for (const sx of [-1, 1]) {
    const pp = F.p(sx * (hw + 0.2), 0, hl + 3 * st + 1.7);
    const gy = Math.max(heightAt(pp[0], pp[2]), groundY);
    if (floorY - gy < 4) figure(B, [pp[0], gy, pp[2]], colH * 0.36, F.rot, seed + sx * 0.3, { plinth: colH * 0.18, spear: sx > 0 });
  }
  // roof: gable along z (ridge along the long axis)
  roof(B, new Frame(...F.p(0, 0, 0), F.rot + Math.PI / 2), { cx: 0, cz: 0, hw: hl + 0.28, hd: hw + 0.28, yT: yr - 0.1, type: 'gableX', pitch, over: 0.15, floorY: y0, h: colH, sty: [seed, 3.3, 0, FLAG.BLANK], noGableWall: true }, seed * 0.77 % 1);
  return { top: yr + rise };
}

// ------------------------------------------------------------------ stoa
/** long colonnaded hall, colonnade on local +z side; length along x */
export function stoa(B, F, o) {
  const { len, dep, floorY, seed } = o;
  const colH = o.colH ?? 5.2;
  const hl = len / 2, hd = dep / 2;
  const groundY = o.groundY ?? floorY - 1;
  stoneBox(B, F, 0, 0, hl + 0.8, hd + 0.8, groundY - 2, floorY - 0.3, PAVING, seed, 31);
  stoneBox(B, F, 0, 0, hl + 0.4, hd + 0.4, floorY - 0.3, floorY, MARBLE, seed, 31);
  // back hall (plaster, shops behind the colonnade)
  const backD = dep * 0.55;
  const sty = [seed, 4.0, WIN.ARCH_FRAMED + 8 * GROUND.SHOP, FLAG.DOOR | FLAG.BANDS];
  const zb0 = -hd, zb1 = -hd + backD;
  wall(B, F, -hl, zb1, hl, zb1, floorY, floorY + colH + 1.2, floorY, colH + 1.2, sty);
  wall(B, F, hl, zb0, -hl, zb0, floorY, floorY + colH + 1.2, floorY, colH + 1.2, [seed, 4.0, WIN.SMALL, 0]);
  wall(B, F, hl, zb1, hl, zb0, floorY, floorY + colH + 1.2, floorY, colH + 1.2, [seed, 4.0, WIN.SMALL, FLAG.BLANK]);
  wall(B, F, -hl, zb0, -hl, zb1, floorY, floorY + colH + 1.2, floorY, colH + 1.2, [seed, 4.0, WIN.SMALL, FLAG.BLANK]);
  // colonnade
  const r = colH / 14;
  const n = Math.max(4, Math.round(len / 3.2));
  for (let i = 0; i <= n; i++) {
    const x = -hl + 0.5 + (i * (len - 1)) / n;
    const z = hd - 0.5;
    column(B, F, x, z, r, r * 0.85, floorY, floorY + colH - 0.3, 10, seed, MARBLE);
    stoneBox(B, F, x, z, r * 1.3, r * 1.3, floorY + colH - 0.3, floorY + colH, MARBLE, seed, 63);
  }
  if (o.slots) {
    for (let i = 1; i < n; i += 3) {
      const x = -hl + 0.5 + ((i + 0.5) * (len - 1)) / n;
      o.slots.banner.push({ pos: F.p(x, floorY + colH - 0.05, hd - 0.5), facing: compassOf(F.rot), size: [1.15, 3.1], tag: 'columns city-stoa' });
    }
  }
  // end walls of the colonnade
  wall(B, F, hl, hd, hl, zb1, floorY, floorY + colH + 1.2, floorY, colH + 1.2, [seed, 4.0, WIN.SMALL, FLAG.BLANK]);
  wall(B, F, -hl, zb1, -hl, hd, floorY, floorY + colH + 1.2, floorY, colH + 1.2, [seed, 4.0, WIN.SMALL, FLAG.BLANK]);
  // architrave + roof over everything
  stoneBox(B, F, 0, hd - 0.5, hl + 0.2, r * 1.6, floorY + colH, floorY + colH + 1.2, MARBLE, seed, 63);
  const yR = roof(B, F, { cx: 0, cz: 0, hw: hl + 0.2, hd: hd + 0.1, yT: floorY + colH + 1.2, type: o.roofType ?? 'gableX', pitch: 16, over: 0.5, floorY, h: colH + 1.2, sty: [seed, 4, 0, FLAG.BLANK] }, (seed * 1.3) % 1);
  // gilded acroteria on the gable apexes, statues at the front corners of the stylobate
  if ((o.roofType ?? 'gableX') === 'gableX') for (const sx of [-1, 1]) acroterion(B, F.p(sx * (hl + 0.45), yR - 0.05, 0), 1.0, F.rot + Math.PI / 2, seed, true);
  for (const sx of [-1, 1]) figure(B, F.p(sx * (hl - 0.2), floorY, hd + 0.2), 2.2, F.rot, seed + sx * 0.2, { plinth: 1.0, spear: sx > 0 });
}

// ------------------------------------------------------------------ tower
export function tower(B, F, o) {
  const { floorY, seed, groundY } = o;
  const hw = o.hw ?? 3.2, H = o.h ?? 24;
  stoneBox(B, F, 0, 0, hw + 0.25, hw + 0.25, groundY - 2, floorY + 2.2, POLY, seed, 31);
  const stH = 3.6;
  const body = H - 4.2;
  const flags = { front: FLAG.QUOINS | FLAG.BANDS, back: FLAG.QUOINS | FLAG.BANDS, left: FLAG.QUOINS | FLAG.BANDS, right: FLAG.QUOINS | FLAG.BANDS };
  volume(B, F, { cx: 0, cz: 0, hw, hd: hw, floorY: floorY + 2.2, h: body, stH, groundY: floorY, seed, roof: 'flat', parapet: 0.0, pitch: 20, over: 0.3, style: WIN.SMALL, flags, cornice: true });
  // belfry stage with big arched openings (arcade style on all sides)
  const yb = floorY + 2.2 + body;
  const bf = { front: FLAG.QUOINS, back: FLAG.QUOINS, left: FLAG.QUOINS, right: FLAG.QUOINS };
  const top = volume(B, F, { cx: 0, cz: 0, hw: hw - 0.15, hd: hw - 0.15, floorY: yb, h: 4.2, stH: 4.2, groundY: yb, seed, roof: 'pyramid', pitch: 32, over: 0.45, style: WIN.ARCH + 8 * GROUND.ARCADE, flags: bf, cornice: true, plinthH: 0.25 });
  finial(B, F.p(0, top - 0.1, 0), 0.3, seed);
  // navy/gold banners hanging under the belfry on two faces (colour accents across the town)
  if (o.slots) for (const sz of [1, -1]) o.slots.banner.push({ pos: F.p(0, yb - 0.35, sz * (hw + 0.06)), facing: compassOf(F.rot + (sz < 0 ? Math.PI : 0)), size: [Math.min(2.0, hw * 0.6), Math.min(6.5, body * 0.35)], tag: 'wall city-tower' });
  // corner pinnacles on the belfry cornice
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) finial(B, F.p(sx * (hw - 0.05), yb + 4.2 + 0.05, sz * (hw - 0.05)), 0.13, seed);
}

// ------------------------------------------------------------------ rotunda (domed)
export function rotunda(B, F, o) {
  const { floorY, seed, groundY } = o;
  const R = o.r ?? 8, H = o.h ?? 8.5, seg = 28;
  // podium + steps
  for (let i = 0; i < 3; i++) {
    const rr = R + 1.6 - i * 0.45;
    ring(B, F, rr, i === 0 ? groundY - 2 : floorY - (3 - i) * 0.3, floorY - (2 - i) * 0.3, seg, seed, PAVING);
  }
  // drum walls (plaster): arcaded ground storey + arched framed windows above (two storeys over the
  // drum height, so the upper ring of windows always exists)
  const sty = [seed, H / 2, WIN.ARCH_FRAMED + 8 * GROUND.ARCADE, FLAG.BANDS | FLAG.QUOINS * 0];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const ax = Math.cos(a0) * R, az = -Math.sin(a0) * R, bx = Math.cos(a1) * R, bz = -Math.sin(a1) * R;
    // wall() expects the outside on the right of a→b: walking clockwise seen from above
    const segLen = Math.hypot(bx - ax, bz - az);
    wall(B, F, ax, az, bx, bz, floorY, floorY + H, floorY, H, sty, i * segLen, segLen * seg);
  }
  // fix: windows are laid out per wall segment length; widen the bays by passing one big wall length
  // cornice ring
  ring(B, F, R + 0.35, floorY + H - 0.05, floorY + H + 0.35, seg, seed, MARBLE);
  // dome (terracotta tiles) + lantern
  const yd = floorY + H + 0.35;
  const Rd = R + 0.1;
  const rings = 9;
  const P = (x, y, z) => F.p(x, y, z);
  for (let j = 0; j < rings; j++) {
    const t0 = (j / rings) * (Math.PI / 2) * 0.92, t1 = ((j + 1) / rings) * (Math.PI / 2) * 0.92;
    const r0 = Rd * Math.cos(t0), r1 = Rd * Math.cos(t1), y0 = yd + Rd * 0.8 * Math.sin(t0), y1 = yd + Rd * 0.8 * Math.sin(t1);
    const v0 = Rd * t0, v1 = Rd * t1;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p00 = P(Math.cos(a0) * r0, y0, -Math.sin(a0) * r0), p10 = P(Math.cos(a1) * r0, y0, -Math.sin(a1) * r0);
      const p11 = P(Math.cos(a1) * r1, y1, -Math.sin(a1) * r1), p01 = P(Math.cos(a0) * r1, y1, -Math.sin(a0) * r1);
      const am = (a0 + a1) / 2;
      const want = F.d(Math.cos(am), 0.6, -Math.sin(am));
      const u00 = a0 * r0, u10 = a1 * r0, u11 = a1 * r1, u01 = a0 * r1;
      if (o.tiledDome) {
        const rk = (u, v) => [u, v, seed, ROOF_KIND.TILE];
        quadFacing(B.roof, p00, p10, p11, p01, want, { aRoof: [rk(u00, v0), rk(u10, v0), rk(u11, v1), rk(u01, v1)] });
      } else {
        // white marble dome (lead-grey ribs every 4th segment)
        const kd = i % 4 === 0 ? DRESSED : MARBLE;
        const sk = (u, v) => [u, v, seed, kd];
        quadFacing(B.stone, p00, p10, p11, p01, want, { aSt: [sk(u00, v0), sk(u10, v0), sk(u11, v1), sk(u01, v1)] });
      }
    }
  }
  const yTop = yd + Rd * 0.8 * Math.sin((Math.PI / 2) * 0.92);
  const rTop = Rd * Math.cos((Math.PI / 2) * 0.92);
  // lantern
  const lr = Math.max(1.1, rTop + 0.2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    column(B, F, Math.cos(a) * lr, -Math.sin(a) * lr, 0.14, 0.12, yTop - 0.2, yTop + 1.8, 6, seed, MARBLE);
  }
  ring(B, F, lr + 0.25, yTop + 1.8, yTop + 2.1, 12, seed, MARBLE);
  const yL = roof(B, F, { cx: 0, cz: 0, hw: lr + 0.1, hd: lr + 0.1, yT: yTop + 2.1, type: 'pyramid', pitch: 30, over: 0.15, floorY, h: H, sty: [seed, 4, 0, FLAG.BLANK] }, seed);
  finial(B, F.p(0, yL - 0.05, 0), 0.32, seed);
  // statues on the cornice ring (refs 1/4: figures crowning domed buildings)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const d = F.d(Math.cos(a), 0, -Math.sin(a));
    figure(B, F.p(Math.cos(a) * (R + 0.1), floorY + H + 0.35, -Math.sin(a) * (R + 0.1)), 2.0, Math.atan2(d[0], d[2]), seed + i * 0.07, { spear: i % 2 === 0 });
  }
}

/** horizontal-axis prism ring (cylinder) with flat top, in stone */
export function ring(B, F, R, y0, y1, seg, seed, kind) {
  const P = (x, y, z) => F.p(x, y, z);
  const circ = 2 * Math.PI * R;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [Math.cos(a0) * R, -Math.sin(a0) * R], p1 = [Math.cos(a1) * R, -Math.sin(a1) * R];
    const am = (a0 + a1) / 2;
    const u0 = (i / seg) * circ, u1 = ((i + 1) / seg) * circ;
    quadFacing(B.stone, P(p0[0], y0, p0[1]), P(p1[0], y0, p1[1]), P(p1[0], y1, p1[1]), P(p0[0], y1, p0[1]), F.d(Math.cos(am), 0, -Math.sin(am)),
      { aSt: [[u0, y0, seed, kind], [u1, y0, seed, kind], [u1, y1, seed, kind], [u0, y1, seed, kind]] });
    // top cap (triangle fan as quads to the centre)
    triFacing(B.stone, P(p0[0], y1, p0[1]), P(p1[0], y1, p1[1]), P(0, y1, 0), [0, 1, 0], { aSt: [[p0[0], p0[1], seed, PAVING], [p1[0], p1[1], seed, PAVING], [0, 0, seed, PAVING]] });
  }
}

// ------------------------------------------------------------------ agora terrace
export function agora(B, F, o) {
  const { w, d, floorY, seed, groundY } = o;
  // paved terrace with retaining walls (polygonal masonry) down to the lowest ground
  stoneBox(B, F, 0, 0, w / 2, d / 2, groundY - 2.5, floorY - 0.15, POLY, seed, 15);
  // paving top: split into tiles to keep the pattern coordinates sensible
  stoneBox(B, F, 0, 0, w / 2, d / 2, floorY - 0.15, floorY, PAVING, seed, 16);
  // stoa along the back (local -z) and one side
  stoa(B, new Frame(...F.p(0, 0, -d / 2 + 7.5), F.rot), { len: w - 6, dep: 13, floorY, seed: (seed * 1.7) % 1, groundY: floorY - 0.5, slots: o.slots });
  stoa(B, new Frame(...F.p(-w / 2 + 7, 0, 4), F.rot + Math.PI / 2), { len: d - 22, dep: 12, floorY, seed: (seed * 2.3) % 1, groundY: floorY - 0.5, roofType: 'hip' });
  // altar / fountain in the middle
  stoneBox(B, F, 4, 2, 2.2, 1.4, floorY, floorY + 1.1, MARBLE, seed, 31);
  stoneBox(B, F, 4, 2, 2.5, 1.7, floorY + 1.1, floorY + 1.3, MARBLE, seed, 63);
  if (o.slots) o.slots.brazier.push({ pos: F.p(4, floorY + 1.3, 2), facing: compassOf(F.rot), size: 1.1, tag: 'city-altar' });
  // market stalls: timber frames with striped canvas awnings and counters
  let k = 0;
  for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) {
    const sx = -w / 2 + 18 + i * 6.2 + (row ? 3 : 0), sz = -d / 2 + 18 + row * 9;
    if (Math.abs(sx - 4) < 4.5 && Math.abs(sz - 2) < 4) continue;
    const s2 = (seed * 7.7 + k++ * 0.137) % 1;
    const sw = 3.2, sd = 2.2;
    awning(B, F, sx, sz - sd / 2, floorY + 2.55, sw, sd, s2, (k % 3 === 0) ? 0 : (k % 3 === 1) ? 1 : 3);
    for (const px of [-1, 1]) woodBox(B, F, sx + px * (sw / 2 - 0.08), sz - sd / 2 + 0.05, 0.05, 0.05, floorY, floorY + 2.55, 3, s2);
    woodBox(B, F, sx, sz + 0.2, sw / 2 - 0.2, 0.45, floorY, floorY + 0.9, 9, s2);
    // goods: amphorae / baskets on the ground
    for (let g = 0; g < 3; g++) woodBox(B, F, sx - 1 + g * 0.9, sz + 1.2, 0.22, 0.22, floorY, floorY + 0.5 + 0.2 * ((g + k) % 2), 8, s2);
  }
  // statue pedestals at the corners of the plaza
  for (const [px, pz] of [[w / 2 - 3, d / 2 - 3], [w / 2 - 3, -d / 2 + 18], [-w / 2 + 18, d / 2 - 3]]) {
    stoneBox(B, F, px, pz, 0.8, 0.8, floorY, floorY + 1.8, MARBLE, seed, 31);
    figure(B, F.p(px, floorY + 1.8, pz), 2.4, F.rot, seed + px * 0.01, { spear: px > 0 });
  }
  // a gilded statue on a tall column in the middle of the square
  {
    const cx = 10, cz = 14;
    stoneBox(B, F, cx, cz, 1.0, 1.0, floorY, floorY + 1.4, MARBLE, seed, 31);
    column(B, F, cx, cz, 0.55, 0.48, floorY + 1.4, floorY + 9.5, 12, seed, MARBLE);
    stoneBox(B, F, cx, cz, 0.75, 0.75, floorY + 9.5, floorY + 10.0, MARBLE, seed, 63);
    figure(B, F.p(cx, floorY + 10.0, cz), 2.6, F.rot, seed, { gold: true, spear: true });
  }
}

export function groundRange(F, hw, hd) {
  let mn = Infinity, mx = -Infinity;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const [x, , z] = F.p(a * hw, 0, b * hd);
    const h = heightAt(x, z); mn = Math.min(mn, h); mx = Math.max(mx, h);
  }
  return { mn, mx };
}

// ------------------------------------------------------------------ placement
/**
 * Choose sites and build the landmarks. Returns records { kind, x, z, rot, hw, hd, floorY, top }.
 * getB(x, z) → builders for the chunk containing (x, z).
 */
export function placeLandmarks(plan, occ, getB, engine, rng) {
  const out = [];
  const C = plan.centroid;
  const fp = engine.footprints;
  const free = (x, z, r) => fp.isFree(x, z, r);
  const add = (kind, s, hw, hd, build) => {
    if (!s) return null;
    if (!free(s.x, s.z, Math.min(hw, hd))) return null;
    const F = new Frame(s.x, 0, s.z, s.rot);
    const g = groundRange(F, hw, hd);
    const rec = { kind, x: s.x, z: s.z, rot: s.rot, hw, hd, groundY: g.mn, floorY: 0 };
    build(F, rec, g);
    occ.add(s.x, s.z, hw + 1.5, hd + 1.5, s.rot, 'landmark');
    fp.addRect(s.x, s.z, hw + 0.5, hd + 0.5, s.rot, 'city');
    out.push(rec);
    return rec;
  };
  const prominence = (x, z) => {
    let s = 0;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; s += plan.H.sample(x + Math.cos(a) * 70, z + Math.sin(a) * 70); }
    return plan.H.sample(x, z) - s / 8;
  };

  // agora (central, flat)
  const sA = findSite(plan, occ, { w: 66, d: 48, maxRange: 9, step: 10, margin: 10, score: (x, z, r) => -Math.hypot(x - C[0], z - C[1]) / 90 - r * 0.25 });
  const agoraRec = add('agora', sA, 33, 24, (F, rec, g) => {
    rec.floorY = g.mx + 0.25;
    agora(getB(rec.x, rec.z), F, { w: 66, d: 48, floorY: rec.floorY, seed: rng.random(), groundY: g.mn, slots: engine.slots });
  });
  const avoid = agoraRec ? [[agoraRec.x, agoraRec.z]] : [];

  // domed rotunda near the agora
  const sR = findSite(plan, occ, { w: 22, d: 22, maxRange: 5, step: 8, avoid, minSep: 45,
    score: (x, z, r) => -(agoraRec ? Math.abs(Math.hypot(x - agoraRec.x, z - agoraRec.z) - 70) : 0) / 30 - r * 0.4 });
  add('rotunda', sR, 11, 11, (F, rec, g) => {
    rec.floorY = g.mx + 0.4;
    rotunda(getB(rec.x, rec.z), F, { floorY: rec.floorY, seed: rng.random(), groundY: g.mn, r: 8, h: 8.5 });
  });

  // small temples on the high points (one guaranteed in the north-east, seen from the lagoon shots)
  const temples = [];
  const tryTemple = (bonus, cols, peri, minSep = 200) => {
    const w = cols === 6 ? 15 : 11, d = cols === 6 ? 26 : 19;
    const s = findSite(plan, occ, { w: w + 3, d: d + 3, maxRange: 7, step: 10, avoid: [...avoid, ...temples], minSep,
      score: (x, z, r) => (free(x, z, w / 2) ? 0 : -1e6) + prominence(x, z) * 1.0 + plan.H.sample(x, z) * 0.05 - r * 0.5 + bonus(x, z) });
    const rec = add('temple', s, w / 2 + 1.5, d / 2 + 1.5, (F, rec, g) => {
      rec.floorY = g.mx + 1.0;
      const res = temple(getB(rec.x, rec.z), F, { floorY: rec.floorY, seed: rng.random(), groundY: g.mn, cols, colH: cols === 6 ? 7.2 : 5.8, peripteral: peri, back: !peri && rng.chance(0.5), wid: w - 2, len: d - 2 });
      rec.top = res.top;
    });
    if (rec) temples.push([rec.x, rec.z]);
  };
  tryTemple((x, z) => (x > -640 && z < -260 ? 40 : -100), 6, true);
  tryTemple(() => 0, 4, false);
  tryTemple(() => 0, 6, false);
  tryTemple((x) => (x < -1000 ? 10 : 0), 4, false);
  tryTemple(() => 0, 4, false);
  // r5: two more shrines (ref 1: temple fronts all over the town)
  tryTemple(() => 0, 4, false, 150);
  tryTemple(() => 0, 6, true, 150);

  // belfry-like towers on prominent spots
  const towers = [];
  for (let i = 0; i < 5; i++) {
    const s = findSite(plan, occ, { w: 9, d: 9, maxRange: 4, step: 8, avoid: [...avoid, ...temples, ...towers], minSep: i < 2 ? 160 : 120,
      score: (x, z, r) => prominence(x, z) + plan.H.sample(x, z) * 0.04 - r - (i === 0 ? Math.max(0, x + 900) * 0.05 : 0) });
    const rec = add('tower', s, 4, 4, (F, rec, g) => {
      rec.floorY = g.mx + 0.2;
      tower(getB(rec.x, rec.z), F, { floorY: rec.floorY, seed: rng.random(), groundY: g.mn, hw: 3.1 + rng.random() * 0.6, h: 22 + rng.random() * 8, slots: engine.slots });
    });
    if (rec) towers.push([rec.x, rec.z]);
  }
  // r5: two more domed buildings (marble / tiled domes) spread over the town (skyline variety)
  for (let i = 0; i < 2; i++) {
    const s = findSite(plan, occ, { w: 20, d: 20, maxRange: 4, step: 10, avoid: [...avoid, ...temples, ...towers], minSep: 150,
      score: (x, z, r) => prominence(x, z) * 0.6 + plan.H.sample(x, z) * 0.03 - r * 0.5 + (i === 0 ? -Math.abs(x + 800) * 0.01 : -Math.abs(z + 150) * 0.01) });
    const rec = add('rotunda', s, 10, 10, (F, rec, g) => {
      rec.floorY = g.mx + 0.4;
      rotunda(getB(rec.x, rec.z), F, { floorY: rec.floorY, seed: rng.random(), groundY: g.mn, r: 6.5 + rng.random() * 1.5, h: 7 + rng.random() * 2, tiledDome: i === 1 });
    });
    if (rec) towers.push([rec.x, rec.z]);
  }
  // palace with a campanile on a prominent spot (the far hill of ref 1)
  const sP = findSite(plan, occ, { w: 46, d: 36, maxRange: 6, step: 10, avoid: [...avoid, ...temples, ...towers], minSep: 120,
    score: (x, z, r) => prominence(x, z) * 0.8 + plan.H.sample(x, z) * 0.05 - r * 0.6 - Math.max(0, x + 950) * 0.03 });
  add('palace', sP, 23, 18, (F, rec, g) => {
    rec.floorY = g.mx + 0.3;
    palace(getB(rec.x, rec.z), F, { floorY: rec.floorY, seed: rng.random(), groundY: g.mn, w: 42, d: 32, slots: engine.slots }, rng);
  });
  // Greek theatre on a hillside
  const sT = findTheatreSite(plan, occ, rng, [...avoid, ...temples, ...towers]);
  if (sT) {
    const F = new Frame(sT.x, 0, sT.z, sT.rot);
    const res = theatre(getB(sT.x, sT.z), F, { yO: sT.yO + 0.3, seed: rng.random() });
    const cx = sT.x - sT.ux * 14, cz = sT.z - sT.uz * 14;
    occ.add(cx, cz, 40, 30, sT.rot, 'landmark');
    fp.addRect(cx, cz, 38, 28, sT.rot, 'city');
    out.push({ kind: 'theatre', x: cx, z: cz, rot: sT.rot, hw: 38, hd: 28, floorY: sT.yO, groundY: sT.yO, top: res.yTop, ox: sT.x, oz: sT.z });
  }
  // the lagoon-port front (shots 1 and 4): a marble stoa on the bench above the quay and temples on
  // the plateau rim, all facing east over the lagoon (ref 1 harbour colonnades, ref 4 white precincts)
  const near = (tx, tz, k = 30) => (x, z, r) => -Math.hypot(x - tx, z - tz) / k - r * 0.3;
  const east = Math.PI / 2;
  const sS = findSite(plan, occ, { w: 40, d: 13, maxRange: 5, step: 4, margin: 1, rotFixed: east, score: near(-262, 72) });
  if (sS && Math.hypot(sS.x + 262, sS.z - 72) < 70) add('stoa', sS, 20, 6.5, (F, rec, g) => {
    rec.floorY = g.mx + 0.3;
    stoa(getB(rec.x, rec.z), F, { len: 38, dep: 11, floorY: rec.floorY, seed: rng.random(), groundY: g.mn, colH: 5.6, slots: engine.slots });
  });
  for (const [tx, tz, cols] of [[-306, 24, 6], [-302, 140, 4]]) {
    const w = cols === 6 ? 15 : 11, d = cols === 6 ? 25 : 18;
    const s = findSite(plan, occ, { w: w + 2, d: d + 2, maxRange: 6, step: 4, margin: 1, rotFixed: east, avoid: temples, minSep: 60, score: near(tx, tz) });
    if (!s || Math.hypot(s.x - tx, s.z - tz) > 60) continue;
    const rec = add('temple', s, w / 2 + 1, d / 2 + 1, (F, rec, g) => {
      rec.floorY = g.mx + 0.8;
      const res = temple(getB(rec.x, rec.z), F, { floorY: rec.floorY, seed: rng.random(), groundY: g.mn, cols, colH: cols === 6 ? 6.8 : 5.6, peripteral: cols === 6, back: true, wid: w - 2, len: d - 2 });
      rec.top = res.top;
    });
    if (rec) temples.push([rec.x, rec.z]);
  }
  // sanctuary precinct on the canyon rim north of the port (outside the street grid): a long stoa on
  // the rim, a peripteral temple and a tholos among cypress rows and gardens (ref 4 top-left white
  // marble precincts; left of the temple in shot 1)
  const precinct = [
    { kind: 'stoa', x: -263, z: -84, rot: east, hw: 7, hd: 25 },
    { kind: 'temple', x: -302, z: -98, rot: east, hw: 13.5, hd: 8.5, cols: 6 },
    { kind: 'rotunda', x: -290, z: -48, rot: east, hw: 10, hd: 10 },
    { kind: 'temple', x: -318, z: -136, rot: east + 0.35, hw: 10, hd: 6.5, cols: 4 },
  ];
  for (const p of precinct) {
    // landmark frames are (width along local x, length along local z); our rects are given in world
    // x/z for an east-facing front, so swap the half sizes into the frame
    const s = { x: p.x, z: p.z, rot: p.rot };
    const fw = p.hd, fd = p.hw;
    const rec = add(p.kind, s, fw, fd, (F, rec, g) => {
      rec.floorY = g.mx + 0.4;
      const B = getB(rec.x, rec.z);
      if (p.kind === 'stoa') stoa(B, F, { len: 2 * p.hd - 2, dep: 2 * p.hw - 2, floorY: rec.floorY, seed: rng.random(), groundY: g.mn, colH: 5.8, slots: engine.slots });
      else if (p.kind === 'rotunda') rotunda(B, F, { floorY: rec.floorY, seed: rng.random(), groundY: g.mn, r: 7, h: 7.5, tiledDome: true });
      else { const res = temple(B, F, { floorY: rec.floorY + 0.4, seed: rng.random(), groundY: g.mn, cols: p.cols, colH: p.cols === 6 ? 7.0 : 5.6, peripteral: p.cols === 6, back: true, wid: 2 * fw - 2, len: 2 * fd - 2 }); rec.top = res.top; }
    });
    if (rec && engine.registry) {
      // cypress avenue + garden plots around each building (for the vegetation module)
      const rows = (engine.registry.cypressRows ||= []);
      const c = Math.cos(p.rot), sn = Math.sin(p.rot);
      const P = (lx, lz) => [p.x + lx * c + lz * sn, p.z - lx * sn + lz * c];
      for (const sx of [-1, 1]) rows.push({ points: [P(sx * (fw + 4), -fd - 3), P(sx * (fw + 4), fd + 3)], spacing: 6.5, height: 15, source: 'city' });
    }
  }
  return out;
}

// ------------------------------------------------------------------ palace (court building + campanile)
export function palace(B, F, o, rng) {
  const { floorY, seed, groundY } = o;
  const W = o.w ?? 42, D = o.d ?? 32, wing = 8.5;
  const stH = 3.9;
  const st = rng.int(2, 3);
  const h = st * stH + 0.5;
  const flags = (front) => ({ front: (front ? FLAG.DOOR | FLAG.LOGGIA : 0) | FLAG.BANDS | FLAG.QUOINS, back: FLAG.BANDS | FLAG.QUOINS, left: FLAG.BANDS | FLAG.QUOINS, right: FLAG.BANDS | FLAG.QUOINS });
  const common = { floorY, h, stH, groundY, seed, roof: 'hip', pitch: 17, over: 0.55, cornice: true, plinthH: 0.6, podiumKind: 2 };
  // front wing: flat roof behind a parapet crowned with statues (palazzo roofline, refs 1/4)
  volume(B, F, { ...common, cx: 0, cz: D / 2 - wing / 2, hw: W / 2, hd: wing / 2, style: WIN.ARCH_FRAMED + 8 * GROUND.ARCADE, flags: flags(true), roof: 'flat', parapet: 1.0 });
  {
    const yP = floorY + h + 1.0 + 0.08;
    const nS = Math.max(4, Math.round(W / 4.5));
    for (let i = 0; i <= nS; i++) {
      const x = -W / 2 + 0.3 + (i * (W - 0.6)) / nS;
      figure(B, F.p(x, yP, D / 2 - 0.15), 1.8, F.rot, seed + i * 0.031, { plinth: 0.3, gold: i === nS / 2 });
    }
  }
  volume(B, F, { ...common, cx: 0, cz: -D / 2 + wing / 2, hw: W / 2, hd: wing / 2, style: WIN.FRAMED, flags: flags(false) });
  const sd = (D - 2 * wing) / 2 - 0.02;
  volume(B, F, { ...common, cx: -W / 2 + wing / 2, cz: 0, hw: wing / 2, hd: sd, style: WIN.FRAMED, flags: flags(false), roof: 'gableZ' });
  volume(B, F, { ...common, cx: W / 2 - wing / 2, cz: 0, hw: wing / 2, hd: sd, style: WIN.FRAMED, flags: flags(false), roof: 'gableZ' });
  stoneBox(B, F, 0, 0, W / 2 - wing, sd, floorY - 0.4, floorY + 0.05, PAVING, seed, 16);
  if (o.slots) for (const x of [-W / 4, W / 4]) o.slots.banner.push({ pos: F.p(x, floorY + h - 0.9, D / 2 + 0.08), facing: compassOf(F.rot), size: [1.5, 4.2], tag: 'wall city-palace' });
  // campanile rising from one rear corner
  const sx = rng.sign();
  tower(B, new Frame(...F.p(sx * (W / 2 - 3.6), 0, -D / 2 + 3.6), F.rot), { floorY: floorY + h - 2.4, seed, groundY: floorY + h - 3, hw: 3.3, h: 16 + rng.random() * 6 });
}

// ------------------------------------------------------------------ Greek theatre cut into a hillside
/** orchestra centre at the frame origin (y = yO); the cavea rises toward local -z (uphill), skene toward +z */
export function theatre(B, F, o) {
  const { yO, seed } = o;
  const r0 = o.r0 ?? 10, rows = o.rows ?? 30, tread = 0.82, riser = 0.42;
  const a0 = Math.PI * (1 + (o.span ?? 0.06)), a1 = Math.PI * (2 - (o.span ?? 0.06));
  const seg = 44;
  const pt = (r, a, y) => F.p(Math.cos(a) * r, y, Math.sin(a) * r);
  const ground = (r, a) => { const [x, , z] = F.p(Math.cos(a) * r, 0, Math.sin(a) * r); return heightAt(x, z); };
  ring(B, F, r0, yO - 1.5, yO, 32, seed, PAVING);
  for (let k = 0; k < rows; k++) {
    const rIn = r0 + 1.6 + k * tread, rOut = rIn + tread;
    const y = yO + 0.5 + (k + 1) * riser;
    for (let i = 0; i < seg; i++) {
      const aa = a0 + ((a1 - a0) * i) / seg, ab = a0 + ((a1 - a0) * (i + 1)) / seg;
      const aisle = i % 5 === 2;
      const yy = aisle ? y - riser * 0.5 : y;
      const kind = aisle ? PAVING : MARBLE;
      const uA = aa * rIn, uB = ab * rIn;
      quadFacing(B.stone, pt(rIn, aa, yy), pt(rIn, ab, yy), pt(rOut, ab, yy), pt(rOut, aa, yy), [0, 1, 0],
        { aSt: [[uA, rIn, seed, kind], [uB, rIn, seed, kind], [uB, rOut, seed, kind], [uA, rOut, seed, kind]] });
      const g = Math.min(ground(rIn, aa), ground(rIn, ab), yy - riser) - 0.4;
      const ma = (aa + ab) / 2;
      quadFacing(B.stone, pt(rIn, aa, g), pt(rIn, ab, g), pt(rIn, ab, yy), pt(rIn, aa, yy), F.d(-Math.cos(ma), 0, -Math.sin(ma)),
        { aSt: [[uA, g, seed, MARBLE], [uB, g, seed, MARBLE], [uB, yy, seed, MARBLE], [uA, yy, seed, MARBLE]] });
    }
    for (const a of [a0, a1]) {
      const g = Math.min(ground(rIn, a), ground(rOut, a), y - riser) - 0.6;
      const out = a === a0 ? -1 : 1;
      const tdir = F.d(-Math.sin(a) * out, 0, Math.cos(a) * out);
      quadFacing(B.stone, pt(rIn, a, g), pt(rOut, a, g), pt(rOut, a, y), pt(rIn, a, y), tdir,
        { aSt: [[rIn, g, seed, POLY], [rOut, g, seed, POLY], [rOut, y, seed, POLY], [rIn, y, seed, POLY]] });
    }
  }
  const rTop = r0 + 1.6 + rows * tread, yTop = yO + 0.5 + rows * riser;
  for (let i = 0; i < seg; i++) {
    const aa = a0 + ((a1 - a0) * i) / seg, ab = a0 + ((a1 - a0) * (i + 1)) / seg, ma = (aa + ab) / 2;
    const g = Math.min(ground(rTop, aa), ground(rTop, ab)) - 0.5;
    quadFacing(B.stone, pt(rTop, aa, g), pt(rTop, ab, g), pt(rTop, ab, yTop + 1.2), pt(rTop, aa, yTop + 1.2), F.d(Math.cos(ma), 0, Math.sin(ma)),
      { aSt: [[aa * rTop, g, seed, POLY], [ab * rTop, g, seed, POLY], [ab * rTop, yTop + 1.2, seed, POLY], [aa * rTop, yTop + 1.2, seed, POLY]] });
    quadFacing(B.stone, pt(rTop, aa, yTop + 1.2), pt(rTop, ab, yTop + 1.2), pt(rTop - 0.8, ab, yTop + 1.2), pt(rTop - 0.8, aa, yTop + 1.2), [0, 1, 0],
      { aSt: [[0, 0, seed, DRESSED], [1, 0, seed, DRESSED], [1, 1, seed, DRESSED], [0, 1, seed, DRESSED]] });
    quadFacing(B.stone, pt(rTop - 0.8, aa, yTop - 0.2), pt(rTop - 0.8, ab, yTop - 0.2), pt(rTop - 0.8, ab, yTop + 1.2), pt(rTop - 0.8, aa, yTop + 1.2), F.d(-Math.cos(ma), 0, -Math.sin(ma)),
      { aSt: [[aa * rTop, 0, seed, POLY], [ab * rTop, 0, seed, POLY], [ab * rTop, 1.4, seed, POLY], [aa * rTop, 1.4, seed, POLY]] });
  }
  // skene (stage building) with a columned proskenion facing the orchestra
  const zS = r0 + 5.5;
  const Fs = new Frame(...F.p(0, 0, zS), F.rot + Math.PI);
  const gS = Math.min(ground(zS, Math.PI / 2), yO);
  volume(B, Fs, { cx: 0, cz: 0, hw: 17, hd: 3.5, floorY: yO, h: 8.4, stH: 4.2, groundY: gS, seed, roof: 'gableX', pitch: 15, over: 0.4, style: WIN.ARCH_FRAMED, flags: { front: FLAG.DOOR | FLAG.BANDS, back: FLAG.BANDS, left: FLAG.BLANK, right: FLAG.BLANK }, cornice: true });
  stoneBox(B, Fs, 0, 3.5 + 1.5, 13, 1.5, gS - 1, yO + 0.9, DRESSED, seed, 31);
  for (let i = 0; i <= 10; i++) column(B, Fs, -12.5 + i * 2.5, 6.2, 0.22, 0.19, yO + 0.9, yO + 3.6, 8, seed, MARBLE);
  stoneBox(B, Fs, 0, 6.2, 12.9, 0.35, yO + 3.6, yO + 4.1, MARBLE, seed, 63);
  return { rTop, yTop };
}

/** hillside site for the theatre: the slope fits the cavea profile, orchestra on the downhill side */
export function findTheatreSite(plan, occ, rng, avoid = []) {
  let best = null;
  const r0 = 10, rows = 30, tread = 0.82, riser = 0.42;
  for (let z = plan.z0 + 60; z < plan.z1 - 60; z += 12) for (let x = plan.x0 + 60; x < plan.x1 - 60; x += 12) {
    if (!plan.inMask(x, z, 30)) continue;
    if (avoid.some((a) => Math.hypot(a[0] - x, a[1] - z) < 160)) continue;
    const gx = (plan.Hs.sample(x + 4, z) - plan.Hs.sample(x - 4, z)) / 8, gz = (plan.Hs.sample(x, z + 4) - plan.Hs.sample(x, z - 4)) / 8;
    const sl = Math.hypot(gx, gz);
    if (sl < 0.2 || sl > 0.75) continue;
    const ux = gx / sl, uz = gz / sl; // uphill
    const rot = Math.atan2(-ux, -uz); // local +z = downhill
    if (occ.overlaps(x - ux * 18, z - uz * 18, 38, 24, rot)) continue;
    const F = new Frame(x, 0, z, rot);
    const yO = plan.H.sample(x, z);
    let err = 0, n = 0, ok = true;
    for (let k = 0; k <= rows && ok; k += 6) for (let a = 1.2; a <= 2.0; a += 0.2) {
      const r = r0 + 1.6 + k * tread;
      const [px, , pz] = F.p(Math.cos(a * Math.PI) * r, 0, Math.sin(a * Math.PI) * r);
      if (!plan.inMask(px, pz)) { ok = false; break; }
      const want = yO + 0.5 + k * riser;
      const d = plan.H.sample(px, pz) - want;
      err += d > 0 ? d * d * 2 : d * d; n++;
    }
    if (!ok) continue;
    const e = Math.sqrt(err / n);
    if (!best || e < best.e) best = { e, x, z, rot, yO, ux, uz };
  }
  void rng;
  return best && best.e < 5 ? best : null;
}
