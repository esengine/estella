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
import { Plus, Trash2, Network } from 'lucide-react';
import {
  btNodes, btEdges, addBtChild, addBtOrphan, removeBtNode, moveBtNode, setBtNodeField, reparentBtNode,
  canHaveChildren, maxChildren,
  type BtNode, type BtNodeType, type BtDefinition, type BtEdge,
} from 'esengine';
import { BtDocument } from '@/bt/BtDocument';
import { t } from '@/i18n';
import { NodeGraphCanvas, type CanvasNode, type MenuItem, type NodeGraphCanvasApi } from '@/components/NodeGraphCanvas';
import { EmptyState } from '@/components/EmptyState';
import { Select } from '@/components/Select';
import { SaveButton } from '@/components/SaveButton';
import { SuggestInput } from '@/components/SuggestInput';
import { aiActionItems, aiConditionItems } from '@/components/aiSuggest';
import { ActionParams } from '@/ai/ParamControls';
import { actionParams } from '@/ai/actionCatalog';

type BtCanvasNode = BtNode & CanvasNode;

const NODE_W = 132;
const NODE_H = 46;

const BT_TYPES: Array<{ type: BtNodeType; label: string; cat: 'composite' | 'decorator' | 'leaf' }> = [
  { type: 'sequence', label: t('bt.typeSequence'), cat: 'composite' },
  { type: 'selector', label: t('bt.typeSelector'), cat: 'composite' },
  { type: 'parallel', label: t('bt.typeParallel'), cat: 'composite' },
  { type: 'inverter', label: t('bt.typeInverter'), cat: 'decorator' },
  { type: 'succeeder', label: t('bt.typeSucceeder'), cat: 'decorator' },
  { type: 'repeater', label: t('bt.typeRepeater'), cat: 'decorator' },
  { type: 'wait', label: t('bt.typeWait'), cat: 'leaf' },
  { type: 'action', label: t('bt.typeAction'), cat: 'leaf' },
  { type: 'condition', label: t('bt.typeCondition'), cat: 'leaf' },
];
const specOf = (t: BtNodeType) => BT_TYPES.find(s => s.type === t)!;
const CAT_COLOR: Record<string, string> = { composite: '#7faf9c', decorator: '#8fa0c4', leaf: '#b0a080' };

