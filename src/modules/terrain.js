// Terrain module (OWNER: terrain agent) — the ground of the whole world, both eras.
// adapted from athenaion/src/modules/terrain.js
//  - near + far terrain as LOD chunks meshed by narrow-band surface nets (src/terrain/voxel.js): real 3D
//    limestone faces (karst columns, strata beds, ledges, overhangs) on the ring edges, the citadel's stepped
//    hillside and the islets; exact heightAt() on flat anchors (plateau, ledges, quay band, ring tops, city);
//    cell size per region driven by the shot cameras (0.5–1 m near them, up to 1 km far).
//  - eroded far field (mountain wall to the north, foothills, plain, west sea, islands) baked to
//    generated/terrain-far-<ver>.bin (node tools/bake.mjs terrain), else built coarse at runtime.
//  - sunken era: the water rings / canal partly filled with rippled sand (src/terrain/sand.js), algae rock.
//  - one world-space procedural ground material (src/terrain/material.js).
// Registry: engine.registry.terrain = { root, material, faces (ring rock faces), canal, sandAt, sunkenGround,
//   groundAt(x,z) (mesh ground of the current era), stats }.
import * as THREE from 'three';
import { planChunks } from '../terrain/lod.js';
import { groupResults, packGroups, unpackGroups } from '../terrain/meshpack.js';
import { PLAN_OPTS, groupGeometry } from '../terrain/meshgeo.js';
import { MeshPool } from '../terrain/pool.js';
import { terrainMaterial, setFarTexture, TERRAIN_UNIFORMS } from '../terrain/material.js';
import { loadFarGrid, farTexture } from '../terrain/far.js';
import { RING_FACES, CANAL_FACES, faceRadius } from '../terrain/faces.js';
import { sandAt, sunkenGround } from '../terrain/sand.js';
import { heightAt } from '../world/heightfield.js';
import { SHOTS } from '../world/shots.js';
import { isSunken } from '../world/era.js';
import * as L from '../world/layout.js';

export async function buildTerrain(engine, { shots = SHOTS } = {}) {
  const t0 = performance.now();
  const q = engine.quality;
  const qname = q.terrainRes >= 1 ? 'high' : 'preview';
  const era = isSunken(engine) ? 'sunken' : 'golden';
  const planOpts = PLAN_OPTS(qname);
  // eroded far field: registered for heightAt() and uploaded as a texture for shading
  let far = null;
  try {
    far = await loadFarGrid();
    setFarTexture(farTexture(far), far);
  } catch (e) { console.warn('[terrain] far grid unavailable, analytic mountains', e); }
  const tf = performance.now();
  // mesh the chunks in workers
  const leaves = planChunks(shots, planOpts);
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const pool = new MeshPool(Math.max(1, Math.min(16, hc - 2)));
  if (far) await pool.setFar(far);
  const order = leaves.map((l, i) => i).sort((a, b) => leaves[a].cell - leaves[b].cell);
  const results = new Array(leaves.length);
  await Promise.all(order.map((i) => {
    const l = leaves[i];
    return pool.run({ x0: l.x0, z0: l.z0, n: l.n, cell: l.cell, ext: 1, era }).then((r) => { results[i] = r; });
  }));
  pool.dispose();
  const packed = packGroups(groupResults(leaves, results));
  const t2 = performance.now();
  const groups = unpackGroups(packed);
  const mat = terrainMaterial(era);
  const root = new THREE.Group();
  root.name = 'terrain';
  let tris = 0;
  for (const g of groups) {
    const geo = groupGeometry(g);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain:' + g.key;
    const near = g.cell <= 8;
    mesh.castShadow = near; mesh.receiveShadow = true;
    mesh.userData.castShadow = near; mesh.userData.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    // r4 perf: draw the terrain AFTER the other opaque geometry (sky stays last at 1e6). Its procedural shader is
    // the most expensive in the world; drawn first, every pixel hidden under buildings / walls / trees was shaded
    // anyway (no depth pre-pass). Early-z now rejects them: −35…−50 % ms/sample in shots 3/5, same image
    // (only isolated depth-tie pixels at buried object bases differ).
    mesh.renderOrder = 1;
    root.add(mesh);
    tris += geo.index.count / 3;
  }
  engine.add(root);
  const groundAt = era === 'sunken' ? sunkenGround : heightAt;
  const stats = { chunks: leaves.length, meshes: groups.length, mTris: +(tris / 1e6).toFixed(2), ms: 0 };
  engine.registry.terrain = {
    root, material: mat, uniforms: TERRAIN_UNIFORMS, era,
    faces: RING_FACES, faceRadius, canal: CANAL_FACES,
    sandAt, sunkenGround, groundAt, stats,
  };
  const ms = Math.round(performance.now() - t0);
  stats.ms = ms;
  console.log(`[terrain] ${era} mesh (${qname}, ${leaves.length} chunks) → ${groups.length} meshes, ${(tris / 1e6).toFixed(2)} M tris; far ${Math.round(tf - t0)} ms, mesh ${Math.round(t2 - tf)} ms, total ${ms} ms`);
  return root;
}

