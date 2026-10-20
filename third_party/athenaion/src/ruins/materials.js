// Weathered marble / limestone for the ruins terrace and the fallen head.
// All detail is procedural in world space: veins, sugary erosion, pits, crack networks, grime in
// crevices (optional baked `cav` vertex attribute), black + ochre lichen, moss on up-facing surfaces,
// rain streaks on vertical faces. Albedos stay physically plausible (lit marble ≈ 0.62–0.72 linear).
import * as THREE from 'three';
import { proceduralMaterial, cached } from '../core/materials.js';

const COMMON = /* glsl */ `
uniform vec3 uBase;
uniform vec4 uWear;     // x lichen, y moss, z pits, w grime
uniform vec4 uTune;     // x crack amount, y vein amount, z streaks, w bump strength
uniform vec4 uWear2;    // x weathering crust (grey-black biofilm patches), y ochre staining, z fresh chipped arrises, w crust frequency scale
uniform float uSeedOff;
#ifdef RN_CAV
varying float vCav;
varying float vEdge;
#endif
#ifdef RN_HEAD
varying float vSky;   // baked sky visibility from above (giant head, aux.z)
varying float vHair;  // 1 cap hair, 2 wreath locks (aux.w)
uniform vec4 uHead;  // x lichen dots, y grime, z sky darkening, w dot scale
uniform vec4 uHeadB; // x -, y colony cover offset, z sky AO floor, w -
#endif
#ifdef RN_INSC
uniform vec4 uInscA; // xyz = column axis origin (world), w = radius
uniform vec4 uInscB; // xyz = column axis dir (world, unit), w = rotation (rad) of the text centre
uniform vec4 uInscC; // xyz = reference "front" direction (world, unit, perpendicular to axis), w = letter height
#endif
// voronoi with cell id: x F1, y F2, z id
vec3 rnVoro3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = cgHash33(i + g);
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = cgHash13(i + g + 17.3); } else if (d < d2) { d2 = d; }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
// carved-surface height (metres-ish units, negative = carved in)
float rnHeight(vec3 P, out float crack, out float pit){
  // sugary erosion
  float h = 0.0018 * cgSnoise(P * 9.0) + 0.0011 * cgSnoise(P * 23.0) + 0.0008 * cgSnoise(P * 61.0) + 0.0005 * cgSnoise(P * 150.0); // granular, sugary limestone
  // larger soft undulation
  h += 0.004 * cgSnoise(P * 2.3);
  // pits (dissolution holes): many small, a few larger
  vec3 v = rnVoro3(P * 26.0 + uSeedOff);
  float pr = 0.1 + 0.26 * pow(fract(v.z * 7.13), 3.0);
  pit = smoothstep(pr, pr * 0.35, v.x) * step(0.45 - 0.35 * uWear.z, fract(v.z * 3.71));
  vec3 v2 = rnVoro3(P * 70.0 + 3.7);
  float pit2 = smoothstep(0.22, 0.06, v2.x) * step(0.6 - 0.4 * uWear.z, v2.z);
  h -= uWear.z * (0.0035 * pit + 0.0012 * pit2);
  pit = max(pit * uWear.z, pit2 * uWear.z * 0.6);
  // crack network: voronoi edges, only where a mask allows (cracks wander)
  vec3 c = rnVoro3(P * vec3(1.5, 1.1, 1.5) + vec3(cgSnoise(P * 1.3) * 0.08) + 11.0);
  float e = c.y - c.x + 0.012 * cgSnoise(P * 40.0);
  float mt = 0.66 - 0.16 * clamp(uTune.x - 0.5, 0.0, 1.0);
  float mask = smoothstep(mt, mt + 0.12, cgSnoise(P * 0.55 + 5.0) * 0.5 + 0.5) * smoothstep(0.2, 0.5, cgSnoise(P * 2.7 + 1.0) * 0.5 + 0.5);
  float w = 0.035 + 0.02 * cgSnoise(P * 6.0);
  crack = (1.0 - smoothstep(0.0, w, e)) * mask * min(uTune.x, 1.0);
  // hairline secondary cracks
  vec3 c2 = rnVoro3(P * 4.2 + 31.0);
  float e2 = c2.y - c2.x + 0.01 * cgSnoise(P * 60.0);
  float crack2 = (1.0 - smoothstep(0.0, 0.03, e2)) * smoothstep(0.55, 0.7, cgSnoise(P * 2.1 + 9.0) * 0.5 + 0.5) * uTune.x;
  crack = max(crack, crack2 * 0.3);
  h -= 0.006 * crack;
  return h;
}
#ifdef RN_INSC
// Distance (in letter units, letter height = 1) to the strokes of "ΠΑΝΤΑ" (line 0) and "ΡΕΙ" (line 1)
float rnSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float rnGlyph(int g, vec2 p){
  float d = 9.0;
  // glyph box: x 0..0.72, y 0..1
  if (g == 0) { // Π
    d = min(d, rnSeg(p, vec2(0.05, 0.0), vec2(0.05, 1.0))); d = min(d, rnSeg(p, vec2(0.67, 0.0), vec2(0.67, 1.0)));
    d = min(d, rnSeg(p, vec2(-0.02, 1.0), vec2(0.74, 1.0)));
  } else if (g == 1) { // Α
    d = min(d, rnSeg(p, vec2(0.0, 0.0), vec2(0.36, 1.0))); d = min(d, rnSeg(p, vec2(0.72, 0.0), vec2(0.36, 1.0)));
    d = min(d, rnSeg(p, vec2(0.15, 0.36), vec2(0.57, 0.36)));
  } else if (g == 2) { // Ν
    d = min(d, rnSeg(p, vec2(0.05, 0.0), vec2(0.05, 1.0))); d = min(d, rnSeg(p, vec2(0.67, 0.0), vec2(0.67, 1.0)));
    d = min(d, rnSeg(p, vec2(0.05, 1.0), vec2(0.67, 0.0)));
  } else if (g == 3) { // Τ
    d = min(d, rnSeg(p, vec2(0.36, 0.0), vec2(0.36, 1.0))); d = min(d, rnSeg(p, vec2(0.0, 1.0), vec2(0.72, 1.0)));
  } else if (g == 4) { // Ρ
    d = min(d, rnSeg(p, vec2(0.08, 0.0), vec2(0.08, 1.0)));
    d = min(d, rnSeg(p, vec2(0.08, 1.0), vec2(0.40, 1.0))); d = min(d, rnSeg(p, vec2(0.08, 0.48), vec2(0.40, 0.48)));
    vec2 q = p - vec2(0.40, 0.74); float ring = abs(length(q) - 0.26); if (q.x > 0.0) d = min(d, ring);
  } else if (g == 5) { // Ε
    d = min(d, rnSeg(p, vec2(0.08, 0.0), vec2(0.08, 1.0))); d = min(d, rnSeg(p, vec2(0.08, 1.0), vec2(0.62, 1.0)));
    d = min(d, rnSeg(p, vec2(0.08, 0.5), vec2(0.52, 0.5))); d = min(d, rnSeg(p, vec2(0.08, 0.0), vec2(0.64, 0.0)));
  } else if (g == 6) { // Ι
    d = min(d, rnSeg(p, vec2(0.15, 0.0), vec2(0.15, 1.0)));
  }
  return d;
}
float rnInscription(vec2 uv){ // uv: x across (letter units, centred), y up (line 0 baseline at 0)
  float d = 9.0;
  // line 0: Π Α Ν Τ Α  (advance 0.95)
  vec2 p0 = uv - vec2(-2.35, 0.0);
  for (int i = 0; i < 5; i++) {
    int g = i == 0 ? 0 : i == 1 ? 1 : i == 2 ? 2 : i == 3 ? 3 : 1;
    d = min(d, rnGlyph(g, p0 - vec2(float(i) * 0.95, 0.0)));
  }
  // line 1: Ρ Ε Ι
  vec2 p1 = uv - vec2(-1.05, -1.45);
  d = min(d, rnGlyph(4, p1));
  d = min(d, rnGlyph(5, p1 - vec2(0.85, 0.0)));
  d = min(d, rnGlyph(6, p1 - vec2(1.6, 0.0)));
  return d;
}
#endif
`;

