// Underwater medium for the sunken era (OWNER: underwater agent). Golden era: nothing here runs and no
// shader text changes (everything is behind `#ifdef CG_UW`, defined only when engine.era === 'sunken').
//
// What it does (sunken era only):
//   * MEDIUM — atmoApply() (core/atmosphere.js) splits every view ray at the sea surface y = uUwSurface:
//     the part in air gets the regular aerial perspective, the part under water gets per-channel absorption
//     + in-scatter (ambient from above, darker with depth; forward-scattered sun with volumetric shafts).
//     Works for camera below / fragment below, camera above / fragment below (ref 9) and the reverse.
//   * SPLIT LEVEL (ref 9) — the ray origin is pushed along the view ray by uUwDome metres (a virtual dome
//     port): pixels whose dome point lies under the wavy surface see the water view, the others the air view.
//     The meniscus line (a thin dark wobbling band + refraction) is drawn in an HDR post pass.
//   * LIT SURFACES — sun attenuated along the REFRACTED path (CSM light direction is refracted too, so N·L
//     and shadows match the light under water), Fresnel transmission at the surface, animated caustics
//     (Jacobian of a sum-of-sines surface, chromatic), ambient (IBL) tinted and darkened with depth.
//   * BACKGROUND — pixels with no geometry seen from under water: infinite medium looking down/sideways,
//     the surface from below (Snell's window, total internal reflection) looking up. The water agent's
//     surface mesh draws over it where it exists.
//   * MARINE SNOW — instanced suspended particles around the shot camera (real geometry: DOF blurs them).
//   * Sunken material overlay (sand dust, algae, crust, verdigris, …): core/sunken.js.
//
// ---------------------------------------------------------------------------------------------- uniforms
// All in UW (shared objects, injected into every patched material). Per-shot overrides: shot.uw or the
// look's `uw: { uUwSigma: [r,g,b], ... }` (engine.applyShot, same as grade / atmo / sky).
//   uUwSurface   float  sea surface height (m) — L.SUNKEN.surface
//   uUwDome      float  split-level dome-port radius (m): waterline sits asin(h/dome) below the horizon for a
//                       camera h metres above the surface (ref 9)
//   uUwDomeWave  float  scale of the wave height used for the waterline on the dome (gentler meniscus)
//   uUwSigma     vec3   view-path extinction per channel (1/m) at short range
//   uUwFar       vec4   x: range Lf (m) of the far term — optical depth = sigma · s · (1 + s / Lf): crisp to
//                       ≈ 60-80 m, blue silhouettes at 150-250 m, gone by ≈ 300 m (refs 6, 7, 9); 0 = off
//   uUwKd        vec3   ambient (downwelling) attenuation with depth (1/m) of the IBL on surfaces
//   uUwKdScat    vec3   depth attenuation of the in-scattered ambient (water lighter toward the surface)
//   uUwKdSun     vec3   sun attenuation along the refracted path (1/m)
//   uUwAmbColor  vec3   in-scattered ambient radiance at infinity just under the surface (deep teal)
//   uUwSunScatter vec3  sun in-scatter albedo (× sun irradiance × phase × shafts)
//   uUwPhase     vec2   x = Henyey-Greenstein g, y = weight of the HG lobe vs isotropic
//   uUwShaft     vec4   god rays: x broad-beam contrast, y beam scale (m), z depth fade (m), w caustic-map mip
//                       level of the fine filaments (blur)
//   uUwShaft2    vec4   x filament contrast, y path-length multiplier of the filament slice, z beam drift speed
//   uUwCaustic   vec4   caustics: x strength, y focus (wave-slope multiplier of the splat: higher = the network
//                       sharpens / folds at shallower depth), z depth fade (m), w base blur (m)
//   uUwCaustic2  vec4   x blur per metre of path (sun disk ≈ 0.0035 physically; art: crisper), y dispersion,
//                       z floor brightening under the broad god-ray beams (0..1), w anti-repeat: blend of a second,
//                       rotated lookup of the 32 m caustic tile through a ≈ 40 m noise mask (0 = off)
//   uUwShaftOcc  vec4   god-ray occlusion by geometry: x strength (0..1), y depth bias, z lateral blur (m) per
//                       metre below the surface, w half-size (m) of the occlusion map box (rendered once per shot
//                       from the refracted sun with three's shadow machinery; tUwShaft / uUwShaftM, runtime)
//   uUwAmbTint   vec3   multiplies the IBL (sky) on surfaces under water
//   uUwSunSurf   float  multiplies the direct sun on surfaces under water
//   uUwSkyColor  vec3   sky radiance seen through Snell's window (background fallback)
//   uUwLightMode float  r3: 0 = the light under water is the VISIBLE sun (ATMO.uSunDir, the disk); 1 = the scene
//                       sun of the shot (shot.sun → SUN.dir, runtime uUwLightDir): ref 9 shows the sun on the horizon in
//                       front but lights the temple front from behind-left with slanted shafts — decoupled per shot
//   uUwSteps     float  medium ray-march steps (≤ 24)
//   uUwWaves     vec4[16] surface waves (kx, kz, amplitude, phase); ω from deep-water dispersion
//   uUwMeniscus  vec4   x line darkness, y line half-width (uv units), z refraction strength, w on/off
//   uUwSnow      vec4   marine snow: x brightness, y size multiplier, z count multiplier, w radius (m)
//   uUwTime, uUwFrame (set by the engine), uUwSunDir (= ATMO.uSunDir, toward the sun in air), uUwSunIrr,
//   tUwCaustic / uUwSlices / uUwTile / uUwMapRes / uUwPixAngle (caustic map, runtime)
// CAUSTIC MAP: every setTime() a grid of the periodic surface (UW_TILE m) is refracted to 4 depths
// (UW_SLICES) and splatted with area-ratio intensity (Evan Wallace) into one RGBA half-float map
// (mipmapped, RepeatWrapping). Surfaces read the slice of their refracted path length; god rays read it
// heavily blurred, so the shafts are the volumetric extension of the sand caustics.
//
// GLSL API (in any shader that defines CG_UW and includes UW_GLSL — patched materials get it automatically):
//   float uwWaveH(vec2 xz)                       surface displacement (m) at time uUwTime
//   void  uwWaveDeriv(vec2 xz, out h, out vec2 grad, out vec3 hess)
//   vec3  uwSunW()                               toward-the-sun direction UNDER water (refracted)
//   vec3  uwCaustics(vec3 worldPos)              caustic multiplier (mean ≈ 1)
//   vec3  uwMedium(vec3 col, vec3 a, vec3 b)     apply the water medium on a segment a (near) → b (far)
//   float uwUnder(vec3 camPos, vec3 dir)         1 if the (dome) ray origin is under the wavy surface
//   atmoApply(col, worldPos) (core/atmosphere.js) does the full air/water split.
import * as THREE from 'three';
import { SUNKEN } from '../world/layout.js';
import * as SUNKEN_OVERLAY from './sunken.js';
import { LOOKS } from '../world/looks.js';

