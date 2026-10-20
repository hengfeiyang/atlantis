// Fountain jets, basin water and spring steam (golden era, ref 3). OWNER: water.
//
// Basins come from engine.registry.fountains when the architecture publishes them
//   [{ id, pos:[x, waterY, z] (centre of the water surface), radius, kind: 'hot'|'cold'|'basin'|'nereid',
//      jets?: [{ pos:[x,y,z], dir:[dx,dy,dz], speed, width }] }]
// otherwise from layout (L.FOUNTAINS: hot + cold springs, water a little above the plaza).
// Each basin: a rippled water disc, a tall central jet with a crown of arcing jets (or the published
// jets), splash rings on the water, spray puffs; the hot spring steams.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { proceduralMaterial } from '../core/materials.js';
import { ATMO_GLSL, atmoUniforms } from '../core/atmosphere.js';
import { NOISE_GLSL } from '../core/glsl.js';
import { MistSystem } from './mist.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const G = 9.81;

export function defaultBasins() {
  return L.FOUNTAINS.map((f) => ({ id: f.id, pos: [f.pos[0], f.pos[1] + 0.9, f.pos[2]], radius: f.radius * 0.86, kind: f.id }));
}

/** jets of a basin without published jets: central column + crown */
function planJets(b, rng) {
  const [cx, cy, cz] = b.pos, R = b.radius;
  const jets = [];
  // central column (tiered: one tall + two shorter around it)
  jets.push({ pos: [cx, cy + 1.6, cz], dir: [0, 1, 0], speed: 9.5, width: 0.22, kind: 'column' });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    jets.push({ pos: [cx + Math.cos(a) * 0.5, cy + 1.3, cz + Math.sin(a) * 0.5], dir: [Math.cos(a) * 0.12, 1, Math.sin(a) * 0.12], speed: 6.5, width: 0.15, kind: 'column' });
  }
  // crown of arcing jets from the rim toward the centre
  const n = Math.max(6, Math.round(R * 1.1));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.05, 0.05);
    const r0 = R * 0.92;
    const p = [cx + Math.cos(a) * r0, cy + 0.35, cz + Math.sin(a) * r0];
    const inw = [-Math.cos(a), 0, -Math.sin(a)];
    // land at ~0.35 R from the centre
    const dist = r0 * 0.62, tUp = 0.5;
    const vh = dist / (2 * tUp), vv = G * tUp;
    const sp = Math.hypot(vh, vv);
    jets.push({ pos: p, dir: [inw[0] * vh / sp, vv / sp, inw[2] * vh / sp], speed: sp, width: 0.09, kind: 'arc' });
  }
  return jets;
}

/** ballistic polyline of a jet until it falls back to y0 */
function jetPath(j, y0) {
  const pts = [];
  const [dx, dy, dz] = j.dir, l = Math.hypot(dx, dy, dz);
  const vx = (dx / l) * j.speed, vy = (dy / l) * j.speed, vz = (dz / l) * j.speed;
  const tEnd = (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0.01, j.pos[1] - y0))) / G;
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * tEnd;
    pts.push({ p: [j.pos[0] + vx * t, j.pos[1] + vy * t - 0.5 * G * t * t, j.pos[2] + vz * t], t, s: i / N });
  }
  return { pts, tEnd, land: pts[N].p };
}

