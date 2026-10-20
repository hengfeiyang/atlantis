// Temple generators: Doric/Ionic peripteral temple (Parthenon-type), prostyle / amphiprostyle
// small temples. Building-local frame: origin at the centre of the stylobate top, front = +Z,
// width along X, length along Z. Returns a Building (call .finalize({position, rotY}) to place it).
import * as THREE from 'three';
import { Building } from './build.js';
import { box, boxC, lathe, sweep, rectPath, extrudeOutline, surface, ellipsoid, lerp, clamp, hash3 } from './geom.js';
import { columnGeometry, columnInfo, ORDER_DEFAULTS } from './orders.js';
import { Run, doricRun, ionicRun, pediment, tiledRoof } from './entablature.js';
import { wreath, rosette, shield } from './ornament.js';
import { balustrade } from './elements.js';

const PI = Math.PI;

/** axis positions for n columns over `span` (first to last axis) with Doric corner contraction k */
export function columnAxes(span, n, k = 1) {
  if (n < 2) return [0];
  if (n === 2) return [-span / 2, span / 2];
  const s = span / (2 * k + (n - 3));
  const c = k * s;
  const out = [-span / 2];
  let x = -span / 2 + c;
  for (let i = 1; i < n - 1; i++) { out.push(x); x += s; }
  out.push(span / 2);
  return out;
}

/** Doric triglyph centres along a run (s coords) from its column axes */
function triglyphCentres(axes, fA, tw) {
  const t = [axes[0] - fA + tw / 2];
  for (let i = 0; i < axes.length - 1; i++) {
    if (i > 0) t.push(axes[i]);
    t.push((axes[i] + axes[i + 1]) / 2);
  }
  t.push(axes[axes.length - 1] + fA - tw / 2);
  return t;
}

/**
 * (r5) Arcaded substructure facade (refs 1, 3, 9: sanctuaries stand on terraces whose walls are pierced
 * by dark arches — the bright-pier / dark-arch rhythm is what reads from 500–1000 m). Writes a facade in
 * the XY plane facing +Z: piers with pilaster strips, arched openings with archivolts + keystones and a
 * dark recess behind, sill, cornice band. The facade occupies z ∈ [z - depth, z].
 * o: { x0, x1, y0 (bottom, local), y1 (top of the cornice), z, depth (1.3), bay (4.2), open (0.6), detail }
 */
export function arcadeFacade(B, o) {
  const mb = B.marble, mi = B.mb.interior;
  const { x0, x1, y0, y1 } = o;
  const z = o.z ?? 0, t = o.depth ?? 2.2, detail = o.detail ?? 1;
  const W = x1 - x0, H = y1 - y0;
  if (W < 3 || H < 2.5) { box(mb, [x0, y0, z - t], [x1, y1, z], 0.03, [0.1, 0.2, 0.6, 3.062]); return; }
  const band = Math.min(1.1, Math.max(0.5, H * 0.1));
  const sill = Math.min(0.9, H * 0.08);
  const n = Math.max(1, Math.round(W / (o.bay ?? 4.2)));
  const bw = W / n, ow = bw * (o.open ?? 0.6), r = ow / 2;
  const yS = y0 + sill, yC = y1 - band;
  const ya = Math.max(yS + 0.6, yC - r - 0.5);
  const rr = Math.min(r, Math.max(0.3, yC - 0.35 - ya));
  const ash = [0.05, 0.2, 0.6, 3.062];
  const arcN = detail > 0.5 ? 14 : 8;
  for (let i = 0; i <= n; i++) {
    const xc = x0 + i * bw, pw = (bw - ow) / 2;
    const px0 = Math.max(x0, xc - pw), px1 = Math.min(x1, xc + pw);
    box(mb, [px0, y0, z - t], [px1, yC, z], 0.02, ash);
    if (px1 - px0 > 0.45) box(mb, [(px0 + px1) / 2 - (px1 - px0) * 0.32, yS, z], [(px0 + px1) / 2 + (px1 - px0) * 0.32, yC - 0.08, z + 0.1], 0.015, [0.08, 0.5, 0.6, 0]);
    // impost block
    box(mb, [px0 - 0.06, ya - 0.24, z - 0.02], [px1 + 0.06, ya, z + 0.08], 0.015, [0.1, 0.5, 0.4, 0]);
  }
  for (let i = 0; i < n; i++) {
    const xc = x0 + (i + 0.5) * bw;
    box(mb, [xc - ow / 2, y0, z - t], [xc + ow / 2, yS, z], 0.02, ash);
    const pts = [[-ow / 2, ya]];
    for (let k = 1; k < arcN; k++) { const a = PI - (k / arcN) * PI; pts.push([Math.cos(a) * ow / 2, ya + Math.sin(a) * rr]); }
    pts.push([ow / 2, ya], [ow / 2, yC], [-ow / 2, yC]);
    mb.push(); mb.translate(xc, 0, z - t); extrudeOutline(mb, pts, t, { aux: ash, auxSide: [0.35, 0.3, 0.3, 0] }); mb.pop();
    // archivolt + keystone
    const ring = [];
    for (let k = 0; k <= arcN; k++) { const a = PI - (k / arcN) * PI; ring.push([Math.cos(a) * (ow / 2 + 0.3), ya + Math.sin(a) * (rr + 0.3)]); }
    for (let k = arcN; k >= 0; k--) { const a = PI - (k / arcN) * PI; ring.push([Math.cos(a) * ow / 2, ya + Math.sin(a) * rr]); }
    mb.push(); mb.translate(xc, 0, z); extrudeOutline(mb, ring, 0.07, { aux: [0.1, 0.5, 0.3, 0], auxSide: [0.2, 0.6, 0.2, 0], back: false }); mb.pop();
    box(mb, [xc - 0.22, ya + rr - 0.05, z - 0.02], [xc + 0.22, Math.min(yC, ya + rr + 0.5), z + 0.12], 0.015, [0.1, 0.6, 0.3, 0]);
    // dark recess (back wall + soffit) — reads as a deep opening
    box(mi, [xc - ow / 2, yS, z - t - 0.05], [xc + ow / 2, ya + rr, z - t + 0.01], 0, [0.9, 0, 0, 0]);
  }
  // cornice band (two fasciae + crown)
  box(mb, [x0 - 0.05, yC, z - t], [x1 + 0.05, yC + band * 0.55, z + 0.08], 0.02, [0.1, 0.4, 0.6, 0]);
  box(mb, [x0 - 0.2, yC + band * 0.55, z - t], [x1 + 0.2, y1, z + 0.28], 0.03, [0.15, 0.8, 0.7, 0]);
}

