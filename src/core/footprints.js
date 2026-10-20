// Occupancy registry so scattered things (trees, houses, rocks) don't intersect buildings.
// Build order matters: architecture registers first, then the city, then vegetation queries.
//   fp.addCircle(x, z, r, 'temple')
//   fp.addRect(cx, cz, halfW, halfD, rotY, 'stair')
//   fp.isFree(x, z, r)  → true if a circle of radius r touches nothing registered
export class Footprints {
  constructor(cell = 24) {
    this.cell = cell;
    this.grid = new Map();
    this.items = [];
  }
  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  _insert(item) {
    const c = this.cell, r = item.br;
    const x0 = Math.floor((item.x - r) / c), x1 = Math.floor((item.x + r) / c);
    const z0 = Math.floor((item.z - r) / c), z1 = Math.floor((item.z + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this._key(ix, iz);
      let b = this.grid.get(k); if (!b) { b = []; this.grid.set(k, b); }
      b.push(item);
    }
    this.items.push(item);
    return item;
  }
  addCircle(x, z, r, tag = '') { return this._insert({ type: 'c', x, z, r, br: r, tag }); }
  addRect(cx, cz, hw, hd, rotY = 0, tag = '') {
    return this._insert({ type: 'r', x: cx, z: cz, hw, hd, cos: Math.cos(rotY), sin: Math.sin(rotY), br: Math.hypot(hw, hd), tag });
  }
  /** polyline corridor (roads, aqueduct footings, stairs) */
  addPath(points, halfWidth, tag = '') {
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1];
      const cx = (ax + bx) / 2, cz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az);
      this.addRect(cx, cz, halfWidth, len / 2 + halfWidth * 0.5, Math.atan2(bx - ax, bz - az), tag);
    }
  }
  _hit(it, x, z, r) {
    if (it.type === 'c') return Math.hypot(x - it.x, z - it.z) < it.r + r;
    // rect in local frame (rotation about Y: local z axis = (sin, cos))
    const dx = x - it.x, dz = z - it.z;
    const lx = dx * it.cos - dz * it.sin, lz = dx * it.sin + dz * it.cos;
    const qx = Math.max(Math.abs(lx) - it.hw, 0), qz = Math.max(Math.abs(lz) - it.hd, 0);
    return Math.hypot(qx, qz) < r;
  }
  query(x, z, r = 0, ignoreTags = null) {
    const c = this.cell, out = [];
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const b = this.grid.get(this._key(ix, iz)); if (!b) continue;
      for (const it of b) {
        if (ignoreTags && ignoreTags.includes(it.tag)) continue;
        if (this._hit(it, x, z, r) && !out.includes(it)) out.push(it);
      }
    }
    return out;
  }
  isFree(x, z, r = 0, ignoreTags = null) { return this.query(x, z, r, ignoreTags).length === 0; }
}
