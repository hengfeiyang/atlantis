// Wall towers: square towers on the ring walls, every ~70 m and flanking the bridge gates / canal.
// Two designs — 'dome' (white shaft with red bands, corner quoins, gilt medallion, crenellated platform,
// windowed drum and a gold dome) and 'tholos' (banded red/white shaft, open round colonnade with a gold dome
// and a trident finial, ref 2). Geometry is built once per (edge level, design, base, ruin state) and
// instanced. Sunken: domes gone, shafts broken, some leaning.
import * as THREE from 'three';
import { GeoBuilder, Frame, chamferBox, box, sweep, lathe, FACES, AUX_ASHLAR, AUX_PAVING, mul3 } from './geo.js';
import { TOWER_HALF, TOWER_PROJ, polarXZ, inShedRange } from './plan.js';
import { ruined, ruinRand } from '../world/era.js';

const P_CORNICE = [[0, 0], [0.06, 0], [0.06, 0.15], [0.2, 0.28], [0.34, 0.44], [0.44, 0.5], [0.55, 0.53], [0.55, 0.74], [0.62, 0.8], [0.65, 0.9]];
const COL = [1, 1, 1];

class Kit {
  constructor() { this.B = {}; }
  get(mat) { return (this.B[mat] ||= new GeoBuilder()); }
}

/** archway window (dark void) on a face of frame F at local s centre, sill y, width w, height h, at depth d */
function archWindow(K, F, s, y, w, h, d, n = 6) {
  const V = K.get('void');
  const r = w / 2, ys = y + h - r;
  V.quadToward(F.p(s - r, y, d), F.p(s + r, y, d), F.p(s + r, ys, d), F.p(s - r, ys, d), COL, F.az);
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI * (i / n), a1 = Math.PI * ((i + 1) / n);
    V.polyToward([F.p(s, ys, d), F.p(s + Math.cos(a0) * r, ys + Math.sin(a0) * r, d), F.p(s + Math.cos(a1) * r, ys + Math.sin(a1) * r, d)], COL, F.az);
  }
  // gilt surround
  const G = K.get('gilt');
  box(G, F, s - r - 0.12, s - r, y, ys, d - 0.05, d + 0.06, COL, FACES.pz | FACES.nx);
  box(G, F, s + r, s + r + 0.12, y, ys, d - 0.05, d + 0.06, COL, FACES.pz | FACES.px);
  box(G, F, s - r - 0.2, s + r + 0.2, y - 0.16, y, d - 0.05, d + 0.12, COL, FACES.pz | FACES.py);
}

/** the four face frames of a square of half width hw centred at Fc (each +d outward) */
function faces4(Fc, hw) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const F = Fc.yawed((i * Math.PI) / 2);
    out.push(F.at(0, 0, hw));
  }
  return out; // i = 0 front (+d), 1, 2 back, 3
}

/**
 * Build one tower geometry kit.
 * spec: { y0 (land), wallTop, yb (base), design: 'dome'|'tholos', state: 'intact'|'nodome'|'broken', water: bool, lod }
 */
