// Entablatures, pediments and roofs.
// A "run" is one straight side of a colonnade between two corner column axes a → b (XZ, building
// local). Run-local frame: x = s along the run (0 at a), y = up, z = outward offset (outside is on
// the LEFT of travel a→b, so go around a building counter-clockwise seen from above with +Z south:
// front (+Z) a=(-x,+z)→b=(+x,+z), right side (+X) +z→-z, back (-Z) +x→-x, left side -z→+z).
import * as THREE from 'three';
import { box, quadOut, surface, lathe, sweep, extrudeOutline, ellipsoid, lerp, clamp, smooth, hash3, vnoise3 } from './geom.js';
import { plaque, antefix, palmetteAcroterion, griffinGeometry, victoryGeometry, eggAndDart, rosette, template } from './ornament.js';
import { seg } from './orders.js';

export class Run {
  constructor(a, b) {
    this.a = a; this.b = b;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    this.len = Math.hypot(dx, dz);
    this.dir = [dx / this.len, dz / this.len];
    // rotateY(theta) maps local +X to dir; local +Z (outward) becomes (sin θ, cos θ) = (−dirz, dirx)
    this.theta = Math.atan2(-this.dir[1], this.dir[0]);
    this.out = [Math.sin(this.theta), Math.cos(this.theta)];
  }
  /** push a transform on the builder: local x = s, z = outward, y = up */
  frame(mb) { mb.push(); mb.translate(this.a[0], 0, this.a[1]); mb.rotateY(this.theta); return mb; }
  /** building-local point for run coords */
  p(s, y, z) { return [this.a[0] + this.dir[0] * s + this.out[0] * z, y, this.a[1] + this.dir[1] * s + this.out[1] * z]; }
  vec(s, z) { return [this.dir[0] * s + this.out[0] * z, 0, this.dir[1] * s + this.out[1] * z]; }
}

/** small hanging guttae (frusta) row along x at height y (top of the guttae), z = depth */
function guttae(mb, xs, yTop, z, r, h, detail) {
  if (detail < 0.3) return;
  const sg = detail > 0.7 ? 7 : 5;
  const tpl = template('gutta:' + r.toFixed(4) + ':' + h.toFixed(4) + ':' + sg, (m) => lathe(m, [[r * 0.85, 0, 0.2, 0.5, true], [r * 0.82, h, 0.5, 0]], sg, { capBottom: true, aux: [0.15, 0.4, 0, 0] }));
  const M = new THREE.Matrix4();
  for (const x of xs) { M.makeTranslation(x, yTop - h, z); mb.merge(tpl, M); }
}

/** classic triglyph relief face (two glyphs + half glyphs) on the +Z face at z = 0, x ∈ [-w/2,w/2], y ∈ [0,h] */
export function triglyphFace(mb, w, h, o = {}) {
  const gd = o.depth ?? w * 0.07;
  const top = h - (o.cap ?? h * 0.09);
  const us = [0, 1 / 12, 3 / 12, 4 / 12, 5 / 12, 7 / 12, 8 / 12, 9 / 12, 11 / 12, 1];
  const zAt = (k) => { // depth profile at fraction k across
    if (k <= 1 / 12) return -gd * (1 - k * 12);
    if (k >= 11 / 12) return -gd * (1 - (1 - k) * 12);
    for (const c of [4 / 12, 8 / 12]) if (Math.abs(k - c) <= 1 / 12) return -gd * (1 - Math.abs(k - c) * 12);
    return 0;
  };
  const vRows = [0, 0.5, (top - 0.06 * h) / h, (top - 0.02 * h) / h, top / h, 1];
  for (let i = 0; i < us.length - 1; i++) {
    const k0 = us[i], k1 = us[i + 1];
    surface(mb, (u, v, out) => {
      const k = lerp(k0, k1, u);
      const y = v * h;
      const m = 1 - smooth(top - 0.06 * h, top - 0.01 * h, y);
      out[0] = (k - 0.5) * w; out[1] = y; out[2] = zAt(k) * m;
    }, 1, 5, { vs: vRows, aux: (u) => { const k = lerp(k0, k1, u); return [clamp(-zAt(k) / gd, 0, 1) * 0.6, (zAt(k) === 0 && (u === 0 || u === 1)) ? 0.4 : 0, 0.7, 0]; } });
  }
}

/**
 * Doric entablature along a run.
 * o: { y0, D, fA, dA, hA, hF, hG, tw, triglyphs:[s], axes:[s], owner (true for front/back = owns corners),
 *      flank (eaves course + antefixes), plaques (gilded triglyph plaques), detail, seed, ov,
 *      antefixSpacing, metopes (array to push info into), gild (0..1), building B }
 */
