// Foliage + bark material family (owned by the vegetation agent; others may import).
//
//   foliageMaterials(species)  → { blob, card }  opaque clump material and alpha-tested card material
//   barkMaterial(species)      → procedural bark (fissures, plates, lichen, moss) driven by aAux coords
//   billboardMaterial(species) → far-LOD camera-facing impostor (procedural silhouette)
//   windDepthMaterial()        → custom depth material reproducing the wind sway for shadow maps
//   WIND                       → shared uniforms { uWindTime, uWindAmp }  (vegetation module animates)
//
// Geometry contract (see src/vegetation/util.js): attributes aFol (vec4) and aAux (vec2).
//   aFol.x interior AO (0 deep .. 1 outer), aFol.y tip factor, aFol.z per-clump random, aFol.w sway weight.
// Bent ("volumetric") normals: card/clump normals point away from the crown centre; the shader
// ignores the face direction so both sides of a card light like part of the crown volume.
import * as THREE from 'three';
import { proceduralMaterial, col } from '../core/materials.js';

export const WIND = {
  uWindTime: { value: 0 },
  uWindAmp: { value: 1 },
};

const VERT_HEAD = /* glsl */ `
attribute vec4 aFol;
attribute vec2 aAux;
varying vec4 vFol;
varying vec2 vAux;
uniform float uWindTime;
uniform float uWindAmp;
`;

// runs after <begin_vertex> (object space, before instancing)
const VERT_WIND = /* glsl */ `
vFol = aFol; vAux = aAux;
vec3 vgIP = vec3(0.0);
#ifdef USE_INSTANCING
  vgIP = instanceMatrix[3].xyz;
#endif
float vgPh = dot(vgIP, vec3(0.071, 0.013, 0.053));
float vgW = aFol.w * aFol.w * uWindAmp;
vec2 vgS = vec2(sin(uWindTime * 0.83 + vgPh) + 0.35 * sin(uWindTime * 2.3 + vgPh * 1.7),
                0.6 * cos(uWindTime * 0.61 + vgPh * 1.3));
transformed.xz += vgS * vgW * 0.08;
float vgF = sin(uWindTime * 5.7 + vgPh * 3.0 + dot(position, vec3(2.1, 1.7, 2.9)));
transformed += normal * (vgF * 0.015 * aFol.y * uWindAmp);
`;

const FRAG_HEAD = /* glsl */ `
varying vec4 vFol;
varying vec2 vAux;
uniform vec3 uTipTint;
uniform vec3 uDeepTint;
uniform vec3 uDryTint;
uniform float uTipAmt;
uniform float uDeep;
uniform float uTransl;
uniform float uVar;
uniform float uRelief;
uniform float uAmb;
uniform float uUpBias;
uniform float uGain;
// (uGain: per-species albedo factor; effective linear albedo ≈ atlas × color × gain: cypress ≈ 0.034 (r5b),
//  olive ≈ 0.053, broadleaf ≈ 0.048, pine ≈ 0.041, shrubs ≈ 0.041 green channel (crown AO darkens further))
// leaf-cluster micro relief (object space, so it sticks to each instance)
float vgRelief(vec3 o, float r){ return cgVnoise3(o * 3.2 + r * 7.0) * 0.62 + cgVnoise3(o * 8.5 + 3.0) * 0.38; }
`;

// foliage colour: interior darkening, sunlit young tips, per-instance + per-clump variation,
// slow world-space patches (drier / lusher stands)
const FOL_COLOR = /* glsl */ `
float vgAO = clamp(vFol.x, 0.0, 1.0);
float vgTip = clamp(vFol.y, 0.0, 1.0);
vec3 c = diffuseColor.rgb;
c *= mix(uDeep, 1.0, vgAO);
c = mix(c, c * uDeepTint, (1.0 - vgAO) * 0.6);
c = mix(c, c * uTipTint, vgTip * uTipAmt);
float vgR = vFol.z;
c *= 1.0 + uVar * (vgR - 0.5) * 0.5;
float vgWv = cgVnoise2(cgP.xz * 0.013 + vec2(cgSeed * 3.7, 0.0));
c = mix(c, c * uDryTint, smoothstep(0.45, 0.95, vgWv) * 0.6 * uVar);
c *= (0.88 + 0.24 * cgSeed) * uGain;
if (uRelief > 0.0) c *= mix(1.0, 0.55 + 0.75 * vgRelief(cgO + cgSeed * 13.7, vFol.z), uRelief);
diffuseColor.rgb = c;
`;

