// Winged horse (Pegasus-type, rearing) as an SDF, for the chariot group of Poseidon (ref 3 / ref 6).
// Units: METRES of a real horse (withers ≈ 1.62 m when standing). Origin: ground under the hip joint,
// facing +Z, the horse's LEFT side is +X. Scale at placement time (the chariot horses are ≈ 3.8×).
//
//   const H = makeHorse(HORSE_POSES.A);   H.sdf(x,y,z), H.gold(x,y,z) (0.85 gilt body / 1 polished harness),
//   H.bounds {min,max}, H.joints (hooves, poll, muzzle, wing roots …)
//
// Anatomy is built in a BODY frame (origin = midpoint of the hip joints, standing horse, +Z forward) that
// pitches up about the hips (rear), with limbs posed in world angles and the hind legs solved by IK to
// planted hooves. Head/neck are a bezier spine with ellipsoid cross-sections; the mane is an upright,
// clipped crest of tufts (classical Greek horses); the wings carry individually modelled feathers
// (marginal / lesser / greater coverts over primaries, secondaries and tertials).
import {
  sd, clamp, lerp, sstep, smin, smax, Group, ellipsoidR, cone, mmul, mT, mv, rotX, rotY, rotZ,
  frameY, add, sub, scale, dot, cross, len, norm, mix3, hash1, vnoise3, bezier,
} from './sdf.js';
import { ik2 } from './figure.js';

const DEG = Math.PI / 180;

// ------------------------------------------------------------------ part helpers
const ellW = (c, M, rx, ry, rz, k) => ({ f: (x, y, z) => ellipsoidR(x, y, z, c, mT(M), rx, ry, rz), c, r: Math.max(rx, ry, rz), k });
const capW = (a, b, ra, rb, k) => ({ f: (x, y, z) => cone(x, y, z, a, b, ra, rb), c: mix3(a, b, 0.5), r: len(sub(b, a)) * 0.5 + Math.max(ra, rb), k });
/** frame with columns X, Y, Z from a Y direction and a Z hint */
const frameYZ = (yDir, zHint) => frameY(yDir, zHint);

/** world direction for a limb segment: angle a from straight down, positive toward the back (−Z) */
const limbDir = (a, splay = 0) => norm([splay, -Math.cos(a), -Math.sin(a)]);

// ------------------------------------------------------------------ poses
export const HORSE_POSES = {
  // rearing, forelegs raised with folded knees (courbette), wings high (ref 3 centre horses)
  A: {
    seed: 3, rear: 38, hipY: 1.08, neck: 70, neckArch: 0.12, head: 52, headYaw: 4, headRoll: 0,
    fore: { L: { hum: -12, fa: -78, can: 22 }, R: { hum: -4, fa: -58, can: 38 } },
    hind: { L: [0.2, 0.0, 0.38], R: [-0.2, 0.0, 0.18], cannon: 40 },
    wing: { raise: 48, sweep: 8, chordUp: 66, twist: 6, curl: 0.1 }, tail: { lift: 0.25, side: 0.15 }, mouth: 0.5,
  },
  // steeper rear, head turned outward, one foreleg reaching high (refs 3 outer horses)
  B: {
    seed: 7, rear: 46, hipY: 1.0, neck: 72, neckArch: 0.13, head: 46, headYaw: 14, headRoll: -6,
    fore: { L: { hum: -28, fa: -98, can: 12 }, R: { hum: -8, fa: -66, can: 46 } },
    hind: { L: [0.22, 0.0, 0.42], R: [-0.18, 0.0, 0.24], cannon: 46 },
    wing: { raise: 56, sweep: 6, chordUp: 62, twist: 4, curl: 0.12 }, tail: { lift: 0.35, side: -0.2 }, mouth: 0.8,
  },
  // lower rear, prancing, wings more open (inner horses)
  C: {
    seed: 11, rear: 30, hipY: 1.14, neck: 68, neckArch: 0.11, head: 56, headYaw: -6, headRoll: 4,
    fore: { L: { hum: -2, fa: -60, can: 44 }, R: { hum: -20, fa: -88, can: 18 } },
    hind: { L: [0.21, 0.0, 0.3], R: [-0.21, 0.0, 0.1], cannon: 34 },
    wing: { raise: 42, sweep: 10, chordUp: 70, twist: 8, curl: 0.08 }, tail: { lift: 0.2, side: 0.25 }, mouth: 0.3,
  },
};

// (r2 arch-b) swept-back-wing twins: neighbouring horses alternate forward-spread / swept-back wings so the
// heroic wings pass in front of / behind each other instead of interpenetrating (chariotLayout picks them)
for (const k of ['A', 'B', 'C']) {
  const P = HORSE_POSES[k];
  HORSE_POSES[k + 'b'] = { ...P, wing: { ...P.wing, sweep: 46, raise: P.wing.raise + 10, chordUp: P.wing.chordUp + 6 } };
}
// r6 (citadel): pediment relief horses (ref 3 tympanum) — rearing in profile, wings folded low along the back so the
// figure fills the shallow pediment height (statues.js buildPedimentHorses)
HORSE_POSES.P = { ...HORSE_POSES.A, seed: 13, headYaw: 0, headRoll: 0, wing: { raise: 16, sweep: 52, chordUp: 26, twist: 4, curl: 0.06 } };
HORSE_POSES.Q = { ...HORSE_POSES.B, seed: 17, headYaw: 0, headRoll: 0, wing: { raise: 20, sweep: 48, chordUp: 30, twist: 4, curl: 0.08 } };

