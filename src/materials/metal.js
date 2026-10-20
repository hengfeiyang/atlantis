// Metals for ATLANTIS: orichalcum (red-gold), gold, bronze, tin, silver (+ gilt, patinated bronze).
// OWNER: temple agent. Shared: others import, never edit (ask in your report).
// Adapted from athenaion/src/materials/metal.js.
//
// ---------------------------------------------------------------------------------------- API (stable)
//   import { metalMaterial, orichalcumMaterial, goldMaterial, bronzeMaterial, tinMaterial, silverMaterial,
//            giltMaterial, patinaBronzeMaterial, METAL_SRGB } from '../materials/metal.js';
//
//   metalMaterial({ kind, ...opts })  kind: 'orichalcum' | 'gold' | 'bronze' | 'tin' | 'silver' | 'gilt' | 'patina'
//   orichalcumMaterial(o)  red-gold (≈ #c8703e), slightly rough — citadel wall cladding, domes, trims
//   goldMaterial(o)        polished warm gold leaf — pinnacles, acroteria, tridents, statues, relief
//   giltMaterial(o)        matte / worn gilding (relief panels, frieze) — less mirror-like than gold
//   bronzeMaterial(o)      brown-gold bronze — capitals, doors, braziers, the ring-2 wall cladding
//   tinMaterial(o)         pale silver-grey, rough — land ring 1 wall cladding
//   silverMaterial(o)      cool polished silver — temple cella cladding panels
//   patinaBronzeMaterial(o) bronze with verdigris (o.patina 0..1)
//
// Options (all optional):
//   color / dark / patinaColor : THREE.Color | hex (LINEAR rgb for THREE.Color, sRGB for hex numbers/strings)
//   roughness (base), wear 0..1 (tarnish patches), patina 0..1 (verdigris amount, golden era ≈ 0)
//   panels: { w, h, seam, rivets }  world-space cladding panel grid on vertical faces (m); seams darker,
//           rivets as bright dots (cladding of walls, cella). Default: none.
//   hammered 0..1  hammered-sheet micro normal (default 0.3 for orichalcum/tin, else 0)
//   crust 0..1  (r2 arch-b) sunken encrustation: patchy coral / verdigris / chalky crust over the metal (rough,
//               dielectric), the metal glinting through the gaps; crustScale (m, default 0.35) patch size;
//               crustColor THREE.Color (default verdigris-green, mixed with coral pink / lime white). e.g.
//               goldMaterial({ crust: 0.55 }) — the fallen trident of shot 8, gold on sunken pinnacles
//   ao (AOVolume), vertexColors, side
// Geometry: optional `aux` vec4 (x cavity → tarnish + AO, y edge → rubbed bright edges); missing = zeros.
// Every material is tagged userData.sunken = 'metal' (gold / gilt: 'gold') for the core/sunken.js overlay.
// METAL_SRGB: reference colours (hex) for flat LODs.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { AUX_VERTEX_HEAD, AUX_VERTEX_PRE, AO_HEAD, NOISE_TEX_HEAD, aoUniforms } from './stone.js';
import { TONE, TONE_HEAD } from './tone.js';

export const METAL_SRGB = { orichalcum: '#c8703e', gold: '#d9a441', bronze: '#9a6a3a', tin: '#a9aaa6', silver: '#c9cdd2', verdigris: '#3f8c7a' };

