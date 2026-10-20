// Ship materials: timber (tarred hulls, painted bands, deck planks, spars, oars, bronze fittings,
// painted eyes) and sail cloth (linen / striped / dyed navy with a gold owl emblem), with
// light transmission when the sun is behind the sail.
import * as THREE from 'three';
import { proceduralMaterial, cached } from '../core/materials.js';

// aW = (u along the hull (m), v height above the waterline (m), paint seed, kind)
//  kind 0 tarred hull planks, 1 deck planks, 2 painted band, 3 spar/mast, 4 oar, 5 bronze,
//       6 rope/dark, 7 eye (u,v local to the eye), 8 natural hull (merchant), 9 pier timber
const WOOD_HEAD = /* glsl */ `
varying vec4 vW;
vec3 shipPaint(float s){
  float k = fract(s * 7.31);
  if (k < 0.3) return vec3(0.34, 0.11, 0.07);    // red ochre
  if (k < 0.5) return vec3(0.06, 0.11, 0.28);    // blue
  if (k < 0.7) return vec3(0.62, 0.58, 0.48);    // white lime
  if (k < 0.85) return vec3(0.52, 0.34, 0.10);   // yellow ochre
  return vec3(0.12, 0.25, 0.20);                 // green
}
`;
const WOOD_COLOR = /* glsl */ `
float u = vW.x, v = vW.y, s = vW.z;
int kind = int(vW.w + 0.5);
float aa = max(fwidth(u), fwidth(v)) + 0.002;
float plank = 1.0 - (1.0 - smoothstep(0.0, 0.02 + aa, abs(fract(v / 0.22) - 0.5) * 0.22 - 0.095)) * 0.6;
float grain = cgVnoise2(vec2(u * 1.5, v * 40.0 + s * 9.0));
vec3 c;
if (kind == 0) {
  c = vec3(0.045, 0.036, 0.028) * (0.85 + 0.3 * grain);
  c *= plank;
  float foul = smoothstep(0.35, -0.1, v);
  c = mix(c, vec3(0.05, 0.07, 0.04), foul * 0.8);
} else if (kind == 8) {
  c = vec3(0.24, 0.16, 0.09) * (0.75 + 0.35 * grain) * plank;
  float tar = smoothstep(0.45, 0.0, v);
  c = mix(c, vec3(0.04, 0.035, 0.03), tar);
} else if (kind == 1 || kind == 9) {
  float pk = floor(u / 0.24);
  c = vec3(0.30, 0.22, 0.14) * (0.7 + 0.45 * cgHash12(vec2(pk, s * 13.0))) * (0.85 + 0.25 * grain);
  c *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.015 + aa, abs(fract(u / 0.24) - 0.5) * 0.24 - 0.105));
  if (kind == 9) c *= vec3(0.85, 0.85, 0.82);
} else if (kind == 2) {
  c = shipPaint(s) * (0.85 + 0.2 * cgVnoise2(vec2(u * 0.7, v * 3.0) + s * 5.0));
} else if (kind == 3 || kind == 4) {
  c = vec3(0.28, 0.19, 0.11) * (0.8 + 0.3 * grain);
} else if (kind == 5) {
  c = vec3(0.48, 0.32, 0.16);
} else if (kind == 6) {
  c = vec3(0.10, 0.08, 0.06);
} else if (kind == 11) {
  c = vec3(0.42, 0.20, 0.11) * (0.8 + 0.3 * cgVnoise2(vec2(u * 2.0, v * 6.0) + s * 7.0));
} else if (kind == 10) {
  c = vec3(0.60, 0.55, 0.45) * (0.8 + 0.3 * cgVnoise2(vec2(u * 3.0, v * 9.0) + s * 3.0));
} else if (kind == 12) {
  // garments (crew / passengers): muted dyed wool by seed — navy, oxblood, ochre, undyed, brown
  float k = fract(s * 7.31);
  c = k < 0.25 ? vec3(0.035, 0.045, 0.09) : k < 0.45 ? vec3(0.17, 0.04, 0.03) : k < 0.6 ? vec3(0.36, 0.25, 0.10) : k < 0.8 ? vec3(0.50, 0.46, 0.38) : vec3(0.14, 0.09, 0.05);
  c *= 0.8 + 0.35 * cgVnoise2(vec2(u * 4.0, v * 14.0) + s * 3.0);
} else if (kind == 13) {
  c = vec3(0.36, 0.22, 0.14) * (0.9 + 0.2 * fract(s * 3.7));   // sun-tanned skin
} else {
  // painted apotropaic eye
  float r = length(vec2(u, v * 1.6));
  c = mix(vec3(0.66, 0.62, 0.55), vec3(0.03, 0.03, 0.04), smoothstep(0.17, 0.15, r));
  c = mix(c, vec3(0.40, 0.09, 0.05), smoothstep(0.42, 0.4, r) * smoothstep(0.38, 0.4, r));
}
diffuseColor.rgb = c;
`;

export function shipWoodMaterial() {
  return cached('city-shipwood', () => {
    const m = proceduralMaterial({
      name: 'cityShipWood',
      params: { color: 0xffffff, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide },
      head: WOOD_HEAD,
      vertexHead: 'attribute vec4 aW;\nvarying vec4 vW;',
      vertexPre: 'vW = aW;',
      color: WOOD_COLOR,
      roughness: 'int k = int(vW.w + 0.5); roughnessFactor = k == 0 ? 0.45 : k == 5 ? 0.35 : 0.75;',
      metalness: 'metalnessFactor = int(vW.w + 0.5) == 5 ? 0.85 : 0.0;',
    });
    return m;
  });
}

