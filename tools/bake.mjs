// Bake heavy procedural geometry to generated/*.bin (see src/core/cache.js).
//   node tools/bake.mjs <name>   → imports src/bake/<name>.js, calls its bake(), writes every geometry
//                                  that went through loadOrBuild() during that call.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
if (!name) { console.log('usage: node tools/bake.mjs <name>'); process.exit(1); }
const { serializeGeometry, bakeRegistry } = await import(pathToFileURL(path.join(ROOT, 'src/core/cache.js')).href);
const mod = await import(pathToFileURL(path.join(ROOT, 'src/bake', `${name}.js`)).href);
const t0 = Date.now();
const results = await mod.bake();
fs.mkdirSync(path.join(ROOT, 'generated'), { recursive: true });
// bake() may return { name: geometry } or rely on loadOrBuild registrations
const entries = results && typeof results === 'object' ? Object.entries(results) : [];
for (const [key, geo] of bakeRegistry) {
  if (!entries.find(([k]) => k === key)) entries.push([key, geo]);
}
for (const [key, geo] of entries) {
  const buf = Buffer.from(serializeGeometry(geo));
  fs.writeFileSync(path.join(ROOT, 'generated', `${key}.bin`), buf);
  console.log(`[bake] ${key}: ${(buf.length / 1e6).toFixed(1)} MB, ${geo.attributes.position.count} verts`);
}
console.log(`[bake] done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
