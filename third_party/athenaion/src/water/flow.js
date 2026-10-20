// River / lagoon flow field (CPU) → RGBA8 texture for the water shader.
//   R,G : horizontal velocity (m/s), encoded v / (2*VMAX) + 0.5
//   B   : turbulence / rapids amount 0..1 (white water, foam streaks, choppy normals)
//   A   : "current" mask 0..1 (1 = river/channel current, 0 = still lagoon/sea)
// Velocities come from the river & channel centrelines (faster where narrow/shallow, slower at the
// banks), a weak potential flow through the lagoon from the river mouth to the channel, and radial
// outflow + foam from waterfall impacts.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { noiseA, noiseB, noiseC } from '../core/noise.js';

export const VMAX = 4.0;

function polyInfo(px, pz, pts) {
  let best = Infinity, bt = 0, tx = 0, tz = 1, acc = 0, total = 0;
  const lens = [];
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); lens.push(l); total += l; }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const ex = bx - ax, ez = bz - az, ll = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / ll));
    const dx = px - ax - ex * t, dz = pz - az - ez * t, d = dx * dx + dz * dz;
    if (d < best) {
      best = d; bt = (acc + t * lens[i]) / total;
      // smooth tangent across the joint
      const l = Math.sqrt(ll); tx = ex / l; tz = ez / l;
      if (t > 0.7 && i < pts.length - 2) {
        const [cx, cz] = pts[i + 2], nx = cx - bx, nz = cz - bz, nl = Math.hypot(nx, nz), w = (t - 0.7) / 0.6;
        tx = tx * (1 - w) + (nx / nl) * w; tz = tz * (1 - w) + (nz / nl) * w;
      } else if (t < 0.3 && i > 0) {
        const [qx, qz] = pts[i - 1], px2 = ax - qx, pz2 = az - qz, pl = Math.hypot(px2, pz2), w = (0.3 - t) / 0.6;
        tx = tx * (1 - w) + (px2 / pl) * w; tz = tz * (1 - w) + (pz2 / pl) * w;
      }
      const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
    }
    acc += lens[i];
  }
  return { d: Math.sqrt(best), t: bt, tx, tz };
}
function sampleArr(arr, t) { const f = t * (arr.length - 1), i = Math.min(arr.length - 2, Math.floor(f)); return arr[i] + (arr[i + 1] - arr[i]) * (f - i); }

/**
 * @param {object} o
 * @param {number[]} o.bounds
 * @param {number} o.res texels on the long side
 * @param {(x,z)=>number} o.depthAt water depth (m, >0 in water)
 * @param {object[]} o.impacts [{x,z,radius,strength,dir}]
 * @param {object[]} [o.obstacles] [{x,z,r}] boulders in the current: foam collar + white wake downstream
 * @param {object} [o.reach] shallow rapids reach {cam:[x,z], fwd:[dx,dz], sill, length} (heightfield RAPIDS_REACH):
 *   the water runs toward the camera (-fwd) over a cobble bed; white water where the bed is shallow,
 *   a hydraulic jump just downstream of the sill crest and foam streaks trailing toward the camera
 */
