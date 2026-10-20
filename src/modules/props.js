// Module "props": banners (navy + gold trident), braziers with fire, urns / planters with flowers,
// lotus pots and lily basins, magenta bougainvillea over balustrades and walls, lamp standards.
// Adapted from athenaion/src/modules/banners.js.
//
// Consumes engine.slots.{banner, brazier, urn, planter, lamp, flowers} pushed by the architecture modules
// (conventions: src/props/READY). Regions the reference shots show but that received no slots get
// defaults derived from the layout, so the shots are dressed anyway.
//
// Sunken era: no cloth, fire or plants. Braziers and urns are toppled onto the ground (sand) — standing
// ones on high piers stay up, dulled — and coral slots are pushed on them.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { isSunken, ruined, ruinRand } from '../world/era.js';
import { BannerSet } from '../props/banner.js';
import { propMarbleMaterial, goldMaterial as propGold } from '../props/metals.js';
import { FireSystem } from '../props/fire.js';
import { BrazierSet } from '../props/brazier.js';
import { UrnSet } from '../props/urn.js';
import { LampSet } from '../props/lamp.js';
import { BougainvilleaSet } from '../props/bougainvillea.js';
import { LotusSet } from '../props/lotus.js';
import { hashString } from '../core/rng.js';
import { SHOTS } from '../world/shots.js';

const h01 = (...v) => (hashString(v.map((x) => (typeof x === 'number' ? x.toFixed(2) : String(x))).join('|')) % 100000) / 100000;
const tagOf = (s) => String(s.tag || '');

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
  const tag = tagOf(s);
  const mount = /pole/.test(tag) ? 'pole' : /pronaos|porch|free|column/.test(tag) ? 'free' : 'wall';
  // cloth never longer than ~4.6 widths (a slot sized from a tall wall would give a ribbon)
  const h = size[0] ? Math.min(size[1], size[0] * 4.6) : size[1];
  const r = h01(s.pos[0], s.pos[2], 'style');
  const style = s.style || (/stair/.test(tag) ? 'S' : h > 7.6 ? 'L' : mount === 'free' ? (r < 0.4 ? 'S' : 'V') : 'V');
  return { pos: s.pos, facing: s.facing ?? 180, width: size[0], height: h, style, mount, offset: mount === 'wall' ? 0.06 + 0.012 * (size[0] || h / 3) : 0, wallBehind: s.wallBehind ?? 0.6, hang: s.hang ?? 0.05 };
}

function brazierFromSlot(s) {
  const tag = tagOf(s);
  const stand = /tripod/.test(tag) ? 'tripod' : /ground/.test(tag) ? 'pier' : 'foot';
  const src = String(s.source || '') + ' ' + tag;
  const tone = s.tone || (/ruin/.test(src) ? 'dark' : undefined);
  return { pos: s.pos, diameter: Math.min(1.8, Math.max(0.5, s.size ?? 1.0)), stand, facing: s.facing, tone, flame: s.flame ?? 1, pierHeight: s.pierHeight, ...(s.shallow ? { shallow: s.shallow } : {}) };
}

/** what to plant in an urn slot */
const CAMS = SHOTS.map((q) => q.pos);
const nearCam = (p, d) => CAMS.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) < d);
function urnPlant(s) {
  const tag = tagOf(s);
  if (/empty|none/.test(tag)) return 'none';
  if (/lotus|lily/.test(tag)) return 'lotus';
  // bougainvillea mounds are heavy (thousands of cards): only near the shot cameras
  if (/boug/.test(tag)) return nearCam(s.pos, 140) ? 'bougainvillea' : 'flowers';
  const r = h01(s.pos[0], s.pos[2], 'plant');
  return r < 0.55 && nearCam(s.pos, 70) ? 'bougainvillea' : 'flowers';
}

