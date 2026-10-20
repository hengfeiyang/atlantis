// House / building geometry emitters. Everything is emitted into GeoBuilders (merged per chunk):
//   B.plaster (aFac, aSty)  walls, gables, parapets           → materials/plaster.js
//   B.roof    (aRoof)       tile slopes, ridge caps, eaves… → materials/terracotta.js
//   B.stone   (aSt)         plinths, steps, columns, walls     → city/stone.js
//   B.wood    (aW)          doors, balconies, pergolas         → city/wood.js
// A building is a set of box "volumes" (each with its own roof) in a local Frame whose +Z axis is
// the street front. Units: metres.
import { Frame, faceNormal } from './geobuilder.js';
import { ROOF_KIND } from '../materials/terracotta.js';
import { FLAG } from '../materials/plaster.js';

const UP = [0, 1, 0];
const deg = Math.PI / 180;

// ------------------------------------------------------------------ primitive helpers
/** quad whose winding is fixed so its normal points along `want` */
export function quadFacing(b, p0, p1, p2, p3, want, per) {
  let n = faceNormal(p0, p1, p2);
  if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
    // reverse: p0 p3 p2 p1
    const r = per ? Object.fromEntries(Object.entries(per).map(([k, v]) => [k, [v[0], v[3], v[2], v[1]]])) : undefined;
    n = [-n[0], -n[1], -n[2]];
    b.quad(p0, p3, p2, p1, n, r);
  } else b.quad(p0, p1, p2, p3, n, per);
}
export function triFacing(b, p0, p1, p2, want, per) {
  let n = faceNormal(p0, p1, p2);
  if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
    const r = per ? Object.fromEntries(Object.entries(per).map(([k, v]) => [k, [v[0], v[2], v[1]]])) : undefined;
    b.triangle(p0, p2, p1, [-n[0], -n[1], -n[2]], r);
  } else b.triangle(p0, p1, p2, n, per);
}

/** plaster wall from local (ax,az) to (bx,bz) (outside on the right-hand normal), y0..y1 world */
export function wall(B, F, ax, az, bx, bz, y0, y1, floorY, wallH, sty, u0 = 0, wlen = null) {
  const A0 = F.p(ax, y0, az), B0 = F.p(bx, y0, bz), B1 = F.p(bx, y1, bz), A1 = F.p(ax, y1, az);
  const len = Math.hypot(bx - ax, bz - az);
  const n = faceNormal(A0, B0, B1);
  const va = y0 - floorY, vb = y1 - floorY;
  const L = wlen ?? len;
  const f = (u, v) => [u, v, L, wallH];
  B.plaster.quad(A0, B0, B1, A1, n, {
    aFac: [f(u0, va), f(u0 + len, va), f(u0 + len, vb), f(u0, vb)],
    aSty: [sty, sty, sty, sty],
  });
}

/** stone box (axis-aligned in frame F) with ashlar coordinates; faces: bitmask 1 +z,2 +x,4 -z,8 -x,16 top,32 bottom */
export function stoneBox(B, F, cx, cz, hw, hd, y0, y1, kind, seed, faces = 63) {
  const s = B.stone;
  const P = (x, y, z) => F.p(cx + x, y, cz + z);
  const st = (a, b) => [a, b, seed, kind];
  if (faces & 1) { const L = 2 * hw; s.quad(P(-hw, y0, hd), P(hw, y0, hd), P(hw, y1, hd), P(-hw, y1, hd), null, { aSt: [st(0, y0), st(L, y0), st(L, y1), st(0, y1)] }); }
  if (faces & 2) { const L = 2 * hd; s.quad(P(hw, y0, hd), P(hw, y0, -hd), P(hw, y1, -hd), P(hw, y1, hd), null, { aSt: [st(0, y0), st(L, y0), st(L, y1), st(0, y1)] }); }
  if (faces & 4) { const L = 2 * hw; s.quad(P(hw, y0, -hd), P(-hw, y0, -hd), P(-hw, y1, -hd), P(hw, y1, -hd), null, { aSt: [st(0, y0), st(L, y0), st(L, y1), st(0, y1)] }); }
  if (faces & 8) { const L = 2 * hd; s.quad(P(-hw, y0, -hd), P(-hw, y0, hd), P(-hw, y1, hd), P(-hw, y1, -hd), null, { aSt: [st(0, y0), st(L, y0), st(L, y1), st(0, y1)] }); }
  if (faces & 16) { s.quad(P(-hw, y1, hd), P(hw, y1, hd), P(hw, y1, -hd), P(-hw, y1, -hd), null, { aSt: [st(cx - hw, cz + hd), st(cx + hw, cz + hd), st(cx + hw, cz - hd), st(cx - hw, cz - hd)].map((a) => [a[0], a[1], seed, kind === 0 ? 1 : kind]) }); }
  if (faces & 32) { s.quad(P(-hw, y0, -hd), P(hw, y0, -hd), P(hw, y0, hd), P(-hw, y0, hd), null, { aSt: [st(0, 0), st(1, 0), st(1, 1), st(0, 1)] }); }
}

/** n-gon prism (column) centred at local (cx,cz), radius r, y0..y1 */
export function column(B, F, cx, cz, r0, r1, y0, y1, sides, seed, kind = 3) {
  const s = B.stone;
  const circ = 2 * Math.PI * r0;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const p00 = F.p(cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0), p10 = F.p(cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0);
    const p11 = F.p(cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1), p01 = F.p(cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1);
    const mid = (a0 + a1) / 2;
    const want = F.d(Math.cos(mid), 0, Math.sin(mid));
    const u0 = (i / sides) * circ, u1 = ((i + 1) / sides) * circ;
    quadFacing(s, p00, p10, p11, p01, want, { aSt: [[u0, y0, seed, kind], [u1, y0, seed, kind], [u1, y1, seed, kind], [u0, y1, seed, kind]] });
  }
}

/** ridge/hip cap prism along world points P→Q (on the roof surface) */
function ridgeCap(B, P, Q, seed, hw = 0.14, h = 0.11) {
  const d = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]];
  const L = Math.hypot(...d);
  if (L < 0.05) return;
  let s = [d[2], 0, -d[0]]; const sl = Math.hypot(s[0], s[2]) || 1; s = [s[0] / sl, 0, s[2] / sl];
  // up perpendicular to the line in the vertical plane containing it
  const dn = [d[0] / L, d[1] / L, d[2] / L];
  let up = [-dn[0] * dn[1], 1 - dn[1] * dn[1], -dn[2] * dn[1]]; const ul = Math.hypot(...up) || 1; up = up.map((v) => v / ul);
  const top = (p) => [p[0] + up[0] * h, p[1] + up[1] * h, p[2] + up[2] * h];
  const side = (p, k) => [p[0] + s[0] * hw * k - up[0] * 0.03, p[1] + s[1] * hw * k - up[1] * 0.03, p[2] + s[2] * hw * k - up[2] * 0.03];
  const r = (u, v) => [u, v, seed, ROOF_KIND.RIDGE];
  for (const k of [1, -1]) {
    const want = [s[0] * k + up[0], s[1] * k + up[1], s[2] * k + up[2]];
    quadFacing(B.roof, side(P, k), side(Q, k), top(Q), top(P), want, { aRoof: [r(0, k), r(L, k), r(L, 0), r(0, 0)] });
  }
}

