// Engine: renderer, scene, camera, lighting, atmosphere, accumulation pipeline, shots.
// Modules receive the engine (`ctx`) in build(ctx). Useful members:
//   ctx.scene, ctx.camera, ctx.renderer, ctx.quality, ctx.footprints, ctx.rng(label)
//   ctx.onUpdate(fn(t, dt))   animation hook (time is deterministic for offline renders)
//   ctx.add(object, {shadows})  add to scene (casts/receives shadows by default)
import * as THREE from 'three';
import { installAtmosphere, ATMO } from './atmosphere.js';
import { Lighting, SUN } from './lighting.js';
import { createSky, SKY } from './sky.js';
import { Pipeline, GRADE } from './pipeline.js';
import { Footprints } from './footprints.js';
import { CG_DFG_FIX_GLSL } from './materials.js';
import { RNG, halton } from './rng.js';
import { dirFromAzEl, SUN as SUN_DEFAULT } from '../world/layout.js';
import { LOOKS } from '../world/looks.js';

const LIT = (m) => m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial;

export class Engine {
  constructor({ width, height, quality, params }) {
    this.width = width; this.height = height;
    this.quality = quality;
    this.params = params;
    this.time = 0;
    this.updates = [];
    this.footprints = new Footprints();
    // Slots: producers (architecture) push anchor points during build, consumers (banners, statues,
    // vegetation, braziers…) read them later. Slot = { pos:[x,y,z], facing: compass deg, size, tag, ... }
    this.slots = { banner: [], brazier: [], statue: [], ivy: [], urn: [], planter: [], lamp: [] };
    // Shared registry for cross-module data (e.g. registry.templeFrames for pediment sculpture)
    this.registry = {};
    this.envIntensity = 1.0;
    this.stats = {};

    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    document.body.appendChild(canvas);
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, stencil: false, depth: true,
      preserveDrawingBuffer: true, powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.autoClear = false;
    this.renderer = renderer;

    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuInfo = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.5, 60000);
    this.camera.position.set(-300, 60, 400);
    this.camera.lookAt(20, 96, -60);
    this.scene.add(this.camera);

    installAtmosphere(this.scene);
    this.sky = createSky();
    this.scene.add(this.sky);
    SKY.uCloudSteps.value = quality.cloudSteps;

