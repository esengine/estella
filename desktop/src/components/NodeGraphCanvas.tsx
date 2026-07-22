// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NodeGraphCanvas.tsx
 * @brief   Generic node-graph canvas — draggable nodes wired by selectable bezier
 *          edges, shared by the state-machine and behavior-tree editors.
 *
 * Owns only the interaction (pan/zoom, node drag, wire-to-connect, edge/node
 * selection, delete, bezier + self-loops). Everything domain-specific — node body,
 * edge label, sizes, ports, connect policy — is injected via props, so FSM
 * (arbitrary guarded edges, cycles), BT (parent/child tree edges), and the
 * material graph (typed multi-input ports) all drive it. Nodes default to one
 * input/output port at mid-height; `inputs`/`outputs` inject per-node port lists
 * (position, color) and edges carry optional port ids. Styling lives in
 * theme/nodegraph.css; right-click menus are the shared <ContextMenu>.
 */
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref, type MouseEvent as ReactMouseEvent } from 'react';
import { ContextMenu, type MenuItem } from '@/components/Menu';
import { usePanelWindow } from '@/components/PanelWindow';
import { t } from '@/i18n';

export type { MenuItem };

export interface CanvasNode {
  id: string;
  x?: number;
  y?: number;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  /** Source/target port ids on multi-port nodes (default port = ''). */
  fromPort?: string;
  toPort?: string;
}

export interface CanvasPort {
  /** Port id within its node ('' = the default single port). */
  id: string;
  /** Vertical offset of the port center within the node (px, node coords). */
  y: number;
  /** Dot color (defaults to the shared handle/anchor styling). */
  color?: string;
  title?: string;
}

/** Imperative surface exposed via `apiRef` (e.g. a toolbar Add button opening
 *  the canvas context menu without owning the viewport math). */
export interface NodeGraphCanvasApi {
  openMenuAt(screenX: number, screenY: number): void;
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
  /** Whether a node shows a left input anchor (can receive an edge). Default: all can.
   *  Ignored when `inputs` is given. */
  hasInput?: (n: N) => boolean;
  /** Output ports on the node's right edge. Default: one at mid-height. */
  outputs?: (n: N) => CanvasPort[];
  /** Input ports on the node's left edge. Default: one at mid-height. */
  inputs?: (n: N) => CanvasPort[];
  /** Pressing an input port (e.g. the material graph's click-to-disconnect).
   *  Providing this makes input anchors interactive. */
  onInputPortDown?: (nodeId: string, portId: string) => void;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onMoveNodeStart?: (id: string) => void;
  onMoveNodeEnd?: (id: string) => void;
  /** A wire dropped on a target: port ids are '' for default single-port nodes. */
  onConnect: (from: string, to: string, fromPort: string, toPort: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  /** Context-menu items for a right-click on empty canvas or on a node. */
  menuItems?: (target: ContextTarget) => MenuItem[];
  /** Toolbar row above the canvas. */
  toolbar?: ReactNode;
  /** Shown when there are no nodes. */
  emptyHint?: ReactNode;
  /** Receives the imperative canvas API (menu opening). */
  apiRef?: Ref<NodeGraphCanvasApi>;
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
    allowSelfLoop, hasInput, outputs, inputs, onInputPortDown,
    menuItems, onSelectNode, onSelectEdge, onMoveNode, onMoveNodeStart, onMoveNodeEnd,
    onConnect, onDeleteNode, onDeleteEdge, toolbar, emptyHint, apiRef,
  } = props;

  // Port model: single mid-height ports unless the consumer injects lists.
  const outPorts = (n: N): CanvasPort[] =>
    outputs ? outputs(n) : [{ id: '', y: nodeSize(n).height / 2 }];
  const inPorts = (n: N): CanvasPort[] =>
    inputs ? inputs(n) : (hasInput?.(n) ?? true) ? [{ id: '', y: nodeSize(n).height / 2 }] : [];
  const portY = (ports: CanvasPort[], id: string | undefined, fallback: number): number =>
    (ports.find((p) => p.id === (id ?? '')) ?? ports[0])?.y ?? fallback;

