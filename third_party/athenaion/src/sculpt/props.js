// Statue props as plain three geometry (with the baked 'color' attribute convention of bakeutil.js):
// spear, round shield with owl / sunburst / laurel emblem, moulded pedestals.
import * as THREE from 'three';
import { withColor, mergeGeos } from './bakeutil.js';
import { clamp, lerp, sstep, hash1 } from './sdf.js';

// ------------------------------------------------------------------ spear (along +Y from y=0)
export function spearGeometry({ length = 2.42, r = 0.017, seg = 14, blade = 0.22 } = {}) {
  const L = length;
  // lathe profile (radius, y)
  const shaft = [
    [0.0, 0.0], [0.006, 0.004], [0.014, 0.05], [0.019, 0.1], [0.021, 0.115], [r * 1.15, 0.125], [r, 0.14],
    [r, L * 0.45], [r * 0.97, L * 0.8], [r * 0.95, L - blade - 0.07],
  ];
  const socket = [
    [r * 0.95, L - blade - 0.07], [r * 1.35, L - blade - 0.065], [r * 1.35, L - blade - 0.055], [r * 1.12, L - blade - 0.05],
    [r * 1.18, L - blade - 0.012], [r * 1.5, L - blade - 0.004], [r * 0.9, L - blade + 0.004],
  ];
  const mk = (prof, s = seg) => new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), s);
  const gShaft = withColor(mk(shaft), 1, 0, 0.68); // (r3) antique bronze-gilt shaft, gold socket + blade (refs 4, 5)
  // butt spike darker bronze
  const cs = gShaft.attributes.color.array, ps = gShaft.attributes.position.array;
  for (let i = 0; i < cs.length / 3; i++) if (ps[i * 3 + 1] < 0.13) cs[i * 3 + 2] = 150;
  const gSocket = withColor(mk(socket), 1, 0, 1);
  // leaf-shaped blade: lathe then flatten (z) except the midrib
  const bp = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const w = Math.sin(Math.pow(t, 0.75) * Math.PI) * (1 - t * 0.35) * 0.042 + 0.004 * (1 - t);
    bp.push([Math.max(0.0005, w * (t < 0.98 ? 1 : 0.2)), L - blade + t * blade]);
  }
  bp[bp.length - 1][0] = 0.0;
  const gBlade = mk(bp, 16);
  const p = gBlade.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) {
    const ax = Math.abs(p[i]);
    p[i + 2] *= 0.22 + 0.4 * Math.exp(-ax * 120); // midrib
  }
  gBlade.computeVertexNormals();
  withColor(gBlade, 1, 0, 1);
  return mergeGeos([gShaft, gSocket, gBlade].map(clean));
}
function clean(g) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; }

