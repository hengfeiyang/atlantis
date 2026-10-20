// Classical orders: fluted shafts with entasis, Attic bases, Doric / Ionic / Corinthian capitals.
// All dimensions in metres, column local frame: axis = +Y, base of the column at y = 0, front = +Z.
import * as THREE from 'three';
import { MeshBuilder, lathe, surface, box, boxC, tube, ellipsoid, lerp, clamp, smooth, hash3 } from './geom.js';
import { corinthianCapital } from './acanthus.js';

export const ORDER_DEFAULTS = {
  doric: { hd: 5.5, flutes: 20, taper: 0.78, base: false },
  ionic: { hd: 9.0, flutes: 24, taper: 0.83, base: true },
  corinthian: { hd: 10.0, flutes: 24, taper: 0.84, base: true },
};

/** detail level → segment counts */
export function seg(detail, lo, hi) { return Math.max(lo, Math.round(lerp(lo, hi, clamp(detail, 0, 1)))); }

/**
 * Shaft radius profile with entasis.  t ∈ [0,1] along the shaft.
 */
export function shaftRadius(R0, taper, entasis, t, apo = 0) {
  let r = lerp(R0, R0 * taper, Math.pow(t, 1.15)) + entasis * R0 * Math.sin(Math.PI * Math.min(1, t * 1.1));
  if (apo > 0) { // apophyge: small flare at both ends (Ionic / Corinthian)
    r += apo * R0 * (Math.exp(-t * 60) + Math.exp(-(1 - t) * 60) * 0.7);
  }
  return r;
}

/**
 * Fluted shaft between y0 and y1.
 * o: { R0, taper, entasis, flutes, fillet (0 = Doric sharp arris, >0 fillet fraction), depth (fraction of flute pitch),
 *      detail, apo, grooves: [y...] incised rings (absolute y), fadeEnds (m) flute termination length,
 *      seed, streak, jointOffset (shader drum joints), broken: {fn(y, angle) → radius delta} }
 */
export function flutedShaft(mb, y0, y1, o) {
  const F = o.flutes, H = y1 - y0;
  const S = o.fillet > 0 ? seg(o.detail, 3, 6) : seg(o.detail, 3, 7);
  const pitch = (Math.PI * 2) / F;
  const fadeEnds = o.fadeEnds ?? 0;
  // v samples: denser near the ends + grooves
  const vs = new Set();
  const nRows = seg(o.detail, 5, 10);
  for (let i = 0; i <= nRows; i++) vs.add(i / nRows);
  if (fadeEnds > 0) for (const f of [0.15, 0.35, 0.6, 1.0]) { vs.add(clamp((fadeEnds * f) / H, 0, 1)); vs.add(clamp(1 - (fadeEnds * f) / H, 0, 1)); }
  for (const g of o.grooves || []) { const t = (g - y0) / H; const w = 0.012 / H; vs.add(t - w); vs.add(t); vs.add(t + w); }
  if (o.extraRows) for (const t of o.extraRows) vs.add(t);
  const vArr = [...vs].filter((v) => v >= 0 && v <= 1).sort((a, b) => a - b);
  const R0 = o.R0, taper = o.taper, ent = o.entasis ?? 0.012, apo = o.apo ?? 0;
  const depthFrac = o.depth ?? (o.fillet > 0 ? 0.42 : 0.2);
  const grooveFn = (y) => {
    let d = 0;
    for (const g of o.grooves || []) d = Math.max(d, 1 - Math.abs(y - g) / 0.012);
    return clamp(d, 0, 1);
  };
  const jo = o.jointOffset ?? 0;
  const broken = o.broken;
  for (let f = 0; f < F; f++) {
    const a0 = f * pitch + (o.phase ?? 0);
    const strips = o.fillet > 0
      ? [{ k0: 0, k1: o.fillet, kind: 'fillet' }, { k0: o.fillet, k1: 1, kind: 'flute' }]
      : [{ k0: 0, k1: 1, kind: 'flute' }];
    for (const st of strips) {
      const us = [];
      const ns = st.kind === 'fillet' ? 1 : S;
      for (let i = 0; i <= ns; i++) us.push(i / ns);
      const fn = (u, v, out) => {
        const y = y0 + v * H, t = v;
        const R = shaftRadius(R0, taper, ent, t, apo);
        const k = lerp(st.k0, st.k1, u);
        const ang = a0 + k * pitch;
        let r = R;
        if (st.kind === 'flute') {
          const kk = (k - st.k0) / (st.k1 - st.k0); // 0..1 across the flute
          const chord = 2 * R * Math.sin(((st.k1 - st.k0) * pitch) / 2);
          let depth = chord * depthFrac;
          if (fadeEnds > 0) depth *= smooth(0, fadeEnds, y - y0) * smooth(0, fadeEnds * 0.8, y1 - y);
          const prof = o.fillet > 0 ? Math.sqrt(Math.max(0, 1 - (2 * kk - 1) ** 2)) : Math.pow(Math.max(0, 1 - (2 * kk - 1) ** 2), 0.62);
          r = R - depth * prof;
        }
        r -= 0.011 * R0 * grooveFn(y);
        if (broken) r += broken(y, ang, r);
        out[0] = r * Math.sin(ang); out[1] = y; out[2] = r * Math.cos(ang);
      };
      const auxFn = (u, v) => {
        const y = y0 + v * H;
        let cav = 0, edge = 0;
        if (st.kind === 'flute') { const kk = u; const p = 1 - (2 * kk - 1) ** 2; cav = 0.18 * p; edge = (u === 0 || u === 1) ? 0.7 : 0; }
        else edge = 0.35;
        cav = Math.max(cav, grooveFn(y) * 0.9);
        return [cav, edge, o.streak ?? 0.6, 1 + (y + jo) / 100];
      };
      surface(mb, fn, ns, 1, { us, vs: vArr, aux: auxFn });
    }
  }
}

