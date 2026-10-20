// Materials for the hero sets. Stone and metal come from the shared families (src/materials/stone.js,
// metal.js — temple agent); this file adds set-specific ones: the cast-bronze head of Poseidon,
// navy-enamel / gold meander bands on the banded columns, the trident mosaic, local sand.
import * as THREE from 'three';
import { proceduralMaterial, cached } from '../core/materials.js';
import { whiteStone, stoneMaterial, noiseTexture, NOISE_TEX_HEAD, AUX_VERTEX_HEAD, AUX_VERTEX_PRE } from '../materials/stone.js';
import { goldMaterial, giltMaterial, bronzeMaterial, metalMaterial } from '../materials/metal.js';

export { goldMaterial, giltMaterial, bronzeMaterial, metalMaterial, whiteStone, stoneMaterial };

/** white marble with vertex-colour tint (red bands / blocks are painted per vertex) */
export function bandedColumnMaterial(sunken) {
  return cached('sets:banded:' + sunken, () => {
    const m = whiteStone({ vertexColors: true, weather: sunken ? 0.35 : 0.15, lichen: sunken ? 0.05 : 0.02, polish: sunken ? 0.25 : 0.55, rough: sunken ? 0.5 : 0.4, veins: 1.0, chips: sunken ? 0.35 : 0.8, seed: 2.3 });
    m.name = 'sets-banded';
    if (sunken) m.userData.sunkenAmount = 0.5;   // ref 8: the banded marble still reads clean (cracks, a little crust)
    return m;
  });
}
/** sRGB-ish linear vertex tint of red marble relative to the white base */
export const RED_TINT = [0.50, 0.135, 0.098];

/**
 * Head of Poseidon: cast bronze. Uses the head bake's aux (x cavity, y convex edge, z sky visibility,
 * w flag 0 skin / 1 hair / 2 beard / 3 eye / 4 crown). Sunken: green-blue verdigris crust in the
 * hollows and over most of the surface, rubbed bronze-gold showing on the raised forms (ref 8).
 * Tagged 'gold' so the core overlay only dulls it lightly (the patina is authored here).
 */
