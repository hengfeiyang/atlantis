// adapted from athenaion/src/terrain/material.js
// Terrain ground shader (one program for near and far terrain, both eras): world-space procedural layers —
// limestone-grey rock with warm tints on the ring faces / citadel risers / islets (joints, beds, crevices,
// rain streaks, moss), garden soil and grass on the citadel benches and land rings, the coastal plain's
// patchwork of fields, olive groves and woods, shore sand / wet rock, pale sandy ring beds and sea bed seen
// through the clear water, and the far mountains (grey rock, scree, green lower slopes, forest).
// Sunken era (uEra = 1): below the sunken surface every up-facing surface is pale rippled sand (the sand
// fill thickness comes from the mesher in aTer.w), rock faces carry algae turf; above it (the far land,
// islands at dusk, ref 9) the golden shading stays.
// Vertex attribute aTer = (crevice, rockiness, water distance, outcrop | sunken: sand-fill thickness).
// Far field: per-pixel normals, curvature and heightfield sun shadows from the eroded far-grid texture.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { ATMO } from '../core/atmosphere.js';
import { SKY } from '../core/sky.js';
import * as L from '../world/layout.js';

const ST_ONE = { value: 1 };
export const TERRAIN_UNIFORMS = {
  uSnowLine: { value: 2350 },   // only the highest crests get a dusting (ref 1: grey rock ranges)
  uRockTint: { value: new THREE.Color(1, 1, 1) },
  uGroundTint: { value: new THREE.Color(1, 1, 1) },
  uFarTex: { value: null },
  uFarInfo: { value: new THREE.Vector4(0, 0, 16, 0) },   // x0, z0, cell, enabled
  uFarSize: { value: new THREE.Vector2(1, 1) },          // nx, nz
  uFarMaxH: { value: 1e5 },
  uMtnK: { value: 1 / (L.MOUNTAINS?.scale ?? 1) },       // r5: 1 / mountain vertical scale (zoning on the unscaled wall)
  uFarSky: { value: new THREE.Vector4(0.45, 0.60, 1.0, 0.35) }, // r5 look: cool sky fill on the far range (rgb tint, w gain × sun irradiance)
  uFarRock: { value: new THREE.Vector4(1, 1, 1, 1) },    // r5 look: x rock albedo gain, y forest cover, z pasture cover, w facet softening (0 = r4)                              // r5: max height of the far grid (shadow march early-out)
  uTSun: ATMO.uSunDir,                                   // shared: toward the sun
  uStOne: ST_ONE,
  uTBump: { value: 1 },
  uTDebug: { value: 0 },
  uTBounce: { value: 0.4 },
  uTSunIrr: SKY.uSunIrr,
  uFarTint: { value: new THREE.Color(1.18, 1.15, 1.12) },   // look-dev may tune per shot (registry.terrain.uniforms). r5: 1.2/1.15/1.06 → less yellow (neutral limestone, ref 1)
  uEra: { value: 0 },                                    // 0 golden, 1 sunken
  uSurf: { value: L.SUNKEN.surface },                    // sunken sea surface
  uSandColor: { value: new THREE.Color(0.60, 0.575, 0.505) },
  uRipple: { value: 1 },                                 // sunken sand ripple bump strength
};

