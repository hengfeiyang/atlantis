// Clouds (sky agent): orographic cloud banks hugging the mountain wall to the north (ref 1, 4, 5) + the
// per-shot "visible sun" / cloud look hook. The sky cumulus / cirrus layer itself lives in core/sky.js.
// adapted from athenaion/src/modules/clouds.js (banks + depth grabber; the canyon mist is not used here —
// waterfall mist belongs to the water module).
//
// BANKS: one full-screen raymarched volume (transparent, premultiplied, renderOrder -1000) lit like the sky
// clouds (CLOUD_GLSL). It stops at the real scene depth: a tiny "depth grabber" (renderOrder -1e9) blits the
// opaque depth of the main HDR pass into a depth texture, also published as engine.registry.sceneDepth for
// other modules (soft particles): { texture, valid: {value}, nearFar: {value: Vector2}, size: Vector2, frame }.
// Check renderer.getRenderTarget() === engine.pipeline.target and sceneDepth.frame === SKY.uFrame.value
// before use. If the blit is unavailable the banks fall back to the coarse terrain height map.
//
// Bank layout comes from a CPU map (deterministic: heightAt + seeded noise) over BANK_REGION:
//   R coverage, G band base (m), B band thickness (m), A terrain height (m)
// Per-shot overrides: src/world/looks.js `clouds: { uBankAmount, uBankAlt: [base offset m, thickness ×], ... }`
// (merged under explicit shot.clouds). Debug: ?vols=0 hides the banks, ?skyclouds=0 clears the sky layer.
// r2 (look-golden): also applies looks.js `terrain: {...}` (far mountain shading, registry.terrain.uniforms) per shot, and in
// the golden era decouples the terrain's far-shadow sun (uTSun) from the visible-sun ATMO.uSunDir (it follows SUN.dir).
//
// VISIBLE SUN: when a shot's sky sets uSunDiskMode = 1 (sun disk art-directed into the frame while the CSM light
// comes from the side), this module's onShot hook points ATMO.uSunDir (aerial-perspective glow, sky cloud
// lighting, water glitter) at SKY.uSunDiskDir and rebuilds the IBL, so the sky, haze and glitter agree.
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { ATMO, ATMO_GLSL } from '../core/atmosphere.js';
import { SKY, CLOUD_GLSL, SKY_GLSL } from '../core/sky.js';
import { SUN } from '../core/lighting.js';
import { NOISE_GLSL } from '../core/glsl.js';
import { Simplex, smoothstep, clamp, lerp } from '../core/noise.js';
import { SHOTS } from '../world/shots.js';
import { LOOKS } from '../world/looks.js';

// world region of the banks (m): the mountain wall to the north (layout MOUNTAINS: 5.2-14 km, ±75°)
export const BANK_REGION = { x0: -21000, x1: 21000, z0: -21000, z1: 2500, y0: 250, y1: 3400 };

