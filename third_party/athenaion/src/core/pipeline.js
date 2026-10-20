// Offline-quality render pipeline:
//   N sub-frames (jittered sub-pixel AA, thin-lens DOF, soft sun, motion blur) are rendered into a
//   HalfFloat HDR target and averaged into a Float accumulation buffer, then:
//   accumulated HDR → physically-based bloom (mip chain) → colour grade + tone map → canvas.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Grading happens in two domains:
//   scene-linear HDR: exposure, white balance, bloom, lens glare → tone map (AgX by default)
//   display-referred, sRGB-encoded (perceptual 0..1): lift/gamma/gain, a power S-curve around
//   uPivot (uContrast = slope at the pivot; endpoints 0/1 are preserved, so it deepens the toe and
//   brightens the shoulder without clipping), saturation / vibrance, split toning, vignette, grain.
// Target (refs): sRGB luminance p02 3–17, p10 23–39, p50 93–115, p90 196–203, p98 227–242.
//
// r5 (colour lead) additions:
//   * local tone mapping / multi-scale clarity on log-luminance (pyramid at 1/2 … 1/64 res, joint-bilateral
//     upsampling so silhouettes against the sky do not halo): uLtmFine / uLtmMid / uLtmLarge boost the
//     detail bands (soft-clipped at uLtmClip stops), uLtmBase compresses the large-scale base toward the key
//     → texture inside big bright walls / snow / waterfalls and inside large shadows survives the tone curve.
//   * luminance shoulder (uShoulder knee, max): big bright areas roll off below clipping instead of white-out.
//   * hue-selective secondaries in OkLCh (8 bands): uHueShift (deg), uHueSat (chroma ×), uHueLum (ΔL).
//   * auto levels: the graded frame is measured at 1/4 res and black / white / mid-gamma are solved so the
//     luminance percentiles (p02, p50, p98) approach uLevelTarget (temporally smoothed in video).

// uniform float arrays that survive engine._snapshotDefaults / setUniform (clone / copy / fromArray)
class UArr extends Array {
  fromArray(a) { for (let i = 0; i < this.length; i++) this[i] = a[i] ?? this[i]; return this; }
  copy(o) { for (let i = 0; i < this.length; i++) this[i] = o[i]; return this; }
  clone() { return UArr.from(this); }
}
const uarr = (a) => UArr.from(a);

export const GRADE = {
  uExposure: { value: 0.85 },
  uWhiteBalance: { value: new THREE.Vector3(1.02, 1, 0.97) }, // r4: measured per shot (mid-tone R-B vs refs); shots 1/2/9 cooler in looks.js
  uContrast: { value: 1.4 },
  uPivot: { value: 0.5 },         // S-curve pivot (sRGB-encoded)
  uSaturation: { value: 0.96 },      // r5: 1.04 → 0.96 (LTM + secondaries add richness; refs have many near-neutral areas)
  uVibrance: { value: 0.12 },
  uLift: { value: new THREE.Vector3(0.016, 0.018, 0.024) }, // black level (perceptual), slightly cool
  uGamma: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
  uGain: { value: new THREE.Vector3(1.0, 1.0, 1.0) },       // r4: neutral (was warm 1.03/0.96: highlights too yellow)
  uShadowTint: { value: new THREE.Vector3(0.014, 0.008, -0.004) }, // split toning: added to the shadows (perceptual); r5b: 0.026/0.012/-0.012 → milder (shaded marble read orange-brown; ref 5 cella ≈ rgb 66,56,50)
  uHighTint: { value: new THREE.Vector3(0.014, 0.004, -0.012) }, // split toning: added to the highlights (r5: refs' bright stone is warm, rg +6..12 / yb +9..23 above L 200)
  uVignette: { value: new THREE.Vector2(0.28, 0.75) },     // strength, radius
  uGrain: { value: 0.018 },
  uBloom: { value: 0.045 },       // fraction of the (energy-normalised) bloom image mixed in
  uBloomClamp: { value: 60 },     // r5b: HDR luminance cap of the bloom source (sun disk; the sun glow comes from the lens glare)
  uToneMap: { value: 1 },        // 0 ACES fitted, 1 AgX (punchy), 2 Khronos neutral
  uAgxPunch: { value: 1.1 },      // AgX look saturation; r5: 1.05 → 1.1 (AgX bleaches warm mid-tone stone toward grey; refs' lit stone s 34-46 %)
  uSharpen: { value: 0.28 },     // r4: 0.18 → 0.28 (crisper mid-ground)
  uChroma: { value: 0.0004 },     // lateral chromatic aberration at the edges (r4: 0.0012 fringed ridges / wall edges)
  uDither: { value: 1.0 },
  uClarity: { value: 0 },        // r5: unused (replaced by the uLtm* local tone mapping)
  // partial auto-exposure: centre-weighted geometric mean of the scene luminance (128x72 log-luminance meter
  // pass), exposure *= (uAutoKey / meter) ^ uAutoExpo, clamped to [0.5, 2]. Keeps every framing near the
  // refs' consistent mid-grey while the cameras change; uAutoExpo 0 = fixed exposure.
  uAutoExpo: { value: 0.9 },
  uAutoKey: { value: 0.17 },     // calibrated: brings all 9 framings to p50 ≈ 86–126 (refs 93–115)
  // lens effects (sun glare / god rays / ghosts), per-shot overridable like any grade uniform
  uLensGlare: { value: 0.55 },
  uLensRays: { value: 0.2 },
  uLensGhost: { value: 0.0 },     // r5: off (ghosts read as green / violet CG dots)
  // r2: highlight expansion above ~0.7 (perceptual) — AgX compresses the top end; refs p98 ≈ 227-242
  uHighlights: { value: 0.0 },    // r5: 0.14 → 0 (pushed large walls / water into clipping; the shoulder handles the top end)
  // r4: saturation boost in the shadows (refs: deep, saturated warm-brown / green shadows, not grey)
  uShadowSat: { value: 0.3 },     // r5b: 0.65 → 0.3 (shaded marble / porches went peach-orange; refs' shaded stone is near-neutral)
  // r4: toe softness: the S-curve exponent below the pivot is uContrast * uToe (refs: deep but open shadows, p10 ≈ 29-39)
  uToe: { value: 0.85 },
  // ---- r5 local tone mapping (log2-luminance bands, see header)
  uLtmFine: { value: 0.2 },       // pixel vs 1/2-res blur (micro texture)
  uLtmMid: { value: 0.45 },        // 1/2 vs 1/8 res (windows, columns, cornices at distance)
  uLtmLarge: { value: 0.3 },      // 1/8 vs 1/32 res (forms: lit vs shaded faces of buildings / rocks)
  uLtmBase: { value: 0.25 },       // compression of the 1/32-res base toward the key (0 = none)
  uLtmClip: { value: 0.6 },       // soft clip of each added band (stops)
  uLtmSigma: { value: 0.9 },      // joint-bilateral range sigma (stops)
  uLtmSky: { value: 0.3 },        // fraction of the local contrast kept on the sky (HDR alpha 0 = sky, see core/sky.js)
  // ---- r5 shoulder: luminance above x rolls off smoothly toward y (perceptual)
  uShoulder: { value: new THREE.Vector2(0.78, 0.96) },
  uHighSat: { value: 0.2 },        // extra saturation in the highlights (AgX bleaches bright warm stone)
  // ---- r5 secondaries (OkLCh hue bands centred at 30 red, 65 orange, 90 yellow, 115 yellow-green,
  //      145 green, 195 cyan, 255 blue, 315 violet degrees)
  uHueShift: { value: uarr([0, 3, -3, -3, 0, 0, 0, -8]) },  // r5b: ochre band toward cream (was -3: peach marble; refs' lit marble sits at OkLCh h 62-87), foliage less yellow, violets bluer
  uHueSat: { value: uarr([0.9, 1.0, 1.0, 0.85, 0.92, 1.1, 0.9, 0.75]) }, // r5b: orange 1.15 → 1.0 (cool cream-ivory marble, refs 1/5/6); yellow-green / green 0.95/1.05 → 0.85/0.92 (foliage chroma 0.05-0.058 vs refs 0.039-0.042)
  uHueLum: { value: uarr([0, 0, -0.02, -0.06, -0.08, 0, 0, 0]) }, // refs: foliage OkL ≈ 0.21-0.33; r5b: most of the darkening now in foliage.js albedo (was -0.03/-0.09/-0.12)
  // ---- r5 auto tone curve (strength 0..1): target sRGB-luminance percentiles p02 / p10 / p50 / p90 / p98 (0..255);
  //      looks.js sets each shot's to its reference's own values (art bible: p02 3-17, p10 23-39, p50 93-115, p90 196-203, p98 227-242)
  uAutoLevels: { value: 0.0 },    // 0 by default (module test scenes); looks.js LV() turns it on for the 9 shots
  uLevelTarget: { value: uarr([9, 31, 103, 199, 236]) },
};

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

