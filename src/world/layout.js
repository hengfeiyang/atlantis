// World layout: the master plan every module builds against. OWNER: director.
// Units: metres. Compass: -Z north, +X east, +Y up. Golden-age sea level is y = 0.
// The city centre (temple hill) is at the origin. All cameras look roughly north (the sun sets on the
// left of frame, i.e. in the west / north-west) — see docs/COMPOSITION.md and src/world/shots.js.
//
// Era: engine.era is 'golden' or 'sunken'. The layout is the SAME in both eras; the sunken era raises
// the sea to SUNKEN.surface and modules apply ruin / growth / sand (see docs/CONTRACT.md "Eras").
export const SEA_LEVEL = 0;

export const SUNKEN = {
  surface: 104,         // sea surface in the sunken era. r3 (director): 87 → 104 with the citadel raise (summit 45 → 62): the sunken temple keeps its depth (ridge ≈ 94, ≈ 10 m under water, ref 9); the colossus trident and the two citadel pinnacle towers break the surface (ref 9). r2 (director): 78 → 87 — ref 9 solved: eye at the surface ≈ 11 m above the temple ridge (≈ 76), i.e. the temple roof is well under water and seen from above (docs/COMPOSITION.md). r1: 64 → 78
  sandLevelRings: -4,   // sand has filled the water rings up to about this height (with drifts)
  visibility: 80,       // m: horizontal visibility (art target; core/underwater.js owns the actual coefficients)
};

// ------------------------------------------------------------------ the concentric rings
// radii in metres from the origin; `top` = ground height of land rings (their edges drop as rock faces /
// quay walls into the water rings); `floor` = water ring bed (golden era).
export const CITADEL = {
  radius: 230,           // shore of the central island (quay wall + orichalcum wall at r ≈ 226)
  summit: 62,            // flat plateau height (temple podium stands on it). r3 (director): 45 → 62 — refs 1, 2, 4, 5 show the hill 2-3x taller and steep
  plateau: 110,          // plateau radius
  terraces: [            // ring-shaped ledges down the hill (palaces, gardens, fountains, statues). r3: steeper, higher (was 150-172 @ 32, 192-208 @ 18);
                         // the plateau rim drops 20 m over 4 m (r 110 → 114): a sheer retaining wall = the red orichalcum rampart band of ref 5 / ref 4
    { r0: 114, r1: 160, y: 42 },
    { r0: 178, r1: 198, y: 22 },
  ],
  quayY: 3,              // shore quay band r 214..230
  wall: { r: 226, height: 12, cladding: 'orichalcum' },
};

export const RINGS = [
  { id: 'w1', kind: 'water', r0: 230, r1: 350, floor: -10 },                                         // r3 (director): r1 300 → 350 (ref 5: the citadel shore ≈ 135-200 m from the terrace; ref 1 w1 wider than w2's land)
  { id: 'l1', kind: 'land', r0: 350, r1: 440, top: 14, wall: { cladding: 'tin', height: 14 } },      // ship-sheds cut into its faces (ref 4)
  { id: 'w2', kind: 'water', r0: 440, r1: 560, floor: -12 },
  { id: 'l2', kind: 'land', r0: 560, r1: 820, top: 10, wall: { cladding: 'bronze', height: 16 } },   // racecourse, gardens, houses (ref 5 terrace)
  { id: 'w3', kind: 'water', r0: 820, r1: 900, floor: -10 },                                         // north half only: the south opens to the sea
];
export const ringById = (id) => RINGS.find((r) => r.id === id);

// The south sector (compass bearing from the origin in [SEA_SECTOR[0], SEA_SECTOR[1]]) beyond land ring 2 is
// open sea; elsewhere water ring 3 is followed by the outer city on the plain.
export const SEA_SECTOR = [112, 248];
export const OUTER_CITY = { r0: 900, r1: 1900, y: 5 };

// Sea canal: due south along x = 0 from water ring 2 out to the sea. Open cut through land ring 2
// (bridged by the great gate bridge, ref 2), covered tunnel through land ring 1 (ref 4), moles with
// lighthouses at the sea mouth (ref 1).
export const SEA_CANAL = { x: 0, width: 70, floor: -10, z0: 350, z1: 1060 };   // r3: z0 = l1.r0 (w1 widened)
export const GATE_BRIDGE = { z: 690, deck: 30, arch: { span: 56, rise: 26 }, towers: { offset: 52, height: 58 } }; // ref 2 / ref 7
export const CANAL_TUNNEL = { z0: 350, z1: 440, clear: 22 };          // through land ring 1 (r3: z0 300 → 350, w1 widened)
export const MOLES = [
  { side: -1, from: [-55, 820], to: [-55, 930], lighthouse: [-55, 930] },   // r2 (director): 1050 → 930, ref 1 lighthouses stand just off the outer ring (shot-1 solve)
  { side: 1, from: [55, 820], to: [55, 930], lighthouse: [55, 930] },
];

