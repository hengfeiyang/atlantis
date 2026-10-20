// FLORA: small-scale vegetation and hero foreground dressing.
//  - ivy curtains / column wraps / surface patches from engine.slots.ivy (+ the ruin columns)
//  - ground cover (wild grass, yellow wildflowers, lavender, rosemary, moss) around the hero cameras,
//    placed on the real top surfaces (GPU top-down surface map) and thickest in cracks and block bases
//  - hero olive branches framing shots 1, 2, 3, 6, 7, 8, 9 (camera-relative, see flora/heroes.js)
//  - foreground rock clusters with lichen, moss and grass (shots 1, 3, 7)
import * as THREE from 'three';
import { GeoBuilder, shotFrame } from '../flora/util.js';
import { growOlive } from '../flora/olive.js';
import { leafMaterial, barkMaterial, swayDepthMaterial, FLORA_U } from '../flora/foliage.js';
import { ivyAtlas } from '../flora/textures.js';
import { ivyCurtain, ivyColumn, ivyPatch } from '../flora/ivy.js';
import { grassTuft, yellowFlowers, lavender, rosemary, mossCushion, shrub } from '../flora/ground.js';
import { HERO_SPECS, oliveFromSpec, installHeroVisibility, shotById, regionFns, rockTopFn } from '../flora/heroes.js';
import { rockCluster } from '../flora/rocks.js';
import { surfaceMap, viewSurface } from '../flora/surface.js';
import { heightAt, waterSDF } from '../world/heightfield.js';
import { SHOTS } from '../world/shots.js';
import { dirFromAzEl } from '../world/layout.js';
import { RNG } from '../core/rng.js';
import { noiseA, noiseB, noiseC } from '../core/noise.js';

const V = THREE.Vector3;
let MATS = null;
let DBG = '';

export function floraMaterials() {
  if (MATS) return MATS;
  const atlas = ivyAtlas();
  MATS = {
    oliveLeaf: leafMaterial({
      name: 'oliveLeaf', kind: 'olive',
      top: [0.040, 0.050, 0.033], under: [0.135, 0.15, 0.12], trans: [0.12, 0.145, 0.05],
      roughTop: 0.42, roughUnder: 0.75,
    }),
    ivyLeaf: leafMaterial({
      name: 'ivyLeaf', kind: 'ivy', map: atlas,
      under: [0.10, 0.12, 0.07], trans: [0.11, 0.14, 0.03], roughTop: 0.48, roughUnder: 0.75, specTop: 0.45, specUnder: 0.2,
    }),
    herb: leafMaterial({
      name: 'herbLeaf', kind: 'grass', midrib: 0.4,
      top: [1, 1, 1], under: [0.92, 0.92, 0.86], trans: [0.42, 0.38, 0.10], roughTop: 0.6, roughUnder: 0.75, specTop: 0.45, specUnder: 0.35,
    }),
    moss: leafMaterial({
      name: 'mossCushion', kind: 'moss', midrib: 0,
      top: [1, 1, 1], under: [1, 1, 1], trans: [0.12, 0.14, 0.02], roughTop: 0.95, roughUnder: 0.95, specTop: 0.2, specUnder: 0.2,
    }),
    bark: barkMaterial(),
  };
  MATS.ivyDepth = swayDepthMaterial(atlas, 0.5);
  MATS.leafDepth = swayDepthMaterial();
  for (const m of Object.values(MATS)) if (m.userData) m.userData.isFoliage = true;
  return MATS;
}

function meshFrom(B, mat, { cast = true, receive = true, depth = null, name = '' } = {}) {
  const m = new THREE.Mesh(B.toGeometry(), mat);
  m.name = name;
  m.castShadow = cast; m.receiveShadow = receive;
  m.userData.castShadow = cast; m.userData.receiveShadow = receive;
  if (depth && !DBG.includes('nodepth')) m.customDepthMaterial = depth;
  return m;
}

// ------------------------------------------------------------------ species library (instanced)
function buildLibrary(q) {
  const det = q.detail;
  const lib = { near: {}, mid: {}, far: {} };
  const R = (s) => new RNG('flora-lib-' + s);
  lib.near.grass = [0, 1, 2, 3, 4, 5].map((i) => grassTuft(R('g' + i), { blades: Math.round((40 + i * 7) * (0.6 + 0.4 * det)), height: 0.2 + i * 0.045, radius: 0.04 + i * 0.012, dry: [0.08, 0.2, 0.35, 0.12, 0.5, 0.25][i], seedHeads: [0.1, 0.3, 0.6, 0.1, 0.7, 0.2][i], detail: det }));
  lib.mid.grass = [0, 1, 2, 3].map((i) => grassTuft(R('gm' + i), { blades: 16 + i * 3, height: 0.26 + i * 0.06, radius: 0.06, dry: [0.2, 0.45, 0.65, 0.3][i], seedHeads: 0, detail: 0.3 }));
  lib.far.grass = [0, 1, 2].map((i) => grassTuft(R('gf' + i), { blades: 9, height: 0.3 + i * 0.08, radius: 0.07, dry: [0.2, 0.5, 0.7][i], seedHeads: 0, detail: 0.2 }));
  lib.near.yellow = [0, 1, 2].map((i) => yellowFlowers(R('y' + i), { stems: 9 + i * 4, height: 0.28 + i * 0.07, detail: det }));
  lib.near.lavender = [0, 1].map((i) => lavender(R('l' + i), { stems: 14 + i * 10, height: 0.3 + i * 0.1, detail: det }));
  lib.near.rosemary = [0, 1].map((i) => rosemary(R('r' + i), { stems: 9 + i * 5, height: 0.45 + i * 0.2, detail: det }));
  lib.near.moss = [0, 1, 2].map((i) => mossCushion(R('m' + i), { r: 0.12 + i * 0.06, h: 0.04 + i * 0.015 }));
  // evergreen shrub mounds (lentisk / myrtle / cistus / sage): leaf count and size per distance tier
  const SH = [[0.32, 0.42, 0], [0.45, 0.55, 0.12], [0.55, 0.62, 0.55], [0.7, 0.8, 0.2]];
  // (triangle budget: near ~3-6 k, mid ~1 k, far ~0.2 k tris per instance)
  lib.near.shrub = SH.map(([r, h, g], i) => shrub(R('s' + i), { r, h, grey: g, leaves: Math.round((380 + 220 * i) * (0.6 + 0.4 * det)), leafLen: 0.065 + 0.008 * i, detail: Math.min(det, 0.6) }));
  // (r5) mid tier: twice the leaves at ~2/3 the size — at 11-32 m the big diamonds read as low-poly
  lib.mid.shrub = SH.map(([r, h, g], i) => shrub(R('s' + i), { r, h, grey: g, leaves: Math.round((260 + 120 * i) * (0.7 + 0.3 * det)), leafLen: 0.085 + 0.008 * i, detail: 0.3 }));
  lib.far.shrub = SH.slice(0, 3).map(([r, h, g], i) => shrub(R('s' + i), { r, h, grey: g, leaves: 24 + 6 * i, leafLen: 0.4 + 0.03 * i, detail: 0.1 }));
  lib.mid.yellow = lib.near.yellow; lib.mid.lavender = lib.near.lavender; lib.mid.rosemary = lib.near.rosemary; lib.mid.moss = lib.near.moss;
  return lib;
}

