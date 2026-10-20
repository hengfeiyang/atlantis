// adapted from athenaion/src/props/brazier.js
// Braziers: wide gadrooned bronze/gilt bowls (refs 5, 6, 9, 2) on a short knopped foot, optionally
// on a lion-footed tripod or a marble pier; glowing coal bed with charred logs; fire from fire.js.
// Every part is an InstancedMesh (one draw call per part for all braziers in the world).
//
//   const set = new BrazierSet(engine, fireSystem);
//   set.add({ pos:[x,y,z], diameter: 1.0, stand: 'foot'|'tripod'|'pier', facing, seed });
//   set.build();
// pos = the point the brazier stands on (top of a pier/pedestal for 'foot'; the ground for 'tripod'
// and 'pier' — 'pier' builds its own marble pier first).
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { bronzeMaterial, propMarbleMaterial } from './metals.js';
import { hashString } from '../core/rng.js';
import { SHOTS } from '../world/shots.js';

// LOD: bowls farther than this from every shot camera use a light lathe (they are a few pixels wide)
const BOWL_LOD_DIST = 60;
const CAMS = SHOTS.map((q) => q.pos);
const nearCam = (x, y, z) => CAMS.some((c) => Math.hypot(c[0] - x, c[1] - y, c[2] - z) < BOWL_LOD_DIST);
const camDist = (x, y, z) => CAMS.reduce((m, c) => Math.min(m, Math.hypot(c[0] - x, c[1] - y, c[2] - z)), Infinity);
/** 'hi' < 60 m from a shot camera, 'lo' < 220 m, 'vl' beyond (a few hundred tris, no coals) */
const lodKey = (engine, x, y, z) => { if (engine.__propsTest) return 'hi'; const d = camDist(x, y, z); return d < BOWL_LOD_DIST ? 'hi' : d < 220 ? 'lo' : 'vl'; };

// ------------------------------------------------------------------------------- bowl geometry
// Units: bowl rim diameter = 1. y = 0 at the bottom of the bowl (top of the stem).
const OUTER = [
  [0.085, -0.005], [0.17, 0.02], [0.26, 0.06], [0.34, 0.11], [0.41, 0.17], [0.46, 0.225], [0.49, 0.27],
  [0.5, 0.29], [0.502, 0.30], [0.508, 0.315], [0.504, 0.325], [0.506, 0.335], [0.522, 0.348],
  [0.535, 0.36], [0.534, 0.373], [0.52, 0.381], [0.5, 0.379],
];
const INNER = [[0.5, 0.379], [0.482, 0.368], [0.47, 0.34], [0.44, 0.28], [0.39, 0.21], [0.31, 0.14], [0.21, 0.09], [0.1, 0.065], [0.0, 0.06]];
const FOOT = [ // stem + knop + spreading foot, y downward from 0
  [0.0, -0.225], [0.2, -0.225], [0.215, -0.215], [0.215, -0.2], [0.195, -0.19], [0.16, -0.175], [0.11, -0.15],
  [0.075, -0.125], [0.065, -0.1], [0.08, -0.085], [0.1, -0.07], [0.105, -0.055], [0.09, -0.04], [0.07, -0.025], [0.075, -0.01], [0.085, -0.005],
];

function resample(pts, n) {
  // resample a polyline to n points by arc length (smooth enough after normals)
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const out = [];
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * L[L.length - 1];
    let i = 1; while (i < L.length - 1 && L[i] < s) i++;
    const t = (s - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]);
    out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
  }
  return out;
}