export function buildFlowMap({ bounds, res, depthAt, impacts = [], obstacles = [], reach = null }) {
  const t0 = performance.now();
  const [x0, z0, x1, z1] = bounds;
  const asp = (x1 - x0) / (z1 - z0);
  const W = asp >= 1 ? res : Math.round(res * asp), H = asp >= 1 ? Math.round(res / asp) : res;
  const dx = (x1 - x0) / W, dz = (z1 - z0) / H;
  const data = new Uint8Array(W * H * 4);
  const R = L.RIVER, C = L.CHANNEL;
  const mouth = R.points[R.points.length - 1];
  const chanIn = C.points[0];
  const vel = new Float32Array(W * H * 2), turb = new Float32Array(W * H), cur = new Float32Array(W * H);
  const dep = reach ? new Float32Array(W * H) : null, rk = reach ? new Float32Array(W * H) : null;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + (i + 0.5) * dx, z = z0 + (j + 0.5) * dz, k = j * W + i;
    const depth = depthAt(x, z);
    if (dep) dep[k] = depth;
    if (depth <= 0.02) { vel[k * 2] = 0; vel[k * 2 + 1] = 0; turb[k] = 0; cur[k] = 0; continue; }
    let vx = 0, vz = 0, tb = 0, cm = 0;
    // ---- river
    const rv = polyInfo(x, z, R.points);
    const hw = sampleArr(R.width, rv.t) * 0.5;
    const inRiver = 1 - smooth(hw * 0.9, hw + 22, rv.d);
    if (inRiver > 0) {
      const across = Math.min(1, rv.d / (hw + 1e-3));
      const prof = Math.max(0.15, 1 - across * across * 0.85);       // faster in the middle
      const narrow = 40 / Math.max(25, hw * 2);                        // continuity: narrow = fast
      const shallow = Math.min(1.6, 3.5 / Math.max(1.2, depth));
      // rapids reach: from the canyon down to the river mouth (fast, white water — refs 4, 7)
      const reach = smooth(320, 200, z) * smooth(-1300, -900, z);
      const sp = 1.15 * prof * narrow * (0.7 + 0.3 * shallow) * (0.85 + 0.3 * noiseA.fbm2(x / 60, z / 60, 2)) * (1 + 1.1 * reach);
      vx += rv.tx * sp * inRiver; vz += rv.tz * sp * inRiver;
      cm = Math.max(cm, inRiver);
      // rapids: elongated patches along the current (stretched noise), strongest mid-channel
      const ax = x * rv.tz - z * rv.tx, al = x * rv.tx + z * rv.tz;   // across / along the river
      const n = noiseB.fbm2(ax / 26 + 3.1, al / 70, 3) * 0.5 + 0.5;
      const n2 = noiseA.fbm2(ax / 11 + 7.3, al / 34, 2) * 0.5 + 0.5;  // smaller boils / riffles
      const mid = 1 - Math.min(1, rv.d / (hw + 1e-3)) ** 2;
      tb = Math.max(tb, inRiver * (0.12 + 0.07 * reach
        + 0.85 * smooth(0.5, 0.7, n) * reach * (0.45 + 0.55 * mid)
        + 0.25 * smooth(0.58, 0.75, n2) * reach
        + 0.4 * smooth(2.5, 0.6, depth)));
    }
    // eddies / back-currents beside the lower river and around its mouth: choppy water with
    // scattered foam lines (ref 7 foreground), no white-water aeration
    {
      const e = (1 - smooth(hw + 6, hw + 105, rv.d)) * smooth(40, 150, z) * smooth(300, 255, z) * (1 - 0.7 * inRiver);
      if (e > 0) {
        const n3 = noiseC.fbm2(x / 32 + 1.7, z / 32, 3) * 0.5 + 0.5;
        tb = Math.max(tb, e * (0.2 + 0.32 * smooth(0.42, 0.7, n3)));
        cm = Math.max(cm, e * 0.55);
        const sw = 0.55 * e * (n3 - 0.35);
        vx -= rv.tx * sw; vz -= rv.tz * sw;           // slow back-current along the banks
      }
    }
    // ---- channel to the sea
    const ch = polyInfo(x, z, C.points);
    const chw = C.width * 0.5 * (1 + ch.t * 1.5);
    const inCh = 1 - smooth(chw * 0.8, chw + 30, ch.d);
    if (inCh > 0) {
      const sp = 0.45 * (1 - 0.6 * Math.min(1, ch.d / chw)) * (1 - ch.t * 0.6);
      vx += ch.tx * sp * inCh; vz += ch.tz * sp * inCh;
      cm = Math.max(cm, inCh * 0.6);
    }
    // ---- lagoon: weak potential flow mouth → channel (source + sink)
    {
      const sx = x - mouth[0], sz = z - mouth[1], s2 = sx * sx + sz * sz + 400;
      const kx = x - chanIn[0], kz = z - chanIn[1], k2 = kx * kx + kz * kz + 400;
      const q = 900;
      vx += (q * sx) / s2 * 0.05 - (q * kx) / k2 * 0.05;
      vz += (q * sz) / s2 * 0.05 - (q * kz) / k2 * 0.05;
    }
    // ---- waterfall impacts: radial outflow + white water
    for (const im of impacts) {
      const ix = x - im.x, iz = z - im.z, d = Math.hypot(ix, iz) + 1e-3;
      const r = im.radius;
      if (d < r * 6) {
        const fall = Math.exp(-d / (r * 1.6));
        const sp = 2.2 * im.strength * fall;
        vx += (ix / d) * sp; vz += (iz / d) * sp;
        tb = Math.max(tb, im.strength * (1 - smooth(r * 0.5, r * 2.2, d)));
        cm = Math.max(cm, fall);
      }
      // run-out: the plunge drives a current away from the cliff (rapids, foam streaks; ref 7)
      if (im.soft || im.strength < 0.3 || !im.dir) continue;
      const [ux, uz] = im.dir, al = ix * ux + iz * uz, acs = iz * ux - ix * uz, ac = Math.abs(acs);
      // (scaled by the power of the fall: small spills barely stir the lagoon)
      const pw = Math.min(1, im.strength) * Math.min(1, r / 9);
      const Lr = 30 + 90 * pw;
      if (al < -r || al > Lr) continue;
      const w = r * 1.1 + Math.max(0, al) * 0.32;
      const m = (1 - smooth(w * 0.55, w, ac)) * smooth(-r, 0, al) * (1 - smooth(Lr * 0.55, Lr, al));
      if (m <= 0) continue;
      vx += ux * 2.4 * pw * Math.exp(-Math.max(0, al) / 90) * m;
      vz += uz * 2.4 * pw * Math.exp(-Math.max(0, al) / 90) * m;
      const ns = noiseB.fbm2(acs / 4.5 + im.x * 0.01, al / 17, 3) * 0.5 + 0.5;
      tb = Math.max(tb, m * pw * pw * (0.3 + 0.6 * smooth(0.52, 0.74, ns)) * Math.exp(-Math.max(0, al) / 150));
      cm = Math.max(cm, m * 0.8 * pw);
    }
    // shallows near the shore slow down
    const shore = smooth(0.0, 2.0, depth);
    let rkk = 0;
    if (reach) {
      const [fx, fz] = reach.fwd, rx = x - reach.cam[0], rz = z - reach.cam[1];
      const al = rx * fx + rz * fz, ac = -rx * fz + rz * fx;
      if (al > -25 && al < reach.length + 5) {
        const wedge = 1 - smooth(0.8, 1.05, Math.abs(ac) / (al * 0.72 + 20));
        rkk = wedge * smooth(reach.length + 5, reach.length - 25, al) * smooth(-25, -8, al);
      }
      if (rkk > 0) {
        // a fast sheet of water over the cobbles toward the camera, faster over the shallows
        const sh = smooth(0.85, 0.2, depth);
        const spd = (1.5 + 1.7 * sh) * rkk;
        const wob = noiseA.fbm2(ac / 14, al / 30, 2) * 0.35;
        vx = vx * (1 - rkk) + (-fx + fz * wob) * spd; vz = vz * (1 - rkk) + (-fz - fx * wob) * spd;
        // white water where the bed is shallow: streaks stretched along the current
        const ns = noiseB.fbm2(ac / 3.2 + 4.1, al / 13, 3) * 0.5 + 0.5;
        const nb = noiseC.fbm2(ac / 9 + 1.3, al / 9, 2) * 0.5 + 0.5;
        tb = Math.max(tb, rkk * (0.07 + 0.1 * smooth(0.4, 0.7, nb) + sh * (0.12 + 0.4 * smooth(0.45, 0.66, ns))));
        cm = Math.max(cm, rkk);
      }
    }
    if (rk) rk[k] = rkk;
    vx *= 0.25 + 0.75 * Math.max(shore, rkk); vz *= 0.25 + 0.75 * Math.max(shore, rkk);
    vel[k * 2] = vx; vel[k * 2 + 1] = vz; turb[k] = Math.min(1, tb); cur[k] = Math.min(1, cm);
  }
  // rapids reach: water pouring over a shallow crest (depth < 0.3 m) into deeper water just downstream
  // (toward the camera) boils white (hydraulic jump), then trails foam streaks along the current
  if (reach) {
    const [fx, fz] = reach.fwd;
    const st = 0.5, nS = Math.round(26 / st);
    const at = (x, z) => { const i = Math.floor((x - x0) / dx), j = Math.floor((z - z0) / dz); return i < 0 || j < 0 || i >= W || j >= H ? 9 : dep[j * W + i]; };
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (rk[k] <= 0 || dep[k] <= 0.02) continue;
      const x = x0 + (i + 0.5) * dx, z = z0 + (j + 0.5) * dz;
      let dC = -1;
      for (let m = 1; m <= nS; m++) { const d = m * st; const dd = at(x + fx * d, z + fz * d); if (dd < 0.28 && dd > -0.6) { dC = d; break; } if (dd <= -0.6) break; }
      if (dC < 0) continue;
      const rx = x - reach.cam[0], rz = z - reach.cam[1], al = rx * fx + rz * fz, ac = -rx * fz + rz * fx;
      const deeper = smooth(0.25, 0.7, dep[k]);
      const ns = noiseB.fbm2(ac / 2.6 + 9.7, al / 9, 3) * 0.5 + 0.5;
      const jump = deeper * (1 - smooth(1.5, 7.5, dC)) * (0.75 + 0.25 * ns);
      const trail = deeper * smooth(3, 7, dC) * Math.exp(-(dC - 6) / 9) * smooth(0.45, 0.68, ns);
      turb[k] = Math.max(turb[k], rk[k] * Math.min(1, Math.max(jump * 0.75, trail * 0.6)));
      cur[k] = Math.max(cur[k], rk[k]);
    }
  }
  // boulders: foam collar around each rock, white wake streaming downstream, slack water behind it
  for (const o of obstacles) {
    const ci = Math.round((o.x - x0) / dx - 0.5), cj = Math.round((o.z - z0) / dz - 0.5);
    let fx = 0, fz = 1;
    if (ci >= 0 && cj >= 0 && ci < W && cj < H) { const k = cj * W + ci, l = Math.hypot(vel[k * 2], vel[k * 2 + 1]); if (l > 0.05) { fx = vel[k * 2] / l; fz = vel[k * 2 + 1] / l; } }
    if (o.dir) { fx = o.dir[0]; fz = o.dir[1]; }
    const L = o.r * 10, ext = L + o.r * 2;
    const i0 = Math.max(0, Math.floor((o.x - ext - x0) / dx)), i1 = Math.min(W - 1, Math.ceil((o.x + ext - x0) / dx));
    const j0 = Math.max(0, Math.floor((o.z - ext - z0) / dz)), j1 = Math.min(H - 1, Math.ceil((o.z + ext - z0) / dz));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = x0 + (i + 0.5) * dx, z = z0 + (j + 0.5) * dz, k = j * W + i;
      const rx = x - o.x, rz = z - o.z, d = Math.hypot(rx, rz);
      const al = rx * fx + rz * fz, acs = rz * fx - rx * fz, ac = Math.abs(acs);
      const collar = 1 - smooth(o.r * 0.95, o.r * 1.6, d);
      let wake = 0;
      if (al > 0 && al < L) {
        const w = o.r * (0.75 + 0.9 * al / L);
        const ns = noiseC.fbm2(acs / (o.r * 0.35) + o.x, (al - 0) / (o.r * 1.6), 2) * 0.5 + 0.5;
        wake = (1 - smooth(w * 0.45, w, ac)) * Math.exp(-al / (o.r * 3.2)) * (0.35 + 0.65 * smooth(0.45, 0.7, ns));
        const slow = 1 - 0.55 * wake;
        vel[k * 2] *= slow; vel[k * 2 + 1] *= slow;
      }
      const cn = noiseA.fbm2(rx / 1.3 + o.x, rz / 1.3 + o.z, 2) * 0.5 + 0.5;   // broken, lacy collar
      turb[k] = Math.max(turb[k], Math.min(0.8, collar * (0.2 + 0.45 * smooth(0.35, 0.65, cn)) + wake * 0.4));
      cur[k] = Math.max(cur[k], Math.max(collar, wake) * 0.7);
    }
  }
  // light 3x3 blur of the velocity (smooth seams between regimes)
  const vb = new Float32Array(vel.length);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let sx = 0, sz = 0, n = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const ii = Math.min(W - 1, Math.max(0, i + a)), jj = Math.min(H - 1, Math.max(0, j + b)), kk = jj * W + ii;
      sx += vel[kk * 2]; sz += vel[kk * 2 + 1]; n++;
    }
    vb[(j * W + i) * 2] = sx / n; vb[(j * W + i) * 2 + 1] = sz / n;
  }
  for (let k = 0; k < W * H; k++) {
    data[k * 4] = clamp255((vb[k * 2] / (2 * VMAX) + 0.5) * 255);
    data[k * 4 + 1] = clamp255((vb[k * 2 + 1] / (2 * VMAX) + 0.5) * 255);
    data[k * 4 + 2] = clamp255(turb[k] * 255);
    data[k * 4 + 3] = clamp255(cur[k] * 255);
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, W, H, bounds, ms: Math.round(performance.now() - t0) };
}

function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }
