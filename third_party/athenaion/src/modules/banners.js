// Module "banners": banners with the owl emblem, braziers with fire, urns/planters with purple
// flowers and lamp posts. Consumes engine.slots.{banner, brazier, urn, planter, lamp}; regions
// that received no slots from other modules get sensible defaults from the layout so the shots
// are dressed anyway.
//
// Slot conventions (producers push into engine.slots.*):
//   banner : { pos:[x,y,z] top-centre attach point (cloth hangs below it, slightly in front of
//              the wall), facing: compass deg the banner front faces, size: height m or [w, h],
//              tag: anything; contains 'pole' → free-standing vexillum (pos = ground),
//              'pronaos' | 'porch' | 'free' | 'columns' → hangs free between columns, else wall.
//              optional style: 'V' (V-point) | 'S' (straight hem, meander band) | 'L' (long, gold side
//              bands, auto for h > 7.6 m) | 'P' (loops over a rod + swags, ref 3);  optional source }
//   brazier: { pos: point the brazier stands on (top of a pier), facing, size: bowl diameter m,
//              tag: contains 'tripod' → bronze tripod, 'ground' → adds its own marble pier;
//              tone: 'dark' (old, shallow bronze; default for source/tag containing 'ruin') }
//   urn    : { pos: base point, size: ~urn height m, tag: contains 'marble' → marble krater }
//   planter: { pos: soil-top centre of an existing planter box, facing, size: [length, depth] }
//              (only plants are added; tag 'trough' → a marble trough is built too)
//   lamp   : { pos, size } size < 1 → a flame at pos (the producer built the lamp post/bowl);
//              size ≥ 1 → a full gilded lamp standard of that height standing at pos.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { BannerSet } from '../props/banner.js';
import { propMarbleMaterial } from '../props/metals.js';
import { FireSystem } from '../props/fire.js';
import { BrazierSet } from '../props/brazier.js';
import { UrnSet } from '../props/urn.js';
import { LampSet } from '../props/lamp.js';
import { hashString } from '../core/rng.js';

const h01 = (...v) => (hashString(v.map((x) => (typeof x === 'number' ? x.toFixed(2) : String(x))).join('|')) % 100000) / 100000;

/** drop slots that sit on top of each other (several producers can cover the same spot) */
function dedupe(list, minDist) {
  const out = [];
  for (const s of list || []) {
    if (!s || !Array.isArray(s.pos) || s.pos.some((v) => !Number.isFinite(v))) continue;
    if (out.some((o) => Math.hypot(o.pos[0] - s.pos[0], o.pos[1] - s.pos[1], o.pos[2] - s.pos[2]) < minDist)) continue;
    out.push(s);
  }
  return out;
}

export function bannerFromSlot(s) {
  const size = Array.isArray(s.size) ? s.size : [s.width, s.height ?? s.size ?? 6];
  const tag = String(s.tag || 'wall');
  const mount = /pole/.test(tag) ? 'pole' : /pronaos|porch|free|column/.test(tag) ? 'free' : 'wall';
  // cloth never longer than ~4.2 widths (a slot sized from a tall wall/bastion would give a ribbon)
  const h = size[0] ? Math.min(size[1], size[0] * 4.2) : size[1];
  const r = h01(s.pos[0], s.pos[2], 'style');
  const style = s.style || (/stair/.test(tag) ? 'S' : h > 7.6 ? 'L' : mount === 'free' ? (r < 0.65 ? 'S' : 'V') : r < 0.7 ? 'V' : 'S');
  // producers put pos a little in front of the wall already → keep the cloth close to it
  return { pos: s.pos, facing: s.facing ?? 180, width: size[0], height: h, style, mount, offset: mount === 'wall' ? 0.06 + 0.012 * (size[0] || h / 3) : 0, wallBehind: 0.6, hang: s.hang ?? 0.05 };
}

function brazierFromSlot(s) {
  const tag = String(s.tag || '');
  const stand = /tripod/.test(tag) ? 'tripod' : /ground/.test(tag) ? 'pier' : 'foot';
  const src = String(s.source || '') + ' ' + tag;
  const tone = s.tone || (/ruin/.test(src) ? 'dark' : undefined);
  return { pos: s.pos, diameter: Math.min(1.6, Math.max(0.6, s.size ?? 1.0)), stand, facing: s.facing, tone, flame: s.flame ?? (tone === 'dark' ? 0.8 : 1), ...(s.shallow ? { shallow: s.shallow } : {}) };
}

