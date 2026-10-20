// Ring walls: masonry revetments on the land-ring faces (water → land top) and the metal-clad curtain
// walls on top (white courses with red bands, black plinth, pilasters with gilt capitals, cladding panels
// with gilt frames and medallions, cornice, crenellated parapet, walkway). Built bay by bay along chords
// of the ring circles (bay ≈ 7.5 m, the chord sagitta is < 4 cm), merged into chunked meshes.
import { Frame, chamferBox, box, sweep, lathe, FACES, AUX_ASHLAR, AUX_PAVING, mul3, add3 } from './geo.js';
import { polarXZ, wrap360, shedCovers, BAY, TOWER_HALF } from './plan.js';
import { ruined, ruinRand } from '../world/era.js';
import * as L from '../world/layout.js';

const D2R = Math.PI / 180;
const FRONT = FACES.pz | FACES.px | FACES.nx | FACES.py;
const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** chord frame on circle R from bearing b0 to b1; +d toward the water (side), returns { F, len } */
export function arcFrame(R, b0, b1, side, y = 0, PX = polarXZ) {
  const [x0, z0] = PX(R, b0), [x1, z1] = PX(R, b1);
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ax = [(x1 - x0) / len, 0, (z1 - z0) / len];
  const bm = ((b0 + b1) / 2) * D2R;
  const az = [Math.sin(bm) * side, 0, -Math.cos(bm) * side];
  return { F: new Frame([x0, y, z0], ax, [0, 1, 0], az), len };
}

/** block colour variation */
function tone(rng, k = 0.08) { const v = 1 - k + 2 * k * rng.random(); return [v, v * (0.99 + 0.02 * rng.random()), v * (0.98 + 0.03 * rng.random())]; }

// profiles [d, y] bottom → top
const P_REV_CORNICE = [[0, 0], [0.08, 0.04], [0.08, 0.26], [0.22, 0.4], [0.3, 0.52], [0.36, 0.56], [0.36, 0.75]];
const P_CORNICE = [[0, 0], [0.06, 0], [0.06, 0.12], [0.16, 0.22], [0.26, 0.34], [0.34, 0.4], [0.42, 0.42], [0.42, 0.58], [0.48, 0.62], [0.5, 0.7]];
const P_FILLET = [[0, 0], [0.08, 0.0], [0.12, 0.06], [0.12, 0.2], [0.06, 0.26], [0, 0.26]];

/**
 * Masonry revetment for one bay of an edge, frame at the face radius.
 * opts: { lod, endA, endB, quay } — quay: true → paved quay deck at landY in front of the curtain (citadel)
 */
export function revetBay(ctx, e, b0, b1, opts) {
  const { S, rng } = ctx;
  const { F, len } = arcFrame(e.faceR, b0, b1, e.side, 0, e.polar);
  const mid = F.p(len / 2, 0, 0);
  const lod = opts.lod;
  const yB = e.floor - 1.5, yT = e.landY;
  const topBody = yT - 0.75;
  const setback = Math.abs(e.faceR - e.wallR);
  const W = S.get('white', mid[0], mid[2]);
  // wet / algae zone below the water line
  W.aux = [0.2, 0, 0, AUX_ASHLAR(1.0)];
  W.quadToward(F.p(0, yB, 0), F.p(len, yB, 0), F.p(len, 0.6, 0), F.p(0, 0.6, 0), [0.5, 0.52, 0.46], F.az);
  // rusticated base course
  const yR0 = 0.6, yR1 = Math.min(1.95, topBody);
  if (lod <= 1) {
    const Lm = S.get('lime', mid[0], mid[2]);
    Lm.aux = [0, 0.3, 0, 0];
    let s = -rng.random() * 1.2;
    while (s < len) {
      const l = 1.5 + rng.random() * 1.1, a = Math.max(0, s), b = Math.min(len, s + l);
      if (b - a > 0.2) chamferBox(Lm, F, a + 0.015, b - 0.015, yR0, yR1, -0.4, 0.1 + 0.05 * rng.random(), 0.09, darker(tone(rng, 0.1), 0.92), FRONT, darker(tone(rng), 0.8));
      s += l;
    }
    Lm.aux = [0, 0, 0, 0];
  } else {
    W.aux = [0, 0, 0, AUX_ASHLAR(0.65)];
    W.quadToward(F.p(0, yR0, 0.08), F.p(len, yR0, 0.08), F.p(len, yR1, 0.08), F.p(0, yR1, 0.08), [0.86, 0.84, 0.8], F.az);
  }
  // body courses
  if (topBody > yR1 + 0.05) {
    W.aux = [0, 0, 0.3, AUX_ASHLAR(0.72)];
    W.quadToward(F.p(0, yR1, 0), F.p(len, yR1, 0), F.p(len, topBody, 0), F.p(0, topBody, 0), tone(rng, 0.04), F.az);
    // red band (Plato's polychrome courses) on tall faces
    if (topBody - yR1 > 6) {
      const R = S.get('red', mid[0], mid[2]);
      const yb = topBody - yR1 > 7 ? topBody - 0.95 : yR1 + (topBody - yR1) * 0.58;
      R.aux = [0, 0.2, 0, AUX_ASHLAR(0.72)];
      box(R, F, 0, len, yb, yb + 0.72, -0.2, 0.03, tone(rng, 0.05), FACES.pz | FACES.py | FACES.ny);
      R.aux = [0, 0, 0, 0];
    }
    // blind arcade: an arched panel of red (land ring 2) / black (land ring 1) stone in every bay, framed by
    // projecting jambs and a voussoir ring with a gilt keystone (refs 1, 2: arcaded quay walls)
    if (topBody - yR1 > 7 && len > 5.5 && !opts.noArcade) {
      const aw = Math.min(4.2, len - 2.6), ar = aw / 2;
      const ya = yR1 + 0.5, yc = topBody - 1.6, ysA = yc - ar;
      const sc = len / 2;
      const back = S.get(e.ring === 'l2' ? 'red' : 'black', mid[0], mid[2]);
      back.aux = [0.3, 0, 0, AUX_ASHLAR(0.6)];
      back.quadToward(F.p(sc - ar, ya, 0.012), F.p(sc + ar, ya, 0.012), F.p(sc + ar, ysA, 0.012), F.p(sc - ar, ysA, 0.012), [0.85, 0.85, 0.85], F.az);
      const na = lod === 0 ? 10 : 6;
      for (let i = 0; i < na; i++) {
        const a0 = (Math.PI * i) / na, a1 = (Math.PI * (i + 1)) / na;
        back.polyToward([F.p(sc, ysA, 0.012), F.p(sc + Math.cos(a0) * ar, ysA + Math.sin(a0) * ar, 0.012), F.p(sc + Math.cos(a1) * ar, ysA + Math.sin(a1) * ar, 0.012)], [0.85, 0.85, 0.85], F.az);
      }
      back.aux = [0, 0, 0, 0];
      if (lod <= 1) {
        W.aux = [0, 0.4, 0, 0];
        box(W, F, sc - ar - 0.42, sc - ar, ya - 0.2, ysA, 0, 0.16, tone(rng, 0.04), FACES.pz | FACES.px | FACES.nx | FACES.py);
        box(W, F, sc + ar, sc + ar + 0.42, ya - 0.2, ysA, 0, 0.16, tone(rng, 0.04), FACES.pz | FACES.px | FACES.nx | FACES.py);
        box(W, F, sc - ar - 0.6, sc + ar + 0.6, ya - 0.45, ya - 0.2, 0, 0.22, tone(rng, 0.04), FACES.pz | FACES.py | FACES.px | FACES.nx);
        const nv = lod === 0 ? 11 : 7, ring = 0.42;
        for (let i = 0; i < nv; i++) {
          const a0 = Math.PI - (Math.PI * i) / nv, a1 = Math.PI - (Math.PI * (i + 1)) / nv;
          const key = i === (nv - 1) / 2;
          const B = key ? S.get('gilt', mid[0], mid[2]) : W;
          const R1 = ar + ring * (key ? 1.4 : 1), dF = key ? 0.24 : 0.16;
          const P = (a, rr, d) => F.p(sc + Math.cos(a) * rr, ysA + Math.sin(a) * rr, d);
          const c = key ? [1, 1, 1] : tone(rng, 0.04);
          const ctr = F.p(sc, ysA, -0.5);
          B.quadOut(P(a0, ar, dF), P(a1, ar, dF), P(a1, R1, dF), P(a0, R1, dF), c, ctr);
          B.quadOut(P(a0, R1, dF), P(a1, R1, dF), P(a1, R1, 0), P(a0, R1, 0), c, ctr);
          B.quadOut(P(a0, ar, 0), P(a1, ar, 0), P(a1, ar, dF), P(a0, ar, dF), darker(c, 0.85), F.p(sc, ysA, 0.5));
        }
        W.aux = [0, 0, 0, 0];
      }
    }
    // flat pilaster strip at the bay start (aligned with the curtain pilasters / towers above)
    if (lod <= 1) {
      W.aux = [0, 0.3, 0, AUX_ASHLAR(0.72)];
      chamferBox(W, F, -0.6, 0.6, yR1, topBody, -0.2, 0.22, lod === 0 ? 0.04 : 0, tone(rng, 0.05), FACES.pz | FACES.px | FACES.nx);
    }
  }
  // cornice / string course at the land top
  W.aux = [0, 0.2, 0, 0];
  sweep(W, F, 0, len, P_REV_CORNICE.map(([d, y]) => [d, y + topBody]), tone(rng, 0.03), false);
  // cap: ledge between the cornice and the curtain (quay deck on the citadel)
  const P = opts.quay ? S.get('paving', mid[0], mid[2]) : W;
  P.aux = [0, 0, 0, AUX_PAVING(1.3)];
  P.quadToward(F.p(0, yT + 0.01, 0.36), F.p(len, yT + 0.01, 0.36), F.p(len, yT + 0.01, -setback - 0.05), F.p(0, yT + 0.01, -setback - 0.05), opts.quay ? tone(rng, 0.04) : [0.9, 0.88, 0.85], [0, 1, 0]);
  P.aux = [0, 0, 0, 0];
  // stretch ends: close the side
  W.aux = [0, 0, 0, AUX_ASHLAR(0.72)];
  if (opts.endA) W.quadToward(F.p(0, yB, -4.5), F.p(0, yB, 0.36), F.p(0, yT, 0.36), F.p(0, yT, -4.5), [0.92, 0.9, 0.87], mul3(F.ax, -1));
  if (opts.endB) W.quadToward(F.p(len, yB, -4.5), F.p(len, yB, 0.36), F.p(len, yT, 0.36), F.p(len, yT, -4.5), [0.92, 0.9, 0.87], F.ax);
  W.aux = [0, 0, 0, 0];
  // bollards on the quay deck (citadel)
  if (opts.quay && lod <= 1) {
    const Bk = S.get('black', mid[0], mid[2]);
    lathe(Bk, F, len * 0.5, yT, -1.0, [[0.0, 0], [0.32, 0], [0.32, 0.12], [0.24, 0.2], [0.22, 0.62], [0.32, 0.72], [0.3, 0.82], [0.0, 0.86]], 8, [0.9, 0.9, 0.9]);
  }
  if (ctx.sunken) ctx.slots.coral.push({ pos: F.p(len * rng.random(), yT + 0.05, 0.1), normal: [0, 1, 0], size: 1.2, tag: 'rings-revet' });
}

