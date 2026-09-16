// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    graphOps.ts
 * @brief   Immutable edits on a ScriptGraph — the editor's model.
 *
 * Pure functions returning new graphs (never mutating), so the panel drives them
 * through AssetDocument.edit for free undo, mirroring fsmGraph and btGraph. The
 * wire rules live here rather than in the panel, because the loader has to apply
 * the same ones to a file somebody wrote by hand.
 */

import {
    canConnect,
    type ScriptGraph, type ScriptGraphEdge, type ScriptGraphPort, type ScriptGraphVariable, type ScriptValue,
} from './types';
import { describeNode, type ScriptVerbCatalog } from './nodes';

function clone(graph: ScriptGraph): ScriptGraph {
    return JSON.parse(JSON.stringify(graph)) as ScriptGraph;
}

/** A node id nothing in the graph uses. Short and stable enough to read in a diff. */
function freshId(graph: ScriptGraph, kind: string): string {
    const stem = kind.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const taken = new Set(graph.nodes.map((n) => n.id));
    for (let i = 1; ; i++) {
        const id = `${stem}_${i}`;
        if (!taken.has(id)) return id;
    }
}

const edgeId = (from: string, fromPort: string, to: string, toPort: string): string =>
    `${from}.${fromPort}->${to}.${toPort}`;

/** Add a node of `kind` (a `call` carries the name it runs) at a canvas point. */
export function addScriptNode(
    graph: ScriptGraph, kind: string, x: number, y: number, ref?: string,
): { graph: ScriptGraph; id: string } {
    const next = clone(graph);
    const id = freshId(graph, ref ?? kind);
    next.nodes.push({ id, kind, ...(ref ? { ref } : {}), x, y });
    return { graph: next, id };
}

export function moveScriptNode(graph: ScriptGraph, id: string, x: number, y: number): ScriptGraph {
    const next = clone(graph);
    const node = next.nodes.find((n) => n.id === id);
    if (node) { node.x = x; node.y = y; }
    return next;
}

/** Remove a node and every wire that touched it — a dangling wire is not a graph. */
export function removeScriptNode(graph: ScriptGraph, id: string): ScriptGraph {
    const next = clone(graph);
    next.nodes = next.nodes.filter((n) => n.id !== id);
    next.edges = next.edges.filter((e) => e.from !== id && e.to !== id);
    return next;
}

export function setScriptNodeLiteral(
    graph: ScriptGraph, id: string, port: string, value: ScriptValue,
): ScriptGraph {
    const next = clone(graph);
    const node = next.nodes.find((n) => n.id === id);
    if (node) (node.literals ??= {})[port] = value;
    return next;
}

/**
 * Whether a wire may be drawn. Both halves of the answer live here: the ports
 * must exist and their types must meet.
 */
export function canConnectPorts(
    graph: ScriptGraph, catalog: ScriptVerbCatalog,
    from: string, fromPort: string, to: string, toPort: string,
): boolean {
    if (from === to) return false;
    const fromNode = graph.nodes.find((n) => n.id === from);
    const toNode = graph.nodes.find((n) => n.id === to);
    if (!fromNode || !toNode) return false;
    const fromShape = describeNode(fromNode, graph, catalog);
    const toShape = describeNode(toNode, graph, catalog);
    if (!fromShape || !toShape) return false;

    if (fromShape.execOut.includes(fromPort)) return toShape.execIn && toPort === '';
    const out = fromShape.outputs.find((p) => p.name === fromPort);
    const inp = toShape.inputs.find((p) => p.name === toPort);
    return !!out && !!inp && canConnect(out.type, inp.type);
}

/**
 * Draw a wire, replacing whatever occupied the pin.
 *
 * An input takes ONE value and an exec pin hands control to ONE node: both ends
 * of a replaced wire are unambiguous, and a second wire into either would make
 * the picture stop saying what happens.
 */
export function connectScriptNodes(
    graph: ScriptGraph, catalog: ScriptVerbCatalog,
    from: string, fromPort: string, to: string, toPort: string,
): ScriptGraph {
    if (!canConnectPorts(graph, catalog, from, fromPort, to, toPort)) return graph;
    const next = clone(graph);
    const isExec = toPort === '';
    next.edges = next.edges.filter((e) => (isExec
        ? !(e.from === from && e.fromPort === fromPort)
        : !(e.to === to && e.toPort === toPort)));
    next.edges.push({ id: edgeId(from, fromPort, to, toPort), from, fromPort, to, toPort });
    return next;
}

/** Cut the wire arriving at one input port. */
export function disconnectScriptInput(graph: ScriptGraph, to: string, toPort: string): ScriptGraph {
    const next = clone(graph);
    next.edges = next.edges.filter((e) => !(e.to === to && e.toPort === toPort));
    return next;
}

