// WATER: every water surface of ATLANTIS. OWNER: water agent.
// adapted from athenaion/src/modules/water.js + waterfalls.js
//
// golden: the sea-level surface (y = 0) over the 3 water rings, the canal and the open sea (one plane,
//   depth-tinted turquoise rings → cobalt sea, waves / whitecaps / surf at sea, mirror-calm rings, planar
//   reflections, sun glitter, foam lines at quays / moles / islets, ship wakes), the cascades of the
//   citadel hill (traced over the real terrain + architecture) with mist / churn, fountain jets + steam.
// sunken: the sea surface at L.SUNKEN.surface seen from above (dusk sea, ref 9) and from below (bright
//   rippled ceiling, Snell's window, total internal reflection; refs 6, 7). The medium itself (absorption,
//   in-scatter, rays, caustics) is the underwater core's.
//
// registry.water = {
//   level            surface height for this era (0 golden, L.SUNKEN.surface sunken)
//   addWake(w)       w = { pos:[x,z] or [x,y,z] of the BOW, heading (compass deg of travel), length, beam,
//                    speed (m/s), oars (bool) } → handle { update(partial), remove() }   (golden)
//   setWakes(list), wakes
//   addImpact(im)    extra splash / foam source { x, z, radius, strength 0..1, dir:[dx,dz] }
//   depthAt(x, z)    water depth (m) from the captured terrain;  shoreDist(x, z) → m to the nearest land
//   waves            shared wave uniforms (tWaves, uWaveScale/Amp/Ang, uSwellA/B, uTime) for WAVES_GLSL
//   WAVES_GLSL       GLSL: wWaves(p, amp4) → (slope, var), wSwellH(p, t), wSwellSlope(p, t)
//   surfaceHeight(x, z, t)   exact analytic swell height (m) around `level` (meniscus, floating things)
//   cascades         [{ id, kind, lip, impact, width, drop }] ; spouts: wall spout points for the rings agent
//   fountains        basins in use
//   maps, shore, surface, uniforms, underside (sunken)
// }
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { isSunken } from '../world/era.js';
import { captureHeightMap, defaultTerrainFilter } from '../water/heightmap.js';
import { buildShoreField } from '../water/shore.js';
import { OceanTile } from '../water/ocean.js';
import { PlanarReflection } from '../water/reflection.js';
import { createWaterSurface, setU } from '../water/surface.js';
import { createUnderside } from '../water/underside.js';
import { waveUniforms, swellFromUniforms, swellHeight, WAVES_GLSL } from '../water/waves.js';
import { makeGround } from '../water/trace.js';
import { planCascades, traceCascades, cascadeFootprints, buildCascadeMeshes, SPOUT_R, SPOUT_Y } from '../water/cascades.js';
import { buildFountains } from '../water/fountains.js';
import { buildBowSpray } from '../water/bowSpray.js';
import { stairChannelSpec, buildStairChannelWater } from '../water/stairChannel.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOOKS } from '../world/looks.js';
import { UW } from '../core/underwater.js';

