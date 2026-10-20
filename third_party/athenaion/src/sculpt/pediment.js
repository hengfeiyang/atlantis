// Pediment groups and metope reliefs: pure placement logic (no geometry). Figures come from the
// statue library (standing types + PED_TYPES poses). All results are in the pediment / metope frame:
//   u along `right`, y along `up`, z along `normal` (outward), metres.
import { STATUE_TYPES, PED_TYPES } from './statuary.js';

const STAND_W = 0.52; // nominal width of a standing figure (2.0 m figure units)
const POSE = Object.fromEntries(PED_TYPES.map((p) => [p.id, { h: p.height, w: p.width, recline: !!p.recline }]));

/**
 * ped = { baseWidth, height, depth }  → [{ id, u, z, s, yaw, mirror, flatten? }]
 * Composition: Athena at the centre, standing figures flanking her, then striding / seated /
 * kneeling figures and reclining figures in the corners, all at one scale (Parthenon logic).
 */
export function composePediment(ped, rng) {
  const W = ped.baseWidth, H = ped.height, D = Math.max(0.4, ped.depth ?? 0.8);
  const s = (0.9 * H) / 2.0; // (r3) figures fill the field up to the raking cornice (ref 5)
  const out = [];
  // (r3) deep pediment floors (ref 5) get two overlapping depth layers: a back row in high relief
  // half-sunk into the tympanum, filling the gaps of a front row of free-standing figures
  const deep = D > 0.62 * s;
  const zOf = (sc) => Math.max(0.22 * sc, Math.min(D * 0.55, 0.3 * sc));
  const zFront = (sc) => (deep ? Math.max(zOf(sc), Math.min(D - 0.16 * sc, 0.5 * sc)) : zOf(sc));
  const zBack = (sc) => 0.1 * sc;
  const sc0 = s * 1.03;
  out.push({ id: 'athenaMini', u: 0, z: zFront(sc0), s: sc0, yaw: 0, mirror: false });
  const standing = STATUE_TYPES.map((t) => t.id).filter((id) => id !== 'athenaMini');
  const layer = (side, u0, k0, back) => {
    let u = u0, k = k0, lastKind = '';
    const sMax = s;
    for (let guard = 0; guard < 40; guard++) {
      const gap = sMax * (back ? 0.06 + 0.12 * rng.random() : -0.1 + 0.1 * rng.random());
      const cands = [
        { id: standing[k % standing.length], h: 2.0, w: STAND_W, kind: 'stand', min: 0.62 },
        { id: 'pedStride', h: POSE.pedStride.h, w: POSE.pedStride.w, kind: 'stride', min: 0.6 },
        { id: 'pedSeated', h: POSE.pedSeated.h, w: POSE.pedSeated.w, kind: 'seat', min: 0.6 },
        { id: 'pedKneel', h: POSE.pedKneel.h, w: POSE.pedKneel.w, kind: 'kneel', min: 0.55 },
        { id: 'pedRecline', h: POSE.pedRecline.h, w: POSE.pedRecline.w, kind: 'recline', min: 0.35 },
      ].filter((c) => (back ? c.kind === 'stand' || c.kind === 'stride' : c.kind !== 'stand' || !deep || rng.random() < 0.3));
      // scale each candidate so it fits under the raking cornice at its outer edge
      const fits = [];
      for (const c of cands) {
        // largest scale with h*sc <= 0.97*avail(u + w*sc)  (closed form for the linear slope)
        const kk = back ? 1.02 : 1.0;
        const scMax = (kk * H * (0.95 - (2 * u) / W)) / (c.h + (kk * H * c.w * 2) / W);
        const sc = Math.min(sMax, scMax);
        const outer = u + c.w * sc;
        if (sc < c.min * s || outer > W / 2 - 0.08 * s) continue;
        fits.push({ ...c, sc });
      }
      if (!fits.length) break;
      // full-size standing figures near the centre; then a varied mix, reclining figures last
      let pick = fits[0];
      if (pick.kind !== 'stand' || pick.sc < sMax * 0.98) {
        const pool = fits.filter((f) => f.kind !== 'recline' && f.kind !== lastKind);
        if (pool.length && fits.some((f) => f.kind !== 'recline' && f.sc > 0.7 * s)) pick = pool[Math.floor(rng.random() * pool.length)];
        else pick = fits.find((f) => f.kind === 'recline') || fits[fits.length - 1];
      }
      const cu = u + (pick.w * pick.sc) / 2;
      // torsion: figures turn toward the centre (a few look outward), striders and kneelers twist harder
      const twist = pick.kind === 'stride' || pick.kind === 'kneel' ? 0.95 : 0.6;
      let yaw = -side * (0.1 + twist * rng.random()) * (rng.random() < 0.15 ? -0.6 : 1);
      // lean toward the centre (motion; keeps heads under the slope)
      let roll = pick.kind === 'recline' || pick.kind === 'seat' ? 0 : side * (back ? 0.04 : 0.02 + 0.09 * rng.random()) * (pick.kind === 'stride' ? 1.4 : 1);
      if (pick.kind === 'recline') yaw = side * Math.PI / 2;
      const zj = (rng.random() - 0.5) * (back ? 0.08 : 0.2) * pick.sc;
      const z = back ? zBack(pick.sc) + zj : Math.max(0.18 * pick.sc, zFront(pick.sc) * (pick.kind === 'recline' ? 0.9 : 1) + zj);
      out.push({ id: pick.id, u: side * cu, z, s: pick.sc * (0.98 + 0.04 * rng.random()), yaw, roll, mirror: side < 0, layer: back ? 1 : 0 });
      if (pick.kind === 'stand') k++;
      lastKind = pick.kind;
      u += pick.w * pick.sc + gap;
    }
  };
  // progressively smaller figures toward the corners (as in the reference), poses adapt to the slope
  for (const side of [-1, 1]) {
    const k0 = Math.floor(rng.random() * standing.length);
    layer(side, 0.36 * sc0 + 0.05 * s, k0, false);
    // back row: offset by half a figure so its members show between the front figures
    if (deep) layer(side, 0.36 * sc0 + 0.05 * s + 0.5 * STAND_W * s, k0 + 3, true);
  }
  return out;
}

