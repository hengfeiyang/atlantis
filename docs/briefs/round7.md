# Round 7 briefs — final polish before the 4K render

Read FIRST: `docs/briefs/round7-notes.md`, `docs/COMPOSITION.md`, `docs/RENDER.md`, `docs/CONTRACT.md`. Current state:
`out/r6/cmp_golden.jpg`, `out/r6/cmp_sunken.jpg`, `out/r6/shotN_cmp.png`, preview with music
`out/video_preview/atlantis_preview_music.mp4`. Git repo — do not commit. This is the LAST round before the final 4K film:
only safe, verified changes; keep determinism; check every change in motion (`cameraAt` at u = 0, 0.25, 0.5, 0.75, 1);
keep render cost flat. Finish with high renders of the shots you touched and a ≤ 200-word report.

## director
Shot 3: the colossus behind the temple shows above the apex and reads like a seated rooftop statue — decide (hide it
in the shot-3/6 segment via onShot, move it, or scale) with the citadel agent; shot 3 right side (ref 3: waterfalls
down the terraces and the city beyond — below the plateau rim in ours: is a small yaw / height change worth it?);
then a full-motion QA pass at the end over all segments (frame strips every 0.5 s at 640×360, spp 2) and a final
music preview `out/video_preview/atlantis_final_preview.mp4`; update RENDER.md if anything changed.

## citadel
Whatever the director decides for the colossus in shot 3; shot 3 colourfulness (56 vs ref 64: more gold glints, warmer
marble in sun, richer red/navy accents in frame) without changing the grade.

## water
Shot 9 above-water sea (dark with smooth streaks — ref 9: lively small waves with orange glints), shot 3 sea toward the
sun pale grey (ref 3: bright gold glitter under the sun), shot 4 colourfulness via reflections (55 vs ref 62).

## sunken
Shot 9 p02 (30 vs ref 12: deeper blacks in the water half), shot 6 / 9 far-city silhouettes stronger, shot 7 kelp sweep
across centre-right during the dolly (verify against the current path; fix), final look 6-9.

## look-golden
After the others land: final grade 1-5 (colourfulness 3 and 4 without breaking percentiles), and a check that the
golden shots look right at the 4K render settings in RENDER.md (one 3840×2160 still per shot at the planned spp).