const COLOR = /* glsl */ `
  vec3 P = cgP;
  float crack, pit;
  float hgt = rnHeight(P, crack, pit);
  float lf = cgSnoise(P * 0.31 + uSeedOff);
  float mf = cgSnoise(P * 1.7 + uSeedOff * 1.3);
  vec3 base = uBase * (0.93 + 0.09 * lf + 0.04 * mf);
  // warm / grey clouding
  base = mix(base, base * vec3(1.03, 0.97, 0.86), smoothstep(0.1, 0.8, mf) * 0.45);
  base = mix(base, base * vec3(0.90, 0.92, 0.95), smoothstep(0.2, 0.9, -lf) * 0.35);
  // veins
  float vn = abs(cgSnoise(P * vec3(0.7, 1.9, 0.7) + vec3(cgSnoise(P * 2.0) * 0.6)));
  base *= 1.0 - uTune.y * 0.22 * (1.0 - smoothstep(0.0, 0.05, vn));
  float cav = 1.0, edgeW = 0.0;
  #ifdef RN_CAV
    cav = vCav; edgeW = vEdge;
  #endif
  float up = clamp(cgN.y, -1.0, 1.0);
  // mid-frequency weathering: grey-black biofilm crust in broad patches (0.3-3 m), ochre iron staining,
  // lighter "fresh" stone on chipped convex arrises
  // domain-warped, fairly crisp-edged colonies (≈ 40 % cover at crust = 1)
  vec3 Pw = P * uWear2.w;
  vec3 wq = vec3(cgSnoise(Pw * 0.9 + 1.0), cgSnoise(Pw * 0.9 + 5.0), cgSnoise(Pw * 0.9 + 9.0)) * 0.6;
  float wn = cgSnoise(Pw * 0.42 + wq + uSeedOff * 0.7) * 0.6 + cgSnoise(Pw * 1.35 + wq * 1.5 + 4.1) * 0.28 + cgSnoise(Pw * 4.6 + 1.3) * 0.12;
  float crust = smoothstep(0.02, 0.28, wn) * uWear2.x;
  float crustTone = cgSnoise(P * 2.9 + 8.0) * 0.5 + 0.5;
  base = mix(base, base * mix(vec3(0.27, 0.26, 0.24), vec3(0.56, 0.53, 0.47), crustTone), clamp(crust, 0.0, 1.0) * 0.88);
  float oc = smoothstep(0.42, 0.85, cgSnoise(P * 0.75 + 17.0) * 0.5 + 0.5 + 0.22 * cgSnoise(P * 3.1 + 2.0));
  base = mix(base, base * vec3(1.02, 0.88, 0.70), oc * uWear2.y);
  base = mix(base, uBase * vec3(1.18, 1.15, 1.08), clamp(edgeW * 1.4 - 0.25, 0.0, 1.0) * uWear2.z * (1.0 - 0.6 * crust));
  // grime: crevices, undersides, pits & cracks
  float grime = (1.0 - smoothstep(0.35, 0.95, cav)) * uWear.w;
  grime = max(grime, smoothstep(0.0, -0.8, up) * 0.35 * uWear.w);
  vec3 dirt = vec3(0.30, 0.27, 0.21);
  base = mix(base, base * dirt * 1.05, clamp(grime, 0.0, 1.0) * 0.9);
  // rain streaks on vertical faces
  float vert = 1.0 - abs(up);
  float streak = smoothstep(0.35, 0.9, cgSnoise(vec3(P.x * 3.1 + P.z * 2.3, P.y * 0.25, P.z * 3.1 - P.x * 1.7) + 4.0) * 0.5 + 0.5);
  base *= 1.0 - uTune.z * 0.3 * streak * vert;
  float drip = smoothstep(0.55, 0.95, cgSnoise(vec3(P.x * 11.0 + P.z * 7.0, P.y * 0.6, P.z * 11.0 - P.x * 5.0) + 9.0) * 0.5 + 0.5);
  base = mix(base, base * vec3(0.55, 0.53, 0.48), uTune.z * 0.45 * drip * vert * smoothstep(0.3, 0.7, cgSnoise(P * 0.7 + 2.0) * 0.5 + 0.5));
  // granular albedo (ref 8/9 limestone reads coarse and speckled up close)
  float gran = cgSnoise(P * 95.0) * 0.6 + cgSnoise(P * 210.0) * 0.4;
  base *= 0.9 + 0.14 * gran;
  // pits read darker (shadowed holes with dirt)
  base *= 1.0 - 0.72 * pit;
  base *= 1.0 - 0.82 * crack;
  #ifdef RN_HEAD
  {
    // ref 8 (r6, tunable via uHead/uHeadB): black lichen as dense dot fields with merged crust cores
    // inside irregular colonies + sparse scattered dots, textured grey-brown grime that follows the
    // hollows and the sky-shaded side (grainy, never a soft shadow-like blotch), a few ochre crusts
    float ss = uHead.w;
    float col = cgSnoise(P * 1.1 + 31.0) * 0.55 + cgSnoise(P * 3.4 + 7.0) * 0.3 + cgSnoise(P * 9.0 + 3.0) * 0.15;
    float colony = smoothstep(0.02 + uHeadB.y, 0.22 + uHeadB.y, col + (1.0 - vSky) * 0.12);
    float sp = cgSnoise(P * 55.0 * ss + 5.0) * 0.65 + cgSnoise(P * 140.0 * ss) * 0.35;
    float speck = smoothstep(0.16, 0.34, sp) * colony;
    float core = smoothstep(0.3, 0.5, col * uHeadB.x + 0.22 * cgSnoise(P * 18.0 + 2.0)) * smoothstep(-0.25, 0.15, sp);
    float sp2 = cgSnoise(P * 28.0 * ss + 9.0) + 0.3 * cgSnoise(P * 90.0);
    float speck2 = smoothstep(0.5, 0.68, sp2) * smoothstep(-0.25, 0.05, col);
    float lich = clamp(max(speck, core) + speck2 * 0.85, 0.0, 1.0) * uHead.x * (vHair > 0.5 && vHair < 2.5 ? 0.45 : 1.0);   // the locks stay paler (ref 8)
    float eyeball = smoothstep(2.0, 2.9, vHair);   // blank eyeball: clean, polished, slightly brighter (ref 8)
    lich *= 1.0 - 0.85 * eyeball;
    base = mix(base, vec3(0.032, 0.031, 0.027), lich * 0.9);
    float gn = cgSnoise(P * 0.8 + 11.0) * 0.5 + cgSnoise(P * 2.6 + 4.0) * 0.3 + cgSnoise(P * 12.0 + 1.0) * 0.2;
    float bl = smoothstep(0.25, 0.6, gn + (1.0 - vSky) * 0.3 + (1.0 - cav) * 0.5) * (0.55 + 0.45 * smoothstep(-0.35, 0.45, cgSnoise(P * 38.0 + 6.0)));
    base = mix(base, base * vec3(0.46, 0.42, 0.35), bl * uHead.y * (1.0 - 0.75 * eyeball));
    base *= 1.0 + 0.1 * eyeball;
    float ocr = smoothstep(0.45, 0.7, cgSnoise(P * 1.6 + 23.0) * 0.6 + cgSnoise(P * 6.0 + 2.0) * 0.4) * (1.0 - colony * 0.5);
    base = mix(base, base * vec3(1.0, 0.86, 0.62), ocr * 0.45);
  }
  #else
  // lichen: black-grey speckles in clusters + ochre/yellow crust + pale grey rosettes
  float cl = smoothstep(-0.3, 0.4, cgSnoise(P * 0.85 + 7.0) * 0.7 + cgSnoise(P * 3.3) * 0.3);
  // irregular lichen thalli: domain-warped cells with ragged edges (no polka dots)
  vec3 lwp = vec3(cgSnoise(P * 7.0 + 1.0), cgSnoise(P * 7.0 + 4.0), cgSnoise(P * 7.0 + 8.0)) * 0.45;
  vec3 lv = rnVoro3(P * 22.0 + lwp + uSeedOff);
  float lr = 0.1 + 0.3 * fract(lv.z * 5.31) * cl;
  float rag = 0.09 * cgSnoise(P * 60.0) + 0.06 * cgSnoise(P * 140.0);
  float spot = smoothstep(lr, lr * 0.7, lv.x + rag) * step(0.93 - cl * 0.7, fract(lv.z * 9.7)) * uWear.x;
  vec3 lv2 = rnVoro3(P * 63.0 + lwp * 2.0 + 2.0);
  float spot2 = smoothstep(0.26, 0.12, lv2.x + 0.08 * cgSnoise(P * 150.0)) * step(0.9 - cl * 0.55, lv2.z) * uWear.x;
  float kind = fract(lv.z * 13.17);
  vec3 lcol = kind < 0.62 ? vec3(0.045, 0.045, 0.04) : kind < 0.86 ? vec3(0.38, 0.30, 0.12) : vec3(0.52, 0.52, 0.47);
  base = mix(base, lcol, clamp(spot, 0.0, 1.0) * 0.92);
  base = mix(base, vec3(0.05, 0.05, 0.045), clamp(spot2, 0.0, 1.0) * 0.8);
  float blot = smoothstep(0.55, 0.8, cgSnoise(P * 2.2 + 13.0) * 0.6 + cgSnoise(P * 7.5 + 2.0) * 0.4 + cl * 0.25) * uWear.x;
  base = mix(base, base * vec3(0.32, 0.31, 0.27), clamp(blot, 0.0, 1.0) * 0.75);
  #endif
  // diffuse grey-green algae film on exposed / damp parts
  float film = smoothstep(0.1, 0.7, cgSnoise(P * 0.6 + 21.0) * 0.5 + 0.5 - cav * 0.3) * uWear.y;
  base = mix(base, base * vec3(0.72, 0.74, 0.62), film * 0.5);
  // moss: up-facing + crevices, patchy
  float mm = smoothstep(0.15, 0.75, up) * 0.6 + (1.0 - cav) * 0.7;
  float mn = cgSnoise(P * 1.9 + 3.0) * 0.5 + 0.5 + 0.25 * cgSnoise(P * 9.0);
  float moss = smoothstep(0.62, 0.85, mm * mn + 0.15) * uWear.y;
  vec3 mcol = mix(vec3(0.045, 0.06, 0.015), vec3(0.20, 0.18, 0.05), cgSnoise(P * 7.0) * 0.5 + 0.5);
  base = mix(base, mcol, clamp(moss, 0.0, 1.0));
  #ifdef RN_INSC
  {
    vec3 rel = cgP - uInscA.xyz;
    float along = dot(rel, uInscB.xyz);
    vec3 radial = rel - uInscB.xyz * along;
    vec3 fr = uInscC.xyz, sd = cross(uInscB.xyz, fr);
    float ang = atan(dot(radial, sd), dot(radial, fr)) - uInscB.w;
    vec2 uv = vec2(ang * uInscA.w, along) / uInscC.w;
    float dl = rnInscription(uv);
    float wl = 0.075;
    float cut = 1.0 - smoothstep(wl * 0.6, wl, dl);
    base *= 1.0 - 0.55 * cut;
    base = mix(base, base * vec3(0.8, 0.78, 0.7), cut * 0.5);
  }
  #endif
  // cavity darkening scales with the grime amount (dirt packed into crevices, eye sockets, joints)
  float cavMul = mix(1.0 - 0.8 * clamp(uWear.w, 0.0, 1.2), 1.0, smoothstep(0.2, 1.0, cav));
  #ifdef RN_HEAD
  // top-lit sculpture read: undersides (brow over the eye, under the nose, lips, chin) hold dirt and
  // lose the sky, so they stay dark even under the frontal shot-8 sun
  cavMul *= mix(1.0 - uHead.z, 1.0, smoothstep(0.04, 0.75, vSky));
  #endif
  diffuseColor.rgb = base * cavMul;
`;

