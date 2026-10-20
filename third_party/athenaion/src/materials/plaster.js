// Lime-plaster facade material for the town houses (owned by the city module).
//
// Walls carry two custom attributes (see src/city/house.js):
//   aFac = (u, v, wallLength, wallHeight)   u: metres along the wall (left→right seen from outside,
//                                            i.e. along cross(up, N)), v: metres above the floor line
//   aSty = (seed, storeyHeight, style, flags)
//            style  = windowType (0..7) + 8 * groundType (0..3)
//              windowType: 0 rect, 1 arched, 2 rect+stone frame, 3 small square, 4 paired arched,
//                          5 tall rect (piano nobile), 6 rect + shutters, 7 arched + frame
//              groundType: 0 plain (door + small windows), 1 arcade (deep arches), 2 shop fronts,
//                          3 blank base (stone faced)
//            flags bitmask: 1 blank wall, 2 door(s) on this wall, 4 corner quoins, 8 storey bands,
//                           16 shutters, 32 gable triangle, 64 stone-faced ground floor, 128 frieze band
// Openings are NOT geometry: they are ray-marched recesses (parallax) with real reveal normals,
// sun-occlusion inside the recess and dark interiors, so thousands of houses cost no extra triangles.
import * as THREE from 'three';
import { proceduralMaterial, cached } from '../core/materials.js';

const HEAD = /* glsl */ `
varying vec4 vFac;
varying vec4 vSty;
vec3 cityRecN = vec3(0.0);   // reveal normal (world) when inside an opening, else 0
float cityRecSh = 0.0;       // 1 = reveal/back is in sun shadow
float cityRecAO = 1.0;

// plaster palette (linear albedo), picked per house
vec3 cityPlaster(float s){
  float k = fract(s * 7.13);
  vec3 c;
  if (k < 0.18) c = vec3(0.74, 0.70, 0.60);        // lime white (warm)
  else if (k < 0.40) c = vec3(0.73, 0.64, 0.48);   // cream
  else if (k < 0.54) c = vec3(0.72, 0.62, 0.46);   // warm ochre (muted: refs read white/cream)
  else if (k < 0.65) c = vec3(0.72, 0.57, 0.45);   // pale peach
  else if (k < 0.79) c = vec3(0.68, 0.61, 0.49);   // sand
  else if (k < 0.87) c = vec3(0.64, 0.60, 0.53);   // grey-beige
  else if (k < 0.95) c = vec3(0.74, 0.66, 0.47);   // soft yellow
  else c = vec3(0.70, 0.57, 0.47);                 // terracotta pink
  float j = fract(s * 31.7);
  c *= 0.8 + 0.24 * j;
  return c;
}
vec3 cityShutter(float s){
  float k = fract(s * 13.37);
  if (k < 0.3) return vec3(0.10, 0.16, 0.11);   // faded green
  if (k < 0.55) return vec3(0.09, 0.13, 0.18);  // blue-grey
  if (k < 0.8) return vec3(0.16, 0.09, 0.05);   // brown
  return vec3(0.20, 0.14, 0.09);                // natural wood
}
// opening mask: returns signed-ish inside test with AA width w. (x centred, y from bottom)
float cityOpening(vec2 q, float hw, float h, float arch, float w){
  float r = (arch > 0.5) ? hw : 0.0;
  float ix = smoothstep(hw + w, hw - w, abs(q.x));
  float iy = smoothstep(-w, w, q.y) * smoothstep(h + w, h - w, q.y);
  float m = ix * iy;
  if (arch > 0.5 && q.y > h - r) {
    float d = length(vec2(q.x, q.y - (h - r))) - r;
    m = smoothstep(w, -w, d) * smoothstep(-w, w, q.y);
  }
  return m;
}
`;

const VERT_HEAD = /* glsl */ `
attribute vec4 aFac;
attribute vec4 aSty;
varying vec4 vFac;
varying vec4 vSty;
`;

