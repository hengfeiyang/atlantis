// WATERFALLS: every layout.WATERFALLS entry + every engine.registry.aqueductSpills entry.
//
// Each fall is traced against the real terrain (ballistic arc from the lip, draping over ledges,
// running across terraces to the next drop) as several parallel sub-streams; a sheet is stitched
// between them, thin detached strands are added in front, and spray / mist puffs are placed along
// the lower fall, at every hard landing and as a big churning cloud where it meets the water.
// Impacts on the lagoon/river are pushed into the water surface (foam rings, churn, trails).
//
// aqueductSpills (published by the aqueducts module, optional) — accepted shapes:
//   { pos|from|p: [x,y,z] | {x,y,z}, dir: compassDeg | dirVec|direction: [dx,dz] or [dx,dy,dz],
//     width|w: m, flow: 0..1, id }
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { SUN } from '../core/lighting.js';
import { ATMO } from '../core/atmosphere.js';
import { SKY } from '../core/sky.js';
import { makeGround, traceFall } from '../water/trace.js';
import { buildSheet, buildStrands, createFallMaterial, mergeAll } from '../water/fallMesh.js';
import { MistSystem } from '../water/mist.js';
import { captureHeightMap, defaultTerrainFilter } from '../water/heightmap.js';
import { createChurn } from '../water/churn.js';
import { SHOTS } from '../world/shots.js';
import { buildRapidsRocks, planWeirs, reachObstacles, planCascade } from '../water/rapids.js';
import * as HF from '../world/heightfield.js';

function parseSpill(s, i) {
  if (!s) return null;
  const p = s.pos || s.from || s.p || s.position;
  const pos = Array.isArray(p) ? p : p && typeof p === 'object' ? [p.x, p.y, p.z] : null;
  if (!pos || pos.some((v) => !Number.isFinite(v))) return null;
  let dirVec = null;
  const dv = s.dirVec || s.direction || s.normal;
  if (Array.isArray(dv)) dirVec = dv.length === 3 ? [dv[0], dv[2]] : [dv[0], dv[1]];
  else if (dv && typeof dv === 'object') dirVec = [dv.x, dv.z ?? dv.y];
  let dir = Number.isFinite(s.dir) ? s.dir : Number.isFinite(s.heading) ? s.heading : null;
  if (!dirVec && dir === null) dir = 180;
  if (dirVec) { const l = Math.hypot(dirVec[0], dirVec[1]) || 1; dirVec = [dirVec[0] / l, dirVec[1] / l]; }
  const spec = {
    id: s.id ?? `spill-${i}`, from: pos, dir: dir ?? 0, dirVec: dirVec || undefined,
    width: s.width ?? s.w ?? 6, flow: s.flow ?? 0.8, snap: false, spill: true,
  };
  if (s.kind === 'arcade') {
    // spout trough under an arch keystone (acropolis stair arcade / bastion): the water leaves the trough
    // lip slowly as a sheet the width of the trough, fans out to fill most of the arch opening as it
    // falls, white almost from the lip (ref 7: sheets pouring through the arches)
    Object.assign(spec, { width: spec.width * 1.3, flow: Math.max(spec.flow, 0.9), v0: 0.9, fan: 0.3, widen: 0.3, widenDrop: 10, aer: 1.33, arcade: true });
  } else if (s.kind === 'spout') {
    // lion-mask / channel spout: a thin jet arching out from the wall, glassy at first, breaking into white
    // strands as it falls (fast exit, no fan)
    Object.assign(spec, { v0: 2.6 + 1.2 * spec.flow, fan: 0.04, aer: 0.35, spout: true });
  }
  return spec;
}

