// Acropolis materials. Prefers the shared families (src/materials/marble.js, metal.js) so the acropolis
// matches the temple; local fallbacks below are an aux-driven weathered marble/limestone model:
// per-vertex `aux` (x cavity, y edge wear, z streak source) + vertex-colour tint (multipliers ≈ 1),
// world-space veins, patina, grey-black lichen speckles/patches, drip streaks, grime, chips, moss.
import * as THREE from 'three';
import { proceduralMaterial, cached } from '../core/materials.js';

// ---------------------------------------------------------------- GLSL
const AUX_VS_HEAD = /* glsl */ `
attribute vec4 aux;
varying vec4 vAcroAux;
`;
const AUX_VS_PRE = /* glsl */ `vAcroAux = aux;`;

export const STONE_GLSL = /* glsl */ `
varying vec4 vAcroAux;
uniform vec4 uAcP;  // x lichen, y streaks, z veins, w moss
uniform vec4 uAcQ;  // x warmth, y chips, z darkness, w seed
uniform vec4 uAcR;  // x crack network amount, y crack scale, z moss in cracks, w unused
float acroAlong(vec3 P, vec3 N){ vec2 t = normalize(vec2(-N.z, N.x) + 1e-4); return dot(P.xz, t); }
vec3 acroGrad(vec3 p){
  float e = 0.37;
  float c = cgVnoise3(p);
  return vec3(cgVnoise3(p + vec3(e,0,0)) - c, cgVnoise3(p + vec3(0,e,0)) - c, cgVnoise3(p + vec3(0,0,e)) - c) / e;
}
// weathered marble / limestone albedo (multiplies diffuseColor)
vec3 acroStone(vec3 P, vec3 n, vec4 aux){
  float cav = clamp(aux.x, 0.0, 1.0), edge = clamp(aux.y, 0.0, 1.0), strk = clamp(aux.z, 0.0, 1.0);
  float lichen = uAcP.x, streaks = uAcP.y, veins = uAcP.z, mossAmt = uAcP.w;
  vec3 p = P + vec3(uAcQ.w * 37.0);
  float dist = length(cameraPosition - P);
  float fHi = 1.0 - smoothstep(20.0, 140.0, dist);
  float fMid = 1.0 - smoothstep(100.0, 800.0, dist);
  float up = clamp(n.y, 0.0, 1.0);
  float big = cgVfbm3(p * 0.09, 3);
  float mid = cgVfbm3(p * 0.55 + 4.2, 3);
  // (r2) neutral cream, matched to src/materials/marble.js (refs 5/6: lit marble ≈ #deccb8, columns #bea793)
  vec3 cream = vec3(0.655, 0.625, 0.565);
  vec3 ivory = vec3(0.645, 0.630, 0.600);
  vec3 grey = vec3(0.565, 0.555, 0.540);
  vec3 col = mix(cream, ivory, smoothstep(0.35, 0.65, big));
  col = mix(col, grey, smoothstep(0.58, 0.85, big) * 0.65);
  col *= 0.91 + 0.16 * mid;
  col = mix(col, col * vec3(1.03, 0.985, 0.935), uAcQ.x);
  // veins
  float w = cgFbm3(p * vec3(0.28, 0.5, 0.28), 4);
  float vein = 1.0 - smoothstep(0.0, 0.05 + 0.05 * mid, abs(sin((p.x * 0.7 + p.y * 1.1 - p.z * 0.5) * 1.6 + w * 7.0)));
  float vein2 = 1.0 - smoothstep(0.0, 0.03, abs(cgSnoise(p * 0.8 + 2.0)));
  col *= 1.0 - (vein * 0.16 + vein2 * 0.10) * veins * fMid;
  // honey / ochre patina
  float pat = smoothstep(0.42, 0.78, cgVfbm3(p * 0.3 + 9.0, 4) + 0.15 * strk);
  col = mix(col, col * vec3(1.0, 0.92, 0.80), pat * 0.22);
  // grey-black lichen speckles + patches
  float sp = max(cgVnoise3(p * 23.0), cgVnoise3(p * 61.0 + 7.1) * 0.96);
  float cluster = cgVfbm3(p * 1.4 + 3.0, 3);
  float speck = smoothstep(0.84 - 0.22 * cluster * lichen, 0.95, sp) * fHi;
  float lpat = smoothstep(0.58, 0.72, cgVfbm3(p * 0.85 + 11.0, 4) + 0.1 * up) * lichen;
  float speckFar = smoothstep(0.5, 0.85, cluster) * lichen * (1.0 - fHi) * 0.3;
  col = mix(col, vec3(0.15, 0.15, 0.14), clamp(speck * (0.55 + 0.4 * lichen), 0.0, 1.0));
  col = mix(col, vec3(0.30, 0.295, 0.27), lpat * 0.6);
  col = mix(col, vec3(0.36, 0.35, 0.32), speckFar);
  float orange = smoothstep(0.8, 0.9, cgVnoise3(p * 3.1 + 21.0)) * smoothstep(0.4, 0.8, cluster) * (0.35 + 0.65 * up);
  col = mix(col, vec3(0.58, 0.42, 0.18), orange * 0.4 * lichen * fMid);
  // drip streaks on vertical faces
  float vert = 1.0 - up;
  float s1 = cgVnoise3(vec3(p.x * 3.2, p.y * 0.10, p.z * 3.2));
  float s2 = cgVnoise3(vec3(p.x * 9.0, p.y * 0.22, p.z * 9.0) + 5.0);
  float sMask = smoothstep(0.35, 0.7, cgVfbm3(p * vec3(0.25, 0.05, 0.25) + 2.0, 2));
  float streak = smoothstep(0.55, 0.9, s1 * 0.65 + s2 * 0.35) * (0.35 + 0.65 * sMask + strk * 0.8);
  col = mix(col, col * vec3(0.50, 0.48, 0.45), clamp(streak * streaks * vert, 0.0, 0.9) * fMid);
  col = mix(col, col * 1.07, smoothstep(0.72, 0.95, s2) * vert * 0.25 * streaks);
  // crazed marble: irregular dark veins / hairline cracks with moss in the wider ones (ref 6)
  if (uAcR.x > 0.0) {
    float fw = length(fwidth(P));
    vec3 wp = p * uAcR.y;
    vec3 warp = vec3(cgFbm3(p * 0.55, 3), cgFbm3(p * 0.6 + 3.3, 3), cgFbm3(p * 0.5 + 7.7, 3)) * 1.35;
    vec2 v1 = cgVoronoi3(wp + warp);
    float edgeD = v1.y - v1.x;
    float lw = 0.018 + 0.03 * smoothstep(0.3, 0.9, cgVnoise3(p * 1.1));
    float aa = fw * uAcR.y * 1.6 + 0.008;
    float line = 1.0 - smoothstep(lw, lw + aa, edgeD);
    // only some borders become veins: long broken runs selected by low-frequency noise
    float cov = uAcR.w; // (r2) crack coverage
    float sel = smoothstep(0.46 - 0.22 * cov, 0.66 - 0.22 * cov, cgVfbm3(p * 0.38 + vec3(5.0, 1.0, 2.0), 3)) * smoothstep(0.2 - 0.2 * cov, 0.6 - 0.25 * cov, cgVnoise3(wp * 0.35 + 9.0));
    // fine hairlines following a warped direction (marble veins)
    float hv = abs(sin(dot(p, vec3(0.9, 1.7, 0.6)) * 2.2 + cgFbm3(p * 0.9, 4) * 6.0));
    float hair = (1.0 - smoothstep(0.0, 0.03 + fw * 2.0, hv)) * smoothstep(0.62, 0.86, cgVnoise3(p * 0.6 + 2.0));
    float near = 1.0 - smoothstep(0.015, 0.08, fw);
    float crack = (line * sel * 1.0 + hair * 0.3) * uAcR.x * near;
    vec3 cc = mix(vec3(0.33, 0.32, 0.29), vec3(0.20, 0.22, 0.13), uAcR.z * smoothstep(0.45, 0.85, cgVnoise3(p * 2.0)) * line * sel);
    col = mix(col, col * cc / 0.5, clamp(crack, 0.0, 0.7));
  }
  // grime in cavities / joints
  col = mix(col, col * vec3(0.45, 0.42, 0.38), cav * 0.75);
  // worn edges: lighter with darker chips
  float chip = smoothstep(0.7, 0.86, cgVnoise3(p * 17.0 + 1.3)) * edge * uAcQ.y; // (r4) small sparse chips (was 9/m blobs)
  col = mix(col, col * 1.08, edge * 0.5);
  col = mix(col, col * vec3(0.60, 0.58, 0.54), chip * 0.8);
  // moss on up-facing surfaces and in crevices
  float mossN = cgVfbm3(p * 0.9 + 17.0, 4);
  float moss = smoothstep(0.50, 0.70, mossN + 0.35 * up + 0.4 * cav - 0.25 * vert) * mossAmt;
  vec3 mossCol = mix(vec3(0.075, 0.095, 0.03), vec3(0.17, 0.18, 0.07), cgVnoise3(p * 4.0));
  col = mix(col, mossCol, clamp(moss, 0.0, 0.9));
  return col * (1.0 - uAcQ.z);
}
`;

