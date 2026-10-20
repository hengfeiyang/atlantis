// Athena's owl emblem, drawn procedurally with Canvas2D (no assets, no three.js dependency).
//
// The design follows the classical Athenian tetradrachm owl seen on every banner in the
// references: body in three-quarter profile standing right, head turned to face the viewer
// (big round eyes under frowning brows, ear tufts), long folded wing sweeping to the tail,
// feathered breast, short feathered legs with splayed claws, a small olive sprig beside the feet,
// all inside an open laurel wreath whose stems cross under the bird. Optional legend ΑΘΗΝΑ.
//
// Reusable by other modules (shield reliefs, mosaics, coins...):
//
//   import { drawOwlEmblem, makeOwlEmblemCanvas, drawGreekText, PALETTES } from '../props/owl.js';
//   drawOwlEmblem(ctx, cx, cy, size, { mode: 'color', text: true });   // size = emblem height in px
//   const cnv = makeOwlEmblemCanvas(1024, { mode: 'height' });          // transparent canvas
//
// Modes (opts.mode):
//   'color'  : gold embroidery colours (or opts.palette = PALETTES.bronze / PALETTES.marble / custom)
//   'height' : greyscale relief (raised = bright, engraved lines = dark) → feed to a normal map
//   'mask'   : white where the emblem is, black elsewhere (for metalness / gilding masks)
// Everything is deterministic (seeded hash, no Math.random).

// ------------------------------------------------------------------------------------ palettes
export const PALETTES = {
  // embroidered gold thread on navy wool
  gold: { fill: '#c8a14f', light: '#e2c27a', dark: '#8a6526', line: '#4a3312', shine: '#f3dca0' },
  // cast bronze relief (shields)
  bronze: { fill: '#9a7340', light: '#c49a5a', dark: '#5e4220', line: '#2e1f0e', shine: '#e0bd7c' },
  // mosaic / marble inlay: dark stone on light
  marble: { fill: '#3d3a36', light: '#5a554f', dark: '#26231f', line: '#efe7d8', shine: '#6b655d' },
};

function hash(n) { // deterministic [0,1)
  let h = (n | 0) * 0x27d4eb2d ^ 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Colour resolver: in height/mask mode every role maps to a grey level.
function inks(mode, pal) {
  if (mode === 'height') return { fill: '#b8b8b8', light: '#c8c8c8', dark: '#909090', line: '#4a4a4a', shine: '#d6d6d6', stitchA: 'rgba(255,255,255,0.22)', stitchB: 'rgba(0,0,0,0.16)' };
  if (mode === 'mask') return { fill: '#ffffff', light: '#ffffff', dark: '#ffffff', line: '#d0d0d0', shine: '#ffffff', stitchA: 'rgba(255,255,255,0)', stitchB: 'rgba(0,0,0,0)' };
  const p = pal || PALETTES.gold;
  return { ...p, stitchA: 'rgba(255,240,200,0.20)', stitchB: 'rgba(60,35,5,0.20)' };
}

// ------------------------------------------------------------------------------------ helpers
/** Fill the current path with a vertical gold gradient + satin-stitch hatching (embroidery look). */
function richFill(ctx, ink, mode, bbox, angle = 0.9, pitch = 0.0105) {
  const [x0, y0, x1, y1] = bbox;
  if (mode === 'color') {
    const g = ctx.createLinearGradient(x0, y0, x1 * 0.3 + x0 * 0.7, y1);
    g.addColorStop(0, ink.light); g.addColorStop(0.55, ink.fill); g.addColorStop(1, ink.dark);
    ctx.fillStyle = g;
  } else ctx.fillStyle = ink.fill;
  ctx.fill();
  if (mode === 'mask') return;
  // satin stitches: fine parallel lines inside the shape
  ctx.save();
  ctx.clip();
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.hypot(x1 - x0, y1 - y0) * 0.6;
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

function line(ctx, ink, w, pts, close = false) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
  ctx.lineWidth = w; ctx.strokeStyle = ink; ctx.stroke();
}

function curve(ctx, ink, w, a, c1, c2, b) {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], b[0], b[1]);
  ctx.lineWidth = w; ctx.strokeStyle = ink; ctx.stroke();
}

