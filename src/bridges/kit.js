// Bridge kit: material buckets (MeshBuilders), instancing lists and the shared architectural primitives
// (elliptical voussoir arches, spandrel faces, cornices, balustrades, pedestals, gilded relief panels,
// medallions, tholos tops with gold domes and trident finials). OWNER: bridges agent.
//
// Every structure is built in its own LOCAL frame: x along the bridge axis, y = world height, z across
// (kit.begin(ox, oz, rotY)). Geometry goes straight to world space through the builders' matrices, so the
// shared world-space stone / metal shaders (src/materials/*) pattern it correctly (aux vec4 =
// cavity, edge, streak, masonry flag: 3 + course/10 → ashlar, 5 + slab/10 → paving).
// adapted from athenaion/src/aqueducts/{geom,arcade}.js and src/arch/tholos.js
import * as THREE from 'three';
import { MeshBuilder, box, lathe, surface, tube, quadOut, triOut, hash3, vnoise3, fbm3, clamp, smooth } from './geom.js';

const PI = Math.PI;
export const AUX = {
  ashlar: (c = 0.9, st = 0.35) => [0, 0, st, 3 + c / 10],
  pave: (s = 1.2) => [0, 0, 0, 5 + s / 10],
  plain: [0, 0, 0.25, 0],
  mould: [0.15, 0, 0.45, 0],
  cav: [0.7, 0, 0.2, 0],
  dark: [0.95, 0, 0.1, 0],
};
export const BUCKETS = ['white', 'red', 'banded', 'black', 'lime', 'gold', 'gilt', 'dark', 'relief'];

export class Kit {
  constructor(engine, { detail = 1, sunken = false, label = 'bridges' } = {}) {
    this.engine = engine;
    this.detail = detail;
    this.sunken = sunken;
    this.label = label;
    this.mb = {};
    for (const k of BUCKETS) this.mb[k] = new MeshBuilder();
    this.inst = { baluster: [], column: [], capital: [], colbase: [] };
    this.frame = new THREE.Matrix4();
    this.rotY = 0; this.ox = 0; this.oz = 0;
    this.slots = engine.slots;
    this.coral = [];
    this.kelp = [];
    this.footprints = [];
  }

  /** set the local frame: origin (ox, 0, oz), local +x → world (cos r, 0, -sin r) */
  begin(ox, oz, rotY) {
    this.ox = ox; this.oz = oz; this.rotY = rotY;
    this.frame = new THREE.Matrix4().makeTranslation(ox, 0, oz).multiply(new THREE.Matrix4().makeRotationY(rotY));
    for (const k of BUCKETS) { const m = this.mb[k]; m.m.copy(this.frame); m._upd(); }
    this.c = Math.cos(rotY); this.s = Math.sin(rotY);
  }
  W(x, y, z) { return [this.ox + x * this.c + z * this.s, y, this.oz - x * this.s + z * this.c]; }
  /** compass bearing (deg) of a local horizontal direction */
  compass(lx, lz) {
    const wx = lx * this.c + lz * this.s, wz = -lx * this.s + lz * this.c;
    return ((Math.atan2(wx, -wz) * 180) / PI + 360) % 360;
  }
  /** instance matrix in world space for a local transform */
  imat(x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));
    return this.frame.clone().multiply(m);
  }
  coralAt(x, y, z, nx, ny, nz, size, tag) {
    if (!this.sunken) return;
    const w = this.W(x, y, z), n = [nx * this.c + nz * this.s, ny, -nx * this.s + nz * this.c];
    this.coral.push({ pos: w, normal: n, size, tag: tag || 'bridge' });
  }
}

// ------------------------------------------------------------------------------------------------ basics
export function boxA(mb, x0, y0, z0, x1, y1, z1, aux, bevel = 0) {
  if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
  box(mb, [x0, y0, z0], [x1, y1, z1], bevel, aux);
}
/** hexahedron from 8 corners (bit0 = u, bit1 = v, bit2 = w) */
const HEX_FACES = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
export function hexa(mb, C, aux, faceMask = 63) {
  let cx = 0, cy = 0, cz = 0;
  for (const p of C) { cx += p[0] / 8; cy += p[1] / 8; cz += p[2] / 8; }
  for (let f = 0; f < 6; f++) {
    if (!(faceMask & (1 << f))) continue;
    const F = HEX_FACES[f].map((i) => C[i]);
    const fc = [(F[0][0] + F[2][0]) / 2 - cx, (F[0][1] + F[2][1]) / 2 - cy, (F[0][2] + F[2][2]) / 2 - cz];
    quadOut(mb, F[0], F[1], F[2], F[3], fc, aux);
  }
}
/** flat polygon in the plane z = const (local), facing ±z; contour [[x,y]...] (simple, any winding) */
export function planeZ(mb, contour, z, facing, aux, holes = []) {
  const c2 = contour.map(([x, y]) => new THREE.Vector2(x, y));
  const h2 = holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
  const all = contour.concat(...holes);
  const tris = THREE.ShapeUtils.triangulateShape(c2, h2);
  for (const [i, j, k] of tris) triOut(mb, [all[i][0], all[i][1], z], [all[j][0], all[j][1], z], [all[k][0], all[k][1], z], [0, 0, facing], aux);
}
/** flat polygon in the plane x = const, contour [[z,y]...], facing ±x */
export function planeX(mb, contour, x, facing, aux, holes = []) {
  const c2 = contour.map(([z, y]) => new THREE.Vector2(z, y));
  const h2 = holes.map((h) => h.map(([z, y]) => new THREE.Vector2(z, y)));
  const all = contour.concat(...holes);
  const tris = THREE.ShapeUtils.triangulateShape(c2, h2);
  for (const [i, j, k] of tris) triOut(mb, [x, all[i][1], all[i][0]], [x, all[j][1], all[j][0]], [x, all[k][1], all[k][0]], [facing, 0, 0], aux);
}
/** extrude a profile [[z, y], ...] (closed polygon in the z-y plane) along x from x0 to x1 */
export function extrudeX(mb, profile, x0, x1, aux, caps = true) {
  const n = profile.length;
  let cz = 0, cy = 0;
  for (const [z, y] of profile) { cz += z / n; cy += y / n; }
  for (let i = 0; i < n; i++) {
    const [za, ya] = profile[i], [zb, yb] = profile[(i + 1) % n];
    let nz = yb - ya, ny = -(zb - za);
    if (nz * ((za + zb) / 2 - cz) + ny * ((ya + yb) / 2 - cy) < 0) { nz = -nz; ny = -ny; }
    quadOut(mb, [x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb], [0, ny, nz], aux);
  }
  if (caps) { planeX(mb, profile, x0, -1, aux); planeX(mb, profile, x1, 1, aux); }
}

