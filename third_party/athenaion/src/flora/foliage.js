// Foliage materials: thin translucent leaves (olive, ivy, grass, flowers) and bark.
//
// Leaves are double-sided MeshStandard materials with:
//  - separate upper / lower surface colours (gl_FrontFacing), per-leaf variation from vertex colours
//  - sun TRANSLUCENCY: the direct-light BRDF is wrapped so light arriving from behind a leaf is
//    transmitted (shadowed correctly, because CSM shadowing is already folded into directLight.color),
//    with a forward-scatter boost when looking toward the sun (the golden "sun through leaves" glow)
//  - wind sway driven by the deterministic engine time (attribute aSway = bend weight)
//  - optional alpha-tested atlas (ivy cards) with mip-coverage compensation + alpha-to-coverage
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { hashString } from '../core/rng.js';

export const FLORA_U = {
  uFloraTime: { value: 0 },
  uFloraWind: { value: 1 },
};

const SWAY_VERT_HEAD = /* glsl */ `
attribute float aSway;
uniform float uFloraTime;
uniform float uFloraWind;
varying vec2 vLeafUv;
`;
const SWAY_VERT = /* glsl */ `
vLeafUv = uv;
{
  vec3 sp = transformed;
  #ifdef USE_INSTANCING
    sp = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  float ph = dot(sp, vec3(0.37, 0.21, 0.29));
  float w = aSway * 0.1 * uFloraWind;
  vec3 off = w * vec3(sin(uFloraTime * 1.7 + ph * 3.0) + 0.45 * sin(uFloraTime * 3.3 + ph * 9.0),
                      0.35 * sin(uFloraTime * 2.3 + ph * 5.0),
                      cos(uFloraTime * 1.3 + ph * 2.0) + 0.4 * sin(uFloraTime * 4.1 + ph * 7.0));
  #ifdef USE_INSTANCING
    off = inverse(mat3(instanceMatrix)) * off;
  #endif
  transformed += off;
}
`;

// translucent thin-leaf direct lighting (wraps three's physical RE_Direct)
const TRANSLUCENT_GLSL = /* glsl */ `
void RE_Direct_CgLeaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float back = saturate( -dot( geometryNormal, directLight.direction ) );
  // forward scattering: strongest when the viewer looks toward the light through the leaf
  float fwd = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 6.0 );
  float wrap = saturate( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );
  reflectedLight.directDiffuse += directLight.color * cgLeafTrans * ( back * ( 0.55 + 2.2 * fwd ) + 0.06 * wrap ) * RECIPROCAL_PI;
}
#undef RE_Direct
#define RE_Direct RE_Direct_CgLeaf
`;

// thin leaves: weaker Fresnel (hairy undersides, waxy but not mirror-like tops) — per-face factor
const SPEC_GLSL = /* glsl */ `
material.specularF90 *= cgLeafSpec;
material.specularColor *= cgLeafSpec;
material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
`;

/**
 * Leaf material.
 * @param {object} o
 *  top, under: linear rgb albedo of upper / lower surface
 *  trans: linear rgb transmittance tint (yellow-green), multiplied by vertex colour
 *  roughTop, roughUnder
 *  map: optional atlas texture (sRGB, alpha) → alpha-tested cards
 *  midrib: strength of the procedural midrib line (geometry leaves, uv.x across, uv.y along)
 *  kind: 'olive' | 'ivy' | 'grass' | 'flower' (selects small procedural details)
 */