function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export async function build(engine) {
  const t0 = performance.now();
  const q = engine.quality;
  let W = engine.registry.water;
  let maps = W?.maps;
  if (!maps) {
    const { captureMaps } = await import('./water.js');
    maps = captureMaps(engine);
  }
  const terrainGround = W?.ground || makeGround([maps.near, maps.far]);
  const level = W?.level ?? 0;

  // ---- lips: snapped on the bare terrain (water module), or snap now
  const traced = new Map((W?.falls || []).map((f) => [f.id, f]));
  const lipSpecs = [];
  for (const spec of L.WATERFALLS) {
    let f = traced.get(spec.id);
    if (!f || f.spec !== spec) {
      try { f = traceFall(terrainGround, spec, engine.rng('fall:' + spec.id), { level }); } catch (e) { console.warn('[waterfalls] trace failed', spec.id, e.message); f = null; }
    }
    if (f) lipSpecs.push({ spec, lip: f.lip, terrainFall: f });
  }
  const spills = [];
  const spillsRaw = engine.registry.aqueductSpills;
  if (Array.isArray(spillsRaw)) spillsRaw.forEach((s, i) => { const sp = parseSpill(s, i); if (sp) spills.push(sp); });

  // ---- re-capture the ground INCLUDING the architecture built since (terrace walls, balustrades,
  //      aqueduct decks...) so the water pours over the real structures, not through them
  let ground = terrainGround, archInfo = '', archMap = null;
  try {
    const pts = [...lipSpecs.map((l) => [l.lip.x, l.lip.z]), ...spills.map((s) => [s.from[0], s.from[2]])];
    if (pts.length) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
      const pad = 160; x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
      const span = Math.max(x1 - x0, z1 - z0);
      const res = Math.min(2048, Math.ceil(span / 0.6));
      const SOLID = ['terrain', 'acropolis', 'temple', 'aqueducts', 'ruins'];
      let allow = null;
      if (engine.moduleRoots) {
        allow = new Set();
        for (const name of SOLID) for (const root of engine.moduleRoots[name] || []) root.traverse((o) => allow.add(o));
      }
      archMap = captureHeightMap(engine, {
        bounds: [x0, z0, x1, z1], res,
        filter: (o) => defaultTerrainFilter(o) && !o.userData.isWater && (!allow || allow.has(o)),
      });
      ground = makeGround([archMap, maps.near, maps.far]);
      archInfo = `arch capture ${archMap.W}x${archMap.H} ${archMap.ms} ms (${archMap.meshes} meshes)`;
    }
  } catch (e) { console.warn('[waterfalls] architecture capture failed, using terrain only:', e.message); }

  // ---- trace every fall over the real surfaces
  const falls = [];
  for (const { spec, lip, terrainFall } of lipSpecs) {
    try {
      const s2 = { ...spec, from: [lip.x, lip.y, lip.z], dirVec: [lip.dx, lip.dz], snap: false, lipJitter: spec.lipJitter ?? 0.45 };
      const f = traceFall(ground, s2, engine.rng('fall:' + spec.id), { level });
      f.lip = { ...lip, y: Math.max(lip.y, f.lip.y) };
      f.id = spec.id; f.spec = spec;
      falls.push(f);
    } catch (e) { console.warn('[waterfalls] trace failed', spec.id, e.message); falls.push(terrainFall); }
  }
  let spillCount = 0;
  const skipped = [];
  spills.forEach((spec, i) => {
    try {
      const f = traceFall(ground, spec, engine.rng('spill:' + spec.id + ':' + i), { level });
      // an outlet buried in the hillside (ground ahead higher than the lip) cannot fall anywhere
      if (f.drop < 1.5) { skipped.push(spec.id); return; }
      falls.push(f); spillCount++;
      if (f.impact && W?.addImpact) W.addImpact(f.impact);
    } catch (e) { console.warn('[waterfalls] spill trace failed', spec.id, e.message); }
  });

  // ---- shot-7 rapids: short weir pours wherever the sill crest sits just under the surface (the band of
  //      white water of ref 7); they feed the flow map (hydraulic jump), not the per-pixel impact list
  const RR = HF.RAPIDS_REACH;
  let weirCount = 0, cascadeInfo = '';
  if (RR) {
    try {
      const sh7 = SHOTS.find((sh) => sh.id === 7);
      // (sill chutes as 0.5 m white pours read as a white line across the ref-7 foreground, which is glassy
      //  there: off by default, the flow map keeps the hydraulic jump + foam streaks; ?wfWeirs=1 restores them)
      const weirSpecs = engine.params?.get?.('wfWeirs') ? planWeirs(ground, RR, { level, camPos: sh7?.pos, rng: engine.rng('weirs') }) : [];
      for (const spec of weirSpecs) {
        const f = traceFall(ground, spec, engine.rng('weir:' + spec.id), { level, tMax: 6, sMax: 30 });
        f.weir = true; falls.push(f); weirCount++;
      }
    } catch (e) { console.warn('[waterfalls] weirs failed:', e.message); }
    // the cascade band at the foot of the sheer bay (ref 7): rubble weir + white pours toward the camera
    try {
      const cr = await planCascade(engine, { ground, level, rng: engine.rng('cascade') });
      if (cr) {
        for (const spec of cr.specs) {
          const f = traceFall(cr.groundC, spec, engine.rng('casc:' + spec.id), { level, tMax: 8, sMax: 40 });
          f.cascade = true; f.ground = cr.groundC; falls.push(f);
          // the cascade band is the hero foreground of shot 7: its white water spreads far over the pool
          if (f.impact) { f.impact.strength = Math.max(f.impact.strength || 0, 0.95); f.impact.radius *= 1.15; }
        }
        if (cr.mesh) engine.add(cr.mesh, { castShadow: true, receiveShadow: true });
        cascadeInfo = `cascade ${cr.specs.length} pours / ${cr.rocks.length} rocks ${cr.ms} ms`;
      }
    } catch (e) { console.warn('[waterfalls] cascade failed:', e.message); }
  }

  // ---- boulders in the shot-7 rapids, then the late flow-field / impact update (every impact is
  //      known now: layout falls traced over the architecture, aqueduct spills, shore run-outs)
  const allImpacts = falls.filter((f) => !f.weir).map((f) => f.impact).filter(Boolean);
  for (const f of W?.falls || []) if (f.shoreImpact) allImpacts.push(f.shoreImpact);
  let rapidsInfo = '';
  try {
    const rr = await buildRapidsRocks(engine, { ground, level, impacts: allImpacts });
    if (rr?.mesh) engine.add(rr.mesh, { castShadow: true, receiveShadow: true });
    let fms = 0;
    const obst = [...(rr?.rocks || []), ...reachObstacles(engine, RR, level)];
    if (W?.updateFlow) fms = W.updateFlow({ impacts: allImpacts, obstacles: obst, reach: RR, detail: { bounds: [10, 15, 155, 170], res: q.detail >= 1 ? 320 : 240, depthAt: (x, z) => level - ground.H(x, z) } });
    const nImp = W?.setImpacts ? W.setImpacts(allImpacts) : 0;
    // white collars + wakes on the boulders standing in the shot-7 river: the ones inside the shot-7 frame
    // (beyond ~26 m the water shows above the foreground ledge), largest on screen first
    if (W?.setRocks && RR) {
      const vis = obst.filter((o) => o.r >= 0.6 && (o.h ?? 0) > 0.35).map((o) => {
        const rx = o.x - RR.cam[0], rz = o.z - RR.cam[1];
        const al = rx * RR.fwd[0] + rz * RR.fwd[1], ac = -rx * RR.fwd[1] + rz * RR.fwd[0];
        // (o.r under-measures the waterline outline of the bulky boulders: the collar hugs 1.5 r)
        return { ...o, r: o.r * 1.5, al, ac, k: o.r / Math.max(1, Math.hypot(rx, rz)) };
      }).filter((o) => o.al > 26 && Math.abs(o.ac) < o.al * 0.72 + 4).sort((a, b) => b.k - a.k);
      W.setRocks(vis, [-RR.fwd[0], -RR.fwd[1]]);
    }
    rapidsInfo = `${weirCount} weirs, ${cascadeInfo}, ${obst.length} obstacles, ${rr?.rocks?.length || 0}/${rr?.cand || 0} rapids rocks ${JSON.stringify(rr?.rej || {})} ${rr?.ms ?? 0} ms, flow ${fms} ms, ${nImp} impacts`;
  } catch (e) { console.warn('[waterfalls] rapids / flow update failed:', e.message); }

  // ---- geometry
  const detail = q.detail ?? 1, density = q.density ?? 1;
  const geos = [];
  const mist = new MistSystem(engine, maps);
  let tris = 0;
  for (const f of falls) {
    const rng = engine.rng('wf-geo:' + f.id);
    const gF = f.ground || ground;
    const sheet = buildSheet(f, gF, rng, { spacing: detail >= 1 ? 0.55 : 0.95 });
    geos.push(...sheet.geos);
    // a thinner, wispier second veil in front gives the falling water volume and parallax
    const front = buildSheet(f, gF, rng, { spacing: detail >= 1 ? 0.8 : 1.3, front: 0.7 + rng.range(0, 0.5), seed: rng.random() });
    geos.push(...front.geos); tris += front.tris;
    if (engine.params?.get?.('wfDebug')) console.log('[waterfalls] ' + f.id + ' lip ' + [f.lip.x, f.lip.y, f.lip.z].map((v) => v.toFixed(1)).join(',') + ' snapped ' + f.lip.snapped + ' K ' + f.K + ' ends ' + f.ends.map((e) => e.type[0] + '@' + e.x.toFixed(0) + ',' + e.y.toFixed(0) + ',' + e.z.toFixed(0)).join(' ') + ' tris ' + sheet.tris + ' drop ' + f.drop.toFixed(1));
    tris += sheet.tris;
    const nStrands = f.weir ? 0 : f.cascade ? 1 : Math.round((1 + f.width * 0.2) * (0.6 + 0.4 * detail));
    for (const g of buildStrands(f, gF, rng, nStrands, { spacing: detail >= 1 ? 0.8 : 1.3 })) {
      geos.push(g); tris += g.index.count / 3;
    }
    // spray detail where a camera can see it from close up (streaks, dense churn); thinner far away
    const fp = f.impact ? [f.impact.x, level, f.impact.z] : [f.lip.x, f.lip.y, f.lip.z];
    let dCam = Infinity;
    for (const sh of SHOTS) dCam = Math.min(dCam, Math.hypot(sh.pos[0] - fp[0], sh.pos[1] - fp[1], sh.pos[2] - fp[2]));
    if (f.weir) addWeirMist(mist, f, rng, density, level);
    else if (f.cascade) addWeirMist(mist, f, rng, density, level, 1 + 0.22 * Math.max(0, f.drop));
    else addMist(mist, f, rng, density, level, Math.max(0.35, Math.min(1, 300 / dCam)));
  }

  const group = new THREE.Group();
  group.name = 'waterfalls';
  const fm = createFallMaterial({ hTex: maps.near.tex, hBounds: maps.near.bounds });
  fm.uniforms.uDebug.value = Number(engine.params?.get?.('wfDebug') || 0);
  const merged = mergeAll(geos);
  let sheetMesh = null;
  if (merged) {
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, fm.material);
    mesh.name = 'waterfallSheets';
    mesh.renderOrder = 5;
    // terrain shadows come from the material's own height-map march (see fallMesh.js); the cascaded
    // shadows of the architecture are off unless ?wfShadow=1
    const rs = engine.params?.get?.('wfShadow') ? true : false;
    mesh.castShadow = false; mesh.receiveShadow = rs;
    mesh.userData.castShadow = false; mesh.userData.receiveShadow = rs;
    group.add(mesh);
    sheetMesh = mesh;
  }
  // per-shot cascaded shadows on the sheets: shot 3's terrace falls stand in the terraces' side-light shade
  // and read as translucent mid-grey veils in ref 3; refs 7, 8, 9 keep their falls sun-white
  // (a shot may force it with { fallShadow: true|false })
  const CSM_SHOTS = [3];
  const wfShadowParam = !!engine.params?.get?.('wfShadow');
  const setSheetShadow = (shot) => {
    if (!sheetMesh) return;
    const on = wfShadowParam || (shot.fallShadow ?? CSM_SHOTS.includes(shot.id));
    if (sheetMesh.receiveShadow === on) return;
    sheetMesh.receiveShadow = on; sheetMesh.userData.receiveShadow = on;
    sheetMesh.material.needsUpdate = true;
  };
  const mistMesh = mist.build(engine.rng('wf-mist'));
  if (mistMesh) group.add(mistMesh);
  // mist in the shade of the terraces / bastions (not only the terrain) thins out instead of hanging as a
  // grey veil in front of the sunlit falls (shot 7 right half, shot 3 terrace falls)
  if (mistMesh && archMap) mist.setShadowMap(archMap);
  const churn = createChurn(engine, maps, falls.filter((f) => !f.weir).map((f) => f.impact), level);
  if (churn) group.add(churn.mesh);
  engine.add(group, { castShadow: false, receiveShadow: true });

  // ---- animation + lighting uniforms
  const sunCol = new THREE.Color();
  const amb = new THREE.Color();
  const syncLight = () => {
    sunCol.copy(SUN.color).multiplyScalar(SUN.intensity);
    fm.uniforms.uSunCol.value.copy(sunCol);
    fm.uniforms.uSunDirF.value.copy(SUN.dir).normalize();
    if (mist.uniforms) {
      mist.uniforms.uSunCol.value.copy(sunCol);
      amb.copy(ATMO.uHazeColor.value).multiplyScalar(0.62).add(new THREE.Color().copy(SKY.uZenith.value).multiplyScalar(0.55));
      mist.uniforms.uSkyAmb.value.copy(amb).multiplyScalar(1.6);
    }
    if (churn) { churn.uniforms.uSunCol.value.copy(sunCol); churn.uniforms.uSkyAmb.value.copy(amb).multiplyScalar(1.9 * Math.PI * 0.5); }
  };
  syncLight();
  // look-dev: a shot may carry { mistTune | fallTune | churnTune: { uniform: value | [..] } } (snap --set)
  const tune = (U, o) => {
    if (!U || !o) return;
    for (const [k, v] of Object.entries(o)) {
      if (!U[k]) continue;
      if (Array.isArray(v) && U[k].value?.fromArray) U[k].value.fromArray(v); else U[k].value = v;
    }
  };
  engine.onShot((shot) => {
    syncLight();
    setSheetShadow(shot);
    tune(mist.uniforms, shot.mistTune); tune(fm.uniforms, shot.fallTune); tune(churn?.uniforms, shot.churnTune);
  });
  engine.onUpdate((t) => {
    fm.uniforms.uTime.value = t;
    if (mist.uniforms) mist.uniforms.uTime.value = t;
    if (churn) churn.uniforms.uTime.value = t;
  });

  engine.registry.waterfalls = { ground, shadowMap: archMap, falls: falls.map((f) => ({ id: f.id, lip: f.lip, impact: f.impact, landings: f.landings, width: f.width, drop: f.drop })) };
  const ms = Math.round(performance.now() - t0);
  console.log(`[waterfalls] built in ${ms} ms (${archInfo}; ${rapidsInfo}): ${falls.length} falls (${spillCount} aqueduct spills${skipped.length ? ', skipped (no drop): ' + skipped.join(' ') : ''}), ${Math.round(tris)} sheet tris, ${mist.count || 0} mist puffs`);
}

