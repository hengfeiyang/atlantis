// Ship materials: one timber/paint/metal material driven by a per-vertex `kind` (hull planking with painted
// zones — navy bow panel with the apotropaic eye, gold wave-scroll band, navy outrigger screens with gilt
// shields — deck, spars, oars, bronze ram, gilt posts, rope, crew), and a sail-cloth material (cream linen
// with a navy trident, brails, seams, light transmission when backlit). Wreck variant: rotten, stripped,
// tagged for the sunken overlay.
// adapted from athenaion/src/city/shipmats.js
import * as THREE from 'three';
import { proceduralMaterial, cached } from '../core/materials.js';

// aW = (u, v, seed, kind); aX = (local y, side, -, -)
export const K = {
  HULL: 0, DECK: 1, SCREEN: 2, SPAR: 3, OAR: 4, BRONZE: 5, ROPE: 6, GOLD: 7, PLAIN: 8, NAVY: 9,
  CANVAS: 10, CLAY: 11, CLOTH: 12, SKIN: 13, TIMBER: 14, RED: 15, BLADE: 16, IRON: 17,
};

// trireme painted-zone constants (hull frame, base length 37 m; the instance matrix scales the ship)
const HEAD = /* glsl */ `
varying vec4 vW;
varying vec4 vX;
uniform float uWreck;
float cgSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
vec3 shipPaint(float s){
  float k = fract(s * 7.31);
  if (k < 0.62) return vec3(0.010, 0.022, 0.095);  // navy (the fleet colour)
  if (k < 0.78) return vec3(0.20, 0.035, 0.022);   // red ochre
  if (k < 0.9) return vec3(0.012, 0.012, 0.014);   // black
  return vec3(0.05, 0.12, 0.10);                    // sea green
}
// almond eye on a navy panel: q in metres relative to the eye centre (x along the hull toward the bow)
vec4 shipEye(vec2 q, float aa){
  float W = 1.15, H = 0.55;
  float x = q.x / W;
  // almond: upper lid arc and lower lid arc
  float up = H * (1.0 - x * x) * (1.0 + 0.25 * x);
  float lo = -H * 0.78 * (1.0 - x * x) * (1.0 - 0.1 * x);
  float inside = step(abs(x), 1.0) * smoothstep(-aa, aa, up - q.y) * smoothstep(-aa, aa, q.y - lo);
  float dUp = abs(q.y - up), dLo = abs(q.y - lo);
  float outline = step(abs(x), 1.12) * (1.0 - smoothstep(0.085, 0.085 + aa * 1.5, min(dUp, dLo)));
  // tear duct tail toward the bow and brow line above
  float tail = 1.0 - smoothstep(0.06, 0.06 + aa, cgSeg(q, vec2(W * 0.95, -0.02), vec2(W * 1.3, -0.12)));
  float lash = (1.0 - smoothstep(0.035, 0.035 + aa, abs(q.y - up - 0.13 * (1.0 - x * x)))) * step(abs(x), 0.9);
  float brow = 1.0 - smoothstep(0.045, 0.045 + aa, abs(q.y - (H * 1.55 * (1.0 - 0.8 * x * x) + 0.02)) ) ;
  brow *= 0.0;
  float r = length(q - vec2(-0.05, -0.04));
  float iris = 1.0 - smoothstep(0.36, 0.36 + aa, r);
  float ring = smoothstep(0.29, 0.36, r) * iris;
  float pupil = 1.0 - smoothstep(0.16, 0.16 + aa, r);
  float hi = 1.0 - smoothstep(0.055, 0.055 + aa, length(q - vec2(-0.15, 0.11)));
  vec3 c = vec3(0.62, 0.58, 0.50);
  c = mix(c, vec3(0.02, 0.10, 0.30) * (0.8 + 0.5 * smoothstep(0.3, 0.05, r)), iris);
  c = mix(c, vec3(0.006, 0.02, 0.06), ring * 0.7);
  c = mix(c, vec3(0.004), pupil);
  c = mix(c, vec3(0.8), hi * inside);
  float gold = max(outline, max(tail, lash));
  return vec4(c, inside * (1.0 - gold) + gold * 2.0); // a: 0 none, (0,1] eye, 2 gold line
}
// running wave scroll (Vitruvian scroll) band; q.x along (m), q.y in [-0.5, 0.5] across the band
float shipScroll(vec2 q, float aa){
  float P = 0.62, h = 0.34;
  vec2 c = vec2((fract(q.x / P) - 0.5) * P, q.y * h);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float turns = (r - 0.015) / 0.034 - ang / 6.2832;
  float sp = abs(fract(turns) - 0.5) * 0.034;
  float spiral = (1.0 - smoothstep(0.006, 0.006 + aa, sp)) * step(r, 0.1);
  float wave = (1.0 - smoothstep(0.011, 0.011 + aa, abs(c.y - 0.1 * cos(c.x / P * 6.2832)))) * step(0.095, r);
  float edges = 1.0 - smoothstep(0.012, 0.012 + aa, abs(abs(c.y) - h * 0.44));
  return max(max(spiral, wave), edges);
}
`;

