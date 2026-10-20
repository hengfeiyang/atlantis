// Procedural materials for the aqueducts & bridges: weathered limestone ashlar (pattern driven by the
// per-vertex `aStone` attribute and the structure's local frame), gilded bronze, and flowing channel water.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';

const STONE_VERTEX_HEAD = /* glsl */ `
attribute vec2 aStone;
varying vec2 vStone;
varying vec3 vObjN;
`;
const STONE_VERTEX_PRE = /* glsl */ `
vStone = aStone;
vObjN = objectNormal;
`;

const STONE_HEAD = /* glsl */ `
varying vec2 vStone;
varying vec3 vObjN;
uniform vec2 uAxis;      // world xz direction of local +x
uniform vec4 uLedges;    // heights of the main horizontal ledges (drip streak sources)
uniform float uWaterY;   // water level under the structure
uniform float uCourse;   // ashlar course height (m)
uniform float uMoss;     // overall moss amount
uniform vec3 uTint;      // per-structure stone tint
uniform vec4 uWet[6];    // wet streak sources: x (local), top y, z sign (+1/-1, 0 = both), width
float gRough; vec3 gBump; float gAO;

vec3 aqLocalToWorld(vec3 v){ return vec3(v.x * uAxis.x - v.z * uAxis.y, v.y, v.x * uAxis.y + v.z * uAxis.x); }

// distance (m) to the nearest joint of a running-bond ashlar pattern + block id + in-block coords
vec4 aqAshlar(vec2 p, float ch, float bl, float salt){
  // courses of slightly varying height (jittered course lines)
  float row = floor(p.y / ch);
  float b0 = (row + 0.32 * (cgHash12(vec2(row, salt + 3.0)) - 0.5)) * ch;
  if (p.y < b0) { row -= 1.0; b0 = (row + 0.32 * (cgHash12(vec2(row, salt + 3.0)) - 0.5)) * ch; }
  float b1 = (row + 1.0 + 0.32 * (cgHash12(vec2(row + 1.0, salt + 3.0)) - 0.5)) * ch;
  float rH = b1 - b0;
  float rh = cgHash12(vec2(row, salt));
  float L = bl * (0.62 + 0.8 * rh) * (rH / ch);
  float bx = p.x / L + rh * 5.31;
  float col = floor(bx);
  float fx = fract(bx), fy = (p.y - b0) / rH;
  float ex = min(fx, 1.0 - fx) * L, ey = min(fy, 1.0 - fy) * rH;
  float id = cgHash12(vec2(col * 1.731 + row * 11.17, row + salt * 3.1));
  // signed direction toward the nearest edge (for bevel normals): x in (-1,1), y in (-1,1)
  return vec4(min(ex, ey), id, ex < ey ? sign(fx - 0.5) : 0.0, ex < ey ? 0.0 : sign(fy - 0.5));
}
`;

