// Water lilies / lotus (refs 3, 5): round notched pads with radial veins, white star-shaped flowers with
// two rings of cupped pointed petals (faint pink tips) around a golden stamen boss.
//   pond: pads floating flat on a basin surface + a few flowers;   pot: raised pads on stems + flowers (lotus pot)
// All geometry merged into one mesh (1 draw call) with one small canvas atlas.
//
//   const set = new LotusSet(engine);
//   set.pond({ center:[x,y,z], radius: 4, cover: 0.35 });   // y = water surface
//   set.pot({ pos:[x,y,z], radius: 0.5 });                  // pos = soil / rim centre of a pot
//   set.build();
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { hashString } from '../core/rng.js';

const V = THREE.Vector3, UP = new V(0, 1, 0);
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

// atlas: 512 x 512; cells (256): [0,0] pad, [1,0] pad (younger, lighter), [0,1] petal, [1,1] stamens / stem
let atlasTex = null;
function lotusAtlas() {
  if (atlasTex) return atlasTex;
  const S = 512, C = 256;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  const r01 = rng(4411);
  const pad = (x0, y0, cols) => {
    const cx = x0 + C / 2, cy = y0 + C / 2, R = C * 0.47;
    g.save();
    g.beginPath(); g.moveTo(cx, cy);
    const notch = 0.13; // notch half-angle (rad) pointing down (+y)
    g.arc(cx, cy, R, Math.PI / 2 + notch, Math.PI / 2 - notch + Math.PI * 2);
    g.closePath();
    const gr = g.createRadialGradient(cx, cy, R * 0.05, cx, cy, R);
    gr.addColorStop(0, cols[0]); gr.addColorStop(0.7, cols[1]); gr.addColorStop(1, cols[2]);
    g.fillStyle = gr; g.fill();
    g.clip();
    g.strokeStyle = 'rgba(190,220,140,0.35)'; g.lineWidth = 1.6;
    for (let k = 0; k < 22; k++) { const a = Math.PI / 2 + notch + (k / 22) * (Math.PI * 2 - 2 * notch); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke(); }
    // mottling + a few sun-bleached / reddish spots
    for (let k = 0; k < 60; k++) { g.fillStyle = r01() < 0.2 ? 'rgba(120,40,30,0.18)' : 'rgba(10,30,5,0.18)'; g.beginPath(); g.arc(cx + (r01() - 0.5) * R * 1.8, cy + (r01() - 0.5) * R * 1.8, 3 + r01() * 9, 0, 6.28); g.fill(); }
    g.restore();
    g.strokeStyle = 'rgba(40,60,10,0.8)'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(cx, cy, R - 1, Math.PI / 2 + notch, Math.PI / 2 - notch + Math.PI * 2); g.stroke();
  };
  pad(0, 0, ['#7c9e38', '#477a22', '#2f5a16']);
  pad(C, 0, ['#98b84a', '#5a8a2a', '#3c6a1c']);
  // petal (pointed, base at the cell bottom)
  {
    const x0 = 0, y0 = C, cx = x0 + C / 2;
    g.beginPath(); g.moveTo(cx, y0 + C - 4);
    g.bezierCurveTo(cx + C * 0.3, y0 + C * 0.7, cx + C * 0.22, y0 + C * 0.2, cx, y0 + 6);
    g.bezierCurveTo(cx - C * 0.22, y0 + C * 0.2, cx - C * 0.3, y0 + C * 0.7, cx, y0 + C - 4);
    const gr = g.createLinearGradient(0, y0 + C, 0, y0);
    gr.addColorStop(0, '#d8d4a8'); gr.addColorStop(0.25, '#f6f3ea'); gr.addColorStop(0.8, '#fbf8f2'); gr.addColorStop(1, '#f0c8d0');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(200,190,170,0.5)'; g.lineWidth = 1.2;
    for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(cx + k * 3, y0 + C - 10); g.quadraticCurveTo(cx + k * 12, y0 + C * 0.5, cx + k * 4, y0 + 20); g.stroke(); }
  }
  // stamens boss + stem colour
  {
    const cx = C + C / 2, cy = C + C / 2;
    g.fillStyle = '#c89a1a'; g.beginPath(); g.arc(cx, cy, C * 0.45, 0, 6.28); g.fill();
    for (let k = 0; k < 220; k++) { const a = r01() * 6.28, d = Math.sqrt(r01()) * C * 0.43; g.fillStyle = r01() < 0.5 ? '#f2d040' : '#e8b020'; g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 3 + r01() * 4, 0, 6.28); g.fill(); }
    g.fillStyle = '#9ab040'; g.beginPath(); g.arc(cx, cy, C * 0.12, 0, 6.28); g.fill();
  }
  const id = g.getImageData(0, 0, S, S), d = id.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (d[i + 3] < 8) { const petal = y >= C && x < C; d[i] = petal ? 240 : 40; d[i + 1] = petal ? 236 : 80; d[i + 2] = petal ? 225 : 22; }
  }
  const flipped = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) flipped.set(d.subarray(y * S * 4, (y + 1) * S * 4), (S - 1 - y) * S * 4);
  const tex = new THREE.DataTexture(flipped, S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 8;
  tex.needsUpdate = true;
  atlasTex = tex;
  return tex;
}
const CELL = { pad: [[0, 0.5, 0.5, 1], [0.5, 0.5, 1, 1]], petal: [0, 0, 0.5, 0.5], boss: [0.5, 0, 1, 0.5], stem: [0.75, 0.25, 0.75, 0.25] };

