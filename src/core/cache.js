// Geometry baking cache. Heavy procedural geometry (hi-res statues, sculpted rocks…) can be
// generated once by node and stored in /generated, then loaded instantly at runtime.
//
//   // in a module (works in browser AND node):
//   import { loadOrBuild } from '../core/cache.js';
//   const geo = await loadOrBuild('athena-A-v3', () => buildAthenaGeometry({ cell: 0.04 }));
//
//   // bake from the command line (runs the same build functions in node and writes generated/*.bin):
//   node tools/bake.mjs statues        → imports src/bake/statues.js and runs its bake()
//
// Bump the name/version string whenever the generator changes, otherwise a stale bake is used.
// If the file is missing, loadOrBuild just builds at runtime (slower, still correct).
import * as THREE from 'three';

const isNode = typeof window === 'undefined';

export function serializeGeometry(geo) {
  const attrs = Object.entries(geo.attributes);
  const header = { attrs: [], index: null };
  const chunks = [];
  let offset = 0;
  const push = (arr) => { const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; } const o = offset; chunks.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)); offset += arr.byteLength; return o; };
  for (const [name, a] of attrs) {
    header.attrs.push({ name, itemSize: a.itemSize, normalized: a.normalized, type: a.array.constructor.name, count: a.array.length, offset: push(a.array) });
  }
  if (geo.index) header.index = { type: geo.index.array.constructor.name, count: geo.index.array.length, offset: push(geo.index.array) };
  const hjson = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + hjson.length + offset + 8);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x47454f31); dv.setUint32(4, hjson.length);
  out.set(hjson, 8);
  let base = 8 + hjson.length; base += (4 - (base % 4)) % 4;
  let o = base;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  dv.setUint32(4, hjson.length);
  return out.slice(0, o).buffer;
}

export function deserializeGeometry(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0) !== 0x47454f31) throw new Error('bad geometry blob');
  const hlen = dv.getUint32(4);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hlen)));
  let base = 8 + hlen; base += (4 - (base % 4)) % 4;
  const T = { Float32Array, Uint32Array, Uint16Array, Int16Array, Int8Array, Uint8Array, Int32Array };
  const geo = new THREE.BufferGeometry();
  for (const a of header.attrs) {
    const C = T[a.type];
    const arr = new C(buf.slice(base + a.offset, base + a.offset + a.count * C.BYTES_PER_ELEMENT));
    geo.setAttribute(a.name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  if (header.index) {
    const C = T[header.index.type];
    geo.setIndex(new THREE.BufferAttribute(new C(buf.slice(base + header.index.offset, base + header.index.offset + header.index.count * C.BYTES_PER_ELEMENT)), 1));
  }
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

/** geometries built while baking (node only): name → BufferGeometry */
export const bakeRegistry = new Map();

export async function loadOrBuild(name, build) {
  if (isNode) { const g = await build(); bakeRegistry.set(name, g); return g; }
  try {
    const res = await fetch(`/generated/${name}.bin`);
    if (res.ok) return deserializeGeometry(await res.arrayBuffer());
  } catch { /* fall through */ }
  console.log(`[cache] ${name} not baked, building at runtime`);
  return build();
}
