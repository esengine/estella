// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** Use whole worker slots, with a serial fallback for invalid limits. */
export function normalizeConcurrency(limit: number): number {
    const slots = Math.floor(limit);
    return slots >= 1 ? slots : 1;
}

type Task = () => Promise<void>;
interface GatedTasks {
    ready: Promise<void>;
    tasks: readonly Task[];
}

/**
 * Start lazy tasks with at most `maxConcurrent` in flight. Report each completion
 * while the batch is running. Gated tasks become eligible together when ready.
 * On error, wait for active tasks before rejecting.
 */
export async function runWithConcurrency(
    tasks: readonly Task[],
    maxConcurrent: number,
    onEach?: () => void,
    gated: readonly GatedTasks[] = [],
): Promise<void> {
    const total = gated.reduce((count, batch) => count + batch.tasks.length, tasks.length);
    if (!total) return;
    const queued = gated.length ? [...tasks] : undefined;
    let cursor = 0;
    let remaining = gated.length;
    const workers: Promise<void>[] = [];
    let failure: { error: unknown } | undefined;
    let available: Promise<void> | undefined;
    let resume: (() => void) | undefined;
    const wake = (): void => {
        resume?.();
        available = undefined;
        resume = undefined;
    };
    const fail = (error: unknown): void => {
        failure ??= { error };
        wake();
    };
    for (const batch of gated) {
        void batch.ready.then(() => {
            if (failure) return;
            for (const task of batch.tasks) queued!.push(task);
            remaining--;
            wake();
        }, fail);
    }
    const queue = queued ?? tasks;
    const worker = async (): Promise<void> => {
        try {
            while (!failure) {
                if (cursor >= queue.length) {
                    if (!remaining) return;
                    await (available ??= new Promise(resolve => { resume = resolve; }));
                    continue;
                }
                const task = queue[cursor++]!;
                try { await task(); }
                finally { if (!failure) onEach?.(); }
            }
        } catch (error) {
            fail(error);
        }
    };
    const slots = Math.min(normalizeConcurrency(maxConcurrent), total);
    for (let i = 0; i < slots; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
    if (failure) throw failure.error;
}
