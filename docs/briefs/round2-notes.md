# Round 2 notes (collected from round-1 reports)

## vegetation (done r1)
- palms 5 styles (hero/mid strips/far impostor), cypress/olive/oak/pine/shrubs from athenaion; registry.vegetation; 1.6 s high, 185k inst, 0.4-0.8 M tris drawn.
- gaps: mid-range palms darker/sparser than close ones; orchard rows regular; young palms look like agaves.
- requests: sets → push slots.palm for ref-5 garden under terrace + ref-3 stair top; city → roof-garden slots ≈ half of all instances (cap?).

## water (done r1)
- golden plane w/ depth colour, planar refl, FFT ripples, whitecaps, foam, wakes (registry.water.addWake), glitter, 20 cascades + 20 wall spouts into w1 (re-traced on first applyShot), fountains + hot-spring steam. Sunken: surface from above (ref 9, discards underwater side) + underside (Snell window, TIR), shared uwWaveDeriv waves.
- registry.water: addWake/setWakes/addImpact/depthAt/shoreDist/surfaceHeight/waves+WAVES_GLSL/spouts/cascades/fountains/level.
- gaps: glitter silvery after grading; whitecaps small at shot-1 distance; shot-4 water pale; basin heights guessed (plaza+0.9); Nereid jets skipped.
- requests: temple → registry.fountains [{id,pos:[x,waterY,z],radius,kind,jets?}] incl Nereid basins; rings → spout notches in parapet at registry.water.spouts (r≈228,y≈13.4), rock bases for surf at moles; director → shot 5 camera blocked by a wall.

## sky (done r1)
- sky.js golden glow replacing blue, per-shot tints, gold-rimmed cumulus; looks.js places the visible sun disk per shot (light stays side-left), clouds module points ATMO.uSunDir at the disk; mountain cloud banks; registry.sceneDepth; 77 gulls. APIs: SKY, visibleSunDir(), CLOUDS, BANK_REGION.
- gaps: banks slightly streaky; cloud edges softer than refs.
- requests: director/terrain → mountains only bearing ≈ 345-80° so the sun sets over open sea WNW; director → cameras matching ref horizons so the sun disk lands right; water/underwater → use ATMO.uSunDir (not SUN.dir) for glitter and rays.

## temple (done r1)
- src/materials/stone.js (stoneMaterial kind, whiteStone, redStone, blackStone, limestone, bandedStone, checkerFloor 0-4, mosaicFloor, marbleMaterial alias) + metal.js (orichalcum, gold, gilt, bronze, tin, silver, patinaBronze; panels option). READY.
- Corinthian 8x15 temple, gold capitals, silver cella, navy frieze, gold pediment relief, ridge tridents; mosaic plaza, chariot pedestal, basins, colossus pedestal, grand stair; red ramparts + towers, ledge palaces, gold-domed pavilions (gaps for cascades). Sunken: collapsed roof, fallen back pediment, toppled columns. registry.temple, registry.fountains, fountainPlan(). ~4 M tris.
- director actions done: SUNKEN.surface 64→78 (ridge ≈ 75 + 5 m tridents); stairCut() in heightfield; shots 3/6 → pos [10,56,138] (camera floats ~21 m above the stair line — director r2 must re-solve against ref 3 stair-top framing).
- open: chariot too big (told statues); water should read registry.fountains late or import fountainPlan().

## underwater (done r1)
- all sunken-only behind #ifdef CG_UW; golden byte-identical (verified). Medium splits view ray at surface; refracted sun dimming + Fresnel + ambient; shadow dir refracted from ATMO.uSunDir; caustic map (4 depths) splatted each setTime; god rays = beams × blurred caustics; sky fallback w/ Snell window; marine snow geometry; split level via virtual dome port (uUwDome 1.2 m) + meniscus; sunken.js overlay (dust, sand drifts, algae, coral crust, verdigris, dulled gold, waterlogged wood; untagged = stone half strength). Per-shot `uw:` look overrides in engine. APIs UW, UW_GLSL, UW_WAVE_GLSL (uwWaveH/uwWaveDeriv), uwMedium, uwCaustics, uwSunW, SK, sunkenKind. ~65 ms/sample preview shot 6; 19 s at high 12spp.
- shots 6/7/8 within ~5 luminance levels of ref targets (except p02 shot 7: 21 vs 5).
- gaps: god rays not occluded by geometry; grain at 12 spp; caustics repeat every 32 m.
- requests: water → UW_WAVE_GLSL for sunken surface, brighter ceiling from below; looks → shot 9 water half too dark (raise uw.uUwSunSurf / uUwAmbColor); everyone → tag materials, sand = 'none'; director → ref 9 horizon ≈ 22% from top, waterline ≈ 30%.

