// Banners: navy wool cloth with gold embroidery (owl in laurel wreath, ΑΘΗΝΑ), hanging folds and
// gentle deterministic wind (vertex shader driven by engine time). All banners of one style share a
// single merged mesh (1 draw call per style) + one merged gold hardware mesh.
//
//   const set = new BannerSet(engine);
//   set.add({ pos:[x,y,z], facing: 200, height: 6, width: 2, style: 'V', mount: 'wall' });
//   set.build();   // adds meshes to engine.scene, registers the wind animation
//
// Spec fields:
//   pos     [x,y,z]  wall/free: top-centre attach point (the rod).  pole: ground point of the pole.
//   facing  compass deg the front of the banner faces (outward from a wall).
//   height  cloth height incl. fringe (m);  width (m) — default height / style aspect.
//   style   'V' (V-point, plain top) | 'S' (straight hem, gold meander band) | 'L' (long, loops + swags)
//   mount   'wall' (rod on brackets, cloth kept off the wall) | 'free' (between columns) | 'pole' (vexillum stand)
//   wind    0..1 wind strength multiplier (default by mount)
//   seed    variation seed (default from position)
import * as THREE from 'three';
import { drawBanner, bannerLayout } from './bannerArt.js';
import { proceduralMaterial } from '../core/materials.js';
import { goldMaterial, bronzeMaterial, propMarbleMaterial, mergeGeos } from './metals.js';
import { hashString } from '../core/rng.js';

export const BANNER_STYLES = {
  // fringes are long and heavy in the refs (≈ 0.3-0.4 banner widths, ref 9 / ref 2)
  V: { bottom: 'v', header: 'plain', aspect: 3.0, fringe: 0.34 },
  S: { bottom: 'straight', header: 'band', aspect: 2.8, fringe: 0.27 },
  L: { bottom: 'v', header: 'band', sideBand: 0.075, aspect: 3.6, fringe: 0.3 },
  P: { bottom: 'v', header: 'swag', loops: true, aspect: 3.3, fringe: 0.3 },
};

// ------------------------------------------------------------------------------- textures
// fast tileable value noise on a 256 lattice
const PERM = (() => { const p = new Float32Array(65536); let s = 1234567; for (let i = 0; i < 65536; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; p[i] = (s >>> 8) / 16777216; } return p; })();
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const i00 = ((yi & 255) << 8) | (xi & 255), i10 = ((yi & 255) << 8) | ((xi + 1) & 255);
  const i01 = (((yi + 1) & 255) << 8) | (xi & 255), i11 = (((yi + 1) & 255) << 8) | ((xi + 1) & 255);
  const a = PERM[i00] + (PERM[i10] - PERM[i00]) * ux, b = PERM[i01] + (PERM[i11] - PERM[i01]) * ux;
  return a + (b - a) * uy;
}

