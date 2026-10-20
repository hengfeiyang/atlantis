// Spray & mist: instanced soft billboards (one draw call for every waterfall).
//
// Four particle kinds (iL.y), all on a looping life cycle driven by engine time:
//   0 veil spray   — elongated wisps in front of the lower fall, sinking with the water
//   1 rising mist  — wispy, eroded cloud rising and drifting off the plunge pool (low opacity)
//   2 churn spray  — small dense puffs boiling up around the impact (short life)
//   3 droplet streaks — thin motion-blurred droplet jets thrown up and out of the plunge (ballistic)
// Density comes from a world-space value-noise field (sampled at the fragment's world position,
// scaled by the puff size) so overlapping puffs merge into one churning volume instead of reading
// as stamped sprites; the field erodes with age (wisps tear apart and dissolve as they rise).
// Lighting: sky ambient + sun × normalised Henyey-Greenstein phase (glows toward the sun), a cheap
// self-shadow (sun side of each puff brighter), terrain shadow from a 6-tap march over the captured
// height map. Soft intersections with the (blurred) terrain height, the water plane and the camera.
// Output is premultiplied, with the shared aerial perspective applied correctly.
import * as THREE from 'three';
import { ATMO_GLSL, atmoUniforms } from '../core/atmosphere.js';
import { NOISE_GLSL } from '../core/glsl.js';

const VERT = /* glsl */`
attribute vec3 iPos;      // base centre
attribute vec4 iP;        // size (m), seed, life (s), phase
attribute vec4 iM;        // initial velocity xyz (m/s), growth
attribute vec4 iL;        // density, kind, gravity (m/s^2, down), stretch
uniform float uTime;
uniform sampler2D tHNear; uniform vec4 uHNearB;
uniform vec3 uSunDir;
uniform vec3 uWind;
uniform float uLevel;
uniform sampler2D tHS; uniform vec4 uHSB; uniform float uHSK;   // terrain + architecture height (shadows)
varying vec2 vUv; varying vec3 vW; varying float vA; varying float vSeed; varying float vAge; varying float vShadow;
varying float vKind; varying float vSize; varying vec2 vSun2;
float hAt(vec2 xz){
  vec2 uv = (xz - uHNearB.xy) / (uHNearB.zw - uHNearB.xy);
  float h = textureLod(tHNear, clamp(uv, 0.0, 1.0), 1.0).r;
  if (uHSK > 0.5) {
    vec2 us = (xz - uHSB.xy) / (uHSB.zw - uHSB.xy);
    if (us.x > 0.0 && us.y > 0.0 && us.x < 1.0 && us.y < 1.0) h = max(h, textureLod(tHS, us, 1.0).r);
  }
  return h;
}
void main(){
  float life = max(iP.z, 0.1);
  float age = fract(uTime / life + iP.w);
  float t = age * life;
  float kind = iL.y;
  float g = iL.z;
  // drag: spray (kinds 2/3) keeps its launch speed; mist drifts with the air
  vec3 c = iPos + iM.xyz * t + vec3(0.0, -0.5 * g * t * t, 0.0) + uWind * t * (kind < 1.5 ? 1.0 : 0.25);
  float size = iP.x * (0.55 + iM.w * age);
  // boil quads heave up but their bottom edge must stay under the water (no hard white rectangles)
  if (kind > 3.5) c.y = min(c.y, uLevel + size * iL.w * 0.7);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec2 q = position.xy;
  vec3 wp;
  if (kind > 3.5) {
    // boil: upright quad standing on the water (white water heaving up around the plunge)
    // (world-vertical: in the mirrored reflection camera the view 'up' points down, which turned the dense
    //  water-line edge into a hard white block above the water)
    wp = c + right * q.x * size + vec3(0.0, 1.0, 0.0) * q.y * size * iL.w;
  } else if (kind > 2.5) {
    // droplet streak: thin quad along the screen-projected velocity (motion blur)
    vec3 vel = iM.xyz + vec3(0.0, -g * t, 0.0);
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    vec2 ax = normalize(vv.xy + vec2(1e-4, 0.0));
    vec3 A = right * ax.x + up * ax.y, S = right * -ax.y + up * ax.x;
    float len = iP.x * (0.35 + 0.65 * clamp(length(vel) / 8.0, 0.0, 1.0));
    wp = c + A * q.y * len * iL.w + S * q.x * iP.x * 0.07;
  } else {
    float ang = iP.y * 6.2831 + age * (iP.y - 0.5) * 1.6;
    float ca = cos(ang), sa = sin(ang);
    vec2 rq = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
    // stretch is vertical in world (veil spray hangs along the fall)
    wp = c + right * rq.x * size + up * rq.y * size * iL.w;
  }
  vW = wp; vUv = position.xy * 2.0; vSeed = iP.y; vAge = age; vKind = kind; vSize = size;
  // fade in / out over the life (spray pops in fast, mist fades in slowly and lingers)
  float fin = kind > 1.5 ? smoothstep(0.0, 0.16, age) : smoothstep(0.0, 0.22, age);
  float fout = kind > 1.5 ? 1.0 - smoothstep(0.45, 1.0, age) : 1.0 - smoothstep(0.4, 1.0, age);
  vA = iL.x * fin * fout;
  // terrain shadow toward the sun (march over the height map from the puff centre)
  float sh = 1.0;
  vec3 L = normalize(uSunDir);
  for (int i = 1; i <= 6; i++) {
    float d = float(i * i) * 6.0;
    vec3 p = c + L * d;
    float h = hAt(p.xz);
    sh *= 1.0 - smoothstep(-2.0, 3.0, h - p.y) * 0.6;
  }
  vShadow = sh;
  vec3 sv = (viewMatrix * vec4(L, 0.0)).xyz;
  vSun2 = sv.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */`