const STONE_COLOR = /* glsl */ `
float sTypeRaw = floor(vStone.x / 100.0 + 0.0005);
float sRem = vStone.x - sTypeRaw * 100.0;
float edgeJ = step(9.5, sTypeRaw);             // chamfer faces tagged as dirty joints
float sType = sTypeRaw - 10.0 * edgeJ;
float sWear = floor(sRem + 0.0005) / 99.0, sSeed = fract(sRem + 0.0005), sGround = vStone.y;
vec3 Lp = cgO;                // local coords: x along, y up, z across
vec3 On = normalize(vObjN);
vec3 aN = abs(On);
// face-aligned 2D coords + world tangents
vec2 uv; vec3 tU, tV;
if (aN.z >= aN.x && aN.z >= aN.y) { uv = vec2(Lp.x, Lp.y); tU = aqLocalToWorld(vec3(1,0,0)); tV = vec3(0,1,0); }
else if (aN.x >= aN.y) { uv = vec2(Lp.z, Lp.y); tU = aqLocalToWorld(vec3(0,0,1)); tV = vec3(0,1,0); }
else { uv = vec2(Lp.x, Lp.z); tU = aqLocalToWorld(vec3(1,0,0)); tV = aqLocalToWorld(vec3(0,0,1)); }
float pix = max(length(fwidth(cgP)), 1e-4);   // world size of a pixel

// ---- block pattern by type
float jointD = 10.0; float blockId = sSeed; vec2 edgeDir = vec2(0.0);
float bevelW = 0.06; float jw = 0.022;
if (sType < 0.5 || sType > 5.5) {                // ashlar / rusticated
  float ch = uCourse * (sType > 5.5 ? 1.32 : 1.0);
  vec4 a = aqAshlar(uv, ch, ch * 2.35, floor(sSeed * 7.0));
  jointD = a.x; blockId = a.y; edgeDir = a.zw;
  bevelW = sType > 5.5 ? 0.16 : 0.07;
} else if (sType < 1.5) {                         // dressed moulding: long blocks, vertical joints only
  float L = 1.9 + 0.8 * sSeed;
  float bx = Lp.x / L + sSeed * 3.0 + (aN.x > 0.5 ? Lp.z * 0.37 : 0.0);
  float fx = fract(bx);
  jointD = min(fx, 1.0 - fx) * L; blockId = cgHash12(vec2(floor(bx), sSeed * 91.0));
  edgeDir = vec2(sign(fx - 0.5), 0.0);
  bevelW = 0.04; jw = 0.016;
} else if (sType < 2.5) {                         // voussoir: geometry provides the joints
  blockId = sSeed;
} else if (sType < 3.5) {                         // paving flags
  vec4 a = aqAshlar(vec2(Lp.x, Lp.z + 40.0), 0.95, 1.25, 3.0);
  jointD = a.x; blockId = a.y; edgeDir = a.zw; bevelW = 0.05; jw = 0.02;
} else if (sType < 4.5) {                         // opus signinum lining: no joints
  blockId = 0.5;
} else {                                          // rough foundation blocks
  vec4 a = aqAshlar(uv, 0.82, 1.35, 17.0 + floor(sSeed * 5.0));
  jointD = a.x + 0.02 * cgVnoise2(uv * 9.0); blockId = a.y; edgeDir = a.zw; bevelW = 0.2; jw = 0.035;
}

// anti-aliased joint mask (fades out when joints become sub-pixel)
float jwE = max(jw, pix * 0.9);
float joint = (1.0 - smoothstep(jwE * 0.5, jwE * 1.3, jointD)) * clamp(jw / jwE, 0.0, 1.0) * 1.15;
joint = clamp(joint, 0.0, 1.0);
float bevel = 1.0 - smoothstep(0.0, bevelW, jointD);

// ---- base colour: warm pale limestone with per-block variation
vec3 base = vec3(0.595, 0.54, 0.455) * uTint;
float bv = blockId;
base *= 0.86 + 0.2 * bv;
// whole pieces (piers, spandrels) quarried from slightly different beds: warmer or greyer
float pv = fract(sSeed * 3.71);
base *= mix(vec3(1.0), vec3(1.045, 1.0, 0.92), smoothstep(0.62, 0.8, pv));
base *= mix(vec3(1.0), vec3(0.95, 0.965, 0.99), smoothstep(0.82, 0.95, pv));
base = mix(base, base * vec3(1.05, 0.97, 0.86), smoothstep(0.72, 0.9, fract(bv * 7.31)) * 0.75);   // ochre blocks
base = mix(base, vec3(cgLuma(base)) * vec3(0.95, 0.985, 1.03), smoothstep(0.78, 0.95, fract(bv * 13.7)) * 0.7); // grey blocks
if (sType > 3.5 && sType < 4.5) base = vec3(0.56, 0.43, 0.35) * (0.9 + 0.15 * cgVnoise3(cgP * 1.7));       // pinkish lining
if (sType > 4.5 && sType < 5.5) base *= vec3(0.86, 0.85, 0.80);
float mott = cgVfbm3(cgP * vec3(0.11, 0.17, 0.11), 3);
base *= 0.86 + 0.26 * mott;
float grain = cgVnoise3(cgP * 11.0) * 0.6 + cgVnoise3(cgP * 37.0) * 0.4;
base *= mix(1.0, 0.92 + 0.13 * grain, clamp(0.05 / pix, 0.0, 1.0));
// bevelled edges are slightly lighter (fresh, chipped) but crevices darker
base *= 1.0 + 0.05 * bevel - 0.0;

// ---- weathering
float hor = (aN.z >= aN.x) ? Lp.x : Lp.z;
// drip streaks below ledges
float dl = 100.0;
for (int i = 0; i < 4; i++) { float d = uLedges[i] - Lp.y; if (d > -0.05) dl = min(dl, max(d, 0.0)); }
float stN = cgVnoise2(vec2(hor * 1.35 + sSeed * 11.0, Lp.y * 0.055)) * 0.65 + cgVnoise2(vec2(hor * 4.1, Lp.y * 0.11)) * 0.35;
float streak = smoothstep(0.5, 0.85, stN) * (0.35 + 0.65 * exp(-dl / 7.0));
streak *= step(aN.y, 0.6) * (0.55 + 0.6 * sWear);
vec3 col = mix(base, base * vec3(0.56, 0.545, 0.52), clamp(streak, 0.0, 1.0) * 0.7);

// wet streaks below spouts / leaks (darker, green-tinged)
float wet = 0.0;
for (int i = 0; i < 6; i++) {
  vec4 w = uWet[i];
  if (w.w <= 0.0) continue;
  float side = w.z == 0.0 ? 1.0 : step(0.0, Lp.z * w.z);
  float dx = abs(Lp.x - w.x) / w.w;
  float below = w.y - Lp.y;
  float n = cgVnoise2(vec2(Lp.x * 2.0, Lp.y * 0.15));
  wet = max(wet, side * step(0.0, below) * (1.0 - smoothstep(0.55, 1.0, dx + 0.35 * n)) * exp(-below / 45.0));
}
col = mix(col, col * vec3(0.42, 0.45, 0.38), wet * 0.85);

// splash zone near the ground and algae band at the water line
float hg = Lp.y - sGround;
float ng = cgVfbm3(cgP * 0.45, 3);
float splash = 1.0 - smoothstep(0.0, 2.5 + 3.0 * ng, hg);
col = mix(col, col * vec3(0.58, 0.58, 0.48), splash * 0.55);
float hw = cgP.y - uWaterY;
float algae = (1.0 - smoothstep(-0.3, 1.6 + 1.6 * ng, hw)) * step(sGround, uWaterY + 0.5);
col = mix(col, vec3(0.055, 0.07, 0.04), algae * 0.85);

// moss: patchy, on top faces, in joints, near water & ground, below wet streaks
float mn = cgVfbm3(cgP * 0.32 + vec3(4.1), 4);
float up = smoothstep(0.35, 0.9, cgN.y);
float mossM = mn + up * 0.32 + splash * 0.3 + algae * 0.2 + wet * 0.35 + joint * 0.12 + sWear * 0.12 - 0.12;
float moss = smoothstep(0.62, 0.8, mossM) * uMoss;
vec3 mossC = mix(vec3(0.075, 0.095, 0.03), vec3(0.16, 0.17, 0.06), cgVnoise3(cgP * 3.3));
col = mix(col, mossC, moss * 0.9);

// lichen: dark speckles and rare orange patches
vec3 vor = cgVoronoi2(uv * 6.5 + sSeed * 13.0);
float spk = (1.0 - smoothstep(0.06, 0.15, vor.x)) * step(0.35, vor.z);
float spkM = smoothstep(0.42, 0.68, cgVfbm3(cgP * 0.42 + vec3(9.7), 3)) * (0.55 + 0.6 * sWear);
col = mix(col, vec3(0.11, 0.105, 0.095), spk * spkM * 0.75 * clamp(0.08 / pix, 0.0, 1.0));
float orl = smoothstep(0.72, 0.86, cgVfbm3(cgP * 0.9 + vec3(2.3), 3)) * smoothstep(0.2, 0.0, abs(cgN.y - 0.5) - 0.3);
col = mix(col, col * vec3(1.12, 0.86, 0.52), orl * 0.45);

// large weathering patches (grey-brown) — the refs' stone is strongly mottled
float wpN = cgVfbm3(cgP * vec3(0.055, 0.085, 0.055) + vec3(sSeed * 2.0), 4);
float patchM = smoothstep(0.44, 0.64, wpN + 0.1 * sWear + 0.08 * splash);
col = mix(col, col * vec3(0.6, 0.585, 0.56), patchM * 0.7);
float wpN2 = cgVfbm3(cgP * 0.23 + vec3(7.7), 3);
col *= 0.9 + 0.18 * smoothstep(0.3, 0.7, wpN2);
// travertine pores: small dark pits in clusters
vec3 por = cgVoronoi2(uv * 8.5 + vec2(31.0, 17.0));
float pore = (1.0 - smoothstep(0.045, 0.1, por.x)) * step(0.5, por.z);
float poreM = smoothstep(0.38, 0.62, cgVfbm3(cgP * 0.21 + vec3(1.7), 3));
float poreVis = clamp(0.05 / pix, 0.0, 1.0);
col *= mix(1.0 - 0.1 * poreM, 1.0 - 0.7 * pore * poreM, poreVis);
// black crust in sheltered, down-facing areas (under cornices, inside arches)
float shelter = smoothstep(0.05, -0.75, cgN.y);
col = mix(col, col * vec3(0.62, 0.61, 0.62), shelter * 0.55);
// sun-bleached top surfaces
col *= 1.0 + 0.07 * smoothstep(0.6, 0.95, cgN.y) * (1.0 - moss);
// mortar joints and dirty chamfered joints
float jDark = 0.5 + 0.35 * cgVnoise2(uv * 0.7 + sSeed * 5.0);   // some joints weathered shut, others open and dirty
col = mix(col, col * vec3(0.52, 0.5, 0.47), joint * jDark);
col = mix(col, col * vec3(0.45, 0.43, 0.41), edgeJ * 0.85);

// gentle ambient darkening inside arch soffits (they face down)
float soffit = smoothstep(-0.3, -0.85, cgN.y);
col *= 1.0 - 0.12 * soffit;

diffuseColor.rgb = col;
gRough = clamp(0.84 + 0.1 * grain - 0.38 * wet - 0.3 * algae + 0.06 * joint - (sType > 2.5 && sType < 3.5 ? 0.12 * (1.0 - joint) : 0.0), 0.3, 1.0);
gAO = (1.0 - 0.55 * max(joint, edgeJ)) * (1.0 - 0.35 * soffit) * (1.0 - 0.35 * shelter);

// ---- bump: bevelled block edges + stone grain + chisel texture
vec3 b = vec3(0.0);
float bvAmt = bevel * (sType > 5.5 || (sType > 4.5 && sType < 5.5) ? 0.55 : 0.32) * clamp(bevelW / max(pix, 0.001) * 0.6, 0.0, 1.0);
b += (tU * edgeDir.x + tV * edgeDir.y) * bvAmt;
float gr1 = cgVnoise3(cgP * 6.0), gr2 = cgVnoise3(cgP * 6.0 + vec3(3.7, 1.3, 8.1));
b += (tU * (gr1 - 0.5) + tV * (gr2 - 0.5)) * 0.18 * clamp(0.12 / pix, 0.0, 1.0);
if (sType > 5.5) {   // rusticated: bulging block faces
  float bulge = cgVnoise3(vec3(uv * 1.9, blockId * 40.0));
  b += (tU * (bulge - 0.5) + tV * (cgVnoise3(vec3(uv * 1.9 + 5.0, blockId * 40.0)) - 0.5)) * 0.35;
}
gBump = b;
`;

