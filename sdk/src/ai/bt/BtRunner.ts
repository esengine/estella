// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BtRunner.ts
 * @brief   The behavior-tree interpreter — pure, generic, unit-testable.
 *
 * One `tickBt` per frame walks the tree; each node returns a {@link Status}.
 * Composites are reactive (UE-style): each tick re-evaluates children from the
 * start, so a higher-priority branch whose condition just became true preempts a
 * lower-priority branch that was Running. Only decorators with intrinsic timing
 * (`wait`/`repeater`) keep per-node state, keyed by node path ("0.1.2"). `dt` is
 * passed explicitly (only `wait` uses it) so the core stays free of any
 * engine/context type.
 */

import type { Blackboard } from '../fsm/Blackboard';
import type { AiRegistry } from '../fsm/registry';
import { Status } from '../status';
import type { BtDefinition, BtNode } from './types';

interface NodeState {
    /** Repeater: completed iterations. */
    n?: number;
    /** Wait: elapsed seconds. */
    elapsed?: number;
}

export type BtRunState = Map<string, NodeState>;

export function createBtRunState(): BtRunState {
    return new Map();
}

/** Advance the tree one tick, returning the root's status. */
export function tickBt<Ctx>(
    def: BtDefinition,
    ctx: Ctx,
    bb: Blackboard,
    registry: AiRegistry<Ctx>,
    rs: BtRunState,
    dt: number,
): Status {
    return tickNode(def.root, '0', ctx, bb, registry, rs, dt);
}

function tickNode<Ctx>(
    node: BtNode, path: string, ctx: Ctx, bb: Blackboard,
    registry: AiRegistry<Ctx>, rs: BtRunState, dt: number,
): Status {
    switch (node.type) {
        case 'action': {
            const fn = registry.getAction(node.name ?? '');
            if (!fn) return Status.Failure;
            const r = fn(ctx, bb, node.arg);
            // A void-returning (one-shot FSM-style) action completes as Success.
            return r === undefined ? Status.Success : r;
        }
        case 'condition': {
            const fn = registry.getCondition(node.name ?? '');
            return fn && fn(ctx, bb) ? Status.Success : Status.Failure;
        }
        case 'inverter': {
            const s = tickOnly(node, path, ctx, bb, registry, rs, dt);
            if (s === Status.Running) return s;
            return s === Status.Success ? Status.Failure : Status.Success;
        }
        case 'succeeder': {
            const s = tickOnly(node, path, ctx, bb, registry, rs, dt);
            return s === Status.Running ? Status.Running : Status.Success;
        }
        case 'repeater': {
            const s = tickOnly(node, path, ctx, bb, registry, rs, dt);
            if (s === Status.Running) return Status.Running;
            // Child finished (success or failure) = one iteration.
            const st = rs.get(path) ?? {};
            st.n = (st.n ?? 0) + 1;
            rs.set(path, st);
            const count = node.count ?? 0;
            if (count > 0 && st.n >= count) {
                rs.delete(path);
                return Status.Success;
            }
            return Status.Running; // repeat next tick
        }
        case 'wait': {
            const st = rs.get(path) ?? {};
            st.elapsed = (st.elapsed ?? 0) + dt;
            rs.set(path, st);
            if (st.elapsed >= (node.seconds ?? 0)) {
                rs.delete(path);
                return Status.Success;
            }
            return Status.Running;
        }
        case 'sequence':
            return tickCompound(node, path, ctx, bb, registry, rs, dt, false);
        case 'selector':
            return tickCompound(node, path, ctx, bb, registry, rs, dt, true);
        case 'parallel':
            return tickParallel(node, path, ctx, bb, registry, rs, dt);
        default:
            return Status.Failure;
    }
}

/** A decorator's single child. */
function tickOnly<Ctx>(
    node: BtNode, path: string, ctx: Ctx, bb: Blackboard,
    registry: AiRegistry<Ctx>, rs: BtRunState, dt: number,
): Status {
    const child = node.children?.[0];
    if (!child) return Status.Failure;
    return tickNode(child, `${path}.0`, ctx, bb, registry, rs, dt);
}

/**
 * Sequence (isSelector=false): run children in order; a child Failure fails the
 * whole node, all-Success succeeds. Selector (isSelector=true) is the dual: a
 * child Success succeeds, all-Failure fails. Reactive: re-evaluated from the
 * first child each tick, so a higher-priority child that starts succeeding
 * preempts a lower-priority one that was Running.
 */
function tickCompound<Ctx>(
    node: BtNode, path: string, ctx: Ctx, bb: Blackboard,
    registry: AiRegistry<Ctx>, rs: BtRunState, dt: number, isSelector: boolean,
): Status {
    const children = node.children ?? [];
    const stopStatus = isSelector ? Status.Success : Status.Failure;
    for (let i = 0; i < children.length; i++) {
        const s = tickNode(children[i], `${path}.${i}`, ctx, bb, registry, rs, dt);
        if (s === Status.Running) return Status.Running;
        if (s === stopStatus) return stopStatus;
        // otherwise advance to the next child
    }
    return isSelector ? Status.Failure : Status.Success;
}

/** Tick all children each frame; resolve by the success policy. */
function tickParallel<Ctx>(
    node: BtNode, path: string, ctx: Ctx, bb: Blackboard,
    registry: AiRegistry<Ctx>, rs: BtRunState, dt: number,
): Status {
    const children = node.children ?? [];
    let successes = 0;
    let failures = 0;
    for (let i = 0; i < children.length; i++) {
        const s = tickNode(children[i], `${path}.${i}`, ctx, bb, registry, rs, dt);
        if (s === Status.Success) successes++;
        else if (s === Status.Failure) failures++;
    }
    if ((node.policy ?? 'all') === 'one') {
        if (successes > 0) return Status.Success;
        if (failures === children.length) return Status.Failure;
    } else {
        if (failures > 0) return Status.Failure;
        if (successes === children.length) return Status.Success;
    }
    return Status.Running;
}
