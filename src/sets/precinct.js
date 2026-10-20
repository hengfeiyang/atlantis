// Shots 6 + 9 (refs 6, 9; SUNKEN ERA ONLY — r4 sunken): the ruined sacred precinct around the citadel plateau.
// Ref 9 shows the temple ringed by arcaded rings with domed towers at every distance, ref 6 a far-left skyline of
// arcades, domed tholoi and towers in the blue; from our cameras the real rings are hidden below the plateau rim,
// so the plateau itself carries a ruined peribolos: a single-tier arcade on the rim (r ≈ 103, front faces the
// temple), square banded towers with gilded tholoi (some leaning / roofless), an inner ring of broken column
// stumps with fallen drums, and rubble — growth substrate for the marine module (it scatters after the sets).
// Everything is skipped where something is already built (GPU top-down surface map of the plateau) and the
// south sector (stair head, shot 3/6 camera at r 99) is left open.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { Building } from '../arch/build.js';
import { box, extrudeOutline } from '../arch/geom.js';
import { tholos } from '../arch/tholos.js';
import { brokenColumnGeometry, drumGeometry, roughBlockGeometry } from '../arch/ruins.js';
import { RNG } from '../core/rng.js';

const PI = Math.PI, D2R = PI / 180;
export const PRECINCT = {
  r: 103,                        // arcade centreline radius (plateau 110, rim wall r 110-114)
  pitch: 5.6, span: 4.2, depth: 1.7, impost: 5.2, attic: 1.3, // bays
  sectors: [[226, 318], [337, 383], [43, 134]],  // bearings with arcade (deg; 383 = 23): open south (stair), clear of the citadel towers (±32.7)
  stumpR: 90, stumpPitch: 6.5,   // inner ring of broken columns
};

/** write one arcade run into B (local frame: x along the run, front face z = +d/2, ground y = 0) */
function arcadeRun(B, o, rng, mbKey) {
  const mb = B.get(mbKey), mw = B.marble;
  const s = o.span, w = o.pitch - o.span, d = o.depth, ya = o.impost, r = s / 2, top = ya + r + o.attic;
  const nb = o.bays.length;
  const X0 = -(nb * (s + w) + w) / 2;
  const segN = 12;
  const aux = [0.1, 0.3, 0.6, 3.05];
  for (let i = 0; i <= nb; i++) {
    const x = X0 + i * (s + w);
    const left = o.bays[i - 1], right = o.bays[i];
    if ((left === undefined || left === 'none') && (right === undefined || right === 'none')) continue;
    const gone = (left === undefined || left === 'gone' || left === 'none') && (right === undefined || right === 'gone' || right === 'none');
    const h = gone ? rng.range(1.2, ya * 0.75) : (left === 'broken' && right !== 'full') ? rng.range(ya * 0.9, ya + r) : ya;
    box(mb, [x, -1.2, -d / 2], [x + w, h, d / 2], 0.03, aux);
    if (!gone) box(mw, [x - 0.08, ya - 0.24, -d / 2 - 0.08], [x + w + 0.08, ya, d / 2 + 0.08], 0.02, [0.1, 0.8, 0.3, 0]);
    box(mw, [x - 0.14, -1.2, -d / 2 - 0.14], [x + w + 0.14, 0.5, d / 2 + 0.14], 0.03, [0.2, 0.5, 0.2, 0]);
  }
  for (let i = 0; i < nb; i++) {
    const kind = o.bays[i];
    if (kind === 'gone' || kind === 'none') continue;
    const x0 = X0 + i * (s + w) + w, x1 = x0 + s, cx = (x0 + x1) / 2;
    const out = [[x1 + w * 0.5, ya]];
    if (kind === 'broken') {
      const n = 6;
      for (let k = 0; k <= n; k++) { const t = k / n; out.push([x1 + w * 0.5 - t * (s + w), ya + r + 0.15 + rng.range(0.1, 0.9) * o.attic * (k % 2 ? 0.6 : 1.1)]); }
    } else { out.push([x1 + w * 0.5, top]); out.push([x0 - w * 0.5, top]); }
    out.push([x0 - w * 0.5, ya]);
    for (let k = 0; k <= segN; k++) { const a = PI - (k / segN) * PI; out.push([cx + Math.cos(a) * r, ya + Math.sin(a) * r]); }
    mb.push(); mb.translate(0, 0, -d / 2);
    extrudeOutline(mb, out, d, { aux, auxSide: [0.3, 0.6, 0, 3.05] });
    mb.pop();
    if (kind === 'full') {
      for (let k = 0; k < segN; k++) {        // archivolt
        const a0 = PI - (k / segN) * PI, a1 = PI - ((k + 1) / segN) * PI;
        const q = [[cx + Math.cos(a0) * r, ya + Math.sin(a0) * r], [cx + Math.cos(a1) * r, ya + Math.sin(a1) * r], [cx + Math.cos(a1) * (r + 0.42), ya + Math.sin(a1) * (r + 0.42)], [cx + Math.cos(a0) * (r + 0.42), ya + Math.sin(a0) * (r + 0.42)]];
        mw.push(); mw.translate(0, 0, d / 2 - 0.02);
        extrudeOutline(mw, q, 0.12, { aux: [0.1, 0.5, 0.3, 0] });
        mw.pop();
      }
      box(mw, [x0 - w * 0.5 - 0.1, top - 0.05, -d / 2 - 0.18], [x1 + w * 0.5 + 0.1, top + 0.42, d / 2 + 0.18], 0.03, [0.1, 0.8, 0.4, 0]); // cornice
      // parapet posts (balustrade stumps) on the cornice
      for (const px of [x0 - w * 0.25, cx, x1 + w * 0.25]) if (rng.random() < 0.6) box(mw, [px - 0.22, top + 0.42, -0.22], [px + 0.22, top + 0.42 + rng.range(0.4, 1.1), 0.22], 0.02, [0.1, 0.6, 0.3, 0]);
    }
  }
  // fallen voussoirs / blocks at the foot of the gaps
  for (let i = 0; i < nb; i++) {
    if (o.bays[i] === 'full' || o.bays[i] === 'none') continue;
    const k = o.bays[i] === 'gone' ? 4 : 2;
    for (let j = 0; j < k; j++) {
      const x = X0 + (i + rng.range(0.1, 0.9)) * (s + w) + w, z = rng.range(-1, 1.6) * d * 1.6;
      const sx = rng.range(0.6, 1.4), sy = rng.range(0.4, 0.8), sz = rng.range(0.5, 1.0);
      mb.push(); mb.translate(x, sy / 2 - 0.2, z); mb.rotateY(rng.range(0, PI)); mb.rotateZ(rng.range(-0.3, 0.3));
      box(mb, [-sx / 2, -sy / 2, -sz / 2], [sx / 2, sy / 2, sz / 2], 0.05, aux);
      mb.pop();
    }
  }
}