const NORMAL = /* glsl */ `
  // finite-difference bump of rnHeight in the tangent plane
  vec3 n = cgN;
  vec3 t1 = normalize(abs(n.y) < 0.95 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  float e = 0.0018;
  float c0, p0;
  float h0 = rnHeight(cgP, c0, p0);
  float ha = rnHeight(cgP + t1 * e, c0, p0);
  float hb = rnHeight(cgP + t2 * e, c0, p0);
  vec3 g = (t1 * (ha - h0) + t2 * (hb - h0)) / e;
  #ifdef RN_INSC
  {
    vec3 rel = cgP - uInscA.xyz;
    float along = dot(rel, uInscB.xyz);
    vec3 radial = rel - uInscB.xyz * along;
    vec3 fr = uInscC.xyz, sd = cross(uInscB.xyz, fr);
    float ang = atan(dot(radial, sd), dot(radial, fr)) - uInscB.w;
    vec2 uv = vec2(ang * uInscA.w, along) / uInscC.w;
    float ee = 0.01;
    float d0 = rnInscription(uv), dx = rnInscription(uv + vec2(ee, 0.0)), dy = rnInscription(uv + vec2(0.0, ee));
    float wl = 0.075;
    // V-groove: depth proportional to (wl - d)
    vec2 gd = vec2(dx - d0, dy - d0) / ee;
    float inside = 1.0 - smoothstep(wl * 0.85, wl, d0);
    vec3 tu = normalize(cross(uInscB.xyz, n)); // across (sign matches -ang)
    g += (tu * gd.x + uInscB.xyz * gd.y) * inside * 0.9;
  }
  #endif
  cgBump = -g * uTune.w;
`;

