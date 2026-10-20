// Urns (gilt bronze jardinières with swirled gadroons, ref 2) and marble planters, both planted
// with a dense mound of dark green foliage and purple flowers (petunia / lisianthus-like + a few
// lavender spikes). Plants are merged leaf cards (3 variants) instanced per container.
//
//   const set = new UrnSet(engine);
//   set.add({ pos:[x,y,z], height: 0.75, kind: 'urn' | 'krater' | 'planter', facing, length });
//   set.build();
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { bronzeMaterial, propMarbleMaterial } from './metals.js';
import { hashString } from '../core/rng.js';
import { SHOTS } from '../world/shots.js';

// LOD: plants farther than this from every shot camera use a light variant (a few pixels on screen)
const PLANT_LOD_DIST = 55;
const CAMS = SHOTS.map((q) => q.pos);
const nearCam = (p) => CAMS.some((c) => Math.hypot(c[0] - p.x, c[1] - p.y, c[2] - p.z) < PLANT_LOD_DIST);

// ------------------------------------------------------------------------------- shared lathe
function revolve(profile, seg, disp) {
  const nP = profile.length, nx = seg + 1;
  const pos = new Float32Array(nP * nx * 3), uv = new Float32Array(nP * nx * 2);
  for (let j = 0; j < nP; j++) {
    const [r0, y] = profile[j];
    for (let i = 0; i <= seg; i++) {
      const phi = (i / seg) * Math.PI * 2;
      const r = r0 + (disp ? disp(phi, y, r0) : 0);
      const k = j * nx + i;
      pos[k * 3] = Math.cos(phi) * r; pos[k * 3 + 1] = y; pos[k * 3 + 2] = Math.sin(phi) * r;
      uv[k * 2] = i / seg; uv[k * 2 + 1] = j / (nP - 1);
    }
  }
  const idx = [];
  for (let j = 0; j < nP - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const N = g.attributes.normal;
  for (let j = 0; j < nP; j++) {
    const a = j * nx, b = j * nx + seg;
    const x = N.getX(a) + N.getX(b), y = N.getY(a) + N.getY(b), z = N.getZ(a) + N.getZ(b), l = Math.hypot(x, y, z) || 1;
    N.setXYZ(a, x / l, y / l, z / l); N.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}
function smooth(pts, n) {
  // Catmull-Rom through the control points → n samples
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(t)), f = t - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
    out.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
  }
  return out;
}
function mergeSimple(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const I = g.index.array; for (let i = 0; i < I.length; i++) idx[io++] = I[i] + vo;
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// ------------------------------------------------------------------------------- containers (height = 1)
/** Squat jardinière with swirled gadroons on a footed base (ref 2). Rim radius ≈ 0.62. */
export function urnGeometry(detail = 1) {
  const prof = smooth([
    [0.0, 0.0], [0.36, 0.0], [0.38, 0.03], [0.34, 0.07], [0.24, 0.1], [0.2, 0.14], [0.26, 0.17], [0.22, 0.2],
    [0.3, 0.25], [0.45, 0.33], [0.56, 0.45], [0.6, 0.58], [0.57, 0.7], [0.5, 0.8], [0.48, 0.86],
    [0.55, 0.92], [0.64, 0.97], [0.66, 1.0], [0.62, 1.02], [0.56, 1.0], [0.5, 0.92], [0.0, 0.88],
  ], detail >= 0.9 ? 64 : 44);
  const lobes = 14;
  const disp = (phi, y) => {
    if (y < 0.26 || y > 0.82) return 0;
    const tw = (y - 0.26) * 1.6;                 // swirl
    const l = ((phi + tw) * lobes) / (Math.PI * 2);
    const f = l - Math.floor(l) - 0.5;
    const env = Math.sin(Math.PI * Math.min(1, Math.max(0, (y - 0.26) / 0.56)));
    return 0.03 * env * (Math.cos(f * Math.PI * 2) * 0.5 + 0.5) - 0.01 * env;
  };
  return revolve(prof, Math.round(lobes * (detail >= 0.9 ? 6 : 4)), disp);
}

/** Marble bell krater (planter variant), rim radius ≈ 0.55. */
export function kraterGeometry(detail = 1) {
  const prof = smooth([
    [0.0, 0.0], [0.32, 0.0], [0.33, 0.05], [0.24, 0.08], [0.15, 0.13], [0.14, 0.2], [0.2, 0.24], [0.3, 0.32],
    [0.4, 0.45], [0.46, 0.62], [0.5, 0.8], [0.56, 0.92], [0.6, 0.97], [0.6, 1.0], [0.54, 1.0], [0.48, 0.92], [0.0, 0.88],
  ], detail >= 0.9 ? 70 : 44);
  return revolve(prof, detail >= 0.9 ? 64 : 40, (phi, y) => (y > 0.3 && y < 0.62 ? 0.008 * Math.cos(phi * 24) : 0));
}

/** Rectangular marble trough, unit length 1 along X, depth 0.36, height 0.45. */
export function troughGeometry() {
  const parts = [];
  const box = (w, h, d, y) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(0, y + h / 2, 0); parts.push(b); };
  box(1.0, 0.06, 0.4, 0); box(0.94, 0.04, 0.36, 0.06); box(0.9, 0.29, 0.32, 0.1); box(0.97, 0.03, 0.38, 0.39); box(1.0, 0.04, 0.4, 0.42);
  return mergeSimple(parts);
}