// tunables (shared uniform objects: tweak live / per shot via looks.js `clouds`)
export const CLOUDS = {
  // r3 (look-golden): denser, opaque, smaller heaps (r2: σ 0.05 × gain 0.5 → translucent sheets showing the faceted far
  // terrain through them = the "blocky" banks), whiter (sun tint compensated toward neutral), less detail erosion
  // (the 250-450 m erosion read as vertical combing in the level shot-1 view)
  uBankSigma: { value: 0.06 },      // extinction (1/m) at density 1
  uBankBright: { value: 5.5 },      // sun-lit brightness (multiple scattering compensation)
  uBankAmount: { value: 1.0 },      // global coverage multiplier
  uVolSteps: { value: 32 },
  uTime: { value: 0 },
  uBankScale: { value: new THREE.Vector3(3000, 1200, 250) }, // clump field / shape / detail tile sizes (m)
  uBankAlt: { value: new THREE.Vector2(0, 1.0) },            // base offset (m), thickness multiplier
  uBankErode: { value: 0.35 },
  uBankShape: { value: new THREE.Vector4(0.35, 0.35, 0.65, 1.0) }, // x clumps…strip, y min dome top, z dome range, w density gain
  uBankHug: { value: new THREE.Vector2(600, 0.0) },
  uBankStyle: { value: new THREE.Vector4(1.2, 0.6, 1.0, 0.6) },  // x vertical squash, y billow weight, z detail squash, w edge softness
  uBankLight: { value: new THREE.Vector4(0.85, 0.97, 1.2, 1.3) },  // rgb sun-lit tint, a ambient multiplier
  uBankLobeBase: { value: 1.0 },
  uBankLobes: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) }, // (az from camera, half-width, gain, 0)
  uBankOff: { value: 0 },           // 1 = hidden (camera under the sunken surface)
  // r3 (look-golden): the banks are lit by the SCENE light (SUN.dir, the one lighting the mountain faces behind them),
  // optionally re-aimed in elevation (uBankSunEl deg, 999 = SUN.dir as is). r2 used the visible-sun ATMO.uSunDir: at
  // 1.5-5° (shots 1-5) every light ray grazed through the ridges → mottled brown banks.
  uBankSunEl: { value: 999 },
  uBankNoDepth: { value: 0 },       // debug: 1 = ignore the scene depth (terrain height-map fallback)
  uBankSun: { value: new THREE.Vector3(0, 1, 0) },   // derived per shot (do not override)
  uBankRidge: { value: 0.35 },      // optical depth (× 1/σ) added per light tap below the terrain (soft ridge shadows)
  // r3: march steps: x fine step as a fraction of the coarse one, y fine-step growth per m (≤ 10 m + y·t), z/w coarse step
  // (z m + w·t; r2 40 m + 0.02·t = 240 m at 10 km skipped thin parts → hit-or-miss dither that 6-12 spp did not average)
  uBankStep: { value: new THREE.Vector4(0.3, 0.003, 12, 0.004) }, // 12 m + 0.004·t: clean at 1 spp (preview / video)
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

/** 0..1: how much a ground point lies in the mountain backdrop of the golden shot cameras */
function shotBackdrop(x, z) {
  let w = 0;
  for (const s of SHOTS) {
    if (s.era !== 'golden' && s.id !== 9) continue;
    const dx = s.target[0] - s.pos[0], dz = s.target[2] - s.pos[2], l = Math.hypot(dx, dz) || 1;
    const vx = x - s.pos[0], vz = z - s.pos[2], d = Math.hypot(vx, vz) || 1;
    const cosA = (vx * dx + vz * dz) / (d * l);
    const hfov = Math.atan(Math.tan(((s.fov || 45) * Math.PI) / 360) * 1.78);
    const a = Math.acos(Math.min(1, Math.max(-1, cosA)));
    w = Math.max(w, smoothstep(hfov * 1.1, hfov * 0.5, a) * smoothstep(4500, 7000, d) * smoothstep(17000, 12500, d));
  }
  return w;
}

