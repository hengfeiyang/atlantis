// Small grass tufts growing in paving joints, cracks and soil pockets (refs 8, 9): instanced clumps of
// tapered, bent blades. Cheap (one InstancedMesh per set) and owned by the ruins module.
import * as THREE from 'three';
import { proceduralMaterial, cached } from '../core/materials.js';

let TUFT = null;
/** a clump of `n` blades (height 1, radius ≈ 0.35), attribute `gh` = height along the blade 0..1 */
function tuftGeometry(n = 11) {
  if (TUFT) return TUFT;
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pos = [], gh = [], idx = [];
  for (let b = 0; b < n; b++) {
    const a = rnd() * Math.PI * 2, lean = 0.15 + rnd() * 0.55, h = 0.55 + rnd() * 0.45, w = 0.022 + rnd() * 0.02;
    const r0 = rnd() * 0.12;
    const ox = Math.cos(a) * r0, oz = Math.sin(a) * r0;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx; // lean direction and blade width axis
    const segs = 4, base = pos.length / 3;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const y = h * t * (1 - 0.25 * lean * t);
      const out = lean * h * t * t * 0.9;
      const ww = w * (1 - t * 0.92);
      const cx = ox + dx * out, cz = oz + dz * out;
      pos.push(cx - px * ww, y, cz - pz * ww, cx + px * ww, y, cz + pz * ww);
      gh.push(t * h, t * h);
      if (k < segs) { const i = base + k * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('gh', new THREE.Float32BufferAttribute(gh, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // blades read as lit from above: bend the normals up
  const nr = g.attributes.normal;
  for (let i = 0; i < nr.count; i++) { const v = new THREE.Vector3(nr.getX(i), nr.getY(i) + 1.4, nr.getZ(i)).normalize(); nr.setXYZ(i, v.x, v.y, v.z); }
  TUFT = g;
  return g;
}

export function grassMaterial() {
  return cached('ruinsJointGrass', () => {
    const m = proceduralMaterial({
      name: 'ruinsJointGrass',
      params: { color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide },
      vertexHead: 'attribute float gh; varying float vGh;',
      vertexPre: 'vGh = gh;',
      head: 'varying float vGh;',
      color: `
        float n = cgVnoise2(cgP.xz * 1.7), m = cgVnoise2(cgP.xz * 9.0 + 3.0);
        vec3 green = mix(vec3(0.045, 0.065, 0.018), vec3(0.11, 0.12, 0.035), m);
        vec3 dry = mix(vec3(0.20, 0.16, 0.07), vec3(0.34, 0.28, 0.13), m);
        vec3 c = mix(green, dry, smoothstep(0.35, 0.8, n) * 0.85);
        c *= mix(0.35, 1.0, smoothstep(0.0, 0.35, vGh));          // dark at the base of the clump
        c = mix(c, dry * 1.1, smoothstep(0.55, 1.0, vGh) * 0.4);   // sun-bleached tips
        diffuseColor.rgb = c;`,
      ao: 'cgAO = mix(0.35, 1.0, smoothstep(0.0, 0.4, vGh));',
    });
    return m;
  });
}

/**
 * joints: [{ p: Vector3 (world, soil level), t: Vector3 (joint direction, unit), len, patch, crack }]
 * opts: { density (tufts per metre of joint), size [min, max] (m), seed }
 */
export function jointGrass(joints, { density = 2.2, size = [0.06, 0.2], seed = 'grass', ground } = {}) {
  let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const mats = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  for (const j of joints) {
    // patchy: clumps along the joints with long bare stretches
    const n = Math.round(j.len * density * (j.patch ? 3.5 : j.crack ? 0.6 : 1) * (0.3 + rnd() * 1.4));
    for (let k = 0; k < n; k++) {
      const a = (rnd() - 0.5) * j.len;
      p.copy(j.p).addScaledVector(j.t, a);
      if (j.patch) { p.x += (rnd() - 0.5) * j.len * 0.7; p.z += (rnd() - 0.5) * j.len * 0.7; }
      else { p.x += (rnd() - 0.5) * 0.03; p.z += (rnd() - 0.5) * 0.03; }
      if (ground) p.y = ground(p.x, p.z);
      const h = size[0] + (size[1] - size[0]) * Math.pow(rnd(), 1.6) * (j.patch ? 1.4 : 1);
      e.set((rnd() - 0.5) * 0.3, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.3); q.setFromEuler(e);
      const wdt = h * (0.7 + rnd() * 0.6);
      sc.set(wdt, h, wdt);
      m4.compose(p, q, sc);
      mats.push(m4.clone());
    }
  }
  const im = new THREE.InstancedMesh(tuftGeometry(), grassMaterial(), Math.max(1, mats.length));
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  im.count = mats.length;
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.name = 'ruinsJointGrass';
  im.castShadow = false;
  return im;
}
