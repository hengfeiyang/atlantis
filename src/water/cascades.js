// Cascades of the citadel hill (golden era, refs 1, 2, 4, 5). OWNER: water.
// adapted from athenaion/src/modules/waterfalls.js (traced sheets + strands + mist + churn)
//
// Water from the two springs and the plateau cisterns runs down the hill in white ribbons: over the
// rocky slopes between the ledges, across the ledges, down to the quay band behind the orichalcum
// wall, then pours out of spouts under the wall parapet into water ring 1.
//   planCascades()       → specs (layout-derived, deterministic)
//   traceCascades()      → traced falls on a ground sampler (terrain only at build time: footprints)
//   buildCascadeMeshes() → sheet / strand mesh, mist, churn (after the architecture exists)
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { SUN } from '../core/lighting.js';
import { ATMO } from '../core/atmosphere.js';
import { SKY } from '../core/sky.js';
import { traceFall, fallCorridor } from './trace.js';
import { buildSheet, buildStrands, createFallMaterial, mergeAll } from './fallMesh.js';
import { MistSystem } from './mist.js';
import { createChurn } from './churn.js';
import { SHOTS } from '../world/shots.js';
import { molePlan } from '../rings/mole.js';

// hill falls: bearing (deg), width (m), flow (0..1), start: 'plateau' | 'ledge1' | 'ledge2'
// (keep clear of the grand stair at 180 and of the w1 bridges at 0 / 90 / 270)
const HILL = [
  // r3: the citadel is 62 m tall with a sheer 20 m plateau cliff (red rampart band) + two 48-50° rock slopes:
  // refs 1, 4, 5 show MANY falls — wide white curtains off the plateau rim, narrower ribbons from the ledges.
  // South half (shots 1, 2, 4, 5) densest; the stair (180 ± ~12° at the rim) and the w1 bridges (0/90/270) stay clear.
  { b: 158, w: 14, flow: 1.0, start: 'plateau', spring: 'cold' },
  { b: 202, w: 14, flow: 1.0, start: 'plateau', spring: 'hot' },
  { b: 141, w: 9, flow: 0.9, start: 'plateau' },
  { b: 219, w: 9, flow: 0.9, start: 'plateau' },
  { b: 130, w: 5, flow: 0.7, start: 'ledge1' },
  { b: 230, w: 5, flow: 0.7, start: 'ledge1' },
  { b: 113, w: 10, flow: 0.95, start: 'plateau' },
  { b: 247, w: 10, flow: 0.95, start: 'plateau' },
  { b: 101, w: 3, flow: 0.55, start: 'ledge2' },
  { b: 259, w: 3, flow: 0.55, start: 'ledge2' },
  { b: 171, w: 2.5, flow: 0.5, start: 'ledge2' },
  { b: 189, w: 2.5, flow: 0.5, start: 'ledge2' },
  { b: 72, w: 6, flow: 0.8, start: 'plateau' },
  { b: 288, w: 6, flow: 0.8, start: 'plateau' },
  { b: 57, w: 3, flow: 0.55, start: 'ledge1' },
  { b: 303, w: 3, flow: 0.55, start: 'ledge1' },
  { b: 40, w: 8, flow: 0.9, start: 'plateau' },
  { b: 320, w: 8, flow: 0.9, start: 'plateau' },
  { b: 22, w: 3, flow: 0.55, start: 'ledge2' },
  { b: 338, w: 3, flow: 0.55, start: 'ledge2' },
];

/** where the wall spouts are (published for the rings agent: notch / lion-head spout in the parapet) */
export const SPOUT_R = L.CITADEL.wall.r + 2.2;
export const SPOUT_Y = L.CITADEL.quayY + L.CITADEL.wall.height - 1.6;

/** tier-1 rampart face radius (temple.js rampartPlan(): rOut = terraces[0].r0 + 1.6) and the outlet sill height
 *  (≈ 13.5 m above ledge 1, under the string course / cornice of the 20 m red wall) */
