// Reusable architectural elements: moulded pedestals (with laurel wreath reliefs), balustrades
// with vase balusters, stoa (colonnaded hall), propylon (gateway).
import * as THREE from 'three';
import { MeshBuilder, box, lathe, sweep, rectPath, surface, lerp, hash3, extrudeOutline } from './geom.js';
import { Building } from './build.js';
import { columnGeometry, columnInfo, seg } from './orders.js';
import { Run, doricRun, ionicRun, pediment, tiledRoof } from './entablature.js';
import { crepidoma, columnAxes, prostyleTemple } from './temple.js';
import { wreath, rosette } from './ornament.js';

const PI = Math.PI;

// --------------------------------------------------------------------------- pedestal
/**
 * Moulded pedestal written into a builder at its current transform. Base at y = 0, front = +Z.
 * o: { w, d, h, wreath (front relief), wreathBack, panel (recessed panel), plinth (true), cap (true), detail }
 * Returns the height of the top surface.
 */
export function pedestal(mb, o = {}) {
  const w = o.w ?? 1.4, d = o.d ?? w, h = o.h ?? 1.6;
  const m = Math.min(w, d);
  const pl = o.plinth === false ? 0 : Math.min(0.25, h * 0.1);
  const ext = m * 0.09;
  if (pl > 0) box(mb, [-w / 2 - ext, 0, -d / 2 - ext], [w / 2 + ext, pl, d / 2 + ext], 0.02, [0.15, 0.8, 0.1, 0]);
  // base moulding (torus + cavetto)
  const bh = h * 0.1;
  const baseProf = [[ext * 0.9, 0, 0.3, 0, true], [ext, bh * 0.25, 0.05, 0.4], [ext * 0.75, bh * 0.5, 0.2, 0], [ext * 0.35, bh * 0.62, 0.4, 0, true], [ext * 0.2, bh * 0.8, 0.5, 0], [0.005, bh, 0.3, 0, true]];
  mb.push(); mb.translate(0, pl, 0);
  sweep(mb, baseProf, rectPath(w, d), 0, { closed: true, outward: 1, streak: 0.2 });
  mb.pop();
  // die
  const yd0 = pl + bh, ch = h * 0.16, yd1 = h - ch;
  box(mb, [-w / 2, yd0, -d / 2], [w / 2, yd1, d / 2], 0.012, [0.05, 0, 0.6, 0]);
  // cornice: cyma reversa + corona + fillet
  const cp = [[0.005, 0, 0.4, 0, true], [ext * 0.25, ch * 0.18, 0.3, 0], [ext * 0.55, ch * 0.32, 0.1, 0], [ext * 0.65, ch * 0.42, 0.3, 0, true], [ext * 1.05, ch * 0.5, 0.2, 0.3, true], [ext * 1.08, ch * 0.88, 0.05, 0.7, true], [ext * 0.95, ch, 0.05, 0.6, true], [-m * 0.45, ch, 0, 0]];
  mb.push(); mb.translate(0, yd1, 0);
  sweep(mb, cp, rectPath(w, d), 0, { closed: true, outward: 1, streak: 0.4 });
  mb.pop();
  // top slab (fill)
  box(mb, [-w / 2 - ext * 0.95 + 0.01, h - 0.012, -d / 2 - ext * 0.95 + 0.01], [w / 2 + ext * 0.95 - 0.01, h, d / 2 + ext * 0.95 - 0.01], 0, [0.1, 0, 0.2, 0]);
  // reliefs
  const R = Math.min(w, yd1 - yd0) * 0.3;
  if (o.panel) box(mb, [-w * 0.36, yd0 + (yd1 - yd0) * 0.12, d / 2 - 0.004], [w * 0.36, yd1 - (yd1 - yd0) * 0.12, d / 2 + 0.012], 0.006, [0.3, 0.4, 0.3, 0]);
  if (o.wreath !== false) {
    for (const side of o.wreathBack ? [1, -1] : [1]) {
      mb.push(); mb.translate(0, (yd0 + yd1) / 2, side * (d / 2 + 0.005)); if (side < 0) mb.rotateY(PI);
      wreath(mb, R, { leaves: (o.detail ?? 1) > 0.5 ? 22 : 14 });
      mb.pop();
    }
  }
  return h;
}

