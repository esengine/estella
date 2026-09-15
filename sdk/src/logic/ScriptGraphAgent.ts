// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ScriptGraphAgent.ts
 * @brief   ScriptGraphAgent component + the compiled-graph store.
 *
 * The authorable half: which graph to run (a registered name or a `.esgraph`
 * asset key). Mirrors StateMachineAgent — an entity carries the reference and
 * the plugin does the ticking, so the component stays serializable.
 */

import { defineComponent } from '../ecs/component';
import { isUuidRef } from '../asset/AssetRegistry';
import { aiRegistry } from '../ai/fsm/AiContext';
import { ensureBuiltinAiRegistrations } from '../ai/builtins';
import { ensureBuiltinScriptNodes } from './builtinNodes';
import { compileScriptGraph, type CompiledScriptGraph } from './ScriptGraphRunner';
import type { ScriptGraph } from './types';

export interface ScriptGraphAgentData {
    /** Key of the graph to run: a `registerScriptGraph` name or a `.esgraph` path. */
    graph: string;
}

export const ScriptGraphAgent = defineComponent<ScriptGraphAgentData>('ScriptGraphAgent', {
    graph: '',
}, {
    assetFields: [{ field: 'graph', type: 'scriptgraph' }],
    // Preload a `.esgraph` path or an editor-serialized uuid ref with the scene,
    // so the graph is registered before the agent first ticks. A plain code name
    // is left alone — this callback is the discovery authority.
    discoverAssets: data => {
        const graph = data.graph;
        return typeof graph === 'string' && (graph.endsWith('.esgraph') || isUuidRef(graph))
            ? [{ type: 'scriptgraph', path: graph }]
            : [];
    },
});

/**
 * Compile against the shared registry, having made sure the engine's own verbs
 * are in it. A graph compiled before they registered would carry a problem for
 * every built-in name it calls — and the compile happens at asset prepare, which
 * can precede any plugin's build.
 */
export function compileAgainstRegistry(graph: ScriptGraph): CompiledScriptGraph {
    ensureBuiltinAiRegistrations();
    ensureBuiltinScriptNodes();
    return compileScriptGraph(graph, aiRegistry);
}

/**
 * Graphs a game registered in CODE, process-wide. A `.esgraph` does not land
 * here — it belongs to the realm that loaded it, which a lookup asks first.
 */
const graphStore = new Map<string, CompiledScriptGraph>();

/** Register (compile) a graph under `key` — the code half of the registry. */
export function registerScriptGraph(key: string, graph: ScriptGraph): CompiledScriptGraph {
    const compiled = compileAgainstRegistry(graph);
    graphStore.set(key, compiled);
    return compiled;
}

export function getScriptGraph(key: string): CompiledScriptGraph | undefined {
    return graphStore.get(key);
}

/** Every registered graph — what the schedule reads to learn this system's reach. */
export function allScriptGraphs(): Iterable<CompiledScriptGraph> {
    return graphStore.values();
}

/** Drop all registered graphs (tests / hot-reload). */
export function clearScriptGraphStore(): void {
    graphStore.clear();
}
