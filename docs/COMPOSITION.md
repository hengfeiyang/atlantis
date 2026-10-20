# ATLANTIS — Composition (director, round 2)

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

## Cameras (final, round 2)

| shot | pos | target | fov | rms px | landmarks / notes |
|---|---|---|---|---|---|
| 1 | (7.09, 224.31, 1353.97) | (5.77, 195.85, 1258.11) | 40 | 36 | lighthouses, gate towers, temple apex/stylobate, colossus + horizon (ours row 87, ref 128) |
| 2 | (0, 5, 846) | (-10.7, 13.2, 746.8) | 41.4 | 23 | gate-bridge springs/crown/deck/tower axes, eye 5 m |
| 3 | (9, 54, 98.5) | (-18.27, 48.77, 2.43) | 46.5 | 19 | temple corners; pitch -3 to show the north flight at the bottom |
| 4 | (134, 2.5, 232.09) | (176.16, 9.48, 141.68) | 44 | — | composed (see 9) |
| 5 | (297.5, 30.2, 52) | (211.74, 16.28, 2.49) | 56 | — | composed (w1 too narrow, see below) |
| 6 | (9, 54, 98.5) | (-18.27, 48.77, 2.43) | 46.5 | 20 | = shot 3 (era dissolve); 28 incl. the broken right cornice |
| 7 | (-10.74, -6, 820) | (-10.31, 15.32, 722.3) | 43.1 | 30 | towers/deck/tips, excl. the arch crown |
| 8 | (147.9, 15.83, 374.6) | (137, 16.18, 357.84) | 44 | 22 | unchanged (sets r1 fit on the head) |
| 9 | (3.54, 87.15, 88.64) | (-2.86, 58.98, -7.09) | 62 | 21 | eye at surface 87, horizon row 205 |

## What still differs (and why)

* **Citadel too low / not steep (refs 1, 2, 4, 5).** Every golden reference shows the temple standing ≈ 2-3× higher
  above the rings than ours (ref 1 apex residual 52 px, ref 2 temple hidden behind the bridge, ref 4 temple hidden
  behind the quay palaces from water level, ref 5 red wall band sits at the horizon). Fixing it needs summit
  45 → ≈ 65-70 with a concave, steep profile — but the sunken refs pin the ridge ≈ the gate-tower tips (ref 7) and
  11 m under the surface (ref 9), so raising the hill pushes the whole sunken city 20-25 m deeper. Not done in r2:
  **decision for round 3** (proposal: summit 62, plateau r 85, terraces 50/34, SUNKEN.surface 104, gate towers +15).
* **Ring widths (refs 1, 5).** Ref 1/5 rings are proportionally narrower outside and w1 is ≈ 3× wider than ours
  (70 m); l2 (260 m of houses) dominates shot 1. Round-3 candidate: w1 230-330, l2 narrower.
* Ref 3/6: horizon row ≈ 400 vs 310 (eye kept at person height on the landing); chariot group still covers most of
  the colonnade (horses' wings reach the architrave; ref horses top ≈ mid-column).
* Ref 2: arch springs ≈ 6 m above water in ref vs 3 m; ref 7 arch crown ≈ 9 m below the deck vs ≈ 1 m.
* Ref 4: no tunnel portal at the w1-90 bridge; citadel quay palaces hide the hill; the l1 face reads as grey lumps.

## Requests per module (round 3)

* **look-golden**: shot 4 sun — the light from az 292 leaves the l1 face in the citadel's shadow; use a shot-4 sun
  from ≈ az 200-230, el 12 (light on the l1 inner face at bearing 100-150) and place the visible disk top-left; shot 5
  sun disk top-left (camera heading 300).
* **look-sunken / marine**: surface now 87 — shot 6/3 camera (9, 54, 98.5) is 33 m deep, temple front 79 m away;
  shot 7 bridge front 119 m away (needs legible silhouettes); shot 9 temple front ≈ 69 m below/ahead.
* **arch-b (temple/statues)**: chariot horses ≈ 0.7× height or the group lower (wing tips below the capitals, ref 3);
  the citadel quay palaces facing w1 at bearings 100-180 lower (≤ 8 m above the quay) so the hill and terraces read
  from shots 4/5; red wall band around the plateau rim (ref 5: 20 m tall, x ±80 m).
* **arch-a (rings/bridges)**: tunnel portal through l1 under the l1 end of the w1-90 bridge (shot 4, ref 4); gate arch
  springs at ≈ 9 m (ref 2) and a deeper spandrel (crown ≈ deck - 8, ref 7); l1 inner rock face at bearings 30-90.
* **ships**: hero (-12, 0, 806) heading 200 — bow wave/foam bigger (ref 2); keep moored triremes inside the sheds at
  bearings 140-160 (they stick out into w1 in front of the shot-4 camera).
* **sets**: terrace frame5() still assumes fov 44 / pitch -4; shot 5 is now fov 56 / pitch -8 at the balustrade.
