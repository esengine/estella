/**
 * @file    AssetDocument.ts
 * @brief   Reactive, undoable in-memory asset document — the shared base for
 *          single-file asset editors (docs/REARCH_ANIMATION.md L4 / P5).
 *
 * Mirrors the scene's model-authoritative reactivity for ONE asset file: the
 * typed in-memory asset is the source of truth, panels subscribe via
 * `useSyncExternalStore(subscribe, getRevision)` and re-read on each bump, and
 * {@link edit} records one undo step per mutation on the shared EditorHistory.
 *
 * Extracted from the Sequencer's TimelineDocument once it was proven; it carries
 * ONLY the genuinely-generic, in-use core (asset + file binding + dirty + revision
 * + snapshot-undo). Asset-specific state (a timeline's fps/preview-root, a
 * tileset's source image, …) lives in the subclass — the second real consumer
 * (the tileset editor) will reveal any further shared shape, so nothing is
 * speculated here.
 */

import { createStore } from 'zustand/vanilla';
import { EditorHistory } from '@/engine/EditorHistory';

const clone = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);

export class AssetDocument<T> {
  protected _asset: T | null = null;
  protected _filePath: string | null = null;
  protected _dirty = false;
  private readonly store = createStore<{ revision: number }>(() => ({ revision: 0 }));

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getRevision = (): number => this.store.getState().revision;
  protected bump(): void {
    this.store.setState((s) => ({ revision: s.revision + 1 }));
  }

  get asset(): T | null {
    return this._asset;
  }
  get filePath(): string | null {
    return this._filePath;
  }
  get dirty(): boolean {
    return this._dirty;
  }
  get isOpen(): boolean {
    return this._asset !== null;
  }

  /** @internal Subclasses call this from their typed `open()`. */
  protected openAsset(asset: T, filePath: string | null): void {
    this._asset = asset;
    this._filePath = filePath;
    this._dirty = false;
    this.bump();
  }

  /** Replace the asset (after a command mutation); marks dirty by default. */
  replaceAsset(next: T, opts: { dirty?: boolean } = {}): void {
    this._asset = next;
    this._dirty = opts.dirty ?? true;
    this.bump();
  }

  /** Clear the dirty flag after a successful save. */
  markSaved(): void {
    if (this._dirty) {
      this._dirty = false;
      this.bump();
    }
  }

  /** @internal Subclasses call this from their typed `close()`. */
  protected closeAsset(): void {
    this._asset = null;
    this._filePath = null;
    this._dirty = false;
    this.bump();
  }

  /** Apply an undoable mutation as ONE EditorHistory step (whole-asset snapshot). */
  edit(label: string, mutate: (draft: T) => void): void {
    const before = this._asset;
    if (before == null) return;
    const after = clone(before);
    mutate(after);
    this.replaceAsset(after);
    EditorHistory.record(
      label,
      () => this.replaceAsset(after),
      () => this.replaceAsset(before),
    );
  }
}
