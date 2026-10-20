// Banner artwork (pure Canvas2D, no three.js): deep navy wool with gold embroidery.
//   drawBanner(ctx, W, H, mode, style) draws one layer of the banner into a W×H px canvas.
//   mode: 'color' (albedo + alpha), 'height' (embroidery relief), 'mask' (gold thread = white)
//   style: {
//     aspect   : H/W of the cloth incl. fringe (computed from W,H if omitted)
//     bottom   : 'v' | 'straight'         V-point (refs 1,2,3,9) or straight hem (refs 5,6)
//     header   : 'band' | 'swag' | 'plain' top decoration (ref 6 band, ref 3 swags)
//     loops    : bool                      hanging tabs over a rod at the top (ref 3)
//     fringe   : fringe length in banner widths (≈0.12–0.3)
//     text     : bool                      ΑΘΗΝΑ legend
//   }
// Layout units are banner widths (u = W px). Returns layout info (where the cloth top/bottom are).
import { drawOwlEmblem, PALETTES } from './owl.js';

const NAVY = '#181f3a';
const NAVY_DEEP = '#161c34';

function inks(mode) {
  if (mode === 'height') return { cloth: '#5a5a5a', gold: '#b4b4b4', goldL: '#c8c8c8', goldD: '#8c8c8c', line: '#505050', navy: '#5a5a5a', hole: 'rgba(0,0,0,0)' };
  if (mode === 'mask') return { cloth: '#000000', gold: '#ffffff', goldL: '#ffffff', goldD: '#ffffff', line: '#000000', navy: '#000000', hole: 'rgba(0,0,0,0)' };
  const p = PALETTES.gold;
  return { cloth: NAVY, gold: p.fill, goldL: p.light, goldD: p.dark, line: p.line, navy: NAVY_DEEP, hole: 'rgba(0,0,0,0)' };
}

function h01(n) {
  let h = (n | 0) * 0x27d4eb2d ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Compute the vertical layout (in banner widths) for a style. */
export function bannerLayout(style) {
  const A = style.aspect ?? 2.9;
  const fringe = style.fringe ?? 0.2;
  const loopH = style.loops ? 0.11 : 0;
  const vDepth = style.bottom === 'v' ? 0.3 : 0;
  const top = loopH;
  const headerH = style.header === 'band' ? 0.24 : style.header === 'swag' ? 0.26 : 0.1;
  const owlH = style.sideBand ? 0.7 : 0.8;
  const emblemH = 1.74 * owlH;            // owl top → text baseline
  const textGap = style.text === false ? -0.3 : 0;
  const bottomEdge = A - fringe;          // V point / straight hem
  const sideEnd = bottomEdge - vDepth;    // where the side edges meet the V
  const minBelow = 0.3;
  const free = sideEnd - (top + headerH + 0.12 + emblemH + textGap + minBelow);
  const above = Math.max(0, free) * 0.6, below = Math.max(0, free) * 0.4;
  const emblemTop = top + headerH + 0.12 + above;
  return { A, fringe, loopH, vDepth, top, headerH, owlH, emblemTop, textBase: emblemTop + emblemH, bottomEdge, sideEnd, below, free };
}

/** silhouette of the cloth (no fringe, no loops) in banner-width units */
function clothPath(ctx, L, style) {
  ctx.beginPath();
  ctx.moveTo(0, L.top);
  ctx.lineTo(1, L.top);
  if (style.bottom === 'v') {
    ctx.lineTo(1, L.sideEnd);
    ctx.lineTo(0.5, L.bottomEdge);
    ctx.lineTo(0, L.sideEnd);
  } else {
    ctx.lineTo(1, L.bottomEdge);
    ctx.lineTo(0, L.bottomEdge);
  }
  ctx.closePath();
}

/** y of the bottom edge at x (0..1) */
function bottomAt(L, style, x) {
  if (style.bottom !== 'v') return L.bottomEdge;
  return L.sideEnd + (L.bottomEdge - L.sideEnd) * (1 - Math.abs(x - 0.5) * 2);
}

// twisted gold cord along a polyline (pts in units), width w
function cord(ctx, I, mode, pts, w) {
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.lineWidth = w * 1.25; ctx.strokeStyle = mode === 'mask' ? I.gold : I.line; if (mode === 'color') ctx.globalAlpha = 0.65; ctx.stroke(); ctx.globalAlpha = 1;
  ctx.lineWidth = w; ctx.strokeStyle = I.gold; ctx.stroke();
  if (mode !== 'mask') {
    // twist: short diagonal dark/light ticks along the cord
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay); if (len < 1e-6) continue;
      const tx = (bx - ax) / len, ty = (by - ay) / len, nx = -ty, ny = tx;
      const step = w * 0.55;
      for (let s = (step - (acc % step)) % step; s < len; s += step) {
        const cx = ax + tx * s, cy = ay + ty * s;
        ctx.beginPath();
        ctx.moveTo(cx - nx * w * 0.5 - tx * w * 0.25, cy - ny * w * 0.5 - ty * w * 0.25);
        ctx.lineTo(cx + nx * w * 0.5 + tx * w * 0.25, cy + ny * w * 0.5 + ty * w * 0.25);
        ctx.lineWidth = w * 0.16; ctx.strokeStyle = I.line; ctx.globalAlpha = mode === 'color' ? 0.55 : 0.8; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - nx * w * 0.3 - tx * w * 0.08, cy - ny * w * 0.3 - ty * w * 0.08);
        ctx.lineTo(cx + nx * w * 0.2 + tx * w * 0.1, cy + ny * w * 0.2 + ty * w * 0.1);
        ctx.lineWidth = w * 0.12; ctx.strokeStyle = I.goldL; ctx.globalAlpha = 0.6; ctx.stroke();
        ctx.globalAlpha = 1;
      }
      acc += len;
    }
  }
  ctx.restore();
}

