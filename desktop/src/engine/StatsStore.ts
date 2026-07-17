// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createStore } from 'zustand/vanilla';
import { getResourceStats } from 'esengine';
import { EngineHost } from './EngineHost';
import { SceneModel } from './SceneModel';
import { useSelection } from '@/store/selectionStore';

/** The lone-selected entity's transform for the status bar (rot in degrees). */
export interface SelTransform {
  x: number;
  y: number;
  rot: number;
}

/** Texture residency for the status bar (bytes; evictable = warm cache). */
export interface VramReadout {
  bytes: number;
  budget: number;
  evictable: number;
}

export interface StatsSnapshot {
  fps: number;
  entities: number;
  /** The transform of the single selected entity, or null (0 or >1 selected). */
  selection: SelTransform | null;
  /** Resident texture memory vs budget, or null before the engine is up. */
  vram: VramReadout | null;
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

/** Sample texture residency from the engine's resource stats, or null. */
function sampleVram(): VramReadout | null {
  const stats = getResourceStats();
  if (!stats) return null;
  return {
    bytes: stats.textureBytes,
    budget: stats.textureBudget,
    evictable: stats.textureEvictableCount,
  };
}

const vramEq = (a: VramReadout | null, b: VramReadout | null): boolean =>
  a === b || (!!a && !!b && a.bytes === b.bytes && a.budget === b.budget && a.evictable === b.evictable);

// Live editor telemetry for the status bar: real FPS (measured here), live
// entity count, and the viewport cursor's world position. Updated a few times
// a second (not per frame) to avoid churning the status bar.
class StatsStoreImpl {
  private readonly store = createStore<StatsSnapshot>(() => ({ fps: 0, entities: 0, selection: null, vram: null }));
  // Pointer-rate churn stays out of the slow-stats subscribers.
  private readonly cursorStore = createStore<{ x: number; y: number } | null>(() => null);
  // The hovered tile cell (coords + id) while painting a tilemap, or null.
  private readonly tileStore = createStore<{ tx: number; ty: number; id: number } | null>(() => null);

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
        const entities = EngineHost.world?.entityCount() ?? 0;
        this.frames = 0;
        this.windowStart = t;
        const cur = this.store.getState();
        const selection = sampleSelection();
        const vram = sampleVram();
        if (fps !== cur.fps || entities !== cur.entities
            || !selEq(selection, cur.selection) || !vramEq(vram, cur.vram)) {
          // Preserve the reference of any field whose value is unchanged, so a
          // leaf that subscribes to only that field (see StatusBar) bails out of
          // re-rendering. Without this, replacing the whole snapshot hands every
          // leaf a fresh object each 333ms tick even when its value held.
          this.store.setState({
            fps,
            entities,
            selection: selEq(selection, cur.selection) ? cur.selection : selection,
            vram: vramEq(vram, cur.vram) ? cur.vram : vram,
          });
        }
      }
    };
    requestAnimationFrame(loop);
  }

  /** Report the viewport cursor world position (rounded; ignores no-op moves). */
  setCursor(x: number, y: number) {
    const cx = Math.round(x);
    const cy = Math.round(y);
    const cur = this.cursorStore.getState();
    if (cur && cur.x === cx && cur.y === cy) return;
    this.cursorStore.setState({ x: cx, y: cy }, true);
  }

  clearCursor() {
    if (this.cursorStore.getState()) this.cursorStore.setState(null, true);
  }

  /** Report the hovered tile cell (tilemap paint), ignoring no-op moves. */
  setTile(tx: number, ty: number, id: number) {
    const cur = this.tileStore.getState();
    if (cur && cur.tx === tx && cur.ty === ty && cur.id === id) return;
    this.tileStore.setState({ tx, ty, id }, true);
  }

  clearTile() {
    if (this.tileStore.getState()) this.tileStore.setState(null, true);
  }

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): StatsSnapshot => this.store.getState();
  subscribeCursor = (fn: () => void): (() => void) => this.cursorStore.subscribe(fn);
  getCursor = (): { x: number; y: number } | null => this.cursorStore.getState();
  subscribeTile = (fn: () => void): (() => void) => this.tileStore.subscribe(fn);
  getTile = (): { tx: number; ty: number; id: number } | null => this.tileStore.getState();
}

export const StatsStore = new StatsStoreImpl();
