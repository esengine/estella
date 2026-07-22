// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { create } from 'zustand';
import { SceneModel, SceneModelImpl } from '@/engine/SceneModel';
import { PerfMonitor } from '@/engine/PerfMonitor';
import type { EntityId, InspectSource } from '@/types';

/**
 * Entity selection — model-anchored.
 *
 * Selection holds stable **source ids** (they survive undo/redo recreates, where
 * the runtime World id changes). A selected entity can still be removed out from
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
  const useStore = create<SelectionState>((set) => ({
    selectedId: null,
    selectedIds: new Set<EntityId>(),
    selectedAsset: null,
    selectedAssets: new Set<string>(),
    inspectSource: null,
    setInspectSource: (inspectSource) => set({ inspectSource }),

    // 'select' zone captures the synchronous subscriber work a selection triggers.
    select: (selectedId) =>
      PerfMonitor.measure('select', () =>
        set({
          selectedId,
          selectedIds: selectedId != null ? new Set([selectedId]) : new Set(),
          selectedAsset: null,
          selectedAssets: new Set(),
        }),
      ),

    toggleSelect: (id) =>
      PerfMonitor.measure('select', () =>
        set((s) => {
          const next = new Set(s.selectedIds);
          if (next.has(id)) {
            next.delete(id);
            const primary =
              s.selectedId === id ? (next.size ? [...next][next.size - 1] : null) : s.selectedId;
            return { selectedIds: next, selectedId: primary, selectedAsset: null, selectedAssets: new Set() };
          }
          next.add(id);
          return { selectedIds: next, selectedId: id, selectedAsset: null, selectedAssets: new Set() };
        }),
      ),

    selectMany: (ids, primary) =>
      PerfMonitor.measure('select', () => set({ selectedIds: new Set(ids), selectedId: primary, selectedAsset: null, selectedAssets: new Set() })),

    // Selecting an asset clears any entity selection (mutually exclusive).
    selectAsset: (selectedAsset) =>
      PerfMonitor.measure('select', () =>
        set({ selectedAsset, selectedAssets: selectedAsset ? new Set([selectedAsset]) : new Set(), selectedId: null, selectedIds: new Set() })),

    toggleAsset: (path) =>
      PerfMonitor.measure('select', () =>
        set((s) => {
          const next = new Set(s.selectedAssets);
          if (next.has(path)) {
            next.delete(path);
            const primary =
              s.selectedAsset === path ? (next.size ? [...next][next.size - 1] : null) : s.selectedAsset;
            return { selectedAssets: next, selectedAsset: primary, selectedId: null, selectedIds: new Set() };
          }
          next.add(path);
          return { selectedAssets: next, selectedAsset: path, selectedId: null, selectedIds: new Set() };
        }),
      ),

    selectAssets: (paths, primary) =>
      PerfMonitor.measure('select', () => set({ selectedAssets: new Set(paths), selectedAsset: primary, selectedId: null, selectedIds: new Set() })),

    dropId: (id) =>
      set((s) => {
        if (s.selectedId !== id && !s.selectedIds.has(id)) return s;
        const next = new Set(s.selectedIds);
        next.delete(id);
        const primary =
          s.selectedId === id ? (next.size ? [...next][next.size - 1] : null) : s.selectedId;
        return { selectedIds: next, selectedId: primary };
      }),
  }));

  model.subscribe((ev) => {
    if (ev.kind === 'entityRemoved') useStore.getState().dropId(ev.sourceId);
  });

  return useStore;
}

/** The app's default-session selection. Other sessions build their own via createSelectionStore. */
export const useSelection = createSelectionStore(SceneModel);