// ------------------------------------------------------------------------------- plant atlas
let atlasTex = null;
function plantAtlas() {
  if (atlasTex) return atlasTex;
  const S = 512;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  let s = 77;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  // left half: 4 leaf cells (256 x 256 each in a 2x2 grid of the left half → 128 wide x 256 tall)
  const leafCell = (cx, cy, w, h, shape, col) => {
    // one ovate leaf filling the cell (pointed tip up, petiole at the bottom)
    g.save(); g.translate(cx, cy + h * 0.47);
    const len = h * 0.92, wid = w * 0.46 * shape;
    g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(wid * 1.05, -len * 0.12, wid * 1.0, -len * 0.62, 0, -len);
    g.bezierCurveTo(-wid * 1.0, -len * 0.62, -wid * 1.05, -len * 0.12, 0, 0);
    const gr = g.createLinearGradient(-wid, 0, wid, 0);
    gr.addColorStop(0, col[0]); gr.addColorStop(0.5, col[1]); gr.addColorStop(1, col[2]);
    g.fillStyle = gr; g.fill();
    // soft darker edge + lighter midrib and veins
    g.strokeStyle = 'rgba(10,20,5,0.5)'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = 'rgba(150,180,100,0.5)'; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(0, -4); g.lineTo(0, -len * 0.94); g.stroke();
    g.lineWidth = 1.1;
    for (let v = 1; v < 7; v++) {
      const yy = -len * v / 7.5;
      g.beginPath(); g.moveTo(0, yy); g.quadraticCurveTo(wid * 0.4, yy - len * 0.05, wid * 0.78, yy - len * 0.11);
      g.moveTo(0, yy); g.quadraticCurveTo(-wid * 0.4, yy - len * 0.05, -wid * 0.78, yy - len * 0.11); g.stroke();
    }
    g.restore();
  };
  const greens = [['#16290d', '#25411a', '#13230b'], ['#1d3511', '#2f4f1c', '#1a2f10'], ['#14260c', '#223d15', '#11200a'], ['#22391a', '#36572a', '#1d3214']];
  for (let i = 0; i < 4; i++) leafCell(64 + (i % 2) * 128, 128 + Math.floor(i / 2) * 256, 128, 250, i % 2 ? 1.2 : 0.9, greens[i]);
  // right half top: purple petunia-like flowers (cell 128x128, 2x2)
  const flower = (cx, cy, r, base, light) => {
    g.save(); g.translate(cx, cy);
    for (let p = 0; p < 5; p++) {
      g.save(); g.rotate((p / 5) * Math.PI * 2 + rnd() * 0.2);
      g.beginPath(); g.moveTo(0, 0);
      g.bezierCurveTo(r * 0.55, -r * 0.2, r * 0.6, -r * 0.95, 0, -r);
      g.bezierCurveTo(-r * 0.6, -r * 0.95, -r * 0.55, -r * 0.2, 0, 0);
      const gr = g.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
      gr.addColorStop(0, '#2a0f3a'); gr.addColorStop(0.35, base); gr.addColorStop(1, light);
      g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(40,10,60,0.5)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, -r * 0.15); g.lineTo(0, -r * 0.85); g.stroke();
      g.restore();
    }
    g.beginPath(); g.arc(0, 0, r * 0.12, 0, Math.PI * 2); g.fillStyle = '#e8d070'; g.fill();
    g.restore();
  };
  flower(320, 64, 56, '#5a2a8a', '#8a5cc0');
  flower(448, 64, 54, '#4a2378', '#7a4fb0');
  flower(320, 192, 52, '#6a3596', '#9a70cc');
  flower(448, 192, 56, '#3e1d6a', '#6c46a2');
  // right half bottom: lavender spikes (2 cells 128 x 256)
  for (let k = 0; k < 2; k++) {
    const cx = 320 + k * 128;
    g.strokeStyle = '#4c6a36'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, 508); g.lineTo(cx, 270); g.stroke();
    for (let j = 0; j < 26; j++) {
      const y = 280 + j * 7.5, w = 9 - j * 0.12;
      for (const sx of [-1, 1]) {
        g.beginPath(); g.ellipse(cx + sx * w * 0.6, y + rnd() * 3, w * 0.55, 4.2, sx * 0.4, 0, Math.PI * 2);
        g.fillStyle = rnd() < 0.5 ? '#7a5aa8' : '#6a4a98'; g.fill();
      }
    }
  }
  // opaque dark-leaf patch used by the mound core (top-left corner of the atlas)
  g.fillStyle = '#0f1c09'; g.fillRect(0, 0, 16, 16);
  // dilate colour into transparent texels (avoid dark fringes in mips)
  const id = g.getImageData(0, 0, S, S), d = id.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (d[i + 3] < 10) { const right = x >= S / 2; d[i] = right ? 90 : 40; d[i + 1] = right ? 60 : 70; d[i + 2] = right ? 120 : 28; }
  }
  const tex = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), S, S, THREE.RGBAFormat);
  // flip rows so v=1 is the top of the canvas
  const flipped = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) flipped.set(d.subarray(y * S * 4, (y + 1) * S * 4), (S - 1 - y) * S * 4);
  tex.image.data = flipped;
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 4;
  tex.needsUpdate = true;
  atlasTex = tex;
  return tex;
}
// atlas regions (u0, v0, u1, v1) with v=1 at the canvas top
const LEAF_CELLS = [0, 1, 2, 3].map((i) => [(i % 2) * 0.25, 1 - (Math.floor(i / 2) + 1) * 0.5, (i % 2) * 0.25 + 0.25, 1 - Math.floor(i / 2) * 0.5]);
const FLOWER_CELLS = [0, 1, 2, 3].map((i) => [0.5 + (i % 2) * 0.25, 1 - (Math.floor(i / 2) + 1) * 0.25, 0.75 + (i % 2) * 0.25, 1 - Math.floor(i / 2) * 0.25]);
const SPIKE_CELLS = [[0.5, 0.0, 0.75, 0.5], [0.75, 0.0, 1.0, 0.5]];
const CORE_UV = [8 / 512, 1 - 8 / 512];

