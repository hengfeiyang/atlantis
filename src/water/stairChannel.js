// r5: the water of the central channel down the grand stair (ref 1: a white cascade on the citadel axis). OWNER: water.
//
// The citadel module builds the stone (temple.js buildStairChannel) and publishes its plan:
//   engine.registry.temple.stairChannel = stairChannelPlan() = { x, half (inner half-width), rim, lip,
//     pools: [{k, za, zb, floorY, crestY, rimY}] (one basin per landing, weir at zb), chutes: [{k, za, zb, ya, yb, n, riser, tread}]
//     (stepped chute per flight), floor(z), surface(z), source {pos, dir}, spout {pos, dir, dropTo}, path }
// The water:
//   - CHUTES: skimming flow over the steps — a sheet on the pseudo-bottom through the step nosings + 0.15 m, guided down
//     the chute (no free tracing: it would hop treads or slide into the walls), with a 1-D flow speed (gravity along the
//     37° pseudo-bottom vs the drag of the steps → ≈ 5.5 m/s at the foot). Shaped like a traced fall, so fallMesh's
//     sheets / strands (white froth: spec.aer) and the cascade mist (spray where each chute hits the next basin) apply.
//   - POOLS: calm basins on every landing + the trough across the quay (reflective dark-teal water, foam where the chute
//     plunges in and on the weir crest).
//   - POUR: from the spout lip over water ring 1 (a traced spout fall → impact foam, churn, mist).
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';

const G = 9.81;
const STRIDE = 8;

/** the published plan (or null) */
export function stairChannelSpec(engine) {
  const ch = engine.registry?.temple?.stairChannel;
  if (!ch || !Array.isArray(ch.chutes) || !ch.chutes.length || !Array.isArray(ch.pools)) return null;
  return ch;
}

/** a guided chute: from (za, ya) to (zb, yb) along +z at x = cx, water surface on the pseudo-bottom + depth */
function guidedChute(ch, F, { id, width, depth = 0.15, dt = 1 / 60, v0 = 1.4, flow = 0.75 }) {
  const cx = ch.x ?? 0;
  const za = F.za - 0.35, zb = F.zb;   // (starts on the weir crest of the basin above)
  const yTop = F.ya + (ch.lip ?? 0.22) + 0.08;
  const yS = (z) => (z <= F.za ? yTop + (F.ya + depth - yTop) * Math.max(0, (z - za) / (F.za - za)) : F.ya + depth - ((z - F.za) * (F.ya - F.yb)) / (F.zb - F.za));
  const slope = (F.ya - F.yb) / (F.zb - F.za), sin = slope / Math.hypot(1, slope), cos = 1 / Math.hypot(1, slope);
  const c = 0.19;
  const K = Math.max(3, Math.min(9, Math.round(width / 1.0) + 1));
  const streams = [];
  let center = null;
  for (let j = 0; j < K; j++) {
    const u = K === 1 ? 0.5 : j / (K - 1);
    const off = (u - 0.5) * width;
    const cap = Math.ceil(((zb - za) / 1.0) / dt) + 8;
    const out = new Float32Array(cap * STRIDE);
    let n = 0, z = za, v = v0 * (0.95 + 0.1 * Math.sin(j * 2.3)), path = 0, prev = null;
    while (n < cap) {
      const zz = Math.min(z, zb);
      const s = zz < F.za ? 0.15 : sin;
      const y = yS(zz) + 0.025 * Math.sin(zz * 2.1 + j * 1.7);
      const x = cx + off;
      if (prev) path += Math.hypot(x - prev[0], y - prev[1], zz - prev[2]);
      const k = n * STRIDE;
      out[k] = x; out[k + 1] = y; out[k + 2] = zz; out[k + 3] = path; out[k + 4] = 1;
      out[k + 5] = 0; out[k + 6] = -v * s; out[k + 7] = v * (zz < F.za ? 1 : cos);
      n++;
      prev = [x, y, zz];
      if (zz >= zb) break;
      v = Math.max(1.0, v + (G * s - c * v * v) * dt);
      z += v * (zz < F.za ? 1 : cos) * dt;
    }
    const kE = (n - 1) * STRIDE;
    const st = { samples: out, count: n, stride: STRIDE, dtRec: dt, u, off,
      end: { type: 'channel', x: out[kE], y: out[kE + 1], z: out[kE + 2], vx: 0, vy: out[kE + 6], vz: out[kE + 7], speed: v, t: n * dt, path }, landings: [] };
    streams.push(st);
    if (j === Math.floor(K / 2)) center = st;
  }
  const yBot = F.yb + depth;
  const e = center.end;
  return {
    id, kind: 'hill', spec: { id, kind: 'hill', width, flow, aer: 1.5, from: [cx, yTop, za] },
    lip: { x: cx, y: yTop, z: za, dx: 0, dz: 1, snapped: true, s: 0 },
    dir: [0, 1], across: [-1, 0], width, flow, K, streams, impact: null,
    // the chute shoots into the next basin: spray + a hydraulic jump (mist "landing")
    landings: [{ x: cx, y: yBot, z: F.zb + 0.6, speed: e.speed * 2.6, t: e.t, path: e.path }],
    drop: yTop - yBot, ends: streams.map((s) => s.end), guided: true,
  };
}

