// adapted from athenaion/src/water/surface.js
// Water surface seen from ABOVE (golden sea level y = 0; sunken era: the dusk sea at SUNKEN.surface).
//
// Two draws of one huge plane, both in the transparent pass (after the opaque scene):
//  1. "absorb" pass (multiplicative blend, golden only): the ring / canal / sea bed already drawn under
//     the water is multiplied by the per-channel transmittance of the water column (Beer–Lambert, view +
//     sun path) → turquoise shallows at the quays, the bed fading to teal / cobalt with depth.
//     (sunken era: the underwater core applies the medium to everything under the surface — skipped)
//  2. "surface" pass (premultiplied blend, lit MeshPhysicalMaterial with CSM shadows): body in-scatter
//     (turquoise rings, deep cobalt sea), FFT ripples with LEAN filtering + analytic swell, planar
//     reflection, GGX sun glitter + sparse sun glints, foam: quay / mole / islet lines (distance field),
//     surf bands at sea, whitecaps, waterfall plunges (impacts) and ship wakes (Kelvin V, bow waves,
//     stern trail, oar splashes), and its own premultiplied atmosphere.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { atmoUniforms } from '../core/atmosphere.js';
import { NOISE_GLSL } from '../core/glsl.js';
import { hashString } from '../core/rng.js';
import { SKY } from '../core/sky.js';
import { ATMO_GLSL } from '../core/atmosphere.js';
import { WAVES_GLSL } from './waves.js';

export const MAX_IMPACTS = 48;
export const MAX_WAKES = 40;

// ------------------------------------------------------------------ shared GLSL
export const WATER_COMMON_GLSL = /* glsl */`
uniform sampler2D tHNear; uniform vec4 uHNearB;
uniform sampler2D tHFar; uniform vec4 uHFarB;
uniform sampler2D tSNear; uniform sampler2D tSFar;   // distance to land (m), same bounds as the height maps
uniform float uLevel;
uniform vec3 uAbsorb;
uniform vec4 uSea;       // x: r0 open sea starts, y: r1 full open sea, z: canal half width shelter, w: canal end z
float wInBounds(vec2 uv){ vec2 e = min(uv, 1.0 - uv); return smoothstep(0.0, 0.004, min(e.x, e.y)); }
float wTerrainH(vec2 xz, float bias){
  vec2 un = (xz - uHNearB.xy) / (uHNearB.zw - uHNearB.xy);
  vec2 uf = (xz - uHFarB.xy) / (uHFarB.zw - uHFarB.xy);
  float hn = texture(tHNear, un, bias).r;
  float hf = texture(tHFar, uf, bias).r;
  float h = mix(-60.0, hf, wInBounds(uf));
  return mix(h, hn, wInBounds(un));
}
float wShoreDist(vec2 xz, float bias){
  vec2 un = (xz - uHNearB.xy) / (uHNearB.zw - uHNearB.xy);
  vec2 uf = (xz - uHFarB.xy) / (uHFarB.zw - uHFarB.xy);
  float dn = texture(tSNear, un, bias).r;
  float df = texture(tSFar, uf, bias).r;
  float d = mix(200.0, df, wInBounds(uf));
  return mix(d, min(dn, max(df, 0.0) + 40.0), wInBounds(un));
}
// open-sea factor (fetch): 0 inside the rings and the sheltered canal, 1 on the open sea
float wSeaK(vec2 xz){
  float r = length(xz);
  float k = smoothstep(uSea.x, uSea.y, r);
  float canal = (1.0 - smoothstep(uSea.z, uSea.z + 30.0, abs(xz.x))) * (1.0 - smoothstep(uSea.w - 60.0, uSea.w + 140.0, xz.y));
  return k * (1.0 - 0.75 * canal);
}
vec3 wBedTransmittance(float depth, float cv, float ls){
  float ct = sqrt(max(0.0, 1.0 - (1.0 - cv * cv) / 1.777));
  float cs = sqrt(max(0.0, 1.0 - (1.0 - ls * ls) / 1.777));
  vec3 T = exp(-uAbsorb * depth * (1.0 / max(ct, 0.05) + 1.0 / max(cs, 0.2)));
  // wet film on the bed: a little darker (fades in over the first ~30 cm)
  vec3 wet = mix(vec3(1.0), vec3(0.62, 0.66, 0.62), smoothstep(0.0, 0.3, depth));
  return T * wet;
}
`;

