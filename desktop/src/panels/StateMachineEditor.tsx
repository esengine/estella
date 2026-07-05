// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    StateMachineEditor.tsx
 * @brief   The `.esfsm` transition-graph editor — states as draggable nodes, transitions
 *          as selectable bezier edges. All mutation goes through the pure, tested SDK
 *          fsmGraph ops on the reactive FsmGraphDocument (one undo step each). A `.esfsm`
 *          IS the runtime FsmDefinition (states carry x/y layout the interpreter ignores),
 *          so Save just writes the JSON — no compile step.
 *
 *          Interaction mirrors MaterialGraphEditor (toCanvas / drag ref / wire ref / window
 *          move-up effects / bezier); specialized for FSM: first-class selectable edges with
 *          guard labels, self-loops, and cycles allowed. A generic <NodeGraphCanvas> is
 *          deferred until the behavior-tree editor gives a second real consumer (AI3).
 */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import {
  fsmEdges,
  addState,
  removeState,
  moveState,
  renameState,
  setStateHook,
  setInitial,
  addTransition,
  removeTransition,
  updateTransition,
  aiRegistry,
  type FsmDefinition,
  type FsmState,
  type CompareOp,
} from 'esengine';
import { FsmGraphDocument } from '@/fsm/FsmGraphDocument';
import { EditorHistory } from '@/engine/EditorHistory';

const NODE_W = 156;
const NODE_H = 60;
const HOOKS: Array<'onEnter' | 'onUpdate' | 'onExit'> = ['onEnter', 'onUpdate', 'onExit'];
const OPS: CompareOp[] = ['==', '!=', '<', '<=', '>', '>=', 'truthy', 'falsy'];