// ------------------------------------------------------------------ the horse
/**
 * spec: one of HORSE_POSES plus optional { broken: { hindL, hindR, foreL, foreR: fraction cut, wingL, wingR: span cut },
 * noWings, harness: true }
 */
export function makeHorse(spec = HORSE_POSES.A) {
  const seed = spec.seed ?? 1;
  const th = (spec.rear ?? 35) * DEG;
  const Rb = rotX(-th); // body → world (nose up)
  const hip = [0, spec.hipY ?? 1.1, 0];
  const B = (x, y, z) => add(hip, mv(Rb, x, y, z));
  const BM = (M) => mmul(Rb, M); // body-frame orientation → world
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const brk = spec.broken || {};

  // ---------------------------------------------------------- trunk
  const trunk = new Group([], 0.09);
  const tE = (c, rx, ry, rz, k, M = I3) => trunk.add(ellW(B(...c), BM(M), rx, ry, rz, k));
  tE([0, 0.13, 0.04], 0.3, 0.3, 0.42, 0.1);                 // croup / pelvis mass
  for (const s of [-1, 1]) {
    tE([0.165 * s, 0.02, -0.04], 0.155, 0.28, 0.27, 0.08);  // haunch (gluteal + biceps femoris)
    tE([0.1 * s, -0.08, -0.24], 0.11, 0.24, 0.11, 0.07);    // buttock (semitendinosus) seen from behind
    tE([0.18 * s, -0.12, 0.14], 0.08, 0.14, 0.11, 0.1);    // stifle / quadriceps
  }
  tE([0, 0.26, 0.62], 0.19, 0.12, 0.48, 0.12);              // loin top line
  tE([0, 0.03, 0.72], 0.33, 0.35, 0.6, 0.1);                // barrel
  tE([0, -0.17, 0.78], 0.29, 0.2, 0.48, 0.1);               // belly
  tE([0, 0.03, 1.15], 0.3, 0.37, 0.34, 0.1);                // girth / front ribs
  tE([0, 0.33, 1.24], 0.11, 0.1, 0.26, 0.08);               // withers
  tE([0, -0.06, 1.47], 0.25, 0.3, 0.24, 0.1);               // breast
  for (const s of [-1, 1]) {
    tE([0.11 * s, -0.13, 1.6], 0.11, 0.17, 0.1, 0.06);      // pectorals (twin chest muscles)
    // shoulder blade region, along the scapula (withers → point of shoulder)
    const a = [0.12 * s, 0.34, 1.2], b = [0.17 * s, -0.05, 1.58];
    const ax = norm(sub(b, a));
    tE(mix3(a, b, 0.5), 0.1, 0.27, 0.15, 0.07, frameYZ(ax, [0, 0, 1]));
    tE([0.19 * s, -0.17, 1.38], 0.1, 0.13, 0.15, 0.06);     // triceps mass behind the elbow line
  }
  // subtle rib undulation on the barrel sides
  const ribs = (x, y, z) => {
    const l = mv(mT(Rb), x - hip[0], y - hip[1], z - hip[2]);
    if (l[2] < 0.55 || l[2] > 1.2 || Math.abs(l[0]) < 0.2) return 0;
    return 0.0035 * Math.sin(l[2] * 34) * sstep(0.55, 0.7, l[2]) * sstep(1.2, 1.05, l[2]) * sstep(-0.15, 0.05, l[1]) * sstep(0.3, 0.12, l[1]);
  };

  // ---------------------------------------------------------- limbs
  const limbs = new Group([], 0.05);
  const joints = { hooves: [] };
  const cutAt = (a, b, frac) => (frac === undefined ? b : mix3(a, b, frac));
  const breaks = []; // {p, n} fracture planes (keep the side where dot(x-p, n) < 0)
  // fore legs
  for (const s of [-1, 1]) {
    const side = s > 0 ? 'L' : 'R';
    const F = (spec.fore && spec.fore[side]) || { hum: 30, fa: 0, can: 0 };
    const S = B(0.17 * s, -0.05, 1.56);
    const El = add(S, scale(limbDir(F.hum * DEG, 0.04 * s), 0.32));
    const Kn = add(El, scale(limbDir(F.fa * DEG, 0.02 * s), 0.44));
    const Fe = add(Kn, scale(limbDir(F.can * DEG), 0.26));
    const pa = (F.can - 35 + (F.pas ?? 0)) * DEG;
    const Co = add(Fe, scale(limbDir(pa), 0.12));
    const Ho = add(Co, scale(limbDir(pa + 10 * DEG), 0.08));
    const fdir = norm(sub(Kn, El));
    limbs.add(ellW(mix3(S, El, 0.45), frameYZ(norm(sub(El, S)), [0, 0, 1]), 0.1, 0.2, 0.13, 0.06)); // upper arm
    limbs.add(capW(El, Kn, 0.085, 0.052, 0.04));                                    // forearm
    limbs.add(ellW(add(mix3(El, Kn, 0.25), scale(norm(cross([1, 0, 0], fdir)), -0.012)), frameYZ(fdir, [0, 0, 1]), 0.075, 0.15, 0.08, 0.04)); // forearm muscle
    limbs.add(ellW(Kn, frameYZ(norm(sub(Fe, El)), [0, 0, 1]), 0.058, 0.07, 0.062, 0.03)); // knee (carpus)
    limbs.add(capW(Kn, Fe, 0.045, 0.04, 0.02));                                     // cannon
    limbs.add(capW(add(Kn, scale(norm(sub(Fe, Kn)), 0.04)), Fe, 0.012, 0.012, 0.015)); // flexor tendon line (via union below)
    limbs.add(ellW(Fe, frameYZ(norm(sub(Co, Fe)), [0, 0, 1]), 0.052, 0.06, 0.058, 0.025)); // fetlock
    limbs.add(capW(Fe, Co, 0.04, 0.042, 0.02));                                     // pastern
    const hf = hoof(Co, Ho, 0.048, 0.062);
    limbs.add(hf);
    joints.hooves.push(Ho);
    joints['fore' + side] = { S, El, Kn, Fe, Co, Ho };
    const cut = brk['fore' + side];
    if (cut !== undefined) breaks.push(planeAt(Kn, Fe, cut));
  }
  // hind legs (IK to planted hooves)
  for (const s of [-1, 1]) {
    const side = s > 0 ? 'L' : 'R';
    const hp = B(0.2 * s, -0.02, -0.02);
    const tgt = (spec.hind && spec.hind[side]) || [0.2 * s, 0, 0.15];
    const Ho = [tgt[0], tgt[1], tgt[2]];
    const ca = (spec.hind?.cannon ?? 20) * DEG;
    const Co = add(Ho, [0, 0.07, -0.035]);
    const Fe = add(Co, [0, 0.1, -0.06]);
    let Hk = add(Fe, scale(norm([0, Math.cos(ca), -Math.sin(ca)]), 0.36));
    const { mid: St, end } = ik2(hp, Hk, 0.42, 0.47, [0, 0.3, 1]);
    Hk = end;
    const tdir = norm(sub(Hk, St));
    // thigh (mostly inside the haunch), gaskin, hock with point of hock, cannon, fetlock, pastern, hoof
    limbs.add(capW(hp, St, 0.16, 0.085, 0.08));
    limbs.add(capW(St, Hk, 0.1, 0.055, 0.05));
    const back = norm(cross([1, 0, 0], tdir)); // posterior side of the shank
    limbs.add(ellW(add(mix3(St, Hk, 0.3), scale(back, -0.035)), frameYZ(tdir, [0, 0, 1]), 0.075, 0.17, 0.085, 0.05)); // gaskin
    limbs.add(ellW(Hk, frameYZ(norm(sub(Fe, Hk)), [0, 0, 1]), 0.055, 0.07, 0.07, 0.03));
    limbs.add(capW(Hk, add(Hk, scale(back, -0.085)), 0.04, 0.03, 0.03));            // point of hock (calcaneus)
    limbs.add(capW(Hk, Fe, 0.045, 0.04, 0.025));
    limbs.add(ellW(Fe, frameYZ(norm(sub(Co, Fe)), [0, 0, 1]), 0.052, 0.06, 0.058, 0.025));
    limbs.add(capW(Fe, Co, 0.04, 0.042, 0.02));
    limbs.add(hoof(Co, Ho, 0.048, 0.064));
    joints.hooves.push(Ho);
    joints['hind' + side] = { hp, St, Hk, Fe, Co, Ho };
    const cut = brk['hind' + side];
    if (cut !== undefined) breaks.push(planeAt(Hk, Fe, cut));
  }

  // ---------------------------------------------------------- neck (bezier spine, ellipse cross-sections)
  const neckA = (spec.neck ?? 55) * DEG;
  const N0 = B(0, 0.1, 1.42);
  const ndir = [0, Math.sin(neckA), Math.cos(neckA)];
  const nperp = [0, Math.cos(neckA), -Math.sin(neckA)]; // dorsal side of the neck line
  const Ln = spec.neckLen ?? 0.95;
  const poll = add(add(N0, scale(ndir, Ln)), scale(nperp, -0.02));
  const N1 = add(add(N0, scale(ndir, Ln * 0.5)), scale(nperp, spec.neckArch ?? 0.1));
  const spine = bezier(N0, N1, poll, null, 12);
  const neck = new Group([], 0.1);
  const neckFrames = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const p = spine[i];
    const tg = norm(sub(spine[Math.min(12, i + 1)], spine[Math.max(0, i - 1)]));
    const dors = norm(sub(nperp, scale(tg, dot(nperp, tg))));
    neckFrames.push({ p, tg, dors, t });
    if (i % 2 === 1 && i < 12) continue;
    const rd = lerp(0.31, 0.15, Math.pow(t, 0.75)), rl = lerp(0.2, 0.105, Math.pow(t, 0.9));
    // the neck mass sits ventral of the crest line at the base (deep neck), centred higher near the poll
    const c = add(p, scale(dors, -lerp(0.06, 0.0, t)));
    const M = [ // columns: lateral X, tangent Y, dorsal Z
      1, tg[0], dors[0], 0, tg[1], dors[1], 0, tg[2], dors[2],
    ];
    const Mx = norm(cross(tg, dors));
    const Mf = [Mx[0], tg[0], dors[0], Mx[1], tg[1], dors[1], Mx[2], tg[2], dors[2]];
    neck.add(ellW(c, Mf, rl, 0.16, rd, 0.1));
    void M;
  }
  // crest (stallion's arched crest) and jugular groove region
  {
    const f = neckFrames[5];
    const Mx = norm(cross(f.tg, f.dors));
    neck.add(ellW(add(f.p, scale(f.dors, 0.1)), [Mx[0], f.tg[0], f.dors[0], Mx[1], f.tg[1], f.dors[1], Mx[2], f.tg[2], f.dors[2]], 0.075, 0.3, 0.07, 0.08));
  }

  // ---------------------------------------------------------- head
  const psi = (spec.head ?? 60) * DEG; // face angle below horizontal
  const yaw = (spec.headYaw ?? 0) * DEG, roll = (spec.headRoll ?? 0) * DEG;
  const Rh = mmul(rotY(yaw), rotZ(roll));
  const hf = mv(Rh, 0, -Math.sin(psi), Math.cos(psi));
  const hd = mv(Rh, 0, Math.cos(psi), Math.sin(psi));
  const hl = cross(hd, hf);
  const HM = [hl[0], hd[0], hf[0], hl[1], hd[1], hf[1], hl[2], hd[2], hf[2]]; // head local (x lat, u dorsal, a forward) → world
  const HS = spec.headScale ?? 1.14; // heroic head (sculpted horses carry big, expressive heads)
  const H0 = add(poll, scale(hf, -0.04 * HS));
  const HP = (x, u, a) => add(H0, mv(HM, x * HS, u * HS, a * HS));
  const HMT = mT(HM);
  // all head parts in HEAD-LOCAL units (x lateral, u dorsal, a toward the muzzle); evaluated at p/HS
  const head = new Group([], 0.045);
  const L3 = (c) => c;
  const hE = (c, rx, ru, ra, k) => head.add({ f: (x, y, z) => sd.ellipsoid(x - c[0], y - c[1], z - c[2], rx, ru, ra), c: L3(c), r: Math.max(rx, ru, ra), k });
  hE([0, -0.02, 0.07], 0.092, 0.085, 0.11, 0.05);         // cranium
  hE([0, 0.0, 0.19], 0.102, 0.062, 0.11, 0.05);           // broad flat forehead
  for (const s of [-1, 1]) {
    hE([0.058 * s, -0.135, 0.12], 0.06, 0.108, 0.108, 0.05); // round jowls
    hE([0.083 * s, -0.045, 0.28], 0.022, 0.026, 0.085, 0.03); // facial crest
  }
  hE([0, -0.17, 0.2], 0.055, 0.055, 0.12, 0.05);          // between the jaw branches
  head.add(capW([0, -0.02, 0.2], [0, -0.055, 0.46], 0.082, 0.06, 0.05)); // nasal bone / face
  hE([0, -0.075, 0.33], 0.078, 0.085, 0.15, 0.05);        // face sides
  hE([0, -0.088, 0.52], 0.066, 0.075, 0.068, 0.04);       // muzzle
  const mo = (spec.mouth ?? 0.4);
  hE([0, -0.122, 0.56], 0.058, 0.036, 0.045, 0.03);       // upper lip
  hE([0, -0.158 - 0.012 * mo, 0.5], 0.05, 0.036, 0.065, 0.03); // lower lip / chin (mouth open a little)
  for (const s of [-1, 1]) head.add(capW([0.05 * s, -0.17, 0.2], [0.03 * s, -0.16, 0.47], 0.04, 0.03, 0.04)); // mandible branches
  // ears: tapered cones, open at the front; eyes
  const ears = [-1, 1].map((s) => { const eb = [0.045 * s, 0.06, 0.03]; return { eb, et: add(eb, scale(norm([0.16 * s, 0.95, 0.28]), 0.19)), s }; });
  const eyes = [-1, 1].map((s) => ({ c: [0.094 * s, 0.002, 0.2], s }));

  const headLocalSdf = (lx, lu, la) => {
    let d = head.eval(lx, lu, la);
    if (d > 0.2) return d;
    const ax = Math.abs(lx);
    // mouth line (slit from the corner forward), nostrils, eye sockets
    if (la > 0.38 && lu < -0.08) {
      const my = -0.145 - 0.012 * mo;
      d = smax(d, -sd.ellipsoid(lx, lu - my, la - 0.535, 0.075, 0.006 + 0.01 * mo, 0.075), 0.008);
    }
    if (la > 0.48) {
      for (const s of [-1, 1]) {
        const rim = sd.ellipsoid(lx - 0.042 * s, lu + 0.06, la - 0.565, 0.028, 0.038, 0.03); // flared nostril rim
        d = smin(d, rim, 0.02);
        d = smax(d, -sd.ellipsoid(lx - 0.045 * s, lu + 0.058, la - 0.59, 0.014, 0.026, 0.03), 0.008);
      }
    }
    for (const E of eyes) {
      const ex = lx - E.c[0], ey = lu - E.c[1], ez = la - E.c[2];
      if (ex * ex + ey * ey + ez * ez < 0.012) {
        d = smin(d, Math.hypot(ex, ey, ez) - 0.026, 0.012);               // eyeball
        d = smin(d, sd.ellipsoid(lx - 0.084 * E.s, lu - 0.033, la - 0.19, 0.03, 0.016, 0.045), 0.012); // brow
      }
    }
    if (ax > 0.03 && lu > 0.02 && la < 0.16) d = smax(d, -sd.ellipsoid(ax - 0.078, lu - 0.052, la - 0.1, 0.03, 0.022, 0.035), 0.02); // hollow over the eye
    for (const E of ears) {
      // leaf-shaped ear: widest a third of the way up, cupped open toward the front
      const em = add(mix3(E.eb, E.et, 0.38), [0, 0, 0.004]);
      let de = Math.min(cone(lx, lu, la, E.eb, em, 0.04, 0.045), cone(lx, lu, la, em, E.et, 0.045, 0.006));
      if (de < 0.06) de = smax(de, -cone(lx, lu, la, add(E.eb, [0, 0.03, 0.035]), add(E.et, [0, -0.01, 0.022]), 0.03, 0.004), 0.006);
      d = smin(d, de, 0.025);
    }
    // forelock: a few locks between the ears down the forehead
    if (la < 0.3 && lu > -0.02 && ax < 0.08) {
      for (let i = 0; i < 3; i++) {
        const o = (i - 1) * 0.022;
        d = smin(d, cone(lx, lu, la, [o, 0.085, 0.01], [o * 1.6 + 0.01, 0.068, 0.17 + 0.03 * i], 0.024, 0.012) - 0.003 * Math.sin((la * 60) + i * 2), 0.015);
      }
    }
    return d;
  };
  const headSdf = (x, y, z) => {
    const l = mv(HMT, x - H0[0], y - H0[1], z - H0[2]);
    return headLocalSdf(l[0] / HS, l[1] / HS, l[2] / HS) * HS;
  };

  // ---------------------------------------------------------- mane: upright clipped crest of tufts
  const mane = new Group([], 0.02);
  for (let i = 0; i < 20; i++) {
    const t = 0.03 + (i / 19) * 0.95;
    const fi = Math.min(11, Math.floor(t * 12)), fr = t * 12 - fi;
    const fa = neckFrames[fi], fb = neckFrames[fi + 1];
    const p = mix3(fa.p, fb.p, fr), tg = norm(mix3(fa.tg, fb.tg, fr)), dors = norm(mix3(fa.dors, fb.dors, fr));
    const rd = lerp(0.31, 0.15, Math.pow(t, 0.75)) - lerp(0.06, 0, t) + 0.02;
    const root = add(p, scale(dors, rd * 0.86 + (fi === 5 || fi === 6 ? 0.04 : 0)));
    const hh = (0.15 + 0.05 * hash1(i * 3.1 + seed)) * (t > 0.85 ? 0.75 : 1);
    const lean = add(scale(dors, 1), scale(tg, 0.55 + 0.2 * hash1(i * 1.7 + seed)));
    const dir = norm(add(lean, [0.12 * Math.sin(i * 2.1 + seed), 0, 0]));
    const c = add(root, scale(dir, hh * 0.5));
    const Mx = norm(cross(dir, tg));
    const Mz = cross(Mx, dir);
    mane.add(ellW(c, [Mx[0], dir[0], Mz[0], Mx[1], dir[1], Mz[1], Mx[2], dir[2], Mz[2]], 0.03, hh * 0.62, 0.05, 0.015));
  }

  // ---------------------------------------------------------- tail (flowing, with locks)
  const tl = spec.tail || {};
  const T0 = B(0, 0.27, -0.3);
  const T1 = add(B(0, 0.38, -0.62), [tl.side * 0.3 || 0, tl.lift ?? 0.2, 0]);
  const T2 = add(B(0, -0.2, -0.95), [(tl.side || 0) * 0.6, -0.1, -0.15]);
  const T3 = [(tl.side || 0) * 0.5, 0.06, Math.min(-0.9, T2[2] - 0.1)];
  const tailPts = bezier(T0, T1, T2, T3, 14);
  let tmn = [1e9, 1e9, 1e9], tmx = [-1e9, -1e9, -1e9];
  for (const p of tailPts) for (let i = 0; i < 3; i++) { tmn[i] = Math.min(tmn[i], p[i]); tmx[i] = Math.max(tmx[i], p[i]); }
  const tailC = mix3(tmn, tmx, 0.5), tailR = len(sub(tmx, tmn)) * 0.5 + 0.2;
  const tailSdf = (x, y, z) => {
    const bd = Math.hypot(x - tailC[0], y - tailC[1], z - tailC[2]) - tailR;
    if (bd > 0.05) return bd;
    let d = 1e9, best = 0, bt = 0;
    const n = tailPts.length - 1;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const r0 = tailRad(t0), r1 = tailRad(t1);
      const di = cone(x, y, z, tailPts[i], tailPts[i + 1], r0, r1);
      if (di < d) { d = di; best = i; }
    }
    // hair locks: grooves running along the tail
    const a = tailPts[best], b = tailPts[best + 1];
    const ax = norm(sub(b, a));
    const q = sub([x, y, z], a);
    const ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(ax, ref)), v = cross(ax, u);
    const ang = Math.atan2(dot(q, v), dot(q, u));
    bt = (best + clamp(dot(q, ax) / len(sub(b, a)), 0, 1)) / n;
    d -= 0.014 * Math.abs(Math.sin(ang * 4.5 + bt * 9 + seed)) * sstep(0.05, 0.25, bt);
    return d * 0.85;
  };
  function tailRad(t) { return 0.06 + 0.06 * Math.sin(Math.PI * Math.min(1, t * 1.25)) * (t < 0.12 ? t / 0.12 : 1) - 0.035 * t; }

  // ---------------------------------------------------------- wings
  const wings = [];
  if (!spec.noWings) for (const s of [-1, 1]) wings.push(makeWing(spec.wing || {}, s, B, Rb, seed, brk[s > 0 ? 'wingL' : 'wingR']));

  // ---------------------------------------------------------- harness (raised straps following the surface)
  const harness = spec.harness !== false;
  const collarC = add(neckFrames[1].p, scale(neckFrames[1].dors, -0.05));
  const collarN = neckFrames[1].tg;
  const breastC = B(0, -0.1, 1.72);
  const bridle = [{ c: HP(0, -0.06, 0.4), n: hf }, { c: HP(0, -0.02, 0.06), n: norm(add(hf, scale(hd, -0.5))) }];
  const strap = (d, x, y, z, c, n, w, R = 0.45) => {
    const pl = Math.abs((x - c[0]) * n[0] + (y - c[1]) * n[1] + (z - c[2]) * n[2]) - w;
    const rr = Math.hypot(x - c[0], y - c[1], z - c[2]) - R; // only near the strap centre (the plane cuts the body elsewhere too)
    return smax(Math.max(pl, rr), d - 0.022, 0.006);
  };

  // ---------------------------------------------------------- assemble
  const wingGroups = wings.map((w) => w.g);
  const bodySdf = (x, y, z) => {
    let d = trunk.eval(x, y, z) - ribs(x, y, z);
    d = smin(d, neck.eval(x, y, z), 0.12);
    const dl = limbs.bound(x, y, z) > d + 0.1 ? limbs.bound(x, y, z) : limbs.eval(x, y, z);
    d = smin(d, dl, 0.06);
    const dh = Math.hypot(x - H0[0], y - H0[1], z - H0[2]) > 0.75 ? 0.6 : headSdf(x, y, z);
    d = smin(d, dh, 0.07);
    return d;
  };
  const sdf = (x, y, z) => {
    let d = bodySdf(x, y, z);
    let gm = 0;
    if (harness && d < 0.06) {
      let hs = strap(d, x, y, z, collarC, collarN, 0.045);
      for (const b of bridle) hs = Math.min(hs, strap(d, x, y, z, b.c, b.n, 0.018, 0.17 * HS));
      // chest medallion (phalera)
      const pd = Math.hypot(x - breastC[0], y - breastC[1], z - breastC[2]);
      if (pd < 0.2) hs = Math.min(hs, smax(pd - 0.085, d - 0.03, 0.01));
      d = Math.min(d, hs);
    }
    const mb = mane.bound(x, y, z);
    if (mb < 0.1) d = smin(d, mane.eval(x, y, z), 0.035);
    d = smin(d, tailSdf(x, y, z), 0.05);
    for (const g of wingGroups) {
      const b = g.bound(x, y, z);
      if (b < d + 0.05) d = smin(d, g.eval(x, y, z), 0.025);
    }
    for (const P of breaks) {
      const pp = (x - P.p[0]) * P.n[0] + (y - P.p[1]) * P.n[1] + (z - P.p[2]) * P.n[2];
      if (Math.hypot(x - P.p[0], y - P.p[1], z - P.p[2]) < P.r) d = Math.max(d, pp + 0.02 * vnoise3(x * 30, y * 30, z * 30));
    }
    void gm;
    return d;
  };
  const gold = (x, y, z) => {
    if (!harness) return 0.85;
    const d = bodySdf(x, y, z);
    const hs = Math.min(strap(d, x, y, z, collarC, collarN, 0.045),
      ...bridle.map((b) => strap(d, x, y, z, b.c, b.n, 0.018, 0.17 * HS)));
    const pd = Math.hypot(x - breastC[0], y - breastC[1], z - breastC[2]);
    const ph = pd < 0.2 ? smax(pd - 0.085, d - 0.03, 0.01) : 1;
    return Math.min(hs, ph) < 0.012 ? 1 : 0.85;
  };

  // bounds from all key points
  const pts = [hip, poll, HP(0, -0.1, 0.6), N0, T3, ...joints.hooves, ...wings.flatMap((w) => w.extent), B(0, -0.35, 1.7), B(0, 0.4, -0.35)];
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of pts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
  mn = mn.map((v) => v - 0.42); mx = mx.map((v) => v + 0.42);
  mn[1] = Math.max(mn[1], -0.05);
  return {
    sdf, gold, bounds: { min: mn, max: mx },
    joints: { ...joints, poll, muzzle: HP(0, -0.09, 0.6), hip, withers: B(0, 0.4, 1.25), wingRoots: wings.map((w) => w.root), tail: T3 },
  };
}

