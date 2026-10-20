// Terrace buildings from the architecture kit (src/arch): stoas, small prostyle temples, a tholos,
// and a propylon gate at the top of the grand stair. Sites are chosen on the real ledges (flat ground
// between the cliff foot and the terrace edge), clear of the stair, plazas and waterfalls.
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { shaderProblem } from './materials.js';
import { frameXZ, chamferBox } from './geo.js';
import { wallRun, moulding, PROFILES, blockColor, STONE_COL, buttress, planArch, buildArch } from './masonry.js';

/** scan a ledge at x: z-range [zIn, zOut] where the ground is at the ledge level */
export function ledgeSpan(x, level, zFrom = -40, zTo = 260) {
  let zIn = null, zOut = null;
  for (let z = zFrom; z <= zTo; z += 0.75) {
    const h = heightAt(x, z);
    const on = Math.abs(h - (level - 0.5)) < 2.2; // (director) wall/bastion levels sit ~1-2 m above the terrain ledges
    if (on && zIn === null) zIn = z;
    if (!on && zIn !== null) { zOut = z - 0.75; if (zOut - zIn > 6) break; zIn = null; zOut = null; }
  }
  if (zIn !== null && zOut === null) zOut = zTo;
  return zIn !== null && zOut - zIn > 6 ? [zIn, zOut] : null;
}

const nearFall = (x, z, r) => L.WATERFALLS.some((w) => Math.hypot(w.from[0] - x, w.from[2] - z) < w.width * 0.5 + r);
/** distance from (x,z) to a waterfall's fall line (lip → ~18 m along its direction) minus its half width */
function fallClearance(x, z) {
  let best = Infinity;
  for (const w of L.WATERFALLS) {
    const a = (w.dir * Math.PI) / 180, dx = Math.sin(a), dz = -Math.cos(a);
    const ax = w.from[0] - dx * 1.5, az = w.from[2] - dz * 1.5, bx = w.from[0] + dx * 18, bz = w.from[2] + dz * 18;
    const ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t) - w.width * 0.5);
  }
  return best;
}

/**
 * Find a building site near (x, z0..z1) on a terrace ledge at `level`: the footprint (hw, hd, facing
 * south) must not be buried in the cliff behind (> 22 % of the samples above the floor) and may stand
 * at most `maxPlat` m above the rock (a masonry platform fills the gap). Returns { x, z, under, buried }.
 */
export function findSite(level, x, dx, z0, z1, hw, hd, avoid, opts = {}) {
  const maxPlat = opts.maxPlat ?? 13;
  let best = null;
  for (let cx = x - dx; cx <= x + dx + 1e-6; cx += 1.5) {
    for (let cz = z0; cz <= z1 + 1e-6; cz += 1.0) {
      if (avoid && avoid(cx, cz, hw, hd)) continue;
      let buried = 0, n = 0, under = 0, water = false;
      for (let i = 0; i <= 6; i++) for (let j = 0; j <= 5; j++) {
        const px = cx - hw + (2 * hw * i) / 6, pz = cz - hd + (2 * hd * j) / 5;
        const g = heightAt(px, pz);
        n++;
        if (g > level + 0.8) buried++;
        under = Math.max(under, level - g);
        if (g < 0.6) water = true;
      }
      const bf = buried / n;
      if (bf > (opts.maxBuried ?? 0.22) || under > maxPlat || (water && !opts.water)) continue;
      // prefer: little burial, a low platform, close to the requested x, near the back of the ledge
      const score = bf * 30 + under * 0.35 + Math.abs(cx - x) * 0.12 + (opts.preferFront ? -(cz - z0) * 0.05 : (cz - z0) * 0.05);
      if (!best || score < best.score) best = { x: cx, z: cz, under, buried: bf, score };
    }
  }
  return best;
}

/**
 * Masonry platform (terrace podium) under a building: ashlar retaining walls from the rock up to
 * `top` on the sides that stand free, a cornice, paved top and a balustrade along the front.
 */