// ------------------------------------------------------------------ roofs
/**
 * Emit a roof over a rectangle (local frame F, centre cx,cz, half sizes hw (x) hd (z)) whose wall
 * tops are at yT. type: 'hip' | 'gable' (ridge along the longer side) | 'gableX' | 'gableZ' | 'shed' | 'flat' | 'pyramid'
 */
export function roof(B, F, v, seed) {
  const { cx, cz, hw, hd, yT, type, pitch, over, floorY, h, sty } = v;
  const t = Math.tan(pitch * deg);
  const R = B.roof;
  const P = (x, y, z) => F.p(cx + x, y, cz + z);
  const rr = (u, vv, k = ROOF_KIND.TILE) => [u, vv, seed, k];
  const cosp = Math.cos(pitch * deg);
  const ft = 0.16; // fascia thickness

  if (type === 'flat') {
    // terrace + parapet
    const par = v.parapet ?? 0.9, th = 0.22;
    R.quad(P(-hw + th, yT + 0.05, hd - th), P(hw - th, yT + 0.05, hd - th), P(hw - th, yT + 0.05, -hd + th), P(-hw + th, yT + 0.05, -hd + th), [0, 1, 0],
      { aRoof: [rr(0, 0, 4), rr(2 * hw, 0, 4), rr(2 * hw, 2 * hd, 4), rr(0, 2 * hd, 4)] });
    const pSty = [sty[0], sty[1], sty[2], (sty[3] | FLAG.BLANK) & ~FLAG.DOOR];
    // outer parapet faces continue the facade (v above wall height => no windows)
    wall(B, F, cx - hw, cz + hd, cx + hw, cz + hd, yT, yT + par, floorY, h, pSty);
    wall(B, F, cx + hw, cz + hd, cx + hw, cz - hd, yT, yT + par, floorY, h, pSty);
    wall(B, F, cx + hw, cz - hd, cx - hw, cz - hd, yT, yT + par, floorY, h, pSty);
    wall(B, F, cx - hw, cz - hd, cx - hw, cz + hd, yT, yT + par, floorY, h, pSty);
    // inner faces
    wall(B, F, cx + hw - th, cz + hd - th, cx - hw + th, cz + hd - th, yT, yT + par, floorY, h, pSty);
    wall(B, F, cx - hw + th, cz + hd - th, cx - hw + th, cz - hd + th, yT, yT + par, floorY, h, pSty);
    wall(B, F, cx - hw + th, cz - hd + th, cx + hw - th, cz - hd + th, yT, yT + par, floorY, h, pSty);
    wall(B, F, cx + hw - th, cz - hd + th, cx + hw - th, cz + hd - th, yT, yT + par, floorY, h, pSty);
    // coping
    const yc = yT + par, yc2 = yc + 0.08;
    stoneBox(B, F, cx, cz + hd - th / 2, hw + 0.04, th / 2 + 0.04, yc, yc2, 3, seed, 1 | 16);
    stoneBox(B, F, cx, cz - hd + th / 2, hw + 0.04, th / 2 + 0.04, yc, yc2, 3, seed, 4 | 16);
    stoneBox(B, F, cx + hw - th / 2, cz, th / 2 + 0.04, hd - th, yc, yc2, 3, seed, 2 | 16);
    stoneBox(B, F, cx - hw + th / 2, cz, th / 2 + 0.04, hd - th, yc, yc2, 3, seed, 8 | 16);
    return yc2;
  }

  let ex = hw + over, ez = hd + over;
  const ye = yT - over * t + 0.12;
  let rtype = type;
  if (type === 'gable') rtype = hw >= hd ? 'gableX' : 'gableZ';

  // fascia + soffit ring helper for an eave edge from local a→b (outside to the right), wall line offset
  const eaveEdge = (ax, az, bx, bz, nx, nz) => {
    const L = Math.hypot(bx - ax, bz - az);
    quadFacing(R, P(ax, ye - ft, az), P(bx, ye - ft, bz), P(bx, ye, bz), P(ax, ye, az), F.d(nx, 0, nz),
      { aRoof: [rr(0, 0, 2), rr(L, 0, 2), rr(L, ft, 2), rr(0, ft, 2)] });
    // soffit back to the wall
    const ix = ax - nx * over, iz = az - nz * over, jx = bx - nx * over, jz = bz - nz * over;
    quadFacing(R, P(ax, ye - ft, az), P(bx, ye - ft, bz), P(jx, yT - 0.02, jz), P(ix, yT - 0.02, iz), [0, -1, 0],
      { aRoof: [rr(0, 0, 3), rr(L, 0, 3), rr(L, over, 3), rr(0, over, 3)] });
  };

  if (rtype === 'hip' || rtype === 'pyramid') {
    const alongX = ex >= ez;
    if (alongX) {
      const rx = ex - ez, yr = ye + ez * t;
      const sl = ez / cosp;
      // front (+z)
      R.quad(P(-ex, ye, ez), P(ex, ye, ez), P(rx, yr, 0), P(-rx, yr, 0), null, { aRoof: [rr(0, 0), rr(2 * ex, 0), rr(ex + rx, sl), rr(ex - rx, sl)] });
      // back (-z)
      R.quad(P(ex, ye, -ez), P(-ex, ye, -ez), P(-rx, yr, 0), P(rx, yr, 0), null, { aRoof: [rr(0, 0), rr(2 * ex, 0), rr(ex + rx, sl), rr(ex - rx, sl)] });
      // right (+x) / left (-x) triangles
      R.triangle(P(ex, ye, ez), P(ex, ye, -ez), P(rx, yr, 0), null, { aRoof: [rr(0, 0), rr(2 * ez, 0), rr(ez, sl)] });
      R.triangle(P(-ex, ye, -ez), P(-ex, ye, ez), P(-rx, yr, 0), null, { aRoof: [rr(0, 0), rr(2 * ez, 0), rr(ez, sl)] });
      if (rx > 0.05) ridgeCap(B, P(-rx, yr, 0), P(rx, yr, 0), seed);
      ridgeCap(B, P(rx, yr, 0), P(ex, ye, ez), seed); ridgeCap(B, P(rx, yr, 0), P(ex, ye, -ez), seed);
      ridgeCap(B, P(-rx, yr, 0), P(-ex, ye, ez), seed); ridgeCap(B, P(-rx, yr, 0), P(-ex, ye, -ez), seed);
    } else {
      const rz = ez - ex, yr = ye + ex * t;
      const sl = ex / cosp;
      R.quad(P(ex, ye, ez), P(ex, ye, -ez), P(0, yr, -rz), P(0, yr, rz), null, { aRoof: [rr(0, 0), rr(2 * ez, 0), rr(ez + rz, sl), rr(ez - rz, sl)] });
      R.quad(P(-ex, ye, -ez), P(-ex, ye, ez), P(0, yr, rz), P(0, yr, -rz), null, { aRoof: [rr(0, 0), rr(2 * ez, 0), rr(ez + rz, sl), rr(ez - rz, sl)] });
      R.triangle(P(-ex, ye, ez), P(ex, ye, ez), P(0, yr, rz), null, { aRoof: [rr(0, 0), rr(2 * ex, 0), rr(ex, sl)] });
      R.triangle(P(ex, ye, -ez), P(-ex, ye, -ez), P(0, yr, -rz), null, { aRoof: [rr(0, 0), rr(2 * ex, 0), rr(ex, sl)] });
      if (rz > 0.05) ridgeCap(B, P(0, yr, -rz), P(0, yr, rz), seed);
      ridgeCap(B, P(0, yr, rz), P(ex, ye, ez), seed); ridgeCap(B, P(0, yr, rz), P(-ex, ye, ez), seed);
      ridgeCap(B, P(0, yr, -rz), P(ex, ye, -ez), seed); ridgeCap(B, P(0, yr, -rz), P(-ex, ye, -ez), seed);
    }
    eaveEdge(-ex, ez, ex, ez, 0, 1); eaveEdge(ex, -ez, -ex, -ez, 0, -1);
    eaveEdge(ex, ez, ex, -ez, 1, 0); eaveEdge(-ex, -ez, -ex, ez, -1, 0);
    return ye + Math.min(ex, ez) * t;
  }

  if (rtype === 'gableX' || rtype === 'gableZ') {
    // work in a frame where the ridge runs along local x
    const swap = rtype === 'gableZ';
    const G = swap ? new Frame(...F.p(cx, 0, cz), F.rot + Math.PI / 2) : new Frame(...F.p(cx, 0, cz), F.rot);
    const ghw = swap ? hd : hw, ghd = swap ? hw : hd;
    const gx = ghw + Math.min(over, 0.35), gz = ghd + over;
    const yr = ye + gz * t;
    const sl = gz / cosp;
    const Q = (x, y, z) => G.p(x, y, z);
    R.quad(Q(-gx, ye, gz), Q(gx, ye, gz), Q(gx, yr, 0), Q(-gx, yr, 0), null, { aRoof: [rr(0, 0), rr(2 * gx, 0), rr(2 * gx, sl), rr(0, sl)] });
    R.quad(Q(gx, ye, -gz), Q(-gx, ye, -gz), Q(-gx, yr, 0), Q(gx, yr, 0), null, { aRoof: [rr(0, 0), rr(2 * gx, 0), rr(2 * gx, sl), rr(0, sl)] });
    // undersides of the roof slab at the gable overhang (thin verge)
    for (const sx of [1, -1]) {
      const want = G.d(sx, 0, 0);
      quadFacing(R, Q(sx * gx, ye - ft, gz), Q(sx * gx, ye, gz), Q(sx * gx, yr, 0), Q(sx * gx, yr - ft, 0), want, { aRoof: [rr(0, 0, 2), rr(0, ft, 2), rr(sl, ft, 2), rr(sl, 0, 2)] });
      quadFacing(R, Q(sx * gx, ye - ft, -gz), Q(sx * gx, ye, -gz), Q(sx * gx, yr, 0), Q(sx * gx, yr - ft, 0), want, { aRoof: [rr(0, 0, 2), rr(0, ft, 2), rr(sl, ft, 2), rr(sl, 0, 2)] });
      // verge underside
      quadFacing(R, Q(sx * gx, ye - ft, gz), Q(sx * ghw, ye - ft + 0.0, gz), Q(sx * ghw, yr - ft, 0), Q(sx * gx, yr - ft, 0), [0, -1, 0], { aRoof: [rr(0, 0, 3), rr(0.3, 0, 3), rr(0.3, sl, 3), rr(0, sl, 3)] });
      quadFacing(R, Q(sx * gx, ye - ft, -gz), Q(sx * ghw, ye - ft, -gz), Q(sx * ghw, yr - ft, 0), Q(sx * gx, yr - ft, 0), [0, -1, 0], { aRoof: [rr(0, 0, 3), rr(0.3, 0, 3), rr(0.3, sl, 3), rr(0, sl, 3)] });
      // plaster gable triangle on the wall plane
      const rise = (yr - ft) - yT + (ghd / gz) * 0 ;
      if (v.noGableWall) continue;
      const gSty = [sty[0], sty[1], sty[2], (sty[3] | FLAG.GABLE) & ~FLAG.DOOR];
      const yTop = yT + ghd * t + 0.1;
      const a = Q(sx * ghw, yT, sx * ghd), b = Q(sx * ghw, yT, -sx * ghd), c = Q(sx * ghw, yTop, 0);
      const L = 2 * ghd, rh = yTop - yT;
      triFacing(B.plaster, a, b, c, want, { aFac: [[0, 0, L, rh], [L, 0, L, rh], [L / 2, rh, L, rh]], aSty: [gSty, gSty, gSty] });
      void rise;
    }
    ridgeCap(B, Q(-gx, yr, 0), Q(gx, yr, 0), seed);
    // eave fascia/soffit along the two long sides
    const eave = (ax, az, bx, bz, nz) => {
      const L = Math.hypot(bx - ax, bz - az);
      quadFacing(R, Q(ax, ye - ft, az), Q(bx, ye - ft, bz), Q(bx, ye, bz), Q(ax, ye, az), G.d(0, 0, nz), { aRoof: [rr(0, 0, 2), rr(L, 0, 2), rr(L, ft, 2), rr(0, ft, 2)] });
      quadFacing(R, Q(ax, ye - ft, az), Q(bx, ye - ft, bz), Q(bx, yT - 0.02, bz - nz * over), Q(ax, yT - 0.02, az - nz * over), [0, -1, 0], { aRoof: [rr(0, 0, 3), rr(L, 0, 3), rr(L, over, 3), rr(0, over, 3)] });
    };
    eave(-gx, gz, gx, gz, 1); eave(gx, -gz, -gx, -gz, -1);
    return yr;
  }

  if (rtype === 'shed') {
    // high side at local -z (back), low side at +z (front)
    const gx = hw + Math.min(over, 0.3);
    const yb = yT + 2 * hd * t;
    const sl = (2 * ez) / cosp;
    const yLow = ye, yHigh = ye + 2 * ez * t;
    R.quad(P(-gx, yLow, ez), P(gx, yLow, ez), P(gx, yHigh, -ez), P(-gx, yHigh, -ez), null, { aRoof: [rr(0, 0), rr(2 * gx, 0), rr(2 * gx, sl), rr(0, sl)] });
    // back wall extension + side triangles in plaster
    const bSty = [sty[0], sty[1], sty[2], (sty[3] | FLAG.BLANK) & ~FLAG.DOOR];
    wall(B, F, cx + hw, cz - hd, cx - hw, cz - hd, yT, yb, floorY, h, bSty);
    const gSty = [sty[0], sty[1], sty[2], (sty[3] | FLAG.GABLE | FLAG.BLANK) & ~FLAG.DOOR];
    const rh = yb - yT;
    triFacing(B.plaster, P(hw, yT, hd), P(hw, yT, -hd), P(hw, yb, -hd), F.d(1, 0, 0), { aFac: [[0, 0, 2 * hd, rh], [2 * hd, 0, 2 * hd, rh], [2 * hd, rh, 2 * hd, rh]], aSty: [gSty, gSty, gSty] });
    triFacing(B.plaster, P(-hw, yT, -hd), P(-hw, yT, hd), P(-hw, yb, -hd), F.d(-1, 0, 0), { aFac: [[0, 0, 2 * hd, rh], [2 * hd, 0, 2 * hd, rh], [0, rh, 2 * hd, rh]], aSty: [gSty, gSty, gSty] });
    // fascia front + back
    quadFacing(R, P(-gx, yLow - ft, ez), P(gx, yLow - ft, ez), P(gx, yLow, ez), P(-gx, yLow, ez), F.d(0, 0, 1), { aRoof: [rr(0, 0, 2), rr(2 * gx, 0, 2), rr(2 * gx, ft, 2), rr(0, ft, 2)] });
    quadFacing(R, P(-gx, yLow - ft, ez), P(gx, yLow - ft, ez), P(gx, yT - 0.02, hd), P(-gx, yT - 0.02, hd), [0, -1, 0], { aRoof: [rr(0, 0, 3), rr(2 * gx, 0, 3), rr(2 * gx, over, 3), rr(0, over, 3)] });
    quadFacing(R, P(gx, yHigh - ft, -ez), P(-gx, yHigh - ft, -ez), P(-gx, yHigh, -ez), P(gx, yHigh, -ez), F.d(0, 0, -1), { aRoof: [rr(0, 0, 2), rr(2 * gx, 0, 2), rr(2 * gx, ft, 2), rr(0, ft, 2)] });
    for (const sx of [1, -1]) {
      quadFacing(R, P(sx * gx, yLow - ft, ez), P(sx * gx, yLow, ez), P(sx * gx, yHigh, -ez), P(sx * gx, yHigh - ft, -ez), F.d(sx, 0, 0), { aRoof: [rr(0, 0, 2), rr(0, ft, 2), rr(sl, ft, 2), rr(sl, 0, 2)] });
    }
    return yHigh;
  }
  return yT;
}