function thinLine(ctx, I, pts, w) {
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.lineWidth = w; ctx.strokeStyle = I.gold; ctx.stroke();
}

// Greek key (meander) running along x from x0 to x1, centred at y, height h
function meander(ctx, I, mode, x0, x1, y, h) {
  const unit = h; // one key module is h wide
  const n = Math.max(1, Math.floor((x1 - x0) / unit));
  const s = (x1 - x0) / n;
  const w = h * 0.13;
  ctx.save();
  ctx.lineWidth = w; ctx.strokeStyle = mode === 'mask' ? I.gold : I.gold; ctx.lineCap = 'square'; ctx.lineJoin = 'miter';
  for (let i = 0; i < n; i++) {
    const x = x0 + i * s, k = s / 1.0;
    const t = y - h * 0.5;
    ctx.beginPath();
    // classic single meander: in, up, right, down, left, up
    ctx.moveTo(x, t + h * 0.85);
    ctx.lineTo(x + k * 0.8, t + h * 0.85);
    ctx.lineTo(x + k * 0.8, t + h * 0.15);
    ctx.lineTo(x + k * 0.2, t + h * 0.15);
    ctx.lineTo(x + k * 0.2, t + h * 0.6);
    ctx.lineTo(x + k * 0.55, t + h * 0.6);
    ctx.lineTo(x + k * 0.55, t + h * 0.38);
    ctx.stroke();
  }
  ctx.restore();
}

/** wide embroidered gold side borders (long wall banners, ref 1) */
function drawSideBands(ctx, I, mode, L, style) {
  const sb = style.sideBand;
  const yEnd = style.bottom === 'v' ? L.sideEnd + 0.02 : L.bottomEdge;
  for (const side of [0, 1]) {
    const x0 = side ? 1 - sb : 0;
    ctx.beginPath(); ctx.rect(x0, L.top, sb, yEnd - L.top);
    if (mode === 'color') {
      const g = ctx.createLinearGradient(x0, 0, x0 + sb, 0);
      g.addColorStop(0, I.goldD); g.addColorStop(0.35, I.gold); g.addColorStop(0.6, I.goldL); g.addColorStop(1, I.goldD);
      ctx.fillStyle = g;
    } else ctx.fillStyle = I.gold;
    ctx.fill();
    if (mode === 'mask') continue;
    // woven pattern: running chevrons + a fine inner rule
    ctx.save(); ctx.beginPath(); ctx.rect(x0, L.top, sb, yEnd - L.top); ctx.clip();
    const step = sb * 0.9;
    ctx.lineWidth = sb * 0.09; ctx.strokeStyle = mode === 'height' ? '#8a8a8a' : I.goldD;
    for (let y = L.top + 0.02; y < yEnd; y += step) {
      ctx.beginPath(); ctx.moveTo(x0 + sb * 0.18, y); ctx.lineTo(x0 + sb * 0.5, y + step * 0.45); ctx.lineTo(x0 + sb * 0.82, y); ctx.stroke();
      ctx.beginPath(); ctx.arc(x0 + sb * 0.5, y + step * 0.75, sb * 0.08, 0, Math.PI * 2); ctx.fillStyle = mode === 'height' ? '#d0d0d0' : I.goldL; ctx.fill();
    }
    ctx.restore();
    const xi = side ? x0 - 0.004 : x0 + sb + 0.004;
    thinLine(ctx, { gold: I.line }, [[xi, L.top + 0.02], [xi, yEnd]], 0.006);
  }
}

