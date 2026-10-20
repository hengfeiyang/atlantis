// Dressed stone family for ATLANTIS (Plato's white / red / black stones). OWNER: temple agent.
// Shared: others import, never edit (ask in your report). Adapted from athenaion/src/materials/marble.js.
//
// ---------------------------------------------------------------------------------------- API (stable)
//   import { stoneMaterial, whiteStone, redStone, blackStone, bandedStone, checkerFloor, mosaicFloor,
//            limestone, marbleMaterial, STONE_SRGB } from '../materials/stone.js';
//
//   stoneMaterial({ kind, ...opts })           kind: 'white' | 'red' | 'black' | 'banded' | 'checker' | 'mosaic' | 'limestone'
//   whiteStone(o)   white marble (veined, warm white, lit ≈ #ead9bf)
//   redStone(o)     brick-red / terracotta stone (≈ #a8483a lit)
//   blackStone(o)   black basalt (≈ #2a2a2e), fine crystal speckle — podiums, bases
//   limestone(o)    warm grey-cream ashlar (foundations, retaining walls, quays)
//   bandedStone(o)  alternating white / red horizontal courses (world y): o.band = course height (m, 1.2),
//                   o.redFrac (0..1, 0.5), o.bandOffset (m, 0) — towers, walls, banded columns (ref 2, 5, 8)
//   checkerFloor(o) polychrome checker paving in world x/z: o.cell (m, 1.2), o.rotation (rad), o.pattern
//                   0 = white/black, 1 = white/black with red border strips, 2 = white/red, 3 = red/black/white diagonal,
//                   4 = white slabs with black/red inlay bands every 5 slabs (ref 3 forecourt)
//   mosaicFloor(o)  compass-rose / star mosaic (ref 3, 6, 8): o.center [x, z] world, o.radius (m), o.rotation (rad),
//                   o.tessera (m, 0.07); outside the rose: checker paving (o.cell, o.pattern)
//   marbleMaterial({ variant:'weathered'|'polished'|'ruined'|'mossy'|'interior', tint, ao, seed, overrides })
//                   athenaion-compatible alias (white kind) used by src/arch/*
//
// Common options (all optional):
//   tint (hex | THREE.Color, multiplies albedo)   seed (number, shifts noise)   ao (AOVolume, src/arch/ao.js)
//   weather 0..1 (grime, streaks, patina; default 0.25 — Atlantis is well kept)   lichen 0..1 (0.05)
//   polish 0..1 (0.3; 1 = mirror-ish polished floor)   rough (base roughness, 0.55)   veins 0..1
//   courses (m): ashlar course height for vertical faces (0 = none)  — used when the geometry has no aux.w flag
//   paving (m): paving slab size for up faces (0 = none)
//   colors: { c0, c1, c2, c3 } sRGB hex overrides of the kind palette
//   vertexColors (bool), side (THREE side), wet 0..1, dark 0..1 (interior darkening)
// Geometry: optional `aux` vec4 attribute (see src/arch/geom.js): x cavity, y edge, z streak,
//   w masonry flag [1,2) drums, [3,4) ashlar (course=(w-3)*10), [5,6) paving (slab=(w-5)*10).
//   Missing attribute = zeros (material.defaultAttributeValues) → material-level `courses` / `paving` apply.
// Every material is tagged userData.sunken = 'stone' (core/sunken.js overlay). Noise: one shared 64³ 3D texture.
//
// Helpers: STONE_SRGB (palette hex strings), stoneLinear(kind) → THREE.Color albedo, noiseTexture(),
//   aoUniforms(ao), setMaterialAO(mat, ao), NOISE_TEX_HEAD / AUX_VERTEX_HEAD / AUX_VERTEX_PRE / AO_HEAD (GLSL), BOUNCE.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { mulberry32 } from '../core/rng.js';