export const RAMPART_FACE_R = L.CITADEL.terraces[0].r0 + 1.6;
export const OUTLET_Y = L.CITADEL.terraces[0].y + 13.5;

export function planCascades() {
  const C = L.CITADEL, [t1, t2] = C.terraces;
  const specs = [];
  // r4 (arch-a): keep every fall + spout clear of the shed-mole bridge landing on the citadel quay (its gate tower straddles
  // the curtain at registry.rings.gates[mole]): a fall whose pour would touch the gate block moves away from it
  let gate = null;
  try { gate = molePlan()?.gate || null; } catch (e) { gate = null; }
  const clearOf = (b, w) => {
    if (!gate) return b;
    const r = L.CITADEL.wall.r, d = ((b - gate.bearing + 540) % 360) - 180;
    const need = ((gate.half + 6 + w * 0.5 + 4) / r) * (180 / Math.PI);   // gate half + tower + half pour + margin (deg)
    return Math.abs(d) >= need ? b : gate.bearing + Math.sign(d || 1) * need;
  };
  for (const h0 of HILL) {
    const h = { ...h0, b: clearOf(h0.b, h0.w) };
    if (h.start === 'plateau') {
      // r3: the plateau falls pour out of arched OUTLETS in the red tier-1 rampart face (citadel agent: the red band stays
      // continuous, ref 5) — `outlet` = the opening the temple module cuts: { r (face), y (sill), width, height }
      const [x, z] = L.polar(RAMPART_FACE_R + 0.35, h.b);
      const outlet = { r: RAMPART_FACE_R, y: OUTLET_Y, width: h.w + 1.2, height: 3.2 + 0.15 * h.w };
      specs.push({
        id: `hill-${h.b}`, from: [x, OUTLET_Y + 0.25, z], dir: h.b, width: h.w, flow: h.flow, kind: 'hill', bearing: h.b, spring: h.spring, maxRun: 160,
        snap: false, v0: 2.0 + 1.6 * h.flow, fan: 0.2, widen: 0.15, widenDrop: 10, aer: 0.35, outlet,
      });
    } else {
      const r0 = h.start === 'ledge1' ? t1.r1 - 6 : t2.r1 - 4;
      const y0 = h.start === 'ledge1' ? t1.y : t2.y;
      const [x, z] = L.polar(r0, h.b);
      specs.push({ id: `hill-${h.b}`, from: [x, y0, z], dir: h.b, width: h.w, flow: h.flow, kind: 'hill', bearing: h.b, spring: h.spring, maxRun: 160 });
    }
    // the wall spout below it (wider pour, white from the lip)
    const [sx, sz] = L.polar(SPOUT_R, h.b);
    const sw = Math.min(12, h.w * 0.9 + 1.0);
    specs.push({
      id: `spout-${h.b}`, from: [sx, SPOUT_Y, sz], dir: h.b, width: sw, flow: Math.min(1, h.flow + 0.1), snap: false,
      v0: 2.4 + 1.2 * h.flow, fan: 0.25, widen: 0.25, widenDrop: 8, aer: 0.9, kind: 'spout', bearing: h.b,
    });
  }
  return specs;
}

/** trace every spec; returns falls (with .impact for the ones reaching the water) */
export function traceCascades(engine, ground, specs, level = 0) {
  const falls = [];
  for (const spec of specs) {
    try {
      const f = traceFall(ground, { ...spec, lipJitter: spec.kind === 'hill' && spec.snap !== false ? 0.4 : 0.15 }, engine.rng('casc:' + spec.id), {
        level, tMax: spec.kind === 'spout' ? 8 : 60, sMax: spec.kind === 'spout' ? 40 : 260,
      });
      f.id = spec.id; f.spec = spec; f.kind = spec.kind;
      if (spec.kind === 'spout' && f.drop < 1.5) continue;
      falls.push(f);
    } catch (e) { console.warn('[water] cascade trace failed', spec.id, e.message); }
  }
  return falls;
}