// Ring bridges (arched, gate tower at each end) cross the water rings at these compass bearings.
// The south axis (180) is the canal: there the crossings are the gate bridge and the tunnel instead.
export const RING_BRIDGES = [
  { ring: 'w1', bearings: [0, 90, 270, 180] },        // 180: high arch over the canal mouth into w1
  { ring: 'w2', bearings: [0, 60, 120, 240, 300] },
  { ring: 'w3', bearings: [0, 45, 315] },
];

// ------------------------------------------------------------------ citadel buildings
// r2 (director): width 46 → 54, length 92 → 100, centre z -12 → -16 (front podium face stays at z 34, front columns
// at z ≈ 19.6). Refs 3/6/9 solved: column height / facade width ≈ 0.31 (ours was 0.38) — rms 27 → 11 px.
export const TEMPLE = {                // Temple of Poseidon (ref 3): front faces SOUTH toward the stair
  center: [0, CITADEL.summit, -16], heading: 180, width: 54, length: 100, podium: 6, height: 24,
};
export const CHARIOT = { pos: [0, CITADEL.summit, 46], heading: 180, pedestal: 7 };   // Poseidon + 6 winged horses (ref 3). r2: z 56 → 46 (closer to the temple stair: the group overlaps the lower colonnade from the shot-3 landing camera)
// r2 (director): 5 Nereids (no basin on the axis in front of the pedestal: refs 3/6 show two at each front corner)
export const NEREIDS = { center: [0, CITADEL.summit, 47], radius: 20, count: 5 };      // r3: radius 24 → 20 → front basins (±11.8, 63.2), side (±19, 40.8)      // Nereids on dolphins around the chariot
export const FOUNTAINS = [                                                              // hot (steaming) and cold springs
  { id: 'hot', pos: [-31, CITADEL.summit, 57], radius: 8 },                             // r3: (±26, 62) → (±31, 57), clear of the longer north flight (x ±19). r2: (±30, 78) r 9 → (±26, 62) r 8
  { id: 'cold', pos: [31, CITADEL.summit, 57], radius: 8 },
];
export const COLOSSUS = { pos: [0, CITADEL.summit, -78], height: 30, pedestal: 30, heading: 180 }; // Poseidon with trident behind the temple (refs 1, 5). r3 (director): pedestal 22 → 30 — the feet stand at the temple ridge (refs 1, 4, 5: the whole figure rises above the roof); trident tip ≈ 133
// r3 (director): ref 9 — what breaks the sunken surface (104): the colossus fell (its head is the ref-8 set) but its gold trident
// (≈ 41 m, butt in the socket on the pedestal top, 92) still stands, tip ≈ 29 m above the water ("gold trident in the centre");
// two tall citadel towers flank the colossus behind the temple (refs 4 / 5 slender white towers beside the temple): roof 110,
// tholos + trident finial above (golden tip ≈ 119); sunken: lantern ruined, the broken top 8-12 m above the water (ref 9).
// Built by the bridges module with the gate-tower kit (src/bridges/pinnacles.js).
export const CITADEL_TOWERS = { size: 9, roof: 110, list: [{ pos: [-54, -84] }, { pos: [54, -84] }] };   // r3: roof 110, tholos tip ≈ 119; at bearing ≈ ±33° r 100 (clear of the rear tholoi and the 40° cascades)
export const SUNKEN_TRIDENT = { standing: true, rubble: 2.5 };   // statues module: sunken colossus = trident upright on the pedestal + a rubble heap of the feet
export const CITADEL_STAIR = { x: 0, width: 34, from: [0, CITADEL.summit + 13, 97], to: [0, CITADEL.quayY, 226] }; // r3: from y = STAIR_HEAD.y (75) // grand stair down the south face. r2: starts on the raised stair-head landing (STAIR_HEAD), was [0, 45, 110]
// r2 (director): raised stair head (refs 3 / 6: the camera stands on a landing ABOVE the forecourt and looks down a short,
// broad flight of steps into the court). Landing y 50 (5 m above the court) z 97 → 104 (the grand stair's top tread);
// the north flight descends from the landing (z 97, y 50) to the court (z 79, y 45), same width as the grand stair.
// heightfield.js raises the ground under both; the temple module builds the flight (request in docs/COMPOSITION.md).
// r3 (director): the landing rises 13 m above the court (y 75; eye 79 → sea horizon at row ≈ 314 like ref 3) and the north flight
// is long (z 97 → 68, 13 m drop, ≈ 24°): back-projecting ref 3 from the landing puts the flight foot at z ≈ 65 and the forecourt
// (rose, Nereid basins) at z 50-62, i.e. tighter against the pedestal.
export const STAIR_HEAD = { x: 0, width: 34, y: CITADEL.summit + 13, landing: [97, 104], flight: { from: [0, CITADEL.summit + 13, 97], to: [0, CITADEL.summit, 68] } };
export const FORECOURT = { rose: { center: [0, 60], radius: 5.5 } };   // r3: [0, 72] r 6.5 → [0, 60] r 5.5 (the longer north flight reaches z 68; ref 3 back-projection)   // r2: compass-rose mosaic between the front Nereids, in front of the pedestal (was hard-coded [0, 94])

