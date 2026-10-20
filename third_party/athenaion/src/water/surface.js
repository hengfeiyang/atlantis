// Water surface at sea level (lagoon, river, channel, sea).
//
// Two draws of one huge plane, both in the transparent pass (after the terrain):
//  1. "absorb" pass (multiplicative blend): the terrain already drawn under the water is the real
//     lake bed; it is multiplied by the per-channel transmittance of the water column
//     (Beer–Lambert, view + sun path) → turquoise shallows, bed fading to teal in depth, and a
//     seamless shoreline.
//  2. "surface" pass (premultiplied blend, lit MeshPhysicalMaterial with CSM shadows): body
//     in-scatter, foam (shore, rapids, waterfall impacts), FFT ripples with LEAN filtering,
//     planar reflection (with correct aerial perspective of the reflected objects), GGX sun glitter,
//     and its own atmosphere over the premultiplied colour.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { ATMO_GLSL, atmoUniforms } from '../core/atmosphere.js';
import { NOISE_GLSL } from '../core/glsl.js';
import { hashString } from '../core/rng.js';
import { SKY } from '../core/sky.js';
import { VMAX } from './flow.js';

export const MAX_IMPACTS = 48;
export const MAX_ROCKS = 16;
export function rockUniforms() {
  const a = [];
  for (let i = 0; i < MAX_ROCKS; i++) a.push(new THREE.Vector4(0, 0, 1, 0));
  return { uRock: { value: a }, uRockN: { value: 0 }, uRockDir: { value: new THREE.Vector2(0, 1) } };
}
export function fillRocks(U, list, dir = [0, 1]) {
  for (const [k, v] of Object.entries(rockUniforms())) if (!U[k]) U[k] = v;
  let n = 0;
  for (const r of list || []) {
    if (n >= MAX_ROCKS) break;
    U.uRock.value[n++].set(r.x, r.z, r.r, r.strength ?? (r.h > 0.05 ? 1 : 0.55));
  }
  U.uRockN.value = n;
  const l = Math.hypot(dir[0], dir[1]) || 1;
  U.uRockDir.value.set(dir[0] / l, dir[1] / l);
  return n;
}

// ------------------------------------------------------------------ shared GLSL
export const WATER_COMMON_GLSL = /* glsl */`
uniform sampler2D tHNear; uniform vec4 uHNearB;
uniform sampler2D tHFar; uniform vec4 uHFarB;
uniform float uLevel;
uniform vec3 uAbsorb;
uniform sampler2D tFlow; uniform vec4 uFlowB;
uniform sampler2D tFlow2; uniform vec4 uFlow2B;   // detail flow map (rapids near a camera), optional
float wInBounds(vec2 uv){ vec2 e = min(uv, 1.0 - uv); return smoothstep(0.0, 0.004, min(e.x, e.y)); }
float wK2;   // weight of the detail flow map (the shot-7 river reach) at the last wFlow() lookup
vec4 wFlow(vec2 xz, out float inF){
  vec2 fuv = (xz - uFlowB.xy) / (uFlowB.zw - uFlowB.xy);
  vec4 fl = texture(tFlow, fuv); inF = wInBounds(fuv);
  vec2 fuv2 = (xz - uFlow2B.xy) / (uFlow2B.zw - uFlow2B.xy);
  vec2 e2 = min(fuv2, 1.0 - fuv2);
  float k2 = smoothstep(0.0, 0.08, min(e2.x, e2.y));
  wK2 = k2;
  if (k2 > 0.0) { fl = mix(fl, texture(tFlow2, fuv2), k2); inF = max(inF, k2); }
  return fl;
}
// terrain height under the water (captured mesh), bias = texture LOD bias (blur)
float wTerrainH(vec2 xz, float bias){
  vec2 un = (xz - uHNearB.xy) / (uHNearB.zw - uHNearB.xy);
  vec2 uf = (xz - uHFarB.xy) / (uHFarB.zw - uHFarB.xy);
  float hn = texture(tHNear, un, bias).r;
  float hf = texture(tHFar, uf, bias).r;
  float h = mix(-40.0, hf, wInBounds(uf));
  return mix(h, hn, wInBounds(un));
}
// transmittance of the water column for the bed seen from direction cosine cv (view) with the sun at cosine ls
// turbidity: river current and white water carry silt and bubbles (optical depth multiplier)
uniform float uRiverSilt;   // extra optical depth of the silty shot-7 river (its bed is not visible in ref 7)
float wTurbid(vec2 xz){
  float k;
  vec4 fl = wFlow(xz, k);
  return 1.0 + (2.6 * fl.w + 3.0 * fl.z) * k + uRiverSilt * smoothstep(0.25, 0.7, fl.w * k) * wK2;
}
vec3 wBedTransmittance(float depth, float cv, float ls){
  float ct = sqrt(max(0.0, 1.0 - (1.0 - cv * cv) / 1.777));
  float cs = sqrt(max(0.0, 1.0 - (1.0 - ls * ls) / 1.777));
  vec3 T = exp(-uAbsorb * depth * (1.0 / max(ct, 0.05) + 1.0 / max(cs, 0.2)));
  // wet + silt/algae film on the bed: darker, olive-green (fades in over the first ~30 cm)
  vec3 wet = mix(vec3(1.0), vec3(0.42, 0.47, 0.40), smoothstep(0.0, 0.3, depth));
  return T * wet;
}
`;