// --------------------------------------------------------------------------- palette
export const STONE_SRGB = {
  white: '#e6dccb', whiteLit: '#ead9bf', grey: '#9a9894', red: '#a8483a', redDark: '#7a2e24',
  black: '#2a2a2e', limestone: '#cfc3ad', gold: '#c9a24e', navy: '#1b2a5c',
};
// linear albedos (white stone ≈ 0.6–0.75 per the contract)
const PAL = {
  white: [new THREE.Color(0.70, 0.655, 0.585), new THREE.Color(0.40, 0.40, 0.41), new THREE.Color(0.62, 0.60, 0.57), new THREE.Color(0.55, 0.38, 0.12)],
  red: [new THREE.Color(0.36, 0.092, 0.058), new THREE.Color(0.21, 0.048, 0.032), new THREE.Color(0.45, 0.17, 0.10), new THREE.Color(0.55, 0.38, 0.12)],
  black: [new THREE.Color(0.034, 0.035, 0.039), new THREE.Color(0.20, 0.20, 0.21), new THREE.Color(0.06, 0.058, 0.06), new THREE.Color(0.55, 0.38, 0.12)],
  limestone: [new THREE.Color(0.56, 0.50, 0.42), new THREE.Color(0.40, 0.37, 0.33), new THREE.Color(0.62, 0.55, 0.45), new THREE.Color(0.55, 0.38, 0.12)],
  banded: [new THREE.Color(0.70, 0.655, 0.585), new THREE.Color(0.36, 0.092, 0.058), new THREE.Color(0.40, 0.40, 0.41), new THREE.Color(0.55, 0.38, 0.12)],
  checker: [new THREE.Color(0.70, 0.66, 0.60), new THREE.Color(0.030, 0.031, 0.036), new THREE.Color(0.34, 0.085, 0.055), new THREE.Color(0.55, 0.38, 0.12)],
  mosaic: [new THREE.Color(0.70, 0.66, 0.60), new THREE.Color(0.030, 0.031, 0.036), new THREE.Color(0.34, 0.085, 0.055), new THREE.Color(0.58, 0.40, 0.13)],
};
/** linear albedo of a stone kind (for flat-shaded far LODs) */
export function stoneLinear(kind = 'white') { return (PAL[kind] || PAL.white)[0].clone(); }
const KIND_ID = { white: 0, red: 1, black: 2, banded: 3, checker: 4, mosaic: 5, limestone: 6 };

// --------------------------------------------------------------------------- noise texture
let _noiseTex = null;
/** shared 64³ RGBA tileable white-noise texture (linear, repeat); sampled with smooth interpolation */
export function noiseTexture() {
  if (_noiseTex) return _noiseTex;
  const N = 64, data = new Uint8Array(N * N * N * 4);
  const rnd = mulberry32(0x5eed1234);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256);
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1; t.generateMipmaps = false; t.needsUpdate = true;
  _noiseTex = t;
  return t;
}
export const NOISE_TEX_HEAD = /* glsl */ `
#ifndef CG_NTEX
#define CG_NTEX
uniform highp sampler3D uNoise3D;
vec4 cgN4(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return texture(uNoise3D, (i + f + 0.5) * (1.0 / 64.0));
}
const mat3 cgR1 = mat3(0.80, 0.60, 0.00, -0.48, 0.64, 0.60, 0.36, -0.48, 0.80);
const mat3 cgR2 = mat3(0.60, 0.00, 0.80, 0.64, 0.60, -0.48, -0.48, 0.80, 0.36);
#endif
`;

export const AUX_VERTEX_HEAD = /* glsl */ `
attribute vec4 aux;
varying vec4 vCgAux;
`;
export const AUX_VERTEX_PRE = /* glsl */ `vCgAux = aux;`;

export const AO_HEAD = /* glsl */ `
#ifndef CG_AOHEAD
#define CG_AOHEAD
varying vec4 vCgAux;
uniform highp sampler3D uAOA;
uniform highp sampler3D uAOB;
uniform mat4 uAOMat;
uniform mat3 uAORot;
uniform float uAOOn;
uniform float uAOCell;
float cgAOVolume(vec3 p, vec3 n){
  if (uAOOn < 0.5) return 1.0;
  vec3 sp = p + n * uAOCell * 0.85;
  vec3 uvw = (uAOMat * vec4(sp, 1.0)).xyz;
  vec3 ins = step(vec3(0.0), uvw) * step(uvw, vec3(1.0));
  if (ins.x * ins.y * ins.z < 0.5) return 1.0;
  vec3 ln = normalize(uAORot * n);
  vec4 a = texture(uAOA, uvw);
  vec2 b = texture(uAOB, uvw).xy;
  vec3 w = ln * ln;
  float v = w.x * (ln.x > 0.0 ? a.x : a.y) + w.y * (ln.y > 0.0 ? a.z : a.w) + w.z * (ln.z > 0.0 ? b.x : b.y);
  vec3 e = min(uvw, 1.0 - uvw);
  return mix(1.0, v, smoothstep(0.0, 0.03, min(e.x, min(e.y, e.z))));
}
#endif
`;

