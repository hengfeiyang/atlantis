// Per-shot LOOK overrides (lighting & grading), kept separate from camera framing (shots.js).
// Keys per shot id: sun {azimuth, elevation, color?, intensity?}, grade {...GRADE uniforms},
// atmo {...ATMO uniforms}, sky {...SKY uniforms}, clouds {...CLOUDS uniforms (modules/clouds.js)},
// envIntensity, terrain {...TERRAIN_UNIFORMS: uSnowLine, uTBounce, uRockTint, uGroundTint} (applied by modules/clouds.js).
// Merge order in engine.applyShot: defaults → LOOKS[id] → explicit overrides on the shot object.
//
// The sun is art-directed RELATIVE TO THE CAMERA HEADING (so it survives camera changes in shots.js):
//   sunRel(id, dAz, el): dAz < 0 = light from the left of frame (-90 pure side light, -180 from behind).
//   diskRel(id, dAz, el): where the visible sun disk / aureole / lens glare sits (refs 1, 3, 7 show the
//   sun in or near the top-left of the frame while the scene is side-lit from the left).
import { SHOTS } from './shots.js';
import { dirFromAzEl } from './layout.js';

function heading(id) {
  const s = SHOTS.find((x) => x.id === id);
  if (!s) return 0;
  const dx = s.target[0] - s.pos[0], dz = s.target[2] - s.pos[2];
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
}
const sunRel = (id, dAz, el, extra = {}) => ({ azimuth: (heading(id) + dAz + 720) % 360, elevation: el, ...extra });
const diskRel = (id, dAz, el) => ({ uSunDiskMode: 1, uSunDiskDir: dirFromAzEl((heading(id) + dAz + 720) % 360, el) });

// sun in / near the frame: broad warm aureole in the sky + stronger lens glare and god rays
const SUN_GLOW = { uSkyAureole: [0.9, 1.4, 6.0] };
const SUN_LENS = { uLensGlare: 0.7, uLensRays: 0.3, uLensGhost: 0.0 }; // r5: ghosts off (green CG dots, shot 7)
// r5b: shot 7 broad aureole 0.9 → 0.45 (a pale disc with a visible rim ~25° around the sun; ref 7 sky stays blue)
// r5b: shots 6/7: cirrus 0.3/0.25 → 0.08/0.06 (streaks around the sun / rays), more cumulus (ref 7)
// r5b: golden sun for the high-sun framings (elevation-derived tint at 28-35° is nearly white: lit stone read grey, refs 5/6/7/9 ≈ #dcc8b0)
const WARM_SUN = [1.0, 0.88, 0.72];
// r5b: stone / ochre band chroma up where the refs' lit stone is golden (refs 3, 9: orange C 0.039-0.042, ours 0.033-0.037)
// r5b: shots 5/6: the big lit marble areas still sat at OkLCh h 59-63 (peach) vs refs' cream 62-87 → ochre band further toward yellow
const CREAM_MARBLE = { uHueShift: [0, 7, -3, -3, 0, 0, 0, -8] };
const GOLD_STONE = { uHueSat: [0.9, 1.15, 1.0, 0.85, 0.92, 1.1, 0.9, 0.75], uHueShift: [0, -1, -3, -3, 0, 0, 0, -8] }; // golden-orange stone, refs 3/9 h 64-65
// r5: auto-levels targets = each reference's own sRGB luminance percentiles (p02, p50, p98)
const LV = (p02, p10, p50, p90, p98) => ({ uAutoLevels: 1.0, uLevelTarget: [p02, p10, p50, p90, p98] });

// r4: lighter haze on the snow range 8-15 km away (warm lit rock keeps its contrast, refs 3/8/9); the low
// layer (uHazeLow) still separates the mid-ground
const RANGE_ATMO = { uHaze: [0.000007, 1600, 0], uHazeFar: [0.2, 15000] };

// pale, luminous sky for the upward-looking framings (refs 5/6: ≈ #a2b6d1 … #80a0c9, not deep blue)
const PALE_SKY = { uZenith: [0.36, 0.58, 1.12], uSkyFalloff: 3.0, uCloudCover: 0.25, uCirrus: [0.2, 7500, 0.6] }; // r4: cirrus 0.8 → 0.2 (moiré streaks at telephoto)

