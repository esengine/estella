import { create } from 'zustand';
import { SceneStore } from '@/engine/SceneStore';
import type { EntityId } from '@/types';

/**
 * Entity selection — engine-anchored.
 *
 * Selection holds ids, but the entities live in the engine World, so a selected
 * id can be destroyed out from under us (delete, undo-of-create, scene teardown).
 * Instead of scattering defensive `select(null)` after every such op, this store
 * listens for entity despawns and drops the dead id by hand — selection
 * self-heals, and stale-selection bugs become structurally impossible.
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

export const useSelection = create<SelectionState>((set) => ({
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

// Engine-anchored self-healing: when an entity is despawned (delete, undo-of-create,
// scene teardown), drop it from the selection by id — no manual deselect, no
// validity race. Wholesale scene swaps (open project, play-stop) still call
// select(null) explicitly, since ids can be reused by the incoming scene.
SceneStore.onEntityDespawn((id) => useSelection.getState().dropId(id));
