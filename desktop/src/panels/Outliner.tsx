import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Eye, EyeOff, Lock, Search, Plus } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useSelection } from '@/store/selectionStore';
import { EngineHost } from '@/engine/EngineHost';
import { SceneStore } from '@/engine/SceneStore';
import { SceneQuery } from '@/engine/SceneQuery';
import { SceneCommands } from '@/engine/SceneCommands';
import { NodeIcon } from '@/components/icons';
import { ContextMenu, type MenuItem } from '@/components/Menu';
import type { SceneNode, EntityId } from '@/types';

interface RowProps {
  node: SceneNode;
  depth: number;
  forceExpand: boolean;
  renaming: EntityId | null;
  dropId: EntityId | null;
  onStartRename: (id: EntityId) => void;
  onCommitRename: (id: EntityId, name: string) => void;
  onContextMenu: (e: React.MouseEvent, id: EntityId) => void;
  onRowClick: (id: EntityId, e: React.MouseEvent) => void;
  onDragStartRow: (id: EntityId, e: React.DragEvent) => void;
  onDragOverRow: (id: EntityId, e: React.DragEvent) => void;
  onDropRow: (id: EntityId, e: React.DragEvent) => void;
}

function Row(props: RowProps) {
  const { node, depth, forceExpand, renaming, dropId } = props;
  const selectedIds = useSelection((s) => s.selectedIds);
  const selectedId = useSelection((s) => s.selectedId);
  const expanded = useEditorStore((s) => s.expanded);
  const toggleExpanded = useEditorStore((s) => s.toggleExpanded);

  const hasChildren = !!node.children?.length;
  const isOpen = forceExpand || expanded.has(node.id);
  const isSelected = selectedIds.has(node.id);
  const isRenaming = renaming === node.id;

  return (
    <>
      <div
        className={
          `tree-row${isSelected ? ' is-selected' : ''}` +
          `${selectedId === node.id ? ' is-primary' : ''}` +
          `${node.visible ? '' : ' is-hidden'}` +
          `${dropId === node.id ? ' is-drop' : ''}`
        }
        style={{ paddingLeft: depth * 14 + 6 }}
        draggable={!isRenaming}
        onClick={(e) => props.onRowClick(node.id, e)}
        onContextMenu={(e) => props.onContextMenu(e, node.id)}
        onDragStart={(e) => props.onDragStartRow(node.id, e)}
        onDragOver={(e) => props.onDragOverRow(node.id, e)}
        onDrop={(e) => props.onDropRow(node.id, e)}
      >
        <button
          type="button"
          className={`tree-row__twist${hasChildren ? '' : ' is-leaf'}${isOpen ? ' is-open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggleExpanded(node.id);
          }}
        >
          {hasChildren && <ChevronRight size={12} strokeWidth={2} />}
        </button>

        <span className={`tree-row__icon tree-row__icon--${node.kind}`}>
          <NodeIcon kind={node.kind} />
        </span>

        {isRenaming ? (
          <input
            className="tree-row__rename"
            defaultValue={node.name}
            autoFocus
            spellCheck={false}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              else if (e.key === 'Escape') {
                e.currentTarget.value = node.name;
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => props.onCommitRename(node.id, e.target.value)}
          />
        ) : (
          <span className="tree-row__name" onDoubleClick={() => props.onStartRename(node.id)}>
            {node.name}
          </span>
        )}

        <span className="tree-row__actions">
          {node.locked && <Lock size={12} strokeWidth={1.85} className="tree-row__lock" />}
          <button
            type="button"
            className="tree-row__vis"
            title="Toggle visibility"
            onClick={(e) => {
              e.stopPropagation();
              SceneCommands.setEntityVisible(node.id, !node.visible);
            }}
          >
            {node.visible ? <Eye size={13} strokeWidth={1.85} /> : <EyeOff size={13} strokeWidth={1.85} />}
          </button>
        </span>
      </div>

      {hasChildren &&
        isOpen &&
        node.children!.map((child) => (
          <Row key={child.id} {...props} node={child} depth={depth + 1} />
        ))}
    </>
  );
}

// Keep a node if its name matches, or any descendant does (matches + ancestors).
function filterNode(node: SceneNode, q: string): SceneNode | null {
  if (node.name.toLowerCase().includes(q)) return node;
  const kids = (node.children ?? [])
    .map((c) => filterNode(c, q))
    .filter((n): n is SceneNode => n != null);
  return kids.length ? { ...node, children: kids } : null;
}

// Flatten the visible tree (respecting expansion) into render order — for shift-range select.
function flatVisible(nodes: SceneNode[], expanded: Set<EntityId>, forceExpand: boolean, out: EntityId[]) {
  for (const n of nodes) {
    out.push(n.id);
    if ((forceExpand || expanded.has(n.id)) && n.children?.length) {
      flatVisible(n.children, expanded, forceExpand, out);
    }
  }
}

export function Outliner() {
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);
  const structRev = useSyncExternalStore(SceneStore.subscribe, SceneStore.getStructureRevision);
  const expanded = useEditorStore((s) => s.expanded);
  const initRef = useRef(false);
  const dragIds = useRef<EntityId[] | null>(null);

  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<EntityId | null>(null);
  const [dropId, setDropId] = useState<EntityId | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; id: EntityId } | null>(null);

  const tree = useMemo(
    () => (engine.status === 'ready' ? SceneQuery.readSceneTree() : []),
    [engine.status, structRev],
  );

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? tree.map((n) => filterNode(n, q)).filter((n): n is SceneNode => n != null) : tree),
    [tree, q],
  );
  const flatIds = useMemo(() => {
    const out: EntityId[] = [];
    flatVisible(shown, expanded, !!q, out);
    return out;
  }, [shown, expanded, q]);

  // First time entities appear: expand groups, select the first root.
  useEffect(() => {
    if (initRef.current || tree.length === 0) return;
    initRef.current = true;
    const parents: EntityId[] = [];
    const walk = (nodes: SceneNode[]) =>
      nodes.forEach((n) => {
        if (n.children?.length) {
          parents.push(n.id);
          walk(n.children);
        }
      });
    walk(tree);
    useEditorStore.getState().setExpanded(parents);
    if (useSelection.getState().selectedId == null) {
      useSelection.getState().select(tree[0].id);
    }
  }, [tree]);

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
    // right-clicking within it keeps the multi-selection (UE5 behaviour).
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

  // — Drag-to-reparent —
  const onDragStartRow = (id: EntityId, e: React.DragEvent) => {
    dragIds.current = selectionOrTarget(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
  };
  const onDragOverRow = (id: EntityId, e: React.DragEvent) => {
    if (!dragIds.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
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
    reparent(id);
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

  return (
    <div className="panel">
      <div className="panel__toolbar">
        <div className="searchbox">
          <Search size={13} strokeWidth={1.85} />
          <input
            className="searchbox__input"
            placeholder="Search entities"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="button" className="iconbtn" title="Add entity" onClick={addEntity}>
          <Plus size={15} strokeWidth={2} />
        </button>
      </div>
      <div
        className="panel__body tree"
        onDragOver={(e) => {
          if (dragIds.current) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          reparent(null); // drop into empty space = un-parent to the scene root
        }}
      >
        {tree.length === 0 ? (
          <div className="empty">
            <Search size={22} strokeWidth={1.4} />
            <p>{engine.status === 'ready' ? 'No entities in scene.' : 'Waiting for engine…'}</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <Search size={22} strokeWidth={1.4} />
            <p>No entities match “{query}”.</p>
          </div>
        ) : (
          shown.map((node) => (
            <Row
              key={node.id}
              node={node}
              depth={0}
              forceExpand={!!q}
              renaming={renaming}
              dropId={dropId}
              onStartRename={setRenaming}
              onCommitRename={commitRename}
              onContextMenu={onContextMenu}
              onRowClick={onRowClick}
              onDragStartRow={onDragStartRow}
              onDragOverRow={onDragOverRow}
              onDropRow={onDropRow}
            />
          ))
        )}
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
    </div>
  );
}
