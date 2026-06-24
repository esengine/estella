// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  OutlinerController.ts — the outliner's headless view-state.
 *
 * Owns the editor-tree state the SceneModel doesn't: which nodes are expanded and
 * the search query. Kept OUT of the React panel so the tree is testable headless
 * and (later) drivable by EditorControlSurface / the editor MCP — the panel is a
 * thin renderer over this + {@link buildOutlinerItems}.
 *
 * Model-anchored self-healing (mirrors selectionStore): expansion is pruned when
 * an entity is removed (`entityRemoved`) and the whole view resets on a scene swap
 * (`reset`), so the expansion set can never accumulate dead ids. One per
 * EditorSession; the default instance binds the app's SceneModel.
 */
import { create } from 'zustand';
import { SceneModel, SceneModelImpl } from '@/engine/SceneModel';
import type { EntityId } from '@/types';

interface OutlinerState {
  /** Expanded node ids (entity source ids). */
  expanded: Set<EntityId>;
  /** Live name filter (raw text; the builder trims/lowercases). */
  query: string;

  /** Flip one node's expansion. */
  toggleExpanded: (id: EntityId) => void;
  /** Replace the whole expansion set (e.g. first-load auto-expand). */
  setExpanded: (ids: EntityId[]) => void;
  /** Additively expand ids (reveal — keeps existing expansion). */
  expand: (ids: EntityId[]) => void;
  /** Expand every ancestor of an entity so it becomes visible (reveal-on-select). */
  revealEntity: (id: EntityId) => void;
  setQuery: (query: string) => void;

  /** Prune a removed id (self-heal on the model's `entityRemoved`). */
  dropId: (id: EntityId) => void;
  /** Reset the view on a scene swap (the model's `reset`). */
  reset: () => void;
}

/** Build an outliner controller bound to a model. One per EditorSession. */
export function createOutlinerStore(model: SceneModelImpl) {
  const useStore = create<OutlinerState>((set) => ({
    expanded: new Set<EntityId>(),
    query: '',

    toggleExpanded: (id) =>
      set((s) => {
        const next = new Set(s.expanded);
        next.has(id) ? next.delete(id) : next.add(id);
        return { expanded: next };
      }),
    setExpanded: (ids) => set({ expanded: new Set(ids) }),
    expand: (ids) =>
      set((s) => {
        const next = new Set(s.expanded);
        for (const id of ids) next.add(id);
        return { expanded: next };
      }),
    revealEntity: (id) =>
      set((s) => {
        const next = new Set(s.expanded);
        // Walk parents (not the node itself — revealing means its ancestors open).
        let cur = model.entityBySource(id)?.parent ?? null;
        const seen = new Set<number>();
        while (cur != null && !seen.has(cur)) {
          seen.add(cur);
          next.add(cur);
          cur = model.entityBySource(cur)?.parent ?? null;
        }
        return { expanded: next };
      }),
    setQuery: (query) => set({ query }),

    dropId: (id) =>
      set((s) => {
        if (!s.expanded.has(id)) return s;
        const next = new Set(s.expanded);
        next.delete(id);
        return { expanded: next };
      }),
    reset: () => set({ expanded: new Set(), query: '' }),
  }));

  model.subscribe((ev) => {
    if (ev.kind === 'entityRemoved') useStore.getState().dropId(ev.sourceId);
    else if (ev.kind === 'reset') useStore.getState().reset();
  });

  return useStore;
}

/** The app's default-session outliner controller. Other sessions build their own. */
export const useOutliner = createOutlinerStore(SceneModel);