    this.lighting = new Lighting(this);
    // three r186: the CSM addon replaces lights_fragment_begin without the new DFG / multi-scatter
    // setup, which zeroes IBL specular on every patched PBR material. Prepend it once, globally.
    if (!THREE.ShaderChunk.lights_fragment_begin.includes('cgNVms')) {
      THREE.ShaderChunk.lights_fragment_begin = CG_DFG_FIX_GLSL + THREE.ShaderChunk.lights_fragment_begin;
    }
    const d = dirFromAzEl(SUN_DEFAULT.azimuth, SUN_DEFAULT.elevation);
    this.lighting.setSun(new THREE.Vector3(...d));
    this.pipeline = new Pipeline(renderer, width, height, quality);
  }

  rng(label) { return new RNG(String(label)); }
  onUpdate(fn) { this.updates.push(fn); }

  add(obj, { castShadow = true, receiveShadow = true } = {}) {
    obj.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh || o.isBatchedMesh) {
        if (o.userData.castShadow === undefined) o.castShadow = castShadow;
        if (o.userData.receiveShadow === undefined) o.receiveShadow = receiveShadow;
      }
    });
    this.scene.add(obj);
    return obj;
  }

  /** Inject atmosphere + CSM into a material. Idempotent. */
  patchMaterial(mat) {
    if (!mat || mat.userData.__cgPatched || mat.userData.noPatch) return;
    mat.userData.__cgPatched = true;
    const lit = LIT(mat);
    const prev = mat.onBeforeCompile;
    const csmU = this.lighting.csmUniforms;
    const atmo = ATMO;
    if (lit) {
      mat.defines = mat.defines || {};
      mat.defines.USE_CSM = 1;
      mat.defines.CSM_CASCADES = this.quality.cascades;
      mat.defines.CSM_FADE = '';
    }
    mat.onBeforeCompile = function (shader, renderer) {
      for (const k in atmo) shader.uniforms[k] = atmo[k];
      if (lit) Object.assign(shader.uniforms, csmU);
      if (prev) prev.call(this, shader, renderer);
    };
    const baseKey = mat.userData.shaderKey || (prev ? prev.toString() : '');
    mat.customProgramCacheKey = () => `${baseKey}|cg|${lit ? 'csm' + this.quality.cascades : ''}`;
    mat.needsUpdate = true;
  }

  /** Patch materials of objects created after prepareScene() (lazy meshes, LOD swaps…). Cheap. */
  ensurePatched() {
    const objs = [];
    this.scene.traverse((o) => {
      if (o.userData.noPatch || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (!m.userData.__cgPatched && !m.userData.noPatch) objs.push(m);
      if (o.customDepthMaterial && !o.customDepthMaterial.userData.__cgPatched) objs.push(o.customDepthMaterial);
    });
    for (const m of objs) this.patchMaterial(m);
    if (objs.length && this._prepared) console.log('[engine] late-patched ' + objs.length + ' materials');
  }

  /** Patch every material in the scene (call after building, before rendering). */
  prepareScene() {
    this._prepared = true;
    const seen = new Set();
    this.scene.traverse((o) => {
      if (o.userData.noPatch) return;
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) { if (!seen.has(m)) { seen.add(m); this.patchMaterial(m); } }
      if (o.customDepthMaterial) this.patchMaterial(o.customDepthMaterial);
    });
    this.lighting.refreshCSM();
    this.lighting.buildEnvironment();
  }

  setTime(t) {
    const dt = t - this.time;
    this.time = t;
    ATMO.uAtmoTime.value = t;
    SKY.uSkyTime.value = t;
    for (const fn of this.updates) fn(t, dt);
  }

  // ------------------------------------------------------------------ shots
  applyShot(shotIn) {
    // merge the per-shot look (src/world/looks.js) under any explicit overrides on the shot
    const look = LOOKS[shotIn.id] || {};
    const shot = { ...shotIn };
    for (const k of ['sun', 'grade', 'atmo', 'sky']) if (look[k] || shotIn[k]) shot[k] = { ...(look[k] || {}), ...(shotIn[k] || {}) };
    if (shotIn.envIntensity === undefined && look.envIntensity !== undefined) shot.envIntensity = look.envIntensity;
    this.shot = shot;
    const cam = this.camera;
    cam.fov = shot.fov ?? 40;
    cam.near = shot.near ?? 0.5;
    cam.far = shot.far ?? 60000;
    cam.aspect = this.width / this.height;
    cam.position.set(...shot.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(new THREE.Vector3(...shot.target));
    if (shot.roll) cam.rotateZ((shot.roll * Math.PI) / 180);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    const sun = shot.sun || {};
    const az = sun.azimuth ?? SUN_DEFAULT.azimuth, el = sun.elevation ?? SUN_DEFAULT.elevation;
    this.lighting.setSun(new THREE.Vector3(...dirFromAzEl(az, el)),
      sun.color ? new THREE.Color(...sun.color) : null, sun.intensity);

    // reset grade/atmo/sky to defaults, then apply shot overrides
    this._restoreDefaults();
    for (const [k, v] of Object.entries(shot.grade || {})) setUniform(GRADE, k, v);
    for (const [k, v] of Object.entries(shot.atmo || {})) setUniform(ATMO, k, v);
    for (const [k, v] of Object.entries(shot.sky || {})) setUniform(SKY, k, v);
    this.envIntensity = shot.envIntensity ?? 1.0;
    this.lighting.refreshCSM();
    this.lighting.buildEnvironment();
    if (shot.time !== undefined) this.setTime(shot.time); else this.setTime(this.time);
    for (const fn of this.shotHooks || []) fn(shot);
  }
  onShot(fn) { (this.shotHooks ||= []).push(fn); }

  _snapshotDefaults() {
    const snap = (U) => Object.fromEntries(Object.entries(U).map(([k, u]) => [k, u.value?.clone ? u.value.clone() : u.value]));
    this._defaults = { GRADE: snap(GRADE), ATMO: snap(ATMO), SKY: snap(SKY) };
  }
  _restoreDefaults() {
    if (!this._defaults) this._snapshotDefaults();
    const rest = (U, D) => { for (const k in D) { const v = D[k]; if (U[k].value?.copy) U[k].value.copy(v); else U[k].value = v; } };
    rest(GRADE, this._defaults.GRADE); rest(SKY, this._defaults.SKY);
    const sunDir = ATMO.uSunDir.value.clone();
    rest(ATMO, this._defaults.ATMO);
    ATMO.uSunDir.value.copy(sunDir);
  }

  // ------------------------------------------------------------------ rendering
  _jitter(i, dof) {
    const cam = this.camera;
    this._savedPos = cam.position.clone();
    cam.updateProjectionMatrix();
    const P = cam.projectionMatrix.elements;
    // 2px-wide tent filter via Halton jitter (smoother than a box filter)
    const tent = (u) => (u < 0.5 ? Math.sqrt(2 * u) - 1 : 1 - Math.sqrt(2 - 2 * u));
    const jx = tent(halton(i + 1, 2)) * 0.9, jy = tent(halton(i + 1, 3)) * 0.9;
    P[8] += (2 * jx) / this.width;
    P[9] += (2 * jy) / this.height;
    if (dof && dof.aperture > 0 && dof.focus > 0) {
      const r = Math.sqrt(halton(i + 1, 5)) * dof.aperture * 0.5, a = halton(i + 1, 7) * Math.PI * 2;
      const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      cam.position.addScaledVector(right, dx).addScaledVector(up, dy);
      P[8] -= (P[0] * dx) / dof.focus;
      P[9] -= (P[5] * dy) / dof.focus;
    }
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.updateMatrixWorld(true);
  }
  _unjitter() {
    const cam = this.camera;
    if (this._savedPos) cam.position.copy(this._savedPos);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  renderSample(i, { jitter = true, softShadows = this.quality.softShadows } = {}) {
    const dof = this.shot?.dof;
    if (jitter) this._jitter(i, dof);
    this.lighting.update(softShadows && jitter ? [halton(i + 1, 11), halton(i + 1, 13)] : null);
    this.pipeline.addSample(this.scene, this.camera);
    if (jitter) this._unjitter();
  }

  async renderStill(spp = this.quality.spp) {
    const t0 = performance.now();
    this.ensurePatched();
    this.pipeline.begin();
    const gl = this.renderer.getContext();
    for (let i = 0; i < spp; i++) {
      this.renderSample(i, { jitter: spp > 1 });
      // keep the GPU queue short (avoids driver timeouts on long renders): wait on a fence
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      if (sync) {
        for (let k = 0; k < 20000 && gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED; k++) await new Promise((r) => setTimeout(r, 2));
        gl.deleteSync(sync);
      } else await new Promise((r) => setTimeout(r, 0));
    }
    this.pipeline.resolve(null, 0);
    const info = this.renderer.info;
    this.stats = {
      spp, renderMs: Math.round(performance.now() - t0),
      calls: this.pipeline.sceneInfo?.calls, triangles: this.pipeline.sceneInfo?.triangles,
      geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length,
    };
    window.__STATS = { ...(window.__STATS || {}), ...this.stats };
    return this.canvas.toDataURL('image/png');
  }

  /** one interactive frame; accumulates progressively while the camera is still */
  renderInteractive(moving) {
    if (moving) this.ensurePatched();
    if (moving || this._accFrames === undefined) { this.pipeline.begin(); this._accFrames = 0; }
    const maxAcc = 64;
    if (this._accFrames < maxAcc) {
      this.renderSample(this._accFrames, { jitter: this._accFrames > 0, softShadows: this._accFrames > 0 && this.quality.softShadows });
      this._accFrames++;
      this.pipeline.resolve(null, this._accFrames);
    }
  }
}

function setUniform(U, k, v) {
  if (!U[k]) { console.warn('unknown uniform override', k); return; }
  const u = U[k];
  if (Array.isArray(v)) {
    if (u.value.isColor) u.value.setRGB(...v);
    else u.value.fromArray(v);
  } else u.value = v;
}

export async function createEngine(opts) {
  const e = new Engine(opts);
  window.__GPU_INFO = e.gpuInfo;
  return e;
}
