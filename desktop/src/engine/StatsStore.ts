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
  private snapshot: StatsSnapshot = { fps: 0, entities: 0, cursor: null };
  private readonly listeners = new Set<() => void>();

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
        const entities = EngineHost.app?.world.getAllEntities().length ?? 0;
        this.frames = 0;
        this.windowStart = t;
        if (fps !== this.snapshot.fps || entities !== this.snapshot.entities) {
          this.emit({ ...this.snapshot, fps, entities });
        }
      }
    };
    requestAnimationFrame(loop);
  }

  /** Report the viewport cursor world position (rounded; ignores no-op moves). */
  setCursor(x: number, y: number) {
    const cx = Math.round(x);
    const cy = Math.round(y);
    const cur = this.snapshot.cursor;
    if (cur && cur.x === cx && cur.y === cy) return;
    this.emit({ ...this.snapshot, cursor: { x: cx, y: cy } });
  }

  clearCursor() {
    if (this.snapshot.cursor) this.emit({ ...this.snapshot, cursor: null });
  }

  private emit(next: StatsSnapshot) {
    this.snapshot = next;
    for (const l of this.listeners) l();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): StatsSnapshot => this.snapshot;
}

export const StatsStore = new StatsStoreImpl();
