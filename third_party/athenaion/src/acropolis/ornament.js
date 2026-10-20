// Carved ornament: laurel-wreath reliefs (ref 6), moulded panels, pedestals with wreaths,
// lamp posts with gilded tops, planters.
import { chamferBox, Frame, FACES, lin } from './geo.js';
import { blockColor, STONE_COL } from './masonry.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/**
 * Laurel wreath bas-relief on the plane of frame F (s right, y up, d out of the surface).
 * Centre (cx, cy), radius R (m). Two branches rise from a ribbon bow at the bottom.
 */
export function wreath(B, F, cx, cy, R, rng, col, opts = {}) {
  const relief = opts.relief ?? R * 0.09;
  const leafL = R * 0.30, leafW = R * 0.11;
  const dk = darker(col, 0.9), lt = col;
  const P = (s, y, d) => F.p(s, y, d);
  // stems: thin raised band along the circle from the bottom up each side
  const gap = 0.32; // radians gap at the top
  for (const side of [-1, 1]) {
    const a0 = -Math.PI / 2 + 0.22, a1 = Math.PI / 2 - gap;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const A0 = a0 + (a1 - a0) * t0, A1 = a0 + (a1 - a0) * t1;
      const r0 = R * 0.98, w = R * 0.022;
      const p0 = [cx + side * Math.cos(A0) * r0, cy + Math.sin(A0) * r0], p1 = [cx + side * Math.cos(A1) * r0, cy + Math.sin(A1) * r0];
      const nx0 = side * Math.cos(A0), ny0 = Math.sin(A0), nx1 = side * Math.cos(A1), ny1 = Math.sin(A1);
      B.quadOut(P(p0[0] - nx0 * w, p0[1] - ny0 * w, relief * 0.4), P(p1[0] - nx1 * w, p1[1] - ny1 * w, relief * 0.4),
        P(p1[0] + nx1 * w, p1[1] + ny1 * w, relief * 0.4), P(p0[0] + nx0 * w, p0[1] + ny0 * w, relief * 0.4), dk, P(cx, cy, -1));
    }
    // leaves in pairs along the branch, pointing toward the top
    const nl = opts.leaves ?? 11;
    for (let i = 0; i < nl; i++) {
      const t = (i + 0.5) / nl;
      const A = a0 + (a1 - a0) * t + rng.range(-0.03, 0.03);
      const bx = cx + side * Math.cos(A) * R * 0.98, by = cy + Math.sin(A) * R * 0.98;
      // tangent along the branch (toward growth)
      const tx = -side * Math.sin(A), ty = Math.cos(A);
      for (const io of [-1, 1]) {
        // leaf points forward along the tangent and out (or in) from the circle
        const spread = 0.55 + rng.range(-0.1, 0.12);
        const nx = side * Math.cos(A) * io, ny = Math.sin(A) * io;
        let dx = tx * Math.cos(spread) + nx * Math.sin(spread), dy = ty * Math.cos(spread) + ny * Math.sin(spread);
        const l = leafL * (0.8 + 0.3 * rng.random()) * (1 - 0.25 * t), w = leafW * (0.85 + 0.3 * rng.random());
        const ox = bx + dx * l * 0.08, oy = by + dy * l * 0.08;
        leaf(B, F, ox, oy, dx, dy, l, w, relief * (0.8 + 0.4 * rng.random()), io * 0.4, lt, dk);
      }
      // berries every third pair on the inside
      if (i % 3 === 1) {
        const r = R * 0.035;
        for (const k of [0, 1]) {
          const bxx = bx - side * Math.cos(A) * R * (0.12 + 0.06 * k) + tx * R * 0.04 * k, byy = by - Math.sin(A) * R * (0.12 + 0.06 * k);
          berry(B, F, bxx, byy, r, relief * 0.9, lt, dk);
        }
      }
    }
  }
  // ribbon bow at the bottom
  const by = cy - R * 0.98;
  const rib = R * 0.09;
  for (const side of [-1, 1]) {
    // loop
    leaf(B, F, cx + side * rib * 0.6, by + rib * 0.2, side * 0.9, 0.35, rib * 2.6, rib * 1.3, relief * 0.9, 0, lt, dk);
    // tail fluttering down
    leaf(B, F, cx + side * rib * 0.9, by - rib * 1.2, side * 0.45, -0.9, rib * 3.6, rib * 0.7, relief * 0.6, side * 0.3, lt, dk);
  }
  berry(B, F, cx, by, rib * 0.55, relief, lt, dk);
}

