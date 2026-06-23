// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createStore } from 'zustand/vanilla';
import { SceneModel, SceneModelImpl, type ModelEvent } from './SceneModel';

/**
 * Reactive mirror of the editor scene — the model-change bus.
 *
 * Model-authoritative data flow (REARCH_EDITOR_MODEL.md): the editor reacts to
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
    this.store.setState((s) => ({
      revision: s.revision + 1,
      structureRevision: structural ? s.structureRevision + 1 : s.structureRevision,
    }));
  }

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getRevision = (): number => this.store.getState().revision;
  getStructureRevision = (): number => this.store.getState().structureRevision;
}

/** A change affects the tree (shape / name / kind / add-menu), not just a field value. */
function isStructural(ev: ModelEvent): boolean {
  return ev.kind !== 'componentChanged';
}

/** The app's default-session store. Other sessions construct their own SceneStoreImpl(model). */
export const SceneStore = new SceneStoreImpl(SceneModel);