function planeAt(a, b, frac) {
  const p = mix3(a, b, frac), n = norm(sub(b, a));
  return { p, n, r: 0.25 };
}

/** hoof: slightly flared truncated cone from the coronet to the ground contact, flat sole */
function hoof(co, ho, r0, r1) {
  const ax = norm(sub(ho, co));
  const tip = add(ho, scale(ax, 0.01));
  return {
    f: (x, y, z) => {
      const d = cone(x, y, z, co, tip, r0, r1);
      const q = (x - ho[0]) * ax[0] + (y - ho[1]) * ax[1] + (z - ho[2]) * ax[2];
      return smax(d, q - 0.005, 0.008);
    },
    c: mix3(co, ho, 0.5), r: 0.14, k: 0.02,
  };
}

// ------------------------------------------------------------------ wing
/**
 * w: { raise (deg above horizontal), sweep (deg back), twist (deg, trailing edge down), curl (tip bend) }
 * s: side (+1 = left / +X).  B: body→world point map, Rb: body→world rotation
 */
function makeWing(w, s, B, Rb, seed, cut) {
  const raise = (w.raise ?? 60) * DEG, sweep = (w.sweep ?? 30) * DEG, twist = (w.twist ?? 8) * DEG;
  const curl = w.curl ?? 0.1;
  const WS = w.size ?? 1.3; // heroic wings (ref 3: the wings rise well above the heads)
  const root = B(0.15 * s, 0.33, 1.08);
  // span / chord / normal in BODY frame → world
  let sp = norm(add(scale([s * Math.cos(raise), Math.sin(raise), 0], Math.cos(sweep)), [0, 0, -Math.sin(sweep)]));
  const cu = (w.chordUp ?? 55) * DEG; // feather direction: up and back (the wing fans face the front, ref 3)
  let ch = [0, Math.sin(cu), -Math.cos(cu)];
  ch = norm(sub(ch, scale(sp, dot(ch, sp))));
  let nn = scale(cross(sp, ch), s);
  // twist about the span (trailing edge downward / outward)
  const ct = Math.cos(twist), st = Math.sin(twist);
  const ch2 = norm(add(scale(ch, ct), scale(nn, -st)));
  nn = norm(add(scale(nn, ct), scale(ch, st)));
  ch = ch2;
  // (span / chord / normal are posed in WORLD axes: 'raise' is measured from the world horizontal, so a
  // rearing horse still lifts its wings up instead of trailing them behind)
  void Rb;
  const W = (u, v, n) => add(root, add(add(scale(sp, u), scale(ch, v)), scale(nn, n - curl * u * u * 0.35)));
  const Wd = (du, dv, u) => norm(add(add(scale(sp, du), scale(ch, dv)), scale(nn, -curl * 0.7 * u * du))); // direction in the plane at span u
  // leading edge bones
  const J = [[0, 0], [0.44, -0.07], [0.9, 0.03], [1.2, 0.17]].map(([u, v]) => [u * WS, v * WS]);
  const g = new Group([], 0.02);
  const spanCut = (cut ?? 9) * WS;
  const keep = (u) => u <= spanCut;
  const lead = [];
  const lr = [0.075, 0.055, 0.036, 0.022].map((r) => r * Math.sqrt(WS));
  for (let i = 0; i < 3; i++) {
    if (!keep(J[i][0])) break;
    const a = W(J[i][0], J[i][1], 0.01), b = W(Math.min(J[i + 1][0], spanCut), J[i + 1][1], 0.01);
    g.add(capW(a, b, lr[i], lr[i + 1], 0.03));
    lead.push(a, b);
  }
  // feather helper: anchor (u,v), in-plane direction angle (deg from span toward chord), length, width, layer offset
  const feathers = [];
  const addF = (u, v, angDeg, L, Wd0, layer, thick = 0.016) => {
    if (!keep(u)) return;
    L *= WS; Wd0 *= Math.sqrt(WS); thick *= Math.sqrt(WS);
    const a = angDeg * DEG;
    const A = W(u, v, layer);
    const e = Wd(Math.cos(a), Math.sin(a), u);
    // tip must not cross the cut either
    const tipU = u + Math.cos(a) * L;
    if (!keep(tipU)) L *= Math.max(0.2, (spanCut - u) / Math.max(1e-3, Math.cos(a) * L)) * 0.9;
    const q = norm(cross(nn, e));
    const n2 = norm(cross(e, q));
    feathers.push({ A, e, q, n: n2, L, W: Wd0, th: thick });
  };
  const lerpJ = (i, t) => [lerp(J[i][0], J[i + 1][0], t), lerp(J[i][1], J[i + 1][1], t)];
  // primaries along the hand (outermost first)
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const [u, v] = lerpJ(2, 1 - t * 0.95);
    addF(u, v + 0.02, lerp(6, 58, t) + 3 * Math.sin(i * 1.7 + seed), lerp(0.92, 0.78, t), 0.11, -0.004 * i);
  }
  // secondaries along the forearm
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    const [u, v] = lerpJ(1, 1 - t);
    addF(u, v + 0.03, lerp(66, 88, t) + 2 * Math.sin(i * 2.3 + seed), lerp(0.66, 0.6, t), 0.125, -0.003 * i - 0.04);
  }
  // tertials near the body
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const [u, v] = lerpJ(0, 1 - t * 0.8);
    addF(u, v + 0.04, lerp(90, 104, t), lerp(0.5, 0.38, t), 0.13, -0.07);
  }
  // covert rows on top: greater, median, marginal
  const rows = [
    { n: 15, v: 0.2, L: 0.3, W: 0.085, layer: 0.022, ang: [40, 92] },
    { n: 17, v: 0.12, L: 0.19, W: 0.07, layer: 0.034, ang: [50, 96] },
    { n: 19, v: 0.055, L: 0.12, W: 0.055, layer: 0.04, ang: [60, 100] },
  ];
  for (const R of rows) for (let i = 0; i < R.n; i++) {
    const t = i / (R.n - 1);
    const seg = t < 0.36 ? 0 : t < 0.78 ? 1 : 2;
    const tt = seg === 0 ? t / 0.36 : seg === 1 ? (t - 0.36) / 0.42 : (t - 0.78) / 0.22;
    const [u, v] = lerpJ(seg, tt);
    if (seg === 2 && tt > 0.7) continue;
    addF(u, v + R.v - 0.04, lerp(R.ang[1], R.ang[0], t), R.L * (seg === 2 ? 1.25 : 1), R.W, R.layer, 0.017);
  }
  for (const F of feathers) g.add(featherPart(F));
  // smooth "patagium" pad filling between the leading edge and the coverts
  for (let i = 0; i < 3; i++) {
    if (!keep(J[i][0])) break;
    const a = W(J[i][0], J[i][1] + 0.08, 0.02), b = W(Math.min(J[i + 1][0], spanCut), J[i + 1][1] + 0.07, 0.02);
    g.add(capW(a, b, lr[i] * 0.75, lr[i + 1] * 0.75, 0.03));
  }
  const extent = feathers.map((F) => add(F.A, scale(F.e, F.L)));
  return { g, root, extent };
}

