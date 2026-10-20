// Canvas-drawn foliage atlases (no external assets). Two 2048² atlases, 4×4 cells of 512²:
//
//  CYPRESS atlas                                   LEAVES atlas
//   0..11  scale-leaf sprays (alpha)                0..3   olive twigs (lanceolate, two-tone silver)
//   12,13  dense cypress foliage patches (opaque)   4..6   holm-oak / broadleaf twigs
//   14     dense patch, darker (opaque)             7      broadleaf dense patch (opaque)
//   15     cypress bark (opaque)                    8..10  umbrella-pine needle tufts
//                                                   11     pine dense patch (opaque)
//                                                   12,13  maquis shrub twigs (lentisk / myrtle)
//                                                   14     olive dense patch (opaque)
//                                                   15     shrub dense patch (opaque)
//
// Textures are uploaded as DataTextures with hand-built, coverage-preserving mip chains so
// alpha-tested foliage does not thin out / go dark with distance.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';

export const ATLAS_SIZE = 2048;
export const GRID = 4;
const CELL = ATLAS_SIZE / GRID;

export const CYP = { sprays: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], patch: [12, 13], patchDark: 14, bark: 15 };
export const LEAF = {
  olive: [0, 1, 2, 3], broad: [4, 5, 6], broadPatch: 7, pine: [8, 9, 10], pinePatch: 11,
  shrub: [12, 13], olivePatch: 14, shrubPatch: 15,
};

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
const cellXY = (i) => [(i % GRID) * CELL, Math.floor(i / GRID) * CELL];

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixHex(a, b, t, j = 0) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((v, i) => Math.max(0, Math.min(255, Math.round((v + (B[i] - v) * t) * (1 + j)))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** dense opaque foliage patch made by stamping sprays from the atlas itself */
function stampPatch(ctx, src, cell, sprayCells, rng, o) {
  const [ox, oy] = cellXY(cell);
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  ctx.fillStyle = o.bg; ctx.fillRect(ox, oy, CELL, CELL);
  const n = o.count || 70;
  for (let i = 0; i < n; i++) {
    const t = i / n; // later = front = lighter
    const sc = (o.scale || 0.42) * (0.75 + rng.random() * 0.5);
    const x = ox + rng.random() * CELL, y = oy + rng.random() * CELL;
    const s = sprayCells[Math.floor(rng.random() * sprayCells.length)];
    const [sx, sy] = cellXY(s);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rng.random() - 0.5) * (o.rot || 0.7));
    ctx.filter = `brightness(${(0.45 + 0.75 * t * (0.7 + rng.random() * 0.4)).toFixed(3)})`;
    ctx.drawImage(src, sx, sy, CELL, CELL, -CELL * sc / 2, -CELL * sc * 0.75, CELL * sc, CELL * sc);
    // wrap-around copies so the patch tiles roughly
    ctx.restore();
  }
  ctx.filter = 'none';
  ctx.restore();
}

