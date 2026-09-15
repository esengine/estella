// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    nodes.ts
 * @brief   What a node's pins are — the one answer the interpreter and the
 *          canvas both read.
 *
 * Only the kinds the registry CANNOT express live here: entries (the interpreter
 * ignites them), flow (they steer the exec wire), variables and literals (they
 * read the interpreter's own state). Everything else — maths, comparisons,
 * reading a component, spawning — is an ordinary registered name, so a project
 * or a plugin extends the vocabulary exactly the way the engine does. There is
 * no built-in privilege to reach for.
 */

import type { AiOutputDef, AiParamDef } from '../ai/fsm/registry';
import type { ScriptGraph, ScriptGraphNode, ScriptPort, ScriptValueType } from './types';

/**
 * The registry, narrowed to what a shape needs. An `AiRegistry` satisfies it
 * structurally; so does the editor's catalog, which knows the names the open
 * PROJECT registered — names the editor's own realm never executes and so could
 * never have in a live registry.
 */
export interface ScriptVerbCatalog {
    hasAction(name: string): boolean;
    getActionParams(name: string): readonly AiParamDef[];
    getActionOutputs(name: string): readonly AiOutputDef[];
    isActionPure(name: string): boolean;
}

/** A node's pins, plus the two facts the interpreter needs to place it. */
export interface ScriptNodeShape {
    /** Whether an exec wire can arrive. Pure nodes have none. */
    execIn: boolean;
    /** Exec output pins, in display order. */
    execOut: readonly string[];
    inputs: readonly ScriptPort[];
    outputs: readonly ScriptPort[];
    /** No side effects: may be pulled on demand, in any order. */
    pure: boolean;
    /** Set on the nodes a tick ignites, saying which occasion lights them. */
    entry?: 'start' | 'update' | 'destroy' | 'event';
}

/** Default exec pin name — the single "and then" every flow-through node has. */
export const THEN = 'then';

/** An action's declared parameter as a port. `enum` is a string with choices. */
function portOfParam(p: AiParamDef): ScriptPort {
    return { name: p.name, type: p.type === 'enum' ? 'string' : p.type, label: p.label };
}

function portOfOutput(o: AiOutputDef): ScriptPort {
    return { name: o.name, type: o.type, label: o.label };
}

const NO_PORTS: readonly ScriptPort[] = [];

function entry(outputs: readonly ScriptPort[], occasion: ScriptNodeShape['entry']): ScriptNodeShape {
    return { execIn: false, execOut: [THEN], inputs: NO_PORTS, outputs, pure: false, entry: occasion };
}

/** Literal-valued node kinds → the type they carry. */
const LITERAL_KINDS: Record<string, ScriptValueType> = {
    'lit.number': 'number',
    'lit.bool': 'bool',
    'lit.string': 'string',
};

/** The declared type of `name` in this graph, or `any` when it declares none. */
function variableType(graph: ScriptGraph, name: unknown): ScriptValueType {
    if (typeof name !== 'string') return 'any';
    return graph.variables?.find((v) => v.name === name)?.type ?? 'any';
}

/**
 * How many exec pins a `flow.sequence` shows. Authored, not inferred from the
 * wires: a pin the author added and has not wired yet still has to be there to
 * wire INTO, and inferring the count from edges would delete it on reload.
 */
export function sequenceCount(node: ScriptGraphNode): number {
    const raw = node.literals?.count;
    const n = typeof raw === 'number' ? Math.floor(raw) : 2;
    return Math.max(1, Math.min(16, n));
}

/**
 * The pins of one node, or null when nothing knows this kind — an unknown node
 * is reported, never treated as a no-op, because a graph missing a verb is a
 * graph that does something else.
 */
export function describeNode(
    node: ScriptGraphNode,
    graph: ScriptGraph,
    catalog: ScriptVerbCatalog,
): ScriptNodeShape | null {
    switch (node.kind) {
        case 'event.start':
            return entry(NO_PORTS, 'start');
        case 'event.update':
            return entry([{ name: 'dt', type: 'number' }], 'update');
        case 'event.destroy':
            return entry(NO_PORTS, 'destroy');
        case 'event.on':
            return entry([{ name: 'target', type: 'entity' }], 'event');

        case 'flow.branch':
            return {
                execIn: true, execOut: ['true', 'false'],
                inputs: [{ name: 'cond', type: 'bool' }], outputs: NO_PORTS, pure: false,
            };
        case 'flow.sequence':
            return {
                execIn: true,
                execOut: Array.from({ length: sequenceCount(node) }, (_, i) => String(i)),
                inputs: NO_PORTS, outputs: NO_PORTS, pure: false,
            };
        case 'flow.while':
            return {
                execIn: true, execOut: ['body', 'done'],
                inputs: [{ name: 'cond', type: 'bool' }], outputs: NO_PORTS, pure: false,
            };
        case 'flow.delay':
            return {
                execIn: true, execOut: [THEN],
                inputs: [{ name: 'seconds', type: 'number' }], outputs: NO_PORTS, pure: false,
            };

        case 'var.get':
            return {
                execIn: false, execOut: [], inputs: NO_PORTS,
                outputs: [{ name: 'value', type: variableType(graph, node.literals?.name) }],
                pure: true,
            };
        case 'var.set':
            return {
                execIn: true, execOut: [THEN],
                inputs: [{ name: 'value', type: variableType(graph, node.literals?.name) }],
                outputs: NO_PORTS, pure: false,
            };

        case 'call': {
            const ref = node.ref;
            if (!ref || !catalog.hasAction(ref)) return null;
            const pure = catalog.isActionPure(ref);
            return {
                execIn: !pure,
                execOut: pure ? [] : [THEN],
                inputs: catalog.getActionParams(ref).map(portOfParam),
                outputs: catalog.getActionOutputs(ref).map(portOfOutput),
                pure,
            };
        }
    }

    const literal = LITERAL_KINDS[node.kind];
    if (literal) {
        return {
            execIn: false, execOut: [], inputs: NO_PORTS,
            outputs: [{ name: 'value', type: literal }], pure: true,
        };
    }
    return null;
}

/** Every built-in kind, for the editor palette. `call` is not one — it is a name. */
export const BUILTIN_NODE_KINDS: readonly string[] = [
    'event.start', 'event.update', 'event.destroy', 'event.on',
    'flow.branch', 'flow.sequence', 'flow.while', 'flow.delay',
    'var.get', 'var.set',
    'lit.number', 'lit.bool', 'lit.string',
];
