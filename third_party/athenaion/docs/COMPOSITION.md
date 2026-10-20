# ATHENAION — Composition plan (director)

Owner: director. This is the plan the other modules build against: where things are in the world
(`src/world/layout.js`, near terrain `src/world/heightfield.js`) and how each camera (`src/world/shots.js`)
frames them. Frame positions are in reference pixels (1672 × 941) or fractions ("x 0.62" = 62 % of the
width from the left, "y 0.30" = 30 % of the height from the top).

Tools I used (scratchpad, easy to recreate): a pinhole camera solver fitted to the reference temple
corners (front 31 m, columns 10.4 m, stylobate → apex 18.1 m), a triangulator for the other landmarks
across the 9 references, a top-down planning map of `heightAt()` with the camera frusta, and an
in-page raycaster (`node tools/snap.mjs --eval`) to name the object under any pixel of a shot.

## 1. What the references agree on (why the layout changed)

* **The temple is always seen from its front-right.** In every reference the pediment front is on the
  left of the temple block and the right flank recedes to the right. So all cameras are on one side.
  → **The temple faces SOUTH** (`TEMPLE.heading = 180`) toward the grand stair, the lagoon gorge and
  the ruins promontory. Fitted camera bearings from the temple: shot 1 ≈ 100°, shot 4 ≈ 130°,
  shots 3/8/9 ≈ 135-155°, shots 2/6/7 ≈ 150-170°.
* **Camera–temple distances are short**: 210-240 m for 3/8/9 (vfov 35-40°), ~100-110 m for 1 and 6,
  ~175 m and 27 m above the stylobate for 4, ~260 m for 2. Round 0 had them 600+ m away.
* **The temple sits high on a podium/rim wall at the edge of a sheer cliff**: in refs 3/9 the
  stylobate is 10-15 m above the camera eye and the face drops ≈ 3 temple heights to the water.
  → plateau `ACROPOLIS.top = 54`, temple stylobate 67.5 on a ≈ 13 m podium (temple module
  foundation), compact plateau outline whose south rim runs right in front of the temple (z ≈ -28),
  4 narrow terraces (y ≈ 42 / 30 / 19 / 9) on the south sector (bearing 118-236° from the centre),
  sheer cliffs elsewhere. A "sheer bay" (x 42-80) under colossus A keeps one cliff straight into the
  water (refs 2, 3, 7). Building sites on the ledges are widened (`ACROPOLIS.sites`).
* **The hill temple crag with its waterfall is behind-left of the acropolis in 8 of 9 references.**
  Triangulated over shots 3/8/9/6 → `HILL_TEMPLE` (-424, -284), top 118, sheer face + waterfall notch
  facing 128° (toward the cameras). It overlaps the canyon rim on purpose (its cliff and fall drop to
  the river). A lowland (`hillLowland`) keeps the land around it below ~35-60 m so it towers.
* **The grand stair is under the temple front** (refs 2, 4, 6, 9): `GRAND_STAIR.x = 24`, top landing
  at the rim (z -10, y 54) down to a quay at z ≈ 100 (y 2). The near terrain has a spur under the stair
  (`stairSpur`) down to z = 52 (`GRAND_STAIR.spurEnd`), after which the stair rides its own
  substructure out over the lagoon.

## 2. World layout (current)

```
            N (-Z)            mountains (mountains agent)
   WEST_CRAG (-650,-700)                 river canyon from the NW
     'hill' aqueduct (deck 108) → HILL_TEMPLE crag (-424,-284) top 118, falls 'hill-big'
         CITY (west hills, now reaching x≈-250 along the canyon)   'high' aqueduct (deck 50, 2 tiers)
                                           'low' bridge (deck 24) ── ACROPOLIS plateau y=54
                      city hill temple (-585,140)                     TEMPLE (20,-64), front SOUTH z=-29
                                          'lagoon' aqueduct (deck 24, z≈60) colossus A (50,-33) C (-6,-33)
                       basin  ISLAND tholos (-14,128)    GRAND STAIR x=24, z -10 → 100
                          channel to the sea (SW)   LAGOON gorge (centre (-40,128), radii 178×104)
                                                         RUINS promontory (top 52, platforms +4) SSE
                                                         NW rim ≈ (106,152)-(150,128)
```

