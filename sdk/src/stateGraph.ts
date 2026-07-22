// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    stateGraph.ts
 * @brief   Generic immutable ops over a named-state transition graph — the one
 *          core behind fsmGraph.ts and animatorGraph.ts.
 *
 * Both an `.esfsm` and an `.esanimator` are the same shape: a set of named
 * states (each with optional x/y editor layout and outgoing transitions) plus
 * one initial state. Only the field spelling (`initial` vs `initialState`),
 * whether the transition list is optional, and the transition payload differ —
 * and those are supplied per format through a {@link GraphSpec}, so the graph
 * algorithms (add/remove/move/rename state, set-initial, add/remove/update
 * transition, edge flattening) live here once instead of being copied.
 *
 * Every op returns a new definition (never mutating) so the editors drive them
 * through AssetDocument.edit for free undo.
 */

export interface GraphState {
    name: string;
    /** Editor-only canvas position; the interpreter ignores it. */
    x?: number;
    y?: number;
}

export interface GraphTransition {
    to: string;
}

/** A flattened transition edge, for the graph canvas. */
export interface GraphEdge<T extends GraphTransition> {
    /** Stable id `from->to#index`. */
    id: string;
    from: string;
    to: string;
    /** Index of this transition within `from`'s transition list. */
    index: number;
    transition: T;
}

/** Per-format adapter: how to read and rebuild a graph's states, initial, and transitions. */
export interface GraphSpec<TDef, TState extends GraphState, TTransition extends GraphTransition> {
    states(def: TDef): TState[];
    withStates(def: TDef, states: TState[]): TDef;
    initial(def: TDef): string;
    withInitial(def: TDef, name: string): TDef;
    /** Read a state's outgoing transitions (normalizing an optional list to `[]`). */
    transitions(state: TState): TTransition[];
    withTransitions(state: TState, transitions: TTransition[]): TState;
    makeState(name: string, x: number, y: number): TState;
    makeTransition(to: string): TTransition;
}

export function graphEdges<D, S extends GraphState, T extends GraphTransition>(
    spec: GraphSpec<D, S, T>,
    def: D,
): GraphEdge<T>[] {
    const edges: GraphEdge<T>[] = [];
    for (const s of spec.states(def)) {
        spec.transitions(s).forEach((transition, index) => {
            edges.push({ id: `${s.name}->${transition.to}#${index}`, from: s.name, to: transition.to, index, transition });
        });
    }
    return edges;
}

export function addGraphState<D, S extends GraphState, T extends GraphTransition>(
    spec: GraphSpec<D, S, T>,
    def: D,
    name: string,
    x = 0,
    y = 0,
): D {
    const states = spec.states(def);
    if (states.some(s => s.name === name)) return def;
    const next = spec.withStates(def, [...states, spec.makeState(name, x, y)]);
    // The first state added to an empty graph becomes the initial one.
    return states.length === 0 ? spec.withInitial(next, name) : next;
}

export function removeGraphState<D, S extends GraphState, T extends GraphTransition>(
    spec: GraphSpec<D, S, T>,
    def: D,
    name: string,
): D {
    const kept = spec.states(def)
        .filter(s => s.name !== name)
        .map(s => (spec.transitions(s).some(t => t.to === name)
            ? spec.withTransitions(s, spec.transitions(s).filter(t => t.to !== name))
            : s));
    const next = spec.withStates(def, kept);
    return spec.initial(def) === name ? spec.withInitial(next, kept[0]?.name ?? '') : next;
}

export function moveGraphState<D, S extends GraphState, T extends GraphTransition>(
    spec: GraphSpec<D, S, T>,
    def: D,
    name: string,
    x: number,
    y: number,
): D {
    return spec.withStates(def, spec.states(def).map(s => (s.name === name ? { ...s, x, y } : s)));
}

/** Rename a state, rewiring `initial` and every state transition that targets it. */
export function renameGraphState<D, S extends GraphState, T extends GraphTransition>(
    spec: GraphSpec<D, S, T>,
    def: D,
    oldName: string,
    newName: string,
): D {
    if (oldName === newName || !newName) return def;
    const states = spec.states(def);
    if (states.some(s => s.name === newName)) return def;
    const renamed = states.map(s => {
        const ns = s.name === oldName ? { ...s, name: newName } : s;
        return spec.transitions(ns).some(t => t.to === oldName)
            ? spec.withTransitions(ns, spec.transitions(ns).map(t => (t.to === oldName ? { ...t, to: newName } : t)))
            : ns;
    });
    const next = spec.withStates(def, renamed);
    return spec.initial(def) === oldName ? spec.withInitial(next, newName) : next;
}

export function setGraphInitial<D, S extends GraphState, T extends GraphTransition>(
    spec: GraphSpec<D, S, T>,
    def: D,
    name: string,
): D {
    return spec.states(def).some(s => s.name === name) ? spec.withInitial(def, name) : def;
}

export function addGraphTransition<D, S extends GraphState, T extends GraphTransition>(
    spec: GraphSpec<D, S, T>,
    def: D,
    from: string,
    to: string,
): D {
    return spec.withStates(def, spec.states(def).map(s => (s.name === from
        ? spec.withTransitions(s, [...spec.transitions(s), spec.makeTransition(to)])
        : s)));
}

export function removeGraphTransition<D, S extends GraphState, T extends GraphTransition>(
    spec: GraphSpec<D, S, T>,
    def: D,
    from: string,
    index: number,
): D {
    return spec.withStates(def, spec.states(def).map(s => (s.name === from
        ? spec.withTransitions(s, spec.transitions(s).filter((_, i) => i !== index))
        : s)));
}

export function updateGraphTransition<D, S extends GraphState, T extends GraphTransition>(
    spec: GraphSpec<D, S, T>,
    def: D,
    from: string,
    index: number,
    patch: Partial<T>,
): D {
    return spec.withStates(def, spec.states(def).map(s => (s.name === from
        ? spec.withTransitions(s, spec.transitions(s).map((t, i) => (i === index ? { ...t, ...patch } : t)))
        : s)));
}
