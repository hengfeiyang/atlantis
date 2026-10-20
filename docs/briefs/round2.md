# Round 2 briefs — director, look-dev, fixes (run in parallel)

Everyone: read `docs/CONTRACT.md`, `docs/ART_BIBLE.md`, `docs/briefs/round2-notes.md` (all round-1 reports +
director observations) and look at the round-1 comparisons `out/r1/cmp_golden.jpg`, `out/r1/cmp_sunken.jpg`
(reference left | render right; per-shot `out/shotN_cmp.png`). The whole world renders all 9 shots at high in
~80 s (`node tools/render.mjs --shot all --quality high --spp 12`) — use `--shot N` and distinct `--out`.
Work loop as in round 1. Same ownership rules; files owned by finished round-1 agents may now be edited by the
agent whose brief names them. Finish with full-world renders of the shots you touched + ≤ 250-word report.

## director
Owns: `src/world/shots.js`, `src/world/layout.js` (composition changes; keep the additive blocks of others),
near field of `src/world/heightfield.js`, `docs/COMPOSITION.md` (new), `src/video/` later.
- **Solve every camera against its reference** like athenaion's director did (read
  `third_party/athenaion/docs/COMPOSITION.md`: pinhole camera solver fitted to known landmarks, triangulation,
  top-down planning map `tools/map.mjs`, in-page raycaster via `tools/session.mjs` + `snap.mjs --eval` to name
  the object under a pixel). Landmarks: temple front (46 m wide, ridge y ≈ 75), chariot group, gate bridge arch
  (56 m span, deck 30), gate towers, citadel wall, lighthouses, ring radii. Fit fov, position and target so the
  main landmarks land on their reference pixels (state the rms px per shot).
- Where the world contradicts a reference, change the world (layout constants, citadel hill height, ring
  widths, temple size, tower heights...) when that is cheaper than a bad camera — e.g. ref 1 shows the
  citadel hill much taller and more prominent than ours; ref 5 shows the citadel as a tall green hill crowned by
  the temple above a red wall band; ref 4 shows the citadel hill rising steeply from the ring with tiers.
  Announce every layout change in COMPOSITION.md with the reason, and verify the world still builds.
