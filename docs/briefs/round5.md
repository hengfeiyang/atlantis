# Round 5 briefs — polish, determinism, motion

Read FIRST: `docs/briefs/round5-notes.md` (all round-4 reports + open requests + coordinator notes), `docs/COMPOSITION.md`,
`docs/CONTRACT.md`, `docs/ART_BIBLE.md`. Current state: `out/r4/cmp_golden.jpg`, `out/r4/cmp_sunken.jpg`,
`out/r4/shotN_cmp.png`, motion preview `out/video_preview/atlantis_640x360.mp4` (watch it: `ffmpeg -ss T -i … -frames:v 1`).
Git repo — do not commit. Same rules. Since the video is next, every agent also checks its work **in motion** along the
segment of its shots (src/video/sequence.js `cameraAt`): nothing pops, flickers, intersects the camera path or
changes between frames other than intended animation. Finish with high renders of the shots you touched and a
≤ 250-word report.

## ships
Owns `src/ships/**`, ships.js. **Shot 2 regression first**: a second trireme's bow post + rigging sits right in front
of the lens (out/r4/shot2.png bottom) — find it, and make the "no ship within N m of a golden camera" rule cover the
whole segment path of each shot (moored and sailing). Shot 2: the hero trireme must advance along the canal during its
segment (animate along its heading with engine time, wake follows); bigger bow wave with water.

## director
Owns shots.js, layout.js anchors, heightfield near field, COMPOSITION.md, `src/video/**`, render-video.mjs.
Motion: shot 1 move reads slow (more travel / a crane down toward the citadel), shot 3's reference framing at mid-segment
and shot 6 reaching it after the dissolve, every segment opening strong. The shot-1 stair-head column hiding the
temple: decide (your r5 proposal in COMPOSITION.md) with the citadel agent. Render a new motion preview at the end.

## citadel
Owns arch/temple/materials/sculpt/statues/city. Quay palaces lower for shot 5; the shot-1 stair/landing read (with the
director); a central water channel down the grand stair (publish its path for water); shot 4 hill visibility from
water level (the shore wall / ledge-2 tier hide it — lower or open them in the shot-4 view).

## water
Owns `src/water/**`. Shot-1 sea: a hard-edged bright-cyan rectangle (look-golden — probably a sector / tune boundary);
shot 4 strong reflections of lit buildings (ref 4); shot 9 orange-gold glitter path; trace a cascade on the citadel's
stair channel; shot-2 bow wave on the advancing hero.

## terrain
Owns `src/terrain/**`. Shader cost (perf: ~98 of 175 ms per 4K sample in shots 1/9 — skip noise terms whose distance
fade is zero, cheaper far shading) WITHOUT visible change (pixel-diff); the far range lit rock like ref 1 (look-golden).

## sunken
Owns underwater.js, sunken.js, looks 6-9, marine, sunken sets. **Determinism bug**: `UW.uUwFrame` carries over between
stills (consecutive sunken stills differ) — derive per-frame noise from the still/frame index. Overlay cost (shot 6
chariot ≈ 42 ms); shot 7 look (dL got worse); shot 8 background distant city silhouettes (ref 8); use arch-a's
`tower-cornice` / `tower-plinth` coral slots in shot 7; shot 9 mountains above water still dark.

## look-golden
Owns sky/clouds/pipeline/lighting/looks 1-5. **Determinism bug**: `SKY.uFrame` carries over between stills (same fix
approach as sunken — coordinate so both derive from the same frame index); speckled cloud fragments in shots 2/4; shot 4
water warmth (yb 34 vs 25); final grade 1-5 at the end.

## arch-a
Owns rings/bridges. Mole cypresses hidden behind the mole curtain wall (shot 4 — with vegetation), the dead assignment in
`src/rings/mole.js` line ~66 (`west.shedBack = …` inside a comment — decide), sunken ornament on the shot-8 ring wall and
shot-7 gate towers, anything of yours that flickers in the motion preview.

## vegetation
Owns `src/vegetation/**`. Citadel slopes greener from the air (shot 1), mole cypresses (with arch-a), foliage stable in
motion (no LOD popping along the segment paths — use the segment's camera range, not only the still camera).
