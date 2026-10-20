// Metal & stone materials shared by the props (banners hardware, braziers, urns, lamps).
// Procedural, world-space detail via proceduralMaterial hooks; per-instance variation from cgSeed.
import * as THREE from 'three';
import { proceduralMaterial, cached } from '../core/materials.js';

// The world IBL is scaled down for contrast (sky.js uEnvScale). Metals get a mild boost of their
// image-based reflections (only where metallic), standing in for the bright sunlit marble around them.
export const METAL_ENV_BOOST = 1.25;

/**
 * Gilded bronze / polished gold. `wear` 0..1 adds darker bronze showing through in crevices.
 * Uses object-space noise (cgO) so instanced copies don't swim when moved.
 */
export function goldMaterial({ tint = 0xd4a64a, rough = 0.36, wear = 0.35, metal = 1.0, envBoost = METAL_ENV_BOOST, name = 'propGold' } = {}) {
  return cached(`gold:${tint}:${rough}:${wear}:${metal}:${envBoost}:${name}`, () => proceduralMaterial({
    name,
    params: { color: tint, roughness: rough, metalness: metal },
    uniforms: { uWear: { value: wear }, uEnvBoost: { value: envBoost } },
    head: /* glsl */`uniform float uWear; uniform float uEnvBoost;`,
    ao: /* glsl */`cgAO = mix(1.0, uEnvBoost, metalnessFactor);`,
    color: /* glsl */`
      float n = cgFbm3(cgO * 9.0 + cgSeed * 17.0, 4) * 0.5 + 0.5;
      float grime = smoothstep(0.55, 0.85, cgFbm3(cgO * 3.5 + 3.1 + cgSeed * 5.0, 3) * 0.5 + 0.5) * uWear;
      // tarnished bronze where the gilding has worn (darker, browner, a hint of verdigris)
      vec3 bronze = vec3(0.30, 0.17, 0.065);
      vec3 verd = vec3(0.10, 0.16, 0.10);
      vec3 c = diffuseColor.rgb * (0.86 + 0.24 * n);
      c = mix(c, mix(bronze, verd, 0.25 * smoothstep(0.7, 0.95, n)), grime * 0.85);
      // per-instance tint variation (some pieces more red-gold, some paler)
      c *= mix(vec3(1.06, 0.98, 0.9), vec3(0.95, 1.0, 1.06), cgSeed);
      diffuseColor.rgb = c;`,
    roughness: /* glsl */`
      float g2 = smoothstep(0.55, 0.85, cgFbm3(cgO * 3.5 + 3.1 + cgSeed * 5.0, 3) * 0.5 + 0.5) * uWear;
      roughnessFactor = clamp(roughnessFactor + 0.12 * cgVnoise3(cgO * 30.0) + g2 * 0.35, 0.05, 1.0);`,
    normal: /* glsl */`
      // hammered / chased surface: very fine dents
      vec3 q = cgO * 46.0;
      float e = 0.01;
      float b0 = cgVnoise3(q);
      cgBump = 0.05 * (vec3(cgVnoise3(q + vec3(e*46.0,0,0)), cgVnoise3(q + vec3(0,e*46.0,0)), cgVnoise3(q + vec3(0,0,e*46.0))) - b0) / (e*46.0) * 0.35;`,
  }));
}

/** Dark cast bronze with patina (braziers, poles, tripods). */
export function bronzeMaterial({ tint = 0x8a6236, rough = 0.42, patina = 0.5, metal = 1.0, envBoost = METAL_ENV_BOOST, name = 'propBronze' } = {}) {
  return cached(`bronze:${tint}:${rough}:${patina}:${metal}:${envBoost}:${name}`, () => proceduralMaterial({
    name,
    params: { color: tint, roughness: rough, metalness: metal },
    uniforms: { uPatina: { value: patina }, uEnvBoost: { value: envBoost } },
    head: /* glsl */`uniform float uPatina; uniform float uEnvBoost;`,
    ao: /* glsl */`cgAO = mix(1.0, uEnvBoost, metalnessFactor);`,
    color: /* glsl */`
      float n = cgFbm3(cgO * 6.0 + cgSeed * 13.0, 4) * 0.5 + 0.5;
      float p = smoothstep(0.5, 0.9, cgFbm3(cgO * 7.0 + 7.7 + cgSeed * 3.0, 4) * 0.5 + 0.5) * uPatina;
      // soot from the fire darkens the upper parts of brazier bowls (cgO.y in local units)
      vec3 c = diffuseColor.rgb * (0.78 + 0.4 * n);
      c = mix(c, vec3(0.09, 0.07, 0.05), p * 0.45);
      c = mix(c, vec3(0.13, 0.19, 0.14), p * 0.18 * smoothstep(0.6, 0.9, n));
      c *= mix(vec3(1.08, 1.0, 0.9), vec3(0.92, 0.97, 1.04), cgSeed);
      // about a third of the pieces are older, darker cast bronze
      c *= mix(1.0, 0.45, smoothstep(0.62, 0.8, fract(cgSeed * 7.31)));
      diffuseColor.rgb = c;`,
    roughness: /* glsl */`
      float p2 = smoothstep(0.5, 0.9, cgFbm3(cgO * 7.0 + 7.7 + cgSeed * 3.0, 4) * 0.5 + 0.5) * uPatina;
      roughnessFactor = clamp(roughnessFactor + 0.1 * cgVnoise3(cgO * 25.0) + p2 * 0.4, 0.05, 1.0);`,
    metalness: /* glsl */`
      float p3 = smoothstep(0.5, 0.9, cgFbm3(cgO * 7.0 + 7.7 + cgSeed * 3.0, 4) * 0.5 + 0.5) * uPatina;
      metalnessFactor = mix(metalnessFactor, 0.35, p3);`,
  }));
}

