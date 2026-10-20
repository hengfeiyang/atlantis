// Balustrades: moulded plinth, vase balusters (instanced lathe), handrail with mouldings, square
// posts with caps. Runs may slope (stair parapets). Per-instance tint + tiny tilt; a few missing
// or broken balusters for age.
import * as THREE from 'three';
import { chamferBox, sweepStraight, latheGeo, FACES, Frame } from './geo.js';
import { blockColor, STONE_COL } from './masonry.js';

const BAL_H = 0.70;
// classic double-bellied vase baluster profile [r, y] (y 0..1 → scaled to BAL_H)
const BAL_PROFILE = [
  [0.0, 0.0], [0.085, 0.0], [0.085, 0.06], [0.062, 0.1], [0.07, 0.17], [0.092, 0.33], [0.075, 0.47],
  [0.045, 0.58], [0.036, 0.67], [0.052, 0.71], [0.04, 0.76], [0.06, 0.89], [0.08, 0.93], [0.08, 1.0], [0.0, 1.0],
];

export class Balustrades {
  constructor(engine, rng) {
    this.engine = engine; this.rng = rng;
    this.inst = []; // [matrix, color]
  }
  /**
   * F: frame at the run start (ax along the run, az outward); s0..s1 along; y(s) = base height of the plinth
   * opts: { spacing, postEvery, slope (dy/ds), plinthH, postW, broken }
   */
  addRun(S, mat, F, s0, s1, yBase, opts = {}) {
    const rng = this.rng;
    const slope = opts.slope || 0;
    const spacing = opts.spacing || 0.29;
    const postEvery = opts.postEvery || 3.2;
    const plinthH = opts.plinthH ?? 0.24;
    const railH = 0.15;
    const postW = opts.postW || 0.42;
    const len = s1 - s0;
    if (len < 0.8) return;
    const y = (s) => yBase + slope * (s - s0);
    const cx = F.o[0] + F.ax[0] * (s0 + s1) / 2, cz = F.o[2] + F.ax[2] * (s0 + s1) / 2;
    const B = S.get(mat, cx, cz);
    const col = STONE_COL;
    const cosA = 1 / Math.sqrt(1 + slope * slope);
    // posts positions
    const nPosts = Math.max(1, Math.round(len / postEvery));
    const posts = [];
    for (let i = 0; i <= nPosts; i++) posts.push(s0 + (len * i) / nPosts);
    const topRail = plinthH + BAL_H / cosA * 0 + BAL_H;
    // plinth + rail as sloped sweeps between posts
    for (let i = 0; i < posts.length - 1; i++) {
      const a = posts[i] + postW / 2, b = posts[i + 1] - postW / 2;
      if (b - a < 0.05) continue;
      const c1 = blockColor(rng, col), c2 = blockColor(rng, col);
      slopedBox(B, F, a, b, y(a), y(b), 0, plinthH, -0.2, 0.2, c1);
      slopedBox(B, F, a, b, y(a) + plinthH + BAL_H, y(b) + plinthH + BAL_H, 0, railH, -0.23, 0.23, c2, true);
      // balusters
      const n = Math.max(1, Math.floor((b - a) / spacing));
      const step = (b - a) / n;
      for (let k = 0; k < n; k++) {
        const s = a + step * (k + 0.5);
        if (opts.broken && rng.random() < opts.broken) continue;
        const p = F.p(s, y(s) + plinthH, 0);
        const m = new THREE.Matrix4();
        const yaw = Math.atan2(F.ax[0], F.ax[2]) + rng.range(-0.3, 0.3);
        m.makeRotationY(yaw);
        const tilt = new THREE.Matrix4().makeRotationZ(rng.gauss(0, 0.008));
        m.multiply(tilt);
        const sc = 1 + rng.range(-0.02, 0.02);
        m.scale(new THREE.Vector3(sc, BAL_H * (1 + rng.range(-0.01, 0.01)), sc));
        m.setPosition(p[0], p[1], p[2]);
        this.inst.push([m, blockColor(rng, col)]);
      }
    }
    // posts
    for (const s of posts) {
      const yb = y(s) - 0.05, yt = y(s) + plinthH + BAL_H + railH + 0.08;
      const c = blockColor(rng, col);
      chamferBox(B, F, s - postW / 2, s + postW / 2, yb, yt, -postW / 2, postW / 2, 0.025, c);
      chamferBox(B, F, s - postW / 2 - 0.05, s + postW / 2 + 0.05, yt, yt + 0.09, -postW / 2 - 0.05, postW / 2 + 0.05, 0.02, c);
      chamferBox(B, F, s - postW / 2 + 0.03, s + postW / 2 - 0.03, yt + 0.09, yt + 0.15, -postW / 2 + 0.03, postW / 2 - 0.03, 0.02, c);
    }
    return { posts, top: (s) => y(s) + plinthH + BAL_H + railH };
  }

  build() {
    if (!this.inst.length) return null;
    const g = latheGeo(BAL_PROFILE.map(([r, y]) => [r, y]), this.engine.quality.detail >= 1 ? 7 : 6);
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    // radius in the profile is in metres; height normalised → scale y by BAL_H in the matrix only
    const mat = this.material;
    const im = new THREE.InstancedMesh(g, mat, this.inst.length);
    const c = new THREE.Color();
    this.inst.forEach(([m, col], i) => { im.setMatrixAt(i, m); im.setColorAt(i, c.setRGB(col[0], col[1], col[2])); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = 'acro:balusters';
    im.frustumCulled = false;
    return im;
  }
}

/** box whose bottom follows y0→y1 along s (sloped), thickness h, depth d0..d1 */
export function slopedBox(B, F, s0, s1, ya, yb, yOff, h, d0, d1, col, moulded = false) {
  const P = (s, y, d) => F.p(s, y, d);
  const A0 = ya + yOff, B0 = yb + yOff;
  const pts = {
    lb0: P(s0, A0, d0), lb1: P(s0, A0, d1), rb0: P(s1, B0, d0), rb1: P(s1, B0, d1),
    lt0: P(s0, A0 + h, d0), lt1: P(s0, A0 + h, d1), rt0: P(s1, B0 + h, d0), rt1: P(s1, B0 + h, d1),
  };
  const dk = [col[0] * 0.82, col[1] * 0.82, col[2] * 0.82];
  const C = F.p((s0 + s1) / 2, (A0 + B0) / 2 + h / 2, (d0 + d1) / 2);
  B.quadOut(pts.lb1, pts.rb1, pts.rt1, pts.lt1, col, C);           // front (d1)
  B.quadOut(pts.rb0, pts.lb0, pts.lt0, pts.rt0, col, C);           // back (d0)
  B.quadOut(pts.lt1, pts.rt1, pts.rt0, pts.lt0, col, C);           // top
  B.quadOut(pts.lb0, pts.rb0, pts.rb1, pts.lb1, dk, C);            // bottom
  B.quadOut(pts.lb0, pts.lb1, pts.lt1, pts.lt0, col, C);           // end s0
  B.quadOut(pts.rb1, pts.rb0, pts.rt0, pts.rt1, col, C);           // end s1
  if (moulded) {
    // small projecting lip under the rail
    const e = 0.04;
    slopedBox(B, F, s0, s1, ya, yb, yOff - 0.04, 0.04, d0 - e, d1 + e, dk);
  }
}
