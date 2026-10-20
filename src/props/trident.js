// Trident emblem of Poseidon (pure Canvas2D, no three.js): embroidered / cast gold trident with barbed
// prongs, a bowed crossbar with scroll ends, a collar knop and a laurel spray under it (refs 2, 3, 5).
// Replaces athenaion's owl emblem.
//
//   drawTridentEmblem(ctx, cx, top, h, { mode:'color'|'height'|'mask', palette, spray:true, waves:false })
//       h = height of the emblem (prong tips → shaft end) in ctx units; width ≈ 0.62·h (0.8·h with spray)
//   makeTridentEmblemCanvas(sizePx, { mode, palette, background, spray, waves }) → canvas (sizePx square)
//   PALETTES.gold | bronze | navyGold
// 'height' mode = relief (raised bright, outline dark), good for normal maps of panels / shields.
// Everything is deterministic.

export const PALETTES = {
  // embroidered gold thread on navy wool
  gold: { fill: '#cfa24a', light: '#ecc977', dark: '#8c6323', line: '#4a3110', shine: '#f6e0a4' },
  // cast bronze relief
  bronze: { fill: '#9a7340', light: '#c49a5a', dark: '#5e4220', line: '#2e1f0e', shine: '#e0bd7c' },
  // navy ink (for a trident painted on a cream sail)
  navy: { fill: '#1d3266', light: '#2c4682', dark: '#121f45', line: '#0b1430', shine: '#3a5694' },
};

function inks(mode, pal) {
  if (mode === 'height') return { fill: '#b8b8b8', light: '#c8c8c8', dark: '#909090', line: '#4a4a4a', shine: '#d6d6d6', stitchA: 'rgba(255,255,255,0.22)', stitchB: 'rgba(0,0,0,0.16)' };
  if (mode === 'mask') return { fill: '#ffffff', light: '#ffffff', dark: '#ffffff', line: '#ffffff', shine: '#ffffff', stitchA: 'rgba(0,0,0,0)', stitchB: 'rgba(0,0,0,0)' };
  const p = pal || PALETTES.gold;
  return { ...p, stitchA: 'rgba(255,240,200,0.22)', stitchB: 'rgba(60,35,5,0.22)' };
}

function hash(n) {
  let h = (n | 0) * 0x27d4eb2d ^ 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** fill the current path with a gold gradient + satin stitches (embroidery look) */
function richFill(ctx, ink, mode, bbox, angle = 0.9, pitch = 0.012) {
  const [x0, y0, x1, y1] = bbox;
  if (mode === 'color') {
    const g = ctx.createLinearGradient(x0, y0, x1 * 0.35 + x0 * 0.65, y1);
    g.addColorStop(0, ink.light); g.addColorStop(0.5, ink.fill); g.addColorStop(1, ink.dark);
    ctx.fillStyle = g;
  } else ctx.fillStyle = ink.fill;
  ctx.fill();
  if (mode === 'mask') return;
  ctx.save();
  ctx.clip();
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.hypot(x1 - x0, y1 - y0) * 0.6 + 0.01;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  ctx.lineWidth = pitch * 0.45;
  let i = 0;
  for (let s = -r; s <= r; s += pitch, i++) {
    ctx.strokeStyle = i % 2 ? ink.stitchA : ink.stitchB;
    ctx.beginPath();
    ctx.moveTo(cx - dy * s - dx * r, cy + dx * s - dy * r);
    ctx.lineTo(cx - dy * s + dx * r, cy + dx * s + dy * r);
    ctx.stroke();
  }
  ctx.restore();
}

/** polygon outline of a polyline swept with half-width w(t) (t 0..1 along) */
function sweep(pts, w) {
  const L = [], R = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const hw = typeof w === 'function' ? w(i / (n - 1)) : w;
    L.push([pts[i][0] - ty * hw, pts[i][1] + tx * hw]);
    R.push([pts[i][0] + ty * hw, pts[i][1] - tx * hw]);
  }
  return L.concat(R.reverse());
}
function bez(a, c1, c2, b, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
      u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
  }
  return out;
}
function polyPath(ctx, poly) {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
}
function bboxOf(poly) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}
/** fill + outline one part */
function part(ctx, I, mode, poly, lw, angle) {
  polyPath(ctx, poly);
  if (mode !== 'mask') { ctx.lineWidth = lw * 1.6; ctx.strokeStyle = I.line; ctx.lineJoin = 'round'; ctx.stroke(); }
  polyPath(ctx, poly);
  richFill(ctx, I, mode, bboxOf(poly), angle);
}

