// Ivy (Hedera helix) grown on any SDF surface: stems crawl over the surface (projected back onto it
// every step), climb upward, wander, branch; leaves (3–5 lobed, heart base, folded midrib) sit on
// petioles facing out & up toward the light. Output: one merged stem geometry + an InstancedMesh of
// leaves with per-instance colour (dark glossy mature leaves, a few young yellow-green ones).
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { proceduralMaterial, cached } from '../core/materials.js';
import { ATMO } from '../core/atmosphere.js';

// ------------------------------------------------------------------ leaf geometry
let LEAF_GEO = null;
export function ivyLeafGeometry() {
  if (LEAF_GEO) return LEAF_GEO;
  // outline (unit leaf: base/petiole at origin, tip at +y ≈ 1.0, width ≈ 1.0)
  const pts = [];
  const N = 64;
  const lobes = [[0, 0.6, 0.62], [1.0, 0.4, 0.5], [-1.0, 0.4, 0.5], [1.95, 0.22, 0.5], [-1.95, 0.22, 0.5]]; // angle, length, width
  const C = new THREE.Vector2(0, 0.36); // polar centre
  for (let i = 0; i < N; i++) {
    const a = -Math.PI + (i / N) * Math.PI * 2; // 0 = toward the tip (+y)
    let r = 0.2;
    for (const [la, ll, lw] of lobes) {
      let da = a - la; da = Math.atan2(Math.sin(da), Math.cos(da));
      r = Math.max(r, 0.3 + ll * Math.exp(-Math.abs(da) / (lw * 0.72)) * (1 - 0.1 * da * da));
    }
    // heart-shaped notch at the petiole
    const back = Math.exp(-((Math.abs(a) - Math.PI) ** 2) / 0.05);
    r *= 1 - 0.55 * back;
    pts.push(new THREE.Vector2(C.x + Math.sin(a) * r, C.y + Math.cos(a) * r));
  }
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  // add a centre vertex fan for nicer bending: use the outline + interior ring
  const pos = [], uv = [], idx = [];
  const interior = pts.map((p) => new THREE.Vector2(C.x + (p.x - C.x) * 0.5, C.y + (p.y - C.y) * 0.5));
  const all = [...pts, ...interior, C.clone()];
  for (const p of all) {
    const fold = -0.12 * Math.abs(p.x);             // V fold along the midrib
    const curl = 0.06 * (p.y - 0.4) * (p.y - 0.4);  // tip & base curl down/up
    pos.push(p.x, p.y, fold - curl);
    uv.push(p.x, p.y);
  }
  const n = pts.length, ci = 2 * n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + i, j, n + j, n + i, n + i, n + j, ci);
  }
  void tris;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  LEAF_GEO = g;
  return g;
}

export function ivyLeafMaterial() {
  return cached('ivyLeaf', () => {
    const m = proceduralMaterial({
      name: 'ivyLeaf',
      params: { color: 0xffffff, roughness: 0.42, metalness: 0, side: THREE.DoubleSide, vertexColors: false },
      vertexHead: 'varying vec2 vLeafUv;',
      vertexPre: 'vLeafUv = uv;',
      head: 'varying vec2 vLeafUv; uniform vec3 uSunDirIvy;',
      color: `
        vec2 q = vLeafUv - vec2(0.0, 0.05);
        float ang = atan(q.x, q.y);
        float r = length(q);
        // palmate veins toward the five lobes
        float vd = 9.0;
        for (int k = 0; k < 5; k++) {
          float la = k == 0 ? 0.0 : k == 1 ? 0.95 : k == 2 ? -0.95 : k == 3 ? 1.9 : -1.9;
          vec2 dir = vec2(sin(la), cos(la));
          float t = clamp(dot(q, dir), 0.0, 0.9);
          vd = min(vd, length(q - dir * t));
        }
        float vein = 1.0 - smoothstep(0.006, 0.02, vd);
        float edge = smoothstep(0.25, 0.75, r);
        vec3 c = diffuseColor.rgb;
        c *= 0.85 + 0.25 * cgVnoise2(vLeafUv * 7.0 + cgSeed * 13.0);
        c = mix(c, c * vec3(2.1, 2.1, 1.5) + vec3(0.025, 0.03, 0.012), vein * 0.85);
        c *= 1.0 - 0.18 * edge;
        diffuseColor.rgb = c;`,
      roughness: `roughnessFactor = 0.38 + 0.2 * cgVnoise2(vLeafUv * 5.0 + cgSeed * 7.0);`,
      // sunken veins and a quilted blade (breaks the flat-card look up close)
      normal: `
        vec2 q = vLeafUv - vec2(0.0, 0.05);
        vec3 tn = normalize(cross(dFdx(cgP), dFdy(cgP)));
        float qu = sin(q.x * 26.0) * sin(q.y * 22.0 + q.x * 6.0);
        vec3 tx = normalize(dFdx(cgP)), ty = normalize(dFdy(cgP));
        cgBump = (tx * cos(q.x * 26.0) + ty * cos(q.y * 22.0)) * 0.06 * qu;`,
      emissive: `
        // cheap translucency: light passing through backlit leaves
        float back = max(0.0, dot(normalize(-cgV), uSunDirIvy));
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.9, 1.1, 0.35) * pow(back, 3.0) * 0.35;`,
      uniforms: { uSunDirIvy: ATMO.uSunDir },
    });
    return m;
  });
}

