// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Search, Plus, FolderPlus, ArrowDownUp } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useSelection } from '@/store/selectionStore';
import { EngineHost } from '@/engine/EngineHost';
import { SceneStore } from '@/engine/SceneStore';
import { SceneCommands } from '@/engine/SceneCommands';
import { SceneModel } from '@/engine/SceneModel';
import { PlayInspect } from '@/engine/PlayInspect';
import { ProjectStore } from '@/project/ProjectStore';
import { ContextMenu, type MenuItem } from '@/components/Menu';
import { VirtualTree } from '@/components/VirtualTree';
import { buildOutlinerItems, collectExpandableKeys, entityKey, folderKey, parseQuery, type OutlinerItem } from '@/outliner/OutlinerModel';
import { useOutliner } from '@/outliner/OutlinerController';
import { OutlinerRow } from '@/outliner/OutlinerRow';
import { joinFolder, folderParent, folderName, normalizeFolder, isFolderUnder } from '@/outliner/folders';
import type { EntityId } from '@/types';

// Must match .row height in outliner.css — the fixed row size the virtual list windows by.
const ROW_H = 24;
const NO_EXPANSION: ReadonlySet<string> = new Set();

const entityIds = (items: OutlinerItem[]): EntityId[] =>
  items.filter((i): i is Extract<OutlinerItem, { kind: 'entity' }> => i.kind === 'entity').map((i) => i.id);

// One row of the live "Game" tree (UE5 PIE world): a read-only, always-expanded
// view of the running realm, sharing the editor's virtualization. No folders.
function GameTree() {
  const { snapshot, selection } = useSyncExternalStore(PlayInspect.subscribe, PlayInspect.getSnapshot);
  const items = useMemo(() => buildOutlinerItems(snapshot, { expanded: NO_EXPANSION, expandAll: true }), [snapshot]);

  if (items.length === 0) {
    return (
      <div className="pbody">
        <div className="empty">
          <Search size={22} strokeWidth={1.4} />
          <p>Waiting for the running game…</p>
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
          onToggle={() => {}}
          onClick={(item) => {
            if (item.kind === 'entity') PlayInspect.select(item.id);
          }}
        />
      )}
    />
  );
}

