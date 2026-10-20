// Ruins terrace: ruined Corinthian portico, fallen drums & entablature, the inscribed column
// "ΠΑΝΤΑ ΡΕΙ", worn paving, rubble — and the giant fallen marble head (ref 8).
// The hero sets are composed relative to the cameras of shots 3, 8 and 9 (see ruins/camspace.js),
// so they follow the cameras if src/world/shots.js changes.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadOrBuild } from '../core/cache.js';
import { proceduralMaterial, cached } from '../core/materials.js';
import { buildHeadGeometry, HEAD_SCALE, headSDF } from '../sculpt/head.js';
import { growIvy, ivyMeshes } from '../ruins/ivy.js';
import { pixelRay } from '../ruins/camspace.js';
import { dirFromAzEl } from '../world/layout.js';
import { ruinStoneMaterial, setInscription, ensureCav } from '../ruins/materials.js';
import { atPixel, camVec, toPixel, shotCam } from '../ruins/camspace.js';
import { heightAt } from '../world/heightfield.js';
import { ruinsJobs, HEAD_VERSION } from '../ruins/jobs.js';
import { HEAD_POSE, headMatrix } from '../ruins/headpose.js';
import { ledgeSupports, LEDGE_STONES, dressLedge } from '../ruins/ledge8.js';
import { HEAD_STONES, placeItem, buildMound, pantaColumnPlacement, PANTA, PIER8 } from '../ruins/headset.js';
import { buildPortico } from '../ruins/portico.js';
import { stoneSDF } from '../ruins/stones.js';
import { buildTerrace3 } from '../ruins/terrace3.js';
import { jointGrass } from '../ruins/grass.js';
import * as ARCH from '../arch/index.js';

