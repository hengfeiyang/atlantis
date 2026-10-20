// Shared GLSL snippets. Include NOISE_GLSL in any custom shader / material hook that needs
// procedural noise. All functions are prefixed to avoid collisions with three.js chunks.

export const NOISE_GLSL = /* glsl */ `
#ifndef CG_NOISE_INCLUDED
#define CG_NOISE_INCLUDED
// ---- hashes (Dave Hoskins, "hash without sine") ----
float cgHash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float cgHash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float cgHash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 cgHash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 cgHash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }

// ---- value noise ----
float cgVnoise2(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cgHash12(i), cgHash12(i + vec2(1,0)), u.x), mix(cgHash12(i + vec2(0,1)), cgHash12(i + vec2(1,1)), u.x), u.y);
}
float cgVnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cgHash13(i), cgHash13(i + vec3(1,0,0)), u.x), mix(cgHash13(i + vec3(0,1,0)), cgHash13(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(cgHash13(i + vec3(0,0,1)), cgHash13(i + vec3(1,0,1)), u.x), mix(cgHash13(i + vec3(0,1,1)), cgHash13(i + vec3(1,1,1)), u.x), u.y), u.z);
}

// ---- simplex 3D (Ashima / stegu, MIT) → [-1,1] ----
vec3 cgMod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 cgMod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 cgPermute(vec4 x){ return cgMod289(((x * 34.0) + 10.0) * x); }
vec4 cgTaylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float cgSnoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = cgMod289(i);
  vec4 p = cgPermute(cgPermute(cgPermute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = cgTaylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// ---- fractals ----
float cgFbm3(vec3 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 10; i++) { if (i >= oct) break; s += a * cgSnoise(p); n += a; p = p * 2.03 + vec3(17.1, 31.7, 7.3); a *= 0.5; }
  return s / n;
}
float cgVfbm3(vec3 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 10; i++) { if (i >= oct) break; s += a * cgVnoise3(p); n += a; p = p * 2.02 + vec3(5.3, 1.7, 9.2); a *= 0.5; }
  return s / n;
}
float cgVfbm2(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 10; i++) { if (i >= oct) break; s += a * cgVnoise2(p); n += a; p = p * 2.02 + vec2(5.3, 1.7); a *= 0.5; }
  return s / n;
}
float cgRidged3(vec3 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0, w = 1.0;
  for (int i = 0; i < 10; i++) { if (i >= oct) break; float v = 1.0 - abs(cgSnoise(p)); v *= v; v *= w; w = clamp(v * 2.0, 0.0, 1.0); s += a * v; n += a; p = p * 2.03 + vec3(3.1, 7.7, 1.3); a *= 0.5; }
  return s / n;
}

// ---- cellular (F1, F2 distances) ----
vec2 cgVoronoi3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = cgHash33(i + g);
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(vec2(d1, d2));
}
vec3 cgVoronoi2(vec2 p){ // returns F1, F2, cell id hash
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = cgHash22(i + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = cgHash12(i + g); } else if (d < d2) { d2 = d; }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}

// ---- helpers ----
vec3 cgTriWeights(vec3 n, float sharp){ vec3 w = pow(abs(n), vec3(sharp)); return w / (w.x + w.y + w.z + 1e-5); }
float cgLuma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 cgSaturate(vec3 c, float s){ float l = cgLuma(c); return max(vec3(0.0), mix(vec3(l), c, s)); }
float cgRemap(float x, float a, float b, float c, float d){ return c + (d - c) * clamp((x - a) / (b - a), 0.0, 1.0); }
#endif
`;
