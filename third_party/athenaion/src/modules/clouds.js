// Mountain cloud banks + valley / canyon mist: raymarched volumes lit like the sky clouds.
//
// Two full-screen volumetric passes (transparent, premultiplied):
//   * BANKS (renderOrder -1000, drawn before other transparent things): orographic cloud banks —
//     a terrain-hugging blanket inside a mid-height altitude window that wraps the mountain flanks,
//     upper wisps around the summits; denser in the mountain backdrop of the shot cameras.
//   * MIST  (renderOrder +1000, drawn after water/waterfalls): low puffy mist in the canyon, over
//     the lagoon and at waterfall bases (ref 4).
// Both stop at the real scene depth: a tiny "depth grabber" object (renderOrder -1e9) blits the
// opaque depth buffer of the current render target into a depth texture right before the
// transparent pass. That texture is also published as engine.registry.sceneDepth for other
// modules (soft particles): { texture, valid: {value}, nearFar: {value: Vector2}, size: Vector2 }.
// If the blit is unsupported (or in nested passes such as the water reflection) the volumes fall back
// to the coarse terrain height map. NOTE for consumers: sceneDepth.valid refers to the main pass of the
// current sub-frame only — check renderer.getRenderTarget() === engine.pipeline.target before use.
// Per-shot overrides: shot.clouds = { uBankAmount, uMistAmount, uBankBright, ... } (see CLOUDS).
// r2: banks are heaped cumulus clumps in an altitude band (base ≈ 0.47 × surrounding massif + uBankAlt.x,
// thickness × uBankAlt.y) on the viewer side of slopes that rise through the band; per-shot art direction
// in src/world/looks.js: uBankAlt (where the band sits on the faces), uBankLobes [[azimuth from camera,
// half-width, gain, 0], …] (boost / cut coverage by bearing), uBankShape / uBankStyle / uBankLight (look);
// mist: uMistScale [shape tile m, detail tile m, coverage bias, gain], uMistLight [sun tint rgb, ambient].
// Debug: ?vols=0 hides the volumes, ?atmo=0 disables aerial perspective, ?skyclouds=0, ?voldebug=1.
//
// Density layout comes from two CPU maps (deterministic, from heightAt + seeded noise):
//   bank map: R coverage, G window centre (m), B window half-width (m), A terrain height (m)
//   mist map: R amount,   G base (m),      B thickness (m),      A terrain height (m)
import * as THREE from 'three';
import { heightAt, waterSDF, distPolyline } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { ATMO, ATMO_GLSL } from '../core/atmosphere.js';
import { SKY, CLOUD_GLSL, SKY_GLSL } from '../core/sky.js';
import { NOISE_GLSL } from '../core/glsl.js';
import { Simplex, smoothstep, clamp, lerp } from '../core/noise.js';
import { dirFromAzEl } from '../world/layout.js';
import { SHOTS } from '../world/shots.js';
import { LOOKS } from '../world/looks.js';
import { TERRAIN_UNIFORMS } from '../terrain/material.js';

// world regions (m)
export const BANK_REGION = { x0: -19000, x1: 19000, z0: -24000, z1: 9000, y0: 650, y1: 3300 };
export const MIST_REGION = { x0: -1050, x1: 450, z0: -1350, z1: 820, y0: -6, y1: 170 };

// tunables (shared uniform objects: tweak live / per shot via engine.registry.clouds.U)
export const CLOUDS = {
  uBankSigma: { value: 0.055 },     // extinction (1/m) at density 1
  uBankBright: { value: 3.6 },      // sun-lit brightness (multiple scattering compensation)
  uBankAmount: { value: 0.9 },      // global coverage multiplier (r4: thin broken band, was 1.8)
  uMistSigma: { value: 0.03 },
  uMistBright: { value: 2.0 },
  uMistAmount: { value: 0.8 },
  uVolSteps: { value: 32 },
  uMistScale: { value: new THREE.Vector4(420, 70, 0, 1) },
  uMistLight: { value: new THREE.Vector4(0.9, 0.94, 1.0, 1.1) },
  uTime: { value: 0 },
  // r2 bank shaping (per-shot overridable; arrays are converted)
  uBankScale: { value: new THREE.Vector3(7000, 2600, 500) }, // clump field / shape / detail tile sizes (m)
  // r4: thin, broken, soft-edged band at about half height of the massif (refs 3/8/9), was (150, 1.35)
  uBankAlt: { value: new THREE.Vector2(-100, 0.6) },           // base offset (m), thickness multiplier
  uBankErode: { value: 0.9 },
  uBankShape: { value: new THREE.Vector4(0.4, 0.3, 0.7, 0.45) },
  uBankHug: { value: new THREE.Vector2(600, 0.0) },
  uBankStyle: { value: new THREE.Vector4(1.8, 0.4, 2.0, 0.75) },
  uBankLight: { value: new THREE.Vector4(0.78, 0.8, 0.86, 1.0) },
  uBankLobeBase: { value: 1.0 },
  uBankLobes: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) }, // (az from camera, half-width, gain, 0)
};

