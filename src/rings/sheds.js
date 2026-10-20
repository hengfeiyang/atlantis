// Ship-sheds (ref 4): rows of arched openings cut into the rock faces of the land rings at water level,
// each a vaulted, lamp-lit dock with a slipway for one trireme. The rock-cut block projects SHED.depth m
// in front of the ring face; its top is a planted ledge below the curtain wall. Merged chunked geometry
// (every bay has its own rock displacement — world-space noise, nothing repeats).
import { Frame, chamferBox, box, lathe, FACES, AUX_ASHLAR, mul3 } from './geo.js';
import { polarXZ, SHED } from './plan.js';
import { noiseA, noiseB } from '../core/noise.js';
import { ruined, ruinRand } from '../world/era.js';
import * as TF from '../terrain/field.js';

const D2R = Math.PI / 180;

/** radial rock displacement (m, toward the water) at a world point + crevice depth → [d, cav].
 *  r2 (ref 4): rounded limestone crag masses (vertical karst lumps ≈ 3 × 4.5 m) with deep dark crevices
 *  between them, a broad bulge field, a little of the terrain face field (src/terrain/field.js) for joints. */
function hash2(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function crag(su, y, sc = 1) {
  // 2D cellular in (along-face metres, height); jittered cells, F1 / F2 + cell id
  const cx = su / (3.3 * sc), cy = y / (4.6 * sc) + 0.35 * noiseB.noise2(su * 0.05, 1.7);
  const ix = Math.floor(cx), iy = Math.floor(cy);
  let f1 = 9, f2 = 9, id = 0, ddx = 0, ddy = 0, gid = [0, 0];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = ix + i, gy = iy + j;
    const ox = gx + 0.15 + 0.7 * hash2(gx, gy), oy = gy + 0.15 + 0.7 * hash2(gx + 71, gy - 13);
    const dx = (ox - cx), dy = (oy - cy) * 1.0;
    const dd = Math.hypot(dx, dy);
    if (dd < f1) { f2 = f1; f1 = dd; id = hash2(gx - 5, gy + 9); ddx = -dx; ddy = -dy; gid = [gx, gy]; } else if (dd < f2) f2 = dd;
  }
  return [f1, f2, id, ddx, ddy, gid];
}
function rockDisp(x, y, z, e) {
  const su = e && e.su ? e.su(x, z) : Math.atan2(x, -z) * 300;             // ≈ metres along the face (continuous across bays)
  // r4: e.cragScale (shed mole, shot 4 close-up): larger karst masses, shallow crevices — the r3 3 × 4.6 m lumps with
  // deep pits cast a leopard-spot pattern of small shadows under the low grazing sun
  const sc = e && e.cragScale ? e.cragScale : 1;
  const [f1, f2, id, ddx, ddy, gid] = crag(su, y, sc);
  const gap = f2 - f1;
  const crev = 1 - Math.min(1, gap / 0.3);
  let lump;
  if (sc > 1) {
    // faceted blocks: each cell is a tilted PLANE (random offset + slopes) → flat sunlit faces, steps / clefts between
    const sx = (hash2(gid[0] + 31, gid[1] - 7) - 0.5) * 2.2, sy = (hash2(gid[0] - 19, gid[1] + 43) - 0.6) * 1.6;
    lump = (0.9 * (id - 0.5) * 2 + sx * ddx + sy * ddy - 0.9 * crev * crev) * sc * 0.75;
  } else lump = 1.9 * (0.62 - f1) * (0.7 + 0.6 * id) - 1.3 * crev * crev;
  const t = TF.rockDisp(x, y, z, 0.12) * (sc > 1 ? 0.5 : 1);
  const mass = Math.max(0, noiseA.fbm3(x * 0.04, y * 0.05, z * 0.04, 2) + 0.15) * 1.4;
  const fine = (sc > 1 ? 0.05 : 0.12) * noiseB.noise3(x * 0.9, y * 0.9, z * 0.9);
  let cav = Math.min(1, Math.max(0, crev * 0.9 + TF.CAV * 0.3));
  const k = e && e.rockAmp != null ? e.rockAmp : 1;   // r3: shed mole = flatter dressed-rock face (front-lit in shot 4)
  let fac = 0;
  if (sc > 1) {
    // r6 (ref 4 close-up): a second, small octave of tilted facets (≈ 1.4 × 2 m blocks) with crisp clefts between them —
    // the r5 face read as smooth plaster from the shot-4 eye 20-60 m away
    const [g1, g2, gid2, ex, ey, gg] = crag(su * 1.0 + 17.3, y + 5.1, 0.42);
    const cr2 = 1 - Math.min(1, (g2 - g1) / 0.22);
    const tx = (hash2(gg[0] + 5, gg[1] - 3) - 0.5) * 2.0, ty = (hash2(gg[0] - 11, gg[1] + 29) - 0.65) * 1.5;
    fac = (0.55 * (gid2 - 0.5) + tx * ex + ty * ey - 0.75 * cr2 * cr2) * 0.55;
    cav = Math.min(1, Math.max(cav, cr2 * cr2 * 0.85));
  }
  return [Math.max(-1.4 * k, Math.min(3.6 * k, 0.7 * k + (lump + mass) * k + t + fine + fac)), cav * (0.5 + 0.5 * k)];
}
/** rock top above the land level (m): lumpy crest rising toward the curtain foot (the wall sits ON the rock) */
function crest(x, z) {
  const n = noiseA.fbm3(x * 0.06, 3.7, z * 0.06, 3), m = noiseB.noise2(x * 0.21, z * 0.21);
  return 0.9 + 1.6 * Math.max(0, n + 0.25) + 0.35 * m;
}

/**
 * Build one shed bay (or a solid pier filler if opts.solid).
 * sh: plan shed { bearing, faceR, frontR, crown, width, landY } ; e: edge; halfDeg: half the bay angle
 */