export async function build(engine) {
  const t0 = performance.now();
  const sunken = isSunken(engine);
  const S = engine.slots;
  const fire = new FireSystem(engine);
  const banners = new BannerSet(engine);
  const braziers = new BrazierSet(engine, sunken ? null : fire);
  const urns = new UrnSet(engine);
  const lamps = new LampSet(engine, sunken ? null : fire);
  const boug = new BougainvilleaSet(engine);
  const lotus = new LotusSet(engine);
  const sets = { banners, braziers, urns, lamps, fire, boug, lotus };
  // shared metals (temple agent) for the bright gilt bowls, when available
  // rich deep gilt bowls (refs 3, 5): local gold with damped sky reflections (the shared polished gold mirrors the
  // bright low-sun sky and reads pale white-gold on the bowls)
  braziers.goldMat = propGold({ name: 'brazierGilt', tint: 0xc89436, rough: 0.3, wear: 0.3, envBoost: 0.62 });
  const counts = { slots: {}, defaults: {} };
  const coral = (pos, size, tag) => S.coral.push({ pos, normal: [0, 1, 0], size, tag: 'props:' + tag });
  const ground = (x, z) => { if (engine.__propsTest) return 0; const T = engine.registry.terrain; if (T && typeof T.groundAt === 'function') { try { const y = T.groundAt(x, z); if (Number.isFinite(y)) return y; } catch { /* */ } } const g = T?.sandAt || engine.registry.sandAt; const y = heightAt(x, z); if (typeof g === 'function') { try { const s = g(x, z); if (Number.isFinite(s)) return Math.max(y, s); } catch { /* */ } } return y; };

  // ---------------- banners (golden only: cloth does not survive 9000 years under the sea)
  if (!sunken) for (const s of dedupe(S.banner, 0.8)) banners.add(bannerFromSlot(s));

  // ---------------- braziers
  for (const s of dedupe(S.brazier, 0.6)) {
    const b = brazierFromSlot(s);
    if (sunken) {
      const lab = `props:brazier:${s.pos.map((v) => v.toFixed(1)).join(',')}`;
      if (ruined(lab, 0.55)) {
        // toppled off its pier / pedestal onto the ground nearby
        // toppled: onto the ground nearby when it stood low; on a tall pier / pedestal it lies on the top
        // (the architecture under it is not in the height field)
        const a = ruinRand(lab, 1) * Math.PI * 2;
        const g0 = ground(s.pos[0], s.pos[2]);
        const high = s.pos[1] - g0 > 2.6;
        const d = high ? 0.15 * b.diameter : 0.6 + 1.6 * ruinRand(lab, 2);
        const x = s.pos[0] + Math.cos(a) * d, z = s.pos[2] + Math.sin(a) * d;
        const gy = high ? s.pos[1] : ground(x, z);
        const y = high || gy > s.pos[1] - 0.2 ? s.pos[1] : gy;
        braziers.add({ ...b, pos: [x, y, z], fallen: true, tone: 'dark', fire: false });
        coral([x, y + 0.4 * b.diameter, z], b.diameter * 0.6, 'brazier');
      } else { braziers.add({ ...b, tone: 'dark', fire: false }); coral([s.pos[0], s.pos[1] + 0.5 * b.diameter, s.pos[2]], b.diameter * 0.5, 'brazier'); }
    } else braziers.add(b);
  }

  // ---------------- urns / planters
  for (const s of dedupe(S.urn, 0.5)) {
    const tag = tagOf(s);
    const kind = /marble|krater/.test(tag) ? 'krater' : /bronze|gold/.test(tag) ? 'urn' : h01(s.pos[0], s.pos[2], 'urn') < 0.22 ? 'krater' : 'urn';
    const wide = /wide|bowl|lotus/.test(tag);
    const spec = { pos: s.pos, height: Math.min(1.3, Math.max(0.5, (s.size ?? 1) * 0.72)) * (wide ? 0.85 : 1), kind, facing: s.facing, ...(wide ? { squat: 0.62, wide: 1.25, plantScale: 0.78 } : {}) };
    if (sunken) {
      const lab = `props:urn:${s.pos.map((v) => v.toFixed(1)).join(',')}`;
      if (ruined(lab, 0.6)) {
        const a = ruinRand(lab, 1) * Math.PI * 2;
        const high = s.pos[1] - ground(s.pos[0], s.pos[2]) > 2.6;
        const d = high ? 0.1 : 0.3 + 1.2 * ruinRand(lab, 2);
        const x = s.pos[0] + Math.cos(a) * d, z = s.pos[2] + Math.sin(a) * d;
        const gy = high ? s.pos[1] : ground(x, z);
        urns.add({ ...spec, pos: [x, high || gy > s.pos[1] - 0.2 ? s.pos[1] : gy, z], fallen: true, plant: 'none' });
      } else urns.add({ ...spec, plant: 'none' });
      coral(s.pos, 0.4, 'urn');
      continue;
    }
    spec.plant = urnPlant(s);
    urns.add(spec);
  }
  if (!sunken) for (const s of dedupe(S.planter, 0.5)) {
    const sz = Array.isArray(s.size) ? s.size : [s.size ?? 1.6, 0.6];
    const tag = tagOf(s);
    if (/boug/.test(tag)) {
      if (/trough/.test(tag)) urns.add({ pos: s.pos, kind: 'planter', length: sz[0], facing: s.facing ?? 0, plant: 'none' });
      const n = Math.max(1, Math.round(sz[0] / 1.2));
      const f = ((s.facing ?? 0) * Math.PI) / 180, ax = [Math.cos(f), Math.sin(f)];
      for (let i = 0; i < n; i++) {
        const off = ((i + 0.5) / n - 0.5) * sz[0];
        boug.bush({ pos: [s.pos[0] + ax[0] * off, s.pos[1] + (/trough/.test(tag) ? 0.4 : 0), s.pos[2] + ax[1] * off], radius: Math.min(sz[0] / n, sz[1]) * 0.7, height: 0.6, spill: 0.35 });
      }
    } else urns.add({ pos: s.pos, kind: /trough/.test(tag) ? 'planter' : 'bed', length: sz[0], depth: sz[1], facing: s.facing ?? 0 });
  }

  // ---------------- lamps
  let flames = 0;
  for (const s of dedupe(S.lamp, 0.3)) {
    const size = s.size ?? 3;
    if (size < 1) { if (!sunken) { fire.addFire(s.pos, Math.max(0.3, size * 1.45), h01(s.pos[0], s.pos[2], 'lf'), { layers: 2, embers: 4, spread: 0.2 }); flames++; } }
    else lamps.add({ pos: s.pos, height: size, kind: sunken ? 'finial' : /finial/.test(tagOf(s)) ? 'finial' : 'flame', ...(sunken && ruined('props:lamp:' + s.pos.join(','), 0.6) ? { fallen: true } : {}) });
  }

  // ---------------- flowers (bougainvillea curtains / bushes / climbers, lotus basins)
  if (!sunken) for (const s of dedupe(S.flowers, 0.3)) addFlowerSlot(sets, s, ground);

  counts.slots = { banner: banners.items.length, brazier: braziers.items.length, urn: urns.items.length, lampFlames: flames, lamps: lamps.items.length, boug: boug.count, lotus: lotus.count };

  // ---------------- fallbacks for regions the shots show but nobody dressed
  if (!engine.__propsTest) try { addDefaults(engine, sets, counts.defaults, { sunken, ground }); } catch (e) { console.error('[props] defaults failed:', e.stack || e); }

  // plants for the urns (lotus / bougainvillea) need the urn rims → build urns first
  const order = [['banners', banners], ['braziers', braziers], ['urns', urns], ['lamps', lamps]];
  for (const [name, set] of order) { try { set.build(); } catch (e) { console.error('[props] ' + name + ' failed:', e.stack || e); } }
  if (!sunken) for (const it of urns.items) {
    if (!it.rim) continue;
    if (it.plant === 'lotus') lotus.pot({ pos: it.rim.pos, radius: it.rim.r });
    else if (it.plant === 'bougainvillea') boug.bush({ pos: [it.rim.pos[0], it.rim.pos[1] - 0.05, it.rim.pos[2]], radius: it.rim.r * 1.15, height: it.rim.r * 1.3, spill: it.rim.r * 1.6 + 0.2 });
  }
  for (const [name, set] of [['bougainvillea', boug], ['lotus', lotus], ['fire', fire]]) { try { set.build(); } catch (e) { console.error('[props] ' + name + ' failed:', e.stack || e); } }

  const tris = Object.values(sets).reduce((a, s) => a + (s.tris || 0), 0);
  const triK = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, Math.round((v.tris || 0) / 1000)]));
  engine.registry.props = { banners: banners.items.length, braziers: braziers.items.length, tris };
  console.log(`[props] built in ${Math.round(performance.now() - t0)} ms (${engine.era}) — banners ${banners.items.length}, braziers ${braziers.items.length}, urns/planters ${urns.items.length}, lamps ${lamps.items.length}, bougainvillea ${boug.count} (${boug.cards} cards), lotus ${lotus.count}, fire quads ${fire.inst.length}, ~${(tris / 1e6).toFixed(2)} M tris ${JSON.stringify(triK)}k; slots ${JSON.stringify(counts.slots)}, defaults ${JSON.stringify(counts.defaults)}`);
}

