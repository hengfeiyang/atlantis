// Sky dome: art-directed clear-sky gradient + raymarched volumetric cumulus layer + sun disk.
// Shares the atmosphere uniforms so the horizon matches the aerial perspective of distant terrain.
// Also used (with uEnvPass = 1, no sun disk, fewer steps) to build the image-based lighting environment.
//
// Volumetric clouds use two tileable 3D noise textures generated once on the GPU
// (ensureCloudTextures(renderer), called by core/lighting.js):
//   tCloudShape  128³ RGBA: R = Perlin-Worley, G/B/A = Worley fbm at 3 frequencies
//   tCloudDetail  32³ RGBA: R/G/B = Worley fbm at 3 frequencies (edge erosion)
// CLOUD_GLSL (exported) holds the shared lighting helpers so modules/clouds.js can light its
// mountain banks and valley mist exactly like the sky clouds.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ATMO, ATMO_GLSL } from './atmosphere.js';
import { NOISE_GLSL } from './glsl.js';

export const SKY = {
  // ---- clear sky
  uZenith: { value: new THREE.Color(0.11, 0.24, 0.68) },  // zenith radiance (linear; refs at ~30° elevation ≈ #739fd4 … #88acd9, paler overhead)
  uSkyFalloff: { value: 6.0 },        // exponent of the zenith→horizon blend (higher = deep blue lower down)
  uSkyAureole: { value: new THREE.Vector3(0.3, 0.7, 4.0) }, // broad glow, mid glow, tight glow around the sun
  uGround: { value: new THREE.Color(0.36, 0.30, 0.22) },  // radiance below the horizon (env map bounce: warm sunlit ground → warm shadows)
  uSunDisk: { value: 1600.0 },     // radiance multiplier of the solar disk
  uSunSize: { value: 0.0048 },     // angular radius (rad), real sun ≈ 0.0046
  // art-directed visible sun: when uSunDiskMode = 1 the disk, aureole and lens glare use uSunDiskDir
  // instead of the light direction (refs 3/7/8 show the sun in frame while the scene is lit from the left)
  uSunDiskMode: { value: 0 },
  uSunDiskDir: { value: new THREE.Vector3(0, 0.34, -0.94) },
  // ---- cumulus layer
  uCloudCover: { value: 0.42 },    // 0..1 sky fraction
  uCloudScale: { value: 1.2 },     // horizontal feature scale multiplier
  uCloudOffset: { value: new THREE.Vector2(0, 0) }, // km, shifts the weather pattern (composition per shot)
  // r5: softer, shaded, higher cumulus (bright 4.2 / sigma 0.09 / base 1900 read as flat white paper cut-outs
  // from below, shots 2/6/7): thinner extinction → gradual edges, less multiple-scattering lift → grey bases
  uCloudBright: { value: 2.8 },    // sun-lit cloud brightness (multiple-scattering compensation)
  uCloudBase: { value: 3000 },     // m
  uCloudThick: { value: 400 },     // m (flat fair-weather cumulus, refs 7/9; r2: thinner)
  uCloudSigma: { value: 0.04 },   // extinction (1/m) at density 1 (r2: lighter undersides, ref 7)
  uCloudMaxDist: { value: 50000 }, // m
  uCloudWind: { value: new THREE.Vector2(6.0, -2.0) }, // m/s drift (video)
  uCloudAmbient: { value: 1.7 },
  uCloudPowder: { value: 0.6 },
  uCloudErode: { value: 1.1 },     // detail-noise erosion of the cumulus edges (higher = more ragged, structured)
  // ---- high cirrus / altocumulus streaks (refs 1, 3, 7): x amount, y altitude (m), z streak direction (rad)
  uCirrus: { value: new THREE.Vector3(0.25, 7500, 0.6) },
  uEnvPass: { value: 0 },
  uEnvScale: { value: 0.21 },       // IBL fill relative to the visible sky (art-directed contrast: deep shadows)
  uEnvBlue: { value: 0.1 },         // IBL bias toward the zenith blue (0 = neutral sky fill, higher = cooler shadows)
  uEnvSat: { value: 0.65 },         // IBL saturation (refs: near shadows are warm-neutral grey, not sky-blue)
  uSkyTime: { value: 0 },
  uCloudSteps: { value: 24 },
  // ---- shared by every volumetric (sky clouds, mountain banks, mist)
  uFrame: { value: 0 },                                   // sub-frame index (jitter decorrelation)
  uSunIrr: { value: new THREE.Vector3(8, 7, 6) },  // sun irradiance = colour * intensity (set by lighting)
  tCloudShape: { value: null },
  tCloudDetail: { value: null },
  uCloudReady: { value: 0 },
};

