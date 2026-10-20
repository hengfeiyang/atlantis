// Bougainvillea (refs 3, 5): masses of magenta / pink / purple papery bracts (clusters of bract triplets)
// with glossy green leaves on dark woody stems — curtains spilling over balustrades and wall tops,
// mounds in pots and planters, and vines climbing columns. Everything is built from alpha-tested cards
// cut from one canvas atlas, merged into ONE mesh per set (1 draw call), with a thin translucent-leaf
// lighting term so back-lit bracts glow against the low sun.
//
//   const set = new BougainvilleaSet(engine);
//   set.curtain({ top:[x,y,z], facing: deg, length: 2.4, drop: 1.6, depth: 0.5 });   // over an edge
//   set.bush({ pos:[x,y,z], radius: 0.6, height: 0.7, spill: 0.4 });                   // mound (pot / bed)
//   set.climb({ pos:[x,y,z], radius: 0.45, height: 4, side: deg, coverage: 0.6 });     // around a column
//   set.build();
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { hashString } from '../core/rng.js';

// ------------------------------------------------------------------------------- atlas
const AT = 1024, CELL = 256;
let atlasTex = null;
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** bract colours (sRGB): magenta, hot pink, purple-magenta, crimson */
const BRACT = [
  ['#560432', '#b0086c', '#d0208a'],
  ['#64043a', '#c00a76', '#e02c94'],
  ['#440844', '#8a1076', '#ac2c98'],
  ['#5a0440', '#a80a6a', '#cc2088'],
];

function drawLeaf(g, cx, cy, len, wid, ang, cols) {
  g.save(); g.translate(cx, cy); g.rotate(ang);
  g.beginPath(); g.moveTo(0, 0);
  g.bezierCurveTo(wid * 1.1, -len * 0.18, wid * 0.95, -len * 0.7, 0, -len);
  g.bezierCurveTo(-wid * 0.95, -len * 0.7, -wid * 1.1, -len * 0.18, 0, 0);
  const gr = g.createLinearGradient(-wid, 0, wid, 0);
  gr.addColorStop(0, cols[0]); gr.addColorStop(0.48, cols[1]); gr.addColorStop(1, cols[2]);
  g.fillStyle = gr; g.fill();
  g.strokeStyle = 'rgba(8,18,4,0.55)'; g.lineWidth = Math.max(1, len * 0.012); g.stroke();
  g.strokeStyle = 'rgba(170,200,110,0.45)'; g.lineWidth = Math.max(1, len * 0.014);
  g.beginPath(); g.moveTo(0, -len * 0.02); g.lineTo(0, -len * 0.93); g.stroke();
  g.lineWidth = Math.max(0.7, len * 0.006);
  for (let v = 1; v < 6; v++) {
    const yy = -len * v / 6.4;
    g.beginPath(); g.moveTo(0, yy); g.quadraticCurveTo(wid * 0.45, yy - len * 0.06, wid * 0.8, yy - len * 0.13);
    g.moveTo(0, yy); g.quadraticCurveTo(-wid * 0.45, yy - len * 0.06, -wid * 0.8, yy - len * 0.13); g.stroke();
  }
  g.restore();
}