// ------------------------------------------------------------------ materials
export function headMaterial() {
  return ruinStoneMaterial({ cav: true, head: true, base: [0.72, 0.655, 0.56], lichen: 1.0, moss: 0.8, pits: 0.5, grime: 1.0, cracks: 1.0, veins: 0.3, streaks: 0.35, bump: 0.6, roughness: 0.68, crust: 0.4, crustScale: 3.2, ochre: 0.25, edges: 0.4 });
}
export function roughStoneMaterial() {
  return ruinStoneMaterial({ cav: true, base: [0.42, 0.395, 0.345], lichen: 1.6, moss: 0.8, pits: 0.85, grime: 1.15, cracks: 1.15, veins: 0.15, streaks: 0.7, bump: 1.45, roughness: 0.84, seed: 3.1, crust: 0.95, ochre: 0.45, edges: 0.75 });
}
export function columnMaterial(opts = {}) {
  return ruinStoneMaterial({ cav: true, base: [0.48, 0.455, 0.41], lichen: 1.2, moss: 0.55, pits: 0.45, grime: 0.95, cracks: 0.75, veins: 0.3, streaks: 1.0, bump: 1.2, roughness: 0.78, seed: 7.7, crust: 0.85, ochre: 0.4, edges: 0.65, ...opts });
}
export function pavingMaterial() {
  return ruinStoneMaterial({ cav: true, base: [0.40, 0.38, 0.35], lichen: 1.1, moss: 1.0, pits: 0.7, grime: 1.1, cracks: 1.6, veins: 0.25, streaks: 0.0, bump: 0.95, roughness: 0.72, seed: 5.3, crust: 0.7, ochre: 0.35, edges: 0.0 });
}
let ARCH_MARBLE = null;
export function archMarble() {
  if (engine_useArchMarble) return (ARCH_MARBLE ||= ARCH.marbleMaterial({ variant: 'ruined', seed: 0.37 }));
  return ruinStoneMaterial({ aux: true, base: [0.47, 0.45, 0.41], lichen: 1.2, moss: 0.6, pits: 0.45, grime: 0.95, cracks: 1.05, veins: 0.3, streaks: 1.0, bump: 1.25, roughness: 0.76, seed: 1.9, crust: 0.9, ochre: 0.4, edges: 0.7 });
}
let engine_useArchMarble = false;
export function soilMaterial() {
  // dark earth with leaf litter, dry grass mats, moss and limestone grit (refs 8, 9: the ground between
  // the rubble is dark and busy, never a flat khaki sheet)
  return cached('ruinsSoil2', () => proceduralMaterial({
    name: 'ruinsSoil',
    params: { color: 0xffffff, roughness: 0.96 },
    head: `
      float rsGrit(vec2 p, out float edge){ vec3 v = cgVoronoi2(p); float s = step(0.62, v.z); edge = smoothstep(0.30, 0.14, v.x) * s; return smoothstep(0.24, 0.12, v.x) * s * (0.6 + 0.4 * fract(v.z * 7.3)); }
      float rsHeight(vec2 p){ float e1, e2; float g1 = rsGrit(p * 14.0, e1), g2 = rsGrit(p * 37.0 + 5.0, e2);
        return 0.012 * g1 + 0.005 * g2 + 0.01 * cgVnoise2(p * 3.0) + 0.004 * cgVnoise2(p * 21.0); }`,
    color: `
      vec2 p = cgP.xz;
      float n = cgVfbm2(p * 0.8, 4), g = cgVnoise2(p * 4.0), s = cgVnoise2(p * 23.0), l = cgVnoise2(p * 55.0);
      vec3 soil = mix(vec3(0.045, 0.036, 0.026), vec3(0.10, 0.08, 0.055), n) * (0.75 + 0.5 * s);
      // leaf litter / dry grass mat: streaky pale-ochre flecks
      float lit = smoothstep(0.55, 0.8, cgVnoise2(vec2(p.x * 40.0 + p.y * 13.0, p.y * 9.0 - p.x * 4.0)) * 0.6 + g * 0.5);
      vec3 straw = mix(vec3(0.16, 0.12, 0.055), vec3(0.30, 0.24, 0.11), l);
      vec3 c = mix(soil, straw, lit * 0.75);
      // green: moss and low grass in damp patches
      float gm = smoothstep(0.5, 0.75, n * 0.5 + g * 0.6);
      c = mix(c, mix(vec3(0.03, 0.045, 0.012), vec3(0.09, 0.10, 0.03), l), gm * 0.85);
      // limestone grit and pebbles with dark contact rims
      float e1, e2; float g1 = rsGrit(p * 14.0, e1), g2 = rsGrit(p * 37.0 + 5.0, e2);
      c *= 1.0 - 0.5 * max(e1 - g1, 0.0);
      c = mix(c, vec3(0.30, 0.285, 0.26) * (0.75 + 0.5 * l), clamp(g1 * 1.3, 0.0, 1.0) * 0.85);
      c = mix(c, vec3(0.26, 0.25, 0.23) * (0.7 + 0.5 * s), clamp(g2 * 1.3, 0.0, 1.0) * 0.6);
      diffuseColor.rgb = c;`,
    normal: `
      vec2 p = cgP.xz; float e = 0.004;
      float h0 = rsHeight(p), hx = rsHeight(p + vec2(e, 0.0)), hz = rsHeight(p + vec2(0.0, e));
      cgBump = vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 0.9;`,
    ao: 'cgAO = 0.7;',
  }));
}

