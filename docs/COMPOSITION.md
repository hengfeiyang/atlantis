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

### Round 4 (director) — announcements first (renders / fits in out/director/r4/)

**A1 (early, binding for everyone): NO citadel-height change in r4.** Fits with the summit raised +10/+20/+30 m improve
shot-1 rms only 26 → 25 → 24 → 23 px (the ref-1 hill is a painter's exaggeration, ≈ 2x taller than physically consistent
with the lighthouses); the cascade through shots 3/5/6/7/8/9 + sunken depths is not worth it mid-round. `CITADEL`,
`SUNKEN.surface`, all radii stay as in r3. Layout is frozen except items announced below.
**A2 shot 1 camera** moves farther back with a longer lens (≈ z 1450-1500, y ≈ 230, fov ≈ 31-34): the citadel grows
≈ 1.15x on screen relative to the lighthouses (which keep their ref pixels); the l2 ring spills off both frame edges (like
ref 1); the sea horizon rises (row ≈ 70-100). look-golden: re-place the shot-1 sun disk after the shots.js commit (coming
soon, watch the shot-1 line); terrain: the mountains then sit 20-40 px higher — judge them on the new camera.
**A3 shot 5** eye +2 m (deck + 4.2 → y 32.2), heading a few degrees right so the w1-180 ring-bridge citadel end + towers
enter at the right; sets terrace follows frameFromShot (ships-sets/props: re-check the balustrade/brazier sizes).
**A4 shot 2** hero trireme (L.SHIPS.hero) farther and more bow-on (ref 2: hull ≈ 380 px long, sail rows 410-635).
**A2 — COMMITTED (shots.js):** shot 1 = `pos [0, 191.86, 1314.2], target [0, 168.25, 1217.02], fov 34.62` (replaces the
"farther / longer" plan: that pushed the horizon to row 60 and lost the sun). Lower + 70 m closer + longer lens: citadel shore
526 px wide (r3 450, ref 490), apex row 223, colossus head 185, horizon ≈ 105, lighthouses rows 600-810, l2 front wall row ≈ 645.
The frame bottom sees the sea only to z ≈ 995 (|x| < 200 at the bottom edge, < 340 at row 600). **Layout (additive):** 4 new
`ISLETS` (bottom-left palm headland [-262, 930] r 52, rocks [-168, 990], [318, 838] against the l2 wall, [205, 982]) — terrain
bake key follows; vegetation palms follow ISLETS. **ships.js (director edit, no ships agent this round):** the ref-1 sea fleet
moved from z 1085-1465 (below the frame) to z 835-1010, |x| < 360.
**A2' — shot 1 FINAL (shots.js, supersedes the A2 numbers):** `pos [0, 191.26, 1332.94], target [0, 167.62, 1235.78], fov 35.15`
(citadel shore 512 px, rim/shore marks 5-24 px; lighthouses rows 575-770, 46-72 px bigger/lower than ref; rms 42 on 14 marks).
**A5 — mountains 0.62x (layout `MOUNTAINS.scale = 0.62`, applied in src/terrain/far.js `scaleMountains()` to a copy of the
baked far grid inside the mountain arc beyond 3 km):** the back range reached the frame top in shot 1 (≈ 7° above the horizon,
ref ≈ 4°). heightAt / far mesh / far texture / cloud banks follow automatically; plain, coast, west islands unchanged.
look-golden + sunken: mountains are lower in shots 2-5 and 9 — re-check the bank clouds / mountain fill there.
**A3 — shot 5 COMMITTED:** `pos [-108.77, 30.9, 334.77], target [-96.5, 12.59, 237.23], fov 58` — eye 2.9 m above the deck (not 4: at
3.4-4 m the eye reaches the pavilion capitals and the entablature/roof drops into the top-left of the frame; the ref-5 columns run
off the frame top, which with our 3.5 m shafts needs an eye ≈ 2.2-3). Temple apex 4 px, cornice 13-16 px; the w1-180 bridge's
citadel end + tower now at the right edge (px ≈ 1600). **src/sets/terrace.js (director edit, no sets agent this round):**
`scaledTerrace(k = eye / 2.2)` moves the balustrade's right end, brazier and lotus pot out by k (same pixels, 1/k size); the
pavilion and the balustrade's left end stay. Still wrong vs ref 5: the citadel is 135-200 m away, the tall quay palaces hide the
temple, the stair is a big white slope (citadel/vegetation: lower quay palaces at bearings 180-215 would let the temple show).
**A4 — shot 2 COMMITTED (layout `SHIPS.hero`):** `pos [-17, 0, 792], heading 188` (bow/stern waterline + sail fit 146 → 60 px).