// r3: per-shot surface tuning (water-level shots: calmer rings so the lit buildings mirror, broad gold glitter)
export const SHOT_TUNE = {
  // shot 4 (eye 2.5 m in w1, sun 60° left of the view): calm mirror, a wide glitter field of small facets
  // across the left half (ref 4), deeper teal body (ref ≈ rgb 46,105,126)
  // shot 9 (split level at dusk): a livelier sea, ripples catching the sunset (ref 9)
  // r4: ref 9's dusk sea is wave-shaped (dark troughs, crests catching the sunset), warm, not a smooth grey mirror:
  // the resolved core waves (uUwWaveK, same pattern as the meniscus / caustics) carry the shape, the sub-pixel FFT
  // octaves are lowered (their LEAN variance blurred the mirror into flat bands), a mostly opaque navy body,
  // a warm (and > 1) sky-reflection tint, sharper reflection lookups, more sunset glints
  // r5: ref 9's sea is steel-blue / mauve away from the sun with ONE narrow orange-gold glitter column under the disk: the
  // mirrored low sky (an orange band all along the horizon) is tinted cool (uReflTint, open sea only), the slate body a
  // little lighter, the sun term narrow (small extra lobe) and strong, denser sparse glints inside the column
  9: {
    uSeaOpaque: 0.88, uReflSmear: 0.3, uReflLod: 0.0, uSunLobe: [0.0015, 2.5, 12.0],
    // (r6: uWaveAmp [0.06, 0.05, 0.03, 0.004], uUwWaveK 5, uSeaBody [0.12, 0.16, 0.26], uSkyReflSea [1.15, 0.8, 0.62],
    //  uGlint [0.9, 0.35, 1, 1], uGlintVar 0.004, uReflTint [0.6, 0.68, 0.95])
    // r7: the r6 sea read dark brown with smooth streaks (≈ 69,47,41; ref 9 steel-blue 97,103,121 with small waves + orange
    // glints): the mirror at 0.15 m eye height shows the dark maroon upper sky / unlit far range only, the core swells (×5)
    // drew long smooth bands. Short chop instead (FFT octaves 3-4 up, core swells ×1.5), Fresnel over the sub-pixel slopes
    // (uFresVar: the steel-blue body shows between the mirrored crests), neutral sky tint + cooler mirror, the glitter column
    // soft-capped so it stays orange (uGlitMax), more and wider-spread sparse glints
    uWaveAmp: [0.06, 0.1, 0.5, 0.25], uUwWaveK: 1.5, uSkyReflSea: [1.0, 1.0, 1.1], uReflTint: [0.75, 0.9, 1.3], uFresVar: 1,
    uSeaBody: [0.24, 0.32, 0.5], uGlitMax: 20, uGlintVar: 0.05, uGlint: [2, 0.3, 1, 1], uGlintR: 1.5,
  },
  // r4: the r3 sparse glints read as white dots → a wind-ruffled mirror instead: livelier ripples (mid octaves) that break
  // the reflected sheds into wavy bands, a broad second sun lobe for the gold field (uSunLobe), almost no point glints,
  // less body light so the reflections win (ref 4 right half: teal troughs p50 ≈ 39,120,129 + gold crests p90 ≈ 214,161,113)
  // r5: ref 4's water is a MIRROR of the lit sheds / bridge (gold columns under every pier) with turquoise between: the r4
  // broad sun lobe painted one gold sheen over the whole ring and hid them → calmer short octaves (the reflections stay
  // vertical streaks, not a mush), a little vertical smear, reflection gain 2, less body light, a faint narrow lobe
  4: {
    uRingCalm: 1.05, uRingAmp: [0.5, 0.6, 0.5, 0.4], uGlint: [0.02, 0.5, 1.0, 1.0],
    uScatter: [0.003, 0.1, 0.19], uReflGain: 2.0, uReflSmear: 0.3, uSunLobe: [0.06, 0.1, 8.0],
    // r7: colourfulness 56 vs ref 62 — the water read grey-green teal with white mirrored stone: a bluer turquoise body
    // (uScatter r5 [0.006, 0.085, 0.12], uBodyLight r5 [0.3, 0.45, 0.5]) + cyan sky tint, and the mirrored lit stone gold
    // (uReflTintRing: geometry only, the sky in the mirror keeps its colour) like ref 4's gold columns under the piers
    uBodyLight: [0.45, 0.6, 0.5], uSkyRefl: [0.22, 0.55, 0.8], uReflTintRing: [1.24, 0.91, 0.56],
  },
  // r4 (shot 1, the opening aerial at 1.4 km): the rings read as concentric bands of turquoise water (ref 1 rings p50 ≈ 76,112,125)
  // — less of the white city mirrored at the grazing view (ring-only reflection gain), the body not weighted down by
  // Fresnel, a cyan body + sky tint. The open sea (seaK) keeps its navy body, chop and whitecaps.
  // r5: the open sea navy-teal like ref 1 (sea p50 ≈ 7-33 / 46-69 / 77-90; r4 read royal blue 26,55,101)
  // r6: shot 2 (canal, eye 5 m): turquoise-teal canal like ref 2 (p10 ≈ 16,54,68, p50 ≈ 44,88,104; r5 read navy 2,42,69 — the
  // water at the camera counted as open sea, fixed by uCanalRingC): a bluer teal body that shows through the grazing Fresnel
  2: { uScatter: [0.004, 0.095, 0.15], uRingLook: [1.0, 0.65, 1.0, 0], uSkyRefl: [0.2, 0.5, 0.64] },
  // r7: shot 3's far sea toward the sun read as a pale grey veil (≈ 199,182,170 with the surface black: the haze dominates at
  // 3-30 km) with a white clipped glitter blob; ref 3: orange-peach sea (≈ 224,159,112) and a pale-gold path. The haze over
  // the open sea is tinted warm toward the sun (uSeaHaze, water pixels only), the sea mirrors the warm low sky (uSunSide /
  // uReflTint), the glitter is soft-capped so it stays gold (uGlitMax) with a slightly broader lobe, no sub-pixel whitecaps
  // (white specks across the far sea)
  3: { uSeaHaze: [1.25, 0.85, 0.55, 1], uSeaHazeK: [2, 0.4], uSunSide: [1.4, 0.85, 0.5, 1], uSunSideK: 2, uReflTint: [1.1, 0.72, 0.45],
    uSeaWave: [2.6, 1.7, 1.0, 0.0], uGlitMax: 60, uSunLobe: [0.003, 2.0, 6] },
  1: { uRingLook: [0.45, 0.2, 1.8, 0], uScatter: [0.006, 0.12, 0.2], uSkyRefl: [0.2, 0.55, 0.75], uScatterSea: [0.001, 0.022, 0.045], uSkyReflSea: [0.07, 0.17, 0.3],
    uSeaWave: [2.6, 1.7, 1.0, 0.07], uCanalSea: 1.0, uReflClamp: 1.0, uCanalRingC: 0,
    // r6: the sea toward the low sun mirrors the warm horizon (ref 1: cream-gold under the sun, navy away from it)
    // and the glitter path is gold, not a clipped white column
    uSunSide: [1.4, 1.0, 0.6, 1.0], uSunSideK: 3.0, uGlitterTint: [1.0, 0.6, 0.28] },   // r5: fewer whitecaps (ref 1: the white on the sea is ship wakes + surf at the rocks)
};
const tuneDefaults = {};
const HERO_FOAM = 2.0;   // r4: 1.0 → 1.5 (ref 2: a broad breaking bow wave); r5: 2.0 (the hero now advances: a bigger bow wave)