const COLOR = /* glsl */ `
float u = vFac.x, v = vFac.y, wlen = vFac.z, wh = vFac.w;
float seed = vSty.x, stH = max(vSty.y, 2.4);
int style = int(vSty.z + 0.5);
int flags = int(vSty.w + 0.5);
int winT = style - (style / 8) * 8;
int grT = style / 8;
float hs = seed * 97.13;

// ---- base plaster colour + large-scale mottling / weathering
vec3 base = cityPlaster(seed);
float age = fract(seed * 5.71);
float mott = cgVfbm2(vec2(u, v) * vec2(0.35, 0.45) + hs, 4);
float fine = cgVnoise2(vec2(u, v) * 6.0 + hs);
float stain = cgVfbm2(vec2(u * 0.9, v * 0.35) + hs * 2.3, 3);
float big = cgVfbm2(vec2(u, v) * 0.12 + hs * 0.3, 3);
vec3 col = base * (0.80 + 0.30 * mott + 0.05 * fine) * (0.9 + 0.2 * big);
col = mix(col, col * vec3(0.86, 0.84, 0.80), smoothstep(0.5, 0.8, stain) * (0.4 + 0.6 * age));
// sun-bleached top, damp darker base (rising damp + splash)
float damp = smoothstep(1.1 + 0.6 * mott, 0.0, v) * (1.0 - step(0.5, float(flags & 32)));
col = mix(col, col * vec3(0.62, 0.62, 0.55), damp * (0.45 + 0.35 * age));
// vertical grime streaks from the eave
float streak = cgVnoise2(vec2(u * 2.3 + hs, v * 0.08));
float fromTop = smoothstep(wh - 3.0 - 2.0 * streak, wh, v);
col *= 1.0 - 0.22 * age * fromTop * smoothstep(0.45, 0.85, streak);
// spalled plaster patches revealing rubble stone
// (rare, small, near the ground and corners where plaster fails first)
float sp = cgVfbm2(vec2(u, v) * vec2(1.6, 2.0) + hs * 1.7, 4) + 0.12 * smoothstep(1.8, 0.0, v) + 0.06 * smoothstep(1.2, 0.0, min(u, wlen - u));
float spTh = 0.8 - 0.05 * age;
float spall = smoothstep(spTh, spTh + 0.015, sp) * step(0.6, age);
col *= 1.0 - 0.12 * smoothstep(spTh - 0.04, spTh, sp) * step(0.6, age) * (1.0 - spall);
vec3 rubble = vec3(0.47, 0.40, 0.31) * (0.7 + 0.45 * cgVnoise2(vec2(u, v) * 6.0)) * (0.85 + 0.3 * step(0.5, fract(cgVnoise2(vec2(u * 3.0, v * 4.0)) * 3.0)));
// fine cracks
float crk = abs(cgSnoise(vec3(u * 0.7, v * 0.9, hs)));
float crack = (1.0 - smoothstep(0.0, 0.025, crk)) * smoothstep(0.55, 0.8, cgVnoise2(vec2(u, v) * 0.3 + hs)) * age;
col *= 1.0 - 0.35 * crack;

float aa = max(fwidth(u), fwidth(v)) * 0.8 + 0.004;

// ---- corner quoins (alternating long/short stone blocks)
if ((flags & 4) != 0) {
  float cu = min(u, wlen - u);
  float course = floor(v / 0.42);
  float qw = mod(course, 2.0) < 0.5 ? 0.62 : 0.38;
  float inQ = smoothstep(qw + aa, qw - aa, cu) * step(0.0, v);
  float joint = smoothstep(0.0, 0.03, abs(fract(v / 0.42) - 0.0)) * smoothstep(0.0, 0.03, abs(qw - cu));
  vec3 qc = vec3(0.70, 0.66, 0.58) * (0.85 + 0.2 * cgVnoise2(vec2(course, hs)));
  col = mix(col, qc * (0.7 + 0.3 * joint), inQ);
}
// ---- storey bands / stone-faced base
if ((flags & 8) != 0) {
  float fy = mod(v + 0.1, stH) - 0.1;
  float band = smoothstep(-0.12 - aa, -0.12 + aa, fy - 0.0) * smoothstep(0.14 + aa, 0.14 - aa, fy) * step(stH * 0.6, v);
  col = mix(col, base * 1.12 + 0.03, band * 0.8);
}
if ((flags & 64) != 0 || grT == 3) {
  float gb = smoothstep(stH * 0.95 + aa, stH * 0.95 - aa, v);
  float row = floor(v / 0.48);
  float bx = fract(u / 1.3 + 0.5 * mod(row, 2.0));
  float jt = smoothstep(0.0, 0.025, min(bx, 1.0 - bx) * 1.3) * smoothstep(0.0, 0.03, min(fract(v / 0.48), 1.0 - fract(v / 0.48)) * 0.48);
  vec3 sc = vec3(0.62, 0.58, 0.50) * (0.82 + 0.25 * cgHash12(vec2(floor(u / 1.3 + 0.5 * mod(row, 2.0)), row) + hs));
  col = mix(col, sc * (0.55 + 0.45 * jt), gb);
}
if ((flags & 128) != 0) {
  float fb = smoothstep(wh - 0.55 - aa, wh - 0.55 + aa, v) * smoothstep(wh - 0.12 + aa, wh - 0.12 - aa, v);
  vec3 fc = fract(seed * 3.3) < 0.5 ? vec3(0.45, 0.16, 0.09) : base * 0.78;
  col = mix(col, fc, fb * 0.75);
}
col = mix(col, rubble, spall * (1.0 - step(0.5, float(flags & 64))));

// ---- openings
bool blank = (flags & 1) != 0 || (flags & 32) != 0 || wlen < 1.6;
float bayW = 2.7 + 1.1 * fract(seed * 3.77);
float nb = max(1.0, floor(wlen / bayW + 0.35));
float bay = wlen / nb;
float bi = floor(u / bay);
float lx = u - (bi + 0.5) * bay;
float si = floor(v / stH);
float ly = v - si * stH;
float nSt = floor((wh + 0.35) / stH);
float hb = cgHash12(vec2(bi + hs, si * 7.0 + 3.1));

float hw = 0.0, oh = 0.0, sill = 0.0, arch = 0.0, depth = 0.24; int kind = 0; // kind: 0 window, 1 door, 2 arcade, 3 shop
bool has = false;
if (!blank && si < nSt && v >= 0.0 && bay > 1.25) {
  if (si < 0.5) {
    // ground floor
    float doorBay = floor(fract(seed * 11.3) * nb);
    bool isDoor = (flags & 2) != 0 && (abs(bi - doorBay) < 0.5 || (nb > 3.5 && hb < 0.22));
    if (grT == 1) { has = true; kind = 2; hw = min(bay * 0.36, 1.5); oh = min(stH - 0.35, 2.2 + hw); sill = 0.0; arch = 1.0; depth = 1.6; }
    else if (grT == 2) { has = hb > 0.12; kind = 3; hw = min(bay * 0.38, 1.4); oh = 2.3; sill = 0.0; arch = step(0.6, fract(seed * 4.1)); depth = 0.5; }
    else if (grT == 3) { has = isDoor; kind = 1; hw = 0.62; oh = 2.3; sill = 0.0; arch = step(0.5, fract(seed * 9.1)); depth = 0.45; }
    else if (isDoor) { has = true; kind = 1; hw = 0.55 + 0.15 * fract(seed * 2.9); oh = 2.15 + 0.35 * fract(seed * 6.1); sill = 0.0; arch = step(0.55, fract(seed * 8.7)); depth = 0.4; }
    else { has = hb > 0.25; kind = 0; hw = 0.32 + 0.12 * fract(seed * 5.3); oh = 0.9 + 0.3 * fract(seed * 1.9); sill = 1.35; arch = step(0.75, fract(seed * 2.3)); }
  } else {
    has = hb > 0.1 + 0.15 * age;
    hw = 0.40 + 0.18 * fract(seed * 4.9);
    oh = 1.3 + 0.55 * fract(seed * 7.7);
    sill = 0.85;
    if (winT == 1 || winT == 4 || winT == 7) arch = 1.0;
    if (winT == 3 || (si > nSt - 1.5 && nSt > 2.5)) { hw = 0.3; oh = 0.65; sill = 1.2; arch = 0.0; }
    if (winT == 5 && si < 1.5) { oh = min(stH - 1.2, 2.2); sill = 0.7; }
    if (winT == 4) hw = min(bay * 0.36, 0.85);
    if ((flags & 256) != 0 && si > nSt - 1.5) { has = true; kind = 2; hw = min(bay * 0.42, 1.45); sill = 0.95; oh = stH - 1.3; arch = step(0.45, fract(seed * 6.3)); depth = 2.2; }
  }
  oh = min(oh, stH - sill - 0.35);
  hw = min(hw, bay * (kind == 2 ? 0.45 : 0.42));
}

float inside = 0.0;
vec2 q = vec2(lx, ly - sill);
if (has) inside = cityOpening(q, hw, oh, arch, aa);

// stone frame / sill / shutters around windows
if (has && kind == 0) {
  bool framed = (winT == 2 || winT == 7 || winT == 5);
  if (framed) {
    float fr = cityOpening(q + vec2(0.0, 0.14), hw + 0.14, oh + 0.28, arch, aa) - inside;
    col = mix(col, vec3(0.74, 0.70, 0.62) * (0.9 + 0.15 * fine), clamp(fr, 0.0, 1.0));
  }
  // projecting sill
  float sl = smoothstep(hw + 0.12 + aa, hw + 0.12 - aa, abs(q.x)) * smoothstep(-0.12 - aa, -0.12 + aa, q.y) * smoothstep(0.0 + aa, 0.0 - aa, q.y);
  col = mix(col, vec3(0.70, 0.67, 0.60), sl * 0.85);
  // drip stain below the sill
  float drip = smoothstep(hw * 0.9, 0.0, abs(q.x)) * smoothstep(-1.6, -0.1, q.y) * step(q.y, -0.1);
  col *= 1.0 - 0.18 * drip * (0.4 + age) * (0.6 + 0.4 * streak);
  // open shutters on both sides
  if ((flags & 16) != 0 || winT == 6) {
    float sx = abs(q.x) - hw - 0.03;
    float sh = smoothstep(-aa, aa, sx) * smoothstep(hw + aa, hw - aa, sx) * smoothstep(-aa, aa, q.y) * smoothstep(oh + aa, oh - aa, q.y);
    if (arch > 0.5) sh *= smoothstep(oh - hw + aa, oh - hw - aa, q.y);
    float slat = 0.75 + 0.25 * smoothstep(0.3, 0.7, fract(q.y * 9.0));
    vec3 shc = cityShutter(seed + bi * 0.013) * slat * (0.8 + 0.4 * cgHash12(vec2(bi, si) + hs));
    col = mix(col, shc, sh * step(0.3, fract(seed * 17.0 + bi * 0.37 + si * 0.61)));
  }
}
if (has && kind == 1) {
  float fr = cityOpening(q + vec2(0.0, 0.0), hw + 0.16, oh + 0.16, arch, aa) - inside;
  col = mix(col, vec3(0.72, 0.68, 0.60) * (0.88 + 0.15 * fine), clamp(fr, 0.0, 1.0) * 0.9);
}
// loggia balustrade (below the open gallery)
if (has && kind == 2 && sill > 0.5) {
  float inB = smoothstep(hw + aa, hw - aa, abs(q.x)) * smoothstep(-0.95 - aa, -0.95 + aa, q.y) * smoothstep(0.0 + aa, -0.0 - aa, q.y);
  float bal = smoothstep(0.25, 0.45, abs(fract(q.x / 0.17) - 0.5)) * smoothstep(-0.85, -0.75, q.y) * smoothstep(-0.12, -0.2, q.y);
  vec3 bc = vec3(0.72, 0.68, 0.60) * (0.9 + 0.1 * fine);
  col = mix(col, mix(bc, vec3(0.05, 0.045, 0.04), bal * 0.85), inB);
}
// gable oculus vent
if ((flags & 32) != 0 && wh > 1.2) {
  vec2 oc = vec2(u - wlen * 0.5, v - wh * 0.45);
  float ocm = smoothstep(0.32 + aa, 0.32 - aa, length(oc));
  float ocr = smoothstep(0.46 + aa, 0.46 - aa, length(oc)) - ocm;
  col = mix(col, vec3(0.72, 0.69, 0.62), ocr * step(1.6, wh));
  col = mix(col, vec3(0.03, 0.025, 0.02), ocm * step(1.6, wh));
}

// ---- parallax recess inside the opening
cityRecN = vec3(0.0); cityRecSh = 0.0; cityRecAO = 1.0;
if (inside > 0.01) {
  vec3 N = cgN;
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
  vec3 B = vec3(0.0, 1.0, 0.0);
  vec3 Vl = vec3(dot(cgV, T), dot(cgV, B), max(dot(cgV, N), 0.05));
  vec2 dir = -Vl.xy / Vl.z;            // lateral travel per metre of depth (going inward)
  float tHit = depth; int face = 0;    // 0 back, 1 -x reveal (normal +T), 2 +x reveal, 3 bottom (normal +B), 4 top
  float effTop = oh - (arch > 0.5 ? hw * 0.35 : 0.0);
  if (dir.x < -1e-4) { float t = (q.x + hw) / -dir.x; if (t < tHit) { tHit = t; face = 1; } }
  if (dir.x > 1e-4) { float t = (hw - q.x) / dir.x; if (t < tHit) { tHit = t; face = 2; } }
  if (dir.y < -1e-4) { float t = q.y / -dir.y; if (t < tHit) { tHit = t; face = 3; } }
  if (dir.y > 1e-4) { float t = (effTop - q.y) / dir.y; if (t < tHit) { tHit = t; face = 4; } }
  vec2 hp = q + dir * tHit;   // hit point (opening-local), at depth tHit
  vec3 nl = face == 0 ? vec3(0.0, 0.0, 1.0) : face == 1 ? vec3(1.0, 0.0, 0.0) : face == 2 ? vec3(-1.0, 0.0, 0.0) : face == 3 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, -1.0, 0.0);
  vec3 nw = normalize(T * nl.x + B * nl.y + N * nl.z);
  // sun visibility from the hit point through the opening
  vec3 L = vec3(0.4, 0.5, 0.6);
  #ifdef USE_FOG
    L = uSunDir;
  #endif
  vec3 Ll = vec3(dot(L, T), dot(L, B), dot(L, N));
  float lit = 0.0;
  if (Ll.z > 0.02) {
    vec2 ex = hp + Ll.xy / Ll.z * tHit;
    lit = cityOpening(ex, hw, oh, arch, 0.02);
  }
  cityRecSh = 1.0 - lit;
  float dn = tHit / max(depth, 0.01);
  vec3 interior;
  float h2 = cgHash12(vec2(bi * 3.1 + hs, si + 0.5));
  if (kind == 1) {
    // wooden door at the back (some doors open)
    bool open = h2 < 0.25;
    vec3 wood = cityShutter(seed * 1.7 + 0.31) * (0.75 + 0.35 * cgVnoise2(vec2(hp.x * 30.0, hp.y * 1.5)));
    float plank = smoothstep(0.02, 0.06, abs(fract(hp.x / 0.18) - 0.5));
    interior = open ? vec3(0.02, 0.017, 0.014) : wood * (0.7 + 0.3 * plank);
  } else if (kind == 0 && h2 < 0.28 && (flags & 16) != 0) {
    float slat = 0.75 + 0.25 * smoothstep(0.3, 0.7, fract(hp.y * 9.0));
    interior = cityShutter(seed + bi * 0.013) * slat;  // closed shutters
  } else if (kind == 2) {
    // arcade / loggia: shaded plaster back wall with a dark doorway
    float door = step(abs(hp.x), 0.55) * step(hp.y, sill > 0.5 ? 1.25 : 2.1);
    interior = mix(base * 0.62 * (0.85 + 0.15 * fine), vec3(0.025, 0.02, 0.017), door);
  } else if (kind == 3) {
    interior = mix(vec3(0.03, 0.025, 0.02), vec3(0.18, 0.11, 0.06), step(0.6, h2) * smoothstep(0.4, 1.2, hp.y));
  } else {
    interior = vec3(0.022, 0.019, 0.016) * (0.8 + 0.6 * h2);
  }
  vec3 reveal = base * 0.92 * (0.85 + 0.15 * fine);
  if (kind == 0 && (winT == 2 || winT == 7 || winT == 5)) reveal = vec3(0.70, 0.66, 0.58);
  vec3 rc = face == 0 ? interior : reveal * mix(1.0, 0.55, dn);
  // far away the opening is a few pixels: read it as a dark hole (no lit reveals → no fireflies)
  float farF = smoothstep(0.035, 0.09, aa);
  rc = mix(rc, mix(interior, reveal * 0.35, 0.25), farF);
  cityRecAO = mix(face == 0 ? 0.35 : mix(1.0, 0.45, dn), 0.4, farF);
  cityRecN = farF > 0.5 ? vec3(0.0) : nw;
  col = mix(col, rc, inside);
}
diffuseColor.rgb = col;
`;