// ------------------------------------------------------------------------------------ owl paths
// Owl units: head top at y = 0, toes at y ≈ 1.0, x centred on the body (≈ -0.3 … 0.36).
const HC = [0.05, 0.158]; // head centre

function pathBody(ctx) {
  ctx.beginPath();
  ctx.moveTo(0.175, 0.235);
  ctx.bezierCurveTo(0.275, 0.31, 0.29, 0.52, 0.205, 0.675);           // breast
  ctx.bezierCurveTo(0.175, 0.745, 0.105, 0.79, 0.025, 0.792);          // belly
  ctx.bezierCurveTo(-0.075, 0.80, -0.16, 0.86, -0.228, 0.925);          // under tail
  ctx.quadraticCurveTo(-0.25, 0.935, -0.245, 0.905);                     // rounded tail tip
  ctx.bezierCurveTo(-0.225, 0.83, -0.2, 0.73, -0.175, 0.6);             // tail top / back
  ctx.bezierCurveTo(-0.145, 0.45, -0.15, 0.3, -0.085, 0.235);           // back to nape
  ctx.closePath();
}

function pathWing(ctx) {
  ctx.beginPath();
  ctx.moveTo(-0.115, 0.268);
  ctx.bezierCurveTo(0.0, 0.29, 0.105, 0.37, 0.112, 0.49);
  ctx.bezierCurveTo(0.118, 0.6, 0.07, 0.69, -0.015, 0.765);
  ctx.bezierCurveTo(-0.09, 0.825, -0.16, 0.875, -0.222, 0.915);
  ctx.quadraticCurveTo(-0.24, 0.922, -0.236, 0.9);
  ctx.bezierCurveTo(-0.205, 0.78, -0.168, 0.63, -0.16, 0.48);
  ctx.bezierCurveTo(-0.156, 0.37, -0.152, 0.3, -0.115, 0.268);
  ctx.closePath();
}

function pathHead(ctx) {
  const [x, y] = HC;
  ctx.beginPath();
  ctx.moveTo(x - 0.152, y - 0.152);                                     // left ear tuft tip
  ctx.quadraticCurveTo(x - 0.07, y - 0.112, x, y - 0.116);              // brow line top
  ctx.quadraticCurveTo(x + 0.07, y - 0.112, x + 0.152, y - 0.152);      // right ear tuft tip
  ctx.bezierCurveTo(x + 0.192, y - 0.1, x + 0.198, y - 0.03, x + 0.186, y + 0.025);
  ctx.bezierCurveTo(x + 0.17, y + 0.11, x + 0.09, y + 0.152, x, y + 0.155); // chin
  ctx.bezierCurveTo(x - 0.09, y + 0.152, x - 0.17, y + 0.11, x - 0.186, y + 0.025);
  ctx.bezierCurveTo(x - 0.198, y - 0.03, x - 0.192, y - 0.1, x - 0.152, y - 0.152);
  ctx.closePath();
}

