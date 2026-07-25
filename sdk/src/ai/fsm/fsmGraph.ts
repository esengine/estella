// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fsmGraph.ts
 * @brief   Immutable graph operations on an FsmDefinition — the editor's model.
 *
 * The structural graph algorithms live in the shared `stateGraph` core; this
 * module binds them to the `.esfsm` shape (`initial`, optional transition lists,
 * bare `{to}` transitions) and adds the FSM-only state-hook op. A `.esfsm` IS
 * the runtime definition (states carry optional x/y layout the interpreter
 * ignores), so there is no separate editor model to compile.
 */

import type { FsmActionRef, FsmDefinition, FsmState, FsmTransition } from './types';
import type { AiParamValue } from './registry';
import {
    type GraphSpec, type GraphEdge,
    graphEdges, addGraphState, removeGraphState, moveGraphState, renameGraphState,
    setGraphInitial, addGraphTransition, removeGraphTransition, updateGraphTransition,
} from '../../stateGraph';

/** A flattened transition edge, for the graph canvas. */
export type FsmEdge = GraphEdge<FsmTransition>;

const spec: GraphSpec<FsmDefinition, FsmState, FsmTransition> = {
    states: def => def.states,
    withStates: (def, states) => ({ ...def, states }),
    initial: def => def.initial,
    withInitial: (def, initial) => ({ ...def, initial }),
    transitions: state => state.transitions ?? [],
    withTransitions: (state, transitions) => ({ ...state, transitions }),
    makeState: (name, x, y) => ({ name, x, y }),
    makeTransition: to => ({ to }),
};

/** Flatten every state's outgoing transitions into addressable edges. */
export function fsmEdges(def: FsmDefinition): FsmEdge[] {
    return graphEdges(spec, def);
}

/** A blank machine with one initial state. */
export function emptyFsm(): FsmDefinition {
    return { initial: 'Idle', states: [{ name: 'Idle', x: 80, y: 80 }] };
}

export function addState(def: FsmDefinition, name: string, x = 0, y = 0): FsmDefinition {
    return addGraphState(spec, def, name, x, y);
}

export function removeState(def: FsmDefinition, name: string): FsmDefinition {
    return removeGraphState(spec, def, name);
}

export function moveState(def: FsmDefinition, name: string, x: number, y: number): FsmDefinition {
    return moveGraphState(spec, def, name, x, y);
}

export function renameState(def: FsmDefinition, oldName: string, newName: string): FsmDefinition {
    return renameGraphState(spec, def, oldName, newName);
}

export function setInitial(def: FsmDefinition, name: string): FsmDefinition {
    return setGraphInitial(spec, def, name);
}

export function addTransition(def: FsmDefinition, from: string, to: string): FsmDefinition {
    return addGraphTransition(spec, def, from, to);
}

export function removeTransition(def: FsmDefinition, from: string, index: number): FsmDefinition {
    return removeGraphTransition(spec, def, from, index);
}

export function updateTransition(
    def: FsmDefinition,
    from: string,
    index: number,
    patch: Partial<FsmTransition>,
): FsmDefinition {
    return updateGraphTransition(spec, def, from, index, patch);
}

/**
 * Point a state hook at an action, with its input in either form: the canonical
 * string (`arg`) or the action's declared parameters. A bare name stays a bare
 * string in the data — the shorthand most hooks use — and clearing the name
 * clears the hook.
 */
export function setStateHook(
    def: FsmDefinition,
    name: string,
    hook: 'onEnter' | 'onUpdate' | 'onExit',
    action: string,
    arg?: string,
    params?: Record<string, AiParamValue>,
): FsmDefinition {
    const hasParams = params !== undefined && Object.keys(params).length > 0;
    const ref: FsmActionRef | undefined = action
        ? (hasParams ? { name: action, params } : arg ? { name: action, arg } : action)
        : undefined;
    return {
        ...def,
        states: def.states.map(s => (s.name === name ? { ...s, [hook]: ref } : s)),
    };
}
