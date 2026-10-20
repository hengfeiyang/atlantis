// Coral / sponge / anemone / sea-grass geometry generators. Local frame: base at the origin, +Y = growth
// axis (the surface normal at placement), real sizes in metres (instances are scaled ≈ 0.6-1.8).
// Vertex colours are a pale base (≈ 0.75-1.0, variation + darker base) — the instance colour carries
// the species hue; aM = (AO, sway weight m, tip factor, free).
import * as THREE from 'three';
import { GeoBuilder, tube, perp, growPath, lin, scaleC, mixC } from './geo.js';
import { Simplex } from '../core/noise.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** smooth (indexed) low-poly sphere */
const _balls = new Map();
function ball(detail) {
  const k = detail >= 0.9 ? 2 : detail >= 0.45 ? 1 : 0;
  if (!_balls.has(k)) { const g = new THREE.IcosahedronGeometry(1, k); g.deleteAttribute('normal'); g.deleteAttribute('uv'); _balls.set(k, mergeVertices(g)); }
  return _balls.get(k);
}

const V = THREE.Vector3;
const UP = new V(0, 1, 0);

// ------------------------------------------------------------------ generic lathe with angular modulation
/**
 * profile: [[r, y, ao, tip]] bottom → top (→ inside for open shapes). rFn(theta, k, r, y) → radius multiplier.
 * bend: fn(y) → [dx, dz] lateral offset
 */
function lathe(B, profile, seg, { rFn = null, bend = null, col = null, sway = null, base = new V(), uRep = 1 } = {}) {
  const b0 = B.n;
  let vlen = 0;
  for (let i = 0; i < profile.length; i++) {
    const [r, y, ao = 1, tip = 0] = profile[i];
    if (i > 0) vlen += Math.hypot(r - profile[i - 1][0], y - profile[i - 1][1]);
    B.a = ao; B.t = tip; B.s = sway ? sway(y) : 0;
    if (col) B.c = col(i, y, r);
    const [bx, bz] = bend ? bend(y) : [0, 0];
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const rr = r * (rFn ? rFn(th, j % seg, r, y, i) : 1);
      B.v(base.x + bx + Math.cos(th) * rr, base.y + y, base.z + bz + Math.sin(th) * rr, (j / seg) * uRep, vlen);
    }
  }
  for (let i = 0; i < profile.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = b0 + i * (seg + 1) + j, c = a + seg + 1;
    B.tri(a, c, a + 1); B.tri(a + 1, c, c + 1);
  }
}

function noiseFor(rng) { return new Simplex(Math.floor(rng.range(1, 1e6))); }

