// World layout: the master plan every module builds against. OWNER: director.
// Units: metres. Compass: -Z north, +X east, +Y up. Golden-age sea level is y = 0.
// The city centre (temple hill) is at the origin. All cameras look roughly north (the sun sets on the
// left of frame, i.e. in the west / north-west) — see docs/COMPOSITION.md and src/world/shots.js.
//
// Era: engine.era is 'golden' or 'sunken'. The layout is the SAME in both eras; the sunken era raises
// the sea to SUNKEN.surface and modules apply ruin / growth / sand (see docs/CONTRACT.md "Eras").
export const SEA_LEVEL = 0;

export const SUNKEN = {
  surface: 78,          // sea surface in the sunken era: temple ridge ≈ 75 sits 3 m under it, the 5 m ridge tridents / pinnacles break it (ref 9). r1: 64 → 78
  sandLevelRings: -4,   // sand has filled the water rings up to about this height (with drifts)
  visibility: 80,       // m: horizontal visibility (art target; core/underwater.js owns the actual coefficients)
};

// ------------------------------------------------------------------ the concentric rings
// radii in metres from the origin; `top` = ground height of land rings (their edges drop as rock faces /
// quay walls into the water rings); `floor` = water ring bed (golden era).
export const CITADEL = {
  radius: 230,           // shore of the central island (quay wall + orichalcum wall at r ≈ 226)
  summit: 45,            // flat plateau height (temple podium stands on it)
  plateau: 110,          // plateau radius
  terraces: [            // ring-shaped ledges down the hill (palaces, gardens, fountains, statues)
    { r0: 150, r1: 172, y: 32 },
    { r0: 192, r1: 208, y: 18 },
  ],
  quayY: 3,              // shore quay band r 214..230
  wall: { r: 226, height: 12, cladding: 'orichalcum' },
};

export const RINGS = [
  { id: 'w1', kind: 'water', r0: 230, r1: 300, floor: -10 },
  { id: 'l1', kind: 'land', r0: 300, r1: 440, top: 14, wall: { cladding: 'tin', height: 14 } },      // ship-sheds cut into its faces (ref 4)
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
export const SEA_CANAL = { x: 0, width: 70, floor: -10, z0: 300, z1: 1060 };
export const GATE_BRIDGE = { z: 690, deck: 30, arch: { span: 56, rise: 26 }, towers: { offset: 52, height: 58 } }; // ref 2 / ref 7
export const CANAL_TUNNEL = { z0: 300, z1: 440, clear: 22 };          // through land ring 1
export const MOLES = [
  { side: -1, from: [-55, 820], to: [-55, 1050], lighthouse: [-55, 1050] },
  { side: 1, from: [55, 820], to: [55, 1050], lighthouse: [55, 1050] },
];

// Ring bridges (arched, gate tower at each end) cross the water rings at these compass bearings.
// The south axis (180) is the canal: there the crossings are the gate bridge and the tunnel instead.
export const RING_BRIDGES = [
  { ring: 'w1', bearings: [0, 90, 270, 180] },        // 180: high arch over the canal mouth into w1
  { ring: 'w2', bearings: [0, 60, 120, 240, 300] },
  { ring: 'w3', bearings: [0, 45, 315] },
];

// ------------------------------------------------------------------ citadel buildings
export const TEMPLE = {                // Temple of Poseidon (ref 3): front faces SOUTH toward the stair
  center: [0, CITADEL.summit, -12], heading: 180, width: 46, length: 92, podium: 6, height: 24,
};
export const CHARIOT = { pos: [0, CITADEL.summit, 56], heading: 180, pedestal: 7 };   // Poseidon + 6 winged horses (ref 3)
export const NEREIDS = { center: [0, CITADEL.summit, 56], radius: 24, count: 8 };      // Nereids on dolphins around the chariot
export const FOUNTAINS = [                                                              // hot (steaming) and cold springs
  { id: 'hot', pos: [-30, CITADEL.summit, 78], radius: 9 },
  { id: 'cold', pos: [30, CITADEL.summit, 78], radius: 9 },
];
export const COLOSSUS = { pos: [0, CITADEL.summit, -78], height: 30, pedestal: 22, heading: 180 }; // Poseidon with trident behind the temple (refs 1, 5)
export const CITADEL_STAIR = { x: 0, width: 34, from: [0, CITADEL.summit, 110], to: [0, CITADEL.quayY, 226] }; // grand stair down the south face (ref 3 camera stands on it)

// ------------------------------------------------------------------ land ring features
export const RACECOURSE = { ring: 'l2', bearing: 70, length: 320, width: 64 };
export const SHIP_SHEDS = [            // rock-cut arched sheds at water level (ref 4)
  { ring: 'l1', face: 'inner', bearings: [20, 160] },
  { ring: 'l1', face: 'outer', bearings: [200, 340] },
  { ring: 'l2', face: 'inner', bearings: [20, 100] },
];
export const GARDEN_TERRACE = { ring: 'l1', bearing: 135, r: 302, deck: 28, size: [28, 18] };   // ref 5 viewpoint terrace: a garden bastion ON TOP of the l1 INNER wall (wallR 297.5, wall top 28), overlooking water ring 1 toward the citadel (r1: moved from l2, where the l1 wall blocked the view); size = [along the wall, radial]

// ------------------------------------------------------------------ sunken-era features
export const FALLEN_HEAD = { pos: [140, RINGS[1].top, 366], heading: 220, size: 9 };   // ref 8: head of the fallen colossus (≈ 9 m tall)
export const FALLEN_TRIDENT = { pos: [118, RINGS[1].top, 384], heading: 300, length: 34 };
export const WRECKS = [{ pos: [-14, -9, 742], heading: 160, length: 36 }];              // ref 7: trireme wreck under the gate bridge

// ------------------------------------------------------------------ landscape
export const MOUNTAINS = { bearing: 32, arc: 96, near: 5200, far: 14000, peak: 2400 };   // wall of mountains to the north / north-east (bearings ≈ 344-80°): the golden sun (az ≈ 292) sets over OPEN SEA in the WNW (refs 1-5)
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
];

// ------------------------------------------------------------------ ships (added by the ships agent)
// hero trireme of shot 2 (ref 2): leaving the canal toward the camera, bow (eye) on the left of frame
export const SHIPS = {
  hero: { pos: [-16, 0, 862], heading: 185, heel: 0.015 },
  // ref 7 wreck pose (overrides WRECKS[0] pos/heading for the ships module): bow to the left, away from the shot-7 camera
  wreck: { pos: [-11, 759], heading: 204, roll: -0.15, pitch: 0.14, lift: 0.5 },
};
