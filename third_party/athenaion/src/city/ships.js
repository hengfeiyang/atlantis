// Ancient ships, built procedurally and merged: merchant holkades (round hulls, big square linen
// sail), triremes (long tarred hulls, outriggers, three banks of oars, bronze ram, painted eyes),
// small fishing boats, and the moored boat with the navy/gold sail at the tholos island (ref 2).
// Local frame: +z = bow, x = beam (port −x), y up, waterline at y = 0.
import * as THREE from 'three';
import { GeoBuilder } from './geobuilder.js';
import { WOOD_ATTRS, SAIL_ATTRS, WK } from './shipmats.js';

const PI = Math.PI;

function hullGeometry(spec, seed) {
  const { L, B, D, T, sheerBow, sheerStern, fullness = 0.55, kind = WK.HULL } = spec;
  const NT = 18, M = 12;
  const pos = [], aW = [];
  const sec = [];
  for (let i = 0; i <= NT; i++) {
    const t = i / NT;
    const z = -L / 2 + t * L;
    const sw = Math.pow(Math.sin(PI * Math.min(0.999, Math.max(0.001, t))), fullness);
    const w = (B / 2) * sw * (spec.box ? Math.min(1, sw * 1.6) : 1);
    const k = T * Math.pow(Math.sin(PI * Math.min(0.999, Math.max(0.02, t))), 0.25);
    const e = 2 * t - 1;
    const g = D - T + (e > 0 ? sheerBow : sheerStern) * Math.pow(Math.abs(e), 2.2);
    const row = [];
    for (let j = 0; j <= M; j++) {
      const phi = (PI * j) / M;
      const x = -w * Math.cos(phi);
      const y = g - (g + k) * Math.pow(Math.sin(phi), 0.75);
      pos.push(x, y, z);
      const lateral = Math.abs(phi - PI / 2) < 1e-6 ? 0 : 1;
      aW.push(z, y, seed, kind);
      row.push([x, y, z]);
      void lateral;
    }
    sec.push({ z, w, g, k, row });
  }
  const idx = [];
  for (let i = 0; i < NT; i++) for (let j = 0; j < M; j++) {
    const a = i * (M + 1) + j, b = (i + 1) * (M + 1) + j, c = b + 1, d = a + 1;
    idx.push(a, d, b, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(aW, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, sec };
}

/** sweep a square tube along a 3D polyline */
function sweep(b, pts, r0, r1, kind, seed) {
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const l = Math.hypot(...d) || 1;
    const dn = d.map((v) => v / l);
    let s = Math.abs(dn[1]) < 0.9 ? [dn[2], 0, -dn[0]] : [1, 0, 0];
    const sl = Math.hypot(...s); s = s.map((v) => v / sl);
    const u = [dn[1] * s[2] - dn[2] * s[1], dn[2] * s[0] - dn[0] * s[2], dn[0] * s[1] - dn[1] * s[0]];
    const ra = r0 + (r1 - r0) * (i / (n - 1)), rb = r0 + (r1 - r0) * ((i + 1) / (n - 1));
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let k = 0; k < 4; k++) {
      const c0 = corners[k], c1 = corners[(k + 1) % 4];
      const off = (c, r) => [s[0] * c[0] * r + u[0] * c[1] * r, s[1] * c[0] * r + u[1] * c[1] * r, s[2] * c[0] * r + u[2] * c[1] * r];
      const A = off(c0, ra), Bq = off(c1, ra), C = off(c1, rb), Dq = off(c0, rb);
      const P0 = [p[0] + A[0], p[1] + A[1], p[2] + A[2]], P1 = [p[0] + Bq[0], p[1] + Bq[1], p[2] + Bq[2]];
      const P2 = [q[0] + C[0], q[1] + C[1], q[2] + C[2]], P3 = [q[0] + Dq[0], q[1] + Dq[1], q[2] + Dq[2]];
      const w = (pp) => [pp[2], pp[1], seed, kind];
      // outward = (c0+c1)/2 direction
      const mid = off([(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2], 1);
      const nrm = faceN(P0, P1, P2);
      if (nrm[0] * mid[0] + nrm[1] * mid[1] + nrm[2] * mid[2] < 0) b.quad(P0, P3, P2, P1, null, { aW: [w(P0), w(P3), w(P2), w(P1)] });
      else b.quad(P0, P1, P2, P3, null, { aW: [w(P0), w(P1), w(P2), w(P3)] });
    }
  }
}
/** lathed standing person (8 sides, elliptical rings), cloth below the neck, skin (or bronze helmet) above */
const PERSON = [[0, 0.16, 0.13], [0.25, 0.15, 0.115], [0.5, 0.125, 0.09], [0.68, 0.14, 0.09], [0.78, 0.17, 0.095], [0.8, 0.06, 0.06], [0.84, 0.06, 0.065], [0.86, 0.085, 0.095], [0.96, 0.08, 0.085], [1.0, 0.03, 0.03]];
function person(b, px, py, pz, h, yaw, seed, helmet = false) {
  const f = h / 1.7, c = Math.cos(yaw), s = Math.sin(yaw), n = 8;
  const ring = ([fy, rx, rz]) => Array.from({ length: n }, (_, i) => {
    const t = (i / n) * PI * 2, x = Math.cos(t) * rx * 1.7 * f, z = Math.sin(t) * rz * 1.7 * f;
    return [px + x * c + z * s, py + fy * h, pz - x * s + z * c];
  });
  const R = PERSON.map(ring);
  for (let k = 0; k < R.length - 1; k++) {
    const kind = k < 5 ? WK.CLOTH : helmet && k >= 6 ? WK.BRONZE : WK.SKIN;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, A = R[k][i], B2 = R[k][j], C = R[k + 1][j], D = R[k + 1][i];
      const w = (p) => [p[0] + p[2], p[1], seed, kind];
      const nrm = faceN(A, B2, C), mx = (A[0] + B2[0]) / 2 - px, mz = (A[2] + B2[2]) / 2 - pz;
      if (nrm[0] * mx + nrm[2] * mz < 0) b.quad(A, D, C, B2, null, { aW: [w(A), w(D), w(C), w(B2)] });
      else b.quad(A, B2, C, D, null, { aW: [w(A), w(B2), w(C), w(D)] });
    }
  }
  // arms hanging from the shoulders (break the peg silhouette)
  for (const sx of [-1, 1]) {
    const W = (x, y, z) => [px + x * c + z * s, py + y, pz - x * s + z * c];
    sweep(b, [W(sx * 0.27 * f, 0.76 * h, 0), W(sx * 0.31 * f, 0.6 * h, 0.03 * f), W(sx * 0.29 * f, 0.44 * h, 0.06 * f)], 0.055 * f, 0.045 * f, WK.CLOTH, seed);
  }
}
function faceN(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
/** cylinder (spar) between two points */
function spar(b, p, q, r, kind, seed, sides = 6) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const l = Math.hypot(...d) || 1; const dn = d.map((v) => v / l);
  let s = Math.abs(dn[1]) < 0.9 ? [dn[2], 0, -dn[0]] : [1, 0, 0];
  const sl = Math.hypot(...s); s = s.map((v) => v / sl);
  const u = [dn[1] * s[2] - dn[2] * s[1], dn[2] * s[0] - dn[0] * s[2], dn[0] * s[1] - dn[1] * s[0]];
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * PI * 2, a1 = ((k + 1) / sides) * PI * 2;
    const o0 = [s[0] * Math.cos(a0) + u[0] * Math.sin(a0), s[1] * Math.cos(a0) + u[1] * Math.sin(a0), s[2] * Math.cos(a0) + u[2] * Math.sin(a0)];
    const o1 = [s[0] * Math.cos(a1) + u[0] * Math.sin(a1), s[1] * Math.cos(a1) + u[1] * Math.sin(a1), s[2] * Math.cos(a1) + u[2] * Math.sin(a1)];
    const P0 = [p[0] + o0[0] * r, p[1] + o0[1] * r, p[2] + o0[2] * r], P1 = [p[0] + o1[0] * r, p[1] + o1[1] * r, p[2] + o1[2] * r];
    const P2 = [q[0] + o1[0] * r, q[1] + o1[1] * r, q[2] + o1[2] * r], P3 = [q[0] + o0[0] * r, q[1] + o0[1] * r, q[2] + o0[2] * r];
    const w = (t) => [t * l, 0, seed, kind];
    const n = faceN(P0, P1, P2); const mid = [o0[0] + o1[0], o0[1] + o1[1], o0[2] + o1[2]];
    if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0) b.quad(P0, P3, P2, P1, null, { aW: [w(0), w(1), w(1), w(0)] });
    else b.quad(P0, P1, P2, P3, null, { aW: [w(0), w(0), w(1), w(1)] });
  }
}