export function leafMaterial(o = {}) {
  const kind = o.kind || 'olive';
  const uniforms = {
    ...FLORA_U,
    uLeafTop: { value: new THREE.Vector3(...(o.top || [0.06, 0.08, 0.035])) },
    uLeafUnder: { value: new THREE.Vector3(...(o.under || [0.22, 0.25, 0.17])) },
    uLeafTrans: { value: new THREE.Vector3(...(o.trans || [0.30, 0.34, 0.06])) },
    uRoughTop: { value: o.roughTop ?? 0.5 },
    uRoughUnder: { value: o.roughUnder ?? 0.8 },
    uMidrib: { value: o.midrib ?? 1.0 },
    uAtlasSize: { value: o.map ? o.map.image.width : 1 },
    uLeafSpec: { value: new THREE.Vector2(o.specTop ?? 0.55, o.specUnder ?? 0.25) },
  };
  const head = /* glsl */ `
uniform vec3 uLeafTop; uniform vec3 uLeafUnder; uniform vec3 uLeafTrans;
uniform float uRoughTop; uniform float uRoughUnder; uniform float uMidrib; uniform float uAtlasSize; uniform vec2 uLeafSpec;
varying vec2 vLeafUv;
vec3 cgLeafTrans = vec3(0.0);
float cgLeafSpec = 1.0;
`;
  let color;
  if (o.map) {
    color = /* glsl */ `
      // map * vertex colour already applied by three (vertex colours are stored halved); atlas = upper surface
      diffuseColor.rgb *= 2.0;
      diffuseColor.a /= max(vColor.a, 0.004); // colour alpha carries AO, not opacity
      vec3 vc = vColor.rgb * 2.0;
      #ifdef USE_MAP
        vec2 dx = dFdx(vMapUv * uAtlasSize), dy = dFdy(vMapUv * uAtlasSize);
        float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
        diffuseColor.a = clamp(diffuseColor.a * (1.0 + lod * 0.28), 0.0, 1.0);
      #endif
      vec3 c = diffuseColor.rgb;
      if (!gl_FrontFacing) c = mix(c, uLeafUnder * vc, 0.65);
      diffuseColor.rgb = c;
      cgLeafTrans = uLeafTrans * mix(vec3(1.0), c / max(cgLuma(c), 0.02), 0.35) * (0.6 + 0.4 * vc);
    `;
  } else {
    color = /* glsl */ `
      vec3 vc = vColor.rgb * 2.0;   // vertex colours are stored halved (uint8)
      float across = abs(vLeafUv.x - 0.5) * 2.0;   // 0 at midrib, 1 at margin
      float along = vLeafUv.y;
      vec3 c = gl_FrontFacing ? uLeafTop : uLeafUnder;
      c *= vc;
      // midrib + faint lateral veins
      float mid = 1.0 - smoothstep(0.0, 0.10, across);
      float lat = smoothstep(0.85, 1.0, sin((along * 14.0 - across * 2.2) * 3.14159)) * (1.0 - mid) * 0.35;
      c = mix(c, c * 1.55 + 0.012, (mid * 0.55 + lat * 0.25) * uMidrib);
      // margins slightly darker / tips a touch yellower on old leaves
      c *= 0.88 + 0.12 * (1.0 - across * across);
      c = mix(c, c * vec3(1.15, 1.05, 0.7), smoothstep(0.75, 1.0, along) * 0.35);
      diffuseColor.rgb = c;
      cgLeafTrans = uLeafTrans * vc * (1.0 - 0.4 * mid);
    `;
  }
  const mat = proceduralMaterial({
    name: o.name || `leaf-${kind}`,
    params: {
      color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide, vertexColors: true,
      map: o.map || null, alphaTest: o.map ? (o.alphaTest ?? 0.5) : 0,
    },
    uniforms,
    head,
    vertexHead: SWAY_VERT_HEAD,
    vertexPre: SWAY_VERT,
    color,
    roughness: /* glsl */ `roughnessFactor = gl_FrontFacing ? uRoughTop : uRoughUnder; cgLeafSpec = gl_FrontFacing ? uLeafSpec.x : uLeafSpec.y;`,
    ao: o.ao || 'cgAO = vColor.a;',
  });
  if (o.map) mat.alphaToCoverage = true;
  // inject the translucent direct-light term after the physical lighting functions
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${TRANSLUCENT_GLSL}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${SPEC_GLSL}`);
  };
  mat.userData.shaderKey += ':leafT' + hashString(TRANSLUCENT_GLSL + SPEC_GLSL + (o.map ? 'map' : '')).toString(36);
  return mat;
}

/** depth material for shadow casting that applies the same sway (and alpha test for atlas cards) */
export function swayDepthMaterial(map = null, alphaTest = 0.5) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: map ? alphaTest : 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FLORA_U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWAY_VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_VERT}`);
  };
  m.customProgramCacheKey = () => 'cgSwayDepth' + (map ? 'map' : '');
  m.userData.shaderKey = 'cgSwayDepth' + (map ? 'map' : '');
  return m;
}

/** Olive / shrub bark: grey-brown, longitudinal fissures, lichen flecks. uv.x around, uv.y along (m). */
export function barkMaterial(o = {}) {
  return proceduralMaterial({
    name: o.name || 'oliveBark',
    params: { color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true },
    uniforms: { ...FLORA_U },
    vertexHead: SWAY_VERT_HEAD,
    vertexPre: SWAY_VERT,
    head: 'varying vec2 vLeafUv;',
    color: /* glsl */ `
      vec2 bu = vec2(vLeafUv.x * 6.2831, vLeafUv.y);
      // fissures run along the branch: stretched noise
      float f = cgVnoise2(vec2(vLeafUv.x * 9.0, vLeafUv.y * 1.6)) * 0.6 + cgVnoise2(vec2(vLeafUv.x * 23.0, vLeafUv.y * 4.0)) * 0.4;
      float crack = smoothstep(0.32, 0.18, f);
      float spots = smoothstep(0.72, 0.8, cgVnoise3(cgP * 18.0));
      vec3 c = vec3(0.052, 0.045, 0.036) * (0.7 + 0.6 * cgVnoise3(cgP * 3.0));
      c = mix(c, vec3(0.035, 0.03, 0.026), crack * 0.75);
      c = mix(c, vec3(0.24, 0.24, 0.2), spots * 0.45);
      diffuseColor.rgb = c * vColor.rgb * 2.0;
    `,
    normal: /* glsl */ `
      float e = 0.002;
      float h0 = cgVnoise2(vec2(vLeafUv.x * 9.0, vLeafUv.y * 1.6));
      cgBump = (vec3(cgVnoise3(cgP * 40.0), cgVnoise3(cgP * 40.0 + 7.1), cgVnoise3(cgP * 40.0 + 3.3)) - 0.5) * 0.25 * (0.4 + h0);
    `,
  });
}
