// Ruins kit: broken columns (jagged break, chipped flutes), fallen drums (with carved rosette end
// faces), rough broken blocks, broken entablature fragments, lying capitals.
// All return BufferGeometry (position, normal, aux) in a local frame with y up; use marbleMaterial
// ({variant:'ruined'|'mossy'}) for the right look.
import * as THREE from 'three';
import { MeshBuilder, surface, lathe, box, lerp, clamp, smooth, hash3, fbm3, vnoise3 } from './geom.js';
import { ORDER_DEFAULTS, shaftRadius, atticBase, doricCapital, ionicCapital, seg } from './orders.js';
import { corinthianCapital } from './acanthus.js';
import { triglyphFace } from './entablature.js';

const PI = Math.PI;

/** radius of a fluted cross-section at angle a */
function fluteR(a, R, F, depthFrac, fillet, phase = 0) {
  const pitch = (2 * PI) / F;
  let k = (((a - phase) % pitch) + pitch) % pitch / pitch; // 0..1 within the flute pitch
  if (fillet > 0) {
    if (k < fillet) return R;
    k = (k - fillet) / (1 - fillet);
    const chord = 2 * R * Math.sin(((1 - fillet) * pitch) / 2);
    return R - chord * depthFrac * Math.sqrt(Math.max(0, 1 - (2 * k - 1) ** 2));
  }
  const chord = 2 * R * Math.sin(pitch / 2);
  return R - chord * depthFrac * Math.pow(Math.max(0, 1 - (2 * k - 1) ** 2), 0.62);
}

/** carved sunburst rosette on a drum end: height of the relief at radial fraction t (0 centre … 1 rim), angle a */
function rosetteRelief(t, a, R0) {
  const H = 0.05 * R0;
  const rim = smooth(0.80, 0.84, t) * smooth(0.93, 0.89, t);            // raised outer ring
  const groove = smooth(0.76, 0.79, t) * smooth(0.82, 0.79, t);         // groove inside the ring
  const nP = 16;
  const k = Math.abs(((a * nP) / (2 * PI)) % 1 - 0.5) * 2;              // 0 at petal centre … 1 between petals
  const petalW = 1 - smooth(0.25, 0.75, t) * 0.75;                        // petals taper to points
  const petal = smooth(petalW, petalW * 0.6, k) * smooth(0.22, 0.28, t) * smooth(0.76, 0.7, t);
  const inner = smooth(0.17, 0.2, t) * smooth(0.25, 0.22, t);           // inner ring
  const boss = Math.sqrt(Math.max(0, 1 - (t / 0.15) ** 2));              // central boss
  return H * (0.8 * rim + 0.9 * petal * (0.6 + 0.4 * (1 - t)) + 0.7 * inner + 1.3 * boss) - H * 0.5 * groove;
}

/**
 * Fluted shaft segment with optional jagged top (break) and chips.
 * o: { order, R0 (lower radius of the full column), taper, H (full shaft height), y0, y1 (segment in shaft coords),
 *      breakTop (amplitude m, 0 = clean cut), breakBottom, chips (0..1), seed, detail, rosetteTop/Bottom }
 * The segment is placed with its own base at y = 0.
 */