/** one bract triplet (three papery heart-shaped bracts + tiny cream florets) */
function drawTriplet(g, cx, cy, r, rot, cols, r01) {
  g.save(); g.translate(cx, cy); g.rotate(rot);
  for (let k = 0; k < 3; k++) {
    g.save(); g.rotate((k / 3) * Math.PI * 2 + (r01() - 0.5) * 0.4);
    const rr = r * (0.85 + 0.3 * r01()), w = rr * (0.62 + 0.15 * r01());
    g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(w, -rr * 0.15, w * 1.05, -rr * 0.8, w * 0.18, -rr * 0.98);
    g.quadraticCurveTo(0, -rr * 0.9, -w * 0.18, -rr * 0.98);
    g.bezierCurveTo(-w * 1.05, -rr * 0.8, -w, -rr * 0.15, 0, 0);
    const gr = g.createRadialGradient(0, -rr * 0.25, rr * 0.05, 0, -rr * 0.5, rr * 0.75);
    gr.addColorStop(0, cols[2]); gr.addColorStop(0.55, cols[1]); gr.addColorStop(1, cols[0]);
    g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(70,0,30,0.35)'; g.lineWidth = Math.max(0.6, r * 0.03); g.stroke();
    // papery veins
    g.strokeStyle = 'rgba(255,190,225,0.28)'; g.lineWidth = Math.max(0.5, r * 0.018);
    g.beginPath(); g.moveTo(0, -rr * 0.05); g.lineTo(0, -rr * 0.85);
    for (let v = 1; v < 4; v++) { const y = -rr * v / 4.2; g.moveTo(0, y); g.quadraticCurveTo(w * 0.35, y - rr * 0.08, w * 0.62, y - rr * 0.2); g.moveTo(0, y); g.quadraticCurveTo(-w * 0.35, y - rr * 0.08, -w * 0.62, y - rr * 0.2); }
    g.stroke();
    g.restore();
  }
  // florets
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    g.beginPath(); g.arc(Math.cos(a) * r * 0.14, Math.sin(a) * r * 0.14, r * 0.09, 0, Math.PI * 2);
    g.fillStyle = '#f2ead0'; g.fill();
    g.beginPath(); g.arc(Math.cos(a) * r * 0.14, Math.sin(a) * r * 0.14, r * 0.035, 0, Math.PI * 2);
    g.fillStyle = '#e8c440'; g.fill();
  }
  g.restore();
}

export const BOUG_CELLS = {
  leaf: [0, 1, 2, 3].map((i) => [i, 0]),
  cluster: [0, 1, 2, 3].map((i) => [i, 1]),
  triplet: [0, 1, 2, 3].map((i) => [i, 2]),
  spray: [0, 1, 2].map((i) => [i, 3]),
};
/** uv rect of cell (col,row) with v = 1 at the atlas top */
function cellUV([c, r]) { return [c * 0.25, 1 - (r + 1) * 0.25, c * 0.25 + 0.25, 1 - r * 0.25]; }
const CORE_UV = [(3 * CELL + 128) / AT, 1 - (3 * CELL + 128) / AT];

