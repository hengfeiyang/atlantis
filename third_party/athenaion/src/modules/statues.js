// Statues module: Athena colossi (layout.COLOSSI), draped statues on pedestals (engine.slots.statue or
// fallback positions on the terraces / grand stair), pediment groups + metope reliefs
// (engine.registry.temple) and the statue inside the island tholos.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { statueMaterial } from '../sculpt/statueMaterial.js';
import { colossusGeometries, SHIELD_STYLE, shieldMatrix } from '../sculpt/library.js';
import { statueLibrary } from '../sculpt/statuary-lib.js';
import { SHOTS } from '../world/shots.js';
import { composePediment, composeMetope } from '../sculpt/pediment.js';
import { mouldedBlock, profileBuilder, reliefMedallion, emblemTextureCached } from '../sculpt/props.js';
import { mergeGeos, withColor } from '../sculpt/bakeutil.js';

const DEG = Math.PI / 180;

// ------------------------------------------------------------------ colossus
/** tall moulded pedestal for a colossus (metres). Returns geometry with top at y = h */
export function colossusPedestalGeometry(w, d, h) {
  // (r3) tall pedestals (> 8 m) become a battered masonry bastion with a string course carrying a
  // moulded pedestal of ~5.5 m (ref 5: cornice-capped pedestal on a bastion with a banner)
  const hb = h > 8 ? h - Math.min(5.5, h * 0.45) : 0, hp = h - hb;
  const k = hp / 11;
  const pb = profileBuilder();
  let bastionTop = 0;
  if (hb > 0) {
    const bo = 1.3 * k + 0.55; // bastion face: a little proud of the pedestal base
    pb.up(bo + 0.18, 0.5).up(bo + 0.1, hb * 0.5 - 0.5).up(bo, hb * 0.5 - 0.42);
    bastionTop = pb.y;
    pb.up(bo + 0.14, 0.16).cyma(bo + 0.14, bo + 0.24, 0.16).up(bo + 0.26, 0.1); // string course
    pb.up(bo - 0.05, 0.0);
  }
  // stepped base
  pb.up(1.3 * k, 0.55 * k).up(0.95 * k, 0.5 * k).up(0.62 * k, 0.12 * k)
    .torus(0.42 * k, 0.2 * k).cove(0.42 * k, 0.16 * k, 0.25 * k).up(0.14 * k, 0.12 * k).torus(0.12 * k, 0.1 * k).cyma(0.12 * k, 0, 0.3 * k);
  const dieTop = h - 2.1 * k;
  const dieBottom = pb.y;
  // (r6) die, astragal, a garlanded frieze, then a cornice with a dentil course (ref 5: richly moulded pedestal)
  const friezeH = 1.0 * k;
  pb.up(0, dieTop - friezeH - pb.y).torus(0, 0.05 * k).up(0, dieTop - pb.y);
  pb.up(0.05 * k, 0.06 * k).cyma(0.05 * k, 0.2 * k, 0.2 * k).up(0.2 * k, 0.24 * k)
    .cyma(0.2 * k, 0.6 * k, 0.26 * k).up(0.68 * k, 0.5 * k).up(0.6 * k, 0.08 * k).cyma(0.6 * k, 0.78 * k, 0.22 * k).up(0.8 * k, 0.08 * k).up(0.55 * k, 0.0);
  // statue plinth on top
  pb.up(0.4 * k, 0.0).up(0.4 * k, 0.45 * k).up(0.46 * k, 0.06 * k).up(0.4 * k, 0.0);
  const g = mouldedBlock(pb.pts, w / 2, d / 2, {
    aoProfile: (j) => {
      const [, y] = pb.pts[j];
      return y < 0.05 ? 0.55 : hb > 0 && Math.abs(y - bastionTop - 0.3) < 0.35 ? 0.8 : 1;
    },
  });
  g.userData = { top: pb.y, dieBottom, dieTop, friezeBottom: dieTop - friezeH, bastionTop, bastionOut: hb > 0 ? 1.3 * k + 0.55 : 0, k };
  return g;
}

// ------------------------------------------------------------------ (r6) pedestal ornament
const FACES = [
  { N: [0, 0, 1], T: [1, 0, 0] }, { N: [1, 0, 0], T: [0, 0, -1] }, { N: [0, 0, -1], T: [-1, 0, 0] }, { N: [-1, 0, 0], T: [0, 0, 1] },
];
/** map a face-local geometry (x along the face, y up, z out of the face) onto pedestal face f */
function onFace(geo, f, w, d, out = 0) {
  const F = FACES[f], half = F.N[0] !== 0 ? w / 2 : d / 2;
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...F.T), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...F.N));
  m.setPosition(F.N[0] * (half + out), 0, F.N[2] * (half + out));
  geo.applyMatrix4(m);
  return geo;
}
/** occlusion against the wall behind (face-local, before onFace): back-facing / low parts darker */
function wallAO(geo, k = 0.45) {
  const n = geo.attributes.normal.array, c = geo.attributes.color.array;
  for (let i = 0; i < n.length / 3; i++) {
    const ao = Math.max(0.3, Math.min(1, 1 - k + k * (0.5 + 0.5 * n[i * 3 + 2]) + 0.12 * n[i * 3 + 1]));
    c[i * 3] = Math.round(ao * 255);
  }
  return geo;
}
/** leafy laurel swag hanging between (u0, y) and (u1, y), sagging by sag; face-local, z out of the wall */
function swagGeometry(u0, u1, y, sag, r0, seed = 0) {
  const S = 44, R = 8;
  const pos = [], idx = [];
  for (let i = 0; i <= S; i++) {
    const t = i / S;
    const u = u0 + (u1 - u0) * t, v = y - sag * 4 * t * (1 - t);
    const du = u1 - u0, dv = -sag * 4 * (1 - 2 * t);
    const tl = Math.hypot(du, dv), tu = du / tl, tv = dv / tl;
    const bulk = 0.42 + 0.58 * Math.sin(Math.PI * t);
    const leaf = 0.92 + 0.22 * Math.abs(Math.sin(t * Math.PI * 18 + seed));
    const r = r0 * bulk * leaf;
    for (let j = 0; j <= R; j++) {
      const a = (j / R) * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      const nx = -tv * cx, ny = tu * cx, nz = cz;
      const lob = 1 + 0.1 * Math.sin(a * 3 + t * 40 + seed);
      pos.push(u + nx * r * lob, v + ny * r * lob, r * 0.75 + nz * r * lob * 0.9);
    }
  }
  for (let i = 0; i < S; i++) for (let j = 0; j < R; j++) {
    const a = i * (R + 1) + j, b = a + R + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // outward winding: the ring vertex at a = PI/2 (j = R/4) of the middle ring must face +z
  const mid = (S >> 1) * (R + 1) + (R >> 2);
  if (g.attributes.normal.array[mid * 3 + 2] < 0) {
    const ix = g.index.array;
    for (let t = 0; t < ix.length; t += 3) { const b = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = b; }
    g.computeVertexNormals();
  }
  return withColor(g, 1, 0.3, 0);
}
function rosetteGeometry(r) {
  const g = new THREE.SphereGeometry(r, 16, 8);
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) {
    const a = Math.atan2(p[i + 1], p[i]);
    const kk = 1 + 0.16 * Math.cos(a * 8);
    p[i] *= kk; p[i + 1] *= kk; p[i + 2] = Math.max(-0.05 * r, p[i + 2] * 0.42);
  }
  g.computeVertexNormals();
  return withColor(g, 1, 0.2, 0);
}
const box = (w, h, d, x, y, z) => withColor(new THREE.BoxGeometry(w, h, d).translate(x, y, z), 1, 0, 0);

