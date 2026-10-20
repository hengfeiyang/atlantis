// Racecourse / hippodrome on land ring 2 (layout RACECOURSE, ref 1 right): an oval arena (sand track
// around a green infield), a central spina with an obelisk, gilded metae and statues, tiers of marble
// seats all round and an arcaded outer facade crowned by a colonnaded gallery. Emitted in a local Frame
// (+X along the course, +Z toward the citadel) into the chunk builders.
import { Frame } from './geobuilder.js';
import { stoneBox, column, wall, quadFacing, triFacing, figure, finial, getRuin, hpos, rubbleStone } from './house.js';
import { goldDome } from './monuments.js';
import { WIN, GROUND, FLAG } from './mats/plaster.js';

const MARBLE = 7, DRESSED = 3, PAVING = 1, TRACK = 11, LAWN = 12, BANDED = 13, BLACK = 14, RED = 10;

/** closed stadium loop at offset d from an arena with straight half length hl and end radius R */
function loop(hl, R, d, step) {
  const pts = [];
  const r = R + d;
  const nS = Math.max(2, Math.ceil((2 * hl) / step));
  const nA = Math.max(6, Math.ceil((Math.PI * r) / step));
  // +z side, walking +x
  for (let i = 0; i < nS; i++) { const x = -hl + (2 * hl * i) / nS; pts.push([x, r, 0, 1]); }
  // +x end: from +z round to -z
  for (let i = 0; i < nA; i++) { const a = Math.PI / 2 - (Math.PI * i) / nA; pts.push([hl + Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]); }
  // -z side walking -x
  for (let i = 0; i < nS; i++) { const x = hl - (2 * hl * i) / nS; pts.push([x, -r, 0, -1]); }
  // -x end
  for (let i = 0; i < nA; i++) { const a = -Math.PI / 2 - (Math.PI * i) / nA; pts.push([-hl + Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]); }
  return pts;
}

