// Variant library: builds all tree/shrub variants (geometry for 4 LODs each) and registers them
// with the VegSystem. Counts scale with engine.quality.detail.
import { buildCypress, CYPRESS_STYLES } from './cypress.js';
import { buildTree } from './trees.js';
import { cypressAtlas, leafAtlas, CYP, LEAF, GRID } from './atlas.js';
import { billboardQuad, cellRect } from './util.js';
import { foliageMaterials, barkMaterial, billboardMaterial } from '../materials/foliage.js';

// pixel-height thresholds for LOD0 / LOD1 / LOD2 (projected tree height on a 941 px tall frame)
const PX = {
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
  const lib = { cypress: [], olive: [], broad: [], pine: [], shrub: [], thicket: [] };
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
  const ms = Math.round(performance.now() - t0);
  console.log(`[vegetation] library: ${Object.entries(lib).map(([k, v]) => `${k}×${v.length}`).join(' ')} in ${ms} ms (hero cypress ${tris0} tris)`);
  return lib;
}
