// Weathered white marble — the stone of every temple, column, pedestal and ruin.
// OWNER: arch/temple agent. Others import, never edit (ask in your report).
//
//   import { marbleMaterial } from '../materials/marble.js';
//   const m = marbleMaterial({ variant: 'weathered' });   // 'weathered' | 'polished' | 'ruined' | 'mossy' | 'interior'
//   const m2 = marbleMaterial({ variant: 'ruined', tint: 0xf2e8d8, ao: aoVolume, vertexColors: true });
//
// Fully procedural, world space (no UVs needed). Features: warm cream base with per-stone tone
// variation, faint grey veining, grey-black lichen speckles and patches, ochre patina, vertical
// drip streaks, grime in crevices, lighter worn edges, pitted micro-normal, moss (mossy/ruined),
// masonry joints (column drums, ashlar courses, paving) driven by aux.w.
//
// Performance: all noise comes from one tileable 64³ RGBA noise texture (4 independent smooth
// value-noise channels per fetch, see cgN4) — fast to compile on ANGLE/D3D and cheap to run.
//
// Optional per-vertex data attribute `aux` (vec4, see src/arch/geom.js):
//   x = cavity (0 exposed … 1 deep crevice)  → grime + ambient occlusion
//   y = edge/arris exposure (0 … 1)          → worn, lighter edges with chips
//   z = streak source (0 … 1)                → stronger drip streaks (faces under ledges, column shafts)
//   w = masonry flag: [1,2) column drum joints (y=(w-1)*100), [3,4) ashlar (course h=(w-3)*10), [5,6) paving (slab=(w-5)*10)
// Geometry without `aux` works (all zeros). With `vertexColors: true` the `color` attribute tints it.
// `ao` = an AO volume from src/arch/ao.js (directional sky-visibility grid) for big buildings.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { mulberry32 } from '../core/rng.js';

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
// 4 independent smooth value-noise channels in [0,1], lattice = 1 unit, period 64
vec4 cgN4(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return texture(uNoise3D, (i + f + 0.5) * (1.0 / 64.0));
}
const mat3 cgR1 = mat3(0.80, 0.60, 0.00, -0.48, 0.64, 0.60, 0.36, -0.48, 0.80);
const mat3 cgR2 = mat3(0.60, 0.00, 0.80, 0.64, 0.60, -0.48, -0.48, 0.80, 0.36);
#endif
`;

// --------------------------------------------------------------------------- shared GLSL
export const AUX_VERTEX_HEAD = /* glsl */ `
attribute vec4 aux;
varying vec4 vCgAux;
`;
export const AUX_VERTEX_PRE = /* glsl */ `vCgAux = aux;`;

export const AO_HEAD = /* glsl */ `
varying vec4 vCgAux;
uniform highp sampler3D uAOA;   // +X -X +Y -Y visibility
uniform highp sampler3D uAOB;   // +Z -Z
uniform mat4 uAOMat;            // world -> volume uvw
uniform mat3 uAORot;            // world dir -> volume local dir
uniform float uAOOn;
uniform float uAOCell;          // voxel size (m)
float cgAOVolume(vec3 p, vec3 n){
  if (uAOOn < 0.5) return 1.0;
  vec3 sp = p + n * uAOCell * 0.85;
  vec3 uvw = (uAOMat * vec4(sp, 1.0)).xyz;
  vec3 ins = step(vec3(0.0), uvw) * step(uvw, vec3(1.0));
  float inside = ins.x * ins.y * ins.z;
  if (inside < 0.5) return 1.0;
  vec3 ln = normalize(uAORot * n);
  vec4 a = texture(uAOA, uvw);
  vec2 b = texture(uAOB, uvw).xy;
  vec3 w = ln * ln;
  float v = w.x * (ln.x > 0.0 ? a.x : a.y) + w.y * (ln.y > 0.0 ? a.z : a.w) + w.z * (ln.z > 0.0 ? b.x : b.y);
  vec3 e = min(uvw, 1.0 - uvw);
  float edgeFade = smoothstep(0.0, 0.03, min(e.x, min(e.y, e.z)));
  return mix(1.0, v, edgeFade);
}
`;

const MARBLE_HEAD = /* glsl */ `
${NOISE_TEX_HEAD}
${AO_HEAD}
uniform vec3 uMTint;
uniform vec4 uMP;   // x weather, y lichen, z moss, w streaks
uniform vec4 uMQ;   // x roughness base, y polish, z veins, w chips
uniform vec4 uMR;   // x warmth, y darkness (interior), z wet, w seedShift
uniform vec4 uMS;   // x heavy weathering (hero temple: dense runs, black crust), y ochre iron stains, z black lichen crusts (ruins)
uniform float uMDebug; // debug views (see marbleMaterial)
uniform vec3 uBounce;   // warm sun-bounce fill radiance for occluded areas (× albedo)
float cgJoint = 0.0;      // shared between hooks: masonry joint mask at this fragment
float cgBlockId = 0.0;    // per-block random (ashlar / drums / paving)
float cgH1(float x){ return fract(sin(x * 91.3458) * 47453.5453); }
float cgH2(vec2 v){ return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453); }
// anti-aliased joint line of half-width w at distance d, pixel footprint aa (m): crisp up close,
// coverage-weighted (never vanishing abruptly) when the line is thinner than a pixel — joints must
// still read at 4K from 70–300 m (ref 5 drum joints, ref 1/3 ashlar courses)
float cgLine(float d, float w, float aa){
  float l = 1.0 - smoothstep(w - 0.5 * aa, w + 0.5 * aa, d);
  return l * min(1.0, 2.2 * w / aa) * (1.0 - smoothstep(0.12, 0.45, aa));
}
float cgJointChip = 0.0;  // chipped / spalled margin along joints (0..1)
void cgMasonry(vec3 p, vec3 n, float w, float seed){
  cgJoint = 0.0; cgBlockId = seed; cgJointChip = 0.0;
  if (w < 0.5) return;
  if (w < 2.0) {
    float y = (w - 1.0) * 100.0;
    float dh = mix(0.9, 1.35, fract(seed * 7.31 + 0.13));
    float yy = y + fract(seed * 3.7) * dh;
    float k = floor(yy / dh);
    float jd = abs(fract(yy / dh + 0.5) - 0.5) * dh;
    float aa = fwidth(yy) + 1e-4;
    // irregular chipped margin: the joint widens where the arris has spalled (ref 5 columns)
    float ch = texture(uNoise3D, p * vec3(0.9, 0.35, 0.9) * (1.0 / 6.4) + 0.31).x;
    float wj = 0.006 + 0.016 * smoothstep(0.6, 0.85, ch);
    cgJoint = cgLine(jd, wj, aa);
    cgJointChip = (1.0 - smoothstep(wj, wj + 0.045, jd)) * smoothstep(0.55, 0.8, ch);
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
    float jv = texture(uNoise3D, p * (1.7 / 64.0) + 0.2).z;   // tight / open joints vary along their length
    cgJoint = max(cgLine(dy, 0.008, aa), cgLine(dx, 0.006, aa) * 0.6) * (0.55 + 0.45 * smoothstep(0.3, 0.7, jv));
    cgJointChip = (1.0 - smoothstep(0.01, 0.05, dy)) * smoothstep(0.62, 0.85, texture(uNoise3D, p * (2.2 / 64.0) + 0.7).y);
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
    cgJoint = cgLine(min(dx, dz), 0.008, aa);
    cgBlockId = cgH2(vec2(ri * 1.7 + bi, bi * 0.37 + ri));
  }
}
`;

const MARBLE_COLOR = /* glsl */ `
  vec4 aux = vCgAux;
  float cav = clamp(aux.x, 0.0, 1.0), edge = clamp(aux.y, 0.0, 1.0), strk = clamp(aux.z, 0.0, 1.0);
  float weather = uMP.x, lichenAmt = uMP.y, mossAmt = uMP.z, streakAmt = uMP.w;
  vec3 n = cgN;
  float dist = length(cameraPosition - cgP);
  float fHi = 1.0 - smoothstep(25.0, 160.0, dist);
  float fMid = 1.0 - smoothstep(120.0, 900.0, dist);
  float seed = cgSeed;
  vec3 p = cgP + vec3(uMR.w * 37.0 + seed * 17.0);
  float up = clamp(n.y, 0.0, 1.0);
  float vert = 1.0 - up;
  cgMasonry(cgP, n, aux.w, seed);

  // ---- noise fetches (4 channels each)
  vec4 L = cgN4(p * 0.09) * 0.62 + cgN4(cgR1 * p * 0.21 + 3.3) * 0.38;      // x tone, y patina, z moss, w streak mask
  vec4 M = cgN4(p * 0.6 + 11.0) * 0.6 + cgN4(cgR2 * p * 1.35 + 5.0) * 0.4;  // x mid tone, y cluster, z lichen patch, w orange
  vec4 H = cgN4(cgR1 * p * 23.0);                                            // x speck, y chip, z wash, w moss colour
  vec4 H2 = cgN4(p * 61.0 + 2.0);                                            // x speck2
  vec4 S = cgN4(vec3(p.x * 3.2, p.y * 0.10, p.z * 3.2));                     // x streak, y vein warp
  vec4 S2 = cgN4(vec3(p.x * 9.0, p.y * 0.22, p.z * 9.0) + 5.0);              // x fine streak, y wash
  vec4 V = cgN4(cgR2 * p * vec3(0.28, 0.55, 0.28) + 9.0);                    // vein warp

  // ---- base tone: stone-to-stone variation (cream / ivory / faintly grey)
  float big = L.x + (cgBlockId - 0.5) * 0.35 * step(0.5, aux.w) + (seed - 0.5) * 0.2;
  vec3 cream = vec3(0.660, 0.612, 0.535);   // look-dev: less yellow (refs: lit marble ≈ #deccb8 under a golden sun)
  vec3 ivory = vec3(0.655, 0.622, 0.565);
  vec3 greyish = vec3(0.590, 0.575, 0.545);
  vec3 col = mix(cream, ivory, smoothstep(0.35, 0.65, big));
  col = mix(col, greyish, smoothstep(0.58, 0.8, big) * 0.6);
  col *= 0.90 + 0.18 * M.x;
  col = mix(col, col * vec3(1.04, 0.98, 0.90), uMR.x);  // warmth

  // ---- veining (subtle, grey)
  float vein = 1.0 - smoothstep(0.0, 0.05 + 0.04 * M.x, abs(sin((p.x * 0.7 + p.y * 1.1 - p.z * 0.5) * 1.6 + (V.x + V.y) * 9.0)));
  float vein2 = 1.0 - smoothstep(0.0, 0.03, abs(V.z - 0.5));
  col *= 1.0 - (vein * 0.10 + vein2 * 0.05) * uMQ.z * fMid;

  // ---- ochre / honey patina (iron staining)
  float pat = smoothstep(0.42, 0.72, L.y + 0.15 * strk);
  col = mix(col, col * vec3(1.0, 0.88, 0.72), pat * 0.45 * weather);

  // ---- grey-black lichen speckles + patches
  float cluster = M.y;
  // two speck populations: sparse larger dots + dense fine pitting, both clustered
  float spBig = smoothstep(0.87 - 0.12 * cluster * lichenAmt, 0.93, H.x) * smoothstep(0.35, 0.65, cluster);
  float spFine = smoothstep(0.82 - 0.14 * cluster * lichenAmt, 0.9, H2.x) * 0.55;
  float speck = max(spBig, spFine) * fHi;
  // (r5) no solid grey blotches any more (they read as camouflage at 1:1): lichen is a speckle field
  // whose dots thicken into colonies; broad tone drift stays within ±7 %
  vec4 Lb = cgN4(p * 4.2 + 41.0);
  float colony = smoothstep(0.6, 0.78, Lb.x * 0.6 + cluster * 0.4) * lichenAmt;
  float dots = smoothstep(0.58, 0.72, H2.y) * colony * fHi;
  float speckFar = smoothstep(0.5, 0.75, cluster) * lichenAmt * (1.0 - fHi) * 0.22;
  col = mix(col, vec3(0.15, 0.15, 0.14), clamp(speck * (0.55 + 0.4 * lichenAmt) + dots * 0.75, 0.0, 1.0));
  col *= 1.0 - clamp((L.z - 0.5) * 0.14 * lichenAmt * (0.6 + 0.4 * vert), -0.05, 0.07);
  col = mix(col, vec3(0.36, 0.35, 0.32), speckFar + colony * 0.12 * (1.0 - fHi));
  float orange = smoothstep(0.66, 0.78, M.w) * smoothstep(0.45, 0.7, cluster) * (0.35 + 0.65 * up);
  col = mix(col, vec3(0.62, 0.42, 0.14), orange * 0.55 * lichenAmt * fMid);
  // ruins only (uMS.z): solid black lichen crusts with ragged edges, white stone between (refs 8, 9)
  if (uMS.z > 0.0) {
    float crustM = Lb.x * 0.55 + cluster * 0.3 + (H.x - 0.5) * 0.22 + (H2.x - 0.5) * 0.1;
    float crustA = smoothstep(0.62, 0.655, crustM) * uMS.z;
    col = mix(col, vec3(0.085, 0.085, 0.08), clamp(crustA * mix(0.55, 0.92, fHi), 0.0, 0.92));
    col = mix(col, col * 1.06, (1.0 - crustA) * uMS.z * 0.5);   // the clean stone between reads whiter
  }

  // ---- rain-wash runs: long thin vertical streaks starting at random heights (joints / ledges) and
  // fading downward, dark grime runs + paler washed lanes (ref 5 columns, entablature, walls)
  float sMask = smoothstep(0.35, 0.65, L.w);
  vec4 SF = cgN4(vec3(p.x * 19.0, p.y * 0.45, p.z * 19.0) + 7.0);    // ~5 cm wide runs
  vec4 SM = cgN4(vec3(p.x * 5.0, p.y * 0.16, p.z * 5.0) + 13.0);     // ~20 cm lanes
  float sawF = fract(-p.y * 0.42 + SM.z * 3.0);                       // 0 at a run's source, 1 at its tail
  float lenF = smoothstep(0.0, 0.04, sawF) * pow(1.0 - sawF, 1.4);
  float runs = smoothstep(0.6, 0.82, SF.x) * lenF * (0.5 + 0.5 * sMask + strk * 0.6);
  float lanes = smoothstep(0.55, 0.8, SM.x * 0.7 + S.x * 0.3) * (0.4 + 0.6 * sMask + strk * 0.5);
  float runAmt = streakAmt * vert * fMid;
  col = mix(col, col * vec3(0.50, 0.48, 0.45), clamp(runs * 0.85 * runAmt, 0.0, 0.85));
  col = mix(col, col * vec3(0.70, 0.68, 0.65), clamp(lanes * 0.45 * runAmt, 0.0, 0.6));
  float wash = smoothstep(0.62, 0.85, S2.y) * vert * 0.35 * streakAmt;
  col = mix(col, col * vec3(1.10, 1.09, 1.07), wash * (1.0 - runs));

  // ---- heavy weathering (opt-in, uMS; ref 5 hero temple): denser runs, black crust in sheltered
  // zones (undersides, crevices), lichen colonies thicker, ochre iron stains — all fine-grained
  if (uMS.x + uMS.y > 0.0) {
    vec4 G2 = cgN4(vec3(p.x * 1.3, p.y * 0.07, p.z * 1.3) + 29.0);
    float runs2 = smoothstep(0.58, 0.8, SF.y) * smoothstep(0.0, 0.05, fract(-p.y * 0.3 + SM.w * 2.0)) * (1.0 - fract(-p.y * 0.3 + SM.w * 2.0));
    col = mix(col, col * vec3(0.55, 0.53, 0.50), clamp(runs2 * (0.5 + 0.5 * strk) * 0.75 * uMS.x * vert, 0.0, 0.8) * fMid);
    float crust = clamp(cav * 1.4 + max(-n.y, 0.0) * 0.5, 0.0, 1.0) * smoothstep(0.35, 0.6, M.z);
    col = mix(col, col * vec3(0.48, 0.46, 0.44), crust * 0.6 * uMS.x);
    col = mix(col, vec3(0.13, 0.13, 0.12), clamp(dots * 0.35 * uMS.x, 0.0, 0.6));
    float och = smoothstep(0.58, 0.78, G2.y * 0.6 + Lb.z * 0.4);
    col = mix(col, col * vec3(1.03, 0.84, 0.62), clamp(och * 0.5 * uMS.y, 0.0, 0.8));
  }

  // ---- grime in crevices + masonry joints
  col = mix(col, col * vec3(0.50, 0.47, 0.42), cav * (0.55 + 0.35 * weather));
  col = mix(col, col * vec3(0.42, 0.40, 0.37), cgJoint * 0.85);
  col = mix(col, col * vec3(0.66, 0.64, 0.60), cgJointChip * 0.6 * fHi);
  // ---- worn edges: lighter, with darker chips
  float chip = smoothstep(0.6, 0.76, H.y) * edge * uMQ.w;
  col = mix(col, col * 1.07, edge * 0.6);
  col = mix(col, col * vec3(0.62, 0.60, 0.56), chip * 0.8);

  // ---- moss: up-facing + crevices
  float moss = smoothstep(0.50, 0.68, L.z + 0.35 * up + 0.35 * cav - 0.25 * vert) * mossAmt;
  vec3 mossCol = mix(vec3(0.075, 0.095, 0.03), vec3(0.17, 0.18, 0.07), H.w);
  col = mix(col, mossCol, clamp(moss, 0.0, 0.92));

  // ---- interior darkening / wet
  col *= 1.0 - uMR.y;
  col = mix(col, col * 0.62, uMR.z * (0.4 + 0.6 * vert));

  diffuseColor.rgb *= col * uMTint;
  if (uMDebug > 0.5) diffuseColor.rgb = vec3(0.0);
  diffuseColor.a = 1.0;
