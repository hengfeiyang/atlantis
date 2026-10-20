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
};
const GOLD_GRADE = {
  uToneMap: 2, uWhiteBalance: [1, 1, 1], uSaturation: 0.92, uVibrance: 0.08, uHuePreserve: 0.6,
  uHueSat: [0.95, 1.05, 1.0, 0.85, 0.92, 0.95, 0.9, 0.75],
};
const GOLD_SUN = [1.0, 0.82, 0.62];              // warm golden light (stone glows cream-gold)
const GOLD_WATER = { uGlitterTint: [1.0, 0.66, 0.34] }; // r2: the glitter path under the low sun is gold (refs 1-3, 5), not white
const SUN_LENS = { uLensGlare: 0.7, uLensRays: 0.14, uLensGhost: 0.0 };
// (r1 GOLD_WB [1.05, 1, 0.92] warm white balance removed in r2: see GOLD_GRADE)
const UW_HUE = { uHueShift: [0, 3, -3, -3, 0, 14, 4, -8], uHueSat: [0.9, 1.0, 1.0, 0.85, 0.92, 1.15, 1.05, 0.75] }; // sunken (look-sunken)
const GOLD_ATMO = { uMie: [0.76, 0.3, 0.8], uHazeColor: [0.66, 0.74, 0.98] }; // r2: bluer (was 0.8, 0.78, 0.98: mauve mid-sky + lavender-brown aerial perspective) // stronger Mie glow toward the (visible) sun, lavender haze away from it

