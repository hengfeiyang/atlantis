// Corinthian capital with sculpted acanthus: two rows of eight lobed, serrated, curled leaves,
// fluted caulicoli with calyx leaves, helices and corner volutes (ribbon spirals), concave abacus
// with fleurons.  Also exports the generic acanthus `leaf()` (used by acroteria / palmettes).
import * as THREE from 'three';
import { lathe, surface, extrudeOutline, ellipsoid, tube, lerp, clamp, smooth } from './geom.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/**
 * Generic acanthus leaf.
 * o: { O: Vector3 base point, U: spine start direction, N: front normal (⊥U),
 *      length, width, lean (rad, tilt toward N at the base), curl (rad total), curlStart (0..1),
 *      lobes [{t, d}] notches, serr (teeth per leaf), cup (m), rib (m), hug (m), thick (m),
 *      nu, nv, back (bool), aux }
 */
export function leaf(mb, o) {
  const U = o.U.clone().normalize(), N = o.N.clone().normalize();
  const S = new THREE.Vector3().crossVectors(U, N).normalize();
  const L = o.length, W = o.width;
  const nv = o.nv ?? 40, nu = o.nu ?? 8;
  const curl = o.curl ?? 2.2, cs = o.curlStart ?? 0.7, lean = o.lean ?? 0.1;
  const lobes = o.lobes ?? [{ t: 0.3, d: 0.34 }, { t: 0.54, d: 0.3 }, { t: 0.76, d: 0.26 }];
  const serr = o.serr ?? 20, serrAmp = o.serrAmp ?? 0.12;
  const thick = o.thick ?? L * 0.025;
  const cup = o.cup ?? W * 0.12, rib = o.rib ?? W * 0.035, hug = o.hug ?? 0;
  // spine integration in the (U, N) plane
  const NS = 96;
  const sp = [[0, 0, lean]]; // [along U, along N, gamma]
  for (let i = 1; i <= NS; i++) {
    const t = i / NS;
    const g = lean + (t > cs ? curl * Math.pow((t - cs) / (1 - cs), 1.6) : 0) + (o.bend ?? 0) * t;
    const [a, b] = sp[i - 1];
    const dt = L / NS;
    sp.push([a + Math.cos(g) * dt, b + Math.sin(g) * dt, g]);
  }
  const spine = (t) => {
    const f = clamp(t, 0, 1) * NS, i = Math.min(NS - 1, Math.floor(f)), k = f - i;
    return [lerp(sp[i][0], sp[i + 1][0], k), lerp(sp[i][1], sp[i + 1][1], k), lerp(sp[i][2], sp[i + 1][2], k)];
  };
  const widthAt = (t) => {
    let w = W * (0.62 + 0.42 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1))) * (1 - smooth(0.8, 1.0, t) * 0.96);
    w *= 1 - smooth(0.0, 0.06, 0.06 - t) * 0.3; // narrower stem at the very base
    let notch = 0;
    for (const lb of lobes) notch = Math.max(notch, lb.d * Math.exp(-(((t - lb.t) / 0.028) ** 2)));
    w *= 1 - notch;
    const fr = (t * serr) % 1;
    w *= 1 - serrAmp * Math.pow(fr, 1.4) * (0.4 + 0.6 * smooth(0.1, 0.3, t));
    return Math.max(w, W * 0.012);
  };
  const tipFold = (t) => smooth(0.85, 1.0, t);
  const pt = (u, t, off, out) => {
    const [a, b, g] = spine(t);
    const w = widthAt(t) * 0.5;
    const nx = -Math.sin(g), ny = Math.cos(g); // normal in (U, N) coords: rotate direction (cos g, sin g) by +90°
    // cross-section relief
    const uu = u * u;
    let h = cup * uu * (0.4 + 0.6 * smooth(0.2, 0.7, t)) + rib * Math.max(0, 1 - Math.abs(u) / 0.14) - hug * uu * (1 - smooth(0.4, 0.85, t));
    h += W * 0.03 * Math.cos(u * Math.PI * 5.5) * uu * smooth(0.12, 0.45, t); // finger ribs
    h -= W * 0.025 * Math.exp(-(((Math.abs(u) - 0.2) / 0.07) ** 2)) * smooth(0.05, 0.3, t); // grooves beside the midrib
    // lobe edges bend forward (each lobe reads as a separate raised form)
    let lobeK = 0;
    for (let i = 0; i <= lobes.length; i++) { const a0 = i === 0 ? 0.05 : lobes[i - 1].t, a1 = i < lobes.length ? lobes[i].t : 0.97; if (t > a0 && t < a1) lobeK = Math.sin(Math.PI * (t - a0) / (a1 - a0)); }
    h += W * (o.lobeLift ?? 0.07) * lobeK * smooth(0.45, 1.0, Math.abs(u));
    h += off;
    const side = u * w * (1 - 0.35 * tipFold(t));
    const pa = a + nx * h, pb = b + ny * h;
    out[0] = o.O.x + U.x * pa + N.x * pb + S.x * side;
    out[1] = o.O.y + U.y * pa + N.y * pb + S.y * side;
    out[2] = o.O.z + U.z * pa + N.z * pb + S.z * side;
  };
  const aux = (u, t) => {
    const uu = Math.abs(u);
    let notchC = 0;
    for (const lb of lobes) notchC = Math.max(notchC, Math.exp(-(((t - lb.t) / 0.04) ** 2)));
    return [0.12 + 0.35 * notchC * uu + 0.25 * (1 - t) * 0.5, uu > 0.92 ? 0.5 : 0, 0.3, 0];
  };
  // front (normal ≈ N): u along S, v along spine → ∂u × ∂v = S × U = N
  surface(mb, (u, v, out) => pt(u * 2 - 1, v, 0, out), nu, nv, { aux: (u, v) => aux(u * 2 - 1, v) });
  if (o.back !== false) {
    surface(mb, (u, v, out) => pt(u * 2 - 1, v, -thick, out), Math.max(2, Math.round(nu / 2)), Math.max(6, Math.round(nv / 2)), { flip: true, aux: () => [0.5, 0, 0.1, 0] });
    if (o.rims !== false) for (const s of [-1, 1]) {
      const pA = [0, 0, 0], pB = [0, 0, 0];
      surface(mb, (u, v, out) => { pt(s, v, 0, pA); pt(s, v, -thick, pB); out[0] = lerp(pA[0], pB[0], u); out[1] = lerp(pA[1], pB[1], u); out[2] = lerp(pA[2], pB[2], u); },
        1, nv, { flip: s < 0, aux: () => [0.2, 0.7, 0.1, 0] });
    }
  }
}