/**
 * Stepped crepidoma made of individual chamfered blocks.
 * Top of the top step is y = 0; steps go down. W × L = stylobate size.
 */
export function crepidoma(B, W, L, o = {}) {
  const mb = B.marble;
  const steps = o.steps ?? 3, sh = o.stepH ?? 0.5, tr = o.tread ?? 0.7;
  const seed = o.seed ?? 0, detail = o.detail ?? 1;
  const blockL = o.blockL ?? 1.9;
  for (let k = 0; k < steps; k++) {
    const w = W + 2 * tr * k, l = L + 2 * tr * k;
    const y1 = -k * sh, y0 = y1 - sh;
    // core
    box(mb, [-w / 2 + 0.25, y0, -l / 2 + 0.25], [w / 2 - 0.25, y1 - 0.02, l / 2 - 0.25], 0, [0.2, 0, 0, 0], { top: k === 0 ? undefined : false });
    if (detail < 0.35) { box(mb, [-w / 2, y0, -l / 2], [w / 2, y1, l / 2], 0.02, [0, 0.6, 0.15, 0]); continue; }
    // perimeter blocks (stone courses)
    const sides = [
      { a: [-w / 2, l / 2], b: [w / 2, l / 2] }, { a: [w / 2, l / 2], b: [w / 2, -l / 2] },
      { a: [w / 2, -l / 2], b: [-w / 2, -l / 2] }, { a: [-w / 2, -l / 2], b: [-w / 2, l / 2] },
    ];
    sides.forEach((sd, si) => {
      const run = new Run(sd.a, sd.b);
      run.frame(mb);
      const depth = 0.8;
      let s = si % 2 === 0 ? 0 : depth; // corners owned by front/back
      const end = run.len - (si % 2 === 0 ? 0 : depth);
      let bi = 0;
      while (s < end - 0.05) {
        const r = hash3(seed + k * 101, si * 977 + bi, 5);
        let len = blockL * (0.7 + 0.6 * r);
        if (end - s - len < 0.6) len = end - s;
        const sag = (hash3(seed, si * 31 + bi, k) - 0.5) * 0.012;
        const out = (hash3(seed + 3, si * 17 + bi, k) - 0.5) * 0.01;
        box(mb, [s + 0.004, y0, -depth], [s + len - 0.004, y1 + sag, out], 0.035, [0.05, 1, 0.1, 0]);
        s += len; bi++;
      }
      mb.pop();
    });
  }
  // euthynteria / foundation going into the ground
  const w = W + 2 * tr * steps, l = L + 2 * tr * steps;
  const fy = -steps * sh;
  box(mb, [-w / 2 - 0.15, fy - (o.foundation ?? 3), -l / 2 - 0.15], [w / 2 + 0.15, fy, l / 2 + 0.15], 0.03, [0.2, 0.2, 0.4, 3.06]);
  // (r5) arcaded terrace walls on the visible faces of a tall podium (hill sanctuary, refs 1/3/9)
  if (o.arcade && (o.foundation ?? 3) > 4) {
    const A = o.arcade, t = A.depth ?? 2.2;
    const yb = Math.max(fy - (o.foundation ?? 3), A.bottom ?? -1e9);
    for (const f of A.faces || ['front', 'left', 'right']) {
      const rot = { front: 0, right: PI / 2, left: -PI / 2, back: PI }[f] ?? 0;
      const along = f === 'front' || f === 'back' ? w : l, across = f === 'front' || f === 'back' ? l : w;
      const zf = across / 2 + 0.15 + t, hl = along / 2 + 0.15 + (f === 'front' || f === 'back' ? t : 0);
      B.marble.push(); B.mb.interior.push(); B.marble.rotateY(rot); B.mb.interior.rotateY(rot);
      arcadeFacade(B, { x0: -hl, x1: hl, y0: yb, y1: fy, z: zf, depth: t, bay: A.bay, open: A.open, detail });
      // balustrade along the terrace edge (the dotted rail line reads from afar, refs 1, 2, 9)
      if (A.balustrade !== false && 2 * hl > 5) { B.marble.push(); B.marble.translate(-hl + 1.4, fy, zf - 0.35); balustrade(B.marble, { length: 2 * hl - 2.8, height: 1.0, spacing: 0.32, postEvery: 3.2, detail: Math.min(detail, 0.45) }); B.marble.pop(); }
      B.marble.pop(); B.mb.interior.pop();
    }
    B.occBox([-w / 2 - 0.15 - t, yb, -l / 2 - 0.15 - t], [w / 2 + 0.15 + t, fy, l / 2 + 0.15 + t]);
    // statues on pedestals at the front corners of the terrace (small white figures that read from afar)
    if (A.statues !== false) for (const s of [-1, 1]) B.info.statues.push({ pos: [s * (w / 2 + t - 0.5), fy, l / 2 + t - 0.5], dir: [0, 0, 1], size: 2.4, tag: 'terrace-podium', needsPedestal: true });
    // braziers on the terrace front (fire glints on the far sanctuary terraces)
    if (A.braziers !== false) for (const s of [-1, 1]) B.info.braziers.push({ pos: [s * w * 0.25, fy, l / 2 + t - 0.9], dir: [0, 0, 1], size: 0.9, tag: 'terrace-podium', needsStand: true });
  }
  // top paving of the stylobate (inside the colonnade)
  box(mb, [-W / 2 + 0.8, -0.03, -L / 2 + 0.8], [W / 2 - 0.8, 0.0, L / 2 - 0.8], 0, [0.05, 0, 0, 5.18]);
  B.occBox([-w / 2, fy - 1, -l / 2], [w / 2, 0, l / 2]);
}