export const LOOKS = {
  // 1 — grand aerial from the south: sun low at the top-left over the sea (ref px 118,75), city side-lit from the
  //     left-front; cloud banks across the middle of the mountain flanks; cumulus heaped above the range.
  1: { sun: sunRel(1, -115, 14, { color: GOLD_SUN }), sky: { ...GOLD_SKY2, ...diskRel(1, 118, 1.8),
      uSkyGlowW: [28, 10], uSkyGlow: [2.3, 1.2, 0.5, 1.0], uSkyAureole: [0.7, 1.2, 6.0],
      uEnvBlue: 0.4, uEnvSat: 0.85 }, envIntensity: 2.5, // r2: sky fill lifts the far city's shadows (bright cream city, blue-violet shade, ref 1) // r2: yellow-white around the sun → peach → lavender (was a flat orange band)
    grade: { ...SUN_LENS, ...GOLD_GRADE, uLensGlare: 0.35, uLensRays: 0.08, uSaturation: 1.04, uVibrance: 0.15, uLtmBase: 0.45, uLtmLarge: 0.12, uShadowTint: [0.0, 0.004, 0.016], ...LV(21, 33, 96, 197, 236) }, atmo: { ...GOLD_ATMO, uMie: [0.8, 0.8, 0.8], uHazeColor: [0.95, 0.88, 0.9] }, // r2: warm Mie haze toward the sun (ref 1 left half)
    clouds: { uBankAmount: 1.4, uBankAlt: [-350, 1.2], uBankErode: 0.6, uBankBright: 5.0 }, water: { uSunSpec: [0.7, 0], uGlitterTint: [1.0, 0.6, 0.28] } }, // r2: gold glitter path (ref ≈ rgb 250,197,121), not a white blob
  // 2 — water level in the sea canal: sun left of the bridge tower (ref px 235,240), big gold clouds top-left,
  //     blue-violet sky top-right.
  2: { sun: sunRel(2, -95, 15, { color: GOLD_SUN }), sky: { ...GOLD_SKY2, ...diskRel(2, 235, 14), uCloudCover: 0.5,
      uSkyGlowW: [52, 14], uZenith: [0.06, 0.135, 0.29], uCloudSunTint: [1.0, 0.66, 0.4], uCloudGlowAmb: 1.4 }, // r2: gold-peach left half, muted blue right (ref top ≈ 93,114,143)
    grade: { ...SUN_LENS, ...GOLD_GRADE, ...LV(18, 46, 109, 203, 242),
      uHueShift: [0, 3, -3, -3, 0, 0, -8, -8], uHueSat: [0.95, 1.05, 1.0, 0.85, 0.92, 1.12, 0.95, 0.75] }, // r2: canal water toward turquoise
    atmo: GOLD_ATMO, clouds: { uBankAmount: 0.6 }, water: GOLD_WATER },
  // 3 — temple from the citadel stair: sun low over the sea at the left (ref px 165,272), temple front lit from
  //     the left, orange left half of the sky, deep blue top-right.
  3: { sun: sunRel(3, -100, 17, { color: GOLD_SUN }), sky: { ...GOLD_SKY2, ...diskRel(3, 165, 2.0) },
    grade: { ...SUN_LENS, ...GOLD_GRADE, ...LV(14, 41, 112, 197, 229) }, atmo: GOLD_ATMO, clouds: { uBankAmount: 0.8 }, water: GOLD_WATER },
  // 4 — inner ring, ship-sheds: sun behind the citadel hill at the left (ref px 110,215), right wall lit,
  //     banks in the mountain valley right of centre.
  4: { sun: sunRel(4, -80, 14, { color: GOLD_SUN }), sky: { ...GOLD_SKY2, ...diskRel(4, 110, 16) },
    grade: { ...SUN_LENS, ...GOLD_GRADE, uSaturation: 0.82, uVibrance: 0.04, ...LV(18, 47, 111, 189, 232),
      uHueShift: [0, 3, -3, -3, 0, 0, -6, -8], uHueSat: [0.95, 1.05, 1.0, 0.85, 0.92, 0.85, 0.85, 0.75], uHueLum: [0, 0, -0.02, -0.06, -0.08, -0.05, -0.04, 0] }, // r2: ring water ref ≈ rgb 46,105,126 (teal, deeper)
    atmo: GOLD_ATMO, clouds: { uBankAmount: 1.1 }, water: GOLD_WATER },
  // 5 — garden terrace toward the citadel: sun over the sea left of the citadel (ref px 365,185), cumulus rows,
  //     low banks at the mountain foot to the right.
  5: { sun: sunRel(5, -95, 16, { color: GOLD_SUN }), sky: { ...GOLD_SKY2, ...diskRel(5, 365, 10), uSkyGlowW: [30, 9] },
    grade: { ...SUN_LENS, ...GOLD_GRADE, uLensGlare: 0.45, ...LV(9, 30, 102, 202, 241) }, atmo: { ...GOLD_ATMO, uMie: [0.76, 0.15, 0.3] }, clouds: { uBankAmount: 1.0, uBankAlt: [-150, 0.9] }, water: GOLD_WATER },

  // ---------------------------------------------------------------- sunken (refs 6-9) — r2 look-sunken. The medium
  // defaults live in core/underwater.js (UW: visibility, colour with depth, rays, caustics); `uw:` = per-shot overrides.
  // The underwater light is the REFRACTED sun: a lower sun in air (20-30°) gives the refs' slanted shafts fanning from
  // a corner (refs 6, 9); a high one near-vertical shafts converging overhead (refs 7, 8). uUwAmbTint lifts the shaded
  // faces (the refs keep stone bright and readable on the side away from the sun).
  // secondaries for the water: AgX pushes bright blue water toward cyan — cyan band toward blue, a touch richer
  // (refs' water ≈ rgb 13-23 / 99-133 / 145-184)
  // 6 — sunken temple: shafts from the top-left corner, warm sand / stone in the foreground
  6: { sun: sunRel(6, -52, 30), uw: { uUwAmbTint: [2.2, 2.25, 2.3], uUwSunSurf: 1.6 },
    grade: { ...UW_HUE, uWhiteBalance: [1.1, 1, 0.92], ...LV(23, 45, 94, 171, 219) } },
  // 7 — sunken gate bridge from the canal floor: high sun from the left (bridge face lit, shafts fanning from above);
  //     the bridge front is ≈ 119 m away (r2 camera) → clearer water than the default (ref 7: towers crisp, temple beyond)
  7: { sun: sunRel(7, -78, 72), uw: { uUwAmbTint: [2.2, 2.3, 2.4], uUwSigma: [0.007, 0.0026, 0.002], uUwFar: [300, 0, 0, 0] },
    grade: { ...UW_HUE, uWhiteBalance: [1.06, 1, 0.95], ...LV(5, 25, 77, 157, 211) } },
  // 8 — fallen head of Poseidon: face lit from the front-left, shafts from above
  8: { sun: sunRel(8, -34, 50), uw: { uUwAmbTint: [1.8, 1.85, 1.9], uUwSunScatter: [0.007, 0.052, 0.095] },
    grade: { ...UW_HUE, uWhiteBalance: [1.06, 1, 0.95], ...LV(17, 38, 88, 179, 223) } },
  // 9 — split level at dusk: sun ON the horizon at the left (ref px 302,158), orange-red near the sun, pink-mauve
  //     clouds, calm sea; the light used below the surface comes from the same side, higher, for the slanted shafts.
  9: { sun: sunRel(9, -45, 24, { color: [1.0, 0.72, 0.48] }),
    sky: { ...GOLD_SKY, ...diskRel(9, 302, 2.5), uZenith: [0.09, 0.08, 0.18], uSkyFalloff: 2.6, uSkyZenithTint: [1, 1, 1],
      uSkyGlow: [2.8, 0.7, 0.16, 1.0], uSkyGlowW: [85, 20], uSkySunTint: [1, 0.35, 0.08], uSkyHorizonTint: [0.95, 0.55, 0.5],
      uCloudSunTint: [1.0, 0.45, 0.2], uCloudAmbBotCol: [0.95, 0.5, 0.55], uCloudAmbTopCol: [0.9, 0.55, 0.65], uCloudGlowAmb: 2.0,
      uCloudAmbient: 2.4, uCloudBright: 9.0,
      uCloudBase: 2200, uCloudThick: 700, uCloudCover: 0.5, uCirrus: [0.05, 7500, 0.4] },
    grade: { ...SUN_LENS, ...UW_HUE, ...LV(12, 35, 93, 168, 202) }, atmo: { uMie: [0.76, 1.1, 0.8], uHazeColor: [1.0, 0.72, 0.7] }, clouds: { uBankAmount: 0.4 },
    // water half (r2 look-sunken): the refracted light comes from the visible sun ON the horizon (grazing, Fresnel ≈ 0.2)
    // → direct sun / shafts compensated; much clearer water (ref 9: the temple crisp at ≈ 130 m, rings beyond)
    uw: { uUwSigma: [0.016, 0.0045, 0.003], uUwFar: [260, 0, 0, 0], uUwSunSurf: 4.5, uUwAmbTint: [1.8, 1.9, 2.1],
      uUwAmbColor: [0.004, 0.5, 1.5], uUwSunScatter: [0.02, 0.15, 0.26] } },
};
