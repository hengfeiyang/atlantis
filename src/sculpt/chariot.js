// Poseidon's shell chariot, its wheels and the sculpted sea-wave base the winged horses rear from (ref 3).
// Units: METRES in the chariot-group frame: y = 0 is the pedestal top, +Z = front (toward the stair), x lateral.
//   chariotLayout()          → placements of the six horses, the car and Poseidon (shared by sculpt + module)
//   carSdf(), wheelSdf(), waveBaseSdf(layout)  → SDFs (+ gold masks)
import { sd, clamp, lerp, sstep, smin, smax, add, sub, scale, norm, len, mix3, cone, vnoise3, fbm3, hash1 } from './sdf.js';

/** where everything stands in the group (metres, pedestal-top frame) */
export function chariotLayout() {
  const horseScale = 3.75;
  // six horses abreast in a shallow arc, the outer ones turned outward (ref 3); variants cycle A/B/C mirrored
  const xs = [-12.2, -7.4, -2.5, 2.5, 7.4, 12.2];
  const horses = xs.map((x, i) => {
    const a = Math.abs(x) / 12.2;
    return {
      i, x, z: 1.4 - 1.8 * a * a, y: 0.75 + 0.25 * (1 - a),
      yaw: Math.sign(x) * (4 + 12 * a) * Math.PI / 180,
      variant: ['B', 'C', 'A', 'A', 'C', 'B'][i], mirror: x > 0, scale: horseScale * (1 - 0.02 * a),
    };
  });
  return {
    horses,
    car: { c: [0, 8.7, -5.4], floor: 9.0 },
    wheels: [{ c: [-4.3, 8.6, -5.2], R: 3.0 }, { c: [4.3, 8.6, -5.2], R: 3.0 }],
    poseidon: { pos: [0, 9.0, -5.6], scale: 7.8, yaw: 0 },
    // the whole group is sculpted in these 'design' metres and placed at groupScale (r1 director: the group must
    // read smaller than the temple front, ≈ 23 m wide on the 30 × 18 m pedestal)
    groupScale: 0.8,
    footprint: { w: 28.5, d: 16.5 },
  };
}

// ------------------------------------------------------------------ the car (scalloped shell body)
export function carSdf(C) {
  const c = C.c;
  const fl = C.floor;
  return (x, y, z) => {
    const px = x - c[0], py = y - fl, pz = z - c[2];
    if (Math.abs(px) > 4.6 || py < -1.2 || py > 5 || pz > 3.6 || pz < -3) return Math.max(Math.abs(px) - 4.4, Math.abs(pz - 0.3) - 3.2, Math.abs(py - 1.8) - 3.0);
    // plan: a rounded front (ellipse) over a straight back; walls rise higher at the front (prow)
    const rx = 3.7, rzF = 2.6;
    const dPlan = pz > 0 ? sd.ellipsoid(px, 0, pz, rx, 1, rzF) : Math.max(Math.abs(px) - rx, -pz - 2.2);
    const top = 3.0 + 0.9 * sstep(-0.5, 2.2, pz) * (1 - 0.35 * Math.abs(px) / rx) + 0.25 * Math.cos(px * 1.4); // rim height above the floor
    let d = smax(dPlan, Math.max(-py - 0.6, py - top), 0.25);       // solid body
    // shell flutes: radial ribs on the outer wall (scallop)
    const ang = Math.atan2(px, Math.max(pz, -0.5) + 1.2);
    const fl2 = Math.abs(Math.cos(ang * 7)) ;
    d -= 0.09 * Math.pow(fl2, 3) * sstep(-0.2, 0.6, py) * sstep(top + 0.1, top - 0.6, py);
    // rolled rim (lip) and a base moulding
    const rimD = Math.hypot(dPlan + 0.05, py - top + 0.05) - 0.2;
    d = smin(d, rimD, 0.1);
    d = smin(d, Math.hypot(dPlan - 0.08, py + 0.4) - 0.22, 0.12);
    // hollow interior (open behind and above): the god stands inside
    const inner = smax(dPlan + 0.28, -py - 0.1 + 0.2, 0.1);
    d = smax(d, -inner, 0.08);
    // prow volute at the front centre (a big curling wave / spiral)
    const vx = Math.abs(px), vy = py - top - 0.2, vz = pz - rzF + 0.15;
    if (vx < 0.9 && vy > -1.6 && vy < 1.6) {
      const rr = Math.hypot(vy, vz), aa = Math.atan2(vy, vz);
      let best = 1e9;
      for (let k = 0; k < 3; k++) {
        const th = ((aa + Math.PI * 2) % (Math.PI * 2)) + k * Math.PI * 2;
        const r0 = 0.95 * Math.exp(-0.16 * th);
        best = Math.min(best, Math.abs(rr - r0) - 0.17 * Math.exp(-0.12 * th));
      }
      const dv = Math.max(best, vx - 0.55 + 0.1 * Math.cos(vx * 3));
      d = smin(d, dv * 0.8, 0.08);
    }
    // fine relief noise (waves engraved on the panels)
    d -= 0.015 * Math.sin(px * 6 + Math.sin(py * 3) * 2) * sstep(0.3, 1.0, py) * sstep(top - 0.5, top - 1.2, py) * (pz > 0 ? 1 : 0.3);
    return d;
  };
}
export const carGold = (C) => (x, y, z) => (y > C.floor + 2.7 ? 1 : 0.85);

