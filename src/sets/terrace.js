// Shot 5 (golden, ref 5): the garden terrace — a bastion on top of the land-ring-2 inner wall
// (L.GARDEN_TERRACE.deck): polished red / white / black checker paving, a marble balustrade with gold
// medallions, gold finials and a navy trident panel, a portico of red-and-white banded columns with gold
// Corinthian capitals on marble pedestals and an entablature overhead, a brazier pedestal; slots for the
// brazier, gold lotus pots and bougainvillea (props) and palms on a garden ledge below (vegetation).
// Sunken: the same deck cracked, the portico toppled (drums on the deck), the balustrade broken.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { makeFrame, shotForward } from './frame.js';
import { cached } from '../core/materials.js';
import { whiteStone, checkerFloor, stoneMaterial } from '../materials/stone.js';
import { goldMaterial, giltMaterial } from '../materials/metal.js';
import { balustradeGeometry, pedestalGeometry } from '../arch/elements.js';
import { MeshBuilder, lathe, box } from '../arch/geom.js';
import { bandedShaftGeometry, capitalFor, axisMatrix, buildColumn } from './columns.js';
import { bandedColumnMaterial } from './materials.js';
import { ruined } from '../world/era.js';

const DEG = Math.PI / 180;
export const TERRACE = { eye: 2.2, pitch: -4, back: 4.0 };   // camera ground point: deck centre + 4 m outward   // camera ground point: deck centre + 3.2 m outward

export function frame5(o = {}) {
  const G = L.GARDEN_TERRACE;
  const deck = o.deck ?? G.deck ?? L.ringById(G.ring).top;
  const [x, z] = o.center || L.polar(G.r + TERRACE.back, G.bearing);
  return makeFrame({ camGround: [x, deck, z], fwd: o.fwd || shotForward(5), eye: TERRACE.eye, pitch: TERRACE.pitch, fov: 44 });
}

const mats = (sunken) => cached('sets:terraceMats:' + sunken, () => ({
  marble: whiteStone({ polish: sunken ? 0.05 : 0.6, rough: sunken ? 0.7 : 0.38, weather: sunken ? 0.8 : 0.12, veins: 1.0, seed: 1.7 }),
  gold: goldMaterial(sunken ? { wear: 0.6 } : {}),
  gilt: giltMaterial({}),
  navy: stoneMaterial({ kind: 'black', colors: { c0: '#1b2a5c' }, polish: 0.5 }),
}));

/** balustrade line (frame-local x, z): runs diagonally, nearer on the right (ref 5) */
const balZ = (x) => 8.4 - 0.5 * x;