/** a single faceted leaf: base at (x,y) pointing along (dx,dy) */
export function leaf(B, F, x, y, dx, dy, l, w, h, twist, col, dk) {
  const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  const px = -dy, py = dx;
  const base = F.p(x, y, h * 0.15);
  const tip = F.p(x + dx * l, y + dy * l, h * 0.3);
  const sl = F.p(x + dx * l * 0.42 + px * w * 0.5, y + dy * l * 0.42 + py * w * 0.5, h * (0.25 + 0.35 * Math.max(0, twist)));
  const sr = F.p(x + dx * l * 0.42 - px * w * 0.5, y + dy * l * 0.42 - py * w * 0.5, h * (0.25 + 0.35 * Math.max(0, -twist)));
  const mid = F.p(x + dx * l * 0.45, y + dy * l * 0.45, h);
  const out = F.az;
  const C = F.p(x + dx * l * 0.45, y + dy * l * 0.45, -1);
  // orient each tri away from a point behind the surface
  const tri = (a, b, c, k) => {
    const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) B.tri(a, c, b, k); else B.tri(a, b, c, k);
  };
  tri(base, sr, mid, dk); tri(sr, tip, mid, col); tri(tip, sl, mid, col); tri(sl, base, mid, dk);
  void C;
}

function berry(B, F, x, y, r, h, col, dk) {
  const c = F.p(x, y, h * 0.4 + r);
  const pts = [F.p(x + r, y, h * 0.4), F.p(x, y + r, h * 0.4), F.p(x - r, y, h * 0.4), F.p(x, y - r, h * 0.4)];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const n = [(a[1] - c[1]) * (b[2] - c[2]) - (a[2] - c[2]) * (b[1] - c[1]), (a[2] - c[2]) * (b[0] - c[0]) - (a[0] - c[0]) * (b[2] - c[2]), (a[0] - c[0]) * (b[1] - c[1]) - (a[1] - c[1]) * (b[0] - c[0])];
    const o = F.az;
    if (n[0] * o[0] + n[1] * o[1] + n[2] * o[2] < 0) B.tri(c, b, a, i % 2 ? col : dk); else B.tri(c, a, b, i % 2 ? col : dk);
  }
}

/** raised moulded frame (rectangle border) on the plane of F: centre (cx,cy), size w×h */
export function panelFrame(B, F, cx, cy, w, h, col, depth = 0.035, bw = 0.07) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  const m = 0;
  chamferBox(B, F, x0, x1, y0, y0 + bw, m - 0.02, depth, 0.012, col, 63 - 32);
  chamferBox(B, F, x0, x1, y1 - bw, y1, m - 0.02, depth, 0.012, col, 63 - 32);
  chamferBox(B, F, x0, x0 + bw, y0 + bw, y1 - bw, m - 0.02, depth, 0.012, col, 63 - 32);
  chamferBox(B, F, x1 - bw, x1, y0 + bw, y1 - bw, m - 0.02, depth, 0.012, col, 63 - 32);
}

/**
 * Pedestal (statue / brazier base). F at the base centre (y absolute in F.o[1] = 0 frame: pass y0).
 * faces: which of the 4 faces get wreaths ('front','back','left','right').
 * Returns the top centre height.
 */