export function cascadeFootprints(engine, falls) {
  for (const f of falls) {
    if (f.kind !== 'hill') continue;
    engine.footprints.addPath(fallCorridor(f), f.width * 0.5 + 1.5, 'waterfall');
  }
}

/** sheets + strands + mist + churn for traced falls; returns { group, update(t), sync(), tris, puffs } */
export function buildCascadeMeshes(engine, falls, { maps, ground, shadowMap = null, level = 0 }) {
  const q = engine.quality;
  const detail = q.detail ?? 1, density = q.density ?? 1;
  const geos = [];
  const mist = new MistSystem(engine, maps);
  let tris = 0;
  for (const f of falls) {
    const rng = engine.rng('casc-geo:' + f.id);
    const sheet = buildSheet(f, ground, rng, { spacing: detail >= 1 ? 0.55 : 0.9 });
    geos.push(...sheet.geos); tris += sheet.tris;
    const front = buildSheet(f, ground, rng, { spacing: detail >= 1 ? 0.8 : 1.3, front: 0.6 + rng.range(0, 0.5), seed: rng.random() });
    geos.push(...front.geos); tris += front.tris;
    const nStrands = Math.round((1 + f.width * 0.25) * (0.6 + 0.4 * detail));
    for (const g of buildStrands(f, ground, rng, nStrands, { spacing: detail >= 1 ? 0.8 : 1.3 })) { geos.push(g); tris += g.index.count / 3; }
    const fp = f.impact ? [f.impact.x, level, f.impact.z] : [f.lip.x, f.lip.y, f.lip.z];
    let dCam = Infinity;
    for (const sh of SHOTS) if (sh.era === 'golden') dCam = Math.min(dCam, Math.hypot(sh.pos[0] - fp[0], sh.pos[1] - fp[1], sh.pos[2] - fp[2]));
    addMist(mist, f, rng, density, level, Math.max(0.35, Math.min(1, 300 / dCam)));
  }
  const group = new THREE.Group();
  group.name = 'cascades';
  const fm = createFallMaterial({ hTex: (shadowMap || maps.near).tex, hBounds: (shadowMap || maps.near).bounds });
  fm.material.userData.sunken = 'none';
  fm.uniforms.uDebug.value = Number(engine.params?.get?.('wfDebug') || 0);
  // r4: guard — a degenerate trace (zero-length segment) must never put NaN vertices into the merged sheet mesh
  let dropped = 0;
  for (let i = geos.length - 1; i >= 0; i--) {
    const a = geos[i].attributes.position.array;
    let ok = true;
    for (let j = 0; j < a.length; j++) if (!Number.isFinite(a[j])) { ok = false; break; }
    if (!ok) { geos.splice(i, 1); dropped++; }
  }
  if (dropped) console.warn(`[water] dropped ${dropped} cascade sheet(s) with non-finite vertices`);
  const merged = mergeAll(geos);
  if (merged) {
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, fm.material);
    mesh.name = 'cascadeSheets';
    mesh.renderOrder = 5;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.userData.castShadow = false; mesh.userData.receiveShadow = false;
    mesh.userData.isWater = true;
    group.add(mesh);
  }
  const mistMesh = mist.build(engine.rng('casc-mist'));
  if (mistMesh) { mistMesh.userData.isWater = true; group.add(mistMesh); mist.uniforms.uLevel.value = level; if (shadowMap) mist.setShadowMap(shadowMap); }
  const churn = createChurn(engine, maps, falls.map((f) => f.impact).filter(Boolean), level);
  if (churn) { churn.mesh.userData.isWater = true; group.add(churn.mesh); }

  const sunCol = new THREE.Color(), amb = new THREE.Color();
  const sync = () => {
    sunCol.copy(SUN.color).multiplyScalar(SUN.intensity);
    fm.uniforms.uSunCol.value.copy(sunCol);
    fm.uniforms.uSunDirF.value.copy(SUN.dir).normalize();
    amb.copy(ATMO.uHazeColor.value).multiplyScalar(0.62).add(new THREE.Color().copy(SKY.uZenith.value).multiplyScalar(0.55));
    fm.uniforms.uFallAmb.value.copy(amb).multiplyScalar(0.9);
    if (mist.uniforms) { mist.uniforms.uSunCol.value.copy(sunCol); mist.uniforms.uSkyAmb.value.copy(amb).multiplyScalar(1.6); }
    if (churn) { churn.uniforms.uSunCol.value.copy(sunCol); churn.uniforms.uSkyAmb.value.copy(amb).multiplyScalar(1.9 * Math.PI * 0.5); }
  };
  sync();
  const update = (t) => {
    fm.uniforms.uTime.value = t;
    if (mist.uniforms) mist.uniforms.uTime.value = t;
    if (churn) churn.uniforms.uTime.value = t;
  };
  return { group, sync, update, tris, puffs: mist.count || 0, fallUniforms: fm.uniforms, mistUniforms: mist.uniforms, churnUniforms: churn?.uniforms };
}