// banks lie in an altitude band (≈ 0.45 of the surrounding massif) on the viewer side of the range: where the
// terrain under the cell is below the cloud top and the slopes within ~1.1 km rise through the band (ref 1:
// white heaped banks across the middle of the flanks, the peaks free above them).
function buildBankMap(res) {
  const R = BANK_REGION, w = res, h = Math.round(res * (R.z1 - R.z0) / (R.x1 - R.x0));
  const n1 = new Simplex(9101), n2 = new Simplex(9102), n3 = new Simplex(9103), n4 = new Simplex(9104);
  const H = new Float32Array(w * h);
  const X = (i) => R.x0 + (i + 0.5) * (R.x1 - R.x0) / w, Z = (j) => R.z0 + (j + 0.5) * (R.z1 - R.z0) / h;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = Math.max(0, heightAt(X(i), Z(j)));
  const cell = (R.x1 - R.x0) / w;
  const Hnear = maxFilter(H, w, h, Math.max(1, Math.round(1100 / cell)));
  const Hwide = blur(maxFilter(H, w, h, Math.max(1, Math.round(2600 / cell))), w, h, 2);
  const data = new Float32Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = X(i), z = Z(j), k = j * w + i;
    const hh = H[k], hn = Hnear[k], hw = Hwide[k];
    const rC = Math.hypot(x, z);
    const massif = clamp(hw, 700, 2800);
    let base = massif * (0.42 + 0.07 * n1.fbm2(x / 7000, z / 7000, 3)) + 110 * n2.fbm2(x / 2500, z / 2500, 2);
    let thick = 380 + 480 * (0.5 + 0.5 * n2.fbm2(x / 5000 + 7, z / 5000, 3));
    // occasional higher wisps hugging the upper flanks
    const hi = smoothstep(0.25, 0.55, n4.fbm2(x / 9000, z / 9000, 2)) * smoothstep(1700, 2300, hw);
    base = lerp(base, massif * 0.62, hi); thick = lerp(thick, 340, hi);
    const adj = smoothstep(base + 40, base + 600, hn);                 // slopes rising through the band nearby
    const free = smoothstep(base + thick * 1.05, base + thick * 0.3, hh); // not buried in the mountain
    const mtn = smoothstep(600, 1300, hw) * smoothstep(3200, 5200, rC);
    let patches = smoothstep(-0.35, 0.25, n3.fbm2(x / 4200, z / 4200, 4));
    patches = Math.max(patches, shotBackdrop(x, z) * smoothstep(-0.6, 0.0, n3.fbm2(x / 3000 + 11, z / 3000, 3)));
    const cov = adj * free * mtn * (0.15 + 0.85 * patches);
    data[k * 4] = clamp(cov, 0, 1);
    data[k * 4 + 1] = base;
    data[k * 4 + 2] = thick;
    data[k * 4 + 3] = hh;
  }
  // r3 (look-golden): smooth the coverage and the terrain-height channels. Every screen column of a level view shares one
  // xz direction, so any sharp xz feature of this map (a peak cutting the band, a coverage edge) became a vertical streak
  // through the banks (shot 1 "combed" clouds). The real terrain still cuts them via the scene depth.
  {
    const cov = new Float32Array(w * h), ter = new Float32Array(w * h);
    for (let k = 0; k < w * h; k++) { cov[k] = data[k * 4]; ter[k] = data[k * 4 + 3]; }
    const cs = blur(cov, w, h, 2), ts = blur(maxFilter(ter, w, h, 2), w, h, 4);
    for (let k = 0; k < w * h; k++) { data[k * 4] = cs[k]; data[k * 4 + 3] = ts[k]; }
  }
  return { tex: dataTex(w, h, data), w, h };
}