// ------------------------------------------------------------------------------------ maps
function toHalf(arr) {
  const out = new Uint16Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = THREE.DataUtils.toHalfFloat(arr[i]);
  return out;
}
function dataTex(w, h, f32) {
  const t = new THREE.DataTexture(toHalf(f32), w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** max filter (separable) over a w*h grid */
function maxFilter(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let m = -1e9; for (let k = -r; k <= r; k++) { const ii = Math.min(w - 1, Math.max(0, i + k)); m = Math.max(m, src[j * w + ii]); }
    tmp[j * w + i] = m;
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let m = -1e9; for (let k = -r; k <= r; k++) { const jj = Math.min(h - 1, Math.max(0, j + k)); m = Math.max(m, tmp[jj * w + i]); }
    out[j * w + i] = m;
  }
  return out;
}
function blur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0; for (let k = -r; k <= r; k++) s += src[j * w + Math.min(w - 1, Math.max(0, i + k))];
    tmp[j * w + i] = s / (2 * r + 1);
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0; for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, j + k)) * w + i];
    out[j * w + i] = s / (2 * r + 1);
  }
  return out;
}

/** 0..1: how much a ground point lies in the mountain backdrop of the shot cameras */
function shotBackdrop(x, z) {
  let w = 0;
  for (const s of SHOTS) {
    const dx = s.target[0] - s.pos[0], dz = s.target[2] - s.pos[2], l = Math.hypot(dx, dz) || 1;
    const vx = x - s.pos[0], vz = z - s.pos[2], d = Math.hypot(vx, vz) || 1;
    const cosA = (vx * dx + vz * dz) / (d * l);
    const hfov = Math.atan(Math.tan(((s.fov || 45) * Math.PI) / 360) * 1.78);
    const a = Math.acos(Math.min(1, Math.max(-1, cosA)));
    w = Math.max(w, smoothstep(hfov * 1.05, hfov * 0.5, a) * smoothstep(5000, 8000, d) * smoothstep(17500, 13000, d));
  }
  return w;
}

// r2: banks lie in an altitude band (base ≈ 1000-1500 m, 400-1100 m thick) on the viewer side of the
// range: where the terrain under the cell is below the cloud top and the slopes within ~1.5 km rise
// through the band (refs 1, 3, 5, 8, 9: the banks hide the lower half of the snowy faces).
// map: R coverage, G cloud base (m), B thickness (m), A terrain height (m)
function buildBankMap(res) {
  const R = BANK_REGION, w = res, h = Math.round(res * (R.z1 - R.z0) / (R.x1 - R.x0));
  const n1 = new Simplex(9101), n2 = new Simplex(9102), n3 = new Simplex(9103), n4 = new Simplex(9104);
  const H = new Float32Array(w * h);
  const X = (i) => R.x0 + (i + 0.5) * (R.x1 - R.x0) / w, Z = (j) => R.z0 + (j + 0.5) * (R.z1 - R.z0) / h;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = heightAt(X(i), Z(j));
  const cell = (R.x1 - R.x0) / w;
  const Hnear = maxFilter(H, w, h, Math.max(1, Math.round(1100 / cell)));  // slopes rising nearby
  const Hwide = blur(maxFilter(H, w, h, Math.max(1, Math.round(2600 / cell))), w, h, 2); // surrounding massif
  const data = new Float32Array(w * h * 4);
  const AC = L.ACROPOLIS.center;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = X(i), z = Z(j), k = j * w + i;
    const hh = H[k], hn = Hnear[k], hw = Hwide[k];
    const rAc = Math.hypot(x - AC[0], z - AC[1]);
    // band altitude: ~ 0.42 of the surrounding massif (1200-2300 m on the 2.6-3.1 km main range)
    const massif = clamp(hw, 900, 3200);
    let base = massif * (0.47 + 0.06 * n1.fbm2(x / 7000, z / 7000, 3)) + 120 * n2.fbm2(x / 2500, z / 2500, 2);
    let thick = 450 + 520 * (0.5 + 0.5 * n2.fbm2(x / 5000 + 7, z / 5000, 3));
    // occasional higher wisps hugging the upper flanks
    const hi = smoothstep(0.25, 0.55, n4.fbm2(x / 9000, z / 9000, 2)) * smoothstep(2200, 2800, hw);
    base = lerp(base, massif * 0.62, hi); thick = lerp(thick, 380, hi);
    // in front of slopes that rise through the band; not buried in the mountain
    const adj = smoothstep(base + 50, base + 650, hn);
    const free = smoothstep(base + thick * 1.05, base + thick * 0.3, hh);
    const mtn = smoothstep(900, 1600, hw) * smoothstep(4500, 7500, rAc);
    let patches = smoothstep(-0.35, 0.25, n3.fbm2(x / 4200, z / 4200, 4));
    // art direction: denser banks in the mountain backdrop of the shot cameras
    patches = Math.max(patches, shotBackdrop(x, z) * smoothstep(-0.6, 0.0, n3.fbm2(x / 3000 + 11, z / 3000, 3)));
    const cov = adj * free * mtn * (0.15 + 0.85 * patches);
    data[k * 4] = clamp(cov, 0, 1);
    data[k * 4 + 1] = base;
    data[k * 4 + 2] = thick;
    data[k * 4 + 3] = hh;
  }
  return { tex: dataTex(w, h, data), w, h };
}

