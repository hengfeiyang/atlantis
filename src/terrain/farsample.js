// Far grid registration for heightAt() (no three.js: main thread, workers, node).
// The grid is { x0, z0, cell, nx, nz, data: Float32Array } (eroded far field, farfield.js); heightAt()
// uses it beyond r = 2200 m. Outside the grid the analytic far field is used, without mountains (the
// grid's border fade already removed them), so both agree.
import { setFarGrid } from '../world/heightfield.js';
import { setAnalyticMountains } from './shape.js';

export function withSampler(g) {
  const { x0, z0, cell, nx, nz, data } = g;
  const inv = 1 / cell;
  return {
    x0, z0, cell, nx, nz, data,
    sample(x, z) {
      const fx = (x - x0) * inv, fz = (z - z0) * inv;
      if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return null;
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
      const o = j * nx + i;
      return (data[o] * (1 - tx) + data[o + 1] * tx) * (1 - tz) + (data[o + nx] * (1 - tx) + data[o + nx + 1] * tx) * tz;
    },
  };
}
/** register the far grid with heightAt(); returns the sampler object */
export function registerFarGrid(g) {
  const s = withSampler(g);
  setFarGrid(s);
  setAnalyticMountains(false);
  return s;
}