function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), k = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    let acc = 0; const row = y * W;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc * k;
      acc += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc * k;
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function dataTex(data, W, H, srgb) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.flipY = false;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const texCache = new Map();
/** Build (or fetch) {map, normalMap, ormMap, layout, W, H} for a style key at texture height H. */
export function bannerTextures(styleKey, H = 2048) {
  const key = styleKey + ':' + H;
  if (texCache.has(key)) return texCache.get(key);
  const t0 = performance.now();
  const style = BANNER_STYLES[styleKey] || BANNER_STYLES.V;
  const W = Math.round(H / style.aspect / 4) * 4;
  const cC = canvas(W, H), cH = canvas(W, H), cM = canvas(W, H);
  const layout = drawBanner(cC.getContext('2d'), W, H, 'color', style);
  drawBanner(cH.getContext('2d'), W, H, 'height', style);
  drawBanner(cM.getContext('2d'), W, H, 'mask', style);
  const col = cC.getContext('2d').getImageData(0, 0, W, H).data;
  const hei = cH.getContext('2d').getImageData(0, 0, W, H).data;
  const msk = cM.getContext('2d').getImageData(0, 0, W, H).data;
  const N = W * H;
  const sc = H / 2048; // keep noise sizes in cloth space independent of resolution
  // ---- height with woven fabric micro-structure on the wool
  const h = new Float32Array(N), m = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    m[i] = msk[i * 4] / 255;
    const fab = vnoise(x / (1.4 * sc), y / (5.0 * sc)) * 0.6 + vnoise(x / (5.0 * sc) + 77, y / (1.4 * sc)) * 0.4;
    const slub = vnoise(x / (3 * sc) + 13, y / (40 * sc)) ;
    h[i] = hei[i * 4] / 255 + (1 - m[i]) * (fab - 0.5) * 0.05 + (1 - m[i]) * (slub - 0.5) * 0.03;
  }
  const hs = boxBlur(h, W, H, Math.max(1, Math.round(1 * sc)));
  const hb = boxBlur(boxBlur(h, W, H, Math.max(2, Math.round(6 * sc))), W, H, Math.max(2, Math.round(6 * sc)));
  // ---- outputs (rows flipped so v=1 is the top of the banner)
  const outC = new Uint8Array(N * 4), outN = new Uint8Array(N * 4), outO = new Uint8Array(N * 4);
  const S = (2.6 / sc * 0.5 + 1.3) * 0.62; // normal strength (per-pixel slope scale) — flat satin embroidery, low relief
  const topPx = layout.top * W;
  for (let y = 0; y < H; y++) {
    const fy = H - 1 - y;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, o = (fy * W + x) * 4;
      const a = col[i * 4 + 3];
      const mm = m[i];
      // colour: wool mottling + thread irregularity
      const mott = vnoise(x / (90 * sc), y / (140 * sc)) * 0.6 + vnoise(x / (25 * sc) + 31, y / (25 * sc)) * 0.4;
      const fib = vnoise(x / (1.6 * sc) + 5, y / (3.5 * sc));
      const kNavy = 0.86 + 0.2 * mott + 0.08 * (fib - 0.5);
      const kGold = 0.93 + 0.12 * fib;
      const k = kNavy + (kGold - kNavy) * mm;
      if (a < 128) {
        // keep sensible colours in the cut-out areas so mipmaps don't bleed black into the edges
        const navy = y < topPx;
        outC[o] = navy ? 28 : 150; outC[o + 1] = navy ? 38 : 112; outC[o + 2] = navy ? 80 : 52; outC[o + 3] = a;
      } else {
        outC[o] = Math.min(255, col[i * 4] * k); outC[o + 1] = Math.min(255, col[i * 4 + 1] * k); outC[o + 2] = Math.min(255, col[i * 4 + 2] * k); outC[o + 3] = a;
      }
      // normal
      const xl = x > 0 ? i - 1 : i, xr = x < W - 1 ? i + 1 : i, yu = y > 0 ? i - W : i, yd = y < H - 1 ? i + W : i;
      const dx = (hs[xr] - hs[xl]) * S, dy = (hs[yd] - hs[yu]) * S;
      const il = 1 / Math.hypot(dx, dy, 1);
      outN[o] = (-dx * il * 0.5 + 0.5) * 255; outN[o + 1] = (dy * il * 0.5 + 0.5) * 255; outN[o + 2] = (il * 0.5 + 0.5) * 255; outN[o + 3] = 255;
      // ORM: ambient occlusion around the raised embroidery, roughness, metalness
      const ao = Math.min(1, Math.max(0.45, 1 - 1.8 * Math.max(0, hb[i] - hs[i])));
      // gold thread: satin (rough ~0.45), only partly metallic → reads as pale embroidered gold, not cast metal
      const rough = mm > 0.5 ? 0.42 + 0.18 * fib + 0.14 * Math.max(0, 0.7 - hs[i]) : 0.84 + 0.1 * mott;
      outO[o] = ao * 255; outO[o + 1] = Math.min(1, rough) * 255; outO[o + 2] = mm * 0.38 * 255; outO[o + 3] = 255;
    }
  }
  const res = {
    map: dataTex(outC, W, H, true), normalMap: dataTex(outN, W, H, false), ormMap: dataTex(outO, W, H, false),
    layout, W, H, style,
  };
  texCache.set(key, res);
  console.log(`[banners] texture ${styleKey} ${W}x${H} in ${Math.round(performance.now() - t0)} ms`);
  return res;
}

// ------------------------------------------------------------------------------- cloth material
const WIND_GLSL = /* glsl */`
float cgClothWave(float u, float s, float ph, float t){
  float w = 0.55 * sin(1.55 * t + 5.5 * u + ph - 2.2 * s)
          + 0.30 * sin(2.85 * t - 8.5 * u + 1.7 * ph + 3.8 * s)
          + 0.15 * sin(5.10 * t + 14.0 * u + 2.3 * ph - 6.0 * s);
  return pow(max(s, 0.0), 1.25) * w + 0.55 * s * sin(0.72 * t + ph);
}
`;

