// LOD planning: a quadtree over the world whose leaves are 64×64-cell chunks. The cell size of a
// region is driven by the known shot cameras (src/world/shots.js): about K screen pixels per cell
// for the closest camera that can see it, so geometry is dense exactly where the shots look.
import { heightAt } from '../world/heightfield.js';
import { outcrop, protectFlat } from './field.js';
import * as L from '../world/layout.js';

const CELLS = 64;

function camInfo(shot, W = 1672, Hpx = 941) {
  const p = shot.pos, t = shot.target;
  let fx = t[0] - p[0], fy = t[1] - p[1], fz = t[2] - p[2];
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  const vf = (shot.fov ?? 40) * Math.PI / 180;
  const tanV = Math.tan(vf / 2), tanH = tanV * W / Hpx;
  // right/up vectors
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy; // up = right × forward (with ry = 0)
  return { p, f: [fx, fy, fz], r: [rx, 0, rz], u: [ux, uy, uz], tanV, tanH, pxAng: (2 * tanV) / Hpx, near: shot.near ?? 0.5 };
}

/** is the sphere (c, rad) inside the (widened) frustum of camera C? */
function inFrustum(C, cx, cy, cz, rad, widen = 1.08) {
  const dx = cx - C.p[0], dy = cy - C.p[1], dz = cz - C.p[2];
  const zf = dx * C.f[0] + dy * C.f[1] + dz * C.f[2];
  if (zf < -rad) return false;
  const xr = dx * C.r[0] + dz * C.r[2];
  const yu = dx * C.u[0] + dy * C.u[1] + dz * C.u[2];
  const zz = Math.max(zf, 0);
  const tH = C.tanH * widen, tV = C.tanV * widen;
  // distance to side planes (normalised)
  if (Math.abs(xr) - zz * tH > rad * Math.sqrt(1 + tH * tH)) return false;
  if (Math.abs(yu) - zz * tV > rad * Math.sqrt(1 + tV * tV)) return false;
  return true;
}

/**
 * @param {object[]} shots   shot list (pos/target/fov)
 * @param {object} o { rootSize, center:[x,z], K, minCell, nearMinCell, coarseFactor, maxCell }
 * @returns {{x0,z0,size,cell,n}[]} leaves
 */