## ships (done r1)
- hero trireme (painted eye, gilt, 170 oars rowing, trident sail), instanced fleet (13 variants, 262 inst, 3.5 M tris), sheds, merchantmen, boats; wakes via registry.water; ref-7 wreck + 9 wreck pieces (sunkenGround), coral/kelp slots. registry.ships {hero, ships[], wrecks[], shipAt, stats}. SHIPS block in layout.js: hero leaves the canal toward the camera (heading 185); SHIPS.wreck overrides WRECKS[0] (pos −11,759, heading 204) — director: keep unless shot 2/7 cameras change.
- gaps: hull foam / bow wave thinner than ref 2; water late build failed once at high ("undefined is not iterable").

## director observations after r1 (shot 6 test renders out/me/shot6b_cmp.png)
- shot 6 moved to pos [8,50.5,104] → target [-3,58,20], fov 50 (old cam 100 m from the temple: lost in fog).
- even so the temple (≈ 70 m) vanishes: ref 6 shows the temple crisp at ~60 m and silhouettes at ~200 m → underwater horizontal visibility must be longer (look/underwater r2), or the camera closer.
- chariot pedestal reads as a huge dark box hiding the temple; group too large (told statues). Ref 6 pedestal is low with relief, temple columns visible above/behind the group.
- sunken sand covers the plaza mosaic uniformly; ref 6 shows the compass-rose mosaic clearly with sand drifts only at the edges.
- props module had a transient syntax error (agent mid-edit) — recheck at end of round.

## props (done r1)
- banners 1526 (trident art, LOD), braziers (gilt + fire), urns/planters (plant option), bougainvillea curtain/bush/climb, lotus pond/pot; sunken: toppled/dulled braziers & urns + coral slots. APIs drawTridentEmblem, makeTridentEmblemCanvas, BannerSet, BrazierSet, FireSystem, UrnSet, LampSet, BougainvilleaSet, LotusSet; src/props/READY. ~0.86 s / 4.8 M tris golden high.
- gaps: no lamps (no lamp slots pushed); lily basins only from slots; fallback placements tied to round-0 cameras.
- requests: rings → tower banner slots behind a projecting ledge (move pos out/below moulding); director → shot 3 stair-top foreground out of frame.

## statues (done r1)
- SDF + surface nets, AO/cavity/gilt baked in vertex colours, 25 bake jobs (generated/stat-*.bin, `node tools/bake.mjs statues` ~4 min). Six winged horses (3 poses mirrored, feathered wings), shell chariot, Poseidon; 0.8 scale on the 30×18 pedestal (top 52), ~23 m wide; 8 Nereids on dolphins (4 variants); 30 m colossus (golden only); instanced small statues (kings, nymphs, priestesses). Sunken: verdigris, one horse broken off, damaged wing, toppled statues; coral slots from up faces. registry.statues {chariot, nereids[{pos,mouth,facing}], colossus{tridentTop}, tris}. 7.0 M tris golden / 6.0 sunken; horses 440k each (decimate!).
- gaps: no tritons/pinnacle statues (temple → push 'pinnacle' slots); wings cross between horses; simple Nereid drapery. water → jets at nereids[i].mouth.

## bridges (done r1)
- gate bridge (56 m arch, gilt relief piers, banded towers with tholos + trident, side viaducts, stairs) + 12 ring bridges; sunken ruin (collapsed span w3-45, fallen tholos tops). bridgePlan(), GATE, registry.bridges; 2.1 M tris golden.
- towers ~33 m above deck (ref 2 ≈ 50 m) — were capped below the OLD surface 64; surface is now 78 → raise towers (tips ≤ ~76). Gate towers moved to x ±28-47.
- director done: shot 2 → [-6,3,845]→[0,30,690]; shot 7 → [-8,-5,748]→[0,30,690] fov 58.
- requests: underwater → more visibility / rim light in shot 7; rings → canal walls taller than the side viaducts, hide them.

## director observations (shot 3 high, out/me/shot3h_cmp.png)
- SKY BUG: clouds render as blocky, pixelated noise blobs at high quality (looks like a low-res/nearest-sampled cloud texture) — sky agent r2.
- grade too brown/sepia overall; sky orange-brown instead of blue-to-gold; temple small and far; camera ~21 m above the stair → no stair-top foreground (re-solve vs ref 3).
- water late build OK now (the failure was the temple fountain-jet format, fixed by temple).