// ------------------------------------------------------------------ shield emblem (2D, normalised radius 1)
/** returns [height 0..1, gold 0..1] for the emblem at (u,v) */
export function emblem(u, v, style = 'rays', seed = 1) {
  const r = Math.hypot(u, v), a = Math.atan2(v, u);
  let h = 0, g = 0;
  const raise = (d, w, amp, gold = 1) => { // d: signed distance (neg inside), w: bevel width
    if (d < w) { const t = clamp(-d / w, 0, 1); const hh = amp * Math.sqrt(t * (2 - t)); if (hh > h) h = hh; if (d < w * 0.2) g = Math.max(g, gold); }
  };
  const ell = (x, y, cx, cy, rx, ry, rot = 0) => {
    const c = Math.cos(rot), s = Math.sin(rot); const dx = x - cx, dy = y - cy;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    const k = Math.hypot(lx / rx, ly / ry); return (k - 1) * Math.min(rx, ry);
  };
  // ---- rim band + bead ring + inner fillet
  raise(Math.max(0.9 - r, r - 1.0), 0.05, 1.0);
  if (r > 0.83 && r < 0.88) { // beads
    const n = 64, ai = Math.round(((a / (Math.PI * 2)) + 0.5) * n) / n;
    const ba = (ai - 0.5) * Math.PI * 2;
    const bx = Math.cos(ba) * 0.855, by = Math.sin(ba) * 0.855;
    raise(Math.hypot(u - bx, v - by) - 0.021, 0.02, 0.55);
  }
  raise(Math.abs(r - 0.81) - 0.006, 0.006, 0.35);
  // ---- sunburst rays
  if (style === 'rays' || style === 'both' || style === 'all') { // (r6) 'all' = ref 5: bronze rays, perched owl, laurel sprays
    const n = 28;
    const f = ((a / (Math.PI * 2)) + 0.5) * n, i = Math.floor(f), u0 = (f - i) * 2 - 1;
    const long = i % 2 === 0;
    const r0 = 0.3, r1 = long ? 0.78 : 0.62;
    if (r > r0 && r < r1) {
      const t = (r - r0) / (r1 - r0);
      const half = (long ? 0.34 : 0.28) * (1 - t) + 0.05;
      const dAng = (Math.abs(u0) - half) * (Math.PI / n) * r;
      raise(Math.max(dAng, Math.max(r0 - r, r - r1)), 0.012, long ? 0.5 : 0.4, style === 'both' || style === 'all' ? 0 : 1); // (r3) 'both': bronze rays behind the gold owl (ref 5)
    }
  }
  // ---- laurel wreath (two branches from the bottom)
  if (style === 'wreath' || style === 'all') { // (r3) 'both' = owl + rays only (ref 5)
    const Rw = style === 'all' ? 0.7 : 0.62;
    const tMax = style === 'all' ? 0.42 : 1.02; // 'all': laurel sprays rising from the bottom only
    for (const s of [-1, 1]) {
      // branch: angle from -100deg (bottom) to ~ +70 on each side
      const base = -Math.PI / 2;
      const aa = Math.atan2(v, u * s);
      let t = (aa - base - 0.12) / (Math.PI * 0.85);
      if (t > -0.05 && t < tMax) {
        // stem
        raise(Math.abs(r - Rw) - 0.008, 0.008, 0.35);
        const nL = 13;
        const k = Math.round(t * nL);
        for (let kk = k - 1; kk <= k + 1; kk++) {
          if (kk < 0 || kk > nL) continue;
          const ta = base + 0.12 + (kk / nL) * Math.PI * 0.85;
          for (const side of [-1, 1]) {
            const lr = Rw + side * 0.045;
            const cx = Math.cos(ta) * lr * s, cy = Math.sin(ta) * lr;
            const rot = Math.atan2(cy, cx) + (Math.PI / 2) * s + side * 0.5 * s;
            raise(ell(u, v, cx, cy, 0.052, 0.02, rot), 0.012, 0.45);
          }
        }
      }
    }
    // tie at the bottom
    raise(ell(u, v, 0, -Rw, 0.04, 0.03), 0.01, 0.4);
  }
  // ---- owl
  const ox = 0, oy = 0.0, os = style === 'both' ? 0.95 : style === 'all' ? 0.92 : 1.05;
  const U = (u - ox) / os, V = (v - oy) / os;
  if (style !== 'wreath' && style !== 'all') {
    // spread wings: a fan of long primaries + coverts from each shoulder (heraldic owl of ref 5)
    for (const s of [-1, 1]) {
      const sx = 0.1 * s, sy = 0.02;
      let dw = ell(U, V, 0.2 * s, 0.0, 0.14, 0.075, -0.25 * s); // coverts
      for (let k = 0; k < 7; k++) {
        const a = -0.55 + (k / 6) * 0.95, L = 0.42 - 0.035 * Math.abs(k - 3.5);
        const dx = Math.cos(a) * s, dy = Math.sin(a);
        const cx = sx + dx * L * 0.55, cy = sy + dy * L * 0.55;
        dw = Math.min(dw, ell(U, V, cx, cy, L * 0.5, 0.034, Math.atan2(dy, dx)));
      }
      if (dw < 0.03) {
        raise(dw * os, 0.03, 0.7);
        // feather grooves along the primaries
        const ga = Math.atan2(V - sy, (U - sx) * s);
        if (dw < 0) h -= 0.08 * Math.pow(Math.abs(Math.sin(ga * 22)), 6);
      }
    }
  }
  const body = ell(U, V, 0, -0.06, 0.155, 0.235);
  const head = ell(U, V, 0, 0.215, 0.15, 0.125);
  let dOwl = Math.min(body, head);
  // ear tufts
  for (const s of [-1, 1]) dOwl = Math.min(dOwl, ell(U, V, 0.115 * s, 0.33, 0.035, 0.06, -0.5 * s));
  // tail
  dOwl = Math.min(dOwl, ell(U, V, 0, -0.3, 0.07, 0.07));
  if (dOwl < 0.03) {
    raise(dOwl * os, 0.06, 0.85);
    // breast feathers: scallop rows (grooves)
    if (body < 0 && head > 0) {
      const row = Math.floor((V + 0.3) / 0.045);
      const off = (row % 2) * 0.03;
      const sc = Math.abs(((U + off) / 0.06) % 1 + 1) % 1 - 0.5;
      const groove = Math.abs((V + 0.3) / 0.045 - row - 0.35 * (1 - 4 * sc * sc));
      if (groove < 0.12) h -= 0.08 * (1 - groove / 0.12);
    }
    // eyes: raised rings with recessed iris and a pupil
    for (const s of [-1, 1]) {
      const de = Math.hypot(U - 0.068 * s, V - 0.215);
      if (de < 0.062) {
        if (de > 0.048) h = Math.max(h, 1.0);
        else if (de > 0.022) h = 0.72 - 0.15 * (de - 0.022) / 0.026;
        else h = 0.9;
        g = 1;
      }
    }
    // beak
    const db = Math.max(Math.abs(U) * 1.6 + (V - 0.17) * 0.9, -(V - 0.11));
    if (db < 0.02) h = Math.max(h, 0.95);
    // folded wings: outline grooves + feather stripes
    for (const s of [-1, 1]) {
      const dw = ell(U, V, 0.11 * s, -0.07, 0.085, 0.2, 0.22 * s);
      if (dw < 0) {
        h = Math.max(h, 0.9);
        const stripe = Math.abs(Math.sin((V * 34 + U * s * 10)));
        if (stripe < 0.25 && V < 0.0) h -= 0.07;
      }
      if (Math.abs(dw) < 0.008) h -= 0.12;
    }
  }
  // feet + branch
  if (Math.abs(V + 0.36) < 0.03 && Math.abs(U) < 0.24) raise(Math.abs(V + 0.36) - 0.012, 0.012, 0.6);
  for (const s of [-1, 1]) for (let t = -1; t <= 1; t++) raise(ell(U, V, 0.05 * s + t * 0.016, -0.345, 0.008, 0.03, t * 0.4), 0.008, 0.7);
  return [h, g];
}