/**
 * Trident in emblem units: prong tips at y = 0, shaft end at y = 1, x centred on 0.
 * Barbed spear head in the middle, two side prongs rising from a bowed crossbar with outward barbs.
 */
export function drawTrident(ctx, o = {}) {
  const mode = o.mode || 'color';
  const I = inks(mode, o.palette);
  const lw = o.lineWidth ?? 0.006;
  const sw = o.shaft ?? 0.038;         // shaft half-width
  const pw = o.prong ?? 0.032;         // prong half-width
  const S = o.spread ?? 0.245;         // side prong x
  const yBar = o.bar ?? 0.4;           // bottom of the crossbar bow
  const parts = [];
  // shaft (slight taper) from the crossbar to the butt
  parts.push([sweep([[0, yBar - 0.06], [0, 0.97]], (t) => sw * (1 - 0.15 * t)), 1.4]);
  // crossbar bow: U from the left prong root through the shaft and up to the right prong root
  const bow = bez([-S, 0.25], [-S, yBar + 0.02], [-0.06, yBar + 0.03], [0, yBar + 0.035], 18)
    .concat(bez([0, yBar + 0.035], [0.06, yBar + 0.03], [S, yBar + 0.02], [S, 0.25], 18).slice(1));
  parts.push([sweep(bow, (t) => pw * (1.05 + 0.35 * Math.sin(Math.PI * t))), 0.2]);
  // side prongs: straight up from the bow ends, a little outward lean at the tip
  for (const s of [-1, 1]) {
    const pr = bez([s * S, 0.27], [s * S, 0.2], [s * S * 1.01, 0.12], [s * S * 1.04, 0.085], 10);
    parts.push([sweep(pr, pw * 0.95), 1.5]);
    // barbed tip: point at the top, single outward barb hooking down
    const tx = s * S * 1.04, ty = 0.085;
    parts.push([[[tx, ty - 0.1], [tx + s * 0.04, ty - 0.01], [tx + s * 0.1, ty + 0.07], [tx + s * 0.05, ty + 0.045], [tx + s * pw * 0.9, ty + 0.035], [tx - s * pw * 1.05, ty + 0.035], [tx - s * pw * 1.25, ty - 0.01]], 1.2]);
  }
  // centre prong + spear head
  parts.push([sweep([[0, 0.1], [0, yBar]], pw * 1.05), 1.5]);
  parts.push([[[0, -0.02], [0.04, 0.05], [0.095, 0.145], [0.05, 0.125], [pw * 1.0, 0.14], [-pw * 1.0, 0.14], [-0.05, 0.125], [-0.095, 0.145], [-0.04, 0.05]], 1.2]);
  // collar under the bow: knop + two rings
  const collar = (y, rx, ry) => { const pts = []; for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push([Math.cos(a) * rx, y + Math.sin(a) * ry]); } return pts; };
  parts.push([collar(yBar + 0.08, 0.065, 0.038), 0.6]);
  parts.push([[[-0.07, yBar + 0.125], [0.07, yBar + 0.125], [0.062, yBar + 0.15], [-0.062, yBar + 0.15]], 0.3]);
  // butt knob
  parts.push([collar(0.975, 0.05, 0.03), 0.6]);
  for (const [poly, ang] of parts) part(ctx, I, mode, poly, lw, ang);
  // engraved centre line on the shaft and prongs (embroidery split stitch)
  if (mode !== 'mask') {
    ctx.save();
    ctx.lineWidth = lw * 0.8; ctx.strokeStyle = mode === 'height' ? '#7a7a7a' : I.dark; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(0, yBar + 0.16); ctx.lineTo(0, 0.93); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0.14); ctx.lineTo(0, yBar - 0.01); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

