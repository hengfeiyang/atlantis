// Builds the shed mole (plan: src/rings/mole.js) with the ring builders: the rock-cut ship-shed arcade on the west face,
// the tin curtain with pylons above it, dressed revetments + balustrade on the north / east faces, the paved top with
// cypress / palm slots. The tunnel block and the bridge at its head are the bridges module's (src/bridges/mole.js).
// OWNER: rings agent (arch-a, r3).
import { buildEdge } from './wall.js';
import { buildSheds } from './sheds.js';
import { buildTowers } from './towers.js';
import { AUX_PAVING } from './geo.js';

export function buildMole(ctx, M) {
  const mp = ctx.plan.mole;
  if (!mp) return null;
  const sub = { ...ctx, plan: { ...ctx.plan, towers: mp.towers } };
  let bays = 0;
  for (const e of mp.edges) bays += buildEdge(sub, e).bays;
  const sh = buildSheds(sub, [mp.west], mp.sheds, []);
  // ---- paved top (land side of the curtain → east face), in 12 m strips (chunked meshes)
  const { P } = mp.frame;
  const y = mp.spec.landY + 0.02;
  const lat0 = mp.spec.depth + 0.85 + 3.0, lat1 = mp.latE - 0.2;
  for (let s = mp.sBack; s < mp.sEnd - 1e-3; s += 12) {
    const s1 = Math.min(mp.sEnd - 0.2, s + 12);
    const a = P(s, lat0), b = P(s1, lat0), c = P(s1, lat1), d = P(s, lat1);
    const B = ctx.S.get('paving', (a[0] + c[0]) / 2, (a[1] + c[1]) / 2);
    B.aux = [0, 0, 0, AUX_PAVING(1.6)];
    B.quadToward([a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], [d[0], y, d[1]], [0.9, 0.88, 0.85], [0, 1, 0]);
    B.aux = [0, 0, 0, 0];
  }
  // ---- greenery on the top (golden): a cypress row behind the curtain (ref 4 skyline), palms near the head
  if (!ctx.sunken) {
    // r5 (vegetation request, ref 4): the shot-4 eye (26 m off the curtain at y 2-3) sees the land side of the mole only
    // through one window: between the -44 m and -71 m pylons, above the coping (the other gaps are hidden by the pylons
    // overlapping in perspective). So the row hugs the curtain's land-side wall (lat ≈ 9.6-11), trees ≈ 4 m apart in
    // groups between the pylons, tall (18-25 m above the mole top) so their spires clear the coping by 3-10 m there.
    // Deterministic per index (no shared-rng drift).
    const tree = (ctx.engine.slots.tree ||= []);
    const hsh = (k, j) => { const v = Math.sin(k * 127.1 + j * 311.7) * 43758.5453; return v - Math.floor(v); };
    const pyl = mp.towers.map((t) => t.s).sort((a, b) => a - b);
    let k = 0;
    for (let i = 0; i + 1 < pyl.length; i++) {
      const a = pyl[i] + 3.4, b = pyl[i + 1] - 3.4;
      if (b - a < 3 || b > mp.sEnd - 4) continue;
      const n = Math.max(2, Math.round((b - a) / 4.1));
      for (let j = 0; j < n; j++, k++) {
        if (j > 0 && j < n - 1 && hsh(k, 9) < 0.18) continue;   // irregular gaps: not a copy-pasted row
        const s = a + (b - a) * ((j + 0.5) / n) + (hsh(k, 1) - 0.5) * 1.3;
        const [x, z] = P(s, mp.spec.depth + 5.7 + 1.4 * hsh(k, 2));
        tree.push({ pos: [x, mp.spec.landY, z], tag: 'cypress', size: 18 + 7 * hsh(k, 3), source: 'rings-mole' });
      }
    }
    for (let s = mp.sBack + 20; s < mp.sEnd - 6; s += 17) {
      const [x, z] = P(s, mp.latE - 5);
      ctx.engine.slots.palm.push({ pos: [x, mp.spec.landY, z], size: 9 + 3 * ctx.rng.random(), tag: 'garden', source: 'rings-mole' });
    }
  } else {
    for (let s = mp.sBack + 6; s < mp.sEnd; s += 9) {
      const [x, z] = P(s, (mp.spec.depth + mp.latE) / 2);
      ctx.slots.coral.push({ pos: [x, mp.spec.landY + 0.05, z], normal: [0, 1, 0], size: 2.2, tag: 'rings-mole-top' });
    }
  }
  // footprints (city / vegetation scatter / props keep off; ships: registry.rings.mole.inside)
  const { d, n } = mp.frame;
  const cs = (mp.sBack + mp.sEnd) / 2, cl = mp.latE / 2;
  const c = P(cs, cl);
  ctx.engine.footprints.addRect(c[0], c[1], (mp.sEnd - mp.sBack) / 2, mp.latE / 2, Math.atan2(-d[1], d[0]), 'rings-mole');
  void n;
  const tw = buildTowers(sub, M, { towers: mp.towers, edges: mp.edges });
  return { bays, sheds: sh.count, towers: tw };
}
