// Instance manager: every tree variant has 4 LOD geometries (each split into bark / blob / card
// parts, one material each). Instances are re-bucketed into LODs from the CURRENT camera
// (projected size in pixels) and culled per instance against the view frustum extended toward
// the sun (so off-screen trees still cast their shadows into view). Re-bucketing runs on every
// shot change, whenever the camera moved (video / interactive), and costs a few ms.
import * as THREE from 'three';
import { ATMO } from '../core/atmosphere.js';
import { windDepthMaterial } from '../materials/foliage.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0), _up = new THREE.Vector3(), _qt = new THREE.Quaternion();
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
const MAX_TRIS = 350000;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export class VegSystem {
  constructor(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.variants = [];
    this.lastCam = null;
    this.stats = { instances: 0 };
    this.detail = engine.quality.detail ?? 1;
  }

  /**
   * @param {object} def { name, lods:[{bark,blob,card}], materials:{bark,blob,card}, H (nominal height),
   *                       px: [lod0, lod1, lod2] pixel-height thresholds, cullPx, shadowLod (max LOD casting shadows) }
   */
  addVariant(def) {
    const v = { ...def, inst: [], meshes: [] };
    this.variants.push(v);
    return v;
  }

  /**
   * add an instance: position, yaw (rad, about the tree's own axis), scale (uniform), opts:
   *   width (crown width multiplier), tint [r,g,b],
   *   up [x,y,z] (world-space growth direction; default +Y) or tilt [ax, az] (world rotations about X then Z, rad)
   */
  add(v, x, y, z, yaw, scale, opts = {}) {
    v.inst.push({ x, y, z, yaw, s: scale, w: opts.width || 1, up: opts.up || (opts.tilt ? [-Math.sin(opts.tilt[1]) * Math.cos(opts.tilt[0]), Math.cos(opts.tilt[1]) * Math.cos(opts.tilt[0]), Math.cos(opts.tilt[1]) * Math.sin(opts.tilt[0])] : null), tint: opts.tint || [1, 1, 1], h: v.H * scale });
  }

  finalize() {
    for (const v of this.variants) {
      const n = v.inst.length;
      if (!n) continue;
      // precompute matrices
      v.mat = new Float32Array(n * 16);
      v.col = new Float32Array(n * 3);
      v.ctr = new Float32Array(n * 4);
      v.lastLod = new Int8Array(n).fill(-1);
      for (let i = 0; i < n; i++) {
        const it = v.inst[i];
        // world-space tilt (growth direction) applied after the yaw about the tree's own axis
        _q.setFromAxisAngle(_Y, it.yaw);
        if (it.up) { _up.set(it.up[0], it.up[1], it.up[2]).normalize(); _qt.setFromUnitVectors(_Y, _up); _q.premultiply(_qt); }
        _s.set(it.s * it.w, it.s, it.s * it.w);
        _p.set(it.x, it.y, it.z);
        _m.compose(_p, _q, _s);
        _m.toArray(v.mat, i * 16);
        v.col.set(it.tint, i * 3);
        v.ctr[i * 4] = it.x; v.ctr[i * 4 + 1] = it.y + it.h * 0.5; v.ctr[i * 4 + 2] = it.z; v.ctr[i * 4 + 3] = it.h;
      }
      // LOD buckets are split into pages (separate instanced draws of ≤ ~MAX_TRIS triangles each):
      // keeps every single draw call short on the integrated GPU. Pages are created on demand.
      v.lodMeshes = v.lods.map((lod, l) => ({ l, lod, pages: [], page: clamp(Math.floor(MAX_TRIS / Math.max(1, lod.tris || 1)), 16, 4096) }));
      this.stats.instances += n;
    }
    for (const card of [false, true]) this.engine.patchMaterial?.(windDepthMaterial(card));
    // instanced pages are created lazily (first LOD update happens after engine.prepareScene()), so patch
    // every variant material here: atmosphere + CSM, and a per-shader program cache key (unpatched
    // procedural materials would all share three's default key and silently swap programs)
    for (const v of this.variants) for (const k in v.materials) this.engine.patchMaterial?.(v.materials[k]);
    // sentinel: re-bucket when the interactive camera moves (onBeforeRender of the main pass)
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    const sm = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const sentinel = new THREE.Mesh(sg, sm);
    sentinel.frustumCulled = false; sentinel.castShadow = false; sentinel.receiveShadow = false;
    sentinel.userData.castShadow = false; sentinel.userData.noPatch = true;
    sentinel.onBeforeRender = (renderer, scene, camera) => { if (camera === this.engine.camera) this.maybeUpdate(camera); };
    this.group.add(sentinel);
  }

  _newPage(v, L) {
    const cap = L.page;
    const im = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
    im.setUsage(THREE.DynamicDrawUsage);
    const ic = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    ic.setUsage(THREE.DynamicDrawUsage);
    const parts = [];
    const P = this.engine.params;
    for (const part of ['bark', 'blob', 'card', 'bb']) {
      const geo = L.lod[part];
      if (!geo) continue;
      if (P?.get?.('vegNoCards') && part === 'card') continue;
      const mesh = new THREE.InstancedMesh(geo, v.materials[part], cap);
      mesh.instanceMatrix = im;
      mesh.instanceColor = ic;
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.name = `veg:${v.name}:L${L.l}:${part}:p${L.pages.length}`;
      // far LODs and mid-range leaf cards add nothing visible to the (coarse) shadow cascades
      const cast = L.l <= (v.shadowLod ?? 3) && !(part === 'card' && L.l > 0) && !P?.get?.('vegNoShadow');
      mesh.castShadow = cast; mesh.receiveShadow = true;
      mesh.userData.castShadow = cast; mesh.userData.receiveShadow = true;
      mesh.customDepthMaterial = windDepthMaterial(part === 'card' || part === 'bb');
      this.group.add(mesh);
      parts.push(mesh);
    }
    const pg = { im, ic, parts, cap };
    L.pages.push(pg);
    return pg;
  }

  /** forget LOD history (a camera cut): stills are then independent of previously rendered shots */
  resetHistory() { for (const v of this.variants) if (v.lastLod) v.lastLod.fill(-1); }

  maybeUpdate(camera = this.engine.camera) {
    const c = camera;
    const key = [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov];
    if (this.lastCam) {
      const dp = Math.hypot(key[0] - this.lastCam[0], key[1] - this.lastCam[1], key[2] - this.lastCam[2]);
      const dq = Math.abs(key[3] - this.lastCam[3]) + Math.abs(key[4] - this.lastCam[4]) + Math.abs(key[5] - this.lastCam[5]) + Math.abs(key[6] - this.lastCam[6]);
      if (dp < 0.75 && dq < 0.004 && key[7] === this.lastCam[7]) return false;
    }
    this.update(camera);
    return true;
  }

  /**
   * re-bucket every instance into LODs for this camera. Keeps the drawn vegetation under a triangle budget
   * (default 9 M, URL param vegTris): when a view would exceed it, the LOD distances shrink (≤ 3 retries).
   */
  update(camera = this.engine.camera) {
    const t0 = performance.now();
    // (r5) the budget grows with the output height: a 4K still keeps the LOD distances of the 941 px frame
    // (otherwise the doubled projected sizes would just be traded back for coarser LODs)
    const resK = clamp((this.engine.height || 941) / 941, 1, 2.4);
    // (r5: 9 M → 13 M at high: vegetation costs ≈ 65 ms of a ≈ 0.6-0.9 s sample on the 780M, and the finer
    //  LODs are what keeps the mid-distance crowns textured instead of smooth)
    const budget = Number(this.engine.params?.get?.('vegTris')) || (this.engine.quality.name === 'ultra' ? 16e6 : this.detail >= 1 ? 13e6 : 9e6) * resK;
    let k = 1, st = this._update(camera, 1, false);
    for (let i = 0; i < 3 && this.forceLod === undefined && st.tris > budget; i++) {
      k *= Math.sqrt(budget / st.tris) * 0.94;
      st = this._update(camera, k, true);
    }
    st.lodScale = +k.toFixed(3);
    st.updateMs = +(performance.now() - t0).toFixed(1);
    return st;
  }

  _update(camera, kScale, noHyst) {
    const t0 = performance.now();
    const c = camera;
    c.updateMatrixWorld(true);
    this.lastCam = [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov];
    // a slightly wider frustum (jitter / DOF / edge popping)
    const cam2 = c.clone();
    cam2.fov = Math.min(170, c.fov * 1.12);
    cam2.aspect = c.aspect * 1.04;
    cam2.near = 0.1; cam2.far = 40000;
    cam2.updateProjectionMatrix();
    cam2.updateMatrixWorld(true);
    _pm.multiplyMatrices(cam2.projectionMatrix, cam2.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    const focalPx = (this.engine.height * 0.5) / Math.tan((c.fov * Math.PI) / 360);
    const sun = ATMO.uSunDir.value;
    const sy = Math.max(0.12, sun.y);
    const cx = c.position.x, cy = c.position.y, cz = c.position.z;
    let drawn = 0, tris = 0;
    // preview switches LODs earlier; ultra (video) later, so transitions happen far from the camera
    const qn = this.engine.quality.name;
    const lodK = (qn === 'ultra' ? 1.35 : this.detail >= 1 ? 1 : 0.7) * kScale;
    for (const v of this.variants) {
      if (!v.inst.length) continue;
      const n = v.inst.length;
      const counts = v.lodMeshes.map(() => 0);
      const px = v.px;
      for (let i = 0; i < n; i++) {
        const x = v.ctr[i * 4], y = v.ctr[i * 4 + 1], z = v.ctr[i * 4 + 2], h = v.ctr[i * 4 + 3];
        const r = h * 0.5 + 1.5;
        _sph.center.set(x, y, z); _sph.radius = r;
        let vis = _frustum.intersectsSphere(_sph);
        if (!vis) {
          // shadow volume: from the crown away from the sun down to the ground
          const L = Math.min(220, (h * 0.6) / sy);
          _sph.center.set(x - sun.x * L * 0.5, y - sun.y * L * 0.5, z - sun.z * L * 0.5);
          _sph.radius = r + L * 0.5;
          vis = _frustum.intersectsSphere(_sph);
          if (vis) {
            // only near trees can cast meaningful shadows into view
            const d = Math.hypot(x - cx, y - cy, z - cz);
            if (d > 1500) vis = false;
          }
        }
        if (!vis) continue;
        const d = Math.max(0.1, Math.hypot(x - cx, y - cy, z - cz) - h * 0.25);
        const p = (h * focalPx) / d * lodK;
        if (p < (v.cullPx ?? 0.6)) continue;
        let l = this.forceLod !== undefined ? this.forceLod : p > px[0] ? 0 : p > px[1] ? 1 : p > px[2] ? 2 : 3;
        // hysteresis: keep the previous LOD while within ±12% of the switching threshold (less popping in motion)
        const prev = v.lastLod[i];
        if (prev >= 0 && prev !== l && this.forceLod === undefined && !noHyst) {
          const th = px[Math.min(prev, l)];
          if (p > th * 0.88 && p < th * 1.12) l = prev;
        }
        v.lastLod[i] = l;
        const li = Math.min(l, v.lodMeshes.length - 1);
        const L = v.lodMeshes[li];
        const k = counts[li]++;
        const pi = Math.floor(k / L.page), s = k - pi * L.page;
        const pg = L.pages[pi] || this._newPage(v, L);
        pg.im.array.set(v.mat.subarray(i * 16, i * 16 + 16), s * 16);
        pg.ic.array[s * 3] = v.col[i * 3]; pg.ic.array[s * 3 + 1] = v.col[i * 3 + 1]; pg.ic.array[s * 3 + 2] = v.col[i * 3 + 2];
      }
      for (let l = 0; l < v.lodMeshes.length; l++) {
        const L = v.lodMeshes[l];
        L.count = counts[l];
        for (let pi = 0; pi < L.pages.length; pi++) {
          const pg = L.pages[pi];
          const c = clamp(counts[l] - pi * L.page, 0, L.page);
          for (const m of pg.parts) { m.count = c; m.visible = c > 0; }
          pg.im.clearUpdateRanges(); pg.ic.clearUpdateRanges();
          if (c) {
            pg.im.addUpdateRange(0, c * 16); pg.ic.addUpdateRange(0, c * 3);
            pg.im.needsUpdate = true; pg.ic.needsUpdate = true;
          }
        }
        drawn += counts[l];
        tris += counts[l] * (v.lods[l].tris || 0);
      }
    }
    this.stats.drawn = drawn;
    this.stats.tris = tris;
    this.stats.updateMs = +(performance.now() - t0).toFixed(1);
    return this.stats;
  }

  lodHistogram() {
    return this.variants.map((v) => `${v.name}:${v.lodMeshes ? v.lodMeshes.map((l) => l.count).join('/') : '-'}`).join(' ');
  }
}
