// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NodeGraphCanvas.tsx
 * @brief   Generic node-graph canvas — draggable nodes wired by selectable bezier
 *          edges, shared by the state-machine and behavior-tree editors.
 *
 * Owns only the interaction (pan-by-scroll, node drag, wire-to-connect, edge/node
 * selection, delete, bezier + self-loops). Everything domain-specific — node body,
 * edge label, sizes, connect policy — is injected via props, so FSM (arbitrary
 * guarded edges, cycles) and BT (parent/child tree edges) both drive it. Extracted
 * from the proven StateMachineEditor canvas.
 */
import { useEffect, useRef, useState, type ReactNode, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';

export interface CanvasNode {
  id: string;
  x?: number;
  y?: number;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
}

export interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Render a separator instead of an item (label/onClick ignored). */
  sep?: boolean;
}

export interface ContextTarget {
  kind: 'canvas' | 'node';
  nodeId?: string;
  /** Canvas-space position of the right-click — where a new node should go. */
  x: number;
  y: number;
}

export interface NodeGraphCanvasProps<N extends CanvasNode, E extends CanvasEdge> {
  nodes: N[];
  edges: E[];
  selectedNode: string | null;
  selectedEdge: string | null;
  nodeSize: (n: N) => { width: number; height: number };
  /** Node body (header + content); the canvas frames it and adds the output handle. */
  renderNode: (n: N, selected: boolean) => ReactNode;
  /** Optional label drawn at an edge's midpoint (e.g. an FSM guard). */
  renderEdgeLabel?: (e: E) => ReactNode;
  /** Allow an edge from a node to itself (FSM self-transition). */
  allowSelfLoop?: boolean;
  /** Whether a node shows a left input anchor (can receive an edge). Default: all can. */
  hasInput?: (n: N) => boolean;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onMoveNodeStart?: (id: string) => void;
  onMoveNodeEnd?: (id: string) => void;
  onConnect: (from: string, to: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  /** Context-menu items for a right-click on empty canvas or on a node. */
  menuItems?: (target: ContextTarget) => MenuItem[];
  /** Toolbar row above the canvas. */
  toolbar?: ReactNode;
  /** Shown when there are no nodes. */
  emptyHint?: ReactNode;
}

const nx = (n: CanvasNode) => n.x ?? 0;
const ny = (n: CanvasNode) => n.y ?? 0;

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function NodeGraphCanvas<N extends CanvasNode, E extends CanvasEdge>(props: NodeGraphCanvasProps<N, E>) {
  const {
    nodes, edges, selectedNode, selectedEdge, nodeSize, renderNode, renderEdgeLabel,
    allowSelfLoop, hasInput, menuItems, onSelectNode, onSelectEdge, onMoveNode, onMoveNodeStart, onMoveNodeEnd,
    onConnect, onDeleteNode, onDeleteEdge, toolbar, emptyHint,
  } = props;

  const [wiring, setWiring] = useState(false);
  const [menu, setMenu] = useState<{ screenX: number; screenY: number; target: ContextTarget } | null>(null);
  // Infinite-canvas viewport: pan offset (screen px) + zoom. Content is drawn in
  // world coords inside a transformed container, so there are no scrollbars.
  const [vp, setVp] = useState({ x: 0, y: 0, zoom: 1 });
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);

  const openMenu = (e: ReactMouseEvent, target: ContextTarget) => {
    if (!menuItems) return;
    e.preventDefault();
    setMenu({ screenX: e.clientX, screenY: e.clientY, target });
  };

  const canvasRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const wire = useRef<{ from: string } | null>(null);

  const byId = new Map(nodes.map(n => [n.id, n]));
  const out = (n: N) => { const s = nodeSize(n); return { x: nx(n) + s.width, y: ny(n) + s.height / 2 }; };
  const inp = (n: N) => ({ x: nx(n), y: ny(n) + nodeSize(n).height / 2 });