const COLOR = /* glsl */ `
float u = vW.x, v = vW.y, s = fract(vW.z + cgSeed * 0.731);
int kind = int(vW.w + 0.5);
float y = vX.x;
float aa = max(fwidth(u), fwidth(v)) + 0.002;
float far = smoothstep(0.03, 0.12, aa);   // fade fine detail with distance
float grain = cgVnoise2(vec2(u * 1.3, v * 38.0 + s * 9.0));
float grainF = mix(grain, 0.5, far);
vec3 wood = vec3(0.105, 0.048, 0.022) * (0.78 + 0.4 * grainF);
float plankW = 0.21;
float pIdx = floor(v / plankW);
float seam = 1.0 - (1.0 - smoothstep(0.0, 0.012 + aa, abs(fract(v / plankW) - 0.5) * plankW - 0.095)) * 0.55 * (1.0 - far);
float butt = 1.0 - (1.0 - smoothstep(0.0, 0.01 + aa, abs(fract(u / 4.3 + cgHash11(pIdx + s * 17.0)) - 0.5) * 4.3 - 2.13)) * 0.5 * (1.0 - far);
vec3 c;
float metal = 0.0, rough = 0.62, keepPaint = 0.0;
if (kind == 0) {
  // ---- trireme hull shell with painted zones (v = depth below the gunwale)
  float hv = cgHash11(pIdx * 3.1 + s * 5.0);
  c = wood * (0.82 + 0.3 * hv) * seam * butt;
  vec3 navy = shipPaint(s);
  // gold wave-scroll band below the outrigger
  float b0 = 0.58, b1 = 0.92;
  if (v > b0 && v < b1) {
    float q = (v - (b0 + b1) * 0.5) / (b1 - b0);
    float sc = shipScroll(vec2(u, q), aa * 2.0);
    c = mix(navy * (0.85 + 0.2 * grainF), vec3(0.75, 0.5, 0.18), clamp(sc, 0.0, 1.0) * (1.0 - far * 0.6));
    c = mix(c, vec3(0.5, 0.33, 0.12), far * 0.35);
    metal = clamp(sc, 0.0, 1.0) * (1.0 - far) * 0.9;
  }
  // bow panel (navy) with the eye
  float zb = 11.6 + 0.55 * max(0.0, v - 1.0);
  if (u > zb && v > b1 && y > 0.45) {
    float edge = min(u - zb, y - 0.45);
    c = navy * (0.85 + 0.25 * grainF);
    float gl = 1.0 - smoothstep(0.05, 0.05 + aa, abs(edge - 0.1));
    vec2 q = vec2(u - 15.0, y - 1.85);
    vec4 e = shipEye(q, aa * 1.5);
    keepPaint = (1.0 - smoothstep(1.0, 1.6, length(q / vec2(1.6, 0.9)))) * 0.95;
    if (e.a > 1.5) { c = vec3(0.78, 0.52, 0.2); metal = 0.9; rough = 0.3; }
    else if (e.a > 0.0) { c = mix(c, e.rgb, e.a); }
    c = mix(c, vec3(0.78, 0.52, 0.2), gl); metal = max(metal, gl * 0.9);
  }
  // oar ports (thalamite and zygite rows) between the frames
  if (u > -11.6 && u < 11.2) {
    float fz = abs(fract((u + 11.6) / 0.98) - 0.5) * 0.98;
    float p1 = length(vec2(fz, (y - 1.05) * 1.5));
    float p2 = length(vec2(fz, (y - 1.75) * 1.5));
    float port = 1.0 - smoothstep(0.07, 0.07 + aa, min(p1, p2));
    c = mix(c, vec3(0.006, 0.004, 0.003), port);
  }
  // wet / pitch below the waterline, grime streaks above it
  float wet = smoothstep(0.35, 0.0, y);
  c *= 1.0 - 0.45 * wet;
  c = mix(c, vec3(0.012, 0.016, 0.012), smoothstep(0.02, -0.12, y));
  c *= 1.0 - 0.18 * smoothstep(0.3, 1.0, cgVnoise2(vec2(u * 2.5, y * 0.6) + s * 3.0)) * smoothstep(2.2, 0.4, y);
  rough = mix(rough, 0.32, wet);
} else if (kind == 8) {
  c = vec3(0.16, 0.10, 0.055) * (0.75 + 0.35 * grainF) * seam;
  c = mix(c, vec3(0.02, 0.018, 0.015), smoothstep(0.45, 0.0, y));
} else if (kind == 1) {
  float pk = floor(u / 0.24);
  c = vec3(0.22, 0.14, 0.075) * (0.7 + 0.45 * cgHash12(vec2(pk, s * 13.0))) * (0.85 + 0.25 * grainF);
  c *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.015 + aa, abs(fract(u / 0.24) - 0.5) * 0.24 - 0.105)) * (1.0 - far);
} else if (kind == 2) {
  // outrigger screen: navy panels framed in gold with a gilt shield boss
  vec3 navy = shipPaint(s);
  float P = 1.22;
  float fx = (fract(u / P) - 0.5) * P;
  float fy = v - 0.3;
  float frame = 1.0 - smoothstep(0.035, 0.035 + aa, min(abs(abs(fx) - P * 0.5 + 0.05), abs(abs(fy) - 0.24)));
  frame *= step(abs(fy), 0.29);
  float boss = 1.0 - smoothstep(0.13, 0.13 + aa, length(vec2(fx, fy * 1.1)));
  float bossRim = 1.0 - smoothstep(0.02, 0.02 + aa, abs(length(vec2(fx, fy * 1.1)) - 0.17));
  float g = max(max(frame, boss * 0.8), bossRim);
  c = mix(navy * (0.85 + 0.2 * grainF), vec3(0.78, 0.52, 0.2), g * (1.0 - far * 0.5));
  metal = g * (1.0 - far) * 0.9; rough = mix(0.55, 0.3, g);
} else if (kind == 3 || kind == 4) {
  c = vec3(0.24, 0.15, 0.08) * (0.8 + 0.3 * grainF);
  if (kind == 4) c = vec3(0.30, 0.20, 0.11) * (0.85 + 0.25 * grainF);
} else if (kind == 16) {
  c = vec3(0.26, 0.17, 0.09) * (0.85 + 0.2 * grainF);
  c = mix(c, vec3(0.06, 0.05, 0.035), smoothstep(0.3, -0.2, y));   // wet blade
} else if (kind == 5) {
  c = vec3(0.55, 0.34, 0.15) * (0.85 + 0.25 * cgVnoise2(vec2(u, v) * 3.0)); metal = 0.9; rough = 0.38;
  c = mix(c, vec3(0.12, 0.2, 0.15), 0.35 * smoothstep(0.1, -0.2, y));
} else if (kind == 7) {
  c = vec3(0.85, 0.58, 0.24) * (0.88 + 0.18 * cgVnoise2(vec2(u * 2.0, v * 6.0) + s)); metal = 1.0; rough = 0.28 + 0.1 * grainF;
} else if (kind == 9) {
  c = shipPaint(s) * (0.85 + 0.25 * grainF);
} else if (kind == 15) {
  c = vec3(0.24, 0.045, 0.028) * (0.85 + 0.25 * grainF);
} else if (kind == 6) {
  c = vec3(0.16, 0.12, 0.07) * (0.85 + 0.3 * cgVnoise2(vec2(u * 30.0, v * 4.0)));
} else if (kind == 10) {
  c = vec3(0.56, 0.50, 0.40) * (0.8 + 0.3 * cgVnoise2(vec2(u * 3.0, v * 9.0) + s * 3.0));
} else if (kind == 11) {
  c = vec3(0.42, 0.20, 0.11) * (0.8 + 0.3 * cgVnoise2(vec2(u * 2.0, v * 6.0) + s * 7.0));
} else if (kind == 12) {
  float k = fract(s * 7.31 + u * 0.37);
  c = k < 0.3 ? vec3(0.04, 0.05, 0.11) : k < 0.5 ? vec3(0.20, 0.05, 0.03) : k < 0.65 ? vec3(0.36, 0.25, 0.10) : k < 0.85 ? vec3(0.50, 0.46, 0.38) : vec3(0.14, 0.09, 0.05);
  c *= 0.8 + 0.35 * cgVnoise2(vec2(u * 4.0, v * 14.0) + s * 3.0);
} else if (kind == 13) {
  c = vec3(0.34, 0.19, 0.11) * (0.9 + 0.2 * fract(s * 3.7 + u));
} else if (kind == 17) {
  c = vec3(0.05, 0.05, 0.05); metal = 0.7; rough = 0.5;
} else {
  // 14: bare structural timber (frames, keel, wreck)
  c = vec3(0.09, 0.055, 0.03) * (0.7 + 0.5 * grainF);
}
if (uWreck > 0.5) {
  // waterlogged, stripped timber: paint mostly gone, grey-brown, eroded, gilt reduced to traces
  float n = cgVnoise2(vec2(u * 1.7, v * 3.1) + s * 11.0);
  float keep = max(smoothstep(0.55, 0.75, n), keepPaint);
  if (kind == 7 || kind == 5) keep = max(keep, 0.5 * smoothstep(0.3, 0.6, n));
  vec3 rot = vec3(0.16, 0.135, 0.10) * (0.6 + 0.6 * cgVnoise2(vec2(u * 6.0, v * 18.0)));
  c = mix(rot, c * vec3(0.8, 0.9, 1.0), keep * 0.85);
  metal *= keep * 0.6;
  rough = mix(0.9, rough, keep);
}
diffuseColor.rgb = c;
cgShipMetal = metal; cgShipRough = rough;
`;

