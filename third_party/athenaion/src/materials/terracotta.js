// Terracotta roof material (owned by the city module): Laconian / coppi barrel tiles laid in
// channel + cover rows, ridge & hip caps with lime mortar, eave tile-ends, soffits and flat terraces.
//
// Geometry carries aRoof = (u, v, seed, kind):
//   u    metres along the eave (across the tile rows)
//   v    metres up the slope from the eave (along the rows)
//   seed per-roof random [0,1)
//   kind 0 tiled slope, 1 ridge/hip cap (u along the ridge), 2 eave edge (tile mouths, u along eave,
//        v = 0..thickness), 3 soffit / underside, 4 flat terrace (lime screed), 5 plaster cornice
// All detail is shader-side and fades to the correct average colour when tiles become sub-pixel.
import { proceduralMaterial, cached } from '../core/materials.js';

const HEAD = /* glsl */ `
varying vec4 vRoof;
vec3 roofTileBase(float s){
  float k = fract(s * 5.31);
  vec3 c;
  if (k < 0.26) c = vec3(0.40, 0.145, 0.07);       // red terracotta
  else if (k < 0.48) c = vec3(0.34, 0.13, 0.068);  // deep red-brown
  else if (k < 0.64) c = vec3(0.30, 0.145, 0.085); // brown
  else if (k < 0.78) c = vec3(0.44, 0.20, 0.10);   // orange, newer
  else if (k < 0.90) c = vec3(0.34, 0.20, 0.13);   // weathered, greyed brown
  else c = vec3(0.23, 0.115, 0.075);               // dark aged
  return c * (0.74 + 0.3 * fract(s * 17.3));
}
// barrel tile profile across u: covers (convex) every P, channels (concave) in between
// returns height (m) and its derivative wrt u
vec2 roofProfile(float u, float P){
  float x = fract(u / P) - 0.5;          // -0.5..0.5, cover centred at 0
  float xm = x * P;                      // metres
  float cw = P * 0.24;                   // cover half width
  float h, dh;
  if (abs(xm) < cw) { float t = xm / cw; float s = sqrt(max(1.0 - t * t, 0.0)); h = 0.06 * s; dh = -0.06 * t / (cw * max(s, 0.15)); }
  else { float y = (abs(xm) - cw) / (P * 0.5 - cw); h = -0.028 * sin(y * 3.14159); dh = -0.028 * 3.14159 * cos(y * 3.14159) / (P * 0.5 - cw) * sign(xm); }
  return vec2(h, dh);
}
`;

const VERT_HEAD = /* glsl */ `
attribute vec4 aRoof;
varying vec4 vRoof;
`;

