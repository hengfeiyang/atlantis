// Hanging ivy / caper curtains (golden era) on engine.slots.ivy (r4; producers: rings ship-shed rock 'rings-shed-rock',
// arch buildings). Ref 4: green trailing plants spill over the rock crest above the ship-sheds.
// Slot convention: pos = point on the top edge (slightly in front of the face), facing = compass bearing of the
// outward face normal, size = curtain scale (m). One merged mesh of leaf-cluster cards (leaf atlas, shrub cells)
// hanging in strands of varying length, plus a mat over the crest; shaded with the shared foliage card material.
import * as THREE from 'three';
import { GeoBuilder, v3, cellRect, clamp, smoothstep } from './util.js';
import { leafAtlas, LEAF, GRID } from './atlas.js';
import { foliageMaterials } from './foliage.js';
import { RNG } from '../core/rng.js';
import { Simplex } from '../core/noise.js';

const D2R = Math.PI / 180;

/** @returns {{mesh: THREE.Mesh|null, curtains: number, tris: number}} */
export function buildIvy(engine) {
  const slots = (engine.slots?.ivy || []).filter((s) => s && s.pos);
  if (!slots.length) return { mesh: null, curtains: 0, tris: 0 };
  // the shed-rock slots come every third shed: fill the straight runs between two neighbouring slots of the same face
  // (same tag, facing within 6°, 18-50 m apart, same crest height) with extra curtains every ≈ 13 m
  const extra = [];
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = slots[i], b = slots[j];
    if (a.tag !== b.tag) continue;
    const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]);
    let df = Math.abs(((a.facing ?? 0) - (b.facing ?? 0) + 540) % 360 - 180);
    if (d < 18 || d > 50 || df > 6 || Math.abs(a.pos[1] - b.pos[1]) > 1.5) continue;
    const n = Math.max(1, Math.round(d / 13) - 1);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      extra.push({ pos: [a.pos[0] + (b.pos[0] - a.pos[0]) * t, a.pos[1] + (b.pos[1] - a.pos[1]) * t, a.pos[2] + (b.pos[2] - a.pos[2]) * t], facing: a.facing + (((b.facing - a.facing + 540) % 360) - 180) * t, size: ((a.size || 4) + (b.size || 4)) * 0.5 * (0.75 + 0.3 * ((k * 0.618) % 1)), tag: a.tag });
    }
  }
  slots.push(...extra);
  const rng = new RNG('veg-ivy');
  const nz = new Simplex(0x1f3a);
  const gb = new GeoBuilder();
  const cells = [...LEAF.shrub, ...LEAF.broad];
  const dens = clamp(engine.quality?.density ?? 1, 0.45, 1);
  for (const sl of slots) {
    const size = clamp(sl.size || 4, 1.5, 10);
    const f = (sl.facing ?? 0) * D2R;
    const out = [Math.sin(f), 0, -Math.cos(f)], along = [Math.cos(f), 0, Math.sin(f)];
    const W = size * 1.9, drop = size * 1.25;
    const [px, py, pz] = sl.pos;
    const strands = Math.max(4, Math.round((W / 0.3) * dens));
    for (let k = 0; k < strands; k++) {
      const a = ((k + rng.range(0.1, 0.9)) / strands - 0.5) * W;
      // curtain outline: longest in the middle, ragged edge (noise), a few long trailing strands
      const edge = 1 - Math.pow(Math.abs(a) / (W * 0.5), 2.2);
      let len = drop * clamp(edge * (0.55 + 0.45 * nz.noise2(a * 0.35 + px * 0.01, pz * 0.01)) + rng.range(-0.15, 0.2), 0.12, 1.15);
      if (rng.chance(0.12)) len *= 1.35;
      const n = Math.max(2, Math.round(len / 0.26));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        const y = py + 0.35 - t * len;
        // hangs a little away from the rock, swelling over the bulges (noise), tips curl out
        const off = 0.28 + 0.35 * (0.5 + 0.5 * nz.noise2(a * 0.8 + 3, y * 0.7)) + 0.25 * t * t;
        const sway = 0.08 * nz.noise2(a * 1.7, y * 1.3 + 9);
        const o = v3.add(v3.add([px, y, pz], v3.mul(along, a + sway)), v3.mul(out, off));
        const sz = rng.range(0.5, 0.85) * (1 - 0.3 * t) * clamp(size / 5, 0.8, 1.3);
        // card faces outward (slightly up), random roll about the outward axis
        const roll = rng.range(-1.2, 1.2);
        const up = v3.norm(v3.add(v3.mul([0, -1, 0], Math.cos(roll)), v3.mul(along, Math.sin(roll))));
        const side = v3.norm(v3.cross(up, v3.norm(v3.add(out, [0, 0.35, 0]))));
        const rect = cellRect(cells[Math.floor(rng.random() * cells.length)], GRID, 0.0);
        const ao = clamp(0.55 + 0.45 * (1 - t) * edge + rng.range(-0.1, 0.1), 0.25, 1);
        const nOut = v3.norm(v3.add(out, [0, 0.45, 0]));
        const base = v3.mad(o, up, -sz * 0.5);
        addCardLocal(gb, base, up, side, sz, sz, rect, nOut, [ao, smoothstep(0.6, 1, 1 - t) * 0.4, rng.random(), 0.12 + 0.2 * t]);
      }
    }
    // mat over the crest: cards lying back over the rock top
    const mats = Math.max(3, Math.round(W / 0.7 * dens));
    for (let k = 0; k < mats; k++) {
      const a = (rng.random() - 0.5) * W * 0.95, back = rng.range(-0.3, 1.6);
      const o = v3.add(v3.add([px, py + 0.2 + rng.range(0, 0.25), pz], v3.mul(along, a)), v3.mul(out, -back));
      const sz = rng.range(0.55, 0.9);
      const up = v3.norm(v3.add(v3.add(v3.mul(out, rng.range(0.5, 1)), [0, rng.range(0.2, 0.6), 0]), v3.mul(along, rng.range(-0.4, 0.4))));
      const side = v3.norm(v3.cross(up, [0, 1, 0]));
      const rect = cellRect(cells[Math.floor(rng.random() * cells.length)], GRID, 0.0);
      addCardLocal(gb, v3.mad(o, up, -sz * 0.4), up, side, sz, sz, rect, [0, 1, 0], [0.9, 0.3, rng.random(), 0.1]);
    }
  }
  if (!gb.count) return { mesh: null, curtains: 0, tris: 0 };
  const mat = foliageMaterials('shrub', leafAtlas()).card;
  const mesh = new THREE.Mesh(gb.build(), mat);
  mesh.name = 'veg:ivy';
  return { mesh, curtains: slots.length, tris: gb.triangles };
}

function addCardLocal(gb, o, up, side, w, h, rect, n, fol) {
  const ids = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -0.5 : 0.5;
    const p = [o[0] + up[0] * h * j + side[0] * w * s, o[1] + up[1] * h * j + side[1] * w * s, o[2] + up[2] * h * j + side[2] * w * s];
    ids.push(gb.v(p[0], p[1], p[2], n[0], n[1], n[2], i === 0 ? rect[0] : rect[2], j === 0 ? rect[3] : rect[1], fol[0], fol[1], fol[2], fol[3]));
  }
  gb.quad(ids[0], ids[1], ids[3], ids[2]);
}