// deterministic wave set (UW_NWAVES): wavelengths log-spaced 0.6 … 6.5 m, golden-angle directions over
// the full circle → a Gaussian-like random surface whose caustics form a
// cellular network; steepness tuned so the network focuses between ≈ 8 and 50 m (sharpest at temple depth)
export const UW_NWAVES = 24;
export const UW_TILE = 32;                    // caustic map tile (m); waves are periodic on it
export const UW_SLICES = [5, 12, 25, 50];      // refracted path lengths (m) of the 4 caustic-map slices
function makeWaves() {
  const out = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < UW_NWAVES; i++) {
    const f = i / (UW_NWAVES - 1);
    const l = 6.5 * Math.pow(0.6 / 6.5, f) * (0.85 + 0.3 * rnd());
    const steep = 0.026 + 0.012 * rnd();
    const a = i * 2.39996 + (rnd() - 0.5) * 0.5;   // golden angle (+ jitter): isotropic at every scale
    // snap the wave vector to the tile lattice (2π/T · integers) so the caustic map tiles seamlessly
    let m = Math.round((UW_TILE / l) * Math.cos(a)), n = Math.round((UW_TILE / l) * Math.sin(a));
    while (out.some((w) => Math.abs(w.m - m) + Math.abs(w.n - n) === 0) || (m === 0 && n === 0)) m += 1;
    const kx = (2 * Math.PI * m) / UW_TILE, kz = (2 * Math.PI * n) / UW_TILE, k = Math.hypot(kx, kz);
    const w = new THREE.Vector4(kx, kz, steep / k, rnd() * Math.PI * 2);
    w.m = m; w.n = n;
    out.push(w);
  }
  return out;
}

export const UW = {
  uUwSurface: { value: SUNKEN.surface },
  uUwDome: { value: 1.2 },
  uUwDomeWave: { value: 0.5 },
  uUwSigma: { value: new THREE.Vector3(0.0095, 0.006, 0.005) }, // r2 (look-sunken)
  uUwFar: { value: new THREE.Vector4(150, 0, 0, 0) }, // r2 (look-sunken)
  uUwKd: { value: new THREE.Vector3(0.005, 0.0042, 0.004) }, // r2 (look-sunken)
  uUwKdScat: { value: new THREE.Vector3(0.03, 0.018, 0.014) }, // r2 (look-sunken)
  uUwKdSun: { value: new THREE.Vector3(0.0045, 0.004, 0.004) }, // r2 (look-sunken)
  uUwAmbColor: { value: new THREE.Vector3(0.004, 0.28, 0.85) }, // r2 (look-sunken)
  uUwSunScatter: { value: new THREE.Vector3(0.006, 0.045, 0.08) }, // r2 (look-sunken)
  uUwPhase: { value: new THREE.Vector2(0.8, 0.7) }, // r2 (look-sunken)
  uUwShaft: { value: new THREE.Vector4(2.8, 7.0, 70, 4.0) }, // r2 (look-sunken)
  uUwShaft2: { value: new THREE.Vector4(1.2, 2.0, 0.35, 0) }, // r2 (look-sunken)
  uUwCaustic: { value: new THREE.Vector4(1.3, 0.2, 140, 0.015) }, // r2 (look-sunken): deeper reach (refs 7, 8: sand caustics at depth)
  uUwCaustic2: { value: new THREE.Vector4(0.0012, 0.0005, 0.35, 1) }, // r2 (look-sunken)
  uUwShaftOcc: { value: new THREE.Vector4(1, 0.0004, 0.01, 170) }, // r2 (look-sunken)
  uUwAmbTint: { value: new THREE.Vector3(1.4, 1.45, 1.5) }, // r2 (look-sunken)
  uUwSunSurf: { value: 1.0 },
  uUwSkyColor: { value: new THREE.Vector3(1.6, 2.4, 3.0) },
  uUwLightMode: { value: 0 },          // r3 (look-sunken)
  uUwLightDir: { value: new THREE.Vector3(-0.7, 0.35, 0.6).normalize() }, // runtime: SUN.dir
  uUwSteps: { value: 16 },
  uUwWaves: { value: makeWaves() },
  uUwMeniscus: { value: new THREE.Vector4(0.55, 0.0022, 0.5, 1) },
  uUwSnow: { value: new THREE.Vector4(1.0, 1.0, 1.0, 26) },
  uUwTime: { value: 0 },
  uUwFrame: { value: 0 },
  uUwSunDir: { value: new THREE.Vector3(-0.7, 0.35, 0.6).normalize() }, // replaced by ATMO.uSunDir at install
  uUwSunIrr: { value: new THREE.Vector3(12, 10.4, 8.5) },
  tUwCaustic: { value: null },
  uUwSlices: { value: new THREE.Vector4(...UW_SLICES) },
  uUwTile: { value: UW_TILE },
  uUwMapRes: { value: 1024 },
  uUwPixAngle: { value: 0.001 },
  tUwShaft: { value: null },
  uUwShaftM: { value: new THREE.Matrix4() },
  uUwShaftOn: { value: 0 },
};

// set at runtime (engine / install), never snapshotted or overridden per shot
export const UW_RUNTIME = new Set(['uUwTime', 'uUwFrame', 'uUwSunDir', 'uUwLightDir', 'uUwSunIrr', 'tUwCaustic', 'uUwSlices', 'uUwTile', 'uUwMapRes', 'uUwPixAngle', 'tUwShaft', 'uUwShaftM', 'uUwShaftOn']);