const SURF_HEAD = /* glsl */`
${ATMO_GLSL}
${WATER_COMMON_GLSL}
uniform float uTime;
uniform sampler2D tWaves;
uniform vec4 uWaveScale; uniform vec4 uWaveAmp; uniform vec4 uWaveAng;
uniform sampler2D tRefl; uniform sampler2D tReflDepth;
uniform mat4 uReflMatrix; uniform mat4 uReflInvVP; uniform float uReflOn; uniform float uReflPix; uniform vec2 uReflSize;
uniform vec4 uImp[${MAX_IMPACTS}]; uniform vec4 uImpB[${MAX_IMPACTS}]; uniform int uImpN;
uniform vec4 uRock[${MAX_ROCKS}]; uniform int uRockN; uniform vec2 uRockDir;   // boulders standing in the river: x, z, radius, strength
uniform vec3 uScatter;
uniform vec3 uFoamCol;
uniform vec3 uAerCol;
uniform float uChop;
uniform float uDebug;
uniform float uEnvBoost;
uniform vec3 uSkyRefl;
uniform float uFrameW;
uniform float uReflGain;
uniform float uReflSmear; uniform float uReflLod;
// choppy river (shot-7 reach, ref 7): x fine-chop gain, y glint density, z glint cell (m), w strength
uniform vec4 uRiver;
uniform vec3 uRiverSky;    // sky-reflection tint on the river (silver, not the lagoon's deep teal)
uniform vec3 uRiverBody;   // silty steel-blue body colour of the river
uniform vec2 uRiverFoam;   // x: whitecap amount, y: extra foam near the cascade band
uniform vec4 uRiverAmp;    // per-octave wave slope gain on the river
uniform vec4 uRiver2;      // x: standing-wave crest gain, y: glint bias toward crests, zw: river direction (toward the camera)

// values shared between the hooks of this material
vec4 wPre0; vec3 wDbgL; vec3 wDbgF; vec3 wSkyT; float wGlint; vec3 wN; float wVar; float wFoam; vec3 wRefl; float wReflW; vec3 wTbed; float wRough;

vec3 wOct(vec2 p, float scale, float ang, float amp){
  float c = cos(ang), s = sin(ang);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) / scale;
  vec4 w = texture(tWaves, q);
  vec2 g = vec2(c * w.x + s * w.y, -s * w.x + c * w.y) * amp;
  float v = max(0.0, 0.5 * (w.z + w.w - w.x * w.x - w.y * w.y)) * amp * amp;
  return vec3(g, v);
}
// 4 octaves of the FFT tile; amp4 = per-octave slope amplitude
vec3 wWaves(vec2 p, vec4 amp4){
  // large octave: domain-warped so the 37 m tile never reads as a grid from the air
  vec2 wq = p * 0.0125;
  vec2 warp = vec2(cgVnoise2(wq), cgVnoise2(wq + 5.3)) * 28.0;
  vec3 r = wOct(p + warp, uWaveScale.x, uWaveAng.x, amp4.x);
  r += wOct(p + vec2(13.7, 5.1), uWaveScale.y, uWaveAng.y, amp4.y);
  r += wOct(p + vec2(3.3, 17.9), uWaveScale.z, uWaveAng.z, amp4.z);
  r += wOct(p + vec2(7.9, 1.3), uWaveScale.w, uWaveAng.w, amp4.w);
  return r;
}
// clumpy foam: blotches of value noise riddled with round bubble holes (streaky when p is stretched)
// fw = pixel footprint in p units: octaves finer than ~2 px fade to their mean (no moiré at grazing angles)
float wFoamTex(vec2 p, float fw){
  float a1 = 1.0 - smoothstep(0.25, 0.6, fw * 2.13), a2 = 1.0 - smoothstep(0.25, 0.6, fw * 4.7), a3 = 1.0 - smoothstep(0.2, 0.5, fw * 3.3);
  float n = cgVnoise2(p) * 0.5 + mix(0.5, cgVnoise2(p * 2.13 + 1.7), a1) * 0.3 + mix(0.5, cgVnoise2(p * 4.7 + 3.3), a2) * 0.2;
  float bub = 0.62;
  if (a3 > 0.0) { vec3 v = cgVoronoi2(p * 3.3 + 5.1); bub = mix(0.62, smoothstep(0.06, 0.42, v.x), a3); }
  return clamp(n * (0.5 + 0.5 * bub) + 0.12 * bub, 0.0, 1.0);
}
`;

