// Module "rings": ring walls with metal cladding (citadel orichalcum, land ring 1 tin, land ring 2 bronze),
// masonry revetments and quays at the water, wall towers with gold domes / tholoi, rock-cut ship-sheds
// (ref 4), the canal tunnel through land ring 1, the canal embankments through land ring 2 (ref 2), the moles
// and lighthouses (ref 1). Both eras (sunken: collapsed bays, broken / leaning towers, coral + kelp slots).
// OWNER: rings agent.
//
// Publishes engine.registry.rings = {
//   plan                      ringPlan() (pure, also importable: src/rings/plan.js)
//   edges / walls             [{ id, ring, side, faceR, wallR, landY, wallTop, cladding, floor }]
//   towers                    [{ edge, bearing, pos:[x,y,z] (curtain face, land level), top, facing, design, state }]
//   gates                     [{ edge, kind: 'bridge'|'stair'|'abut', bearing, pos, halfWidth, wallTop, facing }]
//   sheds                     [{ edge, bearing, pos (opening centre, water level), facing (out), width, depth, length, slotPos }]
//   quays, canal, tunnel, moles, lighthouses, spouts [{pos, dir, width, flow, kind:'spout', id}], ledges
// }
// Slots: banner (towers, curtain pilasters, sheds, canal, stoas, lighthouses), brazier (canal piers, moles,
// lighthouse lanterns), lamp (shed interiors), ivy (shed rock), statue (lighthouse tops); sunken: coral, kelp.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { SHOTS } from '../world/shots.js';
import { isSunken } from '../world/era.js';
import { ringPlan } from '../rings/plan.js';
import { ChunkedBuilders } from '../rings/geo.js';
import { ringMaterials } from '../rings/materials.js';
import { buildEdge, quayRun, arcFrame, spoutLips, bastionBlock } from '../rings/wall.js';
import { buildTowers } from '../rings/towers.js';
import { buildSheds } from '../rings/sheds.js';
import { buildTunnel, buildCanal, buildMoles, portalBay } from '../rings/canal.js';

function safe(label, fn, fb = null) {
  try { return fn(); } catch (e) { console.error(`[rings] ${label} failed:`, e && (e.stack || e)); return fb; }
}

/** geometric detail by distance to the near cameras (every shot except the aerial) */
function makeLod(engine) {
  const cams = SHOTS.filter((s) => s.pos[1] < 200).map((s) => s.pos);
  const det = engine.quality.detail ?? 1;
  const r0 = 260 * (0.6 + 0.4 * det), r1 = 720;
  return (x, z) => {
    let d = 1e9;
    for (const c of cams) d = Math.min(d, Math.hypot(x - c[0], z - c[2]));
    return d < r0 ? 0 : d < r1 ? 1 : 2;
  };
}

