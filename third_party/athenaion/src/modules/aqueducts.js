// AQUEDUCTS & BRIDGES module.
// Builds every entry of layout.AQUEDUCTS: multi-tier Roman arcades of pale ashlar (piers with imposts,
// voussoir arches with keystones, string courses, specus channel with flowing water, parapet finials)
// and the monumental road bridge near the lagoon (paved deck, balustrade, pedestals, gate tower).
//
// Publishes:
//   engine.registry.aqueductSpills = [{ pos:[x,y,z], dir: compass deg, width, flow, kind, drop, structure }]
//       kind: 'spout' (projecting channel spout), 'breach' (broken channel wall), 'end' (castellum outlet)
//       drop: metres from the lip down to the terrain/water below
//   engine.registry.aqueducts = [{ id, kind, a, b, deck, axis, piers:[{pos:[x,y,z], ground}], extent }]
//   engine.slots.ivy / banner / statue / brazier  ({ pos:[x,y,z], facing: compass deg, size, width?, tag })
//       banner.pos = top-centre of the banner on the wall face; size = banner length (m)
//       statue/brazier.pos = top surface of the pedestal
//   engine.footprints: paths along each structure (tag 'aqueduct')
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt, waterSDF } from '../world/heightfield.js';
import { makeSpec, buildStructure } from '../aqueducts/arcade.js';
import { stoneMaterial, propStoneMaterial, goldMaterial as ownGold, channelWaterMaterial } from '../aqueducts/stone.js';
import * as METAL from '../materials/metal.js';
import { balusterGeometry, finialGeometry, instanced } from '../aqueducts/props.js';
import { proceduralMaterial } from '../core/materials.js';
import { SHOTS } from '../world/shots.js';

/** geometric detail for a structure: full near the cameras, reduced for the far background ones */
function lodDetail(e, base) {
  let dmin = Infinity;
  for (const sh of SHOTS) {
    // distance to the nearest point of the A-B segment
    const ax = e.a[0], az = e.a[1], bx = e.b[0], bz = e.b[1];
    const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((sh.pos[0] - ax) * vx + (sh.pos[2] - az) * vz) / (vx * vx + vz * vz)));
    const d = Math.hypot(sh.pos[0] - (ax + vx * t), sh.pos[1] - e.deck, sh.pos[2] - (az + vz * t));
    dmin = Math.min(dmin, d);
  }
  return { detail: base * Math.max(0.45, Math.min(1, 260 / dmin)), dmin };
}

