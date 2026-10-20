// Shot 2 (ref 2) right-hand foreground: a stone landing at the lagoon with a pitted parapet, two steps up
// to a low balustrade with a brazier pier, a terrace wall with a bronze urn of purple flowers, an Athena
// statue on a moulded pedestal (slot → statues), a tall ashlar pier carrying an architrave with the navy
// owl banner (slot → banners) and ivy curtains (slots → flora). Authored in the shot-2 camera frame
// (u right, v forward), anchored on reference pixels so it follows camera tweaks.
import * as THREE from 'three';
import { MeshBuilder, box, roughBlock, pedestal, balustrade } from '../arch/index.js';
import { shotFrame } from './frame.js';
import { setStoneMaterial, setDressedMaterial, setRockMaterial } from './materials.js';
import { createRock } from '../materials/stone.js';



/**
 * Build the set. Returns { group, tris, slots: {statue, banner, brazier, urn, planter, ivy}, footprint }.
 * Slots are returned (not pushed) so the caller decides; sets.js pushes them into engine.slots.
 */
export function buildShot2(engine, F = shotFrame(2), opts = {}) {
  const rng = engine.rng('set-shot2');
  const detail = opts.detail ?? 1;
  const g = F.group('set-shot2');
  const slots = { statue: [], banner: [], brazier: [], urn: [], planter: [], ivy: [] };

  // ---- anchors (reference pixels of ref 2 → camera-ground coordinates)
  const S = F.local(1398, 712, 20.5); // statue pedestal base centre
  const uS = S[0], vS = S[2], YT = S[1];
  const YL = YT - 0.93; // landing behind the parapet
  const YM = YT - 0.5; // balustrade platform (left)
  const YP = YT - 0.1; // parapet top
  const uP = F.local(1512, 400, 22.9)[0], vP = 22.9; // tall pier
  const YC = F.local(1510, 192, vP)[1] - 0.1; // pier capital bottom
  const uB = F.local(1086, 760, 15.9)[0], vB = 15.9; // brazier pier
  const uW = F.local(1302, 725, 19.4)[0], vW = 19.4; // terrace wall: left end, front face
  const U1 = uP + 5.2; // right extent (out of frame)
  const V1 = vP + 6; // back extent
  const Z = (v) => -v; // local z
  // corner pier at the bottom-right (ref 2: tall block at the right frame edge carrying the bronze urn)
  const vK0 = 11.0, vK1 = 13.6;
  const uK0 = F.local(1528, 800, vK0)[0], uK1 = uK0 + 2.2, YK = YT + 0.27;
  const uM0 = uB - 0.46; // left edge of the steps / balustrade platform

  const mbR = new MeshBuilder(); // rough pitted stone (parapet, walls, pier courses)
  const mbD = new MeshBuilder(); // dressed stone (pedestals, balustrade, mouldings, coping)
  const r = () => rng.random();
  const rr = (a, b) => a + (b - a) * rng.random();

  // ---- core mass (quay) down into the lagoon
  box(mbR, [0.6, -6.5, Z(14.6)], [U1, YL - 0.02, Z(10.3)], 0, [0.2, 0, 0.3, 0]);
  box(mbR, [uM0, -6.5, Z(V1)], [U1, YL - 0.02, Z(14.6)], 0, [0.2, 0, 0.3, 0]);
  // rough quay courses on the faces seen from the camera's left (from below the water up to the floor)
  const quay = (uFace, va, vb, yTop, seed) => {
    for (let y = -0.45, k = 0; y < yTop - 0.1; k++) {
      const h = Math.min(yTop - y, rr(0.5, 0.75));
      for (let v = va; v < vb - 0.1; ) {
        const len = Math.min(vb - v, rr(0.9, 1.8));
        mbR.push(); mbR.translate(uFace - 0.3 + rr(-0.04, 0.04), y, Z(v + len / 2));
        roughBlock(mbR, { size: [0.7, h - 0.015, len - 0.025], seed: seed + k * 5.1 + v, chip: 0.08, n: 6 });
        mbR.pop();
        v += len;
      }
      y += h;
    }
  };
  quay(0.6, 10.3, 14.6, YL - 0.05, 300);
  quay(uM0, 14.6, V1, YM - 0.05, 400);
  // landing paving slabs (visible between the parapet and the terrace wall)
  {
    let u = 0.62;
    while (u < U1) {
      const len = rr(0.9, 1.7);
      for (let v = 11.4; v < vW; ) {
        const dv = rr(0.8, 1.5);
        box(mbD, [u + 0.012, YL - 0.12, Z(Math.min(vW, v + dv) - 0.012)], [Math.min(U1, u + len) - 0.012, YL + rr(-0.006, 0.012), Z(v + 0.012)], 0.02, [0.25, 0.5, 0.3, 0]);
        v += dv;
      }
      u += len;
    }
  }

  // ---- front parapet: big eroded blocks (rounded fracture polytopes), a lower broken one at the left end
  const wornBlocks = [];
  {
    let u = 0.12;
    let i = 0;
    while (u < uK0 - 0.3) {
      const len = Math.min(uK0 - 0.02 - u, i === 0 ? 1.15 : rr(1.4, 2.3));
      const dep = rr(1.15, 1.4);
      const top = i === 0 ? YP - 0.14 : YP + rr(-0.08, 0.06);
      const bot = YL - 0.35;
      wornBlocks.push({ u: u + len / 2, v: 10.0 + dep / 2 + rr(-0.12, 0.12), bot, size: [len - 0.03, top - bot, dep], rot: rr(-0.05, 0.05), round: i === 0 ? 0.6 : rr(0.28, 0.5) });
      u += len + rr(0.035, 0.09);
      i++;
    }
  }

  // ---- steps + balustrade platform on the left
  {
    // platform M
    box(mbR, [uM0, YL - 0.1, Z(V1)], [uW + 0.02, YM, Z(15.45)], 0.02, [0.2, 0.4, 0.3, 0]);
    // two steps (worn, split into slabs)
    const steps = [[14.65, 15.05, YL + 0.215], [15.05, 15.45, YM]];
    for (const [va, vb, top] of steps) {
      let u = uM0;
      while (u < uW) {
        const len = Math.min(uW - u, rr(0.8, 1.4));
        box(mbD, [u + 0.01, YL - 0.05, Z(vb)], [u + len - 0.01, top + rr(-0.012, 0.004), Z(va)], 0.03, [0.2, 0.6, 0.3, 0]);
        u += len;
      }
    }
    // brazier pier (moulded) at the front-left corner of the platform
    mbD.push(); mbD.translate(uB, YM, Z(vB)); mbD.rotateY(0.04);
    pedestal(mbD, { w: 0.8, d: 0.8, h: 0.8, wreath: false, panel: true, detail });
    mbD.pop();
    slots.brazier.push({ pos: F.toWorld(uB, YM + 0.8, vB), facing: F.backDeg, size: 0.8, shallow: 0.68, flame: 0.85, tag: 'set2-pier' });
    // low balustrade from the pier to the terrace wall
    const b0 = uB + 0.42, b1 = uW - 0.02;
    if (b1 - b0 > 0.6) {
      mbD.push(); mbD.translate(b0, YM, Z(vB));
      balustrade(mbD, { length: b1 - b0, height: 0.72, depth: 0.3, spacing: 0.27, postEvery: 9, endPosts: false, detail });
      mbD.pop();
    }
  }

  // ---- terrace wall (front + left end) with a moulded coping; terrace floor
  {
    const courseTop = YT - 0.17;
    let u = uW;
    let i = 0;
    while (u < U1) {
      const len = rr(1.0, 1.9);
      mbR.push(); mbR.translate(u + len / 2, YL - 0.1, Z(vW + 0.35));
      roughBlock(mbR, { size: [len - 0.03, courseTop - YL + 0.1, 0.7], seed: 40 + i * 3.1, chip: 0.06, detail });
      mbR.pop();
      u += len; i++;
    }
    // end wall along v at u = uW (faces the camera's left side)
    for (let v = vW + 0.7, k = 0; v < V1; k++) {
      const len = Math.min(V1 - v, rr(1.2, 2.0));
      mbR.push(); mbR.translate(uW + 0.3, YM - 0.05, Z(v + len / 2));
      roughBlock(mbR, { size: [0.6, courseTop - YM + 0.05, len - 0.03], seed: 70 + k * 2.3, chip: 0.05, detail });
      mbR.pop();
      v += len;
    }
    // coping slabs (front + end), overhanging, slightly uneven
    for (let u2 = uW - 0.07; u2 < U1; ) {
      const len = rr(1.1, 1.8);
      box(mbD, [u2 + 0.008, courseTop, Z(vW + 0.82)], [Math.min(U1, u2 + len) - 0.008, YT + rr(-0.008, 0.01), Z(vW - 0.07)], 0.035, [0.15, 0.7, 0.35, 0]);
      u2 += len;
    }
    for (let v = vW + 0.82; v < V1; ) {
      const len = Math.min(V1 - v, rr(1.2, 1.9));
      box(mbD, [uW - 0.07, courseTop, Z(v + len - 0.008)], [uW + 0.66, YT + rr(-0.008, 0.01), Z(v + 0.008)], 0.035, [0.15, 0.7, 0.35, 0]);
      v += len;
    }
    // terrace paving
    box(mbD, [uW + 0.66, YM, Z(V1)], [U1, YT - 0.03, Z(vW + 0.82)], 0.0, [0.25, 0, 0.3, 0]);
  }

  // ---- statue pedestal + statue slot (athena with spear, turned to image-left as in ref 2)
  {
    const H = 1.3;
    mbD.push(); mbD.translate(uS, YT - 0.03, Z(vS)); mbD.rotateY(-0.22);
    pedestal(mbD, { w: 1.42, d: 1.3, h: H, wreath: false, panel: true, detail });
    mbD.pop();
    slots.statue.push({ pos: F.toWorld(uS, YT - 0.03 + H, vS), facing: F.facing(68), size: 3.05, type: 'athenaMini', tag: 'set2-hero' });
  }

  // ---- tall ashlar pier + architrave (banner hangs from it), a slim column hidden behind the statue
  {
    const w = 1.16;
    // plinth
    box(mbD, [uP - w / 2 - 0.12, YT - 0.03, Z(vP + w / 2 + 0.12)], [uP + w / 2 + 0.12, YT + 0.32, Z(vP - w / 2 - 0.12)], 0.04, [0.2, 0.7, 0.3, 0]);
    let y = YT + 0.32, k = 0;
    while (y < YC - 0.2) {
      const h = Math.min(YC - y, rr(0.48, 0.66));
      mbR.push(); mbR.translate(uP + rr(-0.02, 0.02), y, Z(vP)); mbR.rotateY(rr(-0.02, 0.02));
      roughBlock(mbR, { size: [w + rr(-0.03, 0.03), h - 0.012, w + rr(-0.03, 0.03)], seed: 90 + k * 1.7, chip: 0.05, detail });
      mbR.pop();
      y += h; k++;
    }
    // capital: stepped mouldings
    box(mbD, [uP - w / 2 - 0.05, YC, Z(vP + w / 2 + 0.05)], [uP + w / 2 + 0.05, YC + 0.12, Z(vP - w / 2 - 0.05)], 0.02, [0.3, 0.6, 0.3, 0]);
    box(mbD, [uP - w / 2 - 0.13, YC + 0.12, Z(vP + w / 2 + 0.13)], [uP + w / 2 + 0.13, YC + 0.4, Z(vP - w / 2 - 0.13)], 0.03, [0.2, 0.7, 0.3, 0]);
    // second pier off-frame right, slim column behind the statue
    const uP2 = U1 - 0.9;
    box(mbR, [uP2 - w / 2, YT - 0.03, Z(vP + w / 2)], [uP2 + w / 2, YC + 0.4, Z(vP - w / 2)], 0.03, [0.2, 0.5, 0.3, 0]);
    const uC = F.local(1400, 420, vP + 0.4)[0]; // right behind the statue figure
    box(mbD, [uC - 0.3, YT - 0.03, Z(vP + 0.7)], [uC + 0.3, YC + 0.4, Z(vP + 0.1)], 0.08, [0.2, 0.4, 0.3, 0]);
    // architrave + frieze + cornice running from above the statue to the right, beyond the frame
    const a0 = uS - 1.5, a1 = U1 + 0.6;
    const yA = YC + 0.4;
    let u = a0, i = 0;
    while (u < a1) {
      const len = Math.min(a1 - u, rr(2.4, 3.4));
      mbR.push(); mbR.translate(u + len / 2, yA, Z(vP));
      roughBlock(mbR, { size: [len - 0.02, 0.78, 1.15], seed: 130 + i * 2.9, chip: 0.05, detail, broken: i === 0 ? { nx: 0.18 } : {} });
      mbR.pop();
      u += len; i++;
    }
    // taenia + a thin cornice (the rest of the entablature is above the frame)
    box(mbD, [a0 + 0.25, yA + 0.78, Z(vP + 0.5)], [a1, yA + 0.9, Z(vP - 0.64)], 0.02, [0.2, 0.6, 0.3, 0]);
    box(mbD, [a0 + 0.3, yA + 0.9, Z(vP + 0.45)], [a1, yA + 1.25, Z(vP - 0.74)], 0.03, [0.2, 0.8, 0.4, 0]);
    // banner on the architrave face, in front of the pier's right half (ref 2 right edge)
    slots.banner.push({ pos: F.toWorld(uP + 1.12, yA + 0.02, vP - 0.6), facing: F.backDeg, size: [1.9, 4.6], tag: 'set2-wall', style: 'S' });
    // ivy curtains from the architrave (left of the pier, above the statue) and down the pier
    const ivyGround = () => YT;
    slots.ivy.push({ pos: F.toWorld(uS - 0.15, yA + 0.85, vP - 0.62), facing: F.backDeg, size: 3.4, width: 2.3, density: 2.6, leafScale: 1.35, tag: 'set2-architrave', ground: ivyGround });
    slots.ivy.push({ pos: F.toWorld(uS + 0.9, yA + 0.85, vP - 0.64), facing: F.backDeg, size: 4.6, width: 1.3, density: 2.2, leafScale: 1.35, tag: 'set2-architrave', ground: ivyGround });
    slots.ivy.push({ pos: F.toWorld(uP - 0.3, yA + 0.6, vP - 0.62), facing: F.backDeg, size: 6.0, width: 0.6, density: 1.8, leafScale: 1.35, tag: 'set2-pier', ground: ivyGround });
    slots.ivy.push({ pos: F.toWorld(uP - 0.62, yA + 0.4, vP), facing: (F.backDeg + 270) % 360, size: 5.0, width: 1.0, density: 2.2, leafScale: 1.35, tag: 'set2-pier', ground: ivyGround });
  }

  // ---- corner pier (bottom-right): rough courses + coping, the bronze urn of purple flowers on top
  {
    let y = YL - 0.25, k = 0;
    const top = YK - 0.16;
    while (y < top - 0.05) {
      const h = Math.min(top - y, rr(0.5, 0.7));
      mbR.push(); mbR.translate((uK0 + uK1) / 2 + rr(-0.02, 0.02), y, Z((vK0 + vK1) / 2));
      roughBlock(mbR, { size: [uK1 - uK0 - rr(0, 0.04), h - 0.01, vK1 - vK0 - rr(0, 0.04)], seed: 150 + k * 2.2, chip: 0.07, detail });
      mbR.pop();
      y += h; k++;
    }
    box(mbD, [uK0 - 0.07, top, Z(vK1 + 0.05)], [uK1 + 0.07, YK, Z(vK0 - 0.07)], 0.035, [0.15, 0.7, 0.35, 0]);
    const urnAt = F.localOnPlane(1552, 731, YK);
    const uu = THREE.MathUtils.clamp(urnAt[0], uK0 + 0.45, uK1 - 0.45), vv = THREE.MathUtils.clamp(urnAt[2], vK0 + 0.45, vK1 - 0.45);
    slots.urn.push({ pos: F.toWorld(uu, YK, vv), facing: 0, size: 0.92, tag: 'set2-bronze-wide' });
    // the parapet's lower landing continues to the right of the pier; ivy over its face
    slots.ivy.push({ pos: F.toWorld(uK0 + 1.6, YK, vK0 - 0.05), facing: F.backDeg, size: 1.3, width: 0.9, tag: 'set2-parapet', ground: () => YL - 0.3 });
  }

  // ---- small urns on the terrace, a planter trough behind the parapet
  slots.urn.push({ pos: F.toWorld(uS - 0.85, YT - 0.03, vS + 3.0), facing: 0, size: 0.62, tag: 'set2-bronze' });
  // flowering shrubs growing on the landing behind the parapet (peek over it, ref 2 lower right)
  slots.planter.push({ pos: F.toWorld(Math.min(uK0 - 0.9, 3.2), YL + 0.42, 12.1), facing: F.backDeg, size: [1.7, 1.1], tag: 'set2-bed' });
  // ivy over the parapet and the terrace wall
  const groundWater = () => 0;
  slots.ivy.push({ pos: F.toWorld(0.6, YP - 0.3, 10.3), facing: F.backDeg, size: 2.4, width: 1.3, density: 2.4, leafScale: 1.35, tag: 'set2-parapet', ground: groundWater });
  slots.ivy.push({ pos: F.toWorld(0.75, YP - 0.25, 11.0), facing: (F.backDeg + 270) % 360, size: 3.5, width: 1.4, density: 2.2, leafScale: 1.35, tag: 'set2-parapet', ground: groundWater });
  slots.ivy.push({ pos: F.toWorld(3.0, YP + 0.02, 10.3), facing: F.backDeg, size: 1.0, width: 1.5, density: 2.4, leafScale: 1.35, tag: 'set2-parapet', ground: groundWater });
  slots.ivy.push({ pos: F.toWorld(uW + 3.9, YT, vW - 0.05), facing: F.backDeg, size: 0.9, width: 1.3, tag: 'set2-wall', ground: () => YL });

  // ---- weathered boulders at the water by the parapet's broken end
  const rocks = new THREE.Group();
  const rockMat = setRockMaterial();
  for (const [u, v, y, sx, sy, sz, rot] of [[-0.9, 12.6, 3.7, 1.5, 1.9, 1.3, 0.4], [-0.1, 14.4, 3.9, 1.3, 1.9, 1.2, 1.3], [-2.4, 15.6, 3.2, 1.8, 1.9, 1.5, 2.2], [-1.6, 10.6, 3.1, 1.0, 1.6, 0.9, 0.9], [0.2, 10.0, 3.6, 0.9, 1.9, 0.9, 2.7]]) {
    const geo = createRock(rng, { shape: 'boulder', size: [sx, sy, sz], detail: 4, flatBottom: 0.05 });
    const cvA = geo.attributes.aCavity, aux = new Float32Array(geo.attributes.position.count * 4);
    if (cvA) for (let i = 0; i < cvA.count; i++) aux[i * 4] = Math.min(1, cvA.getX(i) * 1.5);
    geo.setAttribute('aux', new THREE.BufferAttribute(aux, 4));
    const m = new THREE.Mesh(geo, rockMat);
    m.position.set(u, y, Z(v)); m.rotation.y = rot;
    rocks.add(m);
  }
  // eroded parapet blocks: rock 'block' polytopes, rescaled to the exact block box
  const stoneMat = setStoneMaterial();
  for (const wb of wornBlocks) {
    const geo = createRock(rng, { shape: 'block', size: [1, 1, 1], detail: 4, roughness: wb.round, cracks: 0.55, strata: 0.15, flatBottom: 0.0 });
    // squarify the pillow polytope toward a worn ashlar block (keeps its fracture / pit detail)
    {
      const P = geo.attributes.position;
      geo.computeBoundingBox();
      const b0 = geo.boundingBox, c0 = b0.getCenter(new THREE.Vector3()), h0 = b0.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      for (let i = 0; i < P.count; i++) {
        const x = (P.getX(i) - c0.x) / h0.x, y = (P.getY(i) - c0.y) / h0.y, z = (P.getZ(i) - c0.z) / h0.z;
        const l2 = Math.hypot(x, y, z) || 1, li = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) || 1;
        const k = 1 + (l2 / li - 1) * 0.9;
        P.setXYZ(i, c0.x + x * k * h0.x, c0.y + y * k * h0.y, c0.z + z * k * h0.z);
      }
    }
    geo.computeBoundingBox();
    const bb = geo.boundingBox, sz = bb.getSize(new THREE.Vector3());
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    geo.scale(wb.size[0] / sz.x, wb.size[1] / sz.y, wb.size[2] / sz.z);
    geo.computeVertexNormals();
    const cvA = geo.attributes.aCavity, aux = new Float32Array(geo.attributes.position.count * 4);
    if (cvA) for (let i = 0; i < cvA.count; i++) { aux[i * 4] = Math.min(1, cvA.getX(i) * 1.6); }
    geo.setAttribute('aux', new THREE.BufferAttribute(aux, 4));
    const m = new THREE.Mesh(geo, stoneMat);
    m.position.set(wb.u, wb.bot, Z(wb.v)); m.rotation.y = wb.rot;
    m.name = 'set2-parapet';
    rocks.add(m);
  }
  g.add(rocks);

  // ---- meshes
  const geoR = mbR.geometry(), geoD = mbD.geometry();
  const mR = new THREE.Mesh(geoR, setStoneMaterial()); mR.name = 'set2-rough';
  const mD = new THREE.Mesh(geoD, setDressedMaterial()); mD.name = 'set2-dressed';
  g.add(mR, mD);
  let tris = (geoR.index.count + geoD.index.count) / 3;
  rocks.children.forEach((m) => { tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });

  // footprint (world rect around the set) so trees / scatter keep out
  const cU = (U1 - 0.4) / 2 - 0.4, cV = (V1 + 9) / 2;
  const c = F.toWorld(cU, 0, cV);
  const footprint = { cx: c[0], cz: c[2], hw: (U1 + 0.8) / 2 + 3, hd: (V1 - 9) / 2, rotY: Math.PI - F.heading };
  return { group: g, tris, slots, footprint, anchors: { uS, vS, YT, uP, vP, YC } };
}
