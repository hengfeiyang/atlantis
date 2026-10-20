// Atlantis ornament & building kit (temple agent): gold tridents, pinnacles, sea-creature relief
// silhouettes for pediments / friezes, gold domes, round basins, palaces for the citadel ledges.
// r3: greatRampart(B, o) (panelled red orichalcum tiers with medallions, pilasters, bastion towers), medallion(mbGold, mbFrame, R).
// All functions write into a MeshBuilder at its current transform (y up, front = +Z) unless noted.
import * as THREE from 'three';
import { MeshBuilder, box, lathe, tube, extrudeOutline, ellipsoid, lerp, clamp, hash3 } from './geom.js';

const PI = Math.PI;

// ------------------------------------------------------------------------------------ trident
/** gold trident standing on y = 0, height h, prongs in the X-Y plane. o: { detail, barbs } */
export function trident(mb, h, o = {}) {
  const det = o.detail ?? 1;
  const r = h * 0.02;
  const sg = det > 0.6 ? 10 : 6;
  lathe(mb, [[r * 1.9, 0, 0.2, 0, true], [r * 1.9, h * 0.035, 0, 0.5, true], [r * 1.05, h * 0.05, 0.3, 0], [r, h * 0.62, 0, 0],
    [r * 1.9, h * 0.635, 0.1, 0.5, true], [r * 2.1, h * 0.655, 0, 0.6], [r * 1.9, h * 0.675, 0.1, 0.5, true], [r * 1.3, h * 0.69, 0.3, 0], [r * 0.9, h * 0.72, 0, 0]], sg, { capTop: true, capBottom: true });
  const nT = det > 0.6 ? 10 : 6;
  // curved crossbar + side prongs (one tube each side, U shape)
  for (const s of [-1, 1]) {
    tube(mb, (t, out) => {
      // from the centre (0, 0.69h) out to (±0.19h, 0.74h) then up to (±0.2h, 0.9h)
      const a = t * PI * 0.5;
      out[0] = s * h * 0.19 * Math.sin(a) * (1 + 0.05 * t);
      out[1] = h * (0.69 + 0.05 * (1 - Math.cos(a)) + 0.16 * Math.max(0, t - 0.55) / 0.45 * t);
      out[2] = 0;
    }, (t) => r * lerp(1.15, 0.85, t), nT, sg, { aux: [0.1, 0.4, 0, 0] });
  }
  // centre prong
  lathe(mb, [[r * 0.95, h * 0.70, 0, 0], [r * 0.85, h * 0.93, 0, 0]], sg, {});
  // barbed points
  const tip = (x, y, w, hh) => {
    const out = [[0, hh], [-w * 0.5, hh * 0.25], [-w * 0.62, -hh * 0.12], [-w * 0.25, hh * 0.05], [-w * 0.18, -hh * 0.05], [w * 0.18, -hh * 0.05], [w * 0.25, hh * 0.05], [w * 0.62, -hh * 0.12], [w * 0.5, hh * 0.25]];
    mb.push(); mb.translate(x, y, -r * 0.7); extrudeOutline(mb, out, r * 1.4, { aux: [0.05, 0.8, 0, 0], auxSide: [0.1, 0.9, 0, 0] }); mb.pop();
  };
  tip(0, h * 0.925, h * 0.075, h * 0.09);
  tip(-h * 0.2, h * 0.895, h * 0.06, h * 0.08);
  tip(h * 0.2, h * 0.895, h * 0.06, h * 0.08);
}

/** gold pinnacle (spire with bulb), height h; o.trident: top it with a small trident */
export function pinnacle(mb, h, o = {}) {
  const s = h / 3.4;
  const sg = (o.detail ?? 1) > 0.6 ? 12 : 8;
  const P = [[0.52, 0], [0.52, 0.25], [0.42, 0.3], [0.36, 0.34], [0.34, 1.15], [0.5, 1.22], [0.56, 1.32], [0.44, 1.38], [0.48, 1.5], [0.4, 1.68], [0.24, 1.78], [0.15, 2.2], [0.2, 2.3], [0.13, 2.36], [0.06, 3.0], [0.01, 3.4]];
  lathe(mb, P.map(([r, y], i) => [r * s, y * s, i % 3 === 0 ? 0.2 : 0, i % 4 === 1 ? 0.5 : 0, i === 1 || i === 4 || i === 6]), sg, { capBottom: true });
  if (o.trident) { mb.push(); mb.translate(0, 2.2 * s, 0); trident(mb, h * 0.55, o); mb.pop(); }
}

// ------------------------------------------------------------------------------------ silhouettes
// Unit outlines (height ≈ 1, facing +X); used as extruded gilt relief.
const HIPPOCAMP = [[0.0, 0.47], [0.05, 0.36], [0.12, 0.27], [0.22, 0.2], [0.34, 0.16], [0.46, 0.18], [0.56, 0.24], [0.64, 0.22], [0.74, 0.15], [0.84, 0.13], [0.86, 0.18],
  [0.76, 0.24], [0.71, 0.3], [0.8, 0.33], [0.9, 0.38], [0.95, 0.45], [0.9, 0.47], [0.8, 0.42], [0.72, 0.43], [0.74, 0.56], [0.79, 0.69], [0.86, 0.78], [0.97, 0.76],
  [1.0, 0.82], [0.92, 0.9], [0.86, 0.98], [0.82, 0.92], [0.74, 0.88], [0.68, 0.8], [0.6, 0.86], [0.52, 0.8], [0.58, 0.7], [0.56, 0.58], [0.46, 0.5], [0.34, 0.45],
  [0.24, 0.44], [0.15, 0.5], [0.1, 0.6], [0.04, 0.6]];
const DOLPHIN = [[0.0, 0.36], [0.06, 0.48], [0.1, 0.38], [0.22, 0.4], [0.4, 0.5], [0.56, 0.58], [0.72, 0.58], [0.85, 0.52], [1.0, 0.44], [0.86, 0.4], [0.74, 0.38],
  [0.62, 0.33], [0.58, 0.24], [0.5, 0.31], [0.32, 0.3], [0.16, 0.3], [0.08, 0.22], [0.05, 0.28]];