/** o = { length, width, floorY, seed, slots } → { hw, hd } local half extents (for footprints) */
export function hippodrome(B, F, o) {
  const { floorY, seed } = o;
  const L = o.length ?? 320, W = o.width ?? 64;
  const R = W / 2, hl = (L - W) / 2;
  const ru = getRuin();
  const nRows = 22, rowD = 0.85, rise = 0.48, podium = 3.2;
  const yA = floorY + 0.05;
  // ---- arena: sand track over the whole oval, lawn infield, base slab
  const fan = (d, kind, y) => {
    const P = loop(hl, R, d, 8);
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      const ca = [Math.max(-hl, Math.min(hl, a[0])), 0], cb = [Math.max(-hl, Math.min(hl, b[0])), 0];
      const q = (x, z) => F.p(x, y, z);
      quadFacing(B.stone, q(ca[0], 0), q(cb[0], 0), q(b[0], b[1]), q(a[0], a[1]), [0, 1, 0],
        { aSt: [[ca[0], 0, seed, kind], [cb[0], 0, seed, kind], [b[0], b[1], seed, kind], [a[0], a[1], seed, kind]] });
    }
  };
  fan(0, TRACK, yA);
  fan(-R + 13, ru ? TRACK : LAWN, yA + 0.04);
  // ---- spina: long marble podium with basins, obelisk, columns with gilded statues, metae
  const sl = hl * 0.9;
  stoneBox(B, F, 0, 0, sl, 2.4, yA - 0.2, yA + 1.5, MARBLE, seed, 31);
  stoneBox(B, F, 0, 0, sl + 0.3, 2.7, yA + 1.5, yA + 1.75, MARBLE, seed, 63);
  {
    // obelisk with a gilded pyramidion
    stoneBox(B, F, 0, 0, 2.0, 2.0, yA + 1.75, yA + 4.0, BLACK, seed, 31);
    const H = ru ? 6 + 6 * hpos(F.x, 1, F.z, 60) : 24;
    for (let k = 0; k < 6; k++) {
      const t0 = k / 6, t1 = (k + 1) / 6;
      const w0 = 1.3 * (1 - 0.35 * t0), w1 = 1.3 * (1 - 0.35 * t1);
      stoneBox(B, F, 0, 0, (w0 + w1) / 2, (w0 + w1) / 2, yA + 4 + H * t0, yA + 4 + H * t1, RED, seed, 15);
    }
    if (!ru) {
      const yT = yA + 4 + H, w = 1.3 * 0.65;
      const G = B.gold;
      if (G) for (const [ax, az, bx, bz] of [[-w, w, w, w], [w, w, w, -w], [w, -w, -w, -w], [-w, -w, -w, w]]) {
        const p0 = F.p(ax, yT, az), p1 = F.p(bx, yT, bz), p2 = F.p(0, yT + 2.2, 0);
        triFacing(G, p0, p1, p2, F.d((ax + bx) / 2, 0.5, (az + bz) / 2));
      }
    } else for (let i = 0; i < 4; i++) rubbleStone(B, F.p(6 + i * 2.2, yA + 0.4, 4 + i * 0.6), 0.9, seed);
  }
  for (const sx of [-1, 1]) {
    // columns with gold statues along the spina
    for (const f of [0.35, 0.65]) {
      const x = sx * sl * f;
      column(B, F, x, 0, 0.55, 0.48, yA + 1.75, yA + 11, 12, seed, MARBLE);
      stoneBox(B, F, x, 0, 0.8, 0.8, yA + 11, yA + 11.5, MARBLE, seed, 63);
      figure(B, F.p(x, yA + 11.5, 0), 3.0, F.rot + (sx > 0 ? Math.PI / 2 : -Math.PI / 2), seed + f, { gold: true });
    }
    // basins with statues (dolphins) between
    stoneBox(B, F, sx * sl * 0.5, 0, 6, 1.9, yA + 1.75, yA + 2.3, DRESSED, seed, 31);
    // metae: three gilded cones on a half-round base at each end
    const xm = sx * (sl + 3.5);
    stoneBox(B, F, xm, 0, 2.2, 3.0, yA - 0.2, yA + 2.0, BANDED, seed, 31);
    if (!ru) for (const mz of [-1.6, 0, 1.6]) {
      const c = F.p(xm, yA + 2.0, mz);
      goldDome(B.gold, c, 0.75, 6.0, 10, 3, 0);
    }
  }
  // ---- podium wall around the arena (red-white banded, gilded crest)
  const P0 = loop(hl, R, 0, 6);
  for (let i = 0; i < P0.length; i++) {
    const a = P0[i], b = P0[(i + 1) % P0.length];
    const u0 = i * 6;
    const A0 = F.p(a[0], yA - 0.3, a[1]), B0 = F.p(b[0], yA - 0.3, b[1]), B1 = F.p(b[0], yA + podium, b[1]), A1 = F.p(a[0], yA + podium, a[1]);
    // faces the arena (inward)
    quadFacing(B.stone, A0, B0, B1, A1, F.d(-(a[2] + b[2]) / 2, 0, -(a[3] + b[3]) / 2), { aSt: [[u0, yA - 0.3, seed, BANDED], [u0 + 6, yA - 0.3, seed, BANDED], [u0 + 6, yA + podium, seed, BANDED], [u0, yA + podium, seed, BANDED]] });
  }
  // ---- tiers of seats
  for (let k = 0; k < nRows; k++) {
    const d0 = k * rowD, d1 = (k + 1) * rowD;
    const y0 = yA + podium + k * rise, y1 = y0 + rise;
    const Pa = loop(hl, R, d0, 5), Pb = loop(hl, R, d1, 5);
    // same parameterisation (same counts only if ends match) → compute per point from Pa with the normal
    for (let i = 0; i < Pa.length; i++) {
      const a = Pa[i], b = Pa[(i + 1) % Pa.length];
      const ao = [a[0] + a[2] * rowD, a[1] + a[3] * rowD], bo = [b[0] + b[2] * rowD, b[1] + b[3] * rowD];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const u = i * seg;
      // broken seats in the sunken era: whole sectors slumped
      let yy0 = y0, yy1 = y1;
      if (ru) { const h = hpos(Math.round(a[0] / 18), k > 12 ? 1 : 0, Math.round(a[1] / 18), 61); if (h < 0.25 && k > 6) continue; if (h < 0.4) { yy1 = y1 - rise * 0.6; } }
      // riser (faces the arena)
      quadFacing(B.stone, F.p(a[0], yy0 - 0.02, a[1]), F.p(b[0], yy0 - 0.02, b[1]), F.p(b[0], yy1, b[1]), F.p(a[0], yy1, a[1]), F.d(-a[2], 0, -a[3]),
        { aSt: [[u, yy0, seed, DRESSED], [u + seg, yy0, seed, DRESSED], [u + seg, yy1, seed, DRESSED], [u, yy1, seed, DRESSED]] });
      // tread
      quadFacing(B.stone, F.p(a[0], yy1, a[1]), F.p(b[0], yy1, b[1]), F.p(bo[0], yy1, bo[1]), F.p(ao[0], yy1, ao[1]), [0, 1, 0],
        { aSt: [[u, 0, seed, MARBLE], [u + seg, 0, seed, MARBLE], [u + seg, rowD, seed, MARBLE], [u, rowD, seed, MARBLE]] });
      if (ru && k % 6 === 3 && hpos(a[0], k, a[1], 62) < 0.15) ru.coral && ru.coral.push({ pos: F.p(a[0], yy1 + 0.05, a[1]), normal: [0, 1, 0], size: 0.9, tag: 'city-seats' });
    }
    void Pb;
  }
  // ---- outer facade: two storeys of arcades, up to the top of the seats + gallery
  const dOut = nRows * rowD;
  const yTopSeats = yA + podium + nRows * rise;
  const Po = loop(hl, R, dOut, 4.5);
  const sty = [seed, (yTopSeats - floorY + 0.6) / 2, WIN.ARCH_FRAMED + 8 * GROUND.ARCADE, FLAG.BANDS];
  let u = 0;
  for (let i = 0; i < Po.length; i++) {
    const a = Po[i], b = Po[(i + 1) % Po.length];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    wall(B, F, a[0], a[1], b[0], b[1], floorY - 1.2, yTopSeats + 0.6, floorY, yTopSeats - floorY + 0.6, sty, u, 1e4);
    u += seg;
  }
  // gallery: colonnade on top of the outer wall with an entablature; banners / statues slots
  if (!ru || true) {
    const Pg = loop(hl, R, dOut - 0.6, 4.5);
    const yG = yTopSeats + 0.6;
    stoneBoxLoop(B, F, Pg, yG - 0.1, yG + 0.25, 0.9, seed, MARBLE);
    for (let i = 0; i < Pg.length; i++) {
      const a = Pg[i];
      column(B, F, a[0], a[1], 0.32, 0.28, yG + 0.25, yG + 4.2, 8, seed, MARBLE);
      if (!ru && i % 8 === 0 && o.slots) o.slots.banner.push({ pos: F.p(a[0] + a[2] * 0.7, yTopSeats - 0.5, a[1] + a[3] * 0.7), facing: ((Math.atan2(F.d(a[2], 0, a[3])[0], -F.d(a[2], 0, a[3])[2]) * 180) / Math.PI + 360) % 360, size: [1.4, 4.0], tag: 'wall city-hippodrome' });
    }
    if (!ru) {
      stoneBoxLoop(B, F, Pg, yG + 4.2, yG + 5.0, 0.7, seed, MARBLE);
      // gilded statues on the gallery cornice every few bays
      for (let i = 0; i < Pg.length; i += 6) {
        const a = Pg[i];
        figure(B, F.p(a[0], yG + 5.0, a[1]), 2.0, F.rot + Math.atan2(a[2], a[3]), seed + i * 0.01, { gold: i % 12 === 0 });
      }
    }
  }
  // ---- grand gate on the citadel side (+z): banded pylons with gold-domed kiosks
  for (const sx of [-1, 1]) {
    const x = sx * 14, z = R + dOut + 2.5;
    stoneBox(B, F, x, z, 4, 4, floorY - 1, yTopSeats + 6, BANDED, seed, 31);
    if (!ru) {
      stoneBox(B, F, x, z, 4.4, 4.4, yTopSeats + 6, yTopSeats + 6.6, MARBLE, seed, 63);
      const t = goldDome(B.gold, F.p(x, yTopSeats + 6.6, z), 3.6, 0.95, 20, 7, 8);
      finial(B, F.p(x, t - 0.05, z), 0.4, seed);
    }
  }
  return { hw: hl + R + dOut + 1.5, hd: R + dOut + 7 };
}

