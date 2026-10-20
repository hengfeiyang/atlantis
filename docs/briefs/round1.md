# Round 1 briefs — specialists (run in parallel)

Everyone: read `docs/CONCEPT.md`, `docs/ART_BIBLE.md`, `docs/CONTRACT.md`, `src/world/layout.js`,
`src/world/heightfield.js`, `src/world/shots.js` and LOOK at the references relevant to you (Read tool on
`refs/refN.png`; crops with `node tools/crop.mjs`). Athenaion's full source is in `third_party/athenaion/` —
find the closest existing generator and adapt it rather than starting from zero.

Work loop: build → render your module test views AND the full world shots that show your work (both eras
where relevant) → compare against the references (side-by-side `_cmp.png`, crops, colour stats) → fix →
repeat. Iterate until your part reads convincingly like the references at the shot cameras — typically many
renders. Cameras are round-0 guesses (the director re-solves them later): frame your test views on your own
content, and check the shots for gross issues. Write all output images under `out/<yourname>/`.

Round-1 goal: every element exists in both eras, at the right place and scale, with good materials and real
detail; the world build stays under budget. Finish with a full-world preview render of shot 1 (golden) and
shot 6 (sunken) without errors you caused, then your ≤ 250-word report.

---

## terrain
Owns: `src/modules/terrain.js`, `src/terrain/**`, the FAR-FIELD functions in `src/world/heightfield.js`
(`mountainsAnalytic`, `farLand`, `seaBed`, `islandAt`, `setFarGrid` usage) — near-field ring/citadel shapes
belong to the director (you may fix obvious bugs there; report them).
- Mesh `heightAt()` with LOD around the citadel (cm-accurate near the cameras, coarse far), exact on flat
  anchors. Ring edges: replace the analytic steep drops with real **rock faces** (strata, joints, ledges,
  overhangs; ref 4 right side) where land rings meet water — the rings agent puts quay walls / cladding on
  top of them, so expose a function or registry entry describing the face top/bottom.
- Citadel hillside between ledges: rocky slopes with soil pockets (ref 4, 6), not smooth cones.
- Far field: coastal plain with fields/woods colour variation, foothills, a jagged **mountain wall to the north**
  (ref 1: grey rock, green lower slopes, 1.5-2.5 km high, 5-14 km away) — use athenaion's stream-power erosion
  + bake (`third_party/athenaion/src/terrain/erosion.js`, `src/bake/terrain.js`); rocky **islets** in the sea.
- Sea bed / ring beds (golden: seen through clear turquoise water near the quays).
- Sunken era: **sand** everywhere below: rippled pale sand, drifts against walls (expose `sandAt(x,z)` /
  registry so others can bury things), rock with algae; the ring floors partly filled (`L.SUNKEN.sandLevelRings`).
- Materials: rock (limestone-grey with warm tints), soil, grass/fields (golden), sand (both).

## water
Owns: `src/modules/water.js`, `src/water/**`.
- Golden: water surfaces for the 3 water rings, canal and the open sea at y = 0: turquoise-teal in the
  rings (depth-tinted, see-through near quays), deep cobalt sea with waves/whitecaps (ref 1), planar or SSR
  reflections of walls/ships (ref 4 mirror-calm), sun glitter path toward the low sun (refs 1, 2, 3, 5), ship
  wakes and bow waves (ref 1, 2: expose an API so ships can register wakes), foam lines at quays and moles.
- **Cascades**: waterfalls spilling from the citadel ledges into water ring 1 (refs 1, 2, 4, 5) — many thin
  white ribbons + a few wide ones, with mist at the bottom; reuse athenaion's traced waterfall system
  (`third_party/athenaion/src/water/*`, `src/modules/waterfalls.js`). Fountain jets in the chariot basins and
  the two springs (one steaming) — `L.FOUNTAINS`, `L.NEREIDS`.
