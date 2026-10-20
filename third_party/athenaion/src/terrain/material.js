// Terrain ground shader: world-space procedural layers (limestone rock, dry grass, green scrub, soil,
// stony soil, shore sand, wet rock, sea bed, forest canopy and snow for the far mountains), with
// coherent macro variation at 100 m – 5 km and detail down to centimetres near the camera.
// Vertex attribute aTer = (crevice, rockiness, water distance, outcrop) from the mesher.
// Far field: per-pixel normals, curvature and heightfield sun shadows from the eroded far-grid
// texture (RGBA16F: normal.x, normal.z, height/8, curvature), since mountains are beyond the CSM range.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { ATMO } from '../core/atmosphere.js';
import { STONE_GLSL, ST_ONE } from '../materials/stone.js';
import { SKY } from '../core/sky.js';

export const TERRAIN_UNIFORMS = {
  uSnowLine: { value: 1650 },   // r4: was 1750 (upper ~half of the hero white, refs 5/9); per shot in looks.js 'terrain'
  uRockTint: { value: new THREE.Color(1, 1, 1) },
  uGroundTint: { value: new THREE.Color(1, 1, 1) },
  uFarTex: { value: null },
  uFarInfo: { value: new THREE.Vector4(0, 0, 16, 0) },   // x0, z0, cell, enabled
  uFarSize: { value: new THREE.Vector2(1, 1) },          // nx, nz
  uTSun: ATMO.uSunDir,                                   // shared: toward the sun
  uStOne: ST_ONE,
  uTBump: { value: 1 },                                  // bump strength (debug / look tuning)
  uTDebug: { value: 0 },                                 // 1: flat 0.5 albedo, no AO (lighting check)
  // one-bounce sunlight from the lit surroundings (canyon walls, valley floor) onto shaded rock: the
  // rasteriser has no GI, so shaded cliffs in gorges went near-black. = average albedo of the lit
  // surroundings (0 = off); look-dev may tune it per shot.
  uTBounce: { value: 0.4 },
  uTSunIrr: SKY.uSunIrr,
  uFarTint: { value: new THREE.Color(1.06, 1.0, 0.9) },   // r4: far rock / scree tint (refs: warm tan sunlit rock on the range)
};