export function planChunks(shots, o = {}) {
  const rootSize = o.rootSize ?? 65536;
  const cx = o.center?.[0] ?? 0, cz = o.center?.[1] ?? -8000;
  const K = o.K ?? 3;
  const minCell = o.minCell ?? 1, nearMin = o.nearMinCell ?? 0.5, maxCell = o.maxCell ?? 1024;
  const factor = o.coarseFactor ?? 1; // quality: preview = 2
  const cams = shots.map((s) => camInfo(s));
  // ground-level cameras get a finer minimum cell nearby
  // (also water-level cameras: shot 7 stands on the rapids reach, its bed and boulders are foreground)
  const groundCams = cams.filter((C) => { const g = heightAt(C.p[0], C.p[2]); return (g > 0.5 && C.p[1] - g < 9) || (g > -3 && C.p[1] < 9); });
  const leaves = [];

  const HS = new Float32Array(81);
  const reqCell = (x0, z0, size) => {
    // sample the node's height range coarsely (9×9) — also used for the flatness test
    let hmin = Infinity, hmax = -Infinity;
    const s = 8;
    for (let j = 0; j <= s; j++) for (let i = 0; i <= s; i++) {
      const h = heightAt(x0 + size * i / s, z0 + size * j / s);
      HS[j * 9 + i] = h;
      if (h < hmin) hmin = h; if (h > hmax) hmax = h;
    }
    hmax = Math.max(hmax, hmin + 1);
    const mx = x0 + size / 2, mz = z0 + size / 2, my = (hmin + hmax) / 2;
    const rad = Math.hypot(size / 2, size / 2, (hmax - hmin) / 2 + 40);
    let best = maxCell;
    for (const C of cams) {
      if (!inFrustum(C, mx, my, mz, rad)) continue;
      // distance from camera to the node's 3D box
      const dx = Math.max(x0 - C.p[0], 0, C.p[0] - (x0 + size));
      const dz = Math.max(z0 - C.p[2], 0, C.p[2] - (z0 + size));
      const dy = Math.max(hmin - C.p[1], 0, C.p[1] - hmax - 3);
      const d = Math.hypot(dx, dy, dz);
      // mid distances are the most expensive (cliffs): coarser there; far mountains get ~4 px cells so
      // their silhouettes stay crisp (far chunks have no 3D rock detail and mesh quickly)
      const ramp = Math.min(1, Math.max(0, (d - 1200) / 2500));
      const kk = d > 3500 ? Math.min(K * 3.5, 4.5 + (d - 3500) * 0.0004) : K * (1 + 2.5 * ramp);
      let cell = d * C.pxAng * kk;
      if (hmax < -1.5) cell *= hmax < -5 ? 4 : 2; // water floor: barely visible through the water
      best = Math.min(best, cell);
    }
    // never coarser than a ring-based fallback around the centre of the world (interactive viewing)
    const dc = Math.max(Math.abs(mx - (-300)) - size / 2, Math.abs(mz - 0) - size / 2, 0);
    best = Math.min(best, Math.max(4, dc * 0.012));
    let lim = minCell;
    for (const C of groundCams) {
      const dx = Math.max(x0 - C.p[0], 0, C.p[0] - (x0 + size)), dz = Math.max(z0 - C.p[2], 0, C.p[2] - (z0 + size));
      if (Math.hypot(dx, dz) < 45) lim = nearMin;
    }
    // flat ground needs far fewer triangles (shading carries the detail): measure the max slope and
    // the deviation from a plane between samples
    let flat = 1;
    // small steep rock features the 8 m flatness probe can miss (the island's rock flanks)
    const I = L.ISLAND;
    const smallRock = Math.max(x0 - I.center[0], 0, I.center[0] - (x0 + size)) ** 2 + Math.max(z0 - I.center[1], 0, I.center[1] - (z0 + size)) ** 2 < (I.radius + 16) ** 2;
    // r5: the island's small-scale rock (field.js islandScale) needs 0.5 m cells (1 m crumpled it into facets)
    if (smallRock && best < 1.2) lim = Math.min(lim, nearMin);
    if (size <= 512 && !smallRock) {
      const step = size / 8;
      let gmax = 0, curv = 0;
      for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) {
        const h = HS[j * 9 + i];
        if (i < 8) gmax = Math.max(gmax, Math.abs(HS[j * 9 + i + 1] - h) / step);
        if (j < 8) gmax = Math.max(gmax, Math.abs(HS[(j + 1) * 9 + i] - h) / step);
        if (i > 0 && i < 8 && j > 0 && j < 8) curv = Math.max(curv, Math.abs(HS[j * 9 + i - 1] + HS[j * 9 + i + 1] + HS[(j - 1) * 9 + i] + HS[(j + 1) * 9 + i] - 4 * h));
      }
      // outcrops make otherwise flat ground rough
      let oc = 0;
      if (best < 1.5) for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) {
        const x = x0 + size * i / 4, z = z0 + size * j / 4;
        if (!protectFlat(x, z)) oc = Math.max(oc, outcrop(x, z));
      }
      // largest cell that keeps the chord error of the measured curvature below ~0.12 m
      const cmax = step * Math.sqrt(2.0 / Math.max(curv, 1e-3));
      if (gmax < 0.6 && oc < 0.2) flat = Math.min(4, Math.max(1, cmax / Math.max(lim, best)));
      // no cliffs here: 3D rock detail is not needed, so never finer than 2 m (unless a ground camera is close)
      if (gmax < 0.7) flat = Math.max(flat, (lim >= 1 ? 2 : 1) / Math.max(lim, best));
      // only real cliffs (> ~55°) get the finest cells; steep-ish slopes 2 m
      else if (gmax < 1.45 && lim >= 1) flat = Math.max(flat, 2 / Math.max(lim, best));
    }
    return Math.max(lim, best) * flat * factor;
  };

  // a node becomes a leaf when its cell size satisfies the (more local, hence more permissive)
  // requirements of all four children
  const visit = (x0, z0, size, req) => {
    const cell = size / CELLS;
    if (req === undefined) req = reqCell(x0, z0, size);
    const leaf = () => leaves.push(cell >= 64 ? { x0, z0, size, cell: cell * 2, n: CELLS / 2 } : { x0, z0, size, cell, n: CELLS });
    if (cell <= req || size <= CELLS * nearMin * factor) { leaf(); return; }
    const h = size / 2;
    const kids = [[x0, z0], [x0 + h, z0], [x0, z0 + h], [x0 + h, z0 + h]].map(([x, z]) => [x, z, reqCell(x, z, h)]);
    const kr = Math.min(...kids.map((k) => k[2]));
    if (cell <= kr) { leaf(); return; }
    for (const [x, z, r] of kids) visit(x, z, h, r);
  };
  visit(cx - rootSize / 2, cz - rootSize / 2, rootSize);
  return leaves;
}