/** dentils, garlands with rosettes and ribbons, corner pilasters, tablet frames (merged, pedestal space) */
export function pedestalOrnaments(w, d, U, opts = {}) {
  const k = U.k, parts = [];
  const fb = U.friezeBottom, dt = U.dieTop;
  for (let f = 0; f < 4; f++) {
    const L = FACES[f].N[0] !== 0 ? d : w;
    const loc = [];
    // dentil course
    const dy0 = dt + 0.28 * k, dh = 0.2 * k, dw = 0.13 * k, sp = 0.22 * k, dz = 0.16 * k;
    const nD = Math.floor((L + 0.36 * k) / sp);
    for (let i = 0; i < nD; i++) loc.push(box(dw, dh, dz, -((nD - 1) * sp) / 2 + i * sp, dy0 + dh / 2, 0.2 * k + dz / 2 - 0.01));
    // corner pilasters on the die (capital under the astragal, base on the die foot)
    for (const sgn of [-1, 1]) {
      const u = sgn * (L / 2 - 0.28 * k), h = fb - U.dieBottom;
      loc.push(box(0.5 * k, h - 0.2 * k, 0.07 * k, u, U.dieBottom + h / 2, 0.035 * k));
      loc.push(box(0.6 * k, 0.12 * k, 0.12 * k, u, fb - 0.08 * k, 0.06 * k));
      loc.push(box(0.6 * k, 0.1 * k, 0.11 * k, u, U.dieBottom + 0.05 * k, 0.055 * k));
    }
    // laurel swags on the frieze between rosettes, ribbons hanging at the knots
    const span = 3.0 * k, inner = L - 0.8 * k;
    const nS = Math.max(2, Math.round(inner / span)), sp2 = inner / nS;
    const yTop = dt - 0.18 * k, sag = 0.58 * k;
    for (let i = 0; i <= nS; i++) {
      const u = -inner / 2 + i * sp2;
      loc.push(rosetteGeometry(0.16 * k).translate(u, yTop + 0.02 * k, 0.02 * k));
      if (i < nS) loc.push(wallAO(swagGeometry(u + 0.12 * k, u + sp2 - 0.12 * k, yTop - 0.04 * k, sag, 0.19 * k, i * 1.7 + f)));
      for (const sgn of [-1, 1]) loc.push(box(0.05 * k, 0.42 * k, 0.025 * k, u + sgn * 0.07 * k, yTop - 0.3 * k, 0.03 * k));
    }
    // moulded frames of the inscription tablets (front face)
    if (f === 0 && opts.tablets) {
      for (const T of opts.tablets) {
        const { u, y, tw, th } = T, fr = 0.09 * k;
        loc.push(box(tw + 2 * fr, fr, 0.08 * k, u, y + th / 2 + fr / 2, 0.04 * k), box(tw + 2 * fr, fr, 0.08 * k, u, y - th / 2 - fr / 2, 0.04 * k));
        loc.push(box(fr, th, 0.08 * k, u - tw / 2 - fr / 2, y, 0.04 * k), box(fr, th, 0.08 * k, u + tw / 2 + fr / 2, y, 0.04 * k));
      }
    }
    parts.push(onFace(mergeGeos(loc), f, w, d));
  }
  return mergeGeos(parts);
}

/** inscription tablet texture (R = relief, G = gilding mask): incised, gilded Greek capitals */
const tabletTexCache = new Map();
function tabletTexture(text) {
  if (tabletTexCache.has(text)) return tabletTexCache.get(text);
  const W = 1024, H = 256;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const c = cv.getContext('2d');
  c.fillStyle = 'rgb(200,0,0)'; c.fillRect(0, 0, W, H);
  c.font = 'bold 150px "Times New Roman", Georgia, serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const m = c.measureText(text), sx = Math.min(1, (W * 0.88) / m.width);
  c.save(); c.translate(W / 2, H / 2 + 6); c.scale(sx, 1);
  c.fillStyle = 'rgb(70,255,0)'; c.fillText(text, 0, 0);
  c.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tabletTexCache.set(text, tex);
  return tex;
}
function tabletGeometry(tw, th) {
  const g = new THREE.PlaneGeometry(tw, th);
  const n = g.attributes.position.count;
  const col = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = 235; col[i * 3 + 1] = 20; col[i * 3 + 2] = 0; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  return g;
}

/**
 * Build one colossus: figure + spear + shield on a pedestal. Returns a Group (pedestal base at origin, facing +Z).
 * size = figure height (m), pedH = pedestal height (m)
 */