/** central staircase in front of the crepidoma (people-scale steps) */
export function frontStairs(B, width, totalH, zFront, o = {}) {
  const mb = B.marble;
  const n = Math.max(2, Math.round(totalH / (o.riser ?? 0.24)));
  const rh = totalH / n, tr = o.tread ?? 0.42;
  for (let i = 0; i < n; i++) {
    const y1 = -i * rh, y0 = y1 - rh;
    const z0 = zFront + i * tr;
    const segs = Math.max(1, Math.round(width / 2.2));
    for (let k = 0; k < segs; k++) {
      const x0 = -width / 2 + (width / segs) * k, x1 = x0 + width / segs;
      const sag = (hash3(i, k, 77) - 0.5) * 0.01;
      box(mb, [x0 + 0.003, y0 - 0.2, zFront - 0.5], [x1 - 0.003, y1 + 0.014 + sag * 0.3, z0 + tr], 0.03, [0.05, 1, 0.05, 0]);
    }
  }
  B.occBox([-width / 2 - 0.7, -totalH - 0.2, zFront - 0.5], [width / 2 + 0.7, 0, zFront + n * tr]);
  return { depth: n * tr };
}

/** bronze double door (leaves open by `open` rad) in an opening of w × h at z = 0 facing +Z */
function bronzeDoor(B, w, h, open = 0.9) {
  const mz = B.bronze;
  for (const s of [-1, 1]) {
    mz.push();
    mz.translate(s * w / 2, 0, -0.1);
    mz.rotateY(-s * open);
    const lw = w / 2, t = 0.14;
    // leaf
    box(mz, [s < 0 ? 0 : -lw, 0, -t], [s < 0 ? lw : 0, h, 0], 0.01, [0.1, 0.3, 0, 0]);
    // panels (raised) + studs
    const x0 = s < 0 ? 0.12 : -lw + 0.12, x1 = s < 0 ? lw - 0.12 : -0.12;
    const np = 4;
    for (let i = 0; i < np; i++) {
      const y0 = 0.25 + (i * (h - 0.5)) / np + 0.08, y1 = 0.25 + ((i + 1) * (h - 0.5)) / np - 0.08;
      box(mz, [x0, y0, 0], [x1, y1, 0.03], 0.012, [0.3, 0.6, 0, 0]);
      const ns = 4;
      for (let j = 0; j < ns; j++) {
        const sx = lerp(x0 + 0.1, x1 - 0.1, j / (ns - 1));
        for (const sy of [y0 + 0.08, y1 - 0.08]) { mz.push(); mz.translate(sx, sy, 0.035); ellipsoid(mz, 0.035, 0.035, 0.025, 6, 4, [0.1, 0.8, 0, 0]); mz.pop(); }
      }
      // lion-head knocker on the second panel
      if (i === 1) { mz.push(); mz.translate((x0 + x1) / 2, (y0 + y1) / 2, 0.04); shield(mz, 0.16, { segs: 20 }); mz.pop(); }
    }
    mz.pop();
  }
}

/**
 * Cella: walls with ashlar, antae, door, interior floor; optional pronaos/opisthodomos porches.
 * o: { cw (outer width), z0, z1 (back/front outer wall faces), t (wall thickness), h (wall top), floorY,
 *      doorW, doorH, frontAntae (m), backAntae, gild }
 */
