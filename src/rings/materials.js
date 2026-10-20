// Materials for the ring walls, quays, sheds, tunnel, moles and lighthouses.
// Uses the shared families (src/materials/stone.js + metal.js, owned by the temple agent) once
// src/materials/READY exists; local placeholders otherwise. Own materials here: rock-cut faces,
// shed interiors (warm lamp-lit), dark voids, timber.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';

let CACHE = null;

async function sharedReady() {
  try { const r = await fetch(new URL('../materials/READY', import.meta.url)); return r.ok; } catch { return false; }
}

function placeholderStone(hex, rough = 0.6) {
  const m = proceduralMaterial({ params: { color: hex, roughness: rough, vertexColors: true }, color: `diffuseColor.rgb *= 0.9 + 0.2 * cgFbm3(cgP * 0.7, 3);` });
  m.userData.sunken = 'stone';
  return m;
}
function placeholderMetal(hex, rough = 0.35, tag = 'metal') {
  const m = new THREE.MeshStandardMaterial({ color: hex, metalness: 1, roughness: rough, vertexColors: true });
  m.userData.sunken = tag;
  return m;
}

// ------------------------------------------------------------------ rock-cut faces (ship-shed fronts, mole rip-rap)
const ROCK_HEAD = /* glsl */ `
attribute vec4 aux;
`;
const ROCK_FHEAD = /* glsl */ `
varying vec4 vRkAux;
uniform float uRkGreen;
`;
const ROCK_COLOR = /* glsl */ `
  float dist = length(cameraPosition - cgP);
  float fHi = 1.0 - smoothstep(20.0, 160.0, dist);
  vec3 p = cgP;
  float up = clamp(cgN.y, 0.0, 1.0);
  // strata: horizontal bands with warm/grey alternation, warped
  float w = cgFbm3(p * 0.08, 3) * 3.0;
  float strata = sin((p.y + w) * 2.1) * 0.5 + 0.5;
  float big = cgFbm3(p * 0.11 + 3.0, 4);
  vec3 grey = vec3(0.50, 0.47, 0.43), warm = vec3(0.62, 0.54, 0.43), pale = vec3(0.70, 0.66, 0.58);
  vec3 c = mix(grey, warm, smoothstep(0.3, 0.75, big));
  c = mix(c, pale, smoothstep(0.65, 0.9, strata) * 0.45);
  c *= 0.85 + 0.25 * cgFbm3(p * 0.9 + 7.0, 3);
  // dark cracks + lichen
  float cr = 1.0 - smoothstep(0.0, 0.06, abs(cgSnoise(p * vec3(0.35, 0.9, 0.35) + 5.0)));
  c = mix(c, c * 0.55, cr * 0.35);
  float lich = smoothstep(0.62, 0.8, cgFbm3(p * 1.7 + 11.0, 3)) * fHi;
  c = mix(c, c * vec3(0.7, 0.7, 0.64), lich * 0.4);
  // soil / moss / grass on ledges (up faces)
  float g = smoothstep(0.55, 0.85, up) * smoothstep(0.35, 0.6, cgFbm3(p * 0.45 + 2.0, 3) + 0.15) * uRkGreen;
  vec3 grass = mix(vec3(0.07, 0.10, 0.035), vec3(0.15, 0.17, 0.06), cgFbm3(p * 2.0, 2));
  c = mix(c, grass, g);
  // wet / algae line near the water
  float wet = 1.0 - smoothstep(0.0, 1.4, p.y);
  c = mix(c, c * vec3(0.42, 0.46, 0.38), wet * 0.8);
  c *= vRkAux.x > 0.0 ? 1.0 - 0.5 * clamp(vRkAux.x, 0.0, 1.0) : 1.0;
  diffuseColor.rgb *= c;
`;
const ROCK_NORMAL = /* glsl */ `
  float dN = length(cameraPosition - cgP);
  float fN = 1.0 - smoothstep(30.0, 300.0, dN);
  if (fN > 0.0) {
    vec3 q = cgP * 0.9; float e = 0.25;
    float c0 = cgFbm3(q, 3);
    vec3 g = vec3(cgFbm3(q + vec3(e,0,0), 3) - c0, cgFbm3(q + vec3(0,e,0), 3) - c0, cgFbm3(q + vec3(0,0,e), 3) - c0) / e;
    vec3 q2 = cgP * 4.0; float c2 = cgVnoise3(q2);
    vec3 g2 = vec3(cgVnoise3(q2 + vec3(e,0,0)) - c2, cgVnoise3(q2 + vec3(0,e,0)) - c2, cgVnoise3(q2 + vec3(0,0,e)) - c2) / e;
    vec3 b = (g * 0.55 + g2 * 0.08) * fN;
    cgBump = b - cgN * dot(b, cgN);
  }
`;
function rockMaterial(green = 1) {
  const m = proceduralMaterial({
    name: 'rings-rock', params: { color: 0xffffff, roughness: 0.92, vertexColors: true },
    uniforms: { uRkGreen: { value: green } },
    vertexHead: ROCK_HEAD + 'varying vec4 vRkAux;', vertexPre: 'vRkAux = aux;',
    head: ROCK_FHEAD, color: ROCK_COLOR, normal: ROCK_NORMAL,
    ao: `cgAO = 1.0 - 0.6 * clamp(vRkAux.x, 0.0, 1.0);`,
  });
  m.defaultAttributeValues = { ...(m.defaultAttributeValues || {}), aux: [0, 0, 0, 0] };
  m.userData.sunken = 'stone';
  return m;
}

