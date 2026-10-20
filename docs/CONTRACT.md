# Engineering contract (read before writing code)

Project: `/Users/hengfeiyang/code/video-demo` — ATLANTIS. Zero-build ES modules + three.js r186 (import map
in index.html), headless GPU rendering through `tools/render.mjs` (puppeteer + Chrome, ANGLE/Metal on an
Apple M3 Ultra, 60-core GPU, 96 GB). Read `docs/CONCEPT.md` and `docs/ART_BIBLE.md` first.

The engine core is adapted from **Athenaion** (MIT, `third_party/athenaion/` — full source of a similar
project: Greek city, terrain erosion, SDF statues, waterfalls, trees, ivy, banners, braziers...). **Study it
and reuse freely** (copy + adapt into our tree; keep a one-line `// adapted from athenaion/<path>` comment).
Never import from `third_party/` at runtime.

## Running things
- Render the full world: `node tools/render.mjs --shot 3 --quality preview` → `out/shot3.png` and
  `out/shot3_cmp.png` (reference | render). The era comes from the shot (`src/world/shots.js`);
  `--shot all`, `--quality high --spp 8` for final checks.
- Render a module alone: `node tools/render.mjs --test <module> --view <n> [--quality high] [--params era=sunken]`
  → `out/test_<module>_v<n>.png`. Your module's `test(engine)` sets up the content and returns views.
- Build only some modules: `--params "only=terrain,water,temple"` or `skip=...` (combine with `&era=sunken`).
- **Always pass a distinct `--out out/<yourname>/<what>.png`** — a dozen agents render at the same time.
- Zoom: `node tools/crop.mjs --cmp <shot> x y w h` (ref vs render, same region) or crop any image.
- Colour: `node tools/colorstats.mjs <shot>`, `node tools/satstats.mjs a.png b.png`, `node tools/sample.mjs img.png x,y,label ...`.
- Top-down map of the terrain with the camera frusta: `node tools/map.mjs [--size 2600 --cx 0 --cz 0 --out out/<you>/map.png]`.
- The page logs (console.log / errors) are printed by render.mjs — read them, fix every error/warning
  you caused. Shader compile errors print the GLSL with line numbers.
- Renders are serialised by a 4-slot GPU lock; a render may wait. Think, then render. Prefer
  `--quality preview` while iterating, `high` to verify.
- Persistent session (build the world ONCE, then render many camera / look variants in seconds):
  `node tools/session.mjs --port <unique port> [--params era=sunken] &` then
  `node tools/snap.mjs --port <p> --shot 3 [--set '{"fov":38,"pos":[..],"target":[..]}'] --out out/<you>/x.png`
  (`--reload` picks up code changes, `--quit` when done — it holds a GPU slot; auto-exits after 15 min idle).
- Interactive viewing for the user: `node tools/serve.mjs` → http://localhost:8080/?shot=3 (keys 1-9).

## Eras
- `engine.era` is `'golden'` or `'sunken'`, fixed before `build()` runs (one era per page load). Helpers in
  `src/world/era.js`: `isSunken(engine)`, `surfaceY(engine)`, `ruined(label, p)`, `ruinRand(label, k)`.
- **Every module builds both eras** from the same layout. Sunken: apply your own ruin (collapse, topple,
  crack, lean, missing pieces — deterministic via `ruined()` with stable labels), push `engine.slots.coral`
  anchor points on your surfaces (`{pos, normal, size, tag}`) for the marine module, and skip things that
  would not survive (cloth, fire, foliage, wood except wrecks).
- Materials: tag every material with `mat.userData.sunken = 'stone' | 'metal' | 'gold' | 'wood' | 'none'`.
  In the sunken era the core (src/core/sunken.js, owned by the underwater agent) injects a generic overlay
  into tagged materials: sand dust on up-facing surfaces, algae / coral crust, verdigris on metal, dulled gold,
  caustics and depth absorption. Do not implement those yourself; do tune your albedos so the overlay reads.
- Underwater medium, caustics, god rays, particles: owned by the underwater agent (core). Do NOT set
  scene.fog, do NOT add your own underwater fog.

## Module contract
Each world module lives in `src/modules/<name>.js` and exports:
```js
export async function build(engine) { ... }   // populate the FULL world for engine.era using src/world/layout.js
export async function test(engine) { ...; return { views: [{ pos, target, fov, sun? }] } } // isolated scene near the origin
```
`src/world/index.js` runs modules in MODULE_ORDER; a throw is caught and logged (the rest still builds).
Put reusable generators in their own folder (`src/arch/`, `src/sculpt/`, `src/marine/`, ...).

