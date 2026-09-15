// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Script graph barrel — the `.esgraph` authoring form of a behaviour.
 *
 * The core is pure and wasm-free (types, pins, interpreter), the way the FSM and
 * behaviour-tree cores are, so the editor can compile a graph to validate it
 * without an engine. The verbs a graph calls are the `aiRegistry` names — this
 * layer adds no second vocabulary.
 */

export {
    SCRIPT_GRAPH_VERSION,
    emptyScriptGraph,
    canConnect,
    coerceValue,
    defaultForType,
    type ScriptGraph,
    type ScriptGraphNode,
    type ScriptGraphEdge,
    type ScriptGraphVariable,
    type ScriptPort,
    type ScriptValue,
    type ScriptValueType,
} from './types';

export {
    describeNode,
    sequenceCount,
    BUILTIN_NODE_KINDS,
    THEN,
    type ScriptNodeShape,
    type ScriptVerbCatalog,
} from './nodes';

export {
    compileScriptGraph,
    createScriptRunState,
    stepScriptGraph,
    destroyScriptGraph,
    fireScriptGraphEvent,
    DEFAULT_STEP_BUDGET,
    type CompiledScriptGraph,
    type ScriptRunState,
    type ScriptTickContext,
} from './ScriptGraphRunner';

export {
    ScriptGraphAgent,
    registerScriptGraph,
    getScriptGraph,
    allScriptGraphs,
    clearScriptGraphStore,
    compileAgainstRegistry,
    type ScriptGraphAgentData,
} from './ScriptGraphAgent';

export {
    ScriptGraphPlugin,
    scriptGraphPlugin,
    ScriptGraphs,
    AiScriptGraphs,
    stepScriptGraphs,
    scriptGraphLeaves,
    scriptGraphTouches,
    agentGraphBlackboard,
    type ScriptGraphWorldView,
} from './ScriptGraphPlugin';

export { ensureBuiltinScriptNodes } from './builtinNodes';