const SURF_COLOR = /* glsl */`
  vec3 P = vec3(cgP.x, uLevel, cgP.z);
  vec3 V = cgV;
  float hT = wTerrainH(P.xz, 0.0);
  float depth = max(0.0, uLevel - hT);
  float depthSoft = max(0.0, uLevel - wTerrainH(P.xz, 2.5));
  // ---- flow field
  float inF;
  vec4 fl = wFlow(P.xz, inF);
  vec2 flow = (fl.xy - 0.5) * ${(2 * VMAX).toFixed(1)} * inF;
  float turb = fl.z * inF, current = fl.w * inF;
  float fspeed = length(flow);
  // the shot-7 river reach (detail flow map, running water): choppy, silty, silver (ref 7)
  float rivK = smoothstep(0.25, 0.7, current) * wK2 * uRiver.w;
  wSkyT = mix(uSkyRefl, uRiverSky, rivK);
  // ---- waterfall impacts: boiling white core, broken foam spreading outward, downstream trail,
  //      radial swell rings (normals only)
  float churn = 0.0, tailF = 0.0; vec2 ringSlope = vec2(0.0); vec2 impFlow = vec2(0.0);
  for (int i = 0; i < ${MAX_IMPACTS}; i++) {
    if (i >= uImpN) break;
    vec4 im = uImp[i]; vec4 ib = uImpB[i];
    vec2 d = P.xz - im.xy; float r = length(d) + 1e-3; float R = im.z;
    if (r > R * 7.0) continue;
    float h = fract(sin(float(i) * 12.9898) * 43758.5453);
    vec2 dir = d / r;
    float rn = r * (1.0 + 0.35 * (cgVnoise2(P.xz * 0.09 + h * 5.0) - 0.5));          // ragged outline
    float core = 1.0 - smoothstep(R * 0.35, R * 1.1, rn);
    // foam spreading outward in broken tongues (angular noise drifting outward with time)
    // (noise over the unit direction, not atan(): no seam where the angle wraps)
    float tongues = cgVnoise3(vec3(dir * 2.4 + h * 9.0, r * 0.08 - uTime * 0.35)) * 0.65 + cgVnoise3(vec3(dir * 5.5 + h * 3.0, r * 0.2 - uTime * 0.8)) * 0.35;
    float spread = (1.0 - smoothstep(R * 0.8, R * 2.1, rn)) * smoothstep(0.38, 0.7, tongues);
    // downstream trail along the flow / impact direction
    vec2 td = normalize(ib.xy + vec2(1e-4));
    float along = dot(d, td), across = abs(dot(d, vec2(-td.y, td.x)));
    float trail = smoothstep(-R * 0.5, R * 0.8, along) * (1.0 - smoothstep(R * 0.6, R * 1.6 + along * 0.3, across)) * exp(-max(along, 0.0) / (R * 2.6 + 6.0));
    // long tail: broken foam streaks drifting far downstream, fanning out (refs 2, 3, 7)
    float tail = smoothstep(0.0, R * 1.5, along) * (1.0 - smoothstep(R * 0.8, R * 2.2 + along * 0.5, across)) * exp(-max(along, 0.0) / (R * 7.0 + 22.0));
    float streaks = smoothstep(0.58, 0.85, cgVnoise2(vec2(dot(d, vec2(-td.y, td.x)) * 0.7 + h * 7.0, along * 0.05 - uTime * 0.25)));
    float patchy = smoothstep(0.25, 0.7, cgVnoise2(P.xz * 0.07 + h * 3.0));
    churn = max(churn, im.w * (core + spread * 0.7 + trail * 0.65 * patchy));
    tailF = max(tailF, im.w * tail * streaks * (0.5 + 0.5 * patchy));
    // swell rings radiating from the plunge (slope only, irregular)
    float ring = sin(rn * (2.6 / sqrt(max(R, 1.0))) - uTime * 3.2 + h * 6.28 + tongues * 3.0);
    float ringZone = smoothstep(R * 0.6, R * 1.2, rn) * (1.0 - smoothstep(R * 2.0, R * 4.5, rn));
    ringSlope += dir * ring * ringZone * im.w * 0.05;
    impFlow += dir * im.w * 1.6 * exp(-r / (R * 2.2));
  }
  flow += impFlow; fspeed = length(flow);
  // ---- boulders in the river (ref 7): white collars piled against them and broken wakes trailing
  //      downstream toward the camera
  float rockF = 0.0;
  for (int i = 0; i < ${MAX_ROCKS}; i++) {
    if (i >= uRockN) break;
    vec4 rk = uRock[i];
    vec2 d = P.xz - rk.xy;
    float r = length(d);
    if (r > rk.z * 9.0 + 4.0) continue;
    float along = dot(d, uRockDir), across = dot(d, vec2(-uRockDir.y, uRockDir.x));
    float rn = r / rk.z + 0.45 * (cgVnoise2(P.xz * 1.1 + float(i) * 7.1) - 0.5);
    float up = smoothstep(0.2, -0.8, along / rk.z);                     // upstream face: the water piles up
    float collar = smoothstep(0.85, 1.0, rn) * (1.0 - smoothstep(1.25, 1.9 + 0.6 * up, rn));
    float wl = max(along, 0.0) / rk.z;
    float wake = smoothstep(0.4, 1.2, wl) * exp(-wl / 8.0) * (1.0 - smoothstep(0.7 + 0.3 * wl, 1.2 + 0.4 * wl, abs(across) / rk.z));
    wake *= 0.55 + 0.45 * cgVnoise2(vec2(across * 1.3 / rk.z + float(i) * 3.3, wl * 0.6 - uTime * 0.9));
    rockF = max(rockF, rk.w * max(collar * (0.7 + 0.3 * up), wake * 0.55));
  }
  // ---- ripples (flow-advected, two phases)
  float shelter = mix(mix(0.45, 1.0, smoothstep(0.0, 2.2, depth)), 1.0, current * 0.7);
  float rough = 1.0 + uChop * (2.0 * current + 3.0 * turb + 2.2 * churn + 0.8 * tailF);
  vec4 amp = uWaveAmp * shelter * rough;
  // wind slicks / cat's-paws: large calm and rough patches (breaks the tiling, reads as real wind)
  float slick = cgVnoise2(P.xz * 0.0061 + 3.1) * 0.6 + cgVnoise2(P.xz * 0.019 + 7.7) * 0.4;
  amp *= mix(0.6, 1.3, smoothstep(0.25, 0.75, slick));
  amp.x *= mix(1.0, 1.7, smoothstep(10.0, 25.0, depthSoft) * (1.0 - current)); // open water: more swell
  // river: short steep wavelets (resolved facets flashing sky / dark body), less long swell
  amp *= mix(vec4(1.0), uRiverAmp, rivK);
  const float TP = 3.0;
  float ph0 = fract(uTime / TP), ph1 = fract(uTime / TP + 0.5);
  float b0 = 1.0 - abs(2.0 * ph0 - 1.0), b1 = 1.0 - b0;
  vec2 o0 = flow * (ph0 - 0.5) * TP, o1 = flow * (ph1 - 0.5) * TP;
  vec3 w0 = wWaves(P.xz - o0, amp);
  vec3 w1 = wWaves(P.xz - o1 + vec2(37.3, 11.9), amp);
  float bn = inversesqrt(b0 * b0 + b1 * b1);
  vec2 slope = (w0.xy * b0 + w1.xy * b1) * bn;
  wVar = (w0.z * b0 + w1.z * b1);
  slope += ringSlope;
  // standing waves in rapids: phase-locked crests across the current (they do not travel downstream).
  // Phase = distance along the flow measured from 36 m cell centres (2x2 cells blended), so a
  // spatially varying flow direction never shears the pattern (|P|·dθ would scramble it).
  float crestFoam = 0.0, crestSw = 0.0;
  if (turb > 0.04) {
    vec2 fd = fspeed > 1e-3 ? flow / fspeed : vec2(0.0, 1.0);
    vec2 fn = vec2(-fd.y, fd.x);
    vec2 cg = P.xz / 36.0 - 0.5, ci = floor(cg), cf = fract(cg);
    cf = cf * cf * (3.0 - 2.0 * cf);
    float cw = 0.0, sw = 0.0;
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(float(k & 1), float(k >> 1));
      vec2 C = (ci + o + 0.5) * 36.0;
      vec2 d = P.xz - C;
      float w = (o.x > 0.5 ? cf.x : 1.0 - cf.x) * (o.y > 0.5 ? cf.y : 1.0 - cf.y);
      float al = dot(d, fd), ac = dot(d, fn);
      float ph = al * 1.25 * (1.0 + 0.8 * rivK) + cgHash12(C) * 6.283 + cgVnoise2(vec2(ac * 0.13, al * 0.05) + C * 0.01) * 5.0 + 0.35 * sin(uTime * 2.3 + ac * 0.3);
      cw += cos(ph) * w; sw += sin(ph) * w;
    }
    float sa = turb * 0.36 * (1.0 + uRiver2.x * rivK) * smoothstep(0.2, 0.7, cgVnoise2(P.xz * 0.045 + 3.0) + 0.35 * rivK);
    // 5 m crests are unresolved from afar (aerial shots): fade the slope into LEAN variance there
    float far = smoothstep(0.25, 1.2, max(length(dFdx(P.xz)), length(dFdy(P.xz))));
    slope += fd * cw * sa * 0.8 * (1.0 - far);
    wVar += sa * sa * (0.2 + 0.3 * far);
    crestFoam = smoothstep(0.45, 0.9, sw) * sa * 4.5 / (1.0 + 0.6 * uRiver2.x * rivK);
    crestSw = sw;
  }
  wN = normalize(vec3(-slope.x, 1.0, -slope.y));
  wDbgF = uDebug > 20.5 ? vec3(rockF, rivK, 0.0) : vec3(current, turb, churn);
  // ---- foam
  vec2 fdir = fspeed > 1e-3 ? flow / fspeed : vec2(0.0, 1.0);
  // (no flow-aligned ROTATION of the coordinates: rotating world positions by a spatially varying
  //  angle shears them by |P|·dθ — hundreds of metres here. Streaks come from a 2-tap line
  //  integral along the flow instead.)
  vec2 q0 = P.xz - o0, q1 = P.xz - o1 + vec2(19.1, 7.7);
  vec2 sc = vec2(0.42);
  // (geometric mean of the two pixel axes: at grazing angles the foam lace stays resolved across the view;
  //  the long axis is supersampled by the jittered accumulation)
  float pxw = sqrt(max(length(dFdx(P.xz)), length(dFdy(P.xz))) * min(length(dFdx(P.xz)), length(dFdy(P.xz))));   // metres per pixel
  float fwF = pxw * 0.714;
  vec2 sOff = fdir * min(2.2, 0.4 + fspeed * 0.5) * 0.714;
  float ft0 = wFoamTex(q0 * sc * 1.7, fwF) * 0.6 + wFoamTex(q0 * sc * 1.7 - sOff, fwF) * 0.4;
  float ft1 = wFoamTex(q1 * sc * 1.7 + 3.7, fwF) * 0.6 + wFoamTex(q1 * sc * 1.7 + 3.7 - sOff, fwF) * 0.4;
  float ft = ft0 * b0 + ft1 * b1;   // lacy detail (~1.4 m), streaked along the current
  float fine = mix(0.5, cgVnoise2(P.xz * 3.1), 1.0 - smoothstep(0.25, 0.6, pxw * 3.1)) * 0.5
             + mix(0.5, cgVnoise2(P.xz * 7.3 - o0 * 2.0), 1.0 - smoothstep(0.25, 0.6, pxw * 7.3)) * 0.5;
  // shoreline lapping
  float lap = 0.18 * sin(uTime * 1.15 + cgVnoise2(P.xz * 0.12) * 9.0) + 0.1 * cgVnoise2(P.xz * 0.6);
  float shore = (1.0 - smoothstep(0.0, 0.32 + 0.25 * cgVnoise2(P.xz * 0.2), depth + lap)) * step(0.0005, depth);
  float white = clamp(turb * 0.78 + crestFoam * 0.35 * smoothstep(0.4, 0.7, ft), 0.0, 1.0);
  float amount = max(max(shore * 0.85, white), min(1.0, churn + tailF * 0.4));
  amount = max(amount, current * 0.06);
  amount = max(amount, rockF);
  // river whitecaps: broken white water streaming toward the camera from the cascade band (ref 7)
  amount = max(amount, rivK * uRiverFoam.x * (0.35 + 1.3 * turb) + rivK * uRiverFoam.y * smoothstep(0.02, 0.4, churn + tailF));
  // broad patches (low-frequency mask) filled with lacy, bubbly foam: low amounts give a few
  // separate patches instead of thin iso-lines of a thresholded noise
  vec2 lq0 = q0 * sc * 0.3, lq1 = q1 * sc * 0.3 + 1.3;
  float ftLow = (cgVnoise2(lq0) * 0.7 + cgVnoise2(lq0 * 2.1 + 3.3) * 0.3) * b0 + (cgVnoise2(lq1) * 0.7 + cgVnoise2(lq1 * 2.1 + 3.3) * 0.3) * b1;
  float mask = smoothstep(1.0 - amount * 1.25 - 0.1, 1.0 - amount * 1.25 + 0.25, ftLow);
  // (narrow transition: lace with real holes, not a milky film of partial coverage)
  float lace = smoothstep(0.5 - 0.42 * amount, 0.6 - 0.36 * amount, ft * 0.8 + fine * 0.3);
  float cov = mask * lace;
  // river: the white water rolls in bands along the standing-wave crests (ref 7), not in round blotches
  cov *= mix(1.0, 0.25 + 0.95 * smoothstep(-0.35, 0.55, crestSw + 0.25 * (ft - 0.5)), rivK);
  wFoam = clamp(cov * min(1.0, amount * 2.4) + smoothstep(0.7, 1.0, churn) * 0.7, 0.0, 1.0);
  // boulder collars and wakes: broken white water directly (the lace masks of the open river would
  // thin them to nothing at these grazing angles)
  wFoam = max(wFoam, rockF * smoothstep(0.5, 0.78, ft * 0.45 + fine * 0.2 + rockF * 0.45));
  // aerated water between the foam patches: bubbles under the surface scatter light (milky
  // turquoise, opaque — the bed disappears in rapids and plunge pools)
  float aerW = clamp(smoothstep(0.55, 1.0, turb) * 0.6 + churn * 1.3, 0.0, 1.0) * (1.0 - wFoam);
  // ---- sun glitter on the choppy river (ref 7: silver glints all over it). A sparse set of tiny
  //      facets (world cells, re-rolled a few times a second; each glint grows and shrinks smoothly, no
  //      popping in the video) is tilted to mirror the sun into the eye; the lit material renders them
  //      with the real sun, its cascaded shadows and a low roughness.
  wGlint = 0.0;
  if (rivK * uRiver.y > 0.0 && uSunDir.y > 0.03) {
    vec3 Hs = normalize(normalize(uSunDir) + V);
    // cells in the frame of the reach (fixed direction: no shear), longer across the current, so the
    // glints string out along the wave crests like the ref's sparkling lines
    vec2 rd = uRiver2.zw, rn = vec2(-rd.y, rd.x);
    vec2 gc = vec2(dot(P.xz, rn) / (uRiver.z * 2.2), dot(P.xz, rd) / uRiver.z);
    vec2 gi = floor(gc), gf = fract(gc) - 0.5;
    float gh = cgHash12(gi + 17.0);
    float tt = uTime * 2.5 + gh * 7.0;
    float tick = floor(tt), env = sin(3.14159 * fract(tt));
    float gr = cgHash12(gi + tick * 13.17);
    vec2 go = vec2(cgHash12(gi * 1.37 + tick * 5.31 + 3.0), cgHash12(gi * 2.11 + tick * 3.7 + 9.0)) - 0.5;
    float onCrest = mix(1.0, 0.15 + 2.2 * smoothstep(0.1, 0.85, crestSw), uRiver2.y);
    float dens = uRiver.y * onCrest * (0.35 + 0.65 * smoothstep(0.2, 0.8, slick)) * (1.0 - wFoam) * (1.0 - aerW);
    // (a glint stays at least ~1 px tall far away: foreshortened cells would otherwise average it away)
    vec2 gfw = max(fwidth(gc), vec2(1e-4));
    vec2 gs = max(vec2(1.0), gfw / vec2(0.25, 0.6));
    float rr = length((gf - go * vec2(0.3, 0.4)) / gs);
    wGlint = step(1.0 - dens, gr) * (1.0 - smoothstep(0.08 * env, 0.3 * env + 1e-3, rr)) * rivK;
    if (wGlint > 0.5) wN = Hs;
  }
  // ---- water body (single-scatter, saturates with the optical depth along the view)
  float cv = max(dot(wN, V), 0.02);
  float ls = max(uSunDir.y, 0.03);
  float turbid = 1.0 + (2.6 * current + 3.0 * turb) + 2.0 * churn + uRiverSilt * rivK;
  vec3 Tv = exp(-uAbsorb * depth * turbid / max(sqrt(max(0.0, 1.0 - (1.0 - cv * cv) / 1.777)), 0.05));
  wTbed = wBedTransmittance(depth * turbid, max(V.y, 0.02), ls);
  vec3 body = uScatter * (1.0 - Tv);
  body = mix(body, uRiverBody * (0.8 + 0.4 * fine), rivK);
  body = mix(body, uAerCol * (0.75 + 0.5 * fine), aerW * 0.75);
  // caustics on the bed (as extra diffuse: only where the sun reaches)
  vec2 cp = P.xz * 0.55 + slope * 3.0;
  vec3 cvn = cgVoronoi2(cp + vec2(uTime * 0.12, uTime * 0.07));
  float caus = pow(1.0 - smoothstep(0.0, 0.35, cvn.y - cvn.x), 3.0);
  body += vec3(0.32, 0.36, 0.3) * caus * 0.35 * wTbed * smoothstep(0.08, 0.6, depth) * (1.0 - smoothstep(2.0, 6.0, depth));
  // foam lit as a rough white diffuse layer
  vec3 foamAlb = uFoamCol * (0.82 + 0.18 * fine);
  float F = 0.02 + 0.98 * pow(1.0 - cv, 5.0);
  diffuseColor.rgb = mix(body, foamAlb, wFoam);
  wTbed *= 1.0;
  diffuseColor.a = 1.0 - (1.0 - F) * (1.0 - wFoam) * (1.0 - aerW * 0.75);
  // ---- planar reflection (perturbed ray, aerial perspective of the reflected point)
  {
    vec3 R = reflect(-V, wN); R.y = max(R.y, 0.004); R = normalize(R);
    vec4 c0 = uReflMatrix * vec4(P, 1.0); vec2 uv0 = c0.xy / c0.w;
    // distance to the reflected object: 5 taps averaged in 1/D (a single nearest tap makes the
    // perturbed lookup jump in blocks wherever D switches between a near object and the sky)
    float iD = 0.0;
    vec2 tx = 3.0 / uReflSize;
    for (int k = 0; k < 5; k++) {
      vec2 o2 = k == 0 ? vec2(0.0) : k == 1 ? vec2(tx.x, 0.0) : k == 2 ? vec2(-tx.x, 0.0) : k == 3 ? vec2(0.0, tx.y) : vec2(0.0, -tx.y);
      float dk = textureLod(tReflDepth, uv0 + o2, 0.0).r;
      if (dk < 0.99999) { vec4 o = uReflInvVP * vec4((uv0 + o2) * 2.0 - 1.0, dk * 2.0 - 1.0, 1.0); iD += 1.0 / max(distance(o.xyz / o.w, P), 1.0); }
    }
    iD *= 0.2;
    float D = iD > 1e-5 ? 1.0 / iD : 1e6;
    float d0 = textureLod(tReflDepth, uv0, 0.0).r;
    vec4 c1 = D > 3e4 ? uReflMatrix * vec4(R, 0.0) : uReflMatrix * vec4(P + R * D, 1.0);
    vec2 uv1 = c1.xy / c1.w;
    float lod = clamp(log2(max(1.0, 2.0 * sqrt(wVar) / max(uReflPix, 1e-5))) * 0.5, 0.0, 2.5);
    // unresolved ripples smear the mirror image VERTICALLY (glitter paths / streaky reflections):
    // 4 taps along the reflection's v axis, spread by the sub-pixel slope deviation
    // (taps dithered per pixel and per accumulated sample → a smooth smear instead of 4 ghost copies)
    float vs = clamp(sqrt(wVar) * uReflSmear, 0.0, 0.03);
    float jt = cgHash12(gl_FragCoord.xy + vec2(uFrameW * 7.13, uFrameW * 3.71)) - 0.5;
    vec3 rc = vec3(0.0);
    for (int k = 0; k < 4; k++) rc += textureLod(tRefl, uv1 + vec2(0.0, (float(k) - 1.5 + jt) * vs), lod * uReflLod).rgb;
    rc *= 0.25;
    float d1 = textureLod(tReflDepth, uv1, 0.0).r;
    // reflected SKY is deepened (art direction: the refs show deep blue-teal water under a pale sky;
    // ripples mostly mirror the higher, bluer sky); reflected objects keep their colour
    if (d1 >= 0.99999) rc *= wSkyT;
    if (d1 < 0.99999) { vec4 o = uReflInvVP * vec4(uv1 * 2.0 - 1.0, d1 * 2.0 - 1.0, 1.0); rc = atmoApplyFrom(rc, P + vec3(0.0, 0.05, 0.0), o.xyz / o.w); }
    vec2 e = min(uv1, 1.0 - uv1);
    wReflW = uReflOn * smoothstep(0.0, 0.06, min(e.x, e.y)) * step(0.0, c1.w);
    wRefl = rc;
    if (uDebug > 6.5 && uDebug < 7.5) wRefl = textureLod(tRefl, uv0, 0.0).rgb;
    if (uDebug > 7.5 && uDebug < 8.5) wRefl = vec3(fract(D / 100.0), fract(D / 1000.0), d0 > 0.99999 ? 1.0 : 0.0);
    if (uDebug > 8.5 && uDebug < 9.5) wRefl = vec3(uv0, 0.0);
  }
  // sub-pixel ripple variance → GGX roughness (halved: the eye reads distant ripples as streaky
  // anisotropic glints, an isotropic lobe of the full variance smears the mirror image into milk)
  float a2 = pow(0.05, 4.0) + 1.0 * wVar;
  wRough = mix(pow(a2, 0.25), 0.75, wFoam);
  if (wGlint > 0.5) wRough = 0.09;
`;