export function buildPlatform(ctx, x, z, hw, hd, top, rng, opts = {}) {
  const { S } = ctx;
  const x0 = x - hw, x1 = x + hw, z0 = z - hd, z1 = z + hd;
  const faces = [
    { F: frameXZ(x0, 0, z1, 1, 0, 0, 1), len: x1 - x0, heading: 180, front: true },
    { F: frameXZ(x1, 0, z1, 0, -1, 1, 0), len: z1 - z0, heading: 90 },
    { F: frameXZ(x0, 0, z0, 0, 1, -1, 0), len: z1 - z0, heading: 270 },
  ];
  const cornH = 0.6;
  // (r4) stepped platforms: where the rock falls away more than ~5.5 m a lower tier projects ~2 m
  // further out with a planted setback (shrubs, ivy curtains) and the upper wall gets blind arches,
  // so the platform reads as stepped garden terraces instead of one tall masonry box (shots 4, 8)
  let gAll = Infinity;
  for (const fc of faces) for (let s = 0; s <= fc.len; s += 1) { const p = fc.F.p(s, 0, 0.7); gAll = Math.min(gAll, heightAt(p[0], p[2])); }
  const tall = top - gAll;
  const off = tall > 5.5 && opts.stepped !== false ? 1.8 + rng.random() * 0.8 : 0;
  const ySet = off ? Math.min(top - 3.4, gAll + Math.max(2.4, tall * (0.38 + 0.17 * rng.random()))) : null;
  let nTier = 0;
  for (const fc of faces) {
    const { F, len } = fc;
    const groundAt = (s) => { const p = F.p(Math.min(len, Math.max(0, s)), 0, 0.7); return heightAt(p[0], p[2]); };
    let gmin = Infinity; for (let s = 0; s <= len; s += 1) gmin = Math.min(gmin, groundAt(s));
    if (gmin > top - 0.4) continue;
    let yBot = gmin - 1.2;
    let gUp = groundAt;
    if (off && gmin < ySet - 0.8) {
      const s0 = fc.front || fc.heading === 90 ? -off : 0;
      const s1 = fc.front || fc.heading === 270 ? len + off : len;
      const Fl = F.at(s0, 0, off), L1 = s1 - s0;
      const gAtL = (s) => { const p = Fl.p(Math.min(L1, Math.max(0, s)), 0, 0.7); return heightAt(p[0], p[2]); };
      let gl = Infinity; for (let s = 0; s <= L1; s += 1) gl = Math.min(gl, gAtL(s));
      if (gl < ySet - 0.5) {
        wallRun(S, 'ashlar', Fl, L1, gl - 1.2, ySet - 0.3, { rng, courses: 'random', batter: 0.02, rustic: true, rusticH: 3, groundAt: gAtL, lite: true, damp: 0.6 });
        moulding(S, 'ashlar', Fl, -0.05, L1 + 0.05, ySet - 0.3, PROFILES.coping(1.2), blockColor(rng, STONE_COL), 0);
        if (ySet - gl > 6 && L1 > 9) {
          const nb = Math.floor(L1 / 8);
          for (let k = 1; k <= nb; k++) buttress(S, 'ashlar', Fl, (L1 * k) / (nb + 1), 1.3, 0.55, gl - 1.2, ySet - 0.6, rng, { groundAt: gAtL, setoffs: 1 });
        }
        // planted setback: soil strip with shrubs, ivy curtains over the lower tier
        const Sx = S.get('soil', Fl.o[0], Fl.o[2]);
        Sx.quadOut(Fl.p(0, ySet - 0.02, -off + 0.05), Fl.p(L1, ySet - 0.02, -off + 0.05), Fl.p(L1, ySet - 0.02, -0.3), Fl.p(0, ySet - 0.02, -0.3), [1, 1, 1], Fl.p(L1 / 2, ySet - 3, -off / 2));
        // planted strip (banners/urn module fills 'bed' planters with plants at this exact height;
        // slots.tree would plant at the terrain height inside the tier)
        for (let sp = 0.4; sp < L1 - 1.2; sp += 4.5 + rng.random() * 2) {
          const ln = Math.min(L1 - 0.4 - sp, 2.2 + rng.random() * 2.4);
          if (ln < 1.2 || rng.random() < 0.25) { continue; }
          const p = Fl.p(sp + ln / 2, ySet - 0.02, -off * 0.5 - 0.1);
          ctx.slots.planter.push({ pos: p, facing: (Math.atan2(-Fl.ax[2], Fl.ax[0]) * 180) / Math.PI, size: [ln, Math.max(0.6, off - 0.6)], tag: 'acro-platform-tier' });
        }
        for (let sp = 0.8; sp < L1 - 0.8; sp += 2.4) if (rng.random() < 0.55) ctx.slots.ivy.push({ pos: Fl.p(sp + rng.range(-0.5, 0.5), ySet - 0.25, 0.3), facing: fc.heading, size: rng.range(1.5, Math.min(6, ySet - gl)), width: rng.range(1.2, 2.6), tag: 'acro-platform-tier' });
        yBot = ySet - 0.6;
        gUp = (s) => Math.max(groundAt(s), ySet - 0.05);
        nTier++;
      }
    }
    // blind arcade on the upper front wall (niches, some with statues)
    const yTopW = top - cornH - 0.25;
    const arches = [];
    if (fc.front && len > 10 && yTopW - Math.max(yBot, gmin) > 4.4) {
      const sill = Math.max(yBot + 0.6, (ySet ?? gmin) + 0.6);
      const h = Math.min(4.2, (yTopW - sill) * 0.72);
      const n = Math.max(2, Math.floor(len / 4.6));
      if (h > 2.4) for (let k = 0; k < n; k++) arches.push(planArch((len * (k + 0.5)) / n, sill, Math.min(2.4, h * 0.62), h, 0.5));
    }
    wallRun(S, 'ashlar', F, len, yBot, yTopW, {
      rng, courses: 'pseudo', batter: 0.012, rustic: true, rusticH: 2.5, groundAt: gUp, lite: true, damp: 0.6,
      cuts: arches.length ? (c0, c1) => arches.map((A) => A.cut(c0, c1)).filter(Boolean) : null,
    });
    for (const A of arches) {
      const r = buildArch(S, 'ashlar', F, A, rng, { depth: 1.1 });
      if (rng.random() < 0.4) ctx.slots.statue.push({ pos: r.statuePos, facing: fc.heading, size: Math.min(A.h * 0.62, 2.4), tag: 'acro-niche' });
    }
    moulding(S, 'ashlar', F, -0.1, len + 0.1, yTopW, PROFILES.cornice(cornH / 0.9), blockColor(rng, STONE_COL), 0);
    const Bc = S.get('ashlar', F.o[0] + F.ax[0] * len / 2, F.o[2] + F.ax[2] * len / 2);
    chamferBox(Bc, F, -0.1, len + 0.1, top - 0.25, top, -1.0, cornH * 0.55 + 0.05, 0.03, blockColor(rng, STONE_COL), 63 - 8);
    if (top - yBot > 6 && len > 9 && !arches.length) {
      const nb = Math.floor(len / 7.5);
      for (let k = 1; k <= nb; k++) buttress(S, 'ashlar', F, (len * k) / (nb + 1), 1.4, 0.6, yBot, top - cornH - 0.4, rng, { groundAt: gUp, setoffs: 1 });
    }
    if (fc.front || opts.balusAll) ctx.balus.addRun(S, 'marble', F.at(0, 0, -0.45), 0.5, len - 0.5, top, { broken: 0.01 });
    if (top - yBot > 3.5) for (let k = 0; k < Math.floor(len / 5); k++) {
      if (rng.random() < 0.5) continue;
      ctx.slots.ivy.push({ pos: F.p(rng.range(0.5, len - 0.5), top - 0.2, 0.35), facing: fc.heading, size: rng.range(1.5, Math.min(7, top - yBot)), width: rng.range(1, 3), tag: 'acro-platform' });
    }
    if (fc.front && top - yBot > 5 && len > 8 && opts.banner !== false && !arches.length) ctx.slots.banner.push({ pos: F.p(len / 2, top - cornH - 0.4, 0.22), facing: fc.heading, size: [2.2, Math.min(6.5, (top - yBot) * 0.55)], tag: 'acro-platform' });
  }
  if (nTier) ctx.footprints.addRect(x, z + off / 2, hw + off + 0.3, hd + off / 2 + 0.3, 0, 'acro-wall');
  // paved top (only the margin around the crepidoma shows)
  const B = S.get('paving', x, z);
  B.quadOut([x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1], [1, 1, 1], [x, top - 5, z]);
  ctx.footprints.addRect(x, z, hw + 0.5, hd + 0.5, 0, 'acro-wall');
}