const FOL_NORMAL = /* glsl */ `
// bent normals, biased upward: foliage facing down still sees sky through the gaps of the crown
normal = normalize( normalize( vNormal ) + ( viewMatrix * vec4( 0.0, uUpBias, 0.0, 0.0 ) ).xyz );
if (uRelief > 0.0) {
  float h = vgRelief(cgO + cgSeed * 13.7, vFol.z);
  vec3 dpx = dFdx(cgP), dpy = dFdy(cgP);
  vec3 N = normalize(vCgWorldNormal);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  vec3 nb = normalize(abs(det) * N - grad * (0.22 * uRelief));
  cgBump = (nb - N) * step(1e-10, abs(det));
}
`;

const FOL_ROUGH = /* glsl */ `
roughnessFactor = clamp(roughnessFactor - 0.12 * vFol.y, 0.3, 1.0);
`;

const FOL_AO = /* glsl */ `
cgAO = mix(0.45, 1.0, clamp(vFol.x, 0.0, 1.0)) * uAmb;
// foliage: rough, sub-pixel leaves → much weaker sky reflection than a smooth surface
reflectedLight.indirectSpecular *= 0.3 * cgAO;
reflectedLight.directSpecular *= 0.6;
`;

// cheap sun transmission through thin outer foliage (back-lit glow)
const FOL_EMISSIVE = /* glsl */ `
{
  // warm bounce light from the sunlit ground onto the underside of crowns (the sky-only IBL has none)
  float vgDown = clamp(0.5 - 0.5 * normalize(vCgWorldNormal).y, 0.0, 1.0);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.2, 0.17, 0.11) * (0.35 + 0.65 * vgDown) * mix(0.5, 1.0, clamp(vFol.x, 0.0, 1.0));
}
#ifdef USE_FOG
{
  float vgBack = pow(max(dot(-cgV, uSunDir), 0.0), 4.0);
  float vgEdge = 1.0 - abs(dot(normalize(vCgWorldNormal), cgV));
  totalEmissiveRadiance += diffuseColor.rgb * uSunColor * (vgBack * (0.35 + 0.65 * vgEdge) * uTransl * (0.3 + 0.7 * vFol.y) * vFol.x);
}
#endif
`;

// r5b (colour): base albedo / ambient / interior darkening lowered (≈ ×0.7 gain, ×0.85 amb, ×0.8 deepK; ×0.62 made near shaded cypresses read black, shot 6): graded foliage
// was OkLab L 0.36-0.47 vs refs 0.21-0.33 and the grade had to pull greens down; sunlit tips of broadleaf / shrubs warmer
// and more saturated (vegetation request), less blue in the crown interiors
const SPECIES = {
  cypress: { relief: 0.6, amb: 1.0, gain: 3.0, up: 0.18, color: '#aaa996', rough: 0.8, tip: [1.45, 1.25, 0.6], deep: [1.0, 0.95, 0.78], dry: [1.1, 1.0, 0.8], tipAmt: 0.9, deepK: 0.42, transl: 0.5, vari: 1.25 },
  olive: { amb: 1.1, gain: 1.2, up: 0.3, color: '#86847a', rough: 0.62, tip: [1.12, 1.1, 0.98], deep: [0.85, 0.95, 1.0], dry: [1.08, 1.04, 0.9], tipAmt: 0.45, deepK: 0.38, transl: 0.55, vari: 0.7 },
  broad: { amb: 1.1, gain: 2.2, up: 0.3, color: '#8e9470', rough: 0.6, tip: [1.4, 1.3, 0.68], deep: [0.8, 0.95, 0.9], dry: [1.12, 1.02, 0.78], tipAmt: 0.75, deepK: 0.36, transl: 0.7, vari: 0.9 },
  pine: { amb: 1.1, gain: 1.3, up: 0.3, color: '#929a78', rough: 0.7, tip: [1.2, 1.15, 0.85], deep: [0.8, 0.95, 0.92], dry: [1.1, 1.0, 0.8], tipAmt: 0.55, deepK: 0.34, transl: 0.5, vari: 0.8 },
  shrub: { amb: 1.1, gain: 2.3, up: 0.3, color: '#8a9270', rough: 0.72, tip: [1.4, 1.3, 0.68], deep: [0.8, 0.95, 0.9], dry: [1.15, 1.02, 0.75], tipAmt: 0.75, deepK: 0.34, transl: 0.5, vari: 1.0 },
};