/** strength of the water-bounce fill on hulls (shared uniform; tune per shot via engine.onShot if needed) */
export const SHIP_BOUNCE = { value: 1.1 };
function woodMat(wreck) {
  const m = proceduralMaterial({
    name: wreck ? 'shipWreckWood' : 'shipWood',
    params: { color: 0xffffff, roughness: 0.65, metalness: 0.0, side: THREE.DoubleSide },
    uniforms: { uWreck: { value: wreck ? 1 : 0 }, uShipBounce: SHIP_BOUNCE },
    head: HEAD + '\nuniform float uShipBounce;\nfloat cgShipMetal = 0.0; float cgShipRough = 0.6;\n',
    vertexHead: 'attribute vec4 aW;\nattribute vec4 aX;\nvarying vec4 vW;\nvarying vec4 vX;',
    vertexPre: 'vW = aW; vX = aX;',
    color: COLOR,
    roughness: 'roughnessFactor = cgShipRough;',
    // golden era: warm fill bounced off the sunlit water (the sun-glitter path lights the shaded hull sides, ref 2)
    // sunken wreck: light scattered up from the bright caustic sand fills the shaded hull sides (ref 7)
    emissive: wreck ? /* glsl */ `
{
  vec3 n = normalize(cgN);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.55, 0.85, 0.95) * uShipBounce * 0.42 * (0.55 + 0.45 * (1.0 - abs(n.y)));
}` : /* glsl */ `
#ifdef USE_FOG
{
  vec3 n = normalize(cgN);
  vec2 sh = normalize(uSunDir.xz + 1e-4);
  float away = 0.35 + 0.65 * smoothstep(-0.2, 0.6, -dot(normalize(n.xz + 1e-4), sh));
  float bounce = (1.0 - abs(n.y)) * smoothstep(7.0, 0.3, cgP.y) * smoothstep(-0.3, 0.2, cgP.y) * away;
  totalEmissiveRadiance += diffuseColor.rgb * uSunColor * bounce * uShipBounce;
}
#endif`,
    metalness: 'metalnessFactor = cgShipMetal;',
    ao: wreck ? 'cgAO = 0.7 + 0.3 * smoothstep(-0.5, 1.0, vX.x);' : 'cgAO = 1.0;',
  });
  m.userData.sunken = 'wood';
  return m;
}
export function shipWoodMaterial() { return cached('ships-wood', () => woodMat(false)); }
export function wreckWoodMaterial() { return cached('ships-wreck', () => woodMat(true)); }