function cella(B, o) {
  const mb = o.dark ? B.mb.interior : B.marble, mi = B.mb.interior; // o.dark: shadowed cella walls seen through the peristyle (ref 5)
  const { cw, z0, z1, t, h, floorY } = o;
  const hw = cw / 2;
  const aux = [0.05, 0, 0.45, 3.05];
  const ext = o.frontAntae ?? 0, extB = o.backAntae ?? 0;
  // side walls (incl. antae)
  for (const s of [-1, 1]) {
    box(mb, [s < 0 ? -hw : hw - t, floorY, z0 - extB], [s < 0 ? -hw + t : hw, h, z1 + ext], 0.02, aux);
    // interior face darker (separate thin skin)
    box(mi, [s < 0 ? -hw + t : hw - t - 0.02, floorY, z0], [s < 0 ? -hw + t + 0.02 : hw - t, h, z1], 0, [0.3, 0, 0, 3.05]);
    // anta capitals (moulded) at the wall ends
    const xa = s < 0 ? -hw - 0.07 : hw - t - 0.07, xb = s < 0 ? -hw + t + 0.07 : hw + 0.07;
    const hc = o.antaCapY ?? h - 0.3;
    if (ext > 0) box(mb, [xa, hc - 0.35, z1 + ext - 0.9], [xb, hc, z1 + ext + 0.07], 0.02, [0.2, 0.3, 0.6, 0]);
    if (extB > 0) box(mb, [xa, hc - 0.35, z0 - extB - 0.07], [xb, hc, z0 - extB + 0.9], 0.02, [0.2, 0.3, 0.6, 0]);
  }
  // front & back walls with doorways (o.darkFront: porch walls in the porch shade read dark from afar)
  const dw = o.doorW, dh = o.doorH;
  for (const [zw, dir] of [[z1, 1], [z0, -1]]) {
    const zA = dir > 0 ? zw - t : zw, zB = dir > 0 ? zw : zw + t;
    const mw = o.darkFront && (dir > 0 || o.darkBack) ? mi : mb;
    box(mw, [-hw + t, floorY, zA], [-dw / 2, h, zB], 0.02, aux);
    box(mw, [dw / 2, floorY, zA], [hw - t, h, zB], 0.02, aux);
    box(mw, [-dw / 2, floorY + dh, zA], [dw / 2, h, zB], 0.02, aux);
    // moulded door frame (architrave around the opening)
    const fr = 0.32;
    const facePlane = dir > 0 ? zB : zA;
    mb.push(); mb.translate(0, floorY, facePlane); if (dir < 0) mb.rotateY(PI);
    box(mb, [-dw / 2 - fr, 0, -0.02], [-dw / 2, dh + fr, 0.12], 0.02, [0.15, 0.4, 0.3, 0]);
    box(mb, [dw / 2, 0, -0.02], [dw / 2 + fr, dh + fr, 0.12], 0.02, [0.15, 0.4, 0.3, 0]);
    box(mb, [-dw / 2 - fr - 0.25, dh + fr, -0.02], [dw / 2 + fr + 0.25, dh + fr + 0.45, 0.22], 0.025, [0.1, 0.4, 0.5, 0]);
    // consoles under the cornice
    for (const s of [-1, 1]) box(mb, [s * (dw / 2 + fr) - 0.12, dh - 0.3, 0.1], [s * (dw / 2 + fr) + 0.12, dh + fr, 0.3], 0.02, [0.2, 0.4, 0.3, 0]);
    mb.pop();
    if (dir > 0) { B.bronze.push(); B.bronze.translate(0, floorY, zA); bronzeDoor(B, dw, dh, 1.05); B.bronze.pop(); }
  }
  // move the door into place (bronzeDoor writes at the bronze builder's transform; ensure it's placed)
  // interior: floor + dark ceiling skin
  box(mi, [-hw + t, floorY - 0.02, z0 + t], [hw - t, floorY, z1 - t], 0, [0.4, 0, 0, 5.15]);
  B.occBox([-hw, floorY, z0 - extB], [-hw + t, h, z1 + ext]);
  B.occBox([hw - t, floorY, z0 - extB], [hw, h, z1 + ext]);
  for (const [zw, dir] of [[z1, 1], [z0, -1]]) {
    const zA = dir > 0 ? zw - t : zw, zB = dir > 0 ? zw : zw + t;
    B.occBox([-hw, floorY, zA], [-dw / 2, h, zB]);
    B.occBox([dw / 2, floorY, zA], [hw, h, zB]);
    B.occBox([-dw / 2, floorY + dh, zA], [dw / 2, h, zB]);
  }
}

/**
 * Peripteral temple.
 * @param {object} o
 *  order 'doric'|'ionic'; front, side: column counts; W, L stylobate; colH; steps, stepH, tread;
 *  pitch (deg); plaques (gilded triglyph plaques); gild 0..1; acroteria 'palmette'|'nike'|'none';
 *  corners 'griffin'|'palmette'|'none'; porch: number of prostyle porch columns (pronaos/opisthodomos);
 *  stairs: {width} front stairs; detail; seed; name; banners: true → banner slots between porch columns
 */