- Sunken: the sea surface at `L.SUNKEN.surface` seen **from below** (bright rippled ceiling, Snell's window,
  total internal reflection outside it; refs 6, 7) and **from just above at dusk** (ref 9: calm orange-lit sea);
  coordinate with the underwater agent who renders the medium, rays and the split-level waterline (ref 9).

## underwater (core)
Owns: `src/core/underwater.js`, `src/core/sunken.js` (new), additive edits in `src/core/atmosphere.js`,
`src/core/engine.js` (patchMaterial / prepareScene hooks), `src/core/pipeline.js` (post passes) — keep the
golden path bit-identical when `engine.era === 'golden'`.
- **Medium**: when the camera and/or fragment is below the sunken surface, replace aerial perspective by
  water: per-channel absorption + in-scatter (blue-teal), correct for the path length below the surface (camera
  below, fragment below; camera above / fragment below for ref 9), sun light attenuated by depth below the
  surface, ambient from above (darker with depth).
- **Caustics**: animated, physically-plausible caustic pattern projected along the refracted sun direction on
  every lit material (stronger on up-facing surfaces, fading with depth); deterministic in time.
- **God rays**: volumetric shafts from the surface (shadowed by geometry if feasible: raymarch the shadow map
  or a screen-space radial approach), strong in refs 6, 7, 9.
- **Marine snow** / suspended particles (instanced, depth of field friendly), subtle bubbles.
- **Sunken overlay** (`sunken.js`): injected into every material tagged `userData.sunken` (see CONTRACT):
  sand dust on up faces (world-normal based), algae/coral crust noise, verdigris on 'metal', dulled 'gold',
  'stone' slightly greened and darkened in crevices. Provide uniforms to tune.
- **Split level (ref 9)**: camera at the surface: above the waterline render the dusk sky/sea normally, below
  through the water with the medium; a wobbling meniscus line across the frame.
- Golden era must be unchanged. Build a test scene (`--test underwater`) with columns, a statue proxy and sand.

## temple
Owns: `src/modules/temple.js`, `src/arch/**`, `src/materials/stone.js`, `src/materials/metal.js` (shared —
**create these two FIRST**, within your first hour, with a stable API, then `touch src/materials/READY`).
- stone.js: white marble/limestone, red stone, black basalt, banded red-white courses, polychrome checker /
  compass-rose mosaic floor material; weathering. metal.js: orichalcum (red-gold), gold, bronze, tin, silver;
  all tagged `userData.sunken`.
- **Temple of Poseidon** (`L.TEMPLE`, ref 3): stepped black podium + stair, peristyle with Ionic/aeolic columns
  with bronze-gold capitals, silver-clad cella walls, entablature with gold relief frieze, pediment full of
  gold sea-creature relief, gold acroteria/pinnacles and a row of gold tridents on the ridge, blue banners
  between columns (push banner slots), statue slots. Front faces south (heading 180).
- The **colossus pedestal** (`L.COLOSSUS`, statues agent makes the figure), the forecourt / plaza with the
  compass-rose mosaic between temple and stair (ref 3, 6), the chariot pedestal + basins (`L.CHARIOT`,
  `L.NEREIDS`, `L.FOUNTAINS`: stone parts only), the **citadel palaces** and small temples on the plateau and
  ledges (refs 1, 4: tiers of buildings with gold domes and red walls around the hill), the grand stair
  `L.CITADEL_STAIR` with balustrades and pedestals.
- Sunken: collapsed roof sections, broken pediment, toppled columns (drums scattered), cracked podium; push coral slots.
- Reuse athenaion `src/arch/*` (orders, entablature, temple, tholos, ornament).

## rings
Owns: `src/modules/rings.js`, `src/rings/**`.
- Ring **walls** with cladding on the land-ring edges and the citadel shore (`L.CITADEL.wall` orichalcum,
  `l1` tin, `l2` bronze): white/red stone courses, metal-clad parapets and bands, towers every ~60-90 m
  with gold domes, crenellations, banner slots.