export function shaftSegment(mb, o) {
  const order = o.order || 'doric';
  const d = ORDER_DEFAULTS[order];
  const F = o.flutes ?? d.flutes, fillet = order === 'doric' ? 0 : 0.2, depthFrac = order === 'doric' ? 0.16 : 0.42;
  const R0 = o.R0, taper = o.taper ?? d.taper, H = o.H;
  const y0 = o.y0 ?? 0, y1 = o.y1 ?? H;
  const seed = o.seed ?? 1, chips = o.chips ?? 0.5, detail = o.detail ?? 1;
  const bt = o.breakTop ?? 0, bb = o.breakBottom ?? 0;
  const nA = F * seg(detail, 4, 8), nV = seg(detail, 6, 18);
  const jag = (a, top) => {
    const amp = top ? bt : bb;
    if (amp <= 0) return 0;
    const s = top ? 1 : -1;
    const n = fbm3(Math.cos(a) * 1.3 + seed, Math.sin(a) * 1.3, top ? 5.1 : 9.3, 4);
    const tilt = Math.cos(a - seed * 2.1) * 0.5 + 0.5;
    return s * amp * (0.25 + 0.75 * n * (0.4 + 0.6 * tilt)) * -1;
  };
  const Rat = (y) => shaftRadius(R0, taper, 0.012, clamp(y / H, 0, 1), order === 'doric' ? 0 : 0.04);
  const chipF = (a, y) => {
    if (chips <= 0) return 0;
    const n = fbm3(Math.cos(a) * 2.2 + seed * 3, y * 1.6, Math.sin(a) * 2.2, 3);
    const big = smooth(0.62 - 0.12 * chips, 0.8, n);
    const edge = Math.max(smooth(0.5, 0, y - y0 - (bb > 0 ? bb : 0)), smooth(0.5, 0, y1 - y - (bt > 0 ? bt : 0)));
    return -R0 * 0.12 * big * (0.4 + 0.6 * chips) * (0.5 + 0.5 * edge) - R0 * 0.03 * vnoise3(a * 5, y * 8, seed) * chips;
  };
  const yTopAt = (a) => (y1 - y0) + jag(a, true);
  const yBotAt = (a) => -jag(a, false) * 0;
  const pos = (u, v, out, extra = 0) => {
    const a = u * 2 * PI;
    const yb = bb > 0 ? jag(a, false) * -1 : 0;
    const yt = yTopAt(a);
    const y = lerp(yb, yt, v);
    const ys = y + y0;
    const r = fluteR(a, Rat(ys), F, depthFrac, fillet) + chipF(a, ys) + extra;
    out[0] = Math.sin(a) * r; out[1] = y; out[2] = Math.cos(a) * r;
  };
  void yBotAt;
  surface(mb, (u, v, out) => pos(u, v, out), nA, nV, {
    closedU: true,
    aux: (u, v) => { const a = u * 2 * PI; const ys = lerp(0, y1 - y0, v) + y0; const c = -chipF(a, ys) / (R0 * 0.12); const k = ((a % ((2 * PI) / F)) / ((2 * PI) / F)); return [clamp(0.15 * Math.sin(k * PI) + c * 0.5, 0, 1), c > 0.3 ? 0.8 : 0.1, 0.7, 1 + (ys + seed) / 100]; },
  });
  // caps: polar surfaces matching the rim
  for (const top of [true, false]) {
    const amp = top ? bt : bb;
    const nR = seg(detail, 4, 12);
    const rosette = top ? o.rosetteTop : o.rosetteBottom;
    surface(mb, (u, v, out) => {
      const a = u * 2 * PI;
      const rim = [0, 0, 0]; pos(u, top ? 1 : 0, rim);
      const rr = Math.hypot(rim[0], rim[2]) * (1 - v);
      let y = rim[1];
      if (amp > 0) {
        const c = top ? (y1 - y0) - amp * 0.6 : amp * 0.6;
        y = lerp(rim[1], c + (top ? 1 : -1) * amp * 0.5 * (fbm3(Math.cos(a) * rr + seed, Math.sin(a) * rr, 3.3, 4) - 0.5), smooth(0, 0.35, v));
      } else if (rosette) {
        const t = rr / Math.max(1e-3, Math.hypot(rim[0], rim[2]));
        const relief = rosetteRelief(t, a, R0);
        y += (top ? 1 : -1) * relief;
      }
      out[0] = Math.sin(a) * rr; out[1] = y; out[2] = Math.cos(a) * rr;
    }, nA, rosette ? Math.max(nR, 26) : nR, { closedU: true, flip: !top, aux: (u, v) => { if (rosette && amp <= 0) { const t = 1 - v; const r0 = rosetteRelief(t, u * 2 * PI, R0); return [clamp(0.5 - r0 / (0.05 * R0), 0, 1) * 0.7, 0.1, 0.1, 0]; } return [amp > 0 ? 0.25 : 0.1, amp > 0 ? 0.2 : 0.1, 0.1, 0]; } });
  }
}

/**
 * Broken column (standing): optional Attic base, shaft broken at `breakAt` × full height.
 * o: { order, height (original full height), diameter, breakAt (0.2..0.95), seed, chips, detail, base }
 */