/** pale limestone ground with dry grass and dark soil pockets (shot-3 knoll, ref 3 foreground) */
export function rockGroundMaterial() {
  return cached('ruinsRockGround', () => proceduralMaterial({
    name: 'ruinsRockGround',
    params: { color: 0xffffff, roughness: 0.92 },
    color: `
      float n = cgVfbm2(cgP.xz * 0.7, 4), g = cgVnoise2(cgP.xz * 5.0), s = cgVnoise2(cgP.xz * 19.0), v = cgVoronoi2(cgP.xz * 1.6).x;
      vec3 rock = mix(vec3(0.27, 0.25, 0.21), vec3(0.42, 0.39, 0.33), smoothstep(0.2, 0.8, n));
      rock *= 0.82 + 0.18 * smoothstep(0.0, 0.25, v);              // joints between the slabs
      vec3 grass = mix(vec3(0.10, 0.085, 0.035), vec3(0.24, 0.20, 0.09), g);
      vec3 soil = vec3(0.085, 0.07, 0.05);
      float gm = smoothstep(0.45, 0.75, g * 0.6 + (1.0 - n) * 0.5);
      vec3 c = mix(rock, grass, gm);
      c = mix(c, soil, smoothstep(0.78, 0.95, 1.0 - n) * 0.7);
      c *= 0.86 + 0.28 * s;
      c *= 0.55 + 0.45 * smoothstep(0.0, 0.12, v);                 // dark soil-filled cracks
      diffuseColor.rgb = c;`,
    normal: `
      vec2 p = cgP.xz; float e = 0.01;
      float h0 = cgVfbm2(p * 3.0, 3) * 0.05 + cgVnoise2(p * 17.0) * 0.008 + smoothstep(0.0, 0.12, cgVoronoi2(p * 1.6).x) * 0.04;
      float hx = cgVfbm2((p + vec2(e, 0.0)) * 3.0, 3) * 0.05 + cgVnoise2((p + vec2(e, 0.0)) * 17.0) * 0.008 + smoothstep(0.0, 0.12, cgVoronoi2((p + vec2(e, 0.0)) * 1.6).x) * 0.04;
      float hz = cgVfbm2((p + vec2(0.0, e)) * 3.0, 3) * 0.05 + cgVnoise2((p + vec2(0.0, e)) * 17.0) * 0.008 + smoothstep(0.0, 0.12, cgVoronoi2((p + vec2(0.0, e)) * 1.6).x) * 0.04;
      cgBump = vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 0.8;`,
  }));
}

// ------------------------------------------------------------------ geometry jobs (baked)
let JOBS = null;
async function geometry(engine, id) {
  JOBS ||= Object.fromEntries(ruinsJobs().map((j) => [j.id || 'head', j]));
  const j = JOBS[id];
  if (!j) throw new Error('unknown ruins geometry ' + id);
  const q = engine.quality.detail;
  return loadOrBuild(j.name, () => j.build(q));
}

// ------------------------------------------------------------------ head placement (shot 8)
export { HEAD_POSE, headMatrix };

