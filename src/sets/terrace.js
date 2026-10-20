// Shot 5 (golden, ref 5): the garden terrace — a bastion on top of the land-ring-1 inner wall
// (L.GARDEN_TERRACE.deck): polished red / white / black checker paving, a marble balustrade with gold
// medallions, gold urns and a navy trident panel running from the colonnade (left) to the bottom right, a small
// pavilion of red-and-white banded columns with gold Corinthian capitals on gilt-panelled pedestals (left edge,
// whole), a brazier pedestal (bottom left), gold lotus pots; slots for props (brazier, urns, lotus, bougainvillea)
// and vegetation (palms on the garden ledge below, the hero palm at the top right).
// r3: composed in the real shot-5 camera (frameFromShot(5)): local x = right, z = forward of the camera ground
// point, so the set follows the director's camera; the pieces were laid out against ref-5 pixels.
// Sunken: the same deck cracked, the pavilion toppled (drums on the deck), the balustrade broken.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { frameFromShot } from './frame.js';
import { cached } from '../core/materials.js';
import { whiteStone, checkerFloor, stoneMaterial } from '../materials/stone.js';
import { goldMaterial, giltMaterial } from '../materials/metal.js';
import { balustradeGeometry, pedestalGeometry } from '../arch/elements.js';
import { MeshBuilder, lathe, box } from '../arch/geom.js';
import { bandedShaftGeometry, capitalFor, buildColumn } from './columns.js';
import { bandedColumnMaterial } from './materials.js';
import { ruined } from '../world/era.js';

const DEG = Math.PI / 180;
// layout of the set in the camera frame (x right, z forward, metres); deck = L.GARDEN_TERRACE.deck
export const TERRACE = {
  eye: 2.2,
  bal: { a: [-2.75, 4.7], b: [2.3, 1.65], ext: [-0.3, 2.6], h: 0.98 },      // balustrade line (left end at the pavilion), extensions (m) past a / b
  pav: { cols: [[-2.75, 5.0], [-4.2, 5.1], [-2.85, 3.0], [-4.3, 3.1]], r: 0.27, ped: 1.0, shaft: 2.25 }, // pavilion columns (A front, B behind-left, C near, D out of frame)
  deckBack: [[-5.2, 5.9], [-9, 5.0]],
  // garden pier in water ring 1 at the foot of the bastion (y, radial width, half length along the wall); trees in the
  // camera frame [x right, z forward, 'p' palm | 'c' cypress, height m] — left and right groups, the centre left open
  garden: {
    y: 7, width: 21, half: 30,
    trees: [[-16, 21, 'p', 19], [-11.5, 17, 'p', 21], [-7.5, 19.5, 'c', 22], [-13.5, 13.5, 'c', 20], [-19, 15.5, 'p', 18], [-5.5, 14, 'p', 18.5], [-9, 10.5, 'c', 19],
      [9, 13, 'c', 22], [12.5, 16, 'c', 20], [15.5, 11, 'p', 19], [11, 9.5, 'c', 18], [18, 14, 'c', 21], [7, 17.5, 'p', 17]],
    bushes: [[-8, 12, 1.4], [-14, 17, 1.6], [-4, 16, 1.2], [10, 11, 1.3], [14, 14, 1.5], [2, 9, 1.0]],
  },   // deck outline beyond the pavilion (stays inside the bastion's front cornice)
  brazier: [-1.75, 2.3], brazierPed: 1.0,
  lotusBig: [1.45, 1.5], lotusPlinth: 0.42,
};

export function frame5() { return frameFromShot(5); }

/** TERRACE with the near-set positions pushed out by k (≥ 1; see buildTerrace) */
function scaledTerrace(k) {
  k = Math.min(2, Math.max(1, k || 1));
  if (k < 1.001) return TERRACE;
  const T = TERRACE, kp = 1, sc = (p, f) => [p[0] * f, p[1] * f];
  const c = T.pav.cols.reduce((s, q) => [s[0] + q[0] / 4, s[1] + q[1] / 4], [0, 0]);
  const cols = T.pav.cols.map((q) => [c[0] * kp + (q[0] - c[0]), c[1] * kp + (q[1] - c[1])]);
  return {
    ...T, k,
    // the balustrade's left end stays at the pavilion (A follows column A), the right end moves out by k
    bal: { ...T.bal, a: [cols[0][0] + T.bal.a[0] - T.pav.cols[0][0], cols[0][1] + T.bal.a[1] - T.pav.cols[0][1]], b: sc(T.bal.b, k), ext: [T.bal.ext[0], T.bal.ext[1] * k] },
    pav: { ...T.pav, cols },
    deckBack: T.deckBack.map((q) => sc(q, kp)),
    brazier: sc(T.brazier, k), lotusBig: sc(T.lotusBig, k),
  };
}