export function bougainvilleaAtlas() {
  if (atlasTex) return atlasTex;
  const c = document.createElement('canvas'); c.width = AT; c.height = AT;
  const g = c.getContext('2d');
  g.clearRect(0, 0, AT, AT);
  const r01 = rng(9137);
  const greens = [['#142e0b', '#244a14', '#112a0a'], ['#1a3812', '#2e5a1e', '#163210'], ['#10280a', '#1f4212', '#0e2408'], ['#203c10', '#38601c', '#1a340c']];
  // row 0: single leaves (petiole at the cell bottom centre, tip at the top)
  for (let i = 0; i < 4; i++) drawLeaf(g, i * CELL + 128, CELL - 6, CELL * 0.94, CELL * (i % 2 ? 0.3 : 0.24), 0, greens[i]);
  // row 1: pom-pom clusters of bract triplets
  for (let i = 0; i < 4; i++) {
    const cx = i * CELL + 128, cy = CELL + 128;
    const n = 11;
    for (let k = 0; k < n; k++) {
      const a = r01() * Math.PI * 2, d = Math.sqrt(r01()) * 72;
      drawTriplet(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, 34 + 10 * r01(), r01() * 6.28, BRACT[(i + (r01() < 0.25 ? 1 : 0)) % 4], r01);
    }
    // a couple of leaves peeking out
    for (let k = 0; k < 2; k++) drawLeaf(g, cx + (r01() - 0.5) * 120, cy + 70 + r01() * 40, 70, 22, (r01() - 0.5) * 2.4, greens[k]);
  }
  // row 2: single triplets
  for (let i = 0; i < 4; i++) drawTriplet(g, i * CELL + 128, 2 * CELL + 128, 104, r01() * 6.28, BRACT[i], r01);
  // row 3: sprays (twig with leaves + bract clusters), cols 0..2
  for (let i = 0; i < 3; i++) {
    const x0 = i * CELL + 128, y0 = 4 * CELL - 8;
    g.strokeStyle = '#3a2614'; g.lineWidth = 5; g.lineCap = 'round';
    const tip = [x0 + (r01() - 0.5) * 60, 3 * CELL + 30];
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(x0 + (r01() - 0.5) * 70, (y0 + tip[1]) / 2, tip[0], tip[1]); g.stroke();
    for (let k = 0; k < 7; k++) {
      const t = 0.15 + 0.8 * (k / 6), px = x0 + (tip[0] - x0) * t, py = y0 + (tip[1] - y0) * t;
      drawLeaf(g, px, py, 60 + 25 * r01(), 20, (k % 2 ? 1 : -1) * (0.8 + 0.4 * r01()), greens[(k + i) % 4]);
    }
    for (let k = 0; k < 6; k++) {
      const t = 0.45 + 0.55 * r01(), px = x0 + (tip[0] - x0) * t + (r01() - 0.5) * 70, py = y0 + (tip[1] - y0) * t + (r01() - 0.5) * 30;
      drawTriplet(g, px, py, 26 + 8 * r01(), r01() * 6.28, BRACT[(i + k) % 4], r01);
    }
  }
  // opaque dark-foliage patch for the mound cores (cell 3,3)
  g.fillStyle = '#10240a'; g.fillRect(3 * CELL + 16, 3 * CELL + 16, CELL - 32, CELL - 32);
  // bleed colour into transparent texels so mips don't fringe dark
  const id = g.getImageData(0, 0, AT, AT), d = id.data;
  for (let y = 0; y < AT; y++) for (let x = 0; x < AT; x++) {
    const i = (y * AT + x) * 4;
    if (d[i + 3] < 8) { const row = Math.floor(y / CELL); const flow = row === 1 || row === 2; d[i] = flow ? 150 : 34; d[i + 1] = flow ? 20 : 62; d[i + 2] = flow ? 80 : 22; }
  }
  const flipped = new Uint8Array(AT * AT * 4);
  for (let y = 0; y < AT; y++) flipped.set(d.subarray(y * AT * 4, (y + 1) * AT * 4), (AT - 1 - y) * AT * 4);
  const tex = new THREE.DataTexture(flipped, AT, AT, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 8;
  tex.needsUpdate = true;
  atlasTex = tex;
  return tex;
}

// ------------------------------------------------------------------------------- material
const TRANS_GLSL = /* glsl */ `
void RE_Direct_CgBoug( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float back = saturate( -dot( geometryNormal, directLight.direction ) );
  float fwd = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 5.0 );
  float wrap = saturate( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );
  reflectedLight.directDiffuse += directLight.color * cgBougTrans * ( back * ( 0.3 + 0.9 * fwd ) + 0.05 * wrap ) * RECIPROCAL_PI;
}
#undef RE_Direct
#define RE_Direct RE_Direct_CgBoug
`;

const SPEC_GLSL = /* glsl */ `
material.specularF90 *= cgBougSpec;
material.specularColor *= cgBougSpec;
material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
`;

export const BOUG_U = { uBougTime: { value: 0 } };

export function bougainvilleaMaterial() {
  const mat = proceduralMaterial({
    name: 'bougainvillea',
    params: { map: bougainvilleaAtlas(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.55, metalness: 0, vertexColors: true },
    uniforms: { ...BOUG_U },
    vertexHead: /* glsl */`attribute float aAO; attribute float aSway; varying float vAO; uniform float uBougTime;`,
    vertexPre: /* glsl */`
      vAO = aAO;
      vec3 sp = transformed;
      float ph = dot(sp, vec3(0.71, 0.37, 0.53));
      transformed += aSway * vec3(sin(uBougTime * 1.6 + ph * 3.0) + 0.4 * sin(uBougTime * 3.7 + ph * 7.0), 0.3 * sin(uBougTime * 2.2 + ph * 5.0), cos(uBougTime * 1.2 + ph * 2.0));`,
    head: /* glsl */`varying float vAO; vec3 cgBougTrans = vec3(0.0); float cgBougSpec = 1.0;`,
    color: /* glsl */`
      vec3 c = diffuseColor.rgb;
      if (vAO < 0.15) {
        // opaque core between the cards: leafy cellular breakup, deep shade, a few bract specks
        vec2 vc = cgVoronoi3(cgP * 26.0);
        float cell = smoothstep(0.02, 0.3, vc.y - vc.x);
        float pink = step(0.82, cgHash13(floor(cgP * 26.0)));
        c = mix(vec3(0.009, 0.02, 0.006), vec3(0.022, 0.05, 0.014), cell);
        c = mix(c, vec3(0.16, 0.004, 0.06) * cell, pink);
      }
      // bracts: magenta, strongly translucent; leaves: green, mildly translucent
      float bract = smoothstep(0.02, 0.12, c.r - c.g);
      float n = cgVnoise3(cgP * 5.0);
      c *= mix(0.85, 1.15, n);
      if (!gl_FrontFacing) c = mix(c, c * vec3(1.15, 1.2, 1.0), 0.5 * (1.0 - bract));
      // bracts: deep saturated magenta (refs 3, 5), not pastel
      // r3: sampled refs 3/5 — sunlit bracts ≈ sRGB (210, 7, 81), shaded (90-120, 5-20, 20-35): crimson-magenta, almost no
      // green; lower albedo so the low sun does not push them into the desaturating shoulder (they read candy-pink)
      vec3 cb = c * vec3(0.64, 0.19, 0.52);
      cb = max(vec3(0.0), mix(vec3(cgLuma(cb)), cb, 1.75));
      // r6: refs 3/5 masses measure ≈ 0.76x our sRGB level (lit 157,30,57 vs 207,41,84) → deeper bracts
      cb *= 0.45;
      c = mix(c, cb, bract);
      diffuseColor.rgb = c;
      cgBougTrans = vAO < 0.15 ? vec3(0.0) : mix(vec3(0.05, 0.085, 0.015) * (0.6 + 0.6 * n), c * vec3(0.75, 0.12, 0.4), bract);`,
    roughness: /* glsl */`float bq = smoothstep(0.02, 0.12, diffuseColor.r - diffuseColor.g); roughnessFactor = vAO < 0.15 ? 0.9 : mix(0.45, 0.8, bq); cgBougSpec = vAO < 0.15 ? 0.3 : mix(0.45, 0.2, bq);`,
    ao: /* glsl */`cgAO = vAO < 0.15 ? 0.35 : vAO;`,
  });
  mat.alphaToCoverage = true;
  mat.userData.sunken = 'none';
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${TRANS_GLSL}`)
      // thin papery bracts / waxy leaves: weak Fresnel, otherwise grazing sun glare washes the colour out
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${SPEC_GLSL}`);
  };
  mat.userData.shaderKey += ':boug' + hashString(TRANS_GLSL + SPEC_GLSL).toString(36);
  const k = mat.userData.shaderKey;
  mat.customProgramCacheKey = () => k;
  return mat;
}

