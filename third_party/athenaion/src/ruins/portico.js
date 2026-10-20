// The ruined Corinthian portico set (shot 9 / ref 9), composed from the shot-9 camera:
//   left: a huge cracked fluted column right in front of the camera (ivy), a fallen Attic base lying
//   on its side with a carved rosette, a low wall of rough blocks; centre: worn paving on a podium;
//   right: a Corinthian column on a step block, a ruined pier behind it, the broken architrave
//   across the top, a massive banner pier on the far right (banner slot), a brazier on a moulded
//   pedestal (brazier slot), a big rough block in the foreground.
import * as THREE from 'three';
import * as ARCH from '../arch/index.js';
import { atPixel, atPixelPlane, shotCam, camHeading, toPixel } from './camspace.js';
import { heightAt } from '../world/heightfield.js';
import { growIvy, ivyMeshes } from './ivy.js';
import { pixelRay } from './camspace.js';

export const FLOOR_DROP9 = 1.6; // nominal paving floor = camera-9 height - this (raised to clear the terrain)
let FLOOR9 = null;
/** paving floor height: eye - FLOOR_DROP9, but never below the terrain under the visible paving */
export function floor9(c, f, u) {
  if (FLOOR9 !== null) return FLOOR9;
  let mx = -1e9;
  for (let ff = -1; ff <= 10; ff += 0.5) for (let uu = -7.5; uu <= 7.5; uu += 0.5) {
    const x = c.pos.x + f.x * ff + u.x * uu, z = c.pos.z + f.z * ff + u.z * uu;
    mx = Math.max(mx, heightAt(x, z));
  }
  FLOOR9 = Math.max(c.pos.y - FLOOR_DROP9, mx + 0.06);
  return FLOOR9;
}

// rough stones placed from shot-9 pixels (centre pixel + depth, or ground: on the floor)
export const PORTICO_STONES = [
  { id: 'p1', px: [10, 880], depth: 4.3, dims: [1.05, 0.85, 0.9], yaw: 8, tilt: [0, 3], chips: 9, floor: true, broken: -1 },
  { id: 'p2', px: [455, 765], depth: 7.2, dims: [1.6, 0.92, 0.82], yaw: -6, tilt: [0, -2], chips: 8, floor: true, broken: 1 },
  { id: 'p3', px: [615, 768], depth: 7.6, dims: [1.05, 0.86, 0.78], yaw: 12, tilt: [2, 0], chips: 8, floor: true },
  { id: 'p4', px: [1450, 905], depth: 3.5, dims: [2.2, 0.8, 1.3], yaw: -14, tilt: [0, 2], chips: 10, floor: true, split: 1 },
  { id: 'p5', px: [915, 812], depth: 8.3, dims: [0.55, 0.32, 0.45], yaw: 30, tilt: [6, 8], chips: 6, floor: true },
  { id: 'p6', px: [1172, 822], depth: 7.9, dims: [0.48, 0.26, 0.4], yaw: -20, tilt: [-5, 6], chips: 6, floor: true },
  { id: 'p7', px: [1085, 806], depth: 9.4, dims: [0.36, 0.22, 0.3], yaw: 50, tilt: [8, 0], chips: 5, floor: true },
  { id: 'p8', px: [1580, 720], depth: 9.6, dims: [0.7, 0.42, 0.55], yaw: 10, tilt: [0, 0], chips: 6, floor: true },
  // fragments on the paving between the columns
  { id: 'p9', px: [760, 832], depth: 7.0, dims: [0.42, 0.24, 0.36], yaw: 25, tilt: [5, 7], chips: 6, floor: true },
  { id: 'p10', px: [1010, 862], depth: 6.4, dims: [0.3, 0.17, 0.27], yaw: -35, tilt: [9, -6], chips: 5, floor: true },
  { id: 'p11', px: [640, 905], depth: 4.9, dims: [0.36, 0.2, 0.3], yaw: 15, tilt: [-7, 10], chips: 6, floor: true },
  { id: 'p12', px: [880, 815], depth: 9.0, dims: [0.6, 0.34, 0.46], yaw: -8, tilt: [2, 3], chips: 7, floor: true, broken: 1 },
];
// SDF pieces: the fallen base with the rosette
const LC = { r: 0.52, h: 1.45, n: 4 };
export const PORTICO_PIECES = [
  ...Array.from({ length: LC.n }, (_, i) => ({ id: 'lc' + (i + 1), type: 'drum', spec: { r: LC.r * (1 - 0.006 * i), h: LC.h, taper: 0.006, flutes: 24, fluteDepth: 0.042, fillet: 0.12, chips: 7 + i, cracks: 3, breakTop: i === LC.n - 1 ? 0.25 : 0, erosion: 0.007, seed: 'lc' + (i + 1), cell: 0.02 } })),
  { id: 'rosbase', type: 'base', spec: { r: 0.31, rosette: 1, roundPlinth: true, shaft: 1.0, breakTop: 0.1, chips: 8, seed: 'rosbase3', cell: 0.014 } },
];

