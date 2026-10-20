// Reef scatter for the sunken era.
//  * surfaceMap(): renders the already-built world from straight above (orthographic, world-Y + up-normal into a
//    float target) so corals sit on the REAL top surfaces — sand, paving, steps, rubble, fallen columns, the head —
//    without knowing every module's geometry. Marine runs after the architecture modules (MODULE_ORDER).
//  * density(): hero density around the sunken shot cameras (src/world/shots.js), falling off with distance and
//    behind the camera (visibility ≈ 80 m: nothing far needs detail).
//  * cluster recipes: mixed reef patches on stone, sparse heads + sea grass on sand, wall growth for slots.
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { noiseA, noiseB } from '../core/noise.js';

const V = THREE.Vector3;
const UP = new V(0, 1, 0);

// ------------------------------------------------------------------ top-down surface map
const MAP_VS = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
varying vec3 vW;
void main() {
  #include <batching_vertex>
  vec4 p = vec4(position, 1.0);
  #ifdef USE_BATCHING
    p = batchingMatrix * p;
  #endif
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  vec4 w = modelMatrix * p;
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const MAP_FS = /* glsl */ `
varying vec3 vW;
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  gl_FragColor = vec4(vW.y, vW.x, vW.z, abs(n.y) + 2.0);
}`;

/**
 * @returns {{sample(x,z):{y,ny}|null, cx, cz, size, res}} or null when float targets are unavailable
 */
export function surfaceMap(engine, { cx, cz, size, res, top = L.SUNKEN.surface - 0.4, bottom = -80 }) {
  const { renderer, scene } = engine;
  res = Math.round(res);
  let rt;
  try {
    rt = new THREE.WebGLRenderTarget(res, res, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false });
  } catch (e) { console.warn('[marine] surfaceMap: no float target', e); return null; }
  const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0.02, top - bottom);
  cam.position.set(cx, top, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, top - 10, cz);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  const mat = new THREE.ShaderMaterial({ vertexShader: MAP_VS, fragmentShader: MAP_FS, side: THREE.DoubleSide });
  // hide what is not a growth substrate: sky, particles, lines, transparent / additive volumes, our own stuff
  const hidden = [];
  scene.traverse((o) => {
    if (!o.visible) return;
    let hide = o === engine.sky || o.isPoints || o.isLine || o.isSprite || o.userData.marineSkip;
    if (!hide && (o.isMesh || o.isInstancedMesh || o.isBatchedMesh)) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      if (ms.some((m) => m && (m.transparent || m.depthWrite === false || m.blending === THREE.AdditiveBlending || m.userData?.marineSkip))) hide = true;
    }
    if (hide) { hidden.push(o); o.visible = false; }
  });
  const prevRT = renderer.getRenderTarget(), prevCol = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
  const prevOverride = scene.overrideMaterial, prevAuto = renderer.shadowMap.autoUpdate, prevBg = scene.background;
  let buf = null;
  try {
    scene.overrideMaterial = mat; renderer.shadowMap.autoUpdate = false; scene.background = null;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, cam);
    buf = new Float32Array(res * res * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, res, res, buf);
  } catch (e) { console.warn('[marine] surfaceMap failed', e); buf = null; }
  finally {
    scene.overrideMaterial = prevOverride; renderer.shadowMap.autoUpdate = prevAuto; scene.background = prevBg;
    renderer.setRenderTarget(prevRT); renderer.setClearColor(prevCol, prevA);
    for (const o of hidden) o.visible = true;
    rt.dispose(); mat.dispose();
  }
  if (!buf) return null;
  const Y = new Float32Array(res * res), NY = new Float32Array(res * res);
  let valid = 0;
  for (let i = 0; i < res * res; i++) {
    const a = buf[i * 4 + 3];
    if (a > 1.5) { Y[i] = buf[i * 4]; NY[i] = a - 2; valid++; } else { Y[i] = NaN; NY[i] = 0; }
  }
  const cell = size / res, x0 = cx - size / 2, z1 = cz + size / 2;
  // sanity: the stored world x/z of the centre pixel must match the mapping
  const ci = Math.floor(res / 2) * res + Math.floor(res / 2);
  const ex = buf[ci * 4 + 1] - (x0 + (Math.floor(res / 2) + 0.5) * cell), ez = buf[ci * 4 + 2] - (z1 - (Math.floor(res / 2) + 0.5) * cell);
  if (buf[ci * 4 + 3] > 1.5 && (Math.abs(ex) > cell * 2 || Math.abs(ez) > cell * 2)) console.warn(`[marine] surfaceMap mapping mismatch dx=${ex.toFixed(2)} dz=${ez.toFixed(2)}`);
  return {
    cx, cz, size, res, cell, valid,
    sample(x, z) {
      const i = Math.floor((x - x0) / cell), j = Math.floor((z1 - z) / cell);
      if (i < 0 || j < 0 || i >= res || j >= res) return null;
      const k = j * res + i;
      const y = Y[k];
      return Number.isNaN(y) ? null : { y, ny: NY[k] };
    },
    /** max height difference in a small neighbourhood (detect edges: don't grow over a drop) */
    rough(x, z, r) {
      const a = this.sample(x, z); if (!a) return 99;
      let m = 0;
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) { const b = this.sample(x + dx, z + dz); m = Math.max(m, b ? Math.abs(b.y - a.y) : 99); }
      return m;
    },
  };
}