/** ribbon spiral (volutes / helices): pts [Vector3], B = ribbon breadth direction per point, a = half thickness, b = half breadth */
function ribbon(mb, pts, Bs, a, b, nR = 8, auxF = null) {
  const n = pts.length;
  const base = mb.count;
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)];
    const T = p1.clone().sub(p0).normalize();
    const B = Bs[i].clone().sub(T.clone().multiplyScalar(Bs[i].dot(T))).normalize();
    const Nn = new THREE.Vector3().crossVectors(B, T).normalize();
    const ai = typeof a === 'function' ? a(i / (n - 1)) : a, bi = typeof b === 'function' ? b(i / (n - 1)) : b;
    for (let j = 0; j <= nR; j++) {
      const ph = (j / nR) * Math.PI * 2;
      const c = Math.cos(ph), s = Math.sin(ph);
      // superellipse-ish section (flat front channel)
      const ce = Math.sign(c) * Math.pow(Math.abs(c), 0.55), se = Math.sign(s) * Math.pow(Math.abs(s), 0.55);
      const off = Nn.clone().multiplyScalar(ce * ai).add(B.clone().multiplyScalar(se * bi));
      const nrm = Nn.clone().multiplyScalar(c / ai).add(B.clone().multiplyScalar(s / bi)).normalize();
      const p = pts[i];
      mb.v(p.x + off.x, p.y + off.y, p.z + off.z, nrm.x, nrm.y, nrm.z, auxF ? auxF(i / (n - 1), j / nR) : [0.15, 0.2, 0.2, 0]);
    }
  }
  const W = nR + 1;
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < nR; j++) {
    const q0 = base + i * W + j, q1 = q0 + 1, q2 = q0 + W + 1, q3 = q0 + W;
    mb.q(q0, q1, q2, q3);
  }
  // check orientation once: compare first quad normal with vertex normal; flip if needed
  const P = mb.P.a, I = mb.I.a, Nn = mb.N.a;
  const t0 = mb.I.n - (n - 1) * nR * 6;
  const ia = I[t0], ib = I[t0 + 1], ic = I[t0 + 2];
  const ux = P[ib * 3] - P[ia * 3], uy = P[ib * 3 + 1] - P[ia * 3 + 1], uz = P[ib * 3 + 2] - P[ia * 3 + 2];
  const wx = P[ic * 3] - P[ia * 3], wy = P[ic * 3 + 1] - P[ia * 3 + 1], wz = P[ic * 3 + 2] - P[ia * 3 + 2];
  const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
  if (cx * Nn[ia * 3] + cy * Nn[ia * 3 + 1] + cz * Nn[ia * 3 + 2] < 0) {
    for (let k = t0; k < mb.I.n; k += 3) { const tmp = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = tmp; }
  }
}