/** GLSL helpers shared by all volumetrics (needs SKY uniforms bound). */
export const CLOUD_GLSL = /* glsl */ `
#ifndef CG_CLOUD_INCLUDED
#define CG_CLOUD_INCLUDED
uniform sampler3D tCloudShape;
uniform sampler3D tCloudDetail;
uniform float uCloudReady;
uniform float uFrame;
uniform vec3 uSunIrr;
float cgRemapU(float x, float a, float b, float c, float d){ return c + (x - a) / (b - a) * (d - c); }
float cgHGp(float mu, float g){ float g2 = g * g; return (1.0 - g2) / (12.5663706 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5)); }
// interleaved gradient noise, decorrelated per accumulated sub-frame
float cgIGN(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float cgFrameJitter(){ return fract(cgIGN(gl_FragCoord.xy) + uFrame * 0.61803398875); }
// sky light reaching cloud tops / bases (cyan-shifted: avoids lavender edges when mixed with warm sun)
uniform vec3 uZenith;
float cgSkyLevel(){ return dot(uZenith, vec3(0.2126, 0.7152, 0.0722)) / 0.263; }
vec3 cgCloudAmbTop(){ return vec3(0.40, 0.62, 1.05) * cgSkyLevel(); }
vec3 cgCloudAmbBot(){ return vec3(0.30, 0.38, 0.55) * cgSkyLevel(); }
// Light scattered toward the eye by a cloud sample.
//   odSun: optical depth toward the sun, mu: cos(view, sun), dens: local extinction-weighted density 0..1
// Multiple scattering approximated with octaves (Wrenninge 2013); powder term darkens thin edges
// seen away from the sun (Schneider 2015); returns radiance per unit (σs/σt ≈ 1).
vec3 cgCloudSun(float odSun, float mu, float dens, float powderK){
  float s = 0.0, a = 1.0, b = 1.0, c = 1.0;
  for (int k = 0; k < 4; k++) {
    float ph = mix(mix(cgHGp(mu, 0.82 * c), cgHGp(mu, -0.28 * c), 0.28), 0.0795775, float(k) * 0.3);
    s += a * exp(-odSun * b) * ph;
    a *= 0.5; b *= 0.4; c *= 0.55;
  }
  float powder = 1.0 - exp(-dens * 12.0);
  s *= mix(1.0, powder, powderK * clamp(0.6 - 0.6 * mu, 0.0, 1.0));
  return uSunIrr * s;
}
#endif
`;

/** Clear-sky gradient (no sun disk, no clouds). Needs ATMO + SKY uniforms. */
export const SKY_GLSL = /* glsl */ `
#ifndef CG_SKY_INCLUDED
#define CG_SKY_INCLUDED
uniform float uSkyFalloff;
uniform vec3 uSkyAureole;
uniform vec3 uGround;
uniform float uSunDiskMode;
uniform vec3 uSunDiskDir;
vec3 cgVisibleSunDir(){ return uSunDiskMode > 0.5 ? normalize(uSunDiskDir) : uSunDir; }
vec3 cgSkyGradient(vec3 d){
  float h = clamp(d.y, -1.0, 1.0);
  float mu = dot(d, cgVisibleSunDir());
  vec3 hor = atmoHazeInscatter(d);
  float hh = max(h, 0.0);
  // optical air mass grows quickly near the horizon: deep blue overhead, milky near the horizon
  float t = pow(1.0 - hh, uSkyFalloff);
  // the clear sky brightens a little from the zenith down to mid elevations before it pales
  vec3 zen = uZenith * (1.0 + 0.38 * (1.0 - hh));
  vec3 col = mix(zen, hor, t);
  // Rayleigh angular structure: sky is darkest/deepest ~90° from the sun, brighter on the sun side
  float ray = 0.75 * (1.0 + mu * mu);
  col *= mix(1.0, 0.9 + 0.12 * ray, 1.0 - t);
  // Mie aureole (warm) around the sun, strongest near the horizon where the light path is long
  float m = max(mu, 0.0);
  col += uSunColor * (uSkyAureole.x * pow(m, 6.0) * (0.35 + 0.65 * t) + uSkyAureole.y * pow(m, 40.0) + uSkyAureole.z * pow(m, 600.0));
  return col;
}
#endif
`;

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = p.xyww; // at the far plane
}
`;

const frag = /* glsl */ `
varying vec3 vDir;
uniform float uSunDisk;
uniform float uSunSize;
uniform float uCloudCover;
uniform float uCloudScale;
uniform vec2 uCloudOffset;
uniform float uCloudBright;
uniform float uCloudBase;
uniform float uCloudThick;
uniform float uCloudSigma;
uniform float uCloudMaxDist;
uniform vec2 uCloudWind;
uniform float uCloudAmbient;
uniform float uCloudPowder;
uniform float uCloudErode;
uniform vec3 uCirrus;
uniform float uEnvPass;
uniform float uEnvScale;
uniform float uEnvBlue;
uniform float uEnvSat;
uniform float uSkyTime;
uniform float uCloudSteps;
${ATMO_GLSL}
${NOISE_GLSL}
${CLOUD_GLSL}
${SKY_GLSL}