function drawBark(ctx, cell, rng, o) {
  const [ox, oy] = cellXY(cell);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  ctx.fillStyle = o.base; ctx.fillRect(ox, oy, CELL, CELL);
  // long fibrous strips
  for (let i = 0; i < 260; i++) {
    const x = ox + rng.random() * CELL;
    let y = oy - 20;
    ctx.strokeStyle = mixHex(o.dark, o.light, rng.random(), 0);
    ctx.globalAlpha = 0.35 + rng.random() * 0.5;
    ctx.lineWidth = 1 + rng.random() * (o.strip || 6);
    ctx.beginPath(); ctx.moveTo(x, y);
    let xx = x;
    while (y < oy + CELL + 20) { y += 18 + rng.random() * 30; xx += (rng.random() - 0.5) * 7; ctx.lineTo(xx, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ===================================================================== leaves
function leafPath(ctx, L, Wd, shape) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  if (shape === 'lance') {
    ctx.bezierCurveTo(Wd * 1.1, -L * 0.2, Wd * 1.0, -L * 0.62, 0, -L);
    ctx.bezierCurveTo(-Wd * 1.0, -L * 0.62, -Wd * 1.1, -L * 0.2, 0, 0);
  } else if (shape === 'ovate') {
    ctx.bezierCurveTo(Wd * 1.25, -L * 0.12, Wd * 1.2, -L * 0.75, 0, -L);
    ctx.bezierCurveTo(-Wd * 1.2, -L * 0.75, -Wd * 1.25, -L * 0.12, 0, 0);
  } else { // needle
    ctx.moveTo(-Wd * 0.5, 0); ctx.lineTo(0, -L); ctx.lineTo(Wd * 0.5, 0);
  }
  ctx.closePath();
}

function drawLeaf(ctx, x, y, ang, L, Wd, top, bot, under, shape, rng) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  leafPath(ctx, L, Wd, shape);
  const c = under ? bot : top;
  const g = ctx.createLinearGradient(0, 0, 0, -L);
  const j = (rng.random() - 0.5) * 0.5;
  g.addColorStop(0, mixHex(c[0], c[1], 0.0, j - 0.06));
  g.addColorStop(0.55, mixHex(c[0], c[1], 0.55, j));
  g.addColorStop(1, mixHex(c[0], c[1], 1.0, j + 0.04));
  ctx.fillStyle = g; ctx.fill();
  // midrib + edge shade (gives the leaf a folded look)
  ctx.strokeStyle = under ? 'rgba(235,238,220,0.35)' : 'rgba(20,24,10,0.35)';
  ctx.lineWidth = Math.max(0.8, Wd * 0.14);
  ctx.beginPath(); ctx.moveTo(0, -L * 0.03); ctx.lineTo(0, -L * 0.9); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-Wd * 0.9, -L * 0.2, -Wd * 0.85, -L * 0.6, 0, -L); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** twig with leaves. kind: olive | broad | shrub */
function drawTwig(ctx, cell, rng, kind) {
  const [ox, oy] = cellXY(cell);
  const P = {
    olive: { L: [46, 70], W: 0.13, shape: 'lance', top: ['#353f2a', '#6a7458'], bot: ['#959c8a', '#d2d5c4'], underP: 0.45, wood: '#5b5046', gap: [9, 15], ang: [0.35, 0.8], depth: 3, pairs: true },
    broad: { L: [34, 52], W: 0.32, shape: 'ovate', top: ['#1f2f14', '#3f5326'], bot: ['#5f6a4c', '#8e9878'], underP: 0.22, wood: '#4a3d30', gap: [8, 12], ang: [0.4, 1.0], depth: 3, pairs: false },
    shrub: { L: [20, 30], W: 0.36, shape: 'ovate', top: ['#25331a', '#4a5c2c'], bot: ['#56624a', '#7e8a6c'], underP: 0.25, wood: '#4a3f30', gap: [5, 8], ang: [0.4, 1.1], depth: 4, pairs: true },
  }[kind];
  const twigs = [];
  const grow = (x, y, ang, len, th, depth) => {
    const steps = Math.max(2, Math.ceil(len / 12));
    const pts = [[x, y]]; let a = ang;
    for (let i = 0; i < steps; i++) {
      a += (rng.random() - 0.5) * 0.18; a *= 0.985;
      x += Math.sin(a) * len / steps; y -= Math.cos(a) * len / steps;
      x = Math.max(ox + 30, Math.min(ox + CELL - 30, x)); y = Math.max(oy + 34, y);
      pts.push([x, y]);
    }
    twigs.push({ pts, th, depth, a });
    if (depth >= P.depth) return;
    const nk = depth === 0 ? 5 + rng.int(0, 2) : 2 + rng.int(0, 2);
    for (let k = 0; k < nk; k++) {
      const t = 0.18 + 0.75 * (k + rng.random() * 0.5) / nk;
      const idx = Math.floor(t * (pts.length - 1));
      const side = k % 2 ? 1 : -1;
      grow(pts[idx][0], pts[idx][1], a + side * (0.4 + rng.random() * 0.5), len * (0.55 - 0.25 * t) * (0.8 + rng.random() * 0.4), th * 0.62, depth + 1);
    }
  };
  grow(ox + CELL * (0.45 + rng.random() * 0.1), oy + CELL - 6, (rng.random() - 0.5) * 0.3, CELL * 0.82, kind === 'shrub' ? 5 : 6, 0);
  ctx.lineCap = 'round';
  for (const t of twigs) {
    ctx.strokeStyle = mixHex(P.wood, '#8a7d6c', t.depth * 0.18, 0); ctx.lineWidth = Math.max(1, t.th);
    ctx.beginPath(); ctx.moveTo(t.pts[0][0], t.pts[0][1]);
    for (const p of t.pts) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }
  // leaves along all twigs except the trunk base, more toward the tips
  const leaves = [];
  for (const t of twigs) {
    let acc = 0;
    for (let i = 1; i < t.pts.length; i++) {
      const [x0, y0] = t.pts[i - 1], [x1, y1] = t.pts[i];
      const sl = Math.hypot(x1 - x0, y1 - y0); const a = Math.atan2(x1 - x0, -(y1 - y0));
      acc += sl;
      const gap = P.gap[0] + rng.random() * (P.gap[1] - P.gap[0]);
      if (t.depth === 0 && i < t.pts.length * 0.35) continue;
      while (acc > gap) {
        acc -= gap;
        const f = 1 - acc / sl; const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
        const L = (P.L[0] + rng.random() * (P.L[1] - P.L[0])) * (0.75 + 0.25 * Math.min(1, t.depth / 2));
        const sides = P.pairs ? [-1, 1] : [rng.random() < 0.5 ? -1 : 1];
        for (const s of sides) {
          const la = a + s * (P.ang[0] + rng.random() * (P.ang[1] - P.ang[0]));
          leaves.push({ x, y, a: la, L, W: L * P.W * (0.85 + rng.random() * 0.3), under: rng.random() < P.underP, z: rng.random() });
        }
      }
    }
    // terminal leaves
    const e = t.pts[t.pts.length - 1];
    leaves.push({ x: e[0], y: e[1], a: t.a + (rng.random() - 0.5) * 0.3, L: P.L[1] * 0.8, W: P.L[1] * 0.8 * P.W, under: false, z: 1 });
  }
  leaves.sort((a, b) => a.z - b.z);
  for (const l of leaves) drawLeaf(ctx, l.x, l.y, l.a, l.L, l.W, P.top, P.bot, l.under, P.shape, rng);
}

function drawPineTuft(ctx, cell, rng) {
  const [ox, oy] = cellXY(cell);
  ctx.lineCap = 'round';
  // short twig with several needle bursts
  const bursts = 4 + rng.int(0, 2);
  const base = [ox + CELL * 0.5, oy + CELL * 0.97];
  ctx.strokeStyle = '#4e3b2c'; ctx.lineWidth = 7;
  const tips = [];
  for (let b = 0; b < bursts; b++) {
    const a = (b - (bursts - 1) / 2) * 0.45 + (rng.random() - 0.5) * 0.2;
    const len = CELL * (0.28 + rng.random() * 0.12);
    const tip = [base[0] + Math.sin(a) * len, base[1] - Math.cos(a) * len];
    ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.quadraticCurveTo(base[0] + Math.sin(a) * len * 0.3, base[1] - len * 0.6, tip[0], tip[1]); ctx.stroke();
    tips.push([tip, a]);
  }
  const needles = [];
  for (const [tip, a] of tips) {
    const n = 70 + rng.int(0, 30);
    for (let i = 0; i < n; i++) {
      const na = a + (rng.random() - 0.5) * 2.6;
      const L = CELL * (0.16 + rng.random() * 0.1);
      const sx = tip[0] - Math.sin(a) * rng.random() * 40, sy = tip[1] + Math.cos(a) * rng.random() * 40;
      needles.push({ sx, sy, na, L, z: rng.random() });
    }
  }
  needles.sort((p, q) => p.z - q.z);
  for (const nd of needles) {
    ctx.strokeStyle = mixHex('#2c3b1a', '#71803c', nd.z * 0.9, (rng.random() - 0.5) * 0.15);
    ctx.lineWidth = 1.6 + rng.random() * 0.8;
    const ex = nd.sx + Math.sin(nd.na) * nd.L, ey = nd.sy - Math.cos(nd.na) * nd.L;
    ctx.beginPath(); ctx.moveTo(nd.sx, nd.sy);
    ctx.quadraticCurveTo((nd.sx + ex) / 2 + Math.cos(nd.na) * 6, (nd.sy + ey) / 2 + 4, Math.max(ox + 2, Math.min(ox + CELL - 2, ex)), Math.max(oy + 2, ey));
    ctx.stroke();
  }
}

// ===================================================================== mips + texture
/** colour-dilate transparent texels and build a coverage-preserving mip chain */
function buildTexture(canvas, alphaRef = 0.5, opaqueCells = []) {
  const S = canvas.width;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, S, S);
  const d = new Uint8Array(img.data.buffer.slice(0));
  // 1. per-cell average colour → fill transparent texels (no dark fringes at lower mips)
  const covTarget = new Float32Array(GRID * GRID);
  for (let c = 0; c < GRID * GRID; c++) {
    const [ox, oy] = cellXY(c);
    let r = 0, g = 0, b = 0, n = 0, cov = 0;
    for (let y = oy; y < oy + CELL; y += 2) for (let x = ox; x < ox + CELL; x += 2) {
      const i = (y * S + x) * 4;
      if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    }
    if (n) { r /= n; g /= n; b /= n; }
    const opaque = opaqueCells.includes(c);
    const aRef = alphaRef * 255;
    for (let y = oy; y < oy + CELL; y++) {
      let i = (y * S + ox) * 4;
      for (let x = 0; x < CELL; x++, i += 4) {
        if (opaque) { d[i + 3] = 255; cov++; continue; }
        const a = d[i + 3];
        if (a < 250) {
          const k = a / 255, k1 = 1 - k;
          d[i] = d[i] * k + r * k1; d[i + 1] = d[i + 1] * k + g * k1; d[i + 2] = d[i + 2] * k + b * k1;
        }
        if (a > aRef) cov++;
      }
    }
    covTarget[c] = cov / (CELL * CELL);
  }
  const mips = [{ data: d, width: S, height: S }];
  // sRGB <-> linear LUTs for correct colour averaging
  const toLin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const LN = 4096, toS = new Uint8Array(LN + 1);
  for (let i = 0; i <= LN; i++) { const l = i / LN; const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; toS[i] = Math.max(0, Math.min(255, Math.round(c * 255))); }
  const hist = new Uint32Array(256);
  let prev = d, ps = S;
  while (ps > 1) {
    const ns = ps >> 1;
    const out = new Uint8Array(ns * ns * 4);
    const alpha = new Uint8Array(ns * ns);
    for (let y = 0; y < ns; y++) {
      let i0 = (y * 2 * ps) * 4, i1 = ((y * 2 + 1) * ps) * 4, o = y * ns * 4;
      for (let x = 0; x < ns; x++, i0 += 8, i1 += 8, o += 4) {
        out[o] = toS[((toLin[prev[i0]] + toLin[prev[i0 + 4]] + toLin[prev[i1]] + toLin[prev[i1 + 4]]) * 0.25 * LN) | 0];
        out[o + 1] = toS[((toLin[prev[i0 + 1]] + toLin[prev[i0 + 5]] + toLin[prev[i1 + 1]] + toLin[prev[i1 + 5]]) * 0.25 * LN) | 0];
        out[o + 2] = toS[((toLin[prev[i0 + 2]] + toLin[prev[i0 + 6]] + toLin[prev[i1 + 2]] + toLin[prev[i1 + 6]]) * 0.25 * LN) | 0];
        alpha[y * ns + x] = (prev[i0 + 3] + prev[i0 + 7] + prev[i1 + 3] + prev[i1 + 7] + 2) >> 2;
      }
    }
    // coverage preservation per cell: scale alpha so the fraction above alphaRef matches level 0
    const cs = ns / GRID;
    for (let c = 0; c < GRID * GRID; c++) {
      const cx = (c % GRID) * cs, cy = Math.floor(c / GRID) * cs;
      const x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.max(x0 + 1, Math.floor(cx + cs)), y1 = Math.max(y0 + 1, Math.floor(cy + cs));
      const target = covTarget[c];
      let scale = 1;
      if (cs >= 2 && target > 0.001 && target < 0.999) {
        hist.fill(0);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[alpha[y * ns + x]]++;
        const total = (x1 - x0) * (y1 - y0), want = target * total;
        let acc = 0, th = 255;
        for (let v = 255; v >= 1; v--) { acc += hist[v]; if (acc >= want) { th = v; break; } }
        scale = (alphaRef * 255) / Math.max(1, th - 0.5);
      }
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const v = alpha[y * ns + x] * scale;
        out[(y * ns + x) * 4 + 3] = v > 255 ? 255 : v;
      }
    }
    mips.push({ data: out, width: ns, height: ns });
    prev = out; ps = ns;
  }
  const tex = new THREE.DataTexture(mips[0].data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = mips;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

let _cyp = null, _leaf = null;

// ---------------------------------------------------------------- cypress foliage painter
// Albedo ramp of Cupressus sempervirens foliage, from the deep crown interior to sunlit young tips.
// (sRGB; the material multiplies by a neutral factor, lighting comes from the geometry normals)
const CYP_RAMP = ['#050705', '#0b100a', '#121a0e', '#1a2513', '#223018', '#2c3c1d', '#384a23', '#485b2b', '#5f6f36', '#7d8846'];
const rampCol = (l, j = 0) => {
  const li = Math.max(0, Math.min(0.999, l)) * (CYP_RAMP.length - 1);
  const i = Math.floor(li);
  return mixHex(CYP_RAMP[i], CYP_RAMP[Math.min(CYP_RAMP.length - 1, i + 1)], li - i, j);
};

/**
 * One sub-spray: an upward-pointing flame (base at x,y; height h; half-width w) made of scale-leaf
 * fronds fanning up from the base. L = overall brightness level (depth in the tuft + height).
 */
function drawSubSpray(ctx, x, y, w, h, ang, rng, L) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  const j = (rng.random() - 0.5) * 0.18; // per-spray brightness jitter
  const flame = (k) => {
    ctx.beginPath(); ctx.moveTo(-w * k, 0);
    ctx.bezierCurveTo(-w * 1.15 * k, -h * 0.42, -w * 0.4 * k, -h * 0.78, 0, -h * (0.96 + 0.04 * k));
    ctx.bezierCurveTo(w * 0.4 * k, -h * 0.78, w * 1.15 * k, -h * 0.42, w * k, 0);
    ctx.closePath();
  };
  ctx.fillStyle = rampCol(L * 0.3, j); flame(1.0); ctx.fill();
  ctx.fillStyle = rampCol(L * 0.5, j); flame(0.62); ctx.fill();
  ctx.lineCap = 'round';
  const nf = 6 + Math.floor(rng.random() * 5);
  const lw = Math.max(1.2, w * 0.2);
  for (let i = 0; i < nf; i++) {
    const s = (i + 0.5) / nf * 2 - 1;
    let px = s * w * 0.75 + (rng.random() - 0.5) * w * 0.25, py = -rng.random() * h * 0.25;
    let a = s * 0.42 + (rng.random() - 0.5) * 0.3;
    const len = h * (0.5 + rng.random() * 0.42) * (1 - Math.abs(s) * 0.35);
    const n = 5;
    const pts = [[px, py]];
    for (let k = 0; k < n; k++) { a = a * 0.86 + (rng.random() - 0.5) * 0.28; px += Math.sin(a) * len / n; py -= Math.cos(a) * len / n; pts.push([px, py]); }
    const front = 0.5 + 0.5 * (1 - Math.abs(s));
    // cord: darker base, lighter tip (two passes)
    for (let pass = 0; pass < 2; pass++) {
      const k0 = pass ? 2 : 0;
      ctx.strokeStyle = rampCol(L * (pass ? 0.78 : 0.55) * (0.8 + 0.3 * front) + (pass ? 0.08 : 0), j + (rng.random() - 0.5) * 0.1);
      ctx.lineWidth = lw * (pass ? 0.75 : 1.15);
      ctx.beginPath(); ctx.moveTo(pts[k0][0], pts[k0][1]);
      for (let k = k0 + 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
      ctx.stroke();
    }
    // scale-leaf branchlets (short ticks alternating along the cord)
    ctx.lineWidth = lw * 0.6;
    for (let k = 1; k < pts.length; k++) {
      const t = k / (pts.length - 1);
      const sd = k % 2 ? 1 : -1;
      const ta = a + sd * (0.55 + rng.random() * 0.35);
      const tl = h * 0.11 * (1.1 - t * 0.5);
      ctx.strokeStyle = rampCol(L * (0.5 + 0.45 * t) * (0.85 + 0.25 * front) + 0.05, j);
      ctx.beginPath(); ctx.moveTo(pts[k][0], pts[k][1]); ctx.lineTo(pts[k][0] + Math.sin(ta) * tl, pts[k][1] - Math.cos(ta) * tl); ctx.stroke();
    }
    // bright young tip
    const e = pts[pts.length - 1];
    ctx.fillStyle = rampCol(Math.min(1, L * 0.95 + 0.18), j);
    ctx.beginPath(); ctx.ellipse(e[0], e[1], lw * 0.55, lw * 1.1, a, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/**
 * A cypress tuft card (one cell): flame-shaped, ragged-edged mass of 26-40 sub-sprays, back/low ones
 * dark, front/high ones lit; deep gaps between sub-sprays. Alpha = silhouette.
 */
function drawTuft(ctx, ox, oy, W, H, rng, o = {}) {
  const cx = ox + W / 2, base = oy + H * 0.99, top = oy + H * 0.015;
  const wide = o.wide || 0.4;
  const lean = (rng.random() - 0.5) * 0.12;
  const env = (t) => W * wide * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.8 + 0.16)), 0.6) * (1 - 0.3 * t);
  const X = (t, k) => cx + lean * t * W * 0.5 + k * env(t);
  const Y = (t) => base - t * (base - top);
  // dark ragged underlay (the shadowed interior seen between sprays)
  ctx.fillStyle = rampCol(0.03);
  ctx.beginPath();
  const N = 24;
  for (let i = 0; i <= N; i++) { const t = i / N * 0.93; ctx.lineTo(X(t, -0.72 - 0.15 * rng.random()), Y(t)); }
  for (let i = N; i >= 0; i--) { const t = i / N * 0.93; ctx.lineTo(X(t, 0.72 + 0.15 * rng.random()), Y(t)); }
  ctx.fill();
  const subs = [];
  const n = o.n || 32;
  for (let i = 0; i < n; i++) {
    const t = Math.min(0.9, Math.pow(rng.random(), 0.85) * 0.92);
    const k = (rng.random() * 2 - 1) * 0.78;
    const sh = H * (0.2 + rng.random() * 0.14) * (1 - 0.35 * t);
    subs.push({ t, k, w: W * (0.07 + rng.random() * 0.05) * (1 - 0.3 * t), h: sh, a: k * 0.3 + lean + (rng.random() - 0.5) * 0.3, z: rng.random() });
  }
  // the tip sub-spray
  subs.push({ t: 0.66, k: 0, w: W * 0.08, h: H * 0.34, a: lean, z: 1 });
  // back (low z) first; within equal depth, upper first so lower sprays overlap their bases
  subs.sort((p, q) => (p.z - p.t * 0.3) - (q.z - q.t * 0.3));
  for (const s of subs) {
    const centre = 1 - Math.abs(s.k);
    const L = Math.max(0.1, Math.min(1, 0.22 + 0.32 * s.t + 0.25 * centre * s.z + 0.3 * s.z));
    const x = X(s.t, s.k), y = Y(s.t) + s.h * 0.55;
    // soft contact shadow so overlapping sprays separate
    ctx.globalAlpha = 0.55; ctx.fillStyle = rampCol(0.02);
    ctx.beginPath(); ctx.ellipse(x, y - s.h * 0.45, s.w * 1.25, s.h * 0.55, s.a, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    drawSubSpray(ctx, x, y, s.w, s.h, s.a, rng, L);
  }
}

/** dense opaque foliage patch (crown interior / blobs): sub-sprays over a dark background */
function drawPatch(ctx, cell, rng, o) {
  const [ox, oy] = cellXY(cell);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  ctx.fillStyle = rampCol(o.bg ?? 0.04); ctx.fillRect(ox, oy, CELL, CELL);
  const n = o.count || 260;
  const subs = [];
  for (let i = 0; i < n; i++) subs.push({ x: rng.random() * 1.1 - 0.05, y: rng.random() * 1.25 - 0.05, z: rng.random() });
  subs.sort((p, q) => p.z - q.z);
  for (const s of subs) {
    const h = CELL * (o.size || 0.13) * (0.7 + rng.random() * 0.6);
    const L = Math.max(0.08, Math.min(1, (o.lo ?? 0.18) + (o.hi ?? 0.62) * s.z * (0.75 + 0.5 * rng.random())));
    drawSubSpray(ctx, ox + s.x * CELL, oy + s.y * CELL, h * 0.36, h, (rng.random() - 0.5) * 0.5, rng, L);
  }
  ctx.restore();
}

export function cypressAtlas() {
  if (_cyp) return _cyp;
  const t0 = performance.now();
  const cv = makeCanvas(ATLAS_SIZE, ATLAS_SIZE);
  const ctx = cv.getContext('2d');
  const rng = new RNG('cypress-atlas-v3');
  for (const c of CYP.sprays) { const [ox, oy] = cellXY(c); drawTuft(ctx, ox + 4, oy + 3, CELL - 8, CELL - 6, rng, { wide: 0.34 + (c % 4) * 0.04, n: 28 + (c % 3) * 6 }); }
  const t1 = performance.now();
  drawPatch(ctx, CYP.patch[0], rng, { count: 300, size: 0.14, lo: 0.16, hi: 0.66 });
  drawPatch(ctx, CYP.patch[1], rng, { count: 380, size: 0.12, lo: 0.16, hi: 0.66 });
  drawPatch(ctx, CYP.patchDark, rng, { count: 260, size: 0.14, lo: 0.08, hi: 0.4, bg: 0.02 });
  drawBark(ctx, CYP.bark, rng, { base: '#4f4136', dark: '#2a211b', light: '#7d6c5c', strip: 7 });
  const t2 = performance.now();
  _cyp = buildTexture(cv, 0.5, [...CYP.patch, CYP.patchDark, CYP.bark]);
  _cyp.name = 'cypressAtlas';
  console.log(`[vegetation] cypress atlas ${Math.round(performance.now() - t0)} ms (tufts ${Math.round(t1 - t0)}, patches ${Math.round(t2 - t1)}, mips ${Math.round(performance.now() - t2)})`);
  return _cyp;
}


export function leafAtlas() {
  if (_leaf) return _leaf;
  const t0 = performance.now();
  const cv = makeCanvas(ATLAS_SIZE, ATLAS_SIZE);
  const ctx = cv.getContext('2d');
  const rng = new RNG('leaf-atlas');
  for (const c of LEAF.olive) drawTwig(ctx, c, rng, 'olive');
  for (const c of LEAF.broad) drawTwig(ctx, c, rng, 'broad');
  for (const c of LEAF.pine) drawPineTuft(ctx, c, rng);
  for (const c of LEAF.shrub) drawTwig(ctx, c, rng, 'shrub');
  const src = makeCanvas(ATLAS_SIZE, ATLAS_SIZE);
  src.getContext('2d').drawImage(cv, 0, 0);
  stampPatch(ctx, src, LEAF.olivePatch, LEAF.olive, rng, { bg: '#2a3020', count: 60, scale: 0.55, rot: 2.5 });
  stampPatch(ctx, src, LEAF.broadPatch, LEAF.broad, rng, { bg: '#121b0c', count: 70, scale: 0.5, rot: 2.5 });
  stampPatch(ctx, src, LEAF.pinePatch, LEAF.pine, rng, { bg: '#162010', count: 60, scale: 0.55, rot: 1.6 });
  stampPatch(ctx, src, LEAF.shrubPatch, LEAF.shrub, rng, { bg: '#141c0e', count: 70, scale: 0.5, rot: 2.5 });
  _leaf = buildTexture(cv, 0.5, [LEAF.olivePatch, LEAF.broadPatch, LEAF.pinePatch, LEAF.shrubPatch]);
  _leaf.name = 'leafAtlas';
  console.log(`[vegetation] leaf atlas ${Math.round(performance.now() - t0)} ms`);
  return _leaf;
}

/** debug: the raw canvases (for dumping the atlases to PNG during development) */
export function debugAtlasCanvas(which) {
  const tex = which === 'leaf' ? leafAtlas() : cypressAtlas();
  const S = ATLAS_SIZE, cv = makeCanvas(S, S), ctx = cv.getContext('2d');
  const id = ctx.createImageData(S, S); id.data.set(tex.mipmaps[0].data); ctx.putImageData(id, 0, 0);
  return cv;
}
