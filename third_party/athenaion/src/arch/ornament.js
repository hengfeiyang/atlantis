// Ornament: antefixes, palmette acroteria, sculpted griffin / sphinx corner acroteria (SDF),
// rosettes, laurel wreaths, round shields, gilded frieze plaques, egg-and-dart strips.
// All builders write into a MeshBuilder at its current transform; local frame: base at y = 0,
// ornament faces +Z unless noted.
import * as THREE from 'three';
import { MeshBuilder, extrudeOutline, ellipsoid, surface, box, boxC, lathe, tube, lerp, clamp, smooth } from './geom.js';
import { leaf } from './acanthus.js';
import { meshSDF, sd } from '../sculpt/mesher.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** palmette outline (fan of lobes above a pair of small volutes), height h, as CCW [x,y] list */
export function palmetteOutline(h, lobes = 9, n = 120) {
  const pts = [];
  const cy = h * 0.32;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = lerp(-0.15 * Math.PI, 1.15 * Math.PI, t); // from right going over the top to left
    const lob = Math.pow(Math.abs(Math.cos(((a - Math.PI / 2) * lobes) / 2.3)), 0.6);
    const fan = smooth(-0.1 * Math.PI, 0.1 * Math.PI, a) * smooth(1.1 * Math.PI, 0.9 * Math.PI, a);
    const r = h * (0.36 + 0.32 * lob) * (0.55 + 0.45 * fan) * (0.82 + 0.18 * Math.sin(a));
    pts.push([Math.cos(a) * r * 0.9, cy + Math.sin(a) * r]);
  }
  // base: two volute bumps and a stem
  pts.push([-h * 0.3, h * 0.12], [-h * 0.22, h * 0.02], [-h * 0.08, h * 0.0], [h * 0.08, h * 0.0], [h * 0.22, h * 0.02], [h * 0.3, h * 0.12]);
  // ensure CCW
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; area += x0 * y1 - x1 * y0; }
  return area < 0 ? pts.reverse() : pts;
}

const _tpl = new Map();
/** cached template builder: key → MeshBuilder built once by fn(mb) */
export function template(key, fn) {
  let t = _tpl.get(key);
  if (!t) { t = new MeshBuilder(); fn(t); _tpl.set(key, t); }
  return t;
}

/** flat antefix (palmette) of height h, thickness t, on the +Z face (cached template, merged) */
export function antefix(mb, h, t = null, detail = 1) {
  const th = t ?? h * 0.08;
  const tpl = template('antefix:' + h.toFixed(3) + ':' + th.toFixed(3) + ':' + (detail > 0.7), (m) => {
    extrudeOutline(m, palmetteOutline(h, 7, detail > 0.7 ? 44 : 26), th, { aux: [0.15, 0.2, 0.3, 0], auxSide: [0.3, 0.6, 0.2, 0], back: false });
    if (detail > 0.7) for (let i = 0; i < 5; i++) {
      const a = lerp(0.18 * Math.PI, 0.82 * Math.PI, i / 4);
      m.push(); m.translate(0, h * 0.32, th); m.rotateZ(a - Math.PI / 2); m.translate(0, h * 0.26, 0);
      ellipsoid(m, h * 0.05, h * 0.19, h * 0.025, 5, 4, [0.2, 0.3, 0.2, 0]);
      m.pop();
    }
  });
  mb.merge(tpl);
}

/** ribbon spiral helper in the XY plane (z = depth), used by palmettes / lyres */
function spiralRibbon(mb, cx, cy, z, r0, turns, k, dir, width, thick, n = 40, start = Math.PI / 2) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * turns * Math.PI * 2;
    const r = r0 * Math.exp(-k * d);
    const a = start - dir * d;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
  }
  tube(mb, (t, o) => { const f = t * n, i = Math.min(n - 1, Math.floor(f)), q = f - i; for (let c = 0; c < 3; c++) o[c] = lerp(pts[i][c], pts[i + 1][c], q); },
    (t) => thick * (1 - 0.5 * t) + width * 0, n, 6, { aux: [0.15, 0.3, 0.2, 0] });
  return pts;
}