// ------------------------------------------------------------------ shed interior: stone lit by warm lamps
// aux.z = lamp glow amount baked per vertex (distance to the shed lamps), aux.x cavity
function interiorMaterial() {
  const m = proceduralMaterial({
    name: 'rings-shed-interior', params: { color: 0xffffff, roughness: 0.85, vertexColors: true },
    uniforms: { uGlow: { value: new THREE.Color(1.0, 0.55, 0.22).multiplyScalar(2.4) } },
    vertexHead: 'attribute vec4 aux; varying vec4 vInAux;', vertexPre: 'vInAux = aux;',
    head: 'varying vec4 vInAux; uniform vec3 uGlow;',
    color: `diffuseColor.rgb *= vec3(0.50, 0.45, 0.38) * (0.8 + 0.35 * cgFbm3(cgP * 0.8, 3));`,
    emissive: `totalEmissiveRadiance += diffuseColor.rgb * uGlow * clamp(vInAux.z, 0.0, 2.0);`,
    ao: `cgAO = 1.0 - 0.7 * clamp(vInAux.x, 0.0, 1.0);`,
  });
  m.defaultAttributeValues = { ...(m.defaultAttributeValues || {}), aux: [0, 0, 0, 0] };
  m.userData.sunken = 'stone';
  return m;
}
function woodMaterial() {
  const m = proceduralMaterial({
    name: 'rings-wood', params: { color: 0xffffff, roughness: 0.8, vertexColors: true },
    color: `float g = sin(dot(cgP, vec3(0.3, 7.0, 0.3)) + cgFbm3(cgP * 1.5, 3) * 6.0) * 0.5 + 0.5;
            diffuseColor.rgb *= mix(vec3(0.16, 0.09, 0.05), vec3(0.28, 0.17, 0.09), g);`,
  });
  m.userData.sunken = 'wood';
  return m;
}
function voidMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 1, metalness: 0 });
  m.name = 'rings-void';
  m.userData.sunken = 'none';
  return m;
}
function lampMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.62, 0.28), emissiveIntensity: 6, roughness: 1 });
  m.name = 'rings-lamp';
  m.userData.sunken = 'none';
  return m;
}

/** → { white, red, black, lime, banded, paving, rock, ledge, interior, wood, void, lamp, tin, bronze, orichalcum, gold, gilt } */
export async function ringMaterials(engine) {
  if (CACHE) return CACHE;
  const M = {};
  let shared = false;
  if (await sharedReady()) {
    try {
      const S = await import('../materials/stone.js');
      const Mt = await import('../materials/metal.js');
      const vc = { vertexColors: true };
      M.white = S.whiteStone({ ...vc, weather: 0.2, streaks: 0.25 });
      M.red = S.redStone({ ...vc, weather: 0.2 });
      M.black = S.blackStone({ ...vc, weather: 0.15 });
      M.lime = S.limestone({ ...vc, weather: 0.35, streaks: 0.45 });
      M.banded = S.bandedStone({ ...vc, band: 1.6, redFrac: 0.5, bandOffset: 0.4, weather: 0.2 });
      M.paving = S.limestone({ ...vc, weather: 0.3, paving: 1.4 });
      const pan = { w: 2.3, h: 1.55, seam: 0.012, rivets: 1 };
      M.tin = Mt.tinMaterial({ ...vc, panels: pan });
      M.bronze = Mt.bronzeMaterial({ ...vc, panels: pan });
      M.orichalcum = Mt.orichalcumMaterial({ ...vc, panels: pan });
      M.gold = Mt.goldMaterial({ ...vc });
      M.gilt = Mt.giltMaterial({ ...vc });
      shared = true;
    } catch (e) { console.warn('[rings] shared materials failed, using placeholders:', e && (e.stack || e)); }
  }
  if (!shared) {
    M.white = placeholderStone(0xe6dccb); M.red = placeholderStone(0xa8483a); M.black = placeholderStone(0x2a2a2e, 0.4);
    M.lime = placeholderStone(0xcfc3ad, 0.8); M.banded = placeholderStone(0xd8b0a0); M.paving = placeholderStone(0xcfc3ad, 0.8);
    M.tin = placeholderMetal(0xa9aaa6, 0.5); M.bronze = placeholderMetal(0x9a6a3a, 0.4); M.orichalcum = placeholderMetal(0xc8703e, 0.34);
    M.gold = placeholderMetal(0xd9a441, 0.26, 'gold'); M.gilt = placeholderMetal(0xb8904a, 0.42, 'gold');
  }
  M.rock = rockMaterial(1);
  M.rockBare = rockMaterial(0);
  M.interior = interiorMaterial();
  M.wood = woodMaterial();
  M.void = voidMaterial();
  M.lamp = lampMaterial();
  console.log(`[rings] materials: ${shared ? 'shared stone/metal' : 'placeholders'}`);
  CACHE = M;
  return M;
}