/** billowed square sail below a yard. width W, height H, centred at (0, yTop, z0), belly toward +z */
function sail(sb, W, H, yTop, z0, belly, kind, seed, yaw = 0, nx = 8, ny = 7, folds = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (u, v) => {
    const x = -W / 2 + u * W;
    const y = yTop - v * H - (folds ? folds * 1.6 * Math.pow(v, 3) * (1 - Math.pow(2 * u - 1, 2)) : 0);
    // hanging cloth: vertical folds growing toward the foot, a slack curve at the foot
    const fold = folds ? folds * (0.35 + 0.65 * v) * Math.sin(u * PI * 2 * 4.5 + seed * 7.0) : 0;
    const bz = fold + belly * (1 - Math.pow(2 * u - 1, 2)) * (0.35 + 0.65 * Math.sin(PI * Math.min(1, v * 1.05 + 0.05)));
    return [x * c + (z0 + bz) * s, y, -x * s + (z0 + bz) * c];
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const u0 = i / nx, u1 = (i + 1) / nx, v0 = j / ny, v1 = (j + 1) / ny;
    const a = (u, v) => [u * W, v * H, seed, kind];
    sb.quad(P(u0, v1), P(u1, v1), P(u1, v0), P(u0, v0), null, { aSail: [a(u0, v1), a(u1, v1), a(u1, v0), a(u0, v0)], aSailSize: [[W, H], [W, H], [W, H], [W, H]] });
  }
}