function drawLegs(ctx, ink, mode, lw) {
  const legs = [[0.045, 0.74, 0.905], [0.135, 0.725, 0.895]];
  for (const [lx, ly0, ly1] of legs) {
    const legPath = () => {
      ctx.beginPath();
      ctx.moveTo(lx - 0.03, ly0);
      ctx.bezierCurveTo(lx - 0.034, ly0 + 0.08, lx - 0.022, ly1 - 0.02, lx - 0.014, ly1);
      ctx.lineTo(lx + 0.016, ly1);
      ctx.bezierCurveTo(lx + 0.024, ly1 - 0.03, lx + 0.034, ly0 + 0.07, lx + 0.03, ly0);
      ctx.closePath();
    };
    legPath();
    richFill(ctx, ink, mode, [lx - 0.04, ly0, lx + 0.04, ly1], 1.57, 0.012);
    if (mode !== 'mask') {
      legPath(); ctx.lineWidth = lw; ctx.strokeStyle = ink.line; ctx.stroke();
      // feather "trousers" ticks
      for (let k = 0; k < 4; k++) {
        const yy = ly0 + 0.03 + k * 0.032;
        curve(ctx, ink.line, lw * 0.7, [lx - 0.02, yy], [lx - 0.01, yy + 0.012], [lx + 0.01, yy + 0.012], [lx + 0.02, yy]);
      }
    }
    // toes: three forward, one back, with hooked claws
    const ax = lx, ay = ly1 - 0.004;
    const toes = [[-0.07, 0.035], [-0.012, 0.058], [0.05, 0.05], [0.07, 0.006]];
    ctx.lineCap = 'round';
    for (const [tx, ty] of toes) {
      const ex = ax + tx, ey = ay + ty;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(ax + tx * 0.5, ay + ty * 0.2 - 0.004, ex, ey);
      if (mode !== 'mask') { ctx.lineWidth = 0.03; ctx.strokeStyle = ink.line; ctx.stroke(); }
      ctx.lineWidth = 0.019; ctx.strokeStyle = mode === 'color' ? ink.fill : ink.fill; ctx.stroke();
      // claw
      const s = Math.sign(tx) || 1;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.quadraticCurveTo(ex + s * 0.016, ey + 0.002, ex + s * 0.014, ey + 0.018);
      ctx.lineWidth = 0.011; ctx.strokeStyle = mode === 'mask' ? ink.fill : ink.line; ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
}

function drawBodyDetails(ctx, ink, lw) {
  // breast feathering: rows of small scallops ("v" chevrons) between wing and breast outline
  ctx.save();
  pathBody(ctx); ctx.clip();
  let n = 0;
  for (let row = 0; row < 11; row++) {
    const y = 0.30 + row * 0.04;
    for (let col = 0; col < 7; col++) {
      const x = -0.02 + col * 0.042 + (row % 2) * 0.021;
      const j = hash(++n) * 0.008;
      ctx.beginPath();
      ctx.moveTo(x - 0.016, y + j);
      ctx.quadraticCurveTo(x, y + 0.024 + j, x + 0.016, y + j);
      ctx.lineWidth = lw * 0.75; ctx.strokeStyle = ink.line; ctx.stroke();
    }
  }
  ctx.restore();
}

function drawWingDetails(ctx, ink, lw) {
  ctx.save();
  pathWing(ctx); ctx.clip();
  // covert feathers: rows of scallops following the wing's leading edge
  let n = 100;
  for (let row = 0; row < 4; row++) {
    const t0 = row * 0.055;
    for (let k = 0; k < 7; k++) {
      const x = -0.13 + k * 0.038 + (row % 2) * 0.019 - row * 0.012;
      const y = 0.31 + t0 + (x + 0.13) * 0.25 * (1 - row * 0.15);
      const j = hash(++n) * 0.006;
      ctx.beginPath();
      ctx.moveTo(x - 0.019, y);
      ctx.bezierCurveTo(x - 0.017, y + 0.03 + j, x + 0.017, y + 0.03 + j, x + 0.019, y);
      ctx.lineWidth = lw * 0.8; ctx.strokeStyle = ink.line; ctx.stroke();
    }
  }
  // division between coverts and flight feathers
  curve(ctx, ink.line, lw * 1.2, [-0.165, 0.52], [-0.08, 0.55], [0.03, 0.56], [0.115, 0.52]);
  // long flight feathers converging to the tail tip
  const tip = [-0.236, 0.905];
  for (let k = 0; k < 6; k++) {
    const sx = -0.15 + k * 0.045, sy = 0.535 + k * 0.006;
    const mx = (sx + tip[0]) / 2 + 0.035 + k * 0.006, my = (sy + tip[1]) / 2 - 0.02;
    curve(ctx, ink.line, lw * (k % 2 ? 0.7 : 1.0), [sx, sy], [mx, my - 0.05], [mx - 0.02, my + 0.08], [tip[0] + 0.02 + k * 0.006, tip[1] - 0.03 + k * 0.004]);
  }
  // feather tips notches along the lower edge
  for (let k = 0; k < 6; k++) {
    const t = k / 5;
    const x = -0.02 - t * 0.19, y = 0.76 + t * 0.13;
    line(ctx, ink.line, lw * 0.8, [[x, y], [x + 0.03, y - 0.045]]);
  }
  ctx.restore();
}

function drawHead(ctx, ink, mode, lw) {
  const [x, y] = HC;
  pathHead(ctx);
  richFill(ctx, ink, mode, [x - 0.2, y - 0.16, x + 0.2, y + 0.16], 0.4, 0.0095);
  if (mode === 'mask') return;
  ctx.lineWidth = lw; ctx.strokeStyle = ink.line; pathHead(ctx); ctx.stroke();
  // facial disc: fine radial ticks around each eye
  for (const s of [-1, 1]) {
    const ex = x + s * 0.072, ey = y + 0.012;
    ctx.save(); pathHead(ctx); ctx.clip();
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2;
      const r0 = 0.064, r1 = 0.064 + 0.018 + 0.006 * hash(k * 7 + (s > 0 ? 3 : 0));
      line(ctx, ink.line, lw * 0.5, [[ex + Math.cos(a) * r0, ey + Math.sin(a) * r0], [ex + Math.cos(a) * r1, ey + Math.sin(a) * r1]]);
    }
    ctx.restore();
    // eye: dark outer ring, gold iris, dark pupil, glint
    ctx.beginPath(); ctx.arc(ex, ey, 0.058, 0, Math.PI * 2);
    ctx.fillStyle = ink.line; ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, 0.047, 0, Math.PI * 2);
    ctx.fillStyle = mode === 'color' ? ink.light : ink.shine; ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, 0.036, 0, Math.PI * 2);
    ctx.lineWidth = lw * 0.6; ctx.strokeStyle = ink.dark; ctx.stroke();
    ctx.beginPath(); ctx.arc(ex + s * 0.002, ey + 0.002, 0.022, 0, Math.PI * 2);
    ctx.fillStyle = ink.line; ctx.fill();
    if (mode === 'color') { ctx.beginPath(); ctx.arc(ex - 0.008, ey - 0.009, 0.0065, 0, Math.PI * 2); ctx.fillStyle = ink.shine; ctx.fill(); }
  }
  // frowning brows: a bold "V" from the ear tufts down to the beak
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    curve(ctx, ink.line, lw * 2.0, [x + s * 0.148, y - 0.128], [x + s * 0.1, y - 0.085], [x + s * 0.045, y - 0.07], [x + s * 0.008, y - 0.035]);
  }
  ctx.lineCap = 'butt';
  // beak: small hooked triangle
  ctx.beginPath();
  ctx.moveTo(x - 0.018, y + 0.032);
  ctx.quadraticCurveTo(x, y + 0.018, x + 0.018, y + 0.032);
  ctx.quadraticCurveTo(x + 0.012, y + 0.07, x + 0.002, y + 0.092);
  ctx.quadraticCurveTo(x - 0.012, y + 0.07, x - 0.018, y + 0.032);
  ctx.closePath();
  ctx.fillStyle = mode === 'color' ? ink.dark : ink.dark; ctx.fill();
  ctx.lineWidth = lw * 0.8; ctx.strokeStyle = ink.line; ctx.stroke();
  // chin feathers
  for (let k = -2; k <= 2; k++) {
    const cx = x + k * 0.03, cy = y + 0.118 - Math.abs(k) * 0.008;
    curve(ctx, ink.line, lw * 0.6, [cx - 0.012, cy], [cx - 0.006, cy + 0.014], [cx + 0.006, cy + 0.014], [cx + 0.012, cy]);
  }
}