/**
 * Central acroterion: gilded palmette with lyre volutes and acanthus base. Height ≈ h. Faces +Z.
 */
export function palmetteAcroterion(mb, h, o = {}) {
  const detail = o.detail ?? 1;
  const nv = detail > 0.6 ? 26 : 14, nu = detail > 0.6 ? 6 : 4;
  // plinth
  box(mb, [-h * 0.22, 0, -h * 0.12], [h * 0.22, h * 0.08, h * 0.12], h * 0.01, [0.1, 0.4, 0.3, 0]);
  const y0 = h * 0.08;
  // acanthus base leaves (3 front, 2 back-sides)
  for (let i = -2; i <= 2; i++) {
    const a = i * 0.45;
    const N = V3(Math.sin(a), 0, Math.cos(a));
    leaf(mb, { O: V3(Math.sin(a) * h * 0.08, y0, Math.cos(a) * h * 0.06), U: V3(0, 1, 0), N, length: h * 0.3, width: h * 0.17, lean: 0.25, curl: 2.2, curlStart: 0.6, nu, nv, cup: h * 0.02, rib: h * 0.008, thick: h * 0.012, back: detail > 0.6, rims: false, serrAmp: 0.1 });
  }
  // lyre: two large opposed spirals
  for (const s of [-1, 1]) {
    spiralRibbon(mb, s * h * 0.15, y0 + h * 0.3, 0, h * 0.16, 1.4, 0.32, -s, h * 0.03, h * 0.028, detail > 0.6 ? 48 : 24, -Math.PI / 2 + (s > 0 ? 0 : Math.PI));
  }
  // fan of palmette petals
  const nP = 9;
  for (let i = 0; i < nP; i++) {
    const a = lerp(-1.15, 1.15, i / (nP - 1));
    const U = V3(Math.sin(a), Math.cos(a), 0);
    const N = V3(0, 0, 1);
    const L = h * (0.5 + 0.18 * Math.cos(a * 1.3));
    leaf(mb, { O: V3(0, y0 + h * 0.36, 0.01 * h), U, N, length: L, width: h * 0.11, lean: 0.05, curl: 0.6 * Math.sign(a || 0.001) * 0 + 0.5, curlStart: 0.75, nu: Math.max(3, nu - 1), nv: Math.max(10, nv - 6), lobes: [], serr: 1, serrAmp: 0, cup: -h * 0.012, rib: h * 0.01, thick: h * 0.015, back: detail > 0.6, rims: false, bend: -0.25 * Math.sign(a) * 0 });
  }
  // central bud
  mb.push(); mb.translate(0, y0 + h * 0.36, h * 0.03); ellipsoid(mb, h * 0.05, h * 0.08, h * 0.04, 10, 7, [0.1, 0.4, 0.2, 0]); mb.pop();
}

// ------------------------------------------------------------------------- SDF figures
const _sdfCache = new Map();
/**
 * Seated griffin (lion body, eagle head, raised sickle wings) — corner acroterion. Faces +Z, size = height.
 * Returns a BufferGeometry (cached per size/detail).
 */