// ------------------------------------------------------------------ ship types
/**
 * Build one ship into the wood/sail builders, transformed by `mat` (THREE.Matrix4).
 * o = { type: 'merchant'|'trireme'|'boat'|'tholos', seed, sailState: 'set'|'furled'|'none', sailKind, scale, oarsOut }
 */
export function buildShip(woodB, sailB, mat, o, rng) {
  const lw = new GeoBuilder(WOOD_ATTRS), ls = new GeoBuilder(SAIL_ATTRS);
  const seed = o.seed;
  let spec, mastH, yardW, sailH, mastZ = 0;
  if (o.type === 'trireme') {
    spec = { L: rng.range(33, 37), B: 4.0, D: 2.3, T: 1.0, sheerBow: 1.1, sheerStern: 2.2, fullness: 0.32, kind: WK.HULL };
    mastH = 10; yardW = 11; sailH = 6.5; mastZ = 1;
  } else if (o.type === 'boat') {
    spec = { L: rng.range(6.5, 9), B: rng.range(2.0, 2.5), D: 1.25, T: 0.45, sheerBow: 0.5, sheerStern: 0.4, fullness: 0.6, kind: rng.chance(0.5) ? WK.NATURAL : WK.HULL };
    mastH = 5.5; yardW = 4.4; sailH = 3.6; mastZ = 0.6;
  } else if (o.type === 'tholos') {
    spec = { L: 9.5, B: 2.7, D: 1.45, T: 0.5, sheerBow: 0.7, sheerStern: 0.9, fullness: 0.55, kind: WK.HULL };
    mastH = 10.5; yardW = 4.8; sailH = 7.4; mastZ = 0.4;
  } else {
    spec = { L: rng.range(15, 22), B: 0, D: 2.7, T: 1.4, sheerBow: 0.9, sheerStern: 1.4, fullness: 0.62, kind: rng.chance(0.65) ? WK.NATURAL : WK.HULL };
    spec.B = spec.L * rng.range(0.26, 0.32);
    mastH = spec.L * 0.62; yardW = spec.L * 0.62; sailH = mastH * 0.62; mastZ = spec.L * 0.04;
  }
  const { geo, sec } = hullGeometry(spec, seed);
  lw.addGeometry(geo, new THREE.Matrix4());
  const { L, B } = spec;
  // wale / painted band along the gunwale (both sides)
  for (const side of [-1, 1]) {
    for (let i = 1; i < sec.length - 2; i++) {
      const a = sec[i], b2 = sec[i + 1];
      const out = 0.04;
      const pa0 = [side * (a.w + out), a.g - 0.05, a.z], pb0 = [side * (b2.w + out), b2.g - 0.05, b2.z];
      const pa1 = [side * (a.w * 0.985 + out), a.g - 0.38, a.z], pb1 = [side * (b2.w * 0.985 + out), b2.g - 0.38, b2.z];
      const w = (p) => [p[2], p[1], seed, WK.PAINT];
      const n = faceN(pa1, pb1, pb0);
      if (n[0] * side < 0) lw.quad(pa1, pa0, pb0, pb1, null, { aW: [w(pa1), w(pa0), w(pb0), w(pb1)] });
      else lw.quad(pa1, pb1, pb0, pa0, null, { aW: [w(pa1), w(pb1), w(pb0), w(pa0)] });
    }
  }
  // deck
  for (let i = 1; i < sec.length - 2; i++) {
    const a = sec[i], b2 = sec[i + 1];
    const ya = a.g - 0.4, yb = b2.g - 0.4;
    const wa = a.w * 0.93, wb = b2.w * 0.93;
    const w = (x, z) => [x + 20, z, seed, WK.DECK];
    lw.quad([wa, ya, a.z], [-wa, ya, a.z], [-wb, yb, b2.z], [wb, yb, b2.z], null, { aW: [w(wa, a.z), w(-wa, a.z), w(-wb, b2.z), w(wb, b2.z)] });
  }
  const sb = sec[0], bow = sec[sec.length - 1];
  // stem & stern posts
  if (o.type === 'trireme') {
    // bronze ram at the waterline
    sweep(lw, [[0, 0.1, L / 2 - 0.5], [0, 0.0, L / 2 + 1.6], [0, 0.05, L / 2 + 2.3]], 0.32, 0.12, WK.BRONZE, seed);
    sweep(lw, [[0, bow.g - 0.6, L / 2 - 0.2], [0, bow.g + 0.4, L / 2 + 0.4], [0, bow.g + 1.0, L / 2 + 0.2]], 0.16, 0.1, WK.HULL, seed);
    // aphlaston: tall curving stern fan
    sweep(lw, [[0, sb.g - 0.6, -L / 2 + 0.4], [0, sb.g + 0.8, -L / 2 - 0.5], [0, sb.g + 2.2, -L / 2 - 0.4], [0, sb.g + 3.2, -L / 2 + 0.5], [0, sb.g + 3.5, -L / 2 + 1.2]], 0.2, 0.07, WK.HULL, seed);
    // outriggers (parexeiresia) along both sides
    for (const side of [-1, 1]) {
      for (let i = 3; i < sec.length - 4; i++) {
        const a = sec[i], b2 = sec[i + 1];
        const xo = side * (a.w + 0.55), xb = side * (b2.w + 0.55);
        const p0 = [side * a.w, a.g - 0.05, a.z], p1 = [xo, a.g - 0.05, a.z], p2 = [xb, b2.g - 0.05, b2.z], p3 = [side * b2.w, b2.g - 0.05, b2.z];
        const w = (p) => [p[2], p[1], seed, WK.HULL];
        if (side > 0) lw.quad(p0, p1, p2, p3, null, { aW: [w(p0), w(p1), w(p2), w(p3)] }); else lw.quad(p0, p3, p2, p1, null, { aW: [w(p0), w(p3), w(p2), w(p1)] });
        // outer face (painted)
        const q0 = [xo, a.g - 0.05, a.z], q1 = [xb, b2.g - 0.05, b2.z], q2 = [xb, b2.g - 0.6, b2.z], q3 = [xo, a.g - 0.6, a.z];
        const wp = (p) => [p[2], p[1], seed, WK.PAINT];
        if (side > 0) lw.quad(q3, q2, q1, q0, null, { aW: [wp(q3), wp(q2), wp(q1), wp(q0)] }); else lw.quad(q3, q0, q1, q2, null, { aW: [wp(q3), wp(q0), wp(q1), wp(q2)] });
      }
      // painted eye near the bow
      const e = sec[sec.length - 3];
      const ex = side * (e.w + 0.03), ez = e.z + 0.4, ey = 0.55;
      const pE = [[ex, ey - 0.25, ez - 0.45], [ex, ey - 0.25, ez + 0.45], [ex, ey + 0.25, ez + 0.45], [ex, ey + 0.25, ez - 0.45]];
      const we = (u, v) => [u, v, seed, WK.EYE];
      if (side > 0) lw.quad(pE[0], pE[3], pE[2], pE[1], null, { aW: [we(-0.45, -0.25), we(-0.45, 0.25), we(0.45, 0.25), we(0.45, -0.25)] });
      else lw.quad(pE[0], pE[1], pE[2], pE[3], null, { aW: [we(-0.45, -0.25), we(0.45, -0.25), we(0.45, 0.25), we(-0.45, 0.25)] });
      // oars: three banks
      const banks = [[0.35, 4.4, 0.6], [0.85, 5.0, 0.35], [1.35, 5.6, 0.55]];
      for (const [h, len, ox] of banks) {
        const n = o.oarCount ?? 22;
        for (let k = 0; k < n; k++) {
          const z = -L * 0.33 + (k / (n - 1)) * L * 0.62;
          const p = [side * (B / 2 + ox), h + 0.2, z];
          let q;
          if (o.oarsOut) q = [side * (B / 2 + ox + len * 0.82), h - len * 0.5 + 0.2, z + rng.range(-0.3, 0.3)];
          else q = [side * (B / 2 + ox + 0.4), h + len * 0.85, z - len * 0.4];
          spar(lw, p, q, 0.05, WK.OAR, seed, 4);
        }
      }
    }
  } else {
    // merchant / boats: rising stem, swan-neck stern
    const stemTop = bow.g + (o.type === 'tholos' ? 1.3 : 0.6);
    sweep(lw, [[0, -spec.T * 0.8, L / 2 - 0.2], [0, bow.g * 0.5, L / 2 + 0.25], [0, bow.g + 0.3, L / 2 + 0.35], [0, stemTop, L / 2 + 0.15]], 0.13, 0.09, spec.kind, seed);
    if (o.type === 'tholos') sweep(lw, [[0, stemTop - 0.1, L / 2 + 0.15], [0, stemTop + 0.5, L / 2 + 0.45], [0, stemTop + 0.8, L / 2 + 0.25]], 0.12, 0.07, WK.BRONZE, seed);
    const neck = o.type === 'merchant' ? 1.8 : o.type === 'tholos' ? 2.1 : 0.9;
    sweep(lw, [[0, sb.g - 0.3, -L / 2 + 0.3], [0, sb.g + neck * 0.5, -L / 2 - 0.35], [0, sb.g + neck, -L / 2 - 0.1], [0, sb.g + neck * 1.15, -L / 2 + 0.45], [0, sb.g + neck * 0.95, -L / 2 + 0.75]], 0.16, 0.08, spec.kind, seed);
    // deck house / cargo for merchants
    if (o.type === 'merchant') {
      const hz = -L * 0.3;
      const y0 = sec[4].g - 0.4;
      boxW(lw, 0, y0, hz, B * 0.22, 0.9, 1.4, WK.DECK, seed);
      for (let k = 0; k < 6; k++) boxW(lw, rng.range(-B * 0.25, B * 0.25), y0, rng.range(-L * 0.05, L * 0.2), 0.3, 0.55, 0.3, WK.NATURAL, seed); // amphorae/bales
    }
  }
  // crew / passengers: draped figures on deck
  const nCrew = o.crew ?? (o.type === 'tholos' ? 7 : o.type === 'merchant' ? rng.int(1, 3) : o.type === 'boat' ? rng.int(0, 2) : 0);
  for (let k = 0; k < nCrew; k++) {
    const i = Math.min(sec.length - 3, 3 + Math.floor(rng.random() * (sec.length - 6)));
    const sc = sec[i];
    const px = rng.range(-0.5, 0.5) * sc.w, pz = sc.z + rng.range(-0.3, 0.3), py = sc.g - 0.4;
    const seated = rng.chance(0.3);
    const hgt = rng.range(1.6, 1.8) * (seated ? 0.62 : 1);
    const ps = (seed + k * 0.173) % 1;
    const f = hgt / 1.7;
    // r5: lathed human figure (robe flaring to the hem, shoulders, neck, head) in dyed wool + skin
    const guard = o.type === 'tholos' && k % 2 === 0;
    person(lw, px, py, pz, hgt, rng.range(0, PI * 2), ps, guard);
    // tholos guard: a spear with a bronze tip
    if (guard) spar(lw, [px + 0.22 * f, py, pz], [px + 0.26 * f, py + hgt * 1.35, pz], 0.022, WK.SPAR, seed, 4);
  }
  // steering oars at the stern quarters
  for (const side of [-1, 1]) {
    const s4 = sec[2];
    spar(lw, [side * (s4.w + 0.1), s4.g + 0.6, s4.z + 0.3], [side * (s4.w + 0.5), -spec.T * 0.9, s4.z - L * 0.1], 0.08, WK.SPAR, seed, 5);
  }
  // mast, yard, sail
  if (o.sailState !== 'none') {
    const mz = mastZ;
    const mid = sec[Math.round(sec.length / 2)];
    const y0 = mid.g - 0.6;
    spar(lw, [0, y0, mz], [0, y0 + mastH, mz], 0.14 * (mastH / 10) + 0.05, WK.SPAR, seed, 6);
    const yaw = o.yardYaw ?? 0;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const yy = y0 + mastH - 0.5;
    const hw = yardW / 2;
    spar(lw, [-hw * cy + mz * sy, yy, hw * sy + mz * cy], [hw * cy + mz * sy, yy, -hw * sy + mz * cy], 0.09, WK.SPAR, seed, 5);
    if (o.sailState === 'set') {
      sail(ls, yardW * 0.94, sailH, yy - 0.1, mz + 0.15, sailH * (o.belly ?? 0.16), o.sailKind ?? 0, seed, yaw);
    } else if (o.sailState === 'loose') {
      // half-brailed, hanging loosely (tholos boat in ref 2)
      sail(ls, yardW * 0.86, sailH * 0.92, yy - 0.1, mz + 0.12, 0.25, o.sailKind ?? 0, seed, yaw, 18, 10, o.type === 'tholos' ? 0.16 : 0.1);
    } else {
      // furled under the yard
      spar(lw, [-hw * 0.9 * cy + mz * sy, yy - 0.28, hw * 0.9 * sy + mz * cy], [hw * 0.9 * cy + mz * sy, yy - 0.28, -hw * 0.9 * sy + mz * cy], 0.22, WK.CANVAS, seed, 6);
    }
    // stays
    const top = [0, y0 + mastH, mz];
    spar(lw, top, [0, bow.g + 0.3, L / 2 - 0.3], 0.025, WK.ROPE, seed, 3);
    spar(lw, top, [0, sb.g + 0.3, -L / 2 + 0.8], 0.025, WK.ROPE, seed, 3);
    for (const side of [-1, 1]) spar(lw, top, [side * mid.w * 0.95, mid.g, mz - 0.4], 0.02, WK.ROPE, seed, 3);
  }
  const s = o.scale ?? 1;
  const m = mat.clone().multiply(new THREE.Matrix4().makeScale(s, s, s));
  if (!lw.empty) woodB.addGeometry(lw.toGeometry(), m);
  if (!ls.empty) sailB.addGeometry(ls.toGeometry(), m);
  return { L: L * s, B: B * s };
}

