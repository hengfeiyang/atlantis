// Narrow-band surface nets for "heightfield + 3D rock displacement", one square chunk at a time.
// Works in the main thread, in workers and in node (no three.js import).
//
// Field:  F(x,y,z) = dist(p, base heightfield surface) - w(x,z) * rockDisp(p)
//   dist ≈ min(|(y-h)/sqrt(1+|∇h|²)|, |horizontal distance to the h(x,z)=y contour|) with the sign of y-h.
//   The horizontal term (per-slice nearest-contour propagation) keeps the field a usable distance next to
//   sheer walls, so rock columns, beds and overhangs can be several metres deep on vertical cliffs.
// Chunks of the same cell size produce identical vertices in their overlap (fixed world lattice).
import { heightAt, waterSDF } from '../world/heightfield.js';
import { rockDisp, rockColumn, rockDispC, dispMaxIn, COL_STRIDE, protectFlat, outcrop, CAV } from './field.js';

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @param {object} job { x0, z0, n, cell, ext=1, disp=true, outcrops=true }
 *   chunk covers [x0, x0 + n*cell] × [z0, z0 + n*cell] (+ ext cells of overlap on each side)
 * @returns {{ position: Float32Array, normal: Float32Array, ter: Float32Array, index: Uint32Array, ymin, ymax }}
 */
