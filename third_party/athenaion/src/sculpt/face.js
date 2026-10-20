// Classical (idealised Greek) head as an SDF, in HEAD UNITS: chin y=-0.5, crown y=+0.5, face toward +Z,
// origin at the centre of the skull (ear level ~ y 0, z -0.02). Scale it in the caller.
//
//   const head = classicalHead({ sex: 'f', hair: 'wavy', seed: 3 });
//   head.sdf(x, y, z)   → distance in head units
//   head.hairSdf        → hair only (for material masks)
//
// Landmarks (female, midline): hairline y .29 · glabella y .05 z .40 (Greek profile: forehead and nose
// in one line) · nose tip y -.17 z .485 · subnasale y -.215 · mouth y -.297 · chin front z .39 · menton -.5.
import { sd, smin, smax, sstep, clamp, Group, ellipsoidR, rotX, rotY, rotZ, mmul, capsule, cone, vnoise3, hash1 } from './sdf.js';

const E = (cx, cy, cz, rx, ry, rz, k, extra = {}) => ({
  f: (x, y, z) => sd.ellipsoid(x - cx, y - cy, z - cz, rx, ry, rz), c: [cx, cy, cz], r: Math.max(rx, ry, rz), k, ...extra,
});
const ER = (c, m, rx, ry, rz, k, extra = {}) => ({ f: (x, y, z) => ellipsoidR(x, y, z, c, m, rx, ry, rz), c, r: Math.max(rx, ry, rz), k, ...extra });
const C = (a, b, ra, rb, k) => ({ f: (x, y, z) => cone(x, y, z, a, b, ra, rb), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], r: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2 + Math.max(ra, rb), k });

