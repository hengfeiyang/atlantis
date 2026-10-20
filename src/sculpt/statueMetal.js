// Gilt-bronze / bronze statue material driven by the baked vertex data of the SDF sculpts:
//   color attribute (Uint8 normalized): r = ambient occlusion (1 = open), g = cavity, b = metal mask
//   (0.85 gilt body, 1 polished harness / crown / trident).
// Colours follow src/materials/metal.js (gold / bronze), with two statue-specific additions:
//   * a reflected-ground fill: the IBL is the sky only, so polished gold surfaces facing down (bellies, wing
//     undersides, the shadow side) would mirror an empty dark lower hemisphere; real statues there reflect the
//     sunlit marble plaza and their own gold. The fill is weighted by the baked AO.
//   * cavity tarnish (dark brown-black) that gives the sculpture its crisp definition (ref 3).
// Tag: golden 'gold'; sunken 'metal' (core/sunken.js turns it to verdigris).
import * as THREE from 'three';
import { proceduralMaterial, cached } from '../core/materials.js';
import { TONE, TONE_HEAD } from '../materials/tone.js';

export function statueMetal(o = {}) {
  const era = o.sunken ? 'sunken' : 'golden';
  const key = 'statueMetal:' + JSON.stringify(o);
  return cached(key, () => {
    const sunk = !!o.sunken;
    const base = o.base || (sunk ? [0.5, 0.33, 0.17] : [0.86, 0.58, 0.2]);
    const dark = o.dark || (sunk ? [0.07, 0.05, 0.03] : [0.17, 0.09, 0.03]);
    const v3 = (c) => `vec3(${c.map((x) => x.toFixed(4)).join(',')})`;
    const rough = (o.roughness ?? (sunk ? 0.55 : 0.3)).toFixed(3);
    const fill = (o.fill ?? (sunk ? 0.0 : 0.85)).toFixed(3);
    const sc = (o.scale ?? 1).toFixed(4);
    const m = proceduralMaterial({
      name: 'statueMetal-' + era,
      params: { color: 0xffffff, metalness: 1, roughness: 0.3, vertexColors: true },
      uniforms: sunk ? {} : { ...TONE }, head: sunk ? '' : TONE_HEAD,
      color: /* glsl */ `
        vec3 vc = vColor.rgb;
        float ao = vc.r, cav = vc.g, msk = vc.b;
        vec3 P = cgP * ${sc};
        float n1 = cgVfbm3(P * 0.35 + 3.0, 3), n2 = cgVnoise3(P * 3.1);
        vec3 c = ${v3(base)} * (0.9 + 0.16 * n1 + 0.04 * n2);
        // polished parts (harness, crown, trident) a touch brighter / yellower
        c = mix(c, c * vec3(1.06, 1.05, 0.96), smoothstep(0.9, 0.98, msk));
        // tarnish in crevices + soft occlusion darkening of the albedo (reads as depth on metal)
        float tar = clamp(cav * 1.1 + (1.0 - ao) * 0.5, 0.0, 1.0);
        c = mix(c, ${v3(dark)}, smoothstep(0.08, 0.85, tar) * 0.85);
        c *= mix(0.55, 1.0, smoothstep(0.2, 0.95, ao));
        ${sunk ? `
        // old bronze: darker, uneven; the gilt survives as traces in protected hollows and on the polished parts
        float gl = smoothstep(0.9, 0.98, msk) * 0.6 + smoothstep(0.55, 0.8, cav) * 0.25;
        c = mix(c, vec3(0.55, 0.38, 0.14) * (0.8 + 0.3 * n1), gl * smoothstep(0.45, 0.7, cgVfbm3(P * 1.7 + 9.0, 2)));
        ` : ''}
        ${sunk ? '' : 'c = cgToneGold(c); // r7 per-shot tone'}
        diffuseColor.rgb = c;
      `,
      roughness: /* glsl */ `
        {
          vec3 vc2 = vColor.rgb;
          roughnessFactor = clamp(${rough} + 0.08 * (cgVnoise3(cgP * ${sc} * 2.3) - 0.5) + 0.3 * vc2.g - 0.08 * smoothstep(0.9, 0.98, vc2.b), 0.08, 1.0);
          ${sunk ? '' : 'roughnessFactor = clamp(roughnessFactor * uGoldRough, 0.05, 1.0);'}
        }
      `,
      metalness: /* glsl */ `
        metalnessFactor = 1.0 - 0.3 * clamp(vColor.g * 1.2, 0.0, 1.0);
      `,
      emissive: /* glsl */ `
        #if NUM_DIR_LIGHTS > 0 && defined(USE_FOG)
        {
          // reflected sunlit ground / surrounding gold (missing from the sky-only IBL), AO weighted
          vec3 R = reflect(-cgV, cgN);
          float below = smoothstep(0.25, -0.45, R.y);
          vec3 Ls = normalize(uSunDir);
          float E = max(Ls.y, 0.12);
          float side = 0.55 + 0.45 * max(0.0, -dot(normalize(vec3(R.x, 0.0, R.z) + 1e-5), normalize(vec3(Ls.x, 0.0, Ls.z) + 1e-5)));
          vec3 gnd = vec3(0.62, 0.56, 0.48) * directionalLights[0].color * E * RECIPROCAL_PI;
          totalEmissiveRadiance += diffuseColor.rgb * gnd * below * side * ${fill} * ${sunk ? '1.0' : 'uGoldFill'} * mix(0.15, 1.0, vColor.r * vColor.r);
          // diffuse-like warm interreflection in occluded gold (folds between the horses)
          totalEmissiveRadiance += diffuseColor.rgb * directionalLights[0].color * E * 0.025 * ${fill} * ${sunk ? '1.0' : 'uGoldFill'} * (1.0 - vColor.r);
        }
        #endif
      `,
      ao: /* glsl */ `
        cgAO = mix(1.0, vColor.r, 0.8);
      `,
    });
    m.userData.sunken = sunk ? 'metal' : 'gold';
    return m;
  });
}
