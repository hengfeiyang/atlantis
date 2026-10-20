// Sun (cascaded shadow maps) + image based lighting from the procedural sky.
//
// LIGHT CALIBRATION (exposure 1.0, AgX grade in core/pipeline.js) — tuned against the references:
//   * sun: intensity 12 (at ≥ 22° elevation, dimmer and warmer when low; colour from air mass)
//   * a warm-white marble albedo (0.68, 0.64, 0.57) facing the sun renders ≈ #e2dad0, its shadow side
//     ≈ #91949b (cool blue-grey). Keep albedos realistic: marble 0.6–0.75, limestone rock 0.3–0.45,
//     foliage 0.04–0.15, snow 0.8. Emissive flames ≈ 20–60 to read as bright with bloom.
//   * the IBL (scene.environment) is the sky at SKY.uEnvScale (≈ 0.34) of its visible radiance with
//     the clouds subdued → deep, cool shadows. Water/mirror reflections that want the visible sky
//     brightness should scale their env contribution by 1 / SKY.uEnvScale (engine.registry.skyEnvScale).
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { ATMO } from './atmosphere.js';
import { SKY, createSky, ensureCloudTextures } from './sky.js';
import { LENS } from './pipeline.js';

export const SUN = {
  color: new THREE.Color(1.0, 0.87, 0.71),
  intensity: 12.0,
  dir: new THREE.Vector3(-0.7, 0.35, 0.6).normalize(), // toward the sun
  angularRadius: 0.0047 * 2.2, // soft-shadow cone (rad) — a bit larger than the real sun for nicer penumbrae
};

/** Physically-motivated sun tint for an elevation (deg): warmer and dimmer near the horizon. */
export function sunColorForElevation(elDeg) {
  const e = Math.max(0.5, elDeg);
  // relative air mass (Kasten-Young) → wavelength-dependent extinction
  const s = Math.sin((e * Math.PI) / 180);
  const am = Math.min(3.5, 1 / (s + 0.50572 * Math.pow(e + 6.07995, -1.6364))); // capped: golden, never orange-red
  const k = [0.02, 0.10, 0.24]; // art-directed (refs: golden sun, lit marble ≈ #dcc8b0) optical depth per air mass (R, G, B)
  const c = k.map((ki) => Math.exp(-ki * (am - 1)));
  const m = Math.max(...c);
  return new THREE.Color(c[0] / m, c[1] / m, c[2] / m);
}

export class Lighting {
  constructor(engine) {
    this.engine = engine;
    const { scene, camera, quality } = engine;
    this.csm = new CSM({
      maxFar: quality.shadowMaxFar,
      cascades: quality.cascades,
      mode: 'practical',
      parent: scene,
      shadowMapSize: quality.shadowMapSize,
      lightDirection: SUN.dir.clone().negate(),
      camera,
      lightIntensity: SUN.intensity,
      lightNear: 1,
      lightFar: 6000,
      lightMargin: 1200,
      shadowBias: -0.00012,
    });
    this.csm.fade = true;
    for (const l of this.csm.lights) {
      l.shadow.normalBias = 0.06;
      l.color.copy(SUN.color);
    }
    // shared CSM uniforms injected into every lit material by engine.patchMaterial()
    this.csmUniforms = {
      CSM_cascades: { value: [] },
      cameraNear: { value: camera.near },
      shadowFar: { value: Math.min(camera.far, this.csm.maxFar) },
    };
    this.refreshCSM();
    try { ensureCloudTextures(engine.renderer); } catch (e) { console.warn('[sky] cloud noise generation failed', e); }
    this._syncSkyUniforms();
  }

  /** call after camera projection (fov/near/far/aspect) changes */
  refreshCSM() {
    const csm = this.csm, cam = this.engine.camera;
    csm.updateFrustums();
    csm._getExtendedBreaks(this.csmUniforms.CSM_cascades.value);
    this.csmUniforms.cameraNear.value = cam.near;
    this.csmUniforms.shadowFar.value = Math.min(cam.far, csm.maxFar);
    // CSM practical split uses fixed lambda; tweak the near cascade to be tight for crisp contact shadows
    for (const l of csm.lights) l.shadow.camera.far = csm.lightFar + csm.lightMargin;
  }