/** one laurel leaf (filled), at x,y pointing along angle ang */
function leaf(ctx, I, mode, lw, x, y, ang, len, w) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const P = (u, v) => [x + c * u - s * v, y + s * u + c * v];
  const poly = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; poly.push(P(t * len, Math.sin(Math.PI * t) * w * (1 - 0.3 * t))); }
  for (let i = 9; i > 0; i--) { const t = i / 10; poly.push(P(t * len, -Math.sin(Math.PI * t) * w * (1 - 0.3 * t))); }
  part(ctx, I, mode, poly, lw * 0.7, ang + 1.2);
  if (mode === 'color') { ctx.beginPath(); const a = P(len * 0.1, 0), b = P(len * 0.85, 0); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineWidth = lw * 0.6; ctx.strokeStyle = I.dark; ctx.stroke(); }
}

/** laurel spray: two curving branches from the shaft under the crossbar, curling outward and down */
export function drawSpray(ctx, o = {}) {
  const mode = o.mode || 'color';
  const I = inks(mode, o.palette);
  const lw = o.lineWidth ?? 0.006;
  const y0 = o.y ?? 0.6, span = o.span ?? 0.3;
  for (const s of [-1, 1]) {
    const br = bez([0, y0], [s * span * 0.35, y0 + 0.02], [s * span * 0.9, y0 + 0.03], [s * span, y0 + 0.15], 16);
    part(ctx, I, mode, sweep(br, (t) => 0.007 * (1 - 0.5 * t)), lw, 0.3);
    for (let k = 1; k < 7; k++) {
      const i = Math.round((k / 7) * 15), p = br[i], q = br[Math.min(15, i + 1)];
      const ta = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const len = 0.05 * (1 - 0.06 * k), wd = 0.014;
      leaf(ctx, I, mode, lw, p[0], p[1], ta - s * 0.9 - (s < 0 ? Math.PI : 0) * 0 + (hash(k * 7 + (s > 0 ? 3 : 0)) - 0.5) * 0.2, len, wd);
      leaf(ctx, I, mode, lw, p[0], p[1], ta + s * 0.9 + (hash(k * 11 + (s > 0 ? 5 : 0)) - 0.5) * 0.2, len * 0.9, wd);
    }
    // berry dots
    if (mode !== 'mask') for (let k = 0; k < 3; k++) { const p = br[4 + k * 4]; ctx.beginPath(); ctx.arc(p[0] + s * 0.012, p[1] + 0.022, 0.008, 0, Math.PI * 2); ctx.fillStyle = I.light; ctx.fill(); }
  }
}

/** stylised waves (three curls) under the emblem, used on panels and sails */
export function drawWaves(ctx, o = {}) {
  const mode = o.mode || 'color';
  const I = inks(mode, o.palette);
  const lw = o.lineWidth ?? 0.006;
  const y = o.y ?? 1.06, w = o.width ?? 0.7;
  for (let k = 0; k < 3; k++) {
    const x = -w / 2 + (k + 0.5) * (w / 3), r = w / 9;
    const pts = [];
    for (let i = 0; i <= 30; i++) { const t = i / 30; const a = Math.PI * (1 + 1.6 * t); const rr = r * (1 - 0.55 * t); pts.push([x + Math.cos(a) * rr + r * 0.2, y + Math.sin(a) * rr]); }
    part(ctx, I, mode, sweep(pts, (t) => 0.012 * (1 - 0.6 * t)), lw, 0.5);
  }
}

/**
 * Full emblem: trident (+ laurel spray, + optional waves) with its top at `top`, height h, centred at cx.
 * Spray adds ≈ 0.08·h below the trident's crossbar region (within h); waves add ≈ 0.12·h below h.
 */
export function drawTridentEmblem(ctx, cx, top, h, o = {}) {
  ctx.save();
  ctx.translate(cx, top);
  ctx.scale(h, h);
  const lw = (o.lineWidth ?? 0.0042 * 1);
  if (o.spray !== false) drawSpray(ctx, { ...o, lineWidth: lw, y: 0.66, span: 0.22 });
  drawTrident(ctx, { ...o, lineWidth: lw });
  if (o.waves) drawWaves(ctx, { ...o, lineWidth: lw });
  ctx.restore();
}

/** square canvas with the emblem centred (transparent background unless background given) */
export function makeTridentEmblemCanvas(size = 1024, o = {}) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = c.getContext('2d');
  if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, size, size); }
  else if (o.mode && o.mode !== 'color') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size); }
  const h = size * (o.waves ? 0.78 : 0.88);
  drawTridentEmblem(ctx, size / 2, size * 0.06, h, o);
  return c;
}
