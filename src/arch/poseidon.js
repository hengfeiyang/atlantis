// Temple of Poseidon (ref 3 / 6 / 9): stepped black podium + front stair, Corinthian peristyle with gold
// capitals, silver-clad cella, entablature with gilt frieze plaques on a navy band, navy pediments full of
// gold sea-creature relief, gold tridents (apex, corners, ridge row), gold pinnacles. Sunken variant: collapsed
// roof, broken pediment apex, toppled columns with scattered drums, cracked podium.
// Building-local frame: origin at the centre of the stylobate top, front = +Z, width X, length Z.
import * as THREE from 'three';
import { Building } from './build.js';
import { MeshBuilder, box, lathe, hash3, lerp } from './geom.js';
import { columnGeometry, columnInfo } from './orders.js';
import { Run, ionicRun, pediment, tiledRoof } from './entablature.js';
import { crepidoma, columnAxes, frontStairs } from './temple.js';
import { capitalGeometry, drumGeometry, brokenColumnGeometry, roughBlockGeometry } from './ruins.js';
import { shield, rosette } from './ornament.js';
import { trident, pinnacle, pedimentRelief } from './atlantis.js';

const PI = Math.PI;
/** r6: fraction of the tympanum half-width kept free of silhouettes around the centre trident (sculpted horses) */
export const RELIEF_GAP = 0.36;

/**
 * @param {object} o
 *  W, L: podium footprint (m); podium: podium height (m); nf, ns: column counts; colH, D; pitch (deg);
 *  sunken (bool) ruin; detail 0..1; seed; ruin: { roofFrom, toppled:[...] } overrides
 * @returns {Building} with info.anchors / info.coral / info.debris
 */