/**
 * Curtain wall bay. frame at the curtain face radius; +d toward the water.
 * opts: { lod, endA, endB, k (bay index), ruin }
 */
export function curtainBay(ctx, e, b0, b1, opts) {
  const { S, rng } = ctx;
  const { F, len } = arcFrame(e.wallR, b0, b1, e.side, 0, e.polar);
  const mid = F.p(len / 2, 0, 0);
  const lod = opts.lod;
  const y0 = e.landY, H = e.wallH, T = 3.2;
  // styles: 'tin' (land ring 1, ref 4: full-height tin cladding, gold strips, gilt balustrade on top),
  // 'ori' (citadel: full orichalcum cladding, merlons), 'bronze' (land ring 2: white courses + red bands below,
  // bronze cladding above, merlons)
  const style = e.cladding === 'tin' ? 'tin' : e.cladding === 'orichalcum' ? 'ori' : 'bronze';
  const full = style !== 'bronze';
  const yP = y0 + 1.1, yC = full ? y0 + 1.75 : y0 + 0.5 * H, yK = y0 + H - 2.7, yW = yK + 0.7, yTop = y0 + H;
  const metal = e.cladding;
  const hasBanner = !ctx.sunken && opts.k % 3 === 1 && !opts.nearTower;
  const W = S.get('white', mid[0], mid[2]);
  const label = `rings:${e.id}:${opts.k}`;
  // sunken: collapsed bays (runs along the wall), missing merlons / panels
  let yRuin = Infinity;
  if (ctx.sunken) {
    const n = Math.sin(opts.k * 0.37 + e.r) * 0.5 + Math.sin(opts.k * 0.11 + 2.0 + e.r * 0.3) * 0.5;
    if (n > 0.55 || ruined(label + ':collapse', 0.06)) yRuin = y0 + H * (0.25 + 0.4 * ruinRand(label, 1));
    // r5 (shot 8): the shed-mole curtain's end bays (its land-side end cap stood as a plain 12 m slab behind the head)
    if (e.ring === 'mole' && (opts.endA || opts.endB)) yRuin = Math.min(yRuin, y0 + H * (0.18 + 0.15 * ruinRand(label, 3)));
  }
  const cut = (y) => Math.min(y, yRuin);
  // plinth (black stone)
  const Bk = S.get('black', mid[0], mid[2]);
  Bk.aux = [0, 0.4, 0, AUX_ASHLAR(0.55)];
  chamferBox(Bk, F, 0, len, y0 - 0.6, yP, -0.1, 0.3, lod <= 1 ? 0.06 : 0, tone(rng, 0.05), FACES.pz | FACES.py);
  Bk.aux = [0, 0, 0, 0];
  // body courses (lower half)
  W.aux = [0, 0, 0.2, AUX_ASHLAR(0.62)];
  W.quadToward(F.p(0, yP, 0), F.p(len, yP, 0), F.p(len, cut(yC), 0), F.p(0, cut(yC), 0), tone(rng, 0.035), F.az);
  // red bands
  const R = S.get('red', mid[0], mid[2]);
  R.aux = [0, 0.2, 0, AUX_ASHLAR(0.62)];
  if (!full) for (const yb of [yP + 1.24, yC - 1.6]) if (yb + 0.62 < yRuin) box(R, F, 0, len, yb, yb + 0.62, -0.1, 0.025, tone(rng, 0.05), FACES.pz | FACES.py | FACES.ny);
  R.aux = [0, 0, 0, 0];
  // land-side face
  W.aux = [0, 0, 0, AUX_ASHLAR(0.62)];
  // r5 (ref 8): sunken land-ring curtains show their land side as a ruined blind arcade (the shot-8 background, 45 m)
  if (ctx.sunken && lod <= 1 && style !== 'ori' && len > 5) landArcade(ctx, W, F, len, y0, yW + 0.9, T, yRuin, label, e);
  else W.quadToward(F.p(0, y0 - 0.5, -T), F.p(len, y0 - 0.5, -T), F.p(len, cut(yW + 0.9), -T), F.p(0, cut(yW + 0.9), -T), [0.93, 0.91, 0.88], mul3(F.az, -1));
  W.aux = [0, 0, 0, AUX_ASHLAR(0.62)];
  if (opts.endA) W.quadToward(F.p(0, y0 - 0.5, -T), F.p(0, y0 - 0.5, 0.05), F.p(0, cut(yTop), 0.05), F.p(0, cut(yTop), -T), [0.9, 0.88, 0.85], mul3(F.ax, -1));
  if (opts.endB) W.quadToward(F.p(len, y0 - 0.5, -T), F.p(len, y0 - 0.5, 0.05), F.p(len, cut(yTop), 0.05), F.p(len, cut(yTop), -T), [0.9, 0.88, 0.85], F.ax);
  if (yRuin < Infinity) {
    const apron = e.side * (e.wallR - e.side * T - e.rimR) + 0.6;
    if (apron > 0.7) S.get('paving', mid[0], mid[2]).quadToward(F.p(0, y0 + 0.02, -T + 0.05), F.p(len, y0 + 0.02, -T + 0.05), F.p(len, y0 + 0.02, -T - apron), F.p(0, y0 + 0.02, -T - apron), [0.8, 0.78, 0.75], [0, 1, 0]);
    ruinTop(ctx, F, len, yRuin, T, label, e); return;
  }

  // gilt fillet under the cladding
  const G = S.get('gilt', mid[0], mid[2]);
  sweep(G, F, 0, len, P_FILLET.map(([d, y]) => [d, y + yC - 0.13]), [1, 1, 1], false);
  // cladding panel between the pilasters (+ white backing where a sunken panel has fallen)
  const pw = 0.65, cy0 = yC + 0.13, cy1 = yK - (style === 'ori' ? 1.05 : 0.15);
  const Mt = S.get(metal, mid[0], mid[2]);
  const lost = ctx.sunken && ruined(label + ':panel', 0.3);
  // r2 (refs 1, 4, 5): the citadel SHORE wall reads white marble with gilt frames + banners; the red orichalcum
  // is a frieze band under the cornice here (the red tiers are the terrace ramparts higher up the hill)
  const marblePanel = style === 'ori';
  const Pn = marblePanel ? W : Mt;
  if (marblePanel) W.aux = [0, 0, 0.1, 0];
  if (!lost) Pn.quadToward(F.p(pw, cy0, 0.015), F.p(len - pw, cy0, 0.015), F.p(len - pw, cy1, 0.015), F.p(pw, cy1, 0.015), marblePanel ? [1, 0.99, 0.97] : [1, 1, 1], F.az);
  if (marblePanel) box(Mt, F, 0, len, cy1 + 0.2, yK - 0.12, -0.02, 0.05, [1, 1, 1], FACES.pz | FACES.py | FACES.ny);
  else { W.aux = [0.3, 0, 0, AUX_ASHLAR(0.62)]; W.quadToward(F.p(0, cy0, -0.02), F.p(len, cy0, -0.02), F.p(len, cy1, -0.02), F.p(0, cy1, -0.02), [0.8, 0.78, 0.74], F.az); W.aux = [0, 0, 0, 0]; }
  W.aux = [0, 0, 0, AUX_ASHLAR(0.62)];
  W.quadToward(F.p(0, cy1, 0), F.p(len, cy1, 0), F.p(len, yK, 0), F.p(0, yK, 0), tone(rng, 0.03), F.az);
  if (lod <= 1 && !lost) {
    // gilt frame around the panel
    const fw = 0.13;
    box(G, F, pw, len - pw, cy0, cy0 + fw, 0.0, 0.06, [1, 1, 1], FACES.pz | FACES.py);
    box(G, F, pw, len - pw, cy1 - fw, cy1, 0.0, 0.06, [1, 1, 1], FACES.pz | FACES.ny);
    box(G, F, pw, pw + fw, cy0 + fw, cy1 - fw, 0.0, 0.06, [1, 1, 1], FACES.pz | FACES.nx);
    box(G, F, len - pw - fw, len - pw, cy0 + fw, cy1 - fw, 0.0, 0.06, [1, 1, 1], FACES.pz | FACES.px);
    // medallion (gold rosette) in the panel centre
    if ((lod === 0 || opts.k % 2 === 0) && !hasBanner) {
      const Fm = new Frame(F.p(len / 2, (cy0 + cy1) / 2, 0.015), F.ax, F.az, mul3(F.ay, -1));
      const Gd = S.get('gold', mid[0], mid[2]);
      lathe(Gd, Fm, 0, 0, 0, [[0.7, 0], [0.68, 0.05], [0.58, 0.1], [0.42, 0.12], [0.3, 0.09], [0.18, 0.15], [0, 0.16]], lod === 0 ? 20 : 10, [1, 1, 1]);
    }
  }
  // pilaster at the bay start (and at the stretch end)
  const pil = (s) => {
    if (style === 'tin') {
      // gold strip with a stud column instead of a marble pilaster (ref 4)
      chamferBox(G, F, s - 0.16, s + 0.16, yP, yK, -0.05, 0.09, lod <= 1 ? 0.02 : 0, [1, 1, 1], FACES.pz | FACES.px | FACES.nx);
      if (lod <= 1) {
        const Gd = S.get('gold', mid[0], mid[2]);
        lathe(Gd, F, s, yTop - 0.95, -0.3, [[0, 0], [0.22, 0], [0.24, 0.1], [0.14, 0.18], [0.2, 0.4], [0.08, 0.62], [0.03, 0.95], [0, 1.0]], 8, [1, 1, 1]);
      }
      return;
    }
    W.aux = [0, 0.4, 0, AUX_ASHLAR(0.62)];
    chamferBox(W, F, s - pw, s + pw, yP, yK - 0.45, -0.05, 0.36, lod <= 1 ? 0.05 : 0, tone(rng, 0.04), FACES.pz | FACES.px | FACES.nx);
    W.aux = [0, 0, 0, 0];
    chamferBox(G, F, s - pw - 0.1, s + pw + 0.1, yK - 0.45, yK, -0.05, 0.46, lod <= 1 ? 0.03 : 0, [1, 1, 1], FACES.pz | FACES.px | FACES.nx | FACES.ny);
    // gold pinnacle finial on the parapet above the pilaster
    if (lod <= 1) {
      const Gd = S.get('gold', mid[0], mid[2]);
      lathe(Gd, F, s, yTop, -0.3, [[0, 0], [0.28, 0], [0.3, 0.12], [0.18, 0.2], [0.24, 0.42], [0.1, 0.62], [0.04, 0.95], [0, 1.05]], 8, [1, 1, 1]);
    }
  };
  pil(0);
  if (opts.endB) pil(len);
  // cornice
  W.aux = [0, 0.25, 0, 0];
  sweep(W, F, 0, len, P_CORNICE.map(([d, y]) => [d, y + yK]), tone(rng, 0.03), !!(opts.endA || opts.endB));
  // walkway paving
  const Pv = S.get('paving', mid[0], mid[2]);
  const apron = e.side * (e.wallR - e.side * T - e.rimR) + 0.6;
  if (apron > 0.7) {
    Pv.aux = [0, 0, 0, AUX_PAVING(1.4)];
    Pv.quadToward(F.p(0, y0 + 0.02, -T + 0.05), F.p(len, y0 + 0.02, -T + 0.05), F.p(len, y0 + 0.02, -T - apron), F.p(0, y0 + 0.02, -T - apron), [0.9, 0.88, 0.85], [0, 1, 0]);
  }
  Pv.aux = [0, 0, 0, AUX_PAVING(1.2)];
  Pv.quadToward(F.p(0, yW, -0.6), F.p(len, yW, -0.6), F.p(len, yW, -T + 0.5), F.p(0, yW, -T + 0.5), [0.92, 0.9, 0.87], [0, 1, 0]);
  Pv.aux = [0, 0, 0, 0];
  // parapets: water-side breast + merlons, land-side low wall
  W.aux = [0, 0.3, 0, AUX_ASHLAR(0.48)];
  // spout notches (water module cascades pour through the citadel parapet): [s0, s1] intervals in this bay
  const notches = [];
  for (const sp of e.spouts || []) {
    const sa = ((sp.bearing - b0) / (b1 - b0)) * len, hwS = sp.width / 2 + 0.4;
    if (sa + hwS > 0 && sa - hwS < len) notches.push([Math.max(0, sa - hwS), Math.min(len, sa + hwS)]);
  }
  let segs = [[0, len]];
  for (const [n0, n1] of notches) segs = segs.flatMap(([a, b]) => (n1 <= a || n0 >= b ? [[a, b]] : [[a, n0], [n1, b]].filter(([p, q]) => q - p > 0.05)));
  if (style === 'tin') {
    // low plinth + gilt balustrade (posts and rail)
    for (const [a, b] of segs) box(W, F, a, b, yW, yW + 0.3, -0.6, 0.02, tone(rng, 0.03), FACES.pz | FACES.py | FACES.nz | FACES.px | FACES.nx);
    const nP = Math.max(3, Math.round(len / 0.9));
    for (let i = 0; i < nP; i++) {
      const sc = (i + 0.5) * (len / nP);
      if (notches.some(([n0, n1]) => sc > n0 && sc < n1)) continue;
      if (ctx.sunken && ruined(`${label}:p${i}`, 0.5)) continue;
      if (lod <= 1) lathe(G, F, sc, yW + 0.3, -0.3, [[0, 0], [0.09, 0], [0.1, 0.08], [0.06, 0.2], [0.09, 0.45], [0.05, 0.7], [0.07, 0.78], [0, 0.8]], 6, [1, 1, 1]);
      else box(G, F, sc - 0.06, sc + 0.06, yW + 0.3, yW + 1.1, -0.36, -0.24, [1, 1, 1], FACES.pz | FACES.px | FACES.nx | FACES.nz);
    }
    if (!ctx.sunken) box(G, F, 0, len, yW + 1.1, yW + 1.24, -0.42, -0.18, [1, 1, 1], FACES.pz | FACES.py | FACES.nz | FACES.ny);
  } else {
    // r2: white marble balustrade (plinth, balusters, rail) instead of crenellations (refs 1, 2, 4)
    for (const [a, b] of segs) box(W, F, a, b, yW, yW + 0.3, -0.6, 0.02, tone(rng, 0.03), FACES.pz | FACES.py | FACES.nz | FACES.px | FACES.nx);
    if (lod <= 1) {
      const nP = Math.max(3, Math.round(len / (lod === 0 ? 0.55 : 0.9)));
      for (let i = 0; i < nP; i++) {
        const sc = (i + 0.5) * (len / nP);
        if (notches.some(([n0, n1]) => sc > n0 && sc < n1)) continue;
        if (ctx.sunken && ruined(`${label}:p${i}`, 0.5)) continue;
        if (lod === 0) lathe(W, F, sc, yW + 0.3, -0.3, [[0, 0], [0.13, 0], [0.14, 0.08], [0.08, 0.2], [0.13, 0.45], [0.07, 0.72], [0.1, 0.8], [0, 0.82]], 6, [0.96, 0.95, 0.93]);
        else box(W, F, sc - 0.09, sc + 0.09, yW + 0.3, yW + 1.12, -0.39, -0.21, [0.95, 0.94, 0.92], FACES.pz | FACES.px | FACES.nx | FACES.nz);
      }
    } else for (const [a, b] of segs) W.quadToward(F.p(a, yW + 0.3, -0.3), F.p(b, yW + 0.3, -0.3), F.p(b, yW + 1.12, -0.3), F.p(a, yW + 1.12, -0.3), [0.8, 0.79, 0.76], F.az);
    if (!ctx.sunken || !ruined(label + ':rail', 0.5)) for (const [a, b] of segs) box(W, F, a, b, yW + 1.12, yW + 1.32, -0.48, -0.12, tone(rng, 0.03), FACES.pz | FACES.py | FACES.nz | FACES.ny | FACES.px | FACES.nx);
  }
  box(W, F, 0, len, yW - 0.1, yW + 0.9, -T, -T + 0.5, tone(rng, 0.03), FACES.pz | FACES.py);
  const nM = 0;   // r2: merlons removed (balustrade above)
  const mw = 1.0, step = len / Math.max(1, nM);
  for (let i = 0; i < nM; i++) {
    const sc = (i + 0.5) * step;
    if (Math.abs(sc) < 0.8) continue;
    if (notches.some(([n0, n1]) => sc + mw / 2 > n0 && sc - mw / 2 < n1)) continue;
    if (ctx.sunken && ruined(`${label}:m${i}`, 0.45)) continue;
    chamferBox(W, F, sc - mw / 2, sc + mw / 2, yW + 0.95, yTop, -0.6, 0.02, lod <= 1 ? 0.04 : 0, tone(rng, 0.05), FACES.pz | FACES.py | FACES.px | FACES.nx | FACES.nz);
  }
  W.aux = [0, 0, 0, 0];
  // banner slots on every third pilaster (hung below the capital)
  if (hasBanner) {
    ctx.slots.banner.push({ pos: F.p(len / 2, cy1 - 0.25, 0.12), facing: e.facingAt(b0 * 0.5 + b1 * 0.5), size: [1.8, Math.min(6.5, (cy1 - cy0) * 0.85)], tag: 'rings-wall' });
  }
  if (ctx.sunken) ctx.slots.coral.push({ pos: F.p(len * 0.5, yW + 0.05, -1.6), normal: [0, 1, 0], size: 1.4, tag: 'rings-walltop' });
}

