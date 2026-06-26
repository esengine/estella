// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createStore } from 'zustand/vanilla';
import { TransactionManager } from 'esengine';

/**
 * Editor undo/redo, built on the engine's {@link TransactionManager}.
 *
 * One user gesture (a field edit, a drag, a future add/delete) = one entry.
 * Mutations are applied live through `EngineHost`; the gesture's owner captures
 * before/after and calls {@link record} so the pair becomes undoable without
 * re-running the forward closure. Panels subscribe for undo/redo availability.
 */
const HISTORY_LIMIT = 200;

export class EditorHistoryImpl {
  private readonly tm = new TransactionManager({ historyLimit: HISTORY_LIMIT });
  private readonly store = createStore<{ version: number }>(() => ({ version: 0 }));

  // Dirty tracking. `version` bumps on every op (drives subscriptions) but is
  // monotonic, so it can't tell "back at the saved state". Instead each committed
  // edit gets a unique id pushed onto a mirror of the undo stack; `savedHead` is the
  // head id at the last save. dirty ⇔ head id ≠ savedHead — so undoing back to the
  // saved point clears the star (UE semantics), and a fresh edit at the same depth
  // does NOT (its id is new). Capped to the TM history limit so it can't grow
  // unbounded; an evicted saved point just stays dirty (you can't reach it anyway).
  private undoIds: number[] = [];
  private redoIds: number[] = [];
  private seq = 0;
  private savedHead: number | null = null;

  private head(): number | null {
    return this.undoIds.length ? this.undoIds[this.undoIds.length - 1] : null;
  }
  private pushEdit() {
    this.undoIds.push(++this.seq);
    if (this.undoIds.length > HISTORY_LIMIT) this.undoIds.shift();
    this.redoIds.length = 0;
  }

  /** Register an already-applied mutation as one undo step (forward NOT run). */
  record(label: string, forward: () => void, reverse: () => void) {
    const tx = this.tm.begin(label);
    tx.addDeferred({ forward, reverse });
    this.tm.commit(tx);
    this.pushEdit();
    this.bump();
  }

  /** Apply a not-yet-applied mutation and record it (forward runs now). */
  run(label: string, forward: () => void, reverse: () => void) {
    const tx = this.tm.begin(label);
    tx.add({ forward, reverse });
    this.tm.commit(tx);
    this.pushEdit();
    this.bump();
  }

  /** Register several already-applied mutations as ONE undo step (e.g. a
   *  multi-selection add/remove). No-op on an empty op list. */
  batch(label: string, ops: ReadonlyArray<{ forward: () => void; reverse: () => void }>) {
    if (ops.length === 0) return;
    const tx = this.tm.begin(label);
    for (const op of ops) tx.addDeferred(op);
    this.tm.commit(tx);
    this.pushEdit();
    this.bump();
  }

  undo() {
    if (this.tm.undo()) {
      const id = this.undoIds.pop();
      if (id !== undefined) this.redoIds.push(id);
      this.bump();
    }
  }
  redo() {
    if (this.tm.redo()) {
      const id = this.redoIds.pop();
      if (id !== undefined) this.undoIds.push(id);
      this.bump();
    }
  }
  canUndo() {
    return this.tm.canUndo();
  }
  canRedo() {
    return this.tm.canRedo();
  }
  undoLabel(): string | null {
    return this.tm.peekUndo()?.label ?? null;
  }
  redoLabel(): string | null {
    return this.tm.peekRedo()?.label ?? null;
  }
  clear() {
    this.tm.clear();
    // A cleared history is the new clean baseline (scene load / new scene).
    this.undoIds.length = 0;
    this.redoIds.length = 0;
    this.savedHead = null;
    this.bump();
  }

  /** Mark the current state as saved — the dirty star clears until the next edit. */
  markSaved() {
    this.savedHead = this.head();
    this.bump();
  }
  /** True when the document has unsaved edits relative to the last save / load. */
  isDirty = (): boolean => this.head() !== this.savedHead;

  private bump() {
    this.store.setState((s) => ({ version: s.version + 1 }));
  }
  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getVersion = (): number => this.store.getState().version;
}

/** The app's default-session history. Other sessions construct their own EditorHistoryImpl. */
export const EditorHistory = new EditorHistoryImpl();