const _cache = new Map();

function folUniforms(sp) {
  return {
    uWindTime: WIND.uWindTime, uWindAmp: WIND.uWindAmp,
    uTipTint: { value: new THREE.Vector3(...sp.tip) },
    uDeepTint: { value: new THREE.Vector3(...sp.deep) },
    uDryTint: { value: new THREE.Vector3(...sp.dry) },
    uTipAmt: { value: sp.tipAmt }, uDeep: { value: sp.deepK },
    uTransl: { value: sp.transl }, uVar: { value: sp.vari }, uRelief: { value: 0 }, uAmb: { value: sp.amb ?? 1.0 }, uUpBias: { value: sp.up ?? 0.5 }, uGain: { value: sp.gain ?? 1.0 },
  };
}

/**
 * @param {string} species cypress | olive | broad | pine | shrub
 * @param {THREE.Texture} map atlas
 * @returns {{blob: THREE.Material, card: THREE.Material}}
 */
export function foliageMaterials(species, map) {
  const key = 'fol:' + species + ':' + map.uuid;
  if (_cache.has(key)) return _cache.get(key);
  const sp = SPECIES[species] || SPECIES.broad;
  const mk = (card) => {
    const m = proceduralMaterial({
      name: `foliage-${species}-${card ? 'card' : 'blob'}`,
      params: {
        color: col(sp.color), roughness: sp.rough, metalness: 0, map,
        side: card ? THREE.DoubleSide : THREE.FrontSide,
        alphaTest: card ? 0.5 : 0,
        vertexColors: false,
      },
      uniforms: (() => { const u = folUniforms(sp); u.uRelief.value = card ? 0.0 : (sp.relief ?? 1.0); return u; })(),
      vertexHead: VERT_HEAD,
      vertexPre: VERT_WIND,
      head: FRAG_HEAD,
      color: FOL_COLOR,
      normal: FOL_NORMAL,
      roughness: FOL_ROUGH,
      ao: FOL_AO,
      emissive: FOL_EMISSIVE,
    });
    if (card) { m.alphaToCoverage = true; m.shadowSide = THREE.DoubleSide; }
    return m;
  };
  const res = { blob: mk(false), card: mk(true) };
  _cache.set(key, res);
  return res;
}

// ---------------------------------------------------------------- far LOD impostors
// Camera-facing (cylindrical, around the tree's own axis) quads with a procedural silhouette:
// 2 triangles per far tree instead of 40-140. Geometry: billboardQuad() in src/vegetation/util.js
// (position = (±R, 0..H, 0), aAux = (±1, 0..1) normalised quad coords, uv over an opaque patch cell).
// The silhouette (uBBShape: 0 flame / 1 dome / 2 umbrella / 3 low mound) is cut with alphaTest and the
// normal is a rounded "crown" normal so the far trees keep a lit side, a shadow side and a dark base.
const BB_VERT = /* glsl */ `
#ifdef USE_INSTANCING
  mat4 vgM = modelMatrix * instanceMatrix;
#else
  mat4 vgM = modelMatrix;
#endif
vec3 vgCam = (inverse(vgM) * vec4(cameraPosition, 1.0)).xyz;      // camera in object space
vec2 vgD = vgCam.xz; float vgL = length(vgD); vgD = vgL > 1e-4 ? vgD / vgL : vec2(0.0, 1.0);
vec3 vgRight = vec3(vgD.y, 0.0, -vgD.x);
transformed = vec3(0.0, position.y, 0.0) + vgRight * position.x;
float vgU = aAux.x, vgV = aAux.y;
float vgCv = uBBShape > 1.5 ? 0.82 : uBBShape > 0.5 ? 0.6 : 0.5;          // crown centre height
vec3 vgN = normalize(vgRight * vgU * 0.85 + vec3(0.0, 0.25 + 1.1 * (vgV - vgCv), 0.0) + vec3(vgD.x, 0.0, vgD.y) * 0.55);
objectNormal = vgN;
transformedNormal = vgN;
#ifdef USE_INSTANCING
{
  mat3 vgIm = mat3(instanceMatrix);
  transformedNormal /= vec3(dot(vgIm[0], vgIm[0]), dot(vgIm[1], vgIm[1]), dot(vgIm[2], vgIm[2]));
  transformedNormal = vgIm * transformedNormal;
}
#endif
transformedNormal = normalMatrix * transformedNormal;
vNormal = normalize(transformedNormal);
vFol = vec4(uBBShape < 0.5 ? 0.28 + 0.42 * vgV : 0.4 + 0.55 * smoothstep(0.0, 0.9, vgV), 0.5 * vgV * vgV, 0.5, 0.0);
vAux = aAux;
`;

