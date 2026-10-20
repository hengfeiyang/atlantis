// Churning white water where waterfalls plunge into the lagoon / river.
// One horizontal quad per impact (single instanced draw), drawn right after the water surface:
// boiling foam core, broken expanding foam arcs, and foam streaks carried downstream.
// Lighting matches the mist (sun × terrain shadow march + sky ambient), output premultiplied with
// the shared aerial perspective.
import * as THREE from 'three';
import { ATMO_GLSL, atmoUniforms } from '../core/atmosphere.js';
import { NOISE_GLSL } from '../core/glsl.js';

const VERT = /* glsl */`
attribute vec4 iImp;   // x, z, radius, strength
attribute vec4 iDir;   // dir x, z, speed, seed
uniform float uLevel;
uniform sampler2D tHNear; uniform vec4 uHNearB;
uniform vec3 uSunDir;
varying vec2 vLoc; varying vec3 vW; varying vec4 vImp; varying vec4 vDir; varying float vShadow;
float hAt(vec2 xz){ vec2 uv = (xz - uHNearB.xy) / (uHNearB.zw - uHNearB.xy); return textureLod(tHNear, clamp(uv, 0.0, 1.0), 1.0).r; }
void main(){
  float R = iImp.z;
  vec2 d = normalize(iDir.xy + vec2(1e-4));
  vec2 side = vec2(-d.y, d.x);
  // quad covers the core, the rings and the downstream trail
  vec2 q = position.xy;                       // [-0.5, 0.5]
  vec2 loc = vec2(q.x * R * 5.2, q.y * R * 5.8 + R * 0.5);   // x across, y along (downstream): compact
  vec2 xz = iImp.xy + side * loc.x + d * loc.y;
  vW = vec3(xz.x, uLevel + 0.06, xz.y);
  vLoc = loc; vImp = iImp; vDir = iDir;
  float sh = 1.0; vec3 c = vec3(iImp.x, uLevel + 2.0, iImp.y);
  for (int i = 1; i <= 6; i++) { float dd = float(i * i) * 6.0; vec3 p = c + normalize(uSunDir) * dd; sh *= 1.0 - smoothstep(-2.0, 3.0, hAt(p.xz) - p.y) * 0.85; }
  vShadow = sh;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}
`;