/** shield: convex disc (local +Z = outward face), radius R, rim & emblem relief, back with a strap */
export function shieldGeometry({ R = 0.5, N = 150, style = 'rays', relief = 0.03, seed = 1, dome: domeO, thick: thickO, marble = false } = {}) {
  const dome = domeO ?? 0.075 * R / 0.5, thick = thickO ?? 0.035 * R / 0.5;
  const verts = [], cols = [], idx = [], uvs = [];
  const map = new Int32Array((N + 1) * (N + 1)).fill(-1);
  const hs = 0.7 / N; // supersampling offset (smooth bevels; crisp detail comes from the emblem texture)
  const zFace = (u, v) => {
    const r = Math.min(1, Math.hypot(u, v));
    const [h] = emblem(u, v, style, seed);
    return dome * (1 - r * r) + relief * h * R / 0.5 * 0.5 + thick * 0.5;
  };
  // front face: grid inside the unit disc, outer ring snapped to the circle
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    let u = (i / N) * 2 - 1, v = (j / N) * 2 - 1;
    const r = Math.hypot(u, v);
    if (r > 1 + 1.5 / N) continue;
    if (r > 1) { u /= r; v /= r; }
    let h = 0, g = 0;
    // 4x4 box filter over ~1.4 cells: removes grid aliasing (crisp edges come from the emblem texture)
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      const e = emblem(u + (a - 1.5) * hs * 0.9, v + (b - 1.5) * hs * 0.9, style, seed);
      h += e[0] / 16; g += e[1] / 16;
    }
    const z = dome * (1 - Math.min(1, r * r)) + relief * h * (R / 0.5) * 0.5 + thick * 0.5;
    map[j * (N + 1) + i] = verts.length / 3;
    verts.push(u * R, v * R, z);
    uvs.push(u * 0.5 + 0.5, v * 0.5 + 0.5);
    cols.push(marble ? Math.round(255 * (0.75 + 0.25 * Math.min(1, h * 2))) : 255, Math.round(clamp(0.6 - h * 0.6, 0, 1) * 120), marble ? 0 : g > 0.5 ? 255 : 140);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = map[j * (N + 1) + i], b = map[j * (N + 1) + i + 1], c = map[(j + 1) * (N + 1) + i], d = map[(j + 1) * (N + 1) + i + 1];
    if (a >= 0 && b >= 0 && c >= 0 && d >= 0) { idx.push(a, b, d, a, d, c); }
    else if (a >= 0 && b >= 0 && d >= 0) idx.push(a, b, d);
    else if (a >= 0 && d >= 0 && c >= 0) idx.push(a, d, c);
    else if (a >= 0 && b >= 0 && c >= 0) idx.push(a, b, c);
    else if (b >= 0 && d >= 0 && c >= 0) idx.push(b, d, c);
  }
  const front = new THREE.BufferGeometry();
  front.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  front.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(cols), 3, true));
  front.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  front.setIndex(idx);
  front.computeVertexNormals();
  // edge band + back (lathe around Z)
  const edgeProf = [];
  const zr = thick * 0.5;
  edgeProf.push([R * 1.0, zr], [R * 1.012, zr * 0.6], [R * 1.018, 0], [R * 1.012, -thick * 0.5], [R * 0.985, -thick * 0.7], [R * 0.9, -thick * 0.75], [R * 0.5, -thick * 0.25], [0.0001, -thick * 0.1]);
  edgeProf.reverse(); // centre → rim so the lathe faces outward
  const lathe = new THREE.LatheGeometry(edgeProf.map(([a, b]) => new THREE.Vector2(a, b)), 96);
  lathe.rotateX(Math.PI / 2); // lathe axis Y → Z
  // after rotateX(+90°): (x, y, z) → (x, -z, y)... make sure the profile's "height" maps to +Z
  const lp = lathe.attributes.position.array;
  for (let i = 0; i < lp.length; i += 3) { /* y' = -z, z' = y */ }
  const back = withColor(clean(lathe), 1, 0.2, 1);
  // shade the back darker bronze (not gold)
  const bc = back.attributes.color.array, bp = back.attributes.position.array;
  for (let i = 0; i < bc.length / 3; i++) { const rr = Math.hypot(bp[i * 3], bp[i * 3 + 1]); bc[i * 3 + 2] = marble ? 0 : rr > R * 0.97 ? 240 : 150; }
  // strap/handle on the back (porpax)
  const strap = withColor(clean(new THREE.TorusGeometry(R * 0.16, R * 0.018, 6, 20, Math.PI)), 0.8, 0.3, 0.6);
  strap.rotateZ(Math.PI / 2);
  strap.translate(0, 0, -thick * 0.7);
  for (const gg of [back, strap]) gg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(gg.attributes.position.count * 2).fill(-1), 2));
  return marble ? mergeGeos([front, back]) : mergeGeos([front, back, strap]);
}

