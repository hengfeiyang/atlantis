// Weathered white marble with baked AO/cavity + gilding/bronze masks (vertex colour channels):
//   r = ambient occlusion (1 = open), g = cavity (1 = deep crevice), b = metal mask
//   b < 0.3 marble · 0.45..0.7 dark/old bronze · 1.0 bright gold leaf
// Works on Mesh and InstancedMesh (cgSeed varies the weathering per instance).
import { proceduralMaterial, cached } from '../core/materials.js';

const HEAD = /* glsl */ `
float stMask(){ return 0.0; }
`;

/**
 * @param {object} o  { scale: world metres per noise unit multiplier, dirt: 0..1, name,
 *                     ashlar: course height (m) → masonry joints + per-block tone on vertical faces (pedestals) }
 */
export function statueMaterial(o = {}) {
  const key = 'statueMarble:' + JSON.stringify({ n: o.name, d: o.dirt, t: o.tint, s: o.scale, a: o.ashlar, f: o.fill, w: o.weather, i: o.inscription }) + (o.emblem ? o.emblem.uuid : '');
  // (r6) o.inscription: the emblem texture's G channel gilds letters on plain marble (no bronze field)
  const ML = o.inscription ? '0.0' : '0.55', MM = o.inscription ? '0.0' : '0.5';
  return cached(key, () => {
    const dirt = (o.dirt ?? 1).toFixed(3);
    // noise scale: weathering features scale with the statue (a 28 m colossus reads like a life-size marble)
    const sc = (o.scale ?? 1).toFixed(4);
    const tint = o.tint || [1, 1, 1];
    const params = { color: 0xffffff, roughness: 0.55, metalness: 0.0, vertexColors: true };
    if (o.emblem) { params.bumpMap = o.emblem; params.bumpScale = o.bumpScale ?? 2.0; }
    const mat = proceduralMaterial({
      name: o.name || 'statueMarble',
      params,
      head: HEAD,
      color: /* glsl */ `
        vec3 vc = vColor.rgb;
        // vertex colours are multiplied into diffuseColor by three: undo that, we use them as data
        diffuseColor.rgb = vec3(1.0);
        float ao = vc.r, cav = vc.g, metal = vc.b;
        #ifdef USE_BUMPMAP
          // shield face: crisp gilding mask from the emblem texture (uv < 0 = rim / back)
          if (vBumpMapUv.x >= 0.0) {
            vec4 em = texture2D(bumpMap, vBumpMapUv);
            metal = mix(${ML}, 1.0, smoothstep(0.35, 0.65, em.g));
          }
        #endif
        vec3 P = cgP * ${sc};
        float seed = cgSeed;
        // ---------------- marble
        vec3 marble = vec3(0.705, 0.69, 0.675) * vec3(${tint.map((v) => v.toFixed(3)).join(',')});
        float big = cgVfbm3(P * 0.22 + seed * 13.0, 3);
        marble *= 0.9 + 0.17 * big;
        // weathered patches: slightly greyer / warmer large blotches
        float blot = cgVfbm3(P * 0.55 + vec3(seed * 7.0, 3.0, 1.0), 4);
        marble = mix(marble, marble * vec3(0.85, 0.84, 0.82), smoothstep(0.52, 0.72, blot) * 0.7 * ${dirt});
        marble = mix(marble, marble * vec3(1.02, 0.99, 0.95), smoothstep(0.45, 0.75, cgVfbm3(P * 0.09 + 3.1, 2)) * 0.6);
        // veins / hairline cracks: thin wavy brown-grey lines (zero crossings of a noise field)
        float vz = abs(cgFbm3(P * vec3(1.6, 1.2, 1.6) + seed * 7.0, 4));
        float vein = 1.0 - smoothstep(0.004, 0.03, vz);
        float vz2 = abs(cgFbm3(P * 3.4 + vec3(seed * 3.0, 11.0, 5.0), 3));
        vein = max(vein, (1.0 - smoothstep(0.003, 0.02, vz2)) * 0.6);
        vein *= smoothstep(0.3, 0.6, cgVfbm3(P * 0.9 + 9.0, 2)) * 0.9 + 0.1;
        marble = mix(marble, vec3(0.42, 0.37, 0.31), vein * 0.55);
        // soft wide grey veining
        float vw = abs(cgFbm3(P * 0.18 + seed * 2.0, 3));
        marble = mix(marble, marble * vec3(0.84, 0.85, 0.87), (1.0 - smoothstep(0.0, 0.09, vw)) * 0.35);
        // ---------------- weathering
        float up = clamp(cgN.y, 0.0, 1.0);
        // grime collected in crevices and occluded zones (warm brown-grey)
        float grime = clamp(cav * 1.0 + (1.0 - ao) * 1.15, 0.0, 1.0);
        grime = smoothstep(0.05, 0.8, grime) * ${dirt};
        marble = mix(marble, vec3(0.33, 0.315, 0.295), grime * 0.6);
        // r2: midtone contrast in the drapery folds (baked AO also darkens the albedo a little)
        marble *= mix(0.74, 1.0, smoothstep(0.25, 0.92, ao));
        // ochre-brown stains seeping from crevices and cracks
        float och0 = smoothstep(0.5, 0.75, cgVfbm3(P * 0.8 + 23.0 + seed * 3.0, 3));
        marble = mix(marble, vec3(0.53, 0.45, 0.33), clamp(och0 * (0.25 + cav * 0.9 + vein * 0.6), 0.0, 1.0) * 0.24 * ${dirt});
        // drip streaks running down from ledges
        float st = cgVfbm3(vec3(P.x * 3.1, P.y * 0.22, P.z * 3.1) + seed * 5.0, 3);
        float streak = smoothstep(0.55, 0.78, st) * (1.0 - up) * 0.55 * ${dirt};
        marble = mix(marble, vec3(0.44, 0.41, 0.36), streak * 0.5);
        // black speckles (pitting / lichen dots), denser on upward faces
        vec3 vor = cgVoronoi2(P.xz * 9.0 + P.y * vec2(5.3, 3.7) + seed * 17.0);
        float spotMask = smoothstep(0.35, 0.7, cgVfbm3(P * 1.3 + 11.0, 3)) * (0.45 + 0.55 * up);
        float spots = (1.0 - smoothstep(0.05, 0.14, vor.x)) * step(0.5, vor.z) * spotMask * ${dirt};
        marble = mix(marble, vec3(0.12, 0.115, 0.1), spots * 0.85);
        vec3 vor3 = cgVoronoi2(P.xy * 23.0 + P.z * vec2(7.1, 4.3) + seed * 5.0);
        marble = mix(marble, vec3(0.16, 0.15, 0.13), (1.0 - smoothstep(0.04, 0.1, vor3.x)) * step(0.72, vor3.z) * 0.6 * ${dirt});
        // larger lichen colonies (read from a distance)
        vec3 vor2 = cgVoronoi2(P.xz * 2.2 + P.y * vec2(1.9, 1.3) + seed * 5.0);
        float col2 = (1.0 - smoothstep(0.12, 0.3, vor2.x)) * step(0.72, vor2.z) * smoothstep(0.4, 0.7, cgVfbm3(P * 0.8 + 4.0, 2));
        marble = mix(marble, vec3(0.25, 0.24, 0.21), col2 * 0.5 * ${dirt});
        float fine = cgVnoise3(P * 38.0);
        marble = mix(marble, vec3(0.2, 0.2, 0.19), smoothstep(0.84, 0.96, fine) * 0.35 * ${dirt});
        // mossy green tint in damp occluded upward spots
        marble = mix(marble, vec3(0.28, 0.31, 0.2), clamp((1.0 - ao) * up * 0.6, 0.0, 1.0) * 0.3 * ${dirt});
        ${o.ashlar ? `
        {
          // (r3) ashlar courses on the vertical faces of big pedestals (world space, staggered joints)
          float CH = ${(+o.ashlar).toFixed(3)};
          float vert = 1.0 - smoothstep(0.35, 0.6, abs(cgN.y));
          vec2 tg = normalize(vec2(-cgN.z, cgN.x) + vec2(1e-5));
          float cy = cgP.y / CH, row = floor(cy);
          float bl = CH * (1.5 + 0.9 * cgHash11(row * 7.13 + 1.7));
          float tt = dot(cgP.xz, tg) / bl + cgHash11(row * 3.71 + 0.3);
          float dy = min(fract(cy), 1.0 - fract(cy)) * CH, dx = min(fract(tt), 1.0 - fract(tt)) * bl;
          float dj = min(dy, dx);
          float joint = (1.0 - smoothstep(0.012, 0.03, dj)) * vert;
          marble *= mix(1.0, 0.9 + 0.17 * cgHash12(vec2(row, floor(tt))), vert);
          marble *= 1.0 - 0.13 * (1.0 - smoothstep(0.0, 0.14, dj)) * vert;
          marble = mix(marble, vec3(0.2, 0.185, 0.165), joint * 0.8);
          // top faces: slab joints + weathered grey-ochre crust (reads as old stone from above, ref 4)
          float flatT = smoothstep(0.7, 0.9, cgN.y);
          vec2 sg = cgP.xz / (CH * 2.2);
          vec2 sf = abs(fract(sg) - 0.5) * CH * 2.2;
          float sj = (1.0 - smoothstep(0.012, 0.03, CH * 1.1 - max(sf.x, sf.y))) * flatT;
          marble *= mix(1.0, 0.86 + 0.16 * cgHash12(floor(sg)), flatT);
          marble = mix(marble, marble * vec3(0.8, 0.77, 0.72), flatT * smoothstep(0.35, 0.75, cgVfbm3(cgP * 0.35 + 2.0, 3)) * 0.8);
          marble = mix(marble, vec3(0.22, 0.2, 0.18), sj * 0.75);
        }` : ''}
        ${o.weather ? `
        {
          // (r6) heavy weathering for big pedestals (ref 5: grey stone, rain-wash streaks under ledges, black crust)
          float WW = ${(+o.weather).toFixed(3)};
          float vert2 = 1.0 - smoothstep(0.3, 0.6, abs(cgN.y));
          float st2 = cgVfbm3(vec3(cgP.x * 1.3, cgP.y * 0.07, cgP.z * 1.3) + 7.0, 3);
          float rs = smoothstep(0.38, 0.62, st2) * vert2;
          marble = mix(marble, marble * vec3(0.46, 0.44, 0.41), min(1.0, rs * 0.75 * WW));
          float cr = smoothstep(0.5, 0.7, cgVfbm3(cgP * 0.45 + 13.0, 4)) * (0.5 + 0.5 * vert2);
          cr *= smoothstep(0.3, 0.6, cgVfbm3(cgP * 2.3 + 3.0, 3)); // broken, speckled crust edges
          marble = mix(marble, vec3(0.13, 0.125, 0.115), min(1.0, cr * 0.75 * WW));
          // dark grime collected under every moulding / in the joints (baked AO), ref 5's crisp dark lines
          marble *= mix(1.0, 0.72, (1.0 - smoothstep(0.55, 0.95, ao)) * min(1.0, WW));
          float ws = smoothstep(0.55, 0.8, cgVfbm3(vec3(cgP.x * 2.1, cgP.y * 0.12, cgP.z * 2.1) + 31.0, 2)) * vert2;
          marble = mix(marble, marble * vec3(1.06, 1.05, 1.03), ws * 0.5 * WW);
          marble *= mix(1.0, 0.84, min(1.0, WW * 0.5));
        }` : ''}
        // ---------------- metals
        float isMetal = smoothstep(0.3, 0.42, metal);
        float bright = smoothstep(0.55, 0.95, metal);
        vec3 bronze = vec3(0.115, 0.085, 0.056); // (r3) patinated old bronze, half dielectric (refs 4, 5: warm dark-brown shield field)
        vec3 gold = vec3(0.86, 0.63, 0.34); // (r3) less saturated old gold (refs 4, 5)
        float wear = cgVfbm3(P * 4.0 + 5.0, 3);
        vec3 met = mix(bronze, gold, bright);
        met = mix(met, met * vec3(0.55, 0.5, 0.42), clamp(cav * 1.2 + (1.0 - ao) * 0.6, 0.0, 1.0) * 0.8); // tarnish in crevices
        met *= 0.85 + 0.25 * wear;
        // verdigris hints on the bronze
        met = mix(met, vec3(0.13, 0.2, 0.17), (1.0 - bright) * smoothstep(0.55, 0.8, wear) * 0.5);
        diffuseColor.rgb = mix(marble, met, isMetal);
      `,
      roughness: /* glsl */ `
        {
          vec3 vc2 = vColor.rgb;
          float mb = vc2.b;
          #ifdef USE_BUMPMAP
            if (vBumpMapUv.x >= 0.0) mb = mix(${ML}, 1.0, smoothstep(0.35, 0.65, texture2D(bumpMap, vBumpMapUv).g));
          #endif
          float isM = smoothstep(0.3, 0.42, mb);
          float rm = 0.5 + 0.18 * cgVfbm3(cgP * 1.7, 2) + 0.15 * vc2.g;
          float rg = mix(0.7, 0.48, smoothstep(0.55, 0.95, mb)) + 0.1 * cgVnoise3(cgP * 6.0) + 0.12 * vc2.g;
          roughnessFactor = mix(rm, rg, isM);
        }
      `,
      metalness: /* glsl */ `
        metalnessFactor = smoothstep(0.3, 0.42, vColor.b) * mix(0.5, 1.0, smoothstep(0.55, 0.95, vColor.b));
        #ifdef USE_BUMPMAP
          if (vBumpMapUv.x >= 0.0) metalnessFactor = mix(${MM}, 1.0, smoothstep(0.35, 0.65, texture2D(bumpMap, vBumpMapUv).g));
        #endif
      `,
      normal: /* glsl */ `
        {
          // fine pitting / tool marks of weathered stone (world space)
          float e = 0.012;
          vec3 q = cgP * (9.0 * ${sc});
          float n0 = cgVnoise3(q);
          float nx = cgVnoise3(q + vec3(e * 9.0, 0.0, 0.0));
          float ny = cgVnoise3(q + vec3(0.0, e * 9.0, 0.0));
          float nz = cgVnoise3(q + vec3(0.0, 0.0, e * 9.0));
          vec3 g = vec3(nx - n0, ny - n0, nz - n0) / e;
          g -= cgN * dot(g, cgN);
          float isM = smoothstep(0.3, 0.42, vColor.b);
          cgBump = -g * 0.0035 * (1.0 - isM * 0.7);
        }
      `,
      emissive: /* glsl */ `
        {
          // metals: the IBL has no sunlit surroundings (marble walls, ground) to reflect, so add a warm
          // bounce so rough gilding reads golden instead of black away from the sun highlight
          float isM = smoothstep(0.3, 0.42, vColor.b);
          if (isM > 0.0) {
            vec3 R = reflect(-cgV, cgN);
            float bounce = 0.11 + 0.16 * smoothstep(0.25, -0.35, R.y);
            // (gold leaf only: the dark bronze shield field stays dark as in ref 5)
            float gl = smoothstep(0.6, 0.9, vColor.b);
            #ifdef USE_BUMPMAP
              if (vBumpMapUv.x >= 0.0) gl = smoothstep(0.35, 0.65, texture2D(bumpMap, vBumpMapUv).g);
            #endif
            totalEmissiveRadiance += diffuseColor.rgb * isM * gl * bounce * mix(0.35, 1.0, vColor.r);
          }
        }
        #if NUM_DIR_LIGHTS > 0 && defined(USE_FOG)
        {
          // (r3) marble bounce fill: the IBL has no sunlit ground / walls around a statue, so shadowed
          // marble went near-black (ART_BIBLE: shadows cool grey, never black). Faces turned down or away
          // from the sun see sunlit pavement and masonry: add that bounce (Lambert, AO-weighted).
          float isM3 = smoothstep(0.3, 0.42, vColor.b);
          vec3 Ls = normalize(uSunDir);
          vec3 Lh = normalize(vec3(Ls.x, 0.0, Ls.z) + vec3(1e-5));
          float below = 0.5 - 0.5 * cgN.y;
          float away = max(0.0, -dot(cgN, Lh));
          float fill = ${(o.fill ?? 0.5).toFixed(3)} * (0.6 * below + 0.4 * away + 0.12) * max(Ls.y, 0.15);
          totalEmissiveRadiance += diffuseColor.rgb * RECIPROCAL_PI * directionalLights[0].color * fill * (1.0 - isM3) * mix(0.25, 1.0, vColor.r);
        }
        #endif
      `,
      ao: /* glsl */ `
        cgAO = mix(1.0, vColor.r, 0.86);
      `,
    });
    return mat;
  });
}