export function doricRun(B, run, o) {
  const mb = B.marble, mg = B.gold;
  const { y0, D, fA, dA, hA, hF, hG, tw, detail } = o;
  const ov = o.ov ?? 0.42 * D;
  const tH = 0.06 * D, tP = 0.035 * D, rH = 0.045 * D, gH = 0.045 * D;
  const crownH = 0.08 * D, dF = Math.max(tw, 0.5 * D), mR = 0.07 * D;
  const mH = 0.1 * D, dG = 0.5 * D;
  const owner = !!o.owner;
  const L = run.len;
  const sA0 = owner ? -fA : -fA + dA, sA1 = owner ? L + fA : L + fA - dA;
  const sF0 = owner ? -fA : -fA + dF, sF1 = owner ? L + fA : L + fA - dF;
  const sG0 = owner ? -fA - ov : -fA + dG, sG1 = owner ? L + fA + ov : L + fA - dG;
  const bev = 0.012 * D;
  const rnd = (i, k) => hash3(i * 7 + (o.seed | 0), k, 31);
  run.frame(mb); run.frame(mg);
  // ---- architrave blocks (joints at column axes)
  const joints = [sA0, ...o.axes.filter((s) => s > sA0 + 0.3 && s < sA1 - 0.3), sA1];
  for (let i = 0; i < joints.length - 1; i++) {
    const s0 = joints[i] + (i === 0 ? 0 : 0.007), s1 = joints[i + 1] - (i === joints.length - 2 ? 0 : 0.007);
    const sag = (rnd(i, 1) - 0.5) * 0.006;
    // two ashlar courses on the outer face (ref 5 architrave reads as coursed blocks)
    box(mb, [s0, y0 + sag, fA - dA], [s1, y0 + hA - tH, fA], bev * 1.4, [0.08, 0.2, 0.55, o.coursed ? 3 + (hA - tH) * 0.05 : 0]);
  }
  // taenia
  box(mb, [sA0 - (owner ? tP : 0), y0 + hA - tH, fA - dA], [sA1 + (owner ? tP : 0), y0 + hA, fA + tP], bev * 0.5, [0.1, 0, 0.4, 0]);
  // ---- triglyphs + regulae + guttae
  const trig = o.triglyphs;
  const yF0 = y0 + hA, yF1 = y0 + hA + hF - crownH;
  for (let i = 0; i < trig.length; i++) {
    const s = trig[i];
    const isCorner = owner && (i === 0 || i === trig.length - 1);
    if (!owner && (s - tw / 2 < sF0 - 1e-3 || s + tw / 2 > sF1 + 1e-3)) continue;
    // regula + guttae
    if (o.plaques && o.gild > 0.5) {
      // gilded regula panel with a small bead (ref 5: gold fillets under every plaque)
      box(mg, [s - tw / 2, y0 + hA - tH - rH * 1.5, fA - 0.01], [s + tw / 2, y0 + hA - tH, fA + tP * 0.6], bev * 0.4, [0.2, 0.3, 0.3, 0]);
      box(mg, [s - tw * 0.36, y0 + hA - tH - rH * 1.1, fA + tP * 0.6], [s + tw * 0.36, y0 + hA - tH - rH * 0.45, fA + tP * 0.6 + 0.012], 0, [0.2, 0.3, 0.3, 0]);
    } else box(mb, [s - tw / 2, y0 + hA - tH - rH, fA - 0.01], [s + tw / 2, y0 + hA - tH, fA + tP * 0.6], bev * 0.4, [0.2, 0.2, 0.3, 0]);
    const gx = []; for (let g = 0; g < 6; g++) gx.push(s - tw / 2 + tw * (g + 0.5) / 6);
    guttae(mb, gx, y0 + hA - tH - rH * (o.plaques && o.gild > 0.5 ? 1.5 : 1), fA + tP * 0.3, 0.028 * D, gH, detail);
    // block
    const depth = isCorner ? tw : dF;
    const rec = o.plaques ? 0.035 : tw * 0.07;
    const e0 = isCorner && i === 0 ? rec : 0, e1 = isCorner && i === trig.length - 1 ? rec : 0;
    box(mb, [s - tw / 2 + e0, yF0, fA - depth], [s + tw / 2 - e1, yF1, fA - 0.012 * D - rec], bev * 0.5, [0.05, 0, 0.5, 0]);
    const faces = [[s, 0]];
    if (isCorner) faces.push([i === 0 ? sF0 : sF1, i === 0 ? -1 : 1]);
    for (const [fs, side] of faces) {
      const tgt = o.plaques ? mg : mb;
      tgt.push();
      if (side === 0) tgt.translate(fs, yF0, fA - 0.012 * D);
      else { tgt.translate(fs, yF0, fA - tw / 2); tgt.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2); }
      if (o.plaques) plaque(mg, tw * 0.94, (yF1 - yF0) * 0.96, { depth: 0.03, field: B.mb.gilt });
      else triglyphFace(mb, tw, yF1 - yF0, { cap: 0.09 * (yF1 - yF0) });
      tgt.pop();
    }
  }
  // ---- metopes
  for (let i = 0; i < trig.length - 1; i++) {
    const s0 = trig[i] + tw / 2, s1 = trig[i + 1] - tw / 2;
    if (s1 - s0 < 0.2) continue;
    if (!owner && (s0 < sF0 - 1e-3 || s1 > sF1 + 1e-3)) {
      // partial metope near a corner on a flank: fill as plain slab
      const a = Math.max(s0, sF0), b = Math.min(s1, sF1);
      if (b - a > 0.05) box(mb, [a, yF0, fA - dF], [b, yF1, fA - mR], 0, [0.1, 0, 0.5, 0]);
      continue;
    }
    const rec = (o.plaques ? 0.12 * D : mR) * (0.85 + 0.3 * rnd(i, 7)); // deeper metope field on the gilded temple (relief depth)
    box(mb, [s0 + 0.003, yF0, fA - dF], [s1 - 0.003, yF1, fA - rec], bev * 0.3, [0.25, 0, 0.5, 0]);
    if (o.metopes) {
      const c = run.p((s0 + s1) / 2, (yF0 + yF1) / 2, fA - rec);
      o.metopes.push({ center: c, right: run.vec(1, 0), up: [0, 1, 0], normal: run.vec(0, 1), size: [s1 - s0, yF1 - yF0], recess: rec, runId: o.runId });
    }
  }
  // frieze crown band
  box(mb, [sF0 - (owner ? 0.01 * D : 0), yF1, fA - dF], [sF1 + (owner ? 0.01 * D : 0), y0 + hA + hF, fA + 0.012 * D], bev * 0.5, [0.1, 0.1, 0.5, 0]);
  // ---- geison: mutules with guttae, viae, corona, hawksbeak
  const yG0 = y0 + hA + hF;
  const mutS = [];
  for (let i = 0; i < trig.length; i++) {
    mutS.push(trig[i]);
    if (i < trig.length - 1) mutS.push((trig[i] + trig[i + 1]) / 2);
  }
  // soffit filler behind mutules
  box(mb, [sG0, yG0, fA - dG], [sG1, yG0 + mH, fA + 0.02 * D], 0, [0.4, 0, 0.1, 0]);
  for (const s of mutS) {
    if (!owner && (s - tw / 2 < sG0 || s + tw / 2 > sG1)) continue;
    box(mb, [s - tw / 2, yG0 - 0.01 * D, fA + 0.02 * D], [s + tw / 2, yG0 + mH, fA + ov - 0.05 * D], bev * 0.3, [0.35, 0.1, 0.1, 0]);
    if (detail >= 0.9) {
      for (let r = 0; r < 3; r++) {
        const zr = fA + 0.02 * D + (ov - 0.07 * D) * (r + 0.5) / 3;
        const gx = []; for (let g = 0; g < 6; g++) gx.push(s - tw / 2 + tw * (g + 0.5) / 6);
        guttae(mb, gx, yG0 - 0.01 * D, zr, 0.022 * D, 0.03 * D, detail);
      }
    }
  }
  // corona
  const cS0 = owner ? sG0 : sG0, cS1 = owner ? sG1 : sG1;
  box(mb, [cS0, yG0 + mH, fA - dG], [cS1, yG0 + hG - 0.07 * D, fA + ov], bev, [0.05, 0.2, 0.9, 0]);
  // hawksbeak / cymatium on top of the corona
  const hk = [[ov + 0.0, 0, 0.1, 0.3, true], [ov + 0.012 * D, 0.012 * D, 0.1, 0.5], [ov + 0.006 * D, 0.045 * D, 0.2, 0], [ov - 0.02 * D, 0.07 * D, 0.3, 0.4, true], [-dG, 0.07 * D, 0, 0]];
  mb.push(); mb.translate(0, yG0 + hG - 0.07 * D, 0);
  sweep(mb, hk.map(([o2, u, a, e, sh]) => [o2 + fA, u, a, e, sh]).map(([o2, u, a, e, sh]) => [o2, u, a, e, sh]), [[cS0, 0], [cS1, 0]], 0, { outward: -1, caps: true, streak: 0.3 });
  mb.pop();
  if (o.gild > 0) {
    // gilded fillet along the top edge of the corona
    box(mg, [cS0, yG0 + hG - 0.075 * D, fA + ov - 0.005 * D], [cS1, yG0 + hG - 0.06 * D, fA + ov + 0.008 * D], 0, [0.2, 0.3, 0, 0]);
  }
  mb.pop(); mg.pop();
  return { yTop: yG0 + hG, corona: [cS0, cS1] };
}