export const NEAR_BOUNDS = [-1100, -1000, 1100, 1400];
export const FAR_BOUNDS = [-7000, -7000, 7000, 7000];

export function captureMaps(engine) {
  const q = engine.quality;
  const near = captureHeightMap(engine, { bounds: NEAR_BOUNDS, res: q.detail >= 1 ? 2048 : 1536 });
  const far = captureHeightMap(engine, { bounds: FAR_BOUNDS, res: q.detail >= 1 ? 1536 : 1024 });
  return { near, far };
}

export async function build(engine) {
  const t0 = performance.now();
  const sunken = isSunken(engine);
  const level = sunken ? L.SUNKEN.surface : L.SEA_LEVEL;
  const q = engine.quality;

  // ---- terrain capture + distance-to-land fields
  const maps = captureMaps(engine);
  const shore = { near: buildShoreField(maps.near, level, 80), far: buildShoreField(maps.far, level, 400) };
  const ground = makeGround([maps.near, maps.far]);
  const depthAt = (x, z) => level - ground.H(x, z);
  const shoreDist = (x, z) => { const d = shore.near.sample(x, z); return d < shore.near.maxDist ? d : shore.far.sample(x, z); };
  const t1 = performance.now();

  // ---- waves: FFT ripple tile + analytic swell
  const ocean = new OceanTile({ n: 256, size: 24, wind: sunken ? 5.5 : 4.4, windDir: 0.9, seed: 11 });
  const waves = sunken
    ? waveUniforms(ocean, {
      scale: [41.0, 12.3, 3.9, 1.21], amp: [0.08, 0.075, 0.04, 0.006],
      swell: [],   // the long waves are the underwater core's (UW.uUwWaves): one surface for ripples, caustics, rays, meniscus
    })
    : waveUniforms(ocean, {
      swell: [{ amp: 0.35, len: 62, dir: 10, phase: 0.0 }, { amp: 0.18, len: 31, dir: 340, phase: 2.0 }, { amp: 0.08, len: 14, dir: 35, phase: 4.0 }, { amp: 0, len: 10, dir: 0 }],
    });
  const reflection = new PlanarReflection(engine, { level, scale: q.name === 'preview' ? 0.5 : 0.75 });

  // ---- the surface seen from above
  const look = sunken ? {
    uSea: [-10, 0, -1000, -1e5], uSeaSector: [-3, -2, -10, 0], uBodyK: 0, uSeaWave: [1.0, 1.0, 1.0, 0.02], uShoreK: [0.5, 10, 0.6, 0.5],
    uSkyReflSea: [0.55, 0.5, 0.5], uGlint: [0.16, 0.8, 1.0, 1.0], uRingCalm: 1.0,
  } : {};
  const water = createWaterSurface(engine, { maps, shore, waves, reflection, level, absorb: !sunken, look });
  engine.add(water.group, { castShadow: false, receiveShadow: true });

  let underside = null;
  if (sunken) {
    underside = createUnderside(engine, { waves, level });
    engine.add(underside.mesh, { castShadow: false, receiveShadow: false });
    reflection.hidden.push(underside.mesh);
  }

  // ---- cascades: trace on the bare terrain now (corridor footprints before the architecture is placed)
  let cascades = [], late = null;
  const specs = sunken ? [] : planCascades();
  if (specs.length) {
    cascades = traceCascades(engine, ground, specs, level);
    cascadeFootprints(engine, cascades);
    water.setImpacts(cascades.map((f) => f.impact).filter(Boolean));
  }

  engine.onUpdate((t) => {
    ocean.update(t);
    waves.uTime.value = t;
    late?.update(t);
  });

  // ---- late stage (first applyShot, after every module has built): re-trace the cascades over the real
  //      architecture (citadel wall, ledge buildings), build sheets / mist / churn, fountains in the basins
  //      published by the temple agent
  const finalize = () => {
    if (late || sunken) return late;
    const tl = performance.now();
    late = { groups: [], update: () => {}, sync: () => {} };
    try {
      let archMap = null, g2 = ground;
      try {
        const SOLID = ['terrain', 'temple', 'rings', 'bridges', 'city', 'sets'];
        let allow = null;
        if (engine.moduleRoots) { allow = new Set(); for (const n of SOLID) for (const r of engine.moduleRoots[n] || []) r.traverse((o) => allow.add(o)); }
        const R = SPOUT_R + 60;
        archMap = captureHeightMap(engine, { bounds: [-R, -R, R, R], res: 1600, filter: (o) => defaultTerrainFilter(o) && !o.userData.isWater && (!allow || allow.has(o)) });
        g2 = makeGround([archMap, maps.near, maps.far]);
      } catch (e) { console.warn('[water] architecture capture failed:', e.message); }
      const falls = traceCascades(engine, g2, specs, level);
      // r5: the water channel down the grand stair (citadel trough, ref 1) — guided along the published centreline
      const stair = buildStairWater(engine, g2, ground, level);
      if (stair) {
        falls.push(...stair.falls);
        if (stair.poolMesh) { engine.add(stair.poolMesh, { castShadow: false, receiveShadow: true }); late.groups.push(stair.poolMesh); }
        late.stairU = stair.uniforms;
      }
      // r6: the lion-head / shed spouts published by the rings module (registry.rings.spouts: canal quay walls, ref 2; ship-shed
      // piers incl. the shed mole in shot 4) — small jets arcing into the water
      const ringSpouts = ringSpoutSpecs(engine);
      if (ringSpouts.length) {
        const rf = traceCascades(engine, g2, ringSpouts, level).filter((f) => f.impact);
        for (const f of rf) { f.impact.strength = Math.min(f.impact.strength, 0.5); f.impact.radius = Math.min(f.impact.radius * 0.6, 2.2); }
        falls.push(...rf);
        late.ringSpouts = rf.length;
      }
      const cm = buildCascadeMeshes(engine, falls, { maps, ground: g2, shadowMap: archMap, level });
      engine.add(cm.group, { castShadow: false, receiveShadow: false });
      late.groups.push(cm.group);
      const imps = falls.map((f) => f.impact).filter(Boolean);
      late.impacts = [...imps, ...extraImpacts];
      water.setImpacts(pickImpacts(late.impacts, null));
      const fn = buildFountains(engine, { maps, basins: engine.registry.fountains });
      if (fn) { engine.add(fn.group, { castShadow: false, receiveShadow: true }); late.groups.push(fn.group); }
      // r3: hero trireme (shot 2, ref 2): breaking bow wave and oar churn (the ships module registers the wake)
      for (const w of water.wakes) if (w.id === 'hero' && !w.foam) w.foam = HERO_FOAM;
      water.syncWakes();
      const bow = buildBowSpray(engine, maps, water.wakes, level);
      if (bow) { engine.add(bow.mesh, { castShadow: false, receiveShadow: false }); late.groups.push(bow.mesh); }
      // r5: the hero trireme advances during its segment (ships: registry.ships.hero.offsetAt(t)): the bow spray (built at
      // the hull's position at this instant) rides with it; the shader wake follows through the addWake handle
      const heroR = engine.registry.ships?.hero;
      const heroRec = water.wakes.find((w) => w.id === 'hero');
      const bow0 = heroRec && heroR?.bowAt ? [heroRec.x, heroRec.z] : null;   // (where the spray was built)
      const moveBow = (t) => {
        if (!bow || !bow0) return;
        const o = heroR.bowAt(t);
        if (o && Number.isFinite(o[0]) && Number.isFinite(o[1])) bow.uniforms.uOffset.value.set(o[0] - bow0[0], 0, o[1] - bow0[1]);
      };
      late.update = (t) => { cm.update(t); fn?.update(t); if (bow) { bow.uniforms.uTime.value = t; moveBow(t); } if (stair) stair.uniforms.uTime.value = t; };
      late.sync = () => {
        cm.sync();
        if (bow && cm.mistUniforms) { bow.uniforms.uSunCol.value.copy(cm.mistUniforms.uSunCol.value); bow.uniforms.uSkyAmb.value.copy(cm.mistUniforms.uSkyAmb.value); }
      };
      late.update(engine.time);
      reg.cascades = falls.map((f) => ({ id: f.id, kind: f.kind, lip: f.lip, impact: f.impact, width: f.width, drop: f.drop }));
      reg.fountains = fn?.basins || [];
      reg.traced = falls;   // (look-dev: the traced streams)
      reg.archGround = g2;
      console.log(`[water] late build ${Math.round(performance.now() - tl)} ms: ${falls.length} cascades (${imps.length} impacts, ${Math.round(cm.tris)} sheet tris, ${cm.puffs} mist puffs${archMap ? ', arch capture ' + archMap.ms + ' ms / ' + archMap.meshes + ' meshes' : ''}), ${fn ? fn.basins.length + ' fountains' : 'no fountains'}, ${late.ringSpouts || 0} ring spouts`);
    } catch (e) { console.error('[water] late build failed:', e.stack || e); }
    return late;
  };

  // look-dev: a shot may carry { waterDebug: n, waterTune: { uniform: value }, underTune: {...} }
  const debug0 = water.uniforms.uDebug.value;
  let ptune = {};
  try { ptune = JSON.parse(engine.params?.get?.('waterTune') || '{}'); } catch (e) { console.warn('[water] bad waterTune param'); }
  engine.onShot((shot) => {
    finalize();
    late?.sync();
    // r6: the shader takes MAX_IMPACTS: keep the strongest weighted by closeness to this shot's camera (the small quay spouts
    // of shots 2 / 4 would otherwise lose to the distant hill falls)
    if (late?.impacts && shot.pos) water.setImpacts(pickImpacts(late.impacts, shot.pos));
    const U = water.uniforms;
    U.uDebug.value = shot.waterDebug ?? debug0;
    // r3: per-shot water look (restore the defaults of every tuned key first)
    // (r7: also the keys of look-dev waterTune overrides — they stuck across shots in a session)
    for (const t of [...Object.values(SHOT_TUNE), ptune, shot.waterTune || {}]) for (const k of Object.keys(t)) if (U[k] && !(k in tuneDefaults)) tuneDefaults[k] = U[k].value?.clone ? U[k].value.clone() : U[k].value;
    for (const [k, v] of Object.entries(tuneDefaults)) { if (U[k].value?.copy) U[k].value.copy(v); else U[k].value = v; }
    for (const [k, v] of Object.entries(SHOT_TUNE[shot.id] || {})) setU(U, k, v);
    for (const [k, v] of Object.entries({ ...ptune, ...(shot.waterTune || {}) })) setU(U, k, v);
    if (underside) for (const [k, v] of Object.entries(shot.underTune || {})) setU(underside.uniforms, k, v);
    const sky = engine.registry.skyEnvScale;
    if (sky) U.uEnvBoost.value = 1 / sky;
    if (sky && late?.stairU) late.stairU.uEnv.value = 1 / sky;
  });

  const extraImpacts = [];
  const reg = engine.registry.water = {
    level, era: engine.era, maps, shore, ground, depthAt, shoreDist,
    addWake: water.addWake, setWakes: water.setWakes, wakes: water.wakes,
    syncWakes: water.syncWakes,   // r6: call after editing wakes[] records in place (trail / broken / speed)
    addImpact: (im) => { extraImpacts.push(im); return water.addImpact(im); },
    surface: water.surface, uniforms: water.uniforms, reflection, ocean, waves, WAVES_GLSL,
    surfaceHeight: (x, z, t = engine.time) => {
      if (!sunken) return level + swellHeight(swellFromUniforms(waves), x, z, t);
      let h = 0;   // mirror of uwWaveH() (core/underwater.js)
      for (const w of UW.uUwWaves?.value || []) h += w.z * Math.sin(w.x * x + w.y * z - Math.sqrt(9.81 * Math.hypot(w.x, w.y)) * t + w.w);
      return level + h;
    },
    underside: underside?.mesh || null, undersideUniforms: underside?.uniforms || null,
    cascades: cascades.map((f) => ({ id: f.id, kind: f.kind, lip: f.lip, impact: f.impact, width: f.width, drop: f.drop })),
    spouts: specs.filter((s) => s.kind === 'spout').map((s) => ({ id: s.id, pos: s.from, bearing: s.bearing, width: s.width })),
    spoutR: SPOUT_R, spoutY: SPOUT_Y,
    finalize,
    heightTexture: maps.near.tex, heightBounds: maps.near.bounds,
  };
  const ms = Math.round(performance.now() - t0);
  console.log(`[water] built in ${ms} ms (${engine.era}, level ${level}; capture ${Math.round(t1 - t0)} ms: near ${maps.near.W}x${maps.near.H} ${maps.near.meshes} meshes${maps.near.analyticFill ? ' analytic fill ' + maps.near.analyticFill : ''}, shore ${shore.near.ms}+${shore.far.ms} ms; ${cascades.length} cascades traced)`);
}