export function griffinGeometry(size, detail = 1) {
  const key = `griffin:${size.toFixed(3)}:${detail}`;
  if (_sdfCache.has(key)) return _sdfCache.get(key);
  const s = size;
  const f = (x, y, z) => {
    // normalise to unit height
    x /= s; y /= s; z /= s;
    const ax = Math.abs(x);
    let d = sd.roundBox(x, y - 0.05, z, 0.16, 0.05, 0.3, 0.02); // plinth
    // haunches & body (sitting): torso inclined
    const body = sd.capsule(x, y, z, 0, 0.22, -0.12, 0, 0.45, 0.06, 0.13);
    const haunch = sd.capsule(ax, y, z, 0.09, 0.18, -0.16, 0.09, 0.2, 0.02, 0.085);
    const chest = sd.capsule(x, y, z, 0, 0.42, 0.08, 0, 0.56, 0.12, 0.09);
    // front legs
    const legs = sd.capsule(ax, y, z, 0.07, 0.42, 0.14, 0.07, 0.1, 0.2, 0.035);
    const paws = sd.capsule(ax, y, z, 0.07, 0.11, 0.21, 0.07, 0.11, 0.28, 0.03);
    // neck + head + beak + ears
    const neck = sd.capsule(x, y, z, 0, 0.55, 0.12, 0, 0.7, 0.18, 0.065);
    const head = sd.capsule(x, y, z, 0, 0.74, 0.17, 0, 0.75, 0.24, 0.06);
    const beak = sd.roundCone(x, y, z, 0, 0.74, 0.27, 0, 0.69, 0.35, 0.035, 0.006);
    const ears = sd.roundCone(ax, y, z, 0.035, 0.79, 0.15, 0.06, 0.92, 0.1, 0.02, 0.004);
    // wings: thin curved sheets rising behind, sickle shaped
    const wy = y - 0.45, wz = z + 0.08;
    const wingCurve = sd.capsule(ax, y, z, 0.12, 0.5, -0.05, 0.22, 0.95, -0.2, 0.06);
    const wingSheet = Math.max(wingCurve, Math.abs(ax - 0.12 - (wy) * 0.18) - 0.02);
    const feathers = wingSheet + 0.012 * Math.sin((y * 60) + ax * 20) * smooth(0.5, 0.9, y);
    void wz;
    // tail
    const tail = sd.capsule(x, y, z, 0.0, 0.14, -0.26, 0.05, 0.3, -0.4, 0.025);
    let g = Math.min(body, haunch, chest, legs, paws, neck, head, beak, ears, feathers, tail);
    // smooth blend body parts
    g = Math.min(g, sd.capsule(x, y, z, 0, 0.3, -0.1, 0, 0.5, 0.1, 0.12) + 0.01);
    d = Math.min(d, g);
    return d * s;
  };
  const cell = s * (detail >= 0.75 ? 0.017 : detail >= 0.4 ? 0.024 : 0.035);
  const geo = meshSDF(f, { min: [-0.4 * s, 0, -0.5 * s], max: [0.4 * s, 1.05 * s, 0.45 * s], cell, smooth: 1 });
  _sdfCache.set(key, geo);
  return geo;
}

/**
 * Winged Nike / victory figure for the apex (gilded): standing draped figure with spread wings.
 * Faces +Z, size = height.
 */
export function victoryGeometry(size, detail = 1) {
  const key = `nike:${size.toFixed(3)}:${detail}`;
  if (_sdfCache.has(key)) return _sdfCache.get(key);
  const s = size;
  const f = (x, y, z) => {
    x /= s; y /= s; z /= s;
    const ax = Math.abs(x);
    let d = sd.roundBox(x, y - 0.03, z, 0.14, 0.03, 0.12, 0.01);
    // drapery: a flared cone with vertical folds
    const r = lerp(0.13, 0.075, clamp((y - 0.05) / 0.5, 0, 1));
    const fold = 0.012 * Math.sin(Math.atan2(x, z) * 9 + y * 4);
    const dress = Math.max(Math.hypot(x, z * 1.2) - r - fold, Math.max(0.05 - y, y - 0.58));
    const torso = sd.capsule(x, y, z, 0, 0.55, 0, 0, 0.72, 0.01, 0.07);
    const head = sd.sphere(x, y - 0.81, z - 0.01, 0.055);
    const arms = sd.capsule(ax, y, z, 0.07, 0.7, 0.0, 0.17, 0.8, 0.06, 0.022);
    // wings: large, rising and spreading
    // raised, half-open wings: a compact flame-like silhouette that reads as a gilded figure at distance (ref 5 apex)
    const wing = Math.max(sd.capsule(ax, y, z, 0.06, 0.62, -0.06, 0.25, 1.1, -0.14, 0.11), Math.abs(z + 0.08 + 0.12 * (ax - 0.06)) - 0.024);
    const feath = wing + 0.01 * Math.sin(ax * 70) * smooth(0.15, 0.3, ax);
    d = Math.min(d, dress, torso, head, arms, feath);
    return d * s;
  };
  const cell = s * (detail >= 0.75 ? 0.015 : detail >= 0.4 ? 0.022 : 0.032);
  const geo = meshSDF(f, { min: [-0.5 * s, 0, -0.3 * s], max: [0.5 * s, 1.05 * s, 0.3 * s], cell, smooth: 1 });
  _sdfCache.set(key, geo);
  return geo;
}

