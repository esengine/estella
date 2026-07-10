// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MaterialGraphEditor.tsx
 * @brief   The `.esmatgraph` node editor (Material Graph, P5b) — a canvas of node boxes wired by
 *          bezier connections. All graph mutation goes through the pure, tested SDK ops
 *          (addNode/connect/disconnect/removeNode/moveNode) on the reactive MaterialGraphDocument;
 *          NODE_SPECS drives the palette, ports, and node-param fields so the editor and the
 *          compiler never drift. Save compiles the graph to its sibling `.esshader` (P5a).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Save, Plus, Trash2 } from 'lucide-react';
import {
  NODE_SPECS,
  addNode,
  moveNode,
  connect,
  disconnect,
  removeNode,
  type MaterialGraph,
  type GraphNodeType,
  type GraphType,
} from 'esengine';
import { MaterialGraphDocument } from '@/material/MaterialGraphDocument';
import { saveMaterialGraph } from '@/material/openMaterialGraph';
import { EditorHistory } from '@/engine/EditorHistory';
import { NumField, ColorControl } from '@/panels/Details';
import { DirtyDot } from '@/components/DirtyDot';
import { ContextMenu, type MenuItem } from '@/components/Menu';

const NODE_W = 168;
const HEADER_H = 28;
const ROW_H = 24;

// A node's input/output port positions in canvas coordinates (node.x/.y are canvas px).
const nodeX = (n: { x?: number }) => n.x ?? 0;
const nodeY = (n: { y?: number }) => n.y ?? 0;
const outPort = (n: { x?: number; y?: number }) => ({ x: nodeX(n) + NODE_W, y: nodeY(n) + HEADER_H / 2 });
const inPort = (n: { x?: number; y?: number }, i: number) => ({ x: nodeX(n), y: nodeY(n) + HEADER_H + ROW_H * i + ROW_H / 2 });

// Port hue by GLSL type — the same legend the compiler's types imply.
const TYPE_COLOR: Record<GraphType, string> = {
  float: '#9aa7b5',
  vec2: '#6fae8f',
  vec3: '#c2a274',
  vec4: '#c0917a',
};

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