function buildMistMap(res) {
  const R = MIST_REGION, w = res, h = Math.round(res * (R.z1 - R.z0) / (R.x1 - R.x0));
  const n1 = new Simplex(9201), n2 = new Simplex(9202);
  const X = (i) => R.x0 + (i + 0.5) * (R.x1 - R.x0) / w, Z = (j) => R.z0 + (j + 0.5) * (R.z1 - R.z0) / h;
  const falls = L.WATERFALLS.map((f) => {
    const a = (f.dir * Math.PI) / 180;
    const run = Math.max(8, f.from[1] * 0.25);
    const x = f.from[0] + Math.sin(a) * run, z = f.from[2] - Math.cos(a) * run;
    const footH = Math.max(0, heightAt(x, z));
    return { x, z, r: 26 + f.width * 3.2 * f.flow, top: f.from[1], footH, drop: Math.max(10, f.from[1] - footH) };
  });
  const data = new Float32Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = X(i), z = Z(j), k = j * w + i;
    const hh = heightAt(x, z);
    const ws = waterSDF(x, z);
    const rv = distPolyline(x, z, L.RIVER.points);
    // canyon: river corridor north of the lagoon + lagoon margins
    const canyon = smoothstep(90, 10, rv.d) * smoothstep(320, 150, z);
    const lagoon = smoothstep(40, -40, ws) * smoothstep(-200, 100, z) * 0.3;
    // only on low ground (water level / canyon floor), never on the terraces or plateaus
    // cliffs nearby: mist hangs against the walls and rises higher there
    let hn = -1e9;
    for (let a = 0; a < 6; a++) { const an = a * Math.PI / 3; hn = Math.max(hn, heightAt(x + Math.cos(an) * 45, z + Math.sin(an) * 45)); }
    const cliff = smoothstep(15, 60, hn - Math.max(hh, 0));
    let amt = Math.max(canyon, lagoon, cliff * smoothstep(40, -20, ws) * 0.9) * smoothstep(22, 6, hh);
    let base = Math.max(hh, 0) - 3;
    let thick = 30 + 30 * (0.5 + 0.5 * n2.fbm2(x / 220, z / 220, 2)) + 45 * cliff;
    for (const f of falls) {
      const d = Math.hypot(x - f.x, z - f.z);
      const b = smoothstep(f.r, f.r * 0.3, d) * smoothstep(f.footH + 30, f.footH + 2, hh);
      if (b > amt) { amt = b; base = f.footH - 3; thick = 30 + f.drop * 0.5; }
    }
    // mist hangs against the walls but stays below the rim
    if (cliff > 0.05) thick = Math.max(20, Math.min(thick, hn - base - 6));
    const patches = smoothstep(-0.4, 0.3, n1.fbm2(x / 420, z / 420, 3));
    amt *= 0.15 + 0.85 * patches;
    data[k * 4] = clamp(amt, 0, 1);
    data[k * 4 + 1] = base;
    data[k * 4 + 2] = thick;
    data[k * 4 + 3] = hh;
  }
  return { tex: dataTex(w, h, data), w, h };
}