export function Outliner() {
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);
  const structRev = useSyncExternalStore(SceneStore.subscribe, SceneStore.getStructureRevision);
  const expanded = useOutliner((s) => s.expanded);
  const query = useOutliner((s) => s.query);
  const setQuery = useOutliner((s) => s.setQuery);
  const toggleExpanded = useOutliner((s) => s.toggleExpanded);
  const cursor = useOutliner((s) => s.cursor);
  const sortMode = useOutliner((s) => s.sortMode);
  const selectedIds = useSelection((s) => s.selectedIds);
  const selectedId = useSelection((s) => s.selectedId);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const inspectWorld = useEditorStore((s) => s.inspectWorld);
  const setInspectWorld = useEditorStore((s) => s.setInspectWorld);
  const initRef = useRef(false);
  const dragIds = useRef<EntityId[] | null>(null);
  const dragFolder = useRef<string | null>(null); // the folder path being dragged (vs entities)

  const [renaming, setRenaming] = useState<string | null>(null); // item key
  const [drop, setDrop] = useState<{ key: string; pos: 'before' | 'on' | 'after' } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; item: OutlinerItem | null } | null>(null); // item null = empty-space menu
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
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
            folders: SceneModel.sceneFolders(),
          })
        : [],
    [engine.status, structRev, expanded, query, sortMode],
  );
  const flatIds = useMemo(() => entityIds(items), [items]);
  const highlight = useMemo(() => parseQuery(query).text, [query]);

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
    if (it.kind === 'entity') select(it.id);
    scrollToIndex(idx);
  };
  const moveCursor = (delta: number) => {
    if (items.length === 0) return;
    const cur = items.findIndex((i) => i.key === cursor);
    const next = cur < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, cur + delta));
    focusIndex(next);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || renaming != null) return; // typing
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
          sel.forEach((i) => SceneCommands.deleteEntity(i));
          select(null);
        }
        break;
      }
    }
  };

  const onRowClick = (item: OutlinerItem, e: React.MouseEvent) => {
    useOutliner.getState().setCursor(item.key);
    if (item.kind === 'folder') {
      toggleExpanded(item.key);
      return;
    }
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
      }
    } else {
      SceneCommands.renameEntity(item.id, trimmed);
    }
  };

  const addEntity = () => {
    const id = SceneCommands.addEntity();
    if (id != null) select(id);
  };
  const selectionOrTarget = (id: EntityId): EntityId[] => {
    const ids = useSelection.getState().selectedIds;
    return ids.has(id) ? [...ids] : [id];
  };

  // Create a uniquely-named folder (optionally moving a selection into it), reveal
  // it, and drop straight into rename — the UE5 "New Folder" gesture.
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
    } else if (
      dragFolder.current &&
      item.kind === 'folder' &&
      sortMode === 'manual' &&
      folderParent(dragFolder.current) === folderParent(item.path)
    ) {
      // Sibling folders → top/bottom third reorders, middle nests.
      const rect = e.currentTarget.getBoundingClientRect();
      const rel = (e.clientY - rect.top) / rect.height;
      pos = rel < 0.33 ? 'before' : rel > 0.66 ? 'after' : 'on';
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
    for (const child of ids) if (child !== target) SceneCommands.setParent(child, target);
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
      if (item.kind === 'folder') {
        // sibling between-rows → reorder; else → nest under the target folder
        if (pos !== 'on' && folderParent(src) === folderParent(item.path)) SceneCommands.reorderFolder(src, item.path, pos === 'before');
        else moveFolderInto(src, item.path);
      } else {
        // dropped onto an entity → that entity (+ any selection) joins the folder
        SceneCommands.moveToFolder(selectionOrTarget(item.id), src);
      }
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
      for (const id of ordered) if (id !== item.id) SceneCommands.reorderEntity(id, item.id, pos === 'before');
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
      // Empty-space (scene) menu — UE5 right-click-in-the-void.
      return [
        { label: 'Add Entity', onClick: addEntity },
        { label: 'New Folder', onClick: () => newFolder('', null) },
        { sep: true },
        { label: 'Expand All', onClick: expandAll },
        { label: 'Collapse All', onClick: () => useOutliner.getState().setExpanded([]) },
      ];
    }
    if (ctx.item.kind === 'folder') {
      const path = ctx.item.path;
      const sel = [...useSelection.getState().selectedIds];
      return [
        { label: 'Rename', shortcut: 'F2', onClick: () => setRenaming(folderKey(path)) },
        { label: 'New Subfolder', onClick: () => newFolder(path, null) },
        ...(sel.length ? [{ label: 'Move Selection Here', onClick: () => SceneCommands.moveToFolder(sel, path) } as MenuItem] : []),
        { sep: true },
        { label: 'Delete Folder', onClick: () => SceneCommands.deleteFolder(path) },
      ];
    }
    const id = ctx.item.id;
    const { visible, locked } = ctx.item.node;
    return [
      { label: 'Rename', shortcut: 'F2', onClick: () => setRenaming(entityKey(id)) },
      {
        label: 'Duplicate',
        shortcut: '⌘D',
        onClick: () => {
          const d = SceneCommands.duplicateEntity(id);
          if (d != null) select(d);
        },
      },
      { label: 'Create Prefab', onClick: () => void ProjectStore.createPrefabFromEntity(id) },
      {
        label: 'Delete',
        shortcut: '⌫',
        onClick: () => {
          selectionOrTarget(id).forEach((i) => SceneCommands.deleteEntity(i));
          select(null);
        },
      },
      { sep: true },
      { label: visible ? 'Hide' : 'Show', onClick: () => selectionOrTarget(id).forEach((i) => SceneCommands.setEntityVisible(i, !visible)) },
      { label: locked ? 'Unlock' : 'Lock', onClick: () => selectionOrTarget(id).forEach((i) => SceneCommands.setEntityLocked(i, !locked)) },
      { sep: true },
      { label: 'New Folder from Selection', onClick: () => newFolder('', selectionOrTarget(id)) },
      { label: 'Move to Root', onClick: () => SceneCommands.moveToFolder(selectionOrTarget(id), null) },
      { label: 'Unparent', onClick: () => selectionOrTarget(id).forEach((i) => SceneCommands.setParent(i, null)) },
      { label: 'Add Entity', onClick: addEntity },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // While playing, a UE5-style world picker switches the outliner (+ Details)
  // between the edit scene and the live running game.
  const gameMode = inspectWorld === 'game';

  const renderRow = (it: OutlinerItem) => (
    <OutlinerRow
      item={it}
      selected={it.kind === 'entity' && selectedIds.has(it.id)}
      cursored={cursor === it.key}
      highlight={highlight}
      renaming={renaming === it.key}
      dropPos={drop?.key === it.key ? drop.pos : undefined}
      prefab={it.kind === 'entity' && SceneModel.prefabTag(it.id) != null}
      draggable
      onToggle={toggleExpanded}
      onClick={onRowClick}
      onContextMenu={onContextMenu}
      onStartRename={onStartRename}
      onCommitRename={commitRename}
      onToggleVisible={(id, visible) => SceneCommands.setEntityVisible(id, visible)}
      onToggleLock={(id, locked) => SceneCommands.setEntityLocked(id, locked)}
      onDragStart={onDragStartRow}
      onDragOver={onDragOverRow}
      onDrop={onDropRow}
      onDragEnd={() => {
        dragIds.current = null;
        dragFolder.current = null;
        setDrop(null);
      }}
    />
  );

  return (
    <div className="panel">
      {isPlaying && (
        <div className="world-pick">
          <button type="button" className={gameMode ? '' : 'on'} onClick={() => setInspectWorld('editor')}>
            Editor
          </button>
          <button type="button" className={gameMode ? 'on' : ''} onClick={() => setInspectWorld('game')}>
            Game
          </button>
        </div>
      )}
      {gameMode ? (
        <GameTree />
      ) : (
        <>
          <div className="phead">
            <div className="search">
              <Search size={13} strokeWidth={1.85} />
              <input
                placeholder="Search · type: comp:"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button
              type="button"
              className={`pbtn${sortMode !== 'manual' ? ' on' : ''}`}
              title={`Sort: ${sortMode}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setSortMenu({ x: r.left, y: r.bottom + 2 });
              }}
            >
              <ArrowDownUp size={14} strokeWidth={2} />
            </button>
            <button type="button" className="pbtn" title="New folder" onClick={() => newFolder('', null)}>
              <FolderPlus size={15} strokeWidth={2} />
            </button>
            <button type="button" className="pbtn" title="Add entity" onClick={addEntity}>
              <Plus size={15} strokeWidth={2} />
            </button>
          </div>
          {sceneCount > 0 && (
            <div className="outliner-cols">
              <span className="c-name">Name</span>
              <span className="c-type">Type</span>
              <span className="c-vis" />
            </div>
          )}
          {sceneCount === 0 ? (
            <div className="pbody" onDragOver={onBodyDragOver} onDrop={onBodyDrop} onContextMenu={onBodyContextMenu}>
              <div className="empty">
                <Search size={22} strokeWidth={1.4} />
                <p>{engine.status === 'ready' ? 'No entities in scene.' : 'Waiting for engine…'}</p>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="pbody" onDragOver={onBodyDragOver} onDrop={onBodyDrop} onContextMenu={onBodyContextMenu}>
              <div className="empty">
                <Search size={22} strokeWidth={1.4} />
                <p>No entities match “{query}”.</p>
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
      {sortMenu && !gameMode && (
        <ContextMenu
          x={sortMenu.x}
          y={sortMenu.y}
          onClose={() => setSortMenu(null)}
          items={(['manual', 'name', 'type'] as const).map((m) => ({
            label: `Sort: ${m[0].toUpperCase()}${m.slice(1)}`,
            onClick: () => useOutliner.getState().setSortMode(m),
          }))}
        />
      )}
    </div>
  );
}