const SURF_HEAD = /* glsl */`
${ATMO_GLSL}
${WATER_COMMON_GLSL}
${WAVES_GLSL}
uniform float uTime;
uniform sampler2D tRefl; uniform sampler2D tReflDepth;
uniform mat4 uReflMatrix; uniform mat4 uReflInvVP; uniform float uReflOn; uniform float uReflPix; uniform vec2 uReflSize;
uniform vec4 uImp[${MAX_IMPACTS}]; uniform vec4 uImpB[${MAX_IMPACTS}]; uniform int uImpN;
uniform vec4 uWakeA[${MAX_WAKES}]; uniform vec4 uWakeB[${MAX_WAKES}]; uniform int uWakeN;
uniform vec3 uScatter;      // ring / canal body (turquoise)
uniform vec3 uScatterSea;   // open sea body (cobalt)
uniform vec3 uFoamCol;
uniform vec3 uAerCol;
uniform float uChop;
uniform float uDebug;
uniform float uEnvBoost;
uniform vec3 uSkyRefl;      // reflected-sky tint, rings
uniform vec3 uSkyReflSea;   // reflected-sky tint, open sea
uniform float uFrameW;
uniform float uReflGain;
uniform float uReflSmear; uniform float uReflLod;
uniform vec4 uSeaWave;      // x: large-octave gain at sea, y: mid gain, z: swell gain, w: whitecap density
uniform vec4 uShoreK;       // x: foam line width rings (m), y: surf band width sea (m), z: line strength rings, w: surf strength
uniform vec4 uGlint;        // x: density, y: cell size (m), z: open sea weight, w: rings weight
uniform float uBodyK;       // 0: no body in-scatter (sunken era from above: the core's medium does it)
uniform float uRingCalm;    // ripple gain in the rings (1 = default)
uniform vec4 uRingAmp;      // per-octave ripple gain in the rings (calm: long gentle undulations, few short ripples)
uniform vec3 uBodyLight;    // x: sun irradiance share lighting the water column, y: sky ambient gain, z: shadow floor
uniform vec3 uSkyAmbW;      // sky irradiance on the water column (linear)
uniform float uUwWaveK;
uniform float uCanalChop;   // wind chop in the sea canal (0 = calm like the rings, 1 = open sea)     // sunken era: gain on the core's wave slopes
uniform vec3 uFoamLight;    // foam: x sky ambient gain, y sun scatter gain, z forward-scatter boost
vec3 wBody;
uniform vec3 uSunIrrW;      // sun irradiance (SKY.uSunIrr)
uniform vec2 uSunSpec;      // x: visible-sun glitter gain, y: CSM-light specular kept (0 = replaced)
uniform float uBodyFres;    // r3: body in-scatter weighted by the transmitted fraction (1 - Fresnel)
uniform float uSeaOpaque;   // r3: opacity of the sea body seen from above (sunken era)
uniform vec3 uSeaBody;      // r3: its radiance
uniform float uGlintR;      // r3: glint radius (fraction of the default)
uniform float uGlintVar;    // r3: extra facet-slope variance for the sparse sun glints (broad gold glitter field, ref 4)
uniform vec3 uGlitterTint;  // colour of the glitter path (the low sun's disk is deeper gold than the scene light)

// values shared between the hooks of this material
vec3 wSkyT; float wGlint; vec3 wN; float wVar; float wFoam; vec3 wRefl; float wReflW; vec3 wTbed; float wRough;

// clumpy foam: blotches of value noise riddled with round bubble holes
float wFoamTex(vec2 p, float fw){
  float a1 = 1.0 - smoothstep(0.25, 0.6, fw * 2.13), a2 = 1.0 - smoothstep(0.25, 0.6, fw * 4.7), a3 = 1.0 - smoothstep(0.2, 0.5, fw * 3.3);
  float n = cgVnoise2(p) * 0.5 + mix(0.5, cgVnoise2(p * 2.13 + 1.7), a1) * 0.3 + mix(0.5, cgVnoise2(p * 4.7 + 3.3), a2) * 0.2;
  float bub = 0.62;
  if (a3 > 0.0) { vec3 v = cgVoronoi2(p * 3.3 + 5.1); bub = mix(0.62, smoothstep(0.06, 0.42, v.x), a3); }
  return clamp(n * (0.5 + 0.5 * bub) + 0.12 * bub, 0.0, 1.0);
}
// whitecaps: sparse crest patches on a cell grid (each grows and fades on its own cycle), elongated
// along the crest (across the wind); cell = size (m), dens = fraction of live cells
float wWhitecap(vec2 p, float cell, float dens, float seed, vec2 wind){
  vec2 wr = vec2(-wind.y, wind.x);
  vec2 q = vec2(dot(p, wr), dot(p, wind)) / cell + vec2(0.0, -uTime * 0.06);
  vec2 ci = floor(q), cf = fract(q) - 0.5;
  float h = cgHash12(ci + seed);
  float tt = uTime * (0.18 + 0.1 * h) + h * 11.0;
  float id = floor(tt), ph = fract(tt);
  float on = step(cgHash12(ci * 1.37 + id * 7.13 + seed), dens);
  vec2 c = (cgHash22(ci + id * 3.1 + seed) - 0.5) * 0.45;
  float env = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.25, 1.0, ph));
  vec2 d = (cf - c) / vec2(0.36, 0.14);
  float r = length(d) + 0.35 * (cgVnoise2(p * 0.9 + seed) - 0.5);
  float core = 1.0 - smoothstep(0.25 * env, 0.25 * env + 0.55 + 0.4 * ph, r);
  return on * core * (0.35 + 0.65 * env);
}
`;