export function headBronzeMaterial(sunken = true) {
  return cached('sets:headBronze:' + sunken, () => {
    const m = proceduralMaterial({
      name: 'sets-headBronze',
      params: { color: 0xffffff, metalness: 1, roughness: 0.4 },
      uniforms: { uNoise3D: { value: noiseTexture() }, uSunk: { value: sunken ? 1 : 0 } },
      vertexHead: AUX_VERTEX_HEAD, vertexPre: AUX_VERTEX_PRE,
      head: `${NOISE_TEX_HEAD}
        varying vec4 vCgAux;
        uniform float uSunk;
        float hbPat; float hbBare; float hbGold = 0.0;
        void hbEval(vec3 p, vec4 aux){
          float cav = clamp(aux.x, 0.0, 1.0), edge = clamp(aux.y, 0.0, 1.0), sky = clamp(aux.z, 0.0, 1.0);
          vec4 A = cgN4(p * 0.55) * 0.6 + cgN4(cgR1 * p * 1.7 + 3.0) * 0.4;
          vec4 B = cgN4(cgR2 * p * 6.0 + 7.0);
          // bare (rubbed) bronze: convex edges, high points; patina everywhere else, thickest in hollows
          float skin = 1.0 - step(0.5, aux.w);   // face skin: the raised forms are rubbed bright (ref 8)
          float bare = smoothstep(0.42, 0.66, 0.5 + 0.12 * skin + 2.1 * edge - 1.3 * cav + 0.22 * (A.x - 0.5) + 0.3 * (B.y - 0.5) + 0.35 * (sky - 0.5));
          hbBare = mix(1.0, bare, uSunk);
          hbPat = mix(0.0, clamp(1.0 - bare + cav * 0.5, 0.0, 1.0), uSunk);
        }`,
      color: `
        vec4 aux = vCgAux;
        hbEval(cgP, aux);
        float cav = clamp(aux.x, 0.0, 1.0);
        vec4 C = cgN4(cgP * 2.1 + 1.0), D = cgN4(cgR1 * cgP * 9.0);
        vec3 bronze = mix(vec3(0.50, 0.31, 0.11), vec3(0.72, 0.50, 0.18), C.x) * (0.85 + 0.3 * D.y);
        vec3 gold = vec3(0.78, 0.55, 0.20);
        bronze = mix(bronze, gold, smoothstep(0.55, 0.8, C.z) * 0.6);
        vec3 verd = mix(vec3(0.11, 0.27, 0.18), vec3(0.26, 0.47, 0.34), smoothstep(0.3, 0.75, C.y));
        verd = mix(verd, vec3(0.42, 0.58, 0.45), smoothstep(0.7, 0.9, D.x) * 0.55);
        verd = mix(verd, vec3(0.04, 0.09, 0.06), cav * 0.55);
        vec3 c = mix(bronze, verd, hbPat);
        // dark encrustations (tube-worm / barnacle specks) on the patina
        float sp = smoothstep(0.86, 0.92, cgN4(cgP * 31.0 + 5.0).w) * hbPat;
        c = mix(c, vec3(0.03, 0.035, 0.03), sp * 0.6);
        c = mix(c, c * 0.35, cav * (1.0 - hbPat) * 0.8);
        // gold leaf traces surviving in the sheltered folds of hair / beard / crown band (ref 8)
        float gt = smoothstep(0.62, 0.8, cgN4(cgR2 * cgP * 1.3 + 11.0).z) * smoothstep(0.15, 0.45, cav) * (1.0 - smoothstep(0.75, 1.0, cav)) * uSunk;
        c = mix(c, gold * 0.95, gt * 0.75);
        hbGold = gt;
        diffuseColor.rgb *= c;`,
      metalness: `metalnessFactor = clamp(mix(0.55 - hbPat * 0.55, 0.85, hbGold), 0.0, 1.0);`,
      roughness: `roughnessFactor = mix(mix(0.36 + 0.15 * cgN4(cgP * 3.0).x, 0.8, hbPat), 0.3, hbGold);`,
      normal: `
        float dist = length(cameraPosition - cgP);
        float f = 1.0 - smoothstep(4.0, 60.0, dist);
        if (f > 0.0) {
          vec3 q = cgP * 7.0; float d0 = cgN4(q).x;
          vec3 g = vec3(cgN4(q + vec3(0.25,0,0)).x - d0, cgN4(q + vec3(0,0.25,0)).x - d0, cgN4(q + vec3(0,0,0.25)).x - d0) / 0.25;
          vec3 q2 = cgP * 23.0; float e0 = cgN4(q2).y;
          vec3 g2 = vec3(cgN4(q2 + vec3(0.25,0,0)).y - e0, cgN4(q2 + vec3(0,0.25,0)).y - e0, cgN4(q2 + vec3(0,0,0.25)).y - e0) / 0.25;
          vec3 b = (g * 0.05 + g2 * 0.006 * hbPat) * f;
          cgBump = b - cgN * dot(b, cgN);
        }`,
      ao: `cgAO = 1.0 - 0.7 * clamp(vCgAux.x, 0.0, 1.0);`,
    });
    m.defaultAttributeValues = { ...(m.defaultAttributeValues || {}), aux: [0, 0, 1, 0] };
    m.userData.sunken = 'gold';
    m.userData.sunkenAmount = 0.5;
    return m;
  });
}

/** gold of the crown / trident (sunken: dulled, with encrustation in the hollows) */
export function setGoldMaterial(sunken) {
  return cached('sets:gold:' + sunken, () => {
    const m = goldMaterial(sunken ? { wear: 0.6, roughness: 0.34 } : {});
    return m;
  });
}

/**
 * Navy enamel band with a gold Greek-key (meander) and gold bead rims, wrapped around a column axis
 * (object space: axis y, band from y = 0 to uBand.x, angle → u). Used on the banded columns (ref 8).
 */
