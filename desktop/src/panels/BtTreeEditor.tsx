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
import { useRef, useState, useSyncExternalStore } from 'react';
import { Trash2, Save } from 'lucide-react';
import {
  btNodes, btEdges, addBtChild, addBtOrphan, removeBtNode, moveBtNode, setBtNodeField, reparentBtNode,
  canHaveChildren, maxChildren, aiRegistry,
  type BtNode, type BtNodeType, type BtDefinition, type BtEdge,
} from 'esengine';
import { BtDocument } from '@/bt/BtDocument';
import { EditorHistory } from '@/engine/EditorHistory';
import { NodeGraphCanvas, type CanvasNode, type MenuItem } from '@/panels/NodeGraphCanvas';
import { Select } from '@/components/Select';
import { DirtyDot } from '@/components/DirtyDot';

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
    return <div className="panel ng-placeholder"><p>Open a <code>.esbt</code> from the Content Browser to edit it.</p></div>;
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
      <span className="ng-doc-title">{filePath.split('/').pop()}{dirty && <DirtyDot />}</span>
      <span style={{ flex: 1 }} />
      {selected && def.root.id !== selected && (
        <button type="button" className="ng-btn" title="Delete node"
          onClick={() => { BtDocument.edit('Delete node', d => Object.assign(d, removeBtNode(d, selected))); setSelected(null); }}>
          <Trash2 size={13} strokeWidth={1.9} />
        </button>
      )}
      <button type="button" className="ng-btn primary" disabled={!dirty} onClick={save}>
        <Save size={13} strokeWidth={1.9} /> Save
      </button>
    </>
  );

  return (
    <div className="ng-editor" data-bt-canvas>
      <div className="ng-editor-body">
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
                if (items.length) items.push({ sep: true });
                items.push({ label: 'Delete node', danger: true, onClick: () => { BtDocument.edit('Delete node', d => Object.assign(d, removeBtNode(d, parentId))); setSelected(null); } });
              }
              return items;
            }}
            toolbar={toolbar}
            emptyHint="Drag from a node's handle to another to set parent → child."
            renderNode={(n, sel) => {
              const spec = specOf(n.type);
              return (
                <div className={`ng-node-box${sel ? ' sel' : ''}`} style={!sel ? { borderColor: def.root.id === n.id ? 'var(--nebula)' : CAT_COLOR[spec.cat] } : undefined}>
                  <div className="ng-node-head"><span className="ng-node-name">{def.root.id === n.id ? '▶ ' : ''}{spec.label}</span></div>
                  <div className="ng-node-sub">{leafSummary(n)}</div>
                </div>
              );
            }}
          />
        </div>

        {selNode && (
          <div className="ng-inspector">
            <div className="ng-insp-title">Node</div>
            <label className="ng-field">Type
              <Select
                ariaLabel="Node type"
                value={selNode.type}
                options={BT_TYPES.map(s => ({ value: s.type, label: s.label }))}
                onChange={v => patch(selNode.id, { type: v })}
              />
            </label>

            {(selNode.type === 'action' || selNode.type === 'condition') && (
              <label className="ng-field">Name
                <input className="ng-input" list="bt-names" defaultValue={selNode.name ?? ''} key={`${selNode.id}-name`}
                  placeholder={selNode.type === 'action' ? 'action name' : 'condition name'}
                  onBlur={e => patch(selNode.id, { name: e.target.value.trim() || undefined })} />
              </label>
            )}
            {selNode.type === 'repeater' && (
              <label className="ng-field">Count (0 = forever)
                <input className="ng-input" type="number" min={0} defaultValue={selNode.count ?? 0} key={`${selNode.id}-count`}
                  onBlur={e => patch(selNode.id, { count: Number(e.target.value) || 0 })} />
              </label>
            )}
            {selNode.type === 'wait' && (
              <label className="ng-field">Seconds
                <input className="ng-input" type="number" min={0} step={0.1} defaultValue={selNode.seconds ?? 0} key={`${selNode.id}-sec`}
                  onBlur={e => patch(selNode.id, { seconds: Number(e.target.value) || 0 })} />
              </label>
            )}
            {selNode.type === 'parallel' && (
              <label className="ng-field">Success policy
                <Select
                  ariaLabel="Success policy"
                  value={selNode.policy ?? 'all'}
                  options={[
                    { value: 'all', label: 'all children' },
                    { value: 'one', label: 'any child' },
                  ]}
                  onChange={v => patch(selNode.id, { policy: v })}
                />
              </label>
            )}

            {canHaveChildren(selNode.type) && (
              <>
                <div className="ng-insp-sub">Add child</div>
                <div className="ng-row">
                  <Select
                    ariaLabel="Child node type"
                    style={{ flex: 1 }}
                    value={addType}
                    options={BT_TYPES.map(s => ({ value: s.type, label: s.label }))}
                    onChange={setAddType}
                  />
                  <button type="button" className="ng-btn" onClick={() => addChild(selNode.id, addType)}>+ Add</button>
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