const SURF_COLOR = /* glsl */`
  vec3 P = vec3(cgP.x, uLevel, cgP.z);
  vec3 V = cgV;
  float hT = wTerrainH(P.xz, 0.0);
  float depth = max(0.0, uLevel - hT);
  float sd = wShoreDist(P.xz, 0.0);
  float seaK = wSeaK(P.xz);
  // wind chop: the open sea, and (sheltered, but open to the sea wind) the sea canal up to the gate bridge (ref 2)
  float canalC = (1.0 - smoothstep(uSea.z * 0.5, uSea.z * 0.5 + 25.0, abs(P.x))) * smoothstep(560.0, 760.0, P.z);
  float chopK = max(seaK, canalC * uCanalChop);
  // metres per pixel (geometric mean of the two pixel axes)
  float pxw = sqrt(max(length(dFdx(P.xz)), length(dFdy(P.xz))) * min(length(dFdx(P.xz)), length(dFdy(P.xz))));
  wSkyT = mix(uSkyRefl, uSkyReflSea, seaK);
  // ---- waterfall impacts: boiling white core, broken foam spreading outward, downstream trail,
  //      radial swell rings (normals only)
  float churn = 0.0, tailF = 0.0; vec2 ringSlope = vec2(0.0);
  for (int i = 0; i < ${MAX_IMPACTS}; i++) {
    if (i >= uImpN) break;
    vec4 im = uImp[i]; vec4 ib = uImpB[i];
    vec2 d = P.xz - im.xy; float r = length(d) + 1e-3; float R = im.z;
    if (r > R * 7.0) continue;
    float h = fract(sin(float(i) * 12.9898) * 43758.5453);
    vec2 dir = d / r;
    float rn = r * (1.0 + 0.35 * (cgVnoise2(P.xz * 0.09 + h * 5.0) - 0.5));
    float core = 1.0 - smoothstep(R * 0.35, R * 1.1, rn);
    float tongues = cgVnoise3(vec3(dir * 2.4 + h * 9.0, r * 0.08 - uTime * 0.35)) * 0.65 + cgVnoise3(vec3(dir * 5.5 + h * 3.0, r * 0.2 - uTime * 0.8)) * 0.35;
    float spread = (1.0 - smoothstep(R * 0.8, R * 2.1, rn)) * smoothstep(0.38, 0.7, tongues);
    vec2 td = normalize(ib.xy + vec2(1e-4));
    float along = dot(d, td), across = abs(dot(d, vec2(-td.y, td.x)));
    float trail = smoothstep(-R * 0.5, R * 0.8, along) * (1.0 - smoothstep(R * 0.6, R * 1.6 + along * 0.3, across)) * exp(-max(along, 0.0) / (R * 2.6 + 6.0));
    float tail = smoothstep(0.0, R * 1.5, along) * (1.0 - smoothstep(R * 0.8, R * 2.2 + along * 0.5, across)) * exp(-max(along, 0.0) / (R * 7.0 + 22.0));
    float streaks = smoothstep(0.58, 0.85, cgVnoise2(vec2(dot(d, vec2(-td.y, td.x)) * 0.7 + h * 7.0, along * 0.05 - uTime * 0.25)));
    float patchy = smoothstep(0.25, 0.7, cgVnoise2(P.xz * 0.07 + h * 3.0));
    churn = max(churn, im.w * (core + spread * 0.7 + trail * 0.65 * patchy));
    tailF = max(tailF, im.w * tail * streaks * (0.5 + 0.5 * patchy));
    float ring = sin(rn * (2.6 / sqrt(max(R, 1.0))) - uTime * 3.2 + h * 6.28 + tongues * 3.0);
    float ringZone = smoothstep(R * 0.6, R * 1.2, rn) * (1.0 - smoothstep(R * 2.0, R * 4.5, rn));
    ringSlope += dir * ring * ringZone * im.w * 0.05;
  }
  // ---- ship wakes (registry.water.addWake): Kelvin V arms, transverse waves inside the V, bow wave
  //      collar along the hull, white turbulent trail astern, oar splashes for rowed ships
  float wakeF = 0.0, wakeTurb = 0.0; vec2 wakeSlope = vec2(0.0);
  for (int i = 0; i < ${MAX_WAKES}; i++) {
    if (i >= uWakeN) break;
    vec4 A = uWakeA[i]; vec4 B = uWakeB[i];   // A: bow x, z, forward dir x, z   B: hull length, beam, speed, oars (0/1)
    vec2 d = P.xz - A.xy;
    float Lh = B.x, bm = B.y, sp = B.z;
    float reach = Lh * 2.0 + sp * 45.0 + 40.0;
    float along = -dot(d, A.zw);              // distance astern of the bow
    if (along < -bm * 2.0 || along > reach) continue;
    float across = dot(d, vec2(-A.w, A.z));
    float ac = abs(across);
    float spk = clamp(sp / 5.0, 0.0, 1.6);
    // B.w packs oars (0/1) + 2 * round(foam * 4): r3 per-wake foam boost (hero trireme, ref 2: bow wave + oar churn)
    float fq = floor(B.w * 0.5 + 0.01);
    float oarsOn = B.w - 2.0 * fq;
    float foamK = 1.0 + 0.25 * fq;
    // hull half width along the hull (pointed bow, full amidships, narrower stern)
    float u = clamp(along / max(Lh, 1.0), 0.0, 1.0);
    float hw = bm * 0.5 * (along < 0.0 ? 0.0 : sqrt(clamp(u / 0.28, 0.0, 1.0)) * (1.0 - 0.35 * smoothstep(0.7, 1.0, u)));
    // bow wave: a white collar hugging the hull, strongest at the stem, fading aft
    float collarW = (0.5 + 0.9 * spk) * (1.0 + 0.3 * (foamK - 1.0) * (1.0 - smoothstep(0.0, 0.35, u)));
    // (ragged outer edge: the bow wave breaks in lumps, not a painted stripe)
    float cN = cgVnoise2(vec2(along * 0.45 + float(i) * 5.1, ac * 0.8 - uTime * 0.6));
    float collar = pow(1.0 - smoothstep(0.0, collarW * (1.2 + 0.6 * (1.0 - u)) * (0.7 + 0.6 * cN), ac - hw), 1.6) * (0.75 + 0.5 * cN) * step(-1.0, along) * (1.0 - smoothstep(Lh * 0.45, Lh * 1.05, along));
    collar *= smoothstep(-bm * 0.6, 0.0, along) * (0.45 + 0.55 * (1.0 - u)) * min(spk * foamK, 1.4);
    // breaking bow wave crest at the stem (rolls out to both sides, ref 2)
    float stem = exp(-pow(max(along, 0.0) / (Lh * 0.12 * foamK), 2.0)) * pow(1.0 - smoothstep(0.0, collarW * (1.0 + 0.7 * foamK) * (0.6 + 0.8 * cN), ac - hw), 1.4) * smoothstep(-bm * 0.9, -bm * 0.1, along);
    collar = max(collar, stem * min(1.0, spk * foamK * 1.4));
    wakeSlope += vec2(-A.w, A.z) * sign(across) * (collar * 0.18 + stem * 0.25) * sin((ac - hw) * 3.1 - uTime * 2.0 + cN * 3.0);
    // Kelvin arms (19.5 deg) starting at the bow, widening and fading astern
    float aT = along * 0.354 + hw * 0.6;
    float armW = 0.6 + bm * 0.15 + max(along, 0.0) * 0.035;
    float arm = exp(-pow((ac - aT) / armW, 2.0)) * smoothstep(0.0, Lh * 0.15, along) * exp(-max(along, 0.0) / (Lh * 1.2 + sp * 18.0 + 10.0));
    float armN = cgVnoise2(vec2(ac * 0.25, along * 0.06 - uTime * 0.1) + float(i) * 3.7);
    arm *= (0.35 + 0.9 * smoothstep(0.3, 0.75, armN)) * spk;
    // turbulent trail astern
    float sa = max(along - Lh * 0.85, 0.0);
    float trW = hw * 0.8 + bm * 0.25 + sa * 0.045;
    float trail = exp(-pow(ac / trW, 2.0)) * smoothstep(Lh * 0.6, Lh * 0.95, along) * exp(-sa / (Lh * 0.9 + sp * 12.0 + 12.0));
    float trN = cgVnoise2(vec2(across * 0.6, sa * 0.12 - uTime * 0.25) + float(i) * 1.9);
    trail *= (0.4 + 0.8 * smoothstep(0.3, 0.8, trN)) * spk;
    // oar splashes: rows of small white puffs outboard of the hull (stroke cycle ~2.2 s)
    float oars = 0.0;
    if (oarsOn > 0.5) {
      float side = ac - hw - 3.2;
      float cellA = along / 1.15;
      float ph = fract(uTime / 2.2 + cgHash12(vec2(floor(cellA), float(i))) * 0.15);
      float env = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.15, 0.6, ph));
      float spot = (1.0 - smoothstep(0.25, 0.55, length(vec2(fract(cellA) - 0.5, side / 1.3)) + 0.35 * (cgVnoise2(P.xz * 2.7 + float(i)) - 0.5))) * step(Lh * 0.18, along) * step(along, Lh * 0.8);
      // the swirls left by earlier strokes trail astern
      float sw = (1.0 - smoothstep(0.6, 1.6, abs(side))) * smoothstep(Lh * 0.2, Lh * 0.5, along) * exp(-max(along - Lh * 0.8, 0.0) / 14.0) * smoothstep(0.55, 0.8, cgVnoise2(vec2(side * 1.4, along * 0.5) + float(i)));
      oars = (spot * env + sw * 0.5) * min(foamK, 1.8);
    }
    wakeF = max(wakeF, max(max(collar, arm * 0.8), max(trail, oars)));
    wakeTurb = max(wakeTurb, trail + collar * 0.6);
    // transverse waves inside the V + diverging waves along the arms (slope only)
    float kx = 9.81 / max(sp * sp, 1.0);
    float inV = (1.0 - smoothstep(aT * 0.85, aT * 1.05 + 1.0, ac)) * smoothstep(0.0, Lh * 0.3, along) * exp(-max(along, 0.0) / (Lh * 2.0 + sp * 25.0 + 20.0));
    wakeSlope += A.zw * sin(along * kx - uTime * 0.0) * inV * 0.05 * spk;
    float armWave = sin((ac - aT) * 1.6 + along * 0.4) * exp(-pow((ac - aT) / (armW * 2.5), 2.0)) * smoothstep(0.0, Lh * 0.15, along) * exp(-max(along, 0.0) / (Lh * 2.0 + sp * 30.0 + 20.0));
    wakeSlope += vec2(-A.w, A.z) * sign(across) * armWave * 0.08 * spk;
  }
  // ---- ripples: FFT octaves (rings: calm; sea: long wind waves + swell)
  float shelter = mix(0.45, 1.0, smoothstep(0.0, 2.2, depth)) * mix(0.55, 1.0, smoothstep(0.0, 8.0, sd));
  vec4 amp = uWaveAmp * shelter * mix(uRingCalm * uRingAmp, vec4(1.0), chopK) * (1.0 + uChop * (2.2 * churn + 0.8 * tailF + 1.2 * wakeTurb));
  // wind slicks / cat's-paws: large calm and rough patches (breaks the tiling, reads as real wind)
  float slick = cgVnoise2(P.xz * 0.0061 + 3.1) * 0.6 + cgVnoise2(P.xz * 0.019 + 7.7) * 0.4;
  amp *= mix(0.6, 1.3, smoothstep(0.25, 0.75, slick));
  amp.x *= mix(1.0, uSeaWave.x, chopK);
  amp.y *= mix(1.0, uSeaWave.y, chopK);
  vec3 w0 = wWaves(P.xz, amp);
  vec2 slope = w0.xy;
  wVar = w0.z;
  slope += wSwellSlope(P.xz, uTime) * mix(0.25, 1.0, chopK) * uSeaWave.z;
  slope += ringSlope + wakeSlope;
#ifdef CG_UW
  // sunken era: the core's surface waves (core/underwater.js) so the ripples seen from above, the meniscus,
  // the caustics and the god rays all move together; split level (ref 9): pixels whose dome-port origin is
  // under the wavy surface belong to the underwater view
  if (uwUnder(cameraPosition, -V) > 0.5) discard;
  { float uh; vec2 ug; vec3 uH; uwWaveDeriv(P.xz, uh, ug, uH); slope += ug * uUwWaveK; }
#endif
  wN = normalize(vec3(-slope.x, 1.0, -slope.y));
  // ---- foam
  vec2 q0 = P.xz;
  float fwF = pxw * 0.714;
  float ft = wFoamTex(q0 * 0.714, fwF);
  float fine = mix(0.5, cgVnoise2(P.xz * 3.1), 1.0 - smoothstep(0.25, 0.6, pxw * 3.1)) * 0.5
             + mix(0.5, cgVnoise2(P.xz * 7.3 + uTime * 0.2), 1.0 - smoothstep(0.25, 0.6, pxw * 7.3)) * 0.5;
  // foam lines against quays / moles / islets: a thin white contact line (rings, calm) and, at sea,
  // surf bands rolling in toward the rocks
  float lapN = cgVnoise2(P.xz * 0.11 + uTime * 0.05);
  float lineW = mix(uShoreK.x, uShoreK.x * 6.0, seaK) * (0.6 + 0.8 * lapN);
  float line = (1.0 - smoothstep(0.0, max(lineW, pxw * 0.7), sd - 0.2)) * mix(uShoreK.z, 1.0, seaK);
  float surfW = uShoreK.y * (0.7 + 0.6 * cgVnoise2(P.xz * 0.02));
  float surfPh = sd * 0.42 - uTime * 1.1 + cgVnoise2(P.xz * 0.05) * 6.0;
  float surf = seaK * uShoreK.w * smoothstep(0.35, 0.9, sin(surfPh) * 0.5 + 0.5 + 0.25 * (lapN - 0.5)) * (1.0 - smoothstep(surfW * 0.3, surfW, sd));
  // beaches: shallow run-up (depth < ~0.3 m)
  float lap = 0.18 * sin(uTime * 1.15 + cgVnoise2(P.xz * 0.12) * 9.0) + 0.1 * cgVnoise2(P.xz * 0.6);
  float beach = (1.0 - smoothstep(0.0, 0.32 + 0.25 * cgVnoise2(P.xz * 0.2), depth + lap)) * step(0.0005, depth);
  // whitecaps on the open sea (two cell scales)
  vec2 wind = normalize(vec2(0.62, 0.78));
  float wc = 0.0;
  if (seaK > 0.02 && uSeaWave.w > 0.0) {
    wc = max(wWhitecap(P.xz, 26.0, uSeaWave.w * seaK, 1.7, wind), wWhitecap(P.xz + 37.0, 11.0, uSeaWave.w * seaK * 1.4, 4.3, wind) * 0.85);
    wc *= smoothstep(0.25, 0.7, slick + 0.2);
  }
  float amount = max(max(beach * 0.85, line), max(surf, min(1.0, churn + tailF * 0.4)));
  // r3: close-range wakes (shot 2 hero): their own fine bubbly lace (0.2-0.5 m cells; the 1.4 m foam cells are
  // coarser than a 2 m bow-wave collar and turned it into a flat white stripe)
  float rk = 1.0 - smoothstep(0.05, 0.25, pxw);
  float wl = cgVnoise2(P.xz * 2.3 + vec2(uTime * 0.15, 0.0)) * 0.55 + cgVnoise2(P.xz * 5.7 - vec2(0.0, uTime * 0.3)) * 0.3 + cgVnoise2(P.xz * 0.9) * 0.15;
  float wakeLace = smoothstep(0.6, 0.74, wl + (min(wakeF, 1.0) - 0.74) * 0.75) * step(0.05, wakeF);
  amount = max(amount, max(wakeF * mix(0.78, 0.3, rk), wc));
  // broad patches (low-frequency mask) filled with lacy, bubbly foam
  vec2 lq0 = q0 * 0.126;
  float ftLow = cgVnoise2(lq0) * 0.7 + cgVnoise2(lq0 * 2.1 + 3.3) * 0.3;
  float mask = smoothstep(1.0 - amount * 1.25 - 0.1, 1.0 - amount * 1.25 + 0.25, ftLow);
  float lace = smoothstep(0.5 - 0.42 * amount, 0.6 - 0.36 * amount, ft * 0.8 + fine * 0.3);
  float cov = mask * lace;
  wFoam = clamp(cov * min(1.0, amount * 2.4) + smoothstep(0.7, 1.0, churn) * 0.7, 0.0, 1.0);
  // solid cores (bow collar, whitecap crests, contact line) stay white when the lace is unresolved
  // (r3: close up the lace is resolved — the cores break into bubbly lumps instead of a flat white band)
  float coreBreak = mix(smoothstep(0.42, 0.6, ft * 0.75 + fine * 0.45), 1.0, smoothstep(0.04, 0.2, pxw));
  wFoam = max(wFoam, smoothstep(0.55, 1.0, max(wakeF * 0.9 * (1.0 - rk), max(wc, line * 0.8))) * (0.55 + 0.45 * ft) * coreBreak);
  wFoam = max(wFoam, wakeLace * rk * 0.95);
  // aerated water between the foam patches (milky turquoise: plunge pools, wake trails)
  float aerW = clamp(churn * 1.3 + wakeTurb * 0.5, 0.0, 1.0) * (1.0 - wFoam);
  // ---- sparse sun glints (tiny facets mirroring the sun; re-rolled a few times a second, smooth
  //      grow/shrink): the sparkling glitter path of refs 1, 2, 3, 5
  wGlint = 0.0;
  float gK = mix(uGlint.w, uGlint.z, chopK);
  if (gK > 0.0 && uSunDir.y > 0.01) {
    vec3 Hs = normalize(normalize(uSunDir) + V);
    float cellS = uGlint.y;
    vec2 gc = P.xz / cellS;
    vec2 gi = floor(gc), gf = fract(gc) - 0.5;
    float gh = cgHash12(gi + 17.0);
    float tt = uTime * 2.5 + gh * 7.0;
    float tick = floor(tt), env = sin(3.14159 * fract(tt));
    float gr = cgHash12(gi + tick * 13.17);
    vec2 go = vec2(cgHash12(gi * 1.37 + tick * 5.31 + 3.0), cgHash12(gi * 2.11 + tick * 3.7 + 9.0)) - 0.5;
    // facet must be a plausible ripple tilt: only near the specular direction of the mean surface
    // probability that a sub-pixel facet has the tilt that mirrors the sun into the eye (Gaussian slope
    // distribution around the resolved normal, sub-pixel variance + a capillary floor)
    vec2 dl = Hs.xz / max(Hs.y, 0.05) - wN.xz / wN.y;
    float plaus = exp(-dot(dl, dl) / (2.0 * (wVar + 0.0025 + uGlintVar)));
    float dens = uGlint.x * gK * plaus * (0.35 + 0.65 * smoothstep(0.2, 0.8, slick)) * (1.0 - wFoam) * (1.0 - aerW);
    vec2 gfw = max(fwidth(gc), vec2(1e-4));
    vec2 gs = max(vec2(1.0), gfw / vec2(0.35, 0.35));
    float rr = length((gf - go * 0.4) / gs);
    wGlint = step(1.0 - dens, gr) * (1.0 - smoothstep(0.08 * env * uGlintR, 0.3 * env * uGlintR + 1e-3, rr));
    if (wGlint > 0.5) wN = Hs;
  }
  // ---- water body (single-scatter, saturates with the optical depth along the view)
  float cv = max(dot(wN, V), 0.02);
  float ls = max(uSunDir.y, 0.03);
  float turbid = 1.0 + 2.0 * churn + 1.0 * wakeTurb;
  vec3 Tv = exp(-uAbsorb * depth * turbid / max(sqrt(max(0.0, 1.0 - (1.0 - cv * cv) / 1.777)), 0.05));
  wTbed = mix(vec3(1.0), wBedTransmittance(depth * turbid, max(V.y, 0.02), ls), uBodyK);
  vec3 scat = mix(uScatter, uScatterSea, seaK * smoothstep(4.0, 16.0, depth));
  vec3 body = scat * (1.0 - Tv) * uBodyK;
  body = mix(body, uAerCol * (0.75 + 0.5 * fine), aerW * 0.75 * uBodyK);
  vec3 foamAlb = uFoamCol * (0.82 + 0.18 * fine);
  float F = 0.02 + 0.98 * pow(1.0 - cv, 5.0);
  // the body is light scattered inside the sunlit water column: emitted (not shadowed by the walls the
  // way a diffuse surface would be — the column under a shadow edge is still lit at depth)
  // r3: only the light refracted OUT of the water reaches the eye (1 - F): at grazing views (water-level shots 2, 4)
  // the mirror wins and the lit buildings show in it (ref 4), instead of a flat turquoise glow
  wBody = body * (uSunIrrW * uBodyLight.x * max(uSunDir.y, 0.05) + uSkyAmbW * uBodyLight.y) * (1.0 - wFoam) * mix(1.0, 1.0 - F, uBodyFres);
  diffuseColor.rgb = foamAlb * wFoam;
  // foam is a dense scattering layer: sky light from every side and light forward-scattered from the
  // low sun behind it (backlit wakes / surf stay white, refs 1, 2)
  float fwd = pow(max(dot(-V, normalize(uSunDir)), 0.0), 4.0);
  wBody += foamAlb * wFoam * (uSkyAmbW * uFoamLight.x + uSunIrrW * uFoamLight.y * (0.3 + fwd * uFoamLight.z));
  diffuseColor.a = 1.0 - (1.0 - F) * (1.0 - wFoam) * (1.0 - aerW * 0.75 * uBodyK);
  // r3 (sunken era from above, ref 9): the dusk sea is a dark navy body with the sky mirrored on it — the bright
  // underwater medium behind the surface shows through only faintly
  diffuseColor.a = 1.0 - (1.0 - diffuseColor.a) * (1.0 - uSeaOpaque);
  wBody += uSeaBody * uSeaOpaque * (1.0 - F) * (1.0 - wFoam);
  // ---- planar reflection (perturbed ray, aerial perspective of the reflected point)
  {
    vec3 R = reflect(-V, wN); R.y = max(R.y, 0.004); R = normalize(R);
    vec4 c0 = uReflMatrix * vec4(P, 1.0); vec2 uv0 = c0.xy / c0.w;
    float iD = 0.0;
    vec2 tx = 3.0 / uReflSize;
    for (int k = 0; k < 5; k++) {
      vec2 o2 = k == 0 ? vec2(0.0) : k == 1 ? vec2(tx.x, 0.0) : k == 2 ? vec2(-tx.x, 0.0) : k == 3 ? vec2(0.0, tx.y) : vec2(0.0, -tx.y);
      float dk = textureLod(tReflDepth, uv0 + o2, 0.0).r;
      if (dk < 0.99999) { vec4 o = uReflInvVP * vec4((uv0 + o2) * 2.0 - 1.0, dk * 2.0 - 1.0, 1.0); iD += 1.0 / max(distance(o.xyz / o.w, P), 1.0); }
    }
    iD *= 0.2;
    float D = iD > 1e-5 ? 1.0 / iD : 1e6;
    vec4 c1 = D > 3e4 ? uReflMatrix * vec4(R, 0.0) : uReflMatrix * vec4(P + R * D, 1.0);
    vec2 uv1 = c1.xy / c1.w;
    float lod = clamp(log2(max(1.0, 2.0 * sqrt(wVar) / max(uReflPix, 1e-5))) * 0.5, 0.0, 2.5);
    float vs = clamp(sqrt(wVar) * uReflSmear, 0.0, 0.03);
    float jt = cgHash12(gl_FragCoord.xy + vec2(uFrameW * 7.13, uFrameW * 3.71)) - 0.5;
    vec3 rc = vec3(0.0);
    for (int k = 0; k < 4; k++) rc += textureLod(tRefl, uv1 + vec2(0.0, (float(k) - 1.5 + jt) * vs), lod * uReflLod).rgb;
    rc *= 0.25;
    float d1 = textureLod(tReflDepth, uv1, 0.0).r;
    if (d1 >= 0.99999) rc *= wSkyT;
#ifdef CG_UW
    // (sunken era: start the air segment above the wave crests — from inside a crest the core's air/water split
    //  treated the reflected mountains as seen through the water and tinted them bright blue; same for far points whose
    //  depth-reconstructed position lands under the surface — everything in the reflection is above the water)
    if (d1 < 0.99999) { vec4 o = uReflInvVP * vec4(uv1 * 2.0 - 1.0, d1 * 2.0 - 1.0, 1.0); vec3 oP = o.xyz / o.w; oP.y = max(oP.y, uLevel + 2.5); rc = atmoApplyFrom(rc, P + vec3(0.0, 2.0, 0.0), oP); }
#else
    if (d1 < 0.99999) { vec4 o = uReflInvVP * vec4(uv1 * 2.0 - 1.0, d1 * 2.0 - 1.0, 1.0); rc = atmoApplyFrom(rc, P + vec3(0.0, 0.05, 0.0), o.xyz / o.w); }
#endif
    vec2 e = min(uv1, 1.0 - uv1);
    wReflW = uReflOn * smoothstep(0.0, 0.06, min(e.x, e.y)) * step(0.0, c1.w);
    wRefl = rc;
    if (uDebug > 6.5 && uDebug < 7.5) wRefl = textureLod(tRefl, uv0, 0.0).rgb;
  }
  float a2 = pow(0.05, 4.0) + 1.0 * wVar;
  wRough = mix(pow(a2, 0.25), 0.75, wFoam);
  if (wGlint > 0.5) wRough = 0.07;
`;

