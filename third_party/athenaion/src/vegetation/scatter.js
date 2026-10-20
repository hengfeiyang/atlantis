// World placement of every tree / shrub. Deterministic, terrain-aware (heightAt / slope / waterSDF),
// footprint-aware (engine.footprints from architecture + city + ruins) and composition-aware
// (no tree may cover the protected centre of another shot). Everything is derived from the master
// plan (layout.js) and the terrain at build time, so it follows layout / camera changes.
//   1. hero trees through the reference compositions (pixel → ray → first free land), optional
//   2. rows / slots / gardens published by other modules (acropolis terraces, city streets + yards)
//   3. the acropolis massif: plateau gardens (temple peribolos, rim groves, olive lawns) and every
//      terrace, ledge, bench and cliff of its faces (cypress clusters, round trees, maquis masses)
//   4. island, lagoon / river shores, the hill-temple mount and other crags
//   5. wild land: clumpy forests + clearings + olive orchards, maquis understory
//   6. a far ring of cheap trees toward the mountains
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt, waterSDF, sdPolygon } from '../world/heightfield.js';
import { noiseA, noiseB, noiseC, smoothstep, clamp } from '../core/noise.js';
import { RNG } from '../core/rng.js';
import { SHOTS } from '../world/shots.js';

class Occ {
  constructor(cell = 8) { this.c = cell; this.m = new Map(); }
  _k(i, j) { return i * 100003 + j; }
  add(x, z, r) {
    const i = Math.floor(x / this.c), j = Math.floor(z / this.c), k = this._k(i, j);
    let b = this.m.get(k); if (!b) this.m.set(k, (b = []));
    b.push(x, z, r);
  }
  free(x, z, r) {
    const c = this.c, i0 = Math.floor((x - r - 12) / c), i1 = Math.floor((x + r + 12) / c);
    const j0 = Math.floor((z - r - 12) / c), j1 = Math.floor((z + r + 12) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const b = this.m.get(this._k(i, j)); if (!b) continue;
      for (let q = 0; q < b.length; q += 3) { const dx = b[q] - x, dz = b[q + 1] - z, rr = b[q + 2] + r; if (dx * dx + dz * dz < rr * rr) return false; }
    }
    return true;
  }
}

const A = L.ACROPOLIS;
const acroEdgeNoise = (x, z) => 4 * noiseB.fbm2(x / 45, z / 45, 3) + 1.5 * noiseC.fbm2(x / 12, z / 12, 2);
const acroD = (x, z) => sdPolygon(x, z, A.outline) + acroEdgeNoise(x, z);
const polyBox = (poly, m = 0) => {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0: x0 - m, x1: x1 + m, z0: z0 - m, z1: z1 + m };
};