export function meanderBandMaterial(sunken) {
  return cached('sets:meander:' + sunken, () => {
    const m = proceduralMaterial({
      name: 'sets-meander',
      params: { color: 0xffffff, metalness: 0, roughness: 0.4 },
      uniforms: { uNoise3D: { value: noiseTexture() } },
      head: `${NOISE_TEX_HEAD}
        float mdGold;
        // greek key on a unit-height strip: x along the band (period 1), y 0..1
        float meander(vec2 q){
          vec2 g = vec2(fract(q.x), q.y);
          // spiral key drawn on a 5x5 grid inside each period
          vec2 c = floor(g * vec2(5.0, 5.0));
          float k = 0.0;
          if (c.y < 0.5 || c.y > 3.5) k = 1.0;                       // border lines (top / bottom of the key)
          if (c.x < 0.5 && c.y < 3.5) k = 1.0;                       // left upright
          if (c.y > 2.5 && c.y < 3.5 && c.x < 3.5) k = 1.0;          // top bar
          if (c.x > 2.5 && c.x < 3.5 && c.y > 0.5 && c.y < 3.5) k = 1.0; // right upright
          if (c.y > 0.5 && c.y < 1.5 && c.x > 1.5 && c.x < 3.5) k = 1.0; // inner hook
          if (c.y < 0.5) k = 0.0;                                    // gap row under the key
          if (c.y > 3.5) k = 0.0;
          return k;
        }`,
      color: `
        float ang = atan(cgO.z, cgO.x);
        float rad = length(cgO.xz);
        float hgt = cgO.y;
        float bandH = 0.32;
        float yb = hgt / bandH;                       // 0..1 across the band height
        float u = ang / 6.2831853 * max(6.0, floor(rad * 6.2831853 / (bandH * 0.9)));
        float rim = step(yb, 0.12) + step(0.88, yb);
        float key = (yb > 0.16 && yb < 0.84) ? meander(vec2(u, (yb - 0.16) / 0.68 * 1.25 - 0.12)) : 0.0;
        mdGold = clamp(rim + key, 0.0, 1.0);
        vec3 navy = vec3(0.012, 0.03, 0.10) * (0.85 + 0.3 * cgN4(cgP * 4.0).x);
        vec3 gold = vec3(0.80, 0.56, 0.20);
        diffuseColor.rgb *= mix(navy, gold, mdGold);`,
      metalness: `metalnessFactor = mdGold;`,
      roughness: `roughnessFactor = mix(0.35, 0.3, mdGold) + 0.15 * cgN4(cgP * 6.0).y;`,
    });
    m.userData.sunken = 'gold';
    return m;
  });
}

/** local pale sand for the set mounds (ripples in the normal) */
export function setSandMaterial() {
  return cached('sets:sand', () => {
    const m = proceduralMaterial({
      name: 'sets-sand',
      params: { color: 0xffffff, roughness: 0.95, metalness: 0 },
      uniforms: { uNoise3D: { value: noiseTexture() } },
      head: `${NOISE_TEX_HEAD}
        float sdRip(vec2 p){
          vec4 w = cgN4(vec3(p * 0.35, 1.3));
          float ph = p.x * 2.6 + p.y * 1.1 + w.x * 5.0;
          float r = sin(ph); r = r * r * sign(r);
          return r * 0.012 + (cgN4(vec3(p * 3.0, 7.0)).y - 0.5) * 0.006;
        }`,
      color: `
        vec4 A = cgN4(vec3(cgP.xz * 0.25, 2.0)), B = cgN4(vec3(cgP.xz * 4.0, 9.0));
        vec3 c = mix(vec3(0.60, 0.58, 0.50), vec3(0.72, 0.70, 0.62), A.x);
        c *= 0.9 + 0.18 * B.z;
        // shell grit and darker detritus
        c = mix(c, vec3(0.30, 0.28, 0.24), smoothstep(0.80, 0.9, cgN4(vec3(cgP.xz * 11.0, 3.0)).w) * 0.6);
        diffuseColor.rgb *= c;`,
      normal: `
        vec2 p = cgP.xz; float e = 0.02;
        float h0 = sdRip(p), hx = sdRip(p + vec2(e, 0.0)), hz = sdRip(p + vec2(0.0, e));
        cgBump = vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 1.2;`,
    });
    m.userData.sunken = 'none';
    return m;
  });
}

/** rough rubble / broken slab stone */
export function rubbleMaterial(sunken) {
  return cached('sets:rubble:' + sunken, () => { const m = stoneMaterial({ kind: 'white', weather: 0.35, lichen: 0.03, polish: 0.0, rough: 0.75, chips: 1.0, seed: 4.1, veins: 0.9 }); m.userData.sunkenAmount = 0.45; return m; });
}
