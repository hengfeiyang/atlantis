// smoke test module for the render harness
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
export async function build() {}
export async function test(engine) {
  const m = proceduralMaterial({ params: { color: 0xe8dcc4, roughness: 0.6 }, color: `diffuseColor.rgb *= 0.8 + 0.2 * cgFbm3(cgP * 0.8, 4);` });
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 9, 32), m);
    c.position.set(i * 3 - 10.5, 4.5, 0); engine.add(c);
  }
  return { views: [{ pos: [14, 6, 22], target: [0, 4, 0], fov: 40 }] };
}