export function ivyStemMaterial() {
  return cached('ivyStem', () => proceduralMaterial({
    name: 'ivyStem',
    params: { color: 0xffffff, roughness: 0.85 },
    color: `float n = cgVnoise2(cgP.xz * 40.0 + cgP.y * 33.0);
      diffuseColor.rgb = mix(vec3(0.075, 0.06, 0.04), vec3(0.16, 0.13, 0.09), n);`,
  }));
}

// ------------------------------------------------------------------ growth
/**
 * @param {object} o
 * @param {(x,y,z)=>number} o.sdf  world-space SDF (metres) of the support surface
 * @param {THREE.Vector3[]} o.seeds start points (world) near the surface
 * @param {THREE.Vector3} [o.up]   climbing direction (world up)
 * @param {THREE.Vector3} [o.toward] optional attraction point
 * @param {(p)=>boolean} [o.inside] growth region test (world)
 * @param {number} [o.steps] max steps per stem; [o.step] step length (m)
 * @param {number} [o.branch] branching probability per step
 * @param {number} [o.leafEvery] steps between leaves; [o.leafSize] [min, max] m
 * @param {string} o.seed
 */
export function growIvy(o) {
  const rng = new RNG('ivy:' + o.seed);
  const sdf = o.sdf;
  const up = (o.up || new THREE.Vector3(0, 1, 0)).clone().normalize();
  const wup = new THREE.Vector3(0, 1, 0); // leaves hang and face the sky whatever the growth direction
  const step = o.step ?? 0.045, maxSteps = o.steps ?? 120;
  const stemR = o.stemRadius ?? 0.011;
  const gs = o.gradSdf || sdf; // optional cheaper field for the surface normal
  const grad = (p, out) => {
    const e = 0.004;
    out.set(gs(p.x + e, p.y, p.z) - gs(p.x - e, p.y, p.z), gs(p.x, p.y + e, p.z) - gs(p.x, p.y - e, p.z), gs(p.x, p.y, p.z + e) - gs(p.x, p.y, p.z - e));
    return out.normalize();
  };
  const project = (p, n) => {
    // two cheap steps on the (optional) coarse field, then one exact correction on the full field
    if (o.gradSdf) { const d = gs(p.x, p.y, p.z) - stemR * 0.8; grad(p, n); p.addScaledVector(n, -d); }
    const kmax = o.gradSdf ? 1 : 3;
    let d = 0;
    for (let k = 0; k < kmax; k++) { d = sdf(p.x, p.y, p.z) - stemR * 0.8; if (k > 0 || !o.gradSdf) grad(p, n); p.addScaledVector(n, -d); }
    return Math.abs(d) < 0.05;
  };
  const stems = []; // { pts: [Vector3], r0 }
  const leaves = []; // { pos, normal, dir, size, young }
  const queue = o.seeds.map((s, i) => ({ p: s.clone(), t: null, life: maxSteps * rng.range(0.7, 1.1), r: stemR * rng.range(0.9, 1.4), gen: 0, id: i }));
  const n = new THREE.Vector3(), tmp = new THREE.Vector3(), side = new THREE.Vector3();
  let budget = o.maxStems ?? 220;
  while (queue.length && budget-- > 0) {
    const st = queue.shift();
    const p = st.p.clone();
    if (!project(p, n)) continue;
    let t = st.t ? st.t.clone() : up.clone();
    t.addScaledVector(n, -t.dot(n)).normalize();
    if (!isFinite(t.x) || t.lengthSq() < 0.5) { t.set(rng.range(-1, 1), 0, rng.range(-1, 1)).addScaledVector(n, -0); t.addScaledVector(n, -t.dot(n)).normalize(); }
    const pts = [p.clone()];
    let leafCount = 0;
    for (let i = 0; i < st.life; i++) {
      // wander + climb + attraction
      const wa = rng.gauss(0, 0.32);
      side.crossVectors(n, t).normalize();
      t.addScaledVector(side, Math.tan(wa)).normalize();
      tmp.copy(up).addScaledVector(n, -up.dot(n));
      t.addScaledVector(tmp, o.climb ?? 0.25).normalize();
      if (o.toward) { tmp.copy(o.toward).sub(p); tmp.addScaledVector(n, -tmp.dot(n)).normalize(); t.addScaledVector(tmp, o.attract ?? 0.15).normalize(); }
      p.addScaledVector(t, step * rng.range(0.8, 1.2));
      if (!project(p, n)) break;
      if (o.inside && !o.inside(p)) break;
      t.copy(p).sub(pts[pts.length - 1]); t.addScaledVector(n, -t.dot(n)).normalize();
      pts.push(p.clone());
      // leaves
      if (i % (o.leafEvery ?? 2) === 0) {
        const s = rng.chance(0.5) ? 1 : -1;
        side.crossVectors(n, t).normalize().multiplyScalar(s);
        const age = 1 - i / st.life;
        const size = THREE.MathUtils.lerp(o.leafSize?.[0] ?? 0.07, o.leafSize?.[1] ?? 0.16, Math.pow(rng.random(), 0.8)) * (0.6 + 0.4 * age);
        const dir = side.clone().multiplyScalar(0.6).addScaledVector(t, rng.range(-0.2, 0.4)).addScaledVector(wup, -rng.range(0.2, 0.7)).normalize();
        const nrm = n.clone().multiplyScalar(0.9).addScaledVector(wup, o.leafUp ?? 0.22).add(new THREE.Vector3(rng.gauss(0, 0.16), rng.gauss(0, 0.16), rng.gauss(0, 0.16))).normalize();
        const base = p.clone().addScaledVector(n, stemR + rng.range(0.004, 0.02) + size * 0.12).addScaledVector(side, rng.range(0.01, 0.04));
        leaves.push({ pos: base, normal: nrm, dir, size, young: rng.chance(o.youngFrac ?? 0.08) || i > st.life - 3 });
        leafCount++;
      }
      // branching
      if (st.gen < 4 && rng.chance(o.branch ?? 0.05)) {
        const bt = t.clone().applyAxisAngle(n, rng.sign() * rng.range(0.5, 1.2));
        queue.push({ p: p.clone(), t: bt, life: st.life * rng.range(0.35, 0.7), r: st.r * 0.7, gen: st.gen + 1 });
      }
    }
    if (pts.length > 2) stems.push({ pts, r0: st.r });
  }
  return { stems, leaves };
}

