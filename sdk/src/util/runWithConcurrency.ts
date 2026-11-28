// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** Use whole worker slots, with a serial fallback for invalid limits. */
export function normalizeConcurrency(limit: number): number {
    const slots = Math.floor(limit);
    return slots >= 1 ? slots : 1;
}

/**
 * Start lazy tasks with at most `maxConcurrent` in flight. Report each completion
 * while the batch is running. On error, wait for active tasks before rejecting.
 */
export async function runWithConcurrency(
    tasks: ReadonlyArray<() => Promise<void>>,
    maxConcurrent: number,
    onEach?: () => void,
): Promise<void> {
    if (tasks.length === 0) return;
    let cursor = 0;
    const workers: Promise<void>[] = [];
    let failure: { error: unknown } | undefined;
    const worker = async (): Promise<void> => {
        try {
            while (cursor < tasks.length) {
                const task = tasks[cursor++]!;
                try { await task(); }
                finally { if (!failure) onEach?.(); }
            }
        } catch (error) {
            failure ??= { error };
            cursor = tasks.length;
        }
    };
    const slots = Math.min(normalizeConcurrency(maxConcurrent), tasks.length);
    for (let i = 0; i < slots; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
    if (failure) throw failure.error;
}