const ROUGH = /* glsl */ `
  roughnessFactor = clamp(roughnessFactor + 0.08 * cgSnoise(cgP * 3.0), 0.35, 1.0);
`;

/**
 * @param {object} o
 * @param {number[]} [o.base] linear albedo
 * @param {number} [o.lichen=1] [o.moss=0.6] [o.pits=0.6] [o.grime=0.8] [o.cracks=0.6] [o.veins=0.5] [o.streaks=0.6] [o.bump=1]
 * @param {boolean} [o.cav] uses the baked `cav` vertex attribute
 * @param {boolean} [o.inscription] carved ΠΑΝΤΑ ΡΕΙ (set uniforms via setInscription)
 */
export function ruinStoneMaterial(o = {}) {
  const key = JSON.stringify(o);
  return cached('ruinStone:' + key, () => {
    const uniforms = {
      uBase: { value: new THREE.Color(...(o.base || [0.70, 0.66, 0.58])) },
      uWear: { value: new THREE.Vector4(o.lichen ?? 1, o.moss ?? 0.6, o.pits ?? 0.6, o.grime ?? 0.8) },
      uTune: { value: new THREE.Vector4(o.cracks ?? 0.6, o.veins ?? 0.5, o.streaks ?? 0.6, o.bump ?? 1) },
      uWear2: { value: new THREE.Vector4(o.crust ?? 0.8, o.ochre ?? 0.35, o.edges ?? 0.6, o.crustScale ?? 1) },
      uSeedOff: { value: o.seed ?? 0 },
      uHead: { value: new THREE.Vector4(...(o.headWear || [1, 0.85, 0.6, 1])) },
      uHeadB: { value: new THREE.Vector4(...(o.headWearB || [1.6, 0.04, 0.28, 0])) },
      uInscA: { value: new THREE.Vector4(0, 0, 0, 0.5) },
      uInscB: { value: new THREE.Vector4(0, 1, 0, 0) },
      uInscC: { value: new THREE.Vector4(1, 0, 0, 0.2) },
    };
    const defs = (o.cav || o.aux ? '#define RN_CAV\n' : '') + (o.inscription ? '#define RN_INSC\n' : '') + (o.head ? '#define RN_HEAD\n' : '');
    const mat = proceduralMaterial({
      name: 'ruinStone',
      params: { color: 0xffffff, roughness: o.roughness ?? 0.72, metalness: 0 },
      uniforms,
      head: defs + COMMON,
      // geometry without the attribute reads 0 → `cav` meshes must carry it (see ensureCav)
      vertexHead: o.head ? 'attribute float cav; attribute vec4 aux; varying float vCav; varying float vEdge; varying float vSky; varying float vHair;' : o.cav ? 'attribute float cav; attribute vec4 aux; varying float vCav; varying float vEdge;' : o.aux ? 'attribute vec4 aux; varying float vCav; varying float vEdge;' : '',
      vertexPre: o.head ? 'vCav = cav; vEdge = aux.y; vSky = aux.z; vHair = aux.w;' : o.cav ? 'vCav = cav; vEdge = aux.y;' : o.aux ? 'vCav = 1.0 - clamp(aux.x, 0.0, 1.0) * 0.8; vEdge = aux.y;' : '',
      color: COLOR,
      normal: NORMAL,
      roughness: ROUGH,
      // crevices, joints and undersides lose most of the sky / bounce light (deep dark joints, ref 9)
      ao: o.head ? 'cgAO = mix(0.1, 1.0, smoothstep(0.08, 0.95, vCav)) * mix(uHeadB.z, 1.0, smoothstep(0.0, 0.8, vSky)) * (0.75 + 0.25 * smoothstep(-0.6, 0.4, cgN.y));' : (o.cav || o.aux) ? 'cgAO = mix(0.12, 1.0, smoothstep(0.08, 0.95, vCav)) * (0.75 + 0.25 * smoothstep(-0.6, 0.4, cgN.y));' : 'cgAO = 0.75 + 0.25 * smoothstep(-0.6, 0.4, cgN.y);',
    });
    mat.userData.ruinUniforms = uniforms;
    mat.userData.needsCav = !!o.cav;
    return mat;
  });
}

/** give a geometry an "open" cav attribute when it has none (plain boxes rendered with a cav material) */
export function ensureCav(geo, v = 1) {
  if (geo && !geo.attributes.cav && geo.attributes.position) {
    const a = new Uint8Array(geo.attributes.position.count).fill(Math.round(v * 255));
    geo.setAttribute('cav', new THREE.BufferAttribute(a, 1, true));
  }
  return geo;
}

/** configure the carved inscription on a (vertical or tilted) column */
export function setInscription(mat, { origin, axis, front, radius, letterHeight, rotation = 0 }) {
  const u = mat.userData.ruinUniforms;
  u.uInscA.value.set(origin[0], origin[1], origin[2], radius);
  u.uInscB.value.set(axis[0], axis[1], axis[2], rotation);
  u.uInscC.value.set(front[0], front[1], front[2], letterHeight);
}
