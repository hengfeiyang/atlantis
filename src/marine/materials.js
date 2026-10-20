// Marine materials: corals (per-kind surface detail in object space), translucent thin tissue (kelp, sea
// grass, sea fans, soft coral) with current sway driven by the deterministic engine time, silver fish,
// manta and turtle skins. Every material is a proceduralMaterial (so atmosphere / CSM / the sunken medium
// are injected by the engine) and is tagged userData.sunken = 'none' (living tissue: no sand/algae overlay).
// Translucency: adapted from athenaion/src/flora/foliage.js (RE_Direct wrapper).
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { hashString } from '../core/rng.js';
import { SUNKEN } from '../world/layout.js';

// fish flash: x strength, y exponent, z depth fade (1/m), w base sheen
export const FISH_GLINT = { value: new THREE.Vector4(2.4, 3.0, 0.015, 0.6) };

// coral fluorescence / artistic lift: x strength (× albedo), y depth fade (1/m), z surface y
export const CORAL_GLOW = { value: new THREE.Vector3(0.3, 0.01, SUNKEN.surface) };

export const MARINE_U = {
  uMarineTime: { value: 0 },
  // dominant surge direction (unit-ish, world) * strength
  uCurrent: { value: new THREE.Vector3(0.8, 0.0, 0.45) },
};

// ------------------------------------------------------------------ vertex code
const VHEAD = /* glsl */ `
attribute vec4 aM;
varying vec4 vM;
uniform float uMarineTime;
uniform vec3 uCurrent;
`;
// sway: back-and-forth surge along uCurrent + small flutter; aM.y = displacement weight (m)
const SWAY = /* glsl */ `
vM = aM;
{
  vec3 sp = transformed;
  #ifdef USE_INSTANCING
    sp = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  sp = (modelMatrix * vec4(sp, 1.0)).xyz;
  float ph = dot(sp, vec3(0.11, 0.05, 0.13));
  float w = aM.y;
  float t = uMarineTime;
  vec3 off = w * (uCurrent * (sin(t * 0.9 + ph) + 0.35 * sin(t * 2.1 + ph * 2.7))
              + vec3(sin(t * 2.6 + ph * 7.0), 0.25 * sin(t * 1.7 + ph * 5.0), cos(t * 2.2 + ph * 6.0)) * 0.3);
  #ifdef USE_INSTANCING
    off = inverse(mat3(instanceMatrix)) * off;
  #endif
  transformed += off;
}
`;
// kelp: the whole stipe bends with a travelling surge wave (amplitude grows with height aM.w), blades flutter (aM.y)
const KELP = /* glsl */ `
vM = aM;
{
  float sc = 1.0;
  vec3 base = vec3(0.0);
  #ifdef USE_INSTANCING
    sc = length(instanceMatrix[1].xyz);
    base = instanceMatrix[3].xyz;
  #endif
  base = (modelMatrix * vec4(base, 1.0)).xyz;
  float h = aM.w * sc;
  float t = uMarineTime;
  float ph = dot(base.xz, vec2(0.031, 0.047));
  float hb = h * 0.055;
  vec3 cur = normalize(uCurrent + vec3(0.0001));
  vec3 crs = vec3(-cur.z, 0.0, cur.x);
  // large slow surge (dominant), secondary cross sway, travelling up the stipe
  float a1 = sin(t * 0.42 + ph - h * 0.035) * 0.8 + 0.45;          // biased downstream lean
  float a2 = sin(t * 0.67 + ph * 1.7 - h * 0.05) * 0.35;
  vec3 off = (cur * a1 + crs * a2) * hb * (0.4 + 0.6 * smoothstep(0.0, 18.0, h));
  off.y -= dot(off.xz, off.xz) / max(2.0 * h, 1.0) * 0.5;
  // blade flutter
  vec3 sp = transformed;
  #ifdef USE_INSTANCING
    sp = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  float fp = dot(sp, vec3(1.7, 0.9, 1.3));
  off += aM.y * vec3(sin(t * 2.4 + fp), 0.4 * sin(t * 3.1 + fp * 1.3), cos(t * 2.0 + fp * 0.7));
  #ifdef USE_INSTANCING
    off = inverse(mat3(instanceMatrix)) * off;
  #endif
  transformed += off;
}
`;

