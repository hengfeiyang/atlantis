// Stone material family (OWNED by the terrain agent): natural limestone rock and dressed limestone,
// plus a procedural boulder generator. Everything is world-space procedural (no textures).
//
//   import { limestoneMaterial, rockMaterial, createRock } from '../materials/stone.js';
//   const mat = rockMaterial({ moss: 0.6 });                 // natural rock (cliffs, boulders, outcrops)
//   const blk = limestoneMaterial({ lichen: 0.8 });          // dressed / cut limestone (ruins, walls)
//   const geo = createRock(engine.rng('rocks'), { size: [2, 1.2, 1.6], shape: 'boulder' });
//
// Options (all optional, numbers are 0..1 unless stated):
//   tint      THREE.Color | hex     multiplies the albedo (default white)
//   scale     number (1)            feature scale multiplier (2 = features twice as small)
//   moss      moss on up-facing surfaces / crevices
//   lichen    dark + yellow lichen speckles
//   streaks   vertical dark rain/water streaks on steep faces
//   strata    horizontal bedding bands (natural rock)
//   ochre     warm iron staining
//   wetBelow  world y below which the stone is wet and darker (default -1e4 = never)
//   bump      relief strength multiplier (1)
//   variation per-instance brightness variation (InstancedMesh: uses the instance seed)
//   roughness base roughness (0.88)
// Geometry may carry an optional float attribute `aCavity` (0..1, crevice depth) — createRock() writes
// it; it darkens crevices and feeds the ambient occlusion. Missing attribute = 0 (no effect).
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';

