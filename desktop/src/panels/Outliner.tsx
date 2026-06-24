// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Search, Plus } from 'lucide-react';
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
import { buildOutlinerItems, collectExpandableIds } from '@/outliner/OutlinerModel';
import { useOutliner } from '@/outliner/OutlinerController';
import { OutlinerRow } from '@/outliner/OutlinerRow';
import type { EntityId } from '@/types';

// Must match .row height in outliner.css — the fixed row size the virtual list windows by.
const ROW_H = 24;
const NO_EXPANSION: ReadonlySet<EntityId> = new Set();

// One row of the live "Game" tree (UE5 PIE world): a read-only, always-expanded
// view of the running realm. A stress scene can hold thousands of live entities
// refreshed a few times a second, so it shares the editor's virtualization.
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
          selected={selection === it.id}
          collapsible={false}
          onToggle={() => {}}
          onClick={(id) => PlayInspect.select(id)}
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

  const [renaming, setRenaming] = useState<EntityId | null>(null);
  const [dropId, setDropId] = useState<EntityId | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; id: EntityId } | null>(null);

  const sceneCount = useMemo(
    () => (engine.status === 'ready' ? (SceneModel.current?.entities.length ?? 0) : 0),
    [engine.status, structRev],
  );
  const items = useMemo(
    () => (engine.status === 'ready' ? buildOutlinerItems(SceneModel.current, { expanded, query }) : []),
    [engine.status, structRev, expanded, query],
  );
  const flatIds = useMemo(() => items.map((i) => i.id), [items]);

  // First time entities appear: expand groups, select the first root.
  useEffect(() => {
    if (initRef.current || sceneCount === 0) return;
    initRef.current = true;
    useOutliner.getState().setExpanded(collectExpandableIds(SceneModel.current));
    if (useSelection.getState().selectedId == null) {
      const firstRoot = buildOutlinerItems(SceneModel.current, { expanded: NO_EXPANSION })[0]?.id;
      if (firstRoot != null) useSelection.getState().select(firstRoot);
    }
  }, [sceneCount]);

  const select = (id: EntityId | null) => useSelection.getState().select(id);

  const onRowClick = (id: EntityId, e: React.MouseEvent) => {
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

  const onContextMenu = (e: React.MouseEvent, id: EntityId) => {
    e.preventDefault();
    // Right-clicking outside the current selection selects just that entity;
    // right-clicking within it keeps the multi-selection.
    if (!useSelection.getState().selectedIds.has(id)) select(id);
    setCtx({ x: e.clientX, y: e.clientY, id });
  };
  const commitRename = (id: EntityId, name: string) => {
    setRenaming(null);
    const trimmed = name.trim();
    if (trimmed) SceneCommands.renameEntity(id, trimmed);
  };
  const addEntity = () => {
    const id = SceneCommands.addEntity();
    if (id != null) select(id);
  };
  const selectionOrTarget = (id: EntityId): EntityId[] => {
    const ids = useSelection.getState().selectedIds;
    return ids.has(id) ? [...ids] : [id];
  };

  // — Drag-to-reparent (entity rows) + drag-a-prefab-in (Content Browser) —
  const ASSET_MIME = 'application/x-estella-asset';
  const isAssetDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(ASSET_MIME);
  /** Instantiate a dropped `.esprefab` under `parent`. Returns true if handled. */
  const dropPrefabAsset = (e: React.DragEvent, parent: EntityId | null): boolean => {
    const path = e.dataTransfer.getData(ASSET_MIME);
    if (!path || !path.toLowerCase().endsWith('.esprefab')) return false;
    void ProjectStore.instantiatePrefabFromPath(path, parent);
    return true;
  };
  const onDragStartRow = (id: EntityId, e: React.DragEvent) => {
    dragIds.current = selectionOrTarget(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
  };
  const onDragOverRow = (id: EntityId, e: React.DragEvent) => {
    // Either an in-progress entity reparent (move) or a Content-Browser asset
    // (copy) — both highlight the hovered row as the drop target.
    if (dragIds.current) e.dataTransfer.dropEffect = 'move';
    else if (isAssetDrag(e)) e.dataTransfer.dropEffect = 'copy';
    else return;
    e.preventDefault();
    if (dropId !== id) setDropId(id);
  };
  const reparent = (target: EntityId | null) => {
    const ids = dragIds.current;
    dragIds.current = null;
    setDropId(null);
    if (!ids) return;
    for (const child of ids) if (child !== target) SceneCommands.setParent(child, target);
  };
  const onDropRow = (id: EntityId, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropId(null);
    if (dropPrefabAsset(e, id)) return; // drop a prefab onto an entity = under it
    reparent(id);
  };

  // Empty-space drag-drop (un-parent to root / instantiate a prefab at the root).
  const onBodyDragOver = (e: React.DragEvent) => {
    if (dragIds.current || isAssetDrag(e)) e.preventDefault();
  };
  const onBodyDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dropPrefabAsset(e, null)) return;
    reparent(null);
  };

  const ctxItems: MenuItem[] = ctx
    ? [
        { label: 'Rename', shortcut: 'F2', onClick: () => setRenaming(ctx.id) },
        {
          label: 'Duplicate',
          shortcut: '⌘D',
          onClick: () => {
            const d = SceneCommands.duplicateEntity(ctx.id);
            if (d != null) select(d);
          },
        },
        { label: 'Create Prefab', onClick: () => void ProjectStore.createPrefabFromEntity(ctx.id) },
        {
          label: 'Delete',
          shortcut: '⌫',
          onClick: () => {
            selectionOrTarget(ctx.id).forEach((i) => SceneCommands.deleteEntity(i));
            select(null);
          },
        },
        { sep: true },
        { label: 'Unparent', onClick: () => selectionOrTarget(ctx.id).forEach((i) => SceneCommands.setParent(i, null)) },
        { label: 'Add Entity', onClick: addEntity },
      ]
    : [];

  // While playing, a UE5-style world picker switches the outliner (+ Details)
  // between the edit scene and the live running game.
  const gameMode = inspectWorld === 'game';

  const renderRow = (it: (typeof items)[number]) => (
    <OutlinerRow
      item={it}
      selected={selectedIds.has(it.id)}
      renaming={renaming === it.id}
      isDrop={dropId === it.id}
      prefab={SceneModel.prefabTag(it.id) != null}
      draggable
      onToggle={toggleExpanded}
      onClick={onRowClick}
      onContextMenu={onContextMenu}
      onStartRename={setRenaming}
      onCommitRename={commitRename}
      onToggleVisible={(id, visible) => SceneCommands.setEntityVisible(id, visible)}
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
