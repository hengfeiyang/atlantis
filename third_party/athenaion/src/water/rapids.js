// Boulders in the rapids (ref 7: the river at the camera, white water breaking around rocks below
// the falls). Placed through the shot-7 camera at reference pixel positions, kept only where the ray
// reaches open water unobstructed (the captured terrain + architecture height map), clear of the
// plunge pools. Uses the shared stone family (src/materials/stone.js createRock / rockMaterial) with a
// wet, algae-darkened band at the water line. The rocks are returned as flow obstacles
// ({x, z, r}) so the flow map adds a foam collar and a white wake downstream of each one.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHOTS } from '../world/shots.js';

// [px, py (reference pixels, 1672x941), radius at the water line (m), height above the water (m)]
// (only the rocks at the foot of the cascade band: the ref-7 foreground below y ≈ 820 is open glassy water)
const SHOT7_ROCKS = [
  [1285, 806, 2.6, 1.7], [1560, 812, 3.2, 2.3], [1405, 796, 1.7, 1.1],
  [1060, 812, 2.0, 1.2], [1180, 790, 1.5, 0.9], [1520, 790, 1.8, 1.2],
];

export async function buildRapidsRocks(engine, { ground, level = 0, impacts = [], shotId = 7 } = {}) {
  const t0 = performance.now();
  const shot = SHOTS.find((s) => s.id === shotId);
  if (!shot) return null;
  let S;
  try { S = await import('../materials/stone.js'); } catch (e) { return null; }
  if (!S.createRock || !S.rockMaterial) return null;
  const cam = new THREE.PerspectiveCamera(shot.fov, 1672 / 941, 0.1, 5000);
  cam.position.set(...shot.pos);
  cam.lookAt(new THREE.Vector3(...shot.target));
  cam.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  const rng = engine.rng('rapids-rocks');
  const rocks = [], geos = [];
  // candidates: [x, z, r, h, weir] — the pixel list through the camera, plus a broken weir of rocks
  // just downstream of every strong plunge the camera sees (white water pours around them, ref 7)
  const cand = [];
  for (const [px, py, r, h] of SHOT7_ROCKS) {
    rc.setFromCamera(new THREE.Vector2((px / 1672) * 2 - 1, -((py / 941) * 2 - 1)), cam);
    const o = rc.ray.origin, d = rc.ray.direction;
    if (d.y >= -1e-3) continue;
    const t = (level - o.y) / d.y;
    cand.push([o.x + d.x * t, o.z + d.z * t, r, h, false]);
  }
  for (const im of impacts) {
    if (!im || im.soft || im.strength < 0.6 || im.radius < 6 || !im.dir) continue;
    if (Math.hypot(im.x - shot.pos[0], im.z - shot.pos[2]) > 160) continue;
    const a0 = Math.atan2(im.dir[1], im.dir[0]);
    const n = 3 + Math.round(rng.range(0, 2));
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / (n - 1) - 0.5) * 2.2 + rng.range(-0.15, 0.15);
      const dd = im.radius * rng.range(1.0, 1.45);
      cand.push([im.x + Math.cos(a) * dd, im.z + Math.sin(a) * dd, rng.range(1.0, 2.2), rng.range(0.5, 1.3), true]);
    }
  }
  const camP = new THREE.Vector3(...shot.pos);
  const rej = { shallow: 0, hidden: 0, plunge: 0, overlap: 0 };
  for (const [x, z, r, h, weir] of cand) {
    // visibility of the rock top (not its water line: low rocks behind a ripple of shore are fine)
    const o = camP, dist = Math.hypot(x - o.x, level + h - o.y, z - o.z);
    const d = new THREE.Vector3(x - o.x, level + h - o.y, z - o.z).normalize();
    const t = dist;
    // open water (the captured height includes the architecture: quays, stair arcades)
    if (level - ground.H(x, z) < 0.3) { rej.shallow++; continue; }
    // nothing in front of it along the ray
    let hidden = false;
    for (let s = 2; s < t - r; s += 1.0) { const qx = o.x + d.x * s, qy = o.y + d.y * s, qz = o.z + d.z * s; if (ground.H(qx, qz) > qy) { hidden = true; break; } }
    if (hidden) { rej.hidden++; continue; }
    // clear of the plunge pools (the falling sheets would cut through the rock)
    if (!weir && impacts.some((im) => im && Math.hypot(im.x - x, im.z - z) < im.radius * 0.8 + r)) { rej.plunge++; continue; }
    if (weir && impacts.some((im) => im && Math.hypot(im.x - x, im.z - z) < im.radius * 0.75)) { rej.plunge++; continue; }
    if (rocks.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + r + 0.5)) { rej.overlap++; continue; }
    const sub = 1.2 + r * 0.6;                        // submerged part
    const H = h + sub;
    const g = S.createRock(rng, { size: [r * 2.2, H, r * 2.0 * rng.range(0.8, 1.1)], shape: 'boulder', detail: 4, roughness: 1.1, cracks: 1.0, strata: 0.4, flatBottom: 0 });
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, level + h - H / 2, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.08, 0.08), rng.range(0, Math.PI * 2), rng.range(-0.08, 0.08))),
      new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    geos.push(g);
    rocks.push({ x, z, r: r * 1.05, h, weir });
  }
  if (!geos.length) return { rocks, mesh: null, rej, cand: cand.length, ms: Math.round(performance.now() - t0) };
  const geo = mergeGeometries(geos, false);
  geo.computeBoundingSphere();
  const mat = S.rockMaterial({ moss: 0.55, lichen: 0.35, streaks: 0.3, strata: 0.3, ochre: 0.25, wetBelow: level + 0.75, bump: 1.25, variation: 0.25, darkness: 0.18, scale: 1.4 });
  mat.name = 'rapidsRock';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'rapidsRocks';
  for (const q of rocks) engine.footprints?.addCircle?.(q.x, q.z, q.r + 0.5, 'rock');
  return { rocks, mesh, rej, cand: cand.length, ms: Math.round(performance.now() - t0) };
}

