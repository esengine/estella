// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createStore } from 'zustand/vanilla';
import { note } from '@/diagnostics/timeline';

/**
 * Editor undo/redo. One user gesture (a field edit, a drag, a future add/delete)
 * = one entry. Mutations are applied live through `EngineHost`; the gesture's
 * owner captures before/after and calls {@link record} so the pair becomes
 * undoable without re-running the forward closure. Panels subscribe for
 * undo/redo availability.
 *
 * The scene AND every AssetDocument editor share one history (one Ctrl+Z), so
 * entries carry a document identity: `doc` is null for scene entries and the
 * owning AssetDocument's docId otherwise. That identity is what lets a document
 * purge ONLY its own stale steps when its file is replaced or closed
 * ({@link purgeDoc}), and lets a scene switch keep asset-doc steps alive
 * ({@link clearScene}) — asset snapshots reference no scene entities.
 */
const HISTORY_LIMIT = 200;

interface HistoryOp {
  forward(): void;
  reverse(): void;
}

interface HistoryEntry {
  /** Unique per edit — drives saved-point dirty tracking (see isDirty). */
  id: number;
  label: string;
  /** Owning document: null = the scene, else an AssetDocument docId. */
  doc: string | null;
  ops: HistoryOp[];
  changes: readonly HistoryChange[];
}

/**
 * What a recorded step did, in terms someone can read back.
 *
 * The ops themselves are opaque closures — they can undo an edit but cannot say
 * what it was — so a step that wants to be reviewable declares it. Optional by
 * design: a gesture with nothing worth naming records none, and the stack still
 * works exactly as before.
 *
 * `name` is captured AT RECORD TIME because the point of reading this back is
 * often that the entity is gone.
 */
export interface HistoryChange {
  kind: 'add' | 'remove' | 'modify';
  /** Scene-source entity id (the id the Outliner and tools speak in). */
  entity: number;
  name: string;
  component?: string;
  field?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * A point the stack can be rolled back to in one action — an agent turn's
 * "before", so the user reverts a whole conversation turn with one gesture
 * while each tool call it made stays its own ordinary undo step.
 *
 * It records the SEQUENCE COUNTER, not the head entry or a depth. Ids only ever
 * increase, so "recorded after this mark" is exactly `id > seq` — which needs no
 * lookup, cannot be invalidated by a purge or by scrolling past HISTORY_LIMIT,
 * and stays correct when the stack was empty at mark time. A mark holding the
 * head entry instead would have all three problems.
 */
/**
 * One line of what a step touched, for the crash timeline: how many entities and
 * which components, never a name or a value. The timeline is kept unredacted, so
 * what goes into it has to be safe by construction rather than by a later pass.
 */
/** `undo`, or `undo modify×1 Transform` when the step said what it touched. */
function joinDetail(verb: string, shape: string | undefined): string {
  return shape ? `${verb} ${shape}` : verb;
}

function describeChanges(changes: readonly HistoryChange[]): string | undefined {
  if (changes.length === 0) return undefined;
  const kinds = new Map<string, number>();
  const components = new Set<string>();
  for (const c of changes) {
    kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
    if (c.component) components.add(c.component);
  }
  const parts = [...kinds].map(([k, n]) => `${k}×${n}`);
  if (components.size > 0) parts.push([...components].sort().join('+'));
  return parts.join(' ');
}

export interface HistoryMark {
  readonly seq: number;
}

export class EditorHistoryImpl {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private seq = 0;
  private readonly store = createStore<{ version: number }>(() => ({ version: 0 }));

  // Dirty is scene-scoped: dirty ⇔ newest SCENE entry id ≠ the id at the last
  // save. Ids (not depth) make undo-back-to-save clean while a fresh edit at
  // the same depth stays dirty (UE semantics). Asset-doc entries don't count —
  // each AssetDocument tracks its own `_dirty` for the DirtyRegistry.
  private savedHead: number | null = null;

  private sceneHead(): number | null {
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      if (this.undoStack[i].doc === null) return this.undoStack[i].id;
    }
    return null;
  }

  // While a group is open, record/run/batch append here instead of committing —
  // the whole gesture lands as ONE entry when the group closes.
  private groupOps: HistoryOp[] | null = null;

  // Declared by the gesture's owner before it commits; a group accumulates them
  // across its inner records, since those do not commit on their own.
  private pendingChanges: HistoryChange[] = [];

  /**
   * Say what the step about to be recorded actually did. Call before the
   * `record`/`run` that commits it; inside a `group`, calls accumulate until the
   * group closes.
   */
  describe(...changes: HistoryChange[]): void {
    this.pendingChanges.push(...changes);
  }