- **Quays**: stone quays and steps at water level along the rings and canal, mooring posts, ramps.
- **Ship-sheds** (`L.SHIP_SHEDS`, ref 4): arched openings cut into the rock faces at water level, dark interiors
  with a trireme slot each (registry for the ships agent), wall + tin cladding above.
- **Canal tunnel** through land ring 1 (`L.CANAL_TUNNEL`, ref 4), canal quays through land ring 2, the two
  **moles** with **lighthouses** (`L.MOLES`, ref 1: tall towers on rock bases, gold lantern tops).
- Sunken: walls cracked, towers broken/leaning, cladding verdigris; coral slots.
- Coordinate with terrain (rock faces under your walls) and bridges (they attach to your walls).

## bridges
Owns: `src/modules/bridges.js`, `src/bridges/**`.
- **Great gate bridge** over the canal (`L.GATE_BRIDGE`, refs 2 and 7 — HERO): a colossal single arch with
  relief spandrels, two square **gate towers** banded red/white, gilded relief panels, gold-domed tholos tops
  with trident finials, blue trident banners (slots), balustraded deck with statues and braziers (slots).
- **Ring bridges** (`L.RING_BRIDGES`): multi-arch stone bridges with gate towers at both ends; the high
  arch over the canal mouth into w1.
- Sunken: kelp/coral slots on arches, broken balustrades, a fallen tower top; the gate bridge must still read
  as in ref 7 (arch intact, towers mostly intact).

## city
Owns: `src/modules/city.js`, `src/city/**`.
- Houses on both land rings and the outer city (north): white/cream cubic houses with flat roofs, roof gardens,
  some red tile roofs, gold domes on important buildings, colonnaded streets, small temples, baths, gymnasia;
  dense but varied (procedural lots like athenaion `third_party/athenaion/src/city/*`). Leave the zones of
  other modules free (footprints: temple, rings walls, bridges, racecourse, garden terrace, sets).
- **Racecourse** (`L.RACECOURSE`, ref 1 right): hippodrome with tiers of seats and a central spina.
- Sunken: roofless shells, collapsed walls, sand-filled streets; coral slots.

## statues
Owns: `src/modules/statues.js`, `src/sculpt/**` (except sdf.js / mesher.js which are shared — additive only).
- **Chariot group** (`L.CHARIOT`, ref 3 — HERO): colossal gilt-bronze Poseidon standing in a shell-like chariot
  with trident raised, **six winged horses** rearing, wings spread, sculpted as SDFs and meshed (athenaion
  `third_party/athenaion/src/sculpt/*`: figure, face, mesher, bake). **Nereids riding dolphins** around it
  (`L.NEREIDS`). The **colossus** of Poseidon with trident on its pedestal (`L.COLOSSUS`, refs 1, 5).
  Gold statues on pinnacles and smaller statues for the statue slots (kings, tritons).
