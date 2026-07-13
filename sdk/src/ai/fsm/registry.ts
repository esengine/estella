// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    registry.ts
 * @brief   AiRegistry — names → leaf action/condition functions.
 *
 * The binding between code-free AI data (`.esfsm`/`.esbt` referencing names) and
 * real gameplay logic. Generic over the context type `Ctx` so the pure core
 * stays wasm-free; the engine layer instantiates it with a concrete AiContext
 * (a BehaviorContext superset) and exposes the `registerAction`/`registerCondition`
 * free functions over a shared singleton.
 */

import type { Blackboard } from './Blackboard';
import type { Status } from '../status';

// Returns Status (a BT leaf that may run across frames) or nothing (a one-shot
// FSM action). FSM ignores the return; BT reads it, treating void as Success.
// `arg` is the optional per-reference string the authored data carries
// (FsmActionRef / BtNode.arg); argument-free actions simply ignore it.
export type AiAction<Ctx> = (ctx: Ctx, bb: Blackboard, arg?: string) => void | Status;
export type AiCondition<Ctx> = (ctx: Ctx, bb: Blackboard) => boolean;

export class AiRegistry<Ctx = unknown> {
    private actions = new Map<string, AiAction<Ctx>>();
    private conditions = new Map<string, AiCondition<Ctx>>();

    registerAction(name: string, fn: AiAction<Ctx>): void {
        this.actions.set(name, fn);
    }

    registerCondition(name: string, fn: AiCondition<Ctx>): void {
        this.conditions.set(name, fn);
    }

    getAction(name: string): AiAction<Ctx> | undefined {
        return this.actions.get(name);
    }

    getCondition(name: string): AiCondition<Ctx> | undefined {
        return this.conditions.get(name);
    }

    hasAction(name: string): boolean {
        return this.actions.has(name);
    }

    hasCondition(name: string): boolean {
        return this.conditions.has(name);
    }

    /** Registered action/condition names, for editor palettes. */
    actionNames(): string[] {
        return [...this.actions.keys()];
    }

    conditionNames(): string[] {
        return [...this.conditions.keys()];
    }

    /** Drop all registrations (tests / hot-reload). */
    clear(): void {
        this.actions.clear();
        this.conditions.clear();
    }
}