/** broken top of a collapsed curtain bay + rubble at its foot (sunken) */
function ruinTop(ctx, F, len, yR, T, label, e) {
  const { S } = ctx;
  const mid = F.p(len / 2, 0, 0);
  const W = S.get('white', mid[0], mid[2]);
  W.aux = [0.2, 0.5, 0, AUX_ASHLAR(0.62)];
  let s = 0, i = 0;
  while (s < len - 0.1) {
    const l = Math.min(len - s, 0.9 + 1.4 * ruinRand(label + ':j' + i, 0));
    const h = yR - 0.4 + 1.8 * ruinRand(label + ':j' + i, 1) - 1.2 * Math.abs(Math.sin((s / len) * 3.1 + i));
    chamferBox(W, F, s, s + l, h - 0.8, h, -T + 0.2, 0.0, 0.12, [0.82, 0.8, 0.76]);
    s += l; i++;
  }
  // rubble at the foot (both sides)
  for (let k = 0; k < 7; k++) {
    const r = (q) => ruinRand(label + ':r' + k, q);
    const side = r(0) < 0.5 ? 1 : -1;
    const d = side > 0 ? 1.5 + r(1) * 5 : -T - 1.5 - r(1) * 4;
    const sc = r(2) * len;
    const yy = e.landY + (side > 0 && Math.abs(e.faceR - e.wallR) < 1.5 ? e.floor - e.landY + 6 : 0);
    const Fr = F.at(sc, yy, d).yawed(r(3) * 3).tilted(r(4) * 0.5 - 0.25, r(5) * 0.5 - 0.25);
    const bw = 0.6 + r(6) * 1.0;
    chamferBox(W, Fr, -bw, bw, 0, 0.5 + r(7) * 0.6, -0.4 - r(8) * 0.5, 0.4 + r(8) * 0.5, 0.1, [0.78, 0.76, 0.72]);
    if (k % 2 === 0) ctx.slots.coral.push({ pos: Fr.p(0, 1.0, 0), normal: [0, 1, 0], size: 1.0, tag: 'rings-rubble' });
  }
  W.aux = [0, 0, 0, 0];
}

