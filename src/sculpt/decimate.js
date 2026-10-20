// Quadric-error-metric mesh decimation (Garland & Heckbert edge collapse) for the baked statue meshes.
// Works on indexed position-only meshes (surface-nets output); other attributes are dropped — callers
// re-derive normals (from the SDF gradient) and re-bake AO / cavity / gilt afterwards (library.js).
//
//   import { decimate } from './decimate.js';
//   const g2 = decimate(geo, 110000);                 // → new indexed BufferGeometry (position only)
//   const g3 = decimate(geo, 0.25);                   // ratio < 1 → keep 25 % of the triangles
//
// Guards: link condition (no non-manifold collapses), normal-flip / sliver rejection, boundary edges
// weighted by perpendicular constraint planes. Lazy-deletion binary heap, O(n log n).
import * as THREE from 'three';

export function decimate(geo, target, opts = {}) {
  const P0 = geo.attributes.position.array;
  const I0 = geo.index ? geo.index.array : Uint32Array.from({ length: P0.length / 3 }, (_, i) => i);
  const nv = P0.length / 3, nf0 = I0.length / 3;
  const want = target < 1 ? Math.round(nf0 * target) : Math.round(target);
  if (want >= nf0) return geo;
  let flipCos = opts.flipCos ?? 0.15;
  const boundaryW = opts.boundaryW ?? 100;
  let minQual = opts.minQuality ?? 0.08;

  const P = Float64Array.from(P0);
  const F = Int32Array.from(I0);
  const faceAlive = new Uint8Array(nf0).fill(1);
  const vAlive = new Uint8Array(nv).fill(1);
  const stamp = new Int32Array(nv);
  // vertex → faces (dynamic arrays)
  const vf = Array.from({ length: nv }, () => []);
  for (let f = 0; f < nf0; f++) for (let k = 0; k < 3; k++) vf[F[f * 3 + k]].push(f);

  // ---- quadrics
  const Q = new Float64Array(nv * 10);
  const addPlane = (v, a, b, c, d, w) => {
    const o = v * 10;
    Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
    Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
    Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d;
  };
  const fn = new Float64Array(3);
  const faceNormal = (f, out = fn) => {
    const a = F[f * 3] * 3, b = F[f * 3 + 1] * 3, c = F[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
    return Math.hypot(out[0], out[1], out[2]);
  };
  for (let f = 0; f < nf0; f++) {
    const l = faceNormal(f);
    if (l < 1e-20) continue;
    const a = fn[0] / l, b = fn[1] / l, c = fn[2] / l, v0 = F[f * 3] * 3;
    const d = -(a * P[v0] + b * P[v0 + 1] + c * P[v0 + 2]);
    const w = l * 0.5;
    for (let k = 0; k < 3; k++) addPlane(F[f * 3 + k], a, b, c, d, w);
  }
  // boundary edges: constraint plane through the edge, perpendicular to the face
  {
    const em = new Map(), ef = new Map();
    for (let f = 0; f < nf0; f++) for (let k = 0; k < 3; k++) {
      const a = F[f * 3 + k], b = F[f * 3 + ((k + 1) % 3)];
      const key = a < b ? a * nv + b : b * nv + a;
      em.set(key, (em.get(key) || 0) + 1);
      if (!ef.has(key)) ef.set(key, f);
    }
    for (const [key, cnt] of em) {
      if (cnt !== 1) continue; // boundary edge
      const f = ef.get(key);
      const a = Math.floor(key / nv), b = key % nv;
      const l = faceNormal(f);
      if (l < 1e-20) continue;
      const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], ez = P[b * 3 + 2] - P[a * 3 + 2];
      let px = ey * fn[2] - ez * fn[1], py = ez * fn[0] - ex * fn[2], pz = ex * fn[1] - ey * fn[0];
      const pl = Math.hypot(px, py, pz);
      if (pl < 1e-20) continue;
      px /= pl; py /= pl; pz /= pl;
      const d = -(px * P[a * 3] + py * P[a * 3 + 1] + pz * P[a * 3 + 2]);
      const w = boundaryW * (ex * ex + ey * ey + ez * ez);
      addPlane(a, px, py, pz, d, w); addPlane(b, px, py, pz, d, w);
    }
  }

  // ---- edge cost
  const opt = new Float64Array(3);
  const cost = (a, b) => {
    const oa = a * 10, ob = b * 10;
    const q = new Array(10);
    for (let i = 0; i < 10; i++) q[i] = Q[oa + i] + Q[ob + i];
    // solve [q0 q1 q2; q1 q4 q5; q2 q5 q7] x = -[q3 q6 q8]
    const A = q[0], B = q[1], C = q[2], D = q[4], E = q[5], G = q[7];
    const det = A * (D * G - E * E) - B * (B * G - E * C) + C * (B * E - D * C);
    const ev = (x, y, z) => q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    const el = Math.hypot(bx - ax, by - ay, bz - az);
    let best = Infinity;
    if (Math.abs(det) > 1e-12 * Math.max(1e-30, Math.abs(A * D * G))) {
      const r0 = -q[3], r1 = -q[6], r2 = -q[8];
      const x = (r0 * (D * G - E * E) - B * (r1 * G - E * r2) + C * (r1 * E - D * r2)) / det;
      const y = (A * (r1 * G - E * r2) - r0 * (B * G - E * C) + C * (B * r2 - r1 * C)) / det;
      const z = (A * (D * r2 - r1 * E) - B * (B * r2 - r1 * C) + r0 * (B * E - D * C)) / det;
      // keep the optimum near the edge (ill-conditioned quadrics can throw it far away)
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      if (Math.hypot(x - mx, y - my, z - mz) < el * 1.5) { best = ev(x, y, z); opt[0] = x; opt[1] = y; opt[2] = z; }
    }
    for (const t of [0, 0.5, 1]) {
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      const e = ev(x, y, z);
      if (e < best) { best = e; opt[0] = x; opt[1] = y; opt[2] = z; }
    }
    return Math.max(0, best);
  };

  // ---- heap (lazy deletion)
  let hc = [], ha = [], hb = [], hsa = [], hsb = [], hpx = [], hpy = [], hpz = [];
  const hswap = (i, j) => {
    for (const arr of [hc, ha, hb, hsa, hsb, hpx, hpy, hpz]) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  };
  const push = (a, b) => {
    const c = cost(a, b);
    let i = hc.length;
    hc.push(c); ha.push(a); hb.push(b); hsa.push(stamp[a]); hsb.push(stamp[b]); hpx.push(opt[0]); hpy.push(opt[1]); hpz.push(opt[2]);
    while (i > 0) { const p = (i - 1) >> 1; if (hc[p] <= hc[i]) break; hswap(i, p); i = p; }
  };
  const pop = () => {
    const n = hc.length - 1;
    hswap(0, n);
    const r = [hc.pop(), ha.pop(), hb.pop(), hsa.pop(), hsb.pop(), hpx.pop(), hpy.pop(), hpz.pop()];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, rr = l + 1;
      let m = i;
      if (l < hc.length && hc[l] < hc[m]) m = l;
      if (rr < hc.length && hc[rr] < hc[m]) m = rr;
      if (m === i) break;
      hswap(i, m); i = m;
    }
    return r;
  };
  {
    const seen = new Set();
    for (let f = 0; f < nf0; f++) for (let k = 0; k < 3; k++) {
      const a = F[f * 3 + k], b = F[f * 3 + ((k + 1) % 3)];
      const key = a < b ? a * nv + b : b * nv + a;
      if (seen.has(key)) continue;
      seen.add(key);
      push(Math.min(a, b), Math.max(a, b));
    }
  }

  // ---- collapse loop
  let nf = nf0;
  const nbrs = (v, out) => {
    out.clear();
    for (const f of vf[v]) for (let k = 0; k < 3; k++) { const w = F[f * 3 + k]; if (w !== v) out.add(w); }
    return out;
  };
  const NA = new Set(), NB = new Set();
  const n0 = new Float64Array(3), n1 = new Float64Array(3);
  const tri = (f, mv, px, py, pz, out) => {
    // normal + quality of face f with vertex mv moved to p
    const idx = [F[f * 3], F[f * 3 + 1], F[f * 3 + 2]];
    const pt = idx.map((v) => (v === mv ? [px, py, pz] : [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]));
    const ux = pt[1][0] - pt[0][0], uy = pt[1][1] - pt[0][1], uz = pt[1][2] - pt[0][2];
    const vx = pt[2][0] - pt[0][0], vy = pt[2][1] - pt[0][1], vz = pt[2][2] - pt[0][2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
    const l = Math.hypot(out[0], out[1], out[2]);
    const e2 = ux * ux + uy * uy + uz * uz + vx * vx + vy * vy + vz * vz + (pt[2][0] - pt[1][0]) ** 2 + (pt[2][1] - pt[1][1]) ** 2 + (pt[2][2] - pt[1][2]) ** 2;
    return { l, q: e2 > 0 ? (l * 3.4641) / e2 : 0 }; // 4√3·A / Σe² (1 = equilateral); l = 2A
  };
  const okMove = (v, other, px, py, pz) => {
    for (const f of vf[v]) {
      if (!faceAlive[f]) continue;
      const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (a === other || b === other || c === other) continue; // removed by the collapse
      const before = tri(f, -1, 0, 0, 0, n0);
      const after = tri(f, v, px, py, pz, n1);
      if (after.l < 1e-20) return false;
      const d = (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (before.l * after.l + 1e-30);
      if (d < flipCos) return false;
      if (after.q < minQual && after.q < before.q) return false;
    }
    return true;
  };
  const reseed = () => {
    const seen = new Set();
    for (let f = 0; f < nf0; f++) if (faceAlive[f]) for (let k = 0; k < 3; k++) {
      const a = F[f * 3 + k], b = F[f * 3 + ((k + 1) % 3)];
      const key = a < b ? a * nv + b : b * nv + a;
      if (!seen.has(key)) { seen.add(key); push(Math.min(a, b), Math.max(a, b)); }
    }
  };
  for (let pass = 0; pass < 3 && nf > want; pass++) {
  if (pass > 0) { reseed(); flipCos *= 0.4; minQual *= 0.4; }
  while (nf > want && hc.length) {
    const [c, a, b, sa, sb, px, py, pz] = pop();
    if (!vAlive[a] || !vAlive[b] || stamp[a] !== sa || stamp[b] !== sb) continue;
    if (opts.maxError !== undefined && c > opts.maxError) break;
    // link condition: common neighbours must be exactly the opposite vertices of the shared faces
    nbrs(a, NA); nbrs(b, NB);
    if (!NA.has(b)) continue;
    let common = 0;
    for (const w of NA) if (NB.has(w)) common++;
    let shared = 0;
    for (const f of vf[a]) { const i = f * 3; if (F[i] === b || F[i + 1] === b || F[i + 2] === b) shared++; }
    if (common !== shared || shared === 0) continue;
    if (NA.size <= 3 || NB.size <= 3) continue; // would create a degenerate tetra
    if (!okMove(a, b, px, py, pz) || !okMove(b, a, px, py, pz)) continue;
    // collapse b → a
    for (const f of vf[b]) {
      const i = f * 3;
      if (F[i] === a || F[i + 1] === a || F[i + 2] === a) { faceAlive[f] = 0; nf--; continue; }
      for (let k = 0; k < 3; k++) if (F[i + k] === b) F[i + k] = a;
      vf[a].push(f);
    }
    vAlive[b] = 0; vf[b] = [];
    P[a * 3] = px; P[a * 3 + 1] = py; P[a * 3 + 2] = pz;
    for (let i = 0; i < 10; i++) Q[a * 10 + i] += Q[b * 10 + i];
    stamp[a]++;
    vf[a] = vf[a].filter((f) => faceAlive[f]);
    for (const w of nbrs(a, NA)) {
      vf[w] = vf[w].filter((f) => faceAlive[f]);
      push(a, w);
    }
  }
  }

  // ---- compact
  const remap = new Int32Array(nv).fill(-1);
  let cnt = 0;
  const outF = [];
  for (let f = 0; f < nf0; f++) {
    if (!faceAlive[f]) continue;
    for (let k = 0; k < 3; k++) { const v = F[f * 3 + k]; if (remap[v] < 0) remap[v] = cnt++; outF.push(remap[v]); }
  }
  const pos = new Float32Array(cnt * 3);
  for (let v = 0; v < nv; v++) if (remap[v] >= 0) { const o = remap[v] * 3; pos[o] = P[v * 3]; pos[o + 1] = P[v * 3 + 1]; pos[o + 2] = P[v * 3 + 2]; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setIndex(cnt > 65535 ? new THREE.Uint32BufferAttribute(outF, 1) : new THREE.Uint16BufferAttribute(outF, 1));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

/** per-vertex normals from an SDF gradient (central differences, step e) */
export function sdfNormals(geo, sdf, e) {
  const P = geo.attributes.position.array, N = new Float32Array(P.length);
  for (let v = 0; v < P.length; v += 3) {
    const x = P[v], y = P[v + 1], z = P[v + 2];
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    N[v] = gx / l; N[v + 1] = gy / l; N[v + 2] = gz / l;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return geo;
}