const STONE_COLOR = /* glsl */ `diffuseColor.rgb *= acroStone(cgP, cgN, vAcroAux);`;
const STONE_NORMAL = /* glsl */ `
  float distN = length(cameraPosition - cgP);
  float fHiN = 1.0 - smoothstep(6.0, 70.0, distN);
  float fMidN = 1.0 - smoothstep(30.0, 260.0, distN);
  if (fMidN > 0.0) {
    vec3 pp = cgP * 15.0;
    float c0 = cgVnoise3(pp);
    vec3 g = vec3(cgVnoise3(pp + vec3(0.35,0,0)) - c0, cgVnoise3(pp + vec3(0,0.35,0)) - c0, cgVnoise3(pp + vec3(0,0,0.35)) - c0) / 0.35;
    float pit = smoothstep(0.30, 0.12, c0);
    vec3 g2 = acroGrad(cgP * 2.2);
    vec3 bump = g * (0.05 + 0.10 * pit) * fHiN + g2 * 0.04 * fMidN;
    cgBump = bump - cgN * dot(bump, cgN);
  }
`;
const STONE_ROUGH = /* glsl */ `
  roughnessFactor = clamp(roughnessFactor + 0.10 * (cgVnoise3(cgP * 2.3) - 0.5) + 0.18 * clamp(vAcroAux.x, 0.0, 1.0) + 0.05 * clamp(vAcroAux.y, 0.0, 1.0), 0.15, 0.98);
`;
const STONE_AO = /* glsl */ `cgAO = 1.0 - 0.55 * clamp(vAcroAux.x, 0.0, 1.0);`;