/**
 * r5 (ref 8 background): land-side face of a sunken curtain bay as a blind arcade — one tall arched recess (1.1 m deep,
 * dark back) between square piers with impost blocks, a keystone and a crowning cornice band. A collapsed bay (yRuin)
 * keeps its piers / jambs up to the break and loses the arch head, so runs of bays read as broken arcades.
 */
function landArcade(ctx, W, F, len, y0, yT, T, yRuin, label, e) {
  const PI = Math.PI;
  const pw = Math.min(1.3, len * 0.17), s0 = pw, s1 = len - pw, r = (s1 - s0) / 2, sc = (s0 + s1) / 2;
  const D = 1.1, dF = -T, dB = -T + D;
  const ySp = y0 + Math.min(6.4, Math.max(2.5, (yT - y0) - r - 2.4)), yCr = ySp + r;
  const cut = (y) => Math.min(y, yRuin);
  const nIn = mul3(F.az, -1), toward = (cs, sn) => add3(mul3(F.ax, cs), mul3(F.ay, sn));
  const col = [0.93, 0.91, 0.88], colJ = [0.74, 0.73, 0.7], colB = [0.5, 0.5, 0.49];
  const yTop = cut(yT);
  // piers (land face)
  for (const [a, b] of [[0, s0], [s1, len]]) W.quadToward(F.p(a, y0 - 0.5, dF), F.p(b, y0 - 0.5, dF), F.p(b, yTop, dF), F.p(a, yTop, dF), col, nIn);
  // jambs + recess back up to the springing (or the break)
  const yJ = cut(ySp);
  W.quadToward(F.p(s0, y0 - 0.5, dF), F.p(s0, y0 - 0.5, dB), F.p(s0, yJ, dB), F.p(s0, yJ, dF), colJ, F.ax);
  W.quadToward(F.p(s1, y0 - 0.5, dF), F.p(s1, y0 - 0.5, dB), F.p(s1, yJ, dB), F.p(s1, yJ, dF), colJ, mul3(F.ax, -1));
  W.quadToward(F.p(s0, y0 - 0.5, dB), F.p(s1, y0 - 0.5, dB), F.p(s1, yJ, dB), F.p(s0, yJ, dB), colB, nIn);
  W.quadToward(F.p(s0, y0 + 0.03, dF), F.p(s1, y0 + 0.03, dF), F.p(s1, y0 + 0.03, dB), F.p(s0, y0 + 0.03, dB), colJ, [0, 1, 0]);
  // impost blocks on the piers (coral ledges)
  for (const [a, b, sd] of [[0, s0 + 0.18, 1], [s1 - 0.18, len, -1]]) {
    if (ySp > yRuin - 0.1) break;
    box(W, F, a, b, ySp - 0.42, ySp, dF - 0.24, dF + 0.02, [0.86, 0.85, 0.82], FACES.nz | FACES.py | FACES.ny | (sd > 0 ? FACES.px : FACES.nx));
    if (ruinRand(label + ':imp' + sd, 0) < 0.55) ctx.slots.coral.push({ pos: F.p((a + b) / 2, ySp + 0.02, dF - 0.1), normal: [0, 1, 0], size: 0.7 + 0.6 * ruinRand(label + ':imp' + sd, 1), tag: 'rings-arcade' });
  }
  if (yRuin > yCr + 0.8) {
    // arch head: recess back, soffit, spandrel on the face, keystone
    const n = 12;
    const P = (a) => [sc - Math.cos(a) * r, ySp + Math.sin(a) * r];
    for (let i = 0; i < n; i++) {
      const a0 = (PI * i) / n, a1 = (PI * (i + 1)) / n, am = (a0 + a1) / 2;
      const [u0, v0] = P(a0), [u1, v1] = P(a1);
      W.quadToward(F.p(u0, ySp, dB), F.p(u1, ySp, dB), F.p(u1, v1, dB), F.p(u0, v0, dB), colB, nIn);
      W.quadToward(F.p(u0, v0, dF), F.p(u1, v1, dF), F.p(u1, v1, dB), F.p(u0, v0, dB), colJ, toward(Math.cos(am), -Math.sin(am)));
      W.quadToward(F.p(u0, v0, dF), F.p(u1, v1, dF), F.p(u1, yTop, dF), F.p(u0, yTop, dF), col, nIn);
    }
    box(W, F, sc - 0.38, sc + 0.38, yCr - 0.25, yCr + 0.95, dF - 0.2, dF + 0.02, [0.88, 0.87, 0.84], FACES.nz | FACES.px | FACES.nx | FACES.py | FACES.ny);
    // crowning band under the walkway parapet
    if (yT - yCr > 1.6) {
      box(W, F, 0, len, yT - 1.0, yT - 0.62, dF - 0.3, dF + 0.02, [0.86, 0.85, 0.82], FACES.nz | FACES.py | FACES.ny);
      if (ruinRand(label + ':band', 0) < 0.6) ctx.slots.coral.push({ pos: F.p(len * (0.2 + 0.6 * ruinRand(label + ':band', 1)), yT - 0.6, dF - 0.15), normal: [0, 1, 0], size: 0.6 + 0.5 * ruinRand(label + ':band', 2), tag: 'rings-arcade' });
    }
  } else if (yRuin > ySp) {
    // broken arch: the recess goes up to the break, open above the springing
    W.quadToward(F.p(s0, ySp, dB), F.p(s1, ySp, dB), F.p(s1, yRuin, dB), F.p(s0, yRuin, dB), colB, nIn);
    W.quadToward(F.p(s0, ySp, dF), F.p(s0, ySp, dB), F.p(s0, yRuin, dB), F.p(s0, yRuin, dF), colJ, F.ax);
    W.quadToward(F.p(s1, ySp, dF), F.p(s1, ySp, dB), F.p(s1, yRuin, dB), F.p(s1, yRuin, dF), colJ, mul3(F.ax, -1));
  }
  void e;
}

