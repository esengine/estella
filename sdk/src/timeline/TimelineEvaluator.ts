// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TimelineEvaluator.ts
 * @brief   Pure-TS timeline sampler — evaluate a TimelineAsset at an absolute
 *          time and apply its property tracks to the world.
 *
 * The engine's C++ TimelineSystem is a temporary implementation. This is the
 * modern replacement's kernel: ONE
 * sample(time) call drives both forward playback (advance the clock, then sample)
 * and editor scrubbing (sample at any T) — so the editor gets "scrub ==
 * evaluate-at-T" for free, with no separate evaluate/apply paths.
 *
 * The interpolation math is a 1:1 port of TimelineSystem.cpp::evaluateChannel
 * (hermite/linear/step/ease) so playback and editor preview match the C++ path
 * numerically, and P4 can delete the C++ runtime with no regression.
 *
 * The sampler is dependency-injected (world / component lookup / child resolution)
 * so it is a pure function: unit-testable without WASM and reusable by both the
 * runtime and the editor preview bridge.
 */

import { TrackType, InterpType, WrapMode, type TimelineAsset, type PropertyChannel } from './TimelineTypes';
import { setNestedProperty, resolveChildEntity } from './TimelineRuntime';
import { getComponent, type AnyComponentDef } from '../ecs/component';
import type { Pose, PoseTrack, PoseWorld } from '../animation/pose';
import { q } from '../math/quat';
import type { Entity } from '../types';
import type { World } from '../ecs/world';

const RAD2DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Core math — 1:1 port of TimelineSystem.cpp (keep in lock-step)
// ---------------------------------------------------------------------------

function hermite(p0: number, p1: number, m0: number, m1: number, t: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
}

function easeIn(t: number): number {
    return t * t;
}

function easeOut(t: number): number {
    return 1 - (1 - t) * (1 - t);
}

function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

/** Evaluate a single property channel at `time` (seconds). Endpoints clamp. */
export function evaluateChannel(channel: PropertyChannel, time: number): number {
    const kfs = channel.keyframes;
    if (!kfs || kfs.length === 0) return 0;
    if (kfs.length === 1) return kfs[0].value;

    if (time <= kfs[0].time) return kfs[0].value;
    if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1].time <= time) i++;

    const k0 = kfs[i];
    const k1 = kfs[i + 1];
    const dt = k1.time - k0.time;
    if (dt <= 0) return k0.value;

    const t = (time - k0.time) / dt;

    switch (k0.interpolation) {
        case InterpType.Linear:
            return k0.value + (k1.value - k0.value) * t;
        case InterpType.Step:
            return k0.value;
        case InterpType.EaseIn:
            return k0.value + (k1.value - k0.value) * easeIn(t);
        case InterpType.EaseOut:
            return k0.value + (k1.value - k0.value) * easeOut(t);
        case InterpType.EaseInOut:
            return k0.value + (k1.value - k0.value) * easeInOut(t);
        case InterpType.Hermite:
        default:
            return hermite(k0.value, k1.value, k0.outTangent * dt, k1.inTangent * dt, t);
    }
}

/** Map an absolute time through the clip's wrap mode (for forward playback). */
export function applyWrapMode(
    time: number, duration: number, mode: WrapMode,
): { time: number; stopped: boolean } {
    if (duration <= 0) return { time: 0, stopped: true };
    if (time < 0) return { time: 0, stopped: false };
    if (time < duration) return { time, stopped: false };

    switch (mode) {
        case WrapMode.Loop:
            return { time: time % duration, stopped: false };
        case WrapMode.PingPong: {
            const cycle = duration * 2;
            const t = time % cycle;
            return { time: t <= duration ? t : cycle - t, stopped: false };
        }
        case WrapMode.Once:
        default:
            return { time: duration, stopped: true };
    }
}

// ---------------------------------------------------------------------------
// Field application — the reflection writer table
// ---------------------------------------------------------------------------

type FieldWriter = (data: any, value: number) => void;

/**
 * Per-field writers for animatable paths whose JS shape differs from the raw
 * dot-path, so a generic `setNestedProperty` would corrupt them.
 *
 * `rotation.angle` is the Z turn in radians, and it COMPOSES: the other two axes
 * survive it, so a clip turning a model about Z cannot flatten its pose. The
 * four components are written raw, normalized in {@link finishQuaternions}.
 */
const WRITER_OVERRIDES: Record<string, FieldWriter> = {
    'Transform.rotation.angle': (data, v) => {
        data.rotation = q.setAngleZ(data.rotation, v * RAD2DEG);
    },
};

/** Component fields written component-wise that must end up unit length. */
const QUATERNION_FIELDS: Record<string, readonly string[]> = {
    Transform: ['rotation'],
};

/**
 * Renormalize any quaternion a track wrote component-wise. Interpolating the
 * four numbers independently lands INSIDE the unit sphere — about 0.92 halfway
 * between two rotations 90° apart — and writing that scales the object.
 * Normalized it traces the arc slerp would, differing only in angular speed.
 */