export function peripteralTemple(o = {}) {
  const t0 = performance.now();
  const order = o.order || 'doric';
  const B = new Building(o.name || 'temple', { detail: o.detail ?? 1, seed: o.seed ?? 1, variant: o.variant, tint: o.tint, overrides: o.overrides, roofTint: o.roofTint, interiorDark: o.interiorDark });
  const detail = B.detail;
  const W = o.W ?? 31, L = o.L ?? 70, nf = o.front ?? 8, ns = o.side ?? 17;
  const colH = o.colH ?? 10.4;
  const ci = columnInfo({ order, height: colH, diameter: o.D });
  const D = ci.D;
  const e = 0.55 * D;
  const ax = W / 2 - e, az = L / 2 - e;
  const k = order === 'doric' ? 0.84 : 1;
  const xs = columnAxes(2 * ax, nf, k), zs = columnAxes(2 * az, ns, k);
  const pitch = ((o.pitch ?? 14.5) * PI) / 180;
  const seed = o.seed ?? 1;
  // ---------------------------------------------------------------- crepidoma + stairs
  crepidoma(B, W, L, { steps: o.steps ?? 3, stepH: o.stepH ?? 0.5, tread: o.tread ?? 0.7, seed, detail, foundation: o.foundation ?? 4, arcade: o.arcade });
  const crepH = (o.steps ?? 3) * (o.stepH ?? 0.5);
  if (o.stairs) {
    const zf = L / 2 + (o.steps ?? 3) * (o.tread ?? 0.7);
    // ramp-like stair centred on the front, cutting through the steps
    B.marble.push(); B.marble.translate(0, 0, 0);
    frontStairs(B, o.stairs.width ?? 9, crepH, L / 2 - 0.2, { riser: 0.25 });
    B.marble.pop();
    void zf;
  }
  // ---------------------------------------------------------------- columns (instanced)
  const colGeo = columnGeometry({ order, height: colH, diameter: D, detail: detail * (o.columnDetail ?? 1), decorated: o.decoratedEchinus ?? (order === 'doric' && detail > 0.6) });
  const positions = [];
  xs.forEach((x, i) => { positions.push([x, az, 'f', i]); positions.push([x, -az, 'b', i]); });
  zs.slice(1, -1).forEach((z, i) => { positions.push([ax, z, 'r', i]); positions.push([-ax, z, 'l', i]); });
  const m4 = new THREE.Matrix4();
  for (const [x, z, side, i] of positions) {
    const r = hash3(seed, Math.round(x * 10), Math.round(z * 10));
    const rot = Math.floor(r * 4) * (PI / 2); // quarter turns keep the square abacus aligned
    const tilt = 0.0035;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.sign(z) * tilt * (Math.abs(z) > az - 0.1 ? 1 : 0), rot, Math.sign(x) * tilt * (Math.abs(x) > ax - 0.1 ? 1 : 0), 'XYZ'));
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1 + (r - 0.5) * 0.0015, 1));
    B.addInstance('columns', colGeo.geometry, m4);
    B.occCyl(x, z, D / 2, 0, colH);
  }
  // ---------------------------------------------------------------- entablature runs
  const fA = ci.abacus * 0.5 * 0.97;
  const dA = Math.max(1.0 * D, ci.abacus * 0.95);
  const hA = (o.hA ?? 0.72) * D, hF = (o.hF ?? 0.72) * D, hG = 0.38 * D;
  const tw = 0.44 * D;
  const runs = [
    { run: new Run([-ax, az], [ax, az]), axes: xs.map((x) => x + ax), owner: true, id: 'front' },
    { run: new Run([ax, az], [ax, -az]), axes: zs.map((z) => az - z).sort((a, b) => a - b), owner: false, id: 'right' },
    { run: new Run([ax, -az], [-ax, -az]), axes: xs.map((x) => ax - x).sort((a, b) => a - b), owner: true, id: 'back' },
    { run: new Run([-ax, -az], [-ax, az]), axes: zs.map((z) => z + az), owner: false, id: 'left' },
  ];
  const ov = 0.42 * D;
  let yTop = 0;
  for (const R of runs) {
    if (order === 'doric') {
      const trig = triglyphCentres(R.axes, fA, tw);
      const res = doricRun(B, R.run, { y0: colH, D, fA, dA, hA, hF, hG, tw, triglyphs: trig, axes: R.axes, owner: R.owner, detail, seed: seed + R.id.length, ov, plaques: !!o.plaques, gild: o.gild ?? 0, metopes: B.info.metopes, runId: R.id, coursed: o.coursed ?? detail > 0.5 });
      yTop = res.yTop;
    } else {
      const res = ionicRun(B, R.run, { y0: colH, D, fA, dA, owner: R.owner, detail, gild: o.gild ?? 0, frieze: o.frieze ?? 'plain', ov: 0.5 * D });
      yTop = res.yCorona;
    }
  }
  const ovE = order === 'doric' ? ov : 0.5 * D;
  // entablature occluders (ring)
  const yE0 = colH, yE1 = yTop;
  B.occBox([-ax - fA - ovE, yE0, az + fA - dA], [ax + fA + ovE, yE1, az + fA + ovE]);
  B.occBox([-ax - fA - ovE, yE0, -az - fA - ovE], [ax + fA + ovE, yE1, -az - fA + dA]);
  B.occBox([ax + fA - dA, yE0, -az - fA], [ax + fA + ovE, yE1, az + fA]);
  B.occBox([-ax - fA - ovE, yE0, -az - fA], [-ax - fA + dA, yE1, az + fA]);
  // ---------------------------------------------------------------- pediments + roof
  const hR = 0.32 * D, simaH = 0.24 * D;
  const half = ax + fA + ovE;
  const pedInfo = [];
  for (const R of [runs[0], runs[2]]) {
    const res = pediment(B, R.run, { yBase: yTop, fA, ov: ovE, D, pitch, hR, simaH, acroteria: o.acroteria ?? 'palmette', corners: o.corners ?? 'palmette', detail, gild: o.gild ?? 0, pediments: B.info.pediments, acroScale: o.acroScale ?? 1, apexGroup: o.apexGroup, rakingAntefixes: o.rakingAntefixes ?? detail > 0.45, recess: o.pedRecess ?? 0 });
    pedInfo.push(res);
  }
  const yEaves = yTop + hR / Math.cos(pitch);
  // flank eaves course (gutter) under the antefixes
  for (const s of [-1, 1]) {
    box(B.marble, [s < 0 ? -half : half - 0.35 * D, yTop, -az - fA - ovE], [s < 0 ? -half + 0.35 * D : half, yEaves, az + fA + ovE], 0.01 * D, [0.05, 0.3, 0.6, 0]);
    if ((o.gild ?? 0) > 0) box(B.gold, [s < 0 ? -half - 0.012 : half - 0.02, yEaves - 0.06 * D, -az - fA - ovE], [s < 0 ? -half + 0.02 : half + 0.012, yEaves - 0.035 * D, az + fA + ovE], 0, [0.2, 0.3, 0, 0]);
  }
  const roof = tiledRoof(B, { xo: half, z0: -az - fA - ovE + 0.1 * D, z1: az + fA + ovE - 0.1 * D, yEaves, pitch, antefixes: true, ridgePalmettes: detail > 0.5, gild: o.gild ?? 0, antefixH: Math.min(0.55, 0.26 * D) });
  B.occFn([-half, yTop, -az - fA - ovE], [half, roof.yRidge, az + fA + ovE], (x, y) => y < yEaves + (half - Math.abs(x)) * Math.tan(pitch));
  // ---------------------------------------------------------------- ceiling (beams + coffers) over the peristyle
  const cw = o.cellaW ?? Math.max(4, 2 * (ax - 1.85 * D));
  const ceilY = colH + hA + hF * 0.85;
  const mbI = B.mb.interior;
  box(mbI, [-ax - fA + dA, ceilY, -az - fA + dA], [ax + fA - dA, ceilY + 0.4, az + fA - dA], 0, [0.4, 0, 0, 0]);
  // beams across the aisles
  const beamW = 0.32, beamH = 0.42;
  for (const s of [-1, 1]) {
    for (let z = -az + 0.6; z < az - 0.4; z += 1.35) box(B.marble, [s < 0 ? -ax - fA + dA : cw / 2, ceilY - beamH, z - beamW / 2], [s < 0 ? -cw / 2 : ax + fA - dA, ceilY, z + beamW / 2], 0.02, [0.35, 0, 0, 0]);
    // (r5) coffers: longitudinal ribs split each beam bay into square lacunaria with a gilded star (hero temple)
    if (detail > 0.6) {
      const xa = s < 0 ? -ax - fA + dA : cw / 2, xb = s < 0 ? -cw / 2 : ax + fA - dA, aw = xb - xa;
      const nC = Math.max(1, Math.round(aw / 1.15));
      for (let k = 1; k < nC; k++) { const x = xa + (k * aw) / nC; box(B.marble, [x - 0.07, ceilY - beamH * 0.55, -az + 0.6], [x + 0.07, ceilY, az - 0.4], 0.01, [0.4, 0.2, 0, 0]); }
      for (let z = -az + 0.6 + 0.675; z < az - 0.4 - 0.3; z += 1.35) for (let k = 0; k < nC; k++) {
        B.gold.push(); B.gold.translate(xa + ((k + 0.5) * aw) / nC, ceilY - 0.01, z); B.gold.rotateX(Math.PI / 2); rosette(B.gold, 0.16, 8, { detail: 'low' }); B.gold.pop();
      }
    }
  }
  // beams over the front/back aisles are added after the porch positions are known
  // ---------------------------------------------------------------- cella + porches
  const porchN = o.porch ?? (nf >= 8 ? 6 : nf >= 6 ? 4 : 2);
  const t = Math.max(0.6, 0.5 * D);
  const floorY = 0.45;
  const aisleEnd = (o.aisleEnd ?? 2.5) * D, porchDepth = (o.porchDepth ?? 1.9) * D;
  const zPorchF = az - aisleEnd, zPorchB = -az + aisleEnd;
  const z1 = zPorchF - porchDepth, z0 = zPorchB + porchDepth;
  // cella platform (2 low steps)
  box(B.marble, [-cw / 2 - 0.6, 0, zPorchB - D * 0.8], [cw / 2 + 0.6, floorY * 0.5, zPorchF + D * 0.8], 0.02, [0.1, 0.8, 0.1, 5.15]);
  box(B.marble, [-cw / 2 - 0.2, floorY * 0.5, zPorchB - D * 0.6], [cw / 2 + 0.2, floorY, zPorchF + D * 0.6], 0.02, [0.1, 0.8, 0.1, 5.15]);
  const wallTop = ceilY;
  cella(B, { cw, z0, z1, t, h: wallTop, floorY, doorW: Math.min(cw * 0.3, 0.45 * colH), doorH: Math.min(colH * 0.85, wallTop - floorY - 1.5), frontAntae: porchDepth - 0.4 * D, backAntae: porchDepth - 0.4 * D, dark: !!o.darkCella });
  // porch columns + architrave + frieze band over them
  const pH = colH - floorY;
  const pD = D * 0.88;
  const pGeo = columnGeometry({ order, height: pH, diameter: pD, detail: detail * 0.8, decorated: false });
  const pxs = columnAxes(cw - 2 * t * 0.5 - pD * 0.2, porchN, 1);
  for (const zp of [zPorchF, zPorchB]) {
    pxs.forEach((x, i) => {
      const r = hash3(seed + 5, i, Math.round(zp));
      m4.compose(new THREE.Vector3(x, floorY, zp), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.floor(r * 4) * (PI / 2), 0)), new THREE.Vector3(1, 1, 1));
      B.addInstance('porchColumns', pGeo.geometry, m4);
      B.occCyl(x, zp, pD / 2, floorY, colH);
    });
    // architrave over porch columns spanning wall to wall
    const dir = zp > 0 ? 1 : -1;
    box(B.marble, [-cw / 2, colH, zp - 0.55 * pD], [cw / 2, colH + hA, zp + 0.55 * pD], 0.015, [0.05, 0, 0.5, 0]);
    // continuous frieze around the cella top (Parthenon frieze band) with shield/rosette rhythm
    box(B.marble, [-cw / 2, colH + hA, zp - 0.55 * pD], [cw / 2, ceilY, zp + 0.55 * pD], 0.015, [0.15, 0, 0.5, 3.04]);
    B.occBox([-cw / 2, colH, zp - 0.55 * pD], [cw / 2, ceilY, zp + 0.55 * pD]);
    if (detail > 0.4) {
      for (let i = 0; i < porchN - 1; i++) {
        const x = (pxs[i] + pxs[i + 1]) / 2;
        const tgt = (o.gild ?? 0) > 0 ? B.gold : B.marble;
        tgt.push(); tgt.translate(x, colH + hA * 0.5, zp + dir * 0.55 * pD); if (dir < 0) tgt.rotateY(PI);
        shield(tgt, Math.min(0.42, hA * 0.36), { segs: 24 }); tgt.pop();
      }
    }
    // banner slots between the porch columns (skip the central door bay)
    if (o.banners !== false) {
      const mid = (porchN - 2) / 2;
      for (let i = 0; i < porchN - 1; i++) {
        if (porchN % 2 === 0 && Math.abs(i - mid) < 0.6) continue;
        const x = (pxs[i] + pxs[i + 1]) / 2;
        const gap = pxs[i + 1] - pxs[i] - pD;
        B.info.banners.push({ pos: [x, colH - 0.15, zp], dir: [0, 0, dir], width: Math.min(2.6, gap * 0.82), height: Math.min(8.8, pH * 0.86), size: Math.min(8.8, pH * 0.86), tag: 'temple-pronaos', anchor: 'top-centre', priority: 1 });
      }
    }
  }
  for (const dir of [1, -1]) {
    const za = dir > 0 ? zPorchF + 0.55 * pD : -az - fA + dA, zb = dir > 0 ? az + fA - dA : zPorchB - 0.55 * pD;
    for (let x = -ax + 0.5; x < ax - 0.3; x += 1.35) box(B.marble, [x - beamW / 2, ceilY - beamH, za], [x + beamW / 2, ceilY, zb], 0.02, [0.35, 0, 0, 0]);
  }
  // optional banner slots on the outer front colonnade (ref 6): two symmetric bays, lower priority
  if (o.banners !== false && nf >= 6) {
    for (const zr of [az, -az]) {
      const dir = zr > 0 ? 1 : -1;
      for (const i of [1, nf - 3]) {
        const x = (xs[i] + xs[i + 1]) / 2, gap = xs[i + 1] - xs[i] - D;
        B.info.banners.push({ pos: [x, colH - 0.1, zr], dir: [0, 0, dir], width: Math.min(2.4, gap * 0.85), height: Math.min(8, colH * 0.72), size: Math.min(8, colH * 0.72), tag: 'temple-peristyle', anchor: 'top-centre', priority: 2 });
      }
    }
  }
  // side walls of the cella frieze band (over the cella side walls)
  for (const s of [-1, 1]) {
    box(B.marble, [s < 0 ? -cw / 2 : cw / 2 - t, wallTop - 0.01, zPorchB - 0.55 * pD], [s < 0 ? -cw / 2 + t : cw / 2, ceilY + 0.4, zPorchF + 0.55 * pD], 0, [0.2, 0, 0, 0]);
  }
  // statue slot inside the cella (cult statue, faces the door)
  B.info.statues.push({ pos: [0, floorY, (z0 + z1) / 2 - 2], dir: [0, 0, 1], size: Math.min(colH * 0.95, wallTop - floorY - 0.8), tag: 'temple-cella', interior: true });
  // ceiling occluder (interior) + cella interior volume closed
  B.occBox([-ax - fA + dA, ceilY, -az - fA + dA], [ax + fA - dA, ceilY + 0.4, az + fA - dA]);
  // ---------------------------------------------------------------- info
  B.info.anchors = { W, L, D, colH, crepH, yTop, yEaves, yRidge: roof.yRidge, pitch, half, fA, ax, az, cw, zPorchF, zPorchB, columns: positions.map(([x, z]) => [x, z]), porchColumns: pxs, ovE };
  B.info.footprint = { hw: W / 2 + (o.steps ?? 3) * (o.tread ?? 0.7) + 0.3, hd: L / 2 + (o.steps ?? 3) * (o.tread ?? 0.7) + 0.3 + (o.stairs ? 0 : 0) };
  B.genMs = Math.round(performance.now() - t0);
  return B;
}

