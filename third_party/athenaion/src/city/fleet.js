// Ship placement: moored stern-to along the quays and moles, a few at anchor in the basin, ships
// under sail out in the bay (yards braced to a common wind), triremes hauled up in the ship sheds,
// and the boat with the navy/gold sail at the tholos island pier (ref 2).
import { heightAt } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { buildShip, shipMatrix, rope } from './ships.js';
import { Frame } from './geobuilder.js';
import { stoneBox, column } from './house.js';
import { WK, WOOD_ATTRS, SAIL_ATTRS } from './shipmats.js';
import { GeoBuilder } from './geobuilder.js';
import * as THREE from 'three';

const WIND_TO = [0.55, 0.835]; // wind blowing toward the south-south-east (from the NNW)

function yardFor(rot) {
  // world downwind → ship-local, then the yard yaw that faces the sail to the wind
  const c = Math.cos(rot), s = Math.sin(rot);
  const lx = WIND_TO[0] * c - WIND_TO[1] * s, lz = WIND_TO[0] * s + WIND_TO[1] * c;
  const ang = Math.atan2(lx, lz);
  if (Math.abs(ang) > 1.9) return null; // head-to-wind: rowing
  return Math.max(-1.0, Math.min(1.0, ang));
}

export function placeFleet(getB, harbour, engine, rng, density = 1) {
  const placed = [];
  const clear = (x, z, r) => placed.every((p) => Math.hypot(p[0] - x, p[1] - z) > p[2] + r);
  const put = (type, x, z, rot, o = {}) => {
    const B = getB(x, z);
    const seed = rng.random();
    const sailState = o.sailState ?? 'furled';
    const yardYaw = sailState === 'set' ? (o.yardYaw ?? yardFor(rot) ?? 0) : rng.range(-0.15, 0.15);
    const heel = o.heel ?? 0;
    const m = shipMatrix(x, o.y ?? 0.0, z, rot, heel, o.pitch ?? 0);
    const r = buildShip(B.wood, B.sail, m, { type, seed, sailState, yardYaw, sailKind: o.sailKind ?? (rng.chance(0.25) ? 1 : rng.chance(0.12) ? 3 : 0), oarsOut: !!o.oarsOut, scale: o.scale ?? rng.range(0.92, 1.08), oarCount: o.oarCount, belly: o.belly }, rng);
    placed.push([x, z, Math.max(r.L, 6) * 0.5]);
    return r;
  };
  let n = 0;
  // moored along quays and moles (stern to the quay, bow out)
  for (const m of harbour.moorings || []) {
    if (!rng.chance(0.62 * Math.min(1, 0.6 + density * 0.4))) continue;
    const r = rng.random();
    const type = m.mole !== undefined && r < 0.2 ? 'trireme' : r < 0.62 ? 'merchant' : 'boat';
    const len = type === 'trireme' ? 36 : type === 'merchant' ? 19 : 8;
    const fx = Math.sin(m.heading), fz = Math.cos(m.heading);
    const x = m.x + fx * (len / 2 + 1.2), z = m.z + fz * (len / 2 + 1.2);
    if (heightAt(x, z) > -1.2 || heightAt(m.x + fx * (len + 2), m.z + fz * (len + 2)) > -0.8) continue;
    if (!clear(x, z, type === 'boat' ? 3.5 : 5)) continue;
    if (m.bollard) {
      const sx2 = Math.cos(m.heading), sz2 = -Math.sin(m.heading);
      const back = len / 2 - 0.6;
      for (const sd of [-1, 1]) {
        const tx = x - fx * back + sx2 * sd * 1.1, tz = z - fz * back + sz2 * sd * 1.1;
        rope(getB(x, z), m.bollard, [tx, type === 'boat' ? 0.9 : 1.9, tz], 0.35, rng.random());
      }
    }
    put(type, x, z, m.heading + rng.range(-0.08, 0.08), { sailState: type === 'boat' && rng.chance(0.5) ? 'none' : rng.chance(type === 'merchant' ? 0.4 : 0.15) ? 'set' : 'furled', belly: 0.11, heel: 0 });
    // rafted alongside: a second, smaller hull next to it
    if (type !== 'trireme' && rng.chance(0.25)) {
      const sx = Math.cos(m.heading), sz = -Math.sin(m.heading);
      const off = (type === 'merchant' ? 6.5 : 3.2) * rng.sign();
      const x2 = x + sx * off - fx * 1.5, z2 = z + sz * off - fz * 1.5;
      if (heightAt(x2, z2) < -1.2 && clear(x2, z2, 2.5)) put('boat', x2, z2, m.heading + rng.range(-0.15, 0.15), { sailState: rng.chance(0.5) ? 'none' : 'furled' });
    }
    n++;
  }
  // at anchor in the basin
  const C = harbour.basinCenter;
  if (C) {
    for (let i = 0; i < 40 && n < 200; i++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(20, 150);
      const x = C[0] + Math.cos(a) * d, z = C[1] + Math.sin(a) * d;
      if (heightAt(x, z) > -3) continue;
      if (!clear(x, z, 14)) continue;
      if ((harbour.moleLines || []).some((ln) => ln.some((p) => Math.hypot(p[0] - x, p[1] - z) < 22))) continue;
      put(rng.chance(0.7) ? 'merchant' : 'boat', x, z, rng.range(-Math.PI, Math.PI), { sailState: rng.chance(0.3) ? 'set' : 'furled', heel: 0 });
      n++;
      if (i > 12 && rng.chance(0.4)) break;
    }
  }
  // under sail in the bay
  const bay = L.SEA.bay;
  for (let i = 0; i < 60; i++) {
    const x = bay.center[0] + rng.range(-0.75, 0.75) * bay.radii[0], z = bay.center[1] + rng.range(-0.55, 0.75) * bay.radii[1];
    if (heightAt(x, z) > -8) continue;
    if (!clear(x, z, 60)) continue;
    if ((harbour.moleLines || []).some((ln) => ln.some((p) => Math.hypot(p[0] - x, p[1] - z) < 60))) continue;
    const tri = rng.chance(0.3);
    const rot = rng.range(-Math.PI, Math.PI);
    const yy = yardFor(rot);
    put(tri ? 'trireme' : 'merchant', x, z, rot, { sailState: yy === null ? 'furled' : 'set', oarsOut: tri, heel: yy === null ? 0 : rng.range(0.03, 0.08) * Math.sign(yy || 1), oarCount: 20 });
    n++;
    if (n > 60) break;
  }
  // triremes hauled up in the ship sheds (bow toward the sea)
  for (const s of harbour.sheds || []) {
    if (!rng.chance(0.75)) continue;
    const pitch = -Math.atan2(2.6, s.len);
    put('trireme', s.x + Math.sin(s.rot) * 1.5, s.z + Math.cos(s.rot) * 1.5, s.rot, { sailState: 'none', y: 0.9, pitch, scale: 0.86, oarCount: 0 });
  }
  return n;
}

