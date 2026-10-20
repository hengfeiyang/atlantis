// Tholos / monopteros: round temple with a ring of Corinthian columns on a stepped circular podium,
// circular entablature (fasciae, frieze with gilded plaques, dentils, corona, sima with small gilded
// acroteria), gilded ribbed dome with lantern finial, coffered ceiling, statue pedestal inside.
// Building-local frame: origin = centre of the stylobate top.
import * as THREE from 'three';
import { Building } from './build.js';
import { box, lathe, surface, ellipsoid, tube, lerp, clamp, smooth, hash3, extrudeOutline } from './geom.js';
import { columnGeometry, columnInfo, seg } from './orders.js';
import { plaque, antefix, palmetteOutline, rosette } from './ornament.js';

const PI = Math.PI;

/**
 * @param {object} o
 *  radius: stylobate radius (m, default 7.4); columns (14); colH (7.2); order ('corinthian');
 *  steps (5), stepH (0.3), tread (0.45); dome: {ribs, rise, gilded}; lantern (true); cella: false (open)
 *  detail, seed, name, statue (true → statue slot on a central pedestal)
 */
export function tholos(o = {}) {
  const t0 = performance.now();
  const B = new Building(o.name || 'tholos', { detail: o.detail ?? 1, seed: o.seed ?? 3, variant: o.variant, tint: o.tint, overrides: o.overrides });
  const detail = B.detail, seed = o.seed ?? 3;
  const mb = B.marble, mg = B.gold;
  const R = o.radius ?? 7.4;
  const n = o.columns ?? 14;
  const colH = o.colH ?? 7.2;
  const order = o.order || 'corinthian';
  const ci = columnInfo({ order, height: colH, diameter: o.D });
  const D = ci.D;
  const Rc = R - 0.75 * D;
  const segs = seg(detail, 48, 120);
  // ---- stepped circular podium (with block joints via ashlar flag on risers)
  const steps = o.steps ?? 5, sh = o.stepH ?? 0.3, tr = o.tread ?? 0.45;
  const pr = [];
  const rOut = R + steps * tr;
  pr.push([rOut + 0.2, -steps * sh - (o.foundation ?? 2.5), 0.2, 0, true]);
  pr.push([rOut + 0.2, -steps * sh, 0.1, 0.3, true]);
  for (let k = steps - 1; k >= 0; k--) {
    const r = R + k * tr, y = -k * sh;
    pr.push([r + tr - 0.0, y - sh, 0.1, 0.2, true]);
    pr.push([r + tr + 0.0, y - 0.03, 0.05, 1, false]);
    pr.push([r + tr - 0.03, y, 0.05, 1, true]);
    pr.push([r, y, 0.15, 0, true]);
  }
  // ashlar flags on vertical parts are set through lathe aux → use streak param only; joints via shader need aux.w
  lathe(mb, pr.map((p) => p), segs, { streak: 0.3, masonry: 3 + sh / 10 });
  // radial joints on the step treads: thin dark grooves as small boxes (cheap look of individual blocks)
  if (detail > 0.4) {
    for (let k = 0; k < steps; k++) {
      const r0 = R + k * tr, nb = Math.round((2 * PI * (r0 + tr)) / 1.6);
      for (let i = 0; i < nb; i++) {
        const a = ((i + hash3(seed, k, i) * 0.4) / nb) * 2 * PI;
        mb.push(); mb.rotateY(a); mb.translate(0, -k * sh, r0 + tr * 0.5);
        box(mb, [-0.006, -sh + 0.02, -tr * 0.5 - 0.01], [0.006, 0.002, tr * 0.5 + 0.01], 0, [0.9, 0, 0, 0]);
        mb.pop();
      }
    }
  }
  B.occFn([-rOut, -steps * sh - 1, -rOut], [rOut, 0, rOut], (x, y, z) => Math.hypot(x, z) < R + Math.floor((-y) / sh + 1) * tr);
  // paving
  surface(mb, (u, v, out) => { const a = u * 2 * PI, r = v * (R + 0.01); out[0] = Math.sin(a) * r; out[1] = 0.0; out[2] = Math.cos(a) * r; }, 48, 4, { closedU: true, flip: true, aux: [0.05, 0, 0, 5.12] });
  // ---- columns
  const colGeo = columnGeometry({ order, height: colH, diameter: D, detail: detail * (o.columnDetail ?? 0.7) });
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * 2 * PI;
    const x = Math.sin(a) * Rc, z = Math.cos(a) * Rc;
    m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a + Math.floor(hash3(seed, i, 1) * 4) * (PI / 2), 0)), new THREE.Vector3(1, 1, 1));
    B.addInstance('columns', colGeo.geometry, m4);
    B.occCyl(x, z, D / 2, 0, colH);
  }
  // ---- circular entablature (lathe): architrave fasciae, frieze, dentil band, corona, sima
  const ab = ci.abacus;
  const rA = Rc + ab * 0.48, rI = Rc - ab * 0.5;
  const hA = (o.hA ?? 0.78) * D, hF = (o.hF ?? 0.95) * D;
  const y0 = colH;
  const ep = [];
  ep.push([rA - 0.06 * D, y0, 0.3, 0, true]);
  ep.push([rA - 0.06 * D, y0 + hA * 0.28, 0.2, 0.2, true]);
  ep.push([rA - 0.03 * D, y0 + hA * 0.28, 0.4, 0, true]);
  ep.push([rA - 0.03 * D, y0 + hA * 0.6, 0.2, 0.2, true]);
  ep.push([rA, y0 + hA * 0.6, 0.4, 0, true]);
  ep.push([rA, y0 + hA * 0.9, 0.1, 0.2, true]);
  ep.push([rA + 0.04 * D, y0 + hA, 0.2, 0.4, true]);
  ep.push([rA - 0.01 * D, y0 + hA, 0.5, 0, true]);
  const yF1 = y0 + hA + hF;
  ep.push([rA - 0.01 * D, yF1, 0.1, 0, true]);
  ep.push([rA + 0.05 * D, yF1 + 0.06 * D, 0.3, 0.3, true]);  // ovolo
  ep.push([rA + 0.05 * D, yF1 + 0.08 * D, 0.5, 0, true]);
  const yDen = yF1 + 0.08 * D, dh = 0.12 * D;
  ep.push([rA + 0.04 * D, yDen + dh, 0.6, 0, true]);
  const ovC = 0.45 * D, hC = 0.28 * D;
  ep.push([rA + ovC, yDen + dh + 0.01, 0.4, 0.1, true]);  // corona soffit
  ep.push([rA + ovC, yDen + dh + hC, 0.05, 0.6, true]);
  const yS = yDen + dh + hC;
  for (let i = 0; i <= 6; i++) { const t = i / 6; ep.push([rA + ovC - 0.02 * D + 0.08 * D * t + 0.04 * D * Math.sin(t * PI), yS + t * 0.22 * D, 0.1, i === 6 ? 0.5 : 0]); }
  const ySimaTop = yS + 0.22 * D;
  ep.push([rA + ovC + 0.06 * D, ySimaTop, 0.1, 0.4, true]);
  ep.push([rI - 0.1, ySimaTop, 0.1, 0, true]);
  lathe(mb, ep, segs, { streak: 0.6 });
  // inner face + soffit
  lathe(mb, [[rI, ySimaTop - 0.001, 0.3, 0, true], [rI, y0, 0.3, 0, true], [rA - 0.06 * D, y0, 0.3, 0]], segs, {});
  B.occFn([-rA - ovC, y0, -rA - ovC], [rA + ovC, ySimaTop, rA + ovC], (x, y, z) => { const r = Math.hypot(x, z); return r > rI && r < rA + (y > yDen ? ovC : 0); });
  // gilded sima fillet
  if ((o.gild ?? 1) > 0) lathe(mg, [[rA + ovC + 0.065 * D, ySimaTop - 0.03 * D, 0.2, 0.3, true], [rA + ovC + 0.075 * D, ySimaTop + 0.004, 0.2, 0.3, true]], segs, {});
  // dentils
  if (detail > 0.3) {
    const nd = Math.round((2 * PI * rA) / (0.14 * D));
    for (let i = 0; i < nd; i++) {
      const a = (i / nd) * 2 * PI;
      mb.push(); mb.rotateY(a); mb.translate(0, yDen, rA + 0.04 * D);
      box(mb, [-0.04 * D, 0, -0.02], [0.04 * D, dh, 0.08 * D], detail > 0.7 ? 0.004 : 0, [0.15, 0.3, 0.2, 0]);
      mb.pop();
    }
  }
  // frieze: gilded plaques alternating with relief panels (published as metopes → the statues module
  // carves figures into them, ref 2: sculpted frieze panels between gold plaques)
  const nP = o.friezePanels === false ? n * 3 : n * 2;
  const rF = rA - 0.01 * D;
  for (let i = 0; i < nP; i++) {
    const a = (i / nP) * 2 * PI;
    if (o.friezePanels === false || i % 2 === 0) {
      mg.push(); mg.rotateY(a); mg.translate(0, y0 + hA + hF * 0.08, rF);
      plaque(mg, hF * 0.44, hF * 0.8, { depth: 0.02, field: B.mb.gilt });
      mg.pop();
      continue;
    }
    const pw = Math.max(0.3, (2 * PI * rF) / nP * 2 - hF * 0.44 - 0.25), ph = hF * 0.78;
    // thin moulded frame around the panel
    mb.push(); mb.rotateY(a); mb.translate(0, y0 + hA + hF * 0.09, rF);
    for (const [x0, y0f, x1, y1f] of [[-pw / 2 - 0.05, 0, pw / 2 + 0.05, 0.05], [-pw / 2 - 0.05, ph - 0.05, pw / 2 + 0.05, ph], [-pw / 2 - 0.05, 0, -pw / 2, ph], [pw / 2, 0, pw / 2 + 0.05, ph]]) box(mb, [x0, y0f, -0.02], [x1, y1f, 0.035], 0, [0.2, 0.4, 0.3, 0]);
    mb.pop();
    if (detail > 0.3) B.info.metopes.push({ center: [Math.sin(a) * rF, y0 + hA + hF * 0.09 + ph / 2, Math.cos(a) * rF], right: [Math.cos(a), 0, -Math.sin(a)], up: [0, 1, 0], normal: [Math.sin(a), 0, Math.cos(a)], size: [pw, ph], recess: 0.0, runId: 'tholos-frieze' });
  }
  // small gilded palmette acroteria around the sima (above each column)
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * 2 * PI;
    mg.push(); mg.rotateY(a); mg.translate(0, ySimaTop - 0.05, rA + ovC + 0.0 * D);
    mg.translate(0, 0, -0.05); extrudeOutline(mg, palmetteOutline((o.palmetteH ?? 0.72) * D, 7, 40), 0.08, { aux: [0.15, 0.3, 0.2, 0], auxSide: [0.3, 0.6, 0.2, 0] });
    mg.pop();
  }
  // ---- coffered ceiling (underside) + dome
  const yCeil = yDen;
  surface(B.mb.interior, (u, v, out) => { const a = u * 2 * PI, r = v * rI; out[0] = Math.sin(a) * r; out[1] = yCeil; out[2] = Math.cos(a) * r; }, 40, 4, { closedU: true, aux: (u, v) => [0.3 + 0.4 * (1 - v), 0, 0, 0] });
  // coffer rings
  for (const rr of [rI * 0.35, rI * 0.62, rI * 0.88]) lathe(mb, [[rr - 0.12, yCeil, 0.5, 0, true], [rr - 0.12, yCeil - 0.18, 0.3, 0.3, true], [rr + 0.12, yCeil - 0.18, 0.3, 0.3, true], [rr + 0.12, yCeil, 0.5, 0]], Math.round(segs / 2), {});
  // dome: low ribbed cupola, gilded panels + ribs
  // (r5) twice as many ribs, deeper panel sag, horizontal ring bands and tarnish toward the ribs: the
  // dome reads as a ribbed, panelled gilt cupola (ref 2) instead of a smooth gold cap
  const ribs = o.ribs ?? n * 2;
  const rD = rA + 0.05 * D, rise = o.rise ?? rD * 0.34;
  const yD0 = ySimaTop - 0.05;
  const domeProf = (t) => [rD * Math.cos((t * PI) / 2) * (1 - 0.06 * t), yD0 + rise * Math.sin((t * PI) / 2)];
  const domeTgt = (o.gild ?? 1) > 0 ? B.mb.gilt : mb; // pale matte gilt panels, bright gold ribs (ref 2)
  const nT = seg(detail, 10, 26), nA = seg(detail, ribs * 4, ribs * 6);
  const sag = Math.min(0.16, rD * 0.018);
  surface(domeTgt, (u, v, out) => {
    const a = u * 2 * PI;
    const t = v * 0.9;
    let [r, y] = domeProf(t);
    const k = (u * ribs) % 1;
    r -= sag * Math.sin(k * PI) * (1 - t * 0.8);
    out[0] = Math.sin(a) * r; out[1] = y; out[2] = Math.cos(a) * r;
  }, nA, nT, { closedU: true, aux: (u, v) => { const k = (u * ribs) % 1; return [0.22 + 0.45 * (1 - Math.pow(Math.sin(k * PI), 0.6)) + 0.12 * v, 0.0, 0.3, 0]; } });
  // ring bands across the panels
  const nRing = detail > 0.4 ? 3 : 2;
  for (let j = 1; j <= nRing; j++) {
    const tj = (j / (nRing + 1)) * 0.82;
    const [rr, yy] = domeProf(tj);
    tube(mg, (t, out) => { const a = t * 2 * PI; out[0] = Math.sin(a) * (rr + 0.01); out[1] = yy + 0.015; out[2] = Math.cos(a) * (rr + 0.01); }, 0.05 + 0.02 * (1 - tj), Math.round(nA / 2), 4, { aux: [0.15, 0.5, 0.2, 0] });
  }
  // ribs
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * 2 * PI;
    tube(mg, (t, out) => { const [r, y] = domeProf(t * 0.9); out[0] = Math.sin(a) * (r + 0.02); out[1] = y + 0.02; out[2] = Math.cos(a) * (r + 0.02); }, (t) => 0.13 * (1 - 0.5 * t), seg(detail, 8, 18), 5, { aux: [0.1, 0.5, 0.2, 0] });
    // small gilded finial at the rib foot
    mg.push(); mg.translate(Math.sin(a) * (rD + 0.05), yD0 + 0.12, Math.cos(a) * (rD + 0.05)); ellipsoid(mg, 0.12, 0.2, 0.12, 8, 6, [0.1, 0.4, 0.2, 0]); mg.pop();
  }
  // lantern: small drum + cap + onion finial
  const yTop = domeProf(0.9)[1];
  const rL = domeProf(0.9)[0];
  // open lantern (ref 2): base ring, ring of slender colonnettes around a dark core, gilded cap
  const rLa = rL * 0.72, hLa = Math.max(0.9, rLa * 1.5);
  lathe(mb, [[rL + 0.05, yTop - 0.05, 0.3, 0, true], [rL * 0.92, yTop + 0.06, 0.2, 0.3, true], [rLa + 0.08, yTop + 0.1, 0.2, 0.4, true], [rLa + 0.08, yTop + 0.22, 0.1, 0.4, true], [0.0001, yTop + 0.22, 0, 0]], 24, {});
  lathe(B.mb.interior, [[rLa * 0.55, yTop + 0.2, 0.6, 0, true], [rLa * 0.55, yTop + 0.22 + hLa, 0.6, 0, true]], 16, {});
  const nLc = 8;
  for (let i = 0; i < nLc; i++) {
    const a = (i / nLc) * 2 * PI;
    mb.push(); mb.translate(Math.sin(a) * rLa * 0.88, yTop + 0.22, Math.cos(a) * rLa * 0.88);
    lathe(mb, [[0.075, 0, 0.2, 0.3, true], [0.06, 0.06, 0.1, 0, true], [0.05, hLa - 0.08, 0.1, 0, true], [0.085, hLa, 0.2, 0.4, true]], 8, {});
    mb.pop();
  }
  const yLc = yTop + 0.22 + hLa;
  lathe(mb, [[rLa + 0.12, yLc, 0.2, 0.5, true], [rLa + 0.12, yLc + 0.12, 0.1, 0.5, true], [0.0001, yLc + 0.12, 0, 0]], 24, {});
  lathe(B.mb.gilt, [[rLa + 0.06, yLc + 0.12, 0.1, 0.4, true], [rLa * 0.7, yLc + 0.3, 0.1, 0, false], [rLa * 0.3, yLc + 0.46, 0.1, 0, false], [0.0001, yLc + 0.5, 0, 0]], 24, {});
  for (let i = 0; i < nLc; i++) { const a = (i / nLc) * 2 * PI; tube(mg, (t, out) => { const r = lerp(rLa + 0.08, 0.05, t), y = yLc + 0.12 + 0.38 * Math.sin(t * PI / 2); out[0] = Math.sin(a) * r; out[1] = y + 0.02; out[2] = Math.cos(a) * r; }, () => 0.035, 6, 4, { aux: [0.1, 0.5, 0.2, 0] }); }
  const yF = yLc + 0.48;
  const fs = o.finialScale ?? Math.max(1, R / 5.5);
  lathe(mg, [[0.18, 0, 0.2, 0, true], [0.32, 0.25, 0, 0], [0.36, 0.45, 0, 0], [0.26, 0.72, 0, 0], [0.1, 0.92, 0.1, 0], [0.07, 1.05, 0.1, 0], [0.13, 1.12, 0, 0.3], [0.13, 1.2, 0, 0.3], [0.06, 1.28, 0, 0], [0.045, 1.7, 0, 0.3], [0.0001, 2.0, 0, 0.5]].map(([r, y, a, b, c]) => [r * fs, yF + y * fs, a, b, c]), 20, {});
  B.occFn([-rD, yD0, -rD], [rD, yTop + 0.7, rD], (x, y, z) => { const r = Math.hypot(x, z); return y < yD0 + rise * Math.sqrt(Math.max(0, 1 - (r / rD) ** 2)); });
  // ---- statue pedestal inside
  if (o.statue !== false) {
    const ph = 1.0, pw = 1.5;
    box(mb, [-pw / 2 - 0.12, 0, -pw / 2 - 0.12], [pw / 2 + 0.12, 0.22, pw / 2 + 0.12], 0.02, [0.1, 0.6, 0.1, 0]);
    box(mb, [-pw / 2, 0.22, -pw / 2], [pw / 2, ph - 0.2, pw / 2], 0.02, [0.1, 0.3, 0.4, 0]);
    box(mb, [-pw / 2 - 0.1, ph - 0.2, -pw / 2 - 0.1], [pw / 2 + 0.1, ph, pw / 2 + 0.1], 0.02, [0.1, 0.6, 0.3, 0]);
    B.info.statues.push({ pos: [0, ph, 0], dir: [0, 0, 1], size: Math.min(colH * 0.55, 4), tag: 'tholos', pedestal: true });
    B.occBox([-pw / 2, 0, -pw / 2], [pw / 2, ph, pw / 2]);
  }
  B.info.anchors = { R, Rc, rOut, colH, steps, stepH: sh, tread: tr, yTop: yF + 2.0 * fs, domeBase: yD0, crepH: steps * sh };
  B.info.footprint = { r: rOut + 0.3 };
  B.genMs = Math.round(performance.now() - t0);
  return B;
}