// ------------------------------------------------------------------ volumes
/**
 * One building volume: plinth (stone) + 4 plaster walls + optional cornice + roof.
 * v = { cx, cz, hw, hd, floorY, h, stH, groundY (lowest terrain under it), roof, pitch, over,
 *       style, flags: {front, back, left, right}, cornice, seed }
 */
export function volume(B, F, v) {
  const { cx, cz, hw, hd, floorY, h, seed } = v;
  const yT = floorY + h;
  const baseSty = (fl) => [seed, v.stH, v.style, fl];
  // plinth / podium
  const pb = Math.min(v.groundY, floorY) - 1.6;
  const ptop = floorY + (v.plinthH ?? 0.35);
  stoneBox(B, F, cx, cz, hw + 0.08, hd + 0.08, pb, ptop, v.podiumKind ?? 0, seed, 15 | 16);
  // walls (start a little below the plinth top so no gaps)
  const y0 = floorY + 0.02;
  if (!v.noFront) wall(B, F, cx - hw, cz + hd, cx + hw, cz + hd, y0, yT, floorY, h, baseSty(v.flags.front));
  wall(B, F, cx + hw, cz + hd, cx + hw, cz - hd, y0, yT, floorY, h, baseSty(v.flags.right));
  wall(B, F, cx + hw, cz - hd, cx - hw, cz - hd, y0, yT, floorY, h, baseSty(v.flags.back));
  wall(B, F, cx - hw, cz - hd, cx - hw, cz + hd, y0, yT, floorY, h, baseSty(v.flags.left));
  // cornice band
  if (v.cornice) {
    const big = v.h > 6.5;   // r5: deeper cornice on tall buildings → a crisp shadow line under the eaves from afar
    const c = big ? 0.34 : 0.2, ch = big ? 0.52 : 0.34, R = B.roof;
    const P = (x, y, z) => F.p(cx + x, y, cz + z);
    const r = (u, vv) => [u, vv, seed, ROOF_KIND.CORNICE];
    const ring = [[-hw - c, hd + c, hw + c, hd + c, 0, 1], [hw + c, hd + c, hw + c, -hd - c, 1, 0], [hw + c, -hd - c, -hw - c, -hd - c, 0, -1], [-hw - c, -hd - c, -hw - c, hd + c, -1, 0]];
    for (const [ax, az, bx, bz, nx, nz] of ring) {
      const L = Math.hypot(bx - ax, bz - az);
      quadFacing(R, P(ax, yT - ch, az), P(bx, yT - ch, bz), P(bx, yT, bz), P(ax, yT, az), F.d(nx, 0, nz), { aRoof: [r(0, 0), r(L, 0), r(L, ch), r(0, ch)] });
      quadFacing(R, P(ax, yT - ch, az), P(bx, yT - ch, bz), P(bx - nx * c, yT - ch, bz - nz * c), P(ax - nx * c, yT - ch, az - nz * c), [0, -1, 0], { aRoof: [r(0, 0.5), r(L, 0.5), r(L, 0.5), r(0, 0.5)] });
    }
  }
  const top = roof(B, F, { cx, cz, hw: hw + (v.cornice ? 0.1 : 0), hd: hd + (v.cornice ? 0.1 : 0), yT, type: v.roof, pitch: v.pitch, over: v.over, floorY, h, sty: baseSty(v.flags.left), parapet: v.parapet }, v.roofSeed ?? seed);
  return top;
}

