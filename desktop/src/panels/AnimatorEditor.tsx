// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimatorEditor.tsx
 * @brief   The `.esanimator` animation-controller editor — states as nodes,
 *          transitions as condition-guarded edges, on the shared <NodeGraphCanvas>.
 *          All mutation goes through the pure, tested SDK animatorGraph ops on the
 *          reactive AnimatorGraphDocument (one undo step each). A `.esanimator` IS
 *          the runtime AnimatorControllerDef (states carry x/y layout the
 *          interpreter ignores), so Save just writes JSON.
 *
 *          Animator specifics vs the FSM editor: a global Parameters list, a state
 *          motion (sprite clip + speed/loop) instead of hooks, and transitions
 *          carrying an AND-list of typed parameter conditions + an exit-time flag.
 */
import { useRef, useState, useSyncExternalStore } from 'react';
import { Plus, Trash2, X, Film } from 'lucide-react';
import {
  animatorEdges,
  addAnimatorState, removeAnimatorState, moveAnimatorState, renameAnimatorState, setAnimatorInitial,
  setAnimatorStateClip, setAnimatorStateProps,
  addAnimatorTransition, removeAnimatorTransition, updateAnimatorTransition, setAnimatorConditions,
  addAnimatorParam, removeAnimatorParam, updateAnimatorParam,
  type AnimatorControllerDef, type AnimatorState, type AnimatorEdge,
  type AnimatorCondition, type AnimatorTransition, type AnimatorParamType,
} from 'esengine';
import { AnimatorGraphDocument } from '@/animator/AnimatorGraphDocument';
import { t } from '@/i18n';
import { NodeGraphCanvas, type CanvasNode, type NodeGraphCanvasApi } from '@/components/NodeGraphCanvas';
import { EmptyState } from '@/components/EmptyState';
import { Select } from '@/components/Select';
import { SaveButton } from '@/components/SaveButton';

type AnimatorCanvasNode = AnimatorState & CanvasNode;

const NODE_W = 156;
const NODE_H = 60;
const NUM_OPS = ['gt', 'lt', 'eq', 'neq'] as const;
const ALL_OPS = ['gt', 'lt', 'eq', 'neq', 'true', 'false', 'trigger'] as const;
const OP_SYM: Record<string, string> = { gt: '>', lt: '<', eq: '=', neq: '≠', true: '=true', false: '=false', trigger: '⚡' };
const PARAM_TYPES: AnimatorParamType[] = ['float', 'bool', 'trigger'];

function condLabel(c: AnimatorCondition): string {
  if (c.op === 'gt' || c.op === 'lt' || c.op === 'eq' || c.op === 'neq') return `${c.param}${OP_SYM[c.op]}${c.value}`;
  if (c.op === 'trigger') return `⚡${c.param}`;
  return `${c.param}${OP_SYM[c.op]}`;
}

/** A short human summary of a transition's enabling conditions, for the edge label. */
function edgeSummary(tr: AnimatorTransition): string {
  const parts = tr.conditions.map(condLabel);
  if (tr.hasExitTime) parts.push('⏱');
  return parts.join('  ') || t('anim.always');
}

/** Short display for a state's motion (a sprite clip's file name, or the kind). */
function motionLabel(s: AnimatorState): string {
  if (s.clip) return s.clip.split('/').pop()?.replace(/\.[^.]+$/, '') ?? s.clip;
  if (s.blend) return t('anim.motionBlend');
  if (s.spine) return t('anim.motionSpine');
  if (s.stateMachine) return t('anim.motionNested');
  return '';
}