// ------------------------------------------------------------------------------------------------ arches
/** elliptical arch geometry helpers: centre (cx, sp), half span a, rise b */
export function archPoint(cx, sp, a, b, t, off = 0) {
  const nx = b * Math.cos(t), ny = a * Math.sin(t), l = Math.hypot(nx, ny) || 1;
  return [cx + a * Math.cos(t) + (nx / l) * off, sp + b * Math.sin(t) + (ny / l) * off];
}
/** extrados polyline from the left springing (t = PI) to the right (t = 0) */
export function extrados(cx, sp, a, b, off, segs) {
  const pts = [];
  for (let i = 0; i <= segs; i++) pts.push(archPoint(cx, sp, a, b, PI - (PI * i) / segs, off));
  return pts;
}
/**
 * Voussoir ring (elliptical) in the x-y plane, depth z0..z1, with optional front rings projecting.
 * o: { n voussoirs, thick, key (keystone extra), proj (front ring projection), split (z splits for
 *      staggered soffit joints), mb, aux }
 */
export function archRing(kit, cx, sp, a, b, z0, z1, o = {}) {
  const mb = o.mb || kit.mb.white;
  const thick = o.thick ?? 1.5;
  let n = o.n ?? Math.max(9, Math.round((PI * (a + b) * 0.5) / (o.vl ?? 1.05)));
  if (n % 2 === 0) n++;
  const proj = o.proj ?? 0.22, key = o.key ?? 0.35;
  const front = o.frontDepth ?? 0.9;
  const auxV0 = [0.05, 0, 0.3, 0];
  const mid = (n - 1) / 2;
  const zs = [z0 - proj, z0 + front, z1 - front, z1 + proj];
  for (let k = 0; k < n; k++) {
    if (o.skip && o.skip(k, n)) continue;
    const t0 = PI - (PI * k) / n, t1 = PI - (PI * (k + 1)) / n;
    const isKey = k === mid;
    const auxV = o.mb ? auxV0 : [0.03 + 0.14 * hash3(k, n, 17), 0, 0.3, 0];
    const r1 = thick + (isKey ? key : 0) + (o.alt && k % 2 ? 0.12 : 0);
    // three depth slabs: front ring (projecting), soffit core, back ring
    for (let s = 0; s < 3; s++) {
      const za = zs[s], zb = zs[s + 1];
      // stagger the soffit joints of the core slab
      const C = [];
      for (let i = 0; i < 8; i++) {
        const t = i & 1 ? t1 : t0, off = i & 2 ? (s === 1 ? thick * 0.92 : r1) : 0, z = i & 4 ? zb : za;
        const [x, y] = archPoint(cx, sp, a, b, t, off);
        C.push([x, y, z]);
      }
      hexa(mb, C, auxV, s === 1 ? (1 << 2) : 63);
    }
  }
  // gold keystone ornament (cartouche) on both faces
  if (o.goldKey) {
    const [kx, ky] = archPoint(cx, sp, a, b, PI / 2, thick * 0.55);
    for (const [z, f] of [[z0 - proj, -1], [z1 + proj, 1]]) {
      const g = kit.mb.gilt;
      g.push(); g.translate(kx, ky, z + f * 0.06); if (f < 0) g.rotateY(PI);
      cartouche(g, thick * 0.7, thick * 0.95);
      g.pop();
    }
  }
  return n;
}
/**
 * Carved archivolt band (white stone relief) following the extrados between offsets off0..off1, on the face
 * plane z (facing f): running Vitruvian-scroll waves between two bead rims ("relief spandrels", ref 2).
 */
