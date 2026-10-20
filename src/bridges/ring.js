// Ring bridges (refs 1, 4, 5): multi-arch stone bridges across the water rings with a gate tower on each
// land ring (deck passes through the towers), a mid-span gate tower on the long water-ring-2 bridges,
// cutwaters, pedestals with statues / braziers over every pier, balustrades, approach stairs.
// Special: water ring 1 at bearing 180 — the HIGH ARCH over the canal mouth (one wide elliptical arch,
// tower standing in the water off the citadel quay, outer end abutting the canal-tunnel portal).
// Local frame per bridge: x = radius along the bearing, z across. OWNER: bridges agent.
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { ruined, ruinRand } from '../world/era.js';
import { AUX, boxA, archRing, spandrel, corniceX, balustradeX, pedestal, reliefPanelZ, medallionZ, hash3 } from './kit.js';
import { gateTower } from './tower.js';
import { rubble, approach, cutwater, fallenTholos } from './parts.js';

// sunken-era damage, deterministic (labels are stable)
const COLLAPSED = { 'w3-45': 2, 'w2-240': 1 };
const FALLEN_TOP = { 'w2-60': 'mid', 'w3-315': 'outer' };

export function buildRingBridge(kit, P) {
  const sunken = kit.sunken;
  kit.begin(0, 0, P.rotY);
  const w = kit.mb.white, blk = kit.mb.black, lime = kit.mb.lime, red = kit.mb.red, gl = kit.mb.gilt, dk = kit.mb.dark;
  const gW = (x, z = 0) => { const p = kit.W(x, 0, z); return heightAt(p[0], p[2]); };
  const D = P.deck, hd = P.halfWidth;
  const yFr = D - 1.2, yCo = D - 0.35, coH = 0.75, coP = 0.5, balY = yCo + coH;
  const label = 'ring:' + P.id;
  const special = P.special === 'canalMouth';
  // ---------------------------------------------------------------- arch layout between the towers
  const x0 = P.x0, x1 = P.x1, Lb = x1 - x0;
  let piersW, n;
  if (special) { n = 1; piersW = []; }
  else if (P.ring === 'w1') { n = 3; piersW = [5, 5]; }
  else if (P.ring === 'w2') { n = 6; piersW = [4.5, 4.5, 12, 4.5, 4.5]; }
  else { n = 4; piersW = [4.5, 4.5, 4.5]; }
  const span = (Lb - piersW.reduce((s, v) => s + v, 0)) / n;
  const thick = special ? 1.6 : 0.95;
  const sp = special ? 3.0 : P.ring === 'w3' ? 1.8 : 2.2;
  const crownMax = yFr + 0.15 - thick;
  const a = span / 2, b = Math.min(a, crownMax - sp);
  const arches = [], piers = [];
  let x = x0;
  for (let k = 0; k < n; k++) {
    arches.push({ k, xa: x, xb: x + span, cx: x + a });
    x += span;
    if (k < n - 1) { piers.push({ k, xa: x, xb: x + piersW[k], mid: piersW[k] > 8 }); x += piersW[k]; }
  }
  const collapsed = sunken && COLLAPSED[P.id] !== undefined ? COLLAPSED[P.id] : -1;
  const fallen = sunken ? FALLEN_TOP[P.id] : null;
  // bay boundaries (pier centres) for cutting a collapsed span out of the continuous parts
  const gaps = [];
  if (collapsed >= 0) {
    const A = arches[collapsed];
    const lo = collapsed > 0 ? (piers[collapsed - 1].xa + piers[collapsed - 1].xb) / 2 + 0.6 : A.xa;
    const hi = collapsed < n - 1 ? (piers[collapsed].xa + piers[collapsed].xb) / 2 - 0.6 : A.xb;
    gaps.push([lo, hi]);
  }
  const cut = (xa, xb) => {
    let segs = [[xa, xb]];
    for (const [g0, g1] of gaps) segs = segs.flatMap(([s0, s1]) => (g1 <= s0 || g0 >= s1 ? [[s0, s1]] : [[s0, Math.min(s1, g0)], [Math.max(s0, g1), s1]].filter(([u, v]) => v - u > 0.2)));
    return segs;
  };
  // ---------------------------------------------------------------- arches + spandrels
  for (const A of arches) {
    if (A.k === collapsed) continue;
    archRing(kit, A.cx, sp, a, b, -hd, hd, { thick, n: special ? 45 : Math.max(11, Math.round(span * 0.8) | 1), proj: special ? 0.26 : 0.16, key: special ? 0.4 : 0.22, frontDepth: 0.6, goldKey: special || P.ring !== 'w3', alt: special });
    if (sunken) kit.coralAt(A.cx, sp + b + thick + 0.2, hd + 0.15, 0, 0.3, 1, 0.6, 'ring-arch');
  }
  const exts = arches.filter((A) => A.k !== collapsed).map((A) => ({ cx: A.cx, sp, a, b, off: thick + 0.2, segs: special ? 40 : 18 }));
  for (const [sa, sb] of cut(x0 - 1.5, x1 + 1.5)) {
    const ex = exts.filter((E) => E.cx > sa && E.cx < sb);
    for (const f of [-1, 1]) spandrel(w, sa, sb, sp, yFr, f * hd, f, ex, AUX.ashlar(0.85));
  }
  if (special) for (const f of [-1, 1]) for (const s of [-1, 1]) medallionZ(kit, arches[0].cx + s * (a - 3.0), sp + b * 0.75, f * (hd + 0.02), f, 1.9, 5 + s);
  // ---------------------------------------------------------------- frieze, cornice, deck, parapet strips
  for (const [sa, sb] of cut(x0 - 1.2, x1 + 1.2)) {
    for (const f of [-1, 1]) {
      boxA(w, sa, yFr, f > 0 ? hd - 0.1 : -hd - 0.1, sb, yCo, f > 0 ? hd + 0.1 : -hd + 0.1, AUX.mould, 0.02);
      const np = Math.max(1, Math.round((sb - sa) / 2.6));
      for (let i = 0; i < np; i++) {
        const xc = sa + (sb - sa) * ((i + 0.5) / np), pw = (sb - sa) / np;
        boxA(red, xc - pw * 0.34, yFr + 0.15, f > 0 ? hd + 0.06 : -hd - 0.13, xc + pw * 0.34, yCo - 0.15, f > 0 ? hd + 0.13 : -hd - 0.06, [0.2, 0, 0.2, 0], 0.01);
      }
    }
    corniceX(w, sa, sb, yCo, hd, coH, coP);
    boxA(lime, sa, D - 0.5, -hd + 0.05, sb, D, hd - 0.05, AUX.pave(1.1));
    boxA(w, sa, yCo + coH - 0.05, hd - 0.5, sb, balY, hd + 0.05, AUX.mould);
    boxA(w, sa, yCo + coH - 0.05, -hd - 0.05, sb, balY, -hd + 0.5, AUX.mould);
  }
  if (gaps.length) {
    // broken edges + the fallen span in the ring bed
    for (const [g0, g1] of gaps) {
      const xm = (g0 + g1) / 2;
      const bed = Math.max(gW(xm), L.SUNKEN.sandLevelRings - 3);
      for (let i = 0; i < 4; i++) rubble(kit, xm + (i - 1.5) * (g1 - g0) * 0.25, bed, (ruinRand(label + ':gz', i) - 0.5) * hd * 2.4, 1.1 + ruinRand(label + ':gs', i) * 0.9, 5, `${label}:span:${i}`);
      for (const xe of [g0, g1]) kit.coralAt(xe, D, 0, 0, 1, 0, 1.0, 'ring-broken-deck');
    }
  }
  // ---------------------------------------------------------------- piers: plinth, cutwaters, pilasters, pedestals
  const balZ = hd + 0.12;
  const pedXs = [];
  for (const Pr of piers) {
    const xc = (Pr.xa + Pr.xb) / 2;
    const g0 = Math.min(gW(Pr.xa, -hd), gW(Pr.xb, hd), gW(xc, 0)) - 1.5;
    const zH = Pr.mid ? 6.3 : hd;
    boxA(w, Pr.xa, g0, -zH, Pr.xb, Pr.mid ? D : sp, zH, AUX.ashlar(0.9));
    boxA(blk, Pr.xa - 0.3, g0, -zH - 0.3, Pr.xb + 0.3, 1.2, zH + 0.3, AUX.ashlar(0.7), 0.03);
    if (!Pr.mid) boxA(w, Pr.xa - 0.25, sp - 0.45, -hd - 0.25, Pr.xb + 0.25, sp, hd + 0.25, AUX.mould, 0.03);
    for (const f of [-1, 1]) {
      cutwater(kit, Pr.xa + 0.2, Pr.xb - 0.2, f * (zH + 0.3), f, g0, 3.4);
      if (!Pr.mid) boxA(w, xc - 0.8, 3.4, f > 0 ? hd - 0.05 : -hd - 0.32, xc + 0.8, yFr, f > 0 ? hd + 0.32 : -hd + 0.05, AUX.ashlar(0.8), 0.03);
      if (sunken) kit.coralAt(xc, 1.25, f * (zH + 0.5), 0, 1, f * 0.4, 0.8, 'ring-pier-plinth');
    }
    if (Pr.mid) continue;
    pedXs.push(xc);
    for (const f of [-1, 1]) {
      if (gaps.some(([u, v]) => xc > u - 1 && xc < v + 1)) continue;
      const gone = sunken && ruined(`${label}:ped:${xc.toFixed(0)}:${f}`, 0.4);
      if (gone) { kit.coralAt(xc, balY, f * balZ, 0, 1, 0, 0.6, 'ring-pedestal'); continue; }
      const top = pedestal(kit, xc, balY - 0.1, f * balZ, 1.15, 1.5, { panel: kit.detail > 0.4 });
      const k = Math.round(xc);
      if ((k + (f > 0 ? 0 : 1)) % 3 !== 0) kit.slots.statue.push({ pos: kit.W(xc, top, f * balZ), facing: kit.compass(0, f), size: 2.7, tag: 'pedestal', source: 'bridges-ring' });
      else kit.slots.brazier.push({ pos: kit.W(xc, top, f * balZ), facing: kit.compass(0, f), size: 0.95, tag: 'pedestal', source: 'bridges-ring' });
    }
    if (sunken && hash3(Math.round(xc), 3, 1) < 0.5) kit.kelp.push({ pos: kit.W(xc, gW(xc, hd + 4), hd + 4), size: 10 + 14 * hash3(Math.round(xc), 5, 2), tag: 'ring-pier' });
  }
  // balustrade runs between pedestals / towers
  const midP = piers.find((p) => p.mid);
  const stops = [x0 - 0.2];
  for (const xc of pedXs) stops.push(xc - 0.7, xc + 0.7);
  if (midP) { stops.push(midP.xa - 0.4, midP.xb + 0.4); stops.sort((u, v) => u - v); }
  stops.push(x1 + 0.2);
  const brokenBal = (side) => (i, xx) => (sunken ? (ruined(`${label}:bal:${side}:${Math.round(xx)}`, 0.5) ? (ruined(`${label}:bal2:${side}:${Math.round(xx)}`, 0.5) ? 2 : 1) : 0) : 0);
  for (const f of [-1, 1]) for (let i = 0; i + 1 < stops.length; i += 2) for (const [sa, sb] of cut(stops[i], stops[i + 1])) balustradeX(kit, sa, sb, balY, f * balZ, { h: 1.1, broken: brokenBal(f), post: 2.8 });
  // ---------------------------------------------------------------- towers
  const towerOpts = (id) => ({
    passage: { hw: 2.9, h: 6.8 }, gilt: false, banded: true, seed: hash3(P.bearing, id.length, 7) * 100,
    bannerFaces: ['+z', '-z'], tag: 'ring-tower',
    tholos: { R: 4.1, n: 10, colH: 3.3, domeH: 1.9, tridentH: 2.4 },
    tridentBroken: sunken && ruined(`${label}:trident:${id}`, 0.3),
    missingCols: sunken ? (i) => ruined(`${label}:col:${id}:${i}`, 0.15) : null,
    fallenTop: fallen === id,
  });
  const towers = [];
  P.towers.forEach((T, i) => {
    const id = special ? 'inner' : i === 0 ? 'inner' : 'outer';
    const g0 = Math.min(gW(T.x0, -T.halfW), gW(T.x1, T.halfW), gW((T.x0 + T.x1) / 2, 0), gW(T.x0, T.halfW), gW(T.x1, -T.halfW)) - 2;
    // lower stage (from the ground / ring bed up to the deck)
    boxA(w, T.x0 - 0.3, g0, -T.halfW - 0.3, T.x1 + 0.3, D, T.halfW + 0.3, AUX.ashlar(0.9));
    const gTop = Math.max(gW(T.x0), gW(T.x1));
    boxA(blk, T.x0 - 0.65, g0, -T.halfW - 0.65, T.x1 + 0.65, Math.min(D - 1.5, Math.max(1.2, gTop + 0.9)), T.halfW + 0.65, AUX.ashlar(0.7), 0.04);
    boxA(w, T.x0 - 0.55, D - 0.5, -T.halfW - 0.55, T.x1 + 0.55, D, T.halfW + 0.55, AUX.mould, 0.03);
    if (special) {
      // tall water tower: pilasters + gilt relief panels on the ring-facing faces, a quay door + landing slab
      for (const f of [-1, 1]) {
        const zf = f * (T.halfW + 0.3);
        for (const xx of [T.x0 + 0.9, T.x1 - 0.9]) boxA(w, xx - 0.9, 1.2, f > 0 ? zf - 0.05 : zf - 0.35, xx + 0.9, D - 0.5, f > 0 ? zf + 0.35 : zf + 0.05, AUX.ashlar(0.9), 0.03);
        reliefPanelZ(kit, T.x0 + 2.4, T.x1 - 2.4, 6.0, D - 2.2, zf + f * 0.04, f, { kind: f > 0 ? 'figure' : 'hippocamp', seed: 41 + f, depth: 0.4, frame: 0.45, frameProj: 0.3 });
      }
      boxA(dk, T.x0 - 0.36, 3.0, -1.6, T.x0 - 0.3 + 0.01, 7.6, 1.6, AUX.dark, 0);
      boxA(w, T.x0 - 0.6, 7.6, -2.0, T.x0, 8.1, 2.0, AUX.mould, 0.02);
      boxA(lime, L.CITADEL.radius - 4, 2.6, -2.4, T.x0 - 0.3, 3.15, 2.4, AUX.pave(1.0), 0.03);
    }
    const tw = gateTower(kit, { x0: T.x0, x1: T.x1, z0: -T.halfW, z1: T.halfW, yDeck: D, yTop: T.top, ...towerOpts(id), bannerFaces: special ? ['+z', '-z', '-x'] : ['+z', '-z'] });
    towers.push(tw);
    if (fallen === id) {
      const zz = (ruinRand(label + ':fall', 0) < 0.5 ? -1 : 1) * (T.halfW + 7);
      const xx = (T.x0 + T.x1) / 2 + (ruinRand(label + ':fall', 1) - 0.5) * 8;
      fallenTholos(kit, xx, Math.max(gW(xx, zz), L.SUNKEN.sandLevelRings - 2), zz, 4.1, `${label}:fallen`);
    }
    // approach stairs down to the land ring (not for the special tower in the water)
    if (!special) {
      const dir = i === 0 ? -1 : 1, xs = i === 0 ? T.x0 - 0.3 : T.x1 + 0.3;
      if (P.ring === 'w1' && i === 0) approach(kit, xs, dir, D, hd - 0.4, { to: { x: L.CITADEL.terraces[1].r1 + 0.5, y: L.CITADEL.terraces[1].y } });
      else approach(kit, xs, dir, D, hd - 0.4);
    }
  });
  // mid-span tower on the long ring-2 bridges
  if (midP) {
    const T = { x0: midP.xa, x1: midP.xb, halfW: 6 };
    const tw = gateTower(kit, { x0: T.x0, x1: T.x1, z0: -T.halfW, z1: T.halfW, yDeck: D, yTop: D + 9.5, ...towerOpts('mid') });
    towers.push(tw);
    if (fallen === 'mid') {
      const zz = (ruinRand(label + ':fall', 0) < 0.5 ? -1 : 1) * 13;
      const xx = (T.x0 + T.x1) / 2 + (ruinRand(label + ':fall', 1) - 0.5) * 10;
      fallenTholos(kit, xx, Math.max(gW(xx, zz), L.SUNKEN.sandLevelRings - 2), zz, 4.1, `${label}:fallen`);
    }
  }
  // special outer abutment against the tunnel portal: pylon pair with braziers
  if (special) {
    const xa = x1, xb = x1 + 5;
    const g0 = Math.min(gW(xa), gW(xb)) - 2;
    boxA(w, xa, g0, -hd - 0.4, xb, yFr, hd + 0.4, AUX.ashlar(0.9));
    boxA(blk, xa - 0.3, g0, -hd - 0.7, xb + 0.3, 1.4, hd + 0.7, AUX.ashlar(0.7), 0.03);
    corniceX(w, xa, xb, yCo, hd + 0.4, coH, coP);
    boxA(lime, xa, D - 0.5, -hd + 0.05, xb, D, hd - 0.05, AUX.pave(1.1));
    for (const f of [-1, 1]) {
      const zc = f * (hd - 0.6);
      boxA(w, xa + 0.5, D, zc - 0.9, xb - 0.5, D + 2.4, zc + 0.9, AUX.ashlar(0.7), 0.03);
      boxA(w, xa + 0.35, D + 2.4, zc - 1.05, xb - 0.35, D + 2.7, zc + 1.05, AUX.mould, 0.02);
      if (!sunken) kit.slots.brazier.push({ pos: kit.W((xa + xb) / 2, D + 2.7, zc), facing: kit.compass(-1, 0), size: 1.3, tag: 'pedestal', source: 'bridges-canal-mouth' });
    }
  }
  // footprint along the bridge (towers + approaches add their own)
  const c = kit.W((P.towers[0].x0 + (P.towers[P.towers.length - 1].x1 ?? x1)) / 2, 0, 0);
  const xs0 = Math.min(...P.towers.map((t) => t.x0), x0), xs1 = Math.max(...P.towers.map((t) => t.x1), x1 + (special ? 5 : 0));
  const cc = kit.W((xs0 + xs1) / 2, 0, 0);
  void c;
  kit.footprints.push({ type: 'rect', cx: cc[0], cz: cc[2], hw: (xs1 - xs0) / 2 + 1, hd: 7.5, rotY: kit.rotY, tag: 'bridge-' + P.id });
  return { id: P.id, towers: towers.map((t) => ({ pos: kit.W(t.cx, t.roof, t.cz), tip: t.tip })) };
}