const float RE = 6360000.0;
float raySphereFar(vec3 ro, vec3 rd, float R){
  float b = dot(ro, rd), c = dot(ro, ro) - R * R, disc = b * b - c;
  if (disc < 0.0) return -1.0;
  return -b + sqrt(disc);
}

// weather: coverage + cloud top (fraction of layer) from very low frequency slices of the shape noise
// (texture channels are ~uniform in [0.55, 0.92]; normalise before thresholding)
vec2 skyWeather(vec2 q){
  vec4 w1 = textureLod(tCloudShape, vec3(q * (1.0 / 37000.0), 0.31), 0.0);
  vec4 w2 = textureLod(tCloudShape, vec3(q * (1.0 / 6500.0) + 0.37, 0.73), 0.0);
  float blobs = clamp((w2.g * 0.7 + w2.b * 0.3 - 0.6) / 0.3, 0.0, 1.0); // worley cells → cumulus clumps
  float field = clamp((w1.r - 0.62) / 0.3, 0.0, 1.0);                     // large patches of more/less cloud
  float v = blobs * 0.6 + field * 0.4;
  float cov = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.3, v);
  float top = clamp(0.25 + 0.75 * field * blobs + 0.25 * (blobs - 0.5), 0.2, 1.0);
  return vec2(cov, top);
}

float skyDensity(vec3 p, float hf, bool detail){
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec2 q = (p.xz + uCloudOffset * 1000.0 + uCloudWind * uSkyTime) / uCloudScale;
  vec2 w = skyWeather(q);
  if (w.x <= 0.0) return 0.0;
  // cumulus height gradient: crisp-ish flat base, rounded top whose height varies per clump
  float grad = smoothstep(0.0, 0.07, hf) * smoothstep(w.y, w.y * 0.35, hf);
  if (grad <= 0.0) return 0.0;
  vec3 sp = vec3(q.x, p.y * 1.3, q.y) * (1.0 / 2600.0);
  vec4 n = textureLod(tCloudShape, sp, 0.0);
  float pw = clamp((n.r - 0.62) / 0.3, 0.0, 1.0);
  float fbm = clamp((n.g * 0.625 + n.b * 0.25 + n.a * 0.125 - 0.6) / 0.3, 0.0, 1.0);
  float shape = pw * 0.6 + fbm * 0.4;
  float base = cgRemapU(shape * grad, 1.0 - w.x, 1.0, 0.0, 1.0) * w.x;
  if (base <= 0.0) return 0.0;
  if (detail) {
    vec3 dn = textureLod(tCloudDetail, vec3(q.x, p.y, q.y) * (1.0 / 430.0) + vec3(0.0, uSkyTime * 0.002, 0.0), 0.0).rgb;
    float dfbm = clamp((dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125 - 0.6) / 0.3, 0.0, 1.0);
    float mod_ = mix(dfbm, 1.0 - dfbm, clamp(hf * 5.0, 0.0, 1.0)); // wispy bases, billowy tops
    base = cgRemapU(base, mod_ * uCloudErode, 1.0, 0.0, 1.0);
  }
  return clamp(base, 0.0, 1.0);
}

float skyLightOD(vec3 p, float alt){
  float od = 0.0, ds = 35.0, t = 0.0;
  for (int j = 0; j < 6; j++) {
    float tt = t + ds * 0.5;
    vec3 q = p + uSunDir * tt;
    float a = alt + uSunDir.y * tt;
    float hf = (a - uCloudBase) / uCloudThick;
    od += skyDensity(vec3(q.x, a, q.z), hf, j < 2) * ds;
    t += ds; ds *= 2.1;
  }
  return od * uCloudSigma;
}

