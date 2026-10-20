// adapted from athenaion/src/bake/terrain.js
// node tools/bake.mjs terrain
//   → generated/terrain-far-<ver>.bin   (eroded far-field height grid, 16 m cells)
// The terrain mesh itself is meshed at runtime in workers (≈ 1-3 s; it depends on the director's layout /
// heightfield / shots, which change often, so a mesh bake would mostly be stale).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOrBuild } from '../core/cache.js';
import { generateFarGrid } from '../terrain/farfield.js';
import { farToGeometry, FAR_NAME } from '../terrain/far.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function bake() {
  const farFile = path.join(ROOT, 'generated', FAR_NAME + '.bin');
  if (fs.existsSync(farFile) && !process.env.FORCE) { console.log(`[bake] ${FAR_NAME} exists (FORCE=1 to rebuild)`); return {}; }
  await loadOrBuild(FAR_NAME, () => farToGeometry(generateFarGrid({ cell: 16, log: console.log })));
  // remove stale far bakes
  fs.mkdirSync(path.join(ROOT, 'generated'), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'generated'))) {
    if (f.startsWith('terrain-far-') && f !== FAR_NAME + '.bin') fs.rmSync(path.join(ROOT, 'generated', f));
  }
  return {};
}
