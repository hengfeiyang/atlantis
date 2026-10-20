// Trident mosaic medallion (ref 8 foreground): concentric bands of tesserae — navy roundel with a gold
// trident, gold ring, white band with a navy running-wave scroll, red ring, navy band with white /
// red scales, gold ring, a band of navy-and-red petals, navy wave border — drawn tessera by tessera
// on a canvas (colour map + a grout height map), mapped on a broken disc of tilted plates.
import * as THREE from 'three';
import { proceduralMaterial, cached } from '../core/materials.js';
import { RNG } from '../core/rng.js';
import { Simplex } from '../core/noise.js';

const NAVY = [18, 40, 128], NAVY2 = [34, 70, 170], WHITE = [238, 232, 216], RED = [178, 44, 30], GOLD = [232, 176, 60], BLACK = [26, 26, 34];

function tridentShape(x, y) { // x,y in [-1,1] of the roundel; returns true inside the trident glyph
  const ax = Math.abs(x);
  if (ax < 0.07 && y > -0.85 && y < 0.55) return true;                         // shaft
  if (y > 0.2 && y < 0.32 && ax < 0.45) return true;                            // crossbar
  if (ax > 0.33 && ax < 0.45 && y > 0.2 && y < 0.62) return true;               // side prongs
  const tip = (cx, cy) => { const u = Math.abs(x - cx), v = y - cy; return v > 0 && v < 0.28 && u < 0.13 * (1 - v / 0.28); };
  if (tip(0, 0.55) || tip(0.39, 0.6) || tip(-0.39, 0.6)) return true;
  // barbs
  const barb = (cx, cy, s) => { const u = (x - cx) * s, v = y - cy; return u > 0 && u < 0.12 && v > -0.08 + u * 0.4 && v < 0.0 + u * 0.4; };
  if (barb(0.07, 0.6, 1) || barb(-0.07, 0.6, -1) || barb(0.45, 0.66, 1) || barb(-0.45, 0.66, -1)) return true;
  if (ax < 0.12 && y > -0.95 && y < -0.82) return true;                         // butt
  return false;
}

function bandColor(r, a, rng) {
  // r in [0,1] (fraction of the medallion radius), a angle
  if (r < 0.2) {
    const x = (r / 0.2) * Math.cos(a), y = (r / 0.2) * Math.sin(a);
    return tridentShape(x, -y) ? GOLD : (r > 0.185 ? WHITE : NAVY);
  }
  if (r < 0.235) return GOLD;
  if (r < 0.40) { // running wave (Vitruvian scroll) navy on white
    const t = (r - 0.235) / 0.165, n = 22;
    const ph = (a / (Math.PI * 2)) * n; const f = ph - Math.floor(ph);
    const wave = 0.5 + 0.42 * Math.sin(f * Math.PI * 2) * (1 - 0.35 * Math.cos(f * Math.PI * 4));
    const curl = Math.hypot((f - 0.25) * 2.2, t - 0.62) < 0.2 ? 1 : 0;
    return (t < wave && !(curl && t > 0.45)) ? NAVY : WHITE;
  }
  if (r < 0.43) return RED;
  if (r < 0.455) return WHITE;
  if (r < 0.60) { // fish scales
    const t = (r - 0.455) / 0.145, n = 40;
    const ph = (a / (Math.PI * 2)) * n + (Math.floor(t * 3) % 2) * 0.5;
    const f = ph - Math.floor(ph), tt = (t * 3) % 1;
    const inS = Math.hypot(f - 0.5, tt * 0.9) < 0.48;
    return inS ? (Math.hypot(f - 0.5, tt * 0.9) > 0.36 ? WHITE : NAVY2) : RED;
  }
  if (r < 0.63) return GOLD;
  if (r < 0.65) return BLACK;
  if (r < 0.86) { // petals: navy tear-drops on white with red hearts
    const t = (r - 0.65) / 0.21, n = 24;
    const ph = (a / (Math.PI * 2)) * n; const f = Math.abs(ph - Math.floor(ph) - 0.5) * 2;
    const w = 0.85 * Math.sin(Math.PI * Math.min(1, t * 1.05));
    if (f < w * 0.55 && t > 0.15 && t < 0.85) return RED;
    if (f < w) return NAVY;
    return WHITE;
  }
  if (r < 0.88) return RED;
  if (r < 0.97) { // wave border, white on navy
    const t = (r - 0.88) / 0.09, n = 48;
    const ph = (a / (Math.PI * 2)) * n; const f = ph - Math.floor(ph);
    return t < 0.5 + 0.35 * Math.sin(f * Math.PI * 2) ? WHITE : NAVY;
  }
  return WHITE;
}

