// Giant fallen bronze head of Poseidon (ref 8): mature bearded male head with thick wavy hair, a full
// curly beard and moustache, modelled as a signed distance field and meshed with surface nets
// (src/sculpt/mesher.js); the spiked crown is a separate SDF / mesh (gold). Baked by src/bake/sets.js.
// adapted from athenaion/src/sculpt/head.js (face mask, eyes, nose, lips, ears, hair flow, damage)
//
// Local "head units": menton (chin bottom, without beard) y ≈ -0.5, skull vertex y ≈ +0.48, face looks
// along +z, x = the head's left. Origin ≈ centre of the skull at eye level. Meshes are emitted in metres
// (HEAD_SCALE metres per unit) in this orientation; src/sets/fallenhead.js poses them in the world.
//
//   import { buildHeadGeometry, buildCrownGeometry, HEAD_SCALE } from './poseidonHead.js';
//
// Extra vertex attributes: `cav` (0 deep crevice … 1 open) and `aux` (cavity, convex edge, sky
// visibility, flag: 0 skin, 1 hair, 2 beard, 3 eyeball).
import * as THREE from 'three';
import { meshSDF } from '../sculpt/mesher.js';
import { Simplex } from '../core/noise.js';

export const HEAD_SCALE = 5.0; // metres per head unit: menton → vertex ≈ 4.9 m; with beard + crown ≈ 9 m

export const HEAD_LANDMARKS = {
  eyeL: [0.132, 0.0, 0.40], eyeR: [-0.132, 0.0, 0.40], noseTip: [0, -0.168, 0.545], mouth: [0, -0.29, 0.47],
  menton: [0, -0.5, 0.38], beardTip: [0, -0.98, 0.25], crownTop: [0, 0.85, -0.1],
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
  const f = new THREE.Vector3(0.22, -0.16, 1).normalize();                   // looks out (near side, toward camera 8) and down
  const r0 = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), f).normalize();
  const r = r0.applyAxisAngle(f, 0.07);                                     // outer corner slightly higher
  const u = new THREE.Vector3().crossVectors(f, r).normalize();
  return { f: f.toArray(), r: r.toArray(), u: u.toArray() };
})();
// almond opening in eye-local (u temporal, v up): upper / lower lid curves
const EYE_A = 0.08, IRIS = false;
// r6: open almond (ref 8): high, crisp upper-lid arch peaking on the nasal third, flatter lower lid
function lidU(t) { const tt = max(0, 1 - t * t); return 0.036 * Math.pow(tt, 0.55) * (1 - 0.2 * t) + 0.0015 + 0.005 * t; }
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

// ------------------------------------------------------------------ Poseidon: hair, beard, moustache
// hairline height as a function of the angle around the vertical axis (0 = front): a high mature
// forehead, the hair covers the ears and joins the beard, long hair at the nape
function hairline(th) {
  const a = abs(th);
  if (a < 0.7) return 0.205 - 0.012 * sstep(0, 0.7, a);
  if (a < 1.3) return 0.193 - 0.09 * sstep(0.7, 1.3, a);
  if (a < 1.9) return 0.103 - 0.30 * sstep(1.3, 1.9, a);
  return -0.197 - 0.28 * sstep(1.9, Math.PI, a);
}

// lock pattern on a surface given flow coordinates: across (az, wraps) and along (el); returns the
// displacement (negative = raised) for thick wavy tongue-shaped locks with strands
function lockPattern(az, el, N, amp, ph, nz, tg = 1) {
  const wav = 0.85 * Math.sin(el * 5.0 + 0.4 + ph) * sstep(0.08, 0.5, el) + 0.12 * Math.sin(el * 13.0 + az * 2.0);
  const s = az * N / (2 * Math.PI) + wav + 0.2 * nz;
  const li = Math.floor(s), fr = s - li;
  const cx = (fr - 0.5) * 2;
  const prof = sqrt(max(0, 1 - cx * cx * 0.94)) - 1;                       // 0 centre … -1 edge
  const seg = el * 1.7 + 0.37 * li + 0.6 * Math.sin(li * 2.3);
  const sf = seg - Math.floor(seg);
  const tongue = Math.pow(sstep(0.0, 0.9, sf), 0.8) - 1;
  const strands = Math.sin((cx * 3.5 + 0.45 * Math.sin(el * 34 + li)) * Math.PI) * 0.5 + 0.5;
  return -(amp * (0.055 * prof + 0.024 * tg * tongue * (0.6 + 0.4 * (1 - abs(cx)))) - 0.008 * amp * strands);
}

