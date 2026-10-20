// The great gate bridge over the sea canal (refs 2, 7 — HERO). Local frame: x = world x (east), z = world z - GATE.z
// (+z = south, toward the sea and the shot-2 / shot-7 cameras), y = world height. OWNER: bridges agent.
//
//   main arch (span 56, near-semicircular, voussoirs + archivolt, gilt keystone cartouche), spandrels with
//   rosette medallions, frieze with red panels + gilt rosettes, cornice, balustraded deck with pedestals
//   (statue / brazier slots), two piers with framed GILT RELIEF PANELS and statue pedestals at the waterline,
//   two banded gate towers (gate passage on the deck, gold-domed tholos tops with trident finials, banner
//   slots), side viaducts (3 arches each) over the quays, end pylons and monumental stairs to land ring 2.
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { ruined, ruinRand } from '../world/era.js';
import { GATE } from './plan.js';
import { AUX, boxA, archRing, archBand, spandrel, corniceX, balustradeX, pedestal, reliefPanelZ, medallionZ, urnFinial, hash3 } from './kit.js';
import { gateTower } from './tower.js';
import { rubble, stairsX } from './parts.js';

const PI = Math.PI;

export function buildGateBridge(kit) {
  const G = GATE, sunken = kit.sunken;
  kit.begin(0, G.z, 0);
  const w = kit.mb.white, red = kit.mb.red, gl = kit.mb.gilt, blk = kit.mb.black, lime = kit.mb.lime, dk = kit.mb.dark;
  const ground = (x, z) => heightAt(x, G.z + z);
  const hd = G.halfDepth, deck = G.deck;
  const yFr = deck - 1.4, yCo = deck - 0.4, coH = 0.95, coP = 0.75;   // frieze 28.6..29.6, cornice 29.6..30.55
  const balY = yCo + coH;
  const a = G.span / 2, b = G.rise - G.spring + 1.5, sp = G.spring, thick = 1.85;   // intrados crown ≈ 27.5
  const T = G.tower;
  const label = 'gate';
  const brokenBal = (side) => (i, x) => (sunken ? (ruined(`${label}:bal:${side}:${Math.round(x)}`, 0.38) ? (ruined(`${label}:bal2:${side}:${Math.round(x)}`, 0.4) ? 2 : 1) : 0) : 0);

  // ------------------------------------------------------------------ main arch
  archRing(kit, 0, sp, a, b, -hd, hd, { thick, n: 47, proj: 0.3, key: 0.45, frontDepth: 1.1, goldKey: true, alt: true });
  // archivolt hood moulding (projecting band following the extrados), both faces
  for (const f of [-1, 1]) {
    // carved scroll band along the extrados + an outer hood moulding
    archBand(kit, 0, sp, a, b, thick + 0.05, thick + 1.15, f * hd, f, { waves: 30, depth: 0.2 });
    const z0 = f > 0 ? hd + 0.02 : -hd - 0.4, z1 = f > 0 ? hd + 0.4 : -hd - 0.02;
    archRing(kit, 0, sp, a + thick + 1.15, b + thick + 1.15, z0, z1, { thick: 0.38, n: 61, proj: 0, key: 0, frontDepth: 0.1, mb: w });
  }
  // spandrels (both faces) with the extrados notch, up to the frieze
  const ext = { cx: 0, sp, a, b, off: thick + 0.3, segs: 48 };
  for (const f of [-1, 1]) spandrel(w, -T.x0 - 2.2, T.x0 + 2.2, sp, yFr, f * hd, f, [ext], AUX.ashlar(0.95));
  // medallions on the haunches + small gilt rosettes along the frieze
  for (const f of [-1, 1]) for (const s of [-1, 1]) medallionZ(kit, s * (a - 3.2), sp + b * 0.77, f * (hd + 0.02), f, 2.15, 3 + s);
  // ------------------------------------------------------------------ frieze, cornice, deck, balustrade over the whole length
  const X0 = -G.viaductEnd, X1 = G.viaductEnd;
  for (const f of [-1, 1]) {
    // frieze band (white) with recessed red panels and gilt rosettes, skipping the tower piers (they get their own)
    for (const [xa, xb] of [[X0, -T.x1], [-T.x0, T.x0], [T.x1, X1]]) {
      boxA(w, xa, yFr, f > 0 ? hd - 0.1 : -hd - 0.12, xb, yCo, f > 0 ? hd + 0.12 : -hd + 0.1, AUX.mould, 0.02);
      const n = Math.max(1, Math.round((xb - xa) / 3.1));
      for (let i = 0; i < n; i++) {
        const xc = xa + (xb - xa) * ((i + 0.5) / n), pw = (xb - xa) / n;
        boxA(red, xc - pw * 0.36, yFr + 0.18, f > 0 ? hd + 0.08 : -hd - 0.16, xc + pw * 0.36, yCo - 0.18, f > 0 ? hd + 0.16 : -hd - 0.08, [0.2, 0, 0.2, 0], 0.01);
        if (i % 2 === 0) boxA(gl, xc - 0.18, (yFr + yCo) / 2 - 0.18, f > 0 ? hd + 0.14 : -hd - 0.24, xc + 0.18, (yFr + yCo) / 2 + 0.18, f > 0 ? hd + 0.24 : -hd - 0.14, [0.3, 0, 0, 0], 0.05);
      }
    }
  }
  corniceX(w, X0, -T.x1, yCo, hd, coH, coP); corniceX(w, -T.x0, T.x0, yCo, hd, coH, coP); corniceX(w, T.x1, X1, yCo, hd, coH, coP);
  // deck paving + the infill under it (closes the top of the spandrel box)
  boxA(lime, X0, deck - 0.6, -hd + 0.05, X1, deck, hd - 0.05, AUX.pave(1.3));
  boxA(w, X0, yCo + coH - 0.05, hd - 0.6, X1, balY, hd + 0.05, AUX.mould);       // parapet base strip (both sides)
  boxA(w, X0, yCo + coH - 0.05, -hd - 0.05, X1, balY, -hd + 0.6, AUX.mould);
  // balustrades: over the main span and the viaducts (towers interrupt them); pedestals every ~9 m
  const balZ = hd + 0.18;
  for (const f of [-1, 1]) {
    const side = f > 0 ? 's' : 'n';
    const pedX = [-22.5, -13.5, -4.5, 4.5, 13.5, 22.5];
    const runs = [];
    let xs = -T.x0 + 1.2;
    for (const px of pedX) { runs.push([xs, px - 0.75]); xs = px + 0.75; }
    runs.push([xs, T.x0 - 1.2]);
    for (const [xa, xb] of runs) balustradeX(kit, xa, xb, balY, f * balZ, { h: 1.25, broken: brokenBal(side) });
    pedX.forEach((px, k) => {
      const gone = sunken && ruined(`${label}:ped:${side}:${k}`, 0.3);
      if (gone) { rubble(kit, px, deck, f * (hd - 1.5), 1.2, 4, `${label}:pedr:${side}:${k}`); return; }
      const top = pedestal(kit, px, balY - 0.1, f * balZ, 1.5, 1.9);
      const statue = Math.abs(px) > 18 || Math.abs(px) < 6;
      if (statue) kit.slots.statue.push({ pos: kit.W(px, top, f * balZ), facing: kit.compass(0, f), size: 3.4, tag: 'pedestal', source: 'bridges-gate-deck' });
      else kit.slots.brazier.push({ pos: kit.W(px, top, f * balZ), facing: kit.compass(0, f), size: 1.25, tag: 'pedestal', source: 'bridges-gate-deck' });
      if (sunken) kit.coralAt(px, top, f * balZ, 0, 1, 0, 0.6, 'gate-pedestal');
    });
  }
  // ------------------------------------------------------------------ the two tower piers (below the deck)
  for (const s of [-1, 1]) {
    const px0 = s > 0 ? T.x0 : -T.x1, px1 = s > 0 ? T.x1 : -T.x0;
    const zH = T.d / 2;
    // pier body from below the canal bed to the deck, white ashlar
    boxA(w, px0, -12, -zH, px1, yFr, zH, AUX.ashlar(1.0));
    // black basalt plinth at the waterline + impost moulding at the springing
    boxA(blk, px0 - 0.5, -12, -zH - 0.5, px1 + 0.5, 1.9, zH + 0.5, AUX.ashlar(0.8), 0.04);
    boxA(w, px0 - 0.62, 1.9, -zH - 0.62, px1 + 0.62, 2.25, zH + 0.62, AUX.mould, 0.04);
    const xi = s > 0 ? px0 : px1;                                  // face toward the arch
    boxA(w, s > 0 ? xi - 0.45 : xi, sp - 0.6, -hd - 0.3, s > 0 ? xi : xi + 0.45, sp, hd + 0.3, AUX.mould, 0.03);
    // frieze + cornice wrapping the pier at the deck level (the tower plinth sits on it)
    boxA(w, px0 - 0.12, yFr, -zH - 0.12, px1 + 0.12, yCo, zH + 0.12, AUX.mould, 0.02);
    corniceX(w, px0 - 0.4, px1 + 0.4, yCo, zH, coH, coP);
    boxA(w, px0, yCo, -zH, px1, deck, zH, AUX.mould);
    for (const f of [-1, 1]) {
      const zf = f * zH;
      // pilaster strips at both pier edges
      for (const [xa, xb] of [[px0, px0 + 1.5], [px1 - 1.5, px1]]) boxA(w, xa, 2.25, f > 0 ? zf - 0.05 : zf - 0.3, xb, yFr, f > 0 ? zf + 0.3 : zf + 0.05, AUX.ashlar(0.9), 0.03);
      // two framed gilt relief panels (ref 2: right tower base)
      const inner = s > 0 ? px0 + 4.6 : px1 - 4.6, outer = s > 0 ? px1 - 1.7 : px0 + 1.7;
      const xm = (inner + outer) / 2;
      const pA = [Math.min(inner, xm - 0.35), Math.max(inner, xm - 0.35)], pB = [Math.min(xm + 0.35, outer), Math.max(xm + 0.35, outer)];
      const panelKinds = s * f > 0 ? ['figure', 'hippocamp'] : ['hippocamp', 'figure'];
      [pA, pB].forEach((P, k) => {
        // r5 (ref 7, sunken): dark field + deeper carving so the figures read as silhouettes through 130 m of water
        boxA(sunken ? dk : w, P[0] - 0.1, 7.2, f > 0 ? zf - 0.05 : zf - 0.06, P[1] + 0.1, 26.3, f > 0 ? zf + 0.06 : zf + 0.05, sunken ? AUX.dark : AUX.ashlar(0.9));
        reliefPanelZ(kit, P[0], P[1], 7.3, 26.2, zf + f * 0.06, f, { kind: panelKinds[k], seed: 11 + k * 3 + (s > 0 ? 5 : 0) + (f > 0 ? 0 : 17), depth: sunken ? 0.7 : 0.32, frame: 0.5, frameProj: sunken ? 0.55 : 0.32, density: f > 0 ? 10 : 4 });
      });
      // gilt tablet above the panels + small string course
      boxA(w, px0 + 1.5, 26.6, f > 0 ? zf : zf - 0.2, px1 - 1.5, 26.9, f > 0 ? zf + 0.2 : zf, AUX.mould, 0.02);
      // banner hanging from the cornice on the inner part of the pier face (ref 2)
      const bx = s > 0 ? px0 + 3.0 : px1 - 3.0;
      if (!sunken) kit.slots.banner.push({ pos: kit.W(bx, yFr - 0.1, zf + f * 0.36), facing: kit.compass(0, f), size: [2.8, 10.0], tag: 'wall', style: 'V', source: 'bridges-gate-pier' });
      // statue pedestal standing in the water at the pier corner next to the arch
      const sx = s > 0 ? px0 + 2.6 : px1 - 2.6;
      boxA(w, sx - 1.4, -11, f > 0 ? zf + 0.4 : zf - 3.2, sx + 1.4, 1.6, f > 0 ? zf + 3.2 : zf - 0.4, AUX.ashlar(0.8), 0.04);
      const top = pedestal(kit, sx, 1.6, zf + f * 1.8, 2.2, 3.6);
      kit.slots.statue.push({ pos: kit.W(sx, top, zf + f * 1.8), facing: kit.compass(0, f), size: 4.2, tag: 'pedestal', source: 'bridges-gate-pier' });
      if (sunken) {
        kit.coralAt(sx, top, zf + f * 1.8, 0, 1, 0, 0.8, 'gate-pier-pedestal');
        kit.coralAt(xm, 2.3, zf + f * 0.7, 0, 1, f * 0.3, 1.0, 'gate-pier-plinth');
        kit.coralAt(xm, 26.95, zf + f * 0.15, 0, 1, f * 0.2, 0.6, 'gate-pier-course');
      }
    }
    // the gate tower above the deck
    const tw = gateTower(kit, {
      x0: px0, x1: px1, z0: -zH, z1: zH, yDeck: deck, yTop: T.top,
      passage: { hw: 4.8, h: 12.5 }, gilt: true, banded: true, bannerFaces: ['+z', '-z'], bannerBig: true, seed: s > 0 ? 3 : 7, tag: 'gate-tower', sunkenNiche: true, midCornice: true,
      tholos: { R: 8.2, n: 12, colH: 8.2, domeH: 3.9, tridentH: 7.0, tridentThick: 1.6, stepF: 0.028, entF: 0.85, knobF: 0.6, drumH: 1.6 }, midFrac: 0.45,   // r2: ref 2 proportions (tall colonnade ≈ R, low dome, chunky trident)
      missingCols: sunken ? (i) => ruined(`${label}:col:${s}:${i}`, s > 0 ? 0.12 : 0.05) : null,
    });
    kit.registryTowers = kit.registryTowers || [];
    kit.registryTowers.push({ pos: kit.W(tw.cx, tw.roof, tw.cz), tip: tw.tip });
  }
  // ------------------------------------------------------------------ side viaducts (3 arches each) over the quays
  const sb = G.sideBays, ss = G.sideSpan, ssp = G.sideSpring, sa = ss / 2;
  const vx0 = T.x1, vx1 = G.viaductEnd - G.abutment;
  for (const s of [-1, 1]) {
    const arches = [];
    let x = vx0;
    for (let k = 0; k < sb; k++) {
      const xa = x, xb = x + ss;
      arches.push({ cx: s * (xa + sa), xa, xb });
      x = xb + (k < sb - 1 ? (vx1 - vx0 - sb * ss) / (sb - 1) : 0);
    }
    arches.forEach((A, k) => {
      archRing(kit, A.cx, ssp, sa, sa, -hd, hd, { thick: 1.1, n: 17, proj: 0.2, key: 0.3, frontDepth: 0.8 });
      const ext2 = { cx: A.cx, sp: ssp, a: sa, b: sa, off: 1.1 + 0.3, segs: 22 };
      // spandrel panels meet at the pier centres (no overlapping coplanar faces)
      const lo = k === 0 ? A.xa - 2.0 : (arches[k - 1].xb + A.xa) / 2, hi = k === sb - 1 ? A.xb + 2.0 : (A.xb + arches[k + 1].xa) / 2;
      const xl = s > 0 ? lo : -hi, xr = s > 0 ? hi : -lo;
      for (const f of [-1, 1]) spandrel(w, xl, xr, ssp, yFr, f * hd, f, [ext2], AUX.ashlar(0.95));
      if (kit.sunken) kit.coralAt(A.cx, ssp + sa + 1.5, hd + 0.2, 0, 0.3, 1, 0.8, 'gate-side-arch');
    });
    // piers between the side arches (+ the abutment at the end), from the ground to the springing
    const piers = [];
    for (let k = 0; k < sb; k++) {
      const pa = k < sb - 1 ? arches[k].xb : arches[k].xb, pb = k < sb - 1 ? arches[k + 1].xa : G.viaductEnd;
      piers.push([pa, pb]);
    }
    piers.forEach(([pa, pb], k) => {
      const xa = s > 0 ? pa : -pb, xb = s > 0 ? pb : -pa;
      const g0 = Math.min(ground(xa, -hd), ground(xb, hd), ground((xa + xb) / 2, 0));
      const isEnd = k === sb - 1;
      const pz = hd + (isEnd ? 0.15 : 0);
      boxA(w, xa, g0 - 2, -pz, xb, isEnd ? yFr : ssp, pz, AUX.ashlar(0.95));
      boxA(blk, xa - 0.35, g0 - 2, -hd - 0.35, xb + 0.35, g0 + 1.0, hd + 0.35, AUX.ashlar(0.7), 0.04);
      boxA(w, xa - 0.3, ssp - 0.55, -hd - 0.3, xb + 0.3, ssp, hd + 0.3, AUX.mould, 0.03);
      const xc = (xa + xb) / 2;
      for (const f of [-1, 1]) {
        // pilaster on the pier face rising to the frieze
        boxA(w, xc - 1.0, g0 + 1.0, f > 0 ? hd - 0.05 : -hd - 0.4, xc + 1.0, yFr, f > 0 ? hd + 0.4 : -hd + 0.05, AUX.ashlar(0.9), 0.03);
        if (!sunken && !isEnd) kit.slots.banner.push({ pos: kit.W(xc, yFr - 0.15, f * (hd + 0.45)), facing: kit.compass(0, f), size: [1.9, 7.0], tag: 'wall', style: 'V', source: 'bridges-gate-viaduct' });
        if (!isEnd) {
          const gone = sunken && ruined(`${label}:vped:${s}:${k}:${f}`, 0.3);
          if (!gone) {
            const top = pedestal(kit, xc, balY - 0.1, f * balZ, 1.6, 2.0);
            kit.slots.statue.push({ pos: kit.W(xc, top, f * balZ), facing: kit.compass(0, f), size: 3.6, tag: 'pedestal', source: 'bridges-gate-viaduct' });
          } else rubble(kit, xc, ground(xc, f * (hd + 3)), f * (hd + 3), 1.3, 5, `${label}:vpr:${s}:${k}:${f}`);
        }
        if (sunken) kit.coralAt(xc, g0 + 1.0, f * (hd + 0.6), 0, 1, f * 0.3, 0.9, 'gate-viaduct-plinth');
      }
    });
    // balustrade runs between pedestals along the viaduct
    const pedXs = piers.slice(0, -1).map(([pa, pb]) => (pa + pb) / 2);
    const stops = [T.x1 + 0.9, ...pedXs.flatMap((p) => [p - 0.85, p + 0.85]), G.viaductEnd - G.abutment + 0.2];
    for (const f of [-1, 1]) for (let i = 0; i < stops.length; i += 2) {
      const xa = stops[i], xb = stops[i + 1];
      balustradeX(kit, s > 0 ? xa : -xb, s > 0 ? xb : -xa, balY, f * balZ, { h: 1.25, broken: brokenBal((f > 0 ? 's' : 'n') + s) });
    }
    // end pylon (abutment top) with braziers + gilt urns, then the stair down to land ring 2
    const ex0 = G.viaductEnd - G.abutment, ex1 = G.viaductEnd;
    const xa = s > 0 ? ex0 : -ex1, xb = s > 0 ? ex1 : -ex0;
    boxA(w, xa - 0.3, yCo + coH - 0.1, -hd - 1.0, xb + 0.3, deck + 2.6, -hd + 1.4, AUX.ashlar(0.8), 0.03);
    boxA(w, xa - 0.3, yCo + coH - 0.1, hd - 1.4, xb + 0.3, deck + 2.6, hd + 1.0, AUX.ashlar(0.8), 0.03);
    for (const f of [-1, 1]) {
      const zc = f * (hd - 0.2);
      boxA(w, xa - 0.5, deck + 2.6, zc - 1.4, xb + 0.5, deck + 3.0, zc + 1.4, AUX.mould, 0.03);
      if (!sunken || !ruined(`${label}:pylon:${s}:${f}`, 0.5)) kit.slots.brazier.push({ pos: kit.W((xa + xb) / 2, deck + 3.0, zc), facing: kit.compass(s, 0), size: 1.6, tag: 'pedestal', source: 'bridges-gate-pylon' });
      else kit.coralAt((xa + xb) / 2, deck + 3.0, zc, 0, 1, 0, 0.8, 'gate-pylon');
    }
    const gEnd = ground(s * (G.stairEnd + 4), 0);
    stairsX(kit, s > 0 ? ex1 : -ex1, s, deck, gEnd, G.stairHalfW, { label: `${label}:stair:${s}`, cheek: 2.0 });
  }
  // ------------------------------------------------------------------ sunken extras: rubble on the canal bed, kelp anchors
  if (sunken) {
    for (let i = 0; i < 9; i++) {
      const s = ruinRand(`${label}:rub:${i}`, 0) < 0.5 ? -1 : 1;
      const x = s * (6 + 24 * ruinRand(`${label}:rub:${i}`, 1)), z = (ruinRand(`${label}:rub:${i}`, 2) - 0.5) * 70 + (ruinRand(`${label}:rub:${i}`, 3) < 0.5 ? 20 : -20);
      rubble(kit, x, Math.max(ground(x, z), L.SUNKEN.sandLevelRings - 5), z, 0.8 + ruinRand(`${label}:rub:${i}`, 4) * 1.0, 4, `${label}:rubb:${i}`);
    }
    const kelpN = 22;
    for (let i = 0; i < kelpN; i++) {
      const s = i % 2 ? 1 : -1;
      // along the canal walls (clear of the arch opening, ref 7) and in the canal behind the bridge
      const behind = ruinRand(`${label}:kelp:${i}`, 1) < 0.45;
      const x = behind ? s * (6 + 24 * ruinRand(`${label}:kelp:${i}`, 0)) : s * (28 + 6 * ruinRand(`${label}:kelp:${i}`, 0));
      const z = behind ? -(hd + 8 + 40 * ruinRand(`${label}:kelp:${i}`, 2)) : hd + 4 + 30 * ruinRand(`${label}:kelp:${i}`, 2);
      kit.kelp.push({ pos: kit.W(x, ground(x, z), z), size: 18 + 26 * ruinRand(`${label}:kelp:${i}`, 3), tag: 'gate-canal' });
    }
    for (let x = X0 + 2; x < X1; x += 5.5) for (const f of [-1, 1]) {
      if (Math.abs(Math.abs(x) - (T.x0 + T.x1) / 2) < T.w / 2) continue;
      if (hash3(Math.round(x), f + 3, 9) < 0.55) kit.coralAt(x, balY, f * (hd + coP * 0.9), 0, 1, 0, 0.55 + 0.4 * hash3(Math.round(x), f, 4), 'gate-cornice');
    }
  }
  kit.footprints.push({ type: 'rect', cx: 0, cz: G.z, hw: G.stairEnd + 2, hd: hd + 2.5, rotY: 0, tag: 'bridge-gate' });
  return { towers: kit.registryTowers };
}