export function lotusMaterial() {
  const m = proceduralMaterial({
    name: 'lotus',
    params: { map: lotusAtlas(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.45, metalness: 0, vertexColors: true },
    head: /* glsl */`vec3 cgLotusTrans = vec3(0.0);`,
    color: /* glsl */`
      float white = smoothstep(0.45, 0.7, min(diffuseColor.r, diffuseColor.b));
      diffuseColor.rgb *= mix(0.9, 1.08, cgVnoise3(cgP * 9.0));
      // keep petals a realistic white (albedo ~0.75), not paper-white
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.9, white);
      cgLotusTrans = vec3(white);`,
    emissive: /* glsl */`
      // r6: thin petals glow when back-lit by the low sun (ref 5: white lilies bright against the shade)
      #ifdef USE_FOG
      float back = pow(clamp(dot(-cgV, uSunDir), 0.0, 1.0), 2.0);
      totalEmissiveRadiance += diffuseColor.rgb * mix(vec3(0.6, 0.9, 0.3) * 0.12, vec3(1.0, 0.95, 0.85) * 0.45, cgLotusTrans.x) * back;
      #endif`,
    roughness: /* glsl */`roughnessFactor = 0.38 + 0.25 * cgVnoise3(cgP * 20.0);`,
  });
  m.userData.sunken = 'none';
  return m;
}

class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  vert(p, n, u, v, c) { this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v); this.col.push(c[0], c[1], c[2]); }
  /** disc pad: centre c, normal n, radius R, notch toward dir; ripple = edge wave amplitude */
  pad(c, n, R, rot, cell, colr, ripple = 0.02, cup = 0) {
    const t = Math.abs(n.y) < 0.95 ? new V().crossVectors(n, UP).normalize() : new V(1, 0, 0);
    const b = new V().crossVectors(n, t).normalize();
    const ct = Math.cos(rot), st = Math.sin(rot);
    const ex = t.clone().multiplyScalar(ct).addScaledVector(b, st), ey = t.clone().multiplyScalar(-st).addScaledVector(b, ct);
    const [u0, v0, u1, v1] = cell;
    const seg = 14, base = this.n;
    this.vert(c.clone().addScaledVector(n, cup * R), n, (u0 + u1) / 2, (v0 + v1) / 2, colr);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a), y = Math.sin(a);
      const w = ripple * R * Math.sin(a * 5 + rot * 3) - cup * R * 0.0;
      const p = c.clone().addScaledVector(ex, x * R).addScaledVector(ey, y * R).addScaledVector(n, w);
      // uv: the atlas pad image has its notch toward +y of the canvas → v decreasing
      this.vert(p, n, (u0 + u1) / 2 + x * (u1 - u0) * 0.5, (v0 + v1) / 2 - y * (v1 - v0) * 0.5, colr);
    }
    for (let i = 0; i < seg; i++) this.idx.push(base, base + 1 + i, base + 2 + i);
  }
  /** curved petal strip from base point along dir (tip), normal nrm, width w, length L */
  petal(base, dir, nrm, w, L, colr, curl = 0.25) {
    const side = new V().crossVectors(dir, nrm).normalize();
    const [u0, v0, u1, v1] = CELL.petal;
    const b0 = this.n;
    for (let j = 0; j < 4; j++) {
      const s = j / 3;
      for (let i = 0; i < 3; i++) {
        const x = i / 2 - 0.5;
        const off = curl * L * s * s + 0.12 * L * (1 - 4 * x * x) * 0.5;
        const p = base.clone().addScaledVector(dir, s * L).addScaledVector(side, x * w).addScaledVector(nrm, off);
        this.vert(p, nrm, u0 + (i / 2) * (u1 - u0), v0 + s * (v1 - v0), colr);
      }
    }
    for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) { const a = b0 + j * 3 + i; this.idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); }
  }
  /** thin stem tube from a to b */
  stem(a, b, r, colr) {
    const d = b.clone().sub(a), L = d.length(); d.normalize();
    const t = Math.abs(d.y) < 0.95 ? new V().crossVectors(d, UP).normalize() : new V(1, 0, 0), bb = new V().crossVectors(d, t);
    const b0 = this.n, seg = 5;
    for (let j = 0; j < 2; j++) for (let i = 0; i <= seg; i++) {
      const ang = (i / seg) * 6.283, n = t.clone().multiplyScalar(Math.cos(ang)).addScaledVector(bb, Math.sin(ang));
      this.vert((j ? b : a).clone().addScaledVector(n, r), n, CELL.stem[0], CELL.stem[1], colr);
    }
    for (let i = 0; i < seg; i++) { const a0 = b0 + i, c0 = b0 + seg + 1 + i; this.idx.push(a0, c0, a0 + 1, a0 + 1, c0, c0 + 1); }
  }
  /** flower: centre c (petal bases), facing up-ish normal n, radius R, openness 0..1 */
  flower(c, n, R, open, r) {
    const t = Math.abs(n.y) < 0.95 ? new V().crossVectors(n, UP).normalize() : new V(1, 0, 0);
    const b = new V().crossVectors(n, t).normalize();
    const rings = [[12, 1.0, 0.45 + 0.55 * open], [10, 0.85, 0.3 + 0.45 * open], [7, 0.62, 0.12 + 0.3 * open]];
    rings.forEach(([cnt, k, op], ri) => {
      const ph = r() * 6.28;
      for (let i = 0; i < cnt; i++) {
        const a = ph + (i / cnt) * Math.PI * 2;
        const radial = t.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
        const el = (Math.PI / 2) * (1 - op) + 0.1;     // elevation of the petal axis from the flower plane
        const dir = radial.clone().multiplyScalar(Math.cos(el)).addScaledVector(n, Math.sin(el)).normalize();
        const nrm = n.clone().multiplyScalar(Math.cos(el)).addScaledVector(radial, -Math.sin(el)).normalize();
        const L = R * k * (0.9 + 0.2 * r());
        const tint = 0.92 + 0.1 * r();
        this.petal(c.clone().addScaledVector(radial, R * 0.08).addScaledVector(n, ri * 0.01 * R), dir, nrm, L * 0.56, L, [tint, tint * (0.97 + 0.03 * r()), tint * 0.98], 0.18);
      }
    });
    if (open > 0) this.pad(c.clone().addScaledVector(n, R * 0.06), n, R * 0.2, 0, CELL.boss, [1, 1, 1], 0.0);   // buds: no stamen boss
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export class LotusSet {
  constructor(engine) { this.engine = engine; this.B = new Builder(); this.count = 0; }

  /** pads floating on a water surface (centre = water surface point), radius of the basin, cover fraction */
  pond({ center, radius = 4, cover = 0.3, flowers, seed, inner = 0 }) {
    const r = rng(seed ?? hashString('lp' + center.map((v) => v.toFixed(2)).join(',')));
    const C = new V(...center);
    const area = Math.PI * (radius * radius - inner * inner);
    const nPads = Math.min(900, Math.round(area * cover / 0.09));
    // pads in drifting colonies
    const colonies = Array.from({ length: Math.max(2, Math.round(radius * 1.2)) }, () => { const a = r() * 6.28, d = inner + (radius - inner) * Math.sqrt(r()) * 0.85; return [Math.cos(a) * d, Math.sin(a) * d]; });
    const placed = [];
    for (let i = 0; i < nPads; i++) {
      const [cx, cz] = colonies[Math.floor(r() * colonies.length)];
      const R = 0.12 + 0.16 * r();
      const x = cx + (r() - 0.5) * radius * 0.7, z = cz + (r() - 0.5) * radius * 0.7;
      const d = Math.hypot(x, z);
      if (d > radius - R - 0.15 || d < inner + R) continue;
      if (placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < (pr + R) * 0.8)) continue;
      placed.push([x, z, R]);
      const g = 0.75 + 0.35 * r();
      this.B.pad(new V(C.x + x, C.y + 0.012 + r() * 0.01, C.z + z), new V((r() - 0.5) * 0.06, 1, (r() - 0.5) * 0.06).normalize(), R, r() * 6.28, CELL.pad[r() < 0.75 ? 0 : 1], [g, g, g * 0.95], 0.03);
    }
    const nf = flowers ?? Math.round(placed.length * 0.12);
    for (let i = 0; i < nf && placed.length; i++) {
      const [x, z, R] = placed[Math.floor(r() * placed.length)];
      this.B.flower(new V(C.x + x + R * 0.3, C.y + 0.03, C.z + z), new V((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2).normalize(), 0.09 + 0.05 * r(), 0.5 + 0.5 * r(), r);
    }
    this.count++;
    return this;
  }

  /** lotus pot: raised pads on stems + flowers standing above (pos = soil centre, radius = rim radius) */
  pot({ pos, radius = 0.5, seed, flowers }) {
    const r = rng(seed ?? hashString('lt' + pos.map((v) => v.toFixed(2)).join(',')));
    const P = new V(...pos);
    const stemC = [0.16, 0.3, 0.08];
    // r3 (ref 5): a lush dome of big round leaves filling the pot and bowing over the rim, white lotus flowers
    // held above the leaves on long stems, a few closed buds. Leaf / flower sizes have absolute minima so small
    // pots on a balustrade still read as lotus, not as a few sticks.
    const Rl = Math.max(radius, 0.32);
    const nPads = Math.round(9 + Rl * 15);
    for (let i = 0; i < nPads; i++) {
      const a = (i / nPads) * 6.28 * 2.618 + r() * 0.6;      // golden-angle spiral: even coverage
      const k = Math.sqrt((i + 0.5) / nPads);                 // 0 centre → 1 rim
      const out = new V(Math.cos(a), 0, Math.sin(a));
      const reach = Rl * (0.15 + 1.05 * k) * (0.9 + 0.25 * r());
      const lift = Rl * ((1 - k) * 0.55 + 0.1 + 0.22 * r()) - (k > 0.85 ? Rl * 0.18 * r() : 0);
      const c = P.clone().addScaledVector(out, reach).addScaledVector(UP, lift);
      // inner pads face up-ish, outer ones bow outward over the rim (ref 5)
      const tilt = 0.15 + 0.7 * k * k + 0.2 * r();
      const n = UP.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(out, Math.sin(tilt)).add(new V((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3)).normalize();
      const R = Math.max(0.085, Rl * (0.24 + 0.16 * r()));
      this.B.stem(P.clone().addScaledVector(out, reach * 0.15), c.clone().addScaledVector(out, -R * 0.5), 0.006 + 0.005 * Rl, stemC);
      const g = 0.75 + 0.35 * r();
      this.B.pad(c, n, R, r() * 6.28, CELL.pad[r() < 0.65 ? 0 : 1], [g, g, g * 0.95], 0.07, 0.1);
    }
    // r6 (ref 5): big open white flowers resting on the leaf dome, not held high on bare stalks
    const nf = flowers ?? Math.round(5 + Rl * 8);
    const fR = Math.min(0.2, Math.max(0.1, Rl * 0.3));
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * 6.28 + r() * 0.9, d = Rl * (0.12 + 0.7 * Math.sqrt(r()));
      const c = P.clone().add(new V(Math.cos(a) * d, Rl * (0.62 + 0.3 * r()) * (1 - 0.35 * (d / Rl) * (d / Rl)) + fR * 0.35, Math.sin(a) * d));
      this.B.stem(P.clone().add(new V(Math.cos(a) * d * 0.3, 0, Math.sin(a) * d * 0.3)), c, 0.006 + 0.004 * Rl, stemC);
      const n = new V(Math.cos(a) * (0.25 + 0.35 * r()), 1, Math.sin(a) * (0.25 + 0.35 * r())).normalize();
      this.B.flower(c, n, fR * (0.85 + 0.3 * r()), 0.55 + 0.4 * r(), r);
    }
    // closed buds
    for (let i = 0; i < Math.round(1 + Rl * 3); i++) {
      const a = r() * 6.28, d = Rl * 0.5 * Math.sqrt(r());
      const c = P.clone().add(new V(Math.cos(a) * d, Rl * (0.9 + 0.45 * r()) + fR, Math.sin(a) * d));
      this.B.stem(P.clone().add(new V(Math.cos(a) * d * 0.3, 0, Math.sin(a) * d * 0.3)), c, 0.005 + 0.003 * Rl, stemC);
      this.B.flower(c, new V(Math.cos(a) * 0.2, 1, Math.sin(a) * 0.2).normalize(), fR * 0.55, -0.45, r);
    }
    this.count++;
    return this;
  }

  build() {
    if (!this.count) return null;
    const geo = this.B.geometry();
    const mesh = new THREE.Mesh(geo, lotusMaterial());
    mesh.name = 'lotus';
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: lotusAtlas(), alphaTest: 0.45, side: THREE.DoubleSide });
    this.engine.add(mesh);
    this.mesh = mesh; this.tris = geo.index.count / 3;
    return mesh;
  }
}