// ------------------------------------------------------------------------------------ shader
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
uniform float uBankOff;
uniform vec3 uBankScale;
uniform vec2 uBankAlt;
uniform vec4 uBankLobes[4];
uniform float uBankLobeBase;
uniform float uBankErode;
uniform vec4 uBankShape;
uniform vec2 uBankHug;
uniform vec4 uBankLight;
uniform vec4 uBankStyle;
uniform vec3 uBankSun;
uniform float uBankRidge;
uniform vec4 uBankStep;
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
// heaped cumulus clumps (ragged bases, domed sunlit tops) in an altitude band on the viewer side of the slopes
float density(vec3 p, bool detail, out float hf){
  vec4 m = mapAt(p.xz);
  float cov = clamp(m.r * uAmount * bankLobes(p), 0.0, 1.0);
  float base = m.g + uBankAlt.x, thick = m.b * uBankAlt.y;
  hf = (p.y - base) / thick;
  if (cov < 0.01 || hf <= -0.25 || hf >= 1.0) return 0.0;
  float hag = p.y - m.a;
  if (hag < 0.0) return 0.0;
  vec2 q = p.xz + vec2(uTime * 3.0, -uTime * 1.2);
  vec4 w = texture(tCloudShape, vec3(q * (1.0 / uBankScale.x), 0.37));
  float blobs = clamp((w.g * 0.65 + w.b * 0.35 - 0.6) / 0.3, 0.0, 1.0);
  float c = mix(smoothstep(1.0 - cov, 1.0 - cov + 0.45, blobs), cov * (0.55 + 0.45 * blobs), uBankShape.x);
  if (c <= 0.0) return 0.0;
  float top = uBankShape.y + uBankShape.z * blobs;
  vec3 sp = vec3(q.x, p.y * uBankStyle.x, q.y) * (1.0 / uBankScale.y);
  vec4 n = texture(tCloudShape, sp);
  float hb = hf + (n.a - 0.74) * 0.5 + 0.12 * smoothstep(400.0, 0.0, hag);
  float grad = smoothstep(0.0, 0.18, hb) * smoothstep(top, top * 0.4, hf);
  float pw = clamp((n.r - 0.62) / 0.3, 0.0, 1.0);
  float fb = clamp((n.g * 0.625 + n.b * 0.25 + n.a * 0.125 - 0.6) / 0.3, 0.0, 1.0);
  float shape = mix(fb, pw, uBankStyle.y);
  float hug = mix(1.0, smoothstep(uBankHug.x, uBankHug.x * 0.25, hag), uBankHug.y);
  float d = cgRemapU(shape * grad * hug, 1.0 - c * 0.85, 1.0, 0.0, 1.0) * c;
  d = pow(max(d, 0.0), uBankStyle.w);
  d *= smoothstep(0.0, 160.0, hag); // the ground cuts the clouds softly (they wrap the slopes; r3: 70 → 160 m, smooth map)
  if (d <= 0.0) return 0.0;
  if (detail) {
    vec3 dn = texture(tCloudDetail, vec3(q.x, q.y, p.y * uBankStyle.z) * (1.0 / uBankScale.z) + vec3(uTime * 0.004, 0.0, 0.0)).rgb;
    float df = clamp((dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125 - 0.6) / 0.3, 0.0, 1.0);
    d = cgRemapU(d, mix(df, 1.0 - df, clamp(hf * 3.0, 0.0, 1.0)) * uBankErode, 1.0, 0.0, 1.0);
  }
  return clamp(d * uBankShape.w, 0.0, 1.0);
}

float lightOD(vec3 p){
  float od = 0.0, ds = 40.0, t = 0.0, hf;
  for (int j = 0; j < 5; j++) {
    float tt = t + ds * 0.5;
    vec3 q = p + uBankSun * tt;
    od += density(q, false, hf) * ds;
    // ridges shadow the banks (soft: the coarse 220 m terrain map made hard, mottled shadow patches)
    od += uBankRidge / uSigma * smoothstep(0.0, 160.0, mapAt(q.xz).a - q.y);
    t += ds; ds *= 2.0;
  }
  return od * uSigma;
}