/**
 * Terrace buildings. sites: { name, kind, k (ledge index into levels), x, dx, z0, z1, o }
 * levels: [plateau, ledge0, ledge1, ledge2] (wall levels).
 */
export async function buildTerraceBuildings(ctx, levels, engine) {
  let ARCH;
  try { ARCH = await import('../arch/index.js'); } catch (e) { console.log('[acropolis] arch kit not available — terrace buildings skipped'); return []; }
  try {
    const bad = shaderProblem(ARCH.marbleMaterial({ variant: 'weathered' }));
    if (bad) { console.warn(`[acropolis] arch marble shader uses reserved word '${bad}' — terrace buildings skipped until it is fixed`); return []; }
  } catch (e) { /* ignore */ }
  const det = engine.quality.detail * 0.8; // terrace buildings are seen from mid-distance
  const lv = levels; // [plateau, ledge1, ledge2, ledge3 ...]
  // (r2) sites placed against the shot frames (refs 3, 4, 9): east = under colossus A, right of the
  // temple in shots 3/4; west = left of the temple in shots 9/2/3
  const sites = [
    { name: 'acro-stoa-1E', kind: 'stoa', k: 1, x: 60, dx: 4, z0: -24, z1: -10, o: { length: 14, depth: 8, colH: 5.4, order: 'doric', inner: 'ionic', steps: 2, gild: 0.4, plaques: true, seed: 11 } },
    { name: 'acro-temple-1E', kind: 'prostyle', k: 1, x: 83, dx: 5, z0: -24, z1: -10, o: { order: 'ionic', porch: 6, colH: 6.2, L: 17, steps: 3, gild: 0.6, frieze: 'rosettes', acroteria: 'palmette', corners: 'palmette', flankStatues: true, seed: 35 } },
    { name: 'acro-temple-1W', kind: 'prostyle', k: 1, x: -24, dx: 4, z0: -24, z1: -8, o: { order: 'ionic', porch: 4, colH: 6.2, steps: 3, gild: 0.7, frieze: 'rosettes', acroteria: 'palmette', corners: 'palmette', flankStatues: true, seed: 21 } },
    { name: 'acro-monopteros-2E', kind: 'tholos', k: 2, x: 92, dx: 6, z0: -4, z1: 14, o: { radius: 3.5, columns: 8, colH: 4.6, order: 'ionic', steps: 3, gild: 1, statue: true, seed: 31 } },
    { name: 'acro-stoa-2E', kind: 'stoa', k: 2, x: 108, dx: 6, z0: -4, z1: 14, o: { length: 16, depth: 8, colH: 5.0, order: 'doric', inner: null, steps: 2, gild: 0.3, seed: 13 } },
    { name: 'acro-tholos-2W', kind: 'tholos', k: 2, x: -38, dx: 8, z0: -6, z1: 16, o: { radius: 5.2, columns: 12, colH: 5.8, order: 'corinthian', steps: 3, gild: 1, statue: true, seed: 41 } },
    { name: 'acro-stoa-3E', kind: 'stoa', k: 3, x: 106, dx: 6, z0: 14, z1: 40, o: { length: 30, depth: 8.5, colH: 5.2, order: 'doric', steps: 2, gild: 0.3, seed: 51 } },
    { name: 'acro-temple-3W', kind: 'prostyle', k: 3, x: -44, dx: 4, z0: 14, z1: 40, o: { order: 'ionic', porch: 4, colH: 5.4, L: 12, steps: 3, gild: 0.5, frieze: 'plaques', acroteria: 'palmette', amphi: true, seed: 61 } },
  ];
  const placed = [];
  const GS = L.GRAND_STAIR;
  const avoid = (cx, cz, hw, hd) => {
    if (Math.abs(cx - GS.x) < hw + 14) return true;                           // stair corridor + its landings
    if (fallClearance(cx, cz) < Math.max(hw, hd) * 0.8 + 1.0) return true;   // keep the falls free
    for (const p of placed) if (Math.abs(cx - p.x) < hw + p.hw + 1.5 && Math.abs(cz - p.z) < hd + p.hd + 1.5) return true;
    for (const c of L.COLOSSI) if (Math.hypot(cx - c.pos[0], cz - c.pos[2]) < c.height * 0.36 + Math.max(hw, hd)) return true;
    return !engine.footprints.isFree(cx, cz, Math.min(hw, hd) * 0.7, ['acro-wall', 'acro-pedestal']);
  };
  const built = [];
  for (const st of sites) {
    const level = lv[st.k];
    if (level === undefined) continue;
    try {
      const t0 = performance.now();
      const B = st.kind === 'stoa' ? ARCH.stoa({ ...st.o, detail: det, name: st.name })
        : st.kind === 'tholos' ? ARCH.tholos({ ...st.o, detail: det, name: st.name })
          : ARCH.prostyleTemple({ ...st.o, detail: det, name: st.name });
      const fp = B.info.footprint || { hw: 8, hd: 8 };
      const hw = fp.hw ?? fp.r ?? 8, hd = fp.hd ?? fp.r ?? 8;
      const m = 1.2; // platform margin around the crepidoma
      const site = findSite(level, st.x, st.dx, st.z0, st.z1, hw + m, hd + m, avoid);
      if (!site) { console.log(`[acropolis] ${st.name}: no site on ledge ${st.k} near x=${st.x}`); continue; }
      const top = level;
      buildPlatform(ctx, site.x, site.z, hw + m, hd + m, top, engine.rng('acro-plat-' + st.name), { banner: site.under > 5 });
      const steps = st.o.steps ?? 3, stepH = st.kind === 'stoa' ? 0.34 : (st.o.stepH ?? 0.36);
      const y = top + steps * stepH;
      const aoQ = engine.quality.detail >= 1 ? {} : { aoCell: 0.85, aoRays: 22 };
      const group = B.finalize({ position: [site.x, y, site.z], rotY: L.headingToRotY(180), engine, ...aoQ });
      group.name = st.name;
      engine.add(group);
      if (B.publishSlots) B.publishSlots(engine);
      engine.footprints.addRect(site.x, site.z, hw + 1, hd + 1, 0, 'acro-building');
      placed.push({ x: site.x, z: site.z, hw: hw + m, hd: hd + m });
      built.push({ name: st.name, x: site.x, z: site.z, y, hw, hd, plat: +site.under.toFixed(1), ms: Math.round(performance.now() - t0), tris: B.triangles || 0 });
    } catch (e) {
      console.warn(`[acropolis] building ${st.name} failed:`, e && (e.stack || e.message || e));
    }
  }
  return built;
}