function buildAll(engine, entries, env) {
  const q = engine.quality;
  const detail = q.detail ?? 1;
  const root = new THREE.Group();
  root.name = 'aqueducts';
  let goldMat;
  try { goldMat = METAL.goldMaterial({ wear: 0.45 }); } catch (e) { goldMat = ownGold(); }
  const propMat = propStoneMaterial();
  const balGeo = balusterGeometry(detail), finGeo = finialGeometry(detail);
  const waterMats = [];
  const res = { root, spills: [], slots: { ivy: [], banner: [], statue: [], brazier: [], urn: [] }, structures: [], tris: 0, footprints: [] };
  for (const e of entries) {
    const lod = lodDetail(e, detail);
    const S = makeSpec(e, lod.detail);
    const o = buildStructure(S, env);
    if (!o.stone.tris) { console.warn(`[aqueducts] ${e.id}: no part above the terrain, skipped`); continue; }
    const g = new THREE.Group();
    g.name = 'aqueduct-' + S.id;
    g.position.set(S.A[0], 0, S.A[1]);
    g.rotation.y = Math.atan2(-S.axis[1], S.axis[0]);
    const mat = stoneMaterial(S.axis, {
      ledges: o.ledges, waterY: env.waterY ?? 0, wet: o.wet,
      course: S.bridge ? 0.6 : 0.72, moss: S.bridge ? 1.0 : 0.85,
      tint: S.id === 'hill' ? [0.98, 0.985, 1.0] : S.bridge ? [1.02, 1.0, 0.97] : [1.0, 0.99, 0.975],
    });
    const mesh = new THREE.Mesh(o.stone.toGeometry(), mat);
    mesh.name = 'aqueduct-stone-' + S.id;
    g.add(mesh);
    res.tris += o.stone.tris;
    if (o.balusters.length) {
      const im = instanced(balGeo, propMat, o.balusters);
      im.name = 'aqueduct-balusters-' + S.id;
      g.add(im);
      res.tris += o.balusters.length * balGeo.index.count / 3;
    }
    if (o.finials.length) {
      const im = instanced(finGeo, goldMat, o.finials);
      im.name = 'aqueduct-finials-' + S.id;
      g.add(im);
      res.tris += o.finials.length * finGeo.index.count / 3;
    }
    for (const w of o.water) {
      const wm = channelWaterMaterial(S.axis, S.bridge ? 0.8 : 1.6);
      waterMats.push(wm);
      const geo = new THREE.PlaneGeometry(w.x1 - w.x0, w.hw * 2, Math.max(1, Math.round((w.x1 - w.x0) / 8)), 1).rotateX(-Math.PI / 2);
      geo.translate((w.x0 + w.x1) / 2, w.y, 0);
      const wmesh = new THREE.Mesh(geo, wm);
      wmesh.name = 'aqueduct-water-' + S.id;
      wmesh.userData.castShadow = false;
      wmesh.castShadow = false; wmesh.receiveShadow = true;
      g.add(wmesh);
    }
    root.add(g);
    res.spills.push(...o.spills);
    for (const k of Object.keys(o.slots)) res.slots[k].push(...o.slots[k]);
    res.footprints.push(...o.footprints);
    res.structures.push({
      id: S.id, kind: S.kind, a: S.A, b: S.B, deck: S.deck, axis: S.axis,
      extent: o.extent, piers: o.piers.map((p) => ({ pos: p.world, ground: p.ground })),
      tower: o.tower ? true : false, castellum: o.castellum ? true : false,
    });
  }
  engine.onUpdate((t) => { for (const m of waterMats) m.userData.uTime.value = t; });
  return res;
}

function publish(engine, res) {
  engine.add(res.root, { castShadow: true, receiveShadow: true });
  // water strips never cast
  res.root.traverse((o) => { if (o.name && o.name.startsWith('aqueduct-water')) o.castShadow = false; });
  engine.registry.aqueductSpills = (engine.registry.aqueductSpills || []).concat(res.spills);
  engine.registry.aqueducts = res.structures;
  for (const k of Object.keys(res.slots)) {
    if (!engine.slots[k]) engine.slots[k] = [];
    engine.slots[k].push(...res.slots[k]);
  }
  for (const f of res.footprints) engine.footprints.addPath([f.a, f.b], f.halfWidth, 'aqueduct');
}

export async function build(engine) {
  const t0 = performance.now();
  const env = { ground: heightAt, waterSDF, waterY: L.SEA_LEVEL };
  const res = buildAll(engine, L.AQUEDUCTS, env);
  publish(engine, res);
  const ms = Math.round(performance.now() - t0);
  console.log(`[aqueducts] ${res.structures.length} structures, ${res.spills.length} spills, ` +
    `slots ivy ${res.slots.ivy.length} banner ${res.slots.banner.length} statue ${res.slots.statue.length} brazier ${res.slots.brazier.length}, ` +
    `~${Math.round(res.tris / 1000)}k tris, ${ms} ms`);
}

// ---------------------------------------------------------------- isolated test: real terrain patch + the real layout
function terrainPatch(x0, z0, x1, z1, step) {
  const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step);
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + (x0 + x1) / 2, z = pos.getZ(i) + (z0 + z1) / 2;
    pos.setXYZ(i, x, heightAt(x, z), z);
  }
  geo.computeVertexNormals();
  const mat = proceduralMaterial({
    name: 'aqTestTerrain',
    params: { color: 0xffffff, roughness: 0.95 },
    color: /* glsl */ `
      float slope = 1.0 - clamp(cgN.y, 0.0, 1.0);
      float n = cgVfbm2(cgP.xz * 0.05, 4);
      vec3 grass = mix(vec3(0.07, 0.085, 0.03), vec3(0.16, 0.15, 0.07), n);
      vec3 rock = mix(vec3(0.42, 0.40, 0.35), vec3(0.6, 0.57, 0.5), cgVfbm2(cgP.xz * 0.2 + cgP.y * 0.13, 4));
      rock *= 0.8 + 0.3 * cgVnoise2(vec2(cgP.y * 0.9, (cgP.x + cgP.z) * 0.03));
      vec3 c = mix(grass, rock, smoothstep(0.22, 0.45, slope + 0.15 * n));
      c = mix(vec3(0.35, 0.33, 0.27), c, smoothstep(0.5, 3.0, cgP.y + 2.0 * n));
      diffuseColor.rgb = c;
    `,
  });
  return new THREE.Mesh(geo, mat);
}

