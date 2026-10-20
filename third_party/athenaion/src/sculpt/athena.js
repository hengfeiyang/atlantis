// Athena Parthenos-style colossus: figure (peplos, aegis, pushed-up Corinthian helmet with a tall
// sweeping crest), spear, shield. Everything in NOMINAL figure units (2.0 m figure, sole y=0,
// facing +Z, right side = -X).
import { sd, clamp, lerp, sstep, smin, smax, add, sub, scale, norm, len, mix3, mv, mT, dot, cross, cone, capsule, ellipse2, vnoise3, hash1, fbm3 } from './sdf.js';
import { makeFigure } from './figure.js';

// ------------------------------------------------------------------ helmet (head units)
/**
 * Corinthian helmet pushed up onto the crown (face plate with eye holes above the forehead,
 * cheek pieces over the temples, flared neck guard) with a tall horsehair crest on a holder.
 * o: { crest: height factor (0 = none), pitch: tilt back (rad, negative), lift:[x,y,z] head units,
 *      gilt: metal mask of the bowl (0 = marble, 0.6 dark bronze, 1 gold), giltCrest }
 */
export function helmet(o = {}) {
  const crestH = o.crest ?? 1.0;
  const pitch = o.pitch ?? -0.75;
  const lift = o.lift ?? [0, 0.43, 0.06];
  const S = o.scale ?? 0.84;
  const c = Math.cos(pitch), s = Math.sin(pitch);
  // head frame → helmet ("worn") frame
  const toH = (x, y, z) => { const yy = (y - lift[1]) / S, zz = (z - lift[2]) / S; return [(x - lift[0]) / S, c * yy + s * zz, -s * yy + c * zz]; };

  const BC = [0, 0.04, -0.04], BR = [0.39, 0.46, 0.47];
  const bowl = (x, y, z) => sd.ellipsoid(x - BC[0], y - BC[1], z - BC[2], BR[0], BR[1], BR[2]);
  // lower edge of the bronze (worn frame): neck guard at the back, cheek pieces at the sides/front
  const edgeY = (x, z) => {
    const ax = Math.abs(x);
    const back = -0.17 - 0.05 * sstep(-0.25, -0.45, z);
    const cheek = -0.3 + 0.05 * sstep(0.1, 0.0, ax);
    let e = lerp(back, cheek, sstep(-0.24, 0.02, z));
    // notch behind the cheek piece (over the ear)
    e += 0.13 * Math.exp(-(((z + 0.13) / 0.075) ** 2)) * sstep(0.18, 0.3, ax);
    return e;
  };
  // T-shaped face opening (2D in x,y, negative inside): almond eye holes + slit between the cheek pieces
  const opening = (x, y) => {
    const ax = Math.abs(x);
    const eye = ellipse2(ax - 0.16, y - 0.035 - 0.16 * (ax - 0.16), 0.1, 0.043);
    const slit = Math.max(ax - (0.03 + 0.1 * clamp(-(y + 0.04) / 0.28, 0, 1)), y + 0.02);
    let d = Math.min(eye, slit);
    const ng = Math.max(ax - 0.034, Math.abs(y + 0.035) - 0.115); // nose guard
    return Math.max(d, -ng);
  };
  const shellW = (x, y, z) => {
    let d = bowl(x, y, z);
    if (d > 0.12) return d;
    // embossed brow arch over the eye holes, flared neck guard, slightly flared cheek pieces
    d -= 0.016 * Math.exp(-(((y - 0.115 - 0.3 * x * x) / 0.028) ** 2)) * sstep(0.1, 0.3, z);
    d -= 0.035 * sstep(-0.04, -0.22, y) * sstep(-0.12, -0.42, z);
    d -= 0.014 * sstep(-0.08, -0.3, y) * sstep(-0.05, 0.15, z);
    // keel along the bowl top
    d -= 0.01 * Math.exp(-((x / 0.05) ** 2)) * sstep(0.1, 0.35, y);
    // solid at the back (the skull hides inside), a thick shell at the front so the openings show depth
    let sh = Math.max(d, -d - (0.075 + 3 * sstep(0.15, -0.1, z)));
    sh = smax(sh, edgeY(x, z) - y, 0.01);
    // face opening (front only)
    if (o.holes !== false) { // (r6) small statues: no eye holes (they read as a second face at mid range)
      const R = Math.max(opening(x, y), 0.08 - z);
      sh = smax(sh, -R, 0.008);
    }
    // raised rim bead along the lower edge
    const de = y - edgeY(x, z);
    if (de < 0.05) sh -= 0.008 * Math.exp(-(((de - 0.012) / 0.012) ** 2));
    // (r6) embossed running-scroll band above the rim (Attic helmet ornament, ref 5): gilded on the colossi
    if (o.band && de > 0.02 && de < 0.11) {
      const ang = Math.atan2(x, z);
      const env = sstep(0.02, 0.035, de) * sstep(0.11, 0.095, de);
      const sc = Math.abs(Math.sin(ang * 26 + Math.sin(de * 60) * 1.4));
      sh -= 0.009 * env * (0.45 + 0.55 * sc);
    }
    return sh;
  };
  // crest holder: low saddle along the midline
  const holderW = (x, y, z) => {
    const db = bowl(x, y, z);
    let d = Math.max(Math.abs(x) - 0.04, db - 0.05);
    d = Math.max(d, -db - 0.03);
    d = Math.max(d, Math.abs(z + 0.06) - 0.36);
    d = Math.max(d, 0.3 - y);
    return d;
  };
  // horsehair crest, defined in HEAD space (not tilted with the pushed-up bowl, so it still rises tall):
  // a crescent from the front of the bowl, arching high over the crown and sweeping down the back
  const fromH = (x, y, z) => [x * S + lift[0], (c * y - s * z) * S + lift[1], (s * y + c * z) * S + lift[2]];
  const T = fromH(0, BC[1] + BR[1], BC[2]); // bowl top in head space
  const cY = T[1] - 0.3, cZ = T[2] - 0.02, RZ = 0.5, RY = 0.32 + 0.44 * crestH;
  const crestW = (x, y, z, db) => {
    if (crestH <= 0) return 1e9;
    const ax = Math.abs(x);
    if (ax > 0.16) return ax - 0.1;
    const dy = y - cY, dz = z - cZ;
    const outer = ellipse2(dz, dy, RZ, RY);
    let d2 = Math.max(outer, -(db + 0.03));
    // front end above the visor; the tail hangs free down the back of the head
    d2 = Math.max(d2, (z > T[2] + 0.05 ? T[1] - 0.12 : T[1] - 0.62) - y);
    const ang = Math.atan2(dy, dz);
    const inside = clamp(-outer / 0.3, 0, 1);
    const fan = Math.abs(Math.sin(ang * 46 + vnoise3(x * 8, y * 8, z * 8) * 3.5)) * 0.007 + vnoise3(x * 40, y * 30, z * 30) * 0.006;
    const half = (0.045 + 0.075 * inside) * (o.crestW ?? 1) - fan;
    const edge = d2 + 0.004 * Math.sin(ang * 90) + 0.006 * vnoise3(x * 20, y * 40, z * 40);
    return Math.max(edge, ax - half) * 0.8;
  };
  const sdf = (x, y, z) => {
    const r2 = x * x + (y - 0.4) ** 2 + (z + 0.1) ** 2;
    if (r2 > 1.8) return Math.sqrt(r2) - 1.25;
    const [hx, hy, hz] = toH(x, y, z);
    let d = shellW(hx, hy, hz) * S;
    d = smin(d, holderW(hx, hy, hz) * S, 0.015);
    d = Math.min(d, crestW(x, y, z, bowl(hx, hy, hz) * S));
    return d;
  };
  const gB = o.gilt ?? 0.95, gC = o.giltCrest ?? 0.75;
  const gold = (x, y, z) => {
    const [hx, hy, hz] = toH(x, y, z);
    const sm = (d, w) => Math.max(0, Math.min(1, 1 - d / w));
    let r = 0;
    if (gB > 0) r = Math.max(r, gB * sm(shellW(hx, hy, hz), 0.02));
    if (gB > 0 || gC > 0 || o.trim) r = Math.max(r, Math.max(gB, gC, 0.9) * sm(holderW(hx, hy, hz), 0.015));
    if (crestH > 0 && gC > 0) r = Math.max(r, gC * sm(crestW(x, y, z, bowl(hx, hy, hz) * S), 0.02));
    if (o.trim) {
      // (r6) marble helmet with gilded trims: rim bead, embossed brow arch, keel (ref 5)
      const sh = shellW(hx, hy, hz);
      if (sh < 0.02) {
        const de = hy - edgeY(hx, hz);
        const rim = Math.exp(-(((de - 0.014) / 0.017) ** 2));
        const band = o.band ? sstep(0.018, 0.03, de) * sstep(0.115, 0.1, de) : 0;
        const keel = Math.exp(-((hx / 0.035) ** 2)) * sstep(0.12, 0.35, hy);
        r = Math.max(r, o.trim * sm(sh, 0.02) * Math.max(rim, band, keel));
      }
    }
    return r;
  };
  return { sdf, gold };
}

