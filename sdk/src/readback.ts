// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    readback.ts
 * @brief   Polling loop for the engine's async GPU readback seam.
 *
 * The engine exposes readbacks as a poll contract (0 = pending, 1 = ready,
 * 2 = none/failed): GL completes at request time so the first poll reports 1,
 * while WebGPU resolves its staging-buffer map on a later event-loop turn —
 * the loop below yields a macrotask between polls so that turn can happen.
 * One awaited loop serves both backends.
 */

/** Poll result: the readback landed and the engine buffers serve the pixels. */
export const READBACK_READY = 1;
/** Poll result: no readback in flight, or it failed. */
export const READBACK_FAILED = 2;

/**
 * Awaits an engine readback poll until it reports ready (1) or failed (2),
 * yielding a macrotask between pending polls. Returns the terminal status;
 * a readback still pending after @p maxPolls resolves as failed.
 */
export async function awaitReadback(
    poll: () => number,
    maxPolls = 240,
): Promise<number> {
    for (let i = 0; i < maxPolls; i++) {
        const status = poll();
        if (status !== 0) return status;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return READBACK_FAILED;
}