// ------------------------------------------------------------------------------------ shaders
const VERT = /* glsl */ `
varying vec2 vNdc;
void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
varying vec2 vNdc;
uniform mat4 uInvVP;
uniform sampler2D tDepth;
uniform float uDepthValid;
uniform vec2 uNearFar;
uniform vec2 uRes;
uniform sampler2D tMap;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uSigma;
uniform float uBright;
uniform float uAmount;
uniform float uVolSteps;
uniform float uTime;
uniform float uCloudPowder;
uniform float uEnvPass;
${ATMO_GLSL}
${NOISE_GLSL}
${CLOUD_GLSL}
${SKY_GLSL}

vec2 rayBox(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax){
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), max(tmin.z, 0.0)), min(min(tmax.x, tmax.y), tmax.z));
}
vec4 mapAt(vec2 xz){ return texture2D(tMap, (xz - uBoxMin.xz) / (uBoxMax.xz - uBoxMin.xz)); }

#ifdef VOL_BANKS
uniform vec3 uBankScale;   // clump field scale, shape noise scale, detail noise scale (m per texture tile)
uniform vec2 uBankAlt;     // base offset (m), thickness multiplier
uniform vec4 uBankLobes[4]; // per-shot art direction: (azimuth from the camera deg, half-width deg, gain, 0)
uniform float uBankLobeBase; // coverage multiplier outside the lobes
uniform float uBankErode;
uniform vec4 uBankShape;   // x: 0 separate clumps … 1 continuous strip, y: min dome top, z: dome range, w: density gain
uniform vec2 uBankHug;
uniform vec4 uBankLight;   // rgb: tint of the sun-lit term (distant banks read cool-neutral), a: ambient multiplier
uniform vec4 uBankStyle;   // x: vertical squash of the shape noise, y: billow (perlin-worley) weight, z: detail squash, w: edge softness     // x: height above the terrain where the bank thins out (m), y: strength 0..1
float bankLobes(vec3 p){
  vec2 v = p.xz - cameraPosition.xz;
  float az = degrees(atan(v.x, -v.y));
  float g = uBankLobeBase;
  for (int i = 0; i < 4; i++) {
    vec4 L = uBankLobes[i];
    if (L.y <= 0.0) continue;
    float da = abs(mod(az - L.x + 540.0, 360.0) - 180.0);
    g += L.z * smoothstep(L.y, L.y * 0.45, da);
  }
  return max(g, 0.0);
}
// orographic banks: heaped cumulus clumps (flat ragged bases, domed sunlit tops) in an altitude band
// on the viewer side of the slopes
float density(vec3 p, bool detail, out float hf){
  vec4 m = mapAt(p.xz);
  float cov = clamp(m.r * uAmount * bankLobes(p), 0.0, 1.0);
  float base = m.g + uBankAlt.x, thick = m.b * uBankAlt.y;
  hf = (p.y - base) / thick;
  if (cov < 0.01 || hf <= -0.25 || hf >= 1.0) return 0.0;
  float hag = p.y - m.a;
  if (hag < 0.0) return 0.0;
  vec2 q = p.xz + vec2(uTime * 3.0, -uTime * 1.2);
  // clumps: worley cells (~ scale/4 and scale/8) with their own dome height
  vec4 w = texture(tCloudShape, vec3(q * (1.0 / uBankScale.x), 0.37));
  float blobs = clamp((w.g * 0.65 + w.b * 0.35 - 0.6) / 0.3, 0.0, 1.0);
  float c = mix(smoothstep(1.0 - cov, 1.0 - cov + 0.45, blobs), cov * (0.55 + 0.45 * blobs), uBankShape.x);
  if (c <= 0.0) return 0.0;
  float top = uBankShape.y + uBankShape.z * blobs;
  vec3 sp = vec3(q.x, p.y * uBankStyle.x, q.y) * (1.0 / uBankScale.y);
  vec4 n = texture(tCloudShape, sp);
  // ragged, slightly lumpy base (no pancake bottoms); the band follows the slope a little
  float hb = hf + (n.a - 0.74) * 0.5 + 0.12 * smoothstep(400.0, 0.0, hag);
  float grad = smoothstep(0.0, 0.18, hb) * smoothstep(top, top * 0.4, hf);
  float pw = clamp((n.r - 0.62) / 0.3, 0.0, 1.0);
  float fb = clamp((n.g * 0.625 + n.b * 0.25 + n.a * 0.125 - 0.6) / 0.3, 0.0, 1.0);
  float shape = mix(fb, pw, uBankStyle.y);
  float hug = mix(1.0, smoothstep(uBankHug.x, uBankHug.x * 0.25, hag), uBankHug.y);
  float d = cgRemapU(shape * grad * hug, 1.0 - c * 0.85, 1.0, 0.0, 1.0) * c;
  d = pow(max(d, 0.0), uBankStyle.w);
  // the ground cuts the clouds softly (they wrap the slopes instead of ending in a hard line)
  d *= smoothstep(0.0, 70.0, hag);
  if (d <= 0.0) return 0.0;
  if (detail) {
    vec3 dn = texture(tCloudDetail, vec3(q.x, p.y * uBankStyle.z, q.y) * (1.0 / uBankScale.z) + vec3(uTime * 0.004, 0.0, 0.0)).rgb;
    float df = clamp((dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125 - 0.6) / 0.3, 0.0, 1.0);
    d = cgRemapU(d, mix(df, 1.0 - df, clamp(hf * 3.0, 0.0, 1.0)) * uBankErode, 1.0, 0.0, 1.0);
  }
  return clamp(d * uBankShape.w, 0.0, 1.0);
}
const float LSTEP0 = 40.0;
#else
// canyon mist: small puffy cells sitting on the water / ground
uniform vec4 uMistLight; // rgb: tint of the sun-lit term (white spray, not beige), a: ambient multiplier
uniform vec4 uMistScale; // x: shape tile (m), y: detail tile (m), z: coverage bias (+ = more puffs), w: density gain
float density(vec3 p, bool detail, out float hf){
  vec4 m = mapAt(p.xz);
  hf = (p.y - m.g) / max(m.b, 1.0);
  float amt = m.r * uAmount;
  if (amt < 0.01 || hf <= 0.0 || hf >= 1.0) return 0.0;
  float prof = smoothstep(0.0, 0.18, hf) * smoothstep(1.0, 0.25, hf);
  vec3 q = vec3(p.x + uTime * 1.5, p.y * 1.6 - uTime * 0.4, p.z + uTime * 0.6) * (1.0 / uMistScale.x);
  vec4 n = texture(tCloudShape, q);
  float pw = clamp((n.r - 0.62) / 0.3, 0.0, 1.0);
  float fb = clamp((n.g * 0.625 + n.b * 0.25 + n.a * 0.125 - 0.6) / 0.3, 0.0, 1.0);
  float shape = pw * 0.5 + fb * 0.5;
  float d = cgRemapU(shape * prof, clamp(1.0 - amt * 0.92 - uMistScale.z, 0.0, 0.98), 1.0, 0.0, 1.0) * min(amt, 1.0) * uMistScale.w;
  d *= smoothstep(-2.0, 6.0, p.y - m.a);
  if (d <= 0.0) return 0.0;
  if (detail) {
    vec3 dn = texture(tCloudDetail, p * (1.0 / uMistScale.y) + vec3(0.0, -uTime * 0.01, 0.0)).rgb;
    float df = clamp((dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125 - 0.6) / 0.3, 0.0, 1.0);
    d = cgRemapU(d, mix(df, 1.0 - df, clamp(hf * 3.0, 0.0, 1.0)) * 0.45, 1.0, 0.0, 1.0);
  }
  return clamp(d, 0.0, 1.0);
}
const float LSTEP0 = 6.0;
#endif

float lightOD(vec3 p){
  float od = 0.0, ds = LSTEP0, t = 0.0, hf;
  for (int j = 0; j < 5; j++) {
    float tt = t + ds * 0.5;
    vec3 q = p + uSunDir * tt;
    od += density(q, false, hf) * ds;
    // terrain (coarse) blocks the sun: clouds in the shadow of ridges
    if (q.y < mapAt(q.xz).a) od += 1.5 / uSigma;
    t += ds; ds *= 2.0;
  }
  return od * uSigma;
}

void main(){
  vec4 wp = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 ro = cameraPosition;
  vec3 rd = normalize(wp.xyz / wp.w - ro);
  vec2 tb = rayBox(ro, rd, uBoxMin, uBoxMax);
  if (tb.y <= tb.x) discard;
  float tmax = 1e9;
  if (uDepthValid > 0.5) {
    float z = texture2D(tDepth, gl_FragCoord.xy / uRes).r;
    if (z < 0.999999) {
      float viewZ = (uNearFar.x * uNearFar.y) / ((uNearFar.y - uNearFar.x) * z - uNearFar.y);
      vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
      tmax = -viewZ / max(dot(rd, fwd), 1e-4);
    }
  }
  float t0 = tb.x, t1 = min(tb.y, tmax);
  if (t1 <= t0) discard;
  float steps = uVolSteps;
  float dt = (t1 - t0) / steps;
#ifdef VOL_BANKS
  dt = max(dt, 25.0);
#else
  dt = max(dt, 2.0);
#endif
  float jit = cgFrameJitter();
  float t = t0 + dt * jit;
  float mu = dot(rd, uSunDir);
  vec3 ambTop = cgCloudAmbTop();
  vec3 ambBot = cgCloudAmbBot();
  vec3 scat = vec3(0.0);
  float T = 1.0, wsum = 0.0, dsum = 0.0, hf;
  // adaptive march: coarse steps through empty air, 1/4 steps inside cloud (the mean free path is
  // much shorter than the coarse step; binary hits would leave a dither pattern)
  bool fine = false;
  float zeros = 0.0;
  float iters = steps * 3.0;
  for (int i = 0; i < 256; i++) {
    if (float(i) >= iters || t > t1 || T < 0.01) break;
    vec3 p = ro + rd * t;
    if (uDepthValid < 0.5 && p.y < mapAt(p.xz).a) break;
    float d = density(p, fine, hf);
    if (!fine) {
      if (d > 0.0) { fine = true; zeros = 0.0; t = max(t0, t - dt * 0.75); continue; }
      t += dt; continue;
    }
    float st = dt * 0.25;
    if (d <= 0.002) { zeros += 1.0; if (zeros > 8.0) fine = false; t += st; continue; }
    zeros = 0.0;
    {
      float sigma = d * uSigma;
      float od = lightOD(p);
      vec3 sun = cgCloudSun(od, mu, d, uCloudPowder) * uBright;
#ifdef VOL_BANKS
      sun *= uBankLight.rgb;
      float ao = mix(0.45, 0.85, smoothstep(0.0, 0.8, hf)) * uBankLight.a;
#else
      sun *= uMistLight.rgb;
      float ao = mix(0.55, 1.0, smoothstep(0.0, 0.8, hf)) * uMistLight.a;
#endif
      vec3 amb = mix(ambBot, ambTop, pow(clamp(hf, 0.0, 1.0), 0.6)) * ao;
      float Ts = exp(-sigma * st);
      float w = T * (1.0 - Ts);
      scat += (sun + amb) * w;
      dsum += t * w; wsum += w;
      T *= Ts;
    }
    t += st;
  }
#ifdef VOL_DEBUG
  gl_FragColor = vec4(uDepthValid > 0.5 ? vec3(0.0, 2.0 * (1.0 - T), 0.0) : vec3(4.0, 0.0, 0.0), 1.0); return;
#endif
  if (T > 0.999) discard;
  // aerial perspective between the eye and the cloud
  float dist = dsum / max(wsum, 1e-6);
  float odh = atmoHazeOD(ro.y, rd.y, dist);
  vec3 Th = exp(-odh * uExtinction);
  float odm = atmoOD(ro.y, rd.y, dist, uMist.x, uMist.y, uMist.z);
  float Tm = exp(-odm);
  vec3 col = scat * Th + atmoHazeInscatter(rd) * (1.0 - Th) * (1.0 - T);
  col = col * Tm + atmoMistInscatter(rd) * (1.0 - Tm) * (1.0 - T);
  gl_FragColor = vec4(col, 1.0 - T);
}
`;