// ------------------------------------------------------------------ aegis, straps, gorgoneion (figure space)
function aegisParts(J, o) {
  const { C, neckBase, trunk } = J;
  const gc = [C[0], C[1] + 0.07, 0]; // gorgoneion centre (z solved below)
  let gz = C[2];
  for (let z = C[2] + 0.3; z > C[2]; z -= 0.002) { if (trunk.eval(gc[0], gc[1], z) < 0.03) { gz = z; break; } }
  gc[2] = gz + 0.014;
  // short scaly capelet over the shoulders (aegis): smooth scalloped hem with a rolled, cord-like edge
  const capeletHem = (x, y, z) => {
    const th = Math.atan2(x - C[0], z - C[2]);
    const lobe = Math.abs(Math.cos(th * 3.5 + 0.4));
    return neckBase[1] - 0.085 + 0.03 * Math.cos(th) - 0.045 * sstep(0.6, 1.4, Math.abs(th)) - 0.022 * lobe;
  };
  const capelet = (x, y, z, dt) => {
    if (y < neckBase[1] - 0.26 || y > neckBase[1] + 0.06) return 1e9;
    let d = dt - 0.024;
    // overlapping scales (shallow)
    d -= 0.0022 * Math.abs(Math.sin(x * 70 + Math.sin(y * 70) * 1.2) * Math.sin(y * 70));
    const hem = capeletHem(x, y, z);
    d = smax(d, hem - y, 0.014);
    d = smax(d, y - neckBase[1] - 0.02 - 0.9 * Math.max(0, Math.abs(x - C[0]) - 0.08), 0.01); // (r6) covers the shoulder caps
    return d;
  };
  // crossed straps (baldric) between the breasts
  const straps = (x, y, z, dt) => {
    if (y < C[1] - 0.22 || y > neckBase[1] + 0.02 || z < C[2] - 0.05) return 1e9;
    let d = 1e9;
    for (const s of [-1, 1]) {
      const nx = 0.72, ny = 0.69 * s;
      const dist = Math.abs((x - gc[0]) * nx + (y - gc[1]) * ny);
      d = Math.min(d, smax(dist - 0.011, dt - 0.023, 0.008)); // (r6) thinner, flatter straps
    }
    return smax(d, -(z - C[2] - 0.02), 0.01);
  };
  // gorgoneion: domed disc with a beaded rim and a small relief face with snaky hair
  const gorg = (x, y, z) => {
    const dx = x - gc[0], dy = y - gc[1], dz = z - gc[2];
    if (dx * dx + dy * dy + dz * dz > 0.012) return Math.sqrt(dx * dx + dy * dy + dz * dz) - 0.06;
    const r = Math.hypot(dx, dy);
    let d = sd.ellipsoid(dx, dy, dz, 0.034, 0.034, 0.012);
    d = smin(d, Math.hypot(r - 0.031, dz - 0.004) - 0.0045 + 0.0012 * Math.sin(Math.atan2(dy, dx) * 24), 0.003);
    d = smin(d, sd.ellipsoid(dx, dy + 0.002, dz - 0.009, 0.012, 0.015, 0.007), 0.004); // face
    for (let k = 0; k < 8; k++) { // snakes radiating
      const a = (k / 8) * Math.PI * 2 + 0.3;
      d = smin(d, sd.capsule(dx, dy, dz, Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0.008, Math.cos(a) * 0.026, Math.sin(a) * 0.026, 0.006, 0.0035), 0.003);
    }
    return d;
  };
  return [
    { sdf: capelet, blend: 0.004 },
    { sdf: straps, blend: 0.004, gold: (x, y, z) => 0 },
    { sdf: gorg, gold: (x, y, z) => (gorg(x, y, z) < 0.006 ? 1 : 0) },
  ];
}