### Round 4 — video (src/video/sequence.js, tools/render-video.mjs)
New per-segment fields: `push` (horizontal dolly, keeps the eye height — shot 9 stays at the waterline), `range: [e0, e1]` (move
parameter at u = 0/1; default [-0.5, 0.5], e = 0 = reference framing), `xfade` (dissolve into the next segment; encoder honours it).
Sequence (55.4 s): 1 aerial 8.0 s (dolly 150, crane -10) · 2 canal 7.0 (dolly 9, crane 0.8) · 4 sheds 6.5 (dolly 11, truck -2.5) ·
5 terrace 6.5 (truck -1.8 + pan 1.6, range [-0.2, 0.8]) · 3 temple 7.0 (dolly 6, crane 0.5, range [-0.3, 0.7]) → **2 s era dissolve**
→ 6 continues the same push (range [0.414, 1.414], seamless — the city sinks across the cut) · 7 gate bridge 6.5 (dolly 5, crane
1.5, tilt 1) · 8 head 6.5 (orbit -6°, truck 0.6) · 9 split level 8.0 (push 9, ease-out, rests just past ref 9). Preview
`out/video_preview/atlantis_640x360.mp4` (640x360, 1 spp). Motion-preview fixes: shot 5 trucking right ran into the hero palm
trunk (now leftward); shot 3/6 pull-back ran into the stair-head piers (now a push down the north flight, eye ≥ 6 m above the
treads, x 12 → 9.6 between the raking balustrades at x 2 / 13.5); shot 7 dolly 7 → 5 (kelp at the left grew too big).
Still seen: shot 1 move reads slow (1.3 km away); shot 2 hero trireme does not advance (static hull, wake + oars only); shot 7 left
kelp passes close to the lens; shot 3 opens with a stair-head pier block at bottom centre.

### Round 4 — reply to the citadel note (stair head hides the temple in shot 1)
From the shot-1 eye (≈ 8° down) the landing (y 75, z 97-104, ±17 m) occludes the temple up to y ≈ 75 + 66·tan 8° ≈ 84 m, i.e. the
stylobate + lower columns between x ±17. Lowering the landing by 5 m only moves that line to ≈ 79 and re-breaks shot 3/6 (the eye
79 / horizon 314 fit). Not changed in r4 (end of round, all cameras/sets depend on it). r5 proposal: slimmer stair + landing
(width 34 → 24) with the shot-3 eye x 12 → 8 re-fit, so the outer temple columns show beside it in shot 1.

### Round 5 (director) — announcements first (work in out/director/r5/)

