// Test scene for the underwater core (src/core/underwater.js + src/core/sunken.js). OWNER: underwater agent.
// The medium itself is core (installed by engine.prepareScene in the sunken era) — build() is a no-op.
//   node tools/render.mjs --test underwater --view N --params era=sunken --out out/underwater/vN.png
// Views: 0 ref-6-like (temple steps, columns, statue, rays), 1 looking up (surface, Snell window, shafts),
//        2 split level at the surface (ref 9), 3 caustics close-up on sand + mosaic (ref 8),
//        4 visibility: colonnade receding 0-150 m at 50 m depth.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { whiteStone, bandedStone, redStone, mosaicFloor, blackStone } from '../materials/stone.js';
import { bronzeMaterial, goldMaterial } from '../materials/metal.js';
import { UW } from '../core/underwater.js';

export async function build() {}

function sandMaterial() {
  const m = proceduralMaterial({
    name: 'uwTestSand',
    params: { color: 0xd8d0bc, roughness: 0.95 },
    color: `float r = sin(dot(cgP.xz, vec2(0.83, 0.55)) * 3.1 + cgVfbm2(cgP.xz * 0.3, 3) * 6.0);
            diffuseColor.rgb *= 0.86 + 0.08 * r + 0.1 * cgVfbm2(cgP.xz * 2.0, 3) + 0.05 * cgVnoise2(cgP.xz * 30.0);`,
    normal: `float e = 0.02; vec2 q = cgP.xz;
             float w = cgVfbm2(q * 0.3, 3) * 6.0;
             float h0 = sin(dot(q, vec2(0.83, 0.55)) * 3.1 + w);
             float hx = sin(dot(q + vec2(e, 0.0), vec2(0.83, 0.55)) * 3.1 + cgVfbm2((q + vec2(e, 0.0)) * 0.3, 3) * 6.0);
             float hz = sin(dot(q + vec2(0.0, e), vec2(0.83, 0.55)) * 3.1 + cgVfbm2((q + vec2(0.0, e)) * 0.3, 3) * 6.0);
             cgBump = vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 0.02;`,
  });
  m.userData.sunken = 'none';
  return m;
}