function stoneUniforms({ lichen = 0.7, streaks = 0.8, veins = 0.7, moss = 0, warmth = 0.35, chips = 0.7, dark = 0, seed = 0, cracks = 0, crackScale = 2.4, crackMoss = 0.5, crackCover = 0 }) {
  return {
    uAcP: { value: new THREE.Vector4(lichen, streaks, veins, moss) }, uAcQ: { value: new THREE.Vector4(warmth, chips, dark, seed) },
    uAcR: { value: new THREE.Vector4(cracks, crackScale, crackMoss, crackCover) },
  };
}
function stoneMat(name, o = {}) {
  return proceduralMaterial({
    name,
    params: { color: 0xffffff, roughness: o.rough ?? 0.62, metalness: 0, vertexColors: true },
    uniforms: stoneUniforms(o),
    vertexHead: AUX_VS_HEAD, vertexPre: AUX_VS_PRE,
    head: STONE_GLSL, color: STONE_COLOR, normal: STONE_NORMAL, roughness: STONE_ROUGH, ao: STONE_AO,
  });
}

export function ashlarMaterial() {
  return cached('acro:ashlar', () => stoneMat('acro-ashlar', { lichen: 0.85, streaks: 0.95, veins: 0.5, moss: 0.06, warmth: 0.45, chips: 0.8, seed: 0.37, rough: 0.78 }));
}
export function marbleMaterial() {
  return cached('acro:marble', () => stoneMat('acro-marble', { lichen: 0.7, streaks: 0.9, veins: 0.95, moss: 0.1, warmth: 0.1, chips: 0.8, seed: 0.71, rough: 0.55, cracks: 0.9, crackScale: 1.5, crackMoss: 0.55, crackCover: 0.45 }));
}
// (r4) dedicated worn-marble tread shader (ref 6): white marble with grey granular mottling, thin veins,
// a broken crack network with olive moss in the wider cracks, grime + moss where each riser meets the
// tread below (aux.x), a polished walking line and chipped, light-catching nosings (aux.y).
const TREAD_GLSL = /* glsl */ `
uniform vec4 uTrA; // x stair axis x, y walking-line half width, z moss, w cracks
vec3 acroTread(vec3 P, vec3 n, vec4 aux){
  float cav = clamp(aux.x, 0.0, 1.0);
  // (r4) aux.y is set per slab (riser included): only the sloped nosing facets count as worn edge
  float edge = clamp(aux.y, 0.0, 1.0) * smoothstep(0.12, 0.35, n.y) * (1.0 - smoothstep(0.9, 0.985, n.y));
  float dist = length(cameraPosition - P);
  float fw = length(fwidth(P));
  float fHi = 1.0 - smoothstep(8.0, 55.0, dist);
  float fMid = 1.0 - smoothstep(35.0, 320.0, dist);
  float up = clamp(n.y, 0.0, 1.0);
  vec2 uv = up > 0.5 ? P.xz : vec2(abs(n.z) > abs(n.x) ? P.x : P.z, P.y * 1.15);
  vec3 p = P + vec3(13.7, 0.0, 5.1);
  float walk = 1.0 - smoothstep(uTrA.y * 0.35, uTrA.y, abs(P.x - uTrA.x));
  // base: white marble with a slow warm / cool drift
  float big = cgVfbm3(p * 0.11, 3);
  vec3 col = mix(vec3(0.72, 0.69, 0.635), vec3(0.665, 0.652, 0.62), smoothstep(0.3, 0.7, big)); // r5b (colour): warmer cream (ref 6 treads), was 0.715/0.70/0.67 → 0.655/0.652/0.645
  // ragged grey weathering patches (5-octave fbm: torn edges, not blobs), weaker in the walking line
  float warp = cgFbm3(p * 0.35, 3);
  float mot = cgFbm3(p * vec3(0.8, 1.2, 0.8) + warp * 1.2, 5);
  float mottle = smoothstep(-0.04, 0.34, mot) * fMid * (1.0 - 0.35 * walk * up); // (r5) more weathered (ref 6)
  col = mix(col, col * vec3(0.58, 0.565, 0.55), mottle * 0.86); // (r6) 0.78 → 0.86: weathered like ref 6
  // (r5) black crust / lichen blotches (ref 6): ragged dark patches, more on risers, fewer in the walking line
  float crs = cgFbm3(p * vec3(1.6, 2.4, 1.6) + warp * 0.8 + 21.0, 4);
  float crust = smoothstep(0.1, 0.4, crs + 0.14 * (1.0 - up) - 0.18 * walk * up) * fMid; // (r6) more crust coverage
  col = mix(col, col * vec3(0.36, 0.35, 0.33), crust * 0.72);
  // granular texture (salt and pepper) everywhere, dark grains denser inside the patches
  float gr = cgSnoise(p * 48.0) * 0.55 + cgSnoise(p * 115.0 + 2.3) * 0.45;
  col *= 1.0 + 0.06 * gr * fHi;
  float grain = smoothstep(0.38 - 0.18 * mottle, 0.62 - 0.12 * mottle, gr) * fHi;
  col = mix(col, vec3(0.24, 0.235, 0.22), grain * (0.34 + 0.34 * mottle));
  // thin grey veins
  float vv = abs(cgFbm3(p * vec3(0.45, 0.75, 0.45) + 3.0, 5));
  float vein = (1.0 - smoothstep(0.0, 0.012 + fw * 1.4, vv)) * fMid;
  col *= 1.0 - vein * 0.17 * smoothstep(0.35, 0.7, cgVnoise3(p * 0.21 + 7.0)); // (r5) patchy, fainter: no contour-map look
  // cracks: jagged iso-lines of a ragged field, broken into runs; the wider runs hold dirt and moss
  float crack = 0.0, wide = 0.0;
  if (uTrA.w > 0.0 && fw < 0.08) {
    vec3 pc = vec3(uv * 0.55, 0.37 * up);
    float cf = cgFbm3(pc + vec3(cgSnoise(pc * 12.0), cgSnoise(pc * 12.0 + 4.0), 0.0) * 0.02, 6);
    float sel = smoothstep(0.3, 0.6, cgSnoise(vec3(uv * 0.45, 3.0)) + 0.2 * (1.0 - up)); // (r5) sparser: fewer contour-map runs
    float w0 = 0.0025 + 0.0075 * smoothstep(0.3, 0.85, cgSnoise(vec3(uv * 1.7, 9.0)) * 0.5 + 0.5);
    float dline = abs(cf) * fw / max(fwidth(cf), 1e-5); // ≈ metres from the iso-line
    crack = (1.0 - smoothstep(w0, w0 + fw * 1.2, dline)) * sel * uTrA.w * (1.0 - smoothstep(0.025, 0.07, fw));
    wide = crack * smoothstep(0.0065, 0.009, w0);
  }
  // (r5) angular crazing (ref 6): Voronoi cell borders, selected in patches, filled with dark grime
  if (uTrA.w > 0.0 && fw < 0.06) {
    vec2 vc = cgVoronoi3(vec3(uv * 2.2, 1.7 * up) + vec3(cgSnoise(vec3(uv * 3.0, 5.0)), cgSnoise(vec3(uv * 3.0, 8.0)), 0.0) * 0.12);
    float ed = vc.y - vc.x, aaC = fw * 3.3 + 0.008;
    float cz = (1.0 - smoothstep(0.018, 0.018 + aaC, ed)) * smoothstep(0.2, 0.55, cgSnoise(vec3(uv * 0.6, 11.0))) * (1.0 - smoothstep(0.02, 0.06, fw));
    crack = max(crack, cz * 0.85 * uTrA.w);
    wide = max(wide, cz * smoothstep(0.6, 0.8, cgVnoise3(p * 3.0)));
  }
  // nosing: worn bright, chipped dark
  float chip = smoothstep(0.68, 0.84, cgSnoise(p * vec3(9.0, 15.0, 9.0) + 1.3) * 0.5 + 0.5) * edge;
  col = mix(col, col * 1.07, edge * 0.6);
  col = mix(col, col * vec3(0.55, 0.53, 0.50), chip * 0.6);
  // grime where the riser meets the tread below / the back band of each tread
  float gN = cgVfbm3(p * 1.7 + 4.0, 3);
  col = mix(col, col * vec3(0.42, 0.40, 0.36), cav * (0.72 + 0.28 * gN)); // (r6) darker riser-foot grime lines (ref 6)
  // moss: in the wide cracks, along the grimy junctions, more away from the walking line
  float mossN = cgVfbm3(p * 1.3 + 17.0, 3);
  vec3 mossCol = mix(vec3(0.085, 0.10, 0.035), vec3(0.20, 0.20, 0.08), cgVnoise3(p * 5.0));
  float moss = clamp(wide * 0.6 + cav * smoothstep(0.45, 0.75, mossN + 0.25 * (1.0 - walk)), 0.0, 1.0) * uTrA.z;
  col = mix(col, vec3(0.09, 0.085, 0.075), clamp(crack * 0.85, 0.0, 0.85)); // (r6) 0.7 → 0.85
  col = mix(col, mossCol, min(moss * 0.8, 0.92));
  // walking line: smoother, brighter (polished by feet)
  col = mix(col, col * 1.05, walk * up * 0.6);
  return col;
}
`;
/** worn stair treads */
export function treadMaterial() {
  return cached('acro:tread4', () => proceduralMaterial({
    name: 'acro-tread',
    params: { color: 0xffffff, roughness: 0.5, metalness: 0, vertexColors: true },
    uniforms: { uTrA: { value: new THREE.Vector4(24, 5.5, 1.35, 1.15) } }, // (r6) moss 1.35, cracks 1.15
    vertexHead: AUX_VS_HEAD, vertexPre: AUX_VS_PRE,
    head: `varying vec4 vAcroAux;\n` + TREAD_GLSL,
    color: /* glsl */ `diffuseColor.rgb *= acroTread(cgP, cgN, vAcroAux);`,
    normal: /* glsl */ `
      float dN = length(cameraPosition - cgP);
      float fN = 1.0 - smoothstep(5.0, 45.0, dN);
      if (fN > 0.0) {
        vec3 pp = cgP * 9.0;
        float c0 = cgSnoise(pp);
        vec3 g = vec3(cgSnoise(pp + vec3(0.3,0,0)) - c0, cgSnoise(pp + vec3(0,0.3,0)) - c0, cgSnoise(pp + vec3(0,0,0.3)) - c0) / 0.3;
        vec3 g2 = vec3(cgSnoise(pp * 5.0 + vec3(0.3,0,0)), cgSnoise(pp * 5.0 + vec3(0,0.3,0)), cgSnoise(pp * 5.0 + vec3(0,0,0.3)));
        vec3 b = (g * 0.010 + g2 * 0.018) * fN;
        cgBump = b - cgN * dot(b, cgN);
      }
    `,
    roughness: /* glsl */ `roughnessFactor = clamp(roughnessFactor + 0.12 * (cgVnoise3(cgP * 2.3) - 0.5) + 0.3 * clamp(vAcroAux.x, 0.0, 1.0) - 0.08 * clamp(vAcroAux.y, 0.0, 1.0), 0.2, 0.95);`,
    ao: STONE_AO,
  }));
}

