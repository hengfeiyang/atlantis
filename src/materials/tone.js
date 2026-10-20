// r7 (citadel): per-shot material tone, shared by every stone / metal / statue-metal material.
// OWNER: citadel (materials). Identity by default (no change in any shot); a shot can push the albedos without
// touching the grade: warmer pale stone where it faces the sun, stone chroma, gold / gilt / orichalcum hue +
// chroma and polish. Set from engine.onShot in src/modules/temple.js (SHOT_TONE table there).
//
//   TONE.uToneSun     world direction toward the sun (shared with core/lighting SUN.dir)
//   TONE.uStoneWarm   vec3 multiplier on pale stone (luma > ~0.12) facing the sun (1,1,1 = off)
//   TONE.uStoneShade  vec3 multiplier on pale stone turned away from the sun (sky-lit side; 1,1,1 = off)
//   TONE.uStoneSat    stone chroma factor (1 = off), mostly on the coloured / dark stones (pale marble 20 %)
//   TONE.uGoldTint    vec3 multiplier on gold / gilt / orichalcum F0 and the statue gilt
//   TONE.uGoldSat     gold chroma factor
//   TONE.uGoldRough   gold roughness factor (< 1 = sharper glints)
//   TONE.uGoldFill    statue-gold reflected-ground fill factor (< 1 = deeper modelling)
import * as THREE from 'three';
import { SUN } from '../core/lighting.js';

export const TONE = {
  uToneSun: { value: SUN.dir },
  uStoneWarm: { value: new THREE.Vector3(1, 1, 1) },
  uStoneShade: { value: new THREE.Vector3(1, 1, 1) },
  uStoneSat: { value: 1 },
  uGoldTint: { value: new THREE.Vector3(1, 1, 1) },
  uGoldSat: { value: 1 },
  uGoldRough: { value: 1 },
  uGoldFill: { value: 1 },
};

export const TONE_DEFAULTS = { uStoneWarm: [1, 1, 1], uStoneShade: [1, 1, 1], uStoneSat: 1, uGoldTint: [1, 1, 1], uGoldSat: 1, uGoldRough: 1, uGoldFill: 1 };

/** apply a partial tone ({uStoneWarm:[r,g,b], uGoldSat: 1.2, ...}); missing keys reset to the defaults */
export function setTone(t = {}) {
  for (const [k, d] of Object.entries(TONE_DEFAULTS)) {
    const v = t[k] ?? d;
    if (Array.isArray(v)) TONE[k].value.set(v[0], v[1], v[2]); else TONE[k].value = v;
  }
}

export const TONE_HEAD = /* glsl */ `
uniform vec3 uToneSun; uniform vec3 uStoneWarm; uniform vec3 uStoneShade; uniform float uStoneSat;
uniform vec3 uGoldTint; uniform float uGoldSat; uniform float uGoldRough; uniform float uGoldFill;
vec3 cgToneGold(vec3 c){ float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return clamp(mix(vec3(l), c, uGoldSat) * uGoldTint, 0.0, 1.0); }
`;
