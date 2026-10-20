# The prompt

All my messages from the session, merged into one prompt. It was used with Claude Code (Opus 5.5, xhigh) plus the 9 reference images.

```text
Build me a massive, ultra-detailed 3D world in three.js based on the 9 reference images I attached.

Rules:
- Zero external assets. Every mesh, texture, shader and effect has to be generated in code.
- Match the references as closely as possible (aim for 99.9%): composition, scale, materials and
  especially the colors. Cinematic and realistic, not oversaturated, but also not grey or washed out.
- Detail everywhere. Nothing should look copy-pasted or simple. Every building, tree, rock and
  waterfall gets care, and the world has to read as ultra detailed even from far away.
- Waterfalls and water have to look realistic.
- My GPU is weak (integrated Radeon 780M), so keep it efficient and get the quality from offline
  rendering instead.
- Work only inside this project folder.

Process:
- Iterate for as long as it takes (hours or days). Don't stop before it matches the references.
- Render the matching shots as stills and show them to me first. Don't render the video before I approve.
- After I approve: render a cinematic ~1 minute showcase video in 4K at 30fps with slow camera moves
  through the different scenes, no text on screen, impressive from the very first frame, and free
  cinematic background music from the web (credit the artist).
```