// ------------------------------------------------------------------------------------ depth grab
function makeDepthGrabber(engine) {
  const shared = engine.registry.sceneDepth || {
    texture: null, valid: { value: 0 }, nearFar: { value: new THREE.Vector2(0.5, 60000) }, size: new THREE.Vector2(1, 1),
  };
  engine.registry.sceneDepth = shared;
  let rt = null, failed = false, warned = false;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const mat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, colorWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sceneDepthGrabber';
  mesh.frustumCulled = false; mesh.renderOrder = -1e9;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.userData.noPatch = true; mesh.userData.castShadow = false;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    if (failed) return;
    const cur = renderer.getRenderTarget();
    // only the main HDR scene pass (not water reflections, shadow maps or env captures);
    // nested passes leave the flag alone (the water reflection renders in the middle of the main pass)
    if (!cur || cur !== engine.pipeline?.target || !camera.isPerspectiveCamera) return;
    shared.valid.value = 0;
    try {
      const gl = renderer.getContext();
      const w = cur.width, h = cur.height;
      if (!rt || rt.width !== w || rt.height !== h) {
        rt?.dispose();
        rt = new THREE.WebGLRenderTarget(w, h, {
          depthBuffer: true, stencilBuffer: false, type: THREE.UnsignedByteType,
          depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
        });
        rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
        renderer.initRenderTarget(rt);
        shared.texture = rt.depthTexture;
        shared.size.set(w, h);
      }
      const props = renderer.properties.get(cur);
      const src = cur.samples > 0 && props.__webglMultisampledFramebuffer ? props.__webglMultisampledFramebuffer : props.__webglFramebuffer;
      const dst = renderer.properties.get(rt).__webglFramebuffer;
      if (!src || !dst) return;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, src);
      shared.valid.value = 1;
      shared.frame = SKY.uFrame.value;
      shared.nearFar.value.set(camera.near, camera.far);
    } catch (e) {
      failed = true;
      if (!warned) { console.warn('[clouds] scene depth grab failed, using terrain fallback', e); warned = true; }
    }
  };
  return mesh;
}

