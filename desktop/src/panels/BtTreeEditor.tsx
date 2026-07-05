// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BtTreeEditor.tsx
 * @brief   The `.esbt` behavior-tree editor — nodes on the shared NodeGraphCanvas,
 *          parent/child edges. All mutation goes through the pure, tested SDK
 *          btGraph ops on a reactive BtDocument (one undo step each). A `.esbt` IS
 *          the runtime BtDefinition, so Save just writes JSON — no compile step.
 *
 *          Uses the generic <NodeGraphCanvas> (shared with StateMachineEditor):
 *          drag-to-connect reparents a node under the drop target.
 */
import { useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Trash2, Save } from 'lucide-react';
import {
  btNodes, btEdges, addBtChild, addBtOrphan, removeBtNode, moveBtNode, setBtNodeField, reparentBtNode,
  canHaveChildren, maxChildren, aiRegistry,
  type BtNode, type BtNodeType, type BtDefinition, type BtEdge,
} from 'esengine';
import { BtDocument } from '@/bt/BtDocument';
import { EditorHistory } from '@/engine/EditorHistory';
import { NodeGraphCanvas, type CanvasNode, type MenuItem } from '@/panels/NodeGraphCanvas';

type BtCanvasNode = BtNode & CanvasNode;

const NODE_W = 132;
const NODE_H = 46;

const BT_TYPES: Array<{ type: BtNodeType; label: string; cat: 'composite' | 'decorator' | 'leaf' }> = [
  { type: 'sequence', label: 'Sequence', cat: 'composite' },
  { type: 'selector', label: 'Selector', cat: 'composite' },
  { type: 'parallel', label: 'Parallel', cat: 'composite' },
  { type: 'inverter', label: 'Inverter', cat: 'decorator' },
  { type: 'succeeder', label: 'Succeeder', cat: 'decorator' },
  { type: 'repeater', label: 'Repeater', cat: 'decorator' },
  { type: 'wait', label: 'Wait', cat: 'leaf' },
  { type: 'action', label: 'Action', cat: 'leaf' },
  { type: 'condition', label: 'Condition', cat: 'leaf' },
];
const specOf = (t: BtNodeType) => BT_TYPES.find(s => s.type === t)!;
const CAT_COLOR: Record<string, string> = { composite: '#7faf9c', decorator: '#8fa0c4', leaf: '#b0a080' };

function leafSummary(n: BtNode): string {
  switch (n.type) {
    case 'action':
    case 'condition': return n.name || '(unnamed)';
    case 'repeater': return `× ${(n.count ?? 0) || '∞'}`;
    case 'wait': return `${n.seconds ?? 0}s`;
    case 'parallel': return n.policy ?? 'all';
    default: return '';
  }
}

