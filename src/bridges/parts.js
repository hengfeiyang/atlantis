// Small bridge parts: monumental stairs, approach ramps, rubble, cutwaters, fallen tholos debris.
// OWNER: bridges agent.
import { heightAt } from '../world/heightfield.js';
import { ruinRand } from '../world/era.js';
import { AUX, boxA, hexa, lathe, surface, hash3, urnFinial, triOut } from './kit.js';

const PI = Math.PI;
const gW = (kit, x, z) => { const p = kit.W(x, 0, z); return heightAt(p[0], p[2]); };

/** pile of tumbled ashlar blocks centred at local (x, y, z) */
export function rubble(kit, x, y, z, size, n, label) {
  const w = kit.mb.white;
  for (let i = 0; i < n; i++) {
    const r = (k) => ruinRand(`${label}:${i}`, k);
    const sx = size * (0.6 + 0.8 * r(0)), sy = size * (0.4 + 0.5 * r(1)), sz = size * (0.5 + 0.7 * r(2));
    const ox = (r(3) - 0.5) * size * 3, oz = (r(4) - 0.5) * size * 3;
    w.push(); w.translate(x + ox, y + sy * 0.3, z + oz); w.rotateY(r(5) * PI); w.rotateX((r(6) - 0.5) * 0.9); w.rotateZ((r(7) - 0.5) * 0.9);
    boxA(w, -sx / 2, -sy / 2, -sz / 2, sx / 2, sy / 2, sz / 2, AUX.ashlar(0.8), 0.06);
    w.pop();
    if (kit.sunken && i % 2 === 0) kit.coralAt(x + ox, y + sy * 0.8, z + oz, 0, 1, 0, size * 0.5, 'bridge-rubble');
  }
}

/**
 * Monumental stair along local x from x0 going in direction dir (±1), from yTop down to the terrain.
 * Solid steps (from the ground up), stepped cheek walls with coping, end pedestals.
 */
export function stairsX(kit, x0, dir, yTop, yEnd, halfW, o = {}) {
  const w = kit.mb.white, lime = kit.mb.lime;
  const riser = o.riser ?? 0.19, tread = o.tread ?? 0.42;
  const cheek = o.cheek ?? 1.6;
  const n = Math.max(1, Math.ceil((yTop - yEnd) / riser));
  const rz = (yTop - yEnd) / n;
  let lastX = x0;
  for (let i = 0; i < n; i++) {
    const xa = x0 + dir * i * tread, xb = x0 + dir * (i + 1) * tread;
    const top = yTop - (i + 1) * rz;
    const g = Math.min(gW(kit, xa, 0), gW(kit, xb, halfW), gW(kit, xb, -halfW));
    boxA(lime, Math.min(xa, xb), Math.min(g, top) - 1.2, -halfW, Math.max(xa, xb) + 0.02, top, halfW, i % 9 === 0 ? AUX.mould : [0, 0, 0.1, 0], 0.015);
    lastX = xb;
  }
  // cheek walls (stepped every 6 steps)
  const k = 6;
  for (let i = 0; i < n; i += k) {
    const xa = x0 + dir * i * tread, xb = x0 + dir * Math.min(n, i + k) * tread;
    const top = yTop - Math.min(n, i + k) * rz + 1.25;
    for (const s of [-1, 1]) {
      const z0 = s > 0 ? halfW : -halfW - cheek, z1 = s > 0 ? halfW + cheek : -halfW;
      const g = Math.min(gW(kit, xa, (z0 + z1) / 2), gW(kit, xb, (z0 + z1) / 2));
      boxA(w, Math.min(xa, xb), g - 1.2, z0, Math.max(xa, xb), top, z1, AUX.ashlar(0.8), 0.02);
      boxA(w, Math.min(xa, xb) - 0.02, top, z0 - 0.08, Math.max(xa, xb) + 0.02, top + 0.22, z1 + 0.08, AUX.mould, 0.03);
    }
  }
  // end pedestals with gilt urn finials at the bottom
  for (const s of [-1, 1]) {
    const zc = s * (halfW + cheek / 2), xe = lastX + dir * 0.6;
    const g = gW(kit, xe, zc);
    boxA(w, xe - 1.0, g - 0.5, zc - 1.0, xe + 1.0, g + 2.4, zc + 1.0, AUX.ashlar(0.7), 0.03);
    boxA(w, xe - 1.15, g + 2.4, zc - 1.15, xe + 1.15, g + 2.7, zc + 1.15, AUX.mould, 0.03);
    if (!kit.sunken) urnFinial(kit.mb.gold, xe, g + 2.7, zc, 1.5, 12);
    else kit.coralAt(xe, g + 2.7, zc, 0, 1, 0, 0.7, 'stair-pedestal');
  }
  kit.footprints.push({ type: 'rect', ...rectFromLocal(kit, x0, lastX, halfW + cheek + 1.5), tag: 'bridge-stair' });
  return lastX;
}

/**
 * Approach from a tower's land-side face at local x0 (deck height yDeck) going in direction dir until the
 * terrain is met (ramped steps, max slope 0.42). Returns the end x.
 */
