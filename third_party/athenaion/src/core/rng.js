// Seeded random number generation. Everything in the world must be deterministic so that
// stills and video frames are reproducible: never use Math.random() in world code.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RNG with convenience helpers. `new RNG('temple')` or `new RNG(1234)`. */
export class RNG {
  constructor(seed = 1) {
    this.next = mulberry32(typeof seed === 'string' ? hashString(seed) : seed);
  }
  random() { return this.next(); }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  /** approx normal distribution */
  gauss(mean = 0, sd = 1) {
    const u = 1 - this.next(), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** point in unit disk */
  disk() {
    const r = Math.sqrt(this.next()), a = this.next() * Math.PI * 2;
    return [r * Math.cos(a), r * Math.sin(a)];
  }
  /** unit vector on sphere */
  sphere() {
    const z = this.range(-1, 1), a = this.next() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), r * Math.sin(a), z];
  }
  fork(label) { return new RNG(hashString(String(label)) ^ Math.floor(this.next() * 4294967296)); }
}

/** Integer hash → [0,1). Stateless, handy for per-instance variation. */
export function hash01(...ints) {
  let h = 0x811c9dc5;
  for (const v of ints) {
    h ^= (v | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** Halton low-discrepancy sequence (used for sub-pixel / aperture jitter). */
export function halton(index, base) {
  let f = 1, r = 0, i = index;
  while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); }
  return r;
}
