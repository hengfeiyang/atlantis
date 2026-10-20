// Giant fallen marble head (ref 8): idealised classical male head (Hellenistic / Roman copy style)
// modelled as a signed distance field, meshed with surface nets (src/sculpt/mesher.js) and baked to
// generated/head-*.bin (src/bake/head.js, names from src/ruins/jobs.js).
//
// Local "head units": menton (chin bottom) y ≈ -0.5, skull vertex y ≈ +0.48 (hair adds ≈ 0.07), face
// looks along +z, x = the head's left (viewer's right when facing the face). Origin ≈ centre of the
// skull at eye level. The mesh is emitted in metres (HEAD_SCALE) in this orientation; the ruins
// module places and tilts it in the world.
//
//   import { buildHeadGeometry, headSDF, HEAD_SCALE, HEAD_LANDMARKS } from '../sculpt/head.js';
//   const geo = buildHeadGeometry({ cell: 0.009 });   // cell in metres
//
// Construction: cranium + a frontal face mask given as a heightfield z = zf(x, y) (Greek profile and
// transverse curvature, without the nose), cheek / jaw / chin / muzzle masses, then the features:
// brow ridge, orbits with blank eyeballs and thick almond lids, a straight nose (wedge body, tip,
// alae, nostrils), sculpted lips with a parted mouth line, ears; thick wavy hair locks flowing from
// a crown whorl with S-curls on the temples; a heavy twisted fillet; then damage (broken neck,
// chips, cracks) and sugary erosion. Every feature is evaluated only inside a bounding region that
// is larger than its blend radius, so the field stays continuous (no seams).
// Extra vertex attributes: `cav` (0 deep crevice … 1 open) and `aux` (cavity, convex edge, streak, hair).
import * as THREE from 'three';
import { meshSDF } from './mesher.js';
import { Simplex } from '../core/noise.js';

export const HEAD_SCALE = 2.45; // metres per head unit (menton → vertex 2.4 m, with hair ≈ 2.6 m)

// landmarks in head units (used by the ruins module to pose the head against the reference)
export const HEAD_LANDMARKS = {
  eyeL: [0.132, 0.0, 0.40], eyeR: [-0.132, 0.0, 0.40], noseTip: [0, -0.168, 0.545], chin: [0, -0.43, 0.47],
  menton: [0, -0.5, 0.38], mouthL: [0.082, -0.29, 0.43], earL: [0.335, -0.07, -0.07], bandTop: [0.05, 0.5, 0.0],
};

const NA = new Simplex(9011), NB = new Simplex(5153), NC = new Simplex(7717), ND = new Simplex(3301);