// ------------------------------------------------------------------------- small ornaments
/** rosette (flower) facing +Z: petals around a centre; r = radius */
export function rosette(mb, r, petals = 8, o = {}) {
  const depth = o.depth ?? r * 0.25;
  const nA = o.detail === 'low' ? 24 : 64, nR = o.detail === 'low' ? 5 : 10;
  surface(mb, (u, v, out) => {
    const a = u * Math.PI * 2, rr = v * r;
    const pet = Math.pow(Math.abs(Math.cos((a * petals) / 2)), 0.8);
    const edge = r * (0.72 + 0.28 * pet);
    const inside = smooth(edge, edge * 0.92, rr);
    const h = depth * (inside * (0.55 + 0.45 * pet) * Math.sin(Math.min(1, rr / edge) * Math.PI * 0.9)
      + 0.9 * Math.max(0, 1 - rr / (r * 0.18)) + 0.2 * Math.sin((rr / r) * Math.PI * 2 * 2) * inside);
    out[0] = Math.cos(a) * rr; out[1] = Math.sin(a) * rr; out[2] = h;
  }, nA, nR, { closedU: true, flip: true, aux: (u, v) => { const a = u * Math.PI * 2; const pet = Math.pow(Math.abs(Math.cos((a * petals) / 2)), 0.8); return [0.5 * (1 - pet) * v, 0.2, 0.1, 0]; } });
}

/** laurel wreath relief facing +Z (ring of leaf pairs + tie ribbon) */
export function wreath(mb, R, o = {}) {
  const n = o.leaves ?? 26;
  const lw = R * 0.11, ll = R * 0.3;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const a = -Math.PI / 2 + 0.25 + t * (Math.PI * 2 - 0.5);
    for (const side of [-1, 1]) {
      mb.push();
      mb.translate(Math.cos(a) * R, Math.sin(a) * R, 0);
      mb.rotateZ(a + Math.PI / 2 + side * 0.55 + (t < 0.5 ? 0 : 0));
      mb.translate(0, ll * 0.45, ll * 0.06);
      ellipsoid(mb, lw * 0.5, ll * 0.5, lw * 0.22, 6, 5, [0.25, 0.3, 0.1, 0]);
      mb.pop();
    }
  }
  // stem ring
  tube(mb, (t, o2) => { const a = -Math.PI / 2 + 0.25 + t * (Math.PI * 2 - 0.5); o2[0] = Math.cos(a) * R; o2[1] = Math.sin(a) * R; o2[2] = 0; }, R * 0.025, 48, 5, { aux: [0.3, 0, 0.1, 0] });
  // ribbon tie at the bottom
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * R * 0.12, -R * 1.02, R * 0.02); mb.rotateZ(s * 0.5); ellipsoid(mb, R * 0.06, R * 0.16, R * 0.02, 6, 5, [0.2, 0.2, 0.1, 0]); mb.pop();
  }
}