// ------------------------------------------------------------------------------------------------ GLSL
// surface waves (also used by the caustic-map pass and the meniscus); the water agent may use them for
// the sunken surface so its ripples, Snell's window, caustics and god rays agree
export const UW_WAVE_GLSL = /* glsl */ `
#ifndef CG_UW_WAVES
#define CG_UW_WAVES
uniform vec4 uUwWaves[${UW_NWAVES}];
uniform float uUwTime;
// ---- surface waves (sum of sines, deep-water dispersion ω = sqrt(g k))
void uwWaveDeriv(vec2 p, out float h, out vec2 g, out vec3 H){
  h = 0.0; g = vec2(0.0); H = vec3(0.0);
  for (int i = 0; i < ${UW_NWAVES}; i++) {
    vec4 w = uUwWaves[i];
    float kl = length(w.xy);
    float ph = dot(w.xy, p) - sqrt(9.81 * kl) * uUwTime + w.w;
    float s = sin(ph), c = cos(ph);
    h += w.z * s;
    g += (w.z * c) * w.xy;
    H -= (w.z * s) * vec3(w.x * w.x, w.x * w.y, w.y * w.y);
  }
}
float uwWaveH(vec2 p){
  float h = 0.0;
  for (int i = 0; i < ${UW_NWAVES}; i++) {
    vec4 w = uUwWaves[i];
    h += w.z * sin(dot(w.xy, p) - sqrt(9.81 * length(w.xy)) * uUwTime + w.w);
  }
  return h;
}

#endif
`;
export const UW_GLSL = /* glsl */ `
#ifndef CG_UW_INCLUDED
#define CG_UW_INCLUDED
uniform float uUwSurface;
uniform float uUwDome;
uniform float uUwDomeWave;
uniform vec3 uUwSigma;
uniform vec4 uUwFar;
uniform vec3 uUwKd;
uniform vec3 uUwKdScat;
uniform vec3 uUwKdSun;
uniform vec3 uUwAmbColor;
uniform vec3 uUwSunScatter;
uniform vec2 uUwPhase;
uniform vec4 uUwShaft;
uniform vec4 uUwShaft2;
uniform vec4 uUwCaustic;
uniform vec4 uUwCaustic2;
uniform vec3 uUwAmbTint;
uniform float uUwSunSurf;
uniform vec3 uUwSkyColor;
uniform float uUwSteps;
uniform float uUwFrame;
uniform vec3 uUwSunDir;
uniform float uUwLightMode;
uniform vec3 uUwLightDir;
uniform vec3 uUwSunIrr;
uniform sampler2D tUwCaustic;   // caustic map: 4 depth slices in RGBA (mean 1), tiled every uUwTile metres
uniform vec4 uUwSlices;         // refracted path length (m) of each slice
uniform float uUwTile;
uniform float uUwMapRes;
uniform float uUwPixAngle;      // radians per pixel (footprint → mip level)
uniform vec4 uUwShaftOcc;
uniform highp sampler2DShadow tUwShaft;   // god-ray occlusion depth map (orthographic, from the refracted sun)
uniform mat4 uUwShaftM;
uniform float uUwShaftOn;

float uwHash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float uwHash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float uwNoise2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = uwHash12(i), b = uwHash12(i + vec2(1.0, 0.0)), c = uwHash12(i + vec2(0.0, 1.0)), d = uwHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

${UW_WAVE_GLSL}
// toward-the-sun direction under water (Snell refraction of the incoming sun light)
// toward the light in AIR that feeds the water (visible sun, or the shot's scene sun: uUwLightMode)
vec3 uwSunAir(){ return uUwLightMode > 0.5 ? uUwLightDir : uUwSunDir; }
vec3 uwSunW(){
  vec3 sa = uwSunAir();
  vec3 s = normalize(vec3(sa.x, max(sa.y, 0.02), sa.z));
  vec3 t = refract(-s, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
  return -normalize(t);
}
// Fresnel transmission of the sun light into the water (Schlick, F0 = 0.02)
float uwSunTransmit(){
  float c = clamp(uwSunAir().y, 0.02, 1.0);
  float m = 1.0 - c; float m2 = m * m;
  return 1.0 - (0.02 + 0.98 * m2 * m2 * m);
}

// weights of the 4 caustic-map slices for a refracted path length d (log interpolation); w0 = "no caustic"
vec4 uwSliceW(float d, out float w0){
  vec4 D = uUwSlices;
  w0 = 0.0;
  if (d <= D.x) { float t = max(d, 0.0) / D.x; w0 = 1.0 - t; return vec4(t, 0.0, 0.0, 0.0); }
  float l = log(d);
  if (d <= D.y) { float t = (l - log(D.x)) / (log(D.y) - log(D.x)); return vec4(1.0 - t, t, 0.0, 0.0); }
  if (d <= D.z) { float t = (l - log(D.y)) / (log(D.z) - log(D.y)); return vec4(0.0, 1.0 - t, t, 0.0); }
  if (d <= D.w) { float t = (l - log(D.z)) / (log(D.w) - log(D.z)); return vec4(0.0, 0.0, 1.0 - t, t); }
  return vec4(0.0, 0.0, 0.0, 1.0);
}
// broad god-ray beams at the surface entry point q (low-frequency focusing by the long swell, value noise
// drifting with time), mean ≈ 1
float uwBeams(vec2 q){
  float sc = 1.0 / uUwShaft.y;
  vec2 drift = vec2(0.31, 0.17) * uUwTime * uUwShaft2.z;
  float n = 0.62 * uwNoise2(q * sc + drift) + 0.38 * uwNoise2(q * sc * 2.37 - drift * 1.7 + 11.3);
  return n * n * n * n * 9.5;                                 // E[n^4] ≈ 0.105 for this blend
}
// visibility of the (refracted) sun from a point in the water: occlusion by geometry (bridge arch, temple,
// columns...) from the per-shot depth map; jitter r (m) blurs the shaft edges (sun disk + forward scattering)
float uwSunVis(vec3 x, vec2 jit){
  if (uUwShaftOn < 0.5 || uUwShaftOcc.x <= 0.0) return 1.0;
  float z = max(uUwSurface - x.y, 0.0);
  x.xz += jit * (uUwShaftOcc.z * z);
  vec4 c = uUwShaftM * vec4(x, 1.0);
  vec3 s = c.xyz / c.w;
  if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
  float v = texture(tUwShaft, vec3(s.xy, s.z - uUwShaftOcc.y));
  return 1.0 - uUwShaftOcc.x * (1.0 - v);
}
// caustic multiplier on a lit surface at P (mean ≈ 1): the splatted caustic map at the refracted path
// length, blurred by the sun disk (≈ 0.0035 rad in water) and by the pixel footprint; slight dispersion
vec3 uwCaustics(vec3 P){
  float z = uUwSurface - P.y;
  if (z <= 0.0) return vec3(1.0);
  vec3 sw = uwSunW();
  float d = z / sw.y;
  vec2 p = (P.xz + sw.xz * d) / uUwTile;
  float w0; vec4 w = uwSliceW(d, w0);
  float texel = uUwTile / uUwMapRes;
  float blurT = (uUwCaustic.w + uUwCaustic2.x * d) / texel;
  float footT = length(P - cameraPosition) * uUwPixAngle / texel;
  float lod = 0.5 * log2(max(blurT * blurT + footT * footT, 1.0));
  vec2 dsp = normalize(sw.xz + vec2(1e-5)) * (uUwCaustic2.y * d / uUwTile);
  vec4 cr = textureLod(tUwCaustic, p + dsp, lod), cg = textureLod(tUwCaustic, p, lod), cb = textureLod(tUwCaustic, p - dsp, lod);
  vec3 I = vec3(dot(cr, w), dot(cg, w), dot(cb, w)) + w0;
  if (uUwCaustic2.w > 0.0) {
    // anti-repeat: a second lookup through a rotated (≈ 37°), rescaled lattice, swapped in by a ≈ 40 m mask
    vec2 q = P.xz + sw.xz * d;
    float m = smoothstep(0.32, 0.68, 0.65 * uwNoise2(q * 0.025 + 3.1) + 0.35 * uwNoise2(q * 0.061 - 7.7)) * uUwCaustic2.w;
    vec2 p2 = mat2(0.8, -0.6, 0.6, 0.8) * p * 0.87 + vec2(0.37, 0.71);
    vec4 c2r = textureLod(tUwCaustic, p2 + dsp, lod), c2g = textureLod(tUwCaustic, p2, lod), c2b = textureLod(tUwCaustic, p2 - dsp, lod);
    I = mix(I, vec3(dot(c2r, w), dot(c2g, w), dot(c2b, w)) + w0, m);
  }
  float f = uUwCaustic.x * exp(-z / uUwCaustic.z) * smoothstep(0.0, 1.0, z);
  vec3 C = max(mix(vec3(1.0), I, f), vec3(0.0));
  // the broad god-ray beams land on the floor as large soft bright patches (same pattern as the shafts)
  if (uUwCaustic2.z > 0.0) C *= max(1.0 + uUwCaustic2.z * exp(-z / uUwShaft.z) * (uwBeams(P.xz + sw.xz * d) - 1.0), 0.0);
  return C;
}

// god-ray pattern at a point in the water: broad beams (low-frequency focusing by the long swell, value
// noise drifting with time) × fine filaments (the caustic map itself, blurred: the shafts are the volumetric
// extension of the sand caustics); contrast fades with depth. Mean ≈ 1.
float uwShaft(vec3 x, float z, vec3 sw){
  float d = z / sw.y;
  vec2 q = x.xz + sw.xz * d;
  float beams = uwBeams(q);
  float w0; vec4 w = uwSliceW(max(d, 0.25) * uUwShaft2.y, w0);
  float fil = dot(textureLod(tUwCaustic, q / uUwTile, uUwShaft.w), w) + w0;
  float fade = exp(-z / uUwShaft.z);
  float b = max(1.0 + uUwShaft.x * fade * (beams - 1.0), 0.0);
  float f = max(1.0 + uUwShaft2.x * fade * (fil - 1.0), 0.0);
  return b * f;
}

// in-scattered radiance at infinity for a point in the water (ambient + sun, before the shaft pattern)
vec3 uwPhaseSun(vec3 dir, vec3 sw){
  float g = uUwPhase.x, mu = dot(dir, sw);
  float hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5);
  return uUwSunScatter * uUwSunIrr * uwSunTransmit() * mix(1.0, hg, uUwPhase.y);
}

// view-path optical depth over s metres (linear + far term)
vec3 uwTau(float s){ return uUwSigma * (s * (1.0 + (uUwFar.x > 0.0 ? s / uUwFar.x : 0.0))); }
// the water medium on the segment a (near the eye) → b (far)
vec3 uwMedium(vec3 col, vec3 a, vec3 b){
  vec3 V = b - a; float L = length(V);
  if (L < 1e-4) return col;
  vec3 dir = V / L;
  float Lc = min(L, 320.0);
  vec3 sw = uwSunW();
  vec3 sunC = uwPhaseSun(dir, sw);
  float N = clamp(uUwSteps, 2.0, 24.0);
  // per-pixel march offset: interleaved gradient noise (low-discrepancy across neighbours) + golden-ratio frame step
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uUwFrame * 0.61803399);
  vec3 acc = vec3(0.0), Tp = vec3(1.0);
  for (int i = 0; i < 24; i++) {
    if (float(i) >= N) break;
    float f1 = (float(i) + 1.0) / N;
    float fm = (float(i) + j) / N;
    vec3 T1 = exp(-uwTau(Lc * f1 * f1));
    vec3 x = a + dir * (Lc * fm * fm);
    float z = max(uUwSurface - x.y, 0.0);
    vec2 jt = vec2(uwHash13(vec3(x.zx * 3.1, j * 17.0 + float(i))), uwHash13(vec3(x.xy * 2.3, j * 29.0 - float(i)))) * 2.0 - 1.0;
    vec3 src = uUwAmbColor * exp(-uUwKdScat * z) + sunC * exp(-uUwKdSun * (z / sw.y)) * uwShaft(x, z, sw) * uwSunVis(x, jt);
    acc += src * (Tp - T1);
    Tp = T1;
  }
  return col * exp(-uwTau(L)) + acc;
}

// is the (dome-port) origin of a view ray under the wavy surface?
float uwUnder(vec3 cam, vec3 dir){
  vec3 o = cam + dir * uUwDome;
  return o.y < uUwSurface + uUwDomeWave * uwWaveH(o.xz) ? 1.0 : 0.0;
}
#endif
`;

