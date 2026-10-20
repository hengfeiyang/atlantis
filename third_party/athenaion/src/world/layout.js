// =====================================================================================
//  MASTER PLAN of the world ("Athenaion"). Units: metres. +Y up. Sea level y = 0.
//  Compass convention: -Z = north (toward the snowy range), +X = east, +Z = south, -X = west.
//  OWNER: director (composition). See docs/COMPOSITION.md for why things are where they are.
//
//  Every module reads positions from here, so moving a feature moves everything attached
//  to it (terrain shaping, buildings, waterfalls, vegetation exclusion, cameras).
//
//  Composition logic (round 1): every reference looks at the temple FRONT from the front-right
//  (the right flank of the temple is always visible). So the temple faces SOUTH, toward the
//  lagoon gorge, and almost all cameras stand south / south-south-east of it:
//    shots 3, 8, 9  ruins promontory SSE of the temple (top 52, raised platforms 56), 200-240 m away
//    shot 4         floating over the lagoon gorge (y 94), 175 m SE of the temple, looking down WNW
//    shot 2         on the lagoon surface south-west of the stair foot (island tholos centred)
//    shot 7         on the lagoon, south-east of the stair foot, looking up the face
//    shot 6         on the grand stair (south face) looking up
//    shot 5         on the forecourt in front of the temple podium, ~35 m from the facade
//    shot 1         high rocks at the south-east corner of the massif, looking west over the city
//
//  Top view (not to scale):
//
//        N (-Z)          ~~~ snowy mountain range (north / north-west / west) ~~~
//     WEST_CRAG + hilltops          ╲ river from the north-west, canyon + AQUEDUCTS
//            HILL_TEMPLE crag (-424,-284)  ╲          ACROPOLIS (plateau y=54, temple podium 67.5)
//      CITY on west hills                   ╲         TEMPLE faces south, COLOSSI
//                                     canyon ╲___     south face = TERRACES + GRAND_STAIR
//                                                ╲ LAGOON gorge along the south face, ISLAND tholos
//      HARBOUR / SEA (south-west)                      RUINS_TERRACE promontory (south-south-east)
//        S (+Z)  open sea
// =====================================================================================

export const SEA_LEVEL = 0;

// ---------------------------------------------------------------- acropolis massif
// The references show the temple standing at the very edge of a sheer limestone cliff (podium wall
// + cliff ≈ 3.5 temple heights above the water), so the plateau is compact and the south face steep.
export const ACROPOLIS = {
  center: [32, -72],
  top: 54,                       // plateau height; the temple stands on a 12 m podium wall above it (stylobate ≈ 67.5, refs 1, 3, 5, 9)
  // irregular outline of the plateau top (XZ). South rim runs just in front of the temple front.
  outline: [
    [-52, -120], [-20, -144], [40, -150], [98, -136], [130, -98], [126, -56], [100, -34], [74, -28],
    [44, -28], [40, -10], [8, -10], [5, -28], [-22, -29], [-46, -32], [-58, -56], [-62, -90],
  ],
  // terraced south face: [cliff run (m), drop (m), ledge width (m)] from the plateau rim outward.
  // Ledges are narrow (buildings, cypress rows, balustrades stacked on the face, refs 1/3/9).
  terraces: [
    { run: 3.5, drop: 12, ledge: 12 },  // ledge at y≈42
    { run: 3.5, drop: 12, ledge: 15 },  // y≈30 (widest: stoas / small temples)
    { run: 3.5, drop: 11, ledge: 12 },  // y≈19
    { run: 3.5, drop: 10, ledge: 12 },  // y≈9 — lowest quay terrace above the lagoon
  ],
  // compass sector (deg, outward from the centre) that carries the terraces; outside it the
  // massif drops as sheer cliffs (west face into the canyon, east and north faces)
  terraceSector: [118, 236],
  // ledges are widened where the acropolis module puts its terrace buildings (src/acropolis/buildings.js
  // site list): k = terrace index (0 = first ledge below the rim), x = site centre, w = width along the
  // face, depth = ledge depth needed (m)
  sites: [
    { k: 0, x: -24, w: 26, depth: 24 }, { k: 0, x: 86, w: 14, depth: 18 }, { k: 0, x: 108, w: 24, depth: 24 },
    { k: 1, x: -38, w: 20, depth: 18 }, { k: 1, x: 98, w: 44, depth: 21 },
    { k: 2, x: -44, w: 22, depth: 24 }, { k: 2, x: 106, w: 34, depth: 20 },
  ],
  // sheer bay under the temple front and colossus A (refs 2, 3, 5, 7): the first ledge stays deep (the
  // podium terrace of shot 5), the lower ledges shrink to narrow steps so the cliff drops straight into
  // the lagoon gorge. [x0, x1, first-ledge depth (m), lower-ledge width factor]
  sheerBay: [42, 80, 18, 0.16],
};