/** ground for buildSheet's drape: the water surface itself (no push-out), flat normal */
function sheetGround() { return { H: () => -1e4, N: () => [0, 1, 0] }; }

/** pool / trough water: reflective dark teal with slow ripples, foam where the chute plunges in and along the weir */
function poolMaterial(uTime, uEnv) {
  const mat = proceduralMaterial({
    name: 'stairPoolWater', type: 'physical',
    params: { color: 0xffffff, roughness: 0.06, metalness: 0, ior: 1.333, specularIntensity: 1, clearcoat: 0 },
    uniforms: { uTime },
    head: `uniform float uTime; varying vec4 vPool; float spF;`,
    vertexHead: `attribute vec4 aPool; varying vec4 vPool;`,
    vertexPre: `vPool = aPool;`,
    color: `
      // vPool: x = metres from the upstream (plunge) end, y = metres to the weir, z = across (-1..1), w = plunge strength
      vec2 q = cgP.xz;
      float n1 = cgVnoise2(q * 1.3 + vec2(0.0, -uTime * 0.9)), n2 = cgVnoise2(q * 3.7 + vec2(1.7, -uTime * 1.6));
      float plunge = vPool.w * exp(-vPool.x / 1.6) * (0.55 + 0.45 * n1);
      float weir = exp(-vPool.y / 0.35) * 0.5;
      float edge = smoothstep(0.82, 1.0, abs(vPool.z)) * 0.35;
      float f = clamp(plunge * 1.3 + weir + edge, 0.0, 1.0);
      spF = smoothstep(0.35, 0.75, f * (0.6 + 0.6 * n2));
      diffuseColor.rgb = mix(vec3(0.02, 0.07, 0.075), vec3(0.78, 0.82, 0.84), spF);`,
    roughness: `roughnessFactor = mix(0.05, 0.6, spF);`,
    normal: `
      vec2 q = cgP.xz;
      float e = 0.15;
      float h0 = cgVnoise2(q * 1.6 + vec2(0.0, -uTime * 0.7)) + 0.5 * cgVnoise2(q * 4.1 + vec2(uTime * 0.3, -uTime * 1.2));
      float hx = cgVnoise2((q + vec2(e, 0.0)) * 1.6 + vec2(0.0, -uTime * 0.7)) + 0.5 * cgVnoise2((q + vec2(e, 0.0)) * 4.1 + vec2(uTime * 0.3, -uTime * 1.2));
      float hz = cgVnoise2((q + vec2(0.0, e)) * 1.6 + vec2(0.0, -uTime * 0.7)) + 0.5 * cgVnoise2((q + vec2(0.0, e)) * 4.1 + vec2(uTime * 0.3, -uTime * 1.2));
      float amp = 0.035 * (1.0 + 3.0 * vPool.w * exp(-vPool.x / 2.0));
      cgBump = vec3(-(hx - h0) / e * amp, 0.0, -(hz - h0) / e * amp);`,
  });
  // the IBL is scaled down for diffuse fill (SKY.uEnvScale): the basins mirror the full sky like the ring water (uEnvBoost)
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    base(shader, r);
    shader.uniforms.uPoolEnv = uEnv;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uPoolEnv;\nvoid main() {')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n#if defined( RE_IndirectSpecular )\n  radiance *= mix(uPoolEnv, 1.0, spF);\n#endif');
  };
  mat.userData.shaderKey += ':pe1';
  mat.userData.sunken = 'none';
  return mat;
}