// --------------------------------------------------------------------------------- GLSL
/** shared uniform (value 1) used as a loop bound in STONE_GLSL — add to the uniforms of custom materials */
export const ST_ONE = { value: 1 };
/** Shared stone shading (also used by the terrain shader for cliffs). Requires NOISE_GLSL. */
export const STONE_GLSL = /* glsl */ `
#ifndef ST_STONE_INCLUDED
#define ST_STONE_INCLUDED
// outputs of stShade()
vec3 stAlb; float stRgh; float stHgt; float stAO; vec3 stFN;   // stFN: base normal with the facet tilts (bump on top)
// loop bounds read a uniform (always 1) so the D3D compiler does not unroll them (much faster compiles)
uniform float uStOne;

// band-limited fbm (fades octaves finer than the pixel footprint fp, both in noise units)
float stFbm(vec3 p, int oct, float fp, float gain) {
  float s = 0.0, a = 0.5, n = 0.0, f = 1.0;
  int no = int(float(oct) * uStOne);
  for (int i = 0; i < no; i++) {
    float w = 1.0 - smoothstep(0.18, 0.5, fp * f);
    s += a * w * cgSnoise(p * f);
    n += a;
    f *= 2.07; a *= gain; p += vec3(3.71, 1.37, 5.13);
  }
  return s / n;
}

// 3D cellular: returns (F1, F2, cell hash); fpos = nearest feature point (cell space)
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

// Surface-gradient bump (Mikkelsen): perturb n by a scalar height field h (metres) using screen derivatives.
vec3 stBumpNormal(vec3 p, vec3 n, float h) {
  vec3 dpdx = dFdx(p), dpdy = dFdy(p);
  float dhdx = dFdx(h), dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 g = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - g);
}

// p: world position, n: world normal, seed: per-instance [0,1), cav: crevice 0..1,
// A = (scale, moss, lichen, streaks), B = (strata, wetBelow, bump, dressed), C = (variation, ochre, darkness, -)
void stShade(vec3 p, vec3 n, float seed, float cav, vec4 A, vec4 B, vec4 C) {
  float sc = A.x;
  vec3 q = p * sc;
  stFN = n;
  float fp = max(length(fwidth(p)) * sc, 1e-4);   // pixel footprint in (scaled) metres
  float vert = 1.0 - abs(n.y);
  float upw = clamp(n.y, 0.0, 1.0);
  float dressed = B.w;

  // ---------------- macro colour (coherent over tens of metres)
  float m1 = stFbm(q * 0.043 + seed * 13.1, 3, 0.0, 0.5);
  float m2 = stFbm(q * 0.16 + vec3(11.0, 3.0, 7.0), 3, 0.0, 0.5);
  float m3 = cgSnoise(q * 0.55 + 2.0);
  // weathered limestone: pale grey-cream (r5: lighter and less sandy — refs 3/8/9 foreground blocks are
  // pale grey-white with dark speckle, not beige), grey weathered masses, buff stains
  // (average kept within ~10 % of r4: other modules tuned their tints on it — bastion ×1.45, rapids ×1.35)
  vec3 cream = mix(vec3(0.385, 0.366, 0.326), vec3(0.500, 0.470, 0.405), dressed);
  vec3 grey  = mix(vec3(0.300, 0.298, 0.290), vec3(0.430, 0.420, 0.395), dressed);
  vec3 warm  = vec3(0.420, 0.310, 0.195);
  vec3 c = mix(cream, grey, smoothstep(-0.4, 0.5, m1) * (1.0 - 0.5 * dressed));
  c = mix(c, warm, smoothstep(0.25, 0.75, m2) * C.y * (0.35 + 0.65 * vert));
  // weathered darker grey patches on natural rock
  float m4 = stFbm(q * 0.09 + vec3(31.0, 7.0, 19.0), 3, 0.0, 0.5);
  c = mix(c, vec3(0.170, 0.168, 0.163), smoothstep(0.20, 0.75, m4) * (1.0 - dressed) * 0.55);
  // fresh white fracture faces
  c = mix(c, vec3(0.50, 0.488, 0.458), smoothstep(0.35, 0.7, -m4 + 0.4 * m3) * (1.0 - dressed) * 0.45);
  c *= 1.0 + 0.08 * m3;
  c *= 1.0 + (seed - 0.5) * C.x;
  // r5: micro mottling (salt-and-pepper grain of weathered limestone, 1–8 cm), band-limited
  float motW = 1.0 - smoothstep(0.03, 0.12, fp);
  if (motW > 0.0) {
    float mot = stFbm(q * 7.0 + 3.3, 3, fp * 7.0, 0.65);
    c *= 1.0 + (0.45 * mot) * motW * (1.0 - 0.3 * dressed);
  }

  // ---------------- relief (metres): lumpy weathered surface + bedding grooves + pits
  float amp = mix(0.15, 0.018, dressed) * B.z / sc;
  // (every bump term is band-limited to ≥ ~5 px wavelength: the screen-derivative bump is constant per
  //  2×2 pixel quad, so finer relief turns into blocky "pixel" shading)
  float h = amp * stFbm(q * mix(0.55, 1.6, dressed), 6, fp * mix(0.55, 1.6, dressed) * 2.6, mix(0.64, 0.56, dressed));   // r5: rougher fine octaves (natural rock)
  // r5: weathering crust — ridged micro relief (≈ 11 cm and 4 cm) that gives the refs' crusty, pitted
  // limestone surface at 2–10 m; lighter crust ridges, darker hollows; plus 10–40 cm tonal patches
  float crW = (1.0 - 0.35 * dressed) * (1.0 - smoothstep(0.008, 0.025, fp));
  if (crW > 0.0) {
    // billowed (rounded lumps with creases; ridged noise read as worms / hammered metal)
    float r1 = abs(cgSnoise(q * 7.0 + 1.1) + 0.5 * cgSnoise(q * 13.0 + 7.3));
    float r2 = abs(cgSnoise(q * 23.0 + 4.4));
    h += (0.009 * r1 + 0.0035 * r2 * (1.0 - smoothstep(0.003, 0.009, fp))) * crW / sc;
    c *= 1.0 + 0.22 * (smoothstep(0.0, 0.5, r1) - 0.6) * crW;
  }
  // 10–40 cm tonal patches: pale crust ↔ grey weathered (ref 3/8 foreground blocks are strongly blotched)
  float ptc = cgSnoise(q * 1.25 + 8.8) + 0.45 * cgSnoise(q * 3.1 + 2.2) + 0.2 * cgSnoise(q * 7.7 + 5.5);
  float ptW = (1.0 - smoothstep(0.04, 0.16, fp)) * (1.0 - 0.35 * dressed);   // (weathered ruin blocks are blotched too)
  c = mix(c, c * vec3(1.30, 1.28, 1.24), smoothstep(0.0, 0.35, ptc) * 0.85 * ptW);
  c = mix(c, c * vec3(0.70, 0.71, 0.73), smoothstep(-0.2, -0.6, ptc) * 0.85 * ptW * (1.0 - 0.6 * dressed));
  // bedding planes (natural rock, steep faces): thin horizontal grooves, warped
  float yb = q.y * 0.9 + 1.6 * cgSnoise(vec3(q.xz * 0.05, 3.3)) + 0.4 * cgSnoise(q * 0.3);
  float bedLine = abs(fract(yb * 0.5) - 0.5) * 2.0;           // 0 at the groove
  float bedW = 1.0 - smoothstep(0.0, 0.5, fp * 0.5);
  float groove = (1.0 - smoothstep(0.0, 0.10, bedLine)) * B.x * vert * bedW;
  h -= groove * 0.05 / sc * (1.0 - smoothstep(0.015, 0.05, fp));
  // banding colour along the strata
  float bandN = cgSnoise(vec3(q.x * 0.015, yb * 0.35, q.z * 0.015));
  c *= mix(1.0, 0.88 + 0.22 * smoothstep(-0.6, 0.6, bandN), B.x * vert);
  // pits / porosity (only resolved up close)
  // solution pits / honeycomb weathering (karst): warped cells at two scales, only where resolved
  float pitW = 1.0 - smoothstep(0.02, 0.07, fp);
  float pit = 0.0;
  if (pitW > 0.0) {
    vec3 wq = q + 0.18 * vec3(cgSnoise(q * 3.1), cgSnoise(q * 3.1 + 7.7), cgSnoise(q * 3.1 + 3.3));
    vec3 pfp; vec3 vr = stCell(wq * 3.2, pfp);
    float pz = smoothstep(-0.45, 0.35, cgSnoise(q * 0.7 + 5.0)) * (1.0 - dressed * 0.6);  // pitted zones (r5: more of them)
    float p1 = (1.0 - smoothstep(0.08, 0.30 + 0.12 * vr.z, vr.x)) * step(0.30, vr.z) * pz;
    vec3 vr2 = stCell(wq * 9.0 + 2.0, pfp);
    float p2 = (1.0 - smoothstep(0.05, 0.24, vr2.x)) * step(0.40, vr2.z) * (0.5 + 0.5 * pz);
    pit = clamp(p1 + 0.7 * p2, 0.0, 1.0) * pitW;
    h -= (p1 * 0.035 * (1.0 - smoothstep(0.008, 0.025, fp)) + p2 * 0.012 * (1.0 - smoothstep(0.003, 0.009, fp))) * pitW / sc;
  }

  // fracture facets (1–3 m angular planes with a crack network) — natural rock only, near/mid range
  float facW = (1.0 - dressed) * (1.0 - smoothstep(0.12, 0.45, fp * 0.55));
  if (facW > 0.0) {
    vec3 fq = q * vec3(0.55, 0.30, 0.55);
    vec3 fpos; vec3 cc = stCell(fq, fpos);
    // r5: facets tilt the shading NORMAL per cell (crisp planar faces with sharp edges). As a height term the
    // facet either jumped at the cell borders (dotted bright lines with the screen-derivative bump) or,
    // faded to 0 there, drew a V-groove along every border (a "dried mud" network).
    vec3 tilt = (cgHash33(fpos * 7.13 + 1.7) - 0.5) * vec3(1.0, 0.5, 1.0);
    stFN = normalize(stFN + (tilt - stFN * dot(tilt, stFN)) * 0.42 * facW);
    // a few crisp open joints along some cell borders, in fractured zones only (sparse: a full network reads
    // as crackle glaze); colour + crevice only (a bump on a 1–3 px line aliases into jagged strokes)
    float cw = 0.03 + fp * 0.55 * 1.6;
    float crkZ = smoothstep(-0.1, 0.4, cgSnoise(q * 0.21 + 6.6));
    float crk = (1.0 - smoothstep(0.0, cw, cc.y - cc.x)) * step(0.55, cgHash13(fpos * 3.1 + 0.7)) * crkZ;
    c *= 1.0 - 0.55 * crk * facW;
    c *= 1.0 + (cc.z - 0.5) * 0.22 * facW;
    cav = max(cav, crk * 0.6 * facW);
    // small chips (10–30 cm angular facets) where resolved: normal only, no lines
    float chW = facW * (1.0 - smoothstep(0.02, 0.06, fp));
    if (chW > 0.0) {
      vec3 fpos2; vec3 cc2 = stCell(q * vec3(4.0, 3.0, 4.0) + 9.0, fpos2);
      vec3 t2 = (cgHash33(fpos2 * 5.31 + 0.3) - 0.5);
      stFN = normalize(stFN + (t2 - stFN * dot(t2, stFN)) * 0.22 * chW);
      c *= 1.0 + (cc2.z - 0.5) * 0.12 * chW;
    }
  }

  // ---------------- colour weathering layers
  // vertical water / rain streaks on steep faces (dark grey-brown)
  float sk = cgSnoise(vec3(q.x * 0.55, q.y * 0.022, q.z * 0.55)) * 0.6 + cgSnoise(vec3(q.x * 1.7, q.y * 0.06, q.z * 1.7)) * 0.4;
  float streak = smoothstep(0.15, 0.65, sk) * A.w * smoothstep(0.25, 0.8, vert);
  c = mix(c, c * vec3(0.52, 0.52, 0.50), streak * 0.85);
  // crevices: darker, slightly green-brown
  float cv = clamp(cav, 0.0, 1.0);
  c *= 1.0 - 0.55 * cv * cv - 0.15 * cv;
  c = mix(c, vec3(0.085, 0.072, 0.050), cv * cv * 0.35);
  // pits: dark brown-grey interiors
  c = mix(c, c * vec3(0.38, 0.35, 0.31), pit);
  // lichen: dark grey-black speckle clusters (very characteristic of the references) + yellow-grey crusts
  float lichMask = smoothstep(0.05, 0.6, stFbm(q * 0.35 + 4.0, 3, 0.0, 0.5) + 0.3 * upw);
  float spk = cgSnoise(q * 9.0);
  float spkW = 1.0 - smoothstep(0.03, 0.10, fp);
  float lichDark = smoothstep(0.35, 0.75, spk) * lichMask * A.z * spkW;
  // r5: black lichen colonies (ref 8/9: clusters of dense dark dots, 10–60 cm) + pale grey crusts between
  float colony = smoothstep(0.15, 0.55, cgSnoise(q * 1.15 + 7.0) + 0.5 * cgSnoise(q * 3.1 + 1.0) * spkW) * lichMask;
  float dotW = 1.0 - smoothstep(0.012, 0.04, fp);
  float dots = smoothstep(0.15, 0.5, cgSnoise(q * 17.0 + 3.0)) * dotW;
  lichDark = max(lichDark, colony * mix(0.55, dots, dotW) * A.z * (1.0 - 0.55 * dressed));
  c = mix(c, vec3(0.075, 0.075, 0.072), clamp(lichDark, 0.0, 1.0) * 0.8);
  float crust = smoothstep(0.25, 0.65, stFbm(q * 0.75 + 14.0, 3, fp * 0.75, 0.55)) * (1.0 - colony) * A.z;
  c = mix(c, vec3(0.60, 0.595, 0.565), crust * 0.4 * (1.0 - dressed));
  // where too far to resolve speckles, average them in as a slight darkening
  c *= 1.0 - 0.18 * lichMask * A.z * (1.0 - spkW);
  float lichY = smoothstep(0.55, 0.8, cgSnoise(q * 2.3 + 9.0)) * lichMask * A.z;
  c = mix(c, vec3(0.52, 0.47, 0.30), lichY * 0.35);
  // moss on up-facing surfaces and in crevices
  float mossN = stFbm(q * 0.4 + 21.0, 3, 0.0, 0.5);
  float moss = smoothstep(0.25, 0.75, upw * 0.9 + cv * 0.6 + 0.45 * mossN) * A.y;
  vec3 mossC = mix(vec3(0.075, 0.095, 0.030), vec3(0.16, 0.16, 0.06), smoothstep(-0.3, 0.6, mossN));
  c = mix(c, mossC, moss * 0.85);
  h += moss * 0.01 / sc;

  // ---------------- wetness near water
  float wet = 1.0 - smoothstep(B.y - 0.05, B.y + 0.35, p.y + 0.12 * cgSnoise(q * 1.5));
  c = mix(c, c * vec3(0.42, 0.44, 0.42), wet);
  c = mix(c, vec3(0.06, 0.08, 0.04), wet * smoothstep(B.y - 0.3, B.y + 0.1, p.y) * 0.4); // algae band

  c *= 1.0 - C.z;
  stAlb = max(c, vec3(0.0));
  stRgh = mix(0.86 + 0.08 * m3, 0.30, wet) - 0.08 * dressed;
  stHgt = h;
  stAO = 1.0 - 0.75 * cv - 0.25 * moss * upw;
}
#endif
`;

