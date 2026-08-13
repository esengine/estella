// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  OutlinerController.ts — the outliner's headless view-state.
 *
 * Owns the tree state the source doesn't: which rows are expanded and the search
 * query. Kept OUT of the React panel so the tree is testable headless and (later)
 * drivable by EditorControlSurface / the editor MCP — the panel is a thin
 * renderer over this + {@link buildOutlinerItems}.
 *
 * Expansion is keyed by stable string ITEM KEYS (`e<id>` for a document entity,
 * `l<id>` for one the running game spawned, `f:<path>` for folders), so ONE set
 * covers every row kind — a row keeps its twist through Play and Stop.
 *
 * Self-healing follows the shape of each source. The model announces a removal,
 * so document keys prune on `entityRemoved` and reset on `reset`; the running
 * world announces nothing, so its keys prune with {@link retainLiveIds} on each
 * arriving tree — it recycles entity ids, and a recycled id would otherwise
 * inherit a dead entity's expansion.
 */
import { create } from 'zustand';
import { SceneModel, SceneModelImpl } from '@/engine/SceneModel';
import type { EntityId } from '@/types';
import { entityKey, folderKey, type SortMode } from './OutlinerModel';
import { folderPrefixes, normalizeFolder, rebaseFolder } from './folders';

/** What the controller needs from the tree it is a view of. Both members serve
 *  `revealEntity` alone — everything else here is pure view-state. */
export interface OutlinerSource {
  /** An entity's transform parent, or null at a root. */
  parentOf(id: EntityId): EntityId | null;
  /** A root's folder path; `''` for a source without folders (the live world). */
  folderOf(id: EntityId): string;
}

interface OutlinerState {
  /** Expanded item keys (`e<id>` / `f:<path>`). */
  expanded: Set<string>;
  /** Live name filter (raw text; the builder trims/lowercases). */
  query: string;
  /** Keyboard-focus row (item key) — drives ↑↓←→ navigation; null = none. */
  cursor: string | null;
  /** The selected folder path (folders aren't entities; mutually exclusive with the
   *  entity selection — the panel clears one when setting the other). */
  selectedFolder: string | null;
  /** Sibling sort: `manual` (scene order) / `name` / `type`. View-only. */
  sortMode: SortMode;
  /** Hidden trailing-column ids (the column registry; a user preference). */
  hiddenColumns: Set<string>;

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
  /** Select a folder (or clear with null). */
  selectFolder: (path: string | null) => void;
  setSortMode: (mode: SortMode) => void;
  /** Show/hide a trailing column by id. */
  toggleColumn: (id: string) => void;

  /** Prune a removed entity's key (self-heal on the model's `entityRemoved`). */
  dropId: (id: EntityId) => void;
  /** Keep only these realm ids among the SPAWNED keys — the live self-heal.
   *  Document keys are untouched: they answer to the model, not to a snapshot. */
  retainLiveIds: (ids: ReadonlySet<EntityId>) => void;
  /** Reset the view on a scene swap (the model's `reset`). */
  reset: () => void;
}

/** Build an outliner controller over a source. One per tree. */
export function createOutlinerStore(source: OutlinerSource) {
  const useStore = create<OutlinerState>((set) => ({
    expanded: new Set<string>(),
    query: '',
    cursor: null,
    selectedFolder: null,
    sortMode: 'manual',
    hiddenColumns: new Set<string>(),

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
          const parent: number | null = source.parentOf(cur);
          if (parent != null) next.add(entityKey(parent));
          else root = cur;
          cur = parent;
        }
        for (const pre of folderPrefixes(normalizeFolder(source.folderOf(root)))) next.add(folderKey(pre));
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
    selectFolder: (selectedFolder) => set({ selectedFolder }),
    setSortMode: (sortMode) => set({ sortMode }),
    toggleColumn: (id) =>
      set((s) => {
        const next = new Set(s.hiddenColumns);
        next.has(id) ? next.delete(id) : next.add(id);
        return { hiddenColumns: next };
      }),

    dropId: (id) =>
      set((s) => {
        const k = entityKey(id);
        const cursor = s.cursor === k ? null : s.cursor;
        if (!s.expanded.has(k)) return s.cursor === k ? { cursor } : s;
        const next = new Set(s.expanded);
        next.delete(k);
        return { expanded: next, cursor };
      }),
    retainLiveIds: (ids) =>
      set((s) => {
        const stale = [...s.expanded].filter((k) => k.startsWith('l') && !ids.has(Number(k.slice(1))));
        const cursor = s.cursor && stale.includes(s.cursor) ? null : s.cursor;
        if (stale.length === 0) return cursor === s.cursor ? s : { cursor };
        const next = new Set(s.expanded);
        for (const k of stale) next.delete(k);
        return { expanded: next, cursor };
      }),
    reset: () => set({ expanded: new Set(), query: '', cursor: null, selectedFolder: null }),
  }));

  return useStore;
}

/** A controller over an edited scene: the model is both the source and, because
 *  it announces its own removals, the self-heal. One per EditorSession. */
export function createSceneOutlinerStore(model: SceneModelImpl) {
  const store = createOutlinerStore({
    parentOf: (id) => model.entityBySource(id)?.parent ?? null,
    folderOf: (id) => model.folderOf(id),
  });
  model.subscribe((ev) => {
    if (ev.kind === 'entityRemoved') store.getState().dropId(ev.sourceId);
    else if (ev.kind === 'reset') store.getState().reset();
  });
  return store;
}

/** The app's default-session outliner controller. Other sessions build their own. */
export const useOutliner = createSceneOutlinerStore(SceneModel);
