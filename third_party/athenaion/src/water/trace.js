// Waterfall / stream path tracing against the real terrain.
//
// Water leaves a lip with some horizontal speed, follows a ballistic arc, and when it touches the
// ground it slides along the surface (velocity projected onto the tangent plane, friction),
// drapes over ledges, runs across flat terraces toward the next drop, and finally ends when it
// reaches the water level (impact) or settles in a pool.
// A wide fall is traced as several parallel sub-streams so the sheet follows the real cliff
// shape across its whole width.
import { heightAt } from '../world/heightfield.js';

const G = 9.81;

/** Height sampler: max(analytic heightAt, captured mesh height) — water must clear both. */
export function makeGround(maps = [], { analytic = false } = {}) {
  // with captured maps: sample the meshed terrain only (fast); analytic heightAt elsewhere
  const H = (x, z) => {
    for (const m of maps) {
      if (!m) continue;
      const v = m.sample(x, z);
      if (v !== null) return analytic ? Math.max(v, heightAt(x, z)) : v;
    }
    return heightAt(x, z);
  };
  const N = (x, z, e = 0.8) => {
    const hx = H(x + e, z) - H(x - e, z), hz = H(x, z + e) - H(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz, l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  };
  return { H, N };
}

export function dirVec(compassDeg) {
  const a = (compassDeg * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

/**
 * Find the real cliff edge near a waterfall spec: search along the flow direction for the point
 * where the ground starts to drop away, preferring edges whose height is close to the spec lip y.
 */
export function snapLip(ground, spec, { search = [-45, 90] } = {}) {
  const [dx, dz] = spec.dirVec || dirVec(spec.dir);
  const [fx, fy, fz] = spec.from;
  let best = null;
  const step = 0.5;
  for (let s = search[0]; s <= search[1]; s += step) {
    const x = fx + dx * s, z = fz + dz * s;
    const h0 = ground.H(x, z);
    const h1 = ground.H(x + dx * 2.5, z + dz * 2.5);
    const h2 = ground.H(x + dx * 6, z + dz * 6);
    const hb = ground.H(x - dx * 2, z - dz * 2);
    const drop = h0 - h1, drop6 = h0 - h2;
    if (drop < 1.6 || drop6 < 4.5) continue;
    if (hb - h0 > 1.2) continue; // must not be mid-slope: ground behind is about level
    const score = Math.abs(h0 - fy) * 1.0 + Math.abs(s) * 0.35 - Math.min(drop6, 30) * 0.15;
    if (!best || score < best.score) best = { score, s, x, z, y: h0, drop6 };
  }
  if (!best) return { x: fx, y: Math.max(fy, ground.H(fx, fz)), z: fz, s: 0, dx, dz, snapped: false };
  return { x: best.x, y: best.y, z: best.z, s: best.s, dx, dz, snapped: true, drop: best.drop6 };
}

/**
 * Trace one stream.
 * @returns {{ samples: Float32Array, count: number, end: object, landings: object[] }}
 *   samples: per τ step (dtRec): x, y, z, pathLen, contact, vx, vy, vz
 */
export function traceStream(ground, p0, v0, o = {}) {
  const level = o.level ?? 0;
  const dt = o.dt ?? 1 / 150;
  const rec = o.recEvery ?? 3;            // record every n steps
  const tMax = o.tMax ?? 60;
  const sMax = o.sMax ?? 700;
  const clear = o.clearance ?? 0.35;
  const minRun = o.minRunSpeed ?? 1.4;
  const fric = o.friction ?? 0.55;
  const STRIDE = 8;
  const cap = Math.ceil(tMax / dt / rec) + 2;
  const out = new Float32Array(cap * STRIDE);
  let n = 0;
  let [x, y, z] = p0, [vx, vy, vz] = v0;
  let path = 0, contact = 0, flatTime = 0, airTime = 0, runLen = 0;
  const maxRun = o.maxRun ?? 60;
  const landings = [];
  let end = null;
  const push = () => {
    if (n >= cap) return;
    const k = n * STRIDE;
    out[k] = x; out[k + 1] = y; out[k + 2] = z; out[k + 3] = path; out[k + 4] = contact;
    out[k + 5] = vx; out[k + 6] = vy; out[k + 7] = vz; n++;
  };
  // settle onto the ground at the start
  {
    const h = ground.H(x, z);
    if (y < h + clear) y = h + clear;
  }
  push();
  let steps = 0;
  let air = !(y <= ground.H(x, z) + clear + 0.05);
  const d0 = o.dir || [1, 0];
  for (let t = 0; t < tMax; t += dt) {
    const px = x, py = y, pz = z;
    if (air) {
      // ---- ballistic
      vy -= G * dt;
      x += vx * dt; y += vy * dt; z += vz * dt;
      let h = ground.H(x, z);
      if (h > py + 0.8) {
        // hit a protruding rock while flying: stop there (no sideways deflection, keeps the sheet wide)
        x = px; z = pz;
        const along = vx * d0[0] + vz * d0[1];
        vx = d0[0] * Math.max(0.3, along * 0.3); vz = d0[1] * Math.max(0.3, along * 0.3);
        h = ground.H(x, z);
      }
      if (h < level - 0.05 && y <= level + 0.02) {
        y = level; path += Math.hypot(x - px, y - py, z - pz); contact = 0; push();
        end = { type: 'water', x, y: level, z, vx, vy, vz, speed: Math.hypot(vx, vy, vz), t, path };
        break;
      }
      if (y <= h + clear) {
        // touching the ground: resolve the penetration along the surface normal (mostly sideways on
        // steep faces), keep the tangential velocity, lose energy on hard impacts
        let nrm = ground.N(x, z);
        const impactVy = vy;
        let tanS = Math.hypot(nrm[0], nrm[2]) / Math.max(nrm[1], 1e-3);
        const hard = airTime > 0.25 && -impactVy > 5;
        if (tanS >= 1.0) {
          // steep face: the sheet drapes down it. Push the parcel OUT along the fall direction (not along
          // the 3D face normal, which would slide streams sideways into grooves and collapse the sheet)
          let k = 0;
          while (k < 40 && ground.H(x, z) + clear > y) { x += d0[0] * 0.25; z += d0[1] * 0.25; k++; }
          if (k >= 40) { y = ground.H(x, z) + clear; }
          const along = vx * d0[0] + vz * d0[1];
          const sp = Math.max(0.35, Math.min(along, 2.5));
          vx = d0[0] * sp; vz = d0[1] * sp;
          vy *= Math.exp(-0.6 * dt);              // friction against the rock
          if (hard) { vy *= 0.75; landings.push({ x, y, z, speed: -impactVy, t, path }); }
          contact = 1; airTime = 0;
        } else {
          y = h + clear;
          const vn = vx * nrm[0] + vy * nrm[1] + vz * nrm[2];
          if (vn < 0) { vx -= nrm[0] * vn; vy -= nrm[1] * vn; vz -= nrm[2] * vn; }
          const keep = hard ? 0.72 : Math.exp(-0.35 * dt);
          vx *= keep; vy *= keep; vz *= keep;
          if (hard) landings.push({ x, y, z, speed: -impactVy, t, path });
          contact = 1; air = false; airTime = 0; // gentle enough to flow on
        }
      } else { contact = 0; airTime += dt; }
    } else {
      // ---- flowing on the ground: follow the surface, gravity along the slope, friction
      const nrm = ground.N(x, z);
      const gl = Math.hypot(nrm[0], nrm[2]);
      const tanS = gl / Math.max(nrm[1], 1e-3);
      if (tanS > 1.05) {
        // too steep to flow on: free fall along the face
        air = true; vy = Math.min(vy, 0); contact = 1;
        path += 0; if (++steps % rec === 0) push();
        continue;
      }
      // tangential gravity
      vx += G * nrm[0] * nrm[1] * dt; vz += G * nrm[2] * nrm[1] * dt;
      const k = fric * (tanS < 0.4 ? 1.0 : 0.5);
      const damp = Math.exp(-k * dt);
      vx *= damp; vz *= damp;
      let hs = Math.hypot(vx, vz);
      if (tanS < 0.7 && hs < minRun) {
        const hx = hs > 1e-3 ? vx / hs : d0[0], hz = hs > 1e-3 ? vz / hs : d0[1];
        let dw = gl > 1e-4 ? Math.min(1, tanS * 3) * 0.8 : 0;
        const ddx = gl > 1e-4 ? nrm[0] / gl : 0, ddz = gl > 1e-4 ? nrm[2] / gl : 0;
        if (ddx * hx + ddz * hz < 0) dw *= 0.15; // small basins fill up and overflow forward
        let ux = hx * 0.75 + d0[0] * 0.25 + ddx * dw;
        let uz = hz * 0.75 + d0[1] * 0.25 + ddz * dw;
        const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
        vx = ux * minRun; vz = uz * minRun; hs = minRun;
      }
      if (tanS < 0.35) runLen += hs * dt;
      let nx = x + vx * dt, nz = z + vz * dt;
      let h = ground.H(nx, nz);
      if (h > py + 2.0) {
        // wall: slide along it instead of climbing
        const vn = vx * nrm[0] + vz * nrm[2];
        const n0 = ground.N(nx, nz);
        const wn = vx * n0[0] + vz * n0[2];
        if (wn < 0) { vx -= n0[0] * wn; vz -= n0[2] * wn; }
        nx = x; nz = z; h = ground.H(x, z);
        void vn;
      }
      if (h < level - 0.05 && py <= level + 0.6) {
        x = nx; z = nz; y = level; path += Math.hypot(x - px, y - py, z - pz); contact = 0; push();
        end = { type: 'water', x, y: level, z, vx, vy, vz, speed: Math.hypot(vx, vy, vz), t, path };
        break;
      }
      // ballistic prediction for this step (vy from the previous ground-following step)
      const yb = py + vy * dt - 0.5 * G * dt * dt;
      if (h + clear < yb - 0.004) {
        // the ground falls away faster than a free parcel: launch
        x = nx; z = nz; y = yb; vy -= G * dt;
        air = true; contact = 0; airTime = dt; runLen = 0;
      } else {
        x = nx; z = nz;
        y = h + clear;
        vy = (y - py) / dt;
        vy = Math.max(-60, Math.min(vy, 6));
        contact = 1;
      }
    }
    path += Math.hypot(x - px, y - py, z - pz);
    if (++steps % rec === 0) {
      push();
      // pool: no real progress for several seconds (water settles in a basin)
      const back = Math.round(6 / (dt * rec));
      if (n > back) {
        const kb = (n - 1 - back) * STRIDE;
        if (Math.hypot(x - out[kb], z - out[kb + 2]) < 2.5 && Math.abs(y - out[kb + 1]) < 1.0) flatTime = 1;
      }
    }
    if (flatTime > 0 || path > sMax || runLen > maxRun) {
      push();
      end = { type: flatTime > 0 ? 'pool' : runLen > maxRun ? 'sink' : 'length', x, y, z, vx, vy, vz, speed: Math.hypot(vx, vy, vz), t, path };
      break;
    }
  }
  if (!end) { push(); end = { type: 'timeout', x, y, z, vx, vy, vz, speed: Math.hypot(vx, vy, vz), t: tMax, path }; }
  return { samples: out, count: n, stride: STRIDE, end, landings, dtRec: dt * rec };
}

/**
 * Trace a whole waterfall: lip snap + K parallel sub-streams.
 * @param ground makeGround() result
 * @param spec {from:[x,y,z], dir (compass deg) | dirVec:[dx,dz], width, flow, snap?:bool, id}
 * @param rng engine.rng(...)
 */
export function traceFall(ground, spec, rng, o = {}) {
  const width = spec.width ?? 8, flow = spec.flow ?? 1;
  const lip = spec.snap === false
    ? (() => { const [dx, dz] = spec.dirVec || dirVec(spec.dir); return { x: spec.from[0], y: spec.from[1], z: spec.from[2], dx, dz, snapped: false, s: 0 }; })()
    : snapLip(ground, spec);
  const dx = lip.dx, dz = lip.dz;
  const ax = -dz, az = dx; // across (horizontal, perpendicular)
  const K = Math.max(3, Math.min(11, Math.round(width / 1.6) + 1));
  // spec.v0: exit speed (m/s; spouts/arches pour slowly, close to the face), spec.fan: lateral spread speed of the
  // outer streams (m/s at the edges: the sheet widens as it falls)
  const v0 = spec.v0 ?? 1.2 + 1.8 * flow;
  const fan = spec.fan ?? 0.09 * v0;
  const back = spec.snap === false ? 0 : (o.back ?? 1.2);
  const streams = [];
  for (let j = 0; j < K; j++) {
    const u = K === 1 ? 0.5 : j / (K - 1);
    const off = (u - 0.5) * width;
    const jitter = (rng.random() - 0.5) * 0.25;
    let sx = lip.x + ax * off - dx * back, sz = lip.z + az * off - dz * back;
    // (spec.lipJitter: ragged rock lip — each sub-stream leaves at its own height)
    const sy = (spec.snap === false ? lip.y : ground.H(sx, sz) + 0.3) + (spec.lipJitter ? (rng.random() - 0.5) * spec.lipJitter : 0);
    // spill outlets under an overhang (cornice, castellum roof, arch soffit in the captured height):
    // start in front of it instead of being lifted onto the roof
    if (spec.snap === false) for (let m = 0; m < 24 && ground.H(sx, sz) > sy + 0.25; m++) { sx += dx * 0.3; sz += dz * 0.3; }
    // slight fan-out: outer streams diverge a little
    const spread = (u - 0.5) * 2 * fan;
    const vv = v0 * (1 + jitter * 0.3);
    const st = traceStream(ground, [sx, sy, sz], [dx * vv + ax * spread, 0, dz * vv + az * spread], {
      level: o.level ?? 0, dir: [dx, dz], tMax: o.tMax ?? spec.tMax ?? 45, sMax: o.sMax ?? spec.sMax ?? 520, clearance: o.clearance ?? 0.4,
    });
    st.u = u; st.off = off;
    streams.push(st);
  }
  // fall summary
  const ends = streams.map((s) => s.end);
  const waterEnds = ends.filter((e) => e.type === 'water');
  let impact = null;
  if (waterEnds.length) {
    const cx = waterEnds.reduce((a, e) => a + e.x, 0) / waterEnds.length;
    const cz = waterEnds.reduce((a, e) => a + e.z, 0) / waterEnds.length;
    const sp = waterEnds.reduce((a, e) => a + e.speed, 0) / waterEnds.length;
    let spanX = 0;
    for (const e of waterEnds) spanX = Math.max(spanX, Math.hypot(e.x - cx, e.z - cz));
    const vx = waterEnds.reduce((a, e) => a + e.vx, 0), vz = waterEnds.reduce((a, e) => a + e.vz, 0);
    const vl = Math.hypot(vx, vz) || 1;
    impact = { x: cx, z: cz, speed: sp, radius: Math.min(spanX, width * 0.6) + 1.5 + Math.min(5, sp * 0.16) * Math.sqrt(flow), strength: flow * Math.min(1.2, 0.25 + sp / 18), dir: [vx / vl, vz / vl], frac: waterEnds.length / ends.length };
  }
  const landings = [];
  for (const s of streams) for (const l of s.landings) landings.push(l);
  const topY = lip.y;
  let minY = Infinity;
  for (const e of ends) minY = Math.min(minY, e.y);
  return { spec, id: spec.id, lip, dir: [dx, dz], across: [ax, az], width, flow, K, streams, impact, landings, drop: topY - minY, ends };
}

/** quick footprint corridor of a traced fall: polyline of the central stream (x,z) */
export function fallCorridor(fall, step = 4) {
  const s = fall.streams[Math.floor(fall.streams.length / 2)];
  const pts = [];
  let last = null;
  for (let i = 0; i < s.count; i++) {
    const k = i * s.stride, x = s.samples[k], z = s.samples[k + 2];
    if (!last || Math.hypot(x - last[0], z - last[1]) >= step) { pts.push([x, z]); last = [x, z]; }
  }
  if (pts.length < 2) pts.push([fall.lip.x + fall.dir[0], fall.lip.z + fall.dir[1]]);
  return pts;
}