export async function buildTerrace(engine, o = {}) {
  const sunken = !!o.sunken, q = o.q ?? 1;
  const F = o.frame || frame5();
  const deckY = F.pos.y - TERRACE.eye;
  const M = mats(sunken);
  const group = new THREE.Group(); group.name = 'sets:terrace';
  const yaw = Math.atan2(F.fwd.x, F.fwd.z);         // local +z = forward
  const toW = (x, y, z) => F.local(x, y, z);
  const place = (mesh, x, y, z, rotY = 0) => { const p = toW(x, 0, z); mesh.position.set(p.x, deckY + y, p.z); mesh.rotation.y = yaw + Math.PI + rotY; group.add(mesh); return mesh; };
  // mesh frame: +x = frame right, +z = toward the camera (frame z = -mesh z)
  const coral = [];

  // ---------------------------------------------------------------- deck slab with checker paving
  {
    const shape = new THREE.Shape();
    const pts = [[-14, -7], [12, -7], [12, balZ(12) - 0.15], [-14, balZ(-14) - 0.15]];
    shape.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) shape.lineTo(p[0], p[1]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false }).rotateX(-Math.PI / 2); // top at y = 0.5
    geo.translate(0, -0.5, 0);
    // balustrade direction in world → checker rotation (diagonal pattern on the slab axes)
    const balDir = toW(1, 0, balZ(1)).sub(toW(0, 0, balZ(0))).normalize();
    const rot = -Math.atan2(balDir.z, balDir.x);
    const floor = checkerFloor({ cell: 0.85, pattern: 3, rotation: rot, polish: sunken ? 0.0 : 0.92, rough: sunken ? 0.7 : 0.12, weather: sunken ? 0.9 : 0.05, veins: 0.6 });
    const m = new THREE.Mesh(geo, floor); m.name = 'setTerraceDeck';
    m.position.copy(toW(0, 0, 0)).setY(deckY + 0.02); m.rotation.y = yaw + Math.PI; group.add(m);
    if (sunken) coral.push({ pos: toW(-3, 0, 4).setY(deckY + 0.05).toArray(), normal: [0, 1, 0], size: 0.6, tag: 'set5:deck' });
  }

  // ---------------------------------------------------------------- balustrade (+ medallions, finials, trident panel)
  {
    const segs = [[-14, 2.1], [2.1, 12]];
    for (const [xa, xb] of segs) {
      const A = new THREE.Vector3(xa, 0, balZ(xa)), B = new THREE.Vector3(xb, 0, balZ(xb));
      const len = A.distanceTo(B);
      const rot = Math.atan2(B.z - A.z, B.x - A.x);
      const bal = balustradeGeometry({ length: len, height: 1.02, depth: 0.38, spacing: 0.25, postEvery: 2.2, detail: q });
      if (sunken && xa < 0) {
        // broken: keep the posts but lose a run of balusters — use a shorter piece + rubble
        const part = balustradeGeometry({ length: len * 0.45, height: 1.12, depth: 0.42, spacing: 0.27, postEvery: 2.4, detail: q });
        place(new THREE.Mesh(part, M.marble), xa, 0.02, A.z, rot);
        continue;
      }
      const mesh = new THREE.Mesh(bal, M.marble); mesh.name = 'setBalustrade';
      place(mesh, xa, 0.02, A.z, rot);
      // posts: gold medallion on the outer and inner faces, a gold finial on top (golden)
      const nSeg = Math.max(1, Math.round(len / 2.2));
      for (let i = 0; i <= nSeg; i++) {
        const t = i / nSeg;
        const p = A.clone().lerp(B, t);
        if (!sunken) {
          for (const side of [0, Math.PI]) place(new THREE.Mesh(medallionGeometry(0.14), M.gilt), p.x, 0.56, p.z, rot + side).translateZ(0.222);
          if (i % 2 === 0) place(new THREE.Mesh(finialGeometry(), M.gold), p.x, 1.14, p.z, 0);
        }
        if (sunken) coral.push({ pos: toW(p.x, 0, p.z).setY(deckY + 1.25).toArray(), normal: [0, 1, 0], size: 0.25, tag: 'set5:post' });
      }
    }
    // navy trident panel set into the right balustrade (inside the baluster run)
    if (!sunken) {
      const x = 4.3, z = balZ(x);
      const p = new THREE.Mesh(tridentPanelGeometry(), tridentPanelMaterial());
      place(p, x, 0.2, z, Math.atan2(-0.6, 1));
    }
  }

  // ---------------------------------------------------------------- portico: banded columns on pedestals + entablature
  const COLS = [[-4.4, 7.4], [-5.4, 10.9], [-7.4, 13.6]];
  const colR = 0.5, pedH = 1.45, shaftH = 6.8;
  const capH = 0.95 * colR * 2 / 0.84 * 1.15;   // ≈ Corinthian capital height (1.15 D)
  for (let i = 0; i < COLS.length; i++) {
    const [x, z] = COLS[i];
    const ped = new THREE.Mesh(pedestalGeometry({ w: colR * 2.7, h: pedH }), M.marble); ped.name = 'setPedestal';
    place(ped, x, 0.02, z, 0);
    if (!sunken) for (const s of [0, 1, 2, 3]) {
      const med = new THREE.Mesh(medallionGeometry(0.24), M.gilt);
      const a = s * Math.PI / 2;
      place(med, x + Math.sin(a + yaw * 0) * 0, pedH * 0.52, z, a).translateZ(colR * 1.35 + 0.005);
    }
    const toppled = sunken && ruined('set5:col' + i, 0.8);
    if (!toppled) {
      // gold base torus + banded shaft + gold capital
      const base = new THREE.Mesh(baseGeometry(colR), M.gold); place(base, x, pedH + 0.02, z, 0);
      const shaft = new THREE.Mesh(bandedShaftGeometry({ r: colR, h: sunken ? shaftH * 0.45 : shaftH, band: 1.55, redFrac: 0.72, phase: 0.35 + i * 0.4, taper: 0.1 }), bandedColumnMaterial(sunken));
      shaft.name = 'setPorticoColumn';
      place(shaft, x, pedH + 0.2, z, i);
      if (!sunken) { const cap = new THREE.Mesh(capitalFor(colR * 0.9), M.gold); place(cap, x, pedH + 0.2 + shaftH, z, 0.3); }
      // bougainvillea climbing the shaft (props)
      if (!sunken && i === 1) engine.slots.flowers.push({ pos: toW(x, 0, z).setY(deckY + pedH).toArray(), facing: 0, size: [colR + 0.1, 2.4], tag: 'climb set5', coverage: 0.35 });
    } else {
      // fallen drums across the deck
      const dir = F.camVec(Math.cos(i * 2.1), 0, Math.sin(i * 2.1)).setY(0).normalize();
      const b = toW(x, 0, z).setY(deckY + 0.5 + colR);
      const col = await buildColumn({ base: b.clone().addScaledVector(dir, 0.6), axis: dir, r: colR, seed: 's5c' + i, pieces: [{ h: 1.6, breakBottom: 0.1 }, { h: 1.5, gap: 0.3, roll: 0.5 }, { h: 1.4, gap: 0.4, breakTop: 0.12 }], capital: i === 0 }, q, true);
      for (const m of col.meshes) group.add(m);
      coral.push({ pos: b.clone().setY(b.y + colR).toArray(), normal: [0, 1, 0], size: 0.5, tag: 'set5:drum' });
    }
  }
  if (!sunken) {
    // entablature over the portico (architrave + gilt frieze + cornice) and the coffered ceiling slab overhead
    const yTop = pedH + 0.2 + shaftH + capH * 0.98;
    const [xa, za] = COLS[0], [xb, zb] = COLS[2];
    const A = new THREE.Vector3(xa, 0, za - 3), B = new THREE.Vector3(xb, 0, zb + 2);
    const len = A.distanceTo(B), rot = Math.atan2(B.z - A.z, B.x - A.x);
    const mb = new MeshBuilder();
    box(mb, [0, 0, -0.55], [len, 0.75, 0.55], 0.01, [0.1, 0.5, 0.3, 0]);           // architrave
    box(mb, [0, 0.75, -0.5], [len, 1.45, 0.5], 0.01, [0.1, 0.3, 0.3, 0]);          // frieze
    box(mb, [-0.1, 1.45, -0.75], [len + 0.1, 1.75, 0.75], 0.02, [0.05, 0.8, 0.4, 0]); // cornice
    const ent = new THREE.Mesh(mb.geometry(), M.marble); ent.name = 'setEntablature';
    place(ent, A.x, yTop, A.z, rot);
    const fr = new MeshBuilder(); box(fr, [0, 0.82, -0.505], [len, 1.38, 0.505], 0.0, [0, 0, 0, 0]);
    place(new THREE.Mesh(fr.geometry(), M.gilt), A.x, yTop, A.z, rot);
    // ceiling slab from the colonnade out over the camera's left
    const cm = new MeshBuilder(); box(cm, [-9, 0, -4], [0.6, 0.45, 9], 0.02, [0.1, 0.3, 0.2, 0]);
    place(new THREE.Mesh(cm.geometry(), M.marble), xa - 0.2, yTop + 1.3, za - 1, 0);
  }

  // ---------------------------------------------------------------- brazier pedestal (left front) + props slots
  {
    const x = -2.3, z = 3.7, h = 1.0;
    const ped = new THREE.Mesh(pedestalGeometry({ w: 1.1, h }), M.marble); ped.name = 'setBrazierPedestal';
    place(ped, x, 0.02, z, 0.2);
    if (!sunken) for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) place(new THREE.Mesh(medallionGeometry(0.17), M.gilt), x, h * 0.5, z, 0.2 + a).translateZ(0.551);
    const top = toW(x, 0, z).setY(deckY + 0.02 + h);
    if (!sunken) engine.slots.brazier.push({ pos: top.toArray(), facing: 0, size: 0.75, tag: 'set5' });
    else engine.slots.brazier.push({ pos: top.toArray(), facing: 0, size: 0.75, tag: 'set5 ruin' });
  }
  if (!sunken) {
    // gold lotus pots: on the left balustrade post and a big one on the floor, right foreground
    const p1 = toW(-1.3, 0, balZ(-1.3)).setY(deckY + 1.1);
    engine.slots.urn.push({ pos: p1.toArray(), size: 0.6, tag: 'gold lotus set5' });
    const p2 = toW(1.9, 0, 4.4).setY(deckY + 0.02);
    engine.slots.urn.push({ pos: p2.toArray(), size: 1.0, tag: 'gold lotus wide set5' });
    // bougainvillea mounds around the portico and spilling over the balustrade on the left
    for (const [x, z, r] of [[-3.6, 4.6, 0.9], [-4.4, 9.0, 1.1], [-3.0, 6.4, 0.7]]) engine.slots.flowers.push({ pos: toW(x, 0, z).setY(deckY).toArray(), size: [r, r * 1.3], tag: 'bush set5' });
    const outward = F.fwd.clone().multiplyScalar(1);
    const facing = ((Math.atan2(outward.x, -outward.z) / DEG) + 360) % 360;
    engine.slots.flowers.push({ pos: toW(-6, 0, balZ(-6)).setY(deckY + 1.12).toArray(), facing, size: [3.5, 1.6], tag: 'bougainvillea edge set5' });
  }

  // ---------------------------------------------------------------- garden ledge below the bastion (palms, cypress)
  {
    const G = L.GARDEN_TERRACE, l2 = L.ringById(G.ring || 'l2');
    const ledgeY = 3.5;               // planted quay-garden ledge at the foot of the wall, just above the water (palm crowns stay below the deck)
    const [cx, cz] = L.polar(l2.r0 - 4.5, G.bearing);
    const tang = new THREE.Vector3(Math.cos(G.bearing * DEG), 0, Math.sin(G.bearing * DEG));
    const out = new THREE.Vector3(Math.sin(G.bearing * DEG), 0, -Math.cos(G.bearing * DEG)); // outward from the city centre
    const mb = new MeshBuilder(); box(mb, [-30, -ledgeY - 1, -5], [30, 0, 4.5], 0.02, [0.1, 0.4, 0.4, 0]);
    const ledge = new THREE.Mesh(mb.geometry(), stoneMaterial({ kind: 'limestone', courses: 0.6, weather: sunken ? 0.9 : 0.3 }));
    ledge.name = 'setGardenLedge';
    ledge.position.set(cx, ledgeY, cz); ledge.rotation.y = Math.atan2(out.x, out.z);
    group.add(ledge);
    if (!sunken) {
      for (let i = 0; i < 9; i++) {
        const s = -24 + i * 6 + ((i * 37) % 5) - 2;
        const d = -2.5 + ((i * 53) % 4);
        const p = new THREE.Vector3(cx, ledgeY, cz).addScaledVector(tang, s).addScaledVector(out, d);
        engine.slots.palm.push({ pos: p.toArray(), facing: (i * 47) % 360, size: 9 + (i % 3) * 2.5, tag: i % 3 === 1 ? 'cypress set5' : 'date set5' });
      }
      engine.slots.flowers.push({ pos: new THREE.Vector3(cx, ledgeY, cz).addScaledVector(out, -4).toArray(), size: [2.4, 2.0], tag: 'bush set5' });
    }
  }

  // palms framing the right edge of the frame (ref 5 top right), standing on the deck behind the camera-right
  if (!sunken) engine.slots.palm.push({ pos: toW(7.5, 0, 1.0).setY(deckY).toArray(), facing: 300, size: 10, tag: 'date hero set5' });

  for (const c of coral) engine.slots.coral.push(c);
  engine.registry.sets = { ...(engine.registry.sets || {}), terrace: { deckY, camera: F.shot(), balustrade: [toW(-11, 0, balZ(-11)).toArray(), toW(10, 0, balZ(10)).toArray()] } };
  engine.footprints?.addCircle?.(...L.polar(L.GARDEN_TERRACE.r, L.GARDEN_TERRACE.bearing), 16, 'sets:terrace');
  return group;
}

