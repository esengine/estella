// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    StateMachineEditor.tsx
 * @brief   The `.esfsm` transition-graph editor — states as nodes, transitions as
 *          guarded edges, on the shared <NodeGraphCanvas>. All mutation goes through
 *          the pure, tested SDK fsmGraph ops on the reactive FsmGraphDocument (one
 *          undo step each). A `.esfsm` IS the runtime FsmDefinition (states carry
 *          x/y layout the interpreter ignores), so Save just writes JSON.
 *
 *          FSM specifics: self-loops (allowSelfLoop), guard labels on edges
 *          (renderEdgeLabel), and a right-side inspector for state hooks /
 *          transition trigger·condition·guard. The canvas interaction is the
 *          generic component shared with the behavior-tree editor.
 */
import { useRef, useState, useSyncExternalStore } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import {
  fsmEdges, addState, removeState, moveState, renameState, setStateHook, setInitial,
  addTransition, removeTransition, updateTransition, aiRegistry,
  type FsmDefinition, type FsmState, type FsmEdge, type CompareOp,
} from 'esengine';
import { FsmGraphDocument } from '@/fsm/FsmGraphDocument';
import { EditorHistory } from '@/engine/EditorHistory';
import { NodeGraphCanvas, type CanvasNode } from '@/components/NodeGraphCanvas';
import { Select } from '@/components/Select';
import { DirtyDot } from '@/components/DirtyDot';

type FsmCanvasNode = FsmState & CanvasNode;

const NODE_W = 156;
const NODE_H = 60;
const HOOKS: Array<'onEnter' | 'onUpdate' | 'onExit'> = ['onEnter', 'onUpdate', 'onExit'];
const OPS: CompareOp[] = ['==', '!=', '<', '<=', '>', '>=', 'truthy', 'falsy'];

/** A short human summary of a transition's enabling condition, for the edge label. */
function edgeSummary(t: { trigger?: string; condition?: string; guard?: unknown }): string {
  const parts: string[] = [];
  if (t.trigger) parts.push(`⚡${t.trigger}`);
  if (t.condition) parts.push(`?${t.condition}`);
  const g = t.guard;
  if (g && !Array.isArray(g)) {
    const gg = g as { key: string; op: string; value?: unknown };
    parts.push(gg.op === 'truthy' || gg.op === 'falsy' ? `${gg.key} ${gg.op}` : `${gg.key}${gg.op}${gg.value ?? ''}`);
  } else if (Array.isArray(g) && g.length) {
    parts.push(`${g.length} guards`);
  }
  return parts.join('  ') || '(always)';
}