const rgbaToHex = (c: number[]) => {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round((v ?? 0) * 255))).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}${h(c[3] ?? 1)}`;
};
const hexToRgba = (hex: string): number[] => {
  const s = hex.replace('#', '');
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), s.length >= 8 ? n(6) : 1];
};

export function MaterialGraphEditor() {
  useSyncExternalStore(MaterialGraphDocument.subscribe, MaterialGraphDocument.getRevision);
  const graph = MaterialGraphDocument.asset;
  const filePath = MaterialGraphDocument.filePath;
  const dirty = MaterialGraphDocument.dirty;

  const canvasRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Right-click / Add menu: screen position for the shared ContextMenu + the
  // canvas position where an added node should land (and the node under it).
  const [menu, setMenu] = useState<{ sx: number; sy: number; cx: number; cy: number; nodeId?: string } | null>(null);
  // Infinite-canvas viewport — the same pan/zoom model as NodeGraphCanvas
  // (middle-drag pans, wheel zooms about the cursor; content in world coords).
  const [vp, setVp] = useState({ x: 0, y: 0, zoom: 1 });
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  // Live cursor (canvas coords) while connecting, to draw the in-progress wire.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; offX: number; offY: number; before: MaterialGraph } | null>(null);
  const wire = useRef<{ fromId: string } | null>(null);

  // Screen point → world coord (inverse of the viewport transform).
  const toCanvas = (clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: clientX, y: clientY };
    const r = el.getBoundingClientRect();
    return { x: (clientX - r.left - vp.x) / vp.zoom, y: (clientY - r.top - vp.y) / vp.zoom };
  };

  // Window-level move/up so a drag or wire keeps tracking outside the node it started on.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (pan.current) {
        const { sx, sy, vx, vy } = pan.current;
        setVp((v) => ({ ...v, x: vx + (e.clientX - sx), y: vy + (e.clientY - sy) }));
        return;
      }
      const p = toCanvas(e.clientX, e.clientY);
      if (drag.current && graph) {
        MaterialGraphDocument.replaceAsset(moveNode(graph, drag.current.id, p.x - drag.current.offX, p.y - drag.current.offY), { dirty: true });
      } else if (wire.current) {
        setCursor(p);
      }
    };
    const onUp = (e: PointerEvent) => {
      pan.current = null;
      if (drag.current && graph) {
        const after = graph;
        const before = drag.current.before;
        EditorHistory.record('Move node', () => MaterialGraphDocument.replaceAsset(after), () => MaterialGraphDocument.replaceAsset(before));
        drag.current = null;
      }
      if (wire.current && graph) {
        const p = toCanvas(e.clientX, e.clientY);
        const hit = nearestInputPort(graph, p.x, p.y);
        if (hit) MaterialGraphDocument.edit('Connect', (d) => Object.assign(d, connect(d, wire.current!.fromId, hit.nodeId, hit.slot)));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, vp]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && graph) {
        MaterialGraphDocument.edit('Delete node', (d) => Object.assign(d, removeNode(d, selected)));
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, graph]);

  if (!graph || !filePath) {
    return (
      <div className="panel mg">
        <div className="empty">
          <p>Open a `.esmatgraph` from the Content Browser to edit it.</p>
        </div>
      </div>
    );
  }

  const addAt = (type: GraphNodeType, x: number, y: number) => {
    MaterialGraphDocument.edit(`Add ${type}`, (d) => Object.assign(d, addNode(d, type, x, y).graph));
  };

  // The Add button and the canvas right-click share one menu; only where the
  // new node lands differs (view center vs. the click point).
  const openAddMenu = (sx: number, sy: number, cx: number, cy: number) => setMenu({ sx, sy, cx, cy });
  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    if (menu.nodeId) {
      const id = menu.nodeId;
      return [
        {
          label: 'Delete node',
          danger: true,
          onClick: () => {
            MaterialGraphDocument.edit('Delete node', (d) => Object.assign(d, removeNode(d, id)));
            setSelected(null);
          },
        },
      ];
    }
    return (Object.keys(NODE_SPECS) as GraphNodeType[])
      .filter((t) => NODE_SPECS[t].addable)
      .map((t) => ({ label: `Add ${NODE_SPECS[t].label}`, onClick: () => addAt(t, menu.cx, menu.cy) }));
  };

  const setNodeParam = (id: string, key: string, value: unknown) =>
    MaterialGraphDocument.edit(`Set ${key}`, (d) => {
      const n = d.nodes.find((m) => m.id === id);
      if (n) (n.params ??= {})[key] = value as never;
    });

  // Connections: each node's wired input slots → a bezier from the source output port.
  const wires: { key: string; d: string }[] = [];
  for (const n of graph.nodes) {
    const spec = NODE_SPECS[n.type];
    spec.inputs.forEach((port, i) => {
      const src = n.inputs?.[port.name];
      if (!src) return;
      const from = graph.nodes.find((m) => m.id === src);
      if (!from) return;
      const a = outPort(from);
      const b = inPort(n, i);
      wires.push({ key: `${n.id}.${port.name}`, d: bezier(a.x, a.y, b.x, b.y) });
    });
  }

  return (
    <div className="panel mg">
      <div className="mg-bar">
        <button
          type="button"
          className="mg-add"
          title="Add node"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const el = canvasRef.current;
            const cr = el?.getBoundingClientRect();
            const c = cr ? toCanvas(cr.left + cr.width / 2 - 80, cr.top + cr.height / 3) : { x: 60, y: 60 };
            openAddMenu(r.left, r.bottom + 2, c.x, c.y);
          }}
        >
          <Plus size={13} strokeWidth={2} /> Add
        </button>
        {selected && (
          <button type="button" className="mg-del" onClick={() => { MaterialGraphDocument.edit('Delete node', (d) => Object.assign(d, removeNode(d, selected))); setSelected(null); }} title="Delete selected">
            <Trash2 size={13} strokeWidth={1.9} />
          </button>
        )}
        <span className="mg-title">{filePath.split('/').pop()}{dirty && <DirtyDot />}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="primary" disabled={!dirty} onClick={() => void saveMaterialGraph(filePath, graph)}>
          <Save size={13} strokeWidth={1.9} /> Save
        </button>
      </div>

      <div
        className="mg-canvas"
        ref={canvasRef}
        style={{ backgroundSize: `${20 * vp.zoom}px ${20 * vp.zoom}px`, backgroundPosition: `${vp.x}px ${vp.y}px` }}
        onPointerDown={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            pan.current = { sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y };
            return;
          }
          setSelected(null);
        }}
        onWheel={(e) => {
          const el = canvasRef.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          setVp((v) => {
            const zoom = Math.min(2.5, Math.max(0.25, v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
            const k = zoom / v.zoom;
            return { x: mx - (mx - v.x) * k, y: my - (my - v.y) * k, zoom };
          });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const p = toCanvas(e.clientX, e.clientY);
          openAddMenu(e.clientX, e.clientY, p.x, p.y);
        }}
      >
        <div style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, transformOrigin: '0 0' }}>
        <svg className="mg-wires" aria-hidden="true">
          {wires.map((w) => <path key={w.key} d={w.d} />)}
          {wire.current && cursor && (() => {
            const from = graph.nodes.find((m) => m.id === wire.current!.fromId);
            if (!from) return null;
            const a = outPort(from);
            return <path className="mg-wire-live" d={bezier(a.x, a.y, cursor.x, cursor.y)} />;
          })()}
        </svg>

        {graph.nodes.map((n) => {
          const spec = NODE_SPECS[n.type];
          const h = HEADER_H + Math.max(spec.inputs.length, 1) * ROW_H + spec.params.length * ROW_H;
          return (
            <div
              key={n.id}
              className={`mg-node${selected === n.id ? ' sel' : ''}`}
              style={{ left: nodeX(n), top: nodeY(n), width: NODE_W, minHeight: h }}
              onPointerDown={(e) => { e.stopPropagation(); setSelected(n.id); }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSelected(n.id);
                const p = toCanvas(e.clientX, e.clientY);
                setMenu({ sx: e.clientX, sy: e.clientY, cx: p.x, cy: p.y, nodeId: n.id });
              }}
            >
              <div
                className="mg-node-head"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSelected(n.id);
                  const p = toCanvas(e.clientX, e.clientY);
                  drag.current = { id: n.id, offX: p.x - nodeX(n), offY: p.y - nodeY(n), before: graph };
                }}
              >
                {spec.label}
              </div>

              {/* Output port (right edge, at the header row). */}
              {spec.output && (
                <span
                  className="mg-port out"
                  style={{ top: HEADER_H / 2, background: TYPE_COLOR[spec.output] }}
                  title={spec.output}
                  onPointerDown={(e) => { e.stopPropagation(); wire.current = { fromId: n.id }; setCursor(toCanvas(e.clientX, e.clientY)); }}
                />
              )}

              {/* Input ports + rows. Click a wired input to disconnect it. */}
              {spec.inputs.map((port) => (
                <div className="mg-row" key={port.name} style={{ height: ROW_H }}>
                  <span
                    className="mg-port in"
                    style={{ top: '50%', background: TYPE_COLOR[port.type] }}
                    title={port.type}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (n.inputs?.[port.name]) MaterialGraphDocument.edit('Disconnect', (d) => Object.assign(d, disconnect(d, n.id, port.name)));
                    }}
                  />
                  <span className="mg-row-label">{port.name}</span>
                </div>
              ))}

              {/* Node literal params (constColor / constFloat / textureSample). */}
              {spec.params.map((pf) => (
                <div className="mg-param" key={pf.key} style={{ height: ROW_H }}>
                  <span className="mg-row-label">{pf.label}</span>
                  {pf.kind === 'color' && (
                    <ColorControl value={rgbaToHex((n.params?.value as number[]) ?? [1, 1, 1, 1])} onChange={(hex) => setNodeParam(n.id, 'value', hexToRgba(hex))} />
                  )}
                  {pf.kind === 'float' && (
                    <NumField value={typeof n.params?.value === 'number' ? n.params.value : 0} onCommit={(v) => setNodeParam(n.id, 'value', v)} />
                  )}
                  {pf.kind === 'texture' && (
                    <span className="mg-texname">{String(n.params?.name ?? '')}</span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        </div>
      </div>

      {menu && <ContextMenu x={menu.sx} y={menu.sy} items={menuItems()} onClose={() => setMenu(null)} />}
    </div>
  );
}

// The input port nearest (@p x,@p y) within a small radius — the connect-drop hit test.
function nearestInputPort(graph: MaterialGraph, x: number, y: number): { nodeId: string; slot: string } | null {
  let best: { nodeId: string; slot: string } | null = null;
  let bestD2 = 18 * 18;
  for (const n of graph.nodes) {
    const inputs = NODE_SPECS[n.type].inputs;
    for (let i = 0; i < inputs.length; i++) {
      const p = inPort(n, i);
      const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { nodeId: n.id, slot: inputs[i].name };
      }
    }
  }
  return best;
}