/** pedestal as standalone geometry (cached by options) */
const _pedCache = new Map();
export function pedestalGeometry(o = {}) {
  const k = JSON.stringify(o);
  if (!_pedCache.has(k)) { const mb = new MeshBuilder(); pedestal(mb, o); _pedCache.set(k, mb.geometry()); }
  return _pedCache.get(k);
}

// --------------------------------------------------------------------------- balustrade
const _balCache = new Map();
function balusterTemplate(h, detail) {
  const k = `${h.toFixed(3)}:${detail > 0.5}`;
  if (_balCache.has(k)) return _balCache.get(k);
  const mb = new MeshBuilder();
  const r = h * 0.11;
  const prof = [[r * 1.15, 0, 0.3, 0, true], [r * 1.15, h * 0.06, 0.1, 0.5, true], [r * 0.9, h * 0.08, 0.3, 0, true]];
  const n = detail > 0.5 ? 12 : 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const yy = lerp(h * 0.08, h * 0.88, t);
    // double vase: belly at 0.3, neck at 0.62, small belly at 0.78
    const rr = r * (0.55 + 0.55 * Math.exp(-(((t - 0.3) / 0.2) ** 2)) - 0.12 * Math.exp(-(((t - 0.62) / 0.06) ** 2)) + 0.18 * Math.exp(-(((t - 0.8) / 0.08) ** 2)));
    prof.push([rr, yy, 0.05 + 0.3 * Math.exp(-(((t - 0.62) / 0.06) ** 2)), 0]);
  }
  prof.push([r * 0.9, h * 0.9, 0.3, 0, true], [r * 1.12, h * 0.92, 0.1, 0.5, true], [r * 1.12, h, 0.2, 0, true]);
  lathe(mb, prof, detail > 0.5 ? 12 : 8, { streak: 0.3 });
  const g = mb.geometry();
  _balCache.set(k, g);
  return g;
}

/**
 * Balustrade along +X from x = 0 to x = length, centred on z = 0, base at y = 0.
 * o: { length, height (1.0), spacing (0.32), postEvery (3.0 m), depth (0.34), detail, endPosts (true) }
 */
export function balustrade(mb, o = {}) {
  const L = o.length ?? 6, H = o.height ?? 1.0, dep = o.depth ?? 0.34, sp = o.spacing ?? 0.3;
  const detail = o.detail ?? 1;
  const baseH = H * 0.16, railH = H * 0.13;
  box(mb, [0, 0, -dep / 2], [L, baseH, dep / 2], 0.015, [0.15, 0.6, 0.2, 0]);
  box(mb, [-0.02, H - railH, -dep / 2 - 0.03], [L + 0.02, H, dep / 2 + 0.03], 0.02, [0.05, 0.8, 0.5, 0]);
  box(mb, [0, H - railH - 0.03, -dep / 2 + 0.02], [L, H - railH, dep / 2 - 0.02], 0.008, [0.3, 0.2, 0.2, 0]);
  const postW = dep * 1.15;
  const posts = [];
  const pe = o.postEvery ?? 3.0;
  const nSeg = Math.max(1, Math.round(L / pe));
  for (let i = 0; i <= nSeg; i++) { if ((i === 0 || i === nSeg) && o.endPosts === false) continue; posts.push((L * i) / nSeg); }
  for (const x of posts) {
    box(mb, [x - postW / 2, 0, -postW / 2], [x + postW / 2, H + 0.06, postW / 2], 0.02, [0.1, 0.7, 0.4, 0]);
    box(mb, [x - postW / 2 - 0.03, H + 0.06, -postW / 2 - 0.03], [x + postW / 2 + 0.03, H + 0.12, postW / 2 + 0.03], 0.015, [0.05, 0.8, 0.3, 0]);
  }
  const bal = balusterTemplate(H - baseH - railH - 0.03, detail);
  const m = new THREE.Matrix4();
  for (let s = 0; s < nSeg; s++) {
    const x0 = (L * s) / nSeg + postW / 2 + 0.05, x1 = (L * (s + 1)) / nSeg - postW / 2 - 0.05;
    const n = Math.max(1, Math.floor((x1 - x0) / sp));
    for (let i = 0; i <= n; i++) {
      const x = lerp(x0, x1, n ? i / n : 0.5);
      m.makeTranslation(x, baseH, 0);
      mb.merge(bal, m);
    }
  }
}

