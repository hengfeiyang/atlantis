// Waterfall sheets and strands.
//
// Geometry: every traced sub-stream becomes its own ribbon, slightly wider than the spacing between
// streams. Where the streams travel together the overlapping ribbons (soft-edged profile) splat into
// one continuous veil; where they split (ledges, rock ribs) they naturally become separate strands.
// Extra thin detached strands are added in front of the veil.
// Every vertex carries its arrival time τ: the shader samples streak noise at (across, t − τ), i.e. in
// the frame of the falling parcels, so features are advected with the accelerating flow and stretch
// into long streaks lower down.
// Shading: lit MeshStandardMaterial (CSM shadows + atmosphere) with aerated-water albedo, a glassy
// tongue at the lip, ragged translucent edges, break-up toward the bottom and sun translucency.
import * as THREE from 'three';
import { proceduralMaterial, applyDFGFix } from '../core/materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function pickRows(st, spacing, maxGap) {
  const rows = [0];
  let acc = 0, last = 0;
  const S = st.stride, a = st.samples;
  for (let i = 1; i < st.count; i++) {
    const k = i * S, kp = (i - 1) * S;
    acc += Math.hypot(a[k] - a[kp], a[k + 1] - a[kp + 1], a[k + 2] - a[kp + 2]);
    const contactChange = a[k + 4] !== a[kp + 4];
    if (acc >= spacing || i - last >= maxGap || contactChange || i === st.count - 1) { rows.push(i); acc = 0; last = i; }
  }
  return rows;
}

/**
 * One ribbon along a sub-stream.
 * @param st stream {samples,count,stride,dtRec,u}
 * @param o {hw half width (m), uHalf half width in global u, lipY, totalDrop, fall, seed, kind, outward, lateral, spacing}
 */
