// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { create } from 'zustand';
import { SceneModel, SceneModelImpl } from '@/engine/SceneModel';
import { PerfMonitor } from '@/engine/PerfMonitor';
import { authoredRef, type EntityRef } from '@/engine/entityRef';
import type { EntityId, InspectSource } from '@/types';

/**
 * Entity selection — model-anchored.
 *
 * Selection holds a stable **ref** — a source id for anything the document
 * declares (surviving undo/redo recreates, where the runtime World id changes),
 * a realm handle for an entity only the running game has.
 * A selected entity can still be removed out from
 * under us (delete, undo-of-create, scene reload). Instead of scattering
 * defensive `select(null)` after every such op, this store listens for the
 * model's `entityRemoved` event and drops the dead id — selection self-heals, and
 * stale-selection bugs become structurally impossible.
 *
 * `selectedId` is the primary/active entity (drives the Details panel + viewport
 * gizmo); `selectedIds` is the full multi-selection set.
 *
 * The inspector is UNIFIED: selection is either an entity OR an asset (a content
 * path), never both — selecting one clears the other. The Details panel renders
 * whichever is active (entity → components, asset → asset metadata), so there's a
 * single inspector surface, no duplicate "details" column in the content browser.
 */
interface SelectionState {
  /**
   * What is selected, in whichever world owns it. The document's own entities
   * carry their source id here too, so a selection made in the editor is still
   * the same selection once the game is running.
   */
  selectedRef: EntityRef | null;
  /** The primary selection's SOURCE id — null when the running game spawned it
   *  and the document has no such entity. */
  selectedId: EntityId | null;
  selectedIds: Set<EntityId>;
  /** The PRIMARY selected asset (project-relative path), mutually exclusive with
   *  entities — drives the unified inspector. */
  selectedAsset: string | null;
  /** The full multi-asset selection (Content Browser ctrl/shift-select). Batch
   *  file ops (delete/move) act over this; the inspector shows `selectedAsset`. */
  selectedAssets: Set<string>;
  /** Replace the selection with a single entity (or clear it with null). */
  select: (id: EntityId | null) => void;
  /** Replace the selection with a ref — the door for rows the document doesn't
   *  have (entities the running game spawned). */
  selectRef: (ref: EntityRef | null) => void;
  /** Ctrl/Cmd-click: add/remove one entity from the selection. */
  toggleSelect: (id: EntityId) => void;
  /** Shift-click / box: replace the selection with a set, with a primary. */
  selectMany: (ids: EntityId[], primary: EntityId) => void;
  /** Select an asset (or clear with null); clears any entity selection. */
  selectAsset: (path: string | null) => void;
  /** Ctrl/Cmd-click an asset: add/remove it from the multi-asset selection. */
  toggleAsset: (path: string) => void;
  /** Shift-click / select-all assets: replace the asset set, with a primary. */
  selectAssets: (paths: string[], primary: string) => void;
  /**
   * An editor-context inspection source (the open timeline's clip settings, a
   * track…), shown in Details as a FALLBACK when nothing else is selected — it
   * never overrides an entity/asset/folder. The owning editor sets it on open
   * and clears it (null) on close/unmount.
   */
  inspectSource: InspectSource | null;
  setInspectSource: (src: InspectSource | null) => void;
  /** Remove one id from the selection (despawn self-healing). */
  dropId: (id: EntityId) => void;
  /** Clear a selection only the running realm could resolve (called on Stop). */
  dropSpawnedSelection: () => void;
}

export type SelectionStore = ReturnType<typeof createSelectionStore>;

/**
 * Build a selection store bound to a model. Model-anchored self-healing: when an
 * entity is removed from the model (delete, undo-of-create), it drops from the
 * selection by source id — no manual deselect. Wholesale scene swaps (open
 * project, reload) clear selection explicitly (the bulk path), since source ids
 * restart with the incoming scene. One per EditorSession.
 */