/** metope: two small figures in high relief (flattened depth) */
const METOPE_SETS = [
  [['pedStride', -0.2, 0], ['pedKneel', 0.22, 1]],
  [['warrior', -0.2, 0], ['pedStride', 0.2, 1]],
  [['athenaMini', -0.18, 0], ['pedSeated', 0.2, 1]],
  [['oratorScroll', -0.2, 0], ['koreOffering', 0.2, 1]],
  [['pedStride', -0.18, 1], ['pedRecline', 0.18, 0]],
  [['femaleRaised', -0.2, 0], ['priestess', 0.2, 1]],
];
export function composeMetope(met, idx, rng) {
  const [w, h] = met.size || [1.2, 1.2];
  const set0 = METOPE_SETS[(idx + Math.floor(rng.random() * 2)) % METOPE_SETS.length];
  // (r6) fuller panels (ref 5): larger figures plus a third one between the pair on wide metopes
  const mid = METOPE_SETS[(idx + 3) % METOPE_SETS.length][0];
  const set = w > 0.9 * h ? [[set0[0][0], -0.29, set0[0][2]], [mid[0], 0.0, (idx & 1)], [set0[1][0], 0.29, set0[1][2]]] : set0;
  const s = (0.94 * h) / 2.0;
  const flatten = 0.42;
  return set.map(([id, u, m]) => {
    const isRecline = id === 'pedRecline';
    return {
      id, u: u * w, y: -h / 2 + 0.03 * h, z: 0.25 * s * flatten, s: isRecline ? s * 1.1 : s,
      yaw: isRecline ? (m ? -1 : 1) * Math.PI / 2 : (m ? -0.35 : 0.35), mirror: !!m, flatten,
    };
  });
}