export async function buildColossus(engine, variant, size, pedH, detail = 1, opts = {}) {
  const mir = opts.mirror ? -1 : 1; // mirrored figure: spear in the left hand, shield on the right (shield itself is not mirrored)
  const C = await colossusGeometries(variant, detail);
  const s = size / 2.0;
  const msc = +(2.6 / size).toFixed(3); // weathering scale follows the statue size
  // (r6) stronger bounce fill: the colossus stands over a big sunlit pedestal top and pavement (shaded folds stay legible)
  const mat = statueMaterial({ name: 'statueMarble', scale: msc, fill: 0.7 });
  const grp = new THREE.Group();
  grp.name = `colossus-${variant}`;
  // pedestal footprint from the figure + shield bounds
  // footprint on the plinth: feet, spear butt, shield rim contact (figure units)
  const sb = C.A.spear.base, sc = C.A.shield.c;
  const fx0 = Math.min(sb[0], -0.22) - 0.12, fx1 = Math.max(sc[0] + 0.3, 0.3) + 0.06;
  const fz0 = -0.34, fz1 = Math.max(sb[2], sc[2] + 0.2, 0.32) + 0.08;
  // opts.pedYaw: pedestal yaw relative to the figure (rad), e.g. to square it with a tower bastion;
  // the pedestal then covers the rotated footprint (AABB in its own axes)
  const yo = opts.pedYaw || 0;
  const w0 = (fx1 - fx0) * s, d0 = (fz1 - fz0) * s, ca = Math.abs(Math.cos(yo)), sa = Math.abs(Math.sin(yo));
  const w = w0 * ca + d0 * sa, dd = w0 * sa + d0 * ca;
  const ped = colossusPedestalGeometry(w, dd, pedH);
  // (r3) tall pedestals read as coursed ashlar (refs 1, 3, 5: masonry under the colossus, not a plain block)
  // (r6) greyer, weathered stone with rain-wash streaks and black crust (ref 5), not a clean cream block
  const pedMat = statueMaterial({ name: 'statuePedestal', scale: msc, dirt: 1.45, tint: [0.77, 0.755, 0.725], fill: 0.25, weather: 1.4, ashlar: +Math.max(0.75, (pedH / 11) * 1.05).toFixed(2) });
  const ornMat = statueMaterial({ name: 'statueOrnament', scale: msc, dirt: 1.3, tint: [0.84, 0.82, 0.785], fill: 0.3, weather: 0.6 });
  const pedMesh = new THREE.Mesh(ped, pedMat);
  pedMesh.name = 'pedestal';
  const pedGrp = new THREE.Group(); pedGrp.rotation.y = yo;
  pedGrp.add(pedMesh);
  grp.add(pedGrp);
  // carved owl-in-laurel medallions on the die faces
  {
    const { dieBottom, friezeBottom: dieTop, k } = ped.userData;
    const R = Math.min(dieTop - dieBottom, Math.min(w, dd)) * 0.38;
    const med = reliefMedallion(R, 'wreath', 96);
    const yc = (dieBottom + dieTop) * 0.5;
    // (r6) dentils, garlands, pilasters + two gilded inscription tablets flanking the front medallion
    const tw = Math.min(w * 0.3, 7 * k), th = (dieTop - dieBottom) * 0.42, tu = R + 0.35 * k + tw / 2;
    const tablets = tw > 1.2 * k ? [{ u: -tu, y: yc, tw, th, text: 'ΑΘΗΝΑ' }, { u: tu, y: yc, tw, th, text: 'ΠΑΡΘΕΝΟΣ' }] : [];
    const orn = new THREE.Mesh(pedestalOrnaments(w, dd, ped.userData, { tablets }), ornMat);
    orn.name = 'pedestal-ornament';
    pedGrp.add(orn);
    for (const T of tablets) {
      const tm = new THREE.Mesh(tabletGeometry(T.tw, T.th), statueMaterial({ name: 'statueTablet', scale: msc, emblem: tabletTexture(T.text), inscription: true, bumpScale: 1.5, tint: [0.8, 0.785, 0.75], weather: 0.5 }));
      tm.position.set(T.u, T.y, dd / 2 + 0.012);
      tm.name = 'tablet';
      pedGrp.add(tm);
    }
    // the front face carries a banner (slot pushed by build()) on tall pedestals: medallions on the others
    const faces = [[0, 0, dd / 2, 0], [w / 2, 0, 0, Math.PI / 2], [-w / 2, 0, 0, -Math.PI / 2], [0, 0, -dd / 2, Math.PI]].slice(opts.banner && !ped.userData.bastionTop ? 1 : 0);
    for (const [x, , z, ry] of faces) {
      const m = new THREE.Mesh(med, mat);
      m.position.set(x, yc, z);
      m.rotation.y = ry;
      pedGrp.add(m);
    }
  }
  const top = ped.userData.top;
  const fig = new THREE.Group();
  fig.position.set(-mir * (fx0 + fx1) * 0.5 * s, top, -(fz0 + fz1) * 0.5 * s);
  fig.scale.setScalar(s);
  const m1 = new THREE.Mesh(C.figure, mat); m1.name = 'figure';
  const m2 = new THREE.Mesh(C.shield, statueMaterial({ name: 'statueShield', emblem: await emblemTextureCached(SHIELD_STYLE[variant], 1024), bumpScale: 3, scale: msc })); m2.name = 'shield';
  const sh = C.A.shield;
  m2.applyMatrix4(mir < 0 ? shieldMatrix({ c: [-sh.c[0], sh.c[1], sh.c[2]], n: [-sh.n[0], sh.n[1], sh.n[2]] }) : C.shieldMatrix);
  const m3 = new THREE.Mesh(C.spear, mat); m3.name = 'spear';
  m3.position.set(C.A.spear.base[0], C.A.spear.base[1], C.A.spear.base[2]);
  const body = new THREE.Group(); body.scale.x = mir; // negative scale: three.js flips the winding itself
  body.add(m1, m3);
  fig.add(body, m2);
  grp.add(fig);
  grp.userData.tris = (C.figure.index.count + C.shield.index.count + C.spear.index.count) / 3;
  grp.userData.pedestal = { w, d: dd, yaw: yo, ...ped.userData };
  return grp;
}

