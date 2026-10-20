# Round 7 notes (collected from round-6 reports)

- MUSIC: user chose "Long Road Ahead" Kevin MacLeod (CC BY 4.0), audio/Long Road Ahead.mp3 (gitignored), credit audio/CREDITS.txt; director picks offset + end credit card + RENDER.md.

## ships (done r6)
- shot 1: fewer bigger sea ships (scale 1.45, ~18 at high), big-rig variants seaA/seaB/seaOnly, all sails set cream/trident, 88 % headings toward/away from camera; wakes pass trail (1.3 × hull) + broken (0.75) via addWake (water must confirm the shader reads them). Shot 5: both triremes read (braced5a/b) sailing away left; shot 2: ship hiding the right pier removed, 4 sails beyond the bridge. Sails: AA brail lines, backlit glow, royal-blue trident, braced-sail pivot bug fixed. 274 inst, 3.39 M tris.

## props (done r6)
- bougainvillea bract albedo ×0.45 (was 1.3× too bright; deep crimson-magenta); shot 5 gilt lidded urns, lotus domes + bigger white flowers, dressTerrace5() climbers/magenta spill; shot 3 set3 masses taller; shot 2 canal pier braziers 1.3 m + dressCanal2() 14 gilt urns; urn bougainvillea LOD. props 9.0 M tris (bougainvillea 5.1 M).
- gaps: shot-3 left balustrade masses smaller/shaded vs ref 3. arch-a: rings-canal brazier slots now read as 1.3 m bowls.

## citadel (done r6)
- front pediment: two rearing gilt horses in high relief (new poses P, Q baked stat-horse-{P,Q}-v2.bin; buildPedimentHorses) + centre trident on shell urn + gold sprigs; bigger apex/corner ornaments, mid-slope pinnacles, taller tridents, gold cresting; frieze white marble + gold fillets (navy band gone); palms + cypress at temple front corners; flank banners. Stair flights end in red steps with gold nosing; palaces gold frieze + domes. temple 2.13 M, statues +0.23 M.
- open (director): ref-3 waterfalls + city on the right sit below the plateau rim; shot 5 rim hides most of the temple; shot 3 colossus above the apex reads like a seated rooftop statue.

## arch-a (done r6)
- shot 4: 6 mole bays all differ (MOLE_BAYS: widths, archivolts, pier ornament, lamps, trusses, lanterns, ivy, bay 3 closed bronze gates/no ship), more rugged rock, darker vaults; mole bridge statues/braziers/banners; ring sheds varied by hash (bayStyle). Shot 2: stoa upper loggia, gold statues/urns, bougainvillea, promenade palms/cypress, quay statues, lion-head spouts every 3rd bay, gate-tower mid cornice + urns. Shot 7 sunken towers same cornice + coral. rings 3.46 M, bridges 2.69 M.
- notes: registry.rings.spouts 51 (golden), rings-shed spouts 2.9 m above water; new slots (urn, flowers, lamp-flame rings-shed-pier, palm, cypress, shrub, ivy); statue slot indices shifted → sunken ruined set changes.

## water (done r6)
- shot 1: near-sun sea reflects warm low sky (uSunSide/uSunSideK), glitter gold path [1,0.6,0.28]; shot 2 canal: camera water was treated as open sea (navy) → canal mask uCanalRingC, bluer teal → turquoise; wakes read trail/broken (V stops ~2.2 hull lengths, no contrail), registry.water.syncWakes(); 51 rings spouts traced (canal lion-head jets arc into the canal; shed pier pours); splash-foam slots go to falls nearest each camera.
- open: shot 4 only one shed spout + bridge pour (arch-a: more shed-pier spouts); glitter path narrower than ref 1; shot-1 sky banding reflected (look-golden told).

## sunken (done r6)
- stats |dL|/|dSat| r5→r6: 6 9.0/9.5→9.9/10.8; 7 9.0/8.1→8.8/6.7; 8 9.3/8.3→9.6/8.4; 9 8.9/11.4→8.7/8.0; percentiles match refs except p02 shot 7 (12 vs 5) and shot 9 (30 vs 12).
- shot 9: solid orange-lit clouds to the horizon (flat band gone), peaks dark mauve (uFarTint 1.25), glitter [1,0.42,0.12], clearer bluer water, plateau reads as reef; shot 7 clearer, brighter bridge face (red bands read); shots 6/8 longer far range. Kelp filtered along video paths (no blocking the hero view, ≥ 4 m from camera). Shot 6 bigger fish school left of the temple + backdrop6.js far city (gilded towers, rotunda, 2-tier arcade; also left of shot 9). Shot 8 far city off the mole, terraces as building fronts. Determinism verified.
- open: shot-9 sea above the waterline dark with smooth streaks (water); shot 6/9 far city faint (plateau rim + fog).

## director (done r6)
- docs/RENDER.md: exact 4K commands, timings, resume steps; COMPOSITION.md C1-C5.
- render-video.mjs: text cards drawn by headless Chrome (this ffmpeg has no drawtext); atomic frame writes, resume skips finished frames/segments; per-segment background encode + --prune-frames (4K PNGs ≈ 38 GB otherwise); pauses when free disk < 4 GB; new options --spp-seg, --frames, --no-encode, --music-start, --music-fade, --lufs, --credit-file.
- 4K measured 2.0-4.0 s/frame at 16 spp; plan 24 spp all segments ≈ 2.3 h (budget 3 h).
- music: Long Road Ahead from 53.5 s; cut to shot 3 on a phrase dip, 3→6 dissolve on a section boundary, cut to 8 on a boundary, triumphant section swells as the dissolve into 9 finishes (48 s); fade out over a 4 s CC-BY credit card (only text); two-pass loudness, no compression (-16.6 LUFS, LRA 14.5). Preview out/video_preview/atlantis_preview_music.mp4.
- shot 5 move → slow pan with slight parallax (old end had two columns covering 40 %); no pops; dissolve aligned. Still: shot 7 kelp sweeps centre-right during the dolly (sunken r6 filtered kelp along paths afterwards — recheck).
- DISK: volume filled mid-round (3 GB free) by /private/tmp/o2-loop-oss-usage-8714 (139 GB) + /private/tmp/claude-501/…openobserve… (97 GB) — outside the project, not touched; later 106 GB free. Our out/ = 16 GB of intermediate renders.

## look-golden (done r6)
- far haze own colour (uHazeFarCol / uHazeFarSun / uHazeFarWarm, golden atmoApplyFrom, default off): cool slate-blue away from sun, gold within ~37°; far term scale 15 → 10 km; shot 1 range shadows 71,61,60 → 63,73,92 (ref 54,64,77); far sea toward sun 195,153,115 (ref 233,164,117, still darker); GOLD_TERRAIN darker warmer lit rock (shots 2-5); streak bars softened. Pipeline chroma clamp on bright px 2× → 1.12× (pink disk rim gone; all shots, very bright px only).
- final grade: yb/sat ≈ refs (1: 15/14, 42/44; 2: 33/33, 49/45; 3: 36/36, 46/46; 4: 25/25, 41/41; 5: 36/39, 53/51); percentiles within 2 levels.
- gaps: colourfulness low in shot 3 (56 vs 64) and 4 (55 vs 62); shot 3 sea toward the sun pale grey (geometry/water).
