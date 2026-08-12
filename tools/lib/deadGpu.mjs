// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  deadGpu.mjs — telling "the GPU never came up" from "the game is wrong".
 *
 * A runner whose GPU process dies during init leaves a context-lost renderer
 * that cannot draw anything. That is not a verdict about the game: reporting it
 * as one says the frame was wrong when there was no frame. Observed on the FIRST
 * electron launch of a job, in run after run.
 *
 * One definition, because both pixel runners launch electron on the same runners
 * and a second copy would drift — verify-render had this and verify-golden did
 * not, so the same minute-old GPU failure was a retry in one and a red game in
 * the other.
 */

/** Did the renderer never get a GPU, whatever it then said about pixels? */
export function gpuNeverCameUp(output) {
    return /Exiting GPU process due to errors during initialization/.test(output)
        || (/GPU device lost/.test(output) && /Failed to create framebuffer/.test(output))
        || /WebGL2 is not available/.test(output);
}

/** Attempts one measurement is allowed, counting the first. */
const MAX_ATTEMPTS = 3;

/**
 * Run `attempt` (→ `{ ok, output }`) until it succeeds or fails with the GPU up.
 *
 * A failure ANYWHERE after a death in this chain is inconclusive: a restarted GPU
 * process leaves the next launch context-lost, painting a blank frame and printing
 * nothing about why. A game that truly draws nothing still fails on the first
 * attempt, since no attempt reports a death. `note(died)` announces each retry.
 */
export function retryOnDeadGpu(attempt, note) {
    let sawDeath = false;
    let last;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
        last = attempt();
        if (last.ok) return { ...last, retried: i > 0 };
        const died = gpuNeverCameUp(last.output);
        sawDeath = sawDeath || died;
        // Nothing in this chain blamed the GPU, so the failure is the game's.
        if (!sawDeath) return { ...last, retried: i > 0 };
        if (i < MAX_ATTEMPTS - 1) note(died);
    }
    return { ...last, retried: true, gpuDied: true };
}