  private commit(label: string, ops: HistoryOp[], doc: string | null): void {
    if (ops.length === 0) {
      this.pendingChanges.length = 0;
      return;
    }
    const changes = this.pendingChanges;
    this.pendingChanges = [];
    this.undoStack.push({ id: ++this.seq, label, doc, ops, changes });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    // The run-up to a crash, recorded where every edit already converges. What
    // is noted is the SHAPE — kinds and components, never a name or a value —
    // because this line is kept whether or not the report is ever redacted.
    note('edit', label, describeChanges(changes));
    this.bump();
  }

  /** Register an already-applied mutation as one undo step (forward NOT run). */
  record(label: string, forward: () => void, reverse: () => void, doc: string | null = null) {
    if (this.groupOps) {
      this.groupOps.push({ forward, reverse });
      return;
    }
    this.commit(label, [{ forward, reverse }], doc);
  }

  /** Apply a not-yet-applied mutation and record it (forward runs now). */
  run(label: string, forward: () => void, reverse: () => void, doc: string | null = null) {
    if (this.groupOps) {
      forward();
      this.groupOps.push({ forward, reverse });
      return;
    }
    forward();
    this.commit(label, [{ forward, reverse }], doc);
  }

  /** Register several already-applied mutations as ONE undo step (e.g. a
   *  multi-selection add/remove). No-op on an empty op list. */
  batch(label: string, ops: ReadonlyArray<HistoryOp>, doc: string | null = null) {
    if (this.groupOps) {
      this.groupOps.push(...ops);
      return;
    }
    this.commit(label, [...ops], doc);
  }

  /**
   * Run `fn` and collapse every step it records into ONE undo step labeled
   * `label` — the door for multi-selection gestures (delete/duplicate/reparent
   * the whole selection) built from per-entity commands that each record.
   * A nested group folds into the outer one (the outer gesture owns the step).
   */
  group<T>(label: string, fn: () => T): T {
    if (this.groupOps) return fn();
    const ops: HistoryOp[] = [];
    this.groupOps = ops;
    try {
      return fn();
    } finally {
      this.groupOps = null;
      this.batch(label, ops);
    }
  }

  /**
   * `group`, but a throw puts back what `fn` had already done and records
   * nothing.
   *
   * The difference is who is watching. A UI gesture that fails mid-way leaves
   * the user looking at the result with undo one keystroke away, so `group`
   * keeps the partial work. A program applied over a socket has no such reader:
   * its caller is told the batch failed and reasonably believes the scene is
   * untouched, so a half-built subtree is a lie that outlives the error.
   */
  atomic<T>(label: string, fn: () => T): T {
    if (this.groupOps) return fn(); // nested: the outer owner decides the step
    const ops: HistoryOp[] = [];
    this.groupOps = ops;
    try {
      const out = fn();
      this.groupOps = null;
      this.batch(label, ops);
      return out;
    } catch (e) {
      this.groupOps = null;
      // LIFO, exactly as undoing this entry would, then drop it entirely.
      for (let i = ops.length - 1; i >= 0; i--) {
        try {
          ops[i].reverse();
        } catch (err) {
          console.warn(`[history] rollback op ${i} of "${label}" threw`, err);
        }
      }
      throw e;
    }
  }

  // Ops run per-direction under try/catch — one broken closure must not wedge
  // the rest of the entry (matches the engine TransactionManager this replaced).
  private static apply(entry: HistoryEntry, dir: 'undo' | 'redo'): void {
    if (dir === 'undo') {
      // LIFO so ops can depend on the state left by earlier ops in the entry.
      for (let i = entry.ops.length - 1; i >= 0; i--) {
        try {
          entry.ops[i].reverse();
        } catch (e) {
          console.warn(`[history] undo op ${i} of "${entry.label}" threw`, e);
        }
      }
    } else {
      for (let i = 0; i < entry.ops.length; i++) {
        try {
          entry.ops[i].forward();
        } catch (e) {
          console.warn(`[history] redo op ${i} of "${entry.label}" threw`, e);
        }
      }
    }
  }

  /** Take a checkpoint here — see {@link HistoryMark}. Records nothing. */
  mark(): HistoryMark {
    return { seq: this.seq };
  }

  /**
   * Steps still on the stack that were recorded after `mark`. Zero means the
   * turn changed nothing (or its steps were already undone), which is what the
   * caller checks before offering a revert.
   */
  stepsSince(mark: HistoryMark): number {
    return this.undoStack.length - this.after(mark.seq);
  }

