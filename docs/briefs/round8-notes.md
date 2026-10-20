# Round 7 reports (final polish)

## citadel (done r7)
- colossus hidden in shot 3 only (director, statues.js); verified absent across the shot-3 segment (u 0-1).
- shot 3 colourfulness 57.4 → 59.9 (ref 63.8): new src/materials/tone.js shared tone settings read by stone.js / metal.js / statueMetal.js; SHOT_TONE table in temple.js (golden, shot 3 only; `tone:{}` shot override); red-green 25.0 → 29.4 (ref 29.0). No geometry/cost change; constant per segment.
- remaining shortfall: left third (sun-glitter sea + city) and bottom-left balustrade (water / look-golden).

## sunken (done r7)
- shot 9 p02 30 → 18 (ref 12): uExposure 0.35, sat 0.8, vibrance 0.1; uUwMenBand navy band under the waterline; far mountains lit at 8° (look key terrainSunEl) → dark mauve. Shot 7 exposure 0.55, sat 0.85 (p02 13 → 8, ref 5); right-hand kelp pushed out (right edge still across u 0-1). Shot 6 far-city towers (230-306 m) cut far haze to 0.35× + darker blue-grey → blue silhouettes with gold crowns. Shot 9 far city not done (needs geometry). Determinism md5-checked.
- stats |dL|/|dSat|: 6 10.0/10.8; 7 8.2/7.8; 8 9.6/8.4; 9 9.1/6.1.

## water (done r7)
- shot 3: far sea grey was the haze → haze warm toward the sun on sea pixels only + warmer reflected low sky + glitter brightness cap (gold, no white specks); off-path ≈ 219,172,119 (ref 224,159,112); colourfulness 56 → ~60 (ref 64). Shot 4: bluer turquoise + gold tint on reflected buildings only; colourfulness 56 → 60-61 (ref 62). Shot 9: fine chop, steel-mauve (≈ 96,85,91 vs ref 97,103,121), orange glitter column; no clear crest shapes. All new controls default off.
- session-only page error "Cannot access 'ATMO_GLSL' before initialization" on snap --reload (not in fresh renders) — module init order; verify the final render's fresh page loads stay clean.

## look-golden (done r7)
- final grade 1-5 in looks.js only: shot 3 warms → orange-red, bluer sky, cooler WB, far haze 0.28 → 0.05, Mie 0.15 → 0.05 (island slate silhouette); shot 4 sat 0.82 richer turquoise; shot 5 warms → red, sat 0.68; shots 1/2 saturation trims.
- stats (ours/ref): colourfulness 1 59.4/59.8, 2 66.3/66.9, 3 63.4/63.8, 4 62.3/62.4, 5 62.8/64.5; percentiles within 3 levels. 4K 24-spp stills clean, 3-4 s each.
- open: hard-edged mist puffs over the shot-4 bridge (discs) → water resumed to fix.