export function pedestal(S, mat, F, y0, w, h, rng, opts = {}) {
  const B = S.get(mat, F.o[0], F.o[2]);
  const col = opts.color || blockColor(rng, STONE_COL);
  const dk = darker(col, 0.8);
  const hw = w / 2;
  let y = y0;
  // base: plinth + torus-like step
  chamferBox(B, F, -hw - 0.18, hw + 0.18, y, y + 0.32, -hw - 0.18, hw + 0.18, 0.03, col, 63 - 8, dk); y += 0.32;
  chamferBox(B, F, -hw - 0.09, hw + 0.09, y, y + 0.12, -hw - 0.09, hw + 0.09, 0.05, col, 63 - 8, dk); y += 0.12;
  chamferBox(B, F, -hw - 0.04, hw + 0.04, y, y + 0.06, -hw - 0.04, hw + 0.04, 0.02, col, 63 - 8, dk); y += 0.06;
  const dieH = h - 0.5 - 0.48;
  chamferBox(B, F, -hw, hw, y, y + dieH, -hw, hw, 0.025, col, 63 - 8 - 4, dk);
  // panels + wreaths on faces
  const faces = opts.faces || ['front', 'back', 'left', 'right'];
  const dieMid = y + dieH / 2;
  for (const f of faces) {
    const Ff = f === 'front' ? F.at(0, 0, hw) : f === 'back' ? F.yawed(Math.PI).at(0, 0, hw) : f === 'left' ? F.yawed(-Math.PI / 2).at(0, 0, hw) : F.yawed(Math.PI / 2).at(0, 0, hw);
    panelFrame(B, Ff, 0, dieMid, w * 0.78, dieH * 0.8, col, 0.03, Math.min(0.08, w * 0.05));
    if (opts.wreath !== false && dieH > 0.7) wreath(B, Ff, 0, dieMid, Math.min(w * 0.3, dieH * 0.3), rng, col, { relief: Math.min(w, dieH) * 0.028 }); // (r6) 0.035 → 0.028: steep leaf facets sparkled as white triangles at 7 m (shot 6)
  }
  y += dieH;
  // cap: cornice
  chamferBox(B, F, -hw - 0.05, hw + 0.05, y, y + 0.1, -hw - 0.05, hw + 0.05, 0.02, col, 63 - 8, dk); y += 0.1;
  chamferBox(B, F, -hw - 0.14, hw + 0.14, y, y + 0.16, -hw - 0.14, hw + 0.14, 0.045, col, 63 - 8, dk); y += 0.16;
  chamferBox(B, F, -hw - 0.2, hw + 0.2, y, y + 0.14, -hw - 0.2, hw + 0.2, 0.03, col, 63 - 8, dk); y += 0.14;
  chamferBox(B, F, -hw - 0.06, hw + 0.06, y, y + 0.08, -hw - 0.06, hw + 0.06, 0.02, col, 63 - 8, dk); y += 0.08;
  return y;
}

/** lamp post: stone base, fluted-ish shaft, gilded bowl on top. Returns flame position. */
export function lampPost(S, F, y0, rng, h = 3.4) {
  const B = S.get('marble', F.o[0], F.o[2]);
  const G = S.get('gold', F.o[0], F.o[2]);
  const col = blockColor(rng, STONE_COL);
  let y = y0;
  chamferBox(B, F, -0.32, 0.32, y, y + 0.35, -0.32, 0.32, 0.03, col, 63 - 8); y += 0.35;
  chamferBox(B, F, -0.24, 0.24, y, y + 0.1, -0.24, 0.24, 0.04, col, 63 - 8); y += 0.1;
  // octagonal shaft
  const r = 0.13, sh = h - 0.9;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a, yy, rr) => F.p(Math.cos(a) * rr, yy, Math.sin(a) * rr);
    B.quadOut(p(a0, y, r * 1.08), p(a1, y, r * 1.08), p(a1, y + sh, r * 0.9), p(a0, y + sh, r * 0.9), col, F.p(0, y + sh / 2, 0));
  }
  y += sh;
  // gold collar + bowl
  chamferBox(G, F, -0.16, 0.16, y, y + 0.08, -0.16, 0.16, 0.03, [1, 1, 1], 63 - 8); y += 0.08;
  const bowl = [[0.06, 0], [0.12, 0.05], [0.24, 0.16], [0.30, 0.24], [0.27, 0.27]];
  for (let i = 0; i < n * 2; i++) {
    const a0 = (i / (n * 2)) * Math.PI * 2, a1 = ((i + 1) / (n * 2)) * Math.PI * 2;
    for (let k = 0; k < bowl.length - 1; k++) {
      const [r0, y0b] = bowl[k], [r1, y1b] = bowl[k + 1];
      const p = (a, yy, rr) => F.p(Math.cos(a) * rr, y + yy, Math.sin(a) * rr);
      G.quadOut(p(a0, y0b, r0), p(a1, y0b, r0), p(a1, y1b, r1), p(a0, y1b, r1), [1, 1, 1], F.p(0, y + 0.6, 0));
    }
  }
  return F.p(0, y + 0.22, 0);
}