function shedBay(ctx, e, sh, halfDeg, opts) {
  const { S, rng } = ctx;
  const DEP = e.shedDepth ?? SHED.depth, BACK = e.shedBack ?? SHED.back;   // r3: per-edge (shed mole: shallow front, deep interior)
  const b = sh.bearing, side = e.side, R0 = e.faceR, Rf = R0 + side * DEP;
  const yB = e.floor - 1.0, yT = e.landY;
  const ra = (sh.clear || SHED.clear) / 2, ys = sh.crown - ra;   // r6: per-bay clear width (shed mole table)
  const br = b * D2R;
  const PX = e.polar || polarXZ;
  const [ox, oz] = PX(R0, b);
  const Fb = new Frame([ox, 0, oz], [Math.cos(br), 0, Math.sin(br)], [0, 1, 0], [Math.sin(br) * side, 0, -Math.cos(br) * side]);
  const W = (u, y, rr) => { const [x, z] = PX(rr, b + u); return [x, y, z]; };
  const mid = W(0, 0, Rf);
  const lod = ctx.lodAt(mid[0], mid[2]);
  const Rk = S.get('rock', mid[0], mid[2]);
  const label = `rings:shed:${e.id}:${Math.round(b * 100)}`;
  const broken = ctx.sunken && ruined(label, 0.25);
  // ---- front rock face: grid with the arch opening removed, radially displaced
  const cs = lod === 0 ? (e.cragScale > 1 ? 0.4 : 0.75) : lod === 1 ? 1.2 : 2.2;   // r6: the shed mole (shot 4 close-up) carries small facets
  const nu = Math.max(4, Math.ceil((2 * halfDeg * D2R * Rf) / cs)), ny = Math.max(4, Math.ceil((yT - yB) / cs));
  const m = 0.3;
  const inOpen = (sv, y) => !opts.solid && Math.abs(sv) < ra + m && (y < ys || Math.hypot(sv, y - ys) < ra + m);
  // snap vertices that fall inside the opening onto its outline so the rock hugs the arch
  const snap = (sv, y) => {
    if (!inOpen(sv, y)) return [sv, y, false];
    if (y <= ys) return [Math.sign(sv || 1) * (ra + m), y, true];
    const dx = sv, dy = y - ys, l = Math.hypot(dx, dy) || 1;
    return [(dx / l) * (ra + m), ys + (dy / l) * (ra + m), true];
  };
  const vert = [], cavs = [];
  for (let j = 0; j <= ny; j++) {
    const row = [], crow = [];
    const y = yB + ((yT - yB) * j) / ny;
    for (let i = 0; i <= nu; i++) {
      const u = -halfDeg + (2 * halfDeg * i) / nu;
      let sv = Rf * Math.sin(u * D2R), yy = y;
      if (i > 0 && i < nu) [sv, yy] = snap(sv, y);
      const uu = Math.asin(Math.max(-1, Math.min(1, sv / Rf))) / D2R;
      const p0 = W(uu, yy, Rf);
      // the top row climbs to the lumpy crest (the cliff continues up to the wall foot)
      if (j === ny) yy = yT + crest(p0[0], p0[2]);
      else if (j === ny - 1) yy += 0.45 * crest(p0[0], p0[2]);
      let [d, cav] = rockDisp(p0[0], yy, p0[2], e);
      if (j === ny) d = 0.4 * d - 0.3;
      if (yy < 0.4) d = 0.6 * d - 0.2;
      if (j === 0) d = Math.min(d, 0.3);
      // near the dressed arch the rock stays behind the archivolt
      if (!opts.solid) {
        const dOpen = yy <= ys ? Math.abs(Math.abs(sv) - ra) : Math.abs(Math.hypot(sv, yy - ys) - ra);
        if (dOpen < 3.5) { d = Math.min(d, -0.2 + 0.55 * dOpen); cav = Math.max(cav, 0.55 * (1 - dOpen / 3.5)); }
      }
      row.push(W(uu, yy, Rf + side * d));
      crow.push(cav);
    }
    vert.push(row); cavs.push(crow);
  }
  // smooth vertex normals from the grid (central differences), oriented toward the water
  const out = Fb.az;
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const nrm = [];
  for (let j = 0; j <= ny; j++) {
    const row = [];
    for (let i = 0; i <= nu; i++) {
      const du = sub(vert[j][Math.min(nu, i + 1)], vert[j][Math.max(0, i - 1)]), dv = sub(vert[Math.min(ny, j + 1)][i], vert[Math.max(0, j - 1)][i]);
      let n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
      row.push(n);
    }
    nrm.push(row);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nu; i++) {
    const uc = -halfDeg + (2 * halfDeg * (i + 0.5)) / nu, yc = yB + ((yT - yB) * (j + 0.5)) / ny;
    if (inOpen(Rf * Math.sin(uc * D2R), yc)) continue;
    const ids = [[j, i], [j, i + 1], [j + 1, i + 1], [j + 1, i]];
    Rk.quadSmooth(ids.map(([a2, b2]) => vert[a2][b2]), ids.map(([a2, b2]) => nrm[a2][b2]), [1, 1, 1], ids.map(([a2, b2]) => [cavs[a2][b2], 0, 0, 0]), out);
  }
  // ---- top ledge: lumpy rock crest from the front edge up / back to the curtain foot (covers its plinth)
  const back = R0 - side * (Math.abs(e.faceR - e.wallR) + 0.2);
  const nl = lod === 0 ? 6 : 4;
  const ledge = [];
  for (let k = 0; k <= nl; k++) {
    const row = [];
    const t = k / nl;
    for (let i = 0; i <= nu; i++) {
      if (k === 0) { row.push(vert[ny][i]); continue; }
      const u = -halfDeg + (2 * halfDeg * i) / nu;
      const rr = Rf + (back - Rf) * t;
      const pw = W(u, 0, rr);
      const cr = crest(pw[0], pw[2]);
      const yy = yT + cr * (1 - t) + (0.8 + 0.5 * Math.max(0, cr - 1.2)) * t + 0.25 * noiseB.noise2(pw[0] * 0.5, pw[2] * 0.5) * (1 - t);
      row.push(W(u, yy, rr));
    }
    ledge.push(row);
  }
  Rk.aux = [0, 0, 0, 0];
  for (let k = 0; k < nl; k++) for (let i = 0; i < nu; i++) {
    Rk.quadToward(ledge[k][i], ledge[k][i + 1], ledge[k + 1][i + 1], ledge[k + 1][i], [1, 1, 1], [0, 1, 0]);
  }
  // group ends: radial side faces
  for (const [flag, u] of [[opts.endA, -halfDeg], [opts.endB, halfDeg]]) {
    if (!flag) continue;
    const dir = u < 0 ? mul3(Fb.ax, -1) : Fb.ax;
    const nr = 6, nyy = 6;
    for (let j = 0; j < nyy; j++) for (let k = 0; k < nr; k++) {
      const yTop = (r) => { const pw = W(u, 0, r); return yT + crest(pw[0], pw[2]) * 0.8; };
      const y0 = yB + ((yT - yB) * j) / nyy, y1 = yB + ((yT - yB) * (j + 1)) / nyy;
      const r0 = R0 + (Rf - R0) * (k / nr), r1 = R0 + (Rf - R0) * ((k + 1) / nr);
      const dp = (r, y) => { if (y >= yT - 1e-3) y = yTop(r); const p = W(u, y, r); const dd = rockDisp(p[0], y, p[2], e)[0] * 0.8; return W(u + (u < 0 ? -1 : 1) * (dd / r) / D2R, y, r); };
      Rk.quadToward(dp(r0, y0), dp(r1, y0), dp(r1, y1), dp(r0, y1), [1, 1, 1], dir);
    }
  }
  if (opts.solid) return;
  // r6 (arch-a, shot 4 "treadmill"): every bay has its own style — archivolt (plain / red-white banded / gilt hood +
  // medallion / rusticated), pier ornament (banner / lion-head spout / statue niche / bracket lamp), lamp count + warmth,
  // vault ribs or timber trusses, hanging lanterns, ivy, an occasional bronze gate. Mole bays: a hand-set table
  // (molePlan sh.style); ring sheds: hashed per bearing.
  const sty = bayStyle(sh, e.id);
  const A = sty.arch;
  // ---- dressed arch: jambs, voussoirs, keystone
  const Ff = Fb.at(0, 0, DEP);
  const Wt = S.get(A === 'rustic' ? 'lime' : 'white', mid[0], mid[2]), G = S.get('gilt', mid[0], mid[2]), Rd = S.get('red', mid[0], mid[2]);
  const ring = A === 'rustic' ? 1.05 : A === 'gilt' ? 0.8 : 0.85;
  const stoneOf = (k2) => (A === 'banded' && k2 % 2 ? Rd : Wt);
  const tone = () => (A === 'rustic' ? [0.86 + 0.08 * rng.random(), 0.84, 0.8] : [0.92 + 0.06 * rng.random(), 0.9, 0.86]);
  for (const B of [Wt, Rd]) B.aux = [0, 0.4, 0, AUX_ASHLAR(0.6)];
  let y = -0.8, k = 0;
  while (y < ys - 0.02) {
    const hh = Math.min(ys - y, k % 2 ? 0.55 : 0.8);
    for (const sx of [-1, 1]) {
      const wide = (k + (sx > 0 ? 1 : 0)) % 2 ? ring * 1.2 : ring * 0.8;
      const a = sx < 0 ? -ra - wide : ra, c = sx < 0 ? -ra : ra + wide;
      const dF = A === 'rustic' ? (k % 2 ? 0.62 : 0.4) : 0.35;
      chamferBox(stoneOf(k), Ff, a, c, y, y + hh, -1.2, dF, lod <= 1 ? (A === 'rustic' ? 0.11 : 0.04) : 0, tone(), FACES.pz | FACES.px | FACES.nx | FACES.py | FACES.ny);
    }
    y += hh; k++;
  }
  for (const sx of [-1, 1]) chamferBox(G, Ff, sx < 0 ? -ra - ring * 1.3 : ra - 0.1, sx < 0 ? -ra + 0.1 : ra + ring * 1.3, ys - 0.25, ys, -1.2, 0.45, 0.03, [1, 1, 1]);
  const nv = lod === 0 ? (A === 'rustic' ? 13 : 17) : 11;
  let rTop = ra + ring * 1.35;
  for (let i = 0; i < nv; i++) {
    const a0 = Math.PI - (Math.PI * i) / nv, a1 = Math.PI - (Math.PI * (i + 1)) / nv;
    const key = i === (nv - 1) / 2;
    const B = key ? (A === 'rustic' ? Wt : G) : stoneOf(i);
    // rusticated: stepped extrados (long / short voussoirs) and bossed fronts
    const R1 = ra + ring * (key ? 1.35 : A === 'rustic' ? (i % 2 ? 1.25 : 0.92) : 1), dF = key ? 0.55 : A === 'rustic' ? (i % 2 ? 0.6 : 0.42) : 0.35;
    const g = A === 'rustic' ? 0.018 : 0.012;
    const P = (a, rr, d) => Ff.p(Math.cos(a) * rr, ys + Math.sin(a) * rr, d);
    const c = key && A !== 'rustic' ? [1, 1, 1] : tone();
    const ctr = Ff.p(Math.cos((a0 + a1) / 2) * (ra + R1) / 2, ys + Math.sin((a0 + a1) / 2) * (ra + R1) / 2, -0.4);
    B.quadOut(P(a0 - g, ra, dF), P(a1 + g, ra, dF), P(a1 + g, R1, dF), P(a0 - g, R1, dF), c, ctr);
    B.quadOut(P(a0 - g, R1, dF), P(a1 + g, R1, dF), P(a1 + g, R1, -1.2), P(a0 - g, R1, -1.2), c, ctr);
    B.quadOut(P(a0 - g, ra, -1.2), P(a1 + g, ra, -1.2), P(a1 + g, ra, dF), P(a0 - g, ra, dF), [0.75, 0.73, 0.7], Ff.p(0, ys, 0));
    B.quadOut(P(a0 - g, ra, dF), P(a0 - g, R1, dF), P(a0 - g, R1, -1.2), P(a0 - g, ra, -1.2), c, ctr);
    B.quadOut(P(a1 + g, R1, dF), P(a1 + g, ra, dF), P(a1 + g, ra, -1.2), P(a1 + g, R1, -1.2), c, ctr);
  }
  if (A === 'gilt' && lod <= 1) {
    // gilt hood moulding (half-round band over the voussoirs, label stops at the springing) + a gilt medallion
    const r0 = ra + ring + 0.02, r1 = r0 + 0.32, dH = 0.52, nh = lod === 0 ? 24 : 14;
    for (let i = 0; i < nh; i++) {
      const a0 = Math.PI - (Math.PI * i) / nh, a1 = Math.PI - (Math.PI * (i + 1)) / nh;
      const P = (a, rr, d) => Ff.p(Math.cos(a) * rr, ys + Math.sin(a) * rr, d);
      const ctr = Ff.p(0, ys, -0.5);
      G.quadOut(P(a0, r0, dH), P(a1, r0, dH), P(a1, r1, dH), P(a0, r1, dH), [1, 1, 1], ctr);
      G.quadOut(P(a0, r1, dH), P(a1, r1, dH), P(a1, r1, -0.2), P(a0, r1, -0.2), [1, 1, 1], ctr);
      G.quadOut(P(a0, r0, -0.2), P(a1, r0, -0.2), P(a1, r0, dH), P(a0, r0, dH), [0.85, 0.85, 0.85], Ff.p(0, ys, 0.5));
    }
    for (const sx of [-1, 1]) chamferBox(G, Ff, sx * (r0 + 0.16) - 0.3, sx * (r0 + 0.16) + 0.3, ys - 0.7, ys - 0.25, -0.2, dH + 0.08, 0.04, [1, 1, 1]);
    const yM = ys + ra + ring * 1.35 + 0.95;
    const Fm = new Frame(Ff.p(0, yM, 0.5), Ff.ax, Ff.az, mul3(Ff.ay, -1));
    lathe(G, Fm, 0, 0, 0, [[0.85, -0.3], [0.85, 0.02], [0.78, 0.1], [0.55, 0.08], [0.32, 0.18], [0, 0.22]], 18, [1, 1, 1]);
    rTop = yM + 0.85 - ys;
  }
  if (A === 'banded' && lod <= 1) {
    // gilt keystone mask block + thin gilt extrados line (ref 2 banded towers)
    const r0 = ra + ring + 0.01, nh = lod === 0 ? 20 : 12;
    for (let i = 0; i < nh; i++) {
      const a0 = Math.PI - (Math.PI * i) / nh, a1 = Math.PI - (Math.PI * (i + 1)) / nh;
      const P = (a, rr, d) => Ff.p(Math.cos(a) * rr, ys + Math.sin(a) * rr, d);
      G.quadOut(P(a0, r0, 0.36), P(a1, r0, 0.36), P(a1, r0 + 0.12, 0.36), P(a0, r0 + 0.12, 0.36), [1, 1, 1], Ff.p(0, ys, -0.5));
    }
  }
  for (const B of [Wt, Rd]) B.aux = [0, 0, 0, 0];
  // ---- interior: side walls, vault, back wall, slipway (lamp glow baked in aux.z)
  const I = S.get('interior', mid[0], mid[2]);
  const dBack = -BACK, dFront = DEP - 1.2;
  const lamps = [];
  const lampD = (e.shedLamps || [DEP - 4.5, DEP - 11.5, DEP - 23]).slice(0, Math.max(1, sty.lampN || 9));
  for (const dl of lampD) for (const sx of [-1, 1]) lamps.push([sx * (ra - 0.4), ys - 0.6, dl]);
  const lanternD = sty.lanterns ? [DEP - 6, DEP - 14.5].filter((d) => d > dBack + 3) : [];
  for (const dl of lanternD) lamps.push([0, sh.crown - 2.6, dl]);
  const gain = (e.lampGain ?? 1) * (sty.lampGain ?? 1);
  const glow = (p) => { let g = 0; for (const l of lamps) { const d2 = (p[0] - l[0]) ** 2 + (p[1] - l[1]) ** 2 + (p[2] - l[2]) ** 2; g += 2.2 * gain / (1 + d2 * 0.35 / gain); } return g; };
  const nd = lod === 0 ? 12 : 6;
  const tint = sty.tint || [1, 1, 1];
  const IQ = (a, b2, c, d, n) => {
    // local points → world, aux.z from the glow at each vertex (one quad = constant aux; subdivided enough)
    const mc = [(a[0] + b2[0] + c[0] + d[0]) / 4, (a[1] + b2[1] + c[1] + d[1]) / 4, (a[2] + b2[2] + c[2] + d[2]) / 4];
    I.aux = [0, 0, broken ? 0 : glow(mc), 0];
    I.quadToward(Fb.p(...a), Fb.p(...b2), Fb.p(...c), Fb.p(...d), tint, Fb.dir(...n));
  };
  for (let q = 0; q < nd; q++) {
    const d0 = dBack + (dFront - dBack) * (q / nd), d1 = dBack + (dFront - dBack) * ((q + 1) / nd);
    for (const sx of [-1, 1]) {
      const yw = [yB, 0, ys * 0.5, ys];
      for (let j = 0; j < 3; j++) IQ([sx * ra, yw[j], d0], [sx * ra, yw[j], d1], [sx * ra, yw[j + 1], d1], [sx * ra, yw[j + 1], d0], [-sx, 0, 0]);
    }
    const na = lod === 0 ? 10 : 6;
    for (let i = 0; i < na; i++) {
      const a0 = (Math.PI * i) / na, a1 = (Math.PI * (i + 1)) / na;
      const c0 = Math.cos(a0) * ra, s0 = ys + Math.sin(a0) * ra, c1 = Math.cos(a1) * ra, s1 = ys + Math.sin(a1) * ra;
      const am = (a0 + a1) / 2;
      IQ([c0, s0, d0], [c1, s1, d0], [c1, s1, d1], [c0, s0, d1], [-Math.cos(am), -Math.sin(am), 0]);
    }
  }
  // transverse stone ribs (arched bands + wall pilasters) every ≈ 4.5 m (ribbed bays)
  if (sty.ribs && lod <= 1) {
    const tr = 0.42, wr = 0.32;
    for (let dr = dFront - 2.2; dr > dBack + 1.5; dr -= 4.6) {
      const d0 = dr - wr, d1 = dr + wr, na = lod === 0 ? 12 : 8;
      for (let i = 0; i < na; i++) {
        const a0 = (Math.PI * i) / na, a1 = (Math.PI * (i + 1)) / na, am = (a0 + a1) / 2;
        const R = ra - tr;
        const P = (a, rr, d) => [Math.cos(a) * rr, ys + Math.sin(a) * rr, d];
        IQ(P(a0, R, d0), P(a1, R, d0), P(a1, R, d1), P(a0, R, d1), [-Math.cos(am), -Math.sin(am), 0]);
        IQ(P(a0, ra, d1), P(a1, ra, d1), P(a1, R, d1), P(a0, R, d1), [0, 0, 1]);
        IQ(P(a0, ra, d0), P(a1, ra, d0), P(a1, R, d0), P(a0, R, d0), [0, 0, -1]);
      }
      for (const sx of [-1, 1]) {
        const xi = sx * (ra - tr);
        IQ([xi, 0.8, d0], [xi, 0.8, d1], [xi, ys, d1], [xi, ys, d0], [-sx, 0, 0]);
        IQ([sx * ra, 0.8, d1], [xi, 0.8, d1], [xi, ys, d1], [sx * ra, ys, d1], [0, 0, 1]);
        IQ([sx * ra, 0.8, d0], [xi, 0.8, d0], [xi, ys, d0], [sx * ra, ys, d0], [0, 0, -1]);
      }
    }
  }
  // back wall (dark, a few glowing niches)
  const V = S.get('void', mid[0], mid[2]);
  V.quadToward(Fb.p(-ra, yB, dBack), Fb.p(ra, yB, dBack), Fb.p(ra, sh.crown, dBack), Fb.p(-ra, sh.crown, dBack), [1, 1, 1], Fb.az);
  // slipway ramp + timber rails
  const Lm = S.get('lime', mid[0], mid[2]);
  Lm.aux = [0.3, 0, 0, 0];
  Lm.quadToward(Fb.p(-ra, -1.4, dFront + 1.2), Fb.p(ra, -1.4, dFront + 1.2), Fb.p(ra, 1.2, dBack), Fb.p(-ra, 1.2, dBack), [0.55, 0.55, 0.5], [0, 1, 0]);
  Lm.aux = [0, 0, 0, 0];
  if (!ctx.sunken) {
    const Wd = S.get('wood', mid[0], mid[2]);
    for (const sx of [-1.6, 1.6]) {
      const run = dFront + 1.2 - dBack, rise = 2.6;
      const Fr = new Frame(Fb.p(sx, 1.22, dBack), Fb.ax, Fb.ay, Fb.az).tilted(0, -Math.atan2(rise, run));
      box(Wd, Fr, -0.18, 0.18, 0, 0.22, 0, Math.hypot(rise, run), [1, 1, 1], FACES.py | FACES.px | FACES.nx);
    }
    // tie beams across the dock (timber bays: denser, with king posts + a ridge purlin)
    if (lod <= 1) {
      const beams = sty.ribs ? [-14, 1.5, 11] : [-17, -11, -6, -1, 3.5, 8, 11.5];
      for (const dd of beams.map((v) => v + DEP - SHED.depth)) {
        if (dd < dBack + 0.5 || dd > dFront) continue;
        box(Wd, Fb, -ra, ra, ys - 0.35, ys - 0.05, dd - 0.15, dd + 0.15, [0.9, 0.9, 0.9], FACES.py | FACES.ny | FACES.pz | FACES.nz);
        if (!sty.ribs) {
          box(Wd, Fb, -0.13, 0.13, ys - 0.05, sh.crown - 0.25, dd - 0.13, dd + 0.13, [0.85, 0.85, 0.85], FACES.px | FACES.nx | FACES.pz | FACES.nz);
          for (const sx of [-1, 1]) {
            const Fs = new Frame(Fb.p(sx * ra * 0.5, ys - 0.05, dd), Fb.ax, Fb.ay, Fb.az).tilted(-sx * 0.9, 0);
            box(Wd, Fs, -0.1, 0.1, 0, ra * 0.62, -0.1, 0.1, [0.85, 0.85, 0.85], FACES.px | FACES.nx | FACES.pz | FACES.nz);
          }
        }
      }
      if (!sty.ribs) box(Wd, Fb, -0.16, 0.16, sh.crown - 0.55, sh.crown - 0.25, dBack + 0.5, dFront, [0.8, 0.8, 0.8], FACES.ny | FACES.px | FACES.nx);
    }
    // lamps (emissive) on iron brackets
    const Lp = S.get('lamp', mid[0], mid[2]);
    for (const l of lamps) {
      if (l[0] === 0) continue;
      const Fl = Fb.at(l[0], l[1], l[2]);
      box(Lp, Fl, -0.14, 0.14, -0.2, 0.14, -0.14, 0.14, [1, 1, 1]);
      if (lod === 0) ctx.slots.lamp.push({ pos: Fl.p(0, 0.15, 0), size: 0.22, tag: 'rings-shed' });
    }
    // hanging lanterns on chains under the vault crown (ref 4: lamp-lit vaults)
    if (lod <= 1) for (const dl of lanternD) {
      const Fl = Fb.at(0, sh.crown - 2.6, dl);
      box(Lp, Fl, -0.22, 0.22, -0.3, 0.3, -0.22, 0.22, [1, 1, 1]);
      box(G, Fl, -0.3, 0.3, 0.3, 0.42, -0.3, 0.3, [1, 1, 1]);
      box(G, Fl, -0.27, 0.27, -0.42, -0.3, -0.27, 0.27, [1, 1, 1]);
      box(Wd, Fl, -0.03, 0.03, 0.42, 2.55, -0.03, 0.03, [0.5, 0.5, 0.5], FACES.px | FACES.nx | FACES.pz | FACES.nz);
    }
  }
  // bronze gates: 'closed' = two lattice leaves across the opening; 'open' = leaves folded back against the jambs
  if (sty.gate && !broken) {
    const Bz = S.get('bronze', mid[0], mid[2]);
    const dG = DEP - 1.7, hG = Math.min(ys + ra * 0.55, sh.crown - 0.6);
    for (const sx of [-1, 1]) {
      const hinge = Fb.at(sx * (ra - 0.05), 0, dG);
      const Fl = sty.gate === 'open' ? hinge.yawed(sx * 1.35) : hinge;
      const wL = ra - 0.05, x0 = sx < 0 ? 0 : -wL, x1 = sx < 0 ? wL : 0;
      // frame + rails
      for (const [ya, yb2] of [[0.0, 0.22], [hG * 0.38, hG * 0.38 + 0.14], [hG * 0.72, hG * 0.72 + 0.14], [hG - 0.24, hG]]) box(Bz, Fl, x0, x1, ya, yb2, -0.09, 0.09, [1, 1, 1]);
      box(Bz, Fl, sx < 0 ? x1 - 0.2 : x0, sx < 0 ? x1 : x0 + 0.2, 0, hG, -0.1, 0.1, [1, 1, 1]);
      box(Bz, Fl, sx < 0 ? x0 : x1 - 0.2, sx < 0 ? x0 + 0.2 : x1, 0, hG, -0.1, 0.1, [1, 1, 1]);
      // bars with gilt spear finials
      const nbars = Math.max(4, Math.round(wL / 0.42));
      for (let i = 1; i < nbars; i++) {
        const xb = x0 + ((x1 - x0) * i) / nbars;
        box(Bz, Fl, xb - 0.045, xb + 0.045, 0, hG + 0.35, -0.045, 0.045, [1, 1, 1], FACES.px | FACES.nx | FACES.pz | FACES.nz);
        box(G, Fl, xb - 0.09, xb + 0.09, hG + 0.35, hG + 0.6, -0.06, 0.06, [1, 1, 1]);
      }
      // gilt trident roundel on each leaf
      const Fm = new Frame(Fl.p((x0 + x1) / 2, hG * 0.55, 0.1), Fl.ax, Fl.az, mul3(Fl.ay, -1));
      lathe(G, Fm, 0, 0, 0, [[0.62, -0.05], [0.62, 0.05], [0.5, 0.1], [0.22, 0.12], [0, 0.14]], 14, [1, 1, 1]);
    }
  }
  // ---- slots + registry
  sh.slotPos = Fb.p(0, 0, DEP - 0.5);
  // the real rock surface (same clamps as the face grid) at local (sv along the face, y): radial offset d
  const surf = (sv, y2) => {
    const uu = Math.asin(Math.max(-1, Math.min(1, sv / Rf))) / D2R, p = W(uu, y2, Rf);
    let d = rockDisp(p[0], y2, p[2], e)[0];
    const dOpen = y2 <= ys ? Math.abs(Math.abs(sv) - ra) : Math.abs(Math.hypot(sv, y2 - ys) - ra);
    if (dOpen < 3.5) d = Math.min(d, -0.2 + 0.55 * dOpen);
    return d;
  };
  const svP = Rf * Math.sin(halfDeg * D2R);
  const pierFrame = (yc, w, h) => {
    let dMax = -9;
    for (const fu of [-0.5, 0, 0.5]) for (const fv of [-0.5, 0, 0.5]) dMax = Math.max(dMax, surf(svP + fu * w, yc + fv * h));
    const uB = Math.asin(Math.max(-1, Math.min(1, svP / Rf))) / D2R;
    return new Frame(W(uB, 0, Rf + side * (dMax + 0.06)), Fb.ax, Fb.ay, Fb.az);
  };
  if (!ctx.sunken) {
    const pier = opts.endB ? null : sty.pier;
    if (pier === 'banner' || pier === 'spout') {   // spout piers carry a banner above the lion head
      // r3 (props audit): pick the spot on the pier where the cloth hangs closest to the rock without cutting into it
      const bw = 1.6, bh = 4.4 + (sty.bannerLong ? 1.4 : 0);
      let best = null;
      for (const ds of [0, -0.35, 0.35, -0.7, 0.7]) for (const y0 of [sh.crown + 0.6, sh.crown + 1.2, sh.crown + 0.1]) {
        const sv = svP + ds;
        let dMax = -9;
        for (const fu of [-0.5, 0, 0.5]) for (const fv of [0, 0.35, 0.7, 1]) dMax = Math.max(dMax, surf(sv + fu * bw, y0 - fv * bh));
        const dC = surf(sv, y0 - bh * 0.3);
        const gap = dMax + 0.12 - dC;
        if (!best || gap < best.gap) best = { gap, sv, y0, off: dMax + 0.12 };
      }
      const uB = Math.asin(Math.max(-1, Math.min(1, best.sv / Rf))) / D2R;
      ctx.slots.banner.push({ pos: W(uB, best.y0, Rf + side * best.off), facing: sh.facing, size: [bw, bh], tag: 'rings-shed', ...(sty.bannerStyle ? { style: sty.bannerStyle } : {}) });
    }
    if (pier === 'spout' && lod <= 1) {
      // gilt lion-head spout on a white panel low on the pier, pouring into the water (water module: registry.spouts)
      const yc = 2.9, Fp = pierFrame(yc + 0.4, 1.3, 2.2);
      const Wp = S.get('white', mid[0], mid[2]);
      Wp.aux = [0, 0.3, 0, AUX_ASHLAR(0.6)];
      chamferBox(Wp, Fp, -0.68, 0.68, yc - 0.9, yc + 1.5, -0.6, 0.12, 0.04, [0.95, 0.93, 0.9]);
      chamferBox(Wp, Fp, -0.85, 0.85, yc + 1.5, yc + 1.75, -0.6, 0.22, 0.03, [0.95, 0.93, 0.9]);
      Wp.aux = [0, 0, 0, 0];
      chamferBox(G, Fp, -0.38, 0.38, yc - 0.3, yc + 0.5, 0.1, 0.5, 0.1, [1, 1, 1]);
      chamferBox(G, Fp, -0.5, 0.5, yc + 0.25, yc + 0.75, 0.05, 0.32, 0.12, [1, 1, 1]);
      chamferBox(G, Fp, -0.12, 0.12, yc - 0.2, yc - 0.05, 0.4, 0.68, 0.03, [1, 1, 1]);
      const sp = Fp.p(0, yc - 0.12, 0.7);
      (ctx.shedSpouts ||= []).push({ pos: sp, dir: sh.facing, width: 0.35, flow: 0.45, kind: 'spout', id: `rings-shed-${e.id}-${sh.index}` });
    } else if (pier === 'niche' && lod <= 1) {
      // arched statue niche in the spandrel (white frame, dark void, gilt shell hood) + statue slot
      const yc = ys + ra * 0.62, nw = 1.35, nh = 2.9, Fp = pierFrame(yc, nw + 0.6, nh + 0.6);
      const Wp = S.get('white', mid[0], mid[2]);
      Wp.aux = [0, 0.35, 0, AUX_ASHLAR(0.6)];
      const yb0 = yc - nh / 2, rN = nw / 2, ysN = yc + nh / 2 - rN;
      chamferBox(Wp, Fp, -nw / 2 - 0.3, -nw / 2, yb0 - 0.35, ysN, -0.6, 0.18, 0.03, [0.95, 0.93, 0.9]);
      chamferBox(Wp, Fp, nw / 2, nw / 2 + 0.3, yb0 - 0.35, ysN, -0.6, 0.18, 0.03, [0.95, 0.93, 0.9]);
      chamferBox(Wp, Fp, -nw / 2 - 0.45, nw / 2 + 0.45, yb0 - 0.55, yb0, -0.6, 0.42, 0.03, [0.95, 0.93, 0.9]);
      for (let i = 0; i < 8; i++) {
        const a0 = Math.PI - (Math.PI * i) / 8, a1 = Math.PI - (Math.PI * (i + 1)) / 8;
        const P = (a, rr, d) => Fp.p(Math.cos(a) * rr, ysN + Math.sin(a) * rr, d);
        Wp.quadOut(P(a0, rN, 0.18), P(a1, rN, 0.18), P(a1, rN + 0.3, 0.18), P(a0, rN + 0.3, 0.18), [0.95, 0.93, 0.9], Fp.p(0, ysN, -0.5));
        Wp.quadOut(P(a0, rN + 0.3, 0.18), P(a1, rN + 0.3, 0.18), P(a1, rN + 0.3, -0.6), P(a0, rN + 0.3, -0.6), [0.95, 0.93, 0.9], Fp.p(0, ysN, -0.5));
        V.polyToward([Fp.p(0, ysN, 0.02), P(a0, rN, 0.02), P(a1, rN, 0.02)], [1, 1, 1], Fp.az);
        G.polyToward([Fp.p(0, ysN, 0.06), P(a0, rN * 0.85, 0.06 + 0.12 * Math.sin(a0)), P(a1, rN * 0.85, 0.06 + 0.12 * Math.sin(a1))], [1, 1, 1], Fp.az);
      }
      V.quadToward(Fp.p(-rN, yb0, 0.02), Fp.p(rN, yb0, 0.02), Fp.p(rN, ysN, 0.02), Fp.p(-rN, ysN, 0.02), [1, 1, 1], Fp.az);
      Wp.aux = [0, 0, 0, 0];
      ctx.engine.slots.statue.push({ pos: Fp.p(0, yb0, 0.12), facing: sh.facing, size: 2.3, tag: 'shed-niche', source: 'rings-shed-niche' });
    } else if (pier === 'lamp' && lod <= 1) {
      // two gilt bracket lamps flanking a gilt trident roundel on the pier (flames: props lamp slots)
      const yc = ys + 0.4, Fp = pierFrame(yc + 1.5, 1.6, 3.2);
      const Fm = new Frame(Fp.p(0, yc + 2.4, 0.04), Fp.ax, Fp.az, mul3(Fp.ay, -1));
      lathe(G, Fm, 0, 0, 0, [[0.62, -0.3], [0.62, 0.04], [0.52, 0.1], [0.25, 0.12], [0, 0.15]], 16, [1, 1, 1]);
      for (const sx of [-0.55, 0.55]) {
        const Fl = Fp.at(sx, yc, 0);
        box(G, Fl, -0.06, 0.06, -0.06, 0.06, -0.1, 0.62, [1, 1, 1]);
        lathe(G, Fl, 0, 0, 0.62, [[0, -0.32], [0.1, -0.3], [0.08, -0.12], [0.26, 0.0], [0.3, 0.08], [0, 0.04]], 10, [1, 1, 1]);
        ctx.slots.lamp.push({ pos: Fl.p(0, 0.08, 0.62), size: 0.3, tag: 'rings-shed-pier' });
      }
    }
    // ivy / shrubs: per bay (mole: own tag per bay → no filler curtains between them; ring sheds: every third, as r4)
    const ivyOn = sty.ivy != null ? sty.ivy > 0.3 : sh.index % 3 === 0;
    if (ivyOn) {
      const uI = sty.ivy != null ? halfDeg * (sty.ivy > 0.6 ? -0.45 : 0.62) : halfDeg * 0.6;
      const pv = W(uI, yT, Rf);
      const dI = Math.max(0, rockDisp(pv[0], yT, pv[2], e)[0] * 0.55);
      const tag = sty.ivy != null ? `rings-shed-rock b${e.id}${sh.index}` : 'rings-shed-rock';
      ctx.slots.ivy.push({ pos: W(uI, yT + crest(pv[0], pv[2]) - 0.3, Rf + side * (dI + 0.3)), facing: sh.facing, size: sty.ivy != null ? 3 + 6 * sty.ivy : 4 + 3 * rng.random(), tag });
      if (sty.ivy != null && sty.ivy > 0.7) {
        // a second curtain over the arch crown (spills onto the archivolt)
        const pc = W(halfDeg * 0.08, yT, Rf), dc = Math.max(0, rockDisp(pc[0], yT, pc[2], e)[0] * 0.55);
        ctx.slots.ivy.push({ pos: W(halfDeg * 0.08, yT + crest(pc[0], pc[2]) - 0.3, Rf + side * (dc + 0.3)), facing: sh.facing, size: 3.2 + 2 * sty.ivy, tag: tag + 'c' });
      }
    }
    if (sty.shrub) {
      const tree = (ctx.engine.slots.tree ||= []);
      for (const fu of sty.shrub) {
        const rr = Rf + (R0 - side * (Math.abs(e.faceR - e.wallR) + 0.2) - Rf) * 0.3;
        const pw = W(halfDeg * fu, 0, rr), cr = crest(pw[0], pw[2]);
        tree.push({ pos: [pw[0], yT + cr * 0.7 + 0.25, pw[2]], tag: 'shrub', size: 1.6 + 1.4 * Math.abs(fu), source: 'rings-shed-crest' });
      }
    }
  } else {
    ctx.slots.coral.push({ pos: W(halfDeg * 0.9, ys + 1, Rf + side * 0.4), normal: Fb.az, size: 1.5, tag: 'rings-shed' });
    ctx.slots.coral.push({ pos: W(0, yT + 0.2, (Rf + R0) / 2), normal: [0, 1, 0], size: 2.5, tag: 'rings-shed-top' });
  }
}