// translucent thin tissue direct light
const TRANSLUCENT_GLSL = /* glsl */ `
void RE_Direct_CgMarine( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float back = saturate( -dot( geometryNormal, directLight.direction ) );
  float fwd = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 5.0 );
  float wrap = saturate( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );
  reflectedLight.directDiffuse += directLight.color * cgTrans * ( back * ( 0.6 + 2.0 * fwd ) + 0.10 * wrap ) * RECIPROCAL_PI;
}
#undef RE_Direct
#define RE_Direct RE_Direct_CgMarine
`;
function addTranslucency(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${TRANSLUCENT_GLSL}`);
  };
  mat.userData.shaderKey += ':mT' + hashString(TRANSLUCENT_GLSL).toString(36);
  return mat;
}

const FHEAD = /* glsl */ `
varying vec4 vM;
uniform float uMarineTime;
vec3 cgTrans = vec3(0.0);
`;

function tag(m, t = 'none') { m.userData.sunken = t; return m; }

// ------------------------------------------------------------------ corals
// surface detail per kind (object space cgO, metres): grooves / polyps / pores, colour modulation, bump
const CORAL_KINDS = {
  // brain coral: meandering ridges & valleys
  brain: /* glsl */ `
    vec3 q = cgO * 7.0;
    float wv = cgSnoise(q * 0.5) * 1.6 + cgSnoise(q * 1.1 + 3.1) * 0.45;
    float m = sin(wv * 26.0 + cgSnoise(q * 2.5) * 1.2);
    float ridge = smoothstep(-0.2, 0.6, m);
    float valley = 1.0 - smoothstep(-0.9, -0.2, m);
    float teeth = 0.5 + 0.5 * sin(q.x * 30.0 + q.y * 23.0 + q.z * 27.0);
    col *= mix(0.62, 1.08, ridge) * (1.0 - 0.18 * valley * teeth);
    col = mix(col, col * vec3(1.15, 1.1, 0.8), ridge * 0.25);
    bumpH = ridge * 0.6 - valley * 0.4;
    bumpF = 60.0;
  `,
  // stony polyps: small cups (voronoi cells) — staghorn, plates, tubes
  polyp: /* glsl */ `
    vec2 vo = cgVoronoi3(cgO * 85.0);
    float cup = smoothstep(0.04, 0.3, vo.x);
    col *= 0.84 + 0.2 * cup;
    col *= 0.85 + 0.3 * cgVnoise3(cgO * 9.0);
    bumpH = cup * 0.6;
    bumpF = 40.0;
  `,
  // soft coral / fleshy: fuzzy polyps, slightly translucent
  soft: /* glsl */ `
    vec2 vo = cgVoronoi3(cgO * 70.0);
    float pol = 1.0 - smoothstep(0.0, 0.25, vo.x);
    col *= 0.78 + 0.35 * pol;
    col = mix(col, col * 1.35 + 0.02, pol * vM.z * 0.6);
    bumpH = pol * 0.6;
    bumpF = 50.0;
    cgTrans = col * 0.55;
  `,
  // sponge: porous, oscules
  sponge: /* glsl */ `
    vec2 vo = cgVoronoi3(cgO * 22.0);
    float pore = 1.0 - smoothstep(0.02, 0.14, vo.x);
    float fine = cgVnoise3(cgO * 60.0);
    col *= (0.82 + 0.25 * fine) * (1.0 - 0.55 * pore);
    bumpH = -pore + fine * 0.3;
    bumpF = 25.0;
  `,
  // urchins / anemone tentacles / generic: plain with noise
  plain: /* glsl */ `
    col *= 0.85 + 0.3 * cgVnoise3(cgO * 14.0);
    bumpH = 0.0; bumpF = 0.0;
  `,
};

const _coralCache = new Map();
/**
 * Coral / sponge material. kind: brain | polyp | soft | sponge | plain. Vertex colours carry the base albedo,
 * instance colour tints it, aM.x = AO, aM.y = sway, aM.z = tip factor (lighter growing tips).
 */
export function coralMaterial(kind = 'polyp', { rough = 0.82, translucent = false, sway = true } = {}) {
  const key = `${kind}:${rough}:${translucent}:${sway}`;
  if (_coralCache.has(key)) return _coralCache.get(key);
  const detail = CORAL_KINDS[kind] || CORAL_KINDS.plain;
  let m = proceduralMaterial({
    name: 'coral-' + kind,
    params: { color: 0xffffff, roughness: rough, metalness: 0, vertexColors: true, side: THREE.FrontSide },
    uniforms: { ...MARINE_U, uCoralGlow: CORAL_GLOW },
    vertexHead: VHEAD,
    vertexPre: sway ? SWAY : 'vM = aM;',
    head: FHEAD + 'float bumpH = 0.0; float bumpF = 0.0; uniform vec3 uCoralGlow;\n',
    emissive: 'totalEmissiveRadiance += diffuseColor.rgb * uCoralGlow.x * exp(-max(0.0, uCoralGlow.z - cgP.y) * uCoralGlow.y);',
    color: /* glsl */ `
      vec3 col = diffuseColor.rgb;
      ${detail}
      col = mix(col, col * vec3(1.25, 1.2, 1.1) + 0.015, vM.z * 0.45);
      diffuseColor.rgb = col;
    `,
    normal: /* glsl */ `
      if (bumpF > 0.0) {
        // cheap bump: screen-space derivative of the detail height
        vec3 dpx = dFdx(cgP), dpy = dFdy(cgP);
        float hx = dFdx(bumpH), hy = dFdy(bumpH);
        vec3 r1 = cross(dpy, cgN), r2 = cross(cgN, dpx);
        float det = dot(dpx, r1);
        vec3 grad = (hx * r1 + hy * r2) / (abs(det) + 1e-7) * sign(det);
        cgBump = -grad * 0.006 * clamp(1.0, 0.0, 1.0);
      }
    `,
    ao: 'cgAO = vM.x;',
  });
  if (translucent) m = addTranslucency(m);
  tag(m);
  _coralCache.set(key, m);
  return m;
}

// ------------------------------------------------------------------ thin translucent tissue (kelp, sea grass)
const _tissueCache = new Map();
/**
 * kind: 'kelp' (stipe bend + flutter) | 'grass' (sway). Colours from vertex colours; uv.x across (0..1), uv.y along.
 */
export function tissueMaterial(kind = 'kelp', o = {}) {
  const key = kind + JSON.stringify({ ...o, map: o.map ? o.map.uuid : null });
  if (_tissueCache.has(key)) return _tissueCache.get(key);
  const map = o.map || null;
  let m = proceduralMaterial({
    name: 'tissue-' + kind,
    params: { color: 0xffffff, roughness: o.rough ?? 0.55, metalness: 0, vertexColors: true, side: THREE.DoubleSide, map, alphaTest: map ? 0.42 : 0 },
    uniforms: { ...MARINE_U, uAtlasSize: { value: map ? map.image.width : 1 } },
    vertexHead: VHEAD,
    vertexPre: kind === 'kelp' ? KELP : SWAY,
    head: FHEAD + 'uniform float uAtlasSize;\n',
    color: map ? /* glsl */ `
      #ifdef USE_MAP
        vec2 dx = dFdx(vMapUv * uAtlasSize), dy = dFdy(vMapUv * uAtlasSize);
        float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
        diffuseColor.a = clamp(diffuseColor.a * (1.0 + lod * 0.3), 0.0, 1.0);
      #endif
      vec3 col = diffuseColor.rgb;
      col *= 0.85 + 0.3 * cgVnoise3(cgP * 1.3 + cgSeed * 7.0);
      if (!gl_FrontFacing) col *= 0.88;
      diffuseColor.rgb = col;
      cgTrans = col * vec3(1.3, 1.25, 0.75) * ${(o.trans ?? 1.0).toFixed(2)};
    ` : /* glsl */ `
      vec3 col = diffuseColor.rgb;
      float across = abs(vUv.x - 0.5) * 2.0;
      float mott = cgVnoise2(vec2(vUv.y * 9.0 + cgSeed * 13.0, vUv.x * 2.0)) * 0.5 + cgVnoise3(cgP * 4.0) * 0.5;
      col *= 0.78 + 0.4 * mott;
      col *= 1.0 - 0.25 * smoothstep(0.7, 1.0, across);
      col = mix(col, col * 1.3, (1.0 - smoothstep(0.0, 0.08, across)) * ${(o.midrib ?? 0.4).toFixed(2)});
      if (!gl_FrontFacing) col *= 0.85;
      diffuseColor.rgb = col;
      cgTrans = col * vec3(1.25, 1.2, 0.7) * ${(o.trans ?? 1.0).toFixed(2)};
    `,
    ao: 'cgAO = vM.x;',
  });
  m.defines = { ...(m.defines || {}), USE_UV: '' };
  if (map) m.alphaToCoverage = true;
  m = addTranslucency(m);
  tag(m);
  _tissueCache.set(key, m);
  return m;
}

/** depth material for shadow casters that sway (same vertex displacement); optional alpha map */
export function swayDepthMaterial(kind = 'sway', map = null) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: map ? 0.45 : 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, MARINE_U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VHEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${kind === 'kelp' ? KELP : SWAY}`);
  };
  const k = 'marineDepth:' + kind + (map ? ':map' + map.uuid : '');
  m.customProgramCacheKey = () => k;
  m.userData.shaderKey = k;
  m.userData.noPatch = true;
  m.userData.__cgPatched = true;
  return m;
}