/** boat with the navy/gold sail moored at the tholos island pier (ref 2) + a small pier if none exists */
export function tholosBoat(getB, engine, rng) {
  const I = L.ISLAND;
  const reg = engine.registry;
  const pier = reg.temple?.island?.pier || reg.tholosPier || null;
  let x, z, rot;
  if (pier && pier.start && pier.end) {
    // alongside the temple module's pier, on the side facing the lagoon camera (shot 2)
    const [sx, , sz] = pier.start, [ex, , ez] = pier.end;
    let dx = ex - sx, dz = ez - sz; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    let px = -dz, pz = dx;
    const mx = (sx + ex) / 2, mz = (sz + ez) / 2;
    // ref 2: the boat lies on the FAR side of the pier, toward its end (left of the tholos, at its depth)
    if ((-19 - mx) * px + (227 - mz) * pz > 0) { px = -px; pz = -pz; }
    const off = (pier.width ?? 3.6) / 2 + 1.35 + 0.45;
    x = mx + dx * 3.5 + px * off; z = mz + dz * 3.5 + pz * off;
    rot = Math.atan2(dx, dz);
  } else {
    // our own little stone jetty on the west side of the island, toward the lagoon shots
    const x0 = I.center[0] - I.radius - 2, zc = I.center[1] + 4;
    let xEnd = x0 - 16;
    const B = getB(x0, zc);
    const F = new Frame((x0 + xEnd) / 2, 0, zc, 0);
    const len = Math.abs(xEnd - x0);
    stoneBox(B, F, 0, 0, len / 2 + 3, 1.7, -3, 1.25, 5, 0.37, 63);
    stoneBox(B, F, 0, 0, len / 2 + 3.1, 1.8, 1.25, 1.45, 3, 0.37, 63);
    // stone posts (bollards / balustrade piers) along the edge
    for (let k = 0; k <= 5; k++) {
      const px = -len / 2 - 2.5 + (k * (len + 5)) / 5;
      for (const side of [-1, 1]) {
        stoneBox(B, F, px, side * 1.45, 0.22, 0.22, 1.45, 2.35, 3, 0.37, 31);
        column(B, F, px, side * 1.45, 0.2, 0.16, 2.35, 2.6, 6, 0.37, 3);
      }
    }
    engine.footprints.addRect(F.x, F.z, len / 2 + 3, 1.8, 0, 'city');
    reg.tholosPier = { x: F.x, y: 1.45, z: F.z, rotY: -Math.PI / 2, length: len, builtBy: 'city' };
    x = F.x - 1.5; z = zc + 3.4; rot = -Math.PI / 2;
  }
  const B = getB(x, z);
  buildShip(B.wood, B.sail, shipMatrix(x, 0.05, z, rot, 0.03, 0), { type: 'tholos', seed: 0.618, sailState: 'loose', sailKind: 2, yardYaw: 0.95, scale: 1 }, rng);
  return { x, z, rot };
}
export { WK };