/** fine veil spray along the lower fall, spray + mist at hard landings, churning spray, droplet
 *  streaks and a wispy rising cloud at the plunge. Opacity is low per puff: the density builds up
 *  where many puffs overlap (near the impact), thin wisps elsewhere.
 *  farFactor < 1 thins the spray of falls that no camera sees from close up. */
function addMist(mist, f, rng, density, level, farFactor = 1) {
  const c = f.streams[Math.floor(f.streams.length / 2)];
  const S = c.stride, a = c.samples;
  const [dx, dz] = f.dir, [ax, az] = f.across;
  const drop = Math.max(1, f.drop);
  const W = f.width;
  const k = (0.45 + 0.55 * density) * farFactor;
  const disk = (pw = 1) => { const [x, z] = rng.disk(); const r = Math.hypot(x, z) || 1e-6; const s = Math.pow(r, pw) / r; return [x * s, z * s]; };
  // ---- veil spray in front of the lower, fast-falling part of the sheet
  let acc = 0;
  for (let i = 1; i < c.count; i++) {
    const kk = i * S, kp = (i - 1) * S;
    acc += Math.hypot(a[kk] - a[kp], a[kk + 1] - a[kp + 1], a[kk + 2] - a[kp + 2]);
    const rel = (f.lip.y - a[kk + 1]) / drop;
    if (acc < 3.4 / k || rel < 0.25 || a[kk + 6] > -4.5) continue;
    acc = 0;
    const n = rng.random() < 0.55 ? 1 : 2;
    for (let m = 0; m < n; m++) {
      const off = rng.range(-0.6, 0.6) * W;
      const out = rng.range(0.3, 1.6) + rel * 1.4;
      mist.add({
        pos: [a[kk] + ax * off + dx * out, a[kk + 1] + rng.range(-1, 1), a[kk + 2] + az * off + dz * out],
        size: (0.9 + 0.12 * W + 0.02 * drop) * rng.range(0.7, 1.3) * (0.6 + 0.7 * rel),
        life: rng.range(2.5, 5), vel: [dx * rng.range(0.3, 1.0), -rng.range(1.0, 3.0), dz * rng.range(0.3, 1.0)],
        growth: 1.3, density: rng.range(0.012, 0.028) * (0.3 + rel) * f.flow, kind: 0, stretch: rng.range(1.8, 2.8),
      });
    }
  }
  // ---- hard landings on ledges (water bursting off a rock shelf)
  const seen = [];
  for (const l of f.landings) {
    if (seen.some((s) => Math.hypot(s.x - l.x, s.z - l.z) < 6)) continue;
    seen.push(l);
    const e = Math.min(1, l.speed / 20);
    if (e < 0.4) continue;
    const nC = Math.round((0.4 + 1.6 * e) * k), nM = Math.round((0.5 + 1.5 * e) * k * 0.5);
    for (let m = 0; m < nC; m++) {
      const [ox, oz] = disk(1.4);
      mist.add({
        pos: [l.x + ox * W * 0.35 + dx * 1.2, l.y + rng.range(0.3, 1.5), l.z + oz * W * 0.35 + dz * 1.2],
        size: rng.range(0.5, 1.2) * (0.6 + e) + 0.04 * W, life: rng.range(1.4, 2.8),
        vel: [ox * 1.2 + dx * 1.5, 0.5 + rng.range(1.2, 3.0) * e, oz * 1.2 + dz * 1.5], gravity: 1.5, growth: 1.3,
        density: rng.range(0.05, 0.1) * f.flow, kind: 2, stretch: 0.9,
      });
    }
    for (let m = 0; m < nM; m++) {
      const [ox, oz] = disk();
      mist.add({
        pos: [l.x + ox * W * 0.5 + dx * 2, l.y + rng.range(1, 3.5), l.z + oz * W * 0.5 + dz * 2],
        size: (2.5 + 0.25 * W) * rng.range(0.7, 1.3) * (0.6 + e), life: rng.range(6, 11),
        vel: [dx * 0.5 + ox * 0.2, rng.range(0.4, 1.0), dz * 0.5 + oz * 0.2], growth: 1.4,
        density: rng.range(0.015, 0.035) * f.flow, kind: 1, stretch: rng.range(0.8, 1.1),
      });
    }
  }
  // ---- plunge
  const end = f.impact ? { x: f.impact.x, y: level, z: f.impact.z, speed: f.impact.speed, r: f.impact.radius, water: true } : (() => {
    const e = f.ends[Math.floor(f.ends.length / 2)];
    return { x: e.x, y: e.y, z: e.z, speed: e.speed, r: W * 0.6 + 3, water: false };
  })();
  const energy = Math.min(1.4, (end.speed / 16) * f.flow + 0.15);
  // very tall falls: the lower half of the fall is wrapped in its own spray cloud and a broad mist bank
  // fills the valley around its foot (refs 3, 9: the hill fall dissolves into a bright fog that veils the
  // aqueduct arches; readable from kilometres away). Independent of the run-out speed: tall falls that
  // end on a slope still carry the cloud.
  const tallMist = () => {
  if (drop > 45) {
    const nEnv = Math.round(4 + Math.min(8, drop / 14));
    for (let m = 0; m < nEnv; m++) {
      const rel = rng.range(0.45, 1.0);
      let best = 0;
      for (let i = 0; i < c.count; i++) if (a[i * S + 1] >= f.lip.y - rel * drop) best = i; else break;
      const kk = best * S;
      const sz = (4 + 0.06 * drop + 0.4 * W) * rng.range(0.7, 1.3) * (0.6 + 0.6 * rel);
      const off = rng.range(-0.5, 0.5) * W;
      mist.add({
        pos: [a[kk] + ax * off + dx * rng.range(0.5, 1.5 + 1.5 * rel), a[kk + 1], a[kk + 2] + az * off + dz * rng.range(0.5, 1.5 + 1.5 * rel)],
        size: sz, life: rng.range(14, 24), vel: [dx * 0.3, rng.range(0.1, 0.5), dz * 0.3], growth: 0.6,
        density: rng.range(0.05, 0.09) * (0.5 + 0.5 * rel) * f.flow, kind: 1, stretch: rng.range(1.0, 1.5),
      });
    }
    const nBank = Math.round(10 + Math.min(10, drop / 12));
    for (let m = 0; m < nBank; m++) {
      const [ox, oz] = disk(0.6);
      const sz = (26 + 0.22 * drop) * rng.range(0.75, 1.25);
      mist.add({
        pos: [end.x + ox * sz * 1.6 + dx * sz * rng.range(0.1, 1.0), end.y + sz * rng.range(0.05, 0.25), end.z + oz * sz * 1.6 + dz * sz * rng.range(0.1, 1.0)],
        size: sz, life: rng.range(26, 40), vel: [dx * 0.25 + ox * 0.15, rng.range(0.05, 0.25), dz * 0.25 + oz * 0.15], growth: 0.35,
        density: rng.range(0.03, 0.05) * f.flow, kind: 1, stretch: rng.range(0.55, 0.75),
      });
    }
  }
  };
  if (energy < 0.3 && !end.water) { tallMist(); return; }
  const R = Math.max(3, Math.min(end.r, 4 + W * 0.5));
  // churning spray boiling up around the impact (dense near the centre)
  const dry = end.water ? 1 : 0.45;
  const nChurn = Math.round((14 + W * 1.8) * k * energy * dry);
  for (let m = 0; m < nChurn; m++) {
    const [ox, oz] = disk(1.6);
    mist.add({
      pos: [end.x + ox * R * 0.6, end.y + rng.range(0.2, 1.2), end.z + oz * R * 0.6],
      size: (rng.range(0.6, 1.6) * (0.6 + 0.4 * energy) + W * 0.03), life: rng.range(1.2, 2.6),
      vel: [ox * rng.range(0.4, 1.8), rng.range(1.5, 4.0) * energy, oz * rng.range(0.4, 1.8)], gravity: 2.0, growth: 1.4,
      density: rng.range(0.1, 0.2), kind: 2, stretch: rng.range(0.85, 1.1),
    });
  }
  // boiling white water heaving up around the plunge (a dense white band at the water line)
  if (end.water) {
    const nBoil = Math.round((8 + W * 0.9) * k * Math.min(1.2, energy));
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
  }
  // droplet streaks thrown up and out of the plunge pool
  if (farFactor > 0.6) {
    const nStreak = Math.round((6 + W * 0.8) * k * energy);
    for (let m = 0; m < nStreak; m++) {
      const [ox, oz] = disk(0.8);
      const ol = Math.hypot(ox, oz) || 1;
      const up = rng.range(4, 8.5) * Math.sqrt(Math.min(1, energy)), outv = rng.range(1.5, 4.5);
      mist.add({
        pos: [end.x + ox * R * 0.45, end.y + 0.3, end.z + oz * R * 0.45],
        size: rng.range(1.2, 3.0) * (0.6 + 0.4 * energy), life: (2 * up / 9.81) * rng.range(0.85, 1.05),
        vel: [(ox / ol) * outv + dx * 0.8, up, (oz / ol) * outv + dz * 0.8], gravity: 9.81, growth: 0,
        density: rng.range(0.3, 0.5), kind: 3, stretch: 1,
      });
    }
  }
  // wispy cloud rising off the pool and drifting downstream
  const small = Math.min(1, (W * Math.min(drop, 40)) / 200);           // small spills: a light veil only
  const nCloud = Math.round((3 + (5 + W * 0.7 + drop * 0.06) * small) * k * energy * dry);
  for (let m = 0; m < nCloud; m++) {
    const [ox, oz] = disk();
    mist.add({
      pos: [end.x + ox * R * 1.1 + dx * R * 0.4, end.y + 0.8 + rng.range(0, 2 + drop * 0.04), end.z + oz * R * 1.1 + dz * R * 0.4],
      size: (2.5 + W * 0.3 + drop * 0.05) * rng.range(0.6, 1.4) * (0.6 + 0.4 * small), life: rng.range(8, 15),
      vel: [ox * 0.4 + dx * 0.6, rng.range(0.5, 1.3), oz * 0.4 + dz * 0.6], growth: 1.2,
      density: rng.range(0.025, 0.055) * smooth(0, 1, energy) * (0.6 + 0.4 * small), kind: 1, stretch: rng.range(0.75, 1.05),
    });
  }
  // tall falls: a thin veil of mist climbing the lower cliff, carried by the updraft
  if (drop > 35) {
    const nV = Math.round((drop / 14) * k);
    for (let m = 0; m < nV; m++) {
      const [ox, oz] = disk();
      const h = rng.range(0.05, 0.35) * drop;
      mist.add({
        pos: [end.x + ox * R * 1.4 + dx * R * 0.3 - dx * h * 0.1, end.y + h, end.z + oz * R * 1.4 + dz * R * 0.3 - dz * h * 0.1],
        size: (5 + W * 0.4 + drop * 0.05) * rng.range(0.7, 1.3), life: rng.range(12, 20),
        vel: [dx * 0.3, rng.range(0.4, 0.9), dz * 0.3], growth: 1.0,
        density: rng.range(0.012, 0.025), kind: 1, stretch: rng.range(1.0, 1.5),
      });
    }
  }
  // big falls: a billowing cloud of spray fills the plunge basin and spills downstream (refs 3, 9: the
  // foot of every tall fall vanishes in a bright mist bank, readable from kilometres away)
  const bigK = Math.min(1, drop / 45) * Math.min(1, W / 7) * Math.min(1, energy) * (end.water ? 1 : 0.6);
  if (bigK > 0.2) {
    const nBig = Math.round((3 + drop / 9 + W / 2.5) * bigK * (0.5 + 0.5 * k));
    for (let m = 0; m < nBig; m++) {
      const [ox, oz] = disk(0.7);
      const h = Math.pow(rng.random(), 2.2) * (0.05 + 0.16 * bigK) * drop;
      const out = rng.range(-0.2, 1.2) * R;
      mist.add({
        pos: [end.x + ox * R * 1.8 + dx * out - dx * h * 0.15, end.y + 1.5 + h, end.z + oz * R * 1.8 + dz * out - dz * h * 0.15],
        size: (4 + 0.1 * drop + 0.35 * W) * rng.range(0.7, 1.3) * (1 - 0.35 * h / Math.max(1, drop)), life: rng.range(14, 26),
        vel: [dx * rng.range(0.4, 1.0) + ox * 0.3, rng.range(0.3, 0.8), dz * rng.range(0.4, 1.0) + oz * 0.3], growth: 0.7,
        density: rng.range(0.05, 0.1) * (0.6 + 0.4 * bigK), kind: 1, stretch: rng.range(0.65, 0.9),
      });
    }
  }
  tallMist();
}