// ------------------------------------------------------------------ scalar helpers (allocation free)
const sqrt = Math.sqrt, abs = Math.abs, min = Math.min, max = Math.max;
function smin(a, b, k) { const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { const h = max(k - abs(a - b), 0) / k; return max(a, b) + h * h * k * 0.25; }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function ell(x, y, z, rx, ry, rz) {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const k0 = sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / rx, by = ay / ry, bz = az / rz;
  const k1 = sqrt(bx * bx + by * by + bz * bz);
  return k1 < 1e-9 ? -min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
function sph(x, y, z, r) { return sqrt(x * x + y * y + z * z) - r; }
function tcap(x, y, z, ax, ay, az, bx, by, bz, ra, rb) {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
}
// squared distance from p to the sphere bound (c, r) > 0 when outside
function out2(x, y, z, cx, cy, cz, r) { const dx = x - cx, dy = y - cy, dz = z - cz; return dx * dx + dy * dy + dz * dz > r * r; }

// ------------------------------------------------------------------ monotone cubic lookup tables
const LUT_N = 512, LUT_Y0 = -0.6, LUT_Y1 = 0.5;
function lut(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0]);
  const n = pts.length, m = new Array(n), dl = [];
  for (let i = 0; i < n - 1; i++) dl.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  for (let i = 0; i < n; i++) m[i] = i === 0 ? dl[0] : i === n - 1 ? dl[n - 2] : (dl[i - 1] * dl[i] <= 0 ? 0 : (dl[i - 1] + dl[i]) / 2);
  const out = new Float64Array(LUT_N);
  for (let k = 0; k < LUT_N; k++) {
    const y = LUT_Y0 + (LUT_Y1 - LUT_Y0) * k / (LUT_N - 1);
    if (y <= pts[0][0]) { out[k] = pts[0][1] + m[0] * (y - pts[0][0]); continue; }
    if (y >= pts[n - 1][0]) { out[k] = pts[n - 1][1] + m[n - 1] * (y - pts[n - 1][0]); continue; }
    let i = 0; while (y > pts[i + 1][0]) i++;
    const h = pts[i + 1][0] - pts[i][0], t = (y - pts[i][0]) / h;
    const t2 = t * t, t3 = t2 * t;
    out[k] = (2 * t3 - 3 * t2 + 1) * pts[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * pts[i + 1][1] + (t3 - t2) * h * m[i + 1];
  }
  return out;
}
function lk(tab, y) {
  const f = clamp((y - LUT_Y0) / (LUT_Y1 - LUT_Y0), 0, 1) * (LUT_N - 1);
  const i = Math.min(LUT_N - 2, Math.floor(f)), t = f - i;
  return tab[i] + (tab[i + 1] - tab[i]) * t;
}

// ------------------------------------------------------------------ face mask (no nose, no lips)
// mid-line profile z(y): Greek profile (forehead and nose bridge almost one line), smooth through the
// mouth (the lips are added on top), projecting rounded chin
const PROF = lut([[0.5, 0.15], [0.44, 0.27], [0.36, 0.355], [0.28, 0.40], [0.2, 0.423], [0.12, 0.434], [0.06, 0.44],
  [0.02, 0.437], [-0.04, 0.437], [-0.1, 0.443], [-0.16, 0.452], [-0.21, 0.46], [-0.25, 0.463], [-0.29, 0.458],
  [-0.33, 0.452], [-0.375, 0.438], [-0.41, 0.457], [-0.44, 0.463], [-0.468, 0.45], [-0.49, 0.418], [-0.52, 0.34], [-0.56, 0.18]]);
// transverse curvature: z drops by CURV·x² + QUART·x⁴ away from the mid-line
const CURV = lut([[0.5, 1.3], [0.3, 1.25], [0.15, 1.35], [0.05, 1.5], [-0.05, 1.65], [-0.12, 1.85], [-0.22, 3.0],
  [-0.29, 4.5], [-0.35, 4.9], [-0.4, 5.0], [-0.46, 5.8], [-0.52, 6.2], [-0.58, 6.5]]);
const QUART = lut([[0.5, 10], [0.15, 11], [0.0, 13], [-0.1, 15], [-0.2, 16], [-0.3, 17], [-0.45, 24], [-0.58, 30]]);
// half width of the mask (beyond it the cranium / jaw masses take over)
const WID = lut([[0.5, 0.25], [0.3, 0.30], [0.12, 0.32], [0.0, 0.33], [-0.12, 0.325], [-0.24, 0.30], [-0.32, 0.255],
  [-0.40, 0.195], [-0.47, 0.13], [-0.55, 0.07]]);

export function faceZ(x, y) {
  const x2 = x * x;
  return lk(PROF, y) - lk(CURV, y) * x2 - lk(QUART, y) * x2 * x2;
}
function faceSDF(ax, py, pz) {
  const zf = faceZ(ax, py);
  const c = lk(CURV, py), q = lk(QUART, py);
  const gx = -2 * c * ax - 4 * q * ax * ax * ax;
  const gy = (faceZ(ax, py + 0.004) - faceZ(ax, py - 0.004)) / 0.008;
  let d = (pz - zf) / sqrt(1 + gx * gx + gy * gy);
  d = smax(d, ax - lk(WID, py), 0.08);
  // under-jaw plane: from under the chin back to the throat
  d = smax(d, (py + 0.488) * -0.94 + (pz - 0.40) * -0.34, 0.06);
  d = smax(d, -0.08 - pz, 0.1);   // back bound
  d = smax(d, py - 0.47, 0.06);
  return d;
}

// ------------------------------------------------------------------ eye frame (mirrored, x > 0 side)
const EYE = { c: [0.13, -0.006, 0.319], r: 0.088 };   // r6: bulging blank eyeball
const EG = (() => {
  const f = new THREE.Vector3(0.52, -0.2, 1).normalize();                   // looks out (near side, toward camera 8) and down
  const r0 = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), f).normalize();
  const r = r0.applyAxisAngle(f, 0.07);                                     // outer corner slightly higher
  const u = new THREE.Vector3().crossVectors(f, r).normalize();
  return { f: f.toArray(), r: r.toArray(), u: u.toArray() };
})();
// almond opening in eye-local (u temporal, v up): upper / lower lid curves
const EYE_A = 0.08, IRIS = false;
// r6: open almond (ref 8): high, crisp upper-lid arch peaking on the nasal third, flatter lower lid
function lidU(t) { const tt = max(0, 1 - t * t); return 0.05 * Math.pow(tt, 0.55) * (1 - 0.2 * t) + 0.0015 + 0.005 * t; }
function lidL(t) { const tt = max(0, 1 - t * t); return -0.033 * Math.pow(tt, 0.8) * (1 + 0.18 * t) + 0.0005 + 0.003 * t; }

// brow fold path over the upper lid (x, y, protrusion above the face mask, radius)
const FOLD = [[0.055, 0.052, 0.01, 0.016], [0.1, 0.07, 0.038, 0.03], [0.16, 0.072, 0.046, 0.034], [0.215, 0.06, 0.036, 0.028], [0.265, 0.032, 0.012, 0.016]].map(([x, y, prot, r]) => [x, y, faceZ(x, y) + prot - r, r]);
// ear frame: faces outward and slightly forward, top tilted back
const EAR = (() => {
  const yaw = 0.36, tilt = 0.22;
  const n = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const side = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyAxisAngle(side, -tilt);
  up.sub(n.clone().multiplyScalar(up.dot(n))).normalize();
  const fw = new THREE.Vector3().crossVectors(up, n).normalize();
  return { c: [0.322, -0.07, -0.08], n: n.toArray(), u: up.toArray(), f: fw.toArray() };
})();

