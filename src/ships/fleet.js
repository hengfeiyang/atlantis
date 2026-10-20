// Ship placement + instanced meshes: the hero trireme (shot 2), fleets at sea (ref 1), in the canal (ref 2)
// and in the water rings (ref 5), triremes in the rock-cut ship-sheds (ref 4, slots from the rings plan),
// small boats along the quays; wakes registered with the water module (fallback: own foam decals).
// adapted from athenaion/src/city/fleet.js
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { buildTrireme, buildBoat, oarGeometry, oarMatrix } from './trireme.js';
import { shipWoodMaterial, sailMaterial, wakeFoamMaterial } from './mats.js';
import { GeoBuilder } from './geo.js';

const D2R = Math.PI / 180;
export const rotYOf = (heading) => L.headingToRotY(heading);
export const fwdOf = (heading) => [Math.sin(heading * D2R), -Math.cos(heading * D2R)];

/** world matrix for a ship at (x, y, z), compass heading (deg), heel (rad, + = to starboard), pitch (rad, + = bow up), scale */
export function shipMatrix(x, y, z, heading, heel = 0, pitch = 0, s = 1) {
  const m = new THREE.Matrix4().makeRotationY(rotYOf(heading));
  m.multiply(new THREE.Matrix4().makeRotationZ(-heel));
  m.multiply(new THREE.Matrix4().makeRotationX(-pitch));
  m.multiply(new THREE.Matrix4().makeScale(s, s, s));
  m.setPosition(x, y, z);
  return m;
}

// ------------------------------------------------------------------ instanced variants
export class Fleet {
  constructor(engine) { this.engine = engine; this.variants = new Map(); this.group = new THREE.Group(); this.group.name = 'ships-fleet'; this.count = 0; this.tris = 0; }
  variant(key, build) {
    let v = this.variants.get(key);
    if (!v) { const r = build(); v = { key, wood: r.wood.empty ? null : r.wood.toGeometry(), sail: r.sail && !r.sail.empty ? r.sail.toGeometry() : null, mats: [], dims: r.dims }; this.variants.set(key, v); }
    return v;
  }
  add(key, build, matrix) { const v = this.variant(key, build); v.mats.push(matrix.clone()); this.count++; return v; }
  /** r5: an instance that sails along its heading during the video segments (dispAt(t) → metres along fwd) */
  addMoving(key, build, matrix, fwd, speed, onMove) {
    const v = this.add(key, build, matrix);
    (this.movers ||= []).push({ v, i: v.mats.length - 1, base: matrix.clone(), fwd, speed, onMove, d: 0 });
    return v;
  }
  /** move the sailing instances to time t (dispAt(t, speed) → displacement along the heading, m) */
  update(t, dispAt) {
    if (!this.movers?.length) return;
    const dirty = new Set(), m = new THREE.Matrix4();
    for (const mv of this.movers) {
      const d = dispAt(t, mv.speed);
      if (d === mv.d) continue;
      mv.d = d; m.copy(mv.base); m.elements[12] += mv.fwd[0] * d; m.elements[14] += mv.fwd[1] * d;
      for (const im of mv.v.meshes || []) { im.setMatrixAt(mv.i, m); dirty.add(im); }
      mv.onMove?.(d);
    }
    for (const im of dirty) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
  }
  finalize() {
    const wm = shipWoodMaterial(), sm = sailMaterial();
    for (const v of this.variants.values()) {
      if (!v.mats.length) continue;
      for (const [geo, mat, nm] of [[v.wood, wm, 'wood'], [v.sail, sm, 'sail']]) {
        if (!geo) continue;
        const im = new THREE.InstancedMesh(geo, mat, v.mats.length);
        v.mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.name = `ships-${v.key}-${nm}`;
        (v.meshes ||= []).push(im);
        im.castShadow = true; im.receiveShadow = true;
        this.group.add(im);
        this.tris += (geo.index.count / 3) * v.mats.length;
      }
    }
    return this.group;
  }
}

