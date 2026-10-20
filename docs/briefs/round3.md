# Round 3 briefs — module polish against the final layout (run in parallel)

The layout is now stable (director r3a: citadel summit 62, cliffs, stair head at 75, water ring 1 = 230-350,
sunken surface 104, ref-9 trident + towers). Read FIRST: `docs/COMPOSITION.md` (running log, final cameras,
"What still differs", **"Requests per module (round 3)"** — your requests are there), `docs/briefs/round3-notes.md`
(round-2 reports + director-in-chief notes), `docs/CONTRACT.md`, `docs/ART_BIBLE.md`. Current state:
`out/r3a/cmp_key.jpg` and `out/r3a/shotN_cmp.png` (reference | render). All 9 shots render at high in ~40 s.

Rules as before (ownership, distinct `--out out/<you>/...`, both eras, determinism, budget). Do NOT move cameras
or layout anchors (director's), except additive constants for your own features. Goal of this round: every
element in your scope reads like the references at the final cameras, with real detail. The weakest shots are
**4 and 5** (and the citadel in 1) — everyone check what your module can do for them. Finish with full-world high
renders of the shots you touched, no errors you caused, and a ≤ 250-word report.

## citadel (temple + city + statues)
Owns `src/arch/**`, `src/modules/temple.js`, `src/materials/**`, `src/sculpt/**`, `src/modules/statues.js`,
`src/bake/statues.js`, `src/city/**`, `src/modules/city.js`. The new 62 m citadel must read like refs 1, 4, 5:
tiers of **red orichalcum ramparts** on the plateau cliff and ledges, palaces / pavilions with gold domes stepping
down the hill, the temple crowning it; the grand stair as real stepped marble with landings and balustrades (not
a grey slab, shot 5); horses ≈ 0.7× (director), quay palaces lower; city from shot 1 bright and rich.

## arch-a (rings + bridges)
Owns `src/rings/**`, `src/bridges/**` and their modules. COMPOSITION requests (tunnel portal at the w1-90 bridge,
gate-bridge arch springs ≈ 9 m, ...), the ref-1 mole towers, and **shot 4**: the sheds / tin wall / towers must
fill the right half of the frame close to the camera as in ref 4 (add a shed group or a quay wall section where the
shot-4 frustum needs it, with ships slots), the bridge + tunnel ahead.

## terrain
Owns `src/terrain/**`, `src/modules/terrain.js`, far-field heightfield hooks. The new citadel cliffs and rocky
slopes (refs 4, 5: steep rock with soil terraces, planted), far mountains warmer and more detailed (look-golden
request), plaza sand in shot 6 reduced to drifts at edges, the plain's fields / woods colour.

## water
Owns `src/water/**`, `src/modules/water.js`. Cascades re-traced on the taller hill — refs 1, 2, 4, 5 show MANY
waterfalls down the citadel tiers into water ring 1 (white ribbons + wide falls + mist); stronger reflections of the
lit buildings in rings / canal (look-golden: shot 4 needs warm gold reflections); the ceiling seen from below
brighter (`uDeepUp`, look-sunken); bow wave / hull foam for the hero trireme (shot 2).

## vegetation
Owns `src/vegetation/**`, `src/modules/vegetation.js`. Green the new hill like refs 4/5 (cypress rows on the
ledges, palms, gardens spilling over ramparts), city gardens (`registry.city.gardens`), shot 1 greenery density
in the rings, shot 5 framing palm fronds at the top-right, fix "young palms read like agaves".

## ships-sets (ships + golden sets)
Owns `src/ships/**`, `src/modules/ships.js`, `src/sets/**` + `src/modules/sets.js` (golden parts; marine-look
keeps the sunken sets). Shot 4: triremes moored in the sheds near the camera; shot 2 bow foam with water; shot 5
terrace at its new place (bearing 198, r 352): banded colonnade at the left edge whole (not cut), balustrade,
checker paving, brazier, lotus pot as in ref 5; shot 3 stair-top foreground (braziers, bougainvillea pots on the
balustrade ends, as ref 3).

## props
Owns `src/props/**`, `src/modules/props.js`. Follow the new hill (banners on the red ramparts, braziers along the
stair landings, bougainvillea spilling over ramparts and balustrades as refs 3/5), lamps where slots exist,
check every shot for floating / buried props after the layout change.

## look-golden
Owns `src/core/sky.js`, `src/modules/clouds.js`, `src/core/pipeline.js`, `src/core/lighting.js`, looks 1-5,
golden atmosphere. Clouds must also look right at `--quality preview` (video may render at preview/medium spp);
shot 1 aerial perspective + sun + citadel separation from the city; shot 4 warmth; final per-shot grade 1-5.

## look-sunken + marine
Owns `src/core/underwater.js`, `src/core/sunken.js`, looks 6-9, `src/marine/**`, `src/modules/marine.js`, sunken
sets (`src/sets/*8*`, `fallenhead`, `trident`, `dress8`, `backdrop8`). Shot 6 coral colour and plaza; shot 7: the
bridge must read (thin the fish school in front, ref 7 brightness, ceiling); shot 9 water half brighter, more
contrast (ref 9); use `goldMaterial({crust})` on the shot-8 trident; final per-shot look 6-9.
