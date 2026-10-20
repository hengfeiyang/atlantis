// Branching trees: olive (gnarled, split, twisted trunks + silvery lanceolate canopy), holm-oak /
// rounded broadleaf, umbrella (stone) pine, and maquis shrubs.
// One recursive skeleton → several LODs:
//   LOD0 hero : every branch as a tube (bark material) + alpha leaf cards around each foliage cluster
//               (+ dark inner clumps for dense species)
//   LOD1 mid  : trunk + limbs, foliage as ~20-40 lumpy textured clumps
//   LOD2 far  : trunk, 8-14 clumps        LOD3 : 4-7 clumps
//
//   buildTree(species, seed) → { H, R, lods: [{bark, blob, card}, ...] }
import { GeoBuilder, v3, perp, rotAxis, clamp, lerp, smoothstep, cellRect, addBlob, addCard, addTube } from './util.js';
import { LEAF, GRID } from './atlas.js';
import { Simplex } from '../core/noise.js';
import { RNG, hashString } from '../core/rng.js';

const SPEC = {
  olive: {
    trunkH: [0.9, 1.6], trunkR: [0.2, 0.32], stems: [1, 2], gnarl: 0.7, twist: 0.2,
    limbs: [3, 5], limbAng: [0.45, 0.95], limbLen: [1.8, 3.0], depth: 3, kids: [3, 5], kidLen: 0.62,
    tropism: 0.18, wander: 0.55, crownW: [5.0, 7.5], crownH: [3.4, 5.0],
    clusterR: [0.4, 0.6], cards: 4, leafCells: LEAF.olive, patch: LEAF.olivePatch, inner: 0.6, flat: 0.85, lobes: 0.12,
  },
  broad: {
    // holm oak / laurel: low dense dome, often forked low
    trunkH: [1.2, 2.3], trunkR: [0.22, 0.36], stems: [1, 2], gnarl: 0.35, twist: 0.3,
    limbs: [4, 6], limbAng: [0.45, 0.9], limbLen: [2.4, 3.6], depth: 3, kids: [3, 5], kidLen: 0.62,
    tropism: 0.22, wander: 0.35, crownW: [7.0, 10.5], crownH: [5.5, 8.0],
    clusterR: [0.7, 1.0], cards: 4, leafCells: LEAF.broad, patch: LEAF.broadPatch, inner: 0.9, flat: 0.95, lobes: 0.24,
  },
  pine: {
    trunkH: [5.5, 9.0], trunkR: [0.26, 0.4], stems: [1, 1], gnarl: 0.15, twist: 0.2,
    limbs: [4, 6], limbAng: [0.8, 1.2], limbLen: [3.6, 5.6], depth: 3, kids: [3, 4], kidLen: 0.66,
    tropism: 0.08, wander: 0.3, crownW: [10.0, 15.0], crownH: [3.6, 5.0],
    clusterR: [1.0, 1.45], cards: 3, leafCells: LEAF.pine, patch: LEAF.pinePatch, inner: 0.8, flat: 0.62, lobes: 0.18,
  },
  thicket: {
    trunkH: [0.0, 0.1], trunkR: [0.05, 0.09], stems: [6, 10], gnarl: 0.2, twist: 0.3,
    limbs: [0, 0], limbAng: [0.5, 1.0], limbLen: [0.5, 1.0], depth: 1, kids: [2, 3], kidLen: 0.6,
    tropism: 0.25, wander: 0.4, crownW: [6.0, 11.0], crownH: [2.2, 3.8],
    clusterR: [0.55, 0.95], cards: 3, leafCells: [...LEAF.shrub, ...LEAF.broad], patch: LEAF.shrubPatch, inner: 0.9, flat: 0.75, lobes: 0.25,
  },
  shrub: {
    trunkH: [0.0, 0.1], trunkR: [0.04, 0.07], stems: [3, 6], gnarl: 0.2, twist: 0.3,
    limbs: [0, 0], limbAng: [0.5, 1.0], limbLen: [0.5, 1.0], depth: 1, kids: [2, 3], kidLen: 0.6,
    tropism: 0.3, wander: 0.4, crownW: [1.2, 3.0], crownH: [0.8, 1.8],
    clusterR: [0.3, 0.5], cards: 3, leafCells: LEAF.shrub, patch: LEAF.shrubPatch, inner: 0.9, flat: 0.8, lobes: 0.22,
  },
};