export function towerKit(spec) {
  const K = new Kit();
  const pylon = spec.design === 'pylon';
  const hw = pylon ? PYLON_HALF : TOWER_HALF, dc = TOWER_PROJ - hw;
  const Fc = new Frame([0, 0, dc], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const yS = spec.wallTop + (pylon ? 9.5 : 4.5), yPl = yS + 0.9;
  const broken = spec.state === 'broken';
  const yCut = broken ? spec.y0 + (yS - spec.y0) * ((spec.cutLow ? 0.22 : 0.55) + 0.2 * (spec.seed || 0)) : yS;   // r4: cutLow = shed-mole stumps (shot 8)
  const shaftMat = spec.banded ? 'banded' : 'white';
  const faces = faces4(Fc, hw);
  // ---- shaft
  for (let i = 0; i < 4; i++) {
    const F = faces[i];
    const S = K.get(shaftMat);
    S.aux = [0, 0, 0.25, AUX_ASHLAR(0.7)];
    S.quadToward(F.p(-hw, spec.yb, 0), F.p(hw, spec.yb, 0), F.p(hw, yCut, 0), F.p(-hw, yCut, 0), COL, F.az);
    S.aux = [0, 0, 0, 0];
    // wet zone + rusticated base for towers standing in the water
    if (spec.water) {
      const L = K.get('lime');
      L.aux = [0.2, 0, 0, AUX_ASHLAR(1.0)];
      L.quadToward(F.p(-hw - 0.25, spec.yb, 0.25), F.p(hw + 0.25, spec.yb, 0.25), F.p(hw + 0.25, 0.7, 0.25), F.p(-hw - 0.25, 0.7, 0.25), [0.5, 0.52, 0.46], F.az);
      L.aux = [0, 0.4, 0, 0];
      for (let k = 0; k < 4; k++) chamferBox(L, F, -hw - 0.25 + k * (2 * hw + 0.5) / 4 + 0.02, -hw - 0.25 + (k + 1) * (2 * hw + 0.5) / 4 - 0.02, 0.7, 2.1, -0.3, 0.28, 0.1, [0.9 - 0.04 * (k % 2), 0.88, 0.85], FACES.pz | FACES.py | FACES.px | FACES.nx);
      L.aux = [0, 0, 0, 0];
    }
    // string course at the land top and at the curtain top
    const W = K.get('white');
    W.aux = [0, 0.3, 0, 0];
    for (const ys of [spec.y0 - 0.1, spec.wallTop - 0.4]) {
      if (ys + 0.5 > yCut) continue;
      sweep(W, F, -hw - 0.3, hw + 0.3, [[0, ys], [0.18, ys + 0.05], [0.24, ys + 0.18], [0.24, ys + 0.36], [0.12, ys + 0.48], [0, ys + 0.5]], [0.95, 0.94, 0.92], true);
    }
    // corner quoins
    W.aux = [0, 0.5, 0, AUX_ASHLAR(0.7)];
    const q0 = Math.max(spec.y0, spec.yb + 0.3);
    chamferBox(W, F, hw - (pylon ? 0.75 : 0.95), hw + 0.001, q0, Math.min(yCut, yS), -0.02, pylon ? 0.3 : 0.16, 0.05, [0.97, 0.96, 0.94], FACES.pz | FACES.nx | FACES.px);
    W.aux = [0, 0, 0, 0];
    if (broken) {
      // r5 (ref 8 background, shot 8): the broken stumps keep remnants of their ornament instead of a plain slab —
      // a tall dark arched niche with its gilt surround on every face, a red band (white design) and pilaster strips
      const top = yCut - 1.3, nb = Math.max(spec.y0, spec.yb + 0.3) + 0.9;
      const nw = Math.min(hw * 0.72, pylon ? 1.7 : 2.3), nh = Math.min(top - nb, pylon ? 6.8 : 8.0);
      if (nh > 2.4) {
        archWindow(K, F, 0, nb, nw, nh, 0.03, 8);
        W.aux = [0, 0.4, 0, AUX_ASHLAR(0.6)];
        for (const sx of [-1, 1]) chamferBox(W, F, sx * (nw / 2 + 0.25) - 0.22, sx * (nw / 2 + 0.25) + 0.22, nb - 0.2, nb + nh + 0.35, -0.02, 0.2, 0.04, [0.9, 0.89, 0.86], FACES.pz | FACES.px | FACES.nx | FACES.py);
        W.aux = [0, 0, 0, 0];
      }
      const yb = nb + nh + 0.9;
      if (!spec.banded && yb + 0.6 < yCut - 0.9) {
        const R = K.get('red');
        R.aux = [0, 0.2, 0, AUX_ASHLAR(0.6)];
        box(R, F, -hw + (pylon ? 0.75 : 0.95), hw - (pylon ? 0.75 : 0.95), yb, yb + 0.6, -0.1, 0.03, COL, FACES.pz | FACES.py | FACES.ny);
        R.aux = [0, 0, 0, 0];
      }
      continue;
    }
    if (pylon) {
      // gilt capitals on the corner pilasters, gilt strings, big compass medallion on the front + back
      const Gt = K.get('gilt');
      box(Gt, F, hw - 0.85, hw + 0.05, yS - 0.7, yS - 0.2, -0.02, 0.42, COL, FACES.pz | FACES.px | FACES.nx | FACES.ny | FACES.py);
      box(Gt, F, -hw + 0.75, hw - 0.75, spec.wallTop - 0.1, spec.wallTop + 0.12, 0, 0.08, COL, FACES.pz | FACES.py | FACES.ny);
      if (i === 0 || i === 2) {
        const Fm = new Frame(F.p(0, yS - 2.3, 0.02), F.ax, F.az, mul3(F.ay, -1));
        lathe(K.get('gold'), Fm, 0, 0, 0, [[1.25, 0], [1.22, 0.07], [1.05, 0.12], [1.0, 0.06], [0.82, 0.08], [0.6, 0.17], [0.4, 0.12], [0.18, 0.22], [0, 0.24]], 24, COL);
      }
      W.aux = [0, 0.25, 0, 0];
      sweep(W, F, -hw - 0.55, hw + 0.55, P_CORNICE.map(([d, y]) => [d * 0.85, y * 0.85 + yS]), [0.96, 0.95, 0.93], true);
      W.aux = [0, 0, 0, 0];
      // gilt balustrade around the platform
      const nP = 6;
      for (let m = 0; m < nP; m++) {
        if (spec.state !== 'intact' && m % 2 === 0) continue;
        const sc = -hw - 0.3 + (m + 0.5) * ((2 * hw + 0.6) / nP);
        lathe(Gt, F, sc, yPl - 0.15, 0.25, [[0, 0], [0.1, 0], [0.11, 0.08], [0.07, 0.2], [0.1, 0.45], [0.06, 0.72], [0.08, 0.8], [0, 0.82]], 6, COL);
      }
      if (spec.state === 'intact') box(Gt, F, -hw - 0.5, hw + 0.5, yPl + 0.67, yPl + 0.8, 0.1, 0.4, COL, FACES.pz | FACES.py | FACES.ny | FACES.nz);
      // r4 (ref 4 pylons, shot 4 / shot-8 background): framed marble panels, a lapis inlay strip with gilt rosettes
      // down the face centre, a gilt crown band under the cornice and gilt urn finials on the platform corners
      const pa = -hw + 1.05, pb = hw - 1.05;
      const panelZones = [[spec.wallTop + 0.55, yS - 4.0]];
      if (i === 0) panelZones.push([Math.max(spec.y0 + 0.6, spec.yb + 2.6), spec.wallTop - 0.9]);
      W.aux = [0, 0.35, 0, 0];
      for (const [ya, yb2] of panelZones) {
        if (yb2 - ya < 2) continue;
        box(W, F, pa, pb, ya, ya + 0.24, 0, 0.1, COL, FACES.pz | FACES.py | FACES.ny);
        box(W, F, pa, pb, yb2 - 0.24, yb2, 0, 0.1, COL, FACES.pz | FACES.py | FACES.ny);
        box(W, F, pa, pa + 0.24, ya + 0.24, yb2 - 0.24, 0, 0.1, COL, FACES.pz | FACES.px | FACES.nx);
        box(W, F, pb - 0.24, pb, ya + 0.24, yb2 - 0.24, 0, 0.1, COL, FACES.pz | FACES.px | FACES.nx);
        const Lp = K.get('lapis');
        box(Lp, F, -0.36, 0.36, ya + 0.5, yb2 - 0.5, 0, 0.05, COL, FACES.pz | FACES.px | FACES.nx | FACES.py | FACES.ny);
        box(Gt, F, -0.46, -0.36, ya + 0.5, yb2 - 0.5, 0, 0.07, COL, FACES.pz | FACES.nx);
        box(Gt, F, 0.36, 0.46, ya + 0.5, yb2 - 0.5, 0, 0.07, COL, FACES.pz | FACES.px);
        const nR = Math.max(1, Math.floor((yb2 - ya - 1.4) / 2.1));
        for (let r = 0; r < nR; r++) {
          const yr = ya + 0.7 + (r + 0.5) * ((yb2 - ya - 1.4) / nR);
          const Fr = new Frame(F.p(0, yr, 0.05), F.ax, F.az, mul3(F.ay, -1));
          lathe(Gt, Fr, 0, 0, 0, [[0.3, 0], [0.29, 0.05], [0.2, 0.09], [0.1, 0.14], [0, 0.15]], 10, COL);
        }
      }
      W.aux = [0, 0, 0, 0];
      // gilt crown band (two fillets + a frieze) just under the cornice
      box(Gt, F, -hw - 0.04, hw + 0.04, yS - 0.95, yS - 0.82, -0.02, 0.2, COL, FACES.pz | FACES.py | FACES.ny);
      if (spec.state === 'intact' && i < 4) lathe(Gt, F, -hw - 0.3, yPl + 0.8, 0.3, [[0, 0], [0.34, 0], [0.36, 0.12], [0.2, 0.24], [0.36, 0.6], [0.14, 1.0], [0.05, 1.4], [0, 1.45]], 8, COL);
      continue;
    }
    // windows (front + sides), medallion (front)
    if (i !== 2) {
      archWindow(K, F, 0, yS - 4.2, 1.3, 2.6, 0.03);
      if (yS - 9.5 > spec.y0 + 1) { archWindow(K, F, -2.4, yS - 9.5, 0.7, 1.9, 0.03, 4); archWindow(K, F, 2.4, yS - 9.5, 0.7, 1.9, 0.03, 4); }
    }
    if (i === 0) {
      const Fm = new Frame(F.p(0, yS - 1.15, 0.02), F.ax, F.az, mul3(F.ay, -1));
      lathe(K.get('gold'), Fm, 0, 0, 0, [[0.95, 0], [0.92, 0.06], [0.8, 0.13], [0.62, 0.15], [0.45, 0.1], [0.25, 0.19], [0, 0.2]], 20, COL);
    }
    // red bands just under the cornice of the white design
    if (!spec.banded) {
      const R = K.get('red');
      R.aux = [0, 0.2, 0, AUX_ASHLAR(0.6)];
      for (const yb of [yS - 2.55, yS - 6.1]) box(R, F, -hw + 0.95, hw - 0.95, yb, yb + 0.6, -0.1, 0.03, COL, FACES.pz | FACES.py | FACES.ny);
      R.aux = [0, 0, 0, 0];
    }
    // cornice + parapet with merlons
    W.aux = [0, 0.25, 0, 0];
    sweep(W, F, -hw - 0.65, hw + 0.65, P_CORNICE.map(([d, y]) => [d, y + yS]), [0.96, 0.95, 0.93], true);
    W.aux = [0, 0.3, 0, AUX_ASHLAR(0.5)];
    box(W, F, -hw - 0.6, hw + 0.6, yPl - 0.01, yPl + 0.8, -0.55, 0.62, [0.95, 0.94, 0.92], FACES.pz | FACES.py | FACES.nz);
    // r2: no merlons (they read medieval): moulded parapet coping with gilt urn finials at the corners + centre
    box(W, F, -hw - 0.7, hw + 0.7, yPl + 0.8, yPl + 0.98, -0.65, 0.7, [0.97, 0.96, 0.94], FACES.pz | FACES.py | FACES.ny | FACES.nz);
    if (spec.state === 'intact') {
      lathe(K.get('gilt'), F, -hw - 0.15, yPl + 0.98, 0.05, [[0, 0], [0.3, 0], [0.32, 0.1], [0.18, 0.2], [0.3, 0.5], [0.12, 0.85], [0.04, 1.2], [0, 1.25]], 8, COL);
      if (i % 2 === 0) lathe(K.get('gilt'), F, 0, yPl + 0.98, 0.05, [[0, 0], [0.24, 0], [0.26, 0.08], [0.14, 0.16], [0.24, 0.4], [0.1, 0.68], [0.03, 0.95], [0, 1.0]], 8, COL);
    }
    W.aux = [0, 0, 0, 0];
  }
  if (broken) {
    // jagged broken top
    const W = K.get('white');
    W.aux = [0.2, 0.5, 0, AUX_ASHLAR(0.7)];
    for (let i = 0; i < 9; i++) {
      const a = (i * 2.399) % (2 * Math.PI), rr = hw * (0.35 + 0.55 * ((i * 0.618) % 1));
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const h = 0.6 + 2.4 * ((i * 0.37 + (spec.seed || 0)) % 1);
      chamferBox(W, Fc, x - 1.4, x + 1.4, yCut - 1, yCut + h, z - 1.2, z + 1.2, 0.15, [0.8, 0.78, 0.74]);
    }
    W.aux = [0, 0, 0, 0];
    K.get('lime').quadToward(Fc.p(-hw, yCut - 0.3, -hw), Fc.p(hw, yCut - 0.3, -hw), Fc.p(hw, yCut - 0.3, hw), Fc.p(-hw, yCut - 0.3, hw), [0.7, 0.7, 0.66], [0, 1, 0]);
    return K;
  }
  // platform paving
  const Pv = K.get('paving');
  if (pylon) {
    Pv.aux = [0, 0, 0, AUX_PAVING(1.0)];
    Pv.quadToward(Fc.p(-hw - 0.55, yS + 0.75, -hw - 0.55), Fc.p(hw + 0.55, yS + 0.75, -hw - 0.55), Fc.p(hw + 0.55, yS + 0.75, hw + 0.55), Fc.p(-hw - 0.55, yS + 0.75, hw + 0.55), COL, [0, 1, 0]);
    Pv.aux = [0, 0, 0, 0];
    if (spec.state === 'nodome') return K;
    // pedestal for the great gold brazier bowl (props module: slot brazier, ref 4)
    const W = K.get('white');
    W.aux = [0, 0.3, 0, 0];
    chamferBox(W, Fc, -1.1, 1.1, yS + 0.75, yS + 2.0, -1.1, 1.1, 0.06, COL);
    sweep(W, Fc.yawed(0).at(0, 0, 1.1), -1.3, 1.3, [[0, yS + 2.0], [0.2, yS + 2.08], [0.2, yS + 2.25]], COL, true);
    // r3: the props brazier (own bowl + foot) sits directly on the pedestal top (yS + 2.0): no gilt dish here
    return K;
  }
  Pv.aux = [0, 0, 0, AUX_PAVING(1.0)];
  Pv.quadToward(Fc.p(-hw - 0.1, yPl, -hw - 0.1), Fc.p(hw + 0.1, yPl, -hw - 0.1), Fc.p(hw + 0.1, yPl, hw + 0.1), Fc.p(-hw - 0.1, yPl, hw + 0.1), COL, [0, 1, 0]);
  Pv.aux = [0, 0, 0, 0];
  if (spec.state === 'nodome') return K;
  const G = K.get('gold'), Gt = K.get('gilt'), W = K.get('white');
  if (spec.design === 'dome') {
    // windowed drum + gold dome + finial; gilt acroteria at the platform corners
    const dh = 3.6, dhw = 3.7;   // r4: larger drum + dome (shot 1: the gold domes along the walls must read from 1.4 km)
    const df = faces4(Fc, dhw);
    for (const F of df) {
      W.aux = [0, 0, 0, AUX_ASHLAR(0.55)];
      W.quadToward(F.p(-dhw, yPl, 0), F.p(dhw, yPl, 0), F.p(dhw, yPl + dh, 0), F.p(-dhw, yPl + dh, 0), COL, F.az);
      W.aux = [0, 0.4, 0, 0];
      chamferBox(W, F, dhw - 0.6, dhw, yPl, yPl + dh, 0, 0.12, 0.03, COL, FACES.pz | FACES.px | FACES.nx);
      sweep(W, F, -dhw - 0.3, dhw + 0.3, [[0, yPl + dh], [0.2, yPl + dh + 0.1], [0.3, yPl + dh + 0.3], [0.3, yPl + dh + 0.45]], COL, true);
      W.aux = [0, 0, 0, 0];
      archWindow(K, F, 0, yPl + 0.5, 1.3, 2.4, 0.02, 5);
    }
    W.quadToward(Fc.p(-dhw - 0.3, yPl + dh + 0.45, -dhw - 0.3), Fc.p(dhw + 0.3, yPl + dh + 0.45, -dhw - 0.3), Fc.p(dhw + 0.3, yPl + dh + 0.45, dhw + 0.3), Fc.p(-dhw - 0.3, yPl + dh + 0.45, dhw + 0.3), COL, [0, 1, 0]);
    const yD = yPl + dh + 0.45, R = 3.95;
    const prof = [];
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * (Math.PI / 2); prof.push([R * Math.cos(a), yD + R * 1.05 * Math.sin(a)]); }
    lathe(G, Fc, 0, 0, 0, [[0, yD], ...prof], 24, COL);
    lathe(G, Fc, 0, 0, 0, [[0, yD + R * 1.05 - 0.05], [0.35, yD + R * 1.05], [0.42, yD + R * 1.05 + 0.25], [0.18, yD + R * 1.05 + 0.6], [0.45, yD + R * 1.05 + 0.95], [0.42, yD + R * 1.05 + 1.3], [0.12, yD + R * 1.05 + 1.5], [0.05, yD + R * 1.05 + 2.6], [0, yD + R * 1.05 + 2.7]], 10, COL);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) lathe(Gt, Fc, sx * (hw - 0.1), yPl + 0.8, sz * (hw - 0.1) + 0.0, [[0, 0], [0.4, 0], [0.42, 0.15], [0.25, 0.3], [0.32, 0.7], [0.12, 1.1], [0.04, 1.6], [0, 1.7]], 8, COL);
  } else {
    // open tholos: stylobate, 8 columns, entablature ring, dark core, gold dome, trident finial
    const Rt = 3.9, nC = 8, ch = 4.2;
    lathe(W, Fc, 0, 0, 0, [[0, yPl + 0.6], [Rt + 0.35, yPl + 0.6], [Rt + 0.45, yPl + 0.3], [Rt + 0.55, yPl], [0, yPl]].reverse(), 24, COL);
    lathe(K.get('void'), Fc, 0, 0, 0, [[0, yPl + 0.6], [2.3, yPl + 0.6], [2.3, yPl + 0.6 + ch], [0, yPl + 0.6 + ch]], 12, COL);
    for (let c = 0; c < nC; c++) {
      const a = (c / nC) * Math.PI * 2 + Math.PI / nC;
      const x = Math.cos(a) * Rt, z = Math.sin(a) * Rt;
      lathe(W, Fc, x, yPl + 0.6, z, [[0, 0], [0.42, 0], [0.42, 0.16], [0.34, 0.26], [0.3, 0.34], [0.26, ch - 0.5], [0.0, ch - 0.5]], 10, COL);
      lathe(Gt, Fc, x, yPl + 0.6 + ch - 0.5, z, [[0, 0], [0.27, 0], [0.38, 0.22], [0.5, 0.4], [0.5, 0.5], [0, 0.5]], 10, COL);
    }
    const yE = yPl + 0.6 + ch;
    lathe(W, Fc, 0, 0, 0, [[0, yE], [Rt + 0.55, yE], [Rt + 0.55, yE + 0.55], [Rt + 0.75, yE + 0.7], [Rt + 0.75, yE + 0.95], [0, yE + 0.95]], 24, COL);
    lathe(Gt, Fc, 0, 0, 0, [[Rt + 0.57, yE + 0.18], [Rt + 0.62, yE + 0.22], [Rt + 0.62, yE + 0.4], [Rt + 0.57, yE + 0.44]], 24, COL);
    const yD = yE + 0.95, R = Rt + 0.3;
    const prof = [];
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * (Math.PI / 2); prof.push([R * Math.cos(a), yD + R * 0.9 * Math.sin(a)]); }
    lathe(G, Fc, 0, 0, 0, [[0, yD], ...prof], 28, COL);
    // trident finial
    const yT = yD + R * 0.9;
    const Ft = Fc.at(0, yT, 0);
    lathe(G, Ft, 0, 0, 0, [[0, 0], [0.5, 0], [0.55, 0.3], [0.25, 0.55], [0.4, 0.85], [0.12, 1.1], [0, 1.1]], 10, COL);
    box(G, Ft, -0.09, 0.09, 1.1, 4.4, -0.09, 0.09, COL);
    box(G, Ft, -1.0, 1.0, 3.5, 3.75, -0.1, 0.1, COL);
    for (const sx of [-1, 0, 1]) {
      const x = sx * 0.9;
      box(G, Ft, x - 0.09, x + 0.09, 3.6, sx === 0 ? 5.6 : 5.1, -0.09, 0.09, COL);
      // barbed points
      G.polyToward([Ft.p(x - 0.2, sx === 0 ? 5.6 : 5.1, 0), Ft.p(x + 0.2, sx === 0 ? 5.6 : 5.1, 0), Ft.p(x, (sx === 0 ? 5.6 : 5.1) + 0.6, 0)], COL, [0, 0, 1]);
      G.polyToward([Ft.p(x - 0.2, sx === 0 ? 5.6 : 5.1, 0), Ft.p(x + 0.2, sx === 0 ? 5.6 : 5.1, 0), Ft.p(x, (sx === 0 ? 5.6 : 5.1) + 0.6, 0)], COL, [0, 0, -1]);
    }
  }
  return K;
}

