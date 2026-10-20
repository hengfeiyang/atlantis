// Building: collects geometry per material (merged), instanced parts (columns, drums …), AO
// occluders and semantic info (pediments, metopes, banner/statue slots), then finalises into a
// THREE.Group placed in the world, with its own AO volume and materials.
import * as THREE from 'three';
import { MeshBuilder } from './geom.js';
import { AOVolume } from './ao.js';
import { marbleMaterial } from '../materials/marble.js';
import { goldMaterial, bronzeMaterial, patinaBronzeMaterial } from '../materials/metal.js';

export class Building {
  /**
   * @param {string} name
   * @param {object} [o] { detail (0..1), seed, variant: marble variant, tint, gilding (0..1) }
   */
  constructor(name, o = {}) {
    this.name = name;
    this.detail = o.detail ?? 1;
    this.seed = o.seed ?? 0;
    this.variant = o.variant || 'weathered';
    this.tint = o.tint;
    this.roofTint = o.roofTint;
    this.marbleOverrides = o.overrides;
    this.interiorDark = o.interiorDark;   // (r5) darker porch / cella skins for far buildings (colonnades read from afar)
    this.mb = { marble: new MeshBuilder(), gold: new MeshBuilder(), bronze: new MeshBuilder(), patina: new MeshBuilder(), interior: new MeshBuilder(), roof: new MeshBuilder(), dome: new MeshBuilder(), gilt: new MeshBuilder() };
    this.inst = new Map();
    this.occ = [];
    this.info = { pediments: [], metopes: [], banners: [], statues: [], braziers: [], urns: [], ivy: [], anchors: {} };
  }
  get marble() { return this.mb.marble; }
  get gold() { return this.mb.gold; }
  get bronze() { return this.mb.bronze; }
  /** add an instance of a shared geometry. key groups instances into one InstancedMesh. */
  addInstance(key, geometry, matrix, matKey = 'marble') {
    let e = this.inst.get(key);
    if (!e) { e = { geometry, matKey, matrices: [] }; this.inst.set(key, e); }
    e.matrices.push(matrix.clone());
  }
  occBox(min, max) { this.occ.push(['box', min, max]); }
  occCyl(cx, cz, r, y0, y1) { this.occ.push(['cyl', cx, cz, r, y0, y1]); }
  occFn(min, max, fn) { this.occ.push(['fn', min, max, fn]); }