function poolGeometry(x0, x1, za, zb, y, plunge) {
  const nx = 6, nz = Math.max(2, Math.round((zb - za) / 0.6));
  const pos = [], ap = [], idx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx, z = za + ((zb - za) * j) / nz;
    pos.push(x, y, z);
    ap.push(z - za, zb - z, ((i / nx) - 0.5) * 2, plunge);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('aPool', new THREE.Float32BufferAttribute(ap, 4));
  g.setIndex(idx);
  return g;
}

/**
 * @returns {{ falls, pour, poolMesh, uniforms, sheetGround }} | null
 *   falls: guided chute falls (for buildCascadeMeshes), pour: a spout spec for traceCascades (the mouth over ring 1),
 *   poolMesh: the basins (+ quay trough) water
 */
export function buildStairChannelWater(engine, ch, { mergeGeometries } = {}) {
  const half = ch.half ?? 2.4, cx = ch.x ?? 0;
  const width = half * 2 * 0.93;
  const falls = ch.chutes.map((F) => guidedChute(ch, F, { id: `stair-chute-${F.k}`, width, flow: 0.7 }));
  // basins: pool k+1 receives chute k (pool 0: the shell source on the top landing)
  const uTime = { value: 0 }, uEnv = { value: 1 / 0.34 };
  const geos = [];
  for (const P of ch.pools) {
    const y = (P.crestY ?? P.floorY + 0.22) + 0.08;
    geos.push(poolGeometry(cx - half, cx + half, P.za, P.zb, y, P.k === 0 ? 0.35 : 1.0));
  }
  const sp = ch.spout;
  const lastF = ch.chutes[ch.chutes.length - 1];
  if (sp && lastF) geos.push(poolGeometry(cx - half, cx + half, lastF.zb, sp.pos[2], sp.pos[1], 1.0));
  let poolMesh = null;
  if (geos.length && mergeGeometries) {
    const merged = mergeGeometries(geos, false);
    poolMesh = new THREE.Mesh(merged, poolMaterial(uTime, uEnv));
    poolMesh.name = 'stairChannelPools';
    poolMesh.userData.isWater = true;
    poolMesh.castShadow = false; poolMesh.receiveShadow = true;
    poolMesh.userData.castShadow = false; poolMesh.userData.receiveShadow = true;
  }
  let pour = null;
  if (sp && sp.pos[1] - (sp.dropTo ?? 0) > 1.2) {
    const d = sp.dir || [0, 0, 1];
    const bearing = ((Math.atan2(d[0], -d[2]) * 180) / Math.PI + 360) % 360;
    pour = {
      id: 'stair-pour', kind: 'spout', from: [sp.pos[0], sp.pos[1] + 0.05, sp.pos[2] + 0.2], dir: bearing, width: width * 0.95, flow: 0.85,
      snap: false, v0: 2.6, fan: 0.25, widen: 0.2, widenDrop: 4, aer: 1.0, bearing,
    };
  }
  return { falls, pour, poolMesh, uniforms: { uTime, uEnv }, sheetGround: sheetGround() };
}