const COLOR = /* glsl */ `
float u = vRoof.x, v = vRoof.y, seed = vRoof.z;
int kind = int(vRoof.w + 0.5);
float hs = seed * 71.3;
vec3 base = roofTileBase(seed);
float age = fract(seed * 3.97);
float P = 0.31 + 0.06 * fract(seed * 9.1);
float C = 0.40;
float fw = max(fwidth(u), fwidth(v));
float detail = 1.0 - smoothstep(0.08, 0.22, fw / P);   // fade tiles when sub-pixel
vec3 col = base;
float ao = 1.0;
if (kind == 0) {
  float ci0 = floor(u / P + 0.5);
  // rows are laid by hand: slight lateral wobble per row
  float uu = u + 0.035 * (cgVnoise2(vec2(v * 0.9, ci0 * 3.7 + hs)) - 0.5);
  float ci = floor(uu / P + 0.5);
  float x = fract(uu / P + 0.5) - 0.5;
  float cwr = 0.23;
  bool cover = abs(x) < cwr;
  float colId = cover ? ci * 2.0 : ci * 2.0 + 1.0;
  float off = (cover ? 0.5 : 0.0) + 0.15 * cgHash12(vec2(colId, hs));
  float Ck = C * (0.94 + 0.1 * cgHash12(vec2(colId * 0.37, hs)));
  float k = floor(v / Ck + off);
  float fv = fract(v / Ck + off);
  float th = cgHash12(vec2(colId, k) + hs);
  float th2 = cgHash12(vec2(colId * 1.7, k * 3.1) + hs * 1.3);
  vec3 tc = base * (0.72 + 0.46 * th);
  tc *= mix(vec3(1.0), vec3(1.06, 0.95, 0.88), cgHash12(vec2(k, colId * 2.3) + hs));   // hue jitter
  tc = mix(tc, tc * vec3(1.14, 0.94, 0.82), step(0.9, th2));            // fresher replacement tiles
  tc = mix(tc, tc * vec3(0.62, 0.6, 0.58), step(th2, 0.07));            // dark old tiles
  // covers catch sun and bleach, channels collect dirt; edges of covers are shadowed
  float edge = cover ? smoothstep(cwr, cwr * 0.45, abs(x)) : 1.0;
  if (cover) tc = mix(tc, vec3(0.46, 0.33, 0.25), 0.2 * age) * mix(0.6, 1.0, edge);
  else { tc *= 0.74 * mix(0.75, 1.0, smoothstep(cwr, 0.5, abs(x))); ao = 0.72; }
  // overlap shadow line at the lower edge of each tile course (the course above overhangs)
  float lip = smoothstep(0.0, 0.12, fv);
  tc *= mix(0.5, 1.0, lip);
  // lichen / moss: grey-yellow crusts on covers, dark green-black in channels near the eave
  float lic = cgVfbm2(vec2(u, v) * 1.7 + hs, 3);
  float licM = smoothstep(0.62 - 0.12 * age, 0.70 - 0.12 * age, lic);
  tc = mix(tc, cover ? vec3(0.46, 0.43, 0.34) : vec3(0.09, 0.09, 0.05), licM * (0.3 + 0.5 * age));
  float moss = smoothstep(2.4, 0.0, v) * (cover ? 0.2 : 0.65) * smoothstep(0.35, 0.65, cgVnoise2(vec2(u * 1.3, v * 0.7) + hs));
  tc = mix(tc, vec3(0.07, 0.075, 0.04), moss * age);
  // average colour for the far field
  vec3 avg = base * 0.80 * mix(1.0, 0.9, age);
  col = mix(avg * (0.9 + 0.2 * cgVnoise2(vec2(u, v) * 0.25 + hs)), tc, detail);
  // large-scale patchy weathering over the whole roof
  float big = cgVfbm2(vec2(u, v) * 0.18 + hs * 0.7, 3);
  col *= 0.84 + 0.3 * big;
  col = mix(col, col * vec3(0.8, 0.8, 0.78) + vec3(0.05, 0.045, 0.04), smoothstep(0.55, 0.85, big) * age * 0.6);
  // sun-bleaching: slopes facing the southern sky fade toward a pale salmon-ochre (per-roof amount);
  // the bleach is patchy along the courses and strongest on the upper, exposed half of the slope
  float expo = smoothstep(-0.12, 0.42, 0.62 * cgN.z - 0.18 * cgN.x + 0.42 * cgN.y - 0.24);
  float bk = (0.18 + 0.82 * fract(seed * 7.77)) * expo * (0.75 + 0.5 * cgVnoise2(vec2(u * 0.6, v * 1.4) + hs * 1.7));
  vec3 bleached = vec3(0.47, 0.33, 0.255) * (0.9 + 0.2 * fract(seed * 23.1));
  col = mix(col, bleached * (0.82 + 0.36 * (col.r / max(base.r, 1e-3) - 0.8)), clamp(0.5 * bk, 0.0, 0.55));
  // dust + lime wash from the mortar dull every old roof a little (ref 1 roofs read salmon-brown, not orange)
  float lumC = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(col, vec3(lumC) * vec3(1.14, 0.96, 0.84), 0.16 + 0.12 * age);
} else if (kind == 1) {
  // ridge / hip caps: segmented with white lime mortar pointing
  float seg = fract(u / 0.42);
  float id = floor(u / 0.42);
  vec3 tc = base * (0.78 + 0.3 * cgHash12(vec2(id, hs)));
  float gap = smoothstep(0.0, 0.06, seg) * smoothstep(1.0, 0.94, seg);
  vec3 mortar = vec3(0.62, 0.58, 0.50);
  float mo = smoothstep(0.75, 0.95, abs(v));       // v = -1..1 across the cap: edges show mortar
  col = mix(mix(mortar, tc, gap), mortar * 0.9, mo * 0.8);
  col = mix(base * 0.8, col, detail);
} else if (kind == 2) {
  // eave edge: row of tile mouths (dark openings of the cover tiles)
  float x = fract(u / P + 0.5) - 0.5;
  float mouth = smoothstep(0.17, 0.12, length(vec2(x * P, (v - 0.04) * 1.6)));
  col = mix(base * 0.9, vec3(0.04, 0.025, 0.02), mouth * 0.85 * detail);
  ao = 0.8;
} else if (kind == 3) {
  // soffit: timber rafters under the eave
  float r = smoothstep(0.08, 0.14, abs(fract(u / 0.55) - 0.5));
  col = mix(vec3(0.16, 0.10, 0.06), vec3(0.30, 0.24, 0.17), r);
  ao = 0.5;
} else if (kind == 4) {
  // flat roof terrace: lime screed with stains and patches
  float n = cgVfbm2(vec2(u, v) * 0.6 + hs, 4);
  col = vec3(0.60, 0.56, 0.48) * (0.78 + 0.35 * n);
  float jt = smoothstep(0.0, 0.03, min(fract(u / 0.8), 1.0 - fract(u / 0.8))) * smoothstep(0.0, 0.03, min(fract(v / 0.8), 1.0 - fract(v / 0.8)));
  col *= mix(0.8, 1.0, mix(1.0, jt, detail));
} else {
  // plaster cornice (moulded band under the eave)
  vec3 pc = vec3(0.70, 0.65, 0.56) * (0.9 + 0.15 * fract(seed * 13.1));
  float dent = smoothstep(0.35, 0.45, abs(fract(u / 0.22) - 0.5)) * step(v, 0.12);
  col = pc * (1.0 - 0.45 * dent * detail);
}
diffuseColor.rgb = col;
`;

