import { create } from 'zustand';
import { SceneModel, SceneModelImpl } from '@/engine/SceneModel';
import type { EntityId } from '@/types';

/**
 * Entity selection — model-anchored (REARCH_EDITOR_MODEL.md).
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
 */
interface SelectionState {
  selectedId: EntityId | null;
  selectedIds: Set<EntityId>;
  /** Replace the selection with a single entity (or clear it with null). */
  select: (id: EntityId | null) => void;
  /** Ctrl/Cmd-click: add/remove one entity from the selection. */
  toggleSelect: (id: EntityId) => void;
  /** Shift-click / box: replace the selection with a set, with a primary. */
  selectMany: (ids: EntityId[], primary: EntityId) => void;
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

    select: (selectedId) =>
      set({ selectedId, selectedIds: selectedId != null ? new Set([selectedId]) : new Set() }),

    toggleSelect: (id) =>
      set((s) => {
        const next = new Set(s.selectedIds);
        if (next.has(id)) {
          next.delete(id);
          const primary =
            s.selectedId === id ? (next.size ? [...next][next.size - 1] : null) : s.selectedId;
          return { selectedIds: next, selectedId: primary };
        }
        next.add(id);
        return { selectedIds: next, selectedId: id };
      }),

    selectMany: (ids, primary) => set({ selectedIds: new Set(ids), selectedId: primary }),

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
