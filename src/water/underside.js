// The sea surface seen from BELOW (sunken era, refs 6, 7, 9 lower half). OWNER: water.
//
// One plane at SUNKEN.surface drawn back-face only (it is only visible from under the water).
// Per pixel: ripple normal (FFT octaves + swell, LEAN variance) → the view ray either refracts out
// into the air (Snell's window, |angle| < 48.6° from the vertical: bright sky, the sun's sparkle)
// or is totally reflected back down (outside the window: the water below, deep blue, darker the
// steeper it looks down). Fresnel splits the energy in between. The resulting radiance then goes
// through atmoApply() — the underwater core turns it into the medium (absorption + in-scatter along
// the path from the camera), exactly like every other material.
import * as THREE from 'three';
import { ATMO_GLSL, atmoUniforms } from '../core/atmosphere.js';
import { NOISE_GLSL } from '../core/glsl.js';
import { WAVES_GLSL } from './waves.js';

const VERT = /* glsl */`
varying vec3 vW;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;

const FRAG = /* glsl */`
${ATMO_GLSL}
${NOISE_GLSL}
${WAVES_GLSL}
varying vec3 vW;
uniform float uTime;
uniform float uLevel;
uniform vec3 uSkyZen;     // sky radiance at the zenith (as seen through the window)
uniform vec3 uSkyHor;     // sky radiance near the horizon (edge of the window)
uniform vec3 uSunRad;     // sun radiance scale (the sparkle)
uniform vec3 uDeepUp;     // radiance of the water seen in a TIR reflection close to horizontal
uniform vec3 uDeepDown;   // ... looking steeply down
uniform vec4 uUnder;      // x: ripple gain, y: window edge brightness, z: sun lobe width, w: overall gain
uniform float uDebugU;
uniform float uUwWaveK;
void main(){
  vec3 P = vec3(vW.x, uLevel, vW.z);
  vec3 I = normalize(P - cameraPosition);           // ray from the camera, going up
  if (I.y <= 0.0) discard;                           // (camera above the plane: not ours)
  vec3 w = wWaves(P.xz, uWaveAmp * uUnder.x);
  vec2 slope = w.xy;
#ifdef CG_UW
  // the core's surface waves (same as caustics / god rays / meniscus); split level: air-view pixels are not ours
  if (uwUnder(cameraPosition, I) < 0.5) discard;
  { float uh; vec2 ug; vec3 uH; uwWaveDeriv(P.xz, uh, ug, uH); slope += ug * uUwWaveK; }
#else
  slope += wSwellSlope(P.xz, uTime);
#endif
  float var = w.z;
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));  // surface normal, up into the air
  // refraction water → air
  vec3 T0 = refract(I, -n, 1.333);
  vec3 Rr = reflect(I, -n);                             // back down into the water
  Rr.y = min(Rr.y, -0.02); Rr = normalize(Rr);
  float cosi = clamp(dot(I, n), 0.0, 1.0);
  // Fresnel (unpolarised, exact) for water → air; the edge of Snell's window is blurred by the
  // unresolved ripples (sub-pixel slope variance): a soft transmission weight across the critical angle
  const float CRIT = 0.6614;                             // cos(48.6 deg)
  float tw = smoothstep(CRIT - (0.012 + 1.2 * sqrt(var)), CRIT + (0.012 + 1.2 * sqrt(var)), cosi);
  float ci = max(cosi, CRIT + 1e-3);
  float sinT = min(1.0, 1.333 * sqrt(max(0.0, 1.0 - ci * ci)));
  float cost = sqrt(max(0.0, 1.0 - sinT * sinT));
  float rs = (1.333 * ci - cost) / (1.333 * ci + cost);
  float rp = (cost - 1.333 * ci) / (cost + 1.333 * ci);
  float F = mix(1.0, clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0), tw);
  // refracted direction (grazing along the surface in the TIR zone)
  vec3 It = I - n * dot(I, n);
  vec3 T = dot(T0, T0) > 0.0 ? normalize(T0) : normalize(It + n * 0.02);
  float e = clamp(T.y, 0.0, 1.0);
  vec3 skyC = mix(uSkyHor, uSkyZen, pow(e, 0.6));
  // the sun: a lobe widened by the unresolved ripple variance (energy-conserving normalisation)
  vec3 S = normalize(uSunDir);
  float mu = max(dot(T, S), 0.0);
  float wdt = uUnder.z + 2.5 * var;
  float lobe = exp(-(1.0 - mu) / max(wdt, 1e-4)) * (uUnder.z / max(wdt, 1e-4));
  skyC += uSunRad * lobe + uSunRad * 0.02 * pow(mu, 6.0);
  // bright rim at the edge of the window (grazing refraction of the bright horizon sky)
  skyC *= 1.0 + uUnder.y * (1.0 - smoothstep(0.0, 0.3, cosi - CRIT));
  vec3 deep = mix(uDeepUp, uDeepDown, smoothstep(0.0, 0.8, -Rr.y));
  vec3 col = (skyC * (1.0 - F) + deep * F) * uUnder.w;
  col = atmoApply(col, P);
  if (uDebugU > 0.5) col = uDebugU < 1.5 ? vec3(F) : n * 0.5 + 0.5;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createUnderside(engine, { waves, level, size = 30000, look = {} }) {
  const uniforms = {
    ...atmoUniforms(),
    ...waves,
    uLevel: { value: level },
    uSkyZen: { value: new THREE.Vector3(1.0, 1.6, 2.2) },
    uSkyHor: { value: new THREE.Vector3(1.6, 2.0, 2.3) },
    uSunRad: { value: new THREE.Vector3(60, 56, 48) },
    // r3 (look-sunken request, ref 7): the ceiling seen from below is bright — TIR of the lit water + overall gain
    uDeepUp: { value: new THREE.Vector3(0.12, 0.36, 0.46) },
    uDeepDown: { value: new THREE.Vector3(0.012, 0.05, 0.085) },
    uUnder: { value: new THREE.Vector4(1.6, 0.6, 0.004, 2.2) },
    uUwWaveK: { value: 1.0 },
    uDebugU: { value: Number(engine.params?.get?.('waterDebugU') || 0) },
  };
  for (const [k, v] of Object.entries(look)) if (uniforms[k]) { if (Array.isArray(v) && uniforms[k].value?.fromArray) uniforms[k].value.fromArray(v); else uniforms[k].value = v; }
  const mat = new THREE.ShaderMaterial({
    name: 'waterUnderside',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: true, depthTest: true,
    fog: false,
  });
  mat.userData.sunken = 'none';
  const geo = new THREE.PlaneGeometry(size, size, 32, 32).rotateX(-Math.PI / 2);
  geo.translate(0, level, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'waterUnderside';
  mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.userData.castShadow = false; mesh.userData.receiveShadow = false;
  mesh.userData.noPatch = true; mesh.userData.isWater = true;
  return { mesh, material: mat, uniforms };
}
