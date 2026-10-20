// Shot 8 (ref 8) background: a ruined banded arcade across the far side of the forum plaza (ref 8 px
// 800-1150, behind the head) and two tall banded towers crowned by gilded tholoi further back on land
// ring 1 (ref 8 px ≈ 1170 and ≈ 1500). Silhouettes in the blue at 45-120 m — modest detail.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { Building } from '../arch/build.js';
import { box, extrudeOutline, ellipsoid, cylinder } from '../arch/geom.js';
import { tholos } from '../arch/tholos.js';
import { RNG } from '../core/rng.js';
import { towerInto } from './precinct.js';

const PI = Math.PI;

/** forum plaza centre (same formula as src/city/ringplan.js FORUM) */
function forum() { const H = L.FALLEN_HEAD.pos, T = L.FALLEN_TRIDENT.pos; return { x: (H[0] + T[0]) / 2 + 2, z: (H[2] + T[2]) / 2 - 2, r: 34, plaza: 29 }; }

/**
 * Arcade in a local frame: x along the front, y up, front face at z = +d/2. bays: array of 'full' | 'broken' | 'gone'.
 */
function arcade(o) {
  const B = new Building('set8-arcade', { detail: o.detail, seed: 81, variant: 'ruined', weather: 0.8 });
  const mb = B.get('banded'), mw = B.marble;
  const rng = new RNG('set8:arcade');
  const s = o.span, w = o.pier, d = o.depth, ya = o.impost, r = s / 2, top = ya + r + o.attic;
  const nb = o.bays.length;
  const X0 = -(nb * (s + w) + w) / 2;
  const segN = 14;
  const aux = [0.1, 0.3, 0.6, 3.05];
  for (let i = 0; i <= nb; i++) {
    const x = X0 + i * (s + w);
    const left = o.bays[i - 1], right = o.bays[i];
    const gone = (left === undefined || left === 'gone') && (right === undefined || right === 'gone');
    const h = gone ? rng.range(1.6, ya * 0.8) : (left === 'broken' && right !== 'full') ? rng.range(ya * 0.9, ya + r) : ya;
    box(mb, [x, -1.5, -d / 2], [x + w, h, d / 2], 0.03, aux);
    // impost moulding
    if (!gone) box(mw, [x - 0.08, ya - 0.22, -d / 2 - 0.08], [x + w + 0.08, ya, d / 2 + 0.08], 0.02, [0.1, 0.8, 0.3, 0]);
    // plinth
    box(mw, [x - 0.12, -1.5, -d / 2 - 0.12], [x + w + 0.12, 0.45, d / 2 + 0.12], 0.03, [0.2, 0.5, 0.2, 0]);
    B.occBox([x, -1.5, -d / 2], [x + w, h, d / 2]);
  }
  // spandrel walls with the arch cut out, per bay
  for (let i = 0; i < nb; i++) {
    const kind = o.bays[i];
    if (kind === 'gone') continue;
    const x0 = X0 + i * (s + w) + w, x1 = x0 + s, cx = (x0 + x1) / 2;
    const out = [];
    out.push([x1 + w * 0.5, ya]);
    // top edge (right → left): straight or jagged
    if (kind === 'broken') {
      const n = 7;
      for (let k = 0; k <= n; k++) { const t = k / n; out.push([x1 + w * 0.5 - t * (s + w), ya + r + 0.15 + rng.range(0.1, 0.9) * o.attic * (k % 2 ? 0.6 : 1.1)]); }
    } else { out.push([x1 + w * 0.5, top]); out.push([x0 - w * 0.5, top]); }
    out.push([x0 - w * 0.5, ya]);
    // the arch (left → right along the intrados)
    for (let k = 0; k <= segN; k++) { const a = PI - (k / segN) * PI; out.push([cx + Math.cos(a) * r, ya + Math.sin(a) * r]); }
    // CCW check: extrudeOutline handles either winding
    mb.push(); mb.translate(0, 0, -d / 2);
    extrudeOutline(mb, out, d, { aux, auxSide: [0.3, 0.6, 0, 3.05] });
    mb.pop();
    // archivolt (white voussoir ring proud of the face)
    if (kind === 'full') for (let k = 0; k < segN; k++) {
      const a0 = PI - (k / segN) * PI, a1 = PI - ((k + 1) / segN) * PI;
      const q = [[cx + Math.cos(a0) * r, ya + Math.sin(a0) * r], [cx + Math.cos(a1) * r, ya + Math.sin(a1) * r], [cx + Math.cos(a1) * (r + 0.4), ya + Math.sin(a1) * (r + 0.4)], [cx + Math.cos(a0) * (r + 0.4), ya + Math.sin(a0) * (r + 0.4)]];
      mw.push(); mw.translate(0, 0, d / 2 - 0.02);
      extrudeOutline(mw, q, 0.1, { aux: [0.1, 0.5, 0.3, 0] });
      mw.pop();
    }
    if (kind === 'full') box(mw, [x0 - w * 0.5 - 0.1, top - 0.05, -d / 2 - 0.15], [x1 + w * 0.5 + 0.1, top + 0.4, d / 2 + 0.15], 0.03, [0.1, 0.8, 0.4, 0]); // cornice
    B.occBox([x0 - w / 2, ya, -d / 2], [x1 + w / 2, top, d / 2]);
  }
  // fallen blocks at the foot
  for (let k = 0; k < 9; k++) {
    const x = X0 + rng.range(0, nb * (s + w)), z = rng.range(-1, 1) * d * 1.8;
    const sx = rng.range(0.6, 1.3), sy = rng.range(0.4, 0.7), sz = rng.range(0.5, 1.0);
    mb.push(); mb.translate(x, sy / 2 - 0.15, z); mb.rotateY(rng.range(0, PI)); mb.rotateZ(rng.range(-0.25, 0.25));
    box(mb, [-sx / 2, -sy / 2, -sz / 2], [sx / 2, sy / 2, sz / 2], 0.04, aux);
    mb.pop();
  }
  return B;
}