export async function test(engine) {
  const t0 = performance.now();
  const tg = engine.scene.getObjectByName('testGround');
  if (tg) tg.visible = false;
  const group = new THREE.Group();
  group.add(terrainPatch(-900, -1000, 300, 700, engine.quality.detail >= 0.75 ? 3 : 5));
  const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0x0c3b40, roughness: 0.07, metalness: 0, ior: 1.33 }));
  water.position.y = 0.0;
  water.userData.castShadow = false; water.castShadow = false;
  group.add(water);
  engine.add(group, { castShadow: true, receiveShadow: true });
  water.castShadow = false;
  const env = { ground: heightAt, waterSDF, waterY: 0 };
  const res = buildAll(engine, L.AQUEDUCTS, env);
  publish(engine, res);
  console.log(`[aqueducts:test] spills ${JSON.stringify(res.spills.map((s) => ({ p: s.pos.map((v) => Math.round(v)), d: Math.round(s.dir), k: s.kind, drop: Math.round(s.drop) })))}`);
  console.log(`[aqueducts:test] ~${Math.round(res.tris / 1000)}k tris, ${Math.round(performance.now() - t0)} ms`);
  // optional integration (dev only): ?with=waterfalls,banners,flora builds those modules on top
  for (const name of (engine.params?.get?.('with') || '').split(',').filter(Boolean)) {
    try { const m = await import(`./${name}.js`); await m.build(engine); } catch (e) { console.warn('[aqueducts:test] with', name, 'failed:', e.message); }
  }
  return {
    views: [
      // 0: river level, low bridge in front of the high aqueduct (like ref 7)
      { pos: [-196, 3.5, 222], target: [-212, 48, 0], fov: 52 },
      // 1: from the ruined terrace (shot 3)
      { pos: [-330, 40, 430], target: [20, 85, -62], fov: 44 },
      // 2: high aqueduct, mid distance, from the south-west canyon rim
      { pos: [-345, 62, -40], target: [-250, 40, -170], fov: 50 },
      // 3: aerial over the canyon looking north
      { pos: [-170, 190, 180], target: [-250, 30, -90], fov: 50 },
      // 4: low bridge close-up from the river
      { pos: [-200, 6, 178], target: [-192, 20, 108], fov: 55, atmo: { uMist: [0.00025, 28, 0] } },
      // 5: hill aqueduct and castellum
      { pos: [-150, 150, -380], target: [-340, 100, -600], fov: 50 },
      // 6: pier detail close-up (high aqueduct in the river)
      { pos: [-236, 10, -95], target: [-262, 26, -168], fov: 50, atmo: { uMist: [0.00025, 28, 0] }, sun: { azimuth: 250, elevation: 24 } },
      // 7: like ref 2 (from the lagoon)
      { pos: [-130, 3.2, 420], target: [-60, 55, 150], fov: 48 },
      // 8: west end of the high aqueduct where it meets the canyon rim
      { pos: [-385, 92, -120], target: [-330, 70, -205], fov: 50 },
      // 9: gate tower at the acropolis end of the road bridge
      { pos: [-150, 22, 175], target: [-128, 33, 112], fov: 50, atmo: { uMist: [0.0003, 28, 0] } },
      // 10: castellum at the end of the hill aqueduct
      { pos: [-170, 135, -480], target: [-245, 110, -560], fov: 50, atmo: { uMist: [0.0003, 28, 0] } },
      // 11: candidate framing for shot 7 (bridge across the frame, high aqueduct behind, acropolis right)
      { pos: [-238, 3, 222], target: [-130, 58, 20], fov: 52 },
      // 12: gate tower close
      { pos: [-95, 34, 175], target: [-62, 36, 125], fov: 50, atmo: { uMist: [0.0003, 28, 0] } },
    ],
  };
}
