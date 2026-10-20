// Temple podium (refs 3, 5, 6, 9) and the paved temple precinct / forecourt (refs 1, 3, 4, 5).
//
// The temple module builds the Athenaion on a plain foundation block (crepidoma base ≈ y 66) standing
// on the plateau (y 54). Around it we build a monumental podium: ashlar retaining walls with a
// rusticated base, string course, buttresses, cornice, coping and a balustrade; navy banners in the
// bays (engine.slots.banner), statues on pedestals on the front terrace and on the forecourt, corner
// piers with braziers, and a broad central stair (on the temple axis) from the forecourt up to the
// crepidoma. The precinct around it is paved (flat flagstones that follow the plateau outline, with
// kerbs where the rock drops away), dressed with statues, braziers, urns, planters and lamps.
import { heightAt } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { chamferBox, frameXZ, frameFacing, Frame, FACES } from './geo.js';
import { wallRun, moulding, PROFILES, blockColor, STONE_COL, buttress, planArch, buildArch } from './masonry.js';
import { pedestal, lampPost, planter, garland, wreath, panelFrame } from './ornament.js';
import { slopedBox } from './balustrade.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** podium geometry from the temple registry (falls back to the layout) */
export function podiumPlan(engine) {
  const T = L.TEMPLE;
  const main = engine.registry.temple?.main;
  const W = main?.W ?? T.stylobate[1], Ln = main?.L ?? T.stylobate[0];
  const st = main?.stylobateTop ?? 67.5, crep = main?.crepH ?? 1.5;
  const cx = main?.position?.[0] ?? T.center[0], cz = main?.position?.[2] ?? T.center[2];
  const m = 2.25; // crepidoma margin beyond the stylobate (temple foundation block)
  const f = { x0: cx - W / 2 - m, x1: cx + W / 2 + m, zN: cz - Ln / 2 - m, zS: cz + Ln / 2 + m };
  const P = {
    cx, cz, top: st - crep, stylobate: st, found: f,
    x0: f.x0 - 2.75, x1: f.x1 + 2.75, zN: f.zN - 2.35, zS: f.zS + 3.75,
    stairW: 12, cheek: 1.2,
  };
  P.stairX0 = cx - P.stairW / 2; P.stairX1 = cx + P.stairW / 2;
  return P;
}

/**
 * Build the podium. ctx = acropolis build context (S, slots, balus, footprints, zones).
 * base: forecourt paving level (y). Returns the plan with the stair foot (P.stairFootZ).
 */