function drawSprig(ctx, ink, mode, lw, x, y, s = 1) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.lineCap = 'round';
  // stem
  ctx.beginPath(); ctx.moveTo(-0.03, 0.06); ctx.quadraticCurveTo(0.0, 0.0, 0.03, -0.07);
  ctx.lineWidth = 0.009; ctx.strokeStyle = mode === 'mask' ? ink.fill : ink.dark; ctx.stroke();
  // three olive leaves and two berries
  const leaves = [[0.0, 0.0, -0.9], [0.018, -0.035, 0.6], [-0.015, 0.03, 2.2]];
  for (const [lx, ly, a] of leaves) {
    ctx.save(); ctx.translate(lx, ly); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(0.025, -0.012, 0.055, 0); ctx.quadraticCurveTo(0.025, 0.012, 0, 0);
    ctx.fillStyle = ink.fill; ctx.fill();
    if (mode !== 'mask') { ctx.lineWidth = lw * 0.5; ctx.strokeStyle = ink.line; ctx.stroke(); }
    ctx.restore();
  }
  for (const [bx, by] of [[0.032, 0.01], [0.024, 0.026]]) {
    ctx.beginPath(); ctx.arc(bx, by, 0.011, 0, Math.PI * 2);
    ctx.fillStyle = mode === 'color' ? ink.light : ink.fill; ctx.fill();
    if (mode !== 'mask') { ctx.lineWidth = lw * 0.5; ctx.strokeStyle = ink.line; ctx.stroke(); }
  }
  ctx.restore();
}

