# ATLANTIS — Art Bible

Target: a photoreal, cinematic, fully procedural (no external assets) three.js world that matches the
9 reference images in `refs/ref1.png … ref9.png` (1672×941). Read the references yourself (Read tool on
the PNG), zoom with `node tools/crop.mjs`, sample colours with `node tools/sample.mjs`. The world concept
is in `docs/CONCEPT.md`. **Detail, variety and care everywhere — nothing should look copy-pasted.**

One city, two eras: **golden** (refs 1-5) and **sunken** (refs 6-9). Same layout, same buildings; the
sunken era is the golden one ruined, overgrown and under ≈ 20-60 m of sea.

## The golden look (refs 1-5)
- **Low golden sun, late afternoon / near sunset**, in the west-north-west, *in or near the top-left of
  the frame* in every reference (sun disk + glitter path on the sea in refs 1, 2, 3, 5). All cameras look
  roughly north, so the sun always comes from the left. Lit stone glows warm cream-gold; shadows are cool
  blue-violet, never black.
- Sky: warm gold-orange near the sun, blue higher up and away from it; big sunlit cumulus with gold rims and
  violet-grey undersides; cloud banks hugging the mountain flanks (ref 1).
- Water: turquoise-teal in the rings and canal (mirror-calm with soft ripples, strong reflections in ref 4),
  deep cobalt-navy sea with whitecaps and ship wakes (ref 1), sun glitter toward the sun.
- Saturated but natural: gold, turquoise, deep green, navy banners, magenta bougainvillea. The references
  are punchy; ours must be cinematic-real (no neon), but not grey or washed out.
- Aerial perspective: the plain and mountains fade to warm haze toward the sun, blue-violet away from it.
- **Exposure / contrast target** (sRGB luminance percentiles, `node tools/colorstats.mjs <shot>`):
  golden p02 ≈ 9-21, p10 ≈ 30-47, p50 ≈ 96-113, p90 ≈ 189-203, p98 ≈ 229-242;
  mean colour warm (≈ rgb 115-140 / 103-113 / 80-96).

## The sunken look (refs 6-9)
- Clear tropical water, **blue-teal**, colour absorbed with distance and depth (red goes first). Mean colour
  ≈ rgb 54-89 / 93-108 / 100-119. Percentiles: p02 ≈ 5-23, p10 ≈ 25-45, p50 ≈ 77-94, p90 ≈ 157-179,
  p98 ≈ 201-223 (darker and lower-contrast highlights than golden).
- **God rays** fanning down from the rippled surface (strong in 6, 7, 9), **caustics** dancing on every
  upward face (sand, steps, paving, tops of columns), **marine snow** particles, schools of silver fish.
- Depth fog: objects beyond ≈ 40 m become blue silhouettes, ≈ 80-100 m vanish into deep blue.
- Warm colours (orange/red coral, gold) only close to the camera (< 15 m); further away everything is teal.
- Seen from below, the surface is a bright rippled ceiling with Snell's window around the sun (refs 6, 7).
- Ref 9 (split level): above the waterline a warm orange-pink sunset sea with the gold trident tips and
  pinnacles breaking the surface; below, the temple and rings in blue; a thin meniscus line.

## Places (see `src/world/layout.js` for coordinates)
- **Citadel**: the central island-hill: plateau at 45 m with the Temple of Poseidon, ledges at 32 and 18 m
  (palaces, gardens, fountains, statues), a quay at 3 m, ringed by a red-gold **orichalcum-clad wall** with
  towers (ref 4: the red wall bands in tiers around the hill, ref 5). Waterfalls / cascades spill from the
  terraces into water ring 1 (refs 1, 2, 4, 5) — fed by the hot and cold springs.
- **Temple of Poseidon** (ref 3): faces south toward the stair; big hexastyle/octastyle temple on a
  stepped black-stone podium; white marble with silver cladding panels, **gold** pinnacles, acroteria and a row
  of gold **tridents** on the roof ridge; pediment full of gold relief (sea horses, tritons, waves); bronze-gold
  Ionic capitals; blue banners with a gold trident between the columns. A **colossal Poseidon with trident**
  stands on a tall pedestal behind / above the temple (refs 1, 5).
- **Chariot group** (ref 3): in front of the temple, a colossal gilt-bronze Poseidon standing in a chariot
  drawn by **six winged horses** (rearing, wings spread), on a black-stone pedestal with gold friezes; around it
  **Nereids riding dolphins** in round fountain basins with water jets.