/**
 * Flagstone paving computed in world space (axis aligned rows, running bond), with per-slab tint,
 * joint grime, moss and grass in joints. Vertex colour = zone tint (multiplier).
 */
export function pavingMaterial() {
  return cached('acro:paving', () => proceduralMaterial({
    name: 'acro-paving',
    params: { color: 0xffffff, roughness: 0.8, metalness: 0, vertexColors: true },
    uniforms: stoneUniforms({ lichen: 0.7, streaks: 0.0, veins: 0.35, moss: 0.15, warmth: 0.15, chips: 0.5, seed: 0.55 }),
    vertexHead: AUX_VS_HEAD, vertexPre: AUX_VS_PRE,
    head: STONE_GLSL + /* glsl */ `
      // returns: x = distance to joint (m), y = slab id hash, z = slab id hash 2
      vec3 acroSlab(vec2 p){
        float rowH = 1.05;
        float row = floor(p.y / rowH);
        float rh = cgHash11(row * 1.37 + 0.5);
        float lenS = mix(1.1, 2.2, rh);
        float off = cgHash11(row * 7.1) * lenS;
        float x = p.x + off;
        float col = floor(x / lenS);
        float fx = fract(x / lenS) * lenS, fy = p.y - row * rowH;
        float id = cgHash12(vec2(col, row));
        float dj = min(min(fx, lenS - fx), min(fy, rowH - fy));
        if (id > 0.82) { float half_ = lenS * 0.5; dj = min(dj, abs(fx - half_)); id = cgHash12(vec2(col + step(half_, fx) * 0.5, row + 0.3)); }
        return vec3(dj, id, cgHash12(vec2(row, col) + 3.1));
      }
    `,
    color: /* glsl */ `
      vec3 sl = acroSlab(cgP.xz);
      float fwP = length(fwidth(cgP));
      float jw = max(0.008, fwP * 0.45);
      float joint = (1.0 - smoothstep(jw * 0.5, jw * 1.6 + 0.006, sl.x)) * (1.0 - smoothstep(0.03, 0.12, fwP) * 0.65);
      diffuseColor.rgb *= (0.84 + 0.24 * sl.y) * mix(vec3(1.0), vec3(1.03, 0.985, 0.93), sl.z) * mix(1.0, 0.86, step(0.9, sl.z));
      diffuseColor.rgb *= acroStone(cgP, cgN, vAcroAux + vec4(0.0, 1.0 - smoothstep(0.0, 0.05, sl.x), 0.0, 0.0));
      float edgeDirt = 1.0 - smoothstep(0.0, 0.12, sl.x);
      vec3 mossC = vec3(0.12, 0.14, 0.06);
      float mossy = smoothstep(0.45, 0.85, cgVfbm2(cgP.xz * 0.35, 3));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.8, edgeDirt * 0.5);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.38, mossC, mossy * 0.6), joint * 0.8);
    `,
    normal: /* glsl */ `
      vec3 sl2 = acroSlab(cgP.xz);
      vec2 tilt = (vec2(cgHash11(sl2.y * 91.0), cgHash11(sl2.z * 57.0)) - 0.5) * 0.035;
      vec3 gr = acroGrad(cgP * 2.7) * 0.03;
      cgBump = vec3(tilt.x, 0.0, tilt.y) + (gr - cgN * dot(gr, cgN));
    `,
    roughness: STONE_ROUGH,
  }));
}

