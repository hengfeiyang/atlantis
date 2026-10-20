// Site analysis: reads the real terrain (heightAt) and extracts the terrace edges of the acropolis
// as polylines (marching squares on a height grid), so walls, stairs and plazas always sit on the
// actual ground even if the terrain generator changes.
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { simplify } from './geo.js';

export class HeightGrid {
  constructor(x0, z0, x1, z1, step) {
    this.x0 = x0; this.z0 = z0; this.step = step;
    this.nx = Math.ceil((x1 - x0) / step) + 1; this.nz = Math.ceil((z1 - z0) / step) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) this.h[j * this.nx + i] = heightAt(x0 + i * step, z0 + j * step);
  }
  at(i, j) { return this.h[j * this.nx + i]; }
  /** bilinear sample (falls back to heightAt outside) */
  sample(x, z) {
    const fx = (x - this.x0) / this.step, fz = (z - this.z0) / this.step;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.nz - 1) return heightAt(x, z);
    const tx = fx - i, tz = fz - j;
    const a = this.at(i, j), b = this.at(i + 1, j), c = this.at(i, j + 1), d = this.at(i + 1, j + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
}

/** marching squares → polylines [[x,z],...] oriented so that HIGH ground is on the LEFT */
export function contours(G, iso) {
  const { nx, nz, step, x0, z0 } = G;
  const segs = new Map(); // edgeKey → list of [otherKey]
  const pts = new Map();  // edgeKey → [x,z]
  const ekey = (i, j, dir) => (dir ? 'v' : 'h') + i + ',' + j; // h: (i,j)-(i+1,j) ; v: (i,j)-(i,j+1)
  const edgePoint = (i, j, dir) => {
    const k = ekey(i, j, dir);
    if (!pts.has(k)) {
      const a = G.at(i, j), b = dir ? G.at(i, j + 1) : G.at(i + 1, j);
      const t = Math.min(1, Math.max(0, (iso - a) / (b - a)));
      pts.set(k, dir ? [x0 + i * step, z0 + (j + t) * step] : [x0 + (i + t) * step, z0 + j * step]);
    }
    return k;
  };
  const link = (a, b) => {
    if (!segs.has(a)) segs.set(a, []); if (!segs.has(b)) segs.set(b, []);
    segs.get(a).push(b); segs.get(b).push(a);
  };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v0 = G.at(i, j), v1 = G.at(i + 1, j), v2 = G.at(i + 1, j + 1), v3 = G.at(i, j + 1);
    const c = (v0 > iso ? 1 : 0) | (v1 > iso ? 2 : 0) | (v2 > iso ? 4 : 0) | (v3 > iso ? 8 : 0);
    if (c === 0 || c === 15) continue;
    const B = () => edgePoint(i, j, 0), R = () => edgePoint(i + 1, j, 1), T = () => edgePoint(i, j + 1, 0), Lf = () => edgePoint(i, j, 1);
    switch (c) {
      case 1: case 14: link(Lf(), B()); break;
      case 2: case 13: link(B(), R()); break;
      case 3: case 12: link(Lf(), R()); break;
      case 4: case 11: link(R(), T()); break;
      case 6: case 9: link(B(), T()); break;
      case 7: case 8: link(Lf(), T()); break;
      case 5: case 10: {
        const ctr = (v0 + v1 + v2 + v3) / 4 > iso;
        if ((c === 5) === ctr) { link(Lf(), T()); link(B(), R()); } else { link(Lf(), B()); link(R(), T()); }
        break;
      }
    }
  }
  // chain
  const used = new Set();
  const lines = [];
  const walk = (start) => {
    const line = [start]; used.add(start);
    let cur = start;
    for (;;) {
      const nb = (segs.get(cur) || []).find((k) => !used.has(k));
      if (!nb) break;
      used.add(nb); line.push(nb); cur = nb;
    }
    return line;
  };
  // start from endpoints (degree 1) first, then loops
  for (const [k, nbs] of segs) if (nbs.length === 1 && !used.has(k)) lines.push(walk(k));
  for (const k of segs.keys()) if (!used.has(k)) { const l = walk(k); l.push(l[0]); lines.push(l); }
  return lines.map((l) => orientHighLeft(G, l.map((k) => pts.get(k)))).filter((l) => l.length > 2);
}

function orientHighLeft(G, line) {
  // sum over a few samples: height on the left minus right
  let s = 0;
  const n = line.length;
  for (let t = 1; t < 6; t++) {
    const i = Math.min(n - 2, Math.floor((n - 1) * t / 6));
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    // left of travel direction in x/z with y up and -z north: left = (dz, -dx) when looking down? use (−dz, dx)·
    const lx = dz / l, lz = -dx / l;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    s += G.sample(mx + lx * 2, mz + lz * 2) - G.sample(mx - lx * 2, mz - lz * 2);
  }
  return s >= 0 ? line : line.reverse();
}
/** left normal (toward high ground) of a direction */
export const leftOf = (dx, dz) => [dz, -dx];

/** terrace levels from the layout: [plateau, ledge1, ledge2, ...] */
export function terraceLevels() {
  const A = L.ACROPOLIS; const lv = [A.top]; let h = A.top;
  for (const t of A.terraces) { h -= t.drop; lv.push(h); }
  return lv;
}

/**
 * Analyse the acropolis: returns { grid, levels, rim: polylines, edges: [{k, top: polylines, foot: polylines}] }
 */
export function analyseSite() {
  const t0 = performance.now();
  const G = new HeightGrid(-190, -240, 250, 250, 1.5);
  const levels = terraceLevels();
  const rim = contours(G, levels[0] - 2.5).filter((l) => l.length > 20);
  const edges = [];
  for (let k = 1; k < levels.length - 1; k++) {
    edges.push({
      k,
      top: contours(G, levels[k] - 2.6).filter((l) => l.length > 10),
      foot: contours(G, levels[k + 1] + 1.6).filter((l) => l.length > 10),
    });
  }
  console.log(`[acropolis] site analysis ${Math.round(performance.now() - t0)} ms`);
  return { grid: G, levels, rim, edges };
}

export { simplify };
