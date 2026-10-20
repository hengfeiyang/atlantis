// Sunken material overlay (OWNER: underwater agent). Injected by core/underwater.js into every LIT material
// in the sunken era (never in golden), right before the emissive / lighting stage, i.e. after the material's
// own colour / roughness / metalness / normal hooks: it sees the final albedo and transforms it.
//
// Tag materials with mat.userData.sunken (docs/CONTRACT.md):
//   'stone'  slight greening, darkening, crevice grime, algae turf, coral-algae crust, sand dust on up faces
//   'metal'  bronze / orichalcum → verdigris crust (green-blue, matte) with dark bronze showing through
//   'gold'   stays gold but dulled (rougher, darker film in crevices), a few crust patches, light sand
//   'wood'   waterlogged dark grey-brown, heavy algae (wrecks)
//   'none'   no overlay (sand terrain, corals, fish, water…) — still gets the medium, caustics, depth light
//   untagged → 'stone' at half strength (please tag!)
// Optional mat.userData.sunkenAmount (0..1, default 1) scales everything for that material.
//
// ---------------------------------------------------------------------------------------- uniforms (SK)
//   uSkSand        vec4  x drift coverage of up faces (0..1), y/z smoothstep of world-normal.y (lo, hi),
//                        w drift noise scale (1/m); plus a thin dust film on every up face
//   uSkSandColor   vec3  linear albedo of the dust (pale, slightly warm)
//   uSkAlgae       vec4  x amount, y patch scale (1/m), z up-facing bias, w coverage threshold
//   uSkAlgaeColor  vec3  turf colour A (olive brown)   uSkAlgaeColor2 vec3 turf colour B (green)
//   uSkCrust       vec4  x amount, y spot scale (1/m), z threshold, w bump strength
//   uSkCrustColor  vec3  coralline crust (dusty pink)   uSkCrustColor2 vec3 (orange/purple variation)
//   uSkVerdigris   vec3  verdigris A (#3f8c7a-ish)      uSkVerdigris2 vec3 (pale blue-green)
//   uSkMetal       vec4  x verdigris coverage, y streaks, z dark bronze albedo scale, w crust roughness
//   uSkGold        vec4  x roughness added, y crevice darkening, z crust amount, w albedo scale
//   uSkStone       vec4  x greening, y crevice darkening, z overall darkening, w roughness added
//   uSkWood        vec4  x darkening, y greying, z algae boost, w
//   tSkDrift / uSkDrift  r3: world-space drift mask (R8, 1 = sand piles up: wall feet, steps, basin sides; 0 = open
//                  paving swept clean), baked by the marine module from its top-down surface map of the plateau.
//                  uSkDrift = (x0, z0, 1/size, on); uSkDrift2 = (coverage multiplier on open ground, at full mask, film on open, -)
// GLSL: void skApply(inout vec3 alb, inout float rough, inout float metal, inout vec3 bumpW, vec3 P, vec3 N)
import * as THREE from 'three';

const c3 = (hex, s = 1) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r * s, c.g * s, c.b * s); };

export const SK = {
  uSkSand: { value: new THREE.Vector4(0.3, 0.55, 0.9, 0.35) },  // r2 (look-sunken): 0.45 → 0.3 (paving / mosaics readable, ref 6, 8)
  uSkSandColor: { value: c3('#d9d3c0') },
  uSkAlgae: { value: new THREE.Vector4(0.6, 0.45, 0.22, 0.66) },
  uSkAlgaeColor: { value: c3('#4d4a2a') },
  uSkAlgaeColor2: { value: c3('#3d5a35') },
  uSkCrust: { value: new THREE.Vector4(0.5, 1.3, 0.66, 0.6) },
  uSkCrustColor: { value: c3('#b88a8c') },
  uSkCrustColor2: { value: c3('#9a6a8a') },
  uSkVerdigris: { value: c3('#3f8c7a') },
  uSkVerdigris2: { value: c3('#6fb3a2') },
  uSkMetal: { value: new THREE.Vector4(0.7, 0.5, 0.9, 0.8) },  // r3 (look-sunken): more verdigris + brighter bronze between (r2 0.62 / 0.6: the shot-6 chariot / Nereids read as navy silhouettes)
  uSkGold: { value: new THREE.Vector4(0.12, 0.4, 0.3, 0.9) },  // r2 (look-sunken): less dulled — gold glints at 30-50 m (refs 6, 8)
  uSkStone: { value: new THREE.Vector4(0.3, 0.45, 0.08, 0.2) },
  uSkWood: { value: new THREE.Vector4(0.3, 0.4, 0.3, 0) },
  tSkDrift: { value: null },
  uSkDrift: { value: new THREE.Vector4(0, 0, 1, 0) },
  uSkDrift2: { value: new THREE.Vector4(0.3, 1.9, 0.5, 0) },
};