/** spray along the lower fall, spray at hard landings, churn + droplet streaks + rising cloud at the
 *  plunge (adapted from athenaion addMist, lighter: these falls are 3-45 m) */
function addMist(mist, f, rng, density, level, farFactor = 1) {
  const c = f.streams[Math.floor(f.streams.length / 2)];
  const S = c.stride, a = c.samples;
  const [dx, dz] = f.dir;
  const drop = Math.max(1, f.drop);
  const W = f.width;
  const k = (0.45 + 0.55 * density) * farFactor;
  const disk = (pw = 1) => { const [x, z] = rng.disk(); const r = Math.hypot(x, z) || 1e-6; const s = Math.pow(r, pw) / r; return [x * s, z * s]; };
  const [ax, az] = f.across;
  // veil spray in front of the fast-falling part
  let acc = 0;
  for (let i = 1; i < c.count; i++) {
    const kk = i * S, kp = (i - 1) * S;
    acc += Math.hypot(a[kk] - a[kp], a[kk + 1] - a[kp + 1], a[kk + 2] - a[kp + 2]);
    const rel = (f.lip.y - a[kk + 1]) / drop;
    if (acc < 3.4 / k || rel < 0.25 || a[kk + 6] > -4.5) continue;
    acc = 0;
    const off = rng.range(-0.6, 0.6) * W, out = rng.range(0.3, 1.4) + rel;
    mist.add({
      pos: [a[kk] + ax * off + dx * out, a[kk + 1] + rng.range(-1, 1), a[kk + 2] + az * off + dz * out],
      size: (0.8 + 0.12 * W + 0.02 * drop) * rng.range(0.7, 1.3) * (0.6 + 0.7 * rel),
      life: rng.range(2.5, 5), vel: [dx * rng.range(0.3, 1.0), -rng.range(1.0, 3.0), dz * rng.range(0.3, 1.0)],
      growth: 1.3, density: rng.range(0.012, 0.028) * (0.3 + rel) * f.flow, kind: 0, stretch: rng.range(1.8, 2.8),
    });
  }
  // hard landings on ledges
  const seen = [];
  for (const l of f.landings) {
    if (seen.some((s) => Math.hypot(s.x - l.x, s.z - l.z) < 6)) continue;
    seen.push(l);
    const e = Math.min(1, l.speed / 20);
    if (e < 0.4) continue;
    // r3: 20 m drops off the plateau cliff: wide curtains land hard — spray scaled by the curtain width
    const nC = Math.round((0.4 + 1.6 * e) * k * (1 + W / 5));
    for (let m = 0; m < nC; m++) {
      const [ox, oz] = disk(1.4);
      mist.add({
        pos: [l.x + ox * W * 0.4 + dx * 1.2, l.y + rng.range(0.3, 1.5), l.z + oz * W * 0.35 + dz * 1.2],
        size: rng.range(0.5, 1.2) * (0.6 + e) + 0.08 * W, life: rng.range(1.4, 2.8),
        vel: [ox * 1.2 + dx * 1.5, 0.5 + rng.range(1.2, 3.0) * e, oz * 1.2 + dz * 1.5], gravity: 1.5, growth: 1.3,
        density: rng.range(0.05, 0.1) * f.flow, kind: 2, stretch: 0.9,
      });
    }
  }
  if (!f.impact) return;
  const end = { x: f.impact.x, y: level, z: f.impact.z, speed: f.impact.speed, r: f.impact.radius };
  const energy = Math.min(1.4, (end.speed / 16) * f.flow + 0.15);
  const R = Math.max(2.5, Math.min(end.r, 3 + W * 0.5));
  const nChurn = Math.round((10 + W * 1.8) * k * energy);
  for (let m = 0; m < nChurn; m++) {
    const [ox, oz] = disk(1.6);
    mist.add({
      pos: [end.x + ox * R * 0.6, end.y + rng.range(0.2, 1.2), end.z + oz * R * 0.6],
      size: (rng.range(0.6, 1.5) * (0.6 + 0.4 * energy) + W * 0.03), life: rng.range(1.2, 2.6),
      vel: [ox * rng.range(0.4, 1.8), rng.range(1.5, 4.0) * energy, oz * rng.range(0.4, 1.8)], gravity: 2.0, growth: 1.4,
      density: rng.range(0.06, 0.12), kind: 2, stretch: rng.range(0.85, 1.1),
    });
  }
  const nBoil = Math.round((6 + W * 0.9) * k * Math.min(1.2, energy));
  for (let m = 0; m < nBoil; m++) {
    const ang = rng.range(0, Math.PI * 2), rr = R * rng.range(0.15, 0.85);
    const wdt = R * rng.range(0.45, 0.85) * (0.7 + 0.3 * Math.min(1, energy));
    const st = rng.range(0.45, 0.8) * (0.8 + 0.3 * Math.min(1, energy));
    mist.add({
      pos: [end.x + Math.cos(ang) * rr, level + wdt * st * 0.22, end.z + Math.sin(ang) * rr],
      size: wdt, life: rng.range(1.4, 2.8), vel: [Math.cos(ang) * 0.4, rng.range(0.3, 0.9), Math.sin(ang) * 0.4],
      growth: 0.35, density: rng.range(0.8, 1.0), kind: 4, stretch: st,
    });
  }
  if (farFactor > 0.6) {
    const nStreak = Math.round((4 + W * 0.8) * k * energy);
    for (let m = 0; m < nStreak; m++) {
      const [ox, oz] = disk(0.8);
      const ol = Math.hypot(ox, oz) || 1;
      const up = rng.range(3, 7) * Math.sqrt(Math.min(1, energy)), outv = rng.range(1.5, 4.0);
      mist.add({
        pos: [end.x + ox * R * 0.45, end.y + 0.3, end.z + oz * R * 0.45],
        size: rng.range(1.0, 2.6) * (0.6 + 0.4 * energy), life: (2 * up / 9.81) * rng.range(0.85, 1.05),
        vel: [(ox / ol) * outv + dx * 0.8, up, (oz / ol) * outv + dz * 0.8], gravity: 9.81, growth: 0,
        density: rng.range(0.3, 0.5), kind: 3, stretch: 1,
      });
    }
  }
  // the soft mist cloud at the foot of the wall (refs 1, 4: a white haze where the pours meet the ring)
  const nCloud = Math.round((4 + W * 0.8 + drop * 0.08) * k * energy);
  for (let m = 0; m < nCloud; m++) {
    const [ox, oz] = disk();
    mist.add({
      pos: [end.x + ox * R * 1.2 + dx * R * 0.4, end.y + 0.8 + rng.range(0, 2 + drop * 0.06), end.z + oz * R * 1.2 + dz * R * 0.4],
      size: (2.5 + W * 0.35 + drop * 0.06) * rng.range(0.6, 1.4), life: rng.range(8, 15),
      vel: [ox * 0.4 + dx * 0.6, rng.range(0.5, 1.3), oz * 0.4 + dz * 0.6], growth: 1.2,
      density: rng.range(0.010, 0.022), kind: 1, stretch: rng.range(0.75, 1.05),
    });
  }
}