// ------------------------------------------------------------------ spoked wheel (axis along X)
export function wheelSdf(W) {
  const [cx, cy, cz] = W.c, R = W.R;
  return (x, y, z) => {
    const px = x - cx, py = y - cy, pz = z - cz;
    const r = Math.hypot(py, pz);
    if (Math.abs(px) > 0.9 || r > R + 0.4) return Math.max(Math.abs(px) - 0.7, r - R - 0.2);
    // felloe (rim) with a raised bead, iron tyre
    let d = Math.hypot(Math.max(Math.abs(r - R + 0.12) - 0.16, 0), Math.max(Math.abs(px) - 0.22, 0)) - 0.04;
    d = smin(d, Math.hypot(r - R + 0.12, Math.abs(px) - 0.24) - 0.07, 0.04);
    // hub (nave) + axle cap
    d = smin(d, sd.ellipsoid(px, py, pz, 0.62, 0.42, 0.42), 0.08);
    d = smin(d, sd.ellipsoid(px - Math.sign(px || 1) * 0.55, py, pz, 0.2, 0.25, 0.25), 0.05);
    // 10 turned spokes, thicker at the hub
    const a = Math.atan2(py, pz), n = 10;
    const as = Math.round(a / (Math.PI * 2 / n)) * (Math.PI * 2 / n);
    const dirY = Math.sin(as), dirZ = Math.cos(as);
    const along = py * dirY + pz * dirZ, across = Math.abs(-py * dirZ + pz * dirY);
    const t = clamp(along / (R - 0.2), 0, 1);
    const sr = lerp(0.13, 0.075, t) + 0.025 * Math.exp(-(((t - 0.55) / 0.06) ** 2));
    d = smin(d, Math.max(Math.hypot(across, px) - sr, -along, along - R + 0.15), 0.06);
    return d;
  };
}

// ------------------------------------------------------------------ the sea-wave base
/** curling wave (volute) whose tube follows a logarithmic spiral in the (z, y) plane, extruded along `axis` */
function curl(p, c, axisAng, len2, R0, tube, dir = 1) {
  // local frame: u along the crest (axis), v forward (curl direction), w up
  const ca = Math.cos(axisAng), sa = Math.sin(axisAng);
  const qx = p[0] - c[0], qy = p[1] - c[1], qz = p[2] - c[2];
  const u = qx * ca - qz * sa, v = (qx * sa + qz * ca) * dir, w = qy;
  const rr = Math.hypot(v, w);
  if (Math.abs(u) > len2 + R0 || rr > R0 * 1.7) return Math.max(Math.abs(u) - len2 - tube, rr - R0 * 1.35);
  const aa = Math.atan2(-v, w); // spiral turning forward over the top, inward
  // the crest swells in the middle and tapers to rounded ends (no flat cut)
  const tu = clamp(Math.abs(u) / len2, 0, 1);
  const taper = Math.sqrt(Math.max(0, 1 - tu * tu));
  let best = 1e9;
  for (let k = 0; k < 3; k++) {
    const th = ((aa + Math.PI * 2) % (Math.PI * 2)) + k * Math.PI * 2;
    if (th > 3.4 * Math.PI) break;
    const r0 = R0 * (0.75 + 0.25 * taper) * Math.exp(-0.17 * th);
    const tr = tube * Math.exp(-0.13 * th) * (0.25 + 0.75 * taper);
    best = Math.min(best, Math.hypot(rr - r0, Math.max(0, Math.abs(u) - len2)) - tr);
  }
  return best * 0.85;
}