const HEAD = /* glsl */ `
uniform float uSnowLine;
uniform vec3 uRockTint;
uniform vec3 uFarTint;
uniform vec3 uGroundTint;
uniform sampler2D uFarTex;
uniform vec4 uFarInfo;
uniform vec2 uFarSize;
uniform float uFarMaxH;
uniform float uMtnK;
uniform vec4 uFarRock;
uniform vec4 uFarSky;
uniform vec3 uTSun;
uniform float uTBump;
uniform float uTDebug;
uniform float uTBounce;
uniform vec3 uTSunIrr;
uniform float uEra;
uniform float uSurf;
uniform vec3 uSandColor;
uniform float uRipple;
uniform float uStOne;
varying vec4 vTer;
float stFbm(vec3 p, int oct, float fp, float gain) {
  float s = 0.0, a = 0.5, n = 0.0, f = 1.0;
  int no = int(float(oct) * uStOne);
  for (int i = 0; i < no; i++) {
    float w = 1.0 - smoothstep(0.18, 0.5, fp * f);
    if (w > 0.0) s += a * w * cgSnoise(p * f); // r4 perf: skip octaves faded out by the footprint (same result)
    n += a;
    f *= 2.07; a *= gain; p += vec3(3.71, 1.37, 5.13);
  }
  return s / n;
}
vec3 stCell(vec3 p, out vec3 fpos) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0; fpos = vec3(0.0);
  int L1 = int(uStOne);
  for (int z = -L1; z <= L1; z++) for (int y = -L1; y <= L1; y++) for (int x = -L1; x <= L1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = cgHash33(i + g);
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = cgHash13(i + g); fpos = i + g + o; }
    else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
vec3 stBumpNormal(vec3 p, vec3 n, float h) {
  vec3 dpdx = dFdx(p), dpdy = dFdy(p);
  float dhdx = dFdx(h), dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 g = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - g);
}
float tBump; float tRough; float tAO; float tSunVis = 1.0; vec3 tN; float tFW = 0.0; vec3 tDbg = vec3(0.0);
vec3 tFacetN(vec3 P, vec3 N, float fp, float scale, float amp, float seed) {
  float w = amp * (1.0 - smoothstep(scale * 0.3, scale * 0.8, fp));
  if (w <= 0.0) return normalize(normalize(N));   // r5 perf: faded out (same result as the full path)
  vec3 q = P / scale * vec3(1.0, 1.5, 1.0) + seed;
  vec3 fpos; vec3 cc = stCell(q, fpos);
  vec3 t = cgHash33(fpos * 7.13 + 1.7 + seed) - 0.5;
  vec3 tp = t - N * dot(t, N);
  vec3 n2 = normalize(N + tp * 2.2 * w);
  float ledge = step(0.72, cgHash13(fpos * 3.7 + seed)) * w;   // up-tilted ledge facets
  return normalize(mix(n2, normalize(N + vec3(0.0, 1.6, 0.0)), ledge * 0.8));
}

vec3 tlAlb; float tlH; float tlRgh; float tlAO; vec3 tlN;
bool tlAlbOnly = false;   // r5 perf: caller needs the albedo only (relief-only noise is skipped; tlH is then 0)
void tLime(vec3 p, vec3 n, float cav, float fp) {
  float vert = 1.0 - abs(n.y);
  float upw = clamp(n.y, 0.0, 1.0);
  float m1 = stFbm(p * 0.028 + 1.7, 3, 0.0, 0.5);
  float m2 = stFbm(p * 0.095 + vec3(11.0, 3.0, 7.0), 3, 0.0, 0.5);
  float f3 = 1.0 - smoothstep(0.3, 0.8, fp);
  float m3 = f3 > 0.0 ? cgSnoise(p * 0.45 + 2.0) * f3 : 0.0;   // (band-limited: 2 m noise = pixel speckle at 300+ m)
  // r5: richer, warmer palette (sunlit limestone warm cream, not pale grey; weathered masses blue-grey;
  // buff / honey and rust-orange stains saturated enough to survive the haze at 300–900 m) — ref 8 crag
  // mid / bright (142,125,109) / (223,194,169), chroma ≈ 34
  vec3 cream = vec3(0.570, 0.540, 0.480);
  vec3 bone  = vec3(0.650, 0.635, 0.600);
  vec3 grey  = vec3(0.370, 0.372, 0.375);
  vec3 buff  = vec3(0.540, 0.410, 0.260);
  vec3 c = mix(cream, bone, smoothstep(0.15, 0.6, -m1 + 0.5 * m2) * 0.7);
  c = mix(c, grey, smoothstep(0.20, 0.70, m1 + 0.35 * m2) * 0.50);
  c = mix(c, buff, smoothstep(0.15, 0.65, m2 + 0.35 * m1) * 0.65 * (0.4 + 0.6 * vert));
  // r5: grey weathering mottles at 2–6 m (lichen-greyed surfaces between fresh cream patches, ref 2 / 7)
  float mg = stFbm(p * 0.21 + 5.5, 3, fp * 0.21, 0.55);
  c = mix(c, grey * 1.1, smoothstep(0.0, 0.45, mg) * 0.32);
  c *= 1.0 + 0.08 * m3;
  // ---- block network: joint-bounded blocks (≈ 2.5–4 m wide, 3–6 m tall) + smaller fragments
  // (r5: fades earlier — its sub-pixel joint lines turned into speckle noise at 300+ m; the meso layer
  // below carries the structure there)
  float fadeB = 1.0 - smoothstep(0.25, 0.8, fp);
  vec3 nb = n; float crk = 0.0;
  if (fadeB > 0.0) {
    float wv = cgSnoise(p * 0.07 + 3.0);
    vec3 q = p + vec3(1.5, 0.8, 1.5) * wv;
    vec3 fpos; vec3 cc = stCell(q * vec3(0.33, 0.21, 0.33) + 0.37, fpos);
    vec3 tilt = (cgHash33(fpos * 7.13 + 1.7) - 0.5);
    tilt.y *= 0.6;
    nb = normalize(n + (tilt - n * dot(tilt, n)) * 0.5 * fadeB);
    // joints between blocks (cell borders) — thin, dark, wider where the rock is fractured
    // (cell borders only as faint, sparse joints: a full voronoi network reads as crackle glaze)
    float jt = (1.0 - smoothstep(0.0, 0.05 + fp * 0.04, cc.y - cc.x)) * smoothstep(0.25, 0.6, cgSnoise(fpos * 0.37 + 2.2));
    crk = jt * fadeB * 0.45 * smoothstep(0.4, 0.9, vert);
    // long near-vertical fractures and discontinuous bedding cracks
    float jn = cgSnoise(vec3(p.x * 0.11, p.y * 0.006, p.z * 0.11) + 9.0);
    float jseg = smoothstep(0.0, 0.35, cgSnoise(vec3(p.x * 0.05, p.y * 0.035, p.z * 0.05) + 4.0));
    crk = max(crk, (1.0 - smoothstep(0.0, 0.03 + fp * 0.03, abs(jn))) * jseg * smoothstep(0.55, 0.9, vert) * fadeB);
    float ybk = p.y * 0.27 + 0.8 * cgSnoise(vec3(p.xz * 0.02, 1.3)) + 0.3 * wv;
    float bseg = smoothstep(0.0, 0.4, cgSnoise(vec3(p.x * 0.04, p.y * 0.1, p.z * 0.04) + 2.0));
    crk = max(crk, (1.0 - smoothstep(0.0, 0.05 + fp * 0.05, abs(fract(ybk) - 0.5))) * bseg * smoothstep(0.5, 0.9, vert) * 0.35 * fadeB);
    c *= 0.84 + 0.30 * cc.z;                                   // block-to-block tone
    c = mix(c, grey * 0.9, smoothstep(0.80, 0.9, cc.z) * 0.4); // weathered grey blocks
    c = mix(c, bone * 1.05, smoothstep(0.12, 0.04, cc.z) * 0.45); // freshly broken white faces
    float fadeS = 1.0 - smoothstep(0.15, 0.8, fp);
    if (fadeS > 0.0) {
      vec3 fpos2; vec3 c2 = stCell(p * vec3(0.9, 0.55, 0.9) + 5.1, fpos2);
      vec3 t2 = (cgHash33(fpos2 * 5.31 + 0.3) - 0.5);
      nb = normalize(nb + (t2 - nb * dot(t2, nb)) * 0.3 * fadeS);
      c *= 0.90 + 0.18 * c2.z;
    }
  }
  nb = normalize(mix(n, nb, 0.35 + 0.65 * vert));
  // ---- relief: flutes (karren) on steep faces, pits, fine roughness
  float fade = 1.0 - smoothstep(0.3, 1.5, fp);
  float ff1 = 1.0 - smoothstep(0.06, 0.22, fp), ff2 = 1.0 - smoothstep(0.3, 1.0, fp);
  if (tlAlbOnly) { ff1 = 0.0; ff2 = 0.0; }
  float fl1 = ff1 > 0.0 ? cgSnoise(vec3(p.x * 0.9, p.y * 0.07, p.z * 0.9)) : 0.0;
  float fl2 = ff2 > 0.0 ? cgSnoise(vec3(p.x * 0.28, p.y * 0.025, p.z * 0.28) + 5.0) : 0.0;
  // (bump terms band-limited to ≥ ~5 px wavelength: the derivative bump is constant per 2×2 pixel quad)
  float h = (fade > 0.0 && !tlAlbOnly) ? 0.10 * stFbm(p * 0.6, 5, fp * 0.6 * 2.6, 0.55) * fade : 0.0;
  h += (0.10 * fl1 * ff1 + 0.22 * fl2 * ff2) * vert;
  h -= crk * 0.14 * (1.0 - smoothstep(0.006, 0.02, fp));
  // ---- r5 meso relief (normal-only bump, 4–60 m): at 100–1500 m the mesh is 1–4 m and the fine bump has
  // faded, so the faces read smooth. Karst columns with sharp V-grooves, bedding beds (lit ledge strip on
  // top, dark undercut below), buttresses — each term band-limited (fades below ~6 px wavelength) so it
  // shades crisply (screen-derivative bump) without aliasing. Colour follows the same structure.
  float vW = smoothstep(0.30, 0.75, vert);
  vec3 qm = p;
  float groove = 0.0, undW = 0.0, ledW = 0.0;
  if (vW > 0.0) {   // r5 perf: every meso term below (and every later use of qm) is weighted by vW
  qm = p + vec3(5.0, 0.0, 5.0) * cgSnoise(p * 0.012 + 2.0);
  float mf13 = 1.0 - smoothstep(13.0 * 0.11, 13.0 * 0.22, fp);
  float mf5 = 1.0 - smoothstep(5.0 * 0.11, 5.0 * 0.22, fp);
  float mf4 = 1.0 - smoothstep(4.5 * 0.11, 4.5 * 0.22, fp);
  float mf15 = 1.0 - smoothstep(15.0 * 0.11, 15.0 * 0.22, fp);
  float mf40 = 1.0 - smoothstep(40.0 * 0.11, 40.0 * 0.22, fp);
  float mf20 = 1.0 - smoothstep(20.0 * 0.11, 20.0 * 0.22, fp);
  float gC = mf13 > 0.0 ? cgSnoise(vec3(qm.x * 0.072, qm.y * 0.011, qm.z * 0.072) + 31.0) : 0.0;           // ≈ 14 m columns
  float gF = mf5 > 0.0 ? cgSnoise(vec3(qm.x * 0.19, qm.y * 0.03, qm.z * 0.19) + 17.0) : 0.0;              // ≈ 5 m flutes
  groove = (1.0 - smoothstep(0.0, 0.16, abs(gC))) * mf13 + 0.6 * (1.0 - smoothstep(0.0, 0.12, abs(gF))) * mf5;
  float hM = 2.4 * (sqrt(abs(gC)) - 0.55) * mf13 + 0.65 * (sqrt(abs(gF)) - 0.55) * mf5;
  // beds: ≈ 4.5 m and ≈ 15 m (warped, discontinuous); profile = undercut, face, set-back ledge
  float undA = 0.0, ledA = 0.0, segA = 0.0, undB = 0.0, ledB = 0.0, segB = 0.0;
  if (mf4 > 0.0) {
    float ybA = qm.y / 4.6 + 0.9 * cgSnoise(vec3(qm.xz * 0.018, 5.0)) + 0.15 * gC;
    float fbA = fract(ybA);
    segA = smoothstep(-0.25, 0.25, cgSnoise(vec3(qm.x * 0.035, floor(ybA) * 0.37, qm.z * 0.035) + 8.0));
    undA = 1.0 - smoothstep(0.0, 0.14, fbA); ledA = smoothstep(0.84, 1.0, fbA);
  }
  if (mf15 > 0.0) {
    float ybB = qm.y / 15.0 + 0.7 * cgSnoise(vec3(qm.xz * 0.008, 9.0));
    float fbB = fract(ybB);
    segB = smoothstep(-0.35, 0.15, cgSnoise(vec3(qm.x * 0.015, floor(ybB) * 0.53, qm.z * 0.015) + 3.0));
    undB = 1.0 - smoothstep(0.0, 0.10, fbB); ledB = smoothstep(0.90, 1.0, fbB);
  }
  hM -= (0.55 * (undA + ledA) * segA * mf4 + 1.6 * (undB + ledB) * segB * mf15);
  // buttresses / recesses (40–50 m) and rounded masses (≈ 20 m): strong with distance, where the mesh has no
  // such relief left (a face lit at a grazing angle otherwise reads as one flat grey plane, refs 3/9 crags)
  float farM = 0.45 + 0.55 * smoothstep(80.0, 320.0, length(cameraPosition - p));
  float bigN = cgSnoise(p * vec3(0.021, 0.008, 0.021) + 41.0);
  float midN = cgSnoise(p * vec3(0.05, 0.022, 0.05) + 13.0);
  hM += (7.0 * bigN * mf40 + 2.6 * midN * mf20) * farM;
  h += hM * vW;
  c *= 1.0 + 0.10 * (bigN + 0.6 * midN) * vW;   // proud masses fresher, recesses greyer
  undW = max(undA * segA * mf4, undB * segB * mf15) * vW;
  ledW = max(ledA * segA * mf4, ledB * segB * mf15) * vW;
  }
  // colour on the same structure: grooves dark and damp, undercuts shadowed and stained, ledge strips
  // paler (fresh) or green with tufts
  float farL = smoothstep(0.3, 1.5, fp);   // sub-pixel dark detail averages into grey murk at distance: damp it there
  c *= 1.0 - (0.32 * groove * vW + 0.25 * undW) * (1.0 - 0.4 * farL);
  c = mix(c, bone * 1.04, ledW * 0.35 * smoothstep(-0.2, 0.4, m2));
  // bedding: faint horizontal bands
  if (vert > 0.0) {
    float yb = p.y * 0.42 + 1.4 * cgSnoise(vec3(p.xz * 0.04, 3.3)) + 0.3 * cgSnoise(p * 0.25);
    c *= mix(1.0, 0.84 + 0.26 * smoothstep(-0.6, 0.6, cgSnoise(vec3(p.x * 0.01, yb * 0.3, p.z * 0.01))), 0.7 * vert);
  }
  // mesh cavity is vertex-interpolated (0.5–2 m cells): sharpen it and break its edges so crevices read
  // as crisp irregular dark gaps, not soft smudges
  float cavN = fade > 0.0 ? cav + 0.22 * cgSnoise(p * vec3(1.3, 0.6, 1.3) + 4.0) * fade : cav;
  // the far crags carry the 2× coarse rock on 2 m cells (field.js rockBlend): their cavity is too soft to
  // darken the albedo much (it would read as smudges), the AO keeps it
  float far2 = smoothstep(1250.0, 1700.0, length(p.xz));
  float cv = clamp(max(0.85 * smoothstep(0.42, 0.75, cavN) * (1.0 - 0.6 * far2), crk), 0.0, 1.0);
  // ---- weathering colour: grey-black rain streaks hanging from joints and ledges
  float vS = smoothstep(0.35, 0.85, vert);
  if (vS > 0.0) {
    float fsk = 1.0 - smoothstep(0.15, 0.45, fp);
    float sk = cgSnoise(vec3(p.x * 0.35, p.y * 0.016, p.z * 0.35)) * 0.6 + (fsk > 0.0 ? cgSnoise(vec3(p.x * 1.1, p.y * 0.045, p.z * 1.1)) * 0.4 * fsk : 0.0);
    float skL = cgSnoise(vec3(p.x * 0.12, p.y * 0.007, p.z * 0.12) + 5.5);
    float streak = smoothstep(0.12, 0.5, sk) * vS * (0.55 + 0.45 * smoothstep(-0.3, 0.4, skL));
    // r5: wide grey-black curtains (6–12 m) hanging from the grooves and beds, visible from a kilometre
    float skC = cgSnoise(vec3(qm.x * 0.085, qm.y * 0.0045, qm.z * 0.085) + 23.0) + 0.35 * groove;
    float curtain = smoothstep(0.25, 0.75, skC) * vS * smoothstep(-0.4, 0.3, skL);
    streak = max(streak, curtain * 0.35);
    c = mix(c, c * vec3(0.36, 0.37, 0.39), streak * 0.5 * (1.0 - 0.35 * farL));
  }
  // ochre / orange iron stains below cracks
  float och = smoothstep(0.45, 0.85, cgSnoise(vec3(p.x * 0.07, p.y * 0.02, p.z * 0.07) + 13.0) + 0.3 * m2);
  c = mix(c, c * vec3(1.18, 0.86, 0.58), och * 0.55 * vert);
  // crevices: near-black, damp
  c *= 1.0 - 0.70 * cv * cv - 0.10 * cv;
  float lm = smoothstep(0.0, 0.6, stFbm(p * 0.3 + 4.0, 3, fp * 0.3, 0.5) + 0.3 * upw);
  float spkW = 1.0 - smoothstep(0.02, 0.07, fp);
  if (spkW > 0.0) c = mix(c, vec3(0.09, 0.09, 0.085), smoothstep(0.4, 0.75, cgSnoise(p * 8.0)) * lm * spkW * 0.7);
  c *= 1.0 - 0.15 * lm * (1.0 - spkW);
  c = mix(c, vec3(0.55, 0.50, 0.30), smoothstep(0.55, 0.8, cgSnoise(p * 1.9 + 9.0)) * lm * 0.35);   // yellow lichen
  c = mix(c, vec3(0.62, 0.62, 0.60), smoothstep(0.62, 0.85, cgSnoise(p * 1.3 + 2.0)) * (1.0 - lm) * 0.25); // white lichen
  float mossN = stFbm(p * 0.35 + 21.0, 3, fp * 0.35, 0.5);
  // moss on up-facing ledges, in crevices, and on the damp north-facing (shaded) faces and their bases
  float northF = smoothstep(0.0, -0.7, n.z) * vert;
  float moss = smoothstep(0.45, 0.9, upw * 0.9 + cv * 0.2 + 0.45 * mossN + 0.35 * northF * (0.5 + 0.5 * mossN));
  // r5: green tufts on the bed ledges and in the grooves (clumps, not a film)
  float tuftW = max(ledW, 0.6 * groove * vW);
  if (tuftW > 0.0) {
    float tuftN = cgSnoise(qm * vec3(0.32, 0.6, 0.32) + 12.0) + 0.4 * mossN;
    moss = max(moss, smoothstep(0.15, 0.55, tuftN) * tuftW);
  }
  c = mix(c, mix(vec3(0.050, 0.072, 0.022), vec3(0.135, 0.145, 0.045), smoothstep(-0.3, 0.6, mossN)), moss * 0.5);
  // tufts stand out of the rock: lumpy relief + sunlit flecks (near field only)
  float ftf = 1.0 - smoothstep(0.05, 0.25, fp);
  if (ftf > 0.0) {
    float tfN = cgSnoise(p * 2.7 + 4.4);
    h += moss * (0.10 + 0.12 * tfN) * ftf;
    c *= 1.0 + moss * 0.35 * smoothstep(0.3, 0.8, tfN) * ftf;
  }
  tlAlb = max(c, vec3(0.0)); tlH = h; tlRgh = 0.86 + 0.06 * m3; tlAO = (1.0 - 0.6 * cv) * (1.0 - 0.35 * groove * vW - 0.25 * undW); tlN = nb;
}



vec2 tFarUV(vec2 xz) { return ((xz - uFarInfo.xy) / uFarInfo.z + 0.5) / uFarSize; }
bool tInFar(vec2 uv) { return uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0; }
// weight of the far field (matches farfield.js farWeight)
float tFarW(vec2 xz) { return smoothstep(2300.0, 3200.0, length(xz)); }
float tFarShadow(vec3 P, vec3 L) {
  if (L.y <= 0.01) return 0.0;
  float t = 14.0, vis = 1.0;
  int ns = int(42.0 * uStOne);
  // r5 perf: once the ray is above the highest far-grid point by more than the penumbra width it can never
  // be shadowed again (height above grows with L.y per metre, the penumbra width with 0.035): stop there
  bool clearOK = L.y >= 0.035;
  for (int i = 0; i < ns; i++) {
    vec3 q = P + L * t;
    if (q.y > 3000.0) break;
    if (clearOK && q.y - uFarMaxH >= t * 0.035 + 2.0) break;
    vec2 uv = tFarUV(q.xz);
    if (!tInFar(uv)) break;
    float h = texture2D(uFarTex, uv).b * 8.0;
    vis = min(vis, clamp((q.y - h) / (t * 0.035 + 2.0), 0.0, 1.0));
    if (vis <= 0.0) break;
    t *= 1.19;
  }
  return vis;
}
// coastal plain patchwork (refs 1, 5): parcels of crops, pasture, ploughed soil, olive groves and orchards
// with hedgerows / tree lines on their borders; regions of ~700 m each with their own field orientation
vec3 tFields(vec3 P, float fp, float moist, out float hgt, out float treeW) {
  vec2 q = P.xz;
  vec3 rc = cgVoronoi2(q / 720.0);                     // (F1, F2, id)
  float ang = rc.z * 6.2831;
  vec2 dA = vec2(cos(ang), sin(ang));
  vec2 uv = vec2(dot(q, dA), dot(q, vec2(-dA.y, dA.x)));
  vec2 sz = vec2(70.0 + 70.0 * fract(rc.z * 7.3), 34.0 + 30.0 * fract(rc.z * 13.1));
  vec2 cell = floor(uv / sz), f = fract(uv / sz);
  float h = cgHash12(cell + rc.z * 31.0);
  float h2 = cgHash12(cell * 1.7 + 4.1);
  vec3 wheat = vec3(0.300, 0.235, 0.095), crop = vec3(0.085, 0.135, 0.036), pasture = vec3(0.125, 0.150, 0.055);   // r3: lusher, warmer
  vec3 plough = vec3(0.175, 0.115, 0.068), dry = vec3(0.215, 0.180, 0.095);
  vec3 c = h < 0.22 ? wheat : h < 0.42 ? crop : h < 0.62 ? pasture : h < 0.74 ? plough : dry;
  c *= 0.85 + 0.3 * h2;
  c = mix(c, crop * 1.1, smoothstep(0.55, 0.95, moist) * 0.5);
  // furrows / rows inside a parcel (near), tree dots of groves (olive / orchard parcels)
  float near = 1.0 - smoothstep(0.4, 2.0, fp);
  float rows = sin(uv.y * (h2 > 0.5 ? 3.1 : 1.6) * 3.14159) * near;
  c *= 1.0 + 0.10 * rows;
  treeW = 0.0;
  if (h > 0.62 && h < 0.86 && h2 > 0.45) {   // groves
    vec2 g = fract(uv / 7.0) - 0.5;
    float dot1 = smoothstep(0.32, 0.18, length(g)) * (1.0 - smoothstep(1.5, 5.0, fp));
    treeW = max(treeW, mix(0.42, dot1, 1.0 - smoothstep(1.5, 5.0, fp)));
  }
  // hedgerows / tree lines along some parcel borders
  vec2 e = min(f, 1.0 - f) * sz;
  float border = 1.0 - smoothstep(1.5 + fp * 0.6, 3.5 + fp * 1.2, min(e.x, e.y));
  float hedge = border * step(0.45, cgHash12(cell * 2.3 + 1.0));
  treeW = max(treeW, hedge * 0.9);
  // woods: large irregular patches
  float wood = smoothstep(0.25, 0.55, stFbm(P * 0.0021 + 7.0, 3, 0.0, 0.55) + 0.25 * moist);
  treeW = max(treeW, wood);
  hgt = 0.6 * treeW * (0.5 + 0.5 * cgSnoise(P * 0.35)) * (1.0 - smoothstep(0.5, 2.0, fp));
  return c;
}
`;

