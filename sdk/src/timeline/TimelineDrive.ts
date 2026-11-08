// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TimelineDrive.ts
 * @brief   Pure-TS per-frame timeline runtime — the replacement for the C++
 *          TimelineSystem::advance.
 *
 * Holds a per-entity playback clock and, each frame: advances time (speed + wrap),
 * samples property tracks (via the shared evaluator), and edge-detects event-track
 * triggers through the shared {@link applyTimelineEvent}. Event windows use the
 * same playhead runs as animator motions, including loop seams and ping-pong
 * turns; a folded sample time alone cannot preserve playback direction.
 */

import { applyWrapMode, sampleTimeline, type SampleDeps, type SampleOptions } from './TimelineEvaluator';
import { applyTimelineEvent, TimelineEventType } from './TimelineRuntime';
import { TrackType, WrapMode, type TimelineAsset } from './TimelineTypes';
import { forEachParticleEvent, playheadRuns, runCrosses, type PlayheadRun } from './timelineEvents';
import { collectSequenceLayers, resolveActiveShot, type ActiveShot, type SequenceLookup } from './timelineSequences';
import type { ParticleAPI } from '../particle/ParticleAPI';
import type { AudioAPI } from '../audio/Audio';
import type { Entity } from '../types';

/** Per-entity playback state (replaces the C++ Instance clock). */
export interface TimelineState {
    time: number;
    prevTime: number;
    /** Unfolded playback time. Optional for callers constructing older state records. */
    phase?: number;
    /** Whether the entry instant has already been dispatched. */
    started?: boolean;
    playing: boolean;
    speed: number;
    wrapMode: WrapMode;
    /** Per spine event-track (keyed by track index in asset.tracks): current clip, or -1. */
    spineClipIndices: Record<number, number>;
    /** The timelines playing inside this one, by `SequenceLayer.key`: where each was last step, for edge detection. */
    nested: Record<string, { time: number; spineClipIndices: Record<number, number> }>;
}

export function createTimelineState(wrapMode: WrapMode = WrapMode.Once, speed = 1): TimelineState {
    return { time: 0, prevTime: 0, phase: 0, started: false, playing: false, speed, wrapMode, spineClipIndices: {}, nested: {} };
}

export interface FiredEvent {
    kind: number; // TimelineEventType
    entity: Entity;
    intParam: number; // loop / active
    floatParam: number; // clip speed / volume
    str: string; // animation / clip path
}

/**
 * Edge-detect event-track triggers over playback runs. Mutates `state.spineClipIndices`.
 */