async function buildHeadSet(engine, group, opts = {}) {
  // the bake is in metres at HEAD_SCALE; the placed head is scaled by HEAD_POSE.k (ref 8: the head fills
  // x 950-1670 and brow→chin ≈ 470 px, i.e. a colossal ≈ 3 m head)
  const S0 = HEAD_SCALE, K = HEAD_POSE.k || 1, AN = HEAD_POSE.aniso || [1, 1, 1];
  const S = S0 * K * Math.min(...AN); // conservative world metres per head unit (SDF distances)
  // --- the head
  const cellParam = engine.params?.get?.('headCell');
  const geo = cellParam ? buildHeadGeometry({ cell: Number(cellParam) }) : await geometry(engine, 'head');
  const head = new THREE.Mesh(geo, headMaterial());
  // (named so that flora's generic head-ivy pass does not double the ivy grown here — see report)
  head.name = 'fallenHeadMarble';
  const rot = headMatrix();
  const aL = new THREE.Vector3(...HEAD_POSE.anchorLocal).multiplyScalar(S0 * K).multiply(new THREE.Vector3(...AN)).applyMatrix4(rot);
  const pos = atPixel(8, ...HEAD_POSE.anchorPixel, HEAD_POSE.anchorDepth).sub(aL);
  head.matrixAutoUpdate = false;
  head.matrix.copy(rot).scale(new THREE.Vector3(K * AN[0], K * AN[1], K * AN[2])).setPosition(pos);
  group.add(head);
  engine.registry.ruinsHead = { matrix: head.matrix.clone(), scale: S0, ivy: 'ruins' }; // matrix maps bake metres → world
  const chin = new THREE.Vector3(...HEAD_POSE.chinLocal).multiplyScalar(S0).applyMatrix4(head.matrix);

  // --- rubble stones
  const stoneMat = roughStoneMaterial();
  let mound = { height: (x, z) => heightAt(x, z) };
  if (!opts.headOnly) {
  const supports = [{ x: chin.x, z: chin.z, top: chin.y - 0.3, r: 2.6 }];
  const headC = new THREE.Vector3(0, 0, 0).applyMatrix4(head.matrix);
  supports.push({ x: headC.x, z: headC.z, top: chin.y - 0.4, r: 3.0 }); // r4: lower, so the chin shows (ref 8)
  supports.push(...ledgeSupports());
  for (const s of HEAD_STONES) {
    const m = placeItem(8, s);
    const g = await geometry(engine, s.id);
    const mesh = new THREE.Mesh(g, stoneMat);
    mesh.matrixAutoUpdate = false; mesh.matrix.copy(m);
    mesh.name = 'ruinStone_' + s.id;
    group.add(mesh);
    const c = new THREE.Vector3().setFromMatrixPosition(m);
    supports.push({ x: c.x, z: c.z, top: c.y - s.dims[1] * 0.4, r: Math.max(s.dims[0], s.dims[2]) * 0.75 + 0.45 });
  }

  // ledge rubble (shot 8 bottom left), re-using baked stone geometry
  const ledgeStones = [];
  for (const L of LEDGE_STONES) {
    const src = HEAD_STONES.find((q) => q.id === L.geo);
    const m = placeItem(8, { ...src, px: L.px, depth: L.depth, yaw: L.yaw, tilt: L.tilt, scale: L.scale, ground: false });
    const mesh = new THREE.Mesh(await geometry(engine, L.geo), stoneMat);
    mesh.matrixAutoUpdate = false; mesh.matrix.copy(m);
    mesh.name = 'ruinStone_ledge_' + L.geo;
    group.add(mesh); ledgeStones.push({ mesh, dims: src.dims, s: L.scale });
  }
  // --- soil mound carrying head and stones
  mound = buildMound(supports, { center: [headC.x - 3.0, headC.z + 1.0], size: 21, step: engine.quality.detail >= 1 ? 0.08 : 0.12, material: soilMaterial() });
  group.add(mound.mesh);
  engine.registry.ruinsGround = mound.height; // flora can sample terrain + mound here
  // seat the ledge rubble on the mound, then dress the ledge with grass, lavender, flowers and shrubs
  for (const L of ledgeStones) {
    const e = L.mesh.matrix.elements;
    e[13] = mound.height(e[12], e[14]) + L.dims[1] * 0.5 * L.s - 0.12;
  }
  try {
    const { floraMaterials } = await import('./flora.js');
    const plants = dressLedge({ height: mound.height, material: floraMaterials().herb, density: Math.max(0.6, engine.quality.density || 1), detail: Math.min(1, engine.quality.detail || 1) });
    for (const m of plants) group.add(m);
  } catch (err) { console.warn('[ruins] ledge dressing skipped:', err.message); }

  // --- ΠΑΝΤΑ ΡΕΙ column
  const pc = pantaColumnPlacement();
  const colMat = columnMaterial({ inscription: true });
  let y = pc.base.y - 0.25;
  for (let i = 0; i < PANTA.drums.length; i++) {
    const g = await geometry(engine, 'pa' + (i + 1));
    const h = PANTA.drums[i];
    const mesh = new THREE.Mesh(g, colMat);
    mesh.name = 'headsetPantaColumn'; // part of the head set (flora keeps generic ivy off 'head' meshes; ref 8 shows clean lettering)
    const yaw = (i * 1.7) % (Math.PI * 2);
    mesh.position.set(pc.base.x + (i === 2 ? 0.02 : 0), y + h / 2, pc.base.z);
    mesh.rotation.set(i === 2 ? 0.012 : 0, yaw, i === 1 ? -0.008 : 0);
    group.add(mesh);
    y += h;
  }
  const insc = pc.base.clone(); insc.y += PANTA.inscriptionY - 0.25;
  setInscription(colMat, { origin: insc.toArray(), axis: [0, 1, 0], front: pc.front.toArray(), radius: PANTA.r, letterHeight: PANTA.letterH, rotation: 0 });

  // --- pier behind
  {
    const p = atPixel(8, PIER8.px[0], PIER8.px[1], PIER8.depth);
    let yy = heightAt(p.x, p.z) - 0.2;
    for (let i = 0; i < PIER8.blocks.length; i++) {
      const d = PIER8.blocks[i];
      const g = await geometry(engine, 'pier8-' + i);
      const mesh = new THREE.Mesh(g, stoneMat);
      mesh.position.set(p.x + Math.sin(i * 2.1) * 0.05, yy + d[1] / 2, p.z + Math.cos(i * 1.3) * 0.05);
      mesh.rotation.y = 0.35 + Math.sin(i * 3.7) * 0.04;
      group.add(mesh);
      yy += d[1] - 0.02;
    }
  }
  // --- small rubble chips over the mound inside the shot-8 frame
  const tRub = performance.now();
  {
    const chipGeo = (() => {
      // rounded pebble with a few flat fracture facets (merged vertices → smooth normals)
      let g = new THREE.IcosahedronGeometry(1, 2);
      g.deleteAttribute('uv'); g.deleteAttribute('normal');
      g = mergeVertices(g);
      const pa = g.attributes.position;
      const cuts = [[0.5, 0.8, 0.3, 0.55], [-0.7, 0.2, 0.6, 0.6], [0.1, -0.9, -0.4, 0.5]];
      for (let i = 0; i < pa.count; i++) {
        const v = new THREE.Vector3(pa.getX(i), pa.getY(i), pa.getZ(i));
        const n3 = 1 + 0.12 * Math.sin(v.x * 5.1 + v.y * 3.3) * Math.cos(v.z * 4.7 - v.x * 2.1);
        v.multiplyScalar(n3);
        for (const c of cuts) { const nn = new THREE.Vector3(c[0], c[1], c[2]).normalize(); const dd = v.dot(nn) - c[3]; if (dd > 0) v.addScaledVector(nn, -dd); }
        pa.setXYZ(i, v.x, v.y * 0.6, v.z);
      }
      g.computeVertexNormals();
      return g;
    })();
    const rng = engine.rng('chips8');
    const N = Math.round(700 * Math.max(0.5, engine.quality.density || 1));
    const im = new THREE.InstancedMesh(chipGeo, stoneMat, N);
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), sc = new THREE.Vector3();
    let n = 0;
    for (let tries = 0; tries < N * 6 && n < N; tries++) {
      const px = 380 + rng.random() * 1300, py = 640 + rng.random() * 300;
      const depth = 1.9 + Math.pow(rng.random(), 1.6) * 7.0;
      const p = atPixel(8, px, py, depth);
      const gy = mound.height(p.x, p.z);
      if (gy < shotCam(8).pos.y - 3.2) continue; // stay on the promontory top
      const [, , dd] = toPixel(8, new THREE.Vector3(p.x, gy, p.z));
      if (dd < 1.6) continue;
      if (dd < 2.4) continue;
      const size = (0.025 + 0.1 * Math.pow(rng.random(), 2.5)) * (0.8 + 0.07 * dd);
      e4.set(rng.random() * 6.28, rng.random() * 6.28, rng.random() * 6.28); q4.setFromEuler(e4);
      sc.set(size * (0.8 + 0.5 * rng.random()), size * (0.6 + 0.4 * rng.random()), size * (0.8 + 0.5 * rng.random()));
      m4.compose(new THREE.Vector3(p.x, gy + size * 0.15, p.z), q4, sc);
      im.setMatrixAt(n++, m4);
    }
    im.count = n; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    im.name = 'rubbleChips8';
    group.add(im);
  }
  // --- ivy creeping over the rubble and the ground in front of / beside the head (ref 8 bottom)
  {
    const parts = HEAD_STONES.filter((q) => !q.ground || q.id === 'h11' || q.id === 'h14').map((q) => {
      const m = placeItem(8, q); const e = m.clone().invert().elements;
      const fn = stoneSDF({ kind: q.kind || 'block', dims: q.dims, seed: q.id, chips: q.chips, broken: q.broken, split: q.split, erosion: q.erosion, round: q.round });
      return { fn, e, c: new THREE.Vector3().setFromMatrixPosition(m), R: Math.hypot(...q.dims) * 0.55 + 0.05 };
    });
    const rsdf = (x, y, z) => {
      let dd = y - mound.height(x, z);
      for (const p of parts) {
        const dx = x - p.c.x, dy = y - p.c.y, dz = z - p.c.z, r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (r > p.R + 0.4) { dd = Math.min(dd, r - p.R); continue; }
        const e = p.e;
        dd = Math.min(dd, p.fn(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]));
      }
      return dd;
    };
    const cam8 = shotCam(8).pos;
    const rhit = (px, py) => {
      const dir = pixelRay(8, px, py); const p = cam8.clone();
      for (let i = 0; i < 200; i++) { const v = rsdf(p.x, p.y, p.z); if (v < 0.004) return p; p.addScaledVector(dir, Math.max(v * 0.9, 0.004)); if (p.distanceTo(cam8) > 9) break; }
      return null;
    };
    const rregion = (p) => { const [x, y, dd] = toPixel(8, p); return dd > 2.1 && y > 760 && x > 480 && x < 1700 && y < 915; };
    const rseeds = [[1150, 890], [1340, 880], [1250, 820], [1450, 830], [1610, 780], [820, 880], [610, 890], [1000, 820], [1500, 870], [700, 820]]
      .map((q) => rhit(q[0], q[1])).filter(Boolean);
    const riv = growIvy({ sdf: rsdf, seeds: rseeds, seed: 'rubble8', steps: 36, step: 0.03, branch: 0.16, leafEvery: 1, leafSize: [0.035, 0.08], climb: 0.25, inside: rregion, maxStems: 120, stemRadius: 0.008, leafUp: 0.25, youngFrac: 0.15 });
    const rm = ivyMeshes(riv, {});
    rm.stemMesh.name = 'rubbleIvyStems'; rm.leafMesh.name = 'rubbleIvyLeaves';
    group.add(rm.stemMesh, rm.leafMesh);
    console.log(`[ruins] rubble chips + ivy: ${rseeds.length} seeds, ${riv.stems.length} stems, ${riv.leaves.length} leaves in ${Math.round(performance.now() - tRub)} ms`);
  }
  } // !headOnly
  // --- ivy over the head's left temple, cheek and crown (ref 8 right half)
  const tIvy = performance.now();
  {
    const inv = head.matrix.clone().invert();
    const e = inv.elements;
    const hsdf = (x, y, z) => {
      const lx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / S0, ly = (e[1] * x + e[5] * y + e[9] * z + e[13]) / S0, lz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / S0;
      return headSDF(lx, ly, lz, 1) * S;
    };
    const ground = (x, z) => mound.height(x, z);
    const sdf = (x, y, z) => Math.min(hsdf(x, y, z), y - ground(x, z));
    const hsdf0 = (x, y, z) => {
      const lx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / S0, ly = (e[1] * x + e[5] * y + e[9] * z + e[13]) / S0, lz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / S0;
      return headSDF(lx, ly, lz, 0) * S;
    };
    const gradSdf = (x, y, z) => Math.min(hsdf0(x, y, z), y - ground(x, z));
    const cam = shotCam(8).pos;
    const hit = (px, py) => { // sphere-trace the head from camera 8
      const d = pixelRay(8, px, py); const p = cam.clone();
      for (let i = 0; i < 160; i++) { const v = sdf(p.x, p.y, p.z); if (v < 0.004) return p; p.addScaledVector(d, Math.max(v * 0.9, 0.004)); if (p.distanceTo(cam) > 12) break; }
      return null;
    };
    // ref 8: dense ivy over the near side of the head — climbing from the ground along the jaw and
    // neck, draping from the crown and the fillet over the temple and around the ear, one trailing
    // vine down the cheek; the eye, nose and mouth stay clear
    const eyePx = toPixel(8, new THREE.Vector3(...HEAD_POSE.anchorLocal).multiplyScalar(S0).applyMatrix4(head.matrix));
    const earPx = toPixel(8, new THREE.Vector3(0.37, -0.07, -0.08).multiplyScalar(S0).applyMatrix4(head.matrix));
    const region = (p) => {
      const [x, y, dd] = toPixel(8, p); if (dd < 0) return false;
      if (Math.hypot(x - eyePx[0], (y - eyePx[1]) * 1.3) < 95) return false;
      if (Math.hypot(x - earPx[0], y - earPx[1]) < 92) return false; // ref 8: the ear stays visible inside the ivy
      return (x > 1360 && y > 140 && y < 940) || (x > 1260 && y > 600 && y < 940);
    };
    const seedsA = [[1330, 780], [1400, 750], [1470, 720], [1550, 660], [1310, 700], [1380, 650], [1610, 700], [1430, 800], [1520, 800]];
    const seedsB = [[1420, 240], [1480, 225], [1540, 270], [1410, 300], [1590, 320], [1460, 330], [1520, 390], [1630, 430], [1430, 410], [1360, 580], [1400, 470], [1560, 520]];
    const grow = (px, o) => growIvy({ sdf, seeds: px.map((q) => hit(q[0], q[1])).filter(Boolean), step: 0.04, leafEvery: 1, leafSize: [0.04, 0.085], inside: region, stemRadius: 0.008, leafUp: 0.1, youngFrac: 0.1, gradSdf, ...o });
    const ivA = grow(seedsA, { seed: 'head8a', steps: 85, branch: 0.1, climb: 0.45, maxStems: 160 });
    const ivB = grow(seedsB, { seed: 'head8b', steps: 85, branch: 0.1, climb: 0.3, up: new THREE.Vector3(0, -1, 0), maxStems: 200 });
    const ivy = { stems: [...ivA.stems, ...ivB.stems], leaves: [...ivA.leaves, ...ivB.leaves] };
    const seeds = { length: seedsA.length + seedsB.length };
    const sun = PROPOSED_SUN[8];
    const { stemMesh, leafMesh } = ivyMeshes(ivy, { sunDir: new THREE.Vector3(...dirFromAzEl(sun.azimuth, sun.elevation)), jitter: 0.45 });
    group.add(stemMesh, leafMesh);
    console.log(`[ruins] head ivy: ${seeds.length} seeds, ${ivy.stems.length} stems, ${ivy.leaves.length} leaves in ${Math.round(performance.now() - tIvy)} ms`);
  }
  const eye = new THREE.Vector3(...HEAD_POSE.anchorLocal).multiplyScalar(S0).applyMatrix4(head.matrix);
  console.log(`[ruins] head at ${pos.toArray().map((x) => x.toFixed(2))}, chin y ${chin.y.toFixed(2)} (ground ${heightAt(chin.x, chin.z).toFixed(2)}), eye→px ${toPixel(8, eye).map((x) => x.toFixed(0))}`);
}

