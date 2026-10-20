// Marine fauna: schools of silver fish (stream ribbons along closed splines, milling vortices), small reef fish
// groups, a manta ray and a sea turtle. All positions are analytic functions of the engine time t (no
// integration → any frame can be rendered in isolation, deterministic). Instances are placed on the CPU in
// engine.onUpdate; tail beats / wing flaps / flipper strokes run in the vertex shader.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { GeoBuilder, tube, lin, mixC } from './geo.js';
import { fishMaterial, mantaMaterial, turtleMaterial, MARINE_U } from './materials.js';

const V = THREE.Vector3;

// ------------------------------------------------------------------ fish geometry (+Z head, length 1)
/** body: elliptical rings along z; depth = max height / length; returns BufferGeometry with colour bands */
export function fishGeometry({ depth = 0.22, width = 0.1, rings = 10, seg = 8, colorFn = null, fins = true } = {}) {
  const B = new GeoBuilder();
  const prof = (z) => { // z in [-0.32, 0.5] → (h, w) half sizes
    const t = (z + 0.32) / 0.82; // 0 at peduncle, 1 at snout
    const s = Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.94)), 0.75) * (t < 0.15 ? 0.45 + 0.55 * t / 0.15 : 1);
    return [depth * 0.5 * s, width * 0.5 * s];
  };
  const b0 = B.n;
  for (let i = 0; i <= rings; i++) {
    const z = -0.32 + (i / rings) * 0.82;
    const [h, w] = prof(z);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const y = Math.cos(a) * h, x = Math.sin(a) * w;
      B.c = colorFn ? colorFn(z, y / Math.max(h, 1e-4)) : [1, 1, 1];
      B.v(x, y, z, j / seg, i / rings);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = b0 + i * (seg + 1) + j, c = a + seg + 1;
    B.tri(a, c, a + 1); B.tri(a + 1, c, c + 1);
  }
  // snout cap
  const tip = (() => { B.c = colorFn ? colorFn(0.5, 0) : [1, 1, 1]; return B.v(0, 0, 0.52, 0.5, 1); })();
  const last = b0 + rings * (seg + 1);
  for (let j = 0; j < seg; j++) B.tri(last + j, tip, last + j + 1);
  if (fins) {
    const finC = colorFn ? colorFn(-0.45, 0) : [1, 1, 1];
    const tri2 = (p) => { B.c = finC; const ids = p.map((q) => B.v(q[0], q[1], q[2], 0.5, 0)); B.tri(ids[0], ids[1], ids[2]); B.tri(ids[0], ids[2], ids[1]); };
    const hp = prof(-0.3)[0];
    // forked caudal fin
    tri2([[0, hp * 0.8, -0.3], [0, depth * 0.62, -0.5], [0, 0.0, -0.4]]);
    tri2([[0, -hp * 0.8, -0.3], [0, 0.0, -0.4], [0, -depth * 0.62, -0.5]]);
    // dorsal & anal fins
    const hd = prof(0.05)[0];
    tri2([[0, hd * 0.95, 0.12], [0, hd * 0.95, -0.06], [0, hd + depth * 0.35, -0.04]]);
    tri2([[0, -hd * 0.9, -0.05], [0, -hd * 0.9, -0.18], [0, -hd - depth * 0.18, -0.16]]);
  }
  const g = B.toGeometry();
  return g;
}

// reef fish colour patterns (linear), fn(z, yRel) → rgb
const REEF_PATTERNS = [
  (z, y) => lin(240, 200, 40),                                                      // yellow tang
  (z, y) => (z < -0.25 ? lin(240, 200, 40) : y > 0.4 ? lin(20, 40, 140) : lin(40, 80, 200)), // blue tang
  (z, y) => (Math.abs(z - 0.18) < 0.05 || Math.abs(z + 0.08) < 0.05 ? lin(240, 240, 235) : lin(240, 110, 30)), // clownfish-like bands
  (z, y) => (Math.sin(z * 34) > 0.55 ? lin(25, 25, 30) : y > 0 ? lin(230, 210, 80) : lin(220, 225, 220)), // sergeant major
  (z, y) => mixC(lin(230, 120, 160), lin(250, 170, 60), Math.max(0, -y)),            // anthias
  (z, y) => (y > 0.2 ? lin(70, 120, 60) : lin(220, 200, 150)),                       // wrasse
];

