// Ship-sheds (ref 4): rows of arched openings cut into the rock faces of the land rings at water level,
// each a vaulted, lamp-lit dock with a slipway for one trireme. The rock-cut block projects SHED.depth m
// in front of the ring face; its top is a planted ledge below the curtain wall. Merged chunked geometry
// (every bay has its own rock displacement — world-space noise, nothing repeats).
import { Frame, chamferBox, box, FACES, AUX_ASHLAR, mul3 } from './geo.js';
import { polarXZ, SHED } from './plan.js';
import { noiseA, noiseB } from '../core/noise.js';
import { ruined, ruinRand } from '../world/era.js';
import * as TF from '../terrain/field.js';

const D2R = Math.PI / 180;

/** radial rock displacement (m, toward the water) at a world point + crevice depth → [d, cav].
 *  r2 (ref 4): rounded limestone crag masses (vertical karst lumps ≈ 3 × 4.5 m) with deep dark crevices
 *  between them, a broad bulge field, a little of the terrain face field (src/terrain/field.js) for joints. */
function hash2(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function crag(su, y) {
  // 2D cellular in (along-face metres, height); jittered cells, F1 / F2 + cell id
  const cx = su / 3.3, cy = y / 4.6 + 0.35 * noiseB.noise2(su * 0.05, 1.7);
  const ix = Math.floor(cx), iy = Math.floor(cy);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = ix + i, gy = iy + j;
    const ox = gx + 0.15 + 0.7 * hash2(gx, gy), oy = gy + 0.15 + 0.7 * hash2(gx + 71, gy - 13);
    const dx = (ox - cx), dy = (oy - cy) * 1.0;
    const dd = Math.hypot(dx, dy);
    if (dd < f1) { f2 = f1; f1 = dd; id = hash2(gx - 5, gy + 9); } else if (dd < f2) f2 = dd;
  }
  return [f1, f2, id];
}
function rockDisp(x, y, z, e) {
  const su = e && e.su ? e.su(x, z) : Math.atan2(x, -z) * 300;             // ≈ metres along the face (continuous across bays)
  const [f1, f2, id] = crag(su, y);
  const gap = f2 - f1;
  const crev = 1 - Math.min(1, gap / 0.3);
  const lump = 1.9 * (0.62 - f1) * (0.7 + 0.6 * id) - 1.3 * crev * crev;
  const t = TF.rockDisp(x, y, z, 0.12);
  const mass = Math.max(0, noiseA.fbm3(x * 0.04, y * 0.05, z * 0.04, 2) + 0.15) * 1.4;
  const fine = 0.12 * noiseB.noise3(x * 0.9, y * 0.9, z * 0.9);
  const cav = Math.min(1, Math.max(0, crev * 0.9 + TF.CAV * 0.3));
  const k = e && e.rockAmp != null ? e.rockAmp : 1;   // r3: shed mole = flatter dressed-rock face (front-lit in shot 4)
  return [Math.max(-1.4 * k, Math.min(3.6 * k, 0.7 * k + (lump + mass) * k + t + fine)), cav * (0.5 + 0.5 * k)];
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
  const ra = SHED.clear / 2, ys = sh.crown - ra;
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
  const cs = lod === 0 ? 0.75 : lod === 1 ? 1.2 : 2.2;
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
  // ---- dressed arch: jambs, voussoirs, gilt keystone
  const Ff = Fb.at(0, 0, DEP);
  const Wt = S.get('white', mid[0], mid[2]), G = S.get('gilt', mid[0], mid[2]);
  const ring = 0.85;
  Wt.aux = [0, 0.4, 0, AUX_ASHLAR(0.6)];
  let y = -0.8, k = 0;
  while (y < ys - 0.02) {
    const hh = Math.min(ys - y, k % 2 ? 0.55 : 0.8);
    for (const sx of [-1, 1]) {
      const wide = (k + (sx > 0 ? 1 : 0)) % 2 ? ring * 1.2 : ring * 0.8;
      const a = sx < 0 ? -ra - wide : ra, c = sx < 0 ? -ra : ra + wide;
      chamferBox(Wt, Ff, a, c, y, y + hh, -1.2, 0.35, lod <= 1 ? 0.04 : 0, [0.92 + 0.06 * rng.random(), 0.9, 0.86], FACES.pz | FACES.px | FACES.nx | FACES.py | FACES.ny);
    }
    y += hh; k++;
  }
  for (const sx of [-1, 1]) chamferBox(G, Ff, sx < 0 ? -ra - ring * 1.3 : ra - 0.1, sx < 0 ? -ra + 0.1 : ra + ring * 1.3, ys - 0.25, ys, -1.2, 0.45, 0.03, [1, 1, 1]);
  const nv = lod === 0 ? 17 : 11;
  for (let i = 0; i < nv; i++) {
    const a0 = Math.PI - (Math.PI * i) / nv, a1 = Math.PI - (Math.PI * (i + 1)) / nv;
    const key = i === (nv - 1) / 2;
    const B = key ? G : Wt;
    const R1 = ra + ring * (key ? 1.35 : 1), dF = key ? 0.55 : 0.35;
    const g = 0.012;
    const P = (a, rr, d) => Ff.p(Math.cos(a) * rr, ys + Math.sin(a) * rr, d);
    const c = key ? [1, 1, 1] : [0.92 + 0.06 * rng.random(), 0.9, 0.86];
    const ctr = Ff.p(Math.cos((a0 + a1) / 2) * (ra + R1) / 2, ys + Math.sin((a0 + a1) / 2) * (ra + R1) / 2, -0.4);
    B.quadOut(P(a0 - g, ra, dF), P(a1 + g, ra, dF), P(a1 + g, R1, dF), P(a0 - g, R1, dF), c, ctr);
    B.quadOut(P(a0 - g, R1, dF), P(a1 + g, R1, dF), P(a1 + g, R1, -1.2), P(a0 - g, R1, -1.2), c, ctr);
    B.quadOut(P(a0 - g, ra, -1.2), P(a1 + g, ra, -1.2), P(a1 + g, ra, dF), P(a0 - g, ra, dF), [0.75, 0.73, 0.7], Ff.p(0, ys, 0));
    B.quadOut(P(a0 - g, ra, dF), P(a0 - g, R1, dF), P(a0 - g, R1, -1.2), P(a0 - g, ra, -1.2), c, ctr);
    B.quadOut(P(a1 + g, R1, dF), P(a1 + g, ra, dF), P(a1 + g, ra, -1.2), P(a1 + g, R1, -1.2), c, ctr);
  }
  Wt.aux = [0, 0, 0, 0];
  // ---- interior: side walls, vault, back wall, slipway (lamp glow baked in aux.z)
  const I = S.get('interior', mid[0], mid[2]);
  const dBack = -BACK, dFront = DEP - 1.2;
  const lamps = [];
  const lampD = e.shedLamps || [DEP - 4.5, DEP - 11.5, DEP - 23];
  for (const dl of lampD) for (const sx of [-1, 1]) lamps.push([sx * (ra - 0.4), ys - 0.6, dl]);
  const gain = e.lampGain ?? 1;
  const glow = (p) => { let g = 0; for (const l of lamps) { const d2 = (p[0] - l[0]) ** 2 + (p[1] - l[1]) ** 2 + (p[2] - l[2]) ** 2; g += 2.2 * gain / (1 + d2 * 0.35 / gain); } return g; };
  const nd = lod === 0 ? 12 : 6;
  const IQ = (a, b2, c, d, n) => {
    // local points → world, aux.z from the glow at each vertex (one quad = constant aux; subdivided enough)
    const mc = [(a[0] + b2[0] + c[0] + d[0]) / 4, (a[1] + b2[1] + c[1] + d[1]) / 4, (a[2] + b2[2] + c[2] + d[2]) / 4];
    I.aux = [0, 0, broken ? 0 : glow(mc), 0];
    I.quadToward(Fb.p(...a), Fb.p(...b2), Fb.p(...c), Fb.p(...d), [1, 1, 1], Fb.dir(...n));
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
    // tie beams across the dock
    if (lod <= 1) for (const dd of [-14, -6, 1.5, 6.5, 11].map((v) => v + DEP - SHED.depth)) box(Wd, Fb, -ra, ra, ys - 0.35, ys - 0.05, dd - 0.15, dd + 0.15, [0.9, 0.9, 0.9], FACES.py | FACES.ny | FACES.pz | FACES.nz);
    // lamps (emissive) on iron brackets
    const Lp = S.get('lamp', mid[0], mid[2]);
    for (const l of lamps) {
      const Fl = Fb.at(l[0], l[1], l[2]);
      box(Lp, Fl, -0.14, 0.14, -0.2, 0.14, -0.14, 0.14, [1, 1, 1]);
      if (lod === 0) ctx.slots.lamp.push({ pos: Fl.p(0, 0.15, 0), size: 0.22, tag: 'rings-shed' });
    }
  }
  // ---- slots + registry
  sh.slotPos = Fb.p(0, 0, DEP - 0.5);
  if (!ctx.sunken) {
    // banners between the arches (on the rock, hung from iron rods)
    if (sh.index % 2 === 0) {
      // r3 (props audit): sample the real rock surface (same clamps as the face grid) over the banner area and
      // pick the spot on the pier where the cloth hangs closest to the rock without cutting into it
      const surf = (sv, y) => {
        const uu = Math.asin(Math.max(-1, Math.min(1, sv / Rf))) / D2R, p = W(uu, y, Rf);
        let d = rockDisp(p[0], y, p[2], e)[0];
        const dOpen = y <= ys ? Math.abs(Math.abs(sv) - ra) : Math.abs(Math.hypot(sv, y - ys) - ra);
        if (dOpen < 3.5) d = Math.min(d, -0.2 + 0.55 * dOpen);
        return d;
      };
      const svP = Rf * Math.sin(halfDeg * D2R), bw = 1.6, bh = 4.4;
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
      ctx.slots.banner.push({ pos: W(uB, best.y0, Rf + side * best.off), facing: sh.facing, size: [bw, bh], tag: 'rings-shed' });
    }
    if (sh.index % 3 === 0) {
      const pv = W(halfDeg * 0.6, yT, Rf);
      const dI = Math.max(0, rockDisp(pv[0], yT, pv[2], e)[0] * 0.55);
      ctx.slots.ivy.push({ pos: W(halfDeg * 0.6, yT + crest(pv[0], pv[2]) - 0.3, Rf + side * (dI + 0.3)), facing: sh.facing, size: 4 + 3 * rng.random(), tag: 'rings-shed-rock' });
    }
  } else {
    ctx.slots.coral.push({ pos: W(halfDeg * 0.9, ys + 1, Rf + side * 0.4), normal: Fb.az, size: 1.5, tag: 'rings-shed' });
    ctx.slots.coral.push({ pos: W(0, yT + 0.2, (Rf + R0) / 2), normal: [0, 1, 0], size: 2.5, tag: 'rings-shed-top' });
  }
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