function leafSummary(n: BtNode): string {
  switch (n.type) {
    case 'action':
    case 'condition': return n.name || t('bt.unnamed');
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
  const canvas = useRef<NodeGraphCanvasApi>(null);

  if (!def || !filePath) {
    return (
      <div className="panel">
        <EmptyState
          icon={Network}
          title={t('ng.btEmpty')}
          hint={<>{t('ng.openHintPre')}<code>.esbt</code>{t('ng.openHintPost')}</>}
        />
      </div>
    );
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
      <button type="button" className="ng-btn" title={t('bt.addNodeTip')}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); canvas.current?.openMenuAt(r.left, r.bottom + 2); }}>
        <Plus size={13} strokeWidth={2} /> {t('bt.addNode')}
      </button>
      <span className="ng-doc-title">{filePath.split('/').pop()}</span>
      <span style={{ flex: 1 }} />
      {selected && def.root.id !== selected && (
        <button type="button" className="ng-btn" title={t('bt.deleteNode')}
          onClick={() => { BtDocument.edit('Delete node', d => Object.assign(d, removeBtNode(d, selected))); setSelected(null); }}>
          <Trash2 size={13} strokeWidth={1.9} />
        </button>
      )}
      <SaveButton dirty={dirty} onSave={save} label={t('ng.save')} />
    </>
  );

  return (
    <div className="ng-editor" data-bt-canvas>
      <div className="ng-editor-body">
        <div style={{ flex: 1, minWidth: 0 }}>
          <NodeGraphCanvas<BtCanvasNode, BtEdge>
            apiRef={canvas}
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
              if (after && before) BtDocument.recordEdit('Move node', before, after);
            }}
            onConnect={(from, to) => BtDocument.edit('Reparent', d => Object.assign(d, reparentBtNode(d, to, from)))}
            onDeleteNode={id => { if (def.root.id !== id) { BtDocument.edit('Delete node', d => Object.assign(d, removeBtNode(d, id))); setSelected(null); } }}
            onDeleteEdge={() => { /* structural */ }}
            menuItems={target => {
              // Canvas → create an unconnected node (wire it by dragging a
              // parent's handle onto it). Node → add a child under it directly.
              if (target.kind === 'canvas') {
                return BT_TYPES.map(spec => ({ label: t('bt.menuAdd', { type: spec.label }), onClick: () => BtDocument.edit('Add node', d => Object.assign(d, addBtOrphan(d, spec.type, target.x, target.y))) }));
              }
              const parentId = target.nodeId!;
              const parent = nodes.find(n => n.id === parentId);
              const full = !parent || (parent.children?.length ?? 0) >= maxChildren(parent.type);
              const items: MenuItem[] = [];
              if (parent && canHaveChildren(parent.type) && !full) {
                for (const spec of BT_TYPES) items.push({ label: t('bt.menuAddChild', { type: spec.label }), onClick: () => BtDocument.edit('Add node', d => Object.assign(d, addBtChild(d, parentId, spec.type, target.x, target.y))) });
              }
              if (def.root.id !== parentId) {
                if (items.length) items.push({ sep: true });
                items.push({ label: t('bt.deleteNode'), danger: true, onClick: () => { BtDocument.edit('Delete node', d => Object.assign(d, removeBtNode(d, parentId))); setSelected(null); } });
              }
              return items;
            }}
            toolbar={toolbar}
            emptyHint={t('bt.emptyHint')}
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
            <div className="ng-insp-title">{t('bt.inspNodeTitle')}</div>
            <label className="ng-field">{t('bt.type')}
              <Select
                ariaLabel={t('bt.nodeType')}
                value={selNode.type}
                options={BT_TYPES.map(s => ({ value: s.type, label: s.label }))}
                onChange={v => patch(selNode.id, { type: v })}
              />
            </label>

            {(selNode.type === 'action' || selNode.type === 'condition') && (
              <label className="ng-field">{t('ng.name')}
                <SuggestInput
                  items={selNode.type === 'action' ? aiActionItems() : aiConditionItems()}
                  defaultValue={selNode.name ?? ''} key={`${selNode.id}-name`}
                  placeholder={selNode.type === 'action' ? t('ng.phActionName') : t('ng.phConditionName')}
                  // The old input belongs to the old action — switching drops both forms.
                  onCommit={v => { if (v !== (selNode.name ?? '')) patch(selNode.id, { name: v || undefined, arg: undefined, params: undefined }); }} />
              </label>
            )}
            {/* A leaf whose action declares parameters gets the same controls an
                event wire renders; anything else keeps the free-text argument. */}
            {selNode.type === 'action' && actionParams(selNode.name ?? '').length === 0 && (
              <label className="ng-field">{t('ng.actionArg')}
                <input className="ng-input" defaultValue={selNode.arg ?? ''} key={`${selNode.id}-arg`}
                  placeholder={t('ng.phActionArg')} spellCheck={false}
                  onBlur={e => { const v = e.target.value.trim(); if (v !== (selNode.arg ?? '')) patch(selNode.id, { arg: v || undefined }); }} />
              </label>
            )}
            {selNode.type === 'action' && actionParams(selNode.name ?? '').length > 0 && (
              <label className="ng-field">{t('ng.actionArg')}
                <ActionParams
                  action={selNode.name ?? ''}
                  params={selNode.params}
                  arg={selNode.arg}
                  onChange={next => patch(selNode.id, { params: next, arg: undefined })}
                />
              </label>
            )}
            {selNode.type === 'repeater' && (
              <label className="ng-field">{t('bt.count')}
                <input className="ng-input" type="number" min={0} defaultValue={selNode.count ?? 0} key={`${selNode.id}-count`}
                  onBlur={e => patch(selNode.id, { count: Number(e.target.value) || 0 })} />
              </label>
            )}
            {selNode.type === 'wait' && (
              <label className="ng-field">{t('bt.seconds')}
                <input className="ng-input" type="number" min={0} step={0.1} defaultValue={selNode.seconds ?? 0} key={`${selNode.id}-sec`}
                  onBlur={e => patch(selNode.id, { seconds: Number(e.target.value) || 0 })} />
              </label>
            )}
            {selNode.type === 'parallel' && (
              <label className="ng-field">{t('bt.successPolicy')}
                <Select
                  ariaLabel={t('bt.successPolicy')}
                  value={selNode.policy ?? 'all'}
                  options={[
                    { value: 'all', label: t('bt.policyAll') },
                    { value: 'one', label: t('bt.policyOne') },
                  ]}
                  onChange={v => patch(selNode.id, { policy: v })}
                />
              </label>
            )}

            {canHaveChildren(selNode.type) && (
              <>
                <div className="ng-insp-sub">{t('bt.addChildSub')}</div>
                <div className="ng-row">
                  <Select
                    ariaLabel={t('bt.childNodeType')}
                    style={{ flex: 1 }}
                    value={addType}
                    options={BT_TYPES.map(s => ({ value: s.type, label: s.label }))}
                    onChange={setAddType}
                  />
                  <button type="button" className="ng-btn" onClick={() => addChild(selNode.id, addType)}>{t('bt.addBtn')}</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
