// adapted from athenaion/src/city/shipmats.js (timber only)
// Ship materials: timber (tarred hulls, painted bands, deck planks, spars, oars, bronze fittings,
// painted eyes) and sail cloth (linen / striped / dyed navy with a gold owl emblem), with
// light transmission when the sun is behind the sail.
import * as THREE from 'three';
import { proceduralMaterial, cached } from '../../core/materials.js';

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

export function cityWoodMaterial() {
  return cached('atl-city-wood', () => {
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
    m.userData.sunken = 'wood';
    return m;
  });
}

export const WOOD_ATTRS = { aW: 4 };