const TRITON = [[0.0, 0.1], [0.12, 0.02], [0.3, 0.0], [0.5, 0.06], [0.6, 0.16], [0.66, 0.3], [0.7, 0.44], [0.78, 0.5], [0.9, 0.62], [0.96, 0.72], [0.92, 0.74],
  [0.84, 0.64], [0.74, 0.6], [0.7, 0.7], [0.74, 0.8], [0.7, 0.9], [0.62, 0.9], [0.58, 0.8], [0.6, 0.7], [0.52, 0.64], [0.44, 0.7], [0.4, 0.66], [0.5, 0.56],
  [0.54, 0.4], [0.46, 0.24], [0.3, 0.16], [0.16, 0.18], [0.1, 0.26], [0.04, 0.24]];
// standing robed god with right arm raised (x ∈ [-0.25, 0.25])
const GOD = [[-0.14, 0.0], [0.14, 0.0], [0.11, 0.3], [0.1, 0.5], [0.13, 0.62], [0.15, 0.73], [0.19, 0.78], [0.23, 0.88], [0.24, 0.97], [0.205, 0.975], [0.19, 0.9],
  [0.15, 0.82], [0.08, 0.81], [0.065, 0.86], [0.05, 0.92], [0.0, 0.95], [-0.05, 0.92], [-0.065, 0.86], [-0.07, 0.81], [-0.15, 0.78], [-0.19, 0.66], [-0.17, 0.55],
  [-0.13, 0.56], [-0.135, 0.65], [-0.11, 0.67], [-0.1, 0.5], [-0.11, 0.3]];
export const SILHOUETTES = { hippocamp: HIPPOCAMP, dolphin: DOLPHIN, triton: TRITON, god: GOD };

/** extrude a unit silhouette: height h, depth d, mirrored (facing -X) when flip; layered for a rounded relief */
export function silhouette(mb, name, h, d, flip = false) {
  const S = SILHOUETTES[name];
  const pts = S.map(([x, y]) => [(flip ? -x : x) * h, y * h]);
  const ord = flip ? pts.slice().reverse() : pts;
  extrudeOutline(mb, ord, d * 0.6, { aux: [0.15, 0.3, 0, 0], auxSide: [0.35, 0.7, 0, 0] });
  // inner raised layer (shrunk towards the centroid) → stepped, rounded read
  let cx = 0, cy = 0; for (const [x, y] of ord) { cx += x; cy += y; } cx /= ord.length; cy /= ord.length;
  const inner = ord.map(([x, y]) => [cx + (x - cx) * 0.82, cy + (y - cy) * 0.82]);
  mb.push(); mb.translate(0, 0, d * 0.55); extrudeOutline(mb, inner, d * 0.45, { aux: [0.05, 0.5, 0, 0], auxSide: [0.2, 0.8, 0, 0], back: false }); mb.pop();
}

/** wave band (curling crests) along +X from 0 to len, height hh, depth d */
export function waveBand(mb, len, hh, d, lambda = 1.6) {
  const n = Math.max(2, Math.round(len / lambda));
  const lam = len / n;
  const out = [[0, 0], [len, 0]];
  for (let i = n; i > 0; i--) {
    const x0 = i * lam;
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const x = x0 - t * lam;
      const crest = t < 0.35 ? Math.pow(t / 0.35, 0.6) : 1 - Math.pow((t - 0.35) / 0.65, 1.6) * 0.75;
      out.push([x - Math.sin(t * PI) * lam * 0.12, hh * (0.35 + 0.65 * crest)]);
    }
  }
  extrudeOutline(mb, out, d, { aux: [0.1, 0.4, 0, 0], auxSide: [0.3, 0.7, 0, 0] });
}

/**
 * Pediment sea-creature relief in a triangle of half base hb and height hp (2D, x ∈ [-hb, hb], y up),
 * written into mb at its current transform, depth d. Central god with trident, hippocamps, tritons, dolphins, waves.
 */
export function pedimentRelief(mb, hb, hp, o = {}) {
  const d = o.depth ?? 0.35;
  const avail = (x) => hp * (1 - Math.abs(x) / hb);
  const wave = hp * 0.12;
  // waves along the floor
  mb.push(); mb.translate(-hb * 0.97, 0, 0); waveBand(mb, hb * 1.94, wave, d * 0.8, hp * 0.32); mb.pop();
  // centre: god + trident
  const gh = hp * 0.86;
  mb.push(); mb.translate(0, wave * 0.4, 0); silhouette(mb, 'god', gh, d * 1.2); mb.pop();
  mb.push(); mb.translate(gh * 0.22, wave * 0.4 + gh * 0.08, d * 0.6); trident(mb, gh * 1.0, { detail: 0.4 }); mb.pop();
  const seq = o.sequence || ['hippocamp', 'triton', 'hippocamp', 'dolphin', 'hippocamp', 'dolphin', 'dolphin'];
  const A = 0.94 * (hp - wave * 0.4);
  for (const s of [-1, 1]) {
    let x = gh * 0.27;
    for (let k = 0; k < 12; k++) {
      const name = seq[k % seq.length];
      const h = (A * (1 - x / hb)) / (1 + A / hb);
      if (h < hp * 0.07) break;
      mb.push();
      if (s < 0) { mb.translate(-(x + h), wave * 0.4, 0); silhouette(mb, name, h, d, false); }
      else { mb.translate(x + h, wave * 0.4, 0); silhouette(mb, name, h, d, true); }
      mb.pop();
      x += h * 0.9;
    }
  }
}