export const BANNER_TIME = { value: 0 };

function clothMaterial(tex, styleKey) {
  const mat = proceduralMaterial({
    type: 'physical',
    name: 'bannerCloth_' + styleKey,
    params: {
      map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(1, 1),
      roughnessMap: tex.ormMap, metalnessMap: tex.ormMap, aoMap: tex.ormMap, aoMapIntensity: 0.9,
      roughness: 1, metalness: 1, color: 0xffffff,
      sheen: 1.0, sheenColor: new THREE.Color(0.03, 0.036, 0.065), sheenRoughness: 0.5,
      side: THREE.DoubleSide, alphaTest: 0.5,
    },
    uniforms: { uBannerTime: BANNER_TIME },
    vertexHead: /* glsl */`
      attribute vec4 aClothA; attribute vec4 aClothB;
      uniform float uBannerTime;
      varying vec4 vClothA;
      ${WIND_GLSL}`,
    vertexPre: /* glsl */`
      vClothA = aClothA;
      float cu = aClothA.x, cs = aClothA.y, cph = aClothA.z, camp = aClothA.w;
      float e = 0.02;
      float w0 = cgClothWave(cu, cs, cph, uBannerTime);
      float wu = cgClothWave(cu + e, cs, cph, uBannerTime);
      float ws = cgClothWave(cu, cs + e, cph, uBannerTime);
      vec3 cN = vec3(aClothB.x, 0.0, aClothB.y);
      vec3 cR = vec3(aClothB.y, 0.0, -aClothB.x);
      transformed += cN * (camp * w0);
      float ddx = camp * (wu - w0) / e / max(aClothB.z, 0.1);
      float dds = camp * (ws - w0) / e / max(aClothB.w, 0.1);
      #ifndef FLAT_SHADED
        vNormal = normalize(normalMatrix * normalize(objectNormal - ddx * cR + dds * vec3(0.0, 1.0, 0.0)));
      #endif`,
    head: /* glsl */`varying vec4 vClothA;`,
    color: /* glsl */`
      float gold = smoothstep(0.03, 0.15, diffuseColor.r - diffuseColor.b);
      float sd = fract(vClothA.z * 0.15915 * 7.31);
      vec3 c = diffuseColor.rgb;
      // navy: per-banner dye lot / sun fading
      vec3 tint = mix(vec3(0.9, 0.94, 1.08), vec3(1.12, 1.1, 1.02), sd);
      vec3 cn = c * tint;
      float fade = smoothstep(0.65, 1.0, sd) * 0.3;
      cn = mix(cn, vec3(cgLuma(cn)) * vec3(0.85, 0.95, 1.25) * 1.35, fade);
      // dust & weather stains toward the hem, a few water streaks
      float st = cgVnoise2(vClothA.xy * vec2(7.0, 22.0) + sd * 13.0);
      float dirt = smoothstep(0.55, 1.0, vClothA.y) * (0.45 + 0.55 * st);
      float streak = smoothstep(0.7, 0.95, cgVnoise2(vec2(vClothA.x * 26.0 + sd * 40.0, vClothA.y * 1.5))) * smoothstep(0.1, 0.6, vClothA.y) * 0.5;
      cn *= 1.0 - 0.2 * dirt - 0.12 * streak;
      vec3 cg = c * mix(vec3(1.04, 1.0, 0.92), vec3(0.94, 0.95, 1.0), sd) * (1.0 - 0.12 * dirt);
      cg = mix(cg, vec3(cgLuma(cg)) * vec3(1.12, 1.0, 0.78), 0.22); // muted, paler thread gold
      diffuseColor.rgb = mix(cn, cg, gold);`,
  });
  return mat;
}

// ------------------------------------------------------------------------------- cloth geometry
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/**
 * Cloth grid with hanging folds, in local space: x ∈ [-w/2, w/2], y from 0 (top) to -h, front = +Z.
 * Returns geometry with position/normal/uv and arrays u,s for the wind attributes.
 */
