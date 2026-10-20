# ATLANTIS — final film render plan (director, round 6)

Picture: `src/video/sequence.js` (9 segments, 30 fps, 55.4 s of picture, 1890 rendered frames incl. dissolve overlaps).
Renderer: `tools/render-video.mjs` (headless Chrome + ANGLE/Metal, one world build per era: golden segments 1-5,
then sunken 6-9). Music + credit: added at encode time only. **The film carries no on-screen text** — no title,
no end title. The only text allowed is the music attribution end card (`--credit`), and only if the licence
requires attribution.

## 0. Preconditions

* All agents finished; no other GPU job running (`ls out/.gpu.lock.*` should be empty; sessions: `node tools/snap.mjs --port <p> --quit`).
  Other jobs on the GPU slow the render ≈ 1.5-2x but do not break it.
* Disk: 4K PNG frames are ≈ 20 MB each (≈ 38 GB for the film). The machine had **≈ 41 GB free** in round 6 →
  **always pass `--prune-frames`**: each segment is encoded to a verified lossless-ish intermediate
  (`partNN.mp4`, x264 CRF 10 yuv444p, ≈ 1-2 GB total) in the background as soon as its last frame is written,
  then its PNGs are deleted. Peak disk use ≈ one segment of PNGs (≈ 5 GB, briefly two while a part encodes)
  + parts ≈ **12 GB; have ≥ 15 GB free** (`df -h .`).
* **The volume is shared with other projects**: during round 6 free space fell from 41 GB to **3 GB** (ENOSPC) because of
  `/private/tmp/o2-loop-oss-usage-8714` (139 GB) and `/private/tmp/claude-501/…openobserve…` (97 GB) — not ours, not
  touched. Free space before the film. The renderer now pauses (logs "paused, free some disk space", re-checks every
  60 s) when free space drops below `--min-free` GB (default 4) instead of failing; it resumes by itself.
* Sanity check right before (≈ 1 min): `node tools/render.mjs --shot all --quality high --spp 8 --out out/director/final_check.png`
  → 9 stills, read the logs for page errors.

## 1. Render (one command, resumable)

```bash
cd /Users/hengfeiyang/code/video-demo
node tools/render-video.mjs --w 3840 --h 2160 --quality high --spp 24 --prune-frames --no-encode \
  --out out/film4k > out/film4k.log 2>&1 &
# (or render + encode in one go: drop --no-encode and append the music arguments of step 2)
tail -f out/film4k.log        # "[video] N/M frames  x.x s/frame  ETA h", "part K encoded", "segK: pruned"
```

* **spp 24 for every segment** (= 24 sub-frames spread over the 180° shutter: motion blur + AA + soft shadows).
  16 spp was measured clean (no visible noise at 1:1 in shots 1, 4, 6, 9; motion blur of the 65 m/s shot-1 fly-in
  steps ≈ 1 px); 24 gives margin for the fast shot-1 foreground and the underwater god rays. Per-segment
  overrides if wanted: `--spp-seg "1:32,9:32"` (1-based segment index in SEQUENCE).
* `--quality high` = the quality every still was tuned at (4096 shadow maps, 4 cascades, 32 cloud steps).
  `ultra` (64 cloud steps, shadow far 3200) is untested for the film — do not switch at the last minute.
* Segment / era order: golden world → seg 1 (shot 1) 240 f, seg 2 (shot 2) 210, seg 3 (shot 4) 195, seg 4 (shot 5)
  195, seg 5 (shot 3) 210; sunken world → seg 6 (shot 6) 210, seg 7 (shot 7) 195, seg 8 (shot 8) 195, seg 9 (shot 9) 240.

### Expected time (Apple M3 Ultra, measured round 6 at 3840x2160, 16 spp, 5 other GPU sessions open)

| seg (shot) | frames | s/frame @16 | est. @24 spp |
|---|---|---|---|
| 1 (1) aerial | 240 | 2.8 | 17 min |
| 2 (2) canal | 210 | ≈ 2.5 | 13 min |
| 3 (4) sheds | 195 | 2.0 | 10 min |
| 4 (5) terrace | 195 | ≈ 2.5 | 12 min |
| 5 (3) temple | 210 | ≈ 2.5 | 13 min |
| 6 (6) sunken temple | 210 | 3.0 | 16 min |
| 7 (7) gate bridge | 195 | ≈ 3.0 | 15 min |
| 8 (8) head | 195 | ≈ 3.0 | 15 min |
| 9 (9) split level | 240 | 4.0 | 24 min |

**≈ 2.3 h at 24 spp** (≈ 1.5 h at 16 spp) + 2 world builds (≈ 10 s each) + part encodes (in the background, CPU)
+ the final encode (step 2, ≈ 10-15 min). Budget **3 h**; an idle GPU is faster than the table.

### Resumability

* Stop any time with Ctrl-C (SIGINT kills the Chrome tree). Re-run **the same command**: complete PNG frames are
  skipped (each frame is written to `.tmp` then renamed; on resume every frame is checked for the PNG IEND trailer,
  a truncated one is re-rendered), and segments with a valid `partNN.done.json` marker (frame count, size, spp,
  byte size of `partNN.mp4`) are skipped entirely.
* GPU hang / lost context / blank frame → the harness restarts the browser (up to 40 attempts); a frame that hangs
  twice is retried with a 0.37 s clock shift, then replaced by its neighbour (logged as "held neighbour frame").
