// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    readback.ts
 * @brief   Polling loop for the engine's async GPU readback seam.
 *
 * The engine exposes readbacks as a poll contract (0 = pending, 1 = ready,
 * 2 = none/failed). Neither backend waits for the GPU when asked: WebGL2 reads
 * into a buffer behind a fence that passes once the frame is drawn, and WebGPU
 * maps a staging buffer — both answer on a later event-loop turn, so the loop
 * below yields a macrotask between polls. (A native GL host reads at once and
 * reports 1 on the first poll.) One awaited loop serves every backend.
 */

/** Poll result: the readback landed and the engine buffers serve the pixels. */
export const READBACK_READY = 1;
/** Poll result: no readback in flight, or it failed. */
export const READBACK_FAILED = 2;

/**
 * Awaits an engine readback poll until it reports ready (1) or failed (2),
 * yielding a macrotask between pending polls. Returns the terminal status.
 *
 * @param timeoutMs A backstop, not a schedule: the copy is already submitted, so
 *   what keeps it from landing is a device that died — which the poll reports as
 *   failed on its own — or a queue that has not drained. A WebGL2 read waits behind every frame queued before it, as a
 *   blocking glReadPixels did with no limit: a CPU rasterizer with a heavy scene's frames behind it took past 15 s.
 */
export async function awaitReadback(
    poll: () => number,
    timeoutMs = 120_000,
): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const status = poll();
        if (status !== 0) return status;
        if (Date.now() >= deadline) return READBACK_FAILED;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
}