/** small axis-aligned box into a wood builder */
function boxW(b, cx, y0, cz, hw, h, hd, kind, seed) {
  const P = (x, y, z) => [cx + x, y0 + y, cz + z];
  const w = (p) => [p[2], p[1], seed, kind];
  const f = [
    [P(-hw, 0, hd), P(hw, 0, hd), P(hw, h, hd), P(-hw, h, hd)],
    [P(hw, 0, hd), P(hw, 0, -hd), P(hw, h, -hd), P(hw, h, hd)],
    [P(hw, 0, -hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(hw, h, -hd)],
    [P(-hw, 0, -hd), P(-hw, 0, hd), P(-hw, h, hd), P(-hw, h, -hd)],
    [P(-hw, h, hd), P(hw, h, hd), P(hw, h, -hd), P(-hw, h, -hd)],
  ];
  for (const q of f) b.quad(q[0], q[1], q[2], q[3], null, { aW: q.map(w) });
}

/** matrix from position + heading (rad, THREE rotY convention) + optional heel/pitch */
export function shipMatrix(x, y, z, rotY, heel = 0, pitch = 0) {
  const m = new THREE.Matrix4().makeRotationY(rotY);
  m.multiply(new THREE.Matrix4().makeRotationZ(heel));
  m.multiply(new THREE.Matrix4().makeRotationX(pitch));
  m.setPosition(x, y, z);
  return m;
}

/** a standing amphora (lathe of 8 sides) into the wood builder (terracotta coloured via NATURAL / CANVAS kinds) */
export function amphora(B, x, y, z, s, seed) {
  const prof = [[0.02, 0], [0.09, 0.1], [0.2, 0.32], [0.24, 0.5], [0.22, 0.66], [0.1, 0.82], [0.065, 0.92], [0.085, 0.98], [0.06, 1.0]];
  const n = 8;
  const kind = seed < 0.6 ? WK.CLAY : WK.NATURAL;
  for (let j = 0; j < prof.length - 1; j++) {
    const [r0, h0] = prof[j], [r1, h1] = prof[j + 1];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * PI * 2, a1 = ((i + 1) / n) * PI * 2;
      const P = (r, h, a) => [x + Math.cos(a) * r * s, y + h * s, z + Math.sin(a) * r * s];
      const p00 = P(r0, h0, a0), p10 = P(r0, h0, a1), p11 = P(r1, h1, a1), p01 = P(r1, h1, a0);
      const w = (p) => [p[0] + p[2], p[1], seed, kind];
      const am = (a0 + a1) / 2;
      const nn = faceN(p00, p10, p11);
      if (nn[0] * Math.cos(am) + nn[2] * Math.sin(am) < 0) B.wood.quad(p00, p01, p11, p10, null, { aW: [w(p00), w(p01), w(p11), w(p10)] });
      else B.wood.quad(p00, p10, p11, p01, null, { aW: [w(p00), w(p10), w(p11), w(p01)] });
    }
  }
}

/** sagging mooring rope between two world points into the wood builder */
export function rope(B, p, q, sag = 0.4, seed = 0) {
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t - sag * 4 * t * (1 - t), p[2] + (q[2] - p[2]) * t]);
  }
  for (let i = 0; i < pts.length - 1; i++) spar(B.wood, pts[i], pts[i + 1], 0.03, WK.ROPE, seed, 4);
}
