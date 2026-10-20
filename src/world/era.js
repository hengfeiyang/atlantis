// Era helpers shared by every module. engine.era is 'golden' | 'sunken' (one era per page load).
import { SUNKEN, SEA_LEVEL } from './layout.js';
import { RNG } from '../core/rng.js';

export const isSunken = (engine) => engine.era === 'sunken';
/** sea surface height for the current era */
export const surfaceY = (engine) => (isSunken(engine) ? SUNKEN.surface : SEA_LEVEL);

/**
 * Deterministic ruin roll: the same `label` always gives the same answer, so a column that is toppled in one
 * render is toppled in every render. p = probability (0..1). Use stable labels like `temple:col:N:7`.
 */
export function ruined(label, p) { return new RNG('ruin:' + label).next() < p; }
/** deterministic random in [0,1) for ruin variations (topple direction, crack seed, ...) */
export function ruinRand(label, k = 0) { const r = new RNG('ruinr:' + label); let v = 0; for (let i = 0; i <= k; i++) v = r.next(); return v; }