// ------------------------------------------------------------------------------- geometry builder
const V = THREE.Vector3;
const UP = new V(0, 1, 0);

class CardBuilder {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.ao = []; this.sway = []; this.idx = []; this.nor = []; }
  get n() { return this.pos.length / 3; }
  /** quad: anchor point `at` (bottom-centre for leaves/sprays, centre otherwise), blade direction `tip`, face normal `nrm` */
  card(at, tip, nrm, w, h, cell, { anchor = 'base', colr = [1, 1, 1], ao = 1, sway = 0, cup = 0.15, shadeN = null } = {}) {
    const t = tip.clone().addScaledVector(nrm, -tip.dot(nrm)).normalize();
    const b = new V().crossVectors(t, nrm).normalize();
    const [u0, v0, u1, v1] = cellUV(cell);
    const base = this.n;
    const y0 = anchor === 'base' ? 0 : -0.5;
    const sn = shadeN || nrm;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const x = i / 2 - 0.5, y = y0 + j / 2;
      const off = cup * h * (1 - 4 * x * x) * 0.5 - cup * h * (y - y0) * (y - y0) * 0.6;
      this.pos.push(at.x + b.x * x * w + t.x * y * h + nrm.x * off, at.y + b.y * x * w + t.y * y * h + nrm.y * off, at.z + b.z * x * w + t.z * y * h + nrm.z * off);
      this.uv.push(u0 + (i / 2) * (u1 - u0), v0 + (j / 2) * (v1 - v0));
      this.col.push(colr[0], colr[1], colr[2]);
      this.nor.push(sn.x, sn.y, sn.z);
      this.ao.push(ao); this.sway.push(sway * (j / 2));
    }
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const a = base + j * 3 + i; this.idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); }
  }
  /** opaque dark core surface: grid of points pts[j][i] (Vector3) with normals */
  core(grid, normals) {
    const base = this.n, ny = grid.length, nx = grid[0].length;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const p = grid[j][i], n = normals[j][i];
      this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z);
      this.uv.push(CORE_UV[0], CORE_UV[1]); this.col.push(0.6, 0.6, 0.6); this.ao.push(0.1); this.sway.push(0);
    }
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = base + j * nx + i; this.idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1); }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(this.ao, 1));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const tint = (r, k = 1) => { const v = (0.8 + 0.4 * r()) * k; return [v * (0.95 + 0.1 * r()), v, v * (0.92 + 0.12 * r())]; };
const jitter = (r, s) => new V((r() - 0.5) * s, (r() - 0.5) * s, (r() - 0.5) * s);
/** pick a bract colour family per mass (some plants more purple, some redder) */
function pickCells(r, family) {
  const fam = family ?? Math.floor(r() * 4);
  return (kind) => {
    const list = BOUG_CELLS[kind];
    if (kind === 'leaf' || kind === 'spray') return list[Math.floor(r() * list.length)];
    return list[r() < 0.7 ? fam : Math.floor(r() * 4)];
  };
}