**B1 (binding): no layout / radius / height change in r5.** `CITADEL`, `STAIR_HEAD`, `CITADEL_STAIR` (width 34), `SUNKEN`, all
radii stay. The shot-1 stair-head occlusion is geometry (landing y 75 sits 7 m above the stylobate 68, 84 m in front of it: from
any eye whose ray to the temple is flatter than ≈ 6.8° the landing hides the colonnade between x ±17). Narrowing the stair
(34 → 24) would only free one column per side and re-break terrain bake / temple / props / vegetation / stairtop / the new
water channel mid-round → **rejected**. Instead: (a) the shot-1 video move flies IN at near-constant altitude (the ray steepens,
the colonnade rises clear of the landing in the second half of the segment); (b) citadel: keep everything ON the landing's
south edge low (≤ 1.5 m above y 75 at |x| < 20: no tall statues / pylons / braziers there), and the central water channel
breaks the tan stair column (ref 1 has a cascade there, not a stair).
**B2 sequence.js paths change (ships / vegetation / anyone who samples `cameraAt` for clearance or LOD: re-sample after my
commit, watch for "B2 COMMITTED" below):** shot 1 = long horizontal push (≈ 500 m) with the temple tracked on screen (new
`track` move field); shot 3 = the reference framing at u = 0.5; shot 3 → 6 becomes one continuous slow pull-back + rise
(the camera retreats up over the stair head) so shot 6 reaches ITS still framing after the dissolve. `SHOTS[5]` (shot 6
still) will become a point on that path (≈ 3-5 m behind / above shot 3) — a re-fit to ref 6, whose temple is drawn ≈ 8 %
narrower than ref 3's.
**Note for sunken/look:** `src/video/player.js` keeps the sunken agent's `engine.frameNo = si*1000 + frame` line.
**B2 — COMMITTED (sequence.js + shots.js shot 6):** new move fields `track: [x,y,z]` (world point held at its reference screen
direction while the camera travels), `swoop: [a, e1]` (smooth crane-down that levels off at e1), `along: {shot, de}` (segment rides
another shot's path, e shifted by de). Segments: **1** `push 520, crane -15, track temple, range [-0.3, 0.7]` (camera z 1483 → 963,
y 197 → 182: over the fleet, the lighthouses and the l2 wall) · **4** dolly 11 → 14 · **3** `M36 = {dolly 4.5, crane 1.2, swoop [3, 0.6],
zoom 0.03, track [0, 80, 20]}`, default range (ref 3 at u = 0.5; opens 2.3 m higher, no stair-head pier) · **6** same M36,
`along {shot 3, de 5/7}` (identical camera through the 2 s dissolve; ref-6 still at u = 0.5) · 2, 5, 7, 8, 9 unchanged; 55.4 s.
**Shot 6 still moved:** `pos [11.046, 78.337, 95.462], target [-18.069, 65.55, 0.649], fov 47.033` (3.3 m ahead of / 0.7 m below shot 3;
ref-6 temple rms 29 → 27 px). Sunken (marine coral-by-camera-ray, sets/precinct) and vegetation LOD: re-sample from SHOTS / cameraAt.

### Round 5 — citadel note (stair channel + stair head; follows B1, no layout change)
* **Stair water channel (for water):** pure `stairChannelPlan()` exported from `src/modules/temple.js` (usable before the temple
  builds) = `registry.temple.stairChannel` after it: `{ x 0, half 3.0 / width 6.0, wall 0.55, rim 0.5, lip 0.22, pools[k]{za, zb,
  floorY = landing y, crestY = floorY + 0.22, rimY}, chutes[k]{za, zb, ya, yb, n, riser, tread} (floor = the treads, one weir per
  riser), quay{za 226, zb 230.4, floorY 3.2, crestY}, floor(z), surface(z), source{pos [0, 75.33, 104.45], dir}, spout{pos [0, 3.41,
  230.85], dir +z, dropTo 0}, path = points (494 floor corners, top → bottom) }`. A RAISED trough on the stair axis (never below the
  heightfield stair line): pools on the 6 landings (turquoise tile floor), stepped chutes on the flights, a low shell stele source on
  the top landing, a trough across the quay ending in a spout lip over w1.
* **Stair:** the walking stair is 25 m (`STAIR_WALK_HALF` 12.5) inside the unchanged 34 m `CITADEL_STAIR` corridor; the freed 4.5 m per
  side are deeper planted cheek beds (two tree rows, soil visible — the old coping slab covered the beds); inner dividers gone.
  Stair head (B1 b): no brazier pedestals on the stair head, no statue / brazier on the top landing, source stele ≤ 1.32 m.
  Tier-1 + tier-2 rampart towers flanking the stair removed (they made the stair + towers one column in shot 1, the tier-1 west one
  stood in front of the temple in shot 5). Tier-1 parapet = 0.4 m curb at bearings 151-171 / 189-209 (shot-5 sightlines to the
  temple cross r 115.6 at 185-205): the temple shows ≈ 3 m lower; the plateau rim itself still hides it below y ≈ 73 from that eye.
* Shot 5 occluders (raycasts): no quay palace hides the temple — the tier-1 parapet (fixed above), the stair head + upper cheek beds
  (right quarter of the temple, px 1067-1108: only a narrower STAIR_HEAD would free it). Shot 4: the temple ridge projects below the
  plateau rim from the 2.5 m eye (camera); the hill between px 290-980 is hidden by the shed-mole bridge head (arch-a), not the
  citadel; tier-2 terrace planting is low (shrubs / olives) at bearings 118-178.