// wreath of rope-like locks (ref 8): rows of separate, tapered, three-strand twisted locks lying along
// the hairline, staggered and overlapping like tiles, flowing back and down over the temples toward
// the ears. Each lock is a tube in (angle around the head, height, radial offset) coordinates.
function capT(th, y) { const side = sstep(0.9, 1.6, abs(th)); return 0.055 + 0.03 * sstep(-0.1, 0.32, y) + 0.035 * side * sstep(-0.12, 0.15, y); }
function capR(th, y) { // radius (around the skull axis at z = -0.035) of the hair cap at angle th, height y
  const t = capT(th, y), kq = sqrt(max(0.05, 1 - ((y - 0.07) / (0.37 + 0.8 * t)) ** 2));
  const rx = (0.325 + t) * kq, rz = (0.445 + t) * kq, sB = Math.sin(th), cB = Math.cos(th);
  return 1 / sqrt((sB / rx) ** 2 + (cB / rz) ** 2);
}
function wreathY(th) { const a = abs(th); return 0.182 - 0.1 * sstep(0.5, 1.75, a) + 0.05 * sstep(2.1, 3.0, a); }
const WREATH = (() => {
  let sd = 4242;
  const rnd = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
  const rows = [
    { yOff: 0.0, r: 0.041, n: 7, ph: 0.0, rad: 0.002 },
    { yOff: 0.07, r: 0.038, n: 6, ph: 0.45, rad: -0.01 },
    { yOff: 0.136, r: 0.033, n: 6, ph: 0.15, rad: -0.026 },
  ];
  const out = [];
  rows.forEach((row, ri) => {
    const step = Math.PI / row.n;
    for (const side of [1, -1]) for (let i = 0; i < row.n; i++) {
      const c = side * (i + row.ph + 0.3 * (rnd() - 0.5)) * step;
      const h = step * (0.6 + 0.16 * rnd());
      let thF = c - side * h, thB = c + side * h;
      thF = clamp(thF, -3.05, 3.05); thB = clamp(thB, -3.05, 3.05);
      if (abs(thB - thF) < 0.15) continue;
      out.push({ thF, thB, lo: min(thF, thB) - 0.2, hi: max(thF, thB) + 0.2, ya: row.yOff - 0.018 + 0.02 * (rnd() - 0.5), yb: row.yOff + 0.02 + 0.024 * (rnd() - 0.5),
        arch: 0.006 * rnd(), r: row.r * (0.74 + 0.52 * rnd()), rad: row.rad, lift: 0.008 + 0.01 * rnd(), tw: rnd() * 6.283, pitch: 0.07 + 0.04 * rnd(), dir: ri % 2 ? -1 : 1 });
    }
  });
  return out;
})();
function wreathDist(px, py, pz, detail) {
  const zc = pz + 0.035, th = Math.atan2(px, zc), rho = sqrt(px * px + zc * zc);
  const wy = wreathY(th);
  if (py < wy - 0.08 || py > wy + 0.2) return 1e9;
  let best = 1e9;
  for (let i = 0; i < WREATH.length; i++) {
    const L = WREATH[i];
    if (th < L.lo || th > L.hi) continue;
    const span = L.thB - L.thF;
    const uRaw = (th - L.thF) / span, u = clamp(uRaw, 0, 1);
    const sn = Math.sin(Math.PI * u);
    const yc = wy + L.ya + (L.yb - L.ya) * u + L.arch * sn;
    const by = py - yc;
    if (abs(by) > 0.09) continue;
    const R = capR(th, yc);
    const rad = R + L.rad + L.lift * Math.pow(sn, 0.7) - L.r * 0.55 * (1 - sn);
    const dRad = rho - rad;
    if (abs(dRad) > 0.09) continue;
    const over = (uRaw - u) * span * R;                 // arc distance beyond the lock end
    const rr = L.r * (0.42 + 0.58 * Math.pow(sn, 0.55));
    let cs = sqrt(dRad * dRad + by * by + over * over);
    let dd = cs - rr;
    if (detail > 0 && dd < 0.02) {
      const ph = Math.atan2(by, dRad), sArc = th * R;
      // rope of 2 round strands (helix ≈ 50° like ref 8's twisted locks) with crisp V-grooves between them
      let u = (2 * ph + L.dir * 6.2832 * sArc / L.pitch + L.tw) / 6.2832; u -= Math.floor(u);
      const bump = sqrt(max(0, 1 - (2 * u - 1) ** 2));
      dd += rr * (0.45 * (1 - bump) + 0.025 * Math.sin(13 * ph + L.dir * 6.2832 * sArc / (L.pitch * 0.3)));
    }
    best = min(best, dd);
  }
  return best;
}

// ------------------------------------------------------------------ damage (asymmetric, deterministic)
const CHIPS = [ // [x, y, z, radius]
  [-0.345, 0.0, -0.13, 0.03],     // right ear helix
  [0.36, 0.04, -0.12, 0.022],     // left ear top
  [0.07, -0.52, 0.34, 0.045],     // chin underside
  [-0.26, 0.09, 0.32, 0.025],     // right brow tail
  [0.2, 0.29, 0.37, 0.034],       // band front-left
  [-0.37, 0.3, 0.14, 0.04],       // band right
  [0.3, 0.355, -0.33, 0.05],      // back of band
  [-0.06, 0.49, 0.0, 0.05],       // crown lock
  [0.29, -0.31, 0.04, 0.03],      // left jaw angle
  [-0.25, -0.40, 0.16, 0.035],    // right jaw
  [-0.17, 0.4, 0.22, 0.035],      // hair front right
  [0.255, 0.18, 0.33, 0.022],     // left temple
  [0.022, -0.176, 0.562, 0.026],   // nose tip (near side): shallow spall
];
const CRACKS = [ // plane through c with normal n, extent R, half-width w (head units)
  { c: [-0.2, 0.3, -0.25], n: [0.6, 0.2, -0.77], R: 0.3, w: 0.005 },
  { c: [0.15, 0.135, 0.4], n: [0.9, 0.3, -0.3], R: 0.075, w: 0.0016 },   // short hairline crack on the forehead
].map((k) => { const l = Math.hypot(...k.n); return { ...k, n: k.n.map((v) => v / l) }; });

// hairline height as a function of the angle around the vertical axis (0 = front)
function hairline(th) {
  const a = abs(th);
  if (a < 0.75) return 0.16 - 0.004 * sstep(0.0, 0.75, a);
  if (a < 1.35) return 0.156 - 0.038 * sstep(0.75, 1.35, a);    // temple
  if (a < 2.05) return 0.12 - 0.28 * sstep(1.35, 2.05, a);     // above / behind the ear
  return -0.16 - 0.12 * sstep(2.05, Math.PI, a);              // nape
}

