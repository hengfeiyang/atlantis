// Per-shot LOOK overrides (sun, grade, atmo, sky). Owner: look-dev (director); sun / sky / grade / clouds
// entries written by the sky agent (round 1) — keep the per-shot comments when editing.
//
// Keys per shot id: sun {azimuth, elevation, color?, intensity?}, sky {...SKY uniforms (core/sky.js)},
// grade {...GRADE uniforms (core/pipeline.js)}, atmo {...ATMO uniforms}, clouds {...CLOUDS uniforms
// (modules/clouds.js: mountain banks)}, terrain {uFarTint, uRockTint, uGroundTint, uSnowLine, uTBounce → registry.terrain.uniforms,
// applied by modules/clouds.js (r2)}, water {uSunSpec, uGlitterTint → registry.water.uniforms, clouds.js (r2)}, envIntensity. Merge order in engine.applyShot: defaults → LOOKS[id] →
// explicit overrides on the shot object.
//
// The light is art-directed RELATIVE TO THE CAMERA HEADING (survives camera re-solves in shots.js):
//   sunRel(id, dAz, el): dAz < 0 = light from the left of frame (-90 pure side light, -180 from behind).
// The VISIBLE sun (disk, aureole, sky glow, cloud lighting, haze glow, water glitter) is placed by diskRel(id, px, el):
// azimuth from the reference's sun pixel column, elevation above the horizon read off the reference → SKY.uSunDiskMode/uSunDiskDir; the
// clouds module then points ATMO.uSunDir at it (see core/sky.js header). The refs show the sun top-left in frame
// while the scene is side-lit from the left — physically inconsistent, deliberately.
import { SHOTS } from './shots.js';
import { dirFromAzEl } from './layout.js';

const shotById = (id) => SHOTS.find((x) => x.id === id);
function heading(id) {
  const s = shotById(id);
  if (!s) return 0;
  const dx = s.target[0] - s.pos[0], dz = s.target[2] - s.pos[2];
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
}
const sunRel = (id, dAz, el, extra = {}) => ({ azimuth: (heading(id) + dAz + 720) % 360, elevation: el, ...extra });

// r2 (look-golden): elevations re-read against the r2 director cameras so the disk lands on the reference's sun
// pixel (shot 1: 1.8° → y ≈ 40 above our horizon row 90; shot 2: 14° → y ≈ 240 like ref 2, the sun sits high over the
// left quay; shot 5: 10° → y ≈ 190, clears the city roofs like ref 5).
/**
 * Visible sun disk: azimuth from the reference's sun pixel column px (1672-wide frame, through the shot's
 * horizontal field of view — survives camera re-solves that keep the heading / fov), elevation `el` (deg)
 * measured above the sea horizon in the reference (the refs' low sun sits 1.5-5° above the horizon).
 */
function diskRel(id, px, el) {
  const s = shotById(id);
  const tx = Math.tan(((s.fov || 40) * Math.PI) / 360) * (1672 / 941);
  const dAz = (Math.atan(((2 * px) / 1672 - 1) * tx) * 180) / Math.PI;
  return { uSunDiskMode: 1, uSunDiskDir: dirFromAzEl((heading(id) + dAz + 720) % 360, el) };
}
// auto tone curve targets = each reference's own sRGB luminance percentiles (p02, p10, p50, p90, p98)
const LV = (p02, p10, p50, p90, p98) => ({ uAutoLevels: 1.0, uLevelTarget: [p02, p10, p50, p90, p98] });