  // Screen point → world coord (inverse of the viewport transform).
  const toCanvas = (clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: clientX, y: clientY };
    const r = el.getBoundingClientRect();
    return { x: (clientX - r.left - vp.x) / vp.zoom, y: (clientY - r.top - vp.y) / vp.zoom };
  };

  const nodeAt = (x: number, y: number): N | null => {
    for (const n of nodes) {
      const s = nodeSize(n);
      if (x >= nx(n) && x <= nx(n) + s.width && y >= ny(n) && y <= ny(n) + s.height) return n;
    }
    return null;
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (pan.current) {
        const { sx, sy, vx, vy } = pan.current;
        setVp(v => ({ ...v, x: vx + (e.clientX - sx), y: vy + (e.clientY - sy) }));
        return;
      }
      const p = toCanvas(e.clientX, e.clientY);
      if (drag.current) onMoveNode(drag.current.id, p.x - drag.current.offX, p.y - drag.current.offY);
      else if (wire.current) setCursor(p);
    };
    const onUp = (e: PointerEvent) => {
      pan.current = null;
      if (drag.current) {
        onMoveNodeEnd?.(drag.current.id);
        drag.current = null;
      }
      if (wire.current) {
        const p = toCanvas(e.clientX, e.clientY);
        const target = nodeAt(p.x, p.y);
        const from = wire.current.from;
        if (target && (allowSelfLoop || target.id !== from)) onConnect(from, target.id);
        wire.current = null;
        setCursor(null);
        setWiring(false);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, vp]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (selectedNode) onDeleteNode(selectedNode);
      else if (selectedEdge) onDeleteEdge(selectedEdge);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNode, selectedEdge, onDeleteNode, onDeleteEdge]);

  const selfLoopPath = (n: N): string => {
    const cx = nx(n) + nodeSize(n).width / 2;
    const y = ny(n);
    return `M ${cx - 16} ${y} C ${cx - 30} ${y - 40}, ${cx + 30} ${y - 40}, ${cx + 16} ${y}`;
  };

  return (
    <div className="panel" style={S.root}>
      {toolbar && <div style={S.bar}>{toolbar}</div>}
      <div style={{ ...S.canvas, backgroundSize: `${20 * vp.zoom}px ${20 * vp.zoom}px`, backgroundPosition: `${vp.x}px ${vp.y}px` }} ref={canvasRef}
        onPointerDown={e => {
          if (e.button === 1) { e.preventDefault(); pan.current = { sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y }; return; }
          onSelectNode(null); onSelectEdge(null);
        }}
        onWheel={e => {
          const el = canvasRef.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          setVp(v => {
            const zoom = Math.min(2.5, Math.max(0.25, v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
            const k = zoom / v.zoom;
            return { x: mx - (mx - v.x) * k, y: my - (my - v.y) * k, zoom };
          });
        }}
        onContextMenu={e => { const p = toCanvas(e.clientX, e.clientY); openMenu(e, { kind: 'canvas', x: p.x, y: p.y }); }}>
        {nodes.length === 0 && emptyHint && <div style={S.empty}>{emptyHint}</div>}
        <div style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, transformOrigin: '0 0' }}>
        <svg style={S.svg}>
          {edges.map(e => {
            const from = byId.get(e.from);
            const to = byId.get(e.to);
            if (!from || !to) return null;
            const self = e.from === e.to;
            const a = out(from);
            const b = self ? { x: nx(to) + nodeSize(to).width / 2, y: ny(to) } : inp(to);
            const d = self ? selfLoopPath(from) : bezier(a.x, a.y, b.x, b.y);
            const sel = selectedEdge === e.id;
            return (
              <g key={e.id}>
                <path d={d} stroke="transparent" strokeWidth={12} fill="none" style={{ cursor: 'pointer' }}
                  onPointerDown={ev => { ev.stopPropagation(); onSelectEdge(e.id); onSelectNode(null); }} />
                <path d={d} stroke={sel ? 'var(--accent, #6ea9ff)' : '#7d8794'} strokeWidth={sel ? 2.5 : 1.6} fill="none" />
              </g>
            );
          })}
          {wire.current && cursor && (() => {
            const from = byId.get(wire.current.from);
            if (!from) return null;
            const a = out(from);
            return <path d={bezier(a.x, a.y, cursor.x, cursor.y)} stroke="#6ea9ff" strokeWidth={1.6} strokeDasharray="4 3" fill="none" />;
          })()}
        </svg>

        {renderEdgeLabel && edges.map(e => {
          const from = byId.get(e.from);
          const to = byId.get(e.to);
          if (!from || !to) return null;
          const self = e.from === e.to;
          const mx = self ? nx(from) + nodeSize(from).width / 2 : (out(from).x + inp(to).x) / 2;
          const my = self ? ny(from) - 22 : (out(from).y + inp(to).y) / 2;
          return (
            <div key={`lbl-${e.id}`} style={{ ...S.edgeLabel, left: mx - 40, top: my - 9, borderColor: selectedEdge === e.id ? 'var(--accent, #6ea9ff)' : 'transparent' }}
              onPointerDown={ev => { ev.stopPropagation(); onSelectEdge(e.id); onSelectNode(null); }}>
              {renderEdgeLabel(e)}
            </div>
          );
        })}

        {nodes.map(n => {
          const s = nodeSize(n);
          // While dragging a wire, outline the nodes it can land on.
          const droppable = wiring && wire.current !== null && (allowSelfLoop || wire.current.from !== n.id);
          const showInput = hasInput?.(n) ?? true;
          return (
            <div key={n.id} style={{ ...S.node, left: nx(n), top: ny(n), width: s.width, height: s.height, outline: droppable ? '2px dashed #6ea9ff' : undefined, outlineOffset: 3 }}
              onPointerDown={e => {
                e.stopPropagation();
                onSelectNode(n.id); onSelectEdge(null);
                const p = toCanvas(e.clientX, e.clientY);
                drag.current = { id: n.id, offX: p.x - nx(n), offY: p.y - ny(n) };
                onMoveNodeStart?.(n.id);
              }}
              onContextMenu={e => { e.stopPropagation(); onSelectNode(n.id); const p = toCanvas(e.clientX, e.clientY); openMenu(e, { kind: 'node', nodeId: n.id, x: p.x, y: p.y }); }}>
              {showInput && <span style={{ ...S.inAnchor, top: s.height / 2 - 5 }} aria-hidden title="Edges land here" />}
              {renderNode(n, selectedNode === n.id)}
              <span style={{ ...S.handle, top: s.height / 2 - 7 }} title="Drag to another node to connect"
                onPointerDown={e => { e.stopPropagation(); wire.current = { from: n.id }; setWiring(true); setCursor(toCanvas(e.clientX, e.clientY)); }} />
            </div>
          );
        })}
        </div>
      </div>

      {menu && menuItems && (
        <>
          <div style={S.menuOverlay} onPointerDown={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null); }} />
          <div style={{ ...S.menu, left: menu.screenX, top: menu.screenY }}>
            {menuItems(menu.target).map((it, i) => it.sep
              ? <div key={i} style={S.menuSep} />
              : (
                <button key={i} type="button" disabled={it.disabled}
                  style={{ ...S.menuItem, ...(it.disabled ? S.menuItemDisabled : null) }}
                  onClick={() => { it.onClick(); setMenu(null); }}>
                  {it.label}
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%' },
  bar: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--border, #2a2f36)' },
  canvas: { position: 'relative', flex: 1, overflow: 'hidden', background: 'var(--canvas, #191c20)', backgroundImage: 'radial-gradient(var(--grid, #262b31) 1px, transparent 1px)' },
  empty: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 13, pointerEvents: 'none' },
  svg: { position: 'absolute', top: 0, left: 0, width: 4000, height: 4000, overflow: 'visible' },
  node: { position: 'absolute', boxSizing: 'border-box', cursor: 'grab', userSelect: 'none' },
  // Output handle (right): drag it to another node to connect.
  handle: { position: 'absolute', right: -7, width: 14, height: 14, borderRadius: '50%', background: '#6ea9ff', border: '2px solid var(--canvas, #191c20)', boxShadow: '0 0 0 1px #6ea9ff88', cursor: 'crosshair', zIndex: 2 },
  // Input anchor (left): a visual cue that edges land on this node.
  inAnchor: { position: 'absolute', left: -5, width: 10, height: 10, borderRadius: '50%', background: '#5a6470', border: '2px solid var(--canvas, #191c20)', pointerEvents: 'none' },
  edgeLabel: { position: 'absolute', width: 80, textAlign: 'center', fontSize: 10, padding: '1px 3px', borderRadius: 3, background: 'var(--canvas, #191c20)', border: '1px solid transparent', color: '#aeb6c0', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  menuOverlay: { position: 'fixed', inset: 0, zIndex: 100 },
  menu: { position: 'fixed', zIndex: 101, minWidth: 156, padding: 4, borderRadius: 6, background: 'var(--panel, #232830)', border: '1px solid var(--border, #333)', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' },
  menuItem: { textAlign: 'left', padding: '4px 10px', fontSize: 12, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', borderRadius: 4 },
  menuItemDisabled: { opacity: 0.4, cursor: 'default' },
  menuSep: { height: 1, margin: '4px 2px', background: 'var(--border, #333)' },
};