export function detectTimelineEvents(
    asset: TimelineAsset, state: TimelineState,
    resolveChild: (root: Entity, childPath: string) => Entity | null, root: Entity,
    // Legacy tuples describe forward-only intervals; explicit runs also describe
    // a ping-pong return and whether this is the clip's entry instant.
    // Level tracks (Spine, Activation) read `state.time` directly and ignore this.
    segments: ReadonlyArray<readonly [number, number] | PlayheadRun> = [[state.prevTime, state.time]],
): FiredEvent[] {
    const out: FiredEvent[] = [];
    const { time } = state;
    const runs = segments.map(segment => 'from' in segment ? segment : {
        from: segment[0], to: Math.max(segment[0], segment[1]),
        inclusiveStart: segment[0] === 0 && segment[1] > segment[0],
    });

    for (let i = 0; i < asset.tracks.length; i++) {
        const track = asset.tracks[i];
        if (track.type === TrackType.Property || track.type === TrackType.AnimFrames) continue;

        const target = resolveChild(root, track.childPath);
        if (target == null) continue;

        switch (track.type) {
            case TrackType.Particle: {
                forEachParticleEvent(track, runs, action => {
                    out.push({ kind: TimelineEventType.ParticleAction, entity: target, intParam: 0, floatParam: 0, str: action });
                });
                break;
            }
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
                for (const run of runs) {
                    if (runCrosses(run, track.startTime)) {
                        out.push({ kind: TimelineEventType.SpriteAnimPlay, entity: target, intParam: 0, floatParam: 0, str: track.clip });
                        break; // fire at most once across the seam segments
                    }
                }
                break;
            }
            case TrackType.Audio: {
                for (const run of runs) {
                    for (const e of track.events) {
                        if (runCrosses(run, e.time)) {
                            out.push({ kind: TimelineEventType.AudioPlay, entity: target, intParam: 0, floatParam: e.volume, str: e.clip });
                        }
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
    particle?: Pick<ParticleAPI, 'play' | 'stop' | 'reset'> | null;
    /** Skip-channel filter (editor mute); forwarded to the sampler. */
    sampleOpts?: SampleOptions;
    /** Side-effect hook after a property field is applied (e.g. UINode anim flags). */
    onPropertyApplied?: (entity: Entity, asset: TimelineAsset) => void;
    /** How a sequence clip finds the timeline it plays; without it nested clips are not played. */
    lookup?: SequenceLookup;
    /** The view this step asks for (null: none), for the camera director. */
    onShot?: (shot: ActiveShot | null) => void;
}

// ---------------------------------------------------------------------------
// TimelinePlayer flag contract
// ---------------------------------------------------------------------------

/**
 * The control surface of the `TimelinePlayer` component (structural, so this
 * module needs no import from the plugin). The component flags are the single
 * playback channel — the editor, game code, and AI actions all speak through
 * them; the per-frame system reconciles them with {@link TimelineState} via the
 * two functions below.
 */
export interface TimelinePlayerFlags {
    playing: boolean;
    finished: boolean;
}

/**
 * Pre-advance half of the flag contract: component → state. Raising `playing`
 * while `finished` is latched replays the clip from the top (the only way a
 * completed Once clip can run again — its clock is parked at the end). Returns
 * true when the component was mutated (`finished` cleared) and needs a write-back.
 */
export function applyPlayerFlags(flags: TimelinePlayerFlags, state: TimelineState): boolean {
    let changed = false;
    if (flags.playing && flags.finished) {
        state.time = 0;
        state.prevTime = 0;
        state.phase = 0;
        state.started = false;
        state.spineClipIndices = {};
        state.nested = {};
        flags.finished = false;
        changed = true;
    }
    state.playing = flags.playing;
    return changed;
}

/**
 * Post-advance half: state → component. A clip that just hit its Once end
 * clears `playing` and latches `finished` (read by the `timeline.finished` AI
 * condition and observable in the inspector); a stop from any other source only
 * clears `playing`. Returns true when the component needs a write-back.
 */
export function latchPlayerFinish(
    flags: TimelinePlayerFlags, state: TimelineState, justFinished: boolean,
): boolean {
    if (!state.playing && flags.playing) {
        flags.playing = false;
        if (justFinished) flags.finished = true;
        return true;
    }
    return false;
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

    let phase = state.phase ?? state.time;
    // Preserve the existing writable `time` control surface for callers that seek
    // through the state record rather than TimelineAPI.setTime.
    if (applyWrapMode(phase, asset.duration, state.wrapMode).time !== state.time) phase = state.time;
    state.prevTime = state.time;
    const advanced = phase + dt * state.speed;
    const wrapped = applyWrapMode(advanced, asset.duration, state.wrapMode);
    state.time = wrapped.time;
    state.phase = advanced;

    sampleTimeline(asset, state.time, root, ctx.deps, ctx.sampleOpts);
    ctx.onPropertyApplied?.(root, asset);

    const segments = playheadRuns(phase, advanced, asset.duration, state.wrapMode, !state.started);
    state.started = true;

    for (const e of detectTimelineEvents(asset, state, ctx.deps.resolveChild, root, segments)) {
        applyTimelineEvent(ctx.deps.world, ctx.audio ?? null, e.kind, e.entity, e.intParam, e.floatParam, e.str, ctx.particle);
    }

    const lookup = ctx.lookup ?? NO_TIMELINES;
    if (ctx.lookup) advanceNested(asset, root, state, ctx, ctx.lookup);
    ctx.onShot?.(resolveActiveShot(asset, state.time, root, ctx.deps.resolveChild, lookup));

    if (wrapped.stopped) state.playing = false;
    return wrapped.stopped;
}

const NO_TIMELINES: SequenceLookup = () => undefined;

/**
 * Play the timelines nested in `asset`: each runs on its own clock, samples its property tracks onto
 * its own root and fires its own events. A clip entered this step has no past (-1), so a trigger at its
 * start fires; one that has ended is forgotten, so entering it again starts it over.
 */
function advanceNested(asset: TimelineAsset, root: Entity, state: TimelineState, ctx: AdvanceContext, lookup: SequenceLookup): void {
    const live = new Set<string>();
    for (const layer of collectSequenceLayers(asset, state.time, root, ctx.deps.resolveChild, lookup)) {
        live.add(layer.key);
        sampleTimeline(layer.asset, layer.time, layer.root, ctx.deps, ctx.sampleOpts);
        ctx.onPropertyApplied?.(layer.root, layer.asset);
        const before = state.nested[layer.key];
        const prev = before ? before.time : -1;
        const child = createTimelineState(WrapMode.Once, 1);
        child.time = layer.time;
        child.prevTime = prev;
        child.spineClipIndices = before ? before.spineClipIndices : {};
        const segments: ReadonlyArray<readonly [number, number]> = layer.time < prev
            ? [[prev, layer.asset.duration], [0, layer.time]] : [[prev, layer.time]];
        for (const e of detectTimelineEvents(layer.asset, child, ctx.deps.resolveChild, layer.root, segments)) {
            applyTimelineEvent(ctx.deps.world, ctx.audio ?? null, e.kind, e.entity, e.intParam, e.floatParam, e.str, ctx.particle);
        }
        state.nested[layer.key] = { time: layer.time, spineClipIndices: child.spineClipIndices };
    }
    for (const key of Object.keys(state.nested)) if (!live.has(key)) delete state.nested[key];
}