/** instance collector: kind → variant → [matrix, color] */
class Placer {
  constructor() { this.items = new Map(); }
  add(set, kind, v, pos, rotY, scale, tilt = null, color = null) {
    const key = set + ':' + kind + ':' + v;
    if (!this.items.has(key)) this.items.set(key, []);
    const q = new THREE.Quaternion().setFromAxisAngle(new V(0, 1, 0), rotY);
    if (tilt) q.premultiply(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), tilt));
    const m = new THREE.Matrix4().compose(pos, q, new V(scale, scale * (color?.hs ?? 1), scale));
    this.items.get(key).push({ m, c: color });
  }
  meshes(lib, M) {
    const out = [];
    let tris = 0;
    for (const [key, list] of this.items) {
      const [set, kind, v] = key.split(':');
      const geo = lib[set][kind][+v];
      const mat = kind === 'moss' ? M.moss : M.herb;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.name = 'flora-' + kind;
      list.forEach((it, i) => {
        im.setMatrixAt(i, it.m);
        im.setColorAt(i, new THREE.Color(it.c?.r ?? 1, it.c?.g ?? 1, it.c?.b ?? 1));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = kind !== 'moss' && set === 'near';
      im.frustumCulled = true;
      im.receiveShadow = true;
      im.userData.castShadow = im.castShadow;
      if (!DBG.includes('nodepth')) im.customDepthMaterial = M.leafDepth;
      out.push(im);
      tris += (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3) * list.length;
    }
    return { meshes: out, tris };
  }
}

// ------------------------------------------------------------------ ground-cover scatter
// spots kept free of ground cover: the crown of the shot-8 fallen head (its wreath locks must read)
const COVER_AVOID = [{ x: 133.1, z: 140.0, r: 2.5, yMin: 53.8 }];
/**
 * Scatter ground cover over a square area, weighted by visibility from the given shot cameras.
 * o: { cx, cz, size, spacing, shots:[ids], maxDist, surf (surfaceMap), rng, base (0..1 density away from cams),
 *      mix: { yellow, lavender, rosemary, moss }, onlyNear: fn(x,z)->weight multiplier }
 */
function scatterCover(P, o, q) {
  const frames = o.shots.map((id) => shotFrame(shotById(id)));
  // shots whose lens must stay clear of tall plants (refs show an open floor right in front of them)
  // entries: shot id, or [id, nearClear (m), shrubClear (m)] for lenses that need a wider open zone
  const clearFrames = (o.clear ?? o.shots).map((c) => (Array.isArray(c) ? c : [c, 4, 7])).filter((c) => shotById(c[0]))
    .map(([id, ln, ls]) => Object.assign(shotFrame(shotById(id)), { ln, ls }));
  const sp = o.spacing / Math.sqrt(q.density);
  const n = Math.floor(o.size / sp);
  const rng = o.rng;
  let placed = 0; const REJ = { w: 0, n: 0, p: 0 };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = o.cx - o.size / 2 + (i + rng.random()) * sp;
    const z = o.cz - o.size / 2 + (j + rng.random()) * sp;
    // visibility weight from the hero cameras
    let w = o.base ?? 0.0, dmin = 1e9;
    let y = o.surf.h(x, z);
    for (const F of frames) {
      const pr = F.project(new V(x, y, z));
      if (pr.d < 0.5) continue;
      dmin = Math.min(dmin, pr.d);
      if (Math.abs(pr.x) > 1.15 || Math.abs(pr.y) > 1.2) continue;
      const k = pr.d < 12 ? 1 : Math.max(0, 1 - (pr.d - 12) / (o.maxDist - 12));
      w = Math.max(w, k);
    }
    if (o.weight) w *= o.weight(x, z);
    if (w <= 0.001) { REJ.w++; continue; }
    if (waterSDF(x, z) < 1.5 && y < 0.5) continue;
    if (COVER_AVOID.some((a) => y > a.yMin && Math.hypot(x - a.x, z - a.z) < a.r)) continue;
    const nrm = o.surf.normal(x, z, 0.25);
    if (nrm[1] < 0.72) { REJ.n++; continue; }
    const ground = heightAt(x, z);
    const onTop = y > ground + 0.6;               // on a block / wall / step top
    const edge = o.surf.edge(x, z, 0.35);          // a step or block base nearby
    const lowSide = edge > 0.12 && o.surf.h(x, z) <= Math.min(o.surf.h(x + 0.35, z), o.surf.h(x - 0.35, z), o.surf.h(x, z + 0.35), o.surf.h(x, z - 0.35)) + 0.05;
    if (o.edgesOnly && !lowSide) { REJ.p++; continue; }
    // patchy meadow: fbm mask makes clumps and bare patches
    const meadow = 0.5 + 0.5 * noiseA.fbm2(x / 7, z / 7, 3);
    let pKeep = w * (0.25 + 0.95 * meadow * meadow) * (o.boost ?? 1);
    if (onTop) pKeep *= o.topFactor ?? 0.18;
    if (lowSide) pKeep = Math.min(1, pKeep * 2.6 + 0.25 * w);
    if (rng.random() > pKeep) { REJ.p++; continue; }
    const far = dmin > (o.farDist ?? 32);
    const tier = far ? 'far' : dmin > (o.nearDist ?? 11) ? 'mid' : 'near';
    // species
    const nY = noiseB.fbm2(x / 5 + 11, z / 5, 2), nL = noiseC.fbm2(x / 6 - 7, z / 6, 2), nR = noiseA.fbm2(x / 9 + 3, z / 9 - 5, 2);
    const M = o.mix || {};
    let kind = 'grass';
    const r = rng.random();
    const nS = noiseC.fbm2(x / 8 - 13, z / 8 + 4, 2);
    if ((!onTop || M.shrubTop) && !M.mossy && nS > 0.22 - (M.shrub ?? 0) && rng.random() < (far ? 0.45 : 0.3)) kind = 'shrub';
    else     if (!far && nR > 0.42 - (M.rosemary ?? 0) && r < 0.35) kind = 'rosemary';
    else if (!far && nY > 0.2 - (M.yellow ?? 0) && r < 0.55) kind = 'yellow';
    else if (!far && nL > 0.3 - (M.lavender ?? 0) && r < 0.45) kind = 'lavender';
    else if (!far && (lowSide || onTop) && r < (M.moss ?? 0.25)) kind = 'moss';
    if (M.mossy && !far) kind = rng.random() < M.mossy ? 'moss' : 'grass';
    // tall plants must not block the view right in front of a hero lens
    // (the plant top matters, not its base: a base below the frame edge can still grow into view)
    // lensK: 0 at the lens .. 1 at the edge of that lens' clear zone (scaled per lens)
    let lensK = 1e9, lensS = 1e9;
    for (const F of clearFrames) {
      const pr = F.project(new V(x, y, z));
      if (pr.d > 0 && Math.abs(pr.x) < 1.1) { lensK = Math.min(lensK, pr.d / F.ln); lensS = Math.min(lensS, pr.d / F.ls); }
    }
    if ((kind === 'shrub' && lensS < 1) || ((kind === 'rosemary' || kind === 'lavender' || kind === 'yellow') && lensK < 1)) kind = 'grass';
    if (kind === 'grass' && lensK < 1 && rng.random() < 0.6) continue; // keep the lens zone low and open
    const set = kind === 'grass' || kind === 'shrub' ? tier : tier === 'near' ? 'near' : 'mid';
    const variants = { grass: tier === 'far' ? 3 : tier === 'mid' ? 4 : 6, shrub: tier === 'far' ? 3 : 4, yellow: 3, lavender: 2, rosemary: 2, moss: 3 }[kind];
    const v = rng.int(0, variants - 1);
    const sLens = lensK < 1.25 ? 0.6 : 1;
    const s = sLens * (kind === 'grass' ? o.grassK ?? 1 : 1) * (kind === 'lavender' ? rng.range(0.5, 0.9) : kind === 'shrub' ? rng.range(0.6, 1.5) * (lowSide ? 1.2 : 1) : kind === 'rosemary' ? rng.range(0.7, 1.4) : kind === 'moss' ? rng.range(0.6, 1.6) : rng.range(0.65, 1.35) * (lowSide ? 1.15 : 1));
    const tilt = new V(nrm[0] * 0.6, 1, nrm[2] * 0.6).normalize();
    const tint = kind === 'grass' ? { r: rng.range(0.85, 1.12), g: rng.range(0.88, 1.08), b: rng.range(0.8, 1.05), hs: rng.range(0.8, 1.25) } : { r: rng.range(0.9, 1.1), g: rng.range(0.9, 1.1), b: rng.range(0.9, 1.1) };
    P.add(set, kind, v, new V(x, y - 0.02, z), rng.range(0, Math.PI * 2), s, tilt, tint);
    placed++;
    // clumping: grass tufts come in small groups
    if (kind === 'grass' && tier !== 'far' && rng.chance(0.35)) {
      const a = rng.range(0, 6.28), dd = rng.range(0.12, 0.3);
      const x2 = x + Math.cos(a) * dd, z2 = z + Math.sin(a) * dd;
      P.add(set, 'grass', rng.int(0, set === 'near' ? 5 : 3), new V(x2, o.surf.h(x2, z2) - 0.02, z2), rng.range(0, 6.28), s * rng.range(0.6, 0.9), tilt, tint);
      placed++;
    }
  }
  if (DBG.includes("log")) console.log("[flora] scatter rejections " + JSON.stringify(REJ) + " placed " + placed);
  return placed;
}