export async function test(engine) {
  const water = await import('./water.js');
  await water.buildTestTerrain(engine);
  await water.build(engine);
  if (engine.params?.get?.('wfAq')) { try { const aq = await import('./aqueducts.js'); await aq.build(engine); } catch (e) { console.warn('[waterfalls test] aqueducts:', e.message); } }
  await build(engine);
  return {
    views: [
      // 0: acro-w1 / acro-w2 from across the river
      { pos: [-285, 45, -20], target: [-125, 55, -40], fov: 50, sun: { azimuth: 238, elevation: 21 } },
      // 1: south terraces cascades from the lagoon
      { pos: [-40, 8, 300], target: [10, 40, 120], fov: 48, sun: { azimuth: 238, elevation: 21 } },
      // 2: hill-big from the canyon
      { pos: [-520, 120, -420], target: [-635, 160, -640], fov: 45, sun: { azimuth: 238, elevation: 21 } },
      // 3: canyon-1 plunge
      { pos: [-250, 25, -250], target: [-320, 20, -320], fov: 50, sun: { azimuth: 238, elevation: 21 } },
      // 4: acro-w3 close-up (sheet texture)
      { pos: [-178, 62, -6], target: [-123, 68, -25], fov: 45, sun: { azimuth: 238, elevation: 21 } },
      // 5: island-1 small fall into the lagoon
      { pos: [-52, 4, 286], target: [-80, 4, 300], fov: 50, sun: { azimuth: 238, elevation: 21 } },
      // 6: low aqueduct spills (use --params wfAq=1)
      { pos: [-215, 10, 190], target: [-240, 14, 105], fov: 50, sun: { azimuth: 238, elevation: 21 } },
    ],
  };
}