/** columned portico in front of a volume face (+z side of the volume) */
export function portico(B, F, p) {
  // p = { cx, cz (front line centre), hw (half width), depth, floorY, h, seed, n (columns), roof:'shed'|'flat' }
  const { cx, cz, hw, depth, floorY, h, seed } = p;
  const n = p.n;
  const r = p.r ?? 0.2;
  // stylobate
  stoneBox(B, F, cx, cz + depth / 2, hw + 0.3, depth / 2 + 0.25, floorY - 1.4, floorY + 0.3, 3, seed, 15 | 16);
  for (let i = 0; i < n; i++) {
    const x = cx - hw + (2 * hw * i) / (n - 1);
    const z = cz + depth;
    stoneBox(B, F, x, z, r + 0.08, r + 0.08, floorY + 0.3, floorY + 0.5, 3, seed, 15 | 16);
    column(B, F, x, z, r, r * 0.86, floorY + 0.5, floorY + h - 0.35, 8, seed, 3);
    stoneBox(B, F, x, z, r + 0.1, r + 0.1, floorY + h - 0.35, floorY + h - 0.2, 3, seed, 15 | 16);
  }
  // architrave beam
  const yb = floorY + h - 0.2;
  stoneBox(B, F, cx, cz + depth, hw + 0.3, r + 0.12, yb, yb + 0.45, 3, seed, 63);
  if (p.roof === 'flat') {
    stoneBox(B, F, cx, cz + depth / 2, hw + 0.3, depth / 2 + 0.05, yb + 0.45, yb + 0.6, 3, seed, 63);
  } else {
    // lean-to tile roof from the wall to the beam
    const t = Math.tan((p.pitch ?? 17) * deg);
    const R = B.roof;
    const P = (x, y, z) => F.p(x, y, z);
    const zf = cz + depth + 0.45, zb = cz;
    const yf = yb + 0.45, yw = yf + (zf - zb) * t;
    const sl = (zf - zb) / Math.cos((p.pitch ?? 17) * deg);
    const rr = (u, vv, k = 0) => [u, vv, seed, k];
    const x0 = cx - hw - 0.4, x1 = cx + hw + 0.4;
    R.quad(P(x0, yf, zf), P(x1, yf, zf), P(x1, yw, zb), P(x0, yw, zb), null, { aRoof: [rr(0, 0), rr(x1 - x0, 0), rr(x1 - x0, sl), rr(0, sl)] });
    quadFacing(R, P(x0, yf - 0.15, zf), P(x1, yf - 0.15, zf), P(x1, yw - 0.15, zb), P(x0, yw - 0.15, zb), [0, -1, 0], { aRoof: [rr(0, 0, 3), rr(x1 - x0, 0, 3), rr(x1 - x0, sl, 3), rr(0, sl, 3)] });
    quadFacing(R, P(x0, yf - 0.15, zf), P(x1, yf - 0.15, zf), P(x1, yf, zf), P(x0, yf, zf), F.d(0, 0, 1), { aRoof: [rr(0, 0, 2), rr(x1 - x0, 0, 2), rr(x1 - x0, 0.15, 2), rr(0, 0.15, 2)] });
    for (const sx of [x0, x1]) quadFacing(R, P(sx, yf - 0.15, zf), P(sx, yf, zf), P(sx, yw, zb), P(sx, yw - 0.15, zb), F.d(sx === x0 ? -1 : 1, 0, 0), { aRoof: [rr(0, 0, 2), rr(0, 0.15, 2), rr(sl, 0.15, 2), rr(sl, 0, 2)] });
  }
}