const mats = (sunken) => cached('sets:terraceMats:' + sunken, () => ({
  marble: whiteStone({ polish: sunken ? 0.05 : 0.6, rough: sunken ? 0.7 : 0.36, weather: sunken ? 0.8 : 0.1, veins: 1.0, seed: 1.7 }),
  gold: goldMaterial(sunken ? { wear: 0.6 } : {}),
  gilt: giltMaterial({}),
}));

export async function buildTerrace(engine, o = {}) {
  const sunken = !!o.sunken, q = o.q ?? 1;
  const F = o.frame || frame5();
  const deckY = o.deckY ?? (L.GARDEN_TERRACE.deck ?? F.pos.y - TERRACE.eye);
  // r4 (director): the set was laid out for an eye 2.2 m above the deck; when the shot-5 eye is higher, the near pieces
  // (balustrade, brazier, lotus pot) move out by k = eye / 2.2 so they keep their reference pixels at 1/k the size (ref 5
  // reads them ≈ 1.5-2x smaller); the pavilion stays (its capitals must still leave the frame top).
  const T = scaledTerrace((F.pos.y - deckY) / TERRACE.eye);
  const M = mats(sunken);
  const group = new THREE.Group(); group.name = 'sets:terrace';
  const yaw = Math.atan2(F.fwd.x, F.fwd.z);         // world yaw of the frame's forward
  const W = (x, z, y = 0) => F.local(x, deckY + y, z);
  // mesh local frame: +x = frame right, -z = forward (rotation.y = yaw + PI maps local +x → right)
  const place = (mesh, x, y, z, rotY = 0) => { mesh.position.copy(W(x, z, y)); mesh.rotation.y = yaw + Math.PI + rotY; group.add(mesh); return mesh; };
  const coral = [];
  const A = new THREE.Vector2(...T.bal.a), B = new THREE.Vector2(...T.bal.b);
  const dirAB = B.clone().sub(A).normalize();
  const balRot = Math.atan2(dirAB.y, dirAB.x);       // angle of the balustrade in the (x, z) frame plane
  // a point on the balustrade line at parameter s (m from A toward B)
  const balAt = (s) => A.clone().addScaledVector(dirAB, s);
  const sA = -T.bal.ext[0], sB = A.distanceTo(B) + T.bal.ext[1];   // balustrade from A - ext0 … B + ext1
  // mesh-local rotation for a piece running along +x from A to B: frame (x, z) angle θ → mesh rotY = θ (mesh z = -frame z)
  const rotAlong = balRot;

  // ---------------------------------------------------------------- deck slab with checker paving (camera side of the balustrade)
  const nrm = new THREE.Vector2(-dirAB.y, dirAB.x);   // frame-plane normal of the balustrade pointing AWAY from the camera
  const nrmW = new THREE.Vector3().addScaledVector(F.right, nrm.x).addScaledVector(F.fwd, nrm.y);
  {
    const pa = balAt(sA - 0.6).addScaledVector(nrm, -0.17), pb = balAt(sB).addScaledVector(nrm, -0.17);
    const pts = [[-9, -3], [6, -3], [pb.x, pb.y], [pa.x, pa.y], ...T.deckBack];
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) shape.lineTo(p[0], p[1]);
    // shape (x, y) = frame (x right, z forward); rotateX(-90°) maps shape y → mesh -z (= forward after the yaw), extrusion → +y
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false }).rotateX(-Math.PI / 2);
    geo.translate(0, -0.3, 0);
    // checker square to the balustrade (ref 5: the slabs run along the balustrade, seen corner-on from the camera)
    const balW = new THREE.Vector3().addScaledVector(F.right, dirAB.x).addScaledVector(F.fwd, dirAB.y);
    const rot = -Math.atan2(balW.z, balW.x);
    const floor = checkerFloor({ cell: 0.78, pattern: 3, rotation: rot, polish: sunken ? 0.0 : 0.95, rough: sunken ? 0.7 : 0.1, weather: sunken ? 0.9 : 0.04, veins: 0.7 });
    const m = new THREE.Mesh(geo, floor); m.name = 'setTerraceDeck';
    m.position.copy(W(0, 0, 0.02)); m.rotation.y = yaw + Math.PI;
    group.add(m);
    if (sunken) coral.push({ pos: W(-1.5, 3.5, 0.05).toArray(), normal: [0, 1, 0], size: 0.6, tag: 'set5:deck' });
  }
  // plain paving + planting strip beyond the balustrade, out toward the bastion edge
  {
    const mb = new MeshBuilder();
    box(mb, [-0.3, -0.4, -1.6], [sB - sA + 0.3, -0.01, 0.0], 0.0, [0, 0, 0, 5.12]);
    const strip = new THREE.Mesh(mb.geometry(), stoneMaterial({ kind: 'limestone', weather: sunken ? 0.9 : 0.25, paving: 0.9 }));
    strip.name = 'setTerraceStrip';
    const p0 = balAt(sA);
    place(strip, p0.x, 0, p0.y, rotAlong);
    if (!sunken) {
      // bougainvillea / flowering shrubs in the strip behind the balustrade (ref 5: magenta above the rail on the left)
      for (const s of [0.4, 1.5]) { const p = balAt(sA + s).addScaledVector(nrm, 0.8); engine.slots.flowers.push({ pos: W(p.x, p.y, 0).toArray(), size: [0.6, 0.75], tag: 'bush set5' }); }
    }
  }

  // ---------------------------------------------------------------- balustrade (+ medallions, finials, urns, trident panel)
  const posts = [];
  {
    const len = sB - sA;
    const nSeg = Math.max(2, Math.round(len / 2.05));
    const p0 = balAt(sA);
    const H = T.bal.h;
    if (sunken) {
      // broken: two surviving runs + rubble gaps
      for (const [a, b] of [[0, 0.32], [0.55, 1.0]]) {
        const g = balustradeGeometry({ length: len * (b - a), height: H, depth: 0.36, spacing: 0.24, postEvery: 2.05, detail: q });
        const pa = balAt(sA + len * a);
        place(new THREE.Mesh(g, M.marble), pa.x, 0.02, pa.y, rotAlong);
      }
    } else {
      const g = balustradeGeometry({ length: len, height: H, depth: 0.36, spacing: 0.235, postEvery: len / nSeg, detail: q });
      const mesh = new THREE.Mesh(g, M.marble); mesh.name = 'setBalustrade';
      place(mesh, p0.x, 0.02, p0.y, rotAlong);
    }
    for (let i = 0; i <= nSeg; i++) {
      const p = balAt(sA + (len * i) / nSeg);
      posts.push(p);
      if (!sunken) {
        for (const side of [0, Math.PI]) place(new THREE.Mesh(medallionGeometry(0.12), M.gilt), p.x, H * 0.52, p.y, rotAlong + side).translateZ(0.212);
      } else coral.push({ pos: W(p.x, p.y, H + 0.1).toArray(), normal: [0, 1, 0], size: 0.25, tag: 'set5:post' });
    }
    if (!sunken) {
      // gold urns on alternate posts (ref 5), the lotus pot on the second post
      posts.forEach((p, i) => {
        if (i === 0) return;
        const top = W(p.x, p.y, H + 0.13);
        const far = Math.hypot(p.x, p.y) > 3.0;   // near the lens an urn would be a huge blob: finials there
        if (i === 1) engine.slots.urn.push({ pos: top.toArray(), size: 0.62, tag: 'gold lotus set5' });
        else if (far && i % 2 === 0) engine.slots.urn.push({ pos: top.toArray(), size: 0.5, tag: 'gold empty set5' });
        else place(new THREE.Mesh(finialGeometry(), M.gold), p.x, H + 0.12, p.y, 0);
      });
      // navy trident panel set into the run between two posts right of centre (ref 5)
      const k = Math.min(posts.length - 2, Math.max(1, Math.round(posts.length * 0.62)));
      const pm = posts[k].clone().add(posts[k + 1]).multiplyScalar(0.5);
      const pn = new THREE.Mesh(tridentPanelGeometry(Math.min(0.66, posts[k].distanceTo(posts[k + 1]) - 0.5), H), tridentPanelMaterial());
      place(pn, pm.x, 0.0, pm.y, rotAlong);
      const back = new THREE.Mesh(tridentPanelGeometry(Math.min(0.66, posts[k].distanceTo(posts[k + 1]) - 0.5), H), tridentPanelMaterial());
      place(back, pm.x, 0.0, pm.y, rotAlong + Math.PI);
      // bougainvillea spilling over the left run (ref 5: magenta over the rail between the pavilion and the lotus pot)
      const pl = balAt(sA + 1.2);
      const facing = ((Math.atan2(nrmW.x, -nrmW.z) / DEG) + 360) % 360;   // spilling away from the camera
      engine.slots.flowers.push({ pos: W(pl.x, pl.y, H + 0.1).toArray(), facing, size: [1.3, 0.7], tag: 'bougainvillea edge set5' });
    }
  }

  // ---------------------------------------------------------------- pavilion: banded columns on pedestals + entablature + roof
  const P = T.pav;
  const colR = P.r, pedH = P.ped, shaftH = P.shaft;
  const capG = capitalFor(colR * 0.92); capG.computeBoundingBox();
  const capH = capG.boundingBox.max.y;
  const pedW = colR * 2 * 1.45;
  for (let i = 0; i < P.cols.length; i++) {
    const [x, z] = P.cols[i];
    const ped = new THREE.Mesh(pedestalGeometry({ w: pedW, h: pedH, wreath: false, panel: true, detail: q }), M.marble); ped.name = 'setPedestal';
    place(ped, x, 0.0, z, 0);
    if (!sunken) for (const s of [0, 1, 2, 3]) place(new THREE.Mesh(medallionGeometry(0.15), M.gilt), x, pedH * 0.5, z, (s * Math.PI) / 2).translateZ(pedW / 2 + 0.014);
    const toppled = sunken && ruined('set5:col' + i, 0.75);
    if (!toppled) {
      place(new THREE.Mesh(baseGeometry(colR), M.gold), x, pedH, z, 0);
      const shaft = new THREE.Mesh(bandedShaftGeometry({ r: colR, h: sunken ? shaftH * 0.5 : shaftH, band: 0.62, redFrac: 0.7, phase: 0.18 + i * 0.21, taper: 0.08 }), bandedColumnMaterial(sunken));
      shaft.name = 'setPorticoColumn';
      place(shaft, x, pedH + 0.2, z, i);
      if (!sunken) place(new THREE.Mesh(capG, M.gold), x, pedH + 0.2 + shaftH, z, 0.3);
      if (!sunken && i === 1) engine.slots.flowers.push({ pos: W(x, z, pedH).toArray(), facing: 0, size: [colR + 0.1, 1.4], tag: 'climb set5', coverage: 0.25 });
    } else {
      const d3 = F.local(Math.cos(i * 2.1), 0, Math.sin(i * 2.1)).sub(F.local(0, 0, 0)).normalize();
      const b = W(x, z, 0.5 + colR);
      const col = await buildColumn({ base: b.clone().addScaledVector(d3, 0.6), axis: d3, r: colR, seed: 's5c' + i, pieces: [{ h: 1.0, breakBottom: 0.08 }, { h: 0.9, gap: 0.25, roll: 0.5 }, { h: 0.8, gap: 0.3, breakTop: 0.1 }], capital: i === 0 }, q, true);
      for (const m of col.meshes) group.add(m);
      coral.push({ pos: b.clone().setY(b.y + colR).toArray(), normal: [0, 1, 0], size: 0.4, tag: 'set5:drum' });
    }
  }
  if (!sunken) {
    // entablature ring over the four columns (architrave, gilt frieze, cornice), flat roof slab with a gilt acroterion
    const yTop = pedH + 0.2 + shaftH + capH * 0.96;
    const C = P.cols.map(([x, z]) => new THREE.Vector2(x, z));
    const edges = [[0, 1], [0, 2], [2, 3], [1, 3]];
    for (const [i, j] of edges) {
      const a = C[i], b = C[j], len = a.distanceTo(b) + 0.9, d = b.clone().sub(a).normalize(), rot = Math.atan2(d.y, d.x);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const mb = new MeshBuilder();
      box(mb, [-len / 2, 0, -0.3], [len / 2, 0.42, 0.3], 0.01, [0.1, 0.5, 0.3, 0]);              // architrave
      box(mb, [-len / 2 - 0.05, 0.42, -0.27], [len / 2 + 0.05, 0.86, 0.27], 0.01, [0.1, 0.3, 0.3, 0]); // frieze
      box(mb, [-len / 2 - 0.22, 0.86, -0.46], [len / 2 + 0.22, 1.06, 0.46], 0.02, [0.05, 0.8, 0.4, 0]); // cornice
      const ent = new THREE.Mesh(mb.geometry(), M.marble); ent.name = 'setEntablature';
      place(ent, mid.x, yTop, mid.y, rot);
      const fr = new MeshBuilder();
      box(fr, [-len / 2 + 0.05, 0.5, -0.282], [len / 2 - 0.05, 0.78, 0.282], 0.0, [0, 0, 0, 0]);   // gilt frieze band
      box(fr, [-len / 2 - 0.23, 0.82, -0.47], [len / 2 + 0.23, 0.86, 0.47], 0.0, [0, 0, 0, 0]);       // gilt fillet under the cornice
      place(new THREE.Mesh(fr.geometry(), M.gilt), mid.x, yTop, mid.y, rot);
    }
    const c = C.reduce((s, v) => s.add(v), new THREE.Vector2()).multiplyScalar(0.25);
    const rm = new MeshBuilder();
    box(rm, [-1.35, 0, -1.6], [1.35, 0.28, 1.6], 0.02, [0.1, 0.6, 0.3, 0]);
    box(rm, [-1.0, 0.28, -1.25], [1.0, 0.5, 1.25], 0.02, [0.1, 0.6, 0.3, 0]);
    place(new THREE.Mesh(rm.geometry(), M.marble), c.x, yTop + 1.06, c.y, Math.atan2(C[1].y - C[0].y, C[1].x - C[0].x));
  }

  // ---------------------------------------------------------------- brazier pedestal (left front) + props slots
  {
    const [x, z] = T.brazier, h = T.brazierPed;
    const ped = new THREE.Mesh(pedestalGeometry({ w: 0.72, h, wreath: false, panel: true, detail: q }), M.marble); ped.name = 'setBrazierPedestal';
    place(ped, x, 0.0, z, 0.35);
    if (!sunken) for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) place(new THREE.Mesh(medallionGeometry(0.13), M.gilt), x, h * 0.5, z, 0.35 + a).translateZ(0.374);
    const top = W(x, z, h);
    engine.slots.brazier.push({ pos: top.toArray(), facing: 0, size: 0.5, tag: sunken ? 'set5 ruin' : 'set5' });
  }
  if (!sunken) {
    // big gold lotus pot on the floor, bottom right (ref 5)
    const [lx, lz] = T.lotusBig;
    // on a low marble plinth so the gold rim shows at the bottom right of the frame (ref 5: rim at row ≈ 880)
    const pl = new THREE.Mesh(pedestalGeometry({ w: 1.05, h: T.lotusPlinth, wreath: false, plinth: false, detail: q }), M.marble); pl.name = 'setLotusPlinth';
    place(pl, lx, 0.0, lz, 0.4);
    engine.slots.urn.push({ pos: W(lx, lz, T.lotusPlinth).toArray(), size: 1.25, tag: 'gold lotus wide set5' });
    // bougainvillea mounds around the pavilion bases (ref 5: magenta masses left of the brazier and behind the columns)
    for (const [x, z, r] of [[-3.6, 4.2, 0.6], [-3.9, 6.0, 0.7], [-2.6, 1.4, 0.5]]) engine.slots.flowers.push({ pos: W(x, z, 0).toArray(), size: [r, r * 1.4], tag: 'bush set5' });
  }

  // ---------------------------------------------------------------- garden pier below the bastion (ref 5: palm and cypress
  // tops rising above the balustrade on the left and right, the water with the ships open in the middle)
  {
    const G = L.GARDEN_TERRACE, ring = L.ringById(G.ring || 'l1');
    const ledgeY = T.garden.y, r0 = ring.r0 - 1.0, r1 = ring.r0 - T.garden.width;
    const [cx, cz] = L.polar((r0 + r1) / 2, G.bearing);
    const out = new THREE.Vector3(Math.sin(G.bearing * DEG), 0, -Math.cos(G.bearing * DEG)); // outward from the city centre
    const hw = (r0 - r1) / 2, half = T.garden.half;
    const mb = new MeshBuilder();
    box(mb, [-half, -ledgeY - 1.5, -hw], [half, 0, hw], 0.03, [0.1, 0.4, 0.4, 3.06]);                 // ashlar pier
    box(mb, [-half - 0.25, -0.35, -hw - 0.25], [half + 0.25, 0.05, hw - 0.3], 0.03, [0.05, 0.8, 0.3, 0]); // coping on the water sides
    const ledge = new THREE.Mesh(mb.geometry(), stoneMaterial({ kind: 'limestone', courses: 0.6, weather: sunken ? 0.9 : 0.3 }));
    ledge.name = 'setGardenPier';
    ledge.position.set(cx, ledgeY, cz); ledge.rotation.y = Math.atan2(out.x, out.z);
    group.add(ledge);
    if (!sunken) {
      const inside = (x, z) => { const r = Math.hypot(x, z); const b = L.bearingOf(x, z); return r > r1 + 1.5 && r < r0 - 1.0 && Math.abs(((b - G.bearing + 540) % 360) - 180) * DEG * r < half - 1.5; };
      let k = 0;
      for (const [fx, fz, kind, size] of T.garden.trees) {
        const p = W(fx, fz, 0);
        if (!inside(p.x, p.z)) continue;
        engine.slots.palm.push({ pos: [p.x, ledgeY, p.z], facing: (k * 67) % 360, size, tag: kind === 'c' ? 'cypress set5' : 'date set5' });
        k++;
      }
      for (const [fx, fz, r] of T.garden.bushes) { const p = W(fx, fz, 0); if (inside(p.x, p.z)) engine.slots.flowers.push({ pos: [p.x, ledgeY, p.z], size: [r, r * 1.2], tag: 'bush set5' }); }
    }
  }

  for (const c of coral) engine.slots.coral.push(c);
  const bl = balAt(sA), br = balAt(sB);
  engine.registry.sets = { ...(engine.registry.sets || {}), terrace: { deckY, camera: F.shot(), balustrade: [W(bl.x, bl.y).toArray(), W(br.x, br.y).toArray()], pavilion: P.cols.map(([x, z]) => W(x, z).toArray()) } };
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
/** navy trident panel filling a balustrade bay (front face at +z, centred on x) */
function tridentPanelGeometry(w, H) {
  return memo('tpanel' + w.toFixed(2) + H, () => { const h = H * 0.62; const g = new THREE.PlaneGeometry(w, h); g.translate(0, H * 0.16 + 0.02 + h / 2, 0.185); return g; });
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
      c.fillRect(cx - 7, 70, 14, 160);
      c.fillRect(cx - 52, 108, 104, 12);
      for (const dx of [-46, 0, 46]) { c.fillRect(cx + dx - 6, 64, 12, 52); c.beginPath(); c.moveTo(cx + dx - 16, 70); c.lineTo(cx + dx, 40); c.lineTo(cx + dx + 16, 70); c.fill(); }
      c.beginPath(); c.arc(cx, 150, 34, Math.PI * 0.1, Math.PI * 0.9); c.lineWidth = 8; c.strokeStyle = '#d6ad55'; c.stroke();
      map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
    }
    const m = new THREE.MeshStandardMaterial({ map, color: 0xffffff, roughness: 0.35, metalness: 0.3 });
    m.userData.sunken = 'gold';
    return m;
  });
}

/** test views for ?test=sets&set=terrace: the terrace on the shot-5 camera (no world) */
export async function terraceTest(engine, o) {
  const F = frame5();
  const g = await buildTerrace(engine, { ...o, frame: F });
  engine.add(g);
  const { LOOKS } = await import('../world/looks.js');
  const look = LOOKS[5] || {};
  return { views: [{ ...look, ...F.shot() }, { ...look, pos: F.local(3, F.pos.y + 1.5, -4).toArray(), target: F.local(-3, F.pos.y - 1.5, 4).toArray(), fov: 60 }] };
}
