// Plateau & terrace furniture: processional way (paved, following the ground), exedrae (curved
// benches with statues), fountains with basins, small shrines. All sit on heightAt().
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';
import { chamferBox, frameFacing, Frame, FACES } from './geo.js';
import { blockColor, STONE_COL } from './masonry.js';
import { pedestal, lampPost, wreath } from './ornament.js';
import { addRosette } from './plaza.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** paved strip following the ground between two points (axis-aligned along z), with kerbs */
export function pavedWay(ctx, x, zA, zB, halfW, rng, opts = {}) {
  const { S } = ctx;
  const z0 = Math.min(zA, zB), z1 = Math.max(zA, zB);
  const B = S.get('paving', x, (z0 + z1) / 2);
  const step = 2.0;
  const nx = Math.max(2, Math.round((halfW * 2) / step)), nz = Math.max(2, Math.round((z1 - z0) / step));
  const H = [];
  for (let j = 0; j <= nz; j++) {
    const row = [];
    for (let i = 0; i <= nx; i++) {
      const px = x - halfW + (2 * halfW * i) / nx, pz = z0 + ((z1 - z0) * j) / nz;
      row.push([px, heightAt(px, pz) + 0.08, pz]);
    }
    H.push(row);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = H[j][i], b = H[j][i + 1], c = H[j + 1][i + 1], d = H[j + 1][i];
    B.quadOut(a, b, c, d, [1, 1, 1], [(a[0] + c[0]) / 2, Math.min(a[1], c[1]) - 3, (a[2] + c[2]) / 2]);
  }
  // kerbs: stone blocks along both edges
  const K = S.get('marble', x, (z0 + z1) / 2);
  for (const sx of [-1, 1]) {
    let z = z0;
    while (z < z1 - 0.1) {
      const L = Math.min(z1 - z, 1.3 + rng.random() * 1.0);
      const g = Math.max(heightAt(x + sx * halfW, z), heightAt(x + sx * halfW, z + L));
      const F = new Frame([x + sx * (halfW + 0.2), 0, z + L / 2], [0, 0, 1], [0, 1, 0], [-1 * sx * 0 + sx, 0, 0]);
      chamferBox(K, F, -L / 2, L / 2, g - 0.3, g + 0.22, -0.2, 0.2, 0.03, blockColor(rng, STONE_COL), 63 - 8);
      z += L;
    }
  }
  ctx.footprints.addRect(x, (z0 + z1) / 2, halfW + 0.5, (z1 - z0) / 2, 0, 'acro-way');
}

/**
 * Exedra: semicircular stepped stone bench with a back wall and statue pedestals, opening toward
 * compass heading `facing`. F at the centre of the circle.
 */
export function exedra(ctx, x, z, facing, R, rng) {
  const { S, slots } = ctx;
  const F = frameFacing(x, 0, z, facing);
  const g0 = heightAt(x, z);
  let gmax = -Infinity;
  for (let a = 0; a <= Math.PI; a += Math.PI / 8) { const p = F.p(Math.cos(a) * R, 0, -Math.sin(a) * R); gmax = Math.max(gmax, heightAt(p[0], p[2])); }
  const y = Math.max(g0, gmax) + 0.05;
  const B = S.get('marble', x, z);
  const n = Math.max(8, Math.round(R * 3));
  // segments: platform, seat, back
  for (let i = 0; i < n; i++) {
    const a0 = (Math.PI * i) / n, a1 = (Math.PI * (i + 1)) / n;
    const c = blockColor(rng, STONE_COL);
    const P = (a, r, yy) => F.p(Math.cos(a) * r, yy, -Math.sin(a) * r);
    const C = F.p(0, y - 2, 0);
    const ring = (r0, r1, yb, yt, col) => {
      B.quadOut(P(a0, r0, yt), P(a1, r0, yt), P(a1, r1, yt), P(a0, r1, yt), col, C);              // top
      B.quadOut(P(a0, r0, yb), P(a1, r0, yb), P(a1, r0, yt), P(a0, r0, yt), darker(col, 0.92), F.p(0, (yb + yt) / 2, 0)); // inner face
      B.quadOut(P(a0, r1, yt), P(a1, r1, yt), P(a1, r1, yb), P(a0, r1, yb), darker(col, 0.9), F.p(0, (yb + yt) / 2, 0)); // outer face (oriented away from centre)
    };
    ring(R - 1.6, R + 1.0, y - 0.6, y + 0.16, c);          // platform step
    ring(R - 0.15, R + 0.45, y + 0.16, y + 0.62, darker(c, 1.02)); // seat
    ring(R + 0.45, R + 0.95, y + 0.16, y + 1.55, c);        // back wall
    ring(R + 0.4, R + 1.02, y + 1.55, y + 1.68, darker(c, 1.03)); // back coping
  }
  // end pedestals with statues + a central one behind the back wall
  for (const a of [0, Math.PI]) {
    const p = F.p(Math.cos(a) * (R + 0.2), 0, -Math.sin(a) * (R + 0.2) + 0.6);
    const Fp = frameFacing(p[0], 0, p[2], facing);
    const yTop = pedestal(S, 'marble', Fp, y + 0.16, 1.1, 1.7, rng, { faces: ['front'] });
    slots.statue.push({ pos: [p[0], yTop, p[2]], facing, size: 2.3 + rng.range(-0.1, 0.3), tag: 'acro-exedra' });
  }
  const pc = F.p(0, 0, -(R + 1.6));
  const Fc = frameFacing(pc[0], 0, pc[2], facing);
  const yC = pedestal(S, 'marble', Fc, y + 0.16, 1.4, 2.4, rng, { faces: ['front'] });
  slots.statue.push({ pos: [pc[0], yC, pc[2]], facing, size: 2.9, tag: 'acro-exedra' });
  slots.urn.push({ pos: F.p(-R * 0.55, y + 0.62, -R * 0.62), facing, size: 0.9, tag: 'acro-exedra' });
  ctx.footprints.addCircle(x, z, R + 2, 'acro-exedra');
}