/** concave-sided square outline (abacus). halfDiag = distance centre→corner, sag = side concavity (m), cut = corner chamfer */
export function concaveSquare(halfDiag, sag, cut, nSide = 10) {
  const c = halfDiag / Math.SQRT2; // corner coordinate
  const pts = [];
  const corners = [[c, c], [-c, c], [-c, -c], [c, -c]];
  for (let k = 0; k < 4; k++) {
    const A = corners[k], B = corners[(k + 1) % 4];
    // cut corners: start a bit after A, end a bit before B
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const nx = uy, ny = -ux; // outward normal (CCW polygon → right side outward)
    for (let i = 0; i <= nSide; i++) {
      const t = lerp(cut / len, 1 - cut / len, i / nSide);
      const s = Math.sin(Math.PI * t) * sag;
      pts.push([A[0] + dx * t - nx * s, A[1] + dy * t - ny * s]);
    }
  }
  return pts;
}

/**
 * Solid carved scroll (volute end) centred at the origin in the XY plane, facing +Z:
 * spiral-relief front, cylindrical rim, flat back at z = −depth. dir = winding direction (±1).
 */
export function scroll(mb, R, depth, dir = 1, detail = 1, turns = 2.2) {
  const nr = detail >= 0.75 ? 12 : detail >= 0.4 ? 8 : 5, na = detail >= 0.75 ? 48 : detail >= 0.4 ? 32 : 18;
  const re = R * 0.2, relief = R * 0.16;
  const h = (r, a) => {
    const s = ((R - r) / (R - re)) * turns - a / (Math.PI * 2);
    const fr = s - Math.floor(s);
    if (r < re) return relief * (0.7 + 0.5 * Math.sqrt(Math.max(0, 1 - (r / re) ** 2)));
    if (s < 0) return relief * 0.8;
    const ridge = Math.max(0, 1 - fr / 0.16) + Math.max(0, 1 - (1 - fr) / 0.07);
    const chan = Math.sin(Math.PI * clamp((fr - 0.14) / 0.8, 0, 1));
    return relief * (0.8 * Math.min(1, ridge) - 0.5 * chan) + relief * 0.35;
  };
  // front relief (polar): u = angle (from top, winding dir), v = radius rim → centre
  surface(mb, (u, v, out) => {
    const a = u * Math.PI * 2, r = lerp(R, 0.0001, v);
    out[0] = dir * r * Math.sin(a); out[1] = r * Math.cos(a); out[2] = h(r, a);
  }, na, nr, { closedU: true, flip: dir > 0, aux: (u, v) => { const r = lerp(R, 0.0001, v), a = u * Math.PI * 2; const s = ((R - r) / (R - re)) * turns - a / (Math.PI * 2); const fr = s - Math.floor(s); return [r < re || s < 0 ? 0.1 : 0.6 * Math.sin(Math.PI * clamp((fr - 0.14) / 0.8, 0, 1)), 0.2, 0.3, 0]; } });
  // rim band
  surface(mb, (u, v, out) => {
    const a = u * Math.PI * 2;
    out[0] = dir * R * Math.sin(a); out[1] = R * Math.cos(a); out[2] = lerp(-depth, h(R, a), v);
  }, Math.round(na / 2), 1, { closedU: true, flip: dir < 0, aux: [0.15, 0.4, 0.3, 0] });
  // back
  surface(mb, (u, v, out) => {
    const a = u * Math.PI * 2, r = lerp(R, 0.0001, v);
    out[0] = dir * r * Math.sin(a); out[1] = r * Math.cos(a); out[2] = -depth;
  }, Math.round(na / 2), 2, { closedU: true, flip: dir < 0, aux: [0.4, 0, 0, 0] });
}