const METAL_HEAD = /* glsl */ `
${NOISE_TEX_HEAD}
${AO_HEAD}
${TONE_HEAD}
uniform float uToneGold; // r7: 1 = gold / gilt / orichalcum (per-shot tone applies)
uniform vec3 uBase;     // bright metal colour (linear F0)
uniform vec3 uDark;     // tarnish colour
uniform vec4 uMet;      // x wear, y patina, z roughness, w hammered
uniform vec3 uPatina;   // verdigris colour
uniform vec4 uPanel;    // x panel w, y panel h, z seam width, w rivets (0/1); x = 0 → no panels
uniform vec4 uCrust;    // x amount (0 = none), y 1/patch size, z up-face bias, w seed
uniform vec3 uCrustCol; // main crust colour (linear)
/** encrustation mask 0..1 (sunken): fbm patches, more on up faces and in cavities, metal shows through gaps */
float cgCrust(vec3 p, vec3 n, float cav){
  if (uCrust.x <= 0.0) return 0.0;
  vec3 q = p * uCrust.y + uCrust.w;
  float f = cgN4(q).x * 0.55 + cgN4(q * 2.3 + 1.7).y * 0.3 + cgN4(q * 6.1 + 4.1).z * 0.15;
  float th = 1.0 - uCrust.x * (0.75 + 0.35 * max(n.y, 0.0) * uCrust.z) - 0.25 * cav;
  return smoothstep(th - 0.1, th + 0.14, f);
}
float cgPanelSeam = 0.0, cgRivet = 0.0, cgPanelId = 0.0;
void cgPanels(vec3 p, vec3 n){
  cgPanelSeam = 0.0; cgRivet = 0.0; cgPanelId = 0.0;
  if (uPanel.x <= 0.0 || abs(n.y) > 0.7) return;
  vec3 t = normalize(vec3(-n.z, 0.0, n.x) + vec3(1e-5, 0.0, 0.0));
  float h = dot(p, t);
  float row = floor(p.y / uPanel.y);
  float hh = h + fract(row * 0.5) * uPanel.x;
  vec2 g = vec2(hh / uPanel.x, p.y / uPanel.y);
  vec2 f = abs(fract(g) - 0.5) * vec2(uPanel.x, uPanel.y);
  vec2 dd = vec2(uPanel.x, uPanel.y) * 0.5 - f;
  float d = min(dd.x, dd.y);
  float aa = max(fwidth(h), fwidth(p.y)) + 1e-4;
  float w = uPanel.z;
  cgPanelSeam = (1.0 - smoothstep(w - 0.5 * aa, w + 0.5 * aa, d)) * min(1.0, 2.5 * w / aa) * (1.0 - smoothstep(0.1, 0.4, aa));
  cgPanelId = fract(sin(dot(floor(g), vec2(12.9898, 78.233))) * 43758.5453);
  if (uPanel.w > 0.5) {
    float sp = 0.25;
    float along = fract((dd.x < dd.y ? p.y : hh) / sp) - 0.5;
    float rd = length(vec2(along * sp, d - w * 3.0));
    cgRivet = (1.0 - smoothstep(0.012, 0.02, rd)) * (1.0 - smoothstep(0.05, 0.2, aa));
  }
}
`;

const METAL_COLOR = /* glsl */ `
  float cav = clamp(vCgAux.x, 0.0, 1.0), edge = clamp(vCgAux.y, 0.0, 1.0);
  vec3 p = cgP;
  cgPanels(p, cgN);
  vec4 NA = cgN4(p * 2.6 + cgSeed * 9.0) * 0.6 + cgN4(cgR1 * p * 5.7) * 0.4;
  float n1 = NA.x;
  float n2 = cgN4(p * 14.0).y;
  vec3 c = mix(uBase * 0.84, uBase, n1);
  c *= 0.95 + 0.07 * n2;
  c *= 0.94 + 0.12 * cgPanelId * step(0.0, uPanel.x - 1e-4);
  float tar = clamp(cav * 0.85 + smoothstep(0.55, 0.8, cgN4(p * 0.9 + 4.0).z) * uMet.x * 0.6, 0.0, 1.0);
  c = mix(c, uDark, tar);
  c = mix(c, uBase * 1.08, edge * 0.5);
  c = mix(c, uDark * 1.4, cgPanelSeam * 0.85);
  c = mix(c, uBase * 1.15, cgRivet);
  float pv = smoothstep(0.45, 0.7, cgN4(p * 1.7 + 2.0).w + cav * 0.5 + max(cgN.y, 0.0) * 0.2) * uMet.y;
  c = mix(c, uPatina, pv);
  float crs = cgCrust(p, cgN, cav);
  if (crs > 0.0) {
    vec4 cn = cgN4(p * uCrust.y * 3.7 + 7.3);
    vec3 cc = mix(uCrustCol, vec3(0.30, 0.25, 0.14), smoothstep(0.3, 0.7, cn.w));       // algae brown-olive
    cc = mix(cc, vec3(0.48, 0.24, 0.20), smoothstep(0.62, 0.8, cn.x) * 0.8);            // coral pink patches
    cc = mix(cc, vec3(0.50, 0.48, 0.42), smoothstep(0.68, 0.85, cn.y) * 0.6);           // chalky (tube-worm / barnacle) white
    cc *= 0.7 + 0.45 * cn.z;
    c = mix(c, cc, crs);
  }
  if (uToneGold > 0.5) c = cgToneGold(c);
  diffuseColor.rgb *= c;
`;