export function AnimatorEditor() {
  useSyncExternalStore(AnimatorGraphDocument.subscribe, AnimatorGraphDocument.getRevision);
  const def = AnimatorGraphDocument.asset;
  const filePath = AnimatorGraphDocument.filePath;
  const dirty = AnimatorGraphDocument.dirty;

  const [selState, setSelState] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const dragBefore = useRef<AnimatorControllerDef | null>(null);
  const canvas = useRef<NodeGraphCanvasApi>(null);

  if (!def || !filePath) {
    return (
      <div className="panel">
        <EmptyState
          icon={Film}
          title={t('ng.animatorEmpty')}
          hint={<>{t('ng.openHintPre')}<code>.esanimator</code>{t('ng.openHintPost')}</>}
        />
      </div>
    );
  }

  const nodes: AnimatorCanvasNode[] = def.states.map((s) => ({ ...s, id: s.name }));
  const edges: AnimatorEdge[] = animatorEdges(def);
  const byName = new Map(def.states.map((s) => [s.name, s]));

  const addStateAt = () => {
    const name = uniqueName(def, 'State');
    // View-centre drop + per-state cascade (see StateMachineEditor).
    const c = canvas.current?.centerWorld() ?? { x: 200, y: 120 };
    const k = (def.states.length % 6) * 26;
    AnimatorGraphDocument.edit('Add state', (d) => Object.assign(d, addAnimatorState(d, name, Math.round(c.x - NODE_W / 2 + k), Math.round(c.y - NODE_H / 2 + k))));
    setSelState(name);
    setSelEdge(null);
  };
  const deleteSelected = () => {
    if (selState) { AnimatorGraphDocument.edit('Delete state', (d) => Object.assign(d, removeAnimatorState(d, selState))); setSelState(null); }
    else if (selEdge) { const p = parseEdgeId(selEdge); if (p) AnimatorGraphDocument.edit('Delete transition', (d) => Object.assign(d, removeAnimatorTransition(d, p.from, p.index))); setSelEdge(null); }
  };
  const save = () => {
    void window.estella.fs.write(filePath, JSON.stringify(def, null, 2) + '\n').then(() => AnimatorGraphDocument.markSaved());
  };

  const toolbar = (
    <>
      <button type="button" className="ng-btn" onClick={addStateAt} title={t('anim.addStateTip')}><Plus size={13} strokeWidth={2} /> {t('anim.stateBtn')}</button>
      {(selState || selEdge) && <button type="button" className="ng-btn" title={t('ng.deleteSelected')} onClick={deleteSelected}><Trash2 size={13} strokeWidth={1.9} /></button>}
      <span className="ng-doc-title">{filePath.split('/').pop()}</span>
      <span style={{ flex: 1 }} />
      <SaveButton dirty={dirty} onSave={save} label={t('ng.save')} />
    </>
  );

  return (
    <div className="ng-editor">
      <div className="ng-editor-body">
        <div style={{ flex: 1, minWidth: 0 }}>
          <NodeGraphCanvas<AnimatorCanvasNode, AnimatorEdge>
            apiRef={canvas}
            nodes={nodes}
            edges={edges}
            selectedNode={selState}
            selectedEdge={selEdge}
            nodeSize={() => ({ width: NODE_W, height: NODE_H })}
            allowSelfLoop
            onSelectNode={setSelState}
            onSelectEdge={setSelEdge}
            onMoveNodeStart={() => { dragBefore.current = def; }}
            onMoveNode={(id, x, y) => AnimatorGraphDocument.replaceAsset(moveAnimatorState(def, id, x, y), { dirty: true })}
            onMoveNodeEnd={() => {
              const after = AnimatorGraphDocument.asset;
              const before = dragBefore.current;
              if (after && before) AnimatorGraphDocument.recordEdit('Move state', before, after);
            }}
            onConnect={(from, to) => AnimatorGraphDocument.edit('Add transition', (d) => Object.assign(d, addAnimatorTransition(d, from, to)))}
            onDeleteNode={(id) => { AnimatorGraphDocument.edit('Delete state', (d) => Object.assign(d, removeAnimatorState(d, id))); setSelState(null); }}
            onDeleteEdge={(id) => { const p = parseEdgeId(id); if (p) AnimatorGraphDocument.edit('Delete transition', (d) => Object.assign(d, removeAnimatorTransition(d, p.from, p.index))); setSelEdge(null); }}
            menuItems={(target) => target.kind === 'canvas'
              ? [{ label: t('anim.menuAddState'), onClick: () => { const name = uniqueName(def, 'State'); AnimatorGraphDocument.edit('Add state', (d) => Object.assign(d, addAnimatorState(d, name, target.x, target.y))); setSelState(name); setSelEdge(null); } }]
              : [
                  { label: t('anim.menuSetInitial'), disabled: def.initialState === target.nodeId, onClick: () => AnimatorGraphDocument.edit('Set initial', (d) => Object.assign(d, setAnimatorInitial(d, target.nodeId!))) },
                  { sep: true },
                  { label: t('anim.menuDeleteState'), danger: true, onClick: () => { AnimatorGraphDocument.edit('Delete state', (d) => Object.assign(d, removeAnimatorState(d, target.nodeId!))); setSelState(null); } },
                ]}
            toolbar={toolbar}
            emptyHint={t('anim.emptyHint')}
            renderEdgeLabel={(e) => <>{edgeSummary(e.transition)}</>}
            renderNode={(n, sel) => {
              const isInitial = def.initialState === n.name;
              const motion = motionLabel(n);
              return (
                <div className={`ng-node-box${sel ? ' sel' : ''}`} style={!sel && isInitial ? { borderColor: 'var(--run)' } : undefined}>
                  <div className="ng-node-head">
                    {isInitial && <span title={t('anim.initialState')} className="ng-node-badge" style={{ color: 'var(--run)' }}>▶</span>}
                    <span className="ng-node-name">{n.name}</span>
                  </div>
                  <div className="ng-node-sub">{motion || <span style={{ opacity: 0.4 }}>{t('anim.noMotion')}</span>}</div>
                </div>
              );
            }}
          />
        </div>

        <div className="ng-inspector">
          <ParametersInspector def={def} />
          {selState && byName.get(selState) && <StateInspector def={def} state={byName.get(selState)!} onRename={setSelState} />}
          {selEdge && parseEdgeId(selEdge) && <TransitionInspector def={def} edgeId={selEdge} />}
        </div>
      </div>
    </div>
  );
}