// ------------------------------------------------------------------------------------ dome
/** dome on a drum: base at y=0, radius r, drum height hd, rise (fraction of r), ribs. Writes drum into mbDrum, cap into mbDome */
export function dome(mbDrum, mbDome, r, o = {}) {
  const hd = o.drum ?? r * 0.45, rise = o.rise ?? 0.95, sg = o.segs ?? 32;
  if (hd > 0) {
    lathe(mbDrum, [[r * 1.04, 0, 0.2, 0, true], [r * 1.04, hd * 0.12, 0, 0.6, true], [r, hd * 0.16, 0.2, 0, true], [r, hd * 0.86, 0, 0], [r * 1.07, hd * 0.9, 0.1, 0.6, true], [r * 1.07, hd, 0, 0.6, true], [r * 0.98, hd, 0.3, 0, true]], sg, { masonry: 3.05 });
  }
  const P = [];
  const n = 12;
  for (let i = 0; i <= n; i++) { const a = (i / n) * PI * 0.5; P.push([r * Math.cos(a) * 0.98 + 0.0001, hd + r * rise * Math.sin(a), 0, 0]); }
  lathe(mbDome, P, sg, {});
  // ribs
  if (o.ribs) {
    for (let k = 0; k < o.ribs; k++) {
      const a0 = (k / o.ribs) * PI * 2;
      tube(mbDome, (t, out) => { const a = t * PI * 0.5 * 0.97; const rr = r * Math.cos(a) * 1.0; out[0] = Math.cos(a0) * rr; out[2] = Math.sin(a0) * rr; out[1] = hd + r * rise * Math.sin(a); }, r * 0.025, 8, 4, { aux: [0.1, 0.6, 0, 0] });
    }
  }
  // lantern finial
  lathe(mbDome, [[r * 0.12, hd + r * rise - r * 0.02, 0, 0], [r * 0.12, hd + r * rise + r * 0.08, 0, 0.5, true], [r * 0.07, hd + r * rise + r * 0.12, 0, 0], [r * 0.09, hd + r * rise + r * 0.2, 0, 0], [0.001, hd + r * rise + r * 0.38, 0, 0]], 10, {});
  return hd + r * rise + r * 0.38;
}

// ------------------------------------------------------------------------------------ basin
/** round fountain basin: base y=0, outer radius R, wall height h; writes rim (marble), panels (gilt) and floor */
export function basin(mbStone, mbGilt, R, h, o = {}) {
  const sg = o.segs ?? 64, t = o.wall ?? Math.max(0.35, R * 0.07);
  // stepped plinth + wall with moulded coping
  lathe(mbStone, [[R + 0.6, 0, 0.3, 0, true], [R + 0.6, 0.18, 0, 0.6, true], [R + 0.3, 0.2, 0.2, 0, true], [R + 0.3, 0.35, 0, 0.6, true], [R, 0.37, 0.3, 0, true],
    [R, h - 0.18, 0, 0], [R + 0.12, h - 0.12, 0, 0.6, true], [R + 0.12, h, 0, 0.7, true], [R - t - 0.08, h, 0, 0.6, true], [R - t - 0.08, h - 0.08, 0.2, 0.5, true], [R - t, h - 0.14, 0.3, 0, true], [R - t, 0.05, 0.6, 0, true], [0.001, 0.05, 0.6, 0]], sg, { masonry: 3.04 });
  // gilt relief panels on the outer wall
  if (mbGilt && (o.panels ?? true)) {
    const np = Math.max(6, Math.round((2 * PI * R) / (o.panelW ?? 2.4)));
    for (let i = 0; i < np; i++) {
      const a = (i / np) * PI * 2;
      mbGilt.push(); mbGilt.rotateY(a); mbGilt.translate(0, 0, R - 0.01);
      const pw = (2 * PI * R) / np * 0.62, ph = (h - 0.6) * 0.72;
      box(mbGilt, [-pw / 2, 0.37 + (h - 0.55 - ph) * 0.5, 0], [pw / 2, 0.37 + (h - 0.55 - ph) * 0.5 + ph, 0.025], 0.008, [0.2, 0.5, 0, 0]);
      mbGilt.push(); mbGilt.translate(-ph * 0.55, 0.37 + (h - 0.55 - ph) * 0.5 + ph * 0.1, 0.02); silhouette(mbGilt, i % 2 ? 'dolphin' : 'hippocamp', ph * 0.85, 0.04, false); mbGilt.pop();
      mbGilt.pop();
    }
  }
}

// ------------------------------------------------------------------------------------ palace
/**
 * Palace / hall block for the citadel ledges (refs 1, 4): podium, walls (red / banded / white), a white
 * portico of columns on the front (+Z), flat roof with a cornice + parapet, optional gold dome or second storey.
 * Writes into a Building B at the current transforms of its builders (call B.get(k).push()/translate first via `at`).
 * o: { w, d, h, wall:'red'|'banded'|'marble', portico (bool), colGeo (instanced column {geometry, info}), dome (radius|0),
 *      storey2 (bool), at: THREE.Matrix4 (placement in the building frame), seed, windows }
 * Returns { top, domeTop }.
 */