// ------------------------------------------------------------------------------------ build
function makeVolume(engine, kind, map, region, depth) {
  const isBanks = kind === 'banks';
  const U = {
    ...ATMO, ...SKY,
    tDepth: { get value() { return depth.texture; } },
    uDepthValid: { value: 0 },
    uNearFar: depth.nearFar,
    uRes: { value: new THREE.Vector2(1, 1) },
    uInvVP: { value: new THREE.Matrix4() },
    tMap: { value: map.tex },
    uBoxMin: { value: new THREE.Vector3(region.x0, region.y0, region.z0) },
    uBoxMax: { value: new THREE.Vector3(region.x1, region.y1, region.z1) },
    uSigma: isBanks ? CLOUDS.uBankSigma : CLOUDS.uMistSigma,
    uBright: isBanks ? CLOUDS.uBankBright : CLOUDS.uMistBright,
    uAmount: isBanks ? CLOUDS.uBankAmount : CLOUDS.uMistAmount,
    uVolSteps: CLOUDS.uVolSteps,
    uMistScale: CLOUDS.uMistScale, uMistLight: CLOUDS.uMistLight,
    uTime: CLOUDS.uTime,
    ...(isBanks ? { uBankScale: CLOUDS.uBankScale, uBankAlt: CLOUDS.uBankAlt, uBankErode: CLOUDS.uBankErode, uBankShape: CLOUDS.uBankShape, uBankHug: CLOUDS.uBankHug, uBankStyle: CLOUDS.uBankStyle, uBankLight: CLOUDS.uBankLight,
      uBankLobeBase: CLOUDS.uBankLobeBase, uBankLobes: CLOUDS.uBankLobes } : {}),
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, vertexShader: VERT, fragmentShader: FRAG,
    defines: Object.assign(isBanks ? { VOL_BANKS: 1 } : { VOL_MIST: 1 }, engine.params.get('voldebug') === '1' ? { VOL_DEBUG: 1 } : {}),
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    fog: false,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = isBanks ? 'cloudBanks' : 'canyonMist';
  mesh.frustumCulled = false;
  mesh.renderOrder = isBanks ? -1000 : 1000;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.userData.noPatch = true; mesh.userData.castShadow = false; mesh.userData.receiveShadow = false;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const cur = renderer.getRenderTarget();
    if (cur) U.uRes.value.set(cur.width, cur.height);
    else { renderer.getDrawingBufferSize(U.uRes.value); }
    // real depth only in the main pass of this sub-frame (fallback: coarse terrain heights)
    U.uDepthValid.value = (cur && cur === engine.pipeline?.target && depth.valid.value > 0.5 && depth.frame === SKY.uFrame.value) ? 1 : 0;
    U.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
  };
  return mesh;
}