const METAL_ROUGH = /* glsl */ `
  {
    float cav = clamp(vCgAux.x, 0.0, 1.0);
    float n = cgN4(cgP * 5.0).x;
    float pv = smoothstep(0.45, 0.7, cgN4(cgP * 1.7 + 2.0).w + cav * 0.5 + max(cgN.y, 0.0) * 0.2) * uMet.y;
    roughnessFactor = clamp(uMet.z + 0.12 * (n - 0.5) + 0.3 * cav + 0.45 * pv + 0.25 * cgPanelSeam, 0.08, 1.0);
    roughnessFactor = mix(roughnessFactor, 0.92, cgCrust(cgP, cgN, cav));
    if (uToneGold > 0.5) roughnessFactor = clamp(roughnessFactor * uGoldRough, 0.05, 1.0);
  }
`;

const METAL_METAL = /* glsl */ `
  {
    float cav = clamp(vCgAux.x, 0.0, 1.0);
    float pv = smoothstep(0.45, 0.7, cgN4(cgP * 1.7 + 2.0).w + cav * 0.5 + max(cgN.y, 0.0) * 0.2) * uMet.y;
    metalnessFactor = clamp(1.0 - pv - cav * 0.35, 0.0, 1.0) * (1.0 - cgCrust(cgP, cgN, cav));
  }
`;

const METAL_NORMAL = /* glsl */ `
  {
    float dist = length(cameraPosition - cgP);
    float f = 1.0 - smoothstep(5.0, 60.0, dist);
    float fm = 1.0 - smoothstep(20.0, 200.0, dist);
    vec3 g = vec3(0.0);
    if (f > 0.0) {
      vec3 q = cgP * 9.0; float d0 = cgN4(q).x;
      g += vec3(cgN4(q + vec3(0.3,0,0)).x - d0, cgN4(q + vec3(0,0.3,0)).x - d0, cgN4(q + vec3(0,0,0.3)).x - d0) / 0.3 * 0.05 * f;
    }
    if (uMet.w > 0.0 && fm > 0.0) {
      vec3 q = cgP * 3.2 + 5.0; float d0 = cgN4(q).z;
      g += vec3(cgN4(q + vec3(0.3,0,0)).z - d0, cgN4(q + vec3(0,0.3,0)).z - d0, cgN4(q + vec3(0,0,0.3)).z - d0) / 0.3 * 0.09 * uMet.w * fm;
    }
    float crs = cgCrust(cgP, cgN, clamp(vCgAux.x, 0.0, 1.0));
    if (crs > 0.0 && fm > 0.0) {
      vec3 q = cgP * uCrust.y * 9.0; float d0 = cgN4(q).w;
      g += vec3(cgN4(q + vec3(0.2,0,0)).w - d0, cgN4(q + vec3(0,0.2,0)).w - d0, cgN4(q + vec3(0,0,0.2)).w - d0) / 0.2 * 0.18 * crs * fm;
    }
    cgBump = g - cgN * dot(g, cgN);
  }
`;

const METAL_AO = /* glsl */ `
  cgAO = cgAOVolume(cgP, cgN) * (1.0 - 0.6 * clamp(vCgAux.x, 0.0, 1.0)) * (1.0 - 0.5 * cgPanelSeam) * mix(1.0, 1.5, metalnessFactor);
`;

const lin = (c) => (c === undefined || c === null ? null : c.isColor ? c.clone() : new THREE.Color(c));