export function waveBaseSdf(LAY) {
  const W = LAY.footprint.w / 2 - 0.4, D = LAY.footprint.d / 2 - 0.4;
  // broad swells: a ridge of breaking waves behind the horses and a big swell carrying the car
  const swells = [{ x: 0, z: -4.6, rx: 6.0, rz: 3.9, h: 7.6 }];
  for (let i = 0; i < 7; i++) swells.push({ x: -W + 2 + (i / 6) * (2 * W - 4) + 0.8 * Math.sin(i * 3.1), z: -1.2 + 1.6 * hash1(i * 2.7), rx: 2.4, rz: 2.2, h: 1.3 + 0.8 * hash1(i * 6.1) });
  const height = (x, z) => {
    let h = 0.35 + 0.5 * sstep(D, -2, z);
    for (const S of swells) h += S.h * Math.exp(-(((x - S.x) / S.rx) ** 2) - (((z - S.z) / S.rz) ** 2));
    h += 0.4 * Math.sin(x * 0.75 + z * 0.4) * Math.sin(z * 0.9 - x * 0.3) + 0.25 * fbm3(x * 0.3, 0.0, z * 0.3, 2);
    return h;
  };
  // curling crests (volutes) of varied size/direction, sitting on the swell surface
  const curls = [];
  const R = (i, k) => hash1(i * 7.31 + k * 1.93);
  for (let i = 0; i < 24; i++) {
    const front = i < 12;
    const x = front ? -W + 1.0 + (i / 11) * (2 * W - 2.0) + 0.6 * (R(i, 1) - 0.5) : -W + 2.0 + ((i - 12) / 11) * (2 * W - 4) + 0.8 * (R(i, 1) - 0.5);
    const z = front ? D - 1.0 - 0.9 * R(i, 2) : -0.8 + 2.4 * R(i, 2);
    const R0 = front ? 0.8 + 0.45 * R(i, 3) : 0.9 + 0.6 * R(i, 3);
    const y = height(x, z) + R0 * 0.25;
    // front row: scrolls facing the viewer (crest axis front-back, alternating hand); behind: random crests
    const ang = front ? Math.PI / 2 + (R(i, 4) - 0.5) * 0.6 : Math.PI / 2 + (R(i, 4) - 0.5) * 1.2;
    curls.push({ c: [x, y + R0 * 0.2, z], ang, len: 0.9 + 0.9 * R(i, 5), R0: R0 * 1.15, tube: R0 * 0.27, dir: i % 2 ? 1 : -1 });
  }
  for (const s of [-1, 1]) curls.push({ c: [s * 3.4, height(s * 3.4, -2.2) + 0.2, -2.2], ang: Math.PI / 2 + s * 0.3, len: 2.2, R0: 1.7, tube: 0.42, dir: s });
  return (x, y, z) => {
    if (y > 11.5 || Math.abs(x) > W + 1 || Math.abs(z) > D + 1) return Math.max(y - 11, Math.abs(x) - W, Math.abs(z) - D);
    const box = sd.roundBox(x, 0, z, W, 50, D, 1.2);
    let d = Math.max((y - height(x, z)) * 0.55, box, -y - 0.01);
    for (const C of curls) {
      const dc = curl([x, y, z], C.c, C.ang, C.len, C.R0, C.tube, C.dir);
      if (dc < 1.5) d = smin(d, dc, 0.3);
    }
    // foam: bubbly crests + churned surface
    d -= 0.035 * vnoise3(x * 1.3, y * 1.3, z * 1.3) + 0.012 * vnoise3(x * 4, y * 4, z * 4);
    return d;
  };
}