// ------------------------------------------------------------------ school motion models
function makeSchool(def, rng) {
  const n = def.count;
  const fish = new Array(n);
  for (let i = 0; i < n; i++) {
    const g = () => rng.gauss(0, 1);
    fish[i] = {
      u: rng.random(), a: g(), b: g(), c: rng.random(), k: rng.range(0.85, 1.15),
      ph: rng.random(), size: def.size * rng.range(0.8, 1.2), beat: rng.range(2.2, 3.6) * (def.beat ?? 1),
    };
  }
  let curve = null;
  if (def.type === 'stream') {
    const top = def.maxY ?? 1e9;
    curve = new THREE.CatmullRomCurve3(def.path.map((p) => new V(p[0], Math.min(p[1], top), p[2])), true, 'centripetal');
    curve.arcLengthDivisions = 400;
    curve.updateArcLengths();
    def.L = curve.getLength();
  }
  return { def, fish, curve };
}

const _p = new V(), _q = new V(), _t = new V(), _n = new V(), _b = new V();
/** position of fish f of school S at time t → out */
function fishPos(S, f, t, out) {
  const d = S.def;
  if (d.type === 'stream') {
    const L = d.L;
    let u = (f.u + (d.speed * f.k * 0.97 + d.speed * 0.03) * t / L) % 1;
    if (u < 0) u += 1;
    S.curve.getPointAt(u, _p);
    S.curve.getTangentAt(u, _t);
    _n.set(0, 1, 0).addScaledVector(_t, -_t.y).normalize();
    _b.crossVectors(_t, _n);
    // cross-section: wide ribbon, density pulses along the stream
    const pulse = 0.55 + 0.45 * Math.sin(u * Math.PI * 2 * (d.pulses ?? 3) + f.c * 0.6 + t * 0.15);
    const W = d.width * (0.5 + 0.5 * pulse), T = d.thick * (0.6 + 0.4 * pulse);
    const wob = Math.sin(t * 0.7 + f.ph * 20) * 0.15;
    out.copy(_p).addScaledVector(_b, (f.a + wob) * W * 0.5).addScaledVector(_n, f.b * T * 0.5);
  } else { // mill: vortex around a (tilted) axis
    const r = d.r0 + (d.r1 - d.r0) * Math.sqrt(f.c);
    const w = (d.speed / r) * f.k * (d.dir ?? 1);
    const th = f.u * Math.PI * 2 + w * t;
    const breathe = 1 + 0.08 * Math.sin(t * 0.4 + f.ph * 6);
    const y = f.a * d.height * 0.35 + Math.sin(th * 2 + f.ph * 6) * d.height * 0.06;
    const cx = d.center[0] + Math.sin(t * 0.05) * (d.drift ?? 0), cz = d.center[2] + Math.cos(t * 0.04) * (d.drift ?? 0);
    out.set(cx + Math.cos(th) * r * breathe, Math.min(d.center[1] + y, (d.maxY ?? 1e9) + 2), cz + Math.sin(th) * r * breathe * (d.squash ?? 1));
    if (d.tilt) { // tilt about the x axis through the centre
      const dy = out.y - d.center[1], dz = out.z - cz, c = Math.cos(d.tilt), s = Math.sin(d.tilt);
      out.y = d.center[1] + dy * c - dz * s; out.z = cz + dy * s + dz * c;
    }
  }
  return out;
}

/**
 * Build all schools as InstancedMeshes (one per school), updated in engine.onUpdate.
 * defs: [{type:'stream', path:[[x,y,z]..], width, thick, speed, count, size, kind:'silver'|'reef', palette?}
 *        {type:'mill', center, r0, r1, height, speed, count, size, dir, tilt}]
 */
