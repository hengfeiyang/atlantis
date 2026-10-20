// adapted from athenaion/src/city/lots.js (RectIndex: oriented-rect occupancy with SAT overlap)
export class RectIndex {
  constructor(cell = 32) { this.cell = cell; this.m = new Map(); this.items = []; }
  _cells(r, fn) {
    const c = this.cell, br = r.br;
    for (let ix = Math.floor((r.x - br) / c); ix <= Math.floor((r.x + br) / c); ix++)
      for (let iz = Math.floor((r.z - br) / c); iz <= Math.floor((r.z + br) / c); iz++) fn(ix * 73856 + iz * 19349);
  }
  add(x, z, hw, hd, rot, tag = '') {
    const r = { x, z, hw, hd, rot, c: Math.cos(rot), s: Math.sin(rot), br: Math.hypot(hw, hd), tag };
    this._cells(r, (k) => { let b = this.m.get(k); if (!b) this.m.set(k, (b = [])); b.push(r); });
    this.items.push(r);
    return r;
  }
  /** SAT overlap test of an oriented rect against the index */
  overlaps(x, z, hw, hd, rot, ignoreTag = null) {
    const q = { x, z, hw, hd, rot, c: Math.cos(rot), s: Math.sin(rot), br: Math.hypot(hw, hd) };
    let hit = false;
    const seen = new Set();
    this._cells(q, (k) => {
      if (hit) return;
      const b = this.m.get(k); if (!b) return;
      for (const r of b) {
        if (seen.has(r)) continue; seen.add(r);
        if (ignoreTag && r.tag === ignoreTag) continue;
        if (Math.hypot(r.x - q.x, r.z - q.z) > r.br + q.br) continue;
        if (obbOverlap(q, r)) { hit = true; return; }
      }
    });
    return hit;
  }
}
function axes(r) {
  // local x axis in world (cos, -sin) and local z axis (sin, cos)  (THREE rotation.y convention)
  return [[r.c, -r.s], [r.s, r.c]];
}
function obbOverlap(a, b) {
  const A = axes(a), B = axes(b);
  const d = [b.x - a.x, b.z - a.z];
  for (const ax of [...A, ...B]) {
    const pa = a.hw * Math.abs(A[0][0] * ax[0] + A[0][1] * ax[1]) + a.hd * Math.abs(A[1][0] * ax[0] + A[1][1] * ax[1]);
    const pb = b.hw * Math.abs(B[0][0] * ax[0] + B[0][1] * ax[1]) + b.hd * Math.abs(B[1][0] * ax[0] + B[1][1] * ax[1]);
    if (Math.abs(d[0] * ax[0] + d[1] * ax[1]) > pa + pb) return false;
  }
  return true;
}