const MAX_IMP = 48;
function pickImpacts(list, cam) {
  const pr = (im) => (im.strength || 0) * (cam ? 1 / (1 + Math.hypot(im.x - cam[0], im.z - cam[2]) / 250) : 1);
  return [...list].filter(Boolean).sort((a, b) => pr(b) - pr(a)).slice(0, MAX_IMP);
}

// r6: specs for the spouts the rings module publishes (lion heads on the canal embankments 4.2 m above the 5 m quay → a jet
// that clears the quay, ref 2; shed-pier spouts 2.8 m over the water → a short pour)
function ringSpoutSpecs(engine) {
  const out = [];
  for (const sp of engine.registry.rings?.spouts || []) {
    if (!sp?.pos) continue;
    const canal = /canal/.test(sp.id || '');
    out.push({
      id: sp.id || `ring-spout-${out.length}`, from: sp.pos, dir: sp.dir, kind: 'spout', snap: false,
      width: canal ? Math.max(1.1, sp.width || 0.7) : Math.max(0.55, (sp.width || 0.35) * 1.6), flow: Math.min(0.7, sp.flow ?? 0.5),
      v0: canal ? 6.2 : 1.9, fan: canal ? 0.6 : 0.2, widen: 0.35, widenDrop: canal ? 4 : 2.5, aer: 1.4, small: true,
    });
  }
  return out;
}