/**
 * (r5) Buildings on the plateau precinct flanking the temple (refs 3, 9, 8): a long stoa on the west side
 * facing east (left of the temple / colossus C from the SE cameras) and a small ionic temple on the
 * east side facing south (right of colossus A). y0 = precinct paving level.
 */
export async function buildPrecinctBuildings(ctx, engine, y0) {
  let ARCH;
  try { ARCH = await import('../arch/index.js'); } catch (e) { return []; }
  if (shaderProblem(ARCH.marbleMaterial({ variant: 'weathered' }))) return [];
  const det = engine.quality.detail * 0.8;
  const aoQ = engine.quality.detail >= 1 ? {} : { aoCell: 0.85, aoRays: 22 };
  const specs = [
    { name: 'acro-precinct-stoa-W', kind: 'stoa', x: -37, z: -74, heading: 90, o: { length: 36, depth: 9, colH: 6.2, order: 'doric', inner: 'ionic', steps: 3, gild: 0.45, plaques: true, seed: 81 } },
    { name: 'acro-precinct-temple-E', kind: 'prostyle', x: 88, z: -66, heading: 175, o: { order: 'ionic', porch: 6, colH: 6.6, L: 19, steps: 3, gild: 0.7, frieze: 'rosettes', acroteria: 'palmette', corners: 'palmette', flankStatues: true, seed: 91 } },
  ];
  const out = [];
  for (const sp of specs) {
    try {
      const t0 = performance.now();
      const B = sp.kind === 'stoa' ? ARCH.stoa({ ...sp.o, detail: det, name: sp.name }) : ARCH.prostyleTemple({ ...sp.o, detail: det, name: sp.name });
      const fp = B.info.footprint || { hw: 8, hd: 8 };
      const hw = (fp.hw ?? fp.r ?? 8) + 0.8, hd = (fp.hd ?? fp.r ?? 8) + 0.8;
      const a = (sp.heading * Math.PI) / 180, fx = Math.sin(a), fz = -Math.cos(a); // front direction
      const ax = -fz, az = fx;                                                      // along the facade
      let site = null;
      for (const [df, da] of [[0, 0], [0, -5], [0, 5], [-3, 0], [3, 0], [-3, -6], [-3, 6], [-6, 0]]) {
        const cx = sp.x + fx * df + ax * da, cz = sp.z + fz * df + az * da;
        let ok = true, gmin = Infinity, gmax = -Infinity;
        for (let i = -1; i <= 1 && ok; i += 0.5) for (let j = -1; j <= 1 && ok; j += 0.5) {
          const px = cx + ax * hw * i + fx * hd * j, pz = cz + az * hw * i + fz * hd * j;
          const g = heightAt(px, pz); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g);
          if (!engine.footprints.isFree(px, pz, 0.6, ['acro-plaza'])) ok = false;
        }
        if (ok && gmin > y0 - 1.6 && gmax < y0 + 0.8) { site = { x: cx, z: cz }; break; }
      }
      if (!site) { console.log(`[acropolis] ${sp.name}: no free site`); continue; }
      const steps = sp.o.steps ?? 3, stepH = sp.kind === 'stoa' ? 0.34 : 0.36;
      const group = B.finalize({ position: [site.x, y0 + steps * stepH, site.z], rotY: L.headingToRotY(sp.heading), engine, ...aoQ });
      group.name = sp.name;
      engine.add(group);
      if (B.publishSlots) B.publishSlots(engine);
      const rot = Math.atan2(ax, az) + Math.PI / 2;
      engine.footprints.addRect(site.x, site.z, hw + 0.5, hd + 0.5, rot, 'acro-building');
      // paved apron in front of the building (the precinct paving stops at x ≈ -26 on the west side)
      const Pv = ctx.S.get('paving', site.x, site.z);
      const P = (s, d) => [site.x + ax * s + fx * d, y0 + 0.01, site.z + az * s + fz * d];
      Pv.quadOut(P(-hw, hd - 0.2), P(hw, hd - 0.2), P(hw, hd + 7), P(-hw, hd + 7), [1, 1, 1], [site.x, y0 - 4, site.z]);
      out.push({ name: sp.name, x: +site.x.toFixed(1), z: +site.z.toFixed(1), ms: Math.round(performance.now() - t0), tris: B.triangles || 0 });
    } catch (e) { console.warn(`[acropolis] ${sp.name} failed:`, e && (e.stack || e.message || e)); }
  }
  return out;
}