/** round shield with rim and boss, facing +Z */
export function shield(mb, R, o = {}) {
  const segs = o.segs ?? 40;
  const pr = o.simple ? [[R * 0.95, 0, 0.1, 0, true], [R, R * 0.06, 0, 0.6], [R * 0.86, R * 0.09, 0.4, 0, true]] : [[0.0001, 0, 0, 0], [R * 0.95, 0, 0.1, 0, true], [R, R * 0.05, 0, 0.6], [R * 0.97, R * 0.1, 0.2, 0.5], [R * 0.88, R * 0.08, 0.4, 0, true]];
  const nb = o.simple ? 3 : 6;
  for (let i = 0; i <= nb; i++) { const t = i / nb; pr.push([lerp(R * 0.85, R * 0.2, t), R * 0.08 + R * 0.06 * Math.sin(t * Math.PI / 2), 0.05, 0]); }
  pr.push([R * 0.18, R * 0.15, 0.3, 0, true]);
  const nc = o.simple ? 2 : 5;
  for (let i = 0; i <= nc; i++) { const a = (i / nc) * Math.PI / 2; pr.push([R * 0.18 * Math.cos(a), R * 0.15 + R * 0.12 * Math.sin(a), 0, 0.3]); }
  mb.push(); mb.rotateX(Math.PI / 2); lathe(mb, pr, segs, {}); mb.pop();
}

/**
 * Gilded frieze plaque (replaces a triglyph face): raised frame, recessed field, oval medallion.
 * w × h, front face at z = 0 (+Z out). Writes into the gold builder.
 */
export function plaque(mbG, w, h, o = {}) {
  const dz0 = o.depth ?? 0.05;
  const key = w.toFixed(3) + ':' + h.toFixed(3) + ':' + dz0;
  mbG.merge(template('plaqueG:' + key, (m) => plaqueRaw(m, null, w, h, o)));
  // dark bronze field behind (two-tone like ref 5); falls back to gold if no field builder given
  const field = o.field || mbG;
  field.merge(template('plaqueF:' + key, (m) => plaqueField(m, w, h, o)), mbG === field ? null : field.m.clone().invert().multiply(mbG.m));
}
function plaqueField(m, w, h, o = {}) {
  const fr = Math.min(w, h) * 0.12, dz = o.depth ?? 0.05;
  box(m, [-w / 2 + fr, fr, -dz], [w / 2 - fr, h - fr, -0.012], 0, [0.55, 0, 0.2, 0]);
}
function plaqueRaw(mbG, _f, w, h, o = {}) {
  const fr = Math.min(w, h) * 0.1, dz = o.depth ?? 0.05;
  const a = [0.25, 0.4, 0.2, 0];
  // stepped outer frame (two fasciae) — crisp shadow lines that read at 4K
  box(mbG, [-w / 2, 0, -dz], [w / 2, fr, 0.02], 0.008, a);
  box(mbG, [-w / 2, h - fr, -dz], [w / 2, h, 0.02], 0.008, a);
  box(mbG, [-w / 2, fr, -dz], [-w / 2 + fr, h - fr, 0.02], 0.008, a);
  box(mbG, [w / 2 - fr, fr, -dz], [w / 2, h - fr, 0.02], 0.008, a);
  const f2 = fr * 0.45;
  box(mbG, [-w / 2 + fr, fr, -dz], [-w / 2 + fr + f2, h - fr, 0.0], 0.004, [0.35, 0.3, 0.2, 0]);
  box(mbG, [w / 2 - fr - f2, fr, -dz], [w / 2 - fr, h - fr, 0.0], 0.004, [0.35, 0.3, 0.2, 0]);
  box(mbG, [-w / 2 + fr, fr, -dz], [w / 2 - fr, fr + f2, 0.0], 0.004, [0.35, 0.3, 0.2, 0]);
  box(mbG, [-w / 2 + fr, h - fr - f2, -dz], [w / 2 - fr, h - fr, 0.0], 0.004, [0.35, 0.3, 0.2, 0]);
  // oval medallion: moulded ring + relief owl of Athena inside (ref 5: gilded medallions with figures)
  const R = Math.min(w * 0.33, h * 0.27), ry = 1.3;
  mbG.push(); mbG.translate(0, h / 2, -0.012);
  tube(mbG, (t, out) => { const an = t * Math.PI * 2; out[0] = Math.cos(an) * R; out[1] = Math.sin(an) * R * ry; out[2] = 0.006; }, R * 0.085, 28, 5, { aux: [0.3, 0.6, 0.1, 0] });
  // small laurel sprigs left and right under the ring
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    const an = -Math.PI / 2 + s * (0.35 + i * 0.32);
    mbG.push(); mbG.translate(Math.cos(an) * R * 1.0, Math.sin(an) * R * ry * 1.0, 0.012); mbG.rotateZ(an + (s > 0 ? 0.6 : Math.PI - 0.6));
    ellipsoid(mbG, R * 0.06, R * 0.16, R * 0.03, 4, 3, [0.2, 0.3, 0.1, 0]); mbG.pop();
  }
  owlRelief(mbG, R * 1.75, -R * ry * 0.8);
  mbG.pop();
}

