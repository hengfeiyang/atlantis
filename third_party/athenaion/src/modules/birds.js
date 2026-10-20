// Birds: instanced, animated seagulls (white body, pale-grey mantle, black wing tips with white
// "mirrors", yellow bill) circling over the canyon / lagoon (ref 4), plus a few distant birds.
// One InstancedMesh, one draw call. Flapping happens in the vertex shader (two-segment wings:
// arm + hand, gull "M" glide pose blended with flapping bursts); flight paths are updated on the
// CPU in engine.onUpdate (deterministic in t).
import * as THREE from 'three';

// ------------------------------------------------------------------ geometry (local: +Z forward, +Y up, +X right; metres)
function gullGeometry() {
  const P = [], N = [], C = [], F = [], I = [];
  const add = (p, n, c, f) => { P.push(...p); N.push(...n); C.push(...c); F.push(...f); return P.length / 3 - 1; };
  const WHITE = [0.86, 0.87, 0.88], MANTLE = [0.50, 0.53, 0.57], BLACK = [0.03, 0.03, 0.035], BILL = [0.86, 0.62, 0.10], EYE = [0.05, 0.05, 0.05];

  // body: spindle along Z, slightly flattened
  const prof = [[-0.34, 0.0], [-0.27, 0.035], [-0.14, 0.07], [0.0, 0.082], [0.13, 0.068], [0.2, 0.05], [0.25, 0.052], [0.3, 0.04], [0.335, 0.0]];
  const seg = 8, ring0 = [];
  for (let r = 0; r < prof.length; r++) {
    const [z, rad] = prof[r];
    const row = [];
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad * 0.88 + (z > 0.18 ? 0.025 : 0);
      const nx = Math.cos(a), ny = Math.sin(a);
      const back = ny > 0.35 && z < 0.15 && z > -0.2; // pale grey back between the wings
      row.push(add([x, y, z], [nx, ny, 0], back ? MANTLE : WHITE, [0, 0]));
    }
    ring0.push(row);
  }
  for (let r = 0; r < prof.length - 1; r++) for (let s = 0; s < seg; s++) {
    const a = ring0[r][s], b = ring0[r][(s + 1) % seg], c = ring0[r + 1][s], d = ring0[r + 1][(s + 1) % seg];
    I.push(a, c, b, b, c, d);
  }
  // bill (cone)
  const tip = add([0, 0.018, 0.40], [0, 0, 1], BILL, [0, 0]);
  const bb = [];
  for (let s = 0; s < 5; s++) { const a = (s / 5) * Math.PI * 2; bb.push(add([Math.cos(a) * 0.014, 0.022 + Math.sin(a) * 0.012, 0.315], [Math.cos(a), Math.sin(a), 0.3], BILL, [0, 0])); }
  for (let s = 0; s < 5; s++) I.push(bb[s], bb[(s + 1) % 5], tip);
  // eyes
  for (const sx of [-1, 1]) {
    const e0 = add([sx * 0.036, 0.05, 0.27], [sx, 0.2, 0.2], EYE, [0, 0]), e1 = add([sx * 0.038, 0.058, 0.262], [sx, 0.2, 0.2], EYE, [0, 0]), e2 = add([sx * 0.036, 0.05, 0.254], [sx, 0.2, 0.2], EYE, [0, 0]);
    I.push(...(sx > 0 ? [e0, e1, e2] : [e0, e2, e1]));
  }
  // tail fan (double sided via two faces)
  const tl = [[-0.055, -0.22], [0.055, -0.22], [0.075, -0.39], [-0.075, -0.39]];
  for (const up of [1, -1]) {
    const v = tl.map(([x, z]) => add([x, 0.012 * up, z], [0, up, 0], up > 0 ? WHITE : WHITE, [0, 0]));
    if (up > 0) I.push(v[0], v[2], v[1], v[0], v[3], v[2]); else I.push(v[0], v[1], v[2], v[0], v[2], v[3]);
  }
  // wings: span stations (x, leading z, trailing z, segment, colour rule)
  const span = [
    [0.05, 0.085, -0.13, 1], [0.18, 0.09, -0.15, 1], [0.32, 0.08, -0.15, 1],      // arm (shoulder → wrist)
    [0.44, 0.045, -0.15, 2], [0.56, 0.0, -0.14, 2], [0.66, -0.05, -0.12, 2], [0.73, -0.1, -0.11, 2], // hand
  ];
  const chordN = 3;
  for (const side of [-1, 1]) {
    for (const up of [1, -1]) {
      const grid = [];
      for (let si = 0; si < span.length; si++) {
        const [x, zl, zt, sg] = span[si];
        const sNorm = (x - 0.05) / 0.68;
        const row = [];
        for (let ci = 0; ci <= chordN; ci++) {
          const u = ci / chordN; // 0 leading, 1 trailing
          const z = zl + (zt - zl) * u;
          // airfoil: thicker near the leading edge, thin trailing edge; camber
          const th = 0.012 * (1 - u) * (1 - sNorm * 0.7);
          const y = 0.01 * Math.sin(Math.PI * Math.min(1, u * 1.2)) * (1 - sNorm * 0.5) + th * up;
          let col;
          if (up < 0) col = sNorm > 0.72 ? [0.30, 0.30, 0.32] : WHITE;             // underside white, dusky tip
          else {
            col = MANTLE;
            if (u > 0.85 && sNorm < 0.7) col = [0.8, 0.81, 0.82];                  // white trailing edge
            if (sNorm > 0.66) col = BLACK;                                          // black primaries
            if (sNorm > 0.86 && u > 0.2 && u < 0.7) col = [0.82, 0.82, 0.83];     // white mirror near the tip
          }
          row.push(add([x * side, y, z], [0, up, 0], col, [sNorm, sg]));
        }
        grid.push(row);
      }
      for (let si = 0; si < span.length - 1; si++) for (let ci = 0; ci < chordN; ci++) {
        const a = grid[si][ci], b = grid[si][ci + 1], c = grid[si + 1][ci], d = grid[si + 1][ci + 1];
        const flip = (side * up) > 0;
        if (flip) I.push(a, b, c, b, d, c); else I.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(F, 2));
  g.setIndex(I);
  g.computeBoundingSphere();
  g.boundingSphere.radius = 1.0;
  return g;
}

// ------------------------------------------------------------------ material (flapping in the vertex shader)
const U = { uBirdTime: { value: 0 } };
function gullMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.FrontSide });
  mat.name = 'gull';
  mat.userData.shaderKey = 'gull-v1';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBirdTime = U.uBirdTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uBirdTime;
        attribute vec2 aWing;
        attribute vec3 aBird; // x: phase seed, y: flap rate (Hz), z: flap duty
        vec2 gRot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }
        void gullPose(inout vec3 p, inout vec3 n){
          if (aWing.y < 0.5) return;
          float ph = uBirdTime * 6.2831853 * aBird.y + aBird.x * 40.0;
          // flapping bursts alternate with glides
          float env = smoothstep(0.15, 0.55, sin(uBirdTime * 0.55 + aBird.x * 17.0) * 0.5 + 0.5 - (1.0 - aBird.z) * 0.5);
          float a1 = mix(0.17, 0.10 + 0.62 * sin(ph), env);
          float a2 = mix(-0.30, -0.06 + 0.42 * sin(ph - 0.8), env);
          float sd = sign(p.x);
          vec2 xy = vec2(abs(p.x), p.y), nn = vec2(abs(n.x) * (n.x * sd >= 0.0 ? 1.0 : -1.0), n.y);
          if (aWing.y > 1.5) { vec2 w = vec2(0.32, 0.0); xy = w + gRot(xy - w, a2); nn = gRot(nn, a2); }
          vec2 s0 = vec2(0.05, 0.0); xy = s0 + gRot(xy - s0, a1); nn = gRot(nn, a1);
          p.x = xy.x * sd; p.y = xy.y; n.x = nn.x * sd; n.y = nn.y;
        }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        { vec3 pp = position; gullPose(pp, objectNormal); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 nn = normal; gullPose(transformed, nn); }`);
  };
  return mat;
}

// ------------------------------------------------------------------ flocks
// each flock: centre [x, z], altitude range, radius range, count, scale, speed
const FLOCKS = [
  { id: 'canyon', c: [-150, 110], alt: [55, 150], r: [35, 120], n: 16, scale: 1.9, v: [8, 11] },
  { id: 'lagoon', c: [-120, 290], alt: [35, 90], r: [30, 80], n: 7, scale: 1.7, v: [7, 10] },
  { id: 'acropolis', c: [-20, -30], alt: [135, 175], r: [40, 110], n: 6, scale: 1.8, v: [8, 11] },
  { id: 'ruins', c: [-200, 330], alt: [70, 110], r: [25, 60], n: 3, scale: 1.6, v: [8, 10] },
  { id: 'far', c: [150, -450], alt: [190, 260], r: [50, 140], n: 6, scale: 2.2, v: [9, 12] },
];

export async function build(engine, flocks = FLOCKS) {
  const t0 = performance.now();
  const rng = engine.rng('birds');
  const birds = [];
  for (const f of flocks) {
    for (let i = 0; i < f.n; i++) {
      const r = f.r[0] + (f.r[1] - f.r[0]) * rng.next();
      const v = f.v[0] + (f.v[1] - f.v[0]) * rng.next();
      birds.push({
        cx: f.c[0] + (rng.next() - 0.5) * r * 0.6, cz: f.c[1] + (rng.next() - 0.5) * r * 0.6,
        r, rz: r * (0.7 + 0.5 * rng.next()), rot: rng.next() * Math.PI,
        alt: f.alt[0] + (f.alt[1] - f.alt[0]) * rng.next(),
        w: (v / r) * (rng.next() < 0.5 ? 1 : -1), th0: rng.next() * Math.PI * 2,
        bob: 2 + 4 * rng.next(), bobW: 0.15 + 0.2 * rng.next(),
        s: f.scale * (0.88 + 0.24 * rng.next()),
        seed: rng.next(), rate: 2.6 + 0.8 * rng.next(), duty: 0.35 + 0.4 * rng.next(),
      });
    }
  }
  const geo = gullGeometry();
  const seeds = new Float32Array(birds.length * 3);
  birds.forEach((b, i) => { seeds[i * 3] = b.seed; seeds[i * 3 + 1] = b.rate; seeds[i * 3 + 2] = b.duty; });
  geo.setAttribute('aBird', new THREE.InstancedBufferAttribute(seeds, 3));
  const mesh = new THREE.InstancedMesh(geo, gullMaterial(), birds.length);
  mesh.name = 'gulls';
  mesh.frustumCulled = false;
  mesh.userData.castShadow = false; mesh.castShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const update = (t) => {
    U.uBirdTime.value = t;
    birds.forEach((b, i) => {
      const th = b.th0 + b.w * t;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const ex = Math.cos(th) * b.r, ez = Math.sin(th) * b.rz;
      pos.set(b.cx + ex * c - ez * s, b.alt + Math.sin(t * b.bobW + b.seed * 9) * b.bob, b.cz + ex * s + ez * c);
      // velocity direction (derivative of the ellipse)
      const dx = -Math.sin(th) * b.r * b.w, dz = Math.cos(th) * b.rz * b.w;
      const vx = dx * c - dz * s, vz = dx * s + dz * c;
      const vy = Math.cos(t * b.bobW + b.seed * 9) * b.bob * b.bobW;
      const yaw = Math.atan2(vx, vz);
      const pitch = -Math.atan2(vy, Math.hypot(vx, vz));
      const speed = Math.hypot(vx, vz);
      const bank = Math.atan((speed * speed) / (9.81 * Math.max(10, (b.r + b.rz) * 0.5))) * Math.sign(b.w) * -1;
      e.set(pitch, yaw, bank, 'YXZ');
      q.setFromEuler(e);
      scl.setScalar(b.s);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(engine.time || 0);
  engine.onUpdate((t) => update(t));
  engine.add(mesh, { castShadow: false, receiveShadow: false });
  engine.registry.birds = { mesh, count: birds.length };
  console.log(`[birds] ${birds.length} gulls, built in ${Math.round(performance.now() - t0)} ms`);
  return mesh;
}

export async function test(engine) {
  await build(engine, [
    { id: 'close', c: [0, 0], alt: [9, 13], r: [6, 12], n: 6, scale: 1.0, v: [6, 8] },
    { id: 'mid', c: [10, -40], alt: [20, 35], r: [15, 30], n: 10, scale: 1.0, v: [8, 10] },
  ]);
  return {
    views: [
      { pos: [0, 8, 18], target: [0, 11, 0], fov: 40, sun: { azimuth: 238, elevation: 25 }, time: 3.2 },
      { pos: [0, 8, 18], target: [0, 11, 0], fov: 40, sun: { azimuth: 238, elevation: 25 }, time: 3.45 },
      { pos: [30, 70, 60], target: [5, 20, -20], fov: 45, sun: { azimuth: 238, elevation: 25 }, time: 5 },
    ],
  };
}