// ------------------------------------------------------------------ sea fans (alpha-tested atlas cards)
export function fanMaterial(atlas) {
  let m = proceduralMaterial({
    name: 'seafan',
    params: { color: 0xffffff, roughness: 0.75, metalness: 0, vertexColors: true, side: THREE.DoubleSide, map: atlas, alphaTest: 0.45 },
    uniforms: { ...MARINE_U, uAtlasSize: { value: atlas.image.width }, uCoralGlow: CORAL_GLOW },
    vertexHead: VHEAD,
    vertexPre: SWAY,
    head: FHEAD + 'uniform float uAtlasSize; uniform vec3 uCoralGlow;\n',
    emissive: 'totalEmissiveRadiance += diffuseColor.rgb * uCoralGlow.x * exp(-max(0.0, uCoralGlow.z - cgP.y) * uCoralGlow.y);',
    color: /* glsl */ `
      #ifdef USE_MAP
        vec2 dx = dFdx(vMapUv * uAtlasSize), dy = dFdy(vMapUv * uAtlasSize);
        float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
        diffuseColor.a = clamp(diffuseColor.a * (1.0 + lod * 0.35), 0.0, 1.0);
      #endif
      vec3 col = diffuseColor.rgb;
      col *= 0.85 + 0.3 * cgVnoise3(cgP * 6.0);
      diffuseColor.rgb = col;
      cgTrans = col * 0.7;
    `,
    ao: 'cgAO = vM.x;',
  });
  m.alphaToCoverage = true;
  m = addTranslucency(m);
  tag(m);
  return m;
}

