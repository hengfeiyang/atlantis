// Shots 3 / 6 (refs 3 and 6, bottom): the head of the north flight (L.STAIR_HEAD). The temple module builds the
// flight (34 m wide, cheek walls at x ±17.9). From the landing camera (eye 4 m above the landing) its cheeks are out of
// frame, so this set adds the ref-3 foreground: two short raking balustrades on the flight that frame the camera's
// lane (x = LANE[0] … LANE[1]) — tall piers with gilt relief panels and cornices (braziers on the first piers in frame,
// gold urns with bougainvillea on the others), a solid stepped wall with sunk relief panels, vase balusters and a
// raking rail between them, and bougainvillea spilling over the walls. Pier positions / heights were solved against
// the ref-3 pixels of the piers from the shot-3 camera (ships-sets r3). Sunken (ref 6): leaning / broken piers,
// missing balusters, coral slots on the copings and pier tops; the urns and braziers are toppled by props.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { cached } from '../core/materials.js';
import { whiteStone } from '../materials/stone.js';
import { giltMaterial, goldMaterial } from '../materials/metal.js';
import { MeshBuilder, box, lathe } from '../arch/geom.js';
import { ruined, ruinRand } from '../world/era.js';

export const STAIR_SET = {
  lines: [
    { x: 2.0, piers: [96.7, 91.0, 86.6, 82.3], side: -1 },           // left balustrade (ref 3: piers at px ≈ 55 / 395 / 530)
    { x: 13.5, piers: [96.7, 94.0, 90.3, 86.6, 82.9], side: 1 },     // right balustrade (ref 3: piers at px ≈ 1626 / 1420 / 1330)
  ],
  pierW: 1.15, pierH: 3.5,     // pier: width, height above the step at its centre
  wallH: 1.25, balH: 0.95,     // solid stepped wall, then balusters + rail on top (rail top ≈ 2.35 above the steps)
  endZ: 80.4,                  // the walls end here (a low terminal block below the last pier)
};

const mats = (sunken) => cached('sets:stairMats:' + sunken, () => ({
  marble: whiteStone({ polish: sunken ? 0.05 : 0.45, rough: sunken ? 0.75 : 0.42, weather: sunken ? 0.85 : 0.14, veins: 0.9, seed: 3.3 }),
  gilt: giltMaterial(sunken ? { wear: 0.8 } : {}),
  gold: goldMaterial(sunken ? { wear: 0.6 } : {}),
}));

/** flight surface height (top of the treads) at z, from L.STAIR_HEAD */
export function flightY(z) {
  const f = L.STAIR_HEAD.flight;
  const z0 = f.from[2], z1 = f.to[2], y0 = f.from[1], y1 = f.to[1];
  if (z >= z0) return y0;
  if (z <= z1) return y1;
  return y1 + ((z - z1) / (z0 - z1)) * (y0 - y1);
}

