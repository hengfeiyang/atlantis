// The grand staircase on the south face (ref 6): monumental straight flights descending from the
// plateau to a water quay, with landings at every terrace level. Built over the terrain on a solid
// ashlar substructure (cheek walls), with parapets carrying laurel-wreath panels, pedestals for
// statues and braziers, banner hooks, lamp posts and a quay with steps into the lagoon.
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { chamferBox, frameXZ, frameFacing, Frame, FACES, lin } from './geo.js';
import { blockColor, STONE_COL, wallRun, moulding, PROFILES, planArch, buildArch } from './masonry.js';
import { slopedBox } from './balustrade.js';
import { wreath, pedestal, lampPost, panelFrame } from './ornament.js';
import { SHOTS } from '../world/shots.js';
import { addRosette } from './plaza.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** scan the stair axis for flat ledges → [{y, z0, z1}] from the top down */
export function scanLedges(x, z0, z1) {
  const pts = [];
  for (let z = z0; z <= z1; z += 0.5) {
    const y = (heightAt(x - 5, z) + heightAt(x, z) + heightAt(x + 5, z)) / 3;
    pts.push([z, y]);
  }
  const ledges = [];
  let cur = null;
  for (let i = 4; i < pts.length - 4; i++) {
    const [z, y] = pts[i];
    const flat = Math.abs(pts[i + 4][1] - pts[i - 4][1]) < 0.9;
    if (flat && y > -0.5) {
      if (cur && Math.abs(y - cur.y) < 1.5) { cur.z1 = z; cur.yEnd = y; }
      else { if (cur) ledges.push(cur); cur = { y, z0: z, z1: z, yEnd: y }; }
    } else if (cur) { ledges.push(cur); cur = null; }
  }
  if (cur) ledges.push(cur);
  return ledges.filter((l) => l.z1 - l.z0 > 6);
}

/**
 * Plan the stair profile.
 * levels: [{y, zEdge}] — walk levels from the plateau down (zEdge = where that level's ground ends).
 */
export function planStair(levels, opts = {}) {
  const GS = L.GRAND_STAIR;
  const riser = GS.riser ?? 0.19, tread = GS.tread ?? 0.27, land = GS.landing ?? 7;
  const widths = GS.widths || [12, 14, 16, 18, 21];
  const segs = [];
  let z = levels[0].zEdge;
  let y = levels[0].y;
  segs.push({ kind: 'landing', z0: z - 14, z1: z, y0: y, y1: y, w: widths[0] + 8, top: true });
  const midLand = GS.midLanding ?? 2.8;
  for (let k = 1; k < levels.length; k++) {
    const yN = levels[k].y;
    const w = widths[Math.min(widths.length - 1, k - 1)];
    // long flights are split by a short half-landing (rhythm + pedestals), as in ref 6
    const parts = Math.max(1, Math.ceil((y - yN) / (GS.flightRise ?? 8.5)));
    for (let p = 0; p < parts; p++) {
      const yA = y - ((y - yN) * p) / parts, yB = y - ((y - yN) * (p + 1)) / parts;
      const n = Math.max(1, Math.round((yA - yB) / riser));
      const rr = (yA - yB) / n;
      segs.push({ kind: 'flight', z0: z, z1: z + n * tread, y0: yA, y1: yB, n, rr, t: tread, w });
      z += n * tread;
      if (p < parts - 1) { segs.push({ kind: 'landing', z0: z, z1: z + midLand, y0: yB, y1: yB, w, mid: true }); z += midLand; }
    }
    y = yN;
    const last = k === levels.length - 1;
    const wl = widths[Math.min(widths.length - 1, k)] + (last ? 10 : 4.6);
    const depth = last ? 9 : land;
    segs.push({ kind: last ? 'quay' : 'landing', z0: z, z1: z + depth, y0: y, y1: y, w: wl, level: k });
    z += depth;
  }
  return { x: GS.x, segs, zEnd: z };
}

/** stair surface height at z (nosing line on flights) */
export function stairSurface(plan, z) {
  for (const s of plan.segs) {
    if (z >= s.z0 - 1e-6 && z <= s.z1 + 1e-6) {
      if (s.kind !== 'flight') return s.y0;
      const i = Math.min(s.n - 1, Math.floor((z - s.z0) / s.t));
      return s.y0 - (i + 1) * s.rr;
    }
  }
  return null;
}
const lineSurf = (s, z) => (s.kind === 'flight' ? s.y0 - ((z - s.z0) / (s.z1 - s.z0)) * (s.y0 - s.y1) : s.y0);

/**
 * Build the whole stair.  ctx = { S, engine, slots, rng, footprints, zones, balus }
 */