export function poseidonTemple(o = {}) {
  const t0 = performance.now();
  const sunken = !!o.sunken;
  const detail = o.detail ?? 1;
  const seed = o.seed ?? 11;
  const B = new Building(o.name || 'templeOfPoseidon', {
    detail, seed, variant: sunken ? 'ruined' : 'polished', weather: sunken ? 0.8 : 0.2,
    overrides: sunken ? { lichen: 0.25 } : { weather: 0.15, streaks: 0.15, rough: 0.42, polish: 0.55 },
  });
  B.info.coral = []; B.info.debris = [];
  const coral = (p, n = [0, 1, 0], size = 1, tag = 'temple') => B.info.coral.push({ pos: p, normal: n, size, tag });
  const W = o.W ?? 46, Lp = o.L ?? 92, podH = o.podium ?? 6;
  // ---------------------------------------------------------------- dimensions
  const steps = 3, stepH = 0.4, tread = 0.75;
  const crepH = steps * stepH;
  const stairDepth = o.stairDepth ?? 10;
  const Ws = W - 2 * steps * tread - 2.4;                     // stylobate
  const Ls = Lp - stairDepth - 2 * steps * tread - 2.4;
  const zc = -stairDepth / 2;                                  // stylobate centre is shifted back: stair in front within L
  const nf = o.nf ?? 8, ns = o.ns ?? 15;
  const colH = o.colH ?? 15.0;
  const D = o.D ?? 1.7;
  const e = 0.55 * D;
  const ax = Ws / 2 - e, az = Ls / 2 - e;
  const xs = columnAxes(2 * ax, nf, 1), zs = columnAxes(2 * az, ns, 1).map((z) => z + zc);
  const zF = az + zc, zB = -az + zc;                            // front / back column rows
  const pitch = ((o.pitch ?? 15.5) * PI) / 180;
  const mb = B.marble, mg = B.gold, mk = B.get('black'), mn = B.get('navy'), ms = B.get('silver'), mI = B.mb.interior;
  const capH = 1.17 * D;

  // ---------------------------------------------------------------- podium (black stone, gold bands)
  const yPod0 = -crepH - (podH - crepH);                      // = -podH (ground level)
  const pw = W / 2, pl = Lp / 2;
  const zPodF = Lp / 2 - stairDepth;                          // podium front face (stair in front of it)
  // plinth
  box(mk, [-pw - 0.6, yPod0, -pl - 0.6], [pw + 0.6, yPod0 + 0.55, zPodF + 0.6], 0.03, [0.2, 0.7, 0.2, 0]);
  // die: recessed panels between pilasters
  const yD0 = yPod0 + 0.55, yD1 = -crepH - 0.7;
  box(mk, [-pw + 0.25, yD0, -pl + 0.25], [pw - 0.25, yD1, zPodF - 0.25], 0, [0.15, 0, 0.3, 0]);
  const pil = (x0, z0, x1, z1) => box(mk, [x0, yD0, z0], [x1, yD1, z1], 0.02, [0.05, 0.8, 0.3, 0]);
  const pStep = 5.2;
  for (const s of [-1, 1]) {
    const nZ = Math.round((zPodF + pl) / pStep);
    for (let i = 0; i <= nZ; i++) { const z = -pl + ((zPodF + pl) * i) / nZ; pil(s * pw - 0.45, z - 0.5, s * pw + 0.0, z + 0.5); }
  }
  for (const zz of [zPodF, -pl]) {
    const nX = Math.round(W / pStep);
    for (let i = 0; i <= nX; i++) { const x = -pw + (W * i) / nX; pil(x - 0.5, zz < 0 ? zz - 0.0 : zz - 0.45, x + 0.5, zz < 0 ? zz + 0.45 : zz); }
  }
  // gilt panels in the podium bays (sides + back), cornice + gold band
  const gp = B.get('giltRelief');
  for (const s of [-1, 1]) {
    const nZ = Math.round((zPodF + pl) / pStep);
    for (let i = 0; i < nZ; i++) {
      const z = -pl + ((zPodF + pl) * (i + 0.5)) / nZ;
      gp.push(); gp.translate(s * (pw - 0.25), (yD0 + yD1) / 2, z); gp.rotateY(s * PI / 2);
      box(gp, [-1.6, -1.1, 0], [1.6, 1.1, 0.04], 0.01, [0.2, 0.5, 0, 0]);
      box(gp, [-1.45, -0.95, 0.04], [1.45, 0.95, 0.07], 0.01, [0.35, 0.4, 0, 0]);
      gp.pop();
    }
  }
  box(mk, [-pw - 0.35, yD1, -pl - 0.35], [pw + 0.35, yD1 + 0.45, zPodF + 0.35], 0.03, [0.05, 0.8, 0.5, 0]);
  box(mg, [-pw - 0.37, yD1 + 0.08, -pl - 0.37], [pw + 0.37, yD1 + 0.2, zPodF + 0.37], 0, [0.1, 0.4, 0, 0]);
  box(mk, [-pw - 0.1, yD1 + 0.45, -pl - 0.1], [pw + 0.1, -crepH, zPodF + 0.1], 0.02, [0.1, 0.4, 0.3, 0]);
  B.occBox([-pw - 0.6, yPod0, -pl - 0.6], [pw + 0.6, -crepH, zPodF + 0.6]);
  // crepidoma (white marble steps) on top of the podium
  mb.push(); mb.translate(0, 0, zc);
  crepidoma(B, Ws, Ls, { steps, stepH, tread, seed, detail, foundation: 0.05, blockL: 2.2 });
  mb.pop();
  // podium top paving between crepidoma and podium edge (white)
  box(mb, [-pw - 0.1, -crepH - 0.04, -pl - 0.1], [pw + 0.1, -crepH, zPodF + 0.1], 0, [0.05, 0, 0, 5.15]);
  // ---------------------------------------------------------------- front stair (white marble, full height) + cheek walls
  const stW = o.stairW ?? Math.min(W - 6, 32);
  mb.push(); mb.translate(0, 0, 0);
  const nR = Math.round(podH / 0.25), rh = podH / nR, tr = stairDepth / nR;
  for (let i = 0; i < nR; i++) {
    const yTop = -i * rh, z0s = zPodF - 0.6 + Math.max(0, (i - 0)) * tr;
    const segs = Math.max(1, Math.round(stW / 2.3));
    for (let k = 0; k < segs; k++) {
      const x0 = -stW / 2 + (stW / segs) * k, x1 = x0 + stW / segs;
      const crack = sunken && hash3(i, k, 91) < 0.08 ? -0.06 - 0.1 * hash3(k, i, 3) : 0;
      box(mb, [x0 + 0.004, yTop - rh - 0.4, zPodF - 0.6], [x1 - 0.004, yTop + crack, z0s + tr], 0.025, [0.05, 1, 0.05, 0]);
    }
    if (sunken && i % 5 === 2) coral([lerp(-stW / 2, stW / 2, hash3(i, 7, 7)), yTop, z0s + tr * 0.5], [0, 1, 0], 0.8, 'temple-stair');
  }
  mb.pop();
  // cheek walls with pedestals at the bottom (statue / brazier slots)
  for (const s of [-1, 1]) {
    const xw = s * (stW / 2 + 1.0);
    box(mk, [xw - 1.0, yPod0, zPodF - 0.5], [xw + 1.0, -crepH + 0.3, Lp / 2 - 1.2], 0.03, [0.1, 0.7, 0.3, 0]);
    box(mb, [xw - 1.1, -crepH + 0.3, zPodF - 0.5], [xw + 1.1, -crepH + 0.6, Lp / 2 - 1.1], 0.03, [0.05, 0.8, 0.4, 0]);
    // stepped down sloping coping: blocks following the stair slope
    const nb = 6;
    for (let i = 0; i < nb; i++) {
      const za = zPodF + (stairDepth * i) / nb, zb = zPodF + (stairDepth * (i + 1)) / nb;
      const yt = -crepH + 0.6 - (podH - 0.6) * ((i + 1) / nb) + 0.9;
      box(mb, [xw - 1.0, yPod0 + 0.5, za], [xw + 1.0, Math.max(yPod0 + 1.6, yt), zb], 0.03, [0.05, 0.8, 0.4, 0]);
    }
    // pedestal at the foot of the cheek wall
    const zp = Lp / 2 + 1.4;
    box(mk, [xw - 1.4, yPod0, zp - 1.4], [xw + 1.4, yPod0 + 0.4, zp + 1.4], 0.03, [0.1, 0.8, 0.2, 0]);
    box(mb, [xw - 1.1, yPod0 + 0.4, zp - 1.1], [xw + 1.1, yPod0 + 3.0, zp + 1.1], 0.03, [0.05, 0.6, 0.4, 3.04]);
    box(mb, [xw - 1.3, yPod0 + 3.0, zp - 1.3], [xw + 1.3, yPod0 + 3.35, zp + 1.3], 0.03, [0.05, 0.8, 0.4, 0]);
    box(mg, [xw - 1.32, yPod0 + 3.05, zp - 1.32], [xw + 1.32, yPod0 + 3.12, zp + 1.32], 0, [0.1, 0.5, 0, 0]);
    B.info.statues.push({ pos: [xw, yPod0 + 3.35, zp], dir: [0, 0, 1], size: 3.2, tag: 'temple-stair-pedestal' });
    B.info.braziers.push({ pos: [xw, -crepH + 0.6, zPodF - 0.2], dir: [0, 0, 1], size: 1.2, tag: 'temple-stair-top' });
  }
  B.occBox([-stW / 2 - 2, yPod0, zPodF - 0.6], [stW / 2 + 2, 0, Lp / 2]);

  // ---------------------------------------------------------------- columns
  const shaft = columnGeometry({ order: 'corinthian', height: colH - capH, diameter: D, detail: detail * 0.85, capital: false, plinth: true });
  const capGeo = capitalGeometry({ order: 'corinthian', diameter: D, detail: Math.min(0.8, detail * 0.8) });
  const capGeoLo = capitalGeometry({ order: 'corinthian', diameter: D, detail: 0.3 });
  const positions = [];
  xs.forEach((x, i) => { positions.push([x, zF, 'f', i]); positions.push([x, zB, 'b', i]); });
  zs.slice(1, -1).forEach((z, i) => { positions.push([ax, z, 'r', i + 1]); positions.push([-ax, z, 'l', i + 1]); });
  // sunken ruin: toppled columns (east side towards the back, a gap in the front-right, ref 6), stumps
  const toppled = new Set(), stumps = new Map();
  if (sunken) {
    for (const p of positions) {
      const [x, z, side, i] = p;
      const key = side + i;
      const r = hash3(seed + 41, Math.round(x * 3), Math.round(z * 3));
      let pTop = 0.04;
      if (side === 'r' && i < ns * 0.62) pTop = 0.6;
      if (side === 'b' && x > 0) pTop = 0.45;
      if (side === 'b' && x <= 0) pTop = 0.15;
      if (side === 'l' && i < ns * 0.5) pTop = 0.15;
      if (r < pTop) { toppled.add(key); if (hash3(i, seed, 5) < 0.6) stumps.set(key, 0.2 + 0.45 * hash3(seed, i, 9)); }
    }
  }
  const m4 = new THREE.Matrix4();
  // gilt torus ring on every column base (ref 3: gold bases under white shafts)
  const ringMb = new MeshBuilder();
  { const P = []; const r0 = 0.62 * D, tr = 0.075 * D, y0 = 0.17 * D; for (let i = 0; i <= 10; i++) { const a = -PI / 2 + (i / 10) * PI; P.push([r0 + 0.012 * D + tr * Math.cos(a), y0 + tr + tr * Math.sin(a), i === 0 || i === 10 ? 0.4 : 0, 0.3]); } lathe(ringMb, P, 40, {}); }
  const ringGeo = ringMb.geometry();
  const ruinDrum = sunken ? drumGeometry({ order: 'corinthian', diameter: D * 0.95, height: 1.25, chips: 0.6, seed: 3, detail: detail * 0.6 }) : null;
  let nDrum = 0;
  for (const [x, z, side, i] of positions) {
    const key = side + i;
    const r = hash3(seed, Math.round(x * 10), Math.round(z * 10));
    const rot = Math.floor(r * 4) * (PI / 2);
    if (toppled.has(key)) {
      // stump + fallen drums lying outward, roughly in a row (topple direction away from the cella)
      const bh = stumps.get(key);
      if (bh) {
        const g = brokenColumnGeometry({ order: 'corinthian', height: colH, diameter: D, breakAt: bh, seed: i * 7 + side.charCodeAt(0), detail: detail * 0.6, chips: 0.8 });
        m4.makeRotationY(rot).setPosition(x, 0, z);
        B.addInstance('stump' + key, g, m4);
        coral([x, colH * bh * 0.8, z], [0, 1, 0], 0.9, 'temple-stump');
      }
      const dirX = side === 'r' ? 1 : side === 'l' ? -1 : (hash3(i, 3, 1) - 0.5) * 0.6;
      const dirZ = side === 'f' ? 1 : side === 'b' ? -1 : (hash3(i, 5, 2) - 0.5) * 0.8;
      const dl = Math.hypot(dirX, dirZ) || 1;
      const ux = dirX / dl, uz = dirZ / dl;
      const nd = Math.round((colH - capH) / 1.25 * (1 - (bh || 0)));
      const ang = Math.atan2(ux, uz);
      for (let k = 0; k < nd; k++) {
        const dist = (bh || 0) * colH + 1.0 + k * 1.3 + (hash3(k, i, 11) - 0.5) * 0.6;
        const scatter = (hash3(k, i, 13) - 0.5) * (0.6 + k * 0.35);
        const px = x + ux * dist + uz * scatter, pz = z + uz * dist - ux * scatter;
        // drop off the stylobate / podium: y follows the step levels
        const inside = Math.abs(px) < Ws / 2 && Math.abs(pz - zc) < Ls / 2;
        const onPod = Math.abs(px) < pw && pz > -pl && pz < zPodF;
        const y = inside ? 0 : onPod ? -crepH : -podH;
        const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(PI / 2 + (hash3(k, i, 17) - 0.5) * 0.3, ang + (hash3(k, i, 19) - 0.5) * 0.7, 0, 'YXZ'));
        m4.compose(new THREE.Vector3(px, y + D * 0.45, pz), qq, new THREE.Vector3(1, 1, 1));
        B.addInstance('drums', ruinDrum, m4);
        nDrum++;
        if (k % 2 === 0) coral([px, y + D * 0.9, pz], [0, 1, 0], 0.7, 'temple-drum');
        B.info.debris.push([px, y, pz, D * 0.5]);
      }
      // capital lying at the end of the row
      const cd = (bh || 0) * colH + 1.5 + nd * 1.3;
      const cx = x + ux * cd, cz = z + uz * cd;
      const onPod = Math.abs(cx) < pw && cz > -pl && cz < zPodF;
      const inside = Math.abs(cx) < Ws / 2 && Math.abs(cz - zc) < Ls / 2;
      m4.compose(new THREE.Vector3(cx, (inside ? 0 : onPod ? -crepH : -podH) + 0.02, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(PI * 0.5 * (hash3(i, 1, 1) > 0.5 ? 1 : 0.15), ang, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
      B.addInstance('capitalsFallen', capGeo, m4, 'gold');
      continue;
    }
    const tilt = sunken ? (hash3(i, seed, 23) - 0.5) * 0.03 : 0.003;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * (hash3(i, 1, 2) - 0.5), rot, tilt * (hash3(i, 2, 1) - 0.5), 'XYZ'));
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1, 1));
    B.addInstance('shafts', shaft.geometry, m4);
    B.addInstance('baseRings', ringGeo, m4, 'gold');
    const mc = new THREE.Matrix4().compose(new THREE.Vector3(0, colH - capH, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    const front = side === 'f' || ((side === 'r' || side === 'l') && i >= ns - 4);
    B.addInstance(front ? 'capitals' : 'capitalsLo', front ? capGeo : capGeoLo, m4.clone().multiply(mc), 'gold');
    B.occCyl(x, z, D / 2, 0, colH);
    if (sunken && hash3(i, 9, side.length) < 0.5) coral([x, colH - capH * 0.5, z + (side === 'f' ? D * 0.6 : 0)], [0, 1, 0], 0.6, 'temple-capital');
  }

  // ---------------------------------------------------------------- entablature
  const ci = columnInfo({ order: 'corinthian', height: colH, diameter: D });
  const fA = ci.abacus * 0.5 * 0.97, dA = Math.max(1.0 * D, ci.abacus * 0.95);
  const hA = 0.62 * D, hF = 0.62 * D;
  const corners = { fl: [-ax, zF], fr: [ax, zF], br: [ax, zB], bl: [-ax, zB] };
  const runDefs = [
    { a: corners.fl, b: corners.fr, owner: true, id: 'front', axes: xs.map((x) => x + ax) },
    { a: corners.fr, b: corners.br, owner: false, id: 'right' },
    { a: corners.br, b: corners.bl, owner: true, id: 'back' },
    { a: corners.bl, b: corners.fl, owner: false, id: 'left' },
  ];
  // sunken: entablature missing over toppled stretches (split runs into intact segments between standing columns)
  const standing = (side, i) => !toppled.has(side + i);
  let yTop = 0, yCor = 0;
  const runsBuilt = [];
  for (const R of runDefs) {
    const segsR = [];
    if (!sunken) segsR.push([R.a, R.b, R.owner]);
    else {
      // column axes along the run in order
      let pts;
      if (R.id === 'front') pts = xs.map((x, i) => ({ p: [x, zF], ok: standing('f', i) }));
      else if (R.id === 'back') pts = xs.slice().reverse().map((x, i) => ({ p: [x, zB], ok: standing('b', nf - 1 - i) }));
      else if (R.id === 'right') pts = zs.slice().reverse().map((z, i) => ({ p: [ax, z], ok: i === 0 ? standing('f', nf - 1) : i === ns - 1 ? standing('b', nf - 1) : standing('r', ns - 1 - i) }));
      else pts = zs.map((z, i) => ({ p: [-ax, z], ok: i === 0 ? standing('b', 0) : i === ns - 1 ? standing('f', 0) : standing('l', i) }));
      let start = -1;
      for (let i = 0; i <= pts.length; i++) {
        const ok = i < pts.length && pts[i].ok;
        if (ok && start < 0) start = i;
        if (!ok && start >= 0) { if (i - 1 > start) segsR.push([pts[start].p, pts[i - 1].p, R.owner && start === 0 && i === pts.length]); start = -1; }
      }
    }
    for (const [a, b, own] of segsR) {
      const run = new Run(a, b);
      const res = ionicRun(B, run, { y0: colH, D, fA, dA, hA, hF, owner: own, detail, gild: 1, frieze: 'plaques', plaqueSpacing: 1.45 * D, ov: 0.5 * D });
      yTop = res.yTop; yCor = res.yCorona;
      // r6: no navy band behind the gilt plaques any more (ref 3: white marble frieze with framed gilt panels);
      // a thin gilt fillet under and over the frieze frames the plaque row instead
      run.frame(mg);
      const sF0 = own ? -fA : -fA + dA, sF1 = own ? run.len + fA : run.len + fA - dA;
      for (const yy of [colH + hA + 0.015 * D, colH + hA + hF - 0.06 * D]) box(mg, [sF0, yy, fA - 0.02 * D], [sF1, yy + 0.045 * D, fA - 0.0 * D], 0, [0.1, 0.4, 0, 0]);
      mg.pop();
      runsBuilt.push(run);
      if (sunken) { const mid = run.p(run.len / 2, yTop, fA * 0.5); coral(mid, [0, 1, 0], 1.0, 'temple-entablature'); }
    }
  }
  if (!yTop) { const r = ionicRun(new Building('tmp'), new Run([0, 0], [1, 0]), { y0: colH, D, fA, dA, hA, hF, owner: true, detail: 0.1, gild: 0, ov: 0.5 * D }); yTop = r.yTop; yCor = r.yCorona; }
  const ovE = 0.5 * D;
  B.occBox([-ax - fA - ovE, colH, zF + fA - dA], [ax + fA + ovE, yTop, zF + fA + ovE]);
  B.occBox([-ax - fA - ovE, colH, zB - fA - ovE], [ax + fA + ovE, yTop, zB - fA + dA]);
  B.occBox([ax + fA - dA, colH, zB - fA], [ax + fA + ovE, yTop, zF + fA]);
  B.occBox([-ax - fA - ovE, colH, zB - fA], [-ax - fA + dA, yTop, zF + fA]);

  // ---------------------------------------------------------------- pediments, relief, tridents, roof
  const hR = 0.32 * D, simaH = 0.24 * D;
  const half = ax + fA + ovE;
  const pedRuns = [];
  const frontRun = new Run(corners.fl, corners.fr), backRun = new Run(corners.br, corners.bl);
  const frontBroken = sunken, backBroken = sunken && true;
  const Hp = half * Math.tan(pitch);
  for (const [run, id] of [[frontRun, 'front'], [backRun, 'back']]) {
    const broken = id === 'front' ? frontBroken : backBroken;
    if (broken && id === 'back') continue;          // the back pediment fell (sunken)
    const before = B.info.pediments.length;
    pediment(B, run, { yBase: yTop, fA, ov: ovE, D, pitch, hR, simaH, acroteria: 'none', corners: 'none', detail, gild: 1, pediments: B.info.pediments, rakingAntefixes: detail > 0.45, rakingAntefixH: 0.72, rakingSpacing: 1.1, recess: 0.35 * D });
    const P = B.info.pediments[before];
    if (!P) continue;
    pedRuns.push({ run, id, P });
    // navy tympanum skin + gold relief
    const Mx = new THREE.Matrix4().makeBasis(new THREE.Vector3(...P.right), new THREE.Vector3(...P.up), new THREE.Vector3(...P.normal));
    Mx.setPosition(...P.origin);
    const hb = P.baseWidth / 2, hp = P.height;
    mn.push(); mn.apply(Mx);
    const triPts = [[-hb - 0.2, 0.0], [hb + 0.2, 0.0], [0, hp + 0.1]];
    mn.translate(0, 0, 0.004);
    // flat triangle (one quad-less tri face)
    mn.triP([triPts[0][0], triPts[0][1], 0], [triPts[1][0], triPts[1][1], 0], [triPts[2][0], triPts[2][1], 0], [0.25, 0, 0.2, 0]);
    mn.pop();
    mg.push(); mg.apply(Mx); mg.translate(0, 0.05, 0.01);
    if (broken) {
      // ruined: relief partly missing on the right half of the pediment
      const tmp = new MeshBuilder();
      pedimentRelief(tmp, hb * 0.96, hp * 0.92, { depth: 0.4, centre: 'trident', startX: hb * RELIEF_GAP });
      mg.merge(tmp);
    } else pedimentRelief(mg, hb * 0.96, hp * 0.92, { depth: 0.4, centre: 'trident', startX: hb * RELIEF_GAP });
    P.horseGap = hb * RELIEF_GAP;   // r6: room left for the sculpted horses (statues module: |x| < horseGap)
    mg.pop();
    // apex trident + corner pinnacles with tridents
    const apexY = yTop + Hp + hR / Math.cos(pitch) + simaH * 0.5;
    const apex = run.p(run.len / 2, apexY, fA + ovE * 0.3);
    if (!(broken && sunken && id === 'front' && false)) {
      // r6 (ref 3): a bulky gilt acroterion — stepped plinth, gadrooned bulb, flanking volutes — carrying a heavy trident
      mg.push(); mg.translate(apex[0], apex[1] - 0.1, apex[2]); mg.rotateY(run.theta);
      box(mg, [-0.95, 0, -0.75], [0.95, 0.4, 0.75], 0.04, [0.1, 0.6, 0.2, 0]);
      lathe(mg, [[0.75, 0.4, 0, 0, true], [0.78, 0.55, 0, 0.6, true], [0.52, 0.66, 0.2, 0], [0.72, 0.95, 0, 0.5], [0.78, 1.2, 0, 0.6, true], [0.5, 1.5, 0.2, 0], [0.32, 1.7, 0.2, 0], [0.45, 1.82, 0, 0.6, true], [0.4, 1.95, 0, 0, true]], 14, { capTop: true });
      for (const sv of [-1, 1]) { mg.push(); mg.translate(sv * 0.95, 0.4, 0); mg.rotateZ(sv * 0.35); lathe(mg, [[0.001, 0, 0, 0], [0.32, 0.12, 0, 0.5], [0.26, 0.55, 0.2, 0], [0.12, 1.0, 0, 0.4], [0.001, 1.25, 0, 0]], 10, {}); mg.pop(); }
      mg.translate(0, 1.9, 0); trident(mg, 6.6, { detail, thick: 1.6 });
      mg.pop();
    }
    for (const s of [-1, 1]) {
      const c = run.p(s < 0 ? -fA - ovE * 0.4 : run.len + fA + ovE * 0.4, yTop + hR + simaH * 0.3, fA + ovE * 0.3);
      if (id === 'back') {
        // r2 (arch-b): back corners carry gold acroterion figures (refs 1, 5: gold statues on the roof corners)
        // on a moulded marble plinth; the statues module fills the 'pinnacle' slots
        mb.push(); mb.translate(c[0], c[1], c[2]); mb.rotateY(run.theta);
        box(mb, [-0.85, 0, -0.85], [0.85, 0.9, 0.85], 0.04, [0.1, 0.6, 0.3, 0]);
        box(mb, [-1.0, 0.9, -1.0], [1.0, 1.15, 1.0], 0.04, [0.1, 0.9, 0.3, 0]);
        mb.pop();
        mg.push(); mg.translate(c[0], c[1], c[2]); mg.rotateY(run.theta);
        box(mg, [-0.87, 0.62, -0.87], [0.87, 0.72, 0.87], 0, [0.1, 0.4, 0, 0]);
        mg.pop();
        B.info.statues.push({ pos: [c[0], c[1] + 1.15, c[2]], dir: [run.out[0], 0, run.out[1]], size: 3.6, tag: 'pinnacle', type: 'kingSpear' });
        continue;
      }
      // r6 (ref 3): tall corner acroteria — marble die with a gilt band, gold pinnacle, trident finial
      mb.push(); mb.translate(c[0], c[1], c[2]); mb.rotateY(run.theta);
      box(mb, [-0.9, 0, -0.9], [0.9, 1.5, 0.9], 0.04, [0.1, 0.6, 0.3, 0]);
      box(mb, [-1.05, 1.5, -1.05], [1.05, 1.75, 1.05], 0.04, [0.1, 0.9, 0.3, 0]);
      mb.pop();
      mg.push(); mg.translate(c[0], c[1], c[2]); mg.rotateY(run.theta);
      box(mg, [-0.93, 1.0, -0.93], [0.93, 1.12, 0.93], 0, [0.1, 0.4, 0, 0]);
      box(mg, [-0.7, 1.75, -0.7], [0.7, 2.2, 0.7], 0.04, [0.1, 0.6, 0, 0]);
      mg.translate(0, 2.2, 0); pinnacle(mg, 5.6, { trident: true, detail, thick: 1.4 });
      mg.pop();
    }
    // r6 (ref 3): gilt pinnacle-tridents half way up each raking cornice
    for (const s of [-1, 1]) {
      const sh = half * 0.5, sx = s < 0 ? -fA - ovE + sh : run.len + fA + ovE - sh;
      const y = yTop + sh * Math.tan(pitch) + (hR + simaH) / Math.cos(pitch) - 0.05;
      const c = run.p(sx, y, fA + ovE * 0.2);
      mg.push(); mg.translate(c[0], c[1], c[2]); mg.rotateY(run.theta);
      box(mg, [-0.42, 0, -0.42], [0.42, 0.35, 0.42], 0.03, [0.1, 0.6, 0, 0]);
      mg.translate(0, 0.35, 0); pinnacle(mg, 3.4, { trident: true, detail, thick: 1.3 });
      mg.pop();
    }
  }
  const yEaves = yTop + hR / Math.cos(pitch);
  const zEaves0 = sunken ? zF - (zF - zB) * 0.3 : zB - fA - ovE;
  for (const s of [-1, 1]) {
    box(mb, [s < 0 ? -half : half - 0.35 * D, yTop, zEaves0], [s < 0 ? -half + 0.35 * D : half, yEaves, zF + fA + ovE], 0.01 * D, [0.05, 0.3, 0.6, 0]);
    box(mg, [s < 0 ? -half - 0.012 : half - 0.02, yEaves - 0.06 * D, zEaves0], [s < 0 ? -half + 0.02 : half + 0.012, yEaves - 0.035 * D, zF + fA + ovE], 0, [0.2, 0.3, 0, 0]);
  }
  const yRidge = yEaves + half * Math.tan(pitch);
  // gold finials along the flank eaves, over every second column (ref 3 roofline)
  for (const sx of [-1, 1]) {
    for (let i = 1; i < ns - 1; i += 2) {
      const z = zs[i];
      if (sunken && z < zF - (zF - zB) * 0.3) continue;
      mg.push(); mg.translate(sx * (half - 0.15), yEaves, z);
      box(mg, [-0.42, 0, -0.42], [0.42, 0.35, 0.42], 0.03, [0.1, 0.6, 0, 0]);
      mg.translate(0, 0.35, 0); pinnacle(mg, i % 4 === 1 ? 3.6 : 3.0, { detail: 0.5, trident: true, thick: 1.3 });   // r6: taller, all with tridents (ref 3)
      mg.pop();
    }
  }
  const zr0 = zB - fA - ovE + 0.1 * D, zr1 = zF + fA + ovE - 0.1 * D;
  if (!sunken) {
    tiledRoof(B, { xo: half, z0: zr0, z1: zr1, yEaves, pitch, antefixes: true, ridgePalmettes: false, gild: 1, antefixH: 0.5, detail: detail > 0.5 ? 0.25 : 0.2 });
  } else {
    // only the front third of the roof survives; broken beams/blocks fall into the cella
    const zCut = zF - (zF - zB) * 0.3;
    tiledRoof(B, { xo: half, z0: zCut, z1: zr1, yEaves, pitch, antefixes: true, ridgePalmettes: false, gild: 1, antefixH: 0.5, detail: 0.2 });
    // broken edge blocks along the cut
    for (let i = 0; i < 14; i++) {
      const x = lerp(-half * 0.95, half * 0.95, i / 13);
      const yy = yEaves + (half - Math.abs(x)) * Math.tan(pitch);
      const g = roughBlockGeometry({ size: [2.6, 0.7, 1.6], seed: 300 + i, chip: 0.08, broken: { nz: 0.4 }, detail: 0.5 });
      m4.compose(new THREE.Vector3(x, yy - 0.4 - hash3(i, 1, 1) * 0.6, zCut - 0.4), new THREE.Quaternion().setFromEuler(new THREE.Euler((hash3(i, 2, 2) - 0.5) * 0.5, 0, Math.sign(x) * pitch * (x === 0 ? 0 : 1))), new THREE.Vector3(1, 1, 1));
      B.addInstance('roofBreak', g, m4);
    }
    // fallen roof blocks inside the cella + pediment fragments behind the temple
    for (let i = 0; i < 26; i++) {
      const x = (hash3(i, 7, 1) - 0.5) * (Ws - 8), z = lerp(zB + 4, zCut - 3, hash3(i, 7, 2));
      const sz = [1.8 + hash3(i, 3, 3) * 2.2, 0.6 + hash3(i, 4, 4) * 0.8, 1.2 + hash3(i, 5, 5) * 1.5];
      const g = roughBlockGeometry({ size: sz, seed: 400 + i, chip: 0.1, broken: { px: 0.3, nz: 0.3 }, detail: 0.5 });
      m4.compose(new THREE.Vector3(x, 0.2 + hash3(i, 6, 6) * 1.5, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((hash3(i, 8, 8) - 0.5) * 0.9, hash3(i, 9, 9) * PI, (hash3(i, 10, 10) - 0.5) * 0.9)), new THREE.Vector3(1, 1, 1));
      B.addInstance('roofDebris', g, m4);
      coral([x, 1.5, z], [0, 1, 0], 1.2, 'temple-debris');
    }
    for (let i = 0; i < 10; i++) {
      const x = (hash3(i, 17, 1) - 0.5) * W * 0.9, z = -pl - 2 - hash3(i, 17, 2) * 9;
      const g = roughBlockGeometry({ size: [2.4, 1.0, 1.6], seed: 500 + i, chip: 0.1, broken: { px: 0.3 }, detail: 0.5 });
      m4.compose(new THREE.Vector3(x, -podH + 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(hash3(i, 18, 1), hash3(i, 19, 1) * PI, 0)), new THREE.Vector3(1, 1, 1));
      B.addInstance('pedDebris', g, m4);
      B.info.debris.push([x, -podH, z, 1.5]);
    }
  }
  // ridge row of gold tridents
  const ridgeZ0 = sunken ? zF - (zF - zB) * 0.3 + 2 : zr0 + 3, ridgeZ1 = zr1 - 3;
  const nTr = Math.max(2, Math.round((ridgeZ1 - ridgeZ0) / 7));
  for (let i = 0; i <= nTr; i++) {
    const z = lerp(ridgeZ0, ridgeZ1, i / nTr);
    mg.push(); mg.translate(0, yRidge + 0.1, z); mg.rotateY(PI / 2);
    lathe(mg, [[0.3, 0, 0, 0, true], [0.3, 0.25, 0, 0.6, true], [0.18, 0.32, 0, 0]], 10, { capTop: true });
    mg.translate(0, 0.3, 0); trident(mg, 3.4, { detail: detail * 0.6, thick: 1.3 });
    mg.pop();
  }
  B.occFn([-half, yTop, zB - fA - ovE], [half, yRidge, zF + fA + ovE], (x, y) => y < yEaves + (half - Math.abs(x)) * Math.tan(pitch));

  // ---------------------------------------------------------------- ceiling, cella (silver-clad), porches
  const ceilY = colH + hA + hF * 0.85;
  if (!sunken) box(mI, [-ax - fA + dA, ceilY, zB - fA + dA], [ax + fA - dA, ceilY + 0.4, zF + fA - dA], 0, [0.4, 0, 0, 0]);
  else box(mI, [-ax - fA + dA, ceilY, zF - (zF - zB) * 0.3], [ax + fA - dA, ceilY + 0.4, zF + fA - dA], 0, [0.4, 0, 0, 0]);
  // coffer beams over the peristyle aisles
  const cw = 2 * (ax - 2.3 * D);
  for (const s of [-1, 1]) {
    for (let z = zB + 0.6; z < zF - 0.4; z += 1.6) {
      if (sunken && z < zF - (zF - zB) * 0.3) continue;
      box(mb, [s < 0 ? -ax - fA + dA : cw / 2, ceilY - 0.45, z - 0.16], [s < 0 ? -cw / 2 : ax + fA - dA, ceilY, z + 0.16], 0.02, [0.35, 0, 0, 0]);
    }
  }
  const t = 0.9, floorY = 0.5;
  const zPF = zF - 2.6 * D, zPB = zB + 2.6 * D;
  const z1 = zPF - 2.2 * D, z0 = zPB + 2.2 * D;
  box(mb, [-cw / 2 - 0.6, 0, zPB - D * 0.8], [cw / 2 + 0.6, floorY, zPF + D * 0.8], 0.02, [0.1, 0.8, 0.1, 5.15]);
  const hw = cw / 2;
  const wallH = ceilY;
  // walls: marble dado + silver cladding above + gold band at the top
  const wallSeg = (x0, z0w, x1, z1w, yb, yt) => {
    box(mb, [x0, floorY, z0w], [x1, floorY + 1.3, z1w], 0.02, [0.1, 0.5, 0.2, 3.06]);
    box(ms, [x0 + 0.03, floorY + 1.3, z0w + 0.03], [x1 - 0.03, Math.min(yt, wallH - 0.6), z1w - 0.03], 0.01, [0.05, 0.4, 0.2, 0]);
    box(mg, [x0, wallH - 0.6, z0w], [x1, wallH - 0.35, z1w], 0.01, [0.1, 0.5, 0, 0]);
    box(mb, [x0 + 0.04, wallH - 0.35, z0w + 0.04], [x1 - 0.04, wallH, z1w - 0.04], 0.01, [0.1, 0.5, 0.2, 0]);
  };
  const cellaTop = (z) => (sunken && z < zF - (zF - zB) * 0.45 ? wallH * (0.45 + 0.4 * hash3(Math.round(z), 1, 3)) : wallH);
  // side walls (segmented so the sunken top can be broken)
  const nWs = 12;
  for (const s of [-1, 1]) {
    for (let i = 0; i < nWs; i++) {
      const za = lerp(z0, z1, i / nWs), zb = lerp(z0, z1, (i + 1) / nWs);
      wallSeg(s < 0 ? -hw : hw - t, za, s < 0 ? -hw + t : hw, zb, floorY, cellaTop((za + zb) / 2));
      if (sunken && cellaTop((za + zb) / 2) < wallH) coral([s * (hw - t / 2), cellaTop((za + zb) / 2), (za + zb) / 2], [0, 1, 0], 1.0, 'temple-cella');
    }
    // antae
    box(mb, [s < 0 ? -hw : hw - t, floorY, z1], [s < 0 ? -hw + t : hw, wallH, zPF + 0.6], 0.02, [0.05, 0.5, 0.3, 3.05]);
    box(mb, [s < 0 ? -hw : hw - t, floorY, zPB - 0.6], [s < 0 ? -hw + t : hw, wallH, z0], 0.02, [0.05, 0.5, 0.3, 3.05]);
  }
  // front + back walls with door openings
  const dw = 6.0, dh = 9.0;
  for (const [zw, dir] of [[z1, 1], [z0, -1]]) {
    const zA = dir > 0 ? zw - t : zw, zBw = dir > 0 ? zw : zw + t;
    wallSeg(-hw + t, zA, -dw / 2, zBw, floorY, wallH);
    wallSeg(dw / 2, zA, hw - t, zBw, floorY, wallH);
    box(ms, [-dw / 2, floorY + dh, zA + 0.03], [dw / 2, wallH - 0.6, zBw - 0.03], 0.01, [0.05, 0.4, 0.2, 0]);
    // gold door frame + bronze doors (front: half open)
    const fz = dir > 0 ? zBw : zA;
    box(mg, [-dw / 2 - 0.45, floorY, fz - 0.05 * dir], [-dw / 2, floorY + dh + 0.45, fz + 0.18 * dir], 0.02, [0.1, 0.6, 0, 0]);
    box(mg, [dw / 2, floorY, fz - 0.05 * dir], [dw / 2 + 0.45, floorY + dh + 0.45, fz + 0.18 * dir], 0.02, [0.1, 0.6, 0, 0]);
    box(mg, [-dw / 2 - 0.7, floorY + dh + 0.45, fz - 0.05 * dir], [dw / 2 + 0.7, floorY + dh + 1.0, fz + 0.3 * dir], 0.02, [0.1, 0.6, 0, 0]);
    if (dir > 0) {
      const mz = B.bronze;
      for (const s of [-1, 1]) {
        mz.push(); mz.translate(s * dw / 2, floorY, zA - 0.05); mz.rotateY(-s * 1.0);
        box(mz, [s < 0 ? 0 : -dw / 2, 0, -0.18], [s < 0 ? dw / 2 : 0, dh, 0], 0.01, [0.1, 0.3, 0, 0]);
        for (let k = 0; k < 4; k++) box(mz, [s < 0 ? 0.2 : -dw / 2 + 0.2, 0.4 + k * (dh - 0.6) / 4, 0], [s < 0 ? dw / 2 - 0.2 : -0.2, 0.4 + (k + 0.85) * (dh - 0.6) / 4, 0.05], 0.01, [0.3, 0.6, 0, 0]);
        mz.pop();
      }
    }
  }
  // interior skin (dark) + floor
  box(mI, [-hw + t, floorY - 0.02, z0 + t], [hw - t, floorY + 0.01, z1 - t], 0, [0.4, 0, 0, 5.15]);
  for (const s of [-1, 1]) box(mI, [s < 0 ? -hw + t : hw - t - 0.03, floorY, z0 + t], [s < 0 ? -hw + t + 0.03 : hw - t, wallH * 0.8, z1 - t], 0, [0.5, 0, 0, 0]);
  B.occBox([-hw, floorY, z0], [-hw + t, wallH, z1]); B.occBox([hw - t, floorY, z0], [hw, wallH, z1]);
  B.occBox([-hw, floorY, z1 - t], [hw, wallH, z1]); B.occBox([-hw, floorY, z0], [hw, wallH, z0 + t]);
  if (!sunken) B.occBox([-ax - fA + dA, ceilY, zB - fA + dA], [ax + fA - dA, ceilY + 0.4, zF + fA - dA]);
  // porch columns (6 each end) + architrave/frieze over them
  const porchN = 6, pD = D * 0.9;
  const pShaft = columnGeometry({ order: 'corinthian', height: colH - floorY - 1.17 * pD, diameter: pD, detail: detail * 0.7, capital: false, plinth: true });
  const pCap = capitalGeometry({ order: 'corinthian', diameter: pD, detail: 0.45 });
  const pxs = columnAxes(cw - t - pD * 0.4, porchN, 1);
  for (const zp of [zPF, zPB]) {
    if (sunken && zp === zPB) {
      // the opisthodomos porch is mostly fallen: 2 stumps
      for (const i of [0, 4]) { const g = brokenColumnGeometry({ order: 'corinthian', height: colH, diameter: pD, breakAt: 0.3 + 0.2 * hash3(i, 2, 2), seed: 70 + i, detail: 0.5 }); m4.makeTranslation(pxs[i], floorY, zp); B.addInstance('pstump' + i, g, m4); }
      continue;
    }
    pxs.forEach((x, i) => {
      const r = hash3(seed + 5, i, Math.round(zp));
      m4.compose(new THREE.Vector3(x, floorY, zp), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.floor(r * 4) * (PI / 2), 0)), new THREE.Vector3(1, 1, 1));
      B.addInstance('porchShafts', pShaft.geometry, m4);
      B.addInstance('porchCaps', pCap, m4.clone().multiply(new THREE.Matrix4().makeTranslation(0, colH - floorY - 1.17 * pD, 0)), 'gold');
      B.occCyl(x, zp, pD / 2, floorY, colH);
    });
    const dir = zp > 0 ? 1 : -1;
    void dir;
    box(mb, [-cw / 2, colH, zp - 0.55 * pD], [cw / 2, colH + hA, zp + 0.55 * pD], 0.015, [0.05, 0, 0.5, 0]);
    box(mn, [-cw / 2, colH + hA, zp - 0.55 * pD], [cw / 2, ceilY, zp + 0.55 * pD], 0.015, [0.15, 0, 0.5, 0]);
    for (let i = 0; i < porchN - 1; i++) {
      const x = (pxs[i] + pxs[i + 1]) / 2;
      mg.push(); mg.translate(x, colH + hA + (ceilY - colH - hA) * 0.5, zp + (zp > 0 ? 1 : -1) * 0.55 * pD); if (zp < 0) mg.rotateY(PI);
      shield(mg, Math.min(0.5, (ceilY - colH - hA) * 0.38), { segs: 24 }); mg.pop();
    }
    // banner slots between porch columns (skip the door bay) — ref 3: navy banners with gold trident
    if (!sunken) {
      for (let i = 0; i < porchN - 1; i++) {
        if (i === 2) continue;
        const x = (pxs[i] + pxs[i + 1]) / 2, gap = pxs[i + 1] - pxs[i] - pD;
        B.info.banners.push({ pos: [x, colH - 0.2, zp], dir: [0, 0, zp > 0 ? 1 : -1], width: Math.min(2.8, gap * 0.8), height: 8.2, size: 8.2, tag: 'temple-pronaos', anchor: 'top-centre', priority: 1 });
      }
    }
  }
  // banner slots on the cella side walls, between the side columns (ref 3 right side: tall navy banners)
  if (!sunken) {
    for (const s of [-1, 1]) {
      for (let i = 2; i < ns - 2; i += 2) {
        const z = (zs[i] + zs[i + 1]) / 2;
        if (z > z1 - 1 || z < z0 + 1) continue;
        B.info.banners.push({ pos: [s * (hw + 0.05), wallH - 1.0, z], dir: [s, 0, 0], width: 2.2, height: 7.5, size: 7.5, tag: 'temple-cella-wall', anchor: 'top-centre', priority: 2 });
      }
    }
  }
  // r6 (ref 3 right flank): long navy banners hanging from the architrave between the flank columns (front half,
  // every second intercolumniation) — they read along the colonnade from the forecourt and as blue accents from afar
  if (!sunken) {
    const gapZ = (zs[1] - zs[0]) - D;
    for (const s of [-1, 1]) {
      for (let i = ns - 2; i >= Math.floor(ns * 0.35); i -= 2) {
        const z = (zs[i] + zs[i + 1]) / 2;
        B.info.banners.push({ pos: [s * ax, colH - 0.25, z], dir: [s, 0, 0], width: Math.min(2.4, gapZ * 0.62), height: 9.0, size: 9.0, tag: 'temple-flank', anchor: 'top-centre', priority: 1 });
      }
    }
  }
  // cult statue slot
  B.info.statues.push({ pos: [0, floorY, (z0 + z1) / 2 - 6], dir: [0, 0, 1], size: 9, tag: 'temple-cella', interior: true });
  // coral slots on the podium steps / crepidoma (sunken)
  if (sunken) {
    for (let i = 0; i < 40; i++) {
      const a = hash3(i, 33, 1);
      const side = Math.floor(a * 4);
      const u = hash3(i, 33, 2);
      let p;
      if (side === 0) p = [lerp(-pw, pw, u), -crepH, zPodF - 0.3];
      else if (side === 1) p = [pw - 0.3, -crepH, lerp(-pl, zPodF, u)];
      else if (side === 2) p = [-pw + 0.3, -crepH, lerp(-pl, zPodF, u)];
      else p = [lerp(-Ws / 2, Ws / 2, u), 0, lerp(zB, zF, hash3(i, 33, 3))];
      coral(p, [0, 1, 0], 0.6 + hash3(i, 3, 3) * 0.8, 'temple-podium');
    }
  }
  B.info.anchors = { W, L: Lp, D, colH, capH, crepH, podH, yTop, yCor, yEaves, yRidge, pitch, half, fA, ax, az, zc, zF, zB, zPodF, cw, Ws, Ls, stW, stairDepth, columns: positions.map(([x, z]) => [x, z]), nDrum };
  B.info.footprint = { hw: W / 2 + 1, hd: Lp / 2 + 1 };
  B.genMs = Math.round(performance.now() - t0);
  return B;
}