// r5: the water of the citadel's stair channel (registry.temple.stairChannel, temple.js stairChannelPlan): guided chute
// sheets, basin water, and the pour from the spout lip into water ring 1
function buildStairWater(engine, ground, bare, level) {
  try {
    const ch = stairChannelSpec(engine);
    if (!ch) { console.log('[water] no stair channel published (registry.temple.stairChannel)'); return null; }
    const sw = buildStairChannelWater(engine, ch, { mergeGeometries });
    for (const f of sw.falls) f.ground = sw.sheetGround;
    const falls = [...sw.falls];
    if (sw.pour) {
      // (the w1-180 ring bridge deck spans over the spout: its captured top would read as a wall — under anything higher
      //  than the lip, fall back to the bare terrain)
      const y0 = sw.pour.from[1];
      const N = (x, z, e = 0.8) => { const hx = pg.H(x + e, z) - pg.H(x - e, z), hz = pg.H(x, z + e) - pg.H(x, z - e); const l = Math.hypot(hx, 2 * e, hz); return [-hx / l, 2 * e / l, -hz / l]; };
      const pg = { H: (x, z) => { const h = ground.H(x, z); return h > y0 + 0.6 ? bare.H(x, z) : h; }, N };
      falls.push(...traceCascades(engine, pg, [sw.pour], level));
    }
    console.log(`[water] stair channel: ${sw.falls.length} chutes, ${ch.pools.length} basins, width ${(ch.half * 2).toFixed(1)} m${falls.length > sw.falls.length ? ', pour into w1' : ''}`);
    return { falls, poolMesh: sw.poolMesh, uniforms: sw.uniforms };
  } catch (e) { console.warn('[water] stair channel failed:', e.stack || e.message); return null; }
}

