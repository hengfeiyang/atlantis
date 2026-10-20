// Shed-mole head (r3, ref 4 / shot 4): the water TUNNEL block in front of the mole head (deep vaulted passage along the
// mole, dark inside, gilt keystone, hippocamp relief over the portal) and the arched BRIDGE from it to the citadel quay:
// a gate pier with a gold statue, one wide arch, an end tower with a tholos straddling the citadel curtain.
// Plan: src/rings/mole.js (molePlan().tunnel / .bridge). OWNER: bridges agent (arch-a).
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { ruined } from '../world/era.js';
import { AUX, boxA, archRing, archBand, archPoint, spandrel, corniceX, corniceRect, balustradeX, pedestal, reliefPanelZ, medallionZ, surface } from './kit.js';
import { gateTower } from './tower.js';
import { cutwater } from './parts.js';
import { molePlan } from '../rings/mole.js';

const PI = Math.PI;

export function buildMoleHead(kit) {
  const mp = molePlan();
  if (!mp) return null;
  const sunken = kit.sunken;
  const w = kit.mb.white, blk = kit.mb.black, lime = kit.mb.lime, red = kit.mb.red, dk = kit.mb.dark;
  const gW = (x, z = 0) => { const p = kit.W(x, 0, z); return heightAt(p[0], p[2]); };
  const D = mp.bridge.deck, yFr = D - 1.2, yCo = D - 0.35, coH = 0.75, coP = 0.5, balY = yCo + coH;
  const out = { towers: [] };
  // ================================================================ tunnel block (mole frame: x = lat east, z = -(s - sMid))
  {
    const T = mp.tunnel, sMid = (T.s[0] + T.s[1]) / 2, hdT = (T.s[1] - T.s[0]) / 2;
    const [ox, oz] = mp.frame.P(sMid, 0);
    kit.begin(ox, oz, T.rotY);
    const xa = -T.width, xb = mp.spec.depth, a = T.clear / 2, cx = xa + 1.5 + a;
    const sp = 3.2, b = 5.6, thick = 1.15;
    const g0 = Math.min(gW(xa, -hdT), gW(xa, hdT), gW(cx, 0), gW(xb, 0)) - 1.5;
    // piers / solid east part up to the frieze, black plinth at the water line
    boxA(w, xa, g0, -hdT, cx - a, yFr, hdT, AUX.ashlar(0.9));
    boxA(w, cx + a, g0, -hdT, xb, yFr, hdT, AUX.ashlar(0.9));
    for (const [x0, x1] of [[xa - 0.3, cx - a], [cx + a, xb]]) boxA(blk, x0, g0, -hdT - 0.3, x1, 1.3, hdT + 0.3, AUX.ashlar(0.7), 0.03);
    boxA(blk, xa - 0.3, g0, -hdT - 0.3, xa, 1.3, hdT + 0.3, AUX.ashlar(0.7), 0.03);
    // impost moulding at the springing (both portals)
    for (const f of [-1, 1]) for (const [x0, x1] of [[cx - a - 0.9, cx - a + 0.25], [cx + a - 0.25, cx + a + 0.9]]) boxA(w, x0, sp - 0.45, f > 0 ? hdT - 0.1 : -hdT - 0.3, x1, sp, f > 0 ? hdT + 0.3 : -hdT + 0.1, AUX.mould, 0.03);
    // voussoir ring through the whole depth (front rings project) + gold keystones
    archRing(kit, cx, sp, a, b, -hdT, hdT, { thick, n: 19, proj: 0.3, key: 0.45, frontDepth: 0.9, goldKey: true });
    // dark deep soffit + passage walls inside (ref 4: the tunnel reads black with a lit far end)
    const zi0 = -hdT + 1.0, zi1 = hdT - 1.0;
    surface(dk, (u, v, o) => { const t = PI * v; o[0] = cx - Math.cos(t) * (a - 0.03); o[1] = sp + Math.sin(t) * (b - 0.03); o[2] = zi0 + (zi1 - zi0) * u; }, 6, 22, { flip: true, aux: AUX.dark });
    boxA(dk, cx - a, g0, zi0, cx - a + 0.03, sp, zi1, AUX.dark);
    boxA(dk, cx + a - 0.03, g0, zi0, cx + a, sp, zi1, AUX.dark);
    const ext = [{ cx, sp, a, b, off: thick + 0.2, segs: 30 }];
    for (const f of [-1, 1]) spandrel(w, xa, xb, sp, yFr, f * hdT, f, ext, AUX.ashlar(0.85));
    // frieze (red panels), cornice all round, deck, parapet strip
    for (const f of [-1, 1]) {
      boxA(w, xa, yFr, f > 0 ? hdT - 0.1 : -hdT - 0.1, xb, yCo, f > 0 ? hdT + 0.1 : -hdT + 0.1, AUX.mould, 0.02);
      const np = Math.round((xb - xa) / 2.7);
      for (let i = 0; i < np; i++) {
        const xc = xa + (xb - xa) * ((i + 0.5) / np), pw = (xb - xa) / np;
        boxA(red, xc - pw * 0.34, yFr + 0.15, f > 0 ? hdT + 0.06 : -hdT - 0.13, xc + pw * 0.34, yCo - 0.15, f > 0 ? hdT + 0.13 : -hdT - 0.06, [0.2, 0, 0.2, 0], 0.01);
      }
    }
    boxA(w, xa - 0.1, yFr, -hdT, xa + 0.1, yCo, hdT, AUX.mould, 0.02);
    corniceRect(w, xa, xb, -hdT, hdT, yCo, coH, coP);
    boxA(lime, xa, D - 0.5, -hdT + 0.05, xb, D, hdT - 0.05, AUX.pave(1.1));
    // hippocamp relief over the portal (both faces), pilasters framing the portal
    for (const f of [-1, 1]) {
      reliefPanelZ(kit, cx - a - 0.4, cx + a + 0.4, sp + b + thick + 0.75, yFr - 0.25, f * (hdT + 0.02), f, { kind: 'hippocamp', seed: 61 + f, depth: 0.32, frame: 0.38, frameProj: 0.26 });
      for (const xx of [xa + 0.75, cx + a + 1.6]) boxA(w, xx - 0.75, 1.3, f > 0 ? hdT - 0.05 : -hdT - 0.35, xx + 0.75, yFr, f > 0 ? hdT + 0.35 : -hdT + 0.05, AUX.ashlar(0.8), 0.03);
    }
    // balustrades on the top (south / north edges west of the curtain, west edge with the bridge gap)
    for (const f of [-1, 1]) balustradeX(kit, xa + 0.3, xb - 3.6, balY, f * (hdT - 0.35), { h: 1.1, post: 2.8 });
    // statues on corner pedestals (gold figures, ref 4) + banner on the portal pilasters
    for (const f of [-1, 1]) {
      const top = pedestal(kit, xa + 0.9, D, f * (hdT - 0.9), 1.3, 1.7, { panel: true });
      if (!sunken || !ruined(`mole-head:statue:${f}`, 0.5)) kit.slots.statue.push({ pos: kit.W(xa + 0.9, top, f * (hdT - 0.9)), facing: kit.compass(0, f), size: 3.4, tag: 'pinnacle', source: 'bridges-mole' });
      if (!sunken) kit.slots.banner.push({ pos: kit.W(xa + 0.75, yFr - 0.6, f * (hdT + 0.42)), facing: kit.compass(0, f), size: [1.6, 6.0], tag: 'bridge-mole' });
    }
    if (sunken) {
      kit.coralAt(cx, sp + b + thick + 0.2, hdT + 0.15, 0, 0.3, 1, 0.8, 'mole-tunnel');
      for (let i = 0; i < 4; i++) kit.coralAt(xa + 2 + i * 5, D, (i % 2 ? 1 : -1) * 4, 0, 1, 0, 1.4, 'mole-tunnel-top');
    }
    kit.footprints.push({ cx: kit.W((xa + xb) / 2, 0, 0)[0], cz: kit.W((xa + xb) / 2, 0, 0)[2], hw: (xb - xa) / 2 + 1, hd: hdT + 1, rotY: kit.rotY, tag: 'bridge-mole-tunnel' });
  }
  // ================================================================ bridge (local x along heading B.heading, -z faces the camera)
  {
    const B = mp.bridge, hd = B.halfWidth;
    kit.begin(B.origin[0], B.origin[1], B.rotY);
    const tw0 = 0, tw1 = 6.5, ex0 = B.tEnd - 6, ex1 = B.tEnd + 6;
    const x0 = tw1, x1 = ex0;
    const sp = 2.2, thick = 0.95;
    const crownMax = yFr + 0.15 - thick;
    // one wide arch, or two with a pier when the crossing is long (ref 4: a big round arch beside the tunnel)
    const nA = x1 - x0 > 28 ? 2 : 1, pierW = 4.5;
    const span = (x1 - x0 - (nA - 1) * pierW) / nA;
    const a = span / 2, b = Math.min(a, crownMax - sp);
    const arches = [];
    for (let k = 0; k < nA; k++) arches.push(x0 + a + k * (span + pierW));
    for (const cx of arches) archRing(kit, cx, sp, a, b, -hd, hd, { thick, n: Math.max(15, Math.round(span * 0.8) | 1), proj: 0.18, key: 0.26, frontDepth: 0.6, goldKey: true });
    const ext = arches.map((cx) => ({ cx, sp, a, b, off: thick + 0.2, segs: 24 }));
    for (const f of [-1, 1]) spandrel(w, x0 - 0.5, x1 + 0.5, sp, yFr, f * hd, f, ext, AUX.ashlar(0.85));
    for (const f of [-1, 1]) {
      boxA(w, x0 - 2, yFr, f > 0 ? hd - 0.1 : -hd - 0.1, x1 + 0.5, yCo, f > 0 ? hd + 0.1 : -hd + 0.1, AUX.mould, 0.02);
      const np = Math.max(1, Math.round((x1 - x0) / 2.6));
      for (let i = 0; i < np; i++) {
        const xc = x0 + (x1 - x0) * ((i + 0.5) / np), pw = (x1 - x0) / np;
        boxA(red, xc - pw * 0.34, yFr + 0.15, f > 0 ? hd + 0.06 : -hd - 0.13, xc + pw * 0.34, yCo - 0.15, f > 0 ? hd + 0.13 : -hd - 0.06, [0.2, 0, 0.2, 0], 0.01);
      }
      // r4 (ref 4): carved scroll archivolt band on every arch + round gilt medallions in the spandrels
      for (const cx of arches) archBand(kit, cx, sp, a, b, thick + 0.05, thick + 0.8, f * hd, f, { waves: 24, depth: 0.16 });
      for (const cx of arches) for (const s of [-1, 1]) medallionZ(kit, cx + s * (a + thick + 1.1), yFr - 1.75, f * (hd + 0.02), f, 0.95, 5 + s + (f > 0 ? 2 : 0));
    }
    // middle pier: cutwaters + a pedestal pair with statues / braziers over it
    if (nA === 2) {
      const pa = x0 + span, pb = pa + pierW, pc = (pa + pb) / 2;
      const g0 = Math.min(gW(pa, -hd), gW(pb, hd), gW(pc, 0)) - 1.5;
      boxA(w, pa, g0, -hd, pb, sp, hd, AUX.ashlar(0.9));
      boxA(blk, pa - 0.3, g0, -hd - 0.3, pb + 0.3, 1.2, hd + 0.3, AUX.ashlar(0.7), 0.03);
      boxA(w, pa - 0.25, sp - 0.45, -hd - 0.25, pb + 0.25, sp, hd + 0.25, AUX.mould, 0.03);
      for (const f of [-1, 1]) {
        cutwater(kit, pa + 0.2, pb - 0.2, f * (hd + 0.3), f, g0, 3.4);
        boxA(w, pc - 0.8, 3.4, f > 0 ? hd - 0.05 : -hd - 0.32, pc + 0.8, yFr, f > 0 ? hd + 0.32 : -hd + 0.05, AUX.ashlar(0.8), 0.03);
        const top = pedestal(kit, pc, balY - 0.1, f * (hd + 0.12), 1.15, 1.5, { panel: true });
        if (!sunken || !ruined(`mole-bridge:ped:${f}`, 0.4)) {
          if (f < 0) kit.slots.statue.push({ pos: kit.W(pc, top, f * (hd + 0.12)), facing: kit.compass(0, f), size: 3.0, tag: 'pinnacle', source: 'bridges-mole' });
          else kit.slots.brazier.push({ pos: kit.W(pc, top, f * (hd + 0.12)), facing: kit.compass(0, f), size: 0.95, tag: 'pedestal', source: 'bridges-mole' });
        }
      }
    }
    const cx = arches[0];
    corniceX(w, x0 - 2, x1 + 0.5, yCo, hd, coH, coP);
    boxA(lime, -2.5, D - 0.5, -hd + 0.05, x1 + 0.5, D, hd - 0.05, AUX.pave(1.1));
    // deck under the pier tower start (inside the tunnel block skew) + parapet strips
    boxA(w, -2.5, yFr, -hd, tw0, D - 0.5, hd, AUX.ashlar(0.8));
    const stops = nA === 2 ? [[x0 + 0.3, x0 + span + pierW / 2 - 0.8], [x0 + span + pierW / 2 + 0.8, x1 - 0.3]] : [[x0 + 0.3, x1 - 0.3]];
    for (const f of [-1, 1]) for (const [sa, sb] of stops) balustradeX(kit, sa, sb, balY, f * (hd + 0.12), { h: 1.1, post: 2.8, broken: sunken ? (i, xx) => (ruined(`mole-bridge:bal:${f}:${Math.round(xx)}`, 0.45) ? 1 : 0) : null });
    if (sunken) kit.coralAt(cx, sp + b + thick + 0.2, -hd - 0.15, 0, 0.3, -1, 0.8, 'mole-bridge-arch');
    // ---- pier tower (between the tunnel block and the arch): pylon with a gold statue (ref 4)
    {
      const g0 = Math.min(gW(tw0, -6), gW(tw1, 6), gW((tw0 + tw1) / 2, 0)) - 1.5;
      boxA(w, tw0 - 0.3, g0, -6.3, tw1 + 0.3, D, 6.3, AUX.ashlar(0.9));
      boxA(blk, tw0 - 0.6, g0, -6.6, tw1 + 0.6, 1.3, 6.6, AUX.ashlar(0.7), 0.03);
      for (const f of [-1, 1]) cutwater(kit, tw0 + 0.4, tw1 - 0.4, f * 6.6, f, g0, 3.6);
      boxA(w, tw0 - 0.55, D - 0.5, -6.55, tw1 + 0.55, D, 6.55, AUX.mould, 0.03);
      const t = gateTower(kit, { x0: tw0, x1: tw1, z0: -6, z1: 6, yDeck: D, yTop: D + 8.5, passage: { hw: 2.6, h: 5.6 }, gilt: true, banded: true,
        bannerFaces: sunken ? [] : ['-z', '+z'], seed: 77, tag: 'mole-pier-tower', fallenTop: true });
      if (!sunken || !ruined('mole-pier:statue', 0.4)) kit.slots.statue.push({ pos: kit.W((tw0 + tw1) / 2, t.roof + 0.15, 0), facing: kit.compass(0, -1), size: 4.6, tag: 'pinnacle', source: 'bridges-mole' });
      out.towers.push({ pos: kit.W((tw0 + tw1) / 2, t.roof, 0), tip: t.roof + 4.6 });
    }
    // ---- end tower on the citadel quay (straddles the citadel curtain gap), gold tholos
    {
      const g0 = Math.min(gW(ex0, -6), gW(ex1, 6), gW(ex0, 6), gW(ex1, -6), gW(B.tEnd, 0)) - 2;
      boxA(w, ex0 - 0.3, g0, -6.3, ex1 + 0.3, D, 6.3, AUX.ashlar(0.9));
      boxA(blk, ex0 - 0.65, g0, -6.65, ex1 + 0.65, Math.max(1.3, Math.min(D - 1.5, L.CITADEL.quayY + 0.9)), 6.65, AUX.ashlar(0.7), 0.04);
      boxA(w, ex0 - 0.55, D - 0.5, -6.55, ex1 + 0.55, D, 6.55, AUX.mould, 0.03);
      // quay door + landing on the citadel side
      boxA(dk, ex1 + 0.28, L.CITADEL.quayY, -1.6, ex1 + 0.32, L.CITADEL.quayY + 4.6, 1.6, AUX.dark, 0);
      boxA(w, ex1 + 0.3, L.CITADEL.quayY + 4.6, -2.0, ex1 + 0.7, L.CITADEL.quayY + 5.1, 2.0, AUX.mould, 0.02);
      const t = gateTower(kit, { x0: ex0, x1: ex1, z0: -6, z1: 6, yDeck: D, yTop: D + 11, passage: { hw: 2.9, h: 6.6 }, gilt: false, banded: true,
        bannerFaces: sunken ? [] : ['-z', '+z'], seed: 79, tag: 'mole-end-tower',
        tholos: { R: 4.2, n: 10, colH: 3.8, domeH: 2.0, tridentH: 3.2, tridentThick: 1.3 },
        tridentBroken: sunken && ruined('mole-end:trident', 0.4), missingCols: sunken ? (i) => ruined(`mole-end:col:${i}`, 0.2) : null });
      out.towers.push({ pos: kit.W(B.tEnd, t.roof, 0), tip: t.tip });
    }
    const cc = kit.W((tw0 + ex1) / 2, 0, 0);
    kit.footprints.push({ cx: cc[0], cz: cc[2], hw: (ex1 - tw0) / 2 + 1, hd: 7.5, rotY: kit.rotY, tag: 'bridge-mole' });
  }
  return out;
}