export async function build(engine) {
  const t0 = performance.now();
  const plan = ringPlan();
  const M = await ringMaterials(engine);
  const sunken = isSunken(engine);
  if (sunken) { M.rock.userData.cgUniforms.uRkGreen.value = 0; }
  const ctx = {
    S: new ChunkedBuilders(220), engine, plan, sunken, slots: engine.slots, rng: engine.rng('rings'),
    lodAt: makeLod(engine),
    tun: { rx: plan.tunnel.clear / 2, ry: 9.4, spring: 1.6, halfWidth: plan.tunnel.halfWidth },
  };
  const stats = {};
  // ---- registry first (ships / bridges / props run after us and read it)
  const reg = engine.registry.rings = {
    plan,
    edges: plan.edges.map((e) => ({ id: e.id, ring: e.ring, side: e.side, faceR: e.faceR, wallR: e.wallR, landY: e.landY, wallTop: e.wallTop, cladding: e.cladding, floor: e.floor, curtain: e.curtain })),
    towers: plan.towers, gates: plan.gates, sheds: plan.sheds, quays: plan.quays, canal: plan.canal, tunnel: plan.tunnel, moles: plan.moles,
    lighthouses: [], spouts: [], ledges: [], bastions: plan.bastions,
  };
  reg.walls = reg.edges;

  // the water module's wall spouts on the citadel curtain (cascades pour through notches in the parapet)
  try {
    const cz = await import('../water/cascades.js');
    const ec = plan.edges.find((e) => e.id === 'citadel');
    const ws = engine.registry.water?.spouts;
    const src = ws && ws.length ? ws.map((s) => ({ bearing: s.bearing, width: s.width, from: s.pos })) : cz.planCascades().filter((s) => s.kind === 'spout').map((s) => ({ bearing: s.bearing ?? s.dir, width: s.width, from: s.from }));
    ec.spouts = src.map((s) => ({ bearing: s.bearing ?? L.bearingOf(s.from[0], s.from[2]), width: s.width, y: s.from[1], out: Math.hypot(s.from[0], s.from[2]) - ec.wallR }));
    console.log(`[rings] citadel spout notches: ${ec.spouts.length}`);
  } catch (e) { console.warn('[rings] no water cascades plan', e && e.message); }

  // ---- walls + revetments, edge by edge
  const tW = performance.now();
  let bays = 0, wallLen = 0;
  for (const e of plan.edges) {
    const r = safe('edge ' + e.id, () => buildEdge(ctx, e), { bays: 0, length: 0 });
    bays += r.bays; wallLen += r.length;
  }
  // tunnel portals replace the revetment bays of land ring 1 around 180
  for (const e of plan.edges.filter((q) => q.ring === 'l1')) safe('portal ' + e.id, () => {
    for (const st of e.stretches) {
      const n = Math.max(1, Math.round(((st.b1 - st.b0) * Math.PI / 180 * e.wallR) / 7.5));
      const db = (st.b1 - st.b0) / n;
      for (let k = 0; k < n; k++) {
        const b0 = st.b0 + k * db, b1 = b0 + db, bm = (b0 + b1) / 2;
        const [mx, mz] = L.polar(e.wallR, bm);
        if (!(Math.abs(mx) < plan.tunnel.halfWidth + 1.5 && mz > 0)) continue;
        const { F, len } = arcFrame(e.faceR, b0, b1, e.side);
        portalBay(ctx, e, b0, b1, F, len);
      }
    }
  });
  for (const e of plan.edges) for (const bs of e.bastions || []) safe('bastion', () => bastionBlock(ctx, e, bs));
  safe('spout lips', () => spoutLips(ctx, plan.edges.find((e) => e.id === 'citadel')));
  stats.wallMs = Math.round(performance.now() - tW);
  // quays near the gates
  safe('quays', () => { for (const q of plan.quays) { const e = plan.edges.find((p) => p.id === q.edge); quayRun(ctx, e, q.b0, q.b1, q.y, q.width); } });
  // ---- ship-sheds, tunnel, canal, moles
  const tS = performance.now();
  const sh = safe('sheds', () => buildSheds(ctx), { count: 0, ledges: [] });
  reg.ledges = sh.ledges;
  stats.shedMs = Math.round(performance.now() - tS);
  const tun = safe('tunnel', () => buildTunnel(ctx));
  const canal = safe('canal', () => buildCanal(ctx), { spouts: [] });
  reg.spouts = canal.spouts || [];
  (engine.registry.spouts ||= []).push(...reg.spouts);
  const moles = safe('moles', () => buildMoles(ctx, M), { lighthouses: [] });
  reg.lighthouses = moles.lighthouses;

  // ---- meshes
  const group = new THREE.Group(); group.name = 'rings';
  for (const m of ctx.S.meshes(M)) group.add(m);
  const tT = performance.now();
  const tw = safe('towers', () => buildTowers(ctx, M), null);
  stats.towerMs = Math.round(performance.now() - tT);
  if (tw) group.add(tw.group);
  if (moles.riprap) group.add(moles.riprap);
  engine.add(group);
  // shadow casting: the shed interiors / voids / lamps don't need to cast
  group.traverse((o) => { if (o.isMesh && /interior|void|lamp/.test(o.material?.name || '')) { o.castShadow = false; o.userData.castShadow = false; } });

  // cypress rows on the shed ledges (vegetation reads registry.cypressRows; ref 4)
  if (!sunken) {
    engine.registry.cypressRows ||= [];
    const byEdge = {};
    for (const l of sh.ledges) (byEdge[l.edge] ||= []).push(l);
    for (const [eid, ls] of Object.entries(byEdge)) {
      const e = plan.edges.find((q) => q.id === eid);
      let cur = [];
      const flush = () => { if (cur.length >= 2) engine.registry.cypressRows.push({ points: cur, spacing: 9, tag: 'rings-shed-ledge' }); cur = []; };
      ls.sort((a, b) => a.bearing - b.bearing).forEach((l, i) => {
        if (i > 0 && l.bearing - ls[i - 1].bearing > 4) flush();
        if (i % 2 === 0) cur.push(L.polar(e.faceR + e.side * 6.5, l.bearing));
      });
      flush();
    }
  }
  const tris = ctx.S.tris + (tw ? tw.tris : 0);
  stats.tris = +(tris / 1e6).toFixed(2);
  stats.meshes = group.children.length;
  stats.ms = Math.round(performance.now() - t0);
  reg.stats = stats;
  console.log(`[rings] built in ${stats.ms} ms (${engine.era}): ${bays} bays / ${Math.round(wallLen)} m of wall (${stats.wallMs} ms), ${tw ? tw.count : 0} towers (${tw ? tw.kinds : 0} kinds, ${stats.towerMs} ms), ${sh.count} ship-sheds (${stats.shedMs} ms), tunnel ${tun ? 'ok' : '-'}, canal spouts ${reg.spouts.length}, ${moles.boulders || 0} boulders, ${stats.tris} M tris, ${stats.meshes} meshes`);
}

