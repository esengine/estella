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
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import {
  fsmEdges, addState, removeState, moveState, renameState, setStateHook, setInitial,
  addTransition, removeTransition, updateTransition, actionRefName, actionRefArg,
  type FsmDefinition, type FsmState, type FsmEdge, type CompareOp,
} from 'esengine';
import { FsmGraphDocument } from '@/fsm/FsmGraphDocument';
import { t } from '@/i18n';
import { NodeGraphCanvas, type CanvasNode } from '@/components/NodeGraphCanvas';
import { Select } from '@/components/Select';
import { DirtyDot } from '@/components/DirtyDot';
import { SuggestInput } from '@/components/SuggestInput';
import { aiActionItems, aiConditionItems } from '@/components/aiSuggest';

type FsmCanvasNode = FsmState & CanvasNode;

const NODE_W = 156;
const NODE_H = 60;
const HOOKS: Array<'onEnter' | 'onUpdate' | 'onExit'> = ['onEnter', 'onUpdate', 'onExit'];
const OPS: CompareOp[] = ['==', '!=', '<', '<=', '>', '>=', 'truthy', 'falsy'];

/** A short human summary of a transition's enabling condition, for the edge label. */
function edgeSummary(tr: { trigger?: string; condition?: string; guard?: unknown }): string {
  const parts: string[] = [];
  if (tr.trigger) parts.push(`⚡${tr.trigger}`);
  if (tr.condition) parts.push(`?${tr.condition}`);
  const g = tr.guard;
  if (g && !Array.isArray(g)) {
    const gg = g as { key: string; op: string; value?: unknown };
    parts.push(gg.op === 'truthy' || gg.op === 'falsy' ? `${gg.key} ${gg.op}` : `${gg.key}${gg.op}${gg.value ?? ''}`);
  } else if (Array.isArray(g) && g.length) {
    parts.push(t('fsm.guardCount', { count: g.length }));
  }
  return parts.join('  ') || t('fsm.always');
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
    return <div className="panel ng-placeholder"><p>{t('ng.openHintPre')}<code>.esfsm</code>{t('ng.openHintPost')}</p></div>;
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
      <button type="button" className="ng-btn" onClick={addStateAt} title={t('fsm.addStateTip')}><Plus size={13} strokeWidth={2} /> {t('fsm.stateBtn')}</button>
      {(selState || selEdge) && <button type="button" className="ng-btn" title={t('ng.deleteSelected')} onClick={deleteSelected}><Trash2 size={13} strokeWidth={1.9} /></button>}
      <span className="ng-doc-title">{filePath.split('/').pop()}{dirty && <DirtyDot />}</span>
      <span style={{ flex: 1 }} />
      <button type="button" className="ng-btn primary" disabled={!dirty} onClick={save}><Save size={13} strokeWidth={1.9} /> {t('ng.save')}</button>
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
              if (after && before) FsmGraphDocument.recordEdit('Move state', before, after);
            }}
            onConnect={(from, to) => FsmGraphDocument.edit('Add transition', d => Object.assign(d, addTransition(d, from, to)))}
            onDeleteNode={id => { FsmGraphDocument.edit('Delete state', d => Object.assign(d, removeState(d, id))); setSelState(null); }}
            onDeleteEdge={id => { const p = parseEdgeId(id); if (p) FsmGraphDocument.edit('Delete transition', d => Object.assign(d, removeTransition(d, p.from, p.index))); setSelEdge(null); }}
            menuItems={target => target.kind === 'canvas'
              ? [{ label: t('fsm.menuAddState'), onClick: () => { const name = uniqueName(def, 'State'); FsmGraphDocument.edit('Add state', d => Object.assign(d, addState(d, name, target.x, target.y))); setSelState(name); setSelEdge(null); } }]
              : [
                  { label: t('fsm.menuSetInitial'), disabled: def.initial === target.nodeId, onClick: () => FsmGraphDocument.edit('Set initial', d => Object.assign(d, setInitial(d, target.nodeId!))) },
                  { sep: true },
                  { label: t('fsm.menuDeleteState'), danger: true, onClick: () => { FsmGraphDocument.edit('Delete state', d => Object.assign(d, removeState(d, target.nodeId!))); setSelState(null); } },
                ]}
            toolbar={toolbar}
            emptyHint={t('fsm.emptyHint')}
            renderEdgeLabel={e => <>{edgeSummary(e.transition)}</>}
            renderNode={(n, sel) => {
              const isInitial = def.initial === n.name;
              const setHooks = HOOKS.filter(h => actionRefName(n[h]))
                .map(h => {
                  const arg = actionRefArg(n[h]);
                  return `${h[2].toUpperCase()}:${actionRefName(n[h])}${arg ? `(${arg})` : ''}`;
                })
                .join(' ');
              return (
                <div className={`ng-node-box${sel ? ' sel' : ''}`} style={!sel && isInitial ? { borderColor: 'var(--run)' } : undefined}>
                  <div className="ng-node-head">
                    {isInitial && <span title={t('fsm.initialState')} className="ng-node-badge" style={{ color: 'var(--run)' }}>▶</span>}
                    <span className="ng-node-name">{n.name}</span>
                  </div>
                  <div className="ng-node-sub">{setHooks || <span style={{ opacity: 0.4 }}>{t('fsm.noActions')}</span>}</div>
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
  const actions = aiActionItems();
  const isInitial = def.initial === state.name;
  return (
    <div>
      <div className="ng-insp-title">{t('fsm.inspStateTitle')}</div>
      <label className="ng-field">{t('ng.name')}
        <input className="ng-input" defaultValue={state.name} key={state.name}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== state.name) { FsmGraphDocument.edit('Rename state', (d) => Object.assign(d, renameState(d, state.name, v))); onRename(v); } }} />
      </label>
      <label className="ng-check-row">
        <input type="checkbox" checked={isInitial} disabled={isInitial}
          onChange={() => FsmGraphDocument.edit('Set initial', (d) => Object.assign(d, setInitial(d, state.name)))} />
        {t('fsm.initialState')}
      </label>
      {HOOKS.map((h) => {
        const name = actionRefName(state[h]);
        const arg = actionRefArg(state[h]) ?? '';
        return (
          <label className="ng-field" key={h}>{h}
            <SuggestInput items={actions} defaultValue={name} key={`${state.name}-${h}-${name}`}
              placeholder={t('ng.phActionName')}
              onCommit={(v) => { if (v !== name) FsmGraphDocument.edit(`Set ${h}`, (d) => Object.assign(d, setStateHook(d, state.name, h, v, arg || undefined))); }} />
            {name && (
              <input className="ng-input" defaultValue={arg} key={`${state.name}-${h}-arg-${arg}`}
                placeholder={t('ng.phActionArg')} spellCheck={false}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== arg) FsmGraphDocument.edit(`Set ${h} argument`, (d) => Object.assign(d, setStateHook(d, state.name, h, name, v || undefined))); }} />
            )}
          </label>
        );
      })}
    </div>
  );
}