// ================================================================ ref 1: towers along the two sea moles (canal mouth)
// rings builds the moles (src/rings/canal.js, L.MOLES, top y 3.2, half width 9) and the lighthouses at their tips;
// here: a banded gate tower with a gold-domed tholos near the root of each mole (the mole walk passes through it)
// and a slimmer statue-topped tower half way out.
export function buildMoleTowers(kit) {
  const out = [];
  const yT = 3.2, eR = L.RINGS[3].r1 + 3.35;
  for (const m of L.MOLES) {
    const x = m.from[0];
    const z0 = Math.sqrt(eR * eR - (Math.abs(x) + 9) ** 2) - 1.0, z1 = m.to[1];
    const label = `mole-tower:${x}`;
    for (const [k, zc, hw, top] of [[0, z0 + 20, 6.5, 22], [1, z0 + (z1 - z0) * 0.58, 4.6, 15]]) {
      kit.begin(x, zc, -Math.PI / 2);   // local x = world +z (along the mole): the walk passes through the tower
      const fallen = kit.sunken && ruined(`${label}:${k}:top`, 0.5);
      const t = gateTower(kit, {
        x0: -hw, x1: hw, z0: -hw, z1: hw, yDeck: yT, yTop: yT + top, passage: { hw: k ? 2.0 : 2.8, h: k ? 4.6 : 6.2 }, gilt: !k, banded: true,
        bannerFaces: kit.sunken ? [] : ['+z', '-z', '-x'], seed: 91 + k * 3 + (x > 0 ? 1 : 0), tag: 'mole-tower',
        tholos: { R: hw * 0.62, n: 10, colH: hw * 0.55, tridentH: hw * 0.5 },
        fallenTop: k === 1 || fallen, tridentBroken: kit.sunken, missingCols: kit.sunken ? (i) => ruined(`${label}:${k}:col:${i}`, 0.3) : null,
      });
      // footing: rusticated base down into the sea bed beside the mole + black plinth
      boxA(kit.mb.white, -hw - 0.3, -14, -hw - 0.3, hw + 0.3, yT, hw + 0.3, AUX.ashlar(0.9));
      boxA(kit.mb.black, -hw - 0.6, -14, -hw - 0.6, hw + 0.6, 1.4, hw + 0.6, AUX.ashlar(0.7), 0.04);
      if (k === 1 && !(kit.sunken && ruined(`${label}:fig`, 0.4))) kit.slots.statue.push({ pos: kit.W(0, t.roof + 0.15, 0), facing: 180, size: 4.2, tag: 'pinnacle', source: 'bridges-mole-tower' });
      kit.footprints.push({ cx: x, cz: zc, hw: hw + 1, hd: hw + 1, rotY: 0, tag: 'bridge-mole-tower' });
      out.push({ pos: [x, t.roof, zc], tip: t.tip });
    }
  }
  return out;
}