const DEFAULTS = {
  orichalcum: { color: new THREE.Color(0.80, 0.33, 0.13), dark: new THREE.Color(0.22, 0.08, 0.03), wear: 0.35, patina: 0.0, roughness: 0.34, hammered: 0.35, tag: 'metal' },
  gold: { color: new THREE.Color(0.86, 0.58, 0.20), dark: new THREE.Color(0.24, 0.14, 0.04), wear: 0.25, patina: 0.0, roughness: 0.26, hammered: 0, tag: 'gold' },
  gilt: { color: new THREE.Color(0.72, 0.50, 0.21), dark: new THREE.Color(0.24, 0.16, 0.07), wear: 0.55, patina: 0.0, roughness: 0.42, hammered: 0, tag: 'gold' },
  bronze: { color: new THREE.Color(0.62, 0.38, 0.17), dark: new THREE.Color(0.16, 0.09, 0.04), wear: 0.45, patina: 0.04, roughness: 0.38, hammered: 0.15, tag: 'metal' },
  tin: { color: new THREE.Color(0.56, 0.56, 0.55), dark: new THREE.Color(0.20, 0.20, 0.20), wear: 0.5, patina: 0.0, roughness: 0.5, hammered: 0.35, tag: 'metal' },
  silver: { color: new THREE.Color(0.86, 0.87, 0.89), dark: new THREE.Color(0.30, 0.30, 0.32), wear: 0.25, patina: 0.0, roughness: 0.22, hammered: 0.1, tag: 'metal' },
  patina: { color: new THREE.Color(0.50, 0.30, 0.15), dark: new THREE.Color(0.12, 0.08, 0.04), wear: 0.7, patina: 0.55, roughness: 0.5, hammered: 0, tag: 'metal', patinaColor: new THREE.Color(0.16, 0.36, 0.28) },
};

/** generic metal factory. kind: orichalcum | gold | gilt | bronze | tin | silver | patina */
export function metalMaterial(o = {}) {
  const kind = DEFAULTS[o.kind] ? o.kind : 'gold';
  const d = DEFAULTS[kind];
  const base = lin(o.color) || d.color.clone(), dark = lin(o.dark) || d.dark.clone();
  const pat = lin(o.patinaColor) || (d.patinaColor ? d.patinaColor.clone() : new THREE.Color(0.16, 0.36, 0.28));
  const pn = o.panels || null;
  const uniforms = {
    uBase: { value: new THREE.Vector3(base.r, base.g, base.b) },
    uDark: { value: new THREE.Vector3(dark.r, dark.g, dark.b) },
    uPatina: { value: new THREE.Vector3(pat.r, pat.g, pat.b) },
    uMet: { value: new THREE.Vector4(o.wear ?? d.wear, o.patina ?? d.patina, o.roughness ?? d.roughness, o.hammered ?? d.hammered) },
    uPanel: { value: new THREE.Vector4(pn ? pn.w ?? 1.2 : 0, pn ? pn.h ?? 0.9 : 1, pn ? pn.seam ?? 0.006 : 0, pn && pn.rivets ? 1 : 0) },
    uCrust: { value: new THREE.Vector4(Math.max(0, Math.min(1, o.crust ?? 0)), 1 / (o.crustScale ?? 0.35), o.crustUp ?? 1, o.crustSeed ?? 3.1) },
    uCrustCol: { value: (() => { const c = lin(o.crustColor) || new THREE.Color(0.14, 0.24, 0.17); return new THREE.Vector3(c.r, c.g, c.b); })() },
    uToneGold: { value: kind === 'gold' || kind === 'gilt' || kind === 'orichalcum' ? 1 : 0 },
    ...TONE,
    ...aoUniforms(o.ao),
  };
  const mat = proceduralMaterial({
    name: 'metal-' + kind, uniforms,
    params: { color: 0xffffff, metalness: 1, roughness: o.roughness ?? d.roughness, side: o.side ?? THREE.FrontSide, vertexColors: !!o.vertexColors },
    vertexHead: AUX_VERTEX_HEAD, vertexPre: AUX_VERTEX_PRE,
    head: METAL_HEAD, color: METAL_COLOR, roughness: METAL_ROUGH, metalness: METAL_METAL, normal: METAL_NORMAL, ao: METAL_AO,
  });
  mat.defaultAttributeValues = { ...(mat.defaultAttributeValues || {}), aux: [0, 0, 0, 0] };
  mat.userData.sunken = d.tag;
  mat.userData.metal = kind;
  return mat;
}

export const orichalcumMaterial = (o = {}) => metalMaterial({ ...o, kind: 'orichalcum' });
export const goldMaterial = (o = {}) => metalMaterial({ ...o, kind: 'gold' });
export const giltMaterial = (o = {}) => metalMaterial({ ...o, kind: 'gilt' });
export const bronzeMaterial = (o = {}) => metalMaterial({ ...o, kind: 'bronze' });
export const tinMaterial = (o = {}) => metalMaterial({ ...o, kind: 'tin' });
export const silverMaterial = (o = {}) => metalMaterial({ ...o, kind: 'silver' });
export const patinaBronzeMaterial = (o = {}) => metalMaterial({ ...o, kind: 'patina' });