/** emblem texture (R = relief height, G = gilding mask) for crisp shield detail; uv = (u,v)*0.5+0.5 */
const emblemTexCache = new Map();
export function emblemData(style = 'rays', size = 512, seed = 1) {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = ((i + 0.5) / size) * 2 - 1, v = ((j + 0.5) / size) * 2 - 1;
    const [h, g] = Math.hypot(u, v) <= 1.02 ? emblem(u, v, style, seed) : [0, 0];
    const o = (j * size + i) * 4;
    data[o] = Math.max(0, Math.min(255, Math.round(h * 230)));
    data[o + 1] = g > 0.5 ? 255 : 0;
    data[o + 2] = 0; data[o + 3] = 255;
  }
  return data;
}
/** emblem texture via the bake cache (generated/statue-emblem-*.bin): the per-texel emblem is slow at 1024² */
export async function emblemTextureCached(style = 'rays', size = 1024, seed = 1) {
  const key = style + size + '|' + seed;
  if (emblemTexCache.has(key)) return emblemTexCache.get(key);
  const { loadOrBuild } = await import('../core/cache.js');
  const g = await loadOrBuild(`statue-emblem-${style}-${size}-s${seed}-v4`, () => {
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('data', new THREE.BufferAttribute(emblemData(style, size, seed), 4, true));
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)); // (bake tool reports vertex counts)
    return gg;
  });
  const tex = makeEmblemTex(g.attributes.data.array, size);
  emblemTexCache.set(key, tex);
  return tex;
}
function makeEmblemTex(data, size) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
export function emblemTexture(style = 'rays', size = 512, seed = 1) {
  const key = style + size + '|' + seed;
  if (emblemTexCache.has(key)) return emblemTexCache.get(key);
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = ((i + 0.5) / size) * 2 - 1, v = ((j + 0.5) / size) * 2 - 1;
    const [h, g] = Math.hypot(u, v) <= 1.02 ? emblem(u, v, style, seed) : [0, 0];
    const o = (j * size + i) * 4;
    data[o] = Math.max(0, Math.min(255, Math.round(h * 230)));
    data[o + 1] = g > 0.5 ? 255 : 0;
    data[o + 2] = 0; data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  emblemTexCache.set(key, tex);
  return tex;
}