/** square banded tower (local, ground y = 0): plinth, string courses, dark arched windows, crown cornice */
export function towerInto(B, o) {
  const mb = B.marble, mw = B.marble, mi = B.mb.interior, mr = B.get('red');
  const w = o.w, h = o.h, hw = w / 2;
  const aux = [0.1, 0.3, 0.6, 3.05];
  box(mw, [-hw - 0.6, -1.5, -hw - 0.6], [hw + 0.6, 1.2, hw + 0.6], 0.04, [0.2, 0.5, 0.3, 0]);
  // thin red courses (refs 7, 8: white towers banded red), proud of the face
  for (let y = 2.6; y < h * (o.broken ? 0.8 : 0.95) - 0.6; y += 2.9) box(mr, [-hw - 0.05, y, -hw - 0.05], [hw + 0.05, y + 0.55, hw + 0.05], 0.02, [0.1, 0.4, 0.4, 0]);
  if (o.broken) {
    // ruined top: jagged corners of unequal height
    box(mb, [-hw, 1.2, -hw], [hw, h * 0.82, hw], 0.04, aux);
    for (const [sx, sz, k] of [[-1, -1, 1.0], [1, -1, 0.9], [1, 1, 0.97], [-1, 1, 0.86]]) {
      const x0 = sx < 0 ? -hw : 0, z0 = sz < 0 ? -hw : 0;
      box(mb, [x0, h * 0.82, z0], [x0 + hw, h * k, z0 + hw], 0.05, aux);
    }
  } else box(mb, [-hw, 1.2, -hw], [hw, h, hw], 0.04, aux);
  for (const y of [h * 0.36, h * 0.68]) box(mw, [-hw - 0.15, y, -hw - 0.15], [hw + 0.15, y + 0.45, hw + 0.15], 0.03, [0.1, 0.8, 0.3, 0]);
  for (let f = 0; f < 4; f++) {
    mi.push(); mi.rotateY((f * PI) / 2);
    for (const y of [h * 0.46, h * 0.74]) for (const x of [-w * 0.22, w * 0.22]) if (!o.broken || y < h * 0.7) box(mi, [x - 0.42, y, hw - 0.02], [x + 0.42, y + 2.0, hw + 0.01], 0, [0.9, 0, 0, 0]);
    mi.pop();
  }
  if (!o.broken) box(mw, [-hw - 0.4, h, -hw - 0.4], [hw + 0.4, h + 0.7, hw + 0.4], 0.04, [0.1, 0.8, 0.4, 0]);
}