/** hero pier: plinth, die with raised panel frames on four faces, cornice; local y up from 0 to h, centred */
function pierGeometry(w, h) {
  const mb = new MeshBuilder();
  box(mb, [-w / 2 - 0.12, 0, -w / 2 - 0.12], [w / 2 + 0.12, 0.34, w / 2 + 0.12], 0.02, [0.2, 0.7, 0.2, 0]);
  box(mb, [-w / 2 - 0.06, 0.34, -w / 2 - 0.06], [w / 2 + 0.06, 0.46, w / 2 + 0.06], 0.03, [0.1, 0.8, 0.2, 0]);
  box(mb, [-w / 2, 0.46, -w / 2], [w / 2, h - 0.38, w / 2], 0.015, [0.05, 0.3, 0.5, 0]);
  const fw = w * 0.34, y0 = h * 0.42, y1 = h - 0.62;   // panel in the upper die (the lower part is behind the wall)
  for (let k = 0; k < 4; k++) {
    mb.push(); mb.rotateY((k * Math.PI) / 2);
    box(mb, [-fw - 0.06, y0 - 0.06, w / 2 - 0.01], [fw + 0.06, y0, w / 2 + 0.04], 0.01, [0.3, 0.8, 0.2, 0]);
    box(mb, [-fw - 0.06, y1, w / 2 - 0.01], [fw + 0.06, y1 + 0.06, w / 2 + 0.04], 0.01, [0.3, 0.8, 0.2, 0]);
    box(mb, [-fw - 0.06, y0, w / 2 - 0.01], [-fw, y1, w / 2 + 0.04], 0.01, [0.3, 0.8, 0.2, 0]);
    box(mb, [fw, y0, w / 2 - 0.01], [fw + 0.06, y1, w / 2 + 0.04], 0.01, [0.3, 0.8, 0.2, 0]);
    mb.pop();
  }
  box(mb, [-w / 2 - 0.08, h - 0.38, -w / 2 - 0.08], [w / 2 + 0.08, h - 0.26, w / 2 + 0.08], 0.02, [0.1, 0.8, 0.3, 0]);
  box(mb, [-w / 2 - 0.17, h - 0.26, -w / 2 - 0.17], [w / 2 + 0.17, h, w / 2 + 0.17], 0.025, [0.05, 0.9, 0.4, 0]);
  return mb.geometry();
}
/** gilt rosette + leafy scroll relief inside the upper panel, on the four faces */
function reliefGeometry(w, h) {
  const mb = new MeshBuilder();
  const cy = (h * 0.42 + h - 0.62) / 2, R = Math.min(w * 0.3, (h * 0.58 - 0.62) * 0.32);
  for (let f = 0; f < 4; f++) {
    mb.push(); mb.rotateY((f * Math.PI) / 2);
    mb.push(); mb.translate(0, cy, w / 2 + 0.005); mb.rotateX(Math.PI / 2);
    lathe(mb, [[0.0001, 0.05], [R * 0.25, 0.05], [R * 0.32, 0.03], [R * 0.75, 0.025], [R * 0.82, 0.04], [R * 0.94, 0.035], [R, 0.0]], 28, {});
    mb.pop();
    for (let k = 0; k < 10; k++) { mb.push(); mb.translate(0, cy, w / 2 + 0.005); mb.rotateZ((k * Math.PI) / 5); box(mb, [-0.02, R * 0.3, 0], [0.02, R * 0.75, 0.04], 0.008); mb.pop(); }
    for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
      const a = (k / 4) * Math.PI;
      mb.push(); mb.translate(Math.cos(a) * w * 0.2, cy + s * (R * 1.45 + 0.1 * Math.sin(a)), w / 2 + 0.005); box(mb, [-0.055, -0.022, 0], [0.055, 0.022, 0.03], 0.008); mb.pop();
    }
    mb.pop();
  }
  return mb.geometry();
}
let _bal = null;
/** vase baluster (local y from 0 to h) */
function baluster(h) {
  if (_bal && _bal.h === h) return _bal.g;
  const mb = new MeshBuilder();
  const r = h * 0.11, prof = [[r * 1.15, 0], [r * 1.15, h * 0.06], [r * 0.9, h * 0.08]];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, yy = h * (0.08 + 0.8 * t);
    prof.push([r * (0.55 + 0.55 * Math.exp(-(((t - 0.3) / 0.2) ** 2)) - 0.12 * Math.exp(-(((t - 0.62) / 0.06) ** 2)) + 0.18 * Math.exp(-(((t - 0.8) / 0.08) ** 2))), yy]);
  }
  prof.push([r * 0.9, h * 0.9], [r * 1.12, h * 0.92], [r * 1.12, h]);
  lathe(mb, prof, 10, {});
  _bal = { h, g: mb.geometry() };
  return _bal.g;
}