let _dummy3D = null;
export function dummy3DTexture() {
  if (!_dummy3D) {
    _dummy3D = new THREE.Data3DTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
    _dummy3D.format = THREE.RGBAFormat; _dummy3D.type = THREE.UnsignedByteType;
    _dummy3D.needsUpdate = true;
  }
  return _dummy3D;
}
/** AO uniforms for a material (shared by stone / metal). `ao` = AOVolume or null */
export function aoUniforms(ao) {
  return {
    uAOA: { value: ao ? ao.texA : dummy3DTexture() },
    uAOB: { value: ao ? ao.texB : dummy3DTexture() },
    uAOMat: { value: ao ? ao.worldToUvw.clone() : new THREE.Matrix4() },
    uAORot: { value: ao ? ao.worldToLocalRot.clone() : new THREE.Matrix3() },
    uAOOn: { value: ao ? 1 : 0 },
    uAOCell: { value: ao ? ao.cell : 1 },
    uNoise3D: { value: noiseTexture() },
  };
}
/** change the AO volume of an existing stone / metal material */
export function setMaterialAO(mat, ao) {
  const U = mat.userData.cgUniforms;
  if (!U || !U.uAOOn) return;
  const u = aoUniforms(ao);
  for (const k in u) U[k].value = u[k].value;
}
/** shared warm bounce-fill radiance for AO-occluded areas (× albedo) */
export const BOUNCE = { value: new THREE.Vector3(0.26, 0.24, 0.22) };