**B3 shot 5:** `range [-0.2, 0.8] → [0, 1]` — the segment OPENS on the ref-5 framing and trucks left (at e = -0.2 the hero palm trunk
filled ≈ 150 px of the right edge — vegetation report). **Shot 4 (reply to citadel):** not changed. From any w1 eye the line over the
plateau rim (y 62, ≈ 222 m away) reaches the temple ridge (≈ 118 m beyond the rim): seeing the entablature needs an eye ≈ 37 m up or
a camera ≥ 290 m from the rim (inside l1) — the ref-4 hill-top temple is not reachable from water level; the hill tiers / cascades
/ stair carry the shot (arch-a: lower mole-bridge head, px 290-980).
**Motion preview r5** (out/video_preview/atlantis_640x360.mp4, 640x360, 2 spp; r4 kept as atlantis_r4_640x360.mp4): shot 1 now a
fly-in over the fleet → lighthouses → l2 gate (temple fixed on screen); 3 → 6 dissolve pixel-aligned (same camera, checked at
t = 30.8 s); shot 6 reaches its still at u = 0.5. Still visible: shot-1 fleet wakes are long straight white streaks (contrails) —
ships/water; shot 3/6 the ref-3 right pier passes the bottom-right corner (ref has it too); shot 4 reads as a treadmill (shed bays
repeat; parallax only from the hill); shot 7 kelp at the left edge in the second half.
High stills r5: out/director/r5/final_s1-9.png (+ _cmp), montage final_all.jpg — 9/9 rendered, no errors.

### Round 6 (director) — render plan, tooling, music, motion (work in out/director/r6/)