export function palace(B, o) {
  const M = o.at || new THREE.Matrix4();
  const w = o.w, d = o.d, seed = o.seed ?? 1;
  const ruin = !!o.ruin;
  const h = ruin ? o.h * (0.5 + 0.35 * hash3(seed, 3, 7)) : o.h;
  const wallKey = o.wall || 'red';
  const keys = [...new Set(['marble', 'gold', 'interior', wallKey, 'black', 'dome', 'orichalcum'])];
  const mbs = {}; for (const k of keys) { mbs[k] = B.get(k); mbs[k].push(); mbs[k].apply(M); }
  const mW = mbs[wallKey], mM = mbs.marble, mI = mbs.interior, mG = mbs.gold;
  const pod = o.podium ?? 1.2;
  // podium (white with dark base course)
  box(mbs.black, [-w / 2 - 0.6, -2.5, -d / 2 - 0.6], [w / 2 + 0.6, 0.25, d / 2 + 0.6], 0.03, [0.2, 0.5, 0.2, 0]);
  box(mM, [-w / 2 - 0.4, 0.25, -d / 2 - 0.4], [w / 2 + 0.4, pod, d / 2 + 0.4], 0.03, [0.1, 0.8, 0.2, 3.04]);
  // walls
  const y0 = pod;
  const pD = o.portico ? (o.porticoDepth ?? 4.2) : 0;
  const zf = d / 2 - pD;
  box(mW, [-w / 2, y0, -d / 2], [w / 2, y0 + h, zf], 0.03, [0.05, 0.2, 0.4, 0]);
  // white string course + cornice
  box(mM, [-w / 2 - 0.15, y0 + h * 0.48, -d / 2 - 0.15], [w / 2 + 0.15, y0 + h * 0.48 + 0.35, zf + 0.15], 0.03, [0.1, 0.7, 0.5, 0]);
  if (!ruin) box(mM, [-w / 2 - 0.4, y0 + h, -d / 2 - 0.4], [w / 2 + 0.4, y0 + h + 0.7, d / 2 + 0.4], 0.04, [0.1, 0.8, 0.6, 0]);
  if (!ruin) box(mG, [-w / 2 - 0.42, y0 + h + 0.5, -d / 2 - 0.42], [w / 2 + 0.42, y0 + h + 0.58, d / 2 + 0.42], 0, [0.1, 0.5, 0, 0]);
  // parapet
  const yp = y0 + h + 0.7;
  if (!ruin) for (const [a, b] of [[[-w / 2 - 0.4, -d / 2 - 0.4], [w / 2 + 0.4, -d / 2 - 0.1]], [[-w / 2 - 0.4, d / 2 + 0.1], [w / 2 + 0.4, d / 2 + 0.4]], [[-w / 2 - 0.4, -d / 2 - 0.4], [-w / 2 - 0.1, d / 2 + 0.4]], [[w / 2 + 0.1, -d / 2 - 0.4], [w / 2 + 0.4, d / 2 + 0.4]]]) {
    box(mM, [a[0], yp, a[1]], [b[0], yp + 0.9, b[1]], 0.02, [0.05, 0.6, 0.3, 0]);
  }
  // windows: dark recessed openings with white frames (two storeys)
  const nwin = Math.max(1, Math.floor(w / 3.2));
  const wy = [y0 + h * 0.15, y0 + h * 0.6];
  for (const yy of wy) for (let i = 0; i < nwin; i++) {
    if (yy + h * 0.3 > y0 + h) continue;
    const x = -w / 2 + (i + 0.5) * (w / nwin);
    if (hash3(seed, i, yy) < 0.12) continue;
    for (const [zz, s] of [[zf, 1], [-d / 2, -1]]) {
      box(mI, [x - 0.55, yy, zz - 0.02 * s], [x + 0.55, yy + h * 0.28, zz + 0.03 * s], 0, [0.6, 0, 0, 0]);
      box(mM, [x - 0.7, yy - 0.12, zz], [x + 0.7, yy, zz + 0.18 * s], 0.01, [0.1, 0.7, 0.3, 0]);
      box(mM, [x - 0.75, yy + h * 0.28, zz], [x + 0.75, yy + h * 0.28 + 0.2, zz + 0.2 * s], 0.01, [0.1, 0.7, 0.3, 0]);
    }
  }
  const nwz = Math.max(1, Math.floor(d / 3.6));
  for (const yy of wy) for (let i = 0; i < nwz; i++) {
    const z = -d / 2 + (i + 0.5) * ((d - pD) / nwz);
    for (const s of [-1, 1]) box(mI, [s * w / 2 - 0.03, yy, z - 0.5], [s * w / 2 + 0.03, yy + h * 0.28, z + 0.5], 0, [0.6, 0, 0, 0]);
  }
  // portico: columns (instanced), architrave, ceiling, dark back wall
  if (o.portico && o.colGeo) {
    const cg = o.colGeo, D = cg.info.D;
    const n = Math.max(2, Math.round(w / (o.colSpacing ?? 3.4)) + 1);
    const span = w - 1.2;
    const colTop = y0 + cg.info.height;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const x = -span / 2 + (span * i) / (n - 1);
      if (ruin && hash3(seed, i, 41) < 0.45) continue;
      m4.copy(M).multiply(new THREE.Matrix4().makeTranslation(x, y0, d / 2 - 0.8));
      B.addInstance(o.colKey || 'palaceCols', cg.geometry, m4);
    }
    if (!ruin) {
      box(mM, [-w / 2, colTop, d / 2 - 1.5], [w / 2, y0 + h, d / 2 + 0.1], 0.02, [0.05, 0.4, 0.5, 0]);
      box(mG, [-w / 2, colTop + 0.25, d / 2 + 0.1], [w / 2, colTop + 0.38, d / 2 + 0.13], 0, [0.1, 0.4, 0, 0]);
      box(mI, [-w / 2, y0 + h - 0.02, zf], [w / 2, y0 + h, d / 2], 0, [0.5, 0, 0, 0]);
    }
    box(mI, [-w / 2 + 0.2, y0, zf - 0.02], [w / 2 - 0.2, colTop, zf + 0.02], 0, [0.4, 0, 0, 0]);
    box(mM, [-w / 2, y0 - 0.02, zf], [w / 2, y0 + 0.02, d / 2], 0, [0.05, 0, 0, 5.11]);
    // side walls of the portico
    for (const s of [-1, 1]) box(mW, [s < 0 ? -w / 2 : w / 2 - 0.5, y0, zf], [s < 0 ? -w / 2 + 0.5 : w / 2, y0 + h, d / 2 - 1.5], 0.02, [0.05, 0.2, 0.4, 0]);
  }
  let top = yp + 0.9, domeTop = top;
  // optional upper storey (smaller, white) and gold dome
  if (o.storey2 && !ruin) {
    const w2 = w * 0.55, d2 = (d - pD) * 0.6, h2 = h * 0.6;
    box(mM, [-w2 / 2, yp, -d2 / 2 - pD / 2], [w2 / 2, yp + h2, d2 / 2 - pD / 2], 0.03, [0.05, 0.3, 0.4, 3.05]);
    box(mM, [-w2 / 2 - 0.3, yp + h2, -d2 / 2 - pD / 2 - 0.3], [w2 / 2 + 0.3, yp + h2 + 0.5, d2 / 2 - pD / 2 + 0.3], 0.03, [0.1, 0.8, 0.5, 0]);
    for (let i = 0; i < Math.floor(w2 / 2.6); i++) { const x = -w2 / 2 + (i + 0.5) * (w2 / Math.floor(w2 / 2.6)); box(mI, [x - 0.4, yp + h2 * 0.25, d2 / 2 - pD / 2 - 0.02], [x + 0.4, yp + h2 * 0.75, d2 / 2 - pD / 2 + 0.03], 0, [0.6, 0, 0, 0]); }
    top = yp + h2 + 0.5; domeTop = top;
  }
  if (o.dome && !ruin) {
    const r = o.dome;
    mbs.marble.push(); mbs.dome.push(); mbs.marble.translate(0, top, -pD / 2); mbs.dome.translate(0, top, -pD / 2);
    domeTop = top + dome(mbs.marble, o.domeKey === 'orichalcum' ? mbs.orichalcum : mbs.gold, r, { drum: r * 0.5, rise: 0.9, ribs: o.ribs ?? 12, segs: 32 });
    mbs.marble.pop(); mbs.dome.pop();
  }
  for (const k of keys) mbs[k].pop();
  return { top, domeTop };
}

