// The 1-minute showcase: nine segments, one per reference shot, each a slow cinematic camera move
// that passes through the exact reference framing at the middle of the segment (u = 0.5).
// Moves are in METRES / DEGREES relative to the shot camera (forward = toward the target):
//   dolly: + forward      truck: + to the right      crane: + up
//   pan / tilt: degrees (+ right / + up)            zoom: relative fov change (-0.05 = 5 % tighter)
//   orbit: degrees around the target (vertical axis)
//   focus: [from, to] metres for a depth-of-field pull (needs dof.aperture on the shot)
// Segments overlap by XFADE seconds (cross-dissolves are done by ffmpeg in tools/render-video.mjs).
export const FPS = 30;
export const XFADE = 0.8;      // seconds of cross-dissolve between consecutive segments
export const SHUTTER = 0.5;    // 180° shutter: motion blur over half the frame interval

// ATLANTIS (r3 draft — director tunes moves against the final cameras): the golden city from the air down to
// the temple, then the SAME temple camera underwater (3 → 6 dissolve = the city sinks across the cut), the
// sunken city, and the film ends at the surface (split level, ref 9) as the sun sets.
export const SEQUENCE = [
  { shot: 1, dur: 7.5, time: 10, move: { dolly: 40, crane: -8, pan: 1.2 }, ease: 'inout' },
  { shot: 2, dur: 7.0, time: 40, move: { dolly: 8, crane: 0.6 }, ease: 'linear' },
  { shot: 4, dur: 6.5, time: 70, move: { dolly: 10, truck: -2 }, ease: 'linear' },
  { shot: 5, dur: 6.5, time: 100, move: { dolly: 2.5, pan: -1.5 }, ease: 'linear' },
  { shot: 3, dur: 7.0, time: 130, move: { dolly: 5, crane: 0.8, tilt: 0.6 }, ease: 'linear' },
  { shot: 6, dur: 7.0, time: 30, move: { dolly: 5, crane: 0.8, tilt: 0.6 }, ease: 'linear' }, // same move as 3: era dissolve
  { shot: 7, dur: 6.5, time: 60, move: { dolly: 6, crane: 1.5, tilt: 1.0 }, ease: 'linear' },
  { shot: 8, dur: 6.5, time: 90, move: { truck: 1.6, pan: -1.0 }, ease: 'linear' },
  { shot: 9, dur: 8.0, time: 120, move: { dolly: 4, crane: 0.0 }, ease: 'out' },
];

export function totalDuration() {
  return SEQUENCE.reduce((s, g) => s + g.dur, 0) - XFADE * (SEQUENCE.length - 1);
}

const easeFns = {
  linear: (u) => u,
  inout: (u) => u * u * (3 - 2 * u),
  out: (u) => 1 - (1 - u) * (1 - u),
};

/** camera {pos, target, fov, dof?} for a segment at normalised time u ∈ [0,1] */
export function cameraAt(shot, seg, u) {
  const e = (easeFns[seg.ease] || easeFns.linear)(Math.min(1, Math.max(0, u))) - 0.5; // −0.5 … +0.5, 0 = reference framing
  const m = seg.move || {};
  const P = shot.pos.slice(), T = shot.target.slice();
  let fx = T[0] - P[0], fy = T[1] - P[1], fz = T[2] - P[2];
  const dist = Math.hypot(fx, fy, fz); fx /= dist; fy /= dist; fz /= dist;
  // right = forward × up(0,1,0) ; camera up = right × forward
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy; // (r × f)
  const add = (v, k) => { P[0] += v[0] * k; P[1] += v[1] * k; P[2] += v[2] * k; T[0] += v[0] * k; T[1] += v[1] * k; T[2] += v[2] * k; };
  if (m.orbit) {
    const a = (m.orbit * e * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const dx = P[0] - T[0], dz = P[2] - T[2];
    P[0] = T[0] + dx * c - dz * s; P[2] = T[2] + dx * s + dz * c;
  }
  if (m.dolly) add([fx, fy, fz], m.dolly * e);
  if (m.truck) add([rx, 0, rz], m.truck * e);
  if (m.crane) add([0, 1, 0], m.crane * e);
  // pan / tilt: rotate the target around the camera position
  if (m.pan || m.tilt) {
    let dx = T[0] - P[0], dy = T[1] - P[1], dz = T[2] - P[2];
    const d = Math.hypot(dx, dy, dz);
    let yaw = Math.atan2(dx, -dz), pitch = Math.asin(dy / d);
    yaw += ((m.pan || 0) * e * Math.PI) / 180;
    pitch += ((m.tilt || 0) * e * Math.PI) / 180;
    T[0] = P[0] + Math.sin(yaw) * Math.cos(pitch) * d;
    T[1] = P[1] + Math.sin(pitch) * d;
    T[2] = P[2] - Math.cos(yaw) * Math.cos(pitch) * d;
  }
  void ux; void uy; void uz;
  const fov = (shot.fov ?? 40) * (1 + (m.zoom || 0) * e * 2);
  let dof = shot.dof ? { ...shot.dof } : null;
  if (dof && m.focus) dof.focus = m.focus[0] + (m.focus[1] - m.focus[0]) * (e + 0.5);
  return { pos: P, target: T, fov, dof };
}