function drawHeader(ctx, I, mode, L, style) {
  const y0 = L.top + 0.035;
  if (style.header === 'band') {
    // solid gold band with a navy meander, dagged (pendant) lower edge
    const bh = 0.15;
    ctx.beginPath(); ctx.rect(0.035, y0, 0.93, bh);
    if (mode === 'color') {
      const g = ctx.createLinearGradient(0, y0, 0, y0 + bh);
      g.addColorStop(0, I.goldL); g.addColorStop(0.5, I.gold); g.addColorStop(1, I.goldD);
      ctx.fillStyle = g;
    } else ctx.fillStyle = I.gold;
    ctx.fill();
    // meander in navy on the band
    const II = { ...I, gold: mode === 'mask' ? '#000000' : mode === 'height' ? '#707070' : I.navy };
    meander(ctx, II, mode, 0.07, 0.93, y0 + bh * 0.5, bh * 0.62);
    // thin edging lines
    thinLine(ctx, { gold: mode === 'mask' ? '#fff' : I.line }, [[0.035, y0 + 0.012], [0.965, y0 + 0.012]], 0.006);
    thinLine(ctx, { gold: mode === 'mask' ? '#fff' : I.line }, [[0.035, y0 + bh - 0.012], [0.965, y0 + bh - 0.012]], 0.006);
    // pendants (small rounded tongues hanging from the band)
    const n = 9;
    for (let i = 0; i < n; i++) {
      const x = 0.035 + (i + 0.5) * (0.93 / n);
      ctx.beginPath();
      ctx.moveTo(x - 0.035, y0 + bh);
      ctx.lineTo(x - 0.03, y0 + bh + 0.04);
      ctx.quadraticCurveTo(x, y0 + bh + 0.075, x + 0.03, y0 + bh + 0.04);
      ctx.lineTo(x + 0.035, y0 + bh);
      ctx.closePath();
      ctx.fillStyle = I.gold; ctx.fill();
      if (mode !== 'mask') { ctx.lineWidth = 0.004; ctx.strokeStyle = I.line; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, y0 + bh + 0.035, 0.009, 0, Math.PI * 2);
      ctx.fillStyle = mode === 'mask' ? I.gold : I.line; ctx.fill();
    }
  } else if (style.header === 'swag') {
    // three leafy festoons hanging between four rosettes, a medallion in the middle
    const yR = y0 + 0.04, sag = 0.11;
    const xs = [0.1, 0.36, 0.64, 0.9];
    for (let i = 0; i < 3; i++) {
      const a = xs[i], b = xs[i + 1];
      const pts = [];
      for (let k = 0; k <= 24; k++) { const t = k / 24; pts.push([a + (b - a) * t, yR + sag * Math.sin(Math.PI * t)]); }
      // garland: thick gold line with leaf ticks
      thinLine(ctx, I, pts, 0.022);
      if (mode !== 'mask') {
        for (let k = 1; k < 24; k += 1) {
          const [px, py] = pts[k];
          ctx.beginPath(); ctx.ellipse(px, py, 0.014, 0.006, (k % 2 ? 0.7 : -0.7) + (h01(k + i * 31) - 0.5) * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = k % 2 ? I.goldL : I.goldD; ctx.fill();
        }
      }
      // ribbon tails
    }
    for (const x of xs) {
      ctx.beginPath(); ctx.arc(x, yR, 0.022, 0, Math.PI * 2); ctx.fillStyle = I.gold; ctx.fill();
      if (mode !== 'mask') { ctx.lineWidth = 0.005; ctx.strokeStyle = I.line; ctx.stroke(); ctx.beginPath(); ctx.arc(x, yR, 0.008, 0, Math.PI * 2); ctx.fillStyle = I.line; ctx.fill(); }
      thinLine(ctx, I, [[x, yR + 0.02], [x - 0.008, yR + 0.07]], 0.008);
      thinLine(ctx, I, [[x, yR + 0.02], [x + 0.008, yR + 0.075]], 0.008);
    }
    // central medallion with a small owl head motif → a gorgoneion-like disc
    ctx.beginPath(); ctx.arc(0.5, yR + 0.055, 0.05, 0, Math.PI * 2); ctx.fillStyle = I.gold; ctx.fill();
    if (mode !== 'mask') {
      ctx.lineWidth = 0.005; ctx.strokeStyle = I.line; ctx.stroke();
      ctx.beginPath(); ctx.arc(0.5, yR + 0.055, 0.036, 0, Math.PI * 2); ctx.stroke();
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(0.5 + s * 0.014, yR + 0.05, 0.009, 0, Math.PI * 2); ctx.fillStyle = I.line; ctx.fill(); }
    }
    thinLine(ctx, I, [[0.035, y0 - 0.005], [0.965, y0 - 0.005]], 0.008);
  } else {
    thinLine(ctx, I, [[0.035, y0], [0.965, y0]], 0.01);
    if (mode !== 'mask') for (let i = 0; i < 18; i++) { ctx.beginPath(); ctx.arc(0.07 + i * 0.05, y0 + 0.03, 0.007, 0, Math.PI * 2); ctx.fillStyle = I.gold; ctx.fill(); }
  }
}

