// Tiny worker pool for chunk meshing (falls back to the main thread if workers are unavailable).
import { meshChunk } from './voxel.js';

export class MeshPool {
  constructor(size) {
    this.workers = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    this.ok = typeof Worker !== 'undefined';
    if (!this.ok) return;
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        w.busy = false;
        w.onmessage = (e) => this._done(w, e.data);
        w.onerror = (e) => { console.error('[terrain] worker error', e.message || e); };
        this.workers.push(w);
      }
    } catch (e) {
      console.warn('[terrain] workers unavailable, meshing on the main thread', e);
      this.ok = false;
    }
  }
  /** send the far grid to every worker (copied) */
  async setFar(grid) {
    if (!this.ok || !grid) return;
    await Promise.all(this.workers.map((w) => new Promise((res) => {
      const prev = w.onmessage;
      w.onmessage = (e) => { if (e.data.type === 'far-ok') { w.onmessage = prev; res(); } };
      w.postMessage({ type: 'far', grid: { ...grid, data: grid.data.slice() } });
    })));
  }
  run(job) {
    if (!this.ok) return Promise.resolve().then(() => meshChunk(job));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.queue.push({ id, job });
      this._pump();
    });
  }
  _pump() {
    for (const w of this.workers) {
      if (w.busy || !this.queue.length) continue;
      const t = this.queue.shift();
      w.busy = true;
      w.postMessage(t);
    }
  }
  _done(w, m) {
    w.busy = false;
    const p = this.pending.get(m.id);
    if (p) {
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.r);
    }
    this._pump();
  }
  dispose() { for (const w of this.workers) w.terminate(); this.workers = []; }
}
