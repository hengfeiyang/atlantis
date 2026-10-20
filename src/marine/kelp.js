// Giant kelp (Macrocystis-like) clumps: holdfast, several stipes rising to the canopy, alternating ruffled
// blades with a gas bladder (pneumatocyst) at each base, a trailing canopy near the top. aM.w = height of the
// vertex above the holdfast (drives the stipe bend in tissueMaterial('kelp')), aM.y = blade flutter (m).
// Plus the sea-fan atlas (canvas: dichotomous / reticulated gorgonian fans, white on transparent).
import * as THREE from 'three';
import { GeoBuilder, tube, lin, mixC, scaleC } from './geo.js';

const V = THREE.Vector3;

export const KELP_COL = { stipe: lin(84, 74, 34), blade: lin(112, 112, 46), bladeTip: lin(146, 128, 56), cyst: lin(132, 112, 52) }; // r5: darker olive (ref 7 frame-edge kelp reads dark, ours mustard-bright)

// ------------------------------------------------------------------ kelp blade atlas (4 cells side by side)
/** canvas atlas of ruffled kelp blades (greyscale albedo × alpha); cell k spans u ∈ [k/4, (k+1)/4] */
export function kelpAtlas(rng, W = 1024, H = 1024) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  const cw = W / 4;
  for (let k = 0; k < 4; k++) {
    const ox = k * cw, cx = ox + cw / 2;
    const wMax = cw * (0.36 + 0.05 * k);
    const N = 90;
    const left = [], right = [];
    const f1 = rng.range(16, 26), f2 = rng.range(40, 60), ph = rng.range(0, 6);
    for (let i = 0; i <= N; i++) {
      const t = i / N;            // 0 = base (bottom of the canvas), 1 = tip
      const y = H - 6 - t * (H - 12);
      const prof = Math.pow(Math.sin(Math.PI * Math.min(1, 0.05 + t * 0.97)), 0.65) * (t < 0.08 ? 0.35 + 0.65 * t / 0.08 : 1);
      const ruf = 1 + 0.12 * Math.sin(t * f1 + ph) + 0.06 * Math.sin(t * f2 + ph * 2) + (rng.random() - 0.5) * 0.05;
      const bend = Math.sin(t * 3.1 + k) * cw * 0.05;
      left.push([cx + bend - wMax * prof * ruf, y]);
      right.push([cx + bend + wMax * prof * (2 - ruf * 0.95 - 0.05), y]);
    }
    // blade body
    const grd = g.createLinearGradient(0, H, 0, 0);
    grd.addColorStop(0, 'rgb(150,140,120)'); grd.addColorStop(0.15, 'rgb(225,220,200)'); grd.addColorStop(0.8, 'rgb(240,236,210)'); grd.addColorStop(1, 'rgb(200,190,160)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(...left[0]);
    for (const p of left) g.lineTo(...p);
    for (let i = right.length - 1; i >= 0; i--) g.lineTo(...right[i]);
    g.closePath(); g.fill();
    // corrugation streaks (darker ridges running along the blade) + bullate blisters
    g.save(); g.clip();
    for (let s = 0; s < 70; s++) {
      const x = cx + rng.range(-1, 1) * wMax, w = rng.range(1, 3);
      g.strokeStyle = `rgba(60,55,30,${rng.range(0.08, 0.22)})`; g.lineWidth = w;
      g.beginPath(); g.moveTo(x, H); g.bezierCurveTo(x + rng.range(-20, 20), H * 0.6, x + rng.range(-20, 20), H * 0.3, x + rng.range(-10, 10), 0); g.stroke();
    }
    for (let s = 0; s < 260; s++) {
      g.fillStyle = `rgba(${rng.random() < 0.5 ? '40,35,20' : '255,250,220'},${rng.range(0.05, 0.16)})`;
      g.beginPath(); g.ellipse(cx + rng.range(-1, 1) * wMax, rng.range(0, H), rng.range(3, 9), rng.range(6, 18), 0, 0, Math.PI * 2); g.fill();
    }
    // darker frilled margin
    g.strokeStyle = 'rgba(70,60,30,0.35)'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(...left[0]); for (const p of left) g.lineTo(...p); g.stroke();
    g.beginPath(); g.moveTo(...right[0]); for (const p of right) g.lineTo(...p); g.stroke();
    g.restore();
    // gas bladder at the base
    g.fillStyle = 'rgb(170,150,90)';
    g.beginPath(); g.ellipse(cx, H - 40, wMax * 0.42, 38, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,245,200,0.35)';
    g.beginPath(); g.ellipse(cx - wMax * 0.12, H - 52, wMax * 0.14, 12, 0, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** one blade card (2 × 3 grid) from p along dir; width across `side`; atlas cell k */
function blade(B, rng, p, dir, side, len, width, h0, o) {
  const nrm = new V().crossVectors(dir, side).normalize();
  const k = o.cell ?? Math.floor(rng.random() * 4);
  const u0 = k / 4 + 0.004, u1 = (k + 1) / 4 - 0.004;
  const b0 = B.n;
  const droop = rng.range(0.05, 0.3), twist = rng.range(-0.5, 0.5);
  const col = mixC(o.col.blade, o.col.bladeTip, rng.random()).map((x) => x * rng.range(0.8, 1.15));
  const rows = o.segs;
  for (let s = 0; s <= rows; s++) {
    const t = s / rows;
    const c = p.clone().addScaledVector(dir, t * len).addScaledVector(nrm, -droop * len * t * t).add(new V(0, -droop * 0.5 * len * t * t, 0));
    const sd = side.clone().applyAxisAngle(dir, twist * t);
    B.c = mixC(mixC(col, [0, 0, 0], 0.3), col, Math.min(1, t * 2)); B.a = 0.6 + 0.4 * t; B.t = t;
    for (let j = 0; j <= 1; j++) {
      const q = c.clone().addScaledVector(sd, (j - 0.5) * width);
      B.w = h0 + (q.y - p.y);
      B.s = (0.04 + 0.16 * t) * len;
      B.v(q.x, q.y, q.z, u0 + (u1 - u0) * j, t);
    }
  }
  for (let s = 0; s < rows; s++) { const a = b0 + s * 2; B.tri(a, a + 1, a + 3); B.tri(a, a + 3, a + 2); }
}

/**
 * Kelp clump. H = height of the tallest stipe (m), stipes = count, detail scales blade density.
 * Returns a geometry with the holdfast at the origin (blades are atlas cards: kelpAtlas()).
 */
export function kelpClump(rng, { H = 40, stipes = 10, spacing = 0.26, detail = 1, col = KELP_COL, widthK = 1 } = {}) {
  const B = new GeoBuilder();
  const o = { segs: detail >= 0.9 ? 3 : 2, col };
  // holdfast: tangle of short root tubes
  B.c = scaleC(col.stipe, 0.7); B.s = 0; B.t = 0;
  for (let i = 0; i < (detail < 0.5 ? 3 : 9); i++) {
    const a = rng.range(0, Math.PI * 2);
    const p0 = new V(Math.cos(a) * 0.4, -0.05, Math.sin(a) * 0.4), p1 = new V(Math.cos(a) * 0.12, 0.25, Math.sin(a) * 0.12);
    B.w = 0; B.a = 0.4;
    tube(B, [p0, p0.clone().lerp(p1, 0.5).add(new V(0, 0.12, 0)), p1], 0.04, { radial: 4, cap: 'none', attr: (t) => { B.w = t * 0.25; } });
  }
  const step = spacing / Math.max(0.6, detail);
  for (let s = 0; s < stipes; s++) {
    const h = H * (s === 0 ? 1 : rng.range(0.5, 1.0));
    const a0 = rng.range(0, Math.PI * 2);
    const base = new V(Math.cos(a0) * rng.range(0, 0.3), 0.2, Math.sin(a0) * rng.range(0, 0.3));
    const segs = Math.max(6, Math.round(h / 3));
    const pts = [base.clone()];
    let p = base.clone();
    const lean = new V(Math.cos(a0) * 0.03, 1, Math.sin(a0) * 0.03);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      lean.x += rng.range(-0.025, 0.025); lean.z += rng.range(-0.025, 0.025);
      p = p.clone().addScaledVector(lean.clone().normalize(), h / segs);
      if (t > 0.9) p.x += (t - 0.9) * h * 0.5; // the canopy bends over downstream (+x local)
      pts.push(p);
    }
    B.c = col.stipe; B.a = 0.6;
    tube(B, pts, 0.014, { radial: 3, cap: 'none', attr: (t, i) => { B.w = pts[Math.min(pts.length - 1, i)].y; B.s = 0; B.t = t; } });
    const nb = Math.floor(h / step);
    for (let k = 0; k < nb; k++) {
      const along = (k + rng.range(0.1, 0.9)) / nb;
      const fi = along * (pts.length - 1), i0 = Math.floor(fi), i1 = Math.min(pts.length - 1, i0 + 1);
      const sp = pts[i0].clone().lerp(pts[i1], fi - i0);
      const sdir = new V().subVectors(pts[i1], pts[i0]).normalize();
      const az = k * 2.39996 + a0 + rng.range(-0.3, 0.3);
      const out = new V(Math.cos(az), 0, Math.sin(az));
      const canopy = along > 0.9;
      const dir = out.clone().multiplyScalar(canopy ? 1 : rng.range(0.45, 0.9)).add(sdir.clone().multiplyScalar(canopy ? 0.2 : 1)).normalize();
      if (canopy) dir.add(new V(0.9, -0.15, 0)).normalize();
      const side = new V().crossVectors(dir, new V(0, 1, 0)).normalize().applyAxisAngle(dir, rng.range(-0.7, 0.7));
      const youth = Math.min(1, along * 4);
      const len = rng.range(0.7, 1.35) * (canopy ? 1.5 : 1) * (0.55 + 0.45 * youth);
      blade(B, rng, sp, dir, side, len * Math.sqrt(widthK), rng.range(0.13, 0.2) * (0.7 + 0.3 * youth) * widthK, sp.y, o);
    }
  }
  return B.toGeometry();
}

/** tall bushy algae column (the "cypress" silhouettes of ref 6): dense short blades on a central stem */
export function algaeColumn(rng, { H = 7, R = 0.9, detail = 1 } = {}) {
  const col = { stipe: lin(40, 54, 26), blade: lin(52, 78, 30), bladeTip: lin(86, 110, 44) };
  const B = new GeoBuilder();
  const o = { segs: 2, col };
  const nb = Math.round(H * 60 * Math.max(0.6, detail));
  for (let k = 0; k < nb; k++) {
    const t = Math.pow(rng.random(), 0.85);
    const y = t * H;
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.96)), 0.7) * (t > 0.55 ? 1 - (t - 0.55) * 1.7 : 1);
    const rr = R * env * rng.range(0.5, 1.0);
    const az = rng.range(0, Math.PI * 2);
    const p = new V(Math.cos(az) * rr * 0.25, y, Math.sin(az) * rr * 0.25);
    const out = new V(Math.cos(az), 0, Math.sin(az));
    const dir = out.clone().add(new V(0, rng.range(0.7, 1.8), 0)).normalize();
    const side = new V().crossVectors(dir, new V(0, 1, 0)).normalize().applyAxisAngle(dir, rng.range(-1, 1));
    blade(B, rng, p, dir, side, rr * 0.9 + 0.25, rng.range(0.12, 0.2), y, o);
  }
  return B.toGeometry();
}