/** per-bay style: sh.style (hand-set, shed mole) or hashed from the bearing (ring sheds) */
const ARCHES = ['plain', 'banded', 'gilt', 'rustic', 'plain'];
const PIERS = ['banner', 'spout', 'banner', 'niche', 'lamp', 'banner'];
export function bayStyle(sh, eid = '') {
  if (sh.style) return sh.style;
  const kb = Math.round((sh.bearing || 0) * 100), j = eid.length * 37 + (eid.charCodeAt(eid.length - 1) || 0);
  const h = (q) => hash2(kb + q * 7919, j + q * 104729);
  return { arch: ARCHES[Math.floor(h(1) * ARCHES.length)], pier: PIERS[Math.floor(h(2) * PIERS.length)], lampN: 2 + Math.floor(h(3) * 1.99), lampGain: 0.75 + 0.8 * h(4), ribs: h(5) < 0.5, lanterns: h(6) < 0.55, tint: [0.88 + 0.2 * h(8), 0.88 + 0.17 * h(8), 0.86 + 0.14 * h(8)] };
}

/** build all ship-sheds and the solid piers between their groups: returns { count, ledges } */
export function buildSheds(ctx, edges = ctx.plan.edges, sheds = ctx.plan.sheds, fillers = ctx.plan.shedFillers) {
  let count = 0;
  const ledges = [];
  for (const e of edges) {
    const list = sheds.filter((s) => s.edge === e.id);
    if (!list.length) continue;
    const fill = fillers.filter((f) => f.edge === e.id);
    // every bay (shed or filler) sorted by bearing; caps where the neighbour is missing
    const all = [...list.map((s) => ({ s, b: s.bearing, h: s.halfDeg })), ...fill.map((f) => ({ f, b: f.bearing, h: f.halfDeg }))].sort((a, b) => a.b - b.b);
    for (let i = 0; i < all.length; i++) {
      const it = all[i], prev = all[i - 1], next = all[i + 1];
      const endA = !prev || Math.abs(prev.b + prev.h - (it.b - it.h)) > 1e-3;
      const endB = !next || Math.abs(it.b + it.h - (next.b - next.h)) > 1e-3;
      if (it.s) {
        shedBay(ctx, e, it.s, it.h, { endA, endB });
        count++;
        ledges.push({ edge: e.id, bearing: it.s.bearing, r0: Math.min(it.s.faceR, it.s.frontR), r1: Math.max(it.s.faceR, it.s.frontR), y: e.landY });
      } else {
        shedBay(ctx, e, { bearing: it.b, faceR: e.faceR, crown: 0, index: -1, facing: 0 }, it.h, { solid: true, endA, endB });
      }
    }
  }
  return { count, ledges };
}