const COLOR = /* glsl */ `
vec3 P = cgP;
vec3 N = cgN;
float fp = max(length(fwidth(P)), 1e-3);
float cav = vTer.x, rockA = vTer.y, wd = vTer.z, outc = uEra > 0.5 ? 0.0 : vTer.w;
float sandFill = uEra > 0.5 ? vTer.w : 0.0;
float camD = length(cameraPosition - P);
float curv = 0.0;
float rr = length(P.xz);

// ---------------- far field: per-pixel normal, curvature, sun shadow from the eroded grid
float fw = 0.0;
if (uFarInfo.w > 0.5) {
  vec2 fuv = tFarUV(P.xz);
  fw = tInFar(fuv) ? tFarW(P.xz) : 0.0;
  if (fw > 0.0) {
    vec4 F = texture2D(uFarTex, fuv);
    vec3 nF = normalize(vec3(F.x, sqrt(max(0.02, 1.0 - F.x * F.x - F.y * F.y)), F.y));
    N = normalize(mix(N, nF, fw * smoothstep(0.0, 40.0, P.y)));
    curv = F.w * fw;
    if (camD > 1500.0) tSunVis = mix(1.0, tFarShadow(P + vec3(0.0, 3.0, 0.0), normalize(uTSun)), fw * smoothstep(1500.0, 2600.0, camD));
  }
}
tN = N;
float slope = 1.0 - clamp(N.y, 0.0, 1.0);

// ---------------- macro fields
float mA = stFbm(P * 0.0019, 3, 0.0, 0.5);
float mB = stFbm(P * 0.0105 + 3.0, 3, 0.0, 0.5);
float mC = stFbm(P * 0.062 + 7.0, 3, 0.0, 0.5);
float nearW = 1.0 - smoothstep(0.06, 0.35, fp);
float fD = 1.0 - smoothstep(0.25, 0.9, fp);
float mD = fD > 0.0 ? cgSnoise(P * 0.55 + 1.3) * fD : 0.0;
float mE = nearW > 0.0 ? cgSnoise(P * 2.3 + 5.1) * nearW : 0.0;
// weight of the far mountain shading (r5 perf: computed first — where it is 1 the near-field layers are
// fully replaced and are not evaluated; where it is 0 the mountain layers are not evaluated)
float fwM = fw * smoothstep(45.0, 170.0, P.y + 40.0 * mB);
vec3 dryG   = vec3(0.150, 0.130, 0.068);
vec3 gold   = vec3(0.215, 0.168, 0.082);
vec3 greenG = vec3(0.058, 0.080, 0.030);
vec3 scrub  = vec3(0.026, 0.040, 0.017);
vec3 soil   = vec3(0.190, 0.128, 0.075);   // warm garden soil
vec3 stony  = vec3(0.335, 0.315, 0.275);   // limestone gravel / paths
vec3 col = vec3(0.0);
float hgt = 0.0, rough = 0.95, ao = 1.0, rockW = 0.0, citS = 0.0, pwW = 0.0;
if (fwM < 1.0) {
tDbg.b = 1.0;

// ---------------- ground: gardens / grass / soil (city & citadel), fields on the plain
float bearing = mod(degrees(atan(P.x, -P.z)) + 360.0, 360.0);
float seaSec = step(112.0, bearing) * step(bearing, 248.0) * step(800.0, rr);
// rock weight (r5: computed before the ground, which is skipped where the rock covers it fully)
// soil pockets: up-facing benches and ledge tops on the rocky slopes are earth / grass (ref 4, 6)
float upFlat = smoothstep(0.80, 0.94, N.y + 0.08 * mD) * (1.0 - fw);
rockW = max(rockA * (1.0 - 0.85 * upFlat), smoothstep(0.42, 0.66, slope + 0.10 * mC - 0.02 * curv));
rockW = max(rockW, smoothstep(0.05, 0.45, outc));
// islets: rock-dominated boulder piles (ref 1), a little green in the hollows only
rockW = max(rockW, seaSec * smoothstep(940.0, 1000.0, rr) * smoothstep(1.0, 3.5, P.y) * (1.0 - fw) * (0.85 - 0.5 * smoothstep(0.0, 0.5, mC + 0.4 * cav - 0.3)));
vec3 g = vec3(0.0); float gH = 0.0, plainW = 0.0;
if (rockW < 1.0) {
float moist = 0.55 + 0.30 * mA + 0.22 * mB + 0.30 * smoothstep(30.0, 3.0, wd) + 0.10 * cav + 0.04 * curv;
g = mix(dryG, greenG, smoothstep(0.25, 0.75, moist + 0.18 * mC));
g = mix(g, gold, smoothstep(0.40, 0.85, mC + 0.4 * mD) * smoothstep(0.55, 0.2, moist) * 0.45);
float fcl = 1.0 - smoothstep(0.3, 1.2, fp);
float clump = cgSnoise(P * vec3(0.22, 0.3, 0.22) + 3.1) + (fcl > 0.0 ? 0.5 * cgSnoise(P * 0.61 + 8.2) * fcl : 0.0);
float scrubW = smoothstep(0.0, 0.55, 0.55 * mB + 0.65 * mC + 0.30 * moist - 0.1) * smoothstep(0.7, 0.35, slope);
scrubW = max(scrubW * 0.8, smoothstep(0.2, 0.75, clump + 0.25 * mB + 0.15 * moist) * 0.5);
g = mix(g, scrub * (1.2 + 0.6 * smoothstep(-0.5, 0.8, mE)), scrubW);
float soilW = smoothstep(0.18, 0.5, slope + 0.22 * mC + 0.12 * mD);
g = mix(g, soil, soilW * 0.7);
g = mix(g, stony, smoothstep(0.35, 0.85, mC * 0.7 + mD * 0.5 + slope * 0.5) * 0.35);
// town ground (land rings, outer city, citadel quay): packed earth, gravel and garden lawns
float town = step(rr, 1960.0) * (1.0 - seaSec) * smoothstep(1.0, 3.0, P.y) * (1.0 - smoothstep(0.35, 0.6, slope));
vec3 townC = mix(mix(stony * 0.85, soil * 1.05, 0.4 + 0.4 * mC), greenG * 1.25, smoothstep(-0.1, 0.5, mB + 0.5 * mC + 0.2 * mD) * 0.75);
g = mix(g, townC, town * 0.85);
gH = 0.025 * mD * (1.0 - smoothstep(0.1, 0.35, fp)) + 0.012 * mE * (1.0 - smoothstep(0.02, 0.08, fp)) + 0.10 * clump * (1.0 - smoothstep(0.2, 0.6, fp));
// plain beyond the outer city: patchwork fields, groves, hedges and woods
plainW = smoothstep(1950.0, 2150.0, rr) * smoothstep(2.0, 5.0, P.y) * smoothstep(260.0, 120.0, P.y) * smoothstep(0.32, 0.12, slope) * (1.0 - fw * smoothstep(60.0, 180.0, P.y));
if (plainW > 0.0) {
  float fh, tw;
  vec3 fc = tFields(P, fp, moist, fh, tw);
  vec3 treeC = mix(vec3(0.034, 0.056, 0.022), vec3(0.062, 0.084, 0.032), smoothstep(-0.5, 0.6, mC)) * (0.75 + 0.5 * smoothstep(-0.6, 0.6, cgSnoise(P * 0.18)));
  fc = mix(fc, treeC, tw);
  g = mix(g, fc, plainW);
  gH = mix(gH, fh, plainW);
}
g *= 1.0 + 0.16 * mD + 0.10 * mE;
g *= uGroundTint;
vec3 scree = mix(stony * 0.8, soil, 0.35 + 0.3 * mD);
scree = mix(scree, scrub, smoothstep(-0.1, 0.5, mC + 0.3 * mB) * 0.7);
g = mix(g, scree, smoothstep(0.12, 0.30, slope) * smoothstep(0.62, 0.42, slope) * (1.0 - fw) * (1.0 - plainW));
}

// ---------------- rock (r5 perf: evaluated only where the rock, the shore rock or the citadel hillside shows)
float alt = smoothstep(250.0, 1400.0, P.y);
float emerg = smoothstep(-2.0, -7.0, wd) * smoothstep(2.5, 1.2, P.y) * (1.0 - fw);
citS = smoothstep(109.6, 110.4, rr) * (1.0 - smoothstep(213.5, 219.0, rr)) * (1.0 - fw) * smoothstep(1.0, 4.0, P.y);
vec3 rc = vec3(0.0); float cvegH = 0.0, ochre = 0.0;
tlAlb = vec3(0.0); tlH = 0.0; tlRgh = 0.86; tlAO = 1.0; tlN = N;
if (rockW > 0.0 || emerg > 0.0 || citS > 0.0) {
tDbg.r = 1.0;
tlAlbOnly = rockW <= 0.0 && citS <= 0.0;   // only the shore / bed rock colour (rc) is used there
tLime(P, N, cav, fp);
rc = tlAlb * uRockTint;
float islR = smoothstep(940.0, 1000.0, rr) * seaSec;
rc = mix(rc, rc * vec3(0.92, 0.80, 0.68) * (0.85 + 0.3 * smoothstep(-0.4, 0.6, mC)), islR);
float ledge = smoothstep(0.55, 0.85, N.y) * rockW * smoothstep(400.0, 0.0, P.y);
rc = mix(rc, mix(scrub, greenG, 0.4 + 0.3 * mC), clamp(ledge * (0.55 + 0.6 * mC), 0.0, 0.85));
rc = mix(rc, vec3(0.035, 0.040, 0.028), smoothstep(0.6, 1.0, cav) * 0.4 * (1.0 - alt));
// plants clinging to the rock: dark green patches in fissures and on small ledges (refs 4, 1)
float cvegO = (1.0 - alt) * smoothstep(0.5, 3.5, P.y) * (1.0 - fw);
if (cvegO > 0.0) {
  float cveg = stFbm(P * 0.11 + vec3(4.0, 9.0, 1.0), 3, 0.0, 0.5) + 0.6 * cav + 0.55 * smoothstep(0.2, 0.6, N.y) - 0.22;
  float fbl = 1.0 - smoothstep(0.2, 0.9, fp);
  float blob = cgSnoise(P * 0.42 + 6.1) + (fbl > 0.0 ? 0.5 * cgSnoise(P * 1.25 + 2.9) * fbl : 0.0);
  float cvegD = smoothstep(120.0, 420.0, camD);
  float cvegW = smoothstep(0.26 + 0.30 * cvegD, 0.52 + 0.30 * cvegD, cveg + 0.15 * mD + 0.32 * blob) * cvegO;
  float flf = 1.0 - smoothstep(0.08, 0.4, fp);
  float leaf = 0.55 + 0.9 * smoothstep(-0.5, 0.75, (flf > 0.0 ? cgSnoise(P * 2.6 + 1.0) * flf : 0.0) + 0.35 * blob);
  vec3 cvegC = mix(scrub * 1.7, greenG * 1.3, smoothstep(-0.3, 0.6, mC + 0.3 * blob)) * leaf;
  rc = mix(rc, cvegC, cvegW * 0.9);
  cvegH = cvegW * 0.12 * blob * (1.0 - smoothstep(0.08, 0.3, fp));
}
float ochW = (1.0 - alt) * (1.0 - fw);
if (ochW > 0.0 || citS > 0.0) {
  ochre = smoothstep(0.35, 0.8, stFbm(vec3(P.x * 0.05, P.y * 0.012, P.z * 0.05) + 13.0, 3, 0.0, 0.5));
  rc = mix(rc, rc * vec3(1.20, 0.92, 0.66), ochre * 0.45 * ochW);
}
}
col = mix(g, rc, rockW);
hgt = mix(gH, tlH + cvegH, rockW);
tN = normalize(mix(tN, tlN, rockW * (1.0 - fw)));
rough = mix(0.95, tlRgh, rockW);
ao = mix(1.0, tlAO, rockW);

// ---------------- r3: citadel hillside (refs 4, 5): warm grey-tan limestone crags at mid contrast, maquis
// clinging to them, planted soil terraces on every bench. The lit benches are dark soil / shrubs and the
// (mostly shaded) risers paler rock, so sun-lit vs shaded parts no longer read as black / white blotches.
if (citS > 0.0) {
  float upC = smoothstep(0.50, 0.86, N.y + 0.12 * mD + 0.06 * mC);
  // rock: tLime structure kept (beds, joints) but compressed toward a warm mid grey-tan
  float rl = dot(tlAlb, vec3(0.3, 0.59, 0.11));
  vec3 crk = mix(vec3(0.250, 0.212, 0.170), vec3(0.360, 0.312, 0.250), smoothstep(-0.5, 0.6, mB + 0.5 * mC + 0.3 * mD));
  crk = mix(crk, crk * vec3(1.12, 0.93, 0.74), ochre * 0.5);
  vec3 rcC = crk * clamp(0.62 + 0.75 * rl, 0.55, 1.25);
  rcC = mix(rcC, rcC * vec3(0.80, 0.84, 0.74), smoothstep(0.55, 0.95, cav) * 0.5);   // damp crevices, not black
  // maquis: lentisk / myrtle / oleander clumps (rounded, mid-dark green, olive highlights)
  float shN = cgSnoise(P * 0.19 + 3.0) + 0.55 * cgSnoise(P * 0.52 + 1.0) * (1.0 - smoothstep(0.2, 0.8, fp)) + 0.35 * mC + 0.25 * cav;
  float shrub = smoothstep(-0.20, 0.25, shN + 0.85 * upC - 0.30);
  float lf = cgSnoise(P * 1.7 + 2.0) * (1.0 - smoothstep(0.06, 0.3, fp));
  vec3 mq = mix(vec3(0.050, 0.100, 0.026), vec3(0.130, 0.165, 0.052), smoothstep(-0.5, 0.7, cgSnoise(P * 0.33 + 9.0) + 0.4 * mC)) * (0.85 + 0.3 * lf);
  // soil terraces: warm red-brown garden earth and dry grass between the shrubs
  vec3 terr = mix(vec3(0.205, 0.140, 0.085), vec3(0.150, 0.145, 0.070), smoothstep(-0.3, 0.5, mB + 0.4 * mD));
  vec3 hill = mix(rcC, mix(terr, mq, shrub), upC);
  hill = mix(hill, mq, shrub * (1.0 - upC) * 0.6);   // shrubs hanging on the crags
  col = mix(col, hill, citS);
  hgt = mix(hgt, mix(tlH * 0.7, 0.12 * shN * (1.0 - smoothstep(0.1, 0.4, fp)), upC), citS);
  tN = normalize(mix(tN, mix(tlN, N, upC), citS));
  rough = mix(rough, 0.92, citS);
  ao = mix(ao, mix(mix(1.0, tlAO, 0.45), 0.9 + 0.1 * shrub, upC), citS);
  rockW = mix(rockW, 1.0 - upC, citS);
}
// r3: the plateau rim (r 110 → 114, 62 → 42) is a built retaining wall under the red rampart: dressed ashlar
// courses, warm limestone, weathering streaks (shape.js makes it a clean battered face, field.js no rock there)
pwW = smoothstep(109.4, 110.1, rr) * (1.0 - smoothstep(114.0, 114.8, rr)) * smoothstep(0.45, 0.75, 1.0 - abs(N.y)) * (1.0 - fw);
if (pwW > 0.0) {
  float arc = atan(P.x, -P.z) * 112.0;
  float cyc = (P.y - 42.0) / 0.94;
  float ci = floor(cyc);
  float bl = 1.7 + 0.9 * cgHash12(vec2(ci, 3.7));
  float cxx = arc / bl + 0.5 * mod(ci, 2.0) + cgHash12(vec2(ci, 9.1));
  float bi = floor(cxx);
  float jy = min(fract(cyc), 1.0 - fract(cyc)) * 0.94, jx = min(fract(cxx), 1.0 - fract(cxx)) * bl;
  float jnt = 1.0 - smoothstep(0.018, 0.05 + fp * 0.6, min(jx, jy));
  float bh = cgHash12(vec2(bi, ci) + 0.37);
  vec3 ash = mix(vec3(0.48, 0.43, 0.36), vec3(0.58, 0.53, 0.45), bh) * (0.92 + 0.12 * mD);
  float stk = smoothstep(0.1, 0.6, cgSnoise(vec3(arc * 0.35, P.y * 0.03, 1.0)) + 0.3 * mC);
  ash = mix(ash, ash * vec3(0.62, 0.62, 0.60), stk * 0.5 * smoothstep(42.0, 60.0, P.y));
  ash = mix(ash, ash * vec3(0.55, 0.62, 0.45), smoothstep(48.0, 42.0, P.y) * 0.5);    // damp, green foot
  ash *= 1.0 - 0.55 * jnt;
  col = mix(col, ash, pwW);
  hgt = mix(hgt, -0.03 * jnt + 0.012 * (bh - 0.5), pwW);
  tN = normalize(mix(tN, N, pwW));
  ao = mix(ao, 1.0 - 0.3 * jnt, pwW);
  rough = mix(rough, 0.85, pwW);
}

// ---------------- shores and beds (golden sea level y = 0)
rockW = max(rockW, emerg);
col = mix(col, rc, emerg);
float shore = smoothstep(9.0, 1.5, wd) * smoothstep(3.2, 0.6, P.y) * (1.0 - emerg);
vec3 sand = mix(vec3(0.46, 0.41, 0.31), vec3(0.38, 0.35, 0.28), 0.5 + 0.5 * mC);
float wet = smoothstep(0.7, -0.1, P.y + 0.2 * mD);
vec3 sandC = mix(sand, sand * vec3(0.55, 0.56, 0.56), wet);
col = mix(col, sandC, shore * (1.0 - rockW * 0.85));
col = mix(col, col * vec3(0.48, 0.50, 0.48), wet * rockW);
// algae / dark tide band on rock just above the water, fading up
float algae = smoothstep(1.4, 0.15, P.y + 0.4 * mD) * smoothstep(-0.6, 0.0, P.y) * rockW * smoothstep(12.0, 2.0, wd);
col = mix(col, vec3(0.045, 0.055, 0.030), algae * 0.6);
rough = mix(rough, 0.35, wet);
// under the golden water: pale sand beds with pebbles, rock rubble and weed patches (seen through the clear
// turquoise rings and the sea, refs 1, 4)
float under = smoothstep(-0.3, -2.5, P.y) * (1.0 - fw * smoothstep(-30.0, 10.0, P.y));
if (under > 0.0) {
  float weed = smoothstep(0.15, 0.55, stFbm(P * 0.045 + 2.0, 3, fp * 0.045, 0.5) + 0.3 * mC) * smoothstep(-40.0, -6.0, P.y);
  vec3 bedS = mix(vec3(0.50, 0.46, 0.37), vec3(0.42, 0.40, 0.33), 0.5 + 0.5 * mB);
  float fpb = 1.0 - smoothstep(0.03, 0.12, fp), peb = 0.0;
  if (fpb > 0.0) {   // r5 perf: pebbles only where they are resolved
    vec3 vb = cgVoronoi2(P.xz * 0.9 + 3.0);
    peb = smoothstep(0.55, 0.25, vb.x) * step(0.6, vb.z) * fpb;
    bedS = mix(bedS, bedS * (0.65 + 0.5 * vb.z), peb);
  }
  bedS = mix(bedS, vec3(0.07, 0.085, 0.04) * (0.8 + 0.4 * mD), weed * 0.75);
  vec3 bedR = mix(rc * vec3(0.80, 0.84, 0.78), vec3(0.06, 0.07, 0.04), 0.35 * smoothstep(-0.2, 0.6, mC));
  col = mix(col, mix(bedS, bedR, rockW * 0.85), under);
  hgt += under * (1.0 - rockW) * 0.03 * peb;
}

}   // fwM < 1

// ---------------- far mountains (alpine range): rock faces, strata, couloirs, scree, forest, meadows, snow
// vertical streak fields (triplanar on the two vertical planes): couloirs / rock ribs / water streaks
if (fwM > 0.0) {
tDbg.g = 1.0;
vec3 Nfc = N;
// r5 look: gentler facets (broad sunlit faces as in ref 1 instead of a black / white speckle of tilted facets)
if (fw > 0.001) { Nfc = tFacetN(P, N, fp, 46.0, 0.40 * uFarRock.w + 0.55 * (1.0 - uFarRock.w), 0.0); Nfc = tFacetN(P, Nfc, fp, 15.0, 0.28 * uFarRock.w + 0.45 * (1.0 - uFarRock.w), 17.0); }
float slopeF = 1.0 - clamp(Nfc.y, 0.0, 1.0);
vec2 wN = abs(N.xz) + 1e-3; wN /= (wN.x + wN.y);
float strk = cgSnoise(vec3(P.x * 0.0095, P.y * 0.0026, 1.7)) * wN.y + cgSnoise(vec3(P.z * 0.0095, P.y * 0.0026, 4.1)) * wN.x;
float strk2 = cgSnoise(vec3(P.x * 0.042, P.y * 0.010, 9.3)) * wN.y + cgSnoise(vec3(P.z * 0.042, P.y * 0.010, 2.9)) * wN.x;
float fs3 = 1.0 - smoothstep(2.0, 9.0, fp);
float strk3 = fs3 > 0.0 ? (cgSnoise(vec3(P.x * 0.16, P.y * 0.04, 5.5)) * wN.y + cgSnoise(vec3(P.z * 0.16, P.y * 0.04, 7.1)) * wN.x) * fs3 : 0.0;
float cv = clamp(curv, -3.0, 3.0);
// r5 look: the director's MOUNTAINS.scale (0.62) lowered the wall below the tree line the bands were tuned
// for — the whole range had turned dark forest / pasture (flat olive-grey vs the lit rock of ref 1). Zoning
// (tree line, meadows, scree) now uses the UNSCALED altitude and slope of the wall (the snow line stays on the
// real altitude: ref 1 has pale sunlit limestone, not snow fields).
float kM = mix(1.0, uMtnK, smoothstep(30.0, 250.0, P.y));
float Ya = 30.0 + max(P.y - 30.0, 0.0) * kM + min(P.y - 30.0, 0.0);
float ny = max(N.y, 0.02);
float slopeZ = 1.0 - inversesqrt(1.0 + (1.0 / (ny * ny) - 1.0) * kM * kM);
// strata: warped near-horizontal bands (~25-40 m), stronger on steep faces
float yb = P.y * 0.03 + 1.8 * cgSnoise(vec3(P.xz * 0.0006, 2.2)) + 0.35 * cgSnoise(P * 0.004);
float band = smoothstep(-0.5, 0.5, sin(yb * 6.2831 + 2.0 * cgSnoise(P * 0.002)));
// rock: blue-grey limestone/gneiss, lighter fresh faces, warm weathered patches, dark wet streaks
vec3 rockF = mix(vec3(0.340, 0.336, 0.330), vec3(0.560, 0.535, 0.500),   // r3: warmer tan / cream lit rock (refs 1, 4)
   // r4: far rock 0.18-0.32 (shaded faces mid grey-blue under haze, not near-black); r5 warmer light rock,
   // r5 look: paler limestone (ref 1 sunlit faces cream / honey, shaded faces cool grey)
   smoothstep(-0.65, 0.55, mB + 0.45 * (band - 0.5) * slope + 0.25 * strk));
rockF = mix(rockF, vec3(0.520, 0.450, 0.370), smoothstep(0.15, 0.75, mA + 0.25 * strk + 0.2 * mB) * 0.45);
rockF *= uFarRock.x;
// r3: strata ledges / risers on the steep faces (more structure at telephoto, refs 1, 4)
rockF *= mix(1.0, 0.80 + 0.36 * band, smoothstep(0.25, 0.6, slope));
rockF *= 0.80 + 0.32 * smoothstep(-0.9, 0.9, strk2) + 0.10 * strk3;
rockF *= 1.0 + 0.10 * smoothstep(0.0, -2.0, cv) - 0.22 * smoothstep(0.2, 2.5, cv); // fresh ribs, dark damp gullies
// scree / talus fans: gentler slopes below the faces
float screeW = smoothstep(0.40, 0.22, slopeZ + 0.08 * mC) * smoothstep(700.0, 1150.0, Ya + 150.0 * mB);
vec3 screeC = mix(vec3(0.290, 0.265, 0.235), vec3(0.390, 0.352, 0.300), 0.5 + 0.5 * mC);
vec3 fc = mix(rockF, screeC, screeW * 0.75) * uFarTint;
// alpine meadows / dwarf pine above the forest on gentle ground
float tl = 1380.0 + 240.0 * mA + 110.0 * mB;
float medW = smoothstep(0.42, 0.20, slopeZ + 0.10 * mC) * smoothstep(tl - 220.0, tl + 60.0, Ya) * smoothstep(2250.0, 1850.0, Ya + 220.0 * mB);
fc = mix(fc, mix(vec3(0.060, 0.066, 0.034), vec3(0.105, 0.098, 0.058), smoothstep(-0.5, 0.6, mC + 0.3 * mB)), medW * 0.85);
// lowland and foothill pasture / maquis where there is no forest (never bare grey rock on gentle low ground)
float lowW = smoothstep(tl - 80.0, tl - 380.0, Ya + 60.0 * mB) * smoothstep(0.50, 0.30, slopeZ + 0.08 * mC) * uFarRock.z
           * smoothstep(-0.35, 0.15, 0.8 * mC + 0.4 * strk2 + 0.3 * cv + (tl - 300.0 - Ya) / 500.0);   // r5 look: broken by rock
fc = mix(fc, mix(vec3(0.060, 0.070, 0.034), vec3(0.105, 0.098, 0.060), smoothstep(-0.5, 0.6, mC + 0.4 * mB)), lowW);
// conifer forest on the lower slopes (foothills, valley sides), ragged upper edge, clearings
float forW = smoothstep(tl + 40.0, tl - 160.0, Ya + 90.0 * strk) * smoothstep(0.74, 0.52, slopeZ + 0.10 * mC + 0.06 * strk2)
           * smoothstep(-0.8, -0.4, mB + 0.40 * mA + 0.25 * mC) * smoothstep(40.0, 140.0, P.y) * uFarRock.y
           * smoothstep(-0.25, 0.25, 0.8 * mC + 0.5 * strk2 + 0.35 * cv + (tl - 250.0 - Ya) / 450.0);   // r5 look
vec3 forC = mix(vec3(0.026, 0.038, 0.020), vec3(0.055, 0.068, 0.036), smoothstep(-0.5, 0.6, mC));
float ffo = 1.0 - smoothstep(4.0, 14.0, fp);
forC *= 0.70 + (ffo > 0.0 ? 0.55 * smoothstep(-0.7, 0.7, cgSnoise(P * 0.045)) * ffo : 0.0);
fc = mix(fc, forC, forW);
// snow: altitude line broken by couloirs and ribs, held on gentler ground and in concave gullies,
// shed by steep rock; crisp edges
// r4: the hold test uses a SMOOTHED far-grid normal / curvature (≈ 100 m footprint) and local relief, so
// snow forms continuous fields broken by rock ribs and steep faces (refs 5/9); the facet normals (Nfc)
// only light the rock (they made the snow a speckle at telephoto)
float sl = uSnowLine + 170.0 * mA + 110.0 * mB;
float snowF = 0.0;
// r5 perf: upper bound of hs (slopeS ≥ 0, |cvS| ≤ 3, |strk|, |strk2| ≤ 1.2) and of the couloir / powder
// heights: below it every snow term is exactly 0 (and the 5 smoothed far-grid fetches are not needed)
if (P.y + 88.0 + 330.0 + 108.0 + 48.0 + 140.0 * mB + 50.0 * mC >= sl - 60.0 || P.y + 300.0 >= sl + 80.0) {
float slopeS = slope, cvS = cv, relief = 0.0;
if (fw > 0.001) {
  float rr = uFarInfo.z * 3.0;
  vec4 F0 = texture2D(uFarTex, tFarUV(P.xz));
  vec4 Fa = texture2D(uFarTex, tFarUV(P.xz + vec2(rr, 0.0))), Fb = texture2D(uFarTex, tFarUV(P.xz - vec2(rr, 0.0)));
  vec4 Fc = texture2D(uFarTex, tFarUV(P.xz + vec2(0.0, rr))), Fd = texture2D(uFarTex, tFarUV(P.xz - vec2(0.0, rr)));
  vec4 FS = (Fa + Fb + Fc + Fd) * 0.17 + F0 * 0.32;
  vec3 nS = normalize(vec3(FS.x, sqrt(max(0.02, 1.0 - FS.x * FS.x - FS.y * FS.y)), FS.y));
  slopeS = mix(slope, 1.0 - nS.y, fw);
  cvS = mix(cv, clamp(FS.w, -3.0, 3.0), fw);
  relief = (F0.z - 0.25 * (Fa.z + Fb.z + Fc.z + Fd.z)) * 8.0 * fw;   // m above the 48 m neighbourhood: + ridge / rib
}
float hs = P.y + 220.0 * (0.4 - slopeS) + 110.0 * cvS + 90.0 * strk + 40.0 * strk2 + 140.0 * mB + 50.0 * mC;
float snowA = smoothstep(sl - 40.0, sl + 40.0, hs);
// snow holds on gentle and concave ground; steep faces and sharp ribs stay rock (rock dominant on the walls)
// r5: less snow on the walls (refs 1/5/9: sunlit tan rock faces dominate, snow in the gullies, on ledges and
// on the gentler upper fields), more in concave gullies
float hold = 0.21 + 0.10 * cvS + 0.07 * smoothstep(sl, sl + 1000.0, P.y) + 0.07 * strk2 + 0.04 * strk + 0.03 * mB;
float ribs = smoothstep(3.0, 12.0, relief + 3.0 * strk2) * smoothstep(0.18, 0.40, slopeS);
float snowS = smoothstep(hold + 0.05, hold - 0.05, slopeS + 0.12 * ribs);
snowF = snowA * snowS;
// streaks of snow down the couloirs of the steep upper faces (smoothed gullies, not facets)
float coul = smoothstep(0.30, 0.70, strk2 * 0.6 + strk * 0.2 + 0.25 * cvS - 0.04 * relief);
snowF = max(snowF, smoothstep(sl + 100.0, sl + 500.0, P.y + 250.0 * strk) * coul * smoothstep(0.80, 0.55, slopeS) * 0.9);
// powder plastered on the upper walls near the summits (partial, follows the smoothed form)
snowF = max(snowF, smoothstep(sl + 600.0, sl + 1200.0, P.y + 300.0 * strk) * smoothstep(0.42, 0.30, slopeS + 0.10 * strk2 + 0.04 * ribs) * 0.75);
// rock ribs break the fields (thin dark lines down the snow, refs 5/9)
snowF *= 1.0 - 0.75 * ribs * smoothstep(0.25, 0.6, strk2 + 0.3) * smoothstep(0.25, 0.45, slopeS);
// r5: strata steps through the snow on moderately steep ground (snow on the ledge tops, rock on the risers)
snowF *= 1.0 - 0.4 * (1.0 - band) * smoothstep(0.16, 0.32, slopeS) * smoothstep(0.2, 0.6, strk2 + 0.6);
}
vec3 snowCol = vec3(0.85, 0.87, 0.91) * (0.95 + 0.05 * mC);
fc = mix(fc, snowCol, snowF);
float ffh = forW * (1.0 - smoothstep(3.0, 9.0, fp));
float farHgt = (7.0 * strk + 2.2 * strk2 + 0.6 * strk3) * (1.0 - 0.75 * snowF) * (1.0 - forW * 0.8)
             + (ffh > 0.0 ? 2.0 * cgSnoise(P * 0.09) * ffh : 0.0);
float farRough = mix(0.88, 0.62, snowF);
col = mix(col, fc, fwM);
hgt = mix(hgt, farHgt, fwM);
rough = mix(rough, farRough, fwM);
ao = mix(ao, 1.0 - 0.25 * smoothstep(0.3, 2.5, cv), fwM);
// lighting normal: rock facets (snow drapes them more smoothly, forest canopy is its own texture)
tN = normalize(mix(tN, mix(Nfc, normalize(Nfc + 2.0 * N), 0.85 * snowF), fwM * (1.0 - 0.85 * forW) * (1.0 - 0.6 * medW)));
}   // fwM > 0


// ---------------- sunken era: pale rippled sand on every up-facing surface, algae turf on the rock
if (uEra > 0.5) {
  float below = smoothstep(uSurf + 0.3, uSurf - 1.2, P.y);
  if (below > 0.0) {
    float upG = clamp(cgN.y, 0.0, 1.0);
    float sn = stFbm(P * 0.09 + 11.0, 3, fp * 0.09, 0.5);
    // sand settles on gentle ground and ledges, in crevices, against the faces; steep rock stays bare
    float sandW = max(smoothstep(0.55, 0.86, upG + 0.18 * sn - 0.12 * rockA + 0.10 * cav), smoothstep(0.02, 0.25, sandFill));
    // on the land (plateau, ledges, ring tops above the old sea level) the sand is a thin patchy film
    // (≈ 35 % cover, drifts in hollows / against faces); the deep fill is in the rings, canal and sea bed
    float landF = smoothstep(-1.0, 1.5, P.y) * (1.0 - smoothstep(0.02, 0.25, sandFill));
    float patchN = stFbm(P * 0.11 + 41.0, 3, fp * 0.11, 0.55) + 0.35 * cgSnoise(P * 0.6 + 3.0) * (1.0 - smoothstep(0.1, 0.5, fp)) + 0.5 * cav;
    float patchy = smoothstep(0.08, 0.32, patchN);
    sandW *= mix(1.0, patchy, landF);
    sandW = clamp(sandW, 0.0, 1.0);
    // sand colour: pale, slightly warm, darker coarse patches and shell-grit speckle
    vec3 sc = uSandColor * (0.90 + 0.10 * mB + 0.06 * mC) * (0.94 + 0.08 * mD);
    sc = mix(sc, sc * vec3(0.80, 0.80, 0.76), smoothstep(0.2, 0.6, sn) * 0.45);
    sc *= 1.0 + 0.10 * smoothstep(0.5, 0.9, cgSnoise(P * 9.0)) * (1.0 - smoothstep(0.01, 0.04, fp));
    // ripples: wave ripples ~0.35 m, megaripples ~1.8 m; crests run across a slowly turning direction
    float ra = 1.2 + 0.9 * cgSnoise(vec3(P.xz * 0.012, 3.0));
    vec2 rd = vec2(cos(ra), sin(ra));
    float ph = dot(P.xz, rd) + 0.9 * cgSnoise(vec3(P.xz * 0.22, 1.0)) + 0.22 * cgSnoise(vec3(P.xz * 0.9, 5.0));
    float brk = smoothstep(-0.35, 0.45, cgSnoise(vec3(P.xz * 0.42, 7.0)) + 0.3 * cgSnoise(vec3(P.xz * 1.7, 9.0)));
    float r1 = 1.0 - abs(sin(ph * 3.14159 / (0.30 + 0.12 * smoothstep(-0.5, 0.5, cgSnoise(vec3(P.xz * 0.05, 4.0))))));
    float r2 = 1.0 - abs(sin((ph * 0.9 + 0.5 * cgSnoise(vec3(P.xz * 0.08, 2.0))) * 3.14159 / 1.8));
    float rh = (0.012 * r1 * r1 * brk * (1.0 - smoothstep(0.006, 0.025, fp)) + 0.05 * r2 * (1.0 - smoothstep(0.06, 0.25, fp))) * uRipple;
    sc *= 1.0 - 0.025 * r1 * brk * (1.0 - smoothstep(0.012, 0.05, fp));
    // sea grass / algae fuzz patches on the sand (the marine module adds the real blades)
    float sg = smoothstep(0.45, 0.75, stFbm(P * 0.06 + 31.0, 3, fp * 0.06, 0.5) + 0.25 * cgSnoise(P * 0.5));
    sc = mix(sc, vec3(0.12, 0.15, 0.07), sg * 0.45);
    // rock: algae turf (olive / green), darker, crevices near black, pale coralline speckle
    vec3 rk = col * vec3(0.62, 0.68, 0.56);
    float turf = smoothstep(-0.3, 0.5, stFbm(P * 0.21 + 3.0, 3, fp * 0.21, 0.5) + 0.3 * upG);
    rk = mix(rk, mix(vec3(0.10, 0.10, 0.05), vec3(0.08, 0.13, 0.07), smoothstep(-0.4, 0.5, mC)), turf * 0.7);
    rk = mix(rk, vec3(0.42, 0.33, 0.33), smoothstep(0.62, 0.8, cgSnoise(P * 1.4 + 7.0)) * 0.35 * (1.0 - turf));
    rk *= 1.0 - 0.5 * smoothstep(0.4, 0.9, cav);
    vec3 sk = mix(rk, sc, sandW);
    col = mix(col, sk, below);
    hgt = mix(hgt, mix(hgt * 0.8 + 0.04 * turf, rh, sandW), below);
    rough = mix(rough, mix(0.9, 0.97, sandW), below);
    tN = normalize(mix(tN, normalize(mix(tN, cgN, 0.6)), below * sandW));
  }
}

diffuseColor.rgb = max(col, vec3(0.0));
if (uTDebug > 0.5) { diffuseColor.rgb = vec3(0.5); ao = 1.0; }
if (uTDebug > 1.5) { diffuseColor.rgb = vec3(citS, pwW, 0.0); }   // zone debug (citadel hillside / plateau wall)
if (uTDebug > 2.5) { diffuseColor.rgb = tDbg * 0.8 + 0.1; }      // r5: evaluated layers (r rock, g mountains, b near field)
tBump = hgt * uTBump; tRough = rough; tAO = ao; tFW = fw;
cgAO = ao;
`;