// ------------------------------------------------------------------ fish (instanced, CPU-placed, tail wiggle in the vertex shader)
// local frame: +Z = head, body length 1 (scaled per instance), +Y up. aFish = (phase, beat frequency Hz, colour kind)
export function fishMaterial({ kind = 'silver' } = {}) {
  const pattern = kind === 'silver'
    ? /* glsl */ `
      // countershading: dark blue-grey back, mirror-silver flanks, white belly; faint lateral stripe
      float yb = cgO.y / max(0.0001, 0.11);
      vec3 back = vec3(0.09, 0.14, 0.18), flank = vec3(0.82, 0.86, 0.9), belly = vec3(0.92, 0.92, 0.9);
      vec3 col = mix(flank, back, smoothstep(0.15, 0.75, yb));
      col = mix(col, belly, smoothstep(-0.2, -0.75, yb));
      col = mix(col, vec3(0.3, 0.42, 0.5), (1.0 - smoothstep(0.0, 0.05, abs(yb - 0.25))) * 0.35);
      col *= 0.9 + 0.2 * vFish.y;
      diffuseColor.rgb = col;
      fishMetal = smoothstep(0.85, 0.2, yb) * smoothstep(-0.95, -0.4, yb);
      fishSheen = smoothstep(0.85, 0.3, yb);
    `
    : /* glsl */ `
      // reef fish: vertex colours carry the pattern (stripes / bands), instance colour tints
      vec3 col = diffuseColor.rgb;
      diffuseColor.rgb = col;
      fishMetal = 0.08; fishSheen = 0.1;
    `;
  const m = proceduralMaterial({
    name: 'fish-' + kind,
    params: { color: 0xffffff, roughness: kind === 'silver' ? 0.3 : 0.45, metalness: 0, vertexColors: kind !== 'silver' },
    uniforms: { ...MARINE_U, uFishGlint: FISH_GLINT, uSurfaceY: { value: SUNKEN.surface } },
    vertexHead: /* glsl */ `
      attribute vec3 aFish;
      uniform float uMarineTime;
      varying vec2 vFish;
    `,
    vertexPre: /* glsl */ `
      // travelling body wave, amplitude grows toward the tail (z < 0)
      float tailW = smoothstep(0.25, -0.5, transformed.z);
      float ph = uMarineTime * aFish.y * 6.2831853 + aFish.x * 6.2831853 - transformed.z * 5.0;
      transformed.x += sin(ph) * 0.085 * tailW * (0.4 + 0.6 * tailW);
      vFish = vec2(aFish.x, fract(aFish.x * 7.31));
    `,
    head: 'varying vec2 vFish; float fishMetal = 0.0; float fishSheen = 0.0; uniform vec4 uFishGlint; uniform float uSurfaceY;\n',
    color: pattern,
    // silver flanks mirror the bright down-welling light from the surface when they tilt toward it (school flashes)
    emissive: /* glsl */ `
      vec3 rr = reflect(-cgV, cgN);
      float up = max(0.0, rr.y);
      float depthK = exp(-max(0.0, uSurfaceY - cgP.y) * uFishGlint.z);
      totalEmissiveRadiance += vec3(0.62, 0.8, 0.88) * (pow(up, uFishGlint.y) * uFishGlint.x * fishMetal + uFishGlint.w * fishSheen) * depthK;
    `,
    metalness: 'metalnessFactor = fishMetal * 0.35;',
    roughness: 'roughnessFactor = mix(roughnessFactor, 0.28, fishMetal);',
  });
  return tag(m);
}

