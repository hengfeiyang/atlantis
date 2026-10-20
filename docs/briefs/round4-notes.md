# Round 4 notes (collected from round-3 reports)

## citadel (done r3)
- greatRampart()/medallion() (atlantis.js), rampartPlan() (temple.js): tier 1 plateau wall y 42→62.35, tier 2 above ledge 2 (22→34) + 13 m planted terrace; red panels, gilt frames, sun medallions, orichalcum pilasters; white towers w/ red bands flanking stair + cascade openings; slots urns/boug/banners/tier-2 trees; footprint band.
- grandStairPlan(): 6 landings + 6 flights, nosings, raked balustrades, planted beds, 3 lanes w/ cypress dividers. South face ledge 1 small pavilions only, ledge-2 palaces ≤ 8 m. Horses 0.7×, 16 % closer. Sunken trident uses goldMaterial({crust}); bronze colossus-feet stump breaks the surface. City STYLE.flat 0.62 → 0.5. temple 5.1 M tris.
- gaps: shot 4 hill hidden by shore wall + ledge-2 tier from water level; shots 1/5 stair a large white element; shot 1 city denser/greyer than ref; sunken builds log 6 × 404 per shot (untraced).
- forwarded: terrain (rock through stair z 170-190), vegetation (cypress ≤ 8 m ledge 1 bearings 150-230), water (cascades from rampart openings r 115.6).

## props (done r3)
- 36 rampart banners (rampartPlan + planCascades), urns re-seated on coping (sunken dropped), north-flight bougainvillea + 1.2 m gilt urns, crimson-magenta bracts (ref rgb ≈ 210/7/81), lotus pots domed. 1.3 s, 8.2 M tris (bougainvillea 4.4 M / 525k cards) — watch budget.
- audit forwarded: rings (pylon braziers float 0.8, lighthouse braziers > 3 m, shed/tunnel banners without walls) → arch-a; gate-tower banners small (shot 2) → arch-a.
- open for r4: temple — 8 honor-column urns float, 12 ledge-2 palace-facade banners without wall (tag 'columns' if portico); city — 6 urns buried 0.3-0.9 m.
- 404s = sets-drum-s5c2/s5c3 bakes for the moved terrace → ships-sets told to rebake.

## terrain (done r3)
- citadel hillside r 110-216 warm grey-tan limestone, planted soil benches + maquis; plateau rim r 110-114 battered ashlar wall; stair corridor ≥ 2.5 m below the stair line |x| < 25, no bulges < 31; far bake a6 (jagged foothill crags, warmer far rock, lusher plain). 1.4 s, 6.95 M tris.
- gaps: shot 1 mountains too high on screen (≈ 0.6× wanted) → DIRECTOR r4 decision (lower peaks or camera); foothill crags soft at preview.
- forwarded: look-sunken (plaza sand = sunken.js uSkSand overlay, mask to edge drifts; shot 9 mountains near-black above water), arch-a (shed crags leopard spots).

## ships-sets (done r3)
- shot 5 terrace laid out in the real shot-5 camera vs ref-5 pixels (frameFromShot() in src/sets/frame.js — FOLLOWS camera changes): 4 banded columns whole, checker floor, balustrade, brazier, lotus pots (wide one on a plinth, rim bottom right), garden pier in w1 with palm/cypress tops. Shot 3/6 stair top: raking balustrades on the north flight (x 2, 13.5), relief piers w/ braziers + gold urns + bougainvillea (sunken ruined). Ships: swan-neck bow posts; mole sheds always filled (shot 4); 2 triremes for shot 5; nothing within 25 m of golden cameras; shot 2 hero hull 0.84×. Sets rebaked (s5 drums: 404s fixed).
- gaps: shot 5 eye 2.2 m above deck → balustrade/brazier 1.5-2× too big, floor barely shows; stair balustrades 2.5-3.5 m tall to match ref 3 from eye 4 m above landing.
- requests: DIRECTOR r4 → shot 5 eye ≈ 4 m above deck (terrace follows via frameFromShot); shot 2 hero heading toward the camera?; arch-a → lamp glow in mole sheds.

## vegetation (done r3)
- src/vegetation/surface.js: two top-down float maps at build time (terrain only / everything built) → plants sit on the real meshed rock and skip anything built over (follows other modules automatically). Citadel planting rewritten (plateau groves, rim belt shrubs/olives at bearings 112-245, ref-3 palm/cypress groves behind springs, ledge cypress rows, cliff shrubs, quay palms); citadel caps honoured; sets slot tags; shot 5 hero palm closer/larger; shot 1 land rings denser; young palms with 2.6-4 m trunk; shaded foliage ambient 1.1→1.35. 176k instances, 1.8 s.
- gaps: shot 1 land rings still read white — city leaves ~30 % ground free → CITY r4: more garden space in l1 (fewer houses, courtyards); broad-tree LOD2 cube-like from the air; shot 5 fronds darker than ref.