/**
 * steepest drop around (x,z) on the map: {dir:[dx,dz], drop, dist} where dist = distance to the face (m), or null
 */
export function edgeAt(map, x, z, y, r = 0.7) {
  let best = null;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    const far = map.sample(x + dx * r, z + dz * r);
    if (!far) continue;
    const drop = y - far.y;
    if (drop < 0.25 || (best && drop <= best.drop)) continue;
    // march to the face
    let dist = r;
    for (let t = map.cell; t <= r; t += map.cell) { const q = map.sample(x + dx * t, z + dz * t); if (!q || y - q.y > 0.2) { dist = Math.max(0, t - map.cell * 0.5); break; } }
    best = { dir: [dx, dz], drop, dist, low: far.y };
  }
  return best;
}

/** growth on the vertical face below an edge (and on the crest) */
export function faceGrowth(lib, rng, x, z, y, e, w, lo, grow) {
  const n = new V(e.dir[0], 0, e.dir[1]);
  const fx = x + e.dir[0] * e.dist, fz = z + e.dir[1] * e.dist;
  const k = Math.min(3, 1 + Math.floor(Math.min(e.drop, 2.4) / 1.2 * rng.random() * 2));
  for (let i = 0; i < k; i++) {
    const h = Math.min(e.drop - 0.1, Math.min(e.drop, 2.2) * rng.range(0.08, 0.85)); // stay near the crest: deep drops may be overhangs (bridge decks)
    const side = new V(-n.z, 0, n.x).multiplyScalar(rng.range(-0.5, 0.5));
    const p = new V(fx + side.x, y - h, fz + side.z);
    const sp = pick(rng, ON_WALL);
    placeOne(lib, rng, sp, p, n, sizeFor(sp, rng, 0.8 * Math.sqrt(grow)), lo);
  }
  // crest
  if (rng.random() < 0.55) {
    const sp = pick(rng, CREST);
    placeOne(lib, rng, sp, new V(x + e.dir[0] * Math.max(0, e.dist - 0.15), y, z + e.dir[1] * Math.max(0, e.dist - 0.15)), UP, sizeFor(sp, rng, 0.85 * Math.sqrt(grow)), lo);
  }
}

// ------------------------------------------------------------------ ground (sand) height
export function groundY(engine, x, z) {
  const h = heightAt(x, z);
  const g = engine.registry.sandAt || engine.registry.terrain?.sandAt;
  if (typeof g === 'function') { try { const s = g(x, z); if (Number.isFinite(s)) return Math.max(h, s); } catch { /* */ } }
  return h;
}

