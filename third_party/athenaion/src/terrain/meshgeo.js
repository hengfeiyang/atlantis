// three.js side of the terrain mesh packing (bake + runtime)
import * as THREE from 'three';

/** LOD plan options per quality (part of the bake hash) */
export const PLAN_OPTS = (qname) => ({ coarseFactor: qname === 'high' ? 1 : 2, K: 5.5, minCell: 1, nearMinCell: 0.5 });

export function packedToGeometry(p) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3, true));
  g.setAttribute('aTer', new THREE.BufferAttribute(p.ter, 4, true));
  g.setAttribute('table', new THREE.BufferAttribute(p.table, 8));
  g.setIndex(new THREE.BufferAttribute(p.index, 1));
  return g;
}
export function geometryToPacked(g) {
  return {
    position: g.attributes.position.array, normal: g.attributes.normal.array, ter: g.attributes.aTer.array,
    table: g.attributes.table.array, index: g.index.array,
  };
}
/** BufferGeometry for one unpacked group (views share the big buffers) */
export function groupGeometry(gr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(gr.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(gr.normal, 3, true));
  g.setAttribute('aTer', new THREE.BufferAttribute(gr.ter, 4, true));
  g.setIndex(new THREE.BufferAttribute(gr.index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