const stateX = (s: FsmState) => s.x ?? 0;
const stateY = (s: FsmState) => s.y ?? 0;
const outAnchor = (s: FsmState) => ({ x: stateX(s) + NODE_W, y: stateY(s) + NODE_H / 2 });
const inAnchor = (s: FsmState) => ({ x: stateX(s), y: stateY(s) + NODE_H / 2 });

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

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

  const canvasRef = useRef<HTMLDivElement>(null);
  const [selState, setSelState] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ name: string; offX: number; offY: number; before: FsmDefinition } | null>(null);
  const wire = useRef<{ from: string } | null>(null);

  const toCanvas = (clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: clientX, y: clientY };
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left + el.scrollLeft, y: clientY - r.top + el.scrollTop };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = toCanvas(e.clientX, e.clientY);
      if (drag.current && def) {
        FsmGraphDocument.replaceAsset(moveState(def, drag.current.name, p.x - drag.current.offX, p.y - drag.current.offY), { dirty: true });
      } else if (wire.current) {
        setCursor(p);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (drag.current && def) {
        const after = def;
        const before = drag.current.before;
        EditorHistory.record('Move state', () => FsmGraphDocument.replaceAsset(after), () => FsmGraphDocument.replaceAsset(before));
        drag.current = null;
      }
      if (wire.current && def) {
        const p = toCanvas(e.clientX, e.clientY);
        const target = stateAt(def, p.x, p.y);
        const from = wire.current.from;
        if (target) FsmGraphDocument.edit('Add transition', (d) => Object.assign(d, addTransition(d, from, target)));
        wire.current = null;
        setCursor(null);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [def]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!def) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (selState) {
        FsmGraphDocument.edit('Delete state', (d) => Object.assign(d, removeState(d, selState)));
        setSelState(null);
      } else if (selEdge) {
        const parsed = parseEdgeId(selEdge);
        if (parsed) FsmGraphDocument.edit('Delete transition', (d) => Object.assign(d, removeTransition(d, parsed.from, parsed.index)));
        setSelEdge(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selState, selEdge, def]);

  if (!def || !filePath) {
    return (
      <div className="panel" style={S.empty}>
        <p>Open a <code>.esfsm</code> from the Content Browser to edit it.</p>
      </div>
    );
  }

  const addStateAt = () => {
    const el = canvasRef.current;
    const x = (el?.scrollLeft ?? 0) + 60;
    const y = (el?.scrollTop ?? 0) + 60;
    const name = uniqueName(def, 'State');
    FsmGraphDocument.edit('Add state', (d) => Object.assign(d, addState(d, name, x, y)));
    setSelState(name);
    setSelEdge(null);
  };

  const save = () => {
    void window.estella.fs.write(filePath, JSON.stringify(def, null, 2) + '\n').then(() => FsmGraphDocument.markSaved());
  };

  const byName = new Map(def.states.map((s) => [s.name, s]));
  const edges = fsmEdges(def);

  return (
    <div className="panel" style={S.root}>
      <div style={S.bar}>
        <button type="button" style={S.btn} onClick={addStateAt} title="Add state"><Plus size={13} strokeWidth={2} /> State</button>
        {(selState || selEdge) && (
          <button type="button" style={S.btn} title="Delete selected" onClick={() => {
            if (selState) { FsmGraphDocument.edit('Delete state', (d) => Object.assign(d, removeState(d, selState))); setSelState(null); }
            else if (selEdge) { const p = parseEdgeId(selEdge); if (p) FsmGraphDocument.edit('Delete transition', (d) => Object.assign(d, removeTransition(d, p.from, p.index))); setSelEdge(null); }
          }}><Trash2 size={13} strokeWidth={1.9} /></button>
        )}
        <span style={S.title}>{filePath.split('/').pop()}{dirty && <span style={S.dot} title="Unsaved">●</span>}</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={{ ...S.btn, ...S.primary }} disabled={!dirty} onClick={save}><Save size={13} strokeWidth={1.9} /> Save</button>
      </div>

      <div style={S.body}>
        <div style={S.canvas} ref={canvasRef} onPointerDown={() => { setSelState(null); setSelEdge(null); }}>
          <svg style={S.svg}>
            {edges.map((e) => {
              const from = byName.get(e.from);
              const to = byName.get(e.to);
              if (!from || !to) return null;
              const a = outAnchor(from);
              const b = e.from === e.to ? { x: stateX(to) + NODE_W / 2, y: stateY(to) } : inAnchor(to);
              const d = e.from === e.to ? selfLoop(from) : bezier(a.x, a.y, b.x, b.y);
              const sel = selEdge === e.id;
              return (
                <g key={e.id}>
                  {/* Fat transparent hit path so the thin edge is easy to click. */}
                  <path d={d} stroke="transparent" strokeWidth={12} fill="none" style={{ cursor: 'pointer' }}
                    onPointerDown={(ev) => { ev.stopPropagation(); setSelEdge(e.id); setSelState(null); }} />
                  <path d={d} stroke={sel ? 'var(--accent, #6ea9ff)' : '#7d8794'} strokeWidth={sel ? 2.5 : 1.6} fill="none" markerEnd="" />
                </g>
              );
            })}
            {wire.current && cursor && (() => {
              const from = byName.get(wire.current.from);
              if (!from) return null;
              const a = outAnchor(from);
              return <path d={bezier(a.x, a.y, cursor.x, cursor.y)} stroke="#6ea9ff" strokeWidth={1.6} strokeDasharray="4 3" fill="none" />;
            })()}
          </svg>

          {/* Edge guard labels, positioned at the edge midpoint. */}
          {edges.map((e) => {
            const from = byName.get(e.from);
            const to = byName.get(e.to);
            if (!from || !to) return null;
            const mx = e.from === e.to ? stateX(from) + NODE_W / 2 : (outAnchor(from).x + inAnchor(to).x) / 2;
            const my = e.from === e.to ? stateY(from) - 22 : (outAnchor(from).y + inAnchor(to).y) / 2;
            return (
              <div key={`lbl-${e.id}`} style={{ ...S.edgeLabel, left: mx - 40, top: my - 9, borderColor: selEdge === e.id ? 'var(--accent, #6ea9ff)' : 'transparent' }}
                onPointerDown={(ev) => { ev.stopPropagation(); setSelEdge(e.id); setSelState(null); }}>
                {edgeSummary(e.transition)}
              </div>
            );
          })}

          {def.states.map((s) => {
            const isInitial = def.initial === s.name;
            const sel = selState === s.name;
            const setHooks = HOOKS.filter((h) => s[h]).map((h) => `${h[2].toUpperCase()}:${s[h]}`).join(' ');
            return (
              <div key={s.name} style={{ ...S.node, left: stateX(s), top: stateY(s), width: NODE_W, height: NODE_H, borderColor: sel ? 'var(--accent, #6ea9ff)' : isInitial ? '#7faf9c' : '#3a4048' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSelState(s.name); setSelEdge(null);
                  const p = toCanvas(e.clientX, e.clientY);
                  drag.current = { name: s.name, offX: p.x - stateX(s), offY: p.y - stateY(s), before: def };
                }}>
                <div style={S.nodeHead}>
                  {isInitial && <span title="Initial state" style={S.initialBadge}>▶</span>}
                  <span style={S.nodeName}>{s.name}</span>
                </div>
                <div style={S.nodeHooks}>{setHooks || <span style={{ opacity: 0.4 }}>no actions</span>}</div>
                {/* Output handle — drag to another state to add a transition. */}
                <span style={S.outHandle} title="Drag to a state to add a transition"
                  onPointerDown={(e) => { e.stopPropagation(); wire.current = { from: s.name }; setCursor(toCanvas(e.clientX, e.clientY)); }} />
              </div>
            );
          })}
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

function stateAt(def: FsmDefinition, x: number, y: number): string | null {
  for (const s of def.states) {
    const sx = stateX(s), sy = stateY(s);
    if (x >= sx && x <= sx + NODE_W && y >= sy && y <= sy + NODE_H) return s.name;
  }
  return null;
}

function selfLoop(s: FsmState): string {
  const x = stateX(s) + NODE_W / 2;
  const y = stateY(s);
  return `M ${x - 16} ${y} C ${x - 30} ${y - 40}, ${x + 30} ${y - 40}, ${x + 16} ${y}`;
}

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

// -- inline styles (self-contained; no shared CSS dependency) ----------------

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%' },
  empty: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.6, fontSize: 13 },
  bar: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--border, #2a2f36)' },
  btn: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border, #333)', background: 'var(--panel, #222)', color: 'inherit', cursor: 'pointer' },
  primary: { background: 'var(--accent, #3a6ea5)', borderColor: 'transparent' },
  title: { fontSize: 12, opacity: 0.85, marginLeft: 4 },
  dot: { color: '#e0a03a', marginLeft: 4 },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  canvas: { position: 'relative', flex: 1, overflow: 'auto', background: 'var(--canvas, #191c20)', backgroundImage: 'radial-gradient(var(--grid, #262b31) 1px, transparent 1px)', backgroundSize: '20px 20px' },
  svg: { position: 'absolute', top: 0, left: 0, width: 4000, height: 4000, overflow: 'visible' },
  node: { position: 'absolute', boxSizing: 'border-box', borderRadius: 6, border: '1.5px solid #3a4048', background: 'var(--node, #232830)', boxShadow: '0 1px 3px rgba(0,0,0,0.4)', cursor: 'grab', userSelect: 'none', padding: 6 },
  nodeHead: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600 },
  initialBadge: { color: '#7faf9c', fontSize: 10 },
  nodeName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  nodeHooks: { marginTop: 5, fontSize: 10.5, opacity: 0.75, lineHeight: 1.4, overflow: 'hidden' },
  outHandle: { position: 'absolute', right: -6, top: NODE_H / 2 - 6, width: 11, height: 11, borderRadius: '50%', background: '#6ea9ff', border: '2px solid var(--canvas, #191c20)', cursor: 'crosshair' },
  edgeLabel: { position: 'absolute', width: 80, textAlign: 'center', fontSize: 10, padding: '1px 3px', borderRadius: 3, background: 'var(--canvas, #191c20)', border: '1px solid transparent', color: '#aeb6c0', pointerEvents: 'auto', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  inspector: { width: 232, flexShrink: 0, borderLeft: '1px solid var(--border, #2a2f36)', padding: 10, overflow: 'auto', fontSize: 12 },
  inspTitle: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, marginBottom: 8 },
  inspSub: { fontSize: 11, opacity: 0.6, margin: '10px 0 4px' },
  field: { display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8, fontSize: 11, opacity: 0.95 },
  checkRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12 },
  input: { padding: '3px 6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border, #333)', background: 'var(--input, #1a1d22)', color: 'inherit' },
};