  /**
   * Build the THREE.Group.
   * @param {object} o { position: [x,y,z], rotY, ao: true|false, aoCell, aoRays, engine }
   */
  finalize(o = {}) {
    const t0 = performance.now();
    const pos = new THREE.Vector3(...(o.position || [0, 0, 0]));
    const rotY = o.rotY || 0;
    const group = new THREE.Group();
    group.name = this.name;
    group.position.copy(pos);
    group.rotation.y = rotY;
    // ---- AO volume
    let ao = null;
    if (o.ao !== false && this.occ.length) {
      const bb = new THREE.Box3();
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const mb of Object.values(this.mb)) {
        const a = mb.P.array;
        for (let i = 0; i < a.length; i += 3) for (let c = 0; c < 3; c++) { const v = a[i + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
      }
      if (lo[0] < Infinity) bb.set(new THREE.Vector3(...lo), new THREE.Vector3(...hi));
      for (const e of this.inst.values()) {
        e.geometry.computeBoundingBox();
        for (const m of e.matrices) bb.union(e.geometry.boundingBox.clone().applyMatrix4(m));
      }
      const margin = 3;
      const cell = o.aoCell ?? 0.6;
      ao = new AOVolume({ min: [bb.min.x - margin, bb.min.y - 1, bb.min.z - margin], max: [bb.max.x + margin, bb.max.y + 2, bb.max.z + margin], cell });
      for (const op of this.occ) {
        if (op[0] === 'box') ao.addBox(op[1], op[2]);
        else if (op[0] === 'cyl') ao.addCylinder(op[1], op[2], op[3], op[4], op[5]);
        else ao.addFn(op[1], op[2], op[3]);
      }
      ao.setPlacement(pos, rotY);
      ao.compute({ rays: o.aoRays ?? 40, maxDist: o.aoDist ?? 16, nearCells: 4 });
    }
    this.ao = ao;
    // ---- materials
    const mats = {
      marble: () => marbleMaterial({ variant: this.variant, tint: this.tint, ao, seed: this.seed, overrides: this.marbleOverrides }),
      interior: () => marbleMaterial({ variant: 'interior', tint: this.tint, ao, seed: this.seed, overrides: this.interiorDark != null ? { dark: this.interiorDark } : undefined }),
      roof: () => marbleMaterial({ variant: 'weathered', tint: this.roofTint ?? 0xddd5ca, ao, seed: this.seed + 3, overrides: { lichen: 1.0, streaks: 0.5, weather: 1.0, rough: 0.7 } }),
      gold: () => goldMaterial({ ao }),
      bronze: () => bronzeMaterial({ ao }),
      patina: () => patinaBronzeMaterial({ ao }),
      gilt: () => goldMaterial({ ao, color: new THREE.Color(0.66, 0.50, 0.26), dark: new THREE.Color(0.24, 0.17, 0.08), roughness: 0.5, wear: 0.75 }),
      dome: () => bronzeMaterial({ ao, color: new THREE.Color(0.40, 0.25, 0.11), dark: new THREE.Color(0.10, 0.06, 0.03), roughness: 0.42, wear: 0.6 }),
    };
    const matCache = {};
    const getMat = (k) => (matCache[k] ||= (mats[k] || mats.marble)());
    let tris = 0;
    for (const [k, mb] of Object.entries(this.mb)) {
      if (mb.empty) continue;
      const mesh = new THREE.Mesh(mb.geometry(), getMat(k));
      mesh.name = `${this.name}:${k}`;
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
      tris += mb.triangles;
    }
    for (const [key, e] of this.inst) {
      const im = new THREE.InstancedMesh(e.geometry, getMat(e.matKey), e.matrices.length);
      e.matrices.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.name = `${this.name}:${key}`;
      im.castShadow = true; im.receiveShadow = true;
      group.add(im);
      tris += (e.geometry.index ? e.geometry.index.count / 3 : e.geometry.attributes.position.count / 3) * e.matrices.length;
    }
    group.updateMatrixWorld(true);
    this.group = group;
    this.triangles = tris;
    this.materials = matCache;
    this.buildMs = Math.round(performance.now() - t0);
    // ---- world-space info
    const M = group.matrixWorld;
    const R = new THREE.Matrix3().setFromMatrix4(M);
    const P = (p) => new THREE.Vector3(...p).applyMatrix4(M).toArray().map((v) => +v.toFixed(4));
    const Dd = (d) => new THREE.Vector3(...d).applyMatrix3(R).normalize().toArray().map((v) => +v.toFixed(5));
    const heading = (d) => { const w = new THREE.Vector3(...d).applyMatrix3(R); return ((Math.atan2(w.x, -w.z) * 180) / Math.PI + 360) % 360; };
    const I = this.info;
    this.world = {
      pediments: I.pediments.map((p) => ({ ...p, origin: P(p.origin), right: Dd(p.right), up: Dd(p.up), normal: Dd(p.normal), building: this.name })),
      metopes: I.metopes.map((m) => ({ ...m, center: P(m.center), right: Dd(m.right), up: Dd(m.up), normal: Dd(m.normal), building: this.name })),
      banners: I.banners.map((b) => ({ ...b, pos: P(b.pos), facing: heading(b.dir), building: this.name })),
      statues: I.statues.map((b) => ({ ...b, pos: P(b.pos), facing: heading(b.dir), building: this.name })),
      braziers: I.braziers.map((b) => ({ ...b, pos: P(b.pos), facing: heading(b.dir || [0, 0, 1]), building: this.name })),
      urns: I.urns.map((b) => ({ ...b, pos: P(b.pos), facing: heading(b.dir || [0, 0, 1]), building: this.name })),
      ivy: I.ivy.map((b) => ({ ...b, pos: P(b.pos), facing: heading(b.dir || [0, 0, 1]), building: this.name })),
    };
    return group;
  }

  /** push the world-space slots into engine.slots */
  publishSlots(engine) {
    if (!engine || !this.world) return;
    const S = engine.slots;
    const push = (k, arr) => { if (!S[k]) S[k] = []; for (const a of arr) S[k].push(a); };
    push('banner', this.world.banners);
    push('statue', this.world.statues);
    push('brazier', this.world.braziers);
    push('urn', this.world.urns);
    push('ivy', this.world.ivy);
  }
}
