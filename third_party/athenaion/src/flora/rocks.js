// Foreground rock clusters (limestone boulders / slabs with lichen and moss) built with the shared
// stone family (src/materials/stone.js: createRock + rockMaterial). Rocks of a cluster are merged
// into one mesh. Falls back to a simple displaced icosphere + local material if stone.js is missing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { proceduralMaterial } from '../core/materials.js';

const V = THREE.Vector3;
let stoneMod = null;
async function stone() {
  if (stoneMod !== null) return stoneMod;
  try { stoneMod = await import('../materials/stone.js'); } catch (e) { stoneMod = false; }
  return stoneMod;
}

const MATS = new Map();
export async function rockMat(kind = 'dry') {
  if (MATS.has(kind)) return MATS.get(kind);
  const S = await stone();
  let m;
  if (S && S.limestoneMaterial && kind === 'dressed') {
    // ruin blocks (ref 3 foreground): cut, weathered limestone — pale, lichen-speckled, chipped
    m = S.limestoneMaterial({ tint: 0xf3ece0, lichen: 1.8, moss: 0.45, streaks: 0.4, ochre: 0.45, bump: 2.2, variation: 0.35, scale: 2.6 });
  } else if (S && S.rockMaterial) {
    m = kind === 'wet'
      ? S.rockMaterial({ tint: 0xe8e0d4, moss: 0.5, lichen: 0.7, streaks: 0.3, strata: 0.3, ochre: 0.35, wetBelow: 1.2, bump: 1.35, variation: 0.3, darkness: 0.08, scale: 1.5 })
      : S.rockMaterial({ tint: 0xf8ecd8, moss: 0.4, lichen: 1.7, streaks: 0.4, strata: 0.5, ochre: 0.6, bump: 1.8, variation: 0.3, darkness: 0.05, scale: 2.4 });
  } else {
    m = proceduralMaterial({
      name: 'floraRockFallback', params: { color: 0xffffff, roughness: 0.9 },
      color: `float n = cgFbm3(cgP * 0.8, 4); float s = smoothstep(0.4, 0.7, cgSnoise(cgP * 9.0));
        vec3 c = mix(vec3(0.52, 0.49, 0.42), vec3(0.62, 0.58, 0.50), n * 0.5 + 0.5);
        c = mix(c, vec3(0.1), s * 0.6); c = mix(c, vec3(0.08, 0.1, 0.03), smoothstep(0.5, 0.9, cgN.y) * 0.4);
        diffuseColor.rgb = c;`,
    });
  }
  m.name = 'floraRock-' + kind;
  MATS.set(kind, m);
  return m;
}

function fallbackRock(rng, size) {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const p = g.attributes.position;
  const ph = [rng.range(0, 9), rng.range(0, 9), rng.range(0, 9)];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.18 * Math.sin(x * 3 + ph[0]) * Math.cos(z * 2.7 + ph[1]) + 0.08 * Math.sin(y * 7 + ph[2]);
    p.setXYZ(i, x * n * size[0] * 0.5, Math.max(y, -0.6) * n * size[1] * 0.5, z * n * size[2] * 0.5);
  }
  g.computeVertexNormals();
  g.setAttribute('aCavity', new THREE.BufferAttribute(new Float32Array(p.count), 1));
  return g;
}

/**
 * Cluster of rocks around `center` (world), sitting on ground(x,z).
 * o: { rng, center: Vector3, count, size:[min,max] (m), spread:[x,y,z] (m, local frame), right, fwd (unit vectors),
 *      ground(x,z) -> y, shape: 'boulder'|'slab'|'block'|'mass', detail, sink (fraction of height buried) }
 * returns { mesh, rocks: [{pos, size, top}] }
 */