export function archBand(kit, cx, sp, a, b, off0, off1, z, f, o = {}) {
  const mb = o.mb || kit.mb.white;
  const N = o.waves ?? 26, depth = o.depth ?? 0.22, base = o.base ?? 0.06;
  const nt = Math.max(60, Math.round(N * 9 * kit.detail)), nv = Math.max(6, Math.round(10 * kit.detail));
  const hgt = (t, v) => {
    const rim = smooth(0.16, 0.06, v) + smooth(0.84, 0.94, v);
    const ph = N * t * 2 * PI;
    const scroll = Math.sin(ph + 3.2 * (v - 0.5) + 1.4 * Math.sin(ph * 0.5)) ;
    const inner = smooth(-0.1, 0.7, scroll) * (1 - Math.pow(Math.abs(2 * v - 1), 3));
    return clamp(Math.max(rim * 0.85, 0.25 + 0.6 * inner), 0, 1);
  };
  surface(mb, (u, v, out) => {
    const t = PI - PI * u;
    const off = off0 + (off1 - off0) * v;
    const [x, y] = archPoint(cx, sp, a, b, t, off);
    out[0] = x; out[1] = y; out[2] = z + f * (base + hgt(u, v) * depth);
  }, nt, nv, { flip: f > 0, aux: (u, v) => [0.5 * (1 - hgt(u, v)), 0, 0.2, 0] });
  // closing strips (inner / outer edges) down to the face plane
  for (const [off, inward] of [[off0, -1], [off1, 1]]) {
    surface(mb, (u, v, out) => {
      const t = PI - PI * u;
      const [x, y] = archPoint(cx, sp, a, b, t, off);
      out[0] = x; out[1] = y; out[2] = z + f * (base + 0.85 * depth) * v;
    }, Math.round(nt / 3), 1, { flip: (f > 0) !== (inward > 0), aux: AUX.mould });
  }
}

/** small gilt shell-cartouche facing +z (local) */
export function cartouche(mb, w, h) {
  surface(mb, (u, v, o) => {
    const x = (u - 0.5) * w, y = (v - 0.5) * h;
    const r = Math.hypot(x / (w * 0.5), y / (h * 0.5));
    const ribs = 0.5 + 0.5 * Math.cos(Math.atan2(y + h * 0.4, x) * 14);
    o[0] = x; o[1] = y; o[2] = Math.max(0, 1 - r * r) * (0.12 + 0.05 * ribs) * h;
  }, 10, 10, { aux: [0.2, 0, 0, 0] });
}

/** spandrel face with the arch notch(es): x range [xa, xb], from springing line sp up to yTop, plane z */
export function spandrel(mb, xa, xb, sp, yTop, z, facing, arches, aux) {
  const pts = [[xa, yTop], [xa, sp]];
  for (const A of arches) {
    const ex = extrados(A.cx, A.sp, A.a, A.b, A.off, A.segs || 28);
    if (A.sp > sp + 1e-3) { pts.push([ex[0][0], sp]); }
    for (const p of ex) pts.push(p);
    if (A.sp > sp + 1e-3) { pts.push([ex[ex.length - 1][0], sp]); }
  }
  pts.push([xb, sp], [xb, yTop]);
  // drop near-duplicate points
  const P = pts.filter((p, k) => k === 0 || Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) > 1e-3);
  planeZ(mb, P, z, facing, aux);
}

// ------------------------------------------------------------------------------------------------ mouldings
/** cornice running along x at both faces z = ±hd, base y, height h, projection p (white) */
export function corniceX(mb, x0, x1, y, hd, h, p, aux = AUX.mould, sides = [-1, 1]) {
  for (const s of sides) {
    const z0 = s * (hd - 0.05);
    // fascia, ovolo, corona, cymatium (boxes stacked, each projecting a bit more)
    const steps = [[0, 0.18, 0.18], [0.18, 0.42, 0.42], [0.42, 0.78, 0.92], [0.78, 1.0, 0.7]];
    for (const [a, b, q] of steps) {
      const za = s > 0 ? z0 : -hd - p * q, zb = s > 0 ? hd + p * q : -z0;
      boxA(mb, x0, y + a * h, Math.min(za, zb), x1, y + b * h, Math.max(za, zb), aux, 0.02);
    }
  }
}
/** cornice around a rectangle (towers): x0..x1, z0..z1 at height y */
export function corniceRect(mb, x0, x1, z0, z1, y, h, p, aux = AUX.mould) {
  const steps = [[0, 0.2, 0.2], [0.2, 0.45, 0.45], [0.45, 0.8, 1.0], [0.8, 1.0, 0.75]];
  for (const [a, b, q] of steps) boxA(mb, x0 - p * q, y + a * h, z0 - p * q, x1 + p * q, y + b * h, z1 + p * q, aux, 0.025);
}

// ------------------------------------------------------------------------------------------------ balustrade
let _balGeo = null;
export function balusterGeometry(detail = 1) {
  if (_balGeo) return _balGeo;
  const mb = new MeshBuilder();
  const segs = detail >= 0.75 ? 8 : 6;
  // unit height baluster (vase), radius in the same unit (later scaled)
  lathe(mb, [
    [0.0, 0.0], [0.11, 0.0, 0, 0, true], [0.11, 0.07], [0.085, 0.1], [0.09, 0.16], [0.13, 0.32], [0.135, 0.42],
    [0.1, 0.55], [0.06, 0.66], [0.055, 0.74], [0.08, 0.8], [0.1, 0.86], [0.1, 0.93, 0, 0, true], [0.12, 0.94], [0.12, 1.0], [0.0, 1.0],
  ], segs, { aux: [0.1, 0, 0.2, 0] });
  _balGeo = mb.geometry();
  return _balGeo;
}
/**
 * Balustrade along local x at z = zc: plinth, balusters (instanced), handrail. Gaps (sunken) via o.broken(x) → true.
 * Returns posts x positions.
 */