function addFlowerSlot(sets, s, ground) {
  const tag = tagOf(s) || 'bougainvillea';
  // LOD: fewer cards far from every shot camera, none where it is sub-pixel
  const dc = CAMS.reduce((m, c) => Math.min(m, Math.hypot(c[0] - s.pos[0], c[1] - s.pos[1], c[2] - s.pos[2])), Infinity);
  if (dc > 700 && !/lotus|lily/.test(tag) && !sets.boug.engine.__propsTest) return;
  const lodD = sets.boug.engine.__propsTest || dc < 80 ? 1 : dc < 250 ? 0.45 : 0.18;
  const sz = Array.isArray(s.size) ? s.size : [s.size ?? 1.5, s.size ?? 1.2];
  if (/lotus|lily/.test(tag)) { sets.lotus.pond({ center: s.pos, radius: sz[0], cover: s.cover ?? 0.3 }); return; }
  // a scalar size without an explicit edge keyword = a bougainvillea mass growing at pos (e.g. against a balustrade)
  if (!Array.isArray(s.size) && !/curtain|edge|over|climb|column|lotus|lily/.test(tag)) {
    const k = s.size ?? 2;
    sets.boug.bush({ pos: s.pos, radius: 0.42 * k, height: 0.6 * k, spill: 0.25 * k, density: 0.85 * lodD }); return;
  }
  if (/bush|mound|pot/.test(tag)) { sets.boug.bush({ pos: s.pos, radius: sz[0], height: sz[1] ?? sz[0] * 1.1, spill: s.spill ?? 0.3, density: lodD }); return; }
  if (/climb|column/.test(tag)) { sets.boug.climb({ pos: s.pos, radius: sz[0], height: sz[1] ?? 4, side: s.facing ?? 180, coverage: s.coverage ?? 0.55, density: lodD }); return; }
  sets.boug.curtain({ top: s.pos, facing: s.facing ?? 180, length: sz[0], drop: sz[1] ?? 1.2, depth: s.depth ?? 0.45, ground, density: lodD });
}