/** terrain boulders standing in the rapids reach (terrain-boulders instanced meshes) → flow obstacles
 *  ({x, z, r}): foam collar + white wake. Submerged tops (< 0.4 m under) still boil the surface. */
export function reachObstacles(engine, reach, level = 0) {
  const out = [];
  const g = engine.scene.getObjectByName('terrain-boulders');
  if (!g || !reach) return out;
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const [fx, fz] = reach.fwd;
  g.traverse((o) => {
    if (!o.isInstancedMesh) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m4); m4.premultiply(o.matrixWorld); m4.decompose(p, q, s);
      const rx = p.x - reach.cam[0], rz = p.z - reach.cam[1];
      const al = rx * fx + rz * fz, ac = -rx * fz + rz * fx;
      if (al < 3 || al > reach.length + 5 || Math.abs(ac) > al * 0.75 + 22) continue;
      const top = p.y + bb.max.y * s.y, bot = p.y + bb.min.y * s.y;
      if (top < level - 0.4 || bot > level + 0.2) continue;
      const r = 0.5 * Math.max((bb.max.x - bb.min.x) * s.x, (bb.max.z - bb.min.z) * s.z) * 0.9;
      if (r < 0.35) continue;
      const cc = new THREE.Vector3().addVectors(bb.min, bb.max).multiplyScalar(0.5).applyMatrix4(m4);   // (instance origin is not the boulder centre)
      out.push({ x: cc.x, z: cc.z, r: Math.min(r, 3.5), h: top - level, sub: top < level });
    }
  });
  return out;
}

/** short weir pours along the rapids sill crest: wherever the bed crest sits within ~0.45 m of the
 *  surface (chutes between the sill blocks) the current spills over it toward the camera (ref 7's
 *  band of white water). Only chutes the given camera sees are kept. Returns waterfall specs. */
export function planWeirs(ground, reach, { level = 0, camPos = null, rng } = {}) {
  if (!reach) return [];
  const [fx, fz] = reach.fwd, ax = -fz, az = fx;
  const pts = [];
  for (let ac = -70; ac <= 80; ac += 2.5) {
    let best = null;
    for (let al = reach.sill - 14; al <= reach.sill + 14; al += 0.5) {
      const x = reach.cam[0] + fx * al + ax * ac, z = reach.cam[1] + fz * al + az * ac;
      const h = ground.H(x, z);
      const sc = h - 0.012 * Math.abs(al - reach.sill);
      if (h < level + 0.32 && (!best || sc > best.sc)) best = { x, z, h, al, ac, sc };
    }
    if (!best || best.h < level - 0.5) { pts.push(null); continue; }
    // the bed just downstream (toward the camera) must be lower: a real step to pour over
    const dn = ground.H(best.x - fx * 2.5, best.z - fz * 2.5);
    if (best.h - dn < 0.25) { pts.push(null); continue; }
    if (camPos) {
      const tx = best.x, ty = level + 0.5, tz = best.z;
      const d = Math.hypot(tx - camPos[0], ty - camPos[1], tz - camPos[2]);
      let hidden = false;
      for (let s = 3; s < d - 2; s += 1.0) {
        const k = s / d, qx = camPos[0] + (tx - camPos[0]) * k, qy = camPos[1] + (ty - camPos[1]) * k, qz = camPos[2] + (tz - camPos[2]) * k;
        if (ground.H(qx, qz) > qy) { hidden = true; break; }
      }
      if (hidden) { pts.push(null); continue; }
    }
    pts.push(best);
  }
  // contiguous chutes → weirs (≤ 9 m wide)
  const specs = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    for (let i = 0; i < run.length; i += 4) {
      const seg = run.slice(i, i + 4);
      const cx = seg.reduce((a, p) => a + p.x, 0) / seg.length, cz = seg.reduce((a, p) => a + p.z, 0) / seg.length;
      const ch = Math.max(...seg.map((p) => p.h));
      const w = Math.max(2.6, seg.length * 2.5) * (rng ? rng.range(0.9, 1.15) : 1);
      specs.push({
        id: 'weir-' + specs.length, from: [cx, Math.max(ch, level - 0.1) + 0.45 + (rng ? rng.range(0, 0.3) : 0.15), cz],
        dirVec: [-fx, -fz], width: w, flow: 0.6, snap: false, v0: 2.2, fan: 0.25, aer: 1.6, weir: true,
      });
    }
    run = [];
  };
  for (const p of pts) { if (p) run.push(p); else flush(); }
  flush();
  return specs;
}