// ------------------------------------------------------------------ sails
// aSail = (u across from the left edge (m), v down from the yard (m), seed, kind); aSailSize = (W, H)
//  kind 0 linen + navy trident, 1 plain linen, 2 striped, 3 red-brown, 4 linen + trident, loosely brailed
const SAIL_HEAD = /* glsl */ `
varying vec4 vSail;
varying vec2 vSailSize;
float sdTriI(vec2 p, vec2 q){ // iq isosceles triangle, tip at origin pointing down (we flip outside)
  p.x = abs(p.x);
  vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
  vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
  float k = sign(q.y);
  float d = min(dot(a, a), dot(b, b));
  float s = max(k * (p.x * q.y - p.y * q.x), k * (p.y - q.y));
  return sqrt(d) * sign(s);
}
float sgSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// trident emblem (ref 2): p in emblem units, y up; returns signed distance (negative inside)
float tridentSD(vec2 p){
  float d = sgSeg(p, vec2(0.0, -1.0), vec2(0.0, 0.62)) - 0.052;
  // guard bar low on the shaft
  d = min(d, sgSeg(p, vec2(-0.13, -0.62), vec2(0.13, -0.62)) - 0.035);
  // curved crossbar + side prongs: lower half of an ellipse, flaring up
  vec2 q = p - vec2(0.0, 0.22);
  float ang = atan(q.y, q.x);
  float e = length(q / vec2(0.40, 0.30));
  float arc = abs(e - 1.0) * 0.32 - 0.045;
  arc = max(arc, q.y);                    // lower half only
  d = min(d, arc);
  for (int i = 0; i < 2; i++) {
    float sx = i == 0 ? -1.0 : 1.0;
    d = min(d, sgSeg(p, vec2(sx * 0.40, 0.22), vec2(sx * 0.45, 0.62)) - 0.045);
    d = min(d, sdTriI(vec2(p.x - sx * 0.455, -(p.y - 0.86)), vec2(0.13, 0.30)));
  }
  d = min(d, sdTriI(vec2(p.x, -(p.y - 0.92)), vec2(0.15, 0.34)));
  return d;
}
`;
const SAIL_COLOR = /* glsl */ `
float u = vSail.x, v = vSail.y, s = fract(vSail.z + cgSeed * 0.53);
int kind = int(vSail.w + 0.5);
float W = vSailSize.x, H = vSailSize.y;
float aa = max(fwidth(u), fwidth(v)) + 0.003;
float sdet = 1.0 - smoothstep(0.02, 0.08, aa);
float weave = 0.95 + 0.05 * mix(0.5, cgVnoise2(vec2(u, v) * 22.0 + s * 30.0), sdet) + 0.06 * (cgVnoise2(vec2(u * 0.7, v * 0.5) + s * 9.0) - 0.5);
// sewn cloths (vertical panels ~0.6 m) and the horizontal rows of brail rings
float panel = mix(0.985, 1.0 - 0.10 * (1.0 - smoothstep(0.0, 0.012 + aa, abs(fract(u / 0.6) - 0.5) * 0.6 - 0.288)), 1.0 - smoothstep(0.01, 0.05, aa));
float brailX = abs(fract(u / (W / 9.0)) - 0.5) * (W / 9.0);
// r6: brail lines ≈ 6 cm (line + its shadow), energy-conserving when sub-pixel (no aliasing into stripes far away)
float bwe = max(0.06, aa * 1.3);
float brail = 1.0 - 0.5 * (1.0 - smoothstep(bwe * 0.45, bwe, brailX)) * (0.06 / bwe) * step(0.15, v);
float rings = 1.0 - 0.35 * (1.0 - smoothstep(0.03, 0.05 + aa, length(vec2(brailX, abs(fract(v / 0.75) - 0.5) * 0.75)))) ;
vec3 lin = vec3(0.72, 0.62, 0.46) * (0.93 + 0.1 * fract(s * 11.3));
vec3 c = lin * weave * panel;
if (kind == 3) c = vec3(0.42, 0.20, 0.12) * weave * panel;
if (kind == 2) {
  float st = step(0.5, fract(u / (W / 6.0)));
  c = mix(c, vec3(0.30, 0.06, 0.035) * weave, st * 0.9);
}
if (kind == 0 || kind == 4 || kind == 5) {
  vec2 p = vec2((u - W * 0.5) / (H * 0.42), (H * 0.47 - v) / (H * 0.42));
  float d = tridentSD(p) * H * 0.42;
  float m = 1.0 - smoothstep(-aa, aa, d);
  c = mix(c, vec3(0.016, 0.065, 0.34) * (0.9 + 0.2 * weave), m * 0.96);   // r6: royal navy (ref 2), was 0.022, 0.06, 0.26
}
// grime toward the foot, weathered patches
c *= 1.0 - 0.16 * smoothstep(0.55, 1.0, v / max(H, 1.0)) * cgVnoise2(vec2(u * 0.6, v * 0.4) + s);
c *= 1.0 - step(0.9, cgHash12(floor(vec2(u / 0.6, v / 1.3)) + s * 7.0)) * 0.035 * sdet;
c *= brail * mix(1.0, rings, sdet);
diffuseColor.rgb = c;
`;
// light transmitted through the cloth when the sun is behind it (seen from the camera side)
const SAIL_EMISSIVE = /* glsl */ `
#ifdef USE_FOG
{
  vec3 n = normalize(cgN);
  float back = dot(n, uSunDir) * dot(n, cgV);
  float tr = smoothstep(0.0, -0.45, back);
  float k = int(vSail.w + 0.5) == 3 ? 0.4 : 0.85;
  // r6: the glow follows the belly (cloth square to the sun transmits more) and the doubled seams / brails / emblem
  //     read darker against the light (the backlit sails were flat glowing boards in shots 1, 2, 5)
  float nl = abs(dot(n, uSunDir));
  vec3 dc = diffuseColor.rgb;
  vec3 tcol = dc * clamp(0.45 + 0.55 * dot(dc, vec3(0.333)) / 0.6, 0.0, 1.3);
  totalEmissiveRadiance += tcol * uSunColor * tr * k * (0.45 + 0.8 * nl) * 1.8 * max(uSunDir.y + 0.15, 0.0) * 2.5;
  if (int(vSail.w + 0.5) == 5) totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.62, 0.32) * 0.45;   // lamp-lit inside the ship-sheds
}
#endif
`;
export function sailMaterial() {
  return cached('ships-sail', () => {
    const m = proceduralMaterial({
      name: 'shipSail',
      params: { color: 0xffffff, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide },
      head: SAIL_HEAD,
      vertexHead: 'attribute vec4 aSail;\nattribute vec2 aSailSize;\nvarying vec4 vSail;\nvarying vec2 vSailSize;',
      vertexPre: 'vSail = aSail; vSailSize = aSailSize;',
      color: SAIL_COLOR,
      emissive: SAIL_EMISSIVE,
    });
    m.userData.sunken = 'none';
    return m;
  });
}