export function buildSchools(engine, defs, root) {
  const geoSilver = fishGeometry({ depth: 0.2, width: 0.085, rings: 8, seg: 6 });
  const geoSilverLo = fishGeometry({ depth: 0.2, width: 0.085, rings: 5, seg: 5 });
  const matSilver = fishMaterial({ kind: 'silver' });
  const matReef = fishMaterial({ kind: 'reef' });
  const reefGeos = REEF_PATTERNS.map((fn, i) => fishGeometry({ depth: i === 0 || i === 1 ? 0.5 : 0.3, width: 0.1, colorFn: fn, rings: 7, seg: 6 }));
  const schools = [];
  let total = 0, tris = 0;
  defs.forEach((def, si) => {
    const rng = new RNG('marine:school:' + si + ':' + (def.id || ''));
    const S = makeSchool(def, rng);
    const reef = def.kind === 'reef';
    const geo = (reef ? reefGeos[(def.pattern ?? si) % reefGeos.length] : (def.lo ? geoSilverLo : geoSilver)).clone();
    const at = new Float32Array(def.count * 3);
    S.fish.forEach((f, i) => { at[i * 3] = f.ph; at[i * 3 + 1] = f.beat; at[i * 3 + 2] = 0; });
    geo.setAttribute('aFish', new THREE.InstancedBufferAttribute(at, 3));
    const mesh = new THREE.InstancedMesh(geo, reef ? matReef : matSilver, def.count);
    mesh.name = 'marine-school-' + (def.id || si);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.castShadow = false; mesh.userData.receiveShadow = true;
    mesh.castShadow = false; mesh.receiveShadow = true;
    S.mesh = mesh;
    root.add(mesh);
    schools.push(S);
    total += def.count; tris += def.count * (geo.index.count / 3);
  });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new V(), p0 = new V(), p1 = new V();
  const update = (t) => {
    for (const S of schools) {
      const dt = 0.08;
      S.fish.forEach((f, i) => {
        fishPos(S, f, t, p0); fishPos(S, f, t + dt, p1);
        const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
        const hl = Math.hypot(dx, dz) + 1e-6;
        e.set(-Math.atan2(dy, hl) * 0.8, Math.atan2(dx, dz), Math.sin(t * 0.9 + f.ph * 40) * 0.45 * f.k, 'YXZ');
        q.setFromEuler(e);
        s.setScalar(f.size);
        m4.compose(p0, q, s);
        S.mesh.setMatrixAt(i, m4);
      });
      S.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  return { schools, update, count: total, tris };
}

// ------------------------------------------------------------------ manta ray
export function mantaGeometry() {
  const B = new GeoBuilder();
  const span = 2.3, NX = 30, NC = 9;
  const le = (ax) => 0.95 - 0.55 * ax - 0.55 * ax * ax;            // leading edge z (swept back)
  const te = (ax) => -0.85 + 0.75 * ax - 0.2 * Math.pow(ax, 4) * 0; // trailing edge z
  const th = (ax, c) => (0.17 * Math.pow(1 - ax, 1.6) + 0.012) * Math.sin(Math.PI * c) ** 0.6;
  const rows = [];
  for (let i = 0; i <= NX; i++) {
    const x = -span + (2 * span * i) / NX, ax = Math.abs(x) / span;
    const zl = le(ax), zt = te(ax);
    const tipPinch = ax > 0.92 ? (ax - 0.92) / 0.08 : 0;
    const zle = zl - (zl - zt) * 0.5 * tipPinch, zte = zt + (zl - zt) * 0.5 * tipPinch;
    const row = [];
    // loop: top from le → te, bottom te → le
    for (let k = 0; k <= 2 * NC; k++) {
      const top = k <= NC;
      const c = top ? k / NC : 1 - (k - NC) / NC;
      const z = zle + (zte - zle) * c;
      const camber = 0.05 * (1 - ax) * Math.sin(Math.PI * c);
      const y = camber + (top ? 1 : -0.6) * th(ax, c);
      row.push(B.v(x, y, z, i / NX, k / (2 * NC)));
    }
    rows.push(row);
  }
  for (let i = 0; i < NX; i++) for (let k = 0; k < 2 * NC; k++) {
    const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1];
    B.tri(a, c, b); B.tri(b, c, d);
  }
  // cephalic fins (curled forward lobes)
  for (const sx of [-1, 1]) {
    const pts = [new V(sx * 0.32, 0.02, 0.86), new V(sx * 0.36, -0.03, 1.08), new V(sx * 0.33, -0.1, 1.22), new V(sx * 0.27, -0.16, 1.24)];
    tube(B, pts, (t) => 0.05 * (1 - 0.4 * t), { radial: 5, cap: 'round' });
  }
  // tail
  tube(B, [new V(0, 0.02, -0.82), new V(0, 0.0, -1.4), new V(0, -0.02, -2.1), new V(0, -0.03, -2.6)], (t) => 0.03 * (1 - 0.85 * t), { radial: 4, cap: 'point' });
  return B.toGeometry();
}

// ------------------------------------------------------------------ sea turtle (green turtle, length ≈ 1.1 m)
export function turtleGeometry() {
  const B = new GeoBuilder();
  const limb = [];  // per-vertex aLimb (pivot xyz, part)
  const setPart = (from, pivot, part) => { for (let i = from; i < B.n; i++) limb[i] = [pivot[0], pivot[1], pivot[2], part]; };
  const shell = lin(96, 78, 46), skin = lin(80, 76, 58), belly = lin(200, 186, 140);
  // carapace + plastron: deformed sphere
  let i0 = B.n;
  const NU = 28, NV = 16;
  for (let v = 0; v <= NV; v++) {
    const phi = (v / NV) * Math.PI;
    for (let u = 0; u <= NU; u++) {
      const th = (u / NU) * Math.PI * 2;
      let x = Math.sin(phi) * Math.cos(th) * 0.38, z = Math.sin(phi) * Math.sin(th) * 0.52, y = Math.cos(phi);
      y = y > 0 ? y * 0.15 : y * 0.06;
      // heart-shaped outline: narrower at the rear
      x *= 1 - 0.18 * Math.max(0, -z / 0.52);
      // marginal scute ridge
      B.c = y > 0 ? shell : belly;
      B.v(x, y, z, u / NU, v / NV);
    }
  }
  for (let v = 0; v < NV; v++) for (let u = 0; u < NU; u++) {
    const a = i0 + v * (NU + 1) + u, c = a + NU + 1;
    B.tri(a, a + 1, c); B.tri(a + 1, c + 1, c);
  }
  setPart(i0, [0, 0, 0], 0);
  // head + neck
  i0 = B.n;
  B.c = skin;
  tube(B, [new V(0, 0.0, 0.42), new V(0, 0.02, 0.56), new V(0, 0.03, 0.68)], (t) => 0.085 * (1 - 0.2 * t) * (t > 0.7 ? 1.1 : 1), { radial: 8, cap: 'round' });
  setPart(i0, [0, 0, 0.45], 5);
  // flippers: flat paddles (front long, rear short)
  const flipper = (sx, front) => {
    const s = B.n;
    const piv = front ? [sx * 0.28, -0.01, 0.26] : [sx * 0.22, -0.02, -0.36];
    const L = front ? 0.7 : 0.26, W = front ? 0.2 : 0.14;
    const N = 6;
    B.c = skin;
    const rowsA = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const x = piv[0] + sx * L * t, z = piv[2] - (front ? 0.28 : 0.1) * t * t;
      const w = W * Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.8));
      const zc = z - w * 0.3;
      rowsA.push([B.v(x, piv[1] + 0.018 * (1 - t), zc + w * 0.5), B.v(x, piv[1] - 0.018 * (1 - t), zc + w * 0.5), B.v(x, piv[1] - 0.018 * (1 - t), zc - w * 0.5), B.v(x, piv[1] + 0.018 * (1 - t), zc - w * 0.5)]);
    }
    for (let k = 0; k < N; k++) for (let j = 0; j < 4; j++) {
      const a = rowsA[k][j], b = rowsA[k][(j + 1) % 4], c = rowsA[k + 1][j], d = rowsA[k + 1][(j + 1) % 4];
      if (sx > 0) { B.tri(a, c, b); B.tri(b, c, d); } else { B.tri(a, b, c); B.tri(b, d, c); }
    }
    setPart(s, piv, front ? (sx < 0 ? 1 : 2) : (sx < 0 ? 3 : 4));
  };
  flipper(-1, true); flipper(1, true); flipper(-1, false); flipper(1, false);
  const g = B.toGeometry();
  const la = new Float32Array(B.n * 4);
  for (let i = 0; i < B.n; i++) { const l = limb[i] || [0, 0, 0, 0]; la.set(l, i * 4); }
  g.setAttribute('aLimb', new THREE.BufferAttribute(la, 4));
  return g;
}

