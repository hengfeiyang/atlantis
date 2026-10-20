# ATLANTIS — Composition (director, rounds 2-3)

Owner: director. Cameras live in `src/world/shots.js`, the master plan in `src/world/layout.js`, the near-field
terrain in `src/world/heightfield.js`. Pixels are reference pixels (1672 × 941); "rms" = root-mean-square
distance (px) between the reference landmarks and the same world points projected by our camera.

Tools (out/director/): `cam.mjs` (pinhole camera identical to engine.applyShot: project / ray / Levenberg-Marquardt
fit of pos, yaw, pitch, fov with pinned params and penalties such as "sea horizon at row v"), `fit<N>*.mjs`
(per-shot landmark sets), `search4*.mjs` (brute-force bearing search for shot 4), `plans.mjs` / `temple_anchors.mjs`
(world landmark coordinates from bridgePlan / poseidonTemple). Session: `node tools/session.mjs --port 9471`.

## Running log (newest last)

1. **Ref 3/6/9 temple proportions.** The free fit to the ref-3 temple corners (apex, cornice ends, corner column
   top/base) left 27 px rms with a systematic error: the reference columns are 0.31 × the facade width, ours 0.38.
   → `TEMPLE.width 46 → 54, length 92 → 100, centre z -12 → -16` (front podium face stays at z 34, front columns at
   z 19.6, ridge 75.6 → 76.8). Temple fit from the stair head drops to 9-11 px.
2. **Ref 3 vantage.** The sea horizon (row 310) and the visible column bases put the ref-3 eye 8-11 m above the
   stylobate and the plaza is seen from above (mosaic ellipse ≈ 10°); our stair head was at plaza level (eye 48,
   plaza edge-on). → new `STAIR_HEAD`: a landing at y 50 (z 97-104) 5 m above the court, the grand stair now starts
   on it (`CITADEL_STAIR.from = [0, 50, 97]`), and a broad north flight descends from it into the court (z 97 → 79).
   heightfield.js raises the ground under landing + flight (`stairHead()`); the temple module must build the flight.
   Eye 53.5 (3.5 m above the tread), horizon at row ≈ 470 instead of 310 (compromise: a higher landing would put the
   flight out of sight from a person-height eye).
3. **Forecourt compaction (ref 3/6).** From the landing camera the chariot group at z 56 covered the whole temple; ref 3
   shows it overlapping the lower colonnade only. → `CHARIOT z 56 → 46`, `FOUNTAINS (±30, 78) r 9 → (±26, 62) r 8`,
   `NEREIDS {centre z 47, r 24, count 5}` (4 basins: two at the pedestal front corners (±14, 66), two beside it
   (±23, 40); none on the axis), new `FORECOURT.rose = {centre [0, 72], r 6.5}` (was hard-coded [0, 94], now under
   the landing).
4. **Ref 9 depth.** Eye at the surface, horizon at 22 %: every fov gives an eye ≈ 11 m above the temple ridge
   (the ridge is seen 9° below the horizon while the facade spans 43°). With the surface at 78 the ridge was 3 m under
   the camera. → `SUNKEN.surface 78 → 87` (ridge 76.8 ≈ 10 m under water). Gate-tower tips (74.5) are 12 m under.
5. **Ref 1 moles.** The lighthouses in ref 1 stand just off the outer ring; ours were 230 m out to sea, which forces a
   5-7° telephoto from 3.7 km. → `MOLES` end at z 930 (was 1050). Fit with a sane camera rms 38 → ≈ 28 px.
6. **Ref 2 hero ship.** Triangulated from the shot-2 camera: mast ≈ 50 m ahead-left, bow toward the camera-left →
   `SHIPS.hero {pos [-13, 0, 795], heading 200}` (was [-16, 0, 862], i.e. behind the camera).
7. **Ref 7 wreck.** Bow near-left, stern receding toward the left pier → `SHIPS.wreck {pos [-15, 790], heading 198}`.

