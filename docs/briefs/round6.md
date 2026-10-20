# Round 6 briefs — detail density and the last mismatches

Read FIRST: `docs/briefs/round6-notes.md` (all round-5 reports + open requests), `docs/COMPOSITION.md`, `docs/CONTRACT.md`,
`docs/ART_BIBLE.md`. Current state: `out/r5/cmp_golden.jpg`, `out/r5/cmp_sunken.jpg`, `out/r5/shotN_cmp.png`, motion
preview `out/video_preview/atlantis_640x360.mp4`. Git repo — do not commit. Same rules, plus: stills are deterministic
now (`engine.frameNo` / `subFrame` / `sampleSerial`) — keep them so; check your work in motion along each segment
(`cameraAt` in src/video/sequence.js); no layout anchor changes (director's).

The user reviewed round 5 and asked for more polish before the 4K film. The remaining gap is mostly **richness**:
the references are packed with ornament, foliage, flowers, gold, water features and small life at every distance;
ours is correct but sparse / clean in places. Each agent: pick the 2-3 biggest visible differences in your scope per
shot (crop ref vs render at the same region: `node tools/crop.mjs --cmp N x y w h`) and close them. Finish with high
renders of the shots you touched (no errors) and a ≤ 250-word report.

## citadel
Shot 3 / 6: temple and forecourt richness (ref 3: pediment full of gold relief, roof tridents/pinnacles, banners
between columns, palms and cypress behind the fountains, waterfalls down the terraces on the right, distant city);
shot 1 / 5: citadel crown (temple + colossus + gold) reading at distance; palaces with more gold and colour.

## arch-a
Shot 4 "treadmill": vary the shed bays (widths, ornament, open/closed, ships, lamps, banners, ivy); shot 2 canal
quays/colonnades richness (ref 2: palms, statues, braziers, fountains spilling from the quay walls); shot 7 towers.

## water
Shot 1 glitter (a white column → warm gold path), sea near the sun warm (ref 1); shot 2 canal turquoise (not navy);
shot-1 fleet wakes shorter and broken (with ships); small fountains/spouts from quay walls in shots 2 and 4 (ref 2, 4).

## ships
Shot-1 wakes (with water: short, broken V wakes instead of contrails); ref 5 shows two sailing triremes — make the
second read; shot 2 secondary ships under sail behind the hero (ref 2 has a busy canal).

## props
Dressing density in shots 2, 3, 5 (ref: braziers, urns with flowers, bougainvillea curtains, banners, lotus pots,
small statues on every pedestal); check every slot has something worth seeing from the shot camera.

## sunken
Shot 9: saturated orange-gold glitter path (`uGlitterTint`), the flat orange horizon band in the sky, peaks too white
(`uFarTint` 2.2 → ~1.5), richer sunken city below; shot 7 kelp clearance along the path + overall clarity/brightness vs
ref 7; shot 8 `set8-farcity` blocks on the sunken mole head (≈ 125, 27, 214), far-city terraces read as flat walls;
shot 6 richness (ref 6: coral on every surface, fish school, far city).

## look-golden
Far haze cooler/lighter at 8-15 km (terrain: mountain shadows ≈ 78,65,61 vs ref 50,61,75); final grade 1-5 at the end
after the others' changes (re-render, colorstats).

## director
Owns cameras / sequence / render-video. Review motion after the others land (re-render the preview near the end),
fix anything that reads wrong in motion (pops, intersections, pacing), confirm segment openings are strong. Prepare
the final render plan: `docs/RENDER.md` with the exact commands for 4K 30 fps (spp, quality, segment order,
resumability, expected time), and an encode with music (the coordinator will supply the track path and credit).