// ---------------------------------------------------------------- main temple (Athenaion)
// Octastyle peripteral Doric temple, Parthenon proportions. FRONT faces SOUTH (heading 180),
// toward the grand stair, the lagoon gorge and the camera viewpoints.
export const TEMPLE = {
  center: [20, 66, -64],
  heading: 180,           // compass heading the front faces
  rotY: Math.PI / 2,      // legacy: temple module uses headingToRotY(270) + rotY  (= heading 180)
  stylobate: [70, 31],    // length (along the axis) x width (front)
  columns: [8, 17],       // front x side
  columnHeight: 10.4,
  order: 'doric',
};
/** footprint helpers for modules: front centre, axis unit vector (toward the front), half sizes */
export const TEMPLE_FRONT = (() => {
  const a = (TEMPLE.heading * Math.PI) / 180, fx = Math.sin(a), fz = -Math.cos(a);
  return { x: TEMPLE.center[0] + fx * TEMPLE.stylobate[0] / 2, z: TEMPLE.center[2] + fz * TEMPLE.stylobate[0] / 2, dir: [fx, fz] };
})();

// ---------------------------------------------------------------- colossal statues of Athena
// A: the largest, right of the temple front (front-right corner bastion), seen right of the
//    pediment in every reference (1, 2, 3, 4, 5, 7, 8, 9)
// C: left of the front (west forecourt), the smaller figure left of the temple in most references
// B: the foreground colossus of the aerial view (ref 4): on a tower bastion of the ruins promontory
export const COLOSSI = [
  { id: 'A', pos: [50, 55, -33], pedestal: 13, height: 21, facing: 165 }, // facing = compass deg the statue looks toward; pedestal top ≈ stylobate level
  { id: 'B', pos: [-71.5, 113.4, 181.1], pedestal: 5, height: 21, facing: 40, mirror: true, bastion: { w: 10 } }, // (director r5) re-solved on the r5 shot-4 camera (west canyon view): whole 21 m figure in the top-left corner (helmet + spear at the top edge, shield + banner below it, like ref 4), feet at px ≈ (235,520), ≈ 85 m from the camera (at ≥ 100 m its shadow fell on the shot-7 hero olive: checked by render diffs with/without B for shots 1-3, 5-9 → no change), on a sea-stack bastion rising from the lagoon in front of the port quarter (bottom-left of shot 4, hides the moored fleet); faces 40 (toward the stair/temple, looking right into the scene), shield (mirrored, right arm) toward the camera; bastion banners on its S/E faces face the camera. Outside every other frustum by ≥ 23° (shots 1-3, 5-9 checked)
  { id: 'C', pos: [-10, 60, -33], pedestal: 13, height: 17, facing: 172 }, // (statues r3) x -6 → -10: the podium's SW corner hid C's lower 60 % from shot 5 (ref 5 shows it whole). (director r5) pedestal 5 → 13 (like A) and figure 14 → 17 m: C's feet at the stylobate level and its upper body above the west stair-flank cypresses, so it stands left of the temple at the top of the stair in shot 6 (ref 6) and left of the temple in 2/3/4/7/8/9
];

