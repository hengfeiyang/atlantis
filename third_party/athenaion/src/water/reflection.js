// Planar reflection for the y = waterLevel plane.
//
// Renders the scene from the mirrored camera into a HDR target (+ depth texture) right before
// the water is drawn (mesh.onBeforeRender). The render is cached per frame: the accumulation
// pipeline draws the scene N times per still with sub-pixel jitter, but the reflection only
// needs to be rendered once per camera pose / time.
// The pass is rendered WITHOUT aerial perspective (the mirrored camera sits below the water,
// where the exponential mist/haze layers would explode); the water shader reconstructs the
// reflected point from the depth texture and applies the atmosphere between it and the surface.
import * as THREE from 'three';
import { ATMO } from '../core/atmosphere.js';
import { SKY } from '../core/sky.js';

export class PlanarReflection {
  constructor(engine, { level = 0, scale = 0.5 } = {}) {
    this.engine = engine;
    this.level = level;
    this.scale = scale;
    const w = Math.max(64, Math.round(engine.width * scale * 1.12)), h = Math.max(64, Math.round(engine.height * scale * 1.12));
    const depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
      depthBuffer: true, stencilBuffer: false, depthTexture,
    });
    this.rt.texture.name = 'waterReflection';
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = true;
    this.uniforms = {
      tRefl: { value: this.rt.texture },
      tReflDepth: { value: depthTexture },
      uReflMatrix: { value: new THREE.Matrix4() },
      uReflInvVP: { value: new THREE.Matrix4() },
      uReflOn: { value: 1 },
      uReflSize: { value: new THREE.Vector2(w, h) },
    };
    this._key = '';
    this.renders = 0;
    this.enabled = true;
    this.hidden = []; // objects to hide during the pass (water meshes)
    this.margin = 0.18;
  }

  _frameKey(camera) {
    const p = camera.position, e = camera.matrixWorld.elements;
    const r = (v) => Math.round(v * 200) / 200;
    return [r(p.x), r(p.y), r(p.z), r(e[8] * 10), r(e[9] * 10), r(e[10] * 10), r(e[4] * 10), camera.fov, camera.aspect, this.engine.time, this.engine.width].join(',');
  }

  /** call from onBeforeRender of the water mesh */
  update(renderer, scene, camera) {
    if (!this.enabled || this._inPass) return;
    const key = this._frameKey(camera);
    if (key === this._key) return;
    this._key = key;
    this._inPass = true;

    const level = this.level;
    const normal = new THREE.Vector3(0, 1, 0);
    const planePt = new THREE.Vector3(0, level, 0);
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y < level + 0.05) { this._inPass = false; return; }

    // mirror the camera
    const vc = this.camera;
    const rotM = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const lookDir = new THREE.Vector3(0, 0, -1).applyMatrix4(rotM);
    const target = camPos.clone().add(lookDir);
    const mirror = (v) => v.set(v.x, 2 * level - v.y, v.z);
    const vPos = mirror(camPos.clone());
    const vTarget = mirror(target.clone());
    const up = new THREE.Vector3(0, 1, 0).applyMatrix4(rotM);
    up.reflect(normal);
    vc.position.copy(vPos);
    vc.up.copy(up);
    vc.lookAt(vTarget);
    vc.far = camera.far; vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    // remove the sub-pixel jitter of the main camera (keeps the reflection identical across samples)
    vc.projectionMatrix.elements[8] = 0; vc.projectionMatrix.elements[9] = 0;
    // wider frustum (margin): ripple-perturbed reflection rays near the frame edges stay inside the
    // reflection image instead of falling back to the (differently lit) IBL in hard-edged blocks
    vc.projectionMatrix.elements[0] /= 1 + this.margin; vc.projectionMatrix.elements[5] /= 1 + this.margin;

    // oblique near plane = water plane (clip everything below the surface)
    const clipBias = 0.05;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, planePt);
    plane.applyMatrix4(vc.matrixWorldInverse);
    const clipPlane = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const P = vc.projectionMatrix, q = new THREE.Vector4();
    q.x = (Math.sign(clipPlane.x) + P.elements[8]) / P.elements[0];
    q.y = (Math.sign(clipPlane.y) + P.elements[9]) / P.elements[5];
    q.z = -1.0;
    q.w = (1.0 + P.elements[10]) / P.elements[14];
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
    P.elements[2] = clipPlane.x; P.elements[6] = clipPlane.y;
    P.elements[10] = clipPlane.z + 1.0 - clipBias; P.elements[14] = clipPlane.w;
    vc.projectionMatrixInverse.copy(P).invert();

    // texture matrix: world → reflection uv (projective)
    const tm = this.uniforms.uReflMatrix.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(P).multiply(vc.matrixWorldInverse);
    // inverse view-projection: ndc → world (for depth reconstruction)
    this.uniforms.uReflInvVP.value.copy(vc.matrixWorld).multiply(vc.projectionMatrixInverse);

    // ---- render
    const prevRT = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevXR = renderer.xr.enabled;
    const prevAtmo = ATMO.uAtmoEnabled.value;
    const prevDisk = SKY.uSunDisk ? SKY.uSunDisk.value : 0;
    const vis = this.hidden.map((o) => o.visible);
    for (const o of this.hidden) o.visible = false;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    ATMO.uAtmoEnabled.value = 0;
    // no sun disk (the GGX sun term on the water does the glint). NOT uEnvPass: that would also scale the
    // sky down to the dim IBL level (SKY.uEnvScale) and subdue the clouds — reflections need the visible sky.
    if (SKY.uSunDisk) SKY.uSunDisk.value = 0;
    renderer.setRenderTarget(this.rt);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear(true, true, false);
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevRT);
    if (SKY.uSunDisk) SKY.uSunDisk.value = prevDisk;
    ATMO.uAtmoEnabled.value = prevAtmo;
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.xr.enabled = prevXR;
    this.hidden.forEach((o, i) => { o.visible = vis[i]; });
    const vp = camera.viewport; if (vp !== undefined) renderer.state.viewport(vp);
    this.renders++;
    this._inPass = false;
  }
}