/** default dressing where producers left a region empty */
function addDefaults(engine, sets, d, { sunken, ground }) {
  const near = (items, c, r) => items.some((it) => Math.hypot((it.pos || it.top)[0] - c[0], (it.pos || it.top)[2] - c[2]) < r);
  const fp = engine.footprints;
  const free = (x, z, r) => !fp || !fp.isFree || fp.isFree(x, z, r);
  // ---- top of the citadel stair (shots 3 / 6): braziers on the balustrade-end piers, bougainvillea pots
  const ST = L.CITADEL_STAIR, top = ST.from;
  const hw = ST.width / 2;
  if (!near(sets.braziers.items, [top[0], 0, top[2] + 4], 22)) {
    for (const sx of [-1, 1]) {
      const x = sx * (hw + 0.9), z = top[2] + 1.2;
      const gy = ground(x, z);
      if (sunken) { sets.braziers.add({ pos: [x + sx * 1.4, ground(x + sx * 1.4, z + 1.2), z + 1.2], diameter: 1.15, stand: 'pier', fallen: true, tone: 'dark', fire: false }); }
      else sets.braziers.add({ pos: [x, gy, z], diameter: 1.15, stand: 'pier', pierHeight: 1.6 });
      d.stairBraziers = (d.stairBraziers || 0) + 1;
    }
  }
  if (!sunken && !near(sets.urns.items, [top[0], 0, top[2] + 4], 22)) {
    for (const sx of [-1, 1]) for (const k of [0, 1]) {
      const x = sx * (hw + 0.9 + k * 4.5), z = top[2] - 2.5 - k * 1.5;
      if (!free(x, z, 0.5)) continue;
      sets.urns.add({ pos: [x, ground(x, z), z], height: 0.95, kind: 'urn', plant: 'bougainvillea' });
      d.stairUrns = (d.stairUrns || 0) + 1;
    }
  }
  // ---- garden terrace on land ring 2 (shot 5): brazier left, lotus pot right, framed in the shot camera.
  // The deck may sit on top of the ring wall (above the height field): use registry.sets.terrace when the sets
  // module published it, else the shot-5 eye height (2.2 m above the deck).
  const G = L.GARDEN_TERRACE;
  const cam5 = SHOTS.find((q) => q.id === 5);
  const [gx, gz] = cam5 ? [cam5.pos[0], cam5.pos[2]] : L.polar(G.r, G.bearing);
  if (cam5) {
    const T = engine.registry.sets?.terrace || {};
    const fw = [cam5.target[0] - cam5.pos[0], cam5.target[2] - cam5.pos[2]], fl = Math.hypot(fw[0], fw[1]); fw[0] /= fl; fw[1] /= fl;
    const rt = [-fw[1], fw[0]];
    const at = (f, r) => [cam5.pos[0] + fw[0] * f + rt[0] * r, cam5.pos[2] + fw[1] * f + rt[1] * r];
    const deckAt = (x, z) => { const yT = Number.isFinite(T.deckY) ? T.deckY : Number.isFinite(T.y) ? T.y : null; if (yT !== null) return yT; const g = ground(x, z); return cam5.pos[1] - g > 6 ? cam5.pos[1] - 2.2 : g; };
    if (!near(sets.braziers.items, [gx, 0, gz], 25)) {
      const [bx, bz] = at(3.4, -2.3);
      if (sunken) sets.braziers.add({ pos: [bx, deckAt(bx, bz), bz], diameter: 1.3, stand: 'pier', fallen: true, tone: 'dark', fire: false });
      else sets.braziers.add({ pos: [bx, deckAt(bx, bz), bz], diameter: 1.4, stand: 'pier', pierHeight: 0.8 });
      d.terraceBrazier = 1;
    }
    if (!sunken && !near(sets.urns.items, [gx, 0, gz], 25)) {
      const [ux, uz] = at(4.2, 2.6);
      sets.urns.add({ pos: [ux, deckAt(ux, uz), uz], height: 1.0, kind: 'urn', squat: 0.62, wide: 1.25, plant: 'lotus' });
      d.terraceLotus = 1;
    }
  }
}

