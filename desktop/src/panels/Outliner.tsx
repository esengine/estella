// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Search, Plus, FolderPlus, ArrowDownUp } from 'lucide-react';
import { SearchField } from '@/components/SearchField';
import { useEditorStore } from '@/store/editorStore';
import { useSelection } from '@/store/selectionStore';
import { EngineHost } from '@/engine/EngineHost';
import { SceneStore } from '@/engine/SceneStore';
import { SceneCommands } from '@/engine/SceneCommands';
import { SceneModel } from '@/engine/SceneModel';
import { PlayInspect } from '@/engine/PlayInspect';
import { ProjectStore } from '@/project/ProjectStore';
import { ContextMenu, type MenuItem } from '@/components/Menu';
import { formatKeybinding } from '@/commands/keybinding';
import { VirtualTree } from '@/components/VirtualTree';
import { t } from '@/i18n';
import { buildOutlinerItems, collectExpandableKeys, entityKey, folderKey, parseQuery, type OutlinerItem, type SortMode } from '@/outliner/OutlinerModel';
import { useOutliner } from '@/outliner/OutlinerController';
import { OutlinerRow } from '@/outliner/OutlinerRow';
import { OUTLINER_COLUMNS, TYPE_COLUMN, type OutlinerColumnContext } from '@/outliner/columns';
import { joinFolder, folderParent, folderName, normalizeFolder, isFolderUnder } from '@/outliner/folders';
import type { EntityId } from '@/types';
import { createFromSource, type EntitySource } from '@/engine/entitySources';
import { CreatePopover } from '@/components/CreatePopover';
import { Segmented } from '@/components/Segmented';

// Must match .row height in outliner.css — the fixed row size the virtual list windows by.
const ROW_H = 24;
const NO_EXPANSION: ReadonlySet<string> = new Set();
// Stable props so the memoized game-tree rows don't all re-render on selection.
const GAME_COLUMNS = [TYPE_COLUMN];
const EMPTY_COL_CTX: OutlinerColumnContext = {};
const NOOP = () => {};
const gameOnClick = (item: OutlinerItem) => {
  if (item.kind === 'entity') PlayInspect.select(item.id);
};

const SORT_MODE_LABEL: Record<SortMode, string> = {
  manual: t('out.sortManual'),
  name: t('out.sortName'),
  type: t('out.sortType'),
};
// Menu labels for the icon-only columns (their `header` is empty).
const COL_ID_LABEL: Record<string, string> = { lock: t('out.colLock'), vis: t('out.colVis') };

const entityIds = (items: OutlinerItem[]): EntityId[] =>
  items.filter((i): i is Extract<OutlinerItem, { kind: 'entity' }> => i.kind === 'entity').map((i) => i.id);

// One row of the live "Game" tree: a read-only, always-expanded
// view of the running realm, sharing the editor's virtualization. No folders.
function GameTree() {
  const snapshot = useSyncExternalStore(PlayInspect.subscribe, PlayInspect.getTree);
  const selection = useSyncExternalStore(PlayInspect.subscribe, PlayInspect.getSelection);
  const items = useMemo(() => buildOutlinerItems(snapshot, { expanded: NO_EXPANSION, expandAll: true }), [snapshot]);

  if (items.length === 0) {
    return (
      <div className="pbody">
        <div className="empty">
          <Search size={22} strokeWidth={1.4} />
          <p>{t('out.waitingGame')}</p>
        </div>
      </div>
    );
  }
  return (
    <VirtualTree
      className="pbody"
      items={items}
      rowHeight={ROW_H}
      getKey={(it) => it.key}
      renderRow={(it) => (
        <OutlinerRow
          item={it}
          selected={it.kind === 'entity' && selection === it.id}
          collapsible={false}
          columns={GAME_COLUMNS}
          columnCtx={EMPTY_COL_CTX}
          onToggle={NOOP}
          onClick={gameOnClick}
        />
      )}
    />
  );
}

/** Right-click prefab-instance actions (Select Source / Apply / Revert), or [] if
 *  the entity isn't a prefab instance — the Outliner twin of the Inspector's
 *  prefab-bar, backed by the same ProjectStore methods. */