/**
 * Ships of the lagoon port (src/city/port.js): moored stern-to along the west quay, at anchor in
 * the west basin and under sail across it (ref 1: the harbour full of ships, lower left of shot 1).
 * Smaller coasters than the sea harbour: they read at the ref's scale from the panorama.
 */
export function placePortFleet(getB, port, engine, rng, density = 1) {
  const placed = [];
  const fp = engine.footprints;
  const clear = (x, z, r) => placed.every((p) => Math.hypot(p[0] - x, p[1] - z) > p[2] + r);
  const quay = port.quay?.outer || [];
  const quayD = (x, z) => { let b = Infinity; for (const p of quay) b = Math.min(b, Math.hypot(p[0] - x, p[1] - z)); return b; };
  const deep = (x, z, r) => heightAt(x, z) < -2.2 && heightAt(x + r, z) < -1.5 && heightAt(x - r, z) < -1.5 && heightAt(x, z + r) < -1.5 && heightAt(x, z - r) < -1.5;
  const put = (type, x, z, rot, o = {}) => {
    const B = getB(x, z);
    const sailState = o.sailState ?? 'furled';
    const yardYaw = sailState === 'set' ? (o.yardYaw ?? yardFor(rot) ?? 0) : rng.range(-0.15, 0.15);
    const m = shipMatrix(x, o.y ?? 0.0, z, rot, o.heel ?? 0, o.pitch ?? 0);
    const r = buildShip(B.wood, B.sail, m, { type, seed: rng.random(), sailState, yardYaw, sailKind: o.sailKind ?? (rng.chance(0.1) ? 1 : rng.chance(0.12) ? 3 : 0), oarsOut: !!o.oarsOut, scale: o.scale ?? 1, oarCount: o.oarCount, belly: o.belly }, rng);
    placed.push([x, z, Math.max(r.L, 6) * 0.5]);
    return r;
  };
  let n = 0;
  // moored stern-to along the quay, bows out into the basin
  for (const m of port.moorings || []) {
    if (!rng.chance(0.8 * Math.min(1, 0.6 + density * 0.4))) continue;
    const r = rng.random();
    const type = r < 0.5 ? 'merchant' : 'boat';
    const scale = type === 'merchant' ? rng.range(0.68, 0.9) : rng.range(0.95, 1.15);
    const len = (type === 'merchant' ? 19 : 8) * scale;
    const fx = Math.sin(m.heading), fz = Math.cos(m.heading);
    const x = m.x + fx * (len / 2 + 1.0), z = m.z + fz * (len / 2 + 1.0);
    if (heightAt(x, z) > -1.2 || heightAt(m.x + fx * (len + 2), m.z + fz * (len + 2)) > -0.8) continue;
    if (!clear(x, z, type === 'boat' ? 2.6 : 3.6) || !fp.isFree(x, z, len * 0.3)) continue;
    if (m.bollard) {
      const sx2 = Math.cos(m.heading), sz2 = -Math.sin(m.heading);
      const back = len / 2 - 0.6;
      for (const sd of [-1, 1]) rope(getB(x, z), m.bollard, [x - fx * back + sx2 * sd * 1.0, type === 'boat' ? 0.9 : 1.6, z - fz * back + sz2 * sd * 1.0], 0.35, rng.random());
    }
    // ref 1 shows the harbour ships with their linen sails up (drying / about to leave): most set or hanging loose
    const sr = rng.random();
    put(type, x, z, m.heading + rng.range(-0.1, 0.1), { scale, sailState: type === 'boat' && sr < 0.25 ? 'none' : sr < 0.68 ? 'set' : sr < 0.86 ? 'loose' : 'furled', belly: 0.08, yardYaw: rng.range(-0.3, 0.3) });
    n++;
  }
  // under way: ships sailing a slow loop around the west basin (separate meshes, animated by city.js)
  const LOOP = port.loop || { c: [-135, 125], r: [42, 36] };
  const movers = [];
  const nMov = Math.round(4 * Math.min(1, 0.5 + density * 0.5));
  for (let i = 0; i < nMov; i++) {
    const ph = (i / nMov) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const x = LOOP.c[0] + LOOP.r[0] * Math.cos(ph), z = LOOP.c[1] + LOOP.r[1] * Math.sin(ph);
    if (!fp.isFree(x, z, 8) || !deep(x, z, 6)) continue;
    const type = i % 3 === 2 ? 'boat' : 'merchant';
    const scale = type === 'merchant' ? rng.range(0.62, 0.8) : rng.range(1.0, 1.15);
    // counter-clockwise (seen from above): tangent of the loop
    const tx = -LOOP.r[0] * Math.sin(ph), tz = LOOP.r[1] * Math.cos(ph);
    const rot = Math.atan2(tx, tz);
    const yy = yardFor(rot);
    const heel = yy === null ? 0 : rng.range(0.03, 0.065) * Math.sign(yy || 1);
    const wood = new GeoBuilder(WOOD_ATTRS), sail = new GeoBuilder(SAIL_ATTRS);
    const r = buildShip(wood, sail, shipMatrix(0, 0, 0, 0, heel, 0), { type, seed: rng.random(), sailState: yy === null ? 'furled' : 'set', yardYaw: yy ?? 0, sailKind: rng.chance(0.15) ? 1 : 0, scale, belly: 0.17 }, rng);
    placed.push([x, z, Math.max(r.L, 6) * 0.5 + 4]);
    movers.push({ wood, sail, L: r.L, B: r.B, phase: ph, loop: LOOP, speed: rng.range(1.0, 1.6), x, z, rot });
  }
  const loopBand = (x, z) => { const e = Math.hypot((x - LOOP.c[0]) / LOOP.r[0], (z - LOOP.c[1]) / LOOP.r[1]); return Math.abs(e - 1) * Math.min(LOOP.r[0], LOOP.r[1]); };
  // at anchor / under sail in the west basin (kept off the aqueduct piers, the river mouth and the island)
  const tries = [];
  for (let i = 0; i < 160; i++) tries.push([rng.range(-222, -92), rng.range(72, 176)]);
  let nA = 0, nS = 0;
  for (const [x, z] of tries) {
    if (nA + nS >= Math.round(22 * Math.min(1, 0.5 + density * 0.5))) break;
    if (!deep(x, z, 7) || quayD(x, z) < 24 || loopBand(x, z) < 12) continue;
    if (!clear(x, z, 7) || !fp.isFree(x, z, 8)) continue;
    const sail = nS < 2 && rng.chance(0.3);
    const type = rng.chance(sail ? 0.7 : 0.6) ? 'merchant' : 'boat';
    const scale = type === 'merchant' ? rng.range(0.7, 0.92) : rng.range(1.0, 1.2);
    // riding at anchor: bows roughly toward / away from the panorama camera (shot 1) so the square sails read broadside
    let rot = Math.atan2(115 - x, 2 - z) + rng.range(-0.55, 0.55) + (rng.chance(0.4) ? Math.PI : 0);
    if (sail) {
      // under sail: broad reach / running on the NNW wind, heading in or out of the channel mouth
      rot = rng.chance(0.5) ? rng.range(2.3, 2.9) : rng.range(-0.6, 0.2);
      const yy = yardFor(rot);
      put(type, x, z, rot, { scale, sailState: yy === null ? 'furled' : 'set', heel: yy === null ? 0 : rng.range(0.03, 0.07) * Math.sign(yy || 1), belly: 0.16 });
      nS++;
    } else {
      put(type, x, z, rot, { scale, sailState: rng.chance(0.5) ? 'set' : rng.chance(0.4) ? 'loose' : 'furled', belly: 0.1, yardYaw: rng.range(-0.35, 0.35) });
      nA++;
    }
  }
  return { n: n + nA + nS + movers.length, movers };
}