// ------------------------------------------------------------------ ivy on the fallen head (ref 8)
/** sample the ruins' fallen head surface where the reference shows ivy (right side, hair, temple) */
function headIvySlots(engine) {
  const head = engine.scene.getObjectByName('fallenHead');
  const shot = shotById(8);
  if (!head || !shot || !head.geometry?.attributes?.position) return [];
  head.updateWorldMatrix(true, false);
  const F = shotFrame(shot);
  const P = head.geometry.attributes.position, N = head.geometry.attributes.normal;
  const nm = new THREE.Matrix3().getNormalMatrix(head.matrixWorld);
  const stride = Math.max(1, Math.floor(P.count / 9000));
  const pts = [];
  const p = new V(), n = new V();
  for (let i = 0; i < P.count; i += stride) {
    p.fromBufferAttribute(P, i).applyMatrix4(head.matrixWorld);
    n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
    const pr = F.project(p);
    if (pr.d < 0.5) continue;
    // reference: ivy over the hair / temple / behind the eye and down the right side of the head
    const inBand = pr.x > 0.47 + 0.12 * Math.max(0, pr.y - 0.3) && pr.x < 1.05 && pr.y > -0.8 && pr.y < 0.66;
    if (!inBand) continue;
    const facing = -n.dot(F.fwd);
    if (facing < -0.15 && n.y < 0.3) continue;
    // patchy coverage (gaps of bare marble), denser toward the right edge
    const patch = 0.5 + 0.5 * noiseA.noise2(p.x * 0.9 + 3.1, p.y * 0.9 - p.z * 0.4);
    const w = THREE.MathUtils.clamp((pr.x - 0.47) / 0.18, 0, 1) * (0.35 + 0.8 * patch);
    if (hashf(i) > w) continue;
    pts.push({ p: [p.x, p.y, p.z], n: [n.x, n.y, n.z] });
  }
  return pts.length ? [{ pos: pts[0].p, points: pts, tag: 'ruins-head', leafScale: 2.0, density: 1.0, hang: true }] : [];
}
/** ivy curtains over the grand-stair parapets near the shot-6 camera (ref 6): inner faces drop onto the
 *  steps, outer faces drop down the cheek walls. Uses registry.acropolis.stair (plan) when present. */
function stairIvySlots(engine) {
  const R = engine.registry.acropolis;
  const plan = R?.stair;
  if (!plan || !plan.segs) return [];
  const rng = new RNG('flora-stair-ivy');
  const cam = shotById(6);
  const out = [];
  const T = 1.4;
  const lineSurf = (s, z) => (s.kind === 'flight' ? s.y0 - ((z - s.z0) / (s.z1 - s.z0)) * (s.y0 - s.y1) : s.y0);
  const surf = (x, z) => { const y = R.surface ? R.surface(z) : null; return y ?? heightAt(x, z); };
  for (const sg of plan.segs) {
    if (sg.kind === 'quay') continue;
    const zc = (sg.z0 + sg.z1) / 2;
    const near = cam ? Math.abs(zc - cam.pos[2]) : 0;
    const p = near < 60 ? 0.75 : near < 140 ? 0.45 : 0.25;
    const hw = sg.w / 2;
    for (const side of [-1, 1]) {
      for (let z = sg.z0 + 0.8; z < sg.z1 - 0.8; z += rng.range(3.0, 6.5)) {
        if (rng.random() > p) continue;
        const yTop = lineSurf(sg, z) + 1.42;
        // inner face (toward the stair axis)
        if (rng.random() < 0.7) {
          out.push({ pos: [plan.x + side * hw, yTop - 0.2, z], facing: side > 0 ? 270 : 90, size: rng.range(1.0, 1.7), width: rng.range(0.7, 2.2),
            offset: 0.02, topOffset: 0.2, tag: 'stair-parapet-in', ground: (x, zz) => surf(x, zz) });
        }
        // outer face of the cheek wall
        if (rng.random() < 0.6) {
          out.push({ pos: [plan.x + side * (hw + T), yTop - 0.2, z], facing: side > 0 ? 90 : 270, size: rng.range(2.5, 7), width: rng.range(1.2, 3.5),
            offset: 0.02, topOffset: 0.2, tag: 'stair-parapet-out' });
        }
      }
    }
  }
  return out;
}

/** ivy wrapping the ruined portico columns that frame shots 9 (left) and 3 (left): found by shape in the
 *  ruins module's meshes (tall + narrow bounding box), used when the ruins provide no column slots. */