// foam decal for the fallback wakes (used only if the water module offers no wake API)
export function wakeFoamMaterial() {
  return cached('ships-wake', () => {
    const m = proceduralMaterial({
      name: 'shipWakeFoam',
      params: { color: 0xffffff, roughness: 0.85, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 },
      head: 'varying vec4 vWk;\n',
      vertexHead: 'attribute vec4 aWk;\nvarying vec4 vWk;',
      vertexPre: 'vWk = aWk;',
      // aWk = (across −1..1, along t 0 (bow) … 1 (tail), strength, kind 0 = V wake / 1 = bow churn)
      color: /* glsl */ `
        float a = vWk.x, t = vWk.y, st = vWk.z;
        float n1 = cgVfbm2(cgP.xz * vec2(0.9, 0.9), 4);
        float n2 = cgVnoise2(cgP.xz * 3.5);
        float alpha;
        if (vWk.w < 0.5) {
          float edge = exp(-pow((1.0 - abs(a)) / (0.10 + 0.25 * t), 2.0));
          float centre = exp(-pow(a / (0.16 + 0.3 * t), 2.0)) * smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.1, 0.8, t));
          alpha = (0.85 * edge + 0.8 * centre) * pow(1.0 - t, 1.4);
        } else {
          alpha = exp(-pow(a / 0.75, 2.0)) * (1.0 - smoothstep(0.2, 1.0, t)) * 1.2;
        }
        alpha *= smoothstep(0.25, 0.75, n1 * 0.7 + n2 * 0.45 + 0.15);
        alpha = clamp(alpha * st, 0.0, 0.95);
        diffuseColor.rgb = vec3(0.80, 0.84, 0.84);
        diffuseColor.a = alpha;`,
    });
    m.userData.sunken = 'none';
    return m;
  });
}