export async function build(engine) {
  const t0 = performance.now();
  const q = engine.quality;
  CLOUDS.uVolSteps.value = Math.max(24, Math.round(q.cloudSteps * 1.0)); // banks need ≥ 24 coarse steps (no dither)
  const bank = buildBankMap(Math.round(176 * Math.min(1.25, 0.6 + q.detail * 0.6)));
  const mist = buildMistMap(Math.round(150 * Math.min(1.25, 0.6 + q.detail * 0.6)));
  const grabber = makeDepthGrabber(engine);
  const shared = engine.registry.sceneDepth;
  const banks = makeVolume(engine, 'banks', bank, BANK_REGION, shared);
  const mistV = makeVolume(engine, 'mist', mist, MIST_REGION, shared);
  engine.scene.add(grabber, banks, mistV);
  // debug switches: ?vols=0 hides the volumes, ?atmo=0 disables aerial perspective, ?skyclouds=0 clears the sky
  const P = engine.params;
  if (P.get('vols') === '0') { banks.visible = false; mistV.visible = false; }
  if (P.get('atmo') === '0') ATMO.uAtmoEnabled.value = 0;
  if (P.get('skyclouds') === '0') SKY.uCloudCover.value = 0;
  engine.onUpdate((t) => { CLOUDS.uTime.value = t; });
  // per-shot overrides: shot.clouds = { uBankAmount: 0.6, uMistAmount: 1.3, ... }
  const defaults = Object.fromEntries(Object.entries(CLOUDS).map(([k, u]) => [k, u.value]));
  const tDefaults = Object.fromEntries(['uSnowLine', 'uTBounce', 'uRockTint', 'uGroundTint', 'uTBump', 'uFarTint'].filter((k) => TERRAIN_UNIFORMS[k]).map((k) => [k, TERRAIN_UNIFORMS[k].value?.clone ? TERRAIN_UNIFORMS[k].value.clone() : TERRAIN_UNIFORMS[k].value]));
  engine.onShot((shot) => {
    for (const [k, v] of Object.entries(defaults)) if (k !== 'uTime' && k !== 'uVolSteps') CLOUDS[k].value = v;
    const over = { ...(LOOKS[shot.id]?.clouds || {}), ...(shot.clouds || {}) }; // looks.js per-shot, then explicit
    for (const [k, v] of Object.entries(over)) {
      if (!CLOUDS[k]) { console.warn('[clouds] unknown override', k); continue; }
      const d = defaults[k];
      if (k === 'uBankLobes') CLOUDS[k].value = [0, 1, 2, 3].map((i) => new THREE.Vector4(...(v[i] || [0, 0, 0, 0])));
      else if (d && d.isVector4 && Array.isArray(v)) CLOUDS[k].value = new THREE.Vector4(...v);
      else if (d && d.isVector3 && Array.isArray(v)) CLOUDS[k].value = new THREE.Vector3(...v);
      else if (d && d.isVector2 && Array.isArray(v)) CLOUDS[k].value = new THREE.Vector2(...v);
      else CLOUDS[k].value = v;
    }
    // r4: per-shot terrain-material overrides (looks.js 'terrain': { uSnowLine, uTBounce, uRockTint, ... })
    for (const [k, v] of Object.entries(tDefaults)) { const u = TERRAIN_UNIFORMS[k]; if (u.value?.copy) u.value.copy(v); else u.value = v; }
    const tover = { ...(LOOKS[shot.id]?.terrain || {}), ...(shot.terrain || {}) };
    for (const [k, v] of Object.entries(tover)) {
      const u = TERRAIN_UNIFORMS[k];
      if (!u || !(k in tDefaults)) { console.warn('[clouds] unknown terrain override', k); continue; }
      if (Array.isArray(v) && u.value?.fromArray) u.value.fromArray(v); else u.value = v;
    }
  });
  engine.registry.clouds = { U: CLOUDS, bankMap: bank, mistMap: mist, BANK_REGION, MIST_REGION };
  console.log(`[clouds] maps ${bank.w}x${bank.h} + ${mist.w}x${mist.h}, built in ${Math.round(performance.now() - t0)} ms`);
}

