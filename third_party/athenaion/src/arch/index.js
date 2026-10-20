// ============================================================================================
//  ARCHITECTURE KIT — classical orders, temples, tholoi, stoas, pedestals, balustrades, ruins.
//  OWNER: arch/temple agent. Import freely; never edit (ask in your report).
//
//  Units: metres. Local frames: y up, front = +Z, base / stylobate top at y = 0.
//  Every geometry carries an `aux` vec4 attribute (cavity, edge, streak, masonry-flag) that the
//  materials in src/materials/marble.js & metal.js understand (grime, worn edges, drip streaks,
//  drum / ashlar / paving joints). Use those materials for consistent stone.
//
//  QUICK START
//    import * as ARCH from '../arch/index.js';
//    // a single column (cached BufferGeometry) — instance it:
//    const { geometry, info } = ARCH.columnGeometry({ order: 'corinthian', height: 9, detail: 1 });
//    const im = new THREE.InstancedMesh(geometry, ARCH.marbleMaterial({ variant: 'weathered' }), n);
//    // a complete building:
//    const B = ARCH.prostyleTemple({ order: 'ionic', porch: 4, colH: 7 });
//    const group = B.finalize({ position: [x, y, z], rotY });   // builds meshes + AO volume
//    engine.add(group); B.publishSlots(engine);                   // banners / statues slots
//
//  COLUMNS (orders.js, acanthus.js)
//    columnGeometry({ order:'doric'|'ionic'|'corinthian', height, diameter?, detail 0..1,
//                     decorated? (Doric egg-and-dart echinus), base?, plinth?, capital? (false = flat top),
//                     flutes?, taper?, entasis? }) → { geometry, info:{ D, Dtop, baseH, shaftTop, capH, height, abacus } }
//    columnInfo(o) → dimensions only.  capitalGeometry({ order, diameter, detail }) (ruins.js)
//    buildColumn(mb, o) writes into a MeshBuilder.
//
//  BUILDINGS (return a Building; .finalize({position:[x,y,z], rotY, ao:true, aoCell}) → THREE.Group)
//    peripteralTemple({ order, front, side, W, L, colH, steps, stepH, tread, pitch(deg), plaques, gild 0..1,
//                       acroteria:'palmette'|'nike'|'none', corners:'griffin'|'palmette'|'none', porch, stairs:{width},
//                       detail, seed, name, banners, pedRecess (m: deeper pediment floor), darkCella, coursed, overrides,
//                       interiorDark (0..1 darker porch/cella skins, far buildings), foundation, arcade })
//    prostyleTemple({ order, porch (n columns), W, L, colH, amphi, pitch, gild, frieze:'plain'|'plaques'|'rosettes',
//                     acroteria, corners, steps, stepH, tread, doorW, flankStatues, banners, detail, seed, name,
//                     darkPorch (default true: porch walls in shade), interiorDark, foundation, arcade })
//    (r5) arcade: { faces:['front','left','right'], bottom (local y), bay, open, depth, statues, braziers, balustrade }
//         → tall podiums get arcaded terrace walls (dark arches), a balustrade, corner statues and braziers
//    tholos({ radius, columns, colH, hA, hF, order, steps, stepH, tread, ribs, rise, gild, statue, friezePanels, palmetteH, detail, seed, name })
//      (frieze relief panels are published as metopes; open lantern with colonnettes; matte gilt dome panels)
//    stoa({ length, depth, colH, order, inner:'ionic'|null, steps, gild, plaques, detail, seed, name, banners,
//           foundation, arcade, corners, darkInner (default true), interiorDark })
//    propylon({ width, depth, colH, columns, passage, gild, detail, seed, name })
//    gateTower({ w, d, h, foundation, arch, archW, loggia, gild, detail, seed, name, banner })  (refs 2, 7: arched tower, loggia, roof terrace)
//    Building.info / .world (after finalize): pediments[], metopes[], banners[], statues[], anchors{}, footprint
//    Building.publishSlots(engine) pushes banners/statues/... into engine.slots (world space, facing = compass deg)
//
//  ELEMENTS (write into a MeshBuilder at its transform, or *Geometry() for a cached BufferGeometry)
//    pedestal(mb, { w, d, h, wreath(true), wreathBack, panel, plinth, detail }) / pedestalGeometry(o)
//    balustrade(mb, { length, height, spacing, postEvery, depth, endPosts, detail }) / balustradeGeometry(o)  (runs along +X)
//    crepidoma(B, W, L, { steps, stepH, tread, seed, detail, foundation, arcade })
//    arcadeFacade(B, { x0, x1, y0, y1, z, depth, bay, open, detail })  arched terrace wall facing +Z (dark recesses)
//
//  RUINS (ruins.js) — BufferGeometry, base at y = 0
//    brokenColumnGeometry({ order, height (original), diameter, breakAt 0..1, breakTop (m), chips 0..1, seed, detail, base })
//    drumGeometry({ order, diameter, height, rosette, broken, chips, seed, detail })   (axis +Y; rotate to lay down)
//    roughBlockGeometry({ size:[x,y,z], seed, chip, broken:{px,nx,py,ny,pz,nz}, detail })  / roughBlock(mb, o)
//    entablatureFragmentGeometry({ order, D, length, seed, brokenEnds:[l,r] })
//    capitalGeometry({ order, diameter, detail })
//
//  ORNAMENT (ornament.js) — write into a MeshBuilder (gold or marble)
//    antefix(mb, h), palmetteAcroterion(mb, h), griffinGeometry(size), victoryGeometry(size),
//    rosette(mb, r, petals), wreath(mb, R), shield(mb, R), plaque(mbGold, w, h), eggAndDart(mb, L, h)
//
//  MATERIALS: marbleMaterial({ variant:'weathered'|'polished'|'ruined'|'mossy'|'interior', tint, ao, vertexColors, seed, overrides })
//             overrides.heavy (dense rain-wash runs + black crust) / .ochre (iron stains): opt-in hero weathering;
//             .crust (solid black lichen crusts; 'ruined' 0.85, 'mossy' 0.5). Masonry joints are coverage-AA'd
//             (they stay visible at 4K from 70–300 m) with chipped margins.
//             goldMaterial(o), bronzeMaterial(o), patinaBronzeMaterial(o)
//  GEOMETRY CORE (geom.js): MeshBuilder, box, boxC, lathe, surface, sweep, rectPath, extrudeOutline, tube, ellipsoid
//  AO: AOVolume (ao.js) — Building.finalize() computes one automatically from registered occluders.
// ============================================================================================
export { MeshBuilder, box, boxC, quadOut, triOut, lathe, disk, surface, sweep, rectPath, extrudeOutline, tube, ellipsoid, cylinder, hash3, vnoise3, fbm3, lerp, clamp, smooth } from './geom.js';
export { ORDER_DEFAULTS, columnGeometry, columnInfo, buildColumn, flutedShaft, atticBase, doricCapital, ionicCapital, shaftRadius } from './orders.js';
export { corinthianCapital, leaf, concaveSquare } from './acanthus.js';
export { Run, doricRun, ionicRun, pediment, tiledRoof, triglyphFace } from './entablature.js';
export { antefix, palmetteOutline, palmetteAcroterion, griffinGeometry, victoryGeometry, rosette, wreath, shield, plaque, eggAndDart } from './ornament.js';
export { Building } from './build.js';
export { AOVolume } from './ao.js';
export { peripteralTemple, prostyleTemple, crepidoma, columnAxes, frontStairs, arcadeFacade } from './temple.js';
export { tholos } from './tholos.js';
export { pedestal, pedestalGeometry, balustrade, balustradeGeometry, stoa, propylon, gateTower } from './elements.js';
export { shaftSegment, brokenColumnGeometry, drumGeometry, roughBlock, roughBlockGeometry, entablatureFragmentGeometry, capitalGeometry } from './ruins.js';
export { marbleMaterial, setMaterialAO, MARBLE_DEBUG, BOUNCE } from '../materials/marble.js';
export { goldMaterial, bronzeMaterial, patinaBronzeMaterial } from '../materials/metal.js';