export async function build(engine) {
  await buildTerrain(engine);
}

export async function test(engine) {
  const tg = engine.scene.getObjectByName('testGround');
  if (tg) tg.visible = false;
  if (engine.params.get('tdebug')) TERRAIN_UNIFORMS.uTDebug.value = 1;
  const views = testViews();
  // mesh for the test cameras too (dense where they look)
  await buildTerrain(engine, { shots: [...SHOTS, ...views.map((v, i) => ({ id: 't' + i, ...v }))] });
  // stand-in water surface (the water module owns the real one) so the test views read like the shots
  if (!engine.params.get('nowater')) {
    const y = isSunken(engine) ? L.SUNKEN.surface : 0;
    const wm = new THREE.MeshStandardMaterial({ color: isSunken(engine) ? 0x1d6f86 : 0x1f6f7a, roughness: 0.06, metalness: 0, transparent: true, opacity: isSunken(engine) ? 0.35 : 0.82 });
    wm.userData.sunken = 'none';
    const w = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), wm);
    w.position.y = y; w.name = 'terrainTestWater'; w.userData.castShadow = false; w.castShadow = false;
    engine.scene.add(w);
  }
  return { views };
}

function testViews() {
  const sun = { azimuth: L.SUN.azimuth, elevation: L.SUN.elevation };
  const S = (id) => SHOTS.find((s) => s.id === id);
  const v = (s, o = {}) => ({ pos: s.pos, target: s.target, fov: s.fov, sun, near: 0.5, far: 60000, ...o });
  const P = (r, b, y) => { const [x, z] = L.polar(r, b); return [x, y, z]; };
  return [
    v(S(1)),                                                                              // 0 grand aerial
    { pos: P(300, 165, 21), target: [25, 26, 90], fov: 50, sun, near: 0.3, far: 60000 },  // 1 citadel hillside from the l1 rim
    { pos: P(266, 128, 1.8), target: P(292, 92, 11), fov: 42, sun, near: 0.3, far: 60000 }, // 2 l1 inner rock face along w1 (ref 4)
    { pos: [1500, 900, -1800], target: [3000, 1300, -9000], fov: 38, sun, near: 1, far: 60000 }, // 3 mountain wall
    { pos: [-330, 30, 1420], target: [-470, 6, 1240], fov: 46, sun, near: 0.3, far: 60000 },      // 4 islet
    { pos: P(500, 115, 3), target: P(470, 60, 4), fov: 46, sun, near: 0.3, far: 60000 },         // 5 w2 faces (l1 outer / l2 inner)
    v(S(7), { near: 0.2 }),                                                               // 6 canal floor (sunken: sand)
    { pos: [0, 700, 2600], target: [0, 0, -2500], fov: 50, sun, near: 1, far: 60000 },    // 7 high overview
  ];
}
