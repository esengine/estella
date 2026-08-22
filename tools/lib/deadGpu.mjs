// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  deadGpu.mjs — telling "the GPU never came up" from "the subject is wrong".
 *
 * A runner whose GPU process dies during init leaves a context-lost renderer that
 * cannot draw anything. That is not a verdict about the subject: reporting it as
 * one says the frame was wrong when there was no frame.
 *
 * The question is whether a MEASUREMENT HAPPENED, and the run itself is the only
 * honest answer to that — `measured` below. Log text is not: this repo's Linux
 * runner prints "Exiting GPU process due to errors during initialization" on runs
 * that go on to succeed, so a policy keyed on that string reads every failure as
 * a dead GPU, retries all six times, and buries the real reason. One job spent
 * fourteen minutes and 71 retries that way, and the scene that actually broke was
 * never named.
 *
 * One definition, because both pixel runners launch electron on the same runners
 * and a second copy would drift — verify-render had this and verify-golden did
 * not, so the same minute-old GPU failure was a retry in one and a red game in
 * the other.
 */

/**
 * Log-text evidence that a runner never got a GPU. UNRELIABLE ALONE — see the
 * file header — so this is the fallback for an attempt that cannot say whether it
 * reached a verdict, never the primary answer.
 */
export function gpuNeverCameUp(output) {
    return /Exiting GPU process due to errors during initialization/.test(output)
        // A lost device, then resources it can no longer make — textures as well as
        // framebuffers. The runner's outage said "Failed to create texture from
        // spec", which only the line above caught, and that one fires on every launch.
        || (/GPU device lost/.test(output)
            && /Failed to create (framebuffer|texture)|createTexture failed/.test(output))
        || /WebGL2 is not available/.test(output);
}

/**
 * What to report when a measurement never happened because the GPU never came up.
 * Shared for the same reason the detection is: the two runners described the same
 * failure differently, and one of them described it as the game's fault.
 */
export function deadGpuVerdict(subject) {
    return `the GPU process never came up, on every attempt — this says nothing about ${subject}`;
}

/** Attempts one measurement is allowed, counting the first. Six, not four: four
 *  was measured when the first project needed three retries to draw, and a tier
 *  with one more pair in it spent them all on a game that was fine. */
const MAX_ATTEMPTS = 6;

/**
 * Wait before relaunching, growing with each try. The retries were immediate,
 * which relaunches into a GPU process still on its way down — three attempts
 * inside a second are one attempt with extra steps. Synchronous because the
 * launches are; `stepMs` is 0 in tests, which have no process to wait for.
 */
function backoff(attempt, stepMs) {
    if (stepMs <= 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stepMs * (attempt + 1));
}

/**
 * Measured on the runner: a GPU that goes takes about two minutes to come back,
 * and six attempts two seconds apart spanned ninety seconds of it — every retry
 * spent inside the same dead window. Five seconds a step covers it.
 */
const STEP_MS = 5000;

/**
 * Whether this attempt reached a verdict at all. `measured` is the run's own
 * answer and wins; without one the log text is all there is.
 */
function reachedNoVerdict(last) {
    if (typeof last.measured === 'boolean') return !last.measured;
    return gpuNeverCameUp(last.output ?? '');
}

/**
 * Run `attempt` until it succeeds, or fails in a way that is the subject's own.
 * `note(noVerdict)` announces each retry.
 *
 * `attempt()` returns `{ ok, output }` plus, where it can tell: `measured` (did
 * this run reach a verdict? one that did has measured something, and its failure
 * is the subject's however loud the log is) and `drew` (did anything reach the
 * screen? a blank frame right after an outage is that outage still settling).
 */
export function retryOnDeadGpu(attempt, note, stepMs = STEP_MS) {
    let sawOutage = false;
    let last;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
        last = attempt();
        if (last.ok) return { ...last, retried: i > 0 };

        const noVerdict = reachedNoVerdict(last);
        if (noVerdict) sawOutage = true;
        // `drew === true` is the only thing that rules out aftermath: an attempt
        // that cannot say keeps the older, more cautious behaviour.
        const aftermath = sawOutage && last.drew !== true;
        // It measured, and what it measured was wrong. Retrying that is how a
        // broken subject gets six chances to look like a flaky runner.
        if (!noVerdict && !aftermath) return { ...last, retried: i > 0 };

        if (i < MAX_ATTEMPTS - 1) {
            note(noVerdict);
            backoff(i, stepMs);
        }
    }
    return { ...last, retried: true, gpuDied: true };
}