export function balustradeX(kit, x0, x1, y, zc, o = {}) {
  const mb = kit.mb.white;
  const h = o.h ?? 1.25, dep = o.depth ?? 0.5, plinthH = o.plinth ?? 0.24, railH = o.rail ?? 0.2;
  const sp = o.spacing ?? 0.34;
  const L = x1 - x0;
  if (L < 0.4) return;
  const nSeg = Math.max(1, Math.round(L / (o.post ?? 3.2)));
  const segL = L / nSeg;
  const pw = o.postW ?? 0.42;
  for (let i = 0; i < nSeg; i++) {
    const a = x0 + i * segL, b = a + segL;
    const broken = o.broken ? o.broken(i, (a + b) / 2) : 0;   // 0 intact, 1 balusters gone, 2 all gone
    if (broken < 2) boxA(mb, a, y, zc - dep / 2, b, y + plinthH, zc + dep / 2, AUX.mould, 0.02);
    if (!broken) {
      const nb = Math.max(1, Math.floor((segL - pw) / sp));
      const bh = h - plinthH - railH;
      for (let k = 0; k < nb; k++) {
        const x = a + pw / 2 + (segL - pw) * ((k + 0.5) / nb);
        kit.inst.baluster.push(kit.imat(x, y + plinthH, zc, bh * 0.95, bh, bh * 0.95));
      }
      boxA(mb, a - 0.01, y + h - railH, zc - dep / 2 - 0.04, b + 0.01, y + h, zc + dep / 2 + 0.04, AUX.mould, 0.03);
    } else if (broken === 1 && kit.sunken) kit.coralAt((a + b) / 2, y + plinthH, zc, 0, 1, 0, 0.6, 'balustrade');
    // post at the start of each segment (and the end)
    if (broken < 2) boxA(mb, a - pw / 2, y, zc - dep / 2 - 0.06, a + pw / 2, y + h + (broken ? -0.4 : 0.06), zc + dep / 2 + 0.06, AUX.mould, 0.02);
    if (i === nSeg - 1 && broken < 2) boxA(mb, b - pw / 2, y, zc - dep / 2 - 0.06, b + pw / 2, y + h + 0.06, zc + dep / 2 + 0.06, AUX.mould, 0.02);
  }
}

/** pedestal (base, die, cap) centred at (x, y, z) local; returns top y */
export function pedestal(kit, x, y, z, w, h, o = {}) {
  const mb = kit.mb.white;
  const d = o.d ?? w;
  boxA(mb, x - w / 2 - 0.12, y, z - d / 2 - 0.12, x + w / 2 + 0.12, y + h * 0.16, z + d / 2 + 0.12, AUX.mould, 0.03);
  boxA(mb, x - w / 2, y + h * 0.16, z - d / 2, x + w / 2, y + h * 0.82, z + d / 2, AUX.ashlar(0.6), 0.025);
  boxA(mb, x - w / 2 - 0.14, y + h * 0.82, z - d / 2 - 0.14, x + w / 2 + 0.14, y + h, z + d / 2 + 0.14, AUX.mould, 0.03);
  if (o.panel !== false && w > 0.7) {
    // small gilt plaque on the front / back faces of the die
    for (const s of [-1, 1]) boxA(kit.mb.gilt, x - w * 0.3, y + h * 0.32, s > 0 ? z + d / 2 : z - d / 2 - 0.04, x + w * 0.3, y + h * 0.66, s > 0 ? z + d / 2 + 0.04 : z - d / 2, [0.3, 0, 0, 0]);
  }
  return y + h;
}

