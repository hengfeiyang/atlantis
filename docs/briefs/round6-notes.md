# Round 6 notes (collected from round-5 reports)

## ships (done r5)
- shot-2 regression: the clearance rule skipped shot 2 (`s.id !== 2`); now every golden still + 25 samples along each golden segment path (cameraAt) are tested, space-time for sailing ships; sheds 14 m bow-tip rule + 8 m path check. Nothing within 57 m of the shot-2 camera.
- motion: 58 sailing ships + hero move along heading with engine time during their segment window, exactly at their placed position at the reference framing (stills = video); hero 2.5 m/s toward camera (±9 m), wake 3.2 → 4.2. API registry.ships.hero.{offsetAt, bowAt, speed, fwd}, registry.ships.sailDisp(t, speed).
- gaps: bowSpray.js static (water told to follow offsetAt); ref 5 shows two sailing triremes, ours one reads; rng shift changed shot-1 fleet details slightly.
- temple `buildStairChannel` error seen (citadel's, in progress).

## sunken (done r5)
- DETERMINISM fixed: engine.frameNo / subFrame = (frameNo*64+i)%4096 / sampleSerial (never reset); renderStill resets frameNo; player sets frameNo = si*1000+frame; UW.uUwFrame + SKY.uFrame read subFrame; clouds depth check uses sampleSerial. Shots 6-9 twice in a row: max diff 0.
- sunken.js overlay skips zero-weight steps (bit-identical, 5-12 % faster); shot 7 sun high in front of the bridge (sunRel 20/68), bridge reads white, |dL| 10.0→9.1; tower-cornice/plinth slots get fuller coral; shot 8 farCity8 in backdrop8.js (110-190 m: terraces, houses, gilt-dome towers, domed temple, aqueduct) + uUwFar 260 (terraces read as flat walls); shot 9 mountains: sunken terrain follows the shot's light (now ≈ rgb 156,129,132 vs ref 170,114,111).
- seen (not sunken's): water failed to load briefly (stairChannel.js export); temple `buildStairChannel is not defined` — citadel/water in progress, check at integration; shot 9 sky clouds blotchy (look-golden speckle bug).

## citadel (done r5)
- stair water channel: raised trough on the axis, turquoise-tiled pools at each of 6 landings, stepped chutes on flights, shell fountain source, trough across the quay pouring into w1 at z 230.85 (stairChannelPlan() / registry.temple.stairChannel, 6 m); water renders it. Walkway 25 m (deeper planted beds; inner dividers gone → no dark stripes in shot 5). Stair head low (B1), towers flanking the stair removed, tier-1 parapet 0.4 m curb at bearings 151-171 / 189-209; shot 4 only low planting on tier-2 terrace 118-178. temple 5.39 M tris.
- gaps: shot 5 plateau rim hides temple below y≈73, stair head hides its right quarter; shot 4 temple ridge below the rim from the 2.5 m eye.
- forwarded: arch-a (mole bridge head hides hill px 290-980 in shot 4; w1-180 bridge citadel tower covers stair foot in shot 1); director (higher shot-4 eye).

## arch-a (done r5; resumed with citadel's shot-4/shot-1 requests)
- mole cypresses behind the land-side wall (18-25 m, fixed hash, slots.tree cypress source rings-mole) — from the shot-4 eye only 1-2 spires clear the coping (pylons overlap); 3 more at the mole head (air only). Vegetation: keep slot sizes.
- mole.js dead code removed, west.shedBack = 22 explicit (layout shedBack 32 unused).
- shot 8 (sunken): mole curtain end bays collapse; sunken l1/l2 land sides = ruined blind arcade (coral tag rings-arcade); broken towers keep niche/pilasters/red band. Shot 7 sunken gate towers: dark arched windows, tall opening with hood + sill (coral tag tower-sill), deeper relief (still faint through 130 m).
- motion: flicker map clean; shot 1 l2 wall shimmer sub-pixel at 640 px.
- seen: sunken `set8-farcity` blocks sit on the sunken mole head at ≈ (125, 27, 214) → sunken r6; water broken sky-reflection patch near the mole tunnel (aerial) → water told.

## vegetation (done r5)
- LOD/culling fixed per video segment: applyShot samples 26 cameras from cameraAt → VegSystem.setPath(cams) (finest LOD needed anywhere on the path; drawn if any path camera sees it/its shadow); LOD changes along segments 6652/1892/248/660/1663 → 0; ~120 ms per shot change; tris 3.3-6.8 M per shot (shot 1 6.8 M due to the 520 m push). `vegNoPath=1` disables.
- path clearance ≥ 2.5 m + crown radius from low golden camera paths. Citadel slopes greener (1910 → 2090 plants). slots.tree size = variant height; rings-mole cypress ×1.35 (cap 32 m) — in shot 4 mostly above the frame or behind pylons.
- director: shot-5 u=0 hero palm trunk fills ~150 px of the right edge (told).
- arch-a addendum: shot-4 mole-bridge towers lowered/narrowed (hill shows 50-60 px more; lower hill still hidden by the 15.5 m deck — layout change = director); shot-1 w1-180 citadel-end tower → low pavilion (deck + 4.2) with gold statue slot `bridges-ring-low` (both eras), stair channel reads to the deck (stair foot still hidden by the 28 m deck). Side effect: that pavilion is at the right edge of shot 5 — director check.

## water (done r5)
- shot-1 cyan rectangle = canal shelter box running past the mole tips → rounds off past the lighthouses (z 930), water colour no longer uses it; open sea navy-teal ≈ 5,46,79 vs ref 7,46,77; cyan band at the l2 wall foot gone; fewer whitecaps; long thin ship trails. Reflection lookups clamp to the mirror image edge (arch-a's patch). Shot 4: sun sheen reduced, sheds/bridge mirror as vertical streaks. Shot 9: cooler mirrored horizon on open sea, lighter slate body, narrower brighter sun path. NEW src/water/stairChannel.js (6 froth chutes, landing basins, traced pour into w1). Shot 2 bigger bow wave, bow spray follows registry.ships.hero.bowAt(t).
- gaps: shot 9 sun path desaturated (≈190,155,120 vs ref 252,190,116), waves too long/smooth, sea right of the sun too dark.
- requests: sunken (owns looks 9) → more saturated uGlitterTint for shot 9 + the flat orange horizon band in the shot-9 sky.

## director (done r5)
- sequence.js new move fields: `track` (holds a world point at its ref screen position), `swoop` (crane-down that levels off), `along` (ride another shot's path). Shot 1: 520 m fly-in ~constant altitude over fleet, lighthouses, l2 gate, temple tracked. Shot 4: 14 m horizontal push + slight pan. Shot 5: range [0,1], opens on the ref framing (palm off the edge). Shots 3+6: one path, descends into the ref-3 framing at mid-segment; shot 6 reaches its still at mid-segment; 3→6 dissolve pixel-aligned. 55.4 s.
- shot 6 still → pos [11.05,78.34,95.46] fov 47 (rms 29→27). No layout changes (B1-B3 in COMPOSITION.md); shot 4 cannot see the temple over the plateau rim from the water.
- preview out/video_preview/atlantis_640x360.mp4 (2 spp); r4 kept as atlantis_r4_640x360.mp4.
- in motion: shot-1 fleet wakes long straight white contrail-like streaks (ships/water); shot 4 treadmill (repeating shed bays → arch-a variety); shot 7 kelp at the left edge late in the segment (sunken path clearance); shot-1 sun disk ring outline (look-golden, told).
- everyone sampling cameraAt: re-sample against the new paths (ships, vegetation do it at build/applyShot dynamically — verify).

## terrain (done r5)
- perf (4K ms/sample total, terrain shader): shot 1 164→116.5 (83→36); 9 228→186.5 (63→21.5); 6 164→148.5 (31.5→16); 4 77→71.5; 5 78→74. Layers evaluated only where weight/fade > 0, near/far mutually skipped, rock only where rock shows, snow upper bound, far shadow march stops above the far-grid max. Pixel diffs ±1-3 levels (shot 1: 37 isolated px max 29).
- far range look: the 0.62 scale had pushed the wall below the tree line (all forest) → tree line/meadows/scree on unscaled altitude + slope; rock pale neutral limestone, softer facets, uFarTint less yellow, cool sky fill; new uniforms uFarSky, uFarRock, uMtnK. SBS out/terrain/r5/sbs_*_L6.png.
- requests: look-golden → far haze cooler/lighter at 8-15 km (shadows ≈ 78,65,61 vs ref 50,61,75), tone peaks (uFarRock.x / uFarTint) — told; SUNKEN r6 → shot 9 peaks almost snow-white, uFarTint 2.2 → ~1.5.

## look-golden (done r5)
- determinism: SKY.uFrame = engine.subFrame; clouds depth check vs engine.sampleSerial; shots 1-5 twice → byte-identical; video frame twice identical.
- SKY.uCloudFrag [0.32, 0.2] in GOLD_SKY4 (speckles 2-4); sun disk 1600 → 400; pipeline sharpen luminance-only + chroma fringe limited near very bright px (ALL shots incl. sunken, small); shot 1 lens glare off; shot 4 yb 34→28 (ref 25); shot 1 yb 23→17 (ref 14); GOLD_TERRAIN darker warmer far rock; terrain r5 keys reset between shots. Percentiles within ~2 levels.
- requests: water → shot-1 glitter is a white column + sea near the sun grey (ref warm); shot-2 canal navy (ref turquoise).
