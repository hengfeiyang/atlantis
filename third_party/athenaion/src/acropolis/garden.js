// (r4) East garden terraces: the wide first ledge right of the grand stair (x ≈ 38..58, y ≈ 42, under
// colossus A; refs 6, 1, 3, 4: stepped garden terraces with balustrades, statues, fountains and falls
// right of the stair). Paved walks, raised planter beds with cypresses / olives / shrubs, a fountain,
// an exedra, gold-topped lamp posts, a front retaining wall with balustrade, statues and lion-mask
// spouts whose jets pour down to the next ledge (spills for the waterfalls module), and a short flight
// of steps down to the stair bastion below.
import { heightAt } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { chamferBox, frameXZ, frameFacing } from './geo.js';
import { wallRun, moulding, PROFILES, blockColor, STONE_COL } from './masonry.js';
import { pedestal, lampPost, planter, wreath, panelFrame } from './ornament.js';
import { pavePrecinct } from './podium.js';
import { fountain, exedra } from './props.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** distance from (x,z) to a layout fall's first `len` m (lip → downstream), minus its half width */
function fallDist(x, z, len = 14, only = null) {
  let best = Infinity;
  for (const w of L.WATERFALLS) {
    if (only && !only(w)) continue;
    const a = (w.dir * Math.PI) / 180, dx = Math.sin(a), dz = -Math.cos(a);
    const t = Math.max(-3, Math.min(len, (x - w.from[0]) * dx + (z - w.from[2]) * dz));
    best = Math.min(best, Math.hypot(x - w.from[0] - dx * t, z - w.from[2] - dz * t) - w.width * 0.5);
  }
  return best;
}

/**
 * Build the garden on the ledge spanning x0..x1 (back of the ledge at zBack). Returns
 * { y, spills, beds, lamps, statues } or null when the ledge is not there.
 */
