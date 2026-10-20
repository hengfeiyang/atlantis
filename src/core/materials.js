// Procedural material helper: MeshStandard/MeshPhysical materials with GLSL hooks that run in
// WORLD space (no textures needed). Hooks get these variables:
//   vec3 cgP  : world position          vec3 cgN : world-space geometric normal (normalised)
//   vec3 cgO  : object-space position   float cgSeed : per-instance random [0,1) (0 if not instanced)
//   vec3 cgV  : world-space view direction (from surface toward camera)
//   vec4 vColor (if vertexColors) etc. from three.
// Hooks:
//   color:     modify `diffuseColor` (vec4, linear)
//   roughness: modify `roughnessFactor`;   metalness: modify `metalnessFactor`
//   normal:    add a world-space perturbation: set `vec3 cgBump` (world-space normal delta)
//   emissive:  modify `totalEmissiveRadiance`
//   ao:        set `float cgAO` (multiplies indirect light) — e.g. from crevice noise
//   vertex:    code run in the vertex shader after the world position is known (can modify
//              `transformed` BEFORE projection via `vertexPre` instead)
// All injected code is hashed into the program cache key automatically.
import * as THREE from 'three';
import { NOISE_GLSL } from './glsl.js';
import { hashString } from './rng.js';

const VERT_HEAD = /* glsl */ `
varying vec3 vCgWorldPos;
varying vec3 vCgWorldNormal;
varying vec3 vCgObjPos;
varying float vCgSeed;
`;

const VERT_WORLD = /* glsl */ `
{
  vec4 cgWP = vec4( transformed, 1.0 );
  vec3 cgWN = objectNormal;
  float cgSeedV = 0.0;
  #ifdef USE_BATCHING
    cgWP = batchingMatrix * cgWP; cgWN = mat3( batchingMatrix ) * cgWN;
  #endif
  #ifdef USE_INSTANCING
    cgWP = instanceMatrix * cgWP; cgWN = mat3( instanceMatrix ) * cgWN;
    cgSeedV = fract( sin( dot( instanceMatrix[3].xyz, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
  #endif
  vCgWorldPos = ( modelMatrix * cgWP ).xyz;
  vCgWorldNormal = normalize( mat3( modelMatrix ) * cgWN );
  vCgObjPos = transformed;
  vCgSeed = cgSeedV;
}
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vCgWorldPos;
varying vec3 vCgWorldNormal;
varying vec3 vCgObjPos;
varying float vCgSeed;
${NOISE_GLSL}
`;

/**
 * @param {object} o
 * @param {'standard'|'physical'} [o.type]
 * @param {object} [o.params] material constructor params (color, roughness, metalness, ...)
 * @param {object} [o.uniforms] extra uniforms {name: {value}}
 * @param {string} [o.head] GLSL functions/uniform declarations for the fragment shader
 * @param {string} [o.vertexHead] GLSL declarations for the vertex shader
 * @param {string} [o.vertexPre] vertex code run right after begin_vertex (may modify `transformed`)
 * @param {string} [o.color] [o.roughness] [o.metalness] [o.normal] [o.emissive] [o.ao] fragment hooks
 * @param {string} [o.name]
 */
export function proceduralMaterial(o = {}) {
  const Ctor = o.type === 'physical' ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const mat = new Ctor(o.params || {});
  if (o.name) mat.name = o.name;
  const uniforms = o.uniforms || {};
  const parts = [o.head, o.vertexHead, o.vertexPre, o.color, o.roughness, o.metalness, o.normal, o.emissive, o.ao, o.type];
  const key = 'proc:' + hashString(parts.map((p) => p || '').join('\u0001')).toString(36);
  mat.userData.shaderKey = key;
  // distinct program per hook variant even before engine.patchMaterial() runs (it re-keys with flags)
  mat.customProgramCacheKey = () => key;
  mat.userData.cgUniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', `#include <common>\n${VERT_HEAD}\n${o.vertexHead || ''}`);
    if (o.vertexPre) vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n{\n${o.vertexPre}\n}`);
    vs = vs.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_WORLD}`);

    fs = fs.replace('#include <common>', `#include <common>\n${FRAG_HEAD}\n${o.head || ''}`);
    const pre = `vec3 cgP = vCgWorldPos; vec3 cgN = normalize(vCgWorldNormal); vec3 cgO = vCgObjPos; float cgSeed = vCgSeed; vec3 cgV = normalize(cameraPosition - vCgWorldPos); vec3 cgBump = vec3(0.0); float cgAO = 1.0;`;
    // declare the cg* locals once, at the top of main()
    fs = fs.replace('void main() {', `void main() {\n${pre}`);
    if (o.color) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n{\n${o.color}\n}`);
    if (o.roughness) fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n{\n${o.roughness}\n}`);
    if (o.metalness) fs = fs.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n{\n${o.metalness}\n}`);
    if (o.normal) {
      fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n{\n${o.normal}\n}\nnormal = normalize( normal + ( viewMatrix * vec4( cgBump, 0.0 ) ).xyz );`);
    }
    if (o.emissive) fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n{\n${o.emissive}\n}`);
    if (o.ao) {
      fs = fs.replace('#include <aomap_fragment>', `#include <aomap_fragment>\n{\n${o.ao}\n}\nreflectedLight.indirectDiffuse *= cgAO; reflectedLight.indirectSpecular *= mix(1.0, cgAO, 0.7);`);
    }
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  return mat;
}

/** Simple cache so identical materials are shared (fewer programs, fewer draw state changes). */
const cache = new Map();
export function cached(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

/** sRGB hex / css → linear THREE.Color */
export function col(hex) { return new THREE.Color(hex); }

/**
 * GLSL fix (three r186 + CSM addon): CSMShader.lights_fragment_begin is an older copy of three's
 * chunk and never sets `material.dfg` / `material.multiScatteringCompensation`, so every
 * MeshStandard/Physical material patched with CSM gets NO image-based specular (env reflections)
 * and an undefined factor on the sun specular. Insert this right before
 * `#include <lights_fragment_begin>` (harmless if three's own chunk computes it again).
 * Global fix: `ShaderChunk.lights_fragment_begin = CG_DFG_FIX_GLSL + ShaderChunk.lights_fragment_begin`
 * after the CSM has been constructed.
 */
export const CG_DFG_FIX_GLSL = /* glsl */`
#ifdef STANDARD
{
  vec3 cgVdir = ( isOrthographic ) ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
  float cgNVms = saturate( dot( normal, cgVdir ) );
  material.dfg = texture2D( dfgLUT, vec2( material.roughness, cgNVms ) ).rg;
  float cgEssMs = material.dfg.x + material.dfg.y;
  material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / max( cgEssMs, 1e-3 ) - 1.0 );
}
#endif
`;
/** apply CG_DFG_FIX_GLSL to a fragment shader source (use inside onBeforeCompile) */
export function applyDFGFix(fragmentShader) {
  if (fragmentShader.includes('cgNVms')) return fragmentShader;
  return fragmentShader.replace('#include <lights_fragment_begin>', `${CG_DFG_FIX_GLSL}\n#include <lights_fragment_begin>`);
}