/** circular fountain: moulded basin, water disc, central column with a bowl (urn slot on top) */
export function fountain(ctx, x, z, R, rng, waterMat) {
  const { S, slots } = ctx;
  let gmax = -Infinity;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) gmax = Math.max(gmax, heightAt(x + Math.cos(a) * R, z + Math.sin(a) * R));
  const y = gmax + 0.05;
  const B = S.get('marble', x, z);
  const n = Math.max(16, Math.round(R * 6));
  const C = [x, y - 3, z];
  for (let i = 0; i < n; i++) {
    const a0 = (Math.PI * 2 * i) / n, a1 = (Math.PI * 2 * (i + 1)) / n;
    const c = blockColor(rng, STONE_COL);
    const P = (a, r, yy) => [x + Math.cos(a) * r, yy, z + Math.sin(a) * r];
    const Cin = [x, y + 0.3, z];
    // rim: outer face, top (rounded via 2 facets), inner face
    B.quadOut(P(a0, R + 0.35, y - 0.4), P(a1, R + 0.35, y - 0.4), P(a1, R + 0.35, y + 0.55), P(a0, R + 0.35, y + 0.55), c, [x, y + 0.1, z]);
    B.quadOut(P(a0, R + 0.35, y + 0.55), P(a1, R + 0.35, y + 0.55), P(a1, R + 0.15, y + 0.68), P(a0, R + 0.15, y + 0.68), darker(c, 1.03), C);
    B.quadOut(P(a0, R + 0.15, y + 0.68), P(a1, R + 0.15, y + 0.68), P(a1, R - 0.05, y + 0.6), P(a0, R - 0.05, y + 0.6), c, C);
    B.quadOut(P(a0, R - 0.05, y + 0.6), P(a1, R - 0.05, y + 0.6), P(a1, R - 0.05, y + 0.1), P(a0, R - 0.05, y + 0.1), darker(c, 0.8), [x + Math.cos((a0 + a1) / 2) * (R + 3), y + 0.3, z + Math.sin((a0 + a1) / 2) * (R + 3)]);
    void Cin;
  }
  // water surface
  if (waterMat) {
    const wg = new THREE.CircleGeometry(R - 0.04, 40).rotateX(-Math.PI / 2);
    const wm = new THREE.Mesh(wg, waterMat);
    wm.position.set(x, y + 0.45, z); wm.castShadow = false; wm.userData.castShadow = false; wm.name = 'acro:fountain-water';
    (ctx.extra = ctx.extra || []).push(wm);
  }
  // central column + bowl
  const F = frameFacing(x, 0, z, 0);
  const top = pedestal(S, 'marble', F, y + 0.1, 0.7, 1.6, rng, { faces: ['front', 'back', 'left', 'right'], wreath: false });
  slots.urn.push({ pos: [x, top, z], facing: 0, size: 0.9, tag: 'acro-fountain' });
  ctx.footprints.addCircle(x, z, R + 0.6, 'acro-fountain');
  return y;
}

export function fountainWaterMaterial() {
  return new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.05, 0.16, 0.17), roughness: 0.06, metalness: 0, ior: 1.33, name: 'acro-fountain-water' });
}