export function clothGeometry({ w, h, segX = 24, segY = 72, fold = 0.04, loops = false, twist = 0, seed = 1, curl = 0.012 }) {
  const rnd = (() => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); })();
  const folds = [];
  const K = 5;
  for (let k = 0; k < K; k++) folds.push({ f: 0.7 + k * 0.75 + rnd() * 0.6, ph: rnd() * Math.PI * 2, a: (1 / (1 + k * 0.6)) * (0.6 + 0.6 * rnd()), b: (rnd() - 0.5) * 2.5 });
  const norm = folds.reduce((s, f) => s + f.a, 0);
  const nl = 6; // loops count (matches bannerArt)
  const nx = segX + 1, ny = segY + 1;
  const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2), U = new Float32Array(nx * ny), Sv = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const sv = j / segY; // 0 top → 1 bottom
    const s = sv * h;
    const A = fold * (0.3 + 0.7 * smoothstep(0, 0.45, sv));
    for (let i = 0; i < nx; i++) {
      const u = i / segX;
      let z = 0;
      for (const f of folds) z += f.a * Math.sin(2 * Math.PI * f.f * u + f.ph + f.b * sv);
      z *= A / norm;
      let y = -s, x = (u - 0.5) * w;
      if (loops) {
        const g = Math.exp(-s / 0.22);
        z += 0.03 * Math.sin(2 * Math.PI * (nl - 0.5) * u + 0.6) * g;
        y -= 0.025 * Math.abs(Math.sin(Math.PI * (nl - 1) * u)) * Math.exp(-s / 0.12);
      }
      // gentle horizontal wrinkles + edge curl backwards
      z += 0.004 * Math.sin(s * 7.0 + u * 3 + seed) * smoothstep(0.1, 0.9, sv);
      z -= curl * Math.pow(Math.abs(2 * u - 1), 6);
      // free-hanging twist (rotation about the vertical axis increasing downward)
      if (twist) {
        const a = twist * Math.pow(sv, 1.5);
        const cx = Math.cos(a), sx = Math.sin(a);
        const xx = x * cx + z * sx, zz = -x * sx + z * cx; x = xx; z = zz;
      }
      // slight narrowing where the folds are deep (cloth length goes into the folds)
      x *= 1 - (A / Math.max(w, 0.5)) * 0.35;
      const k = j * nx + i;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      uv[k * 2] = u; uv[k * 2 + 1] = 1 - sv;
      U[k] = u; Sv[k] = sv;
    }
  }
  const idx = [];
  for (let j = 0; j < segY; j++) for (let i = 0; i < segX; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.u = U; g.userData.s = Sv;
  return g;
}

// ------------------------------------------------------------------------------- hardware
function finialGeometry(kind, size) {
  let pts;
  if (kind === 'spear') {
    pts = [[0, 0], [0.18, 0.02], [0.2, 0.12], [0.12, 0.2], [0.16, 0.26], [0.3, 0.45], [0.36, 0.62], [0.28, 0.85], [0.12, 1.15], [0, 1.4]];
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r * size, y * size)), 4);
    return g;
  }
  // acorn / pine-cone knob
  pts = [[0, 0], [0.32, 0.02], [0.36, 0.1], [0.24, 0.16], [0.2, 0.2], [0.42, 0.32], [0.5, 0.5], [0.46, 0.68], [0.32, 0.86], [0.14, 0.98], [0.05, 1.08], [0, 1.15]];
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r * size, y * size)), 12);
}

function rodGeometry(len, r) {
  const g = new THREE.CylinderGeometry(r, r, len, 10, 1, false);
  g.rotateZ(Math.PI / 2);
  return g;
}

// ------------------------------------------------------------------------------- set
export class BannerSet {
  constructor(engine, { texHeight } = {}) {
    this.engine = engine;
    this.items = [];
    const detail = engine.quality?.detail ?? 1;
    this.texHeight = texHeight || (detail >= 0.9 ? 2048 : 1024);
    this.detail = detail;
  }

  add(spec) { this.items.push(spec); return this; }

