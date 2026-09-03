// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  smokeRetry.mjs — which native-boot verdicts are worth a second launch,
 *        and which of the three states a run ends in.
 *
 * The property a retry policy can destroy: a game that genuinely draws nothing
 * must still fail. So only two verdicts are relaunched, and both were measured
 * to vary on one build rather than assumed to:
 *
 *   - a frame of ONE flat colour. Across four runs of the same commit, chat and
 *     collision-layers took turns being the black one, each drew normally in the
 *     runs it was not, and either drew every time it was launched by itself. The
 *     boot record reported the same geometry in both cases (`1 draw(s), 14 tri,
 *     7 sprite`), so what varies is whether the frame reached the surface — and
 *     one launch cannot tell that from a game that draws nothing.
 *   - a run too slow to have reached the frame it is judged at. The first launch
 *     established the budget ran out, so the second gets a longer one.
 *
 * Everything else repeats: a crash, a launch that never reported ready, a dialog
 * with the focus. Relaunching those turns a broken build into a slow green one.
 *
 * A run that never reached a judged frame is the third state, never a pass: a
 * question this machine could not ask is not an answer about the game.
 */

/** @typedef {{ok?: boolean, undetermined?: boolean, why?: string, unjudged?: string|null, offScreen?: string|null}} SmokeResult */

/**
 * The verdicts that follow a successful start and say the app did not draw.
 *
 * Two faces of one event — the frame never reaching the surface — telling apart
 * only by whether the record caught a frame count (camera-follow: 240 frames in
 * one run of a build, none in the next).
 */
const NOT_DRAWN_AFTER_READY = [/ flat color after /, /drew no frame at all/];

/**
 * Worth launching a second time, on the same installed APK.
 *
 * @param {SmokeResult} r
 */
export function worthAnotherLaunch(r) {
    // A dialog over the game is the emulator having a bad minute and is already
    // retried inside one launch; reaching here with it set means that retry is
    // spent, and the frame under a dialog is not this check's to judge.
    if (r.offScreen) return false;
    if (r.undetermined) return true;
    // No `ready` check guarding these: a run that never reported ready is given
    // that verdict and no other, so both faces below already imply a start that
    // succeeded. The border is real, and the caller draws it.
    return !r.ok && NOT_DRAWN_AFTER_READY.some((face) => face.test(r.why ?? ''));
}

/**
 * Why this run judged nothing, or null if it judged something.
 *
 * Short of the asked-for frame the capture may still be racing the game, but only
 * over an EMPTY one: content is the game having drawn, at whatever frame it
 * stopped (lighting-2d: 10 frames in 90s, 1322 colours in the first).
 *
 * @param {{countColors: boolean, frames: number, wanted: number, colors: number, minColors: number}} run
 */
export function unjudgedReason({ countColors, frames, wanted, colors, minColors }) {
    if (!countColors || frames === 0 || frames >= wanted || colors >= minColors) return null;
    return `too slow to judge here — ${frames} frame(s) before the capture`;
}

/**
 * Pass, fail, or unanswered — the three a run can end in.
 *
 * @param {SmokeResult} r
 * @returns {'pass'|'fail'|'undetermined'}
 */
export function verdictOf(r) {
    if (r.undetermined) return 'undetermined';
    return r.ok ? 'pass' : 'fail';
}

/**
 * The process's exit code: 1 if anything broke, 2 if nothing broke and something
 * went unanswered, 0 only when every example was asked and answered.
 *
 * Failure outranks unanswered: a run with both has a defect to report, and
 * reporting "this machine could not tell" instead would bury it.
 *
 * @param {SmokeResult[]} results
 * @param {(r: SmokeResult) => boolean} [isKnownBroken]
 */
export function exitCodeFor(results, isKnownBroken = () => false) {
    if (results.some((r) => verdictOf(r) === 'fail' && !isKnownBroken(r))) return 1;
    if (results.some((r) => verdictOf(r) === 'undetermined')) return 2;
    return 0;
}
