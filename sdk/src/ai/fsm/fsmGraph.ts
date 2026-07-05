// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fsmGraph.ts
 * @brief   Immutable graph operations on an FsmDefinition — the editor's model.
 *
 * Pure functions returning new definitions (never mutating), so the transition-
 * graph editor drives them through AssetDocument.edit for free undo, mirroring
 * how the material editor calls the SDK's materialGraph ops. Since a `.esfsm`
 * IS the runtime definition (states carry optional x/y layout the interpreter
 * ignores), there is no separate editor model to compile.
 */

import type { FsmDefinition, FsmState, FsmTransition } from './types';

/** A flattened transition edge, for the graph canvas. */
export interface FsmEdge {
    /** Stable id `from->to#index`. */
    id: string;
    from: string;
    to: string;
    /** Index of this transition within `from`'s transition list. */
    index: number;
    transition: FsmTransition;
}

/** Flatten every state's outgoing transitions into addressable edges. */
export function fsmEdges(def: FsmDefinition): FsmEdge[] {
    const edges: FsmEdge[] = [];
    for (const s of def.states) {
        (s.transitions ?? []).forEach((transition, index) => {
            edges.push({ id: `${s.name}->${transition.to}#${index}`, from: s.name, to: transition.to, index, transition });
        });
    }
    return edges;
}

/** A blank machine with one initial state. */
export function emptyFsm(): FsmDefinition {
    return { initial: 'Idle', states: [{ name: 'Idle', x: 80, y: 80 }] };
}

export function addState(def: FsmDefinition, name: string, x = 0, y = 0): FsmDefinition {
    if (def.states.some(s => s.name === name)) return def;
    const state: FsmState = { name, x, y };
    return {
        ...def,
        states: [...def.states, state],
        // The first state added to an empty machine becomes the initial one.
        initial: def.states.length === 0 ? name : def.initial,
    };
}

export function removeState(def: FsmDefinition, name: string): FsmDefinition {
    const states = def.states
        .filter(s => s.name !== name)
        .map(s => (s.transitions?.some(t => t.to === name)
            ? { ...s, transitions: s.transitions.filter(t => t.to !== name) }
            : s));
    const initial = def.initial === name ? (states[0]?.name ?? '') : def.initial;
    return { ...def, states, initial };
}

export function moveState(def: FsmDefinition, name: string, x: number, y: number): FsmDefinition {
    return { ...def, states: def.states.map(s => (s.name === name ? { ...s, x, y } : s)) };
}

/** Rename a state, rewiring `initial` and every transition that targets it. */
export function renameState(def: FsmDefinition, oldName: string, newName: string): FsmDefinition {
    if (oldName === newName || !newName) return def;
    if (def.states.some(s => s.name === newName)) return def;
    const states = def.states.map(s => {
        let ns = s.name === oldName ? { ...s, name: newName } : s;
        if (ns.transitions?.some(t => t.to === oldName)) {
            ns = { ...ns, transitions: ns.transitions.map(t => (t.to === oldName ? { ...t, to: newName } : t)) };
        }
        return ns;
    });
    return { ...def, states, initial: def.initial === oldName ? newName : def.initial };
}

export function setStateHook(
    def: FsmDefinition,
    name: string,
    hook: 'onEnter' | 'onUpdate' | 'onExit',
    action: string,
): FsmDefinition {
    return {
        ...def,
        states: def.states.map(s => (s.name === name ? { ...s, [hook]: action || undefined } : s)),
    };
}

export function setInitial(def: FsmDefinition, name: string): FsmDefinition {
    return def.states.some(s => s.name === name) ? { ...def, initial: name } : def;
}

export function addTransition(def: FsmDefinition, from: string, to: string): FsmDefinition {
    return {
        ...def,
        states: def.states.map(s => (s.name === from
            ? { ...s, transitions: [...(s.transitions ?? []), { to }] }
            : s)),
    };
}

export function removeTransition(def: FsmDefinition, from: string, index: number): FsmDefinition {
    return {
        ...def,
        states: def.states.map(s => (s.name === from && s.transitions
            ? { ...s, transitions: s.transitions.filter((_, i) => i !== index) }
            : s)),
    };
}

export function updateTransition(
    def: FsmDefinition,
    from: string,
    index: number,
    patch: Partial<FsmTransition>,
): FsmDefinition {
    return {
        ...def,
        states: def.states.map(s => (s.name === from && s.transitions
            ? { ...s, transitions: s.transitions.map((t, i) => (i === index ? { ...t, ...patch } : t)) }
            : s)),
    };
}