export function buildPodium(ctx, engine, base, rng) {
  const P = podiumPlan(engine);
  const { S, slots } = ctx;
  const top = P.top;
  const copeH = 0.32, corniceK = 1.0, corniceH = 0.9 * corniceK;
  const yMason = top - copeH - corniceH;
  const yBot = base - 1.2;
  const cheekX0 = P.stairX0 - P.cheek, cheekX1 = P.stairX1 + P.cheek;
  // ---- faces (F at the run start on the face line, ax along, az outward)
  const faces = [
    { id: 'SW', F: frameXZ(P.x0, 0, P.zS, 1, 0, 0, 1), len: cheekX0 - P.x0, heading: 180, banners: true, front: true },
    { id: 'SE', F: frameXZ(cheekX1, 0, P.zS, 1, 0, 0, 1), len: P.x1 - cheekX1, heading: 180, banners: true, front: true },
    { id: 'E', F: frameXZ(P.x1, 0, P.zS, 0, -1, 1, 0), len: P.zS - P.zN, heading: 90, banners: true },
    { id: 'W', F: frameXZ(P.x0, 0, P.zN, 0, 1, -1, 0), len: P.zS - P.zN, heading: 270, banners: true },
    { id: 'N', F: frameXZ(P.x1, 0, P.zN, -1, 0, 0, -1), len: P.x1 - P.x0, heading: 0, banners: false },
  ];
  const tint = [1.0, 0.985, 0.965];
  let nBan = 0, nNiche = 0;
  for (const fc of faces) {
    const { F, len } = fc;
    const groundAt = (s) => { const p = F.p(Math.min(len, Math.max(0, s)), 0, 0.8); return Math.max(base - 0.6, Math.min(base, heightAt(p[0], p[2]))); };
    // bays between buttresses
    const nb = Math.max(1, Math.round(len / (fc.front ? 5.8 : 8.1)));
    const bayW = len / nb;
    const butS = []; for (let k = 1; k < nb; k++) butS.push(k * bayW);
    // statue pedestals on the podium-top balustrade: every buttress on the front, every other one on the flanks (refs 1, 3)
    const pedS = fc.front ? butS : (fc.id === 'E' || fc.id === 'W') ? butS.filter((_, i) => i % 2 === 1) : [];
    // niches with statues in alternate bays of the long flanks (banners in the others)
    const niches = [];
    if (!fc.front && fc.id !== 'N') {
      for (let k = 0; k < nb; k++) {
        if (k % 2 === 0) continue;
        niches.push(planArch((k + 0.5) * bayW, base + 2.1, 2.5, 4.6, 0.55));
      }
    }
    wallRun(S, 'ashlar', F, len, yBot, yMason, {
      rng, courses: 'pseudo', batter: 0.0, rustic: true, rusticH: 3.2, groundAt, lite: true, damp: 0.5, color: tint,
      dripsAt: butS.map((s) => s + bayW / 2),
      cuts: niches.length ? (c0, c1) => niches.map((A) => A.cut(c0, c1)).filter(Boolean) : null,
    });
    for (const A of niches) {
      const r = buildArch(S, 'ashlar', F, A, rng, { depth: 1.5 });
      slots.statue.push({ pos: r.statuePos, facing: fc.heading, size: 3.0, tag: 'acro-podium-niche' });
      nNiche++;
    }
    // string course over the rustication + a second one at the banner hooks
    moulding(S, 'ashlar', F, 0, len, base + 3.4, PROFILES.string(1.1), blockColor(rng, STONE_COL), 0);
    // cornice + coping (the coping is the podium-top edge)
    moulding(S, 'ashlar', F, -0.2, len + 0.2, yMason, PROFILES.cornice(corniceK), blockColor(rng, STONE_COL), 0);
    const Bc = S.get('ashlar', F.o[0] + F.ax[0] * len / 2, F.o[2] + F.ax[2] * len / 2);
    for (let s = -0.2; s < len + 0.2 - 0.05;) {
      const Lb = Math.min(len + 0.2 - s, 1.6 + rng.random() * 1.4);
      chamferBox(Bc, F, s + 0.004, s + Lb - 0.004, top - copeH, top, -1.6, corniceH * 0.55 + 0.06, 0.035, blockColor(rng, STONE_COL), 63 - 8);
      s += Lb;
    }
    // (r6) frieze under the cornice: a flat fascia band with a bead moulding and laurel festoons hung
    // between rosette bosses in every bay (refs 5, 1: the podium reads carved, not a plain box)
    if (fc.id !== 'N') {
      const yF0 = yMason - 1.3, yF1 = yMason - 0.02, cF = blockColor(rng, STONE_COL);
      const Bf = S.get('ashlar', F.o[0] + F.ax[0] * len / 2, F.o[2] + F.ax[2] * len / 2);
      chamferBox(Bf, F, 0.02, len - 0.02, yF0, yF1, -0.3, 0.07, 0.02, cF, 63 - 8);
      chamferBox(Bf, F, 0.02, len - 0.02, yF0 - 0.1, yF0, -0.3, 0.12, 0.04, darker(cF, 0.92), 63 - 8);
      const bw = fc.front ? 1.5 : 1.9;
      const edges = [0, ...butS, len];
      for (let k = 0; k < edges.length - 1; k++) {
        const a = edges[k] + (k === 0 ? 0.4 : bw / 2 + 0.25), b = edges[k + 1] - (k === edges.length - 2 ? 0.4 : bw / 2 + 0.25);
        const nG = Math.max(1, Math.round((b - a) / 2.5));
        const gw = (b - a) / nG;
        for (let g = 0; g < nG; g++) garland(Bf, F.at(0, 0, 0.07), a + g * gw + 0.12, a + (g + 1) * gw - 0.12, yF1 - 0.3, Math.min(0.5, gw * 0.2), 0.15, rng, darker(cF, 1.02));
      }
    }
    // buttresses (pilaster-buttresses with set-offs) between the bays
    for (const s of butS) buttress(S, 'ashlar', F, s, fc.front ? 1.5 : 1.9, fc.front ? 0.75 : 1.05, yBot, yMason - 0.15, rng, { groundAt, setoffs: 2, color: tint });
    // balustrade on the podium top
    {
      const cutsB = pedS;
      let a = 1.75;
      for (const c of [...cutsB, len - 1.75 + 0.85]) { if (c - 0.85 - a > 0.9) ctx.balus.addRun(S, 'marble', F.at(0, 0, -0.55), a, c - 0.85, top, { broken: 0.004 }); a = c + 0.85; }
    }
    // banners in the bays without niches
    if (fc.banners) {
      for (let k = 0; k < nb; k++) {
        if (!fc.front && k % 2 === 1) continue;
        const s = (k + 0.5) * bayW;
        const hBan = fc.front ? 7.4 : 7.0;
        slots.banner.push({ pos: F.p(s, yMason - 0.25, 0.22), facing: fc.heading, size: [Math.min(2.7, bayW - 2.4), hBan], tag: 'acro-podium', style: fc.front ? 'L' : undefined });
        nBan++;
        // planter with flowers at the foot of the bay (front faces)
        if (fc.front) {
          const pf = frameFacing(F.p(s, 0, 0.75)[0], 0, F.p(s, 0, 0.75)[2], fc.heading);
          const pl = planter(S, pf, base, Math.min(3.2, bayW - 2.0), 0.9, 0.62, rng);
          slots.planter.push({ pos: pl, facing: fc.heading, size: [Math.min(3.0, bayW - 2.2), 0.7], tag: 'acro-podium' });
        }
      }
    }
    // ivy hanging from the coping
    for (let k = 0; k < Math.floor(len / 4.5); k++) { // (r5) denser ivy curtains (ref 1: the podium is half green)
      if (rng.random() < 0.3) continue;
      slots.ivy.push({ pos: F.p(rng.range(0.5, len - 0.5), top - 0.3, 0.45), facing: fc.heading, size: rng.range(2.5, 7.5), width: rng.range(1.0, 3.2), tag: 'acro-podium' });
    }
    // (r6) ivy curtains beside every buttress of the faces seen from shots 5, 1, 3 (ref 5: green on the podium)
    if (fc.id !== 'N' && fc.id !== 'W') for (const sb of butS) for (const sx of [-1, 1]) if (rng.random() < 0.55) slots.ivy.push({ pos: F.p(sb + sx * ((fc.front ? 0.75 : 0.95) + rng.range(0.3, 0.9)), top - 0.35, 0.4), facing: fc.heading, size: rng.range(2.5, 6.5), width: rng.range(0.9, 1.9), tag: 'acro-podium' });
    // statues on pedestals on the podium-top terrace (front faces), between the balustrade runs
    for (const s of pedS) {
      const p = F.p(s, 0, -0.55);
      const Fp = frameFacing(p[0], 0, p[2], fc.heading);
      const yT = pedestal(S, 'marble', Fp, top, 0.95, 1.25, rng, { faces: ['front'] });
      slots.statue.push({ pos: [p[0], yT, p[2]], facing: fc.heading + rng.range(-12, 12), size: 2.55, tag: fc.front ? 'acro-temple-front' : 'acro-podium-parapet' });
    }
  }
  // ---- corner piers (towers rising through the balustrade, with braziers)
  const corners = [[P.x0, P.zS, 180, true], [P.x1, P.zS, 180, true], [P.x1, P.zN, 0, false], [P.x0, P.zN, 0, false]];
  for (const [cx, cz, hd, south] of corners) {
    const F = frameFacing(cx, 0, cz, hd);
    const B = S.get('ashlar', cx, cz);
    const g = Math.min(base, heightAt(cx, cz));
    let y = g - 1.2, ci = 0;
    const hw = 1.55;
    const yTop = top + 1.35;
    while (y < yTop - 0.05) {
      const h = Math.min(yTop - y, (ci++ % 2 ? 0.46 : 0.74) * (y < base + 3 ? 1.2 : 1));
      const rus = y < base + 3.2;
      const c = blockColor(rng, STONE_COL);
      chamferBox(B, F, -hw - (rus ? 0.06 : 0), hw + (rus ? 0.06 : 0), y, y + h, -hw - (rus ? 0.06 : 0), hw + (rus ? 0.06 : 0), rus ? 0.09 : 0.04, c, FACES.pz | FACES.px | FACES.nx | FACES.nz, darker(c, 0.86));
      y += h;
    }
    // cornice ring at the podium cornice level + cap
    for (const [a, b, yy] of [[hw + 0.25, hw + 0.25, yMason + 0.25], [hw + 0.4, hw + 0.4, yMason + 0.6]]) chamferBox(B, F, -a, a, yy, yy + 0.3, -b, b, 0.05, blockColor(rng, STONE_COL), 63 - 8);
    chamferBox(B, F, -hw - 0.22, hw + 0.22, yTop, yTop + 0.28, -hw - 0.22, hw + 0.22, 0.05, blockColor(rng, STONE_COL));
    chamferBox(B, F, -hw + 0.2, hw - 0.2, yTop + 0.28, yTop + 0.5, -hw + 0.2, hw - 0.2, 0.04, blockColor(rng, STONE_COL));
    // (r6) carved faces (shot 1, ref 1): a moulded panel with a big laurel wreath and a festoon under the cornice ring
    {
      const cP = blockColor(rng, STONE_COL);
      const Bo = S.get('ashlar', cx, cz);
      const yW = Math.max(base + 4.5, yMason - 2.0);
      for (const Ff of [F.at(0, 0, hw), F.yawed(Math.PI).at(0, 0, hw), F.yawed(-Math.PI / 2).at(0, 0, hw), F.yawed(Math.PI / 2).at(0, 0, hw)]) {
        panelFrame(Bo, Ff, 0, yW, 2.3, 2.5, cP, 0.05, 0.11);
        wreath(Bo, Ff, 0, yW, 0.8, rng, cP, { relief: 0.075 });
        garland(Bo, Ff.at(0, 0, 0.02), -1.25, 1.25, yMason + 0.12, 0.42, 0.15, rng, cP);
      }
    }
    if (south) slots.brazier.push({ pos: [cx, yTop + 0.5, cz], facing: hd, size: 1.5, tag: 'acro-podium' });
    else slots.urn.push({ pos: [cx, yTop + 0.5, cz], facing: hd, size: 1.3, tag: 'acro-podium' });
    // banner on the outer face of the south corner piers
    // (no banner on the corner piers: the brief asks for 3-5 banners on the south face, one per bay)
  }
  // ---- statues on low plinths in the intercolumniations, in front of the crepidoma (refs 1, 5)
  {
    const cols = engine.registry.temple?.main?.columns ?? L.TEMPLE.columns[0];
    const nC = Array.isArray(cols) ? cols.length : 8;
    const pitch = (P.found.x1 - P.found.x0 - 4.5 - 1.9) / Math.max(1, (typeof cols === 'number' ? cols : 8) - 1);
    void nC;
    const zS = (P.found.zS + P.zS) / 2 - 0.25;
    for (let k = -3; k <= 3; k++) {
      const x = P.cx + k * pitch;
      if (Math.abs(x - P.cx) < P.stairW / 2 + 1.0) continue;
      const Fp = frameFacing(x, 0, zS, 180);
      const B = S.get('marble', x, zS);
      const c = blockColor(rng, STONE_COL);
      chamferBox(B, Fp, -0.5, 0.5, top, top + 0.42, -0.45, 0.45, 0.04, c, 63 - 8, darker(c, 0.85));
      chamferBox(B, Fp, -0.56, 0.56, top + 0.42, top + 0.52, -0.5, 0.5, 0.03, c, 63 - 8);
      slots.statue.push({ pos: [x, top + 0.52, zS], facing: 180 + rng.range(-10, 10), size: 3.3, tag: 'acro-temple-front' });
    }
  }
  // ---- podium top paving (ring around the temple foundation)
  const f = P.found;
  const Bp = S.get('paving', P.cx, P.zS);
  const quad = (x0, x1, z0, z1) => Bp.quadOut([x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1], [1, 1, 1], [(x0 + x1) / 2, top - 5, (z0 + z1) / 2]);
  quad(P.x0, P.x1, f.zS - 0.05, P.zS);       // front terrace
  quad(P.x0, P.x1, P.zN, f.zN + 0.05);       // back
  quad(P.x0, f.x0 + 0.05, f.zN, f.zS);       // west
  quad(f.x1 - 0.05, P.x1, f.zN, f.zS);       // east
  // ---- central stair from the forecourt up to the podium top (temple axis)
  const sp = buildPodiumStair(ctx, P, base, top, rng);
  ctx.footprints.addRect((P.x0 + P.x1) / 2, (P.zN + P.zS) / 2, (P.x1 - P.x0) / 2 + 0.5, (P.zS - P.zN) / 2 + 0.5, 0, 'acro-wall');
  ctx.footprints.addRect(P.cx, (P.zS + sp.zFoot) / 2, (cheekX1 - cheekX0) / 2 + 0.4, (sp.zFoot - P.zS) / 2 + 0.3, 0, 'acro-stair');
  P.stairFootZ = sp.zFoot;
  P.cheekX0 = cheekX0; P.cheekX1 = cheekX1;
  P.nBanners = nBan; P.nNiches = nNiche;
  return P;
}

