// Per-shot LOOK overrides (sun, grade, atmo, sky). Owner: look-dev (director); sun / sky / grade / clouds
// entries written by the sky agent (round 1) — keep the per-shot comments when editing.
//
// Keys per shot id: sun {azimuth, elevation, color?, intensity?}, sky {...SKY uniforms (core/sky.js)},
// grade {...GRADE uniforms (core/pipeline.js)}, atmo {...ATMO uniforms}, clouds {...CLOUDS uniforms
// (modules/clouds.js: mountain banks)}, envIntensity. Merge order in engine.applyShot: defaults → LOOKS[id] →
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
const GOLD_SUN = [1.0, 0.82, 0.62];              // warm golden light (stone glows cream-gold)
const SUN_LENS = { uLensGlare: 0.7, uLensRays: 0.14, uLensGhost: 0.0 };
const GOLD_WB = { uWhiteBalance: [1.05, 1, 0.92] }; // refs 1-5: warm overall (mean R-B ≈ +40..60)
const GOLD_ATMO = { uMie: [0.76, 0.3, 0.8], uHazeColor: [0.8, 0.78, 0.98] }; // stronger Mie glow toward the (visible) sun, lavender haze away from it

export const LOOKS = {
  // 1 — grand aerial from the south: sun low at the top-left over the sea (ref px 118,75), city side-lit from the
  //     left-front; cloud banks across the middle of the mountain flanks; cumulus heaped above the range.
  1: { sun: sunRel(1, -115, 14, { color: GOLD_SUN }), sky: { ...GOLD_SKY, ...diskRel(1, 118, 2.5) },
    grade: { ...SUN_LENS, ...GOLD_WB, ...LV(21, 33, 96, 197, 236) }, atmo: { ...GOLD_ATMO, uHazeColor: [1.0, 0.86, 0.82] }, clouds: { uBankAmount: 1.4, uBankAlt: [-350, 1.2], uBankErode: 0.6 } },
  // 2 — water level in the sea canal: sun left of the bridge tower (ref px 235,240), big gold clouds top-left,
  //     blue-violet sky top-right.
  2: { sun: sunRel(2, -95, 15, { color: GOLD_SUN }), sky: { ...GOLD_SKY, ...diskRel(2, 235, 3.5), uCloudCover: 0.5 },
    grade: { ...SUN_LENS, ...GOLD_WB, ...LV(18, 46, 109, 203, 242) }, atmo: GOLD_ATMO, clouds: { uBankAmount: 0.6 } },
  // 3 — temple from the citadel stair: sun low over the sea at the left (ref px 165,272), temple front lit from
  //     the left, orange left half of the sky, deep blue top-right.
  3: { sun: sunRel(3, -100, 17, { color: GOLD_SUN }), sky: { ...GOLD_SKY, ...diskRel(3, 165, 2.0) },
    grade: { ...SUN_LENS, ...GOLD_WB, ...LV(14, 41, 112, 197, 229) }, atmo: GOLD_ATMO, clouds: { uBankAmount: 0.8 } },
  // 4 — inner ring, ship-sheds: sun behind the citadel hill at the left (ref px 110,215), right wall lit,
  //     banks in the mountain valley right of centre.
  4: { sun: sunRel(4, -80, 14, { color: GOLD_SUN }), sky: { ...GOLD_SKY, ...diskRel(4, 110, 16) },
    grade: { ...SUN_LENS, ...GOLD_WB, ...LV(18, 47, 111, 189, 232) }, atmo: GOLD_ATMO, clouds: { uBankAmount: 1.1 } },
  // 5 — garden terrace toward the citadel: sun over the sea left of the citadel (ref px 365,185), cumulus rows,
  //     low banks at the mountain foot to the right.
  5: { sun: sunRel(5, -95, 16, { color: GOLD_SUN }), sky: { ...GOLD_SKY, ...diskRel(5, 365, 5) },
    grade: { ...SUN_LENS, ...GOLD_WB, ...LV(9, 30, 102, 202, 241) }, atmo: GOLD_ATMO, clouds: { uBankAmount: 1.0, uBankAlt: [-150, 0.9] } },

  // ---------------------------------------------------------------- sunken (refs 6-9) — first look; the underwater
  // core agent owns the medium / rays / caustics. High sun from the upper left for strong shafts.
  // 6 — sunken temple (same framing as 3)
  6: { sun: sunRel(6, -40, 62), grade: { ...LV(23, 45, 94, 171, 219) } },
  // 7 — sunken gate bridge from the canal floor
  7: { sun: sunRel(7, -30, 64), grade: { ...LV(5, 25, 77, 157, 211) } },
  // 8 — fallen head of Poseidon
  8: { sun: sunRel(8, -60, 58), grade: { ...LV(17, 38, 88, 179, 223) } },
  // 9 — split level at dusk: sun ON the horizon at the left (ref px 302,158), orange-red near the sun, pink-mauve
  //     clouds, calm sea; the light used below the surface comes from the same side, higher, for the slanted shafts.
  9: { sun: sunRel(9, -45, 24, { color: [1.0, 0.72, 0.48] }),
    sky: { ...GOLD_SKY, ...diskRel(9, 302, 2.5), uZenith: [0.09, 0.08, 0.18], uSkyFalloff: 2.6, uSkyZenithTint: [1, 1, 1],
      uSkyGlow: [2.8, 0.7, 0.16, 1.0], uSkyGlowW: [85, 20], uSkySunTint: [1, 0.35, 0.08], uSkyHorizonTint: [0.95, 0.55, 0.5],
      uCloudSunTint: [1.0, 0.45, 0.2], uCloudAmbBotCol: [0.95, 0.5, 0.55], uCloudAmbTopCol: [0.9, 0.55, 0.65], uCloudGlowAmb: 2.0,
      uCloudAmbient: 2.4, uCloudBright: 9.0,
      uCloudBase: 2200, uCloudThick: 700, uCloudCover: 0.5, uCirrus: [0.05, 7500, 0.4] },
    grade: { ...SUN_LENS, ...LV(12, 35, 93, 168, 202) }, atmo: { uMie: [0.76, 1.1, 0.8], uHazeColor: [1.0, 0.72, 0.7] }, clouds: { uBankAmount: 0.4 } },
};