const SURF_ROUGH = /* glsl */`roughnessFactor = wRough;`;
const SURF_NORMAL = /* glsl */`cgBump = wN - cgN;`;
const INJECT_REFL = /* glsl */`
#if defined( RE_IndirectSpecular )
  // the IBL is the sky at SKY.uEnvScale of its visible radiance: a mirror needs the visible sky
  radiance = mix(radiance * mix(uEnvBoost * wSkyT, vec3(1.0), wFoam), wRefl, wReflW * (1.0 - wFoam));
  radiance *= mix(uReflGain, 1.0, wFoam);
  if (uDebug > 13.5 && uDebug < 14.5) radiance = vec3(10.0, 0.0, 0.0);
  if (uDebug > 14.5) { wPre0 = vec4(material.dfg, material.roughness, dot(geometryNormal, geometryViewDir)); }
#endif
`;
const FOG_PREMUL = /* glsl */`
vec4 wPre = gl_FragColor;
#ifdef USE_FOG
{
  vec3 cgA = atmoApply(vec3(0.0), vAtmoWorldPos);
  vec3 cgB = atmoApply(vec3(1.0), vAtmoWorldPos) - cgA;
  float a = gl_FragColor.a;
  gl_FragColor.rgb = gl_FragColor.rgb * cgB + cgA * a + (1.0 - a) * cgA * (1.0 - wTbed);
}
#endif
if (uDebug > 0.5) {
  if (uDebug < 1.5 || (uDebug > 6.5 && uDebug < 10.5)) gl_FragColor = vec4(wRefl, 1.0);
  else if (uDebug < 2.5) gl_FragColor = vec4(vec3(wReflW), 1.0);
  else if (uDebug < 3.5) gl_FragColor = vec4(wN * 0.5 + 0.5, 1.0);
  else if (uDebug < 4.5) gl_FragColor = vec4(vec3(wFoam), 1.0);
  else if (uDebug < 5.5) gl_FragColor = vec4(wTbed, 1.0);
  else if (uDebug < 6.5) gl_FragColor = vec4(vec3(sqrt(wVar) * 10.0), 1.0);
  else if (uDebug > 10.5 && uDebug < 11.5) gl_FragColor = vec4(wPre.rgb, 1.0);
  else if (uDebug > 11.5 && uDebug < 12.5) gl_FragColor = vec4(vec3(wPre.a), 1.0);
  else if (uDebug > 12.5 && uDebug < 13.5) gl_FragColor = vec4(vec3(wRough), 1.0);
  else if (uDebug > 13.5 && uDebug < 14.5) gl_FragColor = vec4(wPre.rgb, 1.0);
  else if (uDebug > 14.5 && uDebug < 15.5) gl_FragColor = vec4(wPre0.rgb, 1.0);
  else if (uDebug > 15.5) gl_FragColor = vec4(wDbgL, 1.0);
}
`;
// debug 16..19: direct diffuse / direct specular / indirect diffuse / indirect specular
const DBG_LIGHT = /* glsl */`
  wDbgL = uDebug > 19.5 ? wDbgF : uDebug < 16.5 ? reflectedLight.directDiffuse : uDebug < 17.5 ? reflectedLight.directSpecular : uDebug < 18.5 ? reflectedLight.indirectDiffuse : reflectedLight.indirectSpecular;
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
  vec3 T = wBedTransmittance(depth * wTurbid(vW.xz), max(V.y, 0.02), max(uSunDir.y, 0.03));
  gl_FragColor = vec4(T, 1.0);
}
`;