export function buildTree(species, seed, opts = {}) {
  const S = SPEC[species];
  const shrubby = species === 'shrub' || species === 'thicket';
  const rng = new RNG(`tree:${species}:${seed}`);
  const nz = new Simplex(hashString(`treeN:${species}:${seed}`));
  const scale = opts.scale || 1;
  const trunkH = rng.range(...S.trunkH) * scale;
  const crownW = rng.range(...S.crownW) * scale;
  const crownH = rng.range(...S.crownH) * scale;
  const lean = [rng.range(-1, 1) * (species === 'pine' ? 0.22 : 0.12), rng.range(-1, 1) * (species === 'pine' ? 0.22 : 0.12)];
  // crown envelope: ellipsoid with lumpy radius (irregular, clumpy outline)
  const cc = [lean[0] * (trunkH + crownH * 0.5), trunkH + crownH * (species === 'pine' ? 0.42 : 0.55), lean[1] * (trunkH + crownH * 0.5)];
  if (shrubby) cc[1] = crownH * 0.45;
  const envR = (d) => {
    const n = 1 + S.lobes * nz.noise3(d[0] * 1.7, d[1] * 1.7, d[2] * 1.7) + 0.1 * nz.noise3(d[0] * 4 + 5, d[1] * 4, d[2] * 4);
    return n;
  };
  const insideEnv = (p, k = 1) => {
    const d = [(p[0] - cc[0]) / (crownW * 0.5), (p[1] - cc[1]) / (crownH * 0.5), (p[2] - cc[2]) / (crownW * 0.5)];
    const l = v3.len(d);
    return l / envR(v3.norm(d)) < k;
  };

  // ------------------------------------------------------------------ skeleton
  const branches = [];
  const clusters = []; // {p, r, rnd}
  const grow = (start, dir, len, r0, depth, parentTaper = 0.55) => {
    const n = clamp(Math.round(len / 0.22), 3, 14);
    const pts = [start], rad = [r0];
    let d = dir, p = start;
    const seedK = rng.random() * 100;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const w = [nz.noise3(p[0] * 0.9 + seedK, p[1] * 0.9, p[2] * 0.9), nz.noise3(p[0] * 0.9, p[1] * 0.9 + seedK, p[2] * 0.9) * 0.6, nz.noise3(p[0] * 0.9, p[1] * 0.9, p[2] * 0.9 + seedK)];
      const out = v3.norm([p[0] - cc[0] + 1e-3, 0, p[2] - cc[2]]);
      d = v3.norm(v3.add(v3.add(d, v3.mul(w, S.wander * (depth === 0 ? S.gnarl * 1.2 : 1) * 0.35)), [out[0] * 0.05, S.tropism * 0.25, out[2] * 0.05]));
      if (species === 'pine' && depth >= 1) d = v3.norm([d[0], d[1] * 0.75 + 0.02, d[2]]);
      p = v3.mad(p, d, len / n);
      pts.push(p);
      rad.push(r0 * (1 - (1 - parentTaper) * t));
      if (depth > 0 && !insideEnv(p, 1.08) && i > 1) break;
    }
    const b = { pts, rad, depth };
    branches.push(b);
    const isLast = depth >= S.depth;
    if (isLast || rad[rad.length - 1] < 0.012) {
      const e = pts[pts.length - 1];
      clusters.push({ p: e, r: rng.range(...S.clusterR) * Math.sqrt(scale), rnd: rng.random() });
      // a second cluster along the twig
      if (pts.length > 3) clusters.push({ p: pts[Math.floor(pts.length * 0.55)], r: rng.range(...S.clusterR) * 0.8 * Math.sqrt(scale), rnd: rng.random() });
      return;
    }
    const nk = rng.int(...S.kids);
    for (let k = 0; k < nk; k++) {
      const t = lerp(depth === 0 ? 0.55 : 0.35, 0.95, (k + rng.random() * 0.7) / nk);
      const idx = clamp(Math.round(t * (pts.length - 1)), 1, pts.length - 1);
      const base = pts[idx];
      const pd = v3.norm(v3.sub(pts[idx], pts[idx - 1]));
      const ang = rng.range(0.4, 0.9) * (depth === 0 ? 1 : 0.9);
      const around = rng.random() * Math.PI * 2;
      let cd = rotAxis(pd, rotAxis(perp(pd), pd, around), ang);
      // bias children outward/upward toward the envelope
      const toOut = v3.norm(v3.sub(v3.add(cc, v3.mul(v3.norm(v3.sub(base, cc)), crownW * 0.5)), base));
      cd = v3.norm(v3.add(cd, v3.mul(toOut, 0.35)));
      grow(base, cd, len * S.kidLen * rng.range(0.8, 1.15), rad[idx] * rng.range(0.55, 0.7), depth + 1);
    }
  };

  // trunk(s)
  const stems = rng.int(...S.stems);
  const trunkTops = [];
  for (let s = 0; s < stems; s++) {
    const a0 = (s / stems) * Math.PI * 2 + rng.random();
    const off = species === 'thicket' ? rng.range(0.1, 0.38) * crownW : stems > 1 ? rng.range(0.08, 0.22) * scale : 0;
    const base = [Math.cos(a0) * off, -0.4, Math.sin(a0) * off];
    const r0 = rng.range(...S.trunkR) * scale / Math.sqrt(stems) * 1;
    if (shrubby) {
      const dir = v3.norm([Math.cos(a0) * 0.6, 1, Math.sin(a0) * 0.6]);
      grow(base, dir, crownH * rng.range(0.6, 0.9), r0, 0, 0.3);
      continue;
    }
    // gnarled trunk: twisting helix around the common axis for multi-stem olives
    const n = 14;
    const pts = [], rad = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = -0.4 + (trunkH + 0.4) * t;
      const helix = stems > 1 ? a0 + t * S.twist * 1.5 : 0;
      const rr = off * (1 + 0.6 * t);
      const wob = S.gnarl * 0.25 * scale;
      pts.push([
        Math.cos(helix) * rr + lean[0] * y + wob * nz.noise2(t * 2.2, s * 3.1 + 1),
        y,
        Math.sin(helix) * rr + lean[1] * y + wob * nz.noise2(t * 2.2, s * 3.1 + 7),
      ]);
      rad.push(r0 * (1.35 - 0.35 * Math.pow(t, 0.5)) * (i === 0 ? 1.25 : 1) * (1 + 0.15 * S.gnarl * nz.noise2(t * 5, s)));
    }
    branches.push({ pts, rad, depth: 0, trunk: true });
    trunkTops.push({ p: pts[n], d: v3.norm(v3.sub(pts[n], pts[n - 2])), r: rad[n] });
  }
  // limbs from trunk tops
  if (!shrubby) {
    const nl = rng.int(...S.limbs);
    for (let l = 0; l < nl; l++) {
      const tt = trunkTops[l % trunkTops.length];
      const around = (l / nl) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const ang = rng.range(...S.limbAng);
      const dir = v3.norm([Math.cos(around) * Math.sin(ang), Math.cos(ang), Math.sin(around) * Math.sin(ang)]);
      const d = v3.norm(v3.add(dir, v3.mul(tt.d, 0.3)));
      grow(tt.p, d, rng.range(...S.limbLen) * scale, tt.r * rng.range(0.6, 0.78), 1);
    }
    // the leader continues for broadleaf
    if (species === 'broad') grow(trunkTops[0].p, v3.norm([lean[0], 1, lean[1]]), crownH * 0.6, trunkTops[0].r * 0.7, 1);
  }
  // fill the envelope: extra clusters on the outer shell so the crown reads as a full, lumpy mass
  const extra = Math.round((species === 'shrub' ? 10 : species === 'thicket' ? 44 : species === 'pine' ? 46 : species === 'olive' ? 80 : 64) * (S.inner + 0.3));
  for (let i = 0; i < extra; i++) {
    const d = v3.norm(rng.sphere());
    if (d[1] < -0.5 && !shrubby) continue;
    const k = rng.range(0.55, 0.95) * envR(d);
    const p = [cc[0] + d[0] * crownW * 0.5 * k, cc[1] + d[1] * crownH * 0.5 * k, cc[2] + d[2] * crownW * 0.5 * k];
    if (shrubby && p[1] < 0.15) p[1] = 0.15 + rng.random() * 0.2;
    clusters.push({ p, r: rng.range(...S.clusterR) * Math.sqrt(scale) * 1.1, rnd: rng.random() });
  }
  if (species === 'pine') {
    // umbrella: squash clusters toward a flat-topped dome
    for (const c of clusters) {
      const dy = c.p[1] - cc[1];
      c.p[1] = cc[1] + (dy > 0 ? dy * 0.7 : dy * 0.85);
    }
  }

  const H = Math.max(cc[1] + crownH * 0.5, ...clusters.map((c) => c.p[1] + c.r));
  const R = crownW * 0.5;
  const crownCenter = cc;
  const bentAt = (p) => {
    const d = [(p[0] - crownCenter[0]) / (crownW * 0.5), (p[1] - crownCenter[1]) / (crownH * 0.5) + 0.15, (p[2] - crownCenter[2]) / (crownW * 0.5)];
    return v3.norm(d);
  };
  const depthAO = (p) => {
    const d = [(p[0] - crownCenter[0]) / (crownW * 0.5), (p[1] - crownCenter[1]) / (crownH * 0.5), (p[2] - crownCenter[2]) / (crownW * 0.5)];
    const l = v3.len(d);
    return clamp(0.25 + 0.75 * smoothstep(0.2, 1.0, l) * (0.7 + 0.3 * smoothstep(-1, 0.6, d[1])), 0.12, 1);
  };
  const sway = (p) => clamp(Math.hypot(p[0], p[2]) / (crownW * 0.5) * 0.6 + p[1] / H * 0.5, 0, 1);
  const patch = cellRect(S.patch, GRID, 0.08);

  // ------------------------------------------------------------------ geometry
  function emitWood(gb, maxDepth, radials, minR) {
    for (const b of branches) {
      if (b.depth > maxDepth) continue;
      if (b.rad[0] < minR) continue;
      const radial = radials[Math.min(radials.length - 1, b.depth)];
      // decimate points for lower LODs
      const step = radials[0] <= 5 ? 2 : 1;
      const pts = [], rad = [];
      for (let i = 0; i < b.pts.length; i += step) { pts.push(b.pts[i]); rad.push(b.rad[i]); }
      if (pts[pts.length - 1] !== b.pts[b.pts.length - 1]) { pts.push(b.pts[b.pts.length - 1]); rad.push(b.rad[b.rad.length - 1]); }
      addTube(gb, pts, rad, {
        radial, rect: patch, noise: nz, gnarl: b.depth === 0 ? S.gnarl * 0.45 : S.gnarl * 0.15, twist: S.twist, seed: b.pts.length,
        cap: b.depth > 0,
        fol: (t, p) => [clamp(0.45 + 0.55 * (b.depth === 0 ? 1 - smoothstep(trunkH * 0.7, trunkH + 1, p[1]) * 0.4 : depthAO(p)), 0.2, 1), 0, 0.5, sway(p)],
      });
    }
  }
  function emitCards(gb, rngC, perCluster, sizeK = 1, keep = 1) {
    for (const c of clusters) {
      if (keep < 1 && !rngC.chance(keep)) continue;
      const n = perCluster + (rngC.chance(0.4) ? 1 : 0);
      const bn = bentAt(c.p);
      for (let i = 0; i < n; i++) {
        // cards point outward-up from the cluster centre, random roll
        let up = v3.norm(v3.add(v3.mul(bn, 0.7), [rngC.range(-0.6, 0.6), rngC.range(0.2, 0.9), rngC.range(-0.6, 0.6)]));
        if (species === 'pine') up = v3.norm([up[0], Math.abs(up[1]) + 0.4, up[2]]);
        const side = rotAxis(perp(up), up, rngC.random() * Math.PI * 2);
        const sz = c.r * rngC.range(1.35, 1.85) * sizeK * (species === 'olive' ? 0.9 : 1);
        const o = v3.mad(v3.mad(c.p, up, -sz * 0.45), [rngC.range(-1, 1), rngC.range(-0.5, 0.5), rngC.range(-1, 1)], c.r * 0.25);
        const rect = cellRect(S.leafCells[Math.floor(rngC.random() * S.leafCells.length)], GRID, 0.0);
        const ao0 = depthAO(c.p);
        // lumpy lighting: each foliage cluster shades like a small sphere (lit top, dark underside)
        const lumpN = (p) => v3.norm(v3.add(v3.sub(p, c.p), v3.mul(bn, c.r * 0.35)));
        addCard(gb, o, up, side, sz * 0.92, sz, rect,
          (p) => v3.norm(v3.add(v3.add(v3.mul(bentAt(p), 0.6), v3.mul(lumpN(p), 0.65)), v3.mul(up, 0.1))),
          (p, t) => { const ln = lumpN(p); const lo = smoothstep(-0.7, 0.6, ln[1] * 0.8 + v3.dot(ln, bn) * 0.4); return [clamp(ao0 * (0.5 + 0.55 * lo) * (0.8 + 0.25 * t), 0.06, 1), t * smoothstep(0.3, 0.9, ao0) * lo, c.rnd, sway(p)]; },
          rngC.range(0.0, 0.18), rngC.chance(0.5));
      }
    }
  }
  function clusterBlobs(count) {
    // greedy merge of clusters into `count` blobs (k-means, few iterations)
    const pts = clusters.map((c) => c.p);
    if (pts.length <= count) return clusters.map((c) => ({ p: c.p, r: c.r * 1.25, rnd: c.rnd }));
    const r2 = new RNG('km' + seed + species + count);
    let cent = [];
    for (let i = 0; i < count; i++) cent.push(pts[Math.floor(r2.random() * pts.length)].slice());
    let assign = new Int32Array(pts.length);
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < pts.length; i++) {
        let best = 1e9, bi = 0;
        for (let k = 0; k < count; k++) { const d = v3.len(v3.sub(pts[i], cent[k])); if (d < best) { best = d; bi = k; } }
        assign[i] = bi;
      }
      const acc = cent.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < pts.length; i++) { const a = acc[assign[i]]; a[0] += pts[i][0]; a[1] += pts[i][1]; a[2] += pts[i][2]; a[3]++; }
      cent = acc.map((a, k) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : cent[k]));
    }
    const out = [];
    for (let k = 0; k < count; k++) {
      let rmax = 0, n = 0;
      for (let i = 0; i < pts.length; i++) if (assign[i] === k) { rmax = Math.max(rmax, v3.len(v3.sub(pts[i], cent[k])) + clusters[i].r * 0.8); n++; }
      if (!n) continue;
      out.push({ p: cent[k], r: Math.max(rmax * 0.85, S.clusterR[1] * scale), rnd: r2.random() });
    }
    return out;
  }
  function emitBlobs(gb, blobs, seg, inflate, rectSel) {
    for (const b of blobs) {
      const bn = bentAt(b.p);
      const ax = v3.norm([bn[0] * 0.3, 1, bn[2] * 0.3]);
      const b1 = perp(ax), b2 = v3.cross(ax, b1);
      const flat = S.flat;
      const ao0 = depthAO(b.p);
      addBlob(gb, b.p, ax, b1, b2, b.r * inflate * flat, b.r * inflate, b.r * inflate * 0.95, {
        lon: seg[0], lat: seg[1], rect: rectSel, pointy: 0, lump: 0.34, noise: nz, seed: b.rnd * 7,
        // (r5) clump normal weighted up: every clump keeps its own sunlit cap and shaded underside, so a
        // crown reads as a mosaic of lit pads at a distance instead of one smooth ball
        normalFn: (p, nl) => v3.norm(v3.add(v3.mul(nl, 0.68), v3.mul(bentAt(p), 0.55))),
        fol: (p, nl, ph) => {
          const out = v3.dot(nl, bentAt(p));
          return [clamp(ao0 * (0.45 + 0.55 * smoothstep(-0.6, 0.8, out)) * (0.7 + 0.3 * ph), 0.08, 1), smoothstep(0.5, 1, ph) * smoothstep(0, 0.9, out) * ao0, b.rnd, sway(p)];
        },
      });
    }
  }

  const lods = [];
  // LOD0
  {
    const bark = new GeoBuilder(), blob = new GeoBuilder(), card = new GeoBuilder();
    emitWood(bark, 9, shrubby ? [4, 3] : [11, 7, 5, 4, 3], 0.006);
    const rC = new RNG('cards' + seed + species);
    emitCards(card, rC, S.cards);
    if (S.inner > 0) {
      const inner = clusterBlobs(Math.max(4, Math.round(clusters.length * 0.18)));
      emitBlobs(blob, inner, [6, 4], 0.62 * S.inner + 0.15, patch);
    }
    lods.push({ bark: bark.build(), blob: blob.count ? blob.build() : null, card: card.build(), tris: bark.triangles + blob.triangles + card.triangles });
  }
  // LOD1
  {
    const bark = new GeoBuilder(), blob = new GeoBuilder(), card = new GeoBuilder();
    emitWood(bark, shrubby ? 0 : 1, [6, 4], 0.04);
    emitBlobs(blob, clusterBlobs(species === 'shrub' ? 7 : species === 'thicket' ? 22 : 30), [6, 4], 0.66, patch);
    // fewer, larger leaf cards keep a leafy, broken silhouette at mid range (the blobs are only the dark body)
    const rC = new RNG('cards1' + seed + species);
    emitCards(card, rC, 1, 1.4, species === 'pine' ? 0.8 : 1.0);
    lods.push({ bark: bark.count ? bark.build() : null, blob: blob.build(), card: card.build(), tris: bark.triangles + blob.triangles + card.triangles });
  }
  // LOD2 (≈ 10-40 px): a smaller dark core + big leaf cards on part of the clusters, so mid-range crowns
  // keep a broken, tufted silhouette with sunlit pads and dark gaps (not a smooth "cauliflower")
  {
    const bark = new GeoBuilder(), blob = new GeoBuilder(), card = new GeoBuilder();
    if (!shrubby) emitWood(bark, species === 'pine' ? 1 : 0, [5, 3], 0.06);
    // (r5) more, smaller clumps: every clump shades like a small sphere (sunlit cap, dark underside), so the
    // crown reads as a mosaic of lit pads and dark holes at 10-40 px instead of a few smooth lobes
    emitBlobs(blob, clusterBlobs(species === 'shrub' ? 5 : species === 'pine' ? 10 : species === 'thicket' ? 12 : 15), [5, 3], species === 'shrub' ? 0.95 : 0.7, patch);
    if (species !== 'shrub') emitCards(card, new RNG('cards2' + seed + species), 1, 1.75, species === 'thicket' ? 0.4 : species === 'olive' ? 0.55 : 0.5);
    lods.push({ bark: bark.count ? bark.build() : null, blob: blob.build(), card: card.count ? card.build() : null, tris: bark.triangles + blob.triangles + card.triangles });
  }
  // LOD3
  {
    const bark = new GeoBuilder(), blob = new GeoBuilder();
    if (species === 'pine') emitWood(bark, 0, [4], 0.1);
    emitBlobs(blob, clusterBlobs(species === 'shrub' ? 2 : species === 'thicket' ? 6 : 5), [4, 3], 1.25, patch);
    lods.push({ bark: bark.count ? bark.build() : null, blob: blob.build(), tris: bark.triangles + blob.triangles });
  }
  return { H, R, lods, clusters: clusters.length, branches: branches.length };
}