export async function build(engine) {
  const t0 = performance.now();
  const S = engine.slots;
  const fire = new FireSystem(engine);
  const banners = new BannerSet(engine);
  const braziers = new BrazierSet(engine, fire);
  const urns = new UrnSet(engine);
  const lamps = new LampSet(engine, fire);
  const counts = {};

  for (const s of dedupe(S.banner, 0.8)) banners.add(bannerFromSlot(s));
  for (const s of dedupe(S.brazier, 0.6)) braziers.add(brazierFromSlot(s));
  for (const s of dedupe(S.urn, 0.5)) {
    const tag = String(s.tag || '');
    const kind = /marble|krater/.test(tag) ? 'krater' : /bronze|gold/.test(tag) ? 'urn' : h01(s.pos[0], s.pos[2], 'urn') < 0.22 ? 'krater' : 'urn';
    const wide = /wide|bowl/.test(tag);
    urns.add({ pos: s.pos, height: Math.min(1.05, Math.max(0.5, (s.size ?? 1) * 0.72)) * (wide ? 0.85 : 1), kind, facing: s.facing, ...(wide ? { squat: 0.62, wide: 1.25, plantScale: 0.78 } : {}) });
  }
  for (const s of dedupe(S.planter, 0.5)) {
    const sz = Array.isArray(s.size) ? s.size : [s.size ?? 1.6, 0.6];
    urns.add({ pos: s.pos, kind: /trough/.test(String(s.tag || '')) ? 'planter' : 'bed', length: sz[0], depth: sz[1], facing: s.facing ?? 0 });
  }
  let flames = 0;
  for (const s of dedupe(S.lamp, 0.3)) {
    const size = s.size ?? 3;
    if (size < 1) { fire.addFire(s.pos, Math.max(0.3, size * 1.45), h01(s.pos[0], s.pos[2], 'lf'), { layers: 2, embers: 4, spread: 0.2 }); flames++; }
    else lamps.add({ pos: s.pos, height: size, kind: /finial/.test(String(s.tag || '')) ? 'finial' : 'flame' });
  }
  counts.slots = { banner: banners.items.length, brazier: braziers.items.length, urn: urns.items.length, lampFlames: flames, lamps: lamps.items.length };

  // ---------------- fallbacks for regions nobody dressed (keeps the reference shots furnished)
  await addDefaults(engine, { banners, braziers, urns, lamps, fire }, counts);

  // each set builds on its own: one failing never blanks the others
  for (const [name, set] of [['banners', banners], ['braziers', braziers], ['urns', urns], ['lamps', lamps], ['fire', fire]]) {
    try { set.build(); } catch (e) { console.error('[banners] ' + name + ' failed:', e.stack || e); }
  }
  const tris = (banners.tris || 0) + (braziers.tris || 0) + (urns.tris || 0) + (lamps.tris || 0);
  console.log(`[banners] built in ${Math.round(performance.now() - t0)} ms — banners ${banners.items.length}, braziers ${braziers.items.length}, urns/planters ${urns.items.length}, lamps ${lamps.items.length}, fire quads ${fire.inst.length}, ~${(tris / 1e6).toFixed(2)} M tris; slots ${JSON.stringify(counts.slots)}, defaults ${JSON.stringify(counts.defaults || {})}`);
}

