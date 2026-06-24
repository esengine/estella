// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  OutlinerController.ts — the outliner's headless view-state.
 *
 * Owns the editor-tree state the SceneModel doesn't: which rows are expanded and
 * the search query. Kept OUT of the React panel so the tree is testable headless
 * and (later) drivable by EditorControlSurface / the editor MCP — the panel is a
 * thin renderer over this + {@link buildOutlinerItems}.
 *
 * Expansion is keyed by stable string ITEM KEYS (`e<id>` for entities, `f:<path>`
 * for folders), so one set covers both row kinds. Model-anchored self-healing
 * (mirrors selectionStore): expansion is pruned when an entity is removed
 * (`entityRemoved`) and the whole view resets on a scene swap (`reset`). One per
 * EditorSession; the default instance binds the app's SceneModel.
 */
import { create } from 'zustand';
import { SceneModel, SceneModelImpl } from '@/engine/SceneModel';
import type { EntityId } from '@/types';
import { entityKey, folderKey, type SortMode } from './OutlinerModel';
import { folderPrefixes, normalizeFolder, rebaseFolder } from './folders';

interface OutlinerState {
  /** Expanded item keys (`e<id>` / `f:<path>`). */
  expanded: Set<string>;
  /** Live name filter (raw text; the builder trims/lowercases). */
  query: string;
  /** Keyboard-focus row (item key) — drives ↑↓←→ navigation; null = none. */
  cursor: string | null;
  /** Sibling sort: `manual` (scene order) / `name` / `type`. View-only. */
  sortMode: SortMode;

  /** Flip one row's expansion (pass an item key). */
  toggleExpanded: (key: string) => void;
  /** Replace the whole expansion set (e.g. first-load auto-expand). */
  setExpanded: (keys: string[]) => void;
  /** Additively expand keys (reveal — keeps existing expansion). */
  expand: (keys: string[]) => void;
  /** Expand an entity's transform ancestors + folder path so it shows (reveal-on-select). */
  revealEntity: (id: EntityId) => void;
  /** Rewrite expanded folder keys when a folder is renamed/moved (keep it open). */
  rebaseFolderKeys: (oldPath: string, newPath: string) => void;
  setQuery: (query: string) => void;
  /** Move the keyboard-focus row. */
  setCursor: (key: string | null) => void;
  setSortMode: (mode: SortMode) => void;

  /** Prune a removed entity's key (self-heal on the model's `entityRemoved`). */
  dropId: (id: EntityId) => void;
  /** Reset the view on a scene swap (the model's `reset`). */
  reset: () => void;
}

/** Build an outliner controller bound to a model. One per EditorSession. */
export function createOutlinerStore(model: SceneModelImpl) {
  const useStore = create<OutlinerState>((set) => ({
    expanded: new Set<string>(),
    query: '',
    cursor: null,
    sortMode: 'manual',

    toggleExpanded: (key) =>
      set((s) => {
        const next = new Set(s.expanded);
        next.has(key) ? next.delete(key) : next.add(key);
        return { expanded: next };
      }),
    setExpanded: (keys) => set({ expanded: new Set(keys) }),
    expand: (keys) =>
      set((s) => {
        const next = new Set(s.expanded);
        for (const k of keys) next.add(k);
        return { expanded: next };
      }),
    revealEntity: (id) =>
      set((s) => {
        const next = new Set(s.expanded);
        // Climb the transform ancestors (expanding each so `id` becomes visible)
        // up to the root, then expand that root's folder-path prefixes.
        let cur: number | null = id;
        let root = id;
        const seen = new Set<number>();
        while (cur != null && !seen.has(cur)) {
          seen.add(cur);
          const parent: number | null = model.entityBySource(cur)?.parent ?? null;
          if (parent != null) next.add(entityKey(parent));
          else root = cur;
          cur = parent;
        }
        for (const pre of folderPrefixes(normalizeFolder(model.folderOf(root)))) next.add(folderKey(pre));
        return { expanded: next };
      }),
    rebaseFolderKeys: (oldPath, newPath) =>
      set((s) => {
        const next = new Set<string>();
        for (const k of s.expanded) {
          if (!k.startsWith('f:')) {
            next.add(k);
            continue;
          }
          const rebased = rebaseFolder(k.slice(2), oldPath, newPath);
          next.add(rebased != null ? folderKey(rebased) : k);
        }
        return { expanded: next };
      }),
    setQuery: (query) => set({ query }),
    setCursor: (cursor) => set({ cursor }),
    setSortMode: (sortMode) => set({ sortMode }),

    dropId: (id) =>
      set((s) => {
        const k = entityKey(id);
        const cursor = s.cursor === k ? null : s.cursor;
        if (!s.expanded.has(k)) return s.cursor === k ? { cursor } : s;
        const next = new Set(s.expanded);
        next.delete(k);
        return { expanded: next, cursor };
      }),
    reset: () => set({ expanded: new Set(), query: '', cursor: null }),
  }));

  model.subscribe((ev) => {
    if (ev.kind === 'entityRemoved') useStore.getState().dropId(ev.sourceId);
    else if (ev.kind === 'reset') useStore.getState().reset();
  });

  return useStore;
}

/** The app's default-session outliner controller. Other sessions build their own. */
export const useOutliner = createOutlinerStore(SceneModel);
