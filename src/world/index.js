// Builds the full world by running each module's build(engine) in dependency order.
// Order matters: terrain → water → architecture (registers footprints, slots) → statues/ships → city →
// vegetation & props (avoid footprints, read slots) → marine (reads coral/kelp slots, sunken) → sky.
export const MODULE_ORDER = [
  'terrain',     // ground mesh: citadel hill, ring faces, plain, mountains, islands, sea bed; sunken sand
  'water',       // golden water surfaces + cascades/fountains; sunken surface (from below / above)
  'temple',      // Temple of Poseidon, citadel palaces & small temples (+ shared stone/metal materials)
  'rings',       // ring walls + cladding, quays, towers, tunnel, ship-sheds, moles, lighthouses
  'bridges',     // ring bridges + gate towers, the great gate bridge over the canal
  'city',        // houses, palaces, streets, racecourse, outer city
  'statues',     // chariot group, Nereids on dolphins, colossus, kings, small statues (+ ruined versions)
  'ships',       // triremes and boats; sunken wrecks
  'sets',        // shot-specific hero foregrounds (stair top, garden terrace, fallen-head set)
  'vegetation',  // palms, cypress, pines, olives, shrubs (golden)
  'props',       // banners, braziers, urns, planters, bougainvillea, lotus, mosaics (golden; sunken remnants)
  'marine',      // corals, sea fans, sponges, kelp, sea grass, fish schools, manta, turtle (sunken)
  'clouds',      // sky clouds, mountain cloud banks
  'birds',       // gulls (golden)
];
export async function buildWorld(engine) {
  const skip = (engine.params.get('skip') || '').split(',').filter(Boolean);
  const only = (engine.params.get('only') || '').split(',').filter(Boolean);
  for (const name of MODULE_ORDER) {
    if (skip.includes(name) || (only.length && !only.includes(name))) continue;
    let mod;
    try { mod = await import(`../modules/${name}.js`); } catch (e) {
      if (String(e).includes('Failed to fetch') || String(e).includes('404')) { console.log(`[world] module ${name}: not present`); continue; }
      console.error(`[world] module ${name} failed to load:`, e.stack || e); continue;
    }
    if (typeof mod.build !== 'function') continue;
    const t0 = performance.now();
    const before = new Set(engine.scene.children);
    try {
      await mod.build(engine);
      (engine.moduleRoots ||= {})[name] = engine.scene.children.filter((c) => !before.has(c));
      console.log(`[world] ${name} built in ${Math.round(performance.now() - t0)} ms`);
    } catch (e) { console.error(`[world] module ${name} threw during build:`, e.stack || e); }
  }
}