/**
 * Weathered limestone for one structure. axis = [cos, sin] world-xz of local +x.
 * opts: { ledges:[y0..y3], waterY, course, moss, tint:[r,g,b], wet:[[x,yTop,zSign,width]...] }
 */
export function stoneMaterial(axis, opts = {}) {
  const ledges = (opts.ledges || []).slice(0, 4);
  while (ledges.length < 4) ledges.push(-1e4);
  const wet = (opts.wet || []).slice(0, 6).map((w) => new THREE.Vector4(...w));
  while (wet.length < 6) wet.push(new THREE.Vector4(0, 0, 0, 0));
  const mat = proceduralMaterial({
    name: 'aqStone',
    params: { color: 0xffffff, roughness: 0.88, metalness: 0.0 },
    uniforms: {
      uAxis: { value: new THREE.Vector2(axis[0], axis[1]) },
      uLedges: { value: new THREE.Vector4(...ledges) },
      uWaterY: { value: opts.waterY ?? 0 },
      uCourse: { value: opts.course ?? 0.62 },
      uMoss: { value: opts.moss ?? 1.0 },
      uTint: { value: new THREE.Vector3(...(opts.tint || [1, 1, 1])) },
      uWet: { value: wet },
    },
    vertexHead: STONE_VERTEX_HEAD,
    vertexPre: STONE_VERTEX_PRE,
    head: STONE_HEAD,
    color: STONE_COLOR,
    roughness: 'roughnessFactor = gRough;',
    normal: 'cgBump = gBump;',
    ao: 'cgAO = gAO;',
  });
  return mat;
}