  build() {
    const byStyle = new Map();
    const gold = [], bronze = [], stone = [];
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
    let tris = 0;
    for (const spec of this.items) {
      const styleKey = BANNER_STYLES[spec.style] ? spec.style : 'V';
      const style = BANNER_STYLES[styleKey];
      const h = spec.height ?? 6;
      const w = spec.width ?? h / style.aspect;
      const mount = spec.mount || 'wall';
      const seed = spec.seed ?? hashString(spec.pos.map((v) => v.toFixed(2)).join(','));
      const rotY = Math.PI - ((spec.facing ?? 180) * Math.PI) / 180;
      const fold = spec.fold ?? (mount === 'wall' ? 0.05 + 0.02 * w : 0.09 + 0.045 * w);
      const off = mount === 'wall' ? (spec.offset ?? fold + 0.07) : 0;
      const segX = Math.max(10, Math.round((14 + 10 * w) * (0.5 + 0.5 * this.detail)));
      const segY = Math.max(24, Math.round((18 + 9 * h) * (0.5 + 0.5 * this.detail)));
      const geo = clothGeometry({
        w, h, segX, segY, fold, loops: !!style.loops, seed,
        twist: mount === 'wall' ? 0 : ((seed % 1000) / 1000 - 0.5) * 0.25,
        curl: mount === 'wall' ? 0.006 : 0.015,
      });
      // attach point
      const base = new THREE.Vector3(...spec.pos);
      let top = base.clone();
      const poleH = h + 0.9 + (spec.poleExtra ?? 0);
      if (mount === 'pole') top.y += poleH;
      const front = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
      const right = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
      const clothOrigin = top.clone().addScaledVector(front, off);
      // the rod passes through the top hem: cloth starts slightly below the rod centre
      const rodR = 0.016 + 0.006 * w;
      clothOrigin.y -= style.loops ? rodR * 0.2 : rodR * 1.2;
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      M.compose(clothOrigin, Q, S1);
      geo.applyMatrix4(M);
      // wind attributes
      const n = geo.attributes.position.count;
      const A = new Float32Array(n * 4), B = new Float32Array(n * 4);
      const windAmp = (spec.wind ?? (mount === 'wall' ? 0.25 : mount === 'pole' ? 1.0 : 0.7)) * (0.05 + 0.03 * w);
      const ph = ((seed % 6283) / 1000);
      for (let i = 0; i < n; i++) {
        A[i * 4] = geo.userData.u[i]; A[i * 4 + 1] = geo.userData.s[i]; A[i * 4 + 2] = ph; A[i * 4 + 3] = windAmp;
        B[i * 4] = front.x; B[i * 4 + 1] = front.z; B[i * 4 + 2] = w; B[i * 4 + 3] = h;
      }
      geo.setAttribute('aClothA', new THREE.BufferAttribute(A, 4));
      geo.setAttribute('aClothB', new THREE.BufferAttribute(B, 4));
      if (!byStyle.has(styleKey)) byStyle.set(styleKey, []);
      byStyle.get(styleKey).push(geo);
      tris += geo.index.count / 3;

      // ---- hardware: rod + finials (+ wall brackets / pole)
      const rodLen = w * 1.04 + 0.16;
      const rodC = top.clone().addScaledVector(front, off);
      const rodG = rodGeometry(rodLen, rodR);
      M.compose(rodC, Q, S1); gold.push({ geo: rodG, matrix: M.clone() });
      const fin = finialGeometry('acorn', 0.07 + 0.025 * w);
      for (const sgn of [-1, 1]) {
        const p = rodC.clone().addScaledVector(right, sgn * rodLen / 2);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -sgn * Math.PI / 2);
        const qq = Q.clone().multiply(q);
        M.compose(p, qq, S1); gold.push({ geo: fin, matrix: M.clone() });
      }
      if (mount === 'wall') {
        // two small bracket arms from the wall + rosette plates
        // (wallBehind: distance from pos back to the wall face when the producer offset pos)
        const wb = spec.wallBehind ?? 0;
        const arm = new THREE.BoxGeometry(0.035, 0.035, off + wb + 0.02);
        const plate = new THREE.CylinderGeometry(0.06, 0.07, 0.025, 12).rotateX(Math.PI / 2);
        for (const sgn of [-1, 1]) {
          const p = top.clone().addScaledVector(right, sgn * (w * 0.5 - 0.05)).addScaledVector(front, (off - wb) * 0.5);
          M.compose(p, Q, S1); gold.push({ geo: arm, matrix: M.clone() });
          if (!wb) {
            const pp = top.clone().addScaledVector(right, sgn * (w * 0.5 - 0.05)).addScaledVector(front, 0.012);
            M.compose(pp, Q, S1); gold.push({ geo: plate, matrix: M.clone() });
          }
        }
      } else if (mount === 'free') {
        // suspension cords up to the beam
        const up = spec.hang ?? 0.6;
        if (up > 0.02) {
          const cord = new THREE.CylinderGeometry(0.008, 0.008, up, 5);
          for (const sgn of [-1, 1]) {
            const p = rodC.clone().addScaledVector(right, sgn * (w * 0.5 - 0.04)); p.y += up / 2;
            M.compose(p, Q, S1); gold.push({ geo: cord, matrix: M.clone() });
          }
        }
      } else if (mount === 'pole') {
        // vexillum: bronze pole + spear finial, stone foot block
        const pr = 0.03 + 0.006 * h;
        const pole = new THREE.CylinderGeometry(pr * 0.85, pr, poleH + 0.35, 10);
        const pc = base.clone().addScaledVector(front, -0.06); pc.y += (poleH + 0.35) / 2;
        M.compose(pc, Q, S1); bronze.push({ geo: pole, matrix: M.clone() });
        const sp = finialGeometry('spear', 0.22 + 0.03 * h);
        const tp = base.clone().addScaledVector(front, -0.06); tp.y += poleH + 0.35;
        M.compose(tp, Q, S1); gold.push({ geo: sp, matrix: M.clone() });
        // knop rings
        const ring = new THREE.TorusGeometry(pr * 1.4, pr * 0.45, 6, 14).rotateX(Math.PI / 2);
        for (const yy of [0.9, poleH * 0.55, poleH + 0.02]) {
          const rp = base.clone().addScaledVector(front, -0.06); rp.y += yy;
          M.compose(rp, Q, S1); gold.push({ geo: ring, matrix: M.clone() });
        }
        // a short crossbar link from the pole to the rod centre
        const link = new THREE.BoxGeometry(0.03, 0.03, 0.08);
        const lp = top.clone().addScaledVector(front, -0.02);
        M.compose(lp, Q, S1); gold.push({ geo: link, matrix: M.clone() });
        if (spec.foot !== false) {
          const foot = new THREE.BoxGeometry(0.55, 0.42, 0.55);
          const fp = base.clone().addScaledVector(front, -0.06); fp.y += 0.19;
          M.compose(fp, Q, S1); stone.push({ geo: foot, matrix: M.clone() });
          const cap = new THREE.BoxGeometry(0.62, 0.07, 0.62);
          fp.y += 0.24; M.compose(fp, Q, S1); stone.push({ geo: cap, matrix: M.clone() });
        }
      }
    }