const HEAD = /* glsl */ `
uniform float uSnowLine;
uniform vec3 uRockTint;
uniform vec3 uFarTint;
uniform vec3 uGroundTint;
uniform sampler2D uFarTex;
uniform vec4 uFarInfo;
uniform vec2 uFarSize;
uniform vec3 uTSun;
uniform float uTBump;
uniform float uTDebug;
uniform float uTBounce;
uniform vec3 uTSunIrr;
varying vec4 vTer;
${STONE_GLSL}
float tBump; float tRough; float tAO; float tSunVis = 1.0; vec3 tN; float tFW = 0.0;
// procedural rock facets (sub-texel geometry for the far range): voronoi cells, each a flat facet with
// its own orientation (some tilted up into snow-holding ledges) → crisp lit/shadow patchwork
vec3 tFacetN(vec3 P, vec3 N, float fp, float scale, float amp, float seed) {
  vec3 q = P / scale * vec3(1.0, 1.5, 1.0) + seed;
  vec3 fpos; vec3 cc = stCell(q, fpos);
  vec3 t = cgHash33(fpos * 7.13 + 1.7 + seed) - 0.5;
  vec3 tp = t - N * dot(t, N);
  float w = amp * (1.0 - smoothstep(scale * 0.3, scale * 0.8, fp));
  vec3 n2 = normalize(N + tp * 2.2 * w);
  float ledge = step(0.72, cgHash13(fpos * 3.7 + seed)) * w;   // up-tilted ledge facets
  return normalize(mix(n2, normalize(N + vec3(0.0, 1.6, 0.0)), ledge * 0.8));
}
// limestone cliff shading (near/mid field), refs 3 / 7 / 9: warm cream-white limestone with block-to-block
// tone, grey weathered masses and buff/ochre stains; near-vertical joints and bedding cracks from an
// anisotropic cell network (facet normals per block), karren flutes, crisp dark crevices (mesh cavity +
// joints), grey-black rain streaks running down from ledges and joints, lichen speckle, moss in shade.
// Albedo contrast is strong on purpose: it must survive a frontal sun (no shading contrast then).
vec3 tlAlb; float tlH; float tlRgh; float tlAO; vec3 tlN;
void tLime(vec3 p, vec3 n, float cav, float fp) {
  float vert = 1.0 - abs(n.y);
  float upw = clamp(n.y, 0.0, 1.0);
  float m1 = stFbm(p * 0.028 + 1.7, 3, 0.0, 0.5);
  float m2 = stFbm(p * 0.095 + vec3(11.0, 3.0, 7.0), 3, 0.0, 0.5);
  float m3 = cgSnoise(p * 0.45 + 2.0) * (1.0 - smoothstep(0.3, 0.8, fp));   // (band-limited: 2 m noise = pixel speckle at 300+ m)
  // r5: richer, warmer palette (sunlit limestone warm cream, not pale grey; weathered masses blue-grey;
  // buff / honey and rust-orange stains saturated enough to survive the haze at 300–900 m) — ref 8 crag
  // mid / bright (142,125,109) / (223,194,169), chroma ≈ 34
  vec3 cream = vec3(0.630, 0.555, 0.440);
  vec3 bone  = vec3(0.680, 0.645, 0.575);
  vec3 grey  = vec3(0.340, 0.340, 0.338);
  vec3 buff  = vec3(0.580, 0.415, 0.235);
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
  float wv = cgSnoise(p * 0.07 + 3.0);
  if (fadeB > 0.0) {
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
    crk = max(crk, (1.0 - smoothstep(0.0, 0.05 + fp * 0.05, abs(fract(ybk) - 0.5))) * bseg * smoothstep(0.5, 0.9, vert) * 0.85 * fadeB);
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
  float fl1 = cgSnoise(vec3(p.x * 0.9, p.y * 0.07, p.z * 0.9));
  float fl2 = cgSnoise(vec3(p.x * 0.28, p.y * 0.025, p.z * 0.28) + 5.0);
  // (bump terms band-limited to ≥ ~5 px wavelength: the derivative bump is constant per 2×2 pixel quad)
  float h = 0.10 * stFbm(p * 0.6, 5, fp * 0.6 * 2.6, 0.55) * fade;
  h += (0.10 * fl1 * (1.0 - smoothstep(0.06, 0.22, fp)) + 0.22 * fl2 * (1.0 - smoothstep(0.3, 1.0, fp))) * vert;
  h -= crk * 0.14 * (1.0 - smoothstep(0.006, 0.02, fp));
  // ---- r5 meso relief (normal-only bump, 4–60 m): at 100–1500 m the mesh is 1–4 m and the fine bump has
  // faded, so the faces read smooth. Karst columns with sharp V-grooves, bedding beds (lit ledge strip on
  // top, dark undercut below), buttresses — each term band-limited (fades below ~6 px wavelength) so it
  // shades crisply (screen-derivative bump) without aliasing. Colour follows the same structure.
  float vW = smoothstep(0.30, 0.75, vert);
  vec3 qm = p + vec3(5.0, 0.0, 5.0) * cgSnoise(p * 0.012 + 2.0);
  float mf13 = 1.0 - smoothstep(13.0 * 0.11, 13.0 * 0.22, fp);
  float mf5 = 1.0 - smoothstep(5.0 * 0.11, 5.0 * 0.22, fp);
  float mf4 = 1.0 - smoothstep(4.5 * 0.11, 4.5 * 0.22, fp);
  float mf15 = 1.0 - smoothstep(15.0 * 0.11, 15.0 * 0.22, fp);
  float mf40 = 1.0 - smoothstep(40.0 * 0.11, 40.0 * 0.22, fp);
  float gC = cgSnoise(vec3(qm.x * 0.072, qm.y * 0.011, qm.z * 0.072) + 31.0);           // ≈ 14 m columns
  float gF = cgSnoise(vec3(qm.x * 0.19, qm.y * 0.03, qm.z * 0.19) + 17.0);              // ≈ 5 m flutes
  float groove = (1.0 - smoothstep(0.0, 0.16, abs(gC))) * mf13 + 0.6 * (1.0 - smoothstep(0.0, 0.12, abs(gF))) * mf5;
  float hM = 2.4 * (sqrt(abs(gC)) - 0.55) * mf13 + 0.65 * (sqrt(abs(gF)) - 0.55) * mf5;
  // beds: ≈ 4.5 m and ≈ 15 m (warped, discontinuous); profile = undercut, face, set-back ledge
  float ybA = qm.y / 4.6 + 0.9 * cgSnoise(vec3(qm.xz * 0.018, 5.0)) + 0.15 * gC;
  float fbA = fract(ybA);
  float segA = smoothstep(-0.25, 0.25, cgSnoise(vec3(qm.x * 0.035, floor(ybA) * 0.37, qm.z * 0.035) + 8.0));
  float ybB = qm.y / 15.0 + 0.7 * cgSnoise(vec3(qm.xz * 0.008, 9.0));
  float fbB = fract(ybB);
  float segB = smoothstep(-0.35, 0.15, cgSnoise(vec3(qm.x * 0.015, floor(ybB) * 0.53, qm.z * 0.015) + 3.0));
  float undA = 1.0 - smoothstep(0.0, 0.14, fbA), ledA = smoothstep(0.84, 1.0, fbA);
  float undB = 1.0 - smoothstep(0.0, 0.10, fbB), ledB = smoothstep(0.90, 1.0, fbB);
  hM -= (0.55 * (undA + ledA) * segA * mf4 + 1.6 * (undB + ledB) * segB * mf15);
  // buttresses / recesses (40–50 m) and rounded masses (≈ 20 m): strong with distance, where the mesh has no
  // such relief left (a face lit at a grazing angle otherwise reads as one flat grey plane, refs 3/9 crags)
  float farM = 0.45 + 0.55 * smoothstep(80.0, 320.0, length(cameraPosition - p));
  float bigN = cgSnoise(p * vec3(0.021, 0.008, 0.021) + 41.0);
  float midN = cgSnoise(p * vec3(0.05, 0.022, 0.05) + 13.0);
  hM += (7.0 * bigN * mf40 + 2.6 * midN * (1.0 - smoothstep(20.0 * 0.11, 20.0 * 0.22, fp))) * farM;
  h += hM * vW;
  c *= 1.0 + 0.10 * (bigN + 0.6 * midN) * vW;   // proud masses fresher, recesses greyer
  // colour on the same structure: grooves dark and damp, undercuts shadowed and stained, ledge strips
  // paler (fresh) or green with tufts
  float undW = max(undA * segA * mf4, undB * segB * mf15) * vW;
  float ledW = max(ledA * segA * mf4, ledB * segB * mf15) * vW;
  float farL = smoothstep(0.3, 1.5, fp);   // sub-pixel dark detail averages into grey murk at distance: damp it there
  c *= 1.0 - (0.32 * groove * vW + 0.25 * undW) * (1.0 - 0.4 * farL);
  c = mix(c, bone * 1.04, ledW * 0.35 * smoothstep(-0.2, 0.4, m2));
  // bedding: faint horizontal bands
  float yb = p.y * 0.42 + 1.4 * cgSnoise(vec3(p.xz * 0.04, 3.3)) + 0.3 * cgSnoise(p * 0.25);
  c *= mix(1.0, 0.84 + 0.26 * smoothstep(-0.6, 0.6, cgSnoise(vec3(p.x * 0.01, yb * 0.3, p.z * 0.01))), 0.7 * vert);
  // mesh cavity is vertex-interpolated (0.5–2 m cells): sharpen it and break its edges so crevices read
  // as crisp irregular dark gaps, not soft smudges
  float cavN = cav + 0.22 * cgSnoise(p * vec3(1.3, 0.6, 1.3) + 4.0) * (1.0 - smoothstep(0.3, 1.5, fp));
  // the far crags carry the 2× coarse rock on 2 m cells (field.js rockBlend): their cavity is too soft to
  // darken the albedo much (it would read as smudges), the AO keeps it
  float far2 = smoothstep(270.0, 430.0, length(p.xz - vec2(10.0, 40.0)));
  float cv = clamp(max(0.85 * smoothstep(0.42, 0.75, cavN) * (1.0 - 0.6 * far2), crk), 0.0, 1.0);
  // ---- weathering colour: grey-black rain streaks hanging from joints and ledges
  float sk = cgSnoise(vec3(p.x * 0.35, p.y * 0.016, p.z * 0.35)) * 0.6 + cgSnoise(vec3(p.x * 1.1, p.y * 0.045, p.z * 1.1)) * 0.4 * (1.0 - smoothstep(0.15, 0.45, fp));
  float skL = cgSnoise(vec3(p.x * 0.12, p.y * 0.007, p.z * 0.12) + 5.5);
  float streak = smoothstep(0.12, 0.5, sk) * smoothstep(0.35, 0.85, vert) * (0.55 + 0.45 * smoothstep(-0.3, 0.4, skL));
  // r5: wide grey-black curtains (6–12 m) hanging from the grooves and beds, visible from a kilometre
  float skC = cgSnoise(vec3(qm.x * 0.085, qm.y * 0.0045, qm.z * 0.085) + 23.0) + 0.35 * groove;
  float curtain = smoothstep(0.25, 0.75, skC) * smoothstep(0.35, 0.85, vert) * smoothstep(-0.4, 0.3, skL);
  streak = max(streak, curtain * 0.6);
  c = mix(c, c * vec3(0.30, 0.31, 0.33), streak * 0.75 * (1.0 - 0.35 * farL));
  // ochre / orange iron stains below cracks
  float och = smoothstep(0.45, 0.85, cgSnoise(vec3(p.x * 0.07, p.y * 0.02, p.z * 0.07) + 13.0) + 0.3 * m2);
  c = mix(c, c * vec3(1.18, 0.86, 0.58), och * 0.55 * vert);
  // crevices: near-black, damp
  c *= 1.0 - 0.82 * cv * cv - 0.12 * cv;
  float lm = smoothstep(0.0, 0.6, stFbm(p * 0.3 + 4.0, 3, fp * 0.3, 0.5) + 0.3 * upw);
  float spkW = 1.0 - smoothstep(0.02, 0.07, fp);
  c = mix(c, vec3(0.09, 0.09, 0.085), smoothstep(0.4, 0.75, cgSnoise(p * 8.0)) * lm * spkW * 0.7);
  c *= 1.0 - 0.15 * lm * (1.0 - spkW);
  c = mix(c, vec3(0.55, 0.50, 0.30), smoothstep(0.55, 0.8, cgSnoise(p * 1.9 + 9.0)) * lm * 0.35);   // yellow lichen
  c = mix(c, vec3(0.62, 0.62, 0.60), smoothstep(0.62, 0.85, cgSnoise(p * 1.3 + 2.0)) * (1.0 - lm) * 0.25); // white lichen
  float mossN = stFbm(p * 0.35 + 21.0, 3, fp * 0.35, 0.5);
  // moss on up-facing ledges, in crevices, and on the damp north-facing (shaded) faces and their bases
  float northF = smoothstep(0.0, -0.7, n.z) * vert;
  float moss = smoothstep(0.45, 0.9, upw * 0.9 + cv * 0.2 + 0.45 * mossN + 0.35 * northF * (0.5 + 0.5 * mossN));
  // r5: green tufts on the bed ledges and in the grooves (clumps, not a film)
  float tuftN = cgSnoise(qm * vec3(0.32, 0.6, 0.32) + 12.0) + 0.4 * mossN;
  moss = max(moss, smoothstep(0.15, 0.55, tuftN) * max(ledW, 0.6 * groove * vW));
  c = mix(c, mix(vec3(0.050, 0.072, 0.022), vec3(0.135, 0.145, 0.045), smoothstep(-0.3, 0.6, mossN)), moss * 0.85);
  // tufts stand out of the rock: lumpy relief + sunlit flecks (near field only)
  float tfN = cgSnoise(p * 2.7 + 4.4);
  h += moss * (0.10 + 0.12 * tfN) * (1.0 - smoothstep(0.05, 0.25, fp));
  c *= 1.0 + moss * 0.35 * smoothstep(0.3, 0.8, tfN) * (1.0 - smoothstep(0.05, 0.25, fp));
  tlAlb = max(c, vec3(0.0)); tlH = h; tlRgh = 0.86 + 0.06 * m3; tlAO = (1.0 - 0.6 * cv) * (1.0 - 0.35 * groove * vW - 0.25 * undW); tlN = nb;
}


vec2 tFarUV(vec2 xz) { return ((xz - uFarInfo.xy) / uFarInfo.z + 0.5) / uFarSize; }
bool tInFar(vec2 uv) { return uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0; }
// weight of the far field (matches heightfield.js farWeight)
float tFarW(vec2 xz) {
  vec2 q = abs(xz + vec2(400.0, 150.0)) - vec2(1450.0, 1400.0);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  return smoothstep(250.0, 900.0, d);
}
float tFarShadow(vec3 P, vec3 L) {
  if (L.y <= 0.01) return 0.0;
  float t = 14.0, vis = 1.0;
  int ns = int(42.0 * uStOne);
  for (int i = 0; i < ns; i++) {
    vec3 q = P + L * t;
    if (q.y > 4200.0) break;
    vec2 uv = tFarUV(q.xz);
    if (!tInFar(uv)) break;
    float h = texture2D(uFarTex, uv).b * 8.0;
    vis = min(vis, clamp((q.y - h) / (t * 0.035 + 2.0), 0.0, 1.0));
    if (vis <= 0.0) break;
    t *= 1.19;
  }
  return vis;
}
`;

