// Italian cypress (Cupressus sempervirens 'Stricta') generator — the signature tree.
// A tree is a flame-shaped surface of revolution (with per-tree lean, ellipticity, bulges and a
// bent tip) covered by many upward-pointing foliage clumps (teardrop blobs textured with dense
// scale-leaf foliage) and, at the hero LOD, alpha-tested spray cards that give the ragged,
// fuzzy silhouette and fine texture. All LODs are built from the same parameters so they match.
//
//   buildCypress(seed, style) → { H, R, lods: [ {blob, card}, {blob}, {blob}, {blob} ] }
//   (geometry at the nominal height H metres; instances scale it)
import { GeoBuilder, v3, rotAxis, clamp, lerp, smoothstep, cellRect, addBlob, addCard, addTube } from './util.js';
import { CYP, GRID } from './atlas.js';
import { Simplex } from '../core/noise.js';
import { RNG, hashString } from '../core/rng.js';

export const CYPRESS_STYLES = ['classic', 'pencil', 'flame', 'old', 'classic', 'young', 'pencil', 'flame'];

function params(rng, style) {
  const P = {
    style,
    H: rng.range(15, 19),
    rr: rng.range(0.062, 0.074),     // max radius / height (lumps + cards add ~25%)
    uMax: rng.range(0.2, 0.3),
    base: rng.range(0.4, 0.65),
    tipPow: rng.range(0.8, 1.05),
    trunk: rng.chance(0.55) ? rng.range(0.02, 0.06) : 0,
    lean: rng.range(0, 0.25),         // whole-tree lean (m per 10 m of height)
    leanA: rng.range(0, Math.PI * 2),
    tipBend: rng.range(0.1, 0.6),     // tip deviation (m)
    tipA: rng.range(0, Math.PI * 2),
    ell: rng.range(0.84, 1.0), ellA: rng.range(0, Math.PI),
    bulge: rng.range(0.05, 0.11),
    lumpy: rng.range(0.9, 1.15),
    gaps: 0,
  };
  if (style === 'pencil') { P.rr = rng.range(0.05, 0.06); P.uMax = rng.range(0.2, 0.3); P.tipPow = rng.range(0.7, 0.85); P.H = rng.range(17, 20); }
  if (style === 'flame') { P.rr = rng.range(0.078, 0.09); P.uMax = rng.range(0.14, 0.22); P.tipPow = rng.range(1.0, 1.25); P.base = rng.range(0.6, 0.85); }
  if (style === 'old') { P.rr = rng.range(0.07, 0.082); P.trunk = rng.range(0.04, 0.08); P.bulge = rng.range(0.12, 0.18); P.lumpy = 1.3; P.gaps = 0.18; P.tipBend = rng.range(0.35, 0.8); }
  if (style === 'young') { P.H = rng.range(10, 12); P.rr = rng.range(0.075, 0.085); P.bulge = 0.05; P.lumpy = 0.8; P.trunk = 0; }
  P.R = P.H * P.rr;
  P.y0 = P.trunk * P.H;                // where the foliage starts
  return P;
}