/** terrain material (one program for near and far terrain) */
export function terrainMaterial(era = 'golden') {
  TERRAIN_UNIFORMS.uEra.value = era === 'sunken' ? 1 : 0;
  const mat = proceduralMaterial({
    name: 'terrain',
    params: { color: 0xffffff, roughness: 0.92, metalness: 0 },
    uniforms: TERRAIN_UNIFORMS,
    vertexHead: 'attribute vec4 aTer;\nvarying vec4 vTer;',
    vertexPre: 'vTer = vec4(aTer.xy, aTer.z * 90.0 - 30.0, aTer.w);',
    head: HEAD,
    color: COLOR,
    roughness: 'roughnessFactor = tRough;',
    normal: 'cgBump = stBumpNormal(cgP, tN, tBump) - cgN;',
    ao: '/* cgAO set in colour hook */',
  });
  mat.userData.sunken = 'none';   // the terrain draws its own sand / algae (core/sunken.js overlay off)
  // multiply the direct sun by the far-field heightfield shadow (mountains are beyond the CSM range)
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    const chunk = THREE.ShaderChunk.lights_fragment_begin.replace(/RE_Direct\( directLight,/g, 'directLight.color *= tSunVis; RE_Direct( directLight,');
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec3 Ls = normalize(uTSun);
  vec2 lh = Ls.xz;
  float away = clamp(-dot(tN.xz, lh) / max(length(lh), 1e-3), -1.0, 1.0);
  float vf = 0.5 * (1.0 - tN.y) * (0.65 + 0.35 * away) * (1.0 - tFW);
  vec3 Eb = uTSunIrr * max(Ls.y, 0.08) * uTBounce * vf;
  reflectedLight.indirectDiffuse += Eb * BRDF_Lambert(diffuseColor.rgb);
  // r5 look: cool skylight on the far range (ref 1: shaded mountain faces blue-grey, not brown)
  reflectedLight.indirectDiffuse += uFarSky.rgb * (uFarSky.w * dot(uTSunIrr, vec3(0.333)) * tFW * (0.55 + 0.45 * tN.y)) * BRDF_Lambert(diffuseColor.rgb);
}`);
  };
  mat.userData.shaderKey = (mat.userData.shaderKey || '') + '|tSunVis|bounce';
  return mat;
}

/** hook the far-grid texture into the terrain material */
export function setFarTexture(tex, g) {
  TERRAIN_UNIFORMS.uFarTex.value = tex;
  TERRAIN_UNIFORMS.uFarInfo.value.set(g.x0, g.z0, g.cell, 1);
  TERRAIN_UNIFORMS.uFarSize.value.set(g.nx, g.nz);
  // r5: highest grid point (+ half-float rounding margin of the h/8 texture channel)
  let mx = -1e9; const d = g.data; for (let i = 0; i < d.length; i++) if (d[i] > mx) mx = d[i];
  TERRAIN_UNIFORMS.uFarMaxH.value = mx * (1 + 1 / 512) + 2;
}
