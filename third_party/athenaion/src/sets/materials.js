// Materials for the foreground sets: pitted cream limestone / travertine like the ref-2 terrace
// (scattered dark pits of several sizes, black lichen dots and blotches, grime packed in joints, worn
// paler arrises, faint vertical rain streaks, greenish film on the tops), plus a cleaner dressed variant.
// Geometry from the arch MeshBuilder carries `aux` (x = cavity, y = edge); meshes without it read 0.
import * as THREE from 'three';
import { proceduralMaterial, cached } from '../core/materials.js';

const HEAD = /* glsl */`
  varying vec4 vSetAux;
  uniform vec4 uSt; // x pits, y lichen, z grime, w base brightness
  float gStPit;
  // F1 distance + per-cell hash of the nearest feature point
  vec2 stVor(vec3 p) {
    vec3 i = floor(p), f = fract(p); float d = 8.0, h = 0.0;
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec3 o = vec3(float(x), float(y), float(z)); vec3 dd = o + cgHash33(i + o) - f; float q = dot(dd, dd);
      if (q < d) { d = q; h = cgHash13(i + o + 17.31); }
    }
    return vec2(sqrt(d), h);
  }
  // pit field: a random subset of the cells carries a hole (random radius); returns depth 0..1
  float stPitField(vec3 p, float dens) {
    vec2 v = stVor(p);
    dens *= 1.7 * smoothstep(0.32, 0.72, cgVnoise3(p * 0.21 + 5.0)); // pits come in clusters, not a polka-dot grid
    float r = 0.06 + 0.26 * pow(fract(v.y * 13.7), 1.6);
    return smoothstep(r, r * 0.3, v.x) * step(1.0 - dens, v.y);
  }
  float stPits2(vec3 P) { return max(stPitField(P * 8.0, 0.42), stPitField(P * 19.0 + 11.0, 0.5) * 0.85) * uSt.x; }
  float stPits(vec3 P) { return max(stPits2(P), stPitField(P * 50.0 + 5.0, 0.45) * 0.6 * uSt.x); }
  float stHeight(vec3 P) { return -0.01 * stPits2(P) + 0.004 * cgFbm3(P * 7.0, 2); }
`;

const VHEAD = /* glsl */`attribute vec4 aux; varying vec4 vSetAux;`;
const VPRE = /* glsl */`vSetAux = aux;`;

const COLOR = /* glsl */`
  vec3 P = cgP;
  float cav = clamp(vSetAux.x, 0.0, 1.0), edge = clamp(vSetAux.y, 0.0, 1.0);
  float up = cgN.y;
  float big = cgFbm3(P * 0.45 + cgSeed * 3.0, 4) * 0.5 + 0.5;
  float mid = cgFbm3(P * 2.2 + 7.0, 4) * 0.5 + 0.5;
  vec3 base = diffuseColor.rgb * uSt.w;
  base *= 0.84 + 0.3 * big;
  base *= mix(vec3(1.04, 0.99, 0.92), vec3(0.95, 0.97, 1.02), smoothstep(0.35, 0.75, mid));
  // ochre / rust staining in patches
  float och = smoothstep(0.62, 0.85, cgFbm3(P * 0.9 + 21.0, 3) * 0.5 + 0.5);
  base = mix(base, base * vec3(1.05, 0.86, 0.62), och * 0.45);
  // pits: dark holes with a soft grey halo
  float pit = stPits(P); gStPit = pit;
  float halo = smoothstep(0.0, 0.6, stPitField(P * 3.2 + 2.0, 0.3));
  vec3 c = mix(base, base * 0.78, halo * 0.35 * uSt.x);
  c = mix(c, vec3(0.055, 0.05, 0.045), pit * 0.82);
  // black lichen dots + grey-green lichen blotches
  float dots = smoothstep(0.78, 0.86, cgVnoise3(P * 31.0 + 4.0)) * smoothstep(0.45, 0.7, cgFbm3(P * 1.6 + 9.0, 3) * 0.5 + 0.5);
  c = mix(c, vec3(0.04, 0.04, 0.035), dots * 0.75 * uSt.y);
  float blot = smoothstep(0.05, 0.3, cgFbm3(P * 2.6 + 13.0, 4)) * (0.6 + 0.4 * smoothstep(-0.2, 0.3, cgFbm3(P * 9.0 + 1.0, 3)));
  c = mix(c, c * vec3(0.3, 0.31, 0.28), blot * 0.85 * uSt.y);
  float blot2 = smoothstep(0.55, 0.72, cgFbm3(P * 7.0 + 3.0, 3) * 0.5 + 0.5) * smoothstep(0.4, 0.65, cgFbm3(P * 1.1 + 40.0, 2) * 0.5 + 0.5);
  c = mix(c, vec3(0.09, 0.09, 0.08), blot2 * 0.55 * uSt.y);
  float yel = smoothstep(0.8, 0.9, cgFbm3(P * 5.0 + 31.0, 3) * 0.5 + 0.5);
  c = mix(c, vec3(0.42, 0.33, 0.12), yel * 0.5 * uSt.y);
  // fine black speckle (crust / lichen pinheads), clustered
  float spk = smoothstep(0.7, 0.8, cgVnoise3(P * 85.0 + 9.0)) * smoothstep(0.35, 0.65, cgFbm3(P * 2.4 + 50.0, 2) * 0.5 + 0.5);
  c = mix(c, vec3(0.06, 0.06, 0.055), spk * 0.6 * uSt.y);
  // green film on tops, grime in cavities / joints and under ledges, rain streaks on the faces
  float film = smoothstep(0.3, 0.9, up) * smoothstep(0.45, 0.75, cgFbm3(P * 1.3 + 17.0, 3) * 0.5 + 0.5);
  c = mix(c, c * vec3(0.72, 0.78, 0.6), film * 0.5);
  float streak = smoothstep(0.55, 0.9, cgVnoise3(vec3(P.x * 9.0, P.y * 0.35, P.z * 9.0) + 2.0)) * (1.0 - abs(up));
  c *= 1.0 - 0.28 * streak * uSt.z;
  c *= mix(1.0, 0.45, smoothstep(0.1, 0.9, cav) * uSt.z);
  c *= mix(1.0, 0.82, smoothstep(0.0, -0.8, up) * uSt.z);
  // worn arrises are paler
  c = mix(c, c * 1.12 + 0.02, edge * 0.35 * (1.0 - pit));
  diffuseColor.rgb = c;
`;