/**
 * Ionic entablature along a run: three fasciae, continuous frieze (with optional gilded plaques /
 * rosettes), egg-and-dart, dentils, corona, sima.
 * o: { y0, D, fA, dA, owner, hA, hF, hC, frieze: 'plain'|'plaques'|'rosettes', plaqueSpacing, detail, gild }
 */
export function ionicRun(B, run, o) {
  const mb = B.marble, mg = B.gold;
  const { y0, D, fA, dA, detail } = o;
  const hA = o.hA ?? 0.6 * D, hF = o.hF ?? 0.55 * D, hC = o.hC ?? 0.55 * D;
  const owner = !!o.owner;
  const L = run.len;
  const ov = o.ov ?? 0.55 * D;
  const sA0 = owner ? -fA : -fA + dA, sA1 = owner ? L + fA : L + fA - dA;
  const bev = 0.01 * D;
  run.frame(mb); run.frame(mg);
  // fasciae
  const fh = [0.26, 0.32, 0.42].map((k) => k * (hA - 0.08 * D));
  let y = y0;
  for (let i = 0; i < 3; i++) {
    const face = fA - 0.03 * D * (2 - i);
    const ext = owner ? face - fA : 0;
    box(mb, [sA0 - ext, y, fA - dA], [sA1 + ext, y + fh[i], face], bev * 0.6, [0.08 + 0.1 * i, 0, 0.5, 0]);
    y += fh[i];
  }
  // crowning cyma
  box(mb, [sA0, y, fA - dA], [sA1, y0 + hA, fA + 0.02 * D], bev, [0.2, 0.2, 0.3, 0]);
  // frieze
  const yF0 = y0 + hA, yF1 = yF0 + hF;
  const sF0 = owner ? -fA : -fA + dA, sF1 = owner ? L + fA : L + fA - dA;
  box(mb, [sF0, yF0, fA - dA], [sF1, yF1, fA - 0.02 * D], bev * 0.4, [0.1, 0, 0.6, 0]);
  if (o.frieze === 'plaques' || o.frieze === 'rosettes') {
    const sp = o.plaqueSpacing ?? 1.6 * D;
    const n = Math.max(1, Math.floor((sF1 - sF0) / sp));
    for (let i = 0; i < n; i++) {
      const s = sF0 + (i + 0.5) * ((sF1 - sF0) / n);
      if (o.frieze === 'plaques') { mg.push(); mg.translate(s, yF0 + hF * 0.06, fA - 0.02 * D); plaque(mg, hF * 0.62, hF * 0.88, { depth: 0.02, field: B.mb.gilt }); mg.pop(); }
      else { mb.push(); mb.translate(s, (yF0 + yF1) / 2, fA - 0.02 * D); rosette(mb, hF * 0.3, 8, { detail: detail > 0.5 ? 'hi' : 'low' }); mb.pop(); }
    }
  }
  // egg & dart + dentils
  const yD = yF1;
  if (detail >= 0.4) { mb.push(); mb.translate(sF0, yD, fA - 0.02 * D); eggAndDart(mb, sF1 - sF0, 0.07 * D, { detail: detail > 0.7 ? 'hi' : 'low' }); mb.pop(); }
  const yDen = yD + 0.07 * D, dh = 0.12 * D, dw = 0.08 * D, dsp = 0.13 * D;
  box(mb, [sF0, yDen, fA - dA * 0.6], [sF1, yDen + dh, fA + 0.02 * D], 0, [0.4, 0, 0.2, 0]);
  if (detail >= 0.3) {
    const sD0 = owner ? -fA - 0.08 * D : sF0 + 0.1 * D, sD1 = owner ? L + fA + 0.08 * D : sF1 - 0.1 * D;
    for (let s = sD0 + dw / 2; s < sD1 - dw / 2; s += dsp) box(mb, [s - dw / 2, yDen, fA], [s + dw / 2, yDen + dh, fA + 0.1 * D], 0.004 * D, [0.15, 0.3, 0.2, 0]);
  }
  // corona + sima
  const yC = yDen + dh;
  const sC0 = owner ? -fA - ov : -fA + dA, sC1 = owner ? L + fA + ov : L + fA - dA;
  box(mb, [sC0, yC, fA - dA], [sC1, yC + hC * 0.55, fA + ov], bev, [0.05, 0.2, 0.9, 0]);
  const yS = yC + hC * 0.55;
  if (o.flankSima !== false || owner) {
    // sima (cyma recta) along the run
    const sh = hC * 0.45;
    const prof = [[ov - 0.02 * D, 0, 0.2, 0, true]];
    for (let i = 0; i <= 6; i++) { const t = i / 6; prof.push([ov - 0.02 * D + 0.06 * D * (t - Math.sin(t * Math.PI * 2) * 0.12) + 0.04 * D * Math.sin(t * Math.PI), t * sh * 0.85, 0.1, 0]); }
    prof.push([ov + 0.06 * D, sh, 0.1, 0.4, true], [-dA, sh, 0, 0]);
    mb.push(); mb.translate(0, yS, 0);
    sweep(mb, prof.map(([a, b, c, d, e]) => [a + fA, b, c, d, e]), [[sC0, 0], [sC1, 0]], 0, { outward: -1, caps: true, streak: 0.2 });
    mb.pop();
    if (o.gild > 0) box(mg, [sC0, yS + sh - 0.02 * D, fA + ov + 0.04 * D], [sC1, yS + sh + 0.002 * D, fA + ov + 0.065 * D], 0, [0.2, 0.3, 0, 0]);
  }
  mb.pop(); mg.pop();
  return { yTop: yS + (o.flankSima !== false || owner ? hC * 0.45 : 0), yCorona: yS, ov };
}

