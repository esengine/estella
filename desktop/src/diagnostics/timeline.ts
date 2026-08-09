// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timeline.ts
 * @brief   What the editor was asked to do, in the order it was asked.
 *
 * @details ONE stream, not one per source. A reproduction is an order — opened a
 *          scene, deleted an entity, undid it, hot-reloaded, crashed — and two
 *          streams only carry that order if a reader re-merges them by timestamp.
 *          The kind is a field.
 *
 *          Deliberately dependency-free: it is written to from the command
 *          registry and the undo stack, both of which sit under everything else,
 *          so importing anything here would close a cycle.
 */

export type TimelineKind = 'command' | 'edit' | 'engine';

export interface TimelineEvent {
    /** Epoch ms. Absolute in the buffer, relative in a report. */
    at: number;
    kind: TimelineKind;
    /** Command id, edit label, or engine event name. */
    id: string;
    /** One line of what it touched. Never the user's own content — see note(). */
    detail?: string;
    /** Consecutive repeats collapse into the last one, with a count. */
    count: number;
}

/**
 * How many events are kept. Not the log's 2000: a log line is one message, this
 * is one gesture, and a report needs the run-up rather than the session. The
 * buffer keeps the NEWEST — unlike the diagnostics aggregator, where the first
 * distinct failure is the one that explains the rest.
 */
const CAPACITY = 300;

const events: TimelineEvent[] = [];

/**
 * Record one event. `detail` must ALREADY be free of the user's own content:
 * this stream is kept unredacted, so callers pass shapes and counts.
 *
 * Consecutive identical events collapse — a gizmo drag records one edit per
 * frame, and 300 slots of "Move entity" would push out what matters.
 */
export function note(kind: TimelineKind, id: string, detail?: string): void {
    const last = events[events.length - 1];
    if (last && last.kind === kind && last.id === id && last.detail === detail) {
        last.count++;
        last.at = Date.now();
        return;
    }
    events.push({ at: Date.now(), kind, id, detail, count: 1 });
    if (events.length > CAPACITY) events.shift();
}

/**
 * The events, oldest first, timed RELATIVE to `now` in seconds.
 *
 * Relative because "4 seconds before the report" is the readable fact, and an
 * absolute clock in a bug report mostly tells you which timezone the reporter is
 * in. The absolute time of the newest event is kept once, at the top.
 */
export function timelineSnapshot(now: number): {
    capacity: number; kept: number; newestAt: string | null;
    events: { tMinusSec: number; kind: TimelineKind; id: string; detail?: string; count: number }[];
} {
    const newest = events[events.length - 1];
    return {
        capacity: CAPACITY,
        kept: events.length,
        newestAt: newest ? new Date(newest.at).toISOString() : null,
        events: events.map((e) => ({
            tMinusSec: Math.round((now - e.at) / 100) / 10,
            kind: e.kind,
            id: e.id,
            ...(e.detail !== undefined ? { detail: e.detail } : {}),
            count: e.count,
        })),
    };
}

/** Drop everything — for tests, and for a user who wants a clean run-up. */
export function clearTimeline(): void {
    events.length = 0;
}