/** garden / boundary wall with a tiled coping, from local a→b */
export function gardenWall(B, F, ax, az, bx, bz, yA, yB, height, seed, plaster = true) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.5) return;
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const nx = dz, nz = -dx; // right-hand normal
  const th = 0.25;
  const segs = Math.max(1, Math.ceil(len / 6));
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
    const g0 = yA + (yB - yA) * t0, g1 = yA + (yB - yA) * t1;
    const gy = Math.min(g0, g1) - 0.6, top = Math.max(g0, g1) + height;
    const F2 = new Frame(...F.p((x0 + x1) / 2, 0, (z0 + z1) / 2), F.rot + Math.atan2(-(z1 - z0), x1 - x0) - 0);
    const hl = (len / segs) / 2;
    if (plaster) {
      const sty = [seed, 3.2, 0, FLAG.BLANK];
      wall(B, F2, -hl, th / 2, hl, th / 2, gy, top, gy, top - gy, sty, 0);
      wall(B, F2, hl, -th / 2, -hl, -th / 2, gy, top, gy, top - gy, sty, 0);
      wall(B, F2, hl, th / 2, hl, -th / 2, gy, top, gy, top - gy, sty, 0);
      wall(B, F2, -hl, -th / 2, -hl, th / 2, gy, top, gy, top - gy, sty, 0);
    } else {
      stoneBox(B, F2, 0, 0, hl, th / 2 + 0.05, gy, top, 2, seed, 15);
    }
    // tiled coping (tiny gable roof)
    const R = B.roof, rr = (u, vv, k = 0) => [u, vv, seed, k];
    const P = (x, y, z) => F2.p(x, y, z);
    const w = th / 2 + 0.1, ht = 0.12;
    R.quad(P(-hl, top, w), P(hl, top, w), P(hl, top + ht, 0), P(-hl, top + ht, 0), null, { aRoof: [rr(0, 0), rr(2 * hl, 0), rr(2 * hl, 0.2), rr(0, 0.2)] });
    R.quad(P(hl, top, -w), P(-hl, top, -w), P(-hl, top + ht, 0), P(hl, top + ht, 0), null, { aRoof: [rr(0, 0), rr(2 * hl, 0), rr(2 * hl, 0.2), rr(0, 0.2)] });
    void nx; void nz;
  }
}

/** simple external flight of steps from a door down to the ground, along local +z */
export function steps(B, F, cx, cz, hw, yTop, yBottom, seed) {
  const n = Math.max(1, Math.round((yTop - yBottom) / 0.17));
  const rise = (yTop - yBottom) / n, run = 0.3;
  for (let i = 0; i < n; i++) {
    const y1 = yTop - i * rise;
    stoneBox(B, F, cx, cz + run * (i + 0.5), hw, run / 2, yBottom - 0.3, y1, 1, seed, 1 | 2 | 8 | 16);
  }
}