void main(){
  if (uBankOff > 0.5) discard;
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
  // r2 (look-golden): steps bounded in metres and growing with distance (was (t1 - t0) / steps with 1/4 fine steps:
  // 150-600 m slabs through σ 0.05 cloud → banks read as stacked horizontal slices / blocky cut-outs, shot 1)
  float dt0 = max((t1 - t0) / steps, 20.0);
  float jit = cgFrameJitter();
  float t = t0 + min(dt0, uBankStep.z + uBankStep.w * t0) * jit;
  float mu = dot(rd, uBankSun);
  vec3 ambTop = cgCloudAmbTop();
  vec3 ambBot = cgCloudAmbBot();
  vec3 scat = vec3(0.0);
  float T = 1.0, wsum = 0.0, dsum = 0.0, hf;
  bool fine = false;
  float zeros = 0.0;
  // r3: iteration budget independent of the quality preset (preview's 16 → 240 iterations ran out inside the banks:
  // truncated, striped clouds at --quality preview / video)
  float iters = max(steps * 10.0, 480.0);
  for (int i = 0; i < 480; i++) {
    if (float(i) >= iters || t > t1 || T < 0.01) break;
    float dtC = min(dt0, uBankStep.z + uBankStep.w * t);
    float dtF = clamp(dtC * uBankStep.x, 6.0, 10.0 + uBankStep.y * t);
    vec3 p = ro + rd * t;
    if (uDepthValid < 0.5 && p.y < mapAt(p.xz).a) break;
    float d = density(p, fine, hf);
    if (!fine) {
      if (d > 0.0) { fine = true; zeros = 0.0; t = max(t0, t - dtC * 0.85); continue; }
      t += dtC; continue;
    }
    float st = dtF;
    if (d <= 0.002) { zeros += 1.0; if (zeros > 10.0) fine = false; t += st; continue; }
    zeros = 0.0;
    {
      float sigma = d * uSigma;
      float od = lightOD(p);
      vec3 sun = cgCloudSun(od, mu, d, uCloudPowder) * uBright * uBankLight.rgb;
      float ao = mix(0.45, 0.85, smoothstep(0.0, 0.8, hf)) * uBankLight.a;
      vec3 amb = mix(ambBot, ambTop, pow(clamp(hf, 0.0, 1.0), 0.6)) * ao;
      float Ts = exp(-sigma * st);
      float w = T * (1.0 - Ts);
      scat += (sun + amb) * w;
      dsum += t * w; wsum += w;
      T *= Ts;
    }
    t += st;
  }
  if (T > 0.999) discard;
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
    texture: null, valid: { value: 0 }, nearFar: { value: new THREE.Vector2(0.5, 60000) }, size: new THREE.Vector2(1, 1), frame: -1,
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
function makeBanks(engine, map, region, depth) {
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
    uSigma: CLOUDS.uBankSigma, uBright: CLOUDS.uBankBright, uAmount: CLOUDS.uBankAmount,
    uVolSteps: CLOUDS.uVolSteps, uTime: CLOUDS.uTime, uBankOff: CLOUDS.uBankOff,
    uBankScale: CLOUDS.uBankScale, uBankAlt: CLOUDS.uBankAlt, uBankErode: CLOUDS.uBankErode, uBankShape: CLOUDS.uBankShape,
    uBankHug: CLOUDS.uBankHug, uBankStyle: CLOUDS.uBankStyle, uBankLight: CLOUDS.uBankLight,
    uBankLobeBase: CLOUDS.uBankLobeBase, uBankLobes: CLOUDS.uBankLobes,
    uBankSun: CLOUDS.uBankSun, uBankRidge: CLOUDS.uBankRidge, uBankStep: CLOUDS.uBankStep,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    fog: false,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'cloudBanks';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.userData.noPatch = true; mesh.userData.castShadow = false; mesh.userData.receiveShadow = false;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const cur = renderer.getRenderTarget();
    if (cur) U.uRes.value.set(cur.width, cur.height);
    else renderer.getDrawingBufferSize(U.uRes.value);
    U.uDepthValid.value = (cur && cur === engine.pipeline?.target && depth.valid.value > 0.5 && depth.frame === SKY.uFrame.value && !CLOUDS.uBankNoDepth.value) ? 1 : 0;
    U.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
  };
  return mesh;
}