// ------------------------------------------------------------------ density around the cameras
export function makeDensity(cams) {
  const C = cams.map((c) => {
    const p = new V(...c.pos), t = new V(...c.target);
    const f = new V().subVectors(t, p); f.y = 0; f.normalize();
    return { p, f, near: c.near ?? 38, far: c.far ?? 150 };
  });
  const dens = (x, y, z) => {
    let w = 0;
    for (const c of C) {
      const dx = x - c.p.x, dy = (y - c.p.y) * 0.6, dz = z - c.p.z;
      const d = Math.hypot(dx, dy, dz);
      const fr = (dx * c.f.x + dz * c.f.z) / Math.max(d, 1e-3);
      const front = d < 6 ? 1 : THREE.MathUtils.smoothstep(fr, -0.45, 0.35) * 0.85 + 0.15;
      const fall = d < c.near ? 1 : Math.max(0.03, Math.exp(-(d - c.near) / (c.far * 0.35)));
      w = Math.max(w, fall * front);
    }
    return w;
  };
  /** distance to the nearest sunken camera (m) — hero (full-detail) geometry only close to a lens */
  dens.dist = (x, y, z) => { let d = 1e9; for (const c of C) d = Math.min(d, Math.hypot(x - c.p.x, y - c.p.y, z - c.p.z)); return d; };
  return dens;
}

// ------------------------------------------------------------------ recipes
const pick = (rng, table) => {
  let s = 0; for (const k in table) s += table[k];
  let r = rng.random() * s;
  for (const k in table) { r -= table[k]; if (r <= 0) return k; }
  return Object.keys(table)[0];
};
// base sizes (instance scale multipliers) per species
// the city is scaled for camera reading (colossal statues, 5 m fountains): reef growth is scaled up with it
const BASE = { finger: 2.0, brain: 1.6, table: 1.6, whorl: 1.7, staghorn: 2.0, bush: 2.0, softtree: 2.1, whip: 1.8, tube: 1.8, barrel: 1.6, lump: 1.8, anemone: 1.6, urchin: 1.4, fan: 1.9, grass: 1.15 };
const ON_STONE = { bush: 0.2, softtree: 0.17, finger: 0.14, whorl: 0.1, lump: 0.11, tube: 0.1, brain: 0.07, fan: 0.07, anemone: 0.05, urchin: 0.04, staghorn: 0.04, whip: 0.03, table: 0.02, barrel: 0.015 };
const SATELLITE = { finger: 0.12, lump: 0.14, bush: 0.17, softtree: 0.14, tube: 0.12, anemone: 0.1, urchin: 0.08, whorl: 0.09, fan: 0.06, grass: 0.06 };
const ON_SAND = { finger: 0.06, brain: 0.22, lump: 0.18, staghorn: 0.12, table: 0.1, barrel: 0.08, urchin: 0.1, anemone: 0.06, softtree: 0.06, whip: 0.05, tube: 0.03 };
const CREST = { bush: 0.22, softtree: 0.22, finger: 0.12, fan: 0.12, whip: 0.08, tube: 0.1, anemone: 0.07, urchin: 0.04, lump: 0.05 };
const ON_WALL = { fan: 0.26, whorl: 0.24, softtree: 0.16, tube: 0.12, lump: 0.1, bush: 0.07, anemone: 0.05 };

function sizeFor(species, rng, k = 1) { return BASE[species] * rng.range(0.6, 1.45) * k; }

/** orientation for a species placed on a surface with normal n */
function axisFor(species, n, rng) {
  if (species === 'fan' || species === 'whip' || species === 'softtree') {
    // grow up-ish even from walls
    return n.clone().lerp(UP, n.y > 0.6 ? 0.85 : 0.45).add(new V(rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15))).normalize();
  }
  if (species === 'grass') return n.clone().lerp(UP, 0.7).normalize();
  return n.clone().add(new V(rng.range(-0.08, 0.08), 0, rng.range(-0.08, 0.08))).normalize();
}