/** one feather: rounded 2D blade (tapered capsule in the wing plane) extruded to a thin cambered slab */
function featherPart(F) {
  const { A, e, q, n, L, W, th } = F;
  const r0 = W * 0.42, r1 = W * 0.5;
  const s1 = Math.max(0.01, L - r1);
  return {
    f: (x, y, z) => {
      const px = x - A[0], py = y - A[1], pz = z - A[2];
      const s = px * e[0] + py * e[1] + pz * e[2];
      const t = px * q[0] + py * q[1] + pz * q[2];
      let w = px * n[0] + py * n[1] + pz * n[2];
      const sn = clamp(s / L, 0, 1);
      w += 0.035 * L * sn * sn + 0.25 * t * t; // camber: tips droop, vane curves down at the edges
      // 2D tapered capsule from (0, r0) to (s1, r1)
      const h = clamp(s / s1, 0, 1);
      const d2 = Math.hypot(s - h * s1, t) - lerp(r0, r1, h);
      const tw = th * (1 - 0.45 * sn) + 0.004 * Math.exp(-((t / 0.012) ** 2)) * (1 - sn); // rachis ridge
      const dw = Math.abs(w) - tw;
      return Math.min(Math.max(d2, dw), 0) + Math.hypot(Math.max(d2, 0), Math.max(dw, 0));
    },
    c: add(A, scale(e, L * 0.5)), r: L * 0.5 + W, k: 0.006,
  };
}
