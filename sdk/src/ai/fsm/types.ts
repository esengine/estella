// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    types.ts
 * @brief   State-machine data model — the serializable shape of a `.esfsm`.
 *
 * A definition is pure data: states carry named action hooks, transitions carry
 * their enabling conditions (event trigger, named condition, and/or blackboard
 * guards). Leaf logic (the action/condition names) is resolved at runtime via
 * the AiRegistry, so the data never embeds code — matching how `.esbt` and the
 * input maps stay code-free.
 */

export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'truthy' | 'falsy';

/** A single blackboard comparison. `value` is unused for truthy/falsy. */
export interface BlackboardGuard {
    key: string;
    op: CompareOp;
    value?: number | string | boolean;
}

/**
 * A directed edge to `to`. Enabled when ALL of its specified mechanisms hold:
 * the `trigger` event is pending, the named `condition` returns true, and every
 * `guard` compares true. A transition with none of them is unconditional.
 */
export interface FsmTransition {
    to: string;
    /** Event name (Unity-style trigger) that must be fired; consumed when taken. */
    trigger?: string;
    /** Named condition resolved from the registry. */
    condition?: string;
    /** Blackboard comparison(s), AND-combined. */
    guard?: BlackboardGuard | BlackboardGuard[];
}

export interface FsmState {
    name: string;
    /** Named action run once when the state becomes active. */
    onEnter?: string;
    /** Named action run every tick the state is active (and no transition fired). */
    onUpdate?: string;
    /** Named action run once when the state is left. */
    onExit?: string;
    /** Outgoing edges, evaluated in order; the first enabled one is taken. */
    transitions?: FsmTransition[];
    /** Editor-only canvas position; ignored by the interpreter. */
    x?: number;
    y?: number;
}

export interface FsmDefinition {
    /** Name of the state entered on start. */
    initial: string;
    states: FsmState[];
}
