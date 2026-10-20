// Tileable, time-evolving wave slope texture (Tessendorf FFT ocean, small scale).
//
// A directional wind-wave spectrum is synthesised once (seeded), then for every new engine time
// the spectrum is advanced with the deep-water dispersion relation and inverse-FFT'd into the
// SLOPE field (dh/dx, dh/dz). The texture stores (sx, sz, sx², sz²) in half floats with a CPU
// box-filtered mip chain, so shaders can do LEAN mapping: the mipped second moments give the
// sub-pixel slope variance → correct sun-glitter spread and reflection blur at distance.
// Shaders sample this one tile at several scales/rotations ("octaves").
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

function fft1d(re, im, n, rev, cosT, sinT, off, stride) {
  // bit reversal
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const a = off + i * stride, b = off + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const wr = cosT[k * step], wi = sinT[k * step];
        const a = off + (i + k) * stride, b = off + (i + k + half) * stride;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

export class OceanTile {
  /**
   * @param {object} o
   * @param {number} [o.n=256] grid size (power of two)
   * @param {number} [o.size=24] tile size in metres
   * @param {number} [o.wind=4.5] wind speed m/s
   * @param {number} [o.windDir=0.6] radians
   * @param {number} [o.seed=7]
   */
  constructor({ n = 256, size = 24, wind = 4.5, windDir = 0.6, seed = 7 } = {}) {
    this.n = n; this.size = size;
    const N = n;
    this.re = new Float32Array(N * N); this.im = new Float32Array(N * N);
    this.rev = new Uint32Array(N);
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
    this.cosT = new Float32Array(N / 2); this.sinT = new Float32Array(N / 2);
    for (let k = 0; k < N / 2; k++) { this.cosT[k] = Math.cos((2 * Math.PI * k) / N); this.sinT[k] = Math.sin((2 * Math.PI * k) / N); } // +i: inverse FFT

    // ---- initial spectrum h0(k) (Phillips with directional spreading + small-wave cutoff)
    const rnd = mulberry32(seed);
    const gauss = () => { const u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const g = 9.81, L = (wind * wind) / g, lSmall = size / N * 1.2;
    const wx = Math.cos(windDir), wz = Math.sin(windDir);
    this.h0r = new Float32Array(N * N); this.h0i = new Float32Array(N * N);
    this.kx = new Float32Array(N * N); this.kz = new Float32Array(N * N); this.w = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const mi = i < N / 2 ? i : i - N, mj = j < N / 2 ? j : j - N;
      const kx = (2 * Math.PI * mi) / size, kz = (2 * Math.PI * mj) / size;
      const k = Math.hypot(kx, kz), idx = j * N + i;
      this.kx[idx] = kx; this.kz[idx] = kz; this.w[idx] = Math.sqrt(g * k * (1 + (k * k) * 7.4e-5)); // + capillary term
      if (k < 1e-6) continue;
      const kd = (kx * wx + kz * wz) / k;
      const dirTerm = 0.35 + 0.65 * kd * kd; // fairly broad spreading: calm lagoon / river chop
      let P = Math.exp(-1 / ((k * L) * (k * L))) / (k * k * k * k) * dirTerm * Math.exp(-k * k * lSmall * lSmall);
      if (kd < 0) P *= 0.35; // waves travelling against the wind are weaker
      const a = Math.sqrt(P * 0.5);
      this.h0r[idx] = gauss() * a; this.h0i[idx] = gauss() * a;
    }
    // normalise so the RMS slope (per axis) of the tile is 1 → shaders scale it directly
    let s2 = 0;
    for (let idx = 0; idx < N * N; idx++) {
      const m2 = this.h0r[idx] ** 2 + this.h0i[idx] ** 2;
      s2 += m2 * (this.kx[idx] ** 2 + this.kz[idx] ** 2);
    }
    // each |h0|² contributes twice (h(k) and conj(h(-k))) to the slope variance, split over 2 axes
    const norm = 1 / Math.sqrt(Math.max(1e-12, s2));
    for (let idx = 0; idx < N * N; idx++) { this.h0r[idx] *= norm; this.h0i[idx] *= norm; }

    const mipCount = bits + 1;
    this.mipData = [];
    for (let l = 0, s = N; l < mipCount; l++, s >>= 1) this.mipData.push(new Float32Array(s * s * 4));
    this.texture = new THREE.DataTexture(new Uint16Array(N * N * 4), N, N, THREE.RGBAFormat, THREE.HalfFloatType);
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.anisotropy = 4;
    this.time = null;
    this.update(0);
  }

  /** advance the spectrum to time t (s) and upload */
  update(t) {
    if (this.time === t) return;
    this.time = t;
    const N = this.n, re = this.re, im = this.im;
    const { h0r, h0i, kx, kz, w } = this;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const mi = (N - i) % N, mj = (N - j) % N, nidx = mj * N + mi;
      const c = Math.cos(w[idx] * t), s = Math.sin(w[idx] * t);
      // h(k,t) = h0(k) e^{iwt} + conj(h0(-k)) e^{-iwt}
      const ar = h0r[idx] * c - h0i[idx] * s, ai = h0r[idx] * s + h0i[idx] * c;
      const br = h0r[nidx] * c - h0i[nidx] * s, bi = -h0i[nidx] * c - h0r[nidx] * s; // conj(h0(-k)) e^{-iwt}
      const hr = ar + br, hi = ai + bi;
      // C = i kx h + i (i kz h) = i kx h - kz h  →  IFFT = sx + i sz
      re[idx] = -kx[idx] * hi - kz[idx] * hr;
      im[idx] = kx[idx] * hr - kz[idx] * hi;
    }
    for (let j = 0; j < N; j++) fft1d(re, im, N, this.rev, this.cosT, this.sinT, j * N, 1);
    for (let i = 0; i < N; i++) fft1d(re, im, N, this.rev, this.cosT, this.sinT, i, N);
    // level 0
    const m0 = this.mipData[0];
    for (let idx = 0; idx < N * N; idx++) {
      const sx = re[idx], sz = im[idx];
      m0[idx * 4] = sx; m0[idx * 4 + 1] = sz; m0[idx * 4 + 2] = sx * sx; m0[idx * 4 + 3] = sz * sz;
    }
    // mips (box filter of first and second moments)
    for (let l = 1; l < this.mipData.length; l++) {
      const src = this.mipData[l - 1], dst = this.mipData[l];
      const sw = N >> (l - 1), dw = N >> l;
      for (let j = 0; j < dw; j++) for (let i = 0; i < dw; i++) {
        const a = ((j * 2) * sw + i * 2) * 4, b = a + 4, c = a + sw * 4, d = c + 4, o = (j * dw + i) * 4;
        for (let ch = 0; ch < 4; ch++) dst[o + ch] = 0.25 * (src[a + ch] + src[b + ch] + src[c + ch] + src[d + ch]);
      }
    }
    const toHalf = THREE.DataUtils.toHalfFloat;
    const mips = this.mipData.map((m, l) => {
      const s = N >> l, h = new Uint16Array(m.length);
      for (let q = 0; q < m.length; q++) h[q] = toHalf(m[q]);
      return { data: h, width: s, height: s };
    });
    this.texture.image = { data: mips[0].data, width: N, height: N };
    this.texture.mipmaps = mips;
    this.texture.needsUpdate = true;
  }
}
