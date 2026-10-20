// In-page video frame renderer (driven by tools/render-video.mjs):
//   window.__videoInfo()                     → { fps, xfade, segments: [{ shot, frames }] }
//   window.__renderVideoFrame(seg, frame, spp) → PNG data URL of that frame
// Each frame accumulates `spp` sub-frames spread over the shutter interval: camera, animation time,
// sub-pixel jitter, soft-shadow jitter (and DOF) all vary per sub-frame → true motion blur + AA.
import { FPS, XFADE, SHUTTER, SEQUENCE, cameraAt } from './sequence.js';

export function setupVideo(engine, SHOTS) {
  const shotById = (id) => SHOTS.find((s) => String(s.id) === String(id));
  const segs = SEQUENCE.map((g, i) => {
    const last = i === SEQUENCE.length - 1;
    // every segment except the last carries the cross-dissolve tail (already included in dur)
    return { ...g, frames: Math.round(g.dur * FPS), last };
  });
  let current = -1;

  window.__videoInfo = () => ({ fps: FPS, xfade: XFADE, segments: segs.map((s) => ({ shot: s.shot, frames: s.frames, dur: s.dur })) });

  window.__renderVideoFrame = async (si, frame, spp = 8, timeShift = 0) => {
    const seg = segs[si];
    const shot = shotById(seg.shot);
    if (current !== si) { engine.applyShot(shot); current = si; }
    const cam = engine.camera;
    const gl = engine.renderer.getContext();
    engine.ensurePatched();
    engine.pipeline.begin();
    for (let i = 0; i < spp; i++) {
      // sub-frame time within the shutter interval (centred on the frame time)
      const tLocal = (frame + SHUTTER * ((i + 0.5) / spp - 0.5)) / FPS;
      const c = cameraAt(shot, seg, tLocal / seg.dur);
      cam.fov = c.fov; cam.position.set(...c.pos); cam.up.set(0, 1, 0); cam.lookAt(c.target[0], c.target[1], c.target[2]);
      if (shot.roll) cam.rotateZ((shot.roll * Math.PI) / 180);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      if (c.dof) engine.shot.dof = c.dof;
      engine.setTime(seg.time + tLocal + timeShift); // timeShift: retry knob for a frame that hung the GPU
      if (i === 0) engine.lighting.refreshCSM();
      engine.lighting.updateLens?.();
      engine.renderSample(i, { jitter: true });
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      if (sync) {
        for (let k = 0; k < 20000 && gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED; k++) await new Promise((r) => setTimeout(r, 2));
        gl.deleteSync(sync);
      }
    }
    engine.pipeline.resolve(null, si * 1000 + frame); // grain varies per frame
    // guard: a lost / broken GL context silently yields blank frames → fail loudly so the harness restarts
    if (gl.isContextLost()) throw new Error('webgl context lost');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const W = engine.canvas.width, H = engine.canvas.height, px = new Uint8Array(4);
    let lit = 0;
    for (const [fx, fy] of [[0.25, 0.3], [0.5, 0.5], [0.75, 0.7], [0.3, 0.8], [0.7, 0.2]]) {
      gl.readPixels(Math.floor(W * fx), Math.floor(H * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[3] > 0 && px[0] + px[1] + px[2] > 6) lit++;
    }
    if (lit < 2) throw new Error('blank frame (render produced no image)');
    return engine.canvas.toDataURL('image/png');
  };
}