const SURF_ROUGH = /* glsl */`roughnessFactor = wRough;`;
const SURF_NORMAL = /* glsl */`cgBump = wN - cgN;`;
const INJECT_REFL = /* glsl */`
#if defined( RE_IndirectSpecular )
  radiance = mix(radiance * mix(uEnvBoost * wSkyT, vec3(1.0), wFoam), wRefl, wReflW * (1.0 - wFoam));
  radiance *= mix(uReflGain, 1.0, wFoam);
#endif
`;
// sun glitter toward the VISIBLE sun (ATMO.uSunDir — the art-directed disk, see core/sky.js), replacing the
// specular of the CSM light (which comes from the side in the golden shots)
const SUN_SPEC = /* glsl */`
{
  vec3 Ls = normalize(uSunDir);
  float NoL = max(dot(wN, Ls), 0.0);
  float NoV = max(dot(wN, cgV), 1e-3);
  vec3 Hh = normalize(Ls + cgV);
  float NoH = max(dot(wN, Hh), 0.0), VoH = max(dot(cgV, Hh), 0.0);
  float a = max(wRough * wRough, 0.0025), aa = a * a;
  float dd = NoH * NoH * (aa - 1.0) + 1.0;
  float D = aa / (3.14159265 * dd * dd);
  float k = a * 0.5;
  float Gs = (NoL / (NoL * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
  float Fs = 0.02 + 0.98 * pow(1.0 - VoH, 5.0);
  vec3 spec = uSunIrrW * (D * Gs * Fs / (4.0 * NoV)) * step(0.0, Ls.y);
  reflectedLight.directSpecular = reflectedLight.directSpecular * uSunSpec.y + spec * uGlitterTint * (1.0 - wFoam) * uSunSpec.x;
}
`;
const FOG_PREMUL = /* glsl */`
#ifdef USE_FOG
{
  vec3 cgA = atmoApply(vec3(0.0), vAtmoWorldPos);
  vec3 cgB = atmoApply(vec3(1.0), vAtmoWorldPos) - cgA;
  float a = gl_FragColor.a;
  gl_FragColor.rgb = gl_FragColor.rgb * cgB + cgA * a + (1.0 - a) * cgA * (1.0 - wTbed);
}
#endif
if (uDebug > 0.5) {
  if (uDebug < 1.5 || (uDebug > 6.5 && uDebug < 7.5)) gl_FragColor = vec4(wRefl, 1.0);
  else if (uDebug < 2.5) gl_FragColor = vec4(vec3(wReflW), 1.0);
  else if (uDebug < 3.5) gl_FragColor = vec4(wN * 0.5 + 0.5, 1.0);
  else if (uDebug < 4.5) gl_FragColor = vec4(vec3(wFoam), 1.0);
  else if (uDebug < 5.5) gl_FragColor = vec4(wTbed, 1.0);
  else if (uDebug < 6.5) gl_FragColor = vec4(vec3(sqrt(wVar) * 10.0), 1.0);
  else if (uDebug > 7.5 && uDebug < 8.5) gl_FragColor = vec4(vec3(fract(wShoreDist(vAtmoWorldPos.xz, 0.0) / 20.0)), 1.0);
  else if (uDebug > 8.5 && uDebug < 9.5) gl_FragColor = vec4(vec3(wSeaK(vAtmoWorldPos.xz)), 1.0);
  else if (uDebug > 9.5 && uDebug < 10.5) gl_FragColor = vec4(vec3(fract(max(0.0, uLevel - wTerrainH(vAtmoWorldPos.xz, 0.0)) / 10.0)), 1.0);
}
`;