export function buildStair(ctx, plan) {
  const { S, slots } = ctx;
  const rng = ctx.rng.fork ? ctx.rng.fork('stair') : ctx.rng;
  const X = plan.x;
  const T = 1.4;  // cheek wall thickness
  let pedCount = 0;
  const segs = plan.segs;
  for (let si = 0; si < segs.length; si++) {
    const sg = segs[si];
    const hw = sg.w / 2;
    // (r2) the top landing is part of the paved temple forecourt (src/acropolis/podium.js)
    if (sg.top && ctx.forecourtPaved) { ctx.footprints.addRect(X, (sg.z0 + sg.z1) / 2, hw + T + 0.5, (sg.z1 - sg.z0) / 2 + 0.5, 0, 'acro-stair'); continue; }
    if (sg.kind === 'flight') buildFlight(ctx, sg, X, rng);
    else buildLanding(ctx, sg, X, rng, segs[si - 1], segs[si + 1]);
    // cheek walls (substructure) on both sides
    for (const side of [-1, 1]) {
      const xFace = X + side * (hw + T);
      // frame: outward = side * +x
      const F = side > 0 ? frameXZ(xFace, 0, sg.z1, 0, -1, 1, 0) : frameXZ(xFace, 0, sg.z0, 0, 1, -1, 0);
      const len = sg.z1 - sg.z0;
      const zAt = (s) => (side > 0 ? sg.z1 - s : sg.z0 + s);
      const topAt = (s) => lineSurf(sg, zAt(s)) + 0.12;
      let gmin = Infinity;
      for (let s = 0; s <= len; s += 1) gmin = Math.min(gmin, heightAt(xFace + side * 0.5, zAt(s)));
      const yBot = gmin - 1.0;
      const yTopMax = Math.max(topAt(0), topAt(len));
      const gAt = (s) => heightAt(xFace + side * 0.4, zAt(s));
      // arcade: where the flight rides high over flat ground, open arched bays in the substructure (ref 3)
      const arches = [];
      if (sg.kind === 'flight' && !sg.bastion) {
        for (let s = 3.2; s < len - 3.2; s += 0.8) {
          const w = 3.4;
          const g0 = gAt(s), gl = gAt(s - w / 2 - 0.6), gr = gAt(s + w / 2 + 0.6);
          const clear = Math.min(topAt(s - w / 2 - 0.6), topAt(s + w / 2 + 0.6)) - Math.max(g0, gl, gr);
          if (Math.max(g0, gl, gr) - Math.min(g0, gl, gr) > 0.9 || clear < 9) continue;
          const h = Math.min(7.2, clear * 0.5);
          arches.push(planArch(s, Math.max(g0, gl, gr) + 0.08, w, h));
          s += w + 4.2;
        }
      }
      // (r2) open arcade over the lagoon (src/acropolis/arcade.js) replaces the solid cheek wall there
      let arcCut = null, inArcade = false;
      if (ctx.arcadeZ) {
        const [zA, zB] = ctx.arcadeZ;
        const sa = side > 0 ? sg.z1 - zB : zA - sg.z0, sb = side > 0 ? sg.z1 - zA : zB - sg.z0;
        const ca = Math.max(0, sa), cb = Math.min(len, sb);
        if (cb - ca > 0.05) arcCut = [ca, cb];
        if (ca <= 0.01 && cb >= len - 0.01) inArcade = true;
      }
      if (arcCut) for (let i = arches.length - 1; i >= 0; i--) if (arches[i].sc + arches[i].w / 2 + 1 > arcCut[0] && arches[i].sc - arches[i].w / 2 - 1 < arcCut[1]) arches.splice(i, 1);
      if (yTopMax - yBot > 0.5 && !sg.bastion && !inArcade) {
        wallRun(S, 'ashlar', F, len, yBot, yTopMax, {
          rng, courses: 'pseudo', batter: 0, rustic: true, rusticH: 3,
          groundAt: gAt, topAt, damp: 0.6, lite: true,
          cuts: arches.length || arcCut ? (c0, c1) => [...arches.map((A) => A.cut(c0, c1)).filter(Boolean), ...(arcCut ? [arcCut] : [])] : null,
        });
        for (const A of arches) {
          const r = buildArch(S, 'ashlar', F, A, rng, { depth: 1.3, voidBack: true });
          if (rng.random() < 0.25 && A.h > 4.4) ctx.slots.statue.push({ pos: r.statuePos, facing: side > 0 ? 90 : 270, size: Math.min(A.h * 0.6, 3), tag: 'acro-niche' });
        }
      }
      // parapet + coping band on top of the cheek wall
      if (!sg.bastion) parapet(ctx, sg, X, side, hw, T, rng);
    }
    // footprint & wall exclusion zone
    const cz = (sg.z0 + sg.z1) / 2, hz = (sg.z1 - sg.z0) / 2;
    ctx.footprints.addRect(X, cz, hw + T + 0.5, hz + 0.5, 0, 'acro-stair');
    ctx.zones.rect(X, cz, hw + T - 0.3, hz + 0.3, 0, 'stair');
  }
  return pedCount;
}

