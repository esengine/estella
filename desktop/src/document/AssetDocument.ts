// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AssetDocument.ts
 * @brief   Reactive, undoable in-memory asset document — the shared base for
 *          single-file asset editors.
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
import { remapAssetPath } from '@/project/pathRemap';

const clone = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);

export class AssetDocument<T> {
  /** Every constructed document (editor documents are singletons), so a project-
   *  wide event — an asset rename — can reach all open documents at once. */
  private static readonly instances = new Set<AssetDocument<unknown>>();

  static openDocuments(): AssetDocument<unknown>[] {
    return [...AssetDocument.instances].filter((d) => d.isOpen);
  }

  protected _asset: T | null = null;
  protected _filePath: string | null = null;
  protected _dirty = false;
  private readonly store = createStore<{ revision: number }>(() => ({ revision: 0 }));

  /** `docId` tags this document's EditorHistory entries so open/close can purge
   *  ONLY its own stale steps off the shared stack (see EditorHistory.purgeDoc). */
  constructor(readonly docId: string) {
    AssetDocument.instances.add(this as AssetDocument<unknown>);
  }

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
    // A (re)opened file is a fresh document: earlier steps' snapshots belong to
    // the previous content, and replaying them here would clobber the new file.
    EditorHistory.purgeDoc(this.docId);
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

  /**
   * Follow an asset rename/move (`from` → `to`, file or containing folder):
   * without this a later save would write to the OLD path, resurrecting a stale
   * file. Content, dirty state, and undo history are untouched — same document,
   * new file binding. Returns whether this document was affected.
   */
  rebindPath(from: string, to: string): boolean {
    if (this._filePath == null) return false;
    const next = remapAssetPath(this._filePath, from, to);
    if (next == null) return false;
    this._filePath = next;
    this.bump();
    return true;
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
    // Undoing a snapshot step after close would silently resurrect the document.
    EditorHistory.purgeDoc(this.docId);
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
      this.docId,
    );
  }

  /** Register an externally-applied whole-asset change (a live drag's
   *  before/after) as ONE doc-tagged undo step. */
  recordEdit(label: string, before: T, after: T): void {
    EditorHistory.record(
      label,
      () => this.replaceAsset(after),
      () => this.replaceAsset(before),
      this.docId,
    );
  }
}