/** Attic base (torus – scotia – torus) with optional square plinth. Returns its height. */
export function atticBase(mb, D, o = {}) {
  const segs = seg(o.detail ?? 1, 20, 56);
  const plinth = o.plinth !== false;
  const hP = plinth ? 0.17 * D : 0;
  if (plinth) box(mb, [-0.7 * D, 0, -0.7 * D], [0.7 * D, hP, 0.7 * D], 0.012 * D, [0.1, 0, 0.2, 0]);
  const y = hP;
  const pr = [];
  const torus = (cx, cy, r, a0, a1, n, cav = 0) => { for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); pr.push([cx + r * Math.cos(a), cy + r * Math.sin(a), cav, 0]); } };
  // lower torus
  const tl = 0.125 * D * 0.5;
  pr.push([0.62 * D, y, 0.5, 0, true]);
  torus(0.62 * D, y + tl, tl, -Math.PI / 2, Math.PI / 2, 8);
  // fillet + scotia
  pr.push([0.6 * D, y + 2 * tl + 0.005 * D, 0.4, 0.3, true]);
  pr.push([0.6 * D, y + 2 * tl + 0.018 * D, 0.2, 0.3, true]);
  const sy0 = y + 2 * tl + 0.018 * D, sy1 = sy0 + 0.085 * D;
  for (let i = 1; i <= 6; i++) { const t = i / 6; pr.push([lerp(0.6 * D, 0.555 * D, t) - 0.045 * D * Math.sin(Math.PI * t), lerp(sy0, sy1, t), 0.7 * Math.sin(Math.PI * t), 0]); }
  pr.push([0.555 * D, sy1 + 0.012 * D, 0.3, 0.3, true]);
  // upper torus
  const tu = 0.083 * D * 0.5;
  const uy = sy1 + 0.012 * D;
  torus(0.53 * D, uy + tu, tu, -Math.PI / 2, Math.PI / 2, 7);
  pr.push([0.5 * D, uy + 2 * tu + 0.004 * D, 0.5, 0, true]);
  lathe(mb, pr, segs, { streak: 0.2 });
  return uy + 2 * tu + 0.004 * D;
}