// ------------------------------------------------------------------ generic statues on pedestals
/** pedestal for a ~2.0 m nominal figure: unit geometry (w=1, d=1, h~1), scaled per instance */
function smallPedestalGeometry() {
  const pb = profileBuilder();
  pb.up(0.6, 0.06).up(0.56, 0.03).torus(0.535, 0.025).cove(0.535, 0.505, 0.035).up(0.5, 0.02).cyma(0.5, 0.48, 0.03);
  pb.up(0.48, 0.79 - pb.y);
  pb.cyma(0.48, 0.52, 0.04).up(0.53, 0.015).cyma(0.53, 0.58, 0.05).up(0.6, 0.07).up(0.56, 0.0);
  const blk = mouldedBlock(pb.pts.map(([o, y]) => [o - 0.5, y]), 0.5, 0.5, {
    aoProfile: (j) => (pb.pts[j][1] < 0.03 ? 0.6 : 1),
  });
  // (r6) a laurel swag between two rosettes under the cornice of every face (die face at outset -0.02)
  const orn = [];
  for (let f = 0; f < 4; f++) {
    const loc = [rosetteGeometry(0.035).translate(-0.3, 0.73, 0.005), rosetteGeometry(0.035).translate(0.3, 0.73, 0.005), wallAO(swagGeometry(-0.27, 0.27, 0.72, 0.12, 0.032, f * 2.3))];
    for (const sx of [-1, 1]) loc.push(box(0.012, 0.09, 0.006, -0.3 * sx + 0.012, 0.66, 0.006));
    orn.push(onFace(mergeGeos(loc), f, 0.96, 0.96));
  }
  const g = mergeGeos([blk, ...orn]);
  g.userData = { top: pb.y };
  return g;
}

// statue slot tag (regexp, first match wins) → statue type pool (repeats weight the draw)
const TAG_POOLS = [
  [/shrine/, ['athenaMini', 'athenaMini', 'priestess']],
  [/niche/, ['koreStraps', 'koreOffering', 'athenaMini', 'priestess', 'femaleRaised']],
  [/temple-front|temple-flank/, ['athenaMini', 'koreStraps', 'koreOffering', 'priestess', 'athenaMini']],
  [/parapet|stair/, ['koreStraps', 'koreOffering', 'athenaMini', 'priestess', 'koreStraps', 'oratorScroll']],
  [/exedra/, ['oratorScroll', 'priestess', 'warrior', 'femaleRaised', 'koreOffering']],
  [/bastion/, ['athenaMini', 'warrior', 'koreOffering', 'priestess']],
];

/**
 * (r3) LOD by projected size: largest pixels-per-metre over the shot cameras that can see p (frustum test
 * with a margin), at the 1672x941 reference resolution. Telephoto shot 5 sees the pediments at ~22 px/m.
 */
const CAM_FRAMES = SHOTS.map((S) => {
  const P = new THREE.Vector3(...S.pos), F = new THREE.Vector3(...S.target).sub(P).normalize();
  const R = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize(), U = new THREE.Vector3().crossVectors(R, F);
  const tv = Math.tan(((S.fov / 2) * Math.PI) / 180);
  return { P, F, R, U, tv, th: tv * (1672 / 941) };
});
const _d = new THREE.Vector3();
export function pxPerMetre(x, y, z, margin = 0.15) {
  let best = 0;
  for (const c of CAM_FRAMES) {
    _d.set(x, y, z).sub(c.P);
    const zc = _d.dot(c.F);
    if (zc < 1) continue;
    if (Math.abs(_d.dot(c.R) / zc) > c.th * (1 + margin) || Math.abs(_d.dot(c.U) / zc) > c.tv * (1 + margin)) continue;
    best = Math.max(best, 470.5 / (c.tv * zc));
  }
  return best;
}
/** coarsest library LOD whose marching-cubes cell (0.017 / 0.04 / 0.08 figure units) stays under ~0.9 px */
const LOD_CELL = [0.015, 0.036, 0.08]; // (r6) matches statuary.js cell sizes
export function lodForScale(scale, ppm, maxPx = 0.9) {
  for (let l = 2; l > 0; l--) if (LOD_CELL[l] * scale * ppm <= maxPx) return l;
  return 0;
}

function shotCameras() {
  return SHOTS.map((s) => new THREE.Vector3(...s.pos));
}

/** candidate statue spots when no producer filled engine.slots.statue: terrace edges, plateau rim, temple front */
function fallbackSlots(engine, rng) {
  const levels = [96, 72, 50, 28, 10];
  const cands = [];
  const fp = engine.footprints;
  for (let x = -110; x <= 170; x += 3) {
    for (let z = -20; z <= 225; z += 3) {
      const h = heightAt(x, z);
      const lv = levels.find((l) => Math.abs(h - l) < 2.2);
      if (lv === undefined) continue;
      if (Math.abs(heightAt(x + 1.5, z) - h) > 0.5 || Math.abs(heightAt(x, z + 1.5) - h) > 0.5 || Math.abs(heightAt(x - 1.5, z) - h) > 0.5) continue;
      // near a drop (terrace edge)
      const drop = h - Math.min(heightAt(x, z + 6), heightAt(x + 4, z + 4), heightAt(x - 4, z + 4));
      if (drop < 4) continue;
      if (Math.abs(heightAt(x, z - 3) - h) > 0.8) continue;
      // face down the slope (compass heading of steepest descent; compass 0 = north = -z, 90 = east = +x)
      const gx = heightAt(x + 6, z) - heightAt(x - 6, z), gz = heightAt(x, z + 6) - heightAt(x, z - 6);
      const comp = ((Math.atan2(-gx, gz) * 180) / Math.PI + 360) % 360;
      cands.push({ pos: [x, h, z], comp });
    }
  }
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rng.random() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
  const out = [];
  const maxN = Math.round(46 * Math.max(0.5, engine.quality.density));
  for (const c of cands) {
    if (out.length >= maxN) break;
    if (out.some((o) => Math.hypot(o.pos[0] - c.pos[0], o.pos[2] - c.pos[2]) < 13)) continue;
    if (fp && !fp.isFree(c.pos[0], c.pos[2], 0.9)) continue;
    out.push({ pos: c.pos, facing: c.comp, tag: 'terrace', needsPedestal: true });
  }
  // a row in front of the west facade (ref 5)
  const T = L.TEMPLE;
  const fx = T.center[0] - T.stylobate[0] / 2 - 4.5;
  for (const dz of [-11, -4, 4, 11]) {
    const x = fx, z = T.center[2] + dz, h = heightAt(x, z);
    if (Math.abs(h - L.ACROPOLIS.top) > 2.5) continue;
    if (fp && !fp.isFree(x, z, 0.9)) continue;
    out.push({ pos: [x, h, z], facing: 270, tag: 'temple-front', needsPedestal: true });
  }
  return out;
}