/** all revetments + curtains of one edge; returns { bays, len } */
export function buildEdge(ctx, e) {
  let bays = 0, length = 0;
  const towerBearings = ctx.plan.towers.filter((t) => t.edge === e.id).map((t) => t.bearing);
  e.facingAt = (b) => wrap360(b + (e.side > 0 ? 0 : 180));
  for (const st of e.stretches) {
    const arc = (st.b1 - st.b0) * D2R * e.wallR;
    const n = Math.max(1, Math.round(arc / BAY));
    const db = (st.b1 - st.b0) / n;
    for (let k = 0; k < n; k++) {
      const b0 = st.b0 + k * db, b1 = b0 + db, bm = (b0 + b1) / 2;
      const [mx, mz] = (e.polar || polarXZ)(e.wallR, bm);
      const lod = ctx.lodAt(mx, mz);
      const endA = !st.closed && k === 0, endB = !st.closed && k === n - 1;
      const kk = Math.round(wrap360(b0) / db);
      // revetment (not where ship-sheds or the canal tunnel portals take over)
      const tunnel = e.ring === 'l1' && Math.abs(mx) < ctx.plan.tunnel.halfWidth + 1.5 && mz > 0;
      const hidden = e.hidden && e.hidden.some(([a, b]) => bm > a && bm < b);
      if (!shedCovers(e, b0, b1) && !tunnel && !hidden) revetBay(ctx, e, b0, b1, { lod, endA, endB, quay: e.id === 'citadel' || e.id === 'outer' });
      if (e.curtain) {
        const nearTower = towerBearings.some((tb) => Math.abs(((tb - bm + 540) % 360) - 180) * D2R * e.wallR < TOWER_HALF + 3);
        // clip the bay out of garden bastions (solid blocks built separately)
        let pieces = [[b0, b1, endA, endB]];
        for (const bs of e.bastions || []) {
          pieces = pieces.flatMap(([a, b, ea, eb]) => {
            if (b <= bs.b0 || a >= bs.b1) return [[a, b, ea, eb]];
            const out = [];
            if (bs.b0 - a > 0.02) out.push([a, bs.b0, ea, true]);
            if (b - bs.b1 > 0.02) out.push([bs.b1, b, true, eb]);
            return out;
          });
        }
        for (const [a, b, ea, eb] of pieces) curtainBay(ctx, e, a, b, { lod, endA: ea, endB: eb, k: kk, nearTower: nearTower || pieces.length > 1 || a !== b0 || b !== b1 });
        // footprint so the city / vegetation keep clear
        const { F, len } = arcFrame(e.wallR, b0, b1, e.side, 0, e.polar);
        const c = F.p(len / 2, 0, -1.6);
        ctx.engine.footprints.addRect(c[0], c[2], len / 2 + 0.2, 3.2, Math.atan2(-F.ax[2], F.ax[0]), 'rings-wall');
      } else {
        balustradeBay(ctx, e, b0, b1, { lod, k: kk });
      }
      bays++; length += db * D2R * e.wallR;
    }
  }
  return { bays, length };
}

