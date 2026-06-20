import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Eye, EyeOff, Lock, Search, Plus } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
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
  onStartRename: (id: EntityId) => void;
  onCommitRename: (id: EntityId, name: string) => void;
  onContextMenu: (e: React.MouseEvent, id: EntityId) => void;
}

function Row({ node, depth, forceExpand, renaming, onStartRename, onCommitRename, onContextMenu }: RowProps) {
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const expanded = useEditorStore((s) => s.expanded);
  const toggleExpanded = useEditorStore((s) => s.toggleExpanded);

  const hasChildren = !!node.children?.length;
  const isOpen = forceExpand || expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const isRenaming = renaming === node.id;

  return (
    <>
      <div
        className={`tree-row${isSelected ? ' is-selected' : ''}${node.visible ? '' : ' is-hidden'}`}
        style={{ paddingLeft: depth * 14 + 6 }}
        onClick={() => select(node.id)}
        onContextMenu={(e) => onContextMenu(e, node.id)}
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
            onBlur={(e) => onCommitRename(node.id, e.target.value)}
          />
        ) : (
          <span className="tree-row__name" onDoubleClick={() => onStartRename(node.id)}>
            {node.name}
          </span>
        )}

        <span className="tree-row__actions">
          {node.locked && <Lock size={12} strokeWidth={1.85} className="tree-row__lock" />}
          <button type="button" className="tree-row__vis" title="Toggle visibility">
            {node.visible ? <Eye size={13} strokeWidth={1.85} /> : <EyeOff size={13} strokeWidth={1.85} />}
          </button>
        </span>
      </div>

      {hasChildren &&
        isOpen &&
        node.children!.map((child) => (
          <Row
            key={child.id}
            node={child}
            depth={depth + 1}
            forceExpand={forceExpand}
            renaming={renaming}
            onStartRename={onStartRename}
            onCommitRename={onCommitRename}
            onContextMenu={onContextMenu}
          />
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

export function Outliner() {
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);
  // Rebuild the tree only when the engine pushes a structural change.
  const structRev = useSyncExternalStore(SceneStore.subscribe, SceneStore.getStructureRevision);
  const initRef = useRef(false);

  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<EntityId | null>(null);
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
    if (useEditorStore.getState().selectedId == null) {
      useEditorStore.getState().select(tree[0].id);
    }
  }, [tree]);

  const select = (id: EntityId | null) => useEditorStore.getState().select(id);

  const onContextMenu = (e: React.MouseEvent, id: EntityId) => {
    e.preventDefault();
    select(id);
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
            SceneCommands.deleteEntity(ctx.id);
            select(null);
          },
        },
        { sep: true },
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
      <div className="panel__body tree">
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
              onStartRename={setRenaming}
              onCommitRename={commitRename}
              onContextMenu={onContextMenu}
            />
          ))
        )}
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
    </div>
  );
}
