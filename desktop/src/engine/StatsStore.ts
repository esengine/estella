// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createStore } from 'zustand/vanilla';
import { EngineHost } from './EngineHost';
import { SceneModel } from './SceneModel';
import { useSelection } from '@/store/selectionStore';

/** The lone-selected entity's transform for the status bar (rot in degrees). */
export interface SelTransform {
  x: number;
  y: number;
  rot: number;
}

export interface StatsSnapshot {
  fps: number;
  entities: number;
  cursor: { x: number; y: number } | null;
  /** The transform of the single selected entity, or null (0 or >1 selected). */
  selection: SelTransform | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Sample the lone selection's transform from the model, or null. */
function sampleSelection(): SelTransform | null {
  const sel = useSelection.getState();
  if (sel.selectedIds.size !== 1 || sel.selectedId == null) return null;
  const e = SceneModel.entityBySource(sel.selectedId);
  const tf = e?.components.find((c) => c.type === 'Transform')?.data as
    | { position?: { x: number; y: number }; rotation?: { w: number; z: number } }
    | undefined;
  if (!tf?.position) return null;
  // 2D rotation lives on Z; recover the angle from the (w, z) quaternion.
  const rot = tf.rotation ? 2 * Math.atan2(tf.rotation.z, tf.rotation.w) * (180 / Math.PI) : 0;
  return { x: round1(tf.position.x), y: round1(tf.position.y), rot: round1(rot) };
}

const selEq = (a: SelTransform | null, b: SelTransform | null): boolean =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.rot === b.rot);

// Live editor telemetry for the status bar: real FPS (measured here), live
// entity count, and the viewport cursor's world position. Updated a few times
// a second (not per frame) to avoid churning the status bar.
class StatsStoreImpl {
  private readonly store = createStore<StatsSnapshot>(() => ({ fps: 0, entities: 0, cursor: null, selection: null }));

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
        const selection = sampleSelection();
        if (fps !== cur.fps || entities !== cur.entities || !selEq(selection, cur.selection)) {
          this.store.setState({ fps, entities, selection });
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