export function goldMaterial() {
  return cached('acro:gold', () => proceduralMaterial({
    name: 'acro-gold',
    params: { color: new THREE.Color(0.86, 0.62, 0.28), roughness: 0.32, metalness: 1.0 },
    color: `diffuseColor.rgb *= 0.85 + 0.25 * cgVnoise3(cgP * 6.0);`,
    roughness: `roughnessFactor = clamp(roughnessFactor + 0.25 * (cgVnoise3(cgP * 4.0) - 0.4), 0.15, 0.8);`,
  }));
}
export function bronzeMaterial() {
  return cached('acro:bronze', () => proceduralMaterial({
    name: 'acro-bronze',
    params: { color: new THREE.Color(0.55, 0.36, 0.16), roughness: 0.45, metalness: 1.0 },
    color: `float pat = smoothstep(0.55, 0.8, cgVfbm3(cgP * 2.0, 3)) * smoothstep(0.0, 0.8, cgN.y + 0.3);
            diffuseColor.rgb = mix(diffuseColor.rgb * (0.85 + 0.3 * cgVnoise3(cgP * 8.0)), vec3(0.18, 0.32, 0.26), pat * 0.5);`,
    roughness: `roughnessFactor = clamp(roughnessFactor + 0.3 * (cgVnoise3(cgP * 3.0) - 0.4), 0.2, 0.9);`,
    metalness: `metalnessFactor = 1.0 - 0.6 * smoothstep(0.55, 0.8, cgVfbm3(cgP * 2.0, 3));`,
  }));
}
export function soilMaterial() {
  return cached('acro:soil', () => proceduralMaterial({
    name: 'acro-soil',
    params: { color: new THREE.Color(0.10, 0.075, 0.05), roughness: 1.0 },
    color: `diffuseColor.rgb *= 0.7 + 0.6 * cgVnoise3(cgP * 5.0);`,
  }));
}
/** dark recess (inside niches / doorways / gaps) */
export function shadowStoneMaterial() {
  return cached('acro:dark', () => proceduralMaterial({
    name: 'acro-dark',
    params: { color: new THREE.Color(0.16, 0.14, 0.12), roughness: 0.95 },
    color: `diffuseColor.rgb *= 0.75 + 0.5 * cgVnoise3(cgP * 2.0);`,
  }));
}
/** mosaic disc: canvas texture modulated by tesserae in the shader */
export function mosaicMaterial(tex) {
  return proceduralMaterial({
    name: 'acro-mosaic',
    params: { map: tex, color: 0xffffff, roughness: 0.6 },
    color: /* glsl */ `
      vec2 q = cgP.xz * 22.0;
      vec2 cell = floor(q); vec2 f = fract(q);
      float t = cgHash12(cell);
      float grout = smoothstep(0.0, 0.12, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
      float fw = length(fwidth(cgP)) * 22.0;
      grout = mix(grout, 0.85, smoothstep(0.3, 1.0, fw));
      diffuseColor.rgb *= (0.86 + 0.24 * t) * mix(0.62, 1.0, grout);
      float wear = cgVfbm2(cgP.xz * 0.6, 3);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.50, 0.42), smoothstep(0.55, 0.8, wear) * 0.35);
    `,
  });
}

