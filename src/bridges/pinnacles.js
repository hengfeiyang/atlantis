// Citadel pinnacle towers (r3, director): two tall white towers on the plateau flanking the colossus behind the temple
// (refs 4 / 5: slender white towers with gold tops rising beside the temple; ref 9: their ruined tops break the sunken
// surface left and right of the standing trident). Built with the gate-tower kit (src/bridges/tower.js): a wider podium
// stage (no tholos) and a slender upper stage crowned by a tholos with a gold dome and trident finial.
// Layout: L.CITADEL_TOWERS = { size, roof, list: [{ pos: [x, z] }] }. OWNER: bridges agent (added by the director in r3).
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { ruined } from '../world/era.js';
import { gateTower } from './tower.js';

export function buildCitadelTowers(kit) {
  const C = L.CITADEL_TOWERS;
  if (!C) return [];
  const out = [];
  const surf = L.SUNKEN.surface;
  C.list.forEach((t, i) => {
    const [x, z] = t.pos;
    const size = t.size ?? C.size, roof = t.roof ?? C.roof;
    let g0 = Infinity;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) g0 = Math.min(g0, heightAt(x + dx * size * 0.75, z + dz * size * 0.75));
    const base = g0 - 0.3;
    const yMid = base + (roof - base) * 0.36;
    // face the shot cameras (south): banners and relief panels on +z
    kit.begin(x, z, 0);
    const c0 = kit.coral.length;
    const hs = size * 0.72, hu = size / 2;
    gateTower(kit, {
      x0: -hs, x1: hs, z0: -hs, z1: hs, yDeck: base, yTop: yMid, passage: null, gilt: true, banded: false, niche: true,
      bannerFaces: kit.sunken ? [] : ['+z', '-x', '+x'], seed: 31 + i * 7, tag: 'citadel-tower-podium', fallenTop: true, midFrac: 0.5,
    });
    const tw = gateTower(kit, {
      x0: -hu, x1: hu, z0: -hu, z1: hu, yDeck: yMid, yTop: roof, passage: null, gilt: false, banded: false,
      bannerFaces: kit.sunken ? [] : ['+z'], seed: 33 + i * 7, tag: 'citadel-tower', midFrac: 0.62,
      tholos: { R: size * 0.4, n: 10, colH: size * 0.42, tridentH: size * 0.36 },
      tridentBroken: kit.sunken, missingCols: kit.sunken ? (k) => ruined(`citadel-tower:${i}:col:${k}`, 0.4) : null,
    });
    // sunken: no coral above (or just under) the water line
    if (kit.sunken) kit.coral.splice(c0, kit.coral.length - c0, ...kit.coral.slice(c0).filter((c) => c.pos[1] < surf - 1.5));
    kit.footprints.push({ cx: x, cz: z, hw: hs + 1.5, hd: hs + 1.5, rotY: 0, tag: 'citadel-tower' });
    out.push({ pos: [x, base, z], roof, tip: tw.tip });
  });
  return out;
}
