// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FsmRunner.ts
 * @brief   The state-machine interpreter — pure, generic, unit-testable.
 *
 * `compileFsm` indexes a definition once (per loaded asset); `stepFsm` advances
 * one runtime instance one tick. Semantics: at most one transition per tick;
 * `onEnter` runs the tick a state becomes active, `onExit` when it is left,
 * `onUpdate` on ticks where no transition fires.
 */

import { actionRefName, actionRefArg, actionRefParams, type FsmActionRef, type FsmDefinition, type FsmState, type FsmTransition } from './types';
import { Blackboard, evalGuards } from './Blackboard';
import { invokeAction, type AiRegistry } from './registry';

/** A definition indexed by state name for O(1) lookup during ticks. */
export interface CompiledFsm {
    initial: string;
    states: Map<string, FsmState>;
}

export function compileFsm(def: FsmDefinition): CompiledFsm {
    const states = new Map<string, FsmState>();
    for (const s of def.states) states.set(s.name, s);
    return { initial: def.initial, states };
}

/** Mutable per-instance runtime state. `entered` gates the one-shot `onEnter`. */
export interface FsmRunState {
    current: string;
    previous: string | null;
    entered: boolean;
}

export function createFsmRunState(fsm: CompiledFsm): FsmRunState {
    return { current: fsm.initial, previous: null, entered: false };
}

/**
 * Advance one tick. Returns true if a transition was taken. The new state's
 * `onEnter` runs on the following tick (via `entered=false`), so a pass-through
 * state cleanly enters-then-exits across two ticks rather than looping.
 */
export function stepFsm<Ctx>(
    fsm: CompiledFsm,
    run: FsmRunState,
    ctx: Ctx,
    bb: Blackboard,
    registry: AiRegistry<Ctx>,
): boolean {
    const cur = fsm.states.get(run.current);
    if (!cur) return false;

    if (!run.entered) {
        runAction(registry, cur.onEnter, ctx, bb);
        run.entered = true;
    }

    for (const t of cur.transitions ?? []) {
        if (transitionEnabled(t, ctx, bb, registry)) {
            if (t.trigger) bb.consume(t.trigger);
            runAction(registry, cur.onExit, ctx, bb);
            run.previous = run.current;
            run.current = t.to;
            run.entered = false;
            return true;
        }
    }

    runAction(registry, cur.onUpdate, ctx, bb);
    return false;
}

function transitionEnabled<Ctx>(
    t: FsmTransition,
    ctx: Ctx,
    bb: Blackboard,
    registry: AiRegistry<Ctx>,
): boolean {
    if (t.trigger && !bb.isFired(t.trigger)) return false;
    if (t.condition) {
        const cond = registry.getCondition(t.condition);
        if (!cond || !cond(ctx, bb)) return false;
    }
    if (t.guard && !evalGuards(bb, t.guard)) return false;
    return true;
}

function runAction<Ctx>(
    registry: AiRegistry<Ctx>,
    ref: FsmActionRef | undefined,
    ctx: Ctx,
    bb: Blackboard,
): void {
    const name = actionRefName(ref);
    if (!name) return;
    invokeAction(registry, name, ctx, bb, { arg: actionRefArg(ref), params: actionRefParams(ref) });
}