/** rapids weir pour (low step over the sill crest): a dense boiling white band along its foot, spray
 *  flicked off the crest and a few droplet streaks. No rising cloud (the drop is < 1 m). */
function addWeirMist(mist, f, rng, density, level, sc = 1) {
  const [dx, dz] = f.dir, [ax, az] = f.across;
  const W = f.width;
  const k = (0.55 + 0.45 * density) * Math.sqrt(sc);
  // (cascades, sc > 1) spray flicked off the crest: small puffs breaking the straight lip line
  if (sc > 1.2) {
    const nC = Math.round((1 + W * 0.8) * k);
    for (let m = 0; m < nC; m++) {
      const u = (m + rng.random()) / nC - 0.5;
      mist.add({
        pos: [f.lip.x + ax * u * W + dx * rng.range(0.2, 0.9), f.lip.y + rng.range(-0.4, 0.1), f.lip.z + az * u * W + dz * rng.range(0.2, 0.9)],
        size: rng.range(0.45, 0.95), life: rng.range(0.8, 1.6), vel: [dx * rng.range(0.8, 1.8), rng.range(0.4, 1.4), dz * rng.range(0.8, 1.8)],
        gravity: 3.0, growth: 1.0, density: rng.range(0.06, 0.12), kind: 2, stretch: 1,
      });
    }
    // a thin veil of spray over the face and the frayed sides of the pour (soft outline, ref 7)
    const nV = Math.round((2 + W * 0.9) * k);
    for (let m = 0; m < nV; m++) {
      const u = rng.range(-0.62, 0.62), h = rng.range(0.15, 0.95) * Math.max(1, f.drop);
      mist.add({
        pos: [f.lip.x + ax * u * W + dx * rng.range(0.6, 1.6), f.lip.y - h, f.lip.z + az * u * W + dz * rng.range(0.6, 1.6)],
        size: rng.range(0.9, 1.8), life: rng.range(1.6, 3.2), vel: [dx * rng.range(0.3, 0.9), -rng.range(0.2, 0.8), dz * rng.range(0.3, 0.9)],
        growth: 1.1, density: rng.range(0.05, 0.11), kind: 0, stretch: rng.range(1.2, 1.8),
      });
    }
  }
  const foot = f.streams.map((s) => s.end);
  const fx = foot.reduce((a, e) => a + e.x, 0) / foot.length, fz = foot.reduce((a, e) => a + e.z, 0) / foot.length;
  const nB = Math.round((2 + W * 0.9) * k);
  for (let m = 0; m < nB; m++) {
    const u = (m + rng.random()) / nB - 0.5;
    const wdt = rng.range(0.8, 1.7) * (0.8 + 0.2 * f.flow) * sc;
    const st = rng.range(0.45, 0.75);
    mist.add({
      pos: [fx + ax * u * W * 1.05 + dx * rng.range(0.3, 1.8), level + wdt * st * 0.18, fz + az * u * W * 1.05 + dz * rng.range(0.3, 1.8)],
      size: wdt, life: rng.range(1.0, 2.2), vel: [dx * rng.range(0.6, 1.6), rng.range(0.15, 0.5), dz * rng.range(0.6, 1.6)],
      growth: 0.3, density: rng.range(0.7, 0.95), kind: 4, stretch: st,
    });
  }
  const nS = Math.round((1 + W * 0.45) * k);
  for (let m = 0; m < nS; m++) {
    const u = rng.range(-0.5, 0.5);
    mist.add({
      pos: [fx + ax * u * W + dx * rng.range(0, 1.2), level + rng.range(0.1, 0.5), fz + az * u * W + dz * rng.range(0, 1.2)],
      size: rng.range(0.5, 1.1) * sc, life: rng.range(0.9, 1.8), vel: [dx * rng.range(0.8, 2.0), rng.range(0.8, 2.2) * sc, dz * rng.range(0.8, 2.0)],
      gravity: 2.5, growth: 1.2, density: rng.range(0.08, 0.15), kind: 2, stretch: 1,
    });
  }
  const nT = Math.round((1 + W * 0.3) * k);
  for (let m = 0; m < nT; m++) {
    const u = rng.range(-0.5, 0.5), up = rng.range(1.5, 3.5);
    mist.add({
      pos: [fx + ax * u * W, level + 0.2, fz + az * u * W], size: rng.range(0.5, 1.1), life: (2 * up / 9.81) * rng.range(0.85, 1.05),
      vel: [dx * rng.range(1, 2.5) + ax * rng.range(-0.6, 0.6), up, dz * rng.range(1, 2.5) + az * rng.range(-0.6, 0.6)], gravity: 9.81, growth: 0,
      density: rng.range(0.3, 0.5), kind: 3, stretch: 1,
    });
  }
}
