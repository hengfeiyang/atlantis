// Gilded lamp standards (refs 3, 4): stepped round base on lion feet, slender fluted shaft with
// knops, a small fire bowl on top (variant 'flame') or a gilt pine-cone finial ('finial').
//
//   const set = new LampSet(engine, fireSystem);
//   set.add({ pos:[x,y,z], height: 3, kind: 'flame' | 'finial' });
//   set.build();
import * as THREE from 'three';
import { goldMaterial } from './metals.js';
import { hashString } from '../core/rng.js';

function lathe(pts, seg, disp) {
  const nP = pts.length, nx = seg + 1;
  const pos = new Float32Array(nP * nx * 3), uv = new Float32Array(nP * nx * 2);
  for (let j = 0; j < nP; j++) {
    const [r0, y] = pts[j];
    for (let i = 0; i <= seg; i++) {
      const phi = (i / seg) * Math.PI * 2, r = r0 + (disp ? disp(phi, y, r0) : 0), k = j * nx + i;
      pos[k * 3] = Math.cos(phi) * r; pos[k * 3 + 1] = y; pos[k * 3 + 2] = Math.sin(phi) * r;
      uv[k * 2] = i / seg; uv[k * 2 + 1] = j / (nP - 1);
    }
  }
  const idx = [];
  for (let j = 0; j < nP - 1; j++) for (let i = 0; i < seg; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// profile for a 3.0 m standard (metres): [radius, y]
const SHAFT = [
  [0, 0], [0.2, 0], [0.205, 0.03], [0.19, 0.05], [0.15, 0.07], [0.15, 0.1], [0.12, 0.12], [0.1, 0.16], [0.075, 0.2],
  [0.07, 0.26], [0.085, 0.29], [0.07, 0.32], [0.05, 0.36],               // base knop
  [0.045, 0.9], [0.065, 0.93], [0.075, 0.97], [0.065, 1.01], [0.045, 1.04], // knop 1
  [0.042, 1.6], [0.06, 1.63], [0.068, 1.67], [0.06, 1.71], [0.042, 1.74],   // knop 2
  [0.04, 2.3], [0.055, 2.33], [0.062, 2.37], [0.055, 2.41], [0.04, 2.44],   // knop 3
  [0.038, 2.62], [0.05, 2.66], [0.085, 2.7], [0.11, 2.74], [0.12, 2.76], [0.06, 2.78], [0.045, 2.8], // capital
];
const BOWL = [[0.045, 2.8], [0.08, 2.81], [0.15, 2.84], [0.2, 2.89], [0.22, 2.93], [0.215, 2.95], [0.19, 2.94], [0.14, 2.91], [0.0, 2.9]];
const CONE = [[0.045, 2.8], [0.07, 2.83], [0.065, 2.86], [0.09, 2.9], [0.11, 2.96], [0.115, 3.02], [0.1, 3.08], [0.075, 3.13], [0.045, 3.17], [0.02, 3.2], [0, 3.22]];

export function lampGeometry(kind = 'flame', detail = 1) {
  const seg = detail >= 0.9 ? 28 : 18;
  const shaft = lathe(SHAFT.map(([r, y]) => [r * (y < 0.36 ? 1.25 : 1.5), y]), seg, (phi, y) => (y > 0.38 && y < 2.6 && !(y > 0.88 && y < 1.06) && !(y > 1.58 && y < 1.76) && !(y > 2.28 && y < 2.46) ? 0.006 * Math.cos(phi * 12) : 0));
  const parts = [shaft];
  if (kind === 'flame') parts.push(lathe(BOWL.map(([r, y]) => [r * 1.3, y]), seg, (phi, y) => (y < 2.9 ? 0.008 * Math.abs(Math.cos(phi * 6)) : 0)));
  else parts.push(lathe(CONE.map(([r, y]) => [r * 1.35, 2.8 + (y - 2.8) * 1.3]), seg, (phi, y) => (y > 2.86 ? 0.012 * Math.cos(phi * 9 + y * 60) : 0)));
  // three lion feet around the base
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    const f = new THREE.SphereGeometry(0.065, 10, 6); f.scale(1.3, 0.75, 1.3);
    f.translate(Math.cos(a) * 0.25, 0.03, Math.sin(a) * 0.25);
    parts.push(f);
  }
  return merge(parts);
}

function merge(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); uv.set(g.attributes.uv.array, vo * 2);
    const I = g.index.array; for (let i = 0; i < I.length; i++) idx[io++] = I[i] + vo;
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1)); out.computeBoundingSphere();
  return out;
}

export class LampSet {
  constructor(engine, fire) { this.engine = engine; this.fire = fire; this.items = []; this.detail = engine.quality?.detail ?? 1; }
  add(spec) { this.items.push(spec); return this; }
  build() {
    if (!this.items.length) return null;
    const group = new THREE.Group(); group.name = 'lamps';
    const geos = { flame: lampGeometry('flame', this.detail), finial: lampGeometry('finial', this.detail) };
    const mat = goldMaterial({ name: 'lampGold', tint: 0xdcac58, rough: 0.36, wear: 0.4 });
    const lists = { flame: [], finial: [] };
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (const it of this.items) {
      const seed = it.seed ?? hashString(it.pos.map((v) => v.toFixed(2)).join(','));
      const r01 = (q) => ((Math.imul(seed ^ (q * 0x9e3779b1), 0x85ebca6b) >>> 0) / 4294967296);
      const kind = it.kind === 'finial' ? 'finial' : 'flame';
      const sc = (it.height ?? 3) / 3;
      Q.setFromAxisAngle(Y, r01(1) * 6.28);
      P.set(...it.pos); S.set(sc, sc, sc); M.compose(P, Q, S);
      lists[kind].push(M.clone());
      if (kind === 'flame' && this.fire) this.fire.addFire([it.pos[0], it.pos[1] + 2.92 * sc, it.pos[2]], 0.42 * sc * (0.85 + 0.3 * r01(2)), r01(3), { layers: 2, embers: 5, spread: 0.18 });
    }
    for (const k of ['flame', 'finial']) {
      if (!lists[k].length) continue;
      const m = new THREE.InstancedMesh(geos[k], mat, lists[k].length);
      lists[k].forEach((x, i) => m.setMatrixAt(i, x));
      m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere();
      m.name = 'lamps_' + k; m.castShadow = true; m.receiveShadow = true;
      group.add(m);
      this.tris = (this.tris || 0) + (geos[k].index.count / 3) * lists[k].length;
    }
    this.engine.add(group);
    this.group = group;
    return group;
  }
}