const ROUGH = /* glsl */ `
roughnessFactor = 0.93;
`;

const NORMAL = /* glsl */ `
float u2 = vFac.x, v2 = vFac.y;
// fine plaster relief
// hand-trowelled lime: broad undulation + fine grain (simplex: smooth gradients, no grid artefacts)
float fwr = max(fwidth(u2), fwidth(v2));
float relief = 1.0 - smoothstep(0.02, 0.12, fwr);
float e = 0.025;
vec3 sp3 = vec3(u2, v2, vSty.x * 61.0);
float h0 = 0.55 * cgSnoise(sp3 * vec3(0.9, 0.9, 1.0)) + 0.25 * cgSnoise(sp3 * vec3(3.1, 3.1, 1.0)) + 0.08 * cgSnoise(sp3 * vec3(11.0, 11.0, 1.0));
float hx = 0.55 * cgSnoise((sp3 + vec3(e, 0.0, 0.0)) * vec3(0.9, 0.9, 1.0)) + 0.25 * cgSnoise((sp3 + vec3(e, 0.0, 0.0)) * vec3(3.1, 3.1, 1.0)) + 0.08 * cgSnoise((sp3 + vec3(e, 0.0, 0.0)) * vec3(11.0, 11.0, 1.0));
float hy = 0.55 * cgSnoise((sp3 + vec3(0.0, e, 0.0)) * vec3(0.9, 0.9, 1.0)) + 0.25 * cgSnoise((sp3 + vec3(0.0, e, 0.0)) * vec3(3.1, 3.1, 1.0)) + 0.08 * cgSnoise((sp3 + vec3(0.0, e, 0.0)) * vec3(11.0, 11.0, 1.0));
vec3 N0 = cgN;
vec3 T0 = normalize(cross(vec3(0.0, 1.0, 0.0), N0));
cgBump = (T0 * (h0 - hx) + vec3(0.0, 1.0, 0.0) * (h0 - hy)) / e * 0.03 * relief;
if (length(cityRecN) > 0.5) {
  vec3 nr = cityRecN;
  if (cityRecSh > 0.5) {
    vec3 L = vec3(0.4, 0.5, 0.6);
    #ifdef USE_FOG
      L = uSunDir;
    #endif
    // remove the sun-facing component so the shadowed reveal receives no direct light
    nr = normalize(nr - L * max(0.0, dot(nr, L)) * 1.05 - L * 0.08);
  }
  cgBump = nr - cgN;
}
`;