const VERT_HEAD = /* glsl */ `
attribute float aCavity;
varying float vStCav;
`;
const VERT_PRE = /* glsl */ `vStCav = aCavity;`;

const FRAG_HEAD = /* glsl */ `
uniform vec3 uStTint;
uniform vec4 uStA;
uniform vec4 uStB;
uniform vec4 uStC;
varying float vStCav;
${STONE_GLSL}
`;

const COLOR_HOOK = /* glsl */ `
stShade(cgP, cgN, cgSeed, vStCav, uStA, uStB, uStC);
diffuseColor.rgb = stAlb * uStTint * diffuseColor.rgb;
cgAO = stAO;
`;
const ROUGH_HOOK = /* glsl */ `roughnessFactor = clamp(stRgh * roughnessFactor / 0.88, 0.05, 1.0);`;
const NORMAL_HOOK = /* glsl */ `cgBump = stBumpNormal(cgP, stFN, stHgt) - cgN;`;
const AO_HOOK = /* glsl */ `/* cgAO set in colour hook */`;

function makeStone(name, def, opts) {
  const o = { ...def, ...opts };
  const tint = o.tint instanceof THREE.Color ? o.tint.clone() : new THREE.Color(o.tint ?? 0xffffff);
  const uniforms = {
    uStTint: { value: tint },
    uStA: { value: new THREE.Vector4(o.scale, o.moss, o.lichen, o.streaks) },
    uStB: { value: new THREE.Vector4(o.strata, o.wetBelow, o.bump, o.dressed) },
    uStC: { value: new THREE.Vector4(o.variation, o.ochre, o.darkness, 0) },
    uStOne: ST_ONE,
  };
  const mat = proceduralMaterial({
    name,
    params: { color: 0xffffff, roughness: o.roughness, metalness: 0, side: o.side ?? THREE.FrontSide },
    uniforms,
    vertexHead: VERT_HEAD,
    vertexPre: VERT_PRE,
    head: FRAG_HEAD,
    color: COLOR_HOOK,
    roughness: ROUGH_HOOK,
    normal: NORMAL_HOOK,
    ao: AO_HOOK,
  });
  mat.userData.stone = uniforms;
  return mat;
}