export function StateMachineEditor() {
  useSyncExternalStore(FsmGraphDocument.subscribe, FsmGraphDocument.getRevision);
  const def = FsmGraphDocument.asset;
  const filePath = FsmGraphDocument.filePath;
  const dirty = FsmGraphDocument.dirty;

  const [selState, setSelState] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const dragBefore = useRef<FsmDefinition | null>(null);

  if (!def || !filePath) {
    return <div className="panel ng-placeholder"><p>Open a <code>.esfsm</code> from the Content Browser to edit it.</p></div>;
  }

  const nodes: FsmCanvasNode[] = def.states.map(s => ({ ...s, id: s.name }));
  const edges: FsmEdge[] = fsmEdges(def);
  const byName = new Map(def.states.map(s => [s.name, s]));

  const addStateAt = () => {
    const name = uniqueName(def, 'State');
    FsmGraphDocument.edit('Add state', d => Object.assign(d, addState(d, name, 200, 120)));
    setSelState(name);
    setSelEdge(null);
  };
  const deleteSelected = () => {
    if (selState) { FsmGraphDocument.edit('Delete state', d => Object.assign(d, removeState(d, selState))); setSelState(null); }
    else if (selEdge) { const p = parseEdgeId(selEdge); if (p) FsmGraphDocument.edit('Delete transition', d => Object.assign(d, removeTransition(d, p.from, p.index))); setSelEdge(null); }
  };
  const save = () => {
    void window.estella.fs.write(filePath, JSON.stringify(def, null, 2) + '\n').then(() => FsmGraphDocument.markSaved());
  };

  const toolbar = (
    <>
      <button type="button" className="ng-btn" onClick={addStateAt} title="Add state"><Plus size={13} strokeWidth={2} /> State</button>
      {(selState || selEdge) && <button type="button" className="ng-btn" title="Delete selected" onClick={deleteSelected}><Trash2 size={13} strokeWidth={1.9} /></button>}
      <span className="ng-doc-title">{filePath.split('/').pop()}{dirty && <DirtyDot />}</span>
      <span style={{ flex: 1 }} />
      <button type="button" className="ng-btn primary" disabled={!dirty} onClick={save}><Save size={13} strokeWidth={1.9} /> Save</button>
    </>
  );

  return (
    <div className="ng-editor">
      <div className="ng-editor-body">
        <div style={{ flex: 1, minWidth: 0 }}>
          <NodeGraphCanvas<FsmCanvasNode, FsmEdge>
            nodes={nodes}
            edges={edges}
            selectedNode={selState}
            selectedEdge={selEdge}
            nodeSize={() => ({ width: NODE_W, height: NODE_H })}
            allowSelfLoop
            onSelectNode={setSelState}
            onSelectEdge={setSelEdge}
            onMoveNodeStart={() => { dragBefore.current = def; }}
            onMoveNode={(id, x, y) => FsmGraphDocument.replaceAsset(moveState(def, id, x, y), { dirty: true })}
            onMoveNodeEnd={() => {
              const after = FsmGraphDocument.asset;
              const before = dragBefore.current;
              if (after && before) EditorHistory.record('Move state', () => FsmGraphDocument.replaceAsset(after), () => FsmGraphDocument.replaceAsset(before));
            }}
            onConnect={(from, to) => FsmGraphDocument.edit('Add transition', d => Object.assign(d, addTransition(d, from, to)))}
            onDeleteNode={id => { FsmGraphDocument.edit('Delete state', d => Object.assign(d, removeState(d, id))); setSelState(null); }}
            onDeleteEdge={id => { const p = parseEdgeId(id); if (p) FsmGraphDocument.edit('Delete transition', d => Object.assign(d, removeTransition(d, p.from, p.index))); setSelEdge(null); }}
            menuItems={target => target.kind === 'canvas'
              ? [{ label: 'Add State', onClick: () => { const name = uniqueName(def, 'State'); FsmGraphDocument.edit('Add state', d => Object.assign(d, addState(d, name, target.x, target.y))); setSelState(name); setSelEdge(null); } }]
              : [
                  { label: 'Set as initial', disabled: def.initial === target.nodeId, onClick: () => FsmGraphDocument.edit('Set initial', d => Object.assign(d, setInitial(d, target.nodeId!))) },
                  { sep: true },
                  { label: 'Delete state', danger: true, onClick: () => { FsmGraphDocument.edit('Delete state', d => Object.assign(d, removeState(d, target.nodeId!))); setSelState(null); } },
                ]}
            toolbar={toolbar}
            emptyHint="Add a state, then drag from its handle to another to add a transition."
            renderEdgeLabel={e => <>{edgeSummary(e.transition)}</>}
            renderNode={(n, sel) => {
              const isInitial = def.initial === n.name;
              const setHooks = HOOKS.filter(h => n[h]).map(h => `${h[2].toUpperCase()}:${n[h]}`).join(' ');
              return (
                <div className={`ng-node-box${sel ? ' sel' : ''}`} style={!sel && isInitial ? { borderColor: 'var(--run)' } : undefined}>
                  <div className="ng-node-head">
                    {isInitial && <span title="Initial state" className="ng-node-badge" style={{ color: 'var(--run)' }}>▶</span>}
                    <span className="ng-node-name">{n.name}</span>
                  </div>
                  <div className="ng-node-sub">{setHooks || <span style={{ opacity: 0.4 }}>no actions</span>}</div>
                </div>
              );
            }}
          />
        </div>

        {(selState || selEdge) && (
          <div className="ng-inspector">
            {selState && byName.get(selState) && <StateInspector def={def} state={byName.get(selState)!} onRename={setSelState} />}
            {selEdge && parseEdgeId(selEdge) && <TransitionInspector def={def} edgeId={selEdge} />}
          </div>
        )}
      </div>
    </div>
  );
}

