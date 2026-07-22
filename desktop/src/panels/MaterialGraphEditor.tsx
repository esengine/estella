// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MaterialGraphEditor.tsx
 * @brief   The `.esmatgraph` node editor — typed material nodes on the shared
 *          <NodeGraphCanvas> (pan/zoom, wire-to-connect, selection, menus are
 *          the canvas's). This file supplies only the material domain: NODE_SPECS
 *          drives ports (typed, colored), node bodies, and the add menu; all
 *          mutation goes through the pure SDK ops on MaterialGraphDocument.
 *          Save compiles the graph to its sibling `.esshader`.
 *
 *          Wires land on typed input ports (nearest-port snap on drop); a wired
 *          input disconnects on click, and wires are selectable — Delete removes
 *          them like any edge.
 */
import { useRef, useState, useSyncExternalStore } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
import { t } from '@/i18n';
import { MaterialGraphDocument } from '@/material/MaterialGraphDocument';
import { saveMaterialGraph } from '@/material/openMaterialGraph';
import { ColorControl } from '@/components/ColorControl';
import { SaveButton } from '@/components/SaveButton';
import { NumField } from '@/components/NumField';
import {
  NodeGraphCanvas,
  type CanvasEdge,
  type CanvasNode,
  type CanvasPort,
  type NodeGraphCanvasApi,
} from '@/components/NodeGraphCanvas';

type MatCanvasNode = MaterialGraph['nodes'][number] & CanvasNode;

const NODE_W = 168;
const HEADER_H = 28;
const ROW_H = 24;

// Port hue by GLSL type — the same legend the compiler's types imply.
const TYPE_COLOR: Record<GraphType, string> = {
  float: '#9aa7b5',
  vec2: '#6fae8f',
  vec3: '#c2a274',
  vec4: '#c0917a',
};

const rgbaToHex = (c: number[]) => {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round((v ?? 0) * 255))).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}${h(c[3] ?? 1)}`;
};
const hexToRgba = (hex: string): number[] => {
  const s = hex.replace('#', '');
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), s.length >= 8 ? n(6) : 1];
};

const nodeHeight = (n: MatCanvasNode): number => {
  const spec = NODE_SPECS[n.type];
  return HEADER_H + Math.max(spec.inputs.length, 1) * ROW_H + spec.params.length * ROW_H;
};

/** One edge per wired input slot; the id round-trips to (node, slot) for delete. */
const wireId = (to: string, slot: string) => `${to}#${slot}`;
const parseWireId = (id: string): { to: string; slot: string } | null => {
  const i = id.lastIndexOf('#');
  return i > 0 ? { to: id.slice(0, i), slot: id.slice(i + 1) } : null;
};

