// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TimelineDrive.ts
 * @brief   Pure-TS per-frame timeline runtime — the replacement for the C++
 *          TimelineSystem::advance (docs/REARCH_ANIMATION.md P4c).
 *
 * Holds a per-entity playback clock and, each frame: advances time (speed + wrap),
 * samples property tracks (via the shared evaluator), and edge-detects event-track
 * triggers (spine/audio/spriteAnim/activation) dispatching them through the shared
 * {@link applyTimelineEvent}. The interpolation + event-detection logic is a 1:1
 * port of TimelineSystem.cpp (evaluateChannel / advance / evaluateEventTracks) so
 * playback matches the C++ runtime bit-for-bit and that runtime can be deleted.
 */

import { applyWrapMode, sampleTimeline, type SampleDeps, type SampleOptions } from './TimelineEvaluator';
import { applyTimelineEvent, TimelineEventType } from './TimelineRuntime';
import { TrackType, WrapMode, type TimelineAsset } from './TimelineTypes';
import type { AudioAPI } from '../audio/Audio';
import type { Entity } from '../types';

/** Per-entity playback state (replaces the C++ Instance clock). */
export interface TimelineState {
    time: number;
    prevTime: number;
    playing: boolean;
    speed: number;
    wrapMode: WrapMode;
    /** Per spine event-track (keyed by track index in asset.tracks): current clip, or -1. */
    spineClipIndices: Record<number, number>;
}

export function createTimelineState(wrapMode: WrapMode = WrapMode.Once, speed = 1): TimelineState {
    return { time: 0, prevTime: 0, playing: false, speed, wrapMode, spineClipIndices: {} };
}

export interface FiredEvent {
    kind: number; // TimelineEventType
    entity: Entity;
    intParam: number; // loop / active
    floatParam: number; // clip speed / volume
    str: string; // animation / clip path
}

/**
 * Edge-detect event-track triggers fired in (prevTime, time] — a 1:1 port of
 * TimelineSystem::evaluateEventTracks. Mutates `state.spineClipIndices`.
 */
export function detectTimelineEvents(
    asset: TimelineAsset, state: TimelineState,
    resolveChild: (root: Entity, childPath: string) => Entity | null, root: Entity,
): FiredEvent[] {
    const out: FiredEvent[] = [];
    const { time, prevTime } = state;

    for (let i = 0; i < asset.tracks.length; i++) {
        const track = asset.tracks[i];
        if (track.type === TrackType.Property || track.type === TrackType.AnimFrames) continue;

        const target = resolveChild(root, track.childPath);
        if (target == null) continue;

        switch (track.type) {
            case TrackType.Spine: {
                let currentClip = -1;
                for (let ci = track.clips.length - 1; ci >= 0; ci--) {
                    const c = track.clips[ci];
                    if (time >= c.start && time < c.start + c.duration) { currentClip = ci; break; }
                }
                const prevClip = state.spineClipIndices[i] ?? -1;
                if (currentClip !== prevClip) {
                    state.spineClipIndices[i] = currentClip;
                    if (currentClip === -1) {
                        if (prevClip >= 0) out.push({ kind: TimelineEventType.SpineStop, entity: target, intParam: 0, floatParam: 0, str: '' });
                    } else {
                        const c = track.clips[currentClip];
                        out.push({ kind: TimelineEventType.SpinePlay, entity: target, intParam: c.loop ? 1 : 0, floatParam: c.speed, str: c.animation });
                    }
                }
                break;
            }
            case TrackType.SpriteAnim: {
                if (prevTime <= track.startTime && time >= track.startTime && time > prevTime) {
                    out.push({ kind: TimelineEventType.SpriteAnimPlay, entity: target, intParam: 0, floatParam: 0, str: track.clip });
                }
                break;
            }
            case TrackType.Audio: {
                for (const e of track.events) {
                    if (e.time > prevTime && e.time <= time) {
                        out.push({ kind: TimelineEventType.AudioPlay, entity: target, intParam: 0, floatParam: e.volume, str: e.clip });
                    }
                }
                break;
            }
            case TrackType.Activation: {
                let active = false;
                for (const r of track.ranges) {
                    if (time >= r.start && time < r.end) { active = true; break; }
                }
                out.push({ kind: TimelineEventType.ActivationSet, entity: target, intParam: active ? 1 : 0, floatParam: 0, str: '' });
                break;
            }
        }
    }
    return out;
}

export interface AdvanceContext {
    deps: SampleDeps;
    audio?: AudioAPI | null;
    /** Skip-channel filter (editor mute); forwarded to the sampler. */
    sampleOpts?: SampleOptions;
    /** Side-effect hook after a property field is applied (e.g. UIRect anim flags). */
    onPropertyApplied?: (entity: Entity, asset: TimelineAsset) => void;
}

/**
 * Advance one entity's timeline by `dt`. Mirrors TimelineSystem::advance: clock +
 * wrap, sample property tracks, edge-detect + dispatch events. Returns true when
 * the clip just stopped (Once reached its end), so the caller can flip `playing`.
 */
export function advanceTimelineTS(
    asset: TimelineAsset, root: Entity, state: TimelineState, dt: number, ctx: AdvanceContext,
): boolean {
    if (!state.playing) return false;

    state.prevTime = state.time;
    const advanced = state.time + dt * state.speed;
    const wrapped = applyWrapMode(advanced, asset.duration, state.wrapMode);
    state.time = wrapped.time;

    sampleTimeline(asset, state.time, root, ctx.deps, ctx.sampleOpts);
    ctx.onPropertyApplied?.(root, asset);

    for (const e of detectTimelineEvents(asset, state, ctx.deps.resolveChild, root)) {
        applyTimelineEvent(ctx.deps.world, ctx.audio ?? null, e.kind, e.entity, e.intParam, e.floatParam, e.str);
    }

    if (wrapped.stopped) state.playing = false;
    return wrapped.stopped;
}