// ------------------------------------------------------------------------------------ cheap column (far LOD)
const _simpleCol = new Map();
/** low-poly column (no flutes) for buildings seen from afar: {geometry, info:{D, height}}; o: { height, diameter, segs, capital:'ionic'|'doric' } */
export function simpleColumnGeometry(o = {}) {
  const k = JSON.stringify(o);
  if (_simpleCol.has(k)) return _simpleCol.get(k);
  const H = o.height ?? 6, D = o.diameter ?? H / 9, sg = o.segs ?? 10;
  const mb = new MeshBuilder();
  const R = D / 2;
  box(mb, [-0.68 * D, 0, -0.68 * D], [0.68 * D, 0.14 * D, 0.68 * D], 0, [0.1, 0.6, 0.1, 0]);
  const yc = H - 0.42 * D;
  lathe(mb, [[R * 1.18, 0.14 * D, 0.2, 0, true], [R * 1.18, 0.24 * D, 0, 0.6], [R * 1.02, 0.34 * D, 0.2, 0, true], [R, 0.4 * D, 0, 0], [R * 0.86, yc - 0.05 * D, 0, 0, true],
    [R * 0.98, yc, 0.1, 0.5, true], [R * 1.25, yc + 0.18 * D, 0, 0.5], [R * 1.3, yc + 0.24 * D, 0, 0.6, true]], sg, {});
  box(mb, [-0.68 * D, yc + 0.24 * D, -0.68 * D], [0.68 * D, H, 0.68 * D], 0, [0.05, 0.7, 0.2, 0]);
  if ((o.capital ?? 'ionic') === 'ionic') for (const s of [-1, 1]) { mb.push(); mb.translate(s * 0.62 * D, yc + 0.12 * D, 0); mb.rotateX(PI / 2); lathe(mb, [[0.17 * D, -0.6 * D, 0.2, 0], [0.17 * D, 0.6 * D, 0.2, 0]], 8, { capTop: true, capBottom: true }); mb.pop(); }
  const res = { geometry: mb.geometry(), info: { D, height: H } };
  _simpleCol.set(k, res);
  return res;
}

// ------------------------------------------------------------------------------------ rampart
/**
 * Circular red rampart (citadel tiers, refs 4, 5): black base course, red ashlar body with white string courses,
 * gilt panels, white cornice + merlons; slender white towers with gold caps. World frame (B at identity).
 * o: { r, y0 (foot), h, t (thickness), gapAt(bearingDeg) → true to leave an opening, towerEvery (m), seed, ruin, onTower(pos) }
 */
export function rampart(B, o) {
  const { r, y0, h } = o;
  const t = o.t ?? 2.4, seed = o.seed ?? 1, ruin = !!o.ruin;
  const mR = B.get('red'), mM = B.marble, mK = B.get('black'), mG = B.gold, mGr = B.get('giltRelief');
  const segL = o.segL ?? 4.2;
  const n = Math.round((2 * PI * r) / segL);
  const towers = [];
  let lastTower = -1e9, run = 0;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * PI * 2;               // compass bearing (rad): x = sin, z = -cos
    const bdeg = (a * 180) / PI;
    if (o.gapAt && o.gapAt(bdeg)) { run = 0; continue; }
    const chord = 2 * r * Math.sin(PI / n) + 0.02;
    const hh = ruin ? h * (0.45 + 0.5 * hash3(seed, i, 3)) : h;
    const x = Math.sin(a) * r, z = -Math.cos(a) * r;
    const rot = PI - a;                               // local +Z faces outward (compass bearing a)
    for (const m of [mR, mM, mK, mG, mGr]) { m.push(); m.translate(x, y0, z); m.rotateY(rot); }
    box(mK, [-chord / 2, -2.0, -t / 2 - 0.25], [chord / 2, 1.0, t / 2 + 0.25], 0.03, [0.15, 0.6, 0.2, 0]);
    box(mR, [-chord / 2, 1.0, -t / 2], [chord / 2, hh - 1.2, t / 2], 0.0, [0.05, 0, 0.5, 3.055]);
    if (!ruin || hh > h * 0.9) {
      box(mM, [-chord / 2, hh * 0.42, t / 2 - 0.05], [chord / 2, hh * 0.42 + 0.35, t / 2 + 0.12], 0.02, [0.1, 0.7, 0.4, 0]);
      box(mM, [-chord / 2, hh - 1.2, -t / 2 - 0.1], [chord / 2, hh - 0.4, t / 2 + 0.35], 0.03, [0.05, 0.8, 0.5, 0]);
      box(mG, [-chord / 2, hh - 0.95, t / 2 + 0.35], [chord / 2, hh - 0.85, t / 2 + 0.37], 0, [0.1, 0.4, 0, 0]);
      // merlons
      if (i % 2 === 0) box(mM, [-chord * 0.3, hh - 0.4, t / 2 - 0.5], [chord * 0.3, hh + 0.6, t / 2 + 0.2], 0.03, [0.05, 0.8, 0.4, 0]);
      // gilt panel every 3rd segment
      if (run % 3 === 1) {
        const ph = Math.min(3.2, (hh - 3.2) * 0.42), py = hh * 0.62;
        box(mGr, [-chord * 0.32, py, t / 2 - 0.02], [chord * 0.32, py + ph, t / 2 + 0.06], 0.01, [0.2, 0.6, 0, 0]);
        mG.push(); mG.translate(0, py + 0.15, t / 2 + 0.06); trident(mG, ph * 0.85, { detail: 0.3 }); mG.pop();
      }
    }
    for (const m of [mR, mM, mK, mG, mGr]) m.pop();
    run++;
    const arc = (i / n) * 2 * PI * r;
    if (!ruin && o.towerEvery && arc - lastTower > o.towerEvery && run > 2) {
      lastTower = arc;
      towers.push([x, y0, z, a]);
    }
  }
  // towers: square white shaft, gold band, open lantern, gold dome / pinnacle
  for (const [x, yb, z, a] of towers) {
    const th = o.towerH ?? h + 9, tw = o.towerW ?? 4.2;
    const rx = Math.sin(a) * (t / 2 + tw * 0.25), rz = -Math.cos(a) * (t / 2 + tw * 0.25);
    for (const m of [mM, mG, mK]) { m.push(); m.translate(x + rx, yb, z + rz); m.rotateY(PI - a); }
    box(mK, [-tw / 2 - 0.3, -2, -tw / 2 - 0.3], [tw / 2 + 0.3, 1.2, tw / 2 + 0.3], 0.03, [0.1, 0.7, 0.2, 0]);
    box(mM, [-tw / 2, 1.2, -tw / 2], [tw / 2, th, tw / 2], 0.03, [0.05, 0.3, 0.5, 3.05]);
    box(mM, [-tw / 2 - 0.3, th, -tw / 2 - 0.3], [tw / 2 + 0.3, th + 0.6, tw / 2 + 0.3], 0.03, [0.05, 0.8, 0.5, 0]);
    box(mG, [-tw / 2 - 0.32, th + 0.2, -tw / 2 - 0.32], [tw / 2 + 0.32, th + 0.35, tw / 2 + 0.32], 0, [0.1, 0.5, 0, 0]);
    // dark window slits
    for (const s of [-1, 1]) box(B.mb.interior, [s * 0.9 - 0.25, th * 0.55, tw / 2 - 0.01], [s * 0.9 + 0.25, th * 0.55 + 2.2, tw / 2 + 0.02], 0, [0.6, 0, 0, 0]);
    // lantern + gold dome
    mM.push(); mM.translate(0, th + 0.6, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(mM, [sx * tw * 0.36 - 0.25, 0, sz * tw * 0.36 - 0.25], [sx * tw * 0.36 + 0.25, 2.4, sz * tw * 0.36 + 0.25], 0.02, [0.05, 0.6, 0.3, 0]);
    box(mM, [-tw * 0.45, 2.4, -tw * 0.45], [tw * 0.45, 2.8, tw * 0.45], 0.02, [0.05, 0.8, 0.4, 0]);
    mM.pop();
    mG.push(); mG.translate(0, th + 3.4, 0);
    dome(mM, mG, tw * 0.42, { drum: 0.0, rise: 1.1, ribs: 8, segs: 16 });
    mG.pop();
    for (const m of [mM, mG, mK]) m.pop();
    if (o.onTower) o.onTower([x + rx, yb + th + 3.4 + tw * 0.42 * 1.5, z + rz], a);
  }
  return towers.length;
}

