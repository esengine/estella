// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Search, Plus, FolderPlus } from 'lucide-react';
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
import { buildOutlinerItems, collectExpandableKeys, entityKey, folderKey, type OutlinerItem } from '@/outliner/OutlinerModel';
import { useOutliner } from '@/outliner/OutlinerController';
import { OutlinerRow } from '@/outliner/OutlinerRow';
import { joinFolder, folderParent } from '@/outliner/folders';
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
  const selectedIds = useSelection((s) => s.selectedIds);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const inspectWorld = useEditorStore((s) => s.inspectWorld);
  const setInspectWorld = useEditorStore((s) => s.setInspectWorld);
  const initRef = useRef(false);
  const dragIds = useRef<EntityId[] | null>(null);

  const [renaming, setRenaming] = useState<string | null>(null); // item key
  const [dropId, setDropId] = useState<string | null>(null); // item key
  const [ctx, setCtx] = useState<{ x: number; y: number; item: OutlinerItem } | null>(null);

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
            folderOf: (id) => SceneModel.folderOf(id),
            folders: SceneModel.sceneFolders(),
          })
        : [],
    [engine.status, structRev, expanded, query],
  );
  const flatIds = useMemo(() => entityIds(items), [items]);

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

  const onRowClick = (item: OutlinerItem, e: React.MouseEvent) => {
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
    if (item.kind === 'entity' && !useSelection.getState().selectedIds.has(item.id)) select(item.id);
    setCtx({ x: e.clientX, y: e.clientY, item });
  };

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
    if (item.kind !== 'entity') return;
    dragIds.current = selectionOrTarget(item.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(item.id));
  };
  const onDragOverRow = (item: OutlinerItem, e: React.DragEvent) => {
    if (dragIds.current) e.dataTransfer.dropEffect = 'move';
    else if (isAssetDrag(e)) e.dataTransfer.dropEffect = 'copy';
    else return;
    e.preventDefault();
    if (dropId !== item.key) setDropId(item.key);
  };
  const reparent = (target: EntityId | null) => {
    const ids = dragIds.current;
    dragIds.current = null;
    setDropId(null);
    if (!ids) return;
    for (const child of ids) if (child !== target) SceneCommands.setParent(child, target);
  };
  const moveToFolder = (path: string | null) => {
    const ids = dragIds.current;
    dragIds.current = null;
    setDropId(null);
    if (ids) SceneCommands.moveToFolder(ids, path);
  };
  const onDropRow = (item: OutlinerItem, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropId(null);
    if (item.kind === 'folder') {
      if (dropPrefabAsset(e, null)) return; // prefab onto a folder → instantiate at root
      moveToFolder(item.path);
      return;
    }
    if (dropPrefabAsset(e, item.id)) return; // prefab onto an entity = under it
    reparent(item.id);
  };

  // Empty-space drop = move to the scene root (un-parent + clear folder).
  const onBodyDragOver = (e: React.DragEvent) => {
    if (dragIds.current || isAssetDrag(e)) e.preventDefault();
  };
  const onBodyDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dropPrefabAsset(e, null)) return;
    moveToFolder(null);
  };

  const ctxItems: MenuItem[] = useMemo(() => {
    if (!ctx) return [];
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
      renaming={renaming === it.key}
      isDrop={dropId === it.key}
      prefab={it.kind === 'entity' && SceneModel.prefabTag(it.id) != null}
      draggable={it.kind === 'entity'}
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
                placeholder="Search entities"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
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
            <div className="pbody" onDragOver={onBodyDragOver} onDrop={onBodyDrop}>
              <div className="empty">
                <Search size={22} strokeWidth={1.4} />
                <p>{engine.status === 'ready' ? 'No entities in scene.' : 'Waiting for engine…'}</p>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="pbody" onDragOver={onBodyDragOver} onDrop={onBodyDrop}>
              <div className="empty">
                <Search size={22} strokeWidth={1.4} />
                <p>No entities match “{query}”.</p>
              </div>
            </div>
          ) : (
            <VirtualTree
              className="pbody"
              items={items}
              rowHeight={ROW_H}
              getKey={(it) => it.key}
              renderRow={renderRow}
              onDragOver={onBodyDragOver}
              onDrop={onBodyDrop}
            />
          )}
        </>
      )}

      {ctx && !gameMode && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
    </div>
  );
}