- Sunken: same statues verdigris (material tag 'metal'), one horse broken off and lying on the paving
  (ref 6), others damaged; the colossus is GONE from its pedestal (its head is the sets agent's fallen head).
- Bake heavy meshes (`tools/bake.mjs statues`).

## sets
Owns: `src/modules/sets.js`, `src/sets/**`.
- Shot-specific hero foregrounds built against the shot cameras (they will be re-solved; anchor your sets
  to layout constants, not to pixels):
  - Shot 3 / 6: the top of the citadel stair (foreground steps, balustrade ends, braziers, bougainvillea pots — ref 3 bottom).
  - Shot 5: the garden terrace (`L.GARDEN_TERRACE`): red-white **banded columns** colonnade left, marble
    balustrade, checker paving, brazier, lotus pot (ref 5).
  - Shot 8 (sunken, HERO): the **giant fallen head of Poseidon** (`L.FALLEN_HEAD`: bearded, wavy hair, spiked
    crown, ≈ 9 m tall, on its side, half buried, verdigris with gold traces — SDF sculpt), the **broken gold
    trident** (`L.FALLEN_TRIDENT`), toppled red-white banded columns and drums, a broken blue-red trident
    mosaic floor (ref 8).
- Use the shared stone/metal materials; push coral slots in the sunken sets.

## ships
Owns: `src/modules/ships.js`, `src/ships/**`.
- **Triremes** (refs 1, 2, 4, 5): dark wooden hull with planking, painted **eye** on the bow, bronze ram,
  outrigger + three banks of oars, cream square sail with a navy trident emblem (canvas texture), rigging,
  stern ornament; variants under sail / rowing / moored with sail furled. A hero trireme in the canal for
  shot 2 (heading toward the gate bridge). Fleets in the sea (ref 1), the rings (ref 5) and in the ship-sheds
  (registry from the rings agent). Small boats at quays. Register wakes with the water agent's API.
- Sunken: the **wreck** (`L.WRECKS`, ref 7): broken hull, exposed ribs, bow eye still visible, half buried;
  a few more wreck pieces around the rings.

## vegetation
Owns: `src/modules/vegetation.js`, `src/vegetation/**`.
- Golden only: **date palms** (HERO: refs 2, 3, 5 — segmented trunk, arching pinnate fronds, date clusters),
  **cypress**, umbrella pines, olives, garden shrubs, hedges; on the citadel ledges, gardens of the land rings,
  along quays, on islets; and the hills / plain. Reuse athenaion's vegetation (`third_party/athenaion/src/vegetation/*`,
  cypress etc.). Respect footprints; read `engine.slots.palm` from others.
- Sunken: nothing alive (maybe a few dead stumps) — skip.

## props
Owns: `src/modules/props.js`, `src/props/**`.
- Golden: **banners** (navy with gold trident, gold border/fringe; cloth with folds) on banner slots;
  **braziers** with fire (bloom) on brazier slots; urns/planters with flowers; **bougainvillea** (magenta)
  spilling over balustrades and walls (refs 3, 5); lotus / water lilies in basins and pots; lamps.
  Reuse athenaion props (`banner`, `brazier`, `fire`, `urn`, `owl`→trident art).
- Sunken: torn banner remnants? (no — cloth gone), fallen braziers and urns on the sand.

## marine
Owns: `src/modules/marine.js`, `src/marine/**`.
- Sunken only (skip golden). Read `engine.slots.coral` / `kelp` from the architecture modules, plus your own
  scatter on sand and rubble:
  - Corals: brain, plate/table, branching (staghorn), soft corals, **sea fans** (gorgonians), tube and barrel
    sponges, anemones, algae turf, sea grass on sand; colour close-up only (orange, red, purple, yellow) — the
    medium turns them teal with distance.
  - **Kelp forests** in the canal and outer rings (ref 7): tall swaying fronds (animated with time).
  - **Fish**: big schools of silver fish (boids-like baked paths or analytic swirls, instanced; refs 6, 7),
    small reef fish near corals, a **manta ray** (ref 8), a **sea turtle** (ref 7). All animated deterministically.
- Heavy instancing; budget ≤ 15 M tris at high.

## sky (clouds + birds)
Owns: `src/modules/clouds.js`, `src/modules/birds.js`, `src/core/sky.js` (and the sky part of looks).
- Golden: a **low golden sun near the top-left** with a big warm aureole, gold-rimmed cumulus with violet
  undersides, cirrus streaks, cloud banks hugging the mountain flanks (ref 1), a horizon haze glowing warm
  toward the sun. Ref 9 above the waterline: an orange-pink dusk sky with the sun at the horizon.
  Adapt athenaion `src/core/sky.js` / `src/modules/clouds.js`.
- Seagulls (golden) over the canal and harbour.
- In `src/world/looks.js` (shared with the director — additive) set per-shot sun / sky / grade so shots 1-5
  read like their references (sun in frame top-left), and a first look for 6-9 (coordinate with underwater).