// two crossed ribbons along the path (reads round from every side)
function jetGeometry(path, j, seed) {
  const pos = [], uv = [], aux = [], idx = [];
  const P = path.pts;
  for (let w = 0; w < 2; w++) {
    const base = pos.length / 3;
    for (let i = 0; i < P.length; i++) {
      const p = P[i].p, pn = P[Math.min(P.length - 1, i + 1)].p, pp = P[Math.max(0, i - 1)].p;
      let tx = pn[0] - pp[0], ty = pn[1] - pp[1], tz = pn[2] - pp[2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // side vector: horizontal perpendicular (w=0) or the binormal (w=1)
      let sx, sy, sz;
      if (w === 0) { sx = -tz; sy = 0; sz = tx; const sl = Math.hypot(sx, sz); if (sl < 1e-3) { sx = 1; sz = 0; } else { sx /= sl; sz /= sl; } }
      else { const hx = -tz, hz = tx, hl = Math.hypot(hx, hz) || 1; const ax = hx / hl, az = hz / hl; sx = ty * az; sy = tz * ax - tx * az; sz = -ty * ax; const sl = Math.hypot(sx, sy, sz); if (sl < 1e-3) { sx = 0; sy = 0; sz = 1; } else { sx /= sl; sy /= sl; sz /= sl; } }
      const s = P[i].s;
      const hw = j.width * (0.6 + 1.8 * s * s) * 0.5;
      for (const sg of [-1, 1]) {
        pos.push(p[0] + sx * hw * sg, p[1] + sy * hw * sg, p[2] + sz * hw * sg);
        uv.push(sg * 0.5 + 0.5, s);
        aux.push(P[i].t, seed, path.tEnd, j.kind === 'column' ? 1 : 0);
      }
    }
    for (let i = 0; i < P.length - 1; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aJet', new THREE.Float32BufferAttribute(aux, 4));
  g.setIndex(idx);
  return g;
}

const JET_VERT = /* glsl */`
attribute vec4 aJet;
varying vec2 vUv; varying vec4 vJet; varying vec3 vW;
void main(){ vUv = uv; vJet = aJet; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
const JET_FRAG = /* glsl */`
${ATMO_GLSL}
${NOISE_GLSL}
uniform float uTime; uniform vec3 uSunCol; uniform vec3 uSkyAmb;
varying vec2 vUv; varying vec4 vJet; varying vec3 vW;
void main(){
  float s = vUv.y, x = vUv.x * 2.0 - 1.0;
  float t = vJet.x, seed = vJet.y, col = vJet.w;
  // pattern travelling with the water: (launch time) = time - t
  float ph = uTime - t;
  float core = exp(-x * x * mix(2.0, 5.0, s));
  float streak = cgVnoise2(vec2(x * 3.0 + seed * 17.0, ph * 9.0)) * 0.6 + cgVnoise2(vec2(x * 7.0 + seed * 5.0, ph * 23.0)) * 0.4;
  // glassy near the nozzle, breaking into droplets toward the end / the top of the column
  float br = smoothstep(0.25, 1.0, s);
  float drops = smoothstep(0.55 - 0.25 * br, 0.75, cgVnoise2(vec2(x * 9.0 + seed * 3.0, ph * 40.0)));
  float a = core * mix(0.55 + 0.45 * streak, drops, br * 0.85);
  a *= 1.0 - smoothstep(0.92, 1.0, s);
  a *= mix(0.75, 0.9, col);
  if (a < 0.01) discard;
  vec3 c = uSkyAmb * 0.9 + uSunCol * (0.25 + 0.5 * streak) * 0.35;
  vec3 A = atmoApply(vec3(0.0), vW), B = atmoApply(vec3(1.0), vW) - A;
  gl_FragColor = vec4(c * a * B + A * a, a);
}
`;

export function buildFountains(engine, { maps, basins = null } = {}) {
  const t0 = performance.now();
  const list = (basins && basins.length ? basins : defaultBasins()).filter((b) => b && b.pos);
  const group = new THREE.Group();
  group.name = 'fountains';
  if (!list.length) return null;
  const rng = engine.rng('fountains');
  const jetGeos = [];
  const mist = new MistSystem(engine, maps);
  const ripples = [];
  for (const b of list) {
    const y0 = b.pos[1];
    const jets = b.jets?.length ? b.jets : (b.kind === 'nereid' ? [] : planJets(b, rng));
    for (const j of jets) {
      const path = jetPath(j, y0);
      jetGeos.push(jetGeometry(path, j, rng.random()));
      ripples.push([path.land[0], path.land[2], j.kind === 'column' ? 1.0 : 0.5]);
      // splash at the landing point
      const n = j.kind === 'column' ? 6 : 2;
      for (let m = 0; m < n; m++) {
        const [ox, oz] = rng.disk();
        mist.add({ pos: [path.land[0] + ox * 0.4, y0 + 0.1, path.land[2] + oz * 0.4], size: rng.range(0.2, 0.45) * (j.kind === 'column' ? 1.5 : 1), life: rng.range(0.8, 1.6),
          vel: [ox * 0.6, rng.range(0.6, 1.6), oz * 0.6], gravity: 2.5, growth: 1.1, density: rng.range(0.03, 0.06), kind: 2, stretch: 1 });
      }
      if (j.kind === 'column') {
        // fine spray around the top of the column
        const top = path.pts.reduce((m, q) => (q.p[1] > m.p[1] ? q : m), path.pts[0]).p;
        for (let m = 0; m < 4; m++) mist.add({ pos: [top[0] + rng.range(-0.3, 0.3), top[1] - rng.range(0, 1), top[2] + rng.range(-0.3, 0.3)], size: rng.range(0.4, 0.8), life: rng.range(1.5, 3),
          vel: [rng.range(-0.3, 0.3), -rng.range(0.5, 1.5), rng.range(-0.3, 0.3)], growth: 1.2, density: rng.range(0.03, 0.06), kind: 0, stretch: 1.4 });
      }
    }
    if (b.kind === 'hot') {
      // steam: big, slow, soft puffs rising and drifting off the hot spring (ref 3 left basin)
      const R = b.radius;
      for (let m = 0; m < 90; m++) {
        const [ox, oz] = rng.disk();
        mist.add({ pos: [b.pos[0] + ox * R * 0.85, y0 + rng.range(0.05, 0.8), b.pos[2] + oz * R * 0.85], size: rng.range(1.4, 3.2), life: rng.range(6, 12),
          vel: [rng.range(0.15, 0.5), rng.range(0.35, 0.9), rng.range(-0.1, 0.25)], growth: 1.8, density: rng.range(0.018, 0.04), kind: 1, stretch: rng.range(0.9, 1.4) });
      }
    }
  }
  // ---- jets (one mesh)
  const jetU = { ...atmoUniforms(), uTime: { value: 0 }, uSunCol: { value: new THREE.Color(4, 3.5, 2.8) }, uSkyAmb: { value: new THREE.Color(1.2, 1.35, 1.5) } };
  if (jetGeos.length) {
    const jm = new THREE.ShaderMaterial({
      name: 'fountainJets', uniforms: jetU, vertexShader: JET_VERT, fragmentShader: JET_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    jm.userData.sunken = 'none';
    const mesh = new THREE.Mesh(mergeGeometries(jetGeos, false), jm);
    mesh.name = 'fountainJets'; mesh.renderOrder = 6; mesh.frustumCulled = false;
    mesh.userData.noPatch = true; mesh.userData.isWater = true; mesh.userData.castShadow = false; mesh.userData.receiveShadow = false;
    mesh.castShadow = false; mesh.receiveShadow = false;
    group.add(mesh);
  }
  // ---- basin water discs (rippled by the landing jets)
  const MAXR = 64;
  const rv = []; for (let i = 0; i < MAXR; i++) rv.push(new THREE.Vector3(...(ripples[i] || [1e6, 1e6, 0])));
  const basinU = { uTime: { value: 0 }, uRip: { value: rv }, uRipN: { value: Math.min(MAXR, ripples.length) } };
  const bm = proceduralMaterial({
    name: 'fountainWater', type: 'physical',
    params: { color: 0x0b2a2c, roughness: 0.05, metalness: 0, ior: 1.333, clearcoat: 0 },
    uniforms: basinU,
    head: `uniform float uTime; uniform vec3 uRip[${MAXR}]; uniform int uRipN; vec2 fRip(vec2 p){ vec2 s = vec2(0.0); for (int i = 0; i < ${MAXR}; i++) { if (i >= uRipN) break; vec2 d = p - uRip[i].xy; float r = length(d) + 1e-3; s += d / r * sin(r * 9.0 - uTime * 7.0 + float(i)) * exp(-r * 0.9) * uRip[i].z * 0.25; } return s; }`,
    color: `diffuseColor.rgb = vec3(0.012, 0.05, 0.055) * (0.85 + 0.3 * cgVnoise2(cgP.xz * 0.7));`,
    normal: `vec2 s = fRip(cgP.xz) + vec2(cgVnoise2(cgP.xz * 2.0 + uTime * 0.6) - 0.5, cgVnoise2(cgP.xz * 2.0 + 7.0 - uTime * 0.5) - 0.5) * 0.08; cgBump = vec3(-s.x, 0.0, -s.y);`,
  });
  bm.userData.sunken = 'none';
  for (const b of list) {
    const g = new THREE.CircleGeometry(b.radius, 64).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, bm);
    m.position.set(b.pos[0], b.pos[1], b.pos[2]);
    m.name = 'fountainBasinWater-' + b.id;
    m.userData.isWater = true; m.userData.castShadow = false; m.castShadow = false;
    group.add(m);
  }
  const mistMesh = mist.build(engine.rng('fountain-mist'));
  if (mistMesh) { mistMesh.name = 'fountainMist'; mistMesh.userData.isWater = true; group.add(mistMesh); mist.uniforms.uLevel.value = list[0].pos[1]; }
  const update = (t) => { jetU.uTime.value = t; basinU.uTime.value = t; if (mist.uniforms) mist.uniforms.uTime.value = t; };
  return { group, update, jetUniforms: jetU, mistUniforms: mist.uniforms, basins: list, ms: Math.round(performance.now() - t0) };
}