function drawBottomBorder(ctx, I, mode, L, style) {
  // two thin gold lines following the bottom edge with a row of lozenges between them
  const inset1 = 0.035, inset2 = 0.1;
  const edge = (x, inset) => {
    if (style.bottom !== 'v') return L.bottomEdge - inset;
    // offset the V edge inward by `inset` (perpendicular), approx: shift up by inset / cos(angle)
    const slope = (L.bottomEdge - L.sideEnd) / 0.5; const k = Math.sqrt(1 + slope * slope);
    return bottomAt(L, style, x) - inset * k;
  };
  const xs = []; for (let i = 0; i <= 60; i++) xs.push(0.035 + (0.93 * i) / 60);
  for (const inset of [inset1, inset2]) thinLine(ctx, I, xs.map((x) => [x, edge(x, inset)]), 0.008);
  // lozenges + dots
  const n = 15;
  for (let i = 0; i < n; i++) {
    const x = 0.06 + (0.88 * (i + 0.5)) / n;
    const y = edge(x, (inset1 + inset2) / 2);
    const slope = style.bottom === 'v' ? (x < 0.5 ? 1 : -1) * (L.bottomEdge - L.sideEnd) / 0.5 : 0;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan(slope));
    ctx.beginPath(); ctx.moveTo(-0.022, 0); ctx.lineTo(0, -0.02); ctx.lineTo(0.022, 0); ctx.lineTo(0, 0.02); ctx.closePath();
    ctx.fillStyle = I.gold; ctx.fill();
    if (mode !== 'mask') { ctx.beginPath(); ctx.arc(0, 0, 0.005, 0, Math.PI * 2); ctx.fillStyle = I.line; ctx.fill(); }
    ctx.restore();
  }
}

function drawFringe(ctx, I, mode, L, style, pxPerUnit) {
  // individual twisted cords hanging straight down from the bottom edge, bundled tassel heads
  const pitch = 0.024, len = L.fringe * 0.96;
  const n = Math.floor(0.98 / pitch);
  for (let i = 0; i <= n; i++) {
    const x = 0.01 + i * pitch;
    const y0 = bottomAt(L, style, x) - 0.012;
    const l = len * (0.9 + 0.12 * h01(i * 3 + 1));
    const sway = (h01(i * 7 + 2) - 0.5) * 0.012;
    const w = 0.0145;
    // cord
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.quadraticCurveTo(x + sway * 0.5, y0 + l * 0.5, x + sway, y0 + l);
    ctx.lineWidth = w; ctx.strokeStyle = mode === 'color' ? I.goldD : I.gold; ctx.lineCap = 'round'; ctx.stroke();
    if (mode === 'color') {
      ctx.lineWidth = w * 0.45; ctx.strokeStyle = I.gold; ctx.stroke();
      // twist highlights
      for (let s = 0.05; s < 0.95; s += 0.06) {
        const yy = y0 + l * s, xx = x + sway * s * s;
        ctx.beginPath(); ctx.moveTo(xx - w * 0.45, yy); ctx.lineTo(xx + w * 0.45, yy + w * 0.5);
        ctx.lineWidth = w * 0.18; ctx.strokeStyle = I.goldL; ctx.stroke();
      }
    } else if (mode === 'height') {
      ctx.lineWidth = w * 0.4; ctx.strokeStyle = '#d0d0d0'; ctx.stroke();
    }
    // knot (tassel head) near the top of every second cord
    if (i % 2 === 0) {
      ctx.beginPath(); ctx.ellipse(x + sway * 0.05, y0 + 0.03, w * 0.9, 0.014, 0, 0, Math.PI * 2);
      ctx.fillStyle = mode === 'color' ? I.gold : I.goldL; ctx.fill();
    }
  }
  // the heading band of the fringe (woven gimp) along the edge
  const pts = []; for (let i = 0; i <= 60; i++) { const x = i / 60; pts.push([x, bottomAt(L, style, x) - 0.004]); }
  cord(ctx, I, mode, pts, 0.03);
}