| feature | where | seen in |
|---|---|---|
| temple | (20, 67.5, -64), front z = -29 | all |
| colossus A (21 m on 13 m pedestal) | (50, -33) front-right bastion | 1-9 |
| colossus C (17 m on 13 m pedestal, r5) | (-10, -33) front-left, feet at the stylobate level | 1-9 (6: left of the temple) |
| colossus B (21 m on 5 m pedestal) | (-71.5, 181.1), top 113.4, on a ≈ 120 m sea-stack bastion in the lagoon in front of the port quarter (r5) | 4 only |
| grand stair | x = 24, z -10 → 100, y 54 → 2 | 2, 3, 4, 6, 7, 9 |
| island tholos | (-14, 128) top 6.5 | 2, 3, 4, 9 |
| hill temple + 'hill-big' fall | (-424, -284), lip (-389, 112, -257) | 1, 3, 5, 6, 8, 9 |
| city hill temple + 'city-hill' fall | (-585, 140) top 145 | 1, 2 |
| aqueduct 'lagoon' | (-140,64) → (10,58), deck 24 | 2, 3, 8, 9 |
| aqueduct 'high' | (-330,-200) → (-64,-104), deck 50 | 3, 4, 8, 9 |
| ruins promontory | outline in layout, top 52, raised platforms for 3 and 9 | 3, 8, 9 |

## 3. Shots (reference → current framing)

**Round 5 (director r5, FINAL cameras for rendering)** — only shots 4 and 6 changed; 1, 2, 3, 5, 7, 8, 9 are
the round-4 cameras below (checked against the r5 content: all still frame the temple, A and C as before).

| shot | pos | target | fov |
|---|---|---|---|
| 1 | (108, 66, 30) | (15.1, 61.5, -6.7) | 40 |
| 2 | (-19, 7, 227) | (-13.6, 14.8, 127.4) | 28.5 |
| 3 | (122, 59, 154) | (60, 50.7, 76.3) | 35.6 |
| 4 | (-20, 160, 230) | (-39.7, 101.9, 151) | 43 |
| 5 | (75, 62, 66) | (32.73, 74.2, -24.23) | 18.5 |
| 6 | (24, 26.8, 50) | (-11.3, 60.2, -37.4) | 42 |
| 7 | (70, 4, 125) | (27.1, 24.8, 37.1) | 40 |
| 8 | (134.4, 54, 145) | (83.2, 47.4, 59.5) | 34.7 (near 0.2) |
| 9 | (151.56, 57.8, 139.41) | (83.16, 60, 66.41) | 36.5 (near 0.3) |

4. **Aerial over the canyon (r5)**: the r4 camera looked SE→NW over the lagoon bay (wide water, port and
   ships in the upper left, B on a box tower). It now hovers 160 m above the lagoon south of the island and
   looks up the WEST canyon (yaw 346°, pitch -35.5°): the canyon with its three arched crossings ('lagoon'
   aqueduct, 'low' bridge, 'high' aqueduct) and the acropolis west-face falls fill the centre-left, the
   grand stair runs as a diagonal on the right from the stair-foot quay up to the temple at the top right
   (apex ≈ (1341,73), ref (1235,62)), terraces with falls along the right edge, the island tholos at the
   bottom centre, the city on the left bank. Colossus B was re-solved for it (out/director/ray.mjs): helmet
   whole in the top-left corner (helmet + spear at the top edge, shield and banner below, like ref 4), 21 m figure, feet at ≈ px (235,520), ≈ 85 m from the camera (further out, its long shadow fell on the shot-7 hero olive; verified by render diffs with and without B: shots 1-3, 5-9 unchanged), on a sea-stack bastion (acropolis
   bastion.js: crag + 21 m ashlar crown, banners on its S/E faces toward the camera) standing in the lagoon
   in front of the port quarter, which hides most of the moored fleet (the fleet avoids the bastion
   footprint). B is ≥ 1100 px outside every other frame; the bastion is shot-4-only (acropolis onShot).
   Rejected: a SE camera fitted to ref 4 (rms 80-140 px, the lagoon always reads as a bay); a camera over
   the canyon mouth looking N (no island/stair).
6. **Grand stair (r5)**: yaw 342 → 338°, pitch 21.6 → 19.5°, fov 38 → 42, eye ≈ 3 m above the flight at
   z 50. Colossus C was raised to the stylobate level (pedestal 5 → 13 m) and enlarged (14 → 17 m) so its
   upper body clears the west stair-flank cypresses and stands left of the temple at the top of the stair
   (ref 6: (870,120-350); ours ≈ (830,170-370)). The snowy massif and hill temple of ref 6 cannot be seen
   from the stair: the west terraces (y 30-54) and their trees occlude everything below ≈ 15-20° elevation
   toward bearing 300-320° (massif ≈ 14°, hill temple ≈ 9°); a stair-level camera would have to be > 250 m
   from the temple to bring them together.

