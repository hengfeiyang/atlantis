# Round 3 notes (collected from round-2 reports)

## arch-a (done r2)
- gate towers wider (x ±28-49), body top 50, taller colonnade, lower dome, redrawn trident (tips 74.5 < 78); ring-bridge towers top = max(deck+14, wallTop+11.5) (l1 side 39.5); shed fronts = rounded limestone crags, wall sits on cliff (shot 4); crenellations → marble balustrades + gilt urns; l1 towers pylons (ref 4); citadel shore towers tholoi; citadel shore wall white marble + gilt frames, orichalcum only a frieze band (director ACCEPTED: refs 1/4/5 show the red tiers higher up the hill — temple/citadel ramparts carry the red); bastion faces pilasters/niches; banners in front of mouldings; canal near stoas start z 762 (viaduct arches show), blind red arcade on embankments. rings 3.29 M / bridges 2.11 M tris golden.
- open: ref-1 moles still plain piers (no towers along them) → r3.
- forwarded to director: shot 7 pull back (tower tops cut); shot 4 l1 shed face in citadel shadow at sun az 292 (ref 4 sunlit) — director/look-golden; shot 5 ring bridges not in frame.

## director r2 interim (relayed)
- SUNKEN.surface 78 → 87 (ref 9 solve). Gate-tower tips may go to ~85 (arch-a finished at 74.5 → r3 raise if refs want).
- TEMPLE 54×100, centre z -16 (front z 34); L.STAIR_HEAD landing y 50 z 97-104 + north flight into the court (z 79, y 45) → arch-b; L.FORECOURT.rose {center [0,72], r 6.5}; FOUNTAINS (±26,45,62) r 8; NEREIDS count 5 → 4 corner basins.
- MOLES shortened, lighthouses at z 930 (rings reads layout — verify at r3 integration).
- SHIPS.hero → [-13,0,795] heading 200; SHIPS.wreck → [-15,790] heading 198 (ships module reads layout — verify).

## marine-fix (done r2)
- src/marine/keep.js keep-clear (keepClear8, trident shaft, per-shot screen-space no-go boxes: face/trident/mosaic s8, arch s7, temple s6/s9; growth within 14 m of lens shrunk); src/sets/dress8.js 41 hand-placed reef items at ref-8 pixels; kelp frames the s7 arch at the edges, back-light glow; corals: lettuce rosettes, finer fingers, mid LOD 18-45 m, softer colour, distance glow; s8 head brighter verdigris + polished bronze highlights + gold traces, cleaner banded columns, punchier mosaic; backdrop8.js ruined banded arcade + 2 gilded-dome towers; sets bake names stable (no 404s). marine 15 M tris capped (far thinning 0.38).
- still off: red bands / verdigris go black-blue past ~15 m (ref 8 keeps maroon/green); shot 6 coral pale at ~48 m; trident not crusted.
- requests: look-sunken → lighten red absorption at 15-25 m; arch-b → crusted variant of sunken gold.

## look-sunken (done r2)
- far term OD = σ·s·(1+s/Lf): crisp to 60-80 m, silhouettes 150-250 m, gone ~300 m; σ (0.013,0.006,0.005); warm colours hold ~20 m; lighter verdigris, less dulled gold; god rays occluded via ortho depth map from the refracted sun (per shot); broader beams; caustics second rotated lookup (no 32 m repeat), deeper, sharper; less sand dust on paving; looks 6-9 (6/9 low sun slanted shafts, 7/8 high), clearer water 7/9, UW_HUE cyan→blue.
- colorstats |dL|/|dSat|: 6 14.8/13.6→9.7/11.2; 7 18.9/22.2→14.8/6.6; 8 15.7/16.7→10.9/7.1; 9 not comparable (new cam + surface 87).
- gaps: shot 6 coral colour low + slightly cyan; shot 7 ceiling darker than ref, fish school veils the bridge; shot 9 water half greyer / lower contrast; grain at 12 spp (→ video spp / denoise).
- requests: water → brighter ceiling from below (uDeepUp); marine → thin shot-7 fish school in front of the bridge; look-golden → re-check looks.js entry 2 (a comment swallowed closing braces for a while). Golden byte-diff NOT done → verify at integration.

## arch-b (done r2)
- QEM decimator src/sculpt/decimate.js in all heavy statue bakes (STAT_VERSION 2, ~6 min sequential): horses 440k→115k, statues 3.1 M golden (was 7.0) / 2.3 M sunken. Swept-back wing variants, no overlaps. Nereids: skirts, train, mantle, stouter dolphin heads; lower wave crests.
- chariot pedestal 24×15×5.4 (PED) w/ dark steps, gold dolphin frieze, relief panels — temple columns visible behind. Built: north flight from STAIR_HEAD (29 steps, cheek walls, braziers/urns), FORECOURT.rose, new basins/fountains, 54×100 temple. 'pinnacle' slots + gold figures (back pediment corners + 4 × 22 m HONOR_COLUMNS).
- goldMaterial({crust, crustScale, crustColor}) (any metal kind) → r3: sets trident (src/sets/trident.js) should use crust.
- city brighter cream plaster, more gold kiosks/towers/tholoi; sunken coral slots merged 21k→12k + 2.2k wall-face.
- gaps: shot 1 city grey/shadowy (grade); shot 5 camera looks at a wall; Nereids smaller than ref 3.
- requests: director → north-flight steps in the shot-3 foreground; look-golden → city shadow fill. stat-*-v1.bin unused (cleanup).
- look-sunken follow-up: extinction (0.0095, 0.006, 0.005), uUwFar; red absorption lowered (shot 8 banded columns read maroon); caustic focus 0.2; overlay less dust/verdigris/dulling. Stats now 6 10.1/11.1, 7 14.5/7.3, 8 10.9/6.9, 9 14.9/13.5. Shot 7 bridge now 119 m from the camera (director cam). Gaps: shot 9 water half teal-grey; overall too cool (shot 6 warmth -40 vs ref -30); ceiling from below darker than ref 7; shot 6 foreground plaza still sand-covered (terrain sand on the plateau → r3). Requests: water uDeepUp brighter TIR ceiling; terrain less plaza sand at shot 6.

## look-golden (done r2)
- blocky clouds fixed (march step capped in metres, grows with distance; sky.js + clouds.js), clouds restyled (thinner, white-peach, gold rims, violet shading, thin toward horizon). Tone map AgX → neutral (Khronos), neutral WB; bluer sky away from sun, gold glow near it; uHuePreserve; sun disk on each ref's sun pixel; gold glitter; shot 1 lifted cooler shadows; mountains lit by the real light; looks.js gained `terrain` and `water` keys (applied from clouds.js).
- colourfulness/sat now near refs (1: 57/46 vs 60/44; 2: 63/47 vs 67/45; 3: 63/49 vs 64/46; 4: 65/45 vs 62/41; 5: 62/51 vs 64/51).
- still off: shot 4 too cool (ring water lacks gold reflections); shot 1 mountains flat/grey.
- requests: water → stronger reflections of lit buildings in rings/canal; terrain → warmer, more detailed far rock.