function rt(w, h, type, samples = 0, depth = false) {
  return new THREE.WebGLRenderTarget(w, h, {
    type, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: depth, stencilBuffer: false, samples, generateMipmaps: false,
  });
}

/**
 * Auto tone curve: measure the luminance percentiles (p02, p10, p50, p90, p98) of an RGBA8 frame and build a
 * monotone (Fritsch–Carlson) curve through (0,0), the 5 measured → target points and (1,1), blended with the
 * identity by strength s. Returns the curve sampled at LUT_N + 1 points (perceptual luminance in → out).
 * Segment slopes are limited to [0.35, 2.8] so no band is crushed or posterised.
 */
export const LUT_N = 32;
export function solveToneCurve(buf, t5, s) {
  const hist = new Float64Array(256); let n = 0;
  for (let i = 0; i < buf.length; i += 4) { hist[Math.min(255, Math.round(0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]))]++; n++; }
  const pct = (q) => { const k = q * n; let c = 0; for (let i = 0; i < 256; i++) { if (c + hist[i] >= k) return (i + (k - c) / Math.max(1, hist[i]) - 0.5) / 255; c += hist[i]; } return 1; };
  const xs = [0, ...[0.02, 0.1, 0.5, 0.9, 0.98].map(pct), 1];
  const ys = [0, ...t5.map((v) => v / 255), 1];
  for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + 0.004);
  if (xs[xs.length - 1] > 1) { const k = 1 / xs[xs.length - 1]; for (let i = 0; i < xs.length; i++) xs[i] *= k; }
  xs[xs.length - 1] = 1;
  // limit segment slopes (re-target y, keep monotone)
  for (let i = 1; i < ys.length; i++) {
    const dx = xs[i] - xs[i - 1];
    ys[i] = Math.min(ys[i - 1] + dx * 2.8, Math.max(ys[i - 1] + dx * 0.35, ys[i]));
  }
  if (ys[ys.length - 1] !== 1) { const k = 1 / ys[ys.length - 1]; for (let i = 0; i < ys.length; i++) ys[i] *= k; }
  // Fritsch–Carlson tangents
  const m = xs.length, d = [], t = new Array(m);
  for (let i = 0; i < m - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  t[0] = d[0]; t[m - 1] = d[m - 2];
  for (let i = 1; i < m - 1; i++) t[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]); // harmonic mean
  const out = new Array(LUT_N + 1);
  for (let j = 0; j <= LUT_N; j++) {
    const x = j / LUT_N; let i = 0;
    while (i < m - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], u = (x - xs[i]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    const y = h00 * ys[i] + h10 * h * t[i] + h01 * ys[i + 1] + h11 * h * t[i + 1];
    out[j] = x + (Math.min(1, Math.max(0, y)) - x) * s;
  }
  for (let j = 1; j <= LUT_N; j++) out[j] = Math.max(out[j], out[j - 1]);
  return out;
}