// ------------------------------------------------------------------------------------------------ gilt relief
/** relief height field on a panel (u across, v up, [0,1]); kind: figure | hippocamp | waves | trident */
export function reliefHeight(u, v, kind, seed, aspect) {
  const X = (u - 0.5) * aspect, Y = v;
  const cap = (px, py, ax, ay, bx, by, r) => {
    const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy + 1e-9), 0, 1);
    return Math.hypot(px - ax - dx * t, py - ay - dy * t) - r;
  };
  const sm = (a, b, k) => { const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); };
  const j = (k) => (hash3(seed * 13 + 7, k, 3) - 0.5);
  let d = 1;
  if (kind === 'figure') {
    const s = 0.5 + 0.06 * j(1), lean = 0.04 * j(2);
    const hx = lean, hy = 0.84;
    d = Math.hypot(X - hx, (Y - hy) * 0.9) - 0.065 * s * 2;                                     // head
    d = sm(d, Math.hypot(X - hx, Y - hy + 0.05) - 0.05, 0.03);                                   // beard
    d = sm(d, cap(X, Y, lean * 0.8, 0.76, 0, 0.47, 0.09), 0.05);                                 // torso
    d = sm(d, cap(X, Y, 0, 0.5, -0.07, 0.12, 0.045), 0.03);                                      // legs
    d = sm(d, cap(X, Y, 0, 0.5, 0.08 + 0.03 * j(3), 0.12, 0.045), 0.03);
    d = sm(d, cap(X, Y, 0.07, 0.72, 0.2, 0.86 + 0.04 * j(4), 0.03), 0.02);                       // raised arm
    d = sm(d, cap(X, Y, -0.07, 0.72, -0.17, 0.55, 0.03), 0.02);                                  // lowered arm
    d = Math.min(d, cap(X, Y, 0.22, 0.06, 0.22, 0.95, 0.012));                                   // trident shaft
    d = Math.min(d, cap(X, Y, 0.16, 0.9, 0.28, 0.9, 0.012));
    for (const px of [0.16, 0.22, 0.28]) d = Math.min(d, cap(X, Y, px, 0.9, px, 0.98, 0.011));
    const drape = 0.012 * Math.sin(X * 90 + Y * 40) * smooth(0.45, 0.25, Y) * smooth(0.25, 0.0, Math.abs(X));
    d = sm(d, cap(X, Y, -0.1, 0.42, 0.1, 0.42, 0.06) + drape, 0.05);                             // drapery skirt
    d = Math.min(d, (Y - 0.1) + 0.02 * Math.sin(X * 40 + seed));                                 // ground waves
  } else if (kind === 'hippocamp') {
    // rearing sea-horse: neck/head chain + coiled fish tail
    let pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const ang = 1.9 - t * 4.6;
      const rr = 0.32 - 0.22 * t;
      pts.push([0.05 + Math.cos(ang) * rr * aspect * 0.55 + (1 - t) * -0.08, 0.38 + Math.sin(ang) * rr * 0.9]);
    }
    d = Math.hypot(X - 0.06, Y - 0.78) - 0.07;                                                   // head
    d = sm(d, cap(X, Y, 0.06, 0.74, 0.0, 0.55, 0.075), 0.04);                                    // neck
    d = sm(d, cap(X, Y, 0.0, 0.55, -0.02, 0.4, 0.11), 0.05);                                     // chest
    d = Math.min(d, cap(X, Y, 0.04, 0.5, 0.18, 0.62, 0.025));                                    // forelegs
    d = Math.min(d, cap(X, Y, 0.0, 0.48, 0.14, 0.42, 0.025));
    for (let i = 0; i < pts.length - 1; i++) d = sm(d, cap(X, Y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0.075 * (1 - i / 16)), 0.03);
    d = Math.min(d, (Y - 0.08) + 0.025 * Math.sin(X * 30 + seed * 3));
  } else if (kind === 'waves') {
    const w = Y - 0.5 - 0.25 * Math.sin(X * 9 + seed) * 0.6;
    d = Math.abs(w) - 0.12 + 0.05 * Math.sin(X * 25);
  } else if (kind === 'trident') {
    d = cap(X, Y, 0, 0.08, 0, 0.82, 0.03);
    d = Math.min(d, cap(X, Y, -0.18, 0.72, 0.18, 0.72, 0.028));
    for (const px of [-0.18, 0, 0.18]) d = Math.min(d, cap(X, Y, px, 0.72, px, px === 0 ? 0.95 : 0.9, 0.026));
    d = Math.min(d, Math.hypot(X, Y - 0.62) - 0.06);
  }
  // bas-relief: crisp outline, flat-ish plateau with a rounded rim, incised inner contour lines + folds
  const inside = clamp(-d / 0.05, 0, 1);
  const body = smooth(0.005, -0.008, d) * (0.72 + 0.28 * Math.min(1, inside * 2.5));
  const contour = smooth(0.0045, 0.0015, Math.abs(d + 0.022)) * 0.35 + smooth(0.004, 0.001, Math.abs(d + 0.05)) * 0.25 * inside;
  const folds = (0.12 * Math.sin(X * 95 + Y * 31 + seed) * Math.sin(Y * 57 - X * 13) - contour) * inside;
  // background: low scrolling waves / foliage ornament so the whole field reads as worked gold
  const bgw = 0.5 + 0.5 * Math.sin(X * 26 + Math.sin(Y * 19 + seed) * 2.4) * Math.cos(Y * 22 - X * 7);
  const bg = 0.12 + 0.12 * smooth(0.55, 0.85, bgw) + 0.05 * fbm3(u * 22, v * 22 / aspect, seed, 2);
  // raised inner border bead
  const bx = Math.min(u, 1 - u) * aspect, by = Math.min(v, 1 - v);
  const bead = smooth(0.035, 0.015, Math.abs(Math.min(bx, by) - 0.03)) * 0.55;
  return clamp(Math.max(bg * (1 - body), body * (0.9 + folds)) + bead, 0, 1);
}
/**
 * Gilded relief panel on a face: local plane z = zf, facing f (±1), x range [x0, x1], y range [y0, y1].
 * Builds a white moulded frame + gilt displaced relief. o: { kind, seed, depth, nu, nv, frame }
 */
export function reliefPanelZ(kit, x0, x1, y0, y1, zf, f, o = {}) {
  const fr = o.frame ?? 0.4, fp = o.frameProj ?? 0.22;
  const w = kit.mb.white, g = kit.mb.relief;
  // frame
  const zA = f > 0 ? zf : zf - fp, zB = f > 0 ? zf + fp : zf;
  boxA(w, x0, y0, zA, x1, y0 + fr, zB, AUX.mould, 0.03);
  boxA(w, x0, y1 - fr, zA, x1, y1, zB, AUX.mould, 0.03);
  boxA(w, x0, y0 + fr, zA, x0 + fr, y1 - fr, zB, AUX.mould, 0.03);
  boxA(w, x1 - fr, y0 + fr, zA, x1, y1 - fr, zB, AUX.mould, 0.03);
  // relief field
  const W = x1 - x0 - 2 * fr, H = y1 - y0 - 2 * fr;
  const depth = o.depth ?? Math.min(0.45, W * 0.06);
  const det = kit.detail;
  const dens = o.density ?? 4.2;
  const nu = o.nu ?? Math.max(8, Math.round(W * dens * det)), nv = o.nv ?? Math.max(10, Math.round(H * dens * det));
  const kind = o.kind || 'figure', seed = o.seed ?? 1, asp = W / H;
  surface(g, (u, v, out) => {
    const h = reliefHeight(u, v, kind, seed, asp);
    out[0] = x0 + fr + u * W; out[1] = y0 + fr + v * H; out[2] = zf + f * (0.02 + h * depth);
  }, nu, nv, { flip: f < 0, aux: (u, v) => [0.38 * (1 - reliefHeight(u, v, kind, seed, asp)), 0, 0, 0] });
  // (surface normal convention: +z for f > 0)
}