// --------------------------------------------------------------------------- GLSL
const HEAD = (kind) => /* glsl */ `
#define ST_KIND ${KIND_ID[kind] ?? 0}
${NOISE_TEX_HEAD}
${AO_HEAD}
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
uniform vec3 uSTint;
uniform vec4 uSP;   // x weather, y lichen, z streaks, w veins
uniform vec4 uSQ;   // x rough, y polish, z chips, w seed
uniform vec4 uSR;   // x dark, y wet, z courses (m), w paving (m)
uniform vec4 uPat;  // kind params: banded (h, redFrac, offset, -) checker/mosaic (cell, rot, pattern, tessera)
uniform vec4 uRose; // mosaic: (cx, cz, radius, rotation)
uniform vec3 uBounce;
float cgJoint = 0.0, cgBlockId = 0.0, cgJointChip = 0.0;
float cgH1(float x){ return fract(sin(x * 91.3458) * 47453.5453); }
float cgH2(vec2 v){ return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453); }
float cgLine(float d, float w, float aa){
  float l = 1.0 - smoothstep(w - 0.5 * aa, w + 0.5 * aa, d);
  return l * min(1.0, 2.2 * w / aa) * (1.0 - smoothstep(0.12, 0.45, aa));
}
void cgMasonry(vec3 p, vec3 n, float w, float seed){
  cgJoint = 0.0; cgBlockId = seed; cgJointChip = 0.0;
  if (w < 0.5) {
    // material-level masonry (geometry without aux flags)
    if (uSR.z > 0.0 && abs(n.y) < 0.6) w = 3.0 + uSR.z * 0.1;
    else if (uSR.w > 0.0 && n.y > 0.5) w = 5.0 + uSR.w * 0.1;
    else return;
  }
  if (w < 2.0) {
    float y = (w - 1.0) * 100.0;
    float dh = mix(0.9, 1.35, fract(seed * 7.31 + 0.13));
    float yy = y + fract(seed * 3.7) * dh;
    float k = floor(yy / dh);
    float jd = abs(fract(yy / dh + 0.5) - 0.5) * dh;
    float aa = fwidth(yy) + 1e-4;
    float ch = texture(uNoise3D, p * vec3(0.9, 0.35, 0.9) * (1.0 / 6.4) + 0.31).x;
    float wj = 0.005 + 0.012 * smoothstep(0.65, 0.88, ch);
    cgJoint = cgLine(jd, wj, aa);
    cgJointChip = (1.0 - smoothstep(wj, wj + 0.04, jd)) * smoothstep(0.6, 0.85, ch);
    cgBlockId = cgH2(vec2(k, seed * 91.0));
    return;
  }
  if (w >= 3.0 && w < 4.0 && abs(n.y) < 0.6) {
    float ch = max(0.15, (w - 3.0) * 10.0);
    vec3 t = normalize(vec3(-n.z, 0.0, n.x) + vec3(1e-5, 0.0, 0.0));
    float h = dot(p, t);
    float ci = floor(p.y / ch);
    float bl = ch * (2.0 + 0.6 * cgH1(ci + 3.1));
    float off = fract(ci * 0.5) * bl + cgH1(ci * 1.7 + 7.7) * bl * 0.4;
    float bi = floor((h + off) / bl);
    float dy = abs(fract(p.y / ch + 0.5) - 0.5) * ch;
    float dx = abs(fract((h + off) / bl + 0.5) - 0.5) * bl;
    float aa = max(fwidth(p.y), fwidth(h)) + 1e-4;
    float jv = texture(uNoise3D, p * (1.7 / 64.0) + 0.2).z;
    cgJoint = max(cgLine(dy, 0.007, aa), cgLine(dx, 0.005, aa) * 0.6) * (0.55 + 0.45 * smoothstep(0.3, 0.7, jv));
    cgJointChip = (1.0 - smoothstep(0.01, 0.05, dy)) * smoothstep(0.66, 0.88, texture(uNoise3D, p * (2.2 / 64.0) + 0.7).y);
    cgBlockId = cgH2(vec2(ci * 1.37 + bi, bi * 0.71 - ci));
    return;
  }
  if (w >= 5.0 && w < 6.0 && n.y > 0.5) {
    float sz = max(0.3, (w - 5.0) * 10.0);
    float ri = floor(p.z / sz);
    float off = cgH1(ri + 1.3) * sz;
    float bl = sz * (1.3 + 0.5 * cgH1(ri * 2.1 + 5.9));
    float bi = floor((p.x + off) / bl);
    float dz = abs(fract(p.z / sz + 0.5) - 0.5) * sz;
    float dx = abs(fract((p.x + off) / bl + 0.5) - 0.5) * bl;
    float aa = max(fwidth(p.x), fwidth(p.z)) + 1e-4;
    cgJoint = cgLine(min(dx, dz), 0.006, aa);
    cgBlockId = cgH2(vec2(ri * 1.7 + bi, bi * 0.37 + ri));
  }
}
vec2 stRot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
// veined marble tone around a base colour
vec3 stMarble(vec3 base, vec3 veinC, vec3 p, float veins, float fMid){
  vec4 V = cgN4(cgR2 * p * vec3(0.28, 0.55, 0.28) + 9.0);
  vec4 M = cgN4(p * 0.6 + 11.0);
  float v1 = 1.0 - smoothstep(0.0, 0.05 + 0.05 * M.x, abs(sin((p.x * 0.7 + p.y * 1.1 - p.z * 0.5) * 1.3 + (V.x + V.y) * 9.0)));
  float v2 = 1.0 - smoothstep(0.0, 0.025, abs(V.z - 0.5));
  vec3 c = base * (0.93 + 0.12 * M.x);
  return mix(c, veinC, clamp((v1 * 0.28 + v2 * 0.22) * veins * fMid, 0.0, 0.6));
}
// checker paving colour + slab joint distance (pattern: 0 W/K, 1 W/K + red strips, 2 W/R, 3 diag)
vec3 stChecker(vec2 q, float cell, float pat, out float jd, out float tid){
  vec2 g = q / cell;
  vec2 ci = floor(g); vec2 f = fract(g) - 0.5;
  jd = (0.5 - max(abs(f.x), abs(f.y))) * cell;
  tid = cgH2(ci * 0.37 + 1.7);
  float par = mod(ci.x + ci.y, 2.0);
  vec3 a = uC0, b = (pat > 1.5 && pat < 2.5) ? uC2 : uC1;
  vec3 c = par < 0.5 ? a : b;
  if (pat > 0.5 && pat < 1.5) {
    // every 5th row / column is a red strip (ref 3 forecourt)
    vec2 m5 = mod(ci, 6.0);
    if (m5.x < 0.5 || m5.y < 0.5) c = uC2;
  }
  if (pat > 3.5) {
    // white slab field with black inlay bands (red core) every 5 slabs, small checker at the crossings (ref 3)
    vec2 m5 = mod(ci, 5.0);
    bool bx = m5.x < 0.5, bz = m5.y < 0.5;
    vec2 ff = abs(fract(g) - 0.5);
    c = mix(uC0, uC0 * vec3(0.96, 0.95, 0.93), step(0.5, par) * 0.6);
    if (bx || bz) {
      c = uC1 * 1.25;
      float core = min(bx ? ff.x : 1.0, bz ? ff.y : 1.0);
      if (core < 0.13) c = uC2;
      if (bx && bz) c = (mod(floor(g.x * 3.0) + floor(g.y * 3.0), 2.0) < 0.5) ? uC0 : uC1;
    }
  } else if (pat > 2.5) {
    vec2 d = stRot(q, 0.785398) / (cell * 1.41421);
    vec2 di = floor(d);
    float pp = mod(di.x + di.y, 3.0);
    c = pp < 0.5 ? uC0 : (pp < 1.5 ? uC1 : uC2);
    vec2 fd = fract(d) - 0.5;
    jd = (0.5 - max(abs(fd.x), abs(fd.y))) * cell * 1.41421;
    tid = cgH2(di * 0.53 + 3.1);
  }
  return c;
}
// compass rose (r normalised by radius); returns colour, a < 0 → outside
vec4 stRose(vec2 q, float R){
  float r = length(q) / R;
  if (r > 1.0) return vec4(0.0, 0.0, 0.0, -1.0);
  float a = atan(q.y, q.x);
  vec3 W = uC0, K = uC1, Rd = uC2, G = uC3;
  vec3 c = W * 0.96;
  if (r > 0.95) c = K;
  else if (r > 0.86) {
    float rr = (r - 0.86) / 0.09;
    float wave = sin(a * 40.0 + sin(rr * 3.14159) * 2.0);
    c = (abs(rr - 0.5) < 0.22 && wave > 0.3) ? W : Rd;
  }
  else if (r > 0.83) c = W;
  else if (r > 0.80) c = K;
  else if (r > 0.66) c = (abs(r - 0.73) < 0.012) ? G : Rd;
  else if (r > 0.63) c = K;
  else if (abs(r - 0.34) < 0.012) c = K;
  // star rays: 32 tiny, 8 minor, 8 major (drawn in that order)
  for (int s = 0; s < 3; s++) {
    float n = s == 0 ? 32.0 : 8.0;
    float off = s == 0 ? 0.0981748 : (s == 1 ? 0.392699 : 0.0);
    float len = s == 0 ? 0.70 : (s == 1 ? 0.62 : 0.93);
    float hw = s == 0 ? 0.03 : (s == 1 ? 0.10 : 0.15);
    float st = 6.2831853 / n;
    float d = mod(a - off + st * 0.5, st) - st * 0.5;
    float u = r * cos(d), v = r * sin(d);
    if (u > 0.0 && abs(v) < hw * (1.0 - u / len)) {
      if (s == 0) c = K;
      else if (s == 1) c = v > 0.0 ? G : Rd;
      else c = v > 0.0 ? W * 1.02 : K * 1.4 + 0.02;
    }
  }
  if (r < 0.045) c = Rd;
  if (r < 0.02) c = G;
  return vec4(c, 1.0);
}
`;