`;

const MARBLE_ROUGH = /* glsl */ `
  {
    float cav2 = clamp(vCgAux.x, 0.0, 1.0), edge2 = clamp(vCgAux.y, 0.0, 1.0);
    float rn = cgN4(cgP * 2.3).x;
    float r = uMQ.x + 0.14 * (rn - 0.5) + 0.18 * cav2 - 0.12 * uMQ.y * (1.0 - cav2) + 0.06 * edge2;
    r = mix(r, 0.35, uMR.z * 0.6);
    roughnessFactor = clamp(r, 0.18, 0.98);
  }
`;

const MARBLE_NORMAL = /* glsl */ `
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
      vec3 bump = g * (0.05 + 0.12 * pit) * fHi + g2 * 0.04 * fMid * (0.4 + uMP.x);
      // masonry joint groove: tilt normals across the joint (fake bevel)
      cgBump = (bump - cgN * dot(bump, cgN)) * (1.0 - uMQ.y * 0.7);
    }
  }
`;

const MARBLE_AO = /* glsl */ `
  float cavA = clamp(vCgAux.x, 0.0, 1.0);
  float aoV = cgAOVolume(cgP, cgN);
  cgAO = aoV * aoV * (1.0 - 0.55 * cavA) * (1.0 - 0.5 * cgJoint);
  // approximate one-bounce GI from sunlit floors / walls into porches, ceilings and cella
  float occl = (1.0 - aoV) * (uAOOn > 0.5 ? 1.0 : 0.0);
  totalEmissiveRadiance += diffuseColor.rgb * uBounce * occl * (0.55 + 0.45 * max(-cgN.y, 0.0)) * (1.0 - 0.5 * cavA);