// ------------------------------------------------------------------ isolated test
// views (golden unless noted): 0 aerial over the canal mouth (ref 1), 1 inner ring water level (ref 4),
// 2 canal water level (ref 2), 3 cascades close-up, 4 fountains, 5 sunken from below (era=sunken),
// 6 sunken from just above at dusk (era=sunken), 7 sea wakes close
const lk = (id) => { const l = LOOKS[id] || {}; return { sun: l.sun, sky: l.sky, grade: l.grade, atmo: l.atmo, envIntensity: l.envIntensity }; };
export const TEST_VIEWS = [
  { ...lk(1), pos: [0, 430, 1750], target: [0, 10, 80], fov: 42 },
  { ...lk(4), pos: [505, 1.8, 140], target: [455, 16, -160], fov: 42 },
  { ...lk(2), pos: [-8, 2.6, 905], target: [0, 24, 600], fov: 44 },
  { ...lk(5), pos: [118, 3.5, 252], target: [30, 22, 150], fov: 50 },
  { ...lk(3), pos: [-6, 50, 104], target: [-22, 46, 78], fov: 50 },
  { ...lk(6), pos: [34, 49, 150], target: [0, 62, 10], fov: 60 },
  { ...lk(9), pos: [0, 64.4, 125], target: [-60, 62, 0], fov: 62 },
  { ...lk(1), pos: [120, 60, 1150], target: [0, 0, 950], fov: 40 },
];