/** square banded tower (ashlar, string courses, a ruined corner) with a gilded tholos on top */
function tower(o) {
  const B = new Building('set8-tower', { detail: o.detail, seed: o.seed, variant: 'ruined', weather: 0.8 });
  const mb = B.get('banded'), mw = B.marble, mi = B.mb.interior;
  const w = o.w, h = o.h, hw = w / 2;
  const aux = [0.1, 0.3, 0.6, 3.05];
  box(mw, [-hw - 0.6, -2, -hw - 0.6], [hw + 0.6, 1.2, hw + 0.6], 0.04, [0.2, 0.5, 0.3, 0]);
  box(mb, [-hw, 1.2, -hw], [hw, h, hw], 0.04, aux);
  for (const y of [h * 0.38, h * 0.7]) box(mw, [-hw - 0.15, y, -hw - 0.15], [hw + 0.15, y + 0.45, hw + 0.15], 0.03, [0.1, 0.8, 0.3, 0]);
  // dark arched windows (two tiers) on every face
  for (let f = 0; f < 4; f++) {
    mi.push(); mi.rotateY((f * PI) / 2);
    for (const y of [h * 0.48, h * 0.78]) for (const x of [-w * 0.22, w * 0.22]) box(mi, [x - 0.45, y, hw - 0.02], [x + 0.45, y + 2.2, hw + 0.01], 0, [0.9, 0, 0, 0]);
    mi.pop();
  }
  box(mw, [-hw - 0.4, h, -hw - 0.4], [hw + 0.4, h + 0.7, hw + 0.4], 0.04, [0.1, 0.8, 0.4, 0]);
  B.occBox([-hw, 0, -hw], [hw, h + 0.7, hw]);
  return B;
}

/**
 * @param {object} engine
 * @param {object} F frame8 (design camera)
 * @param {function} G ground(x, z)
 * @param {number} q detail
 * @returns {THREE.Group}
 */
