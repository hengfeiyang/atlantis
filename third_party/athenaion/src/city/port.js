// Lagoon port: the harbour quarter on the bench along the WEST shore of the lagoon (x ≈ -170…-300,
// z ≈ 20…175) — quays with moored ships, arcaded warehouses on the quay, houses stepping up the
// bench to the upper town on the plateau, ships at anchor in the west basin and under sail in the
// channel to the sea. In shot 1 this is the "harbour full of ships" of ref 1 (lower left).
import { heightAt, sdPolygon, distPolyline } from '../world/heightfield.js';
import { chaikin, Polyline } from './plan.js';
import { quadFacing } from './house.js';

// district polygon (unioned into the town outline by CityPlan): the bench between the shore and
// the plateau edge, plus the plateau rim above it so the streets connect to the upper town
export const PORT_POLY = [[-178, 6], [-196, 34], [-212, 70], [-226, 104], [-226, 150], [-244, 178], [-262, 196], [-312, 190], [-318, 120], [-312, 40], [-290, 4], [-232, -6]];
// z range of the quay along the shore
const Z0 = 20, Z1 = 232;

let SHORE = null;
/** shoreline (h = 0.4 contour) of the lagoon's west shore, walked SOUTH → NORTH (water on the right-hand side) */
export function portShore() {
  if (SHORE) return SHORE;
  const raw = [];
  for (let z = Z1; z >= Z0; z -= 4) {
    // start inside the water: the lagoon basin, or the channel to the sea further south
    let x = Math.min(-120, -150 - Math.max(0, z - 120) * 80 / 140 + 20);
    while (x > -260 && heightAt(x, z) > 0) x -= 1;     // find the water first (river mouth sand bars)
    while (x > -330 && heightAt(x, z) <= 0.4) x -= 0.5;
    raw.push([x, z]);
  }
  // smooth out the noisy shore so the quay reads as built (long straight-ish runs)
  let pts = raw;
  for (let k = 0; k < 3; k++) pts = pts.map((p, i, a) => i === 0 || i === a.length - 1 ? p : [(a[i - 1][0] + 2 * p[0] + a[i + 1][0]) / 4, p[1]]);
  SHORE = chaikin(chaikin(pts));
  return SHORE;
}

/** signed distance to the port district (negative inside) */
export function portSDF(x, z) { return sdPolygon(x, z, PORT_POLY); }

/** distance (m) from the quay shoreline; used to keep the street lots clear of the quay strip */
export function quayDist(x, z) {
  if (z < Z0 - 30 || z > Z1 + 30 || x > -140 || x < -320) return Infinity;
  return distPolyline(x, z, portShore()).d;
}

/** resample helper (shared with the harbour) */
export function resampleLine(pts, step) {
  const pl = new Polyline(pts);
  const n = Math.max(2, Math.ceil(pl.length / step));
  const out = [];
  for (let i = 0; i <= n; i++) { const p = pl.at((i / n) * pl.length); out.push([p.x, p.z]); }
  return out;
}

// ------------------------------------------------------------------ terraced channel bank
// South of the port the shore turns into the steep west bank of the channel (0 → 40 m in ~40 m).
// The town climbs it Positano-style: stacked retaining walls with paved terraces and row houses
// facing the water (left edge of shot 1).
const BANK = { z0: 168, z1: 246, levels: [8.5, 17.5, 26.5] };
// the cliff between the port bench (y ≈ 15-20) and the plateau of the upper town (y ≈ 40-45)
const RIM = { z0: 0, z1: 192, foot: 17, levels: [21.5, 25.5, 29.5, 33.5, 37.5], minW: 2.6 };
// the city hill (heightfield HILLTOPS[1], top 145): houses climbing its north and south flanks (seen
// obliquely from the panorama, ref 1's hill town); the sheer east face with the waterfall stays bare
const HILL = { c: [-585, 140], foot: 84, levels: [95, 106.5, 118, 129.5] };
const HILL_SECTORS = { hillN: [-8, 52], hillS: [116, 182] };

/** points on the hill where the ground first drops below y walking outward, compass az a1 → a0 (land on the left) */
function scanHill(a0, a1, step, y) {
  const out = [];
  for (let a = a1; a >= a0; a -= step) {
    const r = (a * Math.PI) / 180, dx = Math.sin(r), dz = -Math.cos(r);
    let d = 20;
    while (d < 240 && heightAt(HILL.c[0] + dx * d, HILL.c[1] + dz * d) >= y) d += 1;
    out.push([HILL.c[0] + dx * d, HILL.c[1] + dz * d]);
  }
  return out;
}