// air/water split of a view ray; included by ATMO_GLSL after atmoAirFrom() (core/atmosphere.js)
export const UW_APPLY_GLSL = /* glsl */ `
vec3 uwApplyFrom(vec3 col, vec3 cam, vec3 wp){
  vec3 V = wp - cam;
  float dist = length(V);
  vec3 dir = V / max(dist, 1e-4);
  float S = uUwSurface;
  vec3 o = cam + dir * min(uUwDome, dist * 0.999);
  bool oU = o.y < S + uUwDomeWave * uwWaveH(o.xz);
  bool wU = wp.y < S;
  if (!oU && !wU) return atmoAirFrom(col, cam, wp);
  if (oU && wU) return uwMedium(col, o, wp);
  // the segment crosses the surface plane
  float t = clamp((S - o.y) / ((wp.y - o.y) + (abs(wp.y - o.y) < 1e-5 ? 1e-5 : 0.0)), 0.0, 1.0);
  vec3 c = mix(o, wp, t);
  if (oU) { col = atmoAirFrom(col, c, wp); return uwMedium(col, o, c); }
  col = uwMedium(col, c, wp);
  return atmoAirFrom(col, cam, c);
}
`;

// lit-material injections (vertex: world position / normal; fragment: light attenuation + caustics)
const VERT_HEAD = /* glsl */ `
#ifdef CG_UW
varying vec3 vUwWP;
varying vec3 vUwWN;
#endif
`;
const VERT_WORLD = /* glsl */ `
#ifdef CG_UW
{
  vec4 uwP = vec4( transformed, 1.0 );
  vec3 uwN = objectNormal;
  #ifdef USE_BATCHING
    uwP = batchingMatrix * uwP; uwN = mat3( batchingMatrix ) * uwN;
  #endif
  #ifdef USE_INSTANCING
    uwP = instanceMatrix * uwP; uwN = mat3( instanceMatrix ) * uwN;
  #endif
  vUwWP = ( modelMatrix * uwP ).xyz;
  vUwWN = normalize( mat3( modelMatrix ) * uwN );
}
#endif
`;
const FRAG_LIGHT = /* glsl */ `
#ifdef CG_UW
{
  float uwZ = uUwSurface - vUwWP.y;
  if (uwZ > 0.0) {
    vec3 uwSw = uwSunW();
    vec3 uwSunT = exp(-uUwKdSun * (uwZ / uwSw.y)) * (uwSunTransmit() * uUwSunSurf);
    vec3 uwC = uwCaustics(vUwWP);
    float uwF = smoothstep(0.0, 0.25, uwZ);
    reflectedLight.directDiffuse *= mix(vec3(1.0), uwSunT * uwC, uwF);
    reflectedLight.directSpecular *= mix(vec3(1.0), uwSunT * mix(vec3(1.0), uwC, 0.6), uwF);
    vec3 uwAmb = exp(-uUwKd * uwZ) * uUwAmbTint;
    reflectedLight.indirectDiffuse *= mix(vec3(1.0), uwAmb, uwF);
    reflectedLight.indirectSpecular *= mix(vec3(1.0), uwAmb, uwF);
  }
}
#endif
`;