function columnIvySlots(engine) {
  const roots = engine.moduleRoots?.ruins || [];
  if (!roots.length || (engine.slots.ivy || []).some((s) => /column/.test(String(s.tag || '')))) return [];
  const frames = [[9, -0.35], [3, -0.55]].map(([id, xMax]) => ({ F: shotById(id) ? shotFrame(shotById(id)) : null, xMax }));
  const out = [];
  const box = new THREE.Box3(), c = new V();
  const seen = [];
  for (const r of roots) r.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh || noIvy(m)) return;
    box.setFromObject(m);
    const sx = box.max.x - box.min.x, sy = box.max.y - box.min.y, sz = box.max.z - box.min.z;
    const w = Math.max(sx, sz);
    if (sy < 3 || w < 0.5 || w > 2.4 || sy < w * 2.5 || Math.min(sx, sz) < w * 0.6) return;
    box.getCenter(c);
    for (const { F, xMax } of frames) {
      if (!F) continue;
      const pr = F.project(c);
      if (pr.d < 1 || pr.d > 25 || pr.x > xMax || pr.x < -1.3) continue;
      if (seen.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < 0.5)) return;
      seen.push(c.clone());
      const toCam = new V().subVectors(F.pos, c).setY(0).normalize();
      const facing = (Math.atan2(toCam.x, -toCam.z) * 180) / Math.PI;
      out.push({ pos: [c.x, box.min.y, c.z], radius: w * 0.5, height: sy * 0.97, coverage: 0.85, facing, tag: 'ruins-column', density: 1.3 });
      return;
    }
  });
  return out;
}

/**
 * Ivy curtains found from the geometry itself: wall / parapet / balustrade / block tops near the hero
 * cameras are detected in a top-down surface map as edges with a drop of > 0.8 m, kept where the outer
 * face is seen by one of the area's cameras, thinned by a patchy noise mask and spaced out.
 */
function edgeIvySlots(engine, A, exclude) {
  const owner = new Map();
  for (const [name, roots] of Object.entries(engine.moduleRoots || {})) for (const r of roots) r.traverse((o) => owner.set(o, name));
  const ALLOW = A.ivyModules || { acropolis: 1, aqueducts: 1, ruins: 1, terrain: 0.35 };
  const BAD = /roof|tile|water|glass|banner|flag|cloth|statue|bronze|gold|fire|flame|lamp|brazier|urn|head|tread|step|stair|paving/i;
  const okCache = new Map();
  const allow = (o) => {
    if (!o) return ALLOW.terrain ?? 0;
    if (okCache.has(o)) return okCache.get(o);
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const v = BAD.test((o.name || '') + ' ' + (m?.name || '')) ? 0 : (ALLOW[owner.get(o)] ?? 0);
    okCache.set(o, v);
    return v;
  };
  const res = Math.min(900, Math.round(A.size / 0.14));
  const surf = surfaceMap(engine, A.cx, A.cz, A.size, res, { exclude });
  const frames = A.shots.map((id) => shotFrame(shotById(id)));
  const rng = new RNG('flora-edgeivy-' + A.shots.join('-'));
  const dirs = [];
  for (let k = 0; k < 12; k++) dirs.push([Math.cos((k / 12) * Math.PI * 2), Math.sin((k / 12) * Math.PI * 2)]);
  const out = [], taken = [];
  const step = A.ivyStep ?? 0.45;
  const n = Math.floor(A.size / step);
  const P = new V();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = A.cx - A.size / 2 + (i + rng.random()) * step, z = A.cz - A.size / 2 + (j + rng.random()) * step;
    if (!surf.has(x, z)) continue;
    const a = allow(surf.obj(x, z));
    if (a <= 0) continue;
    const h = surf.h(x, z);
    let best = 0, bd = null;
    for (const d of dirs) { const drop = h - surf.h(x + d[0] * 0.35, z + d[1] * 0.35); if (drop > best) { best = drop; bd = d; } }
    if (best < 0.8 || !bd) continue;
    // a real wall face: geometry below on that side, still lower 0.8 m out (not a gap between treads)
    if (!surf.has(x + bd[0] * 0.35, z + bd[1] * 0.35) || !surf.has(x + bd[0] * 0.8, z + bd[1] * 0.8) || h - surf.h(x + bd[0] * 0.8, z + bd[1] * 0.8) < 0.7) continue;
    // the outer face must be seen (in frame, facing the camera, not too far)
    P.set(x, h, z);
    let dcam = 1e9;
    for (const F of frames) {
      const pr = F.project(P);
      if (pr.d < 1.2 || pr.d > (A.ivyMaxDist ?? 70) || Math.abs(pr.x) > 1.1 || pr.y > 1.1 || pr.y < -1.6) continue;
      const tx = F.pos.x - x, tz = F.pos.z - z, tl = Math.hypot(tx, tz) || 1;
      if ((tx * bd[0] + tz * bd[1]) / tl < 0.1) continue;
      dcam = Math.min(dcam, pr.d);
    }
    if (dcam > 1e8) continue;
    // patchy coverage: some wall runs are smothered, others bare
    const nz = 0.5 + 0.5 * noiseB.fbm2(x / 5.5 + 31, z / 5.5 - 17, 3);
    if (rng.random() > a * (A.ivyAmount ?? 1) * smooth(0.32, 0.62, nz)) continue;
    if (taken.some((t) => (t[0] - x) ** 2 + (t[1] - z) ** 2 < 1.6 * 1.6)) continue;
    // drop height (to the surface below, up to 10 m) and exact edge location
    let hb = h;
    for (let k = 0.35; k <= 2.4; k += 0.3) hb = Math.min(hb, surf.h(x + bd[0] * k, z + bd[1] * k));
    let lo = 0, hi = 0.35;
    for (let it = 0; it < 6; it++) { const m = (lo + hi) / 2; if (surf.h(x + bd[0] * m, z + bd[1] * m) > h - 0.25) lo = m; else hi = m; }
    const ex = x + bd[0] * lo, ez = z + bd[1] * lo;
    const dropH = Math.min(h - hb, 10);
    taken.push([x, z]);
    const facing = (Math.atan2(bd[0], -bd[1]) * 180) / Math.PI;
    out.push({ pos: [ex, h, ez], facing, size: Math.max(0.5, dropH * rng.range(...(A.ivyDrop || [0.5, 1.0]))), width: rng.range(...(A.ivyWidth || [1.0, 3.0])) * (dropH > 3 ? 1.3 : 1), leafScale: A.ivyLeaf ?? 1.35, offset: -0.06, topOffset: 0.015,
      tag: 'edge-ivy', src: (surf.obj(x, z)?.name || '?') + '/' + dropH.toFixed(1) + '/' + h.toFixed(1), ground: (gx, gz) => surf.h(gx, gz), density: A.ivyDensity ?? 1.6 });
  }
  return out;
}
/**
 * Green clumps clinging to the cliff faces the hero cameras look at (refs 1, 3, 7, 8, 9: shrubs, capers
 * and ivy all over the limestone). Placed in each camera's own view (a small position buffer), so the
 * density is uniform on screen and the clumps sit exactly on the rendered surface; sized to ~1 sample.
 * A world-space noise mask keeps the coverage patchy and identical between shots.
 */