export function MaterialGraphEditor() {
  useSyncExternalStore(MaterialGraphDocument.subscribe, MaterialGraphDocument.getRevision);
  const graph = MaterialGraphDocument.asset;
  const filePath = MaterialGraphDocument.filePath;
  const dirty = MaterialGraphDocument.dirty;

  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const dragBefore = useRef<MaterialGraph | null>(null);
  const canvas = useRef<NodeGraphCanvasApi>(null);

  if (!graph || !filePath) {
    return <div className="panel ng-placeholder"><p>{t('mat.openHintPrefix')}<code>.esmatgraph</code>{t('mat.openHintSuffix')}</p></div>;
  }

  const nodes = graph.nodes as MatCanvasNode[];
  const edges: CanvasEdge[] = [];
  for (const n of nodes) {
    for (const port of NODE_SPECS[n.type].inputs) {
      const src = n.inputs?.[port.name];
      if (src) edges.push({ id: wireId(n.id, port.name), from: src, to: n.id, toPort: port.name });
    }
  }

  const deleteNode = (id: string) => {
    MaterialGraphDocument.edit('Delete node', (d) => Object.assign(d, removeNode(d, id)));
    setSelected(null);
  };
  const disconnectSlot = (nodeId: string, slot: string) =>
    MaterialGraphDocument.edit('Disconnect', (d) => Object.assign(d, disconnect(d, nodeId, slot)));
  const setNodeParam = (id: string, key: string, value: unknown) =>
    MaterialGraphDocument.edit(`Set ${key}`, (d) => {
      const n = d.nodes.find((m) => m.id === id);
      if (n) (n.params ??= {})[key] = value as never;
    });

  const toolbar = (
    <>
      <button
        type="button"
        className="ng-btn"
        title={t('mat.addNode')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          canvas.current?.openMenuAt(r.left, r.bottom + 2);
        }}
      >
        <Plus size={13} strokeWidth={2} /> {t('mat.add')}
      </button>
      {selected && (
        <button type="button" className="ng-btn" title={t('mat.deleteSelected')} onClick={() => deleteNode(selected)}>
          <Trash2 size={13} strokeWidth={1.9} />
        </button>
      )}
      <span className="ng-doc-title">{filePath.split('/').pop()}</span>
      <span style={{ flex: 1 }} />
      <SaveButton dirty={dirty} onSave={() => void saveMaterialGraph(filePath, graph)} label={t('mat.save')} />
    </>
  );

  return (
    <NodeGraphCanvas<MatCanvasNode, CanvasEdge>
      apiRef={canvas}
      nodes={nodes}
      edges={edges}
      selectedNode={selected}
      selectedEdge={selectedEdge}
      nodeSize={(n) => ({ width: NODE_W, height: nodeHeight(n) })}
      outputs={(n) => {
        const out = NODE_SPECS[n.type].output;
        return out ? [{ id: '', y: HEADER_H / 2, color: TYPE_COLOR[out], title: out }] : [];
      }}
      inputs={(n) =>
        NODE_SPECS[n.type].inputs.map((port, i): CanvasPort => ({
          id: port.name,
          y: HEADER_H + ROW_H * i + ROW_H / 2,
          color: TYPE_COLOR[port.type],
          title: `${port.name}: ${port.type}`,
        }))
      }
      onInputPortDown={(nodeId, slot) => {
        const n = nodes.find((m) => m.id === nodeId);
        if (n?.inputs?.[slot]) disconnectSlot(nodeId, slot);
      }}
      onSelectNode={setSelected}
      onSelectEdge={setSelectedEdge}
      onMoveNodeStart={() => { dragBefore.current = graph; }}
      onMoveNode={(id, x, y) => MaterialGraphDocument.replaceAsset(moveNode(graph, id, x, y), { dirty: true })}
      onMoveNodeEnd={() => {
        const after = MaterialGraphDocument.asset;
        const before = dragBefore.current;
        if (after && before) MaterialGraphDocument.recordEdit('Move node', before, after);
      }}
      onConnect={(from, to, _fromPort, toPort) =>
        MaterialGraphDocument.edit('Connect', (d) => Object.assign(d, connect(d, from, to, toPort)))}
      onDeleteNode={deleteNode}
      onDeleteEdge={(id) => {
        const w = parseWireId(id);
        if (w) disconnectSlot(w.to, w.slot);
        setSelectedEdge(null);
      }}
      menuItems={(target) =>
        target.kind === 'node'
          ? [{ label: t('mat.deleteNode'), danger: true, onClick: () => deleteNode(target.nodeId!) }]
          : (Object.keys(NODE_SPECS) as GraphNodeType[])
              .filter((nt) => NODE_SPECS[nt].addable)
              .map((nt) => ({
                label: t('mat.addNodeType', { label: NODE_SPECS[nt].label }),
                onClick: () => MaterialGraphDocument.edit(`Add ${nt}`, (d) => Object.assign(d, addNode(d, nt, target.x, target.y).graph)),
              }))}
      toolbar={toolbar}
      emptyHint={t('mat.emptyHint')}
      renderNode={(n, sel) => {
        const spec = NODE_SPECS[n.type];
        return (
          <div className={`mg-node${sel ? ' sel' : ''}`}>
            <div className="mg-node-head">{spec.label}</div>
            {spec.inputs.map((port) => (
              <div className="mg-row" key={port.name} style={{ height: ROW_H }}>
                <span className="mg-row-label">{port.name}</span>
              </div>
            ))}
            {spec.inputs.length === 0 && <div className="mg-row" style={{ height: ROW_H }} />}
            {spec.params.map((pf) => (
              <div className="mg-param" key={pf.key} style={{ height: ROW_H }} onPointerDown={(e) => e.stopPropagation()}>
                <span className="mg-row-label">{pf.label}</span>
                {pf.kind === 'color' && (
                  <ColorControl value={rgbaToHex((n.params?.[pf.key] as number[]) ?? [1, 1, 1, 1])} onChange={(hex) => setNodeParam(n.id, pf.key, hexToRgba(hex))} />
                )}
                {pf.kind === 'float' && (
                  <NumField value={typeof n.params?.[pf.key] === 'number' ? (n.params?.[pf.key] as number) : 0} onCommit={(v) => setNodeParam(n.id, pf.key, v)} />
                )}
                {pf.kind === 'texture' && (
                  <span className="mg-texname">{String(n.params?.name ?? '')}</span>
                )}
              </div>
            ))}
          </div>
        );
      }}
    />
  );
}