export function buildBackdrop8(engine, F, G, q) {
  const group = new THREE.Group(); group.name = 'sets:backdrop8';
  const det = q >= 1 ? 0.6 : 0.4;
  const Fo = forum();
  const yaw = Math.atan2(F.fwd.x, F.fwd.z) + PI; // local +Z faces the camera
  // ---- arcade on the far side of the plaza
  {
    let p = F.at(975, 470, 50);
    const dx = p.x - Fo.x, dz = p.z - Fo.z, dr = Math.hypot(dx, dz);
    if (dr > Fo.plaza - 3) { const k = (Fo.plaza - 3) / dr; p = new THREE.Vector3(Fo.x + dx * k, p.y, Fo.z + dz * k); }
    const B = arcade({ detail: det, span: 3.0, pier: 1.05, depth: 1.5, impost: 4.2, attic: 1.0, bays: ['full', 'full', 'broken', 'full', 'gone'] });
    const g = B.finalize({ position: [p.x, G(p.x, p.z) - 0.2, p.z], rotY: yaw + 0.18, aoCell: 0.5, aoRays: 24 });
    group.add(g);
    engine.footprints?.addCircle?.(p.x, p.z, 10, 'sets:arcade8');
  }
  // ---- tall towers with gilded tholoi on land ring 1 (stay on the ring: r ≥ l1.r0 + 10; r4: was r ≥ 312 — since the r3
  //      w1 widening (l1 from r 350) the towers stood on the w1 floor hidden behind the l1 inner wall). Slender, so the
  //      tholoi read against the wall / water above it like ref 8's (px ≈ 1170, 1500; a third, lower one at px ≈ 980)
  const rMin = (L.ringById('l1')?.r0 ?? 350) + 10;
  const TW = [{ px: 1185, depth: 92, h: 10.5, w: 3.0, seed: 82 }, { px: 1500, depth: 118, h: 12.5, w: 3.3, seed: 83 }];
  for (const t of TW) {
    let p = null;
    for (let dd = t.depth; dd > 18; dd -= 3) { const c = F.at(t.px, 470, dd); if (Math.hypot(c.x, c.z) >= rMin) { p = c; break; } }
    if (!p) continue;
    // avoid sitting inside a city landmark
    const fp = engine.footprints;
    if (fp?.query) for (let k = 0; k < 6; k++) { const hits = fp.query(p.x, p.z, 5).filter((it) => it.tag === 'city-landmark' || String(it.tag).startsWith('sets')); if (!hits.length) break; p.addScaledVector(F.right, 7); }
    const gy = G(p.x, p.z);
    const B = new Building('set8-tower', { detail: det, seed: t.seed, variant: 'ruined', weather: 0.8 });
    towerInto(B, { w: t.w, h: t.h, broken: false });   // r4: white + red courses (precinct kit; the r1 banded ashlar read as grey blocks)
    const g = B.finalize({ position: [p.x, gy, p.z], rotY: yaw + 0.3 + t.seed * 0.1, ao: false });
    group.add(g);
    const T = tholos({ radius: t.w * 0.5, columns: 8, colH: 2.8, order: 'corinthian', gild: 1, detail: det, seed: t.seed, name: 'set8-towerTholos', steps: 2, stepH: 0.28, tread: 0.3, foundation: 1.0 });
    const tg = T.finalize({ position: [p.x, gy + t.h + 0.7 + 2 * 0.28, p.z], rotY: yaw, ao: false });
    group.add(tg);
  }
  // ---- r5: the far city on the citadel shore (ref 8 right half: terraces climbing to the right, towers, domes, an arcade
  //      left of the head) — blue silhouettes at 110-200 m that rise above the l1 curtain wall 44 m away
  try { group.add(farCity8(engine, F, G, det)); } catch (e) { console.error('[sets] far city 8 failed', e.stack || e); }
  group.traverse((m) => { if (m.isMesh && !m.userData.farCity) { m.castShadow = true; m.receiveShadow = true; } });
  return group;
}

/**
 * r5 (sunken): far silhouettes for shot 8, laid out in REFERENCE PIXELS of the shot-8 design frame (px, top row, depth):
 * stepped terrace walls climbing to the right, blocky houses on them, tall white/red towers with gilded tholoi and a
 * domed temple. Modest detail: the medium turns them into blue shapes (ref 8 background). No shadows cast, no AO.
 */