const ROUGH = /* glsl */`
  float pr = gStPit;
  roughnessFactor = clamp(roughnessFactor + 0.12 * (cgVnoise3(cgP * 15.0) - 0.5) + 0.15 * pr, 0.35, 1.0);
`;

const NORMAL = /* glsl */`
  float e = 0.004;
  float h0 = stHeight(cgP);
  vec3 g = vec3(stHeight(cgP + vec3(e, 0.0, 0.0)), stHeight(cgP + vec3(0.0, e, 0.0)), stHeight(cgP + vec3(0.0, 0.0, e))) - h0;
  vec3 grad = g / e;
  grad -= dot(grad, cgN) * cgN;
  if (!(dot(grad, grad) < 100.0)) grad = vec3(0.0); // NaN / degenerate normal guard
  cgBump = -grad;
`;

const AO = /* glsl */`
  float cv = clamp(vSetAux.x, 0.0, 1.0);
  cgAO = mix(1.0, 0.3, smoothstep(0.05, 0.95, cv)) * (0.78 + 0.22 * smoothstep(-0.6, 0.5, cgN.y)) * (1.0 - 0.35 * gStPit);
`;

function setStone(name, color, params) {
  return cached('setStone:' + name, () => proceduralMaterial({
    name,
    params: { color, roughness: params.rough ?? 0.78, metalness: 0 },
    uniforms: { uSt: { value: new THREE.Vector4(params.pits, params.lichen, params.grime, params.bright) } },
    vertexHead: VHEAD, vertexPre: VPRE,
    head: HEAD, color: COLOR, roughness: ROUGH, normal: NORMAL, ao: AO,
  }));
}

/** rough pitted travertine-like limestone (parapet, wall courses, pier drums) */
export function setStoneMaterial() { return setStone('setStoneRough', 0xd8cdb6, { pits: 1.0, lichen: 1.0, grime: 1.0, bright: 1.0, rough: 0.82 }); }
/** dressed stone (pedestals, balustrades, coping, steps) — finer, cleaner */
export function setDressedMaterial() { return setStone('setStoneDressed', 0xe2d8c4, { pits: 0.7, lichen: 0.7, grime: 0.85, bright: 1.0, rough: 0.72 }); }
/** limestone boulders at the water (geometry gets an aux attribute from its cavity) */
export function setRockMaterial() { return setStone('setStoneRock', 0xcfc5b1, { pits: 0.9, lichen: 1.1, grime: 1.1, bright: 1.0, rough: 0.86 }); }
