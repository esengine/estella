/**
 * @file    TimelineDocument.ts
 * @brief   The open .estimeline as a reactive editor document — the first asset
 *          document session (docs/REARCH_ANIMATION.md L4).
 *
 * Mirrors the scene's model-authoritative reactivity (SceneStore): the in-memory
 * TimelineAsset is the source of truth, panels subscribe via useSyncExternalStore
 * and re-read on each revision bump. Editing commands (P2) mutate the asset and
 * bump; for P1 the document just holds an opened clip + its preview binding.
 *
 * `fps` is editor display metadata (the asset stores time in seconds); the design
 * shows a frame ruler, so the panel converts seconds ↔ frames via this fps.
 */

import { createStore } from 'zustand/vanilla';
import { parseTimelineAsset, type TimelineAsset } from 'esengine';
import type { EntityId } from '@/types';

export interface TimelineDocMeta {
  filePath: string | null;
  fps: number;
  dirty: boolean;
}

// The design's default authoring rate (12 fps). Editor-side only — not persisted
// in the asset, which is frame-rate-independent (keyframe times are seconds).
const DEFAULT_FPS = 12;

function emptyMeta(): TimelineDocMeta {
  return { filePath: null, fps: DEFAULT_FPS, dirty: false };
}

export interface OpenParams {
  asset: TimelineAsset;
  filePath?: string | null;
  fps?: number;
  rootEntity?: EntityId | null;
}

export class TimelineDocumentImpl {
  private _asset: TimelineAsset | null = null;
  private _meta: TimelineDocMeta = emptyMeta();
  private _root: EntityId | null = null;
  private readonly store = createStore<{ revision: number }>(() => ({ revision: 0 }));

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getRevision = (): number => this.store.getState().revision;
  private bump() {
    this.store.setState((s) => ({ revision: s.revision + 1 }));
  }

  get asset(): TimelineAsset | null {
    return this._asset;
  }
  get meta(): TimelineDocMeta {
    return this._meta;
  }
  get rootEntity(): EntityId | null {
    return this._root;
  }
  get isOpen(): boolean {
    return this._asset !== null;
  }

  /** Open an already-parsed timeline asset, optionally bound to a preview entity. */
  open(params: OpenParams): void {
    this._asset = params.asset;
    this._meta = {
      filePath: params.filePath ?? null,
      fps: params.fps ?? DEFAULT_FPS,
      dirty: false,
    };
    this._root = params.rootEntity ?? null;
    this.bump();
  }

  /** Open from raw .estimeline JSON (parsed + migrated by the SDK loader). */
  openJson(raw: unknown, params: Omit<OpenParams, 'asset'> = {}): void {
    this.open({ asset: parseTimelineAsset(raw), ...params });
  }

  /** Rebind which scene entity the timeline previews against (its root). */
  setRootEntity(id: EntityId | null): void {
    this._root = id;
    this.bump();
  }

  /** Set the editor display frame rate (view metadata; not persisted in the asset). */
  setFps(fps: number): void {
    const next = Math.max(1, Math.round(fps));
    if (next === this._meta.fps) return;
    this._meta = { ...this._meta, fps: next };
    this.bump();
  }

  /** Clear the dirty flag after a successful save. */
  markSaved(): void {
    if (!this._meta.dirty) return;
    this._meta = { ...this._meta, dirty: false };
    this.bump();
  }

  /**
   * Replace the asset after a command mutation (P2). Kept distinct from open() so
   * the file binding / fps survive an edit; marks the document dirty by default.
   */
  replaceAsset(next: TimelineAsset, opts: { dirty?: boolean } = {}): void {
    this._asset = next;
    this._meta = { ...this._meta, dirty: opts.dirty ?? true };
    this.bump();
  }

  close(): void {
    this._asset = null;
    this._meta = emptyMeta();
    this._root = null;
    this.bump();
  }
}

/** The app's default timeline document (the one the Sequencer panel drives). */
export const TimelineDocument = new TimelineDocumentImpl();