// ---------------------------------------------------------------- grand staircase on the south face
export const GRAND_STAIR = {
  x: 24,                // axis x (just east of the temple axis x=20: refs 2, 3, 4, 9 put the stair under the front centre/right)
  zTop: -10, yTop: 54,  // top landing (forecourt bastion) at the plateau rim, 14 m deep in front of the temple
  zBottom: 104, yBottom: 2,
  width: 16,
  // (acropolis module) the actual profile is computed from the terrain: landings at every terrace
  // level, long flights split by half-landings, ending on a water quay. The built plan is published
  // as engine.registry.acropolis.stair ({ segs: [{kind, z0, z1, y0, y1, w}] }) and .surface(z).
  riser: 0.23, tread: 0.33, landing: 7, midLanding: 2.8, flightRise: 8.5, // (acropolis r2) bigger steps, same slope (ref 6) // max rise per flight before a half-landing
  widths: [12, 14, 16, 18, 21],   // flight widths from the top flight down
};

// ---------------------------------------------------------------- water bodies
// Lagoon gorge along the foot of the south face, between the acropolis and the ruins promontory;
// it opens to the south-west (outflow to the sea) and receives the river from the canyon (west).
export const LAGOON = { center: [-40, 128], radii: [178, 104], floor: -8, basin: [-100, 72, 92, 84] };
export const ISLAND = { center: [-14, 128], radius: 17, top: 6.5 }; // round tholos on a rock island (bridge to the stair foot)

// river from the mountains (north-west) down the canyon along the west face of the acropolis into the lagoon
export const RIVER = {
  points: [[-760, -3200], [-560, -1700], [-468, -1210], [-430, -900], [-392, -650], [-312, -400], [-240, -235], [-178, -120], [-142, -30], [-118, 40]],
  width: [70, 55, 50, 45, 42, 40, 40, 42, 46, 56],
  floor: -4,
};
// channel from the lagoon to the open sea (south-west)
export const CHANNEL = { points: [[-150, 120], [-230, 260], [-330, 420], [-520, 560], [-860, 630]], width: 76 };

// open sea / harbour: south and south-west
export const SEA = {
  southZ: 760,                 // open sea beyond this z (noisy coastline)
  bay: { center: [-1150, 560], radii: [650, 480] },
  floor: -22,
};
export const HARBOUR = { center: [-920, 0, 520] };

// ---------------------------------------------------------------- aqueducts and bridges
// Each spans from A to B at deck height y. tiers = stacked arcades.
// kind 'aqueduct' = open water channel (specus) on top; 'bridge' = paved road deck with balustrade.
// The structure is only built where the deck is above the terrain (ends run into the hillsides).
// end: 'castellum' = terminal water tower at B with the channel spilling out as a waterfall.
export const AQUEDUCTS = [
  // crosses the canyon north-west of the acropolis (left mid-ground of shots 3, 8, 9; top of 4)
  { id: 'high', a: [-330, -200], b: [-64, -104], deck: 50, tiers: 2, archSpan: 12, kind: 'aqueduct' },
  // low road bridge across the canyon mouth to the south-west corner of the massif (shot 7, 2)
  { id: 'low', a: [-250, -10], b: [-62, -6], deck: 24, tiers: 1, archSpan: 15, kind: 'bridge', width: 12.4 },
  // the far one, feeding the hill temple crag (background of shots 3, 8, 9, 6)
  { id: 'hill', a: [-640, -600], b: [-468, -356], deck: 108, tiers: 3, archSpan: 13, kind: 'aqueduct', end: 'castellum' },
  // two-tier aqueduct across the river mouth into the lagoon, ending at the grand stair (left of shots 2, 7; low in 3, 8, 9)
  { id: 'lagoon', a: [-140, 64], b: [10, 58], deck: 24, tiers: 2, archSpan: 13, kind: 'aqueduct' },
];

