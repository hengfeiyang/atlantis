// Plazas: landing bastions on the terraces (paved, with circular mosaic rosettes like ref 4),
// the plateau forecourt at the top of the grand stair, mosaic textures, plaza furniture.
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';
import { chamferBox, frameXZ, frameFacing, Frame, FACES } from './geo.js';
import { wallRun, moulding, PROFILES, blockColor, STONE_COL, buttress, planArch, buildArch } from './masonry.js';
import { solidParapet } from './walls.js';
import { pedestal, lampPost, planter, wreath } from './ornament.js';
import { mosaicMaterial } from './materials.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// ------------------------------------------------------------------ mosaic textures
const _tex = new Map();
/** compass / sun-rose mosaic drawn on a canvas (cached per style) */
export function rosetteTexture(style = 0) {
  if (_tex.has(style)) return _tex.get(style);
  const N = 512;
  if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') return null; // node (bake / tests)
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(N, N) : document.createElement('canvas');
  cv.width = N; cv.height = N;
  const g = cv.getContext('2d');
  const C = N / 2;
  const pal = [
    { bg: '#d9cdb5', a: '#8f3b22', b: '#2f3236', c: '#c49a4a', d: '#5d6b74', e: '#efe6d2' },
    { bg: '#d6cab0', a: '#2b3a52', b: '#9a4a2a', c: '#c9a24e', d: '#3b3b38', e: '#f0e7d4' },
    { bg: '#dcd0ba', a: '#3c3a36', b: '#a65a32', c: '#b8923e', d: '#6e7c6a', e: '#ece2cc' },
  ][style % 3];
  g.fillStyle = pal.bg; g.fillRect(0, 0, N, N);
  const ring = (r0, r1, col) => { g.beginPath(); g.arc(C, C, r1, 0, Math.PI * 2); g.arc(C, C, r0, 0, Math.PI * 2, true); g.fillStyle = col; g.fill(); };
  // outer border: dark band, running-dog (wave) band, thin lines
  ring(C * 0.955, C * 0.995, pal.d);
  ring(C * 0.86, C * 0.955, pal.e);
  g.save(); g.translate(C, C);
  const waves = 36;
  for (let i = 0; i < waves; i++) {
    const a = (i / waves) * Math.PI * 2;
    g.save(); g.rotate(a);
    g.beginPath();
    g.moveTo(C * 0.87, 0);
    g.quadraticCurveTo(C * 0.95, C * 0.02, C * 0.93, C * 0.07);
    g.quadraticCurveTo(C * 0.9, C * 0.1, C * 0.885, C * 0.06);
    g.lineTo(C * 0.87, C * 0.0);
    g.fillStyle = pal.a; g.fill();
    g.restore();
  }
  g.restore();
  ring(C * 0.845, C * 0.86, pal.d);
  ring(C * 0.80, C * 0.845, pal.c);
  ring(C * 0.79, C * 0.80, pal.d);
  // star: 16 long points alternating colours + 16 short
  g.save(); g.translate(C, C);
  const star = (n, rOut, rIn, colA, colB, rot = 0) => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2, da = Math.PI / n;
      for (const half of [0, 1]) {
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * rOut, Math.sin(a) * rOut);
        const b = a + (half ? da : -da);
        g.lineTo(Math.cos(b) * rIn, Math.sin(b) * rIn);
        g.closePath();
        g.fillStyle = half ? colA : colB; g.fill();
      }
    }
  };
  star(16, C * 0.62, C * 0.2, pal.e, pal.c, Math.PI / 16);
  star(8, C * 0.76, C * 0.24, pal.a, darkenHex(pal.a, 0.7));
  star(4, C * 0.78, C * 0.22, pal.b, darkenHex(pal.b, 0.6), Math.PI / 4);
  g.restore();
  // centre medallion
  ring(0, C * 0.17, pal.d);
  ring(C * 0.13, C * 0.15, pal.c);
  g.beginPath(); g.arc(C, C, C * 0.1, 0, Math.PI * 2); g.fillStyle = pal.c; g.fill();
  // small owl-eye dots
  g.fillStyle = pal.e;
  for (const s of [-1, 1]) { g.beginPath(); g.arc(C + s * C * 0.035, C - C * 0.01, C * 0.025, 0, Math.PI * 2); g.fill(); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  _tex.set(style, tex);
  return tex;
}
function darkenHex(h, k) {
  const c = new THREE.Color(h); c.multiplyScalar(k); return '#' + c.getHexString();
}