const ROCK_DEF = { tint: 0xffffff, scale: 1, moss: 0.35, lichen: 0.7, streaks: 0.5, strata: 0.5, ochre: 0.5, wetBelow: -1e4, bump: 1, variation: 0.18, darkness: 0, dressed: 0, roughness: 0.88 };
const LIME_DEF = { tint: 0xffffff, scale: 1, moss: 0.15, lichen: 0.6, streaks: 0.25, strata: 0.0, ochre: 0.3, wetBelow: -1e4, bump: 1, variation: 0.14, darkness: 0, dressed: 1, roughness: 0.84 };

/** Natural limestone rock: cliffs, boulders, outcrops, rock masses. */
export function rockMaterial(opts = {}) { return makeStone('stoneRock', ROCK_DEF, opts); }
/** Dressed / cut limestone: ruin blocks, retaining walls, paving, column drums (weathered, pitted, lichen). */
export function limestoneMaterial(opts = {}) { return makeStone('stoneLimestone', LIME_DEF, opts); }

// --------------------------------------------------------------------------------- boulder geometry
// Small self-contained value-noise (CPU) so createRock has no other dependencies.
function hash3(x, y, z, s) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi, s), c100 = hash3(xi + 1, yi, zi, s), c010 = hash3(xi, yi + 1, zi, s), c110 = hash3(xi + 1, yi + 1, zi, s);
  const c001 = hash3(xi, yi, zi + 1, s), c101 = hash3(xi + 1, yi, zi + 1, s), c011 = hash3(xi, yi + 1, zi + 1, s), c111 = hash3(xi + 1, yi + 1, zi + 1, s);
  return l(l(l(c000, c100, u), l(c010, c110, u), v), l(l(c001, c101, u), l(c011, c111, u), v), w) * 2 - 1;
}
function fbm3(x, y, z, s, oct) {
  let a = 0.5, f = 1, t = 0, n = 0;
  for (let i = 0; i < oct; i++) { t += a * vnoise3(x * f, y * f, z * f, s + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return t / n;
}
/** 3D cellular: returns [F1, F2] */
function cell3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d1 = 9, d2 = 9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const px = cx + hash3(cx, cy, cz, s) - x, py = cy + hash3(cx, cy, cz, s + 1) - y, pz = cz + hash3(cx, cy, cz, s + 2) - z;
    const d = px * px + py * py + pz * pz;
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return [Math.sqrt(d1), Math.sqrt(d2)];
}

const _ico = new Map();
/** indexed icosphere (unit radius) with `level` subdivisions (0..6); cached, do not mutate the result */
export function icosphere(level = 4) {
  if (_ico.has(level)) return _ico.get(level);
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((v) => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let l = 0; l < level; l++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      let m = cache.get(key);
      if (m === undefined) {
        const va = verts[a], vb = verts[b];
        const x = va[0] + vb[0], y = va[1] + vb[1], z = va[2] + vb[2], len = Math.hypot(x, y, z);
        m = verts.length; verts.push([x / len, y / len, z / len]); cache.set(key, m);
      }
      return m;
    };
    const nf = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  const res = { verts, faces };
  _ico.set(level, res);
  return res;
}

/**
 * Procedural limestone boulder / block. Returns an indexed BufferGeometry (position, normal, aCavity),
 * centred on the origin with its base near y = -size.y/2 (flattened if opts.flatBottom).
 * @param {{random:()=>number}|object} rng  RNG with random() (engine.rng(label)) — determines the shape
 * @param {object} [opts]
 * @param {number|number[]} [opts.size=1]   overall size in metres (number or [sx, sy, sz])
 * @param {'boulder'|'block'|'slab'|'pillar'|'mass'|'pebble'} [opts.shape='boulder']
 * @param {number} [opts.detail=4]          icosphere subdivision level 2..6 (4 → 5120 tris, 5 → 20480)
 * @param {number} [opts.roughness=1]       surface noise amount
 * @param {number} [opts.cracks=1]          strength of the cellular fracture/pillow pattern
 * @param {number} [opts.strata=0.5]        horizontal bedding grooves
 * @param {number} [opts.flatBottom=0.15]   fraction of height cut flat at the bottom (0 = none)
 */
export function createRock(rng, opts = {}) {
  const R = typeof rng?.random === 'function' ? () => rng.random() : typeof rng === 'function' ? rng : Math.random;
  const shape = opts.shape || 'boulder';
  const size = Array.isArray(opts.size) ? opts.size : [opts.size ?? 1, (opts.size ?? 1) * (shape === 'slab' ? 0.35 : shape === 'pillar' ? 2.2 : 0.75), opts.size ?? 1];
  const detail = Math.max(1, Math.min(6, Math.round(opts.detail ?? 4)));
  const rough = opts.roughness ?? 1;
  const cracks = opts.cracks ?? 1;
  const strata = opts.strata ?? 0.5;
  const flatBottom = opts.flatBottom ?? 0.15;
  const seed = Math.floor(R() * 1e6);

  // ---- fracture planes → rounded convex polytope
  const planes = [];
  const addPlane = (nx, ny, nz, d) => { const l = Math.hypot(nx, ny, nz); planes.push([nx / l, ny / l, nz / l, d]); };
  if (shape === 'block' || shape === 'slab' || shape === 'pillar' || shape === 'mass') {
    const j = shape === 'mass' ? 0.25 : 0.12;
    for (const ax of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      addPlane(ax[0] + (R() - 0.5) * j, ax[1] + (R() - 0.5) * j, ax[2] + (R() - 0.5) * j, 0.82 + R() * 0.12);
    }
    const chips = shape === 'mass' ? 8 : 5;
    for (let i = 0; i < chips; i++) {
      const u = R() * 2 - 1, a = R() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      addPlane(r * Math.cos(a), u, r * Math.sin(a), 0.86 + R() * 0.25);
    }
  } else {
    const n = shape === 'pebble' ? 6 : 9 + Math.floor(R() * 6);
    for (let i = 0; i < n; i++) {
      const u = R() * 2 - 1, a = R() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      addPlane(r * Math.cos(a), u * 0.9, r * Math.sin(a), 0.62 + R() * 0.36);
    }
    addPlane(0, -1, 0, 0.7 + R() * 0.2);
  }
  // r5: extra fracture chips from a local PRNG (the caller's rng stream is consumed exactly as before, so
  // every placement that follows a createRock() call is unchanged) → angular limestone, not river pebbles
  if (shape !== 'pebble') {
    let st = (seed * 2654435761) >>> 0;
    const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const nChip = shape === 'boulder' ? 7 : 5;
    for (let i = 0; i < nChip; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      addPlane(r * Math.cos(a), u * 0.8, r * Math.sin(a), (shape === 'boulder' ? 0.72 : 0.84) + rnd() * 0.22);
    }
  }
  const kSoft = shape === 'pebble' ? 0.16 : shape === 'boulder' ? 0.04 : 0.03;
  const v = new Float64Array(planes.length);
  const hullSDF = (x, y, z) => {
    // log-sum-exp smooth max over planes, intersected with a sphere to bound it
    let m = -1e9;
    for (let i = 0; i < planes.length; i++) { const p = planes[i]; v[i] = x * p[0] + y * p[1] + z * p[2] - p[3]; if (v[i] > m) m = v[i]; }
    let s = 0;
    for (let i = 0; i < v.length; i++) s += Math.exp((v[i] - m) / kSoft);
    const poly = m + kSoft * Math.log(s);
    const sph = Math.hypot(x, y, z) - 1.12;
    return Math.max(poly, sph);
  };
  const ox = R() * 100, oy = R() * 100, oz = R() * 100;
  // r5: fewer, larger fracture cells (1.1–1.8 per unit radius, was 2.2–3.5) and only some of their borders
  // open as joints: a full cell network on every rock read as a tortoise-shell / crackle-glaze pattern
  const cellScale = 1.4 + (R() * 1.3) * 0.6;
  const detailSDF = (x, y, z) => {
    let d = 0;
    // fracture joints (vertical-ish elongation for limestone): narrow V grooves, sparse
    if (cracks > 0) {
      const [f1, f2] = cell3(x * cellScale + ox, y * cellScale * 0.8 + oy, z * cellScale + oz, seed);
      const edge = f2 - f1;
      const open = Math.min(1, Math.max(0, (vnoise3(x * 1.4 + oz, y * 1.4 + ox, z * 1.4 + oy, seed + 5) + 0.2) / 0.3));
      // (grooves at least ~2 vertex spacings wide at detail 5, else they sample into dotted lines)
      d += cracks * open * 0.06 * Math.max(0, 1 - edge / 0.18); // crack grooves push inward (positive sdf)
    }
    // horizontal bedding: stepped layers (each bed set back at its top edge → small ledges, shadow lines)
    if (strata > 0) {
      const yb = y * 3.2 + 0.8 * vnoise3(x * 2 + ox, 0.5, z * 2 + oz, seed + 3);
      const f = yb - Math.floor(yb);
      const g = Math.abs(yb - Math.round(yb));
      // (boulders: weaker beds — water-worn blocks, not stacked slabs)
      d += strata * (shape === 'boulder' ? 0.45 : 1) * (0.018 * Math.max(0, 1 - g / 0.2) + 0.02 * Math.max(0, (f - 0.72) / 0.28));
    }
    d += rough * (0.035 * fbm3(x * 2.6 + ox, y * 2.6 + oy, z * 2.6 + oz, seed + 7, 4) + 0.016 * fbm3(x * 9 + oy, y * 9 + oz, z * 9 + ox, seed + 9, 3));
    return d;
  };

  const { verts, faces } = icosphere(detail);
  const nV = verts.length;
  const pos = new Float32Array(nV * 3);
  const cavity = new Float32Array(nV);
  for (let i = 0; i < nV; i++) {
    const [dx, dy, dz] = verts[i];
    // bisection along the ray for the rounded hull, then offset by the detail field (≈ distance)
    let lo = 0.05, hi = 1.6;
    for (let it = 0; it < 18; it++) {
      const m = (lo + hi) * 0.5;
      if (hullSDF(dx * m, dy * m, dz * m) < 0) lo = m; else hi = m;
    }
    const rh = (lo + hi) * 0.5;
    const r = Math.max(0.05, rh - detailSDF(dx * rh, dy * rh, dz * rh));
    pos[i * 3] = dx * r * size[0] * 0.5;
    pos[i * 3 + 1] = dy * r * size[1] * 0.5;
    pos[i * 3 + 2] = dz * r * size[2] * 0.5;
  }
  // flatten the base so the rock sits on the ground
  if (flatBottom > 0) {
    let minY = Infinity;
    for (let i = 0; i < nV; i++) minY = Math.min(minY, pos[i * 3 + 1]);
    const cut = minY + size[1] * flatBottom;
    for (let i = 0; i < nV; i++) if (pos[i * 3 + 1] < cut) pos[i * 3 + 1] = cut - (cut - pos[i * 3 + 1]) * 0.08;
  }
  // index
  const index = new (nV > 65535 ? Uint32Array : Uint16Array)(faces.length * 3);
  for (let f = 0; f < faces.length; f++) { index[f * 3] = faces[f][0]; index[f * 3 + 1] = faces[f][1]; index[f * 3 + 2] = faces[f][2]; }
  // cavity from the umbrella-operator concavity
  const nb = new Float32Array(nV * 3), cnt = new Float32Array(nV);
  for (let f = 0; f < faces.length; f++) {
    const [a, b, c] = faces[f];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      nb[u * 3] += pos[v * 3]; nb[u * 3 + 1] += pos[v * 3 + 1]; nb[u * 3 + 2] += pos[v * 3 + 2]; cnt[u]++;
      nb[v * 3] += pos[u * 3]; nb[v * 3 + 1] += pos[u * 3 + 1]; nb[v * 3 + 2] += pos[u * 3 + 2]; cnt[v]++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal.array;
  const sAvg = (size[0] + size[1] + size[2]) / 3;
  for (let i = 0; i < nV; i++) {
    const ax = nb[i * 3] / cnt[i] - pos[i * 3], ay = nb[i * 3 + 1] / cnt[i] - pos[i * 3 + 1], az = nb[i * 3 + 2] / cnt[i] - pos[i * 3 + 2];
    const lap = ax * nrm[i * 3] + ay * nrm[i * 3 + 1] + az * nrm[i * 3 + 2]; // >0 = concave
    cavity[i] = Math.max(0, Math.min(1, lap / (0.006 * sAvg * (32 / (1 << detail)))));
  }
  // r5: two smoothing passes (the per-vertex umbrella Laplacian alternates along thin grooves and drew
  // them as dotted dark lines)
  for (let pass = 0; pass < 2; pass++) {
    const acc = new Float32Array(nV), cn = new Float32Array(nV);
    for (let f = 0; f < faces.length; f++) {
      const [a, b, c] = faces[f];
      acc[a] += cavity[b] + cavity[c]; cn[a] += 2;
      acc[b] += cavity[a] + cavity[c]; cn[b] += 2;
      acc[c] += cavity[a] + cavity[b]; cn[c] += 2;
    }
    for (let i = 0; i < nV; i++) cavity[i] = Math.min(1, (0.4 * cavity[i] + 0.6 * acc[i] / Math.max(1, cn[i])) * 1.25);
  }
  geo.setAttribute('aCavity', new THREE.BufferAttribute(cavity, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