/**
 * @param engine
 * @param {object} o { q (detail), map (surface map of the plateau, marine/scatter.js surfaceMap) }
 * @returns {{group: THREE.Group, stats: object}}
 */
export function buildPrecinct(engine, { q = 1, map = null } = {}) {
  const group = new THREE.Group(); group.name = 'sets:precinct';
  const P = PRECINCT, Y0 = L.CITADEL.summit;
  const det = q >= 1 ? 0.55 : 0.4;
  const rng = new RNG('set9:precinct');
  const stats = { bays: 0, blocked: 0, towers: 0, tholoi: 0, stumps: 0, drums: 0, blocks: 0 };
  // free = the plateau paving is open there (nothing built within ±0.7 m above it)
  const free = (x, z) => {
    if (!map) return true;
    const s = map.sample(x, z);
    return !!s && s.y > Y0 - 1.2 && s.y < Y0 + 0.7;
  };
  const freeRect = (cx, cz, tx, tz, hw, hd) => {
    const nx = -tz, nz = tx;   // in-plane normal
    for (const a of [-1, -0.5, 0, 0.5, 1]) for (const b of [-1, 0, 1]) if (!free(cx + tx * a * hw + nx * b * hd, cz + tz * a * hw + nz * b * hd)) return false;
    return true;
  };
  const A = new Building('set9-arcade', { detail: det, seed: 91, variant: 'ruined', weather: 0.85 });
  const T = new Building('set9-towers', { detail: det, seed: 92, variant: 'ruined', weather: 0.85 });
  const tholoi = [];
  const yawAt = (b) => -b * D2R;
  const bayDeg = (P.pitch / P.r) / D2R;
  let runIdx = 0;
  for (const [b0, b1] of P.sectors) {
    // runs of 4-6 bays separated by towers (or a collapsed gap)
    let b = b0 + bayDeg * 0.5;
    while (b < b1 - bayDeg) {
      const n = Math.min(rng.int(4, 6), Math.floor((b1 - b) / bayDeg));
      if (n < 2) break;
      const bc = b + (n * bayDeg) / 2;
      const [cx, cz] = L.polar(P.r, bc % 360);
      const tx = Math.cos(bc * D2R), tz = Math.sin(bc * D2R);
      const bays = [];
      for (let i = 0; i < n; i++) {
        const bi = b + (i + 0.5) * bayDeg;
        const [x, z] = L.polar(P.r, bi % 360);
        const ok = freeRect(x, z, Math.cos(bi * D2R), Math.sin(bi * D2R), P.pitch * 0.55, P.depth * 0.9);
        if (!ok) { bays.push('none'); stats.blocked++; continue; }
        const r0 = rng.random();
        bays.push(r0 < 0.5 ? 'full' : r0 < 0.78 ? 'broken' : 'gone');
        stats.bays++;
      }
      if (bays.some((k) => k !== 'none')) {
        for (const k of ['banded', 'marble']) { const m = A.get(k); m.push(); m.translate(cx, Y0, cz); m.rotateY(yawAt(bc)); }
        arcadeRun(A, { ...P, bays }, rng, runIdx % 3 === 1 ? 'banded' : 'marble');
        for (const k of ['banded', 'marble']) A.get(k).pop();
      }
      runIdx++;
      b += n * bayDeg;
      // a tower at the junction (every run), set slightly outward of the arcade line
      const [x, z] = L.polar(P.r + 0.8, b % 360);
      const w = rng.range(5.2, 6.4), h = rng.range(12, 21);
      if (b < b1 - 1 && freeRect(x, z, Math.cos(b * D2R), Math.sin(b * D2R), w * 0.7, w * 0.7)) {
        const broken = rng.random() < 0.25;
        for (const k of ['red', 'marble', 'interior']) { const m = T.get(k); m.push(); m.translate(x, Y0, z); m.rotateY(yawAt(b)); }
        towerInto(T, { w, h, broken });
        for (const k of ['red', 'marble', 'interior']) T.get(k).pop();
        stats.towers++;
        if (!broken) tholoi.push({ x, z, y: Y0 + h + 0.7, r: w * 0.44, yaw: yawAt(b), lean: rng.range(-0.06, 0.06), seed: 93 + stats.towers });
        b += (w + 1.2) / P.r / D2R;
      } else b += bayDeg * 0.6;
    }
  }
  // inner ring of broken columns (a ruined stoa), some fallen drums, rubble
  const stumpG = [0.25, 0.45, 0.7].map((k, i) => brokenColumnGeometry({ order: 'ionic', height: 8.5, diameter: 1.05, breakAt: k, seed: 31 + i, chips: 0.7, detail: 0.3 }));
  const drumG = [drumGeometry({ order: 'ionic', diameter: 1.05, height: 1.1, seed: 41, chips: 0.6, detail: 0.25, broken: true }), drumGeometry({ order: 'ionic', diameter: 1.05, height: 1.4, seed: 42, chips: 0.6, detail: 0.25 })];
  const blockG = [roughBlockGeometry({ size: [1.4, 0.7, 0.9], seed: 51, detail: det }), roughBlockGeometry({ size: [1.0, 0.55, 1.1], seed: 52, detail: det, broken: { px: 0.2 } })];
  const S = new Building('set9-stumps', { detail: det, seed: 94, variant: 'ruined', weather: 0.9 });
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), Sc = new THREE.Vector3(1, 1, 1), Pp = new THREE.Vector3();
  const sDeg = (P.stumpPitch / P.stumpR) / D2R;
  for (const [b0, b1] of P.sectors) {
    for (let b = b0 + 2; b < b1 - 2; b += sDeg) {
      const [x, z] = L.polar(P.stumpR, b % 360);
      if (!free(x, z) || !free(x + 0.8, z) || !free(x - 0.8, z) || !free(x, z + 0.8) || !free(x, z - 0.8)) continue;
      const y = map ? map.sample(x, z).y : Y0;
      const r0 = rng.random();
      if (r0 < 0.62) {
        const k = rng.int(0, 2);
        E.set(rng.range(-0.04, 0.04), rng.range(0, 6.28), rng.range(-0.04, 0.04)); Q.setFromEuler(E);
        S.addInstance('stump' + k, stumpG[k], M.compose(Pp.set(x, y - 0.15, z), Q, Sc), 'marble'); stats.stumps++;
      }
      if (r0 > 0.45 && rng.random() < 0.7) {   // fallen drums rolled toward the centre / sideways
        const nd = rng.int(1, 3);
        for (let i = 0; i < nd; i++) {
          const a = rng.range(0, 6.28), dd = rng.range(1.5, 4.5);
          const dx = x + Math.cos(a) * dd, dz = z + Math.sin(a) * dd;
          if (!free(dx, dz)) continue;
          const yy = map ? map.sample(dx, dz).y : Y0;
          E.set(0, rng.range(0, 6.28), PI / 2 + rng.range(-0.08, 0.08), 'YXZ'); Q.setFromEuler(E);
          const k = rng.int(0, 1);
          S.addInstance('drum' + k, drumG[k], M.compose(Pp.set(dx, yy + 0.5, dz), Q, Sc), 'marble'); stats.drums++;
        }
      }
      if (rng.random() < 0.35) {
        const a = rng.range(0, 6.28), dd = rng.range(2, 6);
        const dx = x + Math.cos(a) * dd, dz = z + Math.sin(a) * dd;
        if (free(dx, dz)) {
          const yy = map ? map.sample(dx, dz).y : Y0;
          E.set(rng.range(-0.2, 0.2), rng.range(0, 6.28), rng.range(-0.2, 0.2)); Q.setFromEuler(E);
          const k = rng.int(0, 1), s = rng.range(0.7, 1.3);
          S.addInstance('block' + k, blockG[k], M.compose(Pp.set(dx, yy - 0.12, dz), Q, new THREE.Vector3(s, s, s)), 'marble'); stats.blocks++;
        }
      }
    }
  }
  group.add(A.finalize({ ao: false }));
  group.add(T.finalize({ ao: false }));
  group.add(S.finalize({ ao: false }));
  for (const t of tholoi) {
    const Bt = tholos({ radius: t.r, columns: 8, colH: 3.4, order: 'ionic', gild: 1, detail: det, seed: t.seed, name: 'set9-towerTholos', steps: 1, stepH: 0.3, tread: 0.3, foundation: 0.6 });
    const g = Bt.finalize({ position: [t.x, t.y + 0.3, t.z], rotY: t.yaw, ao: false });
    g.rotation.z = t.lean;
    group.add(g);
    stats.tholoi++;
  }
  group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  engine.registry.precinct = { ...PRECINCT, stats };
  return { group, stats };
}