/** propylon gate on the plateau forecourt, facing south down the grand stair */
export async function buildPropylon(ctx, X, z, y, engine) {
  let ARCH;
  try { ARCH = await import('../arch/index.js'); } catch (e) { return null; }
  try {
    if (shaderProblem(ARCH.marbleMaterial({ variant: 'weathered' }))) return null;
    const B = ARCH.propylon({ columns: 6, colH: 7.2, gild: 0.7, detail: engine.quality.detail, name: 'acro-propylon', seed: 71 });
    const fp = B.info.footprint || { hw: 9, hd: 7 };
    const steps = 3, stepH = 0.36;
    const g = heightAt(X, z);
    const aoQ = engine.quality.detail >= 1 ? {} : { aoCell: 0.85, aoRays: 22 };
    const group = B.finalize({ position: [X, Math.max(y, g) + steps * stepH, z], rotY: L.headingToRotY(180), engine, ...aoQ });
    engine.add(group);
    if (B.publishSlots) B.publishSlots(engine);
    engine.footprints.addRect(X, z, (fp.hw ?? 9) + 1, (fp.hd ?? 7) + 1, 0, 'acro-building');
    return { x: X, z, hw: fp.hw ?? 9, hd: fp.hd ?? 7, tris: B.triangles || 0 };
  } catch (e) { console.warn('[acropolis] propylon failed', e && (e.stack || e.message || e)); return null; }
}

/** cypress rows along the terraces (back of each ledge), split around buildings/stair/waterfalls */
export function cypressRows(levels, engine, X) {
  const rows = [];
  for (let k = 1; k < Math.min(levels.length, 4); k++) {
    let cur = [];
    const flush = () => { if (cur.length >= 3) rows.push({ points: cur, spacing: 6.5, tag: 'acro-ledge-' + k }); cur = []; };
    for (let x = -130; x <= 190; x += 3) {
      const span = ledgeSpan(x, levels[k], -32, 140); // (r2) the south face now spans z ≈ -30..60
      if (!span || span[1] - span[0] < 7) { flush(); continue; }
      const z = span[0] + 3.2;
      const blocked = !engine.footprints.isFree(x, z, 2.0, ['acro-wall']) || nearFall(x, z, 6) || Math.abs(x - X) < 14;
      if (blocked) { flush(); continue; }
      cur.push([x, z]);
    }
    flush();
  }
  return rows;
}
