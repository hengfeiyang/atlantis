// Limestone material family for the town: ashlar, paving, polygonal (Lesbian) masonry, dressed
// stone, rough boulders. Geometry carries aSt = (s, t, seed, kind) with s/t surface metres.
//   kind 0 ashlar courses   1 paving slabs   2 polygonal masonry   3 dressed/smooth   4 boulder/rubble
//   kind 5 quay wall (ashlar + waterline algae/wet band)   6 street (worn paving with dirt)
import { proceduralMaterial, cached } from '../core/materials.js';

const HEAD = /* glsl */ `
varying vec4 vSt;
vec3 stoneTint(float s){
  float k = fract(s * 4.73);
  vec3 c = k < 0.4 ? vec3(0.58, 0.52, 0.43) : k < 0.7 ? vec3(0.61, 0.54, 0.43) : k < 0.9 ? vec3(0.54, 0.50, 0.43) : vec3(0.61, 0.50, 0.36);
  return c * (0.92 + 0.14 * fract(s * 21.1));
}
`;
const VERT_HEAD = /* glsl */ `
attribute vec4 aSt;
varying vec4 vSt;
`;

const COLOR = /* glsl */ `
float s = vSt.x, t = vSt.y, seed = vSt.z;
int kind = int(vSt.w + 0.5);
float hs = seed * 53.7;
vec3 tint = stoneTint(seed);
float aa = max(fwidth(s), fwidth(t)) + 0.002;
float detail = 1.0 - smoothstep(0.05, 0.25, aa);
vec3 col = tint;
float joint = 1.0;   // 0 in mortar joints
float blockId = 0.0;
if (kind == 0 || kind == 5) {
  float ch = 0.56 + 0.2 * fract(seed * 7.1);
  float row = floor(t / ch);
  float bl = 1.1 + 1.0 * cgHash12(vec2(row, hs));
  float sx = s / bl + cgHash12(vec2(row * 1.3, hs)) ;
  float bi = floor(sx);
  blockId = cgHash12(vec2(bi, row) + hs);
  float jx = min(fract(sx), 1.0 - fract(sx)) * bl;
  float jy = min(fract(t / ch), 1.0 - fract(t / ch)) * ch;
  joint = smoothstep(0.0, 0.035 + aa, min(jx, jy));
  col = tint * (0.80 + 0.32 * blockId);
} else if (kind == 1 || kind == 6) {
  float rw = 0.7 + 0.25 * fract(seed * 3.1);
  float row = floor(t / rw);
  float bl = 0.8 + 0.6 * cgHash12(vec2(row, hs + 1.0));
  float sx = s / bl + cgHash12(vec2(row, hs * 0.7));
  blockId = cgHash12(vec2(floor(sx), row) + hs);
  float jx = min(fract(sx), 1.0 - fract(sx)) * bl;
  float jy = min(fract(t / rw), 1.0 - fract(t / rw)) * rw;
  joint = smoothstep(0.0, 0.03 + aa, min(jx, jy));
  col = tint * (0.85 + 0.25 * blockId);
  if (kind == 6) {
    // worn street: packed earth between and over the paving, wheel/foot polish in the middle
    float dirt = cgVfbm2(vec2(s, t) * 0.25 + hs, 3);
    float edge = smoothstep(0.6, 2.4, abs(t));
    col = mix(col * vec3(1.02, 0.96, 0.86), vec3(0.40, 0.33, 0.24) * (0.85 + 0.3 * dirt), clamp(0.35 + 0.45 * smoothstep(0.35, 0.75, dirt) + 0.3 * edge, 0.0, 1.0));
  }
} else if (kind == 2) {
  vec3 vor = cgVoronoi2(vec2(s, t) * 1.35 + hs);
  blockId = vor.z;
  joint = smoothstep(0.0, 0.07 + aa * 1.35, vor.y - vor.x);
  col = tint * (0.78 + 0.34 * blockId);
} else if (kind == 8) {
  // yard ground: packed earth, dry grass, gravel, a few flag stones; s,t = world xz
  float n1y = cgVfbm2(vec2(s, t) * 0.18 + hs, 4);
  float n2y = cgVnoise2(vec2(s, t) * 1.3 + hs);
  vec3 earth = vec3(0.36, 0.29, 0.20) * (0.8 + 0.35 * n2y);
  vec3 dry = vec3(0.32, 0.30, 0.16) * (0.8 + 0.3 * n2y);
  vec3 green = vec3(0.12, 0.14, 0.06) * (0.8 + 0.4 * n2y);
  col = mix(earth, dry, smoothstep(0.4, 0.65, n1y));
  col = mix(col, green, smoothstep(0.62, 0.8, n1y) * 0.8);
  float grav = step(0.86, cgHash12(floor(vec2(s, t) * 9.0) + hs));
  col = mix(col, vec3(0.46, 0.42, 0.35), grav * 0.35 * detail);
  // irregular flag stones in patches
  vec3 fv = cgVoronoi2(vec2(s, t) * 1.1 + hs * 3.0);
  float flags = smoothstep(0.74, 0.78, cgVnoise2(vec2(s, t) * 0.25 + hs * 1.7));
  col = mix(col, tint * (0.7 + 0.25 * fv.z) * mix(0.75, 1.0, mix(1.0, smoothstep(0.0, 0.08, fv.y - fv.x), detail)), flags);
} else if (kind == 3) {
  col = tint * 1.08 * (0.94 + 0.08 * cgVnoise2(vec2(s, t) * 0.8 + hs));
} else if (kind == 9) {
  // dark void (doorways, deep openings): near-black with a faint warm bounce at the bottom
  col = vec3(0.022, 0.019, 0.016) * (1.0 + 0.8 * smoothstep(0.4, 0.0, t));
} else if (kind == 7) {
  // marble: warm white with faint veins
  float vein = abs(cgSnoise(vec3(s * 0.6 + 2.0 * cgVnoise2(vec2(s, t) * 0.7 + hs), t * 0.6, hs)));
  col = vec3(0.70, 0.665, 0.60) * (0.95 + 0.06 * fract(seed * 13.7)) * (1.0 - 0.10 * (1.0 - smoothstep(0.0, 0.06, vein)));
} else {
  float n = cgVfbm2(vec2(s, t) * 0.9 + hs, 4);
  col = tint * (0.65 + 0.5 * n);
}
// weathering: lichen, grime, water stains, fine pitting
float n1 = cgVfbm2(vec2(s * 0.35, t * 0.5) + hs, 4);
float pit = cgVnoise2(vec2(s, t) * 9.0 + hs);
col *= 0.86 + 0.22 * n1 + 0.06 * (pit - 0.5) * detail;
float lich = smoothstep(0.68, 0.74, cgVfbm2(vec2(s, t) * 1.1 + hs * 2.0, 3));
col = mix(col, vec3(0.30, 0.31, 0.24), lich * 0.45 * detail);
float streak = smoothstep(0.55, 0.9, cgVnoise2(vec2(s * 2.0 + hs, t * 0.12)));
col *= 1.0 - 0.18 * streak * (kind == 1 || kind == 6 || kind == 8 ? 0.0 : 1.0);
col *= mix(1.0, mix(0.42, 1.0, joint), detail);
if (kind == 5) {
  // waterline: dark wet band and green algae just above sea level
  float wy = vCgWorldPos.y;
  float wet = smoothstep(1.6, 0.2, wy);
  col = mix(col, col * vec3(0.45, 0.47, 0.42), wet);
  float alg = smoothstep(0.9, 0.1, wy) * smoothstep(-0.6, 0.0, wy);
  col = mix(col, vec3(0.07, 0.10, 0.05), alg * 0.7);
}
if (kind == 9) col = vec3(0.022, 0.019, 0.016);
diffuseColor.rgb = col;
`;

