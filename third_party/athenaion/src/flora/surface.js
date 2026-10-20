// Top-down "what is the walkable top surface here" map. Renders the world Y of every opaque lit mesh
// (terrain, paving, ruin blocks, walls, stairs…) from above with an orthographic camera into a float
// target and reads it back, so ground cover can sit exactly on surfaces built by other modules and
// grow in the cracks along block bases. Vegetation and our own meshes are excluded.
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';

const LAYER = 29;

const VERT = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
varying float vY;
void main() {
  #include <batching_vertex>
  vec4 p = vec4(position, 1.0);
  #ifdef USE_BATCHING
    p = batchingMatrix * p;
  #endif
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  vec4 wp = modelMatrix * p;
  vY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG = /* glsl */ `
varying float vY;
uniform float uId;
void main() { gl_FragColor = vec4(vY, 1.0, uId, 1.0); }`;

/**
 * @param engine
 * @param {number} cx, cz  centre; size (m) square extent; res texels per side
 * @param {object} [o] { exclude: Object3D[] }
 * @returns {{ h:(x,z)=>number, has:(x,z)=>boolean, grad:(x,z)=>number, edge:(x,z,r)=>number, size, res }}
 */
export function surfaceMap(engine, cx, cz, size, res, o = {}) {
  const { renderer, scene } = engine;
  const excluded = new Set();
  for (const e of o.exclude || []) if (e) e.traverse((c) => excluded.add(c));
  const tagged = [];
  scene.traverse((obj) => {
    if (!(obj.isMesh || obj.isInstancedMesh || obj.isBatchedMesh)) return;
    if (excluded.has(obj) || !obj.visible) return;
    const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!m || m.transparent || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;
    if (m.alphaTest > 0 || m.userData?.isFoliage) return;
    // skip things hanging in the air that are clearly not ground (e.g. our hero leaves) by name
    if (/leaf|leaves|foliage|cypress|tree|ivy|grass|water/i.test(obj.name || '')) return;
    obj.layers.enable(LAYER);
    tagged.push(obj);
  });
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, uniforms: { uId: { value: 0 } } });
  // per-object id in the blue channel (which mesh owns the top surface)
  const prevOBR = tagged.map((o) => o.onBeforeRender);
  tagged.forEach((o, i) => { const prev = prevOBR[i]; o.onBeforeRender = function (...args) { if (prev) prev.apply(this, args); if (args[4] === mat) { mat.uniforms.uId.value = i + 1; mat.uniformsNeedUpdate = true; } }; });
  const rt = new THREE.WebGLRenderTarget(res, res, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const half = size / 2;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 4000);
  cam.position.set(cx, 2000, cz);
  cam.up.set(0, 0, -1);
  cam.lookAt(cx, 0, cz);
  cam.layers.set(LAYER);
  cam.updateMatrixWorld(true);
  const prevOverride = scene.overrideMaterial, prevBg = scene.background, prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  scene.overrideMaterial = mat; scene.background = null;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, false);
  renderer.render(scene, cam);
  const buf = new Float32Array(res * res * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, res, res, buf);
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  scene.overrideMaterial = prevOverride; scene.background = prevBg;
  tagged.forEach((t, i) => { t.layers.disable(LAYER); t.onBeforeRender = prevOBR[i]; });
  rt.dispose(); mat.dispose();

  const H = new Float32Array(res * res);
  const valid = new Uint8Array(res * res);
  const IDS = new Uint32Array(res * res);
  for (let i = 0; i < res * res; i++) {
    const y = buf[i * 4], g = buf[i * 4 + 1];
    if (g > 0.5 && y > -9000) { H[i] = y; valid[i] = 1; IDS[i] = Math.round(buf[i * 4 + 2]); } else H[i] = NaN;
  }
  const texel = size / res;
  // texel (i, j): i along +x, j: render target row 0 = bottom of image = +z (camera up is -z)
  const idx = (x, z) => {
    const i = Math.floor((x - (cx - half)) / texel), j = Math.floor((z - (cz - half)) / texel);
    if (i < 0 || j < 0 || i >= res || j >= res) return -1;
    return (res - 1 - j) * res + i;
  };
  const h = (x, z) => { const k = idx(x, z); return k >= 0 && valid[k] ? H[k] : heightAt(x, z); };
  const has = (x, z) => { const k = idx(x, z); return k >= 0 && valid[k] === 1; };
  /** max |Δh| to the 4 neighbours at distance r (step / crack detector) */
  const edge = (x, z, r = texel) => {
    const c = h(x, z);
    return Math.max(Math.abs(h(x + r, z) - c), Math.abs(h(x - r, z) - c), Math.abs(h(x, z + r) - c), Math.abs(h(x, z - r) - c));
  };
  const normal = (x, z, r = texel) => {
    const nx = h(x - r, z) - h(x + r, z), nz = h(x, z - r) - h(x, z + r), ny = 2 * r;
    const l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  };
  /** the mesh whose top surface covers (x, z), or null (terrain fallback / outside) */
  const obj = (x, z) => { const k = idx(x, z); return k >= 0 && IDS[k] ? tagged[IDS[k] - 1] : null; };
  return { h, has, edge, normal, obj, size, res, texel, cx, cz };
}