/** round medallion (rosette) on a face z = zf facing f: white torus ring + gilt rosette */
export function medallionZ(kit, x, y, zf, f, R, seed = 1) {
  const w = kit.mb.white, g = kit.mb.relief;
  const segs = Math.max(16, Math.round(32 * kit.detail));
  w.push(); w.translate(x, y, zf); w.rotateX(f > 0 ? PI / 2 : -PI / 2);
  // lathe around local +Y (= face normal after rotation)
  lathe(w, [[R * 0.78, 0.0], [R, 0.0, 0, 0, true], [R, 0.12], [R * 0.96, 0.2], [R * 0.86, 0.22], [R * 0.8, 0.16], [R * 0.78, 0.05]], segs, { aux: AUX.mould });
  w.pop();
  g.push(); g.translate(x, y, zf); g.rotateX(f > 0 ? PI / 2 : -PI / 2);
  surface(g, (u, v, o) => {
    const a = u * 2 * PI, r = v * R * 0.8;
    const petal = 0.5 + 0.5 * Math.cos(a * 8 + seed);
    const hgt = (0.05 + 0.18 * (1 - v) * (0.5 + 0.5 * petal) + 0.06 * Math.max(0, 1 - v * 5)) * R;
    o[0] = Math.sin(a) * r; o[1] = hgt; o[2] = Math.cos(a) * r;
  }, segs, 6, { closedU: true, flip: true, aux: (u, v) => [0.4 * v, 0, 0, 0] });
  g.pop();
}

// ------------------------------------------------------------------------------------------------ gold pieces
/** 3D trident (gold) standing at (x, y, z), height h, its plane facing local z rotated by ry */
export function trident(mb, x, y, z, h, ry = 0, broken = 0) {
  mb.push(); mb.translate(x, y, z); mb.rotateY(ry);
  const r = h * 0.028;
  const top = broken ? h * 0.55 : h;
  lathe(mb, [[0, 0], [r * 2.2, 0, 0, 0, true], [r * 2.2, h * 0.05], [r * 1.2, h * 0.08], [r, h * 0.1], [r, top * 0.62], [r * 2.4, top * 0.64], [r * 2.4, top * 0.68], [r, top * 0.7], [r, top * 0.76], [0, top * 0.76]], 8, { aux: [0.1, 0, 0, 0] });
  if (!broken) {
    const yb = h * 0.74, wd = h * 0.24;
    for (const s of [-1, 1]) {
      tube(mb, (t, o) => {
        const a = t * PI * 0.5;
        o[0] = s * wd * Math.sin(a) * (1 + 0.15 * t); o[1] = yb + h * 0.03 + (1 - Math.cos(a)) * h * 0.08 + t * t * h * 0.12; o[2] = 0;
      }, r * 0.85, 8, 6);
      // side prong up to its tip
      tube(mb, (t, o) => { o[0] = s * wd * 1.15; o[1] = yb + h * 0.03 + h * 0.2 + t * h * 0.02; o[2] = 0; }, r * 0.85, 1, 6);
      tine(mb, s * wd * 1.15, yb + h * 0.23, h * 0.14, r, s);
    }
    lathe(mb, [[r, yb], [r, h * 0.86], [0, h * 0.86]], 6);
    tine(mb, 0, h * 0.85, h * 0.15, r, 0);
  }
  mb.pop();
}
function tine(mb, x, y, L, r, s) {
  // pointed tip with barbs
  mb.push(); mb.translate(x, y, 0);
  lathe(mb, [[r * 1.4, 0], [r * 2.6, L * 0.2], [r * 1.6, L * 0.45], [0, L]], 6, { capBottom: true });
  for (const b of [-1, 1]) {
    if (s && b !== s) continue;
    tube(mb, (t, o) => { o[0] = b * (r * 1.8 + t * L * 0.22); o[1] = L * 0.28 - t * L * 0.25; o[2] = 0; }, (t) => r * (0.9 - 0.75 * t), 3, 5);
  }
  mb.pop();
}
/** gold finial urn with flame-like lid (acroterion), base at (x, y, z) local, height h */
export function urnFinial(mb, x, y, z, h, segs = 12) {
  mb.push(); mb.translate(x, y, z);
  lathe(mb, [[0, 0], [0.3 * h, 0, 0, 0, true], [0.3 * h, 0.06 * h], [0.14 * h, 0.12 * h], [0.12 * h, 0.2 * h], [0.32 * h, 0.36 * h], [0.36 * h, 0.5 * h],
    [0.3 * h, 0.6 * h], [0.18 * h, 0.66 * h, 0, 0, true], [0.24 * h, 0.7 * h], [0.12 * h, 0.82 * h], [0.06 * h, 0.92 * h], [0, h]], segs, { aux: [0.2, 0, 0, 0] });
  mb.pop();
}