// ------------------------------------------------------------------ land ring features
export const RACECOURSE = { ring: 'l2', bearing: 70, length: 320, width: 64 };
export const SHIP_SHEDS = [            // rock-cut arched sheds at water level (ref 4)
  { ring: 'l1', face: 'inner', bearings: [20, 160] },
  { ring: 'l1', face: 'outer', bearings: [200, 340] },
  { ring: 'l2', face: 'inner', bearings: [20, 100] },
];
export const GARDEN_TERRACE = { ring: 'l1', bearing: 198, r: 352, deck: 28, size: [28, 18] };   // ref 5 viewpoint terrace: a garden bastion ON TOP of the l1 INNER wall (wallR = l1.r0 - 2.5, wall top 28; r3: r 302 → 352 with the wider w1), overlooking water ring 1 toward the citadel (r1: moved from l2, where the l1 wall blocked the view); size = [along the wall, radial]. r2 (director): bearing 135 → 100 so the w1-90 ring bridge recedes from the right of the shot-5 frame toward the citadel (ref 5). r3 (director): bearing 100 → 198 — ref 5 sees the temple FRONT with the colossus right behind it (only true from the south: rms 33 px vs ≥ 110 from bearing 100; 190 fits better but the grand stair hides the temple); the w1-180 bridge is just off the right edge

// ------------------------------------------------------------------ sunken-era features
export const FALLEN_HEAD = { pos: [140, RINGS[1].top, 366], heading: 220, size: 9 };   // ref 8: head of the fallen colossus (≈ 9 m tall)
export const FALLEN_TRIDENT = { pos: [118, RINGS[1].top, 384], heading: 300, length: 34 };
export const WRECKS = [{ pos: [-14, -9, 742], heading: 160, length: 36 }];              // ref 7: trireme wreck under the gate bridge

// ------------------------------------------------------------------ landscape
export const MOUNTAINS = { bearing: 32, arc: 96, near: 5200, far: 14000, peak: 2400, scale: 0.62 };   // r4 (director): scale = vertical scale of the baked wall above the plain (src/terrain/far.js scaleMountains): ref 1 shows the wall ≈ 4° above the horizon, ours was ≈ 7° (back range reached the frame top);   // wall of mountains to the north / north-east (bearings ≈ 344-80°): the golden sun (az ≈ 292) sets over OPEN SEA in the WNW (refs 1-5)
export const ISLANDS = [ { center: [-2600, 1400], r: 260, top: 70 }, { center: [-3800, 600], r: 420, top: 120 }, { center: [2900, 2200], r: 300, top: 60 } ];

// ------------------------------------------------------------------ sun (defaults; per-shot looks in looks.js)
export const SUN = { azimuth: 292, elevation: 9 };          // golden: low sun in the west-north-west
export const SUN_SUNKEN = { azimuth: 210, elevation: 58 };  // sunken: high sun for strong shafts through the surface

// ------------------------------------------------------------------ helpers
export function dirFromAzEl(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}
/** rotation.y for an object whose local front is +Z so that it faces compass heading `deg` */
export function headingToRotY(deg) { return Math.PI - (deg * Math.PI) / 180; }
/** compass bearing (deg) of a point seen from the origin */
export function bearingOf(x, z) { return ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360; }
/** point at radius r and compass bearing b (deg) */
export function polar(r, bDeg) { const b = (bDeg * Math.PI) / 180; return [Math.sin(b) * r, -Math.cos(b) * r]; }
/** which ring (or 'citadel' / 'sea' / 'outer') a radius + bearing falls in */
export function zoneAt(x, z) {
  const r = Math.hypot(x, z), b = bearingOf(x, z);
  if (r < CITADEL.radius) return 'citadel';
  for (const g of RINGS) if (r < g.r1) { if (g.id === 'w3' && inSeaSector(b)) return 'sea'; return g.id; }
  return inSeaSector(b) ? 'sea' : 'outer';
}
export function inSeaSector(b) { return b >= SEA_SECTOR[0] && b <= SEA_SECTOR[1]; }

