// City walls along the landward edge of the town (an inset iso-line of the town outline field),
// polygonal masonry with a crenellated parapet, square towers every 45–70 m, gate towers where
// streets cross. Built before the lots so houses keep clear of them.
import { heightAt } from '../world/heightfield.js';
import { Frame } from './geobuilder.js';
import { stoneBox, roof, quadFacing } from './house.js';
import { FLAG } from '../materials/plaster.js';
import { openFront } from './port.js';

/** marching squares iso-line extraction on a Grid → list of polylines [[x,z],...] */
export function isoLines(G, level, accept) {
  const segs = [];
  const { nx, nz, res, x0, z0 } = G;
  const P = (ix, iz) => [x0 + ix * res, z0 + iz * res];
  const lerp = (a, b, va, vb) => { const t = (level - va) / (vb - va); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
  for (let iz = 0; iz < nz - 1; iz++) for (let ix = 0; ix < nx - 1; ix++) {
    const v0 = G.get(ix, iz), v1 = G.get(ix + 1, iz), v2 = G.get(ix + 1, iz + 1), v3 = G.get(ix, iz + 1);
    const c = (v0 > level ? 1 : 0) | (v1 > level ? 2 : 0) | (v2 > level ? 4 : 0) | (v3 > level ? 8 : 0);
    if (c === 0 || c === 15) continue;
    const cx = x0 + (ix + 0.5) * res, cz = z0 + (iz + 0.5) * res;
    if (accept && !accept(cx, cz)) continue;
    const p0 = P(ix, iz), p1 = P(ix + 1, iz), p2 = P(ix + 1, iz + 1), p3 = P(ix, iz + 1);
    const e = [lerp(p0, p1, v0, v1), lerp(p1, p2, v1, v2), lerp(p2, p3, v2, v3), lerp(p3, p0, v3, v0)];
    const table = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 2], [0, 1]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[2, 0]], 10: [[2, 1], [0, 3]], 11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]] };
    for (const [a, b] of table[c]) segs.push([e[a], e[b]]);
  }
  // chain segments
  const key = (p) => Math.round(p[0] * 10) + ',' + Math.round(p[1] * 10);
  const byStart = new Map();
  for (const s of segs) { const k = key(s[0]); if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(s); }
  const used = new Set();
  const lines = [];
  for (const s of segs) {
    if (used.has(s)) continue;
    used.add(s);
    const line = [s[0], s[1]];
    for (;;) {
      const nxt = (byStart.get(key(line[line.length - 1])) || []).find((t) => !used.has(t));
      if (!nxt) break;
      used.add(nxt); line.push(nxt[1]);
    }
    if (line.length > 3) lines.push(line);
  }
  return lines;
}

function simplify(pts, step) {
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc >= step || i === pts.length - 1) { out.push(pts[i]); acc = 0; }
  }
  return out;
}

