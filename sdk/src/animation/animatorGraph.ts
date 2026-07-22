// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    animatorGraph.ts
 * @brief   Immutable graph operations on an AnimatorControllerDef — the
 *          animation controller editor's model.
 *
 * The structural graph algorithms live in the shared `stateGraph` core; this
 * module binds them to the `.esanimator` shape (`initialState`, required
 * transition lists, `{to, conditions}` transitions) and adds the animator-only
 * ops (motion/props on a state, condition editing, parameters, and the
 * any-state transition rewiring on rename). An `.esanimator` payload IS the
 * runtime AnimatorControllerDef, so there is no separate editor model.
 */

import type {
    AnimatorControllerDef,
    AnimatorState,
    AnimatorTransition,
    AnimatorCondition,
    AnimatorParam,
    AnimatorParamType,
} from './Animator';
import {
    type GraphSpec, type GraphEdge,
    graphEdges, addGraphState, removeGraphState, moveGraphState, renameGraphState,
    setGraphInitial, addGraphTransition, removeGraphTransition, updateGraphTransition,
} from '../stateGraph';

/** A flattened transition edge, for the graph canvas. */
export type AnimatorEdge = GraphEdge<AnimatorTransition>;

const spec: GraphSpec<AnimatorControllerDef, AnimatorState, AnimatorTransition> = {
    states: def => def.states,
    withStates: (def, states) => ({ ...def, states }),
    initial: def => def.initialState,
    withInitial: (def, initialState) => ({ ...def, initialState }),
    transitions: state => state.transitions,
    withTransitions: (state, transitions) => ({ ...state, transitions }),
    makeState: (name, x, y) => ({ name, x, y, transitions: [] }),
    makeTransition: to => ({ to, conditions: [] }),
};

/** Flatten every state's outgoing transitions into addressable edges. */
export function animatorEdges(def: AnimatorControllerDef): AnimatorEdge[] {
    return graphEdges(spec, def);
}

/** A blank controller with one initial state and no parameters. */
export function emptyAnimatorController(): AnimatorControllerDef {
    return { parameters: [], states: [{ name: 'Idle', x: 80, y: 80, transitions: [] }], initialState: 'Idle' };
}

export function addState(def: AnimatorControllerDef, name: string, x = 0, y = 0): AnimatorControllerDef {
    return addGraphState(spec, def, name, x, y);
}

export function removeState(def: AnimatorControllerDef, name: string): AnimatorControllerDef {
    return removeGraphState(spec, def, name);
}

export function moveState(def: AnimatorControllerDef, name: string, x: number, y: number): AnimatorControllerDef {
    return moveGraphState(spec, def, name, x, y);
}

/**
 * Rename a state. On top of the shared rewiring (initial + per-state transition
 * targets) an animator also has any-state transitions to repoint.
 */
export function renameState(def: AnimatorControllerDef, oldName: string, newName: string): AnimatorControllerDef {
    const next = renameGraphState(spec, def, oldName, newName);
    if (next === def || !def.anyStateTransitions) return next;
    return {
        ...next,
        anyStateTransitions: def.anyStateTransitions.map(t => (t.to === oldName ? { ...t, to: newName } : t)),
    };
}

export function setInitial(def: AnimatorControllerDef, name: string): AnimatorControllerDef {
    return setGraphInitial(spec, def, name);
}

/** Set the state's motion to a single sprite clip (clears blend/spine/nested). */
export function setStateClip(def: AnimatorControllerDef, name: string, clip: string): AnimatorControllerDef {
    return {
        ...def,
        states: def.states.map((s) =>
            s.name === name
                ? { name: s.name, x: s.x, y: s.y, transitions: s.transitions, speed: s.speed, loop: s.loop, ...(clip ? { clip } : {}) }
                : s,
        ),
    };
}

export function setStateProps(def: AnimatorControllerDef, name: string, patch: { speed?: number; loop?: boolean }): AnimatorControllerDef {
    return { ...def, states: def.states.map((s) => (s.name === name ? { ...s, ...patch } : s)) };
}

export function addTransition(def: AnimatorControllerDef, from: string, to: string): AnimatorControllerDef {
    return addGraphTransition(spec, def, from, to);
}

export function removeTransition(def: AnimatorControllerDef, from: string, index: number): AnimatorControllerDef {
    return removeGraphTransition(spec, def, from, index);
}

export function updateTransition(
    def: AnimatorControllerDef,
    from: string,
    index: number,
    patch: Partial<AnimatorTransition>,
): AnimatorControllerDef {
    return updateGraphTransition(spec, def, from, index, patch);
}

/** Replace the whole condition list on a transition. */
export function setConditions(def: AnimatorControllerDef, from: string, index: number, conditions: AnimatorCondition[]): AnimatorControllerDef {
    return updateTransition(def, from, index, { conditions });
}

// — Parameters —

export function addParam(def: AnimatorControllerDef, name: string, type: AnimatorParamType): AnimatorControllerDef {
    if (!name || def.parameters.some((p) => p.name === name)) return def;
    return { ...def, parameters: [...def.parameters, { name, type }] };
}

export function removeParam(def: AnimatorControllerDef, name: string): AnimatorControllerDef {
    return { ...def, parameters: def.parameters.filter((p) => p.name !== name) };
}

export function updateParam(def: AnimatorControllerDef, name: string, patch: Partial<AnimatorParam>): AnimatorControllerDef {
    return { ...def, parameters: def.parameters.map((p) => (p.name === name ? { ...p, ...patch } : p)) };
}
