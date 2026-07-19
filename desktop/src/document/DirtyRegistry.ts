// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DirtyRegistry.ts
 * @brief   Aggregate unsaved-changes surface over every open editor document.
 *
 * The scene tracks dirty via EditorHistory; each AssetDocument editor (tileset,
 * flipbook, FSM, BT, material graph, …) tracks its own private `_dirty`. The
 * quit guard, the discard guard, and quit-save must see ALL of them, so each
 * document registers a {isDirty, save} pair here and the guards ask the
 * registry instead of one document. Built-in documents register in
 * `dirtyDocs.ts`; transient editors (the .meta importer inspector) register
 * while mounted.
 */

export interface DirtyDocument {
  /** Stable id; re-registering the same id replaces the previous entry. */
  id: string;
  isDirty(): boolean;
  /** Persist the document. Called on quit-save only when {@link isDirty}. */
  save(): Promise<void>;
  /** Change feed, so the aggregate dirty state can push to the quit guard. */
  subscribe?(fn: () => void): () => void;
}

class DirtyRegistryImpl {
  private readonly docs = new Map<string, { doc: DirtyDocument; unsub: (() => void) | null }>();
  private readonly listeners = new Set<() => void>();

  /** Register a document; returns its unregister. */
  register(doc: DirtyDocument): () => void {
    this.docs.get(doc.id)?.unsub?.();
    const unsub = doc.subscribe?.(() => this.bump()) ?? null;
    this.docs.set(doc.id, { doc, unsub });
    this.bump();
    return () => {
      const cur = this.docs.get(doc.id);
      if (cur?.doc !== doc) return; // replaced meanwhile — the newer entry owns the id
      cur.unsub?.();
      this.docs.delete(doc.id);
      this.bump();
    };
  }

  /** True when ANY registered document has unsaved changes. */
  isDirty(): boolean {
    for (const { doc } of this.docs.values()) if (doc.isDirty()) return true;
    return false;
  }

  /** Save every dirty document (sequentially; a failure aborts and rethrows so
   *  the caller never reports a clean quit over lost edits). */
  async saveAll(): Promise<void> {
    for (const { doc } of [...this.docs.values()]) {
      if (doc.isDirty()) await doc.save();
    }
  }

  /** Notify subscribers that some document's dirty state may have changed —
   *  for documents without their own subscribe feed. */
  bump(): void {
    for (const fn of [...this.listeners]) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** @internal Test hook — drop every registration. */
  clearAll(): void {
    for (const { unsub } of this.docs.values()) unsub?.();
    this.docs.clear();
    this.bump();
  }
}

export const DirtyRegistry = new DirtyRegistryImpl();