// ------------------------------------------------------------------ wakes
/** registers a wake with the water module, or collects it for the fallback foam decals */
export class Wakes {
  constructor(engine) { this.engine = engine; this.list = []; }
  add(w) { this.list.push(w); }
  /** prioritise by distance to the shot cameras (the water shader takes a limited number) */
  commit(cams, max = 38) {
    const api = this.engine.registry.water?.addWake;
    const d = (w) => Math.min(...cams.map((c) => Math.hypot(c[0] - w.pos[0], c[2] - w.pos[1]) / (w.prio || 1)));
    const sorted = this.list.slice().sort((a, b) => d(a) - d(b));
    if (api) {
      let n = 0;
      for (const w of sorted) { if (n >= max) break; try { w.handle = api({ pos: w.pos, heading: w.heading, length: w.length, beam: w.beam, speed: w.speed, oars: !!w.oars, id: w.id, ...(w.trail ? { trail: w.trail, broken: w.broken ?? 0 } : {}) }); n++; } catch (e) { console.warn('[ships] addWake failed', e); break; } }
      return { mode: 'water-api', n };
    }
    // fallback: foam decal meshes (V wake + bow churn) on the golden sea surface
    const b = new GeoBuilder({ aWk: 4 });
    for (const w of sorted.slice(0, 120)) wakeDecal(b, w);
    if (b.empty) return { mode: 'none', n: 0 };
    const mesh = new THREE.Mesh(b.toGeometry(), wakeFoamMaterial());
    mesh.name = 'ships-wakes'; mesh.renderOrder = 3; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.userData.castShadow = false;
    this.engine.add(mesh, { castShadow: false });
    return { mode: 'decals', n: sorted.length };
  }
}
function wakeDecal(b, w) {
  const [fx, fz] = fwdOf(w.heading), sx = -fz, sz = fx; // starboard
  const [bx, bz] = w.pos, Lh = w.length, B = w.beam, st = Math.min(1, 0.35 + w.speed / 5);
  const len = Lh * (2.5 + w.speed * 0.5), n = 16;
  // V wake from the bow, widening astern
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const row = (t) => { const along = -t * (len + Lh * 0.2); const hw = B * 0.5 + 0.34 * t * len; return [[bx + fx * along - sx * hw, 0.04, bz + fz * along - sz * hw], [bx + fx * along + sx * hw, 0.04, bz + fz * along + sz * hw]]; };
    const r0 = row(t0), r1 = row(t1);
    b.quad(r0[0], r1[0], r1[1], r0[1], [0, 1, 0], { aWk: [[-1, t0, st, 0], [-1, t1, st, 0], [1, t1, st, 0], [1, t0, st, 0]] });
  }
  // bow churn collar along the hull
  const cl = Lh * 0.9;
  for (let i = 0; i < 6; i++) {
    const t0 = i / 6, t1 = (i + 1) / 6;
    const row = (t) => { const along = 1.5 - t * cl; const hw = B * (0.85 + 0.35 * t); return [[bx + fx * along - sx * hw, 0.05, bz + fz * along - sz * hw], [bx + fx * along + sx * hw, 0.05, bz + fz * along + sz * hw]]; };
    const r0 = row(t0), r1 = row(t1);
    b.quad(r0[0], r1[0], r1[1], r0[1], [0, 1, 0], { aWk: [[-1, t0, st, 1], [-1, t1, st, 1], [1, t1, st, 1], [1, t0, st, 1]] });
  }
}