const FRAG = /* glsl */`
${ATMO_GLSL}
${NOISE_GLSL}
uniform float uTime;
uniform float uLevel;
uniform sampler2D tHNear; uniform vec4 uHNearB;
uniform vec3 uSunCol; uniform vec3 uSkyAmb;
varying vec2 vLoc; varying vec3 vW; varying vec4 vImp; varying vec4 vDir; varying float vShadow;
void main(){
  float R = vImp.z, S = vImp.w, seed = vDir.w;
  vec2 L = vLoc;                              // metres: x across, y downstream
  float r = length(L);
  float t = uTime;
  // boiling core: a ragged dome of white water, cells of foam rolling outward
  float n = cgVfbm2(L * 0.35 + vec2(seed * 11.0, -t * 0.5), 3);
  // outward drift as two blended phases of a looping offset (an offset growing with t forever shears the
  // pattern by angle × t: radial noise in the video, whose clock runs to ~260 s)
  const float TP = 4.0;
  float p0 = fract(t / TP), p1 = fract(t / TP + 0.5);
  float w0 = 1.0 - abs(2.0 * p0 - 1.0);
  vec2 nd = normalize(L + 1e-3);
  vec3 v1a = cgVoronoi2(L * 0.6 + vec2(seed * 7.0, 0.0) - nd * (p0 * TP * 0.9));
  vec3 v1b = cgVoronoi2(L * 0.6 + vec2(seed * 7.0 + 31.7, 13.3) - nd * (p1 * TP * 0.9));
  vec3 v2 = cgVoronoi2(L * 1.5 + vec2(-t * 1.4, seed * 3.0));
  float c1 = (1.0 - smoothstep(0.0, 0.32, v1a.y - v1a.x)) * w0 + (1.0 - smoothstep(0.0, 0.32, v1b.y - v1b.x)) * (1.0 - w0);
  float cells = c1 * 0.55 + (1.0 - smoothstep(0.0, 0.25, v2.y - v2.x)) * 0.45;
  float rr = r + (n - 0.5) * R * 0.7;
  float core = 1.0 - smoothstep(R * 0.3, R * 1.0, rr);
  // broken foam arcs and blobs pushed outward (they thin out and tear as they spread)
  float wave = sin(r * 6.2831 / max(2.0, R * 0.42) - t * 3.1 + n * 4.0);
  float arcs = smoothstep(0.5, 0.95, wave) * smoothstep(0.4, 0.68, cgVnoise3(vec3(nd * 1.5 + seed * 5.0, r * 0.15 - t * 0.4)));
  float ringZone = smoothstep(R * 0.5, R * 1.0, rr) * (1.0 - smoothstep(R * 1.3, R * 2.4, rr));
  float bl = cgVfbm2(L * 0.28 - nd * (p0 * TP * 0.6) + seed * 13.0, 2) * w0 + cgVfbm2(L * 0.28 - nd * (p1 * TP * 0.6) + seed * 13.0 + 7.9, 2) * (1.0 - w0);
  float blobs = smoothstep(0.55, 0.85, bl + cells * 0.25);
  float spreadZ = (1.0 - smoothstep(R * 0.8, R * 2.6, rr));
  float foam = max(core * (0.6 + 0.55 * cells), max(ringZone * arcs * 0.35 * blobs, spreadZ * blobs * 0.55)) * clamp(S, 0.0, 1.2);
  foam *= 0.8 + 0.2 * cgVnoise2(L * 4.0 + t);
  float boil = cells;
  foam *= 1.0 - smoothstep(R * 2.0, R * 2.45, max(abs(L.x), -L.y));
  // no foam on land
  vec2 uv = (vW.xz - uHNearB.xy) / (uHNearB.zw - uHNearB.xy);
  float depth = uLevel - texture(tHNear, clamp(uv, 0.0, 1.0), 0.0).r;
  foam *= smoothstep(0.05, 0.6, depth);
  float a = clamp(foam, 0.0, 0.95);
  if (a < 0.004) discard;
  vec3 col = (uSkyAmb * 0.85 + uSunCol * vShadow * max(uSunDir.y, 0.05) * 1.1) * 0.82 / 3.14159;
  col *= 0.9 + 0.2 * boil;
  vec3 A = atmoApply(vec3(0.0), vW);
  vec3 B = atmoApply(vec3(1.0), vW) - A;
  gl_FragColor = vec4(col * a * B + A * a, a);
}
`;

export function createChurn(engine, maps, impacts, level = 0) {
  const list = impacts.filter(Boolean);
  if (!list.length) return null;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const a = new Float32Array(list.length * 4), b = new Float32Array(list.length * 4);
  list.forEach((im, i) => {
    a.set([im.x, im.z, Math.max(3, im.radius), im.strength], i * 4);
    const d = im.dir || [0, 1];
    b.set([d[0], d[1], im.speed || 0, (i * 0.6180339) % 1], i * 4);
  });
  geo.setAttribute('iImp', new THREE.InstancedBufferAttribute(a, 4));
  geo.setAttribute('iDir', new THREE.InstancedBufferAttribute(b, 4));
  geo.instanceCount = list.length;
  const near = maps.near;
  const uniforms = {
    ...atmoUniforms(),
    uTime: { value: 0 }, uLevel: { value: level },
    tHNear: { value: near.tex }, uHNearB: { value: new THREE.Vector4(...near.bounds) },
    uSunCol: { value: new THREE.Color(4.2, 3.6, 2.8) }, uSkyAmb: { value: new THREE.Color(1, 1.1, 1.3) },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'waterfallChurn', uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'waterfallChurn';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.userData.castShadow = false; mesh.userData.receiveShadow = false;
  mesh.userData.noPatch = true;
  return { mesh, uniforms };
}

// (hot-swap / look-dev access)
export { VERT as CHURN_VERT, FRAG as CHURN_FRAG };