// ------------------------------------------------------------------------------------ great rampart (r3)
/** gilt medallion facing local +Z at the current transform: rayed rim, boss, small trident (ref 5 rampart roundels) */
export function medallion(mbGold, mbFrame, R, o = {}) {
  const det = o.detail ?? 0.5;
  mbFrame.push(); mbFrame.rotateX(PI / 2);
  lathe(mbFrame, [[R, -0.02, 0.2, 0], [R, 0.12, 0, 0.7, true], [R * 0.9, 0.2, 0, 0.7, true], [R * 0.84, 0.1, 0.4, 0, true], [R * 0.84, 0.04, 0.5, 0, true], [0.001, 0.04, 0.5, 0]], det > 0.6 ? 28 : 20, {});
  mbFrame.pop();
  // rays (sun-like rim, alternating long / short)
  const nr = o.rays ?? 16;
  for (let k = 0; k < nr; k++) {
    const a = (k / nr) * PI * 2, l = k % 2 ? 0.16 : 0.3;
    mbGold.push(); mbGold.rotateZ(a);
    box(mbGold, [-R * 0.05, R * 1.02, -0.02], [R * 0.05, R * (1.02 + l), 0.1], 0.01, [0.1, 0.6, 0, 0]);
    mbGold.pop();
  }
  mbGold.push(); mbGold.rotateX(PI / 2);
  lathe(mbGold, [[R * 0.34, 0.04, 0.3, 0], [R * 0.3, 0.16, 0, 0.6, true], [R * 0.16, 0.24, 0, 0.5, true], [0.001, 0.27, 0, 0]], 16, {});
  mbGold.pop();
  if (o.trident !== false) { mbGold.push(); mbGold.translate(0, -R * 0.74, 0.12); trident(mbGold, R * 1.48, { detail: 0.3 }); mbGold.pop(); }
}

/**
 * r3 great orichalcum rampart (refs 1, 4, 5): the citadel's red tiers. A solid annulus wall rIn..rOut from yFoot to yTop
 * (its top is a paved walkway; the inner part is buried in the hill / cliff), outer face in bays: black plinth, red field
 * with gilt-framed panels (lower register) and rayed gilt medallions (upper register), orichalcum pilasters with gold bases
 * and capitals, white string course, white cornice with a gold band and dentils, low parapet; bastion towers (white with red
 * courses, open lantern, gold dome). World frame (B at identity).
 * o: { rIn, rOut, yFoot, yTop, bay (m, ≈ 10), gapAt(bearingDeg) → true to leave an opening, towerEvery (m), towerAt(b) → bool,
 *      towerH (above yTop), seed, ruin, detail, onTower(pos, a), onBay({pos, a, top, i}) }
 * Returns { bays, towers }.
 */