// ------------------------------------------------------------------ absorb pass
const ABSORB_VERT = /* glsl */`
varying vec3 vW;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
const ABSORB_FRAG = /* glsl */`
varying vec3 vW;
uniform vec3 uSunDir;
${WATER_COMMON_GLSL}
void main(){
  float depth = max(0.0, uLevel - wTerrainH(vW.xz, 0.0));
  vec3 V = normalize(cameraPosition - vW);
  vec3 T = wBedTransmittance(depth, max(V.y, 0.02), max(uSunDir.y, 0.03));
  gl_FragColor = vec4(T, 1.0);
}
`;

/** the lit surface material over a uniforms object */
export function makeSurfaceMaterial(uniforms) {
  const mat = proceduralMaterial({
    name: 'waterSurface',
    type: 'physical',
    params: {
      color: 0xffffff, roughness: 0.08, metalness: 0, ior: 1.333, specularIntensity: 1,
      transparent: true, depthWrite: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    },
    uniforms,
    head: NOISE_GLSL + SURF_HEAD,
    color: SURF_COLOR,
    roughness: SURF_ROUGH,
    normal: SURF_NORMAL,
    emissive: `totalEmissiveRadiance += wBody;`,
  });
  const baseCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    baseCompile(shader, r);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${INJECT_REFL}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${SUN_SPEC}`)
      .replace('#include <fog_fragment>', FOG_PREMUL);
  };
  mat.userData.shaderKey += ':w' + hashString(INJECT_REFL + FOG_PREMUL + SUN_SPEC).toString(36);
  mat.userData.sunken = 'none';
  return mat;
}