export function buildWalls(plan, occ, getB, engine, rng, crossings) {
  const out = { towers: [], gates: [], length: 0 };
  // no walls around the open lagoon port (the town runs down to the quays there)
  const accept = (x, z) => plan.H.sample(x, z) > 4 && plan.S.sample(x, z) < 0.75 && !openFront(x, z);
  const lines = isoLines(plan.E, -9, accept).map((l) => simplify(l, 6)).filter((l) => l.length > 4);
  const seed = rng.random();
  const T = 2.4;   // wall thickness
  const Hw = 8.5;  // height above ground
  for (const line of lines) {
    let sinceTower = rng.range(10, 30);
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const rot = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      const F = new Frame(mx, 0, mz, rot);
      const ha = heightAt(a[0], a[1]), hb = heightAt(b[0], b[1]), hm = heightAt(mx, mz);
      const g = Math.min(ha, hb, hm);
      const top = (ha + hb + hm) / 3 + Hw;
      // gate gap where a street crosses
      const gate = crossings.some((c) => Math.hypot(c[0] - mx, c[1] - mz) < 4.5) && !out.gates.some((q) => Math.hypot(q[0] - mx, q[1] - mz) < 150 && Math.hypot(q[0] - mx, q[1] - mz) > 8);
      if (gate) {
        if (!out.gates.some((q) => Math.hypot(q[0] - mx, q[1] - mz) < 150)) {
          out.gates.push([mx, mz]);
          for (const side of [-1, 1]) tower(getB(mx, mz), new Frame(...F.p(side * 7.5, 0, 0), rot), g, top + 4, seed, rng, out);
        }
        sinceTower = 0;
        continue;
      }
      const B = getB(mx, mz);
      stoneBox(B, F, 0, 0, len / 2 + 0.6, T / 2, g - 7, top, 2, seed, 15);
      // walkway + crenellations on the outer face (the outside is to the right = local +z? use both: merlons on +z side)
      stoneBox(B, F, 0, 0, len / 2 + 0.6, T / 2, top, top + 0.15, 1, seed, 16);
      const nM = Math.max(1, Math.floor(len / 1.6));
      for (let k = 0; k < nM; k++) {
        const x = -len / 2 + (k + 0.5) * (len / nM);
        stoneBox(B, F, x, T / 2 - 0.3, 0.42, 0.3, top, top + 1.4, 0, seed, 31);
      }
      occ.add(mx, mz, len / 2 + 1, T / 2 + 2, rot, 'wall');
      engine.footprints.addRect(mx, mz, len / 2 + 0.6, T / 2 + 0.5, rot, 'city');
      out.length += len;
      sinceTower += len;
      if (sinceTower > rng.range(45, 70)) {
        tower(B, new Frame(b[0], 0, b[1], rot), Math.min(g, heightAt(b[0], b[1])), top + rng.range(3.5, 6), seed, rng, out);
        sinceTower = 0;
      }
    }
  }
  return out;
}

function tower(B, F, g, top, seed, rng, out) {
  const hw = rng.range(3.6, 4.6);
  stoneBox(B, F, 0, 0, hw, hw, g - 8, top, 0, seed, 31);
  stoneBox(B, F, 0, 0, hw + 0.25, hw + 0.25, top - 0.6, top - 0.3, 3, seed, 63);
  if (rng.chance(0.55)) {
    roof(B, F, { cx: 0, cz: 0, hw: hw + 0.2, hd: hw + 0.2, yT: top, type: 'pyramid', pitch: rng.range(24, 32), over: 0.35, floorY: g, h: top - g, sty: [seed, 4, 0, FLAG.BLANK] }, (seed + out.towers.length * 0.17) % 1);
  } else {
    // crenellated top
    const n = 4;
    for (let k = 0; k < n; k++) {
      const t = -hw + (k + 0.5) * (2 * hw / n);
      stoneBox(B, F, t, hw - 0.3, 0.45, 0.3, top, top + 1.4, 0, seed, 31);
      stoneBox(B, F, t, -hw + 0.3, 0.45, 0.3, top, top + 1.4, 0, seed, 31);
      stoneBox(B, F, hw - 0.3, t, 0.3, 0.45, top, top + 1.4, 0, seed, 31);
      stoneBox(B, F, -hw + 0.3, t, 0.3, 0.45, top, top + 1.4, 0, seed, 31);
    }
    stoneBox(B, F, 0, 0, hw - 0.1, hw - 0.1, top - 0.05, top + 0.1, 1, seed, 16);
  }
  // r5: dark arrow slits / small windows on every face (reads as dark marks from afar)
  for (let lv = 0; lv < 3; lv++) {
    const y = top - 3.2 - lv * 4.2;
    if (y < g + 1.5) break;
    const ww = lv === 0 ? 0.45 : 0.22, hh = lv === 0 ? 1.4 : 1.1;
    for (const [nx, nz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      for (const t of lv === 0 ? [-hw * 0.45, hw * 0.45] : [0]) {
        const cx = nx !== 0 ? nx * (hw + 0.02) : t, cz = nz !== 0 ? nz * (hw + 0.02) : t;
        const ax = nz !== 0 ? ww : 0, az = nx !== 0 ? ww : 0;
        const p = (sx, yy) => F.p(cx + sx * ax, yy, cz + sx * az);
        quadFacing(B.stone, p(-1, y), p(1, y), p(1, y + hh), p(-1, y + hh), F.d(nx, 0, nz), { aSt: [[0, 0, seed, 9], [1, 0, seed, 9], [1, 1, seed, 9], [0, 1, seed, 9]] });
      }
    }
  }
  out.towers.push([F.x, F.z]);
}