const _balGeoCache = new Map();
export function balustradeGeometry(o = {}) {
  const k = JSON.stringify(o);
  if (!_balGeoCache.has(k)) { const mb = new MeshBuilder(); balustrade(mb, o); _balGeoCache.set(k, mb.geometry()); }
  return _balGeoCache.get(k);
}

// --------------------------------------------------------------------------- stoa
/**
 * Stoa: long Doric colonnade in front of a walled hall, gable roof with pediments at the ends.
 * Front = +Z (colonnade), long axis along X.
 * o: { length (40), depth (10), colH (6.2), columns (auto), order ('doric'), inner ('ionic'|null), steps (2),
 *      gild, detail, seed, name, banners }
 */
export function stoa(o = {}) {
  const t0 = performance.now();
  const B = new Building(o.name || 'stoa', { detail: o.detail ?? 1, seed: o.seed ?? 5, variant: o.variant, tint: o.tint, overrides: o.overrides, roofTint: o.roofTint, interiorDark: o.interiorDark });
  const detail = B.detail, seed = o.seed ?? 5;
  const Ls = o.length ?? 40, Ds = o.depth ?? 10;
  const colH = o.colH ?? 6.2, order = o.order || 'doric';
  const ci = columnInfo({ order, height: colH });
  const D = ci.D;
  const steps = o.steps ?? 2;
  crepidoma(B, Ls, Ds, { steps, stepH: 0.34, tread: 0.45, seed, detail, foundation: o.foundation ?? 3, arcade: o.arcade });
  const e = 0.6 * D;
  const ax = Ls / 2 - e, az = Ds / 2 - e;
  const n = o.columns ?? Math.max(4, Math.round((2 * ax) / (2.3 * D)) + 1);
  const xs = columnAxes(2 * ax, n, order === 'doric' ? 0.9 : 1);
  const colGeo = columnGeometry({ order, height: colH, diameter: D, detail: detail * 0.8 });
  const m4 = new THREE.Matrix4();
  xs.forEach((x, i) => {
    m4.compose(new THREE.Vector3(x, 0, az), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.floor(hash3(seed, i, 2) * 4) * (PI / 2), 0)), new THREE.Vector3(1, 1, 1));
    B.addInstance('columns', colGeo.geometry, m4); B.occCyl(x, az, D / 2, 0, colH);
  });
  // inner colonnade (Ionic, taller, fewer)
  if (o.inner) {
    const ih = colH + 0.6 * D, iGeo = columnGeometry({ order: o.inner, height: ih, detail: detail * 0.6 });
    const ixs = columnAxes(2 * ax - 2 * D, Math.max(3, Math.round(n / 2)), 1);
    ixs.forEach((x) => { m4.makeTranslation(x, 0, 0); B.addInstance('inner', iGeo.geometry, m4); B.occCyl(x, 0, D / 2, 0, ih); });
  }
  // walls: back + ends (ashlar)
  const t = 0.6, wallH = colH + 0.72 * D * 2;
  const aux = [0.05, 0, 0.5, 3.05];
  box(B.marble, [-ax - e * 0.5, 0, -az - t * 0.5], [ax + e * 0.5, wallH, -az + t * 0.5], 0.02, aux);
  // (r5) the inner face of the back wall sits in the colonnade's shade: dark skin so the colonnade reads from afar
  if (o.darkInner !== false) box(B.mb.interior, [-ax + 0.3, 0, -az + t * 0.5], [ax - 0.3, colH + 1.2 * D, -az + t * 0.5 + 0.004], 0, [0.4, 0, 0, 3.05]);
  for (const s of [-1, 1]) box(B.marble, [s < 0 ? -ax - t * 0.5 : ax - t * 0.5, 0, -az], [s < 0 ? -ax + t * 0.5 : ax + t * 0.5, wallH, az - D * 1.2], 0.02, aux);
  B.occBox([-ax - e, 0, -az - t], [ax + e, wallH, -az + t]);
  for (const s of [-1, 1]) B.occBox([s * ax - t, 0, -az], [s * ax + t, wallH, az - D * 1.2]);
  // doors in the back wall (dark openings) — simple recessed panels
  for (let i = 0; i < 3; i++) {
    const x = lerp(-ax * 0.6, ax * 0.6, i / 2);
    box(B.mb.interior, [x - 1.1, 0, -az + t * 0.5 - 0.02], [x + 1.1, colH * 0.62, -az + t * 0.5 + 0.005], 0, [0.9, 0, 0, 0]);
    box(B.marble, [x - 1.35, colH * 0.62, -az + t * 0.5], [x + 1.35, colH * 0.62 + 0.4, -az + t * 0.5 + 0.12], 0.02, [0.1, 0.4, 0.3, 0]);
  }
  // entablature: front (flank, colonnade), right end (owner, pediment), back (flank), left end (owner)
  const fA = ci.abacus * 0.5 * 0.97, dA = Math.max(0.9 * D, ci.abacus * 0.9), tw = 0.44 * D;
  const even = (len) => { const a = []; const k = Math.max(1, Math.round(len / (2.3 * D))); for (let i = 0; i <= k; i++) a.push((len * i) / k); return a; };
  const runs = [
    { run: new Run([-ax, az], [ax, az]), axes: xs.map((x) => x + ax), owner: false, id: 'front' },
    { run: new Run([ax, az], [ax, -az]), axes: even(2 * az), owner: true, id: 'right' },
    { run: new Run([ax, -az], [-ax, -az]), axes: even(2 * ax), owner: false, id: 'back' },
    { run: new Run([-ax, -az], [-ax, az]), axes: even(2 * az), owner: true, id: 'left' },
  ];
  let yTop = 0;
  const trigC = (axes) => { const tt = [axes[0] - fA + tw / 2]; for (let i = 0; i < axes.length - 1; i++) { if (i > 0) tt.push(axes[i]); tt.push((axes[i] + axes[i + 1]) / 2); } tt.push(axes[axes.length - 1] + fA - tw / 2); return tt; };
  for (const R of runs) {
    const res = doricRun(B, R.run, { y0: colH, D, fA, dA, hA: 0.72 * D, hF: 0.72 * D, hG: 0.38 * D, tw, triglyphs: trigC(R.axes), axes: R.axes, owner: R.owner, detail, seed, plaques: !!o.plaques, gild: o.gild ?? 0 });
    yTop = res.yTop;
  }
  const ov = 0.42 * D;
  B.occBox([-ax - fA - ov, colH, -az - fA - ov], [ax + fA + ov, yTop, az + fA + ov]);
  const pitch = ((o.pitch ?? 14) * PI) / 180, hR = 0.32 * D;
  for (const R of [runs[1], runs[3]]) pediment(B, R.run, { yBase: yTop, fA, ov, D, pitch, hR, simaH: 0.24 * D, acroteria: o.acroteria ?? 'palmette', corners: o.corners ?? 'palmette', detail, gild: o.gild ?? 0, acroScale: 0.9, rakingAntefixes: detail > 0.45 });
  const half = az + fA + ov;
  const yEaves = yTop + hR / Math.cos(pitch);
  for (const s of [-1, 1]) box(B.marble, [-ax - fA - ov, yTop, s < 0 ? -half : half - 0.35 * D], [ax + fA + ov, yEaves, s < 0 ? -half + 0.35 * D : half], 0.01 * D, [0.05, 0.3, 0.6, 0]);
  // roof (ridge along X): rotate the roof builder frame
  for (const mbx of [B.marble, B.gold]) { mbx.push(); mbx.rotateY(PI / 2); }
  const roof = tiledRoof(B, { xo: half, z0: -ax - fA - ov + 0.1 * D, z1: ax + fA + ov - 0.1 * D, yEaves, pitch, antefixes: detail > 0.3, gild: o.gild ?? 0, antefixH: 0.3 });
  for (const mbx of [B.marble, B.gold]) mbx.pop();
  B.occFn([-ax - fA - ov, yTop, -half], [ax + fA + ov, roof.yRidge, half], (x, y, z) => y < yEaves + (half - Math.abs(z)) * Math.tan(pitch));
  // ceiling
  box(B.mb.interior, [-ax, colH + 1.2 * D, -az], [ax, colH + 1.2 * D + 0.3, az], 0, [0.4, 0, 0, 0]);
  B.occBox([-ax, colH + 1.2 * D, -az], [ax, colH + 1.5 * D, az]);
  if (o.banners !== false) for (let i = 1; i < xs.length - 1; i += 2) B.info.banners.push({ pos: [(xs[i] + xs[i + 1 < xs.length ? i + 1 : i]) / 2, colH - 0.1, az], dir: [0, 0, 1], width: 1.4, height: colH * 0.55, size: colH * 0.55, tag: 'stoa', anchor: 'top-centre', priority: 3 });
  B.info.anchors = { Ls, Ds, colH, yTop, yRidge: roof.yRidge };
  B.info.footprint = { hw: Ls / 2 + steps * 0.45 + 0.3, hd: Ds / 2 + steps * 0.45 + 0.3 };
  B.genMs = Math.round(performance.now() - t0);
  return B;
}