// ------------------------------------------------------------------ flights
function buildFlight(ctx, sg, X, rng) {
  const { S } = ctx;
  const hw = sg.w / 2;
  const Fst = new Frame([X, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]); // s = x - X, d = z
  for (let i = 0; i < sg.n; i++) {
    const yTop = sg.y0 - (i + 1) * sg.rr;
    const zBack = sg.z0 + i * sg.t - 0.12, zFront = sg.z0 + (i + 1) * sg.t + 0.025;
    // slabs across the width: irregular lengths, staggered from step to step
    let s = -hw;
    const B = S.get('tread', X, (zBack + zFront) / 2);
    while (s < hw - 0.05) {
      let Lb = 1.3 + rng.random() * 2.2;
      if (s + Lb > hw - 0.6) Lb = hw - s;
      const s1 = Math.min(hw, s + Lb);
      const col = blockColor(rng, STONE_COL);
      // worn: larger nosing chamfer in the walking line, slight settling
      const mid = Math.abs((s + s1) / 2) < hw * 0.6;
      // (r4) visibly settled / rocked slabs (ref 6: irregular worn treads)
      const settle = rng.gauss(0, 0.013) - (mid ? 0.006 : 0);
      const tilt = rng.gauss(0, 0.009);
      const dFj = rng.gauss(0, 0.012); // nosing line not quite straight
      // tilt about the slab's own centre
      const sc = (s + s1) / 2, zc = (zBack + zFront) / 2;
      const Fs = new Frame([X + sc, yTop, zc], [1, 0, 0], [0, 1, 0], [0, 0, 1]).tilted(tilt, rng.gauss(0, 0.007));
      B.aux = [0.08, mid ? 0.85 : 0.45, 0, 0];
      // risers (front faces) are greyer and grimier than the sun-bleached treads
      const riserCol = [col[0] * 0.84, col[1] * 0.83, col[2] * 0.82];
      const colF = (axis) => (axis === 2 ? riserCol : col);
      // worn bullnose: radius larger in the walking line
      const rn = (mid ? 0.055 : 0.038) + rng.random() * 0.03; // (r5) worn, rounded nosings (ref 6)
      const yB = -sg.rr - 0.16;
      const yJ = -sg.rr - settle; // top of the tread below, in the slab frame (grime band at the riser foot)
      const rC = rng.random();
      if (s1 - s > 1.6 && rC < 0.16) {
        // cracked slab: two pieces with a gap, one settled / rocked
        const cut = s - sc + (s1 - s) * (0.3 + 0.4 * rng.random());
        stepSlab(B, Fs, s - sc + 0.004, cut - 0.008, yB + settle, settle, zBack - zc, zFront - zc + dFj, rn, col, riserCol, yJ);
        const dropK = -0.008 - rng.random() * 0.02;
        stepSlab(B, Fs, cut + 0.008, s1 - sc - 0.004, yB + settle + dropK, settle + dropK, zBack - zc, zFront - zc + dFj - 0.01, rn * 0.8, darker(col, 0.95), riserCol, yJ - dropK);
        (ctx.crackSpots ||= []).push([X + cut, yTop, (zBack + zFront) / 2]);
      } else if (s1 - s > 1.4 && rC < 0.26) {
        // broken nosing: a chunk of the front edge is gone (ref 6), the rest of the slab intact
        const bw = 0.35 + rng.random() * 0.7, b0 = s - sc + 0.009 + rng.random() * (s1 - s - bw - 0.02);
        const pieces = [[s - sc + 0.009, b0, 0], [b0, b0 + bw, 1], [b0 + bw, s1 - sc - 0.009, 0]].filter((p) => p[1] - p[0] > 0.05);
        for (const [a, b, broken] of pieces) {
          if (broken) stepSlab(B, Fs, a, b, yB + settle - 0.03, settle - 0.035 - rng.random() * 0.03, zBack - zc + 0.04, zFront - zc + dFj - 0.07 - rng.random() * 0.05, rn * 2.2, darker(col, 0.86), darker(riserCol, 0.8), yJ + 0.035);
          else stepSlab(B, Fs, a, b, yB + settle, settle, zBack - zc, zFront - zc + dFj, rn, col, riserCol, yJ);
        }
        (ctx.crackSpots ||= []).push([X + sc + b0 + bw / 2, yTop, zFront - 0.06]);
      } else {
        stepSlab(B, Fs, s - sc + 0.009, s1 - sc - 0.009, yB + settle, settle, zBack - zc, zFront - zc + dFj, rn, col, riserCol, yJ);
      }
      B.aux = [0, 0, 0, 0];
      // (r4) weeds in the corner where this tread meets the riser above, at some slab joints
      if (rng.random() < 0.14) (ctx.crackSpots ||= []).push([X + s1 + rng.range(-0.15, 0.15), yTop, sg.z0 + i * sg.t + 0.09]);
      if (rng.random() < 0.05) (ctx.crackSpots ||= []).push([X + rng.range(s, s1), yTop, sg.z0 + i * sg.t + 0.08, 0.7]);
      // weeds and moss at the joints near the cheek walls
      if (Math.abs(s1) > hw - 0.3 && rng.random() < 0.25) (ctx.crackSpots ||= []).push([X + (s1 > 0 ? hw - 0.15 : -hw + 0.15), yTop, zFront - 0.05]);
      s = s1;
    }
  }
  // parapet pedestals along the flight (every ~7.5 m), projecting into the stair like ref 6
  const len = sg.z1 - sg.z0;
  const nIn = Math.max(0, Math.round(len / 3.9) - 1); // (r2) denser statue / brazier rows (refs 2, 6)
  const zs = [];
  for (let k = 1; k <= nIn; k++) zs.push(sg.z0 + (len * k) / (nIn + 1));
  const s6 = SHOTS.find((s) => s.id === 6);
  for (const side of [-1, 1]) {
    for (let k = 0; k < zs.length; k++) {
      const z = zs[k];
      const yBase = lineSurf(sg, z + 1.0) - 0.05;
      // (r6) the pier ahead-left of the shot-6 eye is the ref-6 hero pier: bigger, laurel panels, a large
      // bronze brazier with fire on top and a banner down its stair face (it carried a statue before)
      const hero = !!s6 && side < 0 && z < s6.pos[2] - 3 && Math.hypot(X + side * (hw + 0.35) - s6.pos[0], z - s6.pos[2]) < 14;
      const pw = hero ? 1.95 : 1.5, xc = X + side * (hw + (hero ? 0.55 : 0.35));
      const F = frameFacing(xc, 0, z, side > 0 ? 270 : 90);
      const yTop = pedestal(S, 'marble', F, yBase, pw, (hero ? 3.05 : 2.6) + rng.range(-0.1, 0.15), rng, { faces: ['front', 'back', 'left', 'right'] });
      const statue = !hero && (k + (side > 0 ? 1 : 0)) % 2 === 0;
      if (statue) ctx.slots.statue.push({ pos: [F.o[0], yTop, z], facing: side > 0 ? 238 : 122, size: 2.6 + rng.range(-0.2, 0.3), tag: 'acro-stair' });
      else {
        ctx.slots.brazier.push({ pos: [F.o[0], yTop, z], facing: side > 0 ? 270 : 90, size: hero ? 1.25 : 0.9, tag: hero ? 'acro-landing' : 'acro-stair' });
        // (r2) banner hanging on the inner face of the brazier pedestal (ref 6)
        // (r5) not on the pedestals right beside the shot-6 eye (a huge cut-off banner at the frame edge)
        const nearEye = s6 && Math.hypot(F.o[0] - s6.pos[0], z - s6.pos[2]) < 14;
        if (hero) ctx.slots.banner.push({ pos: [xc, yTop - 0.25, z + pw / 2 + 0.2], facing: 180, size: [1.45, 2.95], tag: 'acro-stair' }); // on the downhill face, toward the camera (ref 6)
        else if (!nearEye) ctx.slots.banner.push( // (r6) every brazier pedestal: the left flank of the upper flights (shot 6) had none
          { pos: [X + side * (hw - 0.4 - 0.1), yTop - 0.3, z], facing: side > 0 ? 270 : 90, size: [1.05, 2.0], tag: 'acro-stair-pedestal' });
      }
      ctx.footprints.addCircle(F.o[0], z, 1.0, 'acro-pedestal');
    }
  }
}