## rings (done r1)
- 17.3 km walls / 2305 bays (revetment + blind arches + clad curtain; citadel orichalcum w/ 20 spout notches; l1 tin panels + gold balustrade; l2 bronze), 206 instanced towers, 145 ship-sheds, quays, canal tunnel, embankments, moles + 2 lighthouses (~60 m), bastion. ringPlan() pure; registry.rings, registry.spouts. ~3 M tris golden.
- gaps: shed interiors fake lamp glow; canal colonnades simple; bastion top plain slab.
- director done: shot 4 → [258,1.8,-60]→[150,13,-240]; GARDEN_TERRACE moved to l1 inner wall (r 302, deck 28; ringPlan follows automatically); shot 5 → [216.4,30.2,216.4]→[0,40,0].
- requests: bridges → ring-bridge gate towers top at 26 < l1 wall 28 / ring towers 37 (raise); terrain → revetments 3.35 m in front of the analytic face: rock can be flattened there, rock only shows behind sheds.

## city (done r1)
- ring + radial streets, ~3.7k houses, 103 landmarks, colonnaded avenues, racecourse, forum around the fallen head (r 34); sunken shells, ~28k coral slots. registry.city {houses, landmarks, gardens, streets, racecourse, forum}; slots palm/tree/banner/urn/coral. 2.5 M tris, ~540 calls.
- gaps: houses use local materials (not shared stone.js); outer city regular. requests: vegetation → fill registry.city.gardens.
- NOTE: the garden terrace moved to l1 after city built — check the city keeps that zone clear (reads L.GARDEN_TERRACE?).
- 404 on every run (also smoke test): find & fix (core).

## terrain (done r1)
- surface-nets mesher w/ camera LOD in workers; flat ground meshed 5 cm below heightAt (paving shows); limestone faces on ring edges; stepped citadel rock; far bake generated/terrain-far-a5.bin (20 s) following the 344-80° arc (1.4-1.9 km at 9-16 km), WNW-W horizon open sea + far islands, river + lagoon on the plain, boulder islets. Sunken sand: rings to -4, canal to -8.4, drifts, plateau ~35 % patchy; algae on rock. Appended ISLETS, ISLANDS_FAR to layout. registry.terrain {faces, faceRadius, canal, sandAt, sunkenGround, groundAt, uniforms, stats}. 1.6 s / 9 M tris high.
- gaps: close rock a bit crumpled; far mountains flat & dark under shot-1 look (registry.terrain.uniforms).
- requests: rings → in shot 4 walls/sheds cover the whole face; seat walls on the rim and show rock below (ref 4); underwater → uSkSand 0.9 → 0.3-0.4 (done by director? see below).

## marine (done r1)
- corals (brain, table, whorl, finger, staghorn, bush, soft-tree, whip, tube/barrel sponges, anemones, urchins, sea fans atlas, sea grass), giant kelp (blade-card atlas, sway), cypress-like algae columns; fish schools (streams/mills, glints), reef fish, manta, turtle — analytic motion. GPU top-down surface map for placement + edge growth + slots; fauna anchored to shot frames. registry.marine {root, U, stats, mtris, bySpecies, fish}; ReefLibrary.place/finalize(budget). High: 28k growth, 22k fish, 15 M tris (capped).
- gaps: close coral low-poly/toy-like; colour at 33 m washed teal (CORAL_GLOW 0.3); turtle silhouette; ~9k of 29k coral slots used. shot 9 not rendered after surface change.
- requests: underwater → keep warm colours readable at 30-50 m; city → fewer, larger slots; everyone → vertical-face slots; director → final cameras for fauna anchors.

## sets (done r1)
- shot 8: SDF Poseidon head (~9 m, beard, wavy hair, gold 9-spike crown, 3 broken) fitted to ref-8 landmarks (~22 px), broken trident, 8 banded columns w/ gold capitals, trident mosaic, rubble, drifts. shot 5 terrace on L.GARDEN_TERRACE (checker paving, balustrade w/ medallions, 3-col banded portico, brazier). shots 3/6 stair-head piers. bake `node tools/bake.mjs sets` (28 s, 104 MB). registry.sets {keepClear8, mosaic8, tridentHead, terrace, stairTop}. 2.5 M tris high (shot 8).
- director done: shot 8 → [147.9,15.83,374.6]→[137,16.18,357.84]; shot 5 target [202.25,28.8,202.25].
- requests: marine → respect registry.sets.keepClear8 (coral oversized, covers the face); underwater → warm colours lost at ~50 m depth, ref 8 keeps them.
- gaps: head darker/less detailed than ref 8; bronze/verdigris balance; mosaic contrast low; no background arcade.
