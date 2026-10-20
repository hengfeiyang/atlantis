// adapted from athenaion/src/vegetation/library.js
// Variant library: builds all tree/shrub variants (geometry for 4 LODs each) and registers them
// with the VegSystem. Counts scale with engine.quality.detail.
import { buildCypress, CYPRESS_STYLES } from './cypress.js';
import { buildTree } from './trees.js';
import { cypressAtlas, leafAtlas, CYP, LEAF, GRID } from './atlas.js';
import { billboardQuad, cellRect } from './util.js';
import { foliageMaterials, barkMaterial, billboardMaterial, palmTrunkMaterial } from './foliage.js';
import { buildPalm, PALM_STYLES } from './palm.js';
import { palmAtlas, impostorAtlas, impRect } from './palmAtlas.js';

// pixel-height thresholds for LOD0 / LOD1 / LOD2 (projected tree height on a 941 px tall frame)
const PX = {
  palm: [300, 85, 16],
  cypress: [220, 100, 18],
  olive: [90, 32, 9],
  broad: [100, 40, 10],
  pine: [100, 40, 10],
  shrub: [36, 14, 6],
  thicket: [50, 18, 6],
};

export function buildLibrary(sys, engine) {
  const t0 = performance.now();
  const q = engine.quality;
  const cypTex = cypressAtlas();
  const leafTex = leafAtlas();
  const cypMat = foliageMaterials('cypress', cypTex);
  const lib = { palm: [], cypress: [], olive: [], broad: [], pine: [], shrub: [], thicket: [], palmHero: null };
  let tris0 = 0;
  const nCyp = q.detail >= 1 ? 8 : 6;
  for (let i = 0; i < nCyp; i++) {
    const style = CYPRESS_STYLES[i % CYPRESS_STYLES.length];
    const t = buildCypress(1000 + i * 17, style);
    // far LOD: camera-facing impostor (2 triangles)
    // (r5) a fuller flame: at 8-18 px the procedural silhouette read as thin poles ("matchsticks")
    t.lods[3] = { bb: billboardQuad(t.H, t.R * 1.42, cellRect(CYP.patch[i % 2], GRID, 0.1)), tris: 2 };
    tris0 = Math.max(tris0, t.lods[0].tris);
    lib.cypress.push(sys.addVariant({
      name: `cypress-${style}-${i}`, kind: 'cypress', style, lods: t.lods, H: t.H, R: t.R, px: PX.cypress, cullPx: 0.7, shadowLod: 2,
      materials: { blob: cypMat.blob, card: cypMat.card, bark: cypMat.blob, bb: billboardMaterial('cypress', cypTex) },
    }));
  }
  const counts = { olive: q.detail >= 1 ? 5 : 3, broad: q.detail >= 1 ? 5 : 3, pine: q.detail >= 1 ? 4 : 3, shrub: q.detail >= 1 ? 6 : 4, thicket: q.detail >= 1 ? 4 : 3 };
  for (const sp of ['olive', 'broad', 'pine', 'shrub', 'thicket']) {
    const fm = foliageMaterials(sp === 'thicket' ? 'shrub' : sp, leafTex);
    const bm = barkMaterial(sp === 'thicket' ? 'shrub' : sp);
    for (let i = 0; i < counts[sp]; i++) {
      const t = buildTree(sp, 200 + i * 31);
      const patchCell = { olive: LEAF.olivePatch, broad: LEAF.broadPatch, pine: LEAF.pinePatch, shrub: LEAF.shrubPatch, thicket: LEAF.shrubPatch }[sp];
      t.lods[3] = { bb: billboardQuad(t.H, t.R * (sp === 'pine' ? 1.0 : 0.95), cellRect(patchCell, GRID, 0.1)), tris: 2 };
      lib[sp].push(sys.addVariant({
        name: `${sp}-${i}`, kind: sp, lods: t.lods, H: t.H, R: t.R, px: PX[sp], cullPx: sp === 'shrub' ? 1.2 : 0.8,
        shadowLod: sp === 'shrub' || sp === 'thicket' ? 1 : 2,
        materials: { blob: fm.blob, card: fm.card, bark: bm, bb: billboardMaterial(sp, leafTex) },
      }));
    }
  }
  // ---- date palms (hero): LOD0-2 geometry + a painted side-view impostor per variant
  const tp = performance.now();
  const palmTex = palmAtlas();
  const palmMat = foliageMaterials('palm', palmTex);
  const nPalm = q.detail >= 1 ? 12 : 8;
  const palms = [];
  for (let i = 0; i < nPalm; i++) palms.push(buildPalm(500 + i * 13, PALM_STYLES[i % PALM_STYLES.length]));
  const imps = palms.map((t) => { const Hb = Math.max(t.H * 1.03, 4 * t.R); return { ...t.skel, Hb, Rb: Hb / 4 }; });
  const impTex = impostorAtlas(imps);
  const bbMat = billboardMaterial('palm', impTex);
  let palmTris = 0;
  palms.forEach((t, i) => {
    t.lods[3] = { bb: billboardQuad(imps[i].Hb, imps[i].Rb, impRect(i)), tris: 2 };
    palmTris = Math.max(palmTris, t.lods[0].tris);
    lib.palm.push(sys.addVariant({
      name: `palm-${t.style}-${i}`, kind: 'palm', style: t.style, lods: t.lods, H: t.H, R: t.R, Ht: t.Ht, px: PX.palm, cullPx: 0.7, shadowLod: 2, cardShadowLod: 2,
      materials: { blob: palmMat.blob, card: palmMat.card, bark: palmTrunkMaterial(), bb: bbMat },
    }));
  });
  // r4: shot-5 hero palm (fronds framing the top-right corner of ref 5): broad, dense leaflets
  {
    const t = buildPalm(500 + 4 * 13, 'garden', { leafW: 2.0, leafN: 1.4 });
    const Hb = Math.max(t.H * 1.03, 4 * t.R);
    t.lods[3] = { bb: billboardQuad(Hb, Hb / 4, impRect(4)), tris: 2 };
    lib.palmHero = sys.addVariant({
      name: 'palm-hero', kind: 'palm', style: 'garden', lods: t.lods, H: t.H, R: t.R, Ht: t.Ht, px: PX.palm, cullPx: 0.7, shadowLod: 2, cardShadowLod: 2,
      materials: { blob: palmMat.blob, card: palmMat.card, bark: palmTrunkMaterial(), bb: bbMat },
    });
  }
  console.log(`[vegetation] palms ×${nPalm} in ${Math.round(performance.now() - tp)} ms (hero palm ${palmTris} tris, LOD1 ${palms[0].lods[1].tris}, LOD2 ${palms[0].lods[2].tris})`);
  const ms = Math.round(performance.now() - t0);
  console.log(`[vegetation] library: ${Object.entries(lib).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k}×${v.length}`).join(' ')} in ${ms} ms (hero cypress ${tris0} tris)`);
  return lib;
}
