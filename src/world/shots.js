// Camera shots matching the 9 reference images (refs/refN.png, 1672x941). OWNER: director.
// fov = vertical field of view in degrees. era = which world the shot is rendered in ('golden' | 'sunken').
// Framing only: lighting / grading per shot lives in src/world/looks.js.
// dof = {focus: metres, aperture: metres (lens diameter)} — accumulated thin-lens depth of field.
// Round 0: first guesses from the layout; the director solves them against the references in round 1.
export const SHOTS = [
  { id: 1, era: 'golden', name: 'Grand aerial from the south', pos: [0, 430, 1750], target: [0, 10, 80], fov: 42 },
  { id: 2, era: 'golden', name: 'Sea canal, trireme under the gate bridge', pos: [-6, 3, 845], target: [0, 30, 690], fov: 44 }, // r1 (bridges): frame the gate bridge, not the canal-mouth towers
  { id: 3, era: 'golden', name: 'Temple of Poseidon from the citadel stair', pos: [10, 56, 138], target: [-4, 62, 10], fov: 36 }, // r1 (temple agent): closer, tighter
  { id: 4, era: 'golden', name: 'Inner ring, ship-sheds', pos: [258, 1.8, -60], target: [150, 13, -240], fov: 42 }, // r1 (rings): water ring 1, l1 sheds on the right, citadel on the left
  { id: 5, era: 'golden', name: 'Garden terrace toward the citadel', pos: [216.4, 30.2, 216.4], target: [202.25, 28.8, 202.25], fov: 44 }, // eye 2.2 m above the garden terrace deck (L.GARDEN_TERRACE on the l1 inner wall); pitch ≈ -4° (sets)
  { id: 6, era: 'sunken', name: 'Sunken temple', pos: [8, 50.5, 104], target: [-3, 58, 20], fov: 50 }, // r1: within underwater visibility — temple front ≈ 70 m, chariot ≈ 48 m (ref 6)
  { id: 7, era: 'sunken', name: 'Sunken gate bridge from the canal floor', pos: [-8, -5, 748], target: [0, 30, 690], fov: 58 }, // r1 (bridges): within visibility
  { id: 8, era: 'sunken', name: 'Fallen head of Poseidon', pos: [147.9, 15.83, 374.6], target: [137, 16.18, 357.84], fov: 44 }, // r1 (sets): head pose fitted to ref-8 landmarks
  { id: 9, era: 'sunken', name: 'Split level at the surface above the temple', pos: [0, 78.15, 125], target: [0, 68, 0], fov: 62 }, // eye at the sunken surface (L.SUNKEN.surface 78)
];