/** Cut the wire leaving one exec pin. */
export function disconnectScriptExec(graph: ScriptGraph, from: string, fromPort: string): ScriptGraph {
    const next = clone(graph);
    next.edges = next.edges.filter((e) => !(e.from === from && e.fromPort === fromPort));
    return next;
}

export function removeScriptEdge(graph: ScriptGraph, id: string): ScriptGraph {
    const next = clone(graph);
    next.edges = next.edges.filter((e) => e.id !== id);
    return next;
}

/** Every wire, as the canvas wants them — exec wires land on the `''` input pin. */
export function scriptGraphEdges(graph: ScriptGraph): readonly ScriptGraphEdge[] {
    return graph.edges;
}

export function addScriptVariable(graph: ScriptGraph, variable: ScriptGraphVariable): ScriptGraph {
    const next = clone(graph);
    next.variables ??= [];
    if (!next.variables.some((v) => v.name === variable.name)) next.variables.push(variable);
    return next;
}

/**
 * Drop a variable. The nodes naming it stay, and `describeNode` types their pin
 * `any` — a delete that silently removed the nodes reading it would lose work
 * the author can still see is wrong.
 */
export function removeScriptVariable(graph: ScriptGraph, name: string): ScriptGraph {
    const next = clone(graph);
    next.variables = (next.variables ?? []).filter((v) => v.name !== name);
    return next;
}

/**
 * Declare a port on this graph's signature — what a `graph.call` elsewhere will
 * show. The side is the author's choice, not a guess from the wires: a port with
 * nothing wired to it yet still has to exist to wire INTO.
 */
export function addScriptGraphPort(
    graph: ScriptGraph, side: 'inputs' | 'outputs', port: ScriptGraphPort,
): ScriptGraph {
    const next = clone(graph);
    next[side] ??= [];
    if (!next[side]!.some((p) => p.name === port.name)) next[side]!.push(port);
    return next;
}

/**
 * Drop a port. Wires that landed on it go with it — unlike a variable, whose
 * nodes stay readable, a pin that no longer exists has nowhere to draw an edge.
 */
export function removeScriptGraphPort(
    graph: ScriptGraph, side: 'inputs' | 'outputs', name: string,
): ScriptGraph {
    const next = clone(graph);
    next[side] = (next[side] ?? []).filter((p) => p.name !== name);
    const kind = side === 'inputs' ? 'graph.input' : 'graph.output';
    const ends = new Set(next.nodes.filter((n) => n.kind === kind).map((n) => n.id));
    next.edges = next.edges.filter((e) => !(
        side === 'inputs' ? ends.has(e.from) && e.fromPort === name : ends.has(e.to) && e.toPort === name
    ));
    return next;
}

/** Rename a port, carrying the wires on it along. */
export function renameScriptGraphPort(
    graph: ScriptGraph, side: 'inputs' | 'outputs', from: string, to: string,
): ScriptGraph {
    if (!to || from === to) return graph;
    const next = clone(graph);
    const port = (next[side] ?? []).find((p) => p.name === from);
    if (!port || (next[side] ?? []).some((p) => p.name === to)) return graph;
    port.name = to;
    const kind = side === 'inputs' ? 'graph.input' : 'graph.output';
    const ends = new Set(next.nodes.filter((n) => n.kind === kind).map((n) => n.id));
    for (const e of next.edges) {
        if (side === 'inputs' && ends.has(e.from) && e.fromPort === from) e.fromPort = to;
        if (side === 'outputs' && ends.has(e.to) && e.toPort === from) e.toPort = to;
    }
    return next;
}

/** Retype a port, dropping wires the new type cannot carry. */
export function retypeScriptGraphPort(
    graph: ScriptGraph, side: 'inputs' | 'outputs', name: string, type: ScriptGraphPort['type'],
): ScriptGraph {
    const next = clone(graph);
    const port = (next[side] ?? []).find((p) => p.name === name);
    if (!port || port.type === type) return graph;
    port.type = type;
    return next;
}

/** Rename a variable, carrying every node that names it along with it. */
export function renameScriptVariable(graph: ScriptGraph, from: string, to: string): ScriptGraph {
    if (!to || from === to) return graph;
    const next = clone(graph);
    const variable = (next.variables ?? []).find((v) => v.name === from);
    if (!variable || (next.variables ?? []).some((v) => v.name === to)) return graph;
    variable.name = to;
    for (const node of next.nodes) {
        if ((node.kind === 'var.get' || node.kind === 'var.set') && node.literals?.name === from) {
            node.literals.name = to;
        }
    }
    return next;
}