function scanShore(z0, z1, step) {
  const out = [];
  for (let z = z1; z >= z0; z -= step) {
    let x = Math.min(-120, -150 - Math.max(0, z - 120) * 80 / 140 + 20);
    while (x > -300 && heightAt(x, z) > 0) x -= 1;
    while (x > -400 && heightAt(x, z) <= 0.4) x -= 0.5;
    out.push([x, z]);
  }
  return out;
}

/**
 * Retaining walls + terraces on the channel bank. Emits masonry into the chunk builders and returns
 * row-house lots ({x, z, rot, w, d, row, seed, floor}) whose ground is the flat terrace (floor).
 */
/** line where the ground first reaches y walking west from the lagoon shore, for z1 → z0 */
function scanContour(z0, z1, step, y) {
  const out = [];
  for (let z = z1; z >= z0; z -= step) {
    let x = -120;
    while (x > -300 && heightAt(x, z) > 0) x -= 1;
    while (x > -420 && heightAt(x, z) < y) x -= 0.5;
    out.push([x, z]);
  }
  return out;
}

export function bankTerraces(getB, engine, rng, which = 'bank') {
  const lots = [];
  const cfg = which === 'rim' ? RIM : HILL_SECTORS[which] ? HILL : BANK;
  let shore = chaikin(which === 'rim' ? scanContour(RIM.z0, RIM.z1, 4, RIM.foot) : HILL_SECTORS[which] ? scanHill(HILL_SECTORS[which][0], HILL_SECTORS[which][1], 2, HILL.foot) : scanShore(BANK.z0, BANK.z1, 4));
  // smooth the contour (it follows every terrain wrinkle)
  for (let k = 0; k < 4; k++) shore = shore.map((p, i, a) => i === 0 || i === a.length - 1 ? p : [(a[i - 1][0] + 2 * p[0] + a[i + 1][0]) / 4, (a[i - 1][1] + 2 * p[1] + a[i + 1][1]) / 4]);
  shore = resampleLine(shore, 3);
  const n = shore.length;
  // inland normal per point (shore is walked south → north, the land is on the left = -x side)
  const nor = shore.map((p, i) => {
    const a = shore[Math.max(0, i - 1)], b = shore[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return [tz, -tx];   // left of the walking direction (north) = west
  });
  const reach = (p, d, y) => { for (let s = 0; s < 90; s += 0.5) if (heightAt(p[0] + d[0] * s, p[1] + d[1] * s) >= y) return s; return null; };
  const seed = rng.random();
  lots.strips = [];
  for (const [k, y] of cfg.levels.entries()) {
    const front = [], back = [], ok = [];
    for (let i = 0; i < n; i++) {
      const sb = reach(shore[i], nor[i], y + 2.0);
      let sf = reach(shore[i], nor[i], y - 5.5);
      if (sf !== null && sb !== null) sf = Math.max(sf, sb - 11);
      const gF = sf !== null ? heightAt(shore[i][0] + nor[i][0] * sf, shore[i][1] + nor[i][1] * sf) : 0;
      const good = sf !== null && sb !== null && sb - sf > (cfg.minW ?? 3.5) && gF < y - 1.5;
      ok.push(good);
      const f = good ? sf - 0.5 : 0, b = good ? Math.max(sb, sf + 6.5) : 0;
      front.push([shore[i][0] + nor[i][0] * f, shore[i][1] + nor[i][1] * f]);
      back.push([shore[i][0] + nor[i][0] * b, shore[i][1] + nor[i][1] * b]);
    }
    const top = y + 0.3;
    // runs of consecutive good samples
    let i = 0;
    while (i < n) {
      if (!ok[i]) { i++; continue; }
      let j = i; while (j + 1 < n && ok[j + 1]) j++;
      if (j - i >= 3) {
        const B = getB(front[i][0], front[i][1]);
        let u = 0;
        for (let q = i; q < j; q++) {
          const a = front[q], b2 = front[q + 1], ba = back[q], bb = back[q + 1];
          const len = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
          const ga = heightAt(a[0], a[1]) - 1.5, gb = heightAt(b2[0], b2[1]) - 1.5;
          const out = [-nor[q][0], 0, -nor[q][1]];
          const st = (uu, vv, kind) => [uu, vv, seed + k * 0.17, kind];
          // battered retaining wall (polygonal masonry) + parapet + coping
          const lean = 0.35;
          quadFacing(B.stone, [a[0] - nor[q][0] * lean, ga, a[1] - nor[q][1] * lean], [b2[0] - nor[q + 1][0] * lean, gb, b2[1] - nor[q + 1][1] * lean], [b2[0], top, b2[1]], [a[0], top, a[1]], out,
            { aSt: [st(u, ga, 2), st(u + len, gb, 2), st(u + len, top, 2), st(u, top, 2)] });
          quadFacing(B.stone, [a[0], top, a[1]], [b2[0], top, b2[1]], [b2[0], top + 0.95, b2[1]], [a[0], top + 0.95, a[1]], out,
            { aSt: [st(u, top, 0), st(u + len, top, 0), st(u + len, top + 0.95, 0), st(u, top + 0.95, 0)] });
          const ia = [a[0] + nor[q][0] * 0.45, a[1] + nor[q][1] * 0.45], ib = [b2[0] + nor[q + 1][0] * 0.45, b2[1] + nor[q + 1][1] * 0.45];
          quadFacing(B.stone, [a[0], top + 0.95, a[1]], [b2[0], top + 0.95, b2[1]], [ib[0], top + 0.95, ib[1]], [ia[0], top + 0.95, ia[1]], [0, 1, 0],
            { aSt: [st(u, 0, 3), st(u + len, 0, 3), st(u + len, 0.45, 3), st(u, 0.45, 3)] });
          quadFacing(B.stone, [ia[0], top, ia[1]], [ib[0], top, ib[1]], [ib[0], top + 0.95, ib[1]], [ia[0], top + 0.95, ia[1]], [nor[q][0], 0, nor[q][1]],
            { aSt: [st(u, top, 0), st(u + len, top, 0), st(u + len, top + 0.95, 0), st(u, top + 0.95, 0)] });
          // terrace paving
          quadFacing(B.stone, [ia[0], top, ia[1]], [ib[0], top, ib[1]], [bb[0], top, bb[1]], [ba[0], top, ba[1]], [0, 1, 0],
            { aSt: [st(a[0], a[1], 8), st(b2[0], b2[1], 8), st(bb[0], bb[1], 8), st(ba[0], ba[1], 8)] });   // r5: garden soil / dry grass, not paving
          // ivy / caper curtains hanging over the parapet (flora grows engine.slots.ivy)
          if (engine.slots?.ivy && rng.chance(0.3)) {
            const hgt = top + 0.95 - Math.min(ga, gb);
            engine.slots.ivy.push({ pos: [(a[0] + b2[0]) / 2, top + 0.85, (a[1] + b2[1]) / 2], facing: ((Math.atan2(out[0], -out[2]) * 180) / Math.PI + 360) % 360, size: Math.min(hgt * 0.8, rng.range(2, 6)), width: rng.range(1.2, 3), tag: 'city-terrace' });
          }
          u += len;
        }
        // the terrace strip (front line, back line, paving height): planted later where no house stands
        lots.strips.push({ front: front.slice(i, j + 1), back: back.slice(i, j + 1), top });
        // row houses along the terrace (fronts toward the water)
        const pl = new Polyline(front.slice(i, j + 1));
        let s = rng.range(0, 3);
        while (s < pl.length - 4) {
          const w = rng.range(6, 10.5);
          if (s + w > pl.length - 1) break;
          const P = pl.at(s + w / 2);
          // inland normal of the front line (left of walking direction)
          const nx = P.tz, nz = -P.tx;
          const qi = Math.min(j, i + Math.round((s + w / 2) / 3));
          const depth = Math.max(5.5, Math.min(12, Math.hypot(back[qi][0] - front[qi][0], back[qi][1] - front[qi][1]) - 1.2));
          const cx = P.x + nx * (1.2 + depth / 2), cz = P.z + nz * (1.2 + depth / 2);
          const rot = Math.atan2(-nx, -nz);
          if (rng.chance(0.9) && engine.footprints.isFree(cx, cz, Math.min(w, depth) * 0.3)) lots.push({ x: cx, z: cz, rot, w, d: depth, street: null, side: 0, seed: rng.random(), row: true, floor: top, bank: k, which });
          s += w + (rng.chance(0.2) ? rng.range(1.5, 4) : 0.02);
        }
      }
      i = j + 1;
    }
  }
  return lots;
}

/** the open lagoon front of the town (no city walls): the port district and the rim sanctuary north of it */
export function openFront(x, z) {
  return portSDF(x, z) < 14 || (x > -350 && x < -225 && z > -175 && z < -10);
}