/** quadratic Bezier tube between a and b with control c (Vector3s), radius r0 → r1 */
function stalk(mb, a, c, b, r0, r1, nT = 12, nR = 7) {
  tube(mb, (t, o) => {
    const u = 1 - t;
    o[0] = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
    o[1] = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
    o[2] = u * u * a.z + 2 * u * t * c.z + t * t * b.z;
  }, (t) => lerp(r0, r1, t), nT, nR, { aux: (t, j) => [0.15 + 0.25 * Math.pow(Math.abs(Math.sin(j * Math.PI * 4)), 4), 0.2, 0.3, 0] });
}

/** Corinthian capital on a shaft of lower diameter D, top radius r1, starting at y0. Returns height. */
export function corinthianCapital(mb, D, r1, y0, o = {}) {
  const detail = o.detail ?? 1;
  const hi = detail >= 0.75, mid = detail >= 0.4;
  const nv = hi ? 40 : mid ? 20 : 10, nu = hi ? 7 : mid ? 4 : 3;
  const segs = hi ? 48 : mid ? 32 : 20;
  const Hc = 1.17 * D, abH = 0.17 * D, bellTop = y0 + Hc - abH;
  // astragal + slim bell (kalathos) with lip — mostly hidden by the leaves
  const pr = [];
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI; pr.push([r1 * 1.02 + 0.028 * D * Math.cos(a), y0 + 0.028 * D + 0.028 * D * Math.sin(a), i === 0 || i === 6 ? 0.5 : 0, 0]); }
  const rb0 = r1 * 0.96, rb1 = 0.46 * D;
  pr.push([rb0, y0 + 0.06 * D, 0.6, 0, true]);
  for (let i = 1; i <= 6; i++) { const t = i / 6; pr.push([lerp(rb0, rb1, Math.pow(t, 1.8)), lerp(y0 + 0.06 * D, bellTop - 0.04 * D, t), 0.55, 0]); }
  pr.push([0.52 * D, bellTop - 0.015 * D, 0.2, 0.4, true]);
  pr.push([0.52 * D, bellTop, 0.1, 0.4, true]);
  pr.push([0.3 * D, bellTop, 0, 0]);
  lathe(mb, pr, segs, { streak: 0.2 });
  const bellR = (y) => lerp(rb0, rb1, Math.pow(clamp((y - y0 - 0.06 * D) / (bellTop - y0 - 0.1 * D), 0, 1), 1.8));
  const Y = V3(0, 1, 0);
  const leafCommon = { nu, nv, back: mid, rims: hi, serrAmp: hi ? 0.13 : mid ? 0.08 : 0 };
  // ---- upper row: on axes and diagonals (behind), tall
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const r = V3(Math.sin(a), 0, Math.cos(a));
    const yb = y0 + 0.05 * D, rr = bellR(yb) + 0.012 * D;
    leaf(mb, { ...leafCommon, O: V3(r.x * rr, yb, r.z * rr), U: Y, N: r, length: 0.70 * D, width: 0.46 * D, lean: 0.17, curl: 3.0, curlStart: 0.74, cup: 0.065 * D, rib: 0.02 * D, hug: 0.05 * D, thick: 0.024 * D, bend: 0.0 });
  }
  // ---- lower row: between, short and boldly overhanging
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) * Math.PI) / 4;
    const r = V3(Math.sin(a), 0, Math.cos(a));
    const yb = y0 + 0.04 * D, rr = bellR(yb) + 0.045 * D;
    leaf(mb, { ...leafCommon, O: V3(r.x * rr, yb, r.z * rr), U: Y, N: r, length: 0.45 * D, width: 0.48 * D, lean: 0.3, curl: 3.1, curlStart: 0.68, cup: 0.075 * D, rib: 0.022 * D, hug: 0.04 * D, thick: 0.026 * D,
      lobes: [{ t: 0.32, d: 0.33 }, { t: 0.56, d: 0.3 }, { t: 0.76, d: 0.24 }] });
  }
  // ---- per face: caulicoli + calyx, corner volute scrolls, helices, fleuron
  const yCal = y0 + 0.64 * D;
  const sR = 0.11 * D, hR = 0.06 * D;
  const scrollDetail = hi ? 1 : mid ? 0.5 : 0.2;
  for (let f = 0; f < 4; f++) {
    const ang = (f * Math.PI) / 2;
    const X = V3(Math.cos(ang), 0, -Math.sin(ang)); // face right
    const Z = V3(Math.sin(ang), 0, Math.cos(ang));  // face normal
    const P = (x, y, z) => V3(X.x * x + Z.x * z, y, X.z * x + Z.z * z);
    for (const side of [-1, 1]) {
      // caulicolus: fluted stalk rising between the upper leaves
      const cx = side * 0.2 * D, cz = 0.54 * D;
      const c0 = P(cx * 0.95, yCal - 0.2 * D, cz - 0.05 * D), c1 = P(cx, yCal - 0.01 * D, cz);
      const nFl = 8;
      surface(mb, (u, v, out) => {
        const a = u * Math.PI * 2;
        const rr = 0.046 * D * (1 - 0.12 * Math.pow(Math.abs(Math.cos(a * nFl * 0.5)), 0.5)) * (1 + 0.12 * v);
        const ctr = c0.clone().lerp(c1, v);
        const ux = Math.cos(a) * rr, uz = Math.sin(a) * rr;
        out[0] = ctr.x + X.x * ux + Z.x * uz; out[1] = ctr.y; out[2] = ctr.z + X.z * ux + Z.z * uz;
      }, mid ? 16 : 8, 2, { closedU: true, flip: true, aux: () => [0.3, 0, 0.2, 0] });
      const ringC = c1.clone();
      surface(mb, (u, v, out) => {
        const a = u * Math.PI * 2, b = v * Math.PI * 2;
        const R = 0.055 * D, rr = 0.016 * D;
        const ux = Math.cos(a) * (R + rr * Math.cos(b)), uz = Math.sin(a) * (R + rr * Math.cos(b));
        out[0] = ringC.x + X.x * ux + Z.x * uz; out[1] = ringC.y + rr * Math.sin(b); out[2] = ringC.z + X.z * ux + Z.z * uz;
      }, mid ? 12 : 6, mid ? 6 : 3, { closedU: true, flip: true });
      // calyx leaves cupping the springing of volute and helix
      if (mid || detail > 0.2) for (const dir of [-1, 1]) {
        const out = X.clone().multiplyScalar(side * dir).add(Z.clone().multiplyScalar(0.45)).normalize();
        const U = Y.clone().multiplyScalar(0.85).add(X.clone().multiplyScalar(side * dir * 0.55)).normalize();
        const Nn = out.clone().sub(U.clone().multiplyScalar(out.dot(U))).normalize();
        leaf(mb, { ...leafCommon, nu: Math.max(3, nu - 3), nv: Math.max(8, Math.round(nv * 0.45)), O: c1.clone().add(V3(0, 0.01 * D, 0)), U, N: Nn, length: 0.22 * D, width: 0.16 * D, lean: 0.25, curl: 2.0, curlStart: 0.55, cup: 0.025 * D, rib: 0.01 * D, thick: 0.015 * D, back: false, lobes: [{ t: 0.45, d: 0.3 }, { t: 0.72, d: 0.25 }], serr: 10 });
      }
      // corner volute: stalk + carved scroll under the abacus corner
      const sc = P(side * 0.6 * D, y0 + 0.83 * D, 0.62 * D);
      const top = P(side * 0.6 * D, y0 + 0.83 * D + sR * 0.9, 0.6 * D);
      stalk(mb, c1.clone().add(V3(0, 0.02 * D, 0)), P(side * 0.34 * D, y0 + 0.99 * D, 0.57 * D), top, 0.042 * D, 0.034 * D, mid ? 12 : 6, mid ? 7 : 5);
      mb.push(); mb.translate(sc.x, sc.y, sc.z); mb.rotateY(ang + side * 0.6); scroll(mb, sR, 0.09 * D, side, scrollDetail); mb.pop();
      // helix: smaller stalk + scroll toward the centre
      const hc = P(side * 0.12 * D, y0 + 0.86 * D, 0.56 * D);
      const htop = P(side * 0.12 * D, y0 + 0.86 * D + hR * 0.9, 0.55 * D);
      stalk(mb, c1.clone().add(V3(0, 0.02 * D, 0)), P(side * 0.25 * D, y0 + 0.96 * D, 0.555 * D), htop, 0.03 * D, 0.024 * D, mid ? 10 : 5, mid ? 6 : 4);
      mb.push(); mb.translate(hc.x, hc.y, hc.z); mb.rotateY(ang); scroll(mb, hR, 0.05 * D, -side, scrollDetail * 0.7); mb.pop();
    }
    // fleuron stem + flower on the abacus face
    const fz = 0.66 * D, fy = bellTop + abH * 0.5;
    stalk(mb, P(0, y0 + 0.8 * D, 0.5 * D), P(0, y0 + 0.92 * D, 0.56 * D), P(0, fy - 0.04 * D, fz - 0.04 * D), 0.018 * D, 0.014 * D, 6, 5);
    const fc = P(0, fy, fz);
    const nPet = 6;
    for (let p = 0; p < nPet; p++) {
      const a = (p / nPet) * Math.PI * 2 + 0.3;
      mb.push();
      mb.translate(fc.x, fc.y, fc.z);
      mb.rotateY(ang);
      mb.rotateZ(a);
      mb.translate(0.045 * D, 0, 0.005 * D);
      ellipsoid(mb, 0.042 * D, 0.024 * D, 0.016 * D, mid ? 8 : 5, mid ? 5 : 3, [0.25, 0.3, 0.2, 0]);
      mb.pop();
    }
    mb.push(); mb.translate(fc.x, fc.y, fc.z); ellipsoid(mb, 0.026 * D, 0.026 * D, 0.026 * D, 8, 5, [0.1, 0.4, 0.2, 0]); mb.pop();
  }
  // ---- abacus: concave sides, stacked bands (cavetto / fascia / ovolo)
  const hd = 1.0 * D, sag = 0.11 * D, cut = 0.06 * D;
  const bands = [[0.0, 0.055, 0.93], [0.055, 0.125, 1.0], [0.125, 0.17, 0.975]];
  for (const [b0, b1, s] of bands) {
    mb.push();
    mb.translate(0, bellTop + b0 * D, 0);
    mb.rotateX(-Math.PI / 2);
    extrudeOutline(mb, concaveSquare(hd * s, sag * s, cut), (b1 - b0) * D, { aux: [0.05, 0, 0.3, 0], auxSide: [0.15, 0.3, 0.35, 0] });
    mb.pop();
  }
  return Hc;
}