export async function test(engine) {
  const g = engine.scene.getObjectByName('testGround');
  if (g) g.visible = false;
  const add = (geo, mat, x, y, z, ry = 0, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); engine.add(m); return m;
  };
  // rippled sand floor (gently undulating)
  const sg = new THREE.PlaneGeometry(600, 600, 300, 300).rotateX(-Math.PI / 2);
  const pa = sg.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), z = pa.getZ(i);
    pa.setY(i, 0.25 * Math.sin(x * 0.11 + 0.7) * Math.cos(z * 0.07) + 0.12 * Math.sin(x * 0.31 + z * 0.23));
  }
  sg.computeVertexNormals();
  add(sg, sandMaterial(), 0, -0.3, 0);

  // mosaic floor + temple steps
  add(new THREE.CylinderGeometry(7, 7, 0.3, 64), mosaicFloor({ center: [0, 6], radius: 6.5 }), 0, 0.0, 6);
  const white = whiteStone({ weather: 0.4 });
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(30 - i * 2, 0.6, 6 - i * 0.6), white, 0, 0.3 + i * 0.6, -8 - i * 0.3);
  const banded = bandedStone({ band: 1.1 });
  const colGeo = new THREE.CylinderGeometry(0.75, 0.85, 9, 24, 1);
  for (let i = 0; i < 6; i++) {
    const x = -10 + i * 4;
    if (i === 4) { // toppled: drums lying on the sand
      for (let k = 0; k < 3; k++) add(new THREE.CylinderGeometry(0.8, 0.8, 2.6, 24), banded, x + 2 + k * 2.9, 0.75, -2 + k * 0.6, 0.3, 0, Math.PI / 2);
      continue;
    }
    add(colGeo, banded, x, 2.7 + 4.5, -9.5);
    add(new THREE.BoxGeometry(2.0, 0.5, 2.0), white, x, 2.7 + 9.25, -9.5);
  }
  add(new THREE.BoxGeometry(22, 1.2, 2.2), white, -2, 2.7 + 10.1, -9.5); // lintel (partly fallen elsewhere)
  // bronze statue proxy on a black pedestal
  add(new THREE.BoxGeometry(3, 3, 3), blackStone(), 6, 1.5, 4);
  const torso = new THREE.LatheGeometry([0.0, 0.9, 1.2, 1.25, 1.05, 0.7, 0.55, 0.0].map((r, i) => new THREE.Vector2(r, i * 0.75)), 32);
  const bronze = bronzeMaterial();
  add(torso, bronze, 6, 3, 4);
  add(new THREE.SphereGeometry(0.75, 32, 16), bronze, 6, 3 + 5.6, 4);
  add(new THREE.CapsuleGeometry(0.3, 2.4, 6, 12), bronze, 7.3, 6.5, 4, 0, 0, -0.9);
  // gold trident
  const gold = goldMaterial();
  add(new THREE.CylinderGeometry(0.09, 0.09, 8, 12), gold, 8.6, 6.5, 4.4, 0, 0, 0.12);
  for (const dx of [-0.45, 0, 0.45]) add(new THREE.ConeGeometry(0.12, 0.9, 10), gold, 8.1 + dx, 10.9 + (dx === 0 ? 0.25 : 0), 4.4);
  // red stone blocks / rubble
  const red = redStone();
  const rng = engine.rng('uwtest');
  for (let i = 0; i < 26; i++) {
    const s = 0.4 + rng.next() * 1.2;
    add(new THREE.BoxGeometry(s * 1.6, s, s), rng.next() < 0.5 ? red : white, -16 + rng.next() * 32, s * 0.4 - 0.2, -4 + rng.next() * 18, rng.next() * 3, rng.next() * 0.4, rng.next() * 0.4);
  }
  // receding colonnade (visibility test) 0 … -160 m
  for (let z = -20; z > -170; z -= 10) for (const x of [-9, 9]) add(colGeo, banded, x, 4.2, z);

  // debug: the caustic map (4 slices side by side) on an unlit board far away (view 5)
  const dbg = new THREE.Mesh(new THREE.PlaneGeometry(400, 100), new THREE.ShaderMaterial({
    uniforms: { t: UW.tUwCaustic },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D t; varying vec2 vUv;
      void main(){ float k = floor(vUv.x * 4.0); vec2 uv = vec2(fract(vUv.x * 4.0), vUv.y) * 0.5;
        vec4 c = textureLod(t, uv, 0.0); float v = k < 0.5 ? c.r : k < 1.5 ? c.g : k < 2.5 ? c.b : c.a;
        gl_FragColor = vec4(vec3(v * 0.25), 1.0); }`,
  }));
  dbg.userData.noPatch = true; dbg.position.set(0, 2000, 0); dbg.castShadow = false;
  engine.scene.add(dbg);
  const S = (s) => ({ uUwSurface: s });
  return {
    views: [
      { pos: [2, 3.6, 27], target: [0, 6.5, 0], fov: 50, sun: { azimuth: 292, elevation: 35 }, uw: S(24) },
      { pos: [0, 2.2, 18], target: [-5, 16, -4], fov: 64, sun: { azimuth: 292, elevation: 35 }, uw: S(24) },
      { pos: [0, 24.08, 32], target: [0, 20, 0], fov: 62, sun: { azimuth: 292, elevation: 5 }, uw: S(24) },
      { pos: [5.5, 1.7, 13], target: [1, 0.2, 5], fov: 44, sun: { azimuth: 210, elevation: 58 }, uw: S(22) },
      { pos: [0, 3.2, 12], target: [0, 4.5, -60], fov: 50, sun: { azimuth: 210, elevation: 58 }, uw: S(50) },
      { pos: [0, 2000, 160], target: [0, 2000, 0], fov: 69.4, uw: S(3000), grade: { uExposure: 1, uAutoExpo: 0, uVignette: [0, 1], uLtmFine: 0, uLtmMid: 0, uLtmLarge: 0, uLtmBase: 0 } },
    ],
  };
}