/** surface of revolution with an optional radial displacement fn(phi, y, r) → dr */
function revolve(profile, seg, disp) {
  const nP = profile.length, nx = seg + 1;
  const pos = new Float32Array(nP * nx * 3), uv = new Float32Array(nP * nx * 2);
  for (let j = 0; j < nP; j++) {
    const [r0, y] = profile[j];
    for (let i = 0; i <= seg; i++) {
      const phi = (i / seg) * Math.PI * 2;
      const r = r0 + (disp ? disp(phi, y, r0) : 0);
      const k = j * nx + i;
      pos[k * 3] = Math.cos(phi) * r; pos[k * 3 + 1] = y; pos[k * 3 + 2] = Math.sin(phi) * r;
      uv[k * 2] = i / seg; uv[k * 2 + 1] = j / (nP - 1);
    }
  }
  const idx = [];
  for (let j = 0; j < nP - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the seam normals (first/last column)
  const N = g.attributes.normal;
  for (let j = 0; j < nP; j++) {
    const a = j * nx, b = j * nx + seg;
    const x = N.getX(a) + N.getX(b), y = N.getY(a) + N.getY(b), z = N.getZ(a) + N.getZ(b), l = Math.hypot(x, y, z) || 1;
    N.setXYZ(a, x / l, y / l, z / l); N.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

/** Outer bowl (gadrooned) + rim + stem/foot, unit diameter. */
export function bowlOuterGeometry({ lobes = 18, detail = 1, foot = true, variant = 0 } = {}) {
  const seg = Math.round(lobes * (detail >= 0.9 ? 8 : detail > 0.4 ? 6 : 3));
  const prof = resample(OUTER, Math.round(detail >= 0.9 ? 72 : detail > 0.4 ? 56 : detail < 0.2 ? 12 : 24));
  const gad = (phi, y) => {
    // gadroons: rounded tongues pointing up from the base, grooves between them
    if (y < 0.0 || y > 0.27) return 0;
    const l = (phi * lobes) / (Math.PI * 2);
    const f = l - Math.floor(l) - 0.5;            // -0.5..0.5 across one lobe
    const tipY = variant ? 0.24 : 0.255;
    const yy = y / tipY;
    const across = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(f) * 2, 2.2)));
    // rounded top: the tongue ends in a semicircle
    const top = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (yy - 0.82) / 0.18), 2) - 0.0));
    const lobeEdge = yy > 0.82 ? Math.max(0, across - (1 - top)) : across;
    const k = Math.min(1, y / 0.05) * (yy < 1 ? 1 : 0);
    return 0.034 * lobeEdge * k - 0.008 * (1 - across) * k;
  };
  // relief band under the rim (ref 5): framed cartouches with a rosette boss, beaded edges
  const NP = variant ? 10 : 12;
  const band = (phi, y) => {
    if (y < 0.282 || y > 0.352) return 0;
    const v = (y - 0.282) / 0.07;                 // 0..1 across the band
    const l = (phi * NP) / (Math.PI * 2), f = l - Math.floor(l);
    const edge = v < 0.14 || v > 0.86 ? 0.011 * (0.55 + 0.45 * Math.cos(phi * NP * 9)) : 0; // beaded rims
    const frame = (Math.abs(f - 0.5) > 0.44 || (v > 0.18 && v < 0.26) || (v > 0.74 && v < 0.82)) ? 0.009 : 0;
    const du = (f - 0.5) * 2.6, dv = (v - 0.5) * 2.4, rr = Math.hypot(du, dv);
    const boss = rr < 0.42 ? 0.013 * Math.cos((rr / 0.42) * Math.PI * 0.5) * (0.75 + 0.25 * Math.cos(Math.atan2(dv, du) * 8)) : 0;
    const scroll = rr > 0.5 && rr < 0.9 && Math.abs(dv) < 0.35 ? 0.006 * Math.max(0, Math.sin(du * 9)) : 0;
    return edge + frame + boss + scroll;
  };
  const gad0 = gad;
  const gadB = (phi, y, r) => gad0(phi, y, r) + band(phi, y);
  const outer = revolve(prof, seg, gadB);
  const inner = revolve(resample(INNER, detail >= 0.9 ? 24 : detail < 0.2 ? 6 : 14), Math.round(seg * 0.5));
  const parts = [outer, inner];
  if (foot) parts.push(revolve(resample(FOOT, detail >= 0.9 ? 36 : detail < 0.2 ? 9 : 22), detail < 0.2 ? 12 : 40));
  if (variant) {
    // two loop handles on the sides (ref 5)
    for (const s of [-1, 1]) {
      const h = new THREE.TorusGeometry(0.075, 0.016, 8, 20, Math.PI * 1.15);
      h.rotateZ(-Math.PI * 0.575 + (s > 0 ? 0 : Math.PI));
      h.translate(s * 0.515, 0.25, 0);
      parts.push(h);
    }
  }
  return mergeSimple(parts);
}