const COLOR = /* glsl */ `
  vec4 aux = vCgAux;
  float cav = clamp(aux.x, 0.0, 1.0), edge = clamp(aux.y, 0.0, 1.0), strk = clamp(aux.z, 0.0, 1.0);
  float weather = uSP.x, lichenAmt = uSP.y, streakAmt = uSP.z;
  vec3 n = cgN;
  float dist = length(cameraPosition - cgP);
  float fHi = 1.0 - smoothstep(25.0, 160.0, dist);
  float fMid = 1.0 - smoothstep(120.0, 900.0, dist);
  float seed = cgSeed;
  vec3 p = cgP + vec3(uSQ.w * 37.0 + seed * 17.0);
  float up = clamp(n.y, 0.0, 1.0), vert = 1.0 - up;
  cgMasonry(cgP, n, aux.w, seed);
  vec4 L = cgN4(p * 0.09) * 0.62 + cgN4(cgR1 * p * 0.21 + 3.3) * 0.38;
  vec4 M = cgN4(p * 0.6 + 11.0) * 0.6 + cgN4(cgR2 * p * 1.35 + 5.0) * 0.4;
  vec4 H = cgN4(cgR1 * p * 23.0);
  vec4 H2 = cgN4(p * 61.0 + 2.0);
  float blockVar = (cgBlockId - 0.5) * step(0.5, aux.w + uSR.z + uSR.w);
  vec3 col;
#if ST_KIND == 0
  // white marble: cream / ivory / faint grey, veined
  float big = L.x + blockVar * 0.3 + (seed - 0.5) * 0.15;
  vec3 base = mix(uC0, uC0 * vec3(0.985, 0.995, 1.01), smoothstep(0.35, 0.65, big));
  base = mix(base, uC2, smoothstep(0.62, 0.85, big) * 0.5);
  col = stMarble(base, uC1, p, uSP.w, fMid);
#elif ST_KIND == 1
  // red stone: brick-red, mottled, darker courses, fine pale grains
  float big = L.x + blockVar * 0.5 + (seed - 0.5) * 0.3;
  col = mix(uC0, uC1, smoothstep(0.3, 0.8, big) * 0.55);
  col = mix(col, uC2, smoothstep(0.62, 0.8, M.x) * 0.35);
  col *= 0.9 + 0.2 * M.y;
  col = mix(col, uC2 * 1.3, smoothstep(0.8, 0.92, H2.x) * 0.35 * fHi);
#elif ST_KIND == 2
  // black basalt: near-black, faint grey crystals, faint white veins
  float big = L.x + blockVar * 0.4;
  col = uC0 * (0.85 + 0.35 * big);
  col = mix(col, uC1, smoothstep(0.84, 0.95, H2.x) * 0.25 * fHi);
  col = stMarble(col, uC1 * 0.6, p, uSP.w * 0.35, fMid);
#elif ST_KIND == 3
  // banded courses (white / red) in world y
  float bh = max(0.05, uPat.x);
  float yb = (cgP.y - uPat.z) / bh;
  float bi = floor(yb);
  float isRed = step(fract(bi * 0.5) * 2.0, 0.5) * step(0.25, uPat.y);
  if (uPat.y > 0.75) isRed = step(0.34, fract(bi / 3.0));
  float big = L.x + (cgH1(bi * 3.7) - 0.5) * 0.4;
  vec3 wc = stMarble(uC0 * (0.95 + 0.08 * big), uC2, p, uSP.w * 0.6, fMid);
  vec3 rc = mix(uC1, uC1 * vec3(0.62, 0.55, 0.55), smoothstep(0.3, 0.8, big) * 0.5) * (0.9 + 0.2 * M.y);
  col = mix(wc, rc, isRed);
  // course joint between bands
  float jd = abs(fract(yb + 0.5) - 0.5) * bh;
  cgJoint = max(cgJoint, cgLine(jd, 0.008, fwidth(cgP.y) + 1e-4));
#elif ST_KIND == 4 || ST_KIND == 5
  vec2 q = cgP.xz;
  float jd = 1.0, tid = 0.0;
  bool inRose = false;
#if ST_KIND == 5
  vec2 rq = stRot(cgP.xz - uRose.xy, uRose.w);
  vec4 rc = stRose(rq, uRose.z);
  if (rc.a > 0.0) {
    inRose = true;
    float ts = max(0.02, uPat.w);
    vec2 tg = rq / ts; vec2 tc = (floor(tg) + 0.5) * ts;
    vec4 rc2 = stRose(tc, uRose.z);
    col = rc2.a > 0.0 ? rc2.rgb : rc.rgb;
    vec2 tf = abs(fract(tg) - 0.5);
    float tj = (0.5 - max(tf.x, tf.y)) * ts;
    float aa = fwidth(rq.x) + 1e-4;
    float tileId = cgH2(floor(tg) * 0.71 + 3.3);
    col *= 0.9 + 0.2 * tileId;
    cgJoint = cgLine(tj, ts * 0.06, aa) * 0.8;
    jd = 1.0; tid = tileId;
  } else {
    // square field around the rose: black with red diagonal lattice
    vec2 aq = abs(rq);
    if (max(aq.x, aq.y) < uRose.z * 1.22) {
      vec2 d = stRot(rq, 0.785398) / (uRose.z * 0.22);
      vec2 fd = abs(fract(d) - 0.5);
      col = min(fd.x, fd.y) < 0.06 ? uC2 : uC1 * 1.2;
      if (max(aq.x, aq.y) > uRose.z * 1.17) col = uC0;
      jd = (0.5 - max(fd.x, fd.y)) * uRose.z * 0.22;
      tid = cgH2(floor(d) + 0.5);
      inRose = true;
    }
  }
#endif
  if (!inRose) {
    vec2 qq = stRot(q, uPat.y);
    col = stChecker(qq, max(0.1, uPat.x), uPat.z, jd, tid);
  }
  col = stMarble(col * (0.94 + 0.12 * tid), mix(uC1, uC0, step(cgLuma(col), 0.1)), p, uSP.w * 0.6, fMid);
  float aaj = max(fwidth(cgP.x), fwidth(cgP.z)) + 1e-4;
  cgJoint = max(cgJoint, cgLine(jd, 0.005, aaj));
  cgBlockId = tid;
#else
  // limestone ashlar: warm grey-cream
  float big = L.x + blockVar * 0.4 + (seed - 0.5) * 0.2;
  col = mix(uC0, uC1, smoothstep(0.45, 0.85, big) * 0.6);
  col = mix(col, uC2, smoothstep(0.6, 0.8, M.x) * 0.4);
  col *= 0.9 + 0.2 * M.y;
  col *= 1.0 - 0.18 * smoothstep(0.82, 0.95, H2.x) * fHi;
#endif
  // ---- patina / weathering (light by default: a living city)
  float pat = smoothstep(0.42, 0.72, L.y + 0.15 * strk);
  col = mix(col, col * vec3(1.0, 0.9, 0.76), pat * 0.4 * weather);
  // lichen speckles (sparse)
  float speck = smoothstep(0.88 - 0.1 * M.y * lichenAmt, 0.94, H.x) * smoothstep(0.35, 0.65, M.y) * fHi;
  col = mix(col, col * 0.35, clamp(speck * lichenAmt * 1.4, 0.0, 0.8));
  // rain-wash runs on vertical faces
  vec4 SF = cgN4(vec3(p.x * 19.0, p.y * 0.45, p.z * 19.0) + 7.0);
  vec4 SM = cgN4(vec3(p.x * 5.0, p.y * 0.16, p.z * 5.0) + 13.0);
  float sawF = fract(-p.y * 0.42 + SM.z * 3.0);
  float lenF = smoothstep(0.0, 0.04, sawF) * pow(1.0 - sawF, 1.4);
  float runs = smoothstep(0.62, 0.84, SF.x) * lenF * (0.4 + strk * 0.8);
  float lanes = smoothstep(0.58, 0.82, SM.x) * (0.3 + strk * 0.6);
  float runAmt = streakAmt * vert * fMid;
  col = mix(col, col * vec3(0.55, 0.53, 0.50), clamp(runs * 0.8 * runAmt, 0.0, 0.8));
  col = mix(col, col * vec3(0.78, 0.76, 0.73), clamp(lanes * 0.4 * runAmt, 0.0, 0.5));
  // grime in crevices + joints, worn edges
  col = mix(col, col * vec3(0.52, 0.49, 0.45), cav * (0.45 + 0.4 * weather));
  col = mix(col, col * vec3(0.45, 0.43, 0.40), cgJoint * 0.8);
  col = mix(col, col * vec3(0.70, 0.68, 0.64), cgJointChip * 0.5 * fHi);
  float chip = smoothstep(0.62, 0.78, H.y) * edge * uSQ.z;
  col = mix(col, col * 1.06, edge * 0.5);
  col = mix(col, col * vec3(0.68, 0.66, 0.62), chip * 0.7);
  col *= 1.0 - uSR.x;
  col = mix(col, col * 0.62, uSR.y * (0.4 + 0.6 * vert));
  diffuseColor.rgb *= col * uSTint;
  diffuseColor.a = 1.0;
`;