function prefabInstanceItems(id: number): MenuItem[] {
  const tag = SceneModel.prefabTag(id);
  const ref = tag?.prefab ?? (tag ? SceneModel.prefabTag(tag.instanceRoot)?.prefab : undefined);
  if (!ref) return [];
  return [
    { sep: true },
    { label: t('out.prefabEdit'), onClick: () => void ProjectStore.editPrefabOfInstance(id) },
    {
      label: t('out.prefabSelectSource'),
      onClick: () => {
        const info = ProjectStore.assetInfo(ref);
        if (info) useSelection.getState().selectAsset(info.path);
      },
    },
    { label: t('out.prefabApply'), onClick: () => void ProjectStore.applyPrefabInstance(id) },
    { label: t('out.prefabRevert'), onClick: () => void ProjectStore.revertPrefabInstance(id) },
    { label: t('out.prefabCreateVariant'), onClick: () => void ProjectStore.createVariantFromInstance(id) },
    { label: t('out.prefabUnpack'), onClick: () => SceneCommands.unpackPrefabInstance(id) },
  ];
}

export function Outliner() {
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);
  const structRev = useSyncExternalStore(SceneStore.subscribe, SceneStore.getStructureRevision);
  const expanded = useOutliner((s) => s.expanded);
  const query = useOutliner((s) => s.query);
  const setQuery = useOutliner((s) => s.setQuery);
  const toggleExpanded = useOutliner((s) => s.toggleExpanded);
  const cursor = useOutliner((s) => s.cursor);
  const selectedFolder = useOutliner((s) => s.selectedFolder);
  const sortMode = useOutliner((s) => s.sortMode);
  const hiddenColumns = useOutliner((s) => s.hiddenColumns);
  const selectedIds = useSelection((s) => s.selectedIds);
  const selectedId = useSelection((s) => s.selectedId);
  const selectedAsset = useSelection((s) => s.selectedAsset);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const inspectWorld = useEditorStore((s) => s.inspectWorld);
  const setInspectWorld = useEditorStore((s) => s.setInspectWorld);
  const initRef = useRef(false);
  const dragIds = useRef<EntityId[] | null>(null);
  const dragFolder = useRef<string | null>(null); // the folder path being dragged (vs entities)

  const [renaming, setRenaming] = useState<string | null>(null); // item key
  const [drop, setDrop] = useState<{ key: string; pos: 'before' | 'on' | 'after' } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; item: OutlinerItem | null } | null>(null); // item null = empty-space menu
  const [createFor, setCreateFor] = useState<{ parent: EntityId | null } | null>(null);
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  const [colsMenu, setColsMenu] = useState<{ x: number; y: number } | null>(null);
  // Controlled scroll for reveal-on-select + keyboard nav (nonce re-fires same index).
  const [scrollTo, setScrollTo] = useState<{ index: number; nonce: number }>({ index: -1, nonce: 0 });
  const scrollNonce = useRef(0);
  const scrollToIndex = (index: number) => setScrollTo({ index, nonce: ++scrollNonce.current });

  const sceneCount = useMemo(
    () => (engine.status === 'ready' ? (SceneModel.current?.entities.length ?? 0) : 0),
    [engine.status, structRev],
  );
  const items = useMemo(
    () =>
      engine.status === 'ready'
        ? buildOutlinerItems(SceneModel.current, {
            expanded,
            query,
            sort: sortMode,
            folderOf: (id) => SceneModel.folderOf(id),
            folderOrderOf: (p) => SceneModel.folderOrderOf(p),
            folders: SceneModel.sceneFolders(),
          })
        : [],
    [engine.status, structRev, expanded, query, sortMode],
  );
  const flatIds = useMemo(() => entityIds(items), [items]);
  const highlight = useMemo(() => parseQuery(query).text, [query]);
  const activeColumns = useMemo(() => OUTLINER_COLUMNS.filter((c) => !hiddenColumns.has(c.id)), [hiddenColumns]);
  const columnCtx = useMemo<OutlinerColumnContext>(
    () => ({
      onToggleVisible: (id, visible) => SceneCommands.setEntityVisible(id, visible),
      onToggleLock: (id, locked) => SceneCommands.setEntityLocked(id, locked),
      isPrefab: (id) => SceneModel.prefabTag(id) != null,
    }),
    [],
  );

  // A scene swap resets the model ('reset' event). This panel is a persistent dock
  // panel (it doesn't remount), so re-arm the one-time auto-expand/select below —
  // otherwise the NEW scene renders fully collapsed with nothing selected.
  useEffect(() => SceneModel.subscribe((ev) => {
    if (ev.kind === 'reset') initRef.current = false;
  }), []);

  // First time entities appear: expand groups + folders, select the first entity.
  useEffect(() => {
    if (initRef.current || sceneCount === 0) return;
    initRef.current = true;
    useOutliner.getState().setExpanded(
      collectExpandableKeys(SceneModel.current, { folderOf: (id) => SceneModel.folderOf(id), folders: SceneModel.sceneFolders() }),
    );
    if (useSelection.getState().selectedId == null) {
      const first = entityIds(buildOutlinerItems(SceneModel.current, { expanded: NO_EXPANSION, expandAll: true }))[0];
      if (first != null) useSelection.getState().select(first);
    }
  }, [sceneCount]);

  const select = (id: EntityId | null) => useSelection.getState().select(id);

  // An entity / asset selection from anywhere (viewport pick, content browser)
  // clears the folder selection — they're mutually exclusive.
  useEffect(() => {
    if (selectedId != null || selectedAsset != null) useOutliner.getState().selectFolder(null);
  }, [selectedId, selectedAsset]);

  // Reveal-on-select: when the primary selection changes (e.g. a viewport pick),
  // expand its ancestors + folder and scroll it into view. If it isn't in the flat
  // list yet (ancestors collapsed), expand once — items rebuild and this re-runs.
  const handledSel = useRef<EntityId | null>(null);
  const expandedSel = useRef<EntityId | null>(null);
  useEffect(() => {
    if (selectedId == null) {
      handledSel.current = expandedSel.current = null;
      return;
    }
    if (handledSel.current === selectedId) return;
    const idx = items.findIndex((i) => i.kind === 'entity' && i.id === selectedId);
    if (idx >= 0) {
      handledSel.current = selectedId;
      expandedSel.current = null;
      useOutliner.getState().setCursor(entityKey(selectedId));
      scrollToIndex(idx);
    } else if (expandedSel.current !== selectedId) {
      expandedSel.current = selectedId; // attempt expansion once (avoids a loop when filtered out)
      useOutliner.getState().revealEntity(selectedId);
    }
  }, [selectedId, items]);

  // — Keyboard navigation (↑↓ move · ←→ collapse/expand/jump · Enter toggle · F2/Del) —
  const cursorItem = (): OutlinerItem | null => items.find((i) => i.key === cursor) ?? null;
  const focusIndex = (idx: number) => {
    const it = items[idx];
    if (!it) return;
    useOutliner.getState().setCursor(it.key);
    if (it.kind === 'entity') {
      useOutliner.getState().selectFolder(null);
      select(it.id);
    } else {
      useOutliner.getState().selectFolder(it.path);
      useSelection.getState().select(null);
    }
    scrollToIndex(idx);
  };
  const moveCursor = (delta: number) => {
    if (items.length === 0) return;
    const cur = items.findIndex((i) => i.key === cursor);
    const next = cur < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, cur + delta));
    focusIndex(next);
  };
  // Type-to-jump: letters typed while the tree is focused seek the next visible
  // row whose name starts with the accumulated buffer (600ms between keystrokes).
  const typeAhead = useRef({ buf: '', at: 0 });
  const seekByName = (ch: string) => {
    const now = performance.now();
    const t = typeAhead.current;
    t.buf = (now - t.at < 600 ? t.buf : '') + ch.toLowerCase();
    t.at = now;
    const name = (it: OutlinerItem) => (it.kind === 'entity' ? it.node.name : it.name);
    const cur = items.findIndex((i) => i.key === cursor);
    const order = [...items.slice(cur + 1), ...items.slice(0, cur + 1)];
    const hit = order.find((i) => (name(i) ?? '').toLowerCase().startsWith(t.buf));
    if (hit) focusIndex(items.indexOf(hit));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || renaming != null) return; // typing
    // When the Outliner is focused it owns the arrow keys (tree nav) — stop them
    // reaching the global keymap, where they'd also nudge the viewport selection.
    if (e.key.startsWith('Arrow')) e.stopPropagation();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveCursor(1); break;
      case 'ArrowUp': e.preventDefault(); moveCursor(-1); break;
      case 'ArrowRight': {
        e.preventDefault();
        const it = cursorItem();
        if (it?.hasChildren && !it.expanded) toggleExpanded(it.key);
        else if (it?.hasChildren && it.expanded) moveCursor(1); // step into the first child
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const it = cursorItem();
        if (it?.hasChildren && it.expanded) toggleExpanded(it.key);
        else if (it?.parentKey) {
          const pidx = items.findIndex((i) => i.key === it.parentKey);
          if (pidx >= 0) focusIndex(pidx);
        }
        break;
      }
      case 'Enter': {
        const it = cursorItem();
        if (it?.hasChildren) { e.preventDefault(); toggleExpanded(it.key); }
        break;
      }
      case 'F2': {
        e.preventDefault();
        if (cursor) setRenaming(cursor);
        break;
      }
      case 'Delete':
      case 'Backspace': {
        const sel = [...useSelection.getState().selectedIds];
        if (sel.length) {
          e.preventDefault();
          SceneCommands.deleteEntities(sel);
          select(null);
        }
        break;
      }
      default: {
        if (e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) break;
        // The focused tree owns printable keys (jump-to-name), like the arrows —
        // they must not fall through to global single-key shortcuts.
        e.preventDefault();
        e.stopPropagation();
        seekByName(e.key);
        break;
      }
    }
  };

  const onRowClick = (item: OutlinerItem, e: React.MouseEvent) => {
    useOutliner.getState().setCursor(item.key);
    if (item.kind === 'folder') {
      // Selecting a folder is mutually exclusive with the entity selection: the
      // folder gets the blue selection, entities clear, Details shows the folder.
      useOutliner.getState().selectFolder(item.path);
      useSelection.getState().select(null);
      toggleExpanded(item.key);
      return;
    }
    useOutliner.getState().selectFolder(null); // an entity selection clears the folder one
    const id = item.id;
    const store = useSelection.getState();
    if (e.metaKey || e.ctrlKey) {
      store.toggleSelect(id);
    } else if (e.shiftKey && store.selectedId != null) {
      const a = flatIds.indexOf(store.selectedId);
      const b = flatIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        store.selectMany(flatIds.slice(lo, hi + 1), id);
      } else store.select(id);
    } else {
      store.select(id);
    }
  };

  const onContextMenu = (e: React.MouseEvent, item: OutlinerItem) => {
    e.preventDefault();
    e.stopPropagation(); // a row menu pre-empts the empty-space menu on the container
    if (item.kind === 'entity' && !useSelection.getState().selectedIds.has(item.id)) select(item.id);
    setCtx({ x: e.clientX, y: e.clientY, item });
  };
  // Right-click on empty space (below the rows / no entities) → the scene menu.
  const onBodyContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, item: null });
  };
  const expandAll = () =>
    useOutliner.getState().setExpanded(
      collectExpandableKeys(SceneModel.current, { folderOf: (id) => SceneModel.folderOf(id), folders: SceneModel.sceneFolders() }),
    );

  const onStartRename = (item: OutlinerItem) => setRenaming(item.key);
  const commitRename = (item: OutlinerItem, name: string) => {
    setRenaming(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    if (item.kind === 'folder') {
      const next = joinFolder(folderParent(item.path), trimmed);
      if (next !== item.path) {
        SceneCommands.renameFolder(item.path, next);
        useOutliner.getState().rebaseFolderKeys(item.path, next);
        if (useOutliner.getState().selectedFolder === item.path) useOutliner.getState().selectFolder(next);
      }
    } else {
      SceneCommands.renameEntity(item.id, trimmed);
    }
  };

  const addEntity = () => {
    const id = SceneCommands.addEntity();
    if (id != null) select(id);
  };
  // Create a ready-made entity from a source (no add-component dance). Where it
  // lands — e.g. UI controls under the Canvas — is the source's own concern now.
  const createTemplate = (source: EntitySource, parent: EntityId | null) => {
    void createFromSource(source, { parent }).then((id) => { if (id != null) select(id); });
  };
  const selectionOrTarget = (id: EntityId): EntityId[] => {
    const ids = useSelection.getState().selectedIds;
    return ids.has(id) ? [...ids] : [id];
  };

  // Create a uniquely-named folder (optionally moving a selection into it), reveal
  // it, and drop straight into rename.
  const newFolder = (parent: string, into: EntityId[] | null) => {
    const existing = new Set(SceneModel.sceneFolders());
    let path = joinFolder(parent, 'New Folder');
    for (let i = 2; existing.has(path); i++) path = joinFolder(parent, `New Folder ${i}`);
    SceneCommands.createFolder(path);
    if (into?.length) SceneCommands.moveToFolder(into, path);
    useOutliner.getState().expand([folderKey(path)]);
    setRenaming(folderKey(path));
  };

  // — Drag-to-reparent / move-to-folder + drag-a-prefab-in (Content Browser) —
  const ASSET_MIME = 'application/x-estella-asset';
  const isAssetDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(ASSET_MIME);
  /** Instantiate a dropped `.esprefab` under `parent`. Returns true if handled. */
  const dropPrefabAsset = (e: React.DragEvent, parent: EntityId | null): boolean => {
    const path = e.dataTransfer.getData(ASSET_MIME);
    if (!path || !path.toLowerCase().endsWith('.esprefab')) return false;
    void ProjectStore.instantiatePrefabFromPath(path, parent);
    return true;
  };
  // The folder level a row sits at (for placing a dragged folder as its sibling):
  // a folder's parent path, or a ROOT entity's folder; null = not a level sibling.
  const folderDropLevel = (item: OutlinerItem): string | null => {
    if (item.kind === 'folder') return folderParent(item.path);
    const e = SceneModel.entityBySource(item.id);
    return e && e.parent == null ? SceneModel.folderOf(item.id) : null;
  };
  const onDragStartRow = (item: OutlinerItem, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    if (item.kind === 'folder') {
      dragFolder.current = item.path;
      dragIds.current = null;
      e.dataTransfer.setData('text/plain', item.path);
    } else {
      dragIds.current = selectionOrTarget(item.id);
      dragFolder.current = null;
      e.dataTransfer.setData('text/plain', String(item.id));
    }
  };
  const onDragOverRow = (item: OutlinerItem, e: React.DragEvent) => {
    if (dragIds.current || dragFolder.current) e.dataTransfer.dropEffect = 'move';
    else if (isAssetDrag(e)) e.dataTransfer.dropEffect = 'copy';
    else return;
    e.preventDefault();
    // Entity drag, manual sort: the top/bottom quarter of an entity row is a
    // between-rows reorder, the middle a reparent. A folder drag is always 'on'
    // (nest into the target; folders sort by name, so no manual reorder).
    let pos: 'before' | 'on' | 'after' = 'on';
    if (dragIds.current && item.kind === 'entity' && sortMode === 'manual') {
      const rect = e.currentTarget.getBoundingClientRect();
      const rel = (e.clientY - rect.top) / rect.height;
      pos = rel < 0.25 ? 'before' : rel > 0.75 ? 'after' : 'on';
    } else if (dragFolder.current && sortMode === 'manual' && folderDropLevel(item) === folderParent(dragFolder.current)) {
      // Folder over a same-level sibling → place it before/after (interleave). Over a
      // FOLDER the middle nests; over an ENTITY there's no middle (a folder never
      // absorbs an entity — that's confusing; drag entities INTO a folder instead).
      const rect = e.currentTarget.getBoundingClientRect();
      const rel = (e.clientY - rect.top) / rect.height;
      pos = item.kind === 'folder' ? (rel < 0.33 ? 'before' : rel > 0.66 ? 'after' : 'on') : rel < 0.5 ? 'before' : 'after';
    }
    if (drop?.key !== item.key || drop?.pos !== pos) setDrop({ key: item.key, pos });
  };
  /** Nest folder `src` under `destParent` (or root). Rejects self/descendant/no-op. */
  const moveFolderInto = (src: string, destParent: string) => {
    const dest = normalizeFolder(destParent);
    if (dest === src || isFolderUnder(dest, src)) return; // into itself / its own subtree
    const next = joinFolder(dest, folderName(src));
    if (next === src) return; // already there
    SceneCommands.renameFolder(src, next);
    useOutliner.getState().rebaseFolderKeys(src, next);
  };
  const reparent = (target: EntityId | null) => {
    const ids = dragIds.current;
    dragIds.current = null;
    setDrop(null);
    if (!ids) return;
    SceneCommands.reparentEntities(ids, target);
  };
  const moveToFolder = (path: string | null) => {
    const ids = dragIds.current;
    dragIds.current = null;
    setDrop(null);
    if (ids) SceneCommands.moveToFolder(ids, path);
  };
  const onDropRow = (item: OutlinerItem, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = drop?.pos ?? 'on';
    setDrop(null);
    // A folder is being dragged.
    if (dragFolder.current != null) {
      const src = dragFolder.current;
      dragFolder.current = null;
      if (pos !== 'on') {
        // between-rows → place the folder at that position (interleaved with entities)
        SceneCommands.placeFolder(src, item.sortKey + (pos === 'before' ? -0.5 : 0.5));
      } else if (item.kind === 'folder') {
        moveFolderInto(src, item.path); // middle of a folder → nest
      }
      // middle of an entity → nothing (folders don't absorb entities)
      return;
    }
    if (item.kind === 'folder') {
      if (dropPrefabAsset(e, null)) return; // prefab onto a folder → instantiate at root
      moveToFolder(item.path);
      return;
    }
    if (dropPrefabAsset(e, item.id)) return; // prefab onto an entity = under it
    if (pos === 'on') {
      reparent(item.id);
      return;
    }
    // Drop-between → reorder as a sibling of the target ('after' reversed so a
    // multi-drag keeps its relative order).
    const ids = dragIds.current;
    dragIds.current = null;
    if (ids) {
      const ordered = pos === 'before' ? ids : [...ids].reverse();
      SceneCommands.reorderEntities(ordered, item.id, pos === 'before');
    }
  };

  // Empty-space drop = move to the scene root (un-parent + clear folder, or, for
  // a dragged folder, re-root it).
  const onBodyDragOver = (e: React.DragEvent) => {
    if (dragIds.current || dragFolder.current || isAssetDrag(e)) e.preventDefault();
  };
  const onBodyDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragFolder.current != null) {
      const src = dragFolder.current;
      dragFolder.current = null;
      setDrop(null);
      moveFolderInto(src, ''); // re-root the folder
      return;
    }
    if (dropPrefabAsset(e, null)) return;
    moveToFolder(null);
  };

  const ctxItems: MenuItem[] = useMemo(() => {
    if (!ctx) return [];
    if (!ctx.item) {
      // Empty-space (scene) menu.
      return [
        { label: t('out.addEntity'), onClick: addEntity },
        { label: t('out.createTemplate'), onClick: () => setCreateFor({ parent: null }) },
        { label: t('out.newFolder'), onClick: () => newFolder('', null) },
        { sep: true },
        { label: t('out.expandAll'), onClick: expandAll },
        { label: t('out.collapseAll'), onClick: () => useOutliner.getState().setExpanded([]) },
      ];
    }
    if (ctx.item.kind === 'folder') {
      const path = ctx.item.path;
      const sel = [...useSelection.getState().selectedIds];
      return [
        { label: t('ui.rename'), shortcut: 'F2', onClick: () => setRenaming(folderKey(path)) },
        { label: t('out.newSubfolder'), onClick: () => newFolder(path, null) },
        ...(sel.length ? [{ label: t('out.moveSelectionHere'), onClick: () => SceneCommands.moveToFolder(sel, path) } as MenuItem] : []),
        { sep: true },
        {
          label: t('out.deleteFolder'),
          onClick: () => {
            SceneCommands.deleteFolder(path);
            if (useOutliner.getState().selectedFolder === path) useOutliner.getState().selectFolder(null);
          },
        },
      ];
    }
    const id = ctx.item.id;
    const { visible, locked } = ctx.item.node;
    return [
      { label: t('ui.rename'), shortcut: 'F2', onClick: () => setRenaming(entityKey(id)) },
      {
        label: t('out.duplicate'),
        shortcut: formatKeybinding('mod+d'),
        onClick: () => {
          const dups = SceneCommands.duplicateEntities(selectionOrTarget(id));
          if (dups.length > 0) useSelection.getState().selectMany(dups, dups[dups.length - 1]);
        },
      },
      { label: t('out.createPrefab'), onClick: () => void ProjectStore.createPrefabFromEntity(id) },
      ...prefabInstanceItems(id),
      {
        label: t('ui.delete'),
        shortcut: formatKeybinding('delete'),
        onClick: () => {
          SceneCommands.deleteEntities(selectionOrTarget(id));
          select(null);
        },
      },
      { sep: true },
      { label: visible ? t('out.hide') : t('out.show'), onClick: () => selectionOrTarget(id).forEach((i) => SceneCommands.setEntityVisible(i, !visible)) },
      { label: locked ? t('out.unlock') : t('out.lock'), onClick: () => selectionOrTarget(id).forEach((i) => SceneCommands.setEntityLocked(i, !locked)) },
      { sep: true },
      { label: t('out.newFolderFromSelection'), onClick: () => newFolder('', selectionOrTarget(id)) },
      { label: t('out.moveToRoot'), onClick: () => SceneCommands.moveToFolder(selectionOrTarget(id), null) },
      { label: t('out.unparent'), onClick: () => SceneCommands.reparentEntities(selectionOrTarget(id), null) },
      { sep: true },
      { label: t('out.addEntity'), onClick: addEntity },
      { label: t('out.createTemplate'), onClick: () => setCreateFor({ parent: id }) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // While playing, a world picker switches the outliner (+ Details)
  // between the edit scene and the live running game.
  const gameMode = inspectWorld === 'game';

  // Stable handlers (latest-ref) so the memoized rows skip on a selection change.
  const rowFns = {
    onRowClick, onContextMenu, onStartRename, commitRename, onDragStartRow, onDragOverRow, onDropRow,
    onDragEnd: () => { dragIds.current = null; dragFolder.current = null; setDrop(null); },
  };
  const rowFnsRef = useRef(rowFns);
  rowFnsRef.current = rowFns;
  const H = useMemo(
    () => ({
      onClick: (item: OutlinerItem, e: React.MouseEvent) => rowFnsRef.current.onRowClick(item, e),
      onContextMenu: (e: React.MouseEvent, item: OutlinerItem) => rowFnsRef.current.onContextMenu(e, item),
      onStartRename: (item: OutlinerItem) => rowFnsRef.current.onStartRename(item),
      onCommitRename: (item: OutlinerItem, name: string) => rowFnsRef.current.commitRename(item, name),
      onDragStart: (item: OutlinerItem, e: React.DragEvent) => rowFnsRef.current.onDragStartRow(item, e),
      onDragOver: (item: OutlinerItem, e: React.DragEvent) => rowFnsRef.current.onDragOverRow(item, e),
      onDrop: (item: OutlinerItem, e: React.DragEvent) => rowFnsRef.current.onDropRow(item, e),
      onDragEnd: () => rowFnsRef.current.onDragEnd(),
    }),
    [],
  );

  const renderRow = (it: OutlinerItem) => (
    <OutlinerRow
      item={it}
      selected={it.kind === 'folder' ? selectedFolder === it.path : selectedIds.has(it.id)}
      cursored={cursor === it.key}
      highlight={highlight}
      renaming={renaming === it.key}
      dropPos={drop?.key === it.key ? drop.pos : undefined}
      prefabRole={
        it.kind === 'entity'
          ? SceneModel.isInstanceRoot(it.id)
            ? 'root'
            : SceneModel.prefabTag(it.id) != null
              ? 'member'
              : undefined
          : undefined
      }
      columns={activeColumns}
      columnCtx={columnCtx}
      draggable
      onToggle={toggleExpanded}
      onClick={H.onClick}
      onContextMenu={H.onContextMenu}
      onStartRename={H.onStartRename}
      onCommitRename={H.onCommitRename}
      onDragStart={H.onDragStart}
      onDragOver={H.onDragOver}
      onDrop={H.onDrop}
      onDragEnd={H.onDragEnd}
    />
  );

  return (
    <div className="panel">
      {isPlaying && (
        <div className="world-pick">
          <Segmented
            grow
            ariaLabel={t('out.inspectedWorld')}
            value={gameMode ? 'game' : 'editor'}
            options={[
              { value: 'editor', label: t('out.worldEditor') },
              { value: 'game', label: t('out.worldGame') },
            ]}
            onChange={(v) => setInspectWorld(v)}
          />
        </div>
      )}
      {gameMode ? (
        <GameTree />
      ) : (
        <>
          <div className="phead">
            <SearchField placeholder={t('out.searchPlaceholder')} value={query} onChange={setQuery} />
            <button
              type="button"
              className={`pbtn${sortMode !== 'manual' ? ' on' : ''}`}
              title={t('out.sortLabel', { mode: SORT_MODE_LABEL[sortMode] })}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setSortMenu({ x: r.left, y: r.bottom + 2 });
              }}
            >
              <ArrowDownUp size={14} strokeWidth={2} />
            </button>
            <button type="button" className="pbtn" title={t('out.newFolderTip')} onClick={() => newFolder('', null)}>
              <FolderPlus size={15} strokeWidth={2} />
            </button>
            <button type="button" className="pbtn" title={t('out.addEntityTip')} onClick={addEntity}>
              <Plus size={15} strokeWidth={2} />
            </button>
          </div>
          {sceneCount > 0 && (
            <div
              className="outliner-cols"
              title={t('out.columnsTip')}
              onContextMenu={(e) => {
                e.preventDefault();
                setColsMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              <span className="c-name">{t('out.colName')}</span>
              {activeColumns.map((col) => (
                <span key={col.id} className="c-col" data-col={col.id} style={{ width: col.width }}>
                  {col.header}
                </span>
              ))}
            </div>
          )}
          {sceneCount === 0 ? (
            <div className="pbody" onDragOver={onBodyDragOver} onDrop={onBodyDrop} onContextMenu={onBodyContextMenu}>
              <div className="empty">
                <Search size={22} strokeWidth={1.4} />
                <p>{engine.status === 'ready' ? t('out.emptyScene') : t('out.waitingEngine')}</p>
                {engine.status === 'ready' && <small>{t('out.emptyHint')}</small>}
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="pbody" onDragOver={onBodyDragOver} onDrop={onBodyDrop} onContextMenu={onBodyContextMenu}>
              <div className="empty">
                <Search size={22} strokeWidth={1.4} />
                <p>{t('out.noMatch', { query })}</p>
              </div>
            </div>
          ) : (
            <VirtualTree
              className="pbody"
              tabIndex={0}
              items={items}
              rowHeight={ROW_H}
              getKey={(it) => it.key}
              renderRow={renderRow}
              scrollToIndex={scrollTo.index}
              scrollNonce={scrollTo.nonce}
              onKeyDown={onKeyDown}
              onDragOver={onBodyDragOver}
              onDrop={onBodyDrop}
              onContextMenu={onBodyContextMenu}
            />
          )}
        </>
      )}

      {ctx && !gameMode && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
      {createFor && (
        <CreatePopover
          onClose={() => setCreateFor(null)}
          onPick={(t) => createTemplate(t, createFor.parent)}
        />
      )}
      {sortMenu && !gameMode && (
        <ContextMenu
          x={sortMenu.x}
          y={sortMenu.y}
          onClose={() => setSortMenu(null)}
          items={(['manual', 'name', 'type'] as const).map((m) => ({
            label: t('out.sortLabel', { mode: SORT_MODE_LABEL[m] }),
            onClick: () => useOutliner.getState().setSortMode(m),
          }))}
        />
      )}
      {colsMenu && !gameMode && (
        <ContextMenu
          x={colsMenu.x}
          y={colsMenu.y}
          onClose={() => setColsMenu(null)}
          items={OUTLINER_COLUMNS.map((col) => ({
            label: `${hiddenColumns.has(col.id) ? '   ' : '✓ '}${col.header || COL_ID_LABEL[col.id] || col.id}`,
            onClick: () => useOutliner.getState().toggleColumn(col.id),
          }))}
        />
      )}
    </div>
  );
}
