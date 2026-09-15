// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    types.ts
 * @brief   `.esgraph` — the authored shape of a script graph.
 *
 * A graph is nodes, wires, and declared variables. It is the RUNTIME definition:
 * nothing compiles it, so the graph the editor runs and the graph the package
 * ships are the same bytes (the `.esbt` contract).
 *
 * What a node's PORTS are is deliberately absent from the file. A port list
 * comes from the node's kind (the built-in table) or, for a `call`, from what
 * the name declared to the registry — one author, two readers (the interpreter
 * and the canvas). Written into the file it would be a second author, and an
 * old file would keep drawing a port its verb no longer has.
 */

/** What a wire carries. `exec` is the control wire; the rest are data. */
export type ScriptValueType = 'exec' | 'bool' | 'number' | 'string' | 'entity' | 'any';

/** A value flowing through a data wire, and the form a literal is stored in. */
export type ScriptValue = boolean | number | string | null;

/** One port on a node. */
export interface ScriptPort {
    /** Port id, unique within its node and side. Also the fallback label. */
    name: string;
    type: ScriptValueType;
    label?: string;
}

export interface ScriptGraphNode {
    id: string;
    /** Built-in node kind (`flow.branch`, `event.start`, …) or `'call'`. */
    kind: string;
    /** For `kind: 'call'` — the registry name this node runs. */
    ref?: string;
    /**
     * Values for input ports nothing is wired into, plus the literals that SHAPE
     * a node (an `event.on` type, a `flow.sequence` pin count). Keyed by port id.
     */
    literals?: Record<string, ScriptValue>;
    /** Editor canvas position. The interpreter ignores it. */
    x?: number;
    y?: number;
}

export interface ScriptGraphEdge {
    id: string;
    from: string;
    /** Output port id on `from`. */
    fromPort: string;
    to: string;
    /** Input port id on `to`. */
    toPort: string;
}

/** A graph-local variable: declared by the asset, valued per entity. */
export interface ScriptGraphVariable {
    name: string;
    type: Exclude<ScriptValueType, 'exec' | 'any'>;
    default?: ScriptValue;
}

export interface ScriptGraph {
    version: string;
    name?: string;
    variables?: ScriptGraphVariable[];
    nodes: ScriptGraphNode[];
    edges: ScriptGraphEdge[];
}

export const SCRIPT_GRAPH_VERSION = '1.0';

/** An empty graph, the shape "New Script Graph" writes. */
export function emptyScriptGraph(name?: string): ScriptGraph {
    return { version: SCRIPT_GRAPH_VERSION, ...(name ? { name } : {}), nodes: [], edges: [] };
}

/**
 * Whether a wire from `from` to `to` is legal. ONE answer, two askers: the
 * editor refuses the drag, the loader reports the file. `any` accepts and is
 * accepted; `exec` only ever meets `exec`.
 */
export function canConnect(from: ScriptValueType, to: ScriptValueType): boolean {
    if (from === 'exec' || to === 'exec') return from === to;
    if (from === 'any' || to === 'any') return true;
    if (from === to) return true;
    // Widening only, and only where the reading side cannot be surprised:
    // every number and bool has a string spelling, and a number is truthy or not.
    if (to === 'string') return from === 'number' || from === 'bool';
    if (to === 'bool') return from === 'number';
    if (to === 'number') return from === 'bool' || from === 'entity';
    return false;
}

/** Coerce a value to the port type reading it — the runtime half of {@link canConnect}. */
export function coerceValue(value: ScriptValue, type: ScriptValueType): ScriptValue {
    if (value === null || type === 'any' || type === 'exec') return value;
    switch (type) {
        case 'number':
        case 'entity': {
            if (typeof value === 'number') return value;
            if (typeof value === 'boolean') return value ? 1 : 0;
            const n = Number(value);
            return Number.isFinite(n) ? n : 0;
        }
        case 'bool':
            return typeof value === 'boolean' ? value : Boolean(value);
        case 'string':
            return typeof value === 'string' ? value : String(value);
    }
}

/** The value a port of `type` holds before anything writes one. */
export function defaultForType(type: ScriptValueType): ScriptValue {
    switch (type) {
        case 'number': return 0;
        case 'entity': return 0;
        case 'bool': return false;
        case 'string': return '';
        default: return null;
    }
}