/** rectangular stone planter box with soil top (flora fills it via slots.planter) */
export function planter(S, F, y0, w, d, h, rng) {
  const B = S.get('marble', F.o[0], F.o[2]);
  const col = blockColor(rng, STONE_COL);
  chamferBox(B, F, -w / 2, w / 2, y0, y0 + h, -d / 2, d / 2, 0.03, col, 63 - 8 - 4, darker(col, 0.8));
  // rim
  const t = 0.12;
  chamferBox(B, F, -w / 2 - 0.04, w / 2 + 0.04, y0 + h, y0 + h + 0.09, -d / 2 - 0.04, -d / 2 + t, 0.02, col);
  chamferBox(B, F, -w / 2 - 0.04, w / 2 + 0.04, y0 + h, y0 + h + 0.09, d / 2 - t, d / 2 + 0.04, 0.02, col);
  chamferBox(B, F, -w / 2 - 0.04, -w / 2 + t, y0 + h, y0 + h + 0.09, -d / 2 + t, d / 2 - t, 0.02, col);
  chamferBox(B, F, w / 2 - t, w / 2 + 0.04, y0 + h, y0 + h + 0.09, -d / 2 + t, d / 2 - t, 0.02, col);
  const Sx = S.get('soil', F.o[0], F.o[2]);
  Sx.quadOut(F.p(-w / 2 + t, y0 + h - 0.06, -d / 2 + t), F.p(w / 2 - t, y0 + h - 0.06, -d / 2 + t), F.p(w / 2 - t, y0 + h - 0.06, d / 2 - t), F.p(-w / 2 + t, y0 + h - 0.06, d / 2 - t), [1, 1, 1], F.p(0, y0, 0));
  return F.p(0, y0 + h - 0.06, 0);
}

export { lin };

/**
 * (r6) Festoon (garland swag) in relief on the plane of F (s right, y up, d out): a bundle of laurel
 * leaves and fruit hanging from (s0, y) to (s1, y) with sag `sag`, R = bundle half-thickness, ribbon
 * tails and a rosette boss at both suspension points (refs 5, 6: frieze garlands between rosettes).
 */
export function garland(B, F, s0, s1, y, sag, R, rng, col, opts = {}) {
  const relief = opts.relief ?? R * 0.8;
  const dk = darker(col, 0.84);
  const P = (t) => [s0 + (s1 - s0) * t, y - sag * 4 * t * (1 - t)];
  const n = Math.max(6, Math.round((s1 - s0) / (R * 0.8)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [cs, cy] = P(t);
    const [as, ay] = P(Math.max(0, t - 0.01)), [bs, by] = P(Math.min(1, t + 0.01));
    let tx = bs - as, ty = by - ay; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const toMid = t < 0.5 ? 1 : -1; // leaves point toward the middle of the swag
    const th = R * (0.55 + 0.45 * Math.sin(Math.PI * t));
    for (const io of [-1, 1]) {
      const px = -ty * io, py = tx * io;
      const sp = 0.5 + rng.range(-0.12, 0.12);
      const dx = tx * toMid * Math.cos(sp) + px * Math.sin(sp), dy = ty * toMid * Math.cos(sp) + py * Math.sin(sp);
      leaf(B, F, cs - px * th * 0.15, cy - py * th * 0.15, dx, dy, th * 1.9 * (0.85 + 0.3 * rng.random()), th * 0.8, relief * (0.8 + 0.4 * rng.random()), io * 0.4, col, dk);
    }
    if (i % 2 === 1 && t > 0.2 && t < 0.8) berry(B, F, cs + rng.range(-0.3, 0.3) * th, cy - th * 0.1, th * 0.32, relief * 1.15, col, dk);
  }
  for (const [ss, sd] of [[s0, 1], [s1, -1]]) {
    leaf(B, F, ss, y - R * 0.3, sd * 0.25, -1, R * 3.4, R * 0.75, relief * 0.5, sd * 0.3, col, dk);
    leaf(B, F, ss + sd * R * 0.4, y - R * 0.3, sd * 0.55, -1, R * 2.6, R * 0.6, relief * 0.45, -sd * 0.3, col, dk);
    berry(B, F, ss, y + R * 0.15, R * 0.62, relief * 1.1, col, dk);
  }
}