export function scatterWorld(engine, sys, lib) {
  // the massif fill owns everything within ~165 m of the plateau rim (cheap box test before the noisy SDF)
  const AB = polyBox(A.outline, 172);
  const inMassif = (x, z) => x > AB.x0 && x < AB.x1 && z > AB.z0 && z < AB.z1 && acroD(x, z) < 165;
  const t0 = performance.now();
  const q = engine.quality;
  const P = engine.params;
  const D = clamp(Number(P?.get?.('vegDensity')) || (q.density ?? 1), 0.1, 2);
  const fp = engine.footprints;
  const occ = new Occ(8);
  const R = new RNG('veg-scatter-v2');
  const st = { cypress: 0, olive: 0, broad: 0, pine: 0, shrub: 0, thicket: 0 };
  const TS = {}; let tLast = performance.now(), sLast = 'setup';
  const stage = (n) => { const t = performance.now(); TS[sLast] = Math.round(t - tLast); tLast = t; sLast = n; };
  const tag = { hero: 0, rows: 0, garden: 0, terrace: 0, plateau: 0, face: 0, cliff: 0, bench: 0, island: 0, shore: 0, crag: 0, city: 0, wild: 0, under: 0, carpet: 0, far: 0 };

  // ------------------------------------------------------------------ exclusions from the master plan
  const EX = [];
  const T = L.TEMPLE;
  // temple frame: axis unit vector toward the front (compass heading; legacy layouts: long axis along X, front -X)
  const TF = T ? (() => { const hd = T.heading ?? 270, a = (hd * Math.PI) / 180; return { x: T.center[0], z: T.center[2], fx: Math.sin(a), fz: -Math.cos(a), hl: T.stylobate[0] / 2, hw: T.stylobate[1] / 2 }; })() : null;
  if (TF) EX.push({ t: 'o', x: TF.x, z: TF.z, fx: TF.fx, fz: TF.fz, hl: TF.hl + 5, hw: TF.hw + 5 });
  for (const c of L.COLOSSI || []) EX.push({ t: 'c', x: c.pos[0], z: c.pos[2], r: c.pedestal * 0.9 + 7 });   // keep the colossi readable
  const G = L.GRAND_STAIR;
  if (G) EX.push({ t: 'r', x: G.x, z: (G.zTop + G.zBottom) / 2, hw: (Math.max(G.width, ...(G.widths || [0]))) / 2 + 2, hd: Math.abs(G.zBottom - G.zTop) / 2 + 3 });
  for (const w of L.WATERFALLS || []) {
    const az = (w.dir * Math.PI) / 180, dx = Math.sin(az), dz = -Math.cos(az);
    EX.push({ t: 'c', x: w.from[0], z: w.from[2], r: w.width * 0.6 + 1.5 });
    EX.push({ t: 's', ax: w.from[0], az: w.from[2], bx: w.from[0] + dx * 30, bz: w.from[2] + dz * 30, r: w.width * 0.35 + 1.5 });
  }
  for (const a of L.AQUEDUCTS || []) EX.push({ t: 's', ax: a.a[0], az: a.a[1], bx: a.b[0], bz: a.b[1], r: (a.width || 8) * 0.5 + 3 });
  if (L.ISLAND) EX.push({ t: 'c', x: L.ISLAND.center[0], z: L.ISLAND.center[1], r: Math.min(12, L.ISLAND.radius * 0.5) });
  if (L.HILL_TEMPLE) EX.push({ t: 'c', x: L.HILL_TEMPLE.center[0], z: L.HILL_TEMPLE.center[1], r: 26 });
  // behind-left of camera 8, on the sun ray: a crown there shades the whole shot-8 foreground ledge
  EX.push({ t: 'c', x: 127.6, z: 146, r: 7 });
  const RT = L.RUINS_TERRACE;
  const inRuins = RT ? (RT.outline ? (x, z) => sdPolygon(x, z, RT.outline) < -4 : (x, z) => Math.hypot(x - RT.center[0], z - RT.center[1]) < RT.radius * 0.6) : () => false;
  // colossi stay readable even next to rows supplied by other modules
  const COL = (L.COLOSSI || []).map((c) => ({ x: c.pos[0], z: c.pos[2], r: c.pedestal * 0.9 + 7 }));
  const nearColossus = (x, z) => COL.some((c) => Math.hypot(x - c.x, z - c.z) < c.r);
  const excluded = (x, z, r) => {
    for (const e of EX) {
      if (e.t === 'c') { if (Math.hypot(x - e.x, z - e.z) < e.r + r) return true; }
      else if (e.t === 'r') { if (Math.abs(x - e.x) < e.hw + r && Math.abs(z - e.z) < e.hd + r) return true; }
      else if (e.t === 'o') { const dx = x - e.x, dz = z - e.z; if (Math.abs(dx * e.fx + dz * e.fz) < e.hl + r && Math.abs(-dx * e.fz + dz * e.fx) < e.hw + r) return true; }
      else {
        const ex = e.bx - e.ax, ez = e.bz - e.az, l2 = ex * ex + ez * ez;
        const t = clamp(((x - e.ax) * ex + (z - e.az) * ez) / l2, 0, 1);
        if (Math.hypot(x - e.ax - ex * t, z - e.az - ez * t) < e.r + r) return true;
      }
    }
    return inRuins(x, z);
  };

  const ground = (x, z) => {
    const h = heightAt(x, z), e = 1.2;
    const gx = (heightAt(x + e, z) - h) / e, gz = (heightAt(x, z + e) - h) / e;
    return { h, gx, gz, slope: 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz) };
  };
  // coarse (≈5 m) slope: separates real ledges / benches from noise on cliff faces
  const slope5 = (x, z) => {
    const e = 4;
    const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
  };

  // height drop just outward of a point (lip of a ledge / bench): h - lowest ground 3.5 m away
  const dropNear = (x, z, h) => h - Math.min(heightAt(x + 3.5, z), heightAt(x - 3.5, z), heightAt(x, z + 3.5), heightAt(x, z - 3.5));

  // (r5) wider per-tree value variation (some crowns darker, some sun-yellowed): at a distance the
  // tree-to-tree contrast is what reads as detail; channels stay correlated (no hue noise)
  const vary = (lo, hi, c) => { const v = R.range(lo, hi); return [v * R.range(c[0], c[1]), v * R.range(c[2], c[3]), v * R.range(c[4], c[5])]; };
  const TINT = {
    cypress: () => (R.random() < 0.25 ? vary(0.72, 0.86, [0.95, 1.03, 0.97, 1.03, 0.95, 1.05]) : vary(0.92, 1.1, [0.94, 1.04, 0.96, 1.02, 0.88, 1.0])),
    olive: () => [R.range(0.92, 1.06), R.range(0.94, 1.05), R.range(0.9, 1.06)],
    broad: () => { const k = R.random(); return k < 0.18 ? [R.range(1.05, 1.18), R.range(1.0, 1.1), R.range(0.75, 0.9)] : k < 0.36 ? vary(0.72, 0.85, [0.95, 1.02, 0.97, 1.03, 0.95, 1.08]) : [R.range(0.85, 1.05), R.range(0.9, 1.08), R.range(0.82, 1.05)]; },
    pine: () => [R.range(0.9, 1.06), R.range(0.92, 1.06), R.range(0.85, 1.0)],
    thicket: () => { const k = R.random(); return k < 0.2 ? [R.range(1.05, 1.18), R.range(0.98, 1.08), R.range(0.75, 0.88)] : [R.range(0.85, 1.05), R.range(0.9, 1.06), R.range(0.82, 1.0)]; },
    shrub: () => { const k = R.random(); return k < 0.15 ? [R.range(1.08, 1.25), R.range(0.95, 1.08), R.range(0.7, 0.85)] : k < 0.3 ? [R.range(0.9, 1.0), R.range(0.95, 1.05), R.range(0.95, 1.1)] : [R.range(0.85, 1.08), R.range(0.88, 1.08), R.range(0.8, 1.0)]; },
  };
  const SCALE = {
    cypress: () => clamp(R.gauss(0.98, 0.18), 0.55, 1.4),
    olive: () => R.range(0.75, 1.25),
    broad: () => R.range(0.7, 1.3),
    pine: () => R.range(0.8, 1.35),
    shrub: () => R.range(0.5, 1.9),
    thicket: () => R.range(0.7, 1.3),
  };
  const radiusOf = (kind, v, s) => (kind === 'cypress' ? Math.max(1.1, v.R * s * 0.9) : kind === 'shrub' || kind === 'thicket' ? v.R * s * 0.55 : v.R * s * 0.62);
  const pick = (kind) => { const set = lib[kind]; return set[Math.floor(R.random() * set.length)]; };
  /** weighted kind choice: {cypress: 3, broad: 2, ...} */
  const pickW = (w) => { let s = 0; for (const k in w) s += w[k]; let r = R.random() * s; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; };

  // ------------------------------------------------------------------ shot cameras (composition guard)
  const W = 1672, H = 941;
  const camOf = (id) => {
    const s = SHOTS.find((sh) => String(sh.id) === String(id));
    if (!s) return null;
    const cam = new THREE.PerspectiveCamera(s.fov, W / H, 0.1, 60000);
    cam.position.set(...s.pos); cam.lookAt(new THREE.Vector3(...s.target)); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    return cam;
  };
  const rayOf = (cam, px, py) => new THREE.Vector3((px / W) * 2 - 1, -((py / H) * 2 - 1), 0.5).unproject(cam).sub(cam.position).normalize();
  const CAMS = SHOTS.map((s) => ({ id: s.id, cam: camOf(s.id), p: s.pos, dT: Math.hypot(s.target[0] - s.pos[0], s.target[1] - s.pos[1], s.target[2] - s.pos[2]) }));
  const _v = new THREE.Vector3();
  /** would a tree (base y0, height h, radius r) cover the protected centre of a shot (or come too close to its lens)? */
  function blocksShots(x, y0, z, h, r, own) {
    for (const c of CAMS) {
      if (c.id === own) continue;
      const d = Math.hypot(x - c.p[0], z - c.p[2]);
      if (d < r + 2.5 && y0 < c.p[1] + 2 && y0 + h > c.p[1] - 3) return true;      // never inside / against the lens
      // only the camera's near field matters: farther trees are part of the scene (as in the refs)
      const d3 = Math.hypot(d, (y0 + h * 0.5) - c.p[1]);
      if (d3 > Math.max(45, 0.4 * c.dT) || (h < 5 && d3 > 25)) continue;
      const Pm = c.cam.projectionMatrix.elements;
      const pr = (y) => { _v.set(x, y, z).applyMatrix4(c.cam.matrixWorldInverse); return { cx: _v.x, cy: _v.y, cz: _v.z }; };
      const b = pr(y0), t = pr(y0 + h);
      if (b.cz > -0.5 && t.cz > -0.5) continue;                       // behind the camera
      const zb = Math.min(-0.5, b.cz), zt = Math.min(-0.5, t.cz);
      const bx = (Pm[0] * b.cx) / -zb, by = (Pm[5] * b.cy) / -zb, tx = (Pm[0] * t.cx) / -zt, ty = (Pm[5] * t.cy) / -zt;
      const w = (Pm[0] * r) / -Math.max(zb, zt);
      const x0 = Math.min(bx, tx) - w, x1 = Math.max(bx, tx) + w, y0n = Math.min(by, ty), y1n = Math.max(by, ty);
      const ox = Math.max(0, Math.min(x1, 0.45) - Math.max(x0, -0.45)), oy = Math.max(0, Math.min(y1n, 0.92) - Math.max(y0n, -0.6));
      if ((ox * oy) / 4 > 0.008) return true;
      // very near the lens: no big dark mass anywhere in the frame (framing trees are placed as heroes)
      if (d3 < 26) {
        const fx = Math.max(0, Math.min(x1, 1) - Math.max(x0, -1)), fy = Math.max(0, Math.min(y1n, 1) - Math.max(y0n, -1));
        if ((fx * fy) / 4 > 0.012) return true;
      }
    }
    return false;
  }

  /** core placement; returns the placed record or null */
  const DBG = P?.get?.('vegDebug') ? {} : null;
  // waterfall corridors (published by the waterfalls module along each fall's whole path, ≈ 1.2× the fall
  // width): trees may stand along their banks (refs frame every fall with vegetation), never in the central part
  const IGN_FALL = ['waterfall'];
  const inFall = (x, z) => {
    for (const it of fp.query(x, z, 0, null)) {
      if (it.tag !== 'waterfall') continue;
      if (it.type !== 'r') return true;
      const dx = x - it.x, dz = z - it.z;
      if (Math.abs(dx * it.cos - dz * it.sin) < it.hw * 0.8) return true;
    }
    return false;
  };
  let lastWhy = '';
  const rej = (o, why) => { lastWhy = why; if (DBG) { const k = (o.tag || '-') + ':' + why; DBG[k] = (DBG[k] || 0) + 1; } return null; };
  // ref 2: the island tholos stands free in front of its cypress group: no tree on the camera side of the
  // island (compass bearing from the island centre within ±42° of the shot-2 camera), only low maquis on
  // the rock below the tholos platform
  const ISL = L.ISLAND ? { x: L.ISLAND.center[0], z: L.ISLAND.center[1], r: L.ISLAND.radius, top: L.ISLAND.top ?? 6.5 } : null;
  const c2 = SHOTS.find((s) => String(s.id) === '2');
  const camBear = ISL && c2 ? Math.atan2(c2.pos[0] - ISL.x, -(c2.pos[2] - ISL.z)) : null;
  const camSide = (x, z) => {
    if (camBear === null) return false;
    let d = Math.atan2(x - ISL.x, -(z - ISL.z)) - camBear;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return Math.abs(d) < (42 * Math.PI) / 180;
  };
  const tholosGuard = (kind, x, z, h) => {
    if (!ISL || Math.hypot(x - ISL.x, z - ISL.z) > ISL.r + 6 || !camSide(x, z)) return false;
    return !(kind === 'shrub' || kind === 'thicket') || h > ISL.top - 1.2;
  };
  function place(kind, x, z, o = {}) {
    if (!lib[kind] || !lib[kind].length) return null;
    const g = o.g || ground(x, z);
    if (tholosGuard(kind, x, z, g.h)) return rej(o, 'tholos');
    if (g.h < (o.minH ?? 0.8)) return rej(o, 'low');
    if (g.slope > (o.maxSlope ?? 0.55)) return rej(o, 'slope');
    if (!o.island && g.h < 4 && waterSDF(x, z) < (o.waterGap ?? 2.0)) return rej(o, 'shore');   // shoreline (islands are inside the water SDF)
    const v = o.variant || pick(kind);
    const s = o.scale ?? SCALE[kind]();
    const rad = radiusOf(kind, v, s) * (o.spacingK ?? 1);
    if (!o.force && !occ.free(x, z, rad)) return rej(o, 'occ');
    if (!fp.isFree(x, z, o.fpR ?? Math.max(0.6, radiusOf(kind, v, s) * (kind === 'cypress' ? 0.5 : 0.4)), o.ignoreTags ? [...o.ignoreTags, 'waterfall'] : IGN_FALL)) return rej(o, 'fp');
    if (inFall(x, z)) return rej(o, 'fall');
    if (!o.noExclude && excluded(x, z, rad * 0.4)) return rej(o, 'excl');
    if (o.tag !== 'hero' && nearColossus(x, z)) return rej(o, 'colossus');
    if (blocksShots(x, g.h, z, v.H * s, v.R * s * 0.8, o.shot)) return rej(o, 'shots');
    const yaw = R.random() * Math.PI * 2;
    // growth direction: trees grow vertically (a little toward the light / downhill), shrubs follow the
    // slope, cliff shrubs grow out of the face (o.upK); plus a slight random lean
    const k = o.upK ?? (kind === 'shrub' || kind === 'thicket' ? 0.3 : kind === 'cypress' ? 0.0 : 0.08);
    const nl = Math.hypot(g.gx, 1, g.gz), lean = o.lean ?? 0.025;
    const up = [-g.gx / nl * k + R.range(-lean, lean), 1 + (1 / nl - 1) * k, -g.gz / nl * k + R.range(-lean, lean)];
    const sink = o.sink ?? (kind === 'shrub' ? 0.25 : 0.5) + g.slope * (kind === 'thicket' ? 6 : 2.5) * (kind === 'shrub' ? 0.6 : 1);
    sys.add(v, x - g.gx / nl * (o.out ?? 0), g.h - sink, z - g.gz / nl * (o.out ?? 0), yaw, s, { tint: o.tint || TINT[kind](), width: o.width ?? R.range(0.9, 1.1), up });
    occ.add(x, z, rad * (o.occK ?? 1));
    st[kind]++;
    if (o.tag) tag[o.tag]++;
    return { x, z, h: g.h, v, s, rad, kind };
  }

  /** a few more cypress around a placed one (they grow in groups on the ledges and benches) */
  function cypressGroup(x, z, sc, maxSlope, tagName) {
    for (let k = R.int(1, 4); k > 0; k--) {
      const a = R.random() * Math.PI * 2, r = R.range(2.0, 4.8);
      place('cypress', x + Math.cos(a) * r, z + Math.sin(a) * r, { tag: tagName, spacingK: 0.42, maxSlope, scale: sc * R.range(0.72, 1.12) });
    }
  }

  stage('hero');
  // ------------------------------------------------------------------ 1. hero trees through the reference compositions
  const heroMiss = [], heroHit = [];
  // top surface of other modules' geometry at (x, z): downward ray against their roots (hero spots only)
  const _rc = new THREE.Raycaster();
  function sceneTop(mods, x, z) {
    const roots = [];
    for (const m of mods) for (const r of engine.moduleRoots?.[m] || []) roots.push(r);
    if (!roots.length) return null;
    for (const r of roots) r.updateMatrixWorld(true);   // (nothing rendered yet: world matrices may be stale)
    _rc.set(new THREE.Vector3(x, 400, z), new THREE.Vector3(0, -1, 0));
    _rc.far = 420;
    // (sets may still be hidden at build time: shot-specific visibility is applied on each shot change)
    const hit = _rc.intersectObjects(roots, true).find((h) => h.object.isMesh && !h.object.isInstancedMesh);
    return hit ? hit.point.y : null;
  }
  function hero(shot, kind, px, pyTop, d0, d1, o = {}) {
    const cam = camOf(shot); if (!cam) return;
    lastWhy = '';
    const dTop = rayOf(cam, px, pyTop);
    const dh = Math.hypot(dTop.x, dTop.z);
    const hx = dTop.x / dh, hz = dTop.z / dh, tanTop = dTop.y / dh;
    for (let d = d0; d <= d1; d += 1.5) {
      const x = cam.position.x + hx * d, z = cam.position.z + hz * d;
      let g = ground(x, z);
      // (r5) spots on built sets (terraces / quays of other modules): the top surface of that geometry
      if (o.sceneGround) { const sh = sceneTop(o.sceneGround, x, z); if (sh !== null && sh > g.h + 0.3) g = { h: sh, gx: 0, gz: 0, slope: 0 }; }
      if (g.h < 1 || g.slope > (o.maxSlope ?? 0.5)) continue;
      const v = o.variant || pick(kind);
      const topY = cam.position.y + tanTop * d;
      const want = topY - g.h + 0.5;
      if (want / v.H < (o.sMin ?? 0.5) * 0.6 || want / v.H > (o.sMax ?? 1.5) * 1.5) continue;
      const s = clamp(want / v.H, o.sMin ?? 0.5, o.sMax ?? 1.5);
      if (place(kind, x, z, { g, v, scale: s, variant: v, tag: 'hero', spacingK: 0.6, shot, ignoreTags: ['acro-plaza'], fpR: 0.7, noExclude: true, ...o })) { if (DBG) heroHit.push(`${shot}:${kind}@${px}→(${x.toFixed(0)},${g.h.toFixed(0)},${z.toFixed(0)}) d${d.toFixed(0)} s${s.toFixed(2)}`); return; }
    }
    heroMiss.push(`${shot}:${kind}@${px}${lastWhy ? '(' + lastWhy + ')' : ''}`);
  }
  // [shot, kind, px, pyTop, dMin, dMax, opts] — filled once the shot cameras are final
  const HEROES = [
    // ref 6 — grand staircase flanked by tall cypress (framing at both edges, more up the flights)
    [6, 'cypress', 70, 0, 5, 45, { sMin: 0.9, sMax: 1.9 }], [6, 'cypress', 140, 180, 8, 60, { sMax: 1.9 }], [6, 'cypress', 1520, 0, 5, 45, { sMin: 0.9, sMax: 1.9 }],
    // (r5) the low eye sees the left terraces over a tall cheek wall: tall old cypresses rise above it (ref 6 left)
    [6, 'cypress', 300, 110, 12, 70, { sMin: 1.1, sMax: 1.95 }], [6, 'cypress', 395, 170, 15, 80, { sMin: 1.0, sMax: 1.9 }],
    [6, 'cypress', 620, 205, 20, 140], [6, 'cypress', 690, 262, 20, 140], [6, 'cypress', 870, 350, 25, 160],
    // (r5) rows flanking the upper flights: left beyond the cheek wall, right beside the stair (ref 6)
    [6, 'cypress', 245, 450, 10, 70], [6, 'cypress', 575, 215, 18, 120], [6, 'cypress', 790, 255, 25, 150],
    [6, 'cypress', 965, 240, 40, 170], [6, 'broad', 940, 390, 30, 160, { sMin: 0.5, sMax: 1.2 }],
    // ref 5 — cypress either side of the temple front (more in HERO_AT below)
    [5, 'cypress', 180, 250, 30, 200],
    // (r5) ref 5: bushes at the foot of the podium, a cypress between the temple stair and colossus A,
    // cypress pair in front of the hill-temple slope at the left
    [5, 'cypress', 545, 285, 40, 170, { ignoreTags: ['acro-plaza', 'acro-wall'] }],
    [5, 'cypress', 115, 330, 60, 260], [5, 'cypress', 245, 270, 60, 260],
    // ref 2 — cypress group behind the island tholos, olive on the right
    // (r5: the ones overlapping the tholos stand behind it — search from just past the island centre)
    [2, 'cypress', 520, 292, 50, 260], [2, 'cypress', 598, 420, 50, 260], [2, 'cypress', 660, 330, 103, 260], [2, 'cypress', 1040, 322, 103, 300], [2, 'cypress', 1100, 350, 103, 300],
    // ref 2: dark olive crown behind the brazier, left of the statue (backdrop for the statue)
    [2, 'olive', 1250, 430, 23, 40, { sMin: 0.6, sMax: 1.7, maxSlope: 0.7, sceneGround: ['sets'], ignoreTags: ['acro-plaza', 'acro-wall', 'set-shot2'], fpR: 0.3, force: true, island: true, width: 1.45 }],
    // refs 3 / 9 / 8 — cypress pairs in front of the acropolis cliffs
    // (the ref-3 foreground cypress at the left edge and the ref-9 broadleaf behind the portico have no land
    //  under the current cameras: the gorge / the ruins set)
    [3, 'cypress', 760, 552, 40, 260],
    [9, 'cypress', 497, 600, 40, 300], [9, 'cypress', 522, 640, 40, 300],
    [8, 'cypress', 30, 340, 30, 260], [8, 'cypress', 118, 450, 30, 260],
    // ref 7 — river level
    [7, 'cypress', 765, 555, 40, 300], [7, 'cypress', 975, 580, 40, 300], [7, 'broad', 1100, 380, 60, 360], [7, 'cypress', 235, 410, 20, 200],
  ];
  for (const [shot, kind, px, py, d0, d1, o] of HEROES) hero(shot, kind, px, py, d0, d1, o || {});
  // framing trees fixed in world space (forecourt / podium flanks; seen in shots 5, 6, 3, 9): [shot, kind, x, z, scale]
  const HERO_AT = [
    [5, 'cypress', 36.5, -17.5, 0.78], [5, 'cypress', 38.5, -13.5, 0.62], [5, 'cypress', 10.5, -16.5, 0.85],
    [5, 'cypress', 1.5, -20, 1.25], [5, 'cypress', -1.5, -15.5, 1.15], [5, 'cypress', -4.5, -20.5, 1.3],
  ];
  for (const [shot, kind, x, z, sc] of HERO_AT) {
    const v = pick(kind);
    if (!place(kind, x, z, { variant: v, scale: sc, tag: 'hero', shot, spacingK: 0.3, fpR: 0.5, ignoreTags: ['acro-plaza', 'acro-wall'], noExclude: true, maxSlope: 0.6, width: 1.08 })) heroMiss.push(`${shot}:${kind}@(${x},${z})`);
  }
  if (heroMiss.length) console.log(`[vegetation] hero spots without free land: ${heroMiss.join(' ')}`);
  if (DBG) console.log(`[vegetation] heroes placed: ${heroHit.join(' ')}`);

  stage('rows');
  // ------------------------------------------------------------------ 2. rows / slots / gardens from other modules
  const rows = engine.registry.cypressRows;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const pts = Array.isArray(row) ? row : row.points || (row.from && row.to ? [row.from, row.to] : null);
      if (!pts || pts.length < 2) continue;
      const spacing = row.spacing || 7;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ax = a[0], az = a.length > 2 ? a[2] : a[1], bx = b[0], bz = b.length > 2 ? b[2] : b[1];
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / spacing));
        for (let k = 0; k <= n; k++) {
          if (i > 0 && k === 0) continue;
          const t = k / n;
          place('cypress', ax + (bx - ax) * t + R.range(-0.4, 0.4), az + (bz - az) * t + R.range(-0.4, 0.4), { tag: 'rows', spacingK: 0.4, maxSlope: 0.7, fpR: 0.6, ignoreTags: ['acro-wall', 'acro-plaza'], noExclude: true, scale: row.height ? row.height / 17 : clamp(R.gauss(0.95, 0.12), 0.7, 1.25) });
        }
      }
    }
  }
  for (const s of engine.slots.tree || []) {
    const kind = lib[s.tag] ? s.tag : 'cypress';
    // slots on raised structures (garden beds, terraces, planters) keep their own height
    const gh = heightAt(s.pos[0], s.pos[2]);
    const g = s.pos[1] !== undefined && s.pos[1] > gh + 0.5 ? { h: s.pos[1], gx: 0, gz: 0, slope: 0 } : undefined;
    place(kind, s.pos[0], s.pos[2], { g, tag: 'rows', force: true, noExclude: true, sink: g ? 0.15 : undefined, scale: s.size ? s.size / (lib[kind][0]?.H || 10) : undefined });
  }
  const gardens = engine.registry.city?.gardens;
  if (Array.isArray(gardens)) {
    for (const gd of gardens) {
      const area = Math.max(1, gd.hw * gd.hd * 4);
      const n = clamp(Math.round(area / 28), 1, 8);
      const c = Math.cos(gd.rot || 0), sn = Math.sin(gd.rot || 0);
      for (let k = 0; k < n; k++) {
        const lx = R.range(-0.75, 0.75) * gd.hw, lz = R.range(-0.75, 0.75) * gd.hd;
        const x = gd.x + lx * c + lz * sn, z = gd.z - lx * sn + lz * c;
        const kind = pickW({ cypress: 4.5, broad: 2.4, olive: 1.6, shrub: 1.6, pine: 0.3 });
        place(kind, x, z, { tag: 'garden', fpR: 0.5, spacingK: 0.5, maxSlope: 0.6, scale: kind === 'cypress' ? R.range(0.55, 1.0) : kind === 'broad' ? R.range(0.45, 0.8) : kind === 'pine' ? R.range(0.6, 0.9) : undefined });
      }
    }
  }

  stage('terrace');
  // (r5) acropolis terraces: maquis and crowns along the top of every retaining wall (hanging over the
  // edge) and a planted strip at the wall foot — refs 1, 3, 9: every terrace edge is green
  const runs = engine.registry.acropolis?.wallRuns;
  if (Array.isArray(runs)) {
    for (const w of runs) {
      if (!w.F || typeof w.F.p !== 'function' || !(w.len > 3) || w.kind === 'quay') continue;
      for (let s = R.range(0.4, 2.0); s < w.len - 0.4; s += R.range(1.6, 3.4) / Math.sqrt(D)) {
        const c = w.F.p(s, w.top, 0);
        const lush = 0.5 + 0.5 * noiseB.fbm2(c[0] / 23 + 7.1, c[2] / 23 - 3.3, 2);
        if (R.random() < smoothstep(0.22, 0.5, lush)) {
          const p = w.F.p(s, w.top, -R.range(0.9, 3.6));
          const gh = heightAt(p[0], p[2]);
          if (Math.abs(gh - w.top) < 2.2) {
            const kind = pickW({ shrub: 3, thicket: 2.4, broad: 1.5, cypress: 1.1, olive: 0.6 });
            const sc = kind === 'thicket' ? R.range(0.35, 0.7) : kind === 'broad' ? R.range(0.45, 0.8) : kind === 'cypress' ? R.range(0.55, 0.95) : kind === 'shrub' ? R.range(0.8, 1.9) : undefined;
            place(kind, p[0], p[2], { tag: 'terrace', ignoreTags: ['acro-wall', 'acro-plaza'], fpR: 0.45, spacingK: 0.45, maxSlope: 0.7, scale: sc, sink: 0.2 });
          }
        }
        if (R.random() < 0.6 * smoothstep(0.25, 0.6, lush)) {
          const p = w.F.p(s, w.yBot, R.range(1.2, 4.5));
          const gh = heightAt(p[0], p[2]);
          if (gh > 1.5 && gh > w.yBot - 9 && gh < w.yBot + 3) {
            const kind = pickW({ shrub: 2.5, thicket: 1.6, cypress: 2.0, broad: 1.6, olive: 0.4 });
            const sc = kind === 'thicket' ? R.range(0.35, 0.75) : kind === 'broad' ? R.range(0.5, 0.9) : kind === 'cypress' ? R.range(0.6, 1.05) : kind === 'shrub' ? R.range(0.8, 1.8) : undefined;
            place(kind, p[0], p[2], { tag: 'terrace', ignoreTags: ['acro-wall'], fpR: 0.5, spacingK: 0.45, maxSlope: 0.6, scale: sc });
          }
        }
      }
    }
  }

  stage('massif');
  // ------------------------------------------------------------------ 3. the acropolis massif
  {
    const top = A.top;
    // 3a. temple peribolos: cypress rows framing the temple on its long sides and the back (east)
    if (TF) {
      const off = 11 + R.range(0, 2);
      const L0 = TF.hl + off, W0 = TF.hw + off;
      const P2 = (l, w) => [TF.x + TF.fx * l - TF.fz * w, TF.z + TF.fz * l + TF.fx * w];
      // two long sides (not reaching the front) and the back
      const runs = [[P2(-L0, -W0), P2(TF.hl * 0.55, -W0)], [P2(-L0, W0), P2(TF.hl * 0.55, W0)], [P2(-L0, -W0), P2(-L0, W0)]];
      for (const [a, b] of runs) {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.round(len / 6.5);
        for (let k = 0; k <= n; k++) {
          if (R.random() < 0.12) continue;
          const t = k / n;
          place('cypress', a[0] + (b[0] - a[0]) * t + R.range(-0.6, 0.6), a[1] + (b[1] - a[1]) * t + R.range(-0.6, 0.6), { tag: 'plateau', spacingK: 0.4, fpR: 0.8, scale: clamp(R.gauss(1.0, 0.1), 0.8, 1.25) });
        }
      }
    }
    const bx = polyBox(A.outline, 175);
    const cell = 3.0 / Math.sqrt(D);
    const plateauKinds = { cypress: 2.6, broad: 3.2, shrub: 2.2, olive: 1.5, thicket: 0.9 };
    for (let gx = bx.x0; gx < bx.x1; gx += cell) {
      for (let gz = bx.z0; gz < bx.z1; gz += cell) {
        const x = gx + R.random() * cell, z = gz + R.random() * cell;
        const d = acroD(x, z);
        if (d > 165) continue;
        const g = ground(x, z);
        if (g.h < 1.2) continue;
        // (the water SDF is planar: the lagoon ellipse runs under the high terraces, so only low ground counts as shore)
        if (g.h < 4 && waterSDF(x, z) < 1.5) continue;
        const patch = 0.5 + 0.5 * noiseA.fbm2(x / 38 + 3.1, z / 38, 3);      // lush vs. bare patches
        const fine = 0.5 + 0.5 * noiseC.noise2(x / 9, z / 9);                  // clumping at tree scale
        if (d < -2 && g.h > top - 10) {
          // ---- plateau top: rim groves + olive lawns (temple / colossi / way are excluded or footprinted)
          const rim = smoothstep(-26, -4, d);
          const p = (0.1 + 0.65 * rim * smoothstep(0.3, 0.6, patch)) * (0.6 + 0.8 * fine);
          if (R.random() > p) continue;
          const kind = rim > 0.4 ? pickW(plateauKinds) : pickW({ olive: 3, cypress: 1.6, shrub: 1.2, broad: 0.6 });
          place(kind, x, z, { g, tag: 'plateau', spacingK: kind === 'cypress' ? 0.5 : 0.7, maxSlope: 0.4, scale: kind === 'broad' ? R.range(0.55, 0.95) : undefined });
          continue;
        }
        // ---- faces of the massif: terraces, ledges, benches, talus, cliffs (refs 1/3/9: every ledge carries
        // cypress clusters and round crowns, the lips of the ledges are lined with crowns hanging over the wall)
        const s5 = slope5(x, z);
        const near = smoothstep(165, 40, d);                                   // lusher close to the massif
        const lush = (0.6 + 0.4 * smoothstep(0.25, 0.6, patch)) * (0.7 + 0.6 * fine) * (0.6 + 0.4 * near);
        let p, kinds, maxSlope, scaleK = 1, lean = 0.03;
        const flat = g.slope < 0.1;
        const lip = flat ? dropNear(x, z, g.h) : 0;
        if (flat && (s5 < 0.14 || lip > 3)) {      // ledge / terrace / bench (lip: crowns over the wall below)
          if (lip > 3) { p = 1; kinds = { broad: 3.2, thicket: 2.6, cypress: 2.6, olive: 1.2, shrub: 1.0 }; }
          else { p = 0.9; kinds = { cypress: 2.1, broad: 3.6, shrub: 1.9, thicket: 1.8, olive: 1.6, pine: 0.25 }; }
          maxSlope = 0.2;
        } else if (g.slope < 0.3) {                 // steep slope (20-45°): maquis hillside
          p = 0.9; kinds = { thicket: 3, shrub: 2.6, broad: 2.4, cypress: 1.8, olive: 0.5, pine: 0.4 }; maxSlope = 0.32; scaleK = 0.9;
        } else if (g.slope < 0.62) {                // 45-68°: clinging maquis, a few trees on cracks
          p = 0.7 * (0.35 + 0.65 * smoothstep(0.2, 0.6, 0.5 + 0.5 * noiseB.noise2(x / 14, z / 30))); kinds = { shrub: 3, thicket: 2.4, broad: 1.0, cypress: 0.6 }; maxSlope = 0.66; scaleK = 0.8; lean = 0.12;
        } else if (g.slope < 0.85) {                // near-vertical: shrubs in vertical streaks
          p = 0.35 * (0.3 + 0.7 * smoothstep(0.4, 0.7, 0.5 + 0.5 * noiseB.noise2(x / 9, z / 40 + 5))); kinds = { shrub: 4, thicket: 2 }; maxSlope = 0.88; scaleK = 0.75; lean = 0.18;
        } else continue;
        if (R.random() > p * lush) continue;
        const kind = pickW(kinds);
        const sc = SCALE[kind]() * scaleK * (kind === 'cypress' && !flat ? R.range(0.6, 0.9) : 1) * (kind === 'broad' && lip > 3 ? 0.8 : 1);
        // (r5) low crowns may grow against the terrace walls (they hang over the copings: refs 3, 4, 9)
        const low = kind === 'shrub' || kind === 'thicket' || (kind === 'broad' && sc < 0.8);
        const rec = place(kind, x, z, { g, tag: 'face', spacingK: kind === 'cypress' ? 0.45 : 0.5, maxSlope, scale: sc, lean, ignoreTags: low ? ['acro-wall'] : null, upK: kind === 'thicket' && maxSlope > 0.5 ? 0.6 : undefined });
        // cypress on the massif stand in groups of 2-5
        if (rec && kind === 'cypress' && R.random() < (flat ? 0.65 : 0.4)) cypressGroup(x, z, sc, Math.max(0.2, maxSlope), 'face');
      }
    }
  }

  stage('cliff');
  // ------------------------------------------------------------------ 3c. cliff faces: maquis clinging to cracks and ledges
  // (sampled by surface area: steep faces get proportionally more candidates; shrubs grow out of the face)
  {
    const bx = polyBox(A.outline, 260);
    const box = { x0: Math.min(bx.x0, -520), x1: Math.max(bx.x1, 380), z0: Math.min(bx.z0, -560), z1: Math.max(bx.z1, 360) };
    // far ring (crags and canyon walls 0.5-1.2 km from the viewpoints): coarser sampling, bigger masses
    const far = { x0: -1000, x1: 520, z0: -1000, z1: 480 };
    const steepAt = (x, z, e) => {
      const h0 = heightAt(x, z);
      return Math.max(Math.abs(heightAt(x + e, z) - h0), Math.abs(heightAt(x - e, z) - h0), Math.abs(heightAt(x, z + e) - h0), Math.abs(heightAt(x, z - e) - h0)) / e;
    };
    for (const ring of [0, 1]) {
    const K = ring ? 2 : 1;                 // size factor of the far ring
    const cell = (ring ? 4.4 : 2.5) / Math.sqrt(D);
    // coarse pre-pass (3x3 fine cells): skip flat ground without sampling every fine cell
    const CC = cell * 3, B = ring ? far : box;
    for (let cx = B.x0; cx < B.x1; cx += CC) for (let cz = B.z0; cz < B.z1; cz += CC) {
      if (ring && cx + CC > box.x0 && cx < box.x1 && cz + CC > box.z0 && cz < box.z1) continue;
      if (steepAt(cx + CC * 0.5, cz + CC * 0.5, CC * 0.5) < 0.45) continue;
      for (let gx = cx; gx < cx + CC - 1e-6; gx += cell) for (let gz = cz; gz < cz + CC - 1e-6; gz += cell) {
        const x = gx + R.random() * cell, z = gz + R.random() * cell;
        const g = ground(x, z);
        if (g.h < 2.5) continue;
        if (g.h < 4 && waterSDF(x, z) < 1) continue;
        const patch = smoothstep(0.3, 0.62, 0.5 + 0.5 * noiseA.fbm2(x / 60 - 4, z / 60, 2));
        if (g.slope < 0.42) {
          // benches, ledges and talus between the walls of a cliff zone (the bedding benches of the
          // terrain): cypress groups, round crowns and maquis masses (refs 1, 3, 7, 9)
          if (inMassif(x, z)) continue;            // the massif fill handles its own ledges
          const bench = g.slope < 0.22;
          if (R.random() > (bench ? 0.7 : 0.5) * (0.45 + 0.55 * patch)) continue;
          const kind = bench ? pickW({ thicket: 2.4, broad: 3.0, cypress: 2.0, shrub: 1.6, olive: 1.4, pine: 0.4 }) : pickW({ thicket: 3, shrub: 3, broad: 1.4, cypress: 0.8 });
          const sc = kind === 'cypress' ? R.range(0.55, 0.95) : kind === 'broad' ? R.range(0.5, 0.95) * (ring ? 1.25 : 1) : kind === 'thicket' ? R.range(0.45, 0.95) * (ring ? 1.4 : 1) : kind === 'shrub' ? R.range(0.6, 1.6) * K : undefined;
          const rec = place(kind, x, z, { g, tag: 'bench', maxSlope: bench ? 0.26 : 0.45, spacingK: kind === 'cypress' ? 0.45 : 0.55, scale: sc, lean: 0.05, fpR: 0.6 });
          if (rec && kind === 'cypress' && R.random() < 0.5) cypressGroup(x, z, sc, 0.3, 'bench');
          continue;
        }
        const area = Math.min(6, 1 / Math.max(0.02, 1 - g.slope));
        // vegetation grows in vertical streaks (water seeps / cracks) and on the upper half of the faces
        const streak = smoothstep(0.45, 0.66, 0.5 + 0.5 * (noiseB.noise2(x / 11 + z / 37, z / 11 - x / 37 + 3) * 0.75 + 0.25 * noiseC.noise2(x / 4, z / 4)));
        const p = 0.9 * area * (0.32 + 0.68 * streak) * (0.5 + 0.5 * patch) * (inMassif(x, z) ? 1.0 : ring ? 1.5 : 0.9);
        if (R.random() > p) continue;
        const steep = g.slope > 0.7;
        // (far crags: holm-oak crowns and maquis masses read at 0.5-1 km where single shrubs vanish)
        const kind = steep ? pickW({ shrub: 5, thicket: ring ? 3 : 2.2 }) : pickW(ring ? { shrub: 2, thicket: 3, broad: 2, cypress: 1.0 } : { shrub: 4, thicket: 3, broad: 1.2, cypress: 0.5 });
        const sc = (kind === 'shrub' ? 0.5 + 1.5 * Math.pow(R.random(), 1.4) : kind === 'thicket' ? R.range(0.3, 0.85) : R.range(0.35, 0.65)) * (ring ? (kind === 'shrub' ? 1.8 : 1.4) : 1);
        const rec = place(kind, x, z, { g, tag: 'cliff', maxSlope: 0.985, spacingK: 0.55, occK: 0.8, scale: sc, upK: kind === 'cypress' ? 0.05 : steep ? R.range(0.55, 0.8) : R.range(0.35, 0.6), lean: 0.08, out: steep ? 0.15 : 0, sink: 0.3 + g.slope * 1.0, fpR: 0.5 });
        // clinging maquis spreads along cracks: a few neighbours on the same face
        if (rec && R.random() < 0.75) {
          for (let k = R.int(2, 5); k > 0; k--) {
            const a = R.random() * Math.PI * 2, r = R.range(1.2, 3.5);
            const x2 = x + Math.cos(a) * r, z2 = z + Math.sin(a) * r, g2 = ground(x2, z2);
            if (g2.slope < 0.3) continue;
            place(R.random() < 0.85 ? 'shrub' : 'thicket', x2, z2, { g: g2, tag: 'cliff', maxSlope: 0.985, spacingK: 0.5, occK: 0.75, scale: R.range(0.4, 1.1) * K, upK: g2.slope > 0.7 ? R.range(0.55, 0.8) : R.range(0.35, 0.6), lean: 0.08, out: g2.slope > 0.7 ? 0.15 : 0, sink: 0.3 + g2.slope * 1.0, fpR: 0.5 });
          }
        }
      }
    }
    }
  }

  stage('island');
  // ------------------------------------------------------------------ 4a. island
  if (L.ISLAND) {
    const [ix, iz] = L.ISLAND.center, IR = L.ISLAND.radius;
    for (let i = 0; i < 420; i++) {
      const a = R.random() * Math.PI * 2, r = R.range(IR * 0.3, IR + 5);
      const x = ix + Math.cos(a) * r, z = iz + Math.sin(a) * r;
      const g = ground(x, z);
      if (g.h < 1.2) continue;
      // ref 2: cypress behind the tholos, the rock skirted with maquis, laurel and holm-oak crowns
      const kind = pickW({ cypress: 2.4, shrub: 3.4, thicket: 1.6, broad: 1.2, olive: 0.5 });
      // maquis may grow against the quay walls on the rock (not on the low quay paving)
      const low = kind === 'shrub' || kind === 'thicket';
      if (low && g.h < 2.6) continue;
      // (camera side of the tholos: see tholosGuard in place())
      place(kind, x, z, { g, tag: 'island', ignoreTags: low ? ['acro-wall'] : null, fpR: low ? 0.4 : undefined, island: true, spacingK: 0.5, maxSlope: low ? 0.97 : 0.5, out: low && g.slope > 0.6 ? 0.2 : 0, minH: 1.0, waterGap: 0.5, upK: kind === 'shrub' && g.slope > 0.5 ? 0.6 : undefined, sink: kind === 'shrub' ? 0.25 + g.slope : undefined, scale: kind === 'cypress' ? R.range(0.75, 1.2) : kind === 'thicket' ? R.range(0.3, 0.6) : kind === 'broad' ? R.range(0.4, 0.7) : undefined });
    }
  }

  stage('shore');
  // ------------------------------------------------------------------ 4b. shores of the lagoon / river: belts of round trees, cypress, reeds of maquis
  {
    const box = { x0: -900, x1: 700, z0: -1300, z1: 700 };
    const cell = 5.5 / Math.sqrt(D);
    for (let gx = box.x0; gx < box.x1; gx += cell) {
      for (let gz = box.z0; gz < box.z1; gz += cell) {
        const x = gx + R.random() * cell, z = gz + R.random() * cell;
        const w = waterSDF(x, z);
        if (w < 2 || w > 30) continue;
        if (inMassif(x, z)) continue;            // handled by the massif fill
        const g = ground(x, z);
        if (g.h < 0.8 || g.h > 60) continue;
        const p = 0.55 * smoothstep(30, 6, w) * (0.4 + 0.6 * smoothstep(0.3, 0.6, 0.5 + 0.5 * noiseA.fbm2(x / 70, z / 70, 2)));
        if (R.random() > p) continue;
        const kind = g.slope > 0.3 ? pickW({ shrub: 3, thicket: 2, broad: 1 }) : pickW({ broad: 3.4, cypress: 2.2, shrub: 2, thicket: 1, olive: 0.6, pine: 0.4 });
        place(kind, x, z, { g, tag: 'shore', spacingK: 0.62, maxSlope: kind === 'shrub' || kind === 'thicket' ? 0.7 : 0.4, waterGap: 1.5 });
      }
    }
  }

  stage('crag');
  // ------------------------------------------------------------------ 4c. crags: hill-temple mount, ruins promontory flanks, hilltops
  {
    const crags = [];
    if (L.HILL_TEMPLE) crags.push({ c: L.HILL_TEMPLE.center, r0: 20, r1: 280, n: 15000 });
    for (const c of crags) {
      const M = Math.round(c.n * D);
      for (let i = 0; i < M; i++) {
        const a = R.random() * Math.PI * 2, r = c.r0 + (c.r1 - c.r0) * Math.sqrt(R.random());
        const x = c.c[0] + Math.cos(a) * r, z = c.c[1] + Math.sin(a) * r;
        if (inMassif(x, z)) continue;
        const g = ground(x, z);
        if (g.h < 2) continue;
        const lush = 0.55 + 0.45 * smoothstep(0.3, 0.6, 0.5 + 0.5 * noiseA.fbm2(x / 50, z / 50, 2));
        if (R.random() > lush) continue;
        if (g.slope < 0.45) place(pickW({ cypress: 2.0, broad: 3.0, olive: 1.0, pine: 1.0, shrub: 1.5, thicket: 2.0 }), x, z, { g, tag: 'crag', spacingK: 0.6, maxSlope: 0.46, scale: undefined });
        else if (g.slope < 0.75 && R.random() < 0.6) place(pickW({ shrub: 4, thicket: 1.5 }), x, z, { g, tag: 'crag', maxSlope: 0.78, spacingK: 0.7, lean: 0.12 });
      }
    }
  }

  stage('wild');
  // ------------------------------------------------------------------ 5. wild land: clumpy forests, clearings, olive orchards
  const inCity = L.CITY ? (x, z) => sdPolygon(x, z, L.CITY.outline) < 0 : () => false;
  const forestMask = (x, z) => {
    const f = 0.5 + 0.5 * noiseA.fbm2(x / 230 + 11, z / 230, 4);
    const v = smoothstep(0.42, 0.58, f);
    // the land around the acropolis / lagoon (seen in every shot) is lush: dense maquis woods, few clearings
    const near = smoothstep(1100, 350, Math.hypot(x - A.center[0], z - A.center[1]));
    return clamp(v + 0.7 * near * smoothstep(0.25, 0.45, f), 0, 1);
  };
  const orchard = (x, z) => smoothstep(0.62, 0.72, 0.5 + 0.5 * noiseB.fbm2(x / 160 - 7, z / 160 + 3, 2));
  const wildKind = (g, wd, city) => {
    if (city) return pickW({ cypress: 5.5, broad: 2.2, olive: 1.2, pine: 0.7, shrub: 1.0 });
    // (r5) hills read as rounded holm-oak / olive canopies with cypress accents in groves (refs 1, 3, 9),
    // not as an even plantation of spires: cypress only where a grove mask allows, few umbrella pines
    const grove = noiseC.noise2(g.x / 55 + 3.7, g.z / 55 - 1.9) > 0.18;
    const cy = grove ? 3.2 : 0.35;
    if (g.slope > 0.3) return pickW({ shrub: 3, thicket: 2.8, cypress: cy * 0.5, broad: 1.6, pine: 0.25 });
    if (wd < 60 && g.h < 40) return pickW({ broad: 4.2, cypress: cy * 0.8, thicket: 1.4, shrub: 1, olive: 0.8, pine: 0.2 });
    if (g.h < 120) return pickW({ broad: 4.0, cypress: cy, pine: 0.35, olive: 1.8, thicket: 1.5, shrub: 0.8 });
    if (g.h < 300) return pickW({ pine: 0.8, broad: 3.4, cypress: cy * 0.8, olive: 0.6, thicket: 2.0, shrub: 0.8 });
    return pickW({ pine: 1.6, thicket: 2.4, cypress: cy * 0.6, broad: 1.8, shrub: 1 });
  };
  const placedTrees = [];
  const core = { x0: -1450, x1: 900, z0: -1600, z1: 800 };
  {
    const cell = 6.5 / Math.sqrt(D);
    for (let gx = core.x0; gx < core.x1; gx += cell) {
      for (let gz = core.z0; gz < core.z1; gz += cell) {
        const x = gx + R.random() * cell, z = gz + R.random() * cell;
        const city = inCity(x, z);
        const F = forestMask(x, z);
        const O = city ? 0 : orchard(x, z);
        let p = city ? 0.32 : 0.06 + 0.88 * F;
        if (O > 0 && F < 0.5) p = Math.max(p, 0.3 * O);
        if (R.random() > p) continue;
        if (inMassif(x, z)) continue;              // the massif has its own fill
        const g = ground(x, z);
        if (g.h < 1 || g.slope > 0.8) continue;
        const wd = g.h < 12 ? waterSDF(x, z) : 99;
        if (wd < 3) continue;
        let kind;
        if (O > 0 && F < 0.5 && g.slope < 0.15 && !city) {
          // orchard: olives on a loose grid
          const ox = Math.round(x / 9) * 9 + R.range(-1.2, 1.2), oz = Math.round(z / 9) * 9 + R.range(-1.2, 1.2);
          if (place('olive', ox, oz, { tag: 'wild', spacingK: 0.6, maxSlope: 0.2 })) continue;
          continue;
        }
        g.x = x; g.z = z;
        kind = wildKind(g, wd, city);
        const rec = place(kind, x, z, { g, tag: city ? 'city' : 'wild', spacingK: city ? 0.55 : F > 0.5 ? 0.66 : 0.8, maxSlope: kind === 'shrub' || kind === 'thicket' ? 0.8 : 0.42, fpR: city ? 0.5 : undefined, scale: city && kind === 'broad' ? R.range(0.5, 0.85) : city && kind === 'cypress' ? R.range(0.6, 1.05) : undefined });
        if (!rec) continue;
        if (kind !== 'shrub' && kind !== 'thicket') placedTrees.push(rec);
      }
    }
  }
  // maquis understory around trees (and filling forest edges)
  for (const t of placedTrees) {
    if (R.random() > 0.4) continue;
    const n = R.int(1, 3);
    for (let k = 0; k < n; k++) {
      const a = R.random() * Math.PI * 2, r = t.rad + R.range(0.5, 4);
      place(R.random() < 0.75 ? 'shrub' : 'thicket', t.x + Math.cos(a) * r, t.z + Math.sin(a) * r, { tag: 'under', maxSlope: 0.75, spacingK: 0.6, occK: 0.7 });
    }
  }

  stage('carpet');
  // (r5) maquis carpet: the bare ground between the trees of the land seen by the cameras (≈ 0.25-1 km
  // around the acropolis) is filled with low patchy maquis masses — at a distance it reads as dense green
  // texture instead of grey soil between separate trees (refs 1, 3, 9 hills)
  {
    const cx = A.center[0], cz = A.center[1];
    const cell = 5.0 / Math.sqrt(D);
    for (let gx = cx - 1000; gx < cx + 900; gx += cell) {
      for (let gz = cz - 1100; gz < cz + 700; gz += cell) {
        const x = gx + R.random() * cell, z = gz + R.random() * cell;
        const rr = Math.hypot(x - cx, z - cz);
        if (rr > 1050) continue;
        const patch = 0.5 + 0.5 * noiseB.fbm2(x / 34 - 2.3, z / 34 + 8.1, 3);
        if (R.random() > 0.55 * smoothstep(0.38, 0.62, patch) * smoothstep(1050, 600, rr)) continue;
        if (inMassif(x, z) || inCity(x, z)) continue;
        const g = ground(x, z);
        if (g.h < 2 || g.slope > 0.62) continue;
        if (g.h < 12 && waterSDF(x, z) < 3) continue;
        const kind = R.random() < 0.62 ? 'shrub' : 'thicket';
        place(kind, x, z, { g, tag: 'carpet', maxSlope: 0.64, spacingK: 0.75, occK: 0.8, scale: kind === 'shrub' ? R.range(0.9, 2.0) : R.range(0.45, 0.9), fpR: 0.5 });
      }
    }
  }

  stage('far');
  // ------------------------------------------------------------------ 6. far ring (cheap, clumpy, no shrubs)
  {
    const cell = 16 / Math.sqrt(D);
    for (let gx = -3600; gx < 2400; gx += cell) {
      for (let gz = -3600; gz < 1200; gz += cell) {
        const x = gx + R.random() * cell, z = gz + R.random() * cell;
        if (x > core.x0 && x < core.x1 && z > core.z0 && z < core.z1) continue;
        const f = 0.5 + 0.5 * noiseA.fbm2(x / 380 - 5, z / 380, 3);
        if (R.random() > 0.04 + smoothstep(0.42, 0.62, f) * 0.85) continue;
        if (waterSDF(x, z) < 4) continue;
        const g = ground(x, z);
        if (g.h < 2 || g.h > 1100 || g.slope > 0.45) continue;
        const kind = g.h > 500 ? pickW({ pine: 2.2, cypress: 0.8, thicket: 2.2, broad: 1 }) : pickW({ cypress: 1.3, broad: 3.6, pine: 0.7, thicket: 1.8, olive: 0.6 });
        const v = pick(kind);
        sys.add(v, x, g.h - 0.6, z, R.random() * Math.PI * 2, SCALE[kind]() * 1.1, { tint: TINT[kind](), width: R.range(0.9, 1.1) });
        st[kind]++; tag.far++;
      }
    }
  }
  stage('end');
  if (DBG) console.log('[vegetation] rejections ' + Object.entries(DBG).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', '));
  console.log(`[vegetation] scatter ${Math.round(performance.now() - t0)} ms (density ${D}; stages ${Object.entries(TS).map(([k, v]) => k + ' ' + v).join(', ')}) — ${Object.entries(tag).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  return st;
}