* Re-render one segment after a late fix: `rm out/film4k/part05.mp4 out/film4k/part05.done.json` then the same
  command with `--segments 5` (only that era's world is built). Frames are deterministic (engine.frameNo /
  subFrame), so untouched segments do not need re-rendering.
* Faster on two processes? Not measured to help (the GPU is the bottleneck). If wanted: the same `--out` with
  `--segments 1,2,3,4,5` and `--segments 6,7,8,9` in two shells (both with `--no-encode`).

## 2. Encode with music + the CC-BY credit card (FINAL COMMAND)

Track (chosen by the user): `audio/Long Road Ahead.mp3` — Kevin MacLeod (incompetech.com), 2:26, CC BY 4.0;
attribution text in `audio/CREDITS.txt` (the licence requires it → the film ends on a short credit card).

```bash
node tools/render-video.mjs --encode-only --w 3840 --h 2160 --out out/film4k \
  --music "audio/Long Road Ahead.mp3" --music-start 53.5 --music-fade 4 \
  --credit-file audio/CREDITS.txt --name atlantis_4k.mp4
```

Output: `out/film4k/atlantis_4k.mp4` (3840x2160, 30 fps, H.264 High CRF 14, yuv420p, BT.709 tags, AAC 256k 48 kHz,
faststart, 59.4 s = 55.4 s picture + 4.0 s credit card) + `out/film4k/atlantis_4k_1080p.mp4` (CRF 16, same audio).

**Why `--music-start 53.5`** (analysis: `out/director/r6/music_analyse.py` — onset flux, 2-s loudness, self-similarity
novelty; tempo ≈ 103 bpm, bar ≈ 2.33 s). The track is a quiet folk melody (-25…-30 dB) that swells into its
triumphant final section at 101.0-101.75 s. With the excerpt starting at 53.5 s:

| film time | picture | track time | music |
|---|---|---|---|
| 0.0-1.5 | shot 1 opens (fade-in 1.5 s) | 53.5 | mid-phrase, breath at 54.8-55.5 → new phrase at film 2.0 |
| 24.8 | cut to shot 3 (temple) | 78.3 | phrase dip (-31.6 dB) — novelty boundary 78.0 |
| 29.8-31.8 | **3 → 6 era dissolve** (the city sinks) | 83.3-85.3 | section boundary 83.0, the phrase dies away to 85.3 (-33 dB) as the water closes |
| 41.7-42.5 | dissolve into shot 8 | 95.2-96.0 | boundary 95.5 |
| 47.4-48.2 | dissolve into shot 9 (split level, sunset) | 100.9-101.7 | **the triumphant section enters** (swell 101.0-101.75) |
| 53.8-55.4 | picture fades to black | 107.3-108.9 | bar line at 108.75 |
| 55.4-59.4 | credit card | 108.9-112.9 | triumph continues, fades out over the card (4 s) |

* `--music <path>`: must exist (the tool exits otherwise). Excerpt `[music-start, music-start + 59.4]`; a shorter track
  is padded with silence. Fade-in 1.5 s (`--music-fade-in`), fade-out `--music-fade 4` (= the whole card).
* Loudness: two-pass LINEAR — the faded excerpt is measured (-16.9 LUFS) and gained to `--lufs` (default -16), then
  a -2.5 dBFS peak limiter. Measured on the preview: -16.6 LUFS integrated, LRA 14.5 LU (the quiet-to-triumph
  dynamics are kept; single-pass loudnorm squashed them to 5.5 LU), peak -1.8 dBFS.
* `--credit-file audio/CREDITS.txt`: its non-empty lines except the "Source:" line become the card (3 lines:
  title + author, licence, licence URL), black background, serif, warm grey, ≈ 2 % of the frame height, fade in
  0.3-1.1 s / out over the last second. (`--credit "line 1|line 2"` is the inline alternative.) Cards are rendered
  by headless Chrome (this ffmpeg build has no drawtext).
* **The film carries no other text: never pass `--title`, `--subtitle` or `--endtitle`.**
* Re-encoding (another offset/track) takes minutes: the parts are reused, only this step runs.
* Same encode for the motion preview: `--w 640 --h 360 --out out/<preview dir> --name atlantis_preview_music.mp4`.

### Check the result
```bash
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of compact out/film4k/atlantis_4k.mp4
ffmpeg -i out/film4k/atlantis_4k.mp4 -af ebur128=peak=true -f null - 2>&1 | grep -E "I:|LRA:|Peak:" | tail -3   # ≈ -16.6 LUFS, LRA ≈ 14.5
ffmpeg -loglevel error -i out/film4k/atlantis_4k.mp4 -vf "fps=1,scale=320:-1,tile=8x8" -frames:v 1 out/film4k/sheet.jpg
```

## 3. Motion preview (for checks during development)

```bash
node tools/render-video.mjs --w 640 --h 360 --spp 2 --out out/<you>/preview   # ≈ 6-10 min, 2 spp, no music
node tools/render-video.mjs --w 3840 --h 2160 --spp 16 --segments 1,9 --frames 100-105 --no-encode --out out/<you>/t4k   # 4K timing test
```

Tool tests round 6 (all pass): 640x360 / 320x180 render + background part encode + prune + resume (second run
skips rendered segments in 4 s), music + credit card (`--credit-file`, -16.6 LUFS / LRA 14.5), 4K encode path (see
COMPOSITION.md round-6 log).