// ------------------------------------------------------------------------------ Doric capital
/** Doric capital on a shaft of top radius r1 (incl. annulets, echinus, abacus). Returns height. */
export function doricCapital(mb, D, r1, y0, o = {}) {
  const detail = o.detail ?? 1;
  const segs = seg(detail, 24, 72);
  const hAnn = 0.06 * D, hEch = 0.22 * D, hAb = 0.17 * D;
  const ab = (o.abacus ?? 1.1) * D;
  const rFlute = r1 * 0.94;
  // annulets (4 small steps) + start of echinus
  const pr = [[rFlute, y0, 0.6, 0, true], [r1 * 1.0, y0 + 0.004 * D, 0.5, 0, true]];
  for (let i = 0; i < 4; i++) {
    const yy = y0 + 0.008 * D + i * (hAnn / 4);
    const rr = r1 * (1.005 + 0.012 * i);
    pr.push([rr, yy, 0.35, 0.2, true]);
    pr.push([rr + 0.01 * D, yy + 0.004 * D, 0.1, 0.6]);
    pr.push([rr + 0.01 * D, yy + hAnn / 4 - 0.004 * D, 0.1, 0.6]);
    pr.push([rr, yy + hAnn / 4, 0.35, 0.2, true]);
  }
  const ey0 = y0 + hAnn + 0.008 * D;
  const rb = r1 * 1.06, rt = ab * 0.5 * 0.98;
  if (!o.decorated) {
    const n = seg(detail, 6, 12);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // classical echinus: steep conical flare that rounds over at the top
      const r = lerp(rb, rt, Math.pow(Math.sin((t * Math.PI) / 2), 1.25));
      pr.push([r, ey0 + t * hEch, i === n ? 0 : 0.05, i === n ? 0.6 : 0]);
    }
    pr.push([rt * 0.97, ey0 + hEch + 0.002 * D, 0.5, 0, true]);
    lathe(mb, pr, segs, { streak: 0.3 });
  } else {
    lathe(mb, pr, segs, { streak: 0.3 });
    // echinus with egg-and-dart band
    const nEgg = Math.round(lerp(28, 40, clamp(D / 2, 0, 1)));
    const nA = seg(detail, nEgg * 3, nEgg * 4), nT = seg(detail, 5, 8);
    surface(mb, (u, v, out) => {
      const a = u * Math.PI * 2;
      const r0 = lerp(rb, rt, Math.pow(Math.sin((v * Math.PI) / 2), 1.25));
      const k = (u * nEgg) % 1;
      const band = smooth(0.15, 0.4, v) * (1 - smooth(0.75, 0.95, v));
      const egg = Math.pow(Math.max(0, 1 - ((k - 0.5) / 0.36) ** 2), 0.6);
      const dart = Math.max(0, 1 - Math.abs(k) / 0.05) + Math.max(0, 1 - Math.abs(k - 1) / 0.05);
      const rim = Math.abs(Math.abs(k - 0.5) - 0.41) < 0.04 ? 0.6 : 0;
      const r = r0 + band * 0.018 * D * (egg - 0.8 * (1 - egg) - 0.4 * rim + dart * 0.6);
      out[0] = r * Math.sin(a); out[1] = ey0 + v * hEch; out[2] = r * Math.cos(a);
    }, nA, nT, {
      closedU: true,
      aux: (u, v) => { const k = (u * nEgg) % 1; const band = smooth(0.15, 0.4, v) * (1 - smooth(0.75, 0.95, v)); return [band * (1 - Math.pow(Math.max(0, 1 - ((k - 0.5) / 0.36) ** 2), 0.5)) * 0.8, 0, 0.3, 0]; },
    });
    lathe(mb, [[rt * 0.6, ey0 + hEch, 0, 0], [rt, ey0 + hEch, 0, 0]], segs, {});
  }
  // abacus (square slab with chamfered edges)
  const ya = ey0 + hEch;
  box(mb, [-ab / 2, ya, -ab / 2], [ab / 2, ya + hAb, ab / 2], 0.012 * D, [0.05, 0, 0.4, 0]);
  return ya + hAb - y0;
}

// ------------------------------------------------------------------------------ Ionic capital
function voluteFace(mb, cx, cy, z, Rv, dirX, front, detail, D) {
  // spiral relief on a disk: 3 turns from the rim to the eye
  const nr = seg(detail, 6, 14), na = seg(detail, 24, 56);
  const re = Rv * 0.16, turns = 2.6;
  const relief = 0.045 * D;
  surface(mb, (u, v, out) => {
    const a = u * Math.PI * 2; // around
    const r = lerp(Rv, 0.0001, v);
    // angle measured from the top, winding outward (dirX) then down
    const thW = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const s = ((Rv - r) / (Rv - re)) * turns - thW / (Math.PI * 2);
    const fr = s - Math.floor(s);
    let h;
    if (r < re) h = relief * 0.9 * Math.sqrt(Math.max(0, 1 - (r / re) ** 2)) + relief * 0.25; // eye
    else if (s < 0) h = relief * 0.9; // outer rim
    else {
      const ridge = Math.max(0, 1 - fr / 0.14) + Math.max(0, 1 - (1 - fr) / 0.06);
      const chan = Math.sin(Math.PI * clamp((fr - 0.12) / 0.82, 0, 1));
      h = relief * (0.75 * Math.min(1, ridge) - 0.55 * chan) + relief * 0.4;
    }
    out[0] = cx + dirX * r * Math.cos(Math.PI / 2 - a);
    out[1] = cy + r * Math.sin(Math.PI / 2 - a);
    out[2] = z + front * h;
  }, na, nr, {
    closedU: true,
    flip: (front > 0) === (dirX > 0),
    aux: (u, v) => {
      const r = lerp(Rv, 0.0001, v);
      const a = u * Math.PI * 2;
      const thW = a;
      const s = ((Rv - r) / (Rv - re)) * turns - thW / (Math.PI * 2);
      const fr = s - Math.floor(s);
      const chan = r < re || s < 0 ? 0 : Math.sin(Math.PI * clamp((fr - 0.12) / 0.82, 0, 1));
      return [chan * 0.55, (fr < 0.1 && s > 0) ? 0.6 : 0, 0.2, 0];
    },
  });
}

