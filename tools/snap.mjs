// Client for tools/session.mjs. See that file for usage.
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i]; if (!k.startsWith('--')) continue;
  const n = process.argv[i + 1]; if (n === undefined || n.startsWith('--')) args[k.slice(2)] = true; else { args[k.slice(2)] = n; i++; }
}
const PORT = Number(args.port || 9400);
const call = async (ep, body) => {
  // the session may still be building the world: retry the connection for up to 30 min
  let r;
  for (let i = 0; ; i++) {
    try { r = await fetch(`http://127.0.0.1:${PORT}${ep}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined }); break; }
    catch (e) { if (i > 900) throw e; await new Promise((res) => setTimeout(res, 2000)); }
  }
  const j = await r.json();
  if (!r.ok) { console.error(j.error || j); process.exit(1); }
  return j;
};
if (args.quit) { await call('/quit'); console.log('session stopped'); }
else if (args.reload) { await call('/reload'); console.log('session reloaded'); }
else if (args.eval) { const j = await call('/eval', { expr: args.eval }); console.log(JSON.stringify(j.value, null, 1)); }
else if (args.logs) { const j = await call('/logs'); console.log(j.logs.join('\n')); }
else if (args.shots) { const j = await call('/shots'); console.log(JSON.stringify(j.shots, null, 1)); }
else {
  const body = { shot: args.shot, out: args.out, spp: args.spp ? Number(args.spp) : undefined, compare: !args.nocompare };
  if (args.set) body.set = JSON.parse(args.set);
  const j = await call('/render', body);
  console.log(`wrote ${j.out}${j.cmp ? '  compare ' + j.cmp : ''} in ${(j.ms / 1000).toFixed(1)} s  stats ${JSON.stringify(j.stats)}`);
}