function ParametersInspector({ def }: { def: AnimatorControllerDef }) {
  const add = () => AnimatorGraphDocument.edit('Add parameter', (d) => Object.assign(d, addAnimatorParam(d, uniqueParam(def), 'float')));
  return (
    <div>
      <div className="ng-insp-title">
        {t('anim.params')}
        <button type="button" className="ng-btn" style={{ marginLeft: 'auto' }} title={t('anim.addParam')} onClick={add}><Plus size={12} /></button>
      </div>
      {def.parameters.length === 0 && <div className="ng-insp-sub" style={{ opacity: 0.5 }}>{t('anim.noParams')}</div>}
      {def.parameters.map((p) => (
        <div className="ng-row" key={p.name}>
          <input
            className="ng-input" style={{ flex: 1 }} defaultValue={p.name} key={`pn-${p.name}`} spellCheck={false}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) AnimatorGraphDocument.edit('Rename parameter', (d) => Object.assign(d, updateAnimatorParam(d, p.name, { name: v }))); }}
          />
          <Select
            ariaLabel={t('anim.paramType')}
            style={{ width: 84 }}
            value={p.type}
            options={PARAM_TYPES.map((ty) => ({ value: ty, label: t(`anim.type.${ty}` as 'anim.type.float') }))}
            onChange={(ty) => AnimatorGraphDocument.edit('Set parameter type', (d) => Object.assign(d, updateAnimatorParam(d, p.name, { type: ty as AnimatorParamType })))}
          />
          <button type="button" className="ng-btn" title={t('anim.removeParam')} onClick={() => AnimatorGraphDocument.edit('Remove parameter', (d) => Object.assign(d, removeAnimatorParam(d, p.name)))}><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}

function StateInspector({ def, state, onRename }: { def: AnimatorControllerDef; state: AnimatorState; onRename: (n: string) => void }) {
  const isInitial = def.initialState === state.name;
  return (
    <div>
      <div className="ng-insp-title">{t('anim.inspStateTitle')}</div>
      <label className="ng-field">{t('ng.name')}
        <input className="ng-input" defaultValue={state.name} key={state.name}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== state.name) { AnimatorGraphDocument.edit('Rename state', (d) => Object.assign(d, renameAnimatorState(d, state.name, v))); onRename(v); } }} />
      </label>
      <label className="ng-check-row">
        <input type="checkbox" checked={isInitial} disabled={isInitial}
          onChange={() => AnimatorGraphDocument.edit('Set initial', (d) => Object.assign(d, setAnimatorInitial(d, state.name)))} />
        {t('anim.initialState')}
      </label>
      <label className="ng-field">{t('anim.clip')}
        <input className="ng-input" defaultValue={state.clip ?? ''} key={`clip-${state.name}-${state.clip ?? ''}`} spellCheck={false}
          placeholder={t('anim.phClip')}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (state.clip ?? '')) AnimatorGraphDocument.edit('Set clip', (d) => Object.assign(d, setAnimatorStateClip(d, state.name, v))); }} />
      </label>
      <div className="ng-row">
        <label className="ng-field" style={{ flex: 1 }}>{t('anim.speed')}
          <input className="ng-input" type="number" step={0.1} defaultValue={state.speed ?? 1} key={`sp-${state.name}`}
            onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) AnimatorGraphDocument.edit('Set speed', (d) => Object.assign(d, setAnimatorStateProps(d, state.name, { speed: v }))); }} />
        </label>
        <label className="ng-check-row">
          <input type="checkbox" checked={state.loop ?? false}
            onChange={(e) => AnimatorGraphDocument.edit('Set loop', (d) => Object.assign(d, setAnimatorStateProps(d, state.name, { loop: e.target.checked })))} />
          {t('anim.loop')}
        </label>
      </div>
    </div>
  );
}