// ------------------------------------------------------------------ landings / quay
function buildLanding(ctx, sg, X, rng, prev, next) {
  const { S, slots } = ctx;
  const hw = sg.w / 2;
  const y = sg.y0;
  const depth = sg.z1 - sg.z0;
  // paving: large slabs in rows across the landing
  const B = S.get('tread', X, (sg.z0 + sg.z1) / 2);
  const Fst = new Frame([X, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  let z = sg.z0 - 0.1;
  while (z < sg.z1 - 0.05) {
    const rowD = Math.min(sg.z1 - z, 1.1 + rng.random() * 0.7);
    let s = -hw;
    while (s < hw - 0.05) {
      let Lb = 1.2 + rng.random() * 1.6;
      if (s + Lb > hw - 0.5) Lb = hw - s;
      const col = blockColor(rng, STONE_COL);
      B.aux = [0, 0.35, 0, 0];
      chamferBox(B, Fst, s, Math.min(hw, s + Lb), y - 0.3 + rng.gauss(0, 0.004), y + rng.gauss(0, 0.004), z, z + rowD, 0.02, col, FACES.py | FACES.pz | FACES.nz | FACES.px | FACES.nx, darker(col, 0.9));
      B.aux = [0, 0, 0, 0];
      s += Lb;
    }
    z += rowD;
  }
  // corner pedestals with braziers (front corners) and banners
  const front = sg.z1, back = sg.z0;
  const isQuay = sg.kind === 'quay';
  for (const side of [-1, 1]) {
    const px = X + side * (hw + 0.3);
    const corners = sg.mid ? [[(back + front) / 2, true]] : [[back + 1.0, false], [front - 1.0, true]];
    for (const [pz, isFront] of corners) {
      if (sg.top && !isFront) continue;
      const F = frameFacing(px, 0, pz, side > 0 ? 270 : 90);
      const big = !isQuay;
      // (r5) big piers at the landing fronts (ref 6: ≈ 2.2 m piers with large bronze bowls), statues on the back piers
      const pw = sg.mid ? 1.6 : big ? (isFront ? 2.15 : 1.75) : 1.3, ph = sg.mid ? 2.4 : big ? (isFront ? 3.3 : 2.7) : 1.6;
      const yTop = pedestal(S, 'marble', F, y + 0.02, pw, ph, rng, { faces: ['front', 'back', 'left', 'right'] });
      // (r6) ref 6: a big bronze brazier on the pier at the left frame edge of shot 6 (it carried a statue)
      const s6p = SHOTS.find((s) => s.id === 6);
      const edgeL = !!s6p && side < 0 && sg.mid && Math.hypot(px - s6p.pos[0], pz - s6p.pos[2]) < 10 && pz < s6p.pos[2];
      if (edgeL) slots.brazier.push({ pos: [px, yTop, pz], facing: 90, size: 1.3, tag: 'acro-landing' });
      else if (sg.mid || (big && !isFront && !sg.top)) ctx.slots.statue.push({ pos: [px, yTop, pz], facing: side > 0 ? 235 : 125, size: 2.7 + rng.range(-0.2, 0.3), tag: 'acro-stair' });
      else slots.brazier.push({ pos: [px, yTop, pz], facing: side > 0 ? 270 : 90, size: big ? 1.6 : 1.0, tag: 'acro-landing' });
      ctx.footprints.addCircle(px, pz, 1.3, 'acro-pedestal');
      // banners hang from the big landing pedestals down the inner face (ref 6)
      const s6 = SHOTS.find((s) => s.id === 6);
      const nearEye = s6 && Math.hypot(px - s6.pos[0], pz - s6.pos[2]) < 14; // (r5) no huge cut-off banner beside the shot-6 eye
      if (isFront && !isQuay && !nearEye) slots.banner.push({ pos: [px - side * (pw / 2 + 0.25), yTop - 0.2, pz], facing: side > 0 ? 270 : 90, size: [1.4, Math.min(3.4, ph + 0.4)], tag: 'acro-stair' });
    }
    // lamp posts mid-way along the sides
    if (depth > 4) {
      const F = frameFacing(X + side * (hw - 0.6), 0, (back + front) / 2, 0);
      const flame = lampPost(S, F, y, rng, 3.6);
      slots.lamp.push({ pos: flame, facing: 0, size: 0.35, tag: 'acro-stair' });
    }
  }
  if (isQuay) buildQuay(ctx, sg, X, rng);
  // mosaic rosette centred on the main landings (ref 4)
  if (!sg.mid && !sg.top && !isQuay && depth >= 6) addRosette(ctx, X, y + 0.005, (back + front) / 2, Math.min(depth / 2 - 0.9, hw - 2.2), (sg.level ?? 0) + 1);
  if (sg.top) {
    // top landing: plaza edge with planters & urn slots
    for (const side of [-1, 1]) {
      const F = frameFacing(X + side * (hw - 1.4), 0, back + 2.5, 180);
      slots.urn.push({ pos: [F.o[0], y + 0.02, F.o[2]], facing: 180, size: 1.0, tag: 'acro-stair-top' });
    }
  }
}

function buildQuay(ctx, sg, X, rng) {
  const { S } = ctx;
  const hw = sg.w / 2, y = sg.y0;
  // front steps into the water
  const Fst = new Frame([X, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const B = S.get('tread', X, sg.z1);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const yt = y - (i + 1) * 0.2;
    const z0 = sg.z1 + i * 0.36 - 0.1, z1 = sg.z1 + (i + 1) * 0.36;
    let s = -hw + 2.2;
    while (s < hw - 2.25) {
      const Lb = Math.min(hw - 2.2 - s, 1.5 + rng.random() * 1.8);
      const col = darker(blockColor(rng, STONE_COL), i > 8 ? 0.7 : 1);
      chamferBox(B, Fst, s, s + Lb, yt - 0.35, yt, z0, z1, 0.02, col, FACES.py | FACES.pz | FACES.px | FACES.nx);
      s += Lb;
    }
  }
  // quay front walls beside the steps + bollards
  for (const side of [-1, 1]) {
    const x0 = side > 0 ? X + hw - 2.2 : X - hw, x1 = side > 0 ? X + hw : X - hw + 2.2;
    const F = frameXZ(x0, 0, sg.z1, 1, 0, 0, 1);
    wallRun(S, 'ashlar', F.at(0, 0, 0), x1 - x0, -6, y, { rng, courses: 'iso', courseH: 0.6, batter: 0, damp: 1.0, groundAt: () => -6 });
    // stepped side walls of the water stair
    const Fside = frameXZ(side > 0 ? X + hw - 2.2 : X - hw + 2.2, 0, sg.z1 + n * 0.36, 0, -1, -side, 0);
    void Fside;
    const bol = frameFacing((x0 + x1) / 2, 0, sg.z1 - 0.6, 180);
    const Bb = S.get('marble', bol.o[0], bol.o[2]);
    const c = blockColor(rng, STONE_COL);
    chamferBox(Bb, bol, -0.22, 0.22, y, y + 0.55, -0.22, 0.22, 0.08, c);
    chamferBox(Bb, bol, -0.27, 0.27, y + 0.55, y + 0.68, -0.27, 0.27, 0.05, c);
    // side steps' cheek: masonry block running down beside the steps
    const Fc = frameXZ(side > 0 ? X + hw - 2.2 : X - hw + 2.2, 0, sg.z1, 0, 1, -side, 0);
    const len = n * 0.36;
    wallRun(S, 'ashlar', side > 0 ? Fc : Fc, len, -6, y, {
      rng, courses: 'iso', courseH: 0.6, batter: 0, damp: 1.0, groundAt: () => -6,
      topAt: (s) => y + 0.05 - Math.max(0, s - 0.5) * 0.2 / 0.36 * 0.0,
    });
  }
  // side quay walls (facing east / west) down into the water
  for (const side of [-1, 1]) {
    const xf = X + side * (hw + 1.4);
    const F = side > 0 ? frameXZ(xf, 0, sg.z1, 0, -1, 1, 0) : frameXZ(xf, 0, sg.z0, 0, 1, -1, 0);
    void F;
  }
  // front edge coping
  const Fc = frameXZ(X - hw - 1.4, 0, sg.z1, 1, 0, 0, 1);
  void Fc;
}

// ------------------------------------------------------------------ parapets
function parapet(ctx, sg, X, side, hw, T, rng) {
  const { S } = ctx;
  const len = sg.z1 - sg.z0;
  const xIn = X + side * hw;            // inner face of the cheek wall (stair edge)
  const pT = 0.9;                        // parapet thickness
  const pH = sg.kind === 'quay' ? 0.7 : 1.45;
  // frame along +z with outward = toward the stair axis (inner face of the parapet)
  const Fin = side > 0 ? frameXZ(xIn, 0, sg.z0, 0, 1, -1, 0) : frameXZ(xIn, 0, sg.z1, 0, -1, 1, 0);
  const zAt = (s) => (side > 0 ? sg.z0 + s : sg.z1 - s);
  const y = (s) => lineSurf(sg, zAt(s)) + 0.02;
  const slope = sg.kind === 'flight' ? (side > 0 ? -(sg.y0 - sg.y1) / len : (sg.y0 - sg.y1) / len) : 0;
  // coping band on the outer top edge of the cheek wall (covers clipped blocks)
  const Fout = side > 0 ? frameXZ(xIn + T * side, 0, sg.z1, 0, -1, 1, 0) : frameXZ(xIn + T * side, 0, sg.z0, 0, 1, -1, 0);
  const yo = (s) => lineSurf(sg, side > 0 ? sg.z1 - s : sg.z0 + s);
  const slopeO = sg.kind === 'flight' ? (side > 0 ? (sg.y0 - sg.y1) / len : -(sg.y0 - sg.y1) / len) : 0;
  const Bo = S.get('ashlar', xIn + T * side, (sg.z0 + sg.z1) / 2);
  slopedBox(Bo, Fout, 0, len, yo(0) - 0.55, yo(len) - 0.55, 0, 0.7, -T - 0.05, 0.12, blockColor(rng, STONE_COL));
  slopedBox(Bo, Fout, 0, len, yo(0) - 0.67, yo(len) - 0.67, 0, 0.12, -0.2, 0.06, darker(blockColor(rng, STONE_COL), 0.95));
  // parapet blocks between pedestal positions (pedestals simply overlap them)
  const Bm = S.get('marble', xIn, (sg.z0 + sg.z1) / 2);
  let s = 0;
  let panelIdx = 0;
  while (s < len - 0.05) {
    const Lb = Math.min(len - s, 2.6 + rng.random() * 0.8);
    const c = blockColor(rng, STONE_COL);
    // parapet body: from the inner face (d=0) back to d=-pT
    slopedBox(Bm, Fin, s + 0.006, s + Lb - 0.006, y(s), y(s + Lb), 0, pH, -pT, 0, c);
    // coping on top
    // heavy moulded coping: fillet + projecting slab
    slopedBox(Bm, Fin, s, s + Lb, y(s) + pH, y(s + Lb) + pH, 0, 0.06, -pT - 0.03, 0.04, darker(c, 0.95));
    slopedBox(Bm, Fin, s, s + Lb, y(s) + pH + 0.06, y(s + Lb) + pH + 0.06, 0, 0.16, -pT - 0.1, 0.1, darker(c, 1.02));
    // panel frame + wreath on the inner face (every block that is long enough)
    if (Lb > 2.2 && sg.kind !== 'quay') {
      const sm = s + Lb / 2;
      const ym = (y(s) + y(s + Lb)) / 2 + pH / 2;
      const pw = Lb - 0.5, ph = pH - 0.32;
      slopedFrame(Bm, Fin, sm - pw / 2, sm + pw / 2, y(sm - pw / 2) + 0.16, y(sm + pw / 2) + 0.16, ph, c);
      panelIdx++; wreath(Bm, Fin, sm, ym, Math.min(ph * 0.42, 0.4), rng, c, { relief: 0.07 });
    }
    s += Lb;
  }
  // (r2) ivy hanging over the cheek walls (outer face) and from the parapet (inner face), ref 6
  if (sg.kind !== 'quay') for (let k = 0; k < Math.floor(len / 4.5); k++) {
    if (rng.random() < 0.4) continue;
    const ss = rng.range(0.4, len - 0.4), z = zAt(ss), yy = lineSurf(sg, z);
    const outer = rng.random() < 0.65;
    ctx.slots.ivy.push({ pos: [xIn + side * (outer ? T + 0.15 : -0.05), yy + (outer ? -0.4 : pH), z], facing: outer ? (side > 0 ? 90 : 270) : (side > 0 ? 270 : 90), size: outer ? rng.range(2, 6) : rng.range(0.8, 1.6), width: rng.range(0.8, 2.4), tag: 'acro-stair' });
  }
  void slope; void slopeO;
}

/** sloped (parallelogram) raised frame on the plane of F */
function slopedFrame(B, F, s0, s1, ya, yb, h, col) {
  const bw = 0.075, dd = 0.045;
  slopedBox(B, F, s0, s1, ya, yb, 0, bw, -0.02, dd, col);
  slopedBox(B, F, s0, s1, ya + h - bw, yb + h - bw, 0, bw, -0.02, dd, col);
  chamferBox(B, F, s0, s0 + bw, ya + bw, ya + h - bw, -0.02, dd, 0.01, col, 63 - 32);
  chamferBox(B, F, s1 - bw, s1, yb + bw, yb + h - bw, -0.02, dd, 0.01, col, 63 - 32);
}

// ------------------------------------------------------------------ arched passages
function archedPassages(ctx, sg, X, side, hw, T, rng) {
  // where the ground under the flight is a flat ledge with > 6 m clearance, open a dark arched
  // recess in the cheek wall (reads as a passage under the stair)
  const { S } = ctx;
  const xFace = X + side * (hw + T);
  for (let z = sg.z0 + 4; z < sg.z1 - 4; z += 2) {
    const g = heightAt(xFace + side * 0.6, z);
    const g2 = heightAt(xFace + side * 0.6, z + 4);
    const clear = lineSurf(sg, z + 3) - g;
    if (Math.abs(g - g2) < 0.6 && clear > 7.5) {
      const w = 3.2, h = 4.2;
      const F = side > 0 ? frameXZ(xFace + 0.02, 0, z + 2, 0, -1, 1, 0) : frameXZ(xFace - 0.02, 0, z + 2, 0, 1, -1, 0);
      const Bd = S.get('dark', xFace, z + 2);
      // dark opening (slightly proud of the face so it reads as a deep recess)
      const n = 10;
      const pts = [];
      for (let i = 0; i <= n; i++) { const a = Math.PI * (i / n); pts.push([Math.cos(a) * w / 2, g + h - w / 2 + Math.sin(a) * w / 2]); }
      const yb = g - 0.2;
      for (let i = 0; i < n; i++) {
        Bd.quadOut(F.p(pts[i][0], yb, 0.03), F.p(pts[i + 1][0], yb, 0.03), F.p(pts[i + 1][0], pts[i + 1][1], 0.03), F.p(pts[i][0], pts[i][1], 0.03), [1, 1, 1], F.p(0, g, -1));
      }
      // voussoirs around the arch
      const Ba = S.get('ashlar', xFace, z + 2);
      const nv = 11;
      for (let i = 0; i < nv; i++) {
        const a0 = Math.PI * (i / nv), a1 = Math.PI * ((i + 1) / nv);
        const r0 = w / 2, r1 = w / 2 + 0.55;
        const cy = g + h - w / 2;
        const c = blockColor(rng, STONE_COL);
        const P = (a, r, d) => F.p(Math.cos(a) * r, cy + Math.sin(a) * r, d);
        const ctr = F.p((Math.cos(a0) + Math.cos(a1)) * (r0 + r1) / 4, cy + (Math.sin(a0) + Math.sin(a1)) * (r0 + r1) / 4, -0.2);
        Ba.quadOut(P(a0, r0, 0.09), P(a1, r0, 0.09), P(a1, r1, 0.09), P(a0, r1, 0.09), c, ctr);
        Ba.quadOut(P(a0, r0, 0.09), P(a1, r0, 0.09), P(a1, r0, -0.2), P(a0, r0, -0.2), darker(c, 0.8), F.p(0, cy, -1));
      }
      // jambs
      for (const sx of [-1, 1]) {
        const c = blockColor(rng, STONE_COL);
        chamferBox(Ba, F, sx > 0 ? w / 2 : -w / 2 - 0.5, sx > 0 ? w / 2 + 0.5 : -w / 2, g - 0.2, g + h - w / 2, -0.2, 0.09, 0.03, c, 63 - 32);
      }
      z += 12;
    }
  }
}

/**
 * Step slab swept along s: riser face, worn rounded nosing (radius r, 3 facets), tread top; end caps
 * at the joints. Frame: d = downhill (riser faces +d), y up. ~22 tris.
 */
function stepSlab(B, F, s0, s1, yB, yT, dB, dF, r, col, riserCol, yJ = null) {
  // (r4) yJ: height (slab frame) of the tread below; the riser gets a grimy band just above it
  const band = yJ !== null && yJ + 0.075 < yT - r - 0.02 && yJ + 0.075 > yB;
  const prof = band ? [[dF, yB], [dF, yJ + 0.075], [dF, yT - r]] : [[dF, yB], [dF, yT - r]];
  const nR = band ? 2 : 1; // riser quads
  for (let k = 1; k <= 3; k++) { const t = (k / 3) * (Math.PI / 2); prof.push([dF - r + r * Math.cos(t), yT - r + r * Math.sin(t)]); }
  prof.push([dB + (dF - r - dB) * 0.3, yT]); // (r2) back band of the tread: grime where it meets the next riser
  prof.push([dB, yT]);
  const P = (s, p) => F.p(s, p[1], p[0]);
  for (let i = 0; i < prof.length - 1; i++) {
    const a = prof[i], b = prof[i + 1];
    const last = i === prof.length - 2;
    const c = i < nR ? (band && i === 0 ? darker(riserCol, 0.82) : riserCol) : i < prof.length - 3 ? [col[0] * 1.03, col[1] * 1.03, col[2] * 1.02] : last ? [col[0] * 0.9, col[1] * 0.89, col[2] * 0.87] : col;
    const aux = B.aux;
    if (band && i === 0) B.aux = [0.85, 0, aux[2], aux[3]];
    else if (i >= nR && i < prof.length - 3) B.aux = [aux[0], Math.min(1, aux[1] + 0.3), aux[2], aux[3]];
    else if (last) B.aux = [Math.max(aux[0], 0.42), aux[1] * 0.5, aux[2], aux[3]];
    B.quadOut(P(s0, a), P(s1, a), P(s1, b), P(s0, b), c, F.p((s0 + s1) / 2, yB - 1, dB - 1));
    B.aux = aux;
  }
  // end caps (visible inside the joints)
  const dk = [col[0] * 0.5, col[1] * 0.48, col[2] * 0.45]; // (r2) dark joints between slabs (ref 6)
  for (const [ss, sign] of [[s0, -1], [s1, 1]]) {
    const pts = [F.p(ss, yB, dB), ...prof.map((p) => P(ss, p))];
    // fan from the back-bottom corner, oriented along ±s
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[0], b = pts[i], c = pts[i + 1];
      const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      const dot = n[0] * F.ax[0] * sign + n[1] * F.ax[1] * sign + n[2] * F.ax[2] * sign;
      if (Math.abs(dot) < 1e-12) continue;
      if (dot > 0) B.tri(a, b, c, dk); else B.tri(a, c, b, dk);
    }
  }
}