/** meshes + loop animation (and foam wakes) for the ships under way: returns a THREE.Group */
export function portMovers(engine, movers, mats) {
  const g = new THREE.Group(); g.name = 'city-port-movers';
  const wakeMat = wakeMaterial();
  for (const m of movers) {
    const o = new THREE.Group();
    const w = new THREE.Mesh(m.wood.toGeometry(), mats.wood); w.castShadow = true; w.receiveShadow = true; o.add(w);
    if (!m.sail.empty) { const sl = new THREE.Mesh(m.sail.toGeometry(), mats.sail); sl.castShadow = true; sl.receiveShadow = true; o.add(sl); }
    const wk = new THREE.Mesh(wakeGeometry(m.L, m.B), wakeMat); wk.castShadow = false; wk.userData.castShadow = false; wk.renderOrder = 2; o.add(wk);
    g.add(o);
    const set = (t) => {
      const om = m.speed / ((m.loop.r[0] + m.loop.r[1]) / 2);
      const ph = m.phase + t * om;
      const x = m.loop.c[0] + m.loop.r[0] * Math.cos(ph), z = m.loop.c[1] + m.loop.r[1] * Math.sin(ph);
      const tx = -m.loop.r[0] * Math.sin(ph), tz = m.loop.r[1] * Math.cos(ph);
      o.position.set(x, 0.02 * Math.sin(t * 1.3 + m.phase * 5), z);
      o.rotation.set(0.012 * Math.sin(t * 0.9 + m.phase), Math.atan2(tx, tz), 0, 'YXZ');
    };
    set(0);
    engine.onUpdate((t) => set(t));
  }
  return g;
}