// returns scattered radiance (rgb) and transmittance (a); dist = transmittance-weighted cloud distance
vec4 skyClouds(vec3 cam, vec3 rd, float steps, float jit, out float dist){
  dist = 0.0;
  vec3 ro = vec3(0.0, RE + cam.y, 0.0);
  float tIn = raySphereFar(ro, rd, RE + uCloudBase);
  float tOut = raySphereFar(ro, rd, RE + uCloudBase + uCloudThick);
  if (tIn < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  tOut = min(tOut, uCloudMaxDist);
  if (tOut <= tIn) return vec4(0.0, 0.0, 0.0, 1.0);
  float len = tOut - tIn;
  float dt = len / steps;
  float t = tIn + dt * jit;
  float mu = dot(rd, uSunDir);
  // ambient: sky dome above (blue), ground + lower sky below (warm grey)
  vec3 ambTop = cgCloudAmbTop();
  vec3 ambBot = cgCloudAmbBot();
  vec3 scat = vec3(0.0);
  float T = 1.0, wsum = 0.0, dsum = 0.0;
  // adaptive march: coarse steps through clear air, 1/4 steps inside cloud
  bool fine = false;
  float zeros = 0.0, st = dt;
  float iters = steps * 3.0;
  for (int i = 0; i < 200; i++) {
    if (float(i) >= iters || T < 0.012 || t > tOut) break;
    vec3 rp = ro + rd * t;
    float alt = length(rp) - RE;
    float hf = (alt - uCloudBase) / uCloudThick;
    vec3 p = vec3(cam.x + rd.x * t, alt, cam.z + rd.z * t);
    bool lod = fine && t < 16000.0;
    // thin out the far field so the horizon is not a carpet of identical puffs
    float dens = skyDensity(p, hf, lod) * mix(1.0, 0.35, smoothstep(9000.0, 38000.0, t));
    if (!fine) {
      if (dens > 0.0) { fine = true; zeros = 0.0; t = max(tIn, t - dt * 0.75); continue; }
      t += dt; continue;
    }
    st = dt * 0.25;
    if (dens <= 0.003) { zeros += 1.0; if (zeros > 8.0) fine = false; t += st; continue; }
    zeros = 0.0;
    {
      float sigma = dens * uCloudSigma;
      float od = skyLightOD(p, alt);
      vec3 sun = cgCloudSun(od, mu, dens, uCloudPowder);
      float ao = mix(0.5, 1.0, smoothstep(0.0, 0.7, hf));
      vec3 amb = mix(ambBot, ambTop, pow(clamp(hf, 0.0, 1.0), 0.6)) * ao * uCloudAmbient;
      vec3 Ls = sun * uCloudBright + amb;
      float Ts = exp(-sigma * st);
      float w = T * (1.0 - Ts);
      scat += Ls * w;
      dsum += t * w; wsum += w;
      T *= Ts;
    }
    t += st;
  }
  dist = wsum > 0.0 ? dsum / wsum : tIn;
  return vec4(scat, T);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = cgSkyGradient(d);
  // ---- thin high cirrus streaks (behind the cumulus): flat layer, anisotropic noise, lit by sun + sky
  if (uCirrus.x > 0.0 && uCloudReady > 0.5 && d.y > 0.0) {
    float tc = (uCirrus.y - cameraPosition.y) / max(d.y, 0.035);
    vec2 q = cameraPosition.xz + d.xz * tc + uCloudOffset * 1000.0 + uCloudWind * uSkyTime * 2.0;
    float ca = cos(uCirrus.z), sa = sin(uCirrus.z);
    q = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
    vec4 n1 = textureLod(tCloudShape, vec3(q.x / 42000.0, q.y / 9500.0, 0.21), 0.0);
    vec4 n2 = textureLod(tCloudShape, vec3(q.x / 15000.0 + 0.3, q.y / 3200.0, 0.63), 0.0);
    vec4 n3 = textureLod(tCloudShape, vec3(q / 30000.0, 0.47), 0.0);
    float field = smoothstep(0.78, 0.92, n3.r);                       // patches of cirrus, clear elsewhere
    float wisp = clamp((n1.g * 0.6 + n2.b * 0.4 - 0.66) / 0.2, 0.0, 1.0);
    float a = wisp * wisp * field * uCirrus.x;
    a *= smoothstep(0.035, 0.18, d.y) * (1.0 - smoothstep(0.3, 0.65, d.y)) * (1.0 - smoothstep(30000.0, 90000.0, tc)); // streaks toward the horizon only
    float muC = max(dot(d, cgVisibleSunDir()), 0.0);
    vec3 cir = atmoHazeInscatter(d) * 0.85 + uSunColor * (0.5 + 3.0 * pow(muC, 10.0));
    col = mix(col, cir, clamp(a, 0.0, 0.85));
  }
  float Tc = 1.0;
  if (uCloudReady > 0.5 && d.y > -0.02) {
    float steps = uEnvPass > 0.5 ? max(8.0, floor(uCloudSteps * 0.5)) : uCloudSteps;
    float dist;
    vec3 rd = normalize(vec3(d.x, max(d.y, 0.0005), d.z));
    vec4 c = skyClouds(cameraPosition, rd, steps, cgFrameJitter(), dist);
    if (c.a < 0.999) {
      float od = atmoHazeOD(cameraPosition.y, rd.y, dist);
      vec3 Th = exp(-od * uExtinction * 0.8);
      vec3 hz = atmoHazeInscatter(rd);
      float fadeH = smoothstep(-0.02, 0.03, d.y);
      // in the env map clouds are subdued (keeps the fill light cool and the shadows deep)
      vec3 cl = c.rgb * Th * (uEnvPass > 0.5 ? 0.3 : 1.0) + hz * (1.0 - Th) * (1.0 - c.a);
      col = mix(col, col * c.a + cl, fadeH);
      Tc = mix(1.0, c.a, fadeH);
    }
  }
  // IBL: bias toward the saturated zenith blue (cool shadows) and scale down for contrast
  if (uEnvPass > 0.5) {
    col = mix(col, uZenith * 1.25, uEnvBlue * smoothstep(0.0, 0.3, d.y)) * uEnvScale;
    col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uEnvSat);
  }
  // ---- below the horizon: ground bounce (absolute radiance; mostly matters for the env map)
  if (d.y < 0.0) col = mix(col, uGround, smoothstep(0.0, -0.18, d.y));
  // ---- sun disk (not in the env map, the directional light handles it)
  if (uEnvPass < 0.5) {
    float mu = dot(d, cgVisibleSunDir());
    float cosR = cos(uSunSize);
    float disk = smoothstep(cosR - 0.00002, cosR + 0.00001, mu);
    col += uSunColor * uSunDisk * disk * (0.6 + 0.4 * smoothstep(cosR, 1.0, mu)) * Tc;
  }
  // r5: alpha 0 = sky in the HDR target (the grade uses the accumulated alpha as a sky mask: no local
  // contrast boost on clouds); the env pass ignores alpha
  gl_FragColor = vec4(col, uEnvPass > 0.5 ? 1.0 : 0.0);
}
`;

export function createSky() {
  const geo = new THREE.SphereGeometry(1, 64, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...ATMO, ...SKY },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1e6; // after opaque geometry: only shades uncovered pixels
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.userData.noPatch = true;
  return mesh;
}

// ------------------------------------------------------------------------------------------
// Tileable 3D noise generation (GPU, once)
const GEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;
const GEN_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uZ;
uniform float uMode; // 0 shape, 1 detail
vec3 h33(vec3 p){
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
// tileable gradient noise, period = freq (integer lattice)
float gnoise(vec3 x, float freq){
  vec3 p = floor(x), w = fract(x);
  vec3 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  vec3 ga = h33(mod(p + vec3(0,0,0), freq)) * 2.0 - 1.0;
  vec3 gb = h33(mod(p + vec3(1,0,0), freq)) * 2.0 - 1.0;
  vec3 gc = h33(mod(p + vec3(0,1,0), freq)) * 2.0 - 1.0;
  vec3 gd = h33(mod(p + vec3(1,1,0), freq)) * 2.0 - 1.0;
  vec3 ge = h33(mod(p + vec3(0,0,1), freq)) * 2.0 - 1.0;
  vec3 gf = h33(mod(p + vec3(1,0,1), freq)) * 2.0 - 1.0;
  vec3 gg = h33(mod(p + vec3(0,1,1), freq)) * 2.0 - 1.0;
  vec3 gh = h33(mod(p + vec3(1,1,1), freq)) * 2.0 - 1.0;
  float va = dot(ga, w - vec3(0,0,0)), vb = dot(gb, w - vec3(1,0,0)), vc = dot(gc, w - vec3(0,1,0)), vd = dot(gd, w - vec3(1,1,0));
  float ve = dot(ge, w - vec3(0,0,1)), vf = dot(gf, w - vec3(1,0,1)), vg = dot(gg, w - vec3(0,1,1)), vh = dot(gh, w - vec3(1,1,1));
  return va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va) + u.x * u.y * (va - vb - vc + vd)
       + u.y * u.z * (va - vc - ve + vg) + u.z * u.x * (va - vb - ve + vf) + u.x * u.y * u.z * (-va + vb + vc - vd + ve - vf - vg + vh);
}
float worley(vec3 uv, float freq){
  vec3 id = floor(uv), p = fract(uv);
  float minD = 10000.0;
  for (float x = -1.0; x <= 1.0; x++) for (float y = -1.0; y <= 1.0; y++) for (float z = -1.0; z <= 1.0; z++) {
    vec3 off = vec3(x, y, z);
    vec3 h = h33(mod(id + off, vec3(freq))) * 0.5 + 0.5;
    h += off;
    vec3 d = p - h;
    minD = min(minD, dot(d, d));
  }
  return 1.0 - minD; // inverted
}
float perlinfbm(vec3 p, float freq, int octaves){
  float G = exp2(-0.85), amp = 1.0, noise = 0.0;
  for (int i = 0; i < 8; ++i) {
    if (i >= octaves) break;
    noise += amp * gnoise(p * freq, freq);
    freq *= 2.0; amp *= G;
  }
  return noise;
}
float worleyFbm(vec3 p, float freq){
  return worley(p * freq, freq) * 0.625 + worley(p * freq * 2.0, freq * 2.0) * 0.25 + worley(p * freq * 4.0, freq * 4.0) * 0.125;
}
float remap(float x, float a, float b, float c, float d){ return (((x - a) / (b - a)) * (d - c)) + c; }
void main(){
  vec3 p = vec3(vUv, uZ);
  vec4 col;
  if (uMode < 0.5) {
    float freq = 4.0;
    float pfbm = mix(1.0, perlinfbm(p, 4.0, 7), 0.5);
    pfbm = abs(pfbm * 2.0 - 1.0); // billowy
    col.g = worleyFbm(p, freq);
    col.b = worleyFbm(p, freq * 2.0);
    col.a = worleyFbm(p, freq * 4.0);
    col.r = remap(pfbm, 0.0, 1.0, col.g, 1.0); // perlin-worley
  } else {
    float freq = 2.0;
    col.r = worleyFbm(p, freq);
    col.g = worleyFbm(p, freq * 2.0);
    col.b = worleyFbm(p, freq * 4.0);
    col.a = 1.0;
  }
  gl_FragColor = clamp(col, 0.0, 1.0);
}
`;