/**
 * Place generic statues: slots = [{pos, facing, height?, pedestal?, type?}]
 * Returns { group, tris, count }
 */
async function placeStatues(engine, slots, lib) {
  const rng = engine.rng('statues-place');
  const mat = statueMaterial({ name: 'statueMarble' });
  const ped = smallPedestalGeometry();
  const buckets = new Map(); // key type|lod → matrices
  const pedMats = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const nTypes = lib.types.length;
  const lodN = [0, 0, 0];
  let last = -1;
  for (const s of slots) {
    const tag = String(s.tag || '');
    if (tag.includes('tholos') && s.type === undefined) s.type = 'koreOffering';
    if (s.interior && s.type === undefined) s.type = 'athenaMini';
    let ti = s.type !== undefined ? lib.types.findIndex((t) => t && t.id === s.type) : -1;
    // tag → suitable types: draped korai and small Athenas on the acropolis (refs 5, 6), cult Athenas in shrines
    const pool = ti < 0 ? TAG_POOLS.find(([re]) => re.test(tag))?.[1] : null;
    if (pool) {
      const id = pool[Math.floor(rng.random() * pool.length)];
      ti = lib.types.findIndex((t) => t && t.id === id);
      if (ti === last) ti = lib.types.findIndex((t) => t && t.id === pool[(pool.indexOf(id) + 1) % pool.length]);
    }
    if (ti < 0) { let guard = 0; do { ti = Math.floor(rng.random() * nTypes); guard++; } while ((ti === last || !lib.types[ti]) && guard < 20); }
    if (!lib.types[ti]) continue;
    last = ti;
    const H = s.height ?? s.size ?? rng.range(2.6, 3.3);
    const sc = H / 2.0;
    const rotY = L.headingToRotY(s.facing ?? 180) + rng.range(-0.18, 0.18);
    let base = s.pos[1];
    if (s.needsPedestal) {
      const pw = 0.62 * sc * rng.range(0.95, 1.08), ph = rng.range(0.55, 0.75) * sc;
      q.setFromAxisAngle(Y, L.headingToRotY(s.facing ?? 180));
      m4.compose(pv.set(s.pos[0], base - 0.15, s.pos[2]), q, sv.set(pw, ph, pw * rng.range(0.85, 1.0)));
      pedMats.push(m4.clone());
      base += ph * ped.userData.top - 0.15;
    }
    const lod = s.interior ? 2 : lodForScale(sc, pxPerMetre(s.pos[0], base + H * 0.5, s.pos[2]));
    q.setFromAxisAngle(Y, rotY);
    const sj = sc * rng.range(0.96, 1.04);
    m4.compose(pv.set(s.pos[0], base, s.pos[2]), q, sv.set(sj, sj, sj));
    lodN[lod]++;
    const key = ti + '|' + lod;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m4.clone());
  }
  const group = new THREE.Group();
  group.name = 'statues-generic';
  let tris = 0;
  for (const [key, mats] of buckets) {
    const [ti, lod] = key.split('|').map(Number);
    const geo = lib.types[ti].lod[lod];
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = `statue-${lib.types[ti].id}-l${lod}`;
    group.add(im);
    tris += (mats.length * geo.index.count) / 3;
  }
  if (pedMats.length) {
    const im = new THREE.InstancedMesh(ped, mat, pedMats.length);
    pedMats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = 'statue-pedestals';
    group.add(im);
    tris += (pedMats.length * ped.index.count) / 3;
  }
  return { group, tris, count: slots.length, lodN };
}