const ROUGH = /* glsl */ `
  {
    float cav2 = clamp(vCgAux.x, 0.0, 1.0), edge2 = clamp(vCgAux.y, 0.0, 1.0);
    float rn = cgN4(cgP * 2.3).x;
    float r = uSQ.x + 0.12 * (rn - 0.5) + 0.2 * cav2 - 0.35 * uSQ.y * (1.0 - cav2) * (0.5 + 0.5 * clamp(cgN.y, 0.0, 1.0)) + 0.06 * edge2;
    r += 0.25 * cgJoint;
    r = mix(r, 0.3, uSR.y * 0.6);
    roughnessFactor = clamp(r, 0.08, 0.98);
  }
`;

const NORMAL = /* glsl */ `
  {
    float dist = length(cameraPosition - cgP);
    float fHi = 1.0 - smoothstep(6.0, 70.0, dist);
    float fMid = 1.0 - smoothstep(30.0, 260.0, dist);
    if (fMid > 0.0) {
      vec3 q = cgR2 * cgP * 15.0;
      vec4 a0 = cgN4(q), ax = cgN4(q + vec3(0.35, 0.0, 0.0)), ay = cgN4(q + vec3(0.0, 0.35, 0.0)), az = cgN4(q + vec3(0.0, 0.0, 0.35));
      vec3 g = transpose(cgR2) * vec3(ax.x - a0.x, ay.x - a0.x, az.x - a0.x) / 0.35;
      float pit = smoothstep(0.32, 0.18, a0.x);
      vec3 q2 = cgP * 2.2 + 13.0;
      vec4 b0 = cgN4(q2), bx = cgN4(q2 + vec3(0.3, 0.0, 0.0)), by = cgN4(q2 + vec3(0.0, 0.3, 0.0)), bz = cgN4(q2 + vec3(0.0, 0.0, 0.3));
      vec3 g2 = vec3(bx.y - b0.y, by.y - b0.y, bz.y - b0.y) / 0.3;
      vec3 bump = g * (0.04 + 0.10 * pit) * fHi + g2 * 0.035 * fMid * (0.4 + uSP.x);
      cgBump = (bump - cgN * dot(bump, cgN)) * (1.0 - uSQ.y * 0.8);
    }
  }
`;

