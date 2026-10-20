// Tower bastion for a colossus standing above the ground (ref 4: the foreground colossus on a cliff wall
// with a banner). Opt-in per colossus: layout COLOSSI entry with `bastion: true` (or { w, banners }).
// (r4) The lower part is a natural limestone crag (stacked procedural rock masses, shared stone family:
// src/materials/stone.js) with shrubs on its ledges; only the top ~11 m is masonry: a stepped crown of
// big rustic ashlar (wide lower tier with a coping, narrower upper tier with a cornice, banners, ivy,
// balustrade). Built into its own group: it does not cast shadows (its 70 m shadow fell across the
// shot-1 foreground; the tower only appears in shot 4).
// Published: engine.registry.acropolis.colossusBases[id] = top y.
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { frameXZ, chamferBox, ChunkedBuilders } from './geo.js';
import { wallRun, moulding, PROFILES, blockColor, STONE_COL, buttress } from './masonry.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function crownTier(ctx, S, x, z, hx, hz, yBot, yTop, rng, o) {
  // (r6) rectangular tiers: the colossus pedestal (statues module) is wider than deep
  const x0 = x - hx, x1 = x + hx, z0 = z - hz, z1 = z + hz;
  const faces = [
    { F: frameXZ(x0, 0, z1, 1, 0, 0, 1), heading: 180, len: 2 * hx, half: hx },
    { F: frameXZ(x1, 0, z1, 0, -1, 1, 0), heading: 90, len: 2 * hz, half: hz },
    { F: frameXZ(x1, 0, z0, -1, 0, 0, -1), heading: 0, len: 2 * hx, half: hx },
    { F: frameXZ(x0, 0, z0, 0, 1, -1, 0), heading: 270, len: 2 * hz, half: hz },
  ];
  for (const fc of faces) {
    const { F, len } = fc;
    // (r5) big rustic blocks (ref 4: ~1 m courses of 2 m blocks, deeply jointed)
    // (r6) full rock-faced blocks (no 'lite' mortar strip: it read as dark brick from 70 m), irregular
    // course heights, a slight batter so every course catches the light (ref 4: pale rustic limestone)
    wallRun(S, 'ashlar', F, len, yBot, yTop, { rng, courses: 'iso', courseH: o.courseH ?? 1.2, chamfer: 0.032, batter: o.batter ?? 0.0, rustic: true, rusticH: 99, lite: false, damp: 0.3, depth: 0.9, color: [1.08, 1.065, 1.04] });
    if (o.quoins) for (const s of [0.9, len - 0.9]) buttress(S, 'ashlar', F, s, 1.6, 0.35, yBot, yTop - 0.1, rng, { setoffs: 0 });
    o.face && o.face(fc, F, len);
  }
  return faces;
}

