// Aerial perspective + height fog shared by every material.
//
// We replace three.js' fog chunks so ANY built-in material (with fog: true, the default) gets
// physically-motivated atmosphere: chromatic extinction (distant things turn blue-grey), sun-
// directional in-scatter (Mie glow toward the sun) and a low valley mist layer.
//
// Uniform objects in ATMO are shared by reference: engine.patchMaterial() injects them into every
// material's shader, so changing ATMO.uX.value updates all materials at once.
// Custom ShaderMaterials: add `...atmoUniforms()` to uniforms, include ATMO_GLSL in the fragment
// shader and call `col = atmoApply(col, worldPos);`.
import * as THREE from 'three';

export const ATMO = {
  uSunDir: { value: new THREE.Vector3(-0.7, 0.35, 0.6).normalize() }, // direction TOWARD the sun
  uSunColor: { value: new THREE.Color(1.0, 0.86, 0.68) },             // sun radiance tint used for in-scatter
  // haze: x = density at base height (1/m), y = scale height (m), z = base height (m)
  uHaze: { value: new THREE.Vector3(0.00001, 1600, 0) },  // r4: 0.000007 → 0.00001 (+ uHazeLow for the mid-ground; more veiled the snow range); r2: lowered (mountains agent test w4_s9_h2m: crisp blue-grey range, ref 9)
  // far haze (art-directed): extra optical depth (dist / y)^2 * x — keeps 2-15 km crisp, fades the far horizon
  uHazeFar: { value: new THREE.Vector2(0.32, 15000) },  // 11-18 km ranges stay readable blue-grey (refs), not a white veil
  // r4: low aerial-perspective layer (density 1/m at y = 0, scale height m): separates fore / mid / background
  // (city, terraces, foothills at 0.3-3 km) without veiling the high snow
  uHazeLow: { value: new THREE.Vector2(0.000022, 300) },
  uHazeColor: { value: new THREE.Color(1.28, 1.55, 2.0) },           // ambient sky in-scatter (pale horizon, refs ≈ #dfe3e8)
  uExtinction: { value: new THREE.Vector3(0.62, 0.85, 1.25) },        // per-channel extinction weights (rayleigh-ish)
  // mist: low, dense, white layer (valleys, waterfalls, lagoon)
  uMist: { value: new THREE.Vector3(0.00016, 16, 0) },
  uMistColor: { value: new THREE.Color(1.35, 1.45, 1.6) },
  // x = Mie g, y = sun glow strength in haze, z = sun glow strength in mist
  uMie: { value: new THREE.Vector3(0.76, 0.55, 0.8) },
  uAtmoTime: { value: 0 },
  uAtmoEnabled: { value: 1 },
};

export function atmoUniforms() { return { ...ATMO }; }

export const ATMO_GLSL = /* glsl */ `
#ifndef CG_ATMO_INCLUDED
#define CG_ATMO_INCLUDED
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHaze;
uniform vec2 uHazeFar;
uniform vec2 uHazeLow;
uniform vec3 uHazeColor;
uniform vec3 uExtinction;
uniform vec3 uMist;
uniform vec3 uMistColor;
uniform vec3 uMie;
uniform float uAtmoTime;
uniform float uAtmoEnabled;

// Optical depth of an exponential height-density layer along a ray.
float atmoOD(float y0, float dy, float dist, float dens, float H, float h0){
  float a = dens * exp(clamp(-(y0 - h0) / H, -60.0, 60.0));
  float k = dy * dist / H;
  float f = abs(k) > 1e-3 ? (1.0 - exp(-clamp(k, -60.0, 60.0))) / k : 1.0 - 0.5 * k;
  return a * dist * f;
}
float atmoHG(float mu, float g){
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}
// Colour the haze adds when looking along dir (also used by the sky at the horizon).
vec3 atmoHazeInscatter(vec3 dir){
  float mu = dot(dir, uSunDir);
  float ph = atmoHG(mu, uMie.x) * 4.0 * 3.14159265; // normalised so isotropic ≈ 1
  return uHazeColor + uSunColor * uMie.y * ph * 0.25;
}
vec3 atmoMistInscatter(vec3 dir){
  float mu = dot(dir, uSunDir);
  float ph = atmoHG(mu, 0.6) * 4.0 * 3.14159265;
  return uMistColor + uSunColor * uMie.z * ph * 0.2;
}
// haze optical depth (exponential layer + far-distance term)
float atmoHazeOD(float y0, float dy, float dist){
  float f = dist / uHazeFar.y;
  return atmoOD(y0, dy, dist, uHaze.x, uHaze.y, uHaze.z) + atmoOD(y0, dy, dist, uHazeLow.x, uHazeLow.y, 0.0) + uHazeFar.x * f * f * exp(-max(y0 + dy * dist * 0.5, 0.0) / 2500.0);
}
vec3 atmoApplyFrom(vec3 col, vec3 camPos, vec3 wp){
  if (uAtmoEnabled < 0.5) return col;
  vec3 V = wp - camPos;
  float dist = length(V);
  vec3 dir = V / max(dist, 1e-4);
  float tH = atmoHazeOD(camPos.y, dir.y, dist);
  float tM = atmoOD(camPos.y, dir.y, dist, uMist.x, uMist.y, uMist.z);
  vec3 TH = exp(-tH * uExtinction);
  float TM = exp(-tM);
  col = col * TH + atmoHazeInscatter(dir) * (1.0 - TH);
  col = col * TM + atmoMistInscatter(dir) * (1.0 - TM);
  return col;
}
vec3 atmoApply(vec3 col, vec3 wp){ return atmoApplyFrom(col, cameraPosition, wp); }
#endif
`;

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vAtmoWorldPos;
#endif
`;
const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  {
    vec4 atmoWP = vec4( transformed, 1.0 );
    #ifdef USE_BATCHING
      atmoWP = batchingMatrix * atmoWP;
    #endif
    #ifdef USE_INSTANCING
      atmoWP = instanceMatrix * atmoWP;
    #endif
    vAtmoWorldPos = ( modelMatrix * atmoWP ).xyz;
  }
#endif
`;
const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vAtmoWorldPos;
  ${ATMO_GLSL}
#endif
`;
const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = atmoApply( gl_FragColor.rgb, vAtmoWorldPos );
#endif
`;

let installed = false;
/** Replace three's fog chunks globally and enable fog on the scene. */
export function installAtmosphere(scene) {
  if (!installed) {
    THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERTEX;
    THREE.ShaderChunk.fog_vertex = FOG_VERTEX;
    THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAGMENT;
    THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT;
    installed = true;
  }
  // a Fog instance is only needed so three defines USE_FOG; its values are unused.
  scene.fog = new THREE.Fog(0xffffff, 1, 2);
}

/** Set the sun direction (vector pointing toward the sun). */
export function setAtmoSun(dir) { ATMO.uSunDir.value.copy(dir).normalize(); }