## water (done r3)
- cascades rebuilt: 20 hill falls on the 62 m hill (plateau curtains 6-14 m out of rampart outlets r 115.6 sill 55.5 — spec.outlet {r,y,width,height}; cascadeAt() in temple.js cuts openings), ribbons from ledges, densest on south face; spray soft volumes; uFallAmb; reflections weighted by 1-Fresnel (lit buildings mirror), SHOT_TUNE per shot (shot 4 calm, gold glitter, deeper teal); bow foam + src/water/bowSpray.js; sunken ceiling brighter (uDeepUp); shot 9 mirror pass fixed (was rendering sky as if from underwater). 0.7 s, 113k cascade tris.
- gaps: shot 1 falls barely show at 1.4 km + w1 hidden; shot 4 glints read as dots; shot 2 bow foam thinner than ref; shot 9 sun path lacks orange-gold glitter.
- requests: citadel → shape outlet arches from spec.outlet; ships → pass `foam` in addWake for other fast hulls.

## arch-a (done r3)
- shot 4: new shed mole in w1 (L.SHED_MOLE additive): rock-cut pier with 6 sheds, tin curtain, pylons, filling the right half near the camera; dark water tunnel + 2-arch bridge with towers to the citadel quay (curtain gate bearing ≈ 165); cascade at bearing 158 seen through an arch; shed rock in terrain palette, warmer vault glow. New src/rings/mole.js, moleBuild.js, src/bridges/mole.js. registry.rings.mole.inside(x,z,margin) — water ships avoid it.
- citadel towers podium/shaft/arched belfry + gold figures (sunken: broken stumps, shot 9); w1 ring bridges 6 arches + mid-span tower; ref-1 sea moles: domed root tower + statue tower each; props audit fixed (braziers seated, lighthouse brazier removed, banners on real rock, bigger gate-tower banners). rings 3.22 M / bridges 2.67 M tris.
- gaps: shot 4 thin water ribbon from the bridge balustrade; shot 8 background plain sunken pylon; shot 5 ring bridge off-frame (director).
- requests: water → keep cascades clear of the mole-bridge gate (registry.rings.gates, mole: true); props/vegetation → fill shed ivy slots + slots.tree cypresses on the mole.

## look-sunken + marine (done r3)
- stats |dL|/|dSat|: 6 15.0/11.6→14.1/10.9; 7 15.7/6.7→9.2/6.5; 8 flat 11.3/8.4; 9 flat 15.1/13.3.
- shot 6 clearer near water (temple grey-white), warm WB, softer caustics, dressShot6 (78 coral heads); plaza sand: dust overlay follows a drift mask from the plateau surface map (open paving + rose show); shot 7 fish school halved + routed around the arch, kelp out of the view corridor, bridge reads; shot 8 trident crust (setTridentGoldMaterial); shot 9 uUwLightMode (water lit by a different sun than the disk), temple front lit, mountain fill (still darker than ref); more verdigris on chariot/Nereids.
- gaps: shot 9 plateau paving reads like a pool, far city weak; shot 6 far left empty sand (ref: city); shot 6 stair-top block at right edge bare white.
- requests: water → warmer sky reflection on shot-9 sea, ceiling brighter; citadel → less uniform plateau paving.
- BUDGET: whole world 113-132 M tris at high (contract 60 M) — r4 profile (`window.__profile`) + LOD pass before 4K video; check 4K frame time.

## look-golden (done r3)
- preview clouds = high (march independent of preset, 1 spp clean); mountain banks lit by scene light, smoothed, whiter heaps; sky uStreak sunset bars, uCloudEdge, tinted disk, stratocumulus with blue gaps; shot 1 warm haze + ATMO.uPool / uPoolShade light pool on citadel + cloud shade on outer rings, uLensTint orange glare, gold glitter path, sun disk at ref pixel; shot 4 warm WB; shot 2/3/5 grading. Stats near refs (1 yb 20 vs 14, p98 237/236; 4 yb 33 vs 25; 5 p98 239/241).
- gaps: shot 1 ring water pale grey (sky reflection) + citadel small; shot 5 sun hidden behind a column.
- requests: water → more turquoise ring water in shot 1, fewer white glint dots in shot 4; arch-a → shot-4 bridge blotchy crag texture; sets → shot-5 column gap at px 364 (sun).