export async function build(engine) {
  const t0 = performance.now();
  engine_useArchMarble = engine.params?.get?.('archMarble') === '1';
  const group = new THREE.Group(); group.name = 'ruins';
  await buildHeadSet(engine, group);
  const tHead = performance.now();
  if (!engine.params?.get?.('noT3')) {
    const hero3 = new THREE.Group(); hero3.name = 'ruinsHero3';
    hero3.userData.heroShot = 3;
    const t3 = await buildTerrace3({ engine, group: hero3, geometry: (id) => geometry(engine, id), stoneMat: roughStoneMaterial(), columnMat: columnMaterial(), marble: archMarble() });
    const c3 = shotCam(3).pos;
    const knoll = buildMound(t3.supports, { center: [c3.x + 2, c3.z - 3], size: 26, step: engine.quality.detail >= 1 ? 0.2 : 0.3, material: rockGroundMaterial() });
    knoll.mesh.name = 'ruinsKnoll3';
    hero3.add(knoll.mesh);
    group.add(hero3);
    installHeroSets(engine, [hero3]);
  }
  const tT3 = performance.now();
  if (!engine.params?.get?.('noPortico')) {
    await buildPortico({ engine, group, geometry: (id) => geometry(engine, id), stoneMat: roughStoneMaterial(), columnMat: columnMaterial(), marble: archMarble(), pavingMat: pavingMaterial(), soilMat: soilMaterial(), jointGrass: (joints, seed) => jointGrass(joints, { seed }) });
  }
  const tPor = performance.now();
  console.log(`[ruins] timings: head set ${Math.round(tHead - t0)} ms, terrace3 ${Math.round(tT3 - tHead)} ms, portico ${Math.round(tPor - tT3)} ms`);
  group.traverse((o) => { if (o.isMesh && o.material?.userData?.needsCav) ensureCav(o.geometry); });
  engine.add(group);
  let tris = 0;
  group.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.count || 1); });
  console.log(`[ruins] built in ${Math.round(performance.now() - t0)} ms, ${(tris / 1e6).toFixed(2)} M tris`);
}