const NORMAL = /* glsl */ `
{
  float s = vSt.x, t = vSt.y;
  int kind = int(vSt.w + 0.5);
  if (kind != 3 && kind != 7 && kind != 8) {
    float e = 0.05;
    float k = kind == 4 ? 1.6 : 3.0;
    float h0 = cgVnoise2(vec2(s, t) * k + vSt.z * 40.0);
    float hx = cgVnoise2(vec2(s + e, t) * k + vSt.z * 40.0);
    float hy = cgVnoise2(vec2(s, t + e) * k + vSt.z * 40.0);
    vec3 Tt = cross(vec3(0.0, 1.0, 0.0), cgN);
    vec3 T = length(Tt) > 0.01 ? normalize(Tt) : vec3(1.0, 0.0, 0.0);
    vec3 B = normalize(cross(cgN, T));
    float amp = kind == 4 ? 1.2 : 0.35;
    cgBump = (T * (h0 - hx) + B * (h0 - hy)) * amp;
  }
}
`;

export function cityStoneMaterial({ offset = false } = {}) {
  return cached(offset ? 'city-stone-offset' : 'city-stone', () => {
    const m = proceduralMaterial({
      name: offset ? 'cityStreet' : 'cityStone',
      params: { color: 0xffffff, roughness: 0.9, metalness: 0.0 },
      head: HEAD,
      vertexHead: VERT_HEAD,
      vertexPre: 'vSt = aSt;',
      color: COLOR,
      normal: NORMAL,
      roughness: 'roughnessFactor = int(vSt.w + 0.5) == 3 ? 0.7 : int(vSt.w + 0.5) == 7 ? 0.6 : 0.9;',
    });
    if (offset) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; }
    return m;
  });
}
export const STONE_ATTRS = { aSt: 4 };
export const STONE_KIND = { ASHLAR: 0, PAVING: 1, POLYGONAL: 2, DRESSED: 3, BOULDER: 4, QUAY: 5, STREET: 6, MARBLE: 7, YARD: 8, VOID: 9 };

/** gilded bronze for finials, acroteria and the odd gilded statue (sun glints from afar, refs 1/4) */
export function cityGoldMaterial() {
  return cached('city-gold', () => proceduralMaterial({
    name: 'cityGold',
    params: { color: 0xffffff, roughness: 0.3, metalness: 1.0 },
    color: `
      float n = cgVnoise2(vCgWorldPos.xz * 3.0 + vCgWorldPos.y * 2.0);
      diffuseColor.rgb = vec3(0.86, 0.60, 0.24) * (0.85 + 0.25 * n);`,
    roughness: 'roughnessFactor = 0.26 + 0.18 * cgVnoise2(vCgWorldPos.xz * 5.0 + vCgWorldPos.y);',
  }));
}