/**
 * Draw the owl alone in owl units (head top y=0, toes y≈1). Caller sets the transform.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{mode?:'color'|'height'|'mask', palette?:object, lineWidth?:number, sprig?:boolean}} o
 */
export function drawOwl(ctx, o = {}) {
  const mode = o.mode || 'color';
  const ink = inks(mode, o.palette);
  const lw = o.lineWidth || 0.0085;
  ctx.save();
  ctx.lineJoin = 'round';
  drawLegs(ctx, ink, mode, lw);
  pathBody(ctx);
  richFill(ctx, ink, mode, [-0.28, 0.23, 0.29, 0.98], 1.15, 0.0105);
  if (mode !== 'mask') {
    drawBodyDetails(ctx, ink, lw);
    pathBody(ctx); ctx.lineWidth = lw * 1.1; ctx.strokeStyle = ink.line; ctx.stroke();
  }
  pathWing(ctx);
  richFill(ctx, ink, mode, [-0.26, 0.26, 0.12, 0.96], 2.0, 0.0105);
  if (mode !== 'mask') {
    drawWingDetails(ctx, ink, lw);
    pathWing(ctx); ctx.lineWidth = lw * 1.2; ctx.strokeStyle = ink.line; ctx.stroke();
  }
  drawHead(ctx, ink, mode, lw);
  if (o.sprig !== false) drawSprig(ctx, ink, mode, lw, 0.272, 0.845, 1.45);
  ctx.restore();
}

// ------------------------------------------------------------------------------------ laurel wreath
/**
 * Open laurel wreath: two branches rising from crossed stems at the bottom. Units: owl units,
 * centred at (cx, cy) with radius r. Leaves come in alternating pairs, shrinking toward the tips.
 */