/** canvas textures { map, bump } of the medallion (size px), tesserae ts px */
export function mosaicTextures(size = 2048, ts = 9, seed = 'mos') {
  if (typeof document === 'undefined') return { map: null, bump: null }; // node (bake): no canvas
  return cached('sets:mosaicTex:' + size + ':' + ts, () => {
    const rng = new RNG(seed);
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const bv = document.createElement('canvas'); bv.width = bv.height = size;
    const c = cv.getContext('2d'), b = bv.getContext('2d');
    c.fillStyle = 'rgb(70,64,56)'; c.fillRect(0, 0, size, size);    // grout
    b.fillStyle = 'rgb(40,40,40)'; b.fillRect(0, 0, size, size);
    const R = size / 2;
    // concentric rows of tesserae (opus vermiculatum follows the bands)
    for (let rr = ts * 0.5; rr < R; rr += ts) {
      const n = Math.max(6, Math.round((2 * Math.PI * rr) / ts));
      const off = rng.next() * 6.283;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2 + (rng.next() - 0.5) * 0.15 / n * 6;
        const r1 = rr + (rng.next() - 0.5) * ts * 0.12;
        const x = R + Math.cos(a) * r1, y = R + Math.sin(a) * r1;
        let col = bandColor(r1 / R, a, rng);
        const k = 0.86 + 0.24 * rng.next();
        const cc = col.map((v) => Math.max(0, Math.min(255, Math.round(v * k + (rng.next() - 0.5) * 10))));
        const s = ts * (0.78 + 0.1 * rng.next());
        c.save(); c.translate(x, y); c.rotate(a + (rng.next() - 0.5) * 0.25);
        c.fillStyle = `rgb(${cc[0]},${cc[1]},${cc[2]})`;
        c.fillRect(-s / 2, -s / 2, s, s);
        c.restore();
        b.save(); b.translate(x, y); b.rotate(a);
        const h = 180 + Math.round(60 * rng.next());
        b.fillStyle = `rgb(${h},${h},${h})`; b.fillRect(-s / 2, -s / 2, s, s);
        b.restore();
      }
    }
    const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    const bump = new THREE.CanvasTexture(bv); bump.anisotropy = 8;
    for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }
    return { map, bump };
  });
}

export function mosaicMaterial(sunken) {
  return cached('sets:mosaicMat:' + sunken, () => {
    const { map, bump } = mosaicTextures();
    const m = proceduralMaterial({
      name: 'sets-mosaic',
      params: { color: 0xffffff, map, bumpMap: bump, bumpScale: 2.0, roughness: sunken ? 0.75 : 0.35, metalness: 0 },
      color: `diffuseColor.rgb *= 0.92 + 0.12 * cgVnoise2(cgP.xz * 1.3);`,
    });
    m.userData.sunken = 'stone';
    m.userData.sunkenAmount = 0.3;   // ref 8: the medallion reads crisp (sand only drifts against its rim)
    return m;
  });
}

/**
 * Broken medallion: a disc of radius R (local xz, y up) cracked into tilted plates (Voronoi cells),
 * some missing, a ragged rim. UVs map the medallion. Returns { geometry, plates: [{c:[x,z], missing}] }.
 */
export function brokenDiscGeometry(R, o = {}) {
  const rng = new RNG(o.seed || 'disc');
  const N = new Simplex(77);
  const step = o.step ?? 0.08;
  const nCell = o.cells ?? 34;
  const seeds = [];
  for (let i = 0; i < nCell; i++) { const [u, v] = rng.disk(); seeds.push({ x: u * R * 1.05, z: v * R * 1.05, tx: (rng.next() - 0.5) * 0.06, tz: (rng.next() - 0.5) * 0.06, dy: (rng.next() - 0.5) * 0.06 - 0.015, gone: rng.next() < (o.missing ?? 0.16) }); }
  const cellOf = (x, z) => { let b = 0, bd = 1e9, b2 = 1e9; for (let i = 0; i < seeds.length; i++) { const d = (x - seeds[i].x) ** 2 + (z - seeds[i].z) ** 2; if (d < bd) { b2 = bd; bd = d; b = i; } else if (d < b2) b2 = d; } return [b, Math.sqrt(b2) - Math.sqrt(bd)]; };
  const n = Math.ceil((2 * R) / step);
  const pos = [], uv = [], idx = [];
  const vid = new Int32Array((n + 1) * (n + 1)).fill(-1);
  const keepV = (x, z) => {
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    const rim = R * (0.93 + 0.07 * N.noise2(Math.cos(a) * 2.5, Math.sin(a) * 2.5)) - (o.biteR && Math.hypot(x - o.bite[0], z - o.bite[1]) < o.biteR ? 99 : 0);
    return r < rim;
  };
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = -R + i * step, z = -R + j * step;
    if (!keepV(x, z)) continue;
    const [c] = cellOf(x, z);
    const S = seeds[c];
    vid[j * (n + 1) + i] = pos.length / 3;
    pos.push(x, S.dy + S.tx * (x - S.x) + S.tz * (z - S.z), z);
    uv.push(0.5 + x / (2 * R), 0.5 - z / (2 * R));
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = vid[j * (n + 1) + i], b = vid[j * (n + 1) + i + 1], c = vid[(j + 1) * (n + 1) + i + 1], d = vid[(j + 1) * (n + 1) + i];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    const cx = -R + (i + 0.5) * step, cz = -R + (j + 0.5) * step;
    const [ci, gap] = cellOf(cx, cz);
    if (seeds[ci].gone) continue;
    if (gap < 0.035 + 0.03 * Math.abs(N.noise2(cx * 3, cz * 3))) continue;  // cracks between plates
    idx.push(a, c, b, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, seeds };
}