export function BtTreeEditor() {
  useSyncExternalStore(BtDocument.subscribe, BtDocument.getRevision);
  const def = BtDocument.asset;
  const filePath = BtDocument.filePath;
  const dirty = BtDocument.dirty;

  const [selected, setSelected] = useState<string | null>(null);
  const [addType, setAddType] = useState<BtNodeType>('action');
  const dragBefore = useRef<BtDefinition | null>(null);

  if (!def || !filePath) {
    return <div className="panel" style={S.empty}><p>Open a <code>.esbt</code> from the Content Browser to edit it.</p></div>;
  }

  const nodes = btNodes(def).filter((n): n is BtCanvasNode => !!n.id);
  const edges: BtEdge[] = btEdges(def);
  const selNode = selected ? nodes.find(n => n.id === selected) ?? null : null;

  const save = () => {
    void window.estella.fs.write(filePath, JSON.stringify(def, null, 2) + '\n').then(() => BtDocument.markSaved());
  };

  const addChild = (parentId: string, type: BtNodeType) => {
    BtDocument.edit('Add node', d => Object.assign(d, addBtChild(d, parentId, type, 200, 120)));
  };

  const patch = (id: string, p: Partial<BtNode>) =>
    BtDocument.edit('Edit node', d => Object.assign(d, setBtNodeField(d, id, p)));

  const toolbar = (
    <>
      <span style={S.title}>{filePath.split('/').pop()}{dirty && <span style={S.dot} title="Unsaved">●</span>}</span>
      <span style={{ flex: 1 }} />
      {selected && def.root.id !== selected && (
        <button type="button" style={S.btn} title="Delete node"
          onClick={() => { BtDocument.edit('Delete node', d => Object.assign(d, removeBtNode(d, selected))); setSelected(null); }}>
          <Trash2 size={13} strokeWidth={1.9} />
        </button>
      )}
      <button type="button" style={{ ...S.btn, ...S.primary }} disabled={!dirty} onClick={save}>
        <Save size={13} strokeWidth={1.9} /> Save
      </button>
    </>
  );

  return (
    <div style={S.root} data-bt-canvas>
      <div style={S.body}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <NodeGraphCanvas<BtCanvasNode, BtEdge>
            nodes={nodes}
            edges={edges}
            selectedNode={selected}
            selectedEdge={null}
            nodeSize={() => ({ width: NODE_W, height: NODE_H })}
            hasInput={n => def.root.id !== n.id}
            onSelectNode={setSelected}
            onSelectEdge={() => { /* BT edges are structural; not independently selectable */ }}
            onMoveNodeStart={() => { dragBefore.current = def; }}
            onMoveNode={(id, x, y) => BtDocument.replaceAsset(moveBtNode(def, id, x, y), { dirty: true })}
            onMoveNodeEnd={() => {
              const after = BtDocument.asset;
              const before = dragBefore.current;
              if (after && before) EditorHistory.record('Move node', () => BtDocument.replaceAsset(after), () => BtDocument.replaceAsset(before));
            }}
            onConnect={(from, to) => BtDocument.edit('Reparent', d => Object.assign(d, reparentBtNode(d, to, from)))}
            onDeleteNode={id => { if (def.root.id !== id) { BtDocument.edit('Delete node', d => Object.assign(d, removeBtNode(d, id))); setSelected(null); } }}
            onDeleteEdge={() => { /* structural */ }}
            menuItems={target => {
              // Canvas → create an unconnected node (wire it by dragging a
              // parent's handle onto it). Node → add a child under it directly.
              if (target.kind === 'canvas') {
                return BT_TYPES.map(spec => ({ label: `Add ${spec.label}`, onClick: () => BtDocument.edit('Add node', d => Object.assign(d, addBtOrphan(d, spec.type, target.x, target.y))) }));
              }
              const parentId = target.nodeId!;
              const parent = nodes.find(n => n.id === parentId);
              const full = !parent || (parent.children?.length ?? 0) >= maxChildren(parent.type);
              const items: MenuItem[] = [];
              if (parent && canHaveChildren(parent.type) && !full) {
                for (const spec of BT_TYPES) items.push({ label: `Add child: ${spec.label}`, onClick: () => BtDocument.edit('Add node', d => Object.assign(d, addBtChild(d, parentId, spec.type, target.x, target.y))) });
              }
              if (def.root.id !== parentId) {
                if (items.length) items.push({ label: '', sep: true, onClick: () => { /* separator */ } });
                items.push({ label: 'Delete node', onClick: () => { BtDocument.edit('Delete node', d => Object.assign(d, removeBtNode(d, parentId))); setSelected(null); } });
              }
              return items;
            }}
            toolbar={toolbar}
            emptyHint="Drag from a node's handle to another to set parent → child."
            renderNode={(n, sel) => {
              const spec = specOf(n.type);
              return (
                <div style={{ ...S.node, borderColor: sel ? 'var(--accent, #6ea9ff)' : (def.root.id === n.id ? '#c98a93' : CAT_COLOR[spec.cat]) }}>
                  <div style={S.nodeType}>{def.root.id === n.id ? '▶ ' : ''}{spec.label}</div>
                  <div style={S.nodeSub}>{leafSummary(n)}</div>
                </div>
              );
            }}
          />
        </div>

        {selNode && (
          <div style={S.inspector}>
            <div style={S.inspTitle}>Node</div>
            <label style={S.field}>Type
              <select style={S.input} value={selNode.type} onChange={e => patch(selNode.id, { type: e.target.value as BtNodeType })}>
                {BT_TYPES.map(s => <option key={s.type} value={s.type}>{s.label}</option>)}
              </select>
            </label>

            {(selNode.type === 'action' || selNode.type === 'condition') && (
              <label style={S.field}>Name
                <input style={S.input} list="bt-names" defaultValue={selNode.name ?? ''} key={`${selNode.id}-name`}
                  placeholder={selNode.type === 'action' ? 'action name' : 'condition name'}
                  onBlur={e => patch(selNode.id, { name: e.target.value.trim() || undefined })} />
              </label>
            )}
            {selNode.type === 'repeater' && (
              <label style={S.field}>Count (0 = forever)
                <input style={S.input} type="number" min={0} defaultValue={selNode.count ?? 0} key={`${selNode.id}-count`}
                  onBlur={e => patch(selNode.id, { count: Number(e.target.value) || 0 })} />
              </label>
            )}
            {selNode.type === 'wait' && (
              <label style={S.field}>Seconds
                <input style={S.input} type="number" min={0} step={0.1} defaultValue={selNode.seconds ?? 0} key={`${selNode.id}-sec`}
                  onBlur={e => patch(selNode.id, { seconds: Number(e.target.value) || 0 })} />
              </label>
            )}
            {selNode.type === 'parallel' && (
              <label style={S.field}>Success policy
                <select style={S.input} value={selNode.policy ?? 'all'} onChange={e => patch(selNode.id, { policy: e.target.value as 'all' | 'one' })}>
                  <option value="all">all children</option>
                  <option value="one">any child</option>
                </select>
              </label>
            )}

            {canHaveChildren(selNode.type) && (
              <>
                <div style={S.inspSub}>Add child</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <select style={{ ...S.input, flex: 1 }} value={addType} onChange={e => setAddType(e.target.value as BtNodeType)}>
                    {BT_TYPES.map(s => <option key={s.type} value={s.type}>{s.label}</option>)}
                  </select>
                  <button type="button" style={S.btn} onClick={() => addChild(selNode.id, addType)}>+ Add</button>
                </div>
              </>
            )}
            <datalist id="bt-names">
              {[...aiRegistry.actionNames(), ...aiRegistry.conditionNames()].map(n => <option key={n} value={n} />)}
            </datalist>
          </div>
        )}
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%' },
  empty: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.6, fontSize: 13 },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  title: { fontSize: 12, opacity: 0.85 },
  dot: { color: '#e0a03a', marginLeft: 4 },
  btn: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border, #333)', background: 'var(--panel, #222)', color: 'inherit', cursor: 'pointer' },
  primary: { background: 'var(--accent, #3a6ea5)', borderColor: 'transparent' },
  node: { boxSizing: 'border-box', width: '100%', height: '100%', borderRadius: 6, border: '1.5px solid #3a4048', background: 'var(--node, #232830)', boxShadow: '0 1px 3px rgba(0,0,0,0.4)', padding: 6, display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  nodeType: { fontSize: 12, fontWeight: 600 },
  nodeSub: { fontSize: 10, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  inspector: { width: 232, flexShrink: 0, borderLeft: '1px solid var(--border, #2a2f36)', padding: 10, overflow: 'auto', fontSize: 12 },
  inspTitle: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, marginBottom: 8 },
  inspSub: { fontSize: 11, opacity: 0.6, margin: '10px 0 4px' },
  field: { display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8, fontSize: 11 },
  input: { padding: '3px 6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border, #333)', background: 'var(--input, #1a1d22)', color: 'inherit' },
};
