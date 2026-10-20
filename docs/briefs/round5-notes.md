# Round 5 notes (collected from round-4 reports)

## arch-a (done r4)
- shot 4 crag: leopard spots = r3 mid-scale bump → 0.03; grey-mauve rock, cracks, faceted blocks (cragScale 1.7, rockAmp 0.42). Pylons: panels, lapis strip (M.lapis) + gilt rosettes, crown band, urns; sunken shed-mole pylons = broken stumps. Sunken gate towers: niches w/ statues, corner statue slots, denser coral slots (tower-cornice/tower-plinth), lighter rose-red courses. Shot 1: rip-rap ink-black fixed (missing vertex colours), lighthouses ornamented, mole coping/statues, tower domes +20 %. Shot-4 mole bridge archivolts + medallions.
- gaps: shot 7 ~120 m deep in fog; shot-4 bridge face in shadow; sunken statues 30 % ruined (empty niches).
- forwarded: citadel (temple ~5 BufferGeometry NaN errors), sunken (use tower coral tags; shot 8 empty water behind → distant city).
- note: src/rings/mole.js:66 has `west.shedBack = …` inside a comment (dead code from r3) — owner to check.

## vegetation (done r4)
- far foliage (> 150 m) distance-faded fill light (aerial trees no longer black); far round-tree impostors patchy/ragged; palm impostors darker; mid clumps 6×4; land-ring gardens more broadleaf/pine/olive, trees 1.3× / cypress 1.2× above roofs; denser citadel slopes (thickets on 60-80° rock); shot 5 hero palm wider/more leaflets, brighter; shot 2 tall palms behind canal quays; NEW ivy.js curtains on slots.ivy (100 curtains, shed-rock crest shot 4). 2.0 s, 163k inst; 3.2-4.6 M tris per golden shot (r3 1.5-2.0).
- gaps: citadel slopes still rock-grey from the air; far greens too saturated/yellow vs ref 1 (look-golden).
- requests: arch-a → mole cypresses (~30 m) hidden behind the mole curtain wall in shot 4 (lower wall / say where visible); perf → +1.7 M tris per shot.
- NaN bounding-sphere errors appear right after the water build → water + citadel told.

## sunken (done r4)
- stats |dL|/|dSat| r3→r4: 6 14.1/10.9→11.8/9.1; 7 9.2/6.5→10.0/4.9 (dL worse, needs a look pass); 8 11.2/8.3→8.7/7.8; 9 15.0/13.8→10.0/10.2.
- NEW src/sets/precinct.js: ruined arcade around the plateau rim (r 103), 58 bays, 12 white/red towers with gilded tholoi, stumps/rubble (skips built areas, south open) — 1.2 M tris; camera-ray coral dressing per shot (shot 9 plateau ~3900 slots); kelp out of shot-7 arch view; turtle no banking; looks.js `sk:` per-shot sunken overlay overrides (shot 9 drifts/algae kill the pool look); looks 6-9 bluer/saturated, shot 7 clearer (temple silhouette through the arch); backdrop8 towers onto land ring 1, slender with domes.
- gaps: shot-8 background = plain ruined ring wall 44 m away (arch-a, sunken ornament); shot-9 mountains darker than ref.
- requests: perf (127-148 M tris at high; marine at 15 M cap); arch-a → sunken ornament on shot-7 gate towers + shot-8 ring wall.
- coordinator error: a message meant for sunken (tower coral tags / shot-8 far city) went to perf by mistake → carry to r5 sunken.

## citadel (done r4)
- NaN fixed (outlet code read spec.sill, water names it y). Outlet arches in greatRampart() from spec.outlet (registry.temple.outlets). Grand stair honey travertine, 4 planted dividers (5 lanes), taller cypress. Palace gilt pinnacles + trident. Props audit items fixed. Plateau paving pattern 5 (concentric courses; shot 9 not a pool). City parks 43 % l1 / 30 % l2 (kind 'park'), 178 gold-domed kiosks, 164 basins, more tile roofs, warmer plaster; houses 3708→2797 (2.07 M tris). temple 5.36 M tris.
- gaps: shot 1 stair + stair-head landing (y 75) = tan column hiding the temple's lower half (told director); shot 4 hill hidden from water level.
- request: water → central water channel down the grand stair (ref 1).