/** raking wall + balustrade along -z at x = X from z = za (upper) to z = zb (lower), on the flight surface */
function rakingRun(mb, mbG, X, za, zb, o, sunken, label) {
  const ya = flightY(za), yb = flightY(zb), len = za - zb;
  const slope = Math.atan2(ya - yb, len);
  const d = 0.62;   // wall thickness
  // solid wall: a sloped prism from below the treads up to wallH above them (built in a frame rotated about x)
  mb.push(); mb.translate(X, yb, zb); mb.rotateX(-slope);   // local +z runs up the slope toward za, local y ⟂ to it
  const sl = len / Math.cos(slope);
  box(mb, [-d / 2, -1.6, 0], [d / 2, o.wallH, sl], 0.02, [0.05, 0.6, 0.4, 0]);
  // coping of the wall (projecting), sunk relief panels on both faces (frames), rail on the balusters
  box(mb, [-d / 2 - 0.06, o.wallH, 0], [d / 2 + 0.06, o.wallH + 0.1, sl], 0.015, [0.05, 0.9, 0.3, 0]);
  const nP = Math.max(1, Math.round(sl / 1.9));
  for (let i = 0; i < nP; i++) {
    const s0 = (sl * i) / nP + 0.22, s1 = (sl * (i + 1)) / nP - 0.22;
    for (const sx of [-1, 1]) {
      const x0 = sx * (d / 2), x1 = sx * (d / 2 + 0.035);
      const [xa, xb] = sx < 0 ? [x1, x0] : [x0, x1];
      box(mb, [xa, 0.22, s0], [xb, 0.29, s1], 0.006, [0.3, 0.8, 0.2, 0]);
      box(mb, [xa, o.wallH - 0.25, s0], [xb, o.wallH - 0.18, s1], 0.006, [0.3, 0.8, 0.2, 0]);
      box(mb, [xa, 0.29, s0], [xb, o.wallH - 0.25, s0 + 0.07], 0.006, [0.3, 0.8, 0.2, 0]);
      box(mb, [xa, 0.29, s1 - 0.07], [xb, o.wallH - 0.25, s1], 0.006, [0.3, 0.8, 0.2, 0]);
      // gilt lozenge in the panel centre (golden)
      if (!sunken && mbG) { mbG.push(); mbG.translate(X, yb, zb); mbG.rotateX(-slope); mbG.translate(sx * (d / 2 + 0.02), (0.29 + o.wallH - 0.25) / 2, (s0 + s1) / 2); mbG.rotateX(Math.PI / 4); box(mbG, [-0.03, -0.13, -0.13], [0.03, 0.13, 0.13], 0.01); mbG.pop(); }
    }
  }
  const yRail = o.wallH + 0.1 + o.balH;
  box(mb, [-d / 2 + 0.05, yRail - 0.14, 0], [d / 2 - 0.05, yRail, sl], 0.02, [0.05, 0.8, 0.5, 0]);
  mb.pop();
  // vertical balusters on the coping, under the rail
  const bh = (o.balH - 0.14) / Math.cos(slope) + 0.03, g = baluster(Math.round(bh * 100) / 100), m = new THREE.Matrix4();
  const n = Math.floor(len / 0.3);
  for (let i = 1; i < n; i++) {
    const z = zb + (len * i) / n;
    if (sunken && ruined(`${label}:bal:${i}`, 0.35)) continue;
    const yC = yb + (z - zb) * Math.tan(slope) + (o.wallH + 0.1) / Math.cos(slope);
    m.makeTranslation(X, yC - 0.02, z);
    mb.merge(g, m);
  }
}