/** Simpler stone for instanced props (balusters, finial bases): world-space noise only. */
export function propStoneMaterial() {
  return proceduralMaterial({
    name: 'aqPropStone',
    params: { color: 0xffffff, roughness: 0.82 },
    color: /* glsl */ `
      vec3 base = vec3(0.645, 0.6, 0.525) * (0.88 + 0.2 * cgSeed);
      float m = cgVfbm3(cgP * 0.6, 3);
      base *= 0.85 + 0.25 * m;
      float sp = 1.0 - smoothstep(0.05, 0.13, cgVoronoi2(cgP.xz * 9.0 + cgP.y * 3.0).x);
      base = mix(base, vec3(0.12, 0.11, 0.1), sp * smoothstep(0.5, 0.7, cgVfbm3(cgP * 1.3 + 7.0, 2)) * 0.6);
      float st = smoothstep(0.55, 0.85, cgVnoise2(vec2(cgP.x * 3.0 + cgP.z * 3.0, cgP.y * 0.5)));
      base *= 1.0 - 0.3 * st;
      float moss = smoothstep(0.66, 0.8, cgVfbm3(cgP * 0.5 + 3.0, 3) + 0.25 * smoothstep(0.5, 0.9, cgN.y));
      diffuseColor.rgb = mix(base, vec3(0.09, 0.1, 0.04), moss * 0.7);
    `,
    normal: /* glsl */ `
      cgBump = (vec3(cgVnoise3(cgP * 7.0), cgVnoise3(cgP * 7.0 + 3.0), cgVnoise3(cgP * 7.0 + 6.0)) - 0.5) * 0.25;
    `,
  });
}