8. **Ref 5 terrace.** From bearing 135 the terrace looked straight at the citadel quay palaces (76 m away) and no
   ring bridge was in frame. → `GARDEN_TERRACE.bearing 135 → 100`: the w1-90 bridge now recedes from the bottom right
   toward the citadel (sets/props/rings/city/vegetation all follow L.GARDEN_TERRACE).
9. **Shot 4**: no pinhole camera fits ref 4 — its bridge+tunnel sits ≈ 25° right of a front-lit temple, which no point
   of water ring 1 sees with bridges at 0/90/180/270 (brute-force search `search4b.mjs`). Composed by eye instead.
10. Verified after arch-b's rebuild: the north flight, 54 × 100 temple, rose at [0, 72], 4 Nereid basins, hero
   trireme at [-12, 0, 806] (moved 11 m closer after the first check), wreck, moles at 930 all land as planned
   (final `--shot all --quality high --spp 12`: no errors).

### Round 3a (director, structural layout pass) — fit scripts in out/director/r3/ (fit1/2/3f/5b/9, aim4*), renders out/director/r3/

11. **Citadel raised** (refs 1, 2, 4, 5): `CITADEL.summit 45 → 62`, terraces `{114-160 @ 42}, {178-198 @ 22}` (was 150-172 @ 32,
   192-208 @ 18): the plateau rim now drops 20 m over 4 m (r 110 → 114, a sheer retaining wall = the red rampart band of
   ref 5), then 48° / 50° rock slopes to the ledge 2 and the quay (3). Plateau radius 110 kept (temple, forecourt,
   tholoi, honour columns, towers all need it). Everything on the citadel reads the layout; verified in renders
   (palaces on both ledges, ramparts, 40 cascades traced from the new heights, honour columns, stair, plaza, statues,
   fountains/jets, vegetation, props, the w1 bridge approaches to ledge 2, terrain mesh bake key = layout hash).
   **Code fixes outside layout**: `src/modules/temple.js` buildStair riser now adapts to the stair slope (0.24 → ≤ 0.34;
   the fixed 0.24/0.5 step capped at 25.6° and would have ended ≈ 10 m above the quay); temple test stand-in hill
   reads `CITADEL.terraces` (was hard-coded 32/18).
12. **Sunken surface 87 → 104** (same 42 m over the plateau: the ref-9 depth relation is kept).
13. **Stair head / forecourt (refs 3, 6 horizon)**: landing `STAIR_HEAD.y = summit + 13 = 75`, eye 79 → sea horizon row 314
   (ref ≈ 310, r2 ≈ 400-470). Back-projecting ref 3 from that eye puts the flight foot at z ≈ 64 and the rose at z ≈ 60,
   so: north flight z 97 → 68 (13 m, ≈ 24°), `FORECOURT.rose [0, 60] r 5.5`, `NEREIDS.radius 24 → 20` (basins (±11.8, 63.2),
   (±19, 40.8)), `FOUNTAINS (±31, 57)`. `CITADEL_STAIR.from = [0, 75, 97]` (72 m drop to the quay, ≈ 30°).
14. **Colossus pedestal 22 → 30** (feet at the temple ridge ≈ 94, refs 1, 4, 5). Trident (2.75 fig units × 15 = 41 m) tip ≈ 133.
15. **Ref 9 surface breakers**: (a) sunken colossus = the figure is gone (head = ref-8 set) but its gold trident still stands
   in its socket on the pedestal (slight lean, rubble of the feet), tip 132.6 = 29 m above the water — **statues.js
   `buildSunkenTrident()`** (new, `L.SUNKEN_TRIDENT`); (b) two citadel towers `L.CITADEL_TOWERS` (±54, -84), 9 m, white
   podium stage + slender upper stage, roof 110, tholos + trident tip ≈ 121 (golden: refs 4/5 white towers beside the
   temple; sunken: broken trident, missing tholos columns, ≈ 6-17 m above the water) — **new `src/bridges/pinnacles.js`**
   (gate-tower kit), called from `src/modules/bridges.js` (registry.bridges.citadelTowers; coral slots above surface-1.5 dropped).