${ATMO_GLSL}
${NOISE_GLSL}
uniform float uTime;
uniform sampler2D tHNear; uniform vec4 uHNearB;
uniform float uLevel;
uniform vec3 uSunCol;
uniform vec3 uSkyAmb;
uniform vec4 uMistK;      // x: global opacity, y: sun gain, z: ambient gain, w: erosion
varying vec2 vUv; varying vec3 vW; varying float vA; varying float vSeed; varying float vAge; varying float vShadow;
varying float vKind; varying float vSize; varying vec2 vSun2;
void main(){
  float r2 = dot(vUv, vUv);
  if (vKind < 3.5 && r2 > 1.0) discard;
  float a, lit, n = 0.5;
  if (vKind > 3.5) {
    // boiling white water at the plunge: dense at the water line, a torn cauliflower crown above
    float f = 3.0 / max(vSize, 0.5);
    vec3 np = vW * f * vec3(1.0, 0.6, 1.0) + vec3(vSeed * 17.3, -uTime * 0.9, vSeed * 5.1);
    n = cgVfbm3(np, 4);
    float yy = vUv.y * 0.5 + 0.5;
    // a torn dome standing on the water (half-ellipse from the bottom centre; no square corners)
    // (granular churn: bubbles and torn spray in the crown, not a smooth cotton dome)
    float n2 = cgVnoise3(np * 3.4 + vec3(0.0, -uTime * 1.6, 0.0));
    float dd = length(vec2(vUv.x, yy * 1.1)) + (n - 0.5) * 0.65 + (n2 - 0.5) * 0.3 + vAge * 0.1;
    float dome = 1.0 - smoothstep(0.38, 0.9, dd);
    a = dome * (0.5 + 0.5 * smoothstep(0.3, 0.7, n)) * (0.6 + 0.4 * smoothstep(0.2, 0.65, n2 + 0.25 * (1.0 - yy))) * vA * (1.0 - smoothstep(0.8, 1.0, abs(vUv.x))) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
    lit = clamp(0.62 + 0.8 * (n - 0.5) + 0.25 * (n2 - 0.5) + 0.3 * yy, 0.2, 1.0);
  } else if (vKind > 2.5) {
    // droplet streak: bright thin core, tapered ends, beaded
    float across = vUv.x, along = vUv.y;
    float core = exp(-across * across * 9.0) * (1.0 - along * along);
    float beads = 0.55 + 0.45 * cgVnoise2(vec2(vSeed * 37.0, along * 3.0 + vSeed * 11.0));
    a = core * beads * vA;
    lit = 1.0;
  } else {
    // world-space billows, scaled to the puff (overlapping puffs share one field)
    float f = (vKind > 1.5 ? 2.4 : vKind < 0.5 ? 1.8 : 1.5) / max(vSize, 0.5);
    vec3 np = vW * f * (vKind < 0.5 ? vec3(1.0, 0.35, 1.0) : vec3(1.0)) + vec3(vSeed * 17.3, -uTime * 0.12 - vAge * 0.9, vSeed * 5.1);
    n = cgVfbm3(np, 4);
    float n2 = cgVnoise3(np * 3.1 + vec3(0.0, uTime * 0.3, 0.0));
    float billow = n * 0.75 + n2 * 0.25;
    // ragged silhouette: the radial body is warped by the billows (no round sprite outlines)
    // cauliflower spray / wispy mist: the billow field minus a radial falloff, thresholded; the
    // puff erodes with age (wisps tear apart and dissolve)
    float ero = uMistK.w * 0.15 + vAge * (vKind > 1.5 ? 0.22 : 0.3);
    float dn = billow - r2 * (vKind > 1.5 ? 0.75 : 0.55) - ero - (vKind > 1.5 ? 0.1 : 0.16);
    float body = smoothstep(1.0, 0.78, r2);
    // (spray: a granular cluster of droplets with a torn outline, not a cotton ball)
    float wisp = vKind > 1.5 ? smoothstep(-0.08, 0.36, dn) * (0.6 + 0.4 * smoothstep(0.3, 0.72, n2)) * (1.0 - 0.5 * smoothstep(0.3, 1.0, r2)) : smoothstep(-0.14, 0.42, dn);
    // veil spray: vertical striations (water dust falling in sheets)
    if (vKind < 0.5) wisp *= 0.55 + 0.45 * cgVnoise2(vec2(vW.x * 0.9 + vW.z * 0.9 + vSeed * 9.0, vW.y * 0.08 + uTime * 0.4));
    a = body * wisp * vA;
    // big mist banks (> ~10 m): a soft gaussian body modulated by the billows — from afar the ragged
    // threshold edge of a single puff reads as a hard ellipse
    if (vKind > 0.5 && vKind < 1.5) {
      float soft = smoothstep(7.0, 16.0, vSize);
      a = mix(a, exp(-3.2 * r2) * clamp(0.35 + 1.1 * (billow - 0.35), 0.0, 1.0) * vA, soft);
    }
    // self-shadow: the sun side of the puff is brighter, dense cores darker underneath
    float sl = length(vSun2);
    float side = dot(vUv, vSun2 / max(sl, 1e-3)) * min(sl * 1.4, 1.0);
    lit = clamp(0.62 + 0.38 * side + 0.5 * (billow - 0.55) + 0.18 * vUv.y, 0.12, 1.0);
    // thin rising mist is not smoke: no dark cores, light all through
    if (vKind > 0.5 && vKind < 1.5) lit = 0.72 + 0.28 * lit;
  }
  // soft intersections: (blurred) terrain, water plane, camera
  vec2 uv = (vW.xz - uHNearB.xy) / (uHNearB.zw - uHNearB.xy);
  // (fine mip: a blurred height map next to a cliff is the cliff top and would erase the plunge spray)
  float hT = textureLod(tHNear, clamp(uv, 0.0, 1.0), 0.0).r;
  a *= smoothstep(-1.5, 2.0, vW.y - hT);
  a *= smoothstep(uLevel - 0.3, uLevel + (vKind > 3.5 ? 0.12 : 0.9), vW.y);
  float dc = distance(cameraPosition, vW);
  a *= smoothstep(1.0, 6.0, dc) * smoothstep(0.4, 1.6, dc / max(vSize, 0.5));
  a *= uMistK.x;
  // thin mist in the shade of the cliffs reads as a grey veil (washed-out frame): it thins there and
  // glows where it catches the sun (spray and boiling water stay dense)
  if (vKind < 1.5) a *= mix(0.12, 1.0, vShadow);
  else if (vKind < 2.5) a *= mix(0.55, 1.0, vShadow);
  if (a < 0.002) discard;
  // lighting: ambient sky + sun with a forward-scattering phase (normalised HG, g = 0.6)
  vec3 V = normalize(cameraPosition - vW);
  float mu = dot(-V, uSunDir);
  float g = 0.6;
  float hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * mu, 1e-3), 1.5) / 12.566;
  // (dense spray scatters like a diffuse white body on its sun side; thin mist adds the forward lobe)
  // (art direction, refs 3, 7, 9: spray clouds read bright even where the cliff shades the fall — the
  //  cloud's upper parts catch the sun and multiple scattering carries it through: shadow floor)
  float shM = mix(0.8, 1.0, vShadow);
  vec3 col = uSkyAmb * uMistK.z * (0.95 + 0.35 * lit)
           + uSunCol * uMistK.y * shM * ((0.04 + 0.2 * lit) * mix(0.5, 1.0, vShadow) + min(2.4 * hg, 1.6));
  // premultiplied + aerial perspective
  vec3 A = atmoApply(vec3(0.0), vW);
  vec3 B = atmoApply(vec3(1.0), vW) - A;
  gl_FragColor = vec4(col * a * B + A * a, a);
}
`;

export class MistSystem {
  constructor(engine, maps) {
    this.engine = engine;
    this.maps = maps;
    this.items = [];
  }
  /** shadow height map that also holds the architecture ({ tex, bounds } from captureHeightMap) */
  setShadowMap(m) {
    if (!this.uniforms || !m?.tex) return;
    this.uniforms.tHS.value = m.tex; this.uniforms.uHSB.value.set(...m.bounds); this.uniforms.uHSK.value = 1;
  }
  /** add a puff: { pos [x,y,z], size m, life s, vel [vx,vy,vz] (alias drift), growth, density, kind 0..3,
   *  gravity m/s², stretch, seed?, phase? } */
  add(p) { this.items.push(p); }

  build(rng) {
    const n = this.items.length;
    if (!n) return null;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const iPos = new Float32Array(n * 3), iP = new Float32Array(n * 4), iM = new Float32Array(n * 4), iL = new Float32Array(n * 4);
    // a global far-to-near sort is impossible for all views; draw the thin mist first (it sits
    // behind and around the dense spray), then low dense churn, streaks last
    const order = (it) => (it.kind === 1 ? 0 : it.kind === 0 ? 1 : it.kind === 4 ? 2 : it.kind === 2 ? 3 : 4);
    this.items.sort((a, b) => order(a) - order(b) || a.pos[1] - b.pos[1]);
    this.items.forEach((it, i) => {
      iPos.set(it.pos, i * 3);
      iP.set([it.size, it.seed ?? rng.random(), it.life ?? 10, it.phase ?? rng.random()], i * 4);
      iM.set([...(it.vel || it.drift || [0, 0.4, 0]), it.growth ?? 0.8], i * 4);
      iL.set([it.density ?? 0.1, it.kind ?? 1, it.gravity ?? 0, it.stretch ?? 1], i * 4);
    });
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iP', new THREE.InstancedBufferAttribute(iP, 4));
    geo.setAttribute('iM', new THREE.InstancedBufferAttribute(iM, 4));
    geo.setAttribute('iL', new THREE.InstancedBufferAttribute(iL, 4));
    geo.instanceCount = n;
    const near = this.maps.near;
    this.uniforms = {
      ...atmoUniforms(),
      uTime: { value: 0 },
      tHNear: { value: near.tex }, uHNearB: { value: new THREE.Vector4(...near.bounds) },
      uLevel: { value: 0 },
      uWind: { value: new THREE.Vector3(0.35, 0.0, 0.25) },
      uSunCol: { value: new THREE.Color(4.2, 3.6, 2.8) },
      uSkyAmb: { value: new THREE.Color(0.9, 1.0, 1.15) },
      // (z: sky ambient gain — uSkyAmb is IBL-scaled, the visible sky is ~2-3x brighter: thick mist in the shade reads as bright as the sky)
      uMistK: { value: new THREE.Vector4(1.0, 1.7, 2.4, 0.0) },
      tHS: { value: near.tex }, uHSB: { value: new THREE.Vector4(...near.bounds) }, uHSK: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'waterMist',
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'waterfallMist';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.userData.castShadow = false; mesh.userData.receiveShadow = false;
    mesh.userData.noPatch = true;
    this.mesh = mesh;
    this.count = n;
    return mesh;
  }
}

// (hot-swap / look-dev access)
export { VERT as MIST_VERT, FRAG as MIST_FRAG };