export function drawLaurelWreath(ctx, o = {}) {
  const mode = o.mode || 'color';
  const ink = inks(mode, o.palette);
  const lw = o.lineWidth || 0.0085;
  const cx = o.cx ?? 0, cy = o.cy ?? 0, r = o.r ?? 0.5;
  const ry = r * (o.squash ?? 1.06);
  const gap = o.gap ?? 0.95;           // half-angle (rad) of the opening at the top
  const pairs = o.pairs ?? 10;
  const leafLen = o.leafLen ?? 0.125, leafW = o.leafW ?? 0.042;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const P = (a) => [cx + Math.sin(a) * r, cy + Math.cos(a) * ry]; // a = 0 at the bottom, ±π at the top
  for (const side of [-1, 1]) {
    const a0 = side * 0.12, a1 = side * (Math.PI - gap);
    // stem
    ctx.beginPath();
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const a = a0 + (a1 - a0) * (i / N);
      const p = P(a);
      i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
    }
    if (mode !== 'mask') { ctx.lineWidth = 0.022; ctx.strokeStyle = ink.line; ctx.stroke(); }
    ctx.lineWidth = 0.013; ctx.strokeStyle = mode === 'color' ? ink.fill : ink.fill; ctx.stroke();
    // leaves
    for (let i = 0; i < pairs; i++) {
      const t = (i + 0.6) / (pairs + 0.2);
      const a = a0 + (a1 - a0) * t;
      const p = P(a);
      // tangent toward the tip
      const q = P(a + (a1 - a0) * 0.01);
      const tang = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const sz = 1.0 - 0.38 * t;
      for (const k of [-1, 1]) {
        const ang = tang + k * 0.62 * side * -1 + (hash(i * 13 + (side > 0 ? 5 : 0) + k) - 0.5) * 0.12;
        const off = (k > 0 ? 0.008 : -0.008);
        drawLeaf(ctx, ink, mode, lw, p[0] + Math.cos(tang) * off * 2, p[1] + Math.sin(tang) * off * 2, ang, leafLen * sz, leafW * sz);
      }
    }
    // terminal bud leaf at the tip
    const pt = P(a1), qt = P(a1 + (a1 - a0) * 0.01);
    drawLeaf(ctx, ink, mode, lw, pt[0], pt[1], Math.atan2(qt[1] - pt[1], qt[0] - pt[0]), leafLen * 0.6, leafW * 0.6);
  }
  // crossed stems and a small knot at the bottom
  const b = P(0);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(b[0] - s * 0.012, b[1] - 0.04);
    ctx.quadraticCurveTo(b[0] + s * 0.03, b[1] + 0.02, b[0] + s * 0.085, b[1] + 0.05);
    if (mode !== 'mask') { ctx.lineWidth = 0.024; ctx.strokeStyle = ink.line; ctx.stroke(); }
    ctx.lineWidth = 0.014; ctx.strokeStyle = ink.fill; ctx.stroke();
  }
  ctx.beginPath(); ctx.ellipse(b[0], b[1] - 0.012, 0.022, 0.016, 0, 0, Math.PI * 2);
  ctx.fillStyle = mode === 'color' ? ink.light : ink.fill; ctx.fill();
  if (mode !== 'mask') { ctx.lineWidth = lw * 0.8; ctx.strokeStyle = ink.line; ctx.stroke(); }
  ctx.restore();
}