export class Pipeline {
  constructor(renderer, w, h, quality) {
    this.renderer = renderer;
    this.w = w; this.h = h;
    this.quality = quality;
    const gl = renderer.getContext();
    const floatOK = !!gl.getExtension('EXT_color_buffer_float');
    this.accType = floatOK ? THREE.FloatType : THREE.HalfFloatType;
    this.sceneRT = rt(w, h, THREE.HalfFloatType, quality.msaa || 0, true);
    this.acc = [rt(w, h, this.accType), rt(w, h, this.accType)];
    this.accIndex = 0;
    this.count = 0;
    this.quad = new FullScreenQuad(null);

    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tNew: { value: null }, tPrev: { value: null }, uW: { value: 1 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tNew; uniform sampler2D tPrev; uniform float uW; varying vec2 vUv;
        void main(){
          vec4 n = texture2D(tNew, vUv);
          n.rgb = min(n.rgb, vec3(6.0e4)); // guard inf
          if (any(isnan(n.rgb))) n.rgb = vec3(0.0);
          vec4 p = texture2D(tPrev, vUv);
          gl_FragColor = mix(p, n, uW);
        }`,
      depthTest: false, depthWrite: false,
    });

    // ---- bloom mip chain
    this.mips = [];
    let mw = w, mh = h;
    for (let i = 0; i < 7; i++) {
      mw = Math.max(1, Math.floor(mw / 2)); mh = Math.max(1, Math.floor(mh / 2));
      this.mips.push(rt(mw, mh, THREE.HalfFloatType));
    }
    this.downMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uClamp: { value: 1e4 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst; uniform float uClamp; varying vec2 vUv;
        vec3 s(vec2 o){ return texture2D(tSrc, vUv + o * uTexel).rgb; }
        float kw(vec3 c){ return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
        void main(){
          // 13-tap downsample (Jimenez 2014), Karis average on the first mip to kill fireflies
          vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
          vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
          vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
          vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
          vec3 r;
          if (uFirst > 0.5) {
            vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
            float w0 = kw(g0), w1 = kw(g1), w2 = kw(g2), w3 = kw(g3), w4 = kw(g4);
            r = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) / (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
            // r5b: luminance clamp (the sun disk otherwise floods the 1/64-1/128 mips → a large disc with a visible rim, shot 7)
            float rl = dot(r, vec3(0.2126, 0.7152, 0.0722)); if (rl > uClamp) r *= uClamp / rl;
          } else {
            r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
          }
          gl_FragColor = vec4(r, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.upMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
        vec3 s(vec2 o){ return texture2D(tSrc, vUv + o * uTexel * uRadius).rgb; }
        void main(){
          vec3 r = s(vec2(0,0)) * 4.0 + (s(vec2(-1,0)) + s(vec2(1,0)) + s(vec2(0,-1)) + s(vec2(0,1))) * 2.0
                 + s(vec2(-1,-1)) + s(vec2(1,-1)) + s(vec2(-1,1)) + s(vec2(1,1));
          gl_FragColor = vec4(r / 16.0, 1.0);
        }`,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });

    // ---- r5 local tone mapping: log2-luminance pyramid (1/2 … 1/64 res)
    this.ltm = [];
    let lw = w, lh = h;
    for (let i = 0; i < 7; i++) {
      lw = Math.max(1, Math.floor(lw / 2)); lh = Math.max(1, Math.floor(lh / 2));
      this.ltm.push(rt(lw, lh, THREE.HalfFloatType));
    }
    this.ltmLumMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        float ll(vec2 o){ return log2(max(dot(texture2D(tSrc, vUv + o * uTexel).rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-5)); }
        void main(){
          // 4 bilinear taps = 4x4 full-res pixels, geometric mean
          float v = 0.25 * (ll(vec2(-0.5, -0.5)) + ll(vec2(0.5, -0.5)) + ll(vec2(-0.5, 0.5)) + ll(vec2(0.5, 0.5)));
          gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
        }`,
    });

    this.gradeMat = new THREE.ShaderMaterial({
      uniforms: {
        ...GRADE,
        tHDR: { value: null }, tBloom: { value: null },
        tLens: { value: null }, uLensOn: { value: 0 }, // optional sun glare / god rays (LensFX)
        tMeter: { value: null }, uMeterOn: { value: 0 },
        tL0: { value: null }, tL2: { value: null }, tL4: { value: null }, uLtmOn: { value: 0 },
        uTx0: { value: new THREE.Vector2() }, uTx2: { value: new THREE.Vector2() }, uTx4: { value: new THREE.Vector2() },
        uLevelsOn: { value: 0 }, uLut: { value: new Float32Array(LUT_N + 1) },
        uBloomNorm: { value: 1 / 7 },
        uRes: { value: new THREE.Vector2(w, h) }, uFrame: { value: 0 },
        toneMappingExposure: { value: 1.0 },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        #include <tonemapping_pars_fragment>
        uniform sampler2D tHDR; uniform sampler2D tBloom;
        uniform sampler2D tLens; uniform float uLensOn;
        uniform vec2 uRes; uniform float uFrame;
        uniform float uHighlights;
        uniform float uExposure; uniform vec3 uWhiteBalance; uniform float uContrast; uniform float uSaturation; uniform float uVibrance;
        uniform vec3 uLift; uniform vec3 uGamma; uniform vec3 uGain; uniform vec2 uVignette; uniform float uGrain;
        uniform float uBloom; uniform float uToneMap; uniform float uAgxPunch; uniform float uSharpen; uniform float uChroma; uniform float uDither;
        uniform float uShadowSat; uniform float uToe; uniform float uPivot; uniform vec3 uShadowTint; uniform vec3 uHighTint; uniform float uBloomNorm; uniform float uClarity;
        uniform sampler2D tMeter; uniform float uMeterOn; uniform float uAutoExpo; uniform float uAutoKey;
        uniform sampler2D tL0; uniform sampler2D tL2; uniform sampler2D tL4; uniform float uLtmOn;
        uniform vec2 uTx0; uniform vec2 uTx2; uniform vec2 uTx4;
        uniform float uLtmFine; uniform float uLtmMid; uniform float uLtmLarge; uniform float uLtmBase; uniform float uLtmClip; uniform float uLtmSigma; uniform float uLtmSky;
        uniform vec2 uShoulder; uniform float uHighSat;
        uniform float uHueShift[8]; uniform float uHueSat[8]; uniform float uHueLum[8];
        uniform float uLut[${LUT_N + 1}]; uniform float uLevelsOn;
        float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
        // auto tone curve on perceptual luminance (chroma ratios kept, soft gamut squeeze toward white)
        vec3 toneCurve(vec3 o){
          float l = luma(o);
          float x = clamp(l, 0.0, 1.0) * ${LUT_N}.0;
          int i = int(min(floor(x), ${LUT_N - 1}.0));
          float fl = mix(uLut[i], uLut[i + 1], x - float(i));
          vec3 r = o * (fl / max(l, 1e-4));
          float mx = max(max(r.r, r.g), r.b);
          if (mx > 1.0) r = mix(vec3(fl), r, (1.0 - fl) / max(mx - fl, 1e-4));
          return r;
        }
        varying vec2 vUv;
        vec3 toPerc(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0031308)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
        // cubic B-spline weight
        float bsw(float x){ x = abs(x); return x < 1.0 ? (4.0 - 6.0 * x * x + 3.0 * x * x * x) / 6.0 : (x < 2.0 ? (2.0 - x) * (2.0 - x) * (2.0 - x) / 6.0 : 0.0); }
        // joint-bilateral B-spline upsample of a low-res log-luminance level, guided by ref (stops)
        float bilat(sampler2D t, vec2 tx, float ref){
          vec2 p = vUv / tx - 0.5; vec2 f = fract(p); vec2 b = (floor(p) + 0.5) * tx;
          float s = 0.0, w = 0.0, s0 = 0.0, w0 = 0.0;
          for (int j = -1; j <= 2; j++) for (int i = -1; i <= 2; i++) {
            float v = texture2D(t, b + vec2(float(i), float(j)) * tx).r;
            float ws = bsw(float(i) - f.x) * bsw(float(j) - f.y);
            float d = (v - ref) / uLtmSigma;
            float ww = ws * exp(-0.5 * d * d);
            s += v * ww; w += ww; s0 += v * ws; w0 += ws;
          }
          return w > 1e-4 * w0 ? s / w : s0 / w0;
        }
        float softClip(float x, float t){ return t * tanh(x / t); }
        // OkLab (Björn Ottosson)
        vec3 lin2ok(vec3 c){
          vec3 lms = mat3(0.4122214708, 0.2119034982, 0.0883024619, 0.5363325363, 0.6806995451, 0.2817188376, 0.0514459929, 0.1073969566, 0.6299787005) * c;
          lms = pow(max(lms, vec3(0.0)), vec3(1.0 / 3.0));
          return mat3(0.2104542553, 1.9779984951, 0.0259040371, 0.7936177850, -2.4285922050, 0.7827717662, -0.0040720468, 0.4505937099, -0.8086757660) * lms;
        }
        vec3 ok2lin(vec3 L){
          vec3 lms = mat3(1.0, 1.0, 1.0, 0.3963377774, -0.1055613458, -0.0894841775, 0.2158037573, -0.0638541728, -1.2914855480) * L;
          lms = lms * lms * lms;
          return mat3(4.0767416621, -1.2684380046, -0.0041960863, -3.3077115913, 2.6097574011, -0.7034186147, 0.2309699292, -0.3413193965, 1.7076147010) * lms;
        }
        vec3 toLin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
        // hue secondaries: smooth partition of unity over 8 band centres (OkLCh degrees)
        vec3 secondaries(vec3 o){
          vec3 L = lin2ok(toLin(clamp(o, 0.0, 1.0)));
          float C = length(L.yz);
          float gate = smoothstep(0.004, 0.022, C);
          if (gate <= 0.0) return o;
          float h = degrees(atan(L.z, L.y)); if (h < 0.0) h += 360.0;
          float HC[9]; HC[0] = 30.0; HC[1] = 65.0; HC[2] = 90.0; HC[3] = 115.0; HC[4] = 145.0; HC[5] = 195.0; HC[6] = 255.0; HC[7] = 315.0; HC[8] = 390.0;
          float hh = h < 30.0 ? h + 360.0 : h;
          float sh = 0.0, sa = 1.0, lu = 0.0;
          for (int i = 0; i < 8; i++) {
            if (hh >= HC[i] && hh < HC[i + 1]) {
              int j = i == 7 ? 0 : i + 1;
              float t = smoothstep(0.0, 1.0, (hh - HC[i]) / (HC[i + 1] - HC[i]));
              sh = mix(uHueShift[i], uHueShift[j], t); sa = mix(uHueSat[i], uHueSat[j], t); lu = mix(uHueLum[i], uHueLum[j], t);
            }
          }
          float nh = radians(h + sh * gate);
          float nC = C * mix(1.0, sa, gate);
          vec3 N = vec3(L.x + lu * gate, nC * cos(nh), nC * sin(nh));
          return toPerc(clamp(ok2lin(N), 0.0, 1.0));
        }
        float meterLum(){
          // tMeter holds mean log-luminance per cell (128x72); centre-weighted geometric mean
          float s = 0.0, w = 0.0;
          for (int i = 0; i < 12; i++) for (int j = 0; j < 8; j++) {
            vec2 uv = vec2((float(i) + 0.5) / 12.0, (float(j) + 0.5) / 8.0);
            float wt = 1.0 + 1.5 * max(0.0, 1.0 - length((uv - 0.5) * vec2(1.6, 2.0)));
            s += wt * texture2D(tMeter, uv).r; w += wt;
          }
          return exp(s / w);
        }
        // power S-curve: slope k at pivot m, f(0)=0, f(1)=1, C1-continuous
        float sCurve(float x, float m, float k){
          x = clamp(x, 0.0, 1.0);
          return x < m ? m * pow(x / m, max(1.0, k * uToe)) : 1.0 - (1.0 - m) * pow((1.0 - x) / (1.0 - m), k);
        }
        vec3 acesFit(vec3 v){
          const mat3 I = mat3(0.59719,0.07600,0.02840, 0.35458,0.90834,0.13383, 0.04823,0.01566,0.83777);
          const mat3 O = mat3(1.60475,-0.10208,-0.00327, -0.53108,1.10813,-0.07276, -0.07367,-0.00605,1.07602);
          v = I * v; vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
          return clamp(O * (a / b), 0.0, 1.0);
        }
        float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        vec3 sampleHDR(vec2 uv){
          // lateral chromatic aberration grows toward the frame edge
          vec2 d = (uv - 0.5);
          float k = uChroma * dot(d, d) * 4.0;
          return vec3(texture2D(tHDR, uv - d * k).r, texture2D(tHDR, uv).g, texture2D(tHDR, uv + d * k).b);
        }
        void main(){
          vec2 px = 1.0 / uRes;
          vec3 c = sampleHDR(vUv);
          // unsharp mask (restores crispness lost to supersampling)
          vec3 blur = (texture2D(tHDR, vUv + vec2(px.x, 0.0)).rgb + texture2D(tHDR, vUv - vec2(px.x, 0.0)).rgb
                     + texture2D(tHDR, vUv + vec2(0.0, px.y)).rgb + texture2D(tHDR, vUv - vec2(0.0, px.y)).rgb) * 0.25;
          c = max(c + (c - blur) * uSharpen, vec3(0.0));
          // bloom: the mip chain sums ~7 octaves → normalise so uBloom is the veil fraction
          vec3 bl = texture2D(tBloom, vUv).rgb * uBloomNorm;
          float mL = uMeterOn > 0.5 ? meterLum() : 0.18;
          // r5 local tone mapping: add soft-clipped detail bands of log-luminance, compress the base
          if (uLtmOn > 0.5) {
            float Y = log2(max(luma(c), 1e-5));
            float F = texture2D(tL0, vUv).r;
            float M = bilat(tL2, uTx2, F);
            float B = bilat(tL4, uTx4, F);
            float K = uMeterOn > 0.5 ? log2(max(mL, 1e-5)) : B;
            float dY = uLtmFine * softClip(Y - F, uLtmClip) + uLtmMid * softClip(F - M, uLtmClip)
                     + uLtmLarge * softClip(M - B, uLtmClip) - uLtmBase * (B - K);
            float cover = clamp(texture2D(tHDR, vUv).a, 0.0, 1.0);
            c *= exp2(clamp(dY * mix(uLtmSky, 1.0, cover), -2.5, 2.5));
          }
          c = mix(c, bl, uBloom);
          if (uLensOn > 0.5) c += texture2D(tLens, vUv).rgb;
          float autoE = (uMeterOn > 0.5 && uAutoExpo > 0.0) ? clamp(pow(uAutoKey / mL, uAutoExpo), 0.5, 2.0) : 1.0;
          c *= uExposure * autoE * uWhiteBalance;
          // vignette (scene-linear: behaves like lens fall-off)
          vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
          float v = smoothstep(uVignette.y * 1.25, uVignette.y * 0.3, length(q));
          c *= mix(1.0 - uVignette.x, 1.0, v);
          // tone map → linear display 0..1
          if (uToneMap < 0.5) c = acesFit(c * 0.6 * 1.6667);
          else if (uToneMap < 1.5) {
            c = AgXToneMapping(c);
            // "punchy" look: saturation boost after the AgX base curve
            c = max(mix(vec3(luma(c)), c, uAgxPunch), 0.0);
          } else c = NeutralToneMapping(c);
          // ---- grade in perceptual (sRGB-encoded) space
          vec3 o = toPerc(clamp(c, 0.0, 1.0));
          o = o * uGain;
          o = pow(max(o, 0.0), 1.0 / uGamma);
          o = vec3(sCurve(o.r, uPivot, uContrast), sCurve(o.g, uPivot, uContrast), sCurve(o.b, uPivot, uContrast));
          o += uHighlights * smoothstep(vec3(0.7), vec3(1.0), o) * (1.0 - o * 0.5);
          // r5 shoulder: large bright areas roll off below white (texture survives) instead of clipping
          float lo = luma(o);
          if (lo > uShoulder.x) {
            float kn = uShoulder.x, mx = max(uShoulder.y, kn + 1e-3);
            o *= (kn + (mx - kn) * (1.0 - exp(-(lo - kn) / (mx - kn)))) / lo;
          }
          o = o + uLift * (1.0 - o);   // black level / shadow tint after the S-curve (refs never crush to 0)
          float l = luma(o);
          // split toning (cool shadows / warm highlights), weighted by perceptual luminance
          o += uShadowTint * (1.0 - smoothstep(0.0, 0.55, l)) + uHighTint * smoothstep(0.45, 1.0, l);
          l = luma(o);
          float sat = max(max(o.r, o.g), o.b) - min(min(o.r, o.g), o.b);
          o = mix(vec3(l), o, uSaturation + uVibrance * (1.0 - sat) + uShadowSat * (1.0 - smoothstep(0.08, 0.5, l)) + uHighSat * smoothstep(0.5, 0.92, l));
          o = clamp(o, 0.0, 1.0);
          // r5 hue secondaries (OkLCh)
          o = secondaries(o);
          // r5 levels (black, white, mid gamma), solved by the auto-levels measurement in resolve()
          if (uLevelsOn > 0.5) o = toneCurve(o);
          // film grain + dither
          float g = h12(gl_FragCoord.xy + uFrame * 17.31) - 0.5;
          o += g * uGrain * (1.0 - o * 0.6);
          o += (h12(gl_FragCoord.xy * 1.37 + 5.1) - 0.5) / 255.0 * uDither;
          gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
  }

  get target() { return this.sceneRT; }

  begin() { this.count = 0; }

  /** render one sub-frame of the scene and fold it into the running average */
  addSample(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.info.autoReset = false;
    r.info.reset();
    r.render(scene, camera);
    this.sceneInfo = { calls: r.info.render.calls, triangles: r.info.render.triangles };
    const src = this.acc[this.accIndex], dst = this.acc[1 - this.accIndex];
    this.copyMat.uniforms.tNew.value = this.sceneRT.texture;
    this.copyMat.uniforms.tPrev.value = src.texture;
    this.copyMat.uniforms.uW.value = 1 / (this.count + 1);
    this.quad.material = this.copyMat;
    r.setRenderTarget(dst);
    this.quad.render(r);
    this.accIndex = 1 - this.accIndex;
    this.count++;
  }

  /** current accumulated HDR texture */
  get hdr() { return this.acc[this.accIndex].texture; }

  _bloom() {
    const r = this.renderer;
    this.quad.material = this.downMat;
    let src = this.hdr, sw = this.w, sh = this.h;
    for (let i = 0; i < this.mips.length; i++) {
      this.downMat.uniforms.tSrc.value = src;
      this.downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      this.downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
      this.downMat.uniforms.uClamp.value = GRADE.uBloomClamp.value;
      r.setRenderTarget(this.mips[i]);
      this.quad.render(r);
      src = this.mips[i].texture; sw = this.mips[i].width; sh = this.mips[i].height;
    }
    this.quad.material = this.upMat;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const s = this.mips[i];
      this.upMat.uniforms.tSrc.value = s.texture;
      this.upMat.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
      r.setRenderTarget(this.mips[i - 1]);
      this.quad.render(r); // additive
    }
    return this.mips[0].texture;
  }

  /** bloom + grade + output to the canvas (or a target) */
  resolve(target = null, frame = 0) {
    const r = this.renderer;
    const bloom = this.quality.bloom ? this._bloom() : this.hdr;
    // optional lens effects (sun glare, ghosts, god rays) — see LensFX below
    try {
      this.lensFX ||= new LensFX(r, this.w, this.h, this.quad);
      const lt = this.lensFX.render(this.hdr);
      this.gradeMat.uniforms.tLens.value = lt;
      this.gradeMat.uniforms.uLensOn.value = lt ? 1 : 0;
    } catch (e) { this.gradeMat.uniforms.uLensOn.value = 0; }
    this.gradeMat.uniforms.tHDR.value = this.hdr;
    this.gradeMat.uniforms.tBloom.value = bloom;
    this.gradeMat.uniforms.uBloomNorm.value = this.quality.bloom ? 1 / this.mips.length : 1;
    // exposure meter: 128x72 grid of mean log-luminance (16 bilinear taps per cell) of the accumulated HDR
    // r5b (video): taps are clamped (the sun disk / speculars no longer swing the log-average when leaves move across
    // the sun) and the meter is temporally smoothed (EMA, like the auto tone curve) on consecutive frames
    if (GRADE.uAutoExpo.value > 0) {
      this.meterRTs ||= [rt(128, 72, THREE.HalfFloatType), rt(128, 72, THREE.HalfFloatType)];
      this.meterMat ||= new THREE.ShaderMaterial({
        uniforms: { tSrc: { value: null }, tPrev: { value: null }, uW: { value: 1 } }, vertexShader: FS_VERT, depthTest: false, depthWrite: false,
        fragmentShader: /* glsl */ `
          uniform sampler2D tSrc; uniform sampler2D tPrev; uniform float uW; varying vec2 vUv;
          void main(){
            float s = 0.0; vec2 cell = vec2(1.0 / 128.0, 1.0 / 72.0);
            for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
              vec2 uv = vUv + (vec2(float(i), float(j)) + 0.5 - 2.0) * 0.25 * cell;
              s += log(clamp(dot(texture2D(tSrc, uv).rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-4, 48.0));
            }
            float m = s / 16.0;
            if (uW < 1.0) m = mix(texture2D(tPrev, vUv).r, m, uW);
            gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
          }`,
      });
      const mp = this._meter, smooth = !!mp && frame === mp.frame + 1;
      const k = smooth ? 1 - mp.k : (this._meterK || 0);
      this.meterMat.uniforms.tSrc.value = this.hdr;
      this.meterMat.uniforms.tPrev.value = this.meterRTs[1 - k].texture;
      this.meterMat.uniforms.uW.value = smooth ? 0.25 : 1;
      this.quad.material = this.meterMat;
      r.setRenderTarget(this.meterRTs[k]);
      this.quad.render(r);
      this.meterRT = this.meterRTs[k];
      this._meter = { frame, k }; this._meterK = k;
    }
    this.gradeMat.uniforms.tMeter.value = this.meterRT ? this.meterRT.texture : null;
    this.gradeMat.uniforms.uMeterOn.value = GRADE.uAutoExpo.value > 0 && this.meterRT ? 1 : 0;
    this.gradeMat.uniforms.uFrame.value = frame;
    const U = this.gradeMat.uniforms;
    // r5 local tone mapping pyramid (band scales follow the output resolution: 4K uses one level coarser)
    const ltmOn = GRADE.uLtmFine.value || GRADE.uLtmMid.value || GRADE.uLtmLarge.value || GRADE.uLtmBase.value;
    U.uLtmOn.value = ltmOn ? 1 : 0;
    if (ltmOn) {
      this.ltmLumMat.uniforms.tSrc.value = this.hdr;
      this.ltmLumMat.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      this.quad.material = this.ltmLumMat;
      r.setRenderTarget(this.ltm[0]); this.quad.render(r);
      this.quad.material = this.downMat;
      this.downMat.uniforms.uFirst.value = 0;
      for (let i = 1; i < this.ltm.length; i++) {
        const s = this.ltm[i - 1];
        this.downMat.uniforms.tSrc.value = s.texture;
        this.downMat.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
        r.setRenderTarget(this.ltm[i]); this.quad.render(r);
      }
      const off = Math.max(0, Math.min(2, Math.round(Math.log2(this.w / 1672))));
      const lv = (k) => this.ltm[Math.min(this.ltm.length - 1, k + off)];
      [[U.tL0, U.uTx0, 0], [U.tL2, U.uTx2, 2], [U.tL4, U.uTx4, 4]].forEach(([t, tx, k]) => { const L = lv(k); t.value = L.texture; tx.value.set(1 / L.width, 1 / L.height); });
    }
    // r5 auto tone curve: grade at 1/4 res without it, measure luminance percentiles, solve the curve
    const S = GRADE.uAutoLevels.value;
    if (S > 0) {
      const qw = Math.max(16, Math.floor(this.w / 4)), qh = Math.max(16, Math.floor(this.h / 4));
      if (!this.lvRT || this.lvRT.width !== qw || this.lvRT.height !== qh) {
        this.lvRT?.dispose();
        this.lvRT = new THREE.WebGLRenderTarget(qw, qh, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false });
        this.lvBuf = new Uint8Array(qw * qh * 4);
      }
      U.uLevelsOn.value = 0;
      this.quad.material = this.gradeMat;
      r.setRenderTarget(this.lvRT); this.quad.render(r);
      r.readRenderTargetPixels(this.lvRT, 0, 0, qw, qh, this.lvBuf);
      let v = solveToneCurve(this.lvBuf, GRADE.uLevelTarget.value, S);
      const prev = this._lv;
      if (prev && frame === prev.frame + 1) v = v.map((x, i) => prev.v[i] + (x - prev.v[i]) * 0.2); // video: smooth
      this._lv = { frame, v };
      U.uLut.value.set(v);
      U.uLevelsOn.value = 1;
    } else U.uLevelsOn.value = 0;
    this.quad.material = this.gradeMat;
    r.setRenderTarget(target);
    this.quad.render(r);
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.sceneRT.setSize(w, h);
    this.acc.forEach((a) => a.setSize(w, h));
    let mw = w, mh = h;
    for (const m of this.mips) { mw = Math.max(1, Math.floor(mw / 2)); mh = Math.max(1, Math.floor(mh / 2)); m.setSize(mw, mh); }
    let lw = w, lh = h;
    for (const m of this.ltm) { lw = Math.max(1, Math.floor(lw / 2)); lh = Math.max(1, Math.floor(lh / 2)); m.setSize(lw, lh); }
    this.gradeMat.uniforms.uRes.value.set(w, h);
  }
}

// =====================================================================================
// Optional lens effects (owned by the sky/light module): sun glare + starburst, lens ghosts and
// screen-space god rays. Driven by LENS uniforms; lighting.js sets the sun's screen position each
// sub-frame. Works on the accumulated HDR image at quarter resolution, so occlusion by geometry
// (columns, leaves) comes for free: only bright sky pixels near the sun emit rays.
// Set LENS.uEnabled.value = 0 (or per-shot grade-like overrides via engine code) to disable.
export const LENS = {
  uEnabled: { value: 1 },
  uSunPos: { value: new THREE.Vector2(-10, -10) }, // sun position in uv (0..1), may be off-screen
  uSunFacing: { value: -1 },                        // cos(camera forward, sun)
  uSunTint: { value: new THREE.Vector3(1, 0.9, 0.75) },
  uSunRadius: { value: 0.005 },                     // sun disk radius in uv-height units
  uAspect: { value: 16 / 9 },
  uThresh: { value: 5.0 },     // HDR luminance where the sky starts emitting rays (only the sun core / bright aureole)
  uRays: GRADE.uLensRays,      // god-ray strength (shared with GRADE → per-shot overridable)
  uRayLen: { value: 0.85 },    // fraction of the distance to the sun that rays are integrated over
  uGlare: GRADE.uLensGlare,    // sun glow + starburst strength (scaled by sun visibility)
  uGhost: GRADE.uLensGhost,    // lens ghost strength
};

const LENS_MASK = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform vec2 uSunPos; uniform float uAspect; uniform float uThresh;
varying vec2 vUv;
void main(){
  vec3 c = 0.25 * (texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
                 + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThresh, uThresh * 2.5, l);
  vec2 d = (vUv - uSunPos) * vec2(uAspect, 1.0);
  float nearSun = exp(-dot(d, d) / (2.0 * 0.14 * 0.14)); // tight: streaks through occluders, not a global veil
  c = c / max(l, 1e-4) * min(l, 30.0);
  gl_FragColor = vec4(c * k * nearSun, 1.0);
}`;

const LENS_RADIAL = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uSunPos; uniform float uLen; uniform float uDecay;
varying vec2 vUv;
void main(){
  vec2 st = (uSunPos - vUv) * uLen / 40.0;
  vec2 uv = vUv; vec3 acc = vec3(0.0); float w = 1.0, ws = 0.0;
  for (int i = 0; i < 40; i++) {
    vec2 q = clamp(uv, vec2(0.001), vec2(0.999));
    acc += texture2D(tSrc, q).rgb * w; ws += w; w *= uDecay; uv += st;
  }
  gl_FragColor = vec4(acc / ws, 1.0);
}`;

const LENS_COMPOSE = /* glsl */ `
uniform sampler2D tRays; uniform sampler2D tMask; uniform sampler2D tHDR;
uniform vec2 uSunPos; uniform float uAspect; uniform vec3 uSunTint; uniform float uSunRadius;
uniform float uRays; uniform float uGlare; uniform float uGhost; uniform float uSunFacing;
varying vec2 vUv;
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main(){
  vec3 col = texture2D(tRays, vUv).rgb * uRays;
  // sun visibility: fraction of the solar disk not hidden by geometry (leaves, columns)
  float vis = 0.0;
  bool onScreen = uSunPos.x > -0.02 && uSunPos.x < 1.02 && uSunPos.y > -0.02 && uSunPos.y < 1.02;
  if (onScreen && uSunFacing > 0.0) {
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 2.3999632, r = sqrt((float(i) + 0.5) / 12.0) * uSunRadius * 0.85;
      vec2 o = vec2(cos(a) * r / uAspect, sin(a) * r);
      vis += smoothstep(40.0, 600.0, lum(texture2D(tHDR, uSunPos + o).rgb));
    }
    vis /= 12.0;
  }
  vec2 d = (vUv - uSunPos) * vec2(uAspect, 1.0);
  float r = length(d);
  float ang = atan(d.y, d.x);
  // starburst (6 blades, diffraction of a hexagonal aperture) + soft veiling glare
  float sp = pow(abs(cos(ang * 3.0 + 0.35)), 160.0) + 0.5 * pow(abs(cos(ang * 3.0 + 0.35 + 0.5236)), 320.0);
  float glare = 0.55 * exp(-r * 11.0) + 0.12 * exp(-r * 4.0) + 0.015 * exp(-r * 1.2) + sp * exp(-r * 6.5) * 0.9;
  col += uSunTint * glare * vis * uGlare;
  // ghosts along the line through the frame centre, chromatic tints
  vec2 gv = vec2(0.5) - uSunPos;
  vec3 tints[4];
  tints[0] = vec3(0.35, 0.55, 1.0); tints[1] = vec3(1.0, 0.75, 0.35); tints[2] = vec3(0.55, 1.0, 0.6); tints[3] = vec3(0.8, 0.5, 1.0);
  for (int i = 0; i < 4; i++) {
    float f = 0.5 + float(i) * 0.48;
    vec2 gp = uSunPos + gv * (1.0 + f);
    float gr = length((vUv - gp) * vec2(uAspect, 1.0));
    float sz = 0.018 + 0.024 * float(i);
    float g = smoothstep(sz, sz * 0.55, gr) * (0.6 + 0.4 * smoothstep(sz * 0.4, sz, gr));
    col += tints[i] * uSunTint * g * vis * uGhost * (0.5 + 0.5 * float(i == 1));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

class LensFX {
  constructor(renderer, w, h, quad) {
    this.r = renderer; this.quad = quad;
    this.size = [0, 0];
    this.mk = (frag, extra = {}) => new THREE.ShaderMaterial({
      uniforms: { ...LENS, ...extra }, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false,
    });
    this.maskMat = this.mk(LENS_MASK, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.radMat = this.mk(LENS_RADIAL, { tSrc: { value: null }, uLen: { value: 1 }, uDecay: { value: 0.97 } });
    this.compMat = this.mk(LENS_COMPOSE, { tRays: { value: null }, tMask: { value: null }, tHDR: { value: null } });
    this.resize(w, h);
  }
  resize(w, h) {
    const qw = Math.max(1, Math.floor(w / 4)), qh = Math.max(1, Math.floor(h / 4));
    if (this.size[0] === qw && this.size[1] === qh) return;
    this.size = [qw, qh];
    this.t?.forEach((t) => t.dispose());
    this.t = [0, 1, 2].map(() => rt(qw, qh, THREE.HalfFloatType));
    this.full = [w, h];
  }
  /** @returns {THREE.Texture|null} lens texture or null when the sun is far off-screen */
  render(hdr) {
    if (!LENS.uEnabled.value) return null;
    const p = LENS.uSunPos.value;
    if (LENS.uSunFacing.value < 0.15 || p.x < -0.6 || p.x > 1.6 || p.y < -0.6 || p.y > 1.6) return null;
    const r = this.r, q = this.quad;
    const img = hdr.image || {};
    if (img.width && img.height) this.resize(img.width, img.height);
    const [w, h] = this.full;
    this.maskMat.uniforms.tSrc.value = hdr;
    this.maskMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    q.material = this.maskMat; r.setRenderTarget(this.t[0]); q.render(r);
    // two radial passes: long + short (rays converge smoothly onto the sun)
    this.radMat.uniforms.tSrc.value = this.t[0].texture; this.radMat.uniforms.uLen.value = LENS.uRayLen.value; this.radMat.uniforms.uDecay.value = 0.975;
    q.material = this.radMat; r.setRenderTarget(this.t[1]); q.render(r);
    this.radMat.uniforms.tSrc.value = this.t[1].texture; this.radMat.uniforms.uLen.value = LENS.uRayLen.value * 0.22; this.radMat.uniforms.uDecay.value = 0.99;
    r.setRenderTarget(this.t[2]); q.render(r);
    this.compMat.uniforms.tRays.value = this.t[2].texture;
    this.compMat.uniforms.tMask.value = this.t[0].texture;
    this.compMat.uniforms.tHDR.value = hdr;
    q.material = this.compMat; r.setRenderTarget(this.t[1]); q.render(r);
    return this.t[1].texture;
  }
}
