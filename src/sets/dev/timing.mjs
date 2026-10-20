const m = await import('../poseidonHead.js');
for (const c of (process.argv[2] || '0.04').split(',').map(Number)) {
  let t = Date.now(); const g = m.buildHeadGeometry({ cell: c, up: [0.811, 0.583, -0.041] }); console.log('head', c, (g.index.count / 3 / 1000).toFixed(0) + 'k tris', Date.now() - t, 'ms');
  t = Date.now(); const k = m.buildCrownGeometry({ cell: c * 0.75, up: [0.811, 0.583, -0.041] }); console.log('crown', (k.index.count / 3 / 1000).toFixed(0) + 'k tris', Date.now() - t, 'ms');
}