const AO = /* glsl */ `
float topAO = 1.0 - 0.35 * smoothstep(vFac.w - 0.9, vFac.w, vFac.y) * (1.0 - step(0.5, float(int(vSty.w + 0.5) & 32)));
float botAO = 0.7 + 0.3 * smoothstep(0.0, 0.8, vFac.y);
cgAO = topAO * botAO * cityRecAO;
`;

export function plasterMaterial() {
  return cached('city-plaster', () => {
    const m = proceduralMaterial({
      name: 'cityPlaster',
      params: { color: 0xffffff, roughness: 0.93, metalness: 0.0 },
      head: HEAD,
      vertexHead: VERT_HEAD,
      vertexPre: 'vFac = aFac; vSty = aSty;',
      color: COLOR,
      roughness: ROUGH,
      normal: NORMAL,
      ao: AO,
    });
    return m;
  });
}

export const PLASTER_ATTRS = { aFac: 4, aSty: 4 };

/** style helpers for the generator */
export const WIN = { RECT: 0, ARCH: 1, FRAMED: 2, SMALL: 3, PAIRED: 4, TALL: 5, SHUTTER: 6, ARCH_FRAMED: 7 };
export const GROUND = { PLAIN: 0, ARCADE: 1, SHOP: 2, BLANK: 3 };
export const FLAG = { BLANK: 1, DOOR: 2, QUOINS: 4, BANDS: 8, SHUTTERS: 16, GABLE: 32, STONEBASE: 64, FRIEZE: 128, LOGGIA: 256 };