// ------------------------------------------------------------------ the colossus spec
/**
 * variant: 'A' | 'B' | 'C' (pose/seed differences)
 * returns { fig, spear:{base:[x,y,z], top}, shield:{c, n, up, R} } in figure units
 */
export function athenaSpec(variant = 'A') {
  const V = {
    // (r6) A: marble helmet with gilt trims + marble crest, head turned toward the temple (ref 5), slimmer
    // skirt with fewer, deeper folds, mantle pulled behind the back (no side planks), scalloped overfold hem
    A: { seed: 11, headYaw: -0.42, headPitch: 0.1, wristR: [-0.36, 1.55, 0.13], crest: 0.72, crestW: 0.85, hipRoll: 0.11, hipYaw: -0.08, chestYaw: -0.2, strong: false, gilt: 0, giltCrest: 0, trim: 1, shieldTurn: 0.8, drape: { wide: 0, hipWide: 0.03, slim: 0.05, folds: 18, foldAmp: 0.058, fine: 0.32, chestFolds: 0.0065, overFolds: 15, overAmp: 1.05, hemY: 1.1, hemCurve: -0.07, hemScallop: 2.4, mantleScale: 0.5, mantleBack: 0.07, mantleSideL: true, mantleFront: 0.08 } },
    B: { seed: 23, headYaw: -0.42, headPitch: 0.08, wristR: [-0.38, 1.5, 0.08], crest: 0.95, hipRoll: 0.055, chestYaw: -0.08, gilt: 0, giltCrest: 0.72, trim: 0.9, shieldR: 0.42, drape: { wide: 0.012, hipWide: 0.04, folds: 20, foldAmp: 0.052, fine: 0.3, hemScallop: 1.5, mantleScale: 0.6, mantleBack: 0.05, mantleSideL: true, mantleFront: 0.12 } },
    C: { seed: 37, headYaw: -0.2, headPitch: 0.12, wristR: [-0.36, 1.45, 0.11], crest: 0.9, hipRoll: 0.07, chestYaw: 0.05, gilt: 0, giltCrest: 0.0, trim: 1, drape: { slim: 0.02, folds: 18, foldAmp: 0.05, fine: 0.3, overAmp: 1.05, hemY: 1.08, hemCurve: -0.06, hemScallop: 2.2, mantleScale: 0.55, mantleBack: 0.06, mantleSideL: true } },
  }[variant] || {};
  // (r3) V.shieldTurn (rad from the facing): A turns its shield further (ref 5 sees it at ~50 deg)
  const shield = { c: [0.45, (V.shieldR ?? 0.48) + 0.01, 0.08], n: V.shieldTurn ? norm([Math.sin(V.shieldTurn), 0.06, Math.cos(V.shieldTurn)]) : norm([0.42, 0.06, 0.9]), R: V.shieldR ?? 0.48 }; // ~25 deg off the facing: reads from the front-right (shot 5) and front-left (shots 1, 3, 9)
  const rimTop = add(shield.c, [0, shield.R, 0]);
  const wristL = add(rimTop, [-0.035, 0.085, -0.05]);
  const helm = helmet({ crest: V.crest, crestW: V.crestW, gilt: V.gilt, giltCrest: V.giltCrest, trim: V.trim || 0, band: !!V.trim });
  const spec = {
    sex: 'f', seed: V.seed, garment: 'peplos', weight: 'R', handRegion: true, strong: V.strong ?? true, // (r6) A: slimmer, less masculine shoulders and arms (ref 5)
    hip: { roll: V.hipRoll, yaw: V.hipYaw ?? 0 },
    chest: { yaw: V.chestYaw },
    head: { yaw: V.headYaw, pitch: V.headPitch, roll: 0.03 },
    hair: 'wavy', helmeted: true, headScale: 1.1, hipWide: 0.016,
    armR: {
      wrist: V.wristR, pole: [-0.2, -1, -0.35],
      fingers: [0.1, 0.05, 1], dorsal: [-1, 0, 0.1],
      curl: [1.25, 1.35, 0.9], thumbCurl: 0.9, spread: 0.0, handScale: 1.07,
    },
    armL: {
      wrist: wristL, pole: [0.6, 0.1, -1],
      fingers: [0.35, -0.75, 0.55], dorsal: [0.3, 0.6, -0.4],
      curl: [0.45, 0.55, 0.3], thumbCurl: 0.2, spread: 0.05, handScale: 1.07,
    },
    freeAnkle: [0.13, 0.1, 0.12],
    drape: { hipWide: 0.03, hemY: 1.0, folds: 20, foldAmp: 0.036, overFolds: 16, overAmp: 1.35, mantle: true, mantleFront: 0.1, legPush: -0.008, zigzag: true, ...(V.drape || {}) }, // (r3) B: broader, heavier drapery (ref 4)
    headExtras: [helm],
    headBoundsUp: 0.1,
    extras: (J) => aegisParts(J, {}),
  };
  const fig = makeFigure(spec);
  // spear passes through the right fist
  const M = fig.joints.handR;
  const w = fig.joints.aR.wr;
  const grip = add(w, add(mv(M, 0, 0.058, 0), mv(M, 0, 0, -0.036)));
  const spear = { base: [grip[0], 0.0, grip[2]], top: [grip[0], 2.46, grip[2]], r: 0.017, grip };
  return { fig, spear, shield, variant, helm };
}
