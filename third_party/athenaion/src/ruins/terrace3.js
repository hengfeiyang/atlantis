// Shot-3 set (ref 3): on the left a podium carrying two fluted Corinthian columns with a banner
// hanging between them and a bronze brazier; a fluted column stub with a moulded top; rough
// blocks; limestone rocks and blocks in the foreground. Heights are derived from the shot-3 camera
// (eye ≈ 2 m above the local ground, podium top ≈ eye level), so the set follows the camera.
import * as THREE from 'three';
import * as ARCH from '../arch/index.js';
import { atPixel, atPixelPlane, shotCam, camHeading } from './camspace.js';
import { heightAt } from '../world/heightfield.js';
import { placeItem } from './headset.js';

// The foreground stands on a virtual ground plane T3_DROP below the eye (ref 3's eye is ≈ 2.4 m above
// the rocks; the real camera floats higher above the terrace, the knoll fills the difference).
// gpx = ref-3 pixel of the stone's FRONT-BOTTOM edge on that plane (sizes measured on ref 3);
// depth is only a nominal distance for the bake resolution. sink = how deep it sits in the ground.
export const T3_DROP = 2.4;
export const T3_STONES = [
  // broad flat limestone ledges (natural pavement) stepping down at the bottom left
  { id: 't1', kind: 'rock', gpx: [190, 960], depth: 5.2, dims: [2.3, 0.5, 1.7], yaw: 12, tilt: [2, -3], chips: 8, erosion: 0.05, sink: 0.24 },
  { id: 't2', kind: 'rock', gpx: [420, 905], depth: 5.9, dims: [1.9, 0.48, 1.4], yaw: -10, tilt: [-2, 3], chips: 8, erosion: 0.045, sink: 0.2 },
  { id: 't4', kind: 'rock', gpx: [110, 840], depth: 6.8, dims: [2.0, 0.55, 1.5], yaw: 25, tilt: [0, 4], chips: 7, erosion: 0.05, sink: 0.2 },
  { id: 't7', kind: 'rock', gpx: [-60, 905], depth: 5.8, dims: [1.5, 0.62, 1.2], yaw: 0, tilt: [0, 3], chips: 7, erosion: 0.05, sink: 0.22 },
  { id: 't8', kind: 'rock', gpx: [600, 975], depth: 5.0, dims: [1.1, 0.42, 0.8], yaw: -30, tilt: [4, 6], chips: 8, erosion: 0.04, sink: 0.18 },
  // broken ashlar blocks among the rocks (ref 3: block right of the stub, the bottom-centre block)
  { id: 't9', gpx: [580, 800], depth: 7.4, dims: [1.0, 0.56, 0.72], yaw: 14, tilt: [1, -2], chips: 9, broken: -1, sink: 0.04 },
  { id: 't3', gpx: [818, 980], depth: 5.2, dims: [1.15, 0.52, 0.8], yaw: 6, tilt: [0, -2], chips: 9, broken: 1, sink: 0.04 },
  { id: 't12', gpx: [1005, 975], depth: 5.2, dims: [0.62, 0.34, 0.46], yaw: 38, tilt: [6, 5], chips: 7, sink: 0.05 },
  { id: 't10', gpx: [700, 860], depth: 6.3, dims: [0.6, 0.32, 0.46], yaw: -24, tilt: [-5, 7], chips: 8, sink: 0.06 },
  { id: 't11', gpx: [300, 818], depth: 6.9, dims: [0.8, 0.38, 0.56], yaw: 8, tilt: [3, -6], chips: 8, broken: 1, sink: 0.08 },
];
export const T3_PIECES = [
  { id: 'stub3', type: 'pilaster', spec: { w: 0.98, h: 0.88, d: 0.62, flutes: 5, chips: 8, band: 0.2, seed: 'stub3b', cell: 0.014 } },
];

const deg = Math.PI / 180;