const AO = /* glsl */ `
  float cavA = clamp(vCgAux.x, 0.0, 1.0);
  float aoV = cgAOVolume(cgP, cgN);
  cgAO = aoV * aoV * (1.0 - 0.55 * cavA) * (1.0 - 0.5 * cgJoint);
  float occl = (1.0 - aoV) * (uAOOn > 0.5 ? 1.0 : 0.0);
  totalEmissiveRadiance += diffuseColor.rgb * uBounce * occl * (0.55 + 0.45 * max(-cgN.y, 0.0)) * (1.0 - 0.5 * cavA);
`;

// --------------------------------------------------------------------------- factory
const v3 = (c) => new THREE.Vector3(c.r, c.g, c.b);
const toLin = (hex) => new THREE.Color(hex);   // THREE.Color(hex) converts sRGB hex → linear working space

/**
 * Dressed stone material. See the header for options.
 * @returns {THREE.MeshStandardMaterial}
 */
export function stoneMaterial(o = {}) {
  const kind = KIND_ID[o.kind] !== undefined ? o.kind : 'white';
  const pal = PAL[kind];
  const C = [0, 1, 2, 3].map((i) => (o.colors && o.colors['c' + i] !== undefined ? toLin(o.colors['c' + i]) : pal[i].clone()));
  const tint = new THREE.Color(o.tint ?? 0xffffff);
  const polish = o.polish ?? (kind === 'checker' || kind === 'mosaic' ? 0.65 : kind === 'black' ? 0.5 : 0.3);
  const rough = o.rough ?? (kind === 'checker' || kind === 'mosaic' ? 0.42 : 0.58);
  let pat = new THREE.Vector4(0, 0, 0, 0);
  if (kind === 'banded') pat.set(o.band ?? 1.2, o.redFrac ?? 0.5, o.bandOffset ?? 0, 0);
  if (kind === 'checker' || kind === 'mosaic') pat.set(o.cell ?? 1.2, o.rotation ?? 0, o.pattern ?? (kind === 'mosaic' ? 1 : 0), o.tessera ?? 0.07);
  const ctr = o.center || [0, 0];
  const uniforms = {
    uC0: { value: v3(C[0]) }, uC1: { value: v3(C[1]) }, uC2: { value: v3(C[2]) }, uC3: { value: v3(C[3]) },
    uSTint: { value: v3(tint) },
    uSP: { value: new THREE.Vector4(o.weather ?? 0.25, o.lichen ?? 0.05, o.streaks ?? (o.weather ?? 0.25) * 1.2, o.veins ?? (kind === 'white' ? 0.8 : kind === 'checker' || kind === 'mosaic' ? 0.3 : 0.5)) },
    uSQ: { value: new THREE.Vector4(rough, polish, o.chips ?? 0.4, o.seed ?? 0) },
    uSR: { value: new THREE.Vector4(o.dark ?? 0, o.wet ?? 0, o.courses ?? 0, o.paving ?? 0) },
    uPat: { value: pat },
    uRose: { value: new THREE.Vector4(ctr[0], ctr[1], o.radius ?? 8, (o.kind === 'mosaic' ? (o.roseRotation ?? 0) : 0)) },
    uBounce: BOUNCE,
    ...aoUniforms(o.ao),
  };
  const mat = proceduralMaterial({
    name: 'stone-' + kind,
    params: { color: 0xffffff, roughness: rough, metalness: 0, vertexColors: !!o.vertexColors, side: o.side ?? THREE.FrontSide },
    uniforms,
    vertexHead: AUX_VERTEX_HEAD,
    vertexPre: AUX_VERTEX_PRE,
    head: HEAD(kind),
    color: COLOR,
    roughness: ROUGH,
    normal: NORMAL,
    ao: AO,
  });
  // geometry without an `aux` attribute reads zeros (never stale GL state)
  mat.defaultAttributeValues = { ...(mat.defaultAttributeValues || {}), aux: [0, 0, 0, 0] };
  mat.userData.sunken = 'stone';
  mat.userData.stone = { kind, ...o, ao: undefined };
  return mat;
}