/** add a rosette disc to the group (mesh per style) */
export function addRosette(ctx, x, y, z, r, style = 0) {
  ctx.rosettes = ctx.rosettes || [];
  ctx.rosettes.push({ x, y, z, r, style });
}
export function rosetteMeshes(ctx) {
  const out = [];
  const byStyle = new Map();
  for (const r of ctx.rosettes || []) { if (!byStyle.has(r.style)) byStyle.set(r.style, []); byStyle.get(r.style).push(r); }
  for (const [style, list] of byStyle) {
    const tex = rosetteTexture(style);
    if (!tex) continue;
    const mat = mosaicMaterial(tex);
    for (const r of list) {
      const g = new THREE.CircleGeometry(r.r, 64).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(r.x, r.y + 0.015, r.z);
      m.rotation.y = (style * 0.7) % (Math.PI / 8);
      m.castShadow = false; m.userData.castShadow = false;
      m.name = 'acro:rosette';
      out.push(m);
      // stone border ring (kerb) around the mosaic
    }
  }
  return out;
}

// ------------------------------------------------------------------ paving helper
/** flat paved polygon (convex quad) at height y: top face with the paving material + edge band */
export function pavedRect(ctx, x0, x1, z0, z1, y, thick = 0.35) {
  const B = ctx.S.get('paving', (x0 + x1) / 2, (z0 + z1) / 2);
  const C = [(x0 + x1) / 2, y - 5, (z0 + z1) / 2];
  B.quadOut([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [1, 1, 1], C);
  const Bs = ctx.S.get('ashlar', (x0 + x1) / 2, (z0 + z1) / 2);
  const c = darker(STONE_COL, 0.95);
  Bs.quadOut([x0, y, z1], [x1, y, z1], [x1, y - thick, z1], [x0, y - thick, z1], c, C);
  Bs.quadOut([x1, y, z0], [x0, y, z0], [x0, y - thick, z0], [x1, y - thick, z0], c, C);
  Bs.quadOut([x0, y, z0], [x0, y, z1], [x0, y - thick, z1], [x0, y - thick, z0], c, C);
  Bs.quadOut([x1, y, z1], [x1, y, z0], [x1, y - thick, z0], [x1, y - thick, z1], c, C);
}

// ------------------------------------------------------------------ landing bastions
/**
 * A projecting terrace platform around a stair landing at the level of a terrace wall:
 * paved top with two mosaic rosettes, retaining walls on west/south/east down to the ground,
 * cornice + balustrade, lamp posts, urns and statue pedestals along the edge.
 *   land: stair landing segment; X: stair axis; zBack: z of the terrace wall face behind it.
 */
export function buildBastion(ctx, land, X, zBack, rng, opts = {}) {
  const { S, slots } = ctx;
  const y = land.y0;
  const halfW = opts.halfW ?? 24;
  const x0 = X - halfW, x1 = X + halfW;
  const z0 = zBack - 3.5, z1 = land.z1 + (opts.front ?? 2.5);
  // top paving; south of the landing the corridor of the departing flight stays open
  const nextF = opts.corridor ? opts.corridor.segs.find((s) => s.kind === 'flight' && Math.abs(s.z0 - land.z1) < 0.05) : null;
  const cw = nextF ? nextF.w / 2 + 1.4 : land.w / 2;
  pavedRect(ctx, x0, X - cw, z0, z1, y + 0.01, 0.5);
  pavedRect(ctx, X + cw, x1, z0, z1, y + 0.01, 0.5);
  pavedRect(ctx, X - cw, X + cw, z0, land.z1, y + 0.01, 0.5);
  // retaining walls: west (outward -x), east (+x), south (+z); the stair zone leaves the gap
  const walls = [
    { F: frameXZ(x0, 0, z1, 0, -1, -1, 0), len: z1 - z0, heading: 270 },      // west face, runs north
    { F: frameXZ(x1, 0, z0, 0, 1, 1, 0), len: z1 - z0, heading: 90 },         // east face, runs south
    { F: frameXZ(x0, 0, z1, 1, 0, 0, 1), len: x1 - x0, heading: 180 },        // south face, runs east
  ];
  const corniceH = 0.75, copeH = 0.3;
  const top = y + 0.01;
  const yMason = top - copeH - corniceH;
  for (const w of walls) {
    const F = w.F;
    // free intervals outside the stair corridor
    const ivs = [];
    let st = null;
    for (let s = 0; s <= w.len + 1e-6; s += 0.4) {
      const p = F.p(Math.min(s, w.len), 0, 0.3);
      const blocked = ctx.zones.hit(p[0], p[2], 0.1, 'stair');
      if (!blocked && st === null) st = s;
      if (blocked && st !== null) { ivs.push([st, s - 0.4]); st = null; }
    }
    if (st !== null) ivs.push([st, w.len]);
    for (const [s0, s1] of ivs) {
      if (s1 - s0 < 0.8) continue;
      const Fs = F.at(s0, 0, 0);
      const L = s1 - s0;
      const groundAt = (s) => { const p = Fs.p(s, 0, 0.6); return heightAt(p[0], p[2]); };
      let gmin = Infinity; for (let s = 0; s <= L; s += 1.5) gmin = Math.min(gmin, groundAt(s));
      const yBot = Math.max(gmin - 1, top - 34);
      const H = yMason - yBot;
      // arcade of blind arches / niches along the foot of the bastion (ref 4, 7)
      const arches = [];
      let gmax = -Infinity; for (let s = 0; s <= L; s += 1.5) gmax = Math.max(gmax, groundAt(s));
      // (r2) faces standing in the lagoon: tall arches with a spout trough and a waterfall each (ref 7)
      const wet = gmax < 0.6 && H > 12 && L > 7;
      if (wet) {
        const nA = Math.max(1, Math.floor((L - 2.4) / 5.0));
        for (let k = 0; k < nA; k++) {
          const sc = ((k + 0.5) * L) / nA;
          const w = Math.min(4.2, L / nA - 2.0);
          arches.push(planArch(sc, -1.8, w, Math.min(H - 6.5, 16.5), 0.62));
          arches[arches.length - 1].spill = true;
        }
      } else if (H > 9 && gmax - gmin < 2.5 && L > 9) {
        const nA = Math.max(1, Math.floor((L - 3) / 9.5));
        for (let k = 0; k < nA; k++) {
          const sc = ((k + 0.5) * L) / nA;
          const w = 3.4 + rng.random() * 0.6;
          let gA = -Infinity; for (let t = -w / 2; t <= w / 2; t += 0.5) gA = Math.max(gA, groundAt(sc + t));
          arches.push(planArch(sc, gA + 0.08, w, Math.min(7, H * 0.4)));
        }
      }
      const tk = 0.94 + 0.1 * rng.random();
      wallRun(S, 'ashlar', Fs, L, yBot, yMason, { color: [tk * 1.02, tk, tk * 0.96], rng, courses: 'pseudo', batter: 0, rustic: true, rusticH: 4, groundAt, lite: true, damp: 0.6,
        cuts: arches.length ? (c0, c1) => arches.map((A) => A.cut(c0, c1)).filter(Boolean) : null });
      for (const A of arches) {
        const r = buildArch(S, 'ashlar', Fs, A, rng, { depth: A.spill ? 2.2 : 1.6 });
        if (A.spill) {
          // spout trough under the keystone, the fall pours out of the arch toward the lagoon
          const Bt = S.get('ashlar', Fs.p(A.sc, 0, 0)[0], Fs.p(A.sc, 0, 0)[2]);
          const yT = A.ys + A.r - 1.05, tw = A.w * 0.34, c = blockColor(rng, STONE_COL);
          Bt.aux = [0.3, 0.5, 0.6, 0];
          chamferBox(Bt, Fs, A.sc - tw, A.sc + tw, yT, yT + 0.32, -2.0, 0.75, 0.04, c);
          chamferBox(Bt, Fs, A.sc - tw - 0.08, A.sc + tw + 0.08, yT + 0.32, yT + 0.46, -2.0, 0.85, 0.03, c);
          Bt.aux = [0, 0, 0, 0];
          (ctx.spills ||= []).push({ pos: Fs.p(A.sc, yT + 0.5, 0.95), dir: w.heading, width: A.w * 0.6, flow: 0.75, id: 'bastion-arch-' + (ctx.spills.length), kind: 'arcade', structure: 'stair-bastion' });
          continue;
        }
        if (rng.random() < 0.4 && A.h > 4.2) slots.statue.push({ pos: r.statuePos, facing: w.heading, size: Math.min(A.h * 0.6, 3.2), tag: 'acro-niche' });
      }
      const setTop = 0;
      moulding(S, 'ashlar', Fs, 0, L, yMason, PROFILES.cornice(corniceH / 0.9), blockColor(rng, STONE_COL), -setTop);
      if (H > 9) moulding(S, 'ashlar', Fs, 0, L, yBot + H * 0.55, PROFILES.string(1.2), blockColor(rng, STONE_COL), 0);
      const Bc = S.get('ashlar', Fs.o[0], Fs.o[2]);
      chamferBox(Bc, Fs, 0, L, top - copeH, top, -1.2, -setTop + corniceH * 0.5 + 0.05, 0.03, blockColor(rng, STONE_COL), 63 - 4);
      // buttresses on tall faces
      if (H > 8 && !arches.length) {
        const nb = Math.floor(L / 11);
        for (let k = 1; k <= nb; k++) buttress(S, 'ashlar', Fs, (L * k) / (nb + 1), 2.4, 1.0, yBot, yMason - 1.2, rng, { groundAt, setoffs: 2 });
      } else if (arches.length > 1) {
        // pilasters between the arches
        for (let k = 0; k < arches.length - 1; k++) buttress(S, 'ashlar', Fs, (arches[k].sc + arches[k + 1].sc) / 2, 1.6, 0.45, yBot, yMason - 0.4, rng, { groundAt, setoffs: 0 });
      }
      // balustrade along the top edge
      ctx.balus.addRun(S, 'marble', Fs.at(0, 0, -0.45 - setTop), 0.3, L - 0.3, top, { broken: 0.01 });
      // banners on the outer faces (visible from the lagoon and the ruins terrace)
      if (H > 6 && L > 8) {
        const nbn = Math.max(1, Math.floor(L / 14));
        for (let k = 0; k < nbn; k++) {
          if (rng.random() < 0.35) continue;
          const s = (L * (k + 0.5)) / nbn;
          slots.banner.push({ pos: Fs.p(s, yMason - 0.2, 0.25), facing: w.heading, size: [3.4, Math.min(11, H * 0.5)], tag: 'acro-bastion' });
        }
      }
      for (let k = 0; k < Math.floor(L / 5); k++) {
        slots.ivy.push({ pos: Fs.p(rng.range(0.5, L - 0.5), top - 0.2, 0.3), facing: w.heading, size: rng.range(2, Math.min(9, H)), width: rng.range(1.2, 4.5), tag: 'acro-bastion' });
      }
    }
  }
  // corner piers
  for (const [cx, cz] of [[x0, z1], [x1, z1]]) {
    const F = frameFacing(cx, 0, cz, 180);
    const g = heightAt(cx, cz + 0.5);
    const B = S.get('ashlar', cx, cz);
    const col = blockColor(rng, STONE_COL);
    let yy = Math.max(g - 1, top - 34);
    while (yy < yMason - 0.1) {
      const h = Math.min(0.75, yMason - yy);
      chamferBox(B, F, -1.4, 1.4, yy, yy + h, -1.4, 1.4, 0.05, blockColor(rng, STONE_COL), FACES.pz | FACES.px | FACES.nx | FACES.nz, darker(col, 0.85));
      yy += h;
    }
  }
  // ---- plaza furniture
  const side = [-1, 1];
  const zc = (z0 + Math.max(z0, land.z0 - 1)) / 2;
  for (const s of side) {
    // mosaic rosette in each wing of the plaza
    const wingC = X + s * (land.w / 2 + 1.6 + (halfW - land.w / 2 - 1.6) / 2);
    const rz = (z0 + z1) / 2;
    const wingHalf = (halfW - land.w / 2 - 1.6) / 2;
    const r = Math.min(wingHalf - 1.5, (z1 - z0) / 2 - 1.5, 4.2);
    if (r > 1.5) {
      addRosette(ctx, wingC, top, rz, r, (opts.style ?? 0) + (s > 0 ? 1 : 0));
      // kerb ring of stone around the rosette
      const B = S.get('marble', wingC, rz);
      const n = 28;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        const P = (a, rr, yy) => [wingC + Math.cos(a) * rr, yy, rz + Math.sin(a) * rr];
        const col = blockColor(rng, STONE_COL);
        B.quadOut(P(a0, r, top + 0.05), P(a1, r, top + 0.05), P(a1, r + 0.35, top + 0.05), P(a0, r + 0.35, top + 0.05), col, [wingC, top - 3, rz]);
        B.quadOut(P(a0, r + 0.35, top + 0.05), P(a1, r + 0.35, top + 0.05), P(a1, r + 0.35, top), P(a0, r + 0.35, top), darker(col, 0.9), [wingC, top, rz]);
      }
      // lamps around the rosette
      for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
        if (rng.random() < 0.3) continue;
        const lx = wingC + Math.cos(a) * (r + 1.4), lz = rz + Math.sin(a) * (r + 1.4);
        if (Math.abs(lx - X) < land.w / 2 + 2) continue;
        const flame = lampPost(S, frameFacing(lx, 0, lz, 0), top, rng, 3.3 + rng.range(-0.2, 0.3));
        slots.lamp.push({ pos: flame, facing: 0, size: 0.35, tag: 'acro-plaza' });
      }
    }
    // statue pedestals along the south balustrade (facing out over the view)
    const nP = 2;
    for (let k = 0; k < nP; k++) {
      const px = X + s * (land.w / 2 + 4 + k * ((halfW - land.w / 2 - 6) / Math.max(1, nP - 1)));
      if (Math.abs(px - X) > halfW - 1.5) continue;
      const pz = z1 - 1.6;
      const F = frameFacing(px, 0, pz, 180);
      const yTop = pedestal(S, 'marble', F, top, 1.3, 1.9 + rng.range(-0.1, 0.2), rng, { faces: ['front', 'back'] });
      slots.statue.push({ pos: [px, yTop, pz], facing: 180 + rng.range(-20, 20), size: 2.5 + rng.range(-0.2, 0.4), tag: 'acro-bastion' });
      ctx.footprints.addCircle(px, pz, 1.2, 'acro-pedestal');
    }
    // urns at the back corners, planters along the back
    slots.urn.push({ pos: [X + s * (halfW - 1.5), top, z0 + 1.5], facing: 180, size: 1.1, tag: 'acro-plaza' });
    const pl = planter(S, frameFacing(X + s * (land.w / 2 + 3.5), 0, z0 + 1.6, 180), top, 2.6, 1.1, 0.7, rng);
    slots.planter.push({ pos: pl, facing: 180, size: [2.4, 0.9], tag: 'acro-plaza' });
  }
  ctx.footprints.addRect(X, (z0 + z1) / 2, halfW, (z1 - z0) / 2, 0, 'acro-plaza');
  void zc;
  return { x0, x1, z0, z1, top };
}

/** plateau forecourt at the top of the grand stair (paved, rosette, lamps); returns its rect */
export function buildForecourt(ctx, land, X, rng) {
  const { S, slots } = ctx;
  const y = land.y0;
  const x0 = X - 18, x1 = X + 18, z0 = land.z0 - 16, z1 = land.z1;
  // paving follows the plateau ground: sample and raise to the landing level where the ground is lower
  pavedRect(ctx, x0, x1, z0, z1, y + 0.01, 1.2);
  addRosette(ctx, X, y + 0.01, z0 + 9, 5.5, 2);
  for (const sx of [-1, 1]) for (const zz of [z0 + 3, z0 + 15]) {
    const flame = lampPost(S, frameFacing(X + sx * 9, 0, zz, 0), y, rng, 3.6);
    slots.lamp.push({ pos: flame, facing: 0, size: 0.35, tag: 'acro-forecourt' });
  }
  ctx.footprints.addRect(X, (z0 + z1) / 2, 18, (z1 - z0) / 2, 0, 'acro-plaza');
  return { x0, x1, z0, z1, top: y };
}