// ------------------------------------------------------------------ brain coral (massive, meandroid: detail in the shader)
export function brainCoral(rng, { r = 0.5, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const nz = noiseFor(rng);
  const seg = Math.max(18, Math.round(44 * detail)), rows = Math.max(8, Math.round(18 * detail));
  const squash = rng.range(0.55, 0.8), lob = rng.range(0.08, 0.2);
  const b0 = B.n;
  for (let i = 0; i <= rows; i++) {
    const phi = (i / rows) * (Math.PI * 0.5 + 0.35); // from the pole down to slightly below the equator
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const dx = Math.sin(phi) * Math.cos(th), dz = Math.sin(phi) * Math.sin(th), dy = Math.cos(phi);
      const n = nz.noise3(dx * 1.3, dy * 1.3, dz * 1.3) * lob + nz.noise3(dx * 3.1, dy * 3.1, dz * 3.1) * lob * 0.3;
      const rr = r * (1 + n);
      let y = dy * rr * squash;
      if (y < 0) y *= 0.4;
      const ao = THREE.MathUtils.clamp(0.35 + 0.65 * (y / (r * squash) + 0.15) * 1.4, 0.3, 1);
      B.a = ao; B.c = [1, 1, 1]; B.t = 0;
      B.v(dx * rr, y + r * 0.08, dz * rr, j / seg, i / rows);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < seg; j++) {
    const a = b0 + i * (seg + 1) + j, c = a + seg + 1;
    B.tri(a, a + 1, c); B.tri(a + 1, c + 1, c);
  }
  return B.toGeometry();
}

// ------------------------------------------------------------------ plates: table coral and whorl / shelf plates
/** one plate: a curled disc sector. center, frame (n = plate normal), R, arc (rad), thickness, curl (edge lift / R) */
function plate(B, nz, rng, center, n, R, { arc = Math.PI * 2, a0 = 0, thick = 0.035, curl = 0.15, wav = 0.12, rings = 6, sectors = 30, tipCol = null } = {}) {
  const u = perp(n), w = new V().crossVectors(n, u);
  const full = arc >= Math.PI * 1.99;
  const S = full ? sectors : Math.max(6, Math.round(sectors * arc / (Math.PI * 2)));
  const grid = (side) => {
    const base = B.n;
    for (let i = 0; i <= rings; i++) {
      const fr = i / rings;
      for (let j = 0; j <= S; j++) {
        const th = a0 + (j / S) * arc;
        const ct = Math.cos(th), st = Math.sin(th);
        const edge = 1 + wav * nz.noise2(ct * 1.7 + center.x * 3, st * 1.7 + center.z * 3) + wav * 0.35 * nz.noise2(ct * 3.5, st * 3.5);
        const rr = R * fr * edge * (full ? 1 : (0.35 + 0.65 * Math.sin(Math.PI * (j / S)) ** 0.5));
        const lift = curl * R * fr * fr + 0.02 * R * nz.noise2(ct * 3 + 9, st * 3);
        const off = side > 0 ? 0 : -thick * (1 - 0.6 * fr);
        B.a = side > 0 ? 0.75 + 0.25 * fr : 0.35 + 0.3 * fr; B.t = fr * fr; B.s = 0;
        if (tipCol) B.c = mixC([0.85, 0.85, 0.85], tipCol, fr * fr);
        const p = center.clone().addScaledVector(u, ct * rr).addScaledVector(w, st * rr).addScaledVector(n, lift + off);
        B.vv(p, fr, j / S);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < S; j++) {
      const a = base + i * (S + 1) + j, c = a + S + 1;
      if (side < 0) { B.tri(a, a + 1, c); B.tri(a + 1, c + 1, c); } else { B.tri(a, c, a + 1); B.tri(a + 1, c, c + 1); }
    }
    return base;
  };
  const top = grid(1), bot = grid(-1);
  // rim
  const o = rings * (S + 1);
  for (let j = 0; j < S; j++) { const a = top + o + j, b = bot + o + j; B.tri(a, b, a + 1); B.tri(a + 1, b, b + 1); }
}

export function tableCoral(rng, { R = 0.7, tiers = 1, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const nz = noiseFor(rng);
  const h = rng.range(0.18, 0.35);
  B.c = [0.8, 0.8, 0.8]; B.a = 0.5;
  tube(B, growPath(rng, new V(), UP, h, 3, { wander: 0.08 }), (t) => 0.07 * (1.3 - 0.5 * t), { radial: 7, cap: 'none', attr: (t) => { B.a = 0.4 + 0.3 * t; } });
  for (let k = 0; k < tiers; k++) {
    const c = new V(rng.range(-0.05, 0.05), h + k * R * 0.22, rng.range(-0.05, 0.05));
    const n = new V(rng.range(-0.12, 0.12), 1, rng.range(-0.12, 0.12)).normalize();
    plate(B, nz, rng, c, n, R * (1 - k * 0.25), { thick: 0.05, curl: 0.06, wav: 0.16, rings: Math.round(7 * detail) + 2, sectors: Math.round(34 * detail) + 8 });
  }
  return B.toGeometry();
}

/** rosette of curled plates (Turbinaria / lettuce coral / shelf whorl): plates rise and open outward */
export function whorlCoral(rng, { R = 0.45, plates = 6, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const nz = noiseFor(rng);
  B.c = [0.8, 0.8, 0.8]; B.a = 0.45;
  tube(B, [new V(0, -0.02, 0), new V(0, R * 0.25, 0)], R * 0.18, { radial: 7, cap: 'none' });
  for (let k = 0; k < plates; k++) {
    const az = (k / plates) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const h = (0.08 + 0.55 * rng.random()) * R;
    const out = new V(Math.cos(az), 0, Math.sin(az));
    const tilt = rng.range(0.35, 0.85);
    const n = new V(0, Math.cos(tilt), 0).addScaledVector(out, Math.sin(tilt)).normalize();
    const u = perp(n), w = new V().crossVectors(n, u);
    const arc = rng.range(1.8, 2.8);
    const phi = Math.atan2(out.dot(w), out.dot(u));
    const c = out.clone().multiplyScalar(R * rng.range(0.02, 0.12)).add(new V(0, h, 0));
    B.c = [1, 1, 1];
    plate(B, nz, rng, c, n, R * rng.range(0.6, 1.0), {
      arc, a0: phi - arc / 2, thick: 0.022, curl: rng.range(0.25, 0.5), wav: 0.1,
      rings: Math.round(4 * detail) + 3, sectors: Math.round(20 * detail) + 10,
    });
  }
  return B.toGeometry();
}

/** finger / lobe coral: a mound of blunt upright fingers */
export function fingerCoral(rng, { R = 0.3, fingers = 22, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const lo = detail < 0.3;
  const radial = detail >= 0.9 ? 7 : lo ? 4 : 5;
  const nf = Math.round(fingers * rng.range(0.7, 1.3) * (lo ? 0.6 : 1));
  for (let i = 0; i < nf; i++) {
    const a = rng.range(0, Math.PI * 2), rr = R * Math.sqrt(rng.random());
    const base = new V(Math.cos(a) * rr, -0.02, Math.sin(a) * rr);
    const lean = (rr / R) * rng.range(0.25, 0.7);
    const d = new V(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
    const len = R * rng.range(0.5, 1.1) * (1.1 - 0.5 * rr / R);
    const r = R * rng.range(0.09, 0.14);
    B.c = [1, 1, 1];
    const pts = growPath(rng, base, d, len, lo ? 2 : 3, { wander: 0.12, up: 0.05 });
    tube(B, pts, (t) => r * (1 + 0.15 * Math.sin(t * 5 + i)), { radial, cap: 'round', attr: (t) => { B.a = 0.45 + 0.55 * t; B.t = t * t; B.s = 0; } });
  }
  return B.toGeometry();
}

// ------------------------------------------------------------------ branching corals (staghorn / bush / soft tree)
function branch(B, rng, p0, dir, len, rad, depth, o, out) {
  const segs = Math.max(2, Math.round((o.segs ?? 4) * Math.min(1, len / 0.25) + 1));
  const pts = growPath(rng, p0, dir, len, segs, { up: o.up, wander: o.wander });
  const isTip = depth >= o.depth || len < o.minLen;
  const t0 = o.tipStart ?? 0;
  tube(B, pts, (t) => rad * (1 - (isTip ? 0.75 : 0.35) * t), {
    radial: o.radial, cap: isTip ? 'round' : 'none',
    attr: (t) => { B.a = Math.min(1, 0.45 + 0.15 * depth + 0.3 * t); B.t = isTip ? t : 0; B.s = (o.sway ?? 0) * (depth + t) / (o.depth + 1); },
  });
  if (isTip) { out.push({ p: pts[pts.length - 1], d: new V().subVectors(pts[pts.length - 1], pts[pts.length - 2]).normalize(), depth }); return; }
  const kids = rng.int(o.kids[0], o.kids[1]);
  for (let k = 0; k < kids; k++) {
    const at = pts[Math.min(pts.length - 1, Math.max(1, Math.round(rng.range(0.6, 1.0) * (pts.length - 1))))];
    const d0 = new V().subVectors(pts[pts.length - 1], pts[pts.length - 2]).normalize();
    const side = perp(d0).applyAxisAngle(d0, rng.range(0, Math.PI * 2));
    const ang = rng.range(o.spread[0], o.spread[1]);
    const nd = d0.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang)).normalize();
    branch(B, rng, at, nd, len * rng.range(o.decay[0], o.decay[1]), rad * 0.72, depth + 1, o, out);
  }
}

const BRANCH_STYLES = {
  // Acropora cervicornis-like: long antlers, pale tips
  staghorn: { primaries: [4, 7], len: [0.3, 0.55], rad: 0.042, depth: 2, kids: [1, 3], spread: [0.4, 0.85], decay: [0.6, 0.85], up: 0.08, wander: 0.1, radial: 6, minLen: 0.06, lean: [0.3, 0.95], sway: 0 },
  // Pocillopora / Seriatopora bush: dense short branches
  bush: { primaries: [6, 10], len: [0.12, 0.2], rad: 0.026, depth: 3, kids: [2, 3], spread: [0.3, 0.7], decay: [0.65, 0.9], up: 0.1, wander: 0.15, radial: 5, minLen: 0.03, lean: [0.1, 0.9], sway: 0 },
  // soft "tree" coral (Dendronephthya-like): fleshy trunk, many twigs ending in polyp knobs
  softtree: { primaries: [3, 5], len: [0.22, 0.36], rad: 0.045, depth: 2, kids: [2, 4], spread: [0.45, 0.95], decay: [0.55, 0.8], up: 0.1, wander: 0.18, radial: 6, minLen: 0.04, lean: [0.0, 0.6], sway: 0.05, knobs: true },
  // gorgonian whip / sea rod: long thin wavy rods
  whip: { primaries: [4, 8], len: [0.5, 0.9], rad: 0.012, depth: 1, kids: [1, 2], spread: [0.15, 0.4], decay: [0.6, 0.9], up: 0.14, wander: 0.1, radial: 4, minLen: 0.1, lean: [0.1, 0.5], sway: 0.12 },
};

export function branchingCoral(rng, style = 'staghorn', { detail = 1 } = {}) {
  const o = { ...BRANCH_STYLES[style] };
  o.radial = Math.max(3, Math.round(o.radial * Math.min(1, 0.5 + detail * 0.5)));
  const lo = detail < 0.3;
  if (lo) { o.primaries = o.primaries.map((x) => Math.max(2, Math.round(x * 0.6))); o.depth = Math.max(1, o.depth - 1); o.radial = 3; o.segs = 2; o.len = o.len.map((x) => x * 1.25); o.rad *= 1.3; }
  const B = new GeoBuilder();
  B.c = [1, 1, 1];
  const tips = [];
  const np = rng.int(o.primaries[0], o.primaries[1]);
  for (let i = 0; i < np; i++) {
    const az = (i / np) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const lean = rng.range(o.lean[0], o.lean[1]);
    const d = new V(Math.cos(az) * Math.sin(lean), Math.cos(lean), Math.sin(az) * Math.sin(lean)).normalize();
    const p0 = new V(rng.range(-0.04, 0.04), 0, rng.range(-0.04, 0.04));
    branch(B, rng, p0, d, rng.range(o.len[0], o.len[1]), o.rad * rng.range(0.8, 1.2), 0, o, tips);
  }
  if (o.knobs) {
    // polyp clusters: small lumpy balls at every tip
    const ico = ball(0);
    const m = new THREE.Matrix4();
    for (const t of tips) {
      const n = lo ? 1 : rng.int(2, 4);
      for (let k = 0; k < n; k++) {
        const r = rng.range(0.018, 0.034) * (lo ? 1.8 : 1);
        const p = t.p.clone().addScaledVector(t.d, rng.range(0, 0.03)).add(new V(rng.range(-0.025, 0.025), rng.range(-0.01, 0.02), rng.range(-0.025, 0.025)));
        m.makeScale(r, r, r).setPosition(p);
        B.a = 1; B.t = 1; B.s = o.sway;
        B.addGeometry(ico, m);
      }
    }
  }
  return B.toGeometry();
}

// ------------------------------------------------------------------ sponges
export function tubeSponge(rng, { n = 5, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const lo = detail < 0.3;
  const seg = lo ? 6 : Math.max(8, Math.round(14 * detail));
  const count = rng.int(Math.max(2, n - 2), n + 2) - (lo ? 1 : 0);
  for (let k = 0; k < count; k++) {
    const r = rng.range(0.035, 0.075), h = rng.range(0.16, 0.6);
    const base = new V(rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12));
    const lx = rng.range(-0.25, 0.25), lz = rng.range(-0.25, 0.25);
    const flare = rng.range(1.0, 1.35), wall = rng.range(0.012, 0.02);
    const prof = [];
    const rows = lo ? 3 : 6;
    for (let i = 0; i <= rows; i++) { const t = i / rows; prof.push([r * (1 + (flare - 1) * t * t) * (1 + 0.15 * Math.sin(t * 9 + k)), h * t, 0.45 + 0.55 * t, 0]); }
    const top = prof[prof.length - 1];
    prof.push([top[0] + 0.004, h + 0.008, 1, 0.6]);           // lip
    prof.push([top[0] - wall, h + 0.004, 0.9, 0.4]);
    for (let i = rows; i >= (lo ? 1 : 2); i--) { const t = i / rows; prof.push([Math.max(0.01, prof[i][0] - wall), h * t, 0.12 + 0.35 * (t - 0.3), 0]); }
    lathe(B, prof, seg, { base, bend: (y) => [lx * y * y / h, lz * y * y / h], col: () => [1, 1, 1], rFn: (th) => 1 + 0.04 * Math.sin(th * 3 + k) });
  }
  return B.toGeometry();
}

export function barrelSponge(rng, { R = 0.45, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const seg = Math.max(16, Math.round(40 * detail));
  const H = R * rng.range(1.6, 2.4), ridges = rng.int(9, 15), wall = R * 0.16;
  const prof = [];
  const rows = 9;
  for (let i = 0; i <= rows; i++) { const t = i / rows; prof.push([R * (0.5 + 0.45 * Math.sin(Math.PI * (0.2 + 0.5 * t)) + 0.15 * t), H * t, 0.4 + 0.6 * t, 0]); }
  const top = prof[rows][0];
  prof.push([top - wall * 0.5, H + 0.02, 1, 0.5]);
  prof.push([top - wall, H, 0.7, 0]);
  for (let i = rows - 1; i >= 3; i--) { const t = i / rows; prof.push([prof[i][0] - wall * (1.2 + t), H * t, 0.1 + 0.4 * (t - 0.3), 0]); }
  lathe(B, prof, seg, {
    col: () => [1, 1, 1],
    rFn: (th, j, r, y, i) => (i <= rows + 1 ? 1 + 0.07 * Math.pow(Math.abs(Math.cos(th * ridges * 0.5)), 3) : 1),
  });
  return B.toGeometry();
}

/** low encrusting / rubble sponge-coral lump (fills gaps, cheap) */
export function lumpCoral(rng, { r = 0.25, detail = 1 } = {}) {
  const g = ball(detail >= 0.9 ? 1 : 0.5).clone();
  const nz = noiseFor(rng);
  const p = g.attributes.position, v = new V();
  const B = new GeoBuilder();
  const sq = rng.range(0.35, 0.65);
  const m = new THREE.Matrix4();
  B.c = [0.9, 0.9, 0.9];
  B.addGeometry(g, m, (b, i, vv) => {
    v.copy(vv);
    const n = 1 + 0.35 * nz.noise3(v.x * 1.6, v.y * 1.6, v.z * 1.6) + 0.12 * nz.noise3(v.x * 4, v.y * 4, v.z * 4);
    vv.set(v.x * r * n, Math.max(-0.1, v.y) * r * sq * n, v.z * r * n);
    b.a = THREE.MathUtils.clamp(0.4 + vv.y / (r * sq) * 0.8, 0.3, 1);
  });
  return B.toGeometry();
}

// ------------------------------------------------------------------ anemones & urchins
export function anemone(rng, { r = 0.1, tentacles = 60, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const h = r * rng.range(0.6, 1.2);
  lathe(B, [[r * 0.8, 0, 0.4], [r * 0.85, h * 0.6, 0.7], [r * 1.05, h, 0.9], [r * 0.4, h * 1.02, 0.6], [0.01, h * 0.96, 0.3]], 16, { col: () => [0.8, 0.8, 0.8] });
  const nt = Math.round(tentacles * (detail < 0.3 ? 0.25 : Math.max(0.5, detail)));
  for (let i = 0; i < nt; i++) {
    const ring = rng.random();
    const az = rng.range(0, Math.PI * 2), rr = r * (0.35 + 0.65 * ring);
    const p0 = new V(Math.cos(az) * rr, h, Math.sin(az) * rr);
    const out = new V(Math.cos(az), 0, Math.sin(az));
    const d = out.clone().multiplyScalar(0.3 + 0.6 * ring).add(new V(0, 1, 0)).normalize();
    const L = r * rng.range(0.9, 1.6);
    const pts = growPath(rng, p0, d, L, detail < 0.3 ? 2 : 4, { wander: 0.25, gravity: 0.08 * ring });
    tube(B, pts, (t) => r * 0.06 * (1 - 0.6 * t), { radial: 3, cap: 'round', attr: (t) => { B.a = 0.6 + 0.4 * t; B.t = t; B.s = 0.03 * t; B.c = mixC([0.9, 0.9, 0.9], [1.3, 1.3, 1.3], t * t); } });
  }
  return B.toGeometry();
}

export function urchin(rng, { r = 0.06, spikes = 90, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const ico = ball(1);
  const m = new THREE.Matrix4().makeScale(r, r * 0.8, r).setPosition(0, r * 0.6, 0);
  B.c = [0.35, 0.35, 0.35]; B.a = 0.6;
  B.addGeometry(ico, m);
  const ns = Math.round(spikes * (detail < 0.3 ? 0.35 : Math.max(0.5, detail)));
  const c = new V(0, r * 0.6, 0);
  for (let i = 0; i < ns; i++) {
    // fibonacci sphere, upper 80 %
    const y = 1 - (i / (ns - 1)) * 1.5, rad = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.399963;
    const d = new V(Math.cos(th) * rad, y, Math.sin(th) * rad).normalize();
    const L = r * rng.range(1.8, 3.4);
    const p0 = c.clone().addScaledVector(d, r * 0.85);
    tube(B, [p0, p0.clone().addScaledVector(d, L)], (t) => r * 0.07 * (1 - 0.9 * t), { radial: 3, cap: 'point', attr: (t) => { B.a = 0.7 + 0.3 * t; B.t = t; B.s = 0; B.c = mixC([0.8, 0.8, 0.8], [1.15, 1.15, 1.15], t); } });
  }
  return B.toGeometry();
}

// ------------------------------------------------------------------ sea grass / algae tufts
export function grassTuft(rng, { blades = 18, height = 0.4, radius = 0.08, width = 0.012, detail = 1, palette = null } = {}) {
  const B = new GeoBuilder();
  const segs = detail >= 0.9 ? 5 : 3;
  const pal = palette || [lin(110, 140, 50), lin(150, 160, 62), lin(172, 166, 82), lin(92, 124, 46)];
  for (let i = 0; i < blades; i++) {
    const a = rng.range(0, Math.PI * 2), r = radius * Math.sqrt(rng.random());
    const base = new V(Math.cos(a) * r, -0.02, Math.sin(a) * r);
    const dir = new V(Math.cos(a + rng.range(-0.6, 0.6)), 0, Math.sin(a + rng.range(-0.6, 0.6))).normalize();
    const side = new V(-dir.z, 0, dir.x);
    const h = height * rng.range(0.45, 1.15), w = width * rng.range(0.7, 1.3);
    const c = pal[rng.int(0, pal.length - 1)].map((x) => x * rng.range(0.8, 1.2));
    let ang = rng.range(0.05, 0.35) + (r / radius) * 0.35;
    const curl = rng.range(0.3, 1.2);
    let p = base.clone();
    const b0 = B.n;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const ww = w * (1 - Math.pow(t, 3)) + 0.0005;
      B.c = mixC(scaleC(c, 0.55), c, Math.min(1, t * 1.5)); B.a = 0.35 + 0.65 * Math.min(1, t * 1.4); B.s = t * t * h * 0.25; B.t = t;
      B.v(p.x - side.x * ww, p.y, p.z - side.z * ww, 0, t);
      B.v(p.x + side.x * ww, p.y, p.z + side.z * ww, 1, t);
      ang += curl * (1 / segs) * 0.9;
      const dl = h / segs;
      p = p.clone().add(new V(dir.x * Math.sin(ang) * dl, Math.cos(ang) * dl, dir.z * Math.sin(ang) * dl));
    }
    for (let s = 0; s < segs; s++) { const k = b0 + s * 2; B.tri(k, k + 1, k + 3); B.tri(k, k + 3, k + 2); }
  }
  return B.toGeometry();
}

// ------------------------------------------------------------------ sea fan card (atlas cell) on a curved grid with a short stalk
export function seaFan(rng, { cell = [0, 0, 0.5, 0.5], w = 1.0, h = 1.0, detail = 1 } = {}) {
  const B = new GeoBuilder();
  const [u0, v0, u1, v1] = cell;
  const nx = detail >= 0.9 ? 6 : 4, ny = detail >= 0.9 ? 7 : 4;
  const bendX = rng.range(-0.12, 0.12) * w, bendZ = rng.range(0.05, 0.22) * w;
  const b0 = B.n;
  for (let j = 0; j <= ny; j++) {
    const v = j / ny;
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const x = (u - 0.5) * w, y = v * h;
      const z = bendZ * Math.pow(2 * u - 1, 2) + 0.06 * h * v * v + bendX * v * (2 * u - 1);
      B.a = 0.6 + 0.4 * v; B.s = 0.07 * v * v * h; B.t = v; B.c = [1, 1, 1];
      B.v(x, y, z, u0 + (u1 - u0) * u, v0 + (v1 - v0) * v);
    }
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = b0 + j * (nx + 1) + i, c = a + nx + 1;
    B.tri(a, a + 1, c); B.tri(a + 1, c + 1, c);
  }
  return B.toGeometry();
}

// ------------------------------------------------------------------ palettes (linear albedo, before the medium)
// Saturated reef colours: the water absorbs red with distance, so close-up they read orange/red/purple.
export const PALETTES = {
  brain: [lin(196, 168, 96), lin(160, 150, 92), lin(190, 140, 110), lin(150, 170, 120), lin(210, 190, 140)],
  table: [lin(170, 150, 110), lin(150, 120, 150), lin(190, 160, 120), lin(120, 140, 120)],
  whorl: [lin(230, 120, 40), lin(220, 150, 50), lin(200, 90, 50), lin(230, 180, 70), lin(170, 90, 140)],
  staghorn: [lin(215, 190, 120), lin(190, 150, 190), lin(225, 170, 100), lin(200, 200, 140)],
  bush: [lin(220, 70, 50), lin(230, 110, 50), lin(200, 60, 90), lin(240, 150, 60), lin(160, 80, 170)],
  softtree: [lin(240, 110, 40), lin(225, 60, 50), lin(235, 160, 60), lin(200, 70, 140), lin(240, 200, 90)],
  whip: [lin(150, 70, 160), lin(220, 120, 50), lin(200, 180, 80)],
  finger: [lin(235, 120, 40), lin(225, 150, 60), lin(210, 100, 60), lin(180, 120, 170), lin(230, 180, 90)],
  tube: [lin(230, 110, 40), lin(200, 80, 50), lin(150, 80, 170), lin(220, 170, 70), lin(120, 110, 190)],
  barrel: [lin(150, 80, 60), lin(170, 110, 80), lin(130, 70, 80)],
  lump: [lin(150, 120, 140), lin(190, 120, 90), lin(140, 140, 110), lin(200, 160, 120), lin(160, 90, 140)],
  anemone: [lin(180, 120, 210), lin(230, 140, 80), lin(140, 200, 140), lin(230, 200, 160)],
  urchin: [lin(70, 40, 60), lin(220, 140, 70), lin(230, 220, 210), lin(60, 50, 70)],
  fan: [lin(170, 60, 170), lin(220, 70, 60), lin(235, 140, 50), lin(235, 200, 80), lin(140, 70, 200), lin(210, 60, 110)],
};
