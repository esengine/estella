// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createStore } from 'zustand/vanilla';
import { SceneModel, SceneModelImpl, type ModelEvent } from './SceneModel';

/**
 * Reactive mirror of the editor scene — the model-change bus.
 *
 * Model-authoritative data flow: the editor reacts to
 * **model** events, not engine-pushed World mutations. This subscribes to the
 * SceneModel and turns each change into a revision bump; panels subscribe via
 * `useSyncExternalStore` and re-read through SceneQuery (which reads the model).
 *
 *  - `structureRevision` bumps when the tree shape / names / kinds change
 *    (entity add+remove, parent, component add+remove, rename, reset)
 *  - `revision` bumps on any change, incl. component-data field edits
 *
 * (The engine's EditorBridge — the old push source — is retired: the World is a
 * derived projection now, so there is nothing to push back.)
 */
export class SceneStoreImpl {
  private installed = false;
  private suspended = false;
  // A change (and whether any was structural) arrived while suspended.
  private pending: { structural: boolean } | null = null;
  private readonly store = createStore<{ revision: number; structureRevision: number }>(() => ({
    revision: 1,
    structureRevision: 1,
  }));

  constructor(private readonly model: SceneModelImpl) {}

  /** Subscribe to the model as the change source. Idempotent. */
  install() {
    if (this.installed) return;
    this.installed = true;
    this.model.subscribe((ev) => this.bump(isStructural(ev)));
  }

  private bump(structural: boolean) {
    if (this.suspended) {
      // Coalesce: hold the bump (remembering if anything was structural) so a
      // high-frequency gesture doesn't re-render React panels every mutation.
      this.pending = { structural: (this.pending?.structural ?? false) || structural };
      return;
    }
    this.store.setState((s) => ({
      revision: s.revision + 1,
      structureRevision: structural ? s.structureRevision + 1 : s.structureRevision,
    }));
  }

  /**
   * Pause reactivity bumps during a high-frequency gesture (a viewport transform
   * drag): React panels (Details, Outliner…) stop re-rendering until {@link resume}.
   * The World stays live — the Reconciler subscribes to the model DIRECTLY, not
   * through this store — and the status-bar readout samples on its own timer, so
   * only the (potentially expensive) inspector re-render is deferred. Idempotent.
   */
  suspend = (): void => { this.suspended = true; };

  /** End the gesture: flush a single coalesced bump if anything changed. Safe to
   *  call when not suspended (no-op) so a missed pair can't wedge the panels off. */
  resume = (): void => {
    if (!this.suspended) return;
    this.suspended = false;
    const p = this.pending;
    this.pending = null;
    if (p) this.bump(p.structural);
  };

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getRevision = (): number => this.store.getState().revision;
  getStructureRevision = (): number => this.store.getState().structureRevision;

  /** Derived-from-runtime state changed without a model event (e.g. a spine
   *  skeleton finished loading, so the inspector's animation/skin options
   *  exist now) — bump the data revision so panels re-read. */
  poke = (): void => this.bump(false);
}

/** A change affects the tree (shape / name / kind / add-menu), not just a field value. */
function isStructural(ev: ModelEvent): boolean {
  return ev.kind !== 'componentChanged';
}

/** The app's default-session store. Other sessions construct their own SceneStoreImpl(model). */
export const SceneStore = new SceneStoreImpl(SceneModel);