/** All named materials used by ChunkedBuilders. */
export async function loadAcroMaterials(opts = {}) {
  const M = {
    ashlar: ashlarMaterial(), marble: marbleMaterial(), tread: treadMaterial(), paving: pavingMaterial(),
    gold: goldMaterial(), bronze: bronzeMaterial(), soil: soilMaterial(), dark: shadowStoneMaterial(),
  };
  if (opts.local) return M;
  try {
    const mm = await import('../materials/marble.js');
    // (r2) near-neutral tint: the old 0xf4ece0 + warmth 0.45 made the walls read yellow (≈ 228,200,152 lit)
    const a = mm.marbleMaterial({ variant: 'weathered', vertexColors: true, tint: 0xe6e6e7, seed: 0.37, overrides: { lichen: 0.85, streaks: 1.0, warmth: 0.12, weather: 1.0, moss: 0.14, heavy: 0.85, ochre: 0.3 } }); // (r5 acropolis) heavy rain-wash runs + black crust: the walls read weathered from afar
    const bad = shaderProblem(a);
    if (bad) console.warn(`[acropolis] shared marble shader declares reserved GLSL identifier '${bad}' — using local stone materials`);
    else {
      M.ashlar = a;
      // stair treads, parapets and pedestals keep the local crazed-marble shader (crack network, ref 6)
      M.shared = true;
    }
  } catch (e) { console.log('[acropolis] shared marble not available, using local materials'); }
  try {
    const mt = await import('../materials/metal.js');
    const g = mt.goldMaterial({}), b = mt.bronzeMaterial({});
    if (!shaderProblem(g) && !shaderProblem(b)) { M.gold = g; M.bronze = b; }
  } catch (e) { /* local */ }
  return M;
}

/** dry-run a procedural material's onBeforeCompile and look for identifiers reserved in GLSL ES 3.0 */
export function shaderProblem(mat) {
  try {
    const fake = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>\n#include <worldpos_vertex>\n',
      fragmentShader: '#include <common>\nvoid main() {\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>\n#include <aomap_fragment>\n}\n',
    };
    mat.onBeforeCompile(fake, null);
    const src = fake.vertexShader + fake.fragmentShader;
    const m = src.match(/\b(?:float|vec[234]|int|bool|mat[234])\s+(patch|sample|input|output|filter|active|superp|half|fixed|long|short|double|union|enum|class|buffer|shared|resource|common|partition|namespace|using|cast|sizeof|template|this|inline|volatile|public|static|extern|external|interface|unsigned|precise|subroutine|coherent|restrict|readonly|writeonly|noperspective|packed|goto|typedef|asm)\b/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}
