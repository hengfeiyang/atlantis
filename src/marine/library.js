// Species library: geometry variants per species (built lazily, scaled with quality.detail) and instancing
// pools. Producers call lib.place(species, pos, normal, scale, yaw, rgb) any number of times; finalize()
// creates one InstancedMesh per (species, variant) with per-instance colour.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import * as C from './corals.js';
import { kelpClump, algaeColumn, fanAtlas, kelpAtlas } from './kelp.js';
import { coralMaterial, tissueMaterial, fanMaterial, swayDepthMaterial } from './materials.js';

const V = THREE.Vector3;
const UP = new V(0, 1, 0);

export class ReefLibrary {
  constructor(engine) {
    this.engine = engine;
    const q = engine.quality;
    this.detail = q.detail ?? 1;
    this.rng = new RNG('marine:lib');
    this.pools = new Map(); // species → {variants:[geo], mat, depth, items:[[m4, rgb, v]]}
    this.atlas = null;
    const D = this.detail;
    const det = (lo) => (lo === 'mid' ? Math.min(D, 0.5) : lo ? 0.2 : D);
    const S = {
      brain: { n: 4, gen: (r, i, lo) => C.brainCoral(r, { r: 0.5, detail: det(lo) }), mat: () => coralMaterial('brain', { rough: 0.8, sway: false }), pal: C.PALETTES.brain },
      table: { n: 3, gen: (r, i, lo) => C.tableCoral(r, { R: 0.7, tiers: 1 + (i % 2), detail: det(lo) }), mat: () => coralMaterial('polyp', { rough: 0.8, sway: false }), pal: C.PALETTES.table },
      whorl: { n: 4, gen: (r, i, lo) => C.whorlCoral(r, { R: 0.45, plates: r.int(5, 8), detail: det(lo) }), mat: () => coralMaterial('polyp', { rough: 0.75, sway: false }), pal: C.PALETTES.whorl },
      finger: { n: 4, gen: (r, i, lo) => C.fingerCoral(r, { R: 0.3, detail: det(lo) }), mat: () => coralMaterial('polyp', { rough: 0.8, sway: false }), pal: C.PALETTES.finger },
      staghorn: { n: 4, gen: (r, i, lo) => C.branchingCoral(r, 'staghorn', { detail: det(lo) }), mat: () => coralMaterial('polyp', { rough: 0.78, sway: false }), pal: C.PALETTES.staghorn },
      bush: { n: 4, gen: (r, i, lo) => C.branchingCoral(r, 'bush', { detail: det(lo) }), mat: () => coralMaterial('polyp', { rough: 0.8, sway: false }), pal: C.PALETTES.bush },
      softtree: { n: 4, gen: (r, i, lo) => C.branchingCoral(r, 'softtree', { detail: det(lo) }), mat: () => coralMaterial('soft', { rough: 0.7, translucent: true, sway: true }), pal: C.PALETTES.softtree, sway: true },
      whip: { n: 3, gen: (r, i, lo) => C.branchingCoral(r, 'whip', { detail: det(lo) }), mat: () => coralMaterial('soft', { rough: 0.7, translucent: true, sway: true }), pal: C.PALETTES.whip, sway: true },
      tube: { n: 4, gen: (r, i, lo) => C.tubeSponge(r, { n: 5, detail: det(lo) }), mat: () => coralMaterial('sponge', { rough: 0.85, sway: false }), pal: C.PALETTES.tube },
      barrel: { n: 2, gen: (r, i, lo) => C.barrelSponge(r, { R: 0.45, detail: det(lo) }), mat: () => coralMaterial('sponge', { rough: 0.88, sway: false }), pal: C.PALETTES.barrel },
      lump: { n: 4, gen: (r, i, lo) => C.lumpCoral(r, { r: 0.25, detail: det(lo) }), mat: () => coralMaterial('sponge', { rough: 0.85, sway: false }), pal: C.PALETTES.lump },
      anemone: { n: 3, gen: (r, i, lo) => C.anemone(r, { r: 0.1, detail: det(lo) }), mat: () => coralMaterial('soft', { rough: 0.6, translucent: true, sway: true }), pal: C.PALETTES.anemone, sway: true },
      urchin: { n: 2, gen: (r, i, lo) => C.urchin(r, { detail: det(lo) }), mat: () => coralMaterial('plain', { rough: 0.6, sway: false }), pal: C.PALETTES.urchin },
      fan: { n: 4, gen: (r, i, lo) => C.seaFan(r, { cell: this._atlas().cells[i % 4], w: 1.0, h: 1.0, detail: det(lo) }), mat: () => fanMaterial(this._atlas().tex), pal: C.PALETTES.fan, sway: true, depthMap: true, noShadowRecv: false },
      grass: { n: 4, gen: (r, i, lo) => C.grassTuft(r, { blades: Math.round((lo ? 8 : 16) * Math.max(0.6, D)), height: 0.42, radius: 0.1, width: 0.017, detail: det(lo) }), mat: () => tissueMaterial('grass', { rough: 0.6, trans: 0.9 }), pal: null, sway: true, cast: false },
      kelp: { n: 6, gen: (r, i, lo) => kelpClump(r, { H: [62, 52, 44, 36, 28, 20][i], stipes: lo ? r.int(3, 4) : r.int(8, 12), spacing: lo ? 0.6 : 0.26, detail: lo ? 0.3 : D, widthK: lo ? 1.7 : 1 }), mat: () => tissueMaterial('kelp', { rough: 0.5, trans: 1.0, map: this._kelpTex() }), pal: null, kelp: true, depthTex: () => this._kelpTex() },
      column: { n: 3, gen: (r, i, lo) => algaeColumn(r, { H: [9, 7, 5.5][i], R: [1.2, 1.0, 0.8][i], detail: det(lo) }), mat: () => tissueMaterial('kelp', { rough: 0.6, trans: 0.7, map: this._kelpTex() }), pal: null, kelp: true, depthTex: () => this._kelpTex() },
    };
    this.species = S;
  }
  _kelpTex() { if (!this.kelpTex) this.kelpTex = kelpAtlas(new RNG('marine:kelpatlas'), 1024, 1024); return this.kelpTex; }
  _atlas() { if (!this.atlas) this.atlas = fanAtlas(new RNG('marine:fans'), this.detail >= 0.9 ? 2048 : 1024); return this.atlas; }
  /** palette colour with soft per-instance variation (hue drift, desaturation, value) */
  pal(species, rng) {
    const p = this.species[species].pal;
    if (!p) return [1, 1, 1];
    const a = p[Math.floor(rng.random() * p.length)], b = p[Math.floor(rng.random() * p.length)];
    const c = new THREE.Color(a[0], a[1], a[2]).lerp(new THREE.Color(b[0], b[1], b[2]), rng.random() < 0.3 ? rng.range(0.2, 0.5) : 0);
    const hsl = {}; c.getHSL(hsl);
    hsl.h = (hsl.h + rng.range(-0.03, 0.03) + 1) % 1;
    hsl.s = Math.min(1, hsl.s * rng.range(0.78, 1.02)); // r3 (look-sunken): richer reef colours (ref 6 / 8)
    hsl.l *= rng.range(0.72, 1.06);
    c.setHSL(hsl.h, hsl.s, hsl.l);
    return [c.r, c.g, c.b];
  }
  _pool(species) {
    let P = this.pools.get(species);
    if (!P) { P = { items: [] }; this.pools.set(species, P); }
    return P;
  }
  /**
   * record one instance. pos [x,y,z] | Vector3, normal Vector3 (growth axis), scale number | [sx,sy,sz],
   * yaw (rad about the normal), rgb linear tint (null → species palette), variant (null → random)
   */
  place(species, pos, normal, scale, yaw, rgb = null, variant = null, rng = this.rng, lo = false) {
    const S = this.species[species];
    if (!S) throw new Error('unknown marine species ' + species);
    const v = variant ?? Math.floor(rng.random() * S.n);
    const p = pos.isVector3 ? pos : new V(pos[0], pos[1], pos[2]);
    if (this.filter) {
      const k = this.filter(species, p, normal || UP, scale, v, this.tag || '');
      if (!(k > 0)) return false;
      if (k < 1) scale = Array.isArray(scale) ? scale.map((x) => x * k) : scale * k;
    }
    const q = new THREE.Quaternion().setFromUnitVectors(UP, normal || UP);
    const qy = new THREE.Quaternion().setFromAxisAngle(UP, yaw || 0);
    q.multiply(qy);
    const s = Array.isArray(scale) ? new V(...scale) : new V(scale, scale, scale);
    const m = new THREE.Matrix4().compose(p, q, s);
    const col = rgb || this.pal(species, rng);
    this._pool(lo === 'mid' ? species + ':mid' : lo ? species + ':lo' : species).items.push([m, col, v, this.w ?? 1, this.tag || '']);   // r6: [4] = placement tag (path clearance post-filter)
    return true;
  }
  count() { let n = 0; for (const P of this.pools.values()) n += P.items.length; return n; }
  /**
   * build InstancedMeshes; thins the low-detail (far) instances so the module stays within `budget` triangles.
   * returns {meshes, tris, instances, bySpecies}
   */
  finalize(root, budget = Infinity) {
    const out = { meshes: [], tris: 0, instances: 0, bySpecies: {}, thinned: 1 };
    const groups = [];
    for (const [key, P] of this.pools) {
      if (!P.items.length) continue;
      const mid = key.endsWith(':mid'), lo = key.endsWith(':lo') || mid, species = mid ? key.slice(0, -4) : lo ? key.slice(0, -3) : key;
      const S = this.species[species];
      const byVar = new Map();
      for (const it of P.items) { if (!byVar.has(it[2])) byVar.set(it[2], []); byVar.get(it[2]).push(it); }
      for (const [vi, items] of byVar) {
        const geo = S.gen(new RNG(`marine:${species}:${vi}:${mid ? 'mid' : lo ? 'lo' : 'hi'}`), vi, mid ? 'mid' : lo);
        const per = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        groups.push({ key, species, lo, vi, items, geo, per, S });
      }
    }
    const sum = (f) => groups.filter(f).reduce((a, g) => a + g.per * g.items.length, 0);
    const hiT = sum((g) => !g.lo), loT = sum((g) => g.lo);
    let fLo = 1, fHi = 1;
    if (hiT + loT > budget) {
      fLo = Math.max(0.05, (budget - hiT) / Math.max(1, loT));
      if (budget - hiT < loT * 0.05) fHi = Math.max(0.2, (budget - loT * 0.05) / Math.max(1, hiT));
    }
    out.thinned = +fLo.toFixed(3); out.thinnedHi = +fHi.toFixed(3);
    const mats = new Map();
    for (const g of groups) {
      const f = g.lo ? fLo : fHi;
      // thinning: keep the instances closest to the cameras (highest density weight) first
      const items = f >= 1 ? g.items : g.items.slice().sort((a, b) => b[3] - a[3]).slice(0, Math.round(g.items.length * f));
      if (!items.length) continue;
      if (!mats.has(g.species)) mats.set(g.species, g.S.mat());
      const mesh = new THREE.InstancedMesh(g.geo, mats.get(g.species), items.length);
      mesh.name = `marine-${g.species}-${g.vi}${g.key.endsWith(':mid') ? '-mid' : g.lo ? '-lo' : ''}`;
      const c = new THREE.Color();
      items.forEach((it, i) => { mesh.setMatrixAt(i, it[0]); mesh.setColorAt(i, c.setRGB(it[1][0], it[1][1], it[1][2])); });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      const cast = g.S.cast !== false && !(g.lo && !g.S.kelp);
      mesh.castShadow = cast; mesh.receiveShadow = true;
      mesh.userData.castShadow = cast; mesh.userData.receiveShadow = true;
      if (cast && (g.S.sway || g.S.kelp)) mesh.customDepthMaterial = swayDepthMaterial(g.S.kelp ? 'kelp' : 'sway', g.S.depthMap ? this._atlas().tex : g.S.depthTex ? g.S.depthTex() : null);
      root.add(mesh);
      out.meshes.push(mesh);
      const t = g.per * items.length;
      out.tris += t; out.instances += items.length;
      const b = (out.bySpecies[g.key] ||= { n: 0, mtris: 0 });
      b.n += items.length; b.mtris = +(b.mtris + t / 1e6).toFixed(2);
    }
    return out;
  }
}