/** fans face across the dominant surge (yaw about the growth axis) */
function yawFor(species, rng) { return species === 'fan' ? 0.5 + rng.range(-0.5, 0.5) : rng.range(0, Math.PI * 2); }

export function placeOne(lib, rng, species, p, n, scale, lo = false) {
  const ax = axisFor(species, n, rng);
  const sink = species === 'grass' ? 0.01 : 0.04 * scale;
  const pos = new V(p.x, p.y, p.z).addScaledVector(n, -sink);
  lib.place(species, pos, ax, scale, yawFor(species, rng), null, null, rng, lo);
}

/**
 * reef patch around p on a surface with normal n. mode 'stone' | 'sand' | 'wall'. radius in m. map → re-sample
 * heights for satellites on horizontal surfaces. lod 0..1 (1 = hero detail).
 */
export function reefCluster(lib, rng, p, n, radius, mode, map, lod = 1, lo = false, grow = 1) {
  const table = mode === 'wall' ? ON_WALL : mode === 'sand' ? ON_SAND : ON_STONE;
  const prim = pick(rng, table);
  const k = THREE.MathUtils.clamp(radius / 0.8, 0.6, 1.8) * grow;
  placeOne(lib, rng, prim, p, n, sizeFor(prim, rng, k), lo);
  const nSat = Math.round((mode === 'sand' ? rng.range(0, 3) : rng.range(2, 7)) * lod * Math.min(2, radius / 0.6));
  const u = Math.abs(n.y) > 0.9 ? new V(1, 0, 0) : new V().crossVectors(n, UP).normalize();
  const w = new V().crossVectors(n, u);
  for (let i = 0; i < nSat; i++) {
    const a = rng.range(0, Math.PI * 2), r = radius * 1.6 * Math.sqrt(rng.range(0.15, 1));
    const q = new V(p.x, p.y, p.z).addScaledVector(u, Math.cos(a) * r).addScaledVector(w, Math.sin(a) * r);
    let nn = n;
    if (map && n.y > 0.7) {
      const s = map.sample(q.x, q.z);
      if (!s || s.ny < 0.6 || Math.abs(s.y - p.y) > 0.5) continue;
      q.y = s.y;
    }
    const sp = pick(rng, SATELLITE);
    placeOne(lib, rng, sp, q, nn, sizeFor(sp, rng, 0.75 * Math.sqrt(grow)), lo);
  }
}

/** sea-grass meadow patch */
export function grassPatch(lib, rng, p, radius, map, count, lo = false) {
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2), r = radius * Math.sqrt(rng.random());
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    let y = p.y;
    if (map) { const s = map.sample(x, z); if (!s || s.ny < 0.8 || Math.abs(s.y - p.y) > 0.4) continue; y = s.y; }
    lib.place('grass', new V(x, y, z), UP, rng.range(0.7, 1.4), rng.range(0, 6.28), null, null, rng, lo);
  }
}

export function kelpAt(lib, rng, x, y, z, { maxH = null, lo = false } = {}) {
  const avail = (maxH ?? (L.SUNKEN.surface - y)) - rng.range(2, 9);
  if (avail < 6) return false;
  const Hs = [62, 52, 44, 36, 28, 20];
  let vi = Hs.findIndex((h) => h <= avail * 1.12);
  if (vi < 0) vi = Hs.length - 1;
  const s = THREE.MathUtils.clamp(avail / Hs[vi], 0.75, 1.15);
  return lib.place('kelp', new V(x, y - 0.1, z), UP, s, rng.range(0, 6.28), null, vi, rng, lo) !== false;
}

export function noise01(x, z, f, seed = 0) { return 0.5 + 0.5 * noiseA.noise2(x * f + seed * 17.3, z * f - seed * 9.1); }
export function noiseB01(x, z, f) { return 0.5 + 0.5 * noiseB.noise2(x * f, z * f); }