/** shot-7 river look (missing entries are added to an existing uniforms object: hot-swaps) */
export function riverUniforms() {
  return {
    uRiverSilt: { value: 7.0 },
    uRiver: { value: new THREE.Vector4(2.0, 0.14, 0.28, 1.0) },
    uRiverSky: { value: new THREE.Vector3(0.62, 0.72, 0.8) },
    uRiverBody: { value: new THREE.Vector3(0.012, 0.024, 0.032) },
    uRiverFoam: { value: new THREE.Vector2(0.08, 0.35) },
    uRiver2: { value: new THREE.Vector4(4.0, 1.0, -0.4386, -0.8988) },
    uRiverAmp: { value: new THREE.Vector4(0.5, 1.7, 2.0, 0.45) },
  };
}
export { ABSORB_FRAG };

/** the lit surface material over a uniforms object (exported for look-dev hot-swaps) */
export function makeSurfaceMaterial(uniforms) {
  for (const [k, v] of Object.entries({ ...riverUniforms(), ...rockUniforms() })) if (!uniforms[k]) uniforms[k] = v;
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
  });
  // extra injections: planar reflection into the IBL radiance, premultiplied atmosphere
  const baseCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    baseCompile(shader, r);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${INJECT_REFL}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${DBG_LIGHT}`)
      .replace('#include <fog_fragment>', FOG_PREMUL);
  };
  mat.userData.shaderKey += ':w' + hashString(INJECT_REFL + FOG_PREMUL + DBG_LIGHT).toString(36);
  return mat;
}

/**
 * @returns {{ group, surface, absorb, material, uniforms, addImpact(im), setImpacts(list) }}
 */
export function createWaterSurface(engine, { maps, flow, ocean, reflection, size = 90000, level = 0 }) {
  const q = engine.quality;
  const near = maps.near, far = maps.far;
  const common = {
    tHNear: { value: near.tex }, uHNearB: { value: new THREE.Vector4(...near.bounds) },
    tHFar: { value: far.tex }, uHFarB: { value: new THREE.Vector4(...far.bounds) },
    uLevel: { value: level },
    uAbsorb: { value: new THREE.Vector3(0.55, 0.2, 0.12) },
    tFlow: { value: flow.tex }, uFlowB: { value: new THREE.Vector4(...flow.bounds) },
    tFlow2: { value: flow.tex }, uFlow2B: { value: new THREE.Vector4(1e6, 1e6, 1e6 + 1, 1e6 + 1) },
    uRiverSilt: riverUniforms().uRiverSilt,
  };
  const impacts = [], impactsB = [];
  for (let i = 0; i < MAX_IMPACTS; i++) { impacts.push(new THREE.Vector4(0, 0, 1, 0)); impactsB.push(new THREE.Vector4(0, 1, 0, 0)); }
  const uniforms = {
    ...common,
    uTime: { value: 0 },
    tWaves: { value: ocean.texture },
    uWaveScale: { value: new THREE.Vector4(37.0, 11.3, 3.7, 1.17) },
    uWaveAmp: { value: new THREE.Vector4(0.05, 0.06, 0.035, 0.004) },   // calm lagoon (ref 2): long gentle ripples, crisp mirror
    uWaveAng: { value: new THREE.Vector4(0.0, 1.9, 4.1, 2.7) },
    uChop: { value: 1.6 },
    uEnvBoost: { value: 1 / 0.34 },
    uFrameW: SKY.uFrame,
    uReflGain: { value: 1.45 },   // (r3: water read ~25% darker than refs 2, 7 in the foreground)
    uReflSmear: { value: 0.4 }, uReflLod: { value: 0.25 },   // crisp mirror (ref 2)   // art direction: deeper teal water (refs 2, 3, 4) under a pale sky
    uSkyRefl: { value: new THREE.Vector3(0.22, 0.36, 0.42) },
    uDebug: { value: Number(engine.params?.get?.('waterDebug') || 0) },
    ...reflection.uniforms,
    uReflPix: { value: 0.001 },
    uImp: { value: impacts }, uImpB: { value: impactsB }, uImpN: { value: 0 },
    ...rockUniforms(),
    uScatter: { value: new THREE.Vector3(0.004, 0.042, 0.058) },
    uFoamCol: { value: new THREE.Vector3(0.80, 0.83, 0.84) },
    uAerCol: { value: new THREE.Vector3(0.055, 0.105, 0.115) },
  };
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
  const absorb = new THREE.Mesh(geo, absorbMat);
  absorb.name = 'waterAbsorb';
  absorb.renderOrder = -21;
  absorb.frustumCulled = false;
  absorb.castShadow = false; absorb.receiveShadow = false;
  absorb.userData.castShadow = false; absorb.userData.receiveShadow = false;
  absorb.userData.noPatch = true; absorb.userData.isWater = true;

  reflection.hidden.push(surface, absorb);
  surface.onBeforeRender = (renderer, scene, camera) => {
    reflection.update(renderer, scene, camera);
    const fovR = (camera.fov * Math.PI) / 180;
    uniforms.uReflPix.value = (2 * Math.tan(fovR / 2)) / reflection.rt.height;
  };

  const group = new THREE.Group();
  group.name = 'water';
  group.add(absorb, surface);

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
  /** replace every impact (sorted by strength: the strongest are kept when there are too many) */
  function setImpacts(list) {
    n = 0; uniforms.uImpN.value = 0;
    for (const im of [...list].filter(Boolean).sort((p, q) => (q.strength || 0) - (p.strength || 0))) addImpact(im);
    return n;
  }
  /** boulders standing in the river: [{ x, z, r, h }], dir = flow direction [dx, dz] */
  function setRocks(list, dir) { return fillRocks(uniforms, list, dir); }
  return { group, surface, absorb, material: mat, absorbMaterial: absorbMat, uniforms, addImpact, setImpacts, setRocks, impactCount: () => n };
}