const deg = Math.PI / 180;

/** horizontal frame of camera 9: f = forward, u = right */
export function frame9() {
  const c = shotCam(9);
  const f = new THREE.Vector3(c.fwd.x, 0, c.fwd.z).normalize();
  const u = new THREE.Vector3(-f.z, 0, f.x);
  const floor = floor9(c, f, u);
  return { c, f, u, floor, heading: camHeading(9) };
}

/**
 * Build the portico set. helpers: { geometry(id) → Promise<BufferGeometry>, stoneMat, columnMat, marble, group, engine }
 */
export async function buildPortico(H) {
  const { engine, group } = H;
  const F = frame9();
  const { f, u, floor } = F;
  const q = engine.quality.detail;
  const rotFacing = Math.atan2(-f.x, -f.z); // rotation.y so that local +Z faces the camera (toward -f)
  const marble = H.marble;

  // ---------------------------------------------------------------- podium + paving
  const cam = F.c.pos;
  const P = (fu, ff, y = floor) => new THREE.Vector3(cam.x + f.x * ff + u.x * fu, y, cam.z + f.z * ff + u.z * fu);
  {
    const pod = buildPodiumAndPaving({ F, P, q, seed: 'portico9', uMin: -7.5, uMax: 7.5, fMin: -2.5, fMax: 10.6 });
    pod.paving.material = H.pavingMat; pod.podium.material = H.stoneMat; pod.soil.material = H.soilMat;
    group.add(pod.podium, pod.paving, pod.soil);
    if (H.jointGrass) group.add(H.jointGrass(pod.joints, 'portico9'));
  }

  // ---------------------------------------------------------------- right Corinthian column C1 on a step block
  const c1Base = atPixelPlane(9, 1262, 790, floor); // r4: +57 px so colossus A shows left of the column (ref 9)
  const d1 = c1Base.clone().sub(cam).dot(F.c.fwd);
  const stepH = 0.56; // two-step stylobate (2 × 0.28)
  const colH = (atPixel(9, 1262, 25, d1).y - floor) - stepH;
  const D1 = 0.92;
  {
    const { geometry, info } = ARCH.columnGeometry({ order: 'corinthian', height: colH, diameter: D1, detail: q });
    const m = new THREE.Mesh(geometry, marble);
    m.position.set(c1Base.x, floor + stepH, c1Base.z);
    m.rotation.y = rotFacing + 0.3;
    m.name = 'porticoC1';
    group.add(m);
    F.c1 = { pos: c1Base, top: floor + stepH + info.height, info };
  }
  // two-step stylobate: under C1 and continuing to the banner pier (upper course + a lower, deeper one)
  const sH = stepH / 2;
  for (const [course, n, ofs0, fo, depth] of [[0, 4, -1.05, -0.25, 2.1], [1, 3, -0.7, 0.15, 1.5]]) {
    for (let i = 0; i < n; i++) {
      const w = 1.42 + 0.18 * Math.abs(Math.sin(i * 2.3 + course));
      const g = ARCH.roughBlockGeometry({ size: [w - 0.03, sH - 0.01, depth - 0.05 * (i % 2)], seed: 31 + course * 10 + i, chip: 0.05, broken: i === 0 ? { nx: 0.1 } : {}, detail: q });
      const p = c1Base.clone().addScaledVector(u, ofs0 + i * 1.52).addScaledVector(f, fo + (i % 2) * 0.05);
      const m = new THREE.Mesh(g, marble);
      m.position.set(p.x, floor - 0.02 + course * sH + (i % 3 === 1 ? -0.015 : 0), p.z);
      m.rotation.y = rotFacing + (i - 1.5) * 0.012 + course * 0.01;
      group.add(m);
    }
  }

  // ---------------------------------------------------------------- pier P1 behind C1 (ashlar, impost moulding)
  {
    const base = c1Base.clone().addScaledVector(f, 2.3).addScaledVector(u, 0.85);
    const topY = F.c1.top + 0.75;
    let y = floor - 0.05, i = 0;
    while (y < topY - 0.1) {
      const h = Math.min(0.85 + 0.1 * Math.sin(i * 2.3), topY - y);
      const g = ARCH.roughBlockGeometry({ size: [1.05, h, 1.05], seed: 50 + i, chip: 0.045, detail: q });
      const m = new THREE.Mesh(g, marble);
      m.position.set(base.x + Math.sin(i * 1.7) * 0.03, y, base.z + Math.cos(i * 2.1) * 0.03);
      m.rotation.y = rotFacing + Math.sin(i * 3.1) * 0.02;
      group.add(m);
      y += h; i++;
      if (Math.abs(y - (floor + 4.9)) < 0.45) { // impost moulding course
        const g2 = ARCH.roughBlockGeometry({ size: [1.3, 0.28, 1.3], seed: 77, chip: 0.03, detail: q });
        const m2 = new THREE.Mesh(g2, marble); m2.position.set(base.x, y, base.z); m2.rotation.y = rotFacing; group.add(m2);
        y += 0.28;
      }
    }
  }

  // ---------------------------------------------------------------- banner pier P2 (massive, right edge)
  let p2Front;
  {
    const corner = atPixelPlane(9, 1392, 782, floor); // front-left corner of the pier base course
    const W = 2.7, Dp = 1.6;
    const centre = corner.clone().addScaledVector(u, W / 2).addScaledVector(f, Dp / 2);
    const topY = F.c1.top + 0.8;
    // moulded base course
    const bg = ARCH.pedestalGeometry({ w: W + 0.15, d: Dp + 0.15, h: 0.75, wreath: false, plinth: true, detail: q });
    const bm = new THREE.Mesh(bg, marble); bm.position.set(centre.x, floor - 0.02, centre.z); bm.rotation.y = rotFacing; group.add(bm);
    let y = floor + 0.72, i = 0;
    while (y < topY - 0.1) {
      const h = Math.min(0.95 + 0.12 * Math.sin(i * 1.9), topY - y);
      // two blocks per course, alternating joints
      const split = 0.45 + 0.2 * Math.sin(i * 2.7);
      for (const [a, b] of [[0, split], [split, 1]]) {
        const w = (b - a) * W;
        const g = ARCH.roughBlockGeometry({ size: [w - 0.01, h - 0.008, Dp], seed: 100 + i * 2 + a, chip: 0.04, detail: q });
        const m = new THREE.Mesh(g, marble);
        const cx = -W / 2 + (a + b) / 2 * W;
        const p = centre.clone().addScaledVector(u, cx);
        m.position.set(p.x, y, p.z);
        m.rotation.y = rotFacing;
        group.add(m);
      }
      y += h; i++;
    }
    p2Front = centre.clone().addScaledVector(f, -Dp / 2 - 0.02);
    // banner on the front face (consumed by the banners module)
    const facing = (camHeading(9) + 180) % 360;
    engine.slots.banner.push({ pos: [p2Front.x + u.x * 0.1, topY - 0.15, p2Front.z + u.z * 0.1], facing, size: [1.55, Math.max(3.5, topY - 0.15 - (floor + 1.3))], tag: 'wall', style: 'V', source: 'ruins-portico' });
    engine.slots.ivy.push({ pos: [p2Front.x, floor + 1.5, p2Front.z], facing, size: 2.5, tag: 'ruins-pier' });
    F.p2 = { centre, topY, W, Dp };
  }

  // ---------------------------------------------------------------- architrave across C1 → P2 (broken on the left)
  {
    const L = 6.6;
    const g = ARCH.entablatureFragmentGeometry({ order: 'ionic', D: 0.95, length: L, seed: 7, brokenEnds: [true, false], detail: q });
    const m = new THREE.Mesh(g, marble);
    const mid = F.c1.pos.clone().addScaledVector(u, 0.95).addScaledVector(f, 0.05);
    m.position.set(mid.x, F.c1.top - 0.02, mid.z);
    m.rotation.y = rotFacing;
    group.add(m);
  }

  // ---------------------------------------------------------------- brazier pedestal (slot for the brazier)
  {
    const b = atPixelPlane(9, 1350, 782, floor);
    const h = 0.85;
    const g = ARCH.pedestalGeometry({ w: 0.85, d: 0.85, h, wreath: false, panel: true, plinth: true, detail: q });
    const m = new THREE.Mesh(g, marble);
    m.position.set(b.x, floor - 0.02, b.z); m.rotation.y = rotFacing + 0.12;
    group.add(m);
    engine.slots.brazier.push({ pos: [b.x, floor - 0.02 + h, b.z], facing: (camHeading(9) + 180) % 360, size: 0.75, tag: 'pedestal', source: 'ruins-portico' });
  }

  // ---------------------------------------------------------------- huge fluted column on the left, very near
  {
    // stacked SDF drums (real cracks, chipped flute arrises), weathered like ref 9's left column
    const p = atPixel(9, 209, 470, 7.6);
    const D = LC.r * 2;
    let yy = floor - 0.08;
    for (let i = 0; i < LC.n; i++) {
      const g = await H.geometry('lc' + (i + 1));
      const m = new THREE.Mesh(g, H.columnMat);
      m.position.set(p.x + 0.01 * Math.sin(i * 2.1), yy + LC.h / 2, p.z + 0.01 * Math.cos(i * 1.7));
      m.rotation.set(0.004 * Math.sin(i * 3.3), rotFacing + 0.7 + i * 0.13, 0.004 * Math.cos(i * 2.2));
      m.name = 'porticoLeftColumn';
      m.userData.noFloraIvy = true; // the ruins grow this column's ivy themselves (ref 9: lit fluted marble, ivy on the flanks)
      group.add(m);
      yy += LC.h - 0.004;
    }
    // ivy grown on the column itself (ref 9: dense dark ivy up the left flank and over the front),
    // instead of a generic ivy slot
    {
      const cx = p.x, cz = p.z, y0 = floor - 0.08, y1 = y0 + LC.n * LC.h;
      const R = LC.r - 0.02;
      const csdf = (x, y, z) => {
        const dr = Math.hypot(x - cx, z - cz) - R;
        const dyc = Math.max(y0 - y, y - y1);
        return Math.min(Math.max(dr, dyc), y - floor + 0.02);
      };
      const cam9 = shotCam(9).pos;
      const hitc = (px, py) => { const dir = pixelRay(9, px, py); const q = cam9.clone(); for (let i = 0; i < 120; i++) { const v = csdf(q.x, q.y, q.z); if (v < 0.004) return q; q.addScaledVector(dir, Math.max(v * 0.9, 0.004)); if (q.distanceTo(cam9) > 12) break; } return null; };
      const seeds = [[120, 900], [130, 820], [140, 760], [118, 700], [190, 905], [122, 560], [128, 420], [115, 300], [125, 160], [112, 60], [250, 905], [300, 640]].map((q) => hitc(q[0], q[1])).filter(Boolean);
      // ref 9: the ivy keeps to the left flank of the column (lit marble stays visible) with a few runners
      const region = (q) => { const [x, y, dd] = toPixel(9, q); return dd > 0 && (x < 150 + 90 * Math.max(0, (y - 600) / 340) || (x > 285 && y > 380)) && y > -80; };
      const iv = growIvy({ sdf: csdf, seeds, seed: 'lcol9', steps: 95, step: 0.045, branch: 0.1, leafEvery: 2, leafSize: [0.06, 0.14], climb: 0.6, inside: region, maxStems: 170, stemRadius: 0.012, leafUp: 0.05, youngFrac: 0.08 });
      const { stemMesh, leafMesh } = ivyMeshes(iv, {});
      stemMesh.name = 'columnIvyStems9'; leafMesh.name = 'columnIvyLeaves9';
      group.add(stemMesh, leafMesh);
      console.log(`[ruins] portico column ivy: ${seeds.length} seeds, ${iv.stems.length} stems, ${iv.leaves.length} leaves`);
      // a little ivy at the column foot from the flora module (this "column" slot also tells flora that
      // the ruins dress their own columns, so it does not curtain the shot-3 columns)
      engine.slots.ivy.push({ pos: [p.x, floor - 0.1, p.z], facing: (camHeading(9) + 200) % 360, size: 1.1, height: 1.1, coverage: 0.3, density: 0.8, tag: 'ruins-column-foot', radius: LC.r });
    }
    F.lcol = { pos: new THREE.Vector3(p.x, floor, p.z), r: D / 2 };
  }

  // ---------------------------------------------------------------- fallen Attic base with the rosette
  {
    const g = await H.geometry('rosbase');
    const m = new THREE.Mesh(g, H.columnMat);
    const p = atPixel(9, 444, 862, 4.9); // centre of the carved end face
    // lying on its side: the axis runs left and away from the end face, which (with its rosette)
    // looks camera-right and toward the camera (ref 9 bottom left)
    const nrm = u.clone().multiplyScalar(0.99).addScaledVector(f, -0.12).normalize(); // ref 9: end face seen at a grazing angle, shaft lying to the left
    const dir = nrm.clone().negate(); // local +Y (plinth → shaft)
    const qn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    // roll about the axis so the chips/break are not symmetric
    qn.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, 0.6));
    m.quaternion.copy(qn);
    const rPl = 0.31 * 1.42;
    m.position.set(p.x, floor + rPl - 0.04, p.z);
    m.name = 'rosetteBase';
    group.add(m);
  }

  // ---------------------------------------------------------------- rough stones
  for (const s of PORTICO_STONES) {
    const g = await H.geometry(s.id);
    const mesh = new THREE.Mesh(g, H.stoneMat);
    const c = atPixel(9, s.px[0], s.px[1], s.depth);
    if (s.floor) c.y = floor + s.dims[1] * 0.5 - 0.06;
    const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler((s.tilt?.[0] || 0) * deg, rotFacing + (s.yaw || 0) * deg, (s.tilt?.[1] || 0) * deg, 'YXZ'));
    mesh.position.copy(c); mesh.quaternion.copy(qq);
    mesh.name = 'porticoStone_' + s.id;
    group.add(mesh);
  }
  engine.registry.ruinsPortico = { floor, frame: { f: f.toArray(), u: u.toArray() }, c1: F.c1.pos.toArray(), p2: F.p2.centre.toArray(), lcol: F.lcol.pos.toArray() };
  return F;
}