/**
 * Pediment over an owner run: tympanum (recessed), raking geison + raking sima, acroteria.
 * o: { yBase (top of horizontal geison), fA, ov, D, pitch (rad), hR, simaH, set back mR,
 *      acroteria: 'palmette'|'nike'|'none', corners: 'griffin'|'palmette'|'none', acroScale, detail, gild, pediments[] }
 */
export function pediment(B, run, o) {
  const mb = B.marble, mg = B.gold;
  const { yBase, fA, ov, D, pitch } = o;
  const L = run.len;
  const hR = o.hR ?? 0.32 * D, simaH = o.simaH ?? 0.22 * D, mR = o.mR ?? 0.07 * D;
  const half = L / 2 + fA + ov;
  const Hp = half * Math.tan(pitch);
  const tanp = Math.tan(pitch);
  run.frame(mb); run.frame(mg); run.frame(B.mb.dome);
  // tympanum (triangle prism) — its top edges hide under the raking geison
  // o.recess: extra set-back of the tympanum behind the frieze face → deeper pediment floor so the
  // sculpture stands in depth layers (ref 5). The horizontal geison (soffit depth 0.5 D) is solid under it.
  const zT = fA - mR - Math.min(o.recess ?? 0, 0.4 * D);
  const tri = [[-fA + 0.02, 0], [L + fA - 0.02, 0], [L / 2, Hp + 0.02]];
  mb.push(); mb.translate(0, yBase, zT - 0.6 * D);
  // (r5) tympanum reads as a shadowed recess behind the sculpture (statues r3 request): grime cavity 0.3
  extrudeOutline(mb, tri, 0.6 * D, { aux: [0.3, 0, 0.45, 3.05], auxSide: [0.2, 0.2, 0.2, 0] });
  mb.pop();
  // pediment floor (top of horizontal geison) is from the caller; record pediment frame
  if (o.pediments) {
    o.pediments.push({
      origin: run.p(L / 2, yBase, zT), right: run.vec(1, 0), up: [0, 1, 0], normal: run.vec(0, 1),
      baseWidth: 2 * (half - ov) - 0.4, height: Hp - hR * 0.2, depth: (fA - zT) + ov - 0.05, pitch,
    });
  }
  // raking geison + sima (two slopes)
  for (const side of [-1, 1]) {
    const sx = side < 0 ? -fA - ov : L + fA + ov;
    const len = half / Math.cos(pitch);
    mb.push();
    mb.translate(sx, yBase, 0);
    mb.rotateZ(side < 0 ? pitch : Math.PI - pitch);
    if (side > 0) mb.rotateX(Math.PI); // keep +Z outward and "up" above the slope
    const zIn = side > 0 ? -(zT - 0.5 * D) : zT - 0.5 * D, zOut = side > 0 ? -(fA + ov) : fA + ov;
    box(mb, [0, 0, Math.min(zIn, zOut)], [len + 0.02, hR, Math.max(zIn, zOut)], 0.012 * D, [0.05, 0.2, 0.8, 0]);
    // raking sima: cyma recta swept along the slope
    const prof = [[0, 0, 0.2, 0, true]];
    for (let i = 0; i <= 6; i++) { const t = i / 6; prof.push([0.05 * D * Math.sin(t * Math.PI * 0.9) + 0.06 * D * t, t * simaH * 0.85, 0.1, 0]); }
    prof.push([0.13 * D, simaH, 0.1, 0.5, true], [-0.7 * D, simaH, 0, 0]);
    mb.push();
    mb.translate(0, hR, 0);
    const zf = side > 0 ? -(fA + ov) : fA + ov;
    if (side > 0) { mb.scale(1, 1, -1); }
    sweep(mb, prof.map(([a, b, c, d, e]) => [a + (fA + ov) - 0.04 * D, b, c, d, e]), [[0, 0], [len, 0]], 0, { outward: -1, caps: true, streak: 0.2 });
    mb.pop();
    void zf;
    if (o.gild > 0) {
      mg.push(); mg.translate(sx, yBase, 0); mg.rotateZ(side < 0 ? pitch : Math.PI - pitch); if (side > 0) mg.rotateX(Math.PI);
      const zG = side > 0 ? -(fA + ov + 0.09 * D) : fA + ov + 0.09 * D;
      box(mg, [0, hR + simaH - 0.025 * D, Math.min(zG, zG + (side > 0 ? -0.03 * D : 0.03 * D))], [len, hR + simaH + 0.004 * D, Math.max(zG, zG + (side > 0 ? -0.03 * D : 0.03 * D))], 0, [0.2, 0.3, 0, 0]);
      mg.pop();
    }
    mb.pop();
  }
  // acroteria
  const scale = o.acroScale ?? 1;
  const apexY = yBase + Hp + hR / Math.cos(pitch) + simaH * 0.6;
  if (o.acroteria && o.acroteria !== 'none') {
    const h = Math.max(1.0, 1.55 * D) * scale;
    mg.push(); mg.translate(L / 2, apexY - 0.05, fA + ov * 0.35);
    if (o.acroteria === 'nike') {
      // gilded group: palmette stele behind a winged Victory on a moulded plinth (bulky cluster, ref 5)
      box(mg, [-0.34 * h, 0, -0.22 * h], [0.34 * h, 0.12 * h, 0.22 * h], 0.012 * h, [0.1, 0.4, 0.2, 0]);
      mg.push(); mg.translate(0, 0.1 * h, -0.14 * h); mg.scale(0.8); palmetteAcroterion(mg, h, { detail: o.detail }); mg.pop();
      mg.translate(0, 0.1 * h, 0.02 * h); mg.merge(victoryGeometry(h * 0.95, o.detail), null, [0.15, 0.2, 0.2, 0]);
    }
    else palmetteAcroterion(mg, h, { detail: o.detail });
    if (o.apexGroup) {
      // flanking seated griffins make the apex group read as a bulky gilded cluster (ref 5)
      for (const s of [-1, 1]) {
        mg.push(); mg.translate(s * h * 0.42, -0.02, -0.05 * h); mg.rotateY(s * 1.1);
        mg.merge(griffinGeometry(h * 0.62, o.detail), null, [0.15, 0.2, 0.2, 0]);
        mg.pop();
      }
    }
    mg.pop();
  }
  // small palmette antefixes along the raking sima crest
  if (o.rakingAntefixes) {
    const tgt = (o.gild ?? 0) > 0.5 ? B.mb.dome : mb; // dark antique gilt-bronze crest (ref 5); bright gold reads white against the sky
    const ah = o.rakingAntefixH ?? Math.min(0.46, 0.24 * D); // big enough to read from the forecourt (ref 5 crest of gilded lumps)
    const slopeLen = half / Math.cos(pitch);
    const n = Math.floor((slopeLen - 2.2) / (o.rakingSpacing ?? 1.25));
    for (const side of [-1, 1]) {
      for (let i = 1; i <= n; i++) {
        const t = (i / (n + 1)) * slopeLen;
        const sh = t * Math.cos(pitch);
        const s = side < 0 ? -fA - ov + sh : L + fA + ov - sh;
        const y = yBase + t * Math.sin(pitch) + (hR + simaH) / Math.cos(pitch) - 0.03;
        tgt.push(); tgt.translate(s, y, fA + ov + 0.02 * D);
        antefix(tgt, ah, 0.05, o.detail ?? 1);
        tgt.pop();
      }
    }
  }
  if (o.corners && o.corners !== 'none') {
    const h = Math.max(0.8, 1.1 * D) * scale;
    for (const side of [-1, 1]) {
      const sx = side < 0 ? -fA - ov * 0.45 : L + fA + ov * 0.45;
      mg.push(); mg.translate(sx, yBase + hR + simaH * 0.4, fA + ov * 0.35);
      if (o.corners === 'griffin') { mg.rotateY(side < 0 ? -0.5 : 0.5); mg.merge(griffinGeometry(h, o.detail), null, [0.15, 0.2, 0.2, 0]); }
      else { mg.scale(0.7); palmetteAcroterion(mg, h, { detail: o.detail * 0.6 }); }
      mg.pop();
    }
  }
  mb.pop(); mg.pop(); B.mb.dome.pop();
  return { Hp, apexY, half };
}

