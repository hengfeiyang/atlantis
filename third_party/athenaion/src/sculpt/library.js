// Statue geometry library: every heavy mesh is built here and cached through loadOrBuild()
// (baked by `node tools/bake.mjs statues` → generated/statue-*.bin). Geometry is in NOMINAL figure
// units (2.0 m tall figure, sole at y=0, facing +Z); scale at placement.
import * as THREE from 'three';
import { loadOrBuild } from '../core/cache.js';
import { athenaSpec } from './athena.js';
import { meshRegion, bakeAttributes, mergeGeos, triCount } from './bakeutil.js';
import { spearGeometry, shieldGeometry } from './props.js';
import { sd, add, sub, scale, norm, cross, dot, len } from './sdf.js';

export const LIB_VERSION = 12; // r6: marble helmets with gilt trims, slimmer deeper drapery, finer A head
export const SHIELD_VERSION = 11; // r6: A uses the 'all' emblem (ref 5)
export const SHIELD_STYLE = { A: 'all', B: 'wreath', C: 'wreath' }; // B: perched owl in a laurel wreath (ref 4)

// cell sizes in figure units at detail = 1 (bake)
export const COLOSSUS_RES = {
  A: { body: 0.0082, head: 0.0029, shieldN: 180 },
  B: { body: 0.0095, head: 0.0042, shieldN: 150 },
  C: { body: 0.0125, head: 0.0055, shieldN: 120 },
};

/** shield frame: local +Z = face normal, +Y = up */
export function shieldMatrix(sh) {
  const n = norm(sh.n), up = [0, 1, 0];
  const x = norm(cross(up, n)), y = cross(n, x);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...n));
  m.setPosition(sh.c[0], sh.c[1], sh.c[2]);
  return m;
}

/** approximate SDF of the shield + spear (used for baking AO onto the figure) */
function propsSdf(A) {
  const { shield, spear } = A;
  const n = norm(shield.n);
  return (x, y, z) => {
    const px = x - shield.c[0], py = y - shield.c[1], pz = z - shield.c[2];
    const h = px * n[0] + py * n[1] + pz * n[2];
    const rx = px - n[0] * h, ry = py - n[1] * h, rz = pz - n[2] * h;
    const r = Math.hypot(rx, ry, rz);
    const dDisc = Math.hypot(Math.max(r - shield.R, 0), Math.max(Math.abs(h - 0.01) - 0.035, 0)) + Math.min(Math.max(r - shield.R, Math.abs(h - 0.01) - 0.035), 0);
    const dSp = sd.capsule(x, y, z, spear.base[0], spear.base[1], spear.base[2], spear.top[0], spear.top[1], spear.top[2], spear.r);
    return Math.min(dDisc, dSp);
  };
}
const groundOcc = (x, y, z, nx, ny, nz) => {
  // occlusion by the pedestal top (plane y=0)
  const h = Math.max(0, y);
  return Math.max(0, 0.35 * (1 - h / 0.08)) * (0.6 - 0.4 * ny);
};

/** build the colossus figure (body + fine head) with baked attributes */
export function buildColossusFigure(variant, detail = 1) {
  const t0 = Date.now();
  const A = athenaSpec(variant);
  const res = COLOSSUS_RES[variant];
  const f = 1 / Math.sqrt(Math.max(0.05, detail));
  const fig = A.fig;
  const body = meshRegion(fig.bodySdf, fig.bounds, res.body * f);
  const head = meshRegion(fig.headSdf, fig.headBounds, res.head * f);
  const props = propsSdf(A);
  const full = (x, y, z) => Math.min(fig.sdf(x, y, z), props(x, y, z));
  bakeAttributes(body, full, fig.gold, { aoDist: 0.09, cavDist: 0.01, extraOcc: groundOcc });
  bakeAttributes(head, full, fig.gold, { aoDist: 0.06, cavDist: 0.006 });
  const hands = (fig.hands || []).map((H) => {
    const hg = meshRegion(H.sdf, H.bounds, res.head * 1.15 * f);
    bakeAttributes(hg, full, fig.gold, { aoDist: 0.05, cavDist: 0.006 });
    return hg;
  });
  const g = mergeGeos([body, head, ...hands]);
  if (typeof console !== 'undefined') console.log(`[statues] colossus ${variant}: ${triCount(g)} tris in ${Date.now() - t0} ms`);
  return g;
}

export async function colossusGeometries(variant, detail = 1, want = () => true) {
  const A = athenaSpec(variant);
  const res = COLOSSUS_RES[variant];
  const figure = want('ath' + variant) ? await loadOrBuild(`statue-ath${variant}-v${LIB_VERSION}`, () => buildColossusFigure(variant, detail)) : null;
  const shield = !want('shield' + variant) ? null : await loadOrBuild(`statue-shield${variant}-v${SHIELD_VERSION}`, () => shieldGeometry({ R: A.shield.R, N: Math.round(res.shieldN * Math.sqrt(detail)), style: SHIELD_STYLE[variant] }));
  const spear = spearGeometry({ length: A.spear.top[1] - A.spear.base[1], r: A.spear.r });
  return { A, figure, shield, spear, shieldMatrix: shieldMatrix(A.shield) };
}