export function classicalHead(o = {}) {
  const fem = (o.sex || 'f') === 'f';
  const seed = o.seed || 1;
  const jw = fem ? 1.0 : 1.08;   // jaw width
  const bk = fem ? 1.0 : 1.3;    // brow strength
  const cz = fem ? 0.0 : 0.012;  // chin projection

  // ---------------------------------------------------------- skull + face masses
  const g = new Group([], 0.06);
  g.add(E(0, 0.11, -0.07, 0.335, 0.4, 0.425, 0.08));                       // cranium
  g.add(E(0, 0.17, 0.133, 0.265, 0.21, 0.26, 0.07));                       // forehead
  g.add(E(0, 0.0, 0.1, 0.285, 0.17, 0.265, 0.07));                         // eye level (temples)
  g.add(E(0, -0.12, 0.09, 0.272 * jw, 0.17, 0.27, 0.07));                  // cheekbone level
  g.add(E(0, -0.28, 0.145, 0.19 * jw, 0.16, 0.24, 0.07));                  // muzzle (dental arch)
  g.add(E(0, -0.42, 0.3 + cz, 0.1 * jw, 0.082, 0.098, 0.05));             // chin
  g.add(E(0, 0.056, 0.352, 0.065, 0.05, 0.05, 0.04));                      // glabella (continuous with the nose)
  for (const s of [-1, 1]) {
    g.add(C([0.205 * s * jw, -0.29, -0.02], [0.066 * s * jw, -0.432, 0.235], 0.08 * jw, 0.06, 0.07)); // jaw line
    g.add(E(0.15 * s, -0.16, 0.222, 0.11, 0.13, 0.11, 0.09));                 // cheeks (full, soft; r3 narrower oval)
    g.add(E(0.205 * s, -0.035, 0.205, 0.08, 0.062, 0.09, 0.05));             // zygomatic arch
    g.add(ER([0.112 * s, 0.07, 0.318], rotZ(-0.12 * s), 0.108, 0.034 * bk, 0.072, 0.03)); // brow ridge (crisp edge)
  }
  // ---------------------------------------------------------- eyes (deep-set under the brow, heavy upper lids)
  const eyeX = 0.117, eyeY = 0.0, eyeZ = 0.268, eR = 0.07;
  for (const s of [-1, 1]) g.add({ ...E(eyeX * s, eyeY + 0.02, 0.372, 0.088, 0.06, 0.088, 0.025), sub: true });
  // lids: shells of the eyeball cut by the lid lines (in eye-local coords)
  const eyes = (x, y, z) => {
    let d = 1e9;
    for (const s of [-1, 1]) {
      const ex = x - eyeX * s, ey = y - eyeY, ez = z - eyeZ;
      if (ex * ex + ey * ey + ez * ez > 0.03) { d = Math.min(d, Math.sqrt(ex * ex + ey * ey + ez * ez) - 0.1); continue; }
      const r = Math.hypot(ex, ey, ez);
      // flatter eyeball front (classical eyes are not bulging)
      const ball = sd.ellipsoid(ex, ey, ez, eR, eR * 0.92, eR * 0.8);
      const lx = ex * s; // + toward the outer corner
      // upper lid: covers the top third; its edge arcs over the iris, corners meet the lower lid
      const upEdge = 0.024 - 5.8 * lx * lx + 0.004 * lx / 0.06; // (r3) heavier upper lid over the iris
      const lowEdge = -0.026 + 4.0 * lx * lx + 0.002 * lx / 0.06;
      let up = r - eR - 0.026;
      up = smax(up, upEdge - ey, 0.004);
      up = smax(up, -ez + 0.0, 0.01);
      let lo = r - eR - 0.011;
      lo = smax(lo, ey - lowEdge, 0.008);
      lo = smax(lo, -ez + 0.01, 0.01);
      lo = smax(lo, -0.075 - ey, 0.01);
      // lid crease above the upper lid (fold under the brow)
      let e = smin(ball, smin(up, lo, 0.006), 0.004);
      // (r6) shallow drilled pupil: a small dark accent that gives the gaze at mid range (Roman practice)
      if (o.pupils !== false) e = smax(e, 0.016 - Math.hypot(ex - 0.006 * s, ey - 0.004, ez - eR * 0.8 - 0.012), 0.004);
      d = Math.min(d, e);
    }
    return d;
  };
  // ---------------------------------------------------------- nose (straight Greek nose)
  const nose = new Group([], 0.034); // (r3) softer blend: no bulb tip
  nose.add(C([0, 0.03, 0.372], [0, -0.148, 0.446], 0.029, 0.033, 0.025));   // bridge
  nose.add(E(0, -0.125, 0.385, 0.05, 0.085, 0.05, 0.03));                   // lower nose body (wedge base)
  nose.add(E(0, -0.17, 0.446, 0.03, 0.03, 0.03, 0.022));                    // tip
  for (const s of [-1, 1]) nose.add(E(0.04 * s, -0.19, 0.402, 0.026, 0.022, 0.028, 0.02)); // alae
  // ---------------------------------------------------------- mouth (full lips, slightly parted)
  const lips = new Group([], 0.012);
  lips.add(E(0, -0.262, 0.377, 0.088, 0.032, 0.03, 0.04));                 // upper-lip mass (philtrum area)
  for (const s of [-1, 1]) lips.add(E(0.034 * s, -0.283, 0.385, 0.047, 0.017, 0.022, 0.01)); // upper vermilion lobes
  lips.add(E(0, -0.288, 0.393, 0.018, 0.013, 0.016, 0.008));                // tubercle
  lips.add(E(0, -0.319, 0.381, 0.07, 0.025, 0.026, 0.014));                 // lower lip

  const neck = { f: (x, y, z) => cone(x, y, z, [0, -0.2, -0.07], [0, -1.05, -0.1], 0.2, 0.235), c: [0, -0.62, -0.08], r: 0.65, k: 0.1 };
  const ears = new Group([], 0.02);
  for (const s of [-1, 1]) ears.add(ER([0.3 * s, -0.05, -0.03], rotY(0.35 * s), 0.03, 0.1, 0.062, 0.02));

  const hair = makeHair(o, fem, seed);

  const face = (x, y, z) => {
    let d = g.eval(x, y, z);
    d = smin(d, nose.eval(x, y, z), 0.03);
    d = smin(d, lips.eval(x, y, z + 1.5 * x * x), 0.016); // lips follow the dental arch (no "beak")
    if (z > 0.2 && y < -0.15 && y > -0.42) {
      // mouth line following the dental arch, corners, mentolabial furrow, nostrils, philtrum
      const ax = Math.abs(x);
      d = smax(d, -sd.ellipsoid(x, y + 0.298 + 0.06 * ax * ax, z - 0.405 + 1.6 * ax * ax, 0.086, 0.0045, 0.04), 0.006);
      for (const s of [-1, 1]) d = smax(d, -sd.ellipsoid(x - 0.087 * s, y + 0.3, z - 0.355, 0.012, 0.011, 0.022), 0.012);
      d = smax(d, -sd.ellipsoid(x, y + 0.36, z - 0.4, 0.05, 0.013, 0.026), 0.016);
      for (const s of [-1, 1]) d = smax(d, -sd.ellipsoid(x - 0.024 * s, y + 0.209, z - 0.426, 0.011, 0.006, 0.012), 0.008);
      d = smax(d, -sd.ellipsoid(x, y + 0.24, z - 0.418, 0.011, 0.024, 0.008), 0.008);
    }
    d = smin(d, eyes(x, y, z), 0.008);
    d = smin(d, ears.eval(x, y, z), 0.03);
    d = smin(d, neck.f(x, y, z), 0.065);
    return d;
  };

  const beard = o.beard ? (x, y, z) => {
    if (y > 0.0 || z < -0.15) return 1e9;
    let d = 1e9;
    for (const s of [-1, 1]) d = Math.min(d, cone(x, y, z, [0.24 * s, -0.12, -0.02], [0.06 * s, -0.47, 0.25], 0.07, 0.085));
    d = smin(d, sd.ellipsoid(x, y + 0.5, z - 0.25, 0.13, 0.12, 0.12), 0.05);
    d = smin(d, sd.ellipsoid(x, y + 0.262, z - 0.41, 0.1, 0.022, 0.03), 0.02); // moustache
    d = smax(d, -sd.ellipsoid(x, y + 0.31, z - 0.425, 0.06, 0.035, 0.06), 0.015); // keep the lips free
    const curl = vnoise3(x * 26 + seed, y * 26, z * 26) * 0.02 + Math.abs(Math.sin(x * 60 + y * 25)) * 0.008;
    return d - curl;
  } : null;
  const sdf = (x, y, z) => {
    let d = face(x, y, z);
    if (beard) d = smin(d, beard(x, y, z), 0.02);
    if (!hair) return d;
    return smin(d, hair(x, y, z), 0.012);
  };
  return { sdf, face, hairSdf: hair || (() => 1e9) };
}