// ------------------------------------------------------------------ timber + cloth details
/** wooden box (local frame) into the chunk's wood builder; kind: 9 timber, 3 spar, 2 paint */
export function woodBox(B, F, cx, cz, hw, hd, y0, y1, kind, seed) {
  const s = B.wood; if (!s) return;
  const P = (x, y, z) => F.p(cx + x, y, cz + z);
  const w = (u, v) => [u, v, seed, kind];
  s.quad(P(-hw, y0, hd), P(hw, y0, hd), P(hw, y1, hd), P(-hw, y1, hd), null, { aW: [w(0, y0), w(2 * hw, y0), w(2 * hw, y1), w(0, y1)] });
  s.quad(P(hw, y0, -hd), P(-hw, y0, -hd), P(-hw, y1, -hd), P(hw, y1, -hd), null, { aW: [w(0, y0), w(2 * hw, y0), w(2 * hw, y1), w(0, y1)] });
  s.quad(P(hw, y0, hd), P(hw, y0, -hd), P(hw, y1, -hd), P(hw, y1, hd), null, { aW: [w(0, y0), w(2 * hd, y0), w(2 * hd, y1), w(0, y1)] });
  s.quad(P(-hw, y0, -hd), P(-hw, y0, hd), P(-hw, y1, hd), P(-hw, y1, -hd), null, { aW: [w(0, y0), w(2 * hd, y0), w(2 * hd, y1), w(0, y1)] });
  s.quad(P(-hw, y1, hd), P(hw, y1, hd), P(hw, y1, -hd), P(-hw, y1, -hd), null, { aW: [w(cx - hw, cz + hd), w(cx + hw, cz + hd), w(cx + hw, cz - hd), w(cx - hw, cz - hd)] });
  s.quad(P(-hw, y0, -hd), P(hw, y0, -hd), P(hw, y0, hd), P(-hw, y0, hd), null, { aW: [w(0, 0), w(1, 0), w(1, 1), w(0, 1)] });
}

/** wooden balcony on a facade (local +z face at z = zf), centred at x, floor at y */
export function balcony(B, F, x, zf, y, width, seed) {
  const d = 0.95, hw = width / 2;
  woodBox(B, F, x, zf + d / 2, hw, d / 2, y - 0.16, y, 9, seed);
  // brackets
  for (const sx of [-1, 1]) woodBox(B, F, x + sx * (hw - 0.15), zf + 0.35, 0.07, 0.35, y - 0.6, y - 0.16, 3, seed);
  // railing: top rail + posts + balusters
  const ry = y + 1.0;
  woodBox(B, F, x, zf + d - 0.04, hw, 0.04, ry - 0.06, ry, 3, seed);
  for (const sx of [-1, 1]) woodBox(B, F, x + sx * (hw - 0.04), zf + d / 2, 0.04, d / 2, ry - 0.06, ry, 3, seed);
  const n = Math.max(3, Math.round(width / 0.22));
  for (let k = 0; k <= n; k++) woodBox(B, F, x - hw + 0.04 + (k * (width - 0.08)) / n, zf + d - 0.04, 0.022, 0.022, y, ry - 0.06, 3, seed);
  for (const sx of [-1, 1]) for (let k = 1; k < 4; k++) woodBox(B, F, x + sx * (hw - 0.04), zf + (k * d) / 4, 0.022, 0.022, y, ry - 0.06, 3, seed);
}

/** striped canvas awning over a shop opening (local +z face at z = zf), top edge at y */
export function awning(B, F, x, zf, y, width, depth, seed, kind = 1) {
  const s = B.sail; if (!s) return;
  const hw = width / 2;
  const nx = 4, nz = 2;
  const P = (u, v) => {
    const xx = x - hw + u * width;
    const zz = zf + v * depth;
    const sag = 0.12 * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.1));
    return F.p(xx, y - v * depth * 0.42 - sag, zz);
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const u0 = i / nx, u1 = (i + 1) / nx, v0 = j / nz, v1 = (j + 1) / nz;
    const a = (u, v) => [u * width, v * depth, seed, kind];
    s.quad(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), null, { aSail: [a(u0, v0), a(u1, v0), a(u1, v1), a(u0, v1)], aSailSize: [[width, depth], [width, depth], [width, depth], [width, depth]] });
  }
  // valance (hanging front edge)
  const e0 = P(0, 1), e1 = P(1, 1);
  const a = (u, v) => [u * width, depth + v, seed, kind];
  s.quad([e0[0], e0[1] - 0.25, e0[2]], [e1[0], e1[1] - 0.25, e1[2]], e1, e0, null, { aSail: [a(0, 0.25), a(1, 0.25), a(1, 0), a(0, 0)], aSailSize: [[width, depth], [width, depth], [width, depth], [width, depth]] });
  // two poles
  for (const sx of [-1, 1]) {
    const px = x + sx * (hw - 0.05);
    const top = P(sx < 0 ? 0 : 1, 1);
    woodBox(B, F, px, zf + depth - 0.05, 0.04, 0.04, top[1] - 2.4, top[1], 3, seed);
  }
}

/** JS mirror of the facade shader's bay layout (to align balconies/awnings with window columns) */
export function bayLayout(seed, wlen) {
  const fr = (x) => x - Math.floor(x);
  const bayW = 2.7 + 1.1 * fr(seed * 3.77);
  const nb = Math.max(1, Math.floor(wlen / bayW + 0.35));
  return { nb, bay: wlen / nb };
}

/** external stone staircase climbing along a side wall (local x = xWall, outside toward sx) */
export function sideStair(B, F, xWall, sx, zStart, zEnd, yBottom, yTop, seed) {
  const n = Math.max(3, Math.round((yTop - yBottom) / 0.19));
  const rise = (yTop - yBottom) / n;
  const run = (zEnd - zStart) / n;
  const w = 1.0;
  const cx = xWall + sx * (w / 2 + 0.02);
  for (let i = 0; i < n; i++) {
    const z0 = zStart + run * i, z1 = z0 + run;
    const y1 = yBottom + rise * (i + 1);
    stoneBox(B, F, cx, (z0 + z1) / 2, w / 2, Math.abs(run) / 2 + 0.01, yBottom - 0.6, y1, 3, seed, 1 | 2 | 4 | 8 | 16);
  }
  // landing at the top
  stoneBox(B, F, cx, zEnd + Math.sign(run) * 0.6, w / 2, 0.6, yBottom - 0.6, yTop, 3, seed, 31);
  // low parapet on the outer side of the flight
  const len = Math.abs(zEnd - zStart);
  const ox = xWall + sx * (w + 0.02);
  for (let i = 0; i < 4; i++) {
    const t0 = i / 4, t1 = (i + 1) / 4;
    const zA = zStart + (zEnd - zStart) * t0, zB = zStart + (zEnd - zStart) * t1;
    const yA = yBottom + (yTop - yBottom) * t1;
    stoneBox(B, F, ox, (zA + zB) / 2, 0.09, len / 8 + 0.01, yBottom - 0.6, yA + 0.75, 3, seed, 15 | 16);
  }
}

/** draped yard ground over a lot (local rect hw x hd centred at cx,cz), into the street builder */
export function lotGround(B, F, cx, cz, hw, hd, ground, seed, step = 4) {
  const s = B.street; if (!s) return;
  const nx = Math.max(1, Math.round((2 * hw) / step)), nz = Math.max(1, Math.round((2 * hd) / step));
  const pts = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const lx = cx - hw + (2 * hw * i) / nx, lz = cz - hd + (2 * hd * j) / nz;
    const [x, , z] = F.p(lx, 0, lz);
    pts.push([x, ground(x, z) + 0.1, z]);
  }
  const at = (i, j) => pts[j * (nx + 1) + i];
  const st = (p) => [p[0], p[2], seed, 8];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    quadFacing(s, a, b, c, d, [0, 1, 0], { aSt: [st(a), st(b), st(c), st(d)] });
  }
}