`;

const MARBLE_DEBUG_EMISSIVE = /* glsl */ `
  if (uMDebug > 2.5) { vec3 uvw = (uAOMat * vec4(cgP, 1.0)).xyz; totalEmissiveRadiance = (uMDebug > 3.5) ? texture(uAOA, uvw).rgb : clamp(uvw, 0.0, 1.0); }
  else if (uMDebug > 0.5) totalEmissiveRadiance = vec3(cgAOVolume(cgP, cgN)) * (uMDebug > 1.5 ? vec3(uAOOn, 1.0, 0.0) : vec3(1.0));
`;

/** shared bounce-fill radiance (warm). Scale with the sun if needed: BOUNCE.value.setRGB(...) */
export const BOUNCE = { value: new THREE.Vector3(0.30, 0.28, 0.255) }; // r5b: was 0.40/0.32/0.24 (× cream albedo → orange cella / porch walls, shots 5/6)

/** shared debug switch: 1 = AO volume (unlit), 2 = AO × (uAOOn,1,0), 3 = volume uvw, 4 = raw AO texture */
export const MARBLE_DEBUG = { value: 0 };

// --------------------------------------------------------------------------- presets
const PRESETS = {
  weathered: { weather: 0.75, lichen: 0.75, moss: 0.0, streaks: 0.85, rough: 0.62, polish: 0.15, veins: 0.8, chips: 0.7, warmth: 0.35 },
  polished: { weather: 0.25, lichen: 0.2, moss: 0.0, streaks: 0.3, rough: 0.34, polish: 0.8, veins: 1.0, chips: 0.2, warmth: 0.25 },
  ruined: { weather: 1.0, lichen: 1.0, moss: 0.25, streaks: 1.0, rough: 0.78, polish: 0.0, veins: 0.6, chips: 1.0, warmth: 0.45, crust: 0.85 },
  mossy: { weather: 1.0, lichen: 0.9, moss: 0.75, streaks: 1.0, rough: 0.82, polish: 0.0, veins: 0.5, chips: 1.0, warmth: 0.35, wet: 0.15, crust: 0.5 },
  interior: { weather: 0.5, lichen: 0.3, moss: 0.0, streaks: 0.4, rough: 0.7, polish: 0.1, veins: 0.6, chips: 0.3, warmth: 0.2, dark: 0.35 },
};

let _dummy3D = null;
export function dummy3DTexture() {
  if (!_dummy3D) {
    _dummy3D = new THREE.Data3DTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
    _dummy3D.format = THREE.RGBAFormat; _dummy3D.type = THREE.UnsignedByteType;
    _dummy3D.needsUpdate = true;
  }
  return _dummy3D;
}

/** AO uniforms for a material (shared by marble / metal). `ao` = AOVolume or null */
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

/**
 * @param {object} o
 * @param {'weathered'|'polished'|'ruined'|'mossy'|'interior'} [o.variant='weathered']
 * @param {number|string|THREE.Color} [o.tint]  multiplies albedo (default white)
 * @param {object} [o.ao] AO volume (src/arch/ao.js)
 * @param {boolean} [o.vertexColors] multiply by the geometry's `color` attribute
 * @param {number} [o.seed] shifts the noise so neighbouring buildings differ
 * @param {object} [o.overrides] any of weather, lichen, moss, streaks, rough, polish, veins, chips, warmth, dark, wet,
 *        heavy (0..1 opt-in dense rain-wash runs + black crust in sheltered zones), ochre (0..1 iron stains),
 *        crust (0..1 solid black lichen crusts; default 0.85 for 'ruined', 0.5 for 'mossy')
 * @param {number} [o.side] THREE.FrontSide (default) / DoubleSide
 */
export function marbleMaterial(o = {}) {
  const P = { wet: 0, dark: 0, ...(PRESETS[o.variant || 'weathered'] || PRESETS.weathered), ...(o.overrides || {}) };
  const tint = new THREE.Color(o.tint ?? 0xffffff);
  const uniforms = {
    uMTint: { value: new THREE.Vector3(tint.r, tint.g, tint.b) },
    uMP: { value: new THREE.Vector4(P.weather, P.lichen, P.moss, P.streaks) },
    uMQ: { value: new THREE.Vector4(P.rough, P.polish, P.veins, P.chips) },
    uMR: { value: new THREE.Vector4(P.warmth, P.dark, P.wet, o.seed ?? 0) },
    uMS: { value: new THREE.Vector4(P.heavy ?? 0, P.ochre ?? 0, P.crust ?? 0, 0) },
    uMDebug: MARBLE_DEBUG,
    uBounce: BOUNCE,
    ...aoUniforms(o.ao),
  };
  const mat = proceduralMaterial({
    name: 'marble-' + (o.variant || 'weathered'),
    params: { color: 0xffffff, roughness: P.rough, metalness: 0, vertexColors: !!o.vertexColors, side: o.side ?? THREE.FrontSide },
    uniforms,
    vertexHead: AUX_VERTEX_HEAD,
    vertexPre: AUX_VERTEX_PRE,
    head: MARBLE_HEAD,
    color: MARBLE_COLOR,
    roughness: MARBLE_ROUGH,
    normal: MARBLE_NORMAL,
    ao: MARBLE_AO,
    emissive: MARBLE_DEBUG_EMISSIVE,
  });
  mat.userData.marble = P;
  return mat;
}

/** convenience: change AO volume of an existing marble/metal material */
export function setMaterialAO(mat, ao) {
  const U = mat.userData.cgUniforms;
  if (!U || !U.uAOOn) return;
  const u = aoUniforms(ao);
  for (const k in u) U[k].value = u[k].value;
}
