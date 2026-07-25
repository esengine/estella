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

import type { AiParamValue } from './registry';

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

/**
 * A hook/leaf action reference: a bare registry name, or a name plus its input.
 * The input is either the canonical string (`spriteAnim.play` with a clip ref)
 * or the action's declared parameters by name — the two are projections of each
 * other, so a ref written either way runs the same (see registry.ts).
 */
export type FsmActionRef = string | { name: string; arg?: string; params?: Record<string, AiParamValue> };

/** Registry name of an action ref ('' for none). */
export function actionRefName(ref: FsmActionRef | undefined): string {
    return typeof ref === 'string' ? ref : ref?.name ?? '';
}

/** Argument of an action ref, if any. */
export function actionRefArg(ref: FsmActionRef | undefined): string | undefined {
    return typeof ref === 'object' && ref !== null ? ref.arg : undefined;
}

/** Declared parameters of an action ref, if it was authored with them. */
export function actionRefParams(ref: FsmActionRef | undefined): Record<string, AiParamValue> | undefined {
    return typeof ref === 'object' && ref !== null ? ref.params : undefined;
}

export interface FsmState {
    name: string;
    /** Named action run once when the state becomes active. */
    onEnter?: FsmActionRef;
    /** Named action run every tick the state is active (and no transition fired). */
    onUpdate?: FsmActionRef;
    /** Named action run once when the state is left. */
    onExit?: FsmActionRef;
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