/** Weathered warm marble for small pedestals/planters that this module builds itself. */
export function propMarbleMaterial({ name = 'propMarble' } = {}) {
  return cached(`propMarble:${name}`, () => proceduralMaterial({
    name,
    params: { color: 0xe6dccb, roughness: 0.62, metalness: 0.0 },
    color: /* glsl */`
      vec3 w = cgTriWeights(cgN, 4.0);
      vec3 P = cgP;
      float n = cgFbm3(P * 1.7 + cgSeed * 9.0, 5) * 0.5 + 0.5;
      float vein = 1.0 - smoothstep(0.0, 0.05, abs(cgFbm3(P * vec3(0.6, 1.4, 0.6) + 11.0, 4)));
      float speck = step(0.83, cgVnoise3(P * 38.0)) * 0.6 + step(0.9, cgVnoise3(P * 85.0 + 3.0)) * 0.5;
      float lichen = smoothstep(0.62, 0.78, cgFbm3(P * 2.3 + 5.0, 4) * 0.5 + 0.5) * smoothstep(0.2, 0.8, cgN.y + 0.3);
      vec3 c = diffuseColor.rgb * (0.86 + 0.2 * n);
      c = mix(c, c * vec3(0.78, 0.76, 0.74), vein * 0.5);
      c = mix(c, vec3(0.16, 0.15, 0.14), speck * 0.45);
      c = mix(c, vec3(0.42, 0.40, 0.30), lichen * 0.35);
      // grime: darker toward the bottom of vertical faces and in noise blotches
      float grime = smoothstep(0.55, 0.8, cgFbm3(P * vec3(1.2, 0.35, 1.2) + 2.0, 3) * 0.5 + 0.5);
      c *= 1.0 - 0.22 * grime * (1.0 - abs(cgN.y));
      diffuseColor.rgb = c;`,
    roughness: /* glsl */`roughnessFactor = clamp(roughnessFactor + 0.2 * (cgVnoise3(cgP * 12.0) - 0.5), 0.2, 1.0);`,
    normal: /* glsl */`
      vec3 q = cgP * 9.0; float e = 0.05;
      float b0 = cgFbm3(q, 3);
      vec3 g = vec3(cgFbm3(q + vec3(e,0,0), 3), cgFbm3(q + vec3(0,e,0), 3), cgFbm3(q + vec3(0,0,e), 3)) - b0;
      cgBump = (g / e) * 0.025;
      cgBump -= dot(cgBump, cgN) * cgN;`,
    ao: /* glsl */`cgAO = 0.85 + 0.15 * (cgFbm3(cgP * 3.0, 2) * 0.5 + 0.5);`,
  }));
}

/** Simple dark wood (banner poles). */
export function woodMaterial() {
  return cached('propWood', () => proceduralMaterial({
    name: 'propWood',
    params: { color: 0x4a3322, roughness: 0.7, metalness: 0.0 },
    color: /* glsl */`
      float g = cgFbm3(cgO * vec3(40.0, 2.0, 40.0) + cgSeed * 7.0, 3) * 0.5 + 0.5;
      diffuseColor.rgb *= 0.75 + 0.45 * g;`,
  }));
}

/** Mesh-merging helper: list of {geo, matrix} → single BufferGeometry (position/normal/uv only). */
export function mergeGeos(list) {
  let nv = 0, ni = 0;
  for (const { geo } of list) { nv += geo.attributes.position.count; ni += geo.index ? geo.index.count : geo.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const { geo, matrix } of list) {
    const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
    nm.getNormalMatrix(matrix);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(matrix); pos.set([v.x, v.y, v.z], (vo + i) * 3);
      if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (vo + i) * 3); }
      if (U) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) idx[io++] = geo.index.getX(i) + vo;
    else for (let i = 0; i < P.count; i++) idx[io++] = i + vo;
    vo += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