  const win = usePanelWindow();
  const [wiring, setWiring] = useState(false);
  const [menu, setMenu] = useState<{ screenX: number; screenY: number; target: ContextTarget } | null>(null);
  // Infinite-canvas viewport: pan offset (screen px) + zoom. Content is drawn in
  // world coords inside a transformed container, so there are no scrollbars.
  const [vp, setVp] = useState({ x: 0, y: 0, zoom: 1 });
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const spaceHeld = useRef(false);
  const [spacePan, setSpacePan] = useState(false); // Space+drag pan for trackpad users

  const openMenu = (e: ReactMouseEvent, target: ContextTarget) => {
    if (!menuItems) return;
    e.preventDefault();
    setMenu({ screenX: e.clientX, screenY: e.clientY, target });
  };

  const canvasRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const wire = useRef<{ from: string; port: CanvasPort } | null>(null);

  const byId = new Map(nodes.map(n => [n.id, n]));
  const outPos = (n: N, port: CanvasPort) => ({ x: nx(n) + nodeSize(n).width, y: ny(n) + port.y });

  useImperativeHandle(apiRef, () => ({
    openMenuAt: (screenX: number, screenY: number) => {
      const p = toCanvas(screenX, screenY);
      setMenu({ screenX, screenY, target: { kind: 'canvas', x: p.x, y: p.y } });
    },
  }));

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
        const from = wire.current.from;
        const fromPort = wire.current.port.id;
        const accepts = (n: N) => (allowSelfLoop || n.id !== from) && inPorts(n).length > 0;
        // Dropping on a node snaps to its nearest input port; a near-miss outside
        // any node still lands on the closest port within a small radius.
        let dest: { node: N; port: CanvasPort } | null = null;
        const target = nodeAt(p.x, p.y);
        if (target && accepts(target)) {
          const ports = inPorts(target);
          const nearest = ports.reduce((a, b) =>
            Math.abs(ny(target) + a.y - p.y) <= Math.abs(ny(target) + b.y - p.y) ? a : b,
          );
          dest = { node: target, port: nearest };
        } else {
          let bestD2 = 18 * 18;
          for (const n of nodes) {
            if (!accepts(n)) continue;
            for (const port of inPorts(n)) {
              const d2 = (nx(n) - p.x) ** 2 + (ny(n) + port.y - p.y) ** 2;
              if (d2 < bestD2) {
                bestD2 = d2;
                dest = { node: n, port };
              }
            }
          }
        }
        if (dest) onConnect(from, dest.node.id, fromPort, dest.port.id);
        wire.current = null;
        setCursor(null);
        setWiring(false);
      }
    };
    win.addEventListener('pointermove', onMove);
    win.addEventListener('pointerup', onUp);
    return () => {
      win.removeEventListener('pointermove', onMove);
      win.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, vp, win]);

  // Space = pan-drag mode (no middle button needed — the trackpad/laptop path).
  useEffect(() => {
    const typing = (el: EventTarget | null): boolean => {
      const n = el as HTMLElement | null;
      return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || typing(e.target)) return;
      spaceHeld.current = true;
      setSpacePan(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') { spaceHeld.current = false; setSpacePan(false); }
    };
    win.addEventListener('keydown', down);
    win.addEventListener('keyup', up);
    return () => {
      win.removeEventListener('keydown', down);
      win.removeEventListener('keyup', up);
    };
  }, [win]);

  // Keyboard, scoped to the focused canvas (the canvas div carries tabIndex, so
  // clicking a node lands focus here) — a window listener would make two open
  // graph editors both react to one Delete.
  const KEY_DIR: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  };
  const center = (n: N) => {
    const s = nodeSize(n);
    return { x: nx(n) + s.width / 2, y: ny(n) + s.height / 2 };
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
    if (e.key === 'Escape') {
      if (wire.current) {
        wire.current = null;
        setCursor(null);
        setWiring(false);
        e.stopPropagation();
      } else if (selectedNode || selectedEdge) {
        onSelectNode(null);
        onSelectEdge(null);
        e.stopPropagation();
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation(); // the canvas owns Delete — never the scene's entity delete
      if (selectedNode) onDeleteNode(selectedNode);
      else if (selectedEdge) onDeleteEdge(selectedEdge);
      return;
    }
    const dir = KEY_DIR[e.key];
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation(); // graph navigation, not the viewport's selection nudge
    const cur = selectedNode ? byId.get(selectedNode) : null;
    if (!cur) {
      if (nodes.length) { onSelectNode(nodes[0].id); onSelectEdge(null); }
      return;
    }
    if (e.shiftKey) {
      // Nudge one grid step as a single undo step (same seam as a pointer drag).
      onMoveNodeStart?.(cur.id);
      onMoveNode(cur.id, nx(cur) + dir[0] * 10, ny(cur) + dir[1] * 10);
      onMoveNodeEnd?.(cur.id);
      return;
    }
    // Move the selection to the nearest node in that direction, preferring the
    // straight-ahead candidate over a closer but off-axis one.
    const c = center(cur);
    let best: N | null = null;
    let bestScore = Infinity;
    for (const n of nodes) {
      if (n.id === cur.id) continue;
      const p = center(n);
      const along = (p.x - c.x) * dir[0] + (p.y - c.y) * dir[1];
      if (along <= 0) continue;
      const across = Math.abs((p.x - c.x) * dir[1]) + Math.abs((p.y - c.y) * dir[0]);
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (best) { onSelectNode(best.id); onSelectEdge(null); }
  };

  const selfLoopPath = (n: N): string => {
    const cx = nx(n) + nodeSize(n).width / 2;
    const y = ny(n);
    return `M ${cx - 16} ${y} C ${cx - 30} ${y - 40}, ${cx + 30} ${y - 40}, ${cx + 16} ${y}`;
  };

  // Edge geometry: anchors on the nodes' port positions, plus a bow offset for
  // bidirectional pairs so they don't overlap.
  const edgeGeom = (from: N, to: N, e: E) => {
    if (e.from === e.to) {
      return { d: selfLoopPath(from), mx: nx(from) + nodeSize(from).width / 2, my: ny(from) - 22 };
    }
    const fs = nodeSize(from);
    const ts = nodeSize(to);
    // Output (right edge) -> input (left edge), matching the node port dots.
    const a = { x: nx(from) + fs.width, y: ny(from) + portY(outPorts(from), e.fromPort, fs.height / 2) };
    const b = { x: nx(to), y: ny(to) + portY(inPorts(to), e.toPort, ts.height / 2) };
    // Target to the right: a direct S-curve. Otherwise it's a back-edge (the
    // source sits right of the target) - route it as a compact arc bowing below
    // the nodes, not a wide horizontal S that flings far past them.
    if (b.x > a.x + 20) {
      return { d: bezier(a.x, a.y, b.x, b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
    const bow = 58;
    const c1x = a.x + 46;
    const c1y = a.y + bow;
    const c2x = b.x - 46;
    const c2y = b.y + bow;
    return {
      d: `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`,
      mx: 0.125 * a.x + 0.375 * c1x + 0.375 * c2x + 0.125 * b.x,
      my: 0.125 * a.y + 0.375 * c1y + 0.375 * c2y + 0.125 * b.y,
    };
  };

  return (
    <div className="panel ng-root" onKeyDown={onKeyDown}>
      {toolbar && <div className="ng-bar">{toolbar}</div>}
      <div className="ng-canvas" tabIndex={0} style={{ backgroundSize: `${20 * vp.zoom}px ${20 * vp.zoom}px`, backgroundPosition: `${vp.x}px ${vp.y}px`, ...(spacePan ? { cursor: 'grab' } : null) }} ref={canvasRef}
        onPointerDown={e => {
          // Middle-drag, or Space+left-drag (trackpad), pans; a plain left-click deselects.
          if (e.button === 1 || (e.button === 0 && spaceHeld.current)) { e.preventDefault(); pan.current = { sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y }; return; }
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
        {nodes.length === 0 && emptyHint && <div className="ng-empty">{emptyHint}</div>}
        <div style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, transformOrigin: '0 0' }}>
        <svg className="ng-svg">
          <defs>
            <marker id="ng-arrow" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L7.5,3 L0,6 Z" fill="var(--text-faint)" />
            </marker>
            <marker id="ng-arrow-sel" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L7.5,3 L0,6 Z" fill="var(--star)" />
            </marker>
          </defs>
          {edges.map(e => {
            const from = byId.get(e.from);
            const to = byId.get(e.to);
            if (!from || !to) return null;
            const { d } = edgeGeom(from, to, e);
            const sel = selectedEdge === e.id;
            return (
              <g key={e.id}>
                <path d={d} stroke="transparent" strokeWidth={12} fill="none" style={{ cursor: 'pointer' }}
                  onPointerDown={ev => { ev.stopPropagation(); onSelectEdge(e.id); onSelectNode(null); }} />
                <path d={d} stroke={sel ? 'var(--star)' : 'var(--text-faint)'} strokeWidth={sel ? 2.5 : 1.6} fill="none" markerEnd={`url(#ng-arrow${sel ? '-sel' : ''})`} />
              </g>
            );
          })}
          {wire.current && cursor && (() => {
            const from = byId.get(wire.current.from);
            if (!from) return null;
            const a = outPos(from, wire.current.port);
            return <path d={bezier(a.x, a.y, cursor.x, cursor.y)} stroke="var(--star-hi)" strokeWidth={1.6} strokeDasharray="4 3" fill="none" />;
          })()}
        </svg>

        {renderEdgeLabel && edges.map(e => {
          const from = byId.get(e.from);
          const to = byId.get(e.to);
          if (!from || !to) return null;
          const { mx, my } = edgeGeom(from, to, e);
          return (
            <div key={`lbl-${e.id}`} className={`ng-edge-label${selectedEdge === e.id ? ' sel' : ''}`} style={{ left: mx - 40, top: my - 9 }}
              onPointerDown={ev => { ev.stopPropagation(); onSelectEdge(e.id); onSelectNode(null); }}>
              {renderEdgeLabel(e)}
            </div>
          );
        })}

        {nodes.map(n => {
          const s = nodeSize(n);
          // While dragging a wire, outline the nodes it can land on.
          const droppable = wiring && wire.current !== null && (allowSelfLoop || wire.current.from !== n.id) && inPorts(n).length > 0;
          return (
            <div key={n.id} className={`ng-node${droppable ? ' droppable' : ''}`} style={{ left: nx(n), top: ny(n), width: s.width, height: s.height }}
              onPointerDown={e => {
                e.stopPropagation();
                onSelectNode(n.id); onSelectEdge(null);
                const p = toCanvas(e.clientX, e.clientY);
                drag.current = { id: n.id, offX: p.x - nx(n), offY: p.y - ny(n) };
                onMoveNodeStart?.(n.id);
              }}
              onContextMenu={e => { e.stopPropagation(); onSelectNode(n.id); const p = toCanvas(e.clientX, e.clientY); openMenu(e, { kind: 'node', nodeId: n.id, x: p.x, y: p.y }); }}>
              {inPorts(n).map(port => (
                <span
                  key={`in:${port.id}`}
                  className={`ng-in-anchor${onInputPortDown ? ' clickable' : ''}`}
                  style={{ top: port.y - 5, background: port.color }}
                  aria-hidden={onInputPortDown ? undefined : true}
                  title={port.title ?? t('ng.inPortTip')}
                  onPointerDown={onInputPortDown ? (e) => { e.stopPropagation(); onInputPortDown(n.id, port.id); } : undefined}
                />
              ))}
              {renderNode(n, selectedNode === n.id)}
              {outPorts(n).map(port => (
                <span
                  key={`out:${port.id}`}
                  className="ng-handle"
                  style={{ top: port.y - 7, background: port.color }}
                  title={port.title ?? t('ng.outPortTip')}
                  onPointerDown={e => { e.stopPropagation(); wire.current = { from: n.id, port }; setWiring(true); setCursor(toCanvas(e.clientX, e.clientY)); }}
                />
              ))}
            </div>
          );
        })}
        </div>
      </div>

      {menu && menuItems && (
        <ContextMenu x={menu.screenX} y={menu.screenY} items={menuItems(menu.target)} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