// ------------------------------------------------------------------ manta & turtle skins (animated in the vertex shader)
export function mantaMaterial() {
  const m = proceduralMaterial({
    name: 'manta',
    params: { color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide },
    uniforms: { ...MARINE_U, uFlap: { value: 0 } },
    vertexHead: 'uniform float uMarineTime; uniform float uFlap; varying vec3 vMO;',
    vertexPre: /* glsl */ `
      vMO = transformed;
      float sx = abs(transformed.x);
      float ph = uFlap - sx * 0.55 + transformed.z * 0.35;
      float amp = pow(clamp(sx / 2.4, 0.0, 1.2), 1.5) * 0.85;
      transformed.y += sin(ph) * amp;
      transformed.z -= (1.0 - cos(ph)) * amp * 0.08;
      // tail undulates
      if (transformed.z < -1.0) transformed.x += sin(uFlap * 0.7 + transformed.z * 1.8) * 0.06 * (-transformed.z - 1.0);
    `,
    head: 'varying vec3 vMO;',
    color: /* glsl */ `
      // dorsal: charcoal-black with pale shoulder chevrons; ventral: white with grey margins & spots
      vec3 c;
      bool top = dot(cgN, vec3(0.0, 1.0, 0.0)) > -0.05;
      float sx = abs(vMO.x);
      if (gl_FrontFacing == top || true) {}
      float upF = smoothstep(-0.25, 0.25, cgN.y);
      vec3 dors = vec3(0.022, 0.026, 0.03);
      float chev = smoothstep(0.35, 0.0, abs(vMO.z - 0.05 + sx * 0.32 - 0.35)) * smoothstep(1.6, 0.6, sx) * smoothstep(0.15, 0.5, sx);
      dors = mix(dors, vec3(0.32, 0.33, 0.33), chev * 0.8);
      vec3 vent = vec3(0.78, 0.78, 0.76);
      vent = mix(vent, vec3(0.12, 0.13, 0.14), smoothstep(1.7, 2.3, sx) + smoothstep(-0.6, -1.0, vMO.z) * 0.6);
      vent *= 1.0 - 0.6 * smoothstep(0.7, 0.75, cgVnoise2(vMO.xz * 5.0)) * smoothstep(0.6, 0.3, abs(vMO.z));
      c = mix(vent, dors, upF);
      c *= 0.9 + 0.2 * cgVnoise2(vMO.xz * 9.0);
      diffuseColor.rgb = c;
    `,
  });
  return tag(m);
}