// ---------------------------------------------------------------- waterfalls
// from: start point at the lip [x, y, z]; dir: horizontal flow direction (deg compass); width (m); flow 0..1
// (the waterfalls module re-snaps every lip to the real cliff edge: ±40 m search)
export const WATERFALLS = [
  // west face of the plateau into the canyon (shot 7 right, shot 4)
  { id: 'acro-w1', from: [-61, 53.5, -70], dir: 262, width: 13, flow: 1.0 },
  { id: 'acro-w2', from: [-53.5, 53.5, -50], dir: 240, width: 10, flow: 0.8 },
  // south face terraces (shots 2, 3, 6, 9, 4)
  { id: 'terr-1', from: [-12, 41.5, -7.5], dir: 185, width: 8, flow: 0.85 },   // x -12: just outside the left edge of shot 6 (seen edge-on there)
  { id: 'terr-2', from: [-60, 53.5, -92], dir: 265, width: 9, flow: 0.8 },
  { id: 'terr-3', from: [-20, 18.5, 35], dir: 195, width: 10, flow: 1.0 },
  { id: 'terr-5', from: [60, 41.5, 0], dir: 176, width: 9, flow: 0.9 },
  { id: 'terr-7', from: [50, 29.5, 18.5], dir: 172, width: 9, flow: 0.8 },
  // plateau rim → first ledge, feeding the terrace cascades (stacked falls under the temple front, refs 2, 3, 7, 9):
  // rim-e in the gap between acro-stoa-1E and acro-temple-1E; fore-e off the east end of the forecourt
  // bastion, right of the grand stair (ref 6: falls behind the right balustrade)
  { id: 'rim-e', from: [72.5, 53.5, -29], dir: 178, width: 5, flow: 0.75 },
  { id: 'fore-e', from: [38, 53.5, -10.5], dir: 180, width: 5, flow: 0.7 },
  // temple podium front, right of the stair top, between the two podium banners of shot 5 (ref 6: the
  // falls pour from under the colonnade, right of the stair, behind the right balustrade)
  { id: 'podium-e', from: [33.5, 66.4, -23.6], dir: 180, width: 3.6, flow: 0.9, aer: 0.5, snap: false, sMax: 17 },
  { id: 'acro-w3', from: [-56.5, 53.5, -110], dir: 260, width: 8, flow: 0.7 },
  // hill temple crag: the big one under the temple (left background of shots 1, 2, 3, 5, 6, 7, 8, 9)
  { id: 'hill-big', from: [-389, 112, -257], dir: 128, width: 9, flow: 1.0 },
  { id: 'hill-2', from: [-630, 203, -660], dir: 130, width: 7, flow: 0.7 },
  // canyon side falls (shot 4)
  { id: 'canyon-1', from: [-262, 52, -262], dir: 110, width: 18, flow: 1.0 },
  { id: 'canyon-w2', from: [-226, 40, -120], dir: 95, width: 9, flow: 0.6 },
  { id: 'island-1', from: [3, 6.5, 128], dir: 95, width: 3, flow: 0.3 },
  // the city hill temple (shot 1, left of the acropolis above the harbour)
  { id: 'city-hill', from: [-560, 144, 136], dir: 80, width: 7, flow: 0.8 },
];

// ---------------------------------------------------------------- other sites
// Hill temple: a limestone crag with a temple on its summit and a big waterfall below it, seen
// behind-left of the acropolis from every south viewpoint (bearing ~300-318° from the cameras).
export const HILL_TEMPLE = { center: [-424, -284], top: 118, notch: 128, facing: 128 }; // notch/facing: compass deg toward the viewpoints
// Ruins terrace: high promontory south-south-east of the temple across the lagoon gorge. The
// cameras of shots 3, 8, 9 stand near its north-west rim looking over the gorge at the temple.
export const RUINS_TERRACE = {
  center: [170, 165], top: 52, radius: 66, // ruined portico, fallen head (radius: coarse extent for exclusions)
  // raised platforms: the shot-3 viewpoint (olive / ruins, eye ≈ 2.4 m) and the shot-9 portico (eye ≈ 1.7 m);
  // the fallen head (shot 8) lies on the lower level between them
  upper: [{ c: [114, 158], r: 22, h: 4.6 }, { c: [158, 130], r: 23, h: 3.8 }, { c: [146, 125], r: 13, h: 3.8 }],
  // promontory top; its north-west edge (a sheer cliff into the gorge) runs ~8-12 m in front of the cameras
  outline: [[94, 162], [106.1, 152.6], [108.8, 149.2], [113, 147.7], [117.8, 149], [119.9, 149.5], [121.3, 150.1], [127.6, 147.6], [130.6, 145.2], [131.8, 141.4], [137, 131.5], [142.3, 136.6], [145.1, 135], [146.5, 133.2], [147.9, 131], [150.1, 128.2], [158, 116], [176, 92], [222, 98], [246, 150], [226, 212], [160, 236], [106, 214]],
};
export const CITY = {
  // polygon of the town on the west hills sloping to the harbour
  outline: [[-1350, -520], [-820, -560], [-800, -260], [-600, -150], [-330, -70], [-245, 40], [-262, 190], [-330, 330], [-430, 430], [-560, 480], [-760, 560], [-1300, 520]],
  // lagoon port quarter (city module, r2): the town also covers this polygon down to the lagoon shore
  // (copy of src/city/port.js PORT_POLY, kept here so other modules can test it without importing the city)
  port: [[-178, 6], [-196, 34], [-212, 70], [-226, 104], [-226, 150], [-244, 178], [-262, 196], [-312, 190], [-318, 120], [-312, 40], [-290, 4], [-232, -6]],
};

