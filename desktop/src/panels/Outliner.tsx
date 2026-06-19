import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ChevronRight, Eye, EyeOff, Lock, Search, Plus } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { EngineHost } from '@/engine/EngineHost';
import { SceneStore } from '@/engine/SceneStore';
import { SceneQuery } from '@/engine/SceneQuery';
import { SceneCommands } from '@/engine/SceneCommands';
import { NodeIcon } from '@/components/icons';
import type { SceneNode, EntityId } from '@/types';

function Row({ node, depth }: { node: SceneNode; depth: number }) {
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const expanded = useEditorStore((s) => s.expanded);
  const toggleExpanded = useEditorStore((s) => s.toggleExpanded);

  const hasChildren = !!node.children?.length;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;

  return (
    <>
      <div
        className={`tree-row${isSelected ? ' is-selected' : ''}${node.visible ? '' : ' is-hidden'}`}
        style={{ paddingLeft: depth * 14 + 6 }}
        onClick={() => select(node.id)}
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

        <span className="tree-row__name">{node.name}</span>

        <span className="tree-row__actions">
          {node.locked && <Lock size={12} strokeWidth={1.85} className="tree-row__lock" />}
          <button type="button" className="tree-row__vis" title="Toggle visibility">
            {node.visible ? (
              <Eye size={13} strokeWidth={1.85} />
            ) : (
              <EyeOff size={13} strokeWidth={1.85} />
            )}
          </button>
        </span>
      </div>

      {hasChildren &&
        isOpen &&
        node.children!.map((child) => <Row key={child.id} node={child} depth={depth + 1} />)}
    </>
  );
}

export function Outliner() {
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);
  // Rebuild the tree only when the engine pushes a structural change.
  const structRev = useSyncExternalStore(SceneStore.subscribe, SceneStore.getStructureRevision);
  const initRef = useRef(false);

  const tree = useMemo(
    () => (engine.status === 'ready' ? SceneQuery.readSceneTree() : []),
    [engine.status, structRev],
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

  return (
    <div className="panel">
      <div className="panel__toolbar">
        <div className="searchbox">
          <Search size={13} strokeWidth={1.85} />
          <input className="searchbox__input" placeholder="Search entities" spellCheck={false} />
        </div>
        <button
          type="button"
          className="iconbtn"
          title="Add entity"
          onClick={() => {
            const id = SceneCommands.addEntity();
            if (id != null) useEditorStore.getState().select(id);
          }}
        >
          <Plus size={15} strokeWidth={2} />
        </button>
      </div>
      <div className="panel__body tree">
        {tree.length === 0 ? (
          <div className="empty">
            <Search size={22} strokeWidth={1.4} />
            <p>{engine.status === 'ready' ? 'No entities in scene.' : 'Waiting for engine…'}</p>
          </div>
        ) : (
          tree.map((node) => <Row key={node.id} node={node} depth={0} />)
        )}
      </div>
    </div>
  );
}