// hero sets: visible in their own shot; in other shots hidden when they are close (< 40 m) and in frame
function installHeroSets(engine, groups) {
  const frustum = new THREE.Frustum(), m = new THREE.Matrix4();
  engine.onShot((shot) => {
    const cam = engine.camera;
    cam.updateMatrixWorld(true);
    m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m);
    for (const g of groups) {
      if (String(g.userData.heroShot) === String(shot.id)) { g.visible = true; continue; }
      if (!g.userData.sphere) g.userData.sphere = new THREE.Box3().setFromObject(g).getBoundingSphere(new THREE.Sphere());
      const sp = g.userData.sphere;
      const dist = sp.center.distanceTo(cam.position) - sp.radius;
      g.visible = !(dist < 40 && frustum.intersectsSphere(sp));
    }
  });
}

// proposed per-shot suns (see report): raking light from the left like the references
export const PROPOSED_SUN = { 3: { azimuth: 8, elevation: 19 }, 8: { azimuth: 249, elevation: 28 }, 9: { azimuth: 255, elevation: 26 } };

export async function test(engine) {
  const part = engine.params?.get?.('part') || 'head';
  if (part === 'head8') {
    // the head + ivy alone, from camera 8 zoomed in (fast iteration on the sculpt)
    const group = new THREE.Group();
    await buildHeadSet(engine, group, { headOnly: true });
    engine.add(group);
    const { SHOTS } = await import('../world/shots.js');
    const s = SHOTS.find((q) => q.id === 8);
    const hc = new THREE.Vector3(0, 0.05, 0.1).multiplyScalar(HEAD_SCALE).applyMatrix4(engine.registry.ruinsHead.matrix);
    return { views: [
      { pos: s.pos, target: hc.toArray(), fov: 34, near: 0.2, sun: PROPOSED_SUN[8] },
      { pos: s.pos, target: s.target, fov: s.fov, near: 0.2, sun: PROPOSED_SUN[8] },
    ] };
  }
  if (part === 'world') {
    // terrain + this module, rendered from the real shot cameras (with the proposed suns)
    const terrain = await import('./terrain.js');
    await terrain.build(engine);
    await build(engine);
    const { SHOTS } = await import('../world/shots.js');
    const v = (id) => { const s = SHOTS.find((q) => q.id === id); return { pos: s.pos, target: s.target, fov: s.fov, near: s.near ?? 0.3, sun: PROPOSED_SUN[id] }; };
    return { views: [v(8), v(9), v(3)] };
  }
  if (part === 'head') {
    const cellParam = engine.params?.get?.('headCell');
    const geo = cellParam ? buildHeadGeometry({ cell: Number(cellParam) }) : await geometry(engine, 'head');
    const mat = headMaterial();
    const g = new THREE.Group();
    const rots = [0, -0.75, -Math.PI / 2];
    rots.forEach((r, i) => {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.y = r;
      m.position.set((i - 1) * 4.2, 0.62 * HEAD_SCALE + 0.05, 0);
      g.add(m);
    });
    engine.add(g);
    return {
      views: [
        { pos: [0, 2.1, 11.0], target: [0, 2.0, 0], fov: 40, sun: { azimuth: 205, elevation: 32 } },
        { pos: [-2.6, 1.6, 5.6], target: [0.0, 2.0, 0], fov: 38, sun: { azimuth: 250, elevation: 30 } },
        { pos: [4.2, 2.0, 7.5], target: [4.2, 2.0, 0], fov: 30, sun: { azimuth: 160, elevation: 25 } },
      ],
    };
  }
  return {};
}
