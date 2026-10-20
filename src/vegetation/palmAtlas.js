// Date-palm atlases (canvas-drawn, no external assets).
//
// palmAtlas()  2048² RGBA, regions (canvas y down):
//   STRIP[0..3]  y = k*320 .. +320, x 0..2048 : half-frond strips for frond cards. The rachis runs along the
//                BOTTOM edge (v = rachis side), base at x = 0, tip at x = 2048; leaflets slant toward the tip.
//                strip 3 is a dry / old (brown-gold) frond.
//   LEAFLET[0,1] x 0..256 / 256..512, y 1280..2048 : straightened single leaflet (u across, v along: base at
//                the bottom), opaque — mapped onto the tapered leaflet geometry of the hero LOD.
//   LEAFLET[2]   x 512..768 : dry leaflet (old fronds)
//   PETIOLE      x 768..1024 : petiole / frond base (yellow-green → straw)
//   DATES        x 1024..1280 : packed amber-orange dates (fruit clusters)
//   FIBRE        x 1280..1536 : crown fibre / leaf-sheath (tan, fibrous)
//
// impostorAtlas(variants) 2048×1024: 8×2 cells of 256×512, a side view of every palm variant painted
// from its own skeleton (far-LOD camera-facing billboards; trunk base at the bottom centre).
//
// Textures carry coverage-preserving mip chains (alpha-tested leaflets must not thin out with distance).
import * as THREE from 'three';
import { RNG } from '../core/rng.js';

export const PALM_ATLAS = 2048;
export const STRIP_H = 320;
const S = PALM_ATLAS;