// ------------------------------------------------------------------------------------------------ columns
let _colGeo = null, _capGeo = null, _baseGeo = null;
/** unit column parts (height 1 of the SHAFT, diameter D = 0.13 of height): shaft white, capital + base gold */
export function columnParts(detail = 1) {
  if (_colGeo) return { shaft: _colGeo, capital: _capGeo, base: _baseGeo };
  const segs = detail >= 0.75 ? 14 : 10;
  const R = 0.065;
  let mb = new MeshBuilder();
  const prof = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push([R * (1 - 0.14 * t + 0.03 * Math.sin(t * PI)), t, 0, 0]); }
  lathe(mb, prof, segs, { aux: [0, 0, 0.3, 1.0] });
  _colGeo = mb.geometry();
  mb = new MeshBuilder();
  // aeolic / ionic-ish capital: necking ring, flaring bell, abacus
  lathe(mb, [[R * 0.88, 0], [R * 1.02, 0.012], [R * 0.92, 0.03], [R * 1.25, 0.07], [R * 1.55, 0.1, 0, 0, true], [R * 1.55, 0.115], [R * 1.4, 0.125, 0, 0, true], [R * 1.65, 0.125], [R * 1.65, 0.15], [0, 0.15]], segs, { aux: [0.3, 0, 0, 0] });
  // volutes as two small tubes
  for (const s of [-1, 1]) tube(mb, (t, o) => { const a = t * PI * 2.2; const rr = R * 0.38 * (1 - t * 0.6); o[0] = s * (R * 1.35 + Math.cos(a) * rr * 0.4); o[1] = 0.09 - Math.sin(a) * rr; o[2] = 0; }, R * 0.12, 10, 5);
  _capGeo = mb.geometry();
  mb = new MeshBuilder();
  lathe(mb, [[0, 0], [R * 1.5, 0, 0, 0, true], [R * 1.5, 0.03], [R * 1.4, 0.035], [R * 1.42, 0.05], [R * 1.15, 0.065], [R * 1.1, 0.075], [R * 1.25, 0.085], [R * 1.0, 0.1]], segs, { aux: [0.2, 0, 0, 0] });
  _baseGeo = mb.geometry();
  return { shaft: _colGeo, capital: _capGeo, base: _baseGeo };
}
/** place a column of height H (shaft) at local (x, y, z) via instancing (scale = H) */
export function column(kit, x, y, z, H, ry = 0) {
  kit.inst.colbase.push(kit.imat(x, y, z, H, H, H, ry));
  kit.inst.column.push(kit.imat(x, y + H * 0.1, z, H, H * 0.75, H, ry));
  kit.inst.capital.push(kit.imat(x, y + H * 0.85, z, H, H, H, ry));
}

/**
 * Tholos top: stepped circular podium, ring of columns with gold capitals, inner cella, entablature with
 * gilt frieze, gold ribbed dome, knob and trident finial. Centre (cx, y, cz) local, radius R (podium).
 * o: { n, colH, dome, trident, fallen, missing(i) } — returns the tip height.
 */
