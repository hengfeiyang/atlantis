# Athenaion

A massive ancient Greek world built entirely in code with three.js. There are no external assets: every mesh, texture, shader, tree, statue and waterfall is generated procedurally. Claude Code (Opus 5.5) built it over about 2 days to match 9 reference images, and it was rendered in 4K on an integrated laptop GPU (AMD Radeon 780M).

![teaser](media/teaser.gif)

![all shots](media/overview.jpg)

## What's in it

- An acropolis on a limestone cliff massif with terraces, retaining walls, a podium and a grand stair
- A Parthenon-style Doric temple with gilded acroteria, sculpted pediments, metopes and owl banners
- Colossal Athena statues and dozens of smaller statues, all sculpted as signed distance fields and meshed
- 57 traced waterfalls with spray, mist and foam, plus a lagoon, a river with rapids and a sea with planar reflections
- Aqueducts and bridges, a city of procedural houses, a harbour with ships, a tholos on an island
- 149k cypress, olive, pine and broadleaf trees and shrubs, with ivy, grass and flowers
- An eroded snowy mountain range, volumetric clouds, cloud banks and aerial perspective
- A giant fallen marble head and a ruined portico in the foreground
- An offline renderer with jittered accumulation (AA, soft shadows, motion blur), AgX tone mapping, local tone mapping, bloom and colour grading

| | |
|---|---|
| ![](media/shot5.jpg) | ![](media/shot2.jpg) |
| ![](media/shot4.jpg) | ![](media/shot8.jpg) |

## Numbers

| | |
|---|---|
| Total time | ~45 h wall clock (Oct 16, 03:36 to Oct 18, 00:34) |
| Building and iterating | ~27 h across 9 multi-agent rounds |
| Agents | 55 subagents (up to 12 in parallel), ~147 agent-hours |
| Final rendering | 4K stills plus a 54 s 4K 30fps video, ~13 h of GPU rendering |
| Code | ~45k lines of JavaScript in 168 modules |
| Tokens | ~11M output tokens, ~3.8B cache-read tokens, ~161M cache-write tokens |
| API-equivalent cost | ~$1.8k to $2.3k at Opus 5.5 API prices (actually run on a Claude Max subscription) |

## References

The 9 AI-generated reference images the world was built to match are in [`refs/`](refs). Left: reference, right: final 4K render.

![reference vs render](media/reference_vs_render.jpg)

## How it was made

The whole session prompt is in [docs/PROMPT.md](docs/PROMPT.md).

1. Claude Code wrote the engine first: the render harness, atmosphere, sky, shadows and the accumulation pipeline.
2. It wrote an art bible and module contract (`docs/`), then ran 12 specialist agents in parallel: terrain, water, sky, architecture, acropolis, aqueducts, statues, ruins, trees, flora, city and props. Each agent rendered its work, compared it against the references and fixed it in a loop.
3. Further rounds of director, look-dev and module agents tightened composition, colour, detail density and waterfalls, using side-by-side comparisons and colour statistics against every reference.
4. The final video was rendered frame by frame (8 or 4 samples per frame with motion blur), cut with crossfades and scored.

## Running it

```bash
npm install
node tools/serve.mjs
```

Then open `http://localhost:8080/?shot=1&quality=preview`. Keys 1-9 switch shots and the mouse orbits.

Heavy geometry (terrain meshes, statues, the giant head) is not committed. The first load builds it at runtime, which is slow. To bake it once:

```bash
node tools/bake.mjs terrain
node tools/bake.mjs statues
node tools/bake.mjs head
```

Rendering stills and video needs Chrome or Edge:

```bash
node tools/render.mjs --shot 1 --quality high --spp 16 --w 3840 --h 2160
node tools/render-video.mjs --w 1920 --h 1080 --spp 8 --quality high
```

## Credits

Built with Claude Code (Claude Opus 5.5) and [three.js](https://threejs.org).

Music in the showcase video: "Ascending the Vale" by Kevin MacLeod (incompetech.com), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). The music is not part of this repository.

MIT licensed.