/** uv rects [u0, v0, u1, v1] in texture space (v0 = top of the region in canvas space, flipY = false) */
const R = (x, y, w, h) => [x / S, y / S, (x + w) / S, (y + h) / S];
export const PALM = {
  strip: [0, 1, 2, 3].map((k) => R(0, k * STRIP_H, S, STRIP_H)),
  leaflet: [R(4, 1284, 248, 760), R(260, 1284, 248, 760), R(516, 1284, 248, 760)],
  petiole: R(772, 1284, 248, 760),
  dates: R(1028, 1284, 248, 760),
  fibre: R(1284, 1284, 248, 760),
};
const REGIONS = [
  ...[0, 1, 2, 3].map((k) => ({ x: 0, y: k * STRIP_H, w: S, h: STRIP_H, opaque: false })),
  ...[0, 1, 2, 3, 4, 5].map((k) => ({ x: k * 256, y: 1280, w: 256, h: 768, opaque: true })),
];

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function mix(a, b, t, j = 0) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((v, i) => Math.max(0, Math.min(255, Math.round((v + (B[i] - v) * t) * (1 + j)))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
/** sample a colour ramp (array of hex) at t∈[0,1] */
function ramp(cols, t, j = 0) {
  const x = Math.max(0, Math.min(0.9999, t)) * (cols.length - 1), i = Math.floor(x);
  return mix(cols[i], cols[Math.min(cols.length - 1, i + 1)], x - i, j);
}

// leaflet albedo ramps (sRGB): dark base/shaded side → sunlit young green. Phoenix leaflets are a glaucous,
// slightly yellow green; the refs push them toward a saturated deep green with gold-lit tips.
const GREEN = ['#1d2a12', '#2b3c18', '#3b5020', '#4d6427', '#62792f', '#7a8e3a'];
const GREEN2 = ['#222c14', '#33421b', '#465623', '#5b6b2b', '#727f33', '#8c963e'];
const DRY = ['#3a2a14', '#5a4020', '#7a5a2c', '#9a7638', '#b89548', '#cdb060'];

/** profile of leaflet length along the frond (u = 0 base of the leafy part .. 1 tip), 0..1 */
export function leafletProfile(u) {
  const a = Math.min(1, u / 0.22);
  return (0.32 + 0.68 * a * a * (3 - 2 * a)) * (1 - 0.72 * Math.pow(u, 1.6));
}
export const LEAFY0 = 0.15; // fraction of the frond that is bare petiole

/** one half-frond strip: rachis along the bottom edge */
function drawStrip(ctx, k, rng, dry) {
  const y0 = k * STRIP_H, H = STRIP_H, base = y0 + H - 7;
  const cols = dry ? DRY : k % 2 ? GREEN2 : GREEN;
  ctx.save(); ctx.beginPath(); ctx.rect(0, y0, S, H); ctx.clip();
  const leaflets = [];
  const n = 96;
  for (let i = 0; i < n; i++) {
    for (const plane of [0, 1]) {
      // two leaflet planes (Phoenix leaflets fan out of the frond plane in alternating groups)
      const u = (i + rng.random() * 0.6 + plane * 0.5) / n;
      if (plane === 1 && rng.chance(0.25)) continue;
      const x = (LEAFY0 + (1 - LEAFY0) * u) * S * 0.985;
      const prof = leafletProfile(u) * (0.86 + 0.18 * rng.random()) * (plane ? 0.82 : 1);
      const h = prof * (H - 14);
      const ang = (34 + 14 * (1 - u) + (plane ? 10 : 0) + (rng.random() - 0.5) * 10) * Math.PI / 180;  // to the rachis
      const dx = h / Math.tan(ang) * 0.84;
      leaflets.push({ x, h, dx, w: (10 + 6 * (1 - u)) * (0.85 + 0.3 * rng.random()), sag: (rng.random() * 0.12 + 0.04) * h, z: plane ? rng.random() * 0.5 : 0.5 + rng.random() * 0.5, u, tone: rng.random(), brown: dry ? 1 : rng.chance(0.06) ? rng.range(0.3, 0.8) : 0 });
    }
  }
  leaflets.sort((a, b) => a.z - b.z);
  for (const l of leaflets) {
    const bx = l.x, by = base;
    const tx = bx + l.dx, ty = by - l.h;
    // control point: leaflets bend slightly toward the tip direction (sag) near their ends
    const cx = bx + l.dx * 0.42, cy = by - l.h * 0.55 - l.sag * 0.3;
    const ex = tx + l.sag * 0.6, ey = ty + l.sag;
    const nx = -(ey - by), ny = ex - bx, nl = Math.hypot(nx, ny) || 1;
    const wx = (nx / nl) * l.w * 0.5, wy = (ny / nl) * l.w * 0.5;
    const shade = l.z * 0.55 + 0.45 * l.tone;
    const g = ctx.createLinearGradient(bx, by, ex, ey);
    const c0 = ramp(cols, 0.3 + 0.35 * shade), c1 = ramp(cols, 0.48 + 0.48 * shade), c2 = ramp(cols, 0.58 + 0.42 * shade);
    g.addColorStop(0, c0); g.addColorStop(0.5, c1);
    g.addColorStop(1, l.brown ? mix('#7a5a2c', '#b89548', l.tone) : c2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(bx - wx * 0.7, by - wy * 0.7);
    ctx.quadraticCurveTo(cx - wx, cy - wy, ex, ey);
    ctx.quadraticCurveTo(cx + wx, cy + wy, bx + wx * 0.7, by + wy * 0.7);
    ctx.closePath(); ctx.fill();
    // folded midrib: lit on one side, shaded on the other
    ctx.strokeStyle = `rgba(230,235,170,${(0.18 + 0.2 * l.z).toFixed(2)})`;
    ctx.lineWidth = Math.max(1.2, l.w * 0.14);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(cx + wx, cy + wy, ex, ey); ctx.quadraticCurveTo(cx, cy, bx, by); ctx.fill();
  }
  // rachis (along the bottom edge): straw-green, tapering
  const rg = ctx.createLinearGradient(0, 0, S, 0);
  rg.addColorStop(0, dry ? '#8a6a3a' : '#9a9a50'); rg.addColorStop(1, dry ? '#6a5028' : '#5a6a2c');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.moveTo(0, base - 9); ctx.lineTo(S, base - 2); ctx.lineTo(S, base + 3); ctx.lineTo(0, base + 7); ctx.closePath(); ctx.fill();
  // petiole spines on the bare base
  ctx.strokeStyle = dry ? '#5a4220' : '#6f7238'; ctx.lineWidth = 3;
  for (let i = 0; i < 16; i++) {
    const x = (0.03 + 0.12 * i / 16) * S; const h = 22 + rng.random() * 30;
    ctx.beginPath(); ctx.moveTo(x, base - 6); ctx.lineTo(x + h * 0.5, base - 6 - h); ctx.stroke();
  }
  ctx.restore();
}

/** straightened leaflet (u across, base at the bottom): midrib, veins, edge darkening */
function drawLeaflet(ctx, x0, y0, w, h, rng, cols, dry) {
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  const g = ctx.createLinearGradient(0, y0 + h, 0, y0);
  g.addColorStop(0, ramp(cols, 0.25)); g.addColorStop(0.4, ramp(cols, 0.6)); g.addColorStop(0.85, ramp(cols, 0.78)); g.addColorStop(1, dry ? '#9a7638' : ramp(cols, 0.7));
  ctx.fillStyle = g; ctx.fillRect(x0, y0, w, h);
  // across: the fold (one half catches more light), dark edges
  const ga = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  ga.addColorStop(0, 'rgba(0,0,0,0.38)'); ga.addColorStop(0.18, 'rgba(0,0,0,0.08)'); ga.addColorStop(0.47, 'rgba(255,255,220,0.10)');
  ga.addColorStop(0.53, 'rgba(0,0,0,0.12)'); ga.addColorStop(0.8, 'rgba(0,0,0,0.22)'); ga.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = ga; ctx.fillRect(x0, y0, w, h);
  // longitudinal veins
  for (let i = 0; i < 26; i++) {
    const x = x0 + w * (0.08 + 0.84 * rng.random());
    ctx.strokeStyle = rng.chance(0.5) ? 'rgba(255,255,210,0.07)' : 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1 + rng.random() * 2;
    ctx.beginPath(); ctx.moveTo(x, y0 + h); ctx.lineTo(x + (rng.random() - 0.5) * 4, y0); ctx.stroke();
  }
  // midrib
  ctx.strokeStyle = dry ? 'rgba(220,190,120,0.5)' : 'rgba(215,220,150,0.45)'; ctx.lineWidth = w * 0.05;
  ctx.beginPath(); ctx.moveTo(x0 + w * 0.5, y0 + h); ctx.lineTo(x0 + w * 0.5, y0); ctx.stroke();
  // a few blemishes / dry tips
  if (!dry) {
    const tg = ctx.createLinearGradient(0, y0 + h * 0.12, 0, y0);
    tg.addColorStop(0, 'rgba(150,120,50,0)'); tg.addColorStop(1, 'rgba(150,120,50,0.55)');
    ctx.fillStyle = tg; ctx.fillRect(x0, y0, w, h * 0.12);
  }
  ctx.restore();
}

function drawPetiole(ctx, x0, y0, w, h, rng) {
  const g = ctx.createLinearGradient(0, y0 + h, 0, y0);
  g.addColorStop(0, '#8a7a48'); g.addColorStop(0.35, '#9a9a54'); g.addColorStop(1, '#6a7a32');
  ctx.fillStyle = g; ctx.fillRect(x0, y0, w, h);
  for (let i = 0; i < 60; i++) {
    const x = x0 + rng.random() * w;
    ctx.strokeStyle = rng.chance(0.5) ? 'rgba(255,250,200,0.12)' : 'rgba(40,30,10,0.14)'; ctx.lineWidth = 1 + rng.random() * 3;
    ctx.beginPath(); ctx.moveTo(x, y0 + h); ctx.lineTo(x, y0); ctx.stroke();
  }
  const ga = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  ga.addColorStop(0, 'rgba(0,0,0,0.35)'); ga.addColorStop(0.5, 'rgba(255,255,230,0.08)'); ga.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = ga; ctx.fillRect(x0, y0, w, h);
}

function drawDates(ctx, x0, y0, w, h, rng) {
  ctx.fillStyle = '#4a2a10'; ctx.fillRect(x0, y0, w, h);
  for (let i = 0; i < 420; i++) {
    const x = x0 + rng.random() * w, y = y0 + rng.random() * h, rx = 9 + rng.random() * 5, ry = rx * 1.5;
    const t = rng.random();
    const g = ctx.createRadialGradient(x - rx * 0.3, y - ry * 0.3, 1, x, y, ry);
    g.addColorStop(0, mix('#f0b040', '#e07a20', t)); g.addColorStop(0.6, mix('#c8701c', '#a24a14', t)); g.addColorStop(1, '#4a2410');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, (rng.random() - 0.5) * 0.6, 0, Math.PI * 2); ctx.fill();
  }
}

function drawFibre(ctx, x0, y0, w, h, rng) {
  ctx.fillStyle = '#5a4630'; ctx.fillRect(x0, y0, w, h);
  for (let i = 0; i < 500; i++) {
    const x = x0 + rng.random() * w, y = y0 + rng.random() * h, a = (rng.random() - 0.5) * 1.4 + (rng.chance(0.5) ? 0.6 : -0.6), L = 20 + rng.random() * 60;
    ctx.strokeStyle = mix('#3a2a1a', '#a88a60', rng.random()); ctx.lineWidth = 1 + rng.random() * 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(a) * L, y - Math.cos(a) * L); ctx.stroke();
  }
}

// ------------------------------------------------------------------------------- texture + mips
/** colour-dilate transparent texels and build a coverage-preserving mip chain over rect regions */
function buildTexture(canvas, regions, alphaRef = 0.5) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, W, H);
  const d = new Uint8Array(img.data.buffer.slice(0));
  const cov = [];
  for (const g of regions) {
    let r = 0, gg = 0, b = 0, n = 0, c = 0;
    for (let y = g.y; y < g.y + g.h; y += 2) for (let x = g.x; x < g.x + g.w; x += 2) {
      const i = (y * W + x) * 4; if (d[i + 3] > 128) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    }
    if (n) { r /= n; gg /= n; b /= n; }
    for (let y = g.y; y < g.y + g.h; y++) {
      let i = (y * W + g.x) * 4;
      for (let x = 0; x < g.w; x++, i += 4) {
        if (g.opaque) { d[i + 3] = 255; c++; continue; }
        const a = d[i + 3];
        if (a < 250) { const k = a / 255, k1 = 1 - k; d[i] = d[i] * k + r * k1; d[i + 1] = d[i + 1] * k + gg * k1; d[i + 2] = d[i + 2] * k + b * k1; }
        if (a > alphaRef * 255) c++;
      }
    }
    cov.push(c / (g.w * g.h));
  }
  const toLin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const LN = 4096, toS = new Uint8Array(LN + 1);
  for (let i = 0; i <= LN; i++) { const l = i / LN; const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; toS[i] = Math.max(0, Math.min(255, Math.round(c * 255))); }
  const mips = [{ data: d, width: W, height: H }];
  const hist = new Uint32Array(256);
  let prev = d, pw = W, ph = H, level = 0;
  while (pw > 1 || ph > 1) {
    const nw = Math.max(1, pw >> 1), nh = Math.max(1, ph >> 1);
    level++;
    const out = new Uint8Array(nw * nh * 4), alpha = new Uint8Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      const ya = Math.min(ph - 1, y * 2), yb = Math.min(ph - 1, y * 2 + 1);
      for (let x = 0; x < nw; x++) {
        const xa = Math.min(pw - 1, x * 2), xb = Math.min(pw - 1, x * 2 + 1);
        const i0 = (ya * pw + xa) * 4, i1 = (ya * pw + xb) * 4, i2 = (yb * pw + xa) * 4, i3 = (yb * pw + xb) * 4, o = (y * nw + x) * 4;
        for (let c = 0; c < 3; c++) out[o + c] = toS[((toLin[prev[i0 + c]] + toLin[prev[i1 + c]] + toLin[prev[i2 + c]] + toLin[prev[i3 + c]]) * 0.25 * LN) | 0];
        alpha[y * nw + x] = (prev[i0 + 3] + prev[i1 + 3] + prev[i2 + 3] + prev[i3 + 3] + 2) >> 2;
      }
    }
    const k = 1 / (1 << level);
    regions.forEach((g, gi) => {
      const x0 = Math.floor(g.x * k), y0 = Math.floor(g.y * k);
      const x1 = Math.max(x0 + 1, Math.floor((g.x + g.w) * k)), y1 = Math.max(y0 + 1, Math.floor((g.y + g.h) * k));
      const target = cov[gi];
      let scale = 1;
      if ((x1 - x0) >= 2 && (y1 - y0) >= 2 && target > 0.001 && target < 0.999) {
        hist.fill(0);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[alpha[y * nw + x]]++;
        const want = target * (x1 - x0) * (y1 - y0);
        let acc = 0, th = 255;
        for (let v = 255; v >= 1; v--) { acc += hist[v]; if (acc >= want) { th = v; break; } }
        scale = (alphaRef * 255) / Math.max(1, th - 0.5);
      }
      for (let y = y0; y < Math.min(nh, y1); y++) for (let x = x0; x < Math.min(nw, x1); x++) {
        const v = alpha[y * nw + x] * scale; alpha[y * nw + x] = v > 255 ? 255 : v;
      }
    });
    for (let i = 0; i < nw * nh; i++) out[i * 4 + 3] = alpha[i];
    mips.push({ data: out, width: nw, height: nh });
    prev = out; pw = nw; ph = nh;
  }
  const tex = new THREE.DataTexture(mips[0].data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
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

let _palm = null;
export function palmAtlas() {
  if (_palm) return _palm;
  const t0 = performance.now();
  const cv = makeCanvas(S, S), ctx = cv.getContext('2d');
  const rng = new RNG('palm-atlas-v1');
  for (let k = 0; k < 4; k++) drawStrip(ctx, k, rng, k === 3);
  drawLeaflet(ctx, 0, 1280, 256, 768, rng, GREEN, false);
  drawLeaflet(ctx, 256, 1280, 256, 768, rng, GREEN2, false);
  drawLeaflet(ctx, 512, 1280, 256, 768, rng, DRY, true);
  drawPetiole(ctx, 768, 1280, 256, 768, rng);
  drawDates(ctx, 1024, 1280, 256, 768, rng);
  drawFibre(ctx, 1280, 1280, 256, 768, rng);
  _palm = buildTexture(cv, REGIONS);
  _palm.name = 'palmAtlas';
  _palm.userData.canvas = cv;
  console.log(`[vegetation] palm atlas ${Math.round(performance.now() - t0)} ms`);
  return _palm;
}

// ------------------------------------------------------------------------------- impostors
export const IMP = { W: 2048, H: 1024, cw: 256, ch: 512, cols: 8 };
/** uv rect of impostor cell i */
export const impRect = (i) => {
  const x = (i % IMP.cols) * IMP.cw, y = Math.floor(i / IMP.cols) * IMP.ch;
  return [(x + 2) / IMP.W, (y + 2) / IMP.H, (x + IMP.cw - 2) / IMP.W, (y + IMP.ch - 2) / IMP.H];
};
/**
 * Paint far-LOD side views. palms: [{ Hb, Rb, trunk:[[x,y,z]...], trunkR:[r...], fronds:[{pts:[[x,y,z]..], reach:[..], dry}] }]
 * The billboard quad spans x ∈ [-Rb, Rb], y ∈ [0, Hb]; the cell maps onto it 1:1.
 */
export function impostorAtlas(palms) {
  const t0 = performance.now();
  const cv = makeCanvas(IMP.W, IMP.H), ctx = cv.getContext('2d');
  const rng = new RNG('palm-imp-v1');
  const regions = [];
  palms.forEach((p, i) => {
    const ox = (i % IMP.cols) * IMP.cw, oy = Math.floor(i / IMP.cols) * IMP.ch;
    regions.push({ x: ox, y: oy, w: IMP.cw, h: IMP.ch, opaque: false });
    const sx = IMP.cw / (2 * p.Rb), sy = IMP.ch / p.Hb;
    const X = (x) => ox + IMP.cw / 2 + x * sx, Y = (y) => oy + IMP.ch - y * sy;
    ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, IMP.cw, IMP.ch); ctx.clip();
    // trunk
    ctx.fillStyle = '#5e5242';
    ctx.beginPath();
    const T = p.trunk;
    for (let k = 0; k < T.length; k++) ctx.lineTo(X(T[k][0] - p.trunkR[k] * 1.4), Y(T[k][1]));
    for (let k = T.length - 1; k >= 0; k--) ctx.lineTo(X(T[k][0] + p.trunkR[k] * 1.4), Y(T[k][1]));
    ctx.closePath(); ctx.fill();
    // fronds: back ones (z < 0) darker first, front ones lighter
    const fr = p.fronds.map((f) => ({ f, z: f.pts[f.pts.length - 1][2] })).sort((a, b) => a.z - b.z);
    for (const { f, z } of fr) {
      const zz = Math.max(-1, Math.min(1, z / (p.Rb * 0.8)));
      const lit = 0.25 + 0.4 * (zz * 0.5 + 0.5) + 0.25 * Math.max(0, f.pts[f.pts.length - 1][1] - f.pts[0][1]) / 4;
      const cols = f.dry ? DRY : GREEN;
      ctx.lineCap = 'round';
      for (let k = 1; k < f.pts.length; k++) {
        const a = f.pts[k - 1], b = f.pts[k];
        const reach = f.reach[k];
        // leaflet mass around the rachis: thick soft stroke, then leaflet ticks
        ctx.strokeStyle = ramp(cols, lit * 0.8, (rng.random() - 0.5) * 0.1);
        ctx.lineWidth = Math.max(1.5, reach * sx * 0.55);
        ctx.beginPath(); ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); ctx.stroke();
      }
      ctx.strokeStyle = ramp(cols, Math.min(1, lit + 0.15)); ctx.lineWidth = 1.2;
      for (let k = 1; k < f.pts.length; k++) {
        const a = f.pts[k - 1], b = f.pts[k], reach = f.reach[k];
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        for (let s = 0; s < 6; s++) {
          const t = (s + rng.random()) / 6, px = a[0] + dx * t, py = a[1] + dy * t;
          for (const sd of [-1, 1]) {
            ctx.beginPath(); ctx.moveTo(X(px), Y(py));
            ctx.lineTo(X(px + (dx / l) * reach * 0.6 - sd * (dy / l) * reach), Y(py + (dy / l) * reach * 0.6 + sd * (dx / l) * reach - reach * 0.3));
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();
  });
  const tex = buildTexture(cv, regions);
  tex.name = 'palmImpostors';
  console.log(`[vegetation] palm impostors ×${palms.length} ${Math.round(performance.now() - t0)} ms`);
  return tex;
}
