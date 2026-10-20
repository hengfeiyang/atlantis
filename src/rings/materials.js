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
// r2 (arch-a): limestone palette of the terrain ring faces (src/terrain/material.js tLime: cream / bone /
// blue-grey / buff, joint-bounded blocks, dark damp crevices, rain streaks, moss tufts on ledges) so the
// rock-cut ship-shed fronts read as the same cliff as the terrain faces (ref 4: pale golden limestone crags).
// aux.x = per-vertex crevice depth from the displacement field (terrain/field.js CAV).
const ROCK_COLOR = /* glsl */ `
  float dist = length(cameraPosition - cgP);
  float fp = dist * 0.0022;                      // ~ metres per pixel (fades fine detail with distance)
  vec3 p = cgP;
  vec3 n = normalize(cgN);
  float vert = 1.0 - abs(n.y);
  float up = clamp(n.y, 0.0, 1.0);
  float m1 = cgFbm3(p * 0.028 + 1.7, 3);
  float m2 = cgFbm3(p * 0.095 + vec3(11.0, 3.0, 7.0), 3);
  // r4 (arch-a): ref-4 crag palette = pale grey-mauve limestone (ref ≈ rgb 130/110/98, 108/91/87, 173/147/147 lit),
  // much less yellow than r3; warm buff only in iron-stained streaks
  vec3 cream = vec3(0.370, 0.335, 0.305), bone = vec3(0.455, 0.418, 0.392), grey = vec3(0.285, 0.272, 0.270), buff = vec3(0.360, 0.295, 0.245);   // r3: = terrain citadel limestone (warm grey-tan, mid contrast)   // r3: warmer tan / ochre, darker (ref 4 crags ≈ rgb 130-160 / 95-120 / 70-90 lit)
  vec3 c = mix(cream, bone, smoothstep(0.1, 0.55, -m1 + 0.5 * m2) * 0.7);
  c = mix(c, grey, smoothstep(0.25, 0.75, m1 + 0.35 * m2) * 0.42);
  c = mix(c, buff, smoothstep(0.15, 0.65, m2 + 0.35 * m1) * 0.55 * (0.4 + 0.6 * vert));
  // joint-bounded blocks (≈ 3 × 4.5 m) with block-to-block tone, faint joints
  vec3 q = p + vec3(1.5, 0.8, 1.5) * cgSnoise(p * 0.07 + 3.0);
  vec2 vb = cgVoronoi3(q * vec3(0.33, 0.22, 0.33) + 0.37);
  float bt = cgHash13(floor(q * vec3(0.33, 0.22, 0.33) + 0.37) * 1.7);
  float fadeB = 1.0 - smoothstep(0.2, 0.7, fp);
  c *= mix(1.0, 0.86 + 0.26 * cgSnoise(floor(q * vec3(0.33, 0.22, 0.33)) * 0.71 + 2.0) * 0.5 + 0.13, fadeB);
  float jt = (1.0 - smoothstep(0.0, 0.06 + fp * 0.05, vb.y - vb.x)) * smoothstep(0.2, 0.6, cgSnoise(q * 0.12 + 2.2));
  // long vertical fractures
  float jn = cgSnoise(vec3(p.x * 0.11, p.y * 0.006, p.z * 0.11) + 9.0);
  float crk = max(jt * 0.5, (1.0 - smoothstep(0.0, 0.035 + fp * 0.03, abs(jn))) * smoothstep(0.0, 0.35, cgSnoise(p * vec3(0.05, 0.035, 0.05) + 4.0))) * fadeB * smoothstep(0.4, 0.9, vert);
  // bedding: faint horizontal bands
  float yb = p.y * 0.42 + 1.4 * cgSnoise(vec3(p.xz * 0.04, 3.3)) + 0.3 * cgSnoise(p * 0.25);
  c *= mix(1.0, 0.86 + 0.24 * smoothstep(-0.6, 0.6, cgSnoise(vec3(p.x * 0.01, yb * 0.3, p.z * 0.01))), 0.7 * vert);
  // grey-black rain streaks from the joints / ledges, ochre iron stains
  float sk = cgSnoise(vec3(p.x * 0.35, p.y * 0.016, p.z * 0.35)) * 0.6 + cgSnoise(vec3(p.x * 1.1, p.y * 0.045, p.z * 1.1)) * 0.4 * (1.0 - smoothstep(0.15, 0.45, fp));
  float streak = smoothstep(0.15, 0.55, sk) * smoothstep(0.35, 0.85, vert);
  c = mix(c, c * vec3(0.42, 0.43, 0.45), streak * 0.42);
  float och = smoothstep(0.45, 0.85, cgSnoise(vec3(p.x * 0.07, p.y * 0.02, p.z * 0.07) + 13.0) + 0.3 * m2);
  c = mix(c, c * vec3(1.16, 0.88, 0.62), och * 0.5 * vert);
  // crevices (vertex cavity, sharpened + broken edges) and fractures: dark and damp
  float cavN = vRkAux.x + 0.2 * cgSnoise(p * vec3(1.3, 0.6, 1.3) + 4.0) * (1.0 - smoothstep(0.3, 1.2, fp));
  float cv = clamp(max(0.9 * smoothstep(0.35, 0.75, cavN), crk), 0.0, 1.0);
  // r4: crisp grey crevice LINES (joints / fractures) instead of soft dark blotches on the lump flanks
  c = mix(c, c * vec3(0.50, 0.50, 0.50), smoothstep(0.45, 0.85, cavN) * 0.85);
  // weathering skin: pale dry patches + grey-blue lichen crust (ref 4: mottled grey-mauve)
  float sk2 = cgFbm3(p * vec3(0.55, 0.25, 0.55) + 31.0, 3);
  c = mix(c, c * vec3(1.22, 1.18, 1.14), smoothstep(0.1, 0.5, sk2) * 0.55);
  c = mix(c, c * vec3(0.78, 0.80, 0.84), smoothstep(0.15, 0.55, -sk2) * 0.5);
  c = mix(c, c * vec3(0.50, 0.50, 0.52), crk);
  // sunlit facets lighter (dry weathered skin), lumpy undersides cooler
  c *= 1.0 + 0.10 * smoothstep(0.2, 0.8, up + 0.4 * m2);
  // lichen: yellow + white patches
  float lm = smoothstep(0.0, 0.6, cgFbm3(p * 0.3 + 4.0, 3) + 0.3 * up);
  c = mix(c, vec3(0.56, 0.51, 0.31), smoothstep(0.55, 0.8, cgSnoise(p * 1.9 + 9.0)) * lm * 0.3);
  c = mix(c, vec3(0.66, 0.66, 0.63), smoothstep(0.62, 0.85, cgSnoise(p * 1.3 + 2.0)) * (1.0 - lm) * 0.25);
  // moss / grass tufts on ledges (up faces) and in crevices (golden only: uRkGreen)
  // r4: only on real ledges (up > 0.8) and in sparse tufts — r3 put dark moss on every up-tilted lump (leopard spots)
  float mossN = cgFbm3(p * 0.35 + 21.0, 3);
  float moss = smoothstep(0.78, 0.95, up) * smoothstep(0.35, 0.7, mossN + 0.25 * cv) * uRkGreen;
  vec3 grass = mix(vec3(0.15, 0.16, 0.07), vec3(0.27, 0.25, 0.11), smoothstep(-0.3, 0.6, mossN));   // dry sunlit grass, not dark blots
  c = mix(c, grass, moss * 0.45);
  // wet / algae line near the water
  float wet = 1.0 - smoothstep(0.0, 1.6, p.y);
  c = mix(c, c * vec3(0.55, 0.58, 0.50), wet * 0.7);   // r4: lighter (shot 1 riprap read black)
  diffuseColor.rgb *= max(c, vec3(0.0));
`;
const ROCK_NORMAL = /* glsl */ `
  // gentle relief only (the geometry carries the crags): flutes on steep faces + fine roughness
  float dN = length(cameraPosition - cgP);
  float fN = 1.0 - smoothstep(25.0, 220.0, dN);
  if (fN > 0.0) {
    vec3 q = cgP * vec3(0.9, 0.12, 0.9); float e = 0.2;
    float c0 = cgSnoise(q);
    vec3 g = vec3(cgSnoise(q + vec3(e,0,0)) - c0, cgSnoise(q + vec3(0,e,0)) - c0, cgSnoise(q + vec3(0,0,e)) - c0) / e;
    vec3 q2 = cgP * 3.0; float c2 = cgVnoise3(q2);
    vec3 g2 = vec3(cgVnoise3(q2 + vec3(e,0,0)) - c2, cgVnoise3(q2 + vec3(0,e,0)) - c2, cgVnoise3(q2 + vec3(0,0,e)) - c2) / e;
    // r3: mid-scale facets / fractures (breaks the smooth crag lumps when front-lit, shot 4)
    vec3 q3 = cgP * vec3(0.62, 0.34, 0.62) + 5.0; float c3 = cgSnoise(q3) + 0.5 * cgSnoise(q3 * 2.3);
    vec3 g3 = vec3(cgSnoise(q3 + vec3(e,0,0)) + 0.5 * cgSnoise((q3 + vec3(e,0,0)) * 2.3) - c3, cgSnoise(q3 + vec3(0,e,0)) + 0.5 * cgSnoise((q3 + vec3(0,e,0)) * 2.3) - c3, cgSnoise(q3 + vec3(0,0,e)) + 0.5 * cgSnoise((q3 + vec3(0,0,e)) * 2.3) - c3) / e;
    // r4: ridged fracture facets (1 - |noise|: sharp creases, flat-ish planes between) = angular limestone, ref 4
    vec3 q4 = cgP * vec3(0.42, 0.30, 0.42) + 17.0; float r0 = abs(cgSnoise(q4));
    vec3 g4 = vec3(abs(cgSnoise(q4 + vec3(e,0,0))) - r0, abs(cgSnoise(q4 + vec3(0,e,0))) - r0, abs(cgSnoise(q4 + vec3(0,0,e))) - r0) / e;
    vec3 b = (g * vec3(0.9, 0.12, 0.9) * 0.07 + g2 * 0.06 + g3 * vec3(0.62, 0.34, 0.62) * 0.035 - g4 * vec3(0.42, 0.30, 0.42) * 0.16 * (0.3 + 0.7 * uRkGreen)) * fN;   // r4: the r3 0.2 mid-scale bump made the leopard spots (shot 4)
    cgBump = b - cgN * dot(b, cgN);
  }
`;
function rockMaterial(green = 1) {
  const m = proceduralMaterial({
    name: 'rings-rock', params: { color: 0xffffff, roughness: 0.92, vertexColors: true },
    uniforms: { uRkGreen: { value: green } },
    vertexHead: ROCK_HEAD + 'varying vec4 vRkAux;', vertexPre: 'vRkAux = aux;',
    head: ROCK_FHEAD, color: ROCK_COLOR, normal: ROCK_NORMAL,
    ao: `cgAO = 1.0 - 0.3 * smoothstep(0.2, 0.9, vRkAux.x);`,
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
    color: `diffuseColor.rgb *= vec3(0.40, 0.335, 0.27) * (0.8 + 0.35 * cgFbm3(cgP * 0.8, 3));`,   // r6: darker (shot 4: the low sun lit the vaults flat beige)
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
  // r4: lapis inlay (pylon face strips, ref 4) — deep navy glazed stone
  M.lapis = proceduralMaterial({ name: 'rings-lapis', params: { color: 0xffffff, roughness: 0.32, vertexColors: true },
    color: `float n = cgFbm3(cgP * 2.1, 3); diffuseColor.rgb *= mix(vec3(0.020, 0.034, 0.120), vec3(0.034, 0.052, 0.17), smoothstep(-0.4, 0.6, n)) + vec3(0.25, 0.2, 0.08) * smoothstep(0.72, 0.9, cgSnoise(cgP * 9.0));` });
  M.lapis.userData.sunken = 'stone';
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
