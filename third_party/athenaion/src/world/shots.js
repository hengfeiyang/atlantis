// Camera shots matching the 9 reference images (refs/refN.png, 1672x941).
// fov = vertical field of view in degrees. Framing only: lighting/grading per shot lives in src/world/looks.js.
// dof = {focus: metres, aperture: metres (lens diameter)} — accumulated thin-lens depth of field.
// OWNER: director. Composition notes per shot: docs/COMPOSITION.md. Cameras were first solved against
// the reference temple corners (pinhole fit, temple front 31 m / columns 10.4 m), then tuned visually.
export const SHOTS = [
  {
    id: 1, name: 'Panorama from the high rocks',
    pos: [108, 66, 30], target: [15.1, 61.5, -6.7], fov: 40, // r4: 106 m from the temple front (was 123 m, fov 46): temple + colossus A large in the right third, city/port left
  },
  {
    id: 2, name: 'Lagoon and the island tholos',
    pos: [-19, 7, 227], target: [-13.6, 14.8, 127.4], fov: 28.5,
  },
  {
    id: 3, name: 'From the ruined terrace (olive tree)',
    pos: [122, 59, 154], target: [60, 50.7, 76.3], fov: 35.6, // r4: pitched up 1.25 deg (summit pyramid with sky above, ref 3)
  },
  {
    id: 4, name: 'Aerial over the canyon',
    pos: [-20, 160, 230], target: [-39.7, 101.9, 151], fov: 43, // r5: west canyon view (yaw 346, pitch -35.5): canyon + 3 arched crossings + west-face falls centre-left, stair diagonal right, temple top-right, island tholos bottom, colossus B on its sea-stack bastion bottom-left (was: SE view over the wide lagoon bay)
  },
  {
    id: 5, name: 'Temple facade, low angle',
    pos: [75, 62, 66], target: [32.73, 74.2, -24.23], fov: 18.5, // r4: pitch +2.2 deg, yaw +2 deg, fov 20 -> 18.5: colossus A whole (helmet in frame), temple larger and further left (ref 5)
  },
  {
    id: 6, name: 'Grand staircase',
    pos: [24, 26.8, 50], target: [-11.3, 60.2, -37.4], fov: 42, // r5: yaw 342 -> 338, pitch 21.6 -> 19.5, fov 38 -> 42: colossus C (now on a 13 m pedestal) stands left of the temple at the top of the stair (ref 6); left frame edge now reaches bearing ~304 (massif side)
  },
  {
    id: 7, name: 'River level, waterfalls and aqueduct',
    pos: [70, 4, 125], target: [27.1, 24.8, 37.1], fov: 40,
  },
  {
    id: 8, name: 'Fallen head (panta rhei)',
    pos: [134.4, 54, 145], target: [83.2, 47.4, 59.5], fov: 34.7, near: 0.2, // r4: pitched up 1.25 deg (summit pyramid with sky above, ref 8)
    dof: { focus: 6, aperture: 0.0 },
  },
  {
    id: 9, name: 'Through the ruined portico',
    pos: [151.56, 57.8, 139.41], target: [83.16, 60, 66.41], fov: 36.5, near: 0.3, // r2: tighter on the acropolis
  },
];