// aSail = (u across (m, from the left edge), v down from the yard (m), seed, kind)
//  kind 0 linen, 1 striped, 2 navy + gold emblem, 3 red-brown, 4 furled bundle
const SAIL_HEAD = /* glsl */ `
varying vec4 vSail;
// stylised owl in a laurel ring, gold on navy. p in [-1,1]^2, y up
float sailOwl(vec2 p){
  float ring = smoothstep(0.06, 0.035, abs(length(p) - 0.82));
  // laurel leaves along the ring
  float ang = atan(p.y, p.x);
  float leaves = smoothstep(0.5, 0.9, sin(ang * 18.0)) * smoothstep(0.16, 0.08, abs(length(p) - 0.82)) * step(-0.75, p.y);
  // owl body + head + eyes
  vec2 b = p - vec2(0.0, -0.18);
  float body = smoothstep(0.03, 0.0, length(b / vec2(0.32, 0.42)) - 1.0);
  vec2 h = p - vec2(0.0, 0.32);
  float head = smoothstep(0.03, 0.0, length(h / vec2(0.30, 0.22)) - 1.0);
  float eyes = smoothstep(0.1, 0.085, length(h - vec2(-0.12, 0.0))) + smoothstep(0.1, 0.085, length(h - vec2(0.12, 0.0)));
  float ears = step(abs(h.x), 0.3) * step(0.12, h.y) * step(h.y, 0.3 - abs(abs(h.x) - 0.22) * 1.5) * step(0.12, abs(h.x));
  float owl = max(max(body, head), ears) * (1.0 - 0.75 * eyes);
  return max(max(ring, leaves), owl);
}
`;
const SAIL_COLOR = /* glsl */ `
float u = vSail.x, v = vSail.y, s = vSail.z;
int kind = int(vSail.w + 0.5);
float aa = max(fwidth(u), fwidth(v)) + 0.003;
float sdet = 1.0 - smoothstep(0.02, 0.08, aa);
float weave = 0.94 + 0.06 * mix(0.5, cgVnoise2(vec2(u, v) * 18.0 + s * 30.0), sdet) + 0.05 * (cgVnoise2(vec2(u * 0.7, v * 0.5) + s * 9.0) - 0.5);
float panel = 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.015 + aa, abs(fract(u / 0.62) - 0.5) * 0.62 - 0.29));
// brail lines (ropes running down the sail every ~0.9 m) and horizontal rings
float brail = 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.02 + aa, abs(fract(u / 0.95 + 0.5) - 0.5) * 0.95 - 0.0)) ;
vec3 c;
if (kind == 2) {
  vec3 navy = vec3(0.018, 0.026, 0.075);
  vec3 gold = vec3(0.55, 0.38, 0.12);
  float W = vSailSize.x, H = vSailSize.y;
  // border
  float bd = min(min(u, W - u), min(v, H - v));
  float border = smoothstep(0.32 + aa, 0.32 - aa, bd) * smoothstep(0.12 - aa, 0.12 + aa, bd);
  vec2 p = vec2((u - W * 0.5) / (W * 0.36), (H * 0.45 - v) / (W * 0.36));
  float emb = sailOwl(p);
  c = mix(navy * weave, gold * (0.8 + 0.3 * weave), max(border, emb));
} else {
  vec3 lin = vec3(0.70, 0.64, 0.52) * (0.92 + 0.12 * fract(s * 11.3));
  if (kind == 3) lin = vec3(0.42, 0.20, 0.12);
  c = lin * weave * panel;
  if (kind == 1) {
    float st = step(0.5, fract(u / (vSailSize.x / 5.0)));
    c = mix(c, vec3(0.38, 0.12, 0.07) * weave, st * 0.85);
  }
  // grime toward the foot and patches
  c *= 1.0 - 0.2 * smoothstep(0.5, 1.0, v / max(vSailSize.y, 1.0)) * cgVnoise2(vec2(u * 0.6, v * 0.4) + s);
  float patchM = step(0.82, cgHash12(floor(vec2(u / 0.62, v / 0.9)) + s * 7.0)) * 0.12;
  c *= 1.0 - patchM;
}
if (kind != 4) c *= brail;
diffuseColor.rgb = c;
`;
// light transmitted through the cloth when the sun is behind it (seen from the camera side)
const SAIL_EMISSIVE = /* glsl */ `
#ifdef USE_FOG
{
  vec3 n = normalize(cgN);
  float back = dot(n, uSunDir) * dot(n, cgV);  // sun and camera on opposite sides → negative
  float tr = smoothstep(0.0, -0.5, back);
  int kind2 = int(vSail.w + 0.5);
  float k = kind2 == 2 ? 0.08 : kind2 == 4 ? 0.0 : 0.85;
  totalEmissiveRadiance += diffuseColor.rgb * uSunColor * tr * k * 2.2;
}
#endif
`;

export function sailMaterial() {
  return cached('city-sail', () => {
    const m = proceduralMaterial({
      name: 'citySail',
      params: { color: 0xffffff, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide },
      head: SAIL_HEAD + 'varying vec2 vSailSize;\n',
      vertexHead: 'attribute vec4 aSail;\nattribute vec2 aSailSize;\nvarying vec4 vSail;\nvarying vec2 vSailSize;',
      vertexPre: 'vSail = aSail; vSailSize = aSailSize;',
      color: SAIL_COLOR,
      emissive: SAIL_EMISSIVE,
    });
    return m;
  });
}

export const WOOD_ATTRS = { aW: 4 };
export const SAIL_ATTRS = { aSail: 4, aSailSize: 2 };
export const WK = { HULL: 0, DECK: 1, PAINT: 2, SPAR: 3, OAR: 4, BRONZE: 5, ROPE: 6, EYE: 7, NATURAL: 8, PIER: 9, CANVAS: 10, CLAY: 11, CLOTH: 12, SKIN: 13 };