export async function buildStairTop(engine, o = {}) {
  const sunken = !!o.sunken;
  const M = mats(sunken);
  const S = STAIR_SET;
  const group = new THREE.Group(); group.name = 'sets:stairTop';
  const pierG = pierGeometry(S.pierW, S.pierH), relG = reliefGeometry(S.pierW, S.pierH);
  const coral = [];
  const wallB = new MeshBuilder(), giltB = new MeshBuilder();
  const piersOut = [];
  for (const line of S.lines) {
    const X = line.x, zs = line.piers;
    // runs between consecutive piers, then from the last pier to the end block
    const stops = [...zs, S.endZ];
    for (let i = 0; i < stops.length - 1; i++) {
      const za = stops[i] - S.pierW / 2 - 0.02, zb = stops[i + 1] + (i + 1 < zs.length ? S.pierW / 2 + 0.02 : 0);
      if (sunken && ruined(`set3:run:${X}:${i}`, 0.2)) {
        // a collapsed run: only the lower wall survives
        rakingRun(wallB, null, X, za, zb, { ...S, balH: 0.15 }, true, `set3:${X}:${i}`);
      } else rakingRun(wallB, giltB, X, za, zb, S, sunken, `set3:${X}:${i}`);
    }
    // terminal block at the foot of the run
    { const y = flightY(S.endZ); box(wallB, [X - 0.45, y - 1.2, S.endZ - 0.7], [X + 0.45, y + 0.9, S.endZ + 0.1], 0.02, [0.05, 0.7, 0.3, 0]); box(wallB, [X - 0.52, y + 0.9, S.endZ - 0.77], [X + 0.52, y + 1.02, S.endZ + 0.17], 0.02, [0.05, 0.9, 0.3, 0]); }
    zs.forEach((z, i) => {
      const y = flightY(z) - 0.12;
      const p = new THREE.Mesh(pierG, M.marble); p.name = 'setStairPier';
      p.position.set(X, y, z);
      const r = new THREE.Mesh(relG, M.gilt); r.name = 'setStairRelief';
      if (sunken) {
        const lean = ruined(`set3:pier:${X}:${i}`, 0.45) ? 0.04 + 0.05 * ruinRand(`set3:pier:${X}:${i}`, 1) : 0.01;
        p.rotation.set((ruinRand(`set3:p:${X}:${i}`, 2) - 0.5) * lean, 0, line.side * lean);
      }
      r.position.copy(p.position); r.rotation.copy(p.rotation);
      group.add(p, r);
      const top = [X, y + S.pierH, z];
      piersOut.push(top);
      // first two piers of each run that show in the frame: braziers (ref 3: fire on the left and right foreground piers)
      const brazier = (line.side < 0 && i === 1) || (line.side > 0 && i === 1);
      if (brazier) engine.slots.brazier.push({ pos: top, facing: 180, size: 1.0, tag: sunken ? 'set3 ruin' : 'set3' });
      else if (i > 0) engine.slots.urn.push({ pos: top, size: 0.95, facing: 180, tag: sunken ? 'gold set3' : 'gold bougainvillea set3' });
      if (!sunken) {
        // bougainvillea spilling over the wall from the lane-outer side, and bushes at the wall foot
        if (i > 0) engine.slots.flowers.push({ pos: [X + line.side * 0.4, flightY(z - 1.6) + S.wallH + 0.1, z - 1.6], facing: line.side < 0 ? 90 : 270, size: [1.6, 1.3], tag: 'bougainvillea edge set3' });
        if (i > 0) engine.slots.flowers.push({ pos: [X + line.side * 1.6, flightY(z - 0.6), z - 0.6], size: [0.9, 1.1], tag: 'bush set3' });
      } else {
        coral.push({ pos: top, normal: [0, 1, 0], size: 0.8, tag: 'set3:pier' });
        coral.push({ pos: [X - line.side * (S.pierW / 2 + 0.05), y + 1.0, z], normal: [-line.side, 0, 0], size: 0.45, tag: 'set3:pier' });
        coral.push({ pos: [X, flightY(z - 2) + S.wallH + 0.15, z - 2], normal: [0, 1, 0], size: 0.5, tag: 'set3:wall' });
      }
    });
  }
  const wall = new THREE.Mesh(wallB.geometry(), M.marble); wall.name = 'setStairWalls';
  group.add(wall);
  if (!giltB.empty) { const gm = new THREE.Mesh(giltB.geometry(), M.gilt); gm.name = 'setStairGilt'; group.add(gm); }
  // palms and cypress on the plaza sides (ref 3: palms beyond the fountains, cypress along the rim)
  if (!sunken) {
    const y0 = L.STAIR_HEAD.y;
    for (const s of [-1, 1]) {
      engine.slots.palm.push({ pos: [s * 41, y0, 95], facing: s > 0 ? 250 : 110, size: 11, tag: 'date set3' });
      engine.slots.palm.push({ pos: [s * 47, y0, 76], facing: s > 0 ? 260 : 100, size: 12.5, tag: 'date set3' });
      engine.slots.palm.push({ pos: [s * 31, y0, 103], facing: 180, size: 10, tag: 'cypress set3' });
      engine.slots.palm.push({ pos: [s * 35, y0, 100.5], facing: 180, size: 12, tag: 'cypress set3' });
    }
  }
  for (const c of coral) engine.slots.coral.push(c);
  for (const l of S.lines) engine.footprints?.addRect?.(l.x, (l.piers[0] + S.endZ) / 2, 0.9, (l.piers[0] - S.endZ) / 2 + 0.8, 0, 'sets:stairTop');
  engine.registry.sets = { ...(engine.registry.sets || {}), stairTop: { piers: piersOut, lines: S.lines.map((l) => l.x), height: S.pierH } };
  return group;
}

export async function stairTest(engine, o) {
  const g = await buildStairTop(engine, o);
  engine.add(g);
  const { SHOTS } = await import('../world/shots.js');
  const s3 = SHOTS.find((q) => q.id === 3);
  return { views: [{ pos: s3.pos, target: s3.target, fov: s3.fov }, { pos: [22, 82, 104], target: [6, 72, 86], fov: 50 }] };
}
