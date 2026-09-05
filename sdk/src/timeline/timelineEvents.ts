// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineEvents.ts
 * @brief   Which stretches of a clip a playhead covered between two times, and
 *          which authored events that crossed.
 *
 * @details A fixed step never lands on an event's time, so "did it happen" is a
 *          question about an INTERVAL, and the interval is not always one piece:
 *          a looping clip advancing past its end covered the tail and then the
 *          head, with a discontinuity between them that a single (from, to] span
 *          reads as a rewind. {@link playheadRuns} is the one place that knows
 *          the shape of that, so events and root motion answer the same question
 *          the same way — the alternative is two wrap handlers that agree until
 *          one of them is fixed.
 *
 *          Pure: no world, no asset state. What a run means in clip time is all
 *          that is here, so the loop seam is a unit test rather than a frame.
 */

import { WrapMode, TrackType, type TimelineAsset } from './TimelineTypes';
import type { MotionEvent } from '../animation/motion';

/**
 * A stretch of clip time the playhead covered, in the direction it covered it —
 * `to` below `from` is a ping-pong clip running backwards. `inclusiveStart` marks
 * a run that BEGINS an instant rather than continuing one: the frame a state was
 * entered, and each lap of a loop.
 */
export interface PlayheadRun {
    from: number;
    to: number;
    inclusiveStart: boolean;
}

/** Where a phase within a ping-pong cycle sits in clip time. */
function pingPongPhase(phase: number, duration: number): number {
    const cycle = duration * 2;
    const p = phase % cycle;
    return p <= duration ? p : cycle - p;
}

/**
 * The stretches of clip time a playhead covered going from `from` to `to` (both
 * in clip seconds, `to` at or after `from`) under `mode`.
 *
 * A span at least a whole pass long collapses to ONE covering run: a frame long
 * enough to lap the clip twice reporting everything twice is a stutter.
 */
export function playheadRuns(
    from: number, to: number, duration: number, mode: WrapMode, inclusiveStart: boolean,
): PlayheadRun[] {
    if (duration <= 0 || to < from) return [];
    const span = to - from;

    if (mode === WrapMode.Once) {
        const a = Math.min(Math.max(from, 0), duration);
        const b = Math.min(Math.max(to, 0), duration);
        return [{ from: a, to: b, inclusiveStart }];
    }

    if (mode === WrapMode.Loop) {
        if (span >= duration) return [{ from: 0, to: duration, inclusiveStart: true }];
        const a = from % duration;
        // Landing exactly on a lap boundary BEGINS that lap, so an event authored
        // at 0 belongs to it — the one case where the caller's half-open window
        // would drop an event rather than hand it to the run before.
        const opens = inclusiveStart || (a === 0 && from > 0);
        const b = a + span;
        if (b <= duration) return [{ from: a, to: b, inclusiveStart: opens }];
        // The playhead JUMPED from the end to the start; the head of the clip is a
        // new lap, so an event authored at 0 belongs to it.
        return [
            { from: a, to: duration, inclusiveStart: opens },
            { from: 0, to: b - duration, inclusiveStart: true },
        ];
    }

    const cycle = duration * 2;
    if (span >= cycle) return [{ from: 0, to: duration, inclusiveStart: true }];
    const runs: PlayheadRun[] = [];
    let phase = from % cycle;
    const end = phase + span;
    let first = inclusiveStart;
    while (phase < end) {
        // A turn-around is continuous in clip time — the playhead reaches the end
        // and comes back through the same instant — so only the first run of the
        // call can be inclusive.
        const next = Math.min(end, (Math.floor(phase / duration) + 1) * duration);
        runs.push({
            from: pingPongPhase(phase, duration),
            to: pingPongPhase(next, duration),
            inclusiveStart: first,
        });
        first = false;
        phase = next;
    }
    return runs;
}

/** Whether a moment at `at` falls inside `run`, in the direction it runs. */
export function runCrosses(run: PlayheadRun, at: number): boolean {
    const { from, to, inclusiveStart } = run;
    if (to > from) return (at > from || (inclusiveStart && at === from)) && at <= to;
    if (to < from) return (at < from || (inclusiveStart && at === from)) && at >= to;
    return inclusiveStart && at === from;
}

/** The event's numeric payload, or 0 where it carries none. */
function payloadValue(payload: Record<string, unknown> | undefined): number {
    const v = payload?.value;
    return typeof v === 'number' ? v : 0;
}

/** The event's string payload, or empty where it carries none. */
function payloadText(payload: Record<string, unknown> | undefined): string {
    const v = payload?.text;
    return typeof v === 'string' ? v : '';
}

/**
 * Append every custom event `asset` declares within `runs` to `out`, run by run
 * and then in declaration order, so a long frame still reports swing before hit.
 * `childPath` is not read: the event happened to the character the clip plays on.
 */
export function collectCustomEvents(
    asset: TimelineAsset, runs: readonly PlayheadRun[], out: MotionEvent[],
): void {
    for (const run of runs) {
        for (const track of asset.tracks) {
            if (track.type !== TrackType.CustomEvent) continue;
            for (const event of track.events) {
                if (!runCrosses(run, event.time)) continue;
                out.push({
                    name: event.name,
                    value: payloadValue(event.payload),
                    text: payloadText(event.payload),
                });
            }
        }
    }
}