export function buildColossusBastion(ctx, c, rng, engine = ctx.engine) {
  const { slots } = ctx;
  const S = new ChunkedBuilders(48);
  const o = typeof c.bastion === 'object' ? c.bastion : {};
  const hw = (o.w ?? 13) / 2, top = c.pos[1];
  const [x, , z] = c.pos;
  let gmin = Infinity;
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) gmin = Math.min(gmin, heightAt(x + (hw * 1.6 * i) / 4, z + (hw * 1.6 * j) / 4));
  const yG = Math.max(gmin, -6) - 1.5;
  const crownH = Math.min(o.crownH ?? 32, (top - yG) * 0.45); // (r6) 21 → 32 m: the r5 shot-4 sea-stack view shows ≈ 45 m of the tower // (r5) taller masonry crown: ref 4 shows ashlar all the way down the frame
  const yC = top - crownH;              // top of the rock crag = foot of the masonry crown
  const group = new THREE.Group(); group.name = 'acro-colossus-bastion-' + c.id;
  // ---- natural crag: stacked rock masses tapering upward, jittered and yawed
  const rocks = [];
  try {
    const stone = ctx.stoneLib;
    if (!stone) throw new Error('stone family not loaded');
    const mat = stone.rockMaterial({ moss: 0.45, lichen: 0.6, streaks: 0.7, strata: 0.6, ochre: 0.25, bump: 1.0, tint: new THREE.Color(1.22, 1.18, 1.1) });
    const H = yC - yG + 3;
    const nL = Math.max(3, Math.round(H / 12));
    const lh = H / nL;
    for (let k = 0; k < nL; k++) {
      const t = k / Math.max(1, nL - 1);
      const w = (hw * 2 + 7.5) * (1.25 - 0.35 * t);
      const parts = k === nL - 1 ? 1 : 2;
      for (let p = 0; p < parts; p++) {
        const sz = p === 0 ? [w * rng.range(0.92, 1.08), lh * 1.55, w * rng.range(0.85, 1.0)] : [w * 0.62, lh * 1.25, w * 0.58];
        const geo = stone.createRock(rng, { shape: k === nL - 1 ? 'block' : 'mass', size: sz, detail: engine.quality.detail >= 1 ? 5 : 4, cracks: 0.7, strata: 0.75, flatBottom: 0.1 });
        const m = new THREE.Mesh(geo, mat);
        const a = rng.range(0, Math.PI * 2);
        const off = p === 0 ? rng.range(0.6, 1.8) : w * 0.38;
        // the top mass sits centred under the crown; lower ones wander a little (a ragged spire)
        const ox = k === nL - 1 ? 0 : Math.cos(a) * off, oz = k === nL - 1 ? 0 : Math.sin(a) * off;
        m.position.set(x + ox, yG + k * lh + lh * 0.5 + (p ? -lh * 0.2 : 0), z + oz);
        m.rotation.y = rng.range(0, Math.PI * 2);
        m.name = `acro:crag-${c.id}-${k}-${p}`;
        m.userData.castShadow = false; m.castShadow = false;
        group.add(m);
        rocks.push({ x: x + ox, z: z + oz, y: yG + k * lh + lh * 1.2, r: Math.min(sz[0], sz[2]) * 0.45 });
      }
    }
    // ivy / creepers hanging from the crag ledges (flora); slots.tree would plant at the terrain foot
    for (const r of rocks) for (let i = 0; i < 3; i++) {
      const a = rng.range(0, Math.PI * 2);
      const hd = ((Math.atan2(Math.cos(a), -Math.sin(a)) * 180) / Math.PI + 360) % 360;
      slots.ivy.push({ pos: [r.x + Math.cos(a) * r.r, r.y, r.z + Math.sin(a) * r.r], facing: hd, size: rng.range(3, 8), width: rng.range(2, 4), tag: 'acro-crag' });
    }
  } catch (e) {
    console.warn('[acropolis] crag rocks unavailable, masonry to the ground:', e.message);
  }
  const yBase = rocks.length ? yC - 3.0 : yG;
  // ---- stepped crown: wide rustic lower tier + coping, narrower upper tier + cornice
  const yStep = yC + crownH * 0.5;
  // (r6) the top fits the colossus pedestal (statues module: ≈ 0.665·h wide × 0.43·h deep, squared with the
  // bastion axes); it overhung the 10 m top by 0.65 m and the east/west balustrades ran through it
  const q4 = Math.round(L.headingToRotY(c.facing) / (Math.PI / 2));
  const pedX = (Math.abs(q4) % 2 ? 0.43 : 0.665) * c.height / 2, pedZ = (Math.abs(q4) % 2 ? 0.665 : 0.43) * c.height / 2;
  const hx = Math.max(hw, pedX + 0.6), hz = Math.max(hw, pedZ + 0.6);
  const hxL = Math.max(hw + 1.3, hx + 0.9), hzL = Math.max(hw + 1.3, hz + 0.9);
  const ctxS = { ...ctx, S };
  crownTier(ctxS, S, x, z, hxL, hzL, yBase, yStep - 0.3, rng, {
    quoins: true, batter: 0.012, courseH: 1.35,
    face: (fc, F, len) => {
      moulding(S, 'ashlar', F, -0.1, len + 0.1, yStep - 0.3, PROFILES.coping(1.6), blockColor(rng, STONE_COL), 0);
      for (let k = 0; k < 7; k++) slots.ivy.push({ pos: F.p(rng.range(1, len - 1), yStep - 0.4, 0.45), facing: fc.heading, size: rng.range(4, 12), width: rng.range(1.5, 3.8), tag: 'acro-colossus-bastion' });
      // string course + a ledge with shrubs half-way down the lower tier
      const yMid = (yBase + yStep) / 2;
      moulding(S, 'ashlar', F, -0.1, len + 0.1, yMid, PROFILES.string(1.3), blockColor(rng, STONE_COL), 0);
      for (let k = 0; k < 3; k++) slots.ivy.push({ pos: F.p(rng.range(1, len - 1), yMid, 0.5), facing: fc.heading, size: rng.range(3, 9), width: rng.range(1.5, 3.2), tag: 'acro-colossus-bastion' });
      // (r5) planted strip on the setback walk in front of the upper tier (shrubs fill 'acro-platform-tier' beds)
      const Sx = S.get('soil', F.o[0], F.o[2]);
      Sx.quadOut(F.p(0.6, yStep + 0.02, -0.25), F.p(len - 0.6, yStep + 0.02, -0.25), F.p(len - 0.6, yStep + 0.02, -1.15), F.p(0.6, yStep + 0.02, -1.15), [1, 1, 1], F.p(len / 2, yStep - 3, -0.7));
      // (the urn module's bed plants read as bead strings from 70 m: ivy tufts along the setback instead)
      for (let k = 0; k < 4; k++) slots.ivy.push({ pos: F.p(rng.range(1, len - 1), yStep + 0.3, -0.4), facing: fc.heading, size: rng.range(1.2, 3), width: rng.range(1.5, 3), tag: 'acro-colossus-bastion' });
      // (r6) ref 4: shrubs on the setback walk and on projecting rock ledges, long ivy curtains below them.
      // Only on the faces the shot-4 camera sees (east, south); the vegetation module grows slots.tree at
      // the given raised height.
      const seen = fc.heading === 90 || fc.heading === 180;
      if (seen) {
        for (let k = 0, n = Math.round(len / 3.2); k < n; k++) if (rng.random() < 0.75) slots.ivy.push({ pos: F.p((k + 0.5 + rng.range(-0.3, 0.3)) * len / n, yStep + rng.range(0.6, 1.2), -0.35), facing: fc.heading, size: rng.range(1.2, 2.6), width: rng.range(1.6, 2.8), tag: 'acro-colossus-bastion' });
        const bat = 0.012;
        for (let k = 0; k < 4; k++) {
          const lw = rng.range(1.8, 3.4), s0 = rng.range(0.9, Math.max(1, len - lw - 0.9));
          const yl = yBase + 2.2 + (yStep - 3.2 - yBase - 2.2) * ((k + rng.range(0.15, 0.85)) / 4);
          const dep = rng.range(0.65, 1.05), set = (yl - 0.45 - yBase) * bat;
          const Bl = S.get('ashlar', F.o[0], F.o[2]);
          chamferBox(Bl, F, s0, s0 + lw, yl - 0.5, yl, -set - 0.7, -set + dep, 0.09, darker(blockColor(rng, STONE_COL), 0.9));
          chamferBox(Bl, F, s0 + 0.3, s0 + lw - 0.3, yl - 0.85, yl - 0.5, -set - 0.6, -set + dep * 0.55, 0.07, darker(blockColor(rng, STONE_COL), 0.8)); // corbel
          const nS = Math.max(1, Math.round(lw / 1.5));
          for (let j = 0; j < nS; j++) slots.ivy.push({ pos: F.p(s0 + (j + 0.5) * lw / nS, yl + rng.range(0.5, 1.0), -set + dep * 0.6), facing: fc.heading, size: rng.range(1.0, 2.2), width: rng.range(1.2, 2.0), tag: 'acro-colossus-bastion' }); // (vegetation rejects raised tree slots within the colossus radius: leafy ivy tufts instead)
          slots.ivy.push({ pos: F.p(s0 + lw / 2, yl - 0.2, -set + dep + 0.06), facing: fc.heading, size: rng.range(3.5, 8), width: lw * rng.range(0.7, 1.0), tag: 'acro-colossus-bastion' });
        }
        // long ivy curtains from the coping (ref 4: the bastion is half green)
        for (let k = 0; k < 4; k++) slots.ivy.push({ pos: F.p(rng.range(1, len - 1), yStep - 0.45, 0.5), facing: fc.heading, size: rng.range(6, 13), width: rng.range(2.2, 4.5), tag: 'acro-colossus-bastion' });
      }
    },
  });
  // setback walk on the lower tier
  const Bw = S.get('paving', x, z);
  Bw.quadOut([x - hxL, yStep, z - hzL], [x + hxL, yStep, z - hzL], [x + hxL, yStep, z + hzL], [x - hxL, yStep, z + hzL], [1, 1, 1], [x, yStep - 5, z]);
  const cornH = 0.9, yMason = top - 0.3 - cornH;
  crownTier(ctxS, S, x, z, hx, hz, yStep - 0.6, yMason, rng, {
    quoins: true, // (r6) corner quoins on the upper tier too: vertical shadow lines on the shaded faces
    face: (fc, F, len) => {
      const hw = fc.half;
      // (r6) string course half-way up the (now taller) upper tier, with ivy hanging from it on the seen faces
      const yMid2 = (yStep + yMason) / 2;
      if (yMason - yStep > 9) {
        const ban = o.banners !== false && (fc.heading === 90 || fc.heading === 180);
        const bwH = Math.min(6.2, len * 0.48) / 2 + 0.45;
        for (const [a, b] of ban ? [[-0.05, hw - bwH], [hw + bwH, len + 0.05]] : [[-0.05, len + 0.05]]) moulding(S, 'ashlar', F, a, b, yMid2, PROFILES.string(1.1), blockColor(rng, STONE_COL), 0);
        if (fc.heading === 90 || fc.heading === 180) for (let k = 0; k < 3; k++) slots.ivy.push({ pos: F.p(rng.range(1, len - 1), yMid2 + 0.1, 0.35), facing: fc.heading, size: rng.range(3, 8), width: rng.range(1.4, 3.2), tag: 'acro-colossus-bastion' });
      }
      moulding(S, 'ashlar', F, -0.25, len + 0.25, yMason, PROFILES.cornice(cornH / 0.9), blockColor(rng, STONE_COL), 0);
      const Bc = S.get('ashlar', F.o[0] + F.ax[0] * hw, F.o[2] + F.ax[2] * hw);
      chamferBox(Bc, F, -0.25, len + 0.25, top - 0.3, top, -2.0, cornH * 0.55 + 0.08, 0.04, blockColor(rng, STONE_COL), 63 - 8);
      // balustrade only where it clears the pedestal
      if ((fc.heading === 90 || fc.heading === 270 ? hx - pedX : hz - pedZ) > 1.0) ctx.balus.addRun(S, 'marble', F.at(0, 0, -0.5), 1.0, len - 1.0, top, {});
      // (r5) one big banner under the statue on the faces seen from shot 4 (east, south), ref 4: ≈ 1:2.6, gold fringe
      if (o.banners !== false && (fc.heading === 90 || fc.heading === 180)) slots.banner.push({ pos: F.p(hw, yMason - 0.55, 0.62), facing: fc.heading, size: [Math.min(6.2, len * 0.48), Math.min(13.5, (yMason - yStep) - 0.8)], tag: 'acro-colossus-bastion' }); // (r6) ref 4: the banner is ≈ half the face wide
      // (r6) corbel table under the top cornice (a fortified, carved band that reads from 100 m)
      {
        const Bk = S.get('ashlar', F.o[0] + F.ax[0] * hw, F.o[2] + F.ax[2] * hw);
        const cK = blockColor(rng, STONE_COL);
        for (let sk = 0.55; sk < len - 0.4; sk += 0.95) {
          chamferBox(Bk, F, sk - 0.2, sk + 0.2, yMason - 0.75, yMason - 0.05, -0.3, 0.42, 0.04, darker(cK, 0.97), 63 - 8);
          chamferBox(Bk, F, sk - 0.17, sk + 0.17, yMason - 1.05, yMason - 0.75, -0.3, 0.22, 0.04, darker(cK, 0.92), 63 - 8);
        }
        chamferBox(Bk, F, -0.05, len + 0.05, yMason - 1.22, yMason - 1.05, -0.3, 0.1, 0.02, darker(cK, 0.95), 63 - 8);
      }
      // (r6) narrow windows beside the banner on two levels: dark openings (drawn just proud of the face, like the
      // stair passages) in moulded stone surrounds with sill and lintel — rhythm on the shaded tower faces
      if (len > 8 && ctx.M && ctx.M.void) {
        const Bv = S.get('void', F.o[0] + F.ax[0] * hw, F.o[2] + F.ax[2] * hw);
        const Bf = S.get('ashlar', F.o[0] + F.ax[0] * hw, F.o[2] + F.ax[2] * hw);
        const cW = blockColor(rng, STONE_COL);
        const levels = [yStep + 2.0]; if (yMason - yStep > 9) levels.push((yStep + yMason) / 2 + 1.4);
        for (const sw of [2.45, len - 2.45]) for (const y0 of levels) {
          const ww = 0.42, wh = 2.3;
          Bv.quadOut(F.p(sw - ww, y0, 0.05), F.p(sw + ww, y0, 0.05), F.p(sw + ww, y0 + wh, 0.05), F.p(sw - ww, y0 + wh, 0.05), [1, 1, 1], F.p(sw, y0 + wh / 2, -2));
          for (const sx of [-1, 1]) chamferBox(Bf, F, sx < 0 ? sw - ww - 0.24 : sw + ww, sx < 0 ? sw - ww : sw + ww + 0.24, y0 - 0.02, y0 + wh, -0.2, 0.2, 0.03, cW, 63 - 8);
          chamferBox(Bf, F, sw - ww - 0.36, sw + ww + 0.36, y0 - 0.22, y0, -0.2, 0.28, 0.03, darker(cW, 0.95), 63 - 8);       // sill
          chamferBox(Bf, F, sw - ww - 0.4, sw + ww + 0.4, y0 + wh, y0 + wh + 0.34, -0.2, 0.26, 0.04, cW, 63 - 8);           // lintel
          chamferBox(Bf, F, sw - ww - 0.5, sw + ww + 0.5, y0 + wh + 0.34, y0 + wh + 0.46, -0.2, 0.34, 0.03, darker(cW, 0.97), 63 - 8); // hood
        }
      }
      for (let k = 0; k < 2; k++) slots.ivy.push({ pos: F.p(rng.range(1, len - 1), top - 0.3, 0.4), facing: fc.heading, size: rng.range(2, 5), width: rng.range(1.2, 3), tag: 'acro-colossus-bastion' });
    },
  });
  const Bp = S.get('paving', x, z);
  Bp.quadOut([x - hx, top, z - hz], [x + hx, top, z - hz], [x + hx, top, z + hz], [x - hx, top, z + hz], [1, 1, 1], [x, top - 5, z]);
  for (const [cx, cz] of [[x - hx + 0.9, z + hz - 0.65], [x + hx - 0.9, z + hz - 0.65]]) slots.brazier.push({ pos: [cx, top, cz], facing: 180, size: 1.1, tag: 'acro-colossus-bastion-ground' });
  ctx.footprints.addRect(x, z, hxL + 2, hzL + 2, 0, 'acro-wall');
  // meshes: masonry without shadows (see header); materials come from the module's set
  if (ctx.M) for (const m of S.meshes(ctx.M)) { m.castShadow = false; m.userData.castShadow = false; group.add(m); }
  return { top, height: top - yG, group, rocks: rocks.length };
}