export async function buildTestTerrain(engine) {
  for (const o of engine.scene.children) if (o.name === 'testGround') o.visible = false;
  try {
    const terrain = await import('./terrain.js');
    await terrain.build(engine);
    return 'terrain module';
  } catch (e) {
    console.warn('[water test] terrain module unavailable, using a heightAt mesh:', e.message);
    const { heightAt } = await import('../world/heightfield.js');
    const { proceduralMaterial } = await import('../core/materials.js');
    const mat = proceduralMaterial({
      name: 'waterTestGround', params: { color: 0xffffff, roughness: 0.95 },
      color: `float h = cgP.y; float s = 1.0 - cgN.y;
        vec3 sand = vec3(0.62, 0.58, 0.48), rock = vec3(0.42, 0.40, 0.36), grass = vec3(0.12, 0.16, 0.07);
        vec3 c = h < 0.5 ? sand : mix(grass, rock, smoothstep(0.15, 0.4, s));
        diffuseColor.rgb = c * (0.8 + 0.3 * cgVnoise2(cgP.xz * 0.3));`,
    });
    mat.userData.sunken = 'stone';
    const mk = (x0, z0, x1, z1, nx, nz) => {
      const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz).rotateX(-Math.PI / 2);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i) + (x0 + x1) / 2, z = p.getZ(i) + (z0 + z1) / 2; p.setXYZ(i, x, heightAt(x, z), z); }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat); m.name = 'terrain';
      engine.add(m);
    };
    mk(-1100, -1000, 1100, 1400, 1100, 1200);
    // coarse far field (outer ring of tiles, skipping the near box)
    for (const [x0, z0, x1, z1] of [[-7000, -7000, 7000, -1000], [-7000, 1400, 7000, 7000], [-7000, -1000, -1100, 1400], [1100, -1000, 7000, 1400]]) mk(x0, z0, x1, z1, Math.round((x1 - x0) / 40), Math.round((z1 - z0) / 40));
    return 'analytic';
  }
}