export function greatRampart(B, o) {
  const { rIn, rOut, yFoot, yTop } = o;
  const seed = o.seed ?? 1, ruin = !!o.ruin, det = o.detail ?? 0.6;
  const mR = B.get('red'), mM = B.marble, mK = B.get('black'), mG = B.gold, mGr = B.get('giltRelief'), mO = B.get('orichalcum'), mBd = B.get('banded');
  const all = [mR, mM, mK, mG, mGr, mO, mBd];
  const H = yTop - yFoot, T = rOut - rIn;
  const n = Math.max(12, Math.round((2 * PI * rOut) / (o.bay ?? 10)));
  const da = (2 * PI) / n;
  const W = 2 * rOut * Math.sin(da / 2);
  const gap = (i) => { const a = (((i % n) + n) % n + 0.5) * da; return !!(o.gapAt && o.gapAt((a * 180) / PI)); };
  const towers = [];
  let lastTower = -1e9, bays = 0;
  const hs = Math.max(4.6, H * 0.36);          // string course height above the foot
  const yc = H - Math.max(2.0, H * 0.11);      // cornice bottom
  const pw = Math.min(1.6, W * 0.13);          // pilaster width
  for (let i = 0; i < n; i++) {
    if (gap(i)) continue;
    const a = (i + 0.5) * da;
    const x = Math.sin(a) * rOut, z = -Math.cos(a) * rOut;
    const hh = ruin ? H * (0.55 + 0.4 * hash3(seed, i, 3)) : H;
    for (const m of all) { m.push(); m.translate(x, yFoot, z); m.rotateY(PI - a); }
    const w2 = W / 2 + 0.02;
    // plinth + base moulding
    box(mK, [-w2, -2.6, -T], [w2, 1.3, 0.5], 0.04, [0.15, 0.7, 0.2, 3.045]);
    box(mM, [-w2, 1.3, -0.4], [w2, 1.8, 0.32], 0.03, [0.1, 0.8, 0.3, 0]);
    // body: red field (ashlar), its core reaching back into the hill
    box(mR, [-w2, 1.8, -T], [w2, Math.min(hh, yc), 0], 0, [0.05, 0, 0.5, 3.07]);
    if (!ruin || hh > H * 0.92) {
      // white string course with a gold fillet
      box(mM, [-w2, hs, -0.1], [w2, hs + 0.55, 0.26], 0.03, [0.1, 0.8, 0.4, 0]);
      box(mG, [-w2, hs + 0.2, 0.26], [w2, hs + 0.3, 0.29], 0, [0.1, 0.4, 0, 0]);
      // cornice (white, overhanging), gold band, dentils, frieze, walkway slab
      box(mM, [-w2, yc, -T], [w2, H - 0.25, 0.25], 0.03, [0.05, 0.6, 0.5, 0]);
      box(mM, [-w2, yc + 0.55, 0.25], [w2, yc + 1.0, 0.75], 0.03, [0.05, 0.9, 0.6, 0]);
      box(mG, [-w2, yc + 0.3, 0.25], [w2, yc + 0.42, 0.29], 0, [0.1, 0.4, 0, 0]);
      const nd = Math.floor(W / 0.55);
      if (det >= 0.5) for (let k = 0; k < nd; k++) { const xx = -W / 2 + (k + 0.5) * (W / nd); box(mM, [xx - 0.14, yc + 0.32, 0.25], [xx + 0.14, yc + 0.55, 0.5], 0, [0.2, 0.5, 0, 0]); }
      box(mM, [-w2, H - 0.25, -T], [w2, H, 0.3], 0.02, [0.05, 0.7, 0.1, 5.24]);
      // parapet: low white wall with a gold coping fillet, merlon blocks over the pilasters
      box(mM, [-w2, H, -0.15], [w2, H + 1.05, 0.3], 0.03, [0.05, 0.7, 0.3, 0]);
      box(mG, [-w2, H + 0.95, 0.3], [w2, H + 1.0, 0.32], 0, [0.1, 0.4, 0, 0]);
      box(mM, [-W / 2 - pw * 0.7, H, -0.25], [-W / 2 + pw * 0.7, H + 1.7, 0.4], 0.03, [0.05, 0.8, 0.4, 0]);
      // lower register: gilt-framed panel; upper register: rayed medallion in a gilt frame
      const fx = W / 2 - pw / 2 - 0.85, fw = 0.2;
      const frame = (y0, y1) => {
        box(mGr, [-fx, y0, -0.02], [fx, y0 + fw, 0.08], 0.01, [0.2, 0.7, 0, 0]);
        box(mGr, [-fx, y1 - fw, -0.02], [fx, y1, 0.08], 0.01, [0.2, 0.7, 0, 0]);
        box(mGr, [-fx, y0 + fw, -0.02], [-fx + fw, y1 - fw, 0.08], 0.01, [0.2, 0.7, 0, 0]);
        box(mGr, [fx - fw, y0 + fw, -0.02], [fx, y1 - fw, 0.08], 0.01, [0.2, 0.7, 0, 0]);
      };
      if (hs - 2.9 > 1.2) frame(2.5, hs - 0.6);
      const u0 = hs + 1.2, u1 = yc - 0.7;
      if (u1 - u0 > 2.5) {
        frame(u0, u1);
        const R = Math.min(fx * 0.62, (u1 - u0) * 0.33);
        if (det >= 0.35 && !(ruin && hash3(seed, i, 8) < 0.5)) { mG.push(); mGr.push(); mG.translate(0, (u0 + u1) / 2, 0.05); mGr.translate(0, (u0 + u1) / 2, 0.05); medallion(mG, mGr, R, { detail: det, trident: det >= 0.5 }); mG.pop(); mGr.pop(); }
      }
    }
    // pilasters (orichalcum shafts, gold base + capital) at the bay's left joint, and the right one before a gap
    const pil = (px) => {
      const top = Math.min(hh, yc);
      box(mO, [px - pw / 2, 1.8, -0.05], [px + pw / 2, top, 0.42], 0.02, [0.05, 0.6, 0.3, 0]);
      box(mG, [px - pw / 2 - 0.1, 1.8, -0.05], [px + pw / 2 + 0.1, 2.4, 0.52], 0.02, [0.1, 0.6, 0, 0]);
      if (!ruin || hh > H * 0.92) {
        box(mG, [px - pw / 2 - 0.12, top - 0.75, -0.05], [px + pw / 2 + 0.12, top, 0.55], 0.02, [0.1, 0.6, 0, 0]);
        box(mG, [px - pw * 0.18, hs + 1.4, 0.42], [px + pw * 0.18, top - 1.3, 0.47], 0.01, [0.1, 0.5, 0, 0]);   // gold flute strip
      }
    };
    pil(-W / 2);
    if (gap(i + 1)) pil(W / 2);
    for (const m of all) m.pop();
    bays++;
    if (o.onBay) o.onBay({ pos: [x, yFoot + hh, z], a, top: yFoot + hh, i });
    const arc = i * da * rOut;
    const joint = (k) => [Math.sin(k * da) * rOut, Math.cos(k * da) * -rOut, k * da];
    const want = o.towerAt ? o.towerAt((a * 180) / PI, arc - lastTower) : (o.towerEvery && arc - lastTower > o.towerEvery);
    if (want && !gap(i - 1) && !gap(i + 1)) { lastTower = arc; towers.push(joint(i)); }
    // flank towers framing an opening (the stair, a cascade pouring through the wall)
    if (o.flankAt && gap(i - 1) && o.flankAt((((i - 0.5) * da) * 180) / PI)) { lastTower = arc; towers.push(joint(i)); }
    if (o.flankAt && gap(i + 1) && o.flankAt((((i + 1.5) * da) * 180) / PI)) { lastTower = arc + W; towers.push(joint(i + 1)); }
  }
  // bastion towers at bay joints: banded white / red shaft projecting from the wall, gold capital band, open lantern, gold dome
  const th = H + (o.towerH ?? 8), tw = o.towerW ?? Math.min(8, Math.max(5, H * 0.36)), tp = tw * 0.55;
  for (const [x, z, a] of towers) {
    if (ruin && hash3(seed, x, 77) < 0.35) continue;
    const top = ruin ? th * (0.6 + 0.25 * hash3(seed, z, 5)) : th;
    for (const m of all) { m.push(); m.translate(x, yFoot, z); m.rotateY(PI - a); }
    box(mK, [-tw / 2 - 0.4, -2.6, -2], [tw / 2 + 0.4, 1.5, tp + 0.4], 0.04, [0.1, 0.7, 0.2, 0]);
    // white shaft (refs 4 / 5 slender white towers) with two red bands and gold fillets
    box(mM, [-tw / 2, 1.5, -2], [tw / 2, top, tp], 0.03, [0.05, 0.3, 0.5, 3.07]);
    for (const fy of [0.3, 0.62]) {
      const yb = 1.5 + (top - 1.5) * fy;
      box(mR, [-tw / 2 - 0.06, yb, -2], [tw / 2 + 0.06, yb + 1.4, tp + 0.06], 0.01, [0.05, 0.4, 0.3, 0]);
      box(mG, [-tw / 2 - 0.08, yb + 1.4, -2], [tw / 2 + 0.08, yb + 1.5, tp + 0.08], 0, [0.1, 0.4, 0, 0]);
    }
    if (!ruin) {
      box(mM, [-tw / 2 - 0.35, top, -2.3], [tw / 2 + 0.35, top + 0.8, tp + 0.35], 0.03, [0.05, 0.8, 0.5, 0]);
      box(mG, [-tw / 2 - 0.37, top + 0.3, -2.3], [tw / 2 + 0.37, top + 0.45, tp + 0.37], 0, [0.1, 0.5, 0, 0]);
      // gilt panel with a trident on the front face
      box(mGr, [-tw * 0.3, top - 6.2, tp - 0.02], [tw * 0.3, top - 1.4, tp + 0.07], 0.01, [0.2, 0.6, 0, 0]);
      mG.push(); mG.translate(0, top - 6.0, tp + 0.07); trident(mG, 4.4, { detail: 0.3 }); mG.pop();
      // dark window slits
      for (const s of [-1, 1]) box(B.mb.interior, [s * tw * 0.22 - 0.3, top * 0.42, tp - 0.01], [s * tw * 0.22 + 0.3, top * 0.42 + 2.6, tp + 0.02], 0, [0.6, 0, 0, 0]);
      // lantern: four piers + entablature, gold dome with a trident finial
      const lc = (tp - 2) / 2;
      mM.push(); mM.translate(0, top + 0.8, lc);
      const lr = tw * 0.36;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(mM, [sx * lr - 0.35, 0, sz * lr - 0.35], [sx * lr + 0.35, 3.0, sz * lr + 0.35], 0.02, [0.05, 0.6, 0.3, 0]);
      box(mM, [-lr - 0.6, 3.0, -lr - 0.6], [lr + 0.6, 3.6, lr + 0.6], 0.02, [0.05, 0.8, 0.4, 0]);
      mM.pop();
      mG.push(); mM.push(); mG.translate(0, top + 4.4, lc); mM.translate(0, top + 4.4, lc);
      const dt = dome(mM, mG, lr + 0.3, { drum: 0, rise: 1.05, ribs: 8, segs: 18 });
      mG.translate(0, dt - 0.2, 0); pinnacle(mG, 2.4, { detail: 0.4 });
      mG.pop(); mM.pop();
      if (o.onTower) { const lx = Math.sin(a) * (tp + 0.3), lz = -Math.cos(a) * (tp + 0.3); o.onTower([x + lx, yFoot + top - 2, z + lz], a, yFoot + top + 4.4 + dt); }
    }
    for (const m of all) m.pop();
  }
  return { bays, towers: towers.length };
}