const KIND = { none: 0, stone: 1, metal: 2, gold: 3, wood: 4 };
/** { kind, amt } for a material (kind 0 = no overlay) */
export function sunkenKind(mat) {
  const tag = mat.userData.sunken;
  let kind = KIND[tag];
  let amt = mat.userData.sunkenAmount ?? 1;
  if (kind === undefined) { kind = 1; amt *= 0.5; }
  return { kind, amt: Math.max(0, Math.min(1, amt)) };
}

export const SK_GLSL = /* glsl */ `
#ifndef CG_SK_INCLUDED
#define CG_SK_INCLUDED
uniform vec4 uSkSand; uniform vec3 uSkSandColor;
uniform vec4 uSkAlgae; uniform vec3 uSkAlgaeColor; uniform vec3 uSkAlgaeColor2;
uniform vec4 uSkCrust; uniform vec3 uSkCrustColor; uniform vec3 uSkCrustColor2;
uniform vec3 uSkVerdigris; uniform vec3 uSkVerdigris2;
uniform vec4 uSkMetal; uniform vec4 uSkGold; uniform vec4 uSkStone; uniform vec4 uSkWood;
uniform sampler2D tSkDrift; uniform vec4 uSkDrift; uniform vec4 uSkDrift2;

float skH(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 skG(vec3 i){ return normalize(vec3(skH(i), skH(i + 19.19), skH(i + 47.53)) * 2.0 - 1.0 + 1e-4); }
// 3D gradient noise in [0, 1] (no lattice blockiness when thresholded)
float skN(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(skG(i), f), n100 = dot(skG(i + vec3(1,0,0)), f - vec3(1,0,0));
  float n010 = dot(skG(i + vec3(0,1,0)), f - vec3(0,1,0)), n110 = dot(skG(i + vec3(1,1,0)), f - vec3(1,1,0));
  float n001 = dot(skG(i + vec3(0,0,1)), f - vec3(0,0,1)), n101 = dot(skG(i + vec3(1,0,1)), f - vec3(1,0,1));
  float n011 = dot(skG(i + vec3(0,1,1)), f - vec3(0,1,1)), n111 = dot(skG(i + vec3(1,1,1)), f - vec3(1,1,1));
  float v = mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
  return clamp(v * 1.1 + 0.5, 0.0, 1.0);
}
float skF(vec3 p){ return 0.5 * skN(p) + 0.27 * skN(p * 2.03 + 17.1) + 0.15 * skN(p * 4.11 + 3.7) + 0.08 * skN(p * 8.3 + 9.2); }
// gradient-ish bump from a noise (finite differences of a cheap field)
vec3 skBumpOf(vec3 p, float s){
  float e = 0.35 / s;
  float c = skN(p * s);
  return vec3(skN((p + vec3(e,0,0)) * s) - c, skN((p + vec3(0,e,0)) * s) - c, skN((p + vec3(0,0,e)) * s) - c) / e;
}

void skApply(inout vec3 alb, inout float rough, inout float metal, inout vec3 bumpW, vec3 P, vec3 N, int kind, float amt){
  float up = N.y;
  float n1 = skF(P * uSkAlgae.y);                       // large patches
  float n2 = skF(P * 1.9 + 5.3);                        // medium
  float n3 = skN(P * 11.0);                             // fine grain
  // grime / pitting mask (stands in for crevices: blotchy, never line-like)
  float crev = smoothstep(0.55, 0.8, n2 * 0.7 + skN(P * 4.3 + 1.7) * 0.3);
  // ---- base transformations
  if (kind == 1) {          // stone
    alb *= 1.0 - uSkStone.z * amt;
    alb = mix(alb, alb * vec3(0.80, 0.98, 0.86), uSkStone.x * amt * (0.5 + 0.5 * n1));
    alb *= 1.0 - uSkStone.y * amt * crev;
    rough = min(1.0, rough + uSkStone.w * amt);
  } else if (kind == 2) {   // bronze / orichalcum → verdigris
    float streak = skF(vec3(P.x * 2.2, P.y * 0.25, P.z * 2.2));
    float v = smoothstep(0.30, 0.62, n1 * 0.55 + n2 * 0.45 + 0.18 * up + uSkMetal.y * (streak - 0.5) * 0.5 + (uSkMetal.x - 0.5) * 0.8);
    v = clamp(v * amt, 0.0, 1.0);
    vec3 verd = mix(uSkVerdigris, uSkVerdigris2, smoothstep(0.35, 0.75, n2 * 0.7 + n1 * 0.3));
    vec3 darkB = alb * uSkMetal.z;
    alb = mix(darkB, verd * (0.85 + 0.2 * n3), v);
    metal = mix(metal * 0.85, 0.0, v);
    rough = mix(max(rough, 0.45), uSkMetal.w, v);
    bumpW += skBumpOf(P, 3.0) * 0.025 * v;
  } else if (kind == 3) {   // gold: dulled, keeps glinting
    rough = min(1.0, rough + uSkGold.x * amt);
    alb *= mix(1.0, uSkGold.w, amt) * (1.0 - uSkGold.y * amt * crev);
  } else if (kind == 4) {   // waterlogged wood
    alb = mix(alb, vec3(dot(alb, vec3(0.33))) * 0.6, uSkWood.y * amt) * (1.0 - uSkWood.x * amt);
    rough = max(rough, 0.85);
  }
  // ---- algae turf (patchy, more on up-facing faces; little on gold)
  float aAmt = uSkAlgae.x * amt * (kind == 3 ? 0.25 : (kind == 4 ? 1.0 + uSkWood.z : 1.0)) * (kind == 2 ? 0.55 : 1.0);
  float a = smoothstep(uSkAlgae.w - 0.12, uSkAlgae.w + 0.12, n1 + uSkAlgae.z * up + 0.12 * (n3 - 0.5) + 0.25 * crev);
  a *= aAmt;
  vec3 aC = mix(uSkAlgaeColor, uSkAlgaeColor2, smoothstep(0.35, 0.7, n2)) * (0.7 + 0.5 * n3);
  alb = mix(alb, aC, a * 0.85);
  rough = mix(rough, 0.95, a);
  metal = mix(metal, 0.0, a);
  bumpW += skBumpOf(P, 13.0) * 0.05 * a;
  // ---- coral-algae crust spots (pink / mauve), on edges and up faces
  float cs = skF(P * uSkCrust.y + 31.0);
  float cr = smoothstep(uSkCrust.z, uSkCrust.z + 0.06, cs + 0.08 * up) * uSkCrust.x * amt * (kind == 3 ? uSkGold.z : 1.0);
  vec3 cC = mix(uSkCrustColor, uSkCrustColor2, smoothstep(0.4, 0.7, skN(P * 0.7 + 8.0)));
  alb = mix(alb, cC * (0.8 + 0.4 * n3), cr);
  rough = mix(rough, 0.9, cr); metal = mix(metal, 0.0, cr);
  bumpW += skBumpOf(P, 5.0) * uSkCrust.w * 0.25 * cr;
  // ---- sand on up-facing surfaces: a thin dust film everywhere + patchy drifts (x = drift coverage)
  float upM = smoothstep(uSkSand.y, uSkSand.z, up + 0.12 * (n2 - 0.5));
  float drift = skF(P * uSkSand.w + 2.0);
  float s = upM * smoothstep(1.0 - uSkSand.x - 0.1, 1.0 - uSkSand.x + 0.1, drift + 0.06 * (n3 - 0.5));
  s *= amt * (kind == 3 ? 0.55 : 1.0);
  float film = upM * 0.12 * amt;
  if (uSkDrift.w > 0.5) {
    // r3: drifts gather against walls / steps / basins, open paving stays readable (ref 6)
    vec2 duv = (P.xz - uSkDrift.xy) * uSkDrift.z;
    if (all(greaterThan(duv, vec2(0.0))) && all(lessThan(duv, vec2(1.0)))) {
      float dm = texture(tSkDrift, duv).r;
      dm = smoothstep(0.0, 1.0, dm + 0.25 * (n2 - 0.5));
      s = min(1.0, s * mix(uSkDrift2.x, uSkDrift2.y, dm) + upM * amt * smoothstep(0.55, 0.95, dm) * 0.6);
      film *= mix(uSkDrift2.z, 1.0, dm);
    }
  }
  vec3 sandC = uSkSandColor * (0.88 + 0.22 * n3);
  alb = mix(alb, sandC, film);
  alb = mix(alb, sandC, s);
  rough = mix(rough, 1.0, max(s, film)); metal = mix(metal, 0.0, s);
}
#endif
`;

// fragment injection (before #include <emissivemap_fragment>): diffuseColor / roughnessFactor /
// metalnessFactor / normal (view space) are final by then; lights_*_fragment reads them next.
export const SK_FRAG = /* glsl */ `
#ifdef CG_SK_KIND
{
  vec3 skB = vec3(0.0);
  vec3 skN0 = normalize(vUwWN);
  #ifdef STANDARD
    skApply(diffuseColor.rgb, roughnessFactor, metalnessFactor, skB, vUwWP, skN0, CG_SK_KIND, CG_SK_AMT);
  #else
    float skR = 1.0, skM = 0.0;
    skApply(diffuseColor.rgb, skR, skM, skB, vUwWP, skN0, CG_SK_KIND, CG_SK_AMT);
  #endif
  normal = normalize(normal + (viewMatrix * vec4(skB, 0.0)).xyz);
}
#endif
`;