export function buildEastGarden(ctx, engine, rng, opts = {}) {
  const x0 = opts.x0 ?? 38.5, x1 = opts.x1 ?? 57.5, zBack = opts.zBack ?? -23;
  const yRef = opts.level ?? 41.8;
  // ---- ledge level: just above nearly all of the rock on the ledge
  const hs = [];
  for (let x = x0; x <= x1; x += 1) for (let z = zBack; z <= 9; z += 1) { const h = heightAt(x, z); if (Math.abs(h - yRef) < 1.0) hs.push(h); }
  if (hs.length < 60) return null;
  hs.sort((a, b) => a - b);
  const y = hs[Math.floor(hs.length * 0.97)] + 0.07;
  const onLedge = (x, z) => { const h = heightAt(x, z); return h > y - 1.15 && h < y + 0.4; };
  // ---- front edge (south) per x
  const edgeAt = (x) => { for (let z = -6; z <= 16; z += 0.25) if (heightAt(x, z) < y - 1.6) return z - 0.25; return null; };
  // falls from above (fore-e) land on the ledge and run across it: keep their corridor free of objects;
  // falls whose lip is on the ledge (terr-5) only need their lip clear; lower falls do not matter
  const corridor = (x, z, r = 0) => fallDist(x, z, 24, (w) => w.from[1] > y + 2) < 2.2 + r || fallDist(x, z, 3, (w) => Math.abs(w.from[1] - y) < 2) < 1.5 + r;
  // ---- paving
  const pv = pavePrecinct(ctx, { x0: x0 - 1.5, x1: x1 + 1.5, z0: zBack - 0.5, z1: 12 }, y, [], rng, {
    cell: 1.5, minH: y - 1.0, footprintTag: 'acro-plaza',
    keep: (x, z) => onLedge(x, z) && heightAt(x, z) < y + 0.35 && fallDist(x, z, 3, (w) => w.from[1] > y - 3) > 1.0 && ctx.footprints.isFree(x, z, 0.2, ['acro-plaza', 'acro-pedestal', 'waterfall']),
  });
  const isP = pv.isPaved;
  const free = (x, z, r) => isP(x, z) && !corridor(x, z, r) && ctx.footprints.isFree(x, z, r, ['acro-plaza', 'waterfall']);
  const res = { y, spills: [], beds: 0, lamps: 0, statues: 0, area: Math.round(pv.area) };

  // ---- front retaining wall + balustrade along the ledge edge (x where the edge is found)
  const segs = [];
  let cur = null;
  for (let x = x0 + 1; x <= x1 - 1; x += 0.5) {
    const zE = edgeAt(x);
    const ok = zE !== null && zE > 4 && !corridor(x, zE - 1, 0.5) && isP(x, zE - 0.8);
    if (ok && cur && Math.abs(zE - cur.zSum / cur.n) < 1.6) { cur.xb = x; cur.zSum += zE; cur.n++; cur.zMin = Math.min(cur.zMin, zE); }
    else { if (cur) segs.push(cur); cur = ok ? { xa: x, xb: x, zSum: zE, n: 1, zMin: zE } : null; }
  }
  if (cur) segs.push(cur);
  const front = [];
  for (const sg of segs) {
    const len = sg.xb - sg.xa;
    if (len < 3) continue;
    const zE = sg.zMin + 0.35;
    const F = frameXZ(sg.xa, 0, zE, 1, 0, 0, 1);
    const groundAt = (s) => heightAt(sg.xa + s, zE + 0.8);
    let gmin = Infinity; for (let s = 0; s <= len; s += 0.5) gmin = Math.min(gmin, groundAt(s));
    const yBot = Math.max(gmin - 0.8, y - 14);
    wallRun(ctx.S, 'ashlar', F, len, yBot, y - 0.32, { rng, courses: 'pseudo', batter: 0.015, groundAt, lite: true, damp: 0.7, rustic: true, rusticH: 2 });
    moulding(ctx.S, 'ashlar', F, -0.05, len + 0.05, y - 0.32, PROFILES.coping(1.25), blockColor(rng, STONE_COL), 0);
    front.push({ xa: sg.xa, xb: sg.xb, zE, yBot, F, len });
    // paving fill between the last paved row and the wall
    const Bp = ctx.S.get('paving', sg.xa + len / 2, zE);
    Bp.quadOut([sg.xa, y, zE - 1.6], [sg.xb, y, zE - 1.6], [sg.xb, y, zE], [sg.xa, y, zE], [1, 1, 1], [sg.xa + len / 2, y - 3, zE - 0.8]);
    ctx.footprints.addRect(sg.xa + len / 2, zE - 0.3, len / 2, 0.8, 0, 'acro-wall');
  }

  // ---- stair down to the bastion landing in front (if one is there), else nothing
  let stairX = null;
  for (const f of front) {
    for (let x = f.xa + 2.2; x <= f.xb - 2.2; x += 0.5) {
      if (ctx.zones.hit && ctx.zones.hit(x, f.zE + 4.5, 1.2, 'bastion')) { stairX = x; break; }
    }
    if (stairX === null) continue;
    // landing level below: sample the stair registry bastions
    const below = (opts.bastions || []).find((b) => stairX > 24 - b.halfW && stairX < 24 + b.halfW && f.zE > b.zBack - 6 && f.zE < b.sg.z1 + 2);
    if (!below) { stairX = null; continue; }
    const yLow = below.sg.y0, drop = y - yLow;
    if (drop < 1 || drop > 6) { stairX = null; continue; }
    const n = Math.round(drop / 0.21), rr = drop / n, tr = 0.36, w = 2.6;
    const B = ctx.S.get('tread', stairX, f.zE + 2);
    for (let i = 0; i < n; i++) {
      const yt = y - (i + 1) * rr, za = f.zE - 0.3 + i * tr, zb = za + tr + 0.03;
      const c = blockColor(rng, STONE_COL);
      B.aux = [0.15, 0.6, 0, 0];
      chamferBox(B, frameXZ(stairX, 0, 0, 1, 0, 0, 1), -w / 2, w / 2, yt - rr - 0.1, yt, za, zb, 0.02, c, 63 - 8, darker(c, 0.85));
      B.aux = [0, 0, 0, 0];
    }
    // cheek walls with sloped copings
    const zEnd = f.zE - 0.3 + n * tr;
    for (const sx of [-1, 1]) {
      const xs = stairX + sx * (w / 2 + 0.25);
      const Bw = ctx.S.get('ashlar', xs, f.zE + 2);
      const c = blockColor(rng, STONE_COL);
      for (let i = 0; i < n; i += 2) {
        const za = f.zE - 0.3 + i * tr, zb = Math.min(zEnd, za + 2 * tr), yt = y - i * rr + 0.55;
        chamferBox(Bw, frameXZ(xs, 0, 0, 1, 0, 0, 1), -0.25, 0.25, yLow - 0.2, yt, za, zb, 0.03, darker(c, 0.97), 63 - 8);
      }
    }
    ctx.footprints.addRect(stairX, (f.zE + zEnd) / 2, w / 2 + 0.6, (zEnd - f.zE) / 2 + 0.6, 0, 'acro-stair');
    f.gap = [stairX - w / 2 - 0.5, stairX + w / 2 + 0.5];
    break;
  }

  // ---- balustrades on the front walls (gap at the stair), pedestals with statues / urns / lamps
  for (const f of front) {
    const runs = f.gap ? [[0, f.gap[0] - f.xa], [f.gap[1] - f.xa, f.len]] : [[0, f.len]];
    for (const [s0, s1] of runs) if (s1 - s0 > 1.2) ctx.balus.addRun(ctx.S, 'marble', f.F.at(0, 0, -0.3), s0 + 0.3, s1 - 0.3, y, { postEvery: 2.8, broken: 0.015 });
    // pedestals at the run ends + every ~6 m
    const n = Math.max(1, Math.round(f.len / 6));
    for (let k = 0; k <= n; k++) {
      const s = 0.6 + ((f.len - 1.2) * k) / n;
      const x = f.xa + s, z = f.zE - 0.3;
      if (f.gap && x > f.gap[0] - 0.8 && x < f.gap[1] + 0.8) continue;
      const Fp = frameFacing(x, 0, z, 180);
      const yT = pedestal(ctx.S, 'marble', Fp, y, 0.95, 1.55, rng, { faces: ['front'] });
      if (k % 2 === 0) { ctx.slots.statue.push({ pos: [x, yT, z], facing: 180 + rng.range(-20, 20), size: 2.1 + rng.range(-0.1, 0.3), tag: 'acro-garden' }); res.statues++; }
      else ctx.slots.urn.push({ pos: [x, yT, z], facing: 180, size: 0.85, tag: 'acro-garden' });
      ctx.footprints.addCircle(x, z, 0.9, 'acro-pedestal');
    }
    // ivy curtains over the wall face
    for (let s = 1; s < f.len - 1; s += 2.6) if (rng.random() < 0.6) ctx.slots.ivy.push({ pos: f.F.p(s + rng.range(-0.6, 0.6), y - 0.3, 0.2), facing: 180, size: rng.range(1.6, Math.min(6, y - f.yBot)), width: rng.range(1, 2.4), tag: 'acro-garden-wall' });
    // lion-mask spouts on the wall face (fountain overflow) → jets for the waterfalls module
    const spoutXs = [];
    for (let s = 2.5; s < f.len - 2.5; s += 5.5) {
      const x = f.xa + s;
      if (f.gap && x > f.gap[0] - 1.2 && x < f.gap[1] + 1.2) continue;
      if (corridor(x, f.zE + 1, 1.5)) continue;
      if (y - heightAt(x, f.zE + 2.5) < 3.5) continue;   // needs a real drop below
      spoutXs.push(x);
    }
    for (const x of spoutXs.slice(0, 3)) {
      const ys = y - 1.25;
      const Fs = frameFacing(x, 0, f.zE + 0.02, 180);
      const B = ctx.S.get('marble', x, f.zE);
      const c = blockColor(rng, STONE_COL);
      chamferBox(B, Fs, -0.42, 0.42, ys - 0.4, ys + 0.45, -0.05, 0.12, 0.03, c, 63 - 4);           // mask plaque
      chamferBox(B, Fs, -0.22, 0.22, ys - 0.12, ys + 0.3, 0.12, 0.3, 0.06, darker(c, 0.95), 63 - 4); // muzzle
      const G = ctx.S.get('bronze', x, f.zE);
      chamferBox(G, Fs, -0.07, 0.07, ys - 0.1, ys + 0.0, 0.25, 0.62, 0.02, [1, 1, 1], 63 - 4);      // spout pipe
      // basin lip below each spout catches the jet before it spills down the cliff (no mid-air start)
      res.spills.push({ id: `garden-spout-${res.spills.length}`, pos: [x, ys - 0.05, f.zE + 0.66], dir: 180, width: 0.9, flow: 0.4, kind: 'spout', drop: ys - heightAt(x, f.zE + 3), structure: 'acro-garden' });
    }
  }

  // ---- planter beds: two long beds flanking a central walk, cypresses down their middles,
  //      shrubs / an olive at the ends; low stone kerbs with soil
  let xa = Infinity, xb = -Infinity;
  for (let x = x0; x <= x1; x += 0.5) {
    let ok = true;
    for (let z = -7; z <= 4; z += 1) if (!free(x, z, 0.3)) { ok = false; break; }
    if (ok) { xa = Math.min(xa, x); xb = Math.max(xb, x); }
  }
  if (!(xb - xa > 6)) return res;
  const xc = (xa + xb) / 2, half = (xb - xa) / 2;
  res.span = [xa, xb];
  // fountain first (centre of the walk), then side beds north of it, exedra at the back
  const wm = opts.waterMat;
  const fR = Math.min(2.4, half - 1.6);
  if (fR > 1.5 && free(xc, 0, fR + 0.9)) { fountain(ctx, xc, 0, fR, rng, wm); res.fountain = true; }
  const beds = [];
  const bw = Math.min(2.4, Math.max(1.6, half - 2.6));
  for (const [bx, bz, bwi, bd] of [[xa + bw / 2 + 0.3, -9.5, bw, 8.5], [xb - bw / 2 - 0.3, -9.5, bw, 8.5], [xa + bw / 2 + 0.3, 5.6, bw, 3.2], [xb - bw / 2 - 0.3, 5.6, bw, 3.2]]) {
    let ok = true;
    for (let dx = -bwi / 2; dx <= bwi / 2 + 1e-6; dx += bwi / 2) for (let dz = -bd / 2; dz <= bd / 2 + 1e-6; dz += bd / 4) if (!free(bx + dx, bz + dz, 0.3)) ok = false;
    if (!ok) continue;
    const F = frameFacing(bx, 0, bz, 180);
    const soil = planter(ctx.S, F, y, bwi, bd, 0.55, rng);
    ctx.slots.planter.push({ pos: soil, facing: 90, size: [bd - 0.4, bwi - 0.35], tag: 'acro-garden-bed' });
    beds.push([bx, bz, bwi, bd]);
    ctx.footprints.addRect(bx, bz, bwi / 2 + 0.2, bd / 2 + 0.2, 0, 'acro-plaza');
    res.beds++;
    if (bd > 6) {
      // cypresses down the bed, an olive at the north end, shrubs between
      engine.registry.cypressRows.push({ points: [[bx, bz - bd / 2 + 3.4], [bx, bz + bd / 2 - 1.2]], spacing: 3.3, tag: 'acro-garden' });
      (engine.slots.tree ||= []).push({ pos: [bx, y + 0.5, bz - bd / 2 + 1.2], tag: 'olive', size: rng.range(4.5, 6) });
      for (let z = bz - bd / 2 + 2.6; z < bz + bd / 2 - 1; z += 3.3) (engine.slots.tree ||= []).push({ pos: [bx + rng.range(-0.3, 0.3), y + 0.5, z + 1.6], tag: 'shrub', size: rng.range(1.0, 1.6) });
    } else {
      (engine.slots.tree ||= []).push({ pos: [bx, y + 0.5, bz], tag: 'shrub', size: rng.range(1.2, 1.8) });
      ctx.slots.ivy.push({ pos: [bx, y + 0.5, bz + bd / 2], facing: 180, size: 0.8, width: bwi * 0.8, tag: 'acro-garden-bed' });
    }
  }
  const eR = Math.min(3.2, half - 1.4);
  if (eR > 2 && free(xc, -17.8, 1.2) && free(xc - eR, -17.8, 1) && free(xc + eR, -17.8, 1) && free(xc, -17.8 - eR - 1.2, 0.6)) { exedra(ctx, xc, -17.8, 180, eR, rng); res.exedra = true; }
  // ---- gold-topped lamp posts at the walk corners
  for (const [lx, lz] of [[xc - 2.6, 5.4], [xc + 2.6, 5.4], [xc - 2.6, -8.0], [xc + 2.6, -8.0], [xa + 0.6, 2.4], [xb - 0.6, 2.4]]) {
    if (!free(lx, lz, 0.5)) continue;
    const flame = lampPost(ctx.S, frameFacing(lx, 0, lz, 0), y, rng, 3.6);
    ctx.slots.lamp.push({ pos: flame, facing: 0, size: 0.35, tag: 'acro-garden' });
    ctx.footprints.addCircle(lx, lz, 0.5, 'acro-pedestal');
    res.lamps++;
  }
  // ---- urns / planters along the back of the walk
  for (let i = 0; i < 10; i++) {
    const x = rng.range(x0 + 1, x1 - 1), z = rng.range(zBack + 2, 7);
    if (!free(x, z, 1.0) || !isP(x + 1.5, z) || !isP(x - 1.5, z)) continue;
    ctx.slots.urn.push({ pos: [x, y, z], facing: 180, size: rng.range(0.9, 1.25), tag: 'acro-garden' });
    ctx.footprints.addCircle(x, z, 0.7, 'acro-pedestal');
  }
  return res;
}