export async function rockCluster(o) {
  const S = await stone();
  const { rng } = o;
  const geos = [];
  const rocks = [];
  const right = o.right || new V(1, 0, 0), fwd = o.fwd || new V(0, 0, -1);
  const detail = o.detail ?? 5;
  let maxBase = 0;
  for (let i = 0; i < o.count; i++) {
    const s = rng.range(o.size[0], o.size[1]) * (i === 0 ? 1.25 : 1);
    let pos, tries = 0;
    do {
      const lx = rng.gauss(0, o.spread[0] * 0.4), lz = rng.gauss(0, o.spread[2] * 0.4);
      pos = o.center.clone().addScaledVector(right, lx).addScaledVector(fwd, lz);
    } while (o.accept && !o.accept(pos) && ++tries < 12);
    const gy = o.ground(pos.x, pos.z);
    const shape = o.shape || (rng.chance(0.3) ? 'mass' : 'boulder');
    // (r5) rougher, more fractured limestone (ref 1: pitted karst with deep crevices, not smooth domes)
    const make = (sz, shp, det) => (S && S.createRock
      ? S.createRock(rng, { size: sz, shape: shp, detail: det, roughness: o.rough ?? 1.9, cracks: o.cracks ?? 1.5, strata: 0.7, flatBottom: 0.12 })
      : fallbackRock(rng, sz));
    const put = (geo, x, yTop, yBottom, z, tilt) => {
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const y = yTop !== null ? yTop - bb.max.y : yBottom - bb.min.y;
      const m = new THREE.Matrix4().compose(new V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-tilt, tilt), rng.range(0, Math.PI * 2), rng.range(-tilt, tilt))), new V(1, 1, 1));
      geo.applyMatrix4(m);
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'aCavity'].includes(k)) geo.deleteAttribute(k);
      geos.push(geo);
      return { y, bb };
    };
    const size = [s * rng.range(0.9, 1.4), s * (shape === 'slab' ? rng.range(0.3, 0.5) : rng.range(0.5, 0.8)), s * rng.range(0.8, 1.2)];
    // frame-driven height: the rock top must reach a given screen height (camera far above the ground)
    const wantTop = o.topFn ? o.topFn(pos, rng) : null;
    if (wantTop !== null && wantTop > gy + size[1] * 0.75) {
      // visible cap (flat-topped slab / boulder) on a mostly hidden supporting mass
      const capH = Math.min(size[1], s * rng.range(0.4, 0.65));
      const cap = [size[0] * rng.range(1.0, 1.3), capH, size[2] * rng.range(1.0, 1.3)];
      put(make(cap, shape, Math.min(5, detail + (s > 2.6 && i < 4 ? 1 : 0))), pos.x, wantTop, null, pos.z, 0.08);
      const baseTop = wantTop - capH * 0.7;
      const baseH = baseTop - gy + 0.6;
      if (baseH > 12) maxBase = Math.max(maxBase, baseH);
      if (baseH > 0.4) {
        // a little narrower than the cap so the ledge overhangs with a shadowed crevice below
        const foot = Math.min(26, Math.max(cap[0] * 0.82, baseH * 0.35));
        const footZ = Math.min(22, Math.max(cap[2] * 0.82, baseH * 0.3));
        // the visible upper part of the support is a stack of fractured bedding blocks (jointed limestone:
        // dark joints, chipped edges, small overhangs — ref 1), the hidden lower part one coarse mass
        let y = baseTop;
        const visH = Math.min(baseH - 0.4, o.ledgeDepth ?? 8);
        // (stays under the cap: stepped, slightly recessed ledges — never wider than the cap)
        for (let k = 0; k < 3 && baseTop - y < visH - 0.6; k++) {
          const hL = Math.min(rng.range(1.8, 3.0), visH - (baseTop - y));
          const nb = cap[0] > 3.2 ? 2 : 1;
          for (let b = 0; b < nb; b++) {
            const off = (b - (nb - 1) / 2) * cap[0] * 0.42;
            const bw = cap[0] * (nb > 1 ? 0.56 : 0.85) * rng.range(0.85, 1.05) * (1 - 0.07 * k);
            const bz = cap[2] * rng.range(0.7, 0.92) * (1 - 0.06 * k);
            const c = pos.clone().addScaledVector(right, off + rng.range(-0.25, 0.25)).addScaledVector(fwd, rng.range(-0.3, 0.3));
            put(make([bw, hL * rng.range(1.05, 1.3), bz], 'block', k === 0 && i < 5 ? detail : 3), c.x, y + rng.range(-0.15, 0.1), null, c.z, 0.05);
          }
          y -= hL;
        }
        const restH = y - gy + 0.6;
        if (restH > 0.4) {
          const base = [foot * rng.range(0.9, 1.1), restH, footZ];
          put(make(base, restH > foot * 1.3 ? 'mass' : 'block', Math.max(3, detail - 1)), pos.x + rng.range(-0.3, 0.3), y, null, pos.z + rng.range(-0.3, 0.3), 0.04);
        }
      }
      rocks.push({ pos: new V(pos.x, wantTop, pos.z), size: cap, top: wantTop });
    } else {
      const sink = (o.sink ?? 0.22) * size[1];
      const r = put(make(size, shape, s > 1.5 ? detail : detail - 1), pos.x, null, gy - sink + (o.lift ? rng.range(0, o.lift) : 0), pos.z, 0.15);
      rocks.push({ pos: new V(pos.x, r.y, pos.z), size, top: r.y + r.bb.max.y });
    }
  }
  const merged = mergeGeometries(geos.map((g) => (g.index ? g : g)), false);
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, await rockMat(o.wet ? 'wet' : o.dressed ? 'dressed' : 'dry'));
  mesh.name = 'floraRocks';
  mesh.userData.maxBase = maxBase;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return { mesh, rocks };
}