function drawLeaf(ctx, ink, mode, lw, x, y, ang, len, w) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.25, -w * 0.62, len * 0.7, -w * 0.55, len, 0);
  ctx.bezierCurveTo(len * 0.7, w * 0.55, len * 0.25, w * 0.62, 0, 0);
  ctx.closePath();
  if (mode === 'color') {
    const g = ctx.createLinearGradient(0, -w * 0.5, 0, w * 0.5);
    g.addColorStop(0, ink.light); g.addColorStop(0.5, ink.fill); g.addColorStop(1, ink.dark);
    ctx.fillStyle = g;
  } else ctx.fillStyle = ink.fill;
  ctx.fill();
  if (mode !== 'mask') {
    ctx.lineWidth = lw * 0.6; ctx.strokeStyle = ink.line; ctx.stroke();
    // midrib + satin stitches angled from the rib (herringbone, like real leaf embroidery)
    ctx.beginPath(); ctx.moveTo(len * 0.05, 0); ctx.lineTo(len * 0.9, 0);
    ctx.lineWidth = lw * 0.55; ctx.strokeStyle = ink.line; ctx.stroke();
    ctx.save(); ctx.clip();
    ctx.lineWidth = lw * 0.35;
    for (let s = 0.1; s < 0.95; s += 0.075) {
      ctx.strokeStyle = ink.stitchA;
      ctx.beginPath(); ctx.moveTo(len * s, 0); ctx.lineTo(len * (s + 0.12), -w * 0.6); ctx.stroke();
      ctx.strokeStyle = ink.stitchB;
      ctx.beginPath(); ctx.moveTo(len * s, 0); ctx.lineTo(len * (s + 0.12), w * 0.6); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

// ------------------------------------------------------------------------------------ lettering
// Roman-style serif capitals built from strokes (thick / hairline contrast, bracketed serifs).
// Glyphs are defined on a cap-height of 1 (y up negative = baseline at 0, top at -1).
const T = 0.15, Hl = 0.055, SER = 0.13, SERH = 0.045;

function quad(ctx, a, b, w) { // stroke from a to b with width w as a filled polygon (with join overlap)
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * w * 0.5, ny = (dx / L) * w * 0.5;
  ctx.moveTo(a[0] + nx, a[1] + ny); ctx.lineTo(b[0] + nx, b[1] + ny);
  ctx.lineTo(b[0] - nx, b[1] - ny); ctx.lineTo(a[0] - nx, a[1] - ny); ctx.closePath();
}
function serif(ctx, x, y, w, up) { // slab serif with small concave brackets
  const s = up ? -1 : 1, h = SERH;
  ctx.moveTo(x - w / 2, y); ctx.lineTo(x + w / 2, y); ctx.lineTo(x + w / 2, y - s * h);
  ctx.quadraticCurveTo(x + w * 0.16, y - s * h, x + w * 0.12, y - s * h * 2.6);
  ctx.lineTo(x - w * 0.12, y - s * h * 2.6);
  ctx.quadraticCurveTo(x - w * 0.16, y - s * h, x - w / 2, y - s * h); ctx.closePath();
}

// Each glyph is a list of parts; every part is filled on its own (avoids winding cancellation).
const GLYPHS = {
  'Α': { w: 0.8, parts: [
    (c) => quad(c, [0.07, 0], [0.4, -0.98], Hl * 1.3),
    (c) => quad(c, [0.4, -0.98], [0.74, 0], T),
    (c) => quad(c, [0.22, -0.34], [0.6, -0.34], Hl),
    (c) => serif(c, 0.07, 0, SER * 1.4, false),
    (c) => serif(c, 0.74, 0, SER * 1.6, false),
    (c) => { c.moveTo(0.34, -1.0); c.lineTo(0.47, -1.0); c.lineTo(0.46, -0.9); c.lineTo(0.35, -0.9); c.closePath(); },
  ] },
  'Θ': { w: 0.86, evenodd: [0], parts: [
    (c) => { c.ellipse(0.43, -0.5, 0.42, 0.515, 0, 0, Math.PI * 2); c.moveTo(0.43 + 0.42 - T * 1.05, -0.5); c.ellipse(0.43, -0.5, 0.42 - T * 1.05, 0.515 - Hl * 1.1, 0, 0, Math.PI * 2); },
    (c) => quad(c, [0.24, -0.5], [0.62, -0.5], Hl * 1.3),
    (c) => { c.rect(0.235, -0.585, 0.035, 0.17); },
    (c) => { c.rect(0.59, -0.585, 0.035, 0.17); },
  ] },
  'Η': { w: 0.78, parts: [
    (c) => quad(c, [0.1, 0], [0.1, -1], T),
    (c) => quad(c, [0.68, 0], [0.68, -1], T),
    (c) => quad(c, [0.1, -0.52], [0.68, -0.52], Hl),
    (c) => serif(c, 0.1, 0, SER * 1.7, false), (c) => serif(c, 0.1, -1, SER * 1.7, true),
    (c) => serif(c, 0.68, 0, SER * 1.7, false), (c) => serif(c, 0.68, -1, SER * 1.7, true),
  ] },
  'Ν': { w: 0.8, parts: [
    (c) => quad(c, [0.1, 0], [0.1, -0.98], Hl * 1.25),
    (c) => quad(c, [0.07, -1.0], [0.7, 0.0], T),
    (c) => quad(c, [0.7, 0.02], [0.7, -1], Hl * 1.25),
    (c) => serif(c, 0.1, 0, SER * 1.4, false),
    (c) => serif(c, 0.7, -1, SER * 1.4, true),
    (c) => { c.moveTo(0.0, -1.0); c.lineTo(0.16, -1.0); c.lineTo(0.16, -0.955); c.lineTo(0.0, -0.955); c.closePath(); },
  ] },
};

/** Width (in cap-heights) of a string drawn with drawGreekText. */
export function greekTextWidth(text, tracking = 0.16) {
  let w = 0;
  for (const ch of text) w += (GLYPHS[ch]?.w ?? 0.6) + tracking;
  return w - tracking;
}

/**
 * Draw Greek serif capitals (Α Θ Η Ν supported, enough for ΑΘΗΝΑ) centred at (cx, baseline y).
 * @param {number} h cap height in current units
 */
export function drawGreekText(ctx, text, cx, y, h, o = {}) {
  const mode = o.mode || 'color';
  const ink = inks(mode, o.palette);
  const tracking = o.tracking ?? 0.16;
  const total = greekTextWidth(text, tracking);
  ctx.save();
  ctx.translate(cx - (total * h) / 2, y);
  ctx.scale(h, h);
  let x = 0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      ctx.save(); ctx.translate(x, 0);
      let fs;
      if (mode === 'color') {
        fs = ctx.createLinearGradient(0, -1, 0.2, 0);
        fs.addColorStop(0, ink.light); fs.addColorStop(0.6, ink.fill); fs.addColorStop(1, ink.dark);
      } else fs = ink.fill;
      // thin dark outline first (all parts), then the fills on top → only the outer contour shows
      if (mode !== 'mask') {
        ctx.lineWidth = 0.035; ctx.strokeStyle = ink.line; ctx.globalAlpha = 0.6;
        g.parts.forEach((p, i) => { ctx.beginPath(); p(ctx); ctx.stroke(); });
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = fs;
      g.parts.forEach((p, i) => { ctx.beginPath(); p(ctx); ctx.fill(g.evenodd?.includes(i) ? 'evenodd' : 'nonzero'); });
      ctx.restore();
    }
    x += (g?.w ?? 0.6) + tracking;
  }
  ctx.restore();
}

// ------------------------------------------------------------------------------------ emblem
/**
 * Owl + laurel wreath (+ optional ΑΘΗΝΑ legend) as one emblem.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx centre x (px)
 * @param {number} top y of the top of the owl's head (px)
 * @param {number} owlH owl height in px (the wreath is ~0.96 owlH wide, the whole emblem ~1.4 owlH tall, ~1.85 with text)
 * @param {object} o { mode, palette, text: bool|string, wreath: bool, sprig: bool }
 * @returns {{top:number,bottom:number,left:number,right:number,textBaseline?:number}}
 */
export function drawOwlEmblem(ctx, cx, top, owlH, o = {}) {
  const mode = o.mode || 'color';
  ctx.save();
  ctx.translate(cx, top);
  ctx.scale(owlH, owlH);
  // the owl's visual centre sits slightly left of the wreath axis (body leans), like the refs
  if (o.wreath !== false) drawLaurelWreath(ctx, { mode, palette: o.palette, cx: 0.0, cy: 0.75, r: 0.46, squash: 1.35, gap: 0.72, pairs: 9, leafLen: 0.14, leafW: 0.052 });
  ctx.save(); ctx.translate(0.0, 0.02); drawOwl(ctx, { mode, palette: o.palette, sprig: o.sprig }); ctx.restore();
  ctx.restore();
  const res = { top, bottom: top + owlH * 1.42, left: cx - owlH * 0.5, right: cx + owlH * 0.5 };
  if (o.text) {
    const txt = typeof o.text === 'string' ? o.text : 'ΑΘΗΝΑ';
    const capH = owlH * (o.textScale ?? 0.17);
    const base = top + owlH * (o.textGap ?? 1.74);
    drawGreekText(ctx, txt, cx, base, capH, { mode, palette: o.palette });
    res.bottom = base; res.textBaseline = base;
  }
  return res;
}

/** Convenience: emblem on its own transparent canvas (size = canvas height in px). */
export function makeOwlEmblemCanvas(size = 1024, o = {}) {
  const c = typeof OffscreenCanvas !== 'undefined' && !o.domCanvas ? new OffscreenCanvas(Math.round(size * 0.8), size) : Object.assign(document.createElement('canvas'), { width: Math.round(size * 0.8), height: size });
  const ctx = c.getContext('2d');
  if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, c.width, c.height); }
  const owlH = size / (o.text ? 2.05 : 1.6);
  drawOwlEmblem(ctx, c.width / 2, size * 0.07, owlH, o);
  return c;
}