/** low quay balustrade (outer-city shore) */
function balustradeBay(ctx, e, b0, b1, opts) {
  const { S, rng } = ctx;
  const { F, len } = arcFrame(e.wallR, b0, b1, e.side, 0, e.polar);
  const mid = F.p(len / 2, 0, 0);
  const W = S.get('white', mid[0], mid[2]);
  const y = e.landY;
  W.aux = [0, 0.3, 0, 0];
  chamferBox(W, F, 0, 0.55, y, y + 1.2, -0.55, 0, 0.04, tone(rng, 0.04));
  box(W, F, 0, len, y + 0.95, y + 1.12, -0.5, 0.05, tone(rng, 0.03), FACES.pz | FACES.py | FACES.nz | FACES.ny);
  box(W, F, 0, len, y, y + 0.18, -0.48, 0.0, tone(rng, 0.03), FACES.pz | FACES.py | FACES.nz);
  if (opts.lod <= 1) {
    const nB = Math.floor(len / 0.42);
    for (let i = 1; i < nB; i++) lathe(W, F, i * (len / nB), y + 0.18, -0.24, [[0.0, 0], [0.11, 0], [0.12, 0.08], [0.08, 0.18], [0.12, 0.42], [0.06, 0.66], [0.09, 0.77], [0.0, 0.77]], 6, [0.95, 0.94, 0.92]);
  } else {
    W.quadToward(F.p(0, y + 0.18, -0.2), F.p(len, y + 0.18, -0.2), F.p(len, y + 0.95, -0.2), F.p(0, y + 0.95, -0.2), [0.8, 0.79, 0.76], F.az);
  }
  W.aux = [0, 0, 0, 0];
}