const BB_SHAPE = /* glsl */ `
{
  float u = vAux.x, v = vAux.y;
  float n = cgVnoise2(vec2(u * 2.6, v * (uBBShape < 0.5 ? 9.0 : 4.0)) + cgSeed * 37.0);
  float a;
  if (uBBShape < 0.5) {            // cypress flame
    float w = 0.98 * pow(sin(3.14159 * min(1.0, v * 0.82 + 0.08)), 0.5) * (1.0 - 0.42 * v);
    a = step(abs(u), w * (0.78 + 0.4 * n));
  } else if (uBBShape < 1.5) {     // rounded broadleaf / olive dome on a short trunk
    float d = length(vec2(u, (v - 0.6) / 0.42));
    a = max(step(d, 0.9 + 0.28 * (n - 0.5)), step(abs(u), 0.07) * step(v, 0.3));
    if (d > 0.9 + 0.28 * (n - 0.5)) diffuseColor.rgb *= 0.45;
  } else if (uBBShape < 2.5) {     // umbrella pine: flat crown on a tall bare trunk
    float d = length(vec2(u, (v - 0.84) / 0.17));
    a = max(step(d, 0.92 + 0.3 * (n - 0.5)), step(abs(u), 0.05) * step(v, 0.75));
    if (d > 0.92 + 0.3 * (n - 0.5)) diffuseColor.rgb *= 0.45;
  } else {                          // low mound (shrub / thicket)
    float d = length(vec2(u, v / 0.95));
    a = step(d, 0.88 + 0.3 * (n - 0.5));
  }
  diffuseColor.a = a;
}
`;

const BB_HEAD = /* glsl */ `
uniform float uBBShape;
`;

/** far-LOD impostor material for a species (shares the foliage colour pipeline) */
export function billboardMaterial(species, map) {
  const key = 'bb:' + species + ':' + map.uuid;
  if (_cache.has(key)) return _cache.get(key);
  const spKey = species === 'thicket' ? 'shrub' : species;
  const sp = SPECIES[spKey] || SPECIES.broad;
  const shape = species === 'cypress' ? 0 : species === 'pine' ? 2 : species === 'shrub' || species === 'thicket' ? 3 : 1;
  const u = folUniforms(sp);
  u.uBBShape = { value: shape };
  const m = proceduralMaterial({
    name: `foliage-${species}-bb`,
    params: { color: col(sp.color), roughness: sp.rough, metalness: 0, map, side: THREE.DoubleSide, alphaTest: 0.5, vertexColors: false },
    uniforms: u,
    vertexHead: VERT_HEAD + 'uniform float uBBShape;\n',
    vertexPre: BB_VERT,
    head: FRAG_HEAD + BB_HEAD,
    color: BB_SHAPE + FOL_COLOR,
    normal: FOL_NORMAL,
    roughness: FOL_ROUGH,
    ao: FOL_AO,
    emissive: FOL_EMISSIVE,
  });
  m.alphaToCoverage = true;
  _cache.set(key, m);
  return m;
}

const BARK = {
  // a: lit base, b: secondary, c: fissure colour, lichen
  olive: { a: '#706a5f', b: '#575046', c: '#221d18', lichen: '#a29d86', scale: [5.0, 1.4], plates: 0.25, gnarl: 1.0, rough: 0.92 },
  broad: { a: '#5b5248', b: '#463d34', c: '#1d1915', lichen: '#9c9a84', scale: [9.0, 3.0], plates: 0.6, gnarl: 0.4, rough: 0.9 },
  pine: { a: '#7a5a44', b: '#5a4232', c: '#211a15', lichen: '#8f8a76', scale: [3.0, 1.6], plates: 1.0, gnarl: 0.2, rough: 0.88 },
  cypress: { a: '#6a5a4b', b: '#4f4136', c: '#241d17', lichen: '#9a9580', scale: [12.0, 0.8], plates: 0.0, gnarl: 0.3, rough: 0.9 },
  shrub: { a: '#5a4f42', b: '#433a30', c: '#1e1a15', lichen: '#8a8670', scale: [10.0, 3.0], plates: 0.3, gnarl: 0.2, rough: 0.9 },
};