const TERRAIN_LOOK_KEYS = ['uFarTint', 'uRockTint', 'uGroundTint', 'uSnowLine', 'uTBounce'];
let terrainDefaults = null;
const WATER_LOOK_KEYS = ['uSunSpec', 'uGlitterTint'];
let waterDefaults = null;
/** apply looks.js `clouds` (+ explicit shot.clouds) and the visible-sun convention for a shot */
function makeShotHook(engine, defaults, terrainSun) {
  return (shot) => {
    for (const [k, v] of Object.entries(defaults)) if (k !== 'uTime' && k !== 'uVolSteps' && k !== 'uBankSun') {
      const u = CLOUDS[k];
      if (k === 'uBankLobes') u.value = v.map((x) => x.clone());
      else if (v?.clone) u.value = v.clone(); else u.value = v;
    }
    const over = { ...(LOOKS[shot.id]?.clouds || {}), ...(shot.clouds || {}) };
    for (const [k, v] of Object.entries(over)) {
      if (!CLOUDS[k]) { console.warn('[clouds] unknown override', k); continue; }
      const d = defaults[k];
      if (k === 'uBankLobes') CLOUDS[k].value = [0, 1, 2, 3].map((i) => new THREE.Vector4(...(v[i] || [0, 0, 0, 0])));
      else if (d && (d.isVector4 || d.isVector3 || d.isVector2) && Array.isArray(v)) CLOUDS[k].value = d.clone().fromArray(v);
      else CLOUDS[k].value = v;
    }
    // r3: bank light = the scene light (SUN.dir), elevation optionally re-aimed (uBankSunEl)
    {
      const d = SUN.dir, el = CLOUDS.uBankSunEl.value;
      if (el > 900) CLOUDS.uBankSun.value.copy(d).normalize();
      else {
        const h = Math.hypot(d.x, d.z) || 1, e = (el * Math.PI) / 180;
        CLOUDS.uBankSun.value.set((d.x / h) * Math.cos(e), Math.sin(e), (d.z / h) * Math.cos(e));
      }
    }
    // sunken era: banks only above the water (shot 9 split level), never for an underwater camera
    CLOUDS.uBankOff.value = engine.era === 'sunken' && engine.camera.position.y < L.SUNKEN.surface ? 1 : 0;
    // visible sun: atmosphere glow, sky cloud lighting and water glitter follow the art-directed disk
    if (SKY.uSunDiskMode.value > 0.5) {
      ATMO.uSunDir.value.copy(SKY.uSunDiskDir.value).normalize();
      engine.lighting.buildEnvironment();
    }
    if (terrainSun) terrainSun.value.copy(SUN.dir).normalize();
    // r2 (look-golden): per-shot terrain look (looks.js `terrain: { uFarTint, uRockTint, uGroundTint, uSnowLine, uTBounce }`)
    // → registry.terrain.uniforms (far mountain shading); defaults restored first
    const tu = engine.registry.terrain?.uniforms;
    if (tu) {
      if (!terrainDefaults) terrainDefaults = Object.fromEntries(TERRAIN_LOOK_KEYS.filter((k) => tu[k]).map((k) => [k, tu[k].value?.clone ? tu[k].value.clone() : tu[k].value]));
      for (const [k, v] of Object.entries(terrainDefaults)) { if (tu[k].value?.copy) tu[k].value.copy(v); else tu[k].value = v; }
      for (const [k, v] of Object.entries({ ...(LOOKS[shot.id]?.terrain || {}), ...(shot.terrain || {}) })) {
        if (!tu[k]) { console.warn('[clouds] unknown terrain look override', k); continue; }
        if (Array.isArray(v)) { if (tu[k].value.isColor) tu[k].value.setRGB(...v); else tu[k].value.fromArray(v); } else tu[k].value = v;
      }
    }
    // r2 (look-golden): per-shot sun-glitter look (looks.js `water: { uSunSpec, uGlitterTint }` → registry.water.uniforms);
    // defaults restored first; an explicit shot.waterTune (water module) keeps priority
    const wu = engine.registry.water?.uniforms;
    if (wu) {
      if (!waterDefaults) waterDefaults = Object.fromEntries(WATER_LOOK_KEYS.filter((k) => wu[k]).map((k) => [k, wu[k].value?.clone ? wu[k].value.clone() : wu[k].value]));
      const explicit = shot.waterTune || {};
      for (const [k, v] of Object.entries(waterDefaults)) if (!(k in explicit)) { if (wu[k].value?.copy) wu[k].value.copy(v); else wu[k].value = v; }
      for (const [k, v] of Object.entries({ ...(LOOKS[shot.id]?.water || {}), ...(shot.water || {}) })) {
        if (!wu[k] || !WATER_LOOK_KEYS.includes(k)) { console.warn('[clouds] unknown water look override', k); continue; }
        if (k in explicit) continue;
        if (Array.isArray(v)) { if (wu[k].value.isColor) wu[k].value.setRGB(...v); else wu[k].value.fromArray(v); } else wu[k].value = v;
      }
    }
  };
}