**C1 tooling (tools/render-video.mjs):** `--spp-seg "1:32,9:32"` per-segment spp; `--frames a-b` timing window; `--no-encode`;
frames written atomically (tmp + rename) and checked for a complete PNG (IEND) on resume; each segment's intermediate
(`partNN.mp4`, x264 CRF 10 yuv444p) is encoded in the BACKGROUND when its last frame lands and recorded in
`partNN.done.json` (frames, size, spp, bytes) → completed segments are skipped on resume; `--prune-frames` deletes a
segment's PNGs after its part is verified (ffprobe frame count) — needed: 4K PNG ≈ 20 MB × 1890 = 38 GB, the disk had 41 GB
free; disk warning at start. **ffmpeg here has no drawtext** (the old `--title/--credit` path would have crashed the encode):
text cards are now PNGs rendered by headless Chrome and concatenated after the picture fade-out; `--credit "a|b"` or
`--credit-file audio/CREDITS.txt`. Music: `--music` must exist (exit 2 otherwise), `--music-start/--music-fade-in/--music-fade`,
apad if short, two-pass LINEAR loudness (measured → `--lufs` -16) + -2.5 dBFS limiter (single-pass loudnorm had squashed
LRA 15 → 5.5 LU, flattening the triumphant ending).
**C2 4K timing (M3 Ultra, 3840x2160, 16 spp, 5 other GPU sessions open):** shot 1 2.8 s/frame, 4 2.0, 6 3.0, 9 4.0 → plan
24 spp ≈ 2.3 h for 1890 frames (docs/RENDER.md). Full 4K encode path (9 parts + dissolves + card + music + 1080p) tested: 5 min.
**C3 music:** "Long Road Ahead" (Kevin MacLeod, CC BY 4.0) from 53.5 s: shot-3 cut on a phrase dip (78.3), the era dissolve on
the section boundary at 83 s (the phrase dies away as the city sinks), shot 8 on the 95.5 boundary, the triumphant final section
swells in exactly as shot 9 (split level, sunset) completes its dissolve (film 48.0 s), picture ends on the bar at 108.75,
fade over the 4 s credit card. Analysis script `out/director/r6/music_analyse.py`.
**C4 shot 5 move:** `truck -1.8, pan 1.6` → `truck -0.45, pan 3.0, dolly 0.4` (range [0, 1] kept, opens on the ref-5 framing): the
r5 truck ended with two bougainvillea columns covering the left 40 % of the frame; dolly-in variants pushed the bronze urn into the
lens. Path stays inside the r5 envelope (vegetation/props clearance unaffected).
Tools: `out/director/r6/vframe.mjs` (render any video frame in a running session with a temporary move override),
`out/director/r6/popscan.py` (per-segment consecutive-frame difference spikes = pops).
**C5 motion preview r6** (rendered 00:44 after the last world change; 640x360, 2 spp): `out/video_preview/atlantis_preview_music.mp4`
(59.4 s, music + credit card) and silent `atlantis_640x360.mp4` (55.4 s; r5 kept as `atlantis_r5_640x360.mp4`). Pop scan: no spikes in
any segment; 3 → 6 dissolve still pixel-aligned (t = 30.8 s); shot 5 now calm; shot 4 shed bays vary (arch-a). Still visible: shot 7 two
kelp stalks sweep from centre-right to the right edge during the dolly (parallax, sunken's placement — ref 7 has kelp framing both
sides; dolly kept at 5 m); shot 6 opens with the broken stair-head pier at the bottom right (ref 3/6 have it). Disk: the shared volume
fell to 3 GB free during the round (other projects' /private/tmp) → RENDER.md `--prune-frames` + the `--min-free` pause.

### Round 7 (director) — announcements first (work in out/director/r7/)

**D1 (binding, colossus in shot 3): HIDE it for shot 3 only** (golden era; `engine.onShot`, `visible = shot.id != 3`).
Ref 3 shows nothing above the pediment apex but the apex trident; ours shows the colossus' upper body cut by the pediment
(reads as a seated rooftop statue). Moving / scaling it would re-break refs 1, 4, 5 (the figure right behind the temple)
and the sunken trident position of shot 9 → rejected. Hiding covers the whole video segment 5 (shot 3, applyShot is called
once per segment) and the still; shot 6 is sunken (the figure is gone, the stump + trident sit below the ridge line from
that eye) → unchanged. **Implemented by the director** (src/modules/statues.js `buildColossus`, one onShot hook, tagged
"r7 director D1") — citadel: please do not move / rescale the colossus or the pedestal; the shot-3 apex skyline is now the
apex acroterion + tridents only (if you add ornaments there, keep them within the ref-3 silhouette).
**D1 verified** (out/director/r7/s3_d1_cmp.png, high 8 spp): apex skyline = acroterion + corner tridents, the chariot Poseidon's
trident is the only figure above the roof (as ref 3).
**D2 (shot 3 right side): no camera change.** Tested pan +3° / +6°, crane +4 m, crane +8 m & pan +4°
(out/director/r7/s3v_sheet.jpg, top-left ref): right of the temple a pan only adds the NE pinnacle tower, a column and the flat
plateau / far plain; a crane shows more plateau roofs and domes — the ref-3 cascades + terraced city lie below the plateau rim
from any eye near the stair head (rim y 62, eye 79-87). Both break the r3 temple fit (rms 16 px) and the 3 → 6 path. The ref-3
right side is a world feature (a stepped cliff with falls right of the temple), not reachable by the camera → open for after
the film; not attempted in the last round.
**QA pass A (01:05, mid-round snapshot with D1; out/director/r7/qaA/, strips qaA_strip_segNN.jpg = a frame every 0.5 s,
640x360, 2 spp; tool out/director/r7/strips.sh):** pop scan (r6 popscan.py) clean in all 9 segments; paths unchanged.
Seen: seg 3 (shot 4) the stair water-channel pools read as bright white diagonal bars on the hill (sky reflection, same as r6);
seg 5 (shot 3) colossus gone over the whole move; seg 7 (shot 7) kelp still sweeps centre-right → right edge (sunken fixing);
seg 9 the waterline / sun glint jumps between 0.5-s samples (lens-level waves; water agent is re-working the shot-9 sea).
**QA pass B = final preview (02:10, after citadel / water / sunken / look-golden reported done and src was quiet 10 min):**
`out/video_preview/atlantis_final_preview.mp4` (640x360, 2 spp, music from 53.5 s + CC-BY card, 59.4 s, -16.6 LUFS, LRA 14.5,
peak -1.8 dBFS); frames + strips `out/director/r7/qaB/`, `qaB_strip_segNN.jpg`. No page errors, no held frames; pop scan clean
in all 9 segments; 3 → 6 dissolve pixel-aligned (t = 30.8 s, qaB_diss_card.png); colossus absent through segment 5 and present
in shot 5 (final_s5_temple.png). Remaining (accepted for the film): shot 7 framing kelp still crosses the right quarter during
the dolly (sunken pushed it out; ref 7 frames both sides with kelp); shot 4 stair-channel pools read as bright bars; shot 3
right side has no cascades (D2). High stills of the touched shot: out/director/r7/final_s3(_cmp).png, final_s5(_cmp).png
(16 spp). RENDER.md: commands unchanged, round-7 note + QA tools added.