function make3D(n) {
  const rt = new THREE.WebGL3DRenderTarget(n, n, n, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  const t = rt.texture;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return rt;
}

/** Generate the cloud noise textures (idempotent). Needs a renderer; call outside of render(). */
export function ensureCloudTextures(renderer) {
  if (SKY.uCloudReady.value > 0.5) return;
  const t0 = performance.now();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uZ: { value: 0 }, uMode: { value: 0 } },
    vertexShader: GEN_VERT, fragmentShader: GEN_FRAG, depthTest: false, depthWrite: false,
  });
  const quad = new FullScreenQuad(mat);
  const prev = renderer.getRenderTarget();
  // r5: detail 32³ → 64³ (the trilinear 32³ worley read as blocky, cut-out cloud edges)
  const shape = make3D(128), detail = make3D(64);
  for (const [rt, n, mode] of [[shape, 128, 0], [detail, 64, 1]]) {
    mat.uniforms.uMode.value = mode;
    for (let z = 0; z < n; z++) {
      mat.uniforms.uZ.value = (z + 0.5) / n;
      renderer.setRenderTarget(rt, z);
      quad.render(renderer);
    }
  }
  renderer.setRenderTarget(prev);
  quad.dispose(); mat.dispose();
  SKY.tCloudShape.value = shape.texture;
  SKY.tCloudDetail.value = detail.texture;
  SKY.uCloudReady.value = 1;
  console.log(`[sky] cloud noise generated in ${Math.round(performance.now() - t0)} ms`);
}