/** straight quay walk at y in front of a revetment bay range (low deck on piers, steps at the ends) */
export function quayRun(ctx, e, b0, b1, y, width) {
  const { S, rng } = ctx;
  const n = Math.max(1, Math.round(((b1 - b0) * D2R * e.faceR) / 9));
  const db = (b1 - b0) / n;
  for (let k = 0; k < n; k++) {
    const { F, len } = arcFrame(e.faceR, b0 + k * db, b0 + (k + 1) * db, e.side);
    const mid = F.p(len / 2, 0, 0);
    const lod = ctx.lodAt(mid[0], mid[2]);
    const Pv = S.get('paving', mid[0], mid[2]);
    Pv.aux = [0, 0, 0, AUX_PAVING(1.1)];
    Pv.quadToward(F.p(0, y, 0), F.p(len, y, 0), F.p(len, y, width), F.p(0, y, width), tone(rng, 0.03), [0, 1, 0]);
    Pv.aux = [0, 0, 0, 0];
    const Lm = S.get('lime', mid[0], mid[2]);
    Lm.aux = [0, 0.2, 0, AUX_ASHLAR(0.7)];
    // kerb + front face down into the water
    chamferBox(Lm, F, 0, len, y - 0.35, y + 0.08, width - 0.45, width + 0.05, lod <= 1 ? 0.04 : 0, tone(rng, 0.05), FACES.pz | FACES.py);
    Lm.quadToward(F.p(0, e.floor - 1, width), F.p(len, e.floor - 1, width), F.p(len, y - 0.35, width), F.p(0, y - 0.35, width), [0.62, 0.62, 0.56], F.az);
    if (k === 0) Lm.quadToward(F.p(0, e.floor - 1, 0), F.p(0, e.floor - 1, width + 0.05), F.p(0, y + 0.08, width + 0.05), F.p(0, y + 0.08, 0), [0.8, 0.78, 0.74], mul3(F.ax, -1));
    if (k === n - 1) Lm.quadToward(F.p(len, e.floor - 1, 0), F.p(len, e.floor - 1, width + 0.05), F.p(len, y + 0.08, width + 0.05), F.p(len, y + 0.08, 0), [0.8, 0.78, 0.74], F.ax);
    Lm.aux = [0, 0, 0, 0];
    // bollard + mooring ring
    if (lod <= 1) {
      const Bk = S.get('black', mid[0], mid[2]);
      lathe(Bk, F, len * 0.5, y, width - 0.9, [[0.0, 0], [0.26, 0], [0.26, 0.1], [0.2, 0.16], [0.18, 0.55], [0.27, 0.64], [0.25, 0.72], [0.0, 0.75]], 8, [0.9, 0.9, 0.9]);
    }
    // water stairs down from the deck at every 4th bay
    if (k % 4 === 2 && lod <= 1) {
      const nS = 6, sw = 2.4;
      for (let i = 0; i < nS; i++) {
        const yy = y - (i + 1) * ((y + 0.8) / nS);
        chamferBox(Lm, F, len / 2 - sw / 2, len / 2 + sw / 2, yy - 0.3, yy + 0.02, width + 0.05 + i * 0.32, width + 0.05 + (i + 1) * 0.32, 0.02, tone(rng, 0.05), FACES.py | FACES.pz | FACES.px | FACES.nx);
      }
    }
    ctx.engine.footprints.addRect(mid[0] + F.az[0] * width / 2, mid[2] + F.az[2] * width / 2, len / 2, width / 2, Math.atan2(-F.ax[2], F.ax[0]), 'rings-quay');
  }
}

/** projecting stone lips under the citadel parapet notches (the water module's wall spouts pour from them) */
export function spoutLips(ctx, e) {
  const { S, rng } = ctx;
  for (const sp of e.spouts || []) {
    const hb = ((sp.width / 2 + 0.5) / e.wallR) * (180 / Math.PI);
    const { F, len } = arcFrame(e.wallR, sp.bearing - hb, sp.bearing + hb, e.side);
    const mid = F.p(len / 2, 0, 0);
    const W = S.get('white', mid[0], mid[2]), G = S.get('gilt', mid[0], mid[2]);
    const y = sp.y - 0.12, out = sp.out + 0.25;
    W.aux = [0, 0.4, 0, 0];
    chamferBox(W, F, 0, len, y - 0.45, y, -0.6, out, 0.05, tone(rng, 0.03));
    for (const s0 of [0, len - 0.35]) chamferBox(W, F, s0, s0 + 0.35, y, y + 0.55, -0.6, out, 0.04, tone(rng, 0.03));
    box(G, F, 0, len, y - 0.3, y - 0.12, out, out + 0.04, [1, 1, 1], FACES.pz | FACES.py | FACES.ny);
    const nC = Math.max(2, Math.round(len / 1.6));
    for (let i = 0; i < nC; i++) {
      const sc = (i + 0.5) * (len / nC);
      chamferBox(W, F, sc - 0.25, sc + 0.25, y - 1.6, y - 0.45, -0.1, out * 0.75, 0.04, tone(rng, 0.04));
      chamferBox(W, F, sc - 0.25, sc + 0.25, y - 2.3, y - 1.6, -0.1, out * 0.35, 0.04, tone(rng, 0.04));
    }
    W.aux = [0, 0, 0, 0];
  }
}