/** carved marble medallion (owl in a laurel wreath) for pedestal dies; local +Z out of the face */
export function reliefMedallion(R = 1, style = 'wreath', N = 90) {
  return shieldGeometry({ R, N, style, relief: 0.05 * R, dome: 0.01 * R, thick: 0.03 * R, marble: true });
}

// ------------------------------------------------------------------ moulded pedestal (sweep a profile around a rectangle)
/**
 * profile: [[outset, y], ...] bottom→top (metres), hw/hd: half-sizes of the die; returns indexed geometry
 * with normals and colors (ao from concavity).
 */
export function mouldedBlock(profile, hw, hd, { cap = true, aoProfile = null } = {}) {
  const pos = [], nor = [], col = [], idx = [];
  const sides = [
    { n: [1, 0, 0], a: [0, 0, -1] },  // +X, span along -Z → +Z
    { n: [0, 0, 1], a: [1, 0, 0] },
    { n: [-1, 0, 0], a: [0, 0, 1] },
    { n: [0, 0, -1], a: [-1, 0, 0] },
  ];
  const m = profile.length;
  // per-segment 2D normals (outward, up)
  const segN = [];
  for (let j = 0; j < m - 1; j++) {
    const dox = profile[j + 1][0] - profile[j][0], dy = profile[j + 1][1] - profile[j][1];
    const l = Math.hypot(dox, dy) || 1;
    segN.push([dy / l, -dox / l]); // (outward, up)
  }
  for (const s of sides) {
    const half = s.n[0] !== 0 ? hd : hw, out = s.n[0] !== 0 ? hw : hd;
    for (let j = 0; j < m - 1; j++) {
      const base = pos.length / 3;
      for (const jj of [j, j + 1]) {
        const [o, y] = profile[jj];
        // smooth normal unless the crease is sharp
        let nn = segN[j];
        const other = jj === j ? segN[j - 1] : segN[j + 1];
        if (other && nn[0] * other[0] + nn[1] * other[1] > 0.6) { nn = [nn[0] + other[0], nn[1] + other[1]]; const l = Math.hypot(nn[0], nn[1]); nn = [nn[0] / l, nn[1] / l]; }
        const ao = aoProfile ? aoProfile(jj) : 1;
        for (const t of [-1, 1]) {
          const e = half + o;
          const px = s.n[0] * (out + o) + s.a[0] * e * t, pz = s.n[2] * (out + o) + s.a[2] * e * t;
          pos.push(px, y, pz);
          nor.push(s.n[0] * nn[0], nn[1], s.n[2] * nn[0]);
          col.push(Math.round(ao * 255), 0, 0);
        }
      }
      idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
    }
  }
  if (cap) {
    const [o, y] = profile[m - 1];
    const b = pos.length / 3;
    pos.push(-hw - o, y, -hd - o, hw + o, y, -hd - o, hw + o, y, hd + o, -hw - o, y, hd + o);
    for (let i = 0; i < 4; i++) { nor.push(0, 1, 0); col.push(255, 0, 0); }
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(col), 3, true));
  g.setIndex(idx);
  // fix winding: ensure outward-facing triangles (check first tri normal vs stored normal)
  fixWinding(g);
  return g;
}
function fixWinding(g) {
  const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t], b = ix[t + 1], c = ix[t + 2];
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[a * 3] + cy * n[a * 3 + 1] + cz * n[a * 3 + 2] < 0) { ix[t + 1] = c; ix[t + 2] = b; }
  }
}