/**
 * Shot-7 cascade band (ref 7: the plunge pools at the foot of the sheer bay spill toward the camera over a
 * rubble weir of big wet boulders, a continuous band of white cascades ~3 m high between dark rocks).
 * The weir line runs across the bay foot in front of the plunge pools (A → B, world XZ). Rocks alternate
 * with notches; each notch carries a pour spec (traced over a crest table added to the ground) and a low
 * sill block under the pour. Returns { specs, groundC, mesh, rocks, ms } — specs are waterfall specs
 * (cascade: true), groundC wraps the given ground with the crest tables (use it to trace/mesh the pours).
 */
export async function planCascade(engine, { ground, level = 0, A = [50.5, 51.2], B = [84, 48.3], rng } = {}) {
  const t0 = performance.now();
  let S;
  try { S = await import('../materials/stone.js'); } catch (e) { return null; }
  if (!S.createRock || !S.rockMaterial) return null;
  rng = rng || engine.rng('cascade');
  const lx = B[0] - A[0], lz = B[1] - A[1], Lline = Math.hypot(lx, lz);
  const tx = lx / Lline, tz = lz / Lline;
  // downstream normal: the side of the line facing the shot-7 camera (+z, toward the river)
  let nx = -tz, nz = tx;
  if (nz < 0) { nx = -nx; nz = -nz; }
  const P = (s, n) => [A[0] + tx * s + nx * n, A[1] + tz * s + nz * n];
  const notches = [], rocks = [], geos = [];
  // alternate rock / notch along the line (rock at both ends)
  let s = 0, isRock = true;
  while (s < Lline) {
    const w = isRock ? rng.range(1.4, 3.0) : rng.range(3.5, 7.5);
    const s1 = Math.min(Lline, s + w);
    if (isRock) rocks.push({ s0: s, s1 });
    else if (s1 - s > 2.2) {
      // a notch pours as 1-3 tongues over crest steps of slightly different heights (irregular rock lip)
      const hc = level + rng.range(2.6, 3.9), nP = Math.max(1, Math.min(3, Math.floor((s1 - s) / 2.3)));
      const cuts = [s]; for (let k = 1; k < nP; k++) cuts.push(s + (s1 - s) * (k / nP + rng.range(-0.08, 0.08)));
      cuts.push(s1);
      for (let k = 0; k < nP; k++) notches.push({ s0: cuts[k], s1: cuts[k + 1], hc: hc + (k ? rng.range(-0.55, 0.45) : 0), sub: k });
    }
    s = s1; isRock = !isRock;
  }
  // crest tables under the notches (the pours run over them): flat top 2.8 m deep upstream of the line,
  // a near-vertical downstream face
  const tables = notches.map((q) => ({ ...q }));
  const groundC = {
    H: (x, z) => {
      let h = ground.H(x, z);
      const rx = x - A[0], rz = z - A[1], ss = rx * tx + rz * tz, nn = rx * nx + rz * nz;
      if (nn < -3.2 || nn > 0.6) return h;
      for (const q of tables) {
        if (ss < q.s0 - 0.3 || ss > q.s1 + 0.3) continue;
        const hq = q.hc + 0.22 * Math.sin(ss * 1.9 + q.s0 * 3.1) + 0.12 * Math.sin(ss * 5.3 + q.s0);
        const top = nn <= 0 ? hq : hq - (nn / 0.6) * (hq - level + 2);
        if (top > h) h = top;
      }
      return h;
    },
  };
  groundC.N = (x, z, e = 0.8) => {
    const hx = groundC.H(x + e, z) - groundC.H(x - e, z), hz = groundC.H(x, z + e) - groundC.H(x, z - e);
    const ax = -hx, ay = 2 * e, az = -hz, l = Math.hypot(ax, ay, az);
    return [ax / l, ay / l, az / l];
  };
  const rot = (yaw) => new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.06, 0.06), yaw, rng.range(-0.06, 0.06)));
  const yawLine = Math.atan2(-tz, tx);
  const addRock = (cx, cz, w, top, depth, shape = 'boulder') => {
    const H = top - (level - 1.6);
    const g = S.createRock(rng, { size: [w, H, depth], shape, detail: 4, roughness: 1.15, cracks: 1.0, strata: 0.55, flatBottom: 0.2 });
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(cx, level - 1.6 + H / 2, cz), rot(yawLine + rng.range(-0.25, 0.25)), new THREE.Vector3(1, 1, 1)));
    geos.push(g);
  };
  const out = [];
  // big boulders between the pours (standing 0.6–1.9 m above the neighbouring crests), a smaller one
  // tumbled in front of some
  for (let i = 0; i < rocks.length; i++) {
    const r = rocks[i];
    const hcN = Math.max(level + 2.6, ...notches.filter((q) => Math.abs(q.s0 - r.s1) < 0.5 || Math.abs(q.s1 - r.s0) < 0.5).map((q) => q.hc));
    const w = (r.s1 - r.s0) + rng.range(0.6, 1.4), top = hcN + rng.range(0.25, 1.1);
    const [cx, cz] = P((r.s0 + r.s1) / 2, rng.range(-0.8, 0.4));
    if (ground.H(cx, cz) > level + 1.0) continue;   // (pours may break over a low shoal: the high-quality terrain has one at x > 70)
    addRock(cx, cz, w, top, rng.range(3.2, 4.6));
    out.push({ x: cx, z: cz, r: w * 0.5, h: top - level });
    if (rng.random() < 0.6) {
      const [fx, fz] = P((r.s0 + r.s1) / 2 + rng.range(-1, 1), rng.range(1.6, 3.2));
      const ww = rng.range(1.2, 2.4);
      addRock(fx, fz, ww, level + rng.range(0.4, 1.3), ww * rng.range(0.8, 1.1));
      out.push({ x: fx, z: fz, r: ww * 0.5, h: 0.8 });
    }
  }
  // sill blocks under the pours (their top is the crest table; slightly set back so the pour drapes over them)
  const specs = [];
  for (const [k, q] of notches.entries()) {
    const sm = (q.s0 + q.s1) / 2, w = q.s1 - q.s0;
    const [cx, cz] = P(sm, -1.4);
    if (ground.H(cx, cz) > level + 1.0) continue;   // (pours may break over a low shoal: the high-quality terrain has one at x > 70)
    addRock(cx, cz, w + 0.6, q.hc - 0.15, 3.0, 'slab');
    // a low rock or two in the foot of the pour (white water breaks over them, ref 7)
    if (rng.random() < (q.sub ? 0.25 : 0.6)) { const [fx, fz] = P(sm + rng.range(-w * 0.3, w * 0.3), rng.range(1.2, 2.6)); addRock(fx, fz, rng.range(0.9, 1.7), level + rng.range(0.2, 0.7), 1.3); }
    const [lx0, lz0] = P(sm, -0.55);
    specs.push({ id: 'cascade-' + k, from: [lx0, q.hc + 0.3, lz0], dirVec: [nx, nz], width: w * 1.1, flow: 0.9, snap: false, v0: 1.7, fan: 0.35, aer: 1.4, lipJitter: 0.7, cascade: true });
  }
  let mesh = null;
  if (geos.length) {
    const geo = mergeGeometries(geos, false);
    geo.computeBoundingSphere();
    const mat = S.rockMaterial({ tint: new THREE.Color(1.35, 1.3, 1.2), moss: 0.4, lichen: 0.35, streaks: 0.45, strata: 0.4, ochre: 0.25, wetBelow: level + 0.9, bump: 1.3, variation: 0.3, darkness: 0.04, scale: 1.2 });
    mat.name = 'cascadeRock';
    mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'cascadeRocks';
    for (const q of out) engine.footprints?.addCircle?.(q.x, q.z, q.r + 0.5, 'rock');
  }
  return { specs, groundC, mesh, rocks: out, notches: notches.length, ms: Math.round(performance.now() - t0) };
}