function drawLoops(ctx, I, mode, L) {
  const n = 6, w = 0.085;
  for (let i = 0; i < n; i++) {
    const x = 0.04 + (i * (0.92 - w)) / (n - 1);
    ctx.beginPath(); ctx.rect(x, 0.0, w, L.top + 0.02);
    ctx.fillStyle = I.cloth; ctx.fill();
    // gold edging on the loop
    ctx.lineWidth = 0.008; ctx.strokeStyle = I.gold;
    ctx.beginPath(); ctx.moveTo(x + 0.006, L.top + 0.01); ctx.lineTo(x + 0.006, 0.004); ctx.lineTo(x + w - 0.006, 0.004); ctx.lineTo(x + w - 0.006, L.top + 0.01); ctx.stroke();
  }
}

/**
 * Draw one layer of the banner.
 * @returns layout (banner-width units) + {pxPerUnit}
 */
export function drawBanner(ctx, W, H, mode, style = {}) {
  const L = bannerLayout({ ...style, aspect: style.aspect ?? H / W });
  const I = inks(mode);
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  if (mode !== 'color') { ctx.fillStyle = mode === 'height' ? '#000000' : '#000000'; ctx.fillRect(0, 0, W, H); }
  ctx.scale(W, W);
  ctx.lineJoin = 'round';

  if (style.loops) drawLoops(ctx, I, mode, L);
  // cloth field
  clothPath(ctx, L, style);
  if (mode === 'color') {
    const g = ctx.createLinearGradient(0, L.top, 0, L.bottomEdge);
    g.addColorStop(0, '#1a213d'); g.addColorStop(0.5, NAVY); g.addColorStop(1, '#151b33');
    ctx.fillStyle = g;
  } else ctx.fillStyle = I.cloth;
  ctx.fill();

  ctx.save();
  clothPath(ctx, L, style); ctx.clip();
  // inner fine border line (double rule) around the field
  const ins = 0.055;
  const inner = [[ins, L.top + 0.02], [ins, L.sideEnd - (style.bottom === 'v' ? 0.02 : 0.12)]];
  thinLine(ctx, I, inner, 0.006);
  thinLine(ctx, I, inner.map(([x, y]) => [1 - x, y]), 0.006);
  if (style.sideBand) drawSideBands(ctx, I, mode, L, style);
  drawHeader(ctx, I, mode, L, style);
  // emblem
  drawOwlEmblem(ctx, 0.5, L.emblemTop, L.owlH, { mode: mode === 'color' ? 'color' : mode, text: style.text !== false });
  drawBottomBorder(ctx, I, mode, L, style);
  ctx.restore();

  // edge cords (sides + top + bottom edge)
  const cw = 0.026;
  const sideL = [[cw * 0.5, L.top + 0.004], [cw * 0.5, style.bottom === 'v' ? L.sideEnd : L.bottomEdge]];
  const sideR = sideL.map(([x, y]) => [1 - x, y]);
  cord(ctx, I, mode, sideL, cw);
  cord(ctx, I, mode, sideR, cw);
  cord(ctx, I, mode, [[0, L.top + cw * 0.4], [1, L.top + cw * 0.4]], cw * 0.9);
  drawFringe(ctx, I, mode, L, style, W);
  ctx.restore();
  return { ...L, pxPerUnit: W };
}