/**
 * Populate an envelope with cards. sample(r) → { p: Vector3 on the envelope, n: outward normal, t: 0..1 (hang), down: bool }
 * counts per m² of envelope area (area given), scaled by density.
 */
function fillMass(B, r, sample, area, o) {
  const dens = o.density ?? 1, ls = o.leafScale ?? 1, flower = o.flower ?? 1;
  const cell = pickCells(r, o.family);
  const nLeaf = Math.round(area * 520 * dens), nClu = Math.round(area * 85 * dens * flower), nTri = Math.round(area * 120 * dens * flower), nSpray = Math.round(area * 75 * dens);
  const place = (kind, w, h, anchor, cupv, kTint) => {
    const s = sample(r);
    const depth = r() * (o.thickness ?? 0.18);
    const at = s.p.clone().addScaledVector(s.n, -depth).add(jitter(r, 0.04));
    const nrm = s.n.clone().add(jitter(r, kind === 'leaf' ? 1.3 : 0.9)).addScaledVector(UP, kind === 'leaf' ? 0.35 : 0.2).normalize();
    let tip;
    if (s.down) tip = new V(0, -1, 0).addScaledVector(s.side || new V(1, 0, 0), (r() - 0.5) * 2.2).addScaledVector(s.n, 0.3 + 0.4 * r()).normalize();
    else tip = s.n.clone().multiplyScalar(0.6).add(new V(r() - 0.5, 0.6 + r(), r() - 0.5)).normalize();
    if (Math.abs(tip.dot(nrm)) > 0.95) tip.add(new V(0.3, 0, 0.3)).normalize();
    // r3: deeper self-shading inside the mass (refs 3/5 show dark gaps between the bract clusters)
    const ao = Math.min(1, 0.22 + 0.85 * Math.pow(1 - depth / ((o.thickness ?? 0.18) + 1e-3), 1.4) * (s.light ?? 1));
    B.card(at, tip, nrm, w, h, cell(kind), { anchor, cup: cupv, colr: tint(r, kTint), ao, sway: (o.sway ?? 0.012) * (0.4 + s.t), shadeN: s.n.clone().addScaledVector(nrm, 0.5).normalize() });
  };
  for (let i = 0; i < nSpray; i++) { const L = ls * (0.26 + 0.14 * r()); place('spray', L, L, 'base', 0.1, 0.95); }
  for (let i = 0; i < nLeaf; i++) { const L = ls * (0.08 + 0.06 * r()); place('leaf', L * 0.55, L, 'base', 0.25, 1); }
  // r3: smaller, more numerous bract clusters (at 2-5 m the big cards read as flat 4-petal flowers)
  for (let i = 0; i < Math.round(nClu * 1.35); i++) { const L = ls * (0.12 + 0.09 * r()); place('cluster', L, L, 'centre', 0.12, 0.92 + 0.16 * r()); }
  for (let i = 0; i < nTri; i++) { const L = ls * (0.035 + 0.03 * r()); place('triplet', L, L, 'centre', 0.2, 1.0); }
  return nLeaf + nClu + nTri + nSpray;
}