/** height of a tower's top (for the registry / statue slots) */
export function towerTopY(wallTop, design) { return design === 'pylon' ? wallTop + 9.5 + 2.8 : wallTop + 4.5 + 0.9 + (design === 'dome' ? 4.05 + 4.15 + 2.7 : 0.6 + 4.2 + 0.95 + 3.8 + 5.6); }
export const PYLON_HALF = 3.5;

/**
 * Instance every tower of the plan. Returns { group, count, tris }.
 */
export function buildTowers(ctx, M, plan = ctx.plan) {
  const { engine } = ctx;
  const kits = new Map();
  const inst = new Map(); // key → [matrix]
  const dummy = new THREE.Object3D();
  let n = 0;
  for (const t of plan.towers) {
    const e = plan.edges.find((q) => q.id === t.edge);
    const setback = Math.abs(e.faceR - e.wallR);
    const shedHere = inShedRange(e, t.bearing, TOWER_HALF + 1);
    const water = setback < TOWER_PROJ && !shedHere;
    // r2: land ring 1 = slender pylons with gold flame bowls (ref 4; a few domed towers on the outer face only),
    // citadel shore = open tholoi with gold domes (ref 4 left), land ring 2 = domed towers with some tholoi
    const hsh = ((Math.round(t.bearing * 100) * 2654435761) >>> 0) / 4294967296;
    const design = t.designWant ? t.designWant : t.end ? 'tholos' : e.id === 'citadel' ? 'tholos' : e.ring === 'l1' ? (e.id === 'l1-out' && hsh < 0.25 ? 'dome' : 'pylon') : (hsh < 0.25 ? 'tholos' : 'dome');
    const banded = t.end;
    let state = 'intact', lean = 0;
    const label = `rings:tower:${t.edge}:${Math.round(t.bearing * 100)}`;
    if (ctx.sunken) {
      const r = ruinRand(label, 0);
      state = r < 0.35 ? 'broken' : r < 0.75 ? 'nodome' : 'intact';
      // r4: the shed-mole pylons stand 50-90 m in front of the shot-8 camera and hid the far citadel behind a plain
      // block: most are broken off (ref 8 background = ruined silhouettes + the distant domed city)
      if (t.ring === 'mole') state = 'broken';
      if (ruined(label + ':lean', 0.18)) lean = (2 + 3 * ruinRand(label, 1)) * (Math.PI / 180);
    }
    const seed = state === 'broken' ? Math.floor(ruinRand(label, 2) * 3) / 3 : 0;
    const key = `${e.id === 'citadel' ? 'c' : e.ring}|${e.landY}|${e.wallTop}|${design}|${banded ? 'b' : 'w'}|${water ? 'w' : 'l'}|${state}|${seed}`;
    if (!kits.has(key)) kits.set(key, towerKit({ y0: e.landY, wallTop: e.wallTop, yb: water ? e.floor - 1.5 : e.landY - 0.6, design, banded, state, water, seed, cutLow: e.ring === 'mole' }));
    // transform: local +z → toward the water, origin on the curtain face at the tower bearing
    const [x, z] = (e.polar || polarXZ)(e.wallR, t.bearing);
    const b = (t.bearing * Math.PI) / 180;
    const nx = Math.sin(b) * e.side, nz = -Math.cos(b) * e.side;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, Math.atan2(nx, nz), 0);
    dummy.updateMatrix();
    let m = dummy.matrix.clone();
    if (lean) {
      // lean about the base point (toward the water or along the wall)
      const ax = ruinRand(label, 3) < 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const yb = e.landY;
      const T1 = new THREE.Matrix4().makeTranslation(0, yb, TOWER_PROJ - TOWER_HALF), R = new THREE.Matrix4().makeRotationAxis(ax, lean), T0 = new THREE.Matrix4().makeTranslation(0, -yb, -(TOWER_PROJ - TOWER_HALF));
      m = m.multiply(T1).multiply(R).multiply(T0);
    }
    if (!inst.has(key)) inst.set(key, []);
    inst.get(key).push(m);
    t.design = design; t.state = state; t.water = water;
    t.top = state === 'intact' ? towerTopY(e.wallTop, design) : e.wallTop + 5.4;
    // slots
    const front = (dy, dd = 0) => { const v = new THREE.Vector3(0, dy, TOWER_PROJ + dd).applyMatrix4(m); return [v.x, v.y, v.z]; };
    if (!ctx.sunken) {
      if (design === 'pylon') {
        engine.slots.banner.push({ pos: front(e.wallTop + 9.5 - 4.0, 0.42), facing: t.facing, size: [1.7, 10.5], tag: 'rings-pylon' });
        const v = new THREE.Vector3(0, e.wallTop + 9.5 + 2.0, TOWER_PROJ - PYLON_HALF).applyMatrix4(m);   // r3: = pedestal top (props audit)
        engine.slots.brazier.push({ pos: [v.x, v.y, v.z], facing: t.facing, size: 3.4, tag: 'rings-pylon' });   // r4: 2.6 → 3.4 (ref 4: big gold flame bowls)
      } else {
        // r2: hung in front of the string courses (proj 0.24) and below the upper window (sill yS - 4.2)
        const top = e.wallTop + 4.5 - 4.45, h = Math.min(e.id === 'citadel' ? 7 : 8.5, top - e.landY - 1.2);
        if (h > 2.5) engine.slots.banner.push({ pos: front(top, 0.42), facing: t.facing, size: [e.id === 'citadel' ? 2.4 : 2.8, h], tag: 'rings-tower' });
      }
      if (design === 'dome' && ctx.lodAt(x, z) === 0) {
        for (const sx of [-1, 1]) {
          const v = new THREE.Vector3(sx * (TOWER_HALF - 0.1), e.wallTop + 5.4 + 2.5, TOWER_PROJ - 0.1).applyMatrix4(m);
          void v; // gilt acroteria stand there; braziers go on the curtain side corners
        }
      }
    } else {
      const v = new THREE.Vector3(0, state === 'broken' ? e.landY + (e.wallTop + 4.5 - e.landY) * (e.ring === 'mole' ? 0.22 : 0.6) : e.wallTop + 5.4, TOWER_PROJ - TOWER_HALF).applyMatrix4(m);
      engine.slots.coral.push({ pos: [v.x, v.y, v.z], normal: [0, 1, 0], size: 3, tag: 'rings-tower-top' });
      if (e.ring === 'l2' || e.id === 'l1-out') {
        const k = front(e.floor + 6, 4);
        engine.slots.kelp.push({ pos: [k[0], -4, k[2]], size: 18 + 10 * ruinRand(label, 4), tag: 'rings-tower-foot' });
      }
    }
    engine.footprints.addCircle(x + nx * (TOWER_PROJ - TOWER_HALF), z + nz * (TOWER_PROJ - TOWER_HALF), TOWER_HALF * 1.45, 'rings-tower');
    n++;
  }
  const group = new THREE.Group(); group.name = 'rings-towers';
  let tris = 0;
  for (const [key, kit] of kits) {
    const mats = inst.get(key);
    for (const [mname, B] of Object.entries(kit.B)) {
      if (B.empty) continue;
      const geo = B.toGeometry();
      const im = new THREE.InstancedMesh(geo, M[mname], mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.name = 'rings-tower:' + key + ':' + mname;
      group.add(im);
      tris += B.tris * mats.length;
    }
  }
  return { group, count: n, tris, kinds: kits.size };
}