  /**
   * First index on the stack recorded after `seq`.
   *
   * Ids only ever grow (push assigns `++seq`, undo pops the newest, the limit
   * drops the oldest), so a run's window is FOUND rather than scanned for.
   * Worth the binary search because the transcript reads this for every run it
   * shows, on every render — which, while a reply streams, is once per token.
   */
  private after(seq: number): number {
    let lo = 0;
    let hi = this.undoStack.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.undoStack[mid].id > seq) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /**
   * Undo every step recorded after `mark`, newest first, and return how many.
   * They land on the redo stack as usual, so the whole turn can be brought back.
   *
   * The stack is linear, so this also reverts anything the USER did after the
   * mark — there is no out-of-order undo to offer instead. The caller is
   * expected to stop offering the revert once its own steps are no longer the
   * newest, which {@link stepsSince} plus a version bump is enough to detect.
   */
  /**
   * What every step in `(from, until]` declared, oldest first — the review of an
   * agent turn. Steps that declared nothing contribute nothing, so this is a
   * FLOOR on what happened rather than a claim to be the whole of it. Reads the
   * undo stack, so an undone step stops being listed.
   *
   * `until` is what makes it a RUN's changes rather than "everything since": for
   * any run but the newest, the steps after it belong to the runs that followed
   * and to whatever the user did in between. Omit it only for the newest.
   */
  changesSince(mark: HistoryMark, until?: HistoryMark | null): HistoryChange[] {
    const out: HistoryChange[] = [];
    for (let i = this.after(mark.seq); i < this.undoStack.length; i++) {
      const entry = this.undoStack[i];
      if (until && entry.id > until.seq) break;
      out.push(...entry.changes);
    }
    return out;
  }

  undoToMark(mark: HistoryMark): number {
    let n = 0;
    while (this.undoStack.length && this.undoStack[this.undoStack.length - 1].id > mark.seq) {
      const entry = this.undoStack.pop()!;
      EditorHistoryImpl.apply(entry, 'undo');
      this.redoStack.push(entry);
      n++;
    }
    // One notification for the whole rollback: this is a single user gesture,
    // and bumping per entry would re-render every panel N times.
    if (n) this.bump();
    return n;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    EditorHistoryImpl.apply(entry, 'undo');
    this.redoStack.push(entry);
    // WHICH step was undone, not just that undo happened: a report showing
    // "undo" with no subject cannot be replayed or even read, and the command
    // itself has no way to know what it reached.
    note('edit', entry.label, joinDetail('undo', describeChanges(entry.changes)));
    this.bump();
  }
  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    EditorHistoryImpl.apply(entry, 'redo');
    this.undoStack.push(entry);
    note('edit', entry.label, joinDetail('redo', describeChanges(entry.changes)));
    this.bump();
  }
  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }
  undoLabel(): string | null {
    return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : null;
  }
  redoLabel(): string | null {
    return this.redoStack.length ? this.redoStack[this.redoStack.length - 1].label : null;
  }

  /** Drop every entry (all documents) — project switch / hard reset. */
  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.savedHead = null;
    this.bump();
  }

  /**
   * Drop the SCENE's entries and reset its clean baseline (scene load / new
   * scene). Asset-doc entries survive: their snapshot closures reference only
   * their document, and wiping them would orphan those documents' unsaved edits.
   */
  clearScene() {
    this.purge(null);
    this.savedHead = null;
    this.bump();
  }

  /**
   * Drop one document's entries from both stacks — called when that document
   * opens another file or closes, so a later Ctrl+Z can't replay its stale
   * snapshots into whatever the document shows next.
   */
  purgeDoc(doc: string) {
    if (this.purge(doc)) this.bump();
  }

  private purge(doc: string | null): boolean {
    const keep = (e: HistoryEntry) => e.doc !== doc;
    const nextUndo = this.undoStack.filter(keep);
    const nextRedo = this.redoStack.filter(keep);
    const changed = nextUndo.length !== this.undoStack.length || nextRedo.length !== this.redoStack.length;
    this.undoStack.length = 0;
    this.undoStack.push(...nextUndo);
    this.redoStack.length = 0;
    this.redoStack.push(...nextRedo);
    return changed;
  }

  /** Mark the current state as saved — the dirty star clears until the next edit. */
  markSaved() {
    this.savedHead = this.sceneHead();
    this.bump();
  }
  /** True when the SCENE has unsaved edits relative to the last save / load. */
  isDirty = (): boolean => this.sceneHead() !== this.savedHead;

  private bump() {
    this.store.setState((s) => ({ version: s.version + 1 }));
  }
  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getVersion = (): number => this.store.getState().version;
}

/** The app's default-session history. Other sessions construct their own EditorHistoryImpl. */
export const EditorHistory = new EditorHistoryImpl();