function farCity8(engine, F, G, det) {
  const g = new THREE.Group(); g.name = 'sets:farCity8';
  const rng = new RNG('set8:farcity');
  const top = (px, py, d) => F.at(px, py, d).y;
  const base = (x, z) => Math.min(G(x, z), 4) - 1.5;
  const B = new Building('set8-farcity', { detail: det * 0.7, seed: 85, variant: 'ruined', weather: 0.9 });
  const mw = B.marble, mr = B.get('red'), mi = B.mb.interior, mg = B.gold;
  const aux = [0.1, 0.3, 0.6, 3.05];
  // local frame of the group: origin at the camera ground point, x = right, z = toward the camera (−fwd), y world
  const O = new THREE.Vector3(F.pos.x, 0, F.pos.z);
  const toLocal = (p) => { const d = p.clone().sub(O); return [d.dot(F.right), p.y, -d.dot(F.fwd)]; };
  // terrace bands: [px0, px1, top row, depth]
  const TER = [[690, 1700, 262, 150], [800, 1700, 218, 162], [930, 1700, 178, 174], [1060, 1640, 142, 186]];  // tops clear the l1 curtain wall (row ≈ 200-260)
  const items = [];
  for (const [a, b, row, d] of TER) {
    const pa = F.at(a, 470, d), pb = F.at(b, 470, d), pc = F.at((a + b) / 2, 470, d);
    const yT = top((a + b) / 2, row, d), yB = base(pc.x, pc.z);
    const la = toLocal(pa), lb = toLocal(pb);
    const x0 = Math.min(la[0], lb[0]), x1 = Math.max(la[0], lb[0]), z0 = la[2] - 7, z1 = la[2] + 3;
    // the wall in stretches of unequal height (ruined crest), white with red courses, dark openings
    for (let x = x0; x < x1; x += rng.range(7, 13)) {
      const xe = Math.min(x1, x + rng.range(7, 13)), h = yT - rng.range(0, 2.5);
      box(mw, [x, yB, z0], [xe, h, z1], 0.05, aux);
      for (let y = yB + 4; y < h - 1; y += rng.range(3.5, 5)) box(mr, [x - 0.05, y, z1 - 0.02], [xe + 0.05, y + 0.6, z1 + 0.06], 0, [0.1, 0.4, 0.4, 0]);
      if (rng.random() < 0.6) { const wx = (x + xe) / 2; box(mi, [wx - 0.8, h - 5, z1], [wx + 0.8, h - 1.8, z1 + 0.04], 0, [0.9, 0, 0, 0]); }
      items.push([(x + xe) / 2, h, (z0 + z1) / 2, xe - x]);
    }
  }
  // houses / blocks on the terrace crests
  for (const [cx, h, cz, w] of items) {
    if (rng.random() < 0.35) continue;
    const bw = Math.min(w * 0.8, rng.range(4, 8)), bh = rng.range(3, 8), bd = rng.range(4, 7);
    const ox = cx + rng.range(-1, 1) * (w - bw) * 0.4, oz = cz - rng.range(2, 6);
    box(mw, [ox - bw / 2, h - 0.5, oz - bd / 2], [ox + bw / 2, h + bh, oz + bd / 2], 0.05, aux);
    box(mi, [ox - 0.6, h + bh * 0.4, oz + bd / 2], [ox + 0.6, h + bh * 0.4 + 1.8, oz + bd / 2 + 0.04], 0, [0.9, 0, 0, 0]);
    if (rng.random() < 0.2) { mg.push(); mg.translate(ox, h + bh, oz); ellipsoid(mg, bw * 0.38, bw * 0.34, bw * 0.38, 14, 8); mg.pop(); }
  }
  // tall towers: [px, top row, depth, width]
  const TW = [[875, 72, 158, 6.5], [1440, 58, 176, 7], [1330, 110, 150, 6], [1010, 118, 140, 5]];
  for (const [px, row, d, w] of TW) {
    const p = F.at(px, 470, d), l = toLocal(p), yT = top(px, row, d), yB = base(p.x, p.z), hw = w / 2;
    const ht = yT - 6;   // shaft top (the tholos-like crown above)
    box(mw, [l[0] - hw, yB, l[2] - hw], [l[0] + hw, ht, l[2] + hw], 0.05, aux);
    for (let y = yB + 5; y < ht - 1; y += 3.4) box(mr, [l[0] - hw - 0.06, y, l[2] - hw - 0.06], [l[0] + hw + 0.06, y + 0.7, l[2] + hw + 0.06], 0, [0.1, 0.4, 0.4, 0]);
    for (const y of [ht - 7, ht - 14]) box(mi, [l[0] - 0.7, y, l[2] + hw], [l[0] + 0.7, y + 3, l[2] + hw + 0.04], 0, [0.9, 0, 0, 0]);
    box(mw, [l[0] - hw - 0.5, ht, l[2] - hw - 0.5], [l[0] + hw + 0.5, ht + 0.8, l[2] + hw + 0.5], 0.04, aux);
    // crown: a drum of piers + a gilded dome + finial
    mw.push(); mw.translate(l[0], ht + 0.8, l[2]); cylinder(mw, hw * 0.8, hw * 0.8, 0, 3.2, 16, { capTop: true }); mw.pop();
    mg.push(); mg.translate(l[0], ht + 4.0, l[2]); ellipsoid(mg, hw * 0.85, hw * 0.75, hw * 0.85, 16, 9); mg.pop();
    mg.push(); mg.translate(l[0], ht + 4.0, l[2]); cylinder(mg, 0.18, 0.08, 0, hw * 0.75 + 2.2, 6, { capTop: true }); mg.pop();
  }
  // domed temple high on the hill (ref 8 px ≈ 1090-1290, row ≈ 150-230)
  {
    const px = 1085, d = 190, p = F.at(px, 470, d), l = toLocal(p), yT = top(px, 95, d), R = 10;
    const yB = top(px, 178, d);
    box(mw, [l[0] - R - 2, yB - 6, l[2] - R - 2], [l[0] + R + 2, yB, l[2] + R + 2], 0.05, aux);
    mw.push(); mw.translate(l[0], yB, l[2]); cylinder(mw, R, R, 0, (yT - yB) * 0.55, 28, { capTop: true }); mw.pop();
    for (let k = 0; k < 14; k++) { const a = (k / 14) * PI * 2; box(mi, [l[0] + Math.cos(a) * R - 0.5, yB + 2, l[2] + Math.sin(a) * R - 0.5], [l[0] + Math.cos(a) * R + 0.5, yB + (yT - yB) * 0.45, l[2] + Math.sin(a) * R + 0.5], 0, [0.9, 0, 0, 0]); }
    mg.push(); mg.translate(l[0], yB + (yT - yB) * 0.55, l[2]); ellipsoid(mg, R * 0.95, (yT - yB) * 0.45, R * 0.95, 24, 12); mg.pop();
  }
  // ruined aqueduct arcade left of the head (ref 8 px ≈ 430-700, rows ≈ 300-420)
  {
    const d = 112, pa = F.at(430, 470, d), pb = F.at(700, 470, d), la = toLocal(pa), lb = toLocal(pb);
    const yB = base((pa.x + pb.x) / 2, (pa.z + pb.z) / 2), yT = top(560, 300, d);
    const n = 6, span = (lb[0] - la[0]) / n, zc = (la[2] + lb[2]) / 2;
    for (let i = 0; i <= n; i++) {
      const x = la[0] + i * span, h = (i === 2 || i === 5) ? yT - rng.range(4, 8) : yT;
      box(mw, [x - 1.4, yB, zc - 1.2], [x + 1.4, h, zc + 1.2], 0.04, aux);
      if (i < n && i !== 2 && i !== 4) box(mw, [x + 1.4, yT - 3.2, zc - 1.2], [x + span - 1.4, yT, zc + 1.2], 0.04, aux); // lintel band (arches read as openings at this range)
    }
  }
  const grp = B.finalize({ position: [O.x, 0, O.z], rotY: yawFrame(F), ao: false });
  grp.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; m.userData.farCity = true; } });
  g.add(grp);
  return g;
}

/** rotation about Y that maps the group's local (x right, z toward the camera) onto the frame's right / −fwd */
function yawFrame(F) { return Math.atan2(-F.right.z, F.right.x); }