const BARK_HEAD = /* glsl */ `
varying vec4 vFol;
varying vec2 vAux;
uniform vec3 uBarkA;
uniform vec3 uBarkB;
uniform vec3 uBarkC;
uniform vec3 uLichen;
uniform vec2 uBarkScale;
uniform float uPlates;
float vgBarkH(vec2 b){
  // b.x around (m), b.y along (m)
  vec3 v = cgVoronoi2(vec2(b.x * uBarkScale.x, b.y * uBarkScale.y));
  float crack = smoothstep(0.02, 0.22, v.y - v.x);             // plate edges
  float fib = cgVnoise2(vec2(b.x * 38.0, b.y * 4.0));           // long fibres
  float stri = cgVnoise2(vec2(b.x * 14.0 + cgVnoise2(b * 3.0) * 2.0, b.y * 0.9));
  float h = mix(stri, crack, uPlates) * 0.75 + fib * 0.25;
  return h;
}
`;

const BARK_COLOR = /* glsl */ `
vec2 b = vAux;
float h = vgBarkH(b);
vec3 v = cgVoronoi2(vec2(b.x * uBarkScale.x, b.y * uBarkScale.y));
vec3 c = mix(uBarkB, uBarkA, smoothstep(0.25, 0.85, h + 0.25 * (v.z - 0.5)));
c = mix(uBarkC, c, smoothstep(0.12, 0.45, h));
// lichen + sun-bleaching blotches
float li = cgVnoise2(b * vec2(6.0, 4.0) + 11.0) * 0.65 + cgVnoise2(b * 23.0) * 0.35;
c = mix(c, uLichen, smoothstep(0.62, 0.78, li) * 0.55);
// moss/damp near the root and on the underside
float base = 1.0 - smoothstep(0.0, 0.18, vFol.w);
c = mix(c, c * vec3(0.55, 0.62, 0.42), base * 0.6 * smoothstep(0.3, 0.7, cgVnoise2(b * 5.0)));
c *= 0.9 + 0.2 * cgSeed;
c *= mix(0.55, 1.0, clamp(vFol.x, 0.0, 1.0));
diffuseColor.rgb = c;
`;

const BARK_NORMAL = /* glsl */ `
{
  float h = vgBarkH(vAux);
  vec3 dpx = dFdx(cgP), dpy = dFdy(cgP);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 N = cgN;
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  float k = 0.035;
  vec3 nb = normalize(abs(det) * N - grad * k);
  cgBump = (nb - N) * step(1e-9, abs(det));
}
`;

const BARK_AO = /* glsl */ `
cgAO = mix(0.4, 1.0, smoothstep(0.05, 0.5, vgBarkH(vAux))) * mix(0.5, 1.0, clamp(vFol.x, 0.0, 1.0));
`;

export function barkMaterial(species) {
  const key = 'bark:' + species;
  if (_cache.has(key)) return _cache.get(key);
  const b = BARK[species] || BARK.broad;
  const m = proceduralMaterial({
    name: `bark-${species}`,
    params: { color: 0xffffff, roughness: b.rough, metalness: 0 },
    uniforms: {
      uWindTime: WIND.uWindTime, uWindAmp: WIND.uWindAmp,
      uBarkA: { value: srgbVec(b.a) }, uBarkB: { value: srgbVec(b.b) }, uBarkC: { value: srgbVec(b.c) },
      uLichen: { value: srgbVec(b.lichen) },
      uBarkScale: { value: new THREE.Vector2(...b.scale) }, uPlates: { value: b.plates },
    },
    vertexHead: VERT_HEAD,
    vertexPre: VERT_WIND,
    head: BARK_HEAD,
    color: BARK_COLOR,
    normal: BARK_NORMAL,
    ao: BARK_AO,
  });
  _cache.set(key, m);
  return m;
}

function srgbVec(hex) { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); }

/** depth material that applies the same wind sway (three copies map/alphaTest/side per object) */
export function windDepthMaterial(card = false) {
  const key = 'depth:' + (card ? 'card' : 'opaque');
  if (_cache.has(key)) return _cache.get(key);
  const m = new THREE.MeshDepthMaterial();
  m.userData.shaderKey = 'vg-wind-depth-v1';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = WIND.uWindTime;
    shader.uniforms.uWindAmp = WIND.uWindAmp;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n{\n${VERT_WIND}\n}`);
  };
  m.customProgramCacheKey = () => 'vg-wind-depth-v1';
  if (card) m.alphaTest = 0.5;
  _cache.set(key, m);
  return m;
}