// ------------------------------------------------------------------ pediments & metopes
class Instancer {
  constructor(mat) { this.mat = mat; this.map = new Map(); }
  add(geo, m) { if (!this.map.has(geo)) this.map.set(geo, []); this.map.get(geo).push(m.clone()); }
  build(name) {
    const g = new THREE.Group(); g.name = name;
    let tris = 0;
    for (const [geo, mats] of this.map) {
      const im = new THREE.InstancedMesh(geo, this.mat, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      g.add(im);
      tris += (mats.length * geo.index.count) / 3;
    }
    return { group: g, tris };
  }
}

/** world matrix for a figure in a frame (origin, right, up, normal) at local (u, y, z), yaw about up, scale */
function frameMatrix(o, R, U, N, u, y, z, yaw, s, flatten = 1, roll = 0) {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  // rotated basis: local +X → R*c - N*s ; local +Z → R*s + N*c
  const X = new THREE.Vector3(R[0] * c - N[0] * sn, R[1] * c - N[1] * sn, R[2] * c - N[2] * sn).multiplyScalar(s);
  const Y = new THREE.Vector3(...U).multiplyScalar(s);
  const Z = new THREE.Vector3(R[0] * sn + N[0] * c, R[1] * sn + N[1] * c, R[2] * sn + N[2] * c).multiplyScalar(s);
  if (roll) { // lean in the frame plane (about the frame normal, pivot at the feet)
    const nAx = new THREE.Vector3(...N).normalize();
    for (const A of [X, Y, Z]) A.applyAxisAngle(nAx, roll);
  }
  if (flatten !== 1) {
    // squash along the frame normal (relief): project each axis' normal component
    const n = new THREE.Vector3(...N);
    for (const A of [X, Y, Z]) { const k = A.dot(n); A.addScaledVector(n, -k * (1 - flatten)); }
  }
  const m = new THREE.Matrix4().makeBasis(X, Y, Z);
  m.setPosition(o[0] + R[0] * u + U[0] * y + N[0] * z, o[1] + R[1] * u + U[1] * y + N[1] * z, o[2] + R[2] * u + U[2] * y + N[2] * z);
  return m;
}

function placeSculpture(engine, T, lib) {
  const rng = engine.rng('pediments');
  const cams = shotCameras();
  const inst = new Instancer(statueMaterial({ name: 'statueMarble' }));
  const geoOf = (id, lod, mirror) => {
    const e = lib.byId.get(id);
    if (!e) return null;
    return mirror ? lib.mirrored(id, lod) : e.lod[lod];
  };
  let pedFigures = 0, metFigures = 0, culled = 0;
  // reliefs facing away from every shot camera are never seen: skip them (saves ~half the metope tris)
  const facesACamera = (o, n) => cams.some((c) => (c.x - o[0]) * n[0] + (c.y - o[1]) * (n[1] || 0) + (c.z - o[2]) * n[2] > 0);
  for (const p of T.pediments || []) {
    const o = p.origin || p.center || p.pos;
    if (!o || !p.right || !p.normal) continue;
    const U = p.up || [0, 1, 0];
    const W = p.baseWidth ?? p.width, H = p.height;
    if (!(W > 2 && H > 0.6)) continue;
    if (!facesACamera(o, p.normal)) { culled++; continue; }
    const lodPx = pxPerMetre(o[0], o[1] + H * 0.4, o[2], 0.4);
    for (const f of composePediment({ baseWidth: W, height: H, depth: p.depth }, rng)) {
      const geo = geoOf(f.id, lodForScale(f.s, lodPx), f.mirror);
      if (!geo) continue;
      inst.add(geo, frameMatrix(o, p.right, U, p.normal, f.u, 0.0, f.z, f.yaw, f.s, 1, f.roll || 0));
      pedFigures++;
    }
  }
  (T.metopes || []).forEach((mt, i) => {
    const o = mt.center || mt.pos;
    if (!o || !mt.right || !mt.normal) return;
    if (!facesACamera(o, mt.normal)) { culled++; return; }
    const U = mt.up || [0, 1, 0];
    const mtPx = pxPerMetre(o[0], o[1], o[2], 0.3);
    for (const f of composeMetope(mt, i, rng)) {
      const geo = geoOf(f.id, Math.max(1, lodForScale(f.s, mtPx, 1.2)), f.mirror);
      if (!geo) continue;
      inst.add(geo, frameMatrix(o, mt.right, U, mt.normal, f.u, f.y, f.z, f.yaw, f.s, f.flatten));
      metFigures++;
    }
  });
  const r = inst.build('pediment-sculpture');
  return { ...r, pedFigures, metFigures, culled };
}

// ------------------------------------------------------------------ module API
export async function build(engine) {
  const t0 = performance.now();
  const root = new THREE.Group();
  root.name = 'statues';
  let tris = 0;
  for (const c of L.COLOSSI) {
    try {
      // on a tower bastion (acropolis publishes its top) or on the terrain
      const bt = engine.registry.acropolis?.colossusBases?.[c.id];
      const onTower = Number.isFinite(bt);
      const rotY = L.headingToRotY(c.facing);
      // on a tower the pedestal is squared with the (axis-aligned) bastion walls
      const pedYaw = onTower ? Math.round(rotY / (Math.PI / 2)) * (Math.PI / 2) - rotY : 0;
      const banner = c.pedestal > 6 && c.banner !== false;
      const g = await buildColossus(engine, c.id, c.height, c.pedestal, engine.quality.detail, { mirror: !!c.mirror, pedYaw, banner });
      const ground = onTower ? bt : Math.min(c.pos[1], heightAt(c.pos[0], c.pos[2]));
      g.position.set(c.pos[0], ground - (onTower ? 0.08 : 0.3), c.pos[2]);
      if (c.bastion && !onTower) console.warn('[statues] colossus', c.id, 'wants a bastion but registry.acropolis.colossusBases has none: standing on', ground.toFixed(1));
      g.rotation.y = rotY;
      {
        // (r3) dress the pedestal: owl banner on the front of the die (ref 5), ivy over the cornice
        const P = g.userData.pedestal, yaw = rotY + P.yaw;
        const wp = (lx, ly, lz) => [g.position.x + lx * Math.cos(yaw) + lz * Math.sin(yaw), g.position.y + ly, g.position.z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
        const head = (c.facing - (P.yaw * 180) / Math.PI + 720) % 360; // rotY = PI - heading
        const dieH = P.dieTop - P.dieBottom;
        if (banner && P.bastionTop) engine.slots.banner?.push({ pos: wp(0, P.bastionTop - 0.25, P.d / 2 + P.bastionOut + 0.02), facing: head, size: [Math.min(P.w * 0.3, 3.4), P.bastionTop * 0.72], tag: 'colossus-bastion' });
        else if (banner) engine.slots.banner?.push({ pos: wp(0, P.dieTop - 0.15 * dieH / 8, P.d / 2 + 0.02), facing: head, size: [Math.min(P.w * 0.36, 3.6), dieH * 0.78], tag: 'colossus-pedestal', style: 'L' });
        if (c.pedestal > 3) for (const [lx, sz] of [[-0.36, 0.55], [0.4, 0.4]]) engine.slots.ivy?.push({ pos: wp(lx * P.w, P.dieTop, P.d / 2 + 0.25), facing: head, size: dieH * sz, width: Math.max(1.2, P.w * 0.12), tag: 'colossus-pedestal' });
        // (r6) small draped figures on the front corners of the bastion ledge (ref 5: statuary around the colossus base)
        if (P.bastionTop && engine.slots.statue) for (const sx of [-1, 1]) engine.slots.statue.push({ pos: wp(sx * (P.w / 2 + 1.0), P.bastionTop + 0.42, P.d / 2 + 1.0), facing: (head + sx * 25 + 360) % 360, size: Math.min(3.0, c.height * 0.14), tag: 'colossus-bastion-corner' });
        if (P.bastionTop) for (const [lx, sz] of [[-0.42, 0.7], [0.3, 0.45], [0.47, 0.85]]) engine.slots.ivy?.push({ pos: wp(lx * P.w, P.bastionTop + 0.4, P.d / 2 + P.bastionOut + 0.3), facing: head, size: P.bastionTop * sz, width: Math.max(1.5, P.w * 0.14), tag: 'colossus-bastion' });
      }
      root.add(g);
      tris += g.userData.tris;
      // a colossus on a shot-specific bastion (B: shot 4 only) is hidden with its bastion elsewhere,
      // so neither the figure nor its long shadow can reach another frame
      if (c.bastion) engine.onShot((s) => { g.visible = s.id === undefined || String(s.id) === '4'; });
      engine.footprints?.addCircle(c.pos[0], c.pos[2], c.height * 0.33, 'colossus');
    } catch (e) { console.error('[statues] colossus', c.id, 'failed:', e.stack || e); }
  }
  const t1 = performance.now();
  let lib = null;
  try {
    lib = await statueLibrary(engine.quality.detail);
    let slots = (engine.slots.statue || []).slice();
    let src = 'slots';
    if (!slots.length) { slots = fallbackSlots(engine, engine.rng('statue-fallback')); src = 'fallback'; }
    const r = await placeStatues(engine, slots, lib);
    root.add(r.group);
    tris += r.tris;
    console.log(`[statues] ${r.count} statues from ${src} (lod0/1/2: ${r.lodN.join('/')}, ${(r.tris / 1e6).toFixed(2)} M tris)`);
  } catch (e) { console.error('[statues] generic statues failed:', e.stack || e); }
  // pediment groups + metope reliefs from the temple module
  try {
    const T = engine.registry.temple;
    if (lib && T && (T.pediments?.length || T.metopes?.length)) {
      const r = placeSculpture(engine, T, lib);
      root.add(r.group);
      tris += r.tris;
      console.log(`[statues] pediments: ${r.pedFigures} figures on ${T.pediments?.length || 0} pediments, metopes: ${r.metFigures} relief figures on ${T.metopes?.length || 0} metopes (${r.culled} back-facing skipped)`);
    } else console.log('[statues] no registry.temple pediments/metopes — pediment sculpture skipped');
  } catch (e) { console.error('[statues] pediment sculpture failed:', e.stack || e); }
  engine.add(root);
  engine.registry.statues = { colossi: L.COLOSSI.map((c) => c.id) };
  console.log(`[statues] built in ${Math.round(performance.now() - t0)} ms (colossi ${Math.round(t1 - t0)} ms), ~${(tris / 1e6).toFixed(2)} M tris`);
}

export async function test(engine) {
  const v = engine.params.get('variant') || 'B';
  const part = engine.params.get('part') || 'full';
  const sun = { azimuth: Number(engine.params.get('sunAz') || 250), elevation: Number(engine.params.get('sunEl') || 24) };
  if (part === 'pediment') {
    // mock temple front: tympanum + floor + frieze with metopes, then the real composition on top
    const lib = await statueLibrary(1);
    const W = 29, Hp = 3.6, y0 = 14;
    const wallMat = statueMaterial({ name: 'statueMarble', dirt: 0.6 });
    const shape = new THREE.Shape([new THREE.Vector2(-W / 2 - 0.5, 0), new THREE.Vector2(W / 2 + 0.5, 0), new THREE.Vector2(0, Hp + 0.3)]);
    const tymp = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false });
    tymp.translate(0, y0, -0.6);
    const { withColor } = await import('../sculpt/bakeutil.js');
    const add = (g) => engine.add(new THREE.Mesh(withColor(g.toNonIndexed ? g : g, 1, 0, 0), wallMat));
    add(tymp);
    add(new THREE.BoxGeometry(W + 2, 0.6, 2.2).translate(0, y0 - 0.3, 0.2));
    add(new THREE.BoxGeometry(W + 2, 1.6, 1.0).translate(0, y0 - 1.4, -0.3));
    add(new THREE.BoxGeometry(W + 2, 9.0, 1.0).translate(0, y0 - 6.7, -0.6));
    const metopes = [];
    for (let i = 0; i < 8; i++) metopes.push({ center: [-W / 2 + 2 + i * 3.6, y0 - 1.4, 0.2], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1], size: [1.35, 1.35] });
    const r = placeSculpture(engine, { pediments: [{ origin: [0, y0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1], baseWidth: W, height: Hp, depth: 1.15 }], metopes }, lib);
    engine.add(r.group);
    return {
      views: [
        { pos: [-6, y0 - 10, 34], target: [0, y0 + 1.5, 0], fov: 40, sun },
        { pos: [-3, y0 - 2, 12], target: [-3, y0 + 1.2, 0], fov: 40, sun },
        { pos: [8, y0 - 1, 10], target: [9, y0 + 0.6, 0], fov: 40, sun },
        { pos: [-20, y0 - 8, 30], target: [-2, y0 + 1, 0], fov: 40, sun },
      ],
    };
  }
  if (part === 'lineup') {
    // all generic + pediment types side by side (nominal 2.0 m → 2.6 m)
    const { STATUE_TYPES, PED_TYPES, buildStatueGeometry } = await import('../sculpt/statuary.js');
    const lod = Number(engine.params.get('lod') || 1);
    const which = engine.params.get('types');
    const types = STATUE_TYPES.concat(PED_TYPES).filter((t) => !which || which.split(',').includes(t.id));
    const mat = statueMaterial({ name: 'statueMarble' });
    const S = 1.3, gap = 2.0;
    const lib = await statueLibrary(1);
    types.forEach((T, i) => {
      const g = lib.byId.get(T.id)?.lod[lod] || buildStatueGeometry(T.id, lod, 1);
      const m = new THREE.Mesh(g, mat);
      m.scale.setScalar(S);
      m.position.set((i - (types.length - 1) / 2) * gap, 0, 0);
      engine.add(m);
    });
    const span = types.length * gap;
    return {
      views: [
        { pos: [0, 1.8, span * 0.62], target: [0, 1.2, 0], fov: 50, sun },
        { pos: [-span * 0.25, 1.6, 4.2], target: [-span * 0.25, 1.3, 0], fov: 45, sun },
        { pos: [span * 0.25, 1.6, 4.2], target: [span * 0.25, 1.3, 0], fov: 45, sun },
        { pos: [span * 0.45, 2.4, span * 0.45], target: [0, 1.2, 0], fov: 45, sun },
      ],
    };
  }
  if (part === 'head') {
    // fine head-only sculpt for face iteration (head units → 1 m tall head)
    const { athenaSpec } = await import('../sculpt/athena.js');
    const { meshRegion, bakeAttributes } = await import('../sculpt/bakeutil.js');
    const A = athenaSpec(v);
    const f = A.fig, J = f.joints;
    const cell = Number(engine.params.get('cell') || 0.0028);
    const geo = meshRegion(f.headSdf, f.headBounds, cell);
    bakeAttributes(geo, f.sdf, f.gold, { aoDist: 0.06, cavDist: 0.006 });
    const m = new THREE.Mesh(geo, statueMaterial({ name: 'statueMarble' }));
    const S = 4; // 2.0 m figure → 8 m: the head is ~1 m
    m.scale.setScalar(S);
    m.position.set(-J.headC[0] * S, 1.5 - J.headC[1] * S, -J.headC[2] * S);
    engine.add(m);
    const yaw = Math.atan2(J.Rh[2], J.Rh[8]); // head facing direction
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const views = [
      { pos: [fx * 3.0, 1.55, fz * 3.0], target: [0, 1.45, 0], fov: 30 },                                     // front
      { pos: [fx * 2.2 + fz * 2.2, 1.6, fz * 2.2 - fx * 2.2], target: [0, 1.45, 0], fov: 32 },                 // 3/4
      { pos: [fz * 3.0, 1.5, -fx * 3.0], target: [0, 1.5, 0], fov: 32 },                                      // profile
      { pos: [-fz * 2.2 + fx * 2.2, 1.7, fx * 2.2 + fz * 2.2], target: [0, 1.5, 0], fov: 32 },                 // other 3/4
      { pos: [-fx * 3.0, 1.8, -fz * 3.0], target: [0, 1.6, 0], fov: 34 },                                     // back
    ];
    return { views: views.map((w) => ({ ...w, sun })) };
  }
  const size = Number(engine.params.get('size') || 10);
  const detail = Number(engine.params.get('detail') || 0.35);
  const g = await buildColossus(engine, v, size, size * 0.3, detail);
  engine.add(g);
  if (engine.params.get('bust')) {
    // hi-res head bust (built at runtime) beside the colossus for face / helmet iteration: x = 20
    const { athenaSpec } = await import('../sculpt/athena.js');
    const { meshRegion, bakeAttributes } = await import('../sculpt/bakeutil.js');
    const A = athenaSpec(v);
    const f = A.fig, J = f.joints;
    const cell = Number(engine.params.get('cell') || 0.0026);
    const t0 = performance.now();
    const geo = meshRegion(f.headSdf, f.headBounds, cell);
    bakeAttributes(geo, f.sdf, f.gold, { aoDist: 0.06, cavDist: 0.006 });
    const m = new THREE.Mesh(geo, statueMaterial({ name: 'statueMarble' }));
    const S = 4;
    m.scale.setScalar(S);
    m.position.set(20 - J.headC[0] * S, 1.6 - J.headC[1] * S, -J.headC[2] * S);
    engine.add(m);
    console.log('[statues] bust', Math.round(performance.now() - t0), 'ms', geo.index.count / 3, 'tris');
  }
  if (engine.params.get('extras')) {
    // statue lineup (lod 0, 2.6 m) at x = 60..80, pediment mock (base y 14) at x = 140
    const lib = await statueLibrary(1);
    const mat = statueMaterial({ name: 'statueMarble' });
    const ids = [...lib.byId.keys()];
    ids.forEach((id, i) => {
      const m = new THREE.Mesh(lib.byId.get(id).lod[Number(engine.params.get('lod') || 0)], mat);
      m.scale.setScalar(1.3);
      m.position.set(60 + i * 2.2, 0, 0);
      engine.add(m);
    });
    const W = 29, Hp = 3.6, y0 = 14, X = 140;
    const wallMat = statueMaterial({ name: 'statueMarble', dirt: 0.6 });
    const shape = new THREE.Shape([new THREE.Vector2(-W / 2 - 0.5, 0), new THREE.Vector2(W / 2 + 0.5, 0), new THREE.Vector2(0, Hp + 0.3)]);
    const tymp = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false });
    tymp.translate(X, y0, -0.6);
    const { withColor } = await import('../sculpt/bakeutil.js');
    const addG = (gg) => { for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal') gg.deleteAttribute(k); engine.add(new THREE.Mesh(withColor(gg, 1, 0, 0), wallMat)); };
    addG(tymp);
    addG(new THREE.BoxGeometry(W + 2, 0.6, 2.2).translate(X, y0 - 0.3, 0.2));
    addG(new THREE.BoxGeometry(W + 2, 1.6, 1.0).translate(X, y0 - 1.4, -0.3));
    addG(new THREE.BoxGeometry(W + 2, 9.0, 1.0).translate(X, y0 - 6.7, -0.6));
    const metopes = [];
    for (let i = 0; i < 8; i++) metopes.push({ center: [X - W / 2 + 2 + i * 3.6, y0 - 1.4, 0.2], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1], size: [1.35, 1.35] });
    const r = placeSculpture(engine, { pediments: [{ origin: [X, y0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1], baseWidth: W, height: Hp, depth: 1.15 }], metopes }, lib);
    engine.add(r.group);
  }
  const top = size * 0.3 + size * 0.04;
  const s = size / 2;
  const H = top + size;
  return {
    views: [
      { pos: [-size * 0.55, top + size * 0.45, size * 1.25], target: [0, top + size * 0.52, 0], fov: 45 },            // 0 full 3/4
      { pos: [-s * 0.25, top + s * 1.86, s * 0.9], target: [0.0, top + s * 1.83, 0], fov: 32 },                       // 1 face
      { pos: [size * 0.75, top + size * 0.22, size * 0.85], target: [s * 0.45, top + s * 0.5, s * 0.1], fov: 40 },      // 2 shield
      { pos: [-size * 1.3, top + size * 0.5, size * 0.1], target: [0, top + size * 0.5, 0], fov: 45 },                // 3 profile (right side)
      { pos: [size * 0.5, top + size * 0.45, -size * 1.3], target: [0, top + size * 0.5, 0], fov: 45 },              // 4 back
      { pos: [-size * 0.1, top - size * 0.05, size * 0.9], target: [0, top + size * 0.65, 0], fov: 55 },              // 5 low angle (ref5)
      { pos: [-s * 0.1, top + s * 1.75, s * 0.7], target: [-s * 0.2, top + s * 1.5, 0.0], fov: 40 },                  // 6 bust / spear hand
      { pos: [s * 0.35, top + s * 0.75, s * 1.1], target: [s * 0.05, top + s * 0.7, 0.0], fov: 40 },                  // 7 thigh / skirt
    ],
  };
}