export function brokenColumnGeometry(o = {}) {
  const order = o.order || 'doric';
  const d = ORDER_DEFAULTS[order];
  const H = o.height ?? 8, D = o.diameter ?? H / d.hd;
  const mb = new MeshBuilder();
  let yb = 0;
  if (o.base ?? d.base) yb = atticBase(mb, D, { detail: o.detail ?? 1, plinth: order === 'corinthian' });
  const shaftH = H - yb - (order === 'doric' ? 0.5 * D : order === 'ionic' ? 0.38 * D : 1.17 * D);
  const top = clamp(o.breakAt ?? 0.55, 0.05, 1) * shaftH;
  mb.push(); mb.translate(0, yb, 0);
  shaftSegment(mb, { order, R0: D / 2, H: shaftH, y0: 0, y1: top, breakTop: o.breakTop ?? D * 0.35, chips: o.chips ?? 0.6, seed: o.seed ?? 1, detail: o.detail ?? 1 });
  mb.pop();
  return mb.geometry();
}

/**
 * Column drum (for fallen drums / stacks). Axis = +Y, base at y = 0. Lay it down by rotating.
 * o: { order, diameter, height, rosette (carved end faces), seed, chips, broken (jagged one end) }
 */
export function drumGeometry(o = {}) {
  const order = o.order || 'doric';
  const D = o.diameter ?? 1.4, h = o.height ?? D * 0.8;
  const mb = new MeshBuilder();
  shaftSegment(mb, { order, R0: D / 2, H: h * 6, y0: h * 2, y1: h * 3, taper: 1, chips: o.chips ?? 0.5, seed: o.seed ?? 2, detail: o.detail ?? 1,
    rosetteTop: o.rosette ?? false, rosetteBottom: false, breakBottom: o.broken ? D * 0.25 : 0 });
  return mb.geometry();
}

/**
 * Rough block (ashlar / broken): box with chipped edges and optional broken faces.
 * o: { size:[x,y,z], seed, chip (m), broken: {px,nx,py,ny,pz,nz: amplitude m}, detail, n (grid res) }
 * Centred at origin in x/z, base at y = 0.
 */
export function roughBlock(mb, o = {}) {
  const [sx, sy, sz] = o.size || [1.2, 0.6, 0.8];
  const seed = o.seed ?? 1, chip = o.chip ?? Math.min(sx, sy, sz) * 0.08;
  const br = o.broken || {};
  const n = o.n ?? Math.max(4, Math.round(seg(o.detail ?? 1, 4, 14) * Math.max(sx, sz) / Math.max(sy, 0.3) * 0.5 + 4));
  const c = [0, sy / 2, 0];
  const disp = (x, y, z) => {
    // amount of inward displacement at this point (consistent across faces)
    const ex = 1 - Math.abs(x) / (sx / 2), ey = 1 - Math.abs(y - sy / 2) / (sy / 2), ez = 1 - Math.abs(z) / (sz / 2);
    const edgeD = Math.min(ex * sx, ey * sy) + Math.min(ey * sy, ez * sz) + Math.min(ex * sx, ez * sz);
    const nEdge = smooth(chip * 3, 0, Math.min(ex * sx / 2, ey * sy / 2) + Math.min(ey * sy / 2, ez * sz / 2) * 0 + 0) * 0;
    void edgeD; void nEdge;
    // edge proximity: near two faces at once
    const dx = (sx / 2) - Math.abs(x), dy = (sy / 2) - Math.abs(y - sy / 2), dz = (sz / 2) - Math.abs(z);
    const m1 = Math.min(dx, dy), m2 = Math.min(dy, dz), m3 = Math.min(dx, dz);
    const edge = Math.max(smooth(chip * 2.5, 0, m1), smooth(chip * 2.5, 0, m2), smooth(chip * 2.5, 0, m3));
    const nn = fbm3(x * 2.1 + seed, y * 2.1, z * 2.1 - seed, 3);
    let d = edge * chip * (0.4 + 1.4 * nn);
    const face = (axisVal, half, amp) => amp > 0 ? smooth(half - Math.max(amp * 1.5, 0.2), half, axisVal) * amp * (0.3 + 1.2 * fbm3(x * 1.3 + seed * 2, y * 1.3, z * 1.3, 4)) : 0;
    d += face(x, sx / 2, br.px || 0) + face(-x, sx / 2, br.nx || 0) + face(y - sy / 2, sy / 2, br.py || 0) + face(sy / 2 - y, sy / 2, br.ny || 0) + face(z, sz / 2, br.pz || 0) + face(-z, sz / 2, br.nz || 0);
    d += 0.004 * vnoise3(x * 30, y * 30, z * 30);
    return d;
  };
  const P = (x, y, z, out) => {
    const d = disp(x, y, z);
    const vx = x - c[0], vy = (y - c[1]) * 1.4, vz = z - c[2];
    const l = Math.hypot(vx, vy, vz) || 1;
    out[0] = x - (vx / l) * d; out[1] = y - (vy / l) * d * 0.7; out[2] = z - (vz / l) * d;
  };
  const auxF = (x, y, z) => { const d = disp(x, y, z); return [clamp(d / (chip * 2), 0, 1) * 0.6, clamp(d / chip, 0, 1) * 0.8, 0.4, 0]; };
  const hx = sx / 2, hz = sz / 2;
  const faces = [
    // [f(u,v) → x,y,z]  normal = ∂u × ∂v must point outward
    (u, v) => [hx, v * sy, lerp(hz, -hz, u)],   // +X
    (u, v) => [-hx, v * sy, lerp(-hz, hz, u)],  // -X
    (u, v) => [lerp(-hx, hx, u), sy, lerp(hz, -hz, v)], // +Y
    (u, v) => [lerp(-hx, hx, u), 0, lerp(-hz, hz, v)],  // -Y
    (u, v) => [lerp(-hx, hx, u), v * sy, hz],   // +Z
    (u, v) => [lerp(hx, -hx, u), v * sy, -hz],  // -Z
  ];
  for (const f of faces) {
    surface(mb, (u, v, out) => { const [x, y, z] = f(u, v); P(x, y, z, out); }, n, Math.max(3, Math.round(n * 0.6)), { aux: (u, v) => { const [x, y, z] = f(u, v); return auxF(x, y, z); } });
  }
}