// ------------------------------------------------------------ hair styles
function makeHair(o, fem, seed) {
  const style = o.hair || (fem ? 'wavy' : 'curly');
  if (style === 'none') return null;
  if (style === 'curly') {
    // short male curls: a cap following the skull with bumpy curls, hairline on the forehead
    return (x, y, z) => {
      let d = sd.ellipsoid(x, y - 0.13, z + 0.07, 0.36, 0.41, 0.44);
      const line = 0.22 - 0.32 * sstep(0.25, -0.2, z) - 0.06 * sstep(0.1, 0.3, Math.abs(x));
      d = smax(d, line - y, 0.04);
      if (d > 0.08) return d;
      const curl = vnoise3(x * 20 + seed, y * 20, z * 20) * 0.018 + vnoise3(x * 40, y * 40 + seed, z * 40) * 0.007;
      return d - 0.014 - curl;
    };
  }
  // female wavy hair: centre parting, thick waved locks swept back from the forehead over the temples
  // and ears into a knot at the nape. The waves run parallel to the hairline.
  const helm = !!o.helmeted;
  const cap = (x, y, z) => sd.ellipsoid(x, y - 0.125, z + 0.065, 0.364, 0.414, 0.45);
  const ph = hash1(seed) * 6.28;
  return (x, y, z) => {
    const ax = Math.abs(x);
    let d = cap(x, y, z);
    if (d > 0.15) return d;
    // hairline: high on the forehead, down over the temples and ears, low at the nape
    const line = 0.27 - 0.25 * sstep(0.1, 0.3, ax) * sstep(0.34, 0.05, z) - 0.44 * sstep(0.12, -0.25, z);
    d = smax(d, line - y, 0.04);
    if (d < 0.1) {
      // distance above the hairline along the head (wave bands parallel to the hairline)
      const u = (y - line) + 0.25 * Math.max(0, z - 0.1) * 0;
      const along = Math.atan2(ax, z); // strand direction: front → back
      const wav = 1.4 * Math.sin(along * 6 + ph + u * 6) + 0.4 * Math.sin(along * 15 + ph * 2);
      const bp = (u / 0.1) * Math.PI + wav;
      const band = Math.abs(Math.sin(bp));
      const bi = Math.floor(bp / Math.PI);
      const depth = 0.012 + 0.012 * hash1(bi * 7.1 + seed) + 0.008 * vnoise3(x * 9 + seed, y * 9, z * 9);
      d -= depth * Math.sqrt(band) - 0.008 + 0.005 * vnoise3(x * 14 + seed, y * 14, z * 14);
      // fine strand striations along the locks
      d -= 0.0035 * Math.abs(Math.sin(u * 140 + along * 6 + wav * 2));
      // centre parting
      d += 0.012 * Math.exp(-((x / 0.012) ** 2)) * sstep(0.1, 0.35, z) * sstep(0.2, 0.35, y);
      d *= 0.75;
    }
    // knot / gathered mass at the nape (smaller under a helmet: the locks fall from under it)
    const dc = helm ? sd.ellipsoid(x, y + 0.2, z + 0.4, 0.16, 0.13, 0.12) : sd.ellipsoid(x, y + 0.13, z + 0.43, 0.2, 0.16, 0.135);
    if (dc < 0.1) d = smin(d, dc - 0.014 * Math.abs(Math.sin(x * 40 + y * 25)) - vnoise3(x * 25, y * 25 + seed, z * 25) * 0.01, 0.05);
    return d;
  };
}