export function createSelectionStore(model: SceneModelImpl) {
  // The one place ref and id are decided together — they are two readings of a
  // single fact, and a setter that updated only one would show the Inspector an
  // entity the Outliner is not highlighting.
  const entityPick = (ids: Set<EntityId>, primary: EntityId | null) => ({
    selectedIds: ids,
    selectedId: primary,
    selectedRef: primary != null ? authoredRef(primary) : null,
    selectedAsset: null,
    selectedAssets: new Set<string>(),
  });
  const noEntity = { selectedId: null, selectedRef: null, selectedIds: new Set<EntityId>() };

  const useStore = create<SelectionState>((set) => ({
    selectedRef: null,
    selectedId: null,
    selectedIds: new Set<EntityId>(),
    selectedAsset: null,
    selectedAssets: new Set<string>(),
    inspectSource: null,
    setInspectSource: (inspectSource) => set({ inspectSource }),

    // 'select' zone captures the synchronous subscriber work a selection triggers.
    select: (selectedId) =>
      PerfMonitor.measure('select', () =>
        set(entityPick(selectedId != null ? new Set([selectedId]) : new Set(), selectedId)),
      ),

    selectRef: (ref) =>
      PerfMonitor.measure('select', () => {
        if (ref == null || ref.world === 'authored') {
          set(entityPick(ref == null ? new Set() : new Set([ref.src]), ref?.src ?? null));
          return;
        }
        // A running-game entity has no document id, so it cannot join the
        // multi-selection the edit commands act on.
        set({
          selectedRef: ref,
          selectedId: null,
          selectedIds: new Set(),
          selectedAsset: null,
          selectedAssets: new Set(),
        });
      }),

    toggleSelect: (id) =>
      PerfMonitor.measure('select', () =>
        set((s) => {
          const next = new Set(s.selectedIds);
          if (next.has(id)) {
            next.delete(id);
            const primary =
              s.selectedId === id ? (next.size ? [...next][next.size - 1] : null) : s.selectedId;
            return entityPick(next, primary);
          }
          next.add(id);
          return entityPick(next, id);
        }),
      ),

    selectMany: (ids, primary) =>
      PerfMonitor.measure('select', () => set(entityPick(new Set(ids), primary))),

    // Selecting an asset clears any entity selection (mutually exclusive).
    selectAsset: (selectedAsset) =>
      PerfMonitor.measure('select', () =>
        set({ selectedAsset, selectedAssets: selectedAsset ? new Set([selectedAsset]) : new Set(), ...noEntity })),

    toggleAsset: (path) =>
      PerfMonitor.measure('select', () =>
        set((s) => {
          const next = new Set(s.selectedAssets);
          if (next.has(path)) {
            next.delete(path);
            const primary =
              s.selectedAsset === path ? (next.size ? [...next][next.size - 1] : null) : s.selectedAsset;
            return { selectedAssets: next, selectedAsset: primary, ...noEntity };
          }
          next.add(path);
          return { selectedAssets: next, selectedAsset: path, ...noEntity };
        }),
      ),

    selectAssets: (paths, primary) =>
      PerfMonitor.measure('select', () => set({ selectedAssets: new Set(paths), selectedAsset: primary, ...noEntity })),

    dropId: (id) =>
      set((s) => {
        if (s.selectedId !== id && !s.selectedIds.has(id)) return s;
        const next = new Set(s.selectedIds);
        next.delete(id);
        const primary =
          s.selectedId === id ? (next.size ? [...next][next.size - 1] : null) : s.selectedId;
        return { selectedIds: next, selectedId: primary, selectedRef: primary != null ? authoredRef(primary) : null };
      }),

    dropSpawnedSelection: () =>
      set((s) => (s.selectedRef?.world === 'spawned' ? { selectedRef: null } : s)),
  }));

  model.subscribe((ev) => {
    if (ev.kind === 'entityRemoved') useStore.getState().dropId(ev.sourceId);
  });

  return useStore;
}

/** The app's default-session selection. Other sessions build their own via createSelectionStore. */
export const useSelection = createSelectionStore(SceneModel);
