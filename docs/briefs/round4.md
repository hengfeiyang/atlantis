# Round 4 briefs — the opening shot, detail density, performance, motion

Read FIRST: `docs/briefs/round4-notes.md` (all round-3 reports, open requests per module), `docs/COMPOSITION.md`,
`docs/CONTRACT.md`, `docs/ART_BIBLE.md`. Current state: `out/r3/cmp_golden.jpg`, `out/r3/cmp_sunken.jpg`,
`out/r3/shotN_cmp.png` (reference | render). The project is now a git repo (one commit per round; do not commit —
the coordinator does). Same rules: ownership, distinct `--out out/<you>/...`, both eras, determinism.

Where we stand: every shot has the right elements; the gap to the references is now mostly **detail density**
(the refs are packed with ornament, foliage, waterfalls, gold, small life; ours reads clean / sparse / CG in places)
and **shot 1**, the opening shot of the film, which is the weakest: the citadel hill barely reads, the city is a flat
grey-white disk, the ring water is pale grey. Every agent: check what your module contributes to shot 1 and fix it.
Finish with full-world high renders of the shots you touched and a ≤ 250-word report.

## director
Owns shots.js, layout.js (anchors), heightfield near field, COMPOSITION.md, `src/video/**`.
1. **Shot 1**: make the citadel the hero of the aerial like ref 1 (tall central hill with the temple and colossus
   on top, tiers, falls, the rings reading as concentric bands of turquoise water and green/gold land, the canal +
   moles + lighthouses leading in, ships in the foreground). Options: camera lower / closer / longer lens, citadel
   scale (more height/steepness if needed — coordinate with citadel agent via COMPOSITION.md), mountains ≈ 0.6× on
   screen (terrain note). Announce changes early in COMPOSITION.md.
2. Shot 5 eye ≈ 4 m above the deck + the ring bridge in frame (sets terrace follows `frameFromShot`); shot 2 hero
   trireme size/heading vs ref 2.
3. **Video**: tune `src/video/sequence.js` (draft: 1,2,4,5,3→6 era dissolve,7,8,9; ≈ 56 s) — slow cinematic moves
   that pass through each reference framing at mid-segment, never enter geometry (check clearance along the path),
   impressive from the first frame. Render a motion preview (`node tools/render-video.mjs --w 640 --h 360 --spp 1
   --quality preview --out out/video_preview`, then `--encode-only`) and watch frame strips for problems.

## citadel (temple + city + statues)
Owns `src/arch/**`, temple.js, `src/materials/**`, `src/sculpt/**`, statues.js, `src/city/**`, city.js.
Detail density on the citadel and city as seen in shots 1, 2, 4, 5 (gold domes, coloured roofs, gardens/courtyards
— **leave ~50 % of land-ring l1 ground for gardens** per vegetation), outlet arches from water's `spec.outlet`, the
open requests (honor-column urns, palace-facade banners, buried city urns, less uniform plateau paving — shot 9).

## arch-a (rings + bridges)
Owns `src/rings/**`, `src/bridges/**`. Shot-4 bridge crag texture, glint/ribbon issues, shot-7 gate towers detail
underwater (they read as grey silhouettes vs ref 7's ornate banded towers), shot-8 background pylon, shot-1 read of
walls/towers/moles from the air (gold domes, banners, colour).

## water
Owns `src/water/**`. Shot 1 turquoise rings (sky reflection too grey), shot 4 glint dots, shot 9 orange-gold glitter
path + warmer sky reflection, shot 2 bow foam, cascades visible from 1.4 km (shot 1), keep cascades clear of the
mole-bridge gate (`registry.rings.gates`, mole: true).

## vegetation
Owns `src/vegetation/**`. Broad-tree LOD2 cubes from the air, shot-5 fronds darker than ref, fill the land-ring
gardens the city frees, mole cypresses (`slots.tree`) and shed ivy slots (with props), shot 1 greenery.

## sunken (look-sunken + marine + sunken sets)
Owns `src/core/underwater.js`, `src/core/sunken.js`, looks 6-9, `src/marine/**`, sunken sets. Detail density in
6-9 (ref 6/7: dense coral on every ledge, kelp, fish; ref 8 background city), shot 6 far-left city silhouettes,
shot 9 plateau paving (pool look) + far city + mountains, shot 7 overall richness.

## perf
Owns nothing exclusively — measurement + LOD changes coordinated with owners (you may edit LOD / instance-count /
distance-culling code in any module, minimal and documented in your report; never change looks). The world is
113-132 M tris at high (contract 60 M). Profile every shot with `window.__profile` (tools/session.mjs +
`snap.mjs --eval`), find what is drawn but invisible or sub-pixel, add distance LOD / frustum culling per shot,
and measure the 4K frame time (3840×2160, spp 8) for every shot — the final video is 4K 30 fps. Report a table.

## look-golden (runs last within the round — start with systemic items, grade at the end)
Owns sky/clouds/pipeline/lighting/looks 1-5. Final grade of 1-5 after the geometry changes; shot 5 sun visible in
the column gap; shot 1 haze and colour so the rings read turquoise / green / gold like ref 1.