/** default dressing where producers left a region empty */
async function addDefaults(engine, sets, counts) {
  const d = (counts.defaults = {});
  const near = (list, c, r) => list.some((it) => Math.hypot(it.pos[0] - c[0], it.pos[2] - c[c.length - 1]) < r);
  const fp = engine.footprints;

  // ---- main temple pronaos (ref 5): banners between the porch columns of the west front
  const T = L.TEMPLE;
  const front = [T.center[0] - T.stylobate[0] / 2, T.center[2]];
  if (!near(sets.banners.items, front, 16)) {
    const colTop = T.center[1] + 1.6 + T.columnHeight;
    const pitch = T.stylobate[1] / T.columns[0];
    const x = front[0] + pitch * 1.6; // inner (pronaos) row behind the outer colonnade
    for (let i = 1; i < T.columns[0] - 2; i++) {
      if (i === Math.floor((T.columns[0] - 2) / 2)) continue; // keep the doorway clear
      const z = T.center[2] - T.stylobate[1] / 2 + pitch * (i + 1);
      sets.banners.add({ pos: [x, colTop - 0.3, z], facing: 270, width: Math.min(2.2, pitch * 0.55), height: 6.0, style: 'S', mount: 'free', hang: 0.1 });
      d.templeBanners = (d.templeBanners || 0) + 1;
    }
  }

  // ---- ruins terrace (refs 3, 9): a banner and braziers composed in the shot cameras
  const R = L.RUINS_TERRACE;
  if (!near(sets.banners.items, R.center, R.radius + 15)) {
    try {
      const cs = await import('../ruins/camspace.js');
      // weathered stone for the piers, matching the ruins set (falls back to clean marble)
      let ruinStone = null;
      try { const rm = await import('./ruins.js'); ruinStone = rm.columnMaterial ? rm.columnMaterial() : null; } catch { /* optional */ }
      const ground = (p) => {
        const g = engine.registry.ruinsGround;
        let y = heightAt(p.x, p.z);
        if (typeof g === 'function') { try { const yy = g(p.x, p.z); if (Number.isFinite(yy)) y = Math.max(y, yy); } catch { /* ignore */ } }
        return y;
      };
      // shot 9 (ref 9): banner at the right of frame, its top above the frame and the fringe just
      // below eye level; it hangs from a tall vexillum since there is no portico entablature to use.
      const facing9 = (cs.camHeading(9) + 180 + 25) % 360;
      {
        const top = cs.atPixel(9, 1545, -60, 6.2), bot = cs.atPixel(9, 1545, 505, 6.2);
        const g = ground(bot);
        if (!fp || fp.isFree(bot.x, bot.z, 0.4)) {
          sets.banners.add({ pos: [bot.x, g, bot.z], facing: facing9, height: top.y - bot.y, width: 1.35, style: 'V', mount: 'pole', poleExtra: Math.max(-0.5, bot.y - g - 0.9) });
          fp?.addCircle(bot.x, bot.z, 0.4, 'banner-pole');
          d.ruinsBanner = 1;
        }
      }
      // a brazier on a marble pier: bowl rim placed where the reference shows it
      const brazierAt = (shot, px, py, depth, D, key) => {
        const rim = cs.atPixel(shot, px, py, depth);
        const g = ground(rim);
        const pierH = Math.min(2.6, Math.max(0.6, rim.y - 0.605 * D - g));
        if (!fp || fp.isFree(rim.x, rim.z, 0.6)) {
          sets.braziers.add({ pos: [rim.x, g, rim.z], diameter: D, stand: 'pier', pierHeight: pierH, tone: 'dark', flame: 0.8, ...(ruinStone ? { pierMaterial: ruinStone } : {}) });
          fp?.addCircle(rim.x, rim.z, 0.6, 'brazier');
          d[key] = 1;
        }
      };
      brazierAt(9, 1352, 592, 8.0, 0.9, 'ruinsBrazier9');
      brazierAt(3, 100, 522, 11.5, 0.85, 'ruinsBrazier3');
    } catch (e) {
      console.warn('[banners] ruins fallback skipped:', e.message);
    }
  }
}