Round-4 cameras (FINAL for round 4; flora branches/rocks, ruins sets, tree heroes and the `sets` module place
framing elements against them; the authoritative values are in `src/world/shots.js`). Numbers in brackets
are reference values. Tools: `out/director/cam.mjs` (pinhole project/solve), `fit.mjs` / `fitfix.mjs` /
`fit6.mjs` (camera fits to reference landmarks, free or with the eye pinned to the stair surface),
`solveB.mjs` (colossus B on the shot-4 frustum), `map4.mjs` (top-down height map with frusta).
Mountains: the hero massif sits at ≈ 11-15° elevation (az ≈ 319° from the acropolis) from every camera.

1. **Panorama** pos (108,66,30) → (15.1,61.5,-6.7) fov 40 — r4: 106 m from the temple front (r3: 123 m at
   fov 46, temple small at the top-right). Temple front x 0.61-0.75 [0.63-0.72], apex (1120,165) [(1133,105)],
   colossus A x 0.83-0.95 [0.80-0.86] with its helmet in frame, city + lagoon port at the left, range in the
   centre. A free fit to the ref-1 temple + colossus corners wants bearing ≈ 125° and a 24° telephoto from
   180 m (rms 17 px) but then the city/harbour fall out of frame and the massif leaves the temple's back;
   r4 is the compromise (bearing ≈ 128° from the front centre). The eye floats ≈ 47 m above the terrace
   ground: the "rock outcrop" is flora's hero-rock cluster (strict to shot 1). A terrain knoll there would
   enter shots 8 and 9 (checked), so none was added.
2. **Lagoon / tholos** pos (-19,7,227) fov 28.5 (unchanged): the tholos already sits at the ref-2 place and
   size (x 0.42-0.60, dome top y 0.35). What hides it are island cypresses in front of it (vegetation,
   scatter.js island stage, e.g. cypress at (-4.5,15,117.7), (-1.9,12,130.2), (-0.2,19,132.8)) and the
   wide quay platform (temple module 'island-terrace'). The `sets` module anchors the right-foreground
   terrace (statue, banner, urn, brazier, balustrade) on reference pixels of this camera.
3. **Ruined terrace** pos (122,59,154) → (60,50.7,76.3) fov 35.6 — r4: pitched up 1.25° (target y 48.5 →
   50.7) so the summit pyramid shows with sky above (mountains request).
4. **Aerial** pos (157.6,160.4,185) → (94.1,104.5,131.7) fov 40 — r4: fov 46.7 → 40, pitch -35.8 → -34°,
   yaw 310°: temple ≈ 1.2× larger at the top-right (apex (1237,78) [(1235,62)]), stair centre, island
   tholos (454,663) [(700,600)], 'lagoon' aqueduct and the river mouth in the upper-left. Colossus B
   re-solved (`solveB.mjs`): 17 m figure on a 4 m pedestal, head at px (28,52) cut by the left edge, feet
   at (176,478), 56 m from the camera, standing on a 10 m-wide bastion on the promontory's NW rim
   (pos (102.6,124.1,177), ≈ 72 m tall), facing 5° (into the scene) so we see its right side with the
   (mirrored) shield and owl toward the camera, as in ref 4; the narrow bastion keeps the island tholos
   clear. A camera fitted to the ref-4 temple alone (76,143,126 fov 40) shows the river canyon better
   but leaves no ground for B within 60 m at the left edge (B would need a 110 m tower in the lagoon), so
   it was rejected. B and its bastion are outside every other frustum (checked), but cast long
   shadows: they should be shot-4-only (see requests).
5. **Facade** pos (75,62,66) → (32.73,74.2,-24.23) fov 18.5 — r4: pitch +2.2°, yaw +2°, fov 20 → 18.5:
   colossus A whole (helmet in frame, statues request), temple larger and further left [front x 0.15-0.62].
6. **Grand stair** pos (22,26.3,48) → (-6.5,63.2,-40.5) fov 38 — r4: eye 1.7 m above the flight below
   the y-30 landing, left of the axis, fov 60 → 38. Temple large at the top-centre-right (apex (1163,50)
   [(1163,30)]), the left balustrade + pier + statue as a diagonal, colossus C left of the temple. A
   grid fit with the eye pinned 1.7 m above the stair (`fit6.mjs`) prefers z 42-48 and fov 50-55; from any
   point of our stair the forecourt edge and the stylobate are only 2-5° apart, so the long upper flights
   stay visible between the landing and the temple (ref 6 shows a landing at y 0.62 and a tall podium with
   falls/statues above it): that band needs dressing, not a camera move. Mountains (≈ 14°) are below the
   balustrade at this pitch.
