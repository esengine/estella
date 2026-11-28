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

import { WrapMode, TrackType, type TimelineAsset, type ParticleTrack } from './TimelineTypes';
import type { MotionEvent, MotionWindow } from '../animation/motion';
import { defineEvent, type EventDef } from '../ecs/event';
import type { Entity } from '../types';

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
    loopEntry: 'departure' | 'arrival' = 'departure',
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
        // A lap's departure cue belongs to the first moving step out of the seam.
        const opens = inclusiveStart || (loopEntry === 'departure' && span > 0 && a === 0 && from > 0);
        const b = a + span;
        if (b < duration || (b === duration && loopEntry === 'departure')) return [{ from: a, to: b, inclusiveStart: opens }];
        // The playhead JUMPED from the end to the start; the head of the clip is a
        // new lap, so an event authored at 0 belongs to it.
        return [
            { from: a, to: duration, inclusiveStart: opens },
            { from: 0, to: b - duration, inclusiveStart: true },
        ];
    }

    const cycle = duration * 2;
    if (span >= cycle) return [{ from: 0, to: duration, inclusiveStart: true }];
    if (span === 0) {
        const time = pingPongPhase(from, duration);
        return [{ from: time, to: time, inclusiveStart }];
    }
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

/** Shared by standalone players and animator motions; pose sampling never fires effects. */
export function forEachParticleEvent(
    track: ParticleTrack, runs: readonly PlayheadRun[],
    emit: (action: ParticleTrack['events'][number]['action']) => void,
): void {
    for (const run of runs) {
        let first: ParticleTrack['events'][number] | undefined;
        let crossed: ParticleTrack['events'] | undefined;
        for (const event of track.events) {
            if (!runCrosses(run, event.time)) continue;
            if (!first) first = event;
            else (crossed ??= [first]).push(event);
        }
        // Most frames cross no key or one key. Only a multi-key crossing needs
        // storage and ordering; a reverse run must reach the later key first.
        // Stable sort preserves authored order for actions at the same instant.
        if (crossed) {
            const direction = run.to < run.from ? -1 : 1;
            crossed.sort((a, b) => direction * (a.time - b.time));
            for (const event of crossed) emit(event.action);
        } else if (first) emit(first.action);
    }
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
/**
 * Every custom event with a `duration` whose stretch of clip time `runs` reached,
 * once each, in the order the clip declares them. A window is [time, time + duration):
 * a run that only touches its closing edge does not open it, and a run standing still
 * (a paused clock) inside it keeps it open.
 */
export function collectCustomWindows(
    asset: TimelineAsset, runs: readonly PlayheadRun[], out: MotionWindow[],
): void {
    for (const track of asset.tracks) {
        if (track.type !== TrackType.CustomEvent) continue;
        for (const event of track.events) {
            const length = event.duration;
            if (!(length !== undefined && length > 0)) continue;
            const open = event.time, close = event.time + length;
            for (const run of runs) {
                const lo = Math.min(run.from, run.to), hi = Math.max(run.from, run.to);
                if (lo < close && hi >= open) {
                    out.push({ name: event.name, value: payloadValue(event.payload), text: payloadText(event.payload), start: open });
                    break;
                }
            }
        }
    }
}

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

/** What a playing timeline tells the game: {@link TimelineEvent}'s payload. */
export interface TimelineEventPayload {
    /** `'event'` for an event track's item, `'marker'` for a marker. */
    kind: 'event' | 'marker';
    /** Its name, as authored (`door-open`, `hit`). */
    name: string;
    /** An event's data; empty for a marker. */
    payload: Record<string, unknown>;
    /** Where it sits in the clip, in seconds. */
    time: number;
    /** The entity playing the timeline (its TimelinePlayer). */
    player: Entity;
    /** The entity the track is about, or the player for a track on the root. */
    target: Entity;
}

/**
 * The events and markers a TimelinePlayer's playhead crosses, sent as the frame plays them.
 * Read it with `EventReader(TimelineEvent)`; a system reads them the next frame.
 */
export const TimelineEvent: EventDef<TimelineEventPayload> = /* @__PURE__ */ defineEvent<TimelineEventPayload>('TimelineEvent', {
    kind: 'event', name: '', payload: {}, time: 0, player: 0 as Entity, target: 0 as Entity,
});

/** What a TimelinePlayer did: {@link TimelinePlayback}'s payload. */
export interface TimelinePlaybackPayload {
    /** `played` (started or resumed), `paused`, `stopped` (rewound), `finished` (a once timeline reached its end), or
     *  `looped` (a looping or ping-pong timeline came round). */
    kind: 'played' | 'paused' | 'stopped' | 'finished' | 'looped';
    player: Entity;
    /** Where the playhead is, in seconds. */
    time: number;
}

/**
 * A TimelinePlayer starting, pausing, stopping, finishing or looping.
 * Read with `EventReader(TimelinePlayback)`, the next frame.
 */
export const TimelinePlayback: EventDef<TimelinePlaybackPayload> = /* @__PURE__ */ defineEvent<TimelinePlaybackPayload>('TimelinePlayback', {
    kind: 'played', player: 0 as Entity, time: 0,
});

/** A named moment a playhead crossed: an event (with its payload) or a marker, and where it is in the clip. */
export interface TimelineSignal {
    kind: 'event' | 'marker';
    name: string;
    payload: Record<string, unknown>;
    time: number;
    /** The track's path relative to the timeline's root, or through a player binding. */
    childPath: string;
}

/**
 * Every custom event and marker `runs` crossed, in playhead order (run by run, then as the clip declares them): what a
 * timeline tells the game it played.
 */
export function collectSignals(asset: TimelineAsset, runs: readonly PlayheadRun[], out: TimelineSignal[]): void {
    for (const run of runs) {
        for (const track of asset.tracks) {
            if (track.type === TrackType.CustomEvent) {
                for (const e of track.events) {
                    if (runCrosses(run, e.time)) out.push({ kind: 'event', name: e.name, payload: e.payload ?? {}, time: e.time, childPath: track.childPath });
                }
            } else if (track.type === TrackType.Marker) {
                for (const m of track.markers) {
                    if (runCrosses(run, m.time)) out.push({ kind: 'marker', name: m.name, payload: {}, time: m.time, childPath: track.childPath });
                }
            }
        }
    }
}