export function tholosTop(kit, cx, y, cz, R, o = {}) {
  const w = kit.mb.white, g = kit.mb.gold, gl = kit.mb.gilt;
  const det = kit.detail;
  const segs = Math.max(20, Math.round(40 * det * Math.min(1.5, R / 6)));
  const n = o.n ?? 12;
  const colH = o.colH ?? R * 0.62;
  const stepH = R * (o.stepF ?? 0.045), nSteps = 3;
  if (o.drumH) {
    // round drum under the stepped stylobate (ref 2): base moulding, ashlar wall, gilt band, cornice
    const dh = o.drumH, rd = R + 0.25;
    w.push(); w.translate(cx, y, cz);
    lathe(w, [[rd + 0.35, 0, 0.2, 0, true], [rd + 0.35, 0.22], [rd + 0.1, 0.32, 0, 0, true], [rd, 0.32], [rd, dh - 0.3, 0, 0, true], [rd + 0.15, dh - 0.25], [rd + 0.35, dh, 0, 0, true], [0, dh]], segs, { aux: [0, 0, 0.3, 3.06] });
    w.pop();
    gl.push(); gl.translate(cx, y, cz);
    lathe(gl, [[rd + 0.02, dh * 0.55], [rd + 0.06, dh * 0.6], [rd + 0.06, dh * 0.72], [rd + 0.02, dh * 0.77]], segs, { aux: [0.3, 0, 0, 0] });
    gl.pop();
    y += dh;
  }
  w.push(); w.translate(cx, y, cz);
  const prof = [[R + 0.2, -0.3, 0.3, 0, true]];
  for (let k = 0; k < nSteps; k++) {
    const r = R - k * R * 0.05;
    prof.push([r, k * stepH, 0, 0, true], [r, (k + 1) * stepH - 0.02, 0, 0.8], [r - 0.03, (k + 1) * stepH, 0, 0.8, true]);
  }
  const yS = nSteps * stepH;
  prof.push([0, yS]);
  lathe(w, prof, segs, { aux: AUX.mould });
  w.pop();
  const Rc = R * 0.82;
  const yc = y + yS;
  for (let i = 0; i < n; i++) {
    if (o.missing && o.missing(i)) continue;
    const a = ((i + 0.5) / n) * 2 * PI;
    column(kit, cx + Math.sin(a) * Rc, yc, cz + Math.cos(a) * Rc, colH / 1.0, a);
  }
  // inner cella (dark-ish recess reads through the colonnade)
  const dk = kit.mb.dark;
  dk.push(); dk.translate(cx, yc, cz);
  lathe(dk, [[R * 0.52, 0], [R * 0.52, colH * 0.98]], segs, { aux: [0.6, 0, 0.2, 3.09] });
  dk.pop();
  // entablature (architrave, gilt frieze, cornice) over the columns
  const yE = yc + colH * 1.0;
  const rA = Rc + R * 0.09, rI = Rc - R * 0.1;
  const ef = o.entF ?? 1;
  const hA = R * 0.075 * ef, hF = R * 0.08 * ef, hC = R * 0.07 * ef;
  w.push(); w.translate(cx, yE, cz);
  lathe(w, [[rI, 0], [rA, 0, 0, 0, true], [rA, hA * 0.45], [rA + 0.04, hA * 0.5], [rA + 0.04, hA, 0, 0, true]], segs, { aux: AUX.mould });
  lathe(w, [[rA + 0.04, hA + hF, 0, 0, true], [rA + 0.1, hA + hF + hC * 0.2], [rA + R * 0.06, hA + hF + hC * 0.6], [rA + R * 0.075, hA + hF + hC, 0, 0, true], [rI, hA + hF + hC]], segs, { aux: AUX.mould });
  // soffit under the architrave ring and inner face
  lathe(w, [[rI, hA + hF + hC], [rI, 0]], segs, { aux: AUX.cav });
  w.pop();
  gl.push(); gl.translate(cx, yE, cz);
  lathe(gl, [[rA - 0.02, hA, 0, 0, true], [rA + 0.03, hA + hF * 0.15], [rA + 0.03, hA + hF * 0.85], [rA - 0.02, hA + hF, 0, 0, true]], segs, { aux: [0.35, 0, 0, 0] });
  gl.pop();
  const yD = yE + hA + hF + hC;
  // small gold pinnacles around the cornice (ref 2)
  const nP = Math.max(8, Math.round(n * 1.33));
  for (let i = 0; i < nP; i++) {
    const a = (i / nP) * 2 * PI;
    urnFinial(g, cx + Math.sin(a) * (rA + R * 0.04), yD, cz + Math.cos(a) * (rA + R * 0.04), R * 0.11, 6);
  }
  if (o.fallen) return yD;
  // ribbed gold dome
  const Rd = rA - R * 0.02, Hd = o.domeH ?? R * 0.46;
  const nr = 16;
  g.push(); g.translate(cx, yD, cz);
  surface(g, (u, v, out) => {
    const a = u * 2 * PI, t = v * PI * 0.5;
    const rib = Math.pow(Math.abs(Math.cos(a * nr * 0.5)), 12) * 0.035 * Math.cos(t);
    const r = Rd * Math.cos(t) * (1 + rib) * (1 - 0.06 * Math.sin(t * 2));
    out[0] = Math.sin(a) * r; out[1] = Hd * Math.sin(t) + Hd * 0.06 * (1 - v); out[2] = Math.cos(a) * r;
  }, Math.max(32, Math.round(64 * det)), Math.max(8, Math.round(14 * det)), { closedU: true, aux: (u, v) => [0.1 * (1 - v), 0, 0, 0] });
  // base ring of the dome
  lathe(g, [[Rd * 1.02, 0], [Rd * 1.04, Hd * 0.04], [Rd * 1.0, Hd * 0.1]], segs, { aux: [0.2, 0, 0, 0] });
  // lantern knob + ball
  const yk = Hd * 1.04, kn = (o.knobF ?? 1) * R;
  lathe(g, [[R * 0.16, yk - 0.1], [R * 0.13, yk + kn * 0.04], [kn * 0.06, yk + kn * 0.1], [kn * 0.1, yk + kn * 0.14], [kn * 0.11, yk + kn * 0.2], [kn * 0.06, yk + kn * 0.26], [0, yk + kn * 0.28]], 12);
  g.pop();
  const yT = yD + yk + kn * 0.26;
  if (o.trident !== false) trident(g, cx, yT, cz, o.tridentH ?? R * 0.6, o.tridentRy ?? 0, o.tridentBroken ? 1 : 0);
  return yT + (o.tridentH ?? R * 0.6);
}

/** build the kit into meshes; materials = { white, red, banded, black, lime, gold, gilt, dark } */
export function finalizeKit(kit, mats, group, name) {
  let tris = 0;
  for (const k of BUCKETS) {
    const mb = kit.mb[k];
    if (mb.empty) continue;
    const mesh = new THREE.Mesh(mb.geometry(), mats[k]);
    mesh.name = `${name}-${k}`;
    tris += mb.triangles;
    group.add(mesh);
  }
  const parts = columnParts(kit.detail);
  const inst = [['baluster', balusterGeometry(kit.detail), mats.white], ['column', parts.shaft, mats.white], ['capital', parts.capital, mats.gold], ['colbase', parts.base, mats.white]];
  for (const [k, geo, mat] of inst) {
    const list = kit.inst[k];
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    for (let i = 0; i < list.length; i++) im.setMatrixAt(i, list[i]);
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere(); im.computeBoundingBox?.();
    im.name = `${name}-${k}`;
    tris += (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3) * list.length;
    group.add(im);
  }
  return tris;
}
export { MeshBuilder, box, lathe, surface, tube, quadOut, triOut, hash3, vnoise3, fbm3, clamp, smooth };