- Specific known issues: shot 3 must stand on the stair top (ref 3: stair steps in the foreground, eye ≈ 2-4 m
  above the steps); shot 6 has to frame the temple within underwater visibility; shot 9 horizon ≈ 22 % from the top and
  waterline ≈ 30 % (underwater agent's note); shot 2 must show the hero trireme near the camera heading
  toward/away like ref 2 (coordinate the hero ship position: `SHIPS.hero` in layout.js, owned by ships but you
  may move it); shot 7 must show the bridge arch + towers + wreck.
- Write `docs/COMPOSITION.md`: per shot the final camera, rms, what still differs and a list of concrete
  requests per module (with world coordinates). This feeds round 3.

## look-golden
Owns: `src/core/sky.js`, `src/modules/clouds.js`, `src/core/pipeline.js` (grade), `src/core/lighting.js`,
`src/world/looks.js` entries 1-5, `src/core/atmosphere.js` (golden part; keep `#ifdef CG_UW` paths intact).
- **Bug**: at `--quality high` the clouds render as blocky, pixelated noise blobs (see out/shot2-5.png) — find
  and fix (cloud texture resolution / sampling / LOD / steps). Clouds must read as soft, sunlit cumulus with
  gold rims and violet undersides, cirrus streaks, mountain cloud banks (refs 1-5).
- **Grade**: our golden shots read sepia/brown with an orange-brown sky. The refs: deep blue sky away from the sun
  turning gold-orange only around the low sun, saturated turquoise water, white-cream stone glowing gold in sun,
  cool blue-violet shadows, gold metal gleaming. Fix exposure, white balance, saturation, sky radiance; match
  `colorstats` / `satstats` per shot (ART_BIBLE targets). Make the sun disk + glitter path visible where the refs
  show it (refs 1, 2, 3, 5).
- Aerial perspective for shot 1 (warm haze toward the sun, plain + mountains fading) and far mountain shading
  (`registry.terrain.uniforms`).
- The director is moving cameras in parallel: fix the systemic look first, then re-tune per shot at the end
  against the cameras current at that time.

## look-sunken
Owns: `src/core/underwater.js`, `src/core/sunken.js`, `src/world/looks.js` entries 6-9 (`uw:` overrides),
the sunken part of `src/core/atmosphere.js` / `pipeline.js` hooks.
- **Visibility**: the refs show the temple crisp at ≈ 60 m and building silhouettes at ≈ 150-250 m (ref 6, 7, 9);
  ours loses the temple at 70 m and the gate bridge at 60 m. Rebalance absorption vs in-scatter (horizontal
  path), keep depth darkening plausible, keep the blue-teal palette and ref luminance targets.
- Colour: warm colours (gold, red-white banded marble, orange/red coral) must stay readable within ≈ 15-20 m
  and gold must glint at 30-50 m (refs 6, 8); reduce the washed-teal look at the temple's 33 m depth.
- Brightness / contrast of shots 6-9 (ref 7 and 9 are brighter and clearer than ours), shot 9's water half,
  god rays (occlusion by geometry if feasible — the bridge arch in ref 7 frames the rays), caustics breaking the
  32 m repeat, sand dust amount on paving (ref 6 mosaic readable).
- The director moves cameras in parallel; fix the systemic medium first, then re-tune per shot.

## arch-a (rings + bridges fixes)
Owns: `src/rings/**`, `src/modules/rings.js`, `src/bridges/**`, `src/modules/bridges.js`.
- Bridges: the sunken surface is now y 78 (was 64): raise the gate towers to ref-2 proportions (≈ 50 m above
  the deck; tips ≤ 76 so they stay under water in the sunken era — or let the trident tips break the surface if
  that matches ref 7/9 better). Ring-bridge gate towers must be taller than the walls they join (l1 wall top 28,
  ring towers 37).
- Rings: shot 4 (ref 4) — seat the l1 walls on the rim and show the limestone rock face below them with the
  ship-shed arches cut into it (terrain provides the faces; `registry.terrain.faces`); canal walls currently
  hide the gate bridge's side viaducts (lower them / step them near the bridge); banner slots behind the tower
  ledges (move out / below the moulding); bastion top more than a plain slab.
- Check shots 1, 2, 4, 5, 7 for anything of yours that reads wrong against the refs and fix it.

## arch-b (temple + statues + city fixes)
Owns: `src/arch/**`, `src/modules/temple.js`, `src/materials/**`, `src/sculpt/**` (not sdf.js/mesher.js core
behaviour), `src/modules/statues.js`, `src/bake/statues.js`, `src/city/**`, `src/modules/city.js`.
- Statues: decimate the horses (440k tris each) to ≤ 120k with no visible loss at shot distances (bake);
  stop wings crossing between neighbouring horses; richer Nereid drapery. Add `pinnacle` statue slots on the
  temple + gold figures on them (ref 1, 3: gold statues on the roof corners / apex).
- Temple: the chariot pedestal reads as a big dark box hiding the temple in shots 3 and 6 — ref 3: lower,
  black stone with gold relief friezes and steps, the temple columns visible above/behind the group; check the
  temple's proportions against ref 3 (it reads small/far — coordinate with the director who may scale it).
- City: keep the (moved) `L.GARDEN_TERRACE` zone clear (now on the l1 inner wall, bearing 135); fewer, larger
  coral slots (marine uses 9k of 29k) incl. vertical faces; switch houses to the shared stone materials where
  it helps the palette; in ref 1 the city reads bright white-cream with many gold domes, gardens and towers — ours
  is a grey mass: raise albedo / variety / gold accents as seen from shot 1.

## marine-fix
Owns: `src/marine/**`, `src/modules/marine.js`, `src/sets/**` + `src/modules/sets.js` (sunken parts),
`src/bake/sets.js`.
- Respect `registry.sets.keepClear8` (coral covers the fallen head's face); corals less toy-like up close
  (more geometric detail, polyp texture, softer colour variation) and smaller near the camera; use vertical-face
  slots; kelp in shot 7 not a dark wall in front of the bridge (ref 7: kelp at the sides framing the arch).
- Sets (shot 8): the head darker / less detailed than ref 8 — bronze-verdigris balance, gold traces, mosaic
  contrast, a background arcade / towers silhouette (ref 8). Rebake sets (`node tools/bake.mjs sets`): five
  sets-drum bakes are missing (404 at runtime).