// ------------------------------------------------------------------ helpers
const deepAt = (x, z, d = -2.5) => heightAt(x, z) < d;
/** is a ship footprint (length Lh along heading, half-width hw incl. oars) in open water? */
export function waterClear(x, z, heading, Lh = 40, hw = 8, depth = -2.5) {
  const [fx, fz] = fwdOf(heading), sx = -fz, sz = fx;
  for (const a of [-0.5, -0.25, 0, 0.25, 0.5]) for (const s of [-1, 0, 1]) {
    const px = x + fx * a * Lh + sx * s * hw, pz = z + fz * a * Lh + sz * s * hw;
    if (!deepAt(px, pz, depth)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ hero
/** the hero trireme for shot 2: full detail, animated oars, bobbing on the swell */
export function buildHero(engine, spec) {
  const det = 1;
  const r = buildTrireme({ seed: 0.137, detail: det, sailState: 'set', sailKind: 0, oarState: 'row', bakeOars: false, belly: 0.15 });
  const g = new THREE.Group(); g.name = 'ships-hero';
  const wood = new THREE.Mesh(r.wood.toGeometry(), shipWoodMaterial()); wood.name = 'ships-hero-wood';
  const sail = new THREE.Mesh(r.sail.toGeometry(), sailMaterial()); sail.name = 'ships-hero-sail';
  const oarGeo = oarGeometry(6);
  const oars = new THREE.InstancedMesh(oarGeo, shipWoodMaterial(), r.oars.length); oars.name = 'ships-hero-oars';
  g.add(wood, sail, oars);
  for (const m of [wood, sail, oars]) { m.castShadow = true; m.receiveShadow = true; }
  const m = new THREE.Matrix4();
  const strokeHz = 0.55;
  const setOars = (t) => {
    const ph = (spec.phase ?? 2.2) + t * Math.PI * 2 * strokeHz;
    r.oars.forEach((o, i) => oars.setMatrixAt(i, oarMatrix(o, ph + o.jit, 'row', m)));
    oars.instanceMatrix.needsUpdate = true;
    oars.computeBoundingSphere();
  };
  const [x0, , z0] = spec.pos;
  const [hfx, hfz] = fwdOf(spec.heading);
  const place = (t) => {
    // r5: the hero advances along its heading during its video segment (spec.dispAt(t) → metres; 0 in stills)
    const d = spec.dispAt ? spec.dispAt(t) : 0, x = x0 + hfx * d, z = z0 + hfz * d;
    spec.onMove?.(d);
    const wr = engine.registry.water;
    const y = wr?.surfaceHeight ? wr.surfaceHeight(x, z, t) - (wr.level || 0) : 0;
    g.position.set(x, (spec.pos[1] || 0) + y * 0.8 + 0.03 * Math.sin(t * 2 * Math.PI * strokeHz), z);
    g.rotation.set(0, rotYOf(spec.heading), 0, 'YXZ');
    g.rotateZ(-(spec.heel || 0) + 0.012 * Math.sin(t * 0.9));
    g.rotateX(-(spec.pitch || 0) + 0.008 * Math.sin(t * 1.3 + 1));
    if (spec.lengthScale) g.scale.set(1, 1, spec.lengthScale);
  };
  setOars(0); place(0);
  engine.onUpdate((t) => { setOars(t); place(t); });
  const tris = (wood.geometry.index.count + sail.geometry.index.count) / 3 + (oarGeo.index.count / 3) * r.oars.length;
  return { group: g, tris, dims: r.dims };
}

// ------------------------------------------------------------------ variant builders
export const V = {
  sailRow: () => buildTrireme({ seed: 0.61, detail: 0.55, sailState: 'set', sailKind: 0, oarState: 'row', phase: 2.0 }),
  sailRowB: () => buildTrireme({ seed: 0.29, detail: 0.55, sailState: 'set', sailKind: 0, oarState: 'row', phase: 0.6, belly: 0.14 }),
  sailOnly: () => buildTrireme({ seed: 0.83, detail: 0.55, sailState: 'set', sailKind: 0, oarState: 'rest', belly: 0.15 }),
  row: () => buildTrireme({ seed: 0.47, detail: 0.55, sailState: 'furled', oarState: 'row', phase: 1.4 }),
  moored: () => buildTrireme({ seed: 0.53, detail: 0.5, sailState: 'furled', oarState: 'raised', crew: true }),
  // r6 (ref 5): shot-5 ring triremes, yard braced −0.5 rad (sail normal ≈ 29° to starboard of the heading)
  braced5a: () => buildTrireme({ seed: 0.61, detail: 0.75, sailState: 'set', sailKind: 0, oarState: 'row', phase: 2.0, belly: 0.17, yardYaw: -0.5, mastH: 15.5, yardW: 17, sailH: 11.5 }),
  braced5b: () => buildTrireme({ seed: 0.29, detail: 0.75, sailState: 'set', sailKind: 0, oarState: 'row', phase: 0.6, belly: 0.18, yardYaw: -0.55, mastH: 15, yardW: 16.5, sailH: 11 }),
  // r6 (ref 1): the sea fleet carries bigger rigs (the ref's sails are ≈ as tall as the hull is long from 1.4 km)
  seaA: () => buildTrireme({ seed: 0.61, detail: 0.55, sailState: 'set', sailKind: 0, oarState: 'row', phase: 2.0, belly: 0.16, mastH: 14.5, yardW: 16.5, sailH: 11 }),
  seaB: () => buildTrireme({ seed: 0.29, detail: 0.55, sailState: 'set', sailKind: 1, oarState: 'row', phase: 0.6, belly: 0.17, mastH: 14, yardW: 16, sailH: 10.5 }),
  seaOnly: () => buildTrireme({ seed: 0.83, detail: 0.55, sailState: 'set', sailKind: 0, oarState: 'rest', belly: 0.18, mastH: 14.5, yardW: 16.5, sailH: 11 }),
  far: () => buildTrireme({ seed: 0.71, detail: 0.2, sailState: 'set', sailKind: 0, oarState: 'row', phase: 2.4, crew: false }),
  shed: () => buildTrireme({ seed: 0.91, detail: 0.5, sailState: 'loose', sailKind: 5, oarState: 'shed', crew: false, yardW: 8.6, sailH: 4.2, mastH: 4.6, mastZ: 8.5, pennant: false }),
  boatSail: () => buildBoat({ type: 'boat', seed: 0.21, sailState: 'set', sailKind: 1 }),
  boatSailB: () => buildBoat({ type: 'boat', seed: 0.66, sailState: 'set', sailKind: 0 }),
  boat: () => buildBoat({ type: 'boat', seed: 0.43, sailState: 'furled' }),
  boatOpen: () => buildBoat({ type: 'boat', seed: 0.77, sailState: 'none' }),
  merchant: () => buildBoat({ type: 'merchant', seed: 0.35, sailState: 'set', sailKind: 1 }),
  merchantStr: () => buildBoat({ type: 'merchant', seed: 0.58, sailState: 'set', sailKind: 2 }),
};
