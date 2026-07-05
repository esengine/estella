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
import { useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import {
  fsmEdges, addState, removeState, moveState, renameState, setStateHook, setInitial,
  addTransition, removeTransition, updateTransition, aiRegistry,
  type FsmDefinition, type FsmState, type FsmEdge, type CompareOp,
} from 'esengine';
import { FsmGraphDocument } from '@/fsm/FsmGraphDocument';
import { EditorHistory } from '@/engine/EditorHistory';
import { NodeGraphCanvas, type CanvasNode } from '@/panels/NodeGraphCanvas';

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
    return <div className="panel" style={S.empty}><p>Open a <code>.esfsm</code> from the Content Browser to edit it.</p></div>;
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
      <button type="button" style={S.btn} onClick={addStateAt} title="Add state"><Plus size={13} strokeWidth={2} /> State</button>
      {(selState || selEdge) && <button type="button" style={S.btn} title="Delete selected" onClick={deleteSelected}><Trash2 size={13} strokeWidth={1.9} /></button>}
      <span style={S.title}>{filePath.split('/').pop()}{dirty && <span style={S.dot} title="Unsaved">●</span>}</span>
      <span style={{ flex: 1 }} />
      <button type="button" style={{ ...S.btn, ...S.primary }} disabled={!dirty} onClick={save}><Save size={13} strokeWidth={1.9} /> Save</button>
    </>
  );

  return (
    <div style={S.root}>
      <div style={S.body}>
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
            toolbar={toolbar}
            emptyHint="Add a state, then drag from its handle to another to add a transition."
            renderEdgeLabel={e => <>{edgeSummary(e.transition)}</>}
            renderNode={(n, sel) => {
              const isInitial = def.initial === n.name;
              const setHooks = HOOKS.filter(h => n[h]).map(h => `${h[2].toUpperCase()}:${n[h]}`).join(' ');
              return (
                <div style={{ ...S.nodeBox, borderColor: sel ? 'var(--accent, #6ea9ff)' : isInitial ? '#7faf9c' : '#3a4048' }}>
                  <div style={S.nodeHead}>
                    {isInitial && <span title="Initial state" style={S.initialBadge}>▶</span>}
                    <span style={S.nodeName}>{n.name}</span>
                  </div>
                  <div style={S.nodeHooks}>{setHooks || <span style={{ opacity: 0.4 }}>no actions</span>}</div>
                </div>
              );
            }}
          />
        </div>

        {(selState || selEdge) && (
          <div style={S.inspector}>
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
      <div style={S.inspTitle}>State</div>
      <label style={S.field}>Name
        <input style={S.input} defaultValue={state.name} key={state.name}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== state.name) { FsmGraphDocument.edit('Rename state', (d) => Object.assign(d, renameState(d, state.name, v))); onRename(v); } }} />
      </label>
      <label style={S.checkRow}>
        <input type="checkbox" checked={isInitial} disabled={isInitial}
          onChange={() => FsmGraphDocument.edit('Set initial', (d) => Object.assign(d, setInitial(d, state.name)))} />
        Initial state
      </label>
      {HOOKS.map((h) => (
        <label style={S.field} key={h}>{h}
          <input style={S.input} list="fsm-actions" defaultValue={state[h] ?? ''} key={`${state.name}-${h}-${state[h] ?? ''}`}
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
      <div style={S.inspTitle}>Transition</div>
      <label style={S.field}>Target
        <select style={S.input} value={t.to} onChange={(e) => patch({ to: e.target.value })}>
          {def.states.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
      </label>
      <label style={S.field}>Trigger (event)
        <input style={S.input} defaultValue={t.trigger ?? ''} key={`trg-${edgeId}`} placeholder="event name"
          onBlur={(e) => patch({ trigger: e.target.value.trim() || undefined })} />
      </label>
      <label style={S.field}>Condition
        <input style={S.input} list="fsm-conditions" defaultValue={t.condition ?? ''} key={`cnd-${edgeId}`} placeholder="condition name"
          onBlur={(e) => patch({ condition: e.target.value.trim() || undefined })} />
      </label>
      <datalist id="fsm-conditions">{conditions.map((c) => <option key={c} value={c} />)}</datalist>
      <div style={S.inspSub}>Guard (blackboard)</div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input style={{ ...S.input, flex: 1 }} defaultValue={g?.key ?? ''} key={`gk-${edgeId}`} placeholder="key"
          onBlur={(e) => patchGuard({ key: e.target.value.trim() })} />
        <select style={{ ...S.input, width: 62 }} value={g?.op ?? '=='} onChange={(e) => patchGuard({ op: e.target.value as CompareOp })}>
          {OPS.map((op) => <option key={op} value={op}>{op}</option>)}
        </select>
      </div>
      {g && g.op !== 'truthy' && g.op !== 'falsy' && (
        <label style={S.field}>Value
          <input style={S.input} defaultValue={String(g?.value ?? '')} key={`gv-${edgeId}`} placeholder="value"
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

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%' },
  empty: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.6, fontSize: 13 },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  btn: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border, #333)', background: 'var(--panel, #222)', color: 'inherit', cursor: 'pointer' },
  primary: { background: 'var(--accent, #3a6ea5)', borderColor: 'transparent' },
  title: { fontSize: 12, opacity: 0.85, marginLeft: 4 },
  dot: { color: '#e0a03a', marginLeft: 4 },
  nodeBox: { boxSizing: 'border-box', width: '100%', height: '100%', borderRadius: 6, border: '1.5px solid #3a4048', background: 'var(--node, #232830)', boxShadow: '0 1px 3px rgba(0,0,0,0.4)', padding: 6 },
  nodeHead: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600 },
  initialBadge: { color: '#7faf9c', fontSize: 10 },
  nodeName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  nodeHooks: { marginTop: 5, fontSize: 10.5, opacity: 0.75, lineHeight: 1.4, overflow: 'hidden' },
  inspector: { width: 232, flexShrink: 0, borderLeft: '1px solid var(--border, #2a2f36)', padding: 10, overflow: 'auto', fontSize: 12 },
  inspTitle: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, marginBottom: 8 },
  inspSub: { fontSize: 11, opacity: 0.6, margin: '10px 0 4px' },
  field: { display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8, fontSize: 11, opacity: 0.95 },
  checkRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12 },
  input: { padding: '3px 6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border, #333)', background: 'var(--input, #1a1d22)', color: 'inherit' },
};
