// Neutral scene for developing a module in isolation:
//   ?test=<module>&view=<n>   → imports src/modules/<module>.js and calls its test(engine)
// test(engine) should add objects around the origin and may return
//   { views: [{ pos:[x,y,z], target:[x,y,z], fov, sun:{azimuth,elevation}, dof }] }
// If no views are returned, the camera frames the bounding box of what was added.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';

export async function buildTestScene(engine, name, viewIndex = 0) {
  const { scene } = engine;
  // ground: pale limestone paving with subtle variation
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000, 1, 1).rotateX(-Math.PI / 2),
    proceduralMaterial({
      name: 'testGround',
      params: { color: 0xb8ad98, roughness: 0.92 },
      color: `float n = cgVfbm2(cgP.xz * 0.35, 4); float g = cgVnoise2(cgP.xz * 4.0);
              diffuseColor.rgb *= 0.82 + 0.25 * n + 0.06 * g;`,
    }),
  );
  ground.name = 'testGround';
  ground.receiveShadow = true;
  scene.add(ground);

  const before = new Set(scene.children);
  const mod = await import(`../modules/${name}.js`);
  if (typeof mod.test !== 'function') throw new Error(`module ${name} has no test(engine) export`);
  const res = (await mod.test(engine)) || {};
  const added = scene.children.filter((c) => !before.has(c));
  for (const o of added) o.traverse((m) => { if (m.isMesh && m.userData.castShadow === undefined) { m.castShadow = true; m.receiveShadow = true; } });

  let view = res.views && res.views[viewIndex];
  if (!view) {
    const box = new THREE.Box3();
    for (const o of added) box.expandByObject(o);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 5, 5));
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y, s.z) * 0.5;
    const ang = [0.7, 2.0, -0.6, 3.6][viewIndex % 4];
    const dist = r / Math.tan((22 * Math.PI) / 180) * 1.05;
    view = { pos: [c.x + Math.sin(ang) * dist, c.y + dist * 0.28, c.z + Math.cos(ang) * dist], target: [c.x, c.y, c.z], fov: 40 };
  }
  const shot = { id: `test-${name}-${viewIndex}`, near: 0.1, far: 20000, sun: { azimuth: 235, elevation: 28 }, ...view };
  return { shot };
}