// moustache: two thick tapering locks from under the nose sweeping out and down into the beard
const MOUS = [[0.012, -0.229, 0.506, 0.017], [0.052, -0.243, 0.503, 0.027], [0.1, -0.268, 0.472, 0.032], [0.142, -0.307, 0.43, 0.03], [0.168, -0.365, 0.385, 0.025], [0.178, -0.44, 0.355, 0.018]];
function moustache(ax, py, pz, detail) {
  if (out2(ax, py, pz, 0.1, -0.33, 0.44, 0.2)) return 1e9;
  let best = 1e9, bt = 0, bj = 0;
  for (let j = 0; j < MOUS.length - 1; j++) {
    const a = MOUS[j], b = MOUS[j + 1];
    const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
    const h = clamp(((ax - a[0]) * bax + (py - a[1]) * bay + (pz - a[2]) * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
    const dx = ax - a[0] - bax * h, dy = py - a[1] - bay * h, dz = pz - a[2] - baz * h;
    const dd = sqrt(dx * dx + dy * dy + dz * dz) - (a[3] + (b[3] - a[3]) * h);
    if (dd < best) { best = dd; bt = h; bj = j; }
  }
  if (detail > 0 && best < 0.02) {
    // strands running along the lock: grooves around the lock's cross-section, slightly twisted
    const a = MOUS[bj], b = MOUS[bj + 1];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    const ox = ax - a[0] - tx * bt * tl, oy = py - a[1] - ty * bt * tl, oz = pz - a[2] - tz * bt * tl;
    let nx = ty, ny = -tx, nz = 0; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;   // N = t × z
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    const ang = Math.atan2(ox * bx + oy * by + oz * bz, ox * nx + oy * ny + oz * nz);
    const t = (bj + bt) / (MOUS.length - 1);
    best += 0.004 * (Math.abs(Math.sin(ang * 3.5 + t * 5)) - 0.5);
  }
  return best;
}

// broken neck stump (rough fracture)
function neckDist(px, py, pz, detail) {
  let d = tcap(px, py, pz, 0, -0.2, -0.13, 0, -0.85, -0.2, 0.245, 0.27);
  const nx = 0.1, ny = -0.9, nz = -0.42, l = Math.hypot(nx, ny, nz);
  const pl = (px * nx + (py + 0.62) * ny + (pz + 0.1) * nz) / l;
  const rough = detail > 0 ? 0.035 * NA.fbm3(px * 7, py * 7, pz * 7, 3) + 0.012 * NB.noise3(px * 25, py * 25, pz * 25) : 0;
  return max(d, pl + rough);
}

function hairDist(px, py, pz, detail) {
  const ax = abs(px);
  const th = Math.atan2(px, pz);
  const hl = hairline(th);
  if (py < hl - 0.1) return 1e9;
  const a = abs(th);
  const side = sstep(0.9, 1.6, a);
  const mane = sstep(0.55, 1.05, a) * (1 - sstep(1.8, 2.5, a)) * sstep(-0.3, 0.05, py) * (1 - sstep(0.25, 0.4, py));
  const thick = 0.075 + 0.05 * sstep(-0.1, 0.35, py) + 0.075 * side * sstep(-0.4, 0.1, py) + 0.06 * mane + 0.022 * NC.noise3(px * 4, py * 4, pz * 4);
  let hair = ell(px, py - 0.07, pz + 0.035, 0.325 + thick, 0.37 + thick * 0.8, 0.445 + thick);
  hair = smax(hair, hl - py, 0.05);                    // rounded roll at the hairline
  // keep the hair out of the eye orbits / cheeks (the face mask stays in front of it)
  if (pz > 0.12) hair = smax(hair, -(ell(px, py + 0.12, pz - 0.36, 0.3, 0.3, 0.2)), 0.06);
  if (detail > 0 && hair < 0.1) {
    // flow coordinates around a whorl at the back of the crown
    const wx = px, wy = py - 0.38, wz = pz + 0.18;
    const az = Math.atan2(wx, wz);
    const el = Math.atan2(sqrt(wx * wx + wz * wz), wy);   // 0 at the whorl → ~2.2 at the hairline
    hair += lockPattern(az, el, 12, 1.35, 0, NA.noise2(az * 3, el * 3));
    hair += 0.005 * NB.noise3(px * 8, py * 8, pz * 8);
  }
  return hair;
}

// beard thickness over the base head surface (cheeks, jaw, under the chin) + the hanging mass
function beardThick(ax, py, pz) {
  const lineY = ax < 0.105 ? -0.336 : -0.336 + (ax - 0.105) * 1.5;          // beard line on the cheek
  let T = 0.075 * sstep(lineY + 0.012, lineY - 0.06, py);
  T += 0.05 * sstep(-0.4, -0.52, py) * sstep(0.34, 0.05, ax);                  // thicker under the chin
  T *= sstep(-0.32, -0.12, pz);                                                 // not behind the ears
  return T;
}
function beardDist(px, py, pz, d0, detail) {
  if (py > 0.06 || pz < -0.3) return 1e9;
  const ax = abs(px);
  const T = beardThick(ax, py, pz);
  let b = T > 0.001 ? d0 - T : 1e9;
  // the face mask under-estimates distances far below the chin: clip the offset shell to an envelope
  if (b < 1e8) b = smax(b, ell(px, py + 0.5, pz - 0.12, 0.47, 0.52, 0.5), 0.05);
  // hanging beard: full and long, slightly forked
  if (py < -0.3) {
    let m = ell(px, py + 0.66, pz - 0.31, 0.29, 0.25, 0.2);
    m = smin(m, ell(px, py + 0.84, pz - 0.29, 0.2, 0.2, 0.16), 0.12);
    m = smin(m, ell(ax - 0.06, py + 0.97, pz - 0.27, 0.1, 0.12, 0.11), 0.07);
    m = smax(m, (py + 0.36) - 0.4 * max(0, pz - 0.42), 0.06);                   // starts below the lower lip
    b = smin(b, m, 0.09);
  }
  if (b > 0.12) return b;
  if (detail > 0) {
    // locks flowing down from the face with S-waves and curled, tongue-like ends
    const tb = Math.atan2(px, pz + 0.12);
    const el = sstep(0.02, -1.05, py) * 2.4 + 0.15 * abs(tb);
    b += lockPattern(tb * 1.25, el * 0.8, 17, 1.15, 1.7, NC.noise2(tb * 4, py * 5), 0.45);
    b += 0.004 * ND.noise3(px * 10, py * 10, pz * 10);
  }
  return b;
}

// ------------------------------------------------------------------ the spiked crown (separate mesh)
const CROWN = { c: [0, 0.29, -0.085], tilt: 0.0, rx: 0.405, rz: 0.5, hh: 0.055 };
const CN = [0, Math.cos(CROWN.tilt), -Math.sin(CROWN.tilt)], CF = [0, Math.sin(CROWN.tilt), Math.cos(CROWN.tilt)];
function crownToLocal(px, py, pz) { // → band coords (bx, by up the band normal, bz)
  const qx = px - CROWN.c[0], qy = py - CROWN.c[1], qz = pz - CROWN.c[2];
  return [qx, qx * CN[0] + qy * CN[1] + qz * CN[2], qx * CF[0] + qy * CF[1] + qz * CF[2]];
}
function crownToHead(bx, by, bz) {
  return [CROWN.c[0] + bx + by * CN[0] + bz * CF[0], CROWN.c[1] + by * CN[1] + bz * CF[1], CROWN.c[2] + by * CN[2] + bz * CF[2]];
}
function ellipse2(x, z, rx, rz) {
  const k0 = Math.hypot(x / rx, z / rz), k1 = Math.hypot(x / (rx * rx), z / (rz * rz));
  return k1 === 0 ? -Math.min(rx, rz) : (k0 * (k0 - 1)) / k1;
}
function sdPoly(px, py, V) {
  const n = V.length / 2;
  let d = (px - V[0]) ** 2 + (py - V[1]) ** 2, s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ex = V[j * 2] - V[i * 2], ey = V[j * 2 + 1] - V[i * 2 + 1];
    const wx = px - V[i * 2], wy = py - V[i * 2 + 1];
    const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const bx = wx - ex * h, by = wy - ey * h;
    d = min(d, bx * bx + by * by);
    const c1 = py >= V[i * 2 + 1], c2 = py < V[j * 2 + 1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * sqrt(d);
}
// arrowhead (spear / trident point) outline in (u across, v along) units of the blade
const ARROW = [0, 0.17, 0.072, 0.012, 0.058, -0.06, 0.021, -0.012, -0.021, -0.012, -0.058, -0.06, -0.072, 0.012];
const ARROW_S = 0.8; // crown arrowheads relative to ARROW
export { sdPoly, ARROW };
const SPIKES = (() => {
  const out = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const th = (i - (n - 1) / 2) * 0.43;
    const bx = CROWN.rx * Math.sin(th), bz = CROWN.rz * Math.cos(th);
    let ox = Math.sin(th) / (CROWN.rx * CROWN.rx), oz = Math.cos(th) / (CROWN.rz * CROWN.rz);
    const ol = Math.hypot(ox, oz); ox /= ol; oz /= ol;
    // direction in band coords: up the band normal, leaning outward (sun-ray crown)
    let dx = ox * 0.42, dy = 0.9, dz = oz * 0.42; const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    const L = 0.34 - 0.08 * abs(th) / 1.72;
    const broken = i === 1 || i === 7 ? 0.5 : i === 5 ? 0.78 : 1;
    const B = crownToHead(bx * 1.03, CROWN.hh * 0.6, bz * 1.03);
    const D = crownToHead(dx, dy, dz).map((v, k) => v - CROWN.c[k]);
    // blade frame: T tangent to the ring, W = T × D (blade normal)
    let tx = Math.cos(th) * CROWN.rx, tz = -Math.sin(th) * CROWN.rz; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
    let T = crownToHead(tx, 0, tz).map((v, k) => v - CROWN.c[k]);
    const td = T[0] * D[0] + T[1] * D[1] + T[2] * D[2]; T = T.map((v, k) => v - D[k] * td); const tn = Math.hypot(...T); T = T.map((v) => v / tn);
    const W = [T[1] * D[2] - T[2] * D[1], T[2] * D[0] - T[0] * D[2], T[0] * D[1] - T[1] * D[0]];
    const shaftEnd = (L - 0.12) * (broken < 1 ? broken * 1.35 : 1);
    const H = [B[0] + D[0] * (L - 0.136), B[1] + D[1] * (L - 0.136), B[2] + D[2] * (L - 0.136)];
    out.push({ B, D, T, W, L, H, broken, shaftEnd, c: [B[0] + D[0] * L * 0.5, B[1] + D[1] * L * 0.5, B[2] + D[2] * L * 0.5], R: L * 0.5 + 0.1 });
  }
  return out;
})();
/** crown SDF in head units */
export function crownSDF(px, py, pz, detail = 1) {
  const [bx, by, bz] = crownToLocal(px, py, pz);
  const e = ellipse2(bx, bz, CROWN.rx, CROWN.rz);
  // band: shell sitting on the hair
  let d = max(abs(e - 0.012) - 0.022, abs(by) - CROWN.hh);
  d = smax(d, abs(by) - CROWN.hh, 0.01);
  if (detail > 0 && d < 0.05) {
    const phi = Math.atan2(bx / CROWN.rx, bz / CROWN.rz), arc = phi * 0.49;
    // beaded rims at the top and bottom edges
    for (const s of [1, -1]) {
      const bead = 0.0095 * (0.75 + 0.35 * abs(Math.sin(arc * Math.PI / 0.022)));
      d = min(d, sqrt((e - 0.036) ** 2 + (by - s * (CROWN.hh - 0.009)) ** 2) - bead);
    }
    // a row of raised oval bosses (gems) between the rims
    const u = arc / 0.1 - Math.floor(arc / 0.1) - 0.5;
    const boss = sqrt((u * 0.1 / 1.3) ** 2 + by * by) - 0.021;
    d = smin(d, max(boss, e - 0.046 + 0.25 * max(0, boss + 0.02)), 0.006);
  }
  // spikes
  for (let i = 0; i < SPIKES.length; i++) {
    const S = SPIKES[i];
    if (out2(px, py, pz, S.c[0], S.c[1], S.c[2], S.R)) continue;
    const qx = px - S.B[0], qy = py - S.B[1], qz = pz - S.B[2];
    const v = qx * S.D[0] + qy * S.D[1] + qz * S.D[2];
    const hc = clamp(v / S.shaftEnd, 0, 1) * S.shaftEnd;
    const rx = qx - S.D[0] * hc, ry = qy - S.D[1] * hc, rz = qz - S.D[2] * hc;
    let sp = sqrt(rx * rx + ry * ry + rz * rz) - (0.036 - 0.01 * hc / S.L);
    // collar knob near the base and a ring under the blade
    sp = smin(sp, sph(qx - S.D[0] * 0.03, qy - S.D[1] * 0.03, qz - S.D[2] * 0.03, 0.036), 0.012);
    if (S.broken < 1) {
      // rough snapped end
      sp = max(sp, v - S.shaftEnd + 0.01 + (detail > 0 ? 0.012 * NA.noise3(px * 40, py * 40, pz * 40) : 0));
    } else {
      const hx = px - S.H[0], hy = py - S.H[1], hz = pz - S.H[2];
      const u = hx * S.T[0] + hy * S.T[1] + hz * S.T[2], vv = hx * S.D[0] + hy * S.D[1] + hz * S.D[2], w = hx * S.W[0] + hy * S.W[1] + hz * S.W[2];
      const d2 = sdPoly(u / ARROW_S, vv / ARROW_S, ARROW) * ARROW_S;
      const blade = max(d2, abs(w) - (0.006 + 0.02 * clamp(-d2 / 0.03, 0, 1)));
      sp = min(sp, blade);
      sp = smin(sp, sqrt(u * u + w * w + 0) - 0.024 + max(0, abs(vv + 0.04) - 0.012), 0.006);
    }
    d = smin(d, sp, 0.012);
  }
  if (detail > 0) d += 0.0012 * NC.noise3(px * 30, py * 30, pz * 30) + 0.002 * ND.noise3(px * 9, py * 9, pz * 9);
  return d;
}

// ------------------------------------------------------------------ the head SDF
let HAIR_ID = 0; // side channel: flag of the last evaluated point (aux.w)
/** signed distance in head units (without the crown). detail: 0 = forms only (fast), 1 = full */
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
  d = smin(d, neckDist(px, py, pz, detail), 0.1);
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
    // carved iris ring + drilled pupil (gives the bronze eyes a gaze)
    const rrI = Math.hypot(lu - 0.004, lv + 0.01);
    const carve = detail > 0 ? 0.004 * (1 - sstep(0.002, 0.0055, abs(rrI - 0.033))) + 0.009 * (1 - sstep(0.01, 0.015, rrI)) : 0;
    const ball = max(sph(lu, lv + 0.006, lw - bc, EYE.r - 0.011) + carve, open - 0.03);
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


  // ---------------- forehead furrows and a frown between the brows (mature, stern Poseidon)
  if (detail > 0 && !out2(ax, py, pz, 0.08, 0.13, 0.42, 0.17)) {
    for (const [y0, w] of [[0.118, 0.016], [0.152, 0.014]]) {
      const yy = y0 + 0.012 * Math.cos(px * 10) + 0.004 * NB.noise2(px * 12, y0 * 30);
      const zf = faceZ(ax, yy) + w - 0.0045;
      const g = sqrt((py - yy) ** 2 + (pz - zf) ** 2) - w * (0.6 + 0.4 * sstep(0.2, 0.08, ax));
      d = smax(d, -g, 0.012);
    }
  }

  // ---------------- hair, beard, moustache
  const d0 = d;
  if (py > -0.6) {
    const hair = hairDist(px, py, pz, detail);
    if (hair < d + 0.004) HAIR_ID = 1;
    d = smin(d, hair, 0.022);
  }
  const bd = beardDist(px, py, pz, d0, detail);
  if (bd < 1e8) { if (bd < d + 0.004) HAIR_ID = 2; d = smin(d, bd, 0.024); }
  const mu = moustache(ax, py, pz, detail);
  if (mu < 1e8) { if (mu < d + 0.004) HAIR_ID = 2; d = smin(d, mu, 0.012); }

  if (detail <= 0) return d;

  // ---------------- damage
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
  // cast-bronze surface: slight lumpiness + corrosion pits
  d += 0.0007 * NC.noise3(px * 36, py * 36, pz * 36) + 0.0012 * NA.noise3(px * 7, py * 7, pz * 7);
  return d;
}

const CHIPS = [ // [x, y, z, radius]: dents / missing pieces of the bronze shell
  [0.03, -0.18, 0.56, 0.018],     // nose tip
  [-0.3, 0.12, 0.3, 0.035],       // right temple locks
  [0.22, -0.78, 0.36, 0.05],      // beard lock
  [-0.12, -0.92, 0.3, 0.04],
  [0.42, 0.05, -0.2, 0.05],       // hair at the back
];
const CRACKS = [ // plane through c with normal n, extent R, half-width w (head units)
  { c: [-0.25, 0.25, -0.3], n: [0.6, 0.2, -0.77], R: 0.32, w: 0.006 },
  { c: [0.16, 0.13, 0.38], n: [0.9, 0.3, -0.3], R: 0.07, w: 0.0018 },
].map((k) => { const l = Math.hypot(...k.n); return { ...k, n: k.n.map((v) => v / l) }; });

// ------------------------------------------------------------------ meshing
function attachCavity(geo, f, f0, o) {
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
  const n = pos.length / 3;
  const cav = new Uint8Array(n);
  const aux = new Float32Array(n * 4); // (cavity, convex edge, sky visibility, flag)
  const steps = o.steps || [0.004, 0.01, 0.022, 0.05, 0.1, 0.17];
  const de = 0.006;
  const UP = o.up || [0, 1, 0];
  const J = [[0.45, 0, 0], [-0.45, 0, 0], [0, 0, 0.45], [0, 0, -0.45], [0, 0, 0]];
  const skyVis = (x, y, z, nx, ny, nz) => {
    let acc = 0;
    for (const j of J) {
      let dx = nx * 0.5 + UP[0] + j[0], dy = ny * 0.5 + UP[1] + j[1], dz = nz * 0.5 + UP[2] + j[2];
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const cosw = dx * nx + dy * ny + dz * nz;
      if (cosw <= 0.02) continue;
      let res = 1, t = 0.014;
      for (let k = 0; k < 22 && t < 0.6; k++) {
        const dd = f0(x + dx * t, y + dy * t, z + dz * t);
        if (dd < 0.0015) { res = 0; break; }
        res = min(res, 5 * dd / t);
        t += max(dd * 0.9, 0.008);
      }
      acc += res * clamp(cosw * 1.6, 0, 1);
    }
    return acc / J.length;
  };
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
    f(x, y, z);
    const flag = o.flag !== undefined ? o.flag : HAIR_ID;
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
    aux[i * 4] = 1 - c; aux[i * 4 + 1] = edge; aux[i * 4 + 2] = o.sky === false ? 1 : skyVis(x, y, z, nx, ny, nz); aux[i * 4 + 3] = flag;
  }
  for (let i = 0; i < pos.length; i++) pos[i] *= HEAD_SCALE; // to metres
  geo.setAttribute('cav', new THREE.BufferAttribute(cav, 1, true));
  geo.setAttribute('aux', new THREE.BufferAttribute(aux, 4));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

/**
 * Head mesh (no crown) in metres, head-local orientation.
 * @param {object} o { cell: metres (default 0.03), smooth, up: head-local world-up for sky visibility, sky }
 */
export function buildHeadGeometry(o = {}) {
  const cell = (o.cell || 0.03) / HEAD_SCALE;
  const f = (x, y, z) => headSDF(x, y, z, o.detail ?? 1);
  const f0 = (x, y, z) => min(headSDF(x, y, z, 0), crownSDF(x, y, z, 0));
  const t0 = Date.now();
  const geo = meshSDF(f, { min: [-0.66, -1.16, -0.74], max: [0.66, 0.7, 0.74], cell, smooth: o.smooth ?? 1, bandScale: 1.7 });
  attachCavity(geo, f, f0, o);
  geo.userData.buildMs = Date.now() - t0;
  return geo;
}
/** spiked crown mesh in metres, head-local orientation */
export function buildCrownGeometry(o = {}) {
  const cell = (o.cell || 0.02) / HEAD_SCALE;
  const f = (x, y, z) => crownSDF(x, y, z, o.detail ?? 1);
  const f0 = (x, y, z) => min(headSDF(x, y, z, 0), crownSDF(x, y, z, 0));
  const t0 = Date.now();
  const geo = meshSDF(f, { min: [-0.8, -0.05, -0.9], max: [0.8, 1.0, 0.9], cell, smooth: o.smooth ?? 1, bandScale: 2.2 });
  attachCavity(geo, f, f0, { ...o, flag: 4, steps: [0.004, 0.01, 0.022, 0.05] });
  geo.userData.buildMs = Date.now() - t0;
  return geo;
}
/** SDF in metres, forms only (placement of coral / sand contact on the head surface) */
export function headSDFm(x, y, z) { const S = HEAD_SCALE; return min(headSDF(x / S, y / S, z / S, 0), crownSDF(x / S, y / S, z / S, 0)) * S; }