// mountain range parameters (terrain module; OWNER: mountains agent)
// hero: the dominant snowy massif right behind the temple in refs 3, 5, 6, 8, 9 (summit ≈ 15° up from
// the ruins promontory and the forecourt). az/dist from ACROPOLIS.center; cone = summit pyramid radius (m);
// spurs = ridges radiating from the summit [compass bearing, length (m), end height (× peak), width ×].
export const MOUNTAINS = {
  nearDist: 2600, peak: 2900,
  hero: {
    az: 319, dist: 12000, peak: 3000, cone: 5000, pow: 1.8, flank: 1.15, // flank: arête cross-profile exponent (1 = planar faces)
    // [bearing, length, end height ×, width ×, crest top ×, profile (0 concave arête, 1 convex shoulder)]
    spurs: [[148, 7000, 0.12, 1.0], [232, 8900, 0.26, 1.1, 0.8, 1], [42, 6000, 0.3, 1.0, 0.92, 1], [338, 7500, 0.5, 1.2], [100, 5800, 0.2, 0.9], [192, 6200, 0.18, 0.9], [285, 5200, 0.35, 0.9]],
    // sub-summits (same fields): the E summit joined to the main one by a high crest (refs 1/5: the massif
    // stays high right of the temple) and the rocky, snowless front peak ~8 km out (rock above the ~1400 m tree line) that stands in front of
    // the snowy massif in refs 3/5/8/9 (cloud banks sit between the two)
    subs: [
      { az: 330, dist: 12500, peak: 2450, cone: 4000, pow: 1.7, flank: 1.15,
        spurs: [[60, 7000, 0.25, 1.0, 0.85, 1], [170, 5500, 0.15, 0.9], [350, 6000, 0.45, 1.1], [222, 2400, 0.85, 1.0, 0.95, 1], [110, 5000, 0.2, 0.9]] },
      { az: 312, dist: 8500, peak: 1350, cone: 2800, pow: 1.5,
        spurs: [[140, 3300, 0.12, 0.9], [220, 3900, 0.25, 1.0, 0.8, 1], [40, 4200, 0.3, 1.0, 0.8, 1], [320, 3300, 0.4, 1.0], [180, 2900, 0.2, 0.9], [90, 3100, 0.2, 0.9]] },
      // N pyramid behind the hill temple in ref 2 (bearing ~355, only shots 2 / 8-edge / 6 look there)
      { az: 356, dist: 12000, peak: 3250, cone: 3000, pow: 1.6, flank: 1.15,
        spurs: [[180, 4500, 0.15, 0.9], [250, 4000, 0.3, 1.0, 0.8, 1], [80, 5000, 0.3, 1.0, 0.8, 1], [0, 5000, 0.5, 1.1], [130, 4000, 0.2, 0.9]] },
    ],
  },
};

// default sun (compass azimuth deg, elevation deg). Shots may override.
export const SUN = { azimuth: 238, elevation: 21 };

/** compass azimuth/elevation (deg) → unit vector pointing toward the sun. az 0 = north(-Z), 90 = east(+X) */
export function dirFromAzEl(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
}
/** compass heading (deg) → rotation.y for an object whose local front is +Z */
export function headingToRotY(deg) { return Math.PI - (deg * Math.PI) / 180; }