// ------------------------------------------------------------------ podium & worn paving slabs
// Ref 9: big worn limestone flags, uneven (tilted, sunk, lifted), cracked through, with chipped
// corners and edges, dark soil + grass in the open joints and a few missing slabs.
function buildPodiumAndPaving({ F, P, q, seed, uMin, uMax, fMin, fMax }) {
  const { u, f, floor } = F;
  // podium: a big box from below the terrain to just under the paving
  const corners = [P(uMin, fMin), P(uMax, fMin), P(uMax, fMax), P(uMin, fMax)];
  let lowest = Infinity;
  for (const c of corners) lowest = Math.min(lowest, heightAt(c.x, c.z));
  lowest = Math.max(lowest, floor - 4.5);
  const ph = floor - 0.32 - (lowest - 1.0);
  const podGeo = new THREE.BoxGeometry(uMax - uMin, ph, fMax - fMin, 24, 6, 24);
  const mid = P((uMin + uMax) / 2, (fMin + fMax) / 2);
  const rot = Math.atan2(f.x, f.z);
  const podium = new THREE.Mesh(podGeo, null);
  podium.position.set(mid.x, lowest - 1.0 + ph / 2, mid.z);
  podium.rotation.y = rot;
  podium.name = 'porticoPodium';

  // soil bed under the slabs: shows (dark earth, grass) in the joints and where slabs are missing
  const soilGeo = new THREE.PlaneGeometry(uMax - uMin, fMax - fMin, 4, 4).rotateX(-Math.PI / 2);
  const soil = new THREE.Mesh(soilGeo, null);
  soil.position.set(mid.x, floor - 0.075, mid.z); soil.rotation.y = rot;
  soil.name = 'porticoSoil';

  let r = hashSeed(seed);
  const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  const geos = [];
  const joints = []; // [{p: Vector3 (world), t: Vector3 (joint direction), len}] for the joint grass
  const tmpM = new THREE.Matrix4(), qt = new THREE.Quaternion();
  const res = q >= 1 ? 0.07 : 0.13;
  // one slab piece (local box w × th × d, centred), with worn / chipped top
  const piece = (w, d, th, opts) => {
    const sx = Math.max(3, Math.round(w / res)), sz = Math.max(3, Math.round(d / res));
    const g = new THREE.BoxGeometry(w, th, d, sx, 1, sz);
    const pa = g.attributes.position;
    const cavA = new Uint8Array(pa.count);
    const ph1 = rnd() * 50, ph2 = rnd() * 50;
    // chipped corner: a broken-off triangle (pushed down and back)
    const cc = opts.chipCorner; // [sx, sz, size] or null
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const ex = Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z));
      // edge chips: noisy wear along the arrises (deeper in places)
      const along = Math.abs(x) > Math.abs(z) * w / d ? z : x;
      const chipN = 0.5 + 0.5 * Math.sin(along * 7.3 + ph1) * Math.sin(along * 17.1 + ph2);
      const wearW = 0.035 + 0.07 * chipN * chipN;
      let open = Math.min(1, Math.max(0, ex / 0.12));
      if (y > 0) {
        const edge = Math.max(0, wearW - ex) / wearW;
        const dish = -0.014 * (1 - (x / (w / 2)) ** 2) * (1 - (z / (d / 2)) ** 2);
        let dy = -(0.025 + 0.045 * chipN) * edge * edge + dish + 0.006 * Math.sin(x * 6.1 + z * 4.3 + ph1) * Math.sin(z * 5.7 - x * 2.9 + ph2);
        if (cc) {
          const kx = (x * cc[0] + w / 2) / cc[2], kz = (z * cc[1] + d / 2) / cc[2]; // 0 at the corner
          const t = 1 - (kx + kz);
          if (t > 0) { dy -= Math.min(th * 0.8, 0.05 + t * 0.12); open = Math.min(open, 0.35); }
        }
        pa.setY(i, y + dy);
      }
      cavA[i] = Math.round(255 * (y > 0 ? 0.2 + 0.8 * open : 0.08));
    }
    g.computeVertexNormals();
    g.setAttribute('cav', new THREE.BufferAttribute(cavA, 1, true));
    g.deleteAttribute('uv');
    return g;
  };
  const place = (g, cu, cf, y, tiltX, tiltZ, yaw) => {
    const c = P(cu, cf, y);
    qt.setFromEuler(new THREE.Euler(tiltX, rot + yaw, tiltZ, 'YXZ'));
    tmpM.compose(c, qt, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(tmpM);
    geos.push(g);
  };
  for (let ff = fMin; ff < fMax - 0.3;) {
    const dz = 0.85 + rnd() * 0.75;
    let uu = uMin - rnd() * 0.6;
    while (uu < uMax - 0.2) {
      const dx = 0.8 + rnd() * 1.0;
      const gapU = 0.014 + rnd() * 0.03, gapF = 0.016 + rnd() * 0.026;
      const w = Math.min(dx, uMax - uu) - gapU, d = Math.min(dz, fMax - ff) - gapF;
      const cu = uu + dx / 2, cf = ff + dz / 2;
      // joints (soil strips) for the grass: the slab's leading and left edges
      joints.push({ u: cu, f: ff + dz - gapF / 2, du: 1, len: dx }, { u: uu + dx - gapU / 2, f: cf, du: 0, len: dz });
      const roll = rnd();
      if ((roll < 0.06 && (Math.abs(cu) > 3.2 || cf > 7.5)) || w < 0.25) { // missing slab (not in the open centre of the frame): soil + grass patch
        joints.push({ u: cu, f: cf, du: 1, len: dx * 0.8, patch: true });
      } else {
        const th = 0.16 + rnd() * 0.06;
        // uneven: most slabs slightly tilted / sunk, some clearly heaved
        const heave = rnd() < 0.1;
        const tiltX = heave ? (rnd() - 0.5) * 0.045 : (rnd() - 0.5) * 0.012;
        const tiltZ = heave ? (rnd() - 0.5) * 0.04 : (rnd() - 0.5) * 0.012;
        const sink = heave ? (rnd() - 0.45) * 0.04 : (rnd() - 0.55) * 0.014;
        const chip = rnd() < 0.4 ? [rnd() < 0.5 ? -1 : 1, rnd() < 0.5 ? -1 : 1, 0.2 + rnd() * 0.35] : null;
        if (rnd() < 0.38 && w > 0.6) {
          // cracked through: two pieces with a gap, each tilted a little differently
          const alongU = w > d ? rnd() < 0.75 : rnd() < 0.25;
          const k = 0.3 + rnd() * 0.4, gap = 0.012 + rnd() * 0.022;
          const L = alongU ? w : d, a = L * k - gap / 2, b = L * (1 - k) - gap / 2;
          const skew = (rnd() - 0.5) * 0.25;
          for (const [len, off, s2] of [[a, -L / 2 + a / 2, -1], [b, L / 2 - b / 2, 1]]) {
            const g = alongU ? piece(len, d, th, { chipCorner: s2 < 0 ? chip : null }) : piece(w, len, th, { chipCorner: s2 > 0 ? chip : null });
            const ou = alongU ? off : 0, of = alongU ? 0 : off;
            place(g, cu + ou, cf + of, floor - th / 2 + sink + (s2 > 0 ? (rnd() - 0.5) * 0.03 : 0),
              tiltX + (s2 > 0 ? (rnd() - 0.5) * 0.03 : 0), tiltZ + (s2 > 0 ? (rnd() - 0.5) * 0.03 : 0), skew * 0.04 * s2);
          }
          joints.push({ u: cu, f: cf, du: alongU ? 0 : 1, len: alongU ? d : w, crack: true });
        } else {
          place(piece(w, d, th, { chipCorner: chip }), cu, cf, floor - th / 2 + sink, tiltX, tiltZ, (rnd() - 0.5) * 0.02);
        }
      }
      uu += dx;
    }
    ff += dz;
  }
  const paving = new THREE.Mesh(mergeSimple(geos), null);
  paving.name = 'porticoPaving';
  // joints in world space
  const J = joints.map((j) => ({ p: P(j.u, j.f, floor - 0.075), t: j.du ? u.clone() : f.clone(), len: j.len, patch: !!j.patch, crack: !!j.crack }));
  return { podium, paving, soil, joints: J };
}

function hashSeed(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mergeSimple(geos) {
  let n = 0, ni = 0;
  for (const g of geos) { n += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = new Uint32Array(ni), cav = new Uint8Array(n).fill(255);
  let o = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.cav) cav.set(g.attributes.cav.array, o);
    const s = g.index.array; for (let i = 0; i < s.length; i++) idx[io++] = s[i] + o;
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('cav', new THREE.BufferAttribute(cav, 1, true));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
export { toPixel };