## perf (done r4)
- 4K spp-8 video ≈ 1.2 h (was 1.8 h), 1890 frames / 56.6 s, measured with other agents sharing the GPU.
- bottleneck = fragment shading, not tris (100-138 M shadow tris cost only 10-28 ms/sample). Wins: terrain renderOrder = 1 (drawn after opaque → hidden terrain pixels skipped; pixel-identical except 0.03 % tie pixels in shot 1); stFbm skips zero-weight octaves (bit-identical).
- table (out/perf/table.tsv): 4K frame s at spp 8: 1 2.35, 2 1.48, 3 1.52, 4 1.17, 5 1.23, 6 2.72, 7 2.02, 8 2.14, 9 3.08.
- hotspots: terrain shader ~98/175 ms per 4K sample in shots 1/9 (noise terms computed where distance fade = 0) → terrain r5; sunken overlay raises every material (shot 6 chariot ~42 ms) → sunken r5; vegetation budget grows with resolution (26 M main + 58 M shadow at 4K; cheap here).
- DETERMINISM BUG: SKY.uFrame / UW.uUwFrame carry over between stills → consecutive sunken stills differ → look owners r5 (reset per still / derive from frame index).

## water (done r4)
- shot 1 rings turquoise (uRingLook; mean rgb 64,73,84 → 62,106,125, ref 76,106,121); uSeaSector (navy sea right outside l2, whitecaps), uSeaDeep; narrower broken surf; uFallFar (falls read as white ribbons at 1.4 km); shot 4 glint dots → wind-ruffled mirror + uSunLobe gold field; shot 2 HERO_FOAM 1.5, bowSpray boil domes/jets; shot 9 waves from sunken uUwWaveK, opaque navy body, warmer sky reflection, sharper mirror; planCascades avoids the mole-bridge gate; NaN guards. 0.65 s, 114k cascade tris.
- gaps: shot 1 islet surf wide, city mirror dims ring water near walls; shot 4 lacks strong building reflections (ref 4); shot 9 no orange glitter path; shot 2 bow wave smaller (hero shrunk); stair channel not done.
- requests: look-golden(shot 9 is sunken → sunken/look owner) → shot-9 sun disk / sky gradient; citadel → channel along the grand stair (water will trace a cascade on it).

## director (done r4)
- shot 1 pos [0,191.26,1332.94] fov 35.15 (citadel 1.14× wider; rms 42 px over 14 landmarks, lighthouses deliberately bigger/lower); shot 5 eye 2.9 m, fov 58 (citadel end of ring bridge at right edge; ref-5 temple hidden by quay palaces); shot 2 hero trireme [-17,0,792] heading 188 (146→60 px).
- layout: 4 rocky islets in shot-1 sea; MOUNTAINS.scale 0.62 (src/terrain/far.js) — all golden shots + 9; shot-1 fleet moved into frame (z 835-1010); terrace set pieces move out as the eye rises. Citadel height + stair head unchanged (round-5 proposal in COMPOSITION.md).
- sequence 55.4 s: 1 (8 s, dolly 150) · 2 (7) · 4 (6.5) · 5 (6.5, truck left) · 3 (7, slow push) → 2 s dissolve → 6 (7, push continued) · 7 (6.5) · 8 (6.5, orbit) · 9 (8, level push, ease out). sequence.js: push, range, per-segment xfade; render-video honours xfade. Preview out/video_preview/atlantis_640x360.mp4.
- preview problems still open: shot 1 move reads slow; shot 2 trireme doesn't advance; shot 3 reference framing at 30 % of the segment, shot 6 never reaches it.
- requests: look-golden (shot-1 sun, mountain clouds — forwarded); citadel → lower quay palaces for shot 5.

## look-golden (done r4)
- GOLD_SKY4 (shots 1-5): opaque shaded cumulus, gold edges, no cirrus veil; uCloudHaze; shot 1 sun at px (120,73) vs ref (118,75), thinner far cumulus, white heaps on the lowered range, less haze, far greens less yellow; shot 5 sun visible right of column 2 (px 487 vs ref 365); shot 3 lens rays 0.04, weaker Mie; shot 4 glitter 0.5.
- percentiles match refs within ~2 levels (shot 3 p98 224 vs 229).
- gaps: speckled cloud fragments in shots 2/4; shot 4 water warmer than ref (yb 34 vs 25).
- requests: WATER → shot-1 sea has a hard-edged bright-cyan RECTANGLE (not the sky) — likely uSeaSector / ring tune boundary; terrain → far range flat hazy-grey vs ref 1 lit rock.