function ribbon(st, ground, o) {
  const fall = o.fall;
  const rows = pickRows(st, o.spacing ?? 0.8, o.maxGap ?? 30);
  const R = rows.length;
  if (R < 2) return null;
  const pos = new Float32Array(R * 2 * 3), nor = new Float32Array(R * 2 * 3);
  const a1 = new Float32Array(R * 2 * 4), a2 = new Float32Array(R * 2 * 4), a3 = new Float32Array(R * 2 * 4), a4 = new Float32Array(R * 2 * 4);
  const S = st.stride, A = st.samples;
  const [fax, faz] = fall.across, [fdx, fdz] = fall.dir;
  const endPath = A[(st.count - 1) * S + 3];
  let pax = fax, paz = faz;
  const bulge = o.bulge ?? 0;
  for (let r = 0; r < R; r++) {
    const i = rows[r], k = i * S;
    let x = A[k], y = A[k + 1], z = A[k + 2];
    const contact = A[k + 4];
    const vx = A[k + 5], vy = A[k + 6], vz = A[k + 7];
    const sp = Math.hypot(vx, vy, vz);
    const drop = o.lipY - y;
    // across direction: horizontal, perpendicular to the horizontal motion (or to the rock normal)
    let ax, az;
    const hs = Math.hypot(vx, vz);
    let nrm = null;
    if (contact > 0.5) {
      nrm = ground.N(x, z);
      const nh = Math.hypot(nrm[0], nrm[2]);
      if (nh > 0.25) { ax = -nrm[2] / nh; az = nrm[0] / nh; } else if (hs > 0.2) { ax = -vz / hs; az = vx / hs; } else { ax = pax; az = paz; }
    } else if (hs > 0.25 * sp && hs > 0.3) { ax = -vz / hs; az = vx / hs; } else { ax = fax; az = faz; }
    if (ax * pax + az * paz < 0) { ax = -ax; az = -az; }
    // smooth to avoid twisting
    ax = pax * 0.55 + ax * 0.45; az = paz * 0.55 + az * 0.45;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al; pax = ax; paz = az;
    // push out of the rock on steep contact; small static bulges in free fall
    if (nrm) {
      const steep = 1 - nrm[1];
      const out = (o.outward ?? 0.3) + steep * 0.5;
      x += nrm[0] * out; y += nrm[1] * out * 0.3; z += nrm[2] * out;
    } else {
      const b = bulge * Math.min(1, drop / 6) + (o.outwardAir ?? 0);
      x += fdx * b; z += fdz * b;
    }
    if (o.lateral) { x += fax * o.lateral; z += faz * o.lateral; }
    // width grows a little as the water aerates and spreads
    const hw = o.hw * (1 + Math.min(0.6, Math.max(0, drop) * 0.008));
    const remain = endPath - A[k + 3];
    const endFade = i >= st.count - 1 ? 0 : Math.min(1, remain / 3.0);
    for (let side = 0; side < 2; side++) {
      const sgn = side ? 1 : -1;
      const v = r * 2 + side;
      pos[v * 3] = x + ax * hw * sgn; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z + az * hw * sgn;
      a1[v * 4] = st.u + sgn * o.uHalf; a1[v * 4 + 1] = A[k + 3]; a1[v * 4 + 2] = i * st.dtRec; a1[v * 4 + 3] = drop;
      a2[v * 4] = o.seed; a2[v * 4 + 1] = fall.width; a2[v * 4 + 2] = contact; a2[v * 4 + 3] = endFade;
      a3[v * 4] = o.totalDrop; a3[v * 4 + 1] = fall.flow; a3[v * 4 + 2] = o.kind ?? 0; a3[v * 4 + 3] = sp;
      a4[v * 4] = sgn; a4[v * 4 + 1] = hw; a4[v * 4 + 2] = remain; a4[v * 4 + 3] = fall.spec?.aer ?? 0;
    }
  }
  // normals = cross(along, across), facing outward (toward the flow direction)
  const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tN = new THREE.Vector3();
  for (let r = 0; r < R; r++) {
    const r0 = Math.max(0, r - 1), r1 = Math.min(R - 1, r + 1);
    const c0 = r0 * 2, c1 = r1 * 2;
    tA.set((pos[c1 * 3] + pos[c1 * 3 + 3]) - (pos[c0 * 3] + pos[c0 * 3 + 3]), (pos[c1 * 3 + 1] + pos[c1 * 3 + 4]) - (pos[c0 * 3 + 1] + pos[c0 * 3 + 4]), (pos[c1 * 3 + 2] + pos[c1 * 3 + 5]) - (pos[c0 * 3 + 2] + pos[c0 * 3 + 5]));
    tB.set(pos[r * 6 + 3] - pos[r * 6], pos[r * 6 + 4] - pos[r * 6 + 1], pos[r * 6 + 5] - pos[r * 6 + 2]);
    if (tA.lengthSq() < 1e-8) tA.set(0, -1, 0);
    tN.crossVectors(tA, tB).normalize();
    if (!Number.isFinite(tN.x) || tN.lengthSq() < 0.5) tN.set(fdx, 0, fdz);
    if (tN.x * fdx + tN.z * fdz + tN.y * 0.2 < 0) tN.negate();
    for (let side = 0; side < 2; side++) { const v = r * 2 + side; nor[v * 3] = tN.x; nor[v * 3 + 1] = tN.y; nor[v * 3 + 2] = tN.z; }
  }
  const idx = new Uint32Array((R - 1) * 6);
  for (let r = 0; r < R - 1; r++) {
    const a = r * 2, b = a + 1, c = a + 2, d = a + 3, q = r * 6;
    idx[q] = a; idx[q + 1] = c; idx[q + 2] = b; idx[q + 3] = b; idx[q + 4] = c; idx[q + 5] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aFall', new THREE.BufferAttribute(a1, 4));
  geo.setAttribute('aFall2', new THREE.BufferAttribute(a2, 4));
  geo.setAttribute('aFall3', new THREE.BufferAttribute(a3, 4));
  geo.setAttribute('aFall4', new THREE.BufferAttribute(a4, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

function totalDropOf(fall) {
  let d = 0;
  for (const s of fall.streams) d = Math.max(d, fall.lip.y - s.samples[(s.count - 1) * s.stride + 1]);
  return Math.max(1, d);
}

/** the veil: a coherent grid along the central sub-stream, draped over the rock */
export function buildSheet(fall, ground, rng, o = {}) {
  const K = fall.streams.length;
  const c = fall.streams[Math.floor(K / 2)];
  const rows = pickRows(c, o.spacing ?? 0.8, o.maxGap ?? 30);
  const R = rows.length;
  const totalDrop = totalDropOf(fall);
  const seed = o.seed ?? rng.random();
  if (R < 2) return { geos: [], tris: 0, totalDrop };
  const C = Math.max(4, Math.min(16, Math.round(fall.width / 1.1) + 1));
  const S = c.stride, A = c.samples;
  const [fax, faz] = fall.across, [fdx, fdz] = fall.dir;
  const endPath = A[(c.count - 1) * S + 3];
  const pos = new Float32Array(R * C * 3), nor = new Float32Array(R * C * 3);
  const a1 = new Float32Array(R * C * 4), a2 = new Float32Array(R * C * 4), a3 = new Float32Array(R * C * 4), a4 = new Float32Array(R * C * 4);
  const lump = [];
  for (let j = 0; j < C; j++) lump.push(rng.range(-0.4, 0.5));
  let pax = fax, paz = faz;
  const clear = 0.45;
  for (let r = 0; r < R; r++) {
    const i = rows[r], k = i * S;
    const x = A[k], y = A[k + 1], z = A[k + 2];
    const contact = A[k + 4];
    const vx = A[k + 5], vy = A[k + 6], vz = A[k + 7];
    const sp = Math.hypot(vx, vy, vz), hs = Math.hypot(vx, vz);
    const drop = fall.lip.y - y;
    let ax, az;
    if (contact > 0.5) {
      const n = ground.N(x, z), nh = Math.hypot(n[0], n[2]);
      if (nh > 0.25) { ax = -n[2] / nh; az = n[0] / nh; } else if (hs > 0.2) { ax = -vz / hs; az = vx / hs; } else { ax = pax; az = paz; }
    } else if (hs > 0.25 * sp && hs > 0.3) { ax = -vz / hs; az = vx / hs; } else { ax = fax; az = faz; }
    if (ax * pax + az * paz < 0) { ax = -ax; az = -az; }
    ax = pax * 0.6 + ax * 0.4; az = paz * 0.6 + az * 0.4;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al; pax = ax; paz = az;
    const runK = contact > 0.5 ? Math.max(0, 1 - sp / 5) : 0;
    const widen = (fall.spec?.widen ?? 0) * Math.min(1, Math.max(0, drop) / (fall.spec?.widenDrop ?? 12));
    const spread = (1 + Math.min(0.45, Math.max(0, drop) * 0.006) + widen) * (1 - 0.4 * runK);
    const remain = endPath - A[k + 3];
    const endFade = i >= c.count - 1 ? 0 : Math.min(1, remain / 3.0);
    for (let j = 0; j < C; j++) {
      const u = j / (C - 1);
      const off = (u - 0.5) * fall.width * spread;
      let px = x + ax * off, py = y, pz = z + az * off;
      // static lumps in free fall (rock-shaped flow)
      if (contact < 0.5) { const b = lump[j] * Math.min(1, drop / 8) + (o.front ?? 0) * Math.min(1, drop / 5); px += fdx * b; pz += fdz * b; }
      else {
        // water sliding down a face piles up over the rock bumps: travelling columns / lumps
        // (outward only, so the drape below still keeps the sheet clear of the rock)
        const sp0 = A[k + 3];
        const b = Math.max(0, lump[j] + 0.45 * Math.sin(sp0 * 0.31 + j * 1.7) + 0.25 * Math.sin(sp0 * 0.83 + j * 0.6)) * Math.min(1, drop / 4) * 0.4 + (o.front ?? 0) * 0.6 * Math.min(1, drop / 5);
        px += fdx * b; pz += fdz * b;
      }
      // drape: keep every vertex clear of the rock
      for (let it = 0; it < 8; it++) {
        const h = ground.H(px, pz);
        const need = h + clear - py;
        if (need <= 0) break;
        const n = ground.N(px, pz), nh = Math.hypot(n[0], n[2]);
        if (nh < 0.35) { py = h + clear; break; }
        const step = Math.min(1.2, need * 0.5 + 0.1);
        px += (n[0] / nh) * step; pz += (n[2] / nh) * step;
      }
      const v = r * C + j;
      pos[v * 3] = px; pos[v * 3 + 1] = py; pos[v * 3 + 2] = pz;
      a1[v * 4] = u; a1[v * 4 + 1] = A[k + 3]; a1[v * 4 + 2] = i * c.dtRec; a1[v * 4 + 3] = drop;
      a2[v * 4] = seed; a2[v * 4 + 1] = fall.width * spread; a2[v * 4 + 2] = contact; a2[v * 4 + 3] = endFade;
      a3[v * 4] = totalDrop; a3[v * 4 + 1] = fall.flow; a3[v * 4 + 2] = o.front ? 0.25 : 0; a3[v * 4 + 3] = sp;
      a4[v * 4] = 0; a4[v * 4 + 1] = fall.width; a4[v * 4 + 2] = remain; a4[v * 4 + 3] = fall.spec?.aer ?? 0;
    }
  }
  // relax the draped grid (removes zig-zags from per-vertex push-outs), then re-check clearance
  {
    const tmp = new Float32Array(pos.length);
    for (let pass = 0; pass < 3; pass++) {
      tmp.set(pos);
      for (let r = 1; r < R - 1; r++) for (let j = 0; j < C; j++) {
        const v = r * C + j;
        const jl = Math.max(0, j - 1), jr = Math.min(C - 1, j + 1);
        for (let a = 0; a < 3; a++) {
          const avg = (tmp[((r - 1) * C + j) * 3 + a] + tmp[((r + 1) * C + j) * 3 + a]) * 0.5 * 0.6 + (tmp[(r * C + jl) * 3 + a] + tmp[(r * C + jr) * 3 + a]) * 0.5 * 0.4;
          pos[v * 3 + a] = tmp[v * 3 + a] * 0.5 + avg * 0.5;
        }
        const px = pos[v * 3], pz = pos[v * 3 + 2];
        const h = ground.H(px, pz);
        if (pos[v * 3 + 1] < h + clear * 0.7) {
          const n = ground.N(px, pz), nh = Math.hypot(n[0], n[2]);
          if (nh < 0.35) pos[v * 3 + 1] = h + clear * 0.7;
          else { const need = h + clear * 0.7 - pos[v * 3 + 1]; pos[v * 3] += (n[0] / nh) * Math.min(1.5, need * 0.6); pos[v * 3 + 2] += (n[2] / nh) * Math.min(1.5, need * 0.6); }
        }
      }
    }
  }
  const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tN = new THREE.Vector3();
  const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  for (let r = 0; r < R; r++) for (let j = 0; j < C; j++) {
    const v = r * C + j;
    const r0 = Math.max(0, r - 1), r1 = Math.min(R - 1, r + 1), j0 = Math.max(0, j - 1), j1 = Math.min(C - 1, j + 1);
    const p0 = P(r0 * C + j), p1 = P(r1 * C + j), q0 = P(r * C + j0), q1 = P(r * C + j1);
    tA.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    tB.set(q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]);
    if (tA.lengthSq() < 1e-8) tA.set(0, -1, 0);
    tN.crossVectors(tA, tB).normalize();
    if (!Number.isFinite(tN.x) || tN.lengthSq() < 0.5) tN.set(fdx, 0, fdz);
    if (tN.x * fdx + tN.z * fdz + tN.y * 0.2 < 0) tN.negate();
    nor[v * 3] = tN.x; nor[v * 3 + 1] = tN.y; nor[v * 3 + 2] = tN.z;
  }
  const idx = [];
  const d = (a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  const maxAcross = fall.width / (C - 1) * 3.5 + 1.5;
  for (let r = 0; r < R - 1; r++) for (let j = 0; j < C - 1; j++) {
    const a = r * C + j, b = a + 1, cc = a + C, dd = cc + 1;
    if (d(a, b) > maxAcross || d(cc, dd) > maxAcross) continue;
    idx.push(a, cc, b, b, cc, dd);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aFall', new THREE.BufferAttribute(a1, 4));
  geo.setAttribute('aFall2', new THREE.BufferAttribute(a2, 4));
  geo.setAttribute('aFall3', new THREE.BufferAttribute(a3, 4));
  geo.setAttribute('aFall4', new THREE.BufferAttribute(a4, 4));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  return { geos: [geo], tris: idx.length / 3, totalDrop };
}

/** thin detached strands in front of / at the edges of the veil */
export function buildStrands(fall, ground, rng, count, o = {}) {
  const geos = [];
  const K = fall.streams.length;
  const totalDrop = totalDropOf(fall);
  for (let n = 0; n < count; n++) {
    const edgeBias = rng.random() < 0.5;
    const j = edgeBias ? (rng.random() < 0.5 ? 0 : K - 1) : rng.int(0, K - 1);
    const st = fall.streams[j];
    const hw = rng.range(0.12, 0.32) * Math.min(1.8, 0.5 + fall.width * 0.07);
    const lat = edgeBias ? (j === 0 ? -1 : 1) * rng.range(0.2, 1.2) : rng.range(-0.8, 0.8);
    const start = rng.range(0.02, 0.4);
    const g = ribbon(st, ground, {
      fall, hw, uHalf: hw / fall.width, lipY: fall.lip.y, totalDrop, seed: rng.random(), kind: 1 + start,
      spacing: o.spacing ?? 1.0, outward: 0.6 + rng.range(0, 0.6), outwardAir: rng.range(0.2, 1.3), lateral: lat,
    });
    if (g) geos.push(g);
  }
  return geos;
}

const HEAD = /* glsl */`
varying vec4 vFall; varying vec4 vFall2; varying vec4 vFall3; varying vec4 vFall4;
uniform float uTime;
uniform vec3 uSunCol;
uniform vec3 uSunDirF;
uniform float uDebug;
uniform vec4 uFallK;   // x: glassy lip length, y: streak contrast, z: albedo gain, w: opacity gain
uniform vec4 uFallK2;  // x: white-water threshold offset, y: edge raggedness, z: gap opacity, w: gap darkness
uniform vec3 uFallWhite; // aerated water albedo (blue-white)
uniform vec3 uFallGap;   // thin clear falling water between the white streaks (dark slate)
uniform vec3 uFallGlass; // glassy lip
float wfAlpha; float wfAer; float wfStreak; float wfRough; float wfCasc; float wfTilt; float wfW; float wfStrandK;
varying float vFallSh;
// fades a pattern of period P (m) to its mean once it is finer than ~1.5 px (pf: metres per pixel)
float wfVis(float P, float pf){ return 1.0 - smoothstep(0.55, 1.0, pf * 1.1 / P); }
float wfN(vec2 p, float vis){ return mix(0.5, cgVnoise2(p), vis); }
// simplex version: organic, no lattice-aligned blocks when thresholded (seen at 4K / telephoto)
float wfS(vec2 p, float vis){ return mix(0.5, clamp(0.5 + 0.8 * cgSnoise(vec3(p, 0.0)), 0.0, 1.0), vis); }   // (std ~0.2, like the value noise)
// Patterns travelling with the water: p.y + ph * F, F = along-flow frequency (per second of launch time).
// While F is resolved (well under wfAT, the ~3 px limit) the pattern moves with the water; finer than that
// it freezes into static streaks, constant along the flow. The phase never depends on the pixel footprint:
// a footprint-clamped frequency jumped at every triangle edge (blocky falls) and slid whenever the camera
// moved (video).
float wfAT = 1e6;
float wfSA(vec2 p, float ph, float F, float vis){
  float k = smoothstep(0.5, 1.0, F / wfAT);
  float a = k < 0.999 ? wfS(p + vec2(0.0, ph * F), vis) : 0.5;
  float b = k > 0.001 ? wfS(p + vec2(0.0, 7.31), vis) : 0.5;
  return mix(a, b, k);
}
float wfNA(vec2 p, float ph, float F){
  float k = smoothstep(0.5, 1.0, F / wfAT);
  float a = k < 0.999 ? cgVnoise2(p + vec2(0.0, ph * F)) : 0.5;
  float b = k > 0.001 ? cgVnoise2(p + vec2(0.0, 7.31)) : 0.5;
  return mix(a, b, k);
}
`;
const VHEAD = /* glsl */`
attribute vec4 aFall; attribute vec4 aFall2; attribute vec4 aFall3; attribute vec4 aFall4;
varying vec4 vFall; varying vec4 vFall2; varying vec4 vFall3; varying vec4 vFall4;
uniform sampler2D tFallH; uniform vec4 uFallHB; uniform vec3 uSunDirF; uniform float uFallShK;
varying float vFallSh;
`;
const VPRE = /* glsl */`vFall = aFall; vFall2 = aFall2; vFall3 = aFall3; vFall4 = aFall4;
  // terrain shadow toward the sun (march over the captured terrain height; the sheets do not receive
  // the cascaded shadows of the architecture: the references keep their falls sun-lit and white)
  {
    float sh = 1.0;
    vec3 Ls = normalize(uSunDirF);
    for (int i = 1; i <= 6; i++) {
      float d = float(i * i) * 5.0;
      vec3 p = transformed + Ls * d;
      vec2 uvh = (p.xz - uFallHB.xy) / (uFallHB.zw - uFallHB.xy);
      float h = textureLod(tFallH, clamp(uvh, 0.0, 1.0), 1.0).r;
      sh *= 1.0 - smoothstep(-1.5, 2.5, h - p.y) * 0.8;
    }
    vFallSh = mix(1.0, sh, uFallShK);
  }`;

// Look of real falls (refs 2, 3, 7, 9 at 1:1): a short glassy, darker lip where the water curls over;
// white fingers grow out of it within a metre or two; below, the sheet is a mass of fibrous vertical
// white streaks and thicker columns with dark slate gaps of thin clear water between them (the rock
// shows through), ragged edges that break into separate strands, and the whole fall whitening and
// thinning into spray toward the bottom. Shaded columns are blue-grey, sunlit sides bright white.
// Every feature lives in the frame of the falling parcels (xm metres across, ph launch time), so it
// is advected with the accelerating water and stretches into long streaks lower down.
const COLOR = /* glsl */`
  float u = vFall.x, sPath = vFall.y, tau = vFall.z, drop = vFall.w;
  float seed = vFall2.x, width = vFall2.y, contact = vFall2.z, endFade = vFall2.w;
  float totalDrop = vFall3.x, flow = vFall3.y, kind = vFall3.z, speed = vFall3.w;
  float vLoc = vFall4.x, remain = vFall4.z;
  float aerX = clamp(vFall4.w, 0.0, 1.6);             // spec.aer: spouts / cascades start aerated
  float strand = step(0.5, kind);
  float frontL = step(0.1, kind) * (1.0 - strand);     // wispy front veil
  float cascK = smoothstep(1.25, 1.4, aerX) * (1.0 - strand);
  float ph = uTime - tau;                              // launch time of the parcel at this point
  float xm = u * width + seed * 53.1;                  // metres across the sheet
  float rel = clamp(drop / max(totalDrop, 1.0), 0.0, 1.0);
  float run = contact * (1.0 - smoothstep(2.5, 7.0, speed));
  float pf = max(fwidth(xm), 1e-4);                    // metres per pixel across
  float pT = max(fwidth(ph), 1e-5);                    // launch-time per pixel along
  float aT = 0.33 / pT;                                // max along-frequency (period >= 3 px)
  wfAT = aT;
  float sc = mix(1.0, 2.2, strand);
  // strands meander slowly sideways as they fall
  float wig = (wfNA(vec2(xm * 0.35 + 3.3, 0.0), ph, 0.5) - 0.5) * (0.25 + 1.3 * min(drop / 25.0, 1.0));
  float xw = xm + wig;
  // (finer braiding: threads waver and cross instead of running parallel like a bar code)
  float wig2 = (wfNA(vec2(xm * 1.4 + 11.0, 0.0), ph, 1.6) - 0.5) * 0.45 * min(drop / 6.0, 1.0);
  float xb = xw + wig2;
  // ---- the streak field
  float vA = wfVis(3.0 / sc, pf), vB = wfVis(0.55 / sc, pf), vC = wfVis(0.14 / sc, pf), vD = wfVis(1.2 / sc, pf), vE = wfVis(0.32 / sc, pf);
  // (along-flow frequencies in launch time: at ~15 m/s the streaks are 8-12x longer than wide, the
  //  plumes 4-6x; near the slow lip the same features are short lumps and fingers)
  float cA = wfSA(vec2(xw * 0.33 * sc + seed * 7.0, 0.0), ph, 0.25, vA);          // columns of thicker water
  float sB = wfSA(vec2(xw * 1.8 * sc + 9.1, 0.0), ph, 1.0, vB);                   // streaks
  float rB = mix(0.5, 1.18 - abs(2.0 * sB - 1.0) - 0.36, vB);   // (re-centred on 0.5)                                 // (ridged: thin bright threads)
  float fC = wfSA(vec2(xb * 7.0 * sc + 1.9, 0.0), ph, 6.0, vC);                   // fine fibres
  float pD = wfSA(vec2(xw * 0.85 * sc + 17.0, 3.0), ph, 4.0, vD);           // plumes / clumps
  float pE = wfSA(vec2(xw * 3.1 * sc + 5.0, 0.0), ph, 9.5, vE);
  // resolution-aware streaks for distant falls: one octave at a period of ~3-6 px, blended between
  // power-of-two frequencies (stable while the camera moves), long along the flow
  float Lr = log2(0.33 / pf), Lf = floor(Lr), Lt = Lr - Lf;
  float fq0 = min(exp2(Lf - 1.0), 8.0), fq1 = min(exp2(Lf), 8.0);
  float farS = mix(wfNA(vec2(xb * fq0 + 7.0, seed * 5.0), ph, 0.18 * fq0), wfNA(vec2(xb * fq1 + 2.0, seed * 3.0), ph, 0.3 * fq1), Lt);
  float farK = 1.0 - vB;
  // coherent streaky sheet in the upper fall → lumpy plumes lower down (blend of two fields, so the
  // features still travel with the water)
  float Fs = cA * 0.4 + rB * 0.35 + fC * 0.25;
  float Fp = cA * 0.3 + pD * 0.4 + pE * 0.3;
  float F = mix(Fs, Fp, smoothstep(0.1, 0.7, rel) * 0.7 * (1.0 - strand));
  // cascades / rapids pours: churning froth — lumps and boils, not streaks
  float bA = wfSA(vec2(xw * 2.4 + 41.0, 0.0), ph, 3.5, wfVis(0.42, pf)), bB = wfSA(vec2(xw * 6.5 + 13.0, 0.0), ph, 16.0, wfVis(0.15, pf));
  F = mix(F, pD * 0.3 + bA * 0.42 + bB * 0.28, cascK);
  // (the pixel-scale octave is always on: fibrous streaks 3-6 px apart at every distance, the fine detail
  //  of real falls in a 4K frame; stronger far away where the metric octaves have faded out)
  F = (F - 0.5) * (1.7 * uFallK.y) + 0.5 + (farS - 0.5) * (0.3 + 0.45 * farK);
  // ---- aeration: glassy lip → white fingers → white water (spouts / cascades start aerated)
  float lipL = (0.7 + 0.9 * flow) * uFallK.x;
  float aerP = smoothstep(0.0, lipL, drop + contact * 1.2 + aerX * 0.8);
  float brk = smoothstep(0.5, 1.0, rel) * (1.0 - strand * 0.5);            // break-up near the bottom
  float th = mix(1.02, 0.45, aerP) - 0.1 * brk - 0.12 * aerX + uFallK2.x;
  float W = smoothstep(th - 0.06, th + 0.06, F);
  W = mix(W, max(W, smoothstep(0.12, 0.42, F)), cascK);
  // far away the thin gaps are sub-pixel: the fall reads as aerated white water with soft streaks
  W = mix(W, 0.5 + 0.5 * W, farK * aerP);
  // ---- coverage: white water is opaque, the gaps are thin clear water (the rock shows, darkened)
  float gapA = (uFallK2.z + 0.2 * cA) * (1.0 - 0.45 * brk);
  float cover = mix(gapA, 1.0, W);
  cover = mix(cover, 0.78 + 0.22 * cover, farK);
  cover = mix(0.9, cover, aerP);                                          // the lip is a continuous glassy sheet
  // ragged edges: the width wanders along the fall and the outer columns separate into strands
  float uW0 = (wfNA(vec2(seed * 13.0, 0.0), ph, 0.21) - 0.5), uW1 = (wfNA(vec2(seed * 13.0 + 7.7, 0.0), ph, 0.17) - 0.5);
  float dE = min(u + uW0 * 0.3 * uFallK2.y * aerP, 1.0 - u + uW1 * 0.3 * uFallK2.y * aerP);
  float eW = 0.04 + (0.12 + 0.12 * brk) * aerP + 0.12 * cascK;
  float edge = smoothstep(-0.01, eW, dE + (fC - 0.5) * 0.06 + (sB - 0.5) * 0.12 + (pD - 0.5) * 0.08 * aerP);
  float outer = 1.0 - smoothstep(0.02, 0.26, dE);
  float split = smoothstep(0.38, 0.6, wfSA(vec2(xw * 1.1 + 31.0, 0.0), ph, 0.15, wfVis(0.9, pf)));
  edge *= mix(1.0, split, outer * aerP * (1.0 - cascK) * (1.0 - strand));
  if (strand > 0.5) edge = 1.0 - smoothstep(0.35, 1.0, abs(vLoc) + (fC - 0.5) * 0.35 + (sB - 0.5) * 0.3);
  float alpha = edge * cover;
  // droplets flung off the ragged sides (resolved from close range only)
  float dV = wfVis(0.12, pf) * aerP * (1.0 - strand) * (1.0 - frontL) * (1.0 - smoothstep(0.5, 1.0, 22.0 / aT));
  if (dV > 0.01) {
    vec2 dc = vec2(xw * 8.0, ph * 22.0);
    vec2 di = floor(dc), df = fract(dc) - 0.5;
    float dh = cgHash12(di + seed * 17.0);
    float drp = (1.0 - smoothstep(0.1, 0.32, length(df * vec2(1.0, 0.55)))) * step(0.86, dh);
    float zone = outer * (1.0 - edge * 0.8) * smoothstep(0.1, 0.3, rel);
    alpha = max(alpha, drp * zone * dV * 0.9);
    W = max(W, drp * zone * dV);
  }
  // water sliding down a rock face breaks up (wet rock shows between the tongues); slow sheet water on
  // ledges is thin, broken by foam lines
  alpha *= mix(1.0, 0.2 + 0.8 * W, contact * aerP);
  alpha *= mix(1.0, 0.35 + 0.55 * smoothstep(0.4, 0.7, pE * 0.5 + fC * 0.5), run);
  if (strand > 0.5) {
    // detached strands: start below the lip, only while falling free, intermittent gushes
    alpha *= smoothstep(kind - 1.0, kind - 1.0 + 0.08, rel) * (0.3 + 0.7 * W);
    alpha *= 1.0 - smoothstep(0.1, 0.6, contact);
    alpha *= smoothstep(0.42, 0.68, cgVnoise2(vec2(seed * 31.0, ph * 2.6))) * 0.75;
  }
  // front veil: only scattered white streaks a metre in front (depth, not a milky film)
  alpha = mix(alpha, edge * W * 0.55 * smoothstep(0.08, 0.45, rel) * (0.5 + 0.5 * pD), frontL);
  alpha *= endFade;
  float lipN = cgVnoise2(vec2(xm * 0.7 + seed * 9.0, seed * 3.0)) * 1.6 + 2.2 * (1.0 - smoothstep(0.0, 0.3, min(u, 1.0 - u))) * (1.0 - strand);
  alpha *= smoothstep(lipN * 0.6, lipN + 1.0 + 1.4 * fC + 2.2 * cascK * bA, sPath);    // soft, ragged start upstream of the lip (froth heaving over cascade crests)
  wfAlpha = clamp(alpha * uFallK.w, 0.0, 1.0);
  // ---- albedo: dark glassy lip, blue-white aerated streaks over dark slate gaps
  float fib = (fC - 0.5) * vC * 0.8 + (pE - 0.5) * 0.3 + (farS - 0.5) * (0.25 + 0.15 * farK);
  vec3 white = uFallWhite * clamp(0.86 + fib + 0.1 * brk, 0.5, 1.15);
  vec3 gap = mix(uFallGap * (0.8 + 0.5 * cA) * uFallK2.w, uFallWhite * 0.45, cascK);
  vec3 alb = mix(gap, white, W);
  alb = mix(uFallGlass * (0.85 + 0.3 * rB), alb, aerP);
  // cascade band: tumbling white froth (ref 7), whiter than the blue-white fibres of a free fall
  alb = mix(alb, vec3(0.8, 0.83, 0.85) * (0.85 + 0.3 * bB), cascK * W);
  wfAer = aerP * mix(1.0, 0.7, run); wfStreak = F; wfW = W; wfStrandK = max(strand, frontL);
  wfCasc = cascK;
  // column relief (thick water columns are rounded: their sun side is bright, the far side blue-grey)
  float e1 = 0.35;
  float cAr = wfSA(vec2((xw + e1) * 0.33 * sc + seed * 7.0, 0.0), ph, 0.25, vA);
  float sBr = wfSA(vec2((xw + e1 * 0.2) * 1.8 * sc + 9.1, 0.0), ph, 1.0, vB);
  float bAr = wfSA(vec2((xw + 0.08) * 2.4 + 41.0, 0.0), ph, 3.5, wfVis(0.42, pf));
  wfTilt = clamp(mix((cAr - cA) * 2.2 + (sBr - sB) * 0.9, (bAr - bA) * 5.0 + (cAr - cA) * 1.5, cascK), -1.0, 1.0) * aerP;
  diffuseColor.rgb = alb * uFallK.z;
  diffuseColor.a = wfAlpha;
  diffuseColor.rgb *= mix(0.55, 1.0, vFallSh);
  wfRough = mix(0.06, mix(0.3, 0.5, W), wfAer);
  if (uDebug > 0.5 && uDebug < 1.5) { diffuseColor = vec4(1.0, 0.0, 0.0, 1.0); wfAlpha = 1.0; }
  if (uDebug > 4.5) { wfAlpha = 1.0; diffuseColor = vec4(0.8, 0.8, 0.8, 1.0); }
  else if (uDebug > 1.5) { if (wfAlpha < 0.25 && uDebug < 4.5) discard; wfAlpha = 1.0; diffuseColor = vec4(uDebug < 2.5 ? vec3(wfAer, rel, u) : uDebug < 3.5 ? vec3(alpha, W, edge) : vec3(fract(drop / 10.0), contact, endFade), 1.0); }
  if (uDebug > 7.5) { wfAlpha = 1.0; diffuseColor = vec4(W, F, pf * 10.0, 1.0); }
  if (wfAlpha < 0.012) discard;
`;
const ROUGH = /* glsl */`roughnessFactor = wfRough;`;
const NORMAL = /* glsl */`
  // three flips the normal by gl_FrontFacing; our ribbons' winding is arbitrary, so rebuild a
  // camera-facing normal and express the final normal as a delta from what three uses
  vec3 Nused = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 Ncam = dot(cgN, cgV) >= 0.0 ? cgN : -cgN;
  vec3 acr = normalize(cross(vec3(0.0, 1.0, 0.0), Ncam) + vec3(1e-4));
  // rounded columns / threads (relief from the streak field) + a mild wrap toward the sun (volume
  // scattering of aerated water keeps the shaded side from going black, not flat)
  // the lip curls over: its normal turns from up (smooth water arriving) to the camera-facing sheet,
  // so the glassy tongue mirrors the bright sky in a band before it breaks into white water
  // (the wrap only where the sun is on the camera side: a backlit fall stays a grey-blue body with glowing
  //  translucent edges, as in refs 3 and 7 — not a sunlit white sheet)
  float sunSide = smoothstep(-0.45, 0.25, dot(Ncam, uSunDirF));
  vec3 Nf = normalize(Ncam + acr * wfTilt * 3.2 + uSunDirF * 0.55 * wfAer * sunSide + vec3(0.0, 1.4, 0.0) * (1.0 - wfAer) * (1.0 - wfStrandK));
  cgBump = Nf - Nused;
`;
const EMISSIVE = /* glsl */`
  // light transmitted through thin parts of the sheet when the sun is behind it
  float mu = max(dot(-cgV, uSunDirF), 0.0);
  float thin = 1.0 - wfAlpha * 0.6;
  totalEmissiveRadiance += uSunCol * (0.012 + 0.1 * pow(mu, 4.0)) * thin * wfAer * 0.35 * (1.0 + 2.0 * wfCasc) * vFallSh;
  // backlit aerated water glows (light scattered through the white water, ref 7)
  totalEmissiveRadiance += uSunCol * diffuseColor.rgb * wfW * (0.04 + 0.2 * pow(mu, 2.0)) * (0.5 + wfCasc) * vFallSh;
  // multiple scattering inside the aerated water: white water glows a little even in grazing sun
  totalEmissiveRadiance += uSunCol * diffuseColor.rgb * 0.05 * wfAer * wfW * vFallSh;
  // rolling white water of the cascade band (ref 7): churning foam scatters skylight and the sun glow of
  // the spray around it, so it stays bright white even where the bay is in shade
  totalEmissiveRadiance += uSunCol * diffuseColor.rgb * uFallK2.w * 0.3 * wfCasc * wfW * mix(0.6, 1.0, vFallSh);
  if (uDebug > 1.5 && uDebug < 4.5) totalEmissiveRadiance = diffuseColor.rgb * 3.0;
  if (uDebug > 4.5 && uDebug < 5.5) totalEmissiveRadiance = vec3(0.0);
  if (uDebug > 7.5) totalEmissiveRadiance = diffuseColor.rgb * 3.0;
  else if (uDebug > 5.5) { vec3 wn = (vec4(normal, 0.0) * viewMatrix).xyz; totalEmissiveRadiance = uDebug < 6.5 ? vec3(max(dot(wn, uSunDirF), 0.0)) * 3.0 : (wn * 0.5 + 0.5) * 3.0; }
`;

/** @param shared optional existing uniforms object (hot-swap a new shader version onto a live mesh) */
export function createFallMaterial({ hTex = null, hBounds = [0, 0, 1, 1], uniforms: shared = null } = {}) {
  const defaults = {
    uTime: { value: 0 },
    uSunCol: { value: new THREE.Color(4.2, 3.6, 2.8) },
    uSunDirF: { value: new THREE.Vector3(0, 1, 0) },
    tFallH: { value: hTex }, uFallHB: { value: new THREE.Vector4(...hBounds) }, uFallShK: { value: hTex ? 1 : 0 },
    uDebug: { value: 0 },
    uFallK: { value: new THREE.Vector4(1, 1, 0.72, 1) },
    uFallK2: { value: new THREE.Vector4(0.06, 1, 0.4, 1) },
    uFallWhite: { value: new THREE.Color(0.5, 0.58, 0.66) },
    uFallGap: { value: new THREE.Color(0.075, 0.1, 0.12) },
    uFallGlass: { value: new THREE.Color(0.035, 0.06, 0.065) },
  };
  const uniforms = shared || defaults;
  if (shared) for (const [k, v] of Object.entries(defaults)) if (!shared[k] || (k === 'uFallK2' && shared[k].value.w === 0)) shared[k] = v;
  const mat = proceduralMaterial({
    name: 'waterfallSheet',
    params: { color: 0xffffff, roughness: 0.6, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide },
    uniforms,
    head: HEAD,
    vertexHead: VHEAD,
    vertexPre: VPRE,
    color: COLOR,
    roughness: ROUGH,
    normal: NORMAL,
    emissive: EMISSIVE,
  });
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => { base(shader, r); shader.fragmentShader = applyDFGFix(shader.fragmentShader); };
  mat.userData.shaderKey += ':dfgfix1';
  return { material: mat, uniforms };
}

export function mergeAll(geos) {
  if (!geos.length) return null;
  for (const g of geos) if (g.index && !(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1));
  return mergeGeometries(geos, false);
}
