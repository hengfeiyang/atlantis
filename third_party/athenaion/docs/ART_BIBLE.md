# ATHENAION — Art Bible

Target: a photoreal, cinematic, fully procedural (no external assets) Three.js world that matches the
9 reference images in `refs/ref1.png … ref9.png` (1672×941). Read the references yourself, zoom with
`node tools/crop.mjs`, sample colours with `node tools/sample.mjs`. This document summarises what
matters. **Detail, variety and care everywhere — nothing should look copy-pasted.**

## The look
- Late-morning / golden-hour sun, warm and low-ish (15–30° elevation), coming from the left of most
  shots. Lit marble glows warm cream; shadows are cool blue-grey (lit by the blue sky), never black.
- Deep blue sky at the zenith fading to pale, almost white-blue near the horizon; soft cumulus with warm
  sunlit tops and blue-grey undersides. Sun glow/flare where the sun is in frame (ref 3, 7, 1).
- Strong **aerial perspective**: the snowy mountains are blue-grey and slightly washed; valley mist
  and spray around waterfalls; clouds wrap the mountains at mid-height (cloud banks in front of slopes).
- Saturated but natural: rich greens of cypress, turquoise-teal water, navy + gold banners. Never neon,
  never grey/flat. Contrast is high: the references have deep shadows and bright highlights.
- **Exposure/contrast target** (sRGB luminance percentiles, consistent across all 9 refs):
  p02 ≈ 3–17, p10 ≈ 23–39, p50 ≈ 93–115, p90 ≈ 196–203, p98 ≈ 227–242.
  Check with `node tools/colorstats.mjs <shot>`.

## Places (see `src/world/layout.js` for coordinates)
- **Acropolis**: a tall limestone massif (~96 m) rising from a lagoon. Sheer cliffs with strata,
  ledges, cracks, dark water streaks, bushes and cypress clinging to ledges; the south face is
  terraced (4 levels) with retaining walls, balustrades, colonnades, small temples, statues on
  pedestals, cypress rows, braziers, banners; a monumental straight staircase climbs the face.
- **Main temple (Athenaion)**: Parthenon-like octastyle Doric peripteral temple: 3-step stylobate,
  fluted columns with entasis, echinus+abacus capitals, architrave, triglyph/metope frieze (metopes
  with relief figures, gilded fillets), cornice with mutules, pediments FULL of sculpted figures
  (ref 5), gilded acroteria (palmettes / winged figures) at the corners and apex, marble roof tiles.
  Navy banners with gold owls hang between the inner columns (ref 5). Marble is weathered:
  grey-black speckles and lichen spots, darker grime in crevices and drip streaks under ledges.
- **Colossi of Athena**: huge white marble Athena statues (Athena Parthenos style): Corinthian
  helmet with tall crest, long peplos with deep vertical folds, aegis on the chest, right hand holding a
  tall spear (bronze/gold tip), left hand resting on a huge round shield standing on the ground — the
  shield has a bronze/gold owl in relief inside a laurel wreath / sunburst. Stands on tall moulded
  pedestals. Biggest one (A) at the east end, B at the south-west corner, C at the north-west.
- **Statues everywhere**: smaller statues on pedestals lining stairs and terraces (draped figures,
  some with spears), pediment figures, figures inside the round tholos.
- **Tholos**: round temple on a rock island in the lagoon: Corinthian columns ring, gilded ribbed dome
  with lantern finial, statue inside, steps down to the water, balustrade, pier with a moored boat.
- **Aqueducts / bridges**: multi-tier arcades of pale stone spanning the canyon; water spills out of
  the channel and pours through arches as waterfalls (refs 2, 3, 7, 9). Ivy on piers.
- **Waterfalls**: many! White, fluffy, with streaks and foam; mist/spray clouds at the base,
  churning white water where they hit the lagoon/river. Some tall thin ribbons down sheer cliffs,
  some wide cascades over terrace edges.
- **Water**: turquoise-teal in the lagoon, darker deep blue-teal in depth, reflective (sky +
  buildings), gentle ripples; rapids with foam in the river (ref 7); wet rocks with algae at the shore.
- **City**: hundreds of white/cream houses with terracotta tile roofs on the west hills, descending
  to a harbour with stone quays, ships with square sails (triremes) — ref 1. Towers, small temples,
  a domed building, city walls. Cypress and gardens between houses.
- **Hill temple**: on a crag/hill to the north-west with a big waterfall falling below it (refs 1, 3,
  5, 9), more temples on further hilltops.
- **Mountains**: a massive jagged alpine range (Dolomite/Alps-like) with snow on the upper slopes,
  rocky blue-grey faces, clouds hugging their flanks. 2–3 km tall, 4–12 km away.
- **Ruins terrace** (camera platform for refs 3, 8, 9): broken Corinthian portico with ivy, fallen
  column drums (rosette carved on the end), broken entablature blocks, a giant fallen marble head
  (ref 8: classical youthful male face with wavy hair/laurel, cracked, lichen and moss, ivy), a column
  inscribed "ΠΑΝΤΑ ΡΕΙ", wild grass, yellow and purple wildflowers, olive tree with gnarled trunk.

## Vegetation
- **Cypress** (Cupressus sempervirens) dominates: tall narrow flame-shaped, very dark green, dense
  textured foliage with lighter sunlit flecks; rows along terraces, groups on cliffs, everywhere.
- **Olive trees**: gnarled grey trunks, silvery grey-green small leaves; foreground branches frame
  many shots (refs 2, 3, 6, 7, 9) — individual narrow leaves must read up close.
- Umbrella pines, round broadleaf trees, shrubs (rosemary/lentisk), ivy hanging over walls and
  balustrades (heart-shaped 3–5 lobed leaves), lavender/purple flowers in urns, yellow wildflowers,
  grass tufts in cracks between stones.

## Props & emblems
- **Banners**: deep navy (≈ #1b2550) heavy cloth, gold (≈ #c9a24e) embroidered border, a gold owl
  (Athena's owl, frontal, big eyes, folded wings) inside a laurel wreath, the word "ΑΘΗΝΑ" in gold
  capitals below, gold fringe/tassels at the bottom; hang with gentle folds.
- **Braziers**: bronze/gold bowls on stone or bronze tripod stands with lively flames (bloom),
  on stair pedestals and terraces.
- **Urns/planters**: bronze/gold urns with purple flowers (ref 2).
- **Mosaics**: circular compass/sun-rose floor patterns on plazas (ref 4).
- **Birds**: white seagulls over the canyon (ref 4), a few distant birds.

## Materials (all procedural)
- Marble: warm white (lit ≈ #e9dfcc), slight veining, polished-worn steps, weathering (lichen
  speckles, grime in crevices, drip streaks), chipped edges on ruins.
- Limestone cliffs: cream-grey with horizontal strata, vertical cracks, darker streaks, ochre stains.
- Gold/bronze: gold leaf on acroteria/frieze/dome (warm, slightly rough), darker bronze on braziers.
- Terracotta roofs: orange-red with per-tile variation and sun-bleaching.
- Cloth: navy wool with gold thread (sheen).

## Camera & lens
- Cinematic 16:9, mostly 35–50 mm equivalents; refs 1, 4 are wide; ref 8 has shallow depth of field.
- Foreground framing elements (olive branches, columns, rocks) are part of the composition.