function TransitionInspector({ def, edgeId }: { def: FsmDefinition; edgeId: string }) {
  const parsed = parseEdgeId(edgeId);
  if (!parsed) return null;
  const src = def.states.find((s) => s.name === parsed.from);
  const tr = src?.transitions?.[parsed.index];
  if (!tr) return null;
  const conditions = aiConditionItems();
  const g = (tr.guard && !Array.isArray(tr.guard) ? tr.guard : undefined) as { key: string; op: CompareOp; value?: number | string | boolean } | undefined;
  const patch = (p: Partial<typeof tr>) => FsmGraphDocument.edit('Edit transition', (d) => Object.assign(d, updateTransition(d, parsed.from, parsed.index, p)));
  const patchGuard = (gp: Partial<NonNullable<typeof g>>) => {
    const next = { key: g?.key ?? '', op: g?.op ?? '==', value: g?.value, ...gp };
    patch({ guard: next.key ? next : undefined });
  };
  // Suggest blackboard keys already used by this FSM's guards, so a re-used key is
  // typed consistently (a typo'd guard key silently never fires).
  const guardKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const s of def.states) {
      for (const tt of s.transitions ?? []) {
        const guards = Array.isArray(tt.guard) ? tt.guard : tt.guard ? [tt.guard] : [];
        for (const x of guards) {
          const k = (x as { key?: unknown }).key;
          if (typeof k === 'string' && k) keys.add(k);
        }
      }
    }
    return [...keys].map((k) => ({ value: k }));
  }, [def]);
  return (
    <div>
      <div className="ng-insp-title">{t('fsm.inspTransitionTitle')}</div>
      <label className="ng-field">{t('fsm.target')}
        <Select
          ariaLabel={t('fsm.targetState')}
          value={tr.to}
          options={def.states.map((s) => ({ value: s.name }))}
          onChange={(v) => patch({ to: v })}
        />
      </label>
      <label className="ng-field">{t('fsm.trigger')}
        <input className="ng-input" defaultValue={tr.trigger ?? ''} key={`trg-${edgeId}`} placeholder={t('fsm.phEventName')}
          onBlur={(e) => patch({ trigger: e.target.value.trim() || undefined })} />
      </label>
      <label className="ng-field">{t('fsm.condition')}
        <SuggestInput items={conditions} defaultValue={tr.condition ?? ''} key={`cnd-${edgeId}`} placeholder={t('ng.phConditionName')}
          onCommit={(v) => patch({ condition: v || undefined })} />
      </label>
      <div className="ng-insp-sub">{t('fsm.guardSub')}</div>
      <div className="ng-row">
        <div style={{ flex: 1 }}>
          <SuggestInput items={guardKeys} defaultValue={g?.key ?? ''} key={`gk-${edgeId}`} placeholder={t('fsm.phKey')}
            onCommit={(v) => patchGuard({ key: v.trim() })} />
        </div>
        <Select
          ariaLabel={t('fsm.guardOp')}
          style={{ width: 62 }}
          value={g?.op ?? '=='}
          options={OPS.map((op) => ({ value: op }))}
          onChange={(op) => patchGuard({ op })}
        />
      </div>
      {g && g.op !== 'truthy' && g.op !== 'falsy' && (
        <label className="ng-field">{t('fsm.value')}
          <input className="ng-input" defaultValue={String(g?.value ?? '')} key={`gv-${edgeId}`} placeholder={t('fsm.phValue')}
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