/** solid garden bastion on top of a wall (flush deck at bs.deck; the sets agent builds the terrace on it) */
export function bastionBlock(ctx, e, bs) {
  const { S, rng } = ctx;
  const { F, len } = arcFrame(e.wallR, bs.b0, bs.b1, e.side);
  const mid = F.p(len / 2, 0, 0);
  const y0 = e.landY - 0.6, yD = bs.deck - 0.06, depth = Math.max(4, bs.r1 - e.wallR) * (e.side < 0 ? 1 : 1);
  const back = -Math.abs(e.side < 0 ? bs.r1 - e.wallR : e.wallR - bs.r0);
  const W = S.get('white', mid[0], mid[2]), G = S.get('gilt', mid[0], mid[2]);
  void depth;
  // plinth, ashlar body, cladding band, cornice
  const Bk = S.get('black', mid[0], mid[2]);
  Bk.aux = [0, 0.4, 0, AUX_ASHLAR(0.55)];
  chamferBox(Bk, F, -0.3, len + 0.3, y0, e.landY + 1.1, back - 0.3, 0.3, 0.06, tone(rng, 0.05), FACES.pz | FACES.py | FACES.px | FACES.nx | FACES.nz);
  W.aux = [0, 0, 0.2, AUX_ASHLAR(0.62)];
  const yK = yD - 1.4;
  W.quadToward(F.p(0, e.landY + 1.1, 0.12), F.p(len, e.landY + 1.1, 0.12), F.p(len, yK, 0.12), F.p(0, yK, 0.12), tone(rng, 0.03), F.az);
  for (const [s, dir] of [[0, mul3(F.ax, -1)], [len, F.ax]]) W.quadToward(F.p(s, e.landY + 1.1, back), F.p(s, e.landY + 1.1, 0.12), F.p(s, yK, 0.12), F.p(s, yK, back), [0.92, 0.9, 0.87], dir);
  W.quadToward(F.p(0, e.landY + 1.1, back), F.p(len, e.landY + 1.1, back), F.p(len, yK, back), F.p(0, yK, back), [0.92, 0.9, 0.87], mul3(F.az, -1));
  const R = S.get('red', mid[0], mid[2]);
  R.aux = [0, 0.2, 0, AUX_ASHLAR(0.62)];
  for (const yb of [e.landY + 3.0, yK - 4.2]) box(R, F, -0.02, len + 0.02, yb, yb + 0.62, back + 0.1, 0.14, tone(rng, 0.05), FACES.pz | FACES.py | FACES.ny | FACES.px | FACES.nx);
  const Mt = S.get(e.cladding || 'bronze', mid[0], mid[2]);
  Mt.quadToward(F.p(0.8, yK - 3.4, 0.14), F.p(len - 0.8, yK - 3.4, 0.14), F.p(len - 0.8, yK - 0.4, 0.14), F.p(0.8, yK - 0.4, 0.14), [1, 1, 1], F.az);
  box(G, F, 0.6, len - 0.6, yK - 0.4, yK - 0.25, 0.12, 0.2, [1, 1, 1], FACES.pz | FACES.py | FACES.ny);
  box(G, F, 0.6, len - 0.6, yK - 3.55, yK - 3.4, 0.12, 0.2, [1, 1, 1], FACES.pz | FACES.py | FACES.ny);
  // r2: articulated front — paired pilasters with gilt capitals, blind arched niches (red backs, gilt
  // keystones) between them, gilt modillion course under the cornice, corner piers with urn finials
  {
    const nb = Math.max(3, Math.round(len / 5.5)), bw = len / nb;
    const yA0 = e.landY + 3.9, yA1 = yK - 4.6;
    for (let k = 0; k <= nb; k++) {
      const sx = k * bw;
      W.aux = [0, 0.4, 0, AUX_ASHLAR(0.62)];
      chamferBox(W, F, sx - 0.45, sx + 0.45, e.landY + 1.1, yK - 0.35, 0.1, 0.42, 0.04, tone(rng, 0.04), FACES.pz | FACES.px | FACES.nx);
      chamferBox(G, F, sx - 0.58, sx + 0.58, yK - 0.6, yK - 0.25, 0.1, 0.52, 0.03, [1, 1, 1], FACES.pz | FACES.px | FACES.nx | FACES.ny);
      if (k === nb) break;
      const sc = sx + bw / 2, ar = Math.min(1.5, bw * 0.28), ysA = yA1 - ar;
      if (ysA - yA0 < 1.5) continue;
      const Rb = S.get('red', mid[0], mid[2]);
      Rb.aux = [0.35, 0, 0, AUX_ASHLAR(0.5)];
      Rb.quadToward(F.p(sc - ar, yA0, 0.125), F.p(sc + ar, yA0, 0.125), F.p(sc + ar, ysA, 0.125), F.p(sc - ar, ysA, 0.125), [0.85, 0.85, 0.85], F.az);
      for (let i = 0; i < 8; i++) {
        const a0 = (Math.PI * i) / 8, a1 = (Math.PI * (i + 1)) / 8;
        Rb.polyToward([F.p(sc, ysA, 0.125), F.p(sc + Math.cos(a0) * ar, ysA + Math.sin(a0) * ar, 0.125), F.p(sc + Math.cos(a1) * ar, ysA + Math.sin(a1) * ar, 0.125)], [0.85, 0.85, 0.85], F.az);
      }
      Rb.aux = [0, 0, 0, 0];
      W.aux = [0, 0.4, 0, 0];
      box(W, F, sc - ar - 0.3, sc - ar, yA0 - 0.25, ysA, 0.12, 0.3, tone(rng, 0.04), FACES.pz | FACES.px | FACES.nx | FACES.py);
      box(W, F, sc + ar, sc + ar + 0.3, yA0 - 0.25, ysA, 0.12, 0.3, tone(rng, 0.04), FACES.pz | FACES.px | FACES.nx | FACES.py);
      box(W, F, sc - ar - 0.45, sc + ar + 0.45, yA0 - 0.45, yA0 - 0.2, 0.12, 0.36, tone(rng, 0.04), FACES.pz | FACES.py | FACES.px | FACES.nx);
      for (let i = 0; i < 9; i++) {
        const a0 = Math.PI - (Math.PI * i) / 9, a1 = Math.PI - (Math.PI * (i + 1)) / 9, key = i === 4;
        const B = key ? G : W, R1 = ar + (key ? 0.5 : 0.32);
        const P = (a, rr, d) => F.p(sc + Math.cos(a) * rr, ysA + Math.sin(a) * rr, d);
        const ctr = F.p(sc, ysA, -0.5);
        B.quadOut(P(a0, ar, 0.3), P(a1, ar, 0.3), P(a1, R1, 0.3), P(a0, R1, 0.3), key ? [1, 1, 1] : tone(rng, 0.04), ctr);
        B.quadOut(P(a0, ar, 0.12), P(a1, ar, 0.12), P(a1, ar, 0.3), P(a0, ar, 0.3), [0.8, 0.78, 0.75], F.p(sc, ysA, 0.5));
      }
      // gilt modillions (small brackets) under the cornice
      for (let m = 0; m < 4; m++) { const mx = sx + (m + 0.5) * (bw / 4); box(G, F, mx - 0.12, mx + 0.12, yK - 0.22, yK, 0.12, 0.5, [1, 1, 1], FACES.pz | FACES.px | FACES.nx | FACES.ny); }
    }
    W.aux = [0, 0, 0, 0];
  }
  // cornice on three sides + deck slab
  W.aux = [0, 0.25, 0, 0];
  sweep(W, F, -0.4, len + 0.4, [[0.12, yK], [0.3, yK + 0.2], [0.45, yK + 0.5], [0.6, yK + 0.75], [0.6, yD]], tone(rng, 0.03), true);
  W.aux = [0, 0, 0, 0];
  const Pv = S.get('paving', mid[0], mid[2]);
  Pv.aux = [0, 0, 0, AUX_PAVING(1.2)];
  Pv.quadToward(F.p(-0.4, yD, 0.6), F.p(len + 0.4, yD, 0.6), F.p(len + 0.4, yD, back), F.p(-0.4, yD, back), [0.9, 0.88, 0.85], [0, 1, 0]);
  Pv.aux = [0, 0, 0, 0];
  W.aux = [0, 0, 0, AUX_ASHLAR(0.62)];
  for (const [s, dir] of [[-0.4, mul3(F.ax, -1)], [len + 0.4, F.ax]]) W.quadToward(F.p(s, yK, back), F.p(s, yK, 0.6), F.p(s, yD, 0.6), F.p(s, yD, back), [0.92, 0.9, 0.87], dir);
  W.quadToward(F.p(-0.4, yK, back), F.p(len + 0.4, yK, back), F.p(len + 0.4, yD, back), F.p(-0.4, yD, back), [0.92, 0.9, 0.87], mul3(F.az, -1));
  W.aux = [0, 0, 0, 0];
  const c = F.p(len / 2, 0, back / 2);
  ctx.engine.footprints.addRect(c[0], c[2], len / 2 + 1, Math.abs(back) / 2 + 1, Math.atan2(-F.ax[2], F.ax[0]), 'rings-bastion');
  if (ctx.sunken) ctx.slots.coral.push({ pos: F.p(len / 2, yD + 0.05, back / 2), normal: [0, 1, 0], size: 3, tag: 'rings-bastion' });
}