// ------------------------------------------------------------------------------- background (sky fallback)
const BG_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = p.xyww;
}`;
const BG_FRAG = /* glsl */ `
varying vec3 vDir;
${UW_GLSL}
void main(){
  vec3 dir = normalize(vDir);
  vec3 o = cameraPosition + dir * uUwDome;
  float S = uUwSurface;
  if (o.y >= S + uUwDomeWave * uwWaveH(o.xz)) discard;  // air view (split level): the sky shows
  vec3 col;
  if (dir.y > 0.002 && (S - o.y) / dir.y < 4000.0) {
    float t = max((S - o.y) / dir.y, 0.0);
    vec3 hp = o + dir * t;
    float h; vec2 g; vec3 H;
    uwWaveDeriv(hp.xz, h, g, H);
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));               // facing up (air side)
    vec3 ta = refract(dir, -n, 1.333);
    vec3 sw = uwSunW();
    vec3 deep = uUwAmbColor * 0.55;                // total internal reflection: the deep water below
    if (dot(ta, ta) < 1e-4) col = deep;
    else {
      float c = clamp(dot(ta, n), 0.0, 1.0);                 // exit angle (air side): F → 1 at the critical angle
      float m = 1.0 - c; float F = 0.02 + 0.98 * m * m * m * m * m;
      vec3 sky = uUwSkyColor * (0.55 + 0.45 * clamp(ta.y, 0.0, 1.0));
      float mu = max(dot(ta, normalize(uUwSunDir)), 0.0);
      sky += uUwSunIrr * (0.06 * pow(mu, 12.0) + 0.9 * pow(mu, 400.0) + 6.0 * pow(mu, 6000.0));
      // edge of Snell's window: transmission falls off (Fresnel) and the TIR mirror takes over
      col = mix(sky * (1.0 - F), deep, F);
    }
    col = uwMedium(col, o, hp);
  } else {
    col = uwMedium(vec3(0.0), o, o + dir * 400.0);
  }
  gl_FragColor = vec4(col, 0.0);
}`;

// ------------------------------------------------------------------------------- marine snow
const SNOW_VERT = /* glsl */ `
attribute vec4 aSnow;        // xyz offset in the camera box (0..1), w random
uniform vec3 uSnowCenter;
uniform float uSnowR;
uniform vec4 uUwSnowV;
uniform float uSnowT;
uniform float uPxScale;      // pixels per (metre at 1 m)
varying vec2 vUv;
varying float vFade;
varying vec3 vSnowWP;
varying float vRnd;
void main(){
  vUv = uv;
  vRnd = aSnow.w;
  // radius distribution: denser close to the camera (r ∝ u^1.6)
  vec3 q = aSnow.xyz * 2.0 - 1.0;
  float r = length(q);
  vec3 off = q / max(r, 1e-3) * pow(r, 1.6) * uSnowR;
  // slow drift + sinking
  float t = uSnowT;
  off += vec3(sin(t * 0.21 + aSnow.w * 31.0) * 0.15, -0.02 * t * (0.5 + aSnow.w), cos(t * 0.17 + aSnow.w * 17.0) * 0.15);
  vec3 wp = uSnowCenter + off;
  vSnowWP = wp;
  float size = mix(0.0016, 0.006, pow(aSnow.w, 3.0)) * uUwSnowV.y;     // radius (m)
  vec4 vp = viewMatrix * vec4(wp, 1.0);
  float dz = max(-vp.z, 0.05);
  // never smaller than ~0.7 px: keep the energy (alpha) of sub-pixel specks
  float px = size * uPxScale / dz;
  float s = max(px, 0.7) / max(px, 1e-4);
  vFade = 1.0 / (s * s) * smoothstep(uSnowR, uSnowR * 0.6, length(off)) * smoothstep(0.15, 0.6, dz);
  vp.xy += position.xy * size * s;
  gl_Position = projectionMatrix * vp;
}`;

// ------------------------------------------------------------------------------- meniscus (HDR post)
const MEN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform mat4 uInvProjView;
uniform vec3 uCam;
uniform vec4 uUwMeniscus;
uniform float uLensMode;     // 1: tSrc is the lens-effects image → keep it only in the air part
varying vec2 vUv;
${UW_GLSL}
float sd(vec2 uv){
  vec4 p = uInvProjView * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w - uCam);
  vec3 o = uCam + dir * uUwDome;
  return o.y - (uUwSurface + uUwDomeWave * uwWaveH(o.xz));
}
void main(){
  float h = sd(vUv);
  if (uLensMode > 0.5) { gl_FragColor = texture2D(tSrc, vUv) * smoothstep(-0.004, 0.004, h); return; }
  float w = uUwMeniscus.y;
  // signed distance in screen space (gradient of h)
  float dh = abs(sd(vUv + vec2(0.0, 0.002)) - h) / 0.002;
  float e = h / max(dh, 1e-5);                       // uv units from the waterline
  float band = exp(-pow(e / w, 2.0));
  // lens refraction near the line: the water side is pulled toward the line
  vec2 uv = vUv;
  if (h < 0.0) uv.y += uUwMeniscus.z * w * exp(-abs(e) / (w * 3.0)) * sign(e);
  vec3 c = texture2D(tSrc, uv).rgb;
  // dark meniscus with a thin bright rim on the air side
  c *= 1.0 - uUwMeniscus.x * band;
  c += c * 1.4 * exp(-pow((e - w * 1.6) / (w * 0.5), 2.0)) * step(0.0, e);
  gl_FragColor = vec4(c, texture2D(tSrc, vUv).a);
}`;