/**
 * Mound of foliage + flowers, centred at origin, base at y=0, radius r, height h.
 * Normals are bent toward the mound's radial direction for soft volumetric shading.
 */
export function plantGeometry({ r = 0.5, h = 0.6, leaves = 1800, flowers = 70, spikes = 6, seed = 1 } = {}) {
  let s = seed * 9973 + 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pos = [], nor = [], uv = [], idx = [];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  /** quad centred at c (or anchored at its bottom when anchor='base'), facing n, long axis ~up0 */
  const quad = (c, n, up0, w, hh, cell, shadeN, bend = 0, anchor = 'centre') => {
    const d = up0[0] * n[0] + up0[1] * n[1] + up0[2] * n[2];
    const t = norm([up0[0] - n[0] * d, up0[1] - n[1] * d, up0[2] - n[2] * d]);
    const b = cross(t, n);
    const base = pos.length / 3;
    const y0 = anchor === 'base' ? 0 : -0.5;
    for (const [x, y] of [[-0.5, y0], [0.5, y0], [-0.5, y0 + 1], [0.5, y0 + 1]]) {
      const k = bend * (y - y0) * (y - y0) * hh; // leaves cup / droop slightly
      pos.push(c[0] + b[0] * x * w + t[0] * y * hh - n[0] * k, c[1] + b[1] * x * w + t[1] * y * hh - n[1] * k, c[2] + b[2] * x * w + t[2] * y * hh - n[2] * k);
      nor.push(...shadeN);
      uv.push(cell[0] + (x + 0.5) * (cell[2] - cell[0]), cell[1] + (y - y0) * (cell[3] - cell[1]));
    }
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  };
  // mound surface: squashed dome with a few lumps so the silhouette isn't a perfect cap
  const lumps = Array.from({ length: 7 }, () => [rnd() * 6.283, 0.2 + 0.6 * rnd(), 0.08 + 0.1 * rnd()]);
  const shell = (a, e) => { // a azimuth, e elevation 0 (rim) .. 1 (top)
    let k = 1;
    for (const [la, le, amp] of lumps) { const da = Math.atan2(Math.sin(a - la), Math.cos(a - la)); k += amp * Math.exp(-(da * da) / 0.35 - ((e - le) * (e - le)) / 0.08); }
    const el = e * Math.PI * 0.5;
    return [Math.cos(a) * Math.cos(el) * r * k, Math.sin(el) * h * k, Math.sin(a) * Math.cos(el) * r * k];
  };
  // opaque dark core (reads as deep shadow between the leaves)
  {
    const core = new THREE.IcosahedronGeometry(1, 2);
    const P = core.attributes.position;
    const base = pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      pos.push(x * r * 0.8, (y * 0.5 + 0.5) * h * 0.8, z * r * 0.8);
      const n = norm([x, y + 0.4, z]); nor.push(...n);
      uv.push(CORE_UV[0], CORE_UV[1]);
    }
    const I = core.index ? core.index.array : [...Array(P.count).keys()];
    for (let i = 0; i < I.length; i++) idx.push(I[i] + base);
  }
  for (let i = 0; i < leaves; i++) {
    const a = rnd() * 6.283, e = Math.min(1, Math.pow(rnd(), 0.85) * 1.02);
    const p = shell(a, e);
    const k = 0.82 + 0.22 * rnd();
    const c = [p[0] * k, p[1] * k, p[2] * k];
    const radial = norm([p[0] / r, p[1] / h, p[2] / r]);
    // leaves turn their faces outward and up toward the light, with plenty of jitter
    const n = norm([radial[0] + (rnd() - 0.5) * 1.1, radial[1] + 0.45 + (rnd() - 0.5) * 0.9, radial[2] + (rnd() - 0.5) * 1.1]);
    const up0 = norm([radial[0] * 0.6 + (rnd() - 0.5), 0.6 + rnd(), radial[2] * 0.6 + (rnd() - 0.5)]);
    const len = 0.07 + 0.05 * rnd();
    const shadeN = norm([radial[0] * 0.8 + n[0] * 0.4, radial[1] * 0.8 + n[1] * 0.4 + 0.2, radial[2] * 0.8 + n[2] * 0.4]);
    quad(c, n, up0, len * 0.62, len, LEAF_CELLS[Math.floor(rnd() * 4)], shadeN, 0.25);
    // a few trailing stems with leaves spill over the rim
    if (e < 0.12 && rnd() < 0.35) {
      for (let j = 1; j <= 3; j++) {
        const cc = [p[0] * (1.0 + 0.04 * j), p[1] - 0.05 * j, p[2] * (1.0 + 0.04 * j)];
        const nn = norm([radial[0], 0.2, radial[2]]);
        quad(cc, nn, [0, -1, 0], len * 0.6, len * 0.95, LEAF_CELLS[Math.floor(rnd() * 4)], norm([radial[0], 0.3, radial[2]]), 0.2);
      }
    }
  }
  for (let i = 0; i < flowers; i++) {
    const a = rnd() * 6.283, e = 0.1 + 0.9 * Math.pow(rnd(), 0.6);
    const p = shell(a, e);
    const k = 1.0 + 0.06 * rnd();
    const radial = norm([p[0] / r, p[1] / h, p[2] / r]);
    const n = norm([radial[0] + (rnd() - 0.5) * 0.6, radial[1] + 0.6, radial[2] + (rnd() - 0.5) * 0.6]);
    const sz = 0.08 + 0.05 * rnd();
    const spin = rnd() * 6.283;
    quad([p[0] * k, p[1] * k + 0.01, p[2] * k], n, norm([Math.cos(spin), 0.3, Math.sin(spin)]), sz, sz, FLOWER_CELLS[Math.floor(rnd() * 4)], norm([radial[0], radial[1] + 0.6, radial[2]]), -0.15);
  }
  for (let i = 0; i < spikes; i++) {
    const a = rnd() * 6.283, e = 0.4 + 0.5 * rnd();
    const p = shell(a, e);
    const yaw = rnd() * 6.28;
    const c = [p[0] * 0.9, p[1] * 0.9, p[2] * 0.9];
    for (const off of [0, 1.57]) {
      const n = [Math.cos(yaw + off), 0, Math.sin(yaw + off)];
      quad(c, n, [0.1 * (rnd() - 0.5), 1, 0.1 * (rnd() - 0.5)], 0.05, 0.2 + 0.1 * rnd(), SPIKE_CELLS[i % 2], norm([p[0] / r, 0.8, p[2] / r]), 0, 'base');
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function plantMaterial() {
  return proceduralMaterial({
    name: 'urnPlant',
    params: { map: plantAtlas(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.62, metalness: 0.0 },
    color: /* glsl */`
      // per-plant and per-leaf variation; lighter young growth on top
      float n = cgVnoise3(cgP * 6.0 + cgSeed * 10.0);
      // cellular leafy breakup (mainly visible on the dark core between the leaves)
      vec2 vc = cgVoronoi3(cgP * 38.0 + cgSeed * 5.0);
      diffuseColor.rgb *= 0.55 + 0.75 * smoothstep(0.02, 0.35, vc.y - vc.x);
      float isFlower = smoothstep(0.02, 0.1, diffuseColor.b - diffuseColor.g);
      vec3 c = diffuseColor.rgb;
      c *= mix(vec3(0.8, 0.85, 0.75), vec3(1.15, 1.1, 0.95), n) * (1.0 - isFlower) + isFlower * mix(vec3(0.85), vec3(1.15, 1.0, 1.2), n);
      diffuseColor.rgb = c;`,
    emissive: /* glsl */`
      // cheap translucency: leaves glow slightly when back-lit by the sun
      #ifdef USE_FOG
      float back = pow(clamp(dot(-cgV, uSunDir), 0.0, 1.0), 3.0);
      totalEmissiveRadiance += diffuseColor.rgb * vec3(0.9, 1.0, 0.5) * back * 0.25;
      #endif`,
  });
}

// ------------------------------------------------------------------------------- set
export class UrnSet {
  constructor(engine) { this.engine = engine; this.items = []; this.detail = engine.quality?.detail ?? 1; this.density = engine.quality?.density ?? 1; }
  add(spec) { this.items.push(spec); return this; }
  build() {
    if (!this.items.length) return null;
    const group = new THREE.Group(); group.name = 'urns';
    const urnGeo = urnGeometry(this.detail), kraterGeo = kraterGeometry(this.detail), troughGeo = troughGeometry();
    const k = Math.max(0.4, this.density);
    const plants = [1, 2, 3].map((sd) => plantGeometry({ r: 0.5, h: 0.62, leaves: Math.round(2600 * Math.max(0.75, k)), flowers: Math.round(230 * Math.max(0.75, k)), spikes: 0, seed: sd }));
    const plantsLo = [1, 2, 3].map((sd) => plantGeometry({ r: 0.5, h: 0.62, leaves: 700, flowers: 90, spikes: 0, seed: sd + 10 }));
    // antique gilt bronze: darker, more mirror-like (the refs' urns reflect their dark surroundings)
    const gold = bronzeMaterial({ name: 'urnBronze2', tint: 0xb48a50, rough: 0.3, patina: 0.32, metal: 1.0, envBoost: 0.85 });
    const marble = propMarbleMaterial();
    const plantMat = plantMaterial();
    const lists = { urn: [], krater: [], trough: [], plant: [[], [], []], plantLo: [[], [], []] };
    const _pv = new THREE.Vector3();
    const pushPlant = (m, i) => { _pv.setFromMatrixPosition(m); (nearCam(_pv) ? lists.plant : lists.plantLo)[i].push(m); };
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (const it of this.items) {
      const seed = it.seed ?? hashString(it.pos.map((v) => v.toFixed(2)).join(','));
      const r01 = (q) => ((Math.imul(seed ^ (q * 0x9e3779b1), 0x85ebca6b) >>> 0) / 4294967296);
      const kind = it.kind || 'urn';
      const rot = ((it.facing ?? 0) * Math.PI) / 180 + (kind === 'planter' ? 0 : r01(1) * 6.28);
      Q.setFromAxisAngle(Y, rot);
      if (kind === 'bed') {
        // an existing planter box (built by another module): fill its soil with plants
        const len = it.length ?? 1.6, dep = it.depth ?? 0.6;
        const n = Math.max(1, Math.round(len / Math.max(0.45, dep * 0.9)));
        for (let i = 0; i < n; i++) {
          const off = (i + 0.5) / n - 0.5;
          const pp = new THREE.Vector3(off * len * 0.9, 0, (r01(40 + i) - 0.5) * dep * 0.2).applyQuaternion(Q).add(new THREE.Vector3(...it.pos));
          const qq = new THREE.Quaternion().setFromAxisAngle(Y, r01(10 + i) * 6.28);
          const sc = Math.min(len / n, dep) * (0.95 + 0.25 * r01(20 + i));
          M.compose(pp, qq, new THREE.Vector3(sc, sc * (0.9 + 0.3 * r01(50 + i)), sc)); pushPlant(M.clone(), Math.floor(r01(30 + i) * 3));
        }
        continue;
      }
      if (kind === 'planter') {
        const len = it.length ?? 1.6;
        P.set(...it.pos); S.set(len, 1.0, 1.0); M.compose(P, Q, S); lists.trough.push(M.clone());
        const n = Math.max(1, Math.round(len / 0.55));
        for (let i = 0; i < n; i++) {
          const off = (i + 0.5) / n - 0.5;
          const pp = new THREE.Vector3(off * len * 0.86, 0, 0).applyQuaternion(Q).add(new THREE.Vector3(it.pos[0], it.pos[1] + 0.4, it.pos[2]));
          const qq = new THREE.Quaternion().setFromAxisAngle(Y, r01(10 + i) * 6.28);
          const sc = 0.62 + 0.2 * r01(20 + i);
          M.compose(pp, qq, new THREE.Vector3(sc * 0.75, sc, sc * 0.75)); pushPlant(M.clone(), Math.floor(r01(30 + i) * 3));
        }
        continue;
      }
      const H = (it.height ?? 0.75) * (0.92 + 0.16 * r01(2));
      const sq = it.squat ?? 1, wd = it.wide ?? 1; // squat jardinière (ref 2): lower and wider
      P.set(...it.pos); S.set(H * wd, H * sq, H * wd); M.compose(P, Q, S);
      (kind === 'krater' ? lists.krater : lists.urn).push(M.clone());
      const rimR = (kind === 'krater' ? 0.55 : 0.6) * H * wd;
      const pp = new THREE.Vector3(it.pos[0], it.pos[1] + H * sq * 0.9, it.pos[2]);
      const sc = rimR / 0.5 * (1.0 + 0.15 * r01(3)) * (it.plantScale ?? 1);
      const qq = new THREE.Quaternion().setFromAxisAngle(Y, r01(4) * 6.28);
      M.compose(pp, qq, new THREE.Vector3(sc, sc * (0.95 + 0.4 * r01(5)), sc)); pushPlant(M.clone(), Math.floor(r01(6) * 3));
    }
    const mk = (geo, mat, mats, name, cast = true) => {
      if (!mats.length) return;
      const m = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((x, i) => m.setMatrixAt(i, x));
      m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere();
      m.name = name; m.castShadow = cast; m.receiveShadow = true;
      group.add(m);
      this.tris = (this.tris || 0) + (geo.index.count / 3) * mats.length;
    };
    mk(urnGeo, gold, lists.urn, 'urns');
    mk(kraterGeo, marble, lists.krater, 'kraters');
    mk(troughGeo, marble, lists.trough, 'planters');
    plants.forEach((g, i) => mk(g, plantMat, lists.plant[i], 'urnPlants' + i));
    plantsLo.forEach((g, i) => mk(g, plantMat, lists.plantLo[i], 'urnPlantsLo' + i));
    this.engine.add(group);
    this.group = group;
    return group;
  }
}