export function meshChunk(job) {
  const { x0, z0, n } = job;
  const c = job.cell, ext = job.ext ?? 1;
  const useDisp = (job.disp ?? true) && c <= 2.01;
  const useOut = (job.outcrops ?? true) && c <= 1.01;
  // largest rock displacement in this chunk (the far crags use a 2× coarser, deeper rock)
  const DISP_MAX = dispMaxIn(x0 - 8 * c, z0 - 8 * c, x0 + (n + 8) * c, z0 + (n + 8) * c);
  const R = useDisp ? Math.ceil((DISP_MAX + c) / c) + 1 : 1;
  const M = ext + R + 1;
  const nc = n + 2 * M + 1;
  const NC = nc * nc;
  const wx = (a) => x0 + (a - M) * c;
  const wz = (b) => z0 + (b - M) * c;

  // ---------------------------------------------------------------- 1. column heights
  const H = new Float32Array(NC);
  const OUT = useOut ? new Float32Array(NC) : null;
  const PROT = new Uint8Array(NC);
  for (let b = 0; b < nc; b++) for (let a = 0; a < nc; a++) {
    const x = wx(a), z = wz(b);
    let h = heightAt(x, z);
    const o = b * nc + a;
    const prot = protectFlat(x, z);
    PROT[o] = prot ? 1 : 0;
    if (useOut && !prot && h > 0.8) { const oc = outcrop(x, z); OUT[o] = oc; h += oc; }
    H[o] = h;
  }
  // gradient magnitude (tan of slope)
  const G = new Float32Array(NC);
  for (let b = 0; b < nc; b++) for (let a = 0; a < nc; a++) {
    const a0 = a > 0 ? a - 1 : a, a1 = a < nc - 1 ? a + 1 : a, b0 = b > 0 ? b - 1 : b, b1 = b < nc - 1 ? b + 1 : b;
    const gx = (H[b * nc + a1] - H[b * nc + a0]) / ((a1 - a0) * c), gz = (H[b1 * nc + a] - H[b0 * nc + a]) / ((b1 - b0) * c);
    G[b * nc + a] = Math.hypot(gx, gz);
  }
  // ---------------------------------------------------------------- 2. steepness weights (own + dilated)
  const WOWN = new Float32Array(NC), WD = new Float32Array(NC);
  let anySteep = false;
  if (useDisp) {
    for (let o = 0; o < NC; o++) { const w = sstep(0.75, 1.7, G[o]); WOWN[o] = w; if (w > 0) anySteep = true; }
    if (anySteep) {
      const tmp = new Float32Array(NC);
      maxFilter(WOWN, tmp, nc, R, true); maxFilter(tmp, WD, nc, R, false);
      for (let o = 0; o < NC; o++) {
        if (WD[o] <= 0) continue;
        const flat = G[o] < 0.45;
        if (flat) WD[o] *= PROT[o] ? 0 : 0.3 + 0.25 * sstep(0.15, 0.45, G[o]); // benches stay near heightAt() (vegetation)
      }
    }
  }
  // ---------------------------------------------------------------- 3. vertical band per column
  const HMIN = new Float32Array(NC), HMAX = new Float32Array(NC), tmp2 = new Float32Array(NC);
  minFilter(H, tmp2, nc, R, true); minFilter(tmp2, HMIN, nc, R, false);
  maxFilter(H, tmp2, nc, R, true); maxFilter(tmp2, HMAX, nc, R, false);
  // vertical bound for bulges: the highest ground within ~3.5 m (not R), so rims, plateau edges and the
  // camera platforms never grow upward by more than their immediate neighbourhood
  const HMAXV = new Float32Array(NC);
  if (useDisp) { const Rv = Math.max(1, Math.min(R, Math.ceil(3.5 / c))); maxFilter(H, tmp2, nc, Rv, true); maxFilter(tmp2, HMAXV, nc, Rv, false); }
  const A0 = M - ext - 1, A1 = M + n + ext + 1; // corner range used by cells (inclusive)
  const span = A1 - A0 + 1;
  const JLO = new Int32Array(span * span), JHI = new Int32Array(span * span), OFF = new Int32Array(span * span + 1);
  let total = 0, Jmin = 1e9, Jmax = -1e9;
  for (let b = A0; b <= A1; b++) for (let a = A0; a <= A1; a++) {
    const o = b * nc + a, s = (b - A0) * span + (a - A0);
    const pad = (WD[o] > 0 ? DISP_MAX : 0) + 2 * c;
    const lo = Math.floor((HMIN[o] - pad) / c), hi = Math.ceil((HMAX[o] + pad) / c);
    JLO[s] = lo; JHI[s] = hi; OFF[s] = total; total += hi - lo + 1;
    if (WD[o] > 0) { if (lo < Jmin) Jmin = lo; if (hi > Jmax) Jmax = hi; }
  }
  OFF[span * span] = total;
  const VAL = new Float32Array(total);
  // first-order distance for every band sample
  for (let b = A0; b <= A1; b++) for (let a = A0; a <= A1; a++) {
    const o = b * nc + a, s = (b - A0) * span + (a - A0);
    const h = H[o], inv = 1 / Math.sqrt(1 + G[o] * G[o]);
    for (let j = JLO[s], k = OFF[s]; j <= JHI[s]; j++, k++) VAL[k] = (j * c - h) * inv;
  }
  // ---------------------------------------------------------------- 4. horizontal distance + displacement near steep rock
  let COLD = null;
  if (anySteep) {
    COLD = new Float32Array(NC * COL_STRIDE);
    const tmpc = new Float32Array(COL_STRIDE);
    for (let b = A0; b <= A1; b++) for (let a = A0; a <= A1; a++) {
      const o = b * nc + a;
      if (WD[o] <= 0) continue;
      rockColumn(wx(a), wz(b), tmpc);
      COLD.set(tmpc, o * COL_STRIDE);
    }
    const SX = new Float32Array(NC), SZ = new Float32Array(NC), D2 = new Float32Array(NC);
    const V = new Float32Array(NC);
    const lim2 = (R + 1) * (R + 1);
    for (let j = Jmin; j <= Jmax; j++) {
      const y = j * c;
      // does any steep column need this slice?
      for (let o = 0; o < NC; o++) { V[o] = H[o] - y; D2[o] = 1e9; }
      // seeds on grid edges where the solid/air classification flips
      for (let b = 0; b < nc; b++) for (let a = 0; a < nc; a++) {
        const o = b * nc + a, v0 = V[o];
        if (a < nc - 1) {
          const v1 = V[o + 1];
          if ((v0 > 0) !== (v1 > 0)) {
            const t = v0 / (v0 - v1), px = a + t;
            let d = (px - a) * (px - a); if (d < D2[o]) { D2[o] = d; SX[o] = px; SZ[o] = b; }
            d = (px - a - 1) * (px - a - 1); if (d < D2[o + 1]) { D2[o + 1] = d; SX[o + 1] = px; SZ[o + 1] = b; }
          }
        }
        if (b < nc - 1) {
          const v1 = V[o + nc];
          if ((v0 > 0) !== (v1 > 0)) {
            const t = v0 / (v0 - v1), pz = b + t;
            let d = (pz - b) * (pz - b); if (d < D2[o]) { D2[o] = d; SX[o] = a; SZ[o] = pz; }
            d = (pz - b - 1) * (pz - b - 1); if (d < D2[o + nc]) { D2[o + nc] = d; SX[o + nc] = a; SZ[o + nc] = pz; }
          }
        }
      }
      // two-pass nearest-seed propagation (8SSEDT style), bounded
      const relax = (o, a, b, q) => {
        if (D2[q] >= 1e9) return;
        const dx = SX[q] - a, dz = SZ[q] - b, d = dx * dx + dz * dz;
        if (d < D2[o] && d < lim2) { D2[o] = d; SX[o] = SX[q]; SZ[o] = SZ[q]; }
      };
      for (let b = 0; b < nc; b++) for (let a = 0; a < nc; a++) {
        const o = b * nc + a;
        if (a > 0) relax(o, a, b, o - 1);
        if (b > 0) { relax(o, a, b, o - nc); if (a > 0) relax(o, a, b, o - nc - 1); if (a < nc - 1) relax(o, a, b, o - nc + 1); }
      }
      for (let b = nc - 1; b >= 0; b--) for (let a = nc - 1; a >= 0; a--) {
        const o = b * nc + a;
        if (a < nc - 1) relax(o, a, b, o + 1);
        if (b < nc - 1) { relax(o, a, b, o + nc); if (a < nc - 1) relax(o, a, b, o + nc + 1); if (a > 0) relax(o, a, b, o + nc - 1); }
      }
      // combine + displace for steep-influenced columns
      for (let b = A0; b <= A1; b++) for (let a = A0; a <= A1; a++) {
        const o = b * nc + a;
        const w = WD[o];
        if (w <= 0) continue;
        const s = (b - A0) * span + (a - A0);
        if (j < JLO[s] || j > JHI[s]) continue;
        const k = OFF[s] + j - JLO[s];
        let f = VAL[k];
        if (D2[o] < 1e9) {
          const dh = Math.sqrt(D2[o]) * c;
          if (dh < Math.abs(f)) f = f < 0 ? -dh : dh;
        }
        // hard bounds: above every column within R the point is at least (y - HMAX) away (and
        // below every column at least (HMIN - y) inside) — prevents floating blobs above rims
        const above = y - HMAX[o], below = HMIN[o] - y;
        if (above > 0 && f < above) f = above;
        if (below > 0 && f > -below) f = -below;
        if (Math.abs(f) < DISP_MAX * w + 1.5 * c) {
          // no bulges above the highest nearby ground (keeps rims and plateau edges clean)
          // (protected ground — plateau, terraces, camera platforms — never grows above its own height)
          const wt = Math.min(1, Math.max(0, ((PROT[o] ? H[o] + 0.3 : HMAXV[o]) - y) / 3.5));
          if (wt > 0) f -= w * wt * rockDispC(COLD, o * COL_STRIDE, wx(a), y, wz(b), ampAt(wx(a), wz(b)));
        }
        VAL[k] = f;
      }
    }
  }

  // ---------------------------------------------------------------- 5. surface nets
  const get = (a, j, b) => {
    const s = (b - A0) * span + (a - A0);
    if (j < JLO[s] || j > JHI[s]) { const o = b * nc + a; return (j * c - H[o]) / Math.sqrt(1 + G[o] * G[o]); }
    return VAL[OFF[s] + j - JLO[s]];
  };
  // per cell-column vertex map over the union band
  const cspan = span - 1;
  const CJLO = new Int32Array(cspan * cspan), COFF = new Int32Array(cspan * cspan + 1);
  let ctotal = 0;
  for (let b = 0; b < cspan; b++) for (let a = 0; a < cspan; a++) {
    const s00 = b * span + a, s10 = s00 + 1, s01 = s00 + span, s11 = s01 + 1;
    const lo = Math.min(JLO[s00], JLO[s10], JLO[s01], JLO[s11]) - 1, hi = Math.max(JHI[s00], JHI[s10], JHI[s01], JHI[s11]) + 1;
    const cs = b * cspan + a;
    CJLO[cs] = lo; COFF[cs] = ctotal; ctotal += hi - lo + 1;
  }
  COFF[cspan * cspan] = ctotal;
  const CV = new Int32Array(ctotal).fill(-1);
  const pos = [], nrm = [], ter = [], idx = [];
  const cv = new Float32Array(8);
  const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const ED = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  let vcount = 0, ymin = 1e9, ymax = -1e9;
  const vertexOf = (a, j, b) => {
    const cs = (b - A0) * cspan + (a - A0);
    const slot = COFF[cs] + j - CJLO[cs];
    if (j < CJLO[cs] || slot >= COFF[cs + 1]) return -1;
    let v = CV[slot];
    if (v >= 0) return v;
    for (let q = 0; q < 8; q++) cv[q] = get(a + CO[q][0], j + CO[q][1], b + CO[q][2]);
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (let e = 0; e < 12; e++) {
      const e0 = ED[e][0], e1 = ED[e][1], v0 = cv[e0], v1 = cv[e1];
      if ((v0 < 0) === (v1 < 0)) continue;
      const t = v0 / (v0 - v1);
      sx += CO[e0][0] + (CO[e1][0] - CO[e0][0]) * t;
      sy += CO[e0][1] + (CO[e1][1] - CO[e0][1]) * t;
      sz += CO[e0][2] + (CO[e1][2] - CO[e0][2]) * t;
      cnt++;
    }
    if (!cnt) return -1;
    const u = sx / cnt, vv = sy / cnt, w = sz / cnt;
    // trilinear gradient at (u,vv,w)
    const gx = lerp2(cv[1] - cv[0], cv[3] - cv[2], cv[5] - cv[4], cv[7] - cv[6], vv, w);
    const gy = lerp2(cv[2] - cv[0], cv[3] - cv[1], cv[6] - cv[4], cv[7] - cv[5], u, w);
    const gz = lerp2(cv[4] - cv[0], cv[5] - cv[1], cv[6] - cv[2], cv[7] - cv[3], u, vv);
    const gl = Math.hypot(gx, gy, gz) || 1;
    const X = wx(a) + u * c, Y = (j + vv) * c, Z = wz(b) + w * c;
    pos.push(X, Y, Z);
    nrm.push(gx / gl, gy / gl, gz / gl);
    if (Y < ymin) ymin = Y; if (Y > ymax) ymax = Y;
    // shading attributes: crevice, rockiness, water distance, outcrop
    const o = (b + (w > 0.5 ? 1 : 0)) * nc + a + (u > 0.5 ? 1 : 0);
    let cav = 0;
    if (WD[o] > 0) { rockDisp(X, Y, Z, 1); cav = CAVget() * WD[o]; }
    const rock = Math.max(WOWN[o], OUT ? Math.min(1, OUT[o] / 0.9) : 0);
    const wd = waterSDF(X, Z);
    ter.push(cav, rock, Math.max(-30, Math.min(60, wd)), OUT ? Math.min(1, OUT[o] / 2.4) : 0);
    v = vcount++;
    CV[slot] = v;
    return v;
  };
  const quad = (p0, p1, p2, p3, flip) => {
    if (p0 < 0 || p1 < 0 || p2 < 0 || p3 < 0) return;
    if (flip) idx.push(p0, p2, p1, p0, p3, p2); else idx.push(p0, p1, p2, p0, p2, p3);
  };
  const B0 = M - ext, B1 = M + n + ext; // owned corner box (inclusive)
  for (let b = B0; b <= B1; b++) for (let a = B0; a <= B1; a++) {
    const s = (b - A0) * span + (a - A0);
    // union of this column and its +x / +z neighbours' bands
    const lo = Math.min(JLO[s], a < B1 ? JLO[s + 1] : 1e9, b < B1 ? JLO[s + span] : 1e9);
    const hi = Math.max(JHI[s], a < B1 ? JHI[s + 1] : -1e9, b < B1 ? JHI[s + span] : -1e9);
    for (let j = lo; j <= hi; j++) {
      const v0 = get(a, j, b);
      const solid = v0 < 0;
      // x-edge
      if (a < B1 && (get(a + 1, j, b) < 0) !== solid) {
        quad(vertexOf(a, j - 1, b - 1), vertexOf(a, j, b - 1), vertexOf(a, j, b), vertexOf(a, j - 1, b), !solid);
      }
      // y-edge
      if ((get(a, j + 1, b) < 0) !== solid) {
        quad(vertexOf(a - 1, j, b - 1), vertexOf(a - 1, j, b), vertexOf(a, j, b), vertexOf(a, j, b - 1), !solid);
      }
      // z-edge
      if (b < B1 && (get(a, j, b + 1) < 0) !== solid) {
        quad(vertexOf(a - 1, j - 1, b), vertexOf(a, j - 1, b), vertexOf(a, j, b), vertexOf(a - 1, j, b), !solid);
      }
    }
  }
  // drop small floating fragments (rock bits the displacement detached from the face, closed bubbles):
  // components under 90 triangles that stay clear of the chunk border (border pieces continue next door)
  let index = new Uint32Array(idx);
  if (anySteep && vcount > 0) {
    const P = new Int32Array(vcount);
    for (let i = 0; i < vcount; i++) P[i] = i;
    const find = (q) => { while (P[q] !== q) { P[q] = P[P[q]]; q = P[q]; } return q; };
    for (let t = 0; t < index.length; t += 3) {
      const ra = find(index[t]), rb = find(index[t + 1]), rc = find(index[t + 2]);
      P[rb] = ra; if (find(rc) !== ra) P[find(rc)] = ra;
    }
    const tc = new Map(), edge = new Set();
    const ex0 = x0 + 1.5 * c, ex1 = x0 + n * c - 1.5 * c, ez0 = z0 + 1.5 * c, ez1 = z0 + n * c - 1.5 * c;
    for (let v = 0; v < vcount; v++) {
      const X = pos[v * 3], Z = pos[v * 3 + 2];
      if (X < ex0 || X > ex1 || Z < ez0 || Z > ez1) edge.add(find(v));
    }
    for (let t = 0; t < index.length; t += 3) { const k = find(index[t]); tc.set(k, (tc.get(k) || 0) + 1); }
    let drop = 0;
    for (const [k, n2] of tc) if (n2 < 90 && !edge.has(k)) drop += n2;
    if (drop) {
      const keep = new Uint32Array(index.length - drop * 3);
      let o = 0;
      for (let t = 0; t < index.length; t += 3) {
        const k = find(index[t]);
        if (tc.get(k) < 90 && !edge.has(k)) continue;
        keep[o++] = index[t]; keep[o++] = index[t + 1]; keep[o++] = index[t + 2];
      }
      index = keep;
    }
  }
  return {
    position: new Float32Array(pos), normal: new Float32Array(nrm), ter: new Float32Array(ter),
    index, ymin, ymax,
  };
}