export const whiteStone = (o = {}) => stoneMaterial({ ...o, kind: 'white' });
export const redStone = (o = {}) => stoneMaterial({ ...o, kind: 'red' });
export const blackStone = (o = {}) => stoneMaterial({ ...o, kind: 'black' });
export const limestone = (o = {}) => stoneMaterial({ ...o, kind: 'limestone' });
export const bandedStone = (o = {}) => stoneMaterial({ ...o, kind: 'banded' });
export const checkerFloor = (o = {}) => stoneMaterial({ ...o, kind: 'checker' });
/** compass-rose mosaic: o.center [x,z], o.radius, o.rotation (rad, rose), o.tessera, o.cell / o.pattern (checker outside) */
export const mosaicFloor = (o = {}) => stoneMaterial({ ...o, kind: 'mosaic', roseRotation: o.rotation ?? 0, rotation: o.checkerRotation ?? 0 });

// ---- athenaion-compatible marble presets (src/arch/* uses these)
const PRESETS = {
  weathered: { weather: 0.3, lichen: 0.06, streaks: 0.35, rough: 0.55, polish: 0.3, veins: 0.8, chips: 0.4 },
  polished: { weather: 0.12, lichen: 0.02, streaks: 0.12, rough: 0.36, polish: 0.75, veins: 1.0, chips: 0.15 },
  ruined: { weather: 0.9, lichen: 0.4, streaks: 0.9, rough: 0.8, polish: 0.0, veins: 0.6, chips: 1.0 },
  mossy: { weather: 1.0, lichen: 0.5, streaks: 1.0, rough: 0.85, polish: 0.0, veins: 0.5, chips: 1.0 },
  interior: { weather: 0.3, lichen: 0.02, streaks: 0.2, rough: 0.65, polish: 0.1, veins: 0.6, chips: 0.2, dark: 0.3 },
};
/** athenaion-compatible: marbleMaterial({ variant, tint, ao, seed, overrides, kind? }) */
export function marbleMaterial(o = {}) {
  const P = { ...(PRESETS[o.variant || 'weathered'] || PRESETS.weathered), ...(o.overrides || {}) };
  return stoneMaterial({ kind: o.kind || 'white', tint: o.tint, ao: o.ao, seed: o.seed, vertexColors: o.vertexColors, side: o.side, colors: o.colors, ...P });
}