// ------------------------------------------------------------------------------------------- caustic map
const CM_VERT = /* glsl */ `
${UW_WAVE_GLSL}
uniform float uA;
uniform float uTileC;
attribute vec2 aOff;
varying vec2 vSrc;
void main(){
  vec2 u = position.xy * uTileC;
  float h; vec2 g; vec3 H;
  uwWaveDeriv(u, h, g, H);
  vec2 x = u - uA * g + aOff * uTileC;     // landing point of the refracted ray (small-slope refraction)
  vSrc = u;
  gl_Position = vec4(x / uTileC * 2.0 - 1.0, 0.0, 1.0);
}`;
const CM_FRAG = /* glsl */ `
uniform vec4 uMask;
uniform float uInvTexelArea;
varying vec2 vSrc;
void main(){
  vec2 a = dFdx(vSrc), b = dFdy(vSrc);
  gl_FragColor = uMask * (abs(a.x * b.y - a.y * b.x) * uInvTexelArea);   // source area / landing area
}`;
class CausticMap {
  constructor(renderer, res, grid) {
    this.renderer = renderer;
    this.res = res;
    this.rt = new THREE.WebGLRenderTarget(res, res, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
      colorSpace: THREE.NoColorSpace,
    });
    this.scene = new THREE.Scene();
    this.cam = new THREE.Camera();
    const pg = new THREE.PlaneGeometry(1, 1, grid, grid).translate(0.5, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = pg.index; geo.setAttribute('position', pg.attributes.position);
    const off = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) off.push(i, j);
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(off), 2));
    geo.instanceCount = 9;
    const texel = UW_TILE / res;
    UW_SLICES.forEach((d, k) => {
      const mask = new THREE.Vector4(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0, k === 3 ? 1 : 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uUwWaves: UW.uUwWaves, uUwTime: UW.uUwTime, uTileC: { value: UW_TILE },
          uA: { value: d * 0.2497 * UW.uUwCaustic.value.y }, uMask: { value: mask }, uInvTexelArea: { value: 1 / (texel * texel) },
        },
        vertexShader: CM_VERT, fragmentShader: CM_FRAG, side: THREE.DoubleSide,
        depthTest: false, depthWrite: false, transparent: true,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
      });
      mat.userData.d = d;
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      this.scene.add(m);
    });
    UW.tUwCaustic.value = this.rt.texture;
    UW.uUwMapRes.value = res;
  }
  render() {
    const r = this.renderer;
    for (const m of this.scene.children) m.material.uniforms.uA.value = m.material.userData.d * 0.2497 * UW.uUwCaustic.value.y;
    const prevRT = r.getRenderTarget(), prevC = r.getClearColor(new THREE.Color()), prevA = r.getClearAlpha();
    const prevSM = r.shadowMap.enabled;
    r.shadowMap.enabled = false;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.render(this.scene, this.cam);
    r.setClearColor(prevC, prevA);
    r.setRenderTarget(prevRT);
    r.shadowMap.enabled = prevSM;
    this.time = UW.uUwTime.value;
    this.focus = UW.uUwCaustic.value.y;
  }
}

// --------------------------------------------------------------------------------------------- install
/**
 * Called by engine.prepareScene() in the sunken era (before materials are patched).
 * @param engine Engine
 * @param deps { ATMO, ATMO_GLSL, SUN, LENS, FS_QUAD }
 */
