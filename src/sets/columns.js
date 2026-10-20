// Banded red-white marble columns for the sets (ref 5 colonnade, ref 8 toppled columns): SDF shaft
// pieces (chips, cracks, broken ends — src/sets/ruinkit.js) with the red / white marble bands painted
// as vertex colours, navy-and-gold meander collars, gold Corinthian capitals (src/arch kit).
import * as THREE from 'three';
import { loadOrBuild } from '../core/cache.js';
import { buildDrum } from './ruinkit.js';
import { Simplex } from '../core/noise.js';
import { RED_TINT, bandedColumnMaterial, meanderBandMaterial, setGoldMaterial } from './materials.js';
import { capitalGeometry } from '../arch/ruins.js';
import { lathe, MeshBuilder } from '../arch/geom.js';

const NB = new Simplex(8812);
export const PIECE_GEN = 'c3'; // bump when the drum generator / band painting changes

/** paint red / white marble bands (vertex colours) along the local y axis of a drum geometry */
export function paintBands(geo, o = {}) {
  const pos = geo.attributes.position.array, n = pos.length / 3;
  const col = new Float32Array(n * 3);
  const bh = o.band ?? 1.1, ph = o.phase ?? 0, seed = o.seed ?? 0, redFrac = o.redFrac ?? 0.5;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const a = Math.atan2(z, x);
    const wob = 0.05 * Math.sin(a * 2 + seed * 3.1) + 0.035 * NB.noise3(x * 1.4 + seed, y * 0.8, z * 1.4);
    const t = (y + ph + wob) / bh;
    const f = t - Math.floor(t);
    // soft 1.5 cm transition
    const e = 0.015 / bh;
    const red = smooth(redFrac - e, redFrac + e, f) * 0 + (f < redFrac ? 1 : 0) * smooth(0, e, f) * smooth(redFrac, redFrac - e, f);
    const mott = 0.82 + 0.3 * (NB.noise3(x * 2.5 + 7, y * 2.5, z * 2.5 + seed) * 0.5 + 0.5);
    const r = 1 + (RED_TINT[0] * mott - 1) * red, g = 1 + (RED_TINT[1] * mott - 1) * red, b = 1 + (RED_TINT[2] * mott - 1) * red;
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/** drum spec → baked geometry (with bands) */
export async function drumPiece(spec, q) {
  const s = { taper: 0.01, flutes: 0, chips: 4, cracks: 1, ...spec };
  s.h = Math.round(s.h * 50) / 50; s.phase = Math.round((s.phase ?? 0) * 50) / 50; // stable bake names (ground heights move a little)
  const cell = (s.cell ?? Math.max(0.018, Math.min(0.04, s.r * 0.045))) * (q >= 1 ? 1 : 1.7);
  const name = `sets-drum-${s.seed}-${PIECE_GEN}-${hashSpec({ ...s, cell })}`;
  return loadOrBuild(name, () => paintBands(buildDrum({ ...s, cell }), { band: s.band ?? s.r * 1.7, phase: s.phase ?? 0, seed: s.bandSeed ?? 1 }));
}

/** a meander collar ring (open cylinder band with beaded rims), local y from 0 to h */
export function meanderRingGeometry(r, h = 0.32) {
  const mb = new MeshBuilder();
  lathe(mb, [[r + 0.012, -0.012, 0.2, 0.5], [r + 0.03, 0.0, 0.1, 0.8], [r + 0.03, 0.035, 0.1, 0.8], [r + 0.018, 0.05, 0.2, 0.2], [r + 0.018, h - 0.05, 0.2, 0.2], [r + 0.03, h - 0.035, 0.1, 0.8], [r + 0.03, h, 0.1, 0.8], [r + 0.012, h + 0.012, 0.2, 0.5]], 64, {});
  return mb.geometry();
}

const capCache = new Map();
/** gold Corinthian capital sized for a shaft of top radius r (local y up, origin at its bottom) */
export function capitalFor(r, detail = 1) {
  const k = r.toFixed(3) + ':' + detail;
  if (!capCache.has(k)) capCache.set(k, capitalGeometry({ order: 'corinthian', diameter: (2 * r) / 0.84, detail }));
  return capCache.get(k);
}

/** matrix placing a local-y-axis piece: centre c, axis direction a, roll about the axis */
export function axisMatrix(c, a, roll = 0) {
  const y = a.clone().normalize();
  const ref = Math.abs(y.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(ref, y).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.multiply(new THREE.Matrix4().makeRotationY(roll));
  m.setPosition(c);
  return m;
}

/**
 * Build a column made of drum pieces along an axis.
 * @param {object} o
 * @param {THREE.Vector3} o.base   start point (centre of the bottom end)
 * @param {THREE.Vector3} o.axis   direction (unit) bottom → top
 * @param {number} o.r             radius
 * @param {Array} o.pieces         [{h, gap?, breakTop?, breakBottom?, chips?, roll?, bend?}] bottom → top
 * @param {boolean} [o.capital]    gold capital on top of the last piece
 * @param {number[]} [o.meanders]  distances along the axis (from base) of meander collars
 * @param {string} o.seed
 * @returns {{ meshes: THREE.Mesh[], top: THREE.Vector3, len: number }}
 */
export async function buildColumn(o, q, sunken) {
  const meshes = [];
  const mat = bandedColumnMaterial(sunken);
  let s = 0;
  const axis = o.axis.clone().normalize();
  const band = o.band ?? o.r * 1.75;
  for (let i = 0; i < o.pieces.length; i++) {
    const p = o.pieces[i];
    s += p.gap || 0;
    const ax = p.bend ? axis.clone().applyAxisAngle(p.bendAxis || new THREE.Vector3(0, 1, 0), p.bend) : axis;
    const geo = await drumPiece({ r: o.r, h: p.h, seed: `${o.seed}-${i}`, chips: p.chips ?? 4, cracks: p.cracks ?? 1, breakTop: p.breakTop || 0, breakBottom: p.breakBottom || 0, phase: s, band, bandSeed: i + 1 }, q);
    const c = o.base.clone().addScaledVector(axis, s).addScaledVector(ax, p.h / 2).add(p.offset || new THREE.Vector3());
    const m = new THREE.Mesh(geo, mat);
    m.matrixAutoUpdate = false; m.matrix.copy(axisMatrix(c, ax, p.roll || 0));
    m.name = 'setColumn';
    meshes.push(m);
    s += p.h;
  }
  const top = o.base.clone().addScaledVector(axis, s);
  if (o.meanders?.length) {
    const ring = meanderRingGeometry(o.r);
    for (const d of o.meanders) {
      const m = new THREE.Mesh(ring, meanderBandMaterial(sunken));
      m.matrixAutoUpdate = false; m.matrix.copy(axisMatrix(o.base.clone().addScaledVector(axis, d), axis));
      m.name = 'setMeander';
      meshes.push(m);
    }
  }
  if (o.capital) {
    const cap = new THREE.Mesh(capitalFor(o.r * 0.99, q >= 1 ? 1 : 0.6), setGoldMaterial(sunken));
    cap.matrixAutoUpdate = false; cap.matrix.copy(axisMatrix(top.clone().addScaledVector(axis, o.capGap || 0), axis, o.capRoll || 0));
    cap.name = 'setCapital';
    meshes.push(cap);
  }
  return { meshes, top, len: s };
}

export function hashSpec(o) {
  const s = JSON.stringify(o);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/**
 * Pristine banded shaft (golden era): lathe with entasis, red / white marble bands as vertex colours
 * with crisp joints (duplicated rings at band boundaries), aux zeros. Local y from 0 to h.
 * bands: [[y0, y1, isRed], ...] or generated from o.band / o.redFrac / o.phase.
 */
export function bandedShaftGeometry(o) {
  const r0 = o.r, h = o.h, taper = o.taper ?? 0.12, segs = o.segs ?? 48;
  const band = o.band ?? 1.3, redFrac = o.redFrac ?? 0.68, ph = o.phase ?? 0.2;
  // band boundaries
  const cuts = [0];
  for (let y = -ph; y < h; y += band) { for (const t of [y, y + band * redFrac]) if (t > 0.02 && t < h - 0.02) cuts.push(t); }
  cuts.push(h); cuts.sort((a, b) => a - b);
  const rows = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    const mid = (a + b) / 2, f = (((mid + ph) / band) % 1 + 1) % 1, red = f < redFrac;
    const n = Math.max(1, Math.ceil((b - a) / 0.25));
    for (let k = 0; k <= n; k++) rows.push({ y: a + ((b - a) * k) / n, red });
  }
  const R = (y) => { const t = y / h; return r0 * (1 - taper * t + 0.02 * Math.sin(Math.PI * t)); };
  const pos = [], nor = [], col = [], idx = [];
  const N = new Simplex(31);
  for (let ri = 0; ri < rows.length; ri++) {
    const { y, red } = rows[ri];
    const r = R(y), dr = (R(Math.min(h, y + 0.01)) - R(Math.max(0, y - 0.01))) / 0.02;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2, cx = Math.sin(a), cz = Math.cos(a);
      pos.push(r * cx, y, r * cz);
      const l = Math.hypot(1, dr); nor.push(cx / l, -dr / l, cz / l);
      const mott = 0.85 + 0.25 * (N.noise3(cx * 2, y * 1.5, cz * 2) * 0.5 + 0.5);
      if (red) col.push(RED_TINT[0] * mott * 1.05, RED_TINT[1] * mott, RED_TINT[2] * mott); else col.push(1, 1, 1);
    }
  }
  const W = segs + 1;
  for (let ri = 0; ri < rows.length - 1; ri++) {
    if (rows[ri + 1].y - rows[ri].y < 1e-6) continue;
    for (let s = 0; s < segs; s++) { const a = ri * W + s, b = a + 1, c = a + W + 1, d = a + W; idx.push(a, b, c, a, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