// ------------------------------------------------------------------------------- set
export class BougainvilleaSet {
  constructor(engine) {
    this.engine = engine;
    this.B = new CardBuilder();
    this.density = Math.min(0.8, Math.max(0.6, engine.quality?.density ?? 1));   // r3: capped (cards are dense enough at 0.8)
    this.count = 0; this.cards = 0;
  }

  /**
   * Curtain spilling over an edge.
   * top: point on the top outer edge; facing: compass deg outward; length along the edge; drop: max hang (m);
   * depth: how far the mass spreads back over the top (m); ground(x,z) optional floor clamp.
   */
  curtain({ top, facing = 180, length = 2, drop = 1.4, depth = 0.5, mound = 0.35, seed, density = 1, family, ground, flower = 1, slope = 0, leafScale = 1 }) {
    const r = rng(seed ?? hashString('bc' + top.map((v) => v.toFixed(2)).join(',')));
    const f = (facing * Math.PI) / 180;
    const out = new V(Math.sin(f), 0, -Math.cos(f)), along = new V(Math.cos(f), 0, Math.sin(f));
    const P0 = new V(...top);
    // ragged hang envelope (longest streamers in a few places), lumpy mound on top
    const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
    const hang = (u) => {
      const e = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u * 2 - 1), 2.5)), 0.5);
      const w = 0.55 + 0.25 * Math.sin(u * length * 2.3 + ph[0]) + 0.2 * Math.sin(u * length * 5.1 + ph[1]);
      return Math.max(0.12, drop * e * Math.min(1, Math.max(0.15, w)));
    };
    const bulge = (u, s) => 0.08 + 0.22 * Math.sin(Math.PI * Math.min(1, s * 1.4)) * (0.7 + 0.3 * Math.sin(u * 7 + ph[2]));
    const moundH = (u, v) => mound * Math.sin(Math.PI * v) * (0.6 + 0.4 * Math.sin(u * length * 3.1 + ph[1])) * Math.pow(Math.sin(Math.PI * u), 0.4);
    // envelope point for (u along 0..1, w: -1 back on top → 0 edge → 1 bottom of the hang)
    const env = (u, w) => {
      // slope: rise (m per m) of the edge along `along` (sloping stair copings, r3)
      const base = P0.clone().addScaledVector(along, (u - 0.5) * length).addScaledVector(UP, (u - 0.5) * length * slope);
      if (w <= 0) {
        const v = -w; // 0 at the edge → 1 at the back
        const p = base.addScaledVector(out, -v * depth + 0.04).addScaledVector(UP, 0.03 + moundH(u, 1 - v * 0.9));
        return { p, n: UP.clone().addScaledVector(out, 0.5 * (1 - v)).normalize(), t: 0, down: false };
      }
      const s = w; const h = hang(u) * s;
      let p = base.addScaledVector(out, bulge(u, s)).addScaledVector(UP, -h + moundH(u, 0.1) * (1 - s));
      if (ground) { const gy = ground(p.x, p.z) + 0.08; if (p.y < gy) p.y = gy; }
      return { p, n: out.clone().addScaledVector(UP, 0.35 * (1 - s)).normalize(), t: s, down: true, side: along };
    };
    // area: top part (length × depth) + hang (∫ hang)
    let hangA = 0; for (let i = 0; i < 20; i++) hangA += hang((i + 0.5) / 20) / 20;
    const area = length * (depth + mound) + length * hangA;
    const fracTop = (depth + mound) / (depth + mound + hangA);
    this.cards += fillMass(this.B, r, (rr) => {
      const u = rr();
      if (rr() < fracTop) return env(u, -rr());
      const s = Math.pow(rr(), 0.8);
      const e = env(u, s); e.light = 1 - 0.4 * s; return e;
    }, area, { density: density * this.density, thickness: 0.2, family, flower, leafScale });
    // dark core under the cards
    const nx = Math.max(3, Math.round(length * 4)), grid = [], nor = [];
    for (let j = 0; j <= 6; j++) {
      const w = -1 + (j / 6) * 1.9, row = [], nr = [];
      for (let i = 0; i <= nx; i++) { const u = 0.03 + 0.94 * (i / nx); const e = env(u, w < 0 ? w : w * 0.92); row.push(e.p.clone().addScaledVector(e.n, -0.24)); nr.push(e.n); }
      grid.push(row); nor.push(nr);
    }
    this.B.core(grid, nor);
    // woody stems along a few streamers
    this.count++;
    return this;
  }

  /** dome mound (pots, planters, beds): base centre pos, radius, height; spill = how far strands hang over (m) */
  bush({ pos, radius = 0.6, height = 0.7, spill = 0.3, seed, density = 1, family, flower = 1, leafScale = 1 }) {
    const r = rng(seed ?? hashString('bb' + pos.map((v) => v.toFixed(2)).join(',')));
    const P0 = new V(...pos);
    const lumps = Array.from({ length: 6 }, () => [r() * 6.283, 0.2 + 0.6 * r(), 0.1 + 0.12 * r()]);
    const k = (a, e) => { let s = 1; for (const [la, le, amp] of lumps) { const da = Math.atan2(Math.sin(a - la), Math.cos(a - la)); s += amp * Math.exp(-(da * da) / 0.4 - ((e - le) * (e - le)) / 0.1); } return s; };
    const shell = (a, e) => {
      const el = e * Math.PI * 0.5, s = k(a, e);
      return new V(Math.cos(a) * Math.cos(el) * radius * s, Math.sin(el) * height * s, Math.sin(a) * Math.cos(el) * radius * s);
    };
    const area = Math.PI * radius * (radius + height) * 1.1 + 2 * Math.PI * radius * spill;
    const fs = spill > 0 ? (2 * Math.PI * radius * spill) / area : 0;
    this.cards += fillMass(this.B, r, (rr) => {
      const a = rr() * 6.283;
      if (rr() < fs) {
        // strands hanging over the rim
        const s = rr();
        const rad = new V(Math.cos(a), 0, Math.sin(a));
        const p = P0.clone().addScaledVector(rad, radius * (1.02 + 0.12 * s)).addScaledVector(UP, -s * spill * (0.5 + 0.8 * rr()));
        return { p, n: rad.clone().addScaledVector(UP, 0.2).normalize(), t: s, down: true, side: new V(-rad.z, 0, rad.x), light: 0.8 };
      }
      const e = Math.min(1, Math.pow(rr(), 0.8));
      const q = shell(a, e);
      const n = new V(q.x / radius, q.y / height, q.z / radius).normalize();
      return { p: P0.clone().add(q), n, t: 0.2, down: false, light: 0.7 + 0.3 * e };
    }, area, { density: density * this.density, thickness: 0.22 * Math.sqrt(leafScale), family, flower, leafScale });
    // core
    const grid = [], nor = [];
    for (let j = 0; j <= 5; j++) {
      const e = j / 5 * 0.98, row = [], nr = [];
      for (let i = 0; i <= 12; i++) { const a = (i / 12) * 6.283; const q = shell(a, e); const n = new V(q.x / radius, q.y / height, q.z / radius).normalize(); row.push(P0.clone().add(q).addScaledVector(n, -Math.min(0.27, radius * 0.4))); nr.push(n); }
      grid.push(row); nor.push(nr);
    }
    this.B.core(grid, nor);
    this.count++;
    return this;
  }

  /** vine climbing a column / pier: base on the axis, radius of the column, height; densest toward `side` (deg) */
  climb({ pos, radius = 0.45, height = 4, side = 180, coverage = 0.55, crown = 0.8, seed, density = 1, family, flower = 1, leafScale = 1 }) {
    const r = rng(seed ?? hashString('bk' + pos.map((v) => v.toFixed(2)).join(',')));
    const P0 = new V(...pos);
    const sideA = Math.atan2(-Math.cos((side * Math.PI) / 180), Math.sin((side * Math.PI) / 180));
    const arc = Math.PI * 2 * coverage;
    const area = arc * radius * height * 0.8 + crown * crown * 3;
    const fc = (crown * crown * 3) / area;
    const clumps = [];
    const nVine = 3 + Math.floor(r() * 2);
    for (let v = 0; v < nVine; v++) {
      const a0 = sideA + (r() - 0.5) * arc * 0.9, turn = (r() < 0.5 ? -1 : 1) * (0.08 + 0.12 * r());
      for (let y = 0.2 + r() * 0.4; y < height; y += 0.3 + 0.3 * r()) clumps.push([a0 + turn * y + (r() - 0.5) * 0.5, y, 0.3 + 0.3 * r()]);
    }
    this.cards += fillMass(this.B, r, (rr) => {
      if (rr() < fc) {
        // a hanging crown at the top (drapes from the capital / entablature)
        const a = sideA + (rr() - 0.5) * arc * 1.2, s = rr();
        const rad = new V(Math.cos(a), 0, Math.sin(a));
        const p = P0.clone().addScaledVector(rad, radius + 0.15 + crown * 0.5 * (1 - s)).addScaledVector(UP, height - s * crown * 1.4);
        return { p, n: rad.clone().addScaledVector(UP, 0.3 * (1 - s)).normalize(), t: s, down: true, side: new V(-rad.z, 0, rad.x) };
      }
      // leafy clumps along a few vines winding up the shaft (gaps show the column between them)
      const cl = clumps[Math.floor(rr() * clumps.length)];
      const gs = () => (rr() + rr() + rr() - 1.5) * 0.8;
      const y = Math.min(height, Math.max(0, cl[1] + gs() * cl[2]));
      const a = cl[0] + gs() * (cl[2] / Math.max(radius, 0.2)) * 1.2;
      const rad = new V(Math.cos(a), 0, Math.sin(a));
      const p = P0.clone().addScaledVector(rad, radius + 0.06 + 0.1 * rr()).addScaledVector(UP, y);
      return { p, n: rad.clone(), t: 0.3, down: rr() < 0.6, side: new V(-rad.z, 0, rad.x), light: 0.85 };
    }, area, { density: density * this.density * 0.8, thickness: 0.12, family, flower: flower * 0.9, leafScale });
    this.count++;
    return this;
  }

  build() {
    if (!this.count) return null;
    const geo = this.B.geometry();
    const mesh = new THREE.Mesh(geo, bougainvilleaMaterial());
    mesh.name = 'bougainvillea';
    mesh.castShadow = true; mesh.receiveShadow = true;
    // alpha-tested shadow casting
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: bougainvilleaAtlas(), alphaTest: 0.42, side: THREE.DoubleSide });
    this.engine.add(mesh);
    this.engine.onUpdate((t) => { BOUG_U.uBougTime.value = t; });
    this.mesh = mesh;
    this.tris = geo.index.count / 3;
    return mesh;
  }
}
