// Gate tower (refs 2, 5, 7): square shaft with white corner pilasters, red/white banded bays, gilded relief
// panels, central bays with blue trident banners, a deck-level gate passage along the bridge axis, moulded
// cornice with gold frieze, roof parapet with gold corner acroteria and a tholos with a gold ribbed dome and
// a trident finial. Built in the kit's local frame (x = bridge axis). OWNER: bridges agent.
import { AUX, boxA, planeX, corniceRect, reliefPanelZ, tholosTop, urnFinial, surface, hash3 } from './kit.js';

const PI = Math.PI;

/**
 * o: { x0, x1, z0, z1, yDeck, yTop, passage: { hw, h } | null, inset, tholos: { R, n, colH, domeH, tridentH },
 *      gilt (relief panels in the side bays of ±z faces), banded, bannerFaces: ['+z','-z','+x','-x'],
 *      seed, tag, fallenTop, tridentBroken, missingCols(i) }
 * Returns { tip, roof, cx, cz }.
 */
export function gateTower(kit, o) {
  const w = kit.mb.white, bd = kit.mb.banded, gl = kit.mb.gilt, g = kit.mb.gold, dk = kit.mb.dark;
  const { x0, x1, z0, z1, yDeck, yTop } = o;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const Lx = x1 - x0, Lz = z1 - z0, Lmin = Math.min(Lx, Lz);
  const ins = o.inset ?? Math.max(0.35, Lmin * 0.025);
  const seed = o.seed ?? 1;
  const plinthH = Math.max(0.6, Lmin * 0.035);
  const yS0 = yDeck + plinthH;                         // shaft starts above the plinth moulding
  const corH = Math.max(0.9, Lmin * 0.06);             // cornice height
  const yC = yTop - corH;                              // cornice base
  const yF = yC - Math.max(0.35, Lmin * 0.02);         // gilt frieze strip
  const yMid = yS0 + (yF - yS0) * (o.midFrac ?? 0.43);
  const P = o.passage;
  // ---------------------------------------------------------------- core (with the gate passage along x)
  const X0 = x0 + ins, X1 = x1 - ins, Z0 = z0 + ins, Z1 = z1 - ins;
  const coreA = AUX.ashlar(Math.max(0.55, Lmin * 0.04));
  if (P) {
    const hw = P.hw, spr = yDeck + P.h - hw, crown = spr + hw;
    boxA(w, X0, yDeck - 0.2, Z0, X1, yF, -hw, coreA);
    boxA(w, X0, yDeck - 0.2, hw, X1, yF, Z1, coreA);
    boxA(w, X0, crown, -hw, X1, yF, hw, coreA);
    // portal faces with the arch notch, both ends
    const segs = Math.max(10, Math.round(18 * kit.detail));
    const notch = [[-hw, spr]];
    for (let i = 0; i <= segs; i++) { const a = PI - (PI * i) / segs; notch.push([Math.cos(a) * hw, spr + Math.sin(a) * hw]); }
    notch.push([hw, crown], [-hw, crown]);
    planeX(w, notch.reverse(), X0, -1, coreA);
    planeX(w, notch, X1, 1, coreA);
    // barrel vault + passage walls (inner faces, darker)
    surface(dk, (u, v, out) => { const a = PI * v; out[0] = X0 + (X1 - X0) * u; out[1] = spr + Math.sin(a) * hw; out[2] = Math.cos(a) * hw; }, 4, segs, { flip: true, aux: AUX.cav });
    // archivolt rings around both portals + gilt keystones
    for (const [xf, f] of [[X0, -1], [X1, 1]]) {
      const ring = Math.max(0.45, hw * 0.16);
      for (let i = 0; i < segs; i++) {
        const a0 = PI - (PI * i) / segs, a1 = PI - (PI * (i + 1)) / segs;
        const C = [];
        for (let k = 0; k < 8; k++) {
          const a = k & 1 ? a1 : a0, r = k & 2 ? hw + ring : hw, xx = k & 4 ? xf + f * 0.22 : xf - f * 0.02;
          C.push([xx, spr + Math.sin(a) * r, Math.cos(a) * r]);
        }
        hexaLocal(w, C, AUX.mould);
      }
      // jambs (impost pilasters)
      for (const s of [-1, 1]) boxA(w, f > 0 ? xf - 0.02 : xf - 0.22, yDeck, s > 0 ? hw : -hw - ring, f > 0 ? xf + 0.22 : xf + 0.02, spr, s > 0 ? hw + ring : -hw, AUX.mould, 0.02);
      boxA(gl, f > 0 ? xf + 0.1 : xf - 0.36, crown - 0.15, -ring * 0.6, f > 0 ? xf + 0.36 : xf - 0.1, crown + ring * 1.2, ring * 0.6, [0.25, 0, 0, 0], 0.03);
    }
  } else {
    boxA(w, X0, yDeck - 0.2, Z0, X1, yF, Z1, coreA);
  }
  // ---------------------------------------------------------------- face articulation (4 faces)
  const faces = [
    { id: '+z', L: Lx, map: (u, d) => [cx + u, z1 + d], nrm: [0, 1] },
    { id: '-z', L: Lx, map: (u, d) => [cx - u, z0 - d], nrm: [0, -1] },
    { id: '+x', L: Lz, map: (u, d) => [x1 + d, cz - u], nrm: [1, 0] },
    { id: '-x', L: Lz, map: (u, d) => [x0 - d, cz + u], nrm: [-1, 0] },
  ];
  const fbox = (mb, F, u0, u1, y0, y1, d0, d1, aux, bev = 0.02) => {
    const [ax, az] = F.map(u0, d0), [bx, bz] = F.map(u1, d1);
    boxA(mb, Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), aux, bev);
  };
  // r5 (ref 7, sunken): dark round-headed opening on a face (box + stepped semicircle), front at d = dF, with a hood
  const archDark = (F, uc, hw2, y0, y1, dF, hood) => {
    const r = hw2, ys = y1 - r;
    if (ys - y0 < 0.4) return;
    fbox(dk, F, uc - r, uc + r, y0, ys, dF - 0.5, dF, AUX.dark, 0);
    const n = 7;
    for (let k = 0; k < n; k++) {
      const ua = uc - r + (2 * r * k) / n, ub = uc - r + (2 * r * (k + 1)) / n, um = (ua + ub) / 2 - uc;
      fbox(dk, F, ua, ub, ys - 0.01, ys + Math.sqrt(Math.max(0, r * r - um * um)), dF - 0.5, dF, AUX.dark, 0);
    }
    if (hood) {
      fbox(w, F, uc - r - 0.3, uc + r + 0.3, y0 - 0.28, y0, dF - 0.05, dF + 0.18, AUX.mould, 0.02);   // sill
      for (let k = 0; k < 9; k++) {
        const a0 = PI * k / 9, a1 = PI * (k + 1) / 9, R1 = r + 0.32;
        const ua = uc + Math.cos(a1) * R1, ub = uc + Math.cos(a0) * R1, yb = ys + Math.min(Math.sin(a0), Math.sin(a1)) * r;
        fbox(w, F, Math.min(ua, ub), Math.max(ua, ub), Math.max(ys, yb), ys + Math.max(Math.sin(a0), Math.sin(a1)) * R1, dF - 0.05, dF + 0.12, AUX.mould, 0.01);
      }
    }
  };
  for (const F of faces) {
    const L = F.L, hL = L / 2;
    const isGate = P && (F.id === '+x' || F.id === '-x');
    const cp = Math.max(0.9, L * 0.075);               // corner pilaster width
    const sb = o.sideBay ?? L * 0.27;                  // side bay width
    const pil = Math.max(0.3, L * 0.022);              // thin bay-edge pilasters
    // corner pilasters (white ashlar, full projection) with gilt capital bands
    for (const s of [-1, 1]) {
      const ua = s > 0 ? hL - cp : -hL, ub = s > 0 ? hL : -hL + cp;
      if (o.banded !== false) fbox(bd, F, ua, ub, yS0, yF, -ins - 0.05, 0, [0, 0.3, 0.3, 0], 0.02);
      else fbox(w, F, ua, ub, yS0, yF, -ins - 0.05, 0, AUX.ashlar(Math.max(0.5, L * 0.035)));
      fbox(gl, F, ua - 0.04, ub + 0.04, yF - 0.5, yF - 0.22, -ins, 0.06, [0.25, 0, 0, 0]);
    }
    // side bays
    for (const s of [-1, 1]) {
      const ua = s > 0 ? hL - cp - sb : -hL + cp, ub = s > 0 ? hL - cp : -hL + cp + sb;
      // bay-edge pilasters
      fbox(w, F, ua - pil * 0.5, ua + pil * 0.5, yS0, yF, -ins - 0.05, -0.06, AUX.ashlar(0.6));
      fbox(w, F, ub - pil * 0.5, ub + pil * 0.5, yS0, yF, -ins - 0.05, -0.06, AUX.ashlar(0.6));
      const uA = ua + pil * 0.5, uB = ub - pil * 0.5;
      const banded = o.banded !== false;
      const giltHere = o.gilt && !isGate;
      const yBand0 = giltHere ? yMid : yS0;
      if (banded) fbox(bd, F, uA, uB, yBand0, yF, -ins - 0.05, -0.16, [0, 0, 0.3, 0], 0.015);
      else fbox(w, F, uA, uB, yBand0, yF, -ins - 0.05, -0.16, AUX.ashlar(0.7));
      if (giltHere) {
        // framed gilt relief panel in the lower half
        const [px0, pz0] = F.map(uA, -0.16), [px1, pz1] = F.map(uB, -0.16);
        const darkField = kit.sunken && o.sunkenNiche;   // r5 (ref 7): dark relief field underwater
        fbox(darkField ? dk : w, F, uA, uB, yS0, yMid, -ins - 0.05, -0.36, darkField ? AUX.dark : AUX.ashlar(0.6));
        if (F.id === '+z' || F.id === '-z') {
          const f = F.id === '+z' ? 1 : -1;
          reliefPanelZ(kit, Math.min(px0, px1), Math.max(px0, px1), yS0 + 0.25, yMid - 0.15, (f > 0 ? z1 : z0) + f * -0.36, f,
            { kind: hash3(seed, s + 3, 5) < 0.5 ? 'hippocamp' : 'figure', seed: seed * 7 + s, depth: kit.sunken && o.sunkenNiche ? 0.55 : 0.3, frame: Math.max(0.25, L * 0.016), frameProj: 0.2, density: F.id === '+z' ? 8 : 4 });
        }
      }
      // r5 (ref 7): sunken gate towers — an arched window (dark) in the banded upper half of every side bay
      if (kit.sunken && o.sunkenNiche) {
        const uc = (uA + uB) / 2, hw2 = Math.min((uB - uA) * 0.26, 1.5);
        archDark(F, uc, hw2, yMid + (yF - yMid) * 0.3, yF - (yF - yMid) * 0.14, -0.15, false);
      }
      // string course at mid height on the bay
      fbox(w, F, uA - pil * 0.5, uB + pil * 0.5, yMid - 0.18, yMid + 0.12, -ins, -0.04, AUX.mould, 0.02);
    }
    // central bay: recessed ashlar wall, banner slot, blind niche on the long faces
    const cA = -hL + cp + sb + pil * 0.5, cB = hL - cp - sb - pil * 0.5;
    const nicheHere = !isGate && (o.niche || (o.sunkenNiche && kit.sunken && (F.id === '+z' || F.id === '-z')));
    if (nicheHere) {
      // blind arched niche (dark) at the bottom of the central bay
      const big = !o.niche;   // r4: sunken gate towers (ref 7): tall statue niche with a gilt frame + a statue on a plinth
      const nw = big ? Math.min((cB - cA) * 0.62, 4.2) : Math.min((cB - cA) * 0.42, 2.4), nh = big ? Math.min((yMid - yS0) * 0.92, nw * 2.2) : Math.min((yMid - yS0) * 0.85, nw * 2.6);
      fbox(dk, F, -nw / 2, nw / 2, yS0 + 0.3, yS0 + 0.3 + nh, -ins - 0.6, -ins + 0.01, AUX.dark, 0);
      fbox(w, F, -nw / 2 - 0.25, nw / 2 + 0.25, yS0 + 0.3 + nh, yS0 + 0.6 + nh, -ins - 0.05, -ins + 0.18, AUX.mould, 0.02);
      fbox(w, F, -nw / 2 - 0.3, nw / 2 + 0.3, yS0 + 0.05, yS0 + 0.3, -ins - 0.05, -ins + 0.2, AUX.mould, 0.02);
      if (big) {
        for (const sg of [-1, 1]) fbox(gl, F, sg > 0 ? nw / 2 : -nw / 2 - 0.22, sg > 0 ? nw / 2 + 0.22 : -nw / 2, yS0 + 0.3, yS0 + 0.3 + nh, -ins - 0.05, -ins + 0.12, [0.3, 0, 0, 0], 0.02);
        // stepped semicircular hood over the niche (white / gilt alternating)
        const R0 = nw / 2, yc = yS0 + 0.6 + nh, segs = 9;
        for (let k = 0; k < segs; k++) {
          const a0 = Math.PI * k / segs, a1 = Math.PI * (k + 1) / segs;
          const ua = Math.cos(a1) * R0, ub = Math.cos(a0) * R0, yb = yc + Math.min(Math.sin(a0), Math.sin(a1)) * R0 * 0.9;
          fbox(k % 2 ? gl : w, F, Math.min(ua, ub), Math.max(ua, ub), yc, Math.max(yc + 0.1, yb), -ins - 0.05, -ins + 0.1 + 0.06 * (k % 2), AUX.mould, 0.01);
        }
        const pH = 0.9;
        fbox(w, F, -nw * 0.32, nw * 0.32, yS0 + 0.3, yS0 + 0.3 + pH, -ins - 0.05, -ins + 1.0, AUX.mould, 0.03);
        const [sx, sz] = F.map(0, -ins + 0.55);
        kit.slots.statue.push({ pos: kit.W(sx, yS0 + 0.3 + pH, sz), facing: kit.compass(F.nrm[0], F.nrm[1]), size: Math.min(nh - pH - 0.4, 5.6), tag: 'pedestal', source: 'bridges-' + (o.tag || 'tower') + '-niche' });
      }
    }
    if (kit.sunken && o.sunkenNiche) {
      // r5 (ref 7): the banner bay of the golden era is a tall dark loggia opening with a white hood + sill underwater
      const top = yF - 1.3, bot = isGate && P ? Math.max(yMid + 0.9, yDeck + P.h + 2.2) : yMid + 0.9;
      archDark(F, 0, Math.min((cB - cA) * 0.3, 2.4), bot, top, -ins + 0.01, true);
      const [qx, qz] = F.map(0, -ins + 0.2);
      kit.coralAt(qx, bot + 0.02, qz, F.nrm[0] * 0.5, 1, F.nrm[1] * 0.5, 0.8, 'tower-sill');
    }
    if (!kit.sunken && o.bannerFaces && o.bannerFaces.includes(F.id)) {
      const [bx, bz] = F.map(0, -ins + 0.06);
      // r3: o.bannerBig (gate bridge, ref 2: the banners are wide and long on the tower faces)
      const bw = o.bannerBig ? Math.min(4.8, (cB - cA) * 0.82) : Math.min(3.4, (cB - cA) * 0.62);
      const bh = Math.min((yF - 0.6) - (P && isGate ? yDeck + P.h + 0.8 : yS0 + 1.0), bw * (o.bannerBig ? 4.2 : 3.4));
      if (bh > 2) kit.slots.banner.push({ pos: kit.W(bx, yF - 0.55, bz), facing: kit.compass(F.nrm[0], F.nrm[1]), size: [bw, bh], tag: 'wall', style: bh > 7.6 ? 'L' : 'V', source: 'bridges-' + (o.tag || 'tower') });
    }
    // plinth moulding at the shaft base (all faces)
    fbox(w, F, -hL - 0.25, hL + 0.25, yDeck - 0.1, yS0, -ins - 0.1, 0.28, AUX.mould, 0.03);
    // gilt frieze strip under the cornice
    fbox(gl, F, -hL, hL, yF, yC, -ins - 0.1, 0.04, [0.3, 0, 0, 0]);
    if (kit.sunken) {
      const [qx, qz] = F.map(0, 0.3);
      kit.coralAt(qx, yS0 + 0.05, qz, F.nrm[0], 1, F.nrm[1], 0.5, 'tower-plinth');
      for (const s of [-1, 1]) { const [mx, mz] = F.map(s * (hL - cp - sb * 0.5), -0.02); kit.coralAt(mx, yMid + 0.13, mz, F.nrm[0], 0.7, F.nrm[1], 0.4, 'tower-course'); }
    }
  }
  // ---------------------------------------------------------------- cornice, roof, acroteria
  corniceRect(w, x0, x1, z0, z1, yC, corH, Math.max(0.35, Lmin * 0.035));
  const pr = Math.max(0.35, Lmin * 0.035) * 0.75;
  const RX0 = x0 - pr * 0.4, RX1 = x1 + pr * 0.4, RZ0 = z0 - pr * 0.4, RZ1 = z1 + pr * 0.4;
  const parH = Math.max(0.6, Lmin * 0.04), parT = Math.max(0.3, Lmin * 0.018);
  boxA(w, RX0 + 0.1, yTop, RZ0 + 0.1, RX1 - 0.1, yTop + 0.15, RZ1 - 0.1, AUX.pave(1.0));
  for (const [a0, a1, b0, b1] of [[RX0, RX1, RZ0, RZ0 + parT], [RX0, RX1, RZ1 - parT, RZ1], [RX0, RX0 + parT, RZ0, RZ1], [RX1 - parT, RX1, RZ0, RZ1]]) {
    boxA(w, a0, yTop, b0, a1, yTop + parH, b1, AUX.mould, 0.02);
    boxA(gl, a0 - 0.03, yTop + parH, b0 - 0.03, a1 + 0.03, yTop + parH + 0.08, b1 + 0.03, [0.2, 0, 0, 0]);
  }
  // corner pedestals with gold acroteria (flame urns)
  const cpw = Math.max(0.9, Lmin * 0.08), cph = Math.max(1.0, Lmin * 0.06);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = sx > 0 ? RX1 - cpw / 2 : RX0 + cpw / 2, pz = sz > 0 ? RZ1 - cpw / 2 : RZ0 + cpw / 2;
    boxA(w, px - cpw / 2, yTop, pz - cpw / 2, px + cpw / 2, yTop + cph, pz + cpw / 2, AUX.mould, 0.03);
    boxA(w, px - cpw / 2 - 0.08, yTop + cph, pz - cpw / 2 - 0.08, px + cpw / 2 + 0.08, yTop + cph + 0.14, pz + cpw / 2 + 0.08, AUX.mould, 0.02);
    const gone = kit.sunken && hash3(seed, sx + 2, sz + 5) < 0.35;
    if (!gone && kit.sunken && o.sunkenNiche) {
      // r4 (ref 7): the sunken gate towers carry statues on the roof corners (verdigris silhouettes beside the tholos)
      kit.slots.statue.push({ pos: kit.W(px, yTop + cph + 0.14, pz), facing: kit.compass(sx, sz), size: Math.max(3.0, Lmin * 0.17), tag: 'pedestal', source: 'bridges-' + (o.tag || 'tower') + '-corner' });
    } else if (!gone) urnFinial(g, px, yTop + cph + 0.14, pz, Math.max(1.2, Lmin * 0.095), Math.max(8, Math.round(14 * kit.detail)));
    else kit.coralAt(px, yTop + cph + 0.14, pz, 0, 1, 0, 0.5, 'tower-acroterion');
  }
  // ---------------------------------------------------------------- tholos
  const T = o.tholos || {};
  const R = T.R ?? Lmin * 0.38;
  let tip = yTop + parH;
  if (!o.fallenTop) {
    tip = tholosTop(kit, cx, yTop + 0.15, cz, R, { n: T.n ?? 12, colH: T.colH ?? R * 0.72, domeH: T.domeH, tridentH: T.tridentH ?? R * 0.62, tridentBroken: o.tridentBroken, missing: o.missingCols, trident: T.trident, tridentThick: T.tridentThick, stepF: T.stepF, entF: T.entF, knobF: T.knobF, drumH: T.drumH });
    if (kit.sunken) for (let i = 0; i < 4; i++) { const a = i * PI / 2 + 0.4; kit.coralAt(cx + Math.sin(a) * R * 1.02, yTop + 0.3, cz + Math.cos(a) * R * 1.02, Math.sin(a), 0.6, Math.cos(a), 0.6, 'tholos-step'); }
  }
  if (kit.sunken && o.sunkenNiche) {
    // r4 (ref 7: coral on every ledge): cornice top + plinth moulding, every ≈ 2.6 m
    for (const F of faces) {
      const hL = F.L / 2, n = Math.max(2, Math.round(F.L / 2.6));
      for (let k = 0; k < n; k++) {
        const u = -hL + (k + 0.5) * (F.L / n);
        if (hash3(seed * 3 + k, F.id.charCodeAt(1), 7) < 0.3) continue;
        const sz = 0.55 + 0.6 * hash3(seed + k, F.id.charCodeAt(0), 3);
        const [ax, az] = F.map(u, 0.25);
        kit.coralAt(ax, yTop + 0.02, az, F.nrm[0] * 0.4, 1, F.nrm[1] * 0.4, sz, 'tower-cornice');
        if (k % 2 === 0) { const [bx, bz] = F.map(u, 0.32); kit.coralAt(bx, yDeck + plinthH + 0.02, bz, F.nrm[0] * 0.5, 1, F.nrm[1] * 0.5, sz * 0.9, 'tower-plinth'); }
      }
    }
  }
  if (kit.sunken) {
    kit.coralAt(cx, yTop + 0.2, RZ1 - 0.5, 0, 1, 0, 0.7, 'tower-roof');
    kit.coralAt(RX0 + 0.6, yTop + 0.2, cz, 0, 1, 0, 0.6, 'tower-roof');
  }
  return { tip, roof: yTop, cx, cz, R };
}

/** hexa in local coords (outward by centroid) */
function hexaLocal(mb, C, aux) {
  const HEX = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
  let cx = 0, cy = 0, cz = 0;
  for (const p of C) { cx += p[0] / 8; cy += p[1] / 8; cz += p[2] / 8; }
  for (const f of HEX) {
    const F = f.map((i) => C[i]);
    const d = [(F[0][0] + F[2][0]) / 2 - cx, (F[0][1] + F[2][1]) / 2 - cy, (F[0][2] + F[2][2]) / 2 - cz];
    const ux = F[1][0] - F[0][0], uy = F[1][1] - F[0][1], uz = F[1][2] - F[0][2];
    const wx = F[3][0] - F[0][0], wy = F[3][1] - F[0][1], wz = F[3][2] - F[0][2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    if (nx * d[0] + ny * d[1] + nz * d[2] >= 0) mb.quadP(F[0], F[1], F[2], F[3], aux); else mb.quadP(F[3], F[2], F[1], F[0], aux);
  }
}