Engine API (src/core/engine.js): `engine.scene`, `engine.camera`, `engine.renderer`, `engine.era`,
`engine.quality` (preview/high/ultra: use `.density`, `.detail`, `.terrainRes` to scale work),
`engine.add(obj, {castShadow, receiveShadow})`, `engine.onUpdate((t, dt) => …)` for animation (time is
deterministic; never use Date/Math.random), `engine.rng(label)` seeded RNG, `engine.footprints`
(occupancy: addCircle/addRect/addPath/isFree), `engine.slots` (anchor points: banner, brazier, statue, ivy,
urn, planter, lamp, palm, flowers, coral, kelp — producers push `{pos:[x,y,z], facing:deg, size, tag}`,
consumers read), `engine.registry` (free-form shared data, e.g. `registry.temple`), `engine.onShot(fn(shot))`.

Terrain: `import { heightAt, normalAt, slopeAt, isWater, waterDepth } from '../world/heightfield.js'`.
Layout: `import * as L from '../world/layout.js'` (positions of everything, `polar(r, bearing)`,
`bearingOf(x, z)`, `zoneAt(x, z)`, `dirFromAzEl`, `headingToRotY(compassDeg)` for objects whose local front
is +Z). Compass: -Z north, +X east. Golden sea level y = 0; sunken surface y = `L.SUNKEN.surface`.

## Materials & shading
- Use `proceduralMaterial()` from `src/core/materials.js` (MeshStandard/Physical + world-space GLSL
  hooks: color / roughness / normal (cgBump) / emissive / ao; `NOISE_GLSL` functions cgSnoise,
  cgFbm3, cgVfbm2, cgVoronoi2/3, cgHash*, cgTriWeights…). Program cache keys are automatic.
- Every lit material gets atmosphere + cascaded shadows (+ the sunken overlay) injected automatically by
  `engine.prepareScene()` — do NOT call CSM yourself, do NOT set scene.fog.
- Custom ShaderMaterial: unlit by default. For atmosphere include `ATMO_GLSL` and `...atmoUniforms()` from
  core/atmosphere.js and call `atmoApply(col, worldPos)`; set `mesh.userData.noPatch = true` on meshes whose
  material you fully control.
- Shared material families live in `src/materials/<family>.js` and are OWNED by one agent (stone.js and
  metal.js: temple agent). Others import them; never edit a file you don't own — ask via your final report.
  Until `src/materials/READY` exists, use a local placeholder material and switch when it appears.
- Lighting is linear HDR; tone mapping and grading happen in post (`src/core/pipeline.js`). Do not
  pre-tone-map colours. Albedos must be realistic (white stone ≈ 0.6–0.75 linear, foliage ≈ 0.04–0.15).
- Canvas textures (banners, mosaics, leaf atlases) are fine — draw them in code, ≤ 2048².

## Performance budget (whole world, M3 Ultra)
- Instancing (InstancedMesh / BatchedMesh) or merged geometry for anything repeated. Draw calls ≤ ~6000
  total; triangles ≤ ~60 M total at `high`. Each module ≤ ~20 s build at `high` (log your time).
- Scale counts/resolution with `engine.quality.density / detail`. Distant things simpler (LOD by distance
  from the main viewpoints is fine — the cameras are known: src/world/shots.js).
- Heavy procedural geometry may be baked: `loadOrBuild(name, fn)` (src/core/cache.js) +
  `src/bake/<name>.js` + `node tools/bake.mjs <name>` → generated/*.bin. Bump the name when the generator
  changes. Runtime falls back to building if the bake is missing.

## Coordination
- Own your files (listed in your brief). Shared files (`layout.js`, `heightfield.js`, `shots.js`, `looks.js`,
  `engine.js`, `pipeline.js`, `atmosphere.js`, `sky.js`, `world/index.js`) — only the owner edits; others make
  minimal additive `Edit`s ONLY if your brief allows it (never rewrite a shared file wholesale; re-read right
  before editing). You may ADD new named constants to `layout.js` for your own features (append in a block
  marked with your module name) — never move what others rely on.
- When your reusable API is stable, create a marker file (e.g. `src/arch/READY`) so others can start
  depending on it; keep exported signatures backward-compatible afterwards.
- Never break the world build: run a full-world render (`--quality preview`) of a golden AND a sunken shot
  before finishing.
- Determinism: same code → same image.
- Deliver a SHORT final report (≤ 250 words): what you built, files, exported APIs, timings (build ms, tris),
  known gaps, and requests for other modules.