function viewToward(az, el, pitch, fov = 50, pos = [0, 40, 0]) {
  const d = dirFromAzEl(az, pitch);
  return { pos, target: [pos[0] + d[0] * 1000, pos[1] + d[1] * 1000, pos[2] + d[2] * 1000], fov };
}

/** neutral calibration objects: warm-white marble (albedo ≈ 0.66) + 18% grey card */
function addCalibration(engine, x0, z0) {
  const marble = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.68, 0.64, 0.57), roughness: 0.55 });
  const grey = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.18, 0.18, 0.18), roughness: 0.9 });
  const g = new THREE.Group();
  const sph = new THREE.Mesh(new THREE.SphereGeometry(1.2, 64, 32), marble); sph.position.set(x0 - 2.5, 1.2, z0 + 1); g.add(sph);
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), marble); box.position.set(x0 + 1.5, 1.5, z0 - 1); box.rotation.y = 0.5; g.add(box);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 6, 48), marble); col.position.set(x0 - 0.5, 3, z0 - 4); g.add(col);
  const card = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.05), grey); card.position.set(x0 + 0.6, 0.8, z0 + 2.2); card.rotation.y = -0.6; g.add(card);
  engine.add(g);
}

export async function test(engine) {
  // ?world=1 builds the real terrain + water around the test (mountain / canyon views 4+)
  if (engine.params.get('world') === '1') {
    const g = engine.scene.getObjectByName('testGround'); if (g) g.removeFromParent();
    for (const m of ['terrain', 'water']) {
      try { const mod = await import('./' + m + '.js'); await mod.build(engine); } catch (e) { console.warn('[clouds test] ' + m + ' failed', e); }
    }
  }
  await build(engine);
  addCalibration(engine, -200, 0);
  return {
    views: [
      // 0: toward the sun (sun upper-left in frame, like ref 3)
      { ...viewToward(40, 0, 12, 50), sun: { azimuth: 12, elevation: 21 } },
      // 1: away from the sun, sky with cumulus (like refs 7/9)
      { ...viewToward(30, 0, 18, 55), sun: { azimuth: 238, elevation: 21 } },
      // 2: low sun at frame edge (like ref 1)
      { ...viewToward(25, 0, 8, 46), sun: { azimuth: 330, elevation: 9 } },
      // 3: lighting calibration (lit vs shadow marble, grey card), sun from the left
      { pos: [-191, 2.6, 9], target: [-200, 1.6, -0.5], fov: 45, sun: { azimuth: 212, elevation: 21 } },
      // 4 (world=1): telephoto on the main massif from the ruins terrace (cloud banks on the slopes)
      { pos: [-320, 60, 440], target: [3800, 900, -6000], fov: 26, near: 1, far: 60000, sun: { azimuth: 238, elevation: 21 } },
      // 5 (world=1): wide mountain panorama from above the acropolis
      { pos: [60, 260, 80], target: [1800, 800, -5000], fov: 50, near: 1, far: 60000, sun: { azimuth: 250, elevation: 18 } },
      // 6 (world=1): shot-3 camera, physical sun in frame (backlit, glare through the scene)
      { pos: [-330, 40, 430], target: [20, 85, -62], fov: 44, near: 0.5, far: 60000, sun: { azimuth: 8, elevation: 20 } },
      // 7 (world=1): shot-3 camera, light from the left + art-directed visible sun in frame
      { pos: [-330, 40, 430], target: [20, 85, -62], fov: 44, near: 0.5, far: 60000, sun: { azimuth: 268, elevation: 24 },
        sky: { uSunDiskMode: 1, uSunDiskDir: dirFromAzEl(8, 20) } },
    ],
  };
}
