// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Blackboard.ts
 * @brief   Per-agent key/value context + one-shot event triggers.
 *
 * The shared data plane for the AI layer: FSM guards and BT conditions read it,
 * actions write it, game code seeds it. Triggers are edge events (Unity-style):
 * fired once, consumed by the transition that takes them.
 */

import type { CompareOp, BlackboardGuard } from './types';

export class Blackboard {
    private data = new Map<string, unknown>();
    private triggers = new Set<string>();

    get<T = unknown>(key: string): T | undefined {
        return this.data.get(key) as T | undefined;
    }

    set(key: string, value: unknown): void {
        this.data.set(key, value);
    }

    has(key: string): boolean {
        return this.data.has(key);
    }

    delete(key: string): void {
        this.data.delete(key);
    }

    /** Fire a one-shot event; a transition keyed on it becomes enabled until taken. */
    fire(trigger: string): void {
        this.triggers.add(trigger);
    }

    isFired(trigger: string): boolean {
        return this.triggers.has(trigger);
    }

    consume(trigger: string): void {
        this.triggers.delete(trigger);
    }

    /** Drop all pending triggers (e.g. on reset). */
    clearTriggers(): void {
        this.triggers.clear();
    }
}

/** Evaluate one guard against the blackboard. Missing keys compare as undefined. */
export function evalGuard(bb: Blackboard, guard: BlackboardGuard): boolean {
    const actual = bb.get(guard.key);
    switch (guard.op) {
        case '==': return actual === guard.value;
        case '!=': return actual !== guard.value;
        case '<': return num(actual) < num(guard.value);
        case '<=': return num(actual) <= num(guard.value);
        case '>': return num(actual) > num(guard.value);
        case '>=': return num(actual) >= num(guard.value);
        case 'truthy': return !!actual;
        case 'falsy': return !actual;
        default: return assertNever(guard.op);
    }
}

/** True when every guard passes (empty set → vacuously true). */
export function evalGuards(bb: Blackboard, guards: BlackboardGuard | BlackboardGuard[]): boolean {
    if (Array.isArray(guards)) {
        for (const g of guards) if (!evalGuard(bb, g)) return false;
        return true;
    }
    return evalGuard(bb, guards);
}

function num(v: unknown): number {
    return typeof v === 'number' ? v : Number(v);
}

function assertNever(op: CompareOp): never {
    throw new Error(`unknown compare op: ${op}`);
}