// ------------------------------------------------------------------------------------- test
export async function test(engine) {
  const marble = propMarbleMaterial();
  // a weathered wall facing south
  const wall = new THREE.Mesh(new THREE.BoxGeometry(16, 9, 1.2), marble);
  wall.position.set(0, 4.5, -2.6);
  engine.add(wall);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(16.6, 0.5, 1.6), marble);
  cap.position.set(0, 9.2, -2.6); engine.add(cap);
  // two columns and a beam to the east
  for (const x of [9.5, 13.5]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 8, 20), marble);
    c.position.set(x, 4, 0); engine.add(c);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1.1, 1.6), marble);
  beam.position.set(11.5, 8.55, 0); engine.add(beam);

  const set = new BannerSet(engine);
  set.add({ pos: [-4.5, 8.6, -2.0], facing: 180, height: 6.6, style: 'V', mount: 'wall' });
  set.add({ pos: [0, 8.6, -2.0], facing: 180, height: 6.0, style: 'S', mount: 'wall' });
  set.add({ pos: [4.5, 8.6, -2.0], facing: 180, height: 7.6, style: 'L', mount: 'wall' });
  set.add({ pos: [11.5, 7.8, 0.0], facing: 180, height: 5.6, width: 2.2, style: 'S', mount: 'free', hang: 0.2 });
  set.add({ pos: [-10, 0, 1.5], facing: 160, height: 3.2, style: 'V', mount: 'pole' });
  set.build();

  // braziers: on a pier (ground), on a tripod, and a footed bowl on an existing pedestal
  const fire = new FireSystem(engine);
  const braz = new BrazierSet(engine, fire);
  const ped = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.6, 1.1), marble);
  ped.position.set(-1.5, 0.8, 4.0); engine.add(ped);
  braz.add({ pos: [-1.5, 1.6, 4.0], diameter: 1.05, stand: 'foot' });
  braz.add({ pos: [2.0, 0, 4.5], diameter: 0.9, stand: 'pier', pierHeight: 1.15 });
  braz.add({ pos: [5.5, 0, 4.0], diameter: 0.8, stand: 'tripod' });
  braz.build();

  // urns with purple flowers, a marble krater, a planter trough, lamp standards
  const urns = new UrnSet(engine);
  const ped2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), marble);
  ped2.position.set(-6.0, 0.45, 4.5); engine.add(ped2);
  urns.add({ pos: [-6.0, 0.9, 4.5], height: 0.75, kind: 'urn' });
  urns.add({ pos: [-7.8, 0, 3.6], height: 0.9, kind: 'krater' });
  urns.add({ pos: [-4.2, 0, 2.8], height: 0.7, kind: 'urn' });
  urns.add({ pos: [-6.4, 0, 1.2], kind: 'planter', length: 1.8, facing: 90 });
  urns.build();
  const lamps = new LampSet(engine, fire);
  lamps.add({ pos: [7.5, 0, 3.0], height: 3.0, kind: 'flame' });
  lamps.add({ pos: [8.6, 0, 4.6], height: 2.6, kind: 'finial' });
  lamps.build();
  fire.build();

  // metal look-dev row (only with ?metaltest=1): same urn shape, different metal settings
  if (engine.params.get('metaltest')) {
    const { urnGeometry } = await import('../props/urn.js');
    const { bronzeMaterial } = await import('../props/metals.js');
    const geo = urnGeometry(1);
    const variants = [[1.0, 0.35, 1.5], [1.0, 0.42, 2.8], [1.0, 0.42, 4.0], [0.9, 0.4, 2.8], [1.0, 0.3, 2.8], [1.0, 0.55, 2.8]];
    variants.forEach(([met, rough, env], i) => {
      const m = bronzeMaterial({ name: 'mt' + i, tint: 0xd9a95a, rough, patina: 0.2, metal: met, envBoost: env });
      const u = new THREE.Mesh(geo, m);
      u.position.set(-9 + i * 1.3, 0, 7.0); u.scale.setScalar(0.8); engine.add(u);
    });
    [0.0, 0.3, 0.6].forEach((r, i) => {
      const sp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 48, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: r }));
      sp.position.set(-7.2 + i * 1.3, 1.5, 7.4); engine.add(sp);
    });
  }

  // calibration chart (view 4): navy & gold swatches of known linear albedo on the wall
  if (engine.params.get('chart')) {
    const navy = [0.011, 0.02, 0.08], goldC = [0.58, 0.36, 0.08];
    const ks = [1.0, 0.6, 0.35, 0.2, 0.1, 0.05];
    ks.forEach((k, i) => {
      const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(navy[0] * k, navy[1] * k, navy[2] * k), roughness: 0.85 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.05), m);
      b.position.set(-7.4 + i * 0.6, 2.0, -1.97); engine.add(b);
      const g = new THREE.MeshStandardMaterial({ color: new THREE.Color(goldC[0] * k, goldC[1] * k, goldC[2] * k), roughness: 0.5, metalness: 0.0 });
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.05), g);
      b2.position.set(-7.4 + i * 0.6, 1.4, -1.97); engine.add(b2);
    });
  }

  return {
    views: [
      { pos: [0, 3.2, 17], target: [1.5, 4.8, -1.5], fov: 50 },
      { pos: [-2.6, 4.2, 4.2], target: [-4.5, 5.2, -2.0], fov: 48 },
      { pos: [9, 2.0, 5.5], target: [-1, 5.5, -2.2], fov: 45, sun: { azimuth: 250, elevation: 16 } },
      { pos: [10.5, 1.8, 7.5], target: [11.5, 5.2, 0], fov: 45 },
      { pos: [-0.2, 1.75, 7.2], target: [-1.5, 2.3, 4.0], fov: 40 },
      { pos: [3.6, 2.6, 8.2], target: [3.6, 1.2, 4.2], fov: 40 },
      { pos: [-4.4, 1.5, 7.6], target: [-6.0, 1.0, 3.6], fov: 42 },
      { pos: [6.0, 2.0, 9.0], target: [8.0, 1.8, 3.5], fov: 45 },
      { pos: [-5.75, 1.3, 11.5], target: [-5.75, 0.5, 7.0], fov: 40 },
      { pos: [-5.9, 1.9, 2.6], target: [-5.9, 1.9, -2], fov: 50, ...(engine.params.get('bloom') ? { grade: { uBloom: Number(engine.params.get('bloom')) } } : {}) },
      { pos: [10.5, 1.8, 7.5], target: [11.5, 5.2, 0], fov: 45, time: 2.7 },
    ],
  };
}