export function turtleMaterial() {
  const m = proceduralMaterial({
    name: 'turtle',
    params: { color: 0xffffff, roughness: 0.55, metalness: 0, vertexColors: true, side: THREE.DoubleSide },
    uniforms: { ...MARINE_U, uStroke: { value: 0 } },
    vertexHead: 'attribute vec4 aLimb; uniform float uStroke; varying vec3 vTO; varying float vPart;',
    vertexPre: /* glsl */ `
      vTO = transformed; vPart = aLimb.w;
      // aLimb.xyz = joint pivot, w = part (0 body / shell, 1 front-left, 2 front-right, 3 rear-left, 4 rear-right, 5 head)
      if (aLimb.w > 0.5 && aLimb.w < 4.5) {
        float side = (aLimb.w < 1.5 || (aLimb.w > 2.5 && aLimb.w < 3.5)) ? -1.0 : 1.0;
        bool front = aLimb.w < 2.5;
        float s = uStroke;
        float a = front ? (sin(s) * 0.62 - 0.22) : (sin(s + 1.2) * 0.22 - 0.1);
        float feather = front ? cos(s) * 0.45 : 0.0;
        vec3 p = transformed - aLimb.xyz;
        // flap: rotate about the body axis (z) — wings move down/up
        float ca = cos(a * side), sa = sin(a * side);
        p.xy = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
        // feather: rotate about the limb's long axis (≈ x)
        float cf = cos(feather), sf = sin(feather);
        p.yz = vec2(cf * p.y - sf * p.z, sf * p.y + cf * p.z);
        transformed = aLimb.xyz + p;
      }
      if (aLimb.w > 4.5) { transformed.x += sin(uStroke * 0.5) * 0.02 * (transformed.z - aLimb.z); }
    `,
    head: 'varying vec3 vTO; varying float vPart;',
    color: /* glsl */ `
      vec3 c = diffuseColor.rgb;
      if (vPart < 0.5 && vTO.y > 0.0) {
        // carapace scutes: voronoi plates with pale seams and radiating streaks
        vec3 vo = cgVoronoi2(vTO.xz * vec2(4.2, 3.4));
        float seam = 1.0 - smoothstep(0.02, 0.08, vo.y - vo.x);
        float streak = cgVnoise2(vTO.xz * 30.0 + vo.z * 10.0);
        c *= 0.75 + 0.45 * streak * (0.4 + 0.6 * vo.x);
        c = mix(c, vec3(0.42, 0.36, 0.22), seam * 0.8);
      } else {
        // skin: dark scales outlined pale
        vec3 vo = cgVoronoi2(vec2(vTO.x * 9.0 + vTO.y * 5.0, vTO.z * 9.0));
        float edge = 1.0 - smoothstep(0.02, 0.12, vo.y - vo.x);
        c = mix(c, vec3(0.5, 0.46, 0.34), edge * 0.7);
      }
      diffuseColor.rgb = c;
    `,
  });
  return tag(m);
}
