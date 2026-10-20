// Top-down surface maps for placement (golden era). adapted from src/marine/scatter.js surfaceMap() (marine agent)
// Renders the already-built world from straight above (orthographic, world-Y + |normal.y| into a float target):
//   groundMap: only the terrain mesh (registry.terrain.root) → the REAL meshed ground, incl. the 3D rock
//              displacement of the steep citadel slopes (heightAt() can be several metres off there)
//   topMap:    everything built so far (architecture, sets, statues, water features) → top - ground > ε means
//              something stands there (palaces, ramparts, stairs, basins) even if it registered no footprint.
import * as THREE from 'three';

const MAP_VS = /* glsl */ `
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
  vec4 w = modelMatrix * p;
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const MAP_FS = /* glsl */ `
varying vec3 vW;
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  gl_FragColor = vec4(vW.y, 0.0, 0.0, abs(n.y) + 2.0);
}`;

/**
 * @param {object} engine
 * @param {object} o { cx, cz, size, res, top, bottom, only (Object3D: render only this subtree) }
 * @returns {{sample(x,z):{y,ny}|null, y(x,z):number|NaN, cell}|null}
 */
export function surfaceMap(engine, { cx, cz, size, res, top = 220, bottom = -20, only = null }) {
  const { renderer, scene } = engine;
  if (!renderer) return null;
  res = Math.round(res);
  let rt;
  try {
    rt = new THREE.WebGLRenderTarget(res, res, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false });
  } catch (e) { console.warn('[vegetation] surfaceMap: no float target', e); return null; }
  const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0.02, top - bottom);
  cam.position.set(cx, top, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, top - 10, cz);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  const mat = new THREE.ShaderMaterial({ vertexShader: MAP_VS, fragmentShader: MAP_FS, side: THREE.DoubleSide });
  const hidden = [];
  const hide = (o) => { hidden.push(o); o.visible = false; };
  if (only) {
    // keep the chain root → `only` and everything under `only`; hide every other branch
    const chain = new Set();
    for (let o = only; o; o = o.parent) chain.add(o);
    scene.traverse((o) => { if (o.visible && !chain.has(o) && o.parent && chain.has(o.parent) && o.parent !== only) hide(o); });
  }
  scene.traverse((o) => {
    if (!o.visible) return;
    let h = o === engine.sky || o.isPoints || o.isLine || o.isSprite;
    if (!h && (o.isMesh || o.isInstancedMesh || o.isBatchedMesh)) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      if (ms.some((m) => m && (m.transparent || m.depthWrite === false || m.blending === THREE.AdditiveBlending))) h = true;
    }
    if (h) hide(o);
  });
  const prevRT = renderer.getRenderTarget(), prevCol = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
  const prevOverride = scene.overrideMaterial, prevAuto = renderer.shadowMap.autoUpdate, prevBg = scene.background;
  let buf = null;
  try {
    scene.overrideMaterial = mat; renderer.shadowMap.autoUpdate = false; scene.background = null;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, cam);
    buf = new Float32Array(res * res * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, res, res, buf);
  } catch (e) { console.warn('[vegetation] surfaceMap failed', e); buf = null; }
  finally {
    scene.overrideMaterial = prevOverride; renderer.shadowMap.autoUpdate = prevAuto; scene.background = prevBg;
    renderer.setRenderTarget(prevRT); renderer.setClearColor(prevCol, prevA);
    for (const o of hidden) o.visible = true;
    rt.dispose(); mat.dispose();
  }
  if (!buf) return null;
  const Y = new Float32Array(res * res), NY = new Float32Array(res * res);
  let valid = 0;
  for (let i = 0; i < res * res; i++) {
    const a = buf[i * 4 + 3];
    if (a > 1.5) { Y[i] = buf[i * 4]; NY[i] = a - 2; valid++; } else { Y[i] = NaN; NY[i] = 0; }
  }
  buf = null;
  const cell = size / res, x0 = cx - size / 2, z1 = cz + size / 2;
  const idx = (x, z) => {
    const i = Math.floor((x - x0) / cell), j = Math.floor((z1 - z) / cell);
    return i < 0 || j < 0 || i >= res || j >= res ? -1 : j * res + i;
  };
  return {
    cx, cz, size, res, cell, valid,
    y(x, z) { const k = idx(x, z); return k < 0 ? NaN : Y[k]; },
    ny(x, z) { const k = idx(x, z); return k < 0 ? 0 : NY[k]; },
    /** min / max height in a (2r)² neighbourhood (5×5 taps) */
    range(x, z, r) {
      let lo = Infinity, hi = -Infinity;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const v = this.y(x + (a * r) / 2, z + (b * r) / 2);
        if (Number.isNaN(v)) continue;
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
      return [lo, hi];
    },
  };
}