/** foam wake: a widening V of churned water trailing from the bow and the stern (local +z = bow) */
function wakeGeometry(L, B) {
  const pos = [], uv = [], idx = [];
  const len = L * 3.2, n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n, z = L * 0.45 - t * (len + L * 0.45);
    const hw = B * 0.55 + t * len * 0.32;
    for (const sx of [-1, 1]) { pos.push(sx * hw, 0.06, z); uv.push(sx < 0 ? 0 : 1, t); }
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  return geo;
}

let WAKE = null;
function wakeMaterial() {
  if (WAKE) return WAKE;
  // alpha: two bright arms along the V edges + a churned centre trail near the stern, streaky, fading out
  const W = 128, H = 256;
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let tex = null;
  if (cv) {
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const img = c.createImageData(W, H);
    let sd = 12345; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    const streak = new Float32Array(W); for (let i = 0; i < W; i++) streak[i] = 0.6 + 0.4 * rnd();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / (W - 1), t = y / (H - 1);
      const edge = Math.exp(-Math.pow((Math.min(u, 1 - u)) / (0.06 + 0.1 * t), 2));
      const centre = Math.exp(-Math.pow((u - 0.5) / (0.07 + 0.12 * t), 2)) * Math.max(0, 1 - t * 1.6);
      const bow = t < 0.12 ? 1.3 : 1;
      let a = (0.75 * edge * bow + 0.8 * centre) * Math.pow(1 - t, 1.6) * streak[x] * (0.75 + 0.25 * rnd());
      a = Math.max(0, Math.min(1, a));
      const k = (y * W + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(a * 255); img.data[k + 3] = 255; // alphaMap reads green
    }
    c.putImageData(img, 0, 0);
    tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace;
  }
  WAKE = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.78, 0.82, 0.82), roughness: 0.9, metalness: 0, transparent: true, depthWrite: false, alphaMap: tex, opacity: tex ? 0.85 : 0.0, polygonOffset: true, polygonOffsetFactor: -2 });
  WAKE.name = 'cityWake';
  return WAKE;
}