export function buildCypress(seed, style = 'classic', opts = {}) {
  const rng = new RNG('cypress:' + seed + ':' + style);
  const nz = new Simplex(hashString('cypN' + seed));
  const P = params(rng, style);
  const { H, R, y0 } = P;
  const Hf = H - y0;
  const lean = [Math.cos(P.leanA) * P.lean * H / 10, Math.sin(P.leanA) * P.lean * H / 10];
  const tip = [Math.cos(P.tipA) * P.tipBend, Math.sin(P.tipA) * P.tipBend];
  const wob = (u, k) => 0.12 * nz.noise2(u * 3.0, k * 7.1 + 3.3);

  // ---- shape functions (u = 0 at the foliage base .. 1 at the tip)
  const prof = (u) => {
    if (u <= 0) return R * P.base;
    if (u >= 1) return 0;
    let f;
    if (u < P.uMax) f = P.base + (1 - P.base) * Math.pow(Math.sin(0.5 * Math.PI * u / P.uMax), 0.7);
    else { const t = (u - P.uMax) / (1 - P.uMax); f = Math.pow(1 - t, P.tipPow) * (1 + 0.35 * t * (1 - t)); }
    f *= 1 + P.bulge * nz.noise2(u * 5.0, 1.7 + seed * 0.37);
    return R * f;
  };
  const axis = (u) => {
    const y = y0 + u * Hf;
    const lu = y / H;
    const tb = Math.pow(Math.max(0, (u - 0.6) / 0.4), 2.2);
    return [lean[0] * lu + tip[0] * tb + wob(u, 1), y, lean[1] * lu + tip[1] * tb + wob(u, 2)];
  };
  const ellK = (th) => {
    const a = th - P.ellA;
    return 1 / Math.sqrt(Math.cos(a) ** 2 + (Math.sin(a) / P.ell) ** 2);
  };
  const lump = (th, u, amp) => 1 + amp * (0.55 * nz.noise3(Math.cos(th) * 1.1, Math.sin(th) * 1.1, u * Hf * 0.22) + 0.3 * nz.noise3(Math.cos(th) * 2.4, Math.sin(th) * 2.4, u * Hf * 0.55 + 9) + 0.15 * nz.noise3(Math.cos(th) * 5, Math.sin(th) * 5, u * Hf * 1.4 + 3));
  const rAt = (th, u, amp = 0.0) => prof(u) * ellK(th) * (amp ? lump(th, u, amp) : 1);
  // outward surface normal of the envelope at (th, u)
  const envNormal = (th, u) => {
    const e = 0.01;
    const dr = (rAt(th, Math.min(1, u + e)) - rAt(th, Math.max(0, u - e))) / (2 * e * Hf);
    return v3.norm([Math.cos(th), -dr + 0.08, Math.sin(th)]);
  };
  // normal of the lumpy surface r(th, u) = rAt(th, u, amp) (mid-scale shading at distance), mixed with the envelope
  const lumpyNormal = (th, u, amp) => {
    const e = 0.04, eu = 0.25 / Hf;
    const P0 = (t, v) => { const a = axis(v), r = rAt(t, v, amp); return [a[0] + Math.cos(t) * r, a[1], a[2] + Math.sin(t) * r]; };
    const dT = v3.sub(P0(th + e, u), P0(th - e, u));
    const dU = v3.sub(P0(th, Math.min(1, u + eu)), P0(th, Math.max(0, u - eu)));
    let n = v3.norm(v3.cross(dU, dT));
    const en = envNormal(th, u);
    if (v3.dot(n, en) < 0) n = v3.mul(n, -1);
    return v3.norm(v3.add(v3.mul(n, 0.7), v3.mul(en, 0.5)));
  };
  // "bent" normal for an arbitrary point: envelope normal of its (angle, height)
  const bentAt = (p) => {
    const u = clamp((p[1] - y0) / Hf, 0, 1);
    const a = axis(u);
    const th = Math.atan2(p[2] - a[2], p[0] - a[0]);
    const rn = Math.hypot(p[0] - a[0], p[2] - a[2]) / Math.max(0.05, prof(u));
    const n = envNormal(th, u);
    // points near the axis get a more upward normal (avoid harsh inner shading)
    return v3.norm(v3.lerp([0, 1, 0], n, clamp(rn * 1.3, 0.25, 1)));
  };

  const patch = cellRect(CYP.patch[(seed >>> 0) % 2], GRID, 0.08);
  const patchDark = cellRect(CYP.patchDark, GRID, 0.08);
  const barkRect = cellRect(CYP.bark, GRID, 0.05);

  // ---- clump layout (shared by hero + mid with different densities)
  function layoutClumps(sizeK, rngL, fill) {
    const out = [];
    let u = 0.0;
    let ring = 0;
    while (u < 0.985) {
      const r = prof(u);
      const sz = lerp(0.36, 0.95, clamp(r / R, 0, 1)) * sizeK * (H / 17) ** 0.5;
      const n = Math.max(3, Math.round((2 * Math.PI * Math.max(r, 0.15)) / (sz * 1.05)));
      const off = rngL.random() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        if (P.gaps && rngL.chance(P.gaps * (1 - u))) continue;
        const th = off + (i + rngL.range(-0.3, 0.3)) / n * Math.PI * 2;
        const uu = clamp(u + rngL.range(-0.4, 0.4) * sz / Hf, 0, 0.99);
        const s = sz * rngL.range(0.82, 1.2);
        const rc = rAt(th, uu, 0.12 * P.lumpy) * rngL.range(0.7, 0.92);
        out.push({ th, u: uu, s, rc, rnd: rngL.random(), outer: true });
      }
      // inner filler clumps (darker) so gaps never show through
      if (fill) {
        const ni = Math.max(2, Math.round(n * 0.35));
        for (let i = 0; i < ni; i++) {
          const th = rngL.random() * Math.PI * 2;
          out.push({ th, u: clamp(u + rngL.range(-0.3, 0.3) * sz / Hf, 0, 0.97), s: sz * 1.1, rc: prof(u) * rngL.range(0.3, 0.5), rnd: rngL.random(), outer: false });
        }
      }
      u += (sz * 0.62) / Hf;
      ring++;
    }
    return out;
  }

  function emitClump(gb, c, seg, aoK = 1, tipK = 1) {
    const a = axis(c.u);
    const radial = [Math.cos(c.th), 0, Math.sin(c.th)];
    const center = [a[0] + radial[0] * c.rc, a[1], a[2] + radial[2] * c.rc];
    const envN = envNormal(c.th, c.u);
    // clump axis: mostly up, leaning outward like the envelope, + jitter
    const tilt = 0.18 + 0.25 * c.rnd + 0.5 * (envN[1] > 0 ? envN[1] : 0);
    let ax = v3.norm([radial[0] * tilt, 1, radial[2] * tilt]);
    const tang = [-radial[2], 0, radial[0]];
    ax = rotAxis(ax, radial, (c.rnd - 0.5) * 0.5);
    const b1 = v3.norm(v3.cross(ax, radial));
    const b2 = v3.cross(b1, ax);
    const ra = c.s * (0.95 + 0.35 * c.rnd), r1 = c.s * 0.58, r2 = c.s * 0.46;
    const depthK = clamp(c.rc / Math.max(0.1, prof(c.u)), 0, 1);
    addBlob(gb, center, ax, b1, b2, ra, r1, r2, {
      lon: seg[0], lat: seg[1], rect: c.outer ? patch : patchDark, pointy: c.pointy ?? 0.3, seed: c.rnd * 10,
      normalFn: (p, nl) => v3.norm(v3.add(v3.mul(nl, 0.5), v3.mul(bentAt(p), 0.62))),
      fol: (p, nl, ph) => {
        const out = v3.dot(nl, envN);
        const ao = aoK * (c.outer ? 0.45 + 0.55 * depthK * depthK : 0.18) * (0.5 + 0.5 * smoothstep(-0.7, 0.7, out)) * (0.72 + 0.28 * ph);
        const tipF = c.outer ? tipK * aoK * smoothstep(0.45, 1.0, ph) * smoothstep(-0.2, 0.8, out) : 0;
        return [ao, tipF, c.rnd, clamp((p[1]) / H, 0, 1)];
      },
    });
    return { center, ax, radial, envN, tang, ra, r1, r2 };
  }

  function emitCore(gb, radial, rings, scale, rect, aoV) {
    const ids = [];
    for (let j = 0; j <= rings; j++) {
      const u = j / rings * 0.97;
      const a = axis(u);
      const row = [];
      for (let i = 0; i <= radial; i++) {
        const th = i / radial * Math.PI * 2;
        const r = rAt(th, u) * scale;
        const p = [a[0] + Math.cos(th) * r, a[1], a[2] + Math.sin(th) * r];
        const n = envNormal(th, u);
        row.push(gb.v(p[0], p[1], p[2], n[0], n[1], n[2], lerp(rect[0], rect[2], i / radial), lerp(rect[3], rect[1], u), aoV, 0, 0.5, clamp(p[1] / H, 0, 1)));
      }
      ids.push(row);
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < radial; i++) gb.quad(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i]);
    // closing cap at the tip
    const a = axis(1);
    const t = gb.v(a[0], a[1], a[2], 0, 1, 0, rect[0], rect[1], aoV, 0, 0.5, 1);
    for (let i = 0; i < radial; i++) gb.tri(ids[rings][i], ids[rings][i + 1], t);
    // bottom cap (seen from below on slopes)
    const b = axis(0);
    const bi = gb.v(b[0], b[1], b[2], 0, -1, 0, rect[0], rect[3], aoV * 0.5, 0, 0.5, 0);
    for (let i = 0; i < radial; i++) gb.tri(ids[0][i + 1], ids[0][i], bi);
  }

  function emitTrunk(gb, radial) {
    const top = y0 + Math.min(2.5, Hf * 0.25);
    const pts = [], rad = [];
    const r0 = clamp(H * 0.012, 0.12, 0.28);
    for (let k = 0; k <= 4; k++) {
      const y = -0.8 + (top + 0.8) * k / 4;
      const u = clamp((y - y0) / Hf, 0, 1);
      const a = axis(u);
      pts.push([a[0] * (y > y0 ? 1 : y / Math.max(0.1, y0)), y, a[2] * (y > y0 ? 1 : y / Math.max(0.1, y0))]);
      rad.push(r0 * (k === 0 ? 1.35 : 1 - 0.25 * k / 4));
    }
    addTube(gb, pts, rad, { radial, rect: barkRect, fol: (t) => [0.55, 0, 0.5, 0] });
  }

  // ---- shingled spray cards over the envelope (outer layer + darker inner layer)
  function emitShingles(cards, rL, o) {
    let u = o.u0 ?? 0.0;
    while (u < 0.985) {
      const r = prof(u);
      const ch = lerp(o.hMin, o.hMax, clamp(r / R, 0, 1)) * (H / 17) ** 0.5;
      const n = Math.max(3, Math.round((2 * Math.PI * Math.max(r * o.rk, 0.12)) / (ch * o.spacing)));
      const off = rL.random() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        if (P.gaps && rL.chance(P.gaps * 0.5 * (1 - u))) continue;
        const th = off + (i + rL.range(-0.35, 0.35)) / n * Math.PI * 2;
        const uu = clamp(u + rL.range(-0.3, 0.3) * ch / Hf, 0, 0.995);
        const a = axis(uu);
        const rj = rL.range(o.rj ? o.rj[0] : 0.88, o.rj ? o.rj[1] : 1.04);
        const rr = rAt(th, uu, 0.34 * P.lumpy) * o.rk * rj;
        const p = [a[0] + Math.cos(th) * rr, a[1], a[2] + Math.sin(th) * rr];
        const nE = envNormal(th, uu);
        let up = v3.norm(v3.sub([0, 1, 0], v3.mul(nE, nE[1])));
        up = rotAxis(up, nE, rL.range(-0.3, 0.3));
        up = v3.norm(v3.mad(up, nE, rL.range(o.tilt[0], o.tilt[1])));
        let side = v3.norm(v3.cross(up, nE));
        side = rotAxis(side, up, rL.range(-0.6, 0.6));
        const h = ch * rL.range(0.85, 1.15) * (uu > 0.9 ? 0.75 : 1);
        const w = h * rL.range(o.wk ? o.wk[0] : 0.55, o.wk ? o.wk[1] : 0.75);
        const org = v3.mad(p, up, -h * 0.42);
        const rect = cellRect(CYP.sprays[Math.floor(rL.random() * CYP.sprays.length)], GRID, 0.0);
        const rnd = rL.random();
        const nfn = (q) => v3.norm(v3.add(bentAt(q), v3.mul(up, 0.35)));
        const ffn = (q, t) => [(o.ao0 + o.ao1 * t) * (0.75 + 0.25 * clamp((rj - 0.85) / 0.3, 0, 1)), o.tip * Math.pow(t, 1.3), rnd, clamp(q[1] / H, 0, 1)];
        addCard(cards, org, up, side, w, h, rect, nfn, ffn, o.bend ? rL.range(0.05, 0.16) : 0, rL.chance(0.5));
        // crossed second card: the tuft keeps its volume when seen edge-on at the silhouette
        if (o.cross) addCard(cards, org, up, rotAxis(side, up, Math.PI / 2 + rL.range(-0.3, 0.3)), w * 0.85, h * 0.95, cellRect(CYP.sprays[Math.floor(rL.random() * CYP.sprays.length)], GRID, 0.0), nfn, ffn, 0, rL.chance(0.5));
      }
      u += (ch * o.vstep) / Hf;
    }
  }

  // ---- explicit tufts: the crown is a mosaic of upward-pointing sprays (≈0.35-0.7 m wide, 0.7-1.5 m
  // tall). Each tuft lights like a small ellipsoid (sunlit top/side, dark creases between tufts), which
  // is what gives a real cypress its scaly, flame-on-flame look.
  const sprayRects = CYP.sprays.map((c) => cellRect(c, GRID, 0.0));
  function layoutTufts(rL, o) {
    const out = [];
    let u = o.u0 ?? 0.0;
    while (u < 0.985) {
      const r = prof(u);
      const w = lerp(o.wMin, o.wMax, clamp(r / R, 0, 1)) * (H / 17) ** 0.5 * (u > 0.88 ? 0.8 : 1);
      const rOut = Math.max(r * o.k[1], 0.1);
      const n = Math.max(3, Math.round((2 * Math.PI * rOut) / (w * o.around)));
      const off = rL.random() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        if (P.gaps && rL.chance(P.gaps * 0.6 * (1 - u))) continue;
        const th = off + (i + rL.range(-0.32, 0.32)) / n * Math.PI * 2;
        const ww = w * rL.range(0.8, 1.2);
        const hh = ww * rL.range(o.hk[0], o.hk[1]);
        const uu = clamp(u + rL.range(-0.3, 0.3) * hh / Hf, 0, 0.99);
        const a = axis(uu);
        const k = rL.range(o.k[0], o.k[1]);
        const lk = lump(th, uu, 1) - 1;                      // big-scale clumping (creases between clumps)
        const rc = rAt(th, uu, 0.12 * P.lumpy) * k * (1 + 0.42 * P.lumpy * lk);
        const radial = [Math.cos(th), 0, Math.sin(th)];
        const tang = [-radial[2], 0, radial[0]];
        const envN = envNormal(th, uu);
        // axis: up, leaning outward with the envelope, small random roll/pitch
        let ax = v3.norm(v3.mad([0, 1, 0], radial, 0.12 + Math.max(0, envN[1]) * 0.9 + rL.range(-0.08, 0.14)));
        ax = rotAxis(ax, radial, rL.range(-0.22, 0.22));
        const cE = [a[0] + radial[0] * (rc - ww * 0.42), a[1], a[2] + radial[2] * (rc - ww * 0.42)];
        out.push({ th, u: uu, w: ww, h: hh, k, rc, radial, tang, envN, ax, cE, rnd: rL.random(), depthK: clamp((k - o.k[0]) / Math.max(0.01, o.k[1] - o.k[0]), 0, 1) * (0.55 + 0.45 * smoothstep(-0.35, 0.3, lk)) });
      }
      u += (w * o.vstep) / Hf;
    }
    return out;
  }
  // ellipsoid-gradient normal of a tuft at p
  const tuftN = (t, p) => {
    const d = v3.sub(p, t.cE);
    const da = v3.dot(d, t.ax);
    const dr = v3.mad(d, t.ax, -da);
    const sr = t.w * 0.55, sa = t.h * 0.5;
    return v3.norm(v3.add(v3.mul(dr, 1 / (sr * sr)), v3.mul(t.ax, da / (sa * sa))));
  };
  const shadeN = (t, p, kT) => v3.norm(v3.add(v3.add(v3.mul(tuftN(t, p), kT), v3.mul(bentAt(p), 1 - kT * 0.6)), [0, 0.1, 0]));

  /** alpha cards of one tuft: an outward-facing card + crossed cards (volume at the silhouette) */
  function emitTuftCards(cards, t, rL, o) {
    const nC = o.cards;
    for (let c = 0; c < nC; c++) {
      const outward = c === 0;
      const rotA = outward ? rL.range(-0.25, 0.25) : (c % 2 ? 1 : -1) * rL.range(0.75, 1.15);
      const side = rotAxis(t.tang, t.ax, rotA);
      const cw = t.w * (outward ? 1.35 : 1.15) * rL.range(0.9, 1.1);
      const ch = t.h * (outward ? 1.2 : 1.05) * rL.range(0.9, 1.1);
      const org = v3.mad(v3.mad(t.cE, t.radial, outward ? t.w * 0.38 : t.w * 0.12), t.ax, -ch * 0.5);
      const rect = sprayRects[Math.floor(rL.random() * sprayRects.length)];
      const ao0 = o.ao0 + o.ao1 * t.depthK;
      addCard(cards, org, t.ax, side, cw, ch, rect,
        (q) => shadeN(t, q, o.kT),
        (q, s) => {
          const out = v3.dot(tuftN(t, q), t.radial);
          return [clamp(ao0 * (0.6 + 0.4 * smoothstep(-0.5, 0.8, out)) * (0.62 + 0.38 * s), 0.04, 1), o.tip * Math.pow(s, 1.4) * smoothstep(-0.2, 0.7, out) * t.depthK, t.rnd, clamp(q[1] / H, 0, 1)];
        }, outward ? rL.range(0.04, 0.14) : 0, rL.chance(0.5));
    }
  }
  /** opaque blob of one tuft (mid LOD) */
  function emitTuftBlob(gb, t, seg, o) {
    const b1 = v3.norm(v3.cross(t.ax, t.radial)), b2 = v3.cross(b1, t.ax);
    const ao0 = o.ao0 + o.ao1 * t.depthK;
    addBlob(gb, v3.mad(t.cE, t.radial, t.w * 0.15), t.ax, b1, b2, t.h * 0.5 * o.inflate, t.w * 0.5 * o.inflate, t.w * 0.55 * o.inflate, {
      lon: seg[0], lat: seg[1], rect: o.rect, pointy: 0.55, seed: t.rnd * 10,
      normalFn: (p, nl) => v3.norm(v3.add(v3.add(v3.mul(nl, o.kT), v3.mul(bentAt(p), 1 - o.kT * 0.6)), [0, 0.1, 0])),
      fol: (p, nl, ph) => {
        const out = v3.dot(nl, t.radial);
        return [clamp(ao0 * (0.55 + 0.45 * smoothstep(-0.6, 0.7, out)) * (0.6 + 0.4 * ph), 0.04, 1), o.tip * smoothstep(0.45, 1.0, ph) * smoothstep(-0.1, 0.8, out) * t.depthK, t.rnd, clamp(p[1] / H, 0, 1)];
      },
    });
  }

  // ================================================================== LOD 0 (hero)
  const lods = [];
  {
    const gb = new GeoBuilder();
    const rL = new RNG('cypL0:' + seed);
    emitTrunk(gb, 7);
    emitCore(gb, 14, 30, 0.62, patchDark, 0.1);
    const cards = new GeoBuilder();
    // inner layer: larger, darker tufts (depth between the outer sprays, never a black hole)
    for (const t of layoutTufts(rL, { wMin: 0.42, wMax: 0.8, k: [0.66, 0.8], around: 1.0, vstep: 0.75, hk: [1.5, 2.0] })) emitTuftCards(cards, t, rL, { cards: 2, ao0: 0.2, ao1: 0.15, tip: 0.1, kT: 0.45 });
    // outer layer: the visible sprays
    for (const t of layoutTufts(rL, { wMin: 0.36, wMax: 0.7, k: [0.86, 1.05], around: 0.78, vstep: 0.6, hk: [1.6, 2.3] })) emitTuftCards(cards, t, rL, { cards: 3, ao0: 0.5, ao1: 0.5, tip: 0.9, kT: 0.62 });
    lods.push({ blob: gb.build(), card: cards.build(), tris: gb.triangles + cards.triangles });
  }
  // ================================================================== LOD 1 (mid)
  {
    const gb = new GeoBuilder();
    const rL = new RNG('cypL1:' + seed);
    if (P.trunk > 0) emitTrunk(gb, 5);
    emitCore(gb, 9, 16, 0.7, patchDark, 0.12);
    const cards = new GeoBuilder();
    const tufts = layoutTufts(rL, { wMin: 0.5, wMax: 0.95, k: [0.8, 1.0], around: 0.9, vstep: 0.7, hk: [1.5, 2.1] });
    for (const t of tufts) {
      emitTuftBlob(gb, t, [5, 3], { inflate: 0.92, rect: patch, ao0: 0.38, ao1: 0.55, tip: 0.6, kT: 0.6 });
      if (t.depthK > 0.2) emitTuftCards(cards, t, rL, { cards: t.depthK > 0.6 ? 2 : 1, ao0: 0.45, ao1: 0.5, tip: 0.9, kT: 0.6 });
    }
    lods.push({ blob: gb.build(), card: cards.build(), tris: gb.triangles + cards.triangles });
  }

  // ================================================================== LOD 2 / 3 (far): lumpy lathe
  // (LOD 2 also gets a shell of big outward tuft cards: ragged silhouette + sunlit tufts at 20-100 px)
  for (const [radial, rings, amp, tufted] of [[8, 14, 0.16, true], [5, 6, 0.1, false]]) {
    const gb = new GeoBuilder();
    const cards = new GeoBuilder();
    const coreK = tufted ? 0.86 : 0.96;
    if (tufted) {
      const rL = new RNG('cypL2:' + seed);
      // (r5) smaller, denser tufts with stronger per-tuft shading: at 20-100 px the crown reads as a scaly
      // mosaic of sunlit flames and dark creases (refs 1, 3, 9) instead of a few big flat shards
      for (const t of layoutTufts(rL, { wMin: 0.62, wMax: 1.05, k: [0.9, 1.06], around: 1.0, vstep: 0.78, hk: [1.6, 2.2] })) emitTuftCards(cards, t, rL, { cards: 1, ao0: 0.32, ao1: 0.68, tip: 1.0, kT: 0.78 });
    }
    const ids = [];
    for (let j = 0; j <= rings; j++) {
      const u = Math.pow(j / rings, 0.9) * 0.985;
      const a = axis(u);
      const row = [];
      for (let i = 0; i <= radial; i++) {
        const th = i / radial * Math.PI * 2 + j * 0.37;
        const r = rAt(th, u, amp) * coreK;
        const p = [a[0] + Math.cos(th) * r, a[1], a[2] + Math.sin(th) * r];
        const n = lumpyNormal(th, u, amp * 1.6);
        const lu = lump(th, u, 1) - 1;
        // (r5) ping-pong tiling of the foliage patch: one tile per ring band / radial segment (≈1 m), instead of
        // one cell stretched over the whole 17 m tree (that read as fine vertical streaks at mid distance)
        const tu = i % 2, tv = j % 2;
        row.push(gb.v(p[0], p[1], p[2], n[0], n[1], n[2], lerp(patch[0], patch[2], tu), lerp(patch[3], patch[1], tv),
          clamp(0.62 + lu * 1.5, 0.3, 1), clamp(0.3 + lu * 2, 0, 1), (j * 7 + i) % 5 / 5, clamp(p[1] / H, 0, 1)));
      }
      ids.push(row);
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < radial; i++) gb.quad(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i]);
    const a = axis(1);
    const t = gb.v(a[0], a[1], a[2], 0, 1, 0, patch[0], patch[1], 0.8, 0.6, 0.5, 1);
    for (let i = 0; i < radial; i++) gb.tri(ids[rings][i], ids[rings][i + 1], t);
    lods.push({ blob: gb.build(), card: cards.count ? cards.build() : undefined, tris: gb.triangles + cards.triangles });
  }
  return { H, R, P, lods };
}