/** profile helpers (outset, y) — appended in order */
export function profileBuilder() {
  const pts = [];
  let y = 0;
  const api = {
    pts,
    at(o, dy = 0) { y += dy; pts.push([o, y]); return api; },
    /** vertical fillet/face */
    up(o, h) { if (!pts.length || pts[pts.length - 1][0] !== o) pts.push([o, y]); y += h; pts.push([o, y]); return api; },
    /** torus (convex half-round) of radius r projecting from o */
    torus(o, r, n = 6) { for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (i / n) * Math.PI; pts.push([o + Math.cos(a) * r, y + r + Math.sin(a) * r]); } y += 2 * r; return api; },
    /** cavetto/scotia (concave quarter) from o0 to o1 over height h */
    cove(o0, o1, h, n = 5) { for (let i = 0; i <= n; i++) { const t = i / n; const a = t * Math.PI / 2; pts.push([o1 + (o0 - o1) * Math.cos(a) ** 1, y + h * Math.sin(a) ** 1]); } y += h; return api; },
    /** ovolo / cyma: S-curve from o0 to o1 */
    cyma(o0, o1, h, n = 7) { for (let i = 0; i <= n; i++) { const t = i / n; const s = t * t * (3 - 2 * t); pts.push([o0 + (o1 - o0) * s, y + h * t]); } y += h; return api; },
    get y() { return y; },
  };
  return api;
}

/** a classical statue pedestal: base mouldings, die, cornice (metres) */
export function pedestalGeometry({ w = 1.0, d = 1.0, h = 1.6, seed = 1, plinth = true } = {}) {
  const s = h / 1.6;
  const pb = profileBuilder();
  const k = (v) => v * s;
  pb.up(k(0.14), k(0.12)).up(k(0.1), k(0.03)).torus(k(0.06), k(0.035)).cove(k(0.06), k(0.02), k(0.05)).up(k(0.015), k(0.02)).cyma(k(0.015), 0, k(0.03));
  const dieTop = h - k(0.32);
  pb.up(0, dieTop - pb.y);
  pb.cyma(0, k(0.05), k(0.06)).up(k(0.05), k(0.02)).cyma(k(0.05), k(0.12), k(0.07)).up(k(0.13), k(0.09)).up(k(0.1), k(0.03)).up(k(0.1), 0.0);
  const g = mouldedBlock(pb.pts, w / 2 - 0.0, d / 2 - 0.0);
  return g;
}