// wavy temple locks: thick S-waved tongues of hair emerging from under the fillet and flowing down
// and back over the temples toward the ears (Hellenistic style). Each lock is a chain of tapered
// capsules lying on the hair surface.
function hairSurf(th, y, lift) {
  const t = 0.07, kq = sqrt(max(0.05, 1 - ((y - 0.07) / (0.37 + 0.8 * t)) ** 2));
  const rx = (0.325 + t) * kq, rz = (0.445 + t) * kq, sB = Math.sin(th), cB = Math.cos(th);
  const Rr = 1 / sqrt((sB / rx) ** 2 + (cB / rz) ** 2) + lift;
  return [sB * Rr, y, -0.035 + cB * Rr];
}
const LOCKS = (() => {
  const out = [];
  for (const sg of [-1, 1]) {
    [0.46, 0.56, 0.66, 0.76, 0.86, 0.96, 1.06, 1.16, 1.26, 1.36].forEach((th0, i) => {
      const y0 = hairline(sg * th0) + 0.03;
      const len = 0.09 + 0.04 * ((i * 7) % 3) / 2 + (th0 > 1.0 ? 0.04 : 0);
      const pts = [];
      for (let k = 0; k <= 5; k++) {
        const u = k / 5;
        const th = sg * (th0 + 0.24 * u + 0.045 * Math.sin(u * Math.PI * 1.6 + i * 0.7));
        const y = y0 - len * u;
        pts.push(hairSurf(th, y, 0.0 - 0.004 * u + 0.006 * Math.sin(u * Math.PI)));
      }
      const r0 = 0.021 + 0.004 * (i % 2), r1 = 0.009;
      let cx = 0, cy = 0, cz = 0; for (const p of pts) { cx += p[0] / pts.length; cy += p[1] / pts.length; cz += p[2] / pts.length; }
      let R = 0; for (const p of pts) R = max(R, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
      out.push({ pts, r0, r1, c: [cx, cy, cz], R: R + r0 + 0.02 });
    });
  }
  return out;
})();

// ------------------------------------------------------------------ the SDF
let HAIR_ID = 0; // side channel: >0 when the last evaluated point is hair (for the aux attribute)
/** signed distance in head units. detail: 0 = forms only (fast), 1 = full */
export function headSDF(px, py, pz, detail = 1) {
  const ax = abs(px);
  HAIR_ID = 0;

  // ---------------- masses: braincase + face mask + cheek / jaw / chin + neck
  let d = ell(px, py - 0.07, pz + 0.035, 0.325, 0.37, 0.445);
  if (pz > -0.3) d = smin(d, faceSDF(ax, py, pz), 0.075);
  if (pz > -0.25 && py < 0.12 && py > -0.58) {
    // r6: cleaner, youthful lower face — high cheekbones, smooth cheek planes, a crisp jaw line that
    // rises to the ear (no jowls), a compact rounded chin
    d = smin(d, ell(ax - 0.215, py + 0.045, pz - 0.265, 0.08, 0.052, 0.095), 0.06);     // cheekbones (zygomatic)
    d = smin(d, ell(ax - 0.17, py + 0.17, pz - 0.24, 0.1, 0.11, 0.12), 0.07);           // cheek plane
    d = smin(d, tcap(ax, py, pz, 0.282, -0.08, -0.07, 0.268, -0.30, -0.04, 0.04, 0.044), 0.05); // ramus
    d = smin(d, tcap(ax, py, pz, 0.262, -0.31, -0.035, 0.085, -0.455, 0.33, 0.04, 0.042), 0.05); // jaw line
    d = smin(d, ell(px, py + 0.3, pz - 0.335, 0.135, 0.095, 0.125), 0.05);              // muzzle
    d = smin(d, ell(ax - 0.15, py + 0.122, pz - 0.358, 0.076, 0.062, 0.046), 0.045);      // malar pad under the eye (lit pillow beside the nose)
    d = smin(d, ell(px, py + 0.428, pz - 0.4, 0.088, 0.072, 0.086), 0.035);            // chin (rounded, strong)
  }
  // neck
  d = smin(d, tcap(px, py, pz, 0, -0.2, -0.13, 0, -0.85, -0.2, 0.245, 0.27), 0.1);
  // soft temple hollow
  d = smax(d, -ell(ax - 0.34, py - 0.08, pz - 0.2, 0.04, 0.07, 0.07), 0.05);

  // ---------------- brow ridge: crisp arch where the forehead meets the orbit
  if (!out2(ax, py, pz, 0.15, 0.07, 0.38, 0.24)) {
    const z1 = faceZ(0.03, 0.068) - 0.022, z2 = faceZ(0.14, 0.088) - 0.008, z3 = faceZ(0.255, 0.068) - 0.012;
    const br = min(tcap(ax, py, pz, 0.025, 0.066, z1, 0.14, 0.088, z2 + 0.012, 0.028, 0.034), tcap(ax, py, pz, 0.14, 0.088, z2 + 0.012, 0.262, 0.058, z3 + 0.004, 0.038, 0.024));
    d = smin(d, br, 0.035);
    // fleshy fold under the brow over the outer upper lid (heavy-lidded Hellenistic look)
    d = smin(d, tcap(ax, py, pz, 0.07, 0.06, faceZ(0.07, 0.06) - 0.01, 0.215, 0.05, faceZ(0.215, 0.05) - 0.008, 0.019, 0.022), 0.022);
  }

  // ---------------- eyes (r6, ref 8 close-up): deep orbit, a blank spherical eyeball recessed behind
  // two distinct tubular lids (thick upper lid with a tail past the outer corner, thinner lower lid,
  // crisp creases on both sides), and a heavy overhanging brow fold above the upper lid
  if (!out2(ax, py, pz, EYE.c[0], EYE.c[1], EYE.c[2] + 0.04, 0.17)) {
    const qx = ax - EYE.c[0], qy = py - EYE.c[1], qz = pz - EYE.c[2];
    const f = EG.f, r = EG.r, u = EG.u;
    const lu = qx * r[0] + qy * r[1] + qz * r[2];
    const lv = qx * u[0] + qy * u[1] + qz * u[2];
    const lw = qx * f[0] + qy * f[1] + qz * f[2];
    // orbit hollow under the brow (deeper at the inner upper corner) + soft tear trough
    d = smax(d, -ell(lu + 0.004, lv - 0.014, lw - 0.096, 0.108, 0.066, 0.032), 0.028);
    const t = clamp(lu / EYE_A, -1, 1), tt = max(0, 1 - t * t);
    const vU = lidU(t), vL = lidL(t);
    const open = max(lv - vU, vL - lv, abs(lu) - EYE_A);
    // clear the opening so the eyeball shows
    d = smax(d, -max(open, -(lw + 0.01), lw - 0.13), 0.003);
    // eyeball: tighter sphere pushed forward → reads as a ball, recessed ~1 cm behind the lid rims
    const bc = 0.016;
    const ball = max(sph(lu, lv + 0.006, lw - bc, EYE.r - 0.011), open - 0.03);
    if (ball < 0.0025 && open < 0) HAIR_ID = 3;   // r6: eyeball flag (aux.w = 3): kept clean & polished in the material
    d = smin(d, ball, 0.004);
    // tubular lids along the almond edges (upper: thick, with a short tail past the outer corner)
    const R0 = EYE.r + 0.006;
    const cvU = vU + 0.007, cwU = sqrt(max(1e-6, R0 * R0 - lu * lu - cvU * cvU));
    const rU = 0.019 * (0.38 + 0.62 * Math.pow(tt, 0.45));
    const tubeU = max(sqrt((lv - cvU) ** 2 + (lw - cwU) ** 2) - rU, lu > 0 ? lu - EYE_A * 1.16 : -lu - EYE_A * 1.01);
    const cvL = vL - 0.003, cwL = sqrt(max(1e-6, R0 * R0 - lu * lu - cvL * cvL));
    const rL = 0.0105 * (0.35 + 0.65 * Math.pow(tt, 0.5));
    const tubeL = max(sqrt((lv - cvL) ** 2 + (lw - cwL) ** 2) - rL, abs(lu) - EYE_A * 1.02);
    d = smin(d, tubeL, 0.01);   // lower lid melts into the ball (no dark ring), upper lid stays crisp
    d = smin(d, tubeU, 0.004);
    // the brow fold (orbital fat) over the upper lid: a soft roll following the lid, overhanging it
    // with a crisp lower edge (ref 8: a large lit pillow above the eye, its shadow on the lid)
    let fold = 1e9;
    for (let k = 0; k < FOLD.length - 1; k++) { const a = FOLD[k], b = FOLD[k + 1]; fold = min(fold, tcap(ax, py, pz, a[0], a[1], a[2], b[0], b[1], b[2], a[3], b[3])); }
    d = smin(d, fold, 0.012);
    // crease between the upper lid and the fold
    if (detail > 0) {
      const cvC = vU + 0.022 + 0.008 * tt, R1 = EYE.r + 0.022;
      const cwC = sqrt(max(1e-6, R1 * R1 - lu * lu - cvC * cvC));
      const cr = max(sqrt((lv - cvC) ** 2 + (lw - cwC) ** 2) - 0.0055 * (0.3 + 0.7 * tt), abs(lu) - EYE_A * 0.8);
      d = smax(d, -cr, 0.006);
    }
  }

  // ---------------- nose: straight dorsum continuing the forehead, wedge body, tip, alae, nostrils
  if (!out2(ax, py, pz, 0.0, -0.1, 0.48, 0.17)) {
    // body: triangular ridge from the nasion to the tip; steep side walls (~53°) meet the cheeks,
    // rounded crest; half width at the base ≈ the alae
    const t = clamp((0.035 - py) / 0.19, 0, 1);                      // 0 at the root, 1 at the tip
    const ridgeZ = 0.447 + 0.112 * t;
    const crest = 0.009 + 0.011 * t;                                  // crest rounding radius
    const slope = 1.35 + 1.1 * t * t;
    const zn = ridgeZ + crest - slope * sqrt(px * px + crest * crest) - 0.004 * t * t * px * px * 900 * 0;
    let n = (pz - zn) / sqrt(1 + slope * slope);
    n = smax(n, max(py - 0.045, -0.197 - py), 0.022);                 // root / base ends
    // r6: refined tip, slim curved alae, columella, oval nostrils opening down and slightly out
    n = smin(n, ell(px, py + 0.176, pz - 0.53, 0.027, 0.024, 0.025), 0.022);            // tip (lobule)
    n = smin(n, ell(ax - 0.046, py + 0.19, pz - 0.478, 0.031, 0.03, 0.04), 0.02);     // alae (wings, one mass with the tip)
    n = smax(n, -(py + 0.214) - 0.3 * max(0, pz - 0.5), 0.008);                         // flat underside
    n = smax(n, -ell(ax - 0.032, py + 0.206, pz - 0.494, 0.018, 0.018, 0.032), 0.003);     // nostrils (deep oval holes, along the nose)
    d = smin(d, n, 0.02);
    if (detail > 0) { // alar groove (crease around the wing)
      const ag = abs(sqrt((ax - 0.046) * (ax - 0.046) + (py + 0.193) * (py + 0.193)) - 0.03) - 0.003;
      d = smax(d, -max(ag, 0.435 - pz, 0.024 - ax, -0.212 - py) - 0.0015, 0.005);
    }
  }

  // ---------------- lips & mouth: lips are heightfield bumps over the muzzle surface, bounded by the
  // vermilion borders (M-shaped upper border, full pouting lower lip), a parted mouth line, deep corners
  if (!out2(ax, py, pz, 0.0, -0.3, 0.44, 0.14)) {
    const x2 = px * px;
    const yM = -0.288 + 0.5 * max(0, ax - 0.03) ** 2 - 0.004 * Math.exp(-x2 / 0.0003);          // mouth line (tubercle dips)
    const yT = -0.25 - 0.0035 * Math.exp(-x2 / 0.00012) + 0.0025 * Math.exp(-((ax - 0.021) ** 2) / 0.00012) - 5.0 * max(0, ax - 0.025) ** 2; // upper border
    const yB = -0.346 + 4.0 * max(0, ax - 0.01) ** 2;                                              // lower border
    const zMuz = 0.335 + 0.13 * sqrt(max(0, 1 - (px / 0.15) ** 2 - ((py + 0.305) / 0.1) ** 2));
    const base = max(faceZ(px, py), zMuz);
    const wx = max(0, 1 - (ax / 0.1) ** 2) ** 0.8;
    const hU = 0.035 * Math.pow(wx, 0.5), hL = 0.05 * Math.pow(wx, 0.55);   // r6: fuller sculpted lips
    let lip = 0;
    // the upper lip protrudes as a unit (skin + vermilion), most forward at the crisp vermilion border,
    // the vermilion slopes back to the parted mouth; the lower lip is a full roll peaking near the mouth
    if (py > yM) {
      const s1 = clamp((py - yM) / max(0.006, yT - yM), 0, 1);
      if (py < yT) lip = hU * (0.35 + 0.65 * Math.pow(s1, 0.55)) * sstep(0, 0.25, s1);
      else lip = hU * (1 - sstep(yT, max(yT + 0.01, -0.206), py)) - 0.0025 * wx * Math.exp(-((py - yT - 0.003) ** 2) / 0.00002);
    } else {
      const sr = (yM - py) / max(0.006, yM - yB), s1 = clamp(sr, 0, 1);
      lip = hL * (s1 < 0.4 ? sstep(0.0, 0.4, s1) : 1 - 0.95 * sstep(0.4, 1.05, s1)) * (1 - sstep(1.0, 1.5, sr));
    }
    if (lip !== 0) d -= lip * sstep(0.36, 0.41, pz);
    d = smax(d, -tcap(px, py, pz, 0, -0.22, base + 0.004, 0, -0.256, base + 0.006, 0.0065, 0.0075), 0.007); // philtrum
    d = smax(d, -max(abs(py - yM) - (0.003 + 0.005 * max(0, 1 - ax / 0.085)), ax - 0.094, 0.4 - pz), 0.003);                       // parted mouth
    d = smax(d, -sph(ax - 0.094, py + 0.3, pz - 0.414, 0.01), 0.012);                            // corners
    d = smax(d, -ell(px, py + 0.374, pz - 0.476, 0.084, 0.023, 0.04), 0.014);                     // mentolabial sulcus
    // nasolabial fold: soft groove from the ala down to beside the mouth corner
    if (detail >= 0) {
      const nlA = [0.074, -0.205, 0.443], nlB = [0.118, -0.31, 0.403];
      const g = tcap(ax, py, pz, nlA[0], nlA[1], nlA[2], nlB[0], nlB[1], nlB[2] - 0.004, 0.011, 0.007);
      d = smax(d, -g, 0.02);
    }
    d = smax(d, -ell(px, py + 0.44, pz - 0.48, 0.006, 0.02, 0.012), 0.012);                       // chin dimple
  }

  // ---------------- ears
  if (!out2(ax, py, pz, EAR.c[0], EAR.c[1], EAR.c[2], 0.17)) {
    const qx = ax - EAR.c[0], qy = py - EAR.c[1], qz = pz - EAR.c[2];
    const ew = qx * EAR.n[0] + qy * EAR.n[1] + qz * EAR.n[2];
    const ev = qx * EAR.u[0] + qy * EAR.u[1] + qz * EAR.u[2];
    const eu = -(qx * EAR.f[0] + qy * EAR.f[1] + qz * EAR.f[2]);   // r6: + toward the face (EAR.f points back)
    // r6: a real pinna (not a disc): ear-shaped outline (broad rounded top, narrowing to the lobe,
    // leaning back), a C-shaped helix rim open toward the face that ends in the crus inside the
    // concha, scapha groove, Y-shaped antihelix, deep concha bowl, tragus, fleshy lobe
    const ry = 0.138, vv = clamp(ev / ry, -1.3, 1.3);
    const rx = 0.057 * (vv > 0 ? 1 - 0.12 * vv * vv : 1 - 0.38 * vv * vv);
    const cu = -0.012 - 0.012 * vv;                                      // the top leans back
    const su = (eu - cu) / rx, sv = vv;
    const er = sqrt(su * su + sv * sv) + 1e-6;
    const d2 = (er - 1) * min(rx, ry) * 0.95;                           // ≈ 2D distance to the outline
    let ang = Math.atan2(sv, su); if (ang < 0) ang += 6.2832;          // 0 forward, π/2 top, π back, 3π/2 bottom
    const rim = sstep(0.55, 1.05, ang) * (1 - sstep(4.35, 4.75, ang)); // helix runs top-front → back → lobe
    let e = max(d2 + 0.003, abs(ew - 0.017) - 0.017);                   // plate standing off the head
    e = smin(e, sqrt((d2 + 0.011) ** 2 + (ew - 0.03) ** 2) - (0.003 + 0.0105 * rim), 0.006);   // helix rim
    // scapha: groove inside the helix
    e = smax(e, -(sqrt((d2 + 0.026) ** 2 + (ew - 0.042) ** 2) - 0.0085 * rim), 0.005);
    // antihelix: ridge at ~60 % of the radius over the back half, forking at the top
    const ai = (er - 0.58) * min(rx, ry);
    const aMask = sstep(1.3, 1.8, ang) * (1 - sstep(4.1, 4.5, ang));
    e = smin(e, sqrt(ai * ai + (ew - 0.03) ** 2) - 0.0085 * aMask, 0.006);
    e = smin(e, ell(ew - 0.02, ev + 0.105, eu + 0.006, 0.017, 0.03, 0.028), 0.012);          // lobe
    e = smin(e, ell(ew - 0.022, ev + 0.03, eu - 0.046, 0.012, 0.017, 0.011), 0.007);         // tragus
    e = smax(e, -ell(ew - 0.044, ev + 0.022, eu - 0.012, 0.03, 0.04, 0.032), 0.006);         // concha bowl
    e = smax(e, -ell(ew - 0.03, ev + 0.03, eu - 0.028, 0.008, 0.01, 0.012), 0.004);          // ear canal
    e = smax(e, ew - 0.07, 0.01);
    d = smin(d, e, 0.014);
  }

  // ---------------- hair: thick layered wavy locks, temple S-curls + the twisted fillet
  if (py > -0.4 && !(pz > 0.3 && py < 0.125)) {
    const th = Math.atan2(px, pz);
    const hl = hairline(th);
    const side = sstep(0.9, 1.6, abs(th));
    const wy = wreathY(th);
    const wz = sstep(wy - 0.03, wy, py) * (1 - sstep(wy + 0.17, wy + 0.24, py)); // the cap sinks under the wreath locks
    const thick = 0.055 + 0.03 * sstep(-0.1, 0.32, py) + 0.035 * side * sstep(-0.12, 0.15, py) + 0.018 * NC.noise3(px * 4, py * 4, pz * 4) - 0.04 * wz;
    let hair = ell(px, py - 0.07, pz + 0.035, 0.325 + thick, 0.37 + thick * 0.8, 0.445 + thick);
    hair = smax(hair, hl - py, 0.04);                    // rounded roll at the hairline
    if (detail > 0 && hair < 0.08) {
      // flow coordinates around a whorl at the back of the crown
      const wx = px, wy = py - 0.36, wz = pz + 0.2;
      const az = Math.atan2(wx, wz);
      const el = Math.atan2(sqrt(wx * wx + wz * wz), wy);  // 0 at the whorl → ~2 at the hairline
      const N = 13;
      const wav = 0.75 * Math.sin(el * 5.2 + 0.4) * sstep(0.1, 0.6, el) + 0.1 * Math.sin(el * 12.0 + az * 2.0);
      const s = az * N / (2 * Math.PI) + wav + 0.18 * NA.noise2(az * 3, el * 3);
      const li = Math.floor(s), fr = s - li;
      const cx = (fr - 0.5) * 2;
      const prof = sqrt(max(0, 1 - cx * cx * 0.94)) - 1;               // 0 centre … -1 edge
      // layered tongues: each lock is a stack of overlapping segments
      const seg = el * 1.55 + 0.37 * li + 0.6 * Math.sin(li * 2.3);
      const sf = seg - Math.floor(seg);
      const tongue = Math.pow(sstep(0.0, 0.92, sf), 0.8) - 1;
      const strands = Math.sin((cx * 3.5 + 0.4 * Math.sin(el * 30)) * Math.PI) * 0.5 + 0.5;
      hair -= 0.04 * prof + 0.016 * tongue * (0.6 + 0.4 * (1 - abs(cx))) - 0.007 * strands; // deep wavy locks (ref 8 crown)
      hair += 0.004 * NB.noise3(px * 8, py * 8, pz * 8);
    }
    // wavy temple locks
    if (false && detail > 0 && abs(th) > 0.35 && py > -0.15 && py < 0.32) {
      for (let k = 0; k < LOCKS.length; k++) {
        const Lk = LOCKS[k];
        if (out2(px, py, pz, Lk.c[0], Lk.c[1], Lk.c[2], Lk.R)) continue;
        let lk = 1e9;
        const P = Lk.pts, n = P.length - 1;
        for (let j = 0; j < n; j++) {
          const ra = Lk.r0 + (Lk.r1 - Lk.r0) * (j / n), rb = Lk.r0 + (Lk.r1 - Lk.r0) * ((j + 1) / n);
          lk = min(lk, tcap(px, py, pz, P[j][0], P[j][1], P[j][2], P[j + 1][0], P[j + 1][1], P[j + 1][2], ra, rb));
        }
        // a groove along the lock (two strands)
        hair = smin(hair, lk, 0.026);
      }
    }
    // keep the ear free of hair
    hair = smax(hair, -ell(ax - EAR.c[0], py - EAR.c[1] - 0.005, pz - EAR.c[2] - 0.005, 0.11, 0.16, 0.1), 0.03);
    if (hair < d + 0.004) HAIR_ID = 1;
    d = smin(d, hair, 0.016);
  }
  // wreath of twisted rope locks over the hairline
  if (py > -0.05) {
    const wr = wreathDist(px, py, pz, detail);
    if (wr < 1e8) { if (wr < d + 0.004) HAIR_ID = 2; d = smin(d, wr, 0.008); }
  }

  if (detail <= 0) return d;

  // ---------------- damage
  { // broken neck: rough fracture
    const nx = 0.12, ny = -0.95, nz = -0.2, l = Math.hypot(nx, ny, nz);
    const pl = (px * nx + (py + 0.66) * ny + (pz + 0.15) * nz) / l;
    const rough = 0.035 * NA.fbm3(px * 7, py * 7, pz * 7, 3) + 0.012 * NB.noise3(px * 25, py * 25, pz * 25);
    d = max(d, pl + rough);
  }
  for (const c of CHIPS) {
    const dx = px - c[0], dy = py - c[1], dz = pz - c[2];
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > (c[3] * 1.8) * (c[3] * 1.8)) continue;
    const ch = sqrt(r2) - c[3] * (1 + 0.35 * NA.noise3(px * 30 + c[0] * 10, py * 30, pz * 30));
    d = max(d, -ch);
  }
  for (const k of CRACKS) {
    const dx = px - k.c[0], dy = py - k.c[1], dz = pz - k.c[2];
    const r = sqrt(dx * dx + dy * dy + dz * dz);
    if (r > k.R) continue;
    const pl = dx * k.n[0] + dy * k.n[1] + dz * k.n[2] + 0.02 * NB.fbm3(px * 8, py * 8, pz * 8, 3);
    const w = k.w * (1 - sstep(k.R * 0.4, k.R, r));
    d = max(d, -(abs(pl) - w));
  }
  // erosion: sugary lumpiness + shallow solution pits
  d += 0.0006 * NC.noise3(px * 32, py * 32, pz * 32) + 0.0014 * NA.noise3(px * 6, py * 6, pz * 6) + 0.0008 * ND.noise3(px * 14, py * 14, pz * 14);
  return d;
}