function StateInspector({ def, state, onRename }: { def: FsmDefinition; state: FsmState; onRename: (n: string) => void }) {
  const actions = aiRegistry.actionNames();
  const isInitial = def.initial === state.name;
  return (
    <div>
      <div className="ng-insp-title">State</div>
      <label className="ng-field">Name
        <input className="ng-input" defaultValue={state.name} key={state.name}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== state.name) { FsmGraphDocument.edit('Rename state', (d) => Object.assign(d, renameState(d, state.name, v))); onRename(v); } }} />
      </label>
      <label className="ng-check-row">
        <input type="checkbox" checked={isInitial} disabled={isInitial}
          onChange={() => FsmGraphDocument.edit('Set initial', (d) => Object.assign(d, setInitial(d, state.name)))} />
        Initial state
      </label>
      {HOOKS.map((h) => (
        <label className="ng-field" key={h}>{h}
          <input className="ng-input" list="fsm-actions" defaultValue={state[h] ?? ''} key={`${state.name}-${h}-${state[h] ?? ''}`}
            placeholder="action name"
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (state[h] ?? '')) FsmGraphDocument.edit(`Set ${h}`, (d) => Object.assign(d, setStateHook(d, state.name, h, v))); }} />
        </label>
      ))}
      <datalist id="fsm-actions">{actions.map((a) => <option key={a} value={a} />)}</datalist>
    </div>
  );
}

function TransitionInspector({ def, edgeId }: { def: FsmDefinition; edgeId: string }) {
  const parsed = parseEdgeId(edgeId);
  if (!parsed) return null;
  const src = def.states.find((s) => s.name === parsed.from);
  const t = src?.transitions?.[parsed.index];
  if (!t) return null;
  const conditions = aiRegistry.conditionNames();
  const g = (t.guard && !Array.isArray(t.guard) ? t.guard : undefined) as { key: string; op: CompareOp; value?: number | string | boolean } | undefined;
  const patch = (p: Partial<typeof t>) => FsmGraphDocument.edit('Edit transition', (d) => Object.assign(d, updateTransition(d, parsed.from, parsed.index, p)));
  const patchGuard = (gp: Partial<NonNullable<typeof g>>) => {
    const next = { key: g?.key ?? '', op: g?.op ?? '==', value: g?.value, ...gp };
    patch({ guard: next.key ? next : undefined });
  };
  return (
    <div>
      <div className="ng-insp-title">Transition</div>
      <label className="ng-field">Target
        <Select
          ariaLabel="Target state"
          value={t.to}
          options={def.states.map((s) => ({ value: s.name }))}
          onChange={(v) => patch({ to: v })}
        />
      </label>
      <label className="ng-field">Trigger (event)
        <input className="ng-input" defaultValue={t.trigger ?? ''} key={`trg-${edgeId}`} placeholder="event name"
          onBlur={(e) => patch({ trigger: e.target.value.trim() || undefined })} />
      </label>
      <label className="ng-field">Condition
        <input className="ng-input" list="fsm-conditions" defaultValue={t.condition ?? ''} key={`cnd-${edgeId}`} placeholder="condition name"
          onBlur={(e) => patch({ condition: e.target.value.trim() || undefined })} />
      </label>
      <datalist id="fsm-conditions">{conditions.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="ng-insp-sub">Guard (blackboard)</div>
      <div className="ng-row">
        <input className="ng-input" style={{ flex: 1 }} defaultValue={g?.key ?? ''} key={`gk-${edgeId}`} placeholder="key"
          onBlur={(e) => patchGuard({ key: e.target.value.trim() })} />
        <Select
          ariaLabel="Guard operator"
          style={{ width: 62 }}
          value={g?.op ?? '=='}
          options={OPS.map((op) => ({ value: op }))}
          onChange={(op) => patchGuard({ op })}
        />
      </div>
      {g && g.op !== 'truthy' && g.op !== 'falsy' && (
        <label className="ng-field">Value
          <input className="ng-input" defaultValue={String(g?.value ?? '')} key={`gv-${edgeId}`} placeholder="value"
            onBlur={(e) => patchGuard({ value: coerce(e.target.value) })} />
        </label>
      )}
    </div>
  );
}

// -- helpers ----------------------------------------------------------------

function parseEdgeId(id: string): { from: string; index: number } | null {
  const m = /^(.*)->.*#(\d+)$/.exec(id);
  return m ? { from: m[1], index: Number(m[2]) } : null;
}

function uniqueName(def: FsmDefinition, base: string): string {
  if (!def.states.some((s) => s.name === base)) return base;
  for (let i = 1; ; i++) {
    const n = `${base}${i}`;
    if (!def.states.some((s) => s.name === n)) return n;
  }
}

function coerce(v: string): number | string | boolean {
  const t = v.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
  return t;
}