16. **Water ring 1 widened**: `w1 230-300 → 230-350`, `l1 300-440 → 350-440` (outer rings unchanged), `SEA_CANAL.z0` /
   `CANAL_TUNNEL.z0 300 → 350`. Ref 5 puts the citadel shore 135-200 m from the terrace (r2: 78 m). w2 and beyond, the gate
   bridge, moles, ships, fallen head (r 392, still mid-l1) and shot 8 untouched; ring bridges w1 span 120 m (bridges plan
   follows), sheds/walls/city/terrain/water follow the radii. Cost: shot 4's "narrow channel" is gone (see 18).
17. **Garden terrace bearing 100 → 198, r 352** (ref 5): the ref sees the temple FRONT with the colossus straight behind it,
   only possible from the south (fit 33 px vs ≥ 110 px from bearing 100). Bearing 190 fits 22 px but the grand stair +
   stair head then hide the temple. City clearance circle, vegetation, rings bastion and the terrace set all follow.
18. **Shot 4** re-composed (still no pinhole solution, the ref's temple/bridge separation of 15° is ≥ 45° from anywhere in
   w1): bearing 163, r 336, eye 2.5, heading 5, fov 54 — the raised hill with tiers / cascades / grand stair fills the
   left half, w1-90 bridge right of centre, l1 face at the right edge. From water level the temple colonnade is hidden
   by the plateau rim (mesa top; only visible beyond ≈ 1.6 km) — accepted. Sun `sunRel(4, -60, 18)` → az ≈ 305: clears
   the citadel (ray ≥ 78 m over the rim) and lights the l1 inner face frontally.
19. Golden + sunken full world builds: no errors / warnings (sessions 9481 / 9482).

## Cameras (final, round 3a)

