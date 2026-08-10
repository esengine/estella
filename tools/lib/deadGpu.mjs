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

/**
 * Run `attempt` and, if the GPU never came up, run it once more.
 *
 * `attempt` returns `{ ok, output }`. The retry is announced through `note` —
 * a measurement taken twice has to say so, or a flaky runner reads as a stable
 * one.
 */
export function retryOnDeadGpu(attempt, note) {
    const first = attempt();
    if (first.ok || !gpuNeverCameUp(first.output)) return { ...first, retried: false };
    note();
    return { ...attempt(), retried: true };
}