/** build meshes from a growIvy() result */
export function ivyMeshes({ stems, leaves }, o = {}) {
  // stems: tubes with 5 sides, tapering
  const pos = [], nor = [], idx = [];
  const SIDES = 5;
  const tmp = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const s of stems) {
    const P = s.pts, L = P.length;
    const base = pos.length / 3;
    for (let i = 0; i < L; i++) {
      const t = tmp.copy(P[Math.min(L - 1, i + 1)]).sub(P[Math.max(0, i - 1)]).normalize();
      a.set(0, 1, 0); if (Math.abs(t.y) > 0.9) a.set(1, 0, 0);
      b.crossVectors(t, a).normalize(); a.crossVectors(b, t).normalize();
      const r = s.r0 * (1 - 0.75 * (i / (L - 1)));
      for (let k = 0; k < SIDES; k++) {
        const ang = (k / SIDES) * Math.PI * 2;
        const nx = a.x * Math.cos(ang) + b.x * Math.sin(ang), ny = a.y * Math.cos(ang) + b.y * Math.sin(ang), nz = a.z * Math.cos(ang) + b.z * Math.sin(ang);
        pos.push(P[i].x + nx * r, P[i].y + ny * r, P[i].z + nz * r);
        nor.push(nx, ny, nz);
      }
    }
    for (let i = 0; i < L - 1; i++) for (let k = 0; k < SIDES; k++) {
      const k1 = (k + 1) % SIDES;
      const v0 = base + i * SIDES + k, v1 = base + i * SIDES + k1, v2 = base + (i + 1) * SIDES + k, v3 = base + (i + 1) * SIDES + k1;
      idx.push(v0, v2, v1, v1, v2, v3);
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  sg.setIndex(idx);
  const stemMesh = new THREE.Mesh(sg, ivyStemMaterial());
  stemMesh.name = 'ivyStems';

  const geo = ivyLeafGeometry();
  const mat = ivyLeafMaterial();
  const im = new THREE.InstancedMesh(geo, mat, leaves.length);
  im.name = 'ivyLeaves';
  const m = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  const col = new THREE.Color();
  const rng = new RNG('ivyCol' + leaves.length);
  leaves.forEach((l, i) => {
    Z.copy(l.normal);
    if (o.jitter) { Z.x += (rng.next() - 0.5) * 2 * o.jitter; Z.y += (rng.next() - 0.5) * 2 * o.jitter; Z.z += (rng.next() - 0.5) * 2 * o.jitter; Z.normalize(); }
    Y.copy(l.dir).addScaledVector(Z, -l.dir.dot(Z)).normalize();
    X.crossVectors(Y, Z).normalize();
    m.makeBasis(X.multiplyScalar(l.size), Y.multiplyScalar(l.size), Z.multiplyScalar(l.size));
    m.setPosition(l.pos);
    im.setMatrixAt(i, m);
    if (l.young) col.setRGB(rng.range(0.055, 0.09), rng.range(0.075, 0.11), rng.range(0.01, 0.02));
    else { const k = rng.range(0.8, 1.35); col.setRGB(0.026 * k, rng.range(0.042, 0.06) * k, 0.011 * k); } // ref 8/9: deep but lively green
    im.setColorAt(i, col);
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  return { stemMesh, leafMesh: im };
}