export async function build(engine) {
  const t0 = performance.now();
  const q = engine.quality;
  CLOUDS.uVolSteps.value = Math.max(24, Math.round(q.cloudSteps));
  const bank = buildBankMap(300); // r3: one resolution for every preset (preview banks = high banks)
  const grabber = makeDepthGrabber(engine);
  const banks = makeBanks(engine, bank, BANK_REGION, engine.registry.sceneDepth);
  engine.scene.add(grabber, banks);
  const P = engine.params;
  if (P.get('vols') === '0') banks.visible = false;
  if (P.get('skyclouds') === '0') SKY.uCloudCover.value = 0;
  engine.onUpdate((t) => { CLOUDS.uTime.value = t; });
  const defaults = Object.fromEntries(Object.entries(CLOUDS).map(([k, u]) => [k, Array.isArray(u.value) ? u.value.map((x) => x.clone()) : u.value?.clone ? u.value.clone() : u.value]));
  // r2 (look-golden): the terrain's far-field heightfield shadow + sun bounce (registry.terrain.uniforms.uTSun) shared
  // ATMO.uSunDir, i.e. the VISIBLE sun disk (1.5-5° above the horizon in shots 1-5) while the CSM light comes from
  // 14-17° → the whole mountain range sat in a fake low-sun shadow (shot 1: dark grey silhouettes). Golden era: give
  // the terrain its own uniform that follows the light direction (SUN.dir). Must run before the first compile.
  let terrainSun = null;
  const tu = engine.registry.terrain?.uniforms;
  if (tu && engine.era === 'golden' && tu.uTSun === ATMO.uSunDir) {
    terrainSun = { value: SUN.dir.clone() };
    tu.uTSun = terrainSun;
  }
  engine.onShot(makeShotHook(engine, defaults, terrainSun));
  engine.registry.clouds = { U: CLOUDS, bankMap: bank, BANK_REGION };
  console.log(`[clouds] bank map ${bank.w}x${bank.h}, built in ${Math.round(performance.now() - t0)} ms`);
}

// ------------------------------------------------------------------------------------ test
// Test views: the golden shot cameras (+ looks) over a stand-in sea and the analytic mountain wall, so the sky,
// banks and sun placement can be judged without the other modules.
async function addStandIns(engine) {
  const g = engine.scene.getObjectByName('testGround'); if (g) g.removeFromParent();
  // dark sea plane (slightly glossy: picks up the sky / sun in the IBL)
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(120000, 120000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.012, 0.035, 0.07), roughness: 0.12, metalness: 0 }));
  sea.position.y = -0.5; sea.name = 'standInSea';
  engine.add(sea, { castShadow: false, receiveShadow: true });
  // mountain wall from heightAt (coarse grid): 34 km x 18 km
  const nx = 170, nz = 90, x0 = -17000, x1 = 17000, z0 = -19000, z1 = -1000;
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + (x0 + x1) / 2, z = pos.getZ(i) + (z0 + z1) / 2;
    pos.setXYZ(i, x, Math.max(-5, heightAt(x, z)), z);
  }
  geo.computeVertexNormals();
  const rock = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.22, 0.2, 0.17), roughness: 0.95 });
  const m = new THREE.Mesh(geo, rock); m.name = 'standInMountains';
  engine.add(m);
}

export async function test(engine) {
  const world = engine.params.get('world') === '1';
  if (!world) await addStandIns(engine);
  await build(engine);
  const shotView = (id) => {
    const s = SHOTS.find((x) => x.id === id), lk = LOOKS[id] || {};
    const v = { pos: s.pos, target: s.target, fov: s.fov, near: 0.5, far: 60000, sun: lk.sun, sky: lk.sky, grade: lk.grade, atmo: lk.atmo, clouds: lk.clouds };
    for (const k of Object.keys(v)) if (v[k] === undefined) delete v[k];
    return v;
  };
  return { views: [1, 2, 3, 4, 5, 9].map(shotView) };
}
