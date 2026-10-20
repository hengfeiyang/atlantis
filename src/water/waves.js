// Shared wave description of a water surface (water module). OWNER: water.
//
// Two layers:
//  * the FFT ripple tile (ocean.js, slopes + LEAN second moments) sampled at 4 scales / rotations;
//  * a deterministic analytic SWELL (a few long deep-water sine waves) that also has a height, so
//    other modules can find the exact surface height (split-level meniscus, floating things) and
//    caustics / god rays can follow the same moving pattern as the ceiling seen from below.
//
// GLSL: WAVES_GLSL needs the uniforms of waveUniforms() (tWaves, uWaveScale, uWaveAmp, uWaveAng, uSwell*, uTime).
//   vec3  wOct(p, scale, ang, amp)  → (slope.xy, variance) of one FFT octave
//   vec3  wWaves(p, amp4)           → 4 octaves (slope.xy, variance)
//   float wSwellH(p, t)             → swell height (m) relative to the mean level
//   vec2  wSwellSlope(p, t)         → swell slope (dh/dx, dh/dz)
// JS: swellHeight(spec, x, z, t), swellSlope(spec, x, z, t) — identical maths.
import * as THREE from 'three';

const G = 9.81;
export const MAX_SWELL = 4;

/** swell spec: [{ amp (m), len (wavelength m), dir (compass deg of travel), phase }] */
export function makeSwell(list) {
  const out = [];
  for (let i = 0; i < MAX_SWELL; i++) {
    const s = list[i] || { amp: 0, len: 50, dir: 0, phase: 0 };
    const k = (2 * Math.PI) / s.len, w = Math.sqrt(G * k);
    const a = (s.dir * Math.PI) / 180;
    out.push({ amp: s.amp, k, w, dx: Math.sin(a), dz: -Math.cos(a), phase: s.phase || 0 });
  }
  return out;
}
export function swellHeight(sw, x, z, t) {
  let h = 0;
  for (const s of sw) h += s.amp * Math.sin(s.k * (x * s.dx + z * s.dz) - s.w * t + s.phase);
  return h;
}
export function swellSlope(sw, x, z, t) {
  let sx = 0, sz = 0;
  for (const s of sw) { const c = s.amp * s.k * Math.cos(s.k * (x * s.dx + z * s.dz) - s.w * t + s.phase); sx += c * s.dx; sz += c * s.dz; }
  return [sx, sz];
}

/** uniforms for WAVES_GLSL (shared objects: pass the same instance to several materials) */
export function waveUniforms(ocean, { scale = [37.0, 11.3, 3.7, 1.17], amp = [0.05, 0.06, 0.035, 0.004], ang = [0.0, 1.9, 4.1, 2.7], swell = [] } = {}) {
  const sw = makeSwell(swell);
  return {
    tWaves: { value: ocean.texture },
    uWaveScale: { value: new THREE.Vector4(...scale) },
    uWaveAmp: { value: new THREE.Vector4(...amp) },
    uWaveAng: { value: new THREE.Vector4(...ang) },
    uSwellA: { value: sw.map((s) => new THREE.Vector4(s.dx, s.dz, s.k, s.w)) },
    uSwellB: { value: sw.map((s) => new THREE.Vector2(s.amp, s.phase)) },
    uTime: { value: 0 },
  };
}
/** JS mirror of the swell in a uniforms object (for the meniscus etc.) */
export function swellFromUniforms(U) {
  return U.uSwellA.value.map((a, i) => ({ dx: a.x, dz: a.y, k: a.z, w: a.w, amp: U.uSwellB.value[i].x, phase: U.uSwellB.value[i].y }));
}

export const WAVES_GLSL = /* glsl */`
#ifndef CG_WAVES_INCLUDED
#define CG_WAVES_INCLUDED
uniform sampler2D tWaves;
uniform vec4 uWaveScale; uniform vec4 uWaveAmp; uniform vec4 uWaveAng;
uniform vec4 uSwellA[${MAX_SWELL}]; uniform vec2 uSwellB[${MAX_SWELL}];
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
  // large octave: domain-warped so the tile never reads as a grid from the air
  vec2 wq = p * 0.0125;
  vec2 warp = vec2(cgVnoise2(wq), cgVnoise2(wq + 5.3)) * 28.0;
  vec3 r = wOct(p + warp, uWaveScale.x, uWaveAng.x, amp4.x);
  r += wOct(p + vec2(13.7, 5.1), uWaveScale.y, uWaveAng.y, amp4.y);
  r += wOct(p + vec2(3.3, 17.9), uWaveScale.z, uWaveAng.z, amp4.z);
  r += wOct(p + vec2(7.9, 1.3), uWaveScale.w, uWaveAng.w, amp4.w);
  return r;
}
float wSwellH(vec2 p, float t){
  float h = 0.0;
  for (int i = 0; i < ${MAX_SWELL}; i++) { vec4 a = uSwellA[i]; h += uSwellB[i].x * sin(a.z * dot(p, a.xy) - a.w * t + uSwellB[i].y); }
  return h;
}
vec2 wSwellSlope(vec2 p, float t){
  vec2 s = vec2(0.0);
  for (int i = 0; i < ${MAX_SWELL}; i++) { vec4 a = uSwellA[i]; s += a.xy * (uSwellB[i].x * a.z * cos(a.z * dot(p, a.xy) - a.w * t + uSwellB[i].y)); }
  return s;
}
#endif
`;