const NORMAL = /* glsl */ `
int kind2 = int(vRoof.w + 0.5);
if (kind2 == 0) {
  float u = vRoof.x, v = vRoof.y, seed = vRoof.z;
  float P = 0.31 + 0.06 * fract(seed * 9.1);
  float C = 0.40;
  float fw = max(fwidth(u), fwidth(v));
  float detail = 1.0 - smoothstep(0.08, 0.22, fw / P);
  // analytic frame: u runs along cross(up, N) (horizontal, along the eave), v up the slope
  vec3 Tt = cross(vec3(0.0, 1.0, 0.0), cgN);
  vec3 T = length(Tt) > 0.01 ? normalize(Tt) : vec3(1.0, 0.0, 0.0);
  vec3 B = normalize(cross(cgN, T));
  float hs = seed * 71.3;
  float ci0 = floor(u / P + 0.5);
  float uu = u + 0.035 * (cgVnoise2(vec2(v * 0.9, ci0 * 3.7 + hs)) - 0.5);
  vec2 pr = roofProfile(uu, P);
  float x = fract(uu / P + 0.5) - 0.5;
  bool cover = abs(x) < 0.23;
  float colId = cover ? floor(uu / P + 0.5) * 2.0 : floor(uu / P + 0.5) * 2.0 + 1.0;
  float off = (cover ? 0.5 : 0.0) + 0.15 * cgHash12(vec2(colId, hs));
  float Ck = C * (0.94 + 0.1 * cgHash12(vec2(colId * 0.37, hs)));
  float fv = fract(v / Ck + off);
  // each course is tilted a little more than the roof (saw-tooth) + slight random tilt / twist
  float tid = cgHash12(vec2(colId, floor(v / Ck + off)) + seed * 9.0);
  float tilt = 0.10 + 0.06 * (tid - 0.5);
  float dhv = -tilt * (1.0 - smoothstep(0.0, 0.12, fv)) * 3.0 + tilt * 0.4;
  float twist = 0.08 * (cgHash12(vec2(floor(v / Ck + off), colId * 1.3) + hs) - 0.5);
  cgBump = (-T * (pr.y * 0.75 + twist) - B * dhv) * detail;
}
`;

const ROUGH = /* glsl */ `
roughnessFactor = int(vRoof.w + 0.5) == 0 ? 0.88 : 0.92;
`;

const AO = /* glsl */ `
{
  int kind3 = int(vRoof.w + 0.5);
  float a = 1.0;
  if (kind3 == 0) {
    float P = 0.31 + 0.06 * fract(vRoof.z * 9.1);
    float x = fract(vRoof.x / P + 0.5) - 0.5;
    float fw = max(fwidth(vRoof.x), fwidth(vRoof.y));
    float detail = 1.0 - smoothstep(0.08, 0.22, fw / P);
    a = mix(0.85, abs(x * P) < P * 0.24 ? 1.0 : 0.7, detail);
  } else if (kind3 == 3) a = 0.45;
  cgAO = a;
}
`;

export function terracottaMaterial() {
  return cached('city-terracotta', () => proceduralMaterial({
    name: 'cityTerracotta',
    params: { color: 0xffffff, roughness: 0.84, metalness: 0.0 },
    head: HEAD,
    vertexHead: VERT_HEAD,
    vertexPre: 'vRoof = aRoof;',
    color: COLOR,
    normal: NORMAL,
    roughness: ROUGH,
    ao: AO,
  }));
}

export const ROOF_ATTRS = { aRoof: 4 };
export const ROOF_KIND = { TILE: 0, RIDGE: 1, EAVE: 2, SOFFIT: 3, TERRACE: 4, CORNICE: 5 };