const COLOR = /* glsl */ `
vec3 P = cgP;
vec3 N = cgN;
float fp = max(length(fwidth(P)), 1e-3);
float cav = vTer.x, rockA = vTer.y, wd = vTer.z, outc = vTer.w;
float camD = length(cameraPosition - P);
float curv = 0.0;

// ---------------- far field: per-pixel normal, curvature, sun shadow from the eroded grid
float fw = 0.0;
if (uFarInfo.w > 0.5) {
  vec2 fuv = tFarUV(P.xz);
  fw = tInFar(fuv) ? tFarW(P.xz) : 0.0;
  if (fw > 0.0) {
    vec4 F = texture2D(uFarTex, fuv);
    vec3 nF = normalize(vec3(F.x, sqrt(max(0.02, 1.0 - F.x * F.x - F.y * F.y)), F.y));
    N = normalize(mix(N, nF, fw));
    curv = F.w * fw;
    if (camD > 1500.0) tSunVis = mix(1.0, tFarShadow(P + vec3(0.0, 3.0, 0.0), normalize(uTSun)), fw * smoothstep(1500.0, 2600.0, camD));
  }
}
tN = N;
float slope = 1.0 - clamp(N.y, 0.0, 1.0);

// ---------------- macro fields (coherent over hundreds of metres to kilometres)
float mA = stFbm(P * 0.0019, 3, 0.0, 0.5);
float mB = stFbm(P * 0.0105 + 3.0, 3, 0.0, 0.5);
float mC = stFbm(P * 0.062 + 7.0, 3, 0.0, 0.5);
float nearW = 1.0 - smoothstep(0.06, 0.35, fp);
float mD = cgSnoise(P * 0.55 + 1.3) * (1.0 - smoothstep(0.25, 0.9, fp));
float mE = cgSnoise(P * 2.3 + 5.1) * nearW;

// ---------------- ground (soil / grass / scrub)
float moist = 0.48 + 0.30 * mA + 0.22 * mB + 0.30 * smoothstep(30.0, 3.0, wd) + 0.12 * (-N.z) + 0.10 * cav + 0.04 * curv;
vec3 dryG   = vec3(0.150, 0.130, 0.068);   // straw-coloured dry grass
vec3 gold   = vec3(0.215, 0.168, 0.082);
vec3 greenG = vec3(0.060, 0.078, 0.032);
vec3 scrub  = vec3(0.026, 0.038, 0.017);
vec3 soil   = vec3(0.185, 0.130, 0.080);   // ochre-brown soil
vec3 stony  = vec3(0.335, 0.310, 0.262);   // limestone gravel / pavement
vec3 g = mix(dryG, greenG, smoothstep(0.25, 0.75, moist + 0.18 * mC));
g = mix(g, gold, smoothstep(0.40, 0.85, mC + 0.4 * mD) * smoothstep(0.55, 0.2, moist) * 0.55);
// maquis: dark shrub clumps (2-8 m) scattered through the grass, denser where moist and on slopes
float clump = cgSnoise(P * vec3(0.22, 0.3, 0.22) + 3.1) + 0.5 * cgSnoise(P * 0.61 + 8.2) * (1.0 - smoothstep(0.3, 1.2, fp));
float scrubW = smoothstep(0.0, 0.55, 0.55 * mB + 0.65 * mC + 0.30 * moist - 0.1) * smoothstep(0.7, 0.35, slope);
scrubW = max(scrubW * 0.85, smoothstep(0.2, 0.75, clump + 0.25 * mB + 0.15 * moist) * 0.5);
g = mix(g, scrub * (1.2 + 0.6 * smoothstep(-0.5, 0.8, mE)), scrubW);
float soilW = smoothstep(0.18, 0.5, slope + 0.22 * mC + 0.12 * mD);
g = mix(g, soil, soilW * 0.7);
g = mix(g, stony, smoothstep(0.35, 0.85, mC * 0.7 + mD * 0.5 + slope * 0.5) * 0.45);
// (near ground, refs 3 / 8 / 9) worn ground: bare soil and limestone gravel paths through the grass,
// limestone slabs breaking the surface (cracked pavement-like outcrop), pebbles, grass tufts
float bareN = stFbm(P * 0.065 + vec3(2.0, 0.0, 7.0), 4, fp * 0.065, 0.55) + 0.30 * mC - 0.25 * moist + 0.25 * smoothstep(0.15, 0.4, slope);
float bareW = smoothstep(0.05, 0.30, bareN + 0.08 * mD) * (1.0 - fw);
float gH0 = 0.0;
if (fp < 0.6) {
  float nd = 1.0 - smoothstep(0.15, 0.6, fp);
  float ndS = 1.0 - smoothstep(0.04, 0.16, fp), ndP = 1.0 - smoothstep(0.01, 0.05, fp);
  vec3 vs = cgVoronoi2(P.xz * 0.75 + 0.35 * vec2(mD, mE));            // slabs ≈ 1.3 m
  float slab = smoothstep(0.10, 0.10 + 0.15 + fp * 1.5, vs.y - vs.x) * smoothstep(0.45, 0.6, vs.z) * smoothstep(0.1, 0.45, bareN + 0.25 * mC) * ndS;
  vec3 vp = cgVoronoi2(P.xz * 3.1 + 7.0);                              // pebbles ≈ 0.3 m
  float peb = smoothstep(0.62, 0.30, vp.x) * smoothstep(0.4, 0.5, vp.z) * ndP;
  vec3 ground = mix(soil * (0.85 + 0.3 * vp.z), stony * (0.8 + 0.3 * vp.z), peb * 0.75);
  ground = mix(ground, mix(stony, vec3(0.42, 0.40, 0.36), vs.z) * (0.82 + 0.25 * cgSnoise(P * 2.7)), slab);
  g = mix(g, ground, bareW * nd);
  // grass tufts / blades texture in the grass (fine bright-dark streak pattern)
  float tuft = cgSnoise(vec3(P.x * 3.3, P.y * 1.5, P.z * 3.3)) * 0.5 + cgSnoise(P * 9.0) * 0.5;
  g *= mix(1.0, 0.72 + 0.45 * smoothstep(-0.6, 0.6, tuft), (1.0 - bareW) * nd);
  gH0 = (0.05 * slab * (1.0 - smoothstep(0.01, 0.04, fp)) + 0.03 * peb * bareW * (1.0 - smoothstep(0.004, 0.012, fp))) * nd;
} else {
  g = mix(g, mix(soil, stony, 0.45), bareW * 0.6);
}
g *= 1.0 + 0.16 * mD + 0.10 * mE;
g *= uGroundTint;
float gH = 0.025 * mD * (1.0 - smoothstep(0.1, 0.35, fp)) + 0.012 * mE * (1.0 - smoothstep(0.02, 0.08, fp)) + 0.10 * clump * (1.0 - smoothstep(0.2, 0.6, fp)) + gH0;

// ---------------- rock
float rockW = max(rockA, smoothstep(0.42, 0.66, slope + 0.10 * mC - 0.02 * curv));
// scree / stony debris on talus slopes below cliffs
vec3 scree = mix(stony * 0.8, soil, 0.35 + 0.3 * mD);
scree = mix(scree, scrub, smoothstep(-0.1, 0.5, mC + 0.3 * mB) * 0.7);
g = mix(g, scree, smoothstep(0.12, 0.30, slope) * smoothstep(0.62, 0.42, slope) * (1.0 - fw));
rockW = max(rockW, smoothstep(0.05, 0.45, outc));
float alt = smoothstep(250.0, 1400.0, P.y);
tLime(P, N, cav, fp);
vec3 rc = tlAlb * uRockTint;
float ledge = smoothstep(0.55, 0.85, N.y) * rockW * smoothstep(400.0, 0.0, P.y);
rc = mix(rc, mix(scrub, greenG, 0.4 + 0.3 * mC), clamp(ledge * (0.55 + 0.6 * mC), 0.0, 0.85));
// deep fissures: dark, damp, a hint of green-black growth
rc = mix(rc, vec3(0.035, 0.040, 0.028), smoothstep(0.6, 1.0, cav) * 0.4 * (1.0 - alt) * (1.0 - 0.7 * smoothstep(270.0, 430.0, length(P.xz - vec2(10.0, 40.0)))));
// plants clinging to the cliff: dark green patches in fissures and on small ledges (near field)
// (refs 3 / 7 / 9: maquis, ivy and small trees cover a third of the faces, in clumps along fissures,
// under ledges and on every bench; leafy canopy texture with sunlit flecks)
float cveg = stFbm(P * 0.11 + vec3(4.0, 9.0, 1.0), 3, 0.0, 0.5) + 0.6 * cav + 0.55 * smoothstep(0.2, 0.6, N.y) - 0.22;
float blob = cgSnoise(P * 0.42 + 6.1) + 0.5 * cgSnoise(P * 1.25 + 2.9) * (1.0 - smoothstep(0.2, 0.9, fp));
// (fewer and smaller patches with distance: beyond ~150 m they only read as dark smudges, instanced trees take over)
float cvegD = smoothstep(120.0, 420.0, camD);
float cvegW = smoothstep(0.22 + 0.30 * cvegD, 0.48 + 0.30 * cvegD, cveg + 0.15 * mD + 0.32 * blob) * (1.0 - alt) * smoothstep(-0.5, 3.0, P.y) * (1.0 - fw);
float leaf = 0.55 + 0.9 * smoothstep(-0.5, 0.75, cgSnoise(P * 2.6 + 1.0) * (1.0 - smoothstep(0.08, 0.4, fp)) + 0.35 * blob);
vec3 cvegC = mix(scrub * 1.7, greenG * 1.3, smoothstep(-0.3, 0.6, mC + 0.3 * blob)) * leaf;
rc = mix(rc, cvegC, cvegW * 0.92);
float cvegH = cvegW * 0.12 * blob * (1.0 - smoothstep(0.08, 0.3, fp));
// iron/ochre stains and dark water streaks below ledges (mid distance)
float ochre = smoothstep(0.35, 0.8, stFbm(vec3(P.x * 0.05, P.y * 0.012, P.z * 0.05) + 13.0, 3, 0.0, 0.5));
rc = mix(rc, rc * vec3(1.22, 0.90, 0.60), ochre * 0.55 * (1.0 - alt) * (1.0 - fw));
vec3 col = mix(g, rc, rockW);
float hgt = mix(gH, tlH + cvegH, rockW);
tN = normalize(mix(tN, tlN, rockW * (1.0 - fw)));
float rough = mix(0.95, tlRgh, rockW);
float ao = mix(1.0, tlAO, rockW);

// ---------------- shores: sand and wet rock
// rocks breaking the surface well inside a water body (rapids sill, bed boulders, islets): wet rock, not beach
float emerg = smoothstep(-2.0, -7.0, wd) * smoothstep(2.5, 1.2, P.y) * (1.0 - fw);
rockW = max(rockW, emerg);
col = mix(col, rc, emerg);
float shore = smoothstep(9.0, 1.5, wd) * smoothstep(3.2, 0.6, P.y) * (1.0 - emerg);
vec3 sand = mix(vec3(0.44, 0.39, 0.29), vec3(0.36, 0.33, 0.27), 0.5 + 0.5 * mC);
float wet = smoothstep(0.7, -0.1, P.y + 0.2 * mD);
vec3 sandC = mix(sand, sand * vec3(0.52, 0.54, 0.55), wet);
col = mix(col, sandC, shore * (1.0 - rockW * 0.85));
col = mix(col, col * vec3(0.45, 0.47, 0.46), wet * rockW);
// algae / dark tide band on rock just above the water, fading up
float algae = smoothstep(1.6, 0.2, P.y + 0.4 * mD) * smoothstep(-0.6, 0.0, P.y) * rockW * smoothstep(12.0, 2.0, wd);
col = mix(col, vec3(0.045, 0.055, 0.030), algae * 0.65);
rough = mix(rough, 0.35, wet);
float under = smoothstep(-0.2, -2.5, P.y) * smoothstep(6.0, -1.0, wd); // only where it is really under water (not dry hollows below sea level)
col = mix(col, mix(vec3(0.20, 0.19, 0.15), vec3(0.11, 0.12, 0.08), smoothstep(0.0, 0.6, mB + 0.3)), under * (1.0 - rockW * 0.5));

// ---------------- far mountains (alpine range): rock faces, strata, couloirs, scree, forest, meadows, snow
// vertical streak fields (triplanar on the two vertical planes): couloirs / rock ribs / water streaks
vec3 Nfc = N;
if (fw > 0.001) { Nfc = tFacetN(P, N, fp, 46.0, 0.55, 0.0); Nfc = tFacetN(P, Nfc, fp, 15.0, 0.45, 17.0); }
float slopeF = 1.0 - clamp(Nfc.y, 0.0, 1.0);
vec2 wN = abs(N.xz) + 1e-3; wN /= (wN.x + wN.y);
float strk = cgSnoise(vec3(P.x * 0.0095, P.y * 0.0026, 1.7)) * wN.y + cgSnoise(vec3(P.z * 0.0095, P.y * 0.0026, 4.1)) * wN.x;
float strk2 = cgSnoise(vec3(P.x * 0.042, P.y * 0.010, 9.3)) * wN.y + cgSnoise(vec3(P.z * 0.042, P.y * 0.010, 2.9)) * wN.x;
float strk3 = (cgSnoise(vec3(P.x * 0.16, P.y * 0.04, 5.5)) * wN.y + cgSnoise(vec3(P.z * 0.16, P.y * 0.04, 7.1)) * wN.x) * (1.0 - smoothstep(2.0, 9.0, fp));
float cv = clamp(curv, -3.0, 3.0);
// strata: warped near-horizontal bands (~25-40 m), stronger on steep faces
float yb = P.y * 0.03 + 1.8 * cgSnoise(vec3(P.xz * 0.0006, 2.2)) + 0.35 * cgSnoise(P * 0.004);
float band = smoothstep(-0.5, 0.5, sin(yb * 6.2831 + 2.0 * cgSnoise(P * 0.002)));
// rock: blue-grey limestone/gneiss, lighter fresh faces, warm weathered patches, dark wet streaks
vec3 rockF = mix(vec3(0.190, 0.182, 0.172), vec3(0.375, 0.330, 0.275), // r4: far rock 0.18-0.32 (shaded faces mid grey-blue under haze, not near-black); r5 warmer light rock
   smoothstep(-0.55, 0.65, mB + 0.45 * (band - 0.5) * slope + 0.25 * strk));
rockF = mix(rockF, vec3(0.300, 0.255, 0.195), smoothstep(0.15, 0.75, mA + 0.25 * strk + 0.2 * mB) * 0.7);
rockF *= 0.80 + 0.32 * smoothstep(-0.9, 0.9, strk2) + 0.10 * strk3;
rockF *= 1.0 + 0.10 * smoothstep(0.0, -2.0, cv) - 0.22 * smoothstep(0.2, 2.5, cv); // fresh ribs, dark damp gullies
// scree / talus fans: gentler slopes below the faces
float screeW = smoothstep(0.40, 0.22, slope + 0.08 * mC) * smoothstep(700.0, 1150.0, P.y + 150.0 * mB);
vec3 screeC = mix(vec3(0.250, 0.243, 0.230), vec3(0.330, 0.318, 0.295), 0.5 + 0.5 * mC);
vec3 fc = mix(rockF, screeC, screeW * 0.75) * uFarTint;
// alpine meadows / dwarf pine above the forest on gentle ground
float tl = 1380.0 + 240.0 * mA + 110.0 * mB;
float medW = smoothstep(0.42, 0.20, slope + 0.10 * mC) * smoothstep(tl - 220.0, tl + 60.0, P.y) * smoothstep(2250.0, 1850.0, P.y + 220.0 * mB);
fc = mix(fc, mix(vec3(0.060, 0.066, 0.034), vec3(0.105, 0.098, 0.058), smoothstep(-0.5, 0.6, mC + 0.3 * mB)), medW * 0.85);
// lowland and foothill pasture / maquis where there is no forest (never bare grey rock on gentle low ground)
float lowW = smoothstep(tl - 80.0, tl - 380.0, P.y + 60.0 * mB) * smoothstep(0.58, 0.36, slope + 0.08 * mC);
fc = mix(fc, mix(vec3(0.060, 0.070, 0.034), vec3(0.105, 0.098, 0.060), smoothstep(-0.5, 0.6, mC + 0.4 * mB)), lowW);
// conifer forest on the lower slopes (foothills, valley sides), ragged upper edge, clearings
float forW = smoothstep(tl + 40.0, tl - 160.0, P.y + 90.0 * strk) * smoothstep(0.74, 0.52, slope + 0.10 * mC + 0.06 * strk2)
           * smoothstep(-0.8, -0.4, mB + 0.40 * mA + 0.25 * mC) * smoothstep(40.0, 140.0, P.y);
vec3 forC = mix(vec3(0.026, 0.038, 0.020), vec3(0.055, 0.068, 0.036), smoothstep(-0.5, 0.6, mC));
forC *= 0.70 + 0.55 * smoothstep(-0.7, 0.7, cgSnoise(P * 0.045)) * (1.0 - smoothstep(4.0, 14.0, fp));
fc = mix(fc, forC, forW);
// snow: altitude line broken by couloirs and ribs, held on gentler ground and in concave gullies,
// shed by steep rock; crisp edges
// r4: the hold test uses a SMOOTHED far-grid normal / curvature (≈ 100 m footprint) and local relief, so
// snow forms continuous fields broken by rock ribs and steep faces (refs 5/9); the facet normals (Nfc)
// only light the rock (they made the snow a speckle at telephoto)
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
float sl = uSnowLine + 170.0 * mA + 110.0 * mB;
float hs = P.y + 220.0 * (0.4 - slopeS) + 110.0 * cvS + 90.0 * strk + 40.0 * strk2 + 140.0 * mB + 50.0 * mC;
float snowA = smoothstep(sl - 40.0, sl + 40.0, hs);
// snow holds on gentle and concave ground; steep faces and sharp ribs stay rock (rock dominant on the walls)
// r5: less snow on the walls (refs 1/5/9: sunlit tan rock faces dominate, snow in the gullies, on ledges and
// on the gentler upper fields), more in concave gullies
float hold = 0.21 + 0.10 * cvS + 0.07 * smoothstep(sl, sl + 1000.0, P.y) + 0.07 * strk2 + 0.04 * strk + 0.03 * mB;
float ribs = smoothstep(3.0, 12.0, relief + 3.0 * strk2) * smoothstep(0.18, 0.40, slopeS);
float snowS = smoothstep(hold + 0.05, hold - 0.05, slopeS + 0.12 * ribs);
float snowF = snowA * snowS;
// streaks of snow down the couloirs of the steep upper faces (smoothed gullies, not facets)
float coul = smoothstep(0.30, 0.70, strk2 * 0.6 + strk * 0.2 + 0.25 * cvS - 0.04 * relief);
snowF = max(snowF, smoothstep(sl + 100.0, sl + 500.0, P.y + 250.0 * strk) * coul * smoothstep(0.80, 0.55, slopeS) * 0.9);
// powder plastered on the upper walls near the summits (partial, follows the smoothed form)
snowF = max(snowF, smoothstep(sl + 600.0, sl + 1200.0, P.y + 300.0 * strk) * smoothstep(0.42, 0.30, slopeS + 0.10 * strk2 + 0.04 * ribs) * 0.75);
// rock ribs break the fields (thin dark lines down the snow, refs 5/9)
snowF *= 1.0 - 0.75 * ribs * smoothstep(0.25, 0.6, strk2 + 0.3) * smoothstep(0.25, 0.45, slopeS);
// r5: strata steps through the snow on moderately steep ground (snow on the ledge tops, rock on the risers)
snowF *= 1.0 - 0.4 * (1.0 - band) * smoothstep(0.16, 0.32, slopeS) * smoothstep(0.2, 0.6, strk2 + 0.6);
vec3 snowCol = vec3(0.85, 0.87, 0.91) * (0.95 + 0.05 * mC);
fc = mix(fc, snowCol, snowF);
float farHgt = (7.0 * strk + 2.2 * strk2 + 0.6 * strk3) * (1.0 - 0.75 * snowF) * (1.0 - forW * 0.8)
             + forW * 2.0 * cgSnoise(P * 0.09) * (1.0 - smoothstep(3.0, 9.0, fp));
float farRough = mix(0.88, 0.62, snowF);
col = mix(col, fc, fw);
hgt = mix(hgt, farHgt, fw);
rough = mix(rough, farRough, fw);
ao = mix(ao, 1.0 - 0.25 * smoothstep(0.3, 2.5, cv), fw);
// lighting normal: rock facets (snow drapes them more smoothly, forest canopy is its own texture)
tN = normalize(mix(tN, mix(Nfc, normalize(Nfc + 2.0 * N), 0.85 * snowF), fw * (1.0 - 0.85 * forW) * (1.0 - 0.6 * medW)));

diffuseColor.rgb = max(col, vec3(0.0));
if (uTDebug > 0.5) { diffuseColor.rgb = vec3(0.5); ao = 1.0; }
tBump = hgt * uTBump; tRough = rough; tAO = ao; tFW = fw;
cgAO = ao;
`;

/** terrain material (one program for near and far terrain) */
export function terrainMaterial() {
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
  // multiply the direct sun by the far-field heightfield shadow (mountains are beyond the CSM range)
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    const chunk = THREE.ShaderChunk.lights_fragment_begin.replace(/RE_Direct\( directLight,/g, 'directLight.color *= tSunVis; RE_Direct( directLight,');
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
    // one-bounce sun from the lit surroundings: horizontal sun irradiance × surround albedo × view factor
    // of the surroundings (0 for up-facing ground, ½ for vertical faces, 1 under overhangs), stronger on
    // faces turned away from the sun (they look at the lit faces opposite); scaled by cgAO later with the
    // rest of the indirect light
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec3 Ls = normalize(uTSun);
  vec2 lh = Ls.xz;
  float away = clamp(-dot(tN.xz, lh) / max(length(lh), 1e-3), -1.0, 1.0);
  float vf = 0.5 * (1.0 - tN.y) * (0.65 + 0.35 * away) * (1.0 - tFW); // near field only (mountains: look-dev)
  vec3 Eb = uTSunIrr * max(Ls.y, 0.08) * uTBounce * vf;
  reflectedLight.indirectDiffuse += Eb * BRDF_Lambert(diffuseColor.rgb);
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
}
