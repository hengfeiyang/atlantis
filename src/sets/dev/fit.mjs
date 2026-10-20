import * as THREE from 'three';
const { makeFrame, shotForward } = await import('/Users/hengfeiyang/code/video-demo/src/sets/frame.js');
const { HEAD_SCALE } = await import('/Users/hengfeiyang/code/video-demo/src/sets/poseidonHead.js');
const F = makeFrame({ anchor: [0, 0, 0], px: [640, 600], depth: 11.5, fwd: new THREE.Vector3(0, 0, -1), eye: 1.8, groundY: 0, pitch: 1 });
const LM = [
  [[0.132, 0, 0.40], [657, 321], 1], [[-0.132, 0, 0.40], [530, 428], 1], [[0, -0.168, 0.545], [693, 414], 1],
  [[0, -0.29, 0.5], [730, 465], 1], [[0, -0.98, 0.27], [990, 645], 0.5], [[0, 0.26, 0.5], [430, 215], 0.3], [[0, 0.17, 0.43], [525, 290], 0.8], [[0, -0.5, 0.42], [800, 530], 0.6],
];
function mat(p) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p[0], p[1], p[2], 'YXZ'));
  const t = F.at(p[3], p[4], p[5]);
  return new THREE.Matrix4().compose(t, q, new THREE.Vector3(HEAD_SCALE, HEAD_SCALE, HEAD_SCALE));
}
function cost(p) {
  const M = mat(p); let e = 0;
  for (const [l, px, w] of LM) { const v = new THREE.Vector3(...l).applyMatrix4(M); const [x, y, dd] = F.toPixel(v); if (dd < 0.5) return 1e9; e += w * ((x - px[0]) ** 2 + (y - px[1]) ** 2); }
  // the face looks toward the camera, the crown points away
  const R = new THREE.Matrix4().extractRotation(M);
  const fz = new THREE.Vector3(0, 0, 1).applyMatrix4(R), fy = new THREE.Vector3(0, 1, 0).applyMatrix4(R);
  const cf = fz.clone().transformDirection(F.cam.matrixWorldInverse), cu = fy.clone().transformDirection(F.cam.matrixWorldInverse);
  e += 4000 * Math.max(0, 0.55 - cf.z) ** 2 + 4000 * Math.max(0, cu.z + 0.05) ** 2;
  return e;
}
function nm(f, x0, step, iters = 4000) {
  const n = x0.length; let S = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step[i]; S.push(x); }
  let V = S.map(f);
  for (let it = 0; it < iters; it++) {
    const o = V.map((v, i) => i).sort((a, b) => V[a] - V[b]); S = o.map((i) => S[i]); V = o.map((i) => V[i]);
    const c = new Array(n).fill(0); for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) c[k] += S[i][k] / n;
    const xr = c.map((v, k) => v + (v - S[n][k])); const fr = f(xr);
    if (fr < V[0]) { const xe = c.map((v, k) => v + 2 * (v - S[n][k])); const fe = f(xe); if (fe < fr) { S[n] = xe; V[n] = fe; } else { S[n] = xr; V[n] = fr; } }
    else if (fr < V[n - 1]) { S[n] = xr; V[n] = fr; }
    else { const xc = c.map((v, k) => v + 0.5 * (S[n][k] - v)); const fc = f(xc); if (fc < V[n]) { S[n] = xc; V[n] = fc; } else { for (let i = 1; i <= n; i++) { S[i] = S[i].map((v, k) => S[0][k] + 0.5 * (v - S[0][k])); V[i] = f(S[i]); } } }
  }
  return [S[0], V[0]];
}
let best = null;
for (let a = 0; a < 24; a++) {
  const x0 = [Math.random() * 6.28, (Math.random() - 0.5) * 3, Math.random() * 6.28, 600, 380, 11.5 + (Math.random() - 0.5) * 4];
  const r = nm(cost, x0, [0.5, 0.5, 0.5, 50, 50, 2]);
  if (!best || r[1] < best[1]) best = r;
}
const [p, c] = best;
console.log('rms px', Math.sqrt(c / LM.reduce((s, l) => s + l[2], 0)).toFixed(1), JSON.stringify(p.map((v) => +v.toFixed(4))));
const M = mat(p);
for (const [l, px] of LM) { const v = new THREE.Vector3(...l).applyMatrix4(M); console.log(l, px, F.toPixel(v).map((v) => v.toFixed(0)), 'h', v.y.toFixed(2)); }
// head local up of world
const inv = new THREE.Matrix3().setFromMatrix4(M).invert();
const up = new THREE.Vector3(0, 1, 0).applyMatrix3(inv).normalize();
console.log('localUp', up.toArray().map((v) => +v.toFixed(3)));
// lowest point estimates: neck, back of head
for (const l of [[0, -0.5, -0.2], [0.4, 0, -0.1], [-0.4, 0, -0.1], [0, 0.4, -0.3], [0, -0.7, 0.3], [-0.3, -0.5, 0.2], [0.3,-0.5,0.2]]) console.log(l, new THREE.Vector3(...l).applyMatrix4(M).y.toFixed(2));
{ const R = new THREE.Matrix4().extractRotation(M); for (const [n,v] of [['face',[0,0,1]],['crown',[0,1,0]],['left',[1,0,0]]]) console.log(n, new THREE.Vector3(...v).applyMatrix4(R).transformDirection(F.cam.matrixWorldInverse).toArray().map(x=>x.toFixed(2))); }
console.log('cam', F.pos.toArray().map(v=>v.toFixed(2)));
