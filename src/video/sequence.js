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

// ATLANTIS (r4 director): the golden city from the air down to the temple, then the SAME temple camera underwater
// (3 → 6: one continuous push-in, a long 2 s dissolve = the city sinks across the cut), the sunken city, and the film
// ends at the surface (split level, ref 9) as the sun sets.
// Extra fields (r4):
//   push:  metres, HORIZONTAL forward (keeps the eye height: shot 9's eye must stay at the waterline)
//   range: [e0, e1] move parameter at u = 0 / 1 after easing (default [-0.5, 0.5]; e = 0 is the reference framing)
//   xfade: seconds of dissolve INTO the next segment (default XFADE)
// Shot 6 continues shot 3's push: same rate (1 unit of e per 7 s), starting where shot 3 is when the dissolve begins.
const S36 = 7.0, X36 = 2.0;
export const SEQUENCE = [
  { shot: 1, dur: 8.0, time: 10, move: { dolly: 150, crane: -10, pan: 0.6 }, ease: 'linear' },   // drone push-in over the fleet toward the citadel
  { shot: 2, dur: 7.0, time: 40, move: { dolly: 9, crane: 0.8, pan: -0.8 }, ease: 'linear' },     // gliding up the canal, the hero trireme rowing toward us
  { shot: 4, dur: 6.5, time: 70, move: { dolly: 11, truck: -2.5 }, ease: 'linear' },             // along the ship-shed mole at water level
  { shot: 5, dur: 6.5, time: 100, move: { truck: -1.8, pan: 1.6 }, ease: 'linear', range: [-0.2, 0.8] }, // sideways along the balustrade, leftward (> 0.5 m right of the ref eye the hero palm trunk enters)
  { shot: 3, dur: S36, time: 130, move: { dolly: 6, crane: 0.5 }, ease: 'linear', range: [-0.3, 0.7], xfade: X36 },  // slow push toward the temple (a pull-back runs into the stair-head piers) ...
  { shot: 6, dur: S36, time: 30, move: { dolly: 6, crane: 0.5 }, ease: 'linear', range: [0.7 - X36 / S36, 1.7 - X36 / S36] }, // ... continued underwater
  { shot: 7, dur: 6.5, time: 60, move: { dolly: 5, crane: 1.5, tilt: 1.0 }, ease: 'linear' },
  { shot: 8, dur: 6.5, time: 90, move: { orbit: -6, truck: 0.6, pan: -0.8 }, ease: 'linear' },
  { shot: 9, dur: 8.0, time: 120, move: { push: 9 }, ease: 'out', range: [-0.6, 0.2] },            // ease-out: e = 0 (ref 9) at u = 0.5, comes to rest
];
export const xfadeAfter = (i) => SEQUENCE[i]?.xfade ?? XFADE;

export function totalDuration() {
  return SEQUENCE.reduce((s, g, i) => s + g.dur - (i < SEQUENCE.length - 1 ? xfadeAfter(i) : 0), 0);
}

const easeFns = {
  linear: (u) => u,
  inout: (u) => u * u * (3 - 2 * u),
  out: (u) => 1 - (1 - u) * (1 - u),
};

/** camera {pos, target, fov, dof?} for a segment at normalised time u ∈ [0,1] */
export function cameraAt(shot, seg, u) {
  const [e0, e1] = seg.range || [-0.5, 0.5];
  const e = e0 + (e1 - e0) * (easeFns[seg.ease] || easeFns.linear)(Math.min(1, Math.max(0, u))); // 0 = reference framing
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
  if (m.push) { const hl = Math.hypot(fx, fz) || 1; add([fx / hl, 0, fz / hl], m.push * e); }
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