/** Ionic capital: echinus with egg-and-dart, canalis, two volute pairs, bolsters, abacus. Returns height. */
export function ionicCapital(mb, D, r1, y0, o = {}) {
  const detail = o.detail ?? 1;
  const segs = seg(detail, 24, 64);
  // astragal (bead) at top of shaft
  const pr = [];
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; pr.push([r1 * 1.02 + 0.03 * D * Math.cos(a), y0 + 0.03 * D + 0.03 * D * Math.sin(a), i === 0 || i === 8 ? 0.5 : 0, 0]); }
  lathe(mb, pr, segs, {});
  const yE = y0 + 0.06 * D;
  const hE = 0.13 * D;
  // echinus with egg-and-dart
  const nEgg = 20;
  surface(mb, (u, v, out) => {
    const a = u * Math.PI * 2;
    const r0 = lerp(r1 * 1.0, 0.6 * D, Math.sin((v * Math.PI) / 2));
    const k = (u * nEgg) % 1;
    const egg = Math.pow(Math.max(0, 1 - ((k - 0.5) / 0.38) ** 2), 0.6);
    const band = Math.sin(Math.PI * v);
    const r = r0 + band * 0.02 * D * (egg - 0.6 * (1 - egg));
    out[0] = r * Math.sin(a); out[1] = yE + v * hE; out[2] = r * Math.cos(a);
  }, seg(detail, 60, 160), seg(detail, 4, 8), { closedU: true, aux: (u) => { const k = (u * nEgg) % 1; return [(1 - Math.pow(Math.max(0, 1 - ((k - 0.5) / 0.38) ** 2), 0.5)) * 0.7, 0, 0.2, 0]; } });
  // canalis band (front & back) between the volutes, with concave channel
  const yC0 = yE + hE * 0.55, yC1 = yE + hE + 0.12 * D;
  const xC = 0.62 * D, zC = 0.5 * D;
  for (const front of [1, -1]) {
    surface(mb, (u, v, out) => {
      const x = lerp(-xC, xC, u), y = lerp(yC0, yC1, v);
      const ch = Math.sin(Math.PI * clamp((v - 0.12) / 0.7, 0, 1));
      out[0] = x; out[1] = y; out[2] = front * (zC + 0.012 * D - 0.02 * D * ch);
    }, seg(detail, 4, 12), seg(detail, 4, 8), { flip: front < 0, aux: (u, v) => [0.4 * Math.sin(Math.PI * clamp((v - 0.12) / 0.7, 0, 1)), 0, 0.3, 0] });
  }
  // volutes
  const Rv = 0.28 * D;
  const vy = yC1 - Rv;
  for (const dirX of [1, -1]) {
    for (const front of [1, -1]) voluteFace(mb, dirX * xC, vy, front * zC, Rv, dirX, front, detail, D);
    // bolster (pulvinus) with a belt (balteus)
    surface(mb, (u, v, out) => {
      const a = u * Math.PI * 2, z = lerp(-zC, zC, v);
      const waist = 1 - 0.22 * Math.exp(-((z / zC) ** 2) * 9) - 0.05 * Math.cos((z / zC) * Math.PI * 6) * (1 - Math.exp(-((z / zC) ** 2) * 9));
      const r = Rv * 0.98 * waist;
      out[0] = dirX * xC + r * Math.cos(a) * 1.0; out[1] = vy + r * Math.sin(a); out[2] = z;
    }, seg(detail, 12, 32), seg(detail, 6, 16), { closedU: true, flip: false, aux: (u, v) => { const z = lerp(-1, 1, v); return [0.35 * Math.exp(-z * z * 9), 0, 0.2, 0]; } });
  }
  // abacus: thin slab with ovolo
  const yA = yC1;
  const aw = 1.36 * D, ad = 1.12 * D, ah = 0.07 * D;
  box(mb, [-aw / 2, yA, -ad / 2], [aw / 2, yA + ah, ad / 2], 0.012 * D, [0.1, 0, 0.3, 0]);
  return yA + ah - y0;
}