// ------------------------------------------------------------------ meshing
/**
 * Build the head mesh in metres.
 * @param {object} o
 * @param {number} [o.cell=0.009] voxel size in metres
 * @param {number} [o.smooth=1] laplacian passes
 */
export function buildHeadGeometry(o = {}) {
  const S = HEAD_SCALE;
  const cell = (o.cell || 0.009) / S;
  const f = (x, y, z) => headSDF(x, y, z, o.detail ?? 1);
  const t0 = Date.now();
  const geo = meshSDF(f, { min: [-0.52, -0.86, -0.62], max: [0.52, 0.66, 0.66], cell, smooth: o.smooth ?? 1, bandScale: 1.6 });
  // ambient occlusion / cavity from the SDF along the normal
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
  const n = pos.length / 3;
  const cav = new Uint8Array(n);
  const aux = new Float32Array(n * 4); // (cavity, convex edge, streak source, hair flag)
  const steps = [0.004, 0.01, 0.022, 0.05, 0.1, 0.17];
  const de = 0.006;
  // r6: sky visibility from above (world up of the shot-8 pose in head-local units, see
  // src/ruins/headpose.js): soft-shadow rays toward the sky → aux.z. Under the director's frontal sun
  // the brow, nose, lips and chin still read top-lit and sculpted (ref 8).
  const UP = [0.391, 0.82, 0.417], J = [[0.45, 0, 0], [-0.45, 0, 0], [0, 0, 0.45], [0, 0, -0.45], [0, 0, 0]];
  const f0 = (x, y, z) => headSDF(x, y, z, 0);
  const skyVis = (x, y, z, nx, ny, nz) => {
    let acc = 0, wsum = 0;
    for (const j of J) {
      let dx = nx * 0.5 + UP[0] + j[0], dy = ny * 0.5 + UP[1] + j[1], dz = nz * 0.5 + UP[2] + j[2];
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const cosw = dx * nx + dy * ny + dz * nz;
      wsum += 1;
      if (cosw <= 0.02) continue;
      let res = 1, t = 0.014;
      for (let k = 0; k < 22 && t < 0.5; k++) {
        const dd = f0(x + dx * t, y + dy * t, z + dz * t);
        if (dd < 0.0015) { res = 0; break; }
        res = min(res, 5 * dd / t);
        t += max(dd * 0.9, 0.008);
      }
      acc += res * clamp(cosw * 1.6, 0, 1);
    }
    return acc / wsum;
  };
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
    f(x, y, z);
    const hairFlag = HAIR_ID;
    let occ = 0, w = 1;
    for (const s of steps) {
      const dd = f(x + nx * s, y + ny * s, z + nz * s);
      occ += w * max(0, s - dd) / s;
      w *= 0.7;
    }
    const c = clamp(1 - occ * 0.55, 0, 1);
    cav[i] = Math.round(c * 255);
    const din = f(x - nx * de, y - ny * de, z - nz * de);
    const edge = clamp(((din + de) / de) * 2.0, 0, 1);
    aux[i * 4] = 1 - c; aux[i * 4 + 1] = edge; aux[i * 4 + 2] = o.sky === false ? 1 : skyVis(x, y, z, nx, ny, nz); aux[i * 4 + 3] = hairFlag;
  }
  for (let i = 0; i < pos.length; i++) pos[i] *= S; // to metres
  geo.setAttribute('cav', new THREE.BufferAttribute(cav, 1, true));
  geo.setAttribute('aux', new THREE.BufferAttribute(aux, 4));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  geo.userData.buildMs = Date.now() - t0;
  return geo;
}

/** SDF in metres, forms only (for ivy growth / placement on the head surface) */
export function headSDFm(x, y, z) { return headSDF(x / HEAD_SCALE, y / HEAD_SCALE, z / HEAD_SCALE, 0) * HEAD_SCALE; }