function finishQuaternions(data: any, component: string, touched: Set<string>): void {
    for (const field of QUATERNION_FIELDS[component] ?? []) {
        if (!touched.has(field)) continue;
        data[field] = q.normalize(data[field]);
    }
}

function applyField(data: any, component: string, property: string, value: number): boolean {
    const override = WRITER_OVERRIDES[`${component}.${property}`];
    if (override) {
        override(data, value);
        return true;
    }
    return setNestedProperty(data, property, value);
}

// ---------------------------------------------------------------------------
// Sampler
// ---------------------------------------------------------------------------

/** Minimal world surface the sampler needs (component get/set by definition). */
export interface SampleWorld {
    has(entity: Entity, def: AnyComponentDef): boolean;
    get(entity: Entity, def: AnyComponentDef): Record<string, unknown>;
    set(entity: Entity, def: AnyComponentDef, data: Record<string, unknown>): void;
}

export interface SampleDeps {
    world: SampleWorld;
    getComponent: (name: string) => AnyComponentDef | undefined;
    resolveChild: (root: Entity, childPath: string) => Entity | null;
}

export interface SampleOptions {
    /** Return true to skip a channel — the editor uses this for muted tracks. */
    skipChannel?: (childPath: string, component: string, property: string) => boolean;
}

/**
 * Where a sampled track's values land: the world, for standalone playback and
 * the editor preview, or a {@link Pose}, for blending — values already written
 * cannot be weighed against each other. One traversal serves both.
 */
export interface SampleSink {
    /** The component data to write into, or null to skip this track. */
    open(entity: Entity, def: AnyComponentDef): Record<string, unknown> | null;
    /** Finish a track whose `touched` top-level fields were written. */
    close(
        entity: Entity, def: AnyComponentDef,
        data: Record<string, unknown>, touched: ReadonlySet<string>,
    ): void;
}

/** The sink that writes the world directly. */
export function worldSink(world: SampleWorld): SampleSink {
    return {
        open: (entity, def) => (world.has(entity, def) ? world.get(entity, def) : null),
        close: (entity, def, data) => { world.set(entity, def, data); },
    };
}

/** The sink that records into a pose for later composition. */
export function poseSink(pose: Pose, world: PoseWorld): SampleSink {
    let current: PoseTrack | null = null;
    return {
        open: (entity, def) => {
            current = pose.track(world, entity, def);
            return current?.data ?? null;
        },
        close: (_entity, _def, _data, touched) => {
            if (!current) return;
            for (const field of touched) current.touched.add(field);
            current = null;
        },
    };
}

/**
 * Evaluate every property track at `time` into `sink`. Property tracks only —
 * spine, audio, spriteAnim and activation carry side effects a sink cannot hold.
 * Each track touches one component on one entity, so it opens that component
 * once and folds every channel into a single write.
 */
export function sampleTimelineInto(
    asset: TimelineAsset, time: number, rootEntity: Entity,
    deps: SampleDeps, sink: SampleSink, opts?: SampleOptions,
): void {
    for (const track of asset.tracks) {
        if (track.type !== TrackType.Property) continue;

        const def = deps.getComponent(track.component);
        if (!def) continue;

        const entity = deps.resolveChild(rootEntity, track.childPath);
        if (entity == null) continue;

        const data = sink.open(entity, def);
        if (!data) continue;

        let changed = false;
        const touched = new Set<string>();
        for (const ch of track.channels) {
            if (!ch.keyframes || ch.keyframes.length === 0) continue;
            if (opts?.skipChannel?.(track.childPath, track.component, ch.property)) continue;
            const v = evaluateChannel(ch, time);
            if (applyField(data, track.component, ch.property, v)) {
                changed = true;
                touched.add(ch.property.split('.')[0]!);
            }
        }
        if (changed) {
            finishQuaternions(data, track.component, touched);
            sink.close(entity, def, data, touched);
        }
    }
}

/** Evaluate every property track at `time` and write the results to the world. */
export function sampleTimeline(
    asset: TimelineAsset, time: number, rootEntity: Entity, deps: SampleDeps, opts?: SampleOptions,
): void {
    sampleTimelineInto(asset, time, rootEntity, deps, worldSink(deps.world), opts);
}

/**
 * Evaluate every property track at `time` into `pose`, touching no component.
 * What a motion says, held apart from what the entity becomes.
 */
export function sampleTimelineIntoPose(
    asset: TimelineAsset, time: number, rootEntity: Entity,
    deps: SampleDeps, pose: Pose, opts?: SampleOptions,
): void {
    sampleTimelineInto(asset, time, rootEntity, deps, poseSink(pose, deps.world), opts);
}

/**
 * Convenience wrapper binding the real SDK component registry + child resolver.
 * The editor preview bridge and the runtime both call this; tests inject mocks
 * into {@link sampleTimeline} directly.
 */
export function sampleTimelineInWorld(
    asset: TimelineAsset, time: number, world: SampleWorld & Pick<World, 'tryGet'>, rootEntity: Entity, opts?: SampleOptions,
): void {
    sampleTimeline(asset, time, rootEntity, {
        world,
        getComponent,
        resolveChild: (root, childPath) => resolveChildEntity(world, root, childPath),
    }, opts);
}