/** small relief owl (Athena's owl, frontal) of height s whose feet stand at y = y0, facing +Z */
export function owlRelief(mb, s, y0 = 0) {
  const A = [0.2, 0.35, 0.1, 0];
  const E = (x, y, z, rx, ryy, rz, rot = 0, nu = 8, nv = 5, aux = A) => { mb.push(); mb.translate(x * s, y0 + y * s, z * s); if (rot) mb.rotateZ(rot); ellipsoid(mb, rx * s, ryy * s, rz * s, nu, nv, aux); mb.pop(); };
  E(0, 0.36, 0.0, 0.25, 0.31, 0.1);                 // body
  for (const k of [-1, 1]) E(k * 0.19, 0.34, 0.03, 0.1, 0.27, 0.07, k * 0.12, 6, 5, [0.3, 0.4, 0.1, 0]); // folded wings
  E(0, 0.75, 0.01, 0.22, 0.17, 0.1);                // head
  for (const k of [-1, 1]) {
    E(k * 0.095, 0.77, 0.085, 0.075, 0.075, 0.03, 0, 8, 4, [0.1, 0.6, 0.1, 0]);  // eye discs
    E(k * 0.095, 0.77, 0.11, 0.032, 0.032, 0.02, 0, 5, 3, [0.6, 0.2, 0.1, 0]);    // pupils (dark cavity)
    E(k * 0.16, 0.9, 0.0, 0.035, 0.07, 0.03, -k * 0.5, 5, 4);                     // ear tufts
    E(k * 0.07, 0.03, 0.06, 0.05, 0.03, 0.03, 0, 6, 4);                            // talons
  }
  E(0, 0.69, 0.1, 0.025, 0.045, 0.025, 0, 5, 4);    // beak
  // chest feather rows (shallow chevrons)
  for (let r = 0; r < 3; r++) for (let c = -1; c <= (r % 2 ? 0 : 1); c++) E(c * 0.08 + (r % 2) * 0.04, 0.42 - r * 0.09, 0.085, 0.035, 0.022, 0.018, 0, 4, 3, [0.35, 0.3, 0.1, 0]);
  // perch
  mb.push(); mb.translate(0, y0, 0.02 * s); mb.rotateZ(Math.PI / 2); ellipsoid(mb, 0.025 * s, 0.32 * s, 0.025 * s, 6, 4, A); mb.pop();
}

/** egg-and-dart strip along +X of length L, height h, projecting along +Z (ovolo moulding) */
export function eggAndDart(mb, L, h, o = {}) {
  const nEgg = Math.max(2, Math.round(L / (h * 0.9)));
  const nU = nEgg * (o.detail === 'low' ? 4 : 8), nV = o.detail === 'low' ? 3 : 6;
  surface(mb, (u, v, out) => {
    const x = u * L;
    const k = (u * nEgg) % 1;
    const egg = Math.pow(Math.max(0, 1 - ((k - 0.5) / 0.38) ** 2), 0.6) * Math.sin(v * Math.PI);
    const prof = Math.sin(v * Math.PI * 0.5 + 0.2) * h * 0.45;
    out[0] = x; out[1] = v * h; out[2] = prof + egg * h * 0.18 - (1 - egg) * h * 0.05;
  }, nU, nV, { aux: (u) => { const k = (u * nEgg) % 1; return [(1 - Math.pow(Math.max(0, 1 - ((k - 0.5) / 0.38) ** 2), 0.5)) * 0.8, 0.1, 0.3, 0]; } });
}

export { MeshBuilder };
