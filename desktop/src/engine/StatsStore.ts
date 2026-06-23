// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createStore } from 'zustand/vanilla';
import { EngineHost } from './EngineHost';

export interface StatsSnapshot {
  fps: number;
  entities: number;
  cursor: { x: number; y: number } | null;
}

// Live editor telemetry for the status bar: real FPS (measured here), live
// entity count, and the viewport cursor's world position. Updated a few times
// a second (not per frame) to avoid churning the status bar.
class StatsStoreImpl {
  private readonly store = createStore<StatsSnapshot>(() => ({ fps: 0, entities: 0, cursor: null }));

  private running = false;
  private frames = 0;
  private windowStart = 0;

  /** Start the FPS/entity-count sampling loop (idempotent). */
  start() {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.frames += 1;
      if (this.windowStart === 0) this.windowStart = t;
      const elapsed = t - this.windowStart;
      if (elapsed >= 333) {
        const fps = Math.round((this.frames * 1000) / elapsed);
        const entities = EngineHost.world?.getAllEntities().length ?? 0;
        this.frames = 0;
        this.windowStart = t;
        const cur = this.store.getState();
        if (fps !== cur.fps || entities !== cur.entities) {
          this.store.setState({ fps, entities });
        }
      }
    };
    requestAnimationFrame(loop);
  }

  /** Report the viewport cursor world position (rounded; ignores no-op moves). */
  setCursor(x: number, y: number) {
    const cx = Math.round(x);
    const cy = Math.round(y);
    const cur = this.store.getState().cursor;
    if (cur && cur.x === cx && cur.y === cy) return;
    this.store.setState({ cursor: { x: cx, y: cy } });
  }

  clearCursor() {
    if (this.store.getState().cursor) this.store.setState({ cursor: null });
  }

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): StatsSnapshot => this.store.getState();
}

export const StatsStore = new StatsStoreImpl();
