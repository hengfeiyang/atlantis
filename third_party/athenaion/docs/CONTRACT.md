# Engineering contract (read before writing code)

Project: `D:\claudegreece` — zero-build ES modules + three.js r186 (import map in index.html),
headless GPU rendering through `tools/render.mjs`. Integrated GPU (Radeon 780M): be frugal.

## Running things
- Render the full world: `node tools/render.mjs --shot 3 --quality preview` → `out/shot3.png` and
  `out/shot3_cmp.png` (reference | render). `--shot all`, `--quality high --spp 8` for final checks.
- Render a module alone: `node tools/render.mjs --test <module> --view <n> [--quality high]`
  → `out/test_<module>_v<n>.png`. Your module's `test(engine)` sets up the content and returns views.
- Build only some modules in the full world: `--params "only=terrain,water,temple"` or `skip=...`.
- Always pass a distinct `--out out/<yourname>_<what>.png` when several agents work at once.
- Zoom: `node tools/crop.mjs --cmp <shot> x y w h` (ref vs render, same region) or crop any image.
- Colour: `node tools/colorstats.mjs <shot>` (also `node tools/satstats.mjs a.png b.png` for saturation/colourfulness/warmth) and `node tools/sample.mjs img.png x,y,label ...`.
- The page logs (console.log / errors) are printed by render.mjs — read them, fix every error/warning
  you caused. Shader compile errors print the GLSL with line numbers.
- Renders are serialised by a 4-slot GPU lock; a render may wait. Don't spam renders: think, then
  render. Prefer `--quality preview` while iterating, `high` to verify.
- Interactive viewing for the user: `node tools/serve.mjs` → http://localhost:8080/?shot=3
- Persistent session (build the world ONCE, then render many camera/look variants in ~5 s each):
  `node tools/session.mjs --port <unique port> &` then
  `node tools/snap.mjs --port <p> --shot 3 [--set '{"fov":38,"pos":[..],"target":[..],"grade":{..}}'] --out out/<you>/x.png`
  (`--reload` picks up code changes, `--quit` when done — it holds a GPU slot; auto-exits after 15 min idle).

## Module contract
Each world module lives in `src/modules/<name>.js` and exports:
```js
export async function build(engine) { ... }   // populate the FULL world using src/world/layout.js
export async function test(engine) { ...; return { views: [{ pos, target, fov, sun? }] } } // isolated scene near the origin
```
`src/world/index.js` runs modules in MODULE_ORDER; a throw is caught and logged (the rest still builds).
Put reusable generators in their own folder (`src/arch/`, `src/sculpt/`, `src/vegetation/`, ...).

Engine API (src/core/engine.js): `engine.scene`, `engine.camera`, `engine.renderer`,
`engine.quality` (preview/high/ultra: use `.density`, `.detail`, `.terrainRes` to scale work),
`engine.add(obj, {castShadow, receiveShadow})`, `engine.onUpdate((t, dt) => …)` for animation (time is
deterministic; never use Date/Math.random), `engine.rng(label)` seeded RNG, `engine.footprints`
(occupancy: addCircle/addRect/addPath/isFree), `engine.slots` (anchor points: banner, brazier,
statue, ivy, urn, planter, lamp — producers push `{pos:[x,y,z], facing:deg, size, tag}`, consumers read),
`engine.registry` (free-form shared data, e.g. `registry.temple`), `engine.onShot(fn(shot))`.

Terrain: `import { heightAt, normalAt, slopeAt, waterSDF, isWater } from '../world/heightfield.js'`.
Layout: `import * as L from '../world/layout.js'` (positions of everything, `dirFromAzEl`,
`headingToRotY(compassDeg)` for objects whose local front is +Z). Compass: -Z north, +X east.

## Materials & shading
- Use `proceduralMaterial()` from `src/core/materials.js` (MeshStandard/Physical + world-space GLSL
  hooks: color / roughness / normal (cgBump) / emissive / ao; `NOISE_GLSL` functions cgSnoise,
  cgFbm3, cgVfbm2, cgVoronoi2/3, cgHash*, cgTriWeights…). Program cache keys are automatic.
- Every lit material gets atmosphere + cascaded shadows injected automatically by
  `engine.prepareScene()` — do NOT call CSM yourself, do NOT set scene.fog.
- Custom ShaderMaterial: unlit by default. For atmosphere include `ATMO_GLSL` and
  `...atmoUniforms()` from core/atmosphere.js and call `atmoApply(col, worldPos)`; set
  `mesh.userData.noPatch = true` on meshes whose material you fully control.
- Shared material families live in `src/materials/<family>.js` and are OWNED by one agent (see
  ownership). Others may import them; never edit a file you don't own — ask via your final report.
- Lighting is linear HDR; tone mapping and grading happen in post (`src/core/pipeline.js`). Do not
  pre-tone-map colours. Albedos must be realistic (marble ≈ 0.6–0.75 linear, foliage ≈ 0.04–0.15).
- Canvas textures (banners, inscriptions, leaf atlases) are fine — draw them in code, ≤ 2048².

## Performance budget (whole world on the 780M)
- Instancing (InstancedMesh / BatchedMesh) or merged geometry for anything repeated. Draw calls ≤ ~3000
  total; triangles ≤ ~25 M total at `high`. Each module ≤ ~10 s build at `high` (log your time).
- Scale counts/resolution with `engine.quality.density / detail`. Distant things simpler (LOD by
  distance from the main viewpoints is fine — the cameras are known: src/world/shots.js).
- Heavy procedural geometry may be baked: `loadOrBuild(name, fn)` (src/core/cache.js) +
  `src/bake/<name>.js` + `node tools/bake.mjs <name>` → generated/*.bin. Bump the name when the
  generator changes. Runtime falls back to building if the bake is missing.

## Coordination
- Own your files (listed in your brief). Shared files (`layout.js`, `heightfield.js`, `engine.js`,
  `pipeline.js`, `shots.js`) — only the owner edits, others make minimal additive `Edit`s ONLY if your
  brief allows it (never rewrite a shared file wholesale; re-read right before editing).
- When your reusable API is stable, create a marker file (e.g. `src/arch/READY`) so others can start
  depending on it; keep exported signatures backward-compatible afterwards.
- Never break the world build: run a full-world render (`--quality preview`) before finishing.
- Determinism: same code → same image.
- Deliver a short final report: what you built, files, exported APIs, timings (build ms, tris),
  known gaps, and suggestions for other modules.