    const group = new THREE.Group();
    group.name = 'banners';
    for (const [styleKey, geos] of byStyle) {
      const tex = bannerTextures(styleKey, this.texHeight);
      const merged = mergeCloth(geos);
      const mesh = new THREE.Mesh(merged, clothMaterial(tex, styleKey));
      mesh.name = 'bannerCloth_' + styleKey;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    if (gold.length) {
      const g = mergeGeos(gold);
      const mesh = new THREE.Mesh(g, goldMaterial({ name: 'bannerGold', wear: 0.25 }));
      mesh.name = 'bannerHardware'; group.add(mesh); tris += g.index.count / 3;
    }
    if (bronze.length) {
      const g = mergeGeos(bronze);
      const mesh = new THREE.Mesh(g, bronzeMaterial({ name: 'bannerPole', patina: 0.35 }));
      mesh.name = 'bannerPoles'; group.add(mesh); tris += g.index.count / 3;
    }
    if (stone.length) {
      const g = mergeGeos(stone);
      const mesh = new THREE.Mesh(g, propMarbleMaterial());
      mesh.name = 'bannerFeet'; group.add(mesh); tris += g.index.count / 3;
    }
    this.engine.add(group);
    this.engine.onUpdate((t) => { BANNER_TIME.value = t; });
    this.group = group;
    this.tris = tris;
    return group;
  }
}

function mergeCloth(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'uv', 'aClothA', 'aClothB'];
  const sizes = [3, 3, 2, 4, 4];
  const arrs = sizes.map((s) => new Float32Array(nv * s));
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    names.forEach((n, k) => arrs[k].set(g.attributes[n].array, vo * sizes[k]));
    const I = g.index.array;
    for (let i = 0; i < I.length; i++) idx[io++] = I[i] + vo;
    vo += g.attributes.position.count;
  }
  names.forEach((n, k) => out.setAttribute(n, new THREE.BufferAttribute(arrs[k], sizes[k])));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
