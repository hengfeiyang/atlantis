// Procedural fire: layered flame billboards (turbulent, HDR emissive so bloom glows), rising embers
// and a faint glow halo. One instanced draw call for every flame in the world.
//
//   const fire = new FireSystem(engine);
//   fire.addFire([x,y,z], size, seed);   // size ≈ flame height in metres
//   fire.build();
//
// Billboards face the camera around a tilted axis (world-up projected on the view plane), so flames
// still read from the aerial shot. Deterministic animation from engine time.
import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl.js';
import { ATMO_GLSL, atmoUniforms } from '../core/atmosphere.js';

export const FIRE_TIME = { value: 0 };

const VERT = /* glsl */`
attribute vec4 iPos;    // xyz base position, w = kind (0 flame, 1 tongue, 2 halo, 3 ember)
attribute vec4 iParam;  // x width, y height, z seed, w intensity
uniform float uTime;
uniform vec2 uRes;
varying vec2 vUv;
varying vec4 vParam;
varying float vKind;
varying vec3 vWorld;
varying float vLife;
void main(){
  vec3 base = iPos.xyz;
  float kind = iPos.w;
  float seed = iParam.z;
  vec3 V = normalize(cameraPosition - base);
  vec3 up = vec3(0.0, 1.0, 0.0);
  float vy = clamp(abs(V.y), 0.0, 0.999);
  vec3 axis = normalize(up - V.y * V);           // world-up projected on the view plane
  vec3 right = normalize(cross(axis, V));
  float foreshort = mix(1.0, 0.55, vy * vy);
  vec2 sz = iParam.xy;
  vec3 wp;
  float life = 0.0;
  if (kind > 2.5) {
    // ember: rises, swirls, shrinks and fades
    float rate = 0.55 + 0.5 * fract(seed * 7.13);
    life = fract(uTime * rate + seed * 3.7);
    float h = sz.y * (0.4 + 2.2 * life);
    vec3 drift = vec3(sin(seed * 31.0 + life * 6.0 + uTime * 1.3), 0.0, cos(seed * 17.0 + life * 5.0 - uTime * 1.1)) * 0.18 * sz.y * life;
    vec3 c = base + up * h + drift;
    float dist = length(cameraPosition - c);
    // keep embers ≥ ~1.4 px wide (energy preserved via vLife.w scaling below)
    float pxPerM = uRes.y / (2.0 * dist * 0.45);
    float s = sz.x * (1.0 - life * 0.6);
    float sMin = 1.4 / pxPerM;
    float boost = s < sMin ? (s * s) / (sMin * sMin) : 1.0;
    boost *= 1.0 - smoothstep(45.0, 110.0, dist);   // distant embers would only read as noise
    s = max(s, sMin);
    vParam = vec4(iParam.xy, seed, iParam.w * boost);
    vec3 r2 = normalize(cross(up, V) + vec3(1e-4)), u2 = normalize(cross(V, r2));
    wp = c + (r2 * position.x + u2 * (position.y - 0.5)) * s;
  } else if (kind > 1.5) {
    // halo: camera-facing disc centred above the base
    vec3 r2 = normalize(cross(up, V) + vec3(1e-4)), u2 = normalize(cross(V, r2));
    vec3 c = base + up * sz.y * 0.35;
    // far away the flame body is sub-pixel: keep a compact glowing dot ≥ ~7 px (ref 4 aerial)
    float dist = length(cameraPosition - c);
    float pxPerM = uRes.y / (2.0 * dist * 0.45);
    float flamePx = sz.y * pxPerM;
    float far = smoothstep(16.0, 4.0, flamePx);
    float s = max(sz.x, 7.0 / pxPerM);
    wp = c + (r2 * position.x + u2 * (position.y - 0.5)) * s;
    vParam = vec4(iParam.xy, far, iParam.w);
  } else {
    wp = base + right * position.x * sz.x + axis * position.y * sz.y * foreshort;
    vParam = iParam;
  }
  vUv = vec2(position.x, position.y);
  vKind = kind;
  vLife = life;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying vec4 vParam;
varying float vKind;
varying vec3 vWorld;
varying float vLife;
${NOISE_GLSL}
${ATMO_GLSL}
vec3 fireRamp(float k){
  // black-body-ish ramp, linear HDR
  vec3 c = mix(vec3(0.6, 0.07, 0.005), vec3(1.0, 0.25, 0.02), smoothstep(0.0, 0.35, k));
  c = mix(c, vec3(1.0, 0.42, 0.05), smoothstep(0.3, 0.7, k));
  c = mix(c, vec3(1.0, 0.74, 0.36), smoothstep(0.66, 0.95, k));
  c = mix(c, vec3(1.0, 0.9, 0.7), smoothstep(0.95, 1.0, k));
  return c;
}
void main(){
  float seed = vParam.z;
  float inten = vParam.w;
  vec3 col; float a;
  if (vKind > 2.5) {
    vec2 d = vUv - vec2(0.0, 0.5);
    float r = length(d) * 2.0;
    float m = smoothstep(1.0, 0.0, r);
    float fl = 0.6 + 0.4 * sin(uTime * 23.0 + seed * 40.0);
    float fade = pow(1.0 - vLife, 1.6) * smoothstep(0.0, 0.08, vLife);
    col = vec3(1.0, 0.45, 0.08) * 14.0 * m * fade * fl * inten;
    a = 0.0;
  } else if (vKind > 1.5) {
    vec2 d = vUv - vec2(0.0, 0.5);
    float r = length(d) * 2.0;
    float flick = 0.85 + 0.15 * sin(uTime * 9.0 + seed * 12.0) * sin(uTime * 5.3 + seed);
    float g = exp(-r * r * 4.0) * (1.0 - smoothstep(0.8, 1.0, r));
    float far = vParam.z;   // (seed slot reused for the far factor)
    float pt = exp(-r * r * 22.0);
    col = (vec3(1.0, 0.42, 0.1) * g * 0.22 + vec3(1.0, 0.55, 0.18) * pt * 3.5 * far) * inten * flick;
    a = 0.0;
  } else {
    float t = uTime * (1.0 + 0.25 * fract(seed * 3.3)) + seed * 17.0;
    float y = vUv.y;
    float x = vUv.x;
    bool tongue = vKind > 0.5;
    // large slow turbulence bends the whole flame, fine fast turbulence tears the edges
    float n1 = cgVfbm2(vec2(x * 2.6, y * 1.8 - t * 2.0) + vec2(seed * 7.1, 0.0), 3);
    float xx = x - (n1 - 0.5) * (tongue ? 0.55 : 0.42) * y - 0.03 * sin(y * 6.0 - t * 3.0) * y;
    float n2 = cgVfbm2(vec2(xx * 7.0, y * 4.2 - t * 3.6) + vec2(3.7, seed * 5.3), 4);
    float n3 = cgVnoise2(vec2(xx * 16.0, y * 9.0 - t * 6.0) + seed * 2.0);
    // teardrop silhouette
    float w = (tongue ? 0.2 : 0.4) * pow(max(1.0 - y, 0.0), tongue ? 1.15 : 0.9) * smoothstep(0.0, 0.1, y);
    float inside = 1.0 - abs(xx) / max(w, 1e-3);          // 1 on the axis, 0 at the edge
    // ridged noise carves separate licking tongues, more strongly toward the tip
    float rid = 1.0 - abs(n2 * 2.0 - 1.0);
    float m = inside - (1.0 - rid) * (0.12 + 0.8 * y) - (n3 - 0.5) * 0.22 * y - y * y * 0.3;
    float I = smoothstep(-0.02, 0.2, m);                   // soft edge
    I *= smoothstep(0.0, 0.05, y);
    float depth = smoothstep(0.05, 0.75, m);                // how deep inside the flame body
    // temperature: hottest low in the core, cooling toward edges and tips
    float temp = clamp(0.2 + 0.72 * depth * (1.0 - 0.75 * y) + 0.1 * (n3 - 0.5), 0.0, 1.0) * I;
    vec3 c = fireRamp(temp);
    float hdr = mix(1.0, 4.2, pow(temp, 2.2));
    col = c * hdr * I * inten;
    a = clamp(I * (0.72 + 0.25 * depth), 0.0, 1.0);
  }
  // atmosphere: attenuate by transmittance only (emissive), keep the in-scatter out
  vec3 T = atmoApply(vec3(1.0), vWorld) - atmoApply(vec3(0.0), vWorld);
  gl_FragColor = vec4(col * T, a);
}`;