const VERT_W = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
varying vec3 vW;
void main() {
  #include <batching_vertex>
  vec4 p = vec4(position, 1.0);
  #ifdef USE_BATCHING
    p = batchingMatrix * p;
  #endif
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  vec4 wp = modelMatrix * p;
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG_W = /* glsl */ `
varying vec3 vW;
uniform float uId;
void main() { gl_FragColor = vec4(vW, uId); }`;

/**
 * What a shot camera sees: world position + owning mesh of every pixel of a small (w x h) render of the
 * opaque lit scene from the shot's camera (same aspect as the final frame). Used to dress surfaces
 * exactly where a hero camera looks at them (cliff faces, columns, wall faces).
 * @returns {{ w, h, at:(i,j)=>Vector3|null, obj:(i,j)=>Object3D|null, normal:(i,j)=>Vector3|null, cam }}
 */
export function viewSurface(engine, shot, w, h, o = {}) {
  const { renderer, scene } = engine;
  const excluded = new Set();
  for (const e of o.exclude || []) if (e) e.traverse((c) => excluded.add(c));
  const tagged = [];
  scene.traverse((obj) => {
    if (!(obj.isMesh || obj.isInstancedMesh || obj.isBatchedMesh)) return;
    if (excluded.has(obj) || !obj.visible) return;
    const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!m || m.transparent || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;
    if (m.alphaTest > 0 || m.userData?.isFoliage) return;
    if (/leaf|leaves|foliage|cypress|tree|ivy|grass|water/i.test(obj.name || '')) return;
    obj.layers.enable(LAYER);
    tagged.push(obj);
  });
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT_W, fragmentShader: FRAG_W, side: THREE.DoubleSide, uniforms: { uId: { value: 0 } } });
  const prevOBR = tagged.map((t) => t.onBeforeRender);
  tagged.forEach((t, i) => { const prev = prevOBR[i]; t.onBeforeRender = function (...args) { if (prev) prev.apply(this, args); if (args[4] === mat) { mat.uniforms.uId.value = i + 1; mat.uniformsNeedUpdate = true; } }; });
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const cam = new THREE.PerspectiveCamera(shot.fov ?? 40, 1672 / 941, shot.near ?? 0.5, 30000);
  cam.position.set(...shot.pos);
  cam.lookAt(new THREE.Vector3(...shot.target));
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  cam.layers.set(LAYER);
  const prevOverride = scene.overrideMaterial, prevBg = scene.background, prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  scene.overrideMaterial = mat; scene.background = null;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, false);
  renderer.render(scene, cam);
  const buf = new Float32Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  scene.overrideMaterial = prevOverride; scene.background = prevBg;
  tagged.forEach((t, i) => { t.layers.disable(LAYER); t.onBeforeRender = prevOBR[i]; });
  rt.dispose(); mat.dispose();
  // (i, j): i left→right, j top→bottom
  const k = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? -1 : (h - 1 - j) * w + i);
  const id = (i, j) => { const q = k(i, j); return q < 0 ? 0 : Math.round(buf[q * 4 + 3]); };
  const at = (i, j) => { const q = k(i, j); return q < 0 || !id(i, j) ? null : new THREE.Vector3(buf[q * 4], buf[q * 4 + 1], buf[q * 4 + 2]); };
  const obj = (i, j) => { const v = id(i, j); return v ? tagged[v - 1] : null; };
  /** surface normal from the neighbouring pixels (same object, no depth jump), facing the camera */
  const normal = (i, j) => {
    const c = at(i, j); if (!c) return null;
    const me = id(i, j);
    const pick = (a, b) => (id(a, b) === me ? at(a, b) : null);
    const r = pick(i + 1, j) || c, l = pick(i - 1, j) || c, u = pick(i, j - 1) || c, d = pick(i, j + 1) || c;
    const dx = r.clone().sub(l), dy = u.clone().sub(d);
    const dist = c.distanceTo(cam.position);
    if (dx.length() > dist * 0.08 || dy.length() > dist * 0.08 || dx.lengthSq() < 1e-10 || dy.lengthSq() < 1e-10) return null;
    const n = new THREE.Vector3().crossVectors(dx, dy).normalize();
    if (n.dot(cam.position.clone().sub(c)) < 0) n.negate();
    return n;
  };
  return { w, h, at, obj, normal, cam };
}
