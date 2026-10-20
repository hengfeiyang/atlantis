// CPU sculpt preview of the giant head (node only, no GPU): meshes the SDF, rasterises it with a
// z-buffer + sun shadow map + cavity AO and writes a PNG (and a side-by-side with the ref-8 crop).
//   node src/ruins/headpreview.mjs --cell 0.014 --view cam8 --out out/ruins/p.png [--crop 900,0,772,941]
//   views: cam8 (shot-8 camera, ref crop alongside), front, tq (three-quarter), side, below
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { buildHeadGeometry, HEAD_SCALE } from '../sculpt/head.js';
import { headWorldMatrix } from './headpose.js';
import { shotCam, camVec, REF_W, REF_H } from './camspace.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const A = {};
for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]; if (k.startsWith('--')) { const n = process.argv[i + 1]; if (n === undefined || n.startsWith('--')) A[k.slice(2)] = true; else { A[k.slice(2)] = n; i++; } } }
const cell = Number(A.cell || 0.016);
const views = String(A.view || 'cam8').split(',');
const sunAz = Number(A.az ?? 249), sunEl = Number(A.el ?? 28);

const t0 = Date.now();
let geo;
if (A.bin) { const { deserializeGeometry } = await import('../core/cache.js'); const b = fs.readFileSync(path.join(ROOT, 'generated', String(A.bin) + '.bin')); geo = deserializeGeometry(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
else geo = buildHeadGeometry({ cell, sky: A.nosky ? false : undefined });
if (A.recompute) geo.computeVertexNormals();
const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, idx = geo.index.array;
const cav = geo.attributes.cav.array, aux = geo.attributes.aux.array;
const nV = pos.length / 3;
console.log(`[preview] mesh ${(idx.length / 3 / 1000).toFixed(0)} k tris in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

for (const view of views) renderView(view);

function renderView(view) {
  const t1 = Date.now();
  // ---- world transform + camera
  let M, cam, W, H, ox = 0, oy = 0, sc = 1, sunDir;
  if (view === 'cam8') {
    M = headWorldMatrix().matrix;
    const c = shotCam(8).cam;
    cam = c;
    const [cx, cy, cw, ch] = String(A.crop || '900,0,772,941').split(',').map(Number);
    sc = Number(A.scale || 1);
    W = Math.round(cw * sc); H = Math.round(ch * sc); ox = cx; oy = cy;
    const az = (sunAz * Math.PI) / 180, el = (sunEl * Math.PI) / 180;
    sunDir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
    if (A.lightcam) { sunDir = camVec(8, ...String(A.lightcam).split(',').map(Number)).normalize(); const az2 = Math.atan2(sunDir.x, -sunDir.z) * 180 / Math.PI; console.log(`[preview] light az ${((az2 + 360) % 360).toFixed(0)} el ${(Math.asin(sunDir.y) * 180 / Math.PI).toFixed(0)}`); }
  } else {
    M = new THREE.Matrix4(); // head local metres; face looks +z, crown +y
    const dirs = { front: [0, 0.05, 1], tq: [0.75, 0.1, 0.75], side: [1, 0.05, 0.02], below: [-0.7, -0.45, 0.6], fl: [-0.75, 0.1, 0.75], top: [0.3, 1, 0.5], back: [0.6, 0.3, -0.75],
      eye: [0.5, -0.1, 1], mouth: [0.45, -0.3, 1], nose: [0.8, -0.35, 0.6] };
    const ats = { eye: [0.13, 0.0, 0.4], mouth: [0.03, -0.28, 0.45], nose: [0.02, -0.15, 0.5] };
    const dists = { eye: 1.6, mouth: 1.6, nose: 2.0 };
    const d = new THREE.Vector3(...(dirs[view] || dirs.front)).normalize();
    const at = new THREE.Vector3(...(ats[view] || [0, -0.02, 0.1])).multiplyScalar(HEAD_SCALE);
    cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    cam.position.copy(d.clone().multiplyScalar(dists[view] || 6.2)).add(at);
    cam.lookAt(at); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    W = H = Number(A.size || 760);
    // light from upper left-front of the viewer
    sunDir = new THREE.Vector3(-0.6, 0.65, 0.45).applyQuaternion(cam.quaternion).normalize();
    sunDir.set(sunDir.x, Math.abs(sunDir.y), sunDir.z).normalize();
  }
  const fullW = view === 'cam8' ? REF_W : W, fullH = view === 'cam8' ? REF_H : H;
  const e = M.elements;
  const wp = new Float32Array(nV * 3), wn = new Float32Array(nV * 3);
  const nm = new THREE.Matrix3().getNormalMatrix(M).elements;
  for (let i = 0; i < nV; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    wp[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
    wp[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    wp[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    const a = nor[i * 3], b = nor[i * 3 + 1], c = nor[i * 3 + 2];
    let nx = nm[0] * a + nm[3] * b + nm[6] * c, ny = nm[1] * a + nm[4] * b + nm[7] * c, nz = nm[2] * a + nm[5] * b + nm[8] * c;
    const l = Math.hypot(nx, ny, nz) || 1; wn[i * 3] = nx / l; wn[i * 3 + 1] = ny / l; wn[i * 3 + 2] = nz / l;
  }
  // ---- shadow map (orthographic along the sun)
  const L = sunDir.clone().normalize();
  const U = new THREE.Vector3().crossVectors(L, Math.abs(L.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
  const V = new THREE.Vector3().crossVectors(U, L).normalize();
  const SM = 2048;
  let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9;
  const lu = new Float32Array(nV), lv = new Float32Array(nV), ld = new Float32Array(nV);
  for (let i = 0; i < nV; i++) {
    const x = wp[i * 3], y = wp[i * 3 + 1], z = wp[i * 3 + 2];
    lu[i] = x * U.x + y * U.y + z * U.z; lv[i] = x * V.x + y * V.y + z * V.z; ld[i] = -(x * L.x + y * L.y + z * L.z);
    umin = Math.min(umin, lu[i]); umax = Math.max(umax, lu[i]); vmin = Math.min(vmin, lv[i]); vmax = Math.max(vmax, lv[i]);
  }
  const ext = Math.max(umax - umin, vmax - vmin) * 1.02;
  const smz = new Float32Array(SM * SM).fill(1e9);
  const toS = (u) => ((u - umin) / ext) * SM, toT = (v) => ((v - vmin) / ext) * SM;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    raster(toS(lu[a]), toT(lv[a]), toS(lu[b]), toT(lv[b]), toS(lu[c]), toT(lv[c]), SM, SM, (px, py, w0, w1, w2) => {
      const d = w0 * ld[a] + w1 * ld[b] + w2 * ld[c];
      const k = py * SM + px; if (d < smz[k]) smz[k] = d;
    });
  }
  // ---- camera pass
  cam.updateMatrixWorld(true);
  const VM = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
  const sx = new Float32Array(nV), sy = new Float32Array(nV), sz = new Float32Array(nV);
  for (let i = 0; i < nV; i++) {
    const x = wp[i * 3], y = wp[i * 3 + 1], z = wp[i * 3 + 2];
    const vx = VM[0] * x + VM[4] * y + VM[8] * z + VM[12], vy = VM[1] * x + VM[5] * y + VM[9] * z + VM[13], vz = VM[2] * x + VM[6] * y + VM[10] * z + VM[14];
    const cx = P[0] * vx + P[8] * vz, cy = P[5] * vy + P[9] * vz, cw = -vz;
    sx[i] = ((cx / cw) * 0.5 + 0.5) * fullW * sc - ox * sc; sy[i] = (0.5 - (cy / cw) * 0.5) * fullH * sc - oy * sc; sz[i] = cw;
  }
  const zb = new Float32Array(W * H).fill(1e9), tri = new Int32Array(W * H).fill(-1);
  const bw = new Float32Array(W * H * 2);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (sz[a] < 0.05 || sz[b] < 0.05 || sz[c] < 0.05) continue;
    raster(sx[a], sy[a], sx[b], sy[b], sx[c], sy[c], W, H, (px, py, w0, w1, w2) => {
      const d = w0 * sz[a] + w1 * sz[b] + w2 * sz[c];
      const k = py * W + px; if (d < zb[k]) { zb[k] = d; tri[k] = t; bw[k * 2] = w0; bw[k * 2 + 1] = w1; }
    });
  }
  // ---- shade
  const img = Buffer.alloc(W * H * 3);
  const bias = ext / SM * 2.5;
  for (let k = 0; k < W * H; k++) {
    const t = tri[k];
    let r, g, b;
    if (t < 0) { const yy = Math.floor(k / W) / H; r = 0.16 + 0.1 * yy; g = 0.18 + 0.1 * yy; b = 0.22 + 0.08 * yy; }
    else {
      const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2], w0 = bw[k * 2], w1 = bw[k * 2 + 1], w2 = 1 - w0 - w1;
      let nx = w0 * wn[ia * 3] + w1 * wn[ib * 3] + w2 * wn[ic * 3], ny = w0 * wn[ia * 3 + 1] + w1 * wn[ib * 3 + 1] + w2 * wn[ic * 3 + 1], nz = w0 * wn[ia * 3 + 2] + w1 * wn[ib * 3 + 2] + w2 * wn[ic * 3 + 2];
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const px = w0 * wp[ia * 3] + w1 * wp[ib * 3] + w2 * wp[ic * 3], py = w0 * wp[ia * 3 + 1] + w1 * wp[ib * 3 + 1] + w2 * wp[ic * 3 + 1], pz = w0 * wp[ia * 3 + 2] + w1 * wp[ib * 3 + 2] + w2 * wp[ic * 3 + 2];
      const cv = (w0 * cav[ia] + w1 * cav[ib] + w2 * cav[ic]) / 255;
      const hair = w0 * aux[ia * 4 + 3] + w1 * aux[ib * 4 + 3] + w2 * aux[ic * 4 + 3];
      const skv = w0 * aux[ia * 4 + 2] + w1 * aux[ib * 4 + 2] + w2 * aux[ic * 4 + 2];
      const ndl = Math.max(0, nx * L.x + ny * L.y + nz * L.z);
      let sh = 0;
      if (ndl > 0) {
        const u = toS(px * U.x + py * U.y + pz * U.z), v = toT(px * V.x + py * V.y + pz * V.z), d = -(px * L.x + py * L.y + pz * L.z);
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const ui = Math.min(SM - 1, Math.max(0, Math.floor(u) + dx)), vi = Math.min(SM - 1, Math.max(0, Math.floor(v) + dy));
          n++; if (d - bias <= smz[vi * SM + ui]) sh++;
        }
        sh /= n;
      }
      const albK = A.nosky ? 1 : 0.55 + 0.45 * skv; const alb = (A.hairtint && hair > 0.5 ? [0.5, 0.42, 0.35] : [0.66, 0.62, 0.55]).map((v) => v * albK);
      const sky = (0.3 + 0.2 * ny) * Math.pow(cv, 1.4) * (A.nosky ? 1 : 0.3 + 0.7 * skv);
      const sun = Number(A.sun || 1.8) * ndl * sh;
      r = alb[0] * (sun * 1.0 + sky * 0.75 + 0.05); g = alb[1] * (sun * 0.92 + sky * 0.82 + 0.05); b = alb[2] * (sun * 0.78 + sky * 1.0 + 0.05);
    }
    const tm = (x) => Math.round(255 * Math.pow(Math.min(1, 1 - Math.exp(-x * 1.1)), 1 / 2.2));
    img[k * 3] = tm(r); img[k * 3 + 1] = tm(g); img[k * 3 + 2] = tm(b);
    if (A.normals && t >= 0) { const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2], w0 = bw[k * 2], w1 = bw[k * 2 + 1], w2 = 1 - w0 - w1; let nx = w0 * wn[ia * 3] + w1 * wn[ib * 3] + w2 * wn[ic * 3], ny = w0 * wn[ia * 3 + 1] + w1 * wn[ib * 3 + 1] + w2 * wn[ic * 3 + 1], nz = w0 * wn[ia * 3 + 2] + w1 * wn[ib * 3 + 2] + w2 * wn[ic * 3 + 2]; const vx = VM[0] * nx + VM[4] * ny + VM[8] * nz, vy = VM[1] * nx + VM[5] * ny + VM[9] * nz, vz = VM[2] * nx + VM[6] * ny + VM[10] * nz; const l = Math.hypot(vx, vy, vz) || 1; img[k * 3] = Math.round(255 * (vx / l * 0.5 + 0.5)); img[k * 3 + 1] = Math.round(255 * (vy / l * 0.5 + 0.5)); img[k * 3 + 2] = Math.round(255 * (vz / l * 0.5 + 0.5)); }
  }
  const out = path.resolve(ROOT, A.out ? (views.length > 1 ? String(A.out).replace(/\.png$/, `_${view}.png`) : A.out) : `out/ruins/headpreview_${view}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const raw = out + '.rgb';
  fs.writeFileSync(raw, img);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', raw, out]);
  fs.unlinkSync(raw);
  if (view === 'cam8' && !A.nocmp) {
    const [cx, cy, cw, ch] = String(A.crop || '900,0,772,941').split(',').map(Number);
    const cmp = out.replace(/\.png$/, '_cmp.png');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(ROOT, 'refs/ref8.png'), '-i', out, '-filter_complex', `[0]scale=1672:941,crop=${cw}:${ch}:${cx}:${cy},scale=${W}:${H}[a];[a][1]hstack`, cmp]);
  }
  console.log(`[preview] ${view} → ${path.relative(ROOT, out)} in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
}

function raster(x0, y0, x1, y1, x2, y2, W, H, fn) {
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-12) return;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  if (minX > maxX || minY > maxY) return;
  const ia = 1 / area;
  for (let py = minY; py <= maxY; py++) {
    const cy = py + 0.5;
    for (let px = minX; px <= maxX; px++) {
      const cx = px + 0.5;
      const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) * ia;
      const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) * ia;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      fn(px, py, w0, w1, w2);
    }
  }
}