7. **River level** pos (70,4,125) fov 40 (unchanged).
8. **Fallen head** pos (134.4,54,145) → (83.2,47.4,59.5) fov 34.7 — r4: pitched up 1.25° (target y 45.2 →
   47.4), summit pyramid with sky above. The ruins head set follows this camera.
9. **Portico** pos (151.56,57.8,139.41) → (83.16,60,66.41) fov 36.5 (unchanged).

## 4. Requests to the other modules (what each frame still needs)

**Round 5 (director r5) — against the final cameras:**
* statues: hide colossus B outside shot 4 (engine.onShot, like the acropolis bastion). It floats at y 113 in
  the other shots; its shadow only touches 4 px at the left edge of shot 8 now (checked by render diffs), but
  video camera moves could reveal more.
* video: shot 6 stands ≈ 3.5 m above the stair at z 50 (surface ≈ 23.2): any dolly must follow the stair
  slope (registry.acropolis.surface(z) + 1.7…4 m), or the camera enters the steps when it moves up-stair.
  Shot 4 can move freely (≥ 50 m clearance); keep B's helmet in frame (do not pan right > 3°).
* acropolis: shot 4 B bastion reads as a tall ashlar box; ref 4 shows a cliff-top wall with ivy, shrubs and a
  single big banner under the statue. Ivy curtains / cypresses on its ledges would help most.
* waterfalls / clouds: shot 4 has many small round mist puffs floating over the canyon (they read as white dots).

**Round 4 (director r4) — against the r4 cameras (details in the round-4 report):**
* acropolis + statues: colossus B and its bastion are only meant for shot 4; make them visible only in
  shot 4 (engine.onShot) so their ≈ 600 m shadows never reach other frames. Dress the 72 m bastion like
  ref 4 (rustic ashlar, ivy curtains, cypress on ledges, stepped crown, banner below the statue).
* vegetation: no island cypresses on the shot-2 side of the tholos (bearing 140-220° from the island
  centre); keep the tall group behind it (ref 2). temple: the island quay platform reads as a wide box;
  ref 2 shows a rocky island with a stepped base under the tholos.
* acropolis / sets / vegetation: shot 6 shows the upper flights between the y-30 landing and the
  forecourt (frame y 0.30-0.55): flank them with piers, statues, braziers and cypress rows, and let the
  podium falls read (ref 6 y 0.35-0.5).
* flora: the shot-1 hero-rock cluster is a large smooth brown mass at the bottom-right; ref 1 shows a
  fractured limestone ledge with lichen and grass.

**Round 2 (director r2) — new requests against the r2 cameras:**
* **statues + acropolis (shot 4 colossus B)**: the ref-4 foreground colossus needs, for the r2 aerial camera,
  feet at ≈ (122, 131.5, 181) (21 m figure, 46 m from the camera, feet at pixel ≈ (330, 620), head at the
  top-left). That is an ≈ 80 m tower bastion rising from the ruins promontory (top 52); it is behind or
  outside every other camera (checked shots 1-3, 5-9). Blocker: statues.js stands each colossus on
  min(pos[1], terrain) and ignores registry.acropolis.colossusBases. Once statues uses colossusBases[id],
  set COLOSSI B { pos: [122, 131.5, 181], pedestal: 4, height: 21, facing: 300, bastion: { w: 14 } }.
* **trees**: shot 6 (stair axis) shows sky top-left over the west balustrade: cypress rows on the west
  ledges/forecourt (x -30…10, z -30…30) would fill it like ref 6. Shot 5 (telephoto from the SE): ref 5
  flanking cypresses stand in front of the podium (x 0-40, z -25…-15). Shot 1: olive/shrub masses on the
  terrace ledges in the centre of frame.
* **flora**: shot 1 foreground rock outcrop bottom-right and olive top-right still frame correctly at the
  new camera; shot 6 left sprays now hang over the balustrade.

* **acropolis**
  - Temple podium (x 2-38, z -29…-101, y 54 → 67.5, faces south/east/west): ashlar retaining wall
    with buttresses, a cornice and 3-5 navy banners on the south face, a central stair (x 20) from the
    forecourt (y 54) up to the stylobate — refs 3, 5, 6, 9. Today it is a plain foundation block.
  - Forecourt in front of the temple (x -20…70, z -30…-10, y 54): marble paving, statues on pedestals,
    braziers, urns; currently reads as dark grass from shot 3 (pixel 1250,350).
  - Stair below z ≈ 52 rides over water: give the substructure arches (an arcade like ref 7's aqueduct,
    water pouring through the arches) — this is the main subject of shot 7 now.
  - Terrace buildings: stoa-1E / temple-2EE fail "ground too uneven"; candidate ledges with depth
    ≥ 20 m exist at x 82-122 on ledge y 30 and x 98-130 on ledge y 19 (see `ACROPOLIS.sites`).
  - East cliffs under colossus A (x 42-80, sheer bay) need masonry caps, balconies and small shrines
    stacked on the face (refs 3, 7) and the terr-5 / terr-7 falls.