/**
 * Tiled marble roof with ridge along Z.  Building-local.
 * o: { xo: half width at eaves (outer edge), z0, z1 (extent), yEaves, pitch, tileW (cover tile spacing),
 *      courseL (pan course length), antefixes: bool (flank antefixes at eaves), ridgePalmettes, detail, gild }
 */
export function tiledRoof(B, o) {
  const mb = B.mb.roof || B.marble, mg = B.gold, mbM = B.marble;
  const { xo, z0, z1, yEaves, pitch } = o;
  const tanp = Math.tan(pitch), cosp = Math.cos(pitch);
  const yRidge = yEaves + xo * tanp;
  const tw = o.tileW ?? 0.76, cl = o.courseL ?? 0.84;
  const thick = 0.18;
  for (const side of [-1, 1]) {
    // underlay slab (sloped box)
    mb.push();
    mb.translate(side * xo, yEaves, 0);
    if (side < 0) mb.rotateZ(pitch); else { mb.rotateZ(-pitch); mb.scale(-1, 1, 1); }
    // local: x from 0 (eaves) inward to slope length, y up (normal to slope)
    const sl = xo / cosp;
    box(mb, [0, -thick, z0], [sl + 0.05, 0, z1], 0, [0.1, 0, 0.3, 0]);
    const nC = Math.max(2, Math.floor(sl / cl));
    const nT = Math.floor((z1 - z0) / tw);
    const det = o.detail ?? 1;
    if (det < 0.3) {
      // far LOD: continuous pan courses + ridges
      for (let c = 0; c < nC; c++) {
        const x0 = c * (sl / nC), x1 = (c + 1) * (sl / nC);
        quadOut(mb, [x0, 0.045, z1], [x0, 0.045, z0], [x1, 0.0, z0], [x1, 0.0, z1], [0, 1, 0], [0.15, 0, 0.2, 0]);
        quadOut(mb, [x0, 0.0, z1], [x0, 0.0, z0], [x0, 0.045, z0], [x0, 0.045, z1], [-1, 0, 0], [0.5, 0.2, 0.1, 0]);
      }
      const w = 0.13, h = 0.12;
      for (let t = 1; t < nT; t++) {
        const z = z0 + (z1 - z0) * (t / nT), a = [0.25, 0.3, 0.1, 0];
        quadOut(mb, [0, 0, z - w], [sl, 0, z - w], [sl, h, z - w * 0.3], [0, h, z - w * 0.3], [0, 1, -1], a);
        quadOut(mb, [0, h, z - w * 0.3], [sl, h, z - w * 0.3], [sl, h, z + w * 0.3], [0, h, z + w * 0.3], [0, 1, 0], a);
        quadOut(mb, [0, h, z + w * 0.3], [sl, h, z + w * 0.3], [sl, 0, z + w], [0, 0, z + w], [0, 1, 1], a);
      }
    } else {
      // (r5) individual tiles: every pan has its own tone (aux.x) and a grime gutter along the cover
      // tiles; every cover tile is a separate ridged piece with a lip at each course, so the roof reads
      // as a dense tile grid from far above (ref 4) and holds at 4K
      const w = 0.13, h = 0.12, lip = 0.045, gw = 0.06;
      const zs = []; for (let t = 0; t <= nT; t++) zs.push(z0 + (z1 - z0) * (t / nT));
      for (let c = 0; c < nC; c++) {
        const x0 = c * (sl / nC), x1 = (c + 1) * (sl / nC);
        for (let t = 0; t < nT; t++) {
          const za = zs[t] + (t > 0 ? w * 0.9 : 0), zb = zs[t + 1] - (t < nT - 1 ? w * 0.9 : 0);
          const r = hash3(c * 131 + side * 7, t, 913);
          const patch = vnoise3(c * 0.22 + side * 5.3, t * 0.13, 1.7);            // lichen-darkened tile colonies
          const tone = 0.04 + 0.2 * r * r + 0.3 * Math.max(0, patch - 0.45) + (hash3(c, t * 3 + side, 77) > 0.93 ? 0.25 : 0);
          const aP = [tone, 0, 0.15, 0], aG = [Math.min(1, tone + 0.62), 0, 0.3, 0];
          // pan: grime gutters along both cover tiles + clean centre band, sloping down to the next course
          const zg0 = za + gw, zg1 = zb - gw;
          quadOut(mb, [x0, lip, za], [x0, lip, zg0], [x1, 0.0, zg0], [x1, 0.0, za], [0, 1, 0], aG);
          quadOut(mb, [x0, lip, zg0], [x0, lip, zg1], [x1, 0.0, zg1], [x1, 0.0, zg0], [0, 1, 0], aP);
          quadOut(mb, [x0, lip, zg1], [x0, lip, zb], [x1, 0.0, zb], [x1, 0.0, zg1], [0, 1, 0], aG);
          // lip (front edge of the course above casts a thin shadow line)
          quadOut(mb, [x0, 0.0, za], [x0, 0.0, zb], [x0, lip, zb], [x0, lip, za], [-1, 0, 0], [0.55, 0.3, 0.1, 0]);
        }
        // cover tiles of this course
        for (let t = 1; t < nT; t++) {
          const z = zs[t];
          const r = hash3(c * 17 + side, t * 5, 431);
          const a = [0.08 + 0.18 * r, 0.35, 0.1, 0];
          const hh = h * (0.94 + 0.12 * r), xa = x0 + 0.01, xb = x1 + 0.03;
          quadOut(mb, [xa, lip, z - w], [xb, 0.0, z - w], [xb, hh, z - w * 0.35], [xa, hh + lip, z - w * 0.35], [0, 1, -1], a);
          quadOut(mb, [xa, hh + lip, z - w * 0.35], [xb, hh, z - w * 0.35], [xb, hh, z + w * 0.35], [xa, hh + lip, z + w * 0.35], [0, 1, 0], a);
          quadOut(mb, [xa, hh + lip, z + w * 0.35], [xb, hh, z + w * 0.35], [xb, 0.0, z + w], [xa, lip, z + w], [0, 1, 1], a);
          // lower end cap (faces the eaves): small dark shadow step at every course
          quadOut(mb, [xa, lip, z + w], [xa, lip, z - w], [xa, hh + lip, z - w * 0.35], [xa, hh + lip, z + w * 0.35], [-1, 0, 0], [0.5, 0.3, 0.1, 0]);
        }
      }
    }
    mb.pop();
    // antefixes along the eaves
    if (o.antefixes) {
      const tgt = o.gild > 0.5 ? mg : mbM;
      for (let t = 1; t < nT; t++) {
        const z = z0 + (z1 - z0) * (t / nT);
        tgt.push();
        tgt.translate(side * (xo + 0.02), yEaves - 0.04, z);
        tgt.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
        antefix(tgt, o.antefixH ?? 0.42, 0.05, o.detail ?? 1);
        tgt.pop();
      }
    }
  }
  // ridge cap
  box(mb, [-0.22, yRidge - 0.08, z0], [0.22, yRidge + 0.16, z1], 0.03, [0.2, 0.3, 0.3, 0]);
  if (o.ridgePalmettes) {
    const tgt = o.gild > 0.5 ? B.mb.dome : mbM;
    const nT = Math.floor((z1 - z0) / (tw * 3));
    for (let t = 1; t < nT; t++) {
      const z = z0 + (z1 - z0) * (t / nT);
      tgt.push(); tgt.translate(0, yRidge + 0.12, z); tgt.rotateY(Math.PI / 2); tgt.translate(0, 0, -0.02); antefix(tgt, 0.36, 0.04, o.detail ?? 1); tgt.pop();
    }
  }
  return { yRidge };
}