// ------------------------------------------------------------------------------------ pavilion (cheap tholos)
/** round open pavilion with a gold dome: stepped base, ring of instanced columns, entablature ring, dome. o: { R, n, colGeo, colKey, at: Matrix4, ruin } */
export function pavilion(B, o) {
  const M = o.at || new THREE.Matrix4();
  const R = o.R ?? 5, n = o.n ?? 10, cg = o.colGeo, H = cg.info.height, sg = 28;
  const mM = B.marble, mG = B.gold;
  for (const m of [mM, mG]) { m.push(); m.apply(M); }
  lathe(mM, [[R + 1.6, -2, 0.2, 0, true], [R + 1.6, 0.3, 0, 0.6, true], [R + 1.1, 0.3, 0, 0.6, true], [R + 1.1, 0.6, 0, 0.6, true], [R + 0.6, 0.6, 0, 0.6, true], [R + 0.6, 0.9, 0, 0.6, true], [0.01, 0.9, 0, 0]], sg, { masonry: 3.03 });
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    if (o.ruin && hash3(i, R, 9) < 0.4) continue;
    const a = (i / n) * PI * 2;
    m4.copy(M).multiply(new THREE.Matrix4().makeTranslation(Math.sin(a) * R, 0.9, Math.cos(a) * R));
    B.addInstance(o.colKey || 'pavCols', cg.geometry, m4);
  }
  if (!o.ruin) {
    const y = 0.9 + H;
    lathe(mM, [[R + 0.55, y, 0.1, 0.5, true], [R + 0.55, y + 1.1, 0, 0.5, true], [R + 0.85, y + 1.3, 0, 0.7, true], [R + 0.85, y + 1.55, 0, 0.7, true], [R - 0.6, y + 1.55, 0, 0.5, true], [R - 0.6, y, 0.3, 0, true], [R + 0.55, y, 0.1, 0.5, true]], sg, {});
    mG.push(); mM.push(); mG.translate(0, y + 1.55, 0); mM.translate(0, y + 1.55, 0);
    dome(mM, mG, R + 0.3, { drum: 0.8, rise: 0.85, ribs: 12, segs: sg });
    mG.pop(); mM.pop();
  }
  for (const m of [mM, mG]) m.pop();
}