function stoneBoxLoop(B, F, P, y0, y1, w, seed, kind) {
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const ai = [a[0] - a[2] * w, a[1] - a[3] * w], ao = [a[0] + a[2] * w, a[1] + a[3] * w];
    const bi = [b[0] - b[2] * w, b[1] - b[3] * w], bo = [b[0] + b[2] * w, b[1] + b[3] * w];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]), u = i * seg;
    const st = (s, t) => [s, t, seed, kind];
    quadFacing(B.stone, F.p(ao[0], y0, ao[1]), F.p(bo[0], y0, bo[1]), F.p(bo[0], y1, bo[1]), F.p(ao[0], y1, ao[1]), F.d(a[2], 0, a[3]), { aSt: [st(u, y0), st(u + seg, y0), st(u + seg, y1), st(u, y1)] });
    quadFacing(B.stone, F.p(ai[0], y0, ai[1]), F.p(bi[0], y0, bi[1]), F.p(bi[0], y1, bi[1]), F.p(ai[0], y1, ai[1]), F.d(-a[2], 0, -a[3]), { aSt: [st(u, y0), st(u + seg, y0), st(u + seg, y1), st(u, y1)] });
    quadFacing(B.stone, F.p(ai[0], y1, ai[1]), F.p(bi[0], y1, bi[1]), F.p(bo[0], y1, bo[1]), F.p(ao[0], y1, ao[1]), [0, 1, 0], { aSt: [st(u, 0), st(u + seg, 0), st(u + seg, w * 2), st(u, w * 2)] });
  }
}
