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
class EditorHistoryImpl {
  private readonly tm = new TransactionManager({ historyLimit: 200 });
  private readonly store = createStore<{ version: number }>(() => ({ version: 0 }));

  /** Register an already-applied mutation as one undo step (forward NOT run). */
  record(label: string, forward: () => void, reverse: () => void) {
    const tx = this.tm.begin(label);
    tx.addDeferred({ forward, reverse });
    this.tm.commit(tx);
    this.bump();
  }

  /** Apply a not-yet-applied mutation and record it (forward runs now). */
  run(label: string, forward: () => void, reverse: () => void) {
    const tx = this.tm.begin(label);
    tx.add({ forward, reverse });
    this.tm.commit(tx);
    this.bump();
  }

  undo() {
    if (this.tm.undo()) this.bump();
  }
  redo() {
    if (this.tm.redo()) this.bump();
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
    this.bump();
  }

  private bump() {
    this.store.setState((s) => ({ version: s.version + 1 }));
  }
  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getVersion = (): number => this.store.getState().version;
}

export const EditorHistory = new EditorHistoryImpl();