function TransitionInspector({ def, edgeId }: { def: AnimatorControllerDef; edgeId: string }) {
  const parsed = parseEdgeId(edgeId);
  if (!parsed) return null;
  const src = def.states.find((s) => s.name === parsed.from);
  const tr = src?.transitions[parsed.index];
  if (!tr) return null;
  const patch = (p: Partial<AnimatorTransition>) => AnimatorGraphDocument.edit('Edit transition', (d) => Object.assign(d, updateAnimatorTransition(d, parsed.from, parsed.index, p)));
  const setConds = (conds: AnimatorCondition[]) => AnimatorGraphDocument.edit('Edit conditions', (d) => Object.assign(d, setAnimatorConditions(d, parsed.from, parsed.index, conds)));
  const firstParam = def.parameters[0]?.name ?? '';
  return (
    <div>
      <div className="ng-insp-title">{t('anim.inspTransitionTitle')}</div>
      <label className="ng-field">{t('anim.target')}
        <Select ariaLabel={t('anim.targetState')} value={tr.to} options={def.states.map((s) => ({ value: s.name }))} onChange={(v) => patch({ to: v })} />
      </label>
      <label className="ng-check-row">
        <input type="checkbox" checked={tr.hasExitTime ?? false} onChange={(e) => patch({ hasExitTime: e.target.checked || undefined })} />
        {t('anim.hasExitTime')}
      </label>
      <div className="ng-insp-sub">
        {t('anim.conditions')}
        <button type="button" className="ng-btn" style={{ marginLeft: 'auto' }} title={t('anim.addCondition')} disabled={!firstParam}
          onClick={() => setConds([...tr.conditions, { param: firstParam, op: 'trigger' }])}><Plus size={12} /></button>
      </div>
      {tr.conditions.length === 0 && <div className="ng-insp-sub" style={{ opacity: 0.5 }}>{t('anim.always')}</div>}
      {tr.conditions.map((c, ci) => (
        <div className="ng-row" key={ci}>
          <Select
            ariaLabel={t('anim.param')} style={{ flex: 1 }} value={c.param}
            options={def.parameters.map((p) => ({ value: p.name }))}
            onChange={(v) => setConds(tr.conditions.map((x, i) => (i === ci ? { ...x, param: v } : x)))}
          />
          <Select
            ariaLabel={t('anim.op')} style={{ width: 72 }} value={c.op}
            options={ALL_OPS.map((op) => ({ value: op, label: OP_SYM[op] }))}
            onChange={(op) => setConds(tr.conditions.map((x, i) => (i === ci ? makeCond(x.param, op as typeof ALL_OPS[number], 'value' in x ? x.value : 0) : x)))}
          />
          {(NUM_OPS as readonly string[]).includes(c.op) && (
            <input className="ng-input" style={{ width: 54 }} type="number" step={0.1} defaultValue={'value' in c ? c.value : 0} key={`cv-${ci}-${c.op}`}
              onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setConds(tr.conditions.map((x, i) => (i === ci ? makeCond(x.param, x.op as typeof NUM_OPS[number], v) : x))); }} />
          )}
          <button type="button" className="ng-btn" title={t('anim.removeCondition')} onClick={() => setConds(tr.conditions.filter((_, i) => i !== ci))}><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}

// -- helpers ----------------------------------------------------------------

function makeCond(param: string, op: typeof ALL_OPS[number], value: number): AnimatorCondition {
  if (op === 'true' || op === 'false' || op === 'trigger') return { param, op };
  return { param, op, value: Number.isFinite(value) ? value : 0 };
}

function parseEdgeId(id: string): { from: string; index: number } | null {
  const m = /^(.*)->.*#(\d+)$/.exec(id);
  return m ? { from: m[1], index: Number(m[2]) } : null;
}

function uniqueName(def: AnimatorControllerDef, base: string): string {
  if (!def.states.some((s) => s.name === base)) return base;
  for (let i = 1; ; i++) {
    const n = `${base}${i}`;
    if (!def.states.some((s) => s.name === n)) return n;
  }
}

function uniqueParam(def: AnimatorControllerDef): string {
  const base = 'Param';
  if (!def.parameters.some((p) => p.name === base)) return base;
  for (let i = 1; ; i++) {
    const n = `${base}${i}`;
    if (!def.parameters.some((p) => p.name === n)) return n;
  }
}