export function approach(kit, x0, dir, yDeck, halfW, o = {}) {
  const lime = kit.mb.lime, w = kit.mb.white;
  const tread = 0.45, maxRise = 0.19;
  let y = yDeck, x = x0;
  const steps = [];
  if (o.to) {
    // straight flight to a fixed landing (e.g. a citadel ledge)
    const n = Math.max(1, Math.round(Math.abs(o.to.x - x0) / tread));
    for (let i = 0; i < n; i++) { const xa = x0 + (o.to.x - x0) * (i / n), xb = x0 + (o.to.x - x0) * ((i + 1) / n); steps.push([xa, xb, yDeck + (o.to.y - yDeck) * ((i + 1) / n)]); }
    x = o.to.x;
  }
  for (let i = 0; i < 160 && !o.to; i++) {
    const g = gW(kit, x + dir * tread, 0);
    if (Math.abs(g - y) < 0.12 && i > 0) break;
    const dy = Math.max(-maxRise, Math.min(maxRise, g - y));
    y += dy;
    steps.push([x, x + dir * tread, y]);
    x += dir * tread;
    if (i > 2 && Math.abs(g - y) < 0.05) break;
  }
  for (const [xa, xb, top] of steps) {
    const g = Math.min(gW(kit, xa, -halfW), gW(kit, xa, halfW), gW(kit, xb, 0));
    boxA(lime, Math.min(xa, xb), Math.min(g, top) - 1.5, -halfW, Math.max(xa, xb) + 0.02, top, halfW, [0, 0, 0.1, 0], 0.01);
  }
  // low cheek walls along long approaches
  if (steps.length > 6) {
    for (let i = 0; i < steps.length; i += 5) {
      const s0 = steps[i], s1 = steps[Math.min(steps.length - 1, i + 4)];
      const top = Math.max(s0[2], s1[2]) + 1.0;
      for (const s of [-1, 1]) {
        const g = Math.min(gW(kit, s0[0], s * (halfW + 0.4)), gW(kit, s1[1], s * (halfW + 0.4)));
        boxA(w, Math.min(s0[0], s1[1]), Math.min(g, top - 1) - 1.0, s > 0 ? halfW : -halfW - 0.8, Math.max(s0[0], s1[1]), top, s > 0 ? halfW + 0.8 : -halfW, AUX.ashlar(0.7), 0.02);
      }
    }
  }
  if (steps.length) kit.footprints.push({ type: 'rect', ...rectFromLocal(kit, x0, x, halfW + 1.5), tag: 'bridge-approach' });
  return x;
}

/** world rect (cx, cz, hw, hd, rotY) for a local x range */
export function rectFromLocal(kit, xa, xb, halfW) {
  const c = kit.W((xa + xb) / 2, 0, 0);
  return { cx: c[0], cz: c[2], hw: Math.abs(xb - xa) / 2 + 0.5, hd: halfW, rotY: kit.rotY };
}

/** pointed cutwater on a pier face (local z = zf, facing f) between x0..x1, from yBot to yTop with a capped top */
export function cutwater(kit, x0, x1, zf, f, yBot, yTop) {
  const w = kit.mb.white;
  const xc = (x0 + x1) / 2, hw = (x1 - x0) / 2, ext = Math.min(hw * 1.2, 3.2);
  const C = [
    [x0, yBot, zf], [x1, yBot, zf], [x0, yTop, zf], [x1, yTop, zf],
    [xc - 0.01, yBot, zf + f * ext], [xc + 0.01, yBot, zf + f * ext], [xc - 0.01, yTop, zf + f * ext], [xc + 0.01, yTop, zf + f * ext],
  ];
  hexa(w, C, AUX.ashlar(0.8));
  // pyramidal cap
  const ap = [xc, yTop + Math.min(hw * 0.9, 1.4), zf + f * ext * 0.25];
  const pts = [[x0 - 0.1, yTop, zf], [xc, yTop, zf + f * (ext + 0.15)], [x1 + 0.1, yTop, zf]];
  triOut(w, pts[0], pts[1], ap, [-0.5, 1, f], AUX.mould); triOut(w, pts[1], pts[2], ap, [0.5, 1, f], AUX.mould);
  return ap;
}

/** fallen tholos top: gold dome tipped over half-buried + scattered column drums (sunken) */
export function fallenTholos(kit, x, y, z, R, label) {
  const g = kit.mb.gold, w = kit.mb.white;
  const r = (k) => ruinRand(label, k);
  g.push(); g.translate(x, y + R * 0.15, z); g.rotateY(r(0) * PI * 2); g.rotateZ(1.2 + r(1) * 0.5);
  surface(g, (u, v, out) => {
    const a = u * 2 * PI, t = v * PI * 0.5;
    const rr = R * 0.86 * Math.cos(t);
    out[0] = Math.sin(a) * rr; out[1] = R * 0.42 * Math.sin(t); out[2] = Math.cos(a) * rr;
  }, 40, 10, { closedU: true, aux: [0.3, 0, 0, 0] });
  g.pop();
  for (let i = 0; i < 7; i++) {
    const dx = (r(10 + i) - 0.5) * R * 3, dz = (r(20 + i) - 0.5) * R * 3;
    const L = R * (0.25 + 0.35 * r(30 + i)), rad = R * 0.085;
    w.push(); w.translate(x + dx, y + rad * 0.9, z + dz); w.rotateY(r(40 + i) * PI); w.rotateZ(PI / 2);
    lathe(w, [[0, -L / 2], [rad, -L / 2, 0, 0, true], [rad * 0.97, L / 2, 0, 0, true], [0, L / 2]], 12, { aux: [0.1, 0, 0, 1.2] });
    w.pop();
    kit.coralAt(x + dx, y + rad * 2, z + dz, 0, 1, 0, rad * 2, 'fallen-drum');
  }
  rubble(kit, x, y, z, R * 0.18, 6, label + ':r');
}
export { hash3 };