export class FireSystem {
  constructor(engine) {
    this.engine = engine;
    this.inst = [];       // [x,y,z,kind, w,h,seed,intensity]
  }

  /**
   * Add a fire whose base (where the flames start, e.g. coal surface) is at pos.
   * @param {number[]} pos
   * @param {number} size  flame height (m)
   * @param {number} seed  0..1
   * @param {object} o { embers: count, halo: bool, intensity }
   */
  addFire(pos, size = 0.8, seed = 0.5, o = {}) {
    const [x, y, z] = pos;
    const I = o.intensity ?? 1;
    const rnd = (() => { let s = Math.floor(seed * 1e6) + 7; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); })();
    const spread = size * (o.spread ?? 0.22);
    // main body
    this.inst.push([x, y - size * 0.04, z, 0, size * 0.78, size * 1.0, rnd(), I]);
    // secondary flames around it (gives depth from every direction)
    const n = o.layers ?? 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 1.2;
      const r = spread * (0.5 + 0.5 * rnd());
      this.inst.push([x + Math.cos(a) * r, y - size * 0.03, z + Math.sin(a) * r, 0, size * (0.45 + 0.2 * rnd()), size * (0.55 + 0.3 * rnd()), rnd(), I * 0.9]);
    }
    // thin tall tongues
    for (let i = 0; i < (o.tongues ?? 1); i++) {
      const a = rnd() * Math.PI * 2, r = spread * 0.4 * rnd();
      this.inst.push([x + Math.cos(a) * r, y, z + Math.sin(a) * r, 1, size * 0.36, size * (0.9 + 0.3 * rnd()), rnd(), I * 0.8]);
    }
    if (o.halo !== false) this.inst.push([x, y, z, 2, size * 1.8, size, rnd(), I]);
    const ne = o.embers ?? 14;
    for (let i = 0; i < ne; i++) {
      const a = rnd() * Math.PI * 2, r = spread * rnd();
      this.inst.push([x + Math.cos(a) * r, y + size * 0.1, z + Math.sin(a) * r, 3, 0.012 + 0.01 * rnd(), size, rnd(), I]);
    }
  }

  build() {
    if (!this.inst.length) return null;
    const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    quad.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    const n = this.inst.length;
    const A = new Float32Array(n * 4), B = new Float32Array(n * 4);
    this.inst.forEach((v, i) => { A.set(v.slice(0, 4), i * 4); B.set(v.slice(4, 8), i * 4); });
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(A, 4));
    g.setAttribute('iParam', new THREE.InstancedBufferAttribute(B, 4));
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: FIRE_TIME, uRes: { value: new THREE.Vector2(this.engine.width, this.engine.height) }, ...atmoUniforms() },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      side: THREE.DoubleSide,
    });
    mat.name = 'fire';
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'fire';
    mesh.frustumCulled = false;
    mesh.renderOrder = 50;
    mesh.userData.noPatch = true;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.userData.castShadow = false; mesh.userData.receiveShadow = false;
    this.engine.scene.add(mesh);
    this.engine.onUpdate((t) => { FIRE_TIME.value = t; });
    this.mesh = mesh;
    return mesh;
  }
}