// ------------------------------------------------------------------ far-field detail (r5)
/**
 * Statue silhouette on a plinth: a draped standing figure (lathe of 8-sided rings, ~130 tris) in
 * marble (or gilded bronze when B.gold is given and opts.gold). Reads as a small white figure with a
 * lit and a shaded side at 300-1500 m (ref 1/4: statues on every roofline, pedestal and pediment).
 * P = world base point, h = figure height, a = facing (rad, THREE rotY), opts: { plinth, spear, gold }
 */
const FIG_RINGS = [[0.0, 0.17, 0.13, 0], [0.06, 0.165, 0.125, 0], [0.3, 0.135, 0.1, 0.01], [0.48, 0.125, 0.09, 0.01], [0.62, 0.12, 0.085, 0.0], [0.73, 0.16, 0.09, -0.01], [0.785, 0.17, 0.085, -0.01], [0.81, 0.055, 0.055, 0], [0.845, 0.06, 0.065, 0.005], [0.875, 0.08, 0.09, 0.01], [0.95, 0.075, 0.082, 0.005], [1.0, 0.03, 0.035, 0]];
/** square tube between two world points into builder T (stone attrs when per is given) */
function tube(T, p, q, r, stoneSeed) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const l = Math.hypot(...d) || 1, dn = d.map((v) => v / l);
  let s = Math.abs(dn[1]) < 0.9 ? [dn[2], 0, -dn[0]] : [1, 0, 0];
  const sl = Math.hypot(...s); s = s.map((v) => v / sl);
  const u = [dn[1] * s[2] - dn[2] * s[1], dn[2] * s[0] - dn[0] * s[2], dn[0] * s[1] - dn[1] * s[0]];
  const C = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let k = 0; k < 4; k++) {
    const a = C[k], b = C[(k + 1) % 4];
    const o = (c) => [s[0] * c[0] * r + u[0] * c[1] * r, s[1] * c[0] * r + u[1] * c[1] * r, s[2] * c[0] * r + u[2] * c[1] * r];
    const A = o(a), Bv = o(b);
    const P0 = [p[0] + A[0], p[1] + A[1], p[2] + A[2]], P1 = [p[0] + Bv[0], p[1] + Bv[1], p[2] + Bv[2]];
    const P2 = [q[0] + Bv[0], q[1] + Bv[1], q[2] + Bv[2]], P3 = [q[0] + A[0], q[1] + A[1], q[2] + A[2]];
    const m = o([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const per = stoneSeed !== undefined ? { aSt: [[0, P0[1], stoneSeed, 7], [0.1, P1[1], stoneSeed, 7], [0.1, P2[1], stoneSeed, 7], [0, P3[1], stoneSeed, 7]] } : undefined;
    quadFacing(T, P0, P1, P2, P3, m, per);
  }
}
export function figure(B, P, h, a, seed, opts = {}) {
  const gold = opts.gold && B.gold;
  const tgt = gold ? B.gold : B.stone;
  const c = Math.cos(a), s = Math.sin(a);
  let y0 = P[1];
  if (opts.plinth) {
    const pw = h * 0.2, ph = opts.plinth === true ? h * 0.32 : opts.plinth;
    stoneBox(B, new Frame(P[0], 0, P[2], a), 0, 0, pw, pw, y0 - 0.2, y0 + ph, 3, seed, 31);
    y0 += ph;
  }
  const W = (lx, ly, lz) => [P[0] + lx * c + lz * s, y0 + ly, P[2] - lx * s + lz * c];
  const sides = 8;
  const lean = (seed * 7.31) % 1 < 0.5 ? 1 : -1;   // contrapposto: hips shift one way
  const ring = (k) => {
    const [fy, rx, rz, dz] = FIG_RINGS[k];
    const sh = (k >= 2 && k <= 5 ? 0.025 * lean : 0) * h;
    const out = [];
    for (let i = 0; i < sides; i++) { const t = (i / sides) * Math.PI * 2; out.push(W(Math.cos(t) * rx * h + sh, fy * h, Math.sin(t) * rz * h + dz * h)); }
    return out;
  };
  const rings = FIG_RINGS.map((_, k) => ring(k));
  const st = (u, v) => [u, v, seed, 7];
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], Bq = rings[k + 1];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const mid = ((i + 0.5) / sides) * Math.PI * 2;
      const want = [Math.cos(mid) * c + Math.sin(mid) * s, 0.15, -Math.cos(mid) * s + Math.sin(mid) * c];
      if (gold) quadFacing(tgt, A[i], A[j], Bq[j], Bq[i], want);
      else quadFacing(tgt, A[i], A[j], Bq[j], Bq[i], want, { aSt: [st(i * 0.1, A[i][1]), st(j * 0.1, A[j][1]), st(j * 0.1, Bq[j][1]), st(i * 0.1, Bq[i][1])] });
    }
  }
  // arms: the left hangs along the drapery, the right is raised (holding the spear) or bent forward
  const sst = gold ? undefined : seed;
  tube(tgt, W(-0.165 * h, 0.77 * h, 0), W(-0.185 * h, 0.5 * h, 0.03 * h), 0.032 * h, sst);
  if (opts.spear) tube(tgt, W(0.165 * h, 0.77 * h, 0), W(0.17 * h, 0.66 * h, 0.03 * h), 0.032 * h, sst);
  else tube(tgt, W(0.165 * h, 0.77 * h, 0), W(0.15 * h, 0.55 * h, 0.1 * h), 0.032 * h, sst);
  // spear / staff held in the raised right hand, or a shield disc on the left
  if (opts.spear) {
    const x = 0.17 * h, z = 0.02 * h, r = 0.012 * h;
    const p0 = W(x - r, 0.02 * h, z), p1 = W(x + r, 0.02 * h, z), p2 = W(x + r, 1.18 * h, z), p3 = W(x - r, 1.18 * h, z);
    const q0 = W(x, 0.02 * h, z - r), q1 = W(x, 0.02 * h, z + r), q2 = W(x, 1.18 * h, z + r), q3 = W(x, 1.18 * h, z - r);
    const sp = B.gold || B.stone;
    const per = B.gold ? undefined : { aSt: [st(0, 0), st(0.1, 0), st(0.1, h), st(0, h)] };
    quadFacing(sp, p0, p1, p2, p3, [-s, 0, -c], per); quadFacing(sp, q0, q1, q2, q3, [c, 0, -s], per);
    // arm reaching out to it
    const wp = W(0.12 * h, 0, 0.02 * h);
    stoneBox(B, new Frame(wp[0], 0, wp[2], a), 0, 0, 0.06 * h, 0.03 * h, y0 + 0.6 * h, y0 + 0.66 * h, 7, seed, 31);
  }
}