/**
 * A swimmer following a closed spline (manta, turtle). path: [[x,y,z]...], speed m/s, u0 offset (0..1).
 * Returns {mesh, update(t)}.
 */
export function buildSwimmer(engine, kind, { path, speed = 1.2, u0 = 0, scale = 1, flapHz = 0.25 }) {
  const geo = kind === 'manta' ? mantaGeometry() : turtleGeometry();
  const mat = kind === 'manta' ? mantaMaterial() : turtleMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'marine-' + kind;
  mesh.frustumCulled = false;
  const curve = new THREE.CatmullRomCurve3(path.map((p) => new V(...p)), true, 'centripetal');
  curve.arcLengthDivisions = 300;
  const L = curve.getLength();
  const p = new V(), tg = new V(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const update = (t) => {
    let u = (u0 + (speed * t) / L) % 1; if (u < 0) u += 1;
    curve.getPointAt(u, p); curve.getTangentAt(u, tg);
    const ph = t * flapHz * Math.PI * 2;
    const bob = kind === 'manta' ? Math.sin(ph) * 0.12 : Math.sin(ph) * 0.04;
    // bank into the turn: curvature from the tangent change
    const tg2 = curve.getTangentAt((u + 0.01) % 1);
    const turn = Math.atan2(tg.x * tg2.z - tg.z * tg2.x, tg.x * tg2.x + tg.z * tg2.z);
    const bank = kind === 'turtle' ? 0.14 : 0.5;   // r4: the turtle banked 29° read edge-on (a log) from the shot-7 floor camera
    e.set(-Math.asin(THREE.MathUtils.clamp(tg.y, -1, 1)) * (kind === 'turtle' ? 0.4 : 1), Math.atan2(tg.x, tg.z), THREE.MathUtils.clamp(-turn * 12, -bank, bank), 'YXZ');
    q.setFromEuler(e);
    mesh.position.set(p.x, p.y + bob, p.z);
    mesh.quaternion.copy(q);
    mesh.scale.setScalar(scale);
    if (kind === 'manta') mat.userData.cgUniforms.uFlap.value = ph;
    else mat.userData.cgUniforms.uStroke.value = ph;
  };
  return { mesh, update, curve };
}