export async function buildTerrace3(H) {
  const { engine, group, marble } = H;
  const c = shotCam(3);
  const q = engine.quality.detail;
  // The set is composed for the real shot-3 eye. That camera floats ~8 m above the terrace, so the
  // set stands on a raised podium/knoll which would block shot 8's view of the acropolis: the whole
  // set is a hero group (visible in shot 3, hidden when it would intrude into another shot's frame).
  // ?ruinsClamp=1 instead builds it for an eye 2.3 m above the terrace (if the camera is lowered).
  const clamp = engine.params?.get?.('ruinsClamp') === '1';
  const eye = clamp ? Math.min(c.pos.y, heightAt(c.pos.x, c.pos.z) + 2.3) : c.pos.y;
  const dy = eye - c.pos.y; // ≤ 0: pixel placements are shifted down by this much
  const at = (px, py, d) => { const p = atPixel(3, px, py, d); p.y += dy; return p; };
  const f = new THREE.Vector3(c.fwd.x, 0, c.fwd.z).normalize();
  const u = new THREE.Vector3(-f.z, 0, f.x);
  const rotFacing = Math.atan2(-f.x, -f.z);
  const podTop = eye - 1.6;
  const gY = eye - T3_DROP; // foreground ground plane (see T3_DROP)
  const out = { supports: [] };

  // ---------------------------------------------------------------- podium on the left
  const corner = at(255, 602, 9.6); // front-right corner of the podium top
  corner.y = podTop;
  const PW = 8.5, PD = 3.8;   // along -uP (left) and +fP (away)
  // the podium recedes along the camera ray through its right edge, so its right flank stays near
  // x ≈ 255 px instead of sweeping toward the frame centre
  const aP = 0.36, fP = f.clone().multiplyScalar(Math.cos(aP)).addScaledVector(u, -Math.sin(aP)).normalize();
  const uP = new THREE.Vector3(-fP.z, 0, fP.x), rotP = Math.atan2(-fP.x, -fP.z);
  const pc = corner.clone().addScaledVector(uP, -PW / 2).addScaledVector(fP, PD / 2);
  const gBelow = Math.min(heightAt(corner.x, corner.z), heightAt(pc.x, pc.z)) - 0.6;
  const ph = podTop - gBelow;
  if (ph > 0.3) {
    // masonry body: courses of rough blocks along the front face, plus an inner box
    const body = new THREE.Mesh(new THREE.BoxGeometry(PW, ph - 0.4, PD, 12, 6, 12), H.stoneMat);
    body.position.set(pc.x, gBelow + (ph - 0.4) / 2, pc.z); body.rotation.y = rotP;
    group.add(body);
    // front face blocks (visible), two courses + cornice
    let y = podTop - 0.4, i = 0;
    while (y > gBelow + 0.2 && i < 8) {
      const h = Math.min(0.62 + 0.08 * Math.sin(i * 2.1), y - gBelow);
      let x = 0, k = 0;
      while (x < PW - 0.2) {
        const w = Math.min(1.1 + 0.4 * Math.abs(Math.sin(i * 3.1 + k * 1.7)), PW - x);
        const g = ARCH.roughBlockGeometry({ size: [w - 0.012, h - 0.01, 0.7], seed: 300 + i * 13 + k, chip: 0.05, detail: q });
        const m = new THREE.Mesh(g, marble);
        const p = corner.clone().addScaledVector(uP, -x - w / 2).addScaledVector(fP, 0.35);
        m.position.set(p.x, y - h, p.z); m.rotation.y = rotP;
        group.add(m);
        x += w; k++;
      }
      // right side face
      const side = ARCH.roughBlockGeometry({ size: [0.7, h - 0.01, PD - 0.8], seed: 400 + i, chip: 0.05, detail: q });
      const sm = new THREE.Mesh(side, marble);
      const sp = corner.clone().addScaledVector(uP, -0.35).addScaledVector(fP, PD / 2 + 0.35);
      sm.position.set(sp.x, y - h, sp.z); sm.rotation.y = rotP; group.add(sm);
      y -= h; i++;
    }
    // cornice slab on top (overhanging moulding)
    const cg = ARCH.pedestalGeometry({ w: PW, d: PD, h: 0.42, wreath: false, plinth: false, detail: q });
    const cm = new THREE.Mesh(cg, marble);
    cm.position.set(pc.x, podTop - 0.42, pc.z); cm.rotation.y = rotP; group.add(cm);
  }

  // ---------------------------------------------------------------- two columns, banner between, brazier
  const colH = 9.0, D = 0.64;
  const colPos = [at(160, 596, 10.4), at(22, 590, 9.1)];
  const { geometry } = ARCH.columnGeometry({ order: 'corinthian', height: colH, diameter: D, detail: q });
  colPos.forEach((p, i) => {
    const m = new THREE.Mesh(geometry, marble);
    m.position.set(p.x, podTop, p.z); m.rotation.y = rotFacing + i * 0.4;
    m.name = 'bannerColumn3_' + i; // the banner hangs between them (ref 3: clean fluted marble, no ivy curtain)
    group.add(m);
  });
  // architrave over the two columns (above the frame) to carry the banner rod
  {
    const a = colPos[0], b = colPos[1];
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const L = a.distanceTo(b) + D * 1.6;
    const g = ARCH.entablatureFragmentGeometry({ order: 'ionic', D, length: L, seed: 12, brokenEnds: [true, true], detail: q });
    const m = new THREE.Mesh(g, marble);
    m.position.set(mid.x, podTop + colH, mid.z);
    m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) - Math.PI / 2;
    group.add(m);
    const bp = at(107, 230, 9.0);
    const facing = (camHeading(3) + 180) % 360;
    engine.slots.banner.push({ pos: [bp.x, eye + 1.75, bp.z], facing, size: [0.72, 2.55], tag: 'columns', style: 'S', source: 'ruins-terrace3' });
  }
  {
    const bp = at(100, 560, 8.4);
    const pg = ARCH.pedestalGeometry({ w: 0.5, d: 0.5, h: 0.14, wreath: false, plinth: false, detail: q });
    const pm = new THREE.Mesh(pg, marble); pm.position.set(bp.x, podTop, bp.z); pm.rotation.y = rotFacing; group.add(pm);
    engine.slots.brazier.push({ pos: [bp.x, podTop + 0.14, bp.z], facing: (camHeading(3) + 180) % 360, size: 0.62, tag: 'pedestal', source: 'ruins-terrace3' });
  }

  // ---------------------------------------------------------------- fluted column stub with a moulded top
  {
    const g = await H.geometry('stub3');
    const m = new THREE.Mesh(g, H.columnMat);
    // ref 3: stub bottom-centre at (399, 797) on the foreground ground plane
    const p = atPixelPlane(3, 399, 797, gY - dy).addScaledVector(f, 0.3); p.y = gY - 0.06;
    m.position.copy(p); m.rotation.y = rotFacing - 0.12;
    m.name = 'ruinsStub3';
    group.add(m);
    out.supports.push({ x: p.x, z: p.z, top: gY - 0.02, r: 1.2 });
  }

  // ---------------------------------------------------------------- rocks & blocks
  for (const s of T3_STONES) {
    const g = await H.geometry(s.id);
    const mesh = new THREE.Mesh(g, H.stoneMat);
    // front-bottom edge on the ground plane at the ref pixel → centre half a depth further away
    const p = atPixelPlane(3, s.gpx[0], s.gpx[1], gY - dy).addScaledVector(f, s.dims[2] * 0.5);
    p.y = gY + s.dims[1] * 0.5 - (s.sink ?? 0.1);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((s.tilt?.[0] || 0) * deg, rotFacing + (s.yaw || 0) * deg, (s.tilt?.[1] || 0) * deg, 'YXZ'));
    mesh.position.copy(p); mesh.quaternion.copy(q);
    mesh.name = 'ruinStone3_' + s.id;
    group.add(mesh);
    out.supports.push({ x: p.x, z: p.z, top: gY - 0.03, r: Math.max(s.dims[0], s.dims[2]) * 0.6 + 0.7 });
  }
  // the foreground ground (the camera looks down onto it) and the podium's footing
  for (const [u0, f0, r] of [[0, 1.5, 3.2], [-2.5, 4, 3.2], [1.5, 4.5, 2.6], [-1, 7, 3.0], [1.2, 7.5, 2.4]]) {
    const q = c.pos.clone().addScaledVector(u, u0).addScaledVector(f, f0);
    out.supports.push({ x: q.x, z: q.z, top: gY - 0.08, r });
  }
  out.supports.push({ x: corner.x + f.x * 2, z: corner.z + f.z * 2, top: Math.min(podTop - 1.2, gY), r: 4.5 });
  out.groundY = gY;
  engine.registry.ruinsTerrace3 = { podTop, corner: corner.toArray(), columns: colPos.map((p) => p.toArray()) };
  return out;
}