/** broad straight stair on the temple axis: P.zS (top, y=top) → forward to the foot at y=base */
function buildPodiumStair(ctx, P, base, top, rng) {
  const { S, slots } = ctx;
  const rise = top - base;
  const n = Math.max(8, Math.round(rise / 0.29));
  const rr = rise / n, t = 0.3;
  const zTop = P.zS, zFoot = zTop + n * t;
  const X = P.cx, hw = P.stairW / 2;
  const Fst = new Frame([X, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const B = S.get('tread', X, (zTop + zFoot) / 2);
  for (let i = 0; i < n; i++) {
    // i = 0 at the top
    const yT = top - i * rr;
    const zB = zTop + i * t - 0.06, zF = zTop + (i + 1) * t + 0.02;
    let s = -hw;
    while (s < hw - 0.05) {
      let Lb = 1.4 + rng.random() * 1.9;
      if (s + Lb > hw - 0.5) Lb = hw - s;
      const col = blockColor(rng, STONE_COL);
      const mid = Math.abs(s + Lb / 2) < hw * 0.55;
      B.aux = [0.06, mid ? 0.85 : 0.5, 0, 0];
      const riser = [col[0] * 0.84, col[1] * 0.83, col[2] * 0.82];
      chamferBox(B, Fst, s + 0.004, s + Lb - 0.004, yT - rr - 0.14 + rng.gauss(0, 0.004), yT + rng.gauss(0, 0.004), zB, zF, mid ? 0.045 : 0.03, (axis, side) => (axis === 2 && side === 1 ? riser : col), FACES.py | FACES.pz | FACES.px | FACES.nx);
      B.aux = [0, 0, 0, 0];
      if (Math.abs(s + Lb) > hw - 0.3 && rng.random() < 0.3) (ctx.crackSpots ||= []).push([X + (s + Lb > 0 ? hw - 0.15 : -hw + 0.15), yT, zF - 0.05]);
      s += Lb;
    }
  }
  // cheek walls (ashlar, clipped to the slope) with a sloped coping; statues at the foot, braziers above
  const line = (z) => top - Math.max(0, Math.min(rise, ((z - zTop) / (zFoot - zTop)) * rise));
  const len = zFoot - zTop;
  for (const side of [-1, 1]) {
    const xi = X + side * hw, xo = X + side * (hw + P.cheek);
    const topAt = (s) => line(zTop + s) + 0.95;
    const Fo = frameXZ(xo, 0, zTop, 0, 1, side, 0);
    wallRun(S, 'ashlar', Fo, len, base - 1.0, top + 0.95, { rng, courses: 'pseudo', batter: 0, groundAt: () => base - 0.3, topAt, lite: true, drips: false });
    const Fi = frameXZ(xi, 0, zTop, 0, 1, -side, 0);
    wallRun(S, 'ashlar', Fi, len, base - 1.0, top + 0.95, { rng, courses: 'pseudo', batter: 0, groundAt: (s) => line(zTop + s) - 0.25, topAt, lite: true, drips: false });
    const Fcp = new Frame([(xi + xo) / 2, 0, zTop], [0, 0, 1], [0, 1, 0], [side, 0, 0]);
    const Bc = S.get('ashlar', xo, (zTop + zFoot) / 2);
    const cc = blockColor(rng, STONE_COL);
    slopedBox(Bc, Fcp, -0.3, len, top + 0.95 + rise / len * 0.3, line(zFoot) + 0.95, 0, 0.24, -P.cheek / 2 - 0.1, P.cheek / 2 + 0.1, cc);
    chamferBox(Bc, new Frame([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]), Math.min(xi, xo), Math.max(xi, xo), base - 0.4, base + 1.15, zFoot - 0.25, zFoot + 0.02, 0.03, cc);
    // foot pedestal (statue) and top pedestal (brazier)
    const Ff = frameFacing((xi + xo) / 2 + side * 0.3, 0, zFoot - 1.0, 180);
    const yS = pedestal(S, 'marble', Ff, base, 1.7, 2.3, rng, { faces: ['front', 'left', 'right'] });
    slots.statue.push({ pos: [Ff.o[0], yS, Ff.o[2]], facing: 180 + side * 12, size: 2.8, tag: 'acro-temple-front' });
    const Ft = frameFacing((xi + xo) / 2, 0, zTop + 0.9, 180);
    const yB = pedestal(S, 'marble', Ft, top + 1.05, 1.3, 1.3, rng, { faces: ['front'] });
    slots.brazier.push({ pos: [Ft.o[0], yB, Ft.o[2]], facing: 180, size: 1.2, tag: 'acro-podium' });
    // mid-flight pedestal with a brazier
    const zm = (zTop + zFoot) / 2;
    const Fm = frameFacing((xi + xo) / 2, 0, zm, 180);
    const yM = pedestal(S, 'marble', Fm, line(zm) + 1.12, 1.25, 1.25, rng, { faces: ['front', 'left', 'right'] });
    slots.brazier.push({ pos: [Fm.o[0], yM, Fm.o[2]], facing: 180, size: 1.0, tag: 'acro-podium' });
  }
  return { zFoot, n, rr };
}

// ------------------------------------------------------------------ precinct paving
/**
 * Flat flagstone paving over the plateau within rect [x0,x1]×[z0,z1] wherever the rock is at the
 * plateau level, minus the holes (rects {x0,x1,z0,z1}). Rows of cells are merged into long quads
 * (the paving material lays the slabs in world space); kerbs drop to the rock at the boundary.
 */
export function pavePrecinct(ctx, rect, y, holes, rng, opts = {}) {
  const cell = opts.cell ?? 1.5, minH = opts.minH ?? y - 1.1;
  const nx = Math.ceil((rect.x1 - rect.x0) / cell), nz = Math.ceil((rect.z1 - rect.z0) / cell);
  const on = new Uint8Array(nx * nz);
  const inHole = (x, z) => holes.some((h) => x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = rect.x0 + (i + 0.5) * cell, z = rect.z0 + (j + 0.5) * cell;
    if (inHole(x, z)) continue;
    if (opts.keep && !opts.keep(x, z)) continue;
    const h = Math.min(heightAt(x - cell * 0.35, z - cell * 0.35), heightAt(x + cell * 0.35, z - cell * 0.35), heightAt(x - cell * 0.35, z + cell * 0.35), heightAt(x + cell * 0.35, z + cell * 0.35));
    if (h > minH) on[j * nx + i] = 1;
  }
  const isOn = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && on[j * nx + i] === 1;
  let quads = 0, kerbs = 0, area = 0;
  for (let j = 0; j < nz; j++) {
    let i = 0;
    while (i < nx) {
      if (!isOn(i, j)) { i++; continue; }
      let k = i; while (k < nx && isOn(k, j)) k++;
      const x0 = rect.x0 + i * cell, x1 = rect.x0 + k * cell, z0 = rect.z0 + j * cell, z1 = z0 + cell;
      const B = ctx.S.get('paving', (x0 + x1) / 2, (z0 + z1) / 2);
      B.quadOut([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [1, 1, 1], [(x0 + x1) / 2, y - 5, (z0 + z1) / 2]);
      quads++; area += (x1 - x0) * cell;
      if (opts.footprintTag) ctx.footprints.addRect((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, cell / 2, 0, opts.footprintTag);
      i = k;
    }
  }
  // kerbs: vertical stone faces along every boundary edge, down to the rock
  const Bk = (x, z) => ctx.S.get('ashlar', x, z);
  const kerb = (a, b, out) => {
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const g = Math.min(heightAt(mx + out[0] * 0.5, mz + out[1] * 0.5), y - 0.25);
    const c = blockColor(rng, STONE_COL);
    const B = Bk(mx, mz);
    B.aux = [0.25, 0.4, 0, 0];
    B.quadOut([a[0], y + 0.002, a[1]], [b[0], y + 0.002, b[1]], [b[0], g - 0.3, b[1]], [a[0], g - 0.3, a[1]], darker(c, 0.92), [mx - out[0], y - 0.5, mz - out[1]]);
    B.aux = [0, 0, 0, 0];
    kerbs++;
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!isOn(i, j)) continue;
    const x0 = rect.x0 + i * cell, x1 = x0 + cell, z0 = rect.z0 + j * cell, z1 = z0 + cell;
    if (!isOn(i - 1, j)) kerb([x0, z1], [x0, z0], [-1, 0]);
    if (!isOn(i + 1, j)) kerb([x1, z0], [x1, z1], [1, 0]);
    if (!isOn(i, j - 1)) kerb([x0, z0], [x1, z0], [0, -1]);
    if (!isOn(i, j + 1)) kerb([x1, z1], [x0, z1], [0, 1]);
  }
  return { quads, kerbs, area, isPaved: (x, z) => { const i = Math.floor((x - rect.x0) / cell), j = Math.floor((z - rect.z0) / cell); return isOn(i, j); } };
}

/**
 * Precinct dressing: statues on pedestals in front of the podium (ref 5), braziers, urns, lamps,
 * statue rows along the temple flanks, planters. pv = paving info (isPaved).
 */
export function dressPrecinct(ctx, P, y, pv, rng) {
  const { S, slots } = ctx;
  const colossusClear = (x, z, r) => L.COLOSSI.every((c) => Math.hypot(x - c.pos[0], z - c.pos[2]) > c.height * 0.36 + 1.5 + r);
  const free = (x, z, r) => pv.isPaved(x, z) && colossusClear(x, z, r) && ctx.footprints.isFree(x, z, r, ['acro-plaza']);
  let nS = 0, nB = 0, nU = 0;
  // statues in front of the podium buttresses (forecourt, facing south)
  const zRow = P.zS + 2.4;
  for (const x of [P.x0 + 2.85, P.cheekX0 - 2.85, P.cheekX1 + 2.85, P.x1 - 2.85]) {
    if (!free(x, zRow, 1.2)) continue;
    const F = frameFacing(x, 0, zRow, 180);
    const yT = pedestal(S, 'marble', F, y, 1.35, 2.1, rng, { faces: ['front', 'left', 'right'] });
    slots.statue.push({ pos: [x, yT, zRow], facing: 180 + rng.range(-15, 15), size: 2.7, tag: 'acro-temple-front' });
    ctx.footprints.addCircle(x, zRow, 1.3, 'acro-pedestal'); nS++;
  }
  // braziers on tripods flanking the stair foot, urns at the forecourt rim
  for (const sx of [-1, 1]) {
    const x = P.cx + sx * (P.stairW / 2 + P.cheek + 2.2), z = P.stairFootZ - 1.6;
    if (pv.isPaved(x, z) && ctx.footprints.isFree(x, z, 0.8, ['acro-plaza', 'acro-stair'])) { slots.brazier.push({ pos: [x, y, z], facing: 180, size: 1.2, tag: 'acro-forecourt-ground' }); ctx.footprints.addCircle(x, z, 0.9, 'acro-pedestal'); nB++; }
  }
  // statue rows along the east and west flanks of the podium (facing outward), alternating with
  // lamp standards; seen from the ruins terrace (shots 3, 8, 9) and the high rocks (shot 1)
  for (const [xr, hd] of [[P.x1 + 4.2, 90], [P.x0 - 4.2, 270]]) {
    let k = 0;
    for (let z = P.zS - 6; z > P.zN + 4; z -= 7.5, k++) {
      if (!free(xr, z, 1.2)) continue;
      const F = frameFacing(xr, 0, z, hd);
      if (k % 2 === 0) {
        const yT = pedestal(S, 'marble', F, y, 1.2, 1.9, rng, { faces: ['front'] });
        slots.statue.push({ pos: [xr, yT, z], facing: hd + rng.range(-10, 10), size: 2.6, tag: 'acro-temple-flank' });
        nS++;
      } else {
        const flame = lampPost(S, F, y, rng, 3.8);
        slots.lamp.push({ pos: flame, facing: 0, size: 0.35, tag: 'acro-precinct' });
      }
      ctx.footprints.addCircle(xr, z, 1.2, 'acro-pedestal');
    }
  }
  // urns + planters scattered along the forecourt rim and the precinct edges
  for (let i = 0; i < 26; i++) {
    const x = rng.range(-22, 76), z = rng.range(-110, -11);
    if (x > P.x0 - 2 && x < P.x1 + 2 && z < P.zS + 1.5) continue;
    if (!free(x, z, 1.6) || !pv.isPaved(x + 2, z) || !pv.isPaved(x - 2, z) || !pv.isPaved(x, z + 2) || !pv.isPaved(x, z - 2)) continue;
    // keep the edges (rim) and the flanks, not the middle of the walkway
    const nearEdge = !pv.isPaved(x + 4, z) || !pv.isPaved(x - 4, z) || !pv.isPaved(x, z + 4) || !pv.isPaved(x, z - 4);
    if (!nearEdge && rng.random() < 0.7) continue;
    slots.urn.push({ pos: [x, y, z], facing: 180, size: rng.range(0.9, 1.3), tag: rng.random() < 0.35 ? 'acro-precinct-marble' : 'acro-precinct' });
    ctx.footprints.addCircle(x, z, 0.8, 'acro-pedestal'); nU++;
  }
  return { statues: nS, braziers: nB, urns: nU };
}