// ------------------------------------------------------------------ small parts
const geoCache = new Map();
function memo(k, f) { if (!geoCache.has(k)) geoCache.set(k, f()); return geoCache.get(k); }
/** round gilt medallion (wheel rosette) facing +z, centred at the origin */
function medallionGeometry(r) {
  return memo('med' + r, () => {
    const mb = new MeshBuilder();
    mb.push(); mb.rotateX(Math.PI / 2);
    lathe(mb, [[0.0001, 0.03], [r * 0.25, 0.03], [r * 0.32, 0.018], [r * 0.7, 0.014], [r * 0.78, 0.024], [r * 0.95, 0.022], [r, 0.0], [r * 1.0, -0.005]], 24, {});
    mb.pop();
    // spokes
    for (let k = 0; k < 8; k++) { mb.push(); mb.rotateZ((k * Math.PI) / 4); box(mb, [-0.012, r * 0.28, 0], [0.012, r * 0.74, 0.022], 0.003); mb.pop(); }
    return mb.geometry();
  });
}
function finialGeometry() {
  return memo('fin', () => { const mb = new MeshBuilder(); lathe(mb, [[0.0001, 0], [0.11, 0], [0.12, 0.03], [0.06, 0.06], [0.07, 0.1], [0.13, 0.17], [0.14, 0.24], [0.1, 0.31], [0.05, 0.34], [0.07, 0.37], [0.03, 0.43], [0.0001, 0.46]], 20, {}); return mb.geometry(); });
}
function baseGeometry(r) {
  return memo('base' + r, () => { const mb = new MeshBuilder(); lathe(mb, [[0.0001, 0], [r * 1.25, 0], [r * 1.3, 0.05], [r * 1.25, 0.11], [r * 1.12, 0.13], [r * 1.08, 0.16], [r * 1.14, 0.2], [r * 1.02, 0.24], [r * 0.99, 0.26]], 40, {}); return mb.geometry(); });
}
function tridentPanelGeometry() {
  return memo('tpanel', () => { const g = new THREE.PlaneGeometry(0.62, 0.66); g.translate(0, 0.33, 0.215); return g; });
}
function tridentPanelMaterial() {
  return cached('sets:tpanel', () => {
    let map = null;
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 272;
      const c = cv.getContext('2d');
      c.fillStyle = '#c9a24e'; c.fillRect(0, 0, 256, 272);
      c.fillStyle = '#16245a'; c.fillRect(12, 12, 232, 248);
      c.strokeStyle = '#c9a24e'; c.lineWidth = 5; c.strokeRect(26, 26, 204, 220);
      c.fillStyle = '#d6ad55';
      const cx = 128;
      c.fillRect(cx - 7, 70, 14, 160);                 // shaft
      c.fillRect(cx - 52, 108, 104, 12);               // crossbar
      for (const dx of [-46, 0, 46]) { c.fillRect(cx + dx - 6, 64, 12, 52); c.beginPath(); c.moveTo(cx + dx - 16, 70); c.lineTo(cx + dx, 40); c.lineTo(cx + dx + 16, 70); c.fill(); }
      c.beginPath(); c.arc(cx, 150, 34, Math.PI * 0.1, Math.PI * 0.9); c.lineWidth = 8; c.strokeStyle = '#d6ad55'; c.stroke();
      map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
    }
    const m = new THREE.MeshStandardMaterial({ map, color: 0xffffff, roughness: 0.35, metalness: 0.3 });
    m.userData.sunken = 'gold';
    return m;
  });
}

/** test views for ?test=sets&set=terrace: the terrace on a flat deck at the layout height */
export async function terraceTest(engine, o) {
  const G = L.GARDEN_TERRACE;
  const F = frame5({ center: [0, 0], fwd: shotForward(5) });
  const g = await buildTerrace(engine, { ...o, frame: F });
  engine.add(g);
  // a big plane for the water ring level far below, so the view is not empty
  const { LOOKS } = await import('../world/looks.js');
  const look = LOOKS[5] || {};
  const s = F.shot();
  return { views: [{ ...look, ...s }, { ...look, pos: F.local(3, 3.5, -4).toArray(), target: F.local(-4, 2, 8).toArray(), fov: 50 }] };
}
