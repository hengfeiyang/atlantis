// Canvas-drawn leaf atlases (no external images). Ivy: 16 variants of Hedera helix leaves
// (3- and 5-lobed juvenile leaves, heart-shaped base, pale palmate veins, glossy dark green,
// young yellow-green and old bronzed leaves). Each 256² cell holds one leaf; ATLAS_INFO gives the
// petiole attach point (u,v in cell units) and the leaf's extent so 3D cards can be placed exactly.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';

export const IVY_CELLS = 4;           // 4x4 cells
export const IVY_INFO = [];          // per variant: { attach:[u,v], tip:[u,v] }
let ivyTex = null;

function ivyOutline(rng, lobes) {
  // polar outline around the leaf centre c (cell coords, y up), angles from +x
  const tipAmp = rng.range(0.40, 0.50), latAmp = lobes >= 3 ? rng.range(0.26, 0.34) : 0.08;
  const basAmp = lobes >= 5 ? rng.range(0.13, 0.20) : 0.02;
  const latAng = rng.range(0.25, 0.55), basAng = rng.range(-0.55, -0.25);
  const asym = rng.range(-0.08, 0.08);
  const lobesA = [
    { a: Math.PI / 2 + asym, amp: tipAmp, w: rng.range(0.55, 0.7) },
    { a: latAng + asym, amp: latAmp, w: rng.range(0.45, 0.6) },
    { a: Math.PI - latAng + asym, amp: latAmp * rng.range(0.85, 1.1), w: rng.range(0.45, 0.6) },
    { a: basAng, amp: basAmp, w: 0.5 },
    { a: Math.PI - basAng, amp: basAmp * rng.range(0.8, 1.15), w: 0.5 },
  ];
  const r0 = rng.range(0.20, 0.24);
  const pts = [];
  const N = 120;
  for (let i = 0; i < N; i++) {
    const th = -Math.PI / 2 + (i / N) * Math.PI * 2;
    let r = r0;
    for (const L of lobesA) {
      let d = Math.abs(((th - L.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const x = d / L.w;
      if (x < 1) r = Math.max(r, r0 + L.amp * Math.pow(1 - x, 1.55));
    }
    // cordate notch at the petiole (bottom)
    const dn = Math.abs(((th + Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    r *= 1 - 0.42 * Math.exp(-(dn * dn) / 0.03);
    r *= 1 + 0.025 * Math.sin(th * 23 + rng.range(0, 6));
    pts.push([Math.cos(th) * r, Math.sin(th) * r]);
  }
  return { pts, lobesA, r0, notchR: r0 * 0.58 };
}

function drawIvyLeaf(ctx, x0, y0, S, rng, variant) {
  const lobes = variant % 4 === 3 ? 3 : variant % 5 === 4 ? 4 : 5;
  const { pts, lobesA, notchR } = ivyOutline(rng, lobes);
  // fit outline into the cell
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (const [x, y] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const ext = Math.max(maxx - minx, maxy - miny);
  const k = (S * 0.94) / ext;
  const cx = x0 + S / 2 - ((minx + maxx) / 2) * k, cy = y0 + S / 2 + ((miny + maxy) / 2) * k; // canvas y down
  const P = (x, y) => [cx + x * k, cy - y * k];
  // palette
  const kind = rng.random();
  let base, light, vein;
  if (variant >= 13) { base = [92, 120, 34]; light = [130, 156, 52]; vein = [180, 196, 120]; }        // young, yellow-green
  else if (variant >= 11) { base = [44, 58, 22]; light = [80, 86, 34]; vein = [140, 140, 96]; }       // old, bronzed
  else { base = [26 + 12 * kind, 44 + 12 * kind, 18 + 6 * kind]; light = [46, 70, 28]; vein = [112, 132, 88]; }
  const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], i) => { const [px, py] = P(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.closePath();
  const [ncx, ncy] = P(0, 0);
  const g = ctx.createRadialGradient(ncx, ncy, 2, ncx, ncy, S * 0.55);
  g.addColorStop(0, css(light));
  g.addColorStop(0.5, css(base));
  g.addColorStop(1, css(base.map((v) => v * 0.8)));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  // mottling
  for (let i = 0; i < 60; i++) {
    const [px, py] = P(rng.range(-0.6, 0.6), rng.range(-0.4, 0.7));
    ctx.fillStyle = css(rng.chance(0.5) ? light : base.map((v) => v * 0.75), rng.range(0.05, 0.14));
    ctx.beginPath(); ctx.arc(px, py, rng.range(4, 16), 0, Math.PI * 2); ctx.fill();
  }
  // old leaves: a few yellow-brown spots
  if (variant >= 11 && variant < 13) for (let i = 0; i < 6; i++) {
    const [px, py] = P(rng.range(-0.4, 0.4), rng.range(-0.2, 0.6));
    ctx.fillStyle = css([150, 130, 60], 0.35);
    ctx.beginPath(); ctx.arc(px, py, rng.range(2, 6), 0, Math.PI * 2); ctx.fill();
  }
  // palmate veins: from the centre to every lobe tip, with secondary veins
  const vc = P(0, -notchR * 0.2);
  for (const L of lobesA) {
    if (L.amp < 0.05) continue;
    const r = 0.22 + L.amp * 0.92;
    const tx = Math.cos(L.a) * r, ty = Math.sin(L.a) * r;
    const [ex, ey] = P(tx, ty);
    ctx.strokeStyle = css(vein, 0.42);
    ctx.lineWidth = S * 0.012;
    ctx.beginPath(); ctx.moveTo(vc[0], vc[1]);
    ctx.quadraticCurveTo((vc[0] + ex) / 2 + rng.range(-3, 3), (vc[1] + ey) / 2 + rng.range(-3, 3), ex, ey);
    ctx.stroke();
    // secondary veins
    ctx.lineWidth = S * 0.005;
    ctx.strokeStyle = css(vein, 0.22);
    for (let s = 1; s <= 3; s++) {
      const f = s / 4.2;
      const bx = vc[0] + (ex - vc[0]) * f, by = vc[1] + (ey - vc[1]) * f;
      for (const sg of [-1, 1]) {
        const a = Math.atan2(ey - vc[1], ex - vc[0]) + sg * 0.75;
        const l = S * 0.09 * (1 - f * 0.6);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a) * l, by + Math.sin(a) * l); ctx.stroke();
      }
    }
  }
  // dark margin
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], i) => { const [px, py] = P(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.closePath();
  ctx.strokeStyle = css(base.map((v) => v * 0.6), 0.6);
  ctx.lineWidth = S * 0.008;
  ctx.stroke();
  ctx.restore();
  // attach point = notch bottom (petiole), tip = terminal lobe
  const [ax, ay] = P(0, -notchR);
  const tipR = 0.22 + lobesA[0].amp;
  const [tx, ty] = P(Math.cos(lobesA[0].a) * tipR, Math.sin(lobesA[0].a) * tipR);
  return { attach: [(ax - x0) / S, 1 - (ay - y0) / S], tip: [(tx - x0) / S, 1 - (ty - y0) / S] };
}

export function ivyAtlas() {
  if (ivyTex) return ivyTex;
  const S = 256, N = IVY_CELLS;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * N;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const rng = new RNG('ivy-atlas');
  IVY_INFO.length = 0;
  for (let i = 0; i < N * N; i++) {
    const cx = (i % N) * S, cy = Math.floor(i / N) * S;
    IVY_INFO.push(drawIvyLeaf(ctx, cx, cy, S, rng, i));
  }
  // bleed leaf colour into transparent texels so mip-mapping does not pull in black fringes
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  bleed(img.data, cv.width, cv.height, 4);
  ctx.putImageData(img, 0, 0);
  ivyTex = new THREE.CanvasTexture(cv);
  ivyTex.colorSpace = THREE.SRGBColorSpace;
  ivyTex.anisotropy = 4;
  ivyTex.generateMipmaps = true;
  ivyTex.minFilter = THREE.LinearMipmapLinearFilter;
  ivyTex.needsUpdate = true;
  return ivyTex;
}

/** dilate RGB of opaque texels into transparent neighbours (alpha untouched) */
function bleed(d, w, h, iters) {
  for (let it = 0; it < iters; it++) {
    const src = new Uint8ClampedArray(d);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] > 8) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const o of [-4, 4, -w * 4, w * 4]) { if (src[i + o + 3] > 8 || (it > 0 && (src[i + o] | src[i + o + 1] | src[i + o + 2]))) { r += src[i + o]; g += src[i + o + 1]; b += src[i + o + 2]; n++; } }
      if (n) { d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; }
    }
  }
}

/** UV rectangle of variant i: [u0, v0, u1, v1] (three's uv origin = bottom-left; canvas flipY default) */
export function ivyCell(i) {
  const N = IVY_CELLS, cx = i % N, cy = Math.floor(i / N);
  return [cx / N, 1 - (cy + 1) / N, (cx + 1) / N, 1 - cy / N];
}