/** Propylon: monumental amphiprostyle gateway (hexastyle Doric) with a wide central passage. */
export function propylon(o = {}) {
  return prostyleTemple({ order: 'doric', porch: o.columns ?? 6, colH: o.colH ?? 7.5, amphi: true, name: o.name || 'propylon', L: o.depth, W: o.width, doorW: o.passage ?? 4.2, flankStatues: false, banners: true, pitch: 14, gild: o.gild ?? 0.6, acroteria: 'palmette', corners: 'palmette', ...o });
}

/**
 * Gate tower / water pavilion (refs 2, 7): square two-storey tower on a battered plinth — ashlar lower
 * storey with an arched passage along Z (archivolt + keystone), string course, open Ionic loggia above
 * a dark core, entablature with a gilded fillet + rosettes, cornice and a balustraded roof terrace with
 * brazier slots on the corner posts. Base (top of the plinth course) at y = 0, front = +Z.
 * o: { w (7), d (w), h (12, top of the cornice), foundation (4), arch (true), archW, loggia (true), gild, detail, seed, name, banner }
 */
export function gateTower(o = {}) {
  const t0 = performance.now();
  const B = new Building(o.name || 'gate-tower', { detail: o.detail ?? 1, seed: o.seed ?? 7, variant: o.variant ?? 'weathered', tint: o.tint, overrides: o.overrides });
  const detail = B.detail, mb = B.marble, mg = B.gold, mi = B.mb.interior;
  const w = o.w ?? 7, d = o.d ?? w, h = o.h ?? 12;
  const hw = w / 2, hd = d / 2, t = Math.min(1.0, w * 0.13);
  const ash = (ch) => [0.05, 0.1, 0.6, 3 + ch / 10];
  const F = o.foundation ?? 4;
  // ---- battered plinth (down into the rock / water) + base moulding
  box(mb, [-hw - 0.55, -F, -hd - 0.55], [hw + 0.55, -0.45, hd + 0.55], 0.04, ash(0.62));
  box(mb, [-hw - 0.4, -0.45, -hd - 0.4], [hw + 0.4, 0.0, hd + 0.4], 0.05, [0.1, 0.8, 0.3, 0]);
  B.occBox([-hw - 0.55, -F, -hd - 0.55], [hw + 0.55, 0, hd + 0.55]);
  // ---- lower storey with an arched passage (front + back walls) and solid flanks
  const h1 = h * 0.5;
  const aw = o.archW ?? Math.min(3.4, w * 0.46), ar = aw / 2, ya = Math.max(1.8, h1 * 0.5);
  const arcN = Math.max(8, Math.round(16 * detail));
  const wallOutline = () => {
    const pts = [[-hw, 0], [-ar, 0], [-ar, ya]];
    for (let i = 1; i < arcN; i++) { const a = PI - (i / arcN) * PI; pts.push([Math.cos(a) * ar, ya + Math.sin(a) * ar]); }
    pts.push([ar, ya], [ar, 0], [hw, 0], [hw, h1], [-hw, h1]);
    return pts;
  };
  if (o.arch !== false) {
    for (const s of [1, -1]) {
      mb.push(); if (s < 0) mb.rotateY(PI); mb.translate(0, 0, hd - t);
      extrudeOutline(mb, wallOutline(), t, { aux: ash(0.62), auxSide: [0.3, 0.4, 0.2, 0] });
      // archivolt ring + keystone + imposts
      const ring = [];
      for (let i = 0; i <= arcN; i++) { const a = PI - (i / arcN) * PI; ring.push([Math.cos(a) * (ar + 0.42), ya + Math.sin(a) * (ar + 0.42)]); }
      for (let i = arcN; i >= 0; i--) { const a = PI - (i / arcN) * PI; ring.push([Math.cos(a) * ar, ya + Math.sin(a) * ar]); }
      mb.push(); mb.translate(0, 0, t); extrudeOutline(mb, ring, 0.09, { aux: [0.1, 0.5, 0.3, 0], auxSide: [0.2, 0.7, 0.2, 0], back: false }); mb.pop();
      box(mb, [-0.32, ya + ar - 0.1, t - 0.02], [0.32, ya + ar + 0.62, t + 0.16], 0.02, [0.1, 0.6, 0.3, 0]);
      for (const k of [-1, 1]) box(mb, [k < 0 ? -ar - 0.3 : ar, ya - 0.28, -0.02], [k < 0 ? -ar : ar + 0.3, ya, t + 0.1], 0.02, [0.1, 0.6, 0.3, 0]);
      mb.pop();
    }
  } else {
    for (const s of [-1, 1]) box(mb, [-hw, 0, s > 0 ? hd - t : -hd], [hw, h1, s > 0 ? hd : -hd + t], 0.02, ash(0.62));
  }
  for (const s of [-1, 1]) box(mb, [s < 0 ? -hw : hw - t, 0, -hd + t], [s < 0 ? -hw + t : hw, h1, hd - t], 0.02, ash(0.62));
  // interior: dark floor, ceiling and inner wall skins
  box(mi, [-hw + t, 0.0, -hd + t], [hw - t, 0.02, hd - t], 0, [0.6, 0, 0, 0]);
  box(mi, [-hw + t, h1 - 0.3, -hd + t], [hw - t, h1 - 0.28, hd - t], 0, [0.6, 0, 0, 0]);
  for (const s of [-1, 1]) box(mi, [s < 0 ? -hw + t : hw - t - 0.02, 0, -hd + t], [s < 0 ? -hw + t + 0.02 : hw - t, h1 - 0.28, hd - t], 0, [0.6, 0, 0, 0]);
  B.occBox([-hw, 0, hd - t], [hw, h1, hd]); B.occBox([-hw, 0, -hd], [hw, h1, -hd + t]);
  B.occBox([-hw, 0, -hd], [-hw + t, h1, hd]); B.occBox([hw - t, 0, -hd], [hw, h1, hd]);
  // rusticated quoins at the corners (vertical bands of half-height courses)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(mb, [sx > 0 ? hw - 0.7 : -hw - 0.05, 0, sz > 0 ? hd - 0.7 : -hd - 0.05], [sx > 0 ? hw + 0.05 : -hw + 0.7, h1, sz > 0 ? hd + 0.05 : -hd + 0.7], 0.03, ash(0.31));
  }
  // string course
  box(mb, [-hw - 0.22, h1, -hd - 0.22], [hw + 0.22, h1 + 0.38, hd + 0.22], 0.04, [0.1, 0.7, 0.5, 0]);
  if ((o.gild ?? 0.5) > 0) box(mg, [-hw - 0.235, h1 + 0.2, -hd - 0.235], [hw + 0.235, h1 + 0.26, hd + 0.235], 0, [0.2, 0.3, 0, 0]);
  // ---- upper storey: open loggia (2 Ionic columns per face between corner piers) around a dark core
  const yU = h1 + 0.38, eH = Math.max(0.9, h * 0.075), yE = h - 0.45 - eH;
  const pierW = Math.max(0.9, w * 0.14);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const mn = [sx < 0 ? -hw : hw - pierW, yU, sz < 0 ? -hd : hd - pierW], mx = [sx < 0 ? -hw + pierW : hw, yE, sz < 0 ? -hd + pierW : hd];
    box(mb, mn, mx, 0.03, ash(0.5));
    B.occBox(mn, mx);
  }
  const core = Math.max(1.2, Math.min(hw, hd) - 1.7);
  box(mi, [-core, yU, -core], [core, yE, core], 0, [0.5, 0, 0, 0]);
  B.occBox([-core, yU, -core], [core, yE, core]);
  if (o.loggia !== false) {
    const colH = yE - yU;
    const cg = columnGeometry({ order: 'ionic', height: colH, diameter: Math.min(0.62, colH / 9), detail: detail * 0.6 });
    const m4 = new THREE.Matrix4();
    const inset = 0.42;
    for (const [fx, fz, len] of [[0, hd - inset, w], [0, -hd + inset, w], [hw - inset, 0, d], [-hw + inset, 0, d]]) {
      const span = len - 2 * pierW;
      for (const k of [-1, 1]) {
        const off = (k * span) / 6;
        const x = fz !== 0 ? off : fx, z = fz !== 0 ? fz : off;
        m4.makeTranslation(x, yU, z); B.addInstance('loggia', cg.geometry, m4);
        B.occCyl(x, z, 0.3, yU, yE);
      }
    }
  }
  box(mi, [-hw + 0.3, yE - 0.25, -hd + 0.3], [hw - 0.3, yE - 0.23, hd - 0.3], 0, [0.5, 0, 0, 0]);
  // ---- entablature band (architrave + frieze) + cornice
  box(mb, [-hw - 0.05, yE, -hd - 0.05], [hw + 0.05, yE + eH * 0.45, hd + 0.05], 0.02, [0.08, 0.3, 0.6, 0]);
  box(mb, [-hw, yE + eH * 0.45, -hd], [hw, yE + eH, hd], 0.02, [0.15, 0.2, 0.6, 0]);
  if ((o.gild ?? 0.5) > 0) {
    box(mg, [-hw - 0.065, yE + eH * 0.43, -hd - 0.065], [hw + 0.065, yE + eH * 0.47, hd + 0.065], 0, [0.2, 0.3, 0, 0]);
    for (const [rx, rz, ry] of [[0, hd, 0], [0, -hd, PI], [hw, 0, PI / 2], [-hw, 0, -PI / 2]]) {
      for (const k of [-1, 0, 1]) {
        mg.push(); mg.translate(rx, yE + eH * 0.73, rz); mg.rotateY(ry); mg.translate(k * (Math.min(w, d) * 0.3), 0, 0.005);
        rosette(mg, eH * 0.19, 8, { detail: 'low' }); mg.pop();
      }
    }
  }
  box(mb, [-hw - 0.2, yE + eH - 0.12, -hd - 0.2], [hw + 0.2, yE + eH, hd + 0.2], 0.02, [0.3, 0.3, 0.3, 0]);
  box(mb, [-hw - 0.45, yE + eH, -hd - 0.45], [hw + 0.45, h, hd + 0.45], 0.04, [0.05, 0.9, 0.8, 0]);
  B.occBox([-hw - 0.45, yE, -hd - 0.45], [hw + 0.45, h, hd + 0.45]);
  // ---- roof terrace: paving + balustrade + corner posts (brazier slots)
  box(mb, [-hw - 0.3, h, -hd - 0.3], [hw + 0.3, h + 0.08, hd + 0.3], 0, [0.1, 0.4, 0, 5.08]);
  const bh = 1.0;
  for (const [x0, z0, ang, len] of [[-hw, hd, 0, w], [hw, -hd, PI, w], [hw, hd, PI / 2, d], [-hw, -hd, -PI / 2, d]]) {
    mb.push(); mb.translate(x0, h + 0.08, z0); mb.rotateY(ang); mb.translate(0.5, 0, -0.2);
    balustrade(mb, { length: len - 1.0, height: bh, spacing: 0.3, postEvery: len, endPosts: false, detail });
    mb.pop();
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * (hw - 0.05), cz = sz * (hd - 0.05);
    box(mb, [cx - 0.4, h + 0.08, cz - 0.4], [cx + 0.4, h + bh + 0.35, cz + 0.4], 0.03, [0.1, 0.7, 0.3, 0]);
    B.info.braziers.push({ pos: [cx, h + bh + 0.35, cz], dir: [sx * 0.7, 0, sz * 0.7], size: 0.75, tag: 'gate-tower', needsStand: false });
  }
  // banners on the solid flanks of the lower storey
  if (o.banner !== false) for (const s of [-1, 1]) {
    const bH = Math.min(4.6, h1 * 0.66);
    B.info.banners.push({ pos: [s * (hw + 0.06), h1 - 0.15, 0], dir: [s, 0, 0], width: Math.min(2.0, d * 0.3), height: bH, size: bH, tag: 'gate-tower', anchor: 'top-centre', priority: 2 });
  }
  B.info.anchors = { w, d, h, h1, yTerrace: h + 0.08 };
  B.info.footprint = { hw: hw + 0.6, hd: hd + 0.6 };
  B.genMs = Math.round(performance.now() - t0);
  return B;
}
