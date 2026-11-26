// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planPool.ts
 * @brief   The one pool of workers the engine's world planning runs on (placements, planet pages), started the first time something asks for it.
 */
import { createJobPool, type JobPool } from './jobs';
import { PLAN_WORKER_SOURCE } from './planWorkerBundle.generated';

let pool: JobPool | null | undefined;

/** The planning pool, or null where this host has no workers (the caller then plans in place). */
export function planPool(): JobPool | null {
    if (pool === undefined) pool = createJobPool(PLAN_WORKER_SOURCE, undefined, { name: 'plan' });
    return pool;
}

/** The plans each worker has been sent, as `worker:key`: a plan is sent to a worker once, with the first question that needs it. */
const sent = new Set<string>();

/** True the first time `key` is asked of `worker` (and remembers it): that question carries the plan. */
export function firstSend(worker: number, key: string): boolean {
    const id = `${worker}:${key}`;
    if (sent.has(id)) return false;
    sent.add(id);
    return true;
}

/** Forgets that a worker was sent `key`, so the next question sends it again. */
export function forgetSent(worker: number, key: string): void {
    sent.delete(`${worker}:${key}`);
}

/** Stops the pool (a test, an app's end); the next ask starts a new one. */
export function disposePlanPool(): void {
    pool?.dispose();
    pool = undefined;
    sent.clear();
}