  _syncSkyUniforms() {
    SKY.uSunIrr.value.set(SUN.color.r, SUN.color.g, SUN.color.b).multiplyScalar(SUN.intensity);
    ATMO.uSunColor.value.copy(SUN.color);
  }

  /**
   * @param {THREE.Vector3} dir toward the sun
   * @param {THREE.Color} [color] explicit sun colour (otherwise derived from the elevation)
   * @param {number} [intensity]
   */
  setSun(dir, color, intensity) {
    if (dir) SUN.dir.copy(dir).normalize();
    if (color) SUN.color.copy(color);
    else if (dir) {
      const el = (Math.asin(THREE.MathUtils.clamp(SUN.dir.y, -1, 1)) * 180) / Math.PI;
      SUN.color.copy(sunColorForElevation(el));
    }
    if (intensity !== undefined) SUN.intensity = intensity;
    else if (dir) {
      // a touch dimmer when very low (longer path through the haze)
      const el = (Math.asin(THREE.MathUtils.clamp(SUN.dir.y, -1, 1)) * 180) / Math.PI;
      SUN.intensity = 12.0 * THREE.MathUtils.lerp(0.78, 1.0, THREE.MathUtils.smoothstep(el, 3, 22));
    }
    ATMO.uSunDir.value.copy(SUN.dir);
    for (const l of this.csm.lights) { l.color.copy(SUN.color); l.intensity = SUN.intensity; }
    this.csm.lightDirection.copy(SUN.dir).negate();
    this._syncSkyUniforms();
  }

  /** per-subframe update; jitter (0..1 pair) samples the sun disk for soft shadows */
  update(jitter = null) {
    const d = SUN.dir.clone();
    if (jitter) {
      const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
      t1.crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
      t2.crossVectors(d, t1);
      const r = Math.sqrt(jitter[0]) * SUN.angularRadius, a = jitter[1] * Math.PI * 2;
      d.addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
    }
    this.csm.lightDirection.copy(d).negate();
    this.csm.update();
    // volumetrics decorrelate their ray-march jitter per accumulated sub-frame
    SKY.uFrame.value = (SKY.uFrame.value + 1) % 4096;
    this.updateLens();
  }

  /** screen-space sun position for the lens effects (glare, ghosts, god rays) */
  updateLens() {
    if (!LENS) return;
    const cam = this.engine.camera;
    const sd = SKY.uSunDiskMode.value > 0.5 ? SKY.uSunDiskDir.value.clone().normalize() : SUN.dir;
    const p = sd.clone().multiplyScalar(1e5).add(cam.position).project(cam);
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const facing = fwd.dot(sd);
    LENS.uSunPos.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    LENS.uSunFacing.value = facing;
    const c = SUN.color;
    LENS.uSunTint.value.set(c.r, c.g, c.b);
    LENS.uAspect.value = cam.aspect;
    LENS.uSunRadius.value = SKY.uSunSize.value / (2 * Math.tan((cam.fov * Math.PI) / 360));
  }

  /** (re)build the environment map from the sky (call after sun/sky changes) */
  buildEnvironment() {
    const { renderer, scene } = this.engine;
    try { ensureCloudTextures(renderer); } catch (e) { /* already warned */ }
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(renderer);
    if (!this.envScene) {
      this.envScene = new THREE.Scene();
      this.envSky = createSky();
      this.envSky.renderOrder = 0;
      this.envScene.add(this.envSky);
    }
    SKY.uEnvPass.value = 1;
    const prev = scene.environment;
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    SKY.uEnvPass.value = 0;
    if (prev && prev !== rt.texture) prev.dispose?.();
    scene.environment = rt.texture;
    scene.environmentIntensity = this.engine.envIntensity ?? 1.0;
    if (this.engine.registry) this.engine.registry.skyEnvScale = SKY.uEnvScale.value;
    this.updateLens();
    return rt.texture;
  }
}