// ------------------------------------------------------------------------------------- test
export async function test(engine) {
  // ?world=1: build the full world and look at the props from close-up cameras (no test ground)
  if (engine.params.get('world')) {
    const g = engine.scene.getObjectByName('testGround'); if (g) g.parent.remove(g);
    if (engine.params.get('era')) engine.era = engine.params.get('era');
    const { buildWorld } = await import('../world/index.js');
    await buildWorld(engine);
    const sun = isSunken(engine) ? { azimuth: L.SUN_SUNKEN.azimuth, elevation: L.SUN_SUNKEN.elevation } : { azimuth: L.SUN.azimuth, elevation: L.SUN.elevation };
    const [gx, gz] = L.polar(L.GARDEN_TERRACE.r + 4, L.GARDEN_TERRACE.bearing);
    const [gx2, gz2] = L.polar(L.GARDEN_TERRACE.r - 30, L.GARDEN_TERRACE.bearing - 4);
    return {
      views: [
        { pos: [26, 47.5, 128], target: [12, 46.5, 108], fov: 45, sun },        // 0 stair top east side
        { pos: [-20, 49, 96], target: [0, 52, 56], fov: 50, sun },              // 1 chariot braziers
        { pos: [10, 50, 62], target: [0, 54, 30], fov: 50, sun },               // 2 temple front (banners)
        { pos: [-60, 50, 60], target: [-90, 46, 40], fov: 50, sun },            // 3 plaza rim bougainvillea
        { pos: [-8, 26, 760], target: [0, 32, 690], fov: 50, sun },             // 4 gate bridge deck / towers
        { pos: [gx, L.ringById('l2').top + 1.7, gz], target: [gx2, L.ringById('l2').top + 2, gz2], fov: 50, sun }, // 5 garden terrace
        { pos: [-6, 4, 900], target: [0, 30, 690], fov: 44, sun },              // 6 gate bridge from the canal
      ],
    };
  }
  const marble = propMarbleMaterial();
  let stone = marble;
  try { const sm = await import('../materials/stone.js'); stone = sm.whiteStone({ weather: 0.2 }); } catch { /* fallback */ }
  const box = (w, h, dd, x, y, z, m = stone) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), m); b.position.set(x, y, z); engine.add(b); return b; };
  // a wall facing south with a cornice
  box(16, 9, 1.2, 0, 4.5, -2.6); box(16.6, 0.5, 1.6, 0, 9.2, -2.6);
  // two columns and a beam to the east
  for (const x of [9.5, 13.5]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 8, 24), stone); c.position.set(x, 4, 0); engine.add(c); }
  box(5.8, 1.1, 1.6, 11.5, 8.55, 0);
  // balustrade running east-west at z = 6 (rail top y = 1.1), with end piers
  box(14, 0.18, 0.5, -1, 1.02, 6); box(14, 0.16, 0.56, -1, 0.08, 6);
  for (let i = 0; i < 28; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.78, 10), stone); b.position.set(-7.6 + i * 0.48, 0.55, 6); engine.add(b); }
  for (const x of [-8.4, 6.4]) box(0.9, 1.5, 0.9, x, 0.75, 6);
  // basin (lily pond) to the west
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.6, 48, 1, true), stone); basin.position.set(-12, 0.3, 1); engine.add(basin);
  const water = new THREE.Mesh(new THREE.CircleGeometry(3.15, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b2a2a, roughness: 0.08, metalness: 0.0 }));
  water.position.set(-12, 0.45, 1); engine.add(water);

  // fake slots, as the architecture modules would push them
  const S = engine.slots;
  S.banner.push({ pos: [-4.5, 8.6, -1.95], facing: 180, size: [2.0, 6.6], tag: 'wall' });
  S.banner.push({ pos: [0, 8.6, -1.95], facing: 180, size: [2.0, 6.0], tag: 'wall', style: 'S' });
  S.banner.push({ pos: [4.5, 8.6, -1.95], facing: 180, size: [2.0, 8.0], tag: 'wall' });
  S.banner.push({ pos: [11.5, 7.9, 0.0], facing: 180, size: [2.2, 6.4], tag: 'columns' });
  S.banner.push({ pos: [-10, 0, 4.5], facing: 160, size: [1.1, 3.2], tag: 'pole' });
  S.brazier.push({ pos: [-8.4, 1.5, 6], size: 1.0, tag: 'pier' });
  S.brazier.push({ pos: [6.4, 1.5, 6], size: 1.1 });
  S.brazier.push({ pos: [2.5, 0, 9.0], size: 0.85, tag: 'tripod' });
  S.brazier.push({ pos: [-3.0, 0, 9.0], size: 1.3, tag: 'ground', pierHeight: 0.9 });
  S.urn.push({ pos: [-5.5, 1.11, 6], size: 0.9, tag: 'gold bougainvillea' });
  S.urn.push({ pos: [0.5, 0, 8.4], size: 1.3, tag: 'gold wide lotus' });
  S.urn.push({ pos: [4.6, 0, 8.6], size: 1.1, tag: 'gold' });
  S.urn.push({ pos: [-1.5, 0, 8.4], size: 1.1, tag: 'marble' });
  S.lamp.push({ pos: [8.0, 0, 8.0], size: 3.0 });
  S.flowers.push({ pos: [-2.8, 1.11, 6.25], facing: 180, size: [3.6, 1.0], tag: 'bougainvillea' });
  S.flowers.push({ pos: [3.5, 9.45, -1.8], facing: 180, size: [5.0, 3.5], tag: 'bougainvillea' });
  S.flowers.push({ pos: [9.5, 0, 0], facing: 200, size: [0.66, 8.0], tag: 'climb' });
  S.flowers.push({ pos: [-12, 0.45, 1], size: [3.1], tag: 'lotus' });
  S.flowers.push({ pos: [-7.0, 0, 3.0], size: [0.8, 0.9], tag: 'bush' });
  // ---- ref-5-like terrace at x = 60: checker paving, balustrade, banded column, brazier, lotus pots
  const sm = await import('../materials/stone.js');
  const checker = sm.checkerFloor({ cell: 1.1, pattern: 3 });
  const banded = sm.bandedStone({ band: 0.9, redFrac: 0.55 });
  const T5 = [60, 0, 0];
  const floor = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 12), checker); floor.position.set(T5[0], 0.0, -1); engine.add(floor);
  box(16, 0.16, 0.5, T5[0] + 1, 1.0, -4.5); box(16, 0.14, 0.56, T5[0] + 1, 0.17, -4.5);
  for (let i = 0; i < 30; i++) { if (i % 6 === 0) continue; const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.72, 10), stone); b.position.set(T5[0] - 6.8 + i * 0.5, 0.58, -4.5); engine.add(b); }
  for (let k = 0; k < 6; k++) box(0.62, 1.25, 0.62, T5[0] - 6.8 + k * 3.0, 0.62, -4.5);
  for (const [cx, cz] of [[T5[0] - 6.2, 0.6], [T5[0] - 6.4, -2.6]]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 7, 32), banded); col.position.set(cx, 3.9, cz); engine.add(col);
    box(1.4, 0.4, 1.4, cx, 0.2, cz);
  }
  S.brazier.push({ pos: [T5[0] - 4.6, 0.1, 1.4], size: 1.35, tag: 'ground', pierHeight: 0.85 });
  S.urn.push({ pos: [T5[0] - 3.8, 1.25, -4.5], size: 1.25, tag: 'gold wide lotus' });
  S.urn.push({ pos: [T5[0] + 5.2, 1.25, -4.5], size: 1.3, tag: 'gold wide lotus' });
  S.urn.push({ pos: [T5[0] - 0.8, 1.25, -4.5], size: 0.8, tag: 'gold empty' });
  S.urn.push({ pos: [T5[0] + 2.2, 1.25, -4.5], size: 0.8, tag: 'gold empty' });
  S.flowers.push({ pos: [T5[0] - 6.2, 0.4, 0.6], facing: 120, size: [0.55, 6.6], tag: 'climb', coverage: 0.5 });
  S.flowers.push({ pos: [T5[0] - 6.4, 0.4, -2.6], facing: 90, size: [0.55, 6.6], tag: 'climb', coverage: 0.6 });
  S.flowers.push({ pos: [T5[0] - 5.2, 0.1, -3.6], size: [1.0, 1.4], tag: 'bush', spill: 0 });
  S.flowers.push({ pos: [T5[0] + 7.4, 1.08, -4.3], facing: 180, size: [2.2, 0.9], tag: 'bougainvillea' });
  S.flowers.push({ pos: [T5[0] + 0.8, 1.08, -4.75], facing: 0, size: [3.0, 1.0], tag: 'bougainvillea', depth: 0.3 });
  // ---- ref-3-like stair top at x = -60: plaza, two balustrades flanking a stair, braziers on end piers
  const T3 = [-60, 4, 0];
  box(30, 3.8, 14, T3[0], 1.9, -7);
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(30, 0.2, 14), checker); plaza.position.set(T3[0], T3[1] - 0.1, -7); engine.add(plaza);
  for (let k = 0; k < 16; k++) { const st = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.18, 0.42), stone); st.position.set(T3[0], T3[1] - 0.09 - k * 0.18, 0.21 + k * 0.42); engine.add(st); const sb = new THREE.Mesh(new THREE.BoxGeometry(10.4, T3[1] - 0.18 - k * 0.18, 0.42), stone); sb.position.set(T3[0], (T3[1] - 0.18 - k * 0.18) / 2, 0.21 + k * 0.42); engine.add(sb); }
  for (const sx of [-1, 1]) {
    const x = T3[0] + sx * 5.4;
    box(0.9, 1.6, 0.9, x, T3[1] + 0.8, -0.4);                       // end pier at the top of the stair
    for (let k = 0; k < 9; k++) { const z = 0.4 + k * 0.45, y = -0.18 - k * 0.18 * 0.95; const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.7, 10), stone); b.position.set(x, T3[1] + y + 0.45, z); engine.add(b); }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 4.4), stone); rail.position.set(x, T3[1] + 0.0, 2.3); rail.rotation.x = 0.38; engine.add(rail);
    box(0.5, 1.1, 7, x + sx * 0.6, T3[1] + 0.55, -4.5);              // plaza parapet running back
    S.brazier.push({ pos: [x, T3[1] + 1.6, -0.4], size: 1.0 });
    S.urn.push({ pos: [x + sx * 0.6, T3[1] + 1.1, -3.2], size: 0.9, tag: 'gold bougainvillea' });
    S.flowers.push({ pos: [x + sx * 0.85, T3[1] + 1.1, -5.5], facing: sx > 0 ? 90 : 270, size: [4.0, 1.1], tag: 'bougainvillea' });
    S.flowers.push({ pos: [x + sx * 2.0, T3[1], -6.0], size: [1.4, 1.6], tag: 'bush' });
  }
  engine.__propsTest = true;
  await build(engine);
  const sunk = isSunken(engine);
  return {
    views: [
      { pos: [0, 3.2, 19], target: [1.0, 3.8, -1.0], fov: 50 },                         // 0 overview
      { pos: [-1.5, 2.2, 13.5], target: [-1.5, 1.2, 6.5], fov: 45 },                      // 1 balustrade + curtain
      { pos: [-0.3, 1.9, 12.5], target: [0.5, 1.0, 8.4], fov: 32 },                       // 2 lotus pot
      { pos: [-5.0, 2.5, 10.5], target: [-7.4, 1.6, 6.0], fov: 40 },                      // 3 bougainvillea urn + brazier
      { pos: [-2.6, 4.2, 4.2], target: [-4.5, 5.2, -2.0], fov: 48 },                      // 4 banner close
      { pos: [10.5, 1.8, 7.5], target: [11.5, 5.2, 0], fov: 45 },                         // 5 column banner + climber
      { pos: [-9, 3.0, 7], target: [-12, 0.4, 1], fov: 45 },                              // 6 lily pond
      { pos: [-4, 2.0, 16], target: [-1.5, 1.8, 6], fov: 40, sun: { azimuth: 340, elevation: 8 } }, // 7 backlit (sun ahead, like refs 3/5)
      { pos: [-0.5, 1.7, 13], target: [-3.0, 1.2, 9], fov: 40 },                          // 8 ground brazier fire
      { pos: [59.0, 1.75, 5.0], target: [58.5, 2.4, -10], fov: 50, sun: { azimuth: 298, elevation: 9 } },          // 9 ref-5-like terrace
      { pos: [-58.0, 3.9, 6.5], target: [-60, 5.2, -8], fov: 46, sun: { azimuth: 298, elevation: 9 } },         // 10 ref-3-like stair top
      { pos: [59, 1.6, 0.5], target: [56, 1.2, -1], fov: 42, sun: { azimuth: 298, elevation: 9 } },              // 11 ref-5 brazier close
      ...(sunk ? [{ pos: [2, 3, 15], target: [0, 0.5, 6], fov: 50 }] : []),
    ],
  };
}