/** Gilded bronze (finials, spout masks): warm gold with tarnish in crevices. */
export function goldMaterial() {
  return proceduralMaterial({
    name: 'aqGold',
    params: { color: 0xffffff, roughness: 0.32, metalness: 1.0 },
    color: /* glsl */ `
      vec3 gold = vec3(0.92, 0.66, 0.30);
      float t = cgVfbm3(cgP * 2.5, 3);
      vec3 tarn = vec3(0.32, 0.26, 0.14);
      float tm = smoothstep(0.5, 0.75, t) * 0.55 + smoothstep(-0.2, -0.9, cgN.y) * 0.3;
      diffuseColor.rgb = mix(gold, tarn, tm);
    `,
    roughness: 'roughnessFactor = 0.26 + 0.35 * smoothstep(0.45, 0.8, cgVfbm3(cgP * 2.5, 3));',
  });
}

/** Flowing water in the specus channel: dark teal, glossy, ripples advected along local +x. */
export function channelWaterMaterial(axis, speed = 1.6) {
  const uTime = { value: 0 };
  const mat = proceduralMaterial({
    name: 'aqWater',
    type: 'physical',
    params: { color: 0xffffff, roughness: 0.06, metalness: 0.0, ior: 1.333, clearcoat: 0.0 },
    uniforms: { uTime, uAxisW: { value: new THREE.Vector2(axis[0], axis[1]) }, uSpeed: { value: speed } },
    head: /* glsl */ `uniform float uTime; uniform vec2 uAxisW; uniform float uSpeed;`,
    color: /* glsl */ `
      vec2 q = vec2(dot(cgP.xz, uAxisW), dot(cgP.xz, vec2(-uAxisW.y, uAxisW.x)));
      float f = cgVnoise2(vec2(q.x * 0.9 - uTime * uSpeed * 0.9, q.y * 2.6));
      vec3 deep = vec3(0.018, 0.075, 0.072), shallow = vec3(0.06, 0.2, 0.17);
      float foam = smoothstep(0.72, 0.9, cgVnoise2(vec2(q.x * 1.7 - uTime * uSpeed * 1.1, q.y * 5.0)));
      diffuseColor.rgb = mix(mix(deep, shallow, f * 0.5), vec3(0.75, 0.8, 0.78), foam * 0.25);
    `,
    normal: /* glsl */ `
      vec2 q = vec2(dot(cgP.xz, uAxisW), dot(cgP.xz, vec2(-uAxisW.y, uAxisW.x)));
      float t = uTime * uSpeed;
      float e = 0.07;
      float h0 = cgVnoise2(vec2(q.x * 1.3 - t * 1.3, q.y * 3.2)) + 0.5 * cgVnoise2(vec2(q.x * 3.7 - t * 1.9, q.y * 6.1));
      float hx = cgVnoise2(vec2((q.x + e) * 1.3 - t * 1.3, q.y * 3.2)) + 0.5 * cgVnoise2(vec2((q.x + e) * 3.7 - t * 1.9, q.y * 6.1));
      float hy = cgVnoise2(vec2(q.x * 1.3 - t * 1.3, (q.y + e) * 3.2)) + 0.5 * cgVnoise2(vec2(q.x * 3.7 - t * 1.9, (q.y + e) * 6.1));
      vec2 g = vec2(hx - h0, hy - h0) / e * 0.06;
      vec3 ax = vec3(uAxisW.x, 0.0, uAxisW.y), az = vec3(-uAxisW.y, 0.0, uAxisW.x);
      cgBump = -(ax * g.x + az * g.y);
    `,
  });
  mat.userData.uTime = uTime;
  return mat;
}