export function roughBlockGeometry(o = {}) { const mb = new MeshBuilder(); roughBlock(mb, o); return mb.geometry(); }

/**
 * Broken entablature fragment: Doric architrave + frieze (triglyph/metope) or Ionic fasciae,
 * broken at one or both ends. Long axis along X, front = +Z, base at y = 0.
 * o: { order ('doric'), D (column diameter), length, seed, brokenEnds: [left,right] }
 */
export function entablatureFragmentGeometry(o = {}) {
  const D = o.D ?? 1.2, L = o.length ?? 3.2, seed = o.seed ?? 4;
  const mb = new MeshBuilder();
  const hA = 0.72 * D, hF = 0.72 * D, dep = 1.0 * D;
  const be = o.brokenEnds || [true, true];
  // architrave block
  mb.push(); mb.translate(0, 0, 0);
  roughBlock(mb, { size: [L, hA, dep], seed, chip: 0.05, broken: { nx: be[0] ? 0.35 * D : 0, px: be[1] ? 0.3 * D : 0, py: 0 }, detail: o.detail });
  mb.pop();
  if ((o.order || 'doric') === 'doric') {
    // taenia + frieze block (shorter, offset)
    mb.push(); mb.translate(L * 0.08, hA, -0.05 * D);
    roughBlock(mb, { size: [L * 0.8, hF, dep * 0.8], seed: seed + 7, chip: 0.04, broken: { nx: 0.2 * D, px: 0.25 * D } , detail: o.detail });
    mb.pop();
    // one triglyph on the front
    const tw = 0.44 * D;
    mb.push(); mb.translate(L * 0.08, hA + 0.02, dep * 0.4 - 0.05 * D + 0.002);
    triglyphFace(mb, tw, hF * 0.9);
    mb.pop();
    box(mb, [L * 0.08 - tw / 2, hA - 0.06 * D, dep / 2 - 0.02], [L * 0.08 + tw / 2, hA - 0.015 * D, dep / 2 + 0.02], 0.004, [0.2, 0.3, 0.2, 0]);
  }
  return mb.geometry();
}

/** lying / standalone capital (Doric / Ionic / Corinthian), base at y = 0 */
export function capitalGeometry(o = {}) {
  const order = o.order || 'corinthian';
  const D = o.diameter ?? 1.0;
  const mb = new MeshBuilder();
  const r1 = D * 0.5 * ORDER_DEFAULTS[order].taper;
  if (order === 'doric') doricCapital(mb, D, r1, 0, { detail: o.detail ?? 1, decorated: o.decorated });
  else if (order === 'ionic') ionicCapital(mb, D, r1, 0, { detail: o.detail ?? 1 });
  else corinthianCapital(mb, D, r1, 0, { detail: o.detail ?? 1 });
  // bottom disk
  lathe(mb, [[r1, 0, 0.2, 0], [0.0001, 0, 0.2, 0]], 24, {});
  return mb.geometry();
}