/**
 * @param {object} o  maps {near, far} (height captures), shore {near, far} (distance fields), waves
 *   (waveUniforms()), reflection (PlanarReflection), level, absorb (bool), look (uniform overrides)
 * @returns {{ group, surface, absorb, material, uniforms, addImpact, setImpacts, addWake, setWakes }}
 */
export function createWaterSurface(engine, { maps, shore, waves, reflection, size = 90000, level = 0, absorb: withAbsorb = true, look = {} }) {
  const near = maps.near, far = maps.far;
  const common = {
    tHNear: { value: near.tex }, uHNearB: { value: new THREE.Vector4(...near.bounds) },
    tHFar: { value: far.tex }, uHFarB: { value: new THREE.Vector4(...far.bounds) },
    tSNear: { value: shore.near.tex }, tSFar: { value: shore.far.tex },
    uLevel: { value: level },
    uAbsorb: { value: new THREE.Vector3(0.32, 0.075, 0.05) },
    uSea: { value: new THREE.Vector4(860, 1250, 70, 1060) },
  };
  const impacts = [], impactsB = [], wakesA = [], wakesB = [];
  for (let i = 0; i < MAX_IMPACTS; i++) { impacts.push(new THREE.Vector4(0, 0, 1, 0)); impactsB.push(new THREE.Vector4(0, 1, 0, 0)); }
  for (let i = 0; i < MAX_WAKES; i++) { wakesA.push(new THREE.Vector4(0, 0, 0, 1)); wakesB.push(new THREE.Vector4(30, 5, 0, 0)); }
  const uniforms = {
    ...common,
    ...waves,
    uChop: { value: 1.6 },
    uEnvBoost: { value: 1 / 0.34 },
    uFrameW: SKY.uFrame,
    uReflGain: { value: 1.35 },
    uReflSmear: { value: 0.4 }, uReflLod: { value: 0.25 },
    uSkyRefl: { value: new THREE.Vector3(0.32, 0.55, 0.78) },
    uSkyReflSea: { value: new THREE.Vector3(0.08, 0.16, 0.36) },
    uDebug: { value: Number(engine.params?.get?.('waterDebug') || 0) },
    ...reflection.uniforms,
    uReflPix: { value: 0.001 },
    uImp: { value: impacts }, uImpB: { value: impactsB }, uImpN: { value: 0 },
    uWakeA: { value: wakesA }, uWakeB: { value: wakesB }, uWakeN: { value: 0 },
    uScatter: { value: new THREE.Vector3(0.004, 0.085, 0.19) },
    uScatterSea: { value: new THREE.Vector3(0.001, 0.01, 0.06) },
    uFoamCol: { value: new THREE.Vector3(0.80, 0.83, 0.84) },
    uAerCol: { value: new THREE.Vector3(0.07, 0.14, 0.14) },
    uSeaWave: { value: new THREE.Vector4(2.6, 1.7, 1.0, 0.16) },
    uShoreK: { value: new THREE.Vector4(0.7, 34, 0.35, 1.0) },
    uGlint: { value: new THREE.Vector4(0.10, 0.9, 1.0, 0.6) },
    uBodyK: { value: 1 },
    uRingCalm: { value: 0.6 },
    uRingAmp: { value: new THREE.Vector4(1.0, 0.6, 0.35, 0.25) },
    uBodyLight: { value: new THREE.Vector3(1.0, 1.0, 0.5) },
    uSkyAmbW: { value: new THREE.Vector3(0.9, 1.1, 1.4) },
    uFoamLight: { value: new THREE.Vector3(0.5, 0.06, 3.0) },
    uUwWaveK: { value: 1.0 },
    uCanalChop: { value: 0.55 },
    uSunIrrW: SKY.uSunIrr,
    uSunSpec: { value: new THREE.Vector2(2.5, 0) },
    uGlitterTint: { value: new THREE.Vector3(1.0, 0.82, 0.55) },
    uBodyFres: { value: 1.0 },
    uGlintVar: { value: 0.0 },
    uGlintR: { value: 1.0 },
    uSeaOpaque: { value: 0.0 }, uSeaBody: { value: new THREE.Vector3(0.02, 0.05, 0.1) },
  };
  for (const [k, v] of Object.entries(look)) setU(uniforms, k, v);
  const mat = makeSurfaceMaterial(uniforms);

  const geo = new THREE.PlaneGeometry(size, size, 48, 48).rotateX(-Math.PI / 2);
  geo.translate(0, level, 0);
  const surface = new THREE.Mesh(geo, mat);
  surface.name = 'waterSurface';
  surface.renderOrder = -20;
  surface.frustumCulled = false;
  surface.castShadow = false; surface.receiveShadow = true;
  surface.userData.castShadow = false; surface.userData.receiveShadow = true;
  surface.userData.isWater = true;

  const group = new THREE.Group();
  group.name = 'water';
  let absorb = null;
  if (withAbsorb) {
    const absorbMat = new THREE.ShaderMaterial({
      name: 'waterAbsorb',
      uniforms: { ...common, ...atmoUniforms() },
      vertexShader: ABSORB_VERT,
      fragmentShader: ABSORB_FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      fog: false,
    });
    absorb = new THREE.Mesh(geo, absorbMat);
    absorb.name = 'waterAbsorb';
    absorb.renderOrder = -21;
    absorb.frustumCulled = false;
    absorb.castShadow = false; absorb.receiveShadow = false;
    absorb.userData.castShadow = false; absorb.userData.receiveShadow = false;
    absorb.userData.noPatch = true; absorb.userData.isWater = true;
    group.add(absorb);
    reflection.hidden.push(absorb);
  }
  reflection.hidden.push(surface);
  surface.onBeforeRender = (renderer, scene, camera) => {
    reflection.update(renderer, scene, camera);
    const fovR = (camera.fov * Math.PI) / 180;
    uniforms.uReflPix.value = (2 * Math.tan(fovR / 2)) / reflection.rt.height;
  };
  group.add(surface);

  let n = 0;
  function addImpact(im) {
    if (n >= MAX_IMPACTS) return false;
    impacts[n].set(im.x, im.z, im.radius, im.strength);
    const d = im.dir || [0, 1];
    impactsB[n].set(d[0], d[1], im.speed || 0, 0);
    n++;
    uniforms.uImpN.value = n;
    return true;
  }
  function setImpacts(list) {
    n = 0; uniforms.uImpN.value = 0;
    for (const im of [...list].filter(Boolean).sort((p, q) => (q.strength || 0) - (p.strength || 0))) addImpact(im);
    return n;
  }
  // ---- wakes
  const wakes = [];
  function syncWakes() {
    const list = wakes.filter((w) => w.speed > 0.05 || w.moored === false).slice(0, MAX_WAKES);
    list.forEach((w, i) => {
      const a = (w.heading * Math.PI) / 180, fx = Math.sin(a), fz = -Math.cos(a);
      wakesA[i].set(w.x, w.z, fx, fz);
      wakesB[i].set(w.length, w.beam, w.speed, (w.oars ? 1 : 0) + 2 * Math.round(Math.max(0, w.foam || 0) * 4));
    });
    uniforms.uWakeN.value = list.length;
  }
  /**
   * Register a moving hull. w = { pos:[x,z] | [x,y,z] (BOW position), heading (compass deg of travel),
   * length (hull m), beam (m), speed (m/s), oars (bool) } — or { x, z, ... }. Returns a handle with
   * update(partial) for animated ships.
   */
  function addWake(w) {
    const p = w.pos || [w.x, w.z];
    const rec = {
      x: p.length === 3 ? p[0] : p[0], z: p.length === 3 ? p[2] : p[1],
      heading: w.heading ?? 0, length: w.length ?? 30, beam: w.beam ?? 5, speed: w.speed ?? 3, oars: !!w.oars, foam: w.foam ?? 0, id: w.id,
    };
    wakes.push(rec);
    syncWakes();
    return {
      update(o) {
        if (o.pos) { rec.x = o.pos[0]; rec.z = o.pos.length === 3 ? o.pos[2] : o.pos[1]; }
        for (const k of ['heading', 'length', 'beam', 'speed', 'oars', 'foam']) if (o[k] !== undefined) rec[k] = o[k];
        syncWakes();
      },
      remove() { const i = wakes.indexOf(rec); if (i >= 0) wakes.splice(i, 1); syncWakes(); },
    };
  }
  function setWakes(list) { wakes.length = 0; for (const w of list || []) addWake(w); return wakes.length; }
  return { group, surface, absorb, material: mat, uniforms, addImpact, setImpacts, impactCount: () => n, addWake, setWakes, wakes, syncWakes };
}

export function setU(U, k, v) {
  if (!U[k]) return;
  if (Array.isArray(v) && U[k].value?.fromArray) U[k].value.fromArray(v); else U[k].value = v;
}
