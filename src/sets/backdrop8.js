// Shot 8 (ref 8) background: a ruined banded arcade across the far side of the forum plaza (ref 8 px
// 800-1150, behind the head) and two tall banded towers crowned by gilded tholoi further back on land
// ring 1 (ref 8 px ≈ 1170 and ≈ 1500). Silhouettes in the blue at 45-120 m — modest detail.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { Building } from '../arch/build.js';
import { box, extrudeOutline } from '../arch/geom.js';
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
  group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return group;
}