function CAVget() { return CAV; }

function lerp2(a, b, c, d, s, t) { return (a * (1 - s) + b * s) * (1 - t) + (c * (1 - s) + d * s) * t; }

/** displacement amplitude by location: terraced south face gets gentler rock (walls are built there) */
function ampAt(x, z) {
  if (x > -170 && x < 220 && z > 20 && z < 240) return 0.85;
  return 1;
}

function maxFilter(src, dst, n, r, horiz) {
  for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
    let m = -Infinity;
    if (horiz) { const lo = Math.max(0, a - r), hi = Math.min(n - 1, a + r); for (let q = lo; q <= hi; q++) { const v = src[b * n + q]; if (v > m) m = v; } }
    else { const lo = Math.max(0, b - r), hi = Math.min(n - 1, b + r); for (let q = lo; q <= hi; q++) { const v = src[q * n + a]; if (v > m) m = v; } }
    dst[b * n + a] = m;
  }
}
function minFilter(src, dst, n, r, horiz) {
  for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
    let m = Infinity;
    if (horiz) { const lo = Math.max(0, a - r), hi = Math.min(n - 1, a + r); for (let q = lo; q <= hi; q++) { const v = src[b * n + q]; if (v < m) m = v; } }
    else { const lo = Math.max(0, b - r), hi = Math.min(n - 1, b + r); for (let q = lo; q <= hi; q++) { const v = src[q * n + a]; if (v < m) m = v; } }
    dst[b * n + a] = m;
  }
}