// ------------------------------------------------------------------ test scene
export async function test(engine) {
  const view = Number(engine.params.get('view') || 0);
  const p = engine.params.get('with');
  const want = (p ? p.split(',') : ['terrain', 'water']);
  for (const name of want) {
    try { const mod = await import(`./${name}.js`); await mod.build(engine); } catch (e) { console.warn(`[rings test] ${name} failed`, e && (e.message || e)); }
  }
  const g = engine.scene.getObjectByName('testGround');
  if (g && want.includes('terrain')) g.visible = false;
  await build(engine);
  void view;
  return {
    views: [
      // 0: inner water ring w1 looking along the ship-sheds of land ring 1 (ref 4 framing)
      { pos: [240, 1.8, 87], target: [253, 12, -146], fov: 42, sun: { azimuth: 292, elevation: 9 } },
      // 1: shot 4 (round-0 camera, water ring 2)
      { pos: [505, 1.8, 140], target: [455, 16, -160], fov: 42, sun: { azimuth: 292, elevation: 9 } },
      // 2: aerial over the south-east rings
      { pos: [380, 210, 760], target: [120, 0, 260], fov: 40, sun: { azimuth: 292, elevation: 12 } },
      // 3: canal from the sea mouth toward the gate bridge (shot 2 framing)
      { pos: [-8, 2.6, 905], target: [0, 18, 600], fov: 44, sun: { azimuth: 292, elevation: 9 } },
      // 4: lighthouse + mole
      { pos: [-150, 30, 1180], target: [-55, 22, 1040], fov: 40, sun: { azimuth: 292, elevation: 12 } },
      // 5: tunnel portal (south) from water ring 2
      { pos: [8, 2.5, 520], target: [0, 8, 440], fov: 46, sun: { azimuth: 292, elevation: 14 } },
      // 6: citadel wall from water ring 1
      { pos: [140, 3, 215], target: [20, 9, 232], fov: 40, sun: { azimuth: 292, elevation: 12 } },
      // 7: close-up of a curtain bay and tower (land ring 1 outer face, from w2)
      { pos: [330, 6, -350], target: [300, 22, -300], fov: 40, sun: { azimuth: 250, elevation: 20 } },
      // 8: garden bastion on the l2 inner wall (bearing 135) seen from water ring 2
      { pos: [330, 4, 330], target: [400, 18, 400], fov: 50, sun: { azimuth: 292, elevation: 12 } },
    ],
  };
}