* **temple**: hill temple at `HILL_TEMPLE` now faces `facing` 128°; the `hilltop-city` temple moved to
  (-585,140) (top 145) for shot 1 — please check its foundation; consider a small temple + tholos on the
  island quay and a gate tower at the stair foot (refs 2, 7).
* **statues**: colossus B has no good place yet; ref 4 wants a colossus on a cliff-top bastion at the
  left frame edge of shot 4 (≈ 60 m from the camera, feet at y ≈ 70, i.e. on a tower bastion of the
  east acropolis cliff near (61, 78) — needs a bastion from acropolis). Statue rows along the stair
  balustrades (refs 6, 2) and in front of the podium (ref 5).
* **ruins / flora**: shot 8 — the promontory top between the head and the rim (x 125-132, z 133-141)
  is bare terrain (dark green slab): add rubble, grass, flowers. Shot 9 — the floor between the
  portico columns shows bare green terrain (x 145-150, z 128-133): extend the paving/rubble. Shot 3 —
  ruins set now stands on the raised platform (eye 2.5 m above ground); check the podium/knoll.
* **vegetation**: cypress rows on every ledge of the south face and along the stair (refs 3, 6, 9);
  olive / pine masses on the ruins promontory slopes; the hero tree list (`HEROES` in scatter.js)
  is empty — fill it for the final cameras (shots 2, 3, 6, 9 framing trees).
* **waterfalls**: lips were re-snapped to the new ledges (terr-1 (-4,41.5,-7.5), terr-3 (-20,18.5,35),
  terr-5 (60,41.5,0), terr-7 (50,29.5,18.5), hill-big (-389,112,-257), city-hill (-560,144,136)). The
  'lagoon' aqueduct spills should pour into the lagoon (refs 2, 3, 9).
* **city**: the city outline now reaches the canyon west bank (x ≈ -250…-330, z -70…330) so that the
  houses fill the left of shots 1 and 2; please densify there and add the harbour ships in shot 1
  (sea at the far left, x 0-0.2).
* **mountains**: references want snowy peaks directly behind the temple in shots 3, 5, 8, 9
  (bearing 320-335° from the ruins promontory, i.e. north-west of the acropolis) and on the left of
  shots 1, 2, 6.
* **look**: shot 2 sun is in frame at the left (ok with ref); shot 7 now looks NW toward the sun side.

## 5. Status / changes log
* round 5 (director r5): shot 4 moved to the west canyon (see section 3), colossus B re-solved on it
  (layout COLOSSI B (-71.5, 113.4, 181.1), height 21 on a 5 m pedestal, facing 40, bastion w 10); shot 6 yawed left / widened; colossus C
  pedestal 13 m + figure 17 m (stands at the stylobate level left of the temple in all shots). Terrain bake
  refreshed (node tools/bake.mjs terrain: the far-field LOD follows the shot frusta).
* round 4 (director r4): shots 1, 4, 5, 6 reframed, 3 and 8 pitched up 1.25°, colossus B re-solved on the
  new shot-4 camera (left edge, facing into the scene, narrow bastion clear of the island). Layout text
  changed (COLOSSI B) → terrain bake refreshed (node tools/bake.mjs terrain).
* r1: temple turned to face south, plateau 66 m, compact outline, stair spur, lagoon gorge, ruins
  promontory moved SSE, hill temple crag moved.
* r2-r6: cameras solved from the reference temple corners; plateau lowered 66 → 60 → 54 with a temple
  podium; stair moved under the temple front (x 24); terrace sites/falls re-snapped.
* r7-r12: ruins promontory rim shaped per camera (shot 8 notch, raised platforms for 3 and 9),
  island moved to the stair foot, 'lagoon' aqueduct, city hill temple, hill temple triangulated.
* r13-r15: shots 5, 6, 7 reframed (forecourt, stair landing, lagoon east of the stair).
* round 2 (director r2): cameras 1, 3, 4, 5, 6, 9 reframed (see section 3). Shot 5 became a telephoto from
  the SE so the range sits behind the temple; shot 4 a high aerial fitted to the ref-4 layout (island
  centre-left); shot 1 lower and more frontal; shot 6 stair-centred with less sky; shot 9 tighter;
  shot 3 eye +2 m. layout.CITY.port mirrors the city module port polygon.
