// Metals: gold leaf (acroteria, frieze plaques, dome ribs), bronze (doors, braziers, shields),
// patinated bronze (verdigris). OWNER: arch/temple agent. Others import, never edit.
//
//   import { goldMaterial, bronzeMaterial, patinaBronzeMaterial } from '../materials/metal.js';
//   goldMaterial({ ao, wear: 0.3 })   bronzeMaterial({ ao })   patinaBronzeMaterial({ patina: 0.6 })
//
// World-space procedural like marble.js; honours the optional `aux` vertex attribute
// (x = cavity → tarnish/grime + AO, y = edge → bright rubbed edges) and AO volumes.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { AUX_VERTEX_HEAD, AUX_VERTEX_PRE, AO_HEAD, NOISE_TEX_HEAD, aoUniforms } from './marble.js';

const METAL_HEAD = /* glsl */ `
${NOISE_TEX_HEAD}
${AO_HEAD}
uniform vec3 uBase;     // bright metal colour (linear F0)
uniform vec3 uDark;     // tarnish colour
uniform vec4 uMet;      // x wear, y patina, z roughness, w gilt-loss
uniform vec3 uPatina;   // verdigris colour
`;

const METAL_COLOR = /* glsl */ `
  float cav = clamp(vCgAux.x, 0.0, 1.0), edge = clamp(vCgAux.y, 0.0, 1.0);
  vec3 p = cgP;
  vec4 NA = cgN4(p * 2.6 + cgSeed * 9.0) * 0.6 + cgN4(cgR1 * p * 5.7) * 0.4;
  float n1 = NA.x;
  float n2 = cgN4(p * 14.0).y;
  vec3 c = mix(uBase * 0.82, uBase, n1);
  c *= 0.94 + 0.08 * n2;
  // tarnish / grime in crevices and patches
  float tar = clamp(cav * 0.85 + smoothstep(0.55, 0.8, cgN4(p * 0.9 + 4.0).z) * uMet.x * 0.6, 0.0, 1.0);
  c = mix(c, uDark, tar);
  // rubbed bright edges
  c = mix(c, uBase * 1.08, edge * 0.5);
  // verdigris
  float pv = smoothstep(0.45, 0.7, cgN4(p * 1.7 + 2.0).w + cav * 0.5 + max(cgN.y, 0.0) * 0.2) * uMet.y;
  c = mix(c, uPatina, pv);
  diffuseColor.rgb *= c;
`;

const METAL_ROUGH = /* glsl */ `
  {
    float cav = clamp(vCgAux.x, 0.0, 1.0);
    float n = cgN4(cgP * 5.0).x;
    float pv = smoothstep(0.45, 0.7, cgN4(cgP * 1.7 + 2.0).w + cav * 0.5 + max(cgN.y, 0.0) * 0.2) * uMet.y;
    roughnessFactor = clamp(uMet.z + 0.12 * (n - 0.5) + 0.3 * cav + 0.45 * pv, 0.12, 1.0);
  }
`;

const METAL_METAL = /* glsl */ `
  {
    float cav = clamp(vCgAux.x, 0.0, 1.0);
    float pv = smoothstep(0.45, 0.7, cgN4(cgP * 1.7 + 2.0).w + cav * 0.5 + max(cgN.y, 0.0) * 0.2) * uMet.y;
    metalnessFactor = clamp(1.0 - pv - cav * 0.35, 0.0, 1.0);
  }
`;

const METAL_NORMAL = /* glsl */ `
  {
    float dist = length(cameraPosition - cgP);
    float f = 1.0 - smoothstep(5.0, 60.0, dist);
    if (f > 0.0) {
      vec3 q = cgP * 9.0; float d0 = cgN4(q).x;
      vec3 g = vec3(cgN4(q + vec3(0.3,0,0)).x - d0, cgN4(q + vec3(0,0.3,0)).x - d0, cgN4(q + vec3(0,0,0.3)).x - d0) / 0.3;
      cgBump = (g - cgN * dot(g, cgN)) * 0.05 * f;
    }
  }
`;

const METAL_AO = /* glsl */ `
  // × env boost on metallic areas: the world IBL is scaled down for contrast (SKY.uEnvScale 0.21);
  // gold must still mirror the bright sky / sunlit marble around it
  cgAO = cgAOVolume(cgP, cgN) * (1.0 - 0.6 * clamp(vCgAux.x, 0.0, 1.0)) * mix(1.0, 1.6, metalnessFactor);
`;

function metal(name, o, d) {
  const base = new THREE.Color(o.color ?? d.color), dark = new THREE.Color(o.dark ?? d.dark), pat = new THREE.Color(o.patinaColor ?? d.patinaColor ?? 0x3f7f6a);
  const uniforms = {
    uBase: { value: new THREE.Vector3(base.r, base.g, base.b) },
    uDark: { value: new THREE.Vector3(dark.r, dark.g, dark.b) },
    uPatina: { value: new THREE.Vector3(pat.r, pat.g, pat.b) },
    uMet: { value: new THREE.Vector4(o.wear ?? d.wear, o.patina ?? d.patina, o.roughness ?? d.roughness, 0) },
    ...aoUniforms(o.ao),
  };
  const mat = proceduralMaterial({
    name, uniforms,
    params: { color: 0xffffff, metalness: 1, roughness: o.roughness ?? d.roughness, side: o.side ?? THREE.FrontSide, vertexColors: !!o.vertexColors },
    vertexHead: AUX_VERTEX_HEAD, vertexPre: AUX_VERTEX_PRE,
    head: METAL_HEAD, color: METAL_COLOR, roughness: METAL_ROUGH, metalness: METAL_METAL, normal: METAL_NORMAL, ao: METAL_AO,
  });
  return mat;
}

/** Gilded (gold leaf) — warm, slightly rough, darker in crevices. Colours are linear sRGB hex. */
export function goldMaterial(o = {}) {
  return metal('gold', o, { color: new THREE.Color(0.80, 0.52, 0.18), dark: new THREE.Color(0.22, 0.13, 0.04), wear: 0.45, patina: 0.0, roughness: 0.4 });
}
/** Polished / aged bronze (doors, braziers, shields, spear tips) */
export function bronzeMaterial(o = {}) {
  return metal('bronze', o, { color: new THREE.Color(0.62, 0.36, 0.17), dark: new THREE.Color(0.16, 0.09, 0.04), wear: 0.5, patina: 0.08, roughness: 0.42 });
}
/** Weathered bronze with verdigris patina */
export function patinaBronzeMaterial(o = {}) {
  return metal('bronzePatina', o, { color: new THREE.Color(0.50, 0.30, 0.15), dark: new THREE.Color(0.12, 0.08, 0.04), wear: 0.7, patina: o.patina ?? 0.55, roughness: 0.5, patinaColor: new THREE.Color(0.16, 0.36, 0.28) });
}