- **Paving**: polychrome **compass-rose / star mosaics** in red, white and black stone; checker paving
  (refs 3, 5, 6, 8).
- **Rings**: land ring 1 (tin wall, pale silver-grey) and land ring 2 (bronze wall, warm brass) rise as
  ≈ 10-14 m rock faces from the water, with stone quays, **arched rock-cut ship-sheds** at water level holding
  triremes (ref 4), towers with gold domes, banners. Walls: courses of white and red stone, gold trims.
- **Bridges and gates**: arched stone bridges cross the water rings; at each end a **gate tower** (ref 2:
  tall square towers banded red and white, gold-domed tholos tops with trident finials, gilded relief panels,
  blue trident banners). The **great gate bridge** spans the sea canal in land ring 2 (ref 2, ref 7).
- **Sea canal and moles**: the canal runs south to the sea between quays; two moles end in **lighthouse
  towers** (ref 1) with gold lantern tops.
- **City**: white and cream houses with flat roofs and roof gardens, some red-tile roofs, gold domes,
  colonnaded streets, small temples, a **racecourse** (hippodrome) on land ring 2 east (ref 1), the outer city
  on the plain to the north.
- **Ships** (refs 1, 2, 4, 5): triremes with dark wooden hulls, a big painted **eye** on the bow, bronze ram,
  banks of oars, square cream sail with a navy trident emblem; small boats.
- **Landscape**: coastal plain, wooded foothills, a jagged wall of mountains (grey rock, green lower slopes)
  to the north with cloud banks; rocky islets with palms in the sea (refs 1, 3, 5).

## The sunken city (refs 6-9)
- Same buildings: roofs partly collapsed, pediment broken, columns toppled in rows (drums scattered), walls
  cracked, towers leaning; statues fallen. A **giant fallen bronze head of Poseidon** (bearded, wavy hair,
  spiked crown) lies on its side, half buried, verdigris with gold traces; the **broken gold trident** beside it
  (ref 8). Broken red-white banded columns, a blue-red trident mosaic on the floor.
- Metal: bronze / orichalcum → **verdigris** green-blue crust; gold stays gold (dulled); silver → dark grey.
- Growth: coral heads (brain, plate, branching, orange/red/purple close up), sea fans, sponges, anemones,
  algae turf on every upward surface, **kelp** columns in the canal (ref 7), sea grass on sand.
- **Sand**: pale, rippled, drifted against walls and filling the rings; caustics on it.
- Life: big schools of silver fish (refs 6, 7), a **manta ray** (ref 8), a **sea turtle** (ref 7), small reef fish.
- **Trireme wreck** with exposed ribs and the bow eye, half buried, under the gate bridge (ref 7).

## Vegetation (golden)
- **Date palms** (ref 2, 5, 3) and **cypress** dominate; umbrella pines, olive trees, lush garden shrubs,
  **magenta bougainvillea** spilling over balustrades (refs 3, 5), lotus and white water lilies in pots and basins.

## Props & emblems
- **Banners**: navy blue (≈ #1b2a5c) with a gold (≈ #c9a24e) **trident**, gold border and fringe.
- **Braziers**: gold/bronze bowls with lively fire on pedestals (refs 3, 5).
- Urns / planters with flowers, gold statues on pinnacles, gilded relief panels.

## Materials (all procedural)
- **White stone / marble**: warm white (lit ≈ #ead9bf), veining, worn edges, grime in crevices.
- **Red stone**: brick-red to terracotta (≈ #a8483a lit), used in bands, columns (red-white banded), walls.
- **Black stone**: basalt (≈ #2a2a2e), podiums, bases, mosaic.
- **Orichalcum**: red-gold metal (≈ #c8703e, metallic, slightly rough), the citadel wall cladding.
- **Gold**: warm, polished leaf on pinnacles / statues; **bronze** (darker, brown-gold); **tin** (pale
  silver-grey, rough); **silver** (cool, polished panels).
- Sunken versions: verdigris (#3f8c7a-ish), algae green-brown, coral crusts, sand dust on top faces.

## Camera & lens
- Cinematic 16:9, mostly 28-50 mm equivalents; ref 1 aerial wide; ref 9 wide split level.
- Foreground framing elements (columns, palm fronds, balustrades, kelp, coral, wreck) are part of the composition.