// ------------------------------------------------------------------------------ full column
const _colCache = new Map();
/**
 * Complete column geometry (cached by options).
 * @param {object} o
 * @param {'doric'|'ionic'|'corinthian'} o.order
 * @param {number} o.height total height incl. base & capital (m)
 * @param {number} [o.diameter] lower shaft diameter (default from order ratio)
 * @param {number} [o.detail=1] 0..1 tessellation level
 * @param {boolean} [o.decorated] Doric: egg-and-dart echinus
 * @param {boolean} [o.base] override base presence; [o.plinth] Attic base plinth
 * @param {number} [o.flutes] [o.taper] [o.entasis]
 * @param {boolean} [o.capital=true] false → shaft (+base) only, flat top
 * @returns {{geometry: THREE.BufferGeometry, info: object}}
 */
export function columnGeometry(o = {}) {
  const key = JSON.stringify(o);
  if (_colCache.has(key)) return _colCache.get(key);
  const res = buildColumn(new MeshBuilder(), o);
  const out = { geometry: res.mb.geometry(), info: res.info };
  _colCache.set(key, out);
  return out;
}

/** Build a column into an existing builder (at the builder's current transform). */
export function buildColumn(mb, o = {}) {
  const order = o.order || 'doric';
  const d = ORDER_DEFAULTS[order];
  const H = o.height ?? 10;
  const D = o.diameter ?? H / d.hd;
  const detail = o.detail ?? 1;
  const taper = o.taper ?? d.taper;
  const flutes = o.flutes ?? d.flutes;
  const hasBase = o.base ?? d.base;
  let y = 0;
  if (hasBase) y = atticBase(mb, D, { detail, plinth: o.plinth ?? (order === 'corinthian') });
  // capital height estimate first
  const capH = o.capital === false ? 0 : order === 'doric' ? 0.06 * D + 0.008 * D + 0.22 * D + 0.17 * D : order === 'ionic' ? 0.06 * D + 0.13 * D + 0.12 * D + 0.07 * D : 1.17 * D;
  const shaftTop = H - capH;
  const R0 = D / 2;
  const r1 = shaftRadius(R0, taper, o.entasis ?? 0.012, 1, order === 'doric' ? 0 : 0.04);
  const grooves = order === 'doric' && o.capital !== false ? [shaftTop - 0.05 * D, shaftTop - 0.065 * D, shaftTop - 0.08 * D] : [];
  flutedShaft(mb, y, shaftTop, {
    R0, taper, entasis: o.entasis ?? 0.012, flutes, fillet: order === 'doric' ? 0 : 0.2,
    detail, apo: order === 'doric' ? 0 : 0.04, fadeEnds: order === 'doric' ? 0 : 0.28 * D, grooves,
    jointOffset: o.jointOffset ?? 0, streak: 0.65,
  });
  let ch = 0;
  if (o.capital === false) {
    lathe(mb, [[r1 * 0.9, shaftTop, 0, 0], [0.0001, shaftTop, 0, 0]], seg(detail, 16, 40), {});
  } else if (order === 'doric') ch = doricCapital(mb, D, r1, shaftTop, { detail, decorated: o.decorated, abacus: o.abacus });
  else if (order === 'ionic') ch = ionicCapital(mb, D, r1, shaftTop, { detail });
  else ch = corinthianCapital(mb, D, r1, shaftTop, { detail });
  const info = {
    order, D, R0, Dtop: r1 * 2, baseH: y, shaftTop, capH: ch, height: shaftTop + ch,
    abacus: order === 'doric' ? (o.abacus ?? 1.1) * D : order === 'ionic' ? 1.36 * D : 1.42 * D,
  };
  return { mb, info };
}

/** column dimensions without building geometry (for layout) */
export function columnInfo(o = {}) {
  const order = o.order || 'doric';
  const d = ORDER_DEFAULTS[order];
  const H = o.height ?? 10, D = o.diameter ?? H / d.hd;
  return { order, D, height: H, abacus: order === 'doric' ? (o.abacus ?? 1.1) * D : order === 'ionic' ? 1.36 * D : 1.42 * D };
}

export { hash3, ellipsoid, tube, boxC };