// ------------------------------------------------------------------ sea-fan atlas (2 × 2 cells)
export function fanAtlas(rng, size = 2048) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, size, size);
  const cs = size / 2;
  const cells = [];
  for (let c = 0; c < 4; c++) {
    const ox = (c % 2) * cs, oy = Math.floor(c / 2) * cs;
    const reticulate = c < 2;
    drawFan(g, rng, ox, oy, cs, { reticulate, spread: reticulate ? 1.25 : 1.05, depth: reticulate ? 7 : 6 });
    // UV cell (flipY: canvas top = v 1)
    cells.push([(c % 2) * 0.5, 1 - (Math.floor(c / 2) + 1) * 0.5, (c % 2) * 0.5 + 0.5, 1 - Math.floor(c / 2) * 0.5]);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, cells };
}

function drawFan(g, rng, ox, oy, cs, o) {
  const segs = [];
  const pts = [];
  const pad = cs * 0.04;
  const bx = ox + cs / 2, by = oy + cs - pad;
  const maxH = cs - pad * 2;
  const rec = (x, y, ang, len, w, d) => {
    const n = 6;
    let px = x, py = y, a = ang;
    const line = [[px, py]];
    for (let i = 0; i < n; i++) {
      a += rng.range(-0.12, 0.12);
      const nx = px + Math.sin(a) * len / n, ny = py - Math.cos(a) * len / n;
      // keep inside a fan-shaped envelope
      const dx = (nx - bx) / (maxH * 0.62), dy = (by - ny) / maxH;
      if (dx * dx + dy * dy > 1 || ny < oy + pad || nx < ox + pad || nx > ox + cs - pad) break;
      line.push([nx, ny]); px = nx; py = ny;
    }
    segs.push({ line, w });
    for (const p of line) pts.push({ p, d });
    if (d >= o.depth || line.length < 3) return;
    const kids = d < 2 ? rng.int(2, 3) : 2;
    for (let k = 0; k < kids; k++) {
      const da = (k - (kids - 1) / 2) * rng.range(0.25, 0.5) * (d < 2 ? o.spread : 0.8);
      rec(px, py, a + da, len * rng.range(0.7, 0.9), Math.max(cs * 0.005, w * 0.74), d + 1);
    }
  };
  // primary trunk + main fan
  const trunk = maxH * 0.1;
  g.lineCap = 'round'; g.lineJoin = 'round';
  rec(bx, by, 0, trunk, cs * 0.018, 0);
  const tx = bx, ty = by - trunk;
  const prim = rng.int(4, 6);
  for (let k = 0; k < prim; k++) {
    const a = ((k + 0.5) / prim - 0.5) * 2 * o.spread * 0.9 + rng.range(-0.1, 0.1);
    rec(tx, ty, a, maxH * rng.range(0.22, 0.3), cs * 0.011, 1);
  }
  const strokeAll = (style) => {
    for (const s of segs) {
      g.strokeStyle = style(s);
      g.lineWidth = s.w;
      g.beginPath(); g.moveTo(...s.line[0]);
      for (let i = 1; i < s.line.length; i++) g.lineTo(...s.line[i]);
      g.stroke();
    }
  };
  strokeAll(() => `rgb(${Math.round(rng.range(215, 255))},${Math.round(rng.range(215, 255))},${Math.round(rng.range(215, 255))})`);
  // reticulated mesh: cross-links between nearby branch points of later generations
  if (o.reticulate) {
    const fine = pts.filter((q) => q.d >= 2);
    g.lineWidth = Math.max(2.0, cs * 0.0042);
    for (let i = 0; i < fine.length * 3; i++) {
      const a = fine[Math.floor(rng.random() * fine.length)];
      let best = null, bd = 1e9;
      for (let k = 0; k < 24; k++) {
        const b = fine[Math.floor(rng.random() * fine.length)];
        const d = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]);
        if (d > cs * 0.008 && d < bd) { bd = d; best = b; }
      }
      if (best && bd < cs * 0.05) {
        const v = Math.round(rng.range(200, 245));
        g.strokeStyle = `rgb(${v},${v},${v})`;
        g.beginPath(); g.moveTo(...a.p);
        g.quadraticCurveTo((a.p[0] + best.p[0]) / 2 + rng.range(-4, 4), (a.p[1] + best.p[1]) / 2 + rng.range(-4, 4), ...best.p);
        g.stroke();
      }
    }
  }
  // polyps: tiny pale dots along the branches
  for (const q of pts) {
    if (rng.random() < 0.5) continue;
    g.fillStyle = 'rgb(255,250,240)';
    g.beginPath(); g.arc(q.p[0] + rng.range(-2, 2), q.p[1] + rng.range(-2, 2), rng.range(1.5, 3) * cs / 1024, 0, Math.PI * 2); g.fill();
  }
}