| shot | pos | target | fov | rms px | landmarks / notes |
|---|---|---|---|---|---|
| 1 | (7.35, 222.72, 1383.72) | (6.05, 196.16, 1287.32) | 38 | 29 | lighthouses, gate towers, apex/stylobate, colossus head + horizon w 1 (ours row 94, ref 128). r2: 36 |
| 2 | (0, 5, 846) | (-10.7, 13.2, 746.8) | 41.4 | 23 | unchanged; the raised temple now shows in the arch (row ≈ 438, ref's arch temple ≈ 440) |
| 3 | (12, 79, 98.5) | (-17.68, 65.3, 3.99) | 45.1 | 16 | temple corners, horizon row 314 (ref 310); flight + rose + Nereid basins as in ref |
| 4 | (98.24, 2.5, 321.32) | (106.9, 12.95, 222.25) | 54 | — | composed (item 18); sun az 305 / el 18 |
| 5 | (-108.77, 30.2, 334.77) | (-97.98, 13.08, 236.84) | 56 | 33 | apex, cornice, colossus head + horizon 295; terrace set follows (shotForward) |
| 6 | (12, 79, 98.5) | (-17.68, 65.3, 3.99) | 45.1 | 29 | = shot 3 (ref 6 temple drawn ≈ 8 % narrower) |
| 7 | (-10.74, -6, 820) | (-10.31, 15.32, 722.3) | 43.1 | 30 | unchanged (gate bridge unchanged); now 110 m deep |
| 8 | (147.9, 15.83, 374.6) | (137, 16.18, 357.84) | 44 | 22 | unchanged (head stays in l1, r 392) |
| 9 | (3.54, 104.15, 88.64) | (-2.86, 75.98, -7.09) | 62 | 21 | r2 solve + 17 m; trident at px ≈ 900 (ref 1055), towers ≈ 640 / 1120 (ref 655 / 1235) |

## What still differs (and why)

* Ref 1: our temple is ≈ 1.8x smaller at 1.4 km than the ref's (ref 3/6/9 fix its size); l2 houses still dominate.
* Ref 2: the ref's hill stands ≈ 265 m above the canal (impossible) — ours shows through the arch only.
* Ref 4: no pinhole fit; the sheds are far (120 m w1); temple colonnade hidden from water level by the plateau rim.
* Ref 5: bridge citadel end appears right of the temple (any radial bridge does from the left side); the w1-180 bridge is
  just off the right edge; the grand stair is a huge plain slope in frame.
* Ref 9: trident ≈ 150 px left of the ref's; tower tops read as plain boxes above the water.
* Sunken: shots 7/8 are now 110 / 88 m deep (surface 104) — auto levels hold, look-sunken should re-check.

## Requests per module (round 3)

* **arch-b (temple / statues)** — shots 1, 3, 4, 5, 6: (1) the t1 rampart at r 115.4 must be the ref-5 red orichalcum band:
  height 11 → ≈ 21 (y 42 → 63, i.e. it IS the plateau retaining wall), red with gilt panels and towers; ledge-2 rampart
  (r 179.2) h ≈ 12; (2) the grand stair (x ±17, z 104 → 226, 75 → 3, ≈ 30°) reads as a plain grey slab in shots 1/4/5:
  break it into flights with landings (every ≈ 12 m), planted cheek terraces, statues/braziers on the landings;
  (3) north flight z 97 → 68 (75 steps, riser 0.17): check risers read in shot 3/6 foreground (bottom 110 px);
  (4) quay palaces facing w1 at bearings 130-180 ≤ 8 m above the quay (shot 4 hill visibility); (5) statues: sunken
  trident (`buildSunkenTrident`, tip 132.6) should use the crusted gold (`goldMaterial({crust})`) and a broken-feet stump
  rising toward the surface (ref 9 shows rubble at the waterline).
* **arch-a (bridges / rings)** — `src/bridges/pinnacles.js` is now yours: give the citadel towers (±54, -84) ref-4/5 detail
  (gold lantern, statues at the parapet corners) and a ruined, legible top in ref 9 (px ≈ 640 / 1120, 6-17 m above
  water); w1 ring bridges now span 120 m — more arches + an intermediate tower pair (ref 5); w1-180 bridge (deck 28) and
  the canal tunnel portal at z 350 seen in shot 5's right edge / shot 4; l1 shed sector 100-160 is now 110-240 m from the
  shot-4 camera.
* **terrain** — the steeper hill (48-78° slopes) renders as black/white blotches (shots 4, 5, aerials): rock + maquis
  colour, less contrast; the 4 m plateau cliff (r 110-114) should be built masonry-like (red wall from arch-b sits on it).
* **water** — cascades now drop 20 m off the plateau cliff + 20 m + 19 m: check ribbons/mist scale (shots 1, 4).
* **vegetation** — no tall trees on the plateau rim r 100-110 at bearings 120-200 (they hide the temple in shots 4/5).
* **ships** — no moored hull/sail within 25 m of the shot-4 camera (98, 2.5, 321); w1 is now 120 m wide (more traffic room).
* **sets** — terrace at bearing 198 / r 352: frame5() fov 44 / pitch -4 vs shot 5 fov 56 / pitch -10; the red pillars are
  cut at the left edge, balustrade should run bottom-left → right like ref 5.
* **look-golden** — shot 4 sun now `sunRel(4, -60, 18)` (az ≈ 305); shot 5 heading 6 (was 300): re-place the disk
  (diskRel 5) and side light; shot 3 heading 343.
* **look-sunken / marine** — surface 104: shot 6/3 camera 25 m deep, shot 7 110 m, shot 8 88 m, shot 9 temple ridge ≈ 10 m
  under; keep coral off the trident / tower tops above the water.