function cliffGreenery(engine, P, q, exclude, stats) {
  const owner = new Map();
  for (const r of engine.moduleRoots?.terrain || []) r.traverse((o) => owner.set(o, 'terrain'));
  const SH = [[3, 1.0], [8, 1.0], [9, 1.0], [1, 0.9], [4, 0.8], [7, 1.0], [2, 0.8], [6, 0.7], [5, 0.6]];
  const seen = new Set();
  const up = new V(0, 1, 0);
  let n = 0;
  for (const [id, amount] of SH) {
    const shot = shotById(id); if (!shot) continue;
    const W = 210, H = Math.round(W * 941 / 1672); // fixed: clump size follows the sample footprint
    const VS = viewSurface(engine, shot, W, H, { exclude });
    const rng = new RNG('flora-cliff-' + id);
    const pxm = (2 * Math.tan((shot.fov * Math.PI) / 360)) / H; // metres per sample per metre of distance
    const camP = VS.cam.position;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const o = VS.obj(i, j);
      if (!o || owner.get(o) !== 'terrain') continue;
      const p = VS.at(i, j); const d = p.distanceTo(camP);
      if (d < 18 || d > 1800 || p.y < 0.5) continue;
      const nr = VS.normal(i, j); if (!nr) continue;
      const steep = nr.y < 0.62;
      // coherent masses (ledges, gullies) with bare rock between: coarse mask, sharp edge, ledges preferred
      const lush = 0.5 + 0.5 * noiseA.fbm2(p.x / 27 + 5.3, p.z / 27 - 9.1 + p.y / 31, 3) + (steep ? 0 : 0.06);
      let keep = smooth(0.47, 0.58, lush) * amount * (steep ? 0.85 : 1.0) * 0.6;
      if (rng.random() > keep) continue;
      const sz = d * pxm * (rng.chance(0.25) ? rng.range(2.0, 3.2) : rng.range(1.1, 2.0));
      const cell = Math.max(0.8, sz * 0.8);
      const key = Math.floor(p.x / cell) + ',' + Math.floor(p.y / cell) + ',' + Math.floor(p.z / cell);
      if (seen.has(key)) continue;
      seen.add(key);
      const tilt = nr.clone().multiplyScalar(steep ? 0.75 : 0.3).addScaledVector(up, 0.6).normalize();
      const pos = p.clone().addScaledVector(nr, -0.12 * sz);
      const set = d < 25 ? 'mid' : 'far';
      const v = rng.int(0, set === 'far' ? 2 : 3);
      const tint = { r: rng.range(0.85, 1.1), g: rng.range(0.9, 1.1), b: rng.range(0.85, 1.05), hs: rng.range(0.7, 1.1) };
      P.add(set, 'shrub', v, pos, rng.range(0, 6.28), sz, tilt, tint);
      n++;
    }
  }
  stats.cliff = n;
  return n;
}
/**
 * Ivy mats on the vertical ruin surfaces a hero camera looks at (ref 9: both portico columns smothered
 * in ivy; ref 3: the left column). Points come from the camera's own position buffer, limited to
 * screen regions measured on the references, thinned by a world-space patch noise.
 */
const VIEW_IVY = [
  // shot, regions [fx0, fy0, fx1, fy1], max distance, amount
  { shot: 9, regions: [[0.0, 0.0, 0.2, 0.82], [0.62, 0.15, 0.74, 0.62], [0.8, 0.42, 0.97, 0.66]], maxD: 22, amount: 0.85 },
  { shot: 3, regions: [[0.0, 0.0, 0.12, 0.75]], maxD: 14, amount: 0.8 },
  { shot: 8, regions: [[0.55, 0.0, 1.0, 0.35]], maxD: 12, amount: 0.5 },
  // (r5) ref 8's foreground rubble carries low maquis and flowers, only a little ivy near the head
  { shot: 8, regions: [[0.5, 0.62, 0.85, 1.0]], maxD: 10, amount: 0.22, flat: true, minD: 1.5 },
];
function viewIvySlots(engine, exclude) {
  const owner = new Map();
  for (const r of engine.moduleRoots?.ruins || []) r.traverse((o) => owner.set(o, 'ruins'));
  const BAD = /head|banner|flag|cloth|bronze|gold|fire|flame|brazier|urn/i;
  const out = [];
  for (const spec of VIEW_IVY) {
    const shot = shotById(spec.shot); if (!shot) continue;
    const W = 480, H = 270;
    const VS = viewSurface(engine, shot, W, H, { exclude });
    const rng = new RNG('flora-viewivy-' + spec.shot);
    const pxm = (2 * Math.tan((shot.fov * Math.PI) / 360)) / H;
    const pts = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const fx = (i + 0.5) / W, fy = (j + 0.5) / H;
      if (!spec.regions.some((r) => fx >= r[0] && fx <= r[2] && fy >= r[1] && fy <= r[3])) continue;
      const o = VS.obj(i, j);
      if (!o || owner.get(o) !== 'ruins' || noIvy(o)) continue;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (BAD.test((o.name || '') + ' ' + (m?.name || ''))) continue;
      const p = VS.at(i, j), d = p.distanceTo(VS.cam.position);
      if (d > spec.maxD || d < (spec.minD ?? 3.5)) continue;
      const n = VS.normal(i, j); if (!n || (!spec.flat && Math.abs(n.y) > 0.6)) continue;
      // ~6 cm point spacing whatever the distance
      const px = d * pxm;
      if (rng.random() > Math.min(1, (px / 0.06) ** 2)) continue;
      // patchy: climbing from the ground (denser low), gaps of bare stone
      const patch = 0.5 + 0.5 * noiseB.fbm2(p.x * 0.55 + p.z * 0.3 + 7.7, p.y * 0.45 - p.z * 0.2, 3);
      const ground = heightAt(p.x, p.z);
      const low = Math.max(0, 1 - (p.y - ground) / 9);
      if (rng.random() > spec.amount * smooth(0.3, 0.6, patch * 0.8 + low * 0.35)) continue;
      pts.push({ p: [p.x, p.y, p.z], n: [n.x, n.y, n.z] });
    }
    if (pts.length) out.push({ pos: pts[0].p, points: pts, tag: 'view-ivy-' + spec.shot, leafScale: 1.05, density: 0.85 });
  }
  return out;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** objects (or their parents) flagged userData.noFloraIvy carry their own ivy (ruins module) */
const noIvy = (o) => { for (let p = o; p; p = p.parent) if (p.userData?.noFloraIvy) return true; return false; };