/** gilded finial (ball + spike) at world point P, size r */
export function finial(B, P, r, seed) {
  const g = B.gold; if (!g) return;
  const n = 6;
  const pts = (y, rr) => Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return [P[0] + Math.cos(t) * rr, P[1] + y, P[2] + Math.sin(t) * rr]; });
  const rings = [pts(0, r * 0.35), pts(r * 0.5, r), pts(r * 1.4, r), pts(r * 1.9, r * 0.35), pts(r * 3.6, 0.01)];
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, mid = ((i + 0.5) / n) * Math.PI * 2;
    quadFacing(g, rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i], [Math.cos(mid), 0.3, Math.sin(mid)]);
  }
  void seed;
}

/** flat palmette acroterion (gilded or marble) standing at world P, facing angle a, height h */
export function acroterion(B, P, h, a, seed, gold = true) {
  const tgt = gold && B.gold ? B.gold : B.stone;
  const c = Math.cos(a), s = Math.sin(a);
  const W = (lx, ly, lz) => [P[0] + lx * c + lz * s, P[1] + ly, P[2] - lx * s + lz * c];
  // fan outline (7 points) extruded 0.08 h
  const prof = [[-0.12, 0], [0.12, 0], [0.42, 0.55], [0.22, 0.82], [0, 1], [-0.22, 0.82], [-0.42, 0.55]];
  const d = 0.05 * h;
  const per = tgt === B.stone ? (n) => ({ aSt: Array.from({ length: n }, () => [0, 0, seed, 7]) }) : () => undefined;
  for (const sz of [1, -1]) {
    const f = prof.map(([x, y]) => W(x * h, y * h, sz * d));
    for (let i = 1; i < f.length - 1; i++) triFacing(tgt, f[0], f[i], f[i + 1], [s * sz, 0, c * sz], per(3));
  }
  for (let i = 0; i < prof.length; i++) {
    const [x0, y0] = prof[i], [x1, y1] = prof[(i + 1) % prof.length];
    const nx = y1 - y0, ny = -(x1 - x0);
    quadFacing(tgt, W(x0 * h, y0 * h, d), W(x1 * h, y1 * h, d), W(x1 * h, y1 * h, -d), W(x0 * h, y0 * h, -d), [nx * c, ny, -nx * s], per(4));
  }
}

/** shallow pilasters between the window bays of a volume face (local +z face at z = zf) */
export function pilasters(B, F, cx, zf, hw, y0, y1, nb, seed) {
  const bay = (2 * hw) / nb;
  for (let i = 0; i <= nb; i++) {
    const x = cx - hw + i * bay;
    const w = i === 0 || i === nb ? 0.3 : 0.24;
    const xx = i === 0 ? x + w : i === nb ? x - w : x;
    stoneBox(B, F, xx, zf + 0.07, w, 0.07, y0, y1, 3, seed, 1 | 2 | 8);
    // capital block
    stoneBox(B, F, xx, zf + 0.1, w + 0.06, 0.1, y1 - 0.26, y1, 3, seed, 1 | 2 | 8 | 32);
  }
}

/**
 * Belvedere / altana: small arcaded roof room rising through a pitched roof (ref 1 skyline: roof
 * loggias and little towers on many town houses). Walls start at the wall top yBase (hidden under
 * the roof), the open arcade starts at yOpen.
 */
export function belvedere(B, F, cx, cz, hw, hd, yBase, yOpen, hOpen, seed, roofSeed, sty, roofType = 'pyramid') {
  const yT = yOpen + hOpen;
  const s2 = [sty[0], hOpen, 1 + 8 * 1, 0];   // arched windows, arcade "ground" storey
  wall(B, F, cx - hw, cz + hd, cx + hw, cz + hd, yBase, yT, yOpen, hOpen, s2);
  wall(B, F, cx + hw, cz + hd, cx + hw, cz - hd, yBase, yT, yOpen, hOpen, s2);
  wall(B, F, cx + hw, cz - hd, cx - hw, cz - hd, yBase, yT, yOpen, hOpen, s2);
  wall(B, F, cx - hw, cz - hd, cx - hw, cz + hd, yBase, yT, yOpen, hOpen, s2);
  // sill band at the arcade floor
  stoneBox(B, F, cx, cz, hw + 0.08, hd + 0.08, yOpen - 0.18, yOpen, 3, seed, 15 | 16);
  return roof(B, F, { cx, cz, hw: hw + 0.05, hd: hd + 0.05, yT, type: roofType, pitch: 21, over: 0.35, floorY: yOpen, h: hOpen, sty: [sty[0], hOpen, 0, FLAG.BLANK] }, roofSeed);
}

/** chimney on a roof: plaster stack with a tiled cap, rising from the roof at local (x,z) */
export function chimney(B, F, x, z, yBase, yTop, sty, seed) {
  const hw = 0.32 + 0.12 * ((seed * 13.7) % 1), hd = 0.3;
  const F2 = new Frame(...F.p(x, 0, z), F.rot);
  const s2 = [sty[0], 2.6, sty[2], FLAG.BLANK];
  const h = yTop - yBase;
  wall(B, F2, -hw, hd, hw, hd, yBase, yTop, yBase, h, s2);
  wall(B, F2, hw, hd, hw, -hd, yBase, yTop, yBase, h, s2);
  wall(B, F2, hw, -hd, -hw, -hd, yBase, yTop, yBase, h, s2);
  wall(B, F2, -hw, -hd, -hw, hd, yBase, yTop, yBase, h, s2);
  // slab + little gabled tile cap on two posts
  stoneBox(B, F2, 0, 0, hw + 0.08, hd + 0.08, yTop, yTop + 0.08, 3, seed, 63);
  stoneBox(B, F2, -hw + 0.08, 0, 0.07, 0.07, yTop + 0.08, yTop + 0.36, 3, seed, 15);
  stoneBox(B, F2, hw - 0.08, 0, 0.07, 0.07, yTop + 0.08, yTop + 0.36, 3, seed, 15);
  const R = B.roof, rr = (u, v) => [u, v, seed, 0];
  const P = (a, b, c) => F2.p(a, b, c);
  const w = hd + 0.18, y0 = yTop + 0.36, y1 = y0 + 0.22;
  R.quad(P(-hw - 0.12, y0, w), P(hw + 0.12, y0, w), P(hw + 0.12, y1, 0), P(-hw - 0.12, y1, 0), null, { aRoof: [rr(0, 0), rr(2 * hw, 0), rr(2 * hw, 0.3), rr(0, 0.3)] });
  R.quad(P(hw + 0.12, y0, -w), P(-hw - 0.12, y0, -w), P(-hw - 0.12, y1, 0), P(hw + 0.12, y1, 0), null, { aRoof: [rr(0, 0), rr(2 * hw, 0), rr(2 * hw, 0.3), rr(0, 0.3)] });
}