export function installUnderwater(engine, deps) {
  const { ATMO, ATMO_GLSL, SUN, LENS } = deps;
  UW.uUwSunDir = ATMO.uSunDir;          // share: per-shot sun / visible-sun hooks drive the refraction
  const skMod = SUNKEN_OVERLAY, SK = SUNKEN_OVERLAY.SK;

  const uw = {
    UW,
    /** wrap a material patched by the engine (all eras' code already in place) */
    patchMaterial(mat, lit) {
      if (mat.userData.__uwPatched || mat.userData.uwSkip) return;
      mat.userData.__uwPatched = true;
      mat.defines = mat.defines || {};
      mat.defines.CG_UW = 1;
      let kind = 0, amt = 1;
      if (lit && skMod) ({ kind, amt } = skMod.sunkenKind(mat));
      if (lit && kind > 0) { mat.defines.CG_SK_KIND = kind; mat.defines.CG_SK_AMT = amt.toFixed(3); }
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = function (shader, renderer) {
        if (prev) prev.call(this, shader, renderer);
        for (const k in UW) shader.uniforms[k] = UW[k];
        if (SK) for (const k in SK) shader.uniforms[k] = SK[k];
        if (!lit) return;
        let vs = shader.vertexShader, fs = shader.fragmentShader;
        vs = vs.replace('#include <common>', `#include <common>\n${VERT_HEAD}`);
        vs = vs.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_WORLD}`);
        const skG = skMod ? skMod.SK_GLSL : '';
        fs = fs.replace('#include <common>', `#include <common>\n${VERT_HEAD}\n${UW_GLSL}\n#ifdef CG_SK_KIND\n${skG}\n#endif`);
        if (skMod) fs = fs.replace('#include <emissivemap_fragment>', `${skMod.SK_FRAG}\n#include <emissivemap_fragment>`);
        fs = fs.replace('#include <aomap_fragment>', `${FRAG_LIGHT}\n#include <aomap_fragment>`);
        shader.vertexShader = vs; shader.fragmentShader = fs;
      };
      const prevKey = mat.customProgramCacheKey;
      mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|uw' + (lit ? 'L' : ''); };
      mat.needsUpdate = true;
    },
    /** give noPatch custom materials that include ATMO_GLSL the medium (define + uniforms) */
    scan(scene) {
      scene.traverse((o) => {
        if (!o.material || o === engine.sky) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.userData.__uwPatched || m.userData.uwSkip || m.userData.__cgPatched) continue;
          if (m.isShaderMaterial && m.fragmentShader && m.fragmentShader.includes('CG_ATMO_INCLUDED')) {
            m.userData.__uwPatched = true;
            m.defines = m.defines || {}; m.defines.CG_UW = 1;
            for (const k in UW) if (!m.uniforms[k]) m.uniforms[k] = UW[k];
            m.needsUpdate = true;
          } else if (!m.isShaderMaterial && m.fog !== false && !m.userData.__cgPatched && o.userData.noPatch) {
            // built-in material the owner keeps un-patched: medium only (no light changes)
            m.userData.__uwPatched = true;
            m.defines = m.defines || {}; m.defines.CG_UW = 1;
            const prev = m.onBeforeCompile;
            m.onBeforeCompile = function (shader, r) {
              if (prev) prev.call(this, shader, r);
              for (const k in ATMO) if (!shader.uniforms[k]) shader.uniforms[k] = ATMO[k];
              for (const k in UW) shader.uniforms[k] = UW[k];
            };
            const pk = m.customProgramCacheKey;
            m.customProgramCacheKey = function () { return (pk ? pk.call(this) : '') + '|uwM'; };
            m.needsUpdate = true;
          }
        }
      });
    },
    setTime(t) {
      UW.uUwTime.value = t;
      if (snow) snow.material.uniforms.uSnowT.value = t;
      if (cmap && (cmap.time !== t || cmap.focus !== UW.uUwCaustic.value.y)) cmap.render();
    },
    /** after lighting.update(): refract the (jittered) CSM light direction; LENS follows when under water */
    afterLightUpdate() {
      const csm = engine.lighting.csm;
      // toward the VISIBLE sun (ATMO.uSunDir, set per shot by the look) + the lighting's soft-shadow jitter,
      // so CSM shadows / N·L agree with the caustics, shafts and Snell's window
      const jit = csm.lightDirection.clone().negate().sub(SUN.dir);
      UW.uUwLightDir.value.copy(SUN.dir);
      const d = (UW.uUwLightMode.value > 0.5 ? SUN.dir : ATMO.uSunDir.value).clone().normalize().add(jit);
      d.y = Math.max(d.y, 0.02); d.normalize();
      const t = refract(d.clone().negate(), 1 / 1.333);
      csm.lightDirection.copy(t);
      csm.update();
      UW.uUwFrame.value = (UW.uUwFrame.value + 1) % 4096;
      const cam = engine.camera;
      if (LENS && cam.position.y < UW.uUwSurface.value - UW.uUwDome.value) {
        const sw = t.clone().negate();
        const p = sw.clone().multiplyScalar(1e4).add(cam.position).project(cam);
        const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
        LENS.uSunPos.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
        LENS.uSunFacing.value = fwd.dot(sw);
      }
    },
    onShot() {
      UW.uUwLightDir.value.copy(SUN.dir);
      UW.uUwSunIrr.value.set(SUN.color.r, SUN.color.g, SUN.color.b).multiplyScalar(SUN.intensity);
      placeSnow();
      UW.uUwPixAngle.value = (2 * Math.tan((engine.camera.fov * Math.PI) / 360)) / engine.height;
      if (cmap.time !== UW.uUwTime.value || cmap.focus !== UW.uUwCaustic.value.y) cmap.render();   // per-shot focus
      shaftDirty = true;
      const cam = engine.camera;
      const nearSurf = Math.abs(cam.position.y - UW.uUwSurface.value) < UW.uUwDome.value * 1.5 && UW.uUwMeniscus.value.w > 0;
      engine.pipeline.hdrHook = nearSurf ? meniscusPass : null;
      engine.pipeline.lensHook = nearSurf ? lensMaskPass : null;
    },
  };


  // -------- caustic map
  const hiQ = engine.quality.name !== 'preview';
  const cmap = new CausticMap(engine.renderer, hiQ ? 2048 : 1024, hiQ ? 640 : 384);
  UW.uUwSteps.value = hiQ ? 24 : 16;   // medium ray-march steps (per-pixel jitter converges with spp)
  cmap.render();

  // -------- god-ray occlusion map: an orthographic depth map from the refracted sun over a box ahead of the
  // camera, rendered ONCE per shot with three's own shadow machinery (alpha-tested cutouts, instancing and
  // batching handled; only castShadow objects occlude). Called from inside the main render (a hook object drawn
  // first) because WebGLShadowMap needs the renderer's current render state.
  const shaftLight = new THREE.DirectionalLight(0xffffff, 0);
  shaftLight.castShadow = true;
  const sres = hiQ ? 4096 : 2048;
  shaftLight.shadow.mapSize.set(sres, sres);
  shaftLight.shadow.bias = 0; shaftLight.shadow.normalBias = 0;
  shaftLight.shadow.autoUpdate = true;
  let shaftDirty = true;
  function placeShaft() {
    const cam = engine.camera;
    const R = UW.uUwShaftOcc.value.w;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
    const F = cam.position.clone().addScaledVector(fwd, R * 0.62);
    F.y = Math.min(F.y, UW.uUwSurface.value);
    const d = (UW.uUwLightMode.value > 0.5 ? SUN.dir : ATMO.uSunDir.value).clone().normalize(); d.y = Math.max(d.y, 0.02); d.normalize();
    const sw = refract(d.clone().negate(), 1 / 1.333).negate();     // toward the sun, under water
    const up = (UW.uUwSurface.value + 40 - F.y) / Math.max(sw.y, 0.1);
    shaftLight.position.copy(F).addScaledVector(sw, up);
    shaftLight.target.position.copy(F);
    shaftLight.updateMatrixWorld(true); shaftLight.target.updateMatrixWorld(true);
    const c = shaftLight.shadow.camera;
    c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = up + 320 / Math.max(sw.y, 0.1);
    c.updateProjectionMatrix();
  }
  const hookGeo = new THREE.BufferGeometry();
  hookGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const hookMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, fog: false });
  hookMat.userData.uwSkip = true;
  const hook = new THREE.Mesh(hookGeo, hookMat);
  hook.name = 'uwShaftHook'; hook.frustumCulled = false; hook.renderOrder = -1e9;
  hook.castShadow = false; hook.receiveShadow = false; hook.userData.noPatch = true;
  hook.onBeforeRender = (renderer, scene, camera) => {
    if (!shaftDirty || scene !== engine.scene || UW.uUwShaftOcc.value.x <= 0) return;
    shaftDirty = false;
    try {
      placeShaft();
      const sm = renderer.shadowMap;
      const au = sm.autoUpdate, nu = sm.needsUpdate;
      sm.autoUpdate = true;
      sm.render([shaftLight], scene, camera);
      sm.autoUpdate = au; sm.needsUpdate = nu;
      UW.tUwShaft.value = shaftLight.shadow.map.depthTexture;
      UW.uUwShaftM.value.copy(shaftLight.shadow.matrix);
      UW.uUwShaftOn.value = 1;
    } catch (e) { console.warn('[underwater] shaft occlusion map failed', e); UW.uUwShaftOn.value = 0; }
  };
  engine.scene.add(hook);

  // -------- background
  const bgMat = new THREE.ShaderMaterial({
    uniforms: { ...UW }, vertexShader: BG_VERT, fragmentShader: BG_FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
  });
  const bg = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), bgMat);
  bg.name = 'uwBackground'; bg.frustumCulled = false; bg.renderOrder = 1e6 + 1;
  bg.castShadow = false; bg.receiveShadow = false; bg.userData.noPatch = true;
  bgMat.userData.uwSkip = true;
  engine.scene.add(bg);

  // -------- marine snow
  const q = engine.quality;
  const count = Math.round((q.name === 'preview' ? 14000 : 40000) * UW.uUwSnow.value.z);
  const base = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.attributes.position = base.attributes.position; geo.attributes.uv = base.attributes.uv;
  const arr = new Float32Array(count * 4);
  const rng = engine.rng('uw:snow');
  for (let i = 0; i < count; i++) {
    let x, y, z;
    do { x = rng.next(); y = rng.next(); z = rng.next(); } while ((x - 0.5) ** 2 + (y - 0.5) ** 2 + (z - 0.5) ** 2 > 0.25);
    arr.set([x, y, z, rng.next()], i * 4);
  }
  geo.setAttribute('aSnow', new THREE.InstancedBufferAttribute(arr, 4));
  geo.instanceCount = count;
  const snowMat = new THREE.ShaderMaterial({
    uniforms: {
      ...UW,
      uSnowCenter: { value: new THREE.Vector3() }, uSnowR: { value: UW.uUwSnow.value.w },
      uUwSnowV: UW.uUwSnow, uSnowT: { value: 0 }, uPxScale: { value: 1000 },
    },
    defines: { CG_UW: 1 },
    vertexShader: SNOW_VERT,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying float vFade; varying vec3 vSnowWP; varying float vRnd;
      uniform vec4 uUwSnowV;
      ${UW_GLSL}
      void main(){
        vec2 d = vUv * 2.0 - 1.0; float r2 = dot(d, d);
        if (r2 > 1.0) discard;
        float a = (1.0 - r2) * (1.0 - r2) * vFade;
        float z = max(uUwSurface - vSnowWP.y, 0.0);
        if (z <= 0.0) discard;
        vec3 sw = uwSunW();
        vec3 V = normalize(vSnowWP - cameraPosition);
        // particle radiance: forward-scattered sun (bright toward the sun, inside shafts) + ambient
        vec3 sun = uwPhaseSun(V, sw) * exp(-uUwKdSun * (z / sw.y)) * uwShaft(vSnowWP, z, sw) * uwSunVis(vSnowWP, vec2(0.0)) * 22.0;
        vec3 amb = uUwAmbColor * exp(-uUwKdScat * z) * 2.2;
        vec3 col = (sun + amb) * uUwSnowV.x * mix(0.6, 1.4, vRnd);
        // additive: the medium in-scatter in front of the particle is already in the background,
        // so only the particle's own light, attenuated along the view path, is added
        col *= exp(-uwTau(length(vSnowWP - cameraPosition)));
        gl_FragColor = vec4(col * a, 0.0);
      }`,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  snowMat.userData.uwSkip = true;
  const snow = new THREE.Mesh(geo, snowMat);
  snow.name = 'uwMarineSnow'; snow.frustumCulled = false; snow.renderOrder = 5000;
  snow.castShadow = false; snow.receiveShadow = false; snow.userData.noPatch = true;
  engine.scene.add(snow);
  function placeSnow() {
    const cam = engine.camera;
    snowMat.uniforms.uSnowCenter.value.copy(cam.position);
    snowMat.uniforms.uSnowR.value = UW.uUwSnow.value.w;
    snowMat.uniforms.uPxScale.value = engine.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    snow.visible = UW.uUwSnow.value.x > 0;
  }

  // -------- meniscus pass (split level)
  let menMat = null, menRT = null;
  function meniscusPass(pl) {
    const r = pl.renderer;
    if (!menRT || menRT.width !== pl.w || menRT.height !== pl.h) {
      menRT?.dispose();
      menRT = new THREE.WebGLRenderTarget(pl.w, pl.h, { type: THREE.HalfFloatType, depthBuffer: false });
    }
    menMat ||= new THREE.ShaderMaterial({
      uniforms: { ...UW, tSrc: { value: null }, uInvProjView: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() }, uLensMode: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: MEN_FRAG, depthTest: false, depthWrite: false,
    });
    const cam = engine.camera;
    cam.updateMatrixWorld(true);
    menMat.uniforms.uInvProjView.value.copy(cam.matrixWorld).multiply(cam.projectionMatrixInverse);
    menMat.uniforms.uCam.value.copy(cam.position);
    menMat.uniforms.tSrc.value = pl.acc[pl.accIndex].texture;
    menMat.uniforms.uLensMode.value = 0;
    pl.quad.material = menMat;
    r.setRenderTarget(menRT);
    pl.quad.render(r);
    return menRT.texture;
  }
  let lensRT = null;
  function lensMaskPass(pl, lensTex) {
    if (!menMat) return null;
    const r = pl.renderer, img = lensTex.image || {};
    const w = img.width || pl.w, h = img.height || pl.h;
    if (!lensRT || lensRT.width !== w || lensRT.height !== h) {
      lensRT?.dispose();
      lensRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    }
    menMat.uniforms.tSrc.value = lensTex;
    menMat.uniforms.uLensMode.value = 1;
    pl.quad.material = menMat;
    r.setRenderTarget(lensRT);
    pl.quad.render(r);
    menMat.uniforms.uLensMode.value = 0;
    return lensRT.texture;
  }

  // r4 (sunken): per-shot overrides of the material overlay (core/sunken.js SK uniforms): looks.js `sk: {...}` or shot.sk
  const skSet = (k, v) => { const u = SK[k]; if (!u || k.startsWith('t')) return; if (Array.isArray(v)) u.value.fromArray(v); else if (u.value?.copy && v?.isVector4) u.value.copy(v); else u.value = v; };
  const skDefaults = Object.fromEntries(Object.entries(SK).filter(([k]) => !k.startsWith('t') && k !== 'uSkDrift').map(([k, u]) => [k, u.value?.clone ? u.value.clone() : u.value]));
  engine.onShot((shot) => {
    for (const [k, v] of Object.entries(skDefaults)) { const u = SK[k]; if (u.value?.copy) u.value.copy(v); else u.value = v; }
    const o = { ...((LOOKS[shot?.id] || {}).sk || {}), ...(shot?.sk || {}) };
    for (const [k, v] of Object.entries(o)) skSet(k, v);
    uw.onShot();
  });
  return uw;
}

/** refraction of a unit direction d (travelling) through a horizontal surface with normal +Y, eta = n1/n2 */
function refract(d, eta) {
  const n = new THREE.Vector3(0, 1, 0);
  const cosi = -n.dot(d);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return d.clone();
  return d.clone().multiplyScalar(eta).addScaledVector(n, eta * cosi - Math.sqrt(k)).normalize();
}