// sun disk directions solved from the reference sun pixels with the shot cameras (r4 cameras:
// ref 1 (0.01, 0.25) → dAz -32 el 7.5, moved to (0.06, 0.17) → -29.7 / 10.8 so the hill town does not hide it; ref 3 (0.135, 0.138) → -22.6 / 8.4; ref 7 (0.087, 0.175) → -29.9 / 22.3, moved to (0.16, 0.16) → -23.7 / 25.9 clear of the tree).
// Cloud banks (modules/clouds.js CLOUDS): uBankAlt [base offset m, thickness ×] places the band where each
// reference shows it on the (physically inconsistent) mountain faces.
// r5: uWhiteBalance per shot re-measured after the new grade (global mean r-g / yb vs each reference)
// r5b: re-fitted (out/colour/wbfit.mjs) after the neutral-shadow change (bounce / shadow sat / shadow tint), with per-shot
// uSaturation toward each reference (shots 4/5 kept above the fit, 3/9 below the 1.2 cap: their gap is composition, not grade)
export const LOOKS = {
  // front-lit range (light from behind-left, low golden), visible sun at the left edge, hazy sea side
  1: { sun: sunRel(1, -125, 14), sky: { ...diskRel(1, -29.7, 10.8), ...SUN_GLOW, uCloudScale: 2.6, uCloudThick: 320, uCloudAmbient: 1.6, uCloudCover: 0.42, uCirrus: [0.6, 7500, 0.6] }, // r4: layered stratocumulus, sun above the hill town
    grade: { ...SUN_LENS, ...LV(17, 39, 108, 203, 235), uWhiteBalance: [0.943, 1, 1.112], uSaturation: 1.03 }, atmo: { uMie: [0.76, 1.1, 0.8], uHaze: [0.00002, 1600, 0] }, clouds: { uBankAlt: [-500, 1.2] } },
  2: { sun: sunRel(2, -90, 25), grade: { ...LV(10, 29, 93, 197, 233), uLift: [0.0, 0.002, 0.008], uContrast: 1.42, uExposure: 0.9, uWhiteBalance: [1.074, 1, 0.925], uSaturation: 0.96 } }, // deeper blacks (ref p02/p10 10/29)
  // r4: thin broken band just above the front peak, snow on the upper half only (refs 3/8/9)
  3: { sun: sunRel(3, -75, 24), sky: { ...diskRel(3, -22.6, 8.4), ...SUN_GLOW }, grade: { ...SUN_LENS, ...GOLD_STONE, ...LV(9, 31, 101, 197, 240), uWhiteBalance: [1.024, 1, 0.984], uSaturation: 1.12 },
    atmo: { ...RANGE_ATMO, uMie: [0.76, 0.3, 0.8] }, terrain: { uSnowLine: 2000 }, clouds: { uBankAlt: [-50, 0.55], uBankAmount: 1.1 } },
  // low white mist puffs drifting in the gorge below the viewer (ref 4)
  4: { sun: sunRel(4, -80, 30), grade: { ...LV(14, 33, 95, 198, 233), uLift: [0.012, 0.015, 0.024], uExposure: 0.92, uWhiteBalance: [1.18, 1, 0.89], uSaturation: 0.85 }, clouds: { uMistAmount: 0.9, uMistScale: [220, 45, 0.0, 1.2], uMistBright: 3.2, uMistLight: [0.8, 0.88, 1.0, 1.4] } }, // r5: 1.6 tried: a grey veil that hides the detail; ref 4 mist stays at the fall bases
  // r4: the raised banks (900 m) read as a grey streaky layer in the sky at telephoto → band wrapping the range
  // r5: side light from the left (ref 5: lit left flanks of the columns, deep colonnade shadows); pale sky via the
  // blue secondary (L up, chroma down), less saturation overall (ref 5 sat 24 %)
  5: { sun: sunRel(5, -110, 28, { color: WARM_SUN }), sky: { ...PALE_SKY, uCloudCover: 0.3, uCirrus: [0, 7500, 0.6] },
    grade: { ...CREAM_MARBLE, ...LV(16, 38, 115, 198, 228), uExposure: 0.46, uContrast: 1.8, uWhiteBalance: [1.026, 1, 1.025], uSaturation: 0.82,
      uHueLum: [0, 0, -0.02, -0.06, -0.08, 0, 0.08, 0], uHueSat: [0.9, 0.95, 1.0, 0.85, 0.92, 1.1, 0.6, 0.75] }, // r5b: orange 1.1 → 0.95 (peach temple); auto-exposure clamps on this bright frame
    terrain: { uSnowLine: 2000 }, clouds: { uBankAlt: [100, 0.8], uBankAmount: 1.4 } },
  6: { sun: sunRel(6, -100, 32, { color: WARM_SUN }), sky: { ...PALE_SKY, uZenith: [0.5, 0.68, 1.1], uCloudCover: 0.38, uCirrus: [0.08, 7500, 0.6] }, grade: { ...CREAM_MARBLE, ...LV(7, 30, 104, 197, 240), uExposure: 0.74, uContrast: 1.55, uWhiteBalance: [1.02, 1, 1.07], uSaturation: 1.06 } },
  7: { sun: sunRel(7, -85, 32, { color: WARM_SUN }), sky: { ...diskRel(7, -23.7, 25.9), ...SUN_GLOW, uSkyAureole: [0.45, 1.2, 6.0], uCloudCover: 0.45, uCirrus: [0.06, 7500, 0.6] }, grade: { ...SUN_LENS, uLensRays: 0.1, ...LV(9, 33, 104, 202, 238), uExposure: 0.72, uWhiteBalance: [1.005, 1, 0.9], uSaturation: 1.05 } },
  // r4: golden light from behind-left (ruins request -125..-135): with the new head, -140 / 40° lights the whole face
  // and the foreground rubble (-120 puts a shadow across the face, -80 shades the rubble)
  8: { sun: sunRel(8, -140, 40, { color: [1.0, 0.87, 0.70] }), grade: { ...LV(7, 37, 109, 201, 235), uExposure: 0.9, uWhiteBalance: [1.066, 1, 1.106], uSaturation: 1.08 }, atmo: { ...RANGE_ATMO }, terrain: { uSnowLine: 2000 }, clouds: { uBankAlt: [0, 0.5], uBankAmount: 1.2 } },
  // r4: from the left, slightly backlit: lit columns / floor patches, shadows toward the camera-right (ref 9)
  // r5b: -75/35 → -65/42: more of the ruin floor in sun (ref 9), shadows still toward camera-right
  9: { sun: sunRel(9, -65, 42, { color: WARM_SUN }), grade: { ...GOLD_STONE, ...LV(5, 23, 94, 197, 232), uExposure: 0.94, uContrast: 1.45, uWhiteBalance: [0.99, 1, 1.04], uSaturation: 1.12 },
    atmo: { ...RANGE_ATMO }, terrain: { uSnowLine: 2100 }, clouds: { uBankAlt: [0, 0.5], uBankAmount: 1.2, uMistAmount: 1.15 } },
};