/** simple stand-ins for the architecture the water touches (walls, a hull) in the isolated test */
function testProps(engine, sunken) {
  const g = new THREE.Group(); g.name = 'waterTestProps';
  const stone = new THREE.MeshStandardMaterial({ color: 0xc9b9a0, roughness: 0.8 });
  stone.userData.sunken = 'stone';
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(L.CITADEL.wall.r + 1, L.CITADEL.wall.r + 1, L.CITADEL.wall.height, 160, 1, true), stone);
  wall.position.y = L.CITADEL.quayY + L.CITADEL.wall.height / 2; wall.material.side = THREE.DoubleSide;
  g.add(wall);
  // two lighthouse towers on the moles
  for (const m of L.MOLES) { const t = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 46, 24), stone); t.position.set(m.lighthouse[0], 23, m.lighthouse[1]); g.add(t); }
  if (!sunken) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.7 }); wood.userData.sunken = 'wood';
    const hulls = [[0, 980, 0, 4.5], [-30, 1250, 20, 5], [160, 1400, 345, 3], [-210, 1300, 15, 4]];
    for (const [x, z, hd, sp] of hulls) {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 34), wood);
      const a = (hd * Math.PI) / 180;
      hull.position.set(x - Math.sin(a) * 17, 0.6, z + Math.cos(a) * 17);
      hull.rotation.y = -a;
      g.add(hull);
      engine.registry.water.addWake({ pos: [x, z], heading: hd, length: 34, beam: 5, speed: sp, oars: sp > 4 });
    }
  }
  engine.add(g);
}

export async function test(engine) {
  const src = await buildTestTerrain(engine);
  engine.params.get('era') && (engine.era = engine.params.get('era'));
  await build(engine);
  testProps(engine, isSunken(engine));
  // (the clouds module points ATMO.uSunDir at the art-directed visible sun in the world build; mimic it here)
  const { SKY } = await import('../core/sky.js');
  const { ATMO } = await import('../core/atmosphere.js');
  engine.onShot(() => { if (SKY.uSunDiskMode.value > 0.5) ATMO.uSunDir.value.copy(SKY.uSunDiskDir.value).normalize(); });
  console.log('[water test] terrain: ' + src);
  return { views: TEST_VIEWS };
}