// ---------------------------------------------------------------- golden hour (refs 1-5)
// Sky: orange-gold across the sun half (uSkyGlow), deep blue top-right, lavender-pink horizon away from the sun;
// puffy cumulus (base ~1.7 km) with gold sunlit rims (uCloudSunTint) and violet-grey undersides (uCloudAmbBotCol);
// cirrus streaks high up.
const GOLD_SKY = {
  uZenith: [0.012, 0.12, 0.36], uSkyFalloff: 4.5, uSkyZenithTint: [0.95, 1.0, 1],
  uSkyGlow: [2.4, 0.85, 0.12, 1.0], uSkyGlowW: [60, 13], uSkySunTint: [1, 0.45, 0.1],
  uSkyHorizonTint: [0.7, 0.52, 0.48],
  uSkyAureole: [0.3, 0.8, 6.0],
  uCloudCover: 0.38, uCloudScale: 1.7, uCloudBase: 1800, uCloudThick: 1100, uCloudSigma: 0.06,
  uCloudBright: 7.0, uCloudAmbient: 1.2, uCloudPowder: 0.6, uCloudErode: 0.9, uCloudLight: [0, 0.5],
  uCloudAmbTopCol: [0.8, 0.62, 0.78], uCloudAmbBotCol: [0.75, 0.48, 0.55], uCloudSunTint: [1.0, 0.6, 0.28],
  uCloudGlowAmb: 1.5, uCirrus: [0.05, 7500, 0.5],
};
// r2 (look-golden): the r1 golden look read sepia / brown (colourfulness 37-44 vs refs 60-67, sky orange-brown,
// clouds blocky). GOLD_SKY2 / GOLD_GRADE are used by shots 1-5 (GOLD_SKY above is kept as is for shot 9):
//   * clouds: thinner extinction + softer erosion + flatter, wider decks (soft edges; the r1 0.06 / 1100 m layer was
//     opaque at the first sample → cut-out blobs), lit from 6° (gold undersides), cream-gold sun tint instead of
//     orange, lavender ambient → white-peach cumulus with violet-grey shading (refs 2, 3, 5)
//   * sky: brighter, less violet zenith (refs' top ≈ rgb 50,92,139 … 93,114,143), sunset glow confined to ±40° az /
//     10° el around the low sun, near-neutral horizon tint away from it (was pink → lavender-brown band)
//   * grade: Khronos-neutral tone map (AgX bleached the blues / turquoise into grey-brown), neutral white balance
//     (the warmth comes from the sun, the glow and the stone, not a global tint), slightly lower base saturation
const GOLD_SKY2 = {
  ...GOLD_SKY,
  uZenith: [0.05, 0.15, 0.33], uSkyFalloff: 7.0, uSkyGlow: [2.2, 1.05, 0.35, 1.0], uSkyGlowW: [40, 10], uSkyHorizonTint: [0.88, 0.86, 0.9],
  uCloudSigma: 0.035, uCloudErode: 0.85, uCloudThick: 800, uCloudCover: 0.42, uCloudScale: 1.9,
  uCloudSunTint: [1.0, 0.72, 0.48], uCloudAmbTopCol: [0.85, 0.75, 0.95], uCloudAmbBotCol: [0.7, 0.55, 0.7],
  uCloudLight: [6, 0.8], uCloudGlowAmb: 1.0,
  uCloudFar: [10000, 30000], uCloudFarMin: 0.0, uCloudMaxDist: 32000, // low sky near the horizon clears: the low sun shows (refs 1, 3, 5)
  // r3 (look-golden): broader stratocumulus masses (scale 1.9 → 2.8, 1 km deep) lit from 18° with a lighter light path (the
  // r2 6° light left only bright cut-out rims around lavender bodies), softer edges (uCloudEdge), denser cores, warmer
  // ambient inside the glow; sunset streak bars low over the horizon (uStreak, refs 1, 3, 5)
  uCloudScale: 2.8, uCloudThick: 1000, uCloudLight: [18, 0.45], uCloudEdge: 1.5, uCloudSigma: 0.06,
  uCloudGlowAmb: 2.0, uCloudAmbient: 0.85, uCloudCover: 0.38, uSkyGlowW: [40, 7], uCloudSunTint: [1.0, 0.62, 0.36], // blue gaps between the masses (refs' top-right ≈ rgb 50-90,93-105,131-140)
  uStreak: [1.2, 2600, 10, 0.45],
};
// r4 (look-golden): volumetric, opaque cumulus with shaded bodies (r3 read as flat cream paper cut-outs / thin veils):
//   denser extinction (0.06 → 0.12, edge exponent 1), lit from 4° (gold lower rims), full light path, orange sun tint;
//   warm ambient (peach tops, rust bases) and much less aerial haze in front of the cloud bodies (uCloudHaze: the blue
//   haze turned every shaded body lavender-grey; refs 2, 3, 5 bodies are peach / brown-grey); no cirrus veil; the clear
//   sky keeps a saturated orange only low around the sun (weak broad aureole, blue reaches lower: falloff 7 → 4)
const GOLD_SKY4 = {
  ...GOLD_SKY2,
  uCloudSigma: 0.12, uCloudEdge: 1.0, uCloudErode: 1.0, uCloudScale: 2.4, uCloudThick: 1300, uCloudCover: 0.4,
  uCloudLight: [4, 1.0], uCloudSunTint: [1, 0.5, 0.22], uCloudBright: 7, uCloudAmbient: 1.6, uCloudGlowAmb: 3,
  uCloudAmbTopCol: [0.9, 0.72, 0.66], uCloudAmbBotCol: [0.9, 0.55, 0.38], uCloudHaze: 0.2, uCirrus: [0, 7500, 0.5],
  uSkyAureole: [0.05, 0.3, 4], uSkyFalloff: 4, uSkyGlow: [1.9, 0.9, 0.22, 1], uSkyGlowW: [34, 5],
  // r5 (look-golden): no speckled cloud fragments (shots 2-4): fade the clump fringes of the weather map, drop the thin
  //     fringe density before the edge erosion (core/sky.js uCloudFrag)
  uCloudFrag: [0.32, 0.2],
  // r5: disk radiance 1600 → 400: the 1600× disk drove the grade non-monotonic at its limb (a pink-blue ring around a grey-white
  //     disk, shot 1 still + motion); 400 still clips to white and feeds the lens glare / rays
  uSunDisk: 400,
};
const GOLD_GRADE = {
  uToneMap: 2, uWhiteBalance: [1, 1, 1], uSaturation: 0.92, uVibrance: 0.08, uHuePreserve: 0.6,
  uHueSat: [0.95, 1.05, 1.0, 0.85, 0.92, 0.95, 0.9, 0.75],
};
const GOLD_SUN = [1.0, 0.82, 0.62];              // warm golden light (stone glows cream-gold)
// r5 (look-golden): terrain r5 far range (pale limestone) read snow-white under the golden grades → darker, warmer rock
const GOLD_TERRAIN = { uFarRock: [0.45, 1, 1, 1], uFarTint: [1.12, 0.94, 0.78] }; // r6: 0.55 / [1.1, 0.98, 0.85] → warmer tan lit faces, less white (refs 3, 5)
const GOLD_WATER = { uGlitterTint: [1.0, 0.66, 0.34] }; // r2: the glitter path under the low sun is gold (refs 1-3, 5), not white
const SUN_LENS = { uLensGlare: 0.7, uLensRays: 0.14, uLensGhost: 0.0 };
// (r1 GOLD_WB [1.05, 1, 0.92] warm white balance removed in r2: see GOLD_GRADE)
const UW_HUE = { uHueShift: [0, 3, -3, -3, 0, 14, 4, -8], uHueSat: [0.9, 1.0, 1.0, 0.85, 0.92, 1.15, 1.05, 0.75] }; // sunken (look-sunken)
// r6 (look-golden): the 8-15 km ranges veiled cool slate-blue (terrain r5: shadows ≈ 78,65,61 vs ref 50,61,75), toward the low
//     sun a tight peach-gold lobe; own colour for the far haze term (core/atmosphere.js uHazeFarCol / uHazeFarSun), which now
//     starts nearer (15 → 10 km scale); the near haze over the city keeps its colour
const GOLD_FARHAZE = { uHazeFar: [0.28, 10000], uHazeFarCol: [0.28, 0.5, 0.8, 1], uHazeFarSun: [0.9, 0.8, 1, 0.8], uHazeFarWarm: [2.0, 1.15, 0.58] };
// (uHazeFarSun.w / uHazeFarWarm: within ≈ 37° of the sun's azimuth the far term turns warm gold — far sea + ranges toward the sun, ref 1)
const GOLD_ATMO = { uMie: [0.76, 0.3, 0.8], uHazeColor: [0.66, 0.74, 0.98], ...GOLD_FARHAZE }; // r2: bluer (was 0.8, 0.78, 0.98: mauve mid-sky + lavender-brown aerial perspective) // stronger Mie glow toward the (visible) sun, lavender haze away from it