/**
 * Prostyle (porch only at the front) or amphiprostyle (both ends) small temple.
 * o: { order, porch: n columns, W (stylobate width), L, colH, amphi, pitch, gild, frieze, acroteria, corners, steps, detail, seed }
 */
export function prostyleTemple(o = {}) {
  const t0 = performance.now();
  const order = o.order || 'ionic';
  const B = new Building(o.name || 'prostyle', { detail: o.detail ?? 1, seed: o.seed ?? 2, variant: o.variant, tint: o.tint, overrides: o.overrides, roofTint: o.roofTint, interiorDark: o.interiorDark });
  const detail = B.detail, seed = o.seed ?? 2;
  const n = o.porch ?? 4;
  const colH = o.colH ?? 7;
  const ci = columnInfo({ order, height: colH, diameter: o.D });
  const D = ci.D;
  const W = o.W ?? (n - 1) * 2.6 * D + 1.6 * D;
  const L = o.L ?? W * 1.7;
  const e = 0.6 * D;
  const ax = W / 2 - e;
  const steps = o.steps ?? 3;
  crepidoma(B, W, L, { steps, stepH: o.stepH ?? 0.36, tread: o.tread ?? 0.45, seed, detail, foundation: o.foundation ?? 3, arcade: o.arcade });
  const crepH = steps * (o.stepH ?? 0.36);
  const xs = columnAxes(2 * ax, n, 1);
  const zP = L / 2 - e;
  const porchD = o.porchDepth ?? 2.2 * D;
  const z1 = zP - porchD, z0 = o.amphi ? -zP + porchD : -L / 2 + 0.2;
  const colGeo = columnGeometry({ order, height: colH, diameter: D, detail: detail * (o.columnDetail ?? 1) });
  const m4 = new THREE.Matrix4();
  const rows = o.amphi ? [zP, -zP] : [zP];
  for (const z of rows) xs.forEach((x, i) => {
    const r = hash3(seed, i, Math.round(z));
    m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.floor(r * 4) * (PI / 2), 0)), new THREE.Vector3(1, 1, 1));
    B.addInstance('columns', colGeo.geometry, m4);
    B.occCyl(x, z, D / 2, 0, colH);
  });
  // cella walls (full width) from z0 to z1
  const cw = W - 0.3;
  const t = Math.max(0.5, 0.45 * D);
  cella(B, { cw, z0, z1, t, h: colH, floorY: 0, doorW: Math.min(cw * 0.36, colH * 0.42), doorH: colH * 0.7, frontAntae: porchD - 0.4 * D, backAntae: o.amphi ? porchD - 0.4 * D : 0, darkFront: o.darkPorch ?? true, darkBack: !!o.amphi });
  // entablature: around the whole rectangle at the wall line (walls carry it on the flanks)
  const fA = ci.abacus * 0.5 * 0.97, dA = Math.max(0.9 * D, ci.abacus * 0.9);
  const zE = zP, zB = o.amphi ? -zP : -L / 2 + fA + 0.1;
  const runs = [
    { run: new Run([-ax, zE], [ax, zE]), axes: xs.map((x) => x + ax), owner: true, id: 'front' },
    { run: new Run([ax, zE], [ax, zB]), axes: [0, zE - zB], owner: false, id: 'right' },
    { run: new Run([ax, zB], [-ax, zB]), axes: o.amphi ? xs.map((x) => ax - x).sort((a, b) => a - b) : [0, 2 * ax], owner: true, id: 'back' },
    { run: new Run([-ax, zB], [-ax, zE]), axes: [0, zE - zB], owner: false, id: 'left' },
  ];
  let yTop = 0;
  const tw = 0.44 * D;
  for (const R of runs) {
    if (order === 'doric') {
      const axesFull = R.owner ? R.axes : (() => { const a = []; const nn = Math.max(1, Math.round(R.run.len / (2.3 * D))); for (let i = 0; i <= nn; i++) a.push((R.run.len * i) / nn); return a; })();
      const res = doricRun(B, R.run, { y0: colH, D, fA, dA, hA: 0.72 * D, hF: 0.72 * D, hG: 0.38 * D, tw, triglyphs: triglyphCentres(axesFull, fA, tw), axes: axesFull, owner: R.owner, detail, seed, plaques: !!o.plaques, gild: o.gild ?? 0, metopes: B.info.metopes, runId: R.id });
      yTop = res.yTop;
    } else {
      const res = ionicRun(B, R.run, { y0: colH, D, fA, dA, owner: R.owner, detail, gild: o.gild ?? 0, frieze: o.frieze ?? 'rosettes', ov: 0.5 * D });
      yTop = res.yCorona;
    }
  }
  const ovE = order === 'doric' ? 0.42 * D : 0.5 * D;
  B.occBox([-ax - fA - ovE, colH, zB - fA - ovE], [ax + fA + ovE, yTop, zE + fA + ovE]);
  const pitch = ((o.pitch ?? 15) * PI) / 180;
  const hR = 0.32 * D, simaH = 0.24 * D;
  for (const R of [runs[0], runs[2]]) {
    pediment(B, R.run, { yBase: yTop, fA, ov: ovE, D, pitch, hR, simaH, acroteria: o.acroteria ?? 'palmette', corners: o.corners ?? 'palmette', detail, gild: o.gild ?? 0, pediments: B.info.pediments, acroScale: o.acroScale ?? 1.1 });
  }
  const half = ax + fA + ovE;
  const yEaves = yTop + hR / Math.cos(pitch);
  for (const s of [-1, 1]) box(B.marble, [s < 0 ? -half : half - 0.35 * D, yTop, zB - fA - ovE], [s < 0 ? -half + 0.35 * D : half, yEaves, zE + fA + ovE], 0.01 * D, [0.05, 0.3, 0.6, 0]);
  const roof = tiledRoof(B, { xo: half, z0: zB - fA - ovE + 0.1 * D, z1: zE + fA + ovE - 0.1 * D, yEaves, pitch, antefixes: detail > 0.3, ridgePalmettes: false, gild: o.gild ?? 0, antefixH: Math.min(0.45, 0.24 * D) });
  B.occFn([-half, yTop, zB - fA - ovE], [half, roof.yRidge, zE + fA + ovE], (x, y) => y < yEaves + (half - Math.abs(x)) * Math.tan(pitch));
  // porch ceiling
  box(B.mb.interior, [-ax - fA + dA * 0.5, colH + 0.5 * D, z1], [ax + fA - dA * 0.5, colH + 0.5 * D + 0.3, zE], 0, [0.4, 0, 0, 0]);
  B.occBox([-ax, colH + 0.5 * D, z1], [ax, colH + 0.8 * D, zE]);
  // statue slots flanking the front steps
  if (o.flankStatues !== false) for (const s of [-1, 1]) B.info.statues.push({ pos: [s * (W / 2 + 0.6), -crepH, L / 2 + steps * (o.tread ?? 0.45) + 1.2], dir: [0, 0, 1], size: colH * 0.32, tag: 'temple-flank', needsPedestal: true });
  if (o.banners) {
    for (let i = 0; i < n - 1; i++) if (!(n % 2 === 0 && i === (n - 2) / 2)) B.info.banners.push({ pos: [(xs[i] + xs[i + 1]) / 2, colH - 0.1, z1 + 0.3], dir: [0, 0, 1], width: 1.8, height: colH * 0.6, size: colH * 0.6, tag: 'temple-porch', anchor: 'top-centre', priority: 2 });
  }
  B.info.anchors = { W, L, D, colH, crepH, yTop, yEaves, yRidge: roof.yRidge, pitch };
  B.info.footprint = { hw: W / 2 + steps * (o.tread ?? 0.45) + 0.3, hd: L / 2 + steps * (o.tread ?? 0.45) + 0.3 };
  B.genMs = Math.round(performance.now() - t0);
  return B;
}