const hashf = (i) => { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ------------------------------------------------------------------ ivy from slots
function buildIvy(engine, M, q, opt = {}) {
  const slots = [...(engine.slots.ivy || []), ...(opt.extra || [])];
  const leaves = new GeoBuilder(), vines = new GeoBuilder();
  const cams = opt.cams || SHOTS.map((s) => new V(...s.pos));
  const groundFn = opt.ground || ((x, z) => heightAt(x, z));
  const rng = new RNG('flora-ivy');
  let n = 0, nLeaves = 0;
  for (const s of slots) {
    if (!s || !s.pos) continue;
    const pos = new V(...s.pos);
    let dmin = 1e9;
    for (const c of cams) dmin = Math.min(dmin, c.distanceTo(pos));
    // LOD: far curtains use fewer, bigger leaves (same visual coverage, ~k² fewer triangles)
    const k = THREE.MathUtils.clamp(dmin / 25, 1, 8);
    // coverage stays constant: count ~ 1/k, leaf area ~ k
    // (r5) far curtains: smaller leaves, more of them (k^0.6 / k^-0.8 instead of k^0.7 / k^-1) — at 100-300 m
    // single big leaves read as cut-out shapes; the refs show a fine-grained leafy texture
    const dens = (0.55 + 0.45 * q.density) / Math.pow(k, 0.8) * (s.density ?? 1);
    const ls = Math.pow(k, 0.6) * (s.leafScale ?? 1);
    const o = dirFromAzEl(s.facing ?? 180, 0);
    const out = new V(o[0], 0, o[2]).normalize();
    const along = new V(0, 1, 0).cross(out).normalize();
    const tag = String(s.tag || '');
    let st;
    if (s.points) {
      st = ivyPatch({ leaves, vines, rng, points: s.points.map((p) => ({ p: new V(...p.p), n: new V(...p.n) })), leafScale: s.leafScale ?? 1, density: s.density ?? 1 });
    } else if (/column|pier-round/.test(tag) || s.radius) {
      st = ivyColumn({ leaves, vines, rng, base: pos, radius: s.radius ?? 0.5, height: s.height ?? s.size ?? 5, coverage: s.coverage ?? 0.6, side: out, density: dens * k, leafScale: ls });
    } else {
      const drop = Math.max(0.6, s.drop ?? s.size ?? 3);
      const width = s.width ?? THREE.MathUtils.clamp(drop * rng.range(0.45, 0.85) * (1 + 0.25 * (k - 1)), 1.2, 7.0);
      const top = pos.clone().addScaledVector(out, -(s.offset ?? 0.15)).add(new V(0, s.topOffset ?? 0.2, 0));
      st = ivyCurtain({
        leaves, vines, rng, top, along, out, width, drop, density: dens, leafScale: ls,
        ground: s.ground || groundFn, topDepth: 0.35,
      });
    }
    nLeaves += st.leaves; n++;
  }
  if (!n) return { group: null, leaves: 0, slots: 0, tris: 0 };
  const g = new THREE.Group(); g.name = 'flora-ivy';
  g.add(meshFrom(leaves, M.ivyLeaf, { depth: M.ivyDepth, name: 'ivy-leaves' }));
  const vm = meshFrom(vines, M.bark, { name: 'ivy-vines', cast: false });
  g.add(vm);
  return { group: g, leaves: nLeaves, slots: n, tris: leaves.triCount + vines.triCount };
}

// ------------------------------------------------------------------ hero dressing
async function buildHeroes(engine, M, q, root, stats, only = null) {
  const heroGroups = [];
  const rockSpots = [];
  const perShot = new Map();
  for (const spec of HERO_SPECS) {
    if (spec.kind !== 'olive' || (only && String(spec.shot) !== String(only)) || DBG.includes('noolive')) continue;
    const w = oliveFromSpec(spec);
    if (!w) continue;
    if (!perShot.has(spec.shot)) perShot.set(spec.shot, { wood: new GeoBuilder(), leaves: new GeoBuilder() });
    const B = perShot.get(spec.shot);
    const { keep, cull, trunc } = regionFns(spec, w.F);
    const st = growOlive({
      keep, cull, trunc,
      wood: B.wood, leaves: B.leaves, rng: new RNG('hero-' + spec.seed),
      start: w.start, dir: w.dir, length: w.length, radius: spec.radius, level: spec.level ?? 0,
      viewDir: w.F.fwd, planar: spec.planar ?? 0.65, density: (spec.density ?? 1) * (0.7 + 0.3 * q.density),
      detail: q.detail, droop: spec.droop ?? 1, leafScale: spec.leafScale ?? 1.25,
    });
    stats.heroLeaves += st.leaves;
  }
  for (const [shot, B] of perShot) {
    const g = new THREE.Group(); g.name = 'flora-hero-olive-' + shot;
    g.add(meshFrom(B.wood, M.bark, { name: 'hero-olive-wood' }));
    g.add(meshFrom(B.leaves, M.oliveLeaf, { depth: M.leafDepth, name: 'hero-olive-leaves' }));
    g.userData.heroShot = shot;
    g.userData.strict = true; // framing branches belong to their camera (cut-to-cut in the film)
    stats.heroTris += B.wood.triCount + B.leaves.triCount;
    heroGroups.push(g); root.add(g);
  }

  for (const spec of HERO_SPECS) {
    if (spec.kind !== 'rocks' || (only && String(spec.shot) !== String(only)) || DBG.includes('norocks')) continue;
    const shot = shotById(spec.shot); if (!shot) continue;
    const F = shotFrame(shot);
    const c = F.at(spec.at[0], spec.at[1], spec.d);
    const fwdH = F.fwd.clone().setY(0).normalize(), rightH = F.right.clone().setY(0).normalize();
    const res = await rockCluster({
      rng: new RNG('rocks-' + spec.seed), center: c, count: Math.max(3, Math.round(spec.count * (0.6 + 0.4 * q.density))),
      size: spec.size, spread: spec.spread, right: rightH, fwd: fwdH, shape: spec.shape, wet: spec.wet, dressed: spec.dressed, rough: spec.rough, cracks: spec.cracks,
      ground: (x, z) => heightAt(x, z), detail: 4, sink: spec.sink ?? 0.3, topFn: rockTopFn(spec, F),
      accept: spec.top ? (pp) => { const pr = F.project(pp); return pr.x > spec.top[0][0] - 0.12 && pr.x < spec.top[1][0] + 0.12 && pr.d > 1.5; } : null,
    });
    const g = new THREE.Group(); g.name = 'flora-hero-rocks-' + spec.shot;
    g.add(res.mesh); g.userData.heroShot = spec.shot; g.userData.hideWithin = 25;
    // rocks standing on a tall supporting mass only make sense from their own camera (floating-camera shots)
    if (res.mesh.userData.maxBase > 12) g.userData.strict = true;
    heroGroups.push(g); root.add(g);
    stats.rocks += res.rocks.length;
    rockSpots.push({ spec, rocks: res.rocks, F, group: g });
  }

  return { groups: heroGroups, rockSpots };
}

// ------------------------------------------------------------------ hero rock dressing
function dressRocks(engine, M, q, lib, rockSpots, exclude, stats, rng) {
  // dense dressing on and between the hero rocks: grass in the cracks, flowers, moss (hidden with the rocks)
  for (const R of rockSpots) {
    let cx = 0, cz = 0, rad = 0;
    for (const r of R.rocks) { cx += r.pos.x; cz += r.pos.z; }
    cx /= R.rocks.length; cz /= R.rocks.length;
    for (const r of R.rocks) rad = Math.max(rad, Math.hypot(r.pos.x - cx, r.pos.z - cz) + Math.max(r.size[0], r.size[2]) * 0.7);
    const size = Math.min(60, rad * 2 + 3);
    const surf = surfaceMap(engine, cx, cz, size, Math.min(768, Math.round(size / 0.05)), { exclude });
    const PR = new Placer();
    const n = scatterCover(PR, {
      cx, cz, size, spacing: (R.spec.wet ? 0.17 : 0.13) * Math.max(1, (R.spec.d ?? 6) / 6), boost: R.spec.wet ? 1 : R.spec.dressed ? 0.8 : 1.4, shots: [R.spec.shot], maxDist: 45, base: 0, topFactor: R.spec.dressed ? 0.35 : 1.6, rng, surf, nearDist: 14, farDist: 40,
      grassK: R.spec.dressed ? 0.7 : 1,
      // ruin blocks: tufts and yellow flowers in the joints (ref 3), no shrubs on top of the blocks
      mix: R.spec.wet ? { mossy: 0.45 } : R.spec.dressed ? { yellow: 0.2, lavender: -0.2, rosemary: 0.05, shrub: -0.2 } : { yellow: -0.25, lavender: -0.5, rosemary: 0.1, shrub: 0.35, shrubTop: true },
      weight: (x, z) => { let w = 0; for (const r of R.rocks) { const d = Math.hypot(x - r.pos.x, z - r.pos.z) / (Math.max(r.size[0], r.size[2]) * 0.9 + 1.2); w = Math.max(w, 1 - d * d); } return Math.max(0, w); },
    }, q);
    stats.cover += n;
    const res = PR.meshes(lib, M);
    for (const m of res.meshes) R.group.add(m);
    stats.coverTris += res.tris;
  }
}

// ------------------------------------------------------------------ build
export async function build(engine) {
  const t0 = performance.now();
  DBG = engine.params?.get?.('floraDbg') || '';
  const q = engine.quality;
  engine.onUpdate((t) => { FLORA_U.uFloraTime.value = t; });
  const M = floraMaterials();
  const root = new THREE.Group(); root.name = 'flora';
  const stats = { heroLeaves: 0, heroTris: 0, rocks: 0, cover: 0, coverTris: 0, ivyLeaves: 0, ivyTris: 0 };
  const vegGroup = new THREE.Group();
  for (const o of [engine.registry.vegetation?.group, ...(engine.moduleRoots?.vegetation || [])]) if (o) vegGroup.children.push(o); // exclusion list only

  // ---- hero olive branches + foreground rocks, per shot
  const T = {}; let tp = performance.now(); const lap = (k) => { const n = performance.now(); T[k] = Math.round(n - tp); tp = n; };
  const H = DBG.includes('noheroes') ? { groups: [], rockSpots: [] } : await buildHeroes(engine, M, q, root, stats);
  lap('heroes');
  const heroGroups = H.groups, rockSpots = H.rockSpots;
  const lib = buildLibrary(q);
  lap('lib');
  const P = new Placer();

  // ---- ground cover around the hero cameras (needs the surface map: run after other modules)
  engine.scene.add(root); // rocks are part of the surface for the dressing pass
  const rng = new RNG('flora-cover');
  // areas follow the cameras (src/world/shots.js): centre = mean of (camera + horizontal forward * ahead)
  const camArea = (ids, ahead, size, o) => {
    let cx = 0, cz = 0, n = 0;
    for (const id of ids) {
      const s = shotById(id); if (!s) continue;
      const F = shotFrame(s), f = F.fwd.clone().setY(0).normalize();
      cx += F.pos.x + f.x * ahead; cz += F.pos.z + f.z * ahead; n++;
    }
    return n ? { cx: cx / n, cz: cz / n, size, shots: ids.filter((id) => shotById(id)), ...o } : null;
  };
  const areas = [
    // ruins promontory: shots 3, 8, 9 (cameras within ~20 m of each other)
    camArea([3, 8, 9], 26, 84, { clear: [[9, 5, 11.5], [3, 10, 18]], grassK: 0.72, spacing: 0.26, boost: 1.5, maxDist: 75, base: 0.03, topFactor: 0.35, mix: { yellow: -0.05, lavender: -0.12, rosemary: 0.0, shrub: 0.05 } }),
    // grand staircase foreground: shot 6
    camArea([6], 18, 44, { spacing: 0.42, maxDist: 40, base: 0.0, topFactor: 0.1, mix: { moss: 0.1, yellow: -0.25, lavender: -0.15, rosemary: -0.2, shrub: -0.2 } }),
    // river bank: shot 7
    camArea([7], 16, 44, { spacing: 0.38, maxDist: 45, base: 0.0, mix: { moss: 0.5, lavender: -0.3 } }),
    // lagoon shore terrace: shot 2
    camArea([2], 18, 44, { spacing: 0.42, maxDist: 40, base: 0.0, topFactor: 0.4 }),
    // foot of the podium / forecourt walls: planted shrubs and weeds along the wall bases (ref 5)
    camArea([5], 26, 64, { edgesOnly: true, clear: [], spacing: 0.4, boost: 1.4, maxDist: 75, base: 0.0, topFactor: 1, nearDist: 14, farDist: 45, mix: { shrub: 0.35, yellow: -0.3, lavender: 0.05 } }),
    // high rocks: shot 1
    camArea([1], 14, 36, { spacing: 0.42, maxDist: 36, base: 0.0, topFactor: 0.6 }),
  ].filter(Boolean);
  for (const A of DBG.includes('nocover') ? [] : areas) {
    const res = Math.min(1024, Math.round(A.size / 0.12));
    const surf = surfaceMap(engine, A.cx, A.cz, A.size, res, { exclude: [vegGroup, ...heroGroups.filter((g) => g.name.includes('olive'))] });
    const nA = scatterCover(P, { ...A, surf, rng }, q); stats.cover += nA;
    if (DBG.includes("log")) console.log(`[flora] cover area shots ${A.shots} c(${A.cx.toFixed(0)},${A.cz.toFixed(0)}) size ${A.size}: ${nA}`);
  }
  dressRocks(engine, M, q, lib, rockSpots, [vegGroup, ...heroGroups.filter((g) => g.name.includes('olive'))], stats, rng);
  const cover = P.meshes(lib, M);
  const coverGroup = new THREE.Group(); coverGroup.name = 'flora-cover';
  for (const m of cover.meshes) coverGroup.add(m);
  root.add(coverGroup);
  stats.coverTris += cover.tris;

  // ---- ivy (slots from acropolis walls, aqueduct piers, temples, ruins)
  // green clumps on the cliff faces seen by the cameras (own instanced meshes, no shadow casting)
  lap('cover');
  if (!DBG.includes('nocliff')) {
    const PC = new Placer();
    cliffGreenery(engine, PC, q, [vegGroup, root], stats);
    const cm = PC.meshes(lib, M);
    const cg = new THREE.Group(); cg.name = 'flora-cliff';
    for (const m of cm.meshes) { m.castShadow = false; m.userData.castShadow = false; cg.add(m); }
    root.add(cg);
    stats.coverTris += cm.tris;
  }
  // ivy found on the geometry around the hero cameras (wall / parapet / balustrade / block tops)
  lap('cliff');
  const edgeIvy = [];
  if (!DBG.includes('noedge')) {
    const ivyAreas = [
      camArea([5], 30, 72, { ivyMaxDist: 80, ivyAmount: 1.0 }),
      camArea([6], 24, 60, { ivyMaxDist: 65, ivyAmount: 1.1 }),
      camArea([3, 8, 9], 18, 56, { ivyMaxDist: 40, ivyAmount: 0.8, ivyWidth: [0.5, 1.4], ivyDrop: [0.25, 0.6], ivyDensity: 1.0, ivyLeaf: 1.0 }),
      camArea([1], 26, 64, { ivyMaxDist: 70, ivyAmount: 0.8 }),
      camArea([7], 45, 100, { ivyMaxDist: 115, ivyAmount: 0.9, ivyStep: 0.6 }),
    ].filter(Boolean);
    const ex = [vegGroup, root];
    for (const A of ivyAreas) {
      const sl = edgeIvySlots(engine, A, ex);
      if (DBG.includes('log')) console.log('[flora] edge ivy shots ' + A.shots + ': ' + sl.length + ' curtains');
      edgeIvy.push(...sl);
    }
  }
  lap('edgeIvy');
  const ivy = DBG.includes('noivy') ? { group: null, leaves: 0, slots: 0, tris: 0 } : buildIvy(engine, M, q, { extra: [...headIvySlots(engine), ...(DBG.includes("stairivy") ? stairIvySlots(engine) : []), ...columnIvySlots(engine), ...edgeIvy, ...(DBG.includes('noview') ? [] : viewIvySlots(engine, [vegGroup, root]))] });
  if (ivy.group) root.add(ivy.group);
  stats.ivyLeaves = ivy.leaves; stats.ivyTris = ivy.tris;

  lap('ivy');
  engine.scene.remove(root);
  engine.add(root);
  installHeroVisibility(engine, heroGroups);
  engine.registry.flora = { root, heroGroups, stats, edgeIvy };
  const total = stats.heroTris + stats.coverTris + stats.ivyTris;
  console.log(`[flora] built in ${Math.round(performance.now() - t0)} ms — hero leaves ${stats.heroLeaves}, rocks ${stats.rocks}, cover ${stats.cover} instances, ivy ${ivy.slots} slots / ${stats.ivyLeaves} leaves, cliff clumps ${stats.cliff || 0}, ~${(total / 1e6).toFixed(2)} M tris (+rocks); ms ${JSON.stringify(T)}`);
}

// ------------------------------------------------------------------ isolated test scene
export async function test(engine) {
  engine.onUpdate((t) => { FLORA_U.uFloraTime.value = t; });
  const M = floraMaterials();
  const q = engine.quality;
  const part = engine.params?.get?.('part') || 'olive';
  const views = [];
  if (part === 'olive') {
    const rng = new RNG('flora-test');
    const wood = new GeoBuilder(), leaves = new GeoBuilder();
    const st = growOlive({
      wood, leaves, rng, start: new V(-2.2, 3.4, 0), dir: new V(1, 0.15, 0.1),
      length: 3.2, radius: 0.06, viewDir: new V(0, 0, -1), planar: 0.6, detail: 1,
    });
    const g = new THREE.Group();
    g.add(meshFrom(wood, M.bark));
    g.add(meshFrom(leaves, M.oliveLeaf, { depth: M.leafDepth }));
    engine.add(g);
    console.log(`[flora] test olive: ${st.leaves} leaves, ${leaves.triCount + wood.triCount} tris`);
    views.push(
      { pos: [0.3, 1.6, 3.2], target: [0.3, 2.9, 0], fov: 50, sun: { azimuth: 350, elevation: 25 } },
      { pos: [0.3, 1.6, 3.2], target: [0.3, 2.9, 0], fov: 50, sun: { azimuth: 160, elevation: 35 } },
      { pos: [0.2, 2.6, 1.3], target: [0.5, 2.8, 0], fov: 40, sun: { azimuth: 200, elevation: 30 } },
    );
  } else if (part === 'hero') {
    if ((engine.params.get('floraDbg') || '').includes('black')) {
      const U = M.oliveLeaf.userData.cgUniforms; U.uLeafTop.value.set(0, 0, 0); U.uLeafUnder.value.set(0, 0, 0); U.uLeafTrans.value.set(0, 0, 0);
      M.bark.color.setRGB(0, 0, 0); M.bark.roughness = 1;
    }
    // the hero dressing of one shot, seen through that shot's camera (no world: fast framing iterations)
    const id = engine.params.get('shot') || '3';
    const root = new THREE.Group();
    const stats = { heroLeaves: 0, heroTris: 0, rocks: 0 };
    const H = await buildHeroes(engine, M, q, root, stats, id);
    engine.scene.add(root);
    stats.cover = 0; stats.coverTris = 0;
    dressRocks(engine, M, q, buildLibrary(q), H.rockSpots, H.groups.filter((g) => g.name.includes('olive')), stats, new RNG('flora-cover'));
    engine.scene.remove(root);
    engine.add(root);
    console.log('[flora] hero test shot ' + id + ': ' + stats.heroLeaves + ' leaves, ' + stats.heroTris + ' tris, ' + stats.rocks + ' rocks, cover ' + stats.cover + ' (' + stats.coverTris + ' tris)');
    const s = shotById(id);
    views.push({ ...s, id: undefined, near: s.near ?? 0.5 });
  } else if (part === 'ivy') {
    // a 4 m wall with a coping, a column and a boulder
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.85 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 1), wallMat); wall.position.set(0, 2, -0.5);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 6, 24), wallMat); col.position.set(5.5, 3, 1.5);
    engine.add(wall); engine.add(col);
    engine.slots.ivy.push({ pos: [-1.5, 3.8, 0.3], facing: 180, size: 3.6, tag: 'test' });
    engine.slots.ivy.push({ pos: [2.2, 3.8, 0.3], facing: 180, size: 2.2, width: 2.5, tag: 'test' });
    engine.slots.ivy.push({ pos: [5.5, 0, 1.5], facing: 200, size: 5.5, radius: 0.48, tag: 'column' });
    const ivy = buildIvy(engine, M, { ...q, density: 1 }, { cams: [new V(0, 2, 6)], ground: () => 0 });
    engine.add(ivy.group);
    console.log(`[flora] test ivy: ${ivy.leaves} leaves, ${ivy.tris} tris`);
    views.push(
      { pos: [0.5, 2.2, 6.5], target: [0.5, 2.4, 0], fov: 50, sun: { azimuth: 220, elevation: 30 } },
      { pos: [-0.8, 3.0, 2.2], target: [-1.2, 3.0, 0], fov: 45, sun: { azimuth: 220, elevation: 30 } },
      { pos: [4.3, 2.0, 4.5], target: [5.5, 2.6, 1.5], fov: 45, sun: { azimuth: 220, elevation: 30 } },
    );
  } else if (part === 'cover') {
    const lib = buildLibrary({ ...q, detail: 1 });
    const P = new Placer();
    const rng = new RNG('cover-test');
    const kinds = [['grass', 6], ['yellow', 3], ['lavender', 2], ['rosemary', 2], ['moss', 3]];
    kinds.forEach(([k, n], row) => {
      for (let v = 0; v < n; v++) P.add('near', k, v, new V(-2.5 + v * 1.0, 0, -row * 0.9), rng.range(0, 6.28), 1, null, null);
    });
    // a meadow patch
    for (let i = 0; i < 500; i++) {
      const x = rng.range(-4, 4), z = rng.range(1, 5);
      const r = rng.random();
      const k = r < 0.7 ? 'grass' : r < 0.82 ? 'yellow' : r < 0.9 ? 'lavender' : r < 0.95 ? 'rosemary' : 'moss';
      const n = { grass: 6, yellow: 3, lavender: 2, rosemary: 2, moss: 3 }[k];
      P.add('near', k, rng.int(0, n - 1), new V(x, 0, z), rng.range(0, 6.28), rng.range(0.7, 1.3), null, { r: rng.range(0.9, 1.1), g: rng.range(0.9, 1.1), b: 1 });
    }
    const res = P.meshes(lib, M);
    for (const m of res.meshes) engine.add(m);
    const rocks = await rockCluster({ rng: new RNG('rk'), center: new V(3, 0, -2), count: 4, size: [0.8, 1.6], spread: [3, 1, 2], ground: () => 0 });
    engine.add(rocks.mesh);
    console.log(`[flora] test cover: ${res.tris} tris`);
    views.push(
      { pos: [0, 1.0, 4.5], target: [0, 0.2, -1.5], fov: 45, sun: { azimuth: 220, elevation: 25 } },
      { pos: [-1.0, 0.6, 7.5], target: [0, 0.2, 2.5], fov: 40, sun: { azimuth: 20, elevation: 18 } },
      { pos: [-1.6, 0.5, 0.9], target: [-1.6, 0.2, -0.5], fov: 45, sun: { azimuth: 220, elevation: 25 } },
    );
  }
  return { views };
}