export const LOOKS = {
  // 1 — grand aerial from the south: sun low at the top-left over the sea (ref px 118,75), city side-lit from the
  //     left-front; cloud banks across the middle of the mountain flanks; cumulus heaped above the range.
  1: { sun: sunRel(1, -115, 14, { color: GOLD_SUN }), sky: { ...GOLD_SKY2, ...diskRel(1, 144, 1.2), // r4: director camera (heading 0, horizon row 107): px 144 / el 1.2 → disk ≈ (118, 64), ref (118, 75) 53 px above its horizon. r3: px 118 → 150 (the pitched camera put the disk at px 84; now ≈ 118)
      // r3: peach-orange glow (ref ≈ rgb 248,170,96 around the sun, not clipped white), tight weak aureole, streak bars
      uSkyGlowW: [45, 14], uSkyGlow: [1.45, 0.92, 0.5, 1.0], uSkyAureole: [0.1, 0.15, 0.5], uStreak: [1.4, 2600, 10, 0.42],
      uEnvBlue: 0.4, uEnvSat: 0.85,
      // r4: GOLD_SKY4 cumulus; the visible sky is only 0-5° high here (the layer is seen edge-on 20-40 km out = a flat brown ceiling
      //     in r3) → far cumulus thinned out, fewer clouds; brighter peach-yellow glow (ref ≈ rgb 250,195,125) narrower in azimuth
      //     (mauve-blue behind the range on the right), softer streak bars, bluer low sky (falloff 4: bluer ring reflections)
      ...GOLD_SKY4, uCloudCover: 0.3, uCloudFar: [6000, 22000], uCloudLight: [10, 0.8], uCloudAmbient: 2.2, uCloudBright: 8,
      uCloudSunTint: [1, 0.58, 0.32], uCloudHaze: 0.35, uSkyGlow: [2.0, 1.35, 0.75, 1], uSkyGlowW: [18, 12], uSkyAureole: [0.1, 0.15, 0.5],
      uStreak: [0.8, 2600, 10, 0.5],
      // r5: stronger sunset streak bars + a brighter mid glow around the disk (ref 1: layered orange bands over the sun)
      uStreak: [1.5, 2600, 10, 0.4], uSkyAureole: [0.3, 1.0, 4], uSkyGlow: [1.5, 0.85, 0.4, 1] /* r5: the r4 glow (2.0, 1.35, 0.75) flooded the band round the sun cream-white: the disk had no glow to sit in */,
      uStreak: [0.9, 1400, 10, 0.5] /* r6: the r5 bars (1.5 / 2600 m) read as horizontal banding in the sky + its sea reflection → fewer, softer, nearer (thicker) */ }, envIntensity: 2.5, // r2: sky fill lifts the far city's shadows (bright cream city, blue-violet shade, ref 1)
    // r3: warmer (white balance / highlight tint: ref city ochre-gold, ours cream-grey), calmer micro contrast (the dense city read
    //     as black-and-white noise), orange glare halo
    grade: { ...SUN_LENS, ...GOLD_GRADE, uLensGlare: 0, uLensRays: 0, // r5: glare 0.15 → 0 (a yellow-green column over the glitter; the sun glow is the sky aureole)
      uLensTint: [1, 0.62, 0.3], uSaturation: 1.0, uVibrance: 0.15,
      // r4: warmer lit stone (ref city ochre-cream), glare 0.3 → 0.15 (a yellow-green blob over the glitter); far greens (plain, rings,
      //     foothills read yellow / saturated vs ref 1's olive-blue-green): yellow-green + green bands toward green, less chroma
      // r5: cooler (director r5 camera: yb 23 vs ref 14, blue low in every row) — was [1, 1, 1] / [0.016, 0.006, -0.012]
      uWhiteBalance: [0.98, 1, 1.06], uHighTint: [0.012, 0.006, -0.002], // neutral mids + cool shadows (yb 24 → 15, ref 14), warm highlights
      uHueShift: [0, 3, -3, 4, 4, 0, -6, -8], uHueSat: [0.95, 1.05, 0.9, 0.6, 0.75, 0.95, 0.92, 0.75], uLtmFine: 0.12, uLtmMid: 0.3,
      uLtmBase: 0.45, uLtmLarge: 0.12, uShadowTint: [-0.006, 0.002, 0.03], ...LV(21, 33, 96, 197, 236),
      uWhiteBalance: [0.95, 1, 1.14], uSaturation: 1.12 /* r6 final grade (high): yb 20 → 14, sat 42 → 43 (ref 14 / 44) */ },
    // r3: golden aerial perspective (ref 1: the sea toward the sun ≈ rgb 223,158,117 below the horizon, the plain / far rings veiled
    //     warm; r2 grey-blue): broad warm Mie lobe, denser low haze, far haze; light pool on the citadel hill + broken cloud
    //     shade over the outer rings / plain (citadel separation)
    atmo: { ...GOLD_ATMO, uMie: [0.6, 0.7, 0.8], uHazeColor: [1.25, 0.85, 0.58], uHazeLow: [0.00003, 420], uHazeFar: [0.2, 20000], uHaze: [0.000005, 1600, 0], // r4: much less haze (r3 veiled the city / plain / range grey-brown; ref 1 is crisp to the peaks)
     
      uExtinction: [0.7, 0.85, 1.1], uPool: [0, 0, 330, 0.6], uPoolShade: [0.45, 380, 0.48, 3500],
      // r6: far range slate-blue (right-range shadows 71,61,60 → ≈ 63,73,90; ref 54,64,77), peach veil only toward the sun
      uHazeFar: [0.32, 10000], uHazeFarCol: [0.3, 0.6, 0.86, 1], uHazeFarSun: [0.9, 0.8, 1, 0.8], uHazeFarWarm: [2.0, 1.15, 0.58] }, // far sea toward the sun gold (≈ 195,153,115; was grey-peach 191,153,123 / ref 233,164,117)
    clouds: { uBankAmount: 1.8, uBankAlt: [-250, 1.3], uBankLight: [0.8, 1.0, 1.35, 1.5] }, // r4: mountains 0.62x → white cumulus heaps along the range (ref 1), whiter
    // r5: terrain r5 far range = pale limestone → read snow-white under this grade; darker, warmer rock (ref 1 lit tan faces)
    terrain: { uFarRock: [0.5, 1, 1, 1], uFarTint: [1.1, 0.98, 0.85] },
    water: { uSunSpec: [0.18, 0], uGlitterTint: [1.0, 0.55, 0.22] } }, // r3: gold glitter path (ref ≈ rgb 250,197,121): gain 0.7 → 0.18 (r2 read as a 150 px white blob)
  // 2 — water level in the sea canal: sun left of the bridge tower (ref px 235,240), big gold clouds top-left,
  //     blue-violet sky top-right.
  2: { sun: sunRel(2, -95, 15, { color: GOLD_SUN }), sky: { ...GOLD_SKY4, ...diskRel(2, 235, 14), uCloudCover: 0.42,
      uSkyGlowW: [34, 12], uZenith: [0.06, 0.135, 0.29],
      uCloudLight: [20, 0.6], uCloudAmbient: 2.6, uCloudBright: 10, uCloudSunTint: [1, 0.6, 0.32], uCloudHaze: 0.4 }, // r4: GOLD_SKY4 volumetric cumulus, seen from below at water level → lit from 20°, brighter ambient (bright gold-peach heaps, ref 2) // r3: glow 52 → 34° wide (gold left, blue-lavender right as ref 2) // r2: gold-peach left half, muted blue right (ref top ≈ 93,114,143)
    grade: { ...SUN_LENS, ...GOLD_GRADE, ...LV(18, 46, 109, 203, 242), uWhiteBalance: [1.02, 1, 1.01] /* r6: yb 29 → 33 (ref 33; the r6 turquoise canal cooled the frame) */, uSaturation: 0.88 /* r5: sat 49 → ref 45 */, // r5: yb 36 → 34 (ref 33) // r3: yb 42 → 33 (ref 33)
      uHueShift: [0, 3, -3, -3, 0, 0, -8, -8], uHueSat: [0.95, 1.05, 1.0, 0.85, 0.92, 1.12, 0.95, 0.75] }, // r2: canal water toward turquoise
    atmo: GOLD_ATMO, clouds: { uBankAmount: 0.6 }, terrain: GOLD_TERRAIN, water: GOLD_WATER },
  // 3 — temple from the citadel stair: sun low over the sea at the left (ref px 165,272), temple front lit from
  //     the left, orange left half of the sky, deep blue top-right.
  3: { sun: sunRel(3, -100, 17, { color: GOLD_SUN }), sky: { ...GOLD_SKY4, ...diskRel(3, 165, 2.0),
      // r5: smaller, denser cumulus puffs lit from 8° with gold tops / darker bodies (r4 flat lavender slabs; ref 3 textured heaps)
      uCloudLight: [8, 0.9], uCloudAmbient: 1.4, uCloudBright: 10, uCloudSunTint: [1, 0.55, 0.28], uCloudHaze: 0.25, uCloudScale: 1.8, uCloudCover: 0.44 }, // r4: GOLD_SKY4 (cover 0.34 → 0.4, glow 34 × 5°) // r3: blue top-right, gold only low around the sun
    grade: { ...SUN_LENS, ...GOLD_GRADE, ...LV(14, 41, 112, 197, 229), uShoulder: [0.84, 1.0] /* r3: p98 215 → 227 (ref 229) */, uWhiteBalance: [0.98, 1, 1.06] /* r6: yb 40 → 36, sat 48 → 46 (ref 36 / 46); r5: yb 40 → ref 36 */, uSaturation: 0.88, uLensRays: 0.04 /* r4: the screen-space rays drew a white beam down across the plaza */ }, atmo: { ...GOLD_ATMO, uMie: [0.76, 0.15, 0.8] } /* r4: weaker Mie (blue haze + orange Mie = pink-mauve sky band) */, clouds: { uBankAmount: 0.8 }, terrain: GOLD_TERRAIN, water: GOLD_WATER },
  // 4 — inner ring, ship-sheds: sun behind the citadel hill at the left (ref px 110,215), right wall lit,
  //     banks in the mountain valley right of centre.
  // r3 (director): camera re-composed (bearing 163 near the l1 face, heading 5); light from az ≈ 305 / el 18 (dAz -60): it
  //     clears the raised citadel (summit 62, ray ≥ 78 m over the plateau rim) and lights the l1 inner face + sheds frontally
  //     (r2: az 292 / el 14 left the l1 face in the citadel's shadow)
  4: { sun: sunRel(4, -60, 18, { color: GOLD_SUN }), sky: { ...GOLD_SKY4, ...diskRel(4, 110, 16), // r4: GOLD_SKY4
      uZenith: [0.14, 0.22, 0.36], uSkyZenithTint: [1.0, 1.15, 1],
      uCloudLight: [18, 0.8], uCloudAmbient: 2.2, uCloudBright: 8, uCloudSunTint: [1, 0.58, 0.32], uCloudHaze: 0.35 }, // r4: peach heaps lit from 18° // r3: paler, warmer-blue top (ref ≈ rgb 104,134,171; r2 30,74,117)
    // r3 (look-golden) warmth: warm white balance + highlight tint (ref 4 mean yb +25, r3a -11), cyan band toward teal, gold glitter
    grade: { ...SUN_LENS, ...GOLD_GRADE, uSaturation: 0.86, uVibrance: 0.04, ...LV(18, 47, 111, 189, 232),
      // r5: cooler (yb 35 → 26, ref 25: the r3 warm balance + warm water glitter made the whole frame amber; ref 4 blue 96 mean)
      uWhiteBalance: [0.985, 1, 1.07] /* r6: yb 27 → 25 (ref 25) */, uHighTint: [0.008, 0.004, -0.004],
      uHueShift: [0, 3, -3, -3, 0, -6, -6, -8], uHueSat: [0.95, 1.05, 1.0, 0.85, 0.92, 0.9, 0.85, 0.75], uHueLum: [0, 0, -0.02, -0.06, -0.08, -0.05, -0.04, 0] }, // r2: ring water ref ≈ rgb 46,105,126 (teal, deeper)
    atmo: GOLD_ATMO, clouds: { uBankAmount: 1.1 }, terrain: GOLD_TERRAIN, water: { uSunSpec: [0.35, 0], uGlitterTint: [1.0, 0.72, 0.48] } }, // r5: 0.5 → 0.35, paler glitter (the ring water read amber, ref 4 turquoise with gold building reflections) // r4: sun glitter 1.2 → 0.5 (a smooth gold sheen covered the left half of w1; ref 4 turquoise + streaks)
  // 5 — garden terrace toward the citadel: sun over the sea left of the citadel (ref px 365,185), cumulus rows,
  //     low banks at the mountain foot to the right.
  5: { sun: sunRel(5, -95, 16, { color: GOLD_SUN }), sky: { ...GOLD_SKY4, ...diskRel(5, 500, 5.8), uSkyGlowW: [30, 9], // r4: disk px 362 → ≈ 480 (r4 camera: column 2 spans px 300-425 at the sun row; the disk now sits in the open sky right of it, ref 365 right of its column 2); GOLD_SKY4, weather shifted 4 km (heaps above, the sun's glow clear)
      uCloudLight: [10, 0.8], uCloudAmbient: 2.2, uCloudBright: 8, uCloudSunTint: [1, 0.58, 0.32], uCloudHaze: 0.35, uCloudOffset: [1, 4], uCloudFar: [7000, 20000] }, // offset [1, 4]: clear sky around the disk
    grade: { ...SUN_LENS, ...GOLD_GRADE, uLensGlare: 0.6 /* r4: 0.45 → 0.6, the disk in the open sky glows like ref 5 */, uSaturation: 0.76, uVibrance: 0.04, uWhiteBalance: [1.02, 1, 0.96] /* r6: sat 55 → 53 (ref 51) keeping yb ≈ 37 (ref 39); r5: 0.86, sat 56 → ref 51 */, ...LV(9, 30, 102, 202, 241), uShoulder: [0.84, 1.0] /* r3: p98 222 → 239 (ref 241) */ }, atmo: { ...GOLD_ATMO, uMie: [0.76, 0.15, 0.3] }, clouds: { uBankAmount: 1.0, uBankAlt: [-150, 0.9] }, terrain: GOLD_TERRAIN, water: GOLD_WATER },

  // ---------------------------------------------------------------- sunken (refs 6-9) — r2 look-sunken. The medium
  // defaults live in core/underwater.js (UW: visibility, colour with depth, rays, caustics); `uw:` = per-shot overrides.
  // The underwater light is the REFRACTED sun: a lower sun in air (20-30°) gives the refs' slanted shafts fanning from
  // a corner (refs 6, 9); a high one near-vertical shafts converging overhead (refs 7, 8). uUwAmbTint lifts the shaded
  // faces (the refs keep stone bright and readable on the side away from the sun).
  // secondaries for the water: AgX pushes bright blue water toward cyan — cyan band toward blue, a touch richer
  // (refs' water ≈ rgb 13-23 / 99-133 / 145-184)
  // 6 — sunken temple: shafts from the top-left corner, warm sand / stone in the foreground
  // r3: clearer near range + steeper far term (temple ≈ 70 m reads grey-white stone like ref 6, not navy), warm sun,
  //     softer / blurrier caustics on the plaza (ref 6's sand is warm cream, not a high-contrast net)
  // r4: red absorbed faster with range + bluer in-scatter (ref 6 far left / top right saturated blue, the r4 precinct skyline in blue)
  6: { sun: sunRel(6, -52, 30, { color: [1.0, 0.88, 0.7] }), uw: { uUwAmbTint: [2.2, 2.25, 2.3], uUwSunSurf: 1.6,
      uUwSigma: [0.009, 0.0026, 0.0022], uUwFar: [200, 0, 0, 0], uUwAmbColor: [0.0, 0.3, 1.0], // r6: far range 100 → 200 m (the far city of sets/backdrop6.js reads as blue towers at 170-230 m), red absorbed faster (stays blue)
      uUwCaustic: [0.85, 0.2, 140, 0.03] },
    grade: { ...UW_HUE, uWhiteBalance: [1.14, 1, 0.88], ...LV(23, 45, 94, 171, 219) } },
  // 7 — sunken gate bridge from the canal floor: high sun from the left (bridge face lit, shafts fanning from above);
  //     the bridge front is ≈ 119 m away (r2 camera) → clearer water than the default (ref 7: towers crisp, temple beyond)
  //     r3 (camera 110 m deep): the canal floor was the brightest thing in frame (auto levels then crushed the water);
  //     less direct sun on the sand + brighter cyan in-scatter → luminous water / ceiling, the bridge reads (ref 7)
  // r4: much clearer blue-green path (ref 7: the bridge crisp, white / red towers, the far canal reads through the arch)
  // r5: the sun moved IN FRONT, high (behind the bridge, slightly right): the shafts fan from the top centre-right toward
  //     the camera like ref 7 (deeper-reaching beams: the camera is 110 m down; stronger beams veil the bridge), the brightest ceiling top centre-right;
  //     the bridge front reads white from a stronger (bluer) ambient instead of the side sun. |dL| 8.3 → 7.1 (preview)
  // r6: clearer + bluer (ref 7 ≈ s 50-65 water, crisp bridge): less green/blue extinction (veil 120 m), stronger ambient on the
  //     bridge face (red courses read), no red in the in-scatter, neutral white balance
  7: { sun: sunRel(7, 20, 68), uw: { uUwAmbTint: [2.3, 2.5, 2.7], uUwSigma: [0.006, 0.001, 0.0008], uUwFar: [1800, 0, 0, 0],
      uUwSunSurf: 0.35, uUwAmbColor: [0.005, 0.48, 1.2], uUwSunScatter: [0.0, 0.1, 0.17], uUwCaustic: [1.0, 0.2, 140, 0.02],
      uUwShaft: [4.0, 12, 240, 4.5], uUwShaft2: [1.4, 2.0, 0.35, 0], uUwKdScat: [0.03, 0.014, 0.011] },
    grade: { ...UW_HUE, uWhiteBalance: [1.02, 1, 0.98], ...LV(5, 25, 77, 157, 211) } },
  // 8 — fallen head of Poseidon: face lit from the front-left, shafts from above
  // r4: bluer, more saturated water (ref 8 top ≈ rgb 57,142,179), red absorbed faster with range
  // r5: longer far range (uUwFar 150 → 260): the far city on the citadel shore (sets/backdrop8.js farCity8, 110-200 m)
  //     reads as blue silhouettes above the l1 curtain wall like ref 8's hill city
  8: { sun: sunRel(8, -34, 50), uw: { uUwAmbTint: [1.8, 1.85, 1.9], uUwSunScatter: [0.007, 0.06, 0.11], uUwSigma: [0.012, 0.0042, 0.0032], uUwAmbColor: [0.0, 0.36, 1.1], uUwFar: [420, 0, 0, 0] }, // r6: clearer far range (the far city towers / domed temple read like ref 8)
    grade: { ...UW_HUE, uWhiteBalance: [1.06, 1, 0.95], ...LV(17, 38, 88, 179, 223) } },
  // 9 — split level at dusk: sun ON the horizon at the left (ref px 302,158), orange-red near the sun, pink-mauve
  //     clouds, calm sea; the light used below the surface comes from the same side, higher, for the slanted shafts.
  9: { sun: sunRel(9, -120, 34, { color: [1.0, 0.78, 0.56] }), // r3: lights the water half only (uw.uUwLightMode 1); the visible disk = diskRel
    sky: { ...GOLD_SKY, ...diskRel(9, 302, 2.5), uZenith: [0.09, 0.08, 0.18], uSkyFalloff: 2.6, uSkyZenithTint: [1, 1, 1],
      uSkyGlow: [2.6, 0.55, 0.1, 1.0], uSkyGlowW: [70, 25], uSkySunTint: [1, 0.35, 0.08], uSkyHorizonTint: [3.3, 1.6, 1.33], uSkyAureole: [0.3, 0.5, 1.5],
      uCloudSunTint: [1.0, 0.38, 0.12], uCloudAmbBotCol: [1.0, 0.42, 0.38], uCloudAmbTopCol: [1.0, 0.55, 0.55], uCloudGlowAmb: 2.0,
      uCloudAmbient: 5.5, uCloudBright: 12, uCloudSigma: 0.1, uCloudEdge: 1.0, uCloudErode: 1.0, uCloudFrag: [0.32, 0.2], uCloudLight: [3, 1.0],
      uCloudHaze: 0.15, uCloudMaxDist: 80000, uCloudFar: [10000, 60000], uCloudFarMin: 0.5, uCloudScale: 2.6,
      uCloudBase: 2200, uCloudThick: 700, uCloudCover: 0.4, uCirrus: [0.05, 7500, 0.4] },
    // r6: opaque, orange-lit cumulus masses (GOLD_SKY4-style extinction + uCloudFrag: the r5 thin veils read as white blotches over
    //     an ochre sky), saturated orange glow (ref ≈ rgb 250,160,70), pink-mauve horizon away from the sun; clouds reach the
    //     horizon (max dist 80 km: the r5 50 km cut left a flat orange band under the cloud deck at the left)
    // r3: richer orange sky / clouds (ref top-left ≈ rgb 211,147,94), the backlit mountains get sky fill + haze
    // r4: underwater half azure instead of teal-grey (ref ≈ rgb 53,122,151): cyan band pushed toward blue, more chroma
    grade: { ...SUN_LENS, ...UW_HUE, uHueShift: [0, 3, -3, -3, 0, 30, 6, -8], uHueSat: [1.2, 1.35, 1.2, 0.9, 0.92, 1.45, 1.3, 0.8], uVibrance: 0.2, ...LV(12, 35, 93, 168, 202) },
    atmo: { uMie: [0.76, 1.1, 0.8], uHazeColor: [2.0, 1.1, 1.2], uHaze: [0.00003, 1600, 0] }, clouds: { uBankAmount: 0.4 }, // r5: the backlit range is lit mostly by the pink sunset haze (ref 9 ≈ rgb 150-170 / 113 / 115; r4 46-80 grey)
    envIntensity: 3.0, terrain: { uTBounce: 10, uFarTint: [1.25, 0.85, 0.8], uSnowLine: 9000, uFarRock: [0.6, 1, 1, 1] } /* r4: warmer, brighter backlit range (ref 9 pink-tan rock); r5: 14 / [1.7, 1.3, 1.2] → 24 / [2.2, 1.6, 1.45] + terrain sun = the shot light (core/underwater.js); r6: the peaks read snow-white → bounce 10, tint 1.25, no snow, haze 7 → 2 (horizon tint compensates): dark mauve rock like ref 9 */, water: { uGlitterTint: [1.0, 0.42, 0.12] }, // r6: saturated orange glitter
    // water half (r2 look-sunken): the refracted light comes from the visible sun ON the horizon (grazing, Fresnel ≈ 0.2)
    // → direct sun / shafts compensated; much clearer water (ref 9: the temple crisp at ≈ 130 m, rings beyond)
    // r3: the water light is DECOUPLED from the disk (uUwLightMode 1 → the scene sun below, from behind-left, 34°): the
    //     temple front is lit and the shafts slant down-right like ref 9; cyan downwelling light (per-channel Kd), much
    //     clearer water (the plateau, ledge palaces and rings show beyond the temple), stronger sun in-scatter on the left
    // r4: red absorbed faster, bluer in-scatter, weaker sun in-scatter (ref 9 right half deep blue under the meniscus)
    uw: { uUwLightMode: 1, uUwSigma: [0.012, 0.0022, 0.001], uUwFar: [2500, 0, 0, 0], uUwSunSurf: 1.6, uUwAmbTint: [1.6, 1.7, 1.9], // r6: clearer (ruins / rings beyond the temple), brighter lit facade
      uUwAmbColor: [0.0, 0.55, 2.6], uUwSunScatter: [0.03, 0.2, 0.38], uUwKdSun: [0.02, 0.006, 0.0045], uUwKd: [0.02, 0.006, 0.0045],
      uUwCaustic: [0.55, 0.2, 140, 0.03] },
    // r4 (sunken): the open plateau paving read as a tiled pool (ref 9: drifted sand, growth, rubble) → sand drifts over the
    //     open paving too (core/sunken.js overlay, per-shot via underwater.js)
    //     + more (darker) algae turf and a greyer dust: the plateau reads as reef floor, not a bright beach
    // r6: darker, thinner dust + more turf, softer caustics: the plateau reads as reef floor around the ruins (|dL| 11.2 → 9.4)
    sk: { uSkSand: [0.35, 0.5, 0.9, 0.3], uSkDrift2: [0.8, 1.9, 0.5, 0], uSkAlgae: [1.0, 0.45, 0.22, 0.55], uSkSandColor: [0.45, 0.44, 0.4] } },
};