function mergeSimple(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const I = g.index.array; for (let i = 0; i < I.length; i++) idx[io++] = I[i] + vo;
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** Coal bed mound + a few charred log ends, unit bowl diameter, sits inside the bowl. */
function coalGeometry(seed = 3) {
  const g = new THREE.SphereGeometry(0.352, 28, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const P = g.attributes.position;
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const bumps = Array.from({ length: 26 }, () => [rnd() * 2 - 1, rnd() * 2 - 1, 0.02 + 0.04 * rnd()]);
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    y *= 0.24;
    let b = 0;
    for (const [bx, bz, a] of bumps) { const d = Math.hypot(x - bx * 0.28, z - bz * 0.28); b += a * 0.7 * Math.exp(-(d * d) / 0.005); }
    P.setXYZ(i, x, y + 0.185 + b * (y > 0.01 ? 1 : 0.0), z);
  }
  g.computeVertexNormals();
  // charred logs leaning together
  const parts = [g];
  for (let k = 0; k < 4; k++) {
    const c = new THREE.CylinderGeometry(0.035, 0.045, 0.42, 7, 1);
    const a = (k / 4) * Math.PI * 2 + rnd() * 0.6;
    c.rotateZ(0.95 + rnd() * 0.25);
    c.rotateY(a);
    c.translate(Math.cos(a) * 0.07, 0.27, -Math.sin(a) * 0.07);
    parts.push(c);
  }
  return mergeSimple(parts.map((p) => (p.index ? p : p.toNonIndexed())).map((p) => { if (!p.index) { const n = p.attributes.position.count; p.setIndex([...Array(n).keys()]); } return p; }));
}

/** Lion-footed tripod stand: unit = bowl diameter; top at y=0, feet at y=-h. */
function tripodGeometry(h = 1.0) {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    // S-curved leg as a tube along a Catmull-Rom curve
    const pts = [
      [0.13, -0.02], [0.2, -0.12], [0.2, -0.3], [0.17, -0.55], [0.2, -0.78], [0.3, -0.94 * h], [0.33, -h + 0.06],
    ].map(([r, y]) => new THREE.Vector3(Math.cos(a) * r, y * (y < -0.5 ? 1 : 1), Math.sin(a) * r));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 40, 0.036, 8, false);
    // taper: scale radius along the tube (thicker at the knee)
    parts.push(tube);
    // lion paw: squashed sphere + three toes
    const paw = new THREE.SphereGeometry(0.06, 12, 8);
    paw.scale(1.15, 0.7, 1.15);
    paw.translate(Math.cos(a) * 0.35, -h + 0.04, Math.sin(a) * 0.35);
    parts.push(paw);
    for (let t = -1; t <= 1; t++) {
      const toe = new THREE.SphereGeometry(0.025, 8, 6);
      const ta = a + t * 0.25;
      toe.translate(Math.cos(ta) * 0.4, -h + 0.025, Math.sin(ta) * 0.4);
      parts.push(toe);
    }
    // volute scroll at the top of the leg
    const sc = new THREE.TorusGeometry(0.045, 0.014, 6, 14, Math.PI * 1.6);
    sc.rotateY(-a + Math.PI / 2);
    sc.translate(Math.cos(a) * 0.2, -0.1, Math.sin(a) * 0.2);
    parts.push(sc);
  }
  // linking ring at mid height and a top ring under the bowl
  const ring = new THREE.TorusGeometry(0.19, 0.016, 6, 36); ring.rotateX(Math.PI / 2); ring.translate(0, -0.52, 0); parts.push(ring);
  const ring2 = new THREE.TorusGeometry(0.15, 0.02, 6, 36); ring2.rotateX(Math.PI / 2); ring2.translate(0, -0.03, 0); parts.push(ring2);
  // central stem with knop
  const stem = new THREE.LatheGeometry([[0, -0.6], [0.03, -0.6], [0.05, -0.56], [0.03, -0.5], [0.025, -0.1], [0.06, -0.05], [0.04, 0], [0, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
  parts.push(stem);
  return mergeSimple(parts.map((p) => { const q = p.index ? p : p; if (!q.attributes.normal) q.computeVertexNormals(); if (!q.index) { const n = q.attributes.position.count; q.setIndex([...Array(n).keys()]); } return q; }));
}

/** Marble pier for ground-standing braziers: unit height 1, width w (m). Base + shaft + cap. */
function pierGeometry() {
  const parts = [];
  const box = (w, h, d, y) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(0, y + h / 2, 0); parts.push(b); };
  box(0.92, 0.08, 0.92, 0);      // plinth
  box(0.86, 0.05, 0.86, 0.08);   // base moulding
  box(0.76, 0.72, 0.76, 0.13);   // shaft
  box(0.84, 0.05, 0.84, 0.85);   // cap moulding
  box(0.9, 0.1, 0.9, 0.9);       // cap slab
  return mergeSimple(parts);
}

// ------------------------------------------------------------------------------- materials
function sootyInnerMaterial() {
  const m = proceduralMaterial({
    name: 'brazierInner',
    params: { color: 0x3a2a1c, roughness: 0.8, metalness: 0.4 },
    uniforms: { uFireTime: { value: 0 } },
    head: /* glsl */`uniform float uFireTime;`,
    color: /* glsl */`
      float n = cgFbm3(cgO * 14.0 + cgSeed * 9.0, 3) * 0.5 + 0.5;
      diffuseColor.rgb *= 0.35 + 0.5 * n;`,
    emissive: /* glsl */`
      // heat glow on the inner wall just above the coal bed, flickering
      float h = cgO.y;  // local units (bowl diameter = 1 before instance scale)
      float glow = exp(-max(h - 0.12, 0.0) * 18.0) * (1.0 - smoothstep(0.35, 0.5, length(cgO.xz)));
      float fl = 0.75 + 0.25 * sin(uFireTime * 7.0 + cgSeed * 30.0) * sin(uFireTime * 3.1 + cgO.x * 9.0);
      totalEmissiveRadiance += vec3(1.0, 0.32, 0.06) * glow * 1.6 * fl;`,
  });
  m.userData.sunken = 'metal';
  return m;
}

function coalMaterial() {
  const m = proceduralMaterial({
    name: 'brazierCoals',
    params: { color: 0x141110, roughness: 0.95, metalness: 0.0 },
    uniforms: { uFireTime: { value: 0 } },
    head: /* glsl */`uniform float uFireTime;`,
    color: /* glsl */`diffuseColor.rgb *= 0.6 + 0.6 * cgVnoise3(cgO * 40.0);`,
    emissive: /* glsl */`
      vec3 q = cgO * vec3(48.0, 60.0, 48.0) + cgSeed * 7.0 + cgFbm3(cgO * 9.0, 2) * 0.6;
      vec2 v = cgVoronoi3(q);
      float crack = (1.0 - smoothstep(0.0, 0.09, v.y - v.x)) * smoothstep(0.3, 0.7, cgVnoise3(cgO * 15.0 + 2.0));            // glowing seams between coals
      float hot = smoothstep(0.35, 0.8, cgFbm3(cgO * 6.0 + vec3(0.0, -uFireTime * 0.3, 0.0) + cgSeed * 3.0, 3) * 0.5 + 0.5);
      float low = 1.0 - smoothstep(0.18, 0.4, cgO.y);                  // log tips above the bed glow less
      float fl = 0.7 + 0.3 * sin(uFireTime * 5.0 + cgO.x * 30.0 + cgSeed * 20.0);
      vec3 ember = mix(vec3(0.9, 0.12, 0.01), vec3(1.0, 0.45, 0.08), hot);
      totalEmissiveRadiance += ember * (crack * 5.0 + hot * hot * 2.2) * (0.25 + 0.75 * low) * fl;`,
  });
  m.userData.sunken = 'stone';
  return m;
}

// ------------------------------------------------------------------------------- set
export class BrazierSet {
  constructor(engine, fire) {
    this.engine = engine; this.fire = fire; this.items = [];
    this.detail = engine.quality?.detail ?? 1;
  }
  add(spec) { this.items.push(spec); return this; }

  build() {
    const n = this.items.length;
    if (!n) return null;
    const group = new THREE.Group(); group.name = 'braziers';
    const bowlGeo = [bowlOuterGeometry({ lobes: 18, detail: this.detail }), bowlOuterGeometry({ lobes: 24, detail: this.detail, variant: 1 })];
    const bowlGeoLo = [bowlOuterGeometry({ lobes: 18, detail: 0.35 }), bowlOuterGeometry({ lobes: 24, detail: 0.35, variant: 1 })];
    const bowlGeoVl = [bowlOuterGeometry({ lobes: 8, detail: 0.1 }), bowlOuterGeometry({ lobes: 8, detail: 0.1, variant: 1 })];
    const innerGeo = revolve(resample(INNER, 16), 40); // slightly inset duplicate of the inner bowl for the sooty material
    innerGeo.scale(0.995, 1, 0.995); innerGeo.translate(0, 0.001, 0);
    const coalGeo = coalGeometry(11);
    const tripodGeo = tripodGeometry(1.0);
    const pierGeo = pierGeometry();
    // golden era: bright polished gilt bowls (refs 3, 5) — shared gold when available
    const bronze = this.goldMat || bronzeMaterial({ name: 'brazierBronze2', tint: 0xb89050, rough: 0.24, patina: 0.25, metal: 1.0, envBoost: 0.95 });
    const legBronze = bronzeMaterial({ name: 'brazierLegs', tint: 0x9c7445, rough: 0.46, patina: 0.5, metal: 1.0 });
    const darkBronze = bronzeMaterial({ name: 'brazierDark2', tint: 0x75603f, rough: 0.46, patina: 0.65, metal: 1.0, envBoost: 0.9 });
    const innerMat = sootyInnerMaterial();
    const coalMat = coalMaterial();
    const marble = propMarbleMaterial();
    const fireT = innerMat.userData.cgUniforms.uFireTime, coalT = coalMat.userData.cgUniforms.uFireTime;
    this.engine.onUpdate((t) => { fireT.value = t; coalT.value = t; });

    const bowls = new Map(), inner = [], coals = [], tripods = [], piers = new Map();
    const push = (map, key, m) => { if (!map.has(key)) map.set(key, []); map.get(key).push(m); };
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    for (const it of this.items) {
      const seedI = it.seed ?? hashString(it.pos.map((v) => v.toFixed(2)).join(','));
      const r01 = (k) => ((Math.imul(seedI ^ (k * 0x9e3779b1), 0x85ebca6b) >>> 0) / 4294967296);
      const D = (it.diameter ?? 1.0) * (0.94 + 0.12 * r01(1));
      const stand = it.stand || 'foot';
      const rot = (it.facing !== undefined ? (it.facing * Math.PI) / 180 : 0) + r01(2) * 0.6;
      Q.setFromAxisAngle(Y, rot);
      let y = it.pos[1];
      if (it.fallen) {
        // sunken era: the bowl lies toppled on the ground (pos = ground point), no coals, no fire
        const tilt = typeof it.fallen === 'number' ? it.fallen : 1.45 + 0.5 * r01(7);
        const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
        const QQ = Q.clone().multiply(q2);
        // lift so the rim edge rests on the ground (bowl axis now nearly horizontal)
        P.set(it.pos[0], it.pos[1] + 0.5 * D * Math.abs(Math.sin(tilt)) - 0.05 * D, it.pos[2]);
        S.set(D, D, D);
        M.compose(P, QQ, S);
        push(bowls, (r01(3) < 0.5 ? 0 : 1) + ':dark:' + lodKey(this.engine, it.pos[0], y, it.pos[2]), M.clone());
        if (stand === 'tripod') {
          // the tripod lies next to it
          const q3 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.5 + 0.2 * r01(8));
          const off = new THREE.Vector3(Math.cos(rot) * D * 0.9, 0, -Math.sin(rot) * D * 0.9);
          P.set(it.pos[0] + off.x, it.pos[1] + 0.3 * D, it.pos[2] + off.z); S.set(D, D * 1.05, D);
          M.compose(P, Q.clone().multiply(q3), S); tripods.push(M.clone());
        }
        continue;
      }
      if (stand === 'pier') {
        const ph = it.pierHeight ?? 1.0, pw = D * 1.0;
        P.set(it.pos[0], y, it.pos[2]); S.set(pw, ph, pw);
        M.compose(P, Q, S); push(piers, it.pierMaterial || marble, M.clone());
        y += ph;
      }
      if (stand === 'tripod') {
        const th = D * 1.05;
        P.set(it.pos[0], y + th, it.pos[2]);
        S.set(D, th, D);
        M.compose(P, Q, S); tripods.push(M.clone());
        y += th + 0.02 * D;
      } else {
        y += 0.225 * D; // foot height
      }
      // dark (older) braziers are wider and shallower, like the one in the ruined portico (ref 9)
      const sy = it.shallow ?? (it.tone === 'dark' ? 0.72 : 1.0);
      if (sy !== 1 && stand !== 'tripod') y -= 0.225 * D * (1 - sy);
      P.set(it.pos[0], y, it.pos[2]); S.set(D * (sy !== 1 ? 1.08 : 1), D * sy, D * (sy !== 1 ? 1.08 : 1));
      M.compose(P, Q, S);
      const v = r01(3) < 0.5 ? 0 : 1;
      const lk = lodKey(this.engine, it.pos[0], y, it.pos[2]);
      push(bowls, v + (it.tone === 'dark' ? ':dark:' : ':gold:') + lk, M.clone()); if (lk !== 'vl') { inner.push(M.clone()); coals.push(M.clone()); }
      // fire base at the coal surface
      if (this.fire && it.fire !== false) {
        const fh = D * (0.85 + 0.5 * r01(4)) * (it.flame ?? 1);
        this.fire.addFire([it.pos[0], y + 0.27 * D * sy, it.pos[2]], fh, r01(5), { spread: 0.26, layers: 4, tongues: 3, embers: Math.round(12 + 12 * r01(6)) });
      }
    }
    const mk = (geo, mat, mats, name, cast = true) => {
      if (!mats.length) return;
      const m = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((x, i) => m.setMatrixAt(i, x));
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      m.name = name; m.castShadow = cast; m.receiveShadow = true;
      group.add(m);
      this.tris = (this.tris || 0) + (geo.index.count / 3) * mats.length;
    };
    for (const [key, list] of bowls) { const [v, tone, lod] = key.split(':'); mk((lod === 'vl' ? bowlGeoVl : lod === 'lo' ? bowlGeoLo : bowlGeo)[+v], tone === 'dark' ? darkBronze : bronze, list, 'brazierBowl' + key); }
    mk(innerGeo, innerMat, inner, 'brazierInner', false);
    mk(coalGeo, coalMat, coals, 'brazierCoals', false);
    mk(tripodGeo, legBronze, tripods, 'brazierTripods');
    for (const [mat, list] of piers) mk(pierGeo, mat, list, 'brazierPiers');
    this.engine.add(group);
    this.group = group;
    return group;
  }
}