// ------------------------------------------------------------------ terrain module (additive)
// Small rocky islets in the sea near the canal mouth / city (ref 1 foreground rocks with palms); the big
// distant islands are ISLANDS above. top = rock summit height (golden sea level 0).
// distant islands in the west sea under the setting sun (ref 1 horizon, left)
export const ISLANDS_FAR = [
  { center: [-6000, -1700], r: 520, top: 85 },
  { center: [-9400, -3600], r: 850, top: 170 },
  { center: [-12500, -900], r: 650, top: 110 },
  { center: [-7600, -6900], r: 760, top: 230 },
  { center: [-4700, 300], r: 260, top: 45 },
];
export const ISLETS = [
  { center: [-470, 1240], r: 125, top: 22 },   // ref 1 bottom-left headland islet (palms)
  { center: [-760, 1010], r: 55, top: 11 },
  { center: [640, 930], r: 75, top: 14 },      // ref 1 right rocks
  { center: [900, 1260], r: 48, top: 9 },
  { center: [-250, 1560], r: 32, top: 6 },
  { center: [330, 1450], r: 26, top: 5 },
  { center: [-1250, 1500], r: 90, top: 16 },
  { center: [1500, 1700], r: 110, top: 20 },
  // r4 (director): the r4 shot-1 camera (z 1314, y 192) sees the sea only between the l2 wall (z ≈ 800) and z ≈ 1000, |x| < 340:
  // ref 1's bottom-left palm headland, the right rocks against the l2 wall and two small rocks at the bottom edge
  { center: [-262, 930], r: 52, top: 13 },
  { center: [-168, 990], r: 13, top: 4 },
  { center: [318, 838], r: 27, top: 9 },
  { center: [205, 982], r: 12, top: 4.5 },
];

// ------------------------------------------------------------------ ships (added by the ships agent)
// hero trireme of shot 2 (ref 2): leaving the canal toward the camera, bow (eye) on the left of frame
export const SHIPS = {
  hero: { pos: [-17, 0, 792], heading: 188, heel: 0.015 },   // r4 (director): ref-2 fit on bow / stern waterline + sail corners (out/director/r4/fit2ship.mjs): 14 m farther, more bow-on (rms 146 → 60 px; was [-12, 0, 806] h 200)   // r2 (director): shot-2 solve — mast ≈ 50 m ahead-left of the camera, bow toward the camera-left (ref 2)
  // ref 7 wreck pose (overrides WRECKS[0] pos/heading for the ships module): bow to the left, away from the shot-7 camera
  wreck: { pos: [-15, 790], heading: 198, roll: -0.15, pitch: 0.14, lift: 0.5 },   // r2 (director): shot-7 solve — bow near-left, stern toward the left pier (ref 7)
};

// ------------------------------------------------------------------ rings / bridges (arch-a, r3; additive)
// Shed mole (ref 4 / shot 4): a rock-cut harbour mole in water ring 1, rooted in land ring 1 at bearing ≈ 152-160 and
// running north along the right of the shot-4 frame (14-34 m from the camera): ship-sheds in its west face (triremes:
// ships module, registry.rings.sheds), the tin curtain + pylons above; its head carries a water tunnel and an arched
// bridge to the citadel quay straight ahead of the camera (ref 4: bridge + tunnel at the end of the shed row).
// Frame: `head` = point of the shed-front line (west face, water level) on the bridge axis; s = metres along `heading`
// (north +), lat = metres east of the shed-front line. Built by src/rings/mole.js + src/bridges/mole.js.
export const SHED_MOLE = {
  head: [118.9, 222.8], heading: 359, back: 112, front: 12, depth: 4, shedBack: 32, width: 34, landY: 14, wallH: 12,   // depth: shed fronts project 4 m (the curtain stays visible from the low shot-4 eye)
  sheds: [-97, -18], pitch: 13.2,
  tunnel: { s: [-18, 8], width: 13, clear: 10 },        // tunnel block in front of the head (lat -13..0), passage along s
  bridge: { s: -10, heading: 285, deck: 15.5, halfWidth: 5.2, gateHalf: 9 },   // axis at s = -10; lands at bearing ≈ 165, west of the citadel spout at 158 (its fall lands ≈ 6 m behind the bridge: seen through the arches)
  shipClear: { from: [98.24, 321.32], r: 27 },           // no moored ship within this of the shot-4 camera (director)
};
